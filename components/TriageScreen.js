import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import TriageTransfersPanel from './TriageTransfersPanel';
import TriageReviewDrawer from './TriageReviewDrawer';
import { FONT, T, TextAction } from './TriageKit';
import { PoThumb, TableMuted, TableStrong } from './TriageTable';
import {
  applyTriageReviewToPo,
  batchStats,
  collectAccuracyTriagePos,
  saveTriagePoReview,
  syncTransferWorkflowRemote,
  triagePoNeedsCorrection,
  useTransferWorkflow,
} from '../lib/transferWorkflow';

if (Platform.OS === 'web' && typeof document !== 'undefined') {
  const styleId = 'cgold-triage-row-hover';
  let style = document.getElementById(styleId);
  if (!style) {
    style = document.createElement('style');
    style.id = styleId;
    document.head.appendChild(style);
  }
  style.textContent = [
    '.cgold-triage-row{cursor:pointer;background-color:transparent;}',
    '.cgold-triage-row:hover{background-color:#f5f5f7!important;}',
    '.cgold-triage-row-selected,.cgold-triage-row-selected:hover{background-color:#EAF2FF!important;}',
    '.cgold-triage-row-mixed{background-color:rgba(255,149,0,0.16)!important;}',
    '.cgold-triage-row-mixed .cgold-triage-row:hover{background-color:rgba(255,149,0,0.26)!important;}',
    '.cgold-triage-row-bullion{background-color:rgba(255,59,48,0.16)!important;}',
    '.cgold-triage-row-bullion .cgold-triage-row:hover{background-color:rgba(255,59,48,0.26)!important;}',
  ].join('');
}

/** Drop cached transaction rows so nothing outlives the session that loaded them. */
export function clearTriageCache() {}

const fontFamily = FONT;
const TEXT = T.text;
const SECONDARY = T.secondary;
const GREEN = T.green;
const ORANGE = T.orange;
const RED = T.red;
const HAIRLINE = T.hairline;

function namesMatch(a, b) {
  return (
    String(a || '')
      .trim()
      .localeCompare(String(b || '').trim(), undefined, { sensitivity: 'base' }) === 0
  );
}

function errorPlace(row) {
  const type = String(row?.review?.errorType || '').trim();
  if (type) return type;
  const corrections = Array.isArray(row?.review?.corrections) ? row.review.corrections : [];
  if (corrections.length) {
    const labels = corrections.map((item) => String(item?.label || '').toLowerCase());
    if (labels.some((label) => /\bqty\b|quantity/.test(label))) return 'Wrong quantity';
    if (labels.some((label) => /price|amount|unit/.test(label))) return 'Wrong price';
    if (labels.some((label) => /customer|client/.test(label))) return 'Wrong customer';
    if (labels.some((label) => /payment/.test(label))) return 'Wrong payment';
    if (labels.some((label) => /name|item/.test(label))) return 'Wrong item';
    return corrections[0].label || 'Unspecified';
  }
  if (String(row?.review?.note || '').trim()) return 'Note only';
  return 'Unspecified';
}

function countRanks(rows, getLabel) {
  const counts = new Map();
  for (const row of rows) {
    const label = String(getLabel(row) || '').trim();
    if (!label || label === '—') continue;
    const key = label.toLowerCase();
    const current = counts.get(key);
    if (current) current.count += 1;
    else counts.set(key, { label, count: 1 });
  }
  const total = rows.length || 1;
  return [...counts.values()]
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }))
    .map((row) => ({ ...row, pct: Math.round((row.count / total) * 100) }));
}

function formatPct(value) {
  if (!Number.isFinite(value)) return '—';
  return `${Math.round(value)}%`;
}

function accuracyTint(pct) {
  if (pct >= 90) return GREEN;
  if (pct >= 75) return ORANGE;
  return RED;
}

const ExceptionRow = memo(function ExceptionRow({ row, onPress }) {
  const errorType = errorPlace(row);
  const sub = [row.storeName, row.dateLabel, errorType].filter(Boolean).join(' · ');
  return (
    <Pressable
      style={styles.exceptionRow}
      onPress={() => onPress(row)}
      accessibilityRole="button"
      accessibilityLabel={`Review ${row.reference}`}
    >
      <PoThumb urls={row.imageUrls} label={row.reference} />
      <View style={styles.exceptionText}>
        <TableStrong>{row.reference}</TableStrong>
        <TableMuted numberOfLines={1}>{sub}</TableMuted>
      </View>
      <View style={styles.exceptionBadge}>
        <Text style={styles.exceptionBadgeText}>Flagged</Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color="#c7c7cc" />
    </Pressable>
  );
});

