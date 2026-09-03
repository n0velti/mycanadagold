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
import {
  fetchCashPayments,
  formatAmount,
  summarizeCashByStore,
  summarizeCashTotals,
} from '../api/payments';
import {
  formatDateParam,
  formatPickerDate,
  parseDateParam,
} from '../api/transactions';

const fontFamily = Platform.select({
  ios: 'Sohne',
  android: 'Sohne',
  default: 'Sohne',
});

const ACCENT = '#3D8B4F';

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
        <Text style={styles.dateChipLabel}>{label}</Text>
        <View style={styles.dateChipControl}>
          <Ionicons name="calendar-outline" size={14} color="#6b6b6b" />
          {createElement('input', {
            type: 'date',
            value: formatDateParam(dateValue),
            max: maximumDate ? formatDateParam(maximumDate) : undefined,
            onChange: (event) => {
              if (event.target.value) commit(event.target.value);
            },
            style: {
              border: 'none',
              background: 'transparent',
              fontFamily,
              fontSize: 13,
              color: '#1a1a1a',
              padding: 0,
              margin: 0,
              outline: 'none',
              cursor: 'pointer',
              minWidth: 118,
            },
          })}
        </View>
      </View>
    );
  }

  return (
    <>
      <Pressable style={styles.dateChip} onPress={() => setOpen(true)}>
        <Text style={styles.dateChipLabel}>{label}</Text>
        <View style={styles.dateChipControl}>
          <Ionicons name="calendar-outline" size={14} color="#6b6b6b" />
          <Text style={styles.dateChipValue}>{formatPickerDate(dateValue)}</Text>
        </View>
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

export default function FinancialsScreen({
  session,
  onRequireLogin,
  storeFilter,
  embedded = false,
}) {
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
      if (id === requestId.current) setLoading(false);
    }
  }, [session, dateKey, storeFilter]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (storeFilter) setSelectedStore(storeFilter);
  }, [storeFilter]);

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
      <View style={styles.body}>
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

  return (
    <View style={[styles.body, embedded && styles.bodyEmbedded]}>
      <View style={styles.toolbar}>
        {!embedded ? (
          <View style={styles.search}>
            <Ionicons name="search-outline" size={14} color="#8a8a8a" />
            <TextInput
              style={styles.searchInput}
              value={query}
              onChangeText={setQuery}
              placeholder="Search cash…"
              placeholderTextColor="#9a9a9a"
              autoCorrect={false}
              autoCapitalize="none"
              clearButtonMode="while-editing"
            />
          </View>
        ) : null}

        <View style={styles.dateFilters}>
          <Pressable
            style={[styles.todayChip, isToday && styles.todayChipActive]}
            onPress={() => setDate(parseDateParam(new Date()))}
          >
            <Text style={[styles.todayChipText, isToday && styles.todayChipTextActive]}>
              Today
            </Text>
          </Pressable>
          <DateChip label="Date" value={date} onChange={setDate} maximumDate={new Date()} />
        </View>

        <Pressable style={styles.refresh} onPress={load} hitSlop={8}>
          {loading ? (
            <ActivityIndicator size="small" color={ACCENT} />
          ) : (
            <Ionicons name="refresh" size={16} color="#8a8a8a" />
          )}
        </Pressable>
      </View>

      {error ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}
      {warning ? <Text style={styles.warningText}>{warning}</Text> : null}

      <ListContainer {...listProps}>
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Cash</Text>
            <Text style={styles.sectionMeta}>
              {loading && rows.length === 0
                ? 'Loading…'
                : `${totals.count} payment${totals.count === 1 ? '' : 's'} · ${formatAmount(totals.cashIn)} in · ${formatAmount(totals.cashOut)} out`}
            </Text>
          </View>

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

          {!singleStore ? (
            <View style={styles.storeFilterRow}>
              <Pressable
                style={[styles.storeChip, !selectedStore && styles.storeChipActive]}
                onPress={() => setSelectedStore(null)}
              >
                <Text
                  style={[
                    styles.storeChipText,
                    !selectedStore && styles.storeChipTextActive,
                  ]}
                >
                  All stores
                </Text>
              </Pressable>
              {storeNames.map((name) => (
                <Pressable
                  key={name}
                  style={[
                    styles.storeChip,
                    selectedStore === name && styles.storeChipActive,
                  ]}
                  onPress={() =>
                    setSelectedStore((current) => (current === name ? null : name))
                  }
                >
                  <Text
                    style={[
                      styles.storeChipText,
                      selectedStore === name && styles.storeChipTextActive,
                    ]}
                  >
                    {name}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          {!singleStore && storeSummaries.length > 0 ? (
            <View style={styles.tableBlock}>
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
                  style={[
                    styles.row,
                    selectedStore === entry.storeName && styles.rowSelected,
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
                  <Text style={[styles.cell, styles.colCount]} numberOfLines={1}>
                    {entry.count}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          <View style={styles.tableBlock}>
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
                <ActivityIndicator color={ACCENT} />
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
                  <Text style={[styles.cell, styles.colRef]} numberOfLines={1}>
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
  },
  bodyEmbedded: {
    flex: 1,
    minHeight: 0,
    width: '100%',
    maxWidth: '100%',
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 12,
    width: '100%',
  },
  search: {
    flex: 1,
    minWidth: 160,
    maxWidth: 280,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e0e0e0',
    paddingBottom: 6,
  },
  searchInput: {
    flex: 1,
    fontFamily,
    fontSize: 14,
    color: '#1a1a1a',
    paddingVertical: 0,
    ...Platform.select({
      web: { outlineStyle: 'none' },
      default: {},
    }),
  },
  dateFilters: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  todayChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#f3f3f3',
    minHeight: 34,
    justifyContent: 'center',
  },
  todayChipActive: {
    backgroundColor: '#E8F5EA',
  },
  todayChipText: {
    fontFamily,
    fontSize: 13,
    fontWeight: '500',
    color: '#6b6b6b',
  },
  todayChipTextActive: {
    color: ACCENT,
    fontWeight: '600',
  },
  dateChip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e0e0e0',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: '#fff',
    minHeight: 40,
    justifyContent: 'center',
    gap: 2,
  },
  dateChipLabel: {
    fontFamily,
    fontSize: 10,
    fontWeight: '600',
    color: '#8a8a8a',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  dateChipControl: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dateChipValue: {
    fontFamily,
    fontSize: 13,
    color: '#1a1a1a',
    fontWeight: '500',
  },
  dateModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.28)',
    justifyContent: 'flex-end',
  },
  dateModalCard: {
    backgroundColor: '#fff',
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
    color: '#1a1a1a',
  },
  dateModalDone: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: ACCENT,
  },
  refresh: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorBanner: {
    marginBottom: 10,
  },
  errorText: {
    fontFamily,
    fontSize: 13,
    color: '#991B1B',
  },
  warningText: {
    fontFamily,
    fontSize: 12,
    color: '#9a6b2f',
    marginBottom: 8,
  },
  hint: {
    fontFamily,
    fontSize: 14,
    color: '#6b6b6b',
  },
  link: {
    color: ACCENT,
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
    gap: 14,
  },
  sectionHeader: {
    gap: 2,
  },
  sectionTitle: {
    fontFamily,
    fontSize: 18,
    fontWeight: '700',
    color: '#1a1a1a',
  },
  sectionMeta: {
    fontFamily,
    fontSize: 12,
    color: '#8a8a8a',
  },
  summaryCards: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  summaryCard: {
    flexGrow: 1,
    flexBasis: 120,
    minWidth: 110,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: '#F7FAF7',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#E3EDE4',
  },
  summaryLabel: {
    fontFamily,
    fontSize: 11,
    fontWeight: '600',
    color: '#8a8a8a',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 4,
  },
  summaryValue: {
    fontFamily,
    fontSize: 18,
    fontWeight: '700',
    color: '#1a1a1a',
    fontVariant: ['tabular-nums'],
  },
  summaryHint: {
    fontFamily,
    fontSize: 12,
    color: '#8a8a8a',
    marginTop: 2,
  },
  cashIn: {
    color: '#2F8A4E',
  },
  cashOut: {
    color: '#B45309',
  },
  storeFilterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  storeChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#f3f3f3',
  },
  storeChipActive: {
    backgroundColor: '#E8F5EA',
  },
  storeChipText: {
    fontFamily,
    fontSize: 12,
    fontWeight: '500',
    color: '#6b6b6b',
  },
  storeChipTextActive: {
    color: ACCENT,
    fontWeight: '600',
  },
  tableBlock: {
    marginTop: 4,
  },
  tableBlockTitle: {
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
    color: '#8a8a8a',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    minHeight: 36,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f0f0f0',
  },
  rowSelected: {
    backgroundColor: '#F0F8EE',
  },
  headerRow: {
    borderBottomColor: '#e5e5e5',
    marginBottom: 2,
    minHeight: 28,
  },
  sortHeader: {
    justifyContent: 'center',
    paddingVertical: 4,
  },
  headerText: {
    fontFamily,
    fontSize: 11,
    fontWeight: '600',
    color: '#9a9a9a',
    letterSpacing: 0.2,
  },
  headerTextRight: {
    textAlign: 'right',
  },
  headerTextActive: {
    color: ACCENT,
  },
  cell: {
    fontFamily,
    fontSize: 13,
    color: '#1a1a1a',
    paddingRight: 8,
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
    fontSize: 13,
    color: '#8a8a8a',
    paddingTop: 16,
    paddingBottom: 8,
  },
});
