-- Teams directory, profile membership / intake contacts, and team DMs.
-- Also grants Marketing, Shared Services, and Teams app visibility.

update public.role_app_access
set
  visible_apps = visible_apps
    || '["teams"]'::jsonb
    || '["marketing"]'::jsonb
    || '["shared-services"]'::jsonb,
  updated_at = now()
where
  not coalesce(visible_apps, '[]'::jsonb) ? 'teams'
  or not coalesce(visible_apps, '[]'::jsonb) ? 'marketing'
  or not coalesce(visible_apps, '[]'::jsonb) ? 'shared-services';

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null
);

alter table public.teams
  drop constraint if exists teams_name_len;
alter table public.teams
  add constraint teams_name_len
  check (char_length(trim(name)) between 1 and 80);

alter table public.teams
  drop constraint if exists teams_description_len;
alter table public.teams
  add constraint teams_description_len
  check (char_length(description) <= 500);

create unique index if not exists teams_name_unique
  on public.teams (lower(trim(name)));

alter table public.profiles
  add column if not exists team_id uuid references public.teams (id) on delete set null;

alter table public.profiles
  add column if not exists is_team_intake boolean not null default false;

create index if not exists profiles_team_id_idx on public.profiles (team_id);

alter table public.dm_conversations
  add column if not exists team_id uuid references public.teams (id) on delete set null;

create unique index if not exists dm_conversations_team_id_uidx
  on public.dm_conversations (team_id)
  where team_id is not null;

create or replace function public.profiles_clear_intake_without_team()
returns trigger
language plpgsql
as $$
begin
  if new.team_id is null then
    new.is_team_intake := false;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_clear_intake_without_team on public.profiles;
create trigger profiles_clear_intake_without_team
  before insert or update of team_id, is_team_intake
  on public.profiles
  for each row
  execute function public.profiles_clear_intake_without_team();

create or replace function public.teams_sync_conversation_title()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.name is distinct from old.name then
    update public.dm_conversations
    set title = new.name, updated_at = now()
    where team_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists teams_sync_conversation_title on public.teams;
create trigger teams_sync_conversation_title
  after update of name
  on public.teams
  for each row
  execute function public.teams_sync_conversation_title();

alter table public.teams enable row level security;
alter table public.teams force row level security;

revoke all on public.teams from public, anon;
grant select, insert, update, delete on table public.teams to authenticated, service_role;

drop policy if exists teams_select on public.teams;
drop policy if exists teams_insert on public.teams;
drop policy if exists teams_update on public.teams;
drop policy if exists teams_delete on public.teams;

create policy teams_select
  on public.teams for select to authenticated
  using (public.is_active_staff());
create policy teams_insert
  on public.teams for insert to authenticated
  with check (public.is_active_staff());
create policy teams_update
  on public.teams for update to authenticated
  using (public.is_active_staff())
  with check (public.is_active_staff());
create policy teams_delete
  on public.teams for delete to authenticated
  using (public.is_active_staff());

create or replace function public.list_teams()
returns table (
  id uuid,
  name text,
  description text,
  created_at timestamptz,
  updated_at timestamptz,
  member_count bigint,
  intake_count bigint,
  members jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  select
    t.id,
    t.name,
    t.description,
    t.created_at,
    t.updated_at,
    (
      select count(*)::bigint
      from public.profiles p
      where p.team_id = t.id and p.is_active
    ),
    (
      select count(*)::bigint
      from public.profiles p
      where p.team_id = t.id and p.is_active and p.is_team_intake
    ),
    (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', p.id,
            'first_name', p.first_name,
            'last_name', p.last_name,
            'full_name', coalesce(
              nullif(trim(p.full_name), ''),
              nullif(trim(concat_ws(' ', p.first_name, p.last_name)), ''),
              'Teammate'
            ),
            'avatar_url', p.avatar_url,
            'location_name', p.location_name,
            'is_team_intake', p.is_team_intake,
            'last_seen_at', pr.last_seen_at,
            'is_online', coalesce(pr.is_online, false)
              and pr.last_seen_at > now() - interval '90 seconds'
          )
          order by
            p.is_team_intake desc,
            coalesce(nullif(trim(p.full_name), ''), p.first_name, '')
        ),
        '[]'::jsonb
      )
      from public.profiles p
      left join public.dm_presence pr on pr.user_id = p.id
      where p.team_id = t.id and p.is_active
    )
  from public.teams t
  where public.is_active_staff()
  order by lower(t.name);
