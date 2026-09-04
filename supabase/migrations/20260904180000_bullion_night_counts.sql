-- Per-store, per-item night drop counts for Audit → Bullion.
-- Vault is still stored in Aureus inventory logs; night lives here so
-- vault + night can balance against system qty without changing POS fields.

create table if not exists public.bullion_night_counts (
  store_key text not null,
  product_id text not null,
  night_count numeric not null default 0,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id),
  primary key (store_key, product_id)
);

alter table public.bullion_night_counts enable row level security;
alter table public.bullion_night_counts force row level security;

revoke all on public.bullion_night_counts from public, anon;
grant select, insert, update, delete on table public.bullion_night_counts
  to authenticated, service_role;

drop policy if exists bullion_night_counts_select on public.bullion_night_counts;
drop policy if exists bullion_night_counts_insert on public.bullion_night_counts;
drop policy if exists bullion_night_counts_update on public.bullion_night_counts;
drop policy if exists bullion_night_counts_delete on public.bullion_night_counts;

create policy bullion_night_counts_select
  on public.bullion_night_counts
  for select
  to authenticated
  using (public.is_active_staff());

create policy bullion_night_counts_insert
  on public.bullion_night_counts
  for insert
  to authenticated
  with check (public.is_active_staff());

create policy bullion_night_counts_update
  on public.bullion_night_counts
  for update
  to authenticated
  using (public.is_active_staff())
  with check (public.is_active_staff());

create policy bullion_night_counts_delete
  on public.bullion_night_counts
  for delete
  to authenticated
  using (public.is_active_staff());

notify pgrst, 'reload schema';
