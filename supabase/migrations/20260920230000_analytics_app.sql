-- Analytics app: grant visibility so role lists pick up the new catalog key.

update public.role_app_access
set
  visible_apps = visible_apps || '["analytics"]'::jsonb,
  updated_at = now()
where not coalesce(visible_apps, '[]'::jsonb) ? 'analytics';
