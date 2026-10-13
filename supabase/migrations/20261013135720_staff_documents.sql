-- Shared Documents library. Staff upload any file into folders; Analytics
-- reads extracted text (and opens images, video, and PDFs on demand) from
-- these rows. Deletes go through the app and are archived by the delete guard.

create table if not exists public.document_folders (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references public.document_folders (id) on delete cascade,
  name text not null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint document_folders_name_check check (char_length(name) between 1 and 120)
);

create unique index if not exists document_folders_sibling_name_idx
  on public.document_folders (parent_id, lower(name)) nulls not distinct;

create index if not exists document_folders_parent_idx
  on public.document_folders (parent_id);

create table if not exists public.document_files (
  id uuid primary key default gen_random_uuid(),
  folder_id uuid references public.document_folders (id) on delete cascade,
  name text not null,
  storage_path text not null unique,
  mime_type text not null default 'application/octet-stream',
  size_bytes bigint not null default 0,
  kind text not null default 'file',
  extracted_text text,
  text_truncated boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  search_vector tsvector generated always as (
    to_tsvector('simple', coalesce(name, '') || ' ' || coalesce(extracted_text, ''))
  ) stored,
  constraint document_files_name_check check (char_length(name) between 1 and 240),
  constraint document_files_mime_check check (char_length(mime_type) between 1 and 200),
  constraint document_files_path_check check (char_length(storage_path) between 1 and 300),
  constraint document_files_size_check check (size_bytes >= 0 and size_bytes <= 104857600),
  constraint document_files_kind_check check (
    kind in ('spreadsheet', 'document', 'pdf', 'image', 'video', 'text', 'xls', 'doc', 'file')
  ),
  constraint document_files_text_check check (
    extracted_text is null or char_length(extracted_text) <= 60000
  )
);

create index if not exists document_files_folder_idx
  on public.document_files (folder_id, created_at desc);

create index if not exists document_files_search_idx
  on public.document_files using gin (search_vector);

create or replace function public.document_folders_before_write()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  walk uuid;
  depth integer := 0;
begin
  if not (select public.is_active_staff()) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  new.name := btrim(new.name);
  if tg_op = 'INSERT' then
    new.created_by := (select auth.uid());
    new.created_at := now();
  else
    new.created_at := old.created_at;
    if new.created_by is distinct from old.created_by and new.created_by is not null then
      new.created_by := old.created_by;
    end if;
  end if;
  new.updated_at := now();

  if new.parent_id is not null and new.parent_id = new.id then
    raise exception 'A folder cannot contain itself.' using errcode = '23514';
  end if;

  walk := new.parent_id;
  while walk is not null loop
    if walk = new.id then
      raise exception 'A folder cannot contain itself.' using errcode = '23514';
    end if;
    depth := depth + 1;
    if depth > 30 then
      raise exception 'That folder is nested too deep.' using errcode = '23514';
    end if;
    select parent_id into walk from public.document_folders where id = walk;
  end loop;

  return new;
end;
$$;

drop trigger if exists document_folders_before_write on public.document_folders;
create trigger document_folders_before_write
  before insert or update on public.document_folders
  for each row
  execute function public.document_folders_before_write();

create or replace function public.document_files_before_write()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not (select public.is_active_staff()) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  new.name := btrim(new.name);
  if tg_op = 'INSERT' then
    new.created_by := (select auth.uid());
    new.created_at := now();
  else
    new.created_by := case
      when new.created_by is null then null
      else old.created_by
    end;
    new.created_at := old.created_at;
    new.storage_path := old.storage_path;
    new.mime_type := old.mime_type;
    new.size_bytes := old.size_bytes;
    new.kind := old.kind;
    new.extracted_text := old.extracted_text;
    new.text_truncated := old.text_truncated;
  end if;

  return new;
end;
$$;

drop trigger if exists document_files_before_write on public.document_files;
create trigger document_files_before_write
  before insert or update on public.document_files
  for each row
  execute function public.document_files_before_write();

alter table public.document_folders enable row level security;
alter table public.document_folders force row level security;
alter table public.document_files enable row level security;
alter table public.document_files force row level security;

revoke all on public.document_folders from public, anon;
revoke all on public.document_files from public, anon;
grant select, insert, update, delete on table public.document_folders to authenticated;
grant select, insert, update, delete on table public.document_files to authenticated;
grant select, insert, update, delete on table public.document_folders to service_role;
grant select, insert, update, delete on table public.document_files to service_role;

