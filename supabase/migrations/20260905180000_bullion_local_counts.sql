-- Local vault / store / other drafts for Audit → Bullion Save (app DB only).
-- Update still writes vault+night+afternoon to Aureus inventory_logs.

alter table public.bullion_night_counts
  add column if not exists store_entered numeric;

alter table public.bullion_night_counts
  add column if not exists other_entered numeric;

notify pgrst, 'reload schema';
