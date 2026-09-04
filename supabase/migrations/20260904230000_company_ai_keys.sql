-- Company-wide AI provider keys. Staff use these through the proxy; only a
-- System Admin or General Manager may read or change the values.

create or replace function public.current_user_can_manage_company_ai_keys()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_active_staff()
    and coalesce(
      (
        select p.app_role in ('general_manager', 'system_admin')
          or p.is_system_admin
        from public.profiles p
        where p.id = auth.uid()
      ),
      false
    );
$$;

revoke all on function public.current_user_can_manage_company_ai_keys() from public, anon;
grant execute on function public.current_user_can_manage_company_ai_keys() to authenticated, service_role;

create table if not exists public.company_ai_keys (
  provider text primary key
    check (provider in ('openai', 'anthropic', 'openrouter')),
  api_key text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id)
);

alter table public.company_ai_keys
  drop constraint if exists company_ai_keys_api_key_len;
alter table public.company_ai_keys
  add constraint company_ai_keys_api_key_len
  check (char_length(api_key) between 1 and 512);

alter table public.company_ai_keys enable row level security;
alter table public.company_ai_keys force row level security;

revoke all on public.company_ai_keys from public, anon;
grant select, insert, update, delete on table public.company_ai_keys to authenticated, service_role;

drop policy if exists company_ai_keys_select on public.company_ai_keys;
drop policy if exists company_ai_keys_insert on public.company_ai_keys;
drop policy if exists company_ai_keys_update on public.company_ai_keys;
drop policy if exists company_ai_keys_delete on public.company_ai_keys;

create policy company_ai_keys_select
  on public.company_ai_keys
  for select
  to authenticated
  using (public.current_user_can_manage_company_ai_keys());

create policy company_ai_keys_insert
  on public.company_ai_keys
  for insert
  to authenticated
  with check (public.current_user_can_manage_company_ai_keys());

create policy company_ai_keys_update
  on public.company_ai_keys
  for update
  to authenticated
  using (public.current_user_can_manage_company_ai_keys())
  with check (public.current_user_can_manage_company_ai_keys());

create policy company_ai_keys_delete
  on public.company_ai_keys
  for delete
  to authenticated
  using (public.current_user_can_manage_company_ai_keys());

-- GMs need Settings so they can paste keys. System Admin already has it.
update public.role_app_access
set visible_apps = visible_apps || '["settings"]'::jsonb,
    updated_at = now()
where role in ('general_manager', 'system_admin')
  and not visible_apps @> '["settings"]'::jsonb;

notify pgrst, 'reload schema';
