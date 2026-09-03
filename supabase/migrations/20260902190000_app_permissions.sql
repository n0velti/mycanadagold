-- App access by staff category, plus a GM-as-system-admin flag.
-- Settings → Permissions writes role_app_access. System Admin always has every app.

alter table public.profiles
  add column if not exists app_role text not null default 'precious_metal_analyst';

alter table public.profiles
  add column if not exists is_system_admin boolean not null default false;

alter table public.profiles drop constraint if exists profiles_app_role_check;
alter table public.profiles
  add constraint profiles_app_role_check
  check (
    app_role in (
      'precious_metal_analyst',
      'branch_manager',
      'general_manager',
      'system_admin'
    )
  );

create index if not exists profiles_app_role_idx on public.profiles (app_role);

create or replace function public.current_user_is_system_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select p.app_role = 'system_admin' or p.is_system_admin
      from public.profiles p
      where p.id = auth.uid()
    ),
    false
  );
$$;

revoke all on function public.current_user_is_system_admin() from public, anon;
grant execute on function public.current_user_is_system_admin() to authenticated;

create or replace function public.profiles_guard_app_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  admin_exists boolean;
  other_admin_exists boolean;
begin
  select exists (
    select 1
    from public.profiles p
    where p.app_role = 'system_admin' or p.is_system_admin
  ) into admin_exists;

  if tg_op = 'INSERT' then
    if not admin_exists then
      new.app_role := 'system_admin';
      new.is_system_admin := true;
    else
      if new.app_role is null or new.app_role not in (
        'precious_metal_analyst',
        'branch_manager',
        'general_manager'
      ) then
        new.app_role := 'precious_metal_analyst';
      end if;
      new.is_system_admin := false;
    end if;
    return new;
  end if;

  -- auth.uid() is null for SQL editor / service role; those may assign roles.
  if auth.uid() is not null and not public.current_user_is_system_admin() then
    new.app_role := old.app_role;
    new.is_system_admin := old.is_system_admin;
    return new;
  end if;

  if new.app_role is null or new.app_role not in (
    'precious_metal_analyst',
    'branch_manager',
    'general_manager',
    'system_admin'
  ) then
    new.app_role := old.app_role;
  end if;

  if new.app_role = 'system_admin' then
    new.is_system_admin := true;
  elsif new.app_role <> 'general_manager' then
    new.is_system_admin := false;
  end if;

  if (old.app_role = 'system_admin' or old.is_system_admin)
     and not (new.app_role = 'system_admin' or new.is_system_admin) then
    select exists (
      select 1
      from public.profiles p
      where p.id <> old.id
        and (p.app_role = 'system_admin' or p.is_system_admin)
    ) into other_admin_exists;
    if not other_admin_exists then
      raise exception 'Keep at least one System Admin';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_guard_app_role on public.profiles;
create trigger profiles_guard_app_role
  before insert or update on public.profiles
  for each row
  execute function public.profiles_guard_app_role();

revoke all on function public.profiles_guard_app_role() from public, anon, authenticated;

drop policy if exists profiles_select_own on public.profiles;
drop policy if exists profiles_select_own_or_admin on public.profiles;
drop policy if exists profiles_update_admin on public.profiles;

create policy profiles_select_own_or_admin
  on public.profiles
  for select
  to authenticated
  using (id = auth.uid() or public.current_user_is_system_admin());

create policy profiles_update_admin
  on public.profiles
  for update
  to authenticated
  using (public.current_user_is_system_admin())
  with check (public.current_user_is_system_admin());

update public.profiles
set app_role = 'system_admin',
    is_system_admin = true
where id = (
  select p.id
  from public.profiles p
  order by p.created_at asc
  limit 1
)
and not exists (
  select 1
  from public.profiles p
  where p.app_role = 'system_admin' or p.is_system_admin
);

create table if not exists public.role_app_access (
  role text primary key
    check (
      role in (
        'precious_metal_analyst',
        'branch_manager',
        'general_manager',
        'system_admin'
      )
    ),
  visible_apps jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id)
);

alter table public.role_app_access
  drop constraint if exists role_app_access_visible_apps_array;
alter table public.role_app_access
  add constraint role_app_access_visible_apps_array
  check (jsonb_typeof(visible_apps) = 'array');

alter table public.role_app_access enable row level security;
alter table public.role_app_access force row level security;

revoke all on public.role_app_access from public, anon;
grant select, insert, update on public.role_app_access to authenticated;

drop policy if exists role_app_access_select on public.role_app_access;
drop policy if exists role_app_access_insert on public.role_app_access;
drop policy if exists role_app_access_update on public.role_app_access;

create policy role_app_access_select
  on public.role_app_access
  for select
  to authenticated
  using (true);

create policy role_app_access_insert
  on public.role_app_access
  for insert
  to authenticated
  with check (public.current_user_is_system_admin());

create policy role_app_access_update
  on public.role_app_access
  for update
  to authenticated
  using (public.current_user_is_system_admin())
  with check (public.current_user_is_system_admin());

insert into public.role_app_access (role, visible_apps)
values
  (
    'precious_metal_analyst',
    '["transactions","inventory","ai","transfer","trends","financials","100-ways","cdn-coin","pmx","storage","shipping"]'::jsonb
  ),
  (
    'branch_manager',
    '["transactions","inventory","ai","audit","transfer","fintrac","financials","trends","bonuses","leaderboards","tasks","police-report","serphint","supplies","employees","customers","calendar","notifications","reviews","emails","documents","contacts","triage","100-ways","cdn-coin","pmx","shipping","storage"]'::jsonb
  ),
  (
    'general_manager',
    '["transactions","inventory","ai","audit","transfer","fintrac","financials","trends","bonuses","leaderboards","tasks","police-report","security","serphint","supplies","employees","customers","calendar","notifications","reviews","emails","documents","contacts","triage","100-ways","cdn-coin","pmx","shipping","storage"]'::jsonb
  ),
  (
    'system_admin',
    '["transactions","inventory","ai","audit","transfer","fintrac","financials","trends","bonuses","leaderboards","tasks","police-report","security","serphint","supplies","employees","customers","calendar","notifications","reviews","emails","documents","contacts","triage","100-ways","cdn-coin","pmx","shipping","storage","settings"]'::jsonb
  )
on conflict (role) do nothing;
