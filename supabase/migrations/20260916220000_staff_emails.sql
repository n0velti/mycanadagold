-- Staff Emails: per-user inbox and sent mail between people on myCanadaGold.
-- Recipients always resolve to a profile so the reading pane can open that user.

create table if not exists public.staff_emails (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles (id) on delete cascade,
  subject text not null default '',
  body text not null,
  created_at timestamptz not null default now(),
  check (char_length(trim(body)) > 0 and char_length(body) <= 20000),
  check (char_length(subject) <= 240)
);

create index if not exists staff_emails_sender_created_idx
  on public.staff_emails (sender_id, created_at desc);

create table if not exists public.staff_email_recipients (
  email_id uuid not null references public.staff_emails (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  read_at timestamptz,
  primary key (email_id, user_id)
);

create index if not exists staff_email_recipients_user_idx
  on public.staff_email_recipients (user_id, email_id);

create or replace function public.staff_email_visible(p_email_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_active_staff()
    and exists (
      select 1
      from public.staff_emails e
      where e.id = p_email_id
        and (
          e.sender_id = auth.uid()
          or exists (
            select 1
            from public.staff_email_recipients r
            where r.email_id = e.id
              and r.user_id = auth.uid()
          )
        )
    );
$$;

revoke all on function public.staff_email_visible(uuid) from public, anon;
grant execute on function public.staff_email_visible(uuid) to authenticated;

create or replace function public.list_email_contacts()
returns table (
  id uuid,
  first_name text,
  last_name text,
  full_name text,
  avatar_url text,
  location_name text,
  email text,
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
    p.email,
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

revoke all on function public.list_email_contacts() from public, anon;
grant execute on function public.list_email_contacts() to authenticated;

create or replace function public.email_person_json(p public.profiles)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
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
    'email', p.email
  );
$$;

revoke all on function public.email_person_json(public.profiles) from public, anon, authenticated;

create or replace function public.list_email_inbox()
returns table (
  id uuid,
  subject text,
  preview text,
  created_at timestamptz,
  read_at timestamptz,
  sender jsonb,
  recipients jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  select
    e.id,
    e.subject,
    left(e.body, 240),
    e.created_at,
    r.read_at,
    public.email_person_json(s),
    (
      select coalesce(jsonb_agg(public.email_person_json(p) order by p.full_name), '[]'::jsonb)
      from public.staff_email_recipients rr
      join public.profiles p on p.id = rr.user_id
      where rr.email_id = e.id
    )
  from public.staff_email_recipients r
  join public.staff_emails e on e.id = r.email_id
  join public.profiles s on s.id = e.sender_id
  where public.is_active_staff()
    and r.user_id = auth.uid()
  order by e.created_at desc;
$$;

revoke all on function public.list_email_inbox() from public, anon;
grant execute on function public.list_email_inbox() to authenticated;

create or replace function public.list_email_sent()
returns table (
  id uuid,
  subject text,
  preview text,
  created_at timestamptz,
  read_at timestamptz,
  sender jsonb,
  recipients jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  select
    e.id,
    e.subject,
    left(e.body, 240),
    e.created_at,
    null::timestamptz,
    public.email_person_json(s),
    (
      select coalesce(jsonb_agg(public.email_person_json(p) order by p.full_name), '[]'::jsonb)
      from public.staff_email_recipients rr
      join public.profiles p on p.id = rr.user_id
      where rr.email_id = e.id
    )
  from public.staff_emails e
  join public.profiles s on s.id = e.sender_id
  where public.is_active_staff()
    and e.sender_id = auth.uid()
  order by e.created_at desc;
$$;

revoke all on function public.list_email_sent() from public, anon;
grant execute on function public.list_email_sent() to authenticated;

create or replace function public.get_staff_email(p_email_id uuid)
returns table (
  id uuid,
  subject text,
  body text,
  created_at timestamptz,
  read_at timestamptz,
  sender jsonb,
  recipients jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  select
    e.id,
    e.subject,
    e.body,
    e.created_at,
    (
      select r.read_at
      from public.staff_email_recipients r
      where r.email_id = e.id
        and r.user_id = auth.uid()
    ),
    public.email_person_json(s),
    (
      select coalesce(jsonb_agg(public.email_person_json(p) order by p.full_name), '[]'::jsonb)
      from public.staff_email_recipients rr
      join public.profiles p on p.id = rr.user_id
      where rr.email_id = e.id
    )
  from public.staff_emails e
  join public.profiles s on s.id = e.sender_id
  where public.staff_email_visible(p_email_id)
    and e.id = p_email_id;
$$;

revoke all on function public.get_staff_email(uuid) from public, anon;
grant execute on function public.get_staff_email(uuid) to authenticated;

create or replace function public.send_staff_email(
  p_recipient_ids uuid[],
  p_subject text,
  p_body text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  email_id uuid;
  ids uuid[];
begin
  if not public.is_active_staff() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  ids := (
    select coalesce(array_agg(distinct x), '{}'::uuid[])
    from unnest(coalesce(p_recipient_ids, '{}'::uuid[])) as x
    where x is not null
  );

  if ids is null or array_length(ids, 1) is null then
    raise exception 'Pick someone to email';
  end if;

  if exists (
    select 1
    from unnest(ids) as x
    where not exists (
      select 1
      from public.profiles p
      where p.id = x
        and p.is_active
    )
  ) then
    raise exception 'That person is not available';
  end if;

  insert into public.staff_emails (sender_id, subject, body)
  values (
    me,
    left(trim(coalesce(p_subject, '')), 240),
    trim(p_body)
  )
  returning id into email_id;

  insert into public.staff_email_recipients (email_id, user_id)
  select email_id, x
  from unnest(ids) as x;

  return email_id;
end;
$$;

revoke all on function public.send_staff_email(uuid[], text, text) from public, anon;
grant execute on function public.send_staff_email(uuid[], text, text) to authenticated;

create or replace function public.mark_staff_email_read(p_email_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.staff_email_visible(p_email_id) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  update public.staff_email_recipients
  set read_at = coalesce(read_at, now())
  where email_id = p_email_id
    and user_id = auth.uid()
    and read_at is null;
end;
$$;

revoke all on function public.mark_staff_email_read(uuid) from public, anon;
grant execute on function public.mark_staff_email_read(uuid) to authenticated;

create or replace function public.email_unread_total()
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select count(*)::bigint
    from public.staff_email_recipients r
    where r.user_id = auth.uid()
      and r.read_at is null
      and public.is_active_staff()
  ), 0);
$$;

revoke all on function public.email_unread_total() from public, anon;
grant execute on function public.email_unread_total() to authenticated;

alter table public.staff_emails enable row level security;
alter table public.staff_emails force row level security;
alter table public.staff_email_recipients enable row level security;
alter table public.staff_email_recipients force row level security;

revoke all on table public.staff_emails from public, anon;
revoke all on table public.staff_email_recipients from public, anon;

grant select on table public.staff_emails to authenticated;
grant select, update on table public.staff_email_recipients to authenticated;

drop policy if exists staff_emails_select on public.staff_emails;
drop policy if exists staff_email_recipients_select on public.staff_email_recipients;
drop policy if exists staff_email_recipients_update on public.staff_email_recipients;

create policy staff_emails_select
  on public.staff_emails
  for select
  to authenticated
  using (public.staff_email_visible(id));

create policy staff_email_recipients_select
  on public.staff_email_recipients
  for select
  to authenticated
  using (public.staff_email_visible(email_id));

create policy staff_email_recipients_update
  on public.staff_email_recipients
  for update
  to authenticated
  using (user_id = auth.uid() and public.staff_email_visible(email_id))
  with check (user_id = auth.uid() and public.staff_email_visible(email_id));

alter table public.staff_emails replica identity full;
alter table public.staff_email_recipients replica identity full;

do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    return;
  end if;
  foreach t in array array['staff_emails', 'staff_email_recipients']
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
set visible_apps = visible_apps || '["emails"]'::jsonb,
    updated_at = now()
where role in (
    'precious_metal_analyst',
    'branch_manager',
    'general_manager',
    'system_admin'
  )
  and not visible_apps @> '["emails"]'::jsonb;

notify pgrst, 'reload schema';
