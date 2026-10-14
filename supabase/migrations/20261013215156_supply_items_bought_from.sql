-- Where a supply was last purchased. Additive; existing rows stay empty.

alter table public.supply_items
  add column if not exists bought_from text not null default '';

alter table public.supply_items
  drop constraint if exists supply_items_bought_from_len;
alter table public.supply_items
  add constraint supply_items_bought_from_len
  check (char_length(bought_from) <= 120);

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
  new.updated_at = now();
  if tg_op = 'INSERT' then
    new.created_by = coalesce(new.created_by, auth.uid());
  end if;
  return new;
end;
$$;

notify pgrst, 'reload schema';
