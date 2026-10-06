-- One Cursor cloud agent per Direct Message conversation with "The Agent".
-- The proxy Edge Function (service role) creates the agent on the first
-- request, sends later messages as follow-up runs, and writes the branch /
-- PR / Vercel preview back here. Staff only read their own row; they never
-- write it. Do not apply this to the live project from this PR; previews
-- share that database.

create table if not exists public.agent_builds (
  conversation_id uuid primary key,
  sender_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'baking',
  agent_id text not null default '',
  agent_url text not null default '',
  run_id text not null default '',
  run_started_at timestamptz,
  branch text not null default '',
  pr_url text not null default '',
  preview_url text not null default '',
  summary text not null default '',
  error text not null default '',
  pending_prompt text not null default '',
  pending_request_id uuid,
  last_request_id uuid,
  replied_run_id text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status in ('baking', 'ready', 'failed')),
  check (char_length(agent_id) <= 80),
  check (char_length(agent_url) <= 400),
  check (char_length(run_id) <= 80),
  check (char_length(replied_run_id) <= 80),
  check (char_length(branch) <= 200),
  check (char_length(pr_url) <= 400),
  check (char_length(preview_url) <= 400),
  check (char_length(summary) <= 4000),
  check (char_length(error) <= 1000),
  check (char_length(pending_prompt) <= 16000)
);

create index if not exists agent_builds_sender_updated_idx
  on public.agent_builds (sender_id, updated_at desc);

create or replace function public.agent_builds_touch()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists agent_builds_touch on public.agent_builds;
create trigger agent_builds_touch
  before insert or update on public.agent_builds
  for each row
  execute function public.agent_builds_touch();

alter table public.agent_builds enable row level security;
alter table public.agent_builds force row level security;

revoke all on table public.agent_builds from public, anon, authenticated;
grant select on table public.agent_builds to authenticated;
grant select, insert, update, delete on table public.agent_builds to service_role;

drop policy if exists agent_builds_select_own on public.agent_builds;
create policy agent_builds_select_own
  on public.agent_builds
  for select
  to authenticated
  using (
    (select public.is_active_staff())
    and sender_id = (select auth.uid())
  );

-- Agent replies show up in the same thread as status updates. 'reply' rows
-- carry the agent's final message for a run; 'status' rows keep the old copy.
alter table public.agent_request_events
  add column if not exists kind text not null default 'status';

alter table public.agent_request_events
  drop constraint if exists agent_request_events_kind_check;
alter table public.agent_request_events
  add constraint agent_request_events_kind_check
  check (kind in ('status', 'reply'));

alter table public.agent_builds replica identity full;

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    return;
  end if;
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'agent_builds'
  ) then
    execute 'alter publication supabase_realtime add table public.agent_builds';
  end if;
end $$;

notify pgrst, 'reload schema';
