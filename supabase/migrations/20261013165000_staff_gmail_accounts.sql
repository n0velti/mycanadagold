-- Google inboxes connected in the Emails app. One row per (staff member, mailbox).
--
-- The refresh token lives here, not in the browser, so an inbox stays connected
-- across logins and devices and the proxy can read it for the person who
-- connected it. Nothing here is readable by clients: only the `proxy` Edge
-- Function (service role) touches this table, and it always filters by the
-- signed-in user's id. That is the privacy boundary — Tom's session can never
-- reach a mailbox Julie connected, even with her address.
--
-- Disconnecting blanks the tokens and stamps disconnected_at; rows are not deleted.

create table if not exists public.staff_gmail_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  email text not null,
  display_name text not null default '',
  picture_url text not null default '',
  refresh_token text not null default '',
  access_token text not null default '',
  token_expires_at timestamptz,
  granted_scope text not null default '',
  connected_at timestamptz not null default now(),
  last_used_at timestamptz,
  disconnected_at timestamptz,
  last_error text not null default '',
  updated_at timestamptz not null default now(),
  constraint staff_gmail_accounts_user_email unique (user_id, email),
  constraint staff_gmail_accounts_email_len check (char_length(email) <= 320),
  constraint staff_gmail_accounts_name_len check (char_length(display_name) <= 200),
  constraint staff_gmail_accounts_picture_len check (char_length(picture_url) <= 2000),
  constraint staff_gmail_accounts_refresh_len check (char_length(refresh_token) <= 4096),
  constraint staff_gmail_accounts_access_len check (char_length(access_token) <= 4096),
  constraint staff_gmail_accounts_scope_len check (char_length(granted_scope) <= 2000),
  constraint staff_gmail_accounts_error_len check (char_length(last_error) <= 2000)
);

create index if not exists staff_gmail_accounts_user_idx
  on public.staff_gmail_accounts (user_id)
  where disconnected_at is null;

alter table public.staff_gmail_accounts enable row level security;
alter table public.staff_gmail_accounts force row level security;
revoke all on public.staff_gmail_accounts from public, anon, authenticated;
grant select, insert, update on table public.staff_gmail_accounts to service_role;

notify pgrst, 'reload schema';
