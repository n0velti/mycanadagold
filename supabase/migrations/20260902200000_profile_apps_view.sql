-- Per-user Apps tab layout (grid vs list).
-- NULL means the preference has never been saved (fall back to local/default).

alter table public.profiles
  add column if not exists apps_view text;

alter table public.profiles drop constraint if exists profiles_apps_view_check;
alter table public.profiles
  add constraint profiles_apps_view_check
  check (apps_view is null or apps_view in ('grid', 'list'));
