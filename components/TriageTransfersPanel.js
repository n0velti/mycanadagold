import { createElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
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
import { MOBILE, mobileSafeBottom, mobileSafeTop, useIsMobile } from '../lib/mobileUi';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { fetchTransferStores } from '../lib/locations';
import {
  collectRecordImageUrls,
  defaultDateRange,
  fetchTransactionDetail,
  fetchTransactions,
  formatDateParam,
  formatPickerDate,
  formatTransactionDate,
  parseDateParam,
  parseDocReference,
  resolvePosAuthForRow,
  rowFromDocument,
} from '../lib/transactions';
import {
  RECEIVE_STATUS,
  RECEIVE_STATUS_LABELS,
  persistTransferWorkflowNow,
  saveTriagePoReview,
  plannedForTriageStore,
  plannedWorkshopTransfersForStore,
  transferGoesToWorkshop,
  updateTriageTransfers,
  useTransferWorkflow,
} from '../lib/transferWorkflow';
import { formatQty } from '../lib/transferPlan';
import { fetchTransfers } from '../lib/transfers';
import TriageReviewDrawer from './TriageReviewDrawer';

const fontFamily = Platform.select({
  ios: 'Sohne',
  android: 'Sohne',
  default: 'Sohne',
});

const ACCENT = '#C2410C';
const TEXT = '#1d1d1f';
const SECONDARY = '#8e8e93';
const FILL = '#e8e8ed';
const HAIRLINE = '#e5e5ea';
const GREEN = '#2F8A4E';
const BLUE = MOBILE.blue;
const RED = '#FF3B30';
const WORKSHOP_LOCATION = {
  storeKey: 'workshop',
  name: 'Workshop',
  systemKey: 'east',
  systemLabel: 'Canada Gold East',
  city: '',
};

function isWorkshopStore(store) {
  return Boolean(store?.isWorkshop) || String(store?.name || '').toLowerCase().includes('workshop');
}

function confirmDestructive(title, message, onConfirm) {
  if (Platform.OS === 'web') {
    const ok = typeof window !== 'undefined' && window.confirm([title, message].filter(Boolean).join('\n\n'));
    if (ok) onConfirm();
    return;
  }
  Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: onConfirm },
  ]);
}

const STORE_TABS = [
  { key: 'melt', label: 'Melt', icon: 'flame-outline' },
  { key: 'bullion', label: 'Bullion', icon: 'diamond-outline' },
];

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

const DRAWER_OPEN_MS = 280;
const DRAWER_CLOSE_MS = 220;

function useHeldValue(value) {
  const held = useRef(value);
  if (value != null) held.current = value;
  return value ?? held.current;
}

