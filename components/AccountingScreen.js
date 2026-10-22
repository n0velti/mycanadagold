import { createElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { CANVAS, NAV_TAB_ACTIVE_RADIUS, useIsMobile } from '../lib/mobileUi';
import {
  advancePaymentCancellation,
  buildCancelTimelineView,
  fetchPaymentCancellations,
  nextCancelButtonLabel,
  savePaymentCancellationNote,
} from '../lib/accountingPaymentCancel';
import { fetchAllPayments, formatAmount, summarizeCashTotals } from '../lib/payments';
import { useAppAccess } from '../lib/permissions';
import { FONT_LIGHT } from '../lib/typography';
import { formatDateParam, formatPickerDate, parseDateParam } from '../lib/transactions';

const fontFamily = Platform.select({
  ios: 'Sohne',
  android: 'Sohne',
  default: 'Sohne',
});

const LABEL = '#1a1a1a';
const SECONDARY = '#8e8e93';
const TAB_BORDER = '#d0d0d0';
const HAIRLINE = '#e6e6e6';
const RULE = 'rgba(42,38,30,0.08)';
const HEAD_RULE = 'rgba(42,38,30,0.16)';
const BLUE = '#007AFF';
const GREEN = '#15803D';
const AMBER = '#C47A12';
const CHIP_SHADOW = Platform.select({
  web: { boxShadow: '0 1px 2px rgba(0,0,0,0.05)' },
  default: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 2,
    elevation: 1,
  },
});

const TABS = [
  { key: 'ledger', label: 'Ledger' },
  { key: 'payments', label: 'Payments' },
];

const LEDGER_SORT_KEYS = [
  { key: 'dateLabel', label: 'Date' },
  { key: 'title', label: 'Title' },
  { key: 'amount', label: 'Amount' },
  { key: 'paymentMethod', label: 'Method' },
  { key: 'inAmount', label: 'In' },
  { key: 'outAmount', label: 'Out' },
];

const PAYMENT_SORT_KEYS = [
  { key: 'dateLabel', label: 'Date' },
  { key: 'storeName', label: 'Store' },
  { key: 'title', label: 'Title' },
  { key: 'amount', label: 'Amount' },
  { key: 'paymentMethod', label: 'Method' },
  { key: 'checkNumber', label: 'Cheque' },
];

