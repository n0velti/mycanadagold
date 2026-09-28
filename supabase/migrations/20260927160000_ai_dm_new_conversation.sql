-- Talk to AI starts a fresh chat every time. Topic titles are applied from the
-- app after the first exchange, so this only opens a new empty thread.

create or replace function public.get_or_create_ai_dm()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  conv_id uuid;
begin
  if not public.is_active_staff() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  insert into public.dm_conversations (is_group, is_ai, title, created_by)
  values (true, true, 'New AI chat', me)
  returning id into conv_id;

  insert into public.dm_participants (conversation_id, user_id, last_read_at)
  values (conv_id, me, now());

  return conv_id;
end;
$$;

revoke all on function public.get_or_create_ai_dm() from public, anon;
grant execute on function public.get_or_create_ai_dm() to authenticated;
