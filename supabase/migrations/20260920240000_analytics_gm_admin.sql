-- Analytics is only for general managers and system admins.

update public.role_app_access
set
  visible_apps = coalesce(visible_apps, '[]'::jsonb) - 'analytics',
  updated_at = now()
where role not in ('general_manager', 'system_admin')
  and coalesce(visible_apps, '[]'::jsonb) ? 'analytics';

update public.role_app_access
set
  visible_apps = visible_apps || '["analytics"]'::jsonb,
  updated_at = now()
where role in ('general_manager', 'system_admin')
  and not coalesce(visible_apps, '[]'::jsonb) ? 'analytics';

update public.user_app_access u
set
  visible_apps = coalesce(u.visible_apps, '[]'::jsonb) - 'analytics',
  filterable_apps = coalesce(u.filterable_apps, '[]'::jsonb) - 'analytics',
  updated_at = now()
from public.profiles p
where u.user_id = p.id
  and p.app_role not in ('general_manager', 'system_admin')
  and not coalesce(p.is_system_admin, false)
  and (
    coalesce(u.visible_apps, '[]'::jsonb) ? 'analytics'
    or coalesce(u.filterable_apps, '[]'::jsonb) ? 'analytics'
  );
