// @ts-nocheck
import React, { Component, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  Award,
  Check,
  Clock3,
  Crown,
  Gauge,
  ListMusic,
  LoaderCircle,
  Lock,
  Pause,
  Play,
  RefreshCw,
  Save,
  Send,
  ShieldCheck,
  Sparkles,
  Trophy,
  Users,
  Vote,
  X,
} from "lucide-react";
import "./styles.css";

const PHASES = [
  { id: "preparation", label: "Подготовка", short: "Старт" },
  { id: "candidates", label: "Кандидаты", short: "Имена" },
  { id: "voting", label: "Голосование", short: "Голос" },
  { id: "jury", label: "Жюри", short: "Жюри" },
  { id: "awards", label: "Награждение", short: "Финал" },
];

const ROLE_NAMES = {
  admin: "Администратор",
  jury: "Жюри",
  participant: "Участник",
  observer: "Наблюдатель",
};

const ADMIN_TABS = [
  { id: "nominations", label: "Номинации", icon: ListMusic },
  { id: "candidates", label: "Кандидаты и топ-5", icon: Users },
  { id: "votes", label: "Голоса", icon: Activity },
  { id: "voters", label: "Голосующие", icon: Users },
  { id: "jury", label: "Состав жюри", icon: ShieldCheck },
  { id: "phases", label: "Этапы", icon: Gauge },
  { id: "results", label: "Результаты", icon: Trophy },
];

const PHASE_WARN = {
  candidates: "Откроется сбор имён. Номинации ещё можно править, пока не начнётся голосование.",
  voting: "Сбор закроется, номинации заблокируются. В каждой должно быть ровно пять кандидатов топа — иначе сервер отклонит переход.",
  jury: "Голоса участников закроются. Жюри поставит оценки только топ-5.",
  awards: "Оценки закроются. Все увидят церемонию и итоговый счёт.",
};

const ERRORS = {
  phase_closed: "Этап закрыт или его время вышло",
  forbidden: "Недостаточно прав для этого действия",
  unauthorized: "Сессия не подтверждена. Открой мини-приложение заново",
  invalid_or_expired_telegram_init_data: "Данные Telegram устарели. Закрой и открой приложение снова",
  nominations_locked: "Номинации меняются только на этапе подготовки",
  top5_required: "Сначала зафиксируй топ-5 во всех номинациях",
  invalid_phase_transition: "Можно перейти только на следующий этап",
  too_many_votes: "Не больше пяти кандидатов",
  invalid_duration: "Длительность: без таймера или от 1 минуты до 30 дней",
  invalid_names: "От 1 до 20 имён, каждое от 2 символов",
  invalid_candidate: "Этот кандидат не в топ-5 номинации",
  invalid_score: "Оценка — целое число от 0 до 10",
  invalid_top5: "Нужны ровно пять разных кандидатов",
  duplicate_candidate: "В топ-5 не должно быть повторов",
  invalid_nominations: "Нужны 1–20 уникальных названий по 2–100 символов",
  request_failed: "Сервер не ответил. Попробуй ещё раз",
  telegram_not_configured: "Бот на сервере ещё не настроен",
  slay_not_found: "Премия не найдена",
  origin_not_allowed: "Запрос отклонён",
};

const DEADLINE = new Date("2026-12-07T00:00:00+03:00");
const HOUR_PRESETS = [0, 6, 12, 24, 48, 72];

function cx(...parts) {
  return parts.filter(Boolean).join(" ");
}

function humanError(error) {
  const raw = error?.message || "request_failed";
  return ERRORS[raw] || raw;
}

function byPopularity(a, b) {
  return b.count - a.count || a.name.localeCompare(b.name, "ru");
}

function sameIds(a = [], b = []) {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
}

function parseNames(value) {
  const seen = new Set();
  const names = [];
  for (const part of String(value || "").split(",")) {
    const name = part.trim().replace(/\s+/g, " ");
    if (name.length < 2 || name.length > 160) continue;
    const key = name.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
    if (names.length === 20) break;
  }
  return names;
}

function top5Patches(nominations) {
  const patches = [];
  for (const nomination of nominations) {
    if (nomination.candidates.length < 5) continue;
    const ranked = [...nomination.candidates].sort(byPopularity).slice(0, 5);
    const desiredIds = ranked.map((c) => c.id);
    const desired = [...desiredIds].sort().join("|");
    const existing = nomination.candidates.filter((c) => c.top5).map((c) => c.id).sort().join("|");
    if (desired !== existing) patches.push({ nominationId: nomination.id, candidateIds: desiredIds });
  }
  return patches;
}

function applyPatches(nominations, patches) {
  if (!patches.length) return nominations;
  const byNom = new Map(patches.map((p) => [p.nominationId, new Set(p.candidateIds)]));
  return nominations.map((nomination) => {
    const set = byNom.get(nomination.id);
    if (!set) return nomination;
    return {
      ...nomination,
      candidates: nomination.candidates.map((c) => ({ ...c, top5: set.has(c.id) })),
    };
  });
}

function ballotOf(nomination) {
  return nomination.candidates.filter((c) => c.top5).sort(byPopularity);
}

function splitCountdown(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return [Math.floor(s / 86400), Math.floor((s % 86400) / 3600), Math.floor((s % 3600) / 60), s % 60];
}

function formatRemain(ms) {
  const [d, h, m, s] = splitCountdown(ms);
  if (d > 0) return `${d} д ${h} ч`;
  if (h > 0) return `${h} ч ${String(m).padStart(2, "0")} мин`;
  return `${m} мин ${String(s).padStart(2, "0")} сек`;
}

function haptic(kind) {
  try {
    const hf = window.Telegram?.WebApp?.HapticFeedback;
    if (!hf) return;
    if (kind === "success" || kind === "error") hf.notificationOccurred(kind);
    else hf.impactOccurred("light");
  } catch {
    /* outside Telegram */
  }
}

function seedNominations() {
  const rows = [
    ["artist", "Артист года", [["n1a", "МАЙЯ ВОЛЬТ", 42], ["n1b", "СЕВЕРНЫЙ ПОРТ", 37], ["n1c", "КИРИЛЛ ДЫМ", 31], ["n1d", "АУРА 404", 28], ["n1e", "ТИХИЙ РЕЙВ", 22], ["n1f", "ЛУНА ПАРК", 14], ["n1g", "СОФТ ГОЛД", 9]]],
    ["track", "Трек года", [["n2a", "Ночной контур", 51], ["n2b", "Стекло и мёд", 44], ["n2c", "Пульс города", 33], ["n2d", "Тихий рейс", 27], ["n2e", "После полуночи", 19], ["n2f", "Белый шум", 11]]],
    ["album", "Альбом года", [["n3a", "Северный порт", 29], ["n3b", "Комната без окон", 26], ["n3c", "Четвёртый берег", 21], ["n3d", "Мягкий фокус", 18], ["n3e", "Домашний сигнал", 12], ["n3f", "Поле", 7]]],
    ["break", "Прорыв года", [["n4a", "СОФТ ГОЛД", 36], ["n4b", "ВЕЧЕРНИЙ КАДР", 30], ["n4c", "НИНА МОРОЗ", 24], ["n4d", "ПЛЕНКА 16", 17], ["n4e", "ЮЖНЫЙ ВХОД", 13], ["n4f", "КАССЕТА", 6]]],
    ["collab", "Коллаборация года", [["n5a", "Вольт × Порт", 33], ["n5b", "Дым и Аура", 25], ["n5c", "Луна × Голд", 20], ["n5d", "Рейв × Кадр", 15], ["n5e", "Порт × Мороз", 10], ["n5f", "Плёнка × Рейс", 4]]],
    ["stream", "Стример года", [["n6a", "НОЧНОЙ ЭФИР", 47], ["n6b", "СТУДИЯ 4", 39], ["n6c", "ТИХИЙ ЧАТ", 28], ["n6d", "ПЯТЫЙ КАНАЛ", 23], ["n6e", "ДОМАШНИЙ СВЕТ", 16], ["n6f", "ПУСТАЯ СЦЕНА", 8]]],
  ];
  return rows.map(([id, name, people]) => ({
    id,
    name,
    candidates: people.map(([cid, cname, count]) => ({ id: cid, name: cname, count, top5: false })),
  }));
}

function seededNominations() {
  return applyPatches(seedNominations(), top5Patches(seedNominations()));
}

function seedScores() {
  return { "artist:n1a": 9, "artist:n1b": 8, "artist:n1d": 7, "track:n2a": 10, "track:n2b": 8 };
}

function seedVotes() {
  return { artist: ["n1a", "n1c"], track: ["n2a"] };
}

function seedAudit() {
  const stamp = new Date("2026-11-12T18:40:00+03:00").toISOString();
  return [
    { id: "v1", nomination: "Артист года", voter: "10488211", candidate: "МАЙЯ ВОЛЬТ", vote_count: 18, created_at: stamp },
    { id: "v2", nomination: "Артист года", voter: "22819004", candidate: "СЕВЕРНЫЙ ПОРТ", vote_count: 14, created_at: stamp },
    { id: "v3", nomination: "Трек года", voter: "551902", candidate: "Ночной контур", vote_count: 22, created_at: stamp },
    { id: "v4", nomination: "Стример года", voter: "7731209", candidate: "НОЧНОЙ ЭФИР", vote_count: 19, created_at: stamp },
    { id: "v5", nomination: "Прорыв года", voter: "441278", candidate: "СОФТ ГОЛД", vote_count: 11, created_at: stamp },
    { id: "v6", nomination: "Коллаборация года", voter: "990124", candidate: "Вольт × Порт", vote_count: 9, created_at: stamp },
  ];
}

