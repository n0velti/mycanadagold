-- Triage PO / SO corrections live here, not in Aureus.
-- Aureus is pull-only. Edits are stored as review payloads keyed by PO id.

create table if not exists public.triage_reviews (
  id text primary key,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id)
);

alter table public.triage_reviews enable row level security;
alter table public.triage_reviews force row level security;

revoke all on public.triage_reviews from public, anon;

grant select, insert, update, delete on table public.triage_reviews
  to authenticated, service_role;

drop policy if exists triage_reviews_select on public.triage_reviews;
drop policy if exists triage_reviews_insert on public.triage_reviews;
drop policy if exists triage_reviews_update on public.triage_reviews;
drop policy if exists triage_reviews_delete on public.triage_reviews;

create policy triage_reviews_select
  on public.triage_reviews for select to authenticated
  using (public.is_active_staff());
create policy triage_reviews_insert
  on public.triage_reviews for insert to authenticated
  with check (public.is_active_staff());
create policy triage_reviews_update
  on public.triage_reviews for update to authenticated
  using (public.is_active_staff())
  with check (public.is_active_staff());
create policy triage_reviews_delete
  on public.triage_reviews for delete to authenticated
  using (public.is_active_staff());

alter table public.triage_reviews replica identity full;

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    return;
  end if;
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'triage_reviews'
  ) then
    execute 'alter publication supabase_realtime add table public.triage_reviews';
  end if;
end $$;

notify pgrst, 'reload schema';
