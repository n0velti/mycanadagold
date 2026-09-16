-- Notes left on a staff profile. The profile owner sees every note on their
-- page. Anyone else only sees notes they personally added.

create table if not exists public.profile_notes (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  author_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  author_name text not null default 'Teammate',
  body text not null,
  due_on date,
  category text not null default 'general',
  importance text not null default 'medium',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (char_length(trim(body)) > 0 and char_length(body) <= 2000),
  check (category in ('general', 'follow_up', 'task', 'hr', 'performance', 'personal')),
  check (importance in ('low', 'medium', 'high', 'urgent'))
);

create index if not exists profile_notes_profile_created_idx
  on public.profile_notes (profile_id, created_at desc);

create index if not exists profile_notes_author_id_idx
  on public.profile_notes (author_id);

create or replace function public.profile_notes_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  author_full text;
begin
  if tg_op = 'INSERT' then
    new.author_id := auth.uid();
  else
    new.author_id := old.author_id;
    new.profile_id := old.profile_id;
    new.created_at := old.created_at;
  end if;

  new.body := trim(new.body);
  if new.body is null or char_length(new.body) = 0 then
    raise exception 'Type a note first';
  end if;

  new.category := coalesce(nullif(lower(trim(new.category)), ''), 'general');
  new.importance := coalesce(nullif(lower(trim(new.importance)), ''), 'medium');
  new.updated_at := now();

  select
    coalesce(
      nullif(trim(p.full_name), ''),
      nullif(trim(concat_ws(' ', p.first_name, p.last_name)), ''),
      'Teammate'
    )
  into author_full
  from public.profiles p
  where p.id = new.author_id;

  new.author_name := coalesce(author_full, 'Teammate');
  return new;
end;
$$;

drop trigger if exists profile_notes_before_write on public.profile_notes;
create trigger profile_notes_before_write
  before insert or update on public.profile_notes
  for each row
  execute function public.profile_notes_before_write();

revoke all on function public.profile_notes_before_write() from public, anon, authenticated;

alter table public.profile_notes enable row level security;
alter table public.profile_notes force row level security;

revoke all on table public.profile_notes from public, anon;
grant select, insert, update, delete on table public.profile_notes to authenticated;

drop policy if exists profile_notes_select on public.profile_notes;
drop policy if exists profile_notes_insert on public.profile_notes;
drop policy if exists profile_notes_update on public.profile_notes;
drop policy if exists profile_notes_delete on public.profile_notes;

create policy profile_notes_select
  on public.profile_notes
  for select
  to authenticated
  using (
    public.is_active_staff()
    and (profile_id = auth.uid() or author_id = auth.uid())
  );

create policy profile_notes_insert
  on public.profile_notes
  for insert
  to authenticated
  with check (
    public.is_active_staff()
    and (author_id = auth.uid() or author_id is null)
  );

create policy profile_notes_update
  on public.profile_notes
  for update
  to authenticated
  using (author_id = auth.uid())
  with check (author_id = auth.uid());

create policy profile_notes_delete
  on public.profile_notes
  for delete
  to authenticated
  using (author_id = auth.uid() or profile_id = auth.uid());

-- Direct inserts hit the profiles foreign key under RLS, so teammates who
-- cannot read another profiles row cannot leave a note. This write path
-- checks active staff and inserts as definer.
create or replace function public.add_profile_note(
  p_profile_id uuid,
  p_body text,
  p_due_on date default null,
  p_category text default 'general',
  p_importance text default 'medium'
)
returns public.profile_notes
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted public.profile_notes;
begin
  if not public.is_active_staff() then
    raise exception 'Not allowed';
  end if;
  if p_profile_id is null then
    raise exception 'Choose a profile first';
  end if;
  if not exists (
    select 1
    from public.profiles p
    where p.id = p_profile_id
      and p.is_active
  ) then
    raise exception 'That profile is not available';
  end if;

  insert into public.profile_notes (profile_id, body, due_on, category, importance)
  values (p_profile_id, trim(p_body), p_due_on, p_category, p_importance)
  returning * into inserted;

  return inserted;
end;
$$;

revoke all on function public.add_profile_note(uuid, text, date, text, text) from public, anon;
grant execute on function public.add_profile_note(uuid, text, date, text, text) to authenticated;

notify pgrst, 'reload schema';
