-- Remember which POs have already been counted for a store-day so Finish
-- can raise the received total once per paper.

alter table public.triage_daily_receipts
  add column if not exists counted_po_ids jsonb not null default '[]'::jsonb;

notify pgrst, 'reload schema';
