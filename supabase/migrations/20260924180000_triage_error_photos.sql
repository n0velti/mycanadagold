-- Photos attached to a triage PO error. The review payload stores the public URL.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'triage-error-photos',
  'triage-error-photos',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists triage_error_photos_public_read on storage.objects;
drop policy if exists triage_error_photos_own_insert on storage.objects;
drop policy if exists triage_error_photos_own_update on storage.objects;
drop policy if exists triage_error_photos_own_delete on storage.objects;

create policy triage_error_photos_public_read
  on storage.objects
  for select
  using (bucket_id = 'triage-error-photos');

create policy triage_error_photos_own_insert
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'triage-error-photos'
    and split_part(name, '/', 1) = auth.uid()::text
    and public.is_active_staff()
  );

create policy triage_error_photos_own_update
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'triage-error-photos'
    and split_part(name, '/', 1) = auth.uid()::text
    and public.is_active_staff()
  )
  with check (
    bucket_id = 'triage-error-photos'
    and split_part(name, '/', 1) = auth.uid()::text
    and public.is_active_staff()
  );

create policy triage_error_photos_own_delete
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'triage-error-photos'
    and split_part(name, '/', 1) = auth.uid()::text
    and public.is_active_staff()
  );
