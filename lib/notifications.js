import { useCallback, useEffect, useRef, useState } from 'react';
import { getSupabase } from './supabase';

function asString(value) {
  return value == null ? '' : String(value).trim();
}

function mapNotification(row) {
  if (!row?.id) return null;
  return {
    id: row.id,
    userId: row.user_id,
    actorId: row.actor_id || '',
    conversationId: row.conversation_id || '',
    kind: asString(row.kind) || 'added_to_chat',
    title: asString(row.title) || 'Notification',
    body: asString(row.body),
    readAt: row.read_at || null,
    createdAt: row.created_at || null,
  };
}

export function notificationBadgeText(count) {
  const n = Number(count) || 0;
  if (n <= 0) return '';
  if (n > 99) return '99+';
  return String(n);
}

export async function fetchNotificationUnread() {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc('staff_notification_unread_count');
  if (error) throw error;
  return Number(data) || 0;
}

export async function listStaffNotifications() {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('staff_notifications')
    .select('id, user_id, actor_id, conversation_id, kind, title, body, read_at, created_at')
    .order('created_at', { ascending: false })
    .limit(40);
  if (error) throw error;
  return (data || []).map(mapNotification).filter(Boolean);
}

export async function markStaffNotificationsRead(conversationId) {
  const supabase = getSupabase();
  const { error } = await supabase.rpc('mark_staff_notifications_read', {
    p_conversation_id: conversationId || null,
  });
  if (error) throw error;
}

export function subscribeStaffNotifications(onChange) {
  const supabase = getSupabase();
  const channel = supabase
    .channel(`staff-notifications-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'staff_notifications' },
      () => {
        onChange?.();
      },
    )
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}

export function useStaffNotifications(session, { enabled = true } = {}) {
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState([]);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const refresh = useCallback(async () => {
    if (!enabledRef.current) return;
    try {
      const [count, rows] = await Promise.all([
        fetchNotificationUnread(),
        listStaffNotifications(),
      ]);
      if (!enabledRef.current) return;
      setUnread(count);
      setItems(rows);
    } catch {
      // Table is not on the live project until this migration is applied.
    }
  }, []);

  const markRead = useCallback(async (conversationId) => {
    try {
      await markStaffNotificationsRead(conversationId);
    } catch {
      return;
    }
    await refresh();
  }, [refresh]);

  useEffect(() => {
    if (!enabled || !session?.supabaseUserId) {
      setUnread(0);
      setItems([]);
      return undefined;
    }

    let cancelled = false;
    let refreshTimer = null;
    const scheduleRefresh = () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        refreshTimer = null;
        if (!cancelled) refresh();
      }, 120);
    };

    refresh();
    const unsubscribe = subscribeStaffNotifications(scheduleRefresh);

    return () => {
      cancelled = true;
      if (refreshTimer) clearTimeout(refreshTimer);
      unsubscribe();
    };
  }, [enabled, session?.supabaseUserId, refresh]);

  return { unread, items, refresh, markRead };
}
