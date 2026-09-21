-- Freeze website prices at the moment a purchase is received, and let GMs
-- raise the match tolerance when spot moves between Aureus and the website.

create table if not exists public.price_check_settings (
  id smallint primary key default 1 check (id = 1),
  tolerance numeric not null default 0.01
    check (tolerance >= 0.001 and tolerance <= 0.20),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id)
);

insert into public.price_check_settings (id, tolerance)
values (1, 0.01)
on conflict (id) do nothing;

create table if not exists public.website_price_snapshots (
  catalog_updated text primary key,
  fetched_at timestamptz not null default now(),
  catalog jsonb not null
);

create table if not exists public.transaction_price_checks (
  transaction_id text primary key,
  catalog_updated text not null references public.website_price_snapshots (catalog_updated),
  checked_at timestamptz not null default now()
);

alter table public.price_check_settings enable row level security;
alter table public.price_check_settings force row level security;
alter table public.website_price_snapshots enable row level security;
alter table public.website_price_snapshots force row level security;
alter table public.transaction_price_checks enable row level security;
alter table public.transaction_price_checks force row level security;

revoke all on public.price_check_settings from public, anon;
revoke all on public.website_price_snapshots from public, anon;
revoke all on public.transaction_price_checks from public, anon;
grant select on table public.price_check_settings to authenticated, service_role;
grant insert, update on table public.price_check_settings to authenticated, service_role;
grant select, insert, update on table public.website_price_snapshots to authenticated, service_role;
grant select, insert on table public.transaction_price_checks to authenticated, service_role;

drop policy if exists price_check_settings_select on public.price_check_settings;
drop policy if exists price_check_settings_write on public.price_check_settings;
drop policy if exists website_price_snapshots_select on public.website_price_snapshots;
drop policy if exists website_price_snapshots_write on public.website_price_snapshots;
drop policy if exists transaction_price_checks_select on public.transaction_price_checks;
drop policy if exists transaction_price_checks_insert on public.transaction_price_checks;

create policy price_check_settings_select
  on public.price_check_settings
  for select
  to authenticated
  using (public.is_active_staff());

create policy price_check_settings_write
  on public.price_check_settings
  for all
  to authenticated
  using (public.current_user_can_manage_company_ai_keys())
  with check (public.current_user_can_manage_company_ai_keys());

create policy website_price_snapshots_select
  on public.website_price_snapshots
  for select
  to authenticated
  using (public.is_active_staff());

create policy website_price_snapshots_write
  on public.website_price_snapshots
  for insert
  to authenticated
  with check (public.is_active_staff());

drop policy if exists website_price_snapshots_update on public.website_price_snapshots;
create policy website_price_snapshots_update
  on public.website_price_snapshots
  for update
  to authenticated
  using (public.is_active_staff())
  with check (public.is_active_staff());

create policy transaction_price_checks_select
  on public.transaction_price_checks
  for select
  to authenticated
  using (public.is_active_staff());

create policy transaction_price_checks_insert
  on public.transaction_price_checks
  for insert
  to authenticated
  with check (public.is_active_staff());

notify pgrst, 'reload schema';
