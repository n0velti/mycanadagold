-- Saved MyCanadaGold AI chats live in the same inbox as staff conversations.
-- Only the owner is a participant. Assistant lines are flagged so they render
-- on the left even though sender_id is the owner (profiles must be real users).

alter table public.dm_conversations
  add column if not exists is_ai boolean not null default false;

alter table public.dm_messages
  add column if not exists is_assistant boolean not null default false;

drop function if exists public.list_dm_inbox();

create function public.list_dm_inbox()
returns table (
  conversation_id uuid,
  is_group boolean,
  is_ai boolean,
  title text,
  team_id uuid,
  members jsonb,
  last_message_preview text,
  last_message_at timestamptz,
  last_message_sender_id uuid,
  last_message_is_assistant boolean,
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
    c.is_group or c.team_id is not null or c.is_ai,
    c.is_ai,
    coalesce(nullif(trim(c.title), ''), t.name),
    c.team_id,
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
            'team_id', o.team_id,
            'is_team_intake', coalesce(o.is_team_intake, false),
            'last_seen_at', pr.last_seen_at,
            'is_online', coalesce(pr.is_online, false)
              and pr.last_seen_at > now() - interval '90 seconds'
          )
          order by
            coalesce(o.is_team_intake, false) desc,
            coalesce(nullif(trim(o.full_name), ''), o.first_name, '')
        ),
        '[]'::jsonb
      )
      from public.dm_participants otherp
      join public.profiles o on o.id = otherp.user_id
      left join public.dm_presence pr on pr.user_id = o.id
      where otherp.conversation_id = c.id
        and otherp.user_id <> auth.uid()
    ),
    left(visible.body, 240),
    visible.created_at,
    visible.sender_id,
    coalesce(visible.is_assistant, false),
    (
      select count(*)::bigint
      from public.dm_messages m
      where m.conversation_id = c.id
        and m.sender_id <> auth.uid()
        and m.is_assistant = false
        and m.created_at > coalesce(me.last_read_at, 'epoch'::timestamptz)
        and not exists (
          select 1
          from public.dm_message_hides h
          where h.message_id = m.id
            and h.user_id = auth.uid()
        )
    ),
    me.last_read_at
  from public.dm_participants me
  join public.dm_conversations c on c.id = me.conversation_id
  left join public.teams t on t.id = c.team_id
  left join lateral (
    select m.body, m.created_at, m.sender_id, m.is_assistant
    from public.dm_messages m
    where m.conversation_id = c.id
      and not exists (
        select 1
        from public.dm_message_hides h
        where h.message_id = m.id
          and h.user_id = auth.uid()
      )
    order by m.created_at desc
    limit 1
  ) visible on true
  where public.is_active_staff()
    and me.user_id = auth.uid()
  order by visible.created_at desc nulls last, c.created_at desc;
$$;

revoke all on function public.list_dm_inbox() from public, anon;
grant execute on function public.list_dm_inbox() to authenticated;

create or replace function public.save_ai_dm_chat(p_title text, p_turns jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  conv_id uuid;
  label text;
  rec record;
  role text;
  body text;
  saved integer := 0;
begin
  if not public.is_active_staff() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  if jsonb_typeof(p_turns) is distinct from 'array' or jsonb_array_length(p_turns) = 0 then
    raise exception 'Nothing to save';
  end if;

  label := nullif(trim(coalesce(p_title, '')), '');
  if label is null then
    label := 'MyCanadaGold AI chat';
  end if;
  if char_length(label) > 80 then
    label := left(label, 80);
  end if;

  insert into public.dm_conversations (is_group, is_ai, title, created_by)
  values (true, true, label, me)
  returning id into conv_id;

  insert into public.dm_participants (conversation_id, user_id, last_read_at)
  values (conv_id, me, now());

  for rec in
    select value, ordinality
    from jsonb_array_elements(p_turns) with ordinality
  loop
    role := lower(trim(coalesce(rec.value->>'role', '')));
    body := left(trim(coalesce(rec.value->>'content', '')), 4000);
    if body = '' or role not in ('user', 'assistant') then
      continue;
    end if;
    insert into public.dm_messages (
      conversation_id,
      sender_id,
      body,
      is_assistant,
      created_at
    )
    values (
      conv_id,
      me,
      body,
      role = 'assistant',
      clock_timestamp() + (rec.ordinality * interval '1 millisecond')
    );
    saved := saved + 1;
  end loop;

  if saved = 0 then
    raise exception 'Nothing to save';
  end if;

  return conv_id;
end;
$$;

revoke all on function public.save_ai_dm_chat(text, jsonb) from public, anon;
grant execute on function public.save_ai_dm_chat(text, jsonb) to authenticated;
