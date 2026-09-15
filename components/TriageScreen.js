import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import TriageTransfersPanel from './TriageTransfersPanel';
import TriageReviewDrawer from './TriageReviewDrawer';
import { FONT, T, TextAction } from './TriageKit';
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

function formatPct(value) {
  if (!Number.isFinite(value)) return '—';
  return `${Math.round(value)}%`;
}

function accuracyTint(pct) {
  if (pct >= 90) return GREEN;
  if (pct >= 75) return ORANGE;
  return RED;
}

function staffName(row) {
  const name = String(row?.employeeName || '').trim();
  return name && name !== '—' ? name : '';
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

function TodayInsightsStrip({ triage }) {
  const accuracyRows = useMemo(() => collectAccuracyTriagePos(triage), [triage]);
  const total = accuracyRows.length;
  const incorrectRows = useMemo(
    () => accuracyRows.filter((row) => triagePoNeedsCorrection(row)),
    [accuracyRows],
  );
  const correctCount = total - incorrectRows.length;
  const incorrectCount = incorrectRows.length;
  const accuracyPct = total ? (correctCount / total) * 100 : null;
  const errorRanks = useMemo(() => countRanks(incorrectRows, errorPlace), [incorrectRows]);
  const peopleRanks = useMemo(
    () => countRanks(incorrectRows, (row) => staffName(row) || 'Unknown'),
    [incorrectRows],
  );
  const topError = errorRanks[0] || null;
  const topPerson = peopleRanks[0] || null;

  if (total === 0) return null;

  return (
    <View style={styles.insightsStrip}>
      <View style={styles.insightsStripCell}>
        <Text style={styles.insightsStripKicker}>Accuracy</Text>
        <Text style={[styles.insightsStripValue, { color: accuracyPct == null ? TEXT : accuracyTint(accuracyPct) }]}>
          {formatPct(accuracyPct)}
        </Text>
      </View>

      <View style={styles.insightsStripDivider} />

      <View style={styles.insightsStripCell}>
        <Text style={styles.insightsStripKicker}>Flagged</Text>
        <Text style={[styles.insightsStripValue, incorrectCount > 0 && { color: ORANGE }]}>
          {incorrectCount}
        </Text>
      </View>

      {topError ? (
        <>
          <View style={styles.insightsStripDivider} />
          <View style={[styles.insightsStripCell, styles.insightsStripCellFlex]}>
            <Text style={styles.insightsStripKicker}>Top Error</Text>
            <Text style={styles.insightsStripLabel} numberOfLines={1}>
              {topError.label}
            </Text>
          </View>
        </>
      ) : null}

      {topPerson ? (
        <>
          <View style={styles.insightsStripDivider} />
          <View style={[styles.insightsStripCell, styles.insightsStripCellFlex]}>
            <Text style={styles.insightsStripKicker}>Most Flags</Text>
            <Text style={styles.insightsStripLabel} numberOfLines={1}>
              {topPerson.label} ({topPerson.count})
            </Text>
          </View>
        </>
      ) : null}
    </View>
  );
}

function TodayHeader({ session, triage, onNewPress, onQuickAddPress, batchContext, onStoreBackChange }) {
  let openDocs = 0;
  for (const batch of triage) openDocs += batchStats(batch).open;

  const showBatchContext = Boolean(batchContext) && !onStoreBackChange;

  return (
    <View style={styles.todayHeader}>
      <View style={styles.todayHeaderMain}>
        <Text style={styles.todayTitle}>Today</Text>
        {openDocs > 0 ? (
          <View style={styles.todayBadge}>
            <Text style={styles.todayBadgeText}>{openDocs}</Text>
          </View>
        ) : null}
      </View>

      {showBatchContext ? (
        <View style={styles.batchTitle} pointerEvents="none">
          <Text style={styles.batchTitleDate} numberOfLines={1}>
            {batchContext.dateLabel}
          </Text>
          {batchContext.storeNames ? (
            <Text style={styles.batchTitleStores} numberOfLines={1}>
              {batchContext.storeNames}
            </Text>
          ) : null}
        </View>
      ) : session?.token ? (
        <View style={styles.todayActions}>
          <TextAction
            label="Quick Add"
            onPress={onQuickAddPress}
            accessibilityLabel="Quick Add a PO from any store"
          />
          <TextAction
            icon="add"
            label="New"
            strong
            onPress={onNewPress}
            accessibilityLabel="New batch"
          />
        </View>
      ) : null}
    </View>
  );
}

function FlaggedExceptionRow({ row, onPress }) {
  const errorType = errorPlace(row);
  const person = staffName(row) || 'Unknown';
  const received = Boolean(row?.received);

  return (
    <Pressable
      style={styles.flaggedRow}
      onPress={() => onPress(row)}
      accessibilityRole="button"
      accessibilityLabel={`Review ${row.reference}`}
    >
      <View style={styles.flaggedRowMain}>
        <Text style={styles.flaggedRowRef} numberOfLines={1}>
          {row.reference}
        </Text>
        <Text style={styles.flaggedRowMeta} numberOfLines={1}>
          {errorType} · {person}
          {row.storeName ? ` · ${row.storeName}` : ''}
        </Text>
      </View>
      <View style={styles.flaggedRowStatus}>
        <View style={[styles.flaggedPill, received && styles.flaggedPillReceived]}>
          <Text style={[styles.flaggedPillText, received && styles.flaggedPillTextReceived]}>
            {received ? 'Received' : 'Open'}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={SECONDARY} />
      </View>
    </Pressable>
  );
}

function FlaggedExceptionsList({ triage, onOpenRow }) {
  const flaggedRows = useMemo(() => {
    const rows = collectAccuracyTriagePos(triage).filter(triagePoNeedsCorrection);
    return rows.sort((a, b) => {
      const aReceived = a.received ? 1 : 0;
      const bReceived = b.received ? 1 : 0;
      if (aReceived !== bReceived) return aReceived - bReceived;
      return (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0);
    });
  }, [triage]);

  if (flaggedRows.length === 0) return null;

  return (
    <View style={styles.flaggedSection}>
      <View style={styles.flaggedHeader}>
        <View style={styles.flaggedHeaderIcon}>
          <Ionicons name="alert-circle" size={14} color={ORANGE} />
        </View>
        <Text style={styles.flaggedHeaderText}>
          Exceptions ({flaggedRows.length})
        </Text>
      </View>
      <ScrollView
        style={styles.flaggedList}
        contentContainerStyle={styles.flaggedListContent}
        showsVerticalScrollIndicator={false}
      >
        {flaggedRows.map((row, index) => (
          <FlaggedExceptionRow
            key={`${row.triageId}-${row.id}`}
            row={row}
            onPress={onOpenRow}
          />
        ))}
      </ScrollView>
    </View>
  );
}

export default function TriageScreen({
  session,
  onRequireLogin,
  embedded = false,
  onStoreBackChange,
}) {
  const { triage } = useTransferWorkflow();
  const [createTransferOpen, setCreateTransferOpen] = useState(false);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
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

  const handleBackChange = useCallback((fn, context) => {
    leaveStoreRef.current = fn;
    setCanLeaveStore(Boolean(fn));
    setBatchContext(context || null);
    onStoreBackChangeRef.current?.(fn, context || null);
  }, []);

  const handleSaveReview = useCallback((poId, review) => {
    saveTriagePoReview(poId, review);
    setReviewRow((current) => (current?.id === poId ? applyTriageReviewToPo(current, review) : current));
  }, []);

  const flaggedRows = useMemo(
    () => collectAccuracyTriagePos(triage).filter(triagePoNeedsCorrection),
    [triage],
  );

  const inBatch = canLeaveStore && Boolean(batchContext);

  return (
    <View style={[styles.body, embedded && styles.bodyEmbedded]}>
      <TodayHeader
        session={session}
        triage={triage}
        onNewPress={() => setCreateTransferOpen(true)}
        onQuickAddPress={() => setQuickAddOpen(true)}
        batchContext={inBatch ? batchContext : null}
        onStoreBackChange={onStoreBackChange}
      />

      {!inBatch ? (
        <>
          <TodayInsightsStrip triage={triage} />
          <FlaggedExceptionsList triage={triage} onOpenRow={setReviewRow} />
        </>
      ) : null}

      <View style={styles.pageVisible}>
        <TriageTransfersPanel
          session={session}
          onRequireLogin={onRequireLogin}
          createOpen={createTransferOpen}
          onCreateOpenChange={setCreateTransferOpen}
          quickAddOpen={quickAddOpen}
          onQuickAddOpenChange={setQuickAddOpen}
          onBackChange={handleBackChange}
        />
      </View>

      <TriageReviewDrawer
        visible={Boolean(reviewRow)}
        session={session}
        row={reviewRow}
        review={reviewRow?.review || null}
        extraRows={flaggedRows}
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
    backgroundColor: T.bg,
  },
  todayHeaderMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  todayTitle: {
    fontFamily,
    fontSize: 22,
    fontWeight: '700',
    color: TEXT,
    letterSpacing: -0.5,
  },
  todayBadge: {
    backgroundColor: ORANGE,
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
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
  batchTitle: {
    maxWidth: 220,
    alignItems: 'flex-end',
  },
  batchTitleDate: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: TEXT,
    letterSpacing: -0.2,
    textAlign: 'right',
  },
  batchTitleStores: {
    fontFamily,
    fontSize: 11,
    color: SECONDARY,
    textAlign: 'right',
  },
  insightsStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HAIRLINE,
    gap: 12,
  },
  insightsStripCell: {
    alignItems: 'flex-start',
    gap: 2,
  },
  insightsStripCellFlex: {
    flex: 1,
    minWidth: 0,
  },
  insightsStripKicker: {
    fontFamily,
    fontSize: 10,
    fontWeight: '600',
    color: SECONDARY,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  insightsStripValue: {
    fontFamily,
    fontSize: 18,
    fontWeight: '700',
    color: TEXT,
    letterSpacing: -0.4,
  },
  insightsStripLabel: {
    fontFamily,
    fontSize: 13,
    fontWeight: '500',
    color: TEXT,
    letterSpacing: -0.1,
  },
  insightsStripDivider: {
    width: 1,
    height: 28,
    backgroundColor: HAIRLINE,
  },
  flaggedSection: {
    backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HAIRLINE,
    maxHeight: 200,
  },
  flaggedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 6,
    gap: 6,
  },
  flaggedHeaderIcon: {
    width: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flaggedHeaderText: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: ORANGE,
    letterSpacing: -0.1,
  },
  flaggedList: {
    flex: 1,
    minHeight: 0,
  },
  flaggedListContent: {
    paddingBottom: 8,
  },
  flaggedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 12,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  flaggedRowMain: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  flaggedRowRef: {
    fontFamily,
    fontSize: 15,
    fontWeight: '500',
    color: TEXT,
    letterSpacing: -0.2,
  },
  flaggedRowMeta: {
    fontFamily,
    fontSize: 12,
    color: SECONDARY,
  },
  flaggedRowStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  flaggedPill: {
    backgroundColor: 'rgba(255,149,0,0.14)',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  flaggedPillReceived: {
    backgroundColor: 'rgba(52,199,89,0.14)',
  },
  flaggedPillText: {
    fontFamily,
    fontSize: 11,
    fontWeight: '600',
    color: ORANGE,
  },
  flaggedPillTextReceived: {
    color: GREEN,
  },
  pageVisible: {
    flex: 1,
    minHeight: 0,
  },
});
