-- System Admin–only Cursor cloud-agent model for staff tickets.
-- The proxy reads this before falling back to the CURSOR_AGENT_MODEL secret.

create table if not exists public.company_cursor_settings (
  id smallint primary key default 1 check (id = 1),
  agent_model text not null default '',
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id),
  check (char_length(agent_model) <= 80)
);

insert into public.company_cursor_settings (id, agent_model)
values (1, '')
on conflict (id) do nothing;

alter table public.company_cursor_settings enable row level security;
alter table public.company_cursor_settings force row level security;

revoke all on public.company_cursor_settings from public, anon;
grant select, insert, update on table public.company_cursor_settings
  to authenticated, service_role;

drop policy if exists company_cursor_settings_select on public.company_cursor_settings;
drop policy if exists company_cursor_settings_write on public.company_cursor_settings;

create policy company_cursor_settings_select
  on public.company_cursor_settings
  for select
  to authenticated
  using ((select public.current_user_is_system_admin()));

create policy company_cursor_settings_write
  on public.company_cursor_settings
  for all
  to authenticated
  using ((select public.current_user_is_system_admin()))
  with check ((select public.current_user_is_system_admin()));

notify pgrst, 'reload schema';
