-- Per-store hours and holidays. POS locations stay in Aureus; this table
-- holds the schedule the app uses for each branch name.

create or replace function public.current_user_can_manage_store_settings()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select p.app_role in ('branch_manager', 'general_manager', 'system_admin')
        or p.is_system_admin
      from public.profiles p
      where p.id = auth.uid()
    ),
    false
  );
$$;

revoke all on function public.current_user_can_manage_store_settings() from public, anon;
grant execute on function public.current_user_can_manage_store_settings() to authenticated;

create table if not exists public.store_settings (
  store_key text primary key,
  store_name text not null,
  hours jsonb not null default '[]'::jsonb,
  holidays jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id)
);

alter table public.store_settings
  drop constraint if exists store_settings_hours_array;
alter table public.store_settings
  add constraint store_settings_hours_array
  check (jsonb_typeof(hours) = 'array');

alter table public.store_settings
  drop constraint if exists store_settings_holidays_array;
alter table public.store_settings
  add constraint store_settings_holidays_array
  check (jsonb_typeof(holidays) = 'array');

alter table public.store_settings enable row level security;
alter table public.store_settings force row level security;

revoke all on public.store_settings from public, anon;
grant select, insert, update on table public.store_settings to authenticated, service_role;

drop policy if exists store_settings_select on public.store_settings;
drop policy if exists store_settings_insert on public.store_settings;
drop policy if exists store_settings_update on public.store_settings;

create policy store_settings_select
  on public.store_settings
  for select
  to authenticated
  using (true);

create policy store_settings_insert
  on public.store_settings
  for insert
  to authenticated
  with check (public.current_user_can_manage_store_settings());

create policy store_settings_update
  on public.store_settings
  for update
  to authenticated
  using (public.current_user_can_manage_store_settings())
  with check (public.current_user_can_manage_store_settings());

notify pgrst, 'reload schema';
