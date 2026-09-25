/**
 * Deleted tab: archived date batches, Quick Add POs, and individual PO / SO
 * lines. Restore puts them back on the dashboard without recreating a live row
 * from a stale sync.
 */
import { useCallback, useMemo } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  batchStats,
  flattenBatchPos,
  persistTransferWorkflowNow,
  purgeTriageDeleted,
  restoreTriageDeleted,
  useTransferWorkflow,
} from '../lib/transferWorkflow';
import { confirmDestructive, EmptyState, FONT, Group, MobileListRow, T } from './TriageKit';
import { useIsMobile } from '../lib/mobileUi';
import { docNoun, PoThumb } from './TriageTable';

const webCursor = Platform.select({ web: { cursor: 'pointer' }, default: {} });

function formatDeletedAt(iso) {
  const time = Date.parse(iso || '');
  if (!Number.isFinite(time)) return '';
  return new Date(time).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function DeletedRow({ title, subtitle, meta, thumb, last, onRestore, onPurge }) {
  const isMobile = useIsMobile();
  if (isMobile) {
    return (
      <MobileListRow
        title={title}
        subtitle={subtitle}
        meta={meta}
        last={last}
        leading={thumb}
        trailing={
          <View style={styles.actionsMobile}>
            <Pressable style={styles.action} onPress={onRestore} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Restore ${title}`}>
              <Text style={styles.restoreText}>Restore</Text>
            </Pressable>
            <Pressable style={styles.action} onPress={onPurge} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Delete ${title}`}>
              <Text style={styles.purgeText}>Delete</Text>
            </Pressable>
          </View>
        }
      />
    );
  }
  return (
    <View style={[styles.row, isMobile && styles.rowMobile, last && styles.rowLast]}>
      <View style={styles.rowMain}>
        {thumb}
        <View style={styles.rowText}>
          <Text style={styles.rowTitle} numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? (
            <Text style={styles.rowSub} numberOfLines={isMobile ? 2 : 1}>
              {subtitle}
            </Text>
          ) : null}
          {meta ? (
            <Text style={styles.rowMeta} numberOfLines={1}>
              {meta}
            </Text>
          ) : null}
        </View>
      </View>
      <View style={[styles.actions, isMobile && styles.actionsMobile]}>
        <Pressable
          style={styles.action}
          onPress={onRestore}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`Restore ${title}`}
        >
          <Text style={styles.restoreText}>Restore</Text>
        </Pressable>
        <Pressable
          style={styles.action}
          onPress={onPurge}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`Fully delete ${title}`}
        >
          <Text style={styles.purgeText}>{isMobile ? 'Delete' : 'Fully delete'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function deletedRowProps(entry) {
  if (entry.kind === 'doc') {
    const item = entry.item;
    return {
      thumb: <PoThumb urls={item?.imageUrls} label={item?.reference} size={52} />,
      title: item?.reference || 'Document',
      subtitle: [item?.storeName || entry.storeName, entry.sourceDateLabel, item?.customerName]
        .filter(Boolean)
        .join(' · '),
    };
  }
  if (entry.kind === 'po') {
    const item = flattenBatchPos(entry.payload)[0];
    return {
      thumb: <PoThumb urls={item?.imageUrls} label={item?.reference} size={52} />,
      title: item?.reference || 'PO',
      subtitle: [item?.storeName, item?.dateLabel, item?.customerName].filter(Boolean).join(' · '),
    };
  }
  const stats = batchStats(entry.payload);
  const stores = (entry.payload?.stores || []).map((store) => store.name).filter(Boolean);
  return {
    title: entry.payload?.dateLabel || entry.sourceDateLabel || 'Batch',
    subtitle: stores.length
      ? `${stores.join(', ')}  ·  ${stats.documents} ${docNoun(flattenBatchPos(entry.payload), stats.documents)}`
      : 'No stores',
  };
}

export default function TriageDeletedPanel({ session, query = '' }) {
  const { deleted = [] } = useTransferWorkflow();
  const isMobile = useIsMobile();
  const rows = useMemo(
    () =>
      deleted
        .slice()
        .sort((a, b) => String(b.deletedAt || '').localeCompare(String(a.deletedAt || ''))),
    [deleted],
  );
  const visible = useMemo(() => {
    const q = String(query || '')
      .trim()
      .toLowerCase();
    if (!q) return rows;
    return rows.filter((entry) => {
      const props = deletedRowProps(entry);
      return [props.title, props.subtitle, entry.deletedBy]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q);
    });
  }, [query, rows]);

  const restore = useCallback((entry) => {
    restoreTriageDeleted(entry.id);
    persistTransferWorkflowNow().catch(() => {});
  }, []);

  const purge = useCallback((entry) => {
    const label =
      entry.kind === 'batch'
        ? entry.payload?.dateLabel || entry.sourceDateLabel || 'this batch'
        : entry.item?.reference || flattenBatchPos(entry.payload)[0]?.reference || 'this PO';
    confirmDestructive(
      `Fully delete ${label}?`,
      'It is removed from triage and will not show in the app. The PO in Aureus is not changed.',
      () => {
        purgeTriageDeleted(entry.id);
        persistTransferWorkflowNow().catch(() => {});
      },
      'Fully delete',
    );
  }, []);

  if (!session?.token) {
    return (
      <View style={styles.body}>
        <EmptyState icon="lock-closed-outline" title="Sign in to triage" body="Log in to see deleted batches and documents." />
      </View>
    );
  }

  return (
    <ScrollView style={[styles.body, isMobile && styles.bodyMobile]} contentContainerStyle={[styles.content, isMobile && styles.contentMobile]} showsVerticalScrollIndicator={false}>
      {visible.length === 0 ? (
        <EmptyState
          icon="trash-outline"
          title={query.trim() ? 'No matches' : 'Nothing deleted'}
          body={
            query.trim()
              ? `Nothing matches “${query.trim()}”.`
              : 'Batches, Quick Add POs, and documents you remove from the dashboard land here and stay off the live list.'
          }
        />
      ) : (
        <Group>
          {visible.map((entry, index) => (
            <DeletedRow
              key={entry.id}
              last={index === visible.length - 1}
              {...deletedRowProps(entry)}
              meta={[`Deleted ${formatDeletedAt(entry.deletedAt)}`, entry.deletedBy].filter(Boolean).join(' · ')}
              onRestore={() => restore(entry)}
              onPurge={() => purge(entry)}
            />
          ))}
        </Group>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    minHeight: 0,
    backgroundColor: T.bg,
  },
  bodyMobile: {
    backgroundColor: T.bg,
  },
  content: {
    paddingHorizontal: 0,
    paddingTop: 8,
    paddingBottom: 24,
    flexGrow: 1,
    backgroundColor: T.bg,
  },
  contentMobile: {
    paddingHorizontal: 16,
    paddingBottom: 40,
    backgroundColor: T.bg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: T.hairline,
    backgroundColor: T.card,
  },
  rowLast: {
    borderBottomWidth: 0,
  },
  rowMain: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 54,
    paddingLeft: 12,
    paddingRight: 8,
    paddingVertical: 8,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  rowTitle: {
    fontFamily: FONT,
    fontSize: 14.5,
    fontWeight: '600',
    color: T.text,
    letterSpacing: -0.2,
  },
  rowSub: {
    fontFamily: FONT,
    fontSize: 12.5,
    color: T.secondary,
  },
  rowMeta: {
    fontFamily: FONT,
    fontSize: 11.5,
    color: T.secondary,
  },
  rowMobile: {
    flexWrap: 'wrap',
    alignItems: 'flex-start',
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
  },
  actionsMobile: {
    flexDirection: 'column',
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 2,
  },
  action: {
    paddingHorizontal: 10,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    ...webCursor,
  },
  restoreText: {
    fontFamily: FONT,
    fontSize: 14,
    fontWeight: '500',
    color: T.text,
  },
  purgeText: {
    fontFamily: FONT,
    fontSize: 14,
    fontWeight: '500',
    color: T.red,
  },
});
