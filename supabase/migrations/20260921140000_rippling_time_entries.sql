-- Rippling hours without the paid API: a scheduled Rippling report lands in a
-- company Gmail inbox as a CSV; the proxy pulls it with a stored refresh token
-- and replaces the covered window here. Clients only read aggregates.

-- Singleton: which mailbox to read and how the last pull went. Service role only.
create table if not exists public.rippling_time_sync (
  id boolean primary key default true check (id),
  gmail_email text not null default '',
  gmail_refresh_token text not null default '',
  gmail_access_token text not null default '',
  gmail_token_expires_at timestamptz,
  last_attempt_at timestamptz,
  last_synced_at timestamptz,
  last_message_id text not null default '',
  last_message_at timestamptz,
  last_attachment_name text not null default '',
  last_row_count integer not null default 0,
  last_range_start date,
  last_range_end date,
  last_error text not null default '',
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id)
);

alter table public.rippling_time_sync
  drop constraint if exists rippling_time_sync_email_len;
alter table public.rippling_time_sync
  add constraint rippling_time_sync_email_len
  check (char_length(gmail_email) <= 320);

alter table public.rippling_time_sync
  drop constraint if exists rippling_time_sync_refresh_len;
alter table public.rippling_time_sync
  add constraint rippling_time_sync_refresh_len
  check (char_length(gmail_refresh_token) <= 4096);

alter table public.rippling_time_sync
  drop constraint if exists rippling_time_sync_access_len;
alter table public.rippling_time_sync
  add constraint rippling_time_sync_access_len
  check (char_length(gmail_access_token) <= 4096);

alter table public.rippling_time_sync
  drop constraint if exists rippling_time_sync_error_len;
alter table public.rippling_time_sync
  add constraint rippling_time_sync_error_len
  check (char_length(last_error) <= 2000);

insert into public.rippling_time_sync (id)
values (true)
on conflict (id) do nothing;

alter table public.rippling_time_sync enable row level security;
alter table public.rippling_time_sync force row level security;
revoke all on public.rippling_time_sync from public, anon, authenticated;
grant select, insert, update, delete on table public.rippling_time_sync to service_role;

-- One row per Rippling time entry from the latest report snapshot.
create table if not exists public.rippling_time_entries (
  entry_key text primary key,
  employee_rippling_id text not null,
  employee_name text not null default '',
  entry_date date not null,
  started_at timestamptz,
  ended_at timestamptz,
  minutes integer generated always as (
    case
      when started_at is not null and ended_at is not null and ended_at >= started_at
        then floor(extract(epoch from (ended_at - started_at)) / 60)::integer
      else null
    end
  ) stored,
  source_message_id text not null default '',
  synced_at timestamptz not null default now(),
  check (char_length(entry_key) <= 200),
  check (char_length(employee_rippling_id) <= 100),
  check (char_length(employee_name) <= 200)
);

create index if not exists rippling_time_entries_employee_date_idx
  on public.rippling_time_entries (employee_rippling_id, entry_date desc);
create index if not exists rippling_time_entries_date_idx
  on public.rippling_time_entries (entry_date desc);

alter table public.rippling_time_entries enable row level security;
alter table public.rippling_time_entries force row level security;
revoke all on public.rippling_time_entries from public, anon, authenticated;
grant select on table public.rippling_time_entries to authenticated;
grant select, insert, update, delete on table public.rippling_time_entries to service_role;

drop policy if exists rippling_time_entries_select on public.rippling_time_entries;
create policy rippling_time_entries_select
  on public.rippling_time_entries
  for select
  to authenticated
  using (public.is_active_staff());

