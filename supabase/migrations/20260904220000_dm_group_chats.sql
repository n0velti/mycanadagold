-- Group chats on top of 1:1 DMs. Existing pair conversations stay is_group = false.
-- list_dm_inbox is replaced so a group is one inbox row with a members array,
-- not one row per other participant.

alter table public.dm_conversations
  add column if not exists is_group boolean not null default false;

alter table public.dm_conversations
  add column if not exists title text;

alter table public.dm_conversations
  add column if not exists created_by uuid references public.profiles (id) on delete set null;

alter table public.dm_conversations
  drop constraint if exists dm_conversations_title_len;

alter table public.dm_conversations
  add constraint dm_conversations_title_len
  check (title is null or char_length(trim(title)) between 1 and 80);

drop function if exists public.list_dm_inbox();

create or replace function public.list_dm_inbox()
returns table (
  conversation_id uuid,
  is_group boolean,
  title text,
  members jsonb,
  last_message_preview text,
  last_message_at timestamptz,
  last_message_sender_id uuid,
  unread_count bigint,
  last_read_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.id,
    c.is_group,
    nullif(trim(c.title), ''),
    (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', o.id,
            'first_name', o.first_name,
            'last_name', o.last_name,
            'full_name', coalesce(
              nullif(trim(o.full_name), ''),
              nullif(trim(concat_ws(' ', o.first_name, o.last_name)), ''),
              'Teammate'
            ),
            'avatar_url', o.avatar_url,
            'location_name', o.location_name,
            'last_seen_at', pr.last_seen_at,
            'is_online', coalesce(pr.is_online, false)
              and pr.last_seen_at > now() - interval '90 seconds'
          )
          order by coalesce(nullif(trim(o.full_name), ''), o.first_name, '')
        ),
        '[]'::jsonb
      )
      from public.dm_participants otherp
      join public.profiles o on o.id = otherp.user_id
      left join public.dm_presence pr on pr.user_id = o.id
      where otherp.conversation_id = c.id
        and otherp.user_id <> auth.uid()
    ),
    c.last_message_preview,
    c.last_message_at,
    (
      select m.sender_id
      from public.dm_messages m
      where m.conversation_id = c.id
      order by m.created_at desc
      limit 1
    ),
    (
      select count(*)::bigint
      from public.dm_messages m
      where m.conversation_id = c.id
        and m.sender_id <> auth.uid()
        and m.created_at > coalesce(me.last_read_at, 'epoch'::timestamptz)
    ),
    me.last_read_at
  from public.dm_participants me
  join public.dm_conversations c on c.id = me.conversation_id
  where public.is_active_staff()
    and me.user_id = auth.uid()
  order by c.last_message_at desc nulls last, c.created_at desc;
$$;

revoke all on function public.list_dm_inbox() from public, anon;
grant execute on function public.list_dm_inbox() to authenticated;

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

  return conv_id;
end;
$$;

revoke all on function public.create_dm_group(uuid[], text) from public, anon;
grant execute on function public.create_dm_group(uuid[], text) to authenticated;

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
end;
$$;

revoke all on function public.add_dm_group_members(uuid, uuid[]) from public, anon;
grant execute on function public.add_dm_group_members(uuid, uuid[]) to authenticated;

create or replace function public.rename_dm_group(p_conversation_id uuid, p_title text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  label text;
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

  label := nullif(trim(coalesce(p_title, '')), '');
  if label is not null and char_length(label) > 80 then
    label := left(label, 80);
  end if;

  update public.dm_conversations
  set title = label,
      updated_at = now()
  where id = p_conversation_id;
end;
$$;

revoke all on function public.rename_dm_group(uuid, text) from public, anon;
grant execute on function public.rename_dm_group(uuid, text) to authenticated;

create or replace function public.leave_dm_group(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  remaining int;
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

  delete from public.dm_participants
  where conversation_id = p_conversation_id
    and user_id = auth.uid();

  select count(*) into remaining
  from public.dm_participants
  where conversation_id = p_conversation_id;

  if remaining = 0 then
    delete from public.dm_conversations where id = p_conversation_id;
  else
    update public.dm_conversations
    set updated_at = now()
    where id = p_conversation_id;
  end if;
end;
$$;

revoke all on function public.leave_dm_group(uuid) from public, anon;
grant execute on function public.leave_dm_group(uuid) to authenticated;

notify pgrst, 'reload schema';
