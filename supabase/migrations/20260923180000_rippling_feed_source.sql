-- Which source updates hours, clock-in, shifts, and the report on screen.
-- email: the latest mailbox attachments. drop: a file dropped in the app.
-- csv_text keeps the latest batch so the switch can apply it again.

alter table public.rippling_time_sync
  add column if not exists feed_source text not null default 'email';

alter table public.rippling_time_sync
  drop constraint if exists rippling_time_sync_feed_source_check;

alter table public.rippling_time_sync
  add constraint rippling_time_sync_feed_source_check
  check (feed_source in ('email', 'drop'));

alter table public.rippling_csv_files
  add column if not exists csv_text text;

alter table public.rippling_csv_files
  drop constraint if exists rippling_csv_files_csv_text_len;

alter table public.rippling_csv_files
  add constraint rippling_csv_files_csv_text_len
  check (csv_text is null or char_length(csv_text) <= 1500000);
