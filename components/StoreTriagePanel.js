import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  formatInsightCount,
  formatInsightPercent,
} from '../lib/triageInsights';
import { loadStoreTriageView } from '../lib/triageQueries';
import { CANVAS, useIsMobile } from '../lib/mobileUi';

const LABEL = '#1a1a1a';
const SECONDARY = '#8e8e93';
const SEPARATOR = '#d0d0d0';
const ORANGE = '#C2410C';
const GREEN = '#2F8A4E';

function docKindLabel(kind) {
  return kind === 'sale' ? 'Sale' : 'Purchase';
}

function ErrorRow({ item, last }) {
  return (
    <View style={[styles.row, last && styles.rowLast]}>
      <View style={styles.rowMain}>
        <View style={styles.rowTitleLine}>
          <Text style={styles.rowTitle} numberOfLines={1}>
            {item.reference || 'Triage item'}
          </Text>
          <Text style={styles.docKind}>{docKindLabel(item.docKind)}</Text>
        </View>
        <Text style={styles.rowMeta} numberOfLines={2}>
          {[item.employeeName || 'Unspecified', item.errorType, item.productLabel]
            .filter((part) => part && part !== '—')
            .join(' · ')}
        </Text>
        {item.detail ? (
          <Text style={styles.rowDetail} numberOfLines={3}>
            {item.detail}
          </Text>
        ) : null}
        {item.dateLabel || item.dateKey ? (
          <Text style={styles.rowWhen}>{item.dateLabel || item.dateKey}</Text>
        ) : null}
      </View>
    </View>
  );
}

export default function StoreTriagePanel({
  storeName,
  startKey = '',
  endKey = '',
  variant = 'store',
}) {
  const isMobile = useIsMobile();
  const [insight, setInsight] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!storeName) {
      setInsight(null);
      setItems([]);
      setError('');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const next = await loadStoreTriageView(storeName, {
        incorrectOnly: true,
        startKey,
        endKey,
      });
      setInsight(next.insight);
      setItems(next.items);
    } catch (err) {
      setInsight(null);
      setItems([]);
      setError(err?.message || 'Could not load triage for this store.');
    } finally {
      setLoading(false);
    }
  }, [endKey, startKey, storeName]);

  useEffect(() => {
    load();
  }, [load]);

  const summary = useMemo(() => {
    if (insight) {
      return {
        incorrect: insight.incorrect,
        evaluated: insight.evaluated,
        accuracy: formatInsightPercent(insight.accuracy, insight.evaluated),
        employees: insight.employees || [],
        errorTypes: insight.errorTypes || [],
      };
    }
    return {
      incorrect: items.length,
      evaluated: items.length,
      accuracy: '—',
      employees: [],
      errorTypes: [],
    };
  }, [insight, items.length]);

  if (!storeName) {
    return (
      <View style={[styles.empty, variant === 'app' && styles.appEmpty]}>
        <Text style={styles.emptyText}>This account needs a store before triage can load.</Text>
      </View>
    );
  }

  if (loading && items.length === 0 && !insight) {
    return (
      <View style={[styles.empty, variant === 'app' && styles.appEmpty]}>
        <Text style={styles.emptyText}>Loading triage…</Text>
      </View>
    );
  }

  if (error) {
    return (
      <Pressable onPress={load} style={[styles.empty, variant === 'app' && styles.appEmpty]}>
        <Text style={styles.emptyText}>{error} · Tap to retry</Text>
      </Pressable>
    );
  }

  return (
    <View style={[styles.wrap, variant === 'app' && styles.appWrap, isMobile && styles.wrapMobile]}>
      <View style={styles.summary}>
        <View style={styles.stat}>
          <Text style={styles.statLabel}>Incorrect</Text>
          <Text style={[styles.statValue, styles.statHot]}>{summary.incorrect}</Text>
        </View>
        {insight ? (
          <>
            <View style={styles.stat}>
              <Text style={styles.statLabel}>Reviewed</Text>
              <Text style={styles.statValue}>{summary.evaluated}</Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.statLabel}>Accuracy</Text>
              <Text style={[styles.statValue, styles.statOk]}>{summary.accuracy}</Text>
            </View>
          </>
        ) : (
          <View style={styles.statWide}>
            <Text style={styles.statHint}>
              {formatInsightCount(summary.incorrect, 'incorrect item')} for {storeName}
            </Text>
          </View>
        )}
      </View>

      {insight && (summary.employees.length || summary.errorTypes.length) ? (
        <View style={styles.chips}>
          {summary.errorTypes.slice(0, 3).map((row) => (
            <View key={row.label} style={styles.chip}>
              <Text style={styles.chipText} numberOfLines={1}>
                {row.label} · {row.count}
              </Text>
            </View>
          ))}
          {summary.employees.slice(0, 3).map((row) => (
            <View key={row.name} style={styles.chip}>
              <Ionicons name="person-outline" size={12} color={SECONDARY} />
              <Text style={styles.chipText} numberOfLines={1}>
                {row.name} · {row.incorrect}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      {items.length === 0 ? (
        <View style={styles.emptyRow}>
          <Text style={styles.emptyText}>No incorrect triage items for this store.</Text>
        </View>
      ) : (
        items.map((item, index) => (
          <ErrorRow key={item.id || `${item.reference}-${index}`} item={item} last={index === items.length - 1} />
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: '#fff',
  },
  appWrap: {
    flex: 1,
    backgroundColor: CANVAS,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  wrapMobile: {
    paddingBottom: 12,
  },
  summary: {
    flexDirection: 'row',
    gap: 16,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  stat: {
    minWidth: 72,
  },
  statWide: {
    flex: 1,
    justifyContent: 'center',
  },
  statLabel: {
    fontSize: 12,
    color: SECONDARY,
  },
  statValue: {
    fontSize: 22,
    fontWeight: '600',
    color: LABEL,
    fontVariant: ['tabular-nums'],
  },
  statHot: {
    color: ORANGE,
  },
  statOk: {
    color: GREEN,
  },
  statHint: {
    fontSize: 13,
    color: SECONDARY,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(118, 118, 128, 0.12)',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    maxWidth: '100%',
  },
  chipText: {
    fontSize: 12,
    color: LABEL,
    maxWidth: 180,
  },
  row: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: SEPARATOR,
  },
  rowLast: {
    borderBottomWidth: 0,
  },
  rowMain: {
    gap: 3,
  },
  rowTitleLine: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
  },
  rowTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: LABEL,
  },
  docKind: {
    fontSize: 12,
    color: SECONDARY,
  },
  rowMeta: {
    fontSize: 13,
    color: LABEL,
  },
  rowDetail: {
    fontSize: 13,
    color: SECONDARY,
  },
  rowWhen: {
    fontSize: 12,
    color: SECONDARY,
  },
  empty: {
    padding: 16,
  },
  appEmpty: {
    flex: 1,
    backgroundColor: CANVAS,
    justifyContent: 'center',
  },
  emptyRow: {
    paddingHorizontal: 16,
    paddingVertical: 18,
  },
  emptyText: {
    fontSize: 14,
    color: SECONDARY,
  },
});
