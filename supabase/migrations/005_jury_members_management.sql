create table if not exists public.jury_members (
  telegram_id text primary key check (telegram_id ~ '^[0-9]{1,20}$'),
  display_name text not null default '',
  created_at timestamptz not null default now()
);

alter table public.jury_members enable row level security;
revoke all on table public.jury_members from anon, authenticated;
grant select, insert, update, delete on table public.jury_members to service_role;
