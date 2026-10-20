-- Per-store custom supply sections. Template sections stay in app code;
-- these rows let a branch add their own heading and keep it empty until
-- the first line item is added.

create table if not exists public.supply_sections (
  id uuid primary key default gen_random_uuid(),
  store_name text not null,
  section_key text not null,
  label text not null,
  sort_order integer not null default 0,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_name, section_key),
  check (char_length(store_name) between 1 and 80),
  check (char_length(section_key) between 1 and 80),
  check (char_length(label) between 1 and 80)
);

create index if not exists supply_sections_store_sort_idx
  on public.supply_sections (store_name, sort_order, label);

create or replace function public.supply_sections_before_write()
returns trigger
language plpgsql
as $$
begin
  new.store_name = btrim(new.store_name);
  new.section_key = btrim(new.section_key);
  new.label = btrim(new.label);
  new.sort_order = coalesce(new.sort_order, 0);
  new.updated_at = now();
  if tg_op = 'INSERT' then
    new.created_by = coalesce(new.created_by, auth.uid());
  end if;
  return new;
end;
$$;

drop trigger if exists supply_sections_before_write on public.supply_sections;
create trigger supply_sections_before_write
  before insert or update on public.supply_sections
  for each row
  execute function public.supply_sections_before_write();

alter table public.supply_sections enable row level security;
alter table public.supply_sections force row level security;

revoke all on table public.supply_sections from public, anon;
grant select, insert, update, delete on table public.supply_sections to authenticated;
grant select, insert, update, delete on table public.supply_sections to service_role;

create policy supply_sections_select
  on public.supply_sections
  for select
  to authenticated
  using ((select public.is_active_staff()));

create policy supply_sections_insert
  on public.supply_sections
  for insert
  to authenticated
  with check ((select public.is_active_staff()));

create policy supply_sections_update
  on public.supply_sections
  for update
  to authenticated
  using ((select public.is_active_staff()))
  with check ((select public.is_active_staff()));

create policy supply_sections_delete
  on public.supply_sections
  for delete
  to authenticated
  using ((select public.is_active_staff()));

alter table public.supply_sections replica identity full;

notify pgrst, 'reload schema';
