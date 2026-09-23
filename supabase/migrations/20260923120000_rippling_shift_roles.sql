-- Scheduled shifts from the Rippling "Shift report by role" email. The hours
-- mailbox receives that CSV every 15 minutes; the proxy replaces the date
-- window it covers. Employee profiles read it for the schedule calendar.

alter table public.rippling_time_sync
  add column if not exists last_shift_at timestamptz,
  add column if not exists last_shift_count integer not null default 0;

create table if not exists public.rippling_shift_roles (
  shift_key text primary key,
  employee_rippling_id text not null,
  employee_name text not null default '',
  role_name text not null default '',
  location_name text not null default '',
  shift_date date not null,
  started_at timestamptz,
  ended_at timestamptz,
  start_label text not null default '',
  end_label text not null default '',
  source_message_id text not null default '',
  synced_at timestamptz not null default now(),
  check (char_length(shift_key) <= 240),
  check (char_length(employee_rippling_id) <= 100),
  check (char_length(employee_name) <= 200),
  check (char_length(role_name) <= 120),
  check (char_length(location_name) <= 200),
  check (char_length(start_label) <= 40),
  check (char_length(end_label) <= 40)
);

create index if not exists rippling_shift_roles_employee_date_idx
  on public.rippling_shift_roles (employee_rippling_id, shift_date);
create index if not exists rippling_shift_roles_date_idx
  on public.rippling_shift_roles (shift_date);

alter table public.rippling_shift_roles enable row level security;
alter table public.rippling_shift_roles force row level security;
revoke all on public.rippling_shift_roles from public, anon, authenticated;
grant select on table public.rippling_shift_roles to authenticated;
grant select, insert, update, delete on table public.rippling_shift_roles to service_role;

drop policy if exists rippling_shift_roles_select on public.rippling_shift_roles;
create policy rippling_shift_roles_select
  on public.rippling_shift_roles
  for select
  to authenticated
  using (public.is_active_staff());

-- Every file is a full snapshot of its date range. Rows missing from the
-- newest email were removed in Rippling and must go.
create or replace function public.replace_rippling_shift_roles(
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

  delete from public.rippling_shift_roles
  where shift_date between p_range_start and p_range_end;

  insert into public.rippling_shift_roles (
    shift_key,
    employee_rippling_id,
    employee_name,
    role_name,
    location_name,
    shift_date,
    started_at,
    ended_at,
    start_label,
    end_label,
    source_message_id,
    synced_at
  )
  select distinct on (left(r.shift_key, 240))
    left(r.shift_key, 240),
    left(r.employee_rippling_id, 100),
    left(coalesce(r.employee_name, ''), 200),
    left(coalesce(r.role_name, ''), 120),
    left(coalesce(r.location_name, ''), 200),
    r.shift_date,
    r.started_at,
    r.ended_at,
    left(coalesce(r.start_label, ''), 40),
    left(coalesce(r.end_label, ''), 40),
    coalesce(p_message_id, ''),
    now()
  from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as r(
    shift_key text,
    employee_rippling_id text,
    employee_name text,
    role_name text,
    location_name text,
    shift_date date,
    started_at timestamptz,
    ended_at timestamptz,
    start_label text,
    end_label text
  )
  where r.shift_key is not null
    and r.employee_rippling_id is not null
    and r.shift_date is not null
    and r.shift_date between p_range_start and p_range_end
  on conflict (shift_key) do update
    set employee_name = excluded.employee_name,
        role_name = excluded.role_name,
        location_name = excluded.location_name,
        started_at = excluded.started_at,
        ended_at = excluded.ended_at,
        start_label = excluded.start_label,
        end_label = excluded.end_label,
        source_message_id = excluded.source_message_id,
        synced_at = excluded.synced_at;

  get diagnostics inserted = row_count;
  return inserted;
end;
$$;

revoke all on function public.replace_rippling_shift_roles(date, date, text, jsonb) from public, anon, authenticated;
grant execute on function public.replace_rippling_shift_roles(date, date, text, jsonb) to service_role;

notify pgrst, 'reload schema';
