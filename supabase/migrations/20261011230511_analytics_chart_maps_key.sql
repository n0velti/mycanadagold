-- Analytics maps run in the browser, so signed-in staff need the Google Maps
-- JavaScript key. AI provider keys stay readable only by a System Admin or
-- General Manager. Restrict the Maps key by HTTP referrer in Google Cloud.

do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'company_ai_keys'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%provider%'
  loop
    execute format('alter table public.company_ai_keys drop constraint %I', constraint_name);
  end loop;
end $$;

alter table public.company_ai_keys
  add constraint company_ai_keys_provider_check
  check (provider in ('openai', 'anthropic', 'openrouter', 'google_maps'));

create or replace function public.google_maps_browser_key()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when (select public.is_active_staff()) then (
      select k.api_key
      from public.company_ai_keys k
      where k.provider = 'google_maps'
    )
    else null
  end;
$$;

revoke all on function public.google_maps_browser_key() from public, anon;
grant execute on function public.google_maps_browser_key() to authenticated, service_role;
