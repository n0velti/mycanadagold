-- Shared triage error types. Built-in labels live in the app; rows here are
-- types staff add so everyone can search and select them later.

create table if not exists public.triage_error_types (
  label text primary key,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id)
);

create unique index if not exists triage_error_types_label_lower_idx
  on public.triage_error_types (lower(label));

alter table public.triage_error_types enable row level security;
alter table public.triage_error_types force row level security;

revoke all on public.triage_error_types from public, anon;

grant select, insert, update, delete on table public.triage_error_types
  to authenticated, service_role;

drop policy if exists triage_error_types_select on public.triage_error_types;
drop policy if exists triage_error_types_insert on public.triage_error_types;
drop policy if exists triage_error_types_update on public.triage_error_types;
drop policy if exists triage_error_types_delete on public.triage_error_types;

create policy triage_error_types_select
  on public.triage_error_types for select to authenticated
  using (public.is_active_staff());
create policy triage_error_types_insert
  on public.triage_error_types for insert to authenticated
  with check (public.is_active_staff());
create policy triage_error_types_update
  on public.triage_error_types for update to authenticated
  using (public.is_active_staff())
  with check (public.is_active_staff());
create policy triage_error_types_delete
  on public.triage_error_types for delete to authenticated
  using (public.is_active_staff());

alter table public.triage_error_types replica identity full;

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
      and tablename = 'triage_error_types'
  ) then
    execute 'alter publication supabase_realtime add table public.triage_error_types';
  end if;
end $$;

notify pgrst, 'reload schema';
