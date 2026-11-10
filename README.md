# MUSIC SLAY 2026

Web app for a multi-stage music awards process.

## Stack
- React + Vite frontend
- Cloudflare Workers runtime and static assets
- Supabase Postgres with Row Level Security
- Future Telegram Mini App integration

## Infrastructure
- Supabase project: `ueqetvauqgrdyghxdyip`
- Supabase region: `eu-north-1`
- Supabase URL: `https://ueqetvauqgrdyghxdyip.supabase.co`
- Database migration `supabase/migrations/001_initial_schema.sql` has been applied and verified (8 public tables, RLS enabled).

## Local development
```bash
npm install
cp .env.example .env.local
npm run dev
```

The browser may use only the Supabase publishable/anon key. Never put a service-role or secret key in a `VITE_*` variable.

## Cloudflare Worker
Worker name: `music-slay-2026`.

The Worker has Supabase URL and publishable key configured as Worker-side bindings. A service-role key and Telegram bot token have not been configured. Do not enable privileged writes until Telegram `initData` validation and server-side authorization are implemented.

The Worker is deployed, but a public `workers.dev` hostname is not yet provisioned for this Cloudflare account. Open the Workers & Pages dashboard once to create the account subdomain, then deploy/attach the static frontend.

## Build and deploy
```bash
npm run build
npx wrangler deploy
```

## Current implementation status
The repository contains the initial React UI and infrastructure scaffold. The UI still uses placeholder candidates (Артист1, Название трека1, etc.) and local component state. Database schema exists, but UI actions are not yet persisted to Supabase. API mutations, Telegram authentication, server-side phase timers, nomination isolation, voting rules, jury formula, and award publication must be implemented and tested before production use.

The jury scoring formula remains intentionally unimplemented pending approval.
