-- Per-transaction bill/coin slips (given vs received).
-- Home / store snapshot save these; Audit → Cash sums them for expected denom counts.

create table if not exists public.transaction_cash_breakdowns (
  transaction_id text primary key,
  source_id text,
  txn_type text not null default 'order',
  system_key text,
  store_key text not null,
  store_name text not null,
  txn_date date not null,
  currency text not null default 'CAD',
  received jsonb not null default '{}'::jsonb,
  given jsonb not null default '{}'::jsonb,
  cash_amount numeric,
  net_amount numeric,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id)
);

create index if not exists transaction_cash_breakdowns_store_day_idx
  on public.transaction_cash_breakdowns (store_key, txn_date, currency);

alter table public.transaction_cash_breakdowns enable row level security;
alter table public.transaction_cash_breakdowns force row level security;

revoke all on public.transaction_cash_breakdowns from public, anon;
grant select, insert, update, delete on table public.transaction_cash_breakdowns
  to authenticated, service_role;

drop policy if exists transaction_cash_breakdowns_select on public.transaction_cash_breakdowns;
drop policy if exists transaction_cash_breakdowns_insert on public.transaction_cash_breakdowns;
drop policy if exists transaction_cash_breakdowns_update on public.transaction_cash_breakdowns;
drop policy if exists transaction_cash_breakdowns_delete on public.transaction_cash_breakdowns;

create policy transaction_cash_breakdowns_select
  on public.transaction_cash_breakdowns
  for select
  to authenticated
  using (public.is_active_staff());

create policy transaction_cash_breakdowns_insert
  on public.transaction_cash_breakdowns
  for insert
  to authenticated
  with check (public.is_active_staff());

create policy transaction_cash_breakdowns_update
  on public.transaction_cash_breakdowns
  for update
  to authenticated
  using (public.is_active_staff())
  with check (public.is_active_staff());

create policy transaction_cash_breakdowns_delete
  on public.transaction_cash_breakdowns
  for delete
  to authenticated
  using (public.is_active_staff());

notify pgrst, 'reload schema';
