-- Soft-deleted triage batches and documents. Dashboard deletes move here so
-- a later sync cannot recreate the live row.

create table if not exists public.triage_deleted (
  id text primary key,
  kind text not null default 'batch',
  payload jsonb not null default '{}'::jsonb,
  deleted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id),
  constraint triage_deleted_kind_check check (kind in ('batch', 'po', 'doc'))
);

alter table public.triage_deleted enable row level security;
alter table public.triage_deleted force row level security;

revoke all on public.triage_deleted from public, anon;

grant select, insert, update, delete on table public.triage_deleted
  to authenticated, service_role;

drop policy if exists triage_deleted_select on public.triage_deleted;
drop policy if exists triage_deleted_insert on public.triage_deleted;
drop policy if exists triage_deleted_update on public.triage_deleted;
drop policy if exists triage_deleted_delete on public.triage_deleted;

create policy triage_deleted_select
  on public.triage_deleted for select to authenticated
  using (public.is_active_staff());
create policy triage_deleted_insert
  on public.triage_deleted for insert to authenticated
  with check (public.is_active_staff());
create policy triage_deleted_update
  on public.triage_deleted for update to authenticated
  using (public.is_active_staff())
  with check (public.is_active_staff());
create policy triage_deleted_delete
  on public.triage_deleted for delete to authenticated
  using (public.is_active_staff());

alter table public.triage_deleted replica identity full;

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
      and tablename = 'triage_deleted'
  ) then
    execute 'alter publication supabase_realtime add table public.triage_deleted';
  end if;
end $$;

notify pgrst, 'reload schema';
