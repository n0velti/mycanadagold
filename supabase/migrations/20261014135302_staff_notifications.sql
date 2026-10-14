-- In-app notifications for staff. First use: you were added to a Direct
-- Message or AI chat. The badge on the profile tab is the unread count.

create table if not exists public.staff_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  actor_id uuid references public.profiles (id) on delete set null,
  conversation_id uuid references public.dm_conversations (id) on delete cascade,
  kind text not null,
  title text not null,
  body text not null default '',
  read_at timestamptz,
  created_at timestamptz not null default now(),
  constraint staff_notifications_kind_check
    check (kind in ('added_to_chat')),
  constraint staff_notifications_title_check
    check (char_length(trim(title)) between 1 and 160),
  constraint staff_notifications_body_check
    check (char_length(body) <= 400)
);

create index if not exists staff_notifications_user_unread_idx
  on public.staff_notifications (user_id, created_at desc)
  where read_at is null;

create index if not exists staff_notifications_user_created_idx
  on public.staff_notifications (user_id, created_at desc);

alter table public.staff_notifications enable row level security;
alter table public.staff_notifications force row level security;

revoke all on table public.staff_notifications from public, anon;
grant select, update on table public.staff_notifications to authenticated;

create policy staff_notifications_select
  on public.staff_notifications
  for select
  to authenticated
  using (
    user_id = (select auth.uid())
    and (select public.is_active_staff())
  );

create policy staff_notifications_update
  on public.staff_notifications
  for update
  to authenticated
  using (
    user_id = (select auth.uid())
    and (select public.is_active_staff())
  )
  with check (
    user_id = (select auth.uid())
    and (select public.is_active_staff())
  );

create or replace function public.notify_added_to_dm(
  p_conversation_id uuid,
  p_member_ids uuid[],
  p_actor uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_name text;
  chat_title text;
  is_ai_chat boolean := false;
  headline text;
  detail text;
begin
  if p_conversation_id is null or p_actor is null then
    return;
  end if;

  select
    coalesce(
      nullif(trim(concat_ws(' ', p.first_name, p.last_name)), ''),
      nullif(trim(p.full_name), ''),
      'A teammate'
    )
  into actor_name
  from public.profiles p
  where p.id = p_actor;

  select
    c.is_ai,
    coalesce(nullif(trim(c.title), ''), t.name, '')
  into is_ai_chat, chat_title
  from public.dm_conversations c
  left join public.teams t on t.id = c.team_id
  where c.id = p_conversation_id;

  if is_ai_chat then
    headline := actor_name || ' added you to an AI chat';
    detail := case
      when chat_title <> '' and lower(chat_title) not in ('new ai chat', 'mycanadagold ai', 'mycanadagold ai chat')
        then chat_title
      else 'You can see the history and talk to the AI with them.'
    end;
  else
    headline := actor_name || ' added you to a chat';
    detail := case
      when chat_title <> '' then chat_title
      else 'Open Direct Messages to join the conversation.'
    end;
  end if;

  insert into public.staff_notifications (
    user_id,
    actor_id,
    conversation_id,
    kind,
    title,
    body
  )
  select
    x,
    p_actor,
    p_conversation_id,
    'added_to_chat',
    left(headline, 160),
    left(detail, 400)
  from unnest(coalesce(p_member_ids, '{}'::uuid[])) as x
  where x is not null
    and x <> p_actor;
end;
$$;

revoke all on function public.notify_added_to_dm(uuid, uuid[], uuid) from public, anon, authenticated;

create or replace function public.add_dm_group_members(p_conversation_id uuid, p_member_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  ids uuid[];
begin
  if not public.dm_is_participant(p_conversation_id) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.dm_conversations c
    where c.id = p_conversation_id and c.is_group
  ) then
    raise exception 'That is not a group chat';
  end if;

  select coalesce(array_agg(distinct x), '{}') into ids
  from unnest(coalesce(p_member_ids, '{}'::uuid[])) as x
  where x is not null
    and x <> auth.uid()
    and not exists (
      select 1
      from public.dm_participants p
      where p.conversation_id = p_conversation_id
        and p.user_id = x
    );

  if cardinality(ids) = 0 then
    return;
  end if;

  if exists (
    select 1
    from unnest(ids) as x
    where not exists (
      select 1 from public.profiles p where p.id = x and p.is_active
    )
  ) then
    raise exception 'Someone you picked is not available';
  end if;

  if (
    select count(*) from public.dm_participants p where p.conversation_id = p_conversation_id
  ) + cardinality(ids) > 50 then
    raise exception 'Groups can have at most 50 people';
  end if;

  insert into public.dm_participants (conversation_id, user_id)
  select p_conversation_id, x from unnest(ids) as x;

  update public.dm_conversations
  set updated_at = now()
  where id = p_conversation_id;

  perform public.notify_added_to_dm(p_conversation_id, ids, auth.uid());
end;
$$;

revoke all on function public.add_dm_group_members(uuid, uuid[]) from public, anon;
grant execute on function public.add_dm_group_members(uuid, uuid[]) to authenticated;

create or replace function public.create_dm_group(p_member_ids uuid[], p_title text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  conv_id uuid;
  ids uuid[];
  label text;
begin
  if not public.is_active_staff() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  select coalesce(array_agg(distinct x), '{}') into ids
  from unnest(coalesce(p_member_ids, '{}'::uuid[])) as x
  where x is not null and x <> me;

  if cardinality(ids) = 0 then
    raise exception 'Pick people to add';
  end if;

  if cardinality(ids) = 1 then
    return public.get_or_create_dm(ids[1]);
  end if;

  if cardinality(ids) > 49 then
    raise exception 'Groups can have at most 50 people';
  end if;

  if exists (
    select 1
    from unnest(ids) as x
    where not exists (
      select 1 from public.profiles p where p.id = x and p.is_active
    )
  ) then
    raise exception 'Someone you picked is not available';
  end if;

  label := nullif(trim(coalesce(p_title, '')), '');
  if label is not null and char_length(label) > 80 then
    label := left(label, 80);
  end if;

  insert into public.dm_conversations (is_group, title, created_by)
  values (true, label, me)
  returning id into conv_id;

  insert into public.dm_participants (conversation_id, user_id)
  select conv_id, me
  union
  select conv_id, x from unnest(ids) as x;

  perform public.notify_added_to_dm(conv_id, ids, me);

  return conv_id;
end;
$$;

revoke all on function public.create_dm_group(uuid[], text) from public, anon;
grant execute on function public.create_dm_group(uuid[], text) to authenticated;

create or replace function public.staff_notification_unread_count()
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::bigint
  from public.staff_notifications n
  where public.is_active_staff()
    and n.user_id = auth.uid()
    and n.read_at is null;
$$;

revoke all on function public.staff_notification_unread_count() from public, anon;
grant execute on function public.staff_notification_unread_count() to authenticated;

create or replace function public.mark_staff_notifications_read(p_conversation_id uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_active_staff() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  update public.staff_notifications
  set read_at = now()
  where user_id = auth.uid()
    and read_at is null
    and (p_conversation_id is null or conversation_id = p_conversation_id);
end;
$$;

revoke all on function public.mark_staff_notifications_read(uuid) from public, anon;
grant execute on function public.mark_staff_notifications_read(uuid) to authenticated;

alter table public.staff_notifications replica identity full;

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'staff_notifications'
  ) then
    execute 'alter publication supabase_realtime add table public.staff_notifications';
  end if;
end
$$;

notify pgrst, 'reload schema';
