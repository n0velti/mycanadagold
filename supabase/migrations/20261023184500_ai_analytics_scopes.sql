-- Analytics AI data scopes (self / store / company) per role, plus optional
-- per-person overrides. Does not change visible_apps. user_ai_access is
-- separate so a custom AI scope does not force a custom app set.

alter table public.role_app_access
  add column if not exists ai_scopes jsonb not null default '{}'::jsonb;

alter table public.role_app_access
  drop constraint if exists role_app_access_ai_scopes_object;
alter table public.role_app_access
  add constraint role_app_access_ai_scopes_object
  check (jsonb_typeof(ai_scopes) = 'object');

update public.role_app_access
set ai_scopes = '{
  "compensation": "self",
  "hours": "store",
  "employeePerformance": "store"
}'::jsonb
where role in ('precious_metal_analyst', 'triage')
  and (ai_scopes = '{}'::jsonb or ai_scopes is null);

update public.role_app_access
set ai_scopes = '{
  "compensation": "store",
  "hours": "store",
  "employeePerformance": "store"
}'::jsonb
where role = 'branch_manager'
  and (ai_scopes = '{}'::jsonb or ai_scopes is null);

update public.role_app_access
set ai_scopes = '{
  "compensation": "company",
  "hours": "company",
  "employeePerformance": "company"
}'::jsonb
where role in ('hr', 'general_manager', 'system_admin')
  and (ai_scopes = '{}'::jsonb or ai_scopes is null);

create table if not exists public.user_ai_access (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  scopes jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id)
);

alter table public.user_ai_access
  drop constraint if exists user_ai_access_scopes_object;
alter table public.user_ai_access
  add constraint user_ai_access_scopes_object
  check (jsonb_typeof(scopes) = 'object');

create index if not exists user_ai_access_updated_at_idx
  on public.user_ai_access (updated_at desc);

alter table public.user_ai_access enable row level security;
alter table public.user_ai_access force row level security;

revoke all on public.user_ai_access from public, anon;
grant select, insert, update, delete on public.user_ai_access to authenticated;

drop policy if exists user_ai_access_select on public.user_ai_access;
drop policy if exists user_ai_access_insert on public.user_ai_access;
drop policy if exists user_ai_access_update on public.user_ai_access;
drop policy if exists user_ai_access_delete on public.user_ai_access;

create policy user_ai_access_select
  on public.user_ai_access
  for select
  to authenticated
  using (
    user_id = (select auth.uid())
    or (select public.current_user_is_system_admin())
  );

create policy user_ai_access_insert
  on public.user_ai_access
  for insert
  to authenticated
  with check ((select public.current_user_is_system_admin()));

create policy user_ai_access_update
  on public.user_ai_access
  for update
  to authenticated
  using ((select public.current_user_is_system_admin()))
  with check ((select public.current_user_is_system_admin()));

create policy user_ai_access_delete
  on public.user_ai_access
  for delete
  to authenticated
  using ((select public.current_user_is_system_admin()));

notify pgrst, 'reload schema';
