-- Branch-manager triage visibility: store-scoped reviews, BM notifications
-- when an item is marked incorrect, and tighter write/read on workshop tables.
-- Do not apply this to the live project from this PR; previews share that database.

create or replace function public.clean_store_name(name text)
returns text
language sql
immutable
as $$
  select nullif(
    trim(both from regexp_replace(
      regexp_replace(trim(both from coalesce(name, '')), '^canada\s*gold\s*', '', 'i'),
      '^cg\s+',
      '',
      'i'
    )),
    ''
  );
$$;

create or replace function public.stores_match(left_name text, right_name text)
returns boolean
language sql
immutable
as $$
  select
    public.clean_store_name(left_name) is not null
    and public.clean_store_name(right_name) is not null
    and (
      lower(public.clean_store_name(left_name)) = lower(public.clean_store_name(right_name))
      or lower(public.clean_store_name(left_name))
        like '%' || lower(public.clean_store_name(right_name)) || '%'
      or lower(public.clean_store_name(right_name))
        like '%' || lower(public.clean_store_name(left_name)) || '%'
    );
$$;

create or replace function public.triage_review_header_value(payload jsonb, header_key text)
returns text
language sql
immutable
as $$
  select nullif(trim(both from coalesce(
    (
      select coalesce(e->>'value', e->>'original', '')
      from jsonb_array_elements(
        case
          when jsonb_typeof(payload -> 'review' -> 'draft' -> 'header') = 'array'
            then payload -> 'review' -> 'draft' -> 'header'
          else '[]'::jsonb
        end
      ) e
      where e->>'key' = header_key
      limit 1
    ),
    ''
  )), '');
$$;

create or replace function public.triage_review_is_incorrect(payload jsonb)
returns boolean
language sql
immutable
as $$
  select
    (
      jsonb_typeof(payload -> 'review' -> 'corrections') = 'array'
      and jsonb_array_length(payload -> 'review' -> 'corrections') > 0
    )
    or length(trim(both from coalesce(payload -> 'review' ->> 'note', ''))) > 0
    or length(trim(both from coalesce(payload -> 'review' ->> 'errorType', ''))) > 0
    or length(trim(both from coalesce(payload -> 'review' ->> 'errorAmount', ''))) > 0
    or (
      jsonb_typeof(payload -> 'review' -> 'lineEdits') = 'array'
      and jsonb_array_length(payload -> 'review' -> 'lineEdits') > 0
    );
$$;

create or replace function public.triage_review_store_name(payload jsonb)
returns text
language sql
immutable
as $$
  select public.clean_store_name(coalesce(
    public.triage_review_header_value(payload, 'store'),
    payload -> 'review' ->> 'storeName',
    payload ->> 'storeName',
    ''
  ));
$$;

create or replace function public.current_user_can_see_all_triage()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select (select public.is_active_staff())
    and coalesce(
      (
        select p.app_role in ('triage', 'general_manager', 'system_admin')
          or p.is_system_admin
        from public.profiles p
        where p.id = (select auth.uid())
      ),
      false
    );
$$;

