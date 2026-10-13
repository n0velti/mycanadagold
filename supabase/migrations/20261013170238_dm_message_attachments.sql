-- Files and Analytics charts on Direct Messages. Participants can attach
-- photos, video, spreadsheets, PDFs, and documents; @AI replies store charts
-- so everyone in the thread sees the same answer.

alter table public.dm_messages
  add column if not exists attachments jsonb not null default '[]'::jsonb;

alter table public.dm_messages
  add column if not exists charts jsonb not null default '[]'::jsonb;

alter table public.dm_messages
  drop constraint if exists dm_messages_check;

alter table public.dm_messages
  drop constraint if exists dm_messages_body_check;

alter table public.dm_messages
  drop constraint if exists dm_messages_body_or_files_check;

alter table public.dm_messages
  add constraint dm_messages_body_or_files_check
  check (
    (
      char_length(trim(body)) > 0
      or (jsonb_typeof(attachments) = 'array' and jsonb_array_length(attachments) > 0)
    )
    and char_length(body) <= 16000
    and jsonb_typeof(attachments) = 'array'
    and jsonb_array_length(attachments) <= 8
    and jsonb_typeof(charts) = 'array'
    and jsonb_array_length(charts) <= 12
  );

create or replace function public.dm_messages_after_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  preview text;
begin
  preview := left(trim(coalesce(new.body, '')), 240);
  if preview = '' or preview in ('(Photo attached)', '(Attachment)') then
    preview := left(
      coalesce(new.attachments -> 0 ->> 'name', 'Attachment'),
      240
    );
  end if;

  update public.dm_conversations
  set
    last_message_at = new.created_at,
    last_message_preview = preview,
    updated_at = now()
  where id = new.conversation_id;
  return new;
end;
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('dm-attachments', 'dm-attachments', false, 12582912, null)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists dm_attachments_select on storage.objects;
drop policy if exists dm_attachments_insert on storage.objects;
drop policy if exists dm_attachments_update on storage.objects;
drop policy if exists dm_attachments_delete on storage.objects;

create policy dm_attachments_select
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'dm-attachments'
    and split_part(name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and (select public.dm_is_participant(split_part(name, '/', 1)::uuid))
  );

create policy dm_attachments_insert
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'dm-attachments'
    and split_part(name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and (select public.dm_is_participant(split_part(name, '/', 1)::uuid))
  );

create policy dm_attachments_update
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'dm-attachments'
    and split_part(name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and (select public.dm_is_participant(split_part(name, '/', 1)::uuid))
  )
  with check (
    bucket_id = 'dm-attachments'
    and split_part(name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and (select public.dm_is_participant(split_part(name, '/', 1)::uuid))
  );

create policy dm_attachments_delete
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'dm-attachments'
    and split_part(name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and (select public.dm_is_participant(split_part(name, '/', 1)::uuid))
  );

notify pgrst, 'reload schema';
