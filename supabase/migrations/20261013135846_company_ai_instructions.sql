-- Extra instructions a System Admin or General Manager writes in Settings → AI models.
-- Any active staff member can read them, because the app sends them with the
-- question. Only those managers can change them.

create table if not exists public.company_ai_instructions (
  assistant text primary key
    check (assistant in ('analytics', 'chat')),
  instructions text not null default '',
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id),
  check (char_length(instructions) <= 4000)
);

insert into public.company_ai_instructions (assistant, instructions)
values
  ('analytics', ''),
  ('chat', '')
on conflict (assistant) do nothing;

alter table public.company_ai_instructions enable row level security;
alter table public.company_ai_instructions force row level security;

revoke all on public.company_ai_instructions from public, anon;
grant select, insert, update on table public.company_ai_instructions
  to authenticated, service_role;

drop policy if exists company_ai_instructions_select on public.company_ai_instructions;
drop policy if exists company_ai_instructions_insert on public.company_ai_instructions;
drop policy if exists company_ai_instructions_update on public.company_ai_instructions;

create policy company_ai_instructions_select
  on public.company_ai_instructions
  for select
  to authenticated
  using ((select public.is_active_staff()));

create policy company_ai_instructions_insert
  on public.company_ai_instructions
  for insert
  to authenticated
  with check ((select public.current_user_can_manage_company_ai_keys()));

create policy company_ai_instructions_update
  on public.company_ai_instructions
  for update
  to authenticated
  using ((select public.current_user_can_manage_company_ai_keys()))
  with check ((select public.current_user_can_manage_company_ai_keys()));

notify pgrst, 'reload schema';
