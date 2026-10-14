-- The delete guard's row trigger checks
--   session_user = 'authenticator' or cgold_audit.destructive_allowed()
-- but EXECUTE on destructive_allowed() was revoked from PUBLIC with no grant
-- to the Data API roles, and Postgres does not promise to short-circuit OR.
-- A DELETE issued through PostgREST as service_role (the proxy replacing the
-- Rippling shift window) failed with "permission denied for function
-- destructive_allowed", so the shift schedule silently stopped updating.
--
-- Fix: the API roles may run the (read-only, GUC-reading) check, and the
-- trigger tests session_user first so the outcome never depends on
-- evaluation order. Policy is unchanged: direct database sessions still
-- cannot DELETE unless they opt in; app traffic is still governed by RLS.

grant execute on function cgold_audit.destructive_allowed() to authenticated, service_role;

create or replace function cgold_audit.block_direct_delete()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  -- App traffic (PostgREST / Edge Functions) connects as authenticator.
  if session_user = 'authenticator' then
    return old;
  end if;
  if cgold_audit.destructive_allowed() then
    return old;
  end if;
  raise exception using
    errcode = 'insufficient_privilege',
    message = format(
      'cgold guard: DELETE on %I.%I from a direct database session is blocked. '
      'Deletes belong to app features. To do this on purpose, in the same transaction run: '
      'set local cgold.allow_destructive = ''on'';',
      tg_table_schema, tg_table_name
    );
end;
$$;

revoke all on function cgold_audit.block_direct_delete() from public, anon, authenticated;
