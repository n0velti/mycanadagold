-- Staff directory for the Employees app.
-- Branch managers, GMs, and system admins can read other profiles so the
-- Employees tab can list everyone who has signed in to myCanadaGold.

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
        select p.app_role in ('branch_manager', 'general_manager', 'system_admin')
          or p.is_system_admin
        from public.profiles p
        where p.id = auth.uid()
      ),
      false
    );
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
