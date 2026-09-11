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
import { fetchTransferStores } from '../lib/locations';
import {
  canManageMonerisTerminals,
  deleteMonerisTerminal,
  environmentLabel,
  listMonerisTerminals,
  listMonerisTransactions,
  MONERIS_ENVIRONMENTS,
  saveMonerisTerminal,
  sendMonerisCloud,
  summarizeTerminalRows,
} from '../lib/moneris';
import { fetchDebitPayments, formatAmount, summarizeCashByStore, summarizeCashTotals } from '../lib/payments';
import { useAppAccess } from '../lib/permissions';
import { formatDateParam, formatPickerDate, parseDateParam } from '../lib/transactions';

const fontFamily = Platform.select({
  ios: 'Sohne',
  android: 'Sohne',
  default: 'Sohne',
});

const ACCENT = '#1D4ED8';
const TABS = [
  { key: 'ledger', label: 'Ledger' },
  { key: 'terminals', label: 'Terminals' },
];

const STORE_SORT_KEYS = [
  { key: 'storeName', label: 'Store' },
  { key: 'cashIn', label: 'Debit in' },
  { key: 'cashOut', label: 'Debit out' },
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

function namesMatch(a, b) {
  return (
    String(a || '')
      .trim()
      .localeCompare(String(b || '').trim(), undefined, { sensitivity: 'base' }) === 0
  );
}

function matchKey(storeName, amount) {
  return `${String(storeName || '').trim().toLowerCase()}|${(Number(amount) || 0).toFixed(2)}`;
}

function emptyTerminalForm(storeName = '') {
  return {
    id: '',
    storeName,
    label: '',
    terminalId: '',
    storeId: '',
    apiToken: '',
    environment: 'core',
    istConfigCode: '',
    lanIp: '',
  };
}

function Field({ label, value, onChangeText, placeholder, secure, autoCapitalize = 'none' }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={styles.fieldInput}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#9a9a9a"
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        secureTextEntry={secure}
      />
    </View>
  );
}

