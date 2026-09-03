-- Profile photo (user-writable) plus the Aureus employee type captured at
-- first sign-in. Location / role stay server-owned; avatar_url does not.

alter table public.profiles
  add column if not exists employee_type text,
  add column if not exists avatar_url text;

-- Existing staff whose POS role already is the employee type.
update public.profiles
set employee_type = initcap(lower(trim(role)))
where employee_type is null
  and role is not null
  and lower(trim(role)) in ('employee', 'manager', 'admin', 'administrator');

update public.profiles
set employee_type = 'Admin'
where employee_type is not null
  and lower(trim(employee_type)) = 'administrator';

-- Lock employee_type the same way as other Aureus identity columns.
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

-- Public avatar files, writable only into the caller's own folder.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  2097152,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']::text[]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists avatars_public_read on storage.objects;
drop policy if exists avatars_own_insert on storage.objects;
drop policy if exists avatars_own_update on storage.objects;
drop policy if exists avatars_own_delete on storage.objects;

create policy avatars_public_read
  on storage.objects
  for select
  using (bucket_id = 'avatars');

create policy avatars_own_insert
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and split_part(name, '/', 1) = auth.uid()::text
    and public.is_active_staff()
  );

create policy avatars_own_update
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'avatars'
    and split_part(name, '/', 1) = auth.uid()::text
    and public.is_active_staff()
  )
  with check (
    bucket_id = 'avatars'
    and split_part(name, '/', 1) = auth.uid()::text
    and public.is_active_staff()
  );

create policy avatars_own_delete
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'avatars'
    and split_part(name, '/', 1) = auth.uid()::text
    and public.is_active_staff()
  );

notify pgrst, 'reload schema';
