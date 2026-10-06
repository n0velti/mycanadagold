/**
 * Triage dashboard: region home, then Errors, Allocation, and Expected Return.
 * Mobile matches the Home tab: hero, stat row, full-bleed list.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  applyTriageReviewToPo,
  collectAccuracyTriagePos,
  collectAllTriagePos,
  persistTransferWorkflowNow,
  RECEIVE_STATUS,
  RECEIVE_STATUS_LABELS,
  saveTriagePoAllocation,
  saveTriagePoReview,
  transferGoesToWorkshop,
  triageEditorFromSession,
  triagePoNeedsCorrection,
  useTransferWorkflow,
} from '../lib/transferWorkflow';
import {
  allocationDraftFromSaved,
  allocationSummaryLabel,
  formatGrams,
  isAllocationComplete,
  summarizePoAllocations,
  TRIAGE_DESTINATIONS,
} from '../lib/triageAllocations';
import {
  formatFineProgress,
  groupPosIntoLots,
  LOT_FINE_METALS,
  lotMatchesQuery,
  lotPeriodLabel,
  summarizeLotsFineMetals,
} from '../lib/triageLots';
import { STORE_REGIONS, regionKeyForStore, storeNameInRegion } from '../lib/storeCatalog';
import { formatAmount } from '../lib/transactions';
import { formatErrorAmount } from '../lib/triageDraft';
import { currentErrorPeriod, errorStoreName, listRegionErrorSummaries } from '../lib/triageStoreErrors';
import { CANVAS, useIsMobile } from '../lib/mobileUi';
import {
  ChromeHero,
  ChromeListRow,
  ChromePage,
  EmptyState,
  FONT,
  PageWithBack,
  ProgressBar,
  T,
  TextAction,
  TriageDrawer,
} from './TriageKit';
import { PoThumb } from './TriageTable';
import TriageAllocationForm from './TriageAllocationForm';
import TriageReviewDrawer from './TriageReviewDrawer';
import TriageStoresPanel from './TriageStoresPanel';

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

function summarizeTransfers(planned) {
  const rows = [...(planned || [])].sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0));
  let open = 0;
  let partial = 0;
  let received = 0;
  let workshop = 0;
  for (const row of rows) {
    if (row.receiveStatus === RECEIVE_STATUS.all_received) received += 1;
    else if (row.receiveStatus === RECEIVE_STATUS.partially_received) partial += 1;
    else open += 1;
    if (transferGoesToWorkshop(row)) workshop += 1;
  }
  return { rows, count: rows.length, open, partial, received, workshop };
}

function transferStatusLabel(row) {
  return RECEIVE_STATUS_LABELS[row?.receiveStatus] || 'Not Received';
}

function transferPathLabel(row) {
  const from = String(row?.fromName || '').trim();
  const to = String(row?.toName || '').trim();
  if (from && to) return `${from} → ${to}`;
  return from || to || 'Transfer';
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

function emptyCopy(text) {
  return <Text style={styles.emptyCopy}>{text}</Text>;
}

const REGION_ICON_COLORS = {
  ottawa: '#B91C1C',
  quebec: '#0F766E',
  halifax: '#1D4ED8',
  gta: '#2F8A4E',
  pmx: '#6B4DE6',
  west: '#C2410C',
};

function regionTitle(key) {
  return STORE_REGIONS.find((region) => region.key === key)?.label || '';
}

function regionStoreMeta(region) {
  return region.storeCount === 1 ? '1 store' : `${region.storeCount || 0} stores`;
}

function rowInRegion(row, regionKey) {
  return storeNameInRegion(errorStoreName(row) || row?.storeName, regionKey);
}

function transferInRegion(row, regionKey) {
  if (!regionKey) return true;
  return (
    regionKeyForStore(row?.fromName) === regionKey || regionKeyForStore(row?.toName) === regionKey
  );
}

function ErrorsPage({ rows, query, onOpen }) {
  const visible = useMemo(() => rows.filter((row) => matchesQuery(row, query)), [query, rows]);
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
            { label: storeCount === 1 ? 'Store' : 'Stores', value: String(storeCount) },
            { label: types.length === 1 ? 'Type' : 'Types', value: String(types.length) },
          ]}
        />
      }
      title="Errors"
      meta={`${visible.length} error${visible.length === 1 ? '' : 's'}`}
      data={visible}
      keyExtractor={(row) => `${row.triageId}-${row.id}`}
      renderItem={({ item: row, index }) => (
        <ChromeListRow
          title={row.reference || 'Document'}
          meta={[errorTypeOf(row), row.storeName, staffName(row), row.dateLabel].filter(Boolean).join(' · ')}
          value={formatErrorAmount(row?.review?.errorAmount || '') || ''}
          leading={<PoThumb urls={row.imageUrls} label={row.reference} size={46} />}
          last={index === visible.length - 1}
          onPress={() => onOpen(row)}
        />
      )}
    >
      {visible.length
        ? null
        : emptyCopy(query.trim() ? `No error matches “${query.trim()}”.` : 'No errors.')}
    </ChromePage>
  );
}

function TransfersPage({ summary }) {
  return (
    <ChromePage
      hero={
        <ChromeHero
          icon="swap-horizontal"
          iconColor="#1F7A9A"
          value={String(summary.count)}
          stats={[
            { label: 'Open', value: String(summary.open) },
            { label: 'Partial', value: String(summary.partial) },
            { label: 'Received', value: String(summary.received) },
          ]}
        />
      }
      title="Transfers"
      meta={String(summary.count)}
      data={summary.rows}
      keyExtractor={(row) => String(row.id)}
      renderItem={({ item: row, index }) => (
        <ChromeListRow
          title={row.reference || `TR# ${row.number || ''}`}
          meta={[transferPathLabel(row), row.dateLabel].filter(Boolean).join(' · ')}
          value={transferStatusLabel(row)}
          icon="swap-horizontal"
          iconColor="#1F7A9A"
          last={index === summary.rows.length - 1}
          chevron={false}
        />
      )}
    >
      {summary.rows.length
        ? null
        : emptyCopy('Store-to-workshop transfers land here as they are created.')}
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
            meta={[lot.location, lotPeriodLabel(lot), `${lot.pos.length} ${lot.pos.length === 1 ? 'PO' : 'POs'}`]
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

function AllocationPage({ rows, session }) {
  const isMobile = useIsMobile();
  const summary = useMemo(() => summarizePoAllocations(rows), [rows]);
  const [openPo, setOpenPo] = useState(null);
  const [draft, setDraft] = useState({ lines: [] });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const allocatedGrams = TRIAGE_DESTINATIONS.reduce(
    (sum, dest) => sum + (summary.totals[dest.id]?.objectGrams || 0),
    0,
  );
  const destCount = TRIAGE_DESTINATIONS.filter((dest) => (summary.totals[dest.id]?.objectGrams || 0) > 0).length;

  const open = (po) => {
    setOpenPo(po);
    setDraft(allocationDraftFromSaved(po, po.allocation));
    setError('');
  };

  const save = () => {
    if (!openPo || saving) return;
    if (!isAllocationComplete(draft)) {
      setError('Allocate the full object weight of each line.');
      return;
    }
    setSaving(true);
    try {
      saveTriagePoAllocation(openPo.id, draft, triageEditorFromSession(session));
      persistTransferWorkflowNow().catch(() => {});
      setOpenPo(null);
    } catch (err) {
      setError(err?.message || 'Could not save allocation.');
    } finally {
      setSaving(false);
    }
  };

  const listed = [...summary.rows].sort((a, b) => Number(a.complete) - Number(b.complete));

  return (
    <>
      <ChromePage
        hero={
          <ChromeHero
            icon="git-branch"
            iconColor="#3A3A3C"
            value={String(summary.allocated)}
            stats={[
              { label: 'Ready', value: String(summary.ready) },
              { label: 'Weight', value: `${formatGrams(allocatedGrams)} g` },
              { label: destCount === 1 ? 'Place' : 'Places', value: String(destCount) },
            ]}
          />
        }
        title="Purchase orders"
        meta={`${summary.allocated} allocated`}
        data={listed}
        keyExtractor={(row) => row.po.id}
        renderItem={({ item: row, index }) => (
          <ChromeListRow
            title={row.po.reference || row.po.id}
            meta={
              row.complete
                ? [allocationSummaryLabel(row.allocation), row.po.storeName].filter(Boolean).join(' · ')
                : [row.po.storeName, row.po.dateLabel, 'Needs allocation'].filter(Boolean).join(' · ')
            }
            value={row.complete ? 'Allocated' : 'Open'}
            icon={row.complete ? 'git-branch' : 'ellipse-outline'}
            iconColor={row.complete ? '#3A3A3C' : '#C2410C'}
            last={index === listed.length - 1}
            onPress={() => open(row.po)}
          />
        )}
      >
        {listed.length
          ? null
          : emptyCopy('Finish a PO from Add to allocate 100Ways, Umicore, PMX, RCM, or Oliver here.')}
      </ChromePage>
      <TriageDrawer
        visible={Boolean(openPo)}
        onClose={() => setOpenPo(null)}
        title="Allocate"
        subtitle={openPo?.reference || ''}
        leftLabel="Close"
        onLeft={() => setOpenPo(null)}
        rightLabel={saving ? 'Saving…' : 'Finish'}
        onRight={save}
        widthRatio={0.42}
        minWidth={380}
      >
        <ScrollView style={styles.breakScroll} contentContainerStyle={[styles.breakPad, isMobile && styles.breakPadMobile]} showsVerticalScrollIndicator={false}>
          <TriageAllocationForm draft={draft} onChange={setDraft} disabled={saving} />
          {error ? <Text style={styles.allocError}>{error}</Text> : null}
        </ScrollView>
      </TriageDrawer>
    </>
  );
}

function ExpectedReturnPage({ lots, summary }) {
  if (!lots.length) {
    return (
      <EmptyState
        icon="trending-up-outline"
        title="No expected return"
        body="Finish POs into lots and expected melt return will show here."
      />
    );
  }

  return (
    <ChromePage
      hero={
        <ChromeHero
          icon="trending-up"
          iconColor="#1F8A4E"
          value={String(summary.expected)}
          stats={[
            { label: 'Evaluated', value: String(summary.evaluated) },
            { label: 'Percent', value: summary.expected ? `${summary.percent}%` : '—' },
            { label: summary.lots === 1 ? 'Lot' : 'Lots', value: String(summary.lots) },
          ]}
        />
      }
      title="Lots"
      meta={String(lots.length)}
      data={lots}
      keyExtractor={(lot) => lot.id}
      renderItem={({ item: lot, index }) => {
        const progress = lotProgressOf(lot);
        return (
          <ChromeListRow
            title={lot.id}
            meta={[lot.location, lotPeriodLabel(lot)].filter(Boolean).join(' · ')}
            value={progress.expected ? `${progress.evaluated}/${progress.expected}` : String(lot.pos.length)}
            icon="folder"
            iconColor="#1F8A4E"
            last={index === lots.length - 1}
            chevron={false}
          />
        );
      }}
    >
    </ChromePage>
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
  onOpenTab,
  onStoresViewChange,
  storesNavRef,
  storePeriod: storePeriodProp,
  storeInsightTab = 'purchases',
  onStoreInsightTabChange,
  onStorePeriodChange,
  onReviewOpenChange,
}) {
  const { triage, planned = [] } = useTransferWorkflow();
  const isMobile = useIsMobile();
  const [openRow, setOpenRow] = useState(null);

  useEffect(() => {
    if (!onReviewOpenChange) return undefined;
    onReviewOpenChange(Boolean(openRow));
    return () => onReviewOpenChange(false);
  }, [onReviewOpenChange, openRow]);
  const [selectedStore, setSelectedStore] = useState('');
  const [selectedRegion, setSelectedRegion] = useState('');
  const [storePeriodLocal, setStorePeriodLocal] = useState(() => currentErrorPeriod());
  const storePeriod = storePeriodProp || storePeriodLocal;
  const setStorePeriod = onStorePeriodChange || setStorePeriodLocal;

  const evaluated = useMemo(() => (active ? collectAccuracyTriagePos(triage) : []), [active, triage]);
  const allRows = useMemo(() => (active ? collectAllTriagePos(triage) : []), [active, triage]);
  const scopedEvaluated = useMemo(
    () => (selectedRegion ? evaluated.filter((row) => rowInRegion(row, selectedRegion)) : evaluated),
    [evaluated, selectedRegion],
  );
  const scopedAllRows = useMemo(
    () => (selectedRegion ? allRows.filter((row) => rowInRegion(row, selectedRegion)) : allRows),
    [allRows, selectedRegion],
  );
  const lots = useMemo(
    () => (active ? groupPosIntoLots(scopedEvaluated, scopedAllRows) : []),
    [active, scopedAllRows, scopedEvaluated],
  );
  const allErrors = useMemo(
    () => (active ? summarizeErrors(evaluated) : { rows: [], count: 0, amount: 0, stores: 0, topType: null, types: [] }),
    [active, evaluated],
  );
  const errors = useMemo(
    () => (selectedRegion ? summarizeErrors(scopedEvaluated) : allErrors),
    [allErrors, scopedEvaluated, selectedRegion],
  );
  const regionRollup = useMemo(
    () =>
      active
        ? listRegionErrorSummaries(allErrors.rows, storePeriod, evaluated)
        : { regions: [], totals: { count: 0, amount: 0, evaluated: 0, rate: 0, stores: 0 } },
    [active, allErrors.rows, evaluated, storePeriod],
  );
  const activeRegion = useMemo(
    () => regionRollup.regions.find((region) => region.key === selectedRegion) || null,
    [regionRollup.regions, selectedRegion],
  );
  const lotSummary = useMemo(() => summarizeLots(lots), [lots]);
  const allocationSummary = useMemo(
    () => (active ? summarizePoAllocations(scopedAllRows) : { rows: [], total: 0, allocated: 0, ready: 0, totals: {} }),
    [active, scopedAllRows],
  );
  const transferSummary = useMemo(
    () =>
      active
        ? summarizeTransfers(selectedRegion ? planned.filter((row) => transferInRegion(row, selectedRegion)) : planned)
        : { rows: [], count: 0, open: 0, partial: 0, received: 0, workshop: 0 },
    [active, planned, selectedRegion],
  );

  const openPage = useCallback((key) => {
    onPageChange?.(key || '');
  }, [onPageChange]);
  const openRegion = useCallback((regionKey) => {
    setSelectedStore('');
    setSelectedRegion(regionKey);
    onPageChange?.('');
  }, [onPageChange]);
  const closePage = useCallback(() => {
    if (page === 'stores' && selectedStore) {
      setSelectedStore('');
      return;
    }
    if (page) {
      onPageChange?.('');
      return;
    }
    setSelectedRegion('');
  }, [onPageChange, page, selectedStore]);

  useEffect(() => {
    if (page !== 'stores') setSelectedStore('');
  }, [page]);

  useEffect(() => {
    onStoresViewChange?.({
      selectedStore: page === 'stores' ? selectedStore : '',
      selectedRegion,
      selectedRegionLabel: regionTitle(selectedRegion),
      period: storePeriod,
    });
  }, [onStoresViewChange, page, selectedRegion, selectedStore, storePeriod]);

  useEffect(() => {
    if (!storesNavRef) return undefined;
    storesNavRef.current = {
      closeStore: () => setSelectedStore(''),
      closeRegion: () => {
        setSelectedStore('');
        setSelectedRegion('');
      },
    };
    return () => {
      storesNavRef.current = { closeStore() {} };
    };
  }, [storesNavRef]);

  useEffect(() => {
    if (!active) return undefined;
    if (!page && !selectedRegion) {
      onBackChange?.(null, null);
      return () => onBackChange?.(null, null);
    }
    const titles = {
      errors: 'Errors',
      stores: selectedStore || 'Stores',
      shipments: 'Transfers',
      lots: 'Lots',
      allocation: 'Allocation',
      return: 'Expected Return',
    };
    const label = page ? titles[page] || 'Dashboard' : regionTitle(selectedRegion) || 'Dashboard';
    onBackChange?.(closePage, { dateLabel: label });
    return () => onBackChange?.(null, null);
  }, [active, closePage, onBackChange, page, selectedRegion, selectedStore]);

  const saveReview = useCallback(
    (poId, review) => {
      const saved = saveTriagePoReview(poId, review, triageEditorFromSession(session));
      setOpenRow((current) => (current?.id === poId ? applyTriageReviewToPo(current, saved || review) : current));
    },
    [session],
  );

  if (!session?.token) {
    return (
      <View style={[styles.body, isMobile && styles.bodyMobile]}>
        <EmptyState
          icon="lock-closed-outline"
          title="Sign in to triage"
          body="Log in to see errors, allocation, and expected return."
          action={<TextAction label="Go to Profile" strong onPress={onRequireLogin} />}
        />
      </View>
    );
  }

  const regionLabel = regionTitle(selectedRegion) || 'Triage';
  const pages = (
    <PageWithBack onPress={closePage} label="Regions">
    <ChromePage
      title={isMobile ? undefined : regionTitle(selectedRegion) || 'Triage'}
      meta={storePeriod.label}
      filterPad={false}
      hero={
        <ChromeHero
          value={activeRegion?.amount ? formatAmount(activeRegion.amount) : String(activeRegion?.count || 0)}
          stats={[
            { label: (activeRegion?.count || 0) === 1 ? 'Error' : 'Errors', value: String(activeRegion?.count || 0) },
            { label: 'Value', value: activeRegion?.amount ? formatAmount(activeRegion.amount) : '—' },
            { label: (activeRegion?.storeCount || 0) === 1 ? 'Store' : 'Stores', value: String(activeRegion?.storeCount || 0) },
          ]}
        />
      }
    >
      <ChromeListRow
        title="Lots"
        meta={
          lots.length
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
          errors.count
            ? [
                errors.topType ? `${errors.topType.label} most common` : null,
                errors.amount ? formatAmount(errors.amount) : null,
                errors.stores ? `${errors.stores} ${errors.stores === 1 ? 'store' : 'stores'}` : null,
              ]
                .filter(Boolean)
                .join(' · ')
            : 'No flagged POs yet'
        }
        value={String(errors.count)}
        icon="alert-circle"
        iconColor="#B91C1C"
        onPress={() => openPage('errors')}
      />
      <ChromeListRow
        title="Stores"
        meta={
          errors.stores
            ? `${errors.stores} ${errors.stores === 1 ? 'store' : 'stores'} with errors · ${storePeriod.label}`
            : `Stores in ${regionTitle(selectedRegion)} · ${storePeriod.label}`
        }
        value={String(activeRegion?.storeCount || errors.stores || 0)}
        icon="storefront"
        iconColor="#1F7A9A"
        onPress={() => openPage('stores')}
      />
      <ChromeListRow
        title="Transfers"
        meta={
          transferSummary.count
            ? `${transferSummary.open} open · ${transferSummary.partial} partial · ${transferSummary.received} received`
            : 'No transfers yet'
        }
        value={String(transferSummary.count)}
        icon="swap-horizontal"
        iconColor="#1F7A9A"
        onPress={() => openPage('shipments')}
      />
      <ChromeListRow
        title="Allocation"
        meta={
          allocationSummary.total
            ? `${allocationSummary.allocated} allocated · ${allocationSummary.ready} ready`
            : 'Nothing to allocate yet'
        }
        value={String(allocationSummary.allocated)}
        icon="git-branch"
        iconColor="#3A3A3C"
        onPress={() => openPage('allocation')}
      />
      <ChromeListRow
        title="Expected Return"
        meta={
          lotSummary.expected
            ? `${lotSummary.evaluated} evaluated · ${lotSummary.percent}% · ${lotSummary.lots} ${lotSummary.lots === 1 ? 'lot' : 'lots'}`
            : 'No expected melt yet'
        }
        value={lotSummary.expected ? String(lotSummary.expected) : '0'}
        icon="trending-up"
        iconColor="#1F8A4E"
        onPress={() => openPage('return')}
      />
      <ChromeListRow
        title="Deleted"
        meta="Removed POs and documents"
        value=""
        icon="trash"
        iconColor="#8E8E93"
        last
        onPress={() => onOpenTab?.('deleted')}
      />
    </ChromePage>
    </PageWithBack>
  );

  const home = (
    <ChromePage title={isMobile ? undefined : 'Regions'} meta={storePeriod.label} filterPad={false}>
      <View style={[styles.regionHeadRow, isMobile && styles.regionHeadRowMobile]}>
        <Text style={styles.regionHeadLabel}>Region</Text>
        <Text style={styles.regionHeadCount}>Errors</Text>
        <Text style={styles.regionHeadAmount}>Value</Text>
        <View style={styles.regionHeadChevron} />
      </View>
      {regionRollup.regions.map((region, index) => (
        <ChromeListRow
          key={region.key}
          title={region.label}
          meta={regionStoreMeta(region)}
          trailing={
            <View style={styles.regionMetrics}>
              <Text style={[styles.regionCount, isMobile && styles.regionCountMobile]} numberOfLines={1}>
                {region.count}
              </Text>
              <Text style={[styles.regionAmount, isMobile && styles.regionAmountMobile]} numberOfLines={1}>
                {region.amount ? formatAmount(region.amount) : '—'}
              </Text>
            </View>
          }
          icon="map"
          iconColor={REGION_ICON_COLORS[region.key] || '#3A3A3C'}
          last={index === regionRollup.regions.length - 1}
          onPress={() => openRegion(region.key)}
        />
      ))}
    </ChromePage>
  );

  return (
    <View style={[styles.body, isMobile && styles.bodyMobile]}>
      {page === 'errors' ? (
        <PageWithBack onPress={closePage} label={regionLabel}>
          <ErrorsPage rows={errors.rows} query={listQuery} onOpen={setOpenRow} />
        </PageWithBack>
      ) : page === 'stores' ? (
        <PageWithBack onPress={closePage} label={selectedStore ? 'Stores' : regionLabel}>
          <TriageStoresPanel
            rows={errors.rows}
            query={listQuery}
            month={storePeriod}
            onMonthChange={setStorePeriod}
            selectedStore={selectedStore}
            regionKey={selectedRegion}
            storeTab={storeInsightTab}
            onStoreTabChange={onStoreInsightTabChange}
            onOpenStore={(name) => setSelectedStore(name)}
            onOpenPo={setOpenRow}
            session={session}
          />
        </PageWithBack>
      ) : page === 'shipments' ? (
        <PageWithBack onPress={closePage} label={regionLabel}>
          <TransfersPage summary={transferSummary} />
        </PageWithBack>
      ) : page === 'lots' ? (
        <PageWithBack onPress={closePage} label={regionLabel}>
          <LotsPage
            lots={lots}
            allRows={allRows}
            errors={errors}
            query={listQuery}
            onOpen={onOpenLot ? (lot) => onOpenLot(lot.id) : undefined}
          />
        </PageWithBack>
      ) : page === 'allocation' ? (
        <PageWithBack onPress={closePage} label={regionLabel}>
          <AllocationPage rows={scopedAllRows} session={session} />
        </PageWithBack>
      ) : page === 'return' ? (
        <PageWithBack onPress={closePage} label={regionLabel}>
          <ExpectedReturnPage lots={lots} summary={lotSummary} />
        </PageWithBack>
      ) : selectedRegion ? (
        pages
      ) : (
        home
      )}

      <TriageReviewDrawer
        visible={Boolean(openRow)}
        session={session}
        row={openRow}
        review={openRow?.review || null}
        extraRows={errors.rows}
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
  regionHeadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 74,
    paddingRight: 16,
    paddingTop: 10,
    paddingBottom: 6,
    gap: 12,
  },
  regionHeadRowMobile: {
    paddingLeft: 84,
    paddingRight: 16,
  },
  regionHeadLabel: {
    fontFamily,
    flex: 1,
    minWidth: 0,
    fontSize: 12,
    fontWeight: '600',
    color: T.secondary,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  regionHeadCount: {
    fontFamily,
    width: 52,
    fontSize: 12,
    fontWeight: '600',
    color: T.secondary,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
    textAlign: 'right',
  },
  regionHeadAmount: {
    fontFamily,
    width: 88,
    fontSize: 12,
    fontWeight: '600',
    color: T.secondary,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
    textAlign: 'right',
  },
  regionHeadChevron: {
    width: 18,
  },
  regionMetrics: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  regionCount: {
    fontFamily,
    width: 52,
    fontSize: 15,
    fontWeight: '600',
    color: T.text,
    fontVariant: ['tabular-nums'],
    textAlign: 'right',
  },
  regionCountMobile: {
    fontSize: 16,
  },
  regionAmount: {
    fontFamily,
    width: 88,
    fontSize: 15,
    fontWeight: '600',
    color: T.text,
    fontVariant: ['tabular-nums'],
    textAlign: 'right',
  },
  regionAmountMobile: {
    fontSize: 16,
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
  allocError: {
    marginTop: 12,
    fontFamily,
    fontSize: 13,
    color: T.red,
  },
});
