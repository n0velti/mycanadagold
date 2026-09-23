-- One standing MyCanadaGold AI conversation per person. Talk to AI reopens it,
-- and later messages in any AI chat are stored on that thread.

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

  select c.id into conv_id
  from public.dm_conversations c
  join public.dm_participants p
    on p.conversation_id = c.id
   and p.user_id = me
  where c.is_ai
    and c.created_by = me
    and c.title = 'MyCanadaGold AI'
  order by c.created_at desc
  limit 1;

  if conv_id is not null then
    return conv_id;
  end if;

  insert into public.dm_conversations (is_group, is_ai, title, created_by)
  values (true, true, 'MyCanadaGold AI', me)
  returning id into conv_id;

  insert into public.dm_participants (conversation_id, user_id, last_read_at)
  values (conv_id, me, now());

  return conv_id;
end;
$$;

revoke all on function public.get_or_create_ai_dm() from public, anon;
grant execute on function public.get_or_create_ai_dm() to authenticated;
