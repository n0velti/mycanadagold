-- Phone app: grant visibility, then persist per-store RingCentral JWT credentials.

update public.role_app_access
set
  visible_apps = visible_apps || '["phone"]'::jsonb,
  updated_at = now()
where not coalesce(visible_apps, '[]'::jsonb) ? 'phone';

create table if not exists public.ringcentral_accounts (
  id uuid primary key default gen_random_uuid(),
  store_key text not null,
  store_name text not null,
  client_id text not null default '',
  client_secret text not null default '',
  jwt text not null default '',
  server_url text not null default 'https://platform.ringcentral.com',
  account_id text not null default '',
  company_name text not null default '',
  main_number text not null default '',
  extension_count integer not null default 0,
  last_status text not null default '',
  last_error text not null default '',
  last_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id)
);

alter table public.ringcentral_accounts
  drop constraint if exists ringcentral_accounts_store_key_key;
alter table public.ringcentral_accounts
  add constraint ringcentral_accounts_store_key_key
  unique (store_key);

alter table public.ringcentral_accounts
  drop constraint if exists ringcentral_accounts_store_key_len;
alter table public.ringcentral_accounts
  add constraint ringcentral_accounts_store_key_len
  check (char_length(trim(store_key)) between 1 and 80);

alter table public.ringcentral_accounts
  drop constraint if exists ringcentral_accounts_server_url_check;
alter table public.ringcentral_accounts
  add constraint ringcentral_accounts_server_url_check
  check (server_url in (
    'https://platform.ringcentral.com',
    'https://platform.devtest.ringcentral.com'
  ));

alter table public.ringcentral_accounts
  drop column if exists has_client_id;
alter table public.ringcentral_accounts
  drop column if exists has_secret;
alter table public.ringcentral_accounts
  drop column if exists has_jwt;

alter table public.ringcentral_accounts
  add column has_client_id boolean generated always as (char_length(trim(client_id)) > 0) stored;
alter table public.ringcentral_accounts
  add column has_secret boolean generated always as (char_length(trim(client_secret)) > 0) stored;
alter table public.ringcentral_accounts
  add column has_jwt boolean generated always as (char_length(trim(jwt)) > 0) stored;

create index if not exists ringcentral_accounts_store_name_idx
  on public.ringcentral_accounts (store_name);

alter table public.ringcentral_accounts enable row level security;
alter table public.ringcentral_accounts force row level security;

revoke all on public.ringcentral_accounts from public, anon;

-- Staff can list connection status; client id / secret / JWT stay write-only.
grant select (
  id, store_key, store_name, server_url, account_id, company_name, main_number,
  extension_count, last_status, last_error, last_checked_at, created_at, updated_at,
  updated_by, has_client_id, has_secret, has_jwt
) on public.ringcentral_accounts to authenticated;
grant insert, update, delete on table public.ringcentral_accounts to authenticated, service_role;
grant select, insert, update, delete on table public.ringcentral_accounts to service_role;

drop policy if exists ringcentral_accounts_select on public.ringcentral_accounts;
drop policy if exists ringcentral_accounts_insert on public.ringcentral_accounts;
drop policy if exists ringcentral_accounts_update on public.ringcentral_accounts;
drop policy if exists ringcentral_accounts_delete on public.ringcentral_accounts;

create policy ringcentral_accounts_select
  on public.ringcentral_accounts
  for select
  to authenticated
  using (public.is_active_staff());

create policy ringcentral_accounts_insert
  on public.ringcentral_accounts
  for insert
  to authenticated
  with check (public.current_user_can_manage_store_settings());

create policy ringcentral_accounts_update
  on public.ringcentral_accounts
  for update
  to authenticated
  using (public.current_user_can_manage_store_settings())
  with check (public.current_user_can_manage_store_settings());

create policy ringcentral_accounts_delete
  on public.ringcentral_accounts
  for delete
  to authenticated
  using (public.current_user_can_manage_store_settings());

notify pgrst, 'reload schema';
