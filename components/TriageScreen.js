import { createElement, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { getLinkedPosSessions } from '../lib/auth';
import {
  defaultDateRange,
  fetchTransactionDetail,
  fetchTransactions,
  formatAmount,
  formatDateParam,
  formatPickerDate,
  parseDateParam,
  resolvePosAuthForRow,
  rowMatchesQuery,
  withLineItems,
} from '../lib/transactions';
import {
  createClient,
  fetchLookupLocations,
  fetchLookupUsers,
  mergeEmployeeOptions,
  searchClients,
  searchProducts,
} from '../lib/triageLookups';

if (Platform.OS === 'web' && typeof document !== 'undefined') {
  const styleId = 'cgold-triage-row-hover';
  let style = document.getElementById(styleId);
  if (!style) {
    style = document.createElement('style');
    style.id = styleId;
    document.head.appendChild(style);
  }
  style.textContent = [
    '.cgold-triage-row{cursor:pointer;background-color:transparent;}',
    '.cgold-triage-row:hover{background-color:#f5f5f7!important;}',
    '.cgold-triage-row-selected,.cgold-triage-row-selected:hover{background-color:#FFF7ED!important;}',
    '.cgold-triage-grid{display:grid!important;grid-template-columns:12% 16% 16% 24% 16% 16%;align-items:center;width:100%;box-sizing:border-box;}',
    '.cgold-triage-grid>*{min-width:0!important;max-width:100%;flex:none!important;width:auto!important;overflow:hidden;}',
    '.cgold-triage-line-grid{display:grid!important;grid-template-columns:minmax(0,1fr) 88px 120px;align-items:start;width:100%;box-sizing:border-box;}',
    '.cgold-triage-line-grid>*{min-width:0!important;flex:none!important;width:auto!important;padding-right:10px;}',
    '.cgold-triage-line-grid>*:last-child{padding-right:0;}',
  ].join('');
}

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
const STRUCK = '#8e8e93';
const PICK_RANGE_DAYS = 14;
const PICK_ROW_HEIGHT = 40;
const PICK_OVERSCAN = 12;
const PICK_CACHE = new Map();
const PICK_CACHE_LIMIT = 4;

function pickCacheKey(session, startDate, endDate, storeFilter) {
  const linked = getLinkedPosSessions(session)
    .map((system) => system.key)
    .join(',');
  return `${String(session?.token || '').slice(0, 16)}|${linked}|${startDate}|${endDate}|${storeFilter || ''}`;
}

/** Drop cached transaction rows so nothing outlives the session that loaded them. */
export function clearTriageCache() {
  PICK_CACHE.clear();
}

function rememberPickRows(key, rows) {
  PICK_CACHE.set(key, rows);
  if (PICK_CACHE.size > PICK_CACHE_LIMIT) {
    const first = PICK_CACHE.keys().next().value;
    PICK_CACHE.delete(first);
  }
}

function applyStoreFilter(rows, storeFilter) {
  if (!storeFilter) return rows;
  return rows.filter(
    (row) =>
      String(row.storeName || '').localeCompare(storeFilter, undefined, { sensitivity: 'base' }) === 0,
  );
}

function sortTxRows(rows) {
  return rows.slice().sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0));
}

const TRIAGE_TABS = [
  { key: 'dashboard', label: 'Dashboard', icon: 'grid-outline' },
  { key: 'transfers', label: 'Transfers', icon: 'swap-horizontal-outline' },
  { key: 'accuracy', label: 'Accuracy', icon: 'checkmark-done-outline' },
  { key: 'allocation', label: 'Allocation', icon: 'git-branch-outline' },
];

const ERROR_TYPES = [
  'Wrong item',
  'Wrong quantity',
  'Wrong price',
  'Wrong customer',
  'Wrong payment',
  'Missing item',
  'Other',
];

function lineItemName(item) {
  const product = item?.product;
  const candidates = [
    item?.description,
    product?.name,
    product?.description,
    item?.quality_mark_description,
    product?.sku,
    product?.code,
  ]
    .map((value) => (value == null ? '' : String(value).trim()))
    .filter(Boolean);

  if (candidates.length) return candidates[0];
  if (product?.metal?.name) {
    return product?.type === 'scrap' ? `Scrap ${product.metal.name}` : product.metal.name;
  }
  return 'Untitled item';
}

function lineItemQty(item) {
  const qty = item?.quantity ?? item?.gross_quantity ?? 1;
  return String(qty);
}

function makeField(original) {
  const text = original == null ? '' : String(original);
  return { original: text, value: text };
}

function fieldChanged(field) {
  return String(field?.value ?? '') !== String(field?.original ?? '');
}

function clientDisplayName(detail, fallback) {
  const client = detail?.client;
  if (!client) return fallback || '';
  const name = [client.first_name, client.last_name].filter(Boolean).join(' ').trim();
  return name || client.nickname || fallback || '';
}

function buildDraft(row, detail) {
  const items = Array.isArray(detail?.items) ? detail.items : [];
  const payments = Array.isArray(detail?.payments) ? detail.payments : [];
  const total = detail?.total_amount ?? row.amount;
  const fallbackItems =
    items.length > 0
      ? items
      : (row.itemNames || []).map((name, index) => ({
          id: `named-${index}`,
          description: name,
          price: '',
        }));

  return {
    header: [
      {
        key: 'customer',
        label: row.type === 'purchase' ? 'Vendor / customer' : 'Customer',
        ...makeField(clientDisplayName(detail, row.customerName)),
      },
      {
        key: 'store',
        label: 'Store',
        ...makeField(detail?.location?.name || row.storeName || ''),
      },
      {
        key: 'employee',
        label: 'Employee',
        ...makeField(row.employeeName || ''),
      },
      {
        key: 'date',
        label: 'Date',
        ...makeField(row.dateLabel || ''),
      },
      {
        key: 'total',
        label: 'Total',
        ...makeField(formatAmount(total)),
      },
    ],
    items: fallbackItems.map((item, index) => ({
      id: item.id || `item-${index}`,
      name: makeField(lineItemName(item)),
      qty: makeField(lineItemQty(item)),
      amount: makeField(item.price === '' ? '' : formatAmount(item.price)),
    })),
    payments: payments.map((entry, index) => {
      const payment = entry.payment || entry;
      return {
        id: entry.id || payment.id || `pay-${index}`,
        method: makeField(payment.payment_type?.name || 'Payment'),
        amount: makeField(formatAmount(entry.amount ?? payment.amount)),
      };
    }),
  };
}

