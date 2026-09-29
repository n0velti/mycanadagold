-- Per-PO line allocations (Melt, RCM, …) keyed by purchase / order id.
-- Aureus stays pull-only. Destinations and split weights live here.

create table if not exists public.triage_allocations (
  id text primary key,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id)
);

alter table public.triage_allocations enable row level security;
alter table public.triage_allocations force row level security;

revoke all on public.triage_allocations from public, anon;

grant select, insert, update, delete on table public.triage_allocations
  to authenticated, service_role;

drop policy if exists triage_allocations_select on public.triage_allocations;
drop policy if exists triage_allocations_insert on public.triage_allocations;
drop policy if exists triage_allocations_update on public.triage_allocations;
drop policy if exists triage_allocations_delete on public.triage_allocations;

create policy triage_allocations_select
  on public.triage_allocations for select to authenticated
  using (public.is_active_staff());
create policy triage_allocations_insert
  on public.triage_allocations for insert to authenticated
  with check (public.is_active_staff());
create policy triage_allocations_update
  on public.triage_allocations for update to authenticated
  using (public.is_active_staff())
  with check (public.is_active_staff());
create policy triage_allocations_delete
  on public.triage_allocations for delete to authenticated
  using (public.is_active_staff());

alter table public.triage_allocations replica identity full;

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
      and tablename = 'triage_allocations'
  ) then
    execute 'alter publication supabase_realtime add table public.triage_allocations';
  end if;
end $$;

notify pgrst, 'reload schema';
