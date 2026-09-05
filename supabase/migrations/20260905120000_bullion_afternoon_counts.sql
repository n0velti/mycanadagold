-- Afternoon drop counts sit beside night on the same store/product row.
-- vault_entered keeps the typed vault so Aureus can store vault+night+afternoon
-- without the audit inputs double-counting on reload.

alter table public.bullion_night_counts
  add column if not exists afternoon_count numeric not null default 0;

alter table public.bullion_night_counts
  add column if not exists vault_entered numeric;

notify pgrst, 'reload schema';
