-- Every signed-in teammate can read other profiles so Home, portraits,
-- likes, and comments work for every role. Writes stay own-or-admin.

create or replace function public.current_user_can_view_staff_directory()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_active_staff();
$$;

revoke all on function public.current_user_can_view_staff_directory() from public, anon;
grant execute on function public.current_user_can_view_staff_directory() to authenticated;

drop policy if exists profiles_select_own_or_admin on public.profiles;

create policy profiles_select_own_or_admin
  on public.profiles
  for select
  to authenticated
  using (
    public.is_active_staff()
    and (id = auth.uid() or public.current_user_can_view_staff_directory())
  );

notify pgrst, 'reload schema';
