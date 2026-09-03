-- Per-user pinned apps on the staff profile.
-- NULL means the preference has never been saved (fall back to local/legacy).
-- An array (including []) is the user's saved pin order.

alter table public.profiles
  add column if not exists pinned_tools jsonb;
