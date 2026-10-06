-- "Publish" on an agent build: the requester is happy with the preview and
-- asks a System Admin to push it to dev / main. Cleared whenever a new run
-- starts so a later edit needs a fresh Publish. Written by the proxy only.

alter table public.agent_builds
  add column if not exists publish_state text not null default '',
  add column if not exists published_at timestamptz,
  add column if not exists published_run_id text not null default '';

alter table public.agent_builds
  drop constraint if exists agent_builds_publish_state_check;
alter table public.agent_builds
  add constraint agent_builds_publish_state_check
  check (publish_state in ('', 'requested', 'published'));

alter table public.agent_builds
  drop constraint if exists agent_builds_published_run_id_check;
alter table public.agent_builds
  add constraint agent_builds_published_run_id_check
  check (char_length(published_run_id) <= 80);

notify pgrst, 'reload schema';
