-- Each RingCentral DID belongs to one store. Live calls, call log, and
-- voicemail are scoped to these numbers so a company-wide presence poll
-- cannot clone one inbound session onto Montreal, Laval, and Quebec.

alter table public.ringcentral_accounts
  add column if not exists phone_numbers jsonb not null default '[]'::jsonb;

grant select (
  id, store_key, store_name, server_url, account_id, company_name, main_number,
  phone_numbers, extension_count, last_status, last_error, last_checked_at,
  created_at, updated_at, updated_by, has_client_id, has_secret, has_jwt
) on public.ringcentral_accounts to authenticated;

notify pgrst, 'reload schema';
