-- Per-person app visibility and filter rights.
-- Settings → Permissions lets a System Admin override category defaults for
-- anyone who has signed in. Missing row = inherit that person's category.

create table if not exists public.user_app_access (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  visible_apps jsonb not null default '[]'::jsonb,
  filterable_apps jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id)
);

alter table public.user_app_access
  drop constraint if exists user_app_access_visible_apps_array;
alter table public.user_app_access
  add constraint user_app_access_visible_apps_array
  check (jsonb_typeof(visible_apps) = 'array');

alter table public.user_app_access
  drop constraint if exists user_app_access_filterable_apps_array;
alter table public.user_app_access
  add constraint user_app_access_filterable_apps_array
  check (jsonb_typeof(filterable_apps) = 'array');

create index if not exists user_app_access_updated_at_idx
  on public.user_app_access (updated_at desc);

alter table public.user_app_access enable row level security;
alter table public.user_app_access force row level security;

revoke all on public.user_app_access from public, anon;
grant select, insert, update, delete on public.user_app_access to authenticated;

drop policy if exists user_app_access_select on public.user_app_access;
drop policy if exists user_app_access_insert on public.user_app_access;
drop policy if exists user_app_access_update on public.user_app_access;
drop policy if exists user_app_access_delete on public.user_app_access;

create policy user_app_access_select
  on public.user_app_access
  for select
  to authenticated
  using (user_id = auth.uid() or public.current_user_is_system_admin());

create policy user_app_access_insert
  on public.user_app_access
  for insert
  to authenticated
  with check (public.current_user_is_system_admin());

create policy user_app_access_update
  on public.user_app_access
  for update
  to authenticated
  using (public.current_user_is_system_admin())
  with check (public.current_user_is_system_admin());

create policy user_app_access_delete
  on public.user_app_access
  for delete
  to authenticated
  using (public.current_user_is_system_admin());

notify pgrst, 'reload schema';
