-- Reference screenshots for "The Agent" change requests (public URLs in storage).

alter table public.agent_requests
  add column if not exists image_urls text[] not null default '{}';

alter table public.agent_requests
  drop constraint if exists agent_requests_image_urls_check;
alter table public.agent_requests
  add constraint agent_requests_image_urls_check
  check (
    coalesce(array_length(image_urls, 1), 0) <= 4
    and not exists (
      select 1
      from unnest(image_urls) as u(url)
      where char_length(url) > 2048
    )
  );

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'agent-request-photos',
  'agent-request-photos',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists agent_request_photos_public_read on storage.objects;
drop policy if exists agent_request_photos_own_insert on storage.objects;
drop policy if exists agent_request_photos_own_update on storage.objects;
drop policy if exists agent_request_photos_own_delete on storage.objects;

create policy agent_request_photos_public_read
  on storage.objects
  for select
  using (bucket_id = 'agent-request-photos');

create policy agent_request_photos_own_insert
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'agent-request-photos'
    and split_part(name, '/', 1) = auth.uid()::text
    and public.is_active_staff()
  );

create policy agent_request_photos_own_update
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'agent-request-photos'
    and split_part(name, '/', 1) = auth.uid()::text
    and public.is_active_staff()
  )
  with check (
    bucket_id = 'agent-request-photos'
    and split_part(name, '/', 1) = auth.uid()::text
    and public.is_active_staff()
  );

create policy agent_request_photos_own_delete
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'agent-request-photos'
    and split_part(name, '/', 1) = auth.uid()::text
    and public.is_active_staff()
  );

create or replace function public.agent_requests_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  trusted boolean := false;
  image_count integer;
begin
  if auth.role() = 'service_role' or (select public.current_user_is_system_admin()) then
    trusted := true;
  elsif not (select public.is_active_staff()) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    if auth.role() is distinct from 'service_role' then
      new.sender_id := (select auth.uid());
    end if;
    new.created_at := now();
    if not trusted then
      new.status := 'new';
      new.approval_state := 'pending_review';
      new.approval_reason := null;
    end if;
  else
    new.sender_id := old.sender_id;
    new.conversation_id := old.conversation_id;
    new.created_at := old.created_at;
    new.body := old.body;
    new.image_urls := old.image_urls;
    if not trusted then
      new.status := old.status;
      new.approval_state := old.approval_state;
      new.approval_reason := old.approval_reason;
    end if;
  end if;

  new.body := trim(coalesce(new.body, ''));
  new.image_urls := coalesce(new.image_urls, '{}');

  image_count := coalesce(array_length(new.image_urls, 1), 0);
  if image_count > 4 then
    raise exception 'Too many images';
  end if;

  if new.body is null or char_length(new.body) = 0 then
    if image_count = 0 then
      raise exception 'Type a message first';
    end if;
    new.body := '(Photo attached)';
  end if;
  if char_length(new.body) > 4000 then
    new.body := left(new.body, 4000);
  end if;

  new.status := coalesce(nullif(lower(trim(new.status)), ''), 'new');
  if new.status not in ('new', 'in_progress', 'done') then
    raise exception 'Unknown request status';
  end if;

  new.approval_state := coalesce(nullif(lower(trim(new.approval_state)), ''), 'pending_review');
  if new.approval_state not in ('pending_review', 'approved', 'not_approved') then
    raise exception 'Unknown approval state';
  end if;

  new.approval_reason := nullif(left(trim(coalesce(new.approval_reason, '')), 500), '');
  new.updated_at := now();
  return new;
end;
$$;
