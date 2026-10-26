-- Public boolean for the login screen: does this email already have an
-- account? Only a yes/no comes back. The screen uses that to show the
-- password field or Join while the address is being typed.

create index if not exists profiles_email_lower_idx on public.profiles (lower(email));

create or replace function public.login_email_known(p_email text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    case
      when p_email is null then false
      when length(trim(p_email)) < 5 or length(trim(p_email)) > 320 then false
      when position('@' in trim(p_email)) = 0 then false
      else exists (
        select 1
        from public.profiles p
        where p.email is not null
          and lower(p.email) = lower(trim(p_email))
      )
      or exists (
        select 1
        from public.profiles p
        where p.aureus_login is not null
          and lower(p.aureus_login) = lower(trim(p_email))
      )
      or public.auth_user_id_for_email(trim(p_email)) is not null
    end;
$$;

revoke all on function public.login_email_known(text) from public;
grant execute on function public.login_email_known(text) to anon, authenticated;
