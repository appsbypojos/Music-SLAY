# MUSIC SLAY 2026

React + Vite frontend and Cloudflare Worker API for the MUSIC SLAY 2026 awards flow.

## Infrastructure
- Supabase project: `ueqetvauqgrdyghxdyip` (region `eu-north-1`)
- Cloudflare Worker: `music-slay-2026`
- Worker hostname: `https://music-slay-2026.vda45lol.workers.dev`
- Telegram Mini App SDK is loaded by `index.html`.
- Telegram `initData` is verified in the Worker using Telegram's HMAC-SHA-256 procedure. The browser never decides its own role.

## Worker secrets and roles
Set these secrets in Cloudflare Dashboard → Workers & Pages → `music-slay-2026` → Settings → Variables and Secrets:
- `TELEGRAM_BOT_TOKEN` — token from BotFather.
- `ADMIN_TELEGRAM_ID` — Telegram numeric ID of the main administrator.
- `SUPABASE_URL` — project URL.
- `SUPABASE_SERVICE_ROLE_KEY` — server-only Supabase secret/service-role key. Never expose it in Vite variables, frontend code, or GitHub source.

Optional Worker variable:
- `JURY_TELEGRAM_IDS` — comma-separated Telegram numeric IDs authorized as jury members.

Observer access is granted through rows in `public.observer_permissions`. Observers can read state but cannot submit candidates, vote, score, or administer phases.

Configure the bot's Mini App URL in BotFather:
1. Open @BotFather and select the bot.
2. Use `/setmenubutton` and choose a title.
3. Set the Web App URL to `https://music-slay-2026.vda45lol.workers.dev`.
4. Open the bot in Telegram and launch the menu button.

## API
All protected endpoints require the raw Telegram `initData` in the `X-Telegram-Init-Data` header. The Worker re-verifies the signature and freshness on each request.

- `POST /api/telegram/session` — verify Mini App session and return the server-assigned role.
- `GET /api/state` — load the active Slay, nominations, candidates, and the current user's saved votes or jury scores.
- `POST /api/submissions` — submit candidate names during the candidates phase.
- `POST /api/votes` — save up to five selected candidates for one nomination during voting.
- `POST /api/jury-score` — save a 0–10 score for a top-five candidate during the jury phase.
- `POST /api/admin/top5` — administrator-only top-five selection for one nomination.
- `POST /api/admin/phase` — administrator-only sequential phase transition with an optional duration in seconds.
- `GET /api/health` — health and configuration flags; never returns secret values.

The Worker derives per-user HMAC identifiers for participant submissions and votes. Telegram numeric IDs are stored only where individual jury attribution is required.

## Database security
The initial migration enables RLS on all application tables and intentionally creates no anonymous write policies. The server-only RPCs in `supabase/migrations/002_secure_api_and_admin_rpcs.sql` are granted to `service_role` only. Candidate foreign-key indexes are in migration `003_candidate_foreign_key_indexes.sql`.

The browser must never receive `SUPABASE_SERVICE_ROLE_KEY`. Do not add public RLS write policies to make the application work; all mutations must pass through the authenticated Worker API.

## Build and deployment
```bash
npm install
npm run build
npx wrangler deploy
```

GitHub Actions deploys on pushes to `main`. Configure repository Actions secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. Use a narrowly scoped Cloudflare API Token rather than a Global API Key.

## Current implementation boundary
- Implemented: Telegram authentication, server-derived roles, Supabase-backed state loading, candidate submissions, participant voting, individual jury score persistence, admin top-five selection, sequential phase transitions, server-side phase deadlines, phase countdown display, and admin action logging.
- RLS remains enabled; anonymous and authenticated browser roles cannot execute the mutation RPCs. Only the Worker service role can execute them.
- Not yet implemented: admin UI for creating/editing nominations, automatic transition to the next phase after expiry (expired phases reject writes), award calculation/publication, and production slideshow driven by published winners.
- No scoring formula is assumed. The previously discussed weighting needs explicit approval before implementation.
- Test candidate names remain placeholders; replace them with approved candidates before opening the public stages.


## Карта проекта и как с ним работать

### Основные файлы
- `index.html` — HTML-точка входа. Подключает Telegram WebApp SDK и контейнер React.
- `src/main.jsx` — интерфейс, клиентская логика, состояние экранов и обращения к API Worker.
- `src/styles.css` — внешний вид приложения, адаптивность и анимации.
- `worker/index.js` — серверные API-маршруты, проверка Telegram, роли, доступ к Supabase и выдача frontend.
- `supabase/migrations/` — SQL-миграции: структура таблиц, индексы, RLS и серверные RPC.
- `wrangler.toml` — имя Worker, путь к собранным assets, cron и публичные переменные.
- `package.json` — зависимости и команды npm.
- `.github/workflows/deploy.yml` — автоматическая сборка, публикация в Cloudflare и smoke-проверка сайта.

### Быстрый старт для разработчика
1. Установите Node.js 22 и npm.
2. Выполните `npm install`.
3. Запустите `npm run dev` для локальной разработки интерфейса.
4. Выполните `npm run build`, чтобы проверить production-сборку.
5. Для локального Worker используйте `npx wrangler dev`; для этого потребуются настроенные секреты/переменные Cloudflare и доступ к Supabase.
6. Production-деплой запускается автоматически при push в `main`. Результат смотрите во вкладке Actions.

### Как устроен пользовательский сценарий
1. Пользователь открывает Mini App внутри Telegram.
2. Frontend передаёт Telegram `initData` в Worker.
3. Worker проверяет подпись, срок действия и назначает роль по серверным настройкам/таблицам.
4. Frontend загружает состояние через `GET /api/state`.
5. Участник предлагает кандидатов и голосует; жюри выставляет оценки; администратор управляет этапами и составом жюри.
6. Worker проверяет роль, этап и входные данные, затем вызывает Supabase REST/RPC.
7. Результаты формируются серверным endpoint `GET /api/results`.

### Как пользоваться приложением
- **Участник:** открыть Mini App в Telegram, выбрать номинацию, отправить имена на этапе кандидатов и выбрать до пяти кандидатов на этапе голосования.
- **Жюри:** открыть приложение с Telegram-аккаунта, включённого администратором в состав жюри; на этапе жюри выставлять оценки кандидатам из топ-5.
- **Наблюдатель:** получает доступ на чтение, без отправки кандидатов, голосования и управления этапами.
- **Администратор:** управляет премией через вкладки «Номинации», «Кандидаты и топ-5», «Голоса», «Голосующие», «Состав жюри», «Этапы» и «Результаты». Переходы этапов последовательные; перед открытием голосования требуется зафиксировать топ-5 во всех номинациях. Действие «Начать заново» сбрасывает текущую премию — перед подтверждением проверьте, что это действительно нужно.

### Важные правила безопасности
- Не добавляйте секреты в GitHub, frontend или `VITE_*` переменные.
- `SUPABASE_SERVICE_ROLE_KEY` и `TELEGRAM_BOT_TOKEN` хранятся только в Cloudflare Worker Secrets.
- Не отключайте RLS и не создавайте публичные политики записи ради обхода API.
- Все изменения данных должны проходить через Worker, где проверяются Telegram-сессия и роль.
- Перед изменением схемы БД создавайте новую SQL-миграцию; не редактируйте уже применённую миграцию без отдельного плана восстановления.

### Текущие ограничения
Список реализованного и ещё не реализованного функционала приведён выше в разделе «Current implementation boundary». В частности, не считайте автоматический переход по окончании таймера или полноценную публикацию наград реализованными, пока это явно не добавлено и не проверено.