create or replace function public.current_user_can_see_store_triage(store_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select (select public.current_user_can_see_all_triage())
    or (
      (select public.is_active_staff())
      and coalesce(
        (
          select p.app_role = 'branch_manager'
            and public.stores_match(p.location_name, store_name)
          from public.profiles p
          where p.id = (select auth.uid())
        ),
        false
      )
    );
$$;

revoke all on function public.clean_store_name(text) from public, anon;
revoke all on function public.stores_match(text, text) from public, anon;
revoke all on function public.triage_review_header_value(jsonb, text) from public, anon;
revoke all on function public.triage_review_is_incorrect(jsonb) from public, anon;
revoke all on function public.triage_review_store_name(jsonb) from public, anon;
revoke all on function public.current_user_can_see_all_triage() from public, anon;
revoke all on function public.current_user_can_see_store_triage(text) from public, anon;

grant execute on function public.clean_store_name(text) to authenticated;
grant execute on function public.stores_match(text, text) to authenticated;
grant execute on function public.triage_review_header_value(jsonb, text) to authenticated;
grant execute on function public.triage_review_is_incorrect(jsonb) to authenticated;
grant execute on function public.triage_review_store_name(jsonb) to authenticated;
grant execute on function public.current_user_can_see_all_triage() to authenticated;
grant execute on function public.current_user_can_see_store_triage(text) to authenticated;

alter table public.triage_reviews
  add column if not exists store_name text,
  add column if not exists store_key text,
  add column if not exists is_incorrect boolean not null default false;

create index if not exists triage_reviews_store_key_idx
  on public.triage_reviews (store_key);

create index if not exists triage_reviews_incorrect_store_idx
  on public.triage_reviews (is_incorrect, store_key);

create or replace function public.triage_reviews_fill_store()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.store_name := public.triage_review_store_name(new.payload);
  new.store_key := lower(coalesce(new.store_name, ''));
  if new.store_key = '' then
    new.store_key := null;
  end if;
  new.is_incorrect := public.triage_review_is_incorrect(new.payload);
  return new;
end;
$$;

drop trigger if exists triage_reviews_fill_store on public.triage_reviews;
create trigger triage_reviews_fill_store
  before insert or update of payload on public.triage_reviews
  for each row
  execute function public.triage_reviews_fill_store();

update public.triage_reviews
set
  store_name = public.triage_review_store_name(payload),
  store_key = nullif(lower(coalesce(public.triage_review_store_name(payload), '')), ''),
  is_incorrect = public.triage_review_is_incorrect(payload)
where store_name is null
   or store_key is null
   or is_incorrect is distinct from public.triage_review_is_incorrect(payload);

create table if not exists public.staff_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  store_name text not null,
  store_key text not null,
  kind text not null default 'triage_incorrect',
  title text not null,
  body text not null default '',
  payload jsonb not null default '{}'::jsonb,
  source_id text,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  check (kind in ('triage_incorrect')),
  check (char_length(trim(store_name)) between 1 and 120),
  check (char_length(trim(title)) between 1 and 200),
  check (char_length(body) <= 1000),
  unique (recipient_id, kind, source_id)
);

create index if not exists staff_notifications_recipient_unread_idx
  on public.staff_notifications (recipient_id, created_at desc)
  where read_at is null;

alter table public.staff_notifications enable row level security;
alter table public.staff_notifications force row level security;

revoke all on public.staff_notifications from public, anon;
grant select, update, delete on table public.staff_notifications to authenticated;
grant all on table public.staff_notifications to service_role;

create or replace function public.staff_notifications_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    if not (select public.is_active_staff()) or old.recipient_id <> (select auth.uid()) then
      raise exception 'Not allowed' using errcode = '42501';
    end if;
    new.id := old.id;
    new.recipient_id := old.recipient_id;
    new.store_name := old.store_name;
    new.store_key := old.store_key;
    new.kind := old.kind;
    new.title := old.title;
    new.body := old.body;
    new.payload := old.payload;
    new.source_id := old.source_id;
    new.created_at := old.created_at;
    new.created_by := old.created_by;
    if new.read_at is not null and old.read_at is not null then
      new.read_at := old.read_at;
    end if;
    return new;
  end if;
  return new;
end;
$$;

drop trigger if exists staff_notifications_guard on public.staff_notifications;
create trigger staff_notifications_guard
  before update on public.staff_notifications
  for each row
  execute function public.staff_notifications_guard();

drop policy if exists staff_notifications_select_own on public.staff_notifications;
drop policy if exists staff_notifications_update_own on public.staff_notifications;
drop policy if exists staff_notifications_delete_own on public.staff_notifications;

create policy staff_notifications_select_own
  on public.staff_notifications
  for select
  to authenticated
  using (
    recipient_id = (select auth.uid())
    and (select public.is_active_staff())
  );

create policy staff_notifications_update_own
  on public.staff_notifications
  for update
  to authenticated
  using (
    recipient_id = (select auth.uid())
    and (select public.is_active_staff())
  )
  with check (
    recipient_id = (select auth.uid())
    and (select public.is_active_staff())
  );

create policy staff_notifications_delete_own
  on public.staff_notifications
  for delete
  to authenticated
  using (
    recipient_id = (select auth.uid())
    and (select public.is_active_staff())
  );

alter table public.staff_notifications replica identity full;

create or replace function public.notify_store_triage_incorrect()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  became_incorrect boolean;
  employee_name text;
  error_type text;
  reference text;
  doc_kind text;
