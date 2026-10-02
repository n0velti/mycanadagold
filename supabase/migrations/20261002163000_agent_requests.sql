-- Change requests staff send to "the agent" from Direct Messages.
-- One row per message. Staff only see (and write) their own requests.
-- Do not apply this to the live project from this PR; previews share that database.

create table if not exists public.agent_requests (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null,
  sender_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  body text not null,
  status text not null default 'new',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status in ('new', 'in_progress', 'done')),
  check (char_length(trim(body)) > 0 and char_length(body) <= 4000)
);

create index if not exists agent_requests_sender_created_idx
  on public.agent_requests (sender_id, created_at desc);

create index if not exists agent_requests_conversation_created_idx
  on public.agent_requests (conversation_id, created_at asc);

create or replace function public.agent_requests_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (select public.is_active_staff()) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    new.sender_id := (select auth.uid());
    new.created_at := now();
  else
    new.sender_id := old.sender_id;
    new.conversation_id := old.conversation_id;
    new.created_at := old.created_at;
    new.body := old.body;
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

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists agent_requests_before_write on public.agent_requests;
create trigger agent_requests_before_write
  before insert or update on public.agent_requests
  for each row
  execute function public.agent_requests_before_write();

revoke all on function public.agent_requests_before_write() from public, anon, authenticated;

alter table public.agent_requests enable row level security;
alter table public.agent_requests force row level security;

revoke all on table public.agent_requests from public, anon;
grant select, insert, update, delete on table public.agent_requests to authenticated;

drop policy if exists agent_requests_select_own on public.agent_requests;
drop policy if exists agent_requests_insert_own on public.agent_requests;
drop policy if exists agent_requests_update_own on public.agent_requests;
drop policy if exists agent_requests_delete_own on public.agent_requests;

create policy agent_requests_select_own
  on public.agent_requests
  for select
  to authenticated
  using (
    (select public.is_active_staff())
    and sender_id = (select auth.uid())
  );

create policy agent_requests_insert_own
  on public.agent_requests
  for insert
  to authenticated
  with check (
    (select public.is_active_staff())
    and (sender_id = (select auth.uid()) or sender_id is null)
  );

create policy agent_requests_update_own
  on public.agent_requests
  for update
  to authenticated
  using (
    (select public.is_active_staff())
    and sender_id = (select auth.uid())
  )
  with check (
    (select public.is_active_staff())
    and sender_id = (select auth.uid())
  );

create policy agent_requests_delete_own
  on public.agent_requests
  for delete
  to authenticated
  using (
    (select public.is_active_staff())
    and sender_id = (select auth.uid())
  );

notify pgrst, 'reload schema';