function collectCorrections(draft) {
  const corrections = [];
  if (!draft) return corrections;

  for (const field of draft.header || []) {
    if (fieldChanged(field)) {
      corrections.push({
        key: field.key,
        label: field.label,
        original: field.original,
        value: field.value,
      });
    }
  }

  (draft.items || []).forEach((item, index) => {
    const label = `Item ${index + 1}`;
    if (fieldChanged(item.name)) {
      corrections.push({
        key: `${item.id}-name`,
        label: `${label} name`,
        original: item.name.original,
        value: item.name.value,
      });
    }
    if (fieldChanged(item.qty)) {
      corrections.push({
        key: `${item.id}-qty`,
        label: `${label} qty`,
        original: item.qty.original,
        value: item.qty.value,
      });
    }
    if (fieldChanged(item.amount)) {
      corrections.push({
        key: `${item.id}-amount`,
        label: `${label} amount`,
        original: item.amount.original,
        value: item.amount.value,
      });
    }
  });

  (draft.payments || []).forEach((payment, index) => {
    const label = `Payment ${index + 1}`;
    if (fieldChanged(payment.method)) {
      corrections.push({
        key: `${payment.id}-method`,
        label: `${label} method`,
        original: payment.method.original,
        value: payment.method.value,
      });
    }
    if (fieldChanged(payment.amount)) {
      corrections.push({
        key: `${payment.id}-amount`,
        label: `${label} amount`,
        original: payment.amount.original,
        value: payment.amount.value,
      });
    }
  });

  return corrections;
}

