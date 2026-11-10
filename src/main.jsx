import React, { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createClient } from '@supabase/supabase-js';
import { Trophy, Music2, ShieldCheck, Eye, ChevronRight, Check, Clock3 } from 'lucide-react';
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
function App() {
  const [phase,setPhase] = useState('Подготовка');
  const [role,setRole] = useState('Участник');
  const [active,setActive] = useState(0);
  const [nominations,setNominations] = useState(seed);
  const [votes,setVotes] = useState({});
  const [suggestion,setSuggestion] = useState('');
  const [scores,setScores] = useState({});
  const [slideshow,setSlideshow] = useState(false);
  const [slide,setSlide] = useState(0);
  const [published,setPublished] = useState({});
  const [status,setStatus] = useState('Локальный режим');
  const current = nominations[active] || {name:'Нет номинаций',candidates:[]};
  const winners = useMemo(()=>nominations.map((n,i)=>({category:n.name,winner:n.candidates[0] || 'Победитель не определён'})),[nominations]);
  React.useEffect(()=>{
    if(!slideshow)return;
    const timer=setInterval(()=>setSlide(s=>(s+1)%Math.max(winners.length,1)),8000);
    return ()=>clearInterval(timer);
  },[slideshow,winners.length]);
  const toggleVote = name => setVotes(v=>({...v,[active]:(v[active]||[]).includes(name)?v[active].filter(x=>x!==name):[...(v[active]||[]),name]}));
  const addSuggestions = async () => {
    const values=suggestion.split(',').map(x=>x.trim()).filter(Boolean);
    if(!values.length)return;
    setNominations(old=>old.map((n,i)=>i===active?{...n,candidates:[...n.candidates,...values.filter(x=>!n.candidates.includes(x))]}:n));
    setSuggestion('');
    setStatus('Предложения добавлены в локальный интерфейс. Для серверного сохранения нужна настроенная база.');
  };
  return <main className="shell">
    <header className="top"><div className="brand"><div className="logo"><Music2/></div><div><b>MUSIC SLAY 2026</b><small>Музыкальная премия</small></div></div><span className="pill"><span className="dot"/> {status}</span></header>
    <section className="hero"><span className="eyebrow">THE AWARDS EXPERIENCE</span><h1>Твоя музыка.<br/><em>Твои победители.</em></h1><p>Пять этапов. От предложений участников до церемонии награждения.</p></section>
    <section className="rolebar"><label>Режим интерфейса</label><select value={role} onChange={e=>setRole(e.target.value)}><option>Участник</option><option>Жюри</option><option>Наблюдатель</option><option>Администратор</option></select></section>
    <nav className="phases">{phases.map((p,i)=><button key={p} className={phase===p?'phase active':'phase'} onClick={()=>setPhase(p)}><span>{String(i+1).padStart(2,'0')}</span>{p}</button>)}</nav>
    {phase==='Подготовка' && <section className="panel"><div className="sectionhead"><div><span className="eyebrow">START HERE</span><h2>Подготовка Slay</h2></div><ShieldCheck/></div><label>Название выпуска</label><input defaultValue="MUSIC SLAY 2026" disabled={role!=='Администратор'}/><h3>Номинации</h3>{nominations.map((n,i)=><div className="nomrow" key={n.name}><span>{n.name}</span><span className="muted">{n.candidates.length} кандидатов</span></div>)}<p className="hint">Управление выпуском и номинациями доступно главному администратору после подключения Telegram-авторизации.</p></section>}
    {phase==='Кандидаты' && <section className="panel"><div className="sectionhead"><div><span className="eyebrow">NOMINATIONS</span><h2>Предложить кандидатов</h2></div><Music2/></div><div className="tabs">{nominations.map((n,i)=><button className={active===i?'tab selected':'tab'} onClick={()=>setActive(i)} key={n.name}>{n.name}</button>)}</div><h3>{current.name}</h3>{role==='Участник'?<><textarea value={suggestion} onChange={e=>setSuggestion(e.target.value)} placeholder={active===1?'Артист1 — Название трека1, Артист2 — Название трека2':'Артист1, Артист2, Артист3'} /><button className="primary" onClick={addSuggestions}>Отправить предложения <ChevronRight size={17}/></button></>:<p className="hint">Просмотр списка кандидатов.</p>}{current.candidates.map(c=><div className="candidate" key={c}>{c}<Check size={16}/></div>)}</section>}
    {phase==='Голосование' && <section className="panel"><div className="sectionhead"><div><span className="eyebrow">YOUR CHOICE</span><h2>Голосование</h2></div><Check/></div><div className="tabs">{nominations.map((n,i)=><button className={active===i?'tab selected':'tab'} onClick={()=>setActive(i)} key={n.name}>{n.name}</button>)}</div><h3>{current.name}</h3><p className="hint">Топ-5 этой номинации. Списки и голоса не смешиваются.</p>{current.candidates.slice(0,5).map((c,i)=><button disabled={role!=='Участник'} className={'vote '+((votes[active]||[]).includes(c)?'chosen':'')} onClick={()=>toggleVote(c)} key={c}><span className="rank">{i+1}</span><span>{c}</span><span className="check">{(votes[active]||[]).includes(c)?'✓':'+'}</span></button>)}<button className="primary" onClick={()=>setStatus('Голосование сохранено локально')}>Подтвердить выбор</button></section>}
    {phase==='Жюри' && <section className="panel"><div className="sectionhead"><div><span className="eyebrow">JURY SCORE</span><h2>Оценивание жюри</h2></div><Trophy/></div><div className="tabs">{nominations.map((n,i)=><button className={active===i?'tab selected':'tab'} onClick={()=>setActive(i)} key={n.name}>{n.name}</button>)}</div>{current.candidates.slice(0,5).map(c=><div className="score" key={c}><span>{c}</span><select disabled={role!=='Жюри'} value={scores[active+':'+c]??0} onChange={e=>setScores(s=>({...s,[active+':'+c]:Number(e.target.value)}))}>{Array.from({length:11},(_,i)=><option key={i} value={i}>{i}/10</option>)}</select></div>)}<p className="hint">Итоговая формула голосов и оценок жюри требует утверждения.</p></section>}
    {phase==='Награждение' && <section className="panel"><div className="sectionhead"><div><span className="eyebrow">THE WINNERS</span><h2>Церемония награждения</h2></div><Trophy/></div><div className="award"><span className="eyebrow">ПОБЕДИТЕЛЬ · {slide+1}/{winners.length}</span><Trophy size={42}/><h2>{winners[slide]?.category}</h2><h1>{winners[slide]?.winner}</h1></div><div className="actions"><button onClick={()=>setSlide(s=>Math.max(0,s-1))}>Назад</button><button className="primary" onClick={()=>setSlideshow(s=>!s)}>{slideshow?'Пауза':'Запустить слайдшоу'}</button><button onClick={()=>setSlide(s=>(s+1)%winners.length)}>Далее</button></div><p className="hint">Демонстрационные победители. Автопереключение каждые 8 секунд; реальные результаты появятся после подключения формулы и БД.</p></section>}
    <footer><Clock3 size={15}/> MUSIC SLAY 2026 <span>· прототип интерфейса</span></footer>
  </main>;
}
createRoot(document.getElementById('root')).render(<App/>);