function CompactAccuracyInsights({ accuracyRows }) {
  const total = accuracyRows.length;
  const incorrectRows = useMemo(
    () => accuracyRows.filter((row) => triagePoNeedsCorrection(row)),
    [accuracyRows],
  );
  const correctCount = total - incorrectRows.length;
  const incorrectCount = incorrectRows.length;
  const accuracyPct = total ? (correctCount / total) * 100 : null;

  const errorRanks = useMemo(() => countRanks(incorrectRows, errorPlace), [incorrectRows]);
  const topError = errorRanks[0] || null;

  if (total === 0) return null;

  return (
    <View style={styles.insightsCompact}>
      <View style={styles.insightsRow}>
        <View style={styles.insightsStat}>
          <Text style={styles.insightsLabel}>Accuracy</Text>
          <Text style={[styles.insightsValue, { color: accuracyPct == null ? TEXT : accuracyTint(accuracyPct) }]}>
            {formatPct(accuracyPct)}
          </Text>
        </View>
        <View style={styles.insightsDivider} />
        <View style={styles.insightsStat}>
          <Text style={styles.insightsLabel}>Correct</Text>
          <Text style={[styles.insightsValue, { color: GREEN }]}>{correctCount}</Text>
        </View>
        <View style={styles.insightsDivider} />
        <View style={styles.insightsStat}>
          <Text style={styles.insightsLabel}>Incorrect</Text>
          <Text style={[styles.insightsValue, { color: incorrectCount > 0 ? RED : TEXT }]}>{incorrectCount}</Text>
        </View>
        {topError ? (
          <>
            <View style={styles.insightsDivider} />
            <View style={[styles.insightsStat, styles.insightsStatWide]}>
              <Text style={styles.insightsLabel}>Top Error</Text>
              <Text style={styles.insightsErrorType} numberOfLines={1}>{topError.label}</Text>
            </View>
          </>
        ) : null}
      </View>
    </View>
  );
}

function ExceptionsSection({ flaggedRows, onOpenReview }) {
  if (flaggedRows.length === 0) return null;

  return (
    <View style={styles.exceptionsSection}>
      <View style={styles.exceptionsHeader}>
        <View style={styles.exceptionsHeaderIcon}>
          <Ionicons name="alert-circle" size={16} color={ORANGE} />
        </View>
        <Text style={styles.exceptionsTitle}>Exceptions</Text>
        <Text style={styles.exceptionsCount}>{flaggedRows.length}</Text>
      </View>
      <View style={styles.exceptionsList}>
        {flaggedRows.slice(0, 5).map((row) => (
          <ExceptionRow key={`${row.triageId}-${row.id}`} row={row} onPress={onOpenReview} />
        ))}
        {flaggedRows.length > 5 ? (
          <Text style={styles.exceptionsMore}>+{flaggedRows.length - 5} more flagged POs</Text>
        ) : null}
      </View>
    </View>
  );
}

