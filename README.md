# MUSIC SLAY 2026

Web app for a multi-stage music awards process.

## Stack
- React + Vite frontend
- Cloudflare Workers runtime and static assets
- Supabase Postgres with Row Level Security
- Future Telegram Mini App integration

## Local development
```bash
npm install
npm run dev
```

## Build and deploy
```bash
npm run build
npx wrangler deploy
```

Configure Worker secrets before enabling backend routes:
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY` (server-side only if needed)
- `SUPABASE_SERVICE_ROLE_KEY` (secret; never expose to browser)
- `TELEGRAM_BOT_TOKEN`

Set frontend public variables only when intentionally used:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

## Current status
Initial UI and infrastructure scaffold. The UI uses placeholder candidates such as Артист1 and Название трека1. API mutations, Telegram authentication, phase timers, voting rules, jury formula, and award publication require backend implementation before production use.

## Database
Apply `supabase/migrations/001_initial_schema.sql` to the dedicated Supabase project after it is created. Do not use a production service-role key in the frontend.
