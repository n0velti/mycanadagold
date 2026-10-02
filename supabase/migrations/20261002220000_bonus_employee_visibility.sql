-- Bonuses-only grant, set by aureus-login after a live POS /employees probe
-- on the signed-in account (East, GTA, and/or PMX). Clients cannot write
-- these columns. Apply with the release; do not run against live from this PR.

alter table public.profiles
  add column if not exists can_view_bonus_data boolean not null default false;

alter table public.profiles
  add column if not exists bonus_employee_visibility jsonb not null default '{}'::jsonb;

create or replace function public.current_user_can_view_bonus_data()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select p.is_active and p.can_view_bonus_data
      from public.profiles p
      where p.id = (select auth.uid())
    ),
    false
  );
$$;

revoke all on function public.current_user_can_view_bonus_data() from public, anon;
grant execute on function public.current_user_can_view_bonus_data() to authenticated;

-- Freeze the grant the same way as other Aureus identity columns. Only the
-- service role (aureus-login) may change it.
create or replace function public.profiles_guard_identity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  requester text := public.request_role();
  other_admin_exists boolean;
begin
  if requester <> 'authenticated' then
    if tg_op = 'UPDATE' and new.is_active = false and old.is_active = true then
      new.deactivated_at := coalesce(new.deactivated_at, now());
    elsif tg_op = 'UPDATE' and new.is_active = true and old.is_active = false then
      new.deactivated_at := null;
      new.deactivated_by := null;
    end if;
    return new;
  end if;

  if tg_op = 'INSERT' then
    raise exception 'Profiles are created by the sign-in service' using errcode = '42501';
  end if;

  new.id := old.id;
  new.aureus_user_id := old.aureus_user_id;
  new.aureus_login := old.aureus_login;
  new.email := old.email;
  new.first_name := old.first_name;
  new.last_name := old.last_name;
  new.full_name := old.full_name;
  new.role := old.role;
  new.employee_type := old.employee_type;
  new.location_id := old.location_id;
  new.location_name := old.location_name;
  new.aureus_payload := old.aureus_payload;
  new.aureus_verified_at := old.aureus_verified_at;
  new.last_login_at := old.last_login_at;
  new.created_at := old.created_at;
  new.can_view_bonus_data := old.can_view_bonus_data;
  new.bonus_employee_visibility := old.bonus_employee_visibility;

  if new.is_active is distinct from old.is_active then
    if not public.current_user_is_system_admin() or old.id = auth.uid() then
      new.is_active := old.is_active;
      new.deactivated_at := old.deactivated_at;
      new.deactivated_by := old.deactivated_by;
    elsif new.is_active = false then
      if old.app_role = 'system_admin' or old.is_system_admin then
        select exists (
          select 1
          from public.profiles p
          where p.id <> old.id
            and p.is_active
            and (p.app_role = 'system_admin' or p.is_system_admin)
        ) into other_admin_exists;
        if not other_admin_exists then
          raise exception 'Keep at least one active System Admin';
        end if;
      end if;
      new.deactivated_at := now();
      new.deactivated_by := auth.uid();
    else
      new.deactivated_at := null;
      new.deactivated_by := null;
    end if;
  else
    new.deactivated_at := old.deactivated_at;
    new.deactivated_by := old.deactivated_by;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

notify pgrst, 'reload schema';
