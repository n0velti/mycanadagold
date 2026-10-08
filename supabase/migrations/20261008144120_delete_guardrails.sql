-- Delete guardrails for every table in public.
--
-- Two paths can remove rows from this database:
--   1. App traffic. supabase-js / Edge Functions reach Postgres through
--      PostgREST as session_user `authenticator`. RLS policies and the
--      `safeupdate` preload (no DELETE / UPDATE without a WHERE) already
--      govern that path. A delete there is a feature someone clicked.
--   2. Direct SQL. Dashboard SQL editor, `supabase db query`, the Supabase
--      MCP `execute_sql`, the Management API, psql, migrations. These run as
--      `postgres` with no RLS and no safeupdate — one bad statement from a
--      person or an AI agent removes a table.
--
-- This migration:
--   * archives every deleted row (both paths) into cgold_audit.deleted_rows,
--     so any delete can be undone with cgold_audit.restore_deleted_row(id);
--   * refuses DELETE on public tables from direct SQL sessions;
--   * refuses TRUNCATE on public tables, and DROP TABLE / DROP COLUMN /
--     DROP SCHEMA in public, from anyone;
--   * attaches the same guards to every table created later.
--
-- A human doing this on purpose opts in for one transaction:
--     begin;
--     set local cgold.allow_destructive = 'on';
--     delete from public.some_table where ...;
--     commit;
-- Nothing else disables the guards. Migrations that must delete data or drop
-- a column include that `set local` line at the top.

create schema if not exists cgold_audit;

-- Not exposed through the Data API. Only postgres / service_role may touch it.
revoke all on schema cgold_audit from public, anon, authenticated;
grant usage on schema cgold_audit to service_role;

create table if not exists cgold_audit.deleted_rows (
  id bigint generated always as identity primary key,
  deleted_at timestamptz not null default now(),
  table_schema text not null,
  table_name text not null,
  row_data jsonb not null,
  -- Who: the Postgres session (`authenticator` = app / Edge Function,
  -- `postgres` = SQL editor / CLI / MCP), the role in effect, and the
  -- signed-in staff member when the delete came from the app.
  session_role text not null default session_user,
  current_role_name text not null default current_user,
  auth_uid uuid,
  restored_at timestamptz
);

create index if not exists deleted_rows_table_deleted_idx
  on cgold_audit.deleted_rows (table_schema, table_name, deleted_at desc);
create index if not exists deleted_rows_deleted_at_idx
  on cgold_audit.deleted_rows (deleted_at);

alter table cgold_audit.deleted_rows enable row level security;
alter table cgold_audit.deleted_rows force row level security;
revoke all on table cgold_audit.deleted_rows from public, anon, authenticated;
grant select on table cgold_audit.deleted_rows to service_role;

-- ---------------------------------------------------------------------------
-- Guard functions
-- ---------------------------------------------------------------------------

create or replace function cgold_audit.destructive_allowed()
returns boolean
language sql
stable
set search_path = pg_catalog
as $$
  select coalesce(current_setting('cgold.allow_destructive', true), '') = 'on';
$$;

revoke all on function cgold_audit.destructive_allowed() from public, anon, authenticated;

-- Row trigger: copy the row before it goes. security definer so an app
-- delete (role authenticated) can write to the archive without a grant.
create or replace function cgold_audit.archive_deleted_row()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  insert into cgold_audit.deleted_rows (table_schema, table_name, row_data, auth_uid)
  values (tg_table_schema, tg_table_name, to_jsonb(old), auth.uid());
  return old;
end;
$$;

revoke all on function cgold_audit.archive_deleted_row() from public, anon, authenticated;

-- Statement trigger: direct SQL sessions may not DELETE unless opted in.
-- App traffic (session_user authenticator) is left to RLS + safeupdate.
create or replace function cgold_audit.block_direct_delete()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if session_user = 'authenticator' then
    return null;
  end if;
  if cgold_audit.destructive_allowed() then
    return null;
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

create or replace function cgold_audit.block_truncate()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if cgold_audit.destructive_allowed() then
    return null;
  end if;
  raise exception using
    errcode = 'insufficient_privilege',
    message = format(
      'cgold guard: TRUNCATE %I.%I is blocked. To do this on purpose, in the same transaction run: '
      'set local cgold.allow_destructive = ''on'';',
      tg_table_schema, tg_table_name
    );
end;
$$;

revoke all on function cgold_audit.block_truncate() from public, anon, authenticated;

-- Attach the three guards to one table. Idempotent.
create or replace function cgold_audit.protect_table(target regclass)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  execute format('drop trigger if exists cgold_guard_archive_delete on %s', target);
  execute format(
    'create trigger cgold_guard_archive_delete before delete on %s '
    'for each row execute function cgold_audit.archive_deleted_row()',
    target
  );

  execute format('drop trigger if exists cgold_guard_block_delete on %s', target);
  execute format(
    'create trigger cgold_guard_block_delete before delete on %s '
    'for each statement execute function cgold_audit.block_direct_delete()',
    target
  );

  execute format('drop trigger if exists cgold_guard_block_truncate on %s', target);
  execute format(
    'create trigger cgold_guard_block_truncate before truncate on %s '
    'for each statement execute function cgold_audit.block_truncate()',
    target
  );
