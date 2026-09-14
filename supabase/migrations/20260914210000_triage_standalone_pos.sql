-- Standalone Quick Add POs share triage_batches with date batches.
-- Key rows by id so a PO is not forced onto a calendar date_key.

alter table public.triage_batches
  add column if not exists kind text not null default 'batch';

alter table public.triage_batches
  add column if not exists census jsonb;

alter table public.triage_batches
  drop constraint if exists triage_batches_pkey;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'triage_batches'
      and column_name = 'date_key'
      and data_type = 'date'
  ) then
    alter table public.triage_batches
      alter column date_key type text using to_char(date_key, 'YYYY-MM-DD');
  end if;
end $$;

alter table public.triage_batches
  alter column date_key set not null;

alter table public.triage_batches
  add primary key (id);

alter table public.triage_batches
  drop constraint if exists triage_batches_kind_check;

alter table public.triage_batches
  add constraint triage_batches_kind_check
  check (kind in ('batch', 'po'));

create unique index if not exists triage_batches_batch_date_key
  on public.triage_batches (date_key)
  where kind = 'batch';
