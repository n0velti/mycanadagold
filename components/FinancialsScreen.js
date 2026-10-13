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
import { CANVAS, NAV_TAB_ACTIVE_BG, NAV_TAB_ACTIVE_RADIUS, useIsMobile } from '../lib/mobileUi';
import { useAppAccess } from '../lib/permissions';
import {
  fetchCashPayments,
  formatAmount,
  summarizeCashByStore,
  summarizeCashTotals,
} from '../lib/payments';
import { FONT_LIGHT } from '../lib/typography';
import {
  formatDateParam,
  formatPickerDate,
  parseDateParam,
} from '../lib/transactions';

const fontFamily = Platform.select({
  ios: 'Sohne',
  android: 'Sohne',
  default: 'Sohne',
});

const LABEL = '#1a1a1a';
const SECONDARY = '#8e8e93';
const TAB_BORDER = '#d0d0d0';
const RULE = 'rgba(42,38,30,0.08)';
const BLUE = '#007AFF';
const GREEN = '#34C759';
const AMBER = '#FF9F0A';
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

const STORE_SORT_KEYS = [
  { key: 'storeName', label: 'Store' },
  { key: 'cashIn', label: 'Cash in' },
  { key: 'cashOut', label: 'Cash out' },
  { key: 'net', label: 'Net' },
  { key: 'count', label: 'Txns' },
];

const TX_SORT_KEYS = [
  { key: 'storeName', label: 'Store' },
  { key: 'type', label: 'Type' },
  { key: 'amount', label: 'Amount' },
  { key: 'customerName', label: 'Customer' },
  { key: 'reference', label: 'Ref' },
];

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

