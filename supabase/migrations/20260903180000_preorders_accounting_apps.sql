-- Add Preorders and Accounting to stored role catalogs without rewriting
-- lists that an admin has already customized.

update public.role_app_access
set visible_apps = visible_apps || '["preorders"]'::jsonb,
    updated_at = now()
where role in (
    'precious_metal_analyst',
    'branch_manager',
    'general_manager',
    'system_admin'
  )
  and not visible_apps @> '["preorders"]'::jsonb;

update public.role_app_access
set visible_apps = visible_apps || '["accounting"]'::jsonb,
    updated_at = now()
where role in (
    'branch_manager',
    'general_manager',
    'system_admin'
  )
  and not visible_apps @> '["accounting"]'::jsonb;
