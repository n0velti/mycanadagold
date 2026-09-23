import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { getSupabase } from './supabase';

const PRESENCE_INTERVAL_MS = 25000;
const TYPING_HOLD_MS = 1600;
const MESSAGE_LIMIT = 200;

function asString(value) {
  if (value == null) return '';
  return String(value).trim();
}

function isMissingRelation(error) {
  const code = String(error?.code || '');
  const message = String(error?.message || '');
  if (code === '42P01' || code === 'PGRST202' || code === 'PGRST205') return true;
  return /schema cache/i.test(message) && /dm_|teams|get_or_create_team_dm/i.test(message);
}

function describeError(error, action = 'load messages') {
  if (!error) return `Could not ${action}.`;
  if (isMissingRelation(error)) {
    return 'Run the Direct Messages SQL in Supabase, then refresh.';
  }
  return error.message || `Could not ${action}.`;
}

export function contactName(person) {
  if (!person) return 'Teammate';
  return (
    asString(person.fullName) ||
    [person.firstName, person.lastName].filter(Boolean).join(' ') ||
    'Teammate'
  );
}

export function initialsFromName(name) {
  const parts = asString(name).split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

const AVATAR_COLORS = ['#0A84FF', '#34C759', '#FF2D55', '#AF52DE', '#FF9500', '#5AC8FA', '#FF3B30'];

export function avatarColorForId(id) {
  const value = asString(id);
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

function mapContact(row) {
  if (!row?.id) return null;
  const fullName = asString(row.full_name || row.fullName || row.other_full_name);
  return {
    id: row.id,
    firstName: asString(row.first_name || row.firstName),
    lastName: asString(row.last_name || row.lastName),
    fullName: fullName || 'Teammate',
    avatarUrl: asString(row.avatar_url || row.avatarUrl),
    locationName: asString(row.location_name || row.locationName),
    teamId: asString(row.team_id || row.teamId),
    teamName: asString(row.team_name || row.teamName),
    isTeamIntake: Boolean(row.is_team_intake ?? row.isTeamIntake),
    lastSeenAt: row.last_seen_at || row.lastSeenAt || null,
    isOnline: Boolean(row.is_online ?? row.isOnline),
  };
}

export function conversationTitle(row) {
  if (!row) return 'Chat';
  if (row.isTeam) return asString(row.title) || asString(row.teamName) || 'Team';
  const named = asString(row.title);
  if (named) return named;
  const members = Array.isArray(row.members) ? row.members : [];
  if (row.isGroup) {
    const names = members.map(contactName).filter(Boolean);
    if (names.length === 0) return 'Group';
    if (names.length <= 3) return names.join(', ');
    return `${names.slice(0, 2).join(', ')} +${names.length - 2}`;
  }
  return contactName(row.other || members[0]);
}

function mapInboxRow(row) {
  if (!row?.conversation_id) return null;
  const members = (Array.isArray(row.members) ? row.members : [])
    .map(mapContact)
    .filter(Boolean);
  const teamId = asString(row.team_id || row.teamId);
  const isGroup = Boolean(row.is_group ?? row.isGroup) || Boolean(teamId);
  return {
    conversationId: row.conversation_id,
    isGroup,
    isTeam: Boolean(teamId),
    teamId,
    title: asString(row.title) || '',
    members,
    other: isGroup ? null : members[0] || null,
    lastMessagePreview: asString(row.last_message_preview),
    lastMessageAt: row.last_message_at || null,
    lastMessageSenderId: row.last_message_sender_id || null,
    lastMessageIsAssistant: Boolean(row.last_message_is_assistant ?? row.lastMessageIsAssistant),
    isAi: Boolean(row.is_ai ?? row.isAi),
    unreadCount: Number(row.unread_count) || 0,
    lastReadAt: row.last_read_at || null,
  };
}

function mapMessage(row, myId) {
  const likes = Array.isArray(row.dm_message_likes) ? row.dm_message_likes : [];
  return {
    id: row.id,
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    body: asString(row.body),
    createdAt: row.created_at,
    likedByMe: likes.some((like) => like.user_id === myId),
    likeCount: likes.length,
    isAssistant: Boolean(row.is_assistant),
  };
}

function throwQueryError(error, action) {
  const wrapped = new Error(describeError(error, action));
  wrapped.code = error?.code;
  throw wrapped;
}

export async function listDmContacts() {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc('list_dm_contacts');
  if (error) throwQueryError(error, 'load people');
  return (data || []).map(mapContact).filter(Boolean);
}

export async function listDmInbox() {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc('list_dm_inbox');
  if (error) throwQueryError(error, 'load conversations');
  return (data || []).map(mapInboxRow).filter(Boolean);
}

export async function fetchUnreadTotal() {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc('dm_unread_total');
  if (error) throwQueryError(error, 'load unread count');
  return Number(data) || 0;
}

export async function getOrCreateTeamDm(teamId) {
  const id = asString(teamId);
  if (!id) throw new Error('Pick a team to message.');
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc('get_or_create_team_dm', { p_team_id: id });
  if (error) throwQueryError(error, 'start a team conversation');
  return data;
}

export async function getOrCreateAiDm() {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc('get_or_create_ai_dm');
  if (error) throwQueryError(error, 'start an AI conversation');
  return data;
}

export async function getOrCreateDm(otherUserId) {
  const id = asString(otherUserId);
  if (!id) throw new Error('Pick someone to message.');
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc('get_or_create_dm', { other_user_id: id });
  if (error) throwQueryError(error, 'start a conversation');
  return data;
}

export async function createDmGroup(memberIds, title) {
  const ids = [...new Set((Array.isArray(memberIds) ? memberIds : []).map(asString).filter(Boolean))];
  if (ids.length === 0) throw new Error('Pick people to add.');
  if (ids.length === 1) return getOrCreateDm(ids[0]);
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc('create_dm_group', {
    p_member_ids: ids,
    p_title: asString(title) || null,
  });
  if (error) throwQueryError(error, 'create that group');
  return data;
}

export async function addDmGroupMembers(conversationId, memberIds) {
  const ids = [...new Set((Array.isArray(memberIds) ? memberIds : []).map(asString).filter(Boolean))];
  if (!conversationId || ids.length === 0) return;
  const supabase = getSupabase();
  const { error } = await supabase.rpc('add_dm_group_members', {
    p_conversation_id: conversationId,
    p_member_ids: ids,
  });
  if (error) throwQueryError(error, 'add people');
}

export async function renameDmGroup(conversationId, title) {
  if (!conversationId) throw new Error('Missing group.');
  const supabase = getSupabase();
  const { error } = await supabase.rpc('rename_dm_group', {
    p_conversation_id: conversationId,
    p_title: asString(title) || null,
  });
  if (error) throwQueryError(error, 'rename that group');
}

export async function leaveDmGroup(conversationId) {
  if (!conversationId) throw new Error('Missing group.');
  const supabase = getSupabase();
  const { error } = await supabase.rpc('leave_dm_group', { p_conversation_id: conversationId });
  if (error) throwQueryError(error, 'leave that group');
}

export async function listDmMessages(conversationId, myId) {
  const supabase = getSupabase();
  const base = 'id, conversation_id, sender_id, body, created_at, dm_message_likes(user_id)';
  const withRole = 'id, conversation_id, sender_id, body, created_at, is_assistant, dm_message_likes(user_id)';
  let { data, error } = await supabase
    .from('dm_messages')
    .select(`${withRole}, dm_message_hides(user_id)`)
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
    .limit(MESSAGE_LIMIT);
  if (error && /is_assistant/i.test(String(error.message || ''))) {
    ({ data, error } = await supabase
      .from('dm_messages')
      .select(`${base}, dm_message_hides(user_id)`)
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
      .limit(MESSAGE_LIMIT));
  }
  if (error && (isMissingRelation(error) || error.code === 'PGRST200')) {
    ({ data, error } = await supabase
      .from('dm_messages')
      .select(base)
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
      .limit(MESSAGE_LIMIT));
  }
  if (error) throwQueryError(error, 'load the thread');
  return (data || [])
    .filter((row) => !Array.isArray(row.dm_message_hides) || row.dm_message_hides.length === 0)
    .map((row) => mapMessage(row, myId));
}

export async function hideDmMessage(messageId) {
  if (!messageId) throw new Error('Missing message.');
  const supabase = getSupabase();
  const { error } = await supabase.rpc('hide_dm_message', { p_message_id: messageId });
  if (error) throwQueryError(error, 'delete that message');
}

export async function hideDmConversation(conversationId) {
  if (!conversationId) throw new Error('Missing chat.');
  const supabase = getSupabase();
  const { error } = await supabase.rpc('hide_dm_conversation', { p_conversation_id: conversationId });
  if (error) throwQueryError(error, 'delete that chat');
}

export async function unhideDmConversation(conversationId) {
  if (!conversationId) return;
  const supabase = getSupabase();
  const { error } = await supabase.rpc('unhide_dm_conversation', { p_conversation_id: conversationId });
  if (error) throwQueryError(error, 'open that chat');
}

export async function sendDmMessage(conversationId, body, { assistant = false } = {}) {
  const text = asString(body);
  if (!text) throw new Error('Type a message first.');
  const supabase = getSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) throw new Error('Sign in to send a message.');
  const { data, error } = await supabase
    .from('dm_messages')
    .insert({
      conversation_id: conversationId,
      sender_id: user.id,
      body: text.slice(0, 4000),
      is_assistant: Boolean(assistant),
    })
    .select('id, conversation_id, sender_id, body, created_at, is_assistant, dm_message_likes(user_id)')
    .single();
  if (error) throwQueryError(error, 'send that message');
  return mapMessage(data, user.id);
}

export async function toggleDmLike(messageId, liked) {
  const supabase = getSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) throw new Error('Sign in to like a message.');
  if (liked) {
    const { error } = await supabase
      .from('dm_message_likes')
      .delete()
      .eq('message_id', messageId)
      .eq('user_id', user.id);
    if (error) throwQueryError(error, 'remove that like');
    return false;
  }
  const { error } = await supabase.from('dm_message_likes').insert({
    message_id: messageId,
    user_id: user.id,
  });
  if (error && error.code !== '23505') throwQueryError(error, 'like that message');
  return true;
}

