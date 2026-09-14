-- Shared workshop triage: date batches, melt PO reviews, and planned bullion
-- transfers. Staff with an active profile can read and write the same set.

create table if not exists public.triage_batches (
  date_key date primary key,
  id text not null,
  date_label text not null default '',
  triage_location jsonb,
  stores jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id)
);

alter table public.triage_batches
  drop constraint if exists triage_batches_stores_array;
alter table public.triage_batches
  add constraint triage_batches_stores_array
  check (jsonb_typeof(stores) = 'array');

create table if not exists public.triage_planned (
  id text primary key,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id)
);

create table if not exists public.triage_meta (
  id text primary key default 'default',
  next_number integer not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id),
  constraint triage_meta_singleton check (id = 'default')
);

alter table public.triage_batches enable row level security;
alter table public.triage_batches force row level security;
alter table public.triage_planned enable row level security;
alter table public.triage_planned force row level security;
alter table public.triage_meta enable row level security;
alter table public.triage_meta force row level security;

revoke all on public.triage_batches from public, anon;
revoke all on public.triage_planned from public, anon;
revoke all on public.triage_meta from public, anon;

grant select, insert, update, delete on table public.triage_batches
  to authenticated, service_role;
grant select, insert, update, delete on table public.triage_planned
  to authenticated, service_role;
grant select, insert, update, delete on table public.triage_meta
  to authenticated, service_role;

drop policy if exists triage_batches_select on public.triage_batches;
drop policy if exists triage_batches_insert on public.triage_batches;
drop policy if exists triage_batches_update on public.triage_batches;
drop policy if exists triage_batches_delete on public.triage_batches;
drop policy if exists triage_planned_select on public.triage_planned;
drop policy if exists triage_planned_insert on public.triage_planned;
drop policy if exists triage_planned_update on public.triage_planned;
drop policy if exists triage_planned_delete on public.triage_planned;
drop policy if exists triage_meta_select on public.triage_meta;
drop policy if exists triage_meta_insert on public.triage_meta;
drop policy if exists triage_meta_update on public.triage_meta;
drop policy if exists triage_meta_delete on public.triage_meta;

create policy triage_batches_select
  on public.triage_batches for select to authenticated
  using (public.is_active_staff());
create policy triage_batches_insert
  on public.triage_batches for insert to authenticated
  with check (public.is_active_staff());
create policy triage_batches_update
  on public.triage_batches for update to authenticated
  using (public.is_active_staff())
  with check (public.is_active_staff());
create policy triage_batches_delete
  on public.triage_batches for delete to authenticated
  using (public.is_active_staff());

create policy triage_planned_select
  on public.triage_planned for select to authenticated
  using (public.is_active_staff());
create policy triage_planned_insert
  on public.triage_planned for insert to authenticated
  with check (public.is_active_staff());
create policy triage_planned_update
  on public.triage_planned for update to authenticated
  using (public.is_active_staff())
  with check (public.is_active_staff());
create policy triage_planned_delete
  on public.triage_planned for delete to authenticated
  using (public.is_active_staff());

create policy triage_meta_select
  on public.triage_meta for select to authenticated
  using (public.is_active_staff());
create policy triage_meta_insert
  on public.triage_meta for insert to authenticated
  with check (public.is_active_staff());
create policy triage_meta_update
  on public.triage_meta for update to authenticated
  using (public.is_active_staff())
  with check (public.is_active_staff());
create policy triage_meta_delete
  on public.triage_meta for delete to authenticated
  using (public.is_active_staff());

alter table public.triage_batches replica identity full;
alter table public.triage_planned replica identity full;
alter table public.triage_meta replica identity full;

do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    return;
  end if;
  foreach t in array array['triage_batches', 'triage_planned', 'triage_meta']
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

notify pgrst, 'reload schema';
