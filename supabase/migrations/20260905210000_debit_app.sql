-- Debit app: grant visibility, then persist Move 5000 Cloud terminals and receipts.

update public.role_app_access
set
  visible_apps = visible_apps || '["debit"]'::jsonb,
  updated_at = now()
where not coalesce(visible_apps, '[]'::jsonb) ? 'debit';

create table if not exists public.moneris_terminals (
  id uuid primary key default gen_random_uuid(),
  store_key text not null,
  store_name text not null,
  label text not null default '',
  terminal_id text not null,
  store_id text not null,
  api_token text not null default '',
  environment text not null default 'core',
  ist_config_code text not null default '',
  lan_ip text not null default '',
  last_seen_at timestamptz,
  last_status text not null default '',
  last_error text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id)
);

alter table public.moneris_terminals
  drop constraint if exists moneris_terminals_environment_check;
alter table public.moneris_terminals
  add constraint moneris_terminals_environment_check
  check (environment in ('core', 'production', 'qa'));

alter table public.moneris_terminals
  drop constraint if exists moneris_terminals_store_terminal_key;
alter table public.moneris_terminals
  add constraint moneris_terminals_store_terminal_key
  unique (store_key, terminal_id);

create index if not exists moneris_terminals_store_key_idx
  on public.moneris_terminals (store_key);

create table if not exists public.moneris_transactions (
  id uuid primary key default gen_random_uuid(),
  terminal_id_ref uuid references public.moneris_terminals (id) on delete set null,
  store_key text not null,
  store_name text not null,
  terminal_id text not null,
  order_id text not null,
  cloud_ticket text not null default '',
  action text not null default 'purchase',
  amount numeric not null default 0,
  currency text not null default 'CAD',
  card_type text not null default '',
  card_last4 text not null default '',
  auth_code text not null default '',
  response_code text not null default '',
  approved boolean not null default false,
  transacted_on date not null,
  transacted_at timestamptz not null default now(),
  receipt jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id)
);

alter table public.moneris_transactions
  drop constraint if exists moneris_transactions_order_id_key;
alter table public.moneris_transactions
  add constraint moneris_transactions_order_id_key
  unique (order_id);

create index if not exists moneris_transactions_store_day_idx
  on public.moneris_transactions (store_key, transacted_on);
create index if not exists moneris_transactions_day_idx
  on public.moneris_transactions (transacted_on);

alter table public.moneris_terminals enable row level security;
alter table public.moneris_terminals force row level security;
alter table public.moneris_transactions enable row level security;
alter table public.moneris_transactions force row level security;

revoke all on public.moneris_terminals from public, anon;
revoke all on public.moneris_transactions from public, anon;

-- Staff can list terminals; the API token is service-role / write-only.
grant select (
  id, store_key, store_name, label, terminal_id, store_id, environment,
  ist_config_code, lan_ip, last_seen_at, last_status, last_error,
  created_at, updated_at, updated_by
) on public.moneris_terminals to authenticated;
grant insert, update, delete on table public.moneris_terminals to authenticated, service_role;
grant select, insert, update, delete on table public.moneris_terminals to service_role;

grant select, insert, update on table public.moneris_transactions to authenticated, service_role;
grant delete on table public.moneris_transactions to authenticated, service_role;

drop policy if exists moneris_terminals_select on public.moneris_terminals;
drop policy if exists moneris_terminals_insert on public.moneris_terminals;
drop policy if exists moneris_terminals_update on public.moneris_terminals;
drop policy if exists moneris_terminals_delete on public.moneris_terminals;

create policy moneris_terminals_select
  on public.moneris_terminals
  for select
  to authenticated
  using (public.is_active_staff());

create policy moneris_terminals_insert
  on public.moneris_terminals
  for insert
  to authenticated
  with check (public.current_user_can_manage_store_settings());

create policy moneris_terminals_update
  on public.moneris_terminals
  for update
  to authenticated
  using (public.current_user_can_manage_store_settings())
  with check (public.current_user_can_manage_store_settings());

create policy moneris_terminals_delete
  on public.moneris_terminals
  for delete
  to authenticated
  using (public.current_user_can_manage_store_settings());

drop policy if exists moneris_transactions_select on public.moneris_transactions;
drop policy if exists moneris_transactions_insert on public.moneris_transactions;
drop policy if exists moneris_transactions_update on public.moneris_transactions;
drop policy if exists moneris_transactions_delete on public.moneris_transactions;

create policy moneris_transactions_select
  on public.moneris_transactions
  for select
  to authenticated
  using (public.is_active_staff());

create policy moneris_transactions_insert
  on public.moneris_transactions
  for insert
  to authenticated
  with check (public.is_active_staff());

create policy moneris_transactions_update
  on public.moneris_transactions
  for update
  to authenticated
  using (public.is_active_staff())
  with check (public.is_active_staff());

create policy moneris_transactions_delete
  on public.moneris_transactions
  for delete
  to authenticated
  using (public.current_user_can_manage_store_settings());

alter table public.moneris_transactions replica identity full;

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    return;
  end if;
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'moneris_transactions'
  ) then
    execute 'alter publication supabase_realtime add table public.moneris_transactions';
  end if;
end $$;

notify pgrst, 'reload schema';
