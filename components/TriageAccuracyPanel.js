import { useCallback, useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { MOBILE, mobileSafeBottom, useIsMobile } from '../lib/mobileUi';
import {
  collectReceivedTriagePos,
  saveTriagePoReview,
  triagePoNeedsCorrection,
  useTransferWorkflow,
} from '../lib/transferWorkflow';
import { normalizeReviewImages } from '../lib/triageDraft';
import TriageCorrectionImages from './TriageCorrectionImages';
import TriageReviewDrawer from './TriageReviewDrawer';

const fontFamily = Platform.select({
  ios: 'Sohne',
  android: 'Sohne',
  default: 'Sohne',
});

const ACCENT = '#C2410C';
const TEXT = '#1d1d1f';
const SECONDARY = '#8e8e93';
const HAIRLINE = '#e5e5ea';
const BLUE = MOBILE.blue;

const ACCURACY_TABS = [
  { key: 'correct', label: 'Correct' },
  { key: 'incorrect', label: 'Incorrect' },
];

function namesMatch(a, b) {
  return (
    String(a || '')
      .trim()
      .localeCompare(String(b || '').trim(), undefined, { sensitivity: 'base' }) === 0
  );
}

function CorrectionPair({ original, value }) {
  return (
    <View style={styles.correctionPair}>
      <Text style={styles.struckText}>{original || '—'}</Text>
      <Text style={styles.correctedText}>{value || '—'}</Text>
    </View>
  );
}

function EmptyState({ icon, title, body }) {
  return (
    <View style={styles.empty}>
      <Ionicons name={icon} size={40} color={SECONDARY} />
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
    </View>
  );
}

function AccuracyTabs({ value, onChange }) {
  return (
    <View style={styles.tabBar}>
      <View style={styles.segment} accessibilityRole="tablist">
        {ACCURACY_TABS.map((tab) => {
          const active = tab.key === value;
          return (
            <Pressable
              key={tab.key}
              style={[styles.segmentButton, active && styles.segmentButtonActive]}
              onPress={() => onChange(tab.key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={tab.label}
            >
              <Text style={[styles.segmentText, active && styles.segmentTextActive]} numberOfLines={1}>
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function AccuracyPoCard({ entry, onOpen, mobile }) {
  const row = entry.row;
  const review = row.review || {};
  const isBuy = row.type !== 'order';
  const corrections = Array.isArray(review.corrections) ? review.corrections : [];
  const images = normalizeReviewImages(review.images);
  const subtitle = [row.storeName, row.dateLabel, row.customerName].filter(Boolean).join(' · ');

  return (
    <Pressable
      style={[styles.card, mobile && styles.cardMobile]}
      onPress={() => onOpen(row)}
      accessibilityRole="button"
      accessibilityLabel={`Open ${row.reference}`}
      {...(Platform.OS === 'web' ? { className: 'cgold-triage-row' } : null)}
    >
      <View style={styles.cardHeader}>
        <View style={styles.cardTitleRow}>
          <Text style={[styles.txKind, isBuy && styles.txKindBuy]}>{isBuy ? 'PO' : 'SO'}</Text>
          <Text style={styles.txRef}>{row.reference}</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={SECONDARY} />
      </View>
      {subtitle ? (
        <Text style={styles.cardSub} numberOfLines={2}>
          {subtitle}
        </Text>
      ) : null}
      {row.triageDateLabel ? (
        <Text style={styles.cardMeta} numberOfLines={1}>
          Received {row.triageDateLabel}
        </Text>
      ) : null}

      {entry.incorrect ? (
        <>
          {corrections.length > 0 ? (
            <View style={styles.savedCorrections}>
              {corrections.map((correction) => (
                <View key={correction.key} style={styles.savedCorrection}>
                  <Text style={styles.fieldLabel}>{correction.label}</Text>
                  <CorrectionPair original={correction.original} value={correction.value} />
                </View>
              ))}
            </View>
          ) : (
            <Text style={styles.savedMuted}>Updated without field changes</Text>
          )}
          {review.note ? (
            <View style={styles.savedBlock}>
              <Text style={styles.fieldLabel}>Note</Text>
              <Text style={styles.savedNote}>{review.note}</Text>
            </View>
          ) : null}
          {review.errorType ? (
            <View style={styles.savedBlock}>
              <Text style={styles.fieldLabel}>Type of error</Text>
              <Text style={styles.savedNote}>{review.errorType}</Text>
            </View>
          ) : null}
          {review.errorAmount ? (
            <View style={styles.savedBlock}>
              <Text style={styles.fieldLabel}>Amount</Text>
              <Text style={styles.savedAmount}>{review.errorAmount}</Text>
            </View>
          ) : null}
          {images.length > 0 ? (
            <View style={styles.savedBlock}>
              <TriageCorrectionImages images={images} readOnly />
            </View>
          ) : null}
        </>
      ) : null}
    </Pressable>
  );
}

export default function TriageAccuracyPanel({ session, storeFilter }) {
  const isMobile = useIsMobile();
  const { triage } = useTransferWorkflow();
  const [activeTab, setActiveTab] = useState('correct');
  const [openRow, setOpenRow] = useState(null);

  const received = useMemo(() => {
    const rows = collectReceivedTriagePos(triage);
    if (!storeFilter) return rows;
    return rows.filter((row) => namesMatch(row.storeName, storeFilter));
  }, [storeFilter, triage]);

  const correct = useMemo(
    () => received.filter((row) => !triagePoNeedsCorrection(row)),
    [received],
  );
  const incorrect = useMemo(
    () => received.filter((row) => triagePoNeedsCorrection(row)),
    [received],
  );

  const visible = activeTab === 'incorrect' ? incorrect : correct;

  const saveReview = useCallback((poId, review) => {
    saveTriagePoReview(poId, review);
    setOpenRow((current) => (current?.id === poId ? { ...current, review } : current));
  }, []);

  return (
    <View style={[styles.body, styles.bodyTinted]}>
      <AccuracyTabs value={activeTab} onChange={setActiveTab} />

      {visible.length === 0 ? (
        <EmptyState
          icon={activeTab === 'incorrect' ? 'alert-circle-outline' : 'checkmark-done-outline'}
          title={activeTab === 'incorrect' ? 'Incorrect' : 'Correct'}
          body={
            activeTab === 'incorrect'
              ? 'Received POs that needed corrections or updates will appear here.'
              : 'Received POs with no corrections will appear here.'
          }
        />
      ) : (
        <ScrollView
          style={styles.list}
          contentContainerStyle={styles.listContentInset}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.listGroup}>
            {visible.map((row) => (
              <AccuracyPoCard
                key={`${row.triageId}-${row.id}`}
                entry={{ row, incorrect: activeTab === 'incorrect' }}
                onOpen={setOpenRow}
                mobile={isMobile}
              />
            ))}
          </View>
        </ScrollView>
      )}

      <TriageReviewDrawer
        visible={Boolean(openRow)}
        session={session}
        row={openRow}
        review={openRow?.review || null}
        extraRows={received}
        onClose={() => setOpenRow(null)}
        onSave={saveReview}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    minHeight: 0,
  },
  bodyTinted: {
    backgroundColor: MOBILE.bg,
  },
  tabBar: {
    flexShrink: 0,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  segment: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 36,
    backgroundColor: 'rgba(118,118,128,0.12)',
    borderRadius: 9,
    padding: 2,
  },
  segmentButton: {
    flex: 1,
    height: 32,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  segmentButtonActive: {
    backgroundColor: '#fff',
    ...Platform.select({
      web: { boxShadow: '0 1px 2px rgba(0,0,0,0.16)' },
      default: { elevation: 1 },
    }),
  },
  segmentText: {
    fontFamily,
    fontSize: 13,
    fontWeight: '500',
    color: MOBILE.label,
    letterSpacing: -0.2,
  },
  segmentTextActive: {
    fontWeight: '600',
  },
  empty: {
    flex: 1,
    minHeight: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 24,
    paddingBottom: 48,
  },
  emptyTitle: {
    fontFamily,
    fontSize: 22,
    fontWeight: '600',
    color: TEXT,
    letterSpacing: -0.4,
  },
  emptyBody: {
    fontFamily,
    fontSize: 15,
    lineHeight: 21,
    color: SECONDARY,
    textAlign: 'center',
    maxWidth: 320,
  },
  list: {
    flex: 1,
    minHeight: 0,
  },
  listContentInset: {
    paddingHorizontal: 16,
    paddingBottom: Math.max(28, mobileSafeBottom() + 8),
  },
  listGroup: {
    backgroundColor: '#fff',
    borderRadius: 12,
    overflow: 'hidden',
  },
  listStack: {
    gap: 10,
  },
  card: {
    backgroundColor: '#fff',
    padding: 14,
    gap: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: MOBILE.separator,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  cardMobile: {
    borderRadius: 0,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  cardTitleRow: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  txKind: {
    fontFamily,
    fontSize: 12,
    fontWeight: '700',
    color: ACCENT,
  },
  txKindBuy: {
    color: '#1d4ed8',
  },
  txRef: {
    fontFamily,
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: TEXT,
    letterSpacing: -0.2,
  },
  cardSub: {
    fontFamily,
    fontSize: 14,
    color: TEXT,
  },
  cardMeta: {
    fontFamily,
    fontSize: 13,
    color: SECONDARY,
  },
  savedCorrections: {
    gap: 8,
    paddingTop: 4,
  },
  savedCorrection: {
    gap: 2,
  },
  savedMuted: {
    fontFamily,
    fontSize: 13,
    color: SECONDARY,
    paddingTop: 2,
  },
  savedBlock: {
    gap: 4,
  },
  savedNote: {
    fontFamily,
    fontSize: 15,
    lineHeight: 21,
    color: TEXT,
  },
  savedAmount: {
    fontFamily,
    fontSize: 16,
    fontWeight: '600',
    color: TEXT,
  },
  fieldLabel: {
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
    color: SECONDARY,
  },
  correctionPair: {
    gap: 2,
  },
  struckText: {
    fontFamily,
    fontSize: 13,
    color: SECONDARY,
    textDecorationLine: 'line-through',
  },
  correctedText: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: TEXT,
  },
});
