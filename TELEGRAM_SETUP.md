# Telegram Mini App setup — MUSIC SLAY 2026

## 1. Add Worker secrets

In Cloudflare Dashboard, open Workers & Pages → music-slay-2026 → Settings → Variables and Secrets. Add the following as **Secrets**, not plain text variables:

- `TELEGRAM_BOT_TOKEN`: token issued by @BotFather.
- `ADMIN_TELEGRAM_ID`: numeric Telegram ID of the main administrator.

Optional allowlists (comma-separated Telegram numeric IDs):
- `JURY_TELEGRAM_IDS`
- `OBSERVER_TELEGRAM_IDS`

Never put the bot token in source code, GitHub, frontend environment variables, or a message to the app.

## 2. Configure the bot's Mini App launch URL

In Telegram, open @BotFather, select the bot, run `/setmenubutton`, set a button title (for example, “Open MUSIC SLAY”), and use:

`https://music-slay-2026.vda45lol.workers.dev`

The static frontend must be deployed to this Worker hostname before the button can launch the actual UI. At present, only the Worker API module has been deployed; the Vite static asset bundle is not attached yet.

## 3. Authentication flow

Telegram Web App SDK supplies `Telegram.WebApp.initData`. The frontend posts that exact string to `POST /api/telegram/session`. The Worker verifies Telegram's HMAC signature and `auth_date` (maximum age: 24 hours) before reading the user ID or assigning a role.

The frontend must not use `initDataUnsafe` for authorization. Roles are assigned on the server:
- `ADMIN_TELEGRAM_ID` → admin
- `JURY_TELEGRAM_IDS` → jury
- `OBSERVER_TELEGRAM_IDS` → observer
- all other verified users → participant

## 4. Verify

After adding the secrets, check:
- `GET /api/health` — `telegramConfigured` should be `true`.
- Launch from Telegram, not from a normal browser tab.
- The session endpoint should return `authenticated: true` and a server-assigned role.

Database writes are intentionally not enabled by this authentication endpoint. They require a separate server-side authorization and validation layer, plus a Supabase server secret stored only in Cloudflare.
