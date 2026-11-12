import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Activity, ArrowLeft, ArrowRight, Award, Check, ChevronDown, Clock3, Crown, FileText, Gauge, ListMusic, LoaderCircle, LogOut, Music2, RefreshCw, Save, ShieldCheck, Sparkles, Trophy, Users, Vote, X } from 'lucide-react';
import './styles.css';

const PHASES = [
  { id: 'preparation', label: 'Подготовка' },
  { id: 'candidates', label: 'Кандидаты' },
  { id: 'voting', label: 'Голосование' },
  { id: 'jury', label: 'Жюри' },
  { id: 'awards', label: 'Награждение' }
];
const ROLE_NAMES = { admin: 'Администратор', jury: 'Жюри', participant: 'Участник', observer: 'Наблюдатель' };
const ADMIN_TABS = [
  { id: 'nominations', label: 'Номинации', icon: ListMusic },
  { id: 'candidates', label: 'Кандидаты & Топ-5', icon: Users },
  { id: 'votes', label: 'Мониторинг голосов', icon: Activity },
  { id: 'phases', label: 'Управление этапами', icon: Gauge },
  { id: 'results', label: 'Результаты', icon: Trophy }
];
const DEADLINE = new Date('2026-12-07T00:00:00');

async function request(path, initData, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(initData ? { 'X-Telegram-Init-Data': initData } : {}),
      ...options.headers
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Ошибка запроса');
  return data;
}

function mapState(data) {
  const source = data.nominations || [];
  return {
    slay: data.slay,
    nominations: source.map(n => ({
      id: n.id,
      name: n.name,
      candidates: (n.candidates || []).map(c => ({
        id: c.id,
        name: c.display_name,
        count: Number(c.suggestion_count || 0),
        top5: Boolean(c.is_top5)
      }))
    })),
    myVotes: data.myVotes || [],
    myScores: data.myScores || []
  };
}