$$;

revoke all on function public.list_teams() from public, anon;
grant execute on function public.list_teams() to authenticated;

create or replace function public.set_own_team(p_team_id uuid, p_is_intake boolean default false)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  conv_id uuid;
begin
  if not public.is_active_staff() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  if p_team_id is not null and not exists (
    select 1 from public.teams t where t.id = p_team_id
  ) then
    raise exception 'That team is not available';
  end if;

  update public.profiles
  set
    team_id = p_team_id,
    is_team_intake = case when p_team_id is null then false else coalesce(p_is_intake, false) end,
    updated_at = now()
  where id = me;

  if p_team_id is null then
    return;
  end if;

  select c.id into conv_id
  from public.dm_conversations c
  where c.team_id = p_team_id;

  if conv_id is not null then
    insert into public.dm_participants (conversation_id, user_id)
    values (conv_id, me)
    on conflict do nothing;
  end if;
end;
$$;

revoke all on function public.set_own_team(uuid, boolean) from public, anon;
grant execute on function public.set_own_team(uuid, boolean) to authenticated;

create or replace function public.get_or_create_team_dm(p_team_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  conv_id uuid;
  label text;
begin
  if not public.is_active_staff() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  if p_team_id is null then
    raise exception 'Pick a team to message';
  end if;

  select t.name into label
  from public.teams t
  where t.id = p_team_id;

  if label is null then
    raise exception 'That team is not available';
  end if;

  select c.id into conv_id
  from public.dm_conversations c
  where c.team_id = p_team_id;

  if conv_id is null then
    insert into public.dm_conversations (is_group, title, created_by, team_id)
    values (true, label, me, p_team_id)
    returning id into conv_id;
  else
    update public.dm_conversations
    set title = label, is_group = true, updated_at = now()
    where id = conv_id;
  end if;

  insert into public.dm_participants (conversation_id, user_id)
  select conv_id, uid
  from (
    select p.id as uid
    from public.profiles p
    where p.team_id = p_team_id and p.is_active
    union
    select me
  ) people
  on conflict do nothing;

  return conv_id;
exception
  when unique_violation then
    select c.id into conv_id
    from public.dm_conversations c
    where c.team_id = p_team_id;
    if conv_id is null then
      raise;
    end if;
    insert into public.dm_participants (conversation_id, user_id)
    select conv_id, uid
    from (
      select p.id as uid
      from public.profiles p
      where p.team_id = p_team_id and p.is_active
      union
      select me
    ) people
    on conflict do nothing;
    return conv_id;
end;
$$;

revoke all on function public.get_or_create_team_dm(uuid) from public, anon;
grant execute on function public.get_or_create_team_dm(uuid) to authenticated;

drop function if exists public.list_dm_contacts();

create or replace function public.list_dm_contacts()
returns table (
  id uuid,
  first_name text,
  last_name text,
  full_name text,
  avatar_url text,
  location_name text,
  team_id uuid,
  team_name text,
  is_team_intake boolean,
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
    p.team_id,
    t.name,
    coalesce(p.is_team_intake, false),
    pr.last_seen_at,
    coalesce(pr.is_online, false)
      and pr.last_seen_at > now() - interval '90 seconds'
  from public.profiles p
  left join public.teams t on t.id = p.team_id
  left join public.dm_presence pr on pr.user_id = p.id
  where public.is_active_staff()
    and p.is_active
    and p.id <> auth.uid()
  order by 4 asc;
$$;

revoke all on function public.list_dm_contacts() from public, anon;
grant execute on function public.list_dm_contacts() to authenticated;

drop function if exists public.list_dm_inbox();

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
  left join public.teams t on t.id = c.team_id
  where public.is_active_staff()
    and me.user_id = auth.uid()
  order by c.last_message_at desc nulls last, c.created_at desc;
$$;

revoke all on function public.list_dm_inbox() from public, anon;
grant execute on function public.list_dm_inbox() to authenticated;

alter table public.teams replica identity full;

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
      and tablename = 'teams'
  ) then
    execute 'alter publication supabase_realtime add table public.teams';
  end if;
end $$;

notify pgrst, 'reload schema';
