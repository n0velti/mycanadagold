-- Each CSV that arrived for the hours feed, so the Rippling screen can show
-- when it came in and whether it was an email or a file dropped in the app.
-- The newest file is the one on screen; an older email does not replace it.

alter table public.rippling_time_sync
  add column if not exists last_time_at timestamptz;

create table if not exists public.rippling_csv_files (
  id uuid primary key default gen_random_uuid(),
  message_id text not null default '',
  attachment_name text not null default '',
  subject text not null default '',
  source text not null default 'email',
  received_at timestamptz not null default now(),
  row_count integer not null default 0,
  kind text not null default 'csv',
  is_current boolean not null default false,
  created_at timestamptz not null default now(),
  check (source in ('email', 'drop')),
  check (char_length(message_id) <= 200),
  check (char_length(attachment_name) <= 300),
  check (char_length(subject) <= 500),
  check (char_length(kind) <= 40),
  check (row_count >= 0)
);

create unique index if not exists rippling_csv_files_message_name
  on public.rippling_csv_files (message_id, attachment_name);

create index if not exists rippling_csv_files_received_idx
  on public.rippling_csv_files (received_at desc);

alter table public.rippling_csv_files enable row level security;
alter table public.rippling_csv_files force row level security;
revoke all on public.rippling_csv_files from public, anon, authenticated;
grant select on table public.rippling_csv_files to authenticated;
grant select, insert, update, delete on table public.rippling_csv_files to service_role;

drop policy if exists rippling_csv_files_select on public.rippling_csv_files;
create policy rippling_csv_files_select
  on public.rippling_csv_files
  for select
  to authenticated
  using (public.is_active_staff());

insert into public.rippling_csv_files (
  message_id, attachment_name, subject, source, received_at, row_count, kind, is_current
)
select
  s.message_id,
  s.attachment_name,
  s.subject,
  case
    when s.message_id like 'drop:%' or s.from_address ilike '%dropped%' then 'drop'
    else 'email'
  end,
  coalesce(s.received_at, s.updated_at, now()),
  s.row_count,
  case
    when exists (
      select 1 from jsonb_array_elements_text(s.headers) as header
      where header ~* 'clocked[[:space:]]*in'
    ) then 'clock'
    else 'csv'
  end,
  true
from public.rippling_report_snapshot s
where s.attachment_name <> ''
on conflict (message_id, attachment_name) do nothing;

-- The clock-in CSV already on screen should fill the ring table if that import
-- saved the table but not the per-person rows.
insert into public.rippling_clock_status (
  employee_rippling_id, employee_name, is_clocked_in, reported_at, source_message_id
)
select distinct on (left(line->>0, 100))
  left(line->>0, 100),
  left(coalesce(line->>1, ''), 200),
  lower(trim(coalesce(line->>2, ''))) in ('yes', 'true', 'y', '1', 'clocked in', 'in'),
  coalesce(s.received_at, s.updated_at, now()),
  left(coalesce(s.message_id, ''), 200)
from public.rippling_report_snapshot s
cross join lateral jsonb_array_elements(s.rows) as line
where exists (
  select 1 from jsonb_array_elements_text(s.headers) as header
  where header ~* 'clocked[[:space:]]*in'
)
  and coalesce(line->>0, '') <> ''
  and not exists (select 1 from public.rippling_clock_status)
on conflict (employee_rippling_id) do nothing;

update public.rippling_time_sync sync
set
  last_clock_at = coalesce(sync.last_clock_at, s.received_at),
  last_clock_count = (
    select count(*) from public.rippling_clock_status where is_clocked_in
  )
from public.rippling_report_snapshot s
where sync.id
  and s.received_at is not null
  and exists (select 1 from public.rippling_clock_status);

notify pgrst, 'reload schema';
