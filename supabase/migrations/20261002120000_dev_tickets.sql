-- Staff-filed product tickets. The app inserts the request; the proxy Edge
-- Function launches a Cursor cloud agent, then writes branch / PR / preview
-- URLs back with the service role. Authenticated staff can read; they cannot
-- update rows themselves.

create table if not exists public.dev_tickets (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  title text not null default '',
  body text not null,
  status text not null default 'submitted',
  agent_id text not null default '',
  agent_url text not null default '',
  run_id text not null default '',
  branch text not null default '',
  pr_url text not null default '',
  preview_url text not null default '',
  agent_summary text not null default '',
  error text not null default '',
  decided_by uuid references public.profiles (id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status in (
    'submitted',
    'launching',
    'in_progress',
    'ready',
    'failed',
    'approved',
    'rejected'
  )),
  check (char_length(title) <= 160),
  check (char_length(body) <= 8000),
  check (char_length(agent_id) <= 80),
  check (char_length(agent_url) <= 400),
  check (char_length(run_id) <= 80),
  check (char_length(branch) <= 200),
  check (char_length(pr_url) <= 400),
  check (char_length(preview_url) <= 400),
  check (char_length(agent_summary) <= 4000),
  check (char_length(error) <= 1000)
);

create index if not exists dev_tickets_created_at_idx
  on public.dev_tickets (created_at desc);

create index if not exists dev_tickets_status_idx
  on public.dev_tickets (status, created_at desc);

create or replace function public.dev_tickets_touch()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  if tg_op = 'INSERT' then
    new.reporter_id = coalesce(new.reporter_id, auth.uid());
    if new.title is null or btrim(new.title) = '' then
      new.title = left(btrim(regexp_replace(new.body, '\s+', ' ', 'g')), 80);
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists dev_tickets_touch on public.dev_tickets;
create trigger dev_tickets_touch
  before insert or update on public.dev_tickets
  for each row
  execute function public.dev_tickets_touch();

alter table public.dev_tickets enable row level security;
alter table public.dev_tickets force row level security;

revoke all on public.dev_tickets from public, anon;
grant select, insert on table public.dev_tickets to authenticated;
grant select, insert, update, delete on table public.dev_tickets to service_role;

drop policy if exists dev_tickets_select on public.dev_tickets;
drop policy if exists dev_tickets_insert on public.dev_tickets;

create policy dev_tickets_select
  on public.dev_tickets for select to authenticated
  using ((select public.is_active_staff()));

create policy dev_tickets_insert
  on public.dev_tickets for insert to authenticated
  with check (
    (select public.is_active_staff())
    and reporter_id = (select auth.uid())
  );

alter table public.dev_tickets replica identity full;

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
      and tablename = 'dev_tickets'
  ) then
    execute 'alter publication supabase_realtime add table public.dev_tickets';
  end if;
end $$;

notify pgrst, 'reload schema';
