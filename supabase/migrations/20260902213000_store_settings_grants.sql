-- Re-apply API grants and refresh PostgREST after the store_settings table exists.
-- Safe to run even if 20260902210000 already ran.

grant select, insert, update on table public.store_settings to authenticated, service_role;

notify pgrst, 'reload schema';
