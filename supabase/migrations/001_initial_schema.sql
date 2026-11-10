-- MUSIC SLAY 2026 initial schema
-- Apply after creating the dedicated Supabase project.
create extension if not exists pgcrypto;

create table if not exists public.slays (
 id uuid primary key default gen_random_uuid(),
 title text not null,
 current_phase text not null default 'preparation' check (current_phase in ('preparation','candidates','voting','jury','awards')),
 phase_started_at timestamptz,
 phase_ends_at timestamptz,
 created_at timestamptz not null default now()
);

create table if not exists public.nominations (
 id uuid primary key default gen_random_uuid(),
 slay_id uuid not null references public.slays(id) on delete cascade,
 name text not null,
 position integer not null default 0,
 locked_at timestamptz,
 created_at timestamptz not null default now(),
 unique(slay_id,name)
);

create table if not exists public.candidates (
 id uuid primary key default gen_random_uuid(),
 nomination_id uuid not null references public.nominations(id) on delete cascade,
 display_name text not null,
 normalized_name text not null,
 suggestion_count integer not null default 0 check (suggestion_count >= 0),
 created_at timestamptz not null default now(),
 unique(nomination_id,normalized_name)
);

create table if not exists public.submissions (
 id uuid primary key default gen_random_uuid(),
 nomination_id uuid not null references public.nominations(id) on delete cascade,
 candidate_id uuid not null references public.candidates(id) on delete cascade,
 submitter_hash text not null,
 created_at timestamptz not null default now(),
 unique(nomination_id,candidate_id,submitter_hash)
);

create table if not exists public.votes (
 id uuid primary key default gen_random_uuid(),
 nomination_id uuid not null references public.nominations(id) on delete cascade,
 candidate_id uuid not null references public.candidates(id) on delete cascade,
 voter_hash text not null,
 created_at timestamptz not null default now(),
 unique(nomination_id,candidate_id,voter_hash)
);

create table if not exists public.jury_scores (
 id uuid primary key default gen_random_uuid(),
 nomination_id uuid not null references public.nominations(id) on delete cascade,
 candidate_id uuid not null references public.candidates(id) on delete cascade,
 juror_telegram_id text not null,
 score integer not null check(score between 0 and 10),
 updated_at timestamptz not null default now(),
 unique(nomination_id,candidate_id,juror_telegram_id)
);

create table if not exists public.observer_permissions (
 telegram_id text primary key,
 created_at timestamptz not null default now()
);

create table if not exists public.admin_action_log (
 id uuid primary key default gen_random_uuid(),
 actor_telegram_id text not null,
 action text not null,
 details jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now()
);

alter table public.slays enable row level security;
alter table public.nominations enable row level security;
alter table public.candidates enable row level security;
alter table public.submissions enable row level security;
alter table public.votes enable row level security;
alter table public.jury_scores enable row level security;
alter table public.observer_permissions enable row level security;
alter table public.admin_action_log enable row level security;

-- No anonymous write policies are created. Mutations must go through authenticated,
-- server-side API handlers after Telegram initData validation and phase checks.
-- Public read policies will be added only for explicitly safe published data.
