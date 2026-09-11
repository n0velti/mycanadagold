-- Profile portraits as a staff photo: likes, comments, and realtime so
-- teammates can react the same way they would on a shared post.

create table if not exists public.profile_photo_likes (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (profile_id, user_id)
);

create index if not exists profile_photo_likes_user_id_idx
  on public.profile_photo_likes (user_id);

create table if not exists public.profile_photo_comments (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  body text not null,
  author_name text not null default 'Teammate',
  author_avatar_url text not null default '',
  created_at timestamptz not null default now(),
  check (char_length(trim(body)) > 0 and char_length(body) <= 2000)
);

create index if not exists profile_photo_comments_profile_created_idx
  on public.profile_photo_comments (profile_id, created_at);

create or replace function public.profile_photo_comments_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  author_full text;
  author_avatar text;
begin
  new.user_id := auth.uid();
  new.body := trim(new.body);
  if new.body is null or char_length(new.body) = 0 then
    raise exception 'Type a comment first';
  end if;

  select
    coalesce(
      nullif(trim(p.full_name), ''),
      nullif(trim(concat_ws(' ', p.first_name, p.last_name)), ''),
      'Teammate'
    ),
    coalesce(p.avatar_url, '')
  into author_full, author_avatar
  from public.profiles p
  where p.id = new.user_id;

  new.author_name := coalesce(author_full, 'Teammate');
  new.author_avatar_url := coalesce(author_avatar, '');
  return new;
end;
$$;

drop trigger if exists profile_photo_comments_before_insert on public.profile_photo_comments;
create trigger profile_photo_comments_before_insert
  before insert on public.profile_photo_comments
  for each row
  execute function public.profile_photo_comments_before_insert();

revoke all on function public.profile_photo_comments_before_insert() from public, anon, authenticated;

-- Public card for one teammate's portrait (name + photo). Everyone can see
-- this even when they cannot read the full profiles row.
create or replace function public.get_profile_photo(p_profile_id uuid)
returns table (
  id uuid,
  full_name text,
  first_name text,
  last_name text,
  avatar_url text,
  location_name text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id,
    coalesce(
      nullif(trim(p.full_name), ''),
      nullif(trim(concat_ws(' ', p.first_name, p.last_name)), ''),
      'Teammate'
    ),
    p.first_name,
    p.last_name,
    coalesce(p.avatar_url, ''),
    coalesce(p.location_name, '')
  from public.profiles p
  where public.is_active_staff()
    and p.is_active
    and p.id = p_profile_id;
$$;

revoke all on function public.get_profile_photo(uuid) from public, anon;
grant execute on function public.get_profile_photo(uuid) to authenticated;

alter table public.profile_photo_likes enable row level security;
alter table public.profile_photo_likes force row level security;
alter table public.profile_photo_comments enable row level security;
alter table public.profile_photo_comments force row level security;

revoke all on table public.profile_photo_likes from public, anon;
revoke all on table public.profile_photo_comments from public, anon;

grant select, insert, delete on table public.profile_photo_likes to authenticated;
grant select, insert, delete on table public.profile_photo_comments to authenticated;

drop policy if exists profile_photo_likes_select on public.profile_photo_likes;
drop policy if exists profile_photo_likes_insert on public.profile_photo_likes;
drop policy if exists profile_photo_likes_delete on public.profile_photo_likes;
drop policy if exists profile_photo_comments_select on public.profile_photo_comments;
drop policy if exists profile_photo_comments_insert on public.profile_photo_comments;
drop policy if exists profile_photo_comments_delete on public.profile_photo_comments;

create policy profile_photo_likes_select
  on public.profile_photo_likes
  for select
  to authenticated
  using (public.is_active_staff());

create policy profile_photo_likes_insert
  on public.profile_photo_likes
  for insert
  to authenticated
  with check (user_id = auth.uid() and public.is_active_staff());

create policy profile_photo_likes_delete
  on public.profile_photo_likes
  for delete
  to authenticated
  using (user_id = auth.uid());

create policy profile_photo_comments_select
  on public.profile_photo_comments
  for select
  to authenticated
  using (public.is_active_staff());

create policy profile_photo_comments_insert
  on public.profile_photo_comments
  for insert
  to authenticated
  with check (
    (user_id = auth.uid() or user_id is null)
    and public.is_active_staff()
  );

create policy profile_photo_comments_delete
  on public.profile_photo_comments
  for delete
  to authenticated
  using (user_id = auth.uid() or profile_id = auth.uid());

alter table public.profile_photo_likes replica identity full;
alter table public.profile_photo_comments replica identity full;

do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    return;
  end if;
  foreach t in array array['profile_photo_likes', 'profile_photo_comments']
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
