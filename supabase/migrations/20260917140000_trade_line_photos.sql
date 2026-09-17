-- Photos attached to buy-ticket line items. Staff create a short-lived
-- capture session; a phone scanning the QR uploads through trade-capture.

create table if not exists public.trade_capture_sessions (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,
  line_id text not null,
  item_name text not null default '',
  created_by uuid not null references auth.users (id) on delete cascade,
  photo_url text,
  expires_at timestamptz not null default (now() + interval '20 minutes'),
  created_at timestamptz not null default now(),
  captured_at timestamptz
);

create index if not exists trade_capture_sessions_token_idx
  on public.trade_capture_sessions (token);

create index if not exists trade_capture_sessions_created_by_idx
  on public.trade_capture_sessions (created_by, created_at desc);

alter table public.trade_capture_sessions enable row level security;
alter table public.trade_capture_sessions replica identity full;

revoke all on table public.trade_capture_sessions from public, anon;
grant select, insert on table public.trade_capture_sessions to authenticated;

drop policy if exists trade_capture_sessions_select_own on public.trade_capture_sessions;
drop policy if exists trade_capture_sessions_insert_own on public.trade_capture_sessions;

create policy trade_capture_sessions_select_own
  on public.trade_capture_sessions
  for select
  to authenticated
  using (public.is_active_staff() and created_by = auth.uid());

create policy trade_capture_sessions_insert_own
  on public.trade_capture_sessions
  for insert
  to authenticated
  with check (public.is_active_staff() and created_by = auth.uid());

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
      and tablename = 'trade_capture_sessions'
  ) then
    execute 'alter publication supabase_realtime add table public.trade_capture_sessions';
  end if;
end $$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'trade-line-photos',
  'trade-line-photos',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists trade_line_photos_public_read on storage.objects;
drop policy if exists trade_line_photos_own_insert on storage.objects;
drop policy if exists trade_line_photos_own_update on storage.objects;
drop policy if exists trade_line_photos_own_delete on storage.objects;

create policy trade_line_photos_public_read
  on storage.objects
  for select
  using (bucket_id = 'trade-line-photos');

create policy trade_line_photos_own_insert
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'trade-line-photos'
    and split_part(name, '/', 1) = auth.uid()::text
    and public.is_active_staff()
  );

create policy trade_line_photos_own_update
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'trade-line-photos'
    and split_part(name, '/', 1) = auth.uid()::text
    and public.is_active_staff()
  )
  with check (
    bucket_id = 'trade-line-photos'
    and split_part(name, '/', 1) = auth.uid()::text
    and public.is_active_staff()
  );

create policy trade_line_photos_own_delete
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'trade-line-photos'
    and split_part(name, '/', 1) = auth.uid()::text
    and public.is_active_staff()
  );

notify pgrst, 'reload schema';
