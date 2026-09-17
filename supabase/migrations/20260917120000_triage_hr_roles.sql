-- Add Triage and HR app roles. Settings → Permissions assigns these the
-- same way as Analyst / Branch / GM. HR can read the staff directory.

alter table public.profiles drop constraint if exists profiles_app_role_check;
alter table public.profiles
  add constraint profiles_app_role_check
  check (
    app_role in (
      'precious_metal_analyst',
      'triage',
      'hr',
      'branch_manager',
      'general_manager',
      'system_admin'
    )
  );

-- Postgres renders `role in (...)` as `role = ANY (ARRAY[...])`, so match on
-- the column rather than the original spelling. The inline check from the
-- create table is auto-named role_app_access_role_check; drop it by name too.
alter table public.role_app_access drop constraint if exists role_app_access_role_check;
do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select c.conname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'role_app_access'
      and c.contype = 'c'
      and (
        pg_get_constraintdef(c.oid) ilike '%role in%'
        or pg_get_constraintdef(c.oid) ilike '%role = any%'
      )
  loop
    execute format('alter table public.role_app_access drop constraint if exists %I', constraint_name);
  end loop;
end $$;
alter table public.role_app_access
  add constraint role_app_access_role_check
  check (
    role in (
      'precious_metal_analyst',
      'triage',
      'hr',
      'branch_manager',
      'general_manager',
      'system_admin'
    )
  );

create or replace function public.profiles_guard_app_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  requester text := public.request_role();
  admin_exists boolean;
  other_admin_exists boolean;
begin
  select exists (
    select 1
    from public.profiles p
    where p.is_active and (p.app_role = 'system_admin' or p.is_system_admin)
  ) into admin_exists;

  if tg_op = 'INSERT' then
    if not admin_exists then
      new.app_role := 'system_admin';
      new.is_system_admin := true;
    else
      if new.app_role is null or new.app_role not in (
        'precious_metal_analyst',
        'triage',
        'hr',
        'branch_manager',
        'general_manager'
      ) then
        new.app_role := 'precious_metal_analyst';
      end if;
      new.is_system_admin := false;
    end if;
    return new;
  end if;

  if requester = 'authenticated' and not public.current_user_is_system_admin() then
    new.app_role := old.app_role;
    new.is_system_admin := old.is_system_admin;
    return new;
  end if;

  if new.app_role is null or new.app_role not in (
    'precious_metal_analyst',
    'triage',
    'hr',
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
        and p.is_active
        and (p.app_role = 'system_admin' or p.is_system_admin)
    ) into other_admin_exists;
    if not other_admin_exists then
      raise exception 'Keep at least one System Admin';
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.current_user_can_view_staff_directory()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_active_staff()
    and coalesce(
      (
        select p.app_role in ('branch_manager', 'general_manager', 'system_admin', 'hr')
          or p.is_system_admin
        from public.profiles p
        where p.id = auth.uid()
      ),
      false
    );
$$;

insert into public.role_app_access (role, visible_apps)
values
  (
    'triage',
    '["triage","transfer","inventory","transactions","preorders","shipping","storage","messages","emails","phone","ai"]'::jsonb
  ),
  (
    'hr',
    '["employees","bonuses","leaderboards","tasks","calendar","messages","emails","documents","contacts","notifications","teams","reviews"]'::jsonb
  )
on conflict (role) do nothing;

notify pgrst, 'reload schema';
