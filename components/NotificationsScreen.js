import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  listStaffNotifications,
  markAllStaffNotificationsRead,
  markStaffNotificationRead,
} from '../lib/notifications';
import { CANVAS, useIsMobile } from '../lib/mobileUi';
import { mobileTabBarReserve } from '../lib/mobileTabBar';

const LABEL = '#1a1a1a';
const SECONDARY = '#8e8e93';
const SEPARATOR = '#d0d0d0';
const ORANGE = '#C2410C';

function whenLabel(value) {
  if (!value) return '';
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return '';
  return new Date(time).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function NotificationRow({ item, last, onPress }) {
  const kind = item.payload?.docKind === 'sale' ? 'Sale' : 'Purchase';
  return (
    <Pressable
      onPress={() => onPress(item)}
      style={({ pressed }) => [styles.row, last && styles.rowLast, pressed && styles.rowPressed]}
      accessibilityRole="button"
      accessibilityLabel={item.title}
    >
      <View style={[styles.dot, item.unread ? styles.dotOn : styles.dotOff]} />
      <View style={styles.rowBody}>
        <Text style={[styles.title, item.unread && styles.titleUnread]}>{item.title}</Text>
        {item.body ? (
          <Text style={styles.body} numberOfLines={3}>
            {item.body}
          </Text>
        ) : null}
        <Text style={styles.meta} numberOfLines={1}>
          {[item.storeName, kind, whenLabel(item.createdAt)].filter(Boolean).join(' · ')}
        </Text>
      </View>
    </Pressable>
  );
}

export default function NotificationsScreen({ onOpenTriage, onRefreshUnread }) {
  const isMobile = useIsMobile();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const rows = await listStaffNotifications();
      setItems(rows);
    } catch (err) {
      setError(err?.message || 'Could not load notifications.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openItem = useCallback(
    async (item) => {
      try {
        if (item.unread) await markStaffNotificationRead(item.id);
      } catch {
        // Keep the list usable if mark-read is not applied yet.
      }
      setItems((current) =>
        current.map((row) => (row.id === item.id ? { ...row, unread: false, readAt: row.readAt || new Date().toISOString() } : row)),
      );
      onRefreshUnread?.();
      onOpenTriage?.(item.storeName);
    },
    [onOpenTriage, onRefreshUnread],
  );

  const markAll = useCallback(async () => {
    try {
      await markAllStaffNotificationsRead();
      setItems((current) => current.map((row) => ({ ...row, unread: false, readAt: row.readAt || new Date().toISOString() })));
      onRefreshUnread?.();
    } catch (err) {
      setError(err?.message || 'Could not mark notifications read.');
    }
  }, [onRefreshUnread]);

  const unread = items.filter((item) => item.unread).length;

  return (
    <View style={[styles.page, isMobile && styles.pageMobile]}>
      <View style={styles.head}>
        <Text style={styles.headCopy}>
          {unread ? `${unread} new` : items.length ? 'All caught up' : 'No notifications yet'}
        </Text>
        {unread ? (
          <Pressable onPress={markAll} hitSlop={8} accessibilityRole="button" accessibilityLabel="Mark all as read">
            <Text style={styles.headAction}>Mark all read</Text>
          </Pressable>
        ) : null}
      </View>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: mobileTabBarReserve() + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        {loading && items.length === 0 ? (
          <Text style={styles.empty}>Loading notifications…</Text>
        ) : error ? (
          <Pressable onPress={load}>
            <Text style={styles.empty}>{error} · Tap to retry</Text>
          </Pressable>
        ) : items.length === 0 ? (
          <View style={styles.emptyBlock}>
            <Ionicons name="notifications-outline" size={28} color={SECONDARY} />
            <Text style={styles.empty}>
              When triage marks a purchase or sale incorrect, the branch manager for that store is notified here.
            </Text>
          </View>
        ) : (
          items.map((item, index) => (
            <NotificationRow
              key={item.id}
              item={item}
              last={index === items.length - 1}
              onPress={openItem}
            />
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: CANVAS,
  },
  pageMobile: {
    paddingTop: 4,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  headCopy: {
    fontSize: 13,
    color: SECONDARY,
  },
  headAction: {
    fontSize: 13,
    color: ORANGE,
    fontWeight: '600',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 8,
  },
  row: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: SEPARATOR,
  },
  rowLast: {
    borderBottomWidth: 0,
  },
  rowPressed: {
    backgroundColor: 'rgba(0,0,0,0.04)',
  },
  rowBody: {
    flex: 1,
    gap: 3,
    minWidth: 0,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 6,
  },
  dotOn: {
    backgroundColor: ORANGE,
  },
  dotOff: {
    backgroundColor: 'transparent',
  },
  title: {
    fontSize: 15,
    color: LABEL,
  },
  titleUnread: {
    fontWeight: '600',
  },
  body: {
    fontSize: 13,
    color: LABEL,
  },
  meta: {
    fontSize: 12,
    color: SECONDARY,
  },
  emptyBlock: {
    alignItems: 'flex-start',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 28,
  },
  empty: {
    fontSize: 14,
    color: SECONDARY,
    lineHeight: 20,
  },
});