function DetailLine({ label, value }) {
  if (value == null || value === '' || value === '—') return null;
  return (
    <View style={styles.detailLine}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

function CancelTimeline({ record }) {
  const items = buildCancelTimelineView(record);
  return (
    <View style={styles.timelineCard}>
      <Text style={styles.timelineTitle}>Cancel workflow</Text>
      {items.map((item, index) => {
        const done = item.status === 'done';
        const pending = item.status === 'pending' || item.status === 'next';
        return (
          <View key={item.step} style={[styles.timelineRow, index === items.length - 1 && styles.timelineRowLast]}>
            <View style={[styles.timelineDot, done && styles.timelineDotDone, pending && styles.timelineDotPending]} />
            <View style={styles.timelineCopy}>
              <Text style={[styles.timelineStepLabel, item.isCurrent && styles.timelineStepCurrent]}>
                {item.label}
                {item.isCurrent && record?.step !== 'cancelled' ? ' · current' : ''}
              </Text>
              {done ? (
                <Text style={styles.timelineMeta} numberOfLines={2}>
                  {item.userName || 'Staff'}
                  {item.at ? ` · ${formatPickerDate(parseDateParam(item.at))}` : ''}
                </Text>
              ) : (
                <Text style={styles.timelineMetaPending}>Not completed yet</Text>
              )}
            </View>
          </View>
        );
      })}
    </View>
  );
}

function PaymentDetailModal({
  payment,
  record,
  session,
  onClose,
  onRecordChange,
}) {
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState(record?.note || '');
  const [advancing, setAdvancing] = useState(false);
  const [savingNote, setSavingNote] = useState(false);
  const [actionError, setActionError] = useState('');
  const noteTimer = useRef(null);

  useEffect(() => {
    setNoteDraft(record?.note || '');
    setTimelineOpen(false);
    setActionError('');
  }, [payment?.id, record?.note]);

  if (!payment) return null;

  const nextLabel = nextCancelButtonLabel(record?.step || '');
  const cancelled = record?.step === 'cancelled';

  const persistNote = async (value) => {
    if (!cancelled) return;
    setSavingNote(true);
    setActionError('');
    try {
      const next = await savePaymentCancellationNote(payment.id, value, session);
      onRecordChange(next);
    } catch (err) {
      setActionError(err?.message || 'Could not save note.');
    } finally {
      setSavingNote(false);
    }
  };

  const onNoteChange = (value) => {
    setNoteDraft(value);
    if (!cancelled) return;
    if (noteTimer.current) clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => {
      persistNote(value);
    }, 650);
  };

  const onAdvance = async () => {
    setAdvancing(true);
    setActionError('');
    try {
      const next = await advancePaymentCancellation(payment, session, record);
      onRecordChange(next);
      if (next?.step === 'cancelled') setTimelineOpen(true);
    } catch (err) {
      setActionError(err?.message || 'Could not update workflow.');
    } finally {
      setAdvancing(false);
    }
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.payModalBackdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
        <View style={styles.payModalCard}>
          <View style={styles.payModalHeader}>
            <Text style={styles.payModalTitle} numberOfLines={2}>
              {payment.title}
            </Text>
            <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="Close payment details">
              <Ionicons name="close" size={22} color={SECONDARY} />
            </Pressable>
          </View>

          <ScrollView style={styles.payModalScroll} keyboardShouldPersistTaps="handled">
            <DetailLine label="Store" value={payment.storeName} />
            <DetailLine label="Date" value={payment.dateLabel} />
            <DetailLine label="Amount" value={payment.amountLabel} />
            <DetailLine label="Direction" value={payment.directionLabel} />
            <DetailLine label="Payment method" value={payment.paymentMethod} />
            <DetailLine label="Cheque" value={payment.checkNumber ? `#${payment.checkNumber}` : ''} />
            <DetailLine label="Customer" value={payment.customerName} />
            <DetailLine label="Reference" value={payment.reference} />
            <DetailLine label="Till" value={payment.tillName !== '—' ? payment.tillName : ''} />
            <DetailLine label="Status" value={payment.status} />
            <DetailLine label="Comments" value={payment.comments} />
            <DetailLine label="POS" value={payment.systemLabel} />

            <View style={styles.cancelSection}>
              <View style={styles.cancelButtonWrap}>
                {nextLabel ? (
                  <Pressable
                    style={({ pressed }) => [
                      styles.cancelPrimaryBtn,
                      pressed && styles.chipPressed,
                      advancing && styles.cancelPrimaryBtnDisabled,
                    ]}
                    onPress={onAdvance}
                    disabled={advancing}
                    accessibilityLabel={nextLabel}
                  >
                    {advancing ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Text style={styles.cancelPrimaryBtnText}>{nextLabel}</Text>
                    )}
                  </Pressable>
                ) : (
                  <View style={styles.cancelledBadge}>
                    <Text style={styles.cancelledBadgeText}>Cancelled</Text>
                  </View>
                )}
                <Pressable
                  style={({ pressed }) => [styles.cancelLedgerBtn, pressed && styles.chipPressed]}
                  onPress={() => setTimelineOpen((open) => !open)}
                  accessibilityLabel="Show cancel workflow timeline"
                  accessibilityState={{ expanded: timelineOpen }}
                >
                  <Ionicons name="book-outline" size={17} color={LABEL} />
                </Pressable>
              </View>

              {timelineOpen ? <CancelTimeline record={record} /> : null}

              {cancelled ? (
                <View style={styles.noteBlock}>
                  <Text style={styles.noteLabel}>Note</Text>
                  <TextInput
                    style={styles.noteInput}
                    value={noteDraft}
                    onChangeText={onNoteChange}
                    onBlur={() => persistNote(noteDraft)}
                    placeholder="Add a note about this cancellation…"
                    placeholderTextColor={SECONDARY}
                    multiline
                    textAlignVertical="top"
                    accessibilityLabel="Cancellation note"
                  />
                  {savingNote ? <Text style={styles.noteSaving}>Saving…</Text> : null}
                </View>
              ) : null}

              {actionError ? <Text style={styles.errorText}>{actionError}</Text> : null}
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function TabBar({ options, value, onChange }) {
  return (
    <View style={styles.tabBar} accessibilityRole="tablist">
      {options.map((option) => {
        const active = option.key === value;
        return (
          <Pressable
            key={option.key}
            style={[styles.tab, active && styles.tabActive]}
            onPress={() => onChange(option.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={option.label}
          >
            <Text style={[styles.tabLabel, active && styles.tabLabelActive]} numberOfLines={1}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function DateChip({ label, value, onChange, maximumDate }) {
  const [open, setOpen] = useState(false);
  const dateValue = parseDateParam(value);

  const commit = (next) => {
    if (!next) return;
    let date = parseDateParam(next);
    if (maximumDate && date > parseDateParam(maximumDate)) {
      date = parseDateParam(maximumDate);
    }
    onChange(date);
  };

  if (Platform.OS === 'web') {
    return (
      <View style={styles.dateChip}>
        <Ionicons name="calendar-outline" size={14} color={SECONDARY} />
        {createElement('input', {
          type: 'date',
          value: formatDateParam(dateValue),
          max: maximumDate ? formatDateParam(maximumDate) : undefined,
          'aria-label': label,
          onChange: (event) => {
            if (event.target.value) commit(event.target.value);
          },
          style: {
            border: 'none',
            background: 'transparent',
            fontFamily,
            fontSize: 14,
            color: LABEL,
            padding: 0,
            margin: 0,
            outline: 'none',
            cursor: 'pointer',
            minWidth: 118,
            letterSpacing: '-0.2px',
          },
        })}
      </View>
    );
  }

  return (
    <>
      <Pressable
        style={({ pressed }) => [styles.dateChip, pressed && styles.chipPressed]}
        onPress={() => setOpen(true)}
        accessibilityLabel={label}
      >
        <Ionicons name="calendar-outline" size={14} color={SECONDARY} />
        <Text style={styles.dateChipValue}>{formatPickerDate(dateValue)}</Text>
      </Pressable>

      {Platform.OS === 'android' && open ? (
        <DateTimePicker
          value={dateValue}
          mode="date"
          display="default"
          maximumDate={maximumDate ? parseDateParam(maximumDate) : undefined}
          onChange={(event, selected) => {
            setOpen(false);
            if (event.type !== 'dismissed' && selected) commit(selected);
          }}
        />
      ) : null}

      {Platform.OS === 'ios' ? (
        <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
          <View style={styles.dateModalBackdrop}>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setOpen(false)} />
            <View style={styles.dateModalCard}>
              <View style={styles.dateModalHeader}>
                <Text style={styles.dateModalTitle}>{label}</Text>
                <Pressable onPress={() => setOpen(false)} hitSlop={8}>
                  <Text style={styles.dateModalDone}>Done</Text>
                </Pressable>
              </View>
              <DateTimePicker
                value={dateValue}
                mode="date"
                display="spinner"
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

function SortHeader({ label, active, direction, onPress, style }) {
  return (
    <Pressable style={[styles.sortHeader, style]} onPress={onPress} hitSlop={4}>
      <Text style={[styles.headerText, active && styles.headerTextActive]} numberOfLines={1}>
        {label}
        {active ? (direction === 'asc' ? ' ↑' : ' ↓') : ''}
      </Text>
    </Pressable>
  );
}

function compareValues(a, b, key, direction) {
  const dir = direction === 'asc' ? 1 : -1;
  const av = a[key];
  const bv = b[key];
  if (typeof av === 'number' && typeof bv === 'number') {
    return (av - bv) * dir;
  }
  return (
    String(av || '').localeCompare(String(bv || ''), undefined, {
      numeric: true,
      sensitivity: 'base',
    }) * dir
  );
}

function SearchField({ value, onChangeText, placeholder, accessibilityLabel }) {
  return (
    <View style={styles.searchField}>
      <Ionicons name="search" size={16} color={SECONDARY} />
      <TextInput
        style={styles.searchInput}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={SECONDARY}
        autoCorrect={false}
        autoCapitalize="none"
        clearButtonMode="while-editing"
        returnKeyType="search"
        accessibilityLabel={accessibilityLabel}
      />
      {value ? (
        <Pressable onPress={() => onChangeText('')} hitSlop={8} accessibilityLabel="Clear">
          <Ionicons name="close-circle" size={16} color={SECONDARY} />
        </Pressable>
      ) : null}
    </View>
  );
}

function TableScroller({ isMobile, children }) {
  if (!isMobile) {
    return <View style={styles.tableScrollerDesktop}>{children}</View>;
  }
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tableScroller}>
      <View style={styles.tableScrollerInner}>{children}</View>
    </ScrollView>
  );
}

export default function AccountingScreen({
  session,
  onRequireLogin,
  storeFilter,
  embedded = false,
}) {
  const isMobile = useIsMobile();
  const { canFilter } = useAppAccess();
  const allowFilters = canFilter('accounting');
  const [activeTab, setActiveTab] = useState('ledger');
  const [date, setDate] = useState(() => parseDateParam(new Date()));
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [query, setQuery] = useState('');
  const [ledgerSort, setLedgerSort] = useState({ key: 'dateLabel', direction: 'desc' });
  const [paymentSort, setPaymentSort] = useState({ key: 'dateLabel', direction: 'desc' });
  const [selectedStore, setSelectedStore] = useState(storeFilter || null);
  const [selectedPayment, setSelectedPayment] = useState(null);
  const [cancelRecords, setCancelRecords] = useState({});
  const requestId = useRef(0);

  const singleStore = Boolean(storeFilter);
  const dateKey = formatDateParam(date);
  const todayKey = formatDateParam(parseDateParam(new Date()));
  const isToday = dateKey === todayKey;

  const load = useCallback(async () => {
    if (!session?.token) {
      setRows([]);
      setError('');
      setWarning('');
      return;
    }

    const id = ++requestId.current;
    setLoading(true);
    setError('');
    setWarning('');

    try {
      const result = await fetchAllPayments(session, {
        date: dateKey,
        storeName: storeFilter || undefined,
      });
      if (id !== requestId.current) return;
      setRows(result.rows);
      setWarning(result.warning || '');
      if (storeFilter) setSelectedStore(storeFilter);
    } catch (err) {
      if (id !== requestId.current) return;
      setRows([]);
      setError(err?.message || 'Failed to load ledger.');
      setWarning('');
    } finally {
      if (id !== requestId.current) setLoading(false);
    }
  }, [session, dateKey, storeFilter]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (storeFilter) setSelectedStore(storeFilter);
  }, [storeFilter]);

  useEffect(() => {
    if (!allowFilters && !storeFilter) setSelectedStore(null);
  }, [allowFilters, storeFilter]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!session?.token || rows.length === 0) {
        if (!cancelled) setCancelRecords({});
        return;
      }
      try {
        const map = await fetchPaymentCancellations(rows.map((row) => row.id));
        if (!cancelled) setCancelRecords(map);
      } catch {
        if (!cancelled) setCancelRecords({});
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session?.token, rows]);

  const selectedCancelRecord = selectedPayment ? cancelRecords[selectedPayment.id] || null : null;

  const onCancelRecordChange = useCallback((next) => {
    if (!next?.paymentKey) return;
    setCancelRecords((current) => ({ ...current, [next.paymentKey]: next }));
  }, []);

  const storeNames = useMemo(() => {
    const names = new Set(rows.map((row) => row.storeName || '—'));
    return Array.from(names).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: 'base' }),
    );
  }, [rows]);

  const scopedRows = useMemo(() => {
    let result = rows;
    if (selectedStore && !singleStore) {
      result = result.filter(
        (row) =>
          row.storeName.localeCompare(selectedStore, undefined, {
            sensitivity: 'base',
          }) === 0,
      );
    }
    const q = query.trim().toLowerCase();
    if (q) {
      result = result.filter((row) => row.searchText.includes(q));
    }
    return result;
  }, [rows, selectedStore, singleStore, query]);

  const ledgerRows = useMemo(
    () =>
      [...scopedRows].sort((a, b) => compareValues(a, b, ledgerSort.key, ledgerSort.direction)),
    [scopedRows, ledgerSort],
  );

  const paymentRows = useMemo(
    () =>
      [...scopedRows].sort((a, b) => compareValues(a, b, paymentSort.key, paymentSort.direction)),
    [scopedRows, paymentSort],
  );

  const totals = useMemo(() => summarizeCashTotals(scopedRows), [scopedRows]);

  const toggleLedgerSort = (key) => {
    setLedgerSort((current) => {
      if (current.key === key) {
        return { key, direction: current.direction === 'asc' ? 'desc' : 'asc' };
      }
      return {
        key,
        direction: key === 'title' || key === 'paymentMethod' ? 'asc' : 'desc',
      };
    });
  };

  const togglePaymentSort = (key) => {
    setPaymentSort((current) => {
      if (current.key === key) {
        return { key, direction: current.direction === 'asc' ? 'desc' : 'asc' };
      }
      return {
        key,
        direction: key === 'storeName' || key === 'title' || key === 'paymentMethod' ? 'asc' : 'desc',
      };
    });
  };

  if (!session?.token) {
    return (
      <View style={[styles.body, embedded && styles.bodyEmbedded]}>
        <Text style={styles.hint}>
          Sign in to view accounting.{' '}
          {onRequireLogin ? (
            <Text style={styles.link} onPress={onRequireLogin}>
              Go to Profile
            </Text>
          ) : null}
        </Text>
      </View>
    );
  }

  const scopeLabel = [
    selectedStore && !singleStore ? selectedStore : singleStore ? storeFilter : 'All stores',
    isToday ? 'Today' : formatPickerDate(date),
    loading && rows.length === 0
      ? 'Loading…'
      : `${totals.count} entr${totals.count === 1 ? 'y' : 'ies'}`,
  ]
    .filter(Boolean)
    .join(' · ');

  const heroStats = [
    { key: 'in', icon: 'arrow-down-outline', label: 'In', value: formatAmount(totals.cashIn), tone: 'ok' },
    { key: 'out', icon: 'arrow-up-outline', label: 'Out', value: formatAmount(totals.cashOut), tone: 'warn' },
    {
      key: 'net',
      icon: 'calculator-outline',
      label: 'Net',
      value: formatAmount(totals.net),
      tone: totals.net >= 0 ? 'ok' : 'warn',
    },
  ];

  const ledgerColumns = [
    ...(!singleStore ? [{ key: 'storeName', label: 'Store' }] : []),
    ...LEDGER_SORT_KEYS.map((col) => ({ key: col.key, label: col.label })),
  ];

  const paymentColumns = PAYMENT_SORT_KEYS.filter(
    (col) => !(singleStore && col.key === 'storeName'),
  ).map((col) => ({ key: col.key, label: col.label }));

  const renderLedgerCell = (row, key) => {
    if (key === 'storeName') {
      return (
        <Text style={styles.cell} numberOfLines={1}>
          {row.storeName}
        </Text>
      );
    }
    if (key === 'dateLabel') {
      return (
        <Text style={styles.cellMuted} numberOfLines={1}>
          {row.dateLabel}
        </Text>
      );
    }
    if (key === 'title') {
      return (
        <Text style={styles.cell} numberOfLines={2}>
          {row.title}
        </Text>
      );
    }
    if (key === 'amount') {
      return (
        <Text
          style={[styles.cell, row.type === 'In' ? styles.cashIn : styles.cashOut]}
          numberOfLines={1}
        >
          {row.amountLabel}
        </Text>
      );
    }
    if (key === 'paymentMethod') {
      return (
        <Text style={styles.cell} numberOfLines={1}>
          {row.paymentMethod}
        </Text>
      );
    }
    if (key === 'inAmount') {
      return (
        <Text style={[styles.cell, row.inAmount ? styles.cashIn : styles.cellMuted]} numberOfLines={1}>
          {row.inLabel}
        </Text>
      );
    }
    if (key === 'outAmount') {
      return (
        <Text style={[styles.cell, row.outAmount ? styles.cashOut : styles.cellMuted]} numberOfLines={1}>
          {row.outLabel}
        </Text>
      );
    }
    return null;
  };

  const renderPaymentCell = (row, key) => {
    if (key === 'dateLabel') {
      return (
        <Text style={styles.cellMuted} numberOfLines={1}>
          {row.dateLabel}
        </Text>
      );
    }
    if (key === 'storeName') {
      return (
        <Text style={styles.cell} numberOfLines={1}>
          {row.storeName}
        </Text>
      );
    }
    if (key === 'title') {
      return (
        <Text style={styles.cell} numberOfLines={2}>
          {row.title}
        </Text>
      );
    }
    if (key === 'amount') {
      return (
        <Text
          style={[styles.cell, row.type === 'In' ? styles.cashIn : styles.cashOut]}
          numberOfLines={1}
        >
          {row.amountLabel}
        </Text>
      );
    }
    if (key === 'paymentMethod') {
      return (
        <Text style={styles.cell} numberOfLines={1}>
          {row.paymentMethod}
        </Text>
      );
    }
    if (key === 'checkNumber') {
      const cheque = row.checkNumber ? `#${row.checkNumber}` : '—';
      return (
        <Text style={[styles.cell, row.checkNumber ? styles.chequeNum : styles.cellMuted]} numberOfLines={1}>
          {cheque}
        </Text>
      );
    }
    return null;
  };

  return (
    <View style={[styles.body, embedded && styles.bodyEmbedded]}>
      <TabBar options={TABS} value={activeTab} onChange={setActiveTab} />

      <View style={[styles.pageHead, isMobile && styles.pageHeadMobile, embedded && styles.pageHeadEmbedded]}>
        {embedded ? null : (
          <View style={styles.pageHeadCopy}>
            <Text style={styles.pageTitle}>Accounting</Text>
            <Text style={styles.pageMeta} numberOfLines={2}>
              {scopeLabel}
            </Text>
          </View>
        )}
        <View style={[styles.heroStats, embedded && styles.heroStatsEmbedded, isMobile && styles.heroStatsMobile]}>
          {heroStats.map((row, index) => (
            <View
              key={row.key}
              style={[styles.heroStatRow, index === heroStats.length - 1 && styles.heroStatRowLast]}
            >
              <View style={styles.heroStatLead}>
                <Ionicons name={row.icon} size={15} color={SECONDARY} />
                <Text style={styles.heroStatLabel}>{row.label}</Text>
              </View>
              <Text
                style={[
                  styles.heroStatValue,
                  row.tone === 'ok' && styles.cashIn,
                  row.tone === 'warn' && styles.cashOut,
                ]}
                numberOfLines={1}
              >
                {row.value}
              </Text>
            </View>
          ))}
        </View>
      </View>

      <View style={styles.filters}>
        <View style={[styles.searchPair, !isMobile && styles.searchPairWide]}>
          {!embedded ? (
            <SearchField
              value={query}
              onChangeText={setQuery}
              placeholder="Search ledger…"
              accessibilityLabel="Search accounting ledger"
            />
          ) : null}
          <View style={styles.dateFilters}>
            <Pressable
              style={({ hovered, pressed }) => [
                styles.chip,
                isToday && styles.chipActive,
                (hovered || pressed) && !isToday && styles.chipHover,
              ]}
              onPress={() => setDate(parseDateParam(new Date()))}
              accessibilityRole="button"
              accessibilityState={{ selected: isToday }}
            >
              <Text style={[styles.chipText, isToday && styles.chipTextActive]}>Today</Text>
            </Pressable>
            <DateChip label="Date" value={date} onChange={setDate} maximumDate={new Date()} />
            <Pressable
              style={({ hovered, pressed }) => [styles.refresh, (hovered || pressed) && styles.chipHover]}
              onPress={load}
              hitSlop={8}
              accessibilityLabel="Refresh accounting"
            >
              {loading ? (
                <ActivityIndicator size="small" color={LABEL} />
              ) : (
                <Ionicons name="refresh" size={16} color={SECONDARY} />
              )}
            </Pressable>
          </View>
        </View>

        {allowFilters && !singleStore && storeNames.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
            <Pressable
              style={({ hovered, pressed }) => [
                styles.chip,
                !selectedStore && styles.chipActive,
                (hovered || pressed) && selectedStore && styles.chipHover,
              ]}
              onPress={() => setSelectedStore(null)}
            >
              <Text style={[styles.chipText, !selectedStore && styles.chipTextActive]}>All</Text>
            </Pressable>
            {storeNames.map((name) => (
              <Pressable
                key={name}
                style={({ hovered, pressed }) => [
                  styles.chip,
                  selectedStore === name && styles.chipActive,
                  (hovered || pressed) && selectedStore !== name && styles.chipHover,
                ]}
                onPress={() => setSelectedStore((current) => (current === name ? null : name))}
              >
                <Text
                  style={[styles.chipText, selectedStore === name && styles.chipTextActive]}
                  numberOfLines={1}
                >
                  {name}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}

        {embedded ? (
          <Text style={styles.pageMeta} numberOfLines={1}>
            {scopeLabel}
          </Text>
        ) : null}

        {error ? (
          <Pressable style={styles.banner} onPress={load}>
            <Text style={styles.errorText}>{error} · Tap to retry</Text>
          </Pressable>
        ) : null}
        {warning && !error ? <Text style={styles.warningText}>{warning}</Text> : null}
      </View>

      <ScrollView
        style={embedded ? styles.listEmbedded : styles.list}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
      >
        {activeTab === 'ledger' ? (
          <View style={styles.tableBlock}>
            <Text style={styles.tableBlockTitle}>Ledger · all stores</Text>
            <TableScroller isMobile={isMobile}>
              <View style={styles.tableCard}>
                <View style={[styles.row, styles.headerRow]}>
                  {ledgerColumns.map((col) => (
                    <SortHeader
                      key={col.key}
                      label={col.label}
                      active={ledgerSort.key === col.key}
                      direction={ledgerSort.direction}
                      onPress={() => toggleLedgerSort(col.key)}
                      style={styles.colCell}
                    />
                  ))}
                </View>

                {loading && rows.length === 0 ? (
                  <View style={styles.centered}>
                    <ActivityIndicator color={BLUE} />
                  </View>
                ) : ledgerRows.length === 0 ? (
                  <Text style={styles.emptyText}>No cleared payments for this date.</Text>
                ) : (
                  ledgerRows.map((row) => (
                    <Pressable
                      key={row.id}
                      style={({ pressed }) => [styles.row, styles.rowPressable, pressed && styles.rowPressed]}
                      onPress={() => setSelectedPayment(row)}
                      accessibilityRole="button"
                      accessibilityLabel={`Open payment ${row.title}`}
                    >
                      {ledgerColumns.map((col) => (
                        <View key={col.key} style={styles.colCell}>
                          {renderLedgerCell(row, col.key)}
                        </View>
                      ))}
                    </Pressable>
                  ))
                )}
              </View>
            </TableScroller>
          </View>
        ) : (
          <View style={styles.tableBlock}>
            <Text style={styles.tableBlockTitle}>Payments</Text>
            <TableScroller isMobile={isMobile}>
              <View style={styles.tableCard}>
                <View style={[styles.row, styles.headerRow]}>
                  {paymentColumns.map((col) => (
                    <SortHeader
                      key={col.key}
                      label={col.label}
                      active={paymentSort.key === col.key}
                      direction={paymentSort.direction}
                      onPress={() => togglePaymentSort(col.key)}
                      style={styles.colCell}
                    />
                  ))}
                </View>

                {loading && rows.length === 0 ? (
                  <View style={styles.centered}>
                    <ActivityIndicator color={BLUE} />
                  </View>
                ) : paymentRows.length === 0 ? (
                  <Text style={styles.emptyText}>No payments for this date.</Text>
                ) : (
                  paymentRows.map((row) => (
                    <Pressable
                      key={row.id}
                      style={({ pressed }) => [styles.row, styles.rowPressable, pressed && styles.rowPressed]}
                      onPress={() => setSelectedPayment(row)}
                      accessibilityRole="button"
                      accessibilityLabel={`Open payment ${row.title}`}
                    >
                      {paymentColumns.map((col) => (
                        <View key={col.key} style={styles.colCell}>
                          {renderPaymentCell(row, col.key)}
                        </View>
                      ))}
                    </Pressable>
                  ))
                )}
              </View>
            </TableScroller>
          </View>
        )}
      </ScrollView>

      <PaymentDetailModal
        payment={selectedPayment}
        record={selectedCancelRecord}
        session={session}
        onClose={() => setSelectedPayment(null)}
        onRecordChange={onCancelRecordChange}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    minHeight: 0,
    backgroundColor: CANVAS,
    paddingHorizontal: 16,
    paddingTop: 0,
  },
  bodyEmbedded: {
    backgroundColor: 'transparent',
    paddingHorizontal: 0,
    width: '100%',
    maxWidth: '100%',
  },
  tabBar: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'stretch',
    paddingHorizontal: 0,
    marginTop: 8,
    marginBottom: 4,
    width: '100%',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HAIRLINE,
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
    borderBottomColor: LABEL,
  },
  tabLabel: {
    fontFamily,
    fontSize: 13,
    fontWeight: '400',
    color: SECONDARY,
    letterSpacing: -0.08,
    textTransform: 'uppercase',
  },
  tabLabelActive: {
    color: LABEL,
    fontWeight: '600',
  },
  pageHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 24,
    paddingTop: 12,
    paddingBottom: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HEAD_RULE,
    marginBottom: 12,
  },
  pageHeadMobile: {
    flexDirection: 'column',
    gap: 16,
    paddingTop: 4,
  },
  pageHeadEmbedded: {
    paddingTop: 0,
    paddingBottom: 12,
    marginBottom: 8,
    borderBottomWidth: 0,
    justifyContent: 'flex-start',
  },
  pageHeadCopy: {
    flex: 1,
    minWidth: 0,
    gap: 6,
    paddingTop: 4,
  },
  pageTitle: {
    fontFamily: FONT_LIGHT,
    fontSize: 22,
    lineHeight: 26,
    fontWeight: '300',
    color: LABEL,
    letterSpacing: -0.3,
  },
  pageMeta: {
    fontFamily,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '400',
    color: SECONDARY,
    letterSpacing: -0.15,
  },
  heroStats: {
    width: 248,
    flexShrink: 0,
    borderRadius: NAV_TAB_ACTIVE_RADIUS,
    borderWidth: 1,
    borderColor: TAB_BORDER,
    backgroundColor: CANVAS,
    overflow: 'hidden',
    ...CHIP_SHADOW,
  },
  heroStatsEmbedded: {
    width: '100%',
    maxWidth: 320,
  },
  heroStatsMobile: {
    width: '100%',
    maxWidth: '100%',
  },
  heroStatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    minHeight: 32,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: RULE,
  },
  heroStatRowLast: {
    borderBottomWidth: 0,
  },
  heroStatLead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minWidth: 0,
    flexShrink: 1,
  },
  heroStatLabel: {
    fontFamily,
    fontSize: 14,
    fontWeight: '400',
    color: SECONDARY,
    letterSpacing: -0.2,
  },
  heroStatValue: {
    fontFamily,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '400',
    color: LABEL,
    letterSpacing: -0.2,
    fontVariant: ['tabular-nums'],
    textAlign: 'right',
    flexShrink: 0,
  },
  filters: {
    gap: 10,
    marginBottom: 12,
    flexShrink: 0,
  },
  searchPair: {
    gap: 8,
  },
  searchPairWide: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  searchField: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 32,
    minHeight: 32,
    paddingHorizontal: 10,
    borderRadius: NAV_TAB_ACTIVE_RADIUS,
    borderWidth: 1,
    borderColor: TAB_BORDER,
    backgroundColor: CANVAS,
    ...CHIP_SHADOW,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    height: 30,
    fontFamily,
    fontSize: 14,
    fontWeight: '400',
    color: LABEL,
    paddingVertical: 0,
    letterSpacing: -0.2,
    ...Platform.select({
      web: { outlineStyle: 'none' },
      default: {},
    }),
  },
  dateFilters: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
  },
  chipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingRight: 8,
  },
  chip: {
    minHeight: 36,
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderRadius: NAV_TAB_ACTIVE_RADIUS,
    borderWidth: 1,
    borderColor: 'transparent',
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  chipHover: {
    backgroundColor: '#f5f5f5',
  },
  chipActive: {
    borderColor: TAB_BORDER,
    backgroundColor: CANVAS,
    ...CHIP_SHADOW,
  },
  chipPressed: {
    opacity: 0.72,
  },
  chipText: {
    fontFamily,
    fontSize: 14,
    fontWeight: '400',
    color: LABEL,
    letterSpacing: -0.2,
  },
  chipTextActive: {
    color: LABEL,
    fontWeight: '600',
  },
  dateChip: {
    height: 32,
    paddingHorizontal: 10,
    borderRadius: NAV_TAB_ACTIVE_RADIUS,
    borderWidth: 1,
    borderColor: TAB_BORDER,
    backgroundColor: CANVAS,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    ...CHIP_SHADOW,
  },
  dateChipValue: {
    fontFamily,
    fontSize: 14,
    color: LABEL,
    letterSpacing: -0.2,
  },
  dateModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.28)',
    justifyContent: 'flex-end',
  },
  dateModalCard: {
    backgroundColor: CANVAS,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingBottom: 24,
  },
  dateModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 4,
  },
  dateModalTitle: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: LABEL,
  },
  dateModalDone: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: BLUE,
  },
  refresh: {
    width: 32,
    height: 32,
    borderRadius: NAV_TAB_ACTIVE_RADIUS,
    borderWidth: 1,
    borderColor: TAB_BORDER,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: CANVAS,
    ...CHIP_SHADOW,
  },
  banner: {
    paddingVertical: 2,
  },
  errorText: {
    fontFamily,
    fontSize: 13,
    color: '#FF3B30',
  },
  warningText: {
    fontFamily,
    fontSize: 13,
    color: AMBER,
  },
  hint: {
    fontFamily,
    fontSize: 15,
    color: SECONDARY,
    paddingTop: 24,
  },
  link: {
    color: BLUE,
    fontWeight: '600',
  },
  list: {
    flex: 1,
  },
  listEmbedded: {
    flex: 1,
    minHeight: 0,
    width: '100%',
    maxWidth: '100%',
  },
  listContent: {
    paddingBottom: 24,
  },
  tableBlock: {
    gap: 8,
  },
  tableBlockTitle: {
    fontFamily: FONT_LIGHT,
    fontSize: 16,
    fontWeight: '300',
    color: LABEL,
    letterSpacing: -0.2,
  },
  tableScroller: {
    flexGrow: 0,
  },
  tableScrollerDesktop: {
    width: '100%',
  },
  tableScrollerInner: {
    width: '100%',
  },
  tableCard: {
    backgroundColor: CANVAS,
    borderRadius: NAV_TAB_ACTIVE_RADIUS,
    borderWidth: 1,
    borderColor: TAB_BORDER,
    overflow: 'hidden',
    paddingHorizontal: 12,
    paddingTop: 4,
    paddingBottom: 4,
    ...CHIP_SHADOW,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    minHeight: 40,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: RULE,
  },
  rowPressable: {
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  rowPressed: {
    backgroundColor: '#f5f5f5',
  },
  colCell: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 6,
    justifyContent: 'center',
  },
  headerRow: {
    borderBottomColor: RULE,
    minHeight: 28,
  },
  sortHeader: {
    justifyContent: 'center',
    paddingVertical: 4,
  },
  headerText: {
    fontFamily,
    fontSize: 12,
    fontWeight: '400',
    color: SECONDARY,
    letterSpacing: -0.1,
    textAlign: 'left',
  },
  headerTextActive: {
    color: LABEL,
  },
  cell: {
    fontFamily: FONT_LIGHT,
    fontSize: 14,
    fontWeight: '400',
    color: LABEL,
    letterSpacing: -0.2,
    textAlign: 'left',
  },
  cellMuted: {
    fontFamily,
    fontSize: 13,
    color: SECONDARY,
    letterSpacing: -0.1,
    textAlign: 'left',
  },
  cashIn: {
    color: GREEN,
  },
  cashOut: {
    color: AMBER,
  },
  chequeNum: {
    fontWeight: '600',
    color: LABEL,
  },
  payModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.32)',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 24,
  },
  payModalCard: {
    alignSelf: 'center',
    width: '100%',
    maxWidth: 480,
    maxHeight: '90%',
    backgroundColor: CANVAS,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: TAB_BORDER,
    overflow: 'hidden',
    ...CHIP_SHADOW,
  },
  payModalHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: RULE,
  },
  payModalTitle: {
    flex: 1,
    fontFamily: FONT_LIGHT,
    fontSize: 18,
    fontWeight: '300',
    color: LABEL,
    letterSpacing: -0.25,
  },
  payModalScroll: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 20,
  },
  detailLine: {
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: RULE,
  },
  detailLabel: {
    fontFamily,
    fontSize: 11,
    fontWeight: '600',
    color: SECONDARY,
    textTransform: 'uppercase',
    letterSpacing: 0.2,
    marginBottom: 2,
  },
  detailValue: {
    fontFamily,
    fontSize: 14,
    color: LABEL,
    letterSpacing: -0.15,
  },
  cancelSection: {
    marginTop: 16,
    gap: 10,
  },
  cancelButtonWrap: {
    position: 'relative',
    alignSelf: 'stretch',
  },
  cancelPrimaryBtn: {
    minHeight: 44,
    borderRadius: NAV_TAB_ACTIVE_RADIUS,
    backgroundColor: LABEL,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 44,
    paddingVertical: 10,
  },
  cancelPrimaryBtnDisabled: {
    opacity: 0.7,
  },
  cancelPrimaryBtnText: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
    letterSpacing: -0.2,
  },
  cancelLedgerBtn: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 32,
    height: 32,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: TAB_BORDER,
    backgroundColor: CANVAS,
    alignItems: 'center',
    justifyContent: 'center',
    ...CHIP_SHADOW,
  },
  cancelledBadge: {
    minHeight: 44,
    borderRadius: NAV_TAB_ACTIVE_RADIUS,
    borderWidth: 1,
    borderColor: TAB_BORDER,
    backgroundColor: '#f5f5f5',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  cancelledBadgeText: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: LABEL,
  },
  timelineCard: {
    borderRadius: NAV_TAB_ACTIVE_RADIUS,
    borderWidth: 1,
    borderColor: TAB_BORDER,
    backgroundColor: '#fff',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 2,
  },
  timelineTitle: {
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
    color: SECONDARY,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  timelineRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: RULE,
  },
  timelineRowLast: {
    borderBottomWidth: 0,
  },
  timelineDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 5,
    backgroundColor: '#d1d1d6',
  },
  timelineDotDone: {
    backgroundColor: GREEN,
  },
  timelineDotPending: {
    backgroundColor: '#d1d1d6',
  },
  timelineCopy: {
    flex: 1,
    minWidth: 0,
  },
  timelineStepLabel: {
    fontFamily,
    fontSize: 14,
    color: LABEL,
    letterSpacing: -0.15,
  },
  timelineStepCurrent: {
    fontWeight: '600',
  },
  timelineMeta: {
    fontFamily,
    fontSize: 12,
    color: SECONDARY,
    marginTop: 2,
  },
  timelineMetaPending: {
    fontFamily,
    fontSize: 12,
    color: SECONDARY,
    fontStyle: 'italic',
    marginTop: 2,
  },
  noteBlock: {
    gap: 6,
  },
  noteLabel: {
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
    color: SECONDARY,
    textTransform: 'uppercase',
  },
  noteInput: {
    minHeight: 88,
    borderRadius: NAV_TAB_ACTIVE_RADIUS,
    borderWidth: 1,
    borderColor: TAB_BORDER,
    backgroundColor: '#fff',
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily,
    fontSize: 14,
    color: LABEL,
    textAlignVertical: 'top',
    ...Platform.select({
      web: { outlineStyle: 'none' },
      default: {},
    }),
  },
  noteSaving: {
    fontFamily,
    fontSize: 12,
    color: SECONDARY,
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 24,
  },
  emptyText: {
    fontFamily,
    fontSize: 15,
    color: SECONDARY,
    textAlign: 'center',
    paddingHorizontal: 12,
    paddingTop: 20,
    paddingBottom: 16,
  },
});
