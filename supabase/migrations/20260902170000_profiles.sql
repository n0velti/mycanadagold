-- Staff profiles, keyed to Supabase Auth.
-- Login is still decided by Aureus POS; this table is the durable reference
-- used across the app after a valid POS sign-in.

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  aureus_user_id text not null unique,
  aureus_login text not null,
  email text,
  first_name text,
  last_name text,
  full_name text,
  role text,
  location_id text,
  location_name text,
  aureus_payload jsonb not null default '{}'::jsonb,
  pinned_tools jsonb,
  last_login_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists profiles_aureus_login_idx on public.profiles (aureus_login);
create index if not exists profiles_email_idx on public.profiles (email);

alter table public.profiles enable row level security;
alter table public.profiles force row level security;

revoke all on public.profiles from public, anon;
grant select, insert, update on public.profiles to authenticated;

drop policy if exists profiles_select_own on public.profiles;
drop policy if exists profiles_insert_own on public.profiles;
drop policy if exists profiles_update_own on public.profiles;

create policy profiles_select_own
  on public.profiles
  for select
  to authenticated
  using (id = auth.uid());

create policy profiles_insert_own
  on public.profiles
  for insert
  to authenticated
  with check (id = auth.uid());

create policy profiles_update_own
  on public.profiles
  for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());
