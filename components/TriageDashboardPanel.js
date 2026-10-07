/**
 * Triage dashboard: store home, then Lots and Errors inside a store.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  applyTriageReviewToPo,
  collectAccuracyTriagePos,
  collectAllTriagePos,
  deleteTriageDocument,
  persistTransferWorkflowNow,
  saveTriagePoReview,
  triageEditorFromSession,
  triagePoNeedsCorrection,
  useTransferWorkflow,
} from '../lib/transferWorkflow';
import {
  formatFineProgress,
  groupPosIntoLots,
  LOT_FINE_METALS,
  lotMatchesQuery,
  lotPeriodLabel,
  summarizeLotsFineMetals,
} from '../lib/triageLots';
import { formatAmount } from '../lib/transactions';
import { formatErrorAmount } from '../lib/triageDraft';
import { formatInsightPercent } from '../lib/triageInsights';
import { storesMatch } from '../lib/storeCatalog';
import { storeMarkColor } from '../lib/storeMarks';
import {
  listStoreErrorCounts,
  poInStore,
  summarizeStoreErrors,
} from '../lib/triageStoreErrors';
import { CANVAS, useIsMobile } from '../lib/mobileUi';
import {
  ChromeHero,
  ChromeListRow,
  ChromePage,
  EmptyState,
  FONT,
  ProgressBar,
  T,
  TextAction,
  TextTabs,
  TriageDrawer,
  confirmDestructive,
} from './TriageKit';
import { PoThumb } from './TriageTable';
import TriageReviewDrawer from './TriageReviewDrawer';
import { PoErrorSummaryPage } from './TriagePoCapture';

const fontFamily = FONT;

if (Platform.OS === 'web' && typeof document !== 'undefined') {
  const styleId = 'cgold-triage-dash-cards';
  let style = document.getElementById(styleId);
  if (!style) {
    style = document.createElement('style');
    style.id = styleId;
    document.head.appendChild(style);
  }
  style.textContent = [
    '.cgold-dash-card{cursor:pointer;}',
    '.cgold-dash-card:hover{background-color:#f5f5f5!important;}',
    '.cgold-dash-row{cursor:pointer;}',
    '.cgold-dash-row:hover{background-color:#f5f5f5!important;}',
  ].join('');
}

function staffName(row) {
  const name = String(row?.employeeName || '').trim();
  return name && name !== '—' ? name : '';
}

function errorTypeOf(row) {
  const type = String(row?.review?.errorType || '').trim();
  if (type && !/^notes?\s+only$/i.test(type)) return type;
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
  return 'Unspecified';
}

function errorAmountOf(row) {
  return Number(String(row?.review?.errorAmount || '').replace(/[^0-9.-]/g, '')) || 0;
}

function rankCounts(rows, getLabel) {
  const counts = new Map();
  for (const row of rows || []) {
    const label = String(getLabel(row) || '').trim() || 'Unspecified';
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], undefined, { sensitivity: 'base' }))
    .map(([label, count]) => ({ label, count }));
}

function summarizeErrors(rows) {
  const errors = (rows || []).filter(triagePoNeedsCorrection);
  const types = rankCounts(errors, errorTypeOf);
  const amount = errors.reduce((sum, row) => sum + errorAmountOf(row), 0);
  const stores = new Set(errors.map((row) => String(row.storeName || '').trim()).filter((name) => name && name !== '—'));
  return {
    rows: errors,
    count: errors.length,
    amount,
    stores: stores.size,
    topType: types[0] || null,
    types,
  };
}

function lotProgressOf(lot) {
  const expected = Number(lot?.expected) || 0;
  const evaluated = Number(lot?.evaluated) || 0;
  const percent = expected ? Math.round((evaluated / expected) * 100) : 0;
  return { expected, evaluated, percent, done: expected > 0 && evaluated >= expected };
}

function summarizeLots(lots) {
  let expected = 0;
  let evaluated = 0;
  for (const lot of lots || []) {
    expected += Number(lot.expected) || 0;
    evaluated += Number(lot.evaluated) || 0;
  }
  return {
    lots: (lots || []).length,
    expected,
    evaluated,
    percent: expected ? Math.round((evaluated / expected) * 100) : 0,
  };
}

function matchesQuery(row, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  return [
    row.reference,
    staffName(row),
    row.storeName,
    row.dateLabel,
    row.customerName,
    errorTypeOf(row),
    row.review?.note,
    row.review?.errorAmount,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .includes(q);
}

export const ERROR_LIST_SORTS = [
  { key: 'recent', label: 'Most recent added' },
  { key: 'oldest', label: 'Oldest added' },
  { key: 'date-new', label: 'By date, newest' },
  { key: 'date-old', label: 'By date, oldest' },
];

function timeOf(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function errorAddedTime(row) {
  return (
    timeOf(row?.review?.editedAt) ||
    timeOf(row?.review?.editedBy?.at) ||
    timeOf(row?.updatedAt) ||
    timeOf(row?.addedAt) ||
    timeOf(row?.createdAt) ||
    timeOf(row?.receivedAt) ||
    0
  );
}

function errorDocumentTime(row) {
  return timeOf(row?.date) || timeOf(row?.dateLabel) || 0;
}

function sortErrorRows(rows, sort) {
  const list = [...(rows || [])];
  const ref = (row) => String(row?.reference || '');
  list.sort((a, b) => {
    let delta = 0;
    if (sort === 'oldest') delta = errorAddedTime(a) - errorAddedTime(b);
    else if (sort === 'date-new') delta = errorDocumentTime(b) - errorDocumentTime(a);
    else if (sort === 'date-old') delta = errorDocumentTime(a) - errorDocumentTime(b);
    else delta = errorAddedTime(b) - errorAddedTime(a);
    if (delta) return delta;
    return ref(a).localeCompare(ref(b));
  });
  return list;
}

function emptyCopy(text) {
  return <Text style={styles.emptyCopy}>{text}</Text>;
}

const ANALYTICS_TABS = [
  { key: 'type', label: 'Error type', short: 'Type', icon: 'pricetag', iconColor: '#C2410C' },
  { key: 'items', label: 'Item', short: 'Item', icon: 'cube', iconColor: '#1D4ED8' },
  { key: 'employees', label: 'Employee', short: 'Staff', icon: 'person', iconColor: '#0F766E' },
  { key: 'value', label: 'Value', short: 'Value', icon: 'cash', iconColor: '#B45309' },
];

function AnalyticsPage({ rows = [] }) {
  const isMobile = useIsMobile();
  const [tab, setTab] = useState('type');
  const summary = useMemo(() => summarizeStoreErrors(rows), [rows]);
  const total = summary.count || 0;
  const tabMeta = ANALYTICS_TABS.find((option) => option.key === tab) || ANALYTICS_TABS[0];
  const tabOptions = useMemo(
    () =>
      ANALYTICS_TABS.map((option) => ({
        key: option.key,
        label: isMobile ? option.short : option.label,
      })),
    [isMobile],
  );

  let list = [];
  let empty = 'No errors recorded.';
  if (tab === 'type') {
    list = summary.types;
    empty = 'No error types recorded.';
  } else if (tab === 'items') {
    list = summary.items;
    empty = 'No items on recorded errors.';
  } else if (tab === 'employees') {
    list = (summary.employees || []).map((row) => ({
      label: row.name,
      count: row.count,
      amount: row.amount,
      percent: row.percent,
    }));
    empty = 'No employees on recorded errors.';
  } else {
    list = summary.values || [];
    empty = 'No error amounts recorded.';
  }

  if (!rows.length) {
    return (
      <EmptyState
        icon="stats-chart-outline"
        title="No analytics"
        body="Flagged POs and SOs land here after triage reviews them."
      />
    );
  }

  return (
    <ChromePage
      title="Analytics"
      meta={`${total} ${total === 1 ? 'error' : 'errors'}`}
      tableHeader={
        <View style={isMobile ? styles.analyticsTabsMobile : styles.analyticsTabs}>
          <TextTabs
            options={tabOptions}
            value={tab}
            onChange={setTab}
            size={isMobile ? 'md' : 'lg'}
            layout={isMobile ? 'segment' : 'bar'}
          />
        </View>
      }
      data={list}
      extraData={tab}
      keyExtractor={(row) => `${tab}-${row.label}`}
      renderItem={({ item: row, index }) => {
        const countLabel = `${row.count} ${row.count === 1 ? 'error' : 'errors'}`;
        const meta =
          tab === 'value' && row.amount ? `${countLabel} · ${formatAmount(row.amount)}` : countLabel;
        return (
          <ChromeListRow
            title={row.label}
            meta={meta}
            value={formatInsightPercent(row.percent, total)}
            icon={tabMeta.icon}
            iconColor={tabMeta.iconColor}
            last={index === list.length - 1}
            chevron={false}
            extra={
              <ProgressBar
                value={row.count}
                total={total || row.count || 1}
                tone="orange"
                height={isMobile ? 6 : 4}
                style={styles.analyticsRowBar}
              />
            }
          />
        );
      }}
    >
      {list.length ? null : emptyCopy(empty)}
    </ChromePage>
  );
}

function ErrorRowIcon({ label, icon, color, onPress }) {
  return (
    <Pressable
      onPress={(event) => {
        event?.stopPropagation?.();
        onPress?.();
      }}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Ionicons name={icon} size={18} color={color} />
    </Pressable>
  );
}

function ErrorsPage({ rows, query, onOpen, onDelete, inStore = false, sort = 'recent' }) {
  const visible = useMemo(
    () => sortErrorRows(rows.filter((row) => matchesQuery(row, query)), sort),
    [query, rows, sort],
  );
  const types = useMemo(() => rankCounts(visible, errorTypeOf), [visible]);
  const amount = useMemo(() => visible.reduce((sum, row) => sum + errorAmountOf(row), 0), [visible]);
  const storeCount = useMemo(
    () => new Set(visible.map((row) => String(row.storeName || '').trim()).filter((name) => name && name !== '—')).size,
    [visible],
  );

  if (!rows.length) {
    return (
      <EmptyState
        icon="alert-circle-outline"
        title="No errors"
        body="Flagged POs and SOs land here after triage reviews them."
      />
    );
  }

  return (
    <ChromePage
      hero={
        <ChromeHero
          icon="alert-circle"
          iconColor="#B91C1C"
          value={amount ? formatAmount(amount) : String(visible.length)}
          stats={[
            { label: visible.length === 1 ? 'Error' : 'Errors', value: String(visible.length) },
            ...(inStore
              ? []
              : [{ label: storeCount === 1 ? 'Store' : 'Stores', value: String(storeCount) }]),
            { label: types.length === 1 ? 'Type' : 'Types', value: String(types.length) },
          ]}
        />
      }
      title="Errors"
      meta={`${visible.length} error${visible.length === 1 ? '' : 's'}`}
      data={visible}
      extraData={sort}
      keyExtractor={(row) => `${row.triageId}-${row.id}`}
      renderItem={({ item: row, index }) => (
        <ChromeListRow
          title={row.reference || 'Document'}
          meta={[errorTypeOf(row), inStore ? null : row.storeName, staffName(row), row.dateLabel].filter(Boolean).join(' · ')}
          value={formatErrorAmount(row?.review?.errorAmount || '') || ''}
          leading={<PoThumb urls={row.imageUrls} label={row.reference} size={46} />}
          last={index === visible.length - 1}
          onPress={() => onOpen(row)}
          chevron={false}
          trailing={
            <View style={styles.errorRowActions}>
              <ErrorRowIcon
                label={`Edit error for ${row.reference || 'document'}`}
                icon="create-outline"
                color="#007AFF"
                onPress={() => onOpen(row)}
              />
              {onDelete ? (
                <ErrorRowIcon
                  label={`Delete ${row.reference || 'document'}`}
                  icon="trash-outline"
                  color="#B91C1C"
                  onPress={() =>
                    confirmDestructive(
                      'Delete PO',
                      `Remove ${row.reference || 'this document'} from this store?`,
                      () => onDelete(row),
                    )
                  }
                />
              ) : null}
            </View>
          }
        />
      )}
    >
      {visible.length
        ? null
        : emptyCopy(query.trim() ? `No error matches “${query.trim()}”.` : 'No errors.')}
    </ChromePage>
  );
}

function LotsPage({ lots, allRows, errors, query, onOpen }) {
  const isMobile = useIsMobile();
  const visible = useMemo(() => lots.filter((lot) => lotMatchesQuery(lot, query)), [lots, query]);
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const totals = useMemo(() => {
    let expected = 0;
    let evaluated = 0;
    for (const lot of visible) {
      expected += Number(lot.expected) || 0;
      evaluated += Number(lot.evaluated) || 0;
    }
    return {
      expected,
      evaluated,
      percent: expected ? Math.round((evaluated / expected) * 100) : 0,
      done: expected > 0 && evaluated >= expected,
    };
  }, [visible]);
  const metals = useMemo(() => summarizeLotsFineMetals(visible, allRows), [allRows, visible]);
  const errorTypes = useMemo(() => rankCounts(errors?.rows, errorTypeOf), [errors]);

  if (!lots.length) {
    return (
      <EmptyState
        icon="folder-outline"
        title="No lots"
        body="Finish a PO to create its lot. Lots group every PO / SO from the same store and month."
      />
    );
  }

  return (
    <>
    <ChromePage
      hero={
        <ChromeHero
          icon="folder"
          iconColor="#8A6D1F"
          value={totals.expected ? `${totals.percent}%` : String(visible.length)}
          stats={[
            { label: visible.length === 1 ? 'Lot' : 'Lots', value: String(visible.length) },
            {
              label: 'Progress',
              value: totals.expected ? `${totals.evaluated}/${totals.expected}` : '—',
            },
            { label: 'Errors', value: String(errors?.count || 0) },
          ]}
          footer={
            totals.expected ? (
              <ProgressBar
                value={totals.evaluated}
                total={totals.expected}
                height={7}
                tone={totals.done ? 'green' : 'blue'}
              />
            ) : null
          }
          onPress={() => setBreakdownOpen(true)}
          accessibilityLabel="Open lot progress and metal weights"
        />
      }
      title="Lots"
      meta={`${visible.length} ${visible.length === 1 ? 'lot' : 'lots'}`}
      data={visible}
      keyExtractor={(lot) => lot.id}
      renderItem={({ item: lot, index }) => {
        const progress = lotProgressOf(lot);
        return (
          <ChromeListRow
            title={lot.id}
            meta={[
              lot.location,
              lotPeriodLabel(lot),
              `${lot.pos.length} ${lot.pos.length === 1 ? 'PO' : 'POs'}`,
              lot.incorrect ? `${lot.incorrect} ${lot.incorrect === 1 ? 'error' : 'errors'}` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
            value={progress.expected ? `${progress.evaluated}/${progress.expected}` : String(lot.pos.length)}
            icon="folder"
            iconColor="#8A6D1F"
            last={index === visible.length - 1}
            onPress={onOpen ? () => onOpen(lot) : undefined}
            chevron={Boolean(onOpen)}
            extra={
              progress.expected ? (
                <ProgressBar
                  value={progress.evaluated}
                  total={progress.expected}
                  tone={progress.done ? 'green' : 'blue'}
                  height={6}
                  style={styles.lotRowBar}
                />
              ) : null
            }
          />
        );
      }}
    >
      {visible.length
        ? null
        : emptyCopy(query.trim() ? `No lot matches “${query.trim()}”.` : 'No lots.')}
    </ChromePage>
    <TriageDrawer
      visible={breakdownOpen}
      onClose={() => setBreakdownOpen(false)}
      title="Lots"
      subtitle={
        totals.expected
          ? `${totals.evaluated} of ${totals.expected} melt POs · bullion-only excluded`
          : `${visible.length} ${visible.length === 1 ? 'lot' : 'lots'}`
      }
      leftLabel="Done"
      onLeft={() => setBreakdownOpen(false)}
      widthRatio={0.38}
      minWidth={360}
    >
      <ScrollView style={styles.breakScroll} contentContainerStyle={[styles.breakPad, isMobile && styles.breakPadMobile]} showsVerticalScrollIndicator={false}>
        <Text style={styles.breakKicker}>Progress</Text>
        <Text style={styles.breakValue}>{totals.expected ? `${totals.percent}%` : '—'}</Text>
        <Text style={styles.breakMeta}>
          {totals.expected ? `${totals.evaluated} / ${totals.expected} evaluated` : 'No melt POs yet'}
        </Text>
        {totals.expected ? (
          <ProgressBar
            value={totals.evaluated}
            total={totals.expected}
            tone={totals.done ? 'green' : 'blue'}
            height={6}
            style={styles.breakBar}
          />
        ) : null}

        <Text style={[styles.breakKicker, styles.breakSection]}>Fine metal</Text>
        {LOT_FINE_METALS.map((metal, index) => {
          const expected = metals.expected[metal.key] || 0;
          const completed = metals.completed[metal.key] || 0;
          return (
            <View key={metal.key} style={[styles.breakRow, index === LOT_FINE_METALS.length - 1 && styles.breakRowLast]}>
              <View style={styles.breakCopy}>
                <Text style={styles.breakLabel}>{metal.label}</Text>
                <Text style={styles.breakCount}>{formatFineProgress(completed, expected)}</Text>
              </View>
              <Text style={styles.breakHint}>{metal.name}</Text>
              <ProgressBar
                value={completed}
                total={expected || completed || 1}
                tone={expected > 0 && completed >= expected ? 'green' : 'blue'}
                height={4}
              />
            </View>
          );
        })}

        <Text style={[styles.breakKicker, styles.breakSection]}>Errors</Text>
        {errorTypes.length ? (
          errorTypes.map((row, index) => (
            <View key={row.label} style={[styles.breakRow, index === errorTypes.length - 1 && styles.breakRowLast]}>
              <View style={styles.breakCopy}>
                <Text style={styles.breakLabel}>{row.label}</Text>
                <Text style={styles.breakCount}>{row.count}</Text>
              </View>
              <ProgressBar value={row.count} total={errors?.count || row.count} tone="orange" height={4} />
            </View>
          ))
        ) : (
          <Text style={styles.breakHint}>No errors in these lots.</Text>
        )}
      </ScrollView>
    </TriageDrawer>
    </>
  );
}

export default function TriageDashboardPanel({
  session,
  onRequireLogin,
  active = true,
  listQuery = '',
  page = '',
  onPageChange,
  onBackChange,
  onOpenLot,
  onStoresViewChange,
  storesNavRef,
  onReviewOpenChange,
  errorSort = 'recent',
}) {
  const { triage, remoteLoaded = false, localReady = false } = useTransferWorkflow();
  // Cached rows paint straight away; the delta pull refreshes them in place.
  const countsLoading = !remoteLoaded && !(localReady && triage.length > 0);
  const isMobile = useIsMobile();
  const [openRow, setOpenRow] = useState(null);
  const [editingError, setEditingError] = useState(false);

  useEffect(() => {
    if (!onReviewOpenChange) return undefined;
    onReviewOpenChange(Boolean(openRow));
    return () => onReviewOpenChange(false);
  }, [onReviewOpenChange, openRow]);
  const [selectedStore, setSelectedStore] = useState('');

  const needPos = active && Boolean(selectedStore || page);
  const evaluated = useMemo(() => (needPos ? collectAccuracyTriagePos(triage) : []), [needPos, triage]);
  const allRows = useMemo(() => (needPos ? collectAllTriagePos(triage) : []), [needPos, triage]);
  const lots = useMemo(() => (needPos ? groupPosIntoLots(evaluated, allRows) : []), [allRows, evaluated, needPos]);
  const errors = useMemo(() => (needPos ? summarizeErrors(evaluated) : { rows: [], count: 0, amount: 0, stores: 0, topType: null, types: [] }), [evaluated, needPos]);
  const storeRows = useMemo(() => (active ? listStoreErrorCounts(triage) : []), [active, triage]);
  const visibleStoreRows = useMemo(() => {
    const q = String(listQuery || '').trim().toLowerCase();
    if (!q) return storeRows;
    return storeRows.filter((row) => String(row.store || '').toLowerCase().includes(q));
  }, [listQuery, storeRows]);
  const storeTotals = useMemo(
    () => storeRows.reduce((sum, row) => sum + (Number(row.count) || 0), 0),
    [storeRows],
  );
  const scopedEvaluated = useMemo(
    () => (selectedStore ? evaluated.filter((row) => poInStore(row, selectedStore)) : evaluated),
    [evaluated, selectedStore],
  );
  const scopedAllRows = useMemo(
    () => (selectedStore ? allRows.filter((row) => poInStore(row, selectedStore)) : allRows),
    [allRows, selectedStore],
  );
  const scopedLots = useMemo(
    () =>
      selectedStore
        ? groupPosIntoLots(scopedEvaluated, scopedAllRows).filter((lot) => storesMatch(lot.location, selectedStore))
        : lots,
    [lots, scopedAllRows, scopedEvaluated, selectedStore],
  );
  const scopedErrors = useMemo(
    () => (selectedStore ? summarizeErrors(scopedEvaluated) : errors),
    [errors, scopedEvaluated, selectedStore],
  );
  const lotSummary = useMemo(() => summarizeLots(scopedLots), [scopedLots]);

  const openPage = useCallback((key) => onPageChange?.(key || ''), [onPageChange]);
  const openStore = useCallback((storeName = '') => {
    setSelectedStore(String(storeName || '').trim());
    onPageChange?.('');
  }, [onPageChange]);
  const closeStore = useCallback(() => {
    setSelectedStore('');
    onPageChange?.('');
  }, [onPageChange]);
  const closePage = useCallback(() => {
    if (page) {
      onPageChange?.('');
      return;
    }
    closeStore();
  }, [closeStore, onPageChange, page]);

  useEffect(() => {
    if (page && page !== 'lots' && page !== 'errors' && page !== 'analytics') {
      onPageChange?.('');
    }
  }, [onPageChange, page]);

  useEffect(() => {
    onStoresViewChange?.({
      selectedStore,
      selectedRegion: '',
      selectedRegionLabel: selectedStore,
    });
  }, [onStoresViewChange, selectedStore]);

  useEffect(() => {
    if (!storesNavRef) return undefined;
    storesNavRef.current = {
      closeStore,
      closeRegion: closeStore,
    };
    return () => {
      storesNavRef.current = { closeStore() {}, closeRegion() {} };
    };
  }, [closeStore, storesNavRef]);

  const closeOpenError = useCallback(() => {
    setEditingError(false);
    setOpenRow(null);
  }, []);

  useEffect(() => {
    if (page === 'errors') return undefined;
    setEditingError(false);
    setOpenRow(null);
    return undefined;
  }, [page]);

  useEffect(() => {
    if (!active) return undefined;
    if (page === 'errors' && openRow) {
      onBackChange?.(closeOpenError, { dateLabel: openRow.reference || 'Error' });
      return () => onBackChange?.(null, null);
    }
    if (!page && !selectedStore) {
      onBackChange?.(null, null);
      return () => onBackChange?.(null, null);
    }
    const titles = {
      errors: 'Errors',
      lots: 'Lots',
      analytics: 'Analytics',
    };
    const label = page ? titles[page] || 'Dashboard' : selectedStore || 'Store';
    onBackChange?.(closePage, { dateLabel: label });
    return () => onBackChange?.(null, null);
  }, [active, closeOpenError, closePage, onBackChange, openRow, page, selectedStore]);

  const saveReview = useCallback(
    (poId, review) => {
      const saved = saveTriagePoReview(poId, review, triageEditorFromSession(session));
      setOpenRow((current) => (current?.id === poId ? applyTriageReviewToPo(current, saved || review) : current));
    },
    [session],
  );

  const deletePo = useCallback(
    (row) => {
      if (!row?.id) return;
      deleteTriageDocument(row.id, triageEditorFromSession(session)?.name || '');
      persistTransferWorkflowNow();
      setOpenRow((current) => (current?.id === row.id ? null : current));
    },
    [session],
  );

  if (!session?.token) {
    return (
      <View style={[styles.body, isMobile && styles.bodyMobile]}>
        <EmptyState
          icon="lock-closed-outline"
          title="Sign in to triage"
          body="Log in to see store errors and lots."
          action={<TextAction label="Go to Profile" strong onPress={onRequireLogin} />}
        />
      </View>
    );
  }

  const storeList = (
    <>
      {visibleStoreRows.map((row, index) => (
        <ChromeListRow
          key={row.store}
          title={row.store}
          meta={
            countsLoading
              ? 'Loading errors…'
              : row.count
                ? `${row.count} ${row.count === 1 ? 'error' : 'errors'}`
                : 'No errors'
          }
          value={String(row.count || 0)}
          loading={countsLoading}
          extra={
            !countsLoading && storeTotals ? (
              <ProgressBar
                value={row.count}
                total={storeTotals}
                tone="orange"
                height={4}
                style={styles.regionBar}
              />
            ) : null
          }
          icon="storefront"
          iconColor={storeMarkColor(row.store)}
          last={index === visibleStoreRows.length - 1}
          onPress={() => openStore(row.store)}
        />
      ))}
    </>
  );

  const home = (
    <ChromePage title={isMobile ? undefined : 'Stores'} filterPad={false}>
      {visibleStoreRows.length
        ? storeList
        : emptyCopy(listQuery.trim() ? `No store matches “${listQuery.trim()}”.` : 'No stores.')}
    </ChromePage>
  );

  const storeTools = (
    <ChromePage title={isMobile ? undefined : selectedStore} filterPad={false}>
      <ChromeListRow
        title="Lots"
        meta={
          scopedLots.length
            ? `${lotSummary.evaluated} evaluated · ${lotSummary.percent}% · ${lotSummary.lots} ${lotSummary.lots === 1 ? 'lot' : 'lots'}`
            : 'No lots yet'
        }
        value={String(lotSummary.lots)}
        icon="folder"
        iconColor="#8A6D1F"
        onPress={() => openPage('lots')}
      />
      <ChromeListRow
        title="Errors"
        meta={
          countsLoading
            ? 'Loading errors…'
            : scopedErrors.count
              ? [
                  scopedErrors.topType ? `${scopedErrors.topType.label} most common` : null,
                  scopedErrors.amount ? formatAmount(scopedErrors.amount) : null,
                  scopedErrors.stores ? `${scopedErrors.stores} ${scopedErrors.stores === 1 ? 'store' : 'stores'}` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')
              : 'No flagged POs yet'
        }
        value={String(scopedErrors.count)}
        loading={countsLoading}
        icon="alert-circle"
        iconColor="#B91C1C"
        onPress={() => openPage('errors')}
      />
      <ChromeListRow
        title="Analytics"
        meta={
          countsLoading
            ? 'Loading errors…'
            : scopedErrors.count
              ? `${scopedErrors.types.length} ${scopedErrors.types.length === 1 ? 'type' : 'types'} · ${scopedErrors.stores} ${scopedErrors.stores === 1 ? 'store' : 'stores'}`
              : 'Error type, item, employee, value'
        }
        value={scopedErrors.count ? `${scopedErrors.types.length}` : '0'}
        loading={countsLoading}
        icon="analytics"
        iconColor="#4F46E5"
        last
        onPress={() => openPage('analytics')}
      />
    </ChromePage>
  );

  return (
    <View style={[styles.body, isMobile && styles.bodyMobile]}>
      {page === 'errors' ? (
        openRow ? (
          <PoErrorSummaryPage
            po={openRow}
            onClose={closeOpenError}
            onEdit={() => setEditingError(true)}
          />
        ) : (
          <ErrorsPage
            rows={scopedErrors.rows}
            query={listQuery}
            onOpen={setOpenRow}
            onDelete={deletePo}
            inStore={Boolean(selectedStore)}
            sort={errorSort}
          />
        )
      ) : page === 'analytics' ? (
        <AnalyticsPage rows={scopedErrors.rows} />
      ) : page === 'lots' ? (
        <LotsPage
          lots={scopedLots}
          allRows={scopedAllRows}
          errors={scopedErrors}
          query={listQuery}
          onOpen={onOpenLot ? (lot) => onOpenLot(lot.id) : undefined}
        />
      ) : selectedStore ? (
        storeTools
      ) : (
        home
      )}

      <TriageReviewDrawer
        visible={Boolean(openRow) && editingError}
        session={session}
        row={openRow}
        review={openRow?.review || null}
        extraRows={scopedErrors.rows}
        startAt="reporting"
        onClose={() => setEditingError(false)}
        onSave={saveReview}
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
  bodyMobile: {
    backgroundColor: CANVAS,
  },
  emptyCopy: {
    fontFamily,
    fontSize: 15,
    lineHeight: 20,
    color: '#8e8e93',
    paddingHorizontal: 16,
    paddingVertical: 18,
    backgroundColor: '#fff',
  },
  regionBar: {
    marginTop: 6,
    alignSelf: 'stretch',
    maxWidth: 220,
  },
  analyticsTabs: {
    paddingHorizontal: 4,
    paddingBottom: 8,
  },
  analyticsTabsMobile: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 10,
  },
  analyticsRowBar: {
    marginTop: 6,
    alignSelf: 'stretch',
    maxWidth: 220,
  },
  errorRowActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingRight: 2,
  },
  lotRowBar: {
    marginTop: 6,
    alignSelf: 'stretch',
    maxWidth: 220,
  },
  breakScroll: {
    flex: 1,
    minHeight: 0,
  },
  breakPad: {
    paddingHorizontal: 22,
    paddingTop: 18,
    paddingBottom: 40,
  },
  breakPadMobile: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 28,
  },
  breakKicker: {
    fontFamily,
    fontSize: 11,
    fontWeight: '600',
    color: T.secondary,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  breakValue: {
    fontFamily,
    fontSize: 34,
    fontWeight: '600',
    color: T.text,
    letterSpacing: -0.8,
    marginTop: 4,
  },
  breakMeta: {
    fontFamily,
    fontSize: 13,
    color: T.secondary,
    marginTop: 2,
    marginBottom: 10,
  },
  breakSection: {
    marginTop: 22,
    marginBottom: 8,
  },
  breakRow: {
    paddingVertical: 8,
    gap: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: T.hairline,
  },
  breakRowLast: {
    borderBottomWidth: 0,
  },
  breakCopy: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 12,
  },
  breakLabel: {
    fontFamily,
    flex: 1,
    minWidth: 0,
    fontSize: 15,
    color: T.text,
  },
  breakCount: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: T.secondary,
    fontVariant: ['tabular-nums'],
  },
  breakHint: {
    fontFamily,
    fontSize: 12,
    color: T.secondary,
  },
  breakBar: {
    marginTop: 2,
  },
});