-- Atomically swap the window a report file covers. Every file is a full
-- snapshot of its date range, so rows missing from the newest file were
-- deleted or edited in Rippling and must go.
create or replace function public.replace_rippling_time_entries(
  p_range_start date,
  p_range_end date,
  p_message_id text,
  p_rows jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted integer := 0;
begin
  if p_range_start is null or p_range_end is null or p_range_end < p_range_start then
    raise exception 'Invalid date range';
  end if;

  delete from public.rippling_time_entries
  where entry_date between p_range_start and p_range_end;

  insert into public.rippling_time_entries (
    entry_key,
    employee_rippling_id,
    employee_name,
    entry_date,
    started_at,
    ended_at,
    source_message_id,
    synced_at
  )
  select distinct on (left(r.entry_key, 200))
    left(r.entry_key, 200),
    left(r.employee_rippling_id, 100),
    left(coalesce(r.employee_name, ''), 200),
    r.entry_date,
    r.started_at,
    r.ended_at,
    coalesce(p_message_id, ''),
    now()
  from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as r(
    entry_key text,
    employee_rippling_id text,
    employee_name text,
    entry_date date,
    started_at timestamptz,
    ended_at timestamptz
  )
  where r.entry_key is not null
    and r.employee_rippling_id is not null
    and r.entry_date is not null
    and r.entry_date between p_range_start and p_range_end
  on conflict (entry_key) do update
    set employee_name = excluded.employee_name,
        started_at = excluded.started_at,
        ended_at = excluded.ended_at,
        source_message_id = excluded.source_message_id,
        synced_at = excluded.synced_at;

  get diagnostics inserted = row_count;
  return inserted;
end;
$$;

revoke all on function public.replace_rippling_time_entries(date, date, text, jsonb) from public, anon, authenticated;
grant execute on function public.replace_rippling_time_entries(date, date, text, jsonb) to service_role;

-- Per-employee hours the Employees screen renders. Returns one JSON document
-- so PostgREST's max_rows never truncates it. Weeks start Monday, Toronto time.
create or replace function public.rippling_hours_summary(p_recent_days integer default 14)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with bounds as (
    select
      today,
      date_trunc('week', today::timestamp)::date as week_start,
      date_trunc('week', today::timestamp)::date - 7 as last_week_start,
      today - 29 as month_start,
      today - greatest(coalesce(p_recent_days, 14), 1) + 1 as recent_start
    from (select (now() at time zone 'America/Toronto')::date as today) d
  ),
  e as (
    select
      t.entry_key,
      t.employee_rippling_id,
      t.employee_name,
      t.entry_date,
      t.started_at,
      t.ended_at,
      coalesce(t.minutes, 0) as mins
    from public.rippling_time_entries t
    where public.is_active_staff()
      and t.started_at is not null
  ),
  per as (
    select
      e.employee_rippling_id as id,
      (array_agg(e.employee_name order by e.entry_date desc, e.started_at desc))[1] as name,
      coalesce(sum(e.mins) filter (where e.entry_date = b.today), 0) as today_minutes,
      coalesce(sum(e.mins) filter (where e.entry_date >= b.week_start), 0) as week_minutes,
      coalesce(
        sum(e.mins) filter (where e.entry_date >= b.last_week_start and e.entry_date < b.week_start),
        0
      ) as last_week_minutes,
      coalesce(sum(e.mins) filter (where e.entry_date >= b.month_start), 0) as month_minutes,
      count(*) filter (where e.entry_date >= b.month_start) as month_shifts,
      max(e.started_at) filter (where e.ended_at is null and e.started_at > now() - interval '20 hours') as open_since,
      max(e.entry_date) as last_entry_date,
      (
        select coalesce(
          jsonb_agg(
            jsonb_build_object(
              'key', r.entry_key,
              'date', r.entry_date,
              'start', r.started_at,
              'end', r.ended_at,
              'minutes', nullif(r.mins, 0)
            )
            order by r.started_at desc
          ),
          '[]'::jsonb
        )
        from e r
        where r.employee_rippling_id = e.employee_rippling_id
          and r.entry_date >= b.recent_start
      ) as entries
    from e
    cross join bounds b
    group by e.employee_rippling_id, b.today, b.week_start, b.last_week_start, b.month_start, b.recent_start
  )
  select coalesce(jsonb_agg(to_jsonb(per) order by per.name), '[]'::jsonb)
  from per;
$$;

revoke all on function public.rippling_hours_summary(integer) from public, anon;
grant execute on function public.rippling_hours_summary(integer) to authenticated;

notify pgrst, 'reload schema';
