-- Dashboards app: one tab per saved set of Analytics answers. Each widget keeps
-- the standalone question the AI is re-asked for the dashboard's date, plus a
-- snapshot of the original answer so the card has something to show before
-- the first refresh. Dashboards belong to the person who made them.

create table if not exists public.dashboards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  title text not null,
  source_chat_id text not null default '',
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dashboards_title_check
    check (char_length(trim(title)) between 1 and 80)
);

create index if not exists dashboards_user_position_idx
  on public.dashboards (user_id, position, created_at);

create table if not exists public.dashboard_widgets (
  id uuid primary key default gen_random_uuid(),
  dashboard_id uuid not null references public.dashboards (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  position integer not null default 0,
  title text not null,
  question text not null,
  kind text not null default 'text',
  model text not null default '',
  store_filter text not null default '',
  snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dashboard_widgets_title_check
    check (char_length(trim(title)) between 1 and 120),
  constraint dashboard_widgets_question_check
    check (char_length(trim(question)) between 1 and 2000),
  constraint dashboard_widgets_kind_check
    check (kind in ('chart', 'table', 'map', 'text', 'file'))
);

create index if not exists dashboard_widgets_dashboard_position_idx
  on public.dashboard_widgets (dashboard_id, position, created_at);

alter table public.dashboards enable row level security;
alter table public.dashboards force row level security;
alter table public.dashboard_widgets enable row level security;
alter table public.dashboard_widgets force row level security;

revoke all on table public.dashboards from public, anon;
revoke all on table public.dashboard_widgets from public, anon;
grant select, insert, update, delete on table public.dashboards to authenticated;
grant select, insert, update, delete on table public.dashboard_widgets to authenticated;

create policy dashboards_select
  on public.dashboards
  for select
  to authenticated
  using (
    user_id = (select auth.uid())
    and (select public.is_active_staff())
  );

create policy dashboards_insert
  on public.dashboards
  for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and (select public.is_active_staff())
  );

create policy dashboards_update
  on public.dashboards
  for update
  to authenticated
  using (
    user_id = (select auth.uid())
    and (select public.is_active_staff())
  )
  with check (
    user_id = (select auth.uid())
    and (select public.is_active_staff())
  );

-- Removing a tab is a user action in the Dashboards app; the row is archived
-- in cgold_audit.deleted_rows by the delete guardrails.
create policy dashboards_delete
  on public.dashboards
  for delete
  to authenticated
  using (
    user_id = (select auth.uid())
    and (select public.is_active_staff())
  );

create policy dashboard_widgets_select
  on public.dashboard_widgets
  for select
  to authenticated
  using (
    user_id = (select auth.uid())
    and (select public.is_active_staff())
  );

create policy dashboard_widgets_insert
  on public.dashboard_widgets
  for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and (select public.is_active_staff())
    and exists (
      select 1 from public.dashboards d
      where d.id = dashboard_id and d.user_id = (select auth.uid())
    )
  );

create policy dashboard_widgets_update
  on public.dashboard_widgets
  for update
  to authenticated
  using (
    user_id = (select auth.uid())
    and (select public.is_active_staff())
  )
  with check (
    user_id = (select auth.uid())
    and (select public.is_active_staff())
  );

create policy dashboard_widgets_delete
  on public.dashboard_widgets
  for delete
  to authenticated
  using (
    user_id = (select auth.uid())
    and (select public.is_active_staff())
  );

-- Dashboards sit beside Analytics: any category that already sees Analytics
-- sees Dashboards too.
update public.role_app_access
set
  visible_apps = visible_apps || '["dashboards"]'::jsonb,
  updated_at = now()
where coalesce(visible_apps, '[]'::jsonb) ? 'analytics'
  and not coalesce(visible_apps, '[]'::jsonb) ? 'dashboards';

notify pgrst, 'reload schema';