function SortHeader({ label, active, direction, onPress, style, align = 'left' }) {
  return (
    <Pressable style={[styles.sortHeader, style]} onPress={onPress} hitSlop={4}>
      <Text
        style={[
          styles.headerText,
          align === 'right' && styles.headerTextRight,
          active && styles.headerTextActive,
        ]}
        numberOfLines={1}
      >
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

function SearchField({ value, onChangeText }) {
  return (
    <View style={styles.searchField}>
      <Ionicons name="search" size={16} color={SECONDARY} />
      <TextInput
        style={styles.searchInput}
        value={value}
        onChangeText={onChangeText}
        placeholder="Search cash…"
        placeholderTextColor={SECONDARY}
        autoCorrect={false}
        autoCapitalize="none"
        clearButtonMode="while-editing"
        returnKeyType="search"
        accessibilityLabel="Search cash payments"
      />
      {value ? (
        <Pressable onPress={() => onChangeText('')} hitSlop={8} accessibilityLabel="Clear">
          <Ionicons name="close-circle" size={16} color={SECONDARY} />
        </Pressable>
      ) : null}
    </View>
  );
}

export default function FinancialsScreen({
  session,
  onRequireLogin,
  storeFilter,
  embedded = false,
}) {
  const isMobile = useIsMobile();
  const { canFilter } = useAppAccess();
  const allowFilters = canFilter('financials');
  const [date, setDate] = useState(() => parseDateParam(new Date()));
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [query, setQuery] = useState('');
  const [storeSort, setStoreSort] = useState({ key: 'storeName', direction: 'asc' });
  const [txSort, setTxSort] = useState({ key: 'storeName', direction: 'asc' });
  const [selectedStore, setSelectedStore] = useState(storeFilter || null);
  const requestId = useRef(0);

  const singleStore = Boolean(storeFilter);
  const dateKey = formatDateParam(date);
  const todayKey = formatDateParam(parseDateParam(new Date()));
  const isToday = dateKey === todayKey;
  const ListContainer = ScrollView;
  const listProps = {
    style: embedded ? styles.listEmbedded : styles.list,
    contentContainerStyle: styles.listContent,
    showsVerticalScrollIndicator: false,
  };

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
      const result = await fetchCashPayments(session, {
        date: dateKey,
        storeName: storeFilter || undefined,
      });
      if (id !== requestId.current) return;
      setRows(result.rows);
      setWarning(result.warning || '');
      if (storeFilter) {
        setSelectedStore(storeFilter);
      }
    } catch (err) {
      if (id !== requestId.current) return;
      setRows([]);
      setError(err?.message || 'Failed to load cash payments.');
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

  const storeNames = useMemo(() => {
    const names = new Set(rows.map((row) => row.storeName || '—'));
    return Array.from(names).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: 'base' }),
    );
  }, [rows]);

  const filteredRows = useMemo(() => {
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
    return [...result].sort((a, b) => compareValues(a, b, txSort.key, txSort.direction));
  }, [rows, selectedStore, singleStore, query, txSort]);

  const storeSummaries = useMemo(() => {
    return [...summarizeCashByStore(rows)].sort((a, b) =>
      compareValues(a, b, storeSort.key, storeSort.direction),
    );
  }, [rows, storeSort]);

  const totals = useMemo(() => summarizeCashTotals(filteredRows), [filteredRows]);

  const toggleStoreSort = (key) => {
    setStoreSort((current) => {
      if (current.key === key) {
        return { key, direction: current.direction === 'asc' ? 'desc' : 'asc' };
      }
      return { key, direction: key === 'storeName' ? 'asc' : 'desc' };
    });
  };

  const toggleTxSort = (key) => {
    setTxSort((current) => {
      if (current.key === key) {
        return { key, direction: current.direction === 'asc' ? 'desc' : 'asc' };
      }
      return { key, direction: key === 'storeName' || key === 'customerName' ? 'asc' : 'desc' };
    });
  };

  if (!session?.token) {
    return (
      <View style={[styles.body, embedded && styles.bodyEmbedded]}>
        <Text style={styles.hint}>
          Sign in to view financials.{' '}
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
      : `${totals.count} payment${totals.count === 1 ? '' : 's'}`,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <View style={[styles.body, embedded && styles.bodyEmbedded]}>
      <View style={styles.filters}>
        <View style={[styles.searchPair, !isMobile && styles.searchPairWide]}>
          {!embedded ? (
            <SearchField value={query} onChangeText={setQuery} />
          ) : null}
          <View style={styles.dateFilters}>
            <Pressable
              style={({ pressed }) => [
                styles.chip,
                isToday && styles.chipActive,
                pressed && styles.chipPressed,
              ]}
              onPress={() => setDate(parseDateParam(new Date()))}
              accessibilityRole="button"
              accessibilityState={{ selected: isToday }}
            >
              <Text style={[styles.chipText, isToday && styles.chipTextActive]}>Today</Text>
            </Pressable>
            <DateChip label="Date" value={date} onChange={setDate} maximumDate={new Date()} />
            <Pressable
              style={({ pressed }) => [styles.refresh, pressed && styles.chipPressed]}
              onPress={load}
              hitSlop={8}
              accessibilityLabel="Refresh financials"
            >
              {loading ? (
                <ActivityIndicator size="small" color={BLUE} />
              ) : (
                <Ionicons name="refresh" size={16} color={SECONDARY} />
              )}
            </Pressable>
          </View>
        </View>

        {allowFilters && !singleStore && storeNames.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipRow}
          >
            <Pressable
              style={({ pressed }) => [
                styles.chip,
                !selectedStore && styles.chipActive,
                pressed && styles.chipPressed,
              ]}
              onPress={() => setSelectedStore(null)}
            >
              <Text style={[styles.chipText, !selectedStore && styles.chipTextActive]}>All</Text>
            </Pressable>
            {storeNames.map((name) => (
              <Pressable
                key={name}
                style={({ pressed }) => [
                  styles.chip,
                  selectedStore === name && styles.chipActive,
                  pressed && styles.chipPressed,
                ]}
                onPress={() =>
                  setSelectedStore((current) => (current === name ? null : name))
                }
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

        <Text style={styles.scopeLabel} numberOfLines={1}>
          {scopeLabel}
        </Text>

        {error ? (
          <Pressable style={styles.banner} onPress={load}>
            <Text style={styles.errorText}>{error} · Tap to retry</Text>
          </Pressable>
        ) : null}
        {warning && !error ? <Text style={styles.warningText}>{warning}</Text> : null}
      </View>

      <ListContainer {...listProps}>
        <View style={styles.section}>
          <View style={styles.summaryCards}>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryLabel}>Cash in</Text>
              <Text style={[styles.summaryValue, styles.cashIn]}>
                {formatAmount(totals.cashIn)}
              </Text>
              <Text style={styles.summaryHint}>{totals.inCount} received</Text>
            </View>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryLabel}>Cash out</Text>
              <Text style={[styles.summaryValue, styles.cashOut]}>
                {formatAmount(totals.cashOut)}
              </Text>
              <Text style={styles.summaryHint}>{totals.outCount} paid out</Text>
            </View>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryLabel}>Net</Text>
              <Text
                style={[
                  styles.summaryValue,
                  totals.net >= 0 ? styles.cashIn : styles.cashOut,
                ]}
              >
                {formatAmount(totals.net)}
              </Text>
              <Text style={styles.summaryHint}>
                {isToday ? 'Today' : formatPickerDate(date)}
              </Text>
            </View>
          </View>

          {!singleStore && storeSummaries.length > 0 ? (
            <View style={styles.tableCard}>
              <Text style={styles.tableBlockTitle}>By store</Text>
              <View style={[styles.row, styles.headerRow]}>
                {STORE_SORT_KEYS.map((col) => (
                  <SortHeader
                    key={col.key}
                    label={col.label}
                    active={storeSort.key === col.key}
                    direction={storeSort.direction}
                    onPress={() => toggleStoreSort(col.key)}
                    style={
                      col.key === 'storeName'
                        ? styles.colStore
                        : col.key === 'count'
                          ? styles.colCount
                          : styles.colAmount
                    }
                    align={col.key === 'storeName' ? 'left' : 'right'}
                  />
                ))}
              </View>
              {storeSummaries.map((entry) => (
                <Pressable
                  key={entry.storeName}
                  style={({ pressed }) => [
                    styles.row,
                    selectedStore === entry.storeName && styles.rowSelected,
                    pressed && styles.chipPressed,
                  ]}
                  onPress={() =>
                    setSelectedStore((current) =>
                      current === entry.storeName ? null : entry.storeName,
                    )
                  }
                >
                  <Text style={[styles.cell, styles.colStore]} numberOfLines={1}>
                    {entry.storeName}
                  </Text>
                  <Text style={[styles.cell, styles.colAmount, styles.cashIn]} numberOfLines={1}>
                    {formatAmount(entry.cashIn)}
                  </Text>
                  <Text style={[styles.cell, styles.colAmount, styles.cashOut]} numberOfLines={1}>
                    {formatAmount(entry.cashOut)}
                  </Text>
                  <Text
                    style={[
                      styles.cell,
                      styles.colAmount,
                      entry.net >= 0 ? styles.cashIn : styles.cashOut,
                    ]}
                    numberOfLines={1}
                  >
                    {formatAmount(entry.net)}
                  </Text>
                  <Text style={[styles.cellMuted, styles.colCount]} numberOfLines={1}>
                    {entry.count}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          <View style={styles.tableCard}>
            <Text style={styles.tableBlockTitle}>Cash transactions</Text>
            <View style={[styles.row, styles.headerRow]}>
              {TX_SORT_KEYS.filter((col) => !(singleStore && col.key === 'storeName')).map(
                (col) => (
                  <SortHeader
                    key={col.key}
                    label={col.label}
                    active={txSort.key === col.key}
                    direction={txSort.direction}
                    onPress={() => toggleTxSort(col.key)}
                    style={
                      col.key === 'storeName'
                        ? styles.colStore
                        : col.key === 'type'
                          ? styles.colType
                          : col.key === 'amount'
                            ? styles.colAmount
                            : col.key === 'customerName'
                              ? styles.colCustomer
                              : styles.colRef
                    }
                    align={col.key === 'amount' ? 'right' : 'left'}
                  />
                ),
              )}
            </View>

            {loading && rows.length === 0 ? (
              <View style={[styles.centered, embedded && styles.centeredEmbedded]}>
                <ActivityIndicator color={BLUE} />
              </View>
            ) : filteredRows.length === 0 ? (
              <Text style={styles.emptyText}>No cleared cash payments for this date.</Text>
            ) : (
              filteredRows.map((row) => (
                <View key={row.id} style={styles.row}>
                  {!singleStore ? (
                    <Text style={[styles.cell, styles.colStore]} numberOfLines={1}>
                      {row.storeName}
                    </Text>
                  ) : null}
                  <Text
                    style={[
                      styles.cell,
                      styles.colType,
                      row.type === 'In' ? styles.cashIn : styles.cashOut,
                    ]}
                    numberOfLines={1}
                  >
                    {row.directionLabel}
                  </Text>
                  <Text
                    style={[
                      styles.cell,
                      styles.colAmount,
                      row.type === 'In' ? styles.cashIn : styles.cashOut,
                    ]}
                    numberOfLines={1}
                  >
                    {row.amountLabel}
                  </Text>
                  <Text style={[styles.cell, styles.colCustomer]} numberOfLines={1}>
                    {row.customerName}
                  </Text>
                  <Text style={[styles.cellMuted, styles.colRef]} numberOfLines={1}>
                    {row.reference}
                  </Text>
                </View>
              ))
            )}
          </View>
        </View>
      </ListContainer>
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    minHeight: 0,
    backgroundColor: CANVAS,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  bodyEmbedded: {
    backgroundColor: 'transparent',
    paddingHorizontal: 0,
    paddingTop: 0,
    width: '100%',
    maxWidth: '100%',
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
    gap: 8,
    paddingRight: 8,
  },
  chip: {
    height: 32,
    paddingHorizontal: 10,
    borderRadius: NAV_TAB_ACTIVE_RADIUS,
    borderWidth: 1,
    borderColor: TAB_BORDER,
    backgroundColor: CANVAS,
    alignItems: 'center',
    justifyContent: 'center',
    ...CHIP_SHADOW,
  },
  chipActive: {
    backgroundColor: NAV_TAB_ACTIVE_BG,
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
    fontWeight: '400',
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
  scopeLabel: {
    fontFamily: FONT_LIGHT,
    fontSize: 16,
    fontWeight: '300',
    color: LABEL,
    letterSpacing: -0.2,
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
  section: {
    gap: 12,
  },
  summaryCards: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  summaryCard: {
    flexGrow: 1,
    flexBasis: 120,
    minWidth: 110,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: NAV_TAB_ACTIVE_RADIUS,
    backgroundColor: CANVAS,
    borderWidth: 1,
    borderColor: TAB_BORDER,
    ...CHIP_SHADOW,
  },
  summaryLabel: {
    fontFamily,
    fontSize: 12,
    fontWeight: '400',
    color: SECONDARY,
    letterSpacing: -0.1,
    marginBottom: 4,
  },
  summaryValue: {
    fontFamily: FONT_LIGHT,
    fontSize: 22,
    fontWeight: '300',
    color: LABEL,
    letterSpacing: -0.4,
    fontVariant: ['tabular-nums'],
  },
  summaryHint: {
    fontFamily,
    fontSize: 12,
    color: SECONDARY,
    marginTop: 4,
    letterSpacing: -0.1,
  },
  cashIn: {
    color: GREEN,
  },
  cashOut: {
    color: AMBER,
  },
  tableCard: {
    backgroundColor: CANVAS,
    borderRadius: NAV_TAB_ACTIVE_RADIUS,
    borderWidth: 1,
    borderColor: TAB_BORDER,
    overflow: 'hidden',
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 4,
    ...CHIP_SHADOW,
  },
  tableBlockTitle: {
    fontFamily,
    fontSize: 12,
    fontWeight: '400',
    color: SECONDARY,
    letterSpacing: -0.1,
    marginBottom: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    minHeight: 40,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: RULE,
  },
  rowSelected: {
    backgroundColor: NAV_TAB_ACTIVE_BG,
    marginHorizontal: -12,
    paddingHorizontal: 12,
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
  },
  headerTextRight: {
    textAlign: 'right',
  },
  headerTextActive: {
    color: LABEL,
  },
  cell: {
    fontFamily: FONT_LIGHT,
    fontSize: 14,
    fontWeight: '400',
    color: LABEL,
    paddingRight: 8,
    letterSpacing: -0.2,
  },
  cellMuted: {
    fontFamily,
    fontSize: 13,
    color: SECONDARY,
    paddingRight: 8,
    letterSpacing: -0.1,
  },
  colStore: {
    flex: 1.2,
    minWidth: 0,
  },
  colType: {
    flex: 0.9,
    minWidth: 0,
  },
  colAmount: {
    flex: 1,
    minWidth: 0,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  colCustomer: {
    flex: 1.4,
    minWidth: 0,
  },
  colRef: {
    flex: 1,
    minWidth: 0,
  },
  colCount: {
    flex: 0.55,
    minWidth: 0,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 24,
  },
  centeredEmbedded: {
    minHeight: 80,
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