function useRightDrawerAnimation(visible, slideDistance) {
  const [mounted, setMounted] = useState(visible);
  const slide = useRef(new Animated.Value(slideDistance)).current;
  const backdrop = useRef(new Animated.Value(0)).current;
  const slideDistanceRef = useRef(slideDistance);
  const activeAnim = useRef(null);
  slideDistanceRef.current = slideDistance;

  useEffect(() => {
    if (!mounted) slide.setValue(slideDistance);
  }, [slideDistance, mounted, slide]);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      return undefined;
    }
    if (!mounted) return undefined;

    const anim = Animated.parallel([
      Animated.timing(slide, {
        toValue: slideDistanceRef.current,
        duration: DRAWER_CLOSE_MS,
        easing: Easing.bezier(0.4, 0, 0.2, 1),
        useNativeDriver: true,
      }),
      Animated.timing(backdrop, {
        toValue: 0,
        duration: DRAWER_CLOSE_MS,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    ]);
    activeAnim.current = anim;
    anim.start(({ finished }) => {
      if (activeAnim.current === anim) activeAnim.current = null;
      if (finished) setMounted(false);
    });
    return () => {
      if (activeAnim.current === anim) {
        anim.stop();
        activeAnim.current = null;
      }
    };
  }, [visible, mounted, slide, backdrop]);

  useEffect(() => {
    if (!visible || !mounted) return undefined;
    slide.setValue(slideDistanceRef.current);
    backdrop.setValue(0);
    let cancelled = false;
    const raf = requestAnimationFrame(() => {
      if (cancelled) return;
      Animated.parallel([
        Animated.timing(slide, {
          toValue: 0,
          duration: DRAWER_OPEN_MS,
          easing: Easing.bezier(0.22, 1, 0.36, 1),
          useNativeDriver: true,
        }),
        Animated.timing(backdrop, {
          toValue: 1,
          duration: DRAWER_OPEN_MS,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
      ]).start();
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [visible, mounted, slide, backdrop]);

  return { mounted, slide, backdrop };
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
  };
}

function newId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function fillMissingPoImages(token, baseUrl, rows) {
  const missing = rows.filter((row) => !(row.imageUrls || []).length);
  if (missing.length === 0) return rows;
  const updates = new Map();
  let cursor = 0;
  const workers = Math.min(4, missing.length);

  async function worker() {
    while (cursor < missing.length) {
      const index = cursor;
      cursor += 1;
      const row = missing[index];
      try {
        const detail = await fetchTransactionDetail(token, {
          type: 'purchase',
          sourceId: row.sourceId,
          baseUrl,
        });
        const imageUrls = collectRecordImageUrls(detail);
        if (imageUrls.length) updates.set(row.id, imageUrls);
      } catch {
        // Keep the row without a photo if detail lookup fails.
      }
    }
  }

  await Promise.all(Array.from({ length: workers }, () => worker()));
  if (updates.size === 0) return rows;
  return rows.map((row) => (updates.has(row.id) ? { ...row, imageUrls: updates.get(row.id) } : row));
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

function flattenMeltPos(stores) {
  const rows = [];
  for (const store of stores || []) {
    for (const item of store.meltPos || []) rows.push(item);
  }
  return rows.sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0));
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

function matchesDocQuery(row, query) {
  const q = String(query || '').trim();
  if (!q) return true;
  if (!row) return false;
  const parsed = parseDocReference(q);
  const digits = q.replace(/[^\d]/g, '');
  if (parsed && String(row.sourceId) === parsed.sourceId) {
    if (parsed.type === 'purchase') return row.type === 'purchase';
    if (parsed.type === 'order') return row.type === 'order';
    return true;
  }
  if (digits && String(row.sourceId || '').includes(digits)) return true;
  const hay = [row.reference, row.sourceId, row.customerName, row.employeeName, row.storeName, row.dateLabel]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return hay.includes(q.toLowerCase());
}

function uniqueLabels(values) {
  const seen = new Set();
  const out = [];
  for (const raw of values) {
    const label = String(raw || '').trim();
    if (!label || label === '—') continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(label);
  }
  return out.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

function rowTime(row) {
  const raw = row?.date;
  if (!raw) return 0;
  const time = Date.parse(String(raw).replace(' ', 'T'));
  return Number.isFinite(time) ? time : 0;
}

function listedDateRange(rows) {
  const times = (rows || []).map(rowTime).filter(Boolean).sort((a, b) => a - b);
  if (!times.length) return '';
  const start = formatTransactionDate(new Date(times[0]).toISOString());
  const end = formatTransactionDate(new Date(times[times.length - 1]).toISOString());
  return start === end ? start : `${start} – ${end}`;
}

function rowPersonLabels(row) {
  return uniqueLabels([row?.customerName, row?.employeeName]);
}

function matchesLabelFilter(value, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  return String(value || '').toLowerCase().includes(q);
}

function matchesPersonFilter(row, query) {
  const q = String(query || '').trim();
  if (!q) return true;
  return rowPersonLabels(row).some((label) => matchesLabelFilter(label, q));
}

function ColumnFilter({
  columnKey,
  label,
  value,
  onChange,
  options,
  openKey,
  onOpenKey,
  style,
}) {
  const open = openKey === columnKey;
  const [query, setQuery] = useState('');
  const active = Boolean(String(value || '').trim());

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = options || [];
    if (!q) return list.slice(0, 40);
    return list.filter((option) => option.toLowerCase().includes(q)).slice(0, 40);
  }, [options, query]);

  const commit = (next) => {
    onChange(String(next || '').trim());
    onOpenKey(null);
  };

  return (
    <View style={[styles.colFilter, style]}>
      <Pressable
        style={styles.colFilterHit}
        onPress={() => onOpenKey(open ? null : columnKey)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={active ? `${label} filter ${value}` : `Filter ${label}`}
      >
        <Text style={[styles.colFilterLabel, active && styles.colFilterLabelOn]} numberOfLines={1}>
          {active ? value : label}
        </Text>
        <Ionicons
          name={active ? 'funnel' : open ? 'chevron-up' : 'chevron-down'}
          size={11}
          color={active ? TEXT : SECONDARY}
        />
      </Pressable>
      {open ? (
        <View style={styles.colFilterMenu}>
          <View style={styles.colFilterSearch}>
            <Ionicons name="search" size={14} color={SECONDARY} />
            <TextInput
              style={styles.colFilterInput}
              value={query}
              onChangeText={setQuery}
              placeholder={`Filter ${label.toLowerCase()}`}
              placeholderTextColor={SECONDARY}
              autoCapitalize="none"
              autoCorrect={false}
              onSubmitEditing={() => commit(query)}
            />
          </View>
          {active ? (
            <Pressable
              style={styles.colFilterOption}
              onPress={() => commit('')}
              accessibilityRole="button"
              accessibilityLabel={`Clear ${label} filter`}
            >
              <Text style={styles.colFilterClear}>Clear filter</Text>
            </Pressable>
          ) : null}
          <ScrollView
            style={styles.colFilterList}
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled
          >
            {results.length === 0 ? (
              <Text style={styles.colFilterEmpty}>
                {query.trim() ? 'No matching values' : 'No values'}
              </Text>
            ) : (
              results.map((option) => {
                const selected = option === value;
                return (
                  <Pressable
                    key={option}
                    style={styles.colFilterOption}
                    onPress={() => commit(option)}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                  >
                    <Text
                      style={[styles.colFilterOptionText, selected && styles.colFilterOptionOn]}
                      numberOfLines={1}
                    >
                      {option}
                    </Text>
                    {selected ? <Ionicons name="checkmark" size={16} color={BLUE} /> : null}
                  </Pressable>
                );
              })
            )}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

function TableFrame({ minWidth, header, children }) {
  const { width } = useWindowDimensions();
  const inner = (
    <View style={[styles.tableCard, { minWidth }]}>
      <View style={styles.tableHeader}>{header}</View>
      <ScrollView
        style={styles.tableBody}
        contentContainerStyle={styles.tableBodyContent}
        nestedScrollEnabled
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </ScrollView>
    </View>
  );

  if (width < minWidth + 48) {
    return (
      <ScrollView
        horizontal
        style={styles.tableHScroll}
        contentContainerStyle={styles.tableHContent}
        showsHorizontalScrollIndicator={false}
      >
        {inner}
      </ScrollView>
    );
  }

  return <View style={[styles.tableHContent, styles.tableHFill]}>{inner}</View>;
}

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

function EmptyState({ icon, title, body }) {
  return (
    <View style={styles.empty}>
      <Ionicons name={icon} size={40} color={SECONDARY} />
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
    </View>
  );
}

function ListRow({ title, meta, subtitle, subtitleLines = 1, onPress, onDelete, accessibilityLabel, mobile, last }) {
  return (
    <View style={[styles.listRow, mobile && styles.listRowMobile, last && styles.listRowLast]}>
      <Pressable
        style={styles.listRowMain}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel || title}
        {...(Platform.OS === 'web' ? { className: 'cgold-triage-row' } : null)}
      >
        <View style={styles.listRowText}>
          <Text style={styles.listRowTitle} numberOfLines={1}>
            {title}
          </Text>
          {meta ? (
            <Text style={styles.listRowMeta} numberOfLines={1}>
              {meta}
            </Text>
          ) : null}
          {subtitle ? (
            <Text style={styles.listRowSub} numberOfLines={subtitleLines}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        <Ionicons name="chevron-forward" size={18} color="#c7c7cc" />
      </Pressable>
      {onDelete ? (
        <Pressable
          style={styles.rowDelete}
          onPress={onDelete}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`Delete ${title}`}
        >
          <Text style={styles.rowDeleteText}>Delete</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function PoThumb({ urls, label }) {
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const photos = Array.isArray(urls) ? urls.filter(Boolean) : [];

  useEffect(() => {
    setFailed(false);
  }, [photos[0]]);

  if (!photos.length || failed) {
    return (
      <View style={styles.poThumbSlot}>
        <Ionicons name="image-outline" size={16} color={SECONDARY} />
      </View>
    );
  }

  return (
    <>
      <Pressable
        onPress={(event) => {
          event?.stopPropagation?.();
          setOpen(true);
        }}
        style={styles.poThumbPress}
        accessibilityRole="button"
        accessibilityLabel={`View photo for ${label}`}
      >
        <Image
          source={{ uri: photos[0] }}
          style={styles.poThumb}
          resizeMode="cover"
          onError={() => setFailed(true)}
        />
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={styles.photoViewerRoot}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setOpen(false)} />
          <View style={styles.photoViewerSheet} pointerEvents="box-none">
            <View style={styles.photoViewerBar}>
              <Text style={styles.photoViewerTitle} numberOfLines={1}>
                {label}
              </Text>
              <Pressable onPress={() => setOpen(false)} hitSlop={8} accessibilityLabel="Close photo">
                <Ionicons name="close" size={20} color={TEXT} />
              </Pressable>
            </View>
            <Image source={{ uri: photos[0] }} style={styles.photoViewerImage} resizeMode="contain" />
          </View>
        </View>
      </Modal>
    </>
  );
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

const ADD_MODES = [
  { key: 'range', label: 'Date range' },
  { key: 'doc', label: 'PO / SO' },
];

function DateRangeModal({
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
        const dates = (
          await Promise.all((stores || []).map((store) => lastPosTransferDate(session, store)))
        )
          .filter(Boolean)
          .sort();
        startKey = dates[0] || null;
      }
      if (!startKey) {
        setLastHint('');
        setLocalError(
          `No previous transfer found for ${storeNamesLabel(stores) || 'these stores'}.`,
        );
        return;
      }
      const today = formatDateParam(new Date());
      setStart(parseDateParam(startKey));
      setEnd(parseDateParam(today));
      setLastHint(`Last transfer: ${formatPickerDate(startKey)}`);
      confirm(startKey, today);
    } catch (err) {
      setLocalError(
        err?.message ||
          `Could not find the last transfer for ${storeNamesLabel(stores) || 'these stores'}.`,
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
        <View style={[styles.smallCard, isMobile && styles.sheetCardBottom]}>
          {isMobile ? <View style={styles.sheetGrabber} /> : null}
          <Text style={styles.modalTitle}>Add</Text>
          <View style={styles.addModeRow} accessibilityRole="tablist">
            {ADD_MODES.map((option) => {
              const active = mode === option.key;
              return (
                <Pressable
                  key={option.key}
                  style={[styles.kindChip, active && styles.kindChipActive]}
                  onPress={() => {
                    if (!waiting) setMode(option.key);
                  }}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={option.label}
                >
                  <Text style={[styles.kindChipText, active && styles.kindChipTextActive]}>{option.label}</Text>
                </Pressable>
              );
            })}
          </View>
          {mode === 'doc' ? (
            <SpecificDocSearch
              stores={stores}
              session={session}
              existingIds={existingIds}
              onAdd={onAddDoc}
              onClose={onClose}
            />
          ) : (
            <>
              <Text style={styles.modalSub}>
                Choose the date range to load POs from {storeNamesLabel(stores) || 'the selected stores'}.
              </Text>
              <View style={styles.rangeRow}>
                <View style={styles.rangeField}>
                  <Text style={styles.rangeLabel}>Start</Text>
                  <DateField value={start} onChange={setStart} maximumDate={end} />
                </View>
                <View style={styles.rangeField}>
                  <Text style={styles.rangeLabel}>End</Text>
                  <DateField value={end} onChange={setEnd} minimumDate={start} />
                </View>
              </View>
              {lastHint ? <Text style={styles.lastTransferHint}>{lastHint}</Text> : null}
              {localError || error ? <Text style={styles.errorText}>{localError || error}</Text> : null}
              <Pressable
                style={styles.lastTransferButton}
                onPress={fromLastTransfer}
                disabled={waiting}
                accessibilityRole="button"
                accessibilityLabel="From last transfer"
              >
                {lastBusy ? (
                  <ActivityIndicator color={BLUE} />
                ) : (
                  <Text style={styles.lastTransferButtonText}>From last transfer</Text>
                )}
              </Pressable>
              <View style={styles.modalActions}>
                <Pressable style={styles.secondaryButton} onPress={onClose} disabled={waiting}>
                  <Text style={styles.secondaryButtonText}>Cancel</Text>
                </Pressable>
                <Pressable
                  style={[styles.primaryButton, styles.primaryButtonInline, waiting && styles.primaryButtonDisabled]}
                  onPress={() => confirm()}
                  disabled={waiting}
                >
                  {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>Add</Text>}
                </Pressable>
              </View>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

function poKindLabel(row) {
  return row?.type === 'order' ? 'SO' : 'PO';
}

function meltStatusLabel(row) {
  if (row?.received) return 'Received';
  if (row?.review) return 'Reviewed';
  return 'Open';
}

function bullionStatusLabel(row) {
  return RECEIVE_STATUS_LABELS[row?.receiveStatus] || 'Not Received';
}

function bullionToLabel(row) {
  return row?.toName || (row?.pathLabels || []).filter(Boolean).slice(-1)[0] || '';
}

function TableCell({ children, flex = 1, minWidth = 88, width, last }) {
  return (
    <View
      style={[
        styles.tableCell,
        width
          ? { width, flexGrow: 0, flexShrink: 0 }
          : { flex, minWidth },
        last && styles.tableCellLast,
      ]}
    >
      {typeof children === 'string' || children == null ? (
        <Text style={styles.tableCellText} numberOfLines={1}>
          {children || '—'}
        </Text>
      ) : (
        children
      )}
    </View>
  );
}

function MeltTableRow({ row, onOpen, onToggleReceived, onRemove, last }) {
  const received = Boolean(row.received);
  return (
    <View style={[styles.tableRow, last && styles.tableRowLast]}>
      <Pressable
        style={styles.tableRowMain}
        onPress={() => onOpen(row)}
        accessibilityRole="button"
        accessibilityLabel={`Open ${row.reference}`}
        {...(Platform.OS === 'web' ? { className: 'cgold-triage-row' } : null)}
      >
        <View style={styles.tablePhotoCell}>
          <PoThumb urls={row.imageUrls} label={row.reference} />
        </View>
        <TableCell flex={1.15} minWidth={108}>
          <Text style={styles.tableCellStrong} numberOfLines={1}>
            {row.reference}
          </Text>
        </TableCell>
        <TableCell flex={0.9} minWidth={92}>
          {row.dateLabel}
        </TableCell>
        <TableCell flex={1.15} minWidth={110}>
          {row.customerName}
        </TableCell>
        <TableCell flex={1.1} minWidth={110}>
          {row.storeName}
        </TableCell>
        <TableCell flex={0.85} minWidth={88}>
          <Text
            style={[
              styles.tableCellText,
              received && styles.tableStatusOn,
              row.review && !received && styles.tableStatusReview,
            ]}
            numberOfLines={1}
          >
            {meltStatusLabel(row)}
          </Text>
        </TableCell>
      </Pressable>
      <View style={styles.tableActions}>
        <Pressable
          style={[styles.tableAction, received && styles.tableActionOn]}
          onPress={() => onToggleReceived(row.id)}
          accessibilityRole="button"
          accessibilityLabel={received ? `${row.reference} received` : `Receive ${row.reference}`}
        >
          <Text style={[styles.tableActionText, received && styles.tableActionTextOn]}>
            {received ? 'Received' : 'Receive'}
          </Text>
        </Pressable>
        <Pressable
          style={styles.tableRemove}
          onPress={() => onRemove(row.id)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`Remove ${row.reference}`}
        >
          <Ionicons name="close" size={16} color={SECONDARY} />
        </Pressable>
      </View>
    </View>
  );
}

function BullionTableRow({ row, onOpen, last }) {
  return (
    <Pressable
      style={[styles.tableRow, last && styles.tableRowLast]}
      onPress={() => onOpen(row)}
      accessibilityRole="button"
      accessibilityLabel={`Open ${row.reference}`}
      {...(Platform.OS === 'web' ? { className: 'cgold-triage-row' } : null)}
    >
      <TableCell flex={1.2} minWidth={120}>
        <Text style={styles.tableCellStrong} numberOfLines={1}>
          {row.reference}
        </Text>
      </TableCell>
      <TableCell flex={0.9} minWidth={92}>
        {row.dateLabel}
      </TableCell>
      <TableCell flex={1.15} minWidth={110}>
        {row.fromName}
      </TableCell>
      <TableCell flex={1.15} minWidth={110}>
        {bullionToLabel(row)}
      </TableCell>
      <TableCell flex={1} minWidth={110} last>
        {bullionStatusLabel(row)}
      </TableCell>
    </Pressable>
  );
}

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
      accessibilityLabel={
        photos.length > 1 ? `${label} photo ${index + 1} of ${photos.length}` : `${label} photo`
      }
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
            <View
              key={`${url}-${dot}`}
              style={[styles.feedHeroDot, dot === index && styles.feedHeroDotOn]}
            />
          ))}
        </View>
      ) : null}
    </Pressable>
  );
}

function MeltPoFeedCard({ row, index, total, width, onOpen, onToggleReceived }) {
  const received = Boolean(row.received);
  const reviewed = Boolean(row.review);
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
          <Text style={[styles.feedKind, isBuy && styles.feedKindBuy]}>{poKindLabel(row)}</Text>
          <Text style={styles.feedHandle} numberOfLines={1}>
            @{String(row.customerName || 'walk-in').replace(/\s+/g, '').toLowerCase() || 'walkin'}
          </Text>
          <Text style={styles.feedBuyer} numberOfLines={2}>
            {[row.reference, row.amountLabel].filter(Boolean).join(' · ')}
          </Text>
          <Text style={styles.feedMeta} numberOfLines={2}>
            {[row.storeName, row.dateLabel, row.timeLabel, row.employeeName, reviewed ? 'Reviewed' : '']
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
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
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

function MeltFeedButton({ onPress }) {
  return (
    <Pressable
      style={styles.feedOpenButton}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Open feed view"
    >
      <Ionicons name="phone-portrait-outline" size={18} color={BLUE} />
    </Pressable>
  );
}

function SpecificDocSearch({ stores, session, existingIds, onClose, onAdd }) {
  const [kind, setKind] = useState('PO');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [results, setResults] = useState([]);
  const searchGen = useRef(0);
  const storeKey = (stores || []).map((store) => store.id || store.name).join('|');
  const batchLabel = storeNamesLabel(stores) || 'the selected stores';

  useEffect(() => {
    setKind('PO');
    setValue('');
    setBusy(false);
    setError('');
    setResults([]);
  }, [storeKey]);

  const runSearch = useCallback(
    async (raw, selectedKind) => {
      const query = String(raw || '').trim();
      if (!query) {
        setResults([]);
        setError('');
        return;
      }

      const groups = uniqueSystemGroups(stores);
      if (groups.some((group) => !resolvePosAuthForRow(session, { systemKey: group.systemKey }).token)) {
        if (groups.every((group) => !resolvePosAuthForRow(session, { systemKey: group.systemKey }).token)) {
          setError('Sign in to search documents.');
          setResults([]);
          return;
        }
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

        for (const doc of candidates.filter(Boolean)) {
          for (const group of groups) {
            const auth = resolvePosAuthForRow(session, { systemKey: group.systemKey });
            if (!auth.token) continue;
            try {
              const system = {
                key: group.systemKey,
                label: group.systemLabel,
                baseUrl: auth.baseUrl,
              };
              const detail = await fetchTransactionDetail(auth.token, {
                type: doc.type,
                sourceId: doc.sourceId,
                baseUrl: auth.baseUrl,
              });
              const row = rowFromDocument(detail, doc.type, system);
              if (!row?.id || seen.has(row.id)) continue;
              if (!storeInList(stores, row.storeName)) {
                otherStore = row.storeName || 'another store';
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
              ? `That document is for ${otherStore}, not ${batchLabel}.`
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
    [batchLabel, session, stores],
  );

  useEffect(() => {
    const query = value.trim();
    if (!query) {
      setResults([]);
      setError('');
      return undefined;
    }
    const timer = setTimeout(() => {
      runSearch(query, kind);
    }, 350);
    return () => clearTimeout(timer);
  }, [kind, runSearch, value]);

  const pick = (row) => {
    if ((existingIds || []).includes(row.id)) {
      setError(`${row.reference} is already on this list.`);
      return;
    }
    onAdd(row);
  };

  return (
    <View style={styles.docSearchBlock}>
          <Text style={styles.modalSub}>
            Search a document number from {batchLabel}.
          </Text>
          <View style={styles.kindRow}>
            {['PO', 'SO'].map((option) => {
              const active = kind === option;
              return (
                <Pressable
                  key={option}
                  style={[styles.kindChip, active && styles.kindChipActive]}
                  onPress={() => setKind(option)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                >
                  <Text style={[styles.kindChipText, active && styles.kindChipTextActive]}>{option}</Text>
                </Pressable>
              );
            })}
          </View>
          <View style={styles.searchField}>
            <Ionicons name="search" size={16} color={SECONDARY} style={styles.searchIcon} />
            <TextInput
              style={styles.searchInput}
              value={value}
              onChangeText={setValue}
              placeholder={`${kind}# 12345`}
              placeholderTextColor={SECONDARY}
              autoCapitalize="characters"
              autoCorrect={false}
              keyboardType="default"
              onSubmitEditing={() => runSearch(value, kind)}
            />
            {value ? (
              <Pressable
                onPress={() => {
                  setValue('');
                  setResults([]);
                  setError('');
                }}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Clear search"
              >
                <Ionicons name="close-circle" size={18} color="#c7c7cc" />
              </Pressable>
            ) : null}
          </View>
          {busy ? (
            <View style={styles.modalBusy}>
              <ActivityIndicator color={BLUE} />
            </View>
          ) : null}
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
          {results.length > 0 ? (
            <ScrollView
              style={styles.docResultList}
              contentContainerStyle={styles.docResultListContent}
              keyboardShouldPersistTaps="handled"
              nestedScrollEnabled
            >
              {results.map((row) => {
                const already = (existingIds || []).includes(row.id);
                return (
                  <Pressable
                    key={row.id}
                    style={styles.docResultRow}
                    onPress={() => pick(row)}
                    accessibilityRole="button"
                    accessibilityLabel={`Add ${row.reference}`}
                  >
                    <View style={styles.poRowText}>
                      <Text style={styles.poRef} numberOfLines={1}>
                        {row.reference}
                      </Text>
                      <Text style={styles.poSub} numberOfLines={1}>
                        {[row.dateLabel, row.customerName].filter(Boolean).join(' · ')}
                      </Text>
                    </View>
                    <Text style={[styles.docResultAction, already && styles.docResultActionMuted]}>
                      {already ? 'Added' : 'Add'}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          ) : null}
          <View style={styles.modalActions}>
            <Pressable style={styles.secondaryButton} onPress={onClose} disabled={busy}>
              <Text style={styles.secondaryButtonText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[styles.primaryButton, styles.primaryButtonInline, busy && styles.primaryButtonDisabled]}
              onPress={() => runSearch(value, kind)}
              disabled={busy}
            >
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>Search</Text>}
            </Pressable>
          </View>
    </View>
  );
}

function MeltTab({
  session,
  stores,
  dateKey,
  pos,
  addOpen,
  onAddOpenChange,
  onMergePos,
  onRemovePos,
  onToggleReceived,
  onReceiveAll,
  onSaveReview,
}) {
  const { triage } = useTransferWorkflow();
  const storeList = stores || [];
  const batchLabel = storeNamesLabel(storeList) || 'the selected stores';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [openRow, setOpenRow] = useState(null);
  const [feedOpen, setFeedOpen] = useState(false);
  const [openFilter, setOpenFilter] = useState(null);
  const [filters, setFilters] = useState({
    reference: '',
    dateLabel: '',
    person: '',
    store: '',
    status: '',
  });
  const existingIds = useMemo(() => (pos || []).map((row) => row.id), [pos]);
  const setFilter = useCallback((key, value) => {
    setFilters((current) => ({ ...current, [key]: value }));
  }, []);
  const storeOptions = useMemo(
    () => uniqueLabels((pos || []).map((row) => row.storeName)),
    [pos],
  );
  const personOptions = useMemo(
    () => uniqueLabels((pos || []).flatMap((row) => rowPersonLabels(row))),
    [pos],
  );
  const referenceOptions = useMemo(
    () => uniqueLabels((pos || []).map((row) => row.reference)),
    [pos],
  );
  const dateOptions = useMemo(
    () => uniqueLabels((pos || []).map((row) => row.dateLabel)),
    [pos],
  );
  const statusOptions = useMemo(
    () => uniqueLabels((pos || []).map((row) => meltStatusLabel(row))),
    [pos],
  );
  const visiblePos = useMemo(
    () =>
      (pos || []).filter(
        (row) =>
          matchesDocQuery(row, filters.reference) &&
          matchesLabelFilter(row.dateLabel, filters.dateLabel) &&
          matchesPersonFilter(row, filters.person) &&
          matchesLabelFilter(row.storeName, filters.store) &&
          matchesLabelFilter(meltStatusLabel(row), filters.status),
      ),
    [filters, pos],
  );
  const allReceived = (pos || []).length > 0 && (pos || []).every((row) => row.received);
  const filtersActive = Object.values(filters).some((value) => String(value || '').trim());

  const loadRange = useCallback(
    async ({ startDate, endDate }) => {
      if (!startDate || !endDate) return;
      const groups = uniqueSystemGroups(storeList);
      if (groups.length === 0) {
        setError('Select at least one store.');
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
              system: {
                key: group.systemKey,
                label: group.systemLabel,
                baseUrl: auth.baseUrl,
              },
            });
            collected.push(
              ...result.rows.filter(
                (row) => row.type === 'purchase' && storeInList(group.stores, row.storeName),
              ),
            );
          } catch (err) {
            errors.push(err?.message || `Failed to load ${group.systemLabel}.`);
          }
        }
        if (collected.length === 0) {
          setError(errors[0] || `No purchases in that range for ${batchLabel}.`);
          return;
        }
        onMergePos(collected);
        onAddOpenChange(false);
        const bySystem = new Map();
        for (const row of collected) {
          const key = row.systemKey || 'east';
          if (!bySystem.has(key)) bySystem.set(key, []);
          bySystem.get(key).push(row);
        }
        Promise.all(
          [...bySystem.entries()].map(async ([key, groupRows]) => {
            const auth = resolvePosAuthForRow(session, { systemKey: key });
            if (!auth.token) return groupRows;
            return fillMissingPoImages(auth.token, auth.baseUrl, groupRows);
          }),
        )
          .then((groupsEnriched) => {
            const map = new Map();
            for (const groupRows of groupsEnriched) {
              for (const row of groupRows) map.set(row.id, row);
            }
            const enriched = collected.map((row) => map.get(row.id) || row);
            if (enriched.some((row, index) => row !== collected[index])) onMergePos(enriched);
          })
          .catch(() => {});
      } catch (err) {
        setError(err?.message || 'Failed to load purchases.');
      } finally {
        setBusy(false);
      }
    },
    [batchLabel, onAddOpenChange, onMergePos, session, storeList],
  );

  return (
    <View style={styles.body}>
      {pos?.length > 0 ? (
        <View style={styles.tableToolbar}>
          <Text style={styles.tableMeta}>
            {filtersActive ? `${visiblePos.length} of ${pos.length}` : pos.length}
            {' '}
            {pos.length === 1 ? 'document' : 'documents'}
          </Text>
          <MeltFeedButton onPress={() => setFeedOpen(true)} />
        </View>
      ) : null}

      {!(pos || []).length ? (
        <EmptyState
          icon="flame-outline"
          title="Melt"
          body={`Tap Add to load a date range or search a single PO/SO from ${batchLabel}.`}
        />
      ) : (
        <TableFrame
          minWidth={780}
          header={
            <>
              <View style={styles.tablePhotoCell} />
              <ColumnFilter
                columnKey="reference"
                label="PO / SO"
                value={filters.reference}
                onChange={(value) => setFilter('reference', value)}
                options={referenceOptions}
                openKey={openFilter}
                onOpenKey={setOpenFilter}
                style={{ flex: 1.15, minWidth: 108 }}
              />
              <ColumnFilter
                columnKey="dateLabel"
                label="Date"
                value={filters.dateLabel}
                onChange={(value) => setFilter('dateLabel', value)}
                options={dateOptions}
                openKey={openFilter}
                onOpenKey={setOpenFilter}
                style={{ flex: 0.9, minWidth: 92 }}
              />
              <ColumnFilter
                columnKey="person"
                label="Person"
                value={filters.person}
                onChange={(value) => setFilter('person', value)}
                options={personOptions}
                openKey={openFilter}
                onOpenKey={setOpenFilter}
                style={{ flex: 1.15, minWidth: 110 }}
              />
              <ColumnFilter
                columnKey="store"
                label="Store"
                value={filters.store}
                onChange={(value) => setFilter('store', value)}
                options={storeOptions}
                openKey={openFilter}
                onOpenKey={setOpenFilter}
                style={{ flex: 1.1, minWidth: 110 }}
              />
              <ColumnFilter
                columnKey="status"
                label="Status"
                value={filters.status}
                onChange={(value) => setFilter('status', value)}
                options={statusOptions}
                openKey={openFilter}
                onOpenKey={setOpenFilter}
                style={{ flex: 0.85, minWidth: 88 }}
              />
              <View style={styles.tableActionsHead}>
                <Pressable
                  style={[styles.tableAction, allReceived && styles.tableActionOn]}
                  onPress={onReceiveAll}
                  accessibilityRole="button"
                  accessibilityLabel={allReceived ? 'All received' : 'Receive all'}
                >
                  <Text style={[styles.tableActionText, allReceived && styles.tableActionTextOn]}>
                    {allReceived ? 'Received' : 'Receive all'}
                  </Text>
                </Pressable>
                <View style={styles.tableRemove} />
              </View>
            </>
          }
        >
          {visiblePos.length === 0 ? (
            <Text style={styles.tableEmpty}>No PO or SO matches that column filter.</Text>
          ) : (
            visiblePos.map((row, index) => (
              <MeltTableRow
                key={row.id}
                row={row}
                last={index === visiblePos.length - 1}
                onOpen={(item) => {
                  setOpenFilter(null);
                  setOpenRow(item);
                }}
                onToggleReceived={onToggleReceived}
                onRemove={(id) => {
                  if (openRow?.id === id) setOpenRow(null);
                  onRemovePos(id);
                }}
              />
            ))
          )}
        </TableFrame>
      )}

      <DateRangeModal
        visible={addOpen}
        busy={busy}
        error={error}
        session={session}
        stores={storeList}
        existingIds={existingIds}
        transfers={triage}
        currentDateKey={dateKey}
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

      <MeltPoFeedModal
        visible={feedOpen}
        rows={visiblePos}
        onClose={() => setFeedOpen(false)}
        onOpen={setOpenRow}
        onToggleReceived={onToggleReceived}
      />

      <TriageReviewDrawer
        visible={Boolean(openRow)}
        session={session}
        row={openRow}
        review={openRow?.review || null}
        extraRows={pos}
        onClose={() => setOpenRow(null)}
        onSave={onSaveReview}
      />
    </View>
  );
}

function BullionTransferDrawer({ visible, transfer, onClose }) {
  const { width: windowWidth } = useWindowDimensions();
  const isMobile = windowWidth < 768;
  const panelWidth = isMobile
    ? Math.max(windowWidth, 240)
    : Math.min(Math.max(Math.round(windowWidth * 0.52), 420), Math.round(windowWidth - 64));
  const { mounted, slide, backdrop } = useRightDrawerAnimation(visible, panelWidth);
  const held = useHeldValue(transfer);
  const live = transfer || held;

  if (!mounted || !live) return null;

  const items = Array.isArray(live.items) ? live.items : [];
  const path =
    (live.pathLabels || []).filter(Boolean).join(' → ') ||
    `${live.fromName || '—'} → ${live.toName || '—'}`;
  const statusLabel = RECEIVE_STATUS_LABELS[live.receiveStatus] || 'Not Received';

  return (
    <Modal visible={mounted} transparent animationType="none" onRequestClose={onClose}>
      <View style={styles.drawerRoot}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose}>
          <Animated.View style={[styles.drawerBackdrop, { opacity: backdrop }]} />
        </Pressable>
        <Animated.View
          style={[
            styles.drawerPanel,
            isMobile && styles.drawerPanelMobile,
            { width: panelWidth, transform: [{ translateX: slide }] },
          ]}
        >
          <View
            style={[styles.drawerTopBar, isMobile && styles.drawerTopBarMobile]}
            {...(Platform.OS === 'web' && isMobile ? { className: 'cgold-mobile-sheet-top' } : null)}
          >
            <Pressable onPress={onClose} hitSlop={8} style={styles.drawerDone} accessibilityLabel="Done">
              <Text style={styles.drawerDoneText}>Done</Text>
            </Pressable>
            <Text style={styles.drawerTitle} numberOfLines={1}>
              Transfer
            </Text>
            <View style={styles.drawerDone} />
          </View>

          <ScrollView
            style={styles.drawerBody}
            contentContainerStyle={styles.drawerBodyContent}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.drawerHero}>
              <Text style={styles.drawerHeroRoute}>{path}</Text>
              <Text style={styles.drawerHeroMeta}>
                {[live.reference, live.dateLabel].filter(Boolean).join(' · ')}
              </Text>
              <View style={styles.drawerStatusPill}>
                <Text style={styles.drawerStatusText}>{statusLabel}</Text>
              </View>
            </View>

            <Text style={styles.drawerSectionLabel}>Details</Text>
            <View style={styles.drawerGroup}>
              <DrawerRow label="Transfer" value={live.reference} />
              <DrawerRow label="Date" value={live.dateLabel || '—'} />
              <DrawerRow label="From" value={live.fromName || '—'} />
              <DrawerRow label="To" value={live.toName || '—'} />
              <DrawerRow label="Note" value={live.note || '—'} last />
            </View>

            <Text style={styles.drawerSectionLabel}>
              Items{items.length ? ` · ${items.length}` : ''}
            </Text>
            <View style={styles.drawerGroup}>
              {items.length === 0 ? (
                <Text style={styles.drawerEmpty}>No line items on this transfer.</Text>
              ) : (
                items.map((item, index) => (
                  <View
                    key={item.id}
                    style={[styles.drawerItem, index === items.length - 1 && styles.drawerItemLast]}
                  >
                    <View style={styles.listRowText}>
                      <Text style={styles.drawerItemName} numberOfLines={2}>
                        {item.productName}
                      </Text>
                      <Text style={styles.listRowSub} numberOfLines={1}>
                        {[item.fromName, item.toName].filter(Boolean).join(' → ') || path}
                      </Text>
                    </View>
                    <Text style={styles.drawerItemQty}>{formatQty(item.sentQty)}</Text>
                  </View>
                ))
              )}
            </View>
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

function DrawerRow({ label, value, last }) {
  return (
    <View style={[styles.drawerRow, last && styles.drawerRowLast]}>
      <Text style={styles.drawerRowLabel}>{label}</Text>
      <Text style={styles.drawerRowValue}>{value}</Text>
    </View>
  );
}

function BullionTab({ dateKey, stores, session }) {
  const { planned } = useTransferWorkflow();
  const storeList = stores || [];
  const storeKey = storeList.map((store) => store.id || store.storeKey || store.name).join('|');
  const [openId, setOpenId] = useState(null);
  const [posRows, setPosRows] = useState([]);
  const [posBusy, setPosBusy] = useState(false);
  const [openFilter, setOpenFilter] = useState(null);
  const [filters, setFilters] = useState({
    reference: '',
    dateLabel: '',
    fromName: '',
    toName: '',
    status: '',
  });

  useEffect(() => {
    if (!session?.token || storeList.length === 0) {
      setPosRows([]);
      return undefined;
    }
    let cancelled = false;
    setPosBusy(true);
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
          .filter(
            (row) =>
              transferGoesToWorkshop(row) && storeInList(group.stores, row.from?.name),
          )
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
        if (!cancelled) setPosBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [session, storeKey]);

  const rows = useMemo(() => {
    const local = storeList.flatMap((store) =>
      plannedWorkshopTransfersForStore(store?.storeKey, store?.name),
    );
    const seen = new Set(
      local
        .map((row) => row.aureusId)
        .filter(Boolean)
        .map(String),
    );
    const extras = posRows.filter((row) => !row.aureusId || !seen.has(String(row.aureusId)));
    return [...local, ...extras].sort((a, b) =>
      String(b.dateKey || '').localeCompare(String(a.dateKey || '')),
    );
  }, [planned, posRows, storeKey]);

  const setFilter = useCallback((key, value) => {
    setFilters((current) => ({ ...current, [key]: value }));
  }, []);
  const referenceOptions = useMemo(
    () => uniqueLabels(rows.map((row) => row.reference)),
    [rows],
  );
  const dateOptions = useMemo(
    () => uniqueLabels(rows.map((row) => row.dateLabel)),
    [rows],
  );
  const fromOptions = useMemo(
    () => uniqueLabels(rows.map((row) => row.fromName)),
    [rows],
  );
  const toOptions = useMemo(
    () => uniqueLabels(rows.map((row) => bullionToLabel(row))),
    [rows],
  );
  const statusOptions = useMemo(
    () => uniqueLabels(rows.map((row) => bullionStatusLabel(row))),
    [rows],
  );
  const visibleRows = useMemo(
    () =>
      rows.filter(
        (row) =>
          matchesLabelFilter(row.reference, filters.reference) &&
          matchesLabelFilter(row.dateLabel, filters.dateLabel) &&
          matchesLabelFilter(row.fromName, filters.fromName) &&
          matchesLabelFilter(bullionToLabel(row), filters.toName) &&
          matchesLabelFilter(bullionStatusLabel(row), filters.status),
      ),
    [filters, rows],
  );
  const filtersActive = Object.values(filters).some((value) => String(value || '').trim());
  const openRow = visibleRows.find((row) => row.id === openId) || rows.find((row) => row.id === openId) || null;

  return (
    <View style={styles.body}>
      {rows.length === 0 ? (
        <EmptyState
          icon="diamond-outline"
          title="Bullion"
          body={
            posBusy
              ? 'Loading transfers to the workshop…'
              : `All transfers from ${storeNamesLabel(storeList) || 'the selected stores'} to the workshop appear here.`
          }
        />
      ) : (
        <>
          <View style={styles.tableToolbar}>
            <Text style={styles.tableMeta}>
              {filtersActive ? `${visibleRows.length} of ${rows.length}` : rows.length}
              {' '}
              {rows.length === 1 ? 'transfer' : 'transfers'}
            </Text>
          </View>
          <TableFrame
            minWidth={720}
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
                  style={{ flex: 1.2, minWidth: 120 }}
                />
                <ColumnFilter
                  columnKey="dateLabel"
                  label="Date"
                  value={filters.dateLabel}
                  onChange={(value) => setFilter('dateLabel', value)}
                  options={dateOptions}
                  openKey={openFilter}
                  onOpenKey={setOpenFilter}
                  style={{ flex: 0.9, minWidth: 92 }}
                />
                <ColumnFilter
                  columnKey="fromName"
                  label="From"
                  value={filters.fromName}
                  onChange={(value) => setFilter('fromName', value)}
                  options={fromOptions}
                  openKey={openFilter}
                  onOpenKey={setOpenFilter}
                  style={{ flex: 1.15, minWidth: 110 }}
                />
                <ColumnFilter
                  columnKey="toName"
                  label="To"
                  value={filters.toName}
                  onChange={(value) => setFilter('toName', value)}
                  options={toOptions}
                  openKey={openFilter}
                  onOpenKey={setOpenFilter}
                  style={{ flex: 1.15, minWidth: 110 }}
                />
                <ColumnFilter
                  columnKey="status"
                  label="Status"
                  value={filters.status}
                  onChange={(value) => setFilter('status', value)}
                  options={statusOptions}
                  openKey={openFilter}
                  onOpenKey={setOpenFilter}
                  style={{ flex: 1, minWidth: 110 }}
                />
              </>
            }
          >
            {visibleRows.length === 0 ? (
              <Text style={styles.tableEmpty}>No transfers match that column filter.</Text>
            ) : (
              visibleRows.map((row, index) => (
                <BullionTableRow
                  key={row.id}
                  row={row}
                  last={index === visibleRows.length - 1}
                  onOpen={(item) => {
                    setOpenFilter(null);
                    setOpenId(item.id);
                  }}
                />
              ))
            )}
          </TableFrame>
        </>
      )}
      <BullionTransferDrawer
        visible={Boolean(openRow)}
        transfer={openRow}
        onClose={() => setOpenId(null)}
      />
    </View>
  );
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

function StoreMultiPicker({ session, addedKeys, selectedIds, onChangeSelected }) {
  const isMobile = useIsMobile();
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
      const hay = [store.name, store.city, store.systemLabel, store.address]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
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
    if (allVisibleSelected) {
      filtered.forEach((store) => next.delete(store.id));
    } else {
      filtered.forEach((store) => next.add(store.id));
    }
    emit(next);
  };

  return (
    <View style={styles.storePicker}>
      <View style={[styles.searchField, isMobile && styles.searchFieldMobile]}>
        <Ionicons name="search" size={16} color={SECONDARY} style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder="Search stores"
          placeholderTextColor={SECONDARY}
          autoCorrect={false}
          autoCapitalize="none"
          clearButtonMode="while-editing"
        />
      </View>

      <View style={styles.storeSelectBar}>
        <Text style={styles.storeSelectCount}>
          {selectedIds.size === 0
            ? 'Select stores'
            : `${selectedIds.size} selected`}
        </Text>
        {filtered.length > 0 ? (
          <Pressable onPress={toggleVisible} hitSlop={8} accessibilityRole="button">
            <Text style={styles.storeSelectAll}>{allVisibleSelected ? 'Clear visible' : 'Select visible'}</Text>
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
          {filtered.length === 0 ? (
            <Text style={styles.modalEmpty}>
              {stores.length === 0 ? 'No stores available.' : 'No matching stores.'}
            </Text>
          ) : (
            filtered.map((store) => {
              const selected = selectedIds.has(store.id);
              return (
                <Pressable
                  key={store.id}
                  style={styles.storePickRow}
                  onPress={() => toggle(store.id)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: selected }}
                  accessibilityLabel={store.name}
                >
                  <View style={styles.listRowText}>
                    <Text style={styles.listRowTitle} numberOfLines={1}>
                      {store.name}
                    </Text>
                    <Text style={styles.listRowSub} numberOfLines={1}>
                      {[store.city, store.systemLabel].filter(Boolean).join(' · ') || store.address}
                    </Text>
                  </View>
                  {selected ? <Ionicons name="checkmark" size={22} color={BLUE} /> : null}
                </Pressable>
              );
            })
          )}
        </ScrollView>
      )}
    </View>
  );
}

function CreateTransferModal({ visible, session, transfers, onClose, onCreate }) {
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
    () => (transfers || []).find((row) => row.dateKey === dateKey) || null,
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
          <View style={styles.storeHeader}>
            <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button">
              <Text style={styles.iosNavAction}>Cancel</Text>
            </Pressable>
            <View style={styles.storeTitleBlock}>
              <Text style={styles.modalTitle}>{existing ? 'Add Stores' : 'New Transfer'}</Text>
              <Text style={styles.modalSub}>
                {existing
                  ? `Adding to ${existing.dateLabel || dateKey}`
                  : 'Stores sending to Workshop'}
              </Text>
            </View>
            <Pressable
              onPress={create}
              disabled={pickedStores.length === 0}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={existing ? 'Add' : 'Create'}
            >
              <Text style={[styles.iosNavAction, styles.iosNavActionStrong, pickedStores.length === 0 && styles.iosNavActionDisabled]}>
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

function AddStoreModal({ visible, session, addedKeys, onClose, onAdd }) {
  const isMobile = useIsMobile();
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [pickedStores, setPickedStores] = useState([]);

  useEffect(() => {
    if (!visible) return;
    setSelectedIds(new Set());
    setPickedStores([]);
  }, [visible]);

  const add = () => {
    if (pickedStores.length === 0) return;
    onAdd(pickedStores.map(mapPickedStore));
  };

  if (!visible) return null;

  return (
    <Modal visible transparent animationType={isMobile ? 'slide' : 'fade'} onRequestClose={onClose}>
      <View style={[styles.modalBackdrop, isMobile && styles.sheetBackdrop]} pointerEvents="box-none">
        {isMobile ? null : <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />}
        <View style={[styles.storeCard, isMobile && styles.sheetCard]} pointerEvents="auto">
          {isMobile ? <View style={styles.sheetGrabber} /> : null}
          <View style={styles.storeHeader}>
            <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button">
              <Text style={styles.iosNavAction}>Cancel</Text>
            </Pressable>
            <View style={styles.storeTitleBlock}>
              <Text style={styles.modalTitle}>Add Stores</Text>
            </View>
            <Pressable
              onPress={add}
              disabled={selectedIds.size === 0}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Add"
            >
              <Text
                style={[
                  styles.iosNavAction,
                  styles.iosNavActionStrong,
                  selectedIds.size === 0 && styles.iosNavActionDisabled,
                ]}
              >
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

export default function TriageTransfersPanel({
  session,
  onRequireLogin,
  createOpen,
  onCreateOpenChange,
  onViewChange,
  onBackChange,
}) {
  const { triage: transfers } = useTransferWorkflow();
  const isMobile = useIsMobile();
  const [selectedId, setSelectedId] = useState(null);
  const [storeTab, setStoreTab] = useState('melt');
  const [addMeltOpen, setAddMeltOpen] = useState(false);

  const selected = useMemo(
    () => transfers.find((row) => row.id === selectedId) || null,
    [selectedId, transfers],
  );
  const batchStores = selected?.stores || [];
  const meltPos = useMemo(() => flattenMeltPos(batchStores), [selected]);
  const batchContext = useMemo(() => {
    if (!selected) return null;
    return {
      dateLabel: selected.dateLabel || selected.dateKey || '',
      storeNames: storeNamesLabel(batchStores),
    };
  }, [batchStores, selected]);

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
    if (!row?.stores?.length) return;
    setSelectedId(row.id);
    const hasBullion = row.stores.some(
      (store) => plannedForTriageStore(row.dateKey, store.storeKey).length > 0,
    );
    const hasMelt = row.stores.some((store) => (store.meltPos || []).length > 0);
    setStoreTab(hasBullion && !hasMelt ? 'bullion' : 'melt');
  }, []);

  const openTransfer = useCallback(
    (row) => {
      openBatch(row);
    },
    [openBatch],
  );

  const createTransfer = useCallback(
    (row) => {
      const mergeId = row.mergeIntoId;
      const incoming = row.stores || [];
      let nextRow = row;
      if (mergeId) {
        const existing = transfers.find((item) => item.id === mergeId);
        if (existing) {
          const fresh = incoming.filter((store) => !storeOnBatch(existing.stores, store));
          nextRow = {
            ...existing,
            stores: sortBatchStores([...(existing.stores || []), ...fresh]),
          };
          updateTriageTransfers((current) =>
            current.map((item) => (item.id === mergeId ? nextRow : item)),
          );
        } else {
          updateTriageTransfers((current) =>
            [{ ...row, stores: sortBatchStores(incoming) }, ...current].sort((a, b) =>
              b.dateKey.localeCompare(a.dateKey),
            ),
          );
        }
      } else {
        nextRow = { ...row, stores: sortBatchStores(incoming) };
        delete nextRow.mergeIntoId;
        updateTriageTransfers((current) =>
          [nextRow, ...current].sort((a, b) => b.dateKey.localeCompare(a.dateKey)),
        );
      }
      persistTransferWorkflowNow().catch(() => {});
      onCreateOpenChange(false);
      openBatch(nextRow);
      if (incoming.length) setAddMeltOpen(true);
    },
    [onCreateOpenChange, openBatch, transfers],
  );

  const removeTransfer = useCallback((row) => {
    confirmDestructive(
      'Delete Transfer',
      `Delete ${row.dateLabel || 'this transfer'}? Stores and purchase orders on this date will be removed.`,
      () => {
        updateTriageTransfers((current) => current.filter((item) => item.id !== row.id));
        persistTransferWorkflowNow().catch(() => {});
      },
    );
  }, []);

  const mergeMeltPos = useCallback(
    (nextRows) => {
      if (!selectedId) return;
      updateTriageTransfers((current) =>
        current.map((row) => {
          if (row.id !== selectedId) return row;
          const stores = (row.stores || []).map((store) => ({
            ...store,
            meltPos: [...(store.meltPos || [])],
          }));
          for (const item of nextRows || []) {
            const dest =
              stores.find((store) => namesMatch(store.name, item.storeName)) || stores[0];
            if (!dest) continue;
            const index = dest.meltPos.findIndex((entry) => entry.id === item.id);
            if (index >= 0) {
              const prev = dest.meltPos[index];
              const imageUrls =
                (prev.imageUrls || []).length > 0 ? prev.imageUrls : item.imageUrls || [];
              if (imageUrls !== prev.imageUrls) {
                dest.meltPos[index] = { ...prev, imageUrls };
              }
              continue;
            }
            dest.meltPos.push({ ...item, received: false });
          }
          for (const store of stores) {
            store.meltPos.sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0));
          }
          return { ...row, stores };
        }),
      );
      persistTransferWorkflowNow().catch(() => {});
    },
    [selectedId],
  );

  const saveMeltReview = useCallback((poId, review) => {
    saveTriagePoReview(poId, review);
    persistTransferWorkflowNow().catch(() => {});
  }, []);

  const removeMeltPo = useCallback(
    (poId) => {
      if (!selectedId) return;
      updateTriageTransfers((current) =>
        current.map((row) => {
          if (row.id !== selectedId) return row;
          return {
            ...row,
            stores: row.stores.map((store) => ({
              ...store,
              meltPos: (store.meltPos || []).filter((item) => item.id !== poId),
            })),
          };
        }),
      );
      persistTransferWorkflowNow().catch(() => {});
    },
    [selectedId],
  );

  const receiveAllMelt = useCallback(() => {
    if (!selectedId) return;
    updateTriageTransfers((current) =>
      current.map((row) => {
        if (row.id !== selectedId) return row;
        return {
          ...row,
          stores: row.stores.map((store) => {
            const melt = store.meltPos || [];
            if (melt.length === 0 || melt.every((item) => item.received)) return store;
            return {
              ...store,
              meltPos: melt.map((item) => (item.received ? item : { ...item, received: true })),
            };
          }),
        };
      }),
    );
    persistTransferWorkflowNow().catch(() => {});
  }, [selectedId]);

  const toggleMeltReceived = useCallback(
    (poId) => {
      if (!selectedId) return;
      updateTriageTransfers((current) =>
        current.map((row) => {
          if (row.id !== selectedId) return row;
          return {
            ...row,
            stores: row.stores.map((store) => ({
              ...store,
              meltPos: (store.meltPos || []).map((item) =>
                item.id === poId ? { ...item, received: !item.received } : item,
              ),
            })),
          };
        }),
      );
      persistTransferWorkflowNow().catch(() => {});
    },
    [selectedId],
  );

  if (!session?.token) {
    return (
      <View style={[styles.body, styles.bodyTinted]}>
        <EmptyState
          icon="lock-closed-outline"
          title="Sign in"
          body="Log in to create transfers and add stores."
        />
        <View style={styles.emptyAction}>
          <Pressable style={styles.loginButton} onPress={onRequireLogin}>
            <Text style={styles.loginButtonText}>Go to Profile</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const meltActions =
    storeTab === 'melt' ? (
      <Pressable
        style={styles.compactAdd}
        onPress={() => setAddMeltOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="Add"
      >
        <Ionicons name="add" size={18} color={BLUE} />
        <Text style={styles.compactAddText}>Add</Text>
      </Pressable>
    ) : null;

  if (selected) {
    return (
      <View style={[styles.body, styles.bodyTinted]}>
        <View style={styles.viewTabs} accessibilityRole="tablist">
          <View style={styles.textTabs}>
            {STORE_TABS.map((tab) => {
              const active = tab.key === storeTab;
              return (
                <Pressable
                  key={tab.key}
                  style={styles.textTab}
                  onPress={() => {
                    setStoreTab(tab.key);
                    if (tab.key !== 'melt') setAddMeltOpen(false);
                  }}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={tab.label}
                >
                  <Text style={[styles.textTabLabel, active && styles.textTabLabelActive]}>
                    {tab.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {meltActions}
        </View>

        {storeTab === 'melt' ? (
          <MeltTab
            session={session}
            stores={batchStores}
            dateKey={selected.dateKey}
            pos={meltPos}
            addOpen={addMeltOpen}
            onAddOpenChange={setAddMeltOpen}
            onMergePos={mergeMeltPos}
            onRemovePos={removeMeltPo}
            onToggleReceived={toggleMeltReceived}
            onReceiveAll={receiveAllMelt}
            onSaveReview={saveMeltReview}
          />
        ) : (
          <BullionTab dateKey={selected.dateKey} stores={batchStores} session={session} />
        )}
      </View>
    );
  }

  return (
    <View style={[styles.body, styles.bodyTinted]}>
      {transfers.length === 0 ? (
        <EmptyState
          icon="calendar-outline"
          title="No Transfers"
          body="Tap New to start a workshop transfer for a date."
        />
      ) : (
        <ScrollView
          style={styles.list}
          contentContainerStyle={styles.listContentInset}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.listGroup}>
            {transfers.map((row, index) => (
              <ListRow
                key={row.id}
                title={row.dateLabel}
                subtitle={
                  row.stores.length
                    ? row.stores.map((store) => store.name).join(', ')
                    : 'No stores yet'
                }
                subtitleLines={2}
                mobile={isMobile}
                last={index === transfers.length - 1}
                onPress={() => openTransfer(row)}
                onDelete={() => removeTransfer(row)}
                accessibilityLabel={`Open transfer ${row.dateLabel}`}
              />
            ))}
          </View>
        </ScrollView>
      )}

      <CreateTransferModal
        visible={createOpen}
        session={session}
        transfers={transfers}
        onClose={() => onCreateOpenChange(false)}
        onCreate={createTransfer}
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
  bodyMobile: {
    backgroundColor: MOBILE.bg,
  },
  listContentInset: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 32,
  },
  listContentMobile: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 32,
  },
  listGroup: {
    backgroundColor: '#fff',
    borderRadius: 12,
    overflow: 'hidden',
  },
  tableToolbar: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 8,
    minHeight: 36,
  },
  tableMeta: {
    fontFamily,
    fontSize: 13,
    fontWeight: '400',
    color: SECONDARY,
  },
  tableHScroll: {
    flex: 1,
    minHeight: 0,
  },
  tableHContent: {
    flexGrow: 1,
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  tableHFill: {
    flex: 1,
    minHeight: 0,
  },
  tableCard: {
    flex: 1,
    minHeight: 0,
    backgroundColor: '#fff',
    borderRadius: 12,
    overflow: 'visible',
    ...Platform.select({
      web: { boxShadow: '0 1px 2px rgba(0,0,0,0.04)' },
      default: {},
    }),
  },
  tableHeader: {
    flexDirection: 'row',
    alignItems: 'stretch',
    minHeight: 36,
    backgroundColor: '#f2f2f7',
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#d1d1d6',
    zIndex: 8,
    overflow: 'visible',
  },
  tableBody: {
    flex: 1,
    minHeight: 0,
  },
  tableBodyContent: {
    flexGrow: 1,
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 52,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HAIRLINE,
    backgroundColor: '#fff',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  tableRowLast: {
    borderBottomWidth: 0,
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
  },
  tableRowMain: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  tableCell: {
    minHeight: 52,
    paddingHorizontal: 8,
    justifyContent: 'center',
  },
  tableCellLast: {
    paddingRight: 14,
  },
  tableCellText: {
    fontFamily,
    fontSize: 13,
    color: TEXT,
    letterSpacing: -0.08,
  },
  tableCellStrong: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: TEXT,
    letterSpacing: -0.08,
  },
  tableStatusOn: {
    color: GREEN,
    fontWeight: '600',
  },
  tableStatusReview: {
    color: BLUE,
    fontWeight: '600',
  },
  tablePhotoCell: {
    width: 52,
    flexGrow: 0,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingLeft: 8,
  },
  tableActions: {
    width: 132,
    flexGrow: 0,
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 4,
    paddingRight: 8,
  },
  tableActionsHead: {
    width: 132,
    flexGrow: 0,
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 4,
    paddingRight: 8,
  },
  tableAction: {
    height: 28,
    paddingHorizontal: 8,
    borderRadius: 8,
    backgroundColor: FILL,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  tableActionOn: {
    backgroundColor: GREEN,
  },
  tableActionText: {
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
    color: TEXT,
  },
  tableActionTextOn: {
    color: '#fff',
  },
  tableRemove: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  tableEmpty: {
    fontFamily,
    fontSize: 14,
    color: SECONDARY,
    textAlign: 'center',
    paddingVertical: 36,
    paddingHorizontal: 16,
  },
  colFilter: {
    justifyContent: 'center',
    zIndex: 8,
    overflow: 'visible',
  },
  colFilterHit: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  colFilterLabel: {
    fontFamily,
    flexShrink: 1,
    fontSize: 12,
    fontWeight: '600',
    color: SECONDARY,
    letterSpacing: 0.2,
    textTransform: 'uppercase',
  },
  colFilterLabelOn: {
    color: TEXT,
    textTransform: 'none',
    letterSpacing: -0.08,
  },
  colFilterMenu: {
    position: 'absolute',
    top: 36,
    left: 4,
    right: 4,
    minWidth: 180,
    maxWidth: 280,
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: HAIRLINE,
    overflow: 'hidden',
    zIndex: 30,
    ...Platform.select({
      web: { boxShadow: '0 10px 28px rgba(0,0,0,0.12)' },
      default: { elevation: 6 },
    }),
  },
  colFilterSearch: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    margin: 8,
    paddingHorizontal: 8,
    minHeight: 32,
    borderRadius: 8,
    backgroundColor: FILL,
  },
  colFilterInput: {
    flex: 1,
    minWidth: 0,
    fontFamily,
    fontSize: 14,
    color: TEXT,
    paddingVertical: 6,
    outlineStyle: 'none',
  },
  colFilterList: {
    maxHeight: 220,
  },
  colFilterOption: {
    minHeight: 36,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  colFilterOptionText: {
    fontFamily,
    flex: 1,
    fontSize: 14,
    color: TEXT,
  },
  colFilterOptionOn: {
    fontWeight: '600',
  },
  colFilterClear: {
    fontFamily,
    fontSize: 14,
    color: BLUE,
  },
  colFilterEmpty: {
    fontFamily,
    fontSize: 13,
    color: SECONDARY,
    textAlign: 'center',
    paddingVertical: 14,
  },
  listRowMobile: {
    borderBottomColor: MOBILE.separator,
  },
  listRowMobileLast: {
    borderBottomWidth: 0,
  },
  listRowLast: {
    borderBottomWidth: 0,
  },
  rowDelete: {
    paddingHorizontal: 8,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  rowDeleteText: {
    fontFamily,
    fontSize: 17,
    fontWeight: '400',
    color: RED,
  },
  viewTabs: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 2,
    paddingBottom: 2,
  },
  textTabs: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  textTab: {
    paddingVertical: 6,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  textTabLabel: {
    fontFamily,
    fontSize: 13,
    fontWeight: '400',
    color: MOBILE.secondary,
    letterSpacing: -0.2,
  },
  textTabLabelActive: {
    fontWeight: '600',
    color: MOBILE.blue,
  },
  compactAdd: {
    minHeight: 28,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginLeft: 'auto',
    paddingHorizontal: 4,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  compactAddText: {
    fontFamily,
    fontSize: 15,
    fontWeight: '400',
    color: BLUE,
  },
  iosTextAction: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 2,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  iosNavAction: {
    fontFamily,
    fontSize: 17,
    fontWeight: '400',
    color: BLUE,
    minWidth: 64,
  },
  iosNavActionStrong: {
    fontWeight: '600',
    textAlign: 'right',
  },
  iosNavActionDisabled: {
    opacity: 0.35,
  },
  iosNavHeader: {
    paddingHorizontal: 4,
    paddingBottom: 8,
    marginBottom: 4,
    backgroundColor: MOBILE.bg,
  },
  iosBackButton: {
    minHeight: 44,
    marginLeft: 0,
  },
  iosBackText: {
    fontSize: 17,
    fontWeight: '400',
    color: MOBILE.blue,
  },
  iosNavTitle: {
    fontSize: 17,
    fontWeight: '600',
    textAlign: 'center',
    letterSpacing: -0.3,
  },
  iosNavMeta: {
    fontSize: 13,
    fontWeight: '400',
    color: MOBILE.secondary,
    textAlign: 'center',
  },
  tabBarMobile: {
    borderBottomWidth: 0,
    marginBottom: 10,
    paddingHorizontal: 16,
    alignItems: 'stretch',
  },
  segment: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    height: 36,
    backgroundColor: 'rgba(118,118,128,0.12)',
    borderRadius: 9,
    padding: 2,
    gap: 0,
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
  },
  segmentTextActive: {
    fontWeight: '600',
  },
  mobileActionBar: {
    flexShrink: 0,
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: Math.max(12, mobileSafeBottom()),
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: MOBILE.separator,
  },
  mobileAction: {
    flex: 1,
    minHeight: 44,
    borderRadius: 12,
    backgroundColor: FILL,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  mobileActionSaved: {
    backgroundColor: GREEN,
  },
  mobileActionText: {
    fontFamily,
    fontSize: 16,
    fontWeight: '600',
    color: TEXT,
  },
  mobileActionTextSaved: {
    color: '#fff',
  },
  mobileActionPrimary: {
    flex: 1,
    minHeight: 44,
    borderRadius: 12,
    backgroundColor: ACCENT,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  mobileActionPrimaryText: {
    fontFamily,
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
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
    maxWidth: '100%',
    height: '100%',
    maxHeight: '100%',
    borderRadius: 0,
    paddingTop: 10,
    paddingBottom: Math.max(18, mobileSafeBottom()),
  },
  sheetCardBottom: {
    width: '100%',
    maxWidth: '100%',
    height: 'auto',
    maxHeight: '92%',
    borderRadius: 0,
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    paddingTop: 10,
    paddingBottom: Math.max(20, mobileSafeBottom()),
  },
  sheetGrabber: {
    alignSelf: 'center',
    width: 36,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: 'rgba(60,60,67,0.28)',
    marginBottom: 8,
  },
  searchFieldMobile: {
    borderRadius: 10,
    minHeight: 36,
    backgroundColor: 'rgba(118,118,128,0.12)',
  },
  meltSearchMobile: {
    marginHorizontal: 16,
  },
  poRowMobile: {
    minHeight: 56,
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
    borderBottomColor: MOBILE.separator,
  },
  poRowMain: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    minWidth: 0,
    gap: 10,
  },
  poRowMainMobile: {
    flex: 0,
  },
  poRowActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  poRowActionsInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  receivedGroupMobile: {
    flex: 1,
    minHeight: 44,
  },
  receivedButtonMobile: {
    flex: 1,
    height: 44,
    borderRadius: 12,
  },
  removePoButtonMobile: {
    width: 44,
    height: 44,
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
  emptyAction: {
    alignItems: 'center',
    paddingBottom: 48,
  },
  emptyTitle: {
    fontFamily,
    fontSize: 22,
    fontWeight: '600',
    color: TEXT,
    letterSpacing: -0.4,
    marginTop: 4,
  },
  emptyBody: {
    fontFamily,
    fontSize: 15,
    lineHeight: 21,
    color: SECONDARY,
    textAlign: 'center',
    maxWidth: 320,
  },
  loginButton: {
    backgroundColor: BLUE,
    borderRadius: 12,
    paddingHorizontal: 18,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loginButtonText: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },
  list: {
    flex: 1,
    minHeight: 0,
  },
  listContent: {
    paddingBottom: 24,
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HAIRLINE,
    backgroundColor: '#fff',
  },
  listRowMain: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 56,
    paddingHorizontal: 16,
    paddingVertical: 12,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  listRowText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  listRowTitle: {
    fontFamily,
    fontSize: 16,
    fontWeight: '600',
    color: TEXT,
    letterSpacing: -0.2,
  },
  listRowSub: {
    fontFamily,
    fontSize: 13,
    color: SECONDARY,
  },
  listRowMeta: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: BLUE,
  },
  pageMeta: {
    fontFamily,
    fontSize: 14,
    fontWeight: '600',
    color: BLUE,
  },
  subHeader: {
    flexShrink: 0,
    marginBottom: 8,
    gap: 6,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    marginLeft: -4,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  backText: {
    fontFamily,
    fontSize: 14,
    fontWeight: '600',
    color: BLUE,
  },
  pageTitle: {
    fontFamily,
    fontSize: 22,
    fontWeight: '600',
    color: TEXT,
    letterSpacing: -0.4,
  },
  tabBar: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HAIRLINE,
  },
  tabBarTabs: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 2,
  },
  tabBarTrailing: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingBottom: 6,
  },
  saveButton: {
    height: 32,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  saveButtonOn: {
    backgroundColor: GREEN,
    borderColor: GREEN,
  },
  saveButtonText: {
    fontFamily,
    fontSize: 14,
    fontWeight: '600',
    color: BLUE,
  },
  saveButtonTextOn: {
    color: '#fff',
  },
  ghostButton: {
    height: 32,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  ghostButtonText: {
    fontFamily,
    fontSize: 14,
    fontWeight: '600',
    color: BLUE,
  },
  newButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: BLUE,
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 32,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  newButtonText: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },
  tab: {
    paddingHorizontal: 14,
    paddingTop: 6,
    paddingBottom: 11,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
    marginBottom: -StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  tabActive: {
    borderBottomColor: ACCENT,
  },
  tabLabel: {
    fontFamily,
    fontSize: 15,
    fontWeight: '500',
    color: SECONDARY,
    letterSpacing: -0.2,
  },
  tabLabelActive: {
    color: TEXT,
    fontWeight: '600',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  smallCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 18,
    gap: 12,
  },
  storeCard: {
    width: '96%',
    maxWidth: 560,
    maxHeight: Platform.OS === 'web' ? '80vh' : '80%',
    height: Platform.OS === 'web' ? 640 : '80%',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 18,
    gap: 12,
    overflow: 'hidden',
    zIndex: 2,
  },
  storePicker: {
    flex: 1,
    minHeight: 0,
    gap: 8,
  },
  storeSelectBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  storeSelectCount: {
    fontFamily,
    fontSize: 13,
    color: SECONDARY,
  },
  storeSelectAll: {
    fontFamily,
    fontSize: 17,
    fontWeight: '400',
    color: BLUE,
  },
  storeListContent: {
    paddingBottom: 8,
  },
  storeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  storeTitleBlock: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    gap: 2,
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
    fontSize: 13,
    lineHeight: 18,
    color: SECONDARY,
    textAlign: 'center',
  },
  kindRow: {
    flexDirection: 'row',
    gap: 8,
  },
  addModeRow: {
    flexDirection: 'row',
    gap: 8,
  },
  docSearchBlock: {
    gap: 10,
  },
  kindChip: {
    flex: 1,
    height: 36,
    borderRadius: 8,
    backgroundColor: FILL,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  kindChipActive: {
    backgroundColor: ACCENT,
  },
  kindChipText: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: TEXT,
  },
  kindChipTextActive: {
    color: '#fff',
  },
  fieldInput: {
    fontFamily,
    fontSize: 16,
    color: TEXT,
    backgroundColor: FILL,
    borderRadius: 8,
    paddingHorizontal: 12,
    minHeight: 44,
  },
  dateField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: FILL,
    borderRadius: 8,
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
  errorText: {
    fontFamily,
    fontSize: 13,
    color: BLUE,
  },
  lastTransferHint: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: TEXT,
  },
  lastTransferButton: {
    height: 44,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFF7ED',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  lastTransferButtonText: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: BLUE,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  secondaryButton: {
    flex: 1,
    height: 50,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: FILL,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  secondaryButtonText: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: TEXT,
  },
  primaryButton: {
    backgroundColor: BLUE,
    borderRadius: 12,
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  primaryButtonInline: {
    flex: 1,
  },
  primaryButtonDisabled: {
    opacity: 0.6,
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
  },
  poRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
    paddingHorizontal: 4,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HAIRLINE,
    gap: 10,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  poRowText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  poRef: {
    fontFamily,
    fontSize: 16,
    fontWeight: '600',
    color: TEXT,
    letterSpacing: -0.2,
  },
  poSub: {
    fontFamily,
    fontSize: 13,
    color: SECONDARY,
  },
  poMeta: {
    fontFamily,
    fontSize: 13,
    color: TEXT,
  },
  meltToolbar: {
    gap: 8,
    marginBottom: 10,
    zIndex: 3,
    overflow: 'visible',
  },
  meltToolbarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'nowrap',
    overflow: 'visible',
  },
  meltToolbarMobile: {
    marginHorizontal: 16,
  },
  meltSearchInline: {
    flexGrow: 1.4,
    flexShrink: 1,
    flexBasis: 140,
    minWidth: 108,
    minHeight: 36,
    marginBottom: 0,
  },
  meltToolbarScroll: {
    flexGrow: 1,
    minWidth: 0,
  },
  meltToolbarScrollContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexGrow: 1,
    paddingRight: 4,
  },
  filterFieldCompact: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 88,
    minWidth: 78,
    marginBottom: 0,
    position: 'relative',
  },
  filterMenuCompact: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 38,
    zIndex: 20,
  },
  filterInputWrapCompact: {
    minHeight: 36,
    paddingHorizontal: 8,
  },
  feedOpenButton: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
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
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
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
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
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
  listRange: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: SECONDARY,
  },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    zIndex: 3,
  },
  filterField: {
    flexGrow: 1,
    flexBasis: 140,
    minWidth: 140,
    zIndex: 3,
  },
  filterLabel: {
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
    color: SECONDARY,
    marginBottom: 4,
  },
  filterInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: FILL,
    borderRadius: 8,
    paddingHorizontal: 10,
    minHeight: 36,
  },
  filterInput: {
    flex: 1,
    minWidth: 0,
    fontFamily,
    fontSize: 14,
    color: TEXT,
    paddingVertical: 8,
    outlineStyle: 'none',
  },
  filterMenu: {
    marginTop: 4,
    maxHeight: 180,
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: HAIRLINE,
    overflow: 'hidden',
    zIndex: 8,
    ...Platform.select({
      web: { boxShadow: '0 8px 20px rgba(0,0,0,0.08)' },
      default: { elevation: 3 },
    }),
  },
  filterOption: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HAIRLINE,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  filterOptionText: {
    fontFamily,
    fontSize: 14,
    color: TEXT,
  },
  poReview: {
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
    color: BLUE,
  },
  poThumbSlot: {
    width: 44,
    height: 44,
    borderRadius: 8,
    backgroundColor: FILL,
    alignItems: 'center',
    justifyContent: 'center',
  },
  poThumbPress: {
    width: 44,
    height: 44,
    borderRadius: 8,
    overflow: 'hidden',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  poThumb: {
    width: 44,
    height: 44,
    backgroundColor: FILL,
  },
  photoViewerRoot: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  photoViewerSheet: {
    width: '100%',
    maxWidth: 720,
    gap: 12,
  },
  photoViewerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  photoViewerTitle: {
    flex: 1,
    fontFamily,
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  photoViewerImage: {
    width: '100%',
    height: 420,
    backgroundColor: '#111',
    borderRadius: 10,
  },
  removePoButton: {
    width: 28,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  receivedGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  receivedButton: {
    height: 32,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: FILL,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  receivedButtonOn: {
    backgroundColor: GREEN,
  },
  receivedButtonText: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: TEXT,
  },
  receivedButtonTextOn: {
    color: '#fff',
  },
  primaryButtonText: {
    fontFamily,
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  meltSearchField: {
    marginBottom: 0,
  },
  docResultList: {
    maxHeight: 240,
  },
  docResultListContent: {
    paddingBottom: 4,
  },
  docResultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 52,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HAIRLINE,
    gap: 10,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
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
  searchField: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 6,
    paddingHorizontal: 12,
    backgroundColor: FILL,
    minHeight: 42,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontFamily,
    fontSize: 16,
    color: TEXT,
    paddingVertical: 10,
    outlineStyle: 'none',
  },
  storeList: {
    flex: 1,
    minHeight: 0,
    ...Platform.select({
      web: { overflow: 'auto' },
      default: {},
    }),
  },
  storePickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 52,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HAIRLINE,
    gap: 10,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
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
  },
  drawerRoot: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  drawerBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.28)',
  },
  drawerPanel: {
    height: '100%',
    backgroundColor: MOBILE.bg,
    ...Platform.select({
      web: { boxShadow: '-12px 0 32px rgba(0,0,0,0.18)' },
      default: { elevation: 12 },
    }),
  },
  drawerPanelMobile: {
    backgroundColor: MOBILE.bg,
  },
  drawerTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 52,
    paddingHorizontal: 8,
    backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: MOBILE.separator,
  },
  drawerTopBarMobile: {
    paddingTop: Platform.OS === 'ios' ? 12 : 2,
  },
  drawerDone: {
    width: 72,
    minHeight: 44,
    justifyContent: 'center',
  },
  drawerDoneText: {
    fontFamily,
    fontSize: 17,
    fontWeight: '400',
    color: MOBILE.blue,
  },
  drawerTitle: {
    fontFamily,
    flex: 1,
    fontSize: 17,
    fontWeight: '600',
    color: MOBILE.label,
    textAlign: 'center',
    letterSpacing: -0.3,
  },
  drawerBody: {
    flex: 1,
    minHeight: 0,
  },
  drawerBodyContent: {
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: Math.max(32, mobileSafeBottom() + 16),
    gap: 8,
  },
  drawerHero: {
    alignItems: 'center',
    paddingVertical: 8,
    gap: 6,
  },
  drawerHeroRoute: {
    fontFamily,
    fontSize: 20,
    fontWeight: '600',
    color: MOBILE.label,
    letterSpacing: -0.4,
    textAlign: 'center',
  },
  drawerHeroMeta: {
    fontFamily,
    fontSize: 15,
    color: MOBILE.secondary,
    textAlign: 'center',
  },
  drawerStatusPill: {
    marginTop: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#fff',
  },
  drawerStatusText: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: MOBILE.label,
  },
  drawerSectionLabel: {
    fontFamily,
    fontSize: 13,
    fontWeight: '400',
    color: MOBILE.secondary,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginTop: 16,
    marginBottom: 6,
    marginLeft: 4,
  },
  drawerGroup: {
    backgroundColor: '#fff',
    borderRadius: 12,
    overflow: 'hidden',
  },
  drawerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: MOBILE.separator,
  },
  drawerRowLast: {
    borderBottomWidth: 0,
  },
  drawerRowLabel: {
    fontFamily,
    fontSize: 16,
    color: MOBILE.secondary,
  },
  drawerRowValue: {
    fontFamily,
    flex: 1,
    fontSize: 16,
    color: MOBILE.label,
    textAlign: 'right',
  },
  drawerEmpty: {
    fontFamily,
    fontSize: 15,
    color: MOBILE.secondary,
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  drawerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: MOBILE.separator,
  },
  drawerItemLast: {
    borderBottomWidth: 0,
  },
  drawerItemName: {
    fontFamily,
    fontSize: 16,
    fontWeight: '600',
    color: MOBILE.label,
  },
  drawerItemQty: {
    fontFamily,
    fontSize: 16,
    fontWeight: '600',
    color: MOBILE.label,
    fontVariant: ['tabular-nums'],
  },
});
