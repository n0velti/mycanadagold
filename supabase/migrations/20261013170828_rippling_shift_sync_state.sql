-- The shift-report pass of the Rippling mailbox sync runs after the hours and
-- clock-in pass, and that pass rewrites last_error on every cycle. Give the
-- shift report its own bookkeeping so the Employees calendar can say when the
-- schedule was last fetched, from which file, and why a fetch failed.

alter table public.rippling_time_sync
  add column if not exists last_shift_checked_at timestamptz,
  add column if not exists last_shift_error text not null default '',
  add column if not exists last_shift_attachment_name text not null default '';

notify pgrst, 'reload schema';
