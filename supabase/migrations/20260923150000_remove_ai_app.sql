-- The standalone MyCanadaGold AI app is gone. Conversations live in Direct Messages.

update public.role_app_access
set
  visible_apps = coalesce(visible_apps, '[]'::jsonb) - 'ai',
  updated_at = now()
where coalesce(visible_apps, '[]'::jsonb) ? 'ai';

update public.user_app_access
set
  visible_apps = coalesce(visible_apps, '[]'::jsonb) - 'ai',
  filterable_apps = coalesce(filterable_apps, '[]'::jsonb) - 'ai',
  updated_at = now()
where coalesce(visible_apps, '[]'::jsonb) ? 'ai'
   or coalesce(filterable_apps, '[]'::jsonb) ? 'ai';

update public.profiles
set
  pinned_tools = pinned_tools - 'ai',
  updated_at = now()
where pinned_tools is not null
  and jsonb_typeof(pinned_tools) = 'array'
  and pinned_tools ? 'ai';
