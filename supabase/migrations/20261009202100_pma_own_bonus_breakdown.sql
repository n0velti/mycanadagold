-- PMAs can open Bonuses to see their own payout. Other employees stay hidden
-- in the app (canViewAllBonusCounts is false for precious_metal_analyst).

update public.role_app_access
set
  visible_apps = visible_apps || '["bonuses"]'::jsonb,
  updated_at = now()
where role = 'precious_metal_analyst'
  and not coalesce(visible_apps, '[]'::jsonb) ? 'bonuses';

update public.user_app_access u
set
  visible_apps = u.visible_apps || '["bonuses"]'::jsonb,
  updated_at = now()
from public.profiles p
where u.user_id = p.id
  and p.app_role = 'precious_metal_analyst'
  and not coalesce(u.visible_apps, '[]'::jsonb) ? 'bonuses';

notify pgrst, 'reload schema';
