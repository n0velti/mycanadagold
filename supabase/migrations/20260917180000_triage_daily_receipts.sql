-- Daily receipt check for a triage batch: for each day in the batch and each
-- store, how many PO / SO were expected vs. how many the Workshop received.
-- One row per (batch, day, store). Staff with an active profile share the set.

create table if not exists public.triage_daily_receipts (
  batch_id text not null,
  date_key date not null,
  store_key text not null,
  store_name text not null default '',
  expected integer not null default 0,
  received integer,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id),
  updated_by_name text not null default '',
  primary key (batch_id, date_key, store_key)
);

alter table public.triage_daily_receipts
  drop constraint if exists triage_daily_receipts_expected_nonneg;
alter table public.triage_daily_receipts
  add constraint triage_daily_receipts_expected_nonneg check (expected >= 0);
alter table public.triage_daily_receipts
  drop constraint if exists triage_daily_receipts_received_nonneg;
alter table public.triage_daily_receipts
  add constraint triage_daily_receipts_received_nonneg check (received is null or received >= 0);

create index if not exists triage_daily_receipts_batch_idx
  on public.triage_daily_receipts (batch_id);

alter table public.triage_daily_receipts enable row level security;
alter table public.triage_daily_receipts force row level security;

revoke all on public.triage_daily_receipts from public, anon;
grant select, insert, update, delete on table public.triage_daily_receipts
  to authenticated, service_role;

drop policy if exists triage_daily_receipts_select on public.triage_daily_receipts;
drop policy if exists triage_daily_receipts_insert on public.triage_daily_receipts;
drop policy if exists triage_daily_receipts_update on public.triage_daily_receipts;
drop policy if exists triage_daily_receipts_delete on public.triage_daily_receipts;

create policy triage_daily_receipts_select
  on public.triage_daily_receipts for select to authenticated
  using (public.is_active_staff());
create policy triage_daily_receipts_insert
  on public.triage_daily_receipts for insert to authenticated
  with check (public.is_active_staff());
create policy triage_daily_receipts_update
  on public.triage_daily_receipts for update to authenticated
  using (public.is_active_staff())
  with check (public.is_active_staff());
create policy triage_daily_receipts_delete
  on public.triage_daily_receipts for delete to authenticated
  using (public.is_active_staff());

alter table public.triage_daily_receipts replica identity full;

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
      and tablename = 'triage_daily_receipts'
  ) then
    execute 'alter publication supabase_realtime add table public.triage_daily_receipts';
  end if;
end $$;

notify pgrst, 'reload schema';