export default function DebitScreen({
  session,
  onRequireLogin,
  storeFilter,
  embedded = false,
}) {
  const { canFilter } = useAppAccess();
  const allowFilters = canFilter('debit');
  const canManage = canManageMonerisTerminals(session?.profile);
  const [tab, setTab] = useState('ledger');
  const [date, setDate] = useState(() => parseDateParam(new Date()));
  const [rows, setRows] = useState([]);
  const [terminalRows, setTerminalRows] = useState([]);
  const [terminals, setTerminals] = useState([]);
  const [stores, setStores] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [query, setQuery] = useState('');
  const [storeSort, setStoreSort] = useState({ key: 'storeName', direction: 'asc' });
  const [txSort, setTxSort] = useState({ key: 'storeName', direction: 'asc' });
  const [selectedStore, setSelectedStore] = useState(storeFilter || null);
  const [form, setForm] = useState(() => emptyTerminalForm(storeFilter || ''));
  const [saving, setSaving] = useState(false);
  const [chargeTerminalId, setChargeTerminalId] = useState('');
  const [chargeAmount, setChargeAmount] = useState('');
  const [chargeAction, setChargeAction] = useState('purchase');
  const [charging, setCharging] = useState(false);
  const [chargeMessage, setChargeMessage] = useState('');
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
      setTerminalRows([]);
      setError('');
      setWarning('');
      return;
    }

    const id = ++requestId.current;
    setLoading(true);
    setError('');
    setWarning('');

    try {
      const [pos, moneris, terminalList] = await Promise.all([
        fetchDebitPayments(session, {
          date: dateKey,
          storeName: storeFilter || undefined,
        }),
        listMonerisTransactions({
          date: dateKey,
          storeName: storeFilter || undefined,
        }),
        listMonerisTerminals(storeFilter || undefined),
      ]);
      if (id !== requestId.current) return;
      setRows(pos.rows);
      setTerminalRows(moneris.rows);
      setTerminals(terminalList.rows);
      const notes = [pos.warning];
      if (moneris.unavailable || terminalList.unavailable) {
        notes.push('Moneris tables are not installed yet. Run the Debit migration in Supabase.');
      }
      setWarning(notes.filter(Boolean).join(' '));
      if (storeFilter) setSelectedStore(storeFilter);
      setChargeTerminalId((current) => {
        if (current && terminalList.rows.some((row) => row.id === current)) return current;
        return terminalList.rows[0]?.id || '';
      });
    } catch (err) {
      if (id !== requestId.current) return;
      setRows([]);
      setTerminalRows([]);
      setError(err?.message || 'Failed to load debit payments.');
      setWarning('');
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [session, dateKey, storeFilter]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (storeFilter) {
      setSelectedStore(storeFilter);
      setForm((current) => ({ ...current, storeName: current.storeName || storeFilter }));
    }
  }, [storeFilter]);

  useEffect(() => {
    if (!allowFilters && !storeFilter) setSelectedStore(null);
  }, [allowFilters, storeFilter]);

  useEffect(() => {
    if (!session?.token || tab !== 'terminals') return;
    let cancelled = false;
    fetchTransferStores(session)
      .then((result) => {
        if (!cancelled) setStores(result.stores || []);
      })
      .catch(() => {
        if (!cancelled) setStores([]);
      });
    return () => {
      cancelled = true;
    };
  }, [session, tab]);

  const storeNames = useMemo(() => {
    const names = new Set([
      ...rows.map((row) => row.storeName || '—'),
      ...terminalRows.map((row) => row.storeName || '—'),
    ]);
    return Array.from(names).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }, [rows, terminalRows]);

  const filteredRows = useMemo(() => {
    let result = rows;
    if (selectedStore && !singleStore) {
      result = result.filter((row) => namesMatch(row.storeName, selectedStore));
    }
    const q = query.trim().toLowerCase();
    if (q) result = result.filter((row) => row.searchText.includes(q));
    return [...result].sort((a, b) => compareValues(a, b, txSort.key, txSort.direction));
  }, [rows, selectedStore, singleStore, query, txSort]);

  const filteredTerminalRows = useMemo(() => {
    let result = terminalRows;
    if (selectedStore && !singleStore) {
      result = result.filter((row) => namesMatch(row.storeName, selectedStore));
    }
    const q = query.trim().toLowerCase();
    if (q) result = result.filter((row) => row.searchText.includes(q));
    return result;
  }, [terminalRows, selectedStore, singleStore, query]);

  const matchedPosIds = useMemo(() => {
    const leftover = new Map();
    for (const row of filteredTerminalRows.filter((entry) => entry.approved)) {
      const key = matchKey(row.storeName, row.amount);
      leftover.set(key, (leftover.get(key) || 0) + 1);
    }
    const matched = new Set();
    for (const row of filteredRows) {
      const key = matchKey(row.storeName, row.amount);
      const remaining = leftover.get(key) || 0;
      if (remaining > 0) {
        matched.add(row.id);
        leftover.set(key, remaining - 1);
      }
    }
    return matched;
  }, [filteredRows, filteredTerminalRows]);

  const storeSummaries = useMemo(() => {
    return [...summarizeCashByStore(rows)].sort((a, b) =>
      compareValues(a, b, storeSort.key, storeSort.direction),
    );
  }, [rows, storeSort]);

  const totals = useMemo(() => summarizeCashTotals(filteredRows), [filteredRows]);
  const terminalTotals = useMemo(
    () => summarizeTerminalRows(filteredTerminalRows),
    [filteredTerminalRows],
  );

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

  const patchForm = (patch) => setForm((current) => ({ ...current, ...patch }));

  const startEdit = (terminal) => {
    setForm({
      id: terminal.id,
      storeName: terminal.storeName,
      label: terminal.label,
      terminalId: terminal.terminalId,
      storeId: terminal.storeId,
      apiToken: '',
      environment: terminal.environment,
      istConfigCode: terminal.istConfigCode,
      lanIp: terminal.lanIp,
    });
    setTab('terminals');
  };

  const onSaveTerminal = async () => {
    setSaving(true);
    setError('');
    try {
      await saveMonerisTerminal(form, session?.supabaseUserId || session?.profile?.id);
      setForm(emptyTerminalForm(storeFilter || form.storeName));
      await load();
    } catch (err) {
      setError(err?.message || 'Could not save the terminal.');
    } finally {
      setSaving(false);
    }
  };

  const onDeleteTerminal = async (id) => {
    setSaving(true);
    setError('');
    try {
      await deleteMonerisTerminal(id);
      if (form.id === id) setForm(emptyTerminalForm(storeFilter || ''));
      await load();
    } catch (err) {
      setError(err?.message || 'Could not remove the terminal.');
    } finally {
      setSaving(false);
    }
  };

  const onSendTerminal = async (action) => {
    const terminalId = chargeTerminalId || terminals[0]?.id;
    if (!terminalId) {
      setChargeMessage('Add a Move 5000 on the Terminals tab first.');
      return;
    }
    setCharging(true);
    setChargeMessage('');
    try {
      const result = await sendMonerisCloud({
        terminalId,
        action,
        amount: action === 'initialization' ? undefined : chargeAmount,
      });
      if (action === 'initialization') {
        setChargeMessage(result.status || (result.completed ? 'Terminal is online.' : 'Sent. Waiting on the terminal.'));
      } else if (result.approved) {
        setChargeMessage(`Approved ${formatAmount(result.amount)} · ${result.cardType || 'card'} ${result.authCode || ''}`.trim());
        setChargeAmount('');
      } else if (result.completed) {
        setChargeMessage(result.status || `Declined (${result.responseCode || 'no code'}).`);
      } else {
        setChargeMessage('Sent to the Move 5000. Waiting for the customer…');
      }
      await load();
    } catch (err) {
      setChargeMessage(err?.message || 'Could not reach Moneris Cloud.');
    } finally {
      setCharging(false);
    }
  };

  if (!session?.token) {
    return (
      <View style={styles.body}>
        <Text style={styles.hint}>
          Sign in to view debit.{' '}
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
        <TabBar options={TABS} value={tab} onChange={setTab} />
        {tab === 'ledger' && !embedded ? (
          <View style={styles.search}>
            <Ionicons name="search-outline" size={14} color="#8a8a8a" />
            <TextInput
              style={styles.searchInput}
              value={query}
              onChangeText={setQuery}
              placeholder="Search debit…"
              placeholderTextColor="#9a9a9a"
              autoCorrect={false}
              autoCapitalize="none"
              clearButtonMode="while-editing"
            />
          </View>
        ) : null}

        {tab === 'ledger' ? (
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
        ) : null}

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

      {tab === 'ledger' ? (
        <ListContainer {...listProps}>
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Debit</Text>
              <Text style={styles.sectionMeta}>
                {loading && rows.length === 0
                  ? 'Loading…'
                  : `${totals.count} POS payment${totals.count === 1 ? '' : 's'} · ${formatAmount(totals.cashIn)} in · ${formatAmount(totals.cashOut)} out`}
              </Text>
            </View>

            <View style={styles.summaryCards}>
              <View style={styles.summaryCard}>
                <Text style={styles.summaryLabel}>Debit in</Text>
                <Text style={[styles.summaryValue, styles.cashIn]}>
                  {formatAmount(totals.cashIn)}
                </Text>
                <Text style={styles.summaryHint}>{totals.inCount} received</Text>
              </View>
              <View style={styles.summaryCard}>
                <Text style={styles.summaryLabel}>Debit out</Text>
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
              <View style={styles.summaryCard}>
                <Text style={styles.summaryLabel}>Move 5000</Text>
                <Text style={styles.summaryValue}>{formatAmount(terminalTotals.net)}</Text>
                <Text style={styles.summaryHint}>
                  {terminalTotals.approved} approved on terminal
                </Text>
              </View>
            </View>

            {terminals.length > 0 ? (
              <View style={styles.chargeCard}>
                <Text style={styles.tableBlockTitle}>Send to Move 5000</Text>
                <Text style={styles.helpText}>
                  Terminal must be on store Wi-Fi with Cloud integration. The customer taps or inserts on the device.
                </Text>
                <View style={styles.chargeRow}>
                  {terminals.length > 1 ? (
                    <View style={styles.storeFilterRow}>
                      {terminals.map((terminal) => (
                        <Pressable
                          key={terminal.id}
                          style={[
                            styles.storeChip,
                            chargeTerminalId === terminal.id && styles.storeChipActive,
                          ]}
                          onPress={() => setChargeTerminalId(terminal.id)}
                        >
                          <Text
                            style={[
                              styles.storeChipText,
                              chargeTerminalId === terminal.id && styles.storeChipTextActive,
                            ]}
                          >
                            {terminal.displayName}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  ) : (
                    <Text style={styles.helpText}>{terminals[0].displayName}</Text>
                  )}
                </View>
                <View style={styles.chargeRow}>
                  <TextInput
                    style={styles.amountInput}
                    value={chargeAmount}
                    onChangeText={setChargeAmount}
                    placeholder="0.00"
                    placeholderTextColor="#9a9a9a"
                    keyboardType="decimal-pad"
                  />
                  <Pressable
                    style={[styles.actionChip, chargeAction === 'purchase' && styles.actionChipActive]}
                    onPress={() => setChargeAction('purchase')}
                  >
                    <Text
                      style={[
                        styles.actionChipText,
                        chargeAction === 'purchase' && styles.actionChipTextActive,
                      ]}
                    >
                      Purchase
                    </Text>
                  </Pressable>
                  <Pressable
                    style={[styles.actionChip, chargeAction === 'refund' && styles.actionChipActive]}
                    onPress={() => setChargeAction('refund')}
                  >
                    <Text
                      style={[
                        styles.actionChipText,
                        chargeAction === 'refund' && styles.actionChipTextActive,
                      ]}
                    >
                      Refund
                    </Text>
                  </Pressable>
                  <Pressable
                    style={[styles.primaryButton, charging && styles.primaryButtonDisabled]}
                    onPress={() => onSendTerminal(chargeAction)}
                    disabled={charging}
                  >
                    {charging ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Text style={styles.primaryButtonText}>Send</Text>
                    )}
                  </Pressable>
                  <Pressable
                    style={styles.secondaryButton}
                    onPress={() => onSendTerminal('initialization')}
                    disabled={charging}
                  >
                    <Text style={styles.secondaryButtonText}>Test</Text>
                  </Pressable>
                </View>
                {chargeMessage ? <Text style={styles.chargeMessage}>{chargeMessage}</Text> : null}
              </View>
            ) : (
              <Pressable style={styles.chargeCard} onPress={() => setTab('terminals')}>
                <Text style={styles.tableBlockTitle}>No Move 5000 connected</Text>
                <Text style={styles.helpText}>
                  Open Terminals to add Cloud Wi-Fi credentials from Merchant Direct. POS debit still lists here.
                </Text>
              </Pressable>
            )}

            {allowFilters && !singleStore ? (
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
              <Text style={styles.tableBlockTitle}>POS debit</Text>
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
                <Text style={[styles.headerText, styles.colMatch]}>Match</Text>
              </View>

              {loading && rows.length === 0 ? (
                <View style={[styles.centered, embedded && styles.centeredEmbedded]}>
                  <ActivityIndicator color={ACCENT} />
                </View>
              ) : filteredRows.length === 0 ? (
                <Text style={styles.emptyText}>No cleared debit payments for this date.</Text>
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
                    <Text
                      style={[
                        styles.cell,
                        styles.colMatch,
                        matchedPosIds.has(row.id) ? styles.cashIn : styles.muted,
                      ]}
                      numberOfLines={1}
                    >
                      {matchedPosIds.has(row.id) ? 'Terminal' : 'POS only'}
                    </Text>
                  </View>
                ))
              )}
            </View>

            <View style={styles.tableBlock}>
              <Text style={styles.tableBlockTitle}>Move 5000 receipts</Text>
              {filteredTerminalRows.length === 0 ? (
                <Text style={styles.emptyText}>
                  No Cloud receipts for this date. Send a purchase to the terminal or wait for the next sync.
                </Text>
              ) : (
                filteredTerminalRows.map((row) => (
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
                        row.approved ? (row.type === 'In' ? styles.cashIn : styles.cashOut) : styles.muted,
                      ]}
                      numberOfLines={1}
                    >
                      {row.approved ? row.directionLabel : 'Declined'}
                    </Text>
                    <Text style={[styles.cell, styles.colAmount]} numberOfLines={1}>
                      {row.amountLabel}
                    </Text>
                    <Text style={[styles.cell, styles.colCustomer]} numberOfLines={1}>
                      {row.customerName}
                    </Text>
                    <Text style={[styles.cell, styles.colRef]} numberOfLines={1}>
                      {row.authCode || row.reference}
                    </Text>
                  </View>
                ))
              )}
            </View>
          </View>
        </ListContainer>
      ) : (
        <ListContainer {...listProps}>
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Move 5000</Text>
              <Text style={styles.sectionMeta}>
                Cloud via Wi-Fi. Credentials stay on the server; the app never talks to the pinpad by LAN.
              </Text>
            </View>

            <View style={styles.helpCard}>
              <Text style={styles.helpTitle}>On the terminal</Text>
              <Text style={styles.helpText}>
                1. Connect the Move 5000 to the store Wi-Fi.{'\n'}
                2. Open Settings → Integration (or Application Settings) → Core Semi-Integrated.{'\n'}
                3. Set Integration Method to Cloud. Disable cellular so it stays on Wi-Fi.{'\n'}
                4. In Merchant Direct, copy Store ID, Terminal ID, and the Cloud API token.
              </Text>
            </View>

            {terminals.length === 0 ? (
              <Text style={styles.emptyText}>No terminals saved yet.</Text>
            ) : (
              terminals.map((terminal) => (
                <View key={terminal.id} style={styles.terminalCard}>
                  <View style={styles.terminalCardHeader}>
                    <Text style={styles.terminalName}>{terminal.displayName}</Text>
                    <Text style={styles.terminalMeta}>{terminal.storeName}</Text>
                  </View>
                  <Text style={styles.helpText}>
                    TID {terminal.terminalId} · {environmentLabel(terminal.environment)}
                    {terminal.lastStatus ? ` · ${terminal.lastStatus}` : ''}
                  </Text>
                  {terminal.lastError ? (
                    <Text style={styles.errorText}>{terminal.lastError}</Text>
                  ) : null}
                  {canManage ? (
                    <View style={styles.terminalActions}>
                      <Pressable onPress={() => startEdit(terminal)}>
                        <Text style={styles.link}>Edit</Text>
                      </Pressable>
                      <Pressable onPress={() => onDeleteTerminal(terminal.id)}>
                        <Text style={styles.dangerLink}>Remove</Text>
                      </Pressable>
                    </View>
                  ) : null}
                </View>
              ))
            )}

            {canManage ? (
              <View style={styles.formCard}>
                <Text style={styles.tableBlockTitle}>
                  {form.id ? 'Edit terminal' : 'Add a Move 5000'}
                </Text>
                <View style={styles.field}>
                  <Text style={styles.fieldLabel}>Store</Text>
                  {storeFilter ? (
                    <Text style={styles.helpText}>{storeFilter}</Text>
                  ) : (
                    <View style={styles.storeFilterRow}>
                      {(stores.length ? stores.map((store) => store.name) : storeNames).map((name) => (
                        <Pressable
                          key={name}
                          style={[
                            styles.storeChip,
                            form.storeName === name && styles.storeChipActive,
                          ]}
                          onPress={() => patchForm({ storeName: name })}
                        >
                          <Text
                            style={[
                              styles.storeChipText,
                              form.storeName === name && styles.storeChipTextActive,
                            ]}
                          >
                            {name}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  )}
                </View>
                <Field
                  label="Label"
                  value={form.label}
                  onChangeText={(label) => patchForm({ label })}
                  placeholder="Front counter"
                  autoCapitalize="words"
                />
                <Field
                  label="Terminal ID"
                  value={form.terminalId}
                  onChangeText={(terminalId) => patchForm({ terminalId })}
                  placeholder="8-character TID"
                />
                <Field
                  label="Moneris store ID"
                  value={form.storeId}
                  onChangeText={(storeId) => patchForm({ storeId })}
                  placeholder="From Merchant Direct"
                />
                <Field
                  label={form.id ? 'API token (leave blank to keep current)' : 'Cloud API token'}
                  value={form.apiToken}
                  onChangeText={(apiToken) => patchForm({ apiToken })}
                  placeholder="Merchant Direct API token"
                  secure
                />
                <View style={styles.field}>
                  <Text style={styles.fieldLabel}>Cloud host</Text>
                  <View style={styles.storeFilterRow}>
                    {MONERIS_ENVIRONMENTS.map((entry) => (
                      <Pressable
                        key={entry.key}
                        style={[
                          styles.storeChip,
                          form.environment === entry.key && styles.storeChipActive,
                        ]}
                        onPress={() => patchForm({ environment: entry.key })}
                      >
                        <Text
                          style={[
                            styles.storeChipText,
                            form.environment === entry.key && styles.storeChipTextActive,
                          ]}
                        >
                          {entry.label}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                  <Text style={styles.helpText}>
                    {MONERIS_ENVIRONMENTS.find((entry) => entry.key === form.environment)?.hint}
                  </Text>
                </View>
                <Field
                  label="IST config code (optional)"
                  value={form.istConfigCode}
                  onChangeText={(istConfigCode) => patchForm({ istConfigCode })}
                  placeholder="Only if Moneris gave you one"
                />
                <Field
                  label="LAN IP (optional note)"
                  value={form.lanIp}
                  onChangeText={(lanIp) => patchForm({ lanIp })}
                  placeholder="Shown for staff, not used for Cloud"
                />
                <View style={styles.terminalActions}>
                  <Pressable
                    style={[styles.primaryButton, saving && styles.primaryButtonDisabled]}
                    onPress={onSaveTerminal}
                    disabled={saving}
                  >
                    {saving ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Text style={styles.primaryButtonText}>{form.id ? 'Save' : 'Add terminal'}</Text>
                    )}
                  </Pressable>
                  {form.id ? (
                    <Pressable
                      style={styles.secondaryButton}
                      onPress={() => setForm(emptyTerminalForm(storeFilter || ''))}
                    >
                      <Text style={styles.secondaryButtonText}>Cancel</Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            ) : (
              <Text style={styles.helpText}>
                Branch managers and above can add Cloud credentials for each store’s Move 5000.
              </Text>
            )}
          </View>
        </ListContainer>
      )}
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
  tabBar: {
    flexDirection: 'row',
    backgroundColor: 'rgba(118, 118, 128, 0.12)',
    borderRadius: 10,
    padding: 2,
  },
  tab: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
  },
  tabActive: {
    backgroundColor: '#fff',
  },
  tabLabel: {
    fontFamily,
    fontSize: 13,
    fontWeight: '500',
    color: '#8e8e93',
  },
  tabLabelActive: {
    color: '#1d1d1f',
    fontWeight: '600',
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
    backgroundColor: '#E8EEFF',
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
  dangerLink: {
    color: '#B91C1C',
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
    backgroundColor: '#F5F8FF',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#D9E3F5',
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
  muted: {
    color: '#8a8a8a',
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
    backgroundColor: '#E8EEFF',
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
    backgroundColor: '#F0F4FF',
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
  colMatch: {
    flex: 0.8,
    minWidth: 0,
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
  chargeCard: {
    padding: 14,
    borderRadius: 12,
    backgroundColor: '#F7F9FC',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#E2E8F0',
    gap: 10,
  },
  chargeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  amountInput: {
    minWidth: 88,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#d0d0d0',
    fontFamily,
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
    paddingVertical: 6,
    ...Platform.select({
      web: { outlineStyle: 'none' },
      default: {},
    }),
  },
  actionChip: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: '#f3f3f3',
  },
  actionChipActive: {
    backgroundColor: '#E8EEFF',
  },
  actionChipText: {
    fontFamily,
    fontSize: 13,
    fontWeight: '500',
    color: '#6b6b6b',
  },
  actionChipTextActive: {
    color: ACCENT,
    fontWeight: '600',
  },
  primaryButton: {
    backgroundColor: ACCENT,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    minHeight: 34,
    justifyContent: 'center',
  },
  primaryButtonDisabled: {
    opacity: 0.6,
  },
  primaryButtonText: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: '#fff',
  },
  secondaryButton: {
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minHeight: 34,
    justifyContent: 'center',
    backgroundColor: '#f3f3f3',
  },
  secondaryButtonText: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: '#3f3f46',
  },
  chargeMessage: {
    fontFamily,
    fontSize: 13,
    color: '#1a1a1a',
  },
  helpCard: {
    padding: 14,
    borderRadius: 12,
    backgroundColor: '#F7F9FC',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#E2E8F0',
    gap: 6,
  },
  helpTitle: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  helpText: {
    fontFamily,
    fontSize: 13,
    color: '#6b6b6b',
    lineHeight: 18,
  },
  terminalCard: {
    padding: 14,
    borderRadius: 12,
    backgroundColor: '#fff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#E5E7EB',
    gap: 4,
  },
  terminalCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  terminalName: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  terminalMeta: {
    fontFamily,
    fontSize: 13,
    color: '#8a8a8a',
  },
  terminalActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginTop: 6,
  },
  formCard: {
    padding: 14,
    borderRadius: 12,
    backgroundColor: '#fff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#E5E7EB',
    gap: 12,
  },
  field: {
    gap: 6,
  },
  fieldLabel: {
    fontFamily,
    fontSize: 11,
    fontWeight: '600',
    color: '#8a8a8a',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  fieldInput: {
    fontFamily,
    fontSize: 15,
    color: '#1a1a1a',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e0e0e0',
    paddingVertical: 6,
    ...Platform.select({
      web: { outlineStyle: 'none' },
      default: {},
    }),
  },
});