function DateChip({ label, value, onChange, maximumDate, minimumDate }) {
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
              color: TEXT,
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

function TabPanel({ tab }) {
  return (
    <View style={styles.panel}>
      <View style={styles.emptyIcon}>
        <Ionicons name={tab.icon} size={22} color={ACCENT} />
      </View>
      <Text style={styles.emptyTitle}>{tab.label}</Text>
      <Text style={styles.emptyBody}>Nothing to review in {tab.label.toLowerCase()} yet.</Text>
    </View>
  );
}

function CorrectionPair({ original, value }) {
  return (
    <View style={styles.correctionPair}>
      <Text style={styles.struckText}>{original || '—'}</Text>
      <Text style={styles.correctedText}>{value || '—'}</Text>
    </View>
  );
}

function CorrectableField({ label, field, onChange, compact, keyboardType, hideLabel }) {
  const changed = fieldChanged(field);
  return (
    <View style={[styles.fieldBlock, compact && styles.fieldBlockCompact]}>
      {label && !hideLabel ? <Text style={styles.fieldLabel}>{label}</Text> : null}
      {changed ? <Text style={styles.struckText}>{field.original || '—'}</Text> : null}
      <TextInput
        style={[styles.fieldInput, changed && styles.fieldInputCorrected, compact && styles.fieldInputCompact]}
        value={field.value}
        onChangeText={onChange}
        placeholder={field.original || '—'}
        placeholderTextColor="#c7c7cc"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType={keyboardType || 'default'}
      />
    </View>
  );
}

function LookupField({
  label,
  field,
  onChange,
  options,
  onSearch,
  allowCustom = false,
  pickOnly = false,
  placeholder,
  rightAction,
  hideLabel,
  compact,
}) {
  const changed = fieldChanged(field);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(field.value || '');
  const [remote, setRemote] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setQuery(field.value || '');
  }, [field.value]);

  const localResults = useMemo(() => {
    const list = options || [];
    const q = query.trim().toLowerCase();
    if (!q) return list.slice(0, 40);
    return list
      .filter(
        (option) =>
          String(option.label || '').toLowerCase().includes(q) ||
          String(option.sub || '').toLowerCase().includes(q),
      )
      .slice(0, 40);
  }, [options, query]);

  useEffect(() => {
    if (!onSearch || !open) return;
    const q = query.trim();
    if (q.length < 2) {
      setRemote([]);
      setBusy(false);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setBusy(true);
      try {
        const next = await onSearch(q);
        if (!cancelled) setRemote(next);
      } catch {
        if (!cancelled) setRemote([]);
      } finally {
        if (!cancelled) setBusy(false);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [onSearch, query, open]);

  const results = onSearch ? remote : localResults;
  const showCustom =
    allowCustom &&
    query.trim() &&
    !results.some(
      (option) => String(option.label || '').toLowerCase() === query.trim().toLowerCase(),
    );

  const select = (option) => {
    onChange(option.label, option);
    setQuery(option.label);
    setOpen(false);
  };

  const commitTyped = () => {
    if (pickOnly) {
      const match = (options || []).find(
        (option) => option.label.toLowerCase() === query.trim().toLowerCase(),
      );
      if (match) select(match);
      else setQuery(field.value || '');
      return;
    }
    if (allowCustom && query.trim()) {
      onChange(query.trim(), { id: 'custom', label: query.trim(), custom: true });
    }
  };

  return (
    <View style={[styles.fieldBlock, styles.lookupBlock, compact && styles.fieldBlockCompact]}>
      {label && !hideLabel ? <Text style={styles.fieldLabel}>{label}</Text> : null}
      {changed ? <Text style={styles.struckText}>{field.original || '—'}</Text> : null}
      <View style={styles.lookupRow}>
        <View style={styles.lookupInputWrap}>
          <TextInput
            style={[styles.fieldInput, changed && styles.fieldInputCorrected, compact && styles.fieldInputCompact]}
            value={query}
            onChangeText={(value) => {
              setQuery(value);
              setOpen(true);
              if (!pickOnly && !onSearch) onChange(value);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => {
              setTimeout(() => {
                setOpen(false);
                commitTyped();
              }, 160);
            }}
            placeholder={placeholder || field.original || 'Search'}
            placeholderTextColor="#c7c7cc"
            autoCapitalize="none"
            autoCorrect={false}
          />
          {busy ? (
            <ActivityIndicator size="small" color={SECONDARY} style={styles.lookupSpinner} />
          ) : null}
        </View>
        {rightAction}
      </View>
      {open ? (
        <ScrollView style={styles.lookupMenu} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
          {showCustom ? (
            <Pressable style={styles.lookupOption} onPress={() => select({ id: 'custom', label: query.trim(), custom: true })}>
              <Text style={styles.lookupOptionLabel}>Use “{query.trim()}”</Text>
              <Text style={styles.lookupOptionSub}>Custom product</Text>
            </Pressable>
          ) : null}
          {results.length === 0 && !busy ? (
            <Text style={styles.lookupEmpty}>
              {onSearch && query.trim().length < 2
                ? 'Type at least 2 characters'
                : pickOnly
                  ? 'No matching value'
                  : 'No matches'}
            </Text>
          ) : (
            results.map((option) => (
              <Pressable
                key={`${option.id}-${option.label}`}
                style={styles.lookupOption}
                onPress={() => select(option)}
              >
                <Text style={styles.lookupOptionLabel} numberOfLines={1}>
                  {option.label}
                </Text>
                {option.sub ? (
                  <Text style={styles.lookupOptionSub} numberOfLines={1}>
                    {option.sub}
                  </Text>
                ) : null}
              </Pressable>
            ))
          )}
        </ScrollView>
      ) : null}
    </View>
  );
}

function NewCustomerPanel({ onCancel, onCreated, token, baseUrl }) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const created = await createClient(token, { firstName, lastName, email, phone }, baseUrl);
      onCreated(created);
    } catch (err) {
      setError(err?.message || 'Could not add customer.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.newCustomerCard}>
      <Text style={styles.sectionLabel}>New customer</Text>
      <View style={styles.itemRow}>
        <View style={styles.fieldBlockCompact}>
          <Text style={styles.fieldLabel}>First name</Text>
          <TextInput
            style={styles.fieldInput}
            value={firstName}
            onChangeText={setFirstName}
            placeholder="First"
            placeholderTextColor="#c7c7cc"
          />
        </View>
        <View style={styles.fieldBlockCompact}>
          <Text style={styles.fieldLabel}>Last name</Text>
          <TextInput
            style={styles.fieldInput}
            value={lastName}
            onChangeText={setLastName}
            placeholder="Last"
            placeholderTextColor="#c7c7cc"
          />
        </View>
      </View>
      <Text style={styles.fieldLabel}>Email</Text>
      <TextInput
        style={styles.fieldInput}
        value={email}
        onChangeText={setEmail}
        placeholder="name@email.com"
        placeholderTextColor="#c7c7cc"
        autoCapitalize="none"
        keyboardType="email-address"
      />
      <Text style={styles.fieldLabel}>Phone</Text>
      <TextInput
        style={styles.fieldInput}
        value={phone}
        onChangeText={setPhone}
        placeholder="Optional"
        placeholderTextColor="#c7c7cc"
        keyboardType="phone-pad"
      />
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      <View style={styles.newCustomerActions}>
        <Pressable style={styles.secondaryButton} onPress={onCancel}>
          <Text style={styles.secondaryButtonText}>Cancel</Text>
        </Pressable>
        <Pressable
          style={[styles.primaryButton, styles.primaryButtonInline, busy && styles.primaryButtonDisabled]}
          onPress={save}
          disabled={busy}
        >
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>Add customer</Text>}
        </Pressable>
      </View>
    </View>
  );
}

function PickCol({ col, right, children }) {
  return <View style={[styles.pickCol, col, right && styles.pickColRight]}>{children}</View>;
}

function PickTableHeader() {
  return (
    <View
      style={styles.tableHeader}
      {...(Platform.OS === 'web' ? { className: 'cgold-triage-grid' } : null)}
    >
      <PickCol col={styles.colDate}>
        <Text style={styles.tableHeaderCell}>Date</Text>
      </PickCol>
      <PickCol col={styles.colRef}>
        <Text style={styles.tableHeaderCell}>PO / SO</Text>
      </PickCol>
      <PickCol col={styles.colStore}>
        <Text style={styles.tableHeaderCell}>Store</Text>
      </PickCol>
      <PickCol col={styles.colCustomer}>
        <Text style={styles.tableHeaderCell}>Customer</Text>
      </PickCol>
      <PickCol col={styles.colEmployee}>
        <Text style={styles.tableHeaderCell}>Employee</Text>
      </PickCol>
      <PickCol col={styles.colAmount} right>
        <Text style={[styles.tableHeaderCell, styles.colAmountText]}>Amount</Text>
      </PickCol>
    </View>
  );
}

const TransactionPickRow = memo(function TransactionPickRow({ row, selected, onPress }) {
  const isBuy = row.type === 'purchase';

  return (
    <Pressable
      onPress={() => onPress(row)}
      style={selected ? styles.tableRowSelected : styles.tableRow}
      accessibilityRole="button"
      accessibilityLabel={`${isBuy ? 'PO' : 'SO'} ${row.reference} ${row.customerName || ''}`}
      {...(Platform.OS === 'web'
        ? {
            className: selected
              ? 'cgold-triage-row cgold-triage-row-selected cgold-triage-grid'
              : 'cgold-triage-row cgold-triage-grid',
          }
        : null)}
    >
      <PickCol col={styles.colDate}>
        <Text style={[styles.cellText, styles.cellMuted]} numberOfLines={1}>
          {row.dateLabel || '—'}
        </Text>
      </PickCol>
      <PickCol col={styles.colRef}>
        <View style={styles.cellRefInner}>
          <Text style={[styles.txKind, isBuy && styles.txKindBuy]}>{isBuy ? 'PO' : 'SO'}</Text>
          <Text style={[styles.cellText, styles.cellMuted, styles.cellRefText]} numberOfLines={1}>
            {row.reference}
          </Text>
        </View>
      </PickCol>
      <PickCol col={styles.colStore}>
        <Text style={styles.cellText} numberOfLines={1}>
          {row.storeName || '—'}
        </Text>
      </PickCol>
      <PickCol col={styles.colCustomer}>
        <Text style={[styles.cellText, styles.cellStrong]} numberOfLines={1}>
          {row.customerName || '—'}
        </Text>
      </PickCol>
      <PickCol col={styles.colEmployee}>
        <Text style={[styles.cellText, styles.cellMuted]} numberOfLines={1}>
          {row.employeeName || '—'}
        </Text>
      </PickCol>
      <PickCol col={styles.colAmount} right>
        <Text style={[styles.cellText, styles.cellStrong, styles.colAmountText]} numberOfLines={1}>
          {row.amountLabel}
        </Text>
      </PickCol>
    </Pressable>
  );
});

function WindowedPickList({ data, selectedIds, onPress, emptyText }) {
  const [height, setHeight] = useState(0);
  const [startIndex, setStartIndex] = useState(0);
  const startRef = useRef(0);

  const visibleCount = height
    ? Math.ceil(height / PICK_ROW_HEIGHT) + PICK_OVERSCAN * 2
    : 32;
  const start = startIndex;
  const end = Math.min(data.length, start + visibleCount);
  const topSpacer = start * PICK_ROW_HEIGHT;
  const bottomSpacer = Math.max(0, (data.length - end) * PICK_ROW_HEIGHT);
  const slice = data.slice(start, end);

  const onScroll = (event) => {
    const y = event.nativeEvent.contentOffset.y;
    const next = Math.max(0, Math.floor(y / PICK_ROW_HEIGHT) - PICK_OVERSCAN);
    if (next !== startRef.current) {
      startRef.current = next;
      setStartIndex(next);
    }
  };

  const rows = slice.map((row) => (
    <TransactionPickRow
      key={row.id}
      row={row}
      selected={selectedIds.has(row.id)}
      onPress={onPress}
    />
  ));

  return (
    <View
      style={styles.tableBody}
      onLayout={(event) => {
        const next = Math.floor(event.nativeEvent.layout.height);
        if (next > 0 && next !== height) setHeight(next);
      }}
    >
      {data.length === 0 ? (
        <Text style={styles.modalEmpty}>{emptyText}</Text>
      ) : Platform.OS === 'web' ? (
        createElement(
          'div',
          {
            onScroll: (event) => {
              const y = event.currentTarget.scrollTop;
              const next = Math.max(0, Math.floor(y / PICK_ROW_HEIGHT) - PICK_OVERSCAN);
              if (next !== startRef.current) {
                startRef.current = next;
                setStartIndex(next);
              }
            },
            style: {
              height: height || '100%',
              overflowY: 'auto',
              overflowX: 'hidden',
            },
          },
          topSpacer ? createElement('div', { key: 'top', style: { height: topSpacer } }) : null,
          rows,
          bottomSpacer ? createElement('div', { key: 'bottom', style: { height: bottomSpacer } }) : null,
        )
      ) : (
        <ScrollView
          style={styles.tableList}
          onScroll={onScroll}
          scrollEventThrottle={16}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator
        >
          {topSpacer ? <View style={{ height: topSpacer }} /> : null}
          {rows}
          {bottomSpacer ? <View style={{ height: bottomSpacer }} /> : null}
        </ScrollView>
      )}
    </View>
  );
}

function AccuracyReviewLine({ entry, onRemove }) {
  const row = entry.row;
  const isBuy = row.type === 'purchase';

  return (
    <View style={styles.savedCard}>
      <View style={styles.savedHeader}>
        <View style={styles.txRowTop}>
          <Text style={[styles.txKind, isBuy && styles.txKindBuy]}>{isBuy ? 'PO' : 'SO'}</Text>
          <Text style={styles.txRef}>{row.reference}</Text>
          <Text style={styles.txStore} numberOfLines={1}>
            {row.storeName || '—'}
          </Text>
        </View>
        <Pressable onPress={() => onRemove(entry.id)} hitSlop={8} accessibilityLabel="Remove review">
          <Ionicons name="close" size={18} color="#8e8e93" />
        </Pressable>
      </View>

      {entry.corrections.length > 0 ? (
        <View style={styles.savedCorrections}>
          {entry.corrections.map((correction) => (
            <View key={correction.key} style={styles.savedCorrection}>
              <Text style={styles.fieldLabel}>{correction.label}</Text>
              <CorrectionPair original={correction.original} value={correction.value} />
            </View>
          ))}
        </View>
      ) : (
        <Text style={styles.savedMuted}>No field corrections</Text>
      )}

      {entry.note ? (
        <View style={styles.savedBlock}>
          <Text style={styles.fieldLabel}>Note</Text>
          <Text style={styles.savedNote}>{entry.note}</Text>
        </View>
      ) : null}

      {entry.errorType ? (
        <View style={styles.savedBlock}>
          <Text style={styles.fieldLabel}>Type of error</Text>
          <Text style={styles.savedNote}>{entry.errorType}</Text>
        </View>
      ) : null}

      {entry.errorAmount ? (
        <View style={styles.savedBlock}>
          <Text style={styles.fieldLabel}>Amount</Text>
          <Text style={styles.savedAmount}>{entry.errorAmount}</Text>
        </View>
      ) : null}
    </View>
  );
}

function NewAccuracyModal({
  visible,
  session,
  storeFilter,
  selectedIds,
  onClose,
  onFinish,
}) {
  const initialRange = useMemo(() => defaultDateRange(PICK_RANGE_DAYS), []);
  const [step, setStep] = useState('pick');
  const [startDate, setStartDate] = useState(initialRange.start);
  const [endDate, setEndDate] = useState(initialRange.end);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [selectedRow, setSelectedRow] = useState(null);
  const [draft, setDraft] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [note, setNote] = useState('');
  const [errorType, setErrorType] = useState('');
  const [errorAmount, setErrorAmount] = useState('');
  const [locations, setLocations] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [addingCustomer, setAddingCustomer] = useState(false);
  const requestId = useRef(0);
  const detailRequestId = useRef(0);
  const sessionRef = useRef(session);
  sessionRef.current = session;

  const startKey = formatDateParam(startDate);
  const endKey = formatDateParam(endDate);

  const resetWizard = useCallback(() => {
    setStep('pick');
    setSelectedRow(null);
    setDraft(null);
    setDetailError('');
    setDetailLoading(false);
    setNote('');
    setErrorType('');
    setErrorAmount('');
    setAddingCustomer(false);
  }, []);

  const handleClose = useCallback(() => {
    resetWizard();
    onClose();
  }, [onClose, resetWizard]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 150);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!visible) {
      setQuery('');
      setDebouncedQuery('');
      resetWizard();
      return;
    }
  }, [visible, resetWizard]);

  useEffect(() => {
    const currentSession = sessionRef.current;
    if (!visible || !currentSession?.token) return;

    const cacheKey = pickCacheKey(currentSession, startKey, endKey, storeFilter);
    const cached = PICK_CACHE.get(cacheKey);
    if (cached) {
      setRows(cached);
      setLoading(false);
      setError('');
      setWarning('');
      return;
    }

    const id = ++requestId.current;
    let cancelled = false;
    setLoading(true);
    setError('');
    setWarning('');

    const decorate = (list) =>
      list.map((row) => ({
        ...row,
        itemLabel: (row.itemNames || []).join(' · ') || '—',
      }));

    (async () => {
      try {
        const primary = await fetchTransactions(currentSession.token, {
          startDate: startKey,
          endDate: endKey,
          baseUrl: currentSession.baseUrl,
          includePurchases: true,
        });
        if (cancelled || id !== requestId.current) return;

        let next = decorate(applyStoreFilter(primary.rows, storeFilter));
        setRows(next);
        setLoading(false);

        const linked = getLinkedPosSessions(currentSession);
        if (linked.length === 0) {
          rememberPickRows(cacheKey, next);
          return;
        }

        const extras = await Promise.all(
          linked.map(async (system) => {
            try {
              const result = await fetchTransactions(system.token, {
                startDate: startKey,
                endDate: endKey,
                baseUrl: system.baseUrl,
                includePurchases: true,
                system,
              });
              return { rows: result.rows, error: '' };
            } catch (err) {
              return {
                rows: [],
                error: err?.message || `Failed to load ${system.label}.`,
              };
            }
          }),
        );
        if (cancelled || id !== requestId.current) return;

        const extraRows = extras.flatMap((entry) => entry.rows);
        const warnings = extras.map((entry) => entry.error).filter(Boolean);
        next = decorate(
          applyStoreFilter(sortTxRows([...primary.rows, ...extraRows]), storeFilter),
        );
        setRows(next);
        setWarning(warnings.join(' '));
        rememberPickRows(cacheKey, next);
      } catch (err) {
        if (cancelled || id !== requestId.current) return;
        setRows([]);
        setError(err?.message || 'Failed to load purchases and sales.');
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [visible, startKey, endKey, storeFilter]);

  useEffect(() => {
    if (!visible || step !== 'edit' || !session) return;
    const auth = resolvePosAuthForRow(session, selectedRow);
    let cancelled = false;
    (async () => {
      const [locs, users] = await Promise.all([
        fetchLookupLocations(auth.token, auth.baseUrl).catch(() => []),
        fetchLookupUsers(auth.token, auth.baseUrl).catch(() => []),
      ]);
      if (cancelled) return;
      const storeName = String(selectedRow?.storeName || '').trim();
      const withCurrent =
        storeName && storeName !== '—' && !locs.some((entry) => entry.label === storeName)
          ? [{ id: 'current', label: storeName, sub: 'Current store' }, ...locs]
          : locs;
      setLocations(withCurrent);
      setEmployees(mergeEmployeeOptions(users, selectedRow ? [selectedRow, ...rows] : rows));
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, step, session, selectedRow, rows]);

  const searchCustomerOptions = useCallback(
    async (query) => {
      if (!session) return [];
      const auth = resolvePosAuthForRow(session, selectedRow);
      return searchClients(auth.token, query, auth.baseUrl);
    },
    [session, selectedRow],
  );

  const searchProductOptions = useCallback(
    async (query) => {
      if (!session) return [];
      const auth = resolvePosAuthForRow(session, selectedRow);
      return searchProducts(auth.token, query, auth.baseUrl);
    },
    [session, selectedRow],
  );

  const headerField = (key) => (draft?.header || []).find((field) => field.key === key);

  const filteredRows = useMemo(
    () => (debouncedQuery.trim() ? rows.filter((row) => rowMatchesQuery(row, debouncedQuery)) : rows),
    [rows, debouncedQuery],
  );

  const openDocument = useCallback(
    async (row) => {
      setSelectedRow(row);
      setDraft(buildDraft(row, null));
      setStep('edit');
      setDetailLoading(true);
      setDetailError('');

      const id = ++detailRequestId.current;
      try {
        const auth = resolvePosAuthForRow(session, row);
        const detail = await fetchTransactionDetail(auth.token, {
          type: row.type,
          sourceId: row.sourceId,
          baseUrl: auth.baseUrl,
        });
        if (id !== detailRequestId.current) return;
        const enriched = withLineItems(row, detail);
        setSelectedRow(enriched);
        setDraft(buildDraft(enriched, detail));
      } catch (err) {
        if (id !== detailRequestId.current) return;
        setDetailError(err?.message || 'Could not load full document. You can still edit the summary.');
      } finally {
        if (id === detailRequestId.current) setDetailLoading(false);
      }
    },
    [session],
  );

  const updateHeader = (key, value) => {
    setDraft((current) => ({
      ...current,
      header: current.header.map((field) =>
        field.key === key ? { ...field, value } : field,
      ),
    }));
  };

  const updateItem = (id, part, value) => {
    setDraft((current) => ({
      ...current,
      items: current.items.map((item) =>
        item.id === id ? { ...item, [part]: { ...item[part], value } } : item,
      ),
    }));
  };

  const updatePayment = (id, part, value) => {
    setDraft((current) => ({
      ...current,
      payments: current.payments.map((payment) =>
        payment.id === id ? { ...payment, [part]: { ...payment[part], value } } : payment,
      ),
    }));
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

  const finish = () => {
    if (!selectedRow || !draft) return;
    const amount = String(errorAmount || '').trim();
    const amountLabel = amount
      ? amount.startsWith('$')
        ? amount
        : formatAmount(Number(amount.replace(/[^0-9.-]/g, '')) || amount)
      : '';

    onFinish({
      id: `${selectedRow.id}-${Date.now()}`,
      row: selectedRow,
      draft,
      corrections: collectCorrections(draft),
      note: note.trim(),
      errorType: errorType.trim(),
      errorAmount: amountLabel,
    });
    resetWizard();
  };

  const docLabel = selectedRow?.type === 'purchase' ? 'Purchase order' : 'Sales invoice';
  const title =
    step === 'edit'
      ? selectedRow?.reference || docLabel
      : step === 'note'
        ? 'Describe the error'
        : 'New accuracy review';

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose}>
      <View style={styles.modalBackdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={handleClose} />
        <View style={styles.modalCard}>
          <View style={styles.modalHeader}>
            <View style={styles.modalTitleBlock}>
              {step !== 'pick' ? (
                <Pressable
                  onPress={() => setStep(step === 'note' ? 'edit' : 'pick')}
                  style={styles.backRow}
                  hitSlop={8}
                >
                  <Ionicons name="chevron-back" size={18} color={ACCENT} />
                  <Text style={styles.backText}>Back</Text>
                </Pressable>
              ) : null}
              <Text style={styles.modalTitle}>{title}</Text>
              {step === 'pick' ? (
                <Text style={styles.modalSubtitle}>
                  Last 2 weeks. Search by PO/SO, store, product, employee, item, amount, or
                  customer.
                </Text>
              ) : step === 'edit' ? (
                <Text style={styles.modalSubtitle}>
                  Edit any field. The original stays struck through with the correction under it.
                </Text>
              ) : (
                <Text style={styles.modalSubtitle}>
                  Add a note, the type of error, and the dollar amount, then finish.
                </Text>
              )}
            </View>
            <Pressable onPress={handleClose} hitSlop={8} accessibilityLabel="Close">
              <Ionicons name="close" size={20} color="#6b6b6b" />
            </Pressable>
          </View>

          {step === 'pick' ? (
            <>
              <View style={styles.searchField}>
                <Ionicons name="search" size={16} color="#8e8e93" style={styles.searchIcon} />
                <TextInput
                  style={styles.searchInput}
                  value={query}
                  onChangeText={setQuery}
                  placeholder="PO/SO, store, product, employee, item, amount, or customer"
                  placeholderTextColor="#8e8e93"
                  autoCapitalize="none"
                  autoCorrect={false}
                  clearButtonMode="while-editing"
                />
                {query ? (
                  <Pressable onPress={() => setQuery('')} hitSlop={8}>
                    <Ionicons name="close-circle" size={18} color="#c7c7cc" />
                  </Pressable>
                ) : null}
              </View>

              <View style={styles.dateRow}>
                <DateChip
                  label="From"
                  value={startDate}
                  onChange={handleStartChange}
                  maximumDate={endDate}
                />
                <DateChip
                  label="To"
                  value={endDate}
                  onChange={handleEndChange}
                  minimumDate={startDate}
                  maximumDate={new Date()}
                />
              </View>

              <Text style={styles.modalMeta}>
                {loading && rows.length === 0
                  ? 'Loading…'
                  : `${filteredRows.length}${
                      filteredRows.length !== rows.length || query.trim()
                        ? ` of ${rows.length}`
                        : ''
                    } transaction${filteredRows.length === 1 ? '' : 's'}`}
              </Text>

              {error ? <Text style={styles.errorText}>{error}</Text> : null}
              {warning ? <Text style={styles.warnText}>{warning}</Text> : null}

              <View style={styles.tableShell}>
                <PickTableHeader />
                {loading && rows.length === 0 ? (
                  <View style={styles.modalLoading}>
                    <ActivityIndicator color={ACCENT} />
                  </View>
                ) : (
                  <WindowedPickList
                    data={filteredRows}
                    selectedIds={selectedIds}
                    onPress={openDocument}
                    emptyText={
                      query.trim()
                        ? `No purchases or sales match “${query.trim()}”.`
                        : 'No purchases or sales in the last 2 weeks.'
                    }
                  />
                )}
              </View>
            </>
          ) : null}

          {step === 'edit' ? (
            <>
              {detailLoading ? (
                <View style={styles.inlineBusy}>
                  <ActivityIndicator color={ACCENT} />
                  <Text style={styles.modalMeta}>Loading document…</Text>
                </View>
              ) : null}
              {detailError ? <Text style={styles.warnText}>{detailError}</Text> : null}

              <ScrollView
                style={styles.modalList}
                contentContainerStyle={styles.editContent}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                {headerField('customer') ? (
                  addingCustomer ? (
                    <NewCustomerPanel
                      token={resolvePosAuthForRow(session, selectedRow).token}
                      baseUrl={resolvePosAuthForRow(session, selectedRow).baseUrl}
                      onCancel={() => setAddingCustomer(false)}
                      onCreated={(created) => {
                        updateHeader('customer', created.label);
                        setAddingCustomer(false);
                      }}
                    />
                  ) : (
                    <LookupField
                      label={headerField('customer').label}
                      field={headerField('customer')}
                      onSearch={searchCustomerOptions}
                      onChange={(value) => updateHeader('customer', value)}
                      placeholder="Search customers"
                      rightAction={
                        <Pressable
                          style={styles.newSideButton}
                          onPress={() => setAddingCustomer(true)}
                          accessibilityLabel="New customer"
                        >
                          <Ionicons name="add" size={16} color="#fff" />
                          <Text style={styles.newSideButtonText}>New</Text>
                        </Pressable>
                      }
                    />
                  )
                ) : null}

                {headerField('store') ? (
                  <LookupField
                    label="Store"
                    field={headerField('store')}
                    options={locations}
                    pickOnly
                    onChange={(value) => updateHeader('store', value)}
                    placeholder="Select a store"
                  />
                ) : null}

                {headerField('employee') ? (
                  <LookupField
                    label="Employee"
                    field={headerField('employee')}
                    options={employees}
                    pickOnly
                    onChange={(value) => updateHeader('employee', value)}
                    placeholder="Select an employee"
                  />
                ) : null}

                {headerField('date') ? (
                  <CorrectableField
                    label="Date"
                    field={headerField('date')}
                    onChange={(value) => updateHeader('date', value)}
                  />
                ) : null}

                {headerField('total') ? (
                  <CorrectableField
                    label="Total"
                    field={headerField('total')}
                    onChange={(value) => updateHeader('total', value)}
                  />
                ) : null}

                <Text style={styles.sectionLabel}>Line items</Text>
                {(draft?.items || []).length === 0 ? (
                  <Text style={styles.modalEmpty}>No line items</Text>
                ) : (
                  <View style={styles.lineTable}>
                    <View
                      style={styles.lineTableHeader}
                      {...(Platform.OS === 'web' ? { className: 'cgold-triage-line-grid' } : null)}
                    >
                      <View style={styles.lineColProduct}>
                        <Text style={styles.lineTh}>Product</Text>
                      </View>
                      <View style={styles.lineColQty}>
                        <Text style={styles.lineTh}>Qty</Text>
                      </View>
                      <View style={styles.lineColAmount}>
                        <Text style={[styles.lineTh, styles.colAmountText]}>Amount</Text>
                      </View>
                    </View>
                    {draft.items.map((item) => (
                      <View
                        key={item.id}
                        style={styles.lineTableRow}
                        {...(Platform.OS === 'web' ? { className: 'cgold-triage-line-grid' } : null)}
                      >
                        <View style={styles.lineColProduct}>
                          <LookupField
                            hideLabel
                            compact
                            field={item.name}
                            onSearch={searchProductOptions}
                            allowCustom
                            onChange={(value) => updateItem(item.id, 'name', value)}
                            placeholder="Search product or type custom"
                          />
                        </View>
                        <View style={styles.lineColQty}>
                          <CorrectableField
                            hideLabel
                            compact
                            field={item.qty}
                            onChange={(value) => updateItem(item.id, 'qty', value)}
                          />
                        </View>
                        <View style={styles.lineColAmount}>
                          <CorrectableField
                            hideLabel
                            compact
                            field={item.amount}
                            onChange={(value) => updateItem(item.id, 'amount', value)}
                          />
                        </View>
                      </View>
                    ))}
                  </View>
                )}

                {(draft?.payments || []).length > 0 ? (
                  <>
                    <Text style={styles.sectionLabel}>Payments</Text>
                    {draft.payments.map((payment, index) => (
                      <View key={payment.id} style={styles.itemCard}>
                        <Text style={styles.itemIndex}>Payment {index + 1}</Text>
                        <CorrectableField
                          label="Method"
                          field={payment.method}
                          onChange={(value) => updatePayment(payment.id, 'method', value)}
                        />
                        <CorrectableField
                          label="Amount"
                          field={payment.amount}
                          onChange={(value) => updatePayment(payment.id, 'amount', value)}
                        />
                      </View>
                    ))}
                  </>
                ) : null}
              </ScrollView>

              <Pressable style={styles.primaryButton} onPress={() => setStep('note')}>
                <Text style={styles.primaryButtonText}>Next</Text>
              </Pressable>
            </>
          ) : null}

          {step === 'note' ? (
            <ScrollView
              style={styles.modalList}
              contentContainerStyle={styles.editContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <Text style={styles.fieldLabel}>Note</Text>
              <TextInput
                style={[styles.fieldInput, styles.noteInput]}
                value={note}
                onChangeText={setNote}
                placeholder="Describe the error"
                placeholderTextColor="#c7c7cc"
                multiline
                textAlignVertical="top"
              />

              <Text style={styles.fieldLabel}>Type of error</Text>
              <TextInput
                style={styles.fieldInput}
                value={errorType}
                onChangeText={setErrorType}
                placeholder="Describe the type of error"
                placeholderTextColor="#c7c7cc"
                autoCapitalize="sentences"
              />
              <View style={styles.typeChips}>
                {ERROR_TYPES.map((type) => {
                  const active = errorType === type;
                  return (
                    <Pressable
                      key={type}
                      style={[styles.typeChip, active && styles.typeChipActive]}
                      onPress={() => setErrorType(type)}
                    >
                      <Text style={[styles.typeChipText, active && styles.typeChipTextActive]}>
                        {type}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={styles.fieldLabel}>Amount</Text>
              <View style={styles.amountBox}>
                <Text style={styles.amountPrefix}>$</Text>
                <TextInput
                  style={styles.amountInput}
                  value={errorAmount.replace(/^\$/, '')}
                  onChangeText={(value) => setErrorAmount(value.replace(/[^0-9.]/g, ''))}
                  placeholder="0.00"
                  placeholderTextColor="#c7c7cc"
                  keyboardType="decimal-pad"
                />
              </View>

              <Pressable style={styles.primaryButton} onPress={finish}>
                <Text style={styles.primaryButtonText}>Finish</Text>
              </Pressable>
            </ScrollView>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

function AccuracyPanel({ session, onRequireLogin, entries, onRemove, onNew }) {
  if (!session?.token) {
    return (
      <View style={styles.panel}>
        <View style={styles.emptyIcon}>
          <Ionicons name="checkmark-done-outline" size={22} color={ACCENT} />
        </View>
        <Text style={styles.emptyTitle}>Accuracy</Text>
        <Text style={styles.emptyBody}>Log in to review purchases and sales.</Text>
        <Pressable style={styles.loginButton} onPress={onRequireLogin}>
          <Text style={styles.loginButtonText}>Go to Profile</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.accuracyBody}>
      <View style={styles.accuracyToolbar}>
        <Pressable
          style={styles.newButton}
          onPress={onNew}
          accessibilityRole="button"
          accessibilityLabel="New"
        >
          <Ionicons name="add" size={18} color="#fff" />
          <Text style={styles.newButtonText}>New</Text>
        </Pressable>
      </View>
      {entries.length === 0 ? (
        <View style={styles.panel}>
          <View style={styles.emptyIcon}>
            <Ionicons name="checkmark-done-outline" size={22} color={ACCENT} />
          </View>
          <Text style={styles.emptyTitle}>Accuracy</Text>
          <Text style={styles.emptyBody}>
            Tap New to pick a purchase or sale, correct it, and save the review.
          </Text>
        </View>
      ) : (
        <ScrollView
          style={styles.accuracyList}
          contentContainerStyle={styles.accuracyListContent}
          showsVerticalScrollIndicator={false}
        >
          {entries.map((entry) => (
            <AccuracyReviewLine key={entry.id} entry={entry} onRemove={onRemove} />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

export default function TriageScreen({
  session,
  onRequireLogin,
  storeFilter,
  embedded = false,
}) {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [modalOpen, setModalOpen] = useState(false);
  const [entries, setEntries] = useState([]);
  const currentTab = TRIAGE_TABS.find((tab) => tab.key === activeTab) || TRIAGE_TABS[0];
  const selectedIds = useMemo(() => new Set(entries.map((entry) => entry.row.id)), [entries]);

  const finishEntry = useCallback((entry) => {
    setEntries((current) => [entry, ...current]);
    setModalOpen(false);
  }, []);

  const removeEntry = useCallback((id) => {
    setEntries((current) => current.filter((entry) => entry.id !== id));
  }, []);

  return (
    <View style={[styles.body, embedded && styles.bodyEmbedded]}>
      <TabBar
        options={TRIAGE_TABS}
        value={activeTab}
        onChange={setActiveTab}
      />

      {activeTab === 'accuracy' ? (
        <AccuracyPanel
          session={session}
          onRequireLogin={onRequireLogin}
          entries={entries}
          onRemove={removeEntry}
          onNew={() => setModalOpen(true)}
        />
      ) : (
        <TabPanel tab={currentTab} />
      )}

      <NewAccuracyModal
        visible={modalOpen}
        session={session}
        storeFilter={storeFilter}
        selectedIds={selectedIds}
        onClose={() => setModalOpen(false)}
        onFinish={finishEntry}
      />
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
  tabBar: {
    flexShrink: 0,
    marginTop: 22,
    marginBottom: 14,
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 2,
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
  panel: {
    flex: 1,
    minHeight: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingBottom: 48,
  },
  emptyIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: '#FFEDD5',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  emptyTitle: {
    fontFamily,
    fontSize: 20,
    fontWeight: '600',
    color: TEXT,
    letterSpacing: -0.3,
    marginBottom: 6,
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
    marginTop: 16,
    backgroundColor: '#1a1a1a',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  loginButtonText: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },
  accuracyBody: {
    flex: 1,
    minHeight: 0,
  },
  accuracyToolbar: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  newButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: ACCENT,
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
  accuracyList: {
    flex: 1,
    minHeight: 0,
  },
  accuracyListContent: {
    gap: 10,
    paddingBottom: 24,
  },
  savedCard: {
    backgroundColor: '#f5f5f7',
    borderRadius: 12,
    padding: 14,
    gap: 10,
  },
  savedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  savedCorrections: {
    gap: 8,
  },
  savedCorrection: {
    gap: 2,
  },
  savedMuted: {
    fontFamily,
    fontSize: 13,
    color: SECONDARY,
  },
  savedBlock: {
    gap: 4,
  },
  savedNote: {
    fontFamily,
    fontSize: 15,
    lineHeight: 21,
    color: TEXT,
  },
  savedAmount: {
    fontFamily,
    fontSize: 16,
    fontWeight: '600',
    color: TEXT,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
  },
  modalCard: {
    width: '96%',
    maxWidth: 1280,
    height: '92%',
    maxHeight: '92%',
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 18,
    gap: 10,
    flexDirection: 'column',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  modalTitleBlock: {
    flex: 1,
    minWidth: 0,
  },
  modalTitle: {
    fontFamily,
    fontSize: 18,
    fontWeight: '600',
    color: TEXT,
    letterSpacing: -0.3,
  },
  modalSubtitle: {
    fontFamily,
    fontSize: 13,
    lineHeight: 18,
    color: SECONDARY,
    marginTop: 4,
  },
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
    alignSelf: 'flex-start',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  backText: {
    fontFamily,
    fontSize: 14,
    fontWeight: '600',
    color: ACCENT,
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
  dateRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  dateChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: FILL,
    borderRadius: 6,
    paddingHorizontal: 10,
    height: 36,
  },
  dateChipLabel: {
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
    color: SECONDARY,
  },
  dateChipControl: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dateChipValue: {
    fontFamily,
    fontSize: 13,
    color: TEXT,
  },
  dateModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  dateModalCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 12,
  },
  dateModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  dateModalTitle: {
    fontFamily,
    fontSize: 16,
    fontWeight: '600',
    color: TEXT,
  },
  dateModalDone: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: ACCENT,
  },
  modalMeta: {
    fontFamily,
    fontSize: 13,
    color: SECONDARY,
  },
  errorText: {
    fontFamily,
    fontSize: 13,
    color: '#B91C1C',
  },
  warnText: {
    fontFamily,
    fontSize: 13,
    color: '#B45309',
  },
  modalList: {
    flexGrow: 1,
    minHeight: 0,
    flex: 1,
  },
  tableShell: {
    flex: 1,
    minHeight: 0,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: HAIRLINE,
    borderRadius: 6,
    overflow: 'hidden',
  },
  tableHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    minHeight: 36,
    paddingHorizontal: 12,
    backgroundColor: '#ebebf0',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#d1d1d6',
  },
  tableHeaderCell: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: SECONDARY,
    letterSpacing: -0.08,
  },
  tableBody: {
    flex: 1,
    minHeight: 0,
  },
  tableList: {
    flex: 1,
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    minHeight: PICK_ROW_HEIGHT,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HAIRLINE,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  tableRowSelected: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    minHeight: PICK_ROW_HEIGHT,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HAIRLINE,
    backgroundColor: '#FFF7ED',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  pickCol: {
    minWidth: 0,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  pickColRight: {
    alignItems: 'flex-end',
  },
  cellText: {
    fontFamily,
    fontSize: 14,
    color: TEXT,
    letterSpacing: -0.2,
  },
  cellMuted: {
    color: '#6e6e73',
  },
  cellStrong: {
    fontWeight: '500',
  },
  cellRefInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minWidth: 0,
  },
  cellRefText: {
    flex: 1,
    minWidth: 0,
  },
  colDate: {
    width: '12%',
    paddingRight: 12,
  },
  colRef: {
    width: '16%',
    paddingRight: 12,
  },
  colStore: {
    width: '16%',
    paddingRight: 12,
  },
  colCustomer: {
    width: '24%',
    paddingRight: 12,
  },
  colEmployee: {
    width: '16%',
    paddingRight: 12,
  },
  colAmount: {
    width: '16%',
    paddingRight: 0,
  },
  colAmountText: {
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  lineTable: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: HAIRLINE,
    borderRadius: 6,
    overflow: 'visible',
    backgroundColor: '#fff',
  },
  lineTableHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    minHeight: 36,
    paddingHorizontal: 10,
    backgroundColor: '#ebebf0',
    borderTopLeftRadius: 6,
    borderTopRightRadius: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#d1d1d6',
  },
  lineTh: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: SECONDARY,
    letterSpacing: -0.08,
  },
  lineTableRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    width: '100%',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HAIRLINE,
  },
  lineColProduct: {
    flex: 1,
    minWidth: 0,
    paddingRight: 10,
  },
  lineColQty: {
    width: 88,
    flexGrow: 0,
    flexShrink: 0,
    paddingRight: 10,
  },
  lineColAmount: {
    width: 120,
    flexGrow: 0,
    flexShrink: 0,
  },
  editContent: {
    gap: 10,
    paddingBottom: 8,
  },
  inlineBusy: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sectionLabel: {
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
    color: SECONDARY,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginTop: 6,
  },
  fieldBlock: {
    gap: 4,
  },
  fieldBlockCompact: {
    flex: 1,
    minWidth: 0,
  },
  fieldLabel: {
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
    color: SECONDARY,
  },
  fieldInput: {
    fontFamily,
    fontSize: 16,
    color: TEXT,
    backgroundColor: FILL,
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    outlineStyle: 'none',
  },
  fieldInputCorrected: {
    backgroundColor: '#FFF7ED',
    color: ACCENT,
    fontWeight: '600',
  },
  fieldInputCompact: {
    minWidth: 0,
    width: '100%',
    paddingVertical: 8,
    paddingHorizontal: 10,
    fontSize: 15,
  },
  lookupBlock: {
    zIndex: 4,
  },
  lookupRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  lookupInputWrap: {
    flex: 1,
    minWidth: 0,
    position: 'relative',
  },
  lookupSpinner: {
    position: 'absolute',
    right: 10,
    top: 12,
  },
  lookupMenu: {
    marginTop: 4,
    backgroundColor: '#fff',
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: HAIRLINE,
    maxHeight: 220,
    overflow: 'hidden',
    zIndex: 8,
    ...Platform.select({
      web: { boxShadow: '0 8px 20px rgba(0,0,0,0.08)' },
      default: { elevation: 3 },
    }),
  },
  lookupOption: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HAIRLINE,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  lookupOptionLabel: {
    fontFamily,
    fontSize: 15,
    color: TEXT,
  },
  lookupOptionSub: {
    fontFamily,
    fontSize: 12,
    color: SECONDARY,
    marginTop: 1,
  },
  lookupEmpty: {
    fontFamily,
    fontSize: 13,
    color: SECONDARY,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  newSideButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: ACCENT,
    borderRadius: 6,
    paddingHorizontal: 10,
    height: 42,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  newSideButtonText: {
    fontFamily,
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  newCustomerCard: {
    backgroundColor: '#f5f5f7',
    borderRadius: 6,
    padding: 12,
    gap: 8,
  },
  newCustomerActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  secondaryButton: {
    flex: 1,
    height: 44,
    borderRadius: 6,
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
  primaryButtonInline: {
    flex: 1,
  },
  primaryButtonDisabled: {
    opacity: 0.6,
  },
  struckText: {
    fontFamily,
    fontSize: 14,
    color: STRUCK,
    textDecorationLine: 'line-through',
  },
  correctedText: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: ACCENT,
  },
  correctionPair: {
    gap: 2,
  },
  itemCard: {
    backgroundColor: '#f5f5f7',
    borderRadius: 6,
    padding: 10,
    gap: 8,
    overflow: 'visible',
    zIndex: 2,
  },
  itemIndex: {
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
    color: SECONDARY,
  },
  itemRow: {
    flexDirection: 'row',
    gap: 8,
  },
  noteInput: {
    minHeight: 110,
    paddingTop: 10,
  },
  typeChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  typeChip: {
    backgroundColor: FILL,
    borderRadius: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  typeChipActive: {
    backgroundColor: '#FFEDD5',
  },
  typeChipText: {
    fontFamily,
    fontSize: 13,
    color: '#6b6b6b',
  },
  typeChipTextActive: {
    color: ACCENT,
    fontWeight: '600',
  },
  amountBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: FILL,
    borderRadius: 6,
    paddingHorizontal: 12,
    minHeight: 46,
  },
  amountPrefix: {
    fontFamily,
    fontSize: 18,
    fontWeight: '600',
    color: TEXT,
    marginRight: 6,
  },
  amountInput: {
    flex: 1,
    fontFamily,
    fontSize: 18,
    fontWeight: '600',
    color: TEXT,
    paddingVertical: 10,
    outlineStyle: 'none',
  },
  primaryButton: {
    backgroundColor: ACCENT,
    borderRadius: 6,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  primaryButtonText: {
    fontFamily,
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  modalLoading: {
    paddingVertical: 36,
    alignItems: 'center',
  },
  modalEmpty: {
    fontFamily,
    fontSize: 14,
    color: SECONDARY,
    textAlign: 'center',
    paddingVertical: 28,
  },
  txRowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 1,
  },
  txKind: {
    fontFamily,
    fontSize: 11,
    fontWeight: '700',
    color: '#2F6FED',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  txKindBuy: {
    color: ACCENT,
  },
  txRef: {
    fontFamily,
    fontSize: 14,
    fontWeight: '600',
    color: TEXT,
  },
  txStore: {
    fontFamily,
    fontSize: 13,
    color: SECONDARY,
    flexShrink: 1,
  },
  txMeta: {
    fontFamily,
    fontSize: 13,
    color: SECONDARY,
  },
  txItems: {
    fontFamily,
    fontSize: 13,
    color: TEXT,
    marginTop: 2,
  },
  txRowSide: {
    alignItems: 'flex-end',
    gap: 4,
    paddingTop: 1,
  },
  txAmount: {
    fontFamily,
    fontSize: 14,
    fontWeight: '600',
    color: TEXT,
  },
});
