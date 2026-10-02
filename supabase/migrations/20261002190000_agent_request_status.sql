-- Approval + progress on agent change requests, plus a status-event log
-- that shows up in the same Direct Message thread.
-- Staff who sent the request can read it. Only a System Admin or the
-- service role (proxy / AI assistant secret) can change status.
-- Do not apply this to the live project from this PR; previews share that database.

alter table public.agent_requests
  add column if not exists approval_state text not null default 'pending_review',
  add column if not exists approval_reason text;

alter table public.agent_requests
  drop constraint if exists agent_requests_approval_state_check;
alter table public.agent_requests
  add constraint agent_requests_approval_state_check
  check (approval_state in ('pending_review', 'approved', 'not_approved'));

alter table public.agent_requests
  drop constraint if exists agent_requests_approval_reason_check;
alter table public.agent_requests
  add constraint agent_requests_approval_reason_check
  check (approval_reason is null or char_length(approval_reason) <= 500);

create table if not exists public.agent_request_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.agent_requests (id) on delete cascade,
  conversation_id uuid not null,
  body text not null,
  status text not null,
  approval_state text not null,
  approval_reason text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  check (status in ('new', 'in_progress', 'done')),
  check (approval_state in ('pending_review', 'approved', 'not_approved')),
  check (char_length(trim(body)) > 0 and char_length(body) <= 1200)
);

create index if not exists agent_request_events_request_created_idx
  on public.agent_request_events (request_id, created_at asc);

create index if not exists agent_request_events_conversation_created_idx
  on public.agent_request_events (conversation_id, created_at asc);

create or replace function public.agent_request_status_copy(
  p_approval text,
  p_status text,
  p_reason text,
  p_prev_approval text default null,
  p_prev_status text default null
)
returns text
language plpgsql
immutable
as $$
declare
  approval text := coalesce(nullif(lower(trim(p_approval)), ''), 'pending_review');
  progress text := coalesce(nullif(lower(trim(p_status)), ''), 'new');
  reason text := left(trim(coalesce(p_reason, '')), 500);
  approval_changed boolean := p_prev_approval is null or p_prev_approval is distinct from approval;
  progress_changed boolean := p_prev_status is null or p_prev_status is distinct from progress;
  approval_copy text;
  progress_copy text;
  parts text[] := '{}';
begin
  approval_copy := case approval
    when 'approved' then 'Approved.'
    when 'not_approved' then 'Not approved.'
    else 'Pending review.'
  end;
  if approval = 'not_approved' and reason <> '' then
    approval_copy := approval_copy || ' ' || reason;
  end if;

  progress_copy := case progress
    when 'done' then 'Done. This request is finished.'
    when 'in_progress' then 'This is being worked on.'
    else 'This request is new.'
  end;

  if approval_changed then
    parts := array_append(parts, approval_copy);
  end if;
  if progress_changed then
    parts := array_append(parts, progress_copy);
  end if;
  if coalesce(array_length(parts, 1), 0) = 0 then
    parts := array[approval_copy];
  end if;
  return left(array_to_string(parts, ' '), 1200);
end;
$$;

revoke all on function public.agent_request_status_copy(text, text, text, text, text) from public, anon, authenticated;

create or replace function public.agent_requests_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  trusted boolean := false;
begin
  if auth.role() = 'service_role' or (select public.current_user_is_system_admin()) then
    trusted := true;
  elsif not (select public.is_active_staff()) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    if auth.role() is distinct from 'service_role' then
      new.sender_id := (select auth.uid());
    end if;
    new.created_at := now();
    if not trusted then
      new.status := 'new';
      new.approval_state := 'pending_review';
      new.approval_reason := null;
    end if;
  else
    new.sender_id := old.sender_id;
    new.conversation_id := old.conversation_id;
    new.created_at := old.created_at;
    new.body := old.body;
    if not trusted then
      new.status := old.status;
      new.approval_state := old.approval_state;
      new.approval_reason := old.approval_reason;
    end if;
  end if;

  new.body := trim(new.body);
  if new.body is null or char_length(new.body) = 0 then
    raise exception 'Type a message first';
  end if;
  if char_length(new.body) > 4000 then
    new.body := left(new.body, 4000);
  end if;

  new.status := coalesce(nullif(lower(trim(new.status)), ''), 'new');
  if new.status not in ('new', 'in_progress', 'done') then
    raise exception 'Unknown request status';
  end if;

  new.approval_state := coalesce(nullif(lower(trim(new.approval_state)), ''), 'pending_review');
  if new.approval_state not in ('pending_review', 'approved', 'not_approved') then
    raise exception 'Unknown approval state';
  end if;

  new.approval_reason := nullif(left(trim(coalesce(new.approval_reason, '')), 500), '');
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.agent_requests_after_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status is distinct from new.status
     or old.approval_state is distinct from new.approval_state
     or old.approval_reason is distinct from new.approval_reason then
    insert into public.agent_request_events (
      request_id,
      conversation_id,
      body,
      status,
      approval_state,
      approval_reason,
      created_by
    ) values (
      new.id,
      new.conversation_id,
      public.agent_request_status_copy(
        new.approval_state,
        new.status,
        new.approval_reason,
        old.approval_state,
        old.status
      ),
      new.status,
      new.approval_state,
      new.approval_reason,
      case when auth.role() = 'service_role' then null else auth.uid() end
    );
  end if;
  return new;
end;
$$;

drop trigger if exists agent_requests_before_write on public.agent_requests;
create trigger agent_requests_before_write
  before insert or update on public.agent_requests
  for each row
  execute function public.agent_requests_before_write();

drop trigger if exists agent_requests_after_status_change on public.agent_requests;
create trigger agent_requests_after_status_change
  after update on public.agent_requests
  for each row
  execute function public.agent_requests_after_status_change();

revoke all on function public.agent_requests_before_write() from public, anon, authenticated;
revoke all on function public.agent_requests_after_status_change() from public, anon, authenticated;

alter table public.agent_request_events enable row level security;
alter table public.agent_request_events force row level security;

revoke all on table public.agent_request_events from public, anon;
grant select on table public.agent_request_events to authenticated;

revoke update, delete on table public.agent_requests from public, anon, authenticated;
grant select, insert on table public.agent_requests to authenticated;
grant update on table public.agent_requests to authenticated;

drop policy if exists agent_requests_update_own on public.agent_requests;
drop policy if exists agent_requests_delete_own on public.agent_requests;
drop policy if exists agent_requests_update_admin on public.agent_requests;
drop policy if exists agent_request_events_select_own on public.agent_request_events;

create policy agent_requests_update_admin
  on public.agent_requests
  for update
  to authenticated
  using (
    (select public.is_active_staff())
    and (select public.current_user_is_system_admin())
  )
  with check (
    (select public.is_active_staff())
    and (select public.current_user_is_system_admin())
  );

create policy agent_request_events_select_own
  on public.agent_request_events
  for select
  to authenticated
  using (
    (select public.is_active_staff())
    and exists (
      select 1
      from public.agent_requests r
      where r.id = request_id
        and r.sender_id = (select auth.uid())
    )
  );

alter table public.agent_requests replica identity full;
alter table public.agent_request_events replica identity full;

do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    return;
  end if;
  foreach t in array array['agent_requests', 'agent_request_events']
  loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
