/**
 * Triage dashboard: date batches of stores shipping melt POs and bullion to the
 * Workshop. Batches live in Supabase via lib/transferWorkflow; this panel is
 * presentational and delegates every mutation to that store.
 */
import { createElement, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { mobileSafeBottom, mobileSafeTop, useIsMobile } from '../lib/mobileUi';
import { fetchTransferStores } from '../lib/locations';
import {
  collectRecordImageUrls,
  defaultDateRange,
  fetchTransactionDetail,
  fetchTransactions,
  formatAmount,
  formatDateParam,
  formatPickerDate,
  parseDateParam,
  parseDocReference,
  posSourcesFromSession,
  resolvePosAuthForRow,
  rowFromDocument,
  withLineItems,
} from '../lib/transactions';
import {
  RECEIVE_STATUS,
  RECEIVE_STATUS_LABELS,
  addStandaloneTriagePo,
  applyTriageReviewToPo,
  batchStats,
  flattenBatchPos,
  findTriagePo,
  isStandaloneTriage,
  mergeTriagePos,
  patchTriagePosDetails,
  persistTransferWorkflowNow,
  plannedForTriageStore,
  plannedWorkshopTransfersForStore,
  receiveAllTriagePos,
  recordPurchaseCensus,
  refreshPurchaseCensus,
  removeTriageBatch,
  removeTriageBatchStore,
  removeTriagePo,
  saveTriagePoReview,
  toggleTriagePoReceived,
  transferGoesToWorkshop,
  triagePoNeedsCorrection,
  updateTriageTransfers,
  useTransferWorkflow,
} from '../lib/transferWorkflow';
import { formatQty } from '../lib/transferPlan';
import { fetchTransfers } from '../lib/transfers';
import { classifyPurchaseForTriage } from '../lib/priceCheck';
import TriageReviewDrawer from './TriageReviewDrawer';
import {
  BarButton,
  Chip,
  EmptyState,
  FONT,
  Group,
  GroupRow,
  IconAction,
  ProgressBar,
  SearchField,
  SectionLabel,
  Stat,
  StatStrip,
  StatusPill,
  T,
  TextAction,
  TextTabs,
  TriageDrawer,
  confirmDestructive,
  useHeldValue,
} from './TriageKit';
import {
  ColumnFilter,
  docNoun,
  matchesSelectedLabel,
  PoThumb,
  selectedLabels,
  sortRows,
  TableCell,
  TableEmpty,
  TableFrame,
  TableMuted,
  TablePhotoCell,
  TableRow,
  TableRowMain,
  TableRowPressable,
  TableStatus,
  TableStrong,
  uniqueLabels,
} from './TriageTable';

const fontFamily = FONT;
const TEXT = T.text;
const SECONDARY = T.secondary;
const FILL = T.fill;
const HAIRLINE = T.hairline;
const BLUE = T.blue;
const GREEN = T.green;

const WORKSHOP_LOCATION = {
  storeKey: 'workshop',
  name: 'Workshop',
  systemKey: 'east',
  systemLabel: 'Canada Gold East',
  city: '',
};

const EMPTY_MELT_FILTERS = {
  reference: [],
  dateLabel: [],
  customer: [],
  employee: [],
  store: [],
  status: [],
};

const EMPTY_BULLION_FILTERS = {
  reference: [],
  dateLabel: [],
  fromName: [],
  toName: [],
  status: [],
};

if (Platform.OS === 'web' && typeof document !== 'undefined') {
  const styleId = 'cgold-triage-feed-snap';
  let style = document.getElementById(styleId);
  if (!style) {
    style = document.createElement('style');
    style.id = styleId;
    document.head.appendChild(style);
  }
  style.textContent = [
    '.cgold-triage-feed{height:100%;overflow-y:auto;scroll-snap-type:y mandatory;-webkit-overflow-scrolling:touch;overscroll-behavior-y:contain;}',
    '.cgold-triage-feed-page{scroll-snap-align:start;scroll-snap-stop:always;}',
    '.cgold-triage-feed-hero{height:100%;overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;}',
  ].join('');
}

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

function meltKey(row) {
  return String(row.id);
}

function isWorkshopStore(store) {
  return Boolean(store?.isWorkshop) || String(store?.name || '').toLowerCase().includes('workshop');
}

function newId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function namesMatch(a, b) {
  return (
    String(a || '')
      .trim()
      .localeCompare(String(b || '').trim(), undefined, { sensitivity: 'base' }) === 0
  );
}

function storeNamesLabel(stores) {
  const names = (stores || []).map((store) => store?.name).filter(Boolean);
  if (names.length === 0) return '';
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return names.join(', ');
}

function storeInList(stores, name) {
  return (stores || []).some((store) => namesMatch(store?.name, name));
}

function storeOnBatch(stores, next) {
  return (stores || []).some(
    (store) =>
      (next?.storeKey && store?.storeKey && String(store.storeKey) === String(next.storeKey)) ||
      (next?.sourceId && store?.sourceId && String(store.sourceId) === String(next.sourceId)) ||
      namesMatch(store?.name, next?.name),
  );
}

function sortBatchStores(stores) {
  return [...(stores || [])].sort((a, b) =>
    String(a?.name || '').localeCompare(String(b?.name || ''), undefined, { sensitivity: 'base' }),
  );
}

function uniqueSystemGroups(stores) {
  const groups = new Map();
  for (const store of stores || []) {
    const key = store?.systemKey || 'east';
    if (!groups.has(key)) {
      groups.set(key, {
        systemKey: key,
        systemLabel: store?.systemLabel || 'Canada Gold East',
        stores: [],
      });
    }
    groups.get(key).stores.push(store);
  }
  return [...groups.values()];
}

function actorNameOf(session) {
  if (!session) return '';
  if (session.profile?.fullName) return session.profile.fullName;
  const user = session.user;
  const parts = [user?.first_name, user?.last_name].filter(Boolean).join(' ').trim();
  return parts || user?.name || user?.full_name || session.login || '';
}

function formatStamp(iso) {
  const time = Date.parse(iso || '');
  if (!Number.isFinite(time)) return '';
  const date = new Date(time);
  const today = new Date();
  const sameDay =
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate();
  const clock = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (sameDay) return clock;
  return `${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · ${clock}`;
}

function firstName(name) {
  return String(name || '').trim().split(/\s+/)[0] || '';
}

function poKindLabel(row) {
  return row?.type === 'order' ? 'SO' : 'PO';
}

function personLabel(value) {
  const text = String(value || '').trim();
  return text && text !== '—' ? text : '';
}

/** Status shown in the Melt table; flagged wins over received so problems stay visible. */
function meltStatus(row) {
  const received = Boolean(row?.received);
  const flagged = triagePoNeedsCorrection(row);
  const stamp = [firstName(row?.receivedBy), formatStamp(row?.receivedAt)].filter(Boolean).join(' · ');
  if (flagged) {
    return {
      label: 'Flagged',
      tone: 'orange',
      sub: received ? `Received${stamp ? ` · ${stamp}` : ''}` : 'Not received',
    };
  }
  if (received) return { label: 'Received', tone: 'green', sub: stamp || null };
  if (row?.review) return { label: 'Checked', tone: 'blue', sub: null };
  return { label: 'Open', tone: 'neutral', sub: null };
}

function bullionStatus(row) {
  const key = row?.receiveStatus || RECEIVE_STATUS.not_received;
  const tone =
    key === RECEIVE_STATUS.all_received
      ? 'green'
      : key === RECEIVE_STATUS.partially_received
        ? 'orange'
        : 'neutral';
  return { label: RECEIVE_STATUS_LABELS[key] || 'Not Received', tone };
}

function bullionToLabel(row) {
  return row?.toName || (row?.pathLabels || []).filter(Boolean).slice(-1)[0] || '';
}

function bullionItemsLabel(row) {
  const items = Array.isArray(row?.items) ? row.items : [];
  const qty = items.reduce((sum, item) => sum + (Number(item.sentQty) || 0), 0);
  return { count: items.length, qty };
}

function rowAmountNumber(row) {
  const raw = row?.amount ?? row?.amountLabel;
  if (typeof raw === 'number') return raw;
  const n = Number(String(raw ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function rowAmountLabel(row) {
  if (row?.amountLabel) return row.amountLabel;
  const n = rowAmountNumber(row);
  return n == null ? '' : formatAmount(n);
}

function rowTime(row) {
  const raw = row?.date;
  if (!raw) return 0;
  const time = Date.parse(String(raw).replace(' ', 'T'));
  return Number.isFinite(time) ? time : 0;
}

function meltBullionKind(row) {
  if (row?.bullionOnly) return 'only';
  const cls = classifyPurchaseForTriage(row);
  if (cls.bullionOnly) return 'only';
  if (row?.hasHeldBullion || cls.hasHeldBullion) return 'mixed';
  return null;
}

function poHoldsBullion(row) {
  return Boolean(meltBullionKind(row));
}

function itemCountLabel(row) {
  const count = Array.isArray(row?.pricedLines) && row.pricedLines.length
    ? row.pricedLines.length
    : Array.isArray(row?.itemNames)
      ? row.itemNames.filter(Boolean).length
      : 0;
  if (!count) return '';
  return `${count} ${count === 1 ? 'item' : 'items'}`;
}

function expectedPosLabel(stats) {
  if (!stats || !(stats.totalPurchases > stats.expected)) return '';
  return `${stats.expected}/${stats.totalPurchases} POs expected`;
}

function posTransferToRow(transfer) {
  const received = String(transfer.status || '').toLowerCase() === 'received';
  const partial = !received && Number(transfer.receivedQty) > 0;
  return {
    id: `pos-${transfer.id}`,
    reference: transfer.reference || (transfer.id ? `TR# ${transfer.id}` : 'Transfer'),
    dateKey: transfer.date || '',
    dateLabel: transfer.date ? formatPickerDate(transfer.date) : '',
    note: transfer.comments || '',
    fromName: transfer.from?.name || '',
    toName: transfer.to?.name || '',
    pathLabels: [transfer.from?.name, transfer.to?.name].filter(Boolean),
    items: (transfer.items || []).map((item, index) => ({
      id: item.id || `pos-item-${transfer.id}-${index}`,
      productName: item.name || 'Item',
      sku: item.sku || '',
      fromName: transfer.from?.name || '',
      toName: transfer.to?.name || '',
      sentQty: item.quantity || 0,
      receivedQty: item.receivedQuantity,
    })),
    receiveStatus: received
      ? RECEIVE_STATUS.all_received
      : partial
        ? RECEIVE_STATUS.partially_received
        : RECEIVE_STATUS.not_received,
    aureusId: transfer.id != null ? String(transfer.id) : null,
    source: 'pos',
  };
}

async function fillMissingPoDetails(token, baseUrl, rows) {
  const missing = (rows || []).filter(
    (row) =>
      row?.type !== 'order' &&
      (!(row.pricedLines || []).length || !(row.imageUrls || []).length),
  );
  if (missing.length === 0) return rows;
  const updates = new Map();
  let cursor = 0;
  const workers = Math.min(6, missing.length);

  async function worker() {
    while (cursor < missing.length) {
      const index = cursor;
      cursor += 1;
      const row = missing[index];
      try {
        const detail = await fetchTransactionDetail(token, {
          type: row.type === 'order' ? 'order' : 'purchase',
          sourceId: row.sourceId,
          baseUrl,
        });
        const enriched = withLineItems(row, detail);
        const imageUrls = (row.imageUrls || []).length ? row.imageUrls : collectRecordImageUrls(detail);
        updates.set(row.id, imageUrls.length ? { ...enriched, imageUrls } : enriched);
      } catch {
        // Keep the row as-is if detail lookup fails.
      }
    }
  }

  await Promise.all(Array.from({ length: workers }, () => worker()));
  if (updates.size === 0) return rows;
  return rows.map((row) => updates.get(row.id) || row);
}

async function fillMissingPoImages(token, baseUrl, rows) {
  return fillMissingPoDetails(token, baseUrl, rows);
}

function storeOnTransfer(row, store) {
  return (row?.stores || []).some(
    (entry) =>
      (store.storeKey && entry.storeKey === store.storeKey) || namesMatch(entry.name, store.name),
  );
}

function lastTriageTransferDate(transfers, store, currentDateKey) {
  const current = currentDateKey || formatDateParam(new Date());
  const prior = (transfers || [])
    .filter((row) => row.dateKey && row.dateKey < current && storeOnTransfer(row, store))
    .sort((a, b) => b.dateKey.localeCompare(a.dateKey));
  return prior[0]?.dateKey || null;
}

function lastTriageTransferDateForStores(transfers, stores, currentDateKey) {
  const dates = (stores || [])
    .map((store) => lastTriageTransferDate(transfers, store, currentDateKey))
    .filter(Boolean)
    .sort();
  return dates[0] || null;
}

async function lastPosTransferDate(session, store) {
  const auth = resolvePosAuthForRow(session, { systemKey: store.systemKey });
  if (!auth.token) return null;
  const since = new Date();
  since.setFullYear(since.getFullYear() - 2);
  const sinceKey = formatDateParam(since);
  const lists = await Promise.all([
    fetchTransfers(auth.token, { status: 'received', since: sinceKey, baseUrl: auth.baseUrl }).catch(
      () => [],
    ),
    fetchTransfers(auth.token, { status: 'pending', since: sinceKey, baseUrl: auth.baseUrl }).catch(
      () => [],
    ),
  ]);
  const matches = lists
    .flat()
    .filter((row) => namesMatch(row?.from?.name, store.name) && row.date)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  return matches[0]?.date || null;
}

function mapPickedStore(store) {
  return {
    id: newId('store'),
    storeKey: store.id,
    name: store.name,
    systemKey: store.systemKey,
    systemLabel: store.systemLabel,
    sourceId: store.sourceId,
    city: store.city || '',
    meltPos: [],
  };
}

/** Load POS transfers headed to the Workshop from the batch's stores. */
function useWorkshopTransfers(session, stores) {
  const storeList = stores || [];
  const storeKey = storeList.map((store) => store.id || store.storeKey || store.name).join('|');
  const [posRows, setPosRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const { planned } = useTransferWorkflow();

  useEffect(() => {
    if (!session?.token || storeList.length === 0) {
      setPosRows([]);
      return undefined;
    }
    let cancelled = false;
    setBusy(true);
    const since = new Date();
    since.setFullYear(since.getFullYear() - 2);
    const sinceKey = formatDateParam(since);
    Promise.all(
      uniqueSystemGroups(storeList).map(async (group) => {
        const auth = resolvePosAuthForRow(session, { systemKey: group.systemKey });
        if (!auth.token) return [];
        const [pending, received] = await Promise.all([
          fetchTransfers(auth.token, { status: 'pending', since: sinceKey, baseUrl: auth.baseUrl }).catch(
            () => [],
          ),
          fetchTransfers(auth.token, { status: 'received', since: sinceKey, baseUrl: auth.baseUrl }).catch(
            () => [],
          ),
        ]);
        return [...pending, ...received]
          .filter((row) => transferGoesToWorkshop(row) && storeInList(group.stores, row.from?.name))
          .map(posTransferToRow);
      }),
    )
      .then((groups) => {
        if (cancelled) return;
        const seen = new Set();
        const next = [];
        for (const row of groups.flat()) {
          if (!row?.id || seen.has(row.id)) continue;
          seen.add(row.id);
          next.push(row);
        }
        setPosRows(next);
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, storeKey]);

  const rows = useMemo(() => {
    const local = storeList.flatMap((store) =>
      plannedWorkshopTransfersForStore(store?.storeKey, store?.name),
    );
    const seen = new Set(local.map((row) => row.aureusId).filter(Boolean).map(String));
    const extras = posRows.filter((row) => !row.aureusId || !seen.has(String(row.aureusId)));
    return [...local, ...extras].sort((a, b) =>
      String(b.dateKey || '').localeCompare(String(a.dateKey || '')),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planned, posRows, storeKey]);

  return { rows, busy };
}

/* ------------------------------------------------------------------ */
/* Date field + Add modal                                               */
/* ------------------------------------------------------------------ */

function DateField({ value, onChange, minimumDate, maximumDate }) {
  const [open, setOpen] = useState(false);
  const dateValue = parseDateParam(value);

  const commit = (next) => {
    if (!next) return;
    let date = parseDateParam(next);
    if (minimumDate && date < parseDateParam(minimumDate)) date = parseDateParam(minimumDate);
    if (maximumDate && date > parseDateParam(maximumDate)) date = parseDateParam(maximumDate);
    onChange(date);
  };

  if (Platform.OS === 'web') {
    return (
      <View style={styles.dateField}>
        <Ionicons name="calendar-outline" size={16} color={SECONDARY} />
        {createElement('input', {
          type: 'date',
          value: formatDateParam(dateValue),
          min: minimumDate ? formatDateParam(minimumDate) : undefined,
          max: maximumDate ? formatDateParam(maximumDate) : undefined,
          onChange: (event) => {
            if (event.target.value) commit(event.target.value);
          },
          style: {
            border: 'none',
            background: 'transparent',
            fontFamily,
            fontSize: 16,
            color: TEXT,
            padding: 0,
            margin: 0,
            outline: 'none',
            cursor: 'pointer',
            flex: 1,
            minWidth: 140,
          },
        })}
      </View>
    );
  }

  return (
    <>
      <Pressable style={styles.dateField} onPress={() => setOpen(true)}>
        <Ionicons name="calendar-outline" size={16} color={SECONDARY} />
        <Text style={styles.dateFieldValue}>{formatPickerDate(dateValue)}</Text>
      </Pressable>

      {Platform.OS === 'android' && open ? (
        <DateTimePicker
          value={dateValue}
          mode="date"
          display="default"
          minimumDate={minimumDate ? parseDateParam(minimumDate) : undefined}
          maximumDate={maximumDate ? parseDateParam(maximumDate) : undefined}
          onChange={(event, selected) => {
            setOpen(false);
            if (event.type !== 'dismissed' && selected) commit(selected);
          }}
        />
      ) : null}

      {Platform.OS === 'ios' ? (
        <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
          <View style={styles.modalBackdrop}>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setOpen(false)} />
            <View style={styles.dateModalCard}>
              <View style={styles.dateModalHeader}>
                <Text style={styles.modalTitle}>Date</Text>
                <Pressable onPress={() => setOpen(false)} hitSlop={8}>
                  <Text style={styles.doneText}>Done</Text>
                </Pressable>
              </View>
              <DateTimePicker
                value={dateValue}
                mode="date"
                display="spinner"
                minimumDate={minimumDate ? parseDateParam(minimumDate) : undefined}
                maximumDate={maximumDate ? parseDateParam(maximumDate) : undefined}
                onChange={(_, selected) => {
                  if (selected) commit(selected);
                }}
              />
            </View>
          </View>
        </Modal>
      ) : null}
    </>
  );
}

function Segmented({ options, value, onChange, disabled }) {
  return (
    <View style={styles.segment} accessibilityRole="tablist">
      {options.map((option) => {
        const active = option.key === value;
        return (
          <Pressable
            key={option.key}
            style={[styles.segmentButton, active && styles.segmentButtonActive]}
            onPress={() => {
              if (!disabled) onChange(option.key);
            }}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={option.label}
          >
            <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const ADD_MODES = [
  { key: 'range', label: 'Date range' },
  { key: 'doc', label: 'PO / SO number' },
];

function posGroupsFromSession(session) {
  const sources = posSourcesFromSession(session);
  return sources.map((source) => ({
    systemKey: source.key,
    systemLabel: source.label,
    stores: [],
  }));
}

function SpecificDocSearch({ stores, session, existingIds, onAdd, allStores = false }) {
  const [kind, setKind] = useState('PO');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [results, setResults] = useState([]);
  const searchGen = useRef(0);
  const storeKey = (stores || []).map((store) => store.id || store.name).join('|');
  const batchLabel = allStores ? 'every store' : storeNamesLabel(stores) || 'the selected stores';

  useEffect(() => {
    setKind('PO');
    setValue('');
    setBusy(false);
    setError('');
    setResults([]);
  }, [storeKey, allStores]);

  const runSearch = useCallback(
    async (raw, selectedKind) => {
      const query = String(raw || '').trim();
      if (!query) {
        setResults([]);
        setError('');
        return;
      }

      const searchGroups = allStores ? posGroupsFromSession(session) : uniqueSystemGroups(stores);
      if (
        searchGroups.length === 0 ||
        searchGroups.every((group) => !resolvePosAuthForRow(session, { systemKey: group.systemKey }).token)
      ) {
        setError('Sign in to search PO / SO.');
        setResults([]);
        return;
      }

      const gen = (searchGen.current += 1);
      setBusy(true);
      setError('');
      try {
        const digits = query.replace(/[^\d]/g, '');
        const typed = parseDocReference(query);
        const candidates = [];
        if (typed) candidates.push(typed);
        else if (digits) {
          candidates.push(parseDocReference(`${selectedKind}# ${digits}`));
          const other = selectedKind === 'PO' ? 'SO' : 'PO';
          candidates.push(parseDocReference(`${other}# ${digits}`));
        }

        const found = [];
        const seen = new Set();
        let otherStore = '';
        let otherKind = 'PO';

        for (const doc of candidates.filter(Boolean)) {
          for (const group of searchGroups) {
            const auth = resolvePosAuthForRow(session, { systemKey: group.systemKey });
            if (!auth.token) continue;
            try {
              const system = { key: group.systemKey, label: group.systemLabel, baseUrl: auth.baseUrl };
              const detail = await fetchTransactionDetail(auth.token, {
                type: doc.type,
                sourceId: doc.sourceId,
                baseUrl: auth.baseUrl,
              });
              const row = rowFromDocument(detail, doc.type, system);
              if (!row?.id || seen.has(row.id)) continue;
              if (!allStores && !storeInList(stores, row.storeName)) {
                otherStore = row.storeName || 'another store';
                otherKind = row.type === 'purchase' ? 'PO' : 'SO';
                continue;
              }
              seen.add(row.id);
              found.push(row);
            } catch {
              // Try the next POS system or PO/SO candidate.
            }
          }
        }

        if (gen !== searchGen.current) return;
        setResults(found);
        if (found.length === 0) {
          setError(
            otherStore
              ? `That ${otherKind} is for ${otherStore}, not ${batchLabel}.`
              : `No matching PO or SO at ${batchLabel}.`,
          );
        }
      } catch (err) {
        if (gen !== searchGen.current) return;
        setResults([]);
        setError(err?.message || 'Search failed.');
      } finally {
        if (gen === searchGen.current) setBusy(false);
      }
    },
    [allStores, batchLabel, session, stores],
  );

  useEffect(() => {
    const query = value.trim();
    if (!query) {
      setResults([]);
      setError('');
      return undefined;
    }
    const timer = setTimeout(() => runSearch(query, kind), 350);
    return () => clearTimeout(timer);
  }, [kind, runSearch, value]);

  return (
    <View style={styles.addBlock}>
      <View style={styles.docSearchRow}>
        <Segmented
          options={[
            { key: 'PO', label: 'PO' },
            { key: 'SO', label: 'SO' },
          ]}
          value={kind}
          onChange={setKind}
        />
        <View style={styles.docSearchField}>
          <Ionicons name="search" size={16} color={SECONDARY} />
          <TextInput
            style={styles.docSearchInput}
            value={value}
            onChangeText={setValue}
            placeholder={`${kind}# 12345`}
            placeholderTextColor={SECONDARY}
            autoCapitalize="characters"
            autoCorrect={false}
            autoFocus
            onSubmitEditing={() => runSearch(value, kind)}
          />
          {busy ? <ActivityIndicator size="small" color={SECONDARY} /> : null}
        </View>
      </View>
      <Text style={styles.modalHint}>{allStores ? 'Searches every store on every POS.' : `Searches ${batchLabel}.`}</Text>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      {results.length > 0 ? (
        <Group>
          {results.map((row, index) => {
            const already = (existingIds || []).includes(row.id);
            const cls = classifyPurchaseForTriage(row);
            const triageNote = cls.bullionOnly
              ? 'bullion stays in store'
              : cls.hasHeldBullion
                ? 'mixed · bullion stays in store'
                : '';
            return (
              <Pressable
                key={row.id}
                style={[styles.docResultRow, index === results.length - 1 && styles.docResultRowLast]}
                onPress={() => {
                  if (already) {
                    setError(`${row.reference} is already on this list.`);
                    return;
                  }
                  onAdd(row);
                }}
                accessibilityRole="button"
                accessibilityLabel={`Add ${row.reference}`}
              >
                <PoThumb urls={row.imageUrls} label={row.reference} />
                <View style={styles.docResultText}>
                  <Text style={styles.docResultTitle} numberOfLines={1}>
                    {row.reference}
                    {rowAmountLabel(row) ? `  ·  ${rowAmountLabel(row)}` : ''}
                  </Text>
                  <Text style={styles.docResultSub} numberOfLines={1}>
                    {[row.dateLabel, row.customerName, row.storeName, triageNote].filter(Boolean).join(' · ')}
                  </Text>
                </View>
                <Text style={[styles.docResultAction, already && styles.docResultActionMuted]}>
                  {already ? 'Added' : 'Add'}
                </Text>
              </Pressable>
            );
          })}
        </Group>
      ) : null}
    </View>
  );
}

function AddDocumentsModal({
  visible,
  onClose,
  onConfirm,
  onAddDoc,
  existingIds,
  busy,
  error,
  session,
  stores,
  transfers,
  currentDateKey,
}) {
  const isMobile = useIsMobile();
  const [mode, setMode] = useState('range');
  const [start, setStart] = useState(() => defaultDateRange(7).start);
  const [end, setEnd] = useState(() => defaultDateRange(7).end);
  const [lastBusy, setLastBusy] = useState(false);
  const [lastHint, setLastHint] = useState('');
  const [localError, setLocalError] = useState('');

  useEffect(() => {
    if (!visible) return;
    const next = defaultDateRange(7);
    setMode('range');
    setStart(next.start);
    setEnd(next.end);
    setLastHint('');
    setLastBusy(false);
    setLocalError('');
  }, [visible]);

  const confirm = (fromDate = start, toDate = end) => {
    let from = parseDateParam(fromDate);
    let to = parseDateParam(toDate);
    if (from > to) {
      const swap = from;
      from = to;
      to = swap;
    }
    onConfirm({ startDate: formatDateParam(from), endDate: formatDateParam(to) });
  };

  const fromLastTransfer = async () => {
    setLastBusy(true);
    setLocalError('');
    try {
      let startKey = lastTriageTransferDateForStores(transfers, stores, currentDateKey);
      if (!startKey) {
        const dates = (await Promise.all((stores || []).map((store) => lastPosTransferDate(session, store))))
          .filter(Boolean)
          .sort();
        startKey = dates[0] || null;
      }
      if (!startKey) {
        setLastHint('');
        setLocalError(`No previous transfer found for ${storeNamesLabel(stores) || 'these stores'}.`);
        return;
      }
      const today = formatDateParam(new Date());
      setStart(parseDateParam(startKey));
      setEnd(parseDateParam(today));
      setLastHint(`Since the last transfer on ${formatPickerDate(startKey)}`);
      confirm(startKey, today);
    } catch (err) {
      setLocalError(
        err?.message || `Could not find the last transfer for ${storeNamesLabel(stores) || 'these stores'}.`,
      );
    } finally {
      setLastBusy(false);
    }
  };

  const waiting = busy || lastBusy;

  return (
    <Modal visible={visible} transparent animationType={isMobile ? 'slide' : 'fade'} onRequestClose={onClose}>
      <View style={[styles.modalBackdrop, isMobile && styles.sheetBackdropBottom]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={waiting ? undefined : onClose} />
        <View style={[styles.sheetCard, isMobile && styles.sheetCardBottom]}>
          {isMobile ? <View style={styles.sheetGrabber} /> : null}
          <View style={styles.sheetHeader}>
            <Pressable onPress={onClose} disabled={waiting} hitSlop={8} accessibilityRole="button">
              <Text style={styles.navAction}>Cancel</Text>
            </Pressable>
            <Text style={styles.modalTitle}>Add PO / SO</Text>
            {mode === 'range' ? (
              <Pressable
                onPress={() => confirm()}
                disabled={waiting}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Add"
              >
                {busy ? (
                  <ActivityIndicator color={BLUE} />
                ) : (
                  <Text style={[styles.navAction, styles.navActionStrong]}>Add</Text>
                )}
              </Pressable>
            ) : (
              <View style={styles.navSpacer} />
            )}
          </View>
          <Segmented options={ADD_MODES} value={mode} onChange={setMode} disabled={waiting} />
          {mode === 'doc' ? (
            <SpecificDocSearch stores={stores} session={session} existingIds={existingIds} onAdd={onAddDoc} />
          ) : (
            <View style={styles.addBlock}>
              <View style={styles.rangeRow}>
                <View style={styles.rangeField}>
                  <Text style={styles.rangeLabel}>From</Text>
                  <DateField value={start} onChange={setStart} maximumDate={end} />
                </View>
                <View style={styles.rangeField}>
                  <Text style={styles.rangeLabel}>To</Text>
                  <DateField value={end} onChange={setEnd} minimumDate={start} />
                </View>
              </View>
              <Pressable
                style={styles.lastTransferButton}
                onPress={fromLastTransfer}
                disabled={waiting}
                accessibilityRole="button"
                accessibilityLabel="Since last transfer"
              >
                {lastBusy ? (
                  <ActivityIndicator color={BLUE} />
                ) : (
                  <>
                    <Ionicons name="time-outline" size={16} color={BLUE} />
                    <Text style={styles.lastTransferButtonText}>Since last transfer</Text>
                  </>
                )}
              </Pressable>
              <Text style={styles.modalHint}>
                {lastHint || `Loads purchases from ${storeNamesLabel(stores) || 'the selected stores'}.`}
              </Text>
              {localError || error ? <Text style={styles.errorText}>{localError || error}</Text> : null}
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

function QuickAddModal({ visible, session, existingIds, onClose, onAdd, error }) {
  const isMobile = useIsMobile();
  return (
    <Modal visible={visible} transparent animationType={isMobile ? 'slide' : 'fade'} onRequestClose={onClose}>
      <View style={[styles.modalBackdrop, isMobile && styles.sheetBackdropBottom]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[styles.sheetCard, isMobile && styles.sheetCardBottom]}>
          {isMobile ? <View style={styles.sheetGrabber} /> : null}
          <View style={styles.sheetHeader}>
            <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button">
              <Text style={styles.navAction}>Cancel</Text>
            </Pressable>
            <Text style={styles.modalTitle}>Quick Add</Text>
            <View style={styles.navSpacer} />
          </View>
          <Text style={styles.quickAddIntro}>
            Search any store. The PO lands as its own dashboard line — not inside a date batch.
          </Text>
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
          <SpecificDocSearch
            allStores
            stores={[]}
            session={session}
            existingIds={existingIds}
            onAdd={onAdd}
          />
        </View>
      </View>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Feed (TikTok-style) view                                             */
/* ------------------------------------------------------------------ */

function FeedHero({ urls, label, width }) {
  const photos = Array.isArray(urls) ? urls.filter(Boolean) : [];
  const [index, setIndex] = useState(0);
  const [failed, setFailed] = useState(false);
  const [natural, setNatural] = useState(null);
  const photo = photos[index] || photos[0] || '';
  const imageWidth = Math.max(1, Math.round(width || 0));

  useEffect(() => {
    setIndex(0);
    setFailed(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photos[0], photos.length]);

  useEffect(() => {
    if (!photo || failed) {
      setNatural(null);
      return undefined;
    }
    let cancelled = false;
    Image.getSize(
      photo,
      (w, h) => {
        if (!cancelled && w > 0 && h > 0) setNatural({ w, h });
      },
      () => {
        if (!cancelled) setNatural(null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [failed, photo]);

  const cycle = () => {
    if (photos.length < 2) return;
    setFailed(false);
    setIndex((current) => (current + 1) % photos.length);
  };

  const imageHeight =
    natural?.w > 0
      ? Math.max(1, Math.round((imageWidth * natural.h) / natural.w))
      : Math.round(imageWidth * (4 / 3));

  if (!photo || failed) {
    return (
      <View style={[styles.feedHeroPlaceholder, { width: imageWidth, minHeight: Math.round(imageWidth * 0.75) }]}>
        <Ionicons name="image-outline" size={42} color="rgba(255,255,255,0.42)" />
        <Text style={styles.feedHeroPlaceholderText}>No purchase photo</Text>
      </View>
    );
  }

  return (
    <Pressable
      style={[styles.feedHeroFrame, { width: imageWidth }]}
      onPress={cycle}
      disabled={photos.length < 2}
      accessibilityRole={photos.length > 1 ? 'button' : 'image'}
      accessibilityLabel={photos.length > 1 ? `${label} photo ${index + 1} of ${photos.length}` : `${label} photo`}
    >
      <Image
        source={{ uri: photo }}
        style={{ width: imageWidth, height: imageHeight }}
        resizeMode="contain"
        onError={() => setFailed(true)}
      />
      {photos.length > 1 ? (
        <View style={styles.feedHeroDots} pointerEvents="none">
          {photos.slice(0, 6).map((url, dot) => (
            <View key={`${url}-${dot}`} style={[styles.feedHeroDot, dot === index && styles.feedHeroDotOn]} />
          ))}
        </View>
      ) : null}
    </Pressable>
  );
}

function MeltPoFeedCard({ row, index, total, width, onOpen, onToggleReceived }) {
  const received = Boolean(row.received);
  const status = meltStatus(row);
  const isBuy = row.type !== 'order';
  const lines = Array.isArray(row.pricedLines) ? row.pricedLines.filter((line) => line?.name) : [];
  const extraLines = Math.max(0, lines.length - 2);
  const [cardW, setCardW] = useState(Math.round(width || 0));

  return (
    <View
      style={styles.feedCard}
      onLayout={(event) => {
        const next = Math.round(event.nativeEvent.layout.width);
        if (next > 0 && next !== cardW) setCardW(next);
      }}
    >
      <ScrollView
        style={styles.feedHeroScroll}
        contentContainerStyle={styles.feedHeroScrollContent}
        nestedScrollEnabled
        showsVerticalScrollIndicator={false}
        bounces={false}
        keyboardShouldPersistTaps="handled"
        {...(Platform.OS === 'web' ? { className: 'cgold-triage-feed-hero' } : null)}
      >
        <FeedHero urls={row.imageUrls} label={row.reference} width={cardW || width} />
        <View style={styles.feedCaption}>
          <View style={styles.feedKindRow}>
            <Text style={[styles.feedKind, isBuy && styles.feedKindBuy]}>{poKindLabel(row)}</Text>
            <Text style={styles.feedStatus}>{status.label}</Text>
            {poHoldsBullion(row) ? <Text style={styles.feedBullion}>Bullion in store</Text> : null}
          </View>
          <Text style={styles.feedHandle} numberOfLines={1}>
            @{String(row.customerName || 'walk-in').replace(/\s+/g, '').toLowerCase() || 'walkin'}
          </Text>
          <Text style={styles.feedBuyer} numberOfLines={2}>
            {[row.reference, rowAmountLabel(row)].filter(Boolean).join(' · ')}
          </Text>
          <Text style={styles.feedMeta} numberOfLines={2}>
            {[row.storeName, row.dateLabel, row.timeLabel, personLabel(row.employeeName)]
              .filter(Boolean)
              .join(' · ')}
          </Text>
          {lines.length > 0 ? (
            <Text style={styles.feedLine} numberOfLines={2}>
              {lines
                .slice(0, 2)
                .map((line) => line.name)
                .join(' · ')}
              {extraLines > 0 ? ` +${extraLines}` : ''}
            </Text>
          ) : row.itemNames?.length ? (
            <Text style={styles.feedLine} numberOfLines={2}>
              {row.itemNames.filter(Boolean).join(' · ')}
            </Text>
          ) : null}
        </View>
      </ScrollView>

      <View style={styles.feedRail} pointerEvents="box-none">
        <Text style={styles.feedCount}>
          {index + 1}/{total}
        </Text>
        <Pressable
          style={styles.feedRailButton}
          onPress={() => onOpen(row)}
          accessibilityRole="button"
          accessibilityLabel={`Edit or correct ${row.reference}`}
        >
          <View style={styles.feedRailIcon}>
            <Ionicons name="create" size={22} color="#fff" />
          </View>
          <Text style={styles.feedRailLabel}>Edit</Text>
        </Pressable>
        <Pressable
          style={styles.feedRailButton}
          onPress={() => onToggleReceived(row.id)}
          accessibilityRole="button"
          accessibilityLabel={received ? `${row.reference} received` : `Receive ${row.reference}`}
          accessibilityState={{ selected: received }}
        >
          <View style={[styles.feedRailIcon, received && styles.feedRailIconOn]}>
            <Ionicons name={received ? 'checkmark' : 'arrow-down'} size={22} color="#fff" />
          </View>
          <Text style={styles.feedRailLabel}>{received ? 'Got' : 'Recv'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function MeltPoFeedModal({ visible, rows, onClose, onOpen, onToggleReceived }) {
  const { width, height } = useWindowDimensions();
  const isMobile = width < 768;
  const [pageH, setPageH] = useState(0);
  const stageWidth = isMobile ? width : Math.min(420, Math.max(320, Math.round(width * 0.38)));
  const stageHeight = isMobile ? height : Math.min(height - 40, Math.round(stageWidth * (16 / 9) + 120));

  useEffect(() => {
    if (!visible) setPageH(0);
  }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.feedModalRoot}>
        <Pressable
          style={styles.feedModalBackdrop}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close feed"
        />
        <View
          style={[
            styles.feedModalStage,
            isMobile && styles.feedModalStageFull,
            { width: isMobile ? '100%' : stageWidth, height: isMobile ? '100%' : stageHeight },
          ]}
          onLayout={(event) => {
            const next = Math.round(event.nativeEvent.layout.height);
            if (next > 0 && next !== pageH) setPageH(next);
          }}
        >
          <Pressable
            style={[styles.feedClose, { top: isMobile ? mobileSafeTop() : 12 }]}
            onPress={onClose}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Close feed"
          >
            <Ionicons name="close" size={22} color="#fff" />
          </Pressable>

          {rows.length === 0 ? (
            <View style={styles.feedEmpty}>
              <Ionicons name="images-outline" size={40} color="rgba(255,255,255,0.45)" />
              <Text style={styles.feedEmptyText}>No purchases to show</Text>
            </View>
          ) : pageH > 0 ? (
            <FlatList
              data={rows}
              keyExtractor={(row) => row.id}
              pagingEnabled
              decelerationRate="fast"
              snapToInterval={pageH}
              snapToAlignment="start"
              disableIntervalMomentum
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              getItemLayout={(_, index) => ({ length: pageH, offset: pageH * index, index })}
              style={[styles.feedList, { height: pageH }]}
              {...(Platform.OS === 'web' ? { className: 'cgold-triage-feed' } : null)}
              renderItem={({ item, index }) => (
                <View
                  style={[styles.feedPage, { height: pageH }]}
                  {...(Platform.OS === 'web' ? { className: 'cgold-triage-feed-page' } : null)}
                >
                  <MeltPoFeedCard
                    row={item}
                    index={index}
                    total={rows.length}
                    width={stageWidth}
                    onOpen={onOpen}
                    onToggleReceived={onToggleReceived}
                  />
                </View>
              )}
            />
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Melt tab                                                             */
/* ------------------------------------------------------------------ */

const MELT_SORTERS = {
  reference: (row) => row.reference,
  dateLabel: (row) => rowTime(row),
  customer: (row) => personLabel(row.customerName),
  employee: (row) => personLabel(row.employeeName),
  store: (row) => row.storeName,
  amount: (row) => rowAmountNumber(row),
  status: (row) => meltStatus(row).label,
};

const MeltTableRow = memo(function MeltTableRow({ row, onOpen, onToggleReceived, onRemove, last }) {
  const received = Boolean(row.received);
  const status = meltStatus(row);
  const items = itemCountLabel(row);
  const bullionKind = meltBullionKind(row);
  const heldBullion = Boolean(bullionKind);
  const bullionOnly = bullionKind === 'only';
  return (
    <TableRow
      last={last}
      style={bullionOnly ? styles.meltRowBullion : heldBullion ? styles.meltRowMixed : null}
      webClassName={bullionOnly ? 'cgold-triage-row-bullion' : heldBullion ? 'cgold-triage-row-mixed' : undefined}
    >
      <TableRowMain onPress={() => onOpen(row)} accessibilityLabel={`Open ${row.reference}`}>
        <TablePhotoCell>
          <PoThumb urls={row.imageUrls} label={row.reference} />
        </TablePhotoCell>
        <TableCell flex={1.35} minWidth={148}>
          <View style={styles.meltRefRow}>
            <View style={styles.meltRefText}>
              <TableStrong>{row.reference}</TableStrong>
            </View>
            {heldBullion ? (
              <StatusPill label={bullionOnly ? 'Bullion only' : 'Bullion'} tone={bullionOnly ? 'red' : 'orange'} compact />
            ) : null}
          </View>
          {items || heldBullion ? (
            <TableMuted>
              {bullionOnly
                ? items
                  ? `${items} · no scrap`
                  : 'Bullion only · no scrap'
                : heldBullion
                  ? items
                    ? `${items} · stays in store`
                    : 'Bullion stays in store'
                  : items}
            </TableMuted>
          ) : null}
        </TableCell>
        <TableCell flex={0.9} minWidth={96}>
          <Text style={styles.cellText} numberOfLines={1}>
            {row.dateLabel || '—'}
          </Text>
          {row.timeLabel ? <TableMuted>{row.timeLabel}</TableMuted> : null}
        </TableCell>
        <TableCell flex={1.15} minWidth={120}>
          {personLabel(row.customerName)}
        </TableCell>
        <TableCell flex={1} minWidth={110}>
          {personLabel(row.employeeName)}
        </TableCell>
        <TableCell flex={1} minWidth={110}>
          {row.storeName}
        </TableCell>
        <TableCell flex={0.8} minWidth={92} align="right">
          {rowAmountLabel(row)}
        </TableCell>
        <TableCell flex={1.05} minWidth={124}>
          <TableStatus label={status.label} tone={status.tone} sub={status.sub} />
        </TableCell>
      </TableRowMain>
      <View style={styles.meltActions}>
        <Pressable
          style={[styles.receiveButton, received && styles.receiveButtonOn]}
          onPress={() => onToggleReceived(row.id)}
          accessibilityRole="button"
          accessibilityLabel={received ? `Undo receive ${row.reference}` : `Receive ${row.reference}`}
          accessibilityState={{ selected: received }}
        >
          <Ionicons
            name={received ? 'checkmark-circle' : 'ellipse-outline'}
            size={16}
            color={received ? '#fff' : TEXT}
          />
          <Text style={[styles.receiveButtonText, received && styles.receiveButtonTextOn]}>
            {received ? 'Received' : 'Receive'}
          </Text>
        </Pressable>
        <Pressable
          style={styles.removeButton}
          onPress={() => onRemove(row)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`Remove ${row.reference}`}
        >
          <Ionicons name="close" size={16} color={SECONDARY} />
        </Pressable>
      </View>
    </TableRow>
  );
});

function MeltTab({
  session,
  batch,
  stores,
  pos,
  storeScope,
  transfers,
  addOpen,
  onAddOpenChange,
  onMergePos,
  onRemovePos,
  onToggleReceived,
  onReceiveAll,
  onSaveReview,
}) {
  const storeList = useMemo(() => stores || [], [stores]);
  const batchLabel = storeNamesLabel(storeList) || 'the selected stores';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [openRow, setOpenRow] = useState(null);
  const [feedOpen, setFeedOpen] = useState(false);
  const [openFilter, setOpenFilter] = useState(null);
  const [filters, setFilters] = useState(EMPTY_MELT_FILTERS);
  const [sort, setSort] = useState(null);
  const existingIds = useMemo(() => (pos || []).map((row) => row.id), [pos]);
  const needsHydrate = useMemo(
    () => (pos || []).some((row) => row?.type !== 'order' && !(row.pricedLines || []).length),
    [pos],
  );
  const posRef = useRef(pos);
  posRef.current = pos;

  useEffect(() => {
    if (!needsHydrate || !session) return undefined;
    const snapshot = posRef.current || [];
    let cancelled = false;
    (async () => {
      const need = snapshot.filter((row) => row?.type !== 'order' && !(row.pricedLines || []).length);
      if (!need.length) return;
      const bySystem = new Map();
      for (const row of need) {
        const key = row.systemKey || 'east';
        if (!bySystem.has(key)) bySystem.set(key, []);
        bySystem.get(key).push(row);
      }
      const enriched = [];
      for (const [key, groupRows] of bySystem) {
        const auth = resolvePosAuthForRow(session, { systemKey: key });
        if (!auth.token) continue;
        enriched.push(...(await fillMissingPoDetails(auth.token, auth.baseUrl, groupRows)));
      }
      if (cancelled || !enriched.length) return;
      patchTriagePosDetails(batch.id, enriched);
      const byId = new Map(enriched.map((row) => [row.id, row]));
      refreshPurchaseCensus(
        batch.id,
        snapshot.map((row) => byId.get(row.id) || row),
      );
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [batch.id, needsHydrate, session]);

  const scoped = useMemo(
    () => (storeScope ? (pos || []).filter((row) => namesMatch(row.storeName, storeScope)) : pos || []),
    [pos, storeScope],
  );

  const setFilter = useCallback((key, value) => {
    setFilters((current) => ({ ...current, [key]: value }));
  }, []);
  const filtersActive = Object.values(filters).some((value) => selectedLabels(value).length > 0);
  const clearFilters = useCallback(() => {
    setFilters(EMPTY_MELT_FILTERS);
    setSort(null);
    setOpenFilter(null);
  }, []);

  const rowMatches = useCallback(
    (row, skip) =>
      (skip === 'reference' || matchesSelectedLabel(row.reference, filters.reference)) &&
      (skip === 'dateLabel' || matchesSelectedLabel(row.dateLabel, filters.dateLabel)) &&
      (skip === 'customer' || matchesSelectedLabel(personLabel(row.customerName), filters.customer)) &&
      (skip === 'employee' || matchesSelectedLabel(personLabel(row.employeeName), filters.employee)) &&
      (skip === 'store' || matchesSelectedLabel(row.storeName, filters.store)) &&
      (skip === 'status' || matchesSelectedLabel(meltStatus(row).label, filters.status)),
    [filters],
  );

  const optionsFor = useCallback(
    (key, getValue) => uniqueLabels(scoped.filter((row) => rowMatches(row, key)).map(getValue)),
    [rowMatches, scoped],
  );
  const referenceOptions = useMemo(() => optionsFor('reference', (row) => row.reference), [optionsFor]);
  const dateOptions = useMemo(() => optionsFor('dateLabel', (row) => row.dateLabel), [optionsFor]);
  const customerOptions = useMemo(
    () => optionsFor('customer', (row) => personLabel(row.customerName)),
    [optionsFor],
  );
  const employeeOptions = useMemo(
    () => optionsFor('employee', (row) => personLabel(row.employeeName)),
    [optionsFor],
  );
  const storeOptions = useMemo(() => optionsFor('store', (row) => row.storeName), [optionsFor]);
  const statusOptions = useMemo(() => optionsFor('status', (row) => meltStatus(row).label), [optionsFor]);

  const visiblePos = useMemo(() => {
    const filtered = scoped.filter((row) => rowMatches(row));
    return sort ? sortRows(filtered, MELT_SORTERS[sort.key], sort.dir) : filtered;
  }, [rowMatches, scoped, sort]);

  const expectedScoped = scoped.filter((row) => meltBullionKind(row) !== 'only');
  const allReceived = expectedScoped.length > 0 && expectedScoped.every((row) => row.received);
  const openCount = expectedScoped.filter((row) => !row.received).length;
  const noun = docNoun(expectedScoped.length ? expectedScoped : scoped);
  const expectedMeta = expectedPosLabel(batchStats(batch));

  const sortProps = (key) => ({
    sortDir: sort?.key === key ? sort.dir : null,
    onSort: (dir) => setSort(dir ? { key, dir } : null),
  });

  const openRowFromTable = useCallback((item) => {
    setOpenFilter(null);
    setOpenRow(item);
  }, []);

  const loadRange = useCallback(
    async ({ startDate, endDate }) => {
      if (!startDate || !endDate) return;
      const groups = uniqueSystemGroups(storeList);
      if (groups.length === 0) {
        setError('Add at least one store to this batch first.');
        return;
      }
      setBusy(true);
      setError('');
      try {
        const collected = [];
        const errors = [];
        for (const group of groups) {
          const auth = resolvePosAuthForRow(session, { systemKey: group.systemKey });
          if (!auth.token) {
            errors.push(`Sign in to load purchases for ${group.systemLabel}.`);
            continue;
          }
          try {
            const result = await fetchTransactions(auth.token, {
              startDate,
              endDate,
              baseUrl: auth.baseUrl,
              includePurchases: true,
              includeOrders: false,
              system: { key: group.systemKey, label: group.systemLabel, baseUrl: auth.baseUrl },
            });
            collected.push(
              ...result.rows.filter((row) => row.type === 'purchase' && storeInList(group.stores, row.storeName)),
            );
          } catch (err) {
            errors.push(err?.message || `Failed to load ${group.systemLabel}.`);
          }
        }
        if (collected.length === 0) {
          setError(errors[0] || `No purchases in that range for ${batchLabel}.`);
          return;
        }
        const bySystem = new Map();
        for (const row of collected) {
          const key = row.systemKey || 'east';
          if (!bySystem.has(key)) bySystem.set(key, []);
          bySystem.get(key).push(row);
        }
        const hydratedGroups = await Promise.all(
          [...bySystem.entries()].map(async ([key, groupRows]) => {
            const auth = resolvePosAuthForRow(session, { systemKey: key });
            if (!auth.token) return groupRows;
            return fillMissingPoDetails(auth.token, auth.baseUrl, groupRows);
          }),
        );
        const hydrated = [];
        for (const groupRows of hydratedGroups) hydrated.push(...groupRows);
        recordPurchaseCensus(batch.id, hydrated);
        onMergePos(hydrated);
        onAddOpenChange(false);
      } catch (err) {
        setError(err?.message || 'Failed to load purchases.');
      } finally {
        setBusy(false);
      }
    },
    [batch, batchLabel, onAddOpenChange, onMergePos, session, storeList],
  );

  const removeRow = useCallback(
    (row) => {
      confirmDestructive(
        `Remove ${row.reference}?`,
        'It moves to the Deleted tab and stays off this batch.',
        () => {
          if (openRow?.id === row.id) setOpenRow(null);
          onRemovePos(row.id);
        },
        'Remove',
      );
    },
    [onRemovePos, openRow?.id],
  );

  const renderMeltRow = useCallback(
    ({ item, index }) => (
      <MeltTableRow
        row={item}
        last={index === visiblePos.length - 1}
        onOpen={openRowFromTable}
        onToggleReceived={onToggleReceived}
        onRemove={removeRow}
      />
    ),
    [onToggleReceived, openRowFromTable, removeRow, visiblePos.length],
  );

  return (
    <View style={styles.body}>
      {scoped.length === 0 ? (
        <EmptyState
          icon="flame-outline"
          title={storeScope ? `No PO / SO for ${storeScope}` : 'No PO / SO yet'}
          body={
            storeScope
              ? 'Add a date range or a PO/SO number to bring in purchases for this store.'
              : `Add a date range or a single PO/SO from ${batchLabel} to start checking the melt.`
          }
          action={<TextAction icon="add" label="Add PO / SO" strong onPress={() => onAddOpenChange(true)} />}
        />
      ) : (
        <TableFrame
          minWidth={1080}
          data={visiblePos}
          renderItem={renderMeltRow}
          keyExtractor={meltKey}
          ListEmptyComponent={<TableEmpty>No PO or SO matches those filters.</TableEmpty>}
          toolbar={
            <>
              <Text style={styles.tableMeta}>
                {filtersActive ? `${visiblePos.length} of ${scoped.length}` : scoped.length} {noun}
                {openCount > 0 ? `  ·  ${openCount} open` : '  ·  all received'}
                {expectedMeta ? `  ·  ${expectedMeta}` : ''}
              </Text>
              <View style={styles.toolbarActions}>
                {filtersActive || sort ? <TextAction label="Clear" onPress={clearFilters} /> : null}
                <IconAction
                  icon="phone-portrait-outline"
                  onPress={() => setFeedOpen(true)}
                  accessibilityLabel="Open feed view"
                />
              </View>
            </>
          }
          header={
            <>
              <TablePhotoCell />
              <ColumnFilter
                columnKey="reference"
                label="PO / SO"
                value={filters.reference}
                onChange={(value) => setFilter('reference', value)}
                options={referenceOptions}
                openKey={openFilter}
                onOpenKey={setOpenFilter}
                style={{ flex: 1.35, minWidth: 148 }}
                {...sortProps('reference')}
              />
              <ColumnFilter
                columnKey="dateLabel"
                label="Date"
                value={filters.dateLabel}
                onChange={(value) => setFilter('dateLabel', value)}
                options={dateOptions}
                openKey={openFilter}
                onOpenKey={setOpenFilter}
                style={{ flex: 0.9, minWidth: 96 }}
                {...sortProps('dateLabel')}
              />
              <ColumnFilter
                columnKey="customer"
                label="Customer"
                value={filters.customer}
                onChange={(value) => setFilter('customer', value)}
                options={customerOptions}
                openKey={openFilter}
                onOpenKey={setOpenFilter}
                style={{ flex: 1.15, minWidth: 120 }}
                {...sortProps('customer')}
              />
              <ColumnFilter
                columnKey="employee"
                label="Employee"
                value={filters.employee}
                onChange={(value) => setFilter('employee', value)}
                options={employeeOptions}
                openKey={openFilter}
                onOpenKey={setOpenFilter}
                style={{ flex: 1, minWidth: 110 }}
                {...sortProps('employee')}
              />
              <ColumnFilter
                columnKey="store"
                label="Store"
                value={filters.store}
                onChange={(value) => setFilter('store', value)}
                options={storeOptions}
                openKey={openFilter}
                onOpenKey={setOpenFilter}
                style={{ flex: 1, minWidth: 110 }}
                {...sortProps('store')}
              />
              <ColumnFilter
                columnKey="amount"
                label="Amount"
                value={[]}
                sortOnly
                openKey={openFilter}
                onOpenKey={setOpenFilter}
                align="end"
                style={{ flex: 0.8, minWidth: 92, alignItems: 'flex-end' }}
                {...sortProps('amount')}
              />
              <ColumnFilter
                columnKey="status"
                label="Status"
                value={filters.status}
                onChange={(value) => setFilter('status', value)}
                options={statusOptions}
                openKey={openFilter}
                onOpenKey={setOpenFilter}
                align="end"
                style={{ flex: 1.05, minWidth: 124 }}
                {...sortProps('status')}
              />
              <View style={styles.meltActionsHead}>
                <Pressable
                  style={[styles.receiveButton, allReceived && styles.receiveButtonOn]}
                  onPress={() => onReceiveAll(storeScope)}
                  disabled={allReceived}
                  accessibilityRole="button"
                  accessibilityLabel={allReceived ? 'All received' : 'Receive all'}
                >
                  <Ionicons
                    name={allReceived ? 'checkmark-done' : 'checkmark-done-outline'}
                    size={15}
                    color={allReceived ? '#fff' : TEXT}
                  />
                  <Text style={[styles.receiveButtonText, allReceived && styles.receiveButtonTextOn]}>
                    {allReceived ? 'All received' : 'Receive all'}
                  </Text>
                </Pressable>
                <View style={styles.removeButton} />
              </View>
            </>
          }
        />
      )}

      <AddDocumentsModal
        visible={addOpen}
        busy={busy}
        error={error}
        session={session}
        stores={storeList}
        existingIds={existingIds}
        transfers={transfers}
        currentDateKey={batch?.dateKey}
        onClose={() => {
          if (!busy) {
            setError('');
            onAddOpenChange(false);
          }
        }}
        onConfirm={loadRange}
        onAddDoc={(row) => {
          onMergePos([row]);
          onAddOpenChange(false);
          if (row.type === 'purchase') {
            const auth = resolvePosAuthForRow(session, { systemKey: row.systemKey });
            if (!auth.token) return;
            fillMissingPoImages(auth.token, auth.baseUrl, [row])
              .then((enriched) => {
                if (enriched[0] && enriched[0] !== row) onMergePos(enriched);
              })
              .catch(() => {});
          }
        }}
      />

      {feedOpen ? (
        <MeltPoFeedModal
          visible
          rows={visiblePos}
          onClose={() => setFeedOpen(false)}
          onOpen={setOpenRow}
          onToggleReceived={onToggleReceived}
        />
      ) : null}

      <TriageReviewDrawer
        visible={Boolean(openRow)}
        session={session}
        row={openRow}
        review={openRow?.review || null}
        extraRows={pos}
        onClose={() => setOpenRow(null)}
        onSave={onSaveReview}
        onHydrate={(enriched) => patchTriagePosDetails(batch.id, [enriched])}
      />
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Bullion tab                                                          */
/* ------------------------------------------------------------------ */

const BULLION_SORTERS = {
  reference: (row) => row.reference,
  dateLabel: (row) => row.dateKey || '',
  fromName: (row) => row.fromName,
  toName: (row) => bullionToLabel(row),
  items: (row) => bullionItemsLabel(row).qty,
  status: (row) => bullionStatus(row).label,
};

function BullionTransferDrawer({ visible, transfer, onClose }) {
  const held = useHeldValue(transfer);
  const live = transfer || held;
  if (!live) return null;

  const items = Array.isArray(live.items) ? live.items : [];
  const path = (live.pathLabels || []).filter(Boolean).join(' → ') || `${live.fromName || '—'} → ${live.toName || '—'}`;
  const status = bullionStatus(live);
  const sent = items.reduce((sum, item) => sum + (Number(item.sentQty) || 0), 0);
  const got = items.reduce(
    (sum, item) =>
      sum + (item.received ? Number(item.sentQty) || 0 : Math.min(Number(item.receivedQty) || 0, Number(item.sentQty) || 0)),
    0,
  );

  return (
    <TriageDrawer visible={visible} onClose={onClose} title={live.reference} subtitle={live.dateLabel} widthRatio={0.46}>
      <ScrollView
        style={styles.drawerBody}
        contentContainerStyle={styles.drawerBodyContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.drawerHero}>
          <Text style={styles.drawerHeroRoute}>{path}</Text>
          <StatusPill label={status.label} tone={status.tone} />
          <View style={styles.drawerProgress}>
            <ProgressBar value={got} total={sent} tone={status.tone === 'neutral' ? 'blue' : status.tone} height={5} />
            <Text style={styles.drawerProgressText}>
              {formatQty(got)} of {formatQty(sent)} units received
            </Text>
          </View>
        </View>

        <SectionLabel>Details</SectionLabel>
        <Group>
          <GroupRow label="Transfer" value={live.reference} />
          <GroupRow label="Date" value={live.dateLabel} />
          <GroupRow label="From" value={live.fromName} />
          <GroupRow label="To" value={bullionToLabel(live)} />
          <GroupRow label="Source" value={live.source === 'pos' ? 'POS transfer' : 'Planned in app'} />
          <GroupRow label="Note" value={live.note} last />
        </Group>

        <SectionLabel>Items{items.length ? ` · ${items.length}` : ''}</SectionLabel>
        <Group>
          {items.length === 0 ? (
            <Text style={styles.drawerEmpty}>No line items on this transfer.</Text>
          ) : (
            items.map((item, index) => {
              const itemSent = Number(item.sentQty) || 0;
              const itemGot = item.received ? itemSent : Number(item.receivedQty) || 0;
              const done = itemSent > 0 && itemGot >= itemSent;
              return (
                <View key={item.id} style={[styles.drawerItem, index === items.length - 1 && styles.drawerItemLast]}>
                  <Ionicons
                    name={done ? 'checkmark-circle' : itemGot > 0 ? 'remove-circle' : 'ellipse-outline'}
                    size={20}
                    color={done ? GREEN : itemGot > 0 ? T.orange : T.tertiary}
                  />
                  <View style={styles.drawerItemText}>
                    <Text style={styles.drawerItemName} numberOfLines={2}>
                      {item.productName}
                    </Text>
                    <Text style={styles.drawerItemSub} numberOfLines={1}>
                      {[item.sku, [item.fromName, item.toName].filter(Boolean).join(' → ')].filter(Boolean).join(' · ') || path}
                    </Text>
                  </View>
                  <Text style={styles.drawerItemQty}>
                    {itemGot !== itemSent && (itemGot > 0 || item.receivedQty != null)
                      ? `${formatQty(itemGot)} / ${formatQty(itemSent)}`
                      : formatQty(itemSent)}
                  </Text>
                </View>
              );
            })
          )}
        </Group>
      </ScrollView>
    </TriageDrawer>
  );
}

const BullionTableRow = memo(function BullionTableRow({ row, onOpen, last }) {
  const status = bullionStatus(row);
  const items = bullionItemsLabel(row);
  return (
    <TableRowPressable last={last} onPress={() => onOpen(row)} accessibilityLabel={`Open ${row.reference}`}>
      <TableCell flex={1.2} minWidth={128}>
        <TableStrong>{row.reference}</TableStrong>
        {row.source === 'pos' ? <TableMuted>POS</TableMuted> : null}
      </TableCell>
      <TableCell flex={0.9} minWidth={96}>
        {row.dateLabel}
      </TableCell>
      <TableCell flex={1.15} minWidth={116}>
        {row.fromName}
      </TableCell>
      <TableCell flex={1.15} minWidth={116}>
        {bullionToLabel(row)}
      </TableCell>
      <TableCell flex={0.8} minWidth={96} align="right">
        <Text style={[styles.cellText, styles.cellRight]} numberOfLines={1}>
          {items.count ? `${items.count} · ${formatQty(items.qty)}` : '—'}
        </Text>
      </TableCell>
      <TableCell flex={1.05} minWidth={130} last>
        <TableStatus label={status.label} tone={status.tone} />
      </TableCell>
    </TableRowPressable>
  );
});

function BullionTab({ rows, busy, stores, storeScope }) {
  const storeList = stores || [];
  const [openId, setOpenId] = useState(null);
  const [openFilter, setOpenFilter] = useState(null);
  const [filters, setFilters] = useState(EMPTY_BULLION_FILTERS);
  const [sort, setSort] = useState(null);

  const scoped = useMemo(
    () => (storeScope ? rows.filter((row) => namesMatch(row.fromName, storeScope)) : rows),
    [rows, storeScope],
  );

  const setFilter = useCallback((key, value) => {
    setFilters((current) => ({ ...current, [key]: value }));
  }, []);
  const filtersActive = Object.values(filters).some((value) => selectedLabels(value).length > 0);
  const clearFilters = useCallback(() => {
    setFilters(EMPTY_BULLION_FILTERS);
    setSort(null);
    setOpenFilter(null);
  }, []);

  const rowMatches = useCallback(
    (row, skip) =>
      (skip === 'reference' || matchesSelectedLabel(row.reference, filters.reference)) &&
      (skip === 'dateLabel' || matchesSelectedLabel(row.dateLabel, filters.dateLabel)) &&
      (skip === 'fromName' || matchesSelectedLabel(row.fromName, filters.fromName)) &&
      (skip === 'toName' || matchesSelectedLabel(bullionToLabel(row), filters.toName)) &&
      (skip === 'status' || matchesSelectedLabel(bullionStatus(row).label, filters.status)),
    [filters],
  );
  const optionsFor = useCallback(
    (key, getValue) => uniqueLabels(scoped.filter((row) => rowMatches(row, key)).map(getValue)),
    [rowMatches, scoped],
  );
  const referenceOptions = useMemo(() => optionsFor('reference', (row) => row.reference), [optionsFor]);
  const dateOptions = useMemo(() => optionsFor('dateLabel', (row) => row.dateLabel), [optionsFor]);
  const fromOptions = useMemo(() => optionsFor('fromName', (row) => row.fromName), [optionsFor]);
  const toOptions = useMemo(() => optionsFor('toName', bullionToLabel), [optionsFor]);
  const statusOptions = useMemo(() => optionsFor('status', (row) => bullionStatus(row).label), [optionsFor]);

  const visibleRows = useMemo(() => {
    const filtered = scoped.filter((row) => rowMatches(row));
    return sort ? sortRows(filtered, BULLION_SORTERS[sort.key], sort.dir) : filtered;
  }, [rowMatches, scoped, sort]);

  const pending = scoped.filter((row) => row.receiveStatus !== RECEIVE_STATUS.all_received).length;
  const openRow = visibleRows.find((row) => row.id === openId) || rows.find((row) => row.id === openId) || null;

  const sortProps = (key) => ({
    sortDir: sort?.key === key ? sort.dir : null,
    onSort: (dir) => setSort(dir ? { key, dir } : null),
  });

  const openFromTable = useCallback((item) => {
    setOpenFilter(null);
    setOpenId(item.id);
  }, []);
  const renderBullionRow = useCallback(
    ({ item, index }) => <BullionTableRow row={item} last={index === visibleRows.length - 1} onOpen={openFromTable} />,
    [openFromTable, visibleRows.length],
  );

  return (
    <View style={styles.body}>
      {scoped.length === 0 ? (
        <EmptyState
          icon="cube-outline"
          title={busy ? 'Loading transfers…' : 'No bullion transfers'}
          body={
            busy
              ? 'Checking POS for transfers headed to the Workshop.'
              : `Transfers from ${storeScope || storeNamesLabel(storeList) || 'these stores'} to the Workshop appear here automatically.`
          }
        />
      ) : (
        <TableFrame
            minWidth={800}
            data={visibleRows}
            renderItem={renderBullionRow}
            keyExtractor={meltKey}
            ListEmptyComponent={<TableEmpty>No transfers match those filters.</TableEmpty>}
            toolbar={
              <>
                <Text style={styles.tableMeta}>
                  {filtersActive ? `${visibleRows.length} of ${scoped.length}` : scoped.length}{' '}
                  {scoped.length === 1 ? 'transfer' : 'transfers'}
                  {pending > 0 ? `  ·  ${pending} pending` : '  ·  all received'}
                  {busy ? '  ·  refreshing…' : ''}
                </Text>
                <View style={styles.toolbarActions}>
                  {filtersActive || sort ? <TextAction label="Clear" onPress={clearFilters} /> : null}
                </View>
              </>
            }
            header={
              <>
                <ColumnFilter
                  columnKey="reference"
                  label="Transfer"
                  value={filters.reference}
                  onChange={(value) => setFilter('reference', value)}
                  options={referenceOptions}
                  openKey={openFilter}
                  onOpenKey={setOpenFilter}
                  style={{ flex: 1.2, minWidth: 128 }}
                  {...sortProps('reference')}
                />
                <ColumnFilter
                  columnKey="dateLabel"
                  label="Date"
                  value={filters.dateLabel}
                  onChange={(value) => setFilter('dateLabel', value)}
                  options={dateOptions}
                  openKey={openFilter}
                  onOpenKey={setOpenFilter}
                  style={{ flex: 0.9, minWidth: 96 }}
                  {...sortProps('dateLabel')}
                />
                <ColumnFilter
                  columnKey="fromName"
                  label="From"
                  value={filters.fromName}
                  onChange={(value) => setFilter('fromName', value)}
                  options={fromOptions}
                  openKey={openFilter}
                  onOpenKey={setOpenFilter}
                  style={{ flex: 1.15, minWidth: 116 }}
                  {...sortProps('fromName')}
                />
                <ColumnFilter
                  columnKey="toName"
                  label="To"
                  value={filters.toName}
                  onChange={(value) => setFilter('toName', value)}
                  options={toOptions}
                  openKey={openFilter}
                  onOpenKey={setOpenFilter}
                  style={{ flex: 1.15, minWidth: 116 }}
                  {...sortProps('toName')}
                />
                <ColumnFilter
                  columnKey="items"
                  label="Items"
                  value={[]}
                  sortOnly
                  openKey={openFilter}
                  onOpenKey={setOpenFilter}
                  align="end"
                  style={{ flex: 0.8, minWidth: 96, alignItems: 'flex-end' }}
                  {...sortProps('items')}
                />
                <ColumnFilter
                  columnKey="status"
                  label="Status"
                  value={filters.status}
                  onChange={(value) => setFilter('status', value)}
                  options={statusOptions}
                  openKey={openFilter}
                  onOpenKey={setOpenFilter}
                  align="end"
                  style={{ flex: 1.05, minWidth: 130 }}
                  {...sortProps('status')}
                />
              </>
            }
          />
      )}
      <BullionTransferDrawer visible={Boolean(openRow)} transfer={openRow} onClose={() => setOpenId(null)} />
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Store picker + create / add-store modals                             */
/* ------------------------------------------------------------------ */

function StoreMultiPicker({ session, addedKeys, selectedIds, onChangeSelected }) {
  const [query, setQuery] = useState('');
  const [stores, setStores] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const storesRef = useRef(stores);
  storesRef.current = stores;

  useEffect(() => {
    let cancelled = false;
    setQuery('');
    setError('');
    setLoading(true);

    fetchTransferStores(session)
      .then((result) => {
        if (cancelled) return;
        setStores(result.stores || []);
        if (result.warning) setError(result.warning);
      })
      .catch((err) => {
        if (cancelled) return;
        setStores([]);
        setError(err?.message || 'Failed to load stores.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [session]);

  const emit = (nextIds) => {
    const picked = storesRef.current.filter((store) => nextIds.has(store.id));
    onChangeSelected(nextIds, picked);
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return stores.filter((store) => {
      if (addedKeys.has(store.id)) return false;
      if (isWorkshopStore(store)) return false;
      if (!q) return true;
      const hay = [store.name, store.city, store.systemLabel, store.address].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [addedKeys, query, stores]);

  const allVisibleSelected = filtered.length > 0 && filtered.every((store) => selectedIds.has(store.id));

  const toggle = (storeId) => {
    const next = new Set(selectedIds);
    if (next.has(storeId)) next.delete(storeId);
    else next.add(storeId);
    emit(next);
  };

  const toggleVisible = () => {
    const next = new Set(selectedIds);
    if (allVisibleSelected) filtered.forEach((store) => next.delete(store.id));
    else filtered.forEach((store) => next.add(store.id));
    emit(next);
  };

  return (
    <View style={styles.storePicker}>
      <SearchField value={query} onChangeText={setQuery} placeholder="Search stores" style={styles.storeSearch} />

      <View style={styles.storeSelectBar}>
        <Text style={styles.storeSelectCount}>
          {selectedIds.size === 0 ? 'Choose the stores sending to the Workshop' : `${selectedIds.size} selected`}
        </Text>
        {filtered.length > 0 ? (
          <Pressable onPress={toggleVisible} hitSlop={8} accessibilityRole="button">
            <Text style={styles.storeSelectAll}>{allVisibleSelected ? 'Clear' : 'Select all'}</Text>
          </Pressable>
        ) : null}
      </View>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      {loading ? (
        <View style={styles.modalBusy}>
          <ActivityIndicator color={BLUE} />
        </View>
      ) : (
        <ScrollView
          style={styles.storeList}
          contentContainerStyle={styles.storeListContent}
          keyboardShouldPersistTaps="handled"
          nestedScrollEnabled
          showsVerticalScrollIndicator
        >
          <Group>
            {filtered.length === 0 ? (
              <Text style={styles.modalEmpty}>
                {stores.length === 0 ? 'No stores available.' : addedKeys.size && !query ? 'Every store is already on this batch.' : 'No matching stores.'}
              </Text>
            ) : (
              filtered.map((store, index) => {
                const selected = selectedIds.has(store.id);
                return (
                  <Pressable
                    key={store.id}
                    style={[styles.storePickRow, index === filtered.length - 1 && styles.storePickRowLast]}
                    onPress={() => toggle(store.id)}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: selected }}
                    accessibilityLabel={store.name}
                  >
                    <Ionicons
                      name={selected ? 'checkmark-circle' : 'ellipse-outline'}
                      size={22}
                      color={selected ? BLUE : T.tertiary}
                    />
                    <View style={styles.storePickText}>
                      <Text style={styles.storePickTitle} numberOfLines={1}>
                        {store.name}
                      </Text>
                      <Text style={styles.storePickSub} numberOfLines={1}>
                        {[store.city, store.systemLabel].filter(Boolean).join(' · ') || store.address}
                      </Text>
                    </View>
                  </Pressable>
                );
              })
            )}
          </Group>
        </ScrollView>
      )}
    </View>
  );
}

function CreateBatchModal({ visible, session, transfers, onClose, onCreate }) {
  const isMobile = useIsMobile();
  const [date, setDate] = useState(() => parseDateParam(new Date()));
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [pickedStores, setPickedStores] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!visible) return;
    setDate(parseDateParam(new Date()));
    setSelectedIds(new Set());
    setPickedStores([]);
    setError('');
  }, [visible]);

  const dateKey = formatDateParam(date);
  const existing = useMemo(
    () => (transfers || []).find((row) => !isStandaloneTriage(row) && row.dateKey === dateKey) || null,
    [dateKey, transfers],
  );
  const addedKeys = useMemo(
    () => new Set((existing?.stores || []).map((store) => store.storeKey).filter(Boolean)),
    [existing],
  );

  useEffect(() => {
    setSelectedIds(new Set());
    setPickedStores([]);
    setError('');
  }, [dateKey]);

  const create = () => {
    if (pickedStores.length === 0) {
      setError('Select at least one store.');
      return;
    }
    const mapped = pickedStores.map(mapPickedStore);
    const incoming = existing ? mapped.filter((store) => !storeOnBatch(existing.stores, store)) : mapped;
    if (incoming.length === 0) {
      setError('Those stores are already on this date.');
      return;
    }
    onCreate({
      id: existing?.id || newId('xfer'),
      dateKey,
      dateLabel: existing?.dateLabel || formatPickerDate(date),
      triageLocation: existing?.triageLocation || { ...WORKSHOP_LOCATION },
      stores: incoming,
      mergeIntoId: existing?.id || null,
    });
  };

  if (!visible) return null;

  return (
    <Modal visible transparent animationType={isMobile ? 'slide' : 'fade'} onRequestClose={onClose}>
      <View style={[styles.modalBackdrop, isMobile && styles.sheetBackdrop]} pointerEvents="box-none">
        {isMobile ? null : <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />}
        <View style={[styles.storeCard, isMobile && styles.sheetCard]} pointerEvents="auto">
          {isMobile ? <View style={styles.sheetGrabber} /> : null}
          <View style={styles.sheetHeader}>
            <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button">
              <Text style={styles.navAction}>Cancel</Text>
            </Pressable>
            <View style={styles.sheetTitleBlock}>
              <Text style={styles.modalTitle}>{existing ? 'Add Stores' : 'New Batch'}</Text>
              <Text style={styles.modalSub}>
                {existing ? `Adding to ${existing.dateLabel || dateKey}` : 'Stores sending to the Workshop'}
              </Text>
            </View>
            <Pressable
              onPress={create}
              disabled={pickedStores.length === 0}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={existing ? 'Add' : 'Create'}
            >
              <Text
                style={[styles.navAction, styles.navActionStrong, pickedStores.length === 0 && styles.navActionDisabled]}
              >
                {existing ? 'Add' : 'Create'}
              </Text>
            </Pressable>
          </View>
          <DateField value={date} onChange={setDate} />
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
          <StoreMultiPicker
            session={session}
            addedKeys={addedKeys}
            selectedIds={selectedIds}
            onChangeSelected={(ids, picked) => {
              setSelectedIds(ids);
              setPickedStores(picked);
              if (error) setError('');
            }}
          />
        </View>
      </View>
    </Modal>
  );
}

function AddStoreModal({ visible, session, addedKeys, dateLabel, onClose, onAdd }) {
  const isMobile = useIsMobile();
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [pickedStores, setPickedStores] = useState([]);

  useEffect(() => {
    if (!visible) return;
    setSelectedIds(new Set());
    setPickedStores([]);
  }, [visible]);

  if (!visible) return null;

  return (
    <Modal visible transparent animationType={isMobile ? 'slide' : 'fade'} onRequestClose={onClose}>
      <View style={[styles.modalBackdrop, isMobile && styles.sheetBackdrop]} pointerEvents="box-none">
        {isMobile ? null : <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />}
        <View style={[styles.storeCard, isMobile && styles.sheetCard]} pointerEvents="auto">
          {isMobile ? <View style={styles.sheetGrabber} /> : null}
          <View style={styles.sheetHeader}>
            <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button">
              <Text style={styles.navAction}>Cancel</Text>
            </Pressable>
            <View style={styles.sheetTitleBlock}>
              <Text style={styles.modalTitle}>Add Stores</Text>
              {dateLabel ? <Text style={styles.modalSub}>{dateLabel}</Text> : null}
            </View>
            <Pressable
              onPress={() => {
                if (pickedStores.length) onAdd(pickedStores.map(mapPickedStore));
              }}
              disabled={selectedIds.size === 0}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Add"
            >
              <Text style={[styles.navAction, styles.navActionStrong, selectedIds.size === 0 && styles.navActionDisabled]}>
                {selectedIds.size > 0 ? `Add ${selectedIds.size}` : 'Add'}
              </Text>
            </Pressable>
          </View>
          <StoreMultiPicker
            session={session}
            addedKeys={addedKeys}
            selectedIds={selectedIds}
            onChangeSelected={(ids, picked) => {
              setSelectedIds(ids);
              setPickedStores(picked);
            }}
          />
        </View>
      </View>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Dashboard list                                                       */
/* ------------------------------------------------------------------ */

function batchMatchesQuery(batch, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  const pos = flattenBatchPos(batch);
  const hay = [
    batch.dateLabel,
    batch.dateKey,
    ...(batch.stores || []).map((store) => store.name),
    ...pos.map((row) => row.reference),
    ...pos.map((row) => row.customerName),
    ...pos.map((row) => row.storeName),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return hay.includes(q);
}

function standalonePo(batch) {
  return flattenBatchPos(batch)[0] || null;
}

function DashboardRow({ kind, title, detail, status, last, onPress, onDelete, openLabel, deleteLabel, thumbs }) {
  const isMobile = useIsMobile();
  return (
    <View style={[styles.dashRow, last && styles.dashRowLast]}>
      <Pressable
        style={[styles.dashMain, isMobile && styles.dashMainMobile]}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={openLabel}
        {...(Platform.OS === 'web' ? { className: 'cgold-triage-row' } : null)}
      >
        <Text style={styles.dashKind}>{kind}</Text>
        {thumbs ? <View style={styles.dashThumbs}>{thumbs}</View> : null}
        <View style={styles.dashText}>
          <Text style={styles.dashTitle} numberOfLines={1}>
            {title}
          </Text>
          {detail ? (
            <Text style={styles.dashDetail} numberOfLines={isMobile ? 2 : 1}>
              {detail}
            </Text>
          ) : null}
          {isMobile && status ? (
            <Text style={styles.dashDetail} numberOfLines={1}>
              {status}
            </Text>
          ) : null}
        </View>
        {!isMobile && status ? (
          <Text style={styles.dashStatus} numberOfLines={1}>
            {status}
          </Text>
        ) : null}
      </Pressable>
      <Pressable
        style={styles.batchDelete}
        onPress={onDelete}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={deleteLabel}
      >
        <Text style={styles.batchDeleteText}>Delete</Text>
      </Pressable>
    </View>
  );
}

function BatchRow({ batch, stats, today, last, onPress, onDelete }) {
  const storeNames = (batch.stores || []).map((store) => store.name).filter(Boolean);
  const expected = expectedPosLabel(stats);
  const photos = flattenBatchPos(batch)
    .filter((row) => (row.imageUrls || []).some(Boolean))
    .slice(0, 3);
  const status = stats.empty
    ? expected || 'No documents'
    : [
        stats.complete ? 'Received' : `${stats.received} of ${stats.expected}`,
        stats.flagged ? `${stats.flagged} flagged` : '',
      ]
        .filter(Boolean)
        .join(' · ');
  return (
    <DashboardRow
      kind="Batch"
      title={today ? 'Today' : batch.dateLabel || 'Batch'}
      detail={[storeNames.length ? storeNames.join(', ') : 'No stores', !stats.empty && expected].filter(Boolean).join(' · ')}
      status={status}
      last={last}
      onPress={onPress}
      onDelete={onDelete}
      openLabel={`Open batch ${batch.dateLabel}`}
      deleteLabel={`Delete batch ${batch.dateLabel}`}
      thumbs={
        photos.length
          ? photos.map((row) => <PoThumb key={row.id} urls={row.imageUrls} label={row.reference} />)
          : null
      }
    />
  );
}

function QuickPoRow({ batch, stats, last, onPress, onDelete }) {
  const row = standalonePo(batch);
  const kind = parseDocReference(row?.reference || row)?.kind || 'PO';
  const status = [
    stats?.flagged ? 'Flagged' : row?.received ? 'Received' : 'Open',
    poHoldsBullion(row) ? 'Bullion' : '',
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <DashboardRow
      kind={kind}
      title={row?.reference || kind}
      detail={[row?.storeName, row?.dateLabel, row?.customerName].filter(Boolean).join(' · ')}
      status={status}
      last={last}
      onPress={onPress}
      onDelete={onDelete}
      openLabel={`Open ${row?.reference || kind}`}
      deleteLabel={`Remove ${row?.reference || kind}`}
      thumbs={<PoThumb urls={row?.imageUrls} label={row?.reference} />}
    />
  );
}

function BatchList({ transfers, query = '', onOpen, onOpenPo, onDelete }) {
  const todayKey = formatDateParam(new Date());
  const statsById = useMemo(() => new Map(transfers.map((row) => [row.id, batchStats(row)])), [transfers]);
  const rows = useMemo(
    () =>
      transfers
        .filter((row) => batchMatchesQuery(row, query))
        .slice()
        .sort((a, b) => String(b.dateKey || '').localeCompare(String(a.dateKey || ''))),
    [query, transfers],
  );

  return (
    <ScrollView style={styles.list} contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}>
      {rows.length === 0 && query ? (
        <Text style={styles.listEmpty}>No PO or SO matches “{query.trim()}”.</Text>
      ) : (
        <Group>
          {rows.map((row, index) =>
            isStandaloneTriage(row) ? (
              <QuickPoRow
                key={row.id}
                batch={row}
                stats={statsById.get(row.id)}
                last={index === rows.length - 1}
                onPress={() => onOpenPo(row)}
                onDelete={() => onDelete(row)}
              />
            ) : (
              <BatchRow
                key={row.id}
                batch={row}
                stats={statsById.get(row.id)}
                today={row.dateKey === todayKey}
                last={index === rows.length - 1}
                onPress={() => onOpen(row)}
                onDelete={() => onDelete(row)}
              />
            ),
          )}
        </Group>
      )}
    </ScrollView>
  );
}

/* ------------------------------------------------------------------ */
/* Batch detail                                                         */
/* ------------------------------------------------------------------ */

function BatchSummary({ pos, stats, bullion, storeScope, onStoreScope, mobile, onAddStore, onRemoveStore }) {
  const tone = stats.empty ? 'neutral' : stats.complete ? 'green' : 'blue';
  const pendingBullion = bullion.rows.filter((row) => row.receiveStatus !== RECEIVE_STATUS.all_received).length;
  const stripContent = (
    <StatStrip style={mobile && styles.statStripMobile}>
      <Stat
        label="Expected"
        value={stats.totalPurchases > stats.expected ? `${stats.expected}/${stats.totalPurchases}` : String(stats.expected)}
        sub={
          stats.bullionOnly
            ? `${stats.bullionOnly} bullion only · stay in store`
            : stats.amount
              ? formatAmount(stats.amount)
              : 'No purchases'
        }
      />
      <Stat
        label="Received"
        value={stats.expected ? `${stats.received}/${stats.expected}` : '0'}
        sub={stats.expected ? `${stats.percent}%` : '—'}
        tone={stats.complete ? 'green' : undefined}
      />
      <Stat label="Open" value={String(stats.open)} sub={stats.open ? 'to receive' : 'nothing left'} tone={stats.open ? 'orange' : undefined} />
      <Stat label="Flagged" value={String(stats.flagged)} sub={stats.flagged ? 'need correction' : 'all clean'} tone={stats.flagged ? 'red' : undefined} />
      <Stat
        label="Bullion"
        value={bullion.busy && bullion.rows.length === 0 ? '…' : String(bullion.rows.length)}
        sub={bullion.rows.length ? (pendingBullion ? `${pendingBullion} pending` : 'all received') : 'no transfers'}
        tone={pendingBullion ? 'blue' : undefined}
      />
    </StatStrip>
  );

  return (
    <View style={styles.summary}>
      {mobile ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.statScroll}>
          {stripContent}
        </ScrollView>
      ) : (
        stripContent
      )}
      <ProgressBar value={stats.received} total={stats.expected} tone={tone} height={4} style={styles.summaryProgress} />
      <View style={styles.storeChips}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.storeChipsScroll}>
          <Chip label="All stores" count={stats.documents} selected={!storeScope} onPress={() => onStoreScope(null)} />
          {stats.stores.map((store) => (
            <Chip
              key={store.id}
              label={store.name}
              count={store.documents}
              selected={Boolean(storeScope && namesMatch(storeScope, store.name))}
              onPress={() => onStoreScope(namesMatch(storeScope, store.name) ? null : store.name)}
            />
          ))}
        </ScrollView>
        <View style={styles.storeChipActions}>
          {storeScope ? (
            <TextAction
              label="Remove store"
              destructive
              onPress={() => {
                const store = stats.stores.find((entry) => namesMatch(entry.name, storeScope));
                if (store) onRemoveStore(store);
              }}
            />
          ) : null}
          <TextAction icon="add" label="Store" onPress={onAddStore} accessibilityLabel="Add store to batch" />
        </View>
      </View>
    </View>
  );
}

function BatchDetail({ session, batch, transfers, storeTab, onStoreTab, addMeltOpen, onAddMeltOpen, mobile }) {
  const actor = actorNameOf(session);
  const stores = useMemo(() => batch.stores || [], [batch.stores]);
  const pos = useMemo(() => flattenBatchPos(batch), [batch]);
  const stats = useMemo(() => batchStats(batch), [batch]);
  const bullion = useWorkshopTransfers(session, stores);
  const [storeScope, setStoreScope] = useState(null);
  const [addStoreOpen, setAddStoreOpen] = useState(false);

  useEffect(() => {
    if (storeScope && !stores.some((store) => namesMatch(store.name, storeScope))) setStoreScope(null);
  }, [storeScope, stores]);

  const mergePos = useCallback(
    (rows) => {
      mergeTriagePos(batch.id, rows);
    },
    [batch.id],
  );
  const removePo = useCallback(
    (poId) => {
      removeTriagePo(batch.id, poId, actor);
    },
    [actor, batch.id],
  );
  const toggleReceived = useCallback(
    (poId) => {
      toggleTriagePoReceived(batch.id, poId, actor);
    },
    [actor, batch.id],
  );
  const receiveAll = useCallback(
    (scopeName) => {
      const store = scopeName ? stores.find((entry) => namesMatch(entry.name, scopeName)) : null;
      receiveAllTriagePos(batch.id, actor, store?.id);
    },
    [actor, batch.id, stores],
  );
  const saveReview = useCallback((poId, review) => {
    saveTriagePoReview(poId, review);
  }, []);
  const addStores = useCallback(
    (incoming) => {
      updateTriageTransfers((current) =>
        current.map((row) => {
          if (row.id !== batch.id) return row;
          const fresh = incoming.filter((store) => !storeOnBatch(row.stores, store));
          return { ...row, stores: sortBatchStores([...(row.stores || []), ...fresh]) };
        }),
      );
      setAddStoreOpen(false);
      if (incoming.length) onAddMeltOpen(true);
    },
    [batch.id, onAddMeltOpen],
  );
  const removeStore = useCallback(
    (store) => {
      const docs = store.documents || 0;
      confirmDestructive(
        `Remove ${store.name}?`,
        docs ? `${docs} ${docNoun(pos.filter((row) => namesMatch(row.storeName, store.name)), docs)} from ${store.name} will come off this batch.` : 'This store will come off the batch.',
        () => {
          removeTriageBatchStore(batch.id, store.id);
          setStoreScope(null);
        },
        'Remove',
      );
    },
    [batch.id, pos],
  );

  const addedKeys = useMemo(() => new Set(stores.map((store) => store.storeKey).filter(Boolean)), [stores]);
  const tabOptions = useMemo(
    () => [
      { key: 'melt', label: 'Melt', count: storeScope ? stats.stores.find((s) => namesMatch(s.name, storeScope))?.documents ?? 0 : stats.documents },
      { key: 'bullion', label: 'Bullion', count: storeScope ? bullion.rows.filter((row) => namesMatch(row.fromName, storeScope)).length : bullion.rows.length },
    ],
    [bullion.rows, stats, storeScope],
  );

  return (
    <View style={styles.body}>
      <BatchSummary
        pos={pos}
        stats={stats}
        bullion={bullion}
        storeScope={storeScope}
        onStoreScope={setStoreScope}
        mobile={mobile}
        onAddStore={() => setAddStoreOpen(true)}
        onRemoveStore={removeStore}
      />
      <TextTabs
        options={tabOptions}
        value={storeTab}
        onChange={(key) => {
          onStoreTab(key);
          if (key !== 'melt') onAddMeltOpen(false);
        }}
        style={styles.detailTabs}
        trailing={
          storeTab === 'melt' ? (
            <TextAction icon="add" label="Add" onPress={() => onAddMeltOpen(true)} accessibilityLabel="Add PO / SO" />
          ) : null
        }
      />

      {storeTab === 'melt' ? (
        <MeltTab
          session={session}
          batch={batch}
          stores={stores}
          pos={pos}
          storeScope={storeScope}
          transfers={transfers}
          addOpen={addMeltOpen}
          onAddOpenChange={onAddMeltOpen}
          onMergePos={mergePos}
          onRemovePos={removePo}
          onToggleReceived={toggleReceived}
          onReceiveAll={receiveAll}
          onSaveReview={saveReview}
        />
      ) : (
        <BullionTab rows={bullion.rows} busy={bullion.busy} stores={stores} storeScope={storeScope} />
      )}

      <AddStoreModal
        visible={addStoreOpen}
        session={session}
        addedKeys={addedKeys}
        dateLabel={batch.dateLabel}
        onClose={() => setAddStoreOpen(false)}
        onAdd={addStores}
      />
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Panel root                                                           */
/* ------------------------------------------------------------------ */

export default function TriageTransfersPanel({
  session,
  onRequireLogin,
  createOpen,
  onCreateOpenChange,
  quickAddOpen,
  onQuickAddOpenChange,
  onViewChange,
  onBackChange,
  listQuery = '',
}) {
  const { triage: transfers } = useTransferWorkflow();
  const isMobile = useIsMobile();
  const [selectedId, setSelectedId] = useState(null);
  const [storeTab, setStoreTab] = useState('melt');
  const [addMeltOpen, setAddMeltOpen] = useState(false);
  const [openStandalone, setOpenStandalone] = useState(null);
  const [quickAddError, setQuickAddError] = useState('');

  const selected = useMemo(
    () => transfers.find((row) => row.id === selectedId && !isStandaloneTriage(row)) || null,
    [selectedId, transfers],
  );
  const existingPoIds = useMemo(
    () => transfers.flatMap((row) => flattenBatchPos(row).map((item) => item.id)),
    [transfers],
  );
  const batchContext = useMemo(() => {
    if (!selected) return null;
    return {
      dateLabel: selected.dateLabel || selected.dateKey || '',
      storeNames: storeNamesLabel(selected.stores || []),
    };
  }, [selected]);

  const view = selected ? 'store' : 'list';

  const goBackToList = useCallback(() => {
    setAddMeltOpen(false);
    setSelectedId(null);
  }, []);

  useEffect(() => {
    onViewChange?.(view);
  }, [onViewChange, view]);

  useEffect(() => {
    onBackChange?.(selected ? goBackToList : null, batchContext);
    return () => onBackChange?.(null, null);
  }, [batchContext, goBackToList, onBackChange, selected]);

  const openBatch = useCallback((row) => {
    if (isStandaloneTriage(row)) {
      const item = standalonePo(row);
      if (item) setOpenStandalone(item);
      return;
    }
    if (!row?.stores?.length) return;
    setSelectedId(row.id);
    const hasBullion = row.stores.some((store) => plannedForTriageStore(row.dateKey, store.storeKey).length > 0);
    const hasMelt = row.stores.some((store) => (store.meltPos || []).length > 0);
    setStoreTab(hasBullion && !hasMelt ? 'bullion' : 'melt');
  }, []);

  const openStandalonePo = useCallback((row) => {
    const item = standalonePo(row);
    if (item) setOpenStandalone(item);
  }, []);

  const addQuickPo = useCallback((row) => {
    const result = addStandaloneTriagePo(row);
    if (!result.ok) {
      const where = isStandaloneTriage(result.batch)
        ? 'the dashboard'
        : result.batch?.dateLabel || 'a batch';
      setQuickAddError(`${row.reference} is already on ${where}.`);
      return;
    }
    setQuickAddError('');
    persistTransferWorkflowNow().catch(() => {});
    onQuickAddOpenChange?.(false);
    const auth = resolvePosAuthForRow(session, { systemKey: row.systemKey });
    if (!auth.token) return;
    fillMissingPoImages(auth.token, auth.baseUrl, [result.item])
      .then((enriched) => {
        const next = enriched[0];
        if (!next?.imageUrls?.length) return;
        mergeTriagePos(result.batch.id, [next]);
        setOpenStandalone((current) =>
          current?.id === next.id ? { ...current, imageUrls: next.imageUrls } : current,
        );
      })
      .catch(() => {});
  }, [onQuickAddOpenChange, session]);

  const saveStandaloneReview = useCallback((poId, review) => {
    saveTriagePoReview(poId, review);
    setOpenStandalone((current) => (current?.id === poId ? applyTriageReviewToPo(current, review) : current));
  }, []);

  const createBatch = useCallback(
    (row) => {
      const mergeId = row.mergeIntoId;
      const incoming = row.stores || [];
      let nextRow = row;
      if (mergeId) {
        const existing = transfers.find((item) => item.id === mergeId);
        if (existing) {
          const fresh = incoming.filter((store) => !storeOnBatch(existing.stores, store));
          nextRow = { ...existing, stores: sortBatchStores([...(existing.stores || []), ...fresh]) };
          updateTriageTransfers((current) => current.map((item) => (item.id === mergeId ? nextRow : item)));
        } else {
          updateTriageTransfers((current) =>
            [{ ...row, stores: sortBatchStores(incoming) }, ...current].sort((a, b) => b.dateKey.localeCompare(a.dateKey)),
          );
        }
      } else {
        nextRow = { ...row, stores: sortBatchStores(incoming) };
        delete nextRow.mergeIntoId;
        updateTriageTransfers((current) => [nextRow, ...current].sort((a, b) => b.dateKey.localeCompare(a.dateKey)));
      }
      persistTransferWorkflowNow().catch(() => {});
      onCreateOpenChange(false);
      openBatch(nextRow);
      if (incoming.length) setAddMeltOpen(true);
    },
    [onCreateOpenChange, openBatch, transfers],
  );

  const deleteBatch = useCallback((row) => {
    if (isStandaloneTriage(row)) {
      const po = standalonePo(row);
      confirmDestructive(
        `Remove ${po?.reference || 'this PO'}?`,
        'It moves to the Deleted tab and stays off the dashboard.',
        () => {
          if (openStandalone?.id === po?.id) setOpenStandalone(null);
          removeTriageBatch(row.id, actorNameOf(session));
          persistTransferWorkflowNow().catch(() => {});
        },
      );
      return;
    }
    const stats = batchStats(row);
    confirmDestructive(
      `Delete ${row.dateLabel || 'this batch'}?`,
      stats.documents
        ? `${stats.documents} ${docNoun(flattenBatchPos(row), stats.documents)} and ${row.stores.length} ${row.stores.length === 1 ? 'store' : 'stores'} move to the Deleted tab.`
        : 'This date moves to the Deleted tab and will not come back on the dashboard.',
      () => {
        removeTriageBatch(row.id, actorNameOf(session));
        persistTransferWorkflowNow().catch(() => {});
      },
    );
  }, [openStandalone?.id, session]);

  if (!session?.token) {
    return (
      <View style={[styles.body, styles.bodyTinted]}>
        <EmptyState
          icon="lock-closed-outline"
          title="Sign in to triage"
          body="Log in to open batches, receive melt, and check bullion transfers."
          action={<TextAction label="Go to Profile" strong onPress={onRequireLogin} />}
        />
      </View>
    );
  }

  if (selected) {
    return (
      <View style={[styles.body, styles.bodyTinted]}>
        <BatchDetail
          key={selected.id}
          session={session}
          batch={selected}
          transfers={transfers}
          storeTab={storeTab}
          onStoreTab={setStoreTab}
          addMeltOpen={addMeltOpen}
          onAddMeltOpen={setAddMeltOpen}
          mobile={isMobile}
        />
      </View>
    );
  }

  return (
    <View style={[styles.body, styles.bodyTinted]}>
      {transfers.length === 0 ? (
        <EmptyState
          icon="calendar-outline"
          title="No batches yet"
          body="A batch is one date plus the stores shipping to the Workshop. Or Quick Add a single PO from any store."
          action={
            <View style={styles.emptyActions}>
              <BarButton label="Quick Add" onPress={() => onQuickAddOpenChange?.(true)} />
              <BarButton icon="add" label="Add Batch" onPress={() => onCreateOpenChange(true)} />
            </View>
          }
        />
      ) : (
        <BatchList
          transfers={transfers}
          query={listQuery}
          onOpen={openBatch}
          onOpenPo={openStandalonePo}
          onDelete={deleteBatch}
        />
      )}

      <CreateBatchModal
        visible={createOpen}
        session={session}
        transfers={transfers}
        onClose={() => onCreateOpenChange(false)}
        onCreate={createBatch}
      />
      <QuickAddModal
        visible={Boolean(quickAddOpen)}
        session={session}
        existingIds={existingPoIds}
        error={quickAddError}
        onClose={() => {
          setQuickAddError('');
          onQuickAddOpenChange?.(false);
        }}
        onAdd={addQuickPo}
      />
      <TriageReviewDrawer
        visible={Boolean(openStandalone)}
        session={session}
        row={openStandalone}
        review={openStandalone?.review || null}
        extraRows={openStandalone ? [openStandalone] : []}
        onClose={() => setOpenStandalone(null)}
        onSave={saveStandaloneReview}
        onHydrate={(enriched) => {
          const found = findTriagePo(enriched.id);
          if (found) patchTriagePosDetails(found.batch.id, [enriched]);
        }}
      />
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Styles                                                               */
/* ------------------------------------------------------------------ */

const webCursor = Platform.select({ web: { cursor: 'pointer' }, default: {} });

const styles = StyleSheet.create({
  body: {
    flex: 1,
    minHeight: 0,
  },
  bodyTinted: {
    backgroundColor: T.bg,
  },
  emptyActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  quickAddIntro: {
    fontFamily,
    fontSize: 13,
    lineHeight: 18,
    color: SECONDARY,
  },

  /* dashboard list */
  list: {
    flex: 1,
    minHeight: 0,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 24,
  },
  listEmpty: {
    fontFamily,
    fontSize: 14,
    color: SECONDARY,
    textAlign: 'center',
    paddingVertical: 32,
  },
  dashRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HAIRLINE,
    backgroundColor: T.card,
  },
  dashRowLast: {
    borderBottomWidth: 0,
  },
  dashMain: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    minHeight: 52,
    paddingLeft: 16,
    paddingRight: 8,
    paddingVertical: 10,
    ...webCursor,
  },
  dashMainMobile: {
    gap: 10,
    paddingLeft: 12,
    minHeight: 56,
  },
  dashKind: {
    width: 44,
    fontFamily,
    fontSize: 11,
    fontWeight: '600',
    color: SECONDARY,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  dashThumbs: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  dashText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  dashTitle: {
    fontFamily,
    fontSize: 15,
    fontWeight: '500',
    color: TEXT,
    letterSpacing: -0.2,
  },
  dashDetail: {
    fontFamily,
    fontSize: 13,
    color: SECONDARY,
  },
  dashStatus: {
    flexShrink: 0,
    maxWidth: 160,
    fontFamily,
    fontSize: 13,
    color: SECONDARY,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  batchDelete: {
    paddingHorizontal: 12,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    ...webCursor,
  },
  batchDeleteText: {
    fontFamily,
    fontSize: 14,
    color: T.red,
  },

  /* batch detail summary */
  summary: {
    flexShrink: 0,
    paddingHorizontal: 16,
    paddingTop: 10,
    gap: 8,
  },
  statScroll: {
    flexGrow: 1,
  },
  statStripMobile: {
    minWidth: '100%',
  },
  summaryProgress: {
    marginHorizontal: 2,
  },
  storeChips: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  storeChipsScroll: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingRight: 8,
  },
  storeChipActions: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  detailTabs: {
    marginTop: 2,
  },

  /* tables */
  tableMeta: {
    flex: 1,
    minWidth: 0,
    fontFamily,
    fontSize: 12.5,
    color: SECONDARY,
  },
  toolbarActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  meltRefRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minWidth: 0,
  },
  meltRefText: {
    flexShrink: 1,
    minWidth: 0,
  },
  meltRowMixed: {
    backgroundColor: 'rgba(255,149,0,0.16)',
  },
  meltRowBullion: {
    backgroundColor: 'rgba(255,59,48,0.16)',
  },
  cellText: {
    fontFamily,
    fontSize: 13,
    color: TEXT,
    letterSpacing: -0.08,
  },
  cellRight: {
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  meltActions: {
    width: 146,
    flexGrow: 0,
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 4,
    paddingRight: 8,
  },
  meltActionsHead: {
    width: 146,
    flexGrow: 0,
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 4,
    paddingRight: 8,
  },
  receiveButton: {
    height: 26,
    paddingHorizontal: 9,
    borderRadius: 8,
    backgroundColor: FILL,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    ...webCursor,
  },
  receiveButtonOn: {
    backgroundColor: GREEN,
  },
  receiveButtonText: {
    fontFamily,
    fontSize: 11.5,
    fontWeight: '600',
    color: TEXT,
  },
  receiveButtonTextOn: {
    color: '#fff',
  },
  removeButton: {
    width: 26,
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
    ...webCursor,
  },

  /* drawer content */
  drawerBody: {
    flex: 1,
    minHeight: 0,
  },
  drawerBodyContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: Math.max(32, mobileSafeBottom() + 16),
  },
  drawerHero: {
    alignItems: 'center',
    paddingVertical: 8,
    gap: 10,
  },
  drawerHeroRoute: {
    fontFamily,
    fontSize: 20,
    fontWeight: '600',
    color: TEXT,
    letterSpacing: -0.4,
    textAlign: 'center',
  },
  drawerProgress: {
    alignSelf: 'stretch',
    gap: 6,
    paddingTop: 4,
  },
  drawerProgressText: {
    fontFamily,
    fontSize: 13,
    color: SECONDARY,
    textAlign: 'center',
  },
  drawerEmpty: {
    fontFamily,
    fontSize: 15,
    color: SECONDARY,
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  drawerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HAIRLINE,
  },
  drawerItemLast: {
    borderBottomWidth: 0,
  },
  drawerItemText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  drawerItemName: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: TEXT,
  },
  drawerItemSub: {
    fontFamily,
    fontSize: 12,
    color: SECONDARY,
  },
  drawerItemQty: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: TEXT,
    fontVariant: ['tabular-nums'],
  },

  /* modals & sheets */
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  sheetBackdrop: {
    padding: 0,
    alignItems: 'stretch',
    justifyContent: 'flex-end',
  },
  sheetBackdropBottom: {
    padding: 0,
    alignItems: 'stretch',
    justifyContent: 'flex-end',
  },
  sheetCard: {
    width: '100%',
    maxWidth: 460,
    backgroundColor: T.bg,
    borderRadius: 14,
    padding: 16,
    gap: 12,
  },
  sheetCardBottom: {
    maxWidth: '100%',
    borderRadius: 0,
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    paddingTop: 10,
    paddingBottom: Math.max(20, mobileSafeBottom()),
  },
  storeCard: {
    width: '96%',
    maxWidth: 560,
    maxHeight: Platform.OS === 'web' ? '82vh' : '82%',
    height: Platform.OS === 'web' ? 640 : '82%',
    backgroundColor: T.bg,
    borderRadius: 14,
    padding: 16,
    gap: 12,
    overflow: 'hidden',
    zIndex: 2,
  },
  sheetGrabber: {
    alignSelf: 'center',
    width: 36,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: 'rgba(60,60,67,0.28)',
    marginBottom: 4,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    minHeight: 36,
  },
  sheetTitleBlock: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    gap: 1,
  },
  navAction: {
    fontFamily,
    fontSize: 17,
    fontWeight: '400',
    color: BLUE,
    minWidth: 60,
  },
  navActionStrong: {
    fontWeight: '600',
    textAlign: 'right',
  },
  navActionDisabled: {
    opacity: 0.35,
  },
  navSpacer: {
    minWidth: 60,
  },
  modalTitle: {
    fontFamily,
    fontSize: 17,
    fontWeight: '600',
    color: TEXT,
    letterSpacing: -0.3,
    textAlign: 'center',
  },
  modalSub: {
    fontFamily,
    fontSize: 12,
    color: SECONDARY,
    textAlign: 'center',
  },
  modalHint: {
    fontFamily,
    fontSize: 13,
    lineHeight: 18,
    color: SECONDARY,
  },
  errorText: {
    fontFamily,
    fontSize: 13,
    color: T.red,
  },
  segment: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 32,
    backgroundColor: T.fillSoft,
    borderRadius: 9,
    padding: 2,
  },
  segmentButton: {
    flex: 1,
    height: 28,
    minWidth: 48,
    paddingHorizontal: 10,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
    ...webCursor,
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
    color: TEXT,
  },
  segmentTextActive: {
    fontWeight: '600',
  },
  addBlock: {
    gap: 10,
  },
  rangeRow: {
    flexDirection: 'row',
    gap: 10,
  },
  rangeField: {
    flex: 1,
    minWidth: 0,
    gap: 6,
  },
  rangeLabel: {
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
    color: SECONDARY,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  dateField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingHorizontal: 12,
    minHeight: 44,
  },
  dateFieldValue: {
    fontFamily,
    fontSize: 16,
    color: TEXT,
  },
  dateModalCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
  },
  dateModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  doneText: {
    fontFamily,
    fontSize: 16,
    fontWeight: '600',
    color: BLUE,
  },
  lastTransferButton: {
    height: 44,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#fff',
    ...webCursor,
  },
  lastTransferButtonText: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: BLUE,
  },
  docSearchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  docSearchField: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 40,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: '#fff',
  },
  docSearchInput: {
    flex: 1,
    minWidth: 0,
    fontFamily,
    fontSize: 16,
    color: TEXT,
    paddingVertical: 8,
    outlineStyle: 'none',
  },
  docResultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 60,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HAIRLINE,
    ...webCursor,
  },
  docResultRowLast: {
    borderBottomWidth: 0,
  },
  docResultText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  docResultTitle: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: TEXT,
    letterSpacing: -0.2,
  },
  docResultSub: {
    fontFamily,
    fontSize: 13,
    color: SECONDARY,
  },
  docResultAction: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: BLUE,
  },
  docResultActionMuted: {
    color: SECONDARY,
  },

  /* store picker */
  storePicker: {
    flex: 1,
    minHeight: 0,
    gap: 8,
  },
  storeSearch: {
    minHeight: 36,
  },
  storeSelectBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 4,
  },
  storeSelectCount: {
    flex: 1,
    fontFamily,
    fontSize: 13,
    color: SECONDARY,
  },
  storeSelectAll: {
    fontFamily,
    fontSize: 15,
    color: BLUE,
  },
  storeList: {
    flex: 1,
    minHeight: 0,
    ...Platform.select({
      web: { overflow: 'auto' },
      default: {},
    }),
  },
  storeListContent: {
    paddingBottom: 8,
  },
  storePickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 52,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HAIRLINE,
    gap: 12,
    ...webCursor,
  },
  storePickRowLast: {
    borderBottomWidth: 0,
  },
  storePickText: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  storePickTitle: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: TEXT,
    letterSpacing: -0.2,
  },
  storePickSub: {
    fontFamily,
    fontSize: 12,
    color: SECONDARY,
  },
  modalBusy: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 36,
  },
  modalEmpty: {
    fontFamily,
    fontSize: 14,
    color: SECONDARY,
    textAlign: 'center',
    paddingVertical: 28,
    paddingHorizontal: 16,
  },

  /* feed */
  feedModalRoot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  feedModalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.72)',
  },
  feedModalStage: {
    backgroundColor: '#000',
    overflow: 'hidden',
    borderRadius: 24,
    zIndex: 1,
    ...Platform.select({
      web: { boxShadow: '0 24px 80px rgba(0,0,0,0.45)' },
      default: {
        shadowColor: '#000',
        shadowOpacity: 0.4,
        shadowRadius: 24,
        shadowOffset: { width: 0, height: 12 },
        elevation: 16,
      },
    }),
  },
  feedModalStageFull: {
    borderRadius: 0,
    ...Platform.select({
      web: { boxShadow: 'none' },
      default: { elevation: 0, shadowOpacity: 0 },
    }),
  },
  feedClose: {
    position: 'absolute',
    right: 12,
    zIndex: 4,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
    ...webCursor,
  },
  feedList: {
    flexGrow: 0,
  },
  feedPage: {
    width: '100%',
    backgroundColor: '#000',
  },
  feedCard: {
    flex: 1,
    backgroundColor: '#000',
    overflow: 'hidden',
  },
  feedKindRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  feedKind: {
    fontFamily,
    fontSize: 13,
    fontWeight: '700',
    color: '#5AC8FA',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  feedKindBuy: {
    color: '#FFD60A',
  },
  feedStatus: {
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.7)',
  },
  feedBullion: {
    fontFamily,
    fontSize: 11,
    fontWeight: '700',
    color: '#AF52DE',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  feedHandle: {
    fontFamily,
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
    marginTop: 2,
  },
  feedMeta: {
    fontFamily,
    fontSize: 13,
    color: 'rgba(255,255,255,0.72)',
    marginTop: 2,
  },
  feedCount: {
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.7)',
    marginBottom: 8,
  },
  feedHeroScroll: {
    flex: 1,
    minHeight: 0,
  },
  feedHeroScrollContent: {
    paddingBottom: Math.max(28, mobileSafeBottom() + 16),
  },
  feedHeroFrame: {
    position: 'relative',
    backgroundColor: '#0b0b0c',
  },
  feedHeroPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 16,
    backgroundColor: '#0b0b0c',
  },
  feedHeroPlaceholderText: {
    fontFamily,
    fontSize: 13,
    color: 'rgba(255,255,255,0.42)',
  },
  feedHeroDots: {
    position: 'absolute',
    bottom: 12,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 5,
  },
  feedHeroDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.28)',
  },
  feedHeroDotOn: {
    backgroundColor: '#fff',
  },
  feedCaption: {
    paddingTop: 16,
    paddingHorizontal: 16,
    paddingRight: 88,
    gap: 2,
  },
  feedBuyer: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
    letterSpacing: -0.2,
    marginTop: 4,
  },
  feedLine: {
    fontFamily,
    fontSize: 13,
    color: 'rgba(255,255,255,0.86)',
    marginTop: 4,
  },
  feedEmpty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: 24,
  },
  feedEmptyText: {
    fontFamily,
    fontSize: 15,
    color: 'rgba(255,255,255,0.7)',
  },
  feedRail: {
    position: 'absolute',
    right: 10,
    bottom: Math.max(28, mobileSafeBottom() + 16),
    alignItems: 'center',
    gap: 16,
  },
  feedRailButton: {
    alignItems: 'center',
    gap: 4,
    ...webCursor,
  },
  feedRailIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  feedRailIconOn: {
    backgroundColor: GREEN,
  },
  feedRailLabel: {
    fontFamily,
    fontSize: 11,
    fontWeight: '600',
    color: '#fff',
  },
});