function App() {
  const [initData, setInitData] = useState('');
  const [user, setUser] = useState(null);
  const [role, setRole] = useState('');
  const [auth, setAuth] = useState('Подключаем Telegram…');
  const [phase, setPhase] = useState('preparation');
  const [phaseEndsAt, setPhaseEndsAt] = useState(null);
  const [nominations, setNominations] = useState([]);
  const [draft, setDraft] = useState([]);
  const [active, setActive] = useState(0);
  const [suggestion, setSuggestion] = useState('');
  const [votes, setVotes] = useState({});
  const [scores, setScores] = useState({});
  const [adminVotes, setAdminVotes] = useState([]);
  const [results, setResults] = useState([]);
  const [adminTab, setAdminTab] = useState('nominations');
  const [duration, setDuration] = useState(24);
  const [busy, setBusy] = useState('');
  const [toast, setToast] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [slide, setSlide] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);

  const isAdmin = role === 'admin';
  const current = nominations[active] || null;
  const phaseLabel = PHASES.find(p => p.id === phase)?.label || 'Подготовка';
  const winnerRows = useMemo(() => results.map(r => ({
    category: r.nomination,
    winner: r.winner?.candidate || 'Победитель не определён',
    score: r.winner?.finalScore,
    userVotes: r.winner?.userVotes,
    juryVotes: r.winner?.juryVotesTotal
  })), [results]);
  const selectedVotes = current ? (votes[current.id] || []) : [];

  const notify = useCallback((message, type = 'success') => {
    setToast({ message, type });
    window.clearTimeout(notify.timer);
    notify.timer = window.setTimeout(() => setToast(null), 3400);
  }, []);

  const applyState = useCallback(data => {
    const mapped = mapState(data);
    setNominations(mapped.nominations);
    setDraft(mapped.nominations.map(n => ({ id: n.id, name: n.name })));
    if (mapped.slay) {
      setPhase(mapped.slay.current_phase || 'preparation');
      setPhaseEndsAt(mapped.slay.phase_ends_at || null);
    }
    setVotes(Object.fromEntries(mapped.nominations.map(n => [
      n.id,
      mapped.myVotes.filter(v => v.nomination_id === n.id)
        .map(v => n.candidates.find(c => c.id === v.candidate_id)?.name).filter(Boolean)
    ])));
    setScores(Object.fromEntries(mapped.nominations.flatMap(n => mapped.myScores
      .filter(v => v.nomination_id === n.id)
      .map(v => [n.id + ':' + v.candidate_id, Number(v.score)]))));
    setLastUpdated(Date.now());
  }, []);

  const refreshState = useCallback(async () => {
    if (!initData) return;
    const data = await request('/api/state', initData);
    applyState(data);
  }, [initData, applyState]);

  const refreshResults = useCallback(async () => {
    if (!initData) return;
    const data = await request('/api/results', initData);
    setResults(data.results || []);
  }, [initData]);

  const refreshVotes = useCallback(async () => {
    if (!initData || !isAdmin) return;
    const data = await request('/api/admin/votes', initData);
    setAdminVotes(data.votes || []);
  }, [initData, isAdmin]);

  useEffect(() => {
    let cancelled = false;
    const tg = window.Telegram?.WebApp;
    if (!tg) {
      setAuth('Откройте приложение внутри Telegram');
      return;
    }
    tg.ready();
    tg.expand();
    try { tg.setHeaderColor('#090711'); tg.setBackgroundColor('#090711'); } catch (_) {}
    if (!tg.initData) {
      setAuth('Telegram не передал данные авторизации');
      return;
    }
    const data = tg.initData;
    setInitData(data);
    (async () => {
      try {
        const session = await request('/api/telegram/session', '', {
          method: 'POST', body: JSON.stringify({ initData: data })
        });
        if (cancelled) return;
        setUser(session.user || null);
        setRole(ROLE_NAMES[session.role] ? session.role : '');
        const state = await request('/api/state', data);
        if (cancelled) return;
        applyState(state);
        setAuth('Сессия подтверждена');
      } catch (error) {
        if (!cancelled) {
          setRole('');
          setAuth(error.message || 'Не удалось авторизоваться');
        }
      }
    })();
    return () => { cancelled = true; };
  }, [applyState]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!initData || !isAdmin) return;
    refreshVotes().catch(() => {});
    const timer = window.setInterval(() => refreshVotes().catch(() => {}), 2500);
    return () => window.clearInterval(timer);
  }, [initData, isAdmin, refreshVotes]);

  useEffect(() => {
    if (!initData || phase !== 'awards') return;
    refreshResults().catch(error => notify(error.message, 'error'));
  }, [initData, phase, refreshResults, notify]);

  useEffect(() => {
    if (!initData || phase !== 'candidates') return;
    const timer = window.setInterval(() => refreshState().catch(() => {}), 5000);
    return () => window.clearInterval(timer);
  }, [initData, phase, refreshState]);

  useEffect(() => {
    if (!playing || winnerRows.length < 2) return;
    const timer = window.setInterval(() => setSlide(s => (s + 1) % winnerRows.length), 6500);
    return () => window.clearInterval(timer);
  }, [playing, winnerRows.length]);

  useEffect(() => {
    if (slide >= winnerRows.length) setSlide(0);
  }, [slide, winnerRows.length]);

  const runAction = async (key, action, successMessage) => {
    if (busy) return;
    setBusy(key);
    try {
      await action();
      if (successMessage) notify(successMessage);
    } catch (error) {
      notify(error.message || 'Операция не выполнена', 'error');
    } finally {
      setBusy('');
    }
  };

  const submitSuggestions = () => runAction('suggestions', async () => {
    const names = [...new Set(suggestion.split(',').map(v => v.trim()).filter(Boolean))];
    if (!current?.id || !names.length) throw new Error('Введите хотя бы одного кандидата');
    await request('/api/submissions', initData, {
      method: 'POST',
      body: JSON.stringify({ nominationId: current.id, names })
    });
    setSuggestion('');
    await refreshState();
  }, 'Предложения отправлены');

  const saveVote = () => runAction('vote', async () => {
    if (!current?.id) throw new Error('Номинация не найдена');
    const candidateIds = selectedVotes.map(name => current.candidates.find(c => c.name === name)?.id).filter(Boolean);
    await request('/api/votes', initData, {
      method: 'POST',
      body: JSON.stringify({ nominationId: current.id, candidateIds })
    });
    await refreshState();
  }, 'Голос сохранён');

  const saveScore = (nomination, candidate, score) => {
    const key = nomination.id + ':' + candidate.id;
    setScores(prev => ({ ...prev, [key]: score }));
    runAction('score:' + key, async () => {
      await request('/api/jury-score', initData, {
        method: 'POST',
        body: JSON.stringify({ nominationId: nomination.id, candidateId: candidate.id, score })
      });
    }, 'Оценка сохранена');
  };

  const saveNominations = () => runAction('nominations', async () => {
    const clean = draft.map(n => ({ ...n, name: n.name.trim() })).filter(n => n.name);
    const names = clean.map(n => n.name.toLocaleLowerCase());
    if (!clean.length || clean.length > 20 || clean.some(n => n.name.length < 2 || n.name.length > 100) || new Set(names).size !== names.length) {
      throw new Error('Нужно от 1 до 20 уникальных названий длиной 2–100 символов');
    }
    await request('/api/admin/nominations', initData, {
      method: 'POST', body: JSON.stringify({ nominations: clean })
    });
    await refreshState();
  }, 'Список номинаций сохранён');

  const saveTop5 = nomination => runAction('top5:' + nomination.id, async () => {
    const ids = [...nomination.candidates]
      .sort((a, b) => b.count - a.count)
      .slice(0, 5).map(c => c.id).filter(Boolean);
    if (ids.length !== 5) throw new Error('Для топ-5 нужны минимум пять кандидатов');
    await request('/api/admin/top5', initData, {
      method: 'POST', body: JSON.stringify({ nominationId: nomination.id, candidateIds: ids })
    });
    await refreshState();
  }, 'Топ-5 сохранён по популярности предложений');

  const changePhase = next => runAction('phase', async () => {
    const label = PHASES.find(p => p.id === next)?.label || next;
    if (!window.confirm('Перейти на этап «' + label + '»? Текущий этап будет закрыт.')) return;
    await request('/api/admin/phase', initData, {
      method: 'POST',
      body: JSON.stringify({
        phase: next,
        durationSeconds: Number(duration) > 0 ? Number(duration) * 3600 : null
      })
    });
    await refreshState();
    if (next === 'awards') await refreshResults();
  }, 'Этап обновлён');

  const countdown = Math.max(0, DEADLINE.getTime() - now);
  const parts = [
    Math.floor(countdown / 86400000),
    Math.floor((countdown % 86400000) / 3600000),
    Math.floor((countdown % 3600000) / 60000),
    Math.floor((countdown % 60000) / 1000)
  ];
  const phaseRemaining = phaseEndsAt ? Math.max(0, new Date(phaseEndsAt).getTime() - now) : null;

  const changeVote = name => {
    setVotes(prev => {
      const existing = prev[current.id] || [];
      if (existing.includes(name)) return { ...prev, [current.id]: existing.filter(x => x !== name) };
      if (existing.length >= 5) {
        notify('Можно выбрать не более пяти кандидатов', 'error');
        return prev;
      }
      return { ...prev, [current.id]: [...existing, name] };
    });
  };

  const moveNomination = delta => setActive(index => Math.min(Math.max(index + delta, 0), Math.max(nominations.length - 1, 0)));

  const renderNominationNav = () => (
    <div className="nomination-switch">
      <button className="icon-button" onClick={() => moveNomination(-1)} disabled={active === 0} aria-label="Предыдущая номинация"><ArrowLeft size={17}/></button>
      <div className="switch-center">
        <span className="switch-count">{String(active + 1).padStart(2, '0')} <i>/ {String(nominations.length).padStart(2, '0')}</i></span>
        <div className="switch-progress"><span style={{ width: nominations.length ? ((active + 1) / nominations.length * 100) + '%' : '0%' }}/></div>
      </div>
      <button className="icon-button" onClick={() => moveNomination(1)} disabled={active >= nominations.length - 1} aria-label="Следующая номинация"><ArrowRight size={17}/></button>
    </div>
  );

  const renderCountdown = () => (
    <div className="countdown-grid">
      {parts.map((value, index) => <div className="countdown-cell" key={index}><strong>{String(value).padStart(index ? 2 : 1, '0')}</strong><span>{['дней', 'часов', 'минут', 'секунд'][index]}</span></div>)}
    </div>
  );

  const renderAwards = () => (
    <section className="stage-card awards-stage">
      <div className="stage-kicker"><span className="live-dot"/> ЦЕРЕМОНИЯ · MUSIC SLAY 2026</div>
      {winnerRows.length ? <>
        <div className="award-visual" key={slide}>
          <div className="award-orbit"><div className="award-cup"><Trophy size={42}/></div></div>
          <span className="award-label">ПОБЕДИТЕЛЬ НОМИНАЦИИ</span>
          <h2>{winnerRows[slide]?.category}</h2>
          <h1>{winnerRows[slide]?.winner}</h1>
          <div className="winner-stats">
            <span>Итог <b>{winnerRows[slide]?.score ?? '—'}</b></span>
            <span>Голоса <b>{winnerRows[slide]?.userVotes ?? '—'}</b></span>
            <span>Жюри <b>{winnerRows[slide]?.juryVotes ?? '—'}</b></span>
          </div>
        </div>
        <div className="slide-controls">
          <button className="icon-button" onClick={() => setSlide(s => (s - 1 + winnerRows.length) % winnerRows.length)} aria-label="Предыдущий победитель"><ArrowLeft/></button>
          <div className="slide-dots">{winnerRows.map((row, i) => <button key={row.category} className={i === slide ? 'active' : ''} onClick={() => setSlide(i)} aria-label={'Показать ' + row.category}/>)}</div>
          <button className="icon-button" onClick={() => setSlide(s => (s + 1) % winnerRows.length)} aria-label="Следующий победитель"><ArrowRight/></button>
          <button className="play-button" onClick={() => setPlaying(v => !v)}>{playing ? 'Пауза' : 'Слайдшоу'}</button>
        </div>
      </> : <div className="empty-state"><Trophy size={34}/><h3>Результаты пока не готовы</h3><p>Когда сервер рассчитает победителей, они появятся здесь.</p><button onClick={() => runAction('results', refreshResults, 'Результаты обновлены')}><RefreshCw size={15}/> Обновить</button></div>}
    </section>
  );

  const renderAdmin = () => (
    <div className="admin-layout">
      <aside className="admin-sidebar">
        <div className="admin-side-title"><ShieldCheck size={18}/><span>CONTROL ROOM</span></div>
        {ADMIN_TABS.map(tab => {
          const Icon = tab.icon;
          return <button key={tab.id} className={adminTab === tab.id ? 'admin-tab active' : 'admin-tab'} onClick={() => setAdminTab(tab.id)}><Icon size={17}/><span>{tab.label}</span><ChevronDown size={14}/></button>;
        })}
        <div className="sidebar-phase"><span>ТЕКУЩИЙ ЭТАП</span><b>{phaseLabel}</b><small>{phaseRemaining === null ? 'Длительность не задана' : phaseRemaining > 0 ? 'Осталось ' + Math.floor(phaseRemaining / 3600000) + ' ч ' + Math.floor((phaseRemaining % 3600000) / 60000) + ' мин' : 'Время этапа истекло'}</small></div>
      </aside>
      <div className="admin-content">
        {adminTab === 'nominations' && <section className="admin-panel">
          <PanelHeading eyebrow="CONFIGURATION" title="Номинации" detail="Управляйте структурой премии до и во время подготовки." icon={<ListMusic/>}/>
          {draft.map((item, index) => <div className="nomination-editor" key={item.id || 'new-' + index}>
            <span className="editor-index">{String(index + 1).padStart(2, '0')}</span>
            <input value={item.name} maxLength={100} onChange={e => setDraft(list => list.map((n, i) => i === index ? { ...n, name: e.target.value } : n))}/>
            <button className="icon-button danger" onClick={() => setDraft(list => list.filter((_, i) => i !== index))} aria-label="Удалить номинацию"><X size={17}/></button>
          </div>)}
          <div className="button-row">
            <button onClick={() => setDraft(list => list.length < 20 ? [...list, { id: null, name: 'Новая номинация' }] : list)} disabled={draft.length >= 20}>+ Добавить номинацию</button>
            <button className="button-primary" onClick={saveNominations} disabled={Boolean(busy)}><Save size={16}/> {busy === 'nominations' ? 'Сохранение…' : 'Сохранить изменения'}</button>
          </div>
        </section>}

        {adminTab === 'candidates' && <section className="admin-panel">
          <PanelHeading eyebrow="CANDIDATE MANAGEMENT" title="Кандидаты & Топ-5" detail="Популярность рассчитана по числу предложений участников." icon={<Users/>}/>
          {nominations.map(n => <div className="admin-nomination" key={n.id}>
            <div className="admin-nomination-head"><div><span className="eyebrow">НОМИНАЦИЯ</span><h3>{n.name}</h3><p>{n.candidates.length} кандидатов</p></div><button className="button-primary compact-button" onClick={() => saveTop5(n)} disabled={Boolean(busy) || n.candidates.length < 5}><Sparkles size={15}/> Авто Топ-5</button></div>
            {n.candidates.length ? [...n.candidates].sort((a, b) => b.count - a.count).map((c, i) => <div className="candidate-admin-row" key={c.id}><span className="candidate-position">{i + 1}</span><span className="candidate-admin-name">{c.name}</span><div className="popularity"><span style={{ width: (Math.max(...n.candidates.map(x => x.count), 1) ? c.count / Math.max(...n.candidates.map(x => x.count), 1) * 100 : 0) + '%' }}/></div><b>{c.count}</b>{c.top5 && <span className="top5-tag">TOP 5</span>}</div>) : <p className="empty-inline">Пока никто не предложен.</p>}
          </div>)}
        </section>}

        {adminTab === 'votes' && <section className="admin-panel">
          <PanelHeading eyebrow="LIVE MONITOR" title="Мониторинг голосов" detail="Автоматическое обновление каждые 2,5 секунды." icon={<Activity/>}/>
          <div className="monitor-meta"><span className="live-dot"/> LIVE <span>Записей: {adminVotes.length}</span><span>Обновлено: {lastUpdated ? new Date(lastUpdated).toLocaleTimeString('ru-RU') : '—'}</span><button className="icon-button" onClick={() => refreshVotes().catch(e => notify(e.message, 'error'))}><RefreshCw size={15}/></button></div>
          <div className="table-scroll"><table className="audit-table"><thead><tr><th>Номинация</th><th>Telegram ID</th><th>Кандидат</th><th>Голосов</th><th>Время</th></tr></thead><tbody>
            {adminVotes.length ? adminVotes.map((v, i) => <tr key={v.id || i}><td>{v.nomination || nominations.find(n => n.id === v.nomination_id)?.name || '—'}</td><td>{v.voter || '—'}</td><td>{v.candidate || '—'}</td><td>{v.vote_count ?? '—'}</td><td>{v.created_at ? new Date(v.created_at).toLocaleString('ru-RU') : '—'}</td></tr>) : <tr><td colSpan="5" className="table-empty">Голосов пока нет</td></tr>}
          </tbody></table></div>
          <p className="microcopy">Данные отображаются в том виде, в котором их возвращает API аудита.</p>
        </section>}

        {adminTab === 'phases' && <section className="admin-panel">
          <PanelHeading eyebrow="PHASE CONTROL" title="Управление этапами" detail="Переход закрывает текущий этап и обновляет состояние для всех участников." icon={<Gauge/>}/>
          <div className="phase-current"><span>СЕЙЧАС</span><strong>{phaseLabel}</strong><small>{phaseEndsAt ? 'Завершение: ' + new Date(phaseEndsAt).toLocaleString('ru-RU') : 'Срок не установлен'}</small></div>
          <label className="field-label" htmlFor="phase-duration">Длительность следующего этапа</label>
          <div className="duration-input"><input id="phase-duration" type="number" min="0" max="720" value={duration} onChange={e => setDuration(e.target.value)}/><span>часов · 0 — без таймера</span></div>
          <div className="phase-control-list">{PHASES.map((p, i) => <div className={phase === p.id ? 'phase-control-row current' : 'phase-control-row'} key={p.id}><div className="phase-number">{String(i + 1).padStart(2, '0')}</div><div><b>{p.label}</b><small>{phase === p.id ? 'Текущий этап' : 'Переключить на этот этап'}</small></div><button disabled={phase === p.id || Boolean(busy)} onClick={() => changePhase(p.id)}>{phase === p.id ? <Check size={16}/> : 'Перейти'}</button></div>)}</div>
        </section>}

        {adminTab === 'results' && <section className="admin-panel">
          <PanelHeading eyebrow="FINAL RESULTS" title="Результаты" detail="Итоговые данные загружаются из /api/results." icon={<Trophy/>}/>
          <div className="button-row right"><button onClick={() => runAction('results', refreshResults, 'Результаты обновлены')} disabled={Boolean(busy)}><RefreshCw size={15}/> Обновить</button></div>
          {winnerRows.length ? winnerRows.map((row, i) => <div className="result-row" key={row.category}><span>{String(i + 1).padStart(2, '0')}</span><div><small>{row.category}</small><b>{row.winner}</b></div><strong>{row.score ?? '—'}</strong></div>) : <div className="empty-state"><Trophy/><p>Сервер пока не вернул результаты.</p></div>}
        </section>}
      </div>
    </div>
  );

  if (isAdmin) return <main className="app-shell admin-shell">
    <header className="app-header"><div className="brand-lockup"><div className="brand-mark"><Music2/></div><div><b>MUSIC SLAY <em>2026</em></b><span>ADMINISTRATION CONSOLE</span></div></div><div className="header-user"><span className="admin-avatar"><ShieldCheck size={17}/></span><div><b>{user?.firstName || 'Admin'}</b><small>Администратор</small></div></div></header>
    <div className="admin-welcome"><div><span className="eyebrow">CONTROL CENTER / OVERVIEW</span><h1>Панель управления</h1><p>Полный контроль над этапами, номинациями и голосованием.</p></div><div className="admin-live"><span className="live-dot"/> SYSTEM ONLINE</div></div>
    <div className="admin-status-strip"><div><span>ТЕКУЩИЙ ЭТАП</span><b>{phaseLabel}</b></div><div><span>НОМИНАЦИЙ</span><b>{nominations.length}</b></div><div><span>ГОЛОСОВ</span><b>{adminVotes.length}</b></div><div><span>РОЛЬ</span><b>ADMIN</b></div></div>
    {renderAdmin()}
    <footer className="app-footer">MUSIC SLAY 2026 <span>·</span> ADMIN CONSOLE <span className="footer-auth">{auth}</span></footer>
    {toast && <div className={'toast ' + toast.type}><span>{toast.type === 'error' ? <X size={17}/> : <Check size={17}/>}</span>{toast.message}</div>}
  </main>;

  return <main className="app-shell">
    <header className="app-header"><div className="brand-lockup"><div className="brand-mark"><Music2/></div><div><b>MUSIC SLAY <em>2026</em></b><span>МУЗЫКАЛЬНАЯ ПРЕМИЯ</span></div></div><div className="header-user"><span className="user-avatar"><Users size={16}/></span><div><b>{user?.firstName || 'Гость'}</b><small>{ROLE_NAMES[role] || 'Нет доступа'}</small></div></div></header>
    <section className="hero-banner"><div className="hero-copy"><span className="eyebrow">THE SOUND OF 2026</span><h1>Твоя музыка.<br/><span>Твой выбор.</span></h1><p>Определяем главные имена и релизы года вместе.</p></div><div className="hero-art"><div className="hero-disc"><div className="disc-core"><Music2 size={30}/></div></div><div className="hero-star"><Sparkles size={19}/></div></div></section>
    <section className="phase-overview"><div className="phase-overview-head"><div><span className="eyebrow">ПУТЬ ПРЕМИИ</span><h2>{phaseLabel}</h2></div><span className="phase-status"><i/> LIVE STAGE</span></div><div className="phase-track">{PHASES.map((p, i) => <div key={p.id} className={'phase-step ' + (phase === p.id ? 'active' : PHASES.findIndex(x => x.id === phase) > i ? 'complete' : '')}><span>{PHASES.findIndex(x => x.id === phase) > i ? <Check size={12}/> : String(i + 1)}</span><small>{p.label}</small></div>)}</div>{phaseRemaining !== null && <div className="phase-deadline"><Clock3 size={14}/> {phaseRemaining > 0 ? 'До завершения этапа: ' + Math.floor(phaseRemaining / 3600000) + ' ч ' + Math.floor((phaseRemaining % 3600000) / 60000) + ' мин' : 'Срок этапа истёк'}</div>}</section>

    {!role && <section className="stage-card waiting-stage"><div className="waiting-icon"><ShieldCheck size={30}/></div><span className="eyebrow">TELEGRAM ACCESS</span><h2>Подключение к премии</h2><p>{auth}</p><div className="loader-line"><span/></div></section>}

    {role && phase === 'preparation' && <section className="stage-card waiting-stage"><div className="waiting-icon"><Clock3 size={30}/></div><span className="eyebrow">COUNTDOWN TO THE SHOW</span><h2>Скоро начнём</h2><p>Идёт подготовка MUSIC SLAY 2026. Сбор кандидатов откроется после старта этапа.</p>{renderCountdown()}<div className="deadline-note">СТАРТ ЦЕРЕМОНИИ · 07 ДЕКАБРЯ 2026</div></section>}

    {role && phase === 'candidates' && <section className="stage-card"><StageHeading eyebrow="NOMINATION SUBMISSIONS" title="Кого номинируем?" detail="Предложи одного или нескольких кандидатов через запятую." icon={<Music2/>}/>{renderNominationNav()}{current && <><div className="current-nomination"><span>ТЕКУЩАЯ НОМИНАЦИЯ</span><h2>{current.name}</h2><div className="candidate-summary"><b>{current.candidates.length}</b><span>уже предложено</span></div></div>{role === 'participant' ? <><label className="field-label" htmlFor="candidate-input">Твои предложения</label><textarea id="candidate-input" value={suggestion} onChange={e => setSuggestion(e.target.value)} placeholder="Например: артист, артист — трек, альбом…"/><div className="form-footnote">Несколько вариантов можно разделить запятой.</div><button className="button-primary full-button" onClick={submitSuggestions} disabled={Boolean(busy) || !suggestion.trim()}>{busy === 'suggestions' ? <LoaderCircle className="spin"/> : <Sparkles size={17}/>} Отправить предложения</button></> : <div className="notice-card"><ShieldCheck size={18}/><p>{role === 'observer' ? 'Режим наблюдателя: просмотр без отправки предложений.' : 'Предложения доступны участникам.'}</p></div>}<div className="suggestion-list"><h3>Уже в списке</h3>{current.candidates.length ? current.candidates.slice().sort((a, b) => b.count - a.count).map(c => <div className="suggestion-item" key={c.id}><span>{c.name}</span><b>{c.count}</b></div>) : <div className="empty-inline">Список пока пуст. Стань первым, кто предложит кандидата.</div>}</div></>}</section>}

    {role && phase === 'voting' && <section className="stage-card"><StageHeading eyebrow="COMMUNITY VOTE" title="Выбирай лучших" detail="Отметь до пяти кандидатов в каждой номинации." icon={<Vote/>}/>{renderNominationNav()}{current && <><div className="current-nomination"><span>НОМИНАЦИЯ</span><h2>{current.name}</h2></div><div className="selection-meter"><div><b>Выбрано {selectedVotes.length}/5</b><span>Можно отметить до пяти</span></div><div className="meter-track"><span style={{ width: selectedVotes.length * 20 + '%' }}/></div></div><div className="vote-cards">{current.candidates.filter(c => c.top5).map((c, i) => { const selected = selectedVotes.includes(c.name); return <button type="button" key={c.id} className={'vote-card ' + (selected ? 'selected' : '')} onClick={() => role === 'participant' && changeVote(c.name)} disabled={role !== 'participant'}><span className="vote-rank">{String(i + 1).padStart(2, '0')}</span><span className="vote-name">{c.name}</span><span className="vote-check">{selected ? <Check size={17}/> : '+'}</span></button>; })}</div>{current.candidates.filter(c => c.top5).length === 0 && <div className="empty-inline">Топ-5 для этой номинации ещё не опубликован.</div>}{role === 'participant' ? <button className="button-primary full-button" onClick={saveVote} disabled={Boolean(busy) || !current.candidates.some(c => c.top5)}>{busy === 'vote' ? <LoaderCircle className="spin"/> : <Vote size={17}/>} Подтвердить голос</button> : <div className="notice-card"><ShieldCheck size={18}/><p>{role === 'observer' ? 'Вы можете наблюдать за голосованием, но не голосовать.' : 'Голосование доступно участникам.'}</p></div>}</>}</section>}

    {role && phase === 'jury' && <section className="stage-card"><StageHeading eyebrow="JURY ROOM" title="Оценка жюри" detail="Выставляй оценки от 0 до 10. Каждая оценка сохраняется сразу." icon={<Award/>}/>{renderNominationNav()}{current && <><div className="current-nomination"><span>НОМИНАЦИЯ</span><h2>{current.name}</h2></div>{(current.candidates.filter(c => c.top5).length ? current.candidates.filter(c => c.top5) : current.candidates.slice(0, 5)).map((c, i) => <div className="jury-score-row" key={c.id}><div className="jury-candidate"><span>{String(i + 1).padStart(2, '0')}</span><b>{c.name}</b></div><select aria-label={'Оценка ' + c.name} disabled={role !== 'jury' || Boolean(busy)} value={scores[current.id + ':' + c.id] ?? 0} onChange={e => saveScore(current, c, Number(e.target.value))}>{Array.from({ length: 11 }, (_, score) => <option key={score} value={score}>{score} / 10</option>)}</select></div>)}{role !== 'jury' && <div className="notice-card"><ShieldCheck size={18}/><p>Оценивание доступно только членам жюри.</p></div>}</>}</section>}

    {role && phase === 'awards' && renderAwards()}
    <footer className="app-footer">MUSIC SLAY 2026 <span>·</span> MADE FOR THE SOUND <span className="footer-auth">{auth}</span></footer>
    {toast && <div className={'toast ' + toast.type}><span>{toast.type === 'error' ? <X size={17}/> : <Check size={17}/>}</span>{toast.message}</div>}
  </main>;
}

function StageHeading({ eyebrow, title, detail, icon }) {
  return <div className="stage-heading"><div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2><p>{detail}</p></div><div className="heading-icon">{icon}</div></div>;
}
function PanelHeading({ eyebrow, title, detail, icon }) {
  return <div className="admin-panel-heading"><div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2><p>{detail}</p></div><div className="heading-icon">{icon}</div></div>;
}

createRoot(document.getElementById('root')).render(<App/>);
