-- Granular screen permissions ("rules") written by Settings → Permissions,
-- usually through the permissions assistant. A rule hides or shows one named
-- part of a screen (lib/permissionRules.js PERMISSION_FEATURES, e.g.
-- home.amounts = dollar totals on Home) for a role, one person, or everyone,
-- optionally only for people allocated to certain stores
-- ("Branch Managers at Quebec can't see revenue on Home").
--
-- Rules sit on top of role_app_access / user_app_access: they never grant an
-- app, they only trim what a screen the person can already open displays.
-- System Admins are never affected (resolved in the client).

create table if not exists public.permission_rules (
  id uuid primary key default gen_random_uuid(),
  target_kind text not null check (target_kind in ('role', 'user', 'everyone')),
  role text
    check (
      role is null
      or role in ('precious_metal_analyst', 'triage', 'hr', 'branch_manager', 'general_manager')
    ),
  user_id uuid references public.profiles (id) on delete cascade,
  stores jsonb not null default '[]'::jsonb,
  feature text not null check (char_length(feature) between 3 and 80),
  effect text not null check (effect in ('hide', 'show')),
  note text not null default '',
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id),
  check (jsonb_typeof(stores) = 'array'),
  check (char_length(note) <= 400),
  check (
    (target_kind = 'role' and role is not null and user_id is null)
    or (target_kind = 'user' and user_id is not null and role is null)
    or (target_kind = 'everyone' and role is null and user_id is null)
  )
);

create index if not exists permission_rules_role_idx
  on public.permission_rules (target_kind, role);
create index if not exists permission_rules_user_idx
  on public.permission_rules (user_id);
create index if not exists permission_rules_updated_at_idx
  on public.permission_rules (updated_at desc);

alter table public.permission_rules enable row level security;
alter table public.permission_rules force row level security;

revoke all on public.permission_rules from public, anon;
grant select, insert, update, delete on public.permission_rules to authenticated;

drop policy if exists permission_rules_select on public.permission_rules;
drop policy if exists permission_rules_insert on public.permission_rules;
drop policy if exists permission_rules_update on public.permission_rules;
drop policy if exists permission_rules_delete on public.permission_rules;

-- Everyone reads the role / everyone rules (the app resolves its own screen
-- from them) and their own person rules; admins read every rule.
create policy permission_rules_select
  on public.permission_rules
  for select
  to authenticated
  using (
    (select public.is_active_staff())
    and (
      target_kind <> 'user'
      or user_id = (select auth.uid())
      or (select public.current_user_is_system_admin())
    )
  );

create policy permission_rules_insert
  on public.permission_rules
  for insert
  to authenticated
  with check ((select public.current_user_is_system_admin()));

create policy permission_rules_update
  on public.permission_rules
  for update
  to authenticated
  using ((select public.current_user_is_system_admin()))
  with check ((select public.current_user_is_system_admin()));

create policy permission_rules_delete
  on public.permission_rules
  for delete
  to authenticated
  using ((select public.current_user_is_system_admin()));

notify pgrst, 'reload schema';
