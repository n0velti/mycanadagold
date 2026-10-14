-- Staff can remove supply rows from the list (archived via delete guardrails).

grant delete on table public.supply_items to authenticated;

drop policy if exists supply_items_delete on public.supply_items;
create policy supply_items_delete
  on public.supply_items
  for delete
  to authenticated
  using ((select public.is_active_staff()));

notify pgrst, 'reload schema';