function computeResults(nominations, scores) {
  return nominations.map((nomination) => {
    const pool = ballotOf(nomination);
    const source = pool.length ? pool : [...nomination.candidates].sort(byPopularity);
    const candidates = source.map((candidate) => {
      const userVotes = candidate.count;
      const juryScore = scores[`${nomination.id}:${candidate.id}`];
      const applied = Number.isInteger(juryScore) ? juryScore : 0;
      const juryVotesTotal = (userVotes * applied) / 10;
      return {
        candidate: candidate.name,
        userVotes,
        juryVotesTotal: Math.round(juryVotesTotal * 10) / 10,
        finalScore: Math.round((userVotes + juryVotesTotal) * 10) / 10,
      };
    }).sort((a, b) => b.finalScore - a.finalScore || b.userVotes - a.userVotes || a.candidate.localeCompare(b.candidate, "ru"));
    return { nomination: nomination.name, nominationId: nomination.id, winner: candidates[0] || null, candidates };
  });
}

function personalVoteRows(nominations, votes) {
  const rows = [];
  for (const nomination of nominations) {
    for (const id of votes[nomination.id] || []) {
      const candidate = nomination.candidates.find((c) => c.id === id);
      if (!candidate) continue;
      rows.push({
        id: `me-${nomination.id}-${id}`,
        nomination: nomination.name,
        voter: "90000001",
        candidate: candidate.name,
        vote_count: 1,
        created_at: new Date().toISOString(),
      });
    }
  }
  return rows;
}

async function request(path, initData, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(initData ? { "X-Telegram-Init-Data": initData } : {}),
      ...options.headers,
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "request_failed");
  return data;
}

function mapState(data) {
  const source = data.nominations || [];
  return {
    slay: data.slay,
    nominations: source.map((n) => ({
      id: n.id,
      name: n.name,
      candidates: (n.candidates || []).map((c) => ({
        id: c.id,
        name: c.display_name,
        count: Number(c.suggestion_count || 0),
        top5: Boolean(c.is_top5),
      })),
    })),
    myVotes: data.myVotes || [],
    myScores: data.myScores || [],
  };
}

function IconButton({ label, children, ...props }) {
  return (
    <button type="button" className="icon-btn" aria-label={label} {...props}>
      {children}
    </button>
  );
}

function Mark() {
  return <span className="ms-mark" aria-hidden="true">MS</span>;
}

function TopBar({ user, role, admin }) {
  return (
    <header className="topbar">
      <div className="brand">
        <Mark />
        <span>
          <strong>MUSIC SLAY</strong>
          <small>{admin ? "CONTROL ROOM" : "2026"}</small>
        </span>
      </div>
      <div className="who">
        <b>{user?.firstName || (admin ? "Admin" : "Гость")}</b>
        <small>{ROLE_NAMES[role] || "Нет доступа"}</small>
      </div>
    </header>
  );
}

function PhaseRail({ phase }) {
  const index = Math.max(0, PHASES.findIndex((item) => item.id === phase));
  return (
    <div className="phase-rail" aria-label="Этапы премии">
      <div className="phase-nodes">
        {PHASES.map((item, i) => (
          <div key={item.id} className={cx("phase-node", i < index && "is-done", i === index && "is-now")}>
            <span>{i < index ? <Check size={12} /> : i + 1}</span>
            <small>{item.short}</small>
          </div>
        ))}
      </div>
    </div>
  );
}

function Countdown({ now }) {
  const parts = now ? splitCountdown(DEADLINE.getTime() - now) : [null, null, null, null];
  return (
    <div className="countdown" aria-label="До 7 декабря 2026">
      {parts.map((value, index) => (
        <div className="count-cell" key={index}>
          <strong suppressHydrationWarning>{value === null ? "—" : String(value).padStart(2, "0")}</strong>
          <span>{["дни", "часы", "мин", "сек"][index]}</span>
        </div>
      ))}
    </div>
  );
}

function NominationChips({ nominations, active, onPick }) {
  const ref = useRef(null);
  useEffect(() => {
    const parent = ref.current;
    const node = parent?.querySelector('[data-active="true"]');
    if (!parent || !node) return;
    const target = node.offsetLeft - (parent.clientWidth - node.offsetWidth) / 2;
    parent.scrollTo({ left: Math.max(0, target) });
  }, [active]);
  if (!nominations.length) return null;
  return (
    <div className="chips" ref={ref} role="tablist" aria-label="Номинации">
      {nominations.map((nomination, index) => (
        <button
          key={nomination.id}
          type="button"
          role="tab"
          data-active={index === active}
          aria-selected={index === active}
          className={cx("chip", index === active && "is-on")}
          onClick={() => onPick(index)}
        >
          {nomination.name}
        </button>
      ))}
    </div>
  );
}

function Progress({ done, total, label }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className="progress-block">
      <div className="progress-meta"><span>{label}</span><b>{done}/{total}</b></div>
      <div className="progress" aria-hidden="true"><span style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

function Empty({ icon, title, text, action }) {
  return (
    <div className="empty">
      {icon}
      <h3>{title}</h3>
      {text ? <p>{text}</p> : null}
      {action}
    </div>
  );
}

function Notice({ children }) {
  return <div className="notice"><ShieldCheck size={16} /><p>{children}</p></div>;
}

function Ceremony({ rows, slide, setSlide, playing, setPlaying }) {
  const row = rows[slide];
  if (!rows.length || !row) {
    return (
      <Empty
        icon={<Trophy size={28} />}
        title="Победители ещё не посчитаны"
        text="Когда сервер отдаст /api/results, имена появятся здесь."
      />
    );
  }
  const winner = row.winner;
  return (
    <section className="ceremony" aria-live="polite">
      <p className="kicker"><span className="live-dot" /> Церемония · {String(slide + 1).padStart(2, "0")} / {String(rows.length).padStart(2, "0")}</p>
      <div className="ceremony-stage" key={row.nominationId || row.nomination}>
        <Crown size={22} />
        <p className="ceremony-nom">{row.nomination}</p>
        <h2 className="ceremony-winner">{winner?.candidate || "Победитель не определён"}</h2>
        <div className="ceremony-stats">
          <span>Итог <b>{winner?.finalScore ?? "—"}</b></span>
          <span>Голоса <b>{winner?.userVotes ?? "—"}</b></span>
          <span>Жюри <b>{winner?.juryVotesTotal ?? winner?.juryVotes ?? "—"}</b></span>
        </div>
      </div>
      <div className="ceremony-nav">
        <IconButton label="Предыдущий победитель" onClick={() => { setPlaying(false); setSlide((s) => (s - 1 + rows.length) % rows.length); }}>
          <ArrowLeft size={18} />
        </IconButton>
        <div className="dots">
          {rows.map((item, index) => (
            <button key={item.nominationId || item.nomination} type="button" className={cx("dot", index === slide && "is-on")} aria-label={item.nomination} onClick={() => { setPlaying(false); setSlide(index); }} />
          ))}
        </div>
        <IconButton label="Следующий победитель" onClick={() => { setPlaying(false); setSlide((s) => (s + 1) % rows.length); }}>
          <ArrowRight size={18} />
        </IconButton>
        <button type="button" className="btn ghost play" onClick={() => setPlaying((v) => !v)}>
          {playing ? <Pause size={15} /> : <Play size={15} />}
          {playing ? "Пауза" : "Слайдшоу"}
        </button>
      </div>
    </section>
  );
}

class AppErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error) {
    console.error("[MUSIC SLAY] React render failed:", error);
  }
  render() {
    if (this.state.failed) {
      return (
        <main className="ms-boot" role="alert">
          <Mark />
          <p className="kicker">MUSIC SLAY 2026</p>
          <h1>Не удалось открыть экран</h1>
          <p>Ошибка интерфейса. Закрой мини-приложение и открой его снова. Если ошибка повторится, сообщи администратору.</p>
        </main>
      );
    }
    return this.props.children;
  }
}

