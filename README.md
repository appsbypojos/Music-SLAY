# MUSIC SLAY 2026

React + Vite frontend and Cloudflare Worker API for the MUSIC SLAY 2026 awards flow.

## Infrastructure
- Supabase project: `ueqetvauqgrdyghxdyip` (region `eu-north-1`)
- Cloudflare Worker: `music-slay-2026`
- Worker hostname: `https://music-slay-2026.vda45lol.workers.dev`
- Telegram Mini App SDK is loaded by `index.html`.
- Telegram `initData` is verified in the Worker using Telegram's HMAC-SHA-256 procedure. The browser never decides its own role.

## Telegram setup required
Set these Worker secrets in Cloudflare Dashboard → Workers & Pages → music-slay-2026 → Settings → Variables and Secrets:
- `TELEGRAM_BOT_TOKEN` — token from BotFather. Never commit it or place it in a Vite environment variable.
- `ADMIN_TELEGRAM_ID` — Telegram numeric ID of the main administrator.

Optional comma-separated Worker secrets:
- `JURY_TELEGRAM_IDS`
- `OBSERVER_TELEGRAM_IDS`

Then configure the bot's Mini App URL in BotFather:
1. Open @BotFather and select the bot.
2. Use `/setmenubutton` and choose a title.
3. Set the Web App URL to `https://music-slay-2026.vda45lol.workers.dev`.
4. Open the bot in Telegram and launch the menu button.

The Worker exposes `POST /api/telegram/session`, which accepts the raw `initData` string and returns a verified user and role. It rejects missing, malformed, expired, or incorrectly signed data. Authentication currently has a 24-hour maximum age.

## Database security
The Supabase migration creates the initial schema with RLS enabled and no anonymous write policies. Do not expose the Supabase service-role key in the frontend. A server-side database key and the actual mutation handlers are still required before submissions, voting, jury scoring, phase transitions, or award publication can be persisted.

## Build and deployment
```bash
npm install
npm run build
npx wrangler deploy
```

The Worker API code has been uploaded. The static Vite build is not yet attached to the Worker deployment; the root URL may therefore return the API placeholder until the frontend assets are deployed. The Telegram bot token is also not yet configured, so the session endpoint will return `telegram_not_configured` until the secret is added.

## Current implementation boundary
- Implemented in source: Telegram Web App SDK initialization, server-side `initData` signature and freshness verification, server-derived role mapping, health/config endpoints.
- Not yet implemented: persistent application API mutations, server-enforced phase timers and transitions, nomination and vote persistence, jury workflow, approved scoring formula, award publication, and the final slideshow data feed.
- No scoring formula is assumed. The previously discussed weighting needs explicit approval before implementation.
