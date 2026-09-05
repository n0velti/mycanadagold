-- Grant the Pricing app to every role that already has a visibility list.
update public.role_app_access
set
  visible_apps = visible_apps || '["pricing"]'::jsonb,
  updated_at = now()
where not coalesce(visible_apps, '[]'::jsonb) ? 'pricing';
