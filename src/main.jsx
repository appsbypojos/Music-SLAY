import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Trophy, Music2, ShieldCheck, ChevronRight, Check, Clock3, LockKeyhole } from 'lucide-react';
import './styles.css';

const phaseLabels = {
  preparation: 'Подготовка',
  candidates: 'Кандидаты',
  voting: 'Голосование',
  jury: 'Жюри',
  awards: 'Награждение'
};
const phaseOrder = ['preparation', 'candidates', 'voting', 'jury', 'awards'];
const roleLabels = { admin: 'Администратор', jury: 'Жюри', observer: 'Наблюдатель', participant: 'Участник' };

function App() {
  const [initData, setInitData] = useState('');
  const [role, setRole] = useState('guest');
  const [telegramUser, setTelegramUser] = useState(null);
  const [authStatus, setAuthStatus] = useState('Проверка Telegram…');
  const [phase, setPhase] = useState('preparation');
  const [slay, setSlay] = useState(null);
  const [nominations, setNominations] = useState([]);
  const [active, setActive] = useState(0);
  const [suggestion, setSuggestion] = useState('');
  const [selectedVotes, setSelectedVotes] = useState({});
  const [scores, setScores] = useState({});
  const [top5Selection, setTop5Selection] = useState({});
  const [durationHours, setDurationHours] = useState(24);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [now, setNow] = useState(Date.now());

  const current = nominations[active] || { id: '', name: 'Нет номинаций', candidates: [] };
  const roleName = roleLabels[role] || 'Гость';
  const phaseExpired = Boolean(slay?.phaseEndsAt && Date.parse(slay.phaseEndsAt) <= now);
  const remaining = slay?.phaseEndsAt ? Math.max(0, Date.parse(slay.phaseEndsAt) - now) : null;
  const topCandidates = useMemo(() => current.candidates.filter(c => c.is_top5), [current]);
  const nextPhase = phaseOrder[phaseOrder.indexOf(phase) + 1];

  async function api(path, body) {
    const response = await fetch(path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), 'X-Telegram-Init-Data': initData },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'request_failed');
    return data;
  }

  async function loadState() {
    const data = await api('/api/state');
    if (!data.slay) throw new Error('slay_not_configured');
    setSlay(data.slay);
    setPhase(data.slay.phase);
    setNominations((data.nominations || []).map(n => ({
      ...n,
      candidates: (n.candidates || []).map(c => ({ ...c, name: c.display_name }))
    })));
    setTop5Selection(Object.fromEntries((data.nominations || []).map(n => [n.id, (n.candidates || []).filter(c => c.is_top5).map(c => c.id)])));
    setSelectedVotes((data.myVotes || []).reduce((acc, v) => ({ ...acc, [v.nomination_id]: [...(acc[v.nomination_id] || []), v.candidate_id] }), {}));
    setScores(Object.fromEntries((data.myScores || []).map(s => [s.nomination_id + ':' + s.candidate_id, s.score])));
  }

  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    if (!tg) {
      setAuthStatus('Откройте приложение через Telegram');
      return;
    }
    tg.ready();
    tg.expand();
    const data = tg.initData;
    if (!data) {
      setAuthStatus('Telegram не передал данные авторизации');
      return;
    }
    setInitData(data);
    fetch('/api/telegram/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData: data })
    }).then(async response => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'auth_failed');
      setTelegramUser(result.user);
      setRole(result.role);
      setAuthStatus('Telegram подтверждён');
      const stateResponse = await fetch('/api/state', { headers: { 'X-Telegram-Init-Data': data } });
      const state = await stateResponse.json();
      if (!stateResponse.ok) throw new Error(state.error || 'state_load_failed');
      if (!state.slay) throw new Error('slay_not_configured');
      setSlay(state.slay);
      setPhase(state.slay.phase);
      setNominations((state.nominations || []).map(n => ({
        ...n, candidates: (n.candidates || []).map(c => ({ ...c, name: c.display_name }))
      })));
      setTop5Selection(Object.fromEntries((state.nominations || []).map(n => [n.id, (n.candidates || []).filter(c => c.is_top5).map(c => c.id)])));
      setSelectedVotes((state.myVotes || []).reduce((acc, v) => ({ ...acc, [v.nomination_id]: [...(acc[v.nomination_id] || []), v.candidate_id] }), {}));
      setScores(Object.fromEntries((state.myScores || []).map(s => [s.nomination_id + ':' + s.candidate_id, s.score])));
    }).catch(error => {
      setRole('guest');
      setAuthStatus(error.message === 'slay_not_configured' ? 'Выпуск ещё не настроен' : 'Не удалось загрузить данные приложения');
    });
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const notifyError = error => setStatus(error.message === 'phase_closed' ? 'Этап завершён. Отправка закрыта.' :
    error.message === 'nomination_locked' ? 'Номинация уже закрыта.' :
    error.message === 'forbidden' ? 'Недостаточно прав для этого действия.' :
    error.message === 'candidate_not_in_top5' ? 'Кандидат не входит в утверждённый топ-5.' :
    error.message === 'unauthorized' ? 'Сессия Telegram истекла. Перезапустите приложение.' :
    'Не удалось сохранить данные. Попробуйте ещё раз.');

  const submitCandidates = async () => {
    const names = suggestion.split(/[,\n]/).map(x => x.trim()).filter(Boolean);
    if (!names.length || !current.id || busy) return;
    setBusy(true);
    setStatus('');
    try {
      const result = await api('/api/submissions', { nominationId: current.id, names });
      setSuggestion('');
      await loadState();
      setStatus(result.saved?.some(x => x.duplicate) ? 'Новые предложения сохранены. Повторные предложения учтены один раз.' : 'Предложения сохранены в базе данных.');
    } catch (error) { notifyError(error); }
    finally { setBusy(false); }
  };

  const toggleVote = id => setSelectedVotes(v => {
    const selected = v[current.id] || [];
    return { ...v, [current.id]: selected.includes(id) ? selected.filter(x => x !== id) : selected.length < 5 ? [...selected, id] : selected };
  });

  const toggleTop5 = candidateId => setTop5Selection(v => {
    const selected = v[current.id] || [];
    return { ...v, [current.id]: selected.includes(candidateId) ? selected.filter(x => x !== candidateId) : selected.length < 5 ? [...selected, candidateId] : selected };
  });

  const saveTop5 = async () => {
    if (!current.id || busy) return;
    setBusy(true);
    try {
      await api('/api/admin/top5', { nominationId: current.id, candidateIds: top5Selection[current.id] || [] });
      await loadState();
      setStatus('Топ-5 номинации сохранён.');
    } catch (error) { notifyError(error); }
    finally { setBusy(false); }
  };

  const saveVotes = async () => {
    if (!current.id || busy) return;
    setBusy(true);
    try {
      const result = await api('/api/votes', { nominationId: current.id, candidateIds: selectedVotes[current.id] || [] });
      setStatus(`Голос сохранён. Выбрано кандидатов: ${result.saved}.`);
    } catch (error) { notifyError(error); }
    finally { setBusy(false); }
  };

  const saveScore = async (candidateId, score) => {
    if (!current.id || busy) return;
    const key = current.id + ':' + candidateId;
    setScores(s => ({ ...s, [key]: Number(score) }));
    setBusy(true);
    try {
      await api('/api/jury-score', { nominationId: current.id, candidateId, score: Number(score) });
      setStatus('Оценка сохранена.');
    } catch (error) { notifyError(error); }
    finally { setBusy(false); }
  };

  const advancePhase = async () => {
    if (!nextPhase || busy) return;
    const label = phaseLabels[nextPhase];
    if (!window.confirm(`Перейти к этапу «${label}»? Предыдущий этап будет закрыт.`)) return;
    setBusy(true);
    try {
      await api('/api/admin/phase', { phase: nextPhase, durationSeconds: Math.round(durationHours * 3600) });
      await loadState();
      setStatus(`Этап «${label}» запущен.`);
    } catch (error) { notifyError(error); }
    finally { setBusy(false); }
  };

  const formatRemaining = ms => {
    const total = Math.floor(ms / 1000);
    const days = Math.floor(total / 86400);
    const hours = Math.floor((total % 86400) / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    return `${days}д ${String(hours).padStart(2,'0')}:${String(minutes).padStart(2,'0')}:${String(seconds).padStart(2,'0')}`;
  };

  return <main className="shell">
    <header className="top">
      <div className="brand"><div className="logo"><Music2 /></div><div><b>MUSIC SLAY 2026</b><small>Музыкальная премия</small></div></div>
      <span className="pill"><span className="dot" />{authStatus}</span>
    </header>
    <section className="hero"><span className="eyebrow">THE AWARDS EXPERIENCE</span><h1>Твоя музыка.<br/><em>Твои победители.</em></h1><p>Пять этапов. От предложений участников до церемонии награждения.</p></section>
    <section className="rolebar"><label>Пользователь</label><span>{telegramUser ? [telegramUser.firstName, telegramUser.username ? '@' + telegramUser.username : ''].filter(Boolean).join(' · ') : 'Не авторизован'}</span><span className="role-tag">{roleName}</span></section>
    {slay && <section className="rolebar"><label>Текущий этап</label><b>{phaseLabels[phase]}</b><span className="muted">{remaining === null ? 'Без таймера' : phaseExpired ? 'Время этапа истекло' : formatRemaining(remaining)}</span></section>}
    <nav className="phases">{phaseOrder.map((p,i)=><div key={p} className={phase===p?'phase active':'phase'}><span>{String(i+1).padStart(2,'0')}</span>{phaseLabels[p]}</div>)}</nav>

    {phase==='preparation' && <section className="panel">
      <div className="sectionhead"><div><span className="eyebrow">START HERE</span><h2>Подготовка Slay</h2></div><ShieldCheck/></div>
      <label>Название выпуска</label><input value={slay?.title || 'MUSIC SLAY 2026'} disabled />
      <h3>Номинации</h3>{nominations.map(n=><div className="nomrow" key={n.id}><span>{n.name}</span><span className="muted">{n.candidates.length} кандидатов</span></div>)}
      {role==='admin' && <p className="hint">Выпуск создан в Supabase. Перед запуском этапа проверьте список номинаций и кандидатов.</p>}
      {role!=='admin' && <p className="hint">Ожидайте запуска первого этапа главным администратором.</p>}
    </section>}

    {phase==='candidates' && <section className="panel">
      <div className="sectionhead"><div><span className="eyebrow">NOMINATIONS</span><h2>Предложить кандидатов</h2></div><Music2/></div>
      <div className="tabs">{nominations.map((n,i)=><button className={active===i?'tab selected':'tab'} onClick={()=>setActive(i)} key={n.id}>{n.name}</button>)}</div>
      <h3>{current.name}</h3>
      {role==='participant' && !phaseExpired ? <><textarea value={suggestion} onChange={e=>setSuggestion(e.target.value)} placeholder="Введите имена через запятую или с новой строки" /><button className="primary" disabled={busy || !suggestion.trim()} onClick={submitCandidates}>Отправить предложения <ChevronRight size={17}/></button></> : <p className="hint">{role==='participant' ? 'Время этапа истекло.' : 'У этой роли нет права предлагать кандидатов.'}</p>}
      {current.candidates.map(c=><div className="candidate" key={c.id}>{c.name}<span className="muted">{c.suggestion_count} предложений</span></div>)}
      {role==='admin' && <div className="top5-admin"><h3>Утвердить топ-5 для голосования</h3><p className="hint">Выберите не более пяти кандидатов. Выбор сохраняется отдельно для каждой номинации.</p>{current.candidates.map(c=><label className="candidate top5-option" key={c.id}><input type="checkbox" checked={(top5Selection[current.id] || []).includes(c.id)} disabled={busy || phaseExpired || (!(top5Selection[current.id] || []).includes(c.id) && (top5Selection[current.id] || []).length>=5)} onChange={()=>toggleTop5(c.id)}/>{c.name}<span className="muted">{c.suggestion_count} предложений</span></label>)}<button className="primary" disabled={busy || phaseExpired} onClick={saveTop5}>Сохранить топ-5</button></div>}
    </section>}

    {phase==='voting' && <section className="panel">
      <div className="sectionhead"><div><span className="eyebrow">YOUR CHOICE</span><h2>Голосование</h2></div><Check/></div>
      <div className="tabs">{nominations.map((n,i)=><button className={active===i?'tab selected':'tab'} onClick={()=>setActive(i)} key={n.id}>{n.name}</button>)}</div>
      <h3>{current.name}</h3><p className="hint">Выберите до пяти кандидатов только в этой номинации.</p>
      {topCandidates.map((c,i)=><button disabled={role!=='participant' || phaseExpired || busy} className={'vote ' + ((selectedVotes[current.id] || []).includes(c.id) ? 'chosen' : '')} onClick={()=>toggleVote(c.id)} key={c.id}><span className="rank">{i+1}</span><span>{c.name}</span><span className="check">{(selectedVotes[current.id] || []).includes(c.id) ? '✓' : '+'}</span></button>)}
      {role==='participant' && <button className="primary" disabled={busy || phaseExpired} onClick={saveVotes}>Подтвердить выбор</button>}
    </section>}

    {phase==='jury' && <section className="panel">
      <div className="sectionhead"><div><span className="eyebrow">JURY SCORE</span><h2>Оценивание жюри</h2></div><Trophy/></div>
      <div className="tabs">{nominations.map((n,i)=><button className={active===i?'tab selected':'tab'} onClick={()=>setActive(i)} key={n.id}>{n.name}</button>)}</div>
      {topCandidates.map(c=><div className="score" key={c.id}><span>{c.name}</span><select disabled={role!=='jury' || phaseExpired || busy} value={scores[current.id + ':' + c.id] ?? 0} onChange={e=>saveScore(c.id,e.target.value)}>{Array.from({length:11},(_,i)=><option key={i} value={i}>{i}/10</option>)}</select></div>)}
      <p className="hint">Оценки каждого члена жюри сохраняются отдельно. Формула объединения оценок жюри и голосов участников пока не утверждена.</p>
    </section>}

    {phase==='awards' && <section className="panel">
      <div className="sectionhead"><div><span className="eyebrow">THE WINNERS</span><h2>Церемония награждения</h2></div><Trophy/></div>
      <div className="award"><span className="eyebrow">РЕЗУЛЬТАТЫ</span><Trophy size={42}/><h2>Награждение ещё не опубликовано</h2><p>Победители будут показаны после утверждения формулы подсчёта и публикации результатов главным администратором.</p></div>
    </section>}

    {role==='admin' && <section className="panel">
      <div className="sectionhead"><div><span className="eyebrow">ADMIN CONTROL</span><h2>Управление этапами</h2></div><LockKeyhole/></div>
      {nextPhase ? <>
        <label>Длительность следующего этапа (часы)</label>
        <input type="number" min="1" max="720" value={durationHours} onChange={e=>setDurationHours(Math.max(1,Math.min(720,Number(e.target.value))))}/>
        <button className="primary" disabled={busy} onClick={advancePhase}>Запустить этап «{phaseLabels[nextPhase]}» <ChevronRight size={17}/></button>
        <p className="hint">Переход закрывает предыдущий этап. Сервер проверяет время окончания при каждой отправке данных.</p>
      </> : <p className="hint">Все этапы пройдены. Публикация победителей будет добавлена после согласования формулы результатов.</p>}
    </section>}

    {status && <p className="hint" role="status">{status}</p>}
    <footer><Clock3 size={15}/> MUSIC SLAY 2026 <span>· данные хранятся в Supabase</span></footer>
  </main>;
}
createRoot(document.getElementById('root')).render(<App />);