end;
$$;

revoke all on function cgold_audit.protect_table(regclass) from public, anon, authenticated;

-- Tables that are rebuilt wholesale on every import or prune. Their source
-- of truth is elsewhere (CSV files, the POS, the login itself), so archiving
-- each replaced row would only grow the archive. They still get the DELETE
-- and TRUNCATE blocks.
create or replace function cgold_audit.archive_skipped(target regclass)
returns boolean
language sql
stable
set search_path = pg_catalog
as $$
  select target::text in (
    'public.login_attempts',
    'public.dm_presence',
    'public.rippling_clock_status',
    'public.rippling_time_entries',
    'public.rippling_shift_roles'
  );
$$;

-- Existing tables.
do $$
declare
  r record;
begin
  for r in
    select c.oid::regclass as rel
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
  loop
    perform cgold_audit.protect_table(r.rel);
    if cgold_audit.archive_skipped(r.rel) then
      execute format('drop trigger if exists cgold_guard_archive_delete on %s', r.rel);
    end if;
  end loop;
end $$;

-- Future tables: the CREATE TABLE event trigger attaches the guards.
create or replace function cgold_audit.protect_new_tables()
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
      perform cgold_audit.protect_table(obj.objid::regclass);
    end if;
  end loop;
end;
$$;

revoke all on function cgold_audit.protect_new_tables() from public, anon, authenticated;

drop event trigger if exists cgold_guard_protect_new_tables;
create event trigger cgold_guard_protect_new_tables
  on ddl_command_end
  when tag in ('CREATE TABLE', 'CREATE TABLE AS')
  execute function cgold_audit.protect_new_tables();

-- DROP TABLE / DROP COLUMN / DROP SCHEMA in public lose data. Refuse unless
-- opted in. Dropping policies, triggers, functions, constraints, indexes and
-- views is unaffected (migrations do that routinely).
create or replace function cgold_audit.block_drop()
returns event_trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
  obj record;
begin
  if cgold_audit.destructive_allowed() then
    return;
  end if;
  for obj in select * from pg_event_trigger_dropped_objects()
  loop
    if obj.object_type in ('table', 'table column') and obj.schema_name = 'public' then
      raise exception using
        errcode = 'insufficient_privilege',
        message = format(
          'cgold guard: DROP %s %s is blocked. To do this on purpose, in the same transaction run: '
          'set local cgold.allow_destructive = ''on'';',
          obj.object_type, obj.object_identity
        );
    end if;
    if obj.object_type = 'schema' and obj.object_name = 'public' then
      raise exception using
        errcode = 'insufficient_privilege',
        message = 'cgold guard: DROP SCHEMA public is blocked. Set cgold.allow_destructive = ''on'' in the same transaction to proceed.';
    end if;
  end loop;
end;
$$;

revoke all on function cgold_audit.block_drop() from public, anon, authenticated;

drop event trigger if exists cgold_guard_block_drop;
create event trigger cgold_guard_block_drop
  on sql_drop
  execute function cgold_audit.block_drop();

-- ---------------------------------------------------------------------------
-- Recovery and housekeeping (run from the SQL editor as postgres)
-- ---------------------------------------------------------------------------

-- Put one archived row back. Fails if the primary key already exists again.
create or replace function cgold_audit.restore_deleted_row(archive_id bigint)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  rec cgold_audit.deleted_rows%rowtype;
begin
  select * into rec from cgold_audit.deleted_rows where id = archive_id;
  if not found then
    raise exception 'cgold_audit: no archived row with id %', archive_id;
  end if;
  if rec.restored_at is not null then
    raise exception 'cgold_audit: archived row % was already restored at %', archive_id, rec.restored_at;
  end if;
  -- overriding system value keeps identity-column ids (login_attempts) intact.
  execute format(
    'insert into %I.%I overriding system value select * from jsonb_populate_record(null::%I.%I, $1)',
    rec.table_schema, rec.table_name, rec.table_schema, rec.table_name
  ) using rec.row_data;
  update cgold_audit.deleted_rows set restored_at = now() where id = archive_id;
end;
$$;

revoke all on function cgold_audit.restore_deleted_row(bigint) from public, anon, authenticated;

-- Drop archive entries older than the retention window. Default 180 days.
create or replace function cgold_audit.purge_deleted_rows(older_than interval default interval '180 days')
returns integer
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  removed integer;
begin
  delete from cgold_audit.deleted_rows where deleted_at < now() - older_than;
  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke all on function cgold_audit.purge_deleted_rows(interval) from public, anon, authenticated;

notify pgrst, 'reload schema';
