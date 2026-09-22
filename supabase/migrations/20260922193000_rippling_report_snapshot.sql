-- Latest Rippling CSV, exactly as it arrived. The Rippling screen renders this
-- table. Each new file replaces the previous one.

create table if not exists public.rippling_report_snapshot (
  id boolean primary key default true check (id),
  message_id text not null default '',
  subject text not null default '',
  from_address text not null default '',
  received_at timestamptz,
  attachment_name text not null default '',
  headers jsonb not null default '[]'::jsonb,
  rows jsonb not null default '[]'::jsonb,
  row_count integer not null default 0,
  updated_at timestamptz not null default now(),
  check (char_length(message_id) <= 200),
  check (char_length(subject) <= 500),
  check (char_length(from_address) <= 500),
  check (char_length(attachment_name) <= 300),
  check (row_count >= 0)
);

alter table public.rippling_report_snapshot enable row level security;
alter table public.rippling_report_snapshot force row level security;
revoke all on public.rippling_report_snapshot from public, anon, authenticated;
grant select on table public.rippling_report_snapshot to authenticated;
grant select, insert, update, delete on table public.rippling_report_snapshot to service_role;

drop policy if exists rippling_report_snapshot_select on public.rippling_report_snapshot;
create policy rippling_report_snapshot_select
  on public.rippling_report_snapshot
  for select
  to authenticated
  using (public.is_active_staff());

insert into public.rippling_report_snapshot (id)
values (true)
on conflict (id) do nothing;

-- Remember which inbox the reports come from when no OAuth token is stored.
insert into public.rippling_time_sync (id, gmail_email)
values (true, 'mycanadagold@gmail.com')
on conflict (id) do update
  set gmail_email = excluded.gmail_email
  where public.rippling_time_sync.gmail_refresh_token = '';

notify pgrst, 'reload schema';
