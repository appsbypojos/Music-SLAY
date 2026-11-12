import React, { useMemo, useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { createClient } from '@supabase/supabase-js';
import { Trophy, Music2, ShieldCheck, ChevronRight, Check, Clock3 } from 'lucide-react';
import './styles.css';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const supabase = supabaseUrl && supabaseAnonKey ? createClient(supabaseUrl, supabaseAnonKey) : null;

const seed = [
  { name: 'Артист года', candidates: ['Артист1','Артист2','Артист3','Артист4','Артист5'] },
  { name: 'Песня года', candidates: ['Артист1 — Название трека1','Артист2 — Название трека2','Артист3 — Название трека3','Артист4 — Название трека4','Артист5 — Название трека5'] },
  { name: 'Открытие года', candidates: ['Исполнитель1','Исполнитель2','Исполнитель3','Исполнитель4','Исполнитель5'] },
  { name: 'Альбом года', candidates: ['Артист1 — Название альбома1','Артист2 — Название альбома2','Артист3 — Название альбома3','Артист4 — Название альбома4','Артист5 — Название альбома5'] }
];
const phases = ['Подготовка','Кандидаты','Голосование','Жюри','Награждение'];
const roleLabels = { admin: 'Администратор', jury: 'Жюри', observer: 'Наблюдатель', participant: 'Участник' };
const LAUNCH_AT = new Date('2026-12-01T00:00:00+03:00').getTime();

function App() {
  const [phase,setPhase] = useState('Подготовка');
  const [role,setRole] = useState('Гость');
  const [telegramUser,setTelegramUser] = useState(null);
  const [initData,setInitData] = useState('');
  const [slayId,setSlayId] = useState(null);
  const [phaseEndsAt,setPhaseEndsAt] = useState(null);
  const [clockNow,setClockNow] = useState(Date.now());
  const [phaseDurationHours,setPhaseDurationHours] = useState(24);
  const [top5Selections,setTop5Selections] = useState({});
  const [isTransitioning,setIsTransitioning] = useState(false);
  const [authStatus,setAuthStatus] = useState('Проверка Telegram…');
  const [active,setActive] = useState(0);
  const [nominations,setNominations] = useState(seed);
  const [votes,setVotes] = useState({});
  const [suggestion,setSuggestion] = useState('');
  const [scores,setScores] = useState({});
  const [slideshow,setSlideshow] = useState(false);
  const [slide,setSlide] = useState(0);
  const [status,setStatus] = useState('Демо-данные');
  const [results,setResults] = useState([]);
  const current = nominations[active] || {name:'Нет номинаций',candidates:[]};
  const remainingMs = phaseEndsAt ? Math.max(0,new Date(phaseEndsAt).getTime()-clockNow) : null;
  const remainingLabel = remainingMs===null ? 'без таймера' : remainingMs===0 ? 'время этапа истекло' : `${Math.floor(remainingMs/3600000)} ч ${Math.floor((remainingMs%3600000)/60000)} мин`;
  const launchRemainingMs = Math.max(0, LAUNCH_AT-clockNow);
  const launchCountdownLabel = launchRemainingMs===0 ? 'Премия начинается сейчас' : `${Math.floor(launchRemainingMs/86400000)} д ${Math.floor((launchRemainingMs%86400000)/3600000)} ч ${Math.floor((launchRemainingMs%3600000)/60000)} мин ${Math.floor((launchRemainingMs%60000)/1000)} сек`;
  const displayTimerLabel = remainingMs===null ? launchCountdownLabel : remainingLabel;
  const winners = useMemo(()=>results.map(r=>({category:r.nomination,winner:r.winner?.candidate || 'Победитель не определён'})),[results]);

  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    if (!tg) {
      setAuthStatus('Откройте приложение через Telegram');
      return;
    }
    tg.ready();
    tg.expand();
    try { tg.setHeaderColor('#050508'); tg.setBackgroundColor('#050508'); } catch (_) {}
    const initData = tg.initData;
    if (!initData) {
      setAuthStatus('Telegram не передал данные авторизации');
      return;
    }
    fetch('/api/telegram/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData })
    }).then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'auth_failed');
      setTelegramUser(data.user);
      setInitData(initData);
      setRole(Object.prototype.hasOwnProperty.call(roleLabels, data.role) ? roleLabels[data.role] : 'Гость');
      const stateResponse = await fetch('/api/state', { headers: { 'X-Telegram-Init-Data': initData } });
      const serverState = await stateResponse.json();
      if (!stateResponse.ok) throw new Error(serverState.error || 'state_load_failed');
      if (serverState.slay) {
        setSlayId(serverState.slay.id);
        setPhaseEndsAt(serverState.slay.phase_ends_at);
        const phaseLabels = { preparation: 'Подготовка', candidates: 'Кандидаты', voting: 'Голосование', jury: 'Жюри', awards: 'Награждение' };
        setPhase(phaseLabels[serverState.slay.current_phase] || 'Подготовка');
        const mappedNominations = serverState.nominations.map(n => ({ id: n.id, name: n.name, candidates: n.candidates.map(x => x.display_name), candidateIds: Object.fromEntries(n.candidates.map(x => [x.display_name, x.id])), top5: n.candidates.filter(x => x.is_top5).map(x => x.display_name) }));
        setNominations(mappedNominations);
        setTop5Selections(Object.fromEntries(serverState.nominations.map(n => [n.id, n.candidates.filter(x => x.is_top5).map(x => x.id)])));
        setVotes(Object.fromEntries(serverState.nominations.map((n,i) => [i, (serverState.myVotes||[]).filter(v => v.nomination_id===n.id).map(v => n.candidates.find(x=>x.id===v.candidate_id)?.display_name).filter(Boolean)])));
        setScores(Object.fromEntries(serverState.nominations.flatMap((n,i) => (serverState.myScores||[]).filter(v=>v.nomination_id===n.id).map(v=>[i+':'+(n.candidates.find(x=>x.id===v.candidate_id)?.display_name||''),v.score]))));
        setStatus('Данные загружены из Supabase');
        try { await refreshResults(); } catch { /* results are unavailable until votes/jury data exist */ }
      }
      setAuthStatus('Telegram подтверждён');
    }).catch(error => {
      setRole('Гость');
      const authErrors = {
        telegram_not_configured: 'Не настроен токен Telegram-бота',
        invalid_or_expired_telegram_init_data: 'Telegram отклонил данные: неверный токен бота, подпись или срок действия',
        role_lookup_failed: 'Telegram подтверждён, но не удалось загрузить роль пользователя',
        database_not_configured: 'Не настроено подключение к базе данных',
        state_load_failed: 'Telegram подтверждён, но не удалось загрузить состояние приложения',
        request_failed: 'Ошибка сервера при проверке Telegram'
      };
      setAuthStatus(authErrors[error.message] || `Ошибка авторизации: ${error.message || 'неизвестная ошибка'}`);
    });
  }, []);

  useEffect(()=>{const timer=setInterval(()=>setClockNow(Date.now()),1000);return()=>clearInterval(timer);},[]);

  useEffect(()=>{
    if(!slideshow)return;
    const timer=setInterval(()=>setSlide(s=>(s+1)%Math.max(winners.length,1)),10000);
    return ()=>clearInterval(timer);
  },[slideshow,winners.length]);

  const toggleVote = name => setVotes(v=>{const existing=v[active]||[];if(existing.includes(name))return {...v,[active]:existing.filter(x=>x!==name)};if(existing.length>=5){setStatus('Можно выбрать не более пяти кандидатов');return v;}return {...v,[active]:[...existing,name]};});
  const addSuggestions = async () => {
    const values=suggestion.split(',').map(x=>x.trim()).filter(Boolean);
    if(!values.length || !current.id || !initData)return;
    const response = await fetch('/api/submissions', { method:'POST', headers:{'Content-Type':'application/json','X-Telegram-Init-Data':initData}, body:JSON.stringify({nominationId:current.id,names:values}) });
    const result = await response.json();
    if(!response.ok){setStatus(result.error || 'Не удалось отправить предложения');return;}
    const refreshed = await fetch('/api/state',{headers:{'X-Telegram-Init-Data':initData}}).then(r=>r.json());
    setNominations(refreshed.nominations.map(n=>({id:n.id,name:n.name,candidates:n.candidates.map(x=>x.display_name),candidateIds:Object.fromEntries(n.candidates.map(x=>[x.display_name,x.id])),top5:n.candidates.filter(x=>x.is_top5).map(x=>x.display_name)})));
    setSuggestion('');
    setStatus('Предложения сохранены в Supabase');
  };

  const refreshResults = async () => {
    const response = await fetch('/api/results',{headers:{'X-Telegram-Init-Data':initData}});
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'results_load_failed');
    setResults(data.results || []);
  };

  const refreshServerState = async () => {
    const response = await fetch('/api/state',{headers:{'X-Telegram-Init-Data':initData}});
    const data = await response.json();
    if (!response.ok || !data.slay) throw new Error(data.error || 'state_load_failed');
    const phaseLabels = { preparation:'Подготовка', candidates:'Кандидаты', voting:'Голосование', jury:'Жюри', awards:'Награждение' };
    setSlayId(data.slay.id);
    setPhaseEndsAt(data.slay.phase_ends_at);
    setPhase(phaseLabels[data.slay.current_phase] || 'Подготовка');
    setNominations(data.nominations.map(n=>({id:n.id,name:n.name,candidates:n.candidates.map(x=>x.display_name),candidateIds:Object.fromEntries(n.candidates.map(x=>[x.display_name,x.id])),top5:n.candidates.filter(x=>x.is_top5).map(x=>x.display_name)})));
    setTop5Selections(Object.fromEntries(data.nominations.map(n=>[n.id,n.candidates.filter(x=>x.is_top5).map(x=>x.id)])));
    setVotes(Object.fromEntries(data.nominations.map((n,i)=>[i,(data.myVotes||[]).filter(v=>v.nomination_id===n.id).map(v=>n.candidates.find(x=>x.id===v.candidate_id)?.display_name).filter(Boolean)])));
    setScores(Object.fromEntries(data.nominations.flatMap((n,i)=>(data.myScores||[]).filter(v=>v.nomination_id===n.id).map(v=>[i+':'+(n.candidates.find(x=>x.id===v.candidate_id)?.display_name||''),v.score]))));
  };
  const advancePhase = async nextPhase => {
    if(isTransitioning)return;
    if(!window.confirm('Подтвердить переход на следующий этап? Текущий этап будет закрыт.'))return;
    setIsTransitioning(true);
    try {
      const response = await fetch('/api/admin/phase',{method:'POST',headers:{'Content-Type':'application/json','X-Telegram-Init-Data':initData},body:JSON.stringify({phase:nextPhase,durationSeconds:Number(phaseDurationHours)>0 ? Number(phaseDurationHours)*3600 : null})});
      const result = await response.json();
      if(!response.ok) throw new Error(result.error || 'phase_update_failed');
      await refreshServerState();
      setStatus('Этап переключён и записан в журнал');
    } catch(error) { setStatus(error.message); }
    finally { setIsTransitioning(false); }
  };
  const saveTop5 = async nomination => {
    const candidateIds = top5Selections[nomination.id] || [];
    if(candidateIds.length!==5){setStatus('Выберите ровно пять кандидатов');return;}
    const response = await fetch('/api/admin/top5',{method:'POST',headers:{'Content-Type':'application/json','X-Telegram-Init-Data':initData},body:JSON.stringify({nominationId:nomination.id,candidateIds})});
    const result = await response.json();
    if(!response.ok){setStatus(result.error || 'Не удалось сохранить топ-5');return;}
    await refreshServerState();
    setStatus('Топ-5 сохранён');
  };

  return <main className="shell">
    <header className="top"><div className="brand"><div className="logo-wrap"><img src="https://raw.githubusercontent.com/appsbypojos/Music-SLAY/main/file_0000000003c88246aacceec2fd0dc323.png" alt="MUSIC SLAY 2026" /></div><div><b>MUSIC SLAY</b><small>Музыкальная премия · 2026</small></div></div><div className="header-right"><span className="pill"><span className="dot"/> {authStatus}</span>{role!=='Гость' && <span className="timer">{displayTimerLabel}</span>}</div></header>
    <section className="hero"><span className="eyebrow">THE AWARDS EXPERIENCE</span><h1>Твоя музыка.<br/><em>Твои победители.</em></h1><p>От предложений участников до церемонии награждения.</p></section>
    <section className="rolebar"><label>Пользователь</label><span>{telegramUser ? [telegramUser.firstName, telegramUser.username ? '@'+telegramUser.username : ''].filter(Boolean).join(' · ') : 'Не авторизован'}</span><span className="role-tag">{role}</span></section>
    
    {role!=='Гость' && <p className="hint phase-timer">{remainingMs===null ? 'До запуска премии:' : 'Окончание текущего этапа:'} {displayTimerLabel}</p>}
    {role==='Гость' && <section className="panel guest-panel"><div className="guest-countdown"><span className="eyebrow">MUSIC SLAY 2026</span><Clock3 className="guest-clock"/><h2>Премия готовится</h2><span className="guest-timer">{launchCountdownLabel}</span><p className="hint">Доступ к текущему этапу откроется после запуска. Откройте Mini App позже, чтобы участвовать.</p></div></section>}
    {role==='Администратор' && phase==='Подготовка' && <section className="panel" data-phase="Подготовка"><div className="sectionhead"><div><span className="eyebrow">START HERE</span><h2>Подготовка Slay</h2></div><ShieldCheck/></div><label>Название выпуска</label><input defaultValue="MUSIC SLAY 2026" disabled/><h3>Номинации</h3>{nominations.map(n=><div className="nomrow" key={n.name}><span>{n.name}</span><span className="muted">{n.candidates.length} демо-кандидатов</span></div>)}<p className="hint">Текущий этап и номинации загружаются из Supabase.</p>{role==='Администратор' && <div className="admin-controls"><label>Длительность следующего этапа (часы; 0 — без таймера)</label><input type="number" min="0" max="720" value={phaseDurationHours} onChange={e=>setPhaseDurationHours(e.target.value)}/><button className="primary" disabled={isTransitioning} onClick={()=>advancePhase('candidates')}>Начать сбор кандидатов</button></div>}</section>}
    {role==='Участник' && phase==='Подготовка' && <section className="panel guest-panel"><div className="guest-countdown"><span className="eyebrow">MUSIC SLAY 2026</span><Clock3 className="guest-clock"/><h2>Премия готовится</h2><span className="guest-timer">{launchCountdownLabel}</span><p className="hint">Сейчас идёт подготовка премии. Когда администратор откроет сбор кандидатов, здесь появится доступ к участию.</p></div></section>}\n    {role!=='Гость' && phase==='Кандидаты' && <section className="panel" data-phase="Кандидаты"><div className="sectionhead"><div><span className="eyebrow">NOMINATIONS</span><h2>Предложить кандидатов</h2></div><Music2/></div><div className="tabs">{nominations.map((n,i)=><button className={active===i?'tab selected':'tab'} onClick={()=>setActive(i)} key={n.name}>{n.name}</button>)}</div><h3>{current.name}</h3>{role==='Участник'?<><textarea value={suggestion} onChange={e=>setSuggestion(e.target.value)} placeholder={active===1?'Артист1 — Название трека1, Артист2 — Название трека2':'Артист1, Артист2, Исполнитель3'} /><button className="primary" onClick={addSuggestions}>Отправить предложения <ChevronRight size={17}/></button></>:<p className="hint">{role==='Гость'?'Для участия откройте Mini App в Telegram и пройдите проверку.':'Для этой роли отправка предложений недоступна.'}</p>}{current.candidates.map(c=><div className="candidate" key={c}>{c}</div>)}{role==='Администратор' && <div className="admin-controls"><h3>Выбрать топ-5 для этой номинации</h3>{current.candidates.map(c=><label className="candidate" key={c}><input type="checkbox" checked={(top5Selections[current.id]||[]).includes(current.candidateIds?.[c])} onChange={e=>setTop5Selections(s=>{const existing=s[current.id]||[];if(e.target.checked&&existing.length>=5){setStatus('Можно выбрать не более пяти кандидатов');return s;}return {...s,[current.id]:e.target.checked?[...existing,current.candidateIds[c]]:existing.filter(id=>id!==current.candidateIds[c])};})}/>{c}</label>)}<button className="primary" onClick={()=>saveTop5(current)}>Сохранить топ-5</button><button disabled={isTransitioning} onClick={()=>advancePhase('voting')}>Перейти к голосованию</button></div>}</section>}
    {role!=='Гость' && phase==='Голосование' && <section className="panel" data-phase="Голосование"><div className="sectionhead"><div><span className="eyebrow">YOUR CHOICE</span><h2>Голосование</h2></div><Check/></div><div className="tabs">{nominations.map((n,i)=><button className={active===i?'tab selected':'tab'} onClick={()=>setActive(i)} key={n.name}>{n.name}</button>)}</div><h3>{current.name}</h3><p className="hint">Топ-5 этой номинации. Списки и голоса не смешиваются.</p>{(current.top5 || []).map((c,i)=><button disabled={role!=='Участник'} className={'vote '+((votes[active]||[]).includes(c)?'chosen':'')} onClick={()=>toggleVote(c)} key={c}><span className="rank">{i+1}</span><span>{c}</span><span className="check">{(votes[active]||[]).includes(c)?'✓':'+'}</span></button>)}<button className="primary" disabled={role!=='Участник' || !current.id || !initData} onClick={async()=>{const candidateIds=(votes[active]||[]).map(name=>current.candidateIds?.[name]).filter(Boolean);const response=await fetch('/api/votes',{method:'POST',headers:{'Content-Type':'application/json','X-Telegram-Init-Data':initData},body:JSON.stringify({nominationId:current.id,candidateIds})});const result=await response.json();setStatus(response.ok?'Голос сохранён в Supabase':(result.error||'Ошибка сохранения голоса'));}}>Подтвердить выбор</button>{role==='Администратор' && <div className="admin-controls"><label>Длительность этапа жюри (часы)</label><input type="number" min="0" max="720" value={phaseDurationHours} onChange={e=>setPhaseDurationHours(e.target.value)}/><button disabled={isTransitioning} onClick={()=>advancePhase('jury')}>Завершить голосование и открыть жюри</button></div>}</section>}
    {role!=='Гость' && phase==='Жюри' && <section className="panel" data-phase="Жюри"><div className="sectionhead"><div><span className="eyebrow">JURY SCORE</span><h2>Оценивание жюри</h2></div><Trophy/></div><div className="tabs">{nominations.map((n,i)=><button className={active===i?'tab selected':'tab'} onClick={()=>setActive(i)} key={n.name}>{n.name}</button>)}</div>{(current.top5?.length ? current.top5 : current.candidates.slice(0,5)).map(c=><div className="score" key={c}><span>{c}</span><select disabled={role!=='Жюри' || !current.id || !initData} value={scores[active+':'+c]??0} onChange={async e=>{const score=Number(e.target.value);setScores(s=>({...s,[active+':'+c]:score}));const response=await fetch('/api/jury-score',{method:'POST',headers:{'Content-Type':'application/json','X-Telegram-Init-Data':initData},body:JSON.stringify({nominationId:current.id,candidateId:current.candidateIds?.[c],score})});if(!response.ok)setStatus('Не удалось сохранить оценку жюри');else setStatus('Оценка сохранена в Supabase');}}>{Array.from({length:11},(_,i)=><option key={i} value={i}>{i}/10</option>)}</select></div>)}<p className="hint">Итог: голоса пользователей + сумма отдельных голосов жюри. Каждый балл жюри добавляет 10% от голосов пользователей.</p>{role==='Администратор' && <div className="admin-controls"><label>Длительность награждения (часы)</label><input type="number" min="0" max="720" value={phaseDurationHours} onChange={e=>setPhaseDurationHours(e.target.value)}/><button disabled={isTransitioning} onClick={()=>advancePhase('awards')}>Завершить оценки и открыть награждение</button></div>}</section>}
    {role!=='Гость' && phase==='Награждение' && <section className="panel" data-phase="Награждение"><div className="sectionhead"><div><span className="eyebrow">THE WINNERS</span><h2>Церемония награждения</h2></div><Trophy/></div><div className="award"><span className="eyebrow">ПОБЕДИТЕЛЬ · {slide+1}/{winners.length}</span><Trophy size={42}/><h2>{winners[slide]?.category}</h2><h1>{winners[slide]?.winner}</h1><p className="hint">{results[slide]?.winner ? `Итог: ${results[slide].winner.finalScore} · пользователей: ${results[slide].winner.userVotes} · жюри: ${results[slide].winner.juryVotesTotal}` : 'Результаты пока не рассчитаны'}</p></div><div className="actions"><button onClick={()=>setSlide(s=>Math.max(0,s-1))}>Назад</button><button className="primary" onClick={()=>setSlideshow(s=>!s)}>{slideshow?'Пауза':'Запустить слайдшоу'}</button><button onClick={()=>setSlide(s=>(s+1)%winners.length)}>Далее</button></div><p className="hint">Результаты рассчитываются сервером по утверждённой формуле. Для каждого члена жюри расчёт выполняется отдельно.</p></section>}
    <footer><Clock3 size={15}/> MUSIC SLAY 2026 <span>· прототип с Telegram SDK</span></footer>
  </main>;
}
createRoot(document.getElementById('root')).render(<App/>);
