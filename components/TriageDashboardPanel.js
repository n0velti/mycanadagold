/**
 * Triage dashboard: Errors, Allocation, and Expected Return.
 * Mobile matches the Home tab: hero, stat row, full-bleed list.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import {
  applyTriageReviewToPo,
  collectAccuracyTriagePos,
  collectAllTriagePos,
  RECEIVE_STATUS,
  RECEIVE_STATUS_LABELS,
  saveTriagePoReview,
  transferGoesToWorkshop,
  triageEditorFromSession,
  triagePoNeedsCorrection,
  useTransferWorkflow,
} from '../lib/transferWorkflow';
import { groupPosIntoLots, lotPeriodLabel } from '../lib/triageLots';
import { formatAmount } from '../lib/transactions';
import { formatErrorAmount } from '../lib/triageDraft';
import { CANVAS, useIsMobile } from '../lib/mobileUi';
import { ChromeHero, ChromeListRow, ChromePage, EmptyState, FONT, T, TextAction } from './TriageKit';
import { PoThumb } from './TriageTable';
import TriageReviewDrawer from './TriageReviewDrawer';

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
    >
      {visible.length
        ? visible.map((row, index) => (
            <ChromeListRow
              key={`${row.triageId}-${row.id}`}
              title={row.reference || 'Document'}
              meta={[errorTypeOf(row), row.storeName, staffName(row), row.dateLabel].filter(Boolean).join(' · ')}
              value={formatErrorAmount(row?.review?.errorAmount || '') || ''}
              leading={<PoThumb urls={row.imageUrls} label={row.reference} size={46} />}
              last={index === visible.length - 1}
              onPress={() => onOpen(row)}
            />
          ))
        : emptyCopy(query.trim() ? `No error matches “${query.trim()}”.` : 'No errors.')}
    </ChromePage>
  );
}

function TransfersPage({ summary }) {
  return (
    <ChromePage
      hero={
        <ChromeHero
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
    >
      {summary.rows.length
        ? summary.rows.map((row, index) => (
            <ChromeListRow
              key={row.id}
              title={row.reference || `TR# ${row.number || ''}`}
              meta={[transferPathLabel(row), row.dateLabel].filter(Boolean).join(' · ')}
              value={transferStatusLabel(row)}
              icon="swap-horizontal"
              iconColor="#1F7A9A"
              last={index === summary.rows.length - 1}
              chevron={false}
            />
          ))
        : emptyCopy('Store-to-workshop transfers land here as they are created.')}
    </ChromePage>
  );
}

function AllocationPage({ lots }) {
  return (
    <ChromePage
      hero={
        <ChromeHero
          value="0"
          stats={[
            { label: lots.length === 1 ? 'Lot' : 'Lots', value: String(lots.length) },
            { label: 'Allocated', value: '0' },
            { label: 'Ready', value: String(lots.length) },
          ]}
        />
      }
      title="Lots"
      meta={String(lots.length)}
    >
      {lots.length
        ? lots.map((lot, index) => (
            <ChromeListRow
              key={lot.id}
              title={lot.id}
              meta={[lot.location, lotPeriodLabel(lot)].filter(Boolean).join(' · ')}
              value="Open"
              icon="folder"
              iconColor="#3A3A3C"
              last={index === lots.length - 1}
              chevron={false}
            />
          ))
        : emptyCopy('Lots you finish will show up here for allocation.')}
    </ChromePage>
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
    >
      {lots.map((lot, index) => {
        const progress = lotProgressOf(lot);
        return (
          <ChromeListRow
            key={lot.id}
            title={lot.id}
            meta={[lot.location, lotPeriodLabel(lot)].filter(Boolean).join(' · ')}
            value={progress.expected ? `${progress.evaluated}/${progress.expected}` : String(lot.pos.length)}
            icon="folder"
            iconColor="#1F8A4E"
            last={index === lots.length - 1}
            chevron={false}
          />
        );
      })}
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
}) {
  const { triage, planned = [] } = useTransferWorkflow();
  const isMobile = useIsMobile();
  const [openRow, setOpenRow] = useState(null);

  const evaluated = useMemo(() => collectAccuracyTriagePos(triage), [triage]);
  const allRows = useMemo(() => collectAllTriagePos(triage), [triage]);
  const lots = useMemo(() => groupPosIntoLots(evaluated, allRows), [allRows, evaluated]);
  const errors = useMemo(() => summarizeErrors(evaluated), [evaluated]);
  const lotSummary = useMemo(() => summarizeLots(lots), [lots]);
  const transferSummary = useMemo(() => summarizeTransfers(planned), [planned]);

  const openPage = useCallback((key) => onPageChange?.(key || ''), [onPageChange]);
  const closePage = useCallback(() => onPageChange?.(''), [onPageChange]);

  useEffect(() => {
    if (!active) return undefined;
    if (!page) {
      onBackChange?.(null, null);
      return () => onBackChange?.(null, null);
    }
    const titles = {
      errors: 'Errors',
      shipments: 'Transfers',
      allocation: 'Allocation',
      return: 'Expected Return',
    };
    onBackChange?.(closePage, { dateLabel: titles[page] || 'Dashboard' });
    return () => onBackChange?.(null, null);
  }, [active, closePage, onBackChange, page]);

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

  const home = (
    <ChromePage
      hero={
        <ChromeHero
          value={errors.amount ? formatAmount(errors.amount) : String(errors.count)}
          stats={[
            { label: errors.count === 1 ? 'Error' : 'Errors', value: String(errors.count) },
            { label: 'Transfers', value: String(transferSummary.count) },
            { label: lotSummary.lots === 1 ? 'Lot' : 'Lots', value: String(lotSummary.lots) },
          ]}
        />
      }
      title="Triage"
      meta={`${errors.count + transferSummary.count} open`}
    >
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
          lots.length
            ? `${lots.length} ${lots.length === 1 ? 'lot' : 'lots'} · none allocated`
            : 'Nothing to allocate yet'
        }
        value={String(lots.length)}
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
        last
        onPress={() => openPage('return')}
      />
    </ChromePage>
  );

  return (
    <View style={[styles.body, isMobile && styles.bodyMobile]}>
      {page === 'errors' ? (
        <ErrorsPage rows={errors.rows} query={listQuery} onOpen={setOpenRow} />
      ) : page === 'shipments' ? (
        <TransfersPage summary={transferSummary} />
      ) : page === 'allocation' ? (
        <AllocationPage lots={lots} />
      ) : page === 'return' ? (
        <ExpectedReturnPage lots={lots} summary={lotSummary} />
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
});
