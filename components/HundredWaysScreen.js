import { createElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { fetchPremiumJewelryByStore } from '../lib/premiumJewelry';
import {
  defaultDateRange,
  formatDateParam,
  formatPickerDate,
  parseDateParam,
} from '../lib/transactions';

const fontFamily = Platform.select({
  ios: 'Sohne',
  android: 'Sohne',
  default: 'Sohne',
});

const ACCENT = '#0369A1';

function DateChip({ label, value, onChange, minimumDate, maximumDate }) {
  const [open, setOpen] = useState(false);
  const dateValue = parseDateParam(value);

  const commit = (next) => {
    if (!next) return;
    let date = parseDateParam(next);
    if (minimumDate && date < parseDateParam(minimumDate)) {
      date = parseDateParam(minimumDate);
    }
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
            min: minimumDate ? formatDateParam(minimumDate) : undefined,
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

function StoreDetailDrawer({ visible, store, onClose }) {
  if (!visible || !store) return null;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.drawerBackdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.drawerCard}>
          <View style={styles.drawerHeader}>
            <View style={styles.drawerTitleBlock}>
              <Text style={styles.drawerTitle}>{store.store}</Text>
              <Text style={styles.drawerSubtitle}>
                {store.premiumTxCount} Premium purchase
                {store.premiumTxCount === 1 ? '' : 's'} · {store.percentLabel} of{' '}
                {store.totalTxCount} txs
              </Text>
            </View>
            <Pressable onPress={onClose} hitSlop={8} style={styles.drawerClose}>
              <Ionicons name="close" size={20} color="#1a1a1a" />
            </Pressable>
          </View>

          <ScrollView
            style={styles.drawerScroll}
            contentContainerStyle={styles.drawerScrollContent}
            showsVerticalScrollIndicator={false}
          >
            {store.transactions.length === 0 ? (
              <Text style={styles.emptyText}>No Premium Jewelry purchases in this period.</Text>
            ) : (
              store.transactions.map((tx) => (
                <View key={tx.id} style={styles.txRow}>
                  <View style={styles.txRowMain}>
                    <Text style={styles.txRef}>{tx.reference}</Text>
                    <Text style={styles.txBuyer} numberOfLines={1}>
                      Buyer: {tx.employeeName || '—'}
                    </Text>
                    <Text style={styles.txMeta}>
                      {tx.dateLabel} · {tx.customerName || '—'}
                    </Text>
                    {tx.premiumItemNames?.length ? (
                      <Text style={styles.txItems} numberOfLines={3}>
                        {tx.premiumItemNames.join(' · ')}
                      </Text>
                    ) : null}
                  </View>
                  <View style={styles.txRowSide}>
                    <Text style={styles.txAmount}>{tx.amountLabel}</Text>
                    <Text style={styles.txItemCount}>
                      {tx.premiumItemCount} item{tx.premiumItemCount === 1 ? '' : 's'}
                    </Text>
                  </View>
                </View>
              ))
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

export default function HundredWaysScreen({ session, onRequireLogin }) {
  const initialRange = useMemo(() => defaultDateRange(7), []);
  const [dateMode, setDateMode] = useState('day');
  const [startDate, setStartDate] = useState(() => parseDateParam(new Date()));
  const [endDate, setEndDate] = useState(() => parseDateParam(new Date()));
  const [rows, setRows] = useState([]);
  const [totals, setTotals] = useState(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [selectedStore, setSelectedStore] = useState(null);
  const requestId = useRef(0);

  const todayKey = formatDateParam(parseDateParam(new Date()));
  const startKey = formatDateParam(startDate);
  const endKey = dateMode === 'day' ? startKey : formatDateParam(endDate);
  const isToday = dateMode === 'day' && startKey === todayKey;

  const load = useCallback(async () => {
    if (!session?.token) {
      setRows([]);
      setTotals(null);
      setError('');
      setWarning('');
      setProgress(null);
      setSelectedStore(null);
      return;
    }

    const id = ++requestId.current;
    setLoading(true);
    setError('');
    setWarning('');
    setProgress({ scanned: 0, total: 0 });
    setRows([]);
    setTotals(null);
    setSelectedStore(null);

    try {
      const result = await fetchPremiumJewelryByStore(session, {
        startDate: startKey,
        endDate: endKey,
        onProgress: (next) => {
          if (id !== requestId.current) return;
          setProgress(next);
        },
        onPartial: (partial) => {
          if (id !== requestId.current) return;
          setRows(partial.rows);
          setTotals(partial.totals);
          setWarning(partial.warning || '');
          setSelectedStore((current) => {
            if (!current) return null;
            return partial.rows.find((row) => row.store === current.store) || current;
          });
        },
      });
      if (id !== requestId.current) return;
      setRows(result.rows);
      setTotals(result.totals);
      setWarning(result.warning || '');
    } catch (err) {
      if (id !== requestId.current) return;
      setRows([]);
      setTotals(null);
      setError(err?.message || 'Failed to load Premium Jewelry stats.');
    } finally {
      if (id === requestId.current) {
        setLoading(false);
        setProgress(null);
      }
    }
  }, [session, startKey, endKey]);

  useEffect(() => {
    load();
  }, [load]);

  const selectToday = () => {
    const day = parseDateParam(new Date());
    setDateMode('day');
    setStartDate(day);
    setEndDate(day);
  };

  const selectRange = () => {
    setDateMode('range');
    if (formatDateParam(startDate) === formatDateParam(endDate)) {
      setStartDate(initialRange.start);
      setEndDate(initialRange.end);
    }
  };

  const handleDayChange = (date) => {
    const next = parseDateParam(date);
    setStartDate(next);
    setEndDate(next);
  };

  const handleStartChange = (date) => {
    const next = parseDateParam(date);
    setStartDate(next);
    if (next > endDate) setEndDate(next);
  };

  const handleEndChange = (date) => {
    const next = parseDateParam(date);
    setEndDate(next);
    if (next < startDate) setStartDate(next);
  };

  if (!session?.token) {
    return (
      <View style={styles.body}>
        <Text style={styles.loginHint}>
          Sign in from Profile to load Premium Jewelry purchases by store.
        </Text>
        <Pressable style={styles.loginButton} onPress={onRequireLogin}>
          <Text style={styles.loginButtonText}>Go to Profile</Text>
        </Pressable>
      </View>
    );
  }

  const progressLabel =
    loading && progress && progress.total > 0
      ? `Scanning purchases ${progress.scanned}/${progress.total}…`
      : loading
        ? 'Loading stores & transactions…'
        : null;

  return (
    <View style={styles.body}>
      <View style={styles.toolbar}>
        <View style={styles.dateFilters}>
          <View style={styles.dateModeGroup}>
            <Pressable
              style={[styles.dateModeChip, dateMode === 'day' && isToday && styles.dateModeChipActive]}
              onPress={selectToday}
            >
              <Text
                style={[
                  styles.dateModeChipText,
                  dateMode === 'day' && isToday && styles.dateModeChipTextActive,
                ]}
              >
                Today
              </Text>
            </Pressable>
            <Pressable
              style={[styles.dateModeChip, dateMode === 'range' && styles.dateModeChipActive]}
              onPress={selectRange}
            >
              <Text
                style={[
                  styles.dateModeChipText,
                  dateMode === 'range' && styles.dateModeChipTextActive,
                ]}
              >
                Range
              </Text>
            </Pressable>
          </View>

          {dateMode === 'day' ? (
            <DateChip
              label="Date"
              value={startDate}
              onChange={handleDayChange}
              maximumDate={new Date()}
            />
          ) : (
            <>
              <DateChip
                label="From"
                value={startDate}
                onChange={handleStartChange}
                maximumDate={endDate}
              />
              <Text style={styles.dateRangeSep}>–</Text>
              <DateChip
                label="To"
                value={endDate}
                onChange={handleEndChange}
                minimumDate={startDate}
                maximumDate={new Date()}
              />
            </>
          )}
        </View>
      </View>

      <View style={styles.metaRow}>
        <Text style={styles.metaText}>
          {progressLabel ||
            (totals
              ? `${totals.storeCount} store${totals.storeCount === 1 ? '' : 's'} · ${totals.premiumTxCount} Premium · ${totals.percentLabel} of ${totals.totalTxCount} txs`
              : '—')}
          {dateMode === 'day'
            ? isToday
              ? ' · today'
              : ` · ${formatPickerDate(startDate)}`
            : ` · ${formatPickerDate(startDate)} – ${formatPickerDate(endDate)}`}
        </Text>
      </View>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      {warning && !error ? <Text style={styles.warningText}>{warning}</Text> : null}

      <View style={styles.tableWrap}>
        <View style={styles.tableHeader}>
          <Text style={[styles.headerCell, styles.colStore]}>Store</Text>
          <Text style={[styles.headerCell, styles.colPremium]}>Premium</Text>
          <Text style={[styles.headerCell, styles.colTotal]}>Total txs</Text>
          <Text style={[styles.headerCell, styles.colPct]}>% of txs</Text>
        </View>

        {!loading && rows.length === 0 ? (
          <View style={styles.tableEmpty}>
            <Text style={styles.emptyText}>No stores found for this period.</Text>
          </View>
        ) : loading && rows.length === 0 ? (
          <View style={styles.tableEmpty}>
            <ActivityIndicator color={ACCENT} />
            {progressLabel ? <Text style={styles.progressHint}>{progressLabel}</Text> : null}
          </View>
        ) : (
          <ScrollView
            style={styles.tableScroll}
            contentContainerStyle={styles.tableScrollContent}
            showsVerticalScrollIndicator={false}
          >
            {rows.map((row) => {
              const selected = selectedStore?.store === row.store;
              return (
                <Pressable
                  key={row.store}
                  onPress={() => setSelectedStore(row)}
                  style={({ hovered, pressed }) => [
                    styles.tableRow,
                    !selected && (hovered || pressed) && styles.tableRowHover,
                    selected && styles.tableRowSelected,
                  ]}
                  {...(Platform.OS === 'web'
                    ? {
                        className: selected
                          ? 'cgold-tx-row cgold-tx-row-selected'
                          : 'cgold-tx-row',
                      }
                    : null)}
                >
                  <Text style={styles.cellStore} numberOfLines={1}>
                    {row.store}
                  </Text>
                  <View style={styles.colPremium}>
                    <Text style={styles.cellPrimary} numberOfLines={1}>
                      {row.premiumTxCount}
                    </Text>
                    {row.premiumItemCount > 0 ? (
                      <Text style={styles.cellSecondary} numberOfLines={1}>
                        {row.premiumItemCount} item{row.premiumItemCount === 1 ? '' : 's'}
                      </Text>
                    ) : null}
                  </View>
                  <Text style={styles.cellTotal} numberOfLines={1}>
                    {row.totalTxCount}
                  </Text>
                  <Text
                    style={[
                      styles.cellPct,
                      row.premiumTxCount > 0 && styles.cellPctActive,
                    ]}
                    numberOfLines={1}
                  >
                    {row.percentLabel}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        )}
      </View>

      <StoreDetailDrawer
        visible={Boolean(selectedStore)}
        store={selectedStore}
        onClose={() => setSelectedStore(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    minHeight: 0,
  },
  loginHint: {
    fontFamily,
    fontSize: 14,
    color: '#6b6b6b',
    marginBottom: 12,
  },
  loginButton: {
    alignSelf: 'flex-start',
    backgroundColor: '#1a1a1a',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
  },
  loginButtonText: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: '#fff',
  },
  toolbar: {
    marginBottom: 10,
  },
  dateFilters: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  dateModeGroup: {
    flexDirection: 'row',
    backgroundColor: '#f3f3f3',
    borderRadius: 8,
    padding: 2,
  },
  dateModeChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 6,
    minHeight: 30,
    justifyContent: 'center',
  },
  dateModeChipActive: {
    backgroundColor: '#E0F2FE',
  },
  dateModeChipText: {
    fontFamily,
    fontSize: 13,
    fontWeight: '500',
    color: '#6b6b6b',
  },
  dateModeChipTextActive: {
    color: ACCENT,
    fontWeight: '600',
  },
  dateRangeSep: {
    fontFamily,
    fontSize: 14,
    color: '#8a8a8a',
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
  metaRow: {
    marginBottom: 8,
  },
  metaText: {
    fontFamily,
    fontSize: 12,
    color: '#8a8a8a',
  },
  errorText: {
    fontFamily,
    fontSize: 13,
    color: '#b91c1c',
    marginBottom: 8,
  },
  warningText: {
    fontFamily,
    fontSize: 12,
    color: '#a16207',
    marginBottom: 8,
  },
  tableWrap: {
    flex: 1,
    minHeight: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e8e8e8',
  },
  tableHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e8e8e8',
  },
  headerCell: {
    fontFamily,
    fontSize: 11,
    fontWeight: '600',
    color: '#8a8a8a',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  tableScroll: {
    flex: 1,
  },
  tableScrollContent: {
    paddingBottom: 24,
  },
  tableEmpty: {
    paddingVertical: 40,
    alignItems: 'center',
    gap: 10,
  },
  progressHint: {
    fontFamily,
    fontSize: 12,
    color: '#8a8a8a',
  },
  emptyText: {
    fontFamily,
    fontSize: 13,
    color: '#8a8a8a',
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 9,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f0f0f0',
    minHeight: 40,
  },
  tableRowHover: {
    backgroundColor: '#ececec',
  },
  tableRowSelected: {
    backgroundColor: '#e4e4e4',
  },
  colStore: {
    flex: 1.4,
    minWidth: 0,
    paddingRight: 8,
  },
  colPremium: {
    width: 88,
    paddingRight: 8,
  },
  colTotal: {
    width: 72,
    textAlign: 'right',
    paddingRight: 8,
  },
  colPct: {
    width: 72,
    textAlign: 'right',
  },
  cellStore: {
    flex: 1.4,
    minWidth: 0,
    paddingRight: 8,
    fontFamily,
    fontSize: 13,
    fontWeight: '500',
    color: '#1a1a1a',
  },
  cellPrimary: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  cellSecondary: {
    fontFamily,
    fontSize: 11,
    color: '#8a8a8a',
    marginTop: 1,
  },
  cellTotal: {
    width: 72,
    textAlign: 'right',
    paddingRight: 8,
    fontFamily,
    fontSize: 13,
    color: '#4a4a4a',
  },
  cellPct: {
    width: 72,
    textAlign: 'right',
    fontFamily,
    fontSize: 13,
    fontWeight: '500',
    color: '#8a8a8a',
  },
  cellPctActive: {
    color: ACCENT,
    fontWeight: '600',
  },
  drawerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.28)',
    justifyContent: 'flex-end',
  },
  drawerCard: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: '78%',
    minHeight: 280,
  },
  drawerHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e8e8e8',
    gap: 12,
  },
  drawerTitleBlock: {
    flex: 1,
    minWidth: 0,
  },
  drawerTitle: {
    fontFamily,
    fontSize: 17,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  drawerSubtitle: {
    fontFamily,
    fontSize: 12,
    color: '#8a8a8a',
    marginTop: 4,
  },
  drawerClose: {
    padding: 4,
  },
  drawerScroll: {
    flexGrow: 0,
  },
  drawerScrollContent: {
    padding: 16,
    paddingBottom: 28,
    gap: 10,
  },
  txRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f0f0f0',
  },
  txRowMain: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  txRef: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  txBuyer: {
    fontFamily,
    fontSize: 13,
    fontWeight: '500',
    color: '#1a1a1a',
  },
  txMeta: {
    fontFamily,
    fontSize: 12,
    color: '#6b6b6b',
  },
  txItems: {
    fontFamily,
    fontSize: 12,
    color: ACCENT,
    marginTop: 2,
  },
  txRowSide: {
    alignItems: 'flex-end',
    gap: 2,
  },
  txAmount: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  txItemCount: {
    fontFamily,
    fontSize: 11,
    color: '#8a8a8a',
  },
});
