import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { getSupabase } from './supabase';

function asString(value) {
  if (value == null) return '';
  return String(value).trim();
}

function isMissingNotifications(error) {
  const code = asString(error?.code);
  const message = asString(error?.message);
  if (code === '42P01' || code === 'PGRST205') return true;
  return /schema cache/i.test(message) && /staff_notifications/i.test(message);
}

export function mapStaffNotification(row) {
  if (!row) return null;
  const payload = row.payload && typeof row.payload === 'object' ? row.payload : {};
  return {
    id: asString(row.id),
    storeName: asString(row.store_name),
    storeKey: asString(row.store_key),
    kind: asString(row.kind) || 'triage_incorrect',
    title: asString(row.title) || 'Triage error',
    body: asString(row.body),
    sourceId: asString(row.source_id),
    readAt: row.read_at || null,
    createdAt: row.created_at || null,
    unread: !row.read_at,
    payload,
  };
}

export async function listStaffNotifications() {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('staff_notifications')
      .select('id, store_name, store_key, kind, title, body, payload, source_id, read_at, created_at')
      .order('created_at', { ascending: false })
      .limit(80);
    if (error) {
      if (isMissingNotifications(error)) return [];
      throw error;
    }
    return (data || []).map(mapStaffNotification).filter(Boolean);
  } catch (error) {
    if (isMissingNotifications(error)) return [];
    throw error;
  }
}

export async function countUnreadStaffNotifications() {
  try {
    const supabase = getSupabase();
    const { count, error } = await supabase
      .from('staff_notifications')
      .select('id', { count: 'exact', head: true })
      .is('read_at', null);
    if (error) {
      if (isMissingNotifications(error)) return 0;
      throw error;
    }
    return Number(count) || 0;
  } catch (error) {
    if (isMissingNotifications(error)) return 0;
    throw error;
  }
}

export async function markStaffNotificationRead(id) {
  const key = asString(id);
  if (!key) return;
  const supabase = getSupabase();
  const { error } = await supabase
    .from('staff_notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', key)
    .is('read_at', null);
  if (error && !isMissingNotifications(error)) throw error;
}

export async function markAllStaffNotificationsRead() {
  const supabase = getSupabase();
  const { error } = await supabase
    .from('staff_notifications')
    .update({ read_at: new Date().toISOString() })
    .is('read_at', null);
  if (error && !isMissingNotifications(error)) throw error;
}

export function subscribeStaffNotifications(userId, onChange) {
  const id = asString(userId);
  if (!id) return () => {};
  try {
    const supabase = getSupabase();
    const channel = supabase
      .channel(`staff-notifications:${id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'staff_notifications', filter: `recipient_id=eq.${id}` },
        () => onChange?.(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  } catch {
    return () => {};
  }
}

export function useStaffNotifications(session, { enabled = true } = {}) {
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState([]);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const refresh = useCallback(async () => {
    if (!enabledRef.current) return;
    try {
      const [rows, total] = await Promise.all([listStaffNotifications(), countUnreadStaffNotifications()]);
      if (!enabledRef.current) return;
      setItems(rows);
      setUnread(total);
    } catch {
      // Missing table until the migration is applied.
    }
  }, []);

  useEffect(() => {
    if (!enabled || !session?.supabaseUserId) {
      setUnread(0);
      setItems([]);
      return undefined;
    }
    let cancelled = false;
    let timer = null;
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        if (!cancelled) refresh();
      }, 120);
    };
    refresh();
    const unsubscribe = subscribeStaffNotifications(session.supabaseUserId, schedule);
    const onApp = (state) => {
      if (state === 'active') schedule();
    };
    const appSub = AppState.addEventListener('change', onApp);
    const onVisibility = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') schedule();
    };
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibility);
    }
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      unsubscribe();
      appSub.remove();
      if (Platform.OS === 'web' && typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibility);
      }
    };
  }, [enabled, refresh, session?.supabaseUserId]);

  return { unread, items, refresh };
}
