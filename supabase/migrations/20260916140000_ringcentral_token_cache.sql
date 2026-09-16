-- Persist RingCentral OAuth tokens and a short-lived presence snapshot.
-- JWT token minting is tightly rate-limited ("Request rate exceeded"); reuse
-- access/refresh tokens across Edge Function isolates instead of minting on
-- every phone poll.

alter table public.ringcentral_accounts
  add column if not exists access_token text not null default '';
alter table public.ringcentral_accounts
  add column if not exists refresh_token text not null default '';
alter table public.ringcentral_accounts
  add column if not exists token_expires_at timestamptz;
alter table public.ringcentral_accounts
  add column if not exists live_calls jsonb not null default '[]'::jsonb;
alter table public.ringcentral_accounts
  add column if not exists live_calls_at timestamptz;

revoke select (access_token, refresh_token, token_expires_at, live_calls, live_calls_at)
  on public.ringcentral_accounts from authenticated;
revoke update (access_token, refresh_token, token_expires_at, live_calls, live_calls_at)
  on public.ringcentral_accounts from authenticated;

notify pgrst, 'reload schema';
