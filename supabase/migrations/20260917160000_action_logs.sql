-- Logs app: an append-only ledger of every button press in the app and who
-- made it. Rows can be inserted by active staff (always attributed to the
-- caller) and can never be updated or deleted. Each row is chained to the
-- previous one with a SHA-256 hash so any tampering is detectable.

create table if not exists public.action_logs (
  id uuid primary key default gen_random_uuid(),
  seq bigint not null unique,
  client_event_id uuid not null unique,
  actor_id uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  actor_name text not null default '',
  actor_login text not null default '',
  actor_role text not null default '',
  store_name text not null default '',
  action text not null default 'press',
  label text not null default '',
  icon text not null default '',
  test_id text not null default '',
  tab text not null default '',
  app_key text not null default '',
  app_label text not null default '',
  platform text not null default '',
  app_session_id text not null default '',
  client_ts timestamptz not null default now(),
  created_at timestamptz not null default now(),
  prev_hash text not null default '',
  hash text not null default '',
  check (action in ('press', 'long_press')),
  check (char_length(label) <= 160),
  check (char_length(icon) <= 80),
  check (char_length(test_id) <= 120),
  check (char_length(tab) <= 40),
  check (char_length(app_key) <= 60),
  check (char_length(app_label) <= 80),
  check (char_length(platform) <= 20),
  check (char_length(app_session_id) <= 64)
);

create index if not exists action_logs_created_at_idx
  on public.action_logs (created_at desc, seq desc);

create index if not exists action_logs_actor_created_idx
  on public.action_logs (actor_id, created_at desc);

create index if not exists action_logs_app_created_idx
  on public.action_logs (app_key, created_at desc);

