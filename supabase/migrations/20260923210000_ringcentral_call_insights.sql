-- Phone app: AI review of recorded store calls.
--
-- One row per recorded call per analysis source. The proxy submits the
-- recording to RingCentral's AI API (async: the result arrives on a public
-- webhook) or reads RingSense insights directly, then stores the result here
-- so staff can read it without hitting RingCentral again. Only the proxy
-- (service role) touches this table; the app reads it through /proxy.

create table if not exists public.ringcentral_call_insights (
  id uuid primary key default gen_random_uuid(),
  store_key text not null,
  store_name text not null default '',
  telephony_session_id text not null default '',
  recording_id text not null default '',
  call_log_id text not null default '',
  source text not null default 'rc_ai',            -- rc_ai | ringsense
  status text not null default 'queued',           -- queued | processing | done | failed
  language_code text not null default 'en-US',
  job_id text not null default '',
  direction text not null default '',
  from_number text not null default '',
  from_name text not null default '',
  to_number text not null default '',
  to_name text not null default '',
  duration integer not null default 0,
  call_started_at timestamptz,
  result jsonb,
  error text not null default '',
  requested_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table public.ringcentral_call_insights
  drop constraint if exists ringcentral_call_insights_source_check;
alter table public.ringcentral_call_insights
  add constraint ringcentral_call_insights_source_check
  check (source in ('rc_ai', 'ringsense'));

alter table public.ringcentral_call_insights
  drop constraint if exists ringcentral_call_insights_status_check;
alter table public.ringcentral_call_insights
  add constraint ringcentral_call_insights_status_check
  check (status in ('queued', 'processing', 'done', 'failed'));

-- One analysis per recording (or per session for RingSense) per source.
create unique index if not exists ringcentral_call_insights_unique_idx
  on public.ringcentral_call_insights (store_key, source, recording_id, telephony_session_id);

create index if not exists ringcentral_call_insights_store_idx
  on public.ringcentral_call_insights (store_key, created_at desc);
create index if not exists ringcentral_call_insights_status_idx
  on public.ringcentral_call_insights (status)
  where status in ('queued', 'processing');

alter table public.ringcentral_call_insights enable row level security;
alter table public.ringcentral_call_insights force row level security;

revoke all on public.ringcentral_call_insights from public, anon, authenticated;
grant select, insert, update, delete on table public.ringcentral_call_insights to service_role;

notify pgrst, 'reload schema';
