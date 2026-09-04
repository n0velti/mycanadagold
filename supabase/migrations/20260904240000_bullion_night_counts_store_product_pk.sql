-- The first applied night-count table keyed rows by date. The app now
-- upserts on (store_key, product_id) only, so ON CONFLICT failed.

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'bullion_night_counts'
      and column_name = 'count_date'
  ) then
    delete from public.bullion_night_counts keep
    using public.bullion_night_counts older
    where keep.store_key = older.store_key
      and keep.product_id = older.product_id
      and (
        keep.updated_at < older.updated_at
        or (
          keep.updated_at = older.updated_at
          and keep.count_date < older.count_date
        )
      );

    alter table public.bullion_night_counts
      drop constraint if exists bullion_night_counts_pkey;

    drop index if exists public.bullion_night_counts_store_date_idx;

    alter table public.bullion_night_counts
      drop column count_date;

    alter table public.bullion_night_counts
      add primary key (store_key, product_id);
  elsif not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.bullion_night_counts'::regclass
      and contype = 'p'
  ) then
    alter table public.bullion_night_counts
      add primary key (store_key, product_id);
  end if;
end $$;

notify pgrst, 'reload schema';
