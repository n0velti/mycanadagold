-- Default-deny lockdown for a public client that holds only the publishable key.
-- RLS on + no policies = zero row access. Privileged keys (secret / service_role)
-- still bypass RLS by design and must never ship in the app.

-- Existing public tables we own: require RLS even for table owners.
-- Skip storage.* — those tables are owned by supabase_storage_admin and
-- already have RLS enabled. ALTER on them fails with 42501.
do $$
declare
  r record;
begin
  for r in
    select c.relname as tablename
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and c.relowner = current_user::regrole
  loop
    execute format('alter table public.%I enable row level security', r.tablename);
    execute format('alter table public.%I force row level security', r.tablename);
  end loop;
end $$;

revoke all on schema public from public;

-- Anon (signed-out publishable key) must not read or write any table.
revoke all on all tables in schema public from anon, public;
revoke all on all sequences in schema public from anon, public;
revoke all on all routines in schema public from anon, public;

-- Authenticated users also get nothing until a table is granted + given policies.
revoke all on all tables in schema public from authenticated;
revoke all on all sequences in schema public from authenticated;
revoke all on all routines in schema public from authenticated;

grant usage on schema public to anon, authenticated, service_role;

alter default privileges in schema public revoke all on tables from public, anon, authenticated;
alter default privileges in schema public revoke all on sequences from public, anon, authenticated;
alter default privileges in schema public revoke all on routines from public, anon, authenticated;

alter default privileges in schema public grant all on tables to postgres, service_role;
alter default privileges in schema public grant all on sequences to postgres, service_role;
alter default privileges in schema public grant all on routines to postgres, service_role;

-- New public tables created in SQL get RLS automatically.
create or replace function public.cgold_force_rls()
returns event_trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  obj record;
begin
  for obj in
    select *
    from pg_event_trigger_ddl_commands()
    where command_tag in ('CREATE TABLE', 'CREATE TABLE AS')
  loop
    if obj.schema_name = 'public' then
      execute format('alter table %s enable row level security', obj.object_identity);
      execute format('alter table %s force row level security', obj.object_identity);
    end if;
  end loop;
end;
$$;

drop event trigger if exists cgold_force_rls_on_create;
create event trigger cgold_force_rls_on_create
  on ddl_command_end
  when tag in ('CREATE TABLE', 'CREATE TABLE AS')
  execute function public.cgold_force_rls();

revoke all on function public.cgold_force_rls() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'graphql_public') then
    execute 'revoke all on schema graphql_public from public, anon, authenticated';
  end if;
exception
  when insufficient_privilege then
    null;
end $$;

-- When you add a real table later:
--   1. Keep RLS enabled (this trigger does that).
--   2. GRANT only the commands authenticated users need.
--   3. CREATE POLICY ... TO authenticated USING (auth.uid() = user_id);
-- Do not add policies for the anon role unless the row is truly public.
