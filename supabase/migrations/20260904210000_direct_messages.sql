-- Direct Messages: 1:1 staff chats, presence / last seen, and message likes.
-- Contacts are a limited staff directory (names + avatar + presence) so every
-- signed-in employee can message coworkers without opening the full profile row.

create table if not exists public.dm_conversations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_message_at timestamptz,
  last_message_preview text
);

create table if not exists public.dm_pairs (
  user_a uuid not null references public.profiles (id) on delete cascade,
  user_b uuid not null references public.profiles (id) on delete cascade,
  conversation_id uuid not null unique references public.dm_conversations (id) on delete cascade,
  primary key (user_a, user_b),
  check (user_a < user_b)
);

create table if not exists public.dm_participants (
  conversation_id uuid not null references public.dm_conversations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  last_read_at timestamptz,
  joined_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create index if not exists dm_participants_user_id_idx
  on public.dm_participants (user_id);

create table if not exists public.dm_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.dm_conversations (id) on delete cascade,
  sender_id uuid not null references public.profiles (id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  check (char_length(trim(body)) > 0 and char_length(body) <= 4000)
);

create index if not exists dm_messages_conversation_created_idx
  on public.dm_messages (conversation_id, created_at);

create table if not exists public.dm_message_likes (
  message_id uuid not null references public.dm_messages (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

create index if not exists dm_message_likes_user_id_idx
  on public.dm_message_likes (user_id);

create table if not exists public.dm_presence (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  last_seen_at timestamptz not null default now(),
  is_online boolean not null default false
);

create or replace function public.dm_is_participant(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_active_staff()
    and exists (
      select 1
      from public.dm_participants p
      where p.conversation_id = p_conversation_id
        and p.user_id = auth.uid()
    );
$$;

revoke all on function public.dm_is_participant(uuid) from public, anon;
grant execute on function public.dm_is_participant(uuid) to authenticated;

create or replace function public.dm_messages_after_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.dm_conversations
  set
    last_message_at = new.created_at,
    last_message_preview = left(new.body, 240),
    updated_at = now()
  where id = new.conversation_id;
  return new;
end;
$$;

drop trigger if exists dm_messages_after_insert on public.dm_messages;
create trigger dm_messages_after_insert
  after insert on public.dm_messages
  for each row
  execute function public.dm_messages_after_insert();

revoke all on function public.dm_messages_after_insert() from public, anon, authenticated;

create or replace function public.list_dm_contacts()
returns table (
  id uuid,
  first_name text,
  last_name text,
  full_name text,
  avatar_url text,
  location_name text,
  last_seen_at timestamptz,
  is_online boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id,
    p.first_name,
    p.last_name,
    coalesce(
      nullif(trim(p.full_name), ''),
      nullif(trim(concat_ws(' ', p.first_name, p.last_name)), ''),
      'Teammate'
    ),
    p.avatar_url,
    p.location_name,
    pr.last_seen_at,
    coalesce(pr.is_online, false)
      and pr.last_seen_at > now() - interval '90 seconds'
  from public.profiles p
  left join public.dm_presence pr on pr.user_id = p.id
  where public.is_active_staff()
    and p.is_active
    and p.id <> auth.uid()
  order by 4 asc;
$$;

revoke all on function public.list_dm_contacts() from public, anon;
grant execute on function public.list_dm_contacts() to authenticated;

create or replace function public.get_or_create_dm(other_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  a uuid;
  b uuid;
  conv_id uuid;
begin
  if not public.is_active_staff() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if other_user_id is null or other_user_id = me then
    raise exception 'Pick someone else to message';
  end if;
  if not exists (
    select 1
    from public.profiles p
    where p.id = other_user_id
      and p.is_active
  ) then
    raise exception 'That person is not available';
  end if;

  if me < other_user_id then
    a := me;
    b := other_user_id;
  else
    a := other_user_id;
    b := me;
  end if;

  select conversation_id into conv_id
  from public.dm_pairs
  where user_a = a and user_b = b;

  if conv_id is not null then
    return conv_id;
  end if;

  insert into public.dm_conversations default values
  returning id into conv_id;

  insert into public.dm_pairs (user_a, user_b, conversation_id)
  values (a, b, conv_id);

  insert into public.dm_participants (conversation_id, user_id)
  values (conv_id, me), (conv_id, other_user_id);

  return conv_id;
exception
  when unique_violation then
    select conversation_id into conv_id
    from public.dm_pairs
    where user_a = a and user_b = b;
    return conv_id;
end;
$$;

revoke all on function public.get_or_create_dm(uuid) from public, anon;
grant execute on function public.get_or_create_dm(uuid) to authenticated;

create or replace function public.list_dm_inbox()
returns table (
  conversation_id uuid,
  other_user_id uuid,
  other_first_name text,
  other_last_name text,
  other_full_name text,
  other_avatar_url text,
  other_location_name text,
  last_message_preview text,
  last_message_at timestamptz,
  last_message_sender_id uuid,
  unread_count bigint,
  last_read_at timestamptz,
  last_seen_at timestamptz,
  is_online boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.id,
    o.id,
    o.first_name,
    o.last_name,
    coalesce(
      nullif(trim(o.full_name), ''),
      nullif(trim(concat_ws(' ', o.first_name, o.last_name)), ''),
      'Teammate'
    ),
    o.avatar_url,
    o.location_name,
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
    me.last_read_at,
    pr.last_seen_at,
    coalesce(pr.is_online, false)
      and pr.last_seen_at > now() - interval '90 seconds'
  from public.dm_participants me
  join public.dm_conversations c on c.id = me.conversation_id
  join public.dm_participants otherp
    on otherp.conversation_id = c.id
   and otherp.user_id <> auth.uid()
  join public.profiles o on o.id = otherp.user_id
  left join public.dm_presence pr on pr.user_id = o.id
  where public.is_active_staff()
    and me.user_id = auth.uid()
  order by c.last_message_at desc nulls last, c.created_at desc;
$$;

revoke all on function public.list_dm_inbox() from public, anon;
grant execute on function public.list_dm_inbox() to authenticated;

create or replace function public.dm_unread_total()
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select sum(unread)::bigint
    from (
      select (
        select count(*)::bigint
        from public.dm_messages m
        where m.conversation_id = p.conversation_id
          and m.sender_id <> auth.uid()
          and m.created_at > coalesce(p.last_read_at, 'epoch'::timestamptz)
      ) as unread
      from public.dm_participants p
      where p.user_id = auth.uid()
        and public.is_active_staff()
    ) counts
  ), 0);
$$;

revoke all on function public.dm_unread_total() from public, anon;
grant execute on function public.dm_unread_total() to authenticated;

create or replace function public.mark_dm_read(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.dm_is_participant(p_conversation_id) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  update public.dm_participants
  set last_read_at = now()
  where conversation_id = p_conversation_id
    and user_id = auth.uid();
end;
$$;

revoke all on function public.mark_dm_read(uuid) from public, anon;
grant execute on function public.mark_dm_read(uuid) to authenticated;

create or replace function public.heartbeat_dm_presence(p_online boolean default true)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_active_staff() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  insert into public.dm_presence (user_id, last_seen_at, is_online)
  values (auth.uid(), now(), coalesce(p_online, true))
  on conflict (user_id) do update
    set last_seen_at = now(),
        is_online = excluded.is_online;
end;
$$;

revoke all on function public.heartbeat_dm_presence(boolean) from public, anon;
grant execute on function public.heartbeat_dm_presence(boolean) to authenticated;

alter table public.dm_conversations enable row level security;
alter table public.dm_conversations force row level security;
alter table public.dm_pairs enable row level security;
alter table public.dm_pairs force row level security;
alter table public.dm_participants enable row level security;
alter table public.dm_participants force row level security;
alter table public.dm_messages enable row level security;
alter table public.dm_messages force row level security;
alter table public.dm_message_likes enable row level security;
alter table public.dm_message_likes force row level security;
alter table public.dm_presence enable row level security;
alter table public.dm_presence force row level security;

revoke all on table public.dm_conversations from public, anon;
revoke all on table public.dm_pairs from public, anon;
revoke all on table public.dm_participants from public, anon;
revoke all on table public.dm_messages from public, anon;
revoke all on table public.dm_message_likes from public, anon;
revoke all on table public.dm_presence from public, anon;

grant select on table public.dm_conversations to authenticated;
grant select on table public.dm_pairs to authenticated;
grant select, update on table public.dm_participants to authenticated;
grant select, insert, delete on table public.dm_messages to authenticated;
grant select, insert, delete on table public.dm_message_likes to authenticated;
grant select, insert, update on table public.dm_presence to authenticated;

drop policy if exists dm_conversations_select on public.dm_conversations;
drop policy if exists dm_pairs_select on public.dm_pairs;
drop policy if exists dm_participants_select on public.dm_participants;
drop policy if exists dm_participants_update on public.dm_participants;
drop policy if exists dm_messages_select on public.dm_messages;
drop policy if exists dm_messages_insert on public.dm_messages;
drop policy if exists dm_messages_delete on public.dm_messages;
drop policy if exists dm_likes_select on public.dm_message_likes;
drop policy if exists dm_likes_insert on public.dm_message_likes;
drop policy if exists dm_likes_delete on public.dm_message_likes;
drop policy if exists dm_presence_select on public.dm_presence;
drop policy if exists dm_presence_insert on public.dm_presence;
drop policy if exists dm_presence_update on public.dm_presence;

create policy dm_conversations_select
  on public.dm_conversations
  for select
  to authenticated
  using (public.dm_is_participant(id));

create policy dm_pairs_select
  on public.dm_pairs
  for select
  to authenticated
  using (user_a = auth.uid() or user_b = auth.uid());

create policy dm_participants_select
  on public.dm_participants
  for select
  to authenticated
  using (public.dm_is_participant(conversation_id));

create policy dm_participants_update
  on public.dm_participants
  for update
  to authenticated
  using (user_id = auth.uid() and public.dm_is_participant(conversation_id))
  with check (user_id = auth.uid() and public.dm_is_participant(conversation_id));

create policy dm_messages_select
  on public.dm_messages
  for select
  to authenticated
  using (public.dm_is_participant(conversation_id));

create policy dm_messages_insert
  on public.dm_messages
  for insert
  to authenticated
  with check (
    sender_id = auth.uid()
    and public.dm_is_participant(conversation_id)
  );

create policy dm_messages_delete
  on public.dm_messages
  for delete
  to authenticated
  using (sender_id = auth.uid() and public.dm_is_participant(conversation_id));

create policy dm_likes_select
  on public.dm_message_likes
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.dm_messages m
      where m.id = dm_message_likes.message_id
        and public.dm_is_participant(m.conversation_id)
    )
  );

create policy dm_likes_insert
  on public.dm_message_likes
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1
      from public.dm_messages m
      where m.id = message_id
        and public.dm_is_participant(m.conversation_id)
    )
  );

create policy dm_likes_delete
  on public.dm_message_likes
  for delete
  to authenticated
  using (user_id = auth.uid());

create policy dm_presence_select
  on public.dm_presence
  for select
  to authenticated
  using (public.is_active_staff());

create policy dm_presence_insert
  on public.dm_presence
  for insert
  to authenticated
  with check (user_id = auth.uid() and public.is_active_staff());

create policy dm_presence_update
  on public.dm_presence
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

alter table public.dm_conversations replica identity full;
alter table public.dm_participants replica identity full;
alter table public.dm_messages replica identity full;
alter table public.dm_message_likes replica identity full;
alter table public.dm_presence replica identity full;

do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    return;
  end if;
  foreach t in array array[
    'dm_conversations',
    'dm_participants',
    'dm_messages',
    'dm_message_likes',
    'dm_presence'
  ]
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

update public.role_app_access
set visible_apps = visible_apps || '["messages"]'::jsonb,
    updated_at = now()
where role in (
    'precious_metal_analyst',
    'branch_manager',
    'general_manager',
    'system_admin'
  )
  and not visible_apps @> '["messages"]'::jsonb;

notify pgrst, 'reload schema';
