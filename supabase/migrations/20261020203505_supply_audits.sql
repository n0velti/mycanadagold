-- Frozen per-store supplies checklist for a calendar day. Staff save when
-- the count is done and open that day later without changing the live list.

create table if not exists public.supply_audits (
  id uuid primary key default gen_random_uuid(),
  store_name text not null,
  audit_date date not null,
  items jsonb not null default '[]'::jsonb,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_name, audit_date),
  check (char_length(store_name) between 1 and 80),
  check (jsonb_typeof(items) = 'array')
);

create index if not exists supply_audits_store_date_idx
  on public.supply_audits (store_name, audit_date desc);

create or replace function public.supply_audits_before_write()
returns trigger
language plpgsql
as $$
begin
  new.store_name = btrim(new.store_name);
  new.items = coalesce(new.items, '[]'::jsonb);
  new.updated_at = now();
  if tg_op = 'INSERT' then
    new.created_by = coalesce(new.created_by, auth.uid());
  end if;
  return new;
end;
$$;

drop trigger if exists supply_audits_before_write on public.supply_audits;
create trigger supply_audits_before_write
  before insert or update on public.supply_audits
  for each row
  execute function public.supply_audits_before_write();

alter table public.supply_audits enable row level security;
alter table public.supply_audits force row level security;

revoke all on table public.supply_audits from public, anon;
grant select, insert, update on table public.supply_audits to authenticated;
grant select, insert, update, delete on table public.supply_audits to service_role;

drop policy if exists supply_audits_select on public.supply_audits;
drop policy if exists supply_audits_insert on public.supply_audits;
drop policy if exists supply_audits_update on public.supply_audits;

create policy supply_audits_select
  on public.supply_audits
  for select
  to authenticated
  using ((select public.is_active_staff()));

create policy supply_audits_insert
  on public.supply_audits
  for insert
  to authenticated
  with check ((select public.is_active_staff()));

create policy supply_audits_update
  on public.supply_audits
  for update
  to authenticated
  using ((select public.is_active_staff()))
  with check ((select public.is_active_staff()));

alter table public.supply_audits replica identity full;

notify pgrst, 'reload schema';