export async function markDmRead(conversationId) {
  const supabase = getSupabase();
  const { error } = await supabase.rpc('mark_dm_read', { p_conversation_id: conversationId });
  if (error) throwQueryError(error, 'mark as read');
}

export async function heartbeatDmPresence(online = true) {
  const supabase = getSupabase();
  const { error } = await supabase.rpc('heartbeat_dm_presence', { p_online: Boolean(online) });
  if (error) throwQueryError(error, 'update presence');
}

export function subscribeDmRealtime(handlers = {}) {
  const supabase = getSupabase();
  const channel = supabase
    .channel(`dm-live-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'dm_messages' }, (payload) => {
      handlers.onMessage?.(payload);
    })
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'dm_message_likes' },
      (payload) => {
        handlers.onLike?.(payload);
      },
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'dm_message_hides' },
      (payload) => {
        handlers.onHide?.(payload);
      },
    )
    .on('postgres_changes', { event: '*', schema: 'public', table: 'dm_presence' }, (payload) => {
      handlers.onPresence?.(payload);
    })
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'dm_conversations' },
      (payload) => {
        handlers.onConversation?.(payload);
      },
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'dm_participants' },
      (payload) => {
        handlers.onParticipant?.(payload);
      },
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

export function subscribeDmTyping(conversationId, myId, onTyping) {
  if (!conversationId) {
    return { pulse() {}, stop() {}, unsubscribe() {} };
  }
  const supabase = getSupabase();
  const channel = supabase.channel(`dm-typing-${conversationId}`, {
    config: { broadcast: { self: false } },
  });
  channel.on('broadcast', { event: 'typing' }, ({ payload }) => {
    if (!payload || payload.userId === myId) return;
    onTyping?.(payload);
  });
  channel.subscribe();

  let holdTimer = null;
  const send = (typing, name) => {
    channel.send({
      type: 'broadcast',
      event: 'typing',
      payload: { userId: myId, typing: Boolean(typing), name: asString(name) },
    });
  };

  return {
    pulse(name) {
      send(true, name);
      if (holdTimer) clearTimeout(holdTimer);
      holdTimer = setTimeout(() => send(false, name), TYPING_HOLD_MS);
    },
    stop(name) {
      if (holdTimer) clearTimeout(holdTimer);
      holdTimer = null;
      send(false, name);
    },
    unsubscribe() {
      if (holdTimer) clearTimeout(holdTimer);
      send(false);
      supabase.removeChannel(channel);
    },
  };
}

export function formatLastSeen(isOnline, lastSeenAt, now = Date.now()) {
  if (isOnline) return 'Active now';
  if (!lastSeenAt) return 'Last seen recently';
  const then = new Date(lastSeenAt).getTime();
  if (!Number.isFinite(then)) return 'Last seen recently';
  const delta = Math.max(0, now - then);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (delta < 45 * 1000) return 'Last seen just now';
  if (delta < 50 * minute) {
    const mins = Math.max(1, Math.round(delta / minute));
    return `Last seen ${mins}m ago`;
  }
  if (delta < 22 * hour) {
    const hours = Math.max(1, Math.round(delta / hour));
    return `Last seen ${hours}h ago`;
  }
  if (delta < 6 * day) {
    const days = Math.max(1, Math.round(delta / day));
    return `Last seen ${days}d ago`;
  }
  return `Last seen ${new Date(lastSeenAt).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })}`;
}

export async function saveAiDmChat(title, turns) {
  const payload = (Array.isArray(turns) ? turns : [])
    .filter((turn) => turn?.role === 'user' || turn?.role === 'assistant')
    .map((turn) => ({
      role: turn.role,
      content: asString(turn.content).slice(0, 4000),
    }))
    .filter((turn) => turn.content);
  if (!payload.some((turn) => turn.role === 'user')) {
    throw new Error('Nothing to save.');
  }
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc('save_ai_dm_chat', {
    p_title: asString(title).slice(0, 80) || null,
    p_turns: payload,
  });
  if (error) throwQueryError(error, 'save this chat');
  return data;
}

export function conversationSubtitle(row, { typingLabel } = {}) {
  if (typingLabel) return typingLabel;
  if (!row) return '';
  if (row.isAi) return 'MyCanadaGold AI';
  if (row.isTeam) {
    const members = Array.isArray(row.members) ? row.members : [];
    const intake = members
      .filter((person) => person.isTeamIntake && (!row.teamId || person.teamId === row.teamId))
      .map(contactName)
      .filter(Boolean);
    const count = members.length + 1;
    if (intake.length) {
      const shown = intake.length <= 2 ? intake.join(', ') : `${intake.slice(0, 2).join(', ')} +${intake.length - 2}`;
      return `Team · Intake ${shown}`;
    }
    return `Team · ${count} people`;
  }
  if (row.isGroup) {
    const members = Array.isArray(row.members) ? row.members : [];
    const online = members.filter((person) => person.isOnline).length;
    const count = members.length + 1;
    if (online > 0) {
      return `${online} active · ${count} people`;
    }
    return `${count} people`;
  }
  const other = row.other || row.members?.[0];
  return formatLastSeen(other?.isOnline, other?.lastSeenAt);
}

export function formatInboxTime(value, now = new Date()) {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (sameDay) {
    return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (
    date.getFullYear() === yesterday.getFullYear() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getDate() === yesterday.getDate()
  ) {
    return 'Yesterday';
  }
  const weekAgo = now.getTime() - 6 * 24 * 60 * 60 * 1000;
  if (date.getTime() > weekAgo) {
    return date.toLocaleDateString(undefined, { weekday: 'short' });
  }
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function formatThreadStamp(value) {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (sameDay) return time;
  return `${date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} ${time}`;
}

export function shouldShowStamp(previous, current) {
  if (!current?.createdAt) return false;
  if (!previous?.createdAt) return true;
  const gap = new Date(current.createdAt).getTime() - new Date(previous.createdAt).getTime();
  return gap > 5 * 60 * 1000;
}

export function useDirectMessages(session, { enabled = true } = {}) {
  const [unread, setUnread] = useState(0);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const refreshUnread = useCallback(async () => {
    if (!enabledRef.current) return;
    try {
      const total = await fetchUnreadTotal();
      if (enabledRef.current) setUnread(total);
    } catch {
      // Presence/unread must never block the rest of the app.
    }
  }, []);

  useEffect(() => {
    if (!enabled || !session?.supabaseUserId) {
      setUnread(0);
      return undefined;
    }

    let cancelled = false;
    let refreshTimer = null;

    const scheduleRefresh = () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        refreshTimer = null;
        if (!cancelled) refreshUnread();
      }, 120);
    };

    const beat = async (online = true) => {
      try {
        await heartbeatDmPresence(online);
      } catch {
        // Ignore until the migration is applied.
      }
      if (!cancelled) await refreshUnread();
    };

    beat(true);
    const interval = setInterval(() => beat(true), PRESENCE_INTERVAL_MS);
    const unsubscribe = subscribeDmRealtime({
      onMessage: (payload) => {
        const senderId = payload?.new?.sender_id;
        if (payload?.eventType === 'INSERT' && senderId && senderId !== session.supabaseUserId) {
          setUnread((current) => current + 1);
        }
        scheduleRefresh();
      },
      onConversation: scheduleRefresh,
      onParticipant: scheduleRefresh,
    });

    const onAppState = (state) => {
      beat(state === 'active');
    };
    const appSub = AppState.addEventListener('change', onAppState);

    const onVisibility = () => {
      if (typeof document === 'undefined') return;
      beat(document.visibilityState === 'visible');
    };
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibility);
    }

    return () => {
      cancelled = true;
      if (refreshTimer) clearTimeout(refreshTimer);
      clearInterval(interval);
      unsubscribe();
      appSub.remove();
      if (Platform.OS === 'web' && typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibility);
      }
      heartbeatDmPresence(false).catch(() => {});
    };
  }, [enabled, session?.supabaseUserId, refreshUnread]);

  return { unread, refreshUnread };
}
