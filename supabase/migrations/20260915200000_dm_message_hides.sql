-- Delete-for-me: hide a DM on your side only. The message stays for everyone else.

create table if not exists public.dm_message_hides (
  message_id uuid not null references public.dm_messages (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

create index if not exists dm_message_hides_user_id_idx
  on public.dm_message_hides (user_id);

create or replace function public.hide_dm_message(p_message_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  conv uuid;
begin
  if not public.is_active_staff() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  select m.conversation_id into conv
  from public.dm_messages m
  where m.id = p_message_id;
  if conv is null then
    raise exception 'That message is gone';
  end if;
  if not public.dm_is_participant(conv) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  insert into public.dm_message_hides (message_id, user_id)
  values (p_message_id, auth.uid())
  on conflict do nothing;
end;
$$;

revoke all on function public.hide_dm_message(uuid) from public, anon;
grant execute on function public.hide_dm_message(uuid) to authenticated;

create or replace function public.list_dm_inbox()
returns table (
  conversation_id uuid,
  is_group boolean,
  title text,
  team_id uuid,
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
    c.is_group or c.team_id is not null,
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
    (
      select count(*)::bigint
      from public.dm_messages m
      where m.conversation_id = c.id
        and m.sender_id <> auth.uid()
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
    select m.body, m.created_at, m.sender_id
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
          and not exists (
            select 1
            from public.dm_message_hides h
            where h.message_id = m.id
              and h.user_id = auth.uid()
          )
      ) as unread
      from public.dm_participants p
      where p.user_id = auth.uid()
        and public.is_active_staff()
    ) counts
  ), 0);
$$;

revoke all on function public.dm_unread_total() from public, anon;
grant execute on function public.dm_unread_total() to authenticated;

alter table public.dm_message_hides enable row level security;
alter table public.dm_message_hides force row level security;

revoke all on table public.dm_message_hides from public, anon;
grant select, insert, delete on table public.dm_message_hides to authenticated;

drop policy if exists dm_hides_select on public.dm_message_hides;
drop policy if exists dm_hides_insert on public.dm_message_hides;
drop policy if exists dm_hides_delete on public.dm_message_hides;

create policy dm_hides_select
  on public.dm_message_hides
  for select
  to authenticated
  using (user_id = auth.uid());

create policy dm_hides_insert
  on public.dm_message_hides
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

create policy dm_hides_delete
  on public.dm_message_hides
  for delete
  to authenticated
  using (user_id = auth.uid());

alter table public.dm_message_hides replica identity full;

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
      and tablename = 'dm_message_hides'
  ) then
    execute 'alter publication supabase_realtime add table public.dm_message_hides';
  end if;
end $$;

notify pgrst, 'reload schema';
