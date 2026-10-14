-- Company supplies list. Staff add a named item with brand, details, quantity,
-- status, and last-purchase fields. Optional store_name scopes a row to a branch.

create table if not exists public.supply_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  brand text not null default '',
  details text not null default '',
  current_quantity numeric(12, 2) not null default 0,
  status text not null default 'in_stock',
  last_bought_date date,
  last_bought_quantity numeric(12, 2),
  store_name text not null default '',
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (char_length(trim(name)) between 1 and 120),
  check (char_length(brand) <= 80),
  check (char_length(details) <= 500),
  check (char_length(store_name) <= 80),
  check (current_quantity >= 0),
  check (last_bought_quantity is null or last_bought_quantity >= 0),
  check (status in ('in_stock', 'low', 'out', 'ordered'))
);

create index if not exists supply_items_name_idx
  on public.supply_items (lower(name));

create index if not exists supply_items_store_name_idx
  on public.supply_items (store_name, name);

create or replace function public.supply_items_before_write()
returns trigger
language plpgsql
as $$
begin
  new.name = btrim(new.name);
  new.brand = coalesce(btrim(new.brand), '');
  new.details = coalesce(btrim(new.details), '');
  new.store_name = coalesce(btrim(new.store_name), '');
  new.updated_at = now();
  if tg_op = 'INSERT' then
    new.created_by = coalesce(new.created_by, auth.uid());
  end if;
  return new;
end;
$$;

drop trigger if exists supply_items_before_write on public.supply_items;
create trigger supply_items_before_write
  before insert or update on public.supply_items
  for each row
  execute function public.supply_items_before_write();

alter table public.supply_items enable row level security;
alter table public.supply_items force row level security;

revoke all on table public.supply_items from public, anon;
grant select, insert, update on table public.supply_items to authenticated;
grant select, insert, update, delete on table public.supply_items to service_role;

drop policy if exists supply_items_select on public.supply_items;
drop policy if exists supply_items_insert on public.supply_items;
drop policy if exists supply_items_update on public.supply_items;

create policy supply_items_select
  on public.supply_items
  for select
  to authenticated
  using ((select public.is_active_staff()));

create policy supply_items_insert
  on public.supply_items
  for insert
  to authenticated
  with check ((select public.is_active_staff()));

create policy supply_items_update
  on public.supply_items
  for update
  to authenticated
  using ((select public.is_active_staff()))
  with check ((select public.is_active_staff()));

alter table public.supply_items replica identity full;

notify pgrst, 'reload schema';
