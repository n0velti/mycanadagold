-- Aureus-gated access.
--
-- Sign-in is decided by the `aureus-login` Edge Function, which verifies the
-- staff member against Aureus POS with the service role and only then creates
-- (or refreshes) the auth user + profile and mints a session. Nothing in the
-- public schema is readable or writable unless the caller:
--   1. holds a JWT minted through that flow (app_metadata.provider = 'aureus'),
--   2. has a profile row whose Aureus identity matches the JWT, and
--   3. that profile is active and has been verified against Aureus.
--
-- Clients never insert profiles or touch identity columns; only the service
-- role does, from the Edge Function.

-- ---------------------------------------------------------------------------
-- profiles: activation + verification state
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists is_active boolean not null default true,
  add column if not exists aureus_verified_at timestamptz,
  add column if not exists deactivated_at timestamptz,
  add column if not exists deactivated_by uuid references auth.users (id) on delete set null;

-- Existing rows were written after a successful POS login by the previous
-- client flow; carry that over so staff are not locked out.
update public.profiles
set aureus_verified_at = coalesce(aureus_verified_at, last_login_at, created_at)
where aureus_verified_at is null;

create index if not exists profiles_is_active_idx on public.profiles (is_active);

-- ---------------------------------------------------------------------------
-- Helper: what role is making this request?
-- ---------------------------------------------------------------------------
create or replace function public.request_role()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'role', ''),
    ''
  );
$$;

revoke all on function public.request_role() from public, anon;
grant execute on function public.request_role() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Helper: is the caller a verified, active Aureus staff member?
-- ---------------------------------------------------------------------------
create or replace function public.is_active_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select
        p.is_active
        and p.aureus_verified_at is not null
        and coalesce(auth.jwt() -> 'app_metadata' ->> 'provider', '') = 'aureus'
        and coalesce(auth.jwt() -> 'app_metadata' ->> 'aureus_user_id', '') = p.aureus_user_id
      from public.profiles p
      where p.id = auth.uid()
    ),
    false
  );
$$;

revoke all on function public.is_active_staff() from public, anon;
grant execute on function public.is_active_staff() to authenticated;

-- System admin check now also requires an active, verified profile.
create or replace function public.current_user_is_system_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_active_staff()
    and coalesce(
      (
        select p.app_role = 'system_admin' or p.is_system_admin
        from public.profiles p
        where p.id = auth.uid()
      ),
      false
    );
$$;

create or replace function public.current_user_can_manage_store_settings()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_active_staff()
    and coalesce(
      (
        select p.app_role in ('branch_manager', 'general_manager', 'system_admin')
          or p.is_system_admin
        from public.profiles p
        where p.id = auth.uid()
      ),
      false
    );
$$;

-- ---------------------------------------------------------------------------
-- profiles: identity columns are server-owned
-- ---------------------------------------------------------------------------
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
  -- Service role (Edge Function, SQL editor) may write anything.
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

  -- Authenticated users cannot rewrite identity or verification state.
  new.id := old.id;
  new.aureus_user_id := old.aureus_user_id;
  new.aureus_login := old.aureus_login;
  new.email := old.email;
  new.first_name := old.first_name;
  new.last_name := old.last_name;
  new.full_name := old.full_name;
  new.role := old.role;
  new.location_id := old.location_id;
  new.location_name := old.location_name;
  new.aureus_payload := old.aureus_payload;
  new.aureus_verified_at := old.aureus_verified_at;
  new.last_login_at := old.last_login_at;
  new.created_at := old.created_at;

  -- Only a system admin may (de)activate people, never themselves.
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

revoke all on function public.profiles_guard_identity() from public, anon, authenticated;

drop trigger if exists profiles_guard_identity on public.profiles;
create trigger profiles_guard_identity
  before insert or update on public.profiles
  for each row
  execute function public.profiles_guard_identity();

-- Deactivation revokes every live Supabase session for that person so the
-- refresh token stops working immediately, not just at the next launch.
create or replace function public.profiles_revoke_sessions_on_deactivate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.is_active = false and old.is_active = true then
    begin
      delete from auth.sessions where user_id = new.id;
    exception
      when insufficient_privilege then
        raise warning 'Could not revoke auth sessions for %', new.id;
    end;
  end if;
  return new;
end;
$$;

revoke all on function public.profiles_revoke_sessions_on_deactivate() from public, anon, authenticated;

drop trigger if exists profiles_revoke_sessions_on_deactivate on public.profiles;
create trigger profiles_revoke_sessions_on_deactivate
  after update of is_active on public.profiles
  for each row
  execute function public.profiles_revoke_sessions_on_deactivate();

