-- Rippling's "Shift report by role" export marks each shift Published, Draft,
-- or Pending delete. The proxy now keeps Published and Draft (so a calendar
-- can show a draft as tentative) and drops Pending delete. Additive: a status
-- column with a default, and the replace function learns the new field.

alter table public.rippling_shift_roles
  add column if not exists status text not null default 'published';

alter table public.rippling_shift_roles
  drop constraint if exists rippling_shift_roles_status_check;
alter table public.rippling_shift_roles
  add constraint rippling_shift_roles_status_check
  check (status in ('published', 'draft'));

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
    status,
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
    case when lower(coalesce(r.status, '')) = 'draft' then 'draft' else 'published' end,
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
    end_label text,
    status text
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
        status = excluded.status,
        source_message_id = excluded.source_message_id,
        synced_at = excluded.synced_at;

  get diagnostics inserted = row_count;
  return inserted;
end;
$$;

revoke all on function public.replace_rippling_shift_roles(date, date, text, jsonb) from public, anon, authenticated;
grant execute on function public.replace_rippling_shift_roles(date, date, text, jsonb) to service_role;

notify pgrst, 'reload schema';
