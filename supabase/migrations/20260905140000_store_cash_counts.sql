-- Per-store, per-day till count worksheets (loose bills + straps/rolls).
-- Audit → Cash saves these; Home store snapshot reads them next to expected cash.

create table if not exists public.store_cash_counts (
  store_key text not null,
  store_name text not null,
  count_date date not null,
  currency text not null default 'CAD',
  loose jsonb not null default '{}'::jsonb,
  stacks jsonb not null default '{}'::jsonb,
  other_cash numeric,
  counted_total numeric,
  counted_manual boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id),
  primary key (store_key, count_date, currency)
);

alter table public.store_cash_counts enable row level security;
alter table public.store_cash_counts force row level security;

revoke all on public.store_cash_counts from public, anon;
grant select, insert, update, delete on table public.store_cash_counts
  to authenticated, service_role;

drop policy if exists store_cash_counts_select on public.store_cash_counts;
drop policy if exists store_cash_counts_insert on public.store_cash_counts;
drop policy if exists store_cash_counts_update on public.store_cash_counts;
drop policy if exists store_cash_counts_delete on public.store_cash_counts;

create policy store_cash_counts_select
  on public.store_cash_counts
  for select
  to authenticated
  using (public.is_active_staff());

create policy store_cash_counts_insert
  on public.store_cash_counts
  for insert
  to authenticated
  with check (public.is_active_staff());

create policy store_cash_counts_update
  on public.store_cash_counts
  for update
  to authenticated
  using (public.is_active_staff())
  with check (public.is_active_staff());

create policy store_cash_counts_delete
  on public.store_cash_counts
  for delete
  to authenticated
  using (public.is_active_staff());

notify pgrst, 'reload schema';