export function App() {
  const initialNoms = useMemo(() => seededNominations(), []);
  const [mode, setMode] = useState("demo");
  const [initData, setInitData] = useState("");
  const [user, setUser] = useState({ firstName: "Алекс", username: "preview" });
  const [role, setRole] = useState("participant");
  const [auth, setAuth] = useState("Режим просмотра");
  const [phase, setPhase] = useState("preparation");
  const [phaseEndsAt, setPhaseEndsAt] = useState(null);
  const [nominations, setNominations] = useState(initialNoms);
  const [draft, setDraft] = useState(() => initialNoms.map((n) => ({ id: n.id, name: n.name })));
  const [active, setActive] = useState(0);
  const [texts, setTexts] = useState({});
  const [votes, setVotes] = useState(seedVotes);
  const [committed, setCommitted] = useState(seedVotes);
  const [scores, setScores] = useState(seedScores);
  const [scoreState, setScoreState] = useState({});
  const [adminVotes, setAdminVotes] = useState(seedAudit);
  const [adminVoters, setAdminVoters] = useState([]);
  const [juryMembers, setJuryMembers] = useState([]);
  const [juryTelegramId, setJuryTelegramId] = useState("");
  const [juryDisplayName, setJuryDisplayName] = useState("");
  const [votesUpdated, setVotesUpdated] = useState(null);
  const [results, setResults] = useState([]);
  const [adminTab, setAdminTab] = useState("nominations");
  const [scheduleAt, setScheduleAt] = useState("");
  const [busy, setBusy] = useState("");
  const [toast, setToast] = useState(null);
  const [now, setNow] = useState(null);
  const [slide, setSlide] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [studioOpen, setStudioOpen] = useState(false);
  const toastTimer = useRef(0);
  const modeRef = useRef(mode);
  const initRef = useRef("");
  modeRef.current = mode;
  initRef.current = initData;

  const notify = useCallback((message, type = "success") => {
    setToast({ message, type });
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3200);
    haptic(type === "error" ? "error" : "success");
  }, []);

  const applyState = useCallback((data) => {
    const mapped = mapState(data);
    setNominations(mapped.nominations);
    setDraft(mapped.nominations.map((n) => ({ id: n.id, name: n.name })));
    if (mapped.slay) {
      setPhase(mapped.slay.current_phase || "preparation");
      setPhaseEndsAt(mapped.slay.phase_ends_at || null);
    }
    const nextVotes = Object.fromEntries(mapped.nominations.map((n) => [
      n.id,
      mapped.myVotes.filter((v) => v.nomination_id === n.id).map((v) => v.candidate_id),
    ]));
    setVotes(nextVotes);
    setCommitted(nextVotes);
    const nextScores = {};
    for (const nomination of mapped.nominations) {
      for (const row of mapped.myScores.filter((v) => v.nomination_id === nomination.id)) {
        nextScores[`${nomination.id}:${row.candidate_id}`] = Number(row.score);
      }
    }
    setScores(nextScores);
    setActive((index) => Math.min(index, Math.max(mapped.nominations.length - 1, 0)));
  }, []);

  const refreshState = useCallback(async () => {
    if (!initRef.current) return;
    applyState(await request("/api/state", initRef.current));
  }, [applyState]);

  const refreshResults = useCallback(async () => {
    if (modeRef.current === "demo") {
      setResults(computeResults(nominations, scores));
      return;
    }
    if (!initRef.current) return;
    const data = await request("/api/results", initRef.current);
    setResults(data.results || []);
  }, [nominations, scores]);

  const refreshJury = useCallback(async () => {
    if (modeRef.current === "demo" || !initRef.current) return;
    const data = await request("/api/admin/jury", initRef.current);
    setJuryMembers(data.members || []);
  }, []);

  const addJuryMember = () => run("jury-add", async () => {
    const telegramId = juryTelegramId.trim();
    if (!/^\d{1,20}$/.test(telegramId)) throw new Error("Укажи корректный числовой Telegram ID");
    if (modeRef.current === "demo") setJuryMembers((rows) => [...rows.filter((row) => row.telegram_id !== telegramId), { telegram_id: telegramId, display_name: juryDisplayName.trim() }]);
    else { await request("/api/admin/jury", initRef.current, { method: "POST", body: JSON.stringify({ telegramId, displayName: juryDisplayName.trim() }) }); await refreshJury(); }
    setJuryTelegramId(""); setJuryDisplayName("");
  }, "Член жюри добавлен");

  const removeJuryMember = (telegramId) => run("jury-remove", async () => {
    if (modeRef.current === "demo") setJuryMembers((rows) => rows.filter((row) => row.telegram_id !== telegramId));
    else { await request("/api/admin/jury", initRef.current, { method: "DELETE", body: JSON.stringify({ telegramId }) }); await refreshJury(); }
  }, "Член жюри удалён");

  const refreshVotes = useCallback(async () => {
    if (modeRef.current === "demo") {
      setAdminVotes([...seedAudit(), ...personalVoteRows(nominations, committed)]);
      setVotesUpdated(Date.now());
      return;
    }
    if (!initRef.current) return;
    const [data, votersData] = await Promise.all([request("/api/admin/votes", initRef.current), request("/api/admin/voters", initRef.current)]);
    setAdminVotes(data.votes || []);
    setAdminVoters(votersData.voters || []);
    setVotesUpdated(Date.now());
  }, [nominations, committed]);

  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    setNow(Date.now());
    return () => window.clearInterval(tick);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const root = document.getElementById("root");
    if (root) root.dataset.app = "mounted";

    const start = async () => {
      // Telegram's SDK is loaded asynchronously so a slow CDN cannot block
      // the app's module script and leave the static loading screen forever.
      if (!window.Telegram?.WebApp) {
        const sdk = document.getElementById("telegram-webapp-sdk");
        if (sdk) {
          await new Promise((resolve) => {
            let settled = false;
            const finish = () => {
              if (settled) return;
              settled = true;
              window.clearTimeout(timer);
              resolve();
            };
            const timer = window.setTimeout(finish, 2500);
            sdk.addEventListener("load", finish, { once: true });
            sdk.addEventListener("error", finish, { once: true });
          });
        }
      }
      if (cancelled) return;
      const tg = window.Telegram?.WebApp;
      const data = tg?.initData || "";
      if (!data) {
        setMode("demo");
        setAuth("Режим просмотра");
        setRole("participant");
        return;
      }
      setMode("boot");
      setAuth("Проверяем сессию…");
      try {
        tg.ready();
        tg.expand();
        tg.setHeaderColor?.("#07060b");
        tg.setBackgroundColor?.("#07060b");
      } catch { /* older clients */ }
      setInitData(data);
      initRef.current = data;
      try {
        const session = await request("/api/telegram/session", "", {
          method: "POST",
          body: JSON.stringify({ initData: data }),
        });
        if (cancelled) return;
        setUser(session.user || null);
        setRole(ROLE_NAMES[session.role] ? session.role : "");
        applyState(await request("/api/state", data));
        if (cancelled) return;
        setMode("live");
        setAuth("Сессия подтверждена");
      } catch (error) {
        if (cancelled) return;
        setRole("");
        setMode("denied");
        setAuth(humanError(error));
      }
    };

    start();
    return () => { cancelled = true; };
  }, [applyState]);

  useEffect(() => {
    if (mode !== "live" || phase !== "candidates" || !initData) return;
    const id = window.setInterval(() => { refreshState().catch(() => {}); }, 5000);
    return () => window.clearInterval(id);
  }, [mode, phase, initData, refreshState]);

  useEffect(() => {
    if (role !== "admin" || (mode !== "live" && mode !== "demo")) return;
    let stop = false;
    const tick = () => {
      if (stop || document.hidden) return;
      refreshVotes().catch((error) => { if (mode === "live") notify(humanError(error), "error"); });
    };
    tick();
    const id = window.setInterval(tick, 2500);
    return () => { stop = true; window.clearInterval(id); };
  }, [role, mode, refreshVotes, notify]);

  useEffect(() => {
    if (role !== "admin" || phase !== "candidates") return;
    const patches = top5Patches(nominations);
    if (!patches.length) return;
    const handle = window.setTimeout(async () => {
      if (modeRef.current === "demo") {
        setNominations((current) => applyPatches(current, top5Patches(current)));
        return;
      }
      try {
        for (const patch of patches) {
          await request("/api/admin/top5", initRef.current, {
            method: "POST",
            body: JSON.stringify(patch),
          });
        }
        await refreshState();
      } catch (error) {
        notify(humanError(error), "error");
      }
    }, 700);
    return () => window.clearTimeout(handle);
  }, [role, phase, nominations, refreshState, notify]);

  useEffect(() => {
    if (mode === "demo" && phase === "awards") setResults(computeResults(nominations, scores));
  }, [mode, phase, nominations, scores]);

  useEffect(() => {
    if (role !== "admin" || adminTab !== "jury" || mode !== "live") return;
    refreshJury().catch((error) => notify(humanError(error), "error"));
  }, [role, adminTab, mode, refreshJury, notify]);

  useEffect(() => {
    if (mode !== "live" || !initData) return;
    if (phase === "awards" || (role === "admin" && adminTab === "results")) {
      refreshResults().catch((error) => notify(humanError(error), "error"));
    }
  }, [mode, initData, phase, role, adminTab, refreshResults, notify]);

  useEffect(() => {
    if (phase === "awards" && role !== "admin") setPlaying(true);
  }, [phase, role]);

  useEffect(() => {
    const ceremony = role !== "admin" && phase === "awards" && playing && results.length > 1;
    if (!ceremony) return;
    const id = window.setInterval(() => setSlide((s) => (s + 1) % results.length), 5200);
    return () => window.clearInterval(id);
  }, [playing, results.length, phase, role]);

  useEffect(() => {
    if (slide >= results.length) setSlide(0);
  }, [slide, results.length]);

  useEffect(() => {
    if (!confirm) return undefined;
    const onKey = (event) => { if (event.key === "Escape") setConfirm(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirm]);

  const run = useCallback(async (key, action, success) => {
    if (busy) return;
    setBusy(key);
    try {
      await action();
      if (success) notify(success);
    } catch (error) {
      notify(humanError(error), "error");
    } finally {
      setBusy("");
    }
  }, [busy, notify]);

  const current = nominations[active] || null;
  const phaseMeta = PHASES.find((item) => item.id === phase) || PHASES[0];
  const phaseIndex = PHASES.findIndex((item) => item.id === phase);
  const nextPhase = PHASES[phaseIndex + 1] || null;
  const selected = current ? (votes[current.id] || []) : [];
  const savedSelected = current ? (committed[current.id] || []) : [];
  const dirtyVote = current ? !sameIds(selected, savedSelected) : false;
  const suggestion = current ? (texts[current.id] || "") : "";
  const parsed = parseNames(suggestion);
  const phaseRemaining = phaseEndsAt && now ? Math.max(0, new Date(phaseEndsAt).getTime() - now) : null;
  const isAdmin = role === "admin";

  const votedCount = nominations.filter((n) => (committed[n.id] || []).length).length;
  const juryStats = useMemo(() => {
    let total = 0;
    let done = 0;
    for (const nomination of nominations) {
      for (const candidate of ballotOf(nomination)) {
        total += 1;
        if (Number.isInteger(scores[`${nomination.id}:${candidate.id}`])) done += 1;
      }
    }
    return { total, done };
  }, [nominations, scores]);

  const top5Ready = nominations.length > 0 && nominations.every((n) => n.candidates.filter((c) => c.top5).length === 5);
  const missingTop5 = nominations.filter((n) => n.candidates.filter((c) => c.top5).length !== 5).map((n) => n.name);

  function durationSeconds() {
    if (!scheduleAt) return null;
    const target = new Date(scheduleAt).getTime();
    const seconds = Math.ceil((target - Date.now()) / 1000);
    if (!Number.isFinite(target) || seconds < 60 || seconds > 31622400) throw new Error("Выбери дату и время минимум через минуту, не дальше чем через год");
    return seconds;
  }

  function moveNomination(delta) {
    setActive((index) => Math.min(Math.max(index + delta, 0), Math.max(nominations.length - 1, 0)));
  }

  function toggleVote(id) {
    if (!current || role !== "participant") return;
    setVotes((prev) => {
      const existing = prev[current.id] || [];
      if (existing.includes(id)) return { ...prev, [current.id]: existing.filter((item) => item !== id) };
      if (existing.length >= 5) {
        notify("Можно выбрать не больше пяти", "error");
        return prev;
      }
      haptic("light");
      return { ...prev, [current.id]: [...existing, id] };
    });
  }

  function submitSuggestions() {
    if (!current) return;
    run("suggestions", async () => {
      const names = parseNames(texts[current.id] || "");
      if (!names.length) throw new Error("Введи хотя бы одно имя от 2 символов");
      if (modeRef.current === "demo") {
        setNominations((list) => list.map((nomination) => {
          if (nomination.id !== current.id) return nomination;
          const candidates = nomination.candidates.map((c) => ({ ...c }));
          for (const name of names) {
            const found = candidates.find((c) => c.name.toLocaleLowerCase() === name.toLocaleLowerCase());
            if (found) found.count += 1;
            else candidates.push({ id: `local-${nomination.id}-${candidates.length}`, name, count: 1, top5: false });
          }
          return { ...nomination, candidates };
        }));
      } else {
        await request("/api/submissions", initRef.current, {
          method: "POST",
          body: JSON.stringify({ nominationId: current.id, names }),
        });
        await refreshState();
      }
      setTexts((prev) => ({ ...prev, [current.id]: "" }));
    }, namesLabel(parsed.length));
  }

  function saveVote() {
    if (!current) return;
    run("vote", async () => {
      const candidateIds = selected.filter((id) => current.candidates.some((c) => c.id === id && c.top5));
      if (modeRef.current === "demo") {
        setCommitted((prev) => ({ ...prev, [current.id]: candidateIds }));
        setVotes((prev) => ({ ...prev, [current.id]: candidateIds }));
        return;
      }
      await request("/api/votes", initRef.current, {
        method: "POST",
        body: JSON.stringify({ nominationId: current.id, candidateIds }),
      });
      await refreshState();
    }, "Голос сохранён");
  }

  function saveScore(nomination, candidate, score) {
    if (role !== "jury") return;
    const key = `${nomination.id}:${candidate.id}`;
    setScores((prev) => ({ ...prev, [key]: score }));
    setScoreState((prev) => ({ ...prev, [key]: "saving" }));
    haptic("light");
    const finish = (state) => {
      setScoreState((prev) => ({ ...prev, [key]: state }));
      if (state === "saved") window.setTimeout(() => {
        setScoreState((prev) => (prev[key] === "saved" ? { ...prev, [key]: "" } : prev));
      }, 1600);
    };
    if (modeRef.current === "demo") {
      finish("saved");
      return;
    }
    request("/api/jury-score", initRef.current, {
      method: "POST",
      body: JSON.stringify({ nominationId: nomination.id, candidateId: candidate.id, score }),
    }).then(() => finish("saved")).catch((error) => {
      finish("error");
      notify(humanError(error), "error");
    });
  }

  function saveNominations() {
    run("nominations", async () => {
      const clean = draft.map((item) => ({ ...item, name: item.name.trim().replace(/\s+/g, " ") })).filter((item) => item.name);
      const keys = clean.map((item) => item.name.toLocaleLowerCase());
      if (!clean.length || clean.length > 20 || clean.some((item) => item.name.length < 2 || item.name.length > 100) || new Set(keys).size !== keys.length) {
        throw new Error("invalid_nominations");
      }
      if (phase !== "preparation") throw new Error("nominations_locked");
      if (modeRef.current === "demo") {
        setNominations((list) => clean.map((item) => {
          const prev = list.find((n) => n.id === item.id);
          return prev ? { ...prev, name: item.name } : { id: item.id || `new-${item.name}`, name: item.name, candidates: [] };
        }));
        setDraft(clean.map((item, index) => ({ id: item.id || `new-${index}-${item.name}`, name: item.name })));
        return;
      }
      await request("/api/admin/nominations", initRef.current, {
        method: "POST",
        body: JSON.stringify({ nominations: clean.map((item) => ({ id: item.id, name: item.name })) }),
      });
      await refreshState();
    }, "Номинации сохранены");
  }

  function saveTop5(nomination) {
    run(`top5:${nomination.id}`, async () => {
      const ranked = [...nomination.candidates].sort(byPopularity).slice(0, 5);
      if (ranked.length !== 5) throw new Error("Для топ-5 нужно минимум пять кандидатов");
      const candidateIds = ranked.map((c) => c.id);
      if (modeRef.current === "demo") {
        setNominations((list) => applyPatches(list, [{ nominationId: nomination.id, candidateIds }]));
        return;
      }
      await request("/api/admin/top5", initRef.current, {
        method: "POST",
        body: JSON.stringify({ nominationId: nomination.id, candidateIds }),
      });
      await refreshState();
    }, "Топ-5 сохранён по популярности");
  }

  function askPhase(nextId) {
    const next = PHASES.find((item) => item.id === nextId);
    if (!next) return;
    if (nextId === "voting" && !top5Ready) {
      notify("Сначала топ-5 во всех номинациях", "error");
      return;
    }
    setConfirm({
      title: `Открыть «${next.label}»?`,
      body: PHASE_WARN[nextId] || "Текущий этап закроется для всех.",
      confirmLabel: "Перейти",
      run: () => changePhase(nextId),
    });
  }

  function scheduleNextPhase() {
    if (!nextPhase || !scheduleAt) {
      notify("Укажи дату и время перехода", "error");
      return;
    }
    return run("phase-schedule", async () => {
      const target = new Date(scheduleAt);
      if (!Number.isFinite(target.getTime()) || target.getTime() < Date.now() + 60000 || target.getTime() > Date.now() + 31622400000) {
        throw new Error("Выбери дату минимум через минуту и не дальше чем через год");
      }
      if (modeRef.current === "demo") {
        setPhaseEndsAt(target.toISOString());
        return;
      }
      await request("/api/admin/schedule-phase", initRef.current, {
        method: "POST",
        body: JSON.stringify({ at: target.toISOString() }),
      });
      await refreshState();
    }, "Автоматический переход запланирован");
  }

  function changePhase(nextId) {
    return run("phase", async () => {
      const seconds = null;
      if (modeRef.current === "demo") {
        setPhase(nextId);
        setPhaseEndsAt(seconds ? new Date(Date.now() + seconds * 1000).toISOString() : null);
        setActive(0);
        if (nextId === "awards") setResults(computeResults(nominations, scores));
        return;
      }
      await request("/api/admin/phase", initRef.current, {
        method: "POST",
        body: JSON.stringify({ phase: nextId, durationSeconds: seconds }),
      });
      await refreshState();
      if (nextId === "awards") await refreshResults();
    }, "Этап обновлён");
  }

  function resetDemo() {
    const noms = seededNominations();
    setNominations(noms);
    setDraft(noms.map((n) => ({ id: n.id, name: n.name })));
    setVotes(seedVotes());
    setCommitted(seedVotes());
    setScores(seedScores());
    setScoreState({});
    setTexts({});
    setPhase("preparation");
    setRole("participant");
    setActive(0);
    setPhaseEndsAt(null);
    setResults([]);
    setSlide(0);
    setAdminTab("nominations");
    setAdminVotes(seedAudit());
    notify("Демо сброшено");
  }

  const shellClass = cx("ms-app", isAdmin && "is-admin", mode === "demo" && "is-demo");

  if (mode === "boot") {
    return (
      <main className="ms-boot">
        <Mark />
        <p className="kicker">MUSIC SLAY 2026</p>
        <h1>Подключаем сцену</h1>
        <p>{auth}</p>
        <div className="boot-bar" aria-hidden="true"><span /></div>
      </main>
    );
  }

  if (mode === "denied") {
    return (
      <main className="ms-boot">
        <Mark />
        <p className="kicker">НЕТ ДОСТУПА</p>
        <h1>Сессия не открылась</h1>
        <p>{auth}</p>
      </main>
    );
  }

  return (
    <div className={shellClass}>
      {mode === "demo" ? (
        <div className="demo-bar">
          <span>Демо · в Telegram будут живые данные</span>
          <button type="button" data-testid="studio-toggle" onClick={() => setStudioOpen((open) => !open)}>
            {studioOpen ? "Скрыть" : "Роль и этап"}
          </button>
        </div>
      ) : null}
      {mode === "demo" && studioOpen ? (
        <div className="studio" data-testid="studio">
          <div className="studio-row">
            {Object.entries(ROLE_NAMES).map(([id, label]) => (
              <button key={id} type="button" data-testid={`role-${id}`} className={cx("chip", role === id && "is-on")} onClick={() => { setRole(id); setActive(0); }}>{label}</button>
            ))}
          </div>
          <div className="studio-row">
            {PHASES.map((item) => (
              <button key={item.id} type="button" data-testid={`studio-phase-${item.id}`} className={cx("chip", phase === item.id && "is-on")} onClick={() => { setPhase(item.id); setActive(0); setSlide(0); }}>{item.short}</button>
            ))}
            <button type="button" className="chip" onClick={resetDemo}>Сброс</button>
          </div>
        </div>
      ) : null}

      {isAdmin ? (
        <AdminConsole
          user={user}
          role={role}
          phase={phase}
          phaseMeta={phaseMeta}
          phaseEndsAt={phaseEndsAt}
          phaseRemaining={phaseRemaining}
          nominations={nominations}
          draft={draft}
          setDraft={setDraft}
          adminTab={adminTab}
          setAdminTab={setAdminTab}
          adminVotes={adminVotes}
          adminVoters={adminVoters}
          juryMembers={juryMembers}
          juryTelegramId={juryTelegramId}
          setJuryTelegramId={setJuryTelegramId}
          juryDisplayName={juryDisplayName}
          setJuryDisplayName={setJuryDisplayName}
          onAddJuryMember={addJuryMember}
          onRemoveJuryMember={removeJuryMember}
          onRefreshJury={() => refreshJury().catch((error) => notify(humanError(error), "error"))}
          votesUpdated={votesUpdated}
          scheduleAt={scheduleAt}
          setScheduleAt={setScheduleAt}
          busy={busy}
          results={results}
          nextPhase={nextPhase}
          top5Ready={top5Ready}
          missingTop5={missingTop5}
          onSaveNominations={saveNominations}
          onSaveTop5={saveTop5}
          onAskPhase={askPhase}
          onSchedulePhase={scheduleNextPhase}
          onRefreshVotes={() => refreshVotes().catch((error) => notify(humanError(error), "error"))}
          onRefreshResults={() => run("results", refreshResults, "Результаты обновлены")}
          slide={slide}
          setSlide={setSlide}
          playing={playing}
          setPlaying={setPlaying}
        />
      ) : (
        <main className="stage">
          <TopBar user={user} role={role} />
          <PhaseRail phase={phase} />
          {phaseRemaining !== null ? (
            <p className="phase-time"><Clock3 size={14} /> {phaseRemaining > 0 ? `До конца этапа ${formatRemain(phaseRemaining)}` : "Время этапа вышло"}</p>
          ) : null}
          <div className="stage-enter" key={phase}>
            {phase === "preparation" ? (
              <Preparation now={now} />
            ) : null}
            {phase === "candidates" ? (
              <Candidates
                nominations={nominations}
                active={active}
                setActive={setActive}
                current={current}
                suggestion={suggestion}
                setText={(value) => current && setTexts((prev) => ({ ...prev, [current.id]: value }))}
                parsed={parsed}
                role={role}
                busy={busy}
                onSubmit={submitSuggestions}
                onMove={moveNomination}
              />
            ) : null}
            {phase === "voting" ? (
              <Voting
                nominations={nominations}
                active={active}
                setActive={setActive}
                current={current}
                selected={selected}
                dirty={dirtyVote}
                saved={savedSelected.length > 0}
                votedCount={votedCount}
                role={role}
                busy={busy}
                onToggle={toggleVote}
                onSave={saveVote}
                onMove={moveNomination}
              />
            ) : null}
            {phase === "jury" ? (
              role === "jury" ? (
                <Jury
                  nominations={nominations}
                  active={active}
                  setActive={setActive}
                  current={current}
                  scores={scores}
                  scoreState={scoreState}
                  stats={juryStats}
                  role={role}
                  onScore={saveScore}
                  onMove={moveNomination}
                />
              ) : (
                <FinalWaiting phaseRemaining={phaseRemaining} role={role} nominationCount={nominations.length} initData={initData} user={user} mode={mode} />
              )
            ) : null}
            {phase === "awards" ? (
              <Ceremony rows={results} slide={slide} setSlide={setSlide} playing={playing} setPlaying={setPlaying} />
            ) : null}
          </div>
          <footer className="footer"><span>MUSIC SLAY 2026</span><span>{auth}</span></footer>
        </main>
      )}

      {toast ? (
        <div className={cx("toast", toast.type === "error" && "is-error")} role="status">
          {toast.type === "error" ? <X size={16} /> : <Check size={16} />}
          {toast.message}
        </div>
      ) : null}

      {confirm ? (
        <div className="modal-back" onClick={() => !busy && setConfirm(null)}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title" onClick={(event) => event.stopPropagation()}>
            <p className="kicker">Подтверждение</p>
            <h2 id="confirm-title">{confirm.title}</h2>
            <p>{confirm.body}</p>
            <p className="hint">Длительность следующего этапа: {Number(duration) > 0 ? `${duration} ч` : "без таймера"}.</p>
            <div className="modal-actions">
              <button type="button" className="btn ghost" disabled={Boolean(busy)} onClick={() => setConfirm(null)}>Отмена</button>
              <button type="button" className="btn primary" disabled={Boolean(busy)} onClick={() => { const job = confirm.run; setConfirm(null); job?.(); }}>
                {busy === "phase" ? <LoaderCircle className="spin" size={16} /> : null}
                {confirm.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function namesLabel(count) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  const word = mod10 === 1 && mod100 !== 11 ? "имя" : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? "имени" : "имён";
  return `Отправлено ${count} ${word}`;
}

function Preparation({ now }) {
  return (
    <section className="poster">
      <p className="kicker">Подготовка</p>
      <h1>Премия<br />откроется<br /><em>7 декабря</em></h1>
      <p className="lede">Сцена ещё собирается. Когда откроют кандидатов, здесь можно будет предлагать имена в каждой номинации.</p>
      <Countdown now={now} />
      <p className="fine">Старт церемонии · 7 декабря 2026, 00:00 МСК</p>
    </section>
  );
}

function Candidates({ nominations, active, setActive, current, suggestion, setText, parsed, role, busy, onSubmit, onMove }) {
  const canSend = role === "participant";
  return (
    <section>
      <header className="stage-head">
        <p className="kicker">Кандидаты <span className="live"><i className="live-dot" /> список живой</span></p>
        <h1>{current?.name || "Нет номинаций"}</h1>
        <p className="lede">Несколько имён — через запятую. Число справа: сколько людей уже предложили этого кандидата.</p>
      </header>
      <NominationChips nominations={nominations} active={active} onPick={setActive} />
      <div className="switch-row">
        <IconButton label="Предыдущая номинация" disabled={active === 0} onClick={() => onMove(-1)}><ArrowLeft size={18} /></IconButton>
        <span>{nominations.length ? `${active + 1} / ${nominations.length}` : "0 / 0"}</span>
        <IconButton label="Следующая номинация" disabled={active >= nominations.length - 1} onClick={() => onMove(1)}><ArrowRight size={18} /></IconButton>
      </div>
      {!current ? <Empty icon={<ListMusic size={26} />} title="Номинаций пока нет" text="Их добавит администратор на этапе подготовки." /> : null}
      {current && canSend ? (
        <div className="composer">
          <label htmlFor="names">Кого добавить</label>
          <textarea id="names" value={suggestion} placeholder="Майя Вольт, Северный порт, трек или альбом" onChange={(event) => setText(event.target.value)} />
          {parsed.length ? (
            <div className="parsed">
              {parsed.map((name) => <span key={name}>{name}</span>)}
            </div>
          ) : null}
          <p className="hint">{suggestion.trim() && !parsed.length ? "Имя короче 2 символов не отправится." : "Повтор от того же человека не увеличит счётчик."}</p>
          <button type="button" className="btn primary block" disabled={Boolean(busy) || !parsed.length} onClick={onSubmit}>
            {busy === "suggestions" ? <LoaderCircle className="spin" size={16} /> : <Send size={16} />}
            Отправить {parsed.length ? `(${parsed.length})` : ""}
          </button>
        </div>
      ) : null}
      {current && !canSend ? <Notice>{role === "observer" ? "Наблюдатель видит список, но не предлагает имена." : "Предлагать имена могут только участники."}</Notice> : null}
      {current ? (
        <div className="people">
          <div className="people-head"><h2>Уже предложили</h2><b>{current.candidates.length}</b></div>
          {current.candidates.length ? [...current.candidates].sort(byPopularity).map((candidate, index) => {
            const max = Math.max(...current.candidates.map((c) => c.count), 1);
            return (
              <div className="person" key={candidate.id}>
                <span className="idx">{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <strong>{candidate.name}</strong>
                  <i className="bar"><span style={{ width: `${(candidate.count / max) * 100}%` }} /></i>
                </div>
                <em>{candidate.count}</em>
              </div>
            );
          }) : <p className="hint">Пока пусто. Первое имя задаёт список.</p>}
        </div>
      ) : null}
    </section>
  );
}

function Voting({ nominations, active, setActive, current, selected, dirty, saved, votedCount, role, busy, onToggle, onSave, onMove }) {
  const ballot = current ? ballotOf(current) : [];
  const canVote = role === "participant";
  return (
    <section>
      <header className="stage-head">
        <p className="kicker">Голосование</p>
        <h1>{current?.name || "Нет номинаций"}</h1>
        <p className="lede">Отметь до пяти. Выбор можно поменять, пока этап открыт.</p>
      </header>
      <Progress done={votedCount} total={nominations.length} label="Номинации с сохранённым голосом" />
      <NominationChips nominations={nominations} active={active} onPick={setActive} />
      <div className="switch-row">
        <IconButton label="Предыдущая номинация" disabled={active === 0} onClick={() => onMove(-1)}><ArrowLeft size={18} /></IconButton>
        <span>{nominations.length ? `${active + 1} / ${nominations.length}` : "0 / 0"}</span>
        <IconButton label="Следующая номинация" disabled={active >= nominations.length - 1} onClick={() => onMove(1)}><ArrowRight size={18} /></IconButton>
      </div>
      <div className="meter">
        <div><b>Выбрано {selected.length} из 5</b><span>{dirty ? "Не сохранено" : saved ? "Сохранено" : "Пока пусто"}</span></div>
        <div className="pips" aria-hidden="true">{Array.from({ length: 5 }, (_, i) => <i key={i} className={i < selected.length ? "on" : ""} />)}</div>
      </div>
      {!current ? <Empty icon={<Vote size={26} />} title="Нет номинаций" /> : null}
      {current && ballot.length === 0 ? <Empty icon={<Lock size={26} />} title="Топ-5 ещё не опубликован" text="Голосование откроется, когда администратор зафиксирует пятёрку." /> : null}
      <div className="vote-list">
        {ballot.map((candidate, index) => {
          const on = selected.includes(candidate.id);
          return (
            <button type="button" key={candidate.id} className={cx("vote-card", on && "is-on")} aria-pressed={on} disabled={!canVote} onClick={() => onToggle(candidate.id)}>
              <span className="vote-index">{String(index + 1).padStart(2, "0")}</span>
              <span className="vote-copy">
                <strong>{candidate.name}</strong>
                <small>{on ? "В твоём списке" : "Нажми, чтобы выбрать"}</small>
              </span>
              <span className="vote-mark">{on ? <Check size={16} /> : "+"}</span>
            </button>
          );
        })}
      </div>
      {current && canVote && ballot.length > 0 ? (
        <button type="button" className="btn primary block" disabled={Boolean(busy) || !dirty} onClick={onSave}>
          {busy === "vote" ? <LoaderCircle className="spin" size={16} /> : <Vote size={16} />}
          {saved ? "Обновить голос" : "Сохранить голос"}
        </button>
      ) : null}
      {current && !canVote ? <Notice>{role === "observer" ? "Наблюдатель видит бюллетень, но не голосует." : "Голосовать могут только участники."}</Notice> : null}
    </section>
  );
}


function TrophyRunner({ initData, user, mode, open }) {
  const canvasRef = useRef(null);
  const gameRef = useRef({ running: false, raf: 0, score: 0, best: 0, dinoY: 0, velocity: 0, obstacles: [], frame: 0, saved: false });
  const [running, setRunning] = useState(false);
  const [gameOver, setGameOver] = useState(false);
  const [score, setScore] = useState(0);
  const [leaderboard, setLeaderboard] = useState([]);
  const [leaderboardError, setLeaderboardError] = useState(false);

  const loadLeaders = useCallback(async () => {
    if (mode !== "live" || !initData) return;
    try {
      const data = await request("/api/game/leaderboard", initData);
      setLeaderboard(data.leaders || []);
      setLeaderboardError(false);
    } catch {
      setLeaderboardError(true);
    }
  }, [mode, initData]);

  useEffect(() => {
    loadLeaders();
    const id = window.setInterval(loadLeaders, 10000);
    return () => window.clearInterval(id);
  }, [loadLeaders]);

  const jump = useCallback(() => {
    const game = gameRef.current;
    if (!game.running) return;
    if (game.dinoY >= 0) game.velocity = -11.5;
  }, []);

  const start = useCallback(() => {
    const game = gameRef.current;
    game.running = true;
    game.score = 0;
    game.dinoY = 0;
    game.velocity = 0;
    game.obstacles = [];
    game.frame = 0;
    game.saved = false;
    setScore(0);
    setGameOver(false);
    setRunning(true);
    haptic("light");
  }, []);

  useEffect(() => {
    if (!running) return undefined;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!ctx) return undefined;
    const game = gameRef.current;
    let last = 0;
    const ground = 145;
    const draw = (timestamp) => {
      if (!game.running) return;
      const delta = Math.min((timestamp - (last || timestamp)) / 16.67, 2);
      last = timestamp;
      game.frame += delta;
      game.score += delta * 0.42;
      game.velocity += 0.62 * delta;
      game.dinoY = Math.min(0, game.dinoY + game.velocity * delta);
      if (game.dinoY === 0) game.velocity = 0;
      if (game.frame % Math.max(35, 78 - Math.floor(game.score / 90)) < delta) {
        game.obstacles.push({ x: 740, w: 16 + Math.random() * 10, h: 22 + Math.random() * 22 });
      }
      game.obstacles = game.obstacles.filter((ob) => ob.x + ob.w > -10);
      game.obstacles.forEach((ob) => { ob.x -= (5.2 + Math.min(game.score / 180, 4)) * delta; });
      const dino = { x: 72, y: ground - 31 + game.dinoY, w: 25, h: 31 };
      const hit = game.obstacles.some((ob) => dino.x + dino.w - 5 > ob.x + 3 && dino.x + 5 < ob.x + ob.w - 2 && dino.y + dino.h - 4 > ground - ob.h);
      ctx.clearRect(0, 0, 720, 180);
      ctx.fillStyle = "rgba(231,194,122,.22)";
      ctx.fillRect(0, ground + 1, 720, 1);
      ctx.fillStyle = "#e7c27a";
      ctx.fillRect(dino.x + 5, dino.y + 8, 16, 19);
      ctx.fillRect(dino.x + 15, dino.y + 1, 13, 12);
      ctx.fillRect(dino.x + 8, dino.y + 25, 5, 8);
      ctx.fillRect(dino.x + 18, dino.y + 25, 5, 8);
      ctx.fillStyle = "#07060b";
      ctx.fillRect(dino.x + 23, dino.y + 5, 2, 2);
      ctx.fillStyle = "#8fd0ae";
      game.obstacles.forEach((ob) => {
        ctx.fillRect(ob.x, ground - ob.h, ob.w, ob.h);
        ctx.fillRect(ob.x - 5, ground - ob.h + 9, 5, 7);
      });
      ctx.fillStyle = "rgba(255,255,255,.45)";
      ctx.font = "12px sans-serif";
      ctx.fillText("SPACE / TAP — JUMP", 535, 24);
      setScore(Math.floor(game.score));
      if (hit) {
        game.running = false;
        setRunning(false);
        setGameOver(true);
        const finalScore = Math.floor(game.score);
        setScore(finalScore);
        if (!game.saved && mode === "live" && initData) {
          game.saved = true;
          request("/api/game/score", initData, {
            method: "POST",
            body: JSON.stringify({ score: finalScore, displayName: user?.firstName || user?.username || "Игрок" }),
          }).then(loadLeaders).catch(() => setLeaderboardError(true));
        }
        haptic("error");
        return;
      }
      game.raf = window.requestAnimationFrame(draw);
    };
    game.raf = window.requestAnimationFrame(draw);
    return () => window.cancelAnimationFrame(game.raf);
  }, [running, initData, loadLeaders, mode, user]);

  useEffect(() => {
    const onKey = (event) => {
      if (event.code === "Space" || event.code === "ArrowUp") {
        if (running) { event.preventDefault(); jump(); }
        else if (gameOver) { event.preventDefault(); start(); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [running, gameOver, jump, start]);

  return (
    <section className="runner-panel" aria-label="Секретная игра и таблица лидеров">
      <div className="runner-head" style={{ display: open ? "flex" : "none" }}>
        <div><p className="kicker">Секретная комната</p><h2>SLAY RUNNER</h2></div>
        <span className="runner-score">SCORE <b>{score}</b></span>
      </div>
      <div className="runner-screen" style={{ display: open ? "block" : "none" }} onPointerDown={() => running ? jump() : null}>
        <canvas ref={canvasRef} width="720" height="180" aria-label="Игровое поле с бегущим персонажем и препятствиями" />
        {!running ? (
          <div className="runner-overlay">
            <strong>{gameOver ? "Забег окончен" : "Готов к забегу?"}</strong>
            <span>{gameOver ? `Результат: ${score} очков` : "Перепрыгивай препятствия и набирай очки"}</span>
            <button type="button" className="btn primary" onClick={start}>{gameOver ? "Ещё раз" : "Начать игру"}</button>
          </div>
        ) : null}
      </div>
      <p className="runner-help" style={{ display: open ? "block" : "none" }}>Пробел / ↑ / касание экрана — прыжок. Чем дольше бежишь, тем быстрее игра.</p>
      <div className="runner-leaders">
        <div className="runner-leaders-title"><span className="kicker">Таблица рекордов</span><b>ТОП-5</b></div>
        {leaderboard.length ? leaderboard.map((entry, index) => (
          <div className="runner-leader" key={entry.telegram_id}>
            <span className={index === 0 ? "leader-gold" : ""}>{String(index + 1).padStart(2, "0")}</span>
            <strong>{entry.display_name}</strong>
            <b>{entry.score}</b>
          </div>
        )) : <p className="runner-empty">{leaderboardError ? "Не удалось загрузить рейтинг. Повторим автоматически." : "Пока нет рекордов. Стань первым."}</p>}
        {mode !== "live" ? <p className="runner-empty">Общий рейтинг появится в Telegram после запуска игры.</p> : null}
      </div>
    </section>
  );
}

function FinalWaiting({ phaseRemaining, role, nominationCount, initData, user, mode }) {
  const isGuest = role === "observer";
  const [secretOpen, setSecretOpen] = useState(false);

  if (secretOpen) {
    return (
      <main className="final-secret-screen">
        <header className="final-secret-head">
          <button type="button" className="btn ghost" onClick={() => setSecretOpen(false)}>
            <ArrowLeft size={16} /> Назад к ожиданию
          </button>
          <span className="kicker">MUSIC SLAY · SECRET ROOM</span>
        </header>
        <div className="final-secret-intro">
          <p className="kicker">Пасхалка разблокирована</p>
          <h1>SLAY <em>RUNNER</em></h1>
          <p>Твой забег начинается здесь. Перепрыгивай препятствия и попади в таблицу рекордов.</p>
        </div>
        <TrophyRunner initData={initData} user={user} mode={mode} open />
      </main>
    );
  }

  return (
    <section className="final-wait" aria-labelledby="final-wait-title">
      <div className="final-wait-orbit">
        <span className="orbit orbit-one" />
        <span className="orbit orbit-two" />
        <button type="button" className="orbit-core" aria-label="Открыть секретную игру" title="Секрет? Нажми на кубок" onClick={() => setSecretOpen((value) => !value)}><Trophy size={34} /></button>
        <i className="orbit-star star-one" />
        <i className="orbit-star star-two" />
        <i className="orbit-star star-three" />
      </div>
      <p className="kicker"><span className="live"><i className="live-dot" /> финальная подготовка</span></p>
      <h1 id="final-wait-title">Пауза перед<br /><em>главным</em></h1>
      <p className="final-wait-lede">
        {isGuest
          ? "Жюри выставляет последние оценки. Совсем скоро здесь появятся результаты и начнётся церемония награждения."
          : "Твоё голосование завершено. Сейчас жюри определяет победителей — результаты откроются всем одновременно."}
      </p>
      <div className="final-wait-status">
        <span className="final-wait-pulse" />
        <div>
          <strong>Жюри подводит итоги</strong>
          <small>{nominationCount} {nominationCount === 1 ? "номинация" : nominationCount >= 2 && nominationCount <= 4 ? "номинации" : "номинаций"} в работе</small>
        </div>
      </div>
      <div className="final-wait-track" aria-label="Этапы премии">
        <div className="is-complete"><span>✓</span><small>Голосование</small></div>
        <i className="is-active" />
        <div className="is-active"><span>02</span><small>Оценки жюри</small></div>
        <i />
        <div><span>03</span><small>Финал</small></div>
      </div>
      <div className="final-wait-count">
        <span>{phaseRemaining !== null && phaseRemaining > 0 ? "До открытия финала" : "Следующий этап"}</span>
        <strong>{phaseRemaining !== null && phaseRemaining > 0 ? formatRemain(phaseRemaining) : "Церемония награждения"}</strong>
      </div>
      <p className="final-wait-foot">Оставайся на связи. Экран обновится автоматически после перехода на следующий этап.</p>
    </section>
  );
}

function Jury({ nominations, active, setActive, current, scores, scoreState, stats, role, onScore, onMove }) {
  const ballot = current ? ballotOf(current) : [];
  const canScore = role === "jury";
  return (
    <section>
      <header className="stage-head">
        <p className="kicker">Жюри</p>
        <h1>{current?.name || "Нет номинаций"}</h1>
        <p className="lede">Нажми цифру от 0 до 10. Оценка уходит сразу, повторное нажатие её меняет.</p>
      </header>
      <Progress done={stats.done} total={stats.total} label="Оценки по топ-5" />
      <NominationChips nominations={nominations} active={active} onPick={setActive} />
      <div className="switch-row">
        <IconButton label="Предыдущая номинация" disabled={active === 0} onClick={() => onMove(-1)}><ArrowLeft size={18} /></IconButton>
        <span>{nominations.length ? `${active + 1} / ${nominations.length}` : "0 / 0"}</span>
        <IconButton label="Следующая номинация" disabled={active >= nominations.length - 1} onClick={() => onMove(1)}><ArrowRight size={18} /></IconButton>
      </div>
      {current && ballot.length === 0 ? <Empty icon={<Award size={26} />} title="Нет топ-5 для оценки" text="Жюри оценивает только опубликованную пятёрку." /> : null}
      <div className="score-list">
        {ballot.map((candidate, index) => {
          const key = `${current.id}:${candidate.id}`;
          const value = scores[key];
          const state = scoreState[key];
          return (
            <article className="score-card" key={candidate.id}>
              <header>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <h3>{candidate.name}</h3>
                <em className={cx("score-status", state && `is-${state}`)}>
                  {state === "saving" ? "Сохраняем" : state === "saved" ? "Сохранено" : state === "error" ? "Сбой" : Number.isInteger(value) ? `${value}/10` : "Нет оценки"}
                </em>
              </header>
              <div className="score-keys" role="group" aria-label={`Оценка ${candidate.name}`}>
                {Array.from({ length: 11 }, (_, score) => (
                  <button key={score} type="button" disabled={!canScore} aria-pressed={value === score} className={value === score ? "is-on" : ""} onClick={() => onScore(current, candidate, score)}>
                    {score}
                  </button>
                ))}
              </div>
            </article>
          );
        })}
      </div>
      {!canScore ? <Notice>{role === "observer" ? "Наблюдатель не ставит оценки." : "Оценки доступны только членам жюри."}</Notice> : null}
    </section>
  );
}

function AdminConsole(props) {
  const {
    user, role, phaseMeta, phaseEndsAt, phaseRemaining, nominations, draft, setDraft, adminTab, setAdminTab,
    adminVotes, adminVoters, juryMembers, juryTelegramId, setJuryTelegramId, juryDisplayName, setJuryDisplayName, onAddJuryMember, onRemoveJuryMember, onRefreshJury, votesUpdated, scheduleAt, setScheduleAt, busy, results, nextPhase, top5Ready, missingTop5,
    onSaveNominations, onSaveTop5, onAskPhase, onSchedulePhase, onRefreshVotes, onRefreshResults, slide, setSlide, playing, setPlaying, phase,
  } = props;
  return (
    <main className="admin">
      <TopBar user={user} role={role} admin />
      <header className="admin-head">
        <div>
          <p className="kicker">Режиссура</p>
          <h1>Пульт премии</h1>
        </div>
        <p className="live"><span className="live-dot" /> сейчас {phaseMeta.label.toLowerCase()}</p>
      </header>
      <section className="kpis">
        <div><span>Этап</span><b>{phaseMeta.label}</b></div>
        <div><span>Номинации</span><b>{nominations.length}</b></div>
        <div><span>Строки голосов</span><b>{adminVotes.length}</b></div>
        <div><span>До конца этапа</span><b>{phaseRemaining === null ? "—" : phaseRemaining > 0 ? formatRemain(phaseRemaining) : "вышло"}</b></div>
      </section>
      <div className="admin-body">
        <nav className="admin-tabs" aria-label="Разделы пульта">
          {ADMIN_TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <button key={tab.id} type="button" className={cx("tab", adminTab === tab.id && "is-on")} onClick={() => setAdminTab(tab.id)}>
                <Icon size={16} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="admin-main">
          {adminTab === "nominations" ? (
            <section className="panel">
              <header className="panel-head">
                <h2>Номинации</h2>
                <p>От 1 до 20 уникальных названий. Сервер примет правки только на подготовке.</p>
              </header>
              {phase !== "preparation" ? <div className="locked"><Lock size={16} /> Список закрыт: этап «{phaseMeta.label}».</div> : null}
              {draft.map((item, index) => (
                <div className="editor-row" key={item.id || `new-${index}`}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <input aria-label={`Номинация ${index + 1}`} maxLength={100} value={item.name} disabled={phase !== "preparation"} onChange={(event) => setDraft((list) => list.map((row, i) => i === index ? { ...row, name: event.target.value } : row))} />
                  <IconButton label="Удалить номинацию" disabled={phase !== "preparation"} onClick={() => setDraft((list) => list.filter((_, i) => i !== index))}><X size={16} /></IconButton>
                </div>
              ))}
              <div className="row-actions">
                <button type="button" className="btn ghost" disabled={phase !== "preparation" || draft.length >= 20} onClick={() => setDraft((list) => [...list, { id: null, name: "" }])}>Добавить</button>
                <button type="button" className="btn primary" disabled={Boolean(busy) || phase !== "preparation"} onClick={onSaveNominations}>
                  {busy === "nominations" ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />}
                  Сохранить
                </button>
              </div>
            </section>
          ) : null}

          {adminTab === "candidates" ? (
            <section className="panel">
              <header className="panel-head">
                <h2>Кандидаты и топ-5</h2>
                <p>Пятёрка сама встаёт по числу предложений, пока идёт этап кандидатов. Кнопка фиксирует её ещё раз.</p>
              </header>
              {nominations.map((nomination) => {
                const ranked = [...nomination.candidates].sort(byPopularity);
                const max = Math.max(...ranked.map((c) => c.count), 1);
                return (
                  <article className="cand-block" key={nomination.id}>
                    <header>
                      <div>
                        <h3>{nomination.name}</h3>
                        <p>{nomination.candidates.length} в списке · топ {nomination.candidates.filter((c) => c.top5).length}/5</p>
                      </div>
                      <button type="button" className="btn primary slim" disabled={Boolean(busy) || nomination.candidates.length < 5 || phase !== "candidates"} onClick={() => onSaveTop5(nomination)}>
                        <Sparkles size={14} /> Топ-5
                      </button>
                    </header>
                    {ranked.length ? ranked.map((candidate, index) => (
                      <div className="cand-row" key={candidate.id}>
                        <span>{String(index + 1).padStart(2, "0")}</span>
                        <strong>{candidate.name}</strong>
                        <i className="bar"><span style={{ width: `${(candidate.count / max) * 100}%` }} /></i>
                        <em>{candidate.count}</em>
                        {candidate.top5 ? <b className="tag">ТОП</b> : <b className="tag ghost"> </b>}
                      </div>
                    )) : <p className="hint">Предложений нет.</p>}
                  </article>
                );
              })}
              {!nominations.length ? <Empty icon={<Users size={26} />} title="Нет номинаций" /> : null}
            </section>
          ) : null}

          {adminTab === "votes" ? (
            <section className="panel">
              <header className="panel-head">
                <h2>Мониторинг голосов</h2>
                <p>Таблица обновляется каждые 2,5 секунды, пока открыт пульт.</p>
              </header>
              <div className="live-line">
                <span className="live"><i className="live-dot" /> live</span>
                <span>{adminVotes.length} строк</span>
                <span>обновлено {votesUpdated ? new Date(votesUpdated).toLocaleTimeString("ru-RU") : "—"}</span>
                <IconButton label="Обновить голоса" onClick={onRefreshVotes}><RefreshCw size={15} /></IconButton>
              </div>
              <div className="table-wrap">
                <table className="audit">
                  <thead>
                    <tr><th>Номинация</th><th>Telegram</th><th>Кандидат</th><th>Голосов</th><th>Время</th></tr>
                  </thead>
                  <tbody>
                    {adminVotes.length ? adminVotes.map((row, index) => (
                      <tr key={row.id || index}>
                        <td>{row.nomination || "—"}</td>
                        <td>{row.voter || "—"}</td>
                        <td>{row.candidate || "—"}</td>
                        <td>{row.vote_count ?? "—"}</td>
                        <td>{row.created_at ? new Date(row.created_at).toLocaleString("ru-RU") : "—"}</td>
                      </tr>
                    )) : <tr><td colSpan={5} className="table-empty">Голосов пока нет</td></tr>}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          {adminTab === "voters" ? (
            <section className="panel">
              <header className="panel-head">
                <h2>Голосующие</h2>
                <p>Уникальные участники. Строки отсортированы по общему числу отданных голосов.</p>
              </header>
              <div className="live-line">
                <span>{adminVoters.length} участников</span>
                <span>обновлено {votesUpdated ? new Date(votesUpdated).toLocaleTimeString("ru-RU") : "—"}</span>
                <IconButton label="Обновить голосующих" onClick={onRefreshVotes}><RefreshCw size={15} /></IconButton>
              </div>
              <div className="table-wrap">
                <table className="audit">
                  <thead><tr><th>#</th><th>Telegram</th><th>Голосов</th><th>Последний голос</th></tr></thead>
                  <tbody>
                    {adminVoters.length ? adminVoters.map((row, index) => (
                      <tr key={row.voter || index}>
                        <td>{index + 1}</td><td>{row.voter || "—"}</td><td><b>{row.vote_count ?? 0}</b></td>
                        <td>{row.last_vote_at ? new Date(row.last_vote_at).toLocaleString("ru-RU") : "—"}</td>
                      </tr>
                    )) : <tr><td colSpan={4} className="table-empty">Голосующих пока нет</td></tr>}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          {adminTab === "jury" ? (
            <section className="panel">
              <header className="panel-head"><h2>Состав жюри</h2><p>Добавляй участников по числовому Telegram ID. После добавления им нужно заново открыть мини-приложение, чтобы получить роль жюри.</p></header>
              <div className="jury-add-form">
                <label>Telegram ID<input inputMode="numeric" placeholder="Например, 123456789" value={juryTelegramId} onChange={(event) => setJuryTelegramId(event.target.value.replace(/[^0-9]/g, ""))} /></label>
                <label>Имя для списка (необязательно)<input maxLength={80} placeholder="Имя участника" value={juryDisplayName} onChange={(event) => setJuryDisplayName(event.target.value)} /></label>
                <button type="button" className="btn primary" disabled={Boolean(busy) || !juryTelegramId.trim()} onClick={onAddJuryMember}>{busy === "jury-add" ? <LoaderCircle className="spin" size={16} /> : <Users size={16} />} Добавить в жюри</button>
              </div>
              <div className="live-line"><span>{juryMembers.length} членов жюри</span><IconButton label="Обновить состав жюри" onClick={onRefreshJury}><RefreshCw size={15} /></IconButton></div>
              <div className="table-wrap"><table className="audit">
                <thead><tr><th>#</th><th>Имя</th><th>Telegram ID</th><th></th></tr></thead>
                <tbody>{juryMembers.length ? juryMembers.map((member, index) => <tr key={member.telegram_id}><td>{index + 1}</td><td>{member.display_name || "—"}</td><td>{member.telegram_id}</td><td><button type="button" className="btn danger slim" disabled={Boolean(busy)} onClick={() => onRemoveJuryMember(member.telegram_id)}>Убрать</button></td></tr>) : <tr><td colSpan={4} className="table-empty">Состав жюри пока пуст</td></tr>}</tbody>
              </table></div>
            </section>
          ) : null}

          {adminTab === "phases" ? (
            <section className="panel">
              <header className="panel-head">
                <h2>Этапы</h2>
                <p>Сервер пускает только вперёд по цепочке. Пропустить этап нельзя.</p>
              </header>
              <div className="phase-hero">
                <span>Сейчас</span>
                <strong>{phaseMeta.label}</strong>
                <small>{phaseEndsAt ? `До ${new Date(phaseEndsAt).toLocaleString("ru-RU")}` : "Таймер не задан"}</small>
              </div>
              <p className="label">Автоматический переход по расписанию</p>
              <label className="hours" htmlFor="phase-schedule">
                <input id="phase-schedule" type="datetime-local" step="60" min={new Date(Date.now() + 60000 - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)} value={scheduleAt} onChange={(event) => setScheduleAt(event.target.value)} />
                <span>Дата и местное время. Когда срок наступит, сервер автоматически откроет следующий этап. Оставь пустым для ручного перехода.</span>
              </label>
              {nextPhase ? (
                <>
                  <button type="button" className="btn ghost block" disabled={Boolean(busy) || !scheduleAt || (nextPhase.id === "voting" && !top5Ready)} onClick={onSchedulePhase}>
                    Запланировать переход на «{nextPhase.label}»
                  </button>
                  <button type="button" className="btn primary block" disabled={Boolean(busy) || (nextPhase.id === "voting" && !top5Ready)} onClick={() => onAskPhase(nextPhase.id)}>
                    Открыть «{nextPhase.label}» сейчас
                  </button>
                </>
              ) : <Notice>Финальный этап. Дальше переходить некуда.</Notice>}
              {nextPhase?.id === "voting" && !top5Ready ? (
                <p className="hint">Нет топ-5: {missingTop5.join(", ") || "проверь номинации"}.</p>
              ) : null}
              <ol className="timeline">
                {PHASES.map((item, index) => {
                  const state = item.id === phase ? "is-now" : PHASES.findIndex((p) => p.id === phase) > index ? "is-done" : "";
                  return (
                    <li key={item.id} className={state}>
                      <span>{state === "is-done" ? <Check size={12} /> : index + 1}</span>
                      <div>
                        <b>{item.label}</b>
                        <small>{item.id === phase ? "Текущий" : state === "is-done" ? "Пройден" : item.id === nextPhase?.id ? "Следующий" : "Позже"}</small>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </section>
          ) : null}

          {adminTab === "results" ? (
            <section className="panel">
              <header className="panel-head">
                <h2>Результаты</h2>
                <p>Итог = голоса + сумма(голоса × оценка жюри / 10). Так считает /api/results.</p>
              </header>
              <div className="row-actions end">
                <button type="button" className="btn ghost" disabled={Boolean(busy)} onClick={onRefreshResults}>
                  <RefreshCw size={15} /> Обновить
                </button>
              </div>
              {results.length ? results.map((row, index) => (
                <div className="result" key={row.nominationId || row.nomination}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <div>
                    <small>{row.nomination}</small>
                    <b>{row.winner?.candidate || "Нет победителя"}</b>
                  </div>
                  <strong>{row.winner?.finalScore ?? "—"}</strong>
                </div>
              )) : <Empty icon={<Trophy size={26} />} title="Сервер ещё не отдал итог" />}
              <Ceremony rows={results} slide={slide} setSlide={setSlide} playing={playing} setPlaying={setPlaying} />
            </section>
          ) : null}
        </div>
      </div>
      <section className="panel voters-always">
        <header className="panel-head">
          <h2>База голосующих</h2>
          <p>Постоянный список участников на всех этапах. Сортировка по числу отданных голосов — по убыванию.</p>
        </header>
        <div className="live-line">
          <span>{adminVoters.length} участников</span>
          <span>обновлено {votesUpdated ? new Date(votesUpdated).toLocaleTimeString("ru-RU") : "—"}</span>
          <IconButton label="Обновить базу голосующих" onClick={onRefreshVotes}><RefreshCw size={15} /></IconButton>
        </div>
        <div className="table-wrap">
          <table className="audit">
            <thead><tr><th>#</th><th>Telegram</th><th>Голосов</th><th>Последний голос</th></tr></thead>
            <tbody>
              {adminVoters.length ? adminVoters.map((row, index) => (
                <tr key={row.voter || index}>
                  <td>{index + 1}</td><td>{row.voter || "—"}</td><td><b>{row.vote_count ?? 0}</b></td>
                  <td>{row.last_vote_at ? new Date(row.last_vote_at).toLocaleString("ru-RU") : "—"}</td>
                </tr>
              )) : <tr><td colSpan={4} className="table-empty">Голосующих пока нет</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
      <footer className="footer"><span>MUSIC SLAY 2026</span><span>Пульт администратора</span></footer>
    </main>
  );
}

const rootEl = typeof document !== "undefined" ? document.getElementById("root") : null;
if (rootEl && !rootEl.dataset.app) {
  rootEl.dataset.app = "1";
  createRoot(rootEl).render(<AppErrorBoundary><App /></AppErrorBoundary>);
}
