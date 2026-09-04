-- Trust the `aureus_user_id` claim, not `app_metadata.provider`.
--
-- `aureus-login` mints the Supabase session through the magic-link OTP flow.
-- GoTrue rewrites app_metadata.provider / providers from auth.identities on
-- every OTP verification, so the JWT carries provider = 'email' even though
-- the account was verified against Aureus POS. The custom `aureus_user_id`
-- claim is preserved (only the service role can write app_metadata), so it is
-- the identity signal RLS relies on. Matching it against the profile row is
-- what proves the caller came through the POS check.
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
        and coalesce(auth.jwt() -> 'app_metadata' ->> 'aureus_user_id', '') <> ''
        and coalesce(auth.jwt() -> 'app_metadata' ->> 'aureus_user_id', '') = p.aureus_user_id
      from public.profiles p
      where p.id = auth.uid()
    ),
    false
  );
$$;

revoke all on function public.is_active_staff() from public, anon;
grant execute on function public.is_active_staff() to authenticated;
