-- Branch-manager supply checklist: in-use / unopened / order-more / notes,
-- plus a catalog key so each store gets its own copy of the same template.

alter table public.supply_items
  add column if not exists catalog_key text;

alter table public.supply_items
  add column if not exists category text not null default '';

alter table public.supply_items
  add column if not exists in_use text not null default '';

alter table public.supply_items
  add column if not exists unopened text not null default '';

alter table public.supply_items
  add column if not exists order_more text not null default 'no';

alter table public.supply_items
  add column if not exists notes text not null default '';

alter table public.supply_items
  add column if not exists sort_order integer not null default 0;

alter table public.supply_items
  drop constraint if exists supply_items_catalog_key_len;
alter table public.supply_items
  add constraint supply_items_catalog_key_len
    check (char_length(catalog_key) <= 80);

alter table public.supply_items
  drop constraint if exists supply_items_category_len;
alter table public.supply_items
  add constraint supply_items_category_len
    check (char_length(category) <= 80);

alter table public.supply_items
  drop constraint if exists supply_items_in_use_len;
alter table public.supply_items
  add constraint supply_items_in_use_len
    check (char_length(in_use) <= 40);

alter table public.supply_items
  drop constraint if exists supply_items_unopened_len;
alter table public.supply_items
  add constraint supply_items_unopened_len
    check (char_length(unopened) <= 40);

alter table public.supply_items
  drop constraint if exists supply_items_order_more_check;
alter table public.supply_items
  add constraint supply_items_order_more_check
    check (order_more in ('yes', 'no', 'yes_nu'));

alter table public.supply_items
  drop constraint if exists supply_items_notes_len;
alter table public.supply_items
  add constraint supply_items_notes_len
    check (char_length(notes) <= 500);

create unique index if not exists supply_items_store_catalog_uidx
  on public.supply_items (store_name, catalog_key);

create index if not exists supply_items_store_sort_idx
  on public.supply_items (store_name, category, sort_order, name);

create or replace function public.supply_items_before_write()
returns trigger
language plpgsql
as $$
begin
  new.name = btrim(new.name);
  new.brand = coalesce(btrim(new.brand), '');
  new.details = coalesce(btrim(new.details), '');
  new.bought_from = coalesce(btrim(new.bought_from), '');
  new.store_name = coalesce(btrim(new.store_name), '');
  new.catalog_key = nullif(btrim(coalesce(new.catalog_key, '')), '');
  new.category = coalesce(btrim(new.category), '');
  new.in_use = coalesce(btrim(new.in_use), '');
  new.unopened = coalesce(btrim(new.unopened), '');
  new.order_more = coalesce(btrim(new.order_more), 'no');
  new.notes = coalesce(btrim(new.notes), '');
  new.sort_order = coalesce(new.sort_order, 0);
  new.updated_at = now();
  if tg_op = 'INSERT' then
    new.created_by = coalesce(new.created_by, auth.uid());
  end if;
  return new;
end;
$$;

-- Every signed-in role can open Supplies. Individual user overrides that
-- already hide it stay hidden unless they inherit the role list.
update public.role_app_access
set
  visible_apps = visible_apps || '["supplies"]'::jsonb,
  updated_at = now()
where not coalesce(visible_apps, '[]'::jsonb) ? 'supplies';

update public.user_app_access
set
  visible_apps = visible_apps || '["supplies"]'::jsonb,
  updated_at = now()
where not coalesce(visible_apps, '[]'::jsonb) ? 'supplies';

notify pgrst, 'reload schema';
