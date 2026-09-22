-- safeupdate rejects DELETE with no WHERE. The clock-in CSV replaces the
-- whole snapshot, so match every stored id instead of deleting the table bare.

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
  delete from public.rippling_clock_status
  where employee_rippling_id is not null;

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

notify pgrst, 'reload schema';
