-- Live progress for agent builds: a short note from the Cursor run stream,
-- a 0-100 percent, the tool-call count, and the SSE cursor so each poll
-- resumes where the last one stopped. Written by the proxy only.

alter table public.agent_builds
  add column if not exists progress_note text not null default '',
  add column if not exists progress_pct integer not null default 0,
  add column if not exists tool_calls integer not null default 0,
  add column if not exists stream_cursor text not null default '';

alter table public.agent_builds
  drop constraint if exists agent_builds_progress_note_check;
alter table public.agent_builds
  add constraint agent_builds_progress_note_check
  check (char_length(progress_note) <= 200);

alter table public.agent_builds
  drop constraint if exists agent_builds_progress_pct_check;
alter table public.agent_builds
  add constraint agent_builds_progress_pct_check
  check (progress_pct between 0 and 100);

alter table public.agent_builds
  drop constraint if exists agent_builds_stream_cursor_check;
alter table public.agent_builds
  add constraint agent_builds_stream_cursor_check
  check (char_length(stream_cursor) <= 120);

notify pgrst, 'reload schema';