-- Role guard: treat any non-authenticated requester (service role) as trusted.
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
      -- Bootstrap: the first verified staff member becomes System Admin.
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

  if requester = 'authenticated' and not public.current_user_is_system_admin() then
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

-- ---------------------------------------------------------------------------
-- profiles: grants + policies
-- ---------------------------------------------------------------------------
revoke all on public.profiles from public, anon;
revoke insert on public.profiles from authenticated;
grant select, update on public.profiles to authenticated;
grant all on public.profiles to service_role;

drop policy if exists profiles_select_own on public.profiles;
drop policy if exists profiles_insert_own on public.profiles;
drop policy if exists profiles_update_own on public.profiles;
drop policy if exists profiles_select_own_or_admin on public.profiles;
drop policy if exists profiles_update_admin on public.profiles;

create policy profiles_select_own_or_admin
  on public.profiles
  for select
  to authenticated
  using (
    public.is_active_staff()
    and (id = auth.uid() or public.current_user_is_system_admin())
  );

create policy profiles_update_own
  on public.profiles
  for update
  to authenticated
  using (public.is_active_staff() and id = auth.uid())
  with check (public.is_active_staff() and id = auth.uid());

create policy profiles_update_admin
  on public.profiles
  for update
  to authenticated
  using (public.current_user_is_system_admin())
  with check (public.current_user_is_system_admin());

-- ---------------------------------------------------------------------------
-- role_app_access: read requires active staff, write requires admin
-- ---------------------------------------------------------------------------
drop policy if exists role_app_access_select on public.role_app_access;
drop policy if exists role_app_access_insert on public.role_app_access;
drop policy if exists role_app_access_update on public.role_app_access;

create policy role_app_access_select
  on public.role_app_access
  for select
  to authenticated
  using (public.is_active_staff());

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

-- ---------------------------------------------------------------------------
-- store_settings: read requires active staff, write requires manager
-- ---------------------------------------------------------------------------
drop policy if exists store_settings_select on public.store_settings;
drop policy if exists store_settings_insert on public.store_settings;
drop policy if exists store_settings_update on public.store_settings;

create policy store_settings_select
  on public.store_settings
  for select
  to authenticated
  using (public.is_active_staff());

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

-- ---------------------------------------------------------------------------
-- Server-only helpers used by the aureus-login Edge Function
-- ---------------------------------------------------------------------------

-- Resolve an existing auth user by email without exposing auth.users.
create or replace function public.auth_user_id_for_email(p_email text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select u.id
  from auth.users u
  where lower(u.email) = lower(trim(p_email))
  order by u.created_at asc
  limit 1;
$$;

revoke all on function public.auth_user_id_for_email(text) from public, anon, authenticated;
grant execute on function public.auth_user_id_for_email(text) to service_role;

-- Sign-in attempt log for throttling credential stuffing. Service role only.
create table if not exists public.login_attempts (
  id bigint generated always as identity primary key,
  ip_hash text not null,
  login_hash text not null,
  succeeded boolean not null default false,
  attempted_at timestamptz not null default now()
);

create index if not exists login_attempts_ip_time_idx
  on public.login_attempts (ip_hash, attempted_at desc);
create index if not exists login_attempts_login_time_idx
  on public.login_attempts (login_hash, attempted_at desc);

alter table public.login_attempts enable row level security;
alter table public.login_attempts force row level security;
revoke all on public.login_attempts from public, anon, authenticated;
grant all on public.login_attempts to service_role;

-- Returns the number of failed attempts in the window for the IP and login.
create or replace function public.login_attempts_recent_failures(
  p_ip_hash text,
  p_login_hash text,
  p_window interval default interval '15 minutes'
)
returns table (ip_failures bigint, login_failures bigint)
language sql
stable
security definer
set search_path = public
as $$
  select
    (
      select count(*)
      from public.login_attempts a
      where a.ip_hash = p_ip_hash
        and not a.succeeded
        and a.attempted_at > now() - p_window
    ) as ip_failures,
    (
      select count(*)
      from public.login_attempts a
      where a.login_hash = p_login_hash
        and not a.succeeded
        and a.attempted_at > now() - p_window
    ) as login_failures;
$$;

revoke all on function public.login_attempts_recent_failures(text, text, interval)
  from public, anon, authenticated;
grant execute on function public.login_attempts_recent_failures(text, text, interval) to service_role;

create or replace function public.login_attempts_prune(p_keep interval default interval '2 days')
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.login_attempts
  where attempted_at < now() - p_keep;
$$;

revoke all on function public.login_attempts_prune(interval) from public, anon, authenticated;
grant execute on function public.login_attempts_prune(interval) to service_role;

-- ---------------------------------------------------------------------------
-- Defense in depth: nothing else in public is callable by anon.
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all routines in schema public from anon;

notify pgrst, 'reload schema';