-- Canonical text that gets hashed for one row. Kept as its own function so
-- the verifier and the insert trigger can never drift apart.
create or replace function public.action_log_canonical(r public.action_logs)
returns text
language sql
stable
as $$
  select jsonb_build_object(
    'seq', r.seq,
    'prev_hash', r.prev_hash,
    'client_event_id', r.client_event_id,
    'actor_id', r.actor_id,
    'actor_name', r.actor_name,
    'actor_login', r.actor_login,
    'actor_role', r.actor_role,
    'store_name', r.store_name,
    'action', r.action,
    'label', r.label,
    'icon', r.icon,
    'test_id', r.test_id,
    'tab', r.tab,
    'app_key', r.app_key,
    'app_label', r.app_label,
    'platform', r.platform,
    'app_session_id', r.app_session_id,
    'client_ts', to_char(r.client_ts at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'created_at', to_char(r.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  )::text;
$$;

revoke all on function public.action_log_canonical(public.action_logs) from public, anon;
grant execute on function public.action_log_canonical(public.action_logs) to authenticated;

create or replace function public.action_logs_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  prev record;
  who record;
begin
  if not public.is_active_staff() then
    raise exception 'Not allowed';
  end if;

  -- Serialize inserts so seq and the hash chain always agree.
  perform pg_advisory_xact_lock(hashtext('public.action_logs'));

  -- The caller is always the actor, regardless of what the client sent.
  new.actor_id := auth.uid();
  new.created_at := now();
  if new.client_ts is null or new.client_ts > now() + interval '5 minutes' then
    new.client_ts := now();
  end if;
  if new.client_event_id is null then
    new.client_event_id := gen_random_uuid();
  end if;

  select
    coalesce(
      nullif(trim(p.full_name), ''),
      nullif(trim(concat_ws(' ', p.first_name, p.last_name)), ''),
      nullif(trim(p.aureus_login), ''),
      'Staff'
    ) as name,
    coalesce(p.aureus_login, '') as login,
    coalesce(p.app_role, '') as role,
    coalesce(p.location_name, '') as store
  into who
  from public.profiles p
  where p.id = new.actor_id;

  new.actor_name := coalesce(who.name, 'Staff');
  new.actor_login := coalesce(who.login, '');
  new.actor_role := coalesce(who.role, '');
  new.store_name := coalesce(nullif(trim(new.store_name), ''), who.store, '');

  new.action := coalesce(nullif(lower(trim(new.action)), ''), 'press');
  new.label := left(coalesce(new.label, ''), 160);
  new.icon := left(coalesce(new.icon, ''), 80);
  new.test_id := left(coalesce(new.test_id, ''), 120);
  new.tab := left(coalesce(new.tab, ''), 40);
  new.app_key := left(coalesce(new.app_key, ''), 60);
  new.app_label := left(coalesce(new.app_label, ''), 80);
  new.platform := left(coalesce(new.platform, ''), 20);
  new.app_session_id := left(coalesce(new.app_session_id, ''), 64);

  select l.seq, l.hash
  into prev
  from public.action_logs l
  order by l.seq desc
  limit 1;

  new.seq := coalesce(prev.seq, 0) + 1;
  new.prev_hash := coalesce(prev.hash, repeat('0', 64));
  new.hash := encode(sha256(convert_to(public.action_log_canonical(new), 'UTF8')), 'hex');
  return new;
end;
$$;

revoke all on function public.action_logs_before_insert() from public, anon, authenticated;

drop trigger if exists action_logs_before_insert on public.action_logs;
create trigger action_logs_before_insert
  before insert on public.action_logs
  for each row
  execute function public.action_logs_before_insert();

-- Ledger rows are immutable. This fires for every role, including the
-- table owner, so even the dashboard cannot rewrite history without first
-- dropping the trigger (which itself is visible in the migration history).
create or replace function public.action_logs_block_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'action_logs is an append-only ledger (% blocked)', lower(tg_op)
    using errcode = 'insufficient_privilege';
end;
$$;

drop trigger if exists action_logs_block_update on public.action_logs;
create trigger action_logs_block_update
  before update on public.action_logs
  for each row
  execute function public.action_logs_block_mutation();

drop trigger if exists action_logs_block_delete on public.action_logs;
create trigger action_logs_block_delete
  before delete on public.action_logs
  for each row
  execute function public.action_logs_block_mutation();

drop trigger if exists action_logs_block_truncate on public.action_logs;
create trigger action_logs_block_truncate
  before truncate on public.action_logs
  for each statement
  execute function public.action_logs_block_mutation();

-- RLS is enabled but deliberately not forced: the insert trigger and the
-- chain verifier run as the table owner and must see every row (the previous
-- link in the chain may belong to someone the caller cannot otherwise read).
-- App roles (authenticated / anon) are always subject to the policies below.
alter table public.action_logs enable row level security;

revoke all on table public.action_logs from public, anon;
grant select, insert on table public.action_logs to authenticated;

drop policy if exists action_logs_select on public.action_logs;
drop policy if exists action_logs_insert on public.action_logs;

-- Everyone can see their own trail. General managers, branch managers, and
-- system admins see the whole ledger.
create policy action_logs_select
  on public.action_logs
  for select
  to authenticated
  using (
    public.is_active_staff()
    and (
      actor_id = auth.uid()
      or public.current_user_is_system_admin()
      or exists (
        select 1
        from public.profiles p
        where p.id = auth.uid()
          and p.app_role in ('general_manager', 'branch_manager')
      )
    )
  );

create policy action_logs_insert
  on public.action_logs
  for insert
  to authenticated
  with check (
    public.is_active_staff()
    and (actor_id = auth.uid() or actor_id is null)
  );

-- Walks the chain and reports the first row whose stored hash does not match
-- what its contents (plus the previous hash) produce.
create or replace function public.verify_action_log_chain(p_limit integer default null)
returns table (ok boolean, checked bigint, first_bad_seq bigint, last_seq bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  row_rec public.action_logs;
  expected_prev text := repeat('0', 64);
  expected_seq bigint := 1;
  computed text;
  bad bigint := null;
  n bigint := 0;
  top bigint := 0;
begin
  if not public.is_active_staff() then
    raise exception 'Not allowed';
  end if;

  select coalesce(max(l.seq), 0) into top from public.action_logs l;

  for row_rec in
    select * from public.action_logs l order by l.seq asc
  loop
    n := n + 1;
    if row_rec.seq <> expected_seq or row_rec.prev_hash <> expected_prev then
      bad := row_rec.seq;
      exit;
    end if;
    computed := encode(sha256(convert_to(public.action_log_canonical(row_rec), 'UTF8')), 'hex');
    if computed <> row_rec.hash then
      bad := row_rec.seq;
      exit;
    end if;
    expected_prev := row_rec.hash;
    expected_seq := row_rec.seq + 1;
    if p_limit is not null and n >= p_limit then
      exit;
    end if;
  end loop;

  return query select bad is null, n, bad, top;
end;
$$;

revoke all on function public.verify_action_log_chain(integer) from public, anon;
grant execute on function public.verify_action_log_chain(integer) to authenticated;

-- Live updates for the Logs viewer.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'action_logs'
    ) then
      alter publication supabase_realtime add table public.action_logs;
    end if;
  end if;
end;
$$;

notify pgrst, 'reload schema';
