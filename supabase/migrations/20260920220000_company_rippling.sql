-- Company Rippling OAuth app + shared HR connection. Staff read employees
-- through the proxy; only a System Admin, GM, or HR may change the secrets.
-- Authenticated clients never read this table — the proxy uses the service role.

create table if not exists public.company_rippling (
  id boolean primary key default true check (id),
  oauth_client_id text not null default '',
  oauth_client_secret text not null default '',
  access_token text not null default '',
  refresh_token text not null default '',
  token_source text not null default ''
    check (token_source in ('', 'oauth', 'api-token')),
  company_name text not null default '',
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id)
);

alter table public.company_rippling
  drop constraint if exists company_rippling_oauth_client_id_len;
alter table public.company_rippling
  add constraint company_rippling_oauth_client_id_len
  check (char_length(oauth_client_id) <= 256);

alter table public.company_rippling
  drop constraint if exists company_rippling_oauth_client_secret_len;
alter table public.company_rippling
  add constraint company_rippling_oauth_client_secret_len
  check (char_length(oauth_client_secret) <= 512);

alter table public.company_rippling
  drop constraint if exists company_rippling_access_token_len;
alter table public.company_rippling
  add constraint company_rippling_access_token_len
  check (char_length(access_token) <= 4096);

alter table public.company_rippling
  drop constraint if exists company_rippling_refresh_token_len;
alter table public.company_rippling
  add constraint company_rippling_refresh_token_len
  check (char_length(refresh_token) <= 4096);

alter table public.company_rippling
  drop constraint if exists company_rippling_company_name_len;
alter table public.company_rippling
  add constraint company_rippling_company_name_len
  check (char_length(company_name) <= 256);

insert into public.company_rippling (id)
values (true)
on conflict (id) do nothing;

alter table public.company_rippling enable row level security;
alter table public.company_rippling force row level security;

revoke all on public.company_rippling from public, anon, authenticated;
grant select, insert, update, delete on table public.company_rippling to service_role;

notify pgrst, 'reload schema';