export default function TriageScreen({
  session,
  onRequireLogin,
  storeFilter,
  embedded = false,
  onStoreBackChange,
}) {
  const { triage } = useTransferWorkflow();
  const [createTransferOpen, setCreateTransferOpen] = useState(false);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [transferView, setTransferView] = useState('list');
  const [canLeaveStore, setCanLeaveStore] = useState(false);
  const [batchContext, setBatchContext] = useState(null);
  const [reviewRow, setReviewRow] = useState(null);
  const leaveStoreRef = useRef(null);
  const onStoreBackChangeRef = useRef(onStoreBackChange);
  onStoreBackChangeRef.current = onStoreBackChange;

  useEffect(() => {
    if (!session?.supabaseUserId && !session?.token) return undefined;
    syncTransferWorkflowRemote().catch(() => {});
    return undefined;
  }, [session?.supabaseUserId, session?.token]);

  const accuracyRows = useMemo(() => {
    const rows = collectAccuracyTriagePos(triage);
    if (!storeFilter) return rows;
    return rows.filter((row) => namesMatch(row.storeName, storeFilter));
  }, [storeFilter, triage]);

  const flaggedRows = useMemo(
    () => accuracyRows.filter((row) => triagePoNeedsCorrection(row)),
    [accuracyRows],
  );

  const openBatchCount = useMemo(() => {
    let count = 0;
    for (const batch of triage) count += batchStats(batch).open;
    return count;
  }, [triage]);

  const handleBackChange = useCallback((fn, context) => {
    leaveStoreRef.current = fn;
    setCanLeaveStore(Boolean(fn));
    setBatchContext(context || null);
    onStoreBackChangeRef.current?.(fn, context || null);
  }, []);

  const handleOpenReview = useCallback((row) => {
    setReviewRow(row);
  }, []);

  const handleSaveReview = useCallback((poId, review) => {
    saveTriagePoReview(poId, review);
    setReviewRow((current) => (current?.id === poId ? applyTriageReviewToPo(current, review) : current));
  }, []);

  const inBatch = canLeaveStore && Boolean(batchContext);
  const showHeader = !inBatch || onStoreBackChange;

  const headerContent = showHeader ? (
    <View style={styles.todayHeader}>
      <View style={styles.todayTitleRow}>
        <Text style={styles.todayTitle}>Today</Text>
        {openBatchCount > 0 ? (
          <View style={styles.todayBadge}>
            <Text style={styles.todayBadgeText}>{openBatchCount}</Text>
          </View>
        ) : null}
      </View>
      {session?.token && transferView === 'list' ? (
        <View style={styles.todayActions}>
          <TextAction
            label="Quick Add"
            onPress={() => setQuickAddOpen(true)}
            accessibilityLabel="Quick Add a PO from any store"
          />
          <TextAction
            icon="add"
            label="New"
            strong
            onPress={() => setCreateTransferOpen(true)}
            accessibilityLabel="New batch"
          />
        </View>
      ) : null}
    </View>
  ) : (
    <View style={styles.batchHeader}>
      <Text style={styles.batchTitleDate} numberOfLines={1}>
        {batchContext.dateLabel}
      </Text>
      {batchContext.storeNames ? (
        <Text style={styles.batchTitleStores} numberOfLines={1}>
          {batchContext.storeNames}
        </Text>
      ) : null}
    </View>
  );

  return (
    <View style={[styles.body, embedded && styles.bodyEmbedded]}>
      {headerContent}

      {showHeader && transferView === 'list' ? (
        <ScrollView
          style={styles.summaryScroll}
          contentContainerStyle={styles.summaryContent}
          showsVerticalScrollIndicator={false}
        >
          <CompactAccuracyInsights accuracyRows={accuracyRows} />
          <ExceptionsSection flaggedRows={flaggedRows} onOpenReview={handleOpenReview} />
        </ScrollView>
      ) : null}

      <View style={styles.transfersContainer}>
        <TriageTransfersPanel
          session={session}
          onRequireLogin={onRequireLogin}
          createOpen={createTransferOpen}
          onCreateOpenChange={setCreateTransferOpen}
          quickAddOpen={quickAddOpen}
          onQuickAddOpenChange={setQuickAddOpen}
          onViewChange={setTransferView}
          onBackChange={handleBackChange}
        />
      </View>

      <TriageReviewDrawer
        visible={Boolean(reviewRow)}
        session={session}
        row={reviewRow}
        review={reviewRow?.review || null}
        extraRows={accuracyRows}
        onClose={() => setReviewRow(null)}
        onSave={handleSaveReview}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    minHeight: 0,
    backgroundColor: T.bg,
  },
  bodyEmbedded: {
    width: '100%',
    maxWidth: '100%',
  },
  todayHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HAIRLINE,
  },
  todayTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  todayTitle: {
    fontFamily,
    fontSize: 20,
    fontWeight: '700',
    color: TEXT,
    letterSpacing: -0.4,
  },
  todayBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 6,
    backgroundColor: T.blue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  todayBadgeText: {
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
    color: '#fff',
  },
  todayActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  batchHeader: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HAIRLINE,
  },
  batchTitleDate: {
    fontFamily,
    fontSize: 17,
    fontWeight: '600',
    color: TEXT,
    letterSpacing: -0.3,
  },
  batchTitleStores: {
    fontFamily,
    fontSize: 13,
    color: SECONDARY,
    marginTop: 2,
  },
  summaryScroll: {
    flexShrink: 0,
    maxHeight: 280,
  },
  summaryContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    gap: 12,
  },
  insightsCompact: {
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    ...Platform.select({
      web: { boxShadow: '0 1px 2px rgba(0,0,0,0.04)' },
      default: {},
    }),
  },
  insightsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  insightsStat: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    gap: 2,
  },
  insightsStatWide: {
    flex: 1.5,
  },
  insightsLabel: {
    fontFamily,
    fontSize: 10.5,
    fontWeight: '600',
    color: SECONDARY,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  insightsValue: {
    fontFamily,
    fontSize: 18,
    fontWeight: '700',
    color: TEXT,
    letterSpacing: -0.4,
  },
  insightsErrorType: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: TEXT,
    letterSpacing: -0.2,
    textAlign: 'center',
  },
  insightsDivider: {
    width: StyleSheet.hairlineWidth,
    height: 32,
    backgroundColor: HAIRLINE,
    marginHorizontal: 8,
  },
  exceptionsSection: {
    backgroundColor: '#fff',
    borderRadius: 12,
    overflow: 'hidden',
    ...Platform.select({
      web: { boxShadow: '0 1px 2px rgba(0,0,0,0.04)' },
      default: {},
    }),
  },
  exceptionsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HAIRLINE,
  },
  exceptionsHeaderIcon: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(255,149,0,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  exceptionsTitle: {
    fontFamily,
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: TEXT,
    letterSpacing: -0.2,
  },
  exceptionsCount: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: ORANGE,
  },
  exceptionsList: {
    gap: 0,
  },
  exceptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HAIRLINE,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  exceptionText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  exceptionBadge: {
    backgroundColor: 'rgba(255,149,0,0.14)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  exceptionBadgeText: {
    fontFamily,
    fontSize: 11,
    fontWeight: '600',
    color: ORANGE,
  },
  exceptionsMore: {
    fontFamily,
    fontSize: 13,
    color: SECONDARY,
    paddingHorizontal: 14,
    paddingVertical: 12,
    textAlign: 'center',
  },
  transfersContainer: {
    flex: 1,
    minHeight: 0,
  },
});
