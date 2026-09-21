-- Who is clocked in right now, from the Rippling "Clock In report" CSV that
-- arrives in the same hourly email as the time report. Full snapshot per
-- import; the Employees screen draws a green ring around clocked-in staff.

create table if not exists public.rippling_clock_status (
  employee_rippling_id text primary key,
  employee_name text not null default '',
  is_clocked_in boolean not null default false,
  reported_at timestamptz not null default now(),
  source_message_id text not null default '',
  check (char_length(employee_rippling_id) <= 100),
  check (char_length(employee_name) <= 200)
);

alter table public.rippling_clock_status enable row level security;
alter table public.rippling_clock_status force row level security;
revoke all on public.rippling_clock_status from public, anon, authenticated;
grant select on table public.rippling_clock_status to authenticated;
grant select, insert, update, delete on table public.rippling_clock_status to service_role;

drop policy if exists rippling_clock_status_select on public.rippling_clock_status;
create policy rippling_clock_status_select
  on public.rippling_clock_status
  for select
  to authenticated
  using (public.is_active_staff());

alter table public.rippling_time_sync
  add column if not exists last_clock_at timestamptz,
  add column if not exists last_clock_count integer not null default 0;

-- Replace the whole snapshot. Rows are { employee_rippling_id, employee_name, is_clocked_in }.
create or replace function public.replace_rippling_clock_status(
  p_message_id text,
  p_reported_at timestamptz,
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
  delete from public.rippling_clock_status;

  insert into public.rippling_clock_status (
    employee_rippling_id,
    employee_name,
    is_clocked_in,
    reported_at,
    source_message_id
  )
  select distinct on (left(r.employee_rippling_id, 100))
    left(r.employee_rippling_id, 100),
    left(coalesce(r.employee_name, ''), 200),
    coalesce(r.is_clocked_in, false),
    coalesce(p_reported_at, now()),
    coalesce(p_message_id, '')
  from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as r(
    employee_rippling_id text,
    employee_name text,
    is_clocked_in boolean
  )
  where r.employee_rippling_id is not null
    and r.employee_rippling_id <> '';

  get diagnostics inserted = row_count;
  return inserted;
end;
$$;

revoke all on function public.replace_rippling_clock_status(text, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.replace_rippling_clock_status(text, timestamptz, jsonb) to service_role;

alter table public.rippling_clock_status replica identity full;

notify pgrst, 'reload schema';
