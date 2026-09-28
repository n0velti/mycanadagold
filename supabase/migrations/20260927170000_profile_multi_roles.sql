-- Let a System Admin grant selected people more than one app role (PMA +
-- Triage Analyst). Those people can switch the active role from their
-- profile. Non-admins cannot change the grant list.

alter table public.profiles
  add column if not exists allowed_app_roles jsonb not null default '[]'::jsonb;

create index if not exists triage_batches_kind_idx
  on public.triage_batches (kind);

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
  allowed jsonb;
begin
  select exists (
    select 1
    from public.profiles p
    where p.is_active and (p.app_role = 'system_admin' or p.is_system_admin)
  ) into admin_exists;

  if tg_op = 'INSERT' then
    if new.allowed_app_roles is null or jsonb_typeof(new.allowed_app_roles) <> 'array' then
      new.allowed_app_roles := '[]'::jsonb;
    end if;
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

  if new.allowed_app_roles is null or jsonb_typeof(new.allowed_app_roles) <> 'array' then
    new.allowed_app_roles := coalesce(old.allowed_app_roles, '[]'::jsonb);
  end if;

  if requester = 'authenticated' and not public.current_user_is_system_admin() then
    new.allowed_app_roles := old.allowed_app_roles;
    new.is_system_admin := old.is_system_admin;
    if new.app_role is distinct from old.app_role then
      allowed := coalesce(old.allowed_app_roles, '[]'::jsonb);
      if not (
        new.app_role is not null
        and jsonb_typeof(allowed) = 'array'
        and allowed ? new.app_role
      ) then
        new.app_role := old.app_role;
      end if;
    end if;
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

notify pgrst, 'reload schema';