begin
  became_incorrect := new.is_incorrect and (tg_op = 'INSERT' or not old.is_incorrect);
  if not became_incorrect then
    return new;
  end if;
  if new.store_name is null or new.store_key is null then
    return new;
  end if;

  employee_name := coalesce(
    public.triage_review_header_value(new.payload, 'employee'),
    new.payload -> 'review' ->> 'employeeName',
    ''
  );
  error_type := nullif(trim(both from coalesce(new.payload -> 'review' ->> 'errorType', '')), '');
  reference := coalesce(
    public.triage_review_header_value(new.payload, 'reference'),
    new.payload -> 'review' ->> 'reference',
    new.id
  );
  doc_kind := lower(coalesce(new.payload -> 'review' ->> 'docKind', ''));
  if doc_kind not in ('purchase', 'sale') then
    if reference ~* '^(so|s\.?o\.?)\b' then
      doc_kind := 'sale';
    else
      doc_kind := 'purchase';
    end if;
  end if;

  insert into public.staff_notifications (
    recipient_id,
    store_name,
    store_key,
    kind,
    title,
    body,
    payload,
    source_id,
    created_by
  )
  select
    p.id,
    new.store_name,
    new.store_key,
    'triage_incorrect',
    'Incorrect ' || doc_kind || ' · ' || new.store_name,
    trim(both from concat_ws(
      ' · ',
      nullif(reference, ''),
      nullif(employee_name, ''),
      coalesce(error_type, 'Unspecified')
    )),
    jsonb_build_object(
      'reviewId', new.id,
      'storeName', new.store_name,
      'employeeName', employee_name,
      'errorType', coalesce(error_type, 'Unspecified'),
      'docKind', doc_kind,
      'reference', reference
    ),
    new.id,
    new.updated_by
  from public.profiles p
  where p.is_active
    and (
      p.app_role = 'branch_manager'
      or coalesce(p.allowed_app_roles, '[]'::jsonb) ? 'branch_manager'
    )
    and public.stores_match(p.location_name, new.store_name)
  on conflict (recipient_id, kind, source_id)
  do update set
    title = excluded.title,
    body = excluded.body,
    payload = excluded.payload,
    store_name = excluded.store_name,
    store_key = excluded.store_key,
    read_at = null,
    created_at = now();

  return new;
end;
$$;

drop trigger if exists triage_reviews_notify_incorrect on public.triage_reviews;
create trigger triage_reviews_notify_incorrect
  after insert or update of payload on public.triage_reviews
  for each row
  execute function public.notify_store_triage_incorrect();

drop policy if exists triage_reviews_select on public.triage_reviews;
drop policy if exists triage_reviews_insert on public.triage_reviews;
drop policy if exists triage_reviews_update on public.triage_reviews;
drop policy if exists triage_reviews_delete on public.triage_reviews;

create policy triage_reviews_select
  on public.triage_reviews
  for select
  to authenticated
  using ((select public.current_user_can_see_store_triage(store_name)));

create policy triage_reviews_insert
  on public.triage_reviews
  for insert
  to authenticated
  with check ((select public.current_user_can_see_all_triage()));

create policy triage_reviews_update
  on public.triage_reviews
  for update
  to authenticated
  using ((select public.current_user_can_see_all_triage()))
  with check ((select public.current_user_can_see_all_triage()));

create policy triage_reviews_delete
  on public.triage_reviews
  for delete
  to authenticated
  using ((select public.current_user_can_see_all_triage()));

-- Workshop tables stay company-wide for triage/GM/admin. Branch managers
-- must not read other stores through batches or planned transfers.
do $$
declare
  t text;
begin
  foreach t in array array[
    'triage_batches',
    'triage_planned',
    'triage_meta',
    'triage_deleted',
    'triage_allocations',
    'triage_daily_receipts'
  ]
  loop
    if to_regclass('public.' || t) is null then
      continue;
    end if;
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using ((select public.current_user_can_see_all_triage()))',
      t || '_select',
      t
    );
    execute format(
      'create policy %I on public.%I for insert to authenticated with check ((select public.current_user_can_see_all_triage()))',
      t || '_insert',
      t
    );
    execute format(
      'create policy %I on public.%I for update to authenticated using ((select public.current_user_can_see_all_triage())) with check ((select public.current_user_can_see_all_triage()))',
      t || '_update',
      t
    );
    execute format(
      'create policy %I on public.%I for delete to authenticated using ((select public.current_user_can_see_all_triage()))',
      t || '_delete',
      t
    );
  end loop;
end $$;

update public.role_app_access
set visible_apps = (
  select coalesce(jsonb_agg(value), '[]'::jsonb)
  from (
    select distinct value
    from jsonb_array_elements_text(coalesce(visible_apps, '[]'::jsonb) || '["triage"]'::jsonb) as t(value)
  ) keys
)
where role = 'branch_manager'
  and not coalesce(visible_apps, '[]'::jsonb) ? 'triage';

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
      and tablename = 'staff_notifications'
  ) then
    execute 'alter publication supabase_realtime add table public.staff_notifications';
  end if;
end $$;

notify pgrst, 'reload schema';