drop policy if exists document_folders_select on public.document_folders;
drop policy if exists document_folders_insert on public.document_folders;
drop policy if exists document_folders_update on public.document_folders;
drop policy if exists document_folders_delete on public.document_folders;
drop policy if exists document_files_select on public.document_files;
drop policy if exists document_files_insert on public.document_files;
drop policy if exists document_files_update on public.document_files;
drop policy if exists document_files_delete on public.document_files;

create policy document_folders_select
  on public.document_folders for select to authenticated
  using ((select public.is_active_staff()));

create policy document_folders_insert
  on public.document_folders for insert to authenticated
  with check (
    (select public.is_active_staff())
    and created_by = (select auth.uid())
  );

create policy document_folders_update
  on public.document_folders for update to authenticated
  using ((select public.is_active_staff()))
  with check ((select public.is_active_staff()));

create policy document_folders_delete
  on public.document_folders for delete to authenticated
  using ((select public.is_active_staff()));

create policy document_files_select
  on public.document_files for select to authenticated
  using ((select public.is_active_staff()));

create policy document_files_insert
  on public.document_files for insert to authenticated
  with check (
    (select public.is_active_staff())
    and created_by = (select auth.uid())
  );

create policy document_files_update
  on public.document_files for update to authenticated
  using ((select public.is_active_staff()))
  with check ((select public.is_active_staff()));

create policy document_files_delete
  on public.document_files for delete to authenticated
  using ((select public.is_active_staff()));

revoke all on function public.document_folders_before_write() from public, anon;
revoke all on function public.document_files_before_write() from public, anon;
grant execute on function public.document_folders_before_write() to authenticated, service_role;
grant execute on function public.document_files_before_write() to authenticated, service_role;

-- Library search used by the Documents screen and Analytics. Invoker so RLS applies.
create or replace function public.search_staff_documents(q text, folder text default null)
returns table (
  id uuid,
  name text,
  folder_id uuid,
  folder_path text,
  storage_path text,
  mime_type text,
  kind text,
  size_bytes bigint,
  created_at timestamptz,
  text_truncated boolean,
  excerpt text
)
language sql
stable
security invoker
set search_path = public
as $$
  with recursive params as (
    select
      translate(btrim(coalesce(q, '')), '%_' || chr(92), '') as needle,
      translate(btrim(coalesce(folder, '')), '%_' || chr(92), '') as folder_name
  ),
  tree as (
    select
      f.id,
      f.parent_id,
      f.name::text as path,
      1 as depth
    from public.document_folders f
    where f.parent_id is null
    union all
    select
      c.id,
      c.parent_id,
      t.path || ' / ' || c.name,
      t.depth + 1
    from public.document_folders c
    join tree t on c.parent_id = t.id
    where t.depth < 30
  )
  select
    files.id,
    files.name,
    files.folder_id,
    coalesce(tree.path, '') as folder_path,
    files.storage_path,
    files.mime_type,
    files.kind,
    files.size_bytes,
    files.created_at,
    files.text_truncated,
    left(coalesce(files.extracted_text, ''), 500) as excerpt
  from public.document_files files
  left join tree on tree.id = files.folder_id
  cross join params
  where params.needle <> ''
    and (
      files.name ilike '%' || params.needle || '%'
      or (
        char_length(params.needle) >= 2
        and files.search_vector @@ plainto_tsquery('simple', params.needle)
      )
    )
    and (
      params.folder_name = ''
      or coalesce(tree.path, '') ilike '%' || params.folder_name || '%'
    )
  order by files.created_at desc
  limit 24;
$$;

revoke all on function public.search_staff_documents(text, text) from public, anon;
grant execute on function public.search_staff_documents(text, text) to authenticated, service_role;

-- Private bucket, every format. 100 MB matches the size check on document_files.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('staff-documents', 'staff-documents', false, 104857600, null)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists staff_documents_select on storage.objects;
drop policy if exists staff_documents_insert on storage.objects;
drop policy if exists staff_documents_update on storage.objects;
drop policy if exists staff_documents_delete on storage.objects;

create policy staff_documents_select
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'staff-documents'
    and (select public.is_active_staff())
  );

create policy staff_documents_insert
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'staff-documents'
    and (select public.is_active_staff())
  );

create policy staff_documents_update
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'staff-documents'
    and (select public.is_active_staff())
  )
  with check (
    bucket_id = 'staff-documents'
    and (select public.is_active_staff())
  );

create policy staff_documents_delete
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'staff-documents'
    and (select public.is_active_staff())
  );

notify pgrst, 'reload schema';
