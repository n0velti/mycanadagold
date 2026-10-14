import { cloneElement, createElement, isValidElement, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ActivityIndicator,
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
import { Ionicons } from '@expo/vector-icons';
import LowReviewMark from './LowReviewMark';
import { fetchStoreCashPosition, peekStoreCashPosition } from '../lib/cashTill';
import {
  checkTransactionPrices,
  formatPriceTolerance,
  isBullionResaleLine,
  isScrapJewelleryLine,
} from '../lib/priceCheck';
import {
  capturePurchasePriceCatalog,
  loadTransactionPriceSnapshots,
  peekPriceCatalogSnapshot,
  usePriceCheckTolerance,
} from '../lib/priceCheckSettings';
import { AUREUS_CASH_LIVE_MS, INVENTORY_LIVE_MS, useLiveRefresh } from '../lib/liveRefresh';
import { fetchInventoryMatrix, formatQty, peekInventoryMatrix } from '../lib/inventory';
import { inventoryDisplayName, inventoryPriceSpreads, inventoryRowWebsitePrice } from '../lib/inventoryPrices';
import { textMatchesQuery } from '../lib/itemSearch';
import { findStaffByEmployeeName, listStaffProfiles, useAppAccess } from '../lib/permissions';
import { initialsFor } from '../lib/rippling';
import {
  buildEmailCaptureByStore,
  formatAmount,
  formatDateParam,
  parseDateParam,
} from '../lib/transactions';
import { useTxnCashBreakdowns } from '../lib/txnCashBreakdowns';
import {
  callsForStore,
  fetchPhoneHistory,
  inboundCallRatio,
  mergeCallLog,
  peekPhoneHistory,
  phoneHistoryNeeded,
} from '../lib/phoneCalls';
import { fetchTransferStores, preferStoreByName } from '../lib/locations';
import { formatPhoneNumber } from '../lib/ringcentral';
import { storeKeyFromName } from '../lib/storeSettings';
import { fetchWebsitePrices } from '../lib/websitePrices';
import {
  fetchGoogleReviewsForStore,
  peekHomeStoreReviews,
  rememberHomeStoreReviews,
  reviewStatsFromReviews,
} from '../lib/googleReviews';
import { CANVAS, MOBILE, MOBILE_FILTER_INSET, MOBILE_FILTER_SIZE, NAV_TAB_ACTIVE_RADIUS, useIsMobile } from '../lib/mobileUi';
import { useDisplayCurrency } from '../lib/displayCurrency';
import { mobileTabBarReserve, useMobileTabBarScrollProps } from '../lib/mobileTabBar';
import { FONT_LIGHT } from '../lib/typography';
import { usePhoneCalls } from './PhoneCallProvider';
import TxnCashBreakdownModal from './TxnCashBreakdownModal';

const fontFamily = Platform.select({
  ios: 'Sohne',
  android: 'Sohne',
  default: 'Sohne',
});

const LABEL = '#1a1a1a';
const SECONDARY = '#8e8e93';
const FILL = 'rgba(118, 118, 128, 0.12)';
const SEPARATOR = '#d0d0d0';
const TAB_BORDER = '#d0d0d0';
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
const BLUE = '#007AFF';
const GREEN = '#34C759';
const RED = '#FF3B30';
const SO_BLUE = '#2F6FED';
const PO_AMBER = '#C47A12';

const PRIORITY_COLORS = {
  green: GREEN,
  yellow: '#FF9F0A',
  red: RED,
};

// Stores can carry hundreds of stocked SKUs; render a page at a time so the
// drawer opens quickly and scrolls smoothly.
const INVENTORY_PAGE = 12;
const HOME_STORE_ROW_PAD = 8;
const HOME_STORE_ICON_COL_WIDTH = 56;
const HOME_STORE_BODY_LEADING = 12;
const titleFontFamily = FONT_LIGHT;

function sameJson(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

// Functional setState helper: keep the previous value (and skip the re-render)
// when a live refresh returns identical data.
function keepIfSame(next) {
  return (current) => (sameJson(current, next) ? current : next);
}

function namesMatch(a, b) {
  return (
    String(a || '')
      .trim()
      .localeCompare(String(b || '').trim(), undefined, { sensitivity: 'base' }) === 0
  );
}

const SNAPSHOT_APPS = {
  financials: { key: 'financials', label: 'Financials', icon: 'wallet-outline', accent: '#3D8B4F' },
  inventory: { key: 'inventory', label: 'Inventory', icon: 'cube-outline', accent: '#C47A12' },
  employees: { key: 'employees', label: 'Employees', icon: 'people-outline', accent: '#1D4ED8' },
  phone: { key: 'phone', label: 'Phone', icon: 'call-outline', accent: '#15803D' },
  emails: { key: 'emails', label: 'Emails', icon: 'mail-outline', accent: '#4338CA' },
  bonuses: { key: 'bonuses', label: 'Bonuses', icon: 'gift-outline', accent: '#A16207' },
  transactions: { key: 'transactions', label: 'Transactions', icon: 'swap-horizontal-outline', accent: '#2F6FED' },
  preorders: { key: 'preorders', label: 'Preorders', icon: 'cart-outline', accent: '#EA580C' },
  audit: { key: 'audit', label: 'Audit', icon: 'clipboard-outline', accent: '#2F8A4E' },
  triage: { key: 'triage', label: 'Triage', icon: 'medkit-outline', accent: '#C2410C' },
  supplies: { key: 'supplies', label: 'Supplies', icon: 'bag-handle-outline', accent: '#BE123C' },
  settings: { key: 'settings', label: 'Settings', icon: 'settings-outline', accent: '#52525B' },
};

const EMPLOYEE_TABLE_COLS = [
  { key: 'name', label: 'Employee', colStyle: 'appColMain' },
  { key: 'role', label: 'Role', colStyle: 'appColMid' },
  { key: 'tx', label: 'Transactions', colStyle: 'appColEnd', end: true },
];
const EMAIL_TABLE_COLS = [
  { key: 'person', label: 'Person', colStyle: 'appColMain' },
  { key: 'email', label: 'Email', colStyle: 'appColWide' },
  { key: 'employee', label: 'Employee', colStyle: 'appColMid' },
];
const CASH_TABLE_COLS = [
  { key: 'kind', label: 'Type', colStyle: 'appColMid' },
  { key: 'who', label: 'Customer', colStyle: 'appColMain' },
  { key: 'ref', label: 'Reference', colStyle: 'appColMid' },
  { key: 'amount', label: 'Amount', colStyle: 'appColEnd', end: true },
];
const PREORDER_TABLE_COLS = [
  { key: 'customer', label: 'Customer', colStyle: 'appColMain' },
  { key: 'item', label: 'Item', colStyle: 'appColWide' },
  { key: 'status', label: 'Status', colStyle: 'appColMid' },
  { key: 'amount', label: 'Amount', colStyle: 'appColEnd', end: true },
];

function filledIonicon(name) {
  return typeof name === 'string' && name.endsWith('-outline') ? name.slice(0, -8) : name;
}

function hasDrawerActivity(drawer) {
  if (!drawer) return false;
  return (
    Math.abs(drawer.openingBalance || 0) > 0 ||
    Math.abs(drawer.expectedOnHand || 0) > 0 ||
    Math.abs(drawer.aureusOnHand || 0) > 0 ||
    Math.abs(drawer.movementNet || 0) > 0 ||
    (drawer.paymentRows || []).length > 0 ||
    (drawer.cashTransactions || []).length > 0
  );
}

function staffDisplayName(row) {
  return (
    row?.fullName ||
    [row?.firstName, row?.lastName].filter(Boolean).join(' ') ||
    row?.email ||
    'Staff'
  );
}

function personMatchesStore(person, storeName) {
  const store = String(storeName || '').trim().toLowerCase();
  const location = String(person?.locationName || '').trim().toLowerCase();
  if (!store || !location) return false;
  if (location === store) return true;
  return location.includes(store) || store.includes(location);
}

function personMatchesTxName(person, employeeName) {
  const name = String(employeeName || '').trim();
  if (!name || name === '—') return false;
  return (
    namesMatch(staffDisplayName(person), name) ||
    namesMatch(person?.fullName, name) ||
    namesMatch([person?.firstName, person?.lastName].filter(Boolean).join(' '), name)
  );
}

function formatScrapGrams(grams) {
  const n = Number(grams);
  if (!Number.isFinite(n)) return '';
  const text = n.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
  return `${text}g`;
}

function itemMatches(row, query) {
  const q = String(query || '').trim();
  if (!q) return true;
  return textMatchesQuery(row?.name, q) || textMatchesQuery(row?.sku, q);
}

function productKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\bgrams?\b/g, 'g')
    .replace(/\bounces?\b/g, 'oz')
    .replace(/[^a-z0-9]+/g, '');
}

/**
 * Exact match only: the POS product id when the ticket line carries one,
 * otherwise the full product name / SKU. No fuzzy search, so "SML 1oz" does
 * not pull in "SML 1oz DNA" tickets.
 */
function transactionHasItem(tx, item) {
  if (!tx || !item?.id) return false;
  const lines = Array.isArray(tx.pricedLines) ? tx.pricedLines : [];
  const id = String(item.id);
  if (lines.some((line) => line?.productId && String(line.productId) === id)) return true;
  if (lines.some((line) => line?.productId)) {
    // Every line is identified; the id simply is not this product.
    if (lines.every((line) => line?.productId)) return false;
  }
  const keys = new Set([productKey(item.name), productKey(item.sku)].filter(Boolean));
  if (!keys.size) return false;
  const candidates = [
    ...lines.flatMap((line) => [line?.productName, line?.sku, line?.name]),
    ...(Array.isArray(tx.itemNames) ? tx.itemNames : []),
  ];
  return candidates.some((value) => {
    const key = productKey(value);
    return key && keys.has(key);
  });
}

function txMatches(row, query) {
  const q = String(query || '').trim();
  if (!q) return true;
  return (
    textMatchesQuery(row?.customerName, q) ||
    textMatchesQuery(row?.reference, q) ||
    textMatchesQuery(row?.employeeName, q) ||
    textMatchesQuery(row?.amountLabel, q) ||
    textMatchesQuery(row?.paymentMethodLabel, q) ||
    textMatchesQuery(itemSummaryLabel(row), q) ||
    textMatchesQuery(firstItemLineLabel(row), q) ||
    textMatchesQuery(row?.type === 'purchase' ? 'PO purchase' : 'SO sale', q)
  );
}

function txRefLabel(row) {
  const kind = txKindLabel(row);
  const number = txNumberLabel(row);
  if (number === '—') return kind;
  return `${kind} ${number}`;
}

function txKindLabel(row) {
  const reference = String(row?.reference || '').trim();
  const match = reference.match(/\b(SO|PO)\b/i);
  if (match) return match[1].toUpperCase();
  return row?.type === 'purchase' ? 'PO' : 'SO';
}

function txNumberLabel(row) {
  const reference = String(row?.reference || '').trim();
  const numbered = reference.match(/(?:SO|PO)\s*#?\s*([A-Za-z0-9-]+)/i);
  if (numbered?.[1]) return numbered[1];
  const stripped = reference.replace(/^(SO|PO)\s*#?\s*/i, '').trim();
  return stripped || '—';
}

function txItemLabel(row) {
  return itemSummaryLabel(row) || firstItemLineLabel(row) || row?.paymentMethodLabel || '—';
}

function txEmployeeLabel(row) {
  return String(row?.employeeName || '').trim() || '—';
}

const OVERVIEW_TX_FILTERS = [
  { key: 'customerName', label: 'Customer', colStyle: 'storeTxColCustomer', value: (row) => row?.customerName || '—' },
  { key: 'kind', label: 'PO/SO', colStyle: 'storeTxColKind', value: txKindLabel },
  { key: 'number', label: 'Order', colStyle: 'storeTxColNumber', value: txNumberLabel },
  { key: 'timeLabel', label: 'Time', colStyle: 'storeTxColTime', value: (row) => row?.timeLabel || '—' },
  { key: 'item', label: 'Item', colStyle: 'storeTxColItem', value: txItemLabel },
  { key: 'employeeName', label: 'Employee', colStyle: 'storeTxColEmployee', value: txEmployeeLabel },
  { key: 'amountLabel', label: 'Amount', colStyle: 'storeTxColAmount', value: (row) => row?.amountLabel || '—', end: true },
];

function buildOverviewTxOptions(rows) {
  const options = {};
  for (const col of OVERVIEW_TX_FILTERS) {
    const seen = new Set();
    for (const row of rows || []) seen.add(col.value(row));
    options[col.key] = Array.from(seen).sort((a, b) =>
      String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' }),
    );
  }
  return options;
}

const TX_FILTER_MENU_WIDTH = 220;
const TX_FILTER_MENU_MAX_HEIGHT = 280;

function measurePressable(event, onMeasure) {
  const node = event?.currentTarget;
  if (node?.measureInWindow) {
    node.measureInWindow((x, y, width, height) => {
      if (Number.isFinite(x) && Number.isFinite(y)) onMeasure({ x, y, width, height });
    });
    return;
  }
  if (Platform.OS === 'web' && node?.getBoundingClientRect) {
    const rect = node.getBoundingClientRect();
    onMeasure({ x: rect.left, y: rect.top, width: rect.width, height: rect.height });
  }
}

function OverviewTxHeaderCell({ label, colStyle, active, onPress, end = false, iconOnly = false }) {
  return (
    <Pressable
      onPress={(event) => measurePressable(event, (anchor) => onPress?.(anchor))}
      style={({ hovered, pressed }) => [
        styles.overviewTxFilterCell,
        colStyle,
        (hovered || pressed) && styles.overviewTxFilterCellHover,
      ]}
      accessibilityRole="button"
      accessibilityLabel={`Filter ${label}`}
    >
      {iconOnly ? null : (
        <Text
          style={[styles.storeTxHeader, styles.overviewTxFilterLabel, active && styles.overviewTxFilterLabelActive]}
        >
          {label}
        </Text>
      )}
      <Ionicons
        name={active ? 'filter' : 'filter-outline'}
        size={12}
        color={active ? MOBILE.label : '#aeaeb2'}
      />
    </Pressable>
  );
}

function TxColumnFilterMenu({ label, options, filter, onChange, onClose, anchor, alignEnd = false }) {
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const [search, setSearch] = useState('');
  const allValues = options || [];
  const selectedCount = filter == null ? allValues.length : Object.keys(filter).length;
  const allSelected = filter == null;
  const noneSelected = filter != null && selectedCount === 0;
  const visibleOptions = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allValues;
    return allValues.filter((value) => String(value).toLowerCase().includes(q));
  }, [allValues, search]);
  const isChecked = (value) => (filter == null ? true : Boolean(filter[value]));
  const toggleValue = (value) => {
    const nextSelected = new Set(filter == null ? allValues : Object.keys(filter));
    if (nextSelected.has(value)) nextSelected.delete(value);
    else nextSelected.add(value);
    if (nextSelected.size === allValues.length) {
      onChange(null);
      return;
    }
    const next = {};
    nextSelected.forEach((item) => {
      next[item] = true;
    });
    onChange(next);
  };

  const preferredLeft =
    alignEnd && anchor
      ? Number(anchor.x) + Number(anchor.width) - TX_FILTER_MENU_WIDTH
      : Number(anchor?.x) || 8;
  const left = Math.min(
    Math.max(8, preferredLeft),
    Math.max(8, windowWidth - TX_FILTER_MENU_WIDTH - 8),
  );
  const below = (Number(anchor?.y) || 0) + (Number(anchor?.height) || 0) + 4;
  const top =
    below + TX_FILTER_MENU_MAX_HEIGHT > windowHeight - 8
      ? Math.max(8, (Number(anchor?.y) || 0) - TX_FILTER_MENU_MAX_HEIGHT - 4)
      : below;

  const menu = (
    <View
      style={[styles.txFilterMenu, { top, left }]}
      accessibilityLabel={`${label} filter`}
    >
      <View style={styles.txFilterField}>
        <Ionicons name="search-outline" size={14} color="#8e8e93" />
        <TextInput
          style={styles.txFilterFieldInput}
          value={search}
          onChangeText={setSearch}
          placeholder="Search"
          placeholderTextColor="#999"
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus={Platform.OS === 'web'}
        />
        {search ? (
          <Pressable onPress={() => setSearch('')} hitSlop={8}>
            <Ionicons name="close-circle" size={13} color="#b0b0b0" />
          </Pressable>
        ) : null}
      </View>
      <View style={styles.txFilterActions}>
        <Pressable onPress={() => onChange(null)} disabled={allSelected}>
          <Text style={[styles.txFilterActionText, allSelected && styles.txFilterActionDisabled]}>
            Select all
          </Text>
        </Pressable>
        <Text style={styles.txFilterActionSep}>·</Text>
        <Pressable onPress={() => onChange({})} disabled={noneSelected}>
          <Text style={[styles.txFilterActionText, noneSelected && styles.txFilterActionDisabled]}>
            Clear
          </Text>
        </Pressable>
      </View>
      <ScrollView style={styles.txFilterList} keyboardShouldPersistTaps="handled">
        {visibleOptions.length === 0 ? (
          <Text style={styles.txFilterEmpty}>No matching values</Text>
        ) : (
          visibleOptions.map((item) => {
            const checked = isChecked(item);
            return (
              <Pressable
                key={String(item)}
                onPress={() => toggleValue(item)}
                style={({ hovered, pressed }) => [
                  styles.txFilterOption,
                  (hovered || pressed) && styles.overviewStatsRowHover,
                ]}
                accessibilityRole="checkbox"
                accessibilityState={{ checked }}
              >
                <Ionicons
                  name={checked ? 'checkbox' : 'square-outline'}
                  size={16}
                  color={checked ? '#1d1d1f' : '#c7c7cc'}
                />
                <Text style={styles.txFilterOptionText} numberOfLines={1}>
                  {item}
                </Text>
              </Pressable>
            );
          })
        )}
      </ScrollView>
    </View>
  );

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose}>
      <View style={styles.txFilterModalRoot} pointerEvents="box-none">
        <Pressable style={styles.txFilterBackdrop} onPress={onClose} />
        {menu}
      </View>
    </Modal>
  );
}

function pickStoreColumns(stores, storeName) {
  const matches = (stores || []).filter((store) => namesMatch(store.name, storeName));
  if (matches.length <= 1) return matches;
  const linked = matches.find((store) => store.systemKey === 'gta' || store.systemKey === 'pmx');
  return [linked || matches[0]];
}

function InventoryPriceRefresh({ onPress, loading = false, compact = false }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={loading}
      hitSlop={8}
      style={({ hovered, pressed }) => [
        styles.inventoryRefresh,
        compact && styles.inventoryRefreshCompact,
        (hovered || pressed) && styles.inventoryRefreshHover,
      ]}
      accessibilityRole="button"
      accessibilityLabel="Refresh prices"
    >
      {loading ? (
        <ActivityIndicator size="small" color={BLUE} />
      ) : (
        <Ionicons name="refresh" size={16} color={SECONDARY} />
      )}
    </Pressable>
  );
}

function InventorySearch({ value, onChangeText, onRefresh, refreshing = false }) {
  return (
    <View style={styles.inventorySearchRow}>
      <View style={[styles.searchField, styles.inventorySearchField]}>
        <Ionicons name="search-outline" size={16} color={SECONDARY} />
        <TextInput
          style={styles.searchInput}
          value={value}
          onChangeText={onChangeText}
          placeholder="Search inventory"
          placeholderTextColor={SECONDARY}
          autoCorrect={false}
          autoCapitalize="none"
          clearButtonMode="while-editing"
          returnKeyType="search"
          accessibilityLabel="Search inventory"
        />
        {value ? (
          <Pressable onPress={() => onChangeText('')} hitSlop={8} accessibilityLabel="Clear">
            <Ionicons name="close-circle" size={16} color={SECONDARY} />
          </Pressable>
        ) : null}
      </View>
      {onRefresh ? <InventoryPriceRefresh onPress={onRefresh} loading={refreshing} /> : null}
    </View>
  );
}

function DashPinnedApp({ app, value, onOpen, onPress, compact = false, roomy = false, selected = false }) {
  return (
    <Pressable
      onPress={() => (onPress ? onPress() : onOpen?.(app.key))}
      style={({ hovered, pressed }) => [
        styles.dashPinnedApp,
        compact && styles.dashPinnedAppCompact,
        roomy && styles.dashPinnedAppRoomy,
        selected && styles.dashPinnedAppSelected,
        (hovered || pressed) && styles.dashPinnedAppPressed,
      ]}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={app.label}
    >
      <View style={styles.dashPinnedAppHead}>
        <View style={[styles.dashPinnedAppIcon, { backgroundColor: app.accent }]}>
          <Ionicons name={filledIonicon(app.icon)} size={13} color="#fff" />
        </View>
        <Text style={styles.dashPinnedAppLabel} numberOfLines={roomy ? 2 : 1}>
          {app.label === 'Emails' ? 'Email' : app.label}
        </Text>
      </View>
      {value == null ? null : (
        <Text style={styles.dashPinnedAppValue} numberOfLines={1}>
          {value}
        </Text>
      )}
    </Pressable>
  );
}

function DashStat({ value, label, chrome = false, selected = false, onPress }) {
  const body = (
    <>
      <Text
        style={[
          styles.dashHeroStatValue,
          chrome && styles.dashHeroStatValueChrome,
          selected && styles.dashHeroStatValueSelected,
        ]}
      >
        {value}
      </Text>
      <Text
        style={[
          styles.dashHeroStatLabel,
          chrome && styles.dashHeroStatLabelChrome,
          selected && styles.dashHeroStatLabelSelected,
        ]}
      >
        {label}
      </Text>
    </>
  );
  const style = [styles.dashHeroStat, selected && styles.dashHeroStatSelected];
  if (!onPress) {
    return <View style={style}>{body}</View>;
  }
  return (
    <Pressable
      onPress={onPress}
      style={style}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
    >
      {body}
    </Pressable>
  );
}

function storeAmountForFocus(store, focus) {
  if (focus === 'sales') return Number(store?.soAmount) || 0;
  if (focus === 'purchases') return Number(store?.poAmount) || 0;
  return Number(store?.totalAmount) || 0;
}

function StoreHomeHeroStat({ value, label, selected = false, onPress, compact = false, tone, mark = null, accessibilityLabel }) {
  const valueStyle = [
    compact ? styles.storeHomeHeroStatValueCompact : styles.storeHomeHeroStatValue,
    selected &&
      (compact ? styles.storeHomeHeroStatValueCompactSelected : styles.storeHomeHeroStatValueSelected),
    tone === 'low' && styles.storeHomeHeroStatLow,
    tone === 'ok' && styles.storeHomeHeroStatOk,
  ];
  const labelStyle = [
    compact ? styles.storeHomeHeroStatLabelCompact : styles.storeHomeHeroStatLabel,
    selected &&
      (compact ? styles.storeHomeHeroStatLabelCompactSelected : styles.storeHomeHeroStatLabelSelected),
  ];
  const valueNode = mark ? (
    <View style={styles.storeHomeHeroStatMarkRow}>
      <Text style={valueStyle}>{value}</Text>
      {mark}
    </View>
  ) : (
    <Text style={valueStyle}>{value}</Text>
  );
  const body = compact ? (
    <>
      <Text style={labelStyle} numberOfLines={1}>
        {label}
      </Text>
      {valueNode}
    </>
  ) : (
    <>
      <Text style={labelStyle}>{label}</Text>
      {valueNode}
    </>
  );
  const style = compact
    ? [styles.storeHomeHeroStatCompact, selected && styles.storeHomeHeroStatCompactSelected]
    : [styles.storeHomeHeroStat, selected && styles.storeHomeHeroStatSelected];
  if (!onPress) {
    return <View style={style}>{body}</View>;
  }
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [...style, pressed && styles.storeHomeHeroStatPressed]}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={accessibilityLabel || label}
    >
      {body}
    </Pressable>
  );
}

function StoreHeroBlock({ value, title, empty = false, onPress, children, tone, mark = null }) {
  const amount = (
    <Text
      style={[
        styles.storeHomeHeroAmount,
        empty && styles.storeHomeHeroAmountEmpty,
        !empty && tone === 'low' && styles.storeHomeHeroAmountLow,
        !empty && tone === 'ok' && styles.storeHomeHeroAmountOk,
      ]}
      numberOfLines={1}
      adjustsFontSizeToFit
      minimumFontScale={0.55}
    >
      {empty ? '—' : value}
    </Text>
  );
  const pair = (
    <View style={styles.storeHomeHeroPair}>
      <View style={styles.storeHomeHeroMetricStack}>
        {mark ? (
          <View style={styles.storeHomeHeroStatMarkRow}>
            {amount}
            {mark}
          </View>
        ) : (
          amount
        )}
        <Text style={styles.storeHomeHeroBlockTitle}>{title}</Text>
      </View>
      {children}
    </View>
  );
  if (!onPress) return pair;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [pressed && styles.storeHomeHeroStatPressed]}
      accessibilityRole="button"
      accessibilityLabel={title}
    >
      {pair}
    </Pressable>
  );
}

function StoreHeroSide({ children }) {
  return (
    <View style={[styles.storeHomeHeroStats, styles.storeHomeHeroStatsSide, styles.storeHomeHeroStatsSideDesktop]}>
      {children}
    </View>
  );
}

function StoreHomeHero({
  store,
  focus = 'all',
  onFocus,
  onPress,
  onOpenApp,
  txSelected = false,
  isMobile = false,
  dateHero = null,
  periodLabel = 'Today',
  emailCapture = null,
  phoneRatio = null,
  reviewStats = null,
  cashCad = null,
  cashLoading = false,
}) {
  const { money } = useDisplayCurrency();
  const [opsFocus, setOpsFocus] = useState('email');
  const total = storeAmountForFocus(store, focus);
  const txCount = Number(store?.txCount) || 0;
  const saleCount = Number(store?.saleCount) || 0;
  const purchaseCount = Number(store?.purchaseCount) || 0;
  const empty =
    !total &&
    !(focus === 'sales' ? saleCount : focus === 'purchases' ? purchaseCount : txCount);
  const selectFocus = (next) => {
    const resolved = next === 'all' ? 'all' : focus === next ? 'all' : next;
    onFocus?.(resolved);
    onPress?.();
  };
  const emailEmpty = !emailCapture || !emailCapture.customerCount;
  const emailRate = emailEmpty ? null : Math.round(Number(emailCapture.rate));
  const phoneEmpty = phoneRatio?.rate == null;
  const bonusEmpty = !reviewStats || reviewStats.rate == null;
  const cashValue = cashCad?.amount;
  const cashEmpty = !Number.isFinite(Number(cashValue));
  const opsApp =
    opsFocus === 'phone' ? 'phone' : opsFocus === 'bonus' ? 'bonuses' : 'emails';
  const opsValue =
    opsFocus === 'phone'
      ? phoneEmpty
        ? '—'
        : phoneRatio.ratio
      : opsFocus === 'bonus'
        ? bonusEmpty
          ? '—'
          : String(reviewStats.count)
        : emailEmpty
          ? '—'
          : `${emailRate}%`;
  const opsTitle = opsFocus === 'phone' ? 'Phone' : opsFocus === 'bonus' ? 'Bonus' : 'Email';
  const opsEmpty =
    opsFocus === 'phone' ? phoneEmpty : opsFocus === 'bonus' ? bonusEmpty : emailEmpty;
  const rateTone = (empty, rate) => {
    if (empty || rate == null || !Number.isFinite(Number(rate))) return undefined;
    return Number(rate) < 80 ? 'low' : 'ok';
  };
  const emailTone = rateTone(emailEmpty, emailCapture?.rate);
  const phoneTone = rateTone(phoneEmpty, phoneRatio?.rate);
  const bonusTone = rateTone(bonusEmpty, reviewStats?.rate);
  const opsTone = opsFocus === 'phone' ? phoneTone : opsFocus === 'bonus' ? bonusTone : emailTone;

  const revenuePair = (
    <StoreHeroBlock value={money(total)} title="Revenue" empty={empty} onPress={() => onOpenApp?.('transactions')}>
      <StoreHeroSide>
        <StoreHomeHeroStat
          compact
          value={txCount}
          label="Tx"
          selected={txSelected && focus === 'all'}
          onPress={() => selectFocus('all')}
        />
        <StoreHomeHeroStat
          compact
          value={saleCount}
          label="Sales"
          selected={focus === 'sales'}
          onPress={() => selectFocus('sales')}
        />
        <StoreHomeHeroStat
          compact
          value={purchaseCount}
          label="Purchases"
          selected={focus === 'purchases'}
          onPress={() => selectFocus('purchases')}
        />
      </StoreHeroSide>
    </StoreHeroBlock>
  );
  const extraMetrics = (
    <>
      <StoreHeroBlock
        value={cashLoading && cashEmpty ? '…' : formatAmount(cashValue, 'CAD')}
        title="Cash"
        empty={!cashLoading && cashEmpty}
        onPress={() => onOpenApp?.('financials')}
      >
        <StoreHeroSide>
          <StoreHomeHeroStat
            compact
            value={cashCad?.opening == null ? '—' : formatAmount(cashCad.opening, 'CAD')}
            label="Open"
          />
          <StoreHomeHeroStat
            compact
            value={cashCad?.moved == null ? '—' : formatAmount(cashCad.moved, 'CAD')}
            label="Today"
          />
        </StoreHeroSide>
      </StoreHeroBlock>
      <StoreHeroBlock
        value={opsValue}
        title={opsTitle}
        empty={opsEmpty}
        tone={opsTone}
        mark={
          opsFocus === 'bonus' && !bonusEmpty ? (
            <LowReviewMark count={reviewStats.negative || 0} size={15} countSize={16} />
          ) : null
        }
        onPress={() => onOpenApp?.(opsApp)}
      >
        <StoreHeroSide>
          <StoreHomeHeroStat
            compact
            value={emailEmpty ? '—' : `${emailRate}%`}
            label="Email"
            selected={opsFocus === 'email'}
            tone={emailTone}
            onPress={() => setOpsFocus('email')}
          />
          <StoreHomeHeroStat
            compact
            value={phoneEmpty ? '—' : phoneRatio.ratio}
            label="Phone"
            selected={opsFocus === 'phone'}
            tone={phoneTone}
            onPress={() => setOpsFocus('phone')}
          />
          <StoreHomeHeroStat
            compact
            value={bonusEmpty ? '—' : String(reviewStats.count)}
            label="Bonus"
            selected={opsFocus === 'bonus'}
            tone={bonusTone}
            mark={
              opsFocus === 'bonus' || bonusEmpty ? null : (
                <LowReviewMark count={reviewStats.negative || 0} size={12} countSize={13} />
              )
            }
            accessibilityLabel={
              bonusEmpty
                ? 'Bonus'
                : `Bonus ${reviewStats.count}, ${reviewStats.negative || 0} at 1 or 2 stars`
            }
            onPress={() => setOpsFocus('bonus')}
          />
        </StoreHeroSide>
      </StoreHeroBlock>
    </>
  );

  return (
    <View style={styles.storeHomeHeroShell}>
      <View style={[styles.storeHomeHeroSplit, isMobile && styles.storeHomeHeroSplitMobile]}>
        {dateHero && !isMobile ? (
          dateHero
        ) : (
          <StoreHeroBlock value={periodLabel} title="Date" />
        )}
        <View style={[styles.storeHomeHeroFigures, isMobile && styles.storeHomeHeroFiguresMobile]}>
          {revenuePair}
          {extraMetrics}
        </View>
      </View>
    </View>
  );
}

function OverviewHero({
  store,
  periodLabel,
  plain = false,
  chrome = false,
  wide = false,
  onAmountLayout,
  filterSlotWidth = 0,
  onPress,
  focus = 'all',
  onFocus,
  txSelected = false,
}) {
  const total = storeAmountForFocus(store, focus);
  const txCount = Number(store?.txCount) || 0;
  const saleCount = Number(store?.saleCount) || 0;
  const purchaseCount = Number(store?.purchaseCount) || 0;
  const empty = !total && !(focus === 'sales' ? saleCount : focus === 'purchases' ? purchaseCount : txCount);
  const txLabel = `${txCount} transaction${txCount === 1 ? '' : 's'}`;
  const label = `${periodLabel}, ${empty ? 'No total' : formatAmount(total)}, ${txLabel}`;
  const selectFocus = (next) => {
    const resolved = next === 'all' ? 'all' : focus === next ? 'all' : next;
    onFocus?.(resolved);
    onPress?.();
  };

  if (chrome) {
    return (
      <View
        style={[styles.dashHeroCard, wide && styles.dashHeroCardWide]}
        accessibilityLabel={label}
      >
        <Pressable
          onPress={() => selectFocus('all')}
          disabled={!onPress && !onFocus}
          accessibilityRole={onPress || onFocus ? 'button' : undefined}
          accessibilityLabel={empty ? 'No total' : formatAmount(total)}
        >
          <Text
            style={[
              styles.dashHeroAmountChrome,
              wide && styles.dashHeroAmountWide,
              empty && styles.dashHeroAmountChromeEmpty,
            ]}
            numberOfLines={1}
            adjustsFontSizeToFit
          >
            {empty ? '—' : formatAmount(total)}
          </Text>
        </Pressable>
        <View style={[styles.dashHeroStatsChrome, wide && styles.dashHeroStatsWide]}>
          <DashStat
            value={txCount}
            label={txCount === 1 ? 'Transaction' : 'Transactions'}
            chrome
            selected={txSelected && focus === 'all'}
            onPress={() => selectFocus('all')}
          />
          <View style={styles.dashHeroStatDividerChrome} />
          <DashStat
            value={saleCount}
            label="Sales"
            chrome
            selected={focus === 'sales'}
            onPress={() => selectFocus('sales')}
          />
          <View style={styles.dashHeroStatDividerChrome} />
          <DashStat
            value={purchaseCount}
            label="Purchases"
            chrome
            selected={focus === 'purchases'}
            onPress={() => selectFocus('purchases')}
          />
        </View>
      </View>
    );
  }

  if (plain) {
    return (
      <View style={styles.dashHero} accessibilityLabel={label}>
        <Text style={styles.dashHeroLabel}>{periodLabel}</Text>
        <View
          style={styles.dashHeroAmountRow}
          onLayout={(event) => {
            const { y, height } = event.nativeEvent.layout;
            onAmountLayout?.({ y, height });
          }}
        >
          <Text
            style={[styles.dashHeroAmount, empty && styles.heroAmountEmpty]}
            numberOfLines={1}
            adjustsFontSizeToFit
          >
            {empty ? '—' : formatAmount(total)}
          </Text>
          <View
            style={[
              styles.dashHeroFilterSlot,
              filterSlotWidth > 0 && { width: filterSlotWidth },
            ]}
          />
        </View>
        <View style={styles.dashHeroStats}>
          <DashStat value={txCount} label={txCount === 1 ? 'Transaction' : 'Transactions'} />
          <View style={styles.dashHeroStatDivider} />
          <DashStat value={saleCount} label="Sales" />
          <View style={styles.dashHeroStatDivider} />
          <DashStat value={purchaseCount} label="Purchases" />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.heroCard} accessibilityLabel={label}>
      <Text style={styles.heroKicker}>{periodLabel}</Text>
      <Text style={[styles.heroAmount, empty && styles.heroAmountEmpty]} numberOfLines={1}>
        {empty ? '—' : formatAmount(total)}
      </Text>
      <Text style={styles.heroMeta}>{txLabel}</Text>
      <View style={styles.heroSplit}>
        <View style={styles.heroSplitCol}>
          <Text style={styles.heroSplitLabel}>Sales</Text>
          <Text style={styles.heroSplitValue} numberOfLines={1}>
            {formatAmount(store?.soAmount)}
          </Text>
          <Text style={styles.heroSplitMeta}>
            {saleCount} SO
          </Text>
        </View>
        <View style={styles.heroSplitRule} />
        <View style={styles.heroSplitCol}>
          <Text style={[styles.heroSplitLabel, styles.heroSplitLabelBuy]}>Purchases</Text>
          <Text style={styles.heroSplitValue} numberOfLines={1}>
            {formatAmount(store?.poAmount)}
          </Text>
          <Text style={styles.heroSplitMeta}>
            {purchaseCount} PO
          </Text>
        </View>
      </View>
    </View>
  );
}

function cleanStoreContact(value) {
  const text = String(value || '').trim();
  return !text || text === '—' ? '' : text;
}

function OverviewContactLine({ icon, children }) {
  if (!children) return null;
  return (
    <View style={styles.overviewContactLine}>
      <Ionicons name={icon} size={13} color={SECONDARY} />
      <Text style={styles.overviewStoreContact} numberOfLines={2}>
        {children}
      </Text>
    </View>
  );
}

function OverviewStatsTable({ rows = [] }) {
  if (!rows.length) return null;
  return (
    <View style={styles.overviewStatsBox}>
      {rows.map((row, index) => {
        const last = index === rows.length - 1;
        const value = (
          <View style={styles.overviewStatsValueRow}>
            <Text
              style={[
                styles.overviewStatsValue,
                row.muted && styles.rowValueMuted,
                row.tone === 'low' && styles.storeHomeHeroStatLow,
                row.tone === 'ok' && styles.storeHomeHeroStatOk,
              ]}
              numberOfLines={1}
            >
              {row.value}
            </Text>
            {row.trailing || null}
          </View>
        );
        const lead = (
          <View style={styles.overviewStatsLead}>
            <Ionicons name={row.icon} size={15} color={SECONDARY} />
            <Text style={styles.overviewStatsLabel} numberOfLines={1}>
              {row.label}
            </Text>
          </View>
        );
        if (row.onPress) {
          return (
            <Pressable
              key={row.key}
              onPress={row.onPress}
              style={({ hovered, pressed }) => [
                styles.overviewStatsRow,
                last && styles.overviewStatsRowLast,
                (hovered || pressed) && styles.overviewStatsRowHover,
              ]}
              accessibilityRole="button"
              accessibilityLabel={row.accessibilityLabel || `${row.label} ${row.value}`}
            >
              {lead}
              {value}
            </Pressable>
          );
        }
        return (
          <View
            key={row.key}
            style={[styles.overviewStatsRow, styles.itemStatsRow, last && styles.overviewStatsRowLast]}
            accessibilityLabel={row.accessibilityLabel || `${row.label} ${row.value}`}
          >
            {lead}
            {value}
          </View>
        );
      })}
    </View>
  );
}

function SnapshotTable({ columns = [], children }) {
  return (
    <View style={styles.overviewListWrap}>
      <View style={styles.overviewListBox}>
        <View style={[styles.overviewTxRow, styles.overviewTxHeader]}>
          <View style={styles.storeTxRowBody}>
            {columns.map((col) => (
              <Text
                key={col.key}
                style={[styles.storeTxHeader, styles[col.colStyle], col.end && styles.storeTxHeaderEnd]}
                numberOfLines={1}
              >
                {col.label}
              </Text>
            ))}
          </View>
        </View>
        {children}
      </View>
    </View>
  );
}

function SnapshotTableRow({ cells, last = false, onPress }) {
  const inner = (
    <View style={styles.storeTxRowBody}>
      {cells.map((cell) => (
        <Text
          key={cell.key}
          style={[
            cell.end ? styles.storeTxAmount : styles.storeTxName,
            styles[cell.style],
            cell.muted && styles.rowValueMuted,
          ]}
          numberOfLines={1}
        >
          {cell.text}
        </Text>
      ))}
    </View>
  );
  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={({ hovered, pressed }) => [
          styles.overviewTxRow,
          last && styles.overviewTxRowLast,
          (hovered || pressed) && styles.overviewStatsRowHover,
        ]}
      >
        {inner}
      </Pressable>
    );
  }
  return (
    <View style={[styles.overviewTxRow, styles.itemStaticRow, last && styles.overviewTxRowLast]}>
      {inner}
    </View>
  );
}

function DashSection({ title, meta, onPress, children, style, headStyle, app, fill = false, grab = false, hideHead = false, panHandlers, ...rest }) {
  return (
    <View style={[styles.dashSection, fill && styles.dashSectionFill, style]} {...rest}>
      <View {...(grab ? panHandlers : null)} style={grab ? styles.dashSheetHandle : null}>
        {grab ? <View style={styles.dashSheetGrabPill} /> : null}
      {hideHead ? null : (
      <Pressable
        onPress={onPress}
        disabled={!onPress}
        style={[styles.dashHead, headStyle]}
        accessibilityRole={onPress ? 'button' : undefined}
        accessibilityLabel={onPress ? `Open ${title}` : title}
      >
        <View style={styles.dashHeadLead}>
          {app ? (
            <View style={[styles.dashHeadIcon, { backgroundColor: app.accent }]}>
              <Ionicons name={filledIonicon(app.icon)} size={16} color="#fff" />
            </View>
          ) : null}
          <Text style={app ? styles.dashHeadTitleCard : styles.dashHeadTitle} numberOfLines={1}>
            {title}
          </Text>
        </View>
        <View style={styles.dashHeadTrail}>
          {meta ? (
            <Text style={styles.dashHeadMeta} numberOfLines={1}>
              {meta}
            </Text>
          ) : null}
          {onPress ? <Ionicons name="chevron-forward" size={app ? 16 : 14} color={SECONDARY} /> : null}
        </View>
      </Pressable>
      )}
      </View>
      <View style={[styles.dashList, fill && styles.dashListFill]}>{children}</View>
    </View>
  );
}

function EmployeeAvatar({ person, size = 32, ring = false }) {
  const [failed, setFailed] = useState(false);
  const photoUrl = person?.photoUrl || '';
  useEffect(() => {
    setFailed(false);
  }, [photoUrl]);
  const showImage = Boolean(photoUrl) && !failed;
  return (
    <View
      style={[
        styles.employeeAvatar,
        { width: size, height: size, borderRadius: size / 2 },
        !showImage && styles.employeeAvatarFallback,
        ring && styles.employeeAvatarRing,
      ]}
    >
      {showImage ? (
        <Image
          source={{ uri: photoUrl }}
          style={{ width: size, height: size, borderRadius: size / 2 }}
          onError={() => setFailed(true)}
        />
      ) : (
        <Text style={[styles.employeeInitials, { fontSize: size > 34 ? 13 : size > 26 ? 11 : 9 }]}>
          {initialsFor(person?.name)}
        </Text>
      )}
    </View>
  );
}

function EmployeeCard({ person }) {
  const subtitle = person.txCount
    ? `${person.txCount} transaction${person.txCount === 1 ? '' : 's'} today`
    : person.role || 'Assigned to this store';
  return (
    <View style={styles.employeeCard}>
      <EmployeeAvatar person={person} size={64} />
      <Text style={styles.employeeCardName} numberOfLines={1}>
        {person.name}
      </Text>
      <Text style={styles.employeeCardMeta} numberOfLines={2}>
        {subtitle}
      </Text>
    </View>
  );
}

function ExpectedCash({ cad, usd }) {
  if (!cad && !usd) return null;
  const cadAmt = cad?.aureusOnHand ?? cad?.expectedOnHand ?? 0;
  const usdAmt = usd?.aureusOnHand ?? usd?.expectedOnHand ?? 0;
  const showUsd = Math.abs(usdAmt) >= 0.005 || hasDrawerActivity(usd);
  const cadMoved = Math.abs(cad?.movementNet || 0) >= 0.005;
  return (
    <View style={styles.cashHero}>
      <Text style={styles.cashHeroLabel}>CAD till</Text>
      <Text style={styles.cashHeroValue}>{formatAmount(cadAmt, 'CAD')}</Text>
      {showUsd ? (
        <Text style={styles.cashHeroUsd}>USD {formatAmount(usdAmt, 'USD')}</Text>
      ) : null}
      <Text style={styles.cashHeroMeta}>
        Open {formatAmount(cad?.openingBalance, 'CAD')}
        {cadMoved ? ` · Today ${formatAmount(cad.movementNet, 'CAD')}` : ''}
      </Text>
    </View>
  );
}

function firstItemLineLabel(row) {
  const lines = Array.isArray(row?.pricedLines) ? row.pricedLines : [];
  const names = (row?.itemNames || [])
    .map((name) => String(name || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const name = String(lines[0]?.name || names[0] || '').replace(/\s+/g, ' ').trim();
  if (!name) return '';
  const qty = Number(lines[0]?.quantity);
  const lead = Number.isFinite(qty) && qty > 0 ? `${formatQty(qty)} ${name}` : name;
  const more = Math.max(lines.length, names.length) > 1;
  return more ? `${lead}…` : lead;
}

const WATCH_ITEM_RE =
  /watch|rolex|omega|patek|tudor|breitling|cartier|hublot|iwc|audemars|breguet|perrelet/i;
const ITEM_SUMMARY_ORDER = [
  'Gold Jewellery',
  'Silver Jewellery',
  'Platinum Jewellery',
  'Palladium Jewellery',
  'Gold Bullion',
  'Silver Bullion',
  'Platinum Bullion',
  'Palladium Bullion',
  'Jewellery',
  'Bullion',
  'Watch',
];

function itemLineBlob(line) {
  return [line?.name, line?.searchText, line?.quality, line?.productType, line?.productGroup, line?.metal]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join(' ');
}

function itemLineMetal(line) {
  const field = String(line?.metal || '').toLowerCase();
  if (field.includes('palladium')) return 'Palladium';
  if (field.includes('platinum')) return 'Platinum';
  if (field.includes('silver')) return 'Silver';
  if (field.includes('gold')) return 'Gold';
  const text = itemLineBlob(line).toLowerCase();
  if (/\bpalladium\b|\bpd\b/.test(text)) return 'Palladium';
  if (/\bplatinum\b|\bpt\b/.test(text)) return 'Platinum';
  if (/\bsilver\b|\bsterling\b|\bmexican\b|\b925\b|\bsml\b/.test(text)) return 'Silver';
  if (/\bgold\b|\bau\b|gold filled|\bgml\b|\d+\s*k(?:t|arat)?/.test(text)) return 'Gold';
  return '';
}

function classifyItemSummary(line) {
  const text = itemLineBlob(line);
  if (!text) return '';
  if (WATCH_ITEM_RE.test(text)) return 'Watch';
  const metal = itemLineMetal(line);
  if (isBullionResaleLine(line) || /\bbullion\b/i.test(`${line?.productGroup || ''} ${text}`)) {
    return metal ? `${metal} Bullion` : 'Bullion';
  }
  if (
    isScrapJewelleryLine(line) ||
    /jewell?ery|scrap|ring|chain|bracelet|necklace|earring|pendant/i.test(text)
  ) {
    return metal ? `${metal} Jewellery` : 'Jewellery';
  }
  if (metal) {
    if (/\d+\s*k(?:t|arat)?|scrap|filled|sterling/i.test(text)) return `${metal} Jewellery`;
    return `${metal} Bullion`;
  }
  return '';
}

function itemSummaryLabel(row) {
  const priced = Array.isArray(row?.pricedLines) ? row.pricedLines.filter(Boolean) : [];
  const lines = priced.length
    ? priced
    : (row?.itemNames || [])
        .map((name) => String(name || '').trim())
        .filter(Boolean)
        .map((name) => ({ name, searchText: `${name} ${row?.itemSearchText || ''}` }));
  const found = new Set();
  for (const line of lines) {
    const label = classifyItemSummary(line);
    if (label) found.add(label);
  }
  if (!found.size && row?.itemSearchText) {
    const label = classifyItemSummary({
      name: row.itemSearchText,
      searchText: row.itemSearchText,
    });
    if (label) found.add(label);
  }
  const ordered = ITEM_SUMMARY_ORDER.filter((key) => found.has(key));
  for (const extra of found) {
    if (!ordered.includes(extra)) ordered.push(extra);
  }
  return ordered.join(' and ');
}

function priceCheckIntro(check) {
  const tol = formatPriceTolerance(check?.tolerance);
  const when = check?.isPurchase ? 'this purchase came in' : 'this sale came in';
  const basis = check?.frozen
    ? `website prices from when ${when}`
    : check?.catalogUpdated
      ? `website prices from ${check.catalogUpdated}`
      : 'website prices';
  if (check?.status === 'off') {
    return check.isPurchase
      ? `This purchase does not match ${basis} (${tol} tolerance).`
      : `This sale does not match ${basis} (${tol} tolerance).`;
  }
  if (check?.status === 'unknown' || check?.status === 'loading') {
    const scrapUnknown = (check.lines || []).some((line) => line.kind === 'scrap' && line.status === 'unknown');
    return scrapUnknown
      ? 'Scrap is checked by karat and premium vs standard: website $/g × the recorded weight.'
      : 'We need a website match and a unit price on each line to check this transaction.';
  }
  return check?.isPurchase
    ? `These purchase prices are within ${tol} of ${basis}.`
    : `These sale prices are within ${tol} of ${basis}.`;
}

function PriceCheckModal({ check, onClose }) {
  if (!check) return null;
  const off = check.status === 'off';
  const unknown = check.status === 'unknown' || check.status === 'loading';
  const title = off ? "Something's off" : unknown ? "Can't check yet" : 'Makes sense';
  const intro = priceCheckIntro(check);

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.priceModalRoot}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.priceModalCard}>
          <View style={styles.priceModalHead}>
            <View
              style={[
                styles.priceModalIcon,
                off ? styles.priceBadgeOff : unknown ? styles.priceBadgeMuted : styles.priceBadgeOk,
              ]}
            >
              <Ionicons
                name={off ? 'warning-outline' : 'checkmark-circle-outline'}
                size={18}
                color={off ? '#9A3412' : unknown ? '#6b6b6b' : '#166534'}
              />
            </View>
            <View style={styles.priceModalCopy}>
              <Text style={styles.priceModalTitle}>{title}</Text>
              <Text style={styles.priceModalIntro}>{intro}</Text>
            </View>
          </View>
          {(check.lines || [])
            .filter((line) => line.status !== 'skip')
            .map((line, index) => (
              <View key={`${line.name}-${index}`} style={styles.priceLine}>
                <Text style={styles.priceLineName}>
                  {line.kind === 'scrap' && line.weightGrams
                    ? `${formatScrapGrams(line.weightGrams)} × ${line.name}`
                    : `${line.quantity} × ${line.name}`}
                </Text>
                {line.kind === 'scrap' ? (
                  <Text style={styles.priceLineMeta}>
                    {line.tierLabel ? `${line.tierLabel} · ` : ''}
                    entered {formatAmount(line.actualTotal ?? line.actual)}
                    {line.rateLabel && line.weightGrams
                      ? ` · website ${line.rateLabel} × ${formatScrapGrams(line.weightGrams)} = ${formatAmount(line.expectedTotal ?? line.expected)}`
                      : line.websiteName
                        ? ` · ${line.websiteName}`
                        : ''}
                  </Text>
                ) : (
                  <Text style={styles.priceLineMeta}>
                    Entered at {formatAmount(line.actual)} each
                    {line.websiteName ? ` · matched ${line.websiteName}` : ''}
                  </Text>
                )}
                {line.kind !== 'scrap' && line.buyLabel ? (
                  <Text style={styles.priceLineMeta}>Website we buy {line.buyLabel}</Text>
                ) : null}
                {line.kind !== 'scrap' && line.sellLabel ? (
                  <Text style={styles.priceLineMeta}>Website we sell {line.sellLabel}</Text>
                ) : null}
                <Text
                  style={[
                    styles.priceLineReason,
                    line.status === 'off' && styles.priceLineReasonOff,
                  ]}
                >
                  {line.reason}
                </Text>
              </View>
            ))}
          <Pressable onPress={onClose} style={styles.priceModalDone}>
            <Text style={styles.priceModalDoneText}>Done</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function TxnPhotoThumb({ urls, label, size = 32 }) {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [failed, setFailed] = useState(false);
  const photos = Array.isArray(urls) ? urls.filter(Boolean) : [];
  const radius = Math.max(7, Math.round(size * 0.22));

  useEffect(() => {
    setFailed(false);
    setIndex(0);
  }, [photos[0]]);

  if (!photos.length || failed) return null;

  const current = photos[Math.min(index, photos.length - 1)];
  const hasMany = photos.length > 1;

  return (
    <>
      <Pressable
        onPress={() => {
          setIndex(0);
          setOpen(true);
        }}
        style={[styles.txThumbPress, { width: size, height: size }]}
        accessibilityRole="button"
        accessibilityLabel={
          hasMany ? `View ${photos.length} photos for ${label}` : `View photo for ${label}`
        }
      >
        <Image
          source={{ uri: photos[0] }}
          style={[styles.txThumb, { width: size, height: size, borderRadius: radius }]}
          resizeMode="cover"
          onError={() => setFailed(true)}
        />
        {hasMany && size > 26 ? (
          <View style={styles.txThumbBadge}>
            <Text style={styles.txThumbBadgeText}>{photos.length}</Text>
          </View>
        ) : null}
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={styles.txViewerRoot}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setOpen(false)} />
          <View style={styles.txViewerSheet} pointerEvents="box-none">
            <View style={styles.txViewerBar}>
              <Text style={styles.txViewerTitle} numberOfLines={1}>
                {label}
                {hasMany ? `  ${index + 1}/${photos.length}` : ''}
              </Text>
              <Pressable onPress={() => setOpen(false)} hitSlop={8} accessibilityLabel="Close photos">
                <Ionicons name="close" size={20} color={LABEL} />
              </Pressable>
            </View>
            <Image source={{ uri: current }} style={styles.txViewerImage} resizeMode="contain" />
            {hasMany ? (
              <View style={styles.txViewerNav}>
                <Pressable
                  onPress={() => setIndex((value) => (value - 1 + photos.length) % photos.length)}
                  style={styles.txViewerNavBtn}
                  accessibilityLabel="Previous photo"
                >
                  <Ionicons name="chevron-back" size={20} color="#fff" />
                </Pressable>
                <Pressable
                  onPress={() => setIndex((value) => (value + 1) % photos.length)}
                  style={styles.txViewerNavBtn}
                  accessibilityLabel="Next photo"
                >
                  <Ionicons name="chevron-forward" size={20} color="#fff" />
                </Pressable>
              </View>
            ) : null}
          </View>
        </View>
      </Modal>
    </>
  );
}

function FloatingTooltip({ visible, text, anchorEl, align = 'start' }) {
  const [coords, setCoords] = useState(null);

  const updatePosition = useCallback(() => {
    if (!visible || Platform.OS !== 'web' || !anchorEl?.getBoundingClientRect) {
      setCoords(null);
      return;
    }
    const rect = anchorEl.getBoundingClientRect();
    setCoords({
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
    });
  }, [anchorEl, visible]);

  useLayoutEffect(() => {
    updatePosition();
  }, [updatePosition, text]);

  useEffect(() => {
    if (!visible || Platform.OS !== 'web') return undefined;
    const onMove = () => updatePosition();
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [visible, updatePosition]);

  if (Platform.OS !== 'web' || !visible || !text || !coords || typeof document === 'undefined') {
    return null;
  }

  const style = {
    top: coords.y + coords.height + 4,
    ...(align === 'end'
      ? { right: Math.max(8, window.innerWidth - (coords.x + coords.width)) }
      : { left: Math.max(8, coords.x) }),
  };

  return createPortal(
    createElement('div', { className: 'cgold-floating-tip', style }, text),
    document.body,
  );
}

const TransactionRow = memo(function TransactionRow({
  item,
  last,
  onPress,
  priceCheck,
  onPricePress,
  employeePerson,
  onAmountHover,
  stacked = false,
  boxed = false,
}) {
  const [splitTip, setSplitTip] = useState('');
  const [splitAnchor, setSplitAnchor] = useState(null);
  const isBuy = item.type === 'purchase';
  const itemLine = itemSummaryLabel(item) || firstItemLineLabel(item);
  const employee = String(item.employeeName || employeePerson?.name || '').trim();
  const hoverPerson = employeePerson || { name: employee || '—', photoUrl: '' };
  const photos = Array.isArray(item.imageUrls) ? item.imageUrls.filter(Boolean) : [];
  const refLabel = txRefLabel(item);

  const handleSplitEnter = async (event) => {
    setSplitAnchor(event?.currentTarget || null);
    if (item.paymentBreakdownLabel) {
      setSplitTip(item.paymentBreakdownLabel);
    } else if (!splitTip) {
      setSplitTip('…');
    }
    if (!item.paymentBreakdown && onAmountHover) {
      const label = await onAmountHover(item);
      if (label) setSplitTip(label);
      else if (!item.paymentBreakdownLabel) setSplitTip(item.amountLabel || '');
    }
  };

  const splitHover =
    Platform.OS === 'web'
      ? {
          onMouseEnter: handleSplitEnter,
          onMouseLeave: () => setSplitAnchor(null),
        }
      : null;

  if (stacked) {
    const photoLabel = item.reference || (isBuy ? 'PO' : 'SO');
    const metaLine = [refLabel, item.timeLabel].filter(Boolean).join(' · ') || '—';
    return (
      <Pressable
        onPress={() => onPress?.(item)}
        style={({ hovered, pressed }) => [
          styles.mobileTxRow,
          last && styles.rowLast,
          (hovered || pressed) && styles.rowHovered,
        ]}
        accessibilityRole="button"
        accessibilityLabel={`${isBuy ? 'PO' : 'SO'} ${item.customerName || ''} ${item.amountLabel || ''}`}
      >
        <View style={styles.mobileTxIconCol}>
          {photos.length ? (
            <TxnPhotoThumb urls={photos} label={photoLabel} size={48} />
          ) : (
            <View style={[styles.mobileTxKind, isBuy && styles.mobileTxKindBuy]}>
              <Text style={[styles.mobileTxKindText, isBuy && styles.mobileTxKindTextBuy]}>
                {isBuy ? 'PO' : 'SO'}
              </Text>
            </View>
          )}
        </View>
        <View style={styles.mobileTxBody}>
          <View style={styles.mobileTxMain}>
            <View style={styles.mobileTxCopy}>
              <Text style={styles.mobileTxCustomer} numberOfLines={2}>
                {item.customerName || '—'}
              </Text>
              <Text style={styles.mobileTxMeta} numberOfLines={2}>
                {metaLine}
              </Text>
              {itemLine ? (
                <Text style={styles.mobileTxItems} numberOfLines={2}>
                  {itemLine}
                </Text>
              ) : null}
            </View>
            <View style={styles.mobileTxTrailing} {...splitHover}>
              <Text style={styles.mobileTxAmountText} numberOfLines={1}>
                {item.amountLabel || '—'}
              </Text>
            </View>
            <View style={styles.mobileTxChevron} pointerEvents="none">
              <Ionicons name="chevron-forward" size={16} color="#c7c7cc" />
            </View>
          </View>
        </View>
      </Pressable>
    );
  }

  const photo = photos.length ? (
    <TxnPhotoThumb urls={photos} label={item.reference || (isBuy ? 'PO' : 'SO')} size={30} />
  ) : (
    <View style={styles.storeTxPhotoEmpty} />
  );
  const rowLabel = `${isBuy ? 'PO' : 'SO'} ${item.customerName || ''} ${item.amountLabel || ''}`;
  const cells = (
    <View style={styles.storeTxRowBody}>
      <View style={styles.storeTxColPhoto}>{photo}</View>
      <Text style={[styles.storeTxName, styles.storeTxColCustomer]} numberOfLines={1}>
        {item.customerName || '—'}
      </Text>
      <Text style={[styles.storeTxMeta, styles.storeTxColKind]} numberOfLines={1}>
        {txKindLabel(item)}
      </Text>
      <Text style={[styles.storeTxMeta, styles.storeTxColNumber]} numberOfLines={1}>
        {txNumberLabel(item)}
      </Text>
      <Text style={[styles.storeTxMeta, styles.storeTxColTime]} numberOfLines={1}>
        {item.timeLabel || '—'}
      </Text>
      <Text style={[styles.storeTxMeta, styles.storeTxColItem]} numberOfLines={1}>
        {itemLine || item.paymentMethodLabel || '—'}
      </Text>
      <View
        style={styles.storeTxColEmployee}
        accessibilityLabel={employee || 'Employee'}
        {...(Platform.OS === 'web' ? { title: employee || undefined } : null)}
      >
        <EmployeeAvatar person={hoverPerson} size={20} />
        <Text style={styles.storeTxMeta} numberOfLines={1}>
          {employee || '—'}
        </Text>
      </View>
      <View style={styles.storeTxColAmount} {...splitHover}>
        <Text style={styles.storeTxAmount} numberOfLines={1}>
          {item.amountLabel || '—'}
        </Text>
      </View>
    </View>
  );

  const chevron = (
    <View style={styles.storeTxChevron} pointerEvents="none" accessibilityElementsHidden>
      <Ionicons name="chevron-forward" size={18} color="#8e8e93" />
    </View>
  );

  if (boxed) {
    return (
      <Pressable
        onPress={() => onPress?.(item)}
        style={({ hovered, pressed }) => [
          styles.overviewTxRow,
          last && styles.overviewTxRowLast,
          (hovered || pressed) && styles.overviewStatsRowHover,
        ]}
        accessibilityRole="button"
        accessibilityLabel={rowLabel}
      >
        {cells}
        {chevron}
        <FloatingTooltip
          visible={Boolean(splitAnchor && splitTip)}
          text={splitTip}
          anchorEl={splitAnchor}
          align="end"
        />
      </Pressable>
    );
  }

  if (Platform.OS === 'web') {
    return (
      <View style={styles.storeTxRow} className="cgold-home-row" accessibilityLabel={rowLabel}>
        <Pressable
          onPress={() => onPress?.(item)}
          className="cgold-home-row-hit"
          style={({ hovered, pressed }) => [
            styles.storeTxRowHit,
            (hovered || pressed) && styles.storeTxRowHovered,
          ]}
          accessibilityRole="button"
          accessibilityLabel={rowLabel}
        />
        <View pointerEvents="none" style={styles.storeTxRowForeground}>
          {cells}
        </View>
        {chevron}
        <View
          style={[styles.storeTxRowRule, last && styles.storeTxRowRuleLast]}
          {...(Platform.OS === 'web' ? { className: 'cgold-home-row-rule' } : null)}
        />
        <FloatingTooltip
          visible={Boolean(splitAnchor && splitTip)}
          text={splitTip}
          anchorEl={splitAnchor}
          align="end"
        />
      </View>
    );
  }

  return (
    <Pressable
      onPress={() => onPress?.(item)}
      style={({ hovered, pressed }) => [
        styles.storeTxRow,
        (hovered || pressed) && styles.storeTxRowHoveredNative,
      ]}
      accessibilityRole="button"
      accessibilityLabel={rowLabel}
    >
      {cells}
      {chevron}
      <View style={[styles.storeTxRowRule, last && styles.storeTxRowRuleLast]} />
    </Pressable>
  );
});

function itemStatGroups({ item, storeId, storeName, prices, spreads }) {
  const storeQty = item.quantities?.[storeId] || 0;
  const storePreorder = item.preorders?.[storeId] || 0;
  const companyQty = item.total || 0;
  const companyPreorder = item.preorderTotal || 0;
  const qty = (value) => (value ? formatQty(value) : '—');
  const pricing = [
    {
      key: 'buy',
      icon: 'arrow-down-circle-outline',
      label: 'What we buy',
      value: prices?.buyLabel || '—',
      sub: spreads.buy.label ? `${spreads.buy.label} vs spot` : '',
      muted: !prices?.buyLabel,
    },
    {
      key: 'sell',
      icon: 'arrow-up-circle-outline',
      label: 'What we sell',
      value: prices?.sellLabel || '—',
      sub: spreads.sell.label ? `${spreads.sell.label} vs spot` : '',
      muted: !prices?.sellLabel,
    },
    {
      key: 'spread',
      icon: 'swap-vertical-outline',
      label: 'Buy/sell spread',
      value: spreads.spread.dollarLabel || '—',
      sub: spreads.spread.percentLabel,
      muted: !spreads.spread.dollarLabel,
    },
    {
      key: 'spot',
      icon: 'pulse-outline',
      label: 'Spot',
      value: spreads.spotLabel || '—',
      muted: !spreads.spotLabel,
    },
  ];
  const stock = [
    {
      key: 'qty',
      icon: 'cube-outline',
      label: storeName || 'This store',
      value: qty(storeQty),
      muted: !storeQty,
    },
    {
      key: 'preorder',
      icon: 'cart-outline',
      label: 'Preorder here',
      value: qty(storePreorder),
      muted: !storePreorder,
      tone: storePreorder > storeQty ? 'over' : undefined,
    },
    {
      key: 'all',
      icon: 'business-outline',
      label: 'All stores',
      value: qty(companyQty),
      muted: !companyQty,
    },
    {
      key: 'preorderAll',
      icon: 'cart-outline',
      label: 'Preorder all',
      value: qty(companyPreorder),
      muted: !companyPreorder,
      tone: companyPreorder > companyQty ? 'over' : undefined,
    },
  ];
  return [pricing, stock];
}

function ItemStatsBox({ rows, isMobile = false }) {
  return (
    <View style={[styles.overviewStatsBox, styles.itemStatsBox, isMobile && styles.itemStatsBoxMobile]}>
      {rows.map((row, index) => (
        <View
          key={row.key}
          style={[styles.overviewStatsRow, styles.itemStatsRow, index === rows.length - 1 && styles.overviewStatsRowLast]}
          accessibilityLabel={`${row.label} ${row.value}${row.sub ? ` ${row.sub}` : ''}`}
        >
          <View style={[styles.overviewStatsLead, styles.itemStatsLead]}>
            <Ionicons name={row.icon} size={15} color={SECONDARY} />
            <Text style={[styles.overviewStatsLabel, styles.itemStatsLabel]}>{row.label}</Text>
          </View>
          <View style={styles.itemStatsTrail}>
            <Text
              style={[
                styles.overviewStatsValue,
                row.muted && styles.rowValueMuted,
                row.tone === 'over' && styles.invPreorderOver,
              ]}
            >
              {row.value}
            </Text>
            {row.sub ? <Text style={styles.itemStatsSub}>{row.sub}</Text> : null}
          </View>
        </View>
      ))}
    </View>
  );
}

/** Item title block + stats box, laid out like the store overview head. */
function InventoryItemHead({
  item,
  storeId,
  storeName,
  prices = null,
  priceCatalog = null,
  isMobile = false,
  onBackToList,
}) {
  const { quotes, usdCadRate } = useDisplayCurrency();
  const spreads = inventoryPriceSpreads(prices, priceCatalog, { quotes, usdCadRate });
  const [pricingRows, stockRows] = itemStatGroups({ item, storeId, storeName, prices, spreads });
  const title = inventoryDisplayName(item.name) || item.name;
  const metaLines = [
    { icon: 'pricetag-outline', text: title !== item.name ? item.name : '' },
    { icon: 'barcode-outline', text: item.sku && item.sku !== item.name ? item.sku : '' },
    { icon: 'diamond-outline', text: item.metal || '' },
    { icon: 'globe-outline', text: prices?.websiteName || '' },
  ].filter((line) => line.text);

  return (
    <View style={[styles.overviewHeadRow, isMobile && styles.itemHeadRowMobile]}>
      <View style={styles.overviewTitleBlock}>
        <Pressable
          onPress={onBackToList}
          hitSlop={6}
          style={styles.itemKicker}
          accessibilityRole="link"
          accessibilityLabel="All inventory"
        >
          <Text style={styles.itemKickerText}>Inventory</Text>
        </Pressable>
        <Text style={styles.overviewStoreName}>{title}</Text>
        <View style={styles.overviewContactBlock}>
          {metaLines.map((line) => (
            <OverviewContactLine key={line.icon} icon={line.icon}>
              {line.text}
            </OverviewContactLine>
          ))}
        </View>
      </View>
      <View style={[styles.itemStatsPair, isMobile && styles.itemStatsPairMobile]}>
        <ItemStatsBox rows={pricingRows} isMobile={isMobile} />
        <ItemStatsBox rows={stockRows} isMobile={isMobile} />
      </View>
    </View>
  );
}

function InventoryItemBody({
  item,
  storeId,
  stores = [],
  periodLabel = 'Today',
  transactions = [],
  pending = false,
  boxed = false,
  isMobile = false,
  employeesByName,
  staff,
  onOpenTransaction,
  onAmountHover,
  onPricePress,
  priceChecks,
}) {
  const storeLines = (stores || [])
    .map((store) => ({
      id: store.id,
      name: store.name,
      qty: item.quantities?.[store.id] || 0,
      preorder: item.preorders?.[store.id] || 0,
    }))
    .filter((line) => line.qty || line.preorder)
    .sort((a, b) => {
      if (a.id === storeId) return -1;
      if (b.id === storeId) return 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });
  const periodText = periodLabel === 'Today' ? 'today' : 'in this period';
  const countLabel = transactions.length === 1 ? '1 ticket' : `${transactions.length} tickets`;

  return (
    <View style={styles.itemBody}>
      {storeLines.length > 1 ? (
        <>
          <View style={[styles.overviewListHead, isMobile && styles.itemListHeadMobile]}>
            <Text style={styles.overviewListTitle}>Stores</Text>
            <Text style={styles.itemListMeta}>{`${storeLines.length} locations`}</Text>
          </View>
          <View style={boxed ? styles.overviewListBox : styles.itemStoreList}>
            <View style={[styles.overviewTxRow, styles.overviewTxHeader]}>
              <View style={styles.storeTxRowBody}>
                <Text style={[styles.storeTxHeader, styles.invColItem]}>Store</Text>
                <Text style={[styles.storeTxHeader, styles.invColPreorder, styles.storeTxHeaderEnd]}>
                  Preorder
                </Text>
                <Text style={[styles.storeTxHeader, styles.invColQty, styles.storeTxHeaderEnd]}>Qty</Text>
              </View>
            </View>
            {storeLines.map((line, index) => {
              const last = index === storeLines.length - 1;
              const here = line.id === storeId;
              return (
                <View
                  key={line.id}
                  style={[styles.overviewTxRow, last && styles.overviewTxRowLast, styles.itemStaticRow]}
                >
                  <View style={styles.storeTxRowBody}>
                    <Text
                      style={[styles.storeTxName, styles.invColItem, here && styles.itemStoreHere]}
                      numberOfLines={1}
                    >
                      {line.name}
                    </Text>
                    <Text
                      style={[
                        styles.storeTxAmount,
                        styles.invColPreorder,
                        !line.preorder && styles.rowValueMuted,
                        line.preorder > line.qty && styles.invPreorderOver,
                      ]}
                    >
                      {line.preorder ? formatQty(line.preorder) : '—'}
                    </Text>
                    <Text
                      style={[styles.storeTxAmount, styles.invColQty, !line.qty && styles.rowValueMuted]}
                    >
                      {line.qty ? formatQty(line.qty) : '—'}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>
        </>
      ) : null}
      <View style={[styles.overviewListHead, isMobile && styles.itemListHeadMobile]}>
        <Text style={styles.overviewListTitle}>Transactions</Text>
        <View style={styles.itemListMetaRow}>
          {pending ? <ActivityIndicator size="small" color={SECONDARY} /> : null}
          <Text style={styles.itemListMeta}>{countLabel}</Text>
        </View>
      </View>
      <View style={boxed ? styles.overviewListBox : null}>
        {transactions.length === 0 ? (
          <EmptyRow
            boxed={boxed}
            text={pending ? 'Checking tickets for this item…' : `No tickets with this item ${periodText}.`}
          />
        ) : (
          <>
            {boxed ? (
              <View style={[styles.overviewTxRow, styles.overviewTxHeader]}>
                <View style={styles.storeTxRowBody}>
                  <Text style={[styles.storeTxHeader, styles.storeTxColPhoto]}>Photo</Text>
                  <Text style={[styles.storeTxHeader, styles.storeTxColCustomer]}>Customer</Text>
                  <Text style={[styles.storeTxHeader, styles.storeTxColKind]}>PO/SO</Text>
                  <Text style={[styles.storeTxHeader, styles.storeTxColNumber]}>Order</Text>
                  <Text style={[styles.storeTxHeader, styles.storeTxColTime]}>Time</Text>
                  <Text style={[styles.storeTxHeader, styles.storeTxColItem]}>Item</Text>
                  <Text style={[styles.storeTxHeader, styles.storeTxColEmployee]}>Employee</Text>
                  <Text style={[styles.storeTxHeader, styles.storeTxColAmount, styles.storeTxHeaderEnd]}>
                    Amount
                  </Text>
                </View>
                <View style={styles.storeTxChevron} />
              </View>
            ) : null}
            {transactions.map((entry, index) => (
              <TransactionRow
                key={entry.id}
                item={entry}
                last={index === transactions.length - 1}
                onPress={onOpenTransaction}
                priceCheck={priceChecks?.get(entry.id)}
                onPricePress={onPricePress}
                employeePerson={employeePersonForTx(entry, employeesByName, staff)}
                onAmountHover={onAmountHover}
                stacked={isMobile}
                boxed={boxed}
              />
            ))}
          </>
        )}
      </View>
    </View>
  );
}

const InventoryRow = memo(function InventoryRow({
  row,
  qty,
  preorder = 0,
  last,
  dashboard = false,
  boxed = false,
  prices = null,
  onPress,
}) {
  const qtyLabel = qty === 0 ? '—' : formatQty(qty);
  const preorderLabel = preorder === 0 ? '—' : formatQty(preorder);
  const preorderOverQty = preorder > qty;
  const buyLabel = prices?.buyLabel || '—';
  const sellLabel = prices?.sellLabel || '—';
  const rowLabel = `${row.name} quantity ${qtyLabel} preorder ${preorderLabel}`;

  if (boxed) {
    return (
      <Pressable
        onPress={() => onPress?.(row)}
        style={({ hovered, pressed }) => [
          styles.overviewTxRow,
          last && styles.overviewTxRowLast,
          styles.inventoryTxRow,
          (hovered || pressed) && styles.overviewStatsRowHover,
        ]}
        accessibilityRole="button"
        accessibilityLabel={rowLabel}
      >
        <View style={styles.storeTxRowBody}>
          <View style={styles.invColItem}>
            <Text style={styles.storeTxName} numberOfLines={1}>
              {row.name}
            </Text>
          </View>
          <Text
            style={[styles.storeTxAmount, styles.invColBuy, !prices?.buyLabel && styles.rowValueMuted]}
            numberOfLines={1}
          >
            {buyLabel}
          </Text>
          <Text
            style={[styles.storeTxAmount, styles.invColSell, !prices?.sellLabel && styles.rowValueMuted]}
            numberOfLines={1}
          >
            {sellLabel}
          </Text>
          <Text
            style={[
              styles.storeTxAmount,
              styles.invColPreorder,
              preorder === 0 && styles.rowValueMuted,
              preorderOverQty && styles.invPreorderOver,
            ]}
            numberOfLines={1}
          >
            {preorderLabel}
          </Text>
          <Text
            style={[
              styles.storeTxAmount,
              styles.invColQty,
              qty === 0 && styles.rowValueMuted,
            ]}
            numberOfLines={1}
          >
            {qtyLabel}
          </Text>
        </View>
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={() => onPress?.(row)}
      style={({ hovered, pressed }) => [
        dashboard ? styles.dashPersonRow : styles.row,
        last && styles.rowLast,
        (hovered || pressed) && styles.rowHovered,
      ]}
      accessibilityRole="button"
      accessibilityLabel={rowLabel}
    >
      {row.priority ? (
        <View style={[styles.priorityDot, { backgroundColor: PRIORITY_COLORS[row.priority] }]} />
      ) : (
        <View style={dashboard ? null : styles.priorityDotSpacer} />
      )}
      <View style={styles.rowCopy}>
        <Text style={dashboard ? styles.dashTitle : styles.rowTitle} numberOfLines={1}>
          {row.name}
        </Text>
        <Text style={dashboard ? styles.dashMeta : styles.rowSubtitle} numberOfLines={1}>
          {[
            row.sku,
            buyLabel !== '—' ? `Buy ${buyLabel}` : '',
            sellLabel !== '—' ? `Sell ${sellLabel}` : '',
          ]
            .filter(Boolean)
            .join(' · ') || '—'}
        </Text>
      </View>
      {preorder ? (
        <Text
          style={[
            dashboard ? styles.dashValue : styles.rowValue,
            styles.invMobilePreorder,
            preorderOverQty && styles.invPreorderOver,
          ]}
        >
          {preorderLabel}
        </Text>
      ) : null}
      <Text style={[dashboard ? styles.dashValue : styles.rowValue, qty === 0 && styles.rowValueMuted]}>
        {qtyLabel}
      </Text>
      <Ionicons name="chevron-forward" size={16} color="#c7c7cc" />
    </Pressable>
  );
});

function ShowMoreRow({ remaining, onPress, boxed = false }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ hovered, pressed }) => [
        boxed
          ? [styles.overviewTxRow, styles.overviewTxRowLast]
          : [styles.row, styles.rowLast, styles.showMoreRow],
        (hovered || pressed) && (boxed ? styles.overviewStatsRowHover : styles.rowHovered),
      ]}
      accessibilityRole="button"
      accessibilityLabel={`Show ${remaining} more items`}
    >
      <View style={boxed ? styles.storeTxRowBody : null}>
        <Text style={boxed ? styles.storeTxMeta : styles.showMoreText}>Show {remaining} more</Text>
      </View>
      {boxed ? null : <Ionicons name="chevron-down" size={14} color={BLUE} />}
    </Pressable>
  );
}

function EmptyRow({ text, boxed = false }) {
  return (
    <View
      style={
        boxed
          ? [styles.overviewTxRow, styles.overviewTxRowLast, styles.inventoryTxRow]
          : [styles.row, styles.rowStatic, styles.rowLast]
      }
    >
      <View style={boxed ? styles.storeTxRowBody : null}>
        <Text style={styles.emptyText}>{text}</Text>
      </View>
    </View>
  );
}

function LoadingRow({ boxed = false }) {
  return (
    <View
      style={
        boxed
          ? [styles.overviewTxRow, styles.overviewTxRowLast, styles.inventoryTxRow, styles.loadingRow]
          : [styles.row, styles.rowLast, styles.loadingRow]
      }
    >
      <ActivityIndicator size="small" color={BLUE} />
    </View>
  );
}

function callsInRange(calls, startKey, endKey) {
  if (!startKey || !endKey) return Array.isArray(calls) ? calls : [];
  return (Array.isArray(calls) ? calls : []).filter((call) => {
    const time = Date.parse(call.startTime);
    if (!Number.isFinite(time)) return false;
    const day = formatDateParam(new Date(time));
    return day >= startKey && day <= endKey;
  });
}

function storeEmailCapture(txRows, storeName) {
  const rows = buildEmailCaptureByStore(Array.isArray(txRows) ? txRows : []);
  if (!rows.length) return null;
  return rows.find((row) => namesMatch(row.store, storeName)) || (rows.length === 1 ? rows[0] : null);
}

function EmailsSnapshotBody({ storeName, txRows, periodLabel, ready, full = false, boxed = false }) {
  const capture = useMemo(() => storeEmailCapture(txRows, storeName), [storeName, txRows]);
  const people = useMemo(() => capture?.people || [], [capture]);
  const missing = useMemo(
    () => people.filter((person) => !person.hasEmail),
    [people],
  );
  const periodText = periodLabel === 'Today' ? 'today' : 'in this period';

  if (!ready && !capture) return boxed ? <LoadingRow boxed /> : <LoadingRow />;

  if (!capture || capture.totalTransactions === 0) {
    return boxed ? (
      <SnapshotTable columns={EMAIL_TABLE_COLS}>
        <EmptyRow boxed text={`No customers ${periodText}.`} />
      </SnapshotTable>
    ) : full ? (
      <Text style={styles.homeTxEmpty}>{`No customers ${periodText}.`}</Text>
    ) : (
      <EmptyRow text={`No customers ${periodText}.`} />
    );
  }

  const hero = (
    <View style={styles.emailHero}>
      <Text style={styles.emailHeroLabel}>Email capture</Text>
      <Text style={[styles.emailHeroValue, capture.customerCount === 0 && styles.rowValueMuted]}>
        {capture.customerCount === 0 ? '—' : capture.rateLabel}
      </Text>
      <Text style={styles.emailHeroMeta}>
        {capture.customerCount === 0
          ? `${capture.walkInCount} walk-in · no named customers ${periodText}`
          : `${capture.withEmail} of ${capture.customerCount} named with email · ${capture.walkInCount} walk-in`}
      </Text>
    </View>
  );

  if (boxed) {
    if (people.length === 0) {
      return (
        <SnapshotTable columns={EMAIL_TABLE_COLS}>
          <EmptyRow boxed text={`No named customers ${periodText}.`} />
        </SnapshotTable>
      );
    }
    return (
      <SnapshotTable columns={EMAIL_TABLE_COLS}>
        {people.map((person, index) => (
          <SnapshotTableRow
            key={person.id || `${person.customerName}-${index}`}
            last={index === people.length - 1}
            cells={[
              { key: 'person', text: person.customerName || '—', style: 'appColMain' },
              {
                key: 'email',
                text: person.emailLabel || '—',
                style: 'appColWide',
                muted: !person.hasEmail,
              },
              { key: 'employee', text: person.employeeName || '—', style: 'appColMid' },
            ]}
          />
        ))}
      </SnapshotTable>
    );
  }

  if (full) {
    if (people.length === 0) {
      return (
        <>
          {hero}
          <Text style={styles.homeTxEmpty}>{`No named customers ${periodText}.`}</Text>
        </>
      );
    }
    return (
      <>
        {hero}
        <View style={[styles.txTableHeader, styles.homeTabHeader]}>
          <Text style={[styles.homeTxHeaderLabel, styles.homeTabColPerson]} numberOfLines={1}>
            Person
          </Text>
          <Text style={[styles.homeTxHeaderLabel, styles.homeTabColEmail]} numberOfLines={1}>
            Email
          </Text>
          <Text style={[styles.homeTxHeaderLabel, styles.homeTabColEmployee]} numberOfLines={1}>
            Employee
          </Text>
        </View>
        {people.map((person, index) => (
          <View
            key={person.id || `${person.customerName}-${index}`}
            style={[styles.homeTabRow, index === people.length - 1 && styles.rowLast]}
          >
            <Text style={[styles.txCell, styles.txCellPrimary, styles.homeTabColPerson]} numberOfLines={1}>
              {person.customerName || '—'}
            </Text>
            <Text
              style={[
                styles.txCell,
                styles.homeTabColEmail,
                !person.hasEmail && styles.rowValueMuted,
              ]}
              numberOfLines={1}
            >
              {person.emailLabel || '—'}
            </Text>
            <Text style={[styles.txCell, styles.txCellSecondary, styles.homeTabColEmployee]} numberOfLines={1}>
              {person.employeeName || '—'}
            </Text>
          </View>
        ))}
      </>
    );
  }

  return (
    <>
      {hero}
      {capture.customerCount > 0 ? (
        missing.length === 0 ? (
          <View style={[styles.row, styles.rowStatic, styles.rowLast]}>
            <Ionicons name="checkmark-circle" size={16} color={GREEN} />
            <Text style={styles.emptyText}>Every named customer left an email.</Text>
          </View>
        ) : (
          <>
            <Text style={styles.emailSectionLabel}>
              Missing email · {missing.length}
            </Text>
            {missing.map((person, index) => (
              <View
                key={person.id || `${person.customerName}-${index}`}
                style={[styles.row, styles.rowStatic, styles.emailRow, index === missing.length - 1 && styles.rowLast]}
              >
                <Ionicons name="mail-unread-outline" size={16} color={RED} />
                <View style={styles.rowCopy}>
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {person.customerName}
                  </Text>
                  <Text style={styles.rowSubtitle} numberOfLines={1}>
                    {[person.reference, person.employeeName].filter((part) => part && part !== '—').join(' · ') ||
                      'No email on file'}
                  </Text>
                </View>
              </View>
            ))}
          </>
        )
      ) : null}
    </>
  );
}

function employeePersonForTx(item, employeesByName, staff) {
  const name = String(item?.employeeName || '').trim();
  if (!name || name === '—') return { name: '—', photoUrl: '' };
  const fromPresent = employeesByName.get(name.toLowerCase());
  if (fromPresent?.photoUrl) return fromPresent;
  const match = findStaffByEmployeeName(staff, name);
  return {
    name: fromPresent?.name || name,
    photoUrl: match?.avatarUrl || match?.photoUrl || fromPresent?.photoUrl || '',
  };
}

function StoreSnapshotPanel({
  session,
  store,
  periodLabel = 'Today',
  startKey,
  endKey,
  txRows = [],
  onOpenTransaction,
  onOpenApp,
  onAmountHover,
  onFilterTop,
  filterSlotWidth = 0,
  topInset = 0,
  ready = true,
  desktopHeader = null,
  dateHero = null,
  heroFocus: heroFocusProp = 'all',
  focusTab = 'overview',
  desktopApps = [],
  appsOpen = false,
  onAppsOpenChange,
  embeddedApp = null,
  transactionTicket = null,
  onSelectedItemChange,
  inventoryCloseRef,
}) {
  const storeName = store?.store || '';
  const isMobile = useIsMobile();
  const tabBarScroll = useMobileTabBarScrollProps();
  const { hasApp } = useAppAccess();
  const phone = usePhoneCalls();
  const showPhone = hasApp('phone');
  const showEmails = hasApp('emails');
  const showFinancials = hasApp('financials');
  const showInventory = hasApp('inventory');
  const [inventoryQuery, setInventoryQuery] = useState('');
  const [selectedItemId, setSelectedItemId] = useState(null);
  const [inventoryLimit, setInventoryLimit] = useState(INVENTORY_PAGE);
  const [txQuery, setTxQuery] = useState('');
  const [txColumnFilters, setTxColumnFilters] = useState({});
  const [openTxFilter, setOpenTxFilter] = useState(null);
  const [cash, setCash] = useState(() => peekStoreCashPosition(session, { storeName: store?.store || '' }));
  const [cashLoading, setCashLoading] = useState(() => !peekStoreCashPosition(session, { storeName: store?.store || '' }));
  const [cashError, setCashError] = useState('');
  const [inventoryStores, setInventoryStores] = useState([]);
  const [inventoryRows, setInventoryRows] = useState([]);
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [inventoryError, setInventoryError] = useState('');
  const [priceCatalog, setPriceCatalog] = useState(null);
  const [priceRefreshing, setPriceRefreshing] = useState(false);
  const [staff, setStaff] = useState([]);
  const [staffLoading, setStaffLoading] = useState(false);
  const [txCatalogs, setTxCatalogs] = useState(() => new Map());
  const [priceReview, setPriceReview] = useState(null);
  const [heroFocus, setHeroFocus] = useState(heroFocusProp || 'all');
  const [reviewStats, setReviewStats] = useState(() =>
    reviewStatsFromReviews(peekHomeStoreReviews(storeName, startKey, endKey) || []),
  );
  const [storeContact, setStoreContact] = useState({ address: '', phone: '', email: '' });
  useEffect(() => {
    setHeroFocus(heroFocusProp || 'all');
  }, [heroFocusProp, storeName]);
  useEffect(() => {
    if (!session?.token || !storeName) {
      setStoreContact({ address: '', phone: '', email: '' });
      return undefined;
    }
    let cancelled = false;
    fetchTransferStores(session)
      .then(({ stores }) => {
        if (cancelled) return;
        const match = preferStoreByName(stores, storeName);
        const phone = cleanStoreContact(match?.phone);
        setStoreContact({
          address: cleanStoreContact(match?.address),
          phone: phone ? formatPhoneNumber(phone) : '',
          email: cleanStoreContact(match?.email),
        });
      })
      .catch(() => {
        if (!cancelled) setStoreContact({ address: '', phone: '', email: '' });
      });
    return () => {
      cancelled = true;
    };
  }, [session, storeName]);
  useEffect(() => {
    const cached = peekHomeStoreReviews(storeName, startKey, endKey);
    setReviewStats(reviewStatsFromReviews(cached || []));
    if (!storeName || !startKey || !endKey) return undefined;
    let cancelled = false;
    fetchGoogleReviewsForStore(storeName, { startDate: startKey, endDate: endKey })
      .then((fetched) => {
        if (cancelled) return;
        const reviews = fetched?.reviews || [];
        rememberHomeStoreReviews(storeName, startKey, endKey, reviews);
        setReviewStats(reviewStatsFromReviews(reviews));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [endKey, startKey, storeName]);
  const tolerance = usePriceCheckTolerance();
  const [stageHeight, setStageHeight] = useState(0);
  const ticketOpen = Boolean(transactionTicket);
  const pageScrollRef = useRef(null);
  const cashRequestId = useRef(0);
  const inventoryRequestId = useRef(0);
  const hasInventoryRef = useRef(false);

  const loadCash = useCallback(async ({ silent = false } = {}) => {
    if (!session?.token || !storeName) {
      setCash(null);
      setCashError('');
      return;
    }
    const id = ++cashRequestId.current;
    if (!silent) {
      setCashLoading(true);
      setCashError('');
    }
    try {
      const cached = peekStoreCashPosition(session, { storeName });
      if (cached) {
        setCash(keepIfSame(cached));
        setCashLoading(false);
      }
      const result = await fetchStoreCashPosition(session, { storeName });
      if (id !== cashRequestId.current) return;
      setCash(keepIfSame(result));
      setCashError('');
    } catch (err) {
      if (id !== cashRequestId.current) return;
      if (silent) return;
      setCash(null);
      setCashError(err?.message || 'Failed to load cash.');
    } finally {
      if (id === cashRequestId.current) setCashLoading(false);
    }
  }, [session, storeName]);

  const loadInventory = useCallback(async ({ silent = false, force = false } = {}) => {
    if (!session?.token) {
      setInventoryStores([]);
      setInventoryRows([]);
      setInventoryError('');
      hasInventoryRef.current = false;
      return;
    }
    const id = ++inventoryRequestId.current;
    const cached = !force ? peekInventoryMatrix(session) : null;
    if (cached) {
      setInventoryStores(keepIfSame(cached.stores));
      setInventoryRows(keepIfSame(cached.rows));
      setInventoryError('');
      hasInventoryRef.current = true;
      setInventoryLoading(false);
      return;
    }
    if (!silent && !hasInventoryRef.current) setInventoryLoading(true);
    if (!silent) setInventoryError('');
    try {
      const result = await fetchInventoryMatrix(session, { force });
      if (id !== inventoryRequestId.current) return;
      setInventoryStores(keepIfSame(result.stores));
      setInventoryRows(keepIfSame(result.rows));
      setInventoryError('');
      hasInventoryRef.current = true;
    } catch (err) {
      if (id !== inventoryRequestId.current) return;
      if (silent && hasInventoryRef.current) return;
      if (!hasInventoryRef.current) {
        setInventoryStores([]);
        setInventoryRows([]);
      }
      setInventoryError(err?.message || 'Failed to load inventory.');
    } finally {
      if (id === inventoryRequestId.current) setInventoryLoading(false);
    }
  }, [session]);

  const loadStaff = useCallback(async () => {
    if (!storeName) {
      setStaff([]);
      return;
    }
    setStaffLoading(true);
    try {
      const rows = await listStaffProfiles();
      setStaff(keepIfSame((rows || []).filter((row) => row.isActive !== false)));
    } catch {
      setStaff((current) => current);
    } finally {
      setStaffLoading(false);
    }
  }, [storeName]);

  useEffect(() => {
    setInventoryQuery('');
    setSelectedItemId(null);
    setTxQuery('');
    setTxColumnFilters({});
    setOpenTxFilter(null);
    const cached = peekStoreCashPosition(session, { storeName });
    setCash(cached);
    setCashError('');
    setCashLoading(!cached);
  }, [session, storeName]);

  useEffect(() => {
    loadCash();
  }, [loadCash]);

  useEffect(() => {
    loadInventory();
  }, [loadInventory]);

  const loadPrices = useCallback(async ({ force = false, silent = true } = {}) => {
    if (!showInventory) return;
    if (!silent) setPriceRefreshing(true);
    try {
      const catalog = await fetchWebsitePrices({ force });
      setPriceCatalog(keepIfSame(catalog));
    } catch {
      // Keep the last catalog; quantities keep updating on their own.
    } finally {
      if (!silent) setPriceRefreshing(false);
    }
  }, [showInventory]);

  useEffect(() => {
    loadPrices();
  }, [loadPrices]);

  useEffect(() => {
    loadStaff();
  }, [loadStaff]);

  useLiveRefresh(loadCash, AUREUS_CASH_LIVE_MS, Boolean(session?.token && storeName));
  useLiveRefresh(
    (opts) => loadInventory({ ...opts, force: true }),
    INVENTORY_LIVE_MS,
    Boolean(session?.token && storeName),
  );

  const storeColumns = useMemo(
    () => pickStoreColumns(inventoryStores, storeName),
    [inventoryStores, storeName],
  );
  const storeId = storeColumns[0]?.id;
  const searching = Boolean(inventoryQuery.trim());

  useEffect(() => {
    setInventoryLimit(focusTab === 'inventory' ? 80 : INVENTORY_PAGE);
  }, [focusTab, inventoryQuery, storeName]);

  useEffect(() => {
    setSelectedItemId(null);
  }, [focusTab, storeName]);

  // Typing in the inventory search returns to the filtered list.
  useEffect(() => {
    if (inventoryQuery.trim()) setSelectedItemId(null);
  }, [inventoryQuery]);

  const txIdKey = txRows.map((row) => row.id).join('\n');
  const pricedKey = txRows
    .map((row) => `${row.id}:${row.lineItemsLoaded ? 1 : 0}:${(row.pricedLines || []).length}`)
    .join('\n');
  const txRowsRef = useRef(txRows);
  const txCatalogsRef = useRef(txCatalogs);
  txRowsRef.current = txRows;
  txCatalogsRef.current = txCatalogs;

  useEffect(() => {
    const ids = txIdKey ? txIdKey.split('\n').filter(Boolean) : [];
    if (!ids.length) return undefined;
    let cancelled = false;
    loadTransactionPriceSnapshots(ids)
      .then((found) => {
        if (cancelled || !found.size) return;
        setTxCatalogs((current) => {
          let changed = false;
          const next = new Map(current);
          for (const [id, snap] of found) {
            if (!next.has(id)) {
              next.set(id, snap);
              changed = true;
            }
          }
          return changed ? next : current;
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [txIdKey]);

  useEffect(() => {
    const need = txRowsRef.current.filter((row) => {
      if (txCatalogsRef.current.has(row.id) || peekPriceCatalogSnapshot(row.id)) return false;
      return Array.isArray(row.pricedLines) && row.pricedLines.length > 0;
    });
    if (!need.length) return undefined;
    let cancelled = false;
    (async () => {
      for (const row of need) {
        if (cancelled) return;
        try {
          const snap = await capturePurchasePriceCatalog(row);
          if (cancelled || !snap) continue;
          setTxCatalogs((current) => {
            if (current.has(row.id)) return current;
            const next = new Map(current);
            next.set(row.id, snap);
            return next;
          });
        } catch {
          // Retry when this row's priced lines change.
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pricedKey]);

  // Reuse a row's price check while the row, frozen catalog, and tolerance
  // are unchanged, so unchanged rows keep the same `priceCheck` prop.
  const priceCheckCache = useRef({ tolerance: null, byRow: new WeakMap() });
  const priceChecks = useMemo(() => {
    const cache = priceCheckCache.current;
    if (cache.tolerance !== tolerance) {
      cache.tolerance = tolerance;
      cache.byRow = new WeakMap();
    }
    const map = new Map();
    for (const row of txRows) {
      const catalog = txCatalogs.get(row.id) || peekPriceCatalogSnapshot(row.id) || null;
      let check = cache.byRow.get(row);
      if (!check || check._catalog !== catalog) {
        check = checkTransactionPrices(row, catalog, { tolerance });
        check._catalog = catalog;
        cache.byRow.set(row, check);
      }
      map.set(row.id, check);
    }
    return map;
  }, [txCatalogs, txRows, tolerance]);

  const allItems = useMemo(() => {
    if (!storeId) return [];
    return inventoryRows
      .map((row) => ({
        row,
        storeQty: row.quantities[storeId] || 0,
        storePreorder: row.preorders?.[storeId] || 0,
        qty: row.total || 0,
        preorder: row.preorderTotal || 0,
      }))
      .filter(({ row, storeQty, storePreorder }) =>
        searching ? itemMatches(row, inventoryQuery) : storeQty !== 0 || storePreorder !== 0,
      );
  }, [inventoryRows, storeId, inventoryQuery, searching]);
  const visibleItems = useMemo(
    () => (allItems.length > inventoryLimit ? allItems.slice(0, inventoryLimit) : allItems),
    [allItems, inventoryLimit],
  );
  const hiddenItemCount = allItems.length - visibleItems.length;
  const showMoreItems = useCallback(() => {
    setInventoryLimit((current) => current + INVENTORY_PAGE);
  }, []);
  const selectedItem = useMemo(
    () => inventoryRows.find((row) => row.id === selectedItemId) || null,
    [inventoryRows, selectedItemId],
  );
  const selectedItemTxRows = useMemo(
    () => (selectedItem ? txRows.filter((row) => transactionHasItem(row, selectedItem)) : []),
    [selectedItem, txRows],
  );
  const selectedItemTxPending = useMemo(
    () => (selectedItem ? txRows.some((row) => !row.lineItemsLoaded && !(row.pricedLines || []).length) : false),
    [selectedItem, txRows],
  );
  const openInventoryItem = useCallback((row) => {
    if (row?.id) setSelectedItemId(row.id);
  }, []);
  const closeInventoryItem = useCallback(() => {
    setSelectedItemId(null);
  }, []);

  useEffect(() => {
    if (inventoryCloseRef) inventoryCloseRef.current = closeInventoryItem;
    return () => {
      if (inventoryCloseRef) inventoryCloseRef.current = null;
    };
  }, [closeInventoryItem, inventoryCloseRef]);

  useEffect(() => {
    onSelectedItemChange?.(selectedItem?.name || '');
    return () => onSelectedItemChange?.('');
  }, [onSelectedItemChange, selectedItem?.name]);
  const inventoryPrices = useMemo(() => {
    const map = new Map();
    if (!priceCatalog) return map;
    for (const row of inventoryRows) {
      map.set(row.id, inventoryRowWebsitePrice(row, priceCatalog));
    }
    return map;
  }, [inventoryRows, priceCatalog]);

  const cashSlips = useTxnCashBreakdowns(txRows);
  const focusedTxRows = useMemo(() => {
    if (heroFocus === 'sales') return txRows.filter((row) => row.type !== 'purchase');
    if (heroFocus === 'purchases') return txRows.filter((row) => row.type === 'purchase');
    return txRows;
  }, [heroFocus, txRows]);
  const txColumnOptions = useMemo(() => buildOverviewTxOptions(focusedTxRows), [focusedTxRows]);
  const visibleTxRows = useMemo(() => {
    let rows = focusedTxRows;
    if (txQuery.trim()) rows = rows.filter((row) => txMatches(row, txQuery));
    for (const col of OVERVIEW_TX_FILTERS) {
      const filter = txColumnFilters[col.key];
      if (filter == null) continue;
      rows = rows.filter((row) => Boolean(filter[col.value(row)]));
    }
    return rows;
  }, [focusedTxRows, txColumnFilters, txQuery]);
  const txFilterCount = useMemo(
    () => OVERVIEW_TX_FILTERS.reduce((count, col) => count + (txColumnFilters[col.key] != null ? 1 : 0), 0),
    [txColumnFilters],
  );
  const txMeta = String(visibleTxRows.length);
  const itemMeta = searching
    ? `${allItems.length} match${allItems.length === 1 ? '' : 'es'}`
    : storeId
      ? `${allItems.length} in stock`
      : '';

  const presentEmployees = useMemo(() => {
    const byKey = new Map();
    for (const row of txRows) {
      const name = String(row.employeeName || '').trim();
      if (!name || name === '—') continue;
      const key = name.toLowerCase();
      const current = byKey.get(key) || {
        name,
        txCount: 0,
        photoUrl: '',
        role: '',
      };
      current.txCount += 1;
      const match = findStaffByEmployeeName(staff, name);
      if (match) {
        current.photoUrl = match.avatarUrl || match.photoUrl || current.photoUrl;
        current.role = match.employeeType || match.posRole || current.role;
      }
      byKey.set(key, current);
    }
    for (const person of staff) {
      if (!personMatchesStore(person, storeName)) continue;
      const name = staffDisplayName(person);
      const key = name.toLowerCase();
      if (byKey.has(key)) {
        const current = byKey.get(key);
        current.photoUrl = person.avatarUrl || person.photoUrl || current.photoUrl;
        current.role = person.employeeType || person.posRole || current.role;
        continue;
      }
      const already = [...byKey.values()].some((entry) => personMatchesTxName(person, entry.name));
      if (already) continue;
      byKey.set(key, {
        name,
        txCount: 0,
        photoUrl: person.avatarUrl || person.photoUrl || '',
        role: person.employeeType || person.posRole || '',
      });
    }
    return Array.from(byKey.values()).sort((a, b) => {
      if (b.txCount !== a.txCount) return b.txCount - a.txCount;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });
  }, [txRows, staff, storeName]);

  const employeesByName = useMemo(() => {
    const map = new Map();
    for (const person of presentEmployees) {
      map.set(String(person.name || '').trim().toLowerCase(), person);
    }
    return map;
  }, [presentEmployees]);

  const storeKey = storeKeyFromName(storeName);
  const [historyCalls, setHistoryCalls] = useState([]);
  useEffect(() => {
    if (storeKey) phone.refreshInbox?.(storeKey, { silent: true }).catch(() => {});
  }, [phone.refreshInbox, storeKey]);
  useEffect(() => {
    if (!storeName || !startKey || !endKey) {
      setHistoryCalls([]);
      return undefined;
    }
    const dateFrom = parseDateParam(startKey);
    const dateTo = parseDateParam(endKey);
    dateTo.setDate(dateTo.getDate() + 1);
    const peeked = peekPhoneHistory(storeName, { dateFrom, dateTo });
    setHistoryCalls(peeked?.calls || []);
    if (!phoneHistoryNeeded(startKey, endKey)) return undefined;
    let cancelled = false;
    fetchPhoneHistory(storeName, { dateFrom, dateTo })
      .then((payload) => {
        if (!cancelled) setHistoryCalls(payload.calls || []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [endKey, startKey, storeName]);
  const phoneCalls = useMemo(() => {
    const inbox = callsInRange(callsForStore(phone.mergedCallsByStore, storeName), startKey, endKey);
    const history = callsInRange(historyCalls, startKey, endKey);
    return mergeCallLog(history, inbox);
  }, [endKey, historyCalls, phone.mergedCallsByStore, startKey, storeName]);
  const allPhoneCalls = useMemo(
    () => mergeCallLog(historyCalls, callsForStore(phone.mergedCallsByStore, storeName)),
    [historyCalls, phone.mergedCallsByStore, storeName],
  );
  const phoneRatio = useMemo(() => inboundCallRatio(phoneCalls, allPhoneCalls), [allPhoneCalls, phoneCalls]);
  const emailCapture = useMemo(
    () => storeEmailCapture(txRows, storeName),
    [storeName, txRows],
  );

  const cadAmt = cash?.cad?.aureusOnHand ?? cash?.cad?.expectedOnHand ?? 0;
  const cashCad = cash?.cad
    ? {
        amount: cadAmt,
        opening: cash.cad.openingBalance,
        moved: cash.cad.movementNet,
      }
    : null;

  const useOverviewInvTable =
    !isMobile && !embeddedApp && !ticketOpen && focusTab === 'inventory';
  const selectedItemHead = selectedItem ? (
    <InventoryItemHead
      item={selectedItem}
      storeId={storeId}
      storeName={storeName}
      prices={inventoryPrices.get(selectedItem.id)}
      priceCatalog={priceCatalog}
      isMobile={isMobile}
      onBackToList={closeInventoryItem}
    />
  ) : null;
  const inventoryRowsBody = selectedItem ? (
    <>
      {useOverviewInvTable ? null : <View style={styles.itemHeadMobileWrap}>{selectedItemHead}</View>}
      <InventoryItemBody
        item={selectedItem}
        storeId={storeId}
        stores={inventoryStores}
        periodLabel={periodLabel}
        transactions={selectedItemTxRows}
        pending={selectedItemTxPending}
        boxed={useOverviewInvTable}
        isMobile={isMobile}
        employeesByName={employeesByName}
        staff={staff}
        onOpenTransaction={onOpenTransaction}
        onAmountHover={onAmountHover}
        onPricePress={setPriceReview}
        priceChecks={priceChecks}
      />
    </>
  ) : inventoryError && !hasInventoryRef.current ? (
      <Pressable onPress={loadInventory}>
        <EmptyRow boxed={useOverviewInvTable} text={`${inventoryError} · Tap to retry`} />
      </Pressable>
    ) : (inventoryLoading && inventoryRows.length === 0) || !ready ? (
      <LoadingRow boxed={useOverviewInvTable} />
    ) : !storeId ? (
      <EmptyRow boxed={useOverviewInvTable} text={`No inventory data for ${storeName || 'this store'}.`} />
    ) : visibleItems.length === 0 ? (
      <EmptyRow boxed={useOverviewInvTable} text={searching ? 'No matching items.' : 'No stocked items.'} />
    ) : (
      <>
        {useOverviewInvTable ? (
          <View style={[styles.overviewTxRow, styles.overviewTxHeader]}>
            <View style={styles.storeTxRowBody}>
              <Text style={[styles.storeTxHeader, styles.invColItem]}>Item</Text>
              <Text style={[styles.storeTxHeader, styles.invColBuy]}>What we buy</Text>
              <Text style={[styles.storeTxHeader, styles.invColSell]}>What we sell</Text>
              <Text style={[styles.storeTxHeader, styles.invColPreorder, styles.storeTxHeaderEnd]}>Preorder</Text>
              <Text style={[styles.storeTxHeader, styles.invColQty, styles.storeTxHeaderEnd]}>Qty</Text>
            </View>
          </View>
        ) : null}
        {visibleItems.map(({ row, qty, preorder }, index) => (
          <InventoryRow
            key={row.id}
            row={row}
            qty={qty}
            preorder={preorder}
            dashboard
            boxed={useOverviewInvTable}
            prices={inventoryPrices.get(row.id)}
            last={hiddenItemCount === 0 && index === visibleItems.length - 1}
            onPress={openInventoryItem}
          />
        ))}
        {hiddenItemCount > 0 ? (
          <ShowMoreRow remaining={hiddenItemCount} onPress={showMoreItems} boxed={useOverviewInvTable} />
        ) : null}
      </>
    );
  const inventoryBody =
    selectedItem || !useOverviewInvTable ? (
      <View style={useOverviewInvTable ? styles.overviewListWrap : null}>{inventoryRowsBody}</View>
    ) : (
      <View style={styles.overviewListWrap}>
        <View style={styles.overviewListBox}>{inventoryRowsBody}</View>
      </View>
    );

  const useDesktopAppTable = !isMobile && !ticketOpen;
  const cashLedgerRows = useMemo(() => {
    const payments = cash?.paymentRows || [];
    const txns = cash?.cashTransactions || [];
    return [...payments, ...txns];
  }, [cash]);
  const inventoryTotals = useMemo(() => {
    let qty = 0;
    let preorder = 0;
    let company = 0;
    for (const item of allItems) {
      qty += Number(item.storeQty) || 0;
      preorder += Number(item.storePreorder) || 0;
      company += Number(item.qty) || 0;
    }
    return { skus: allItems.length, qty, preorder, company };
  }, [allItems]);

  const financialsBody = cashError ? (
    <Pressable onPress={loadCash}>
      {useDesktopAppTable ? (
        <SnapshotTable columns={CASH_TABLE_COLS}>
          <EmptyRow boxed text={`${cashError} · Tap to retry`} />
        </SnapshotTable>
      ) : (
        <EmptyRow text={`${cashError} · Tap to retry`} />
      )}
    </Pressable>
  ) : cashLoading && !cash ? (
    useDesktopAppTable ? (
      <SnapshotTable columns={CASH_TABLE_COLS}>
        <LoadingRow boxed />
      </SnapshotTable>
    ) : (
      <LoadingRow />
    )
  ) : useDesktopAppTable ? (
    <SnapshotTable columns={CASH_TABLE_COLS}>
      {cashLedgerRows.length ? (
        cashLedgerRows.map((row, index) => (
          <SnapshotTableRow
            key={row.id || `${row.directionLabel}-${index}`}
            last={index === cashLedgerRows.length - 1}
            cells={[
              { key: 'kind', text: row.directionLabel || row.type || '—', style: 'appColMid' },
              {
                key: 'who',
                text: row.customerName || row.category || '—',
                style: 'appColMain',
              },
              {
                key: 'ref',
                text: row.reference || row.comments || '—',
                style: 'appColMid',
                muted: !(row.reference || row.comments),
              },
              {
                key: 'amount',
                text: row.amountLabel || '—',
                style: 'appColEnd',
                end: true,
              },
            ]}
          />
        ))
      ) : (
        <EmptyRow boxed text="No till movement for this store." />
      )}
    </SnapshotTable>
  ) : cash ? (
    <View style={styles.cashHeroStack}>
      <ExpectedCash cad={cash.cad} usd={cash.usd} />
    </View>
  ) : (
    <EmptyRow text="No cash data for this store." />
  );

  const employeesBody = staffLoading && presentEmployees.length === 0 ? (
    useDesktopAppTable ? (
      <SnapshotTable columns={EMPLOYEE_TABLE_COLS}>
        <LoadingRow boxed />
      </SnapshotTable>
    ) : (
      <LoadingRow />
    )
  ) : presentEmployees.length === 0 ? (
    useDesktopAppTable ? (
      <SnapshotTable columns={EMPLOYEE_TABLE_COLS}>
        <EmptyRow boxed text="No employees at this store right now." />
      </SnapshotTable>
    ) : (
      <EmptyRow text="No employees at this store right now." />
    )
  ) : useDesktopAppTable ? (
    <SnapshotTable columns={EMPLOYEE_TABLE_COLS}>
      {presentEmployees.map((person, index) => (
        <SnapshotTableRow
          key={`${person.name}-${index}`}
          last={index === presentEmployees.length - 1}
          cells={[
            { key: 'name', text: person.name, style: 'appColMain' },
            { key: 'role', text: person.role || '—', style: 'appColMid', muted: !person.role },
            {
              key: 'tx',
              text: String(person.txCount || 0),
              style: 'appColEnd',
              end: true,
              muted: !person.txCount,
            },
          ]}
        />
      ))}
    </SnapshotTable>
  ) : (
    <View style={styles.employeeCardGrid}>
      {presentEmployees.map((person, index) => (
        <EmployeeCard key={`${person.name}-${index}`} person={person} />
      ))}
    </View>
  );

  const emptyTxCopy = txQuery.trim() || txFilterCount
    ? 'No matching transactions.'
    : heroFocus === 'sales'
      ? `No sales ${periodLabel === 'Today' ? 'today' : 'in this period'}.`
      : heroFocus === 'purchases'
        ? `No purchases ${periodLabel === 'Today' ? 'today' : 'in this period'}.`
        : `No transactions ${periodLabel === 'Today' ? 'today' : 'in this period'}.`;
  const useOverviewTxTable =
    !isMobile &&
    !embeddedApp &&
    !ticketOpen &&
    (focusTab === 'overview' || focusTab === 'transactions');
  const mappedTxRows =
    visibleTxRows.length === 0 ? (
      <EmptyRow text={emptyTxCopy} />
    ) : (
      <>
        {isMobile ? null : (
          <View
            style={
              useOverviewTxTable
                ? [styles.overviewTxRow, styles.overviewTxHeader]
                : [styles.storeTxRow, styles.storeTxHeaderRow]
            }
            {...(Platform.OS === 'web' && !useOverviewTxTable
              ? { className: 'cgold-home-header-row' }
              : null)}
          >
            <View style={styles.storeTxRowBody}>
              <Text style={[styles.storeTxHeader, styles.storeTxColPhoto]}>Photo</Text>
              {useOverviewTxTable ? (
                OVERVIEW_TX_FILTERS.map((col) => (
                  <OverviewTxHeaderCell
                    key={col.key}
                    label={col.label}
                    colStyle={styles[col.colStyle]}
                    active={txColumnFilters[col.key] != null}
                    end={col.end}
                    iconOnly={col.iconOnly}
                    onPress={(anchor) => setOpenTxFilter({ ...col, anchor })}
                  />
                ))
              ) : (
                <>
                  <Text style={[styles.storeTxHeader, styles.storeTxColCustomer]}>Customer</Text>
                  <Text style={[styles.storeTxHeader, styles.storeTxColKind]}>PO/SO</Text>
                  <Text style={[styles.storeTxHeader, styles.storeTxColNumber]}>Order</Text>
                  <Text style={[styles.storeTxHeader, styles.storeTxColTime]}>Time</Text>
                  <Text style={[styles.storeTxHeader, styles.storeTxColItem]}>Item</Text>
                  <Text style={[styles.storeTxHeader, styles.storeTxColEmployee]}>Employee</Text>
                  <Text style={[styles.storeTxHeader, styles.storeTxColAmount]}>Amount</Text>
                </>
              )}
            </View>
            <View style={styles.storeTxChevron} />
            {useOverviewTxTable ? null : (
              <View
                style={[styles.storeTxRowRule, styles.storeTxHeaderRule]}
                {...(Platform.OS === 'web' ? { className: 'cgold-home-row-rule' } : null)}
              />
            )}
          </View>
        )}
        {visibleTxRows.map((item, index) => (
          <TransactionRow
            key={item.id}
            item={item}
            last={index === visibleTxRows.length - 1}
            onPress={onOpenTransaction}
            priceCheck={priceChecks.get(item.id)}
            onPricePress={setPriceReview}
            employeePerson={employeePersonForTx(item, employeesByName, staff)}
            onAmountHover={onAmountHover}
            stacked={isMobile}
            boxed={useOverviewTxTable}
          />
        ))}
      </>
    );

  const emailRate =
    !emailCapture || !emailCapture.customerCount ? null : Math.round(Number(emailCapture.rate));
  const phoneRate = phoneRatio?.rate == null ? null : Math.round(Number(phoneRatio.rate));
  const rateToneFor = (rate) => (rate == null ? undefined : rate < 80 ? 'low' : 'ok');
  const dash = (value) => (value == null || value === '' ? '—' : value);
  const tillLabel = cashLoading && !cashCad ? '…' : cashCad ? formatAmount(cashCad.amount, 'CAD') : '—';
  const appStatsRows = !isMobile
    ? focusTab === 'overview'
      ? [
          { key: 'cash', icon: 'wallet-outline', label: 'Till', value: tillLabel, onPress: () => onOpenApp?.('financials') },
          {
            key: 'email',
            icon: 'mail-outline',
            label: 'Email',
            value: emailRate == null ? '—' : `${emailRate}%`,
            tone: rateToneFor(emailRate),
            onPress: () => onOpenApp?.('emails'),
          },
          {
            key: 'phone',
            icon: 'call-outline',
            label: 'Phone',
            value: phoneRate == null ? '—' : `${phoneRate}%`,
            tone: rateToneFor(phoneRate),
            onPress: () => onOpenApp?.('phone'),
          },
          {
            key: 'bonus',
            icon: 'gift-outline',
            label: 'Bonus',
            value: reviewStats?.count == null ? '—' : String(reviewStats.count),
            trailing:
              reviewStats?.rate == null ? null : (
                <LowReviewMark count={reviewStats.negative || 0} size={13} countSize={14} />
              ),
            accessibilityLabel:
              reviewStats?.rate == null
                ? 'Bonus'
                : `Bonus ${reviewStats.count}, ${reviewStats.negative || 0} at 1 or 2 stars`,
            onPress: () => onOpenApp?.('bonuses'),
          },
        ]
      : focusTab === 'transactions'
        ? [
            { key: 'tx', icon: 'swap-horizontal-outline', label: 'Transactions', value: String(store?.txCount || 0) },
            { key: 'sales', icon: 'arrow-up-outline', label: 'Sales', value: formatAmount(store?.soAmount, 'CAD') },
            { key: 'purchases', icon: 'arrow-down-outline', label: 'Purchases', value: formatAmount(store?.poAmount, 'CAD') },
            { key: 'total', icon: 'cash-outline', label: 'Total', value: formatAmount(store?.totalAmount, 'CAD') },
          ]
        : focusTab === 'inventory'
          ? [
              { key: 'skus', icon: 'cube-outline', label: 'In stock', value: String(inventoryTotals.skus) },
              { key: 'qty', icon: 'layers-outline', label: 'Quantity', value: inventoryTotals.qty ? formatQty(inventoryTotals.qty) : '—' },
              {
                key: 'preorder',
                icon: 'cart-outline',
                label: 'Preorder',
                value: inventoryTotals.preorder ? formatQty(inventoryTotals.preorder) : '—',
              },
              {
                key: 'company',
                icon: 'business-outline',
                label: 'All stores',
                value: inventoryTotals.company ? formatQty(inventoryTotals.company) : '—',
              },
            ]
          : focusTab === 'financials'
            ? [
                { key: 'till', icon: 'wallet-outline', label: 'CAD till', value: tillLabel },
                {
                  key: 'open',
                  icon: 'log-in-outline',
                  label: 'Open',
                  value: cashCad?.opening == null ? '—' : formatAmount(cashCad.opening, 'CAD'),
                },
                {
                  key: 'today',
                  icon: 'today-outline',
                  label: 'Today',
                  value: cashCad?.moved == null ? '—' : formatAmount(cashCad.moved, 'CAD'),
                },
                {
                  key: 'usd',
                  icon: 'cash-outline',
                  label: 'USD till',
                  value: cash?.usd
                    ? formatAmount(cash.usd.aureusOnHand ?? cash.usd.expectedOnHand, 'USD')
                    : '—',
                },
              ]
            : focusTab === 'employees'
              ? [
                  { key: 'present', icon: 'people-outline', label: 'On floor', value: String(presentEmployees.length) },
                  {
                    key: 'active',
                    icon: 'swap-horizontal-outline',
                    label: 'With transactions',
                    value: String(presentEmployees.filter((person) => person.txCount).length),
                  },
                  {
                    key: 'tickets',
                    icon: 'receipt-outline',
                    label: 'Transactions',
                    value: String(presentEmployees.reduce((sum, person) => sum + (person.txCount || 0), 0)),
                  },
                ]
              : focusTab === 'phone'
                ? [
                    { key: 'calls', icon: 'call-outline', label: 'Calls', value: String(phoneCalls.length) },
                    { key: 'answered', icon: 'checkmark-outline', label: 'Answered', value: dash(phoneRatio?.answered) },
                    { key: 'missed', icon: 'close-outline', label: 'Missed', value: dash(phoneRatio?.missed) },
                    {
                      key: 'rate',
                      icon: 'trending-up-outline',
                      label: 'Answer rate',
                      value: phoneRatio?.ratio || '—',
                      tone: rateToneFor(phoneRate),
                    },
                  ]
                : focusTab === 'emails'
                  ? [
                      {
                        key: 'rate',
                        icon: 'mail-outline',
                        label: 'Capture',
                        value: emailRate == null ? '—' : `${emailRate}%`,
                        tone: rateToneFor(emailRate),
                      },
                      { key: 'named', icon: 'people-outline', label: 'Customers', value: String(emailCapture?.customerCount || 0) },
                      { key: 'with', icon: 'checkmark-outline', label: 'With email', value: String(emailCapture?.withEmail || 0) },
                      { key: 'walk', icon: 'walk-outline', label: 'Walk-in', value: String(emailCapture?.walkInCount || 0) },
                    ]
                  : focusTab === 'bonuses'
                    ? [
                        { key: 'count', icon: 'gift-outline', label: 'Reviews', value: String(reviewStats?.count || 0) },
                        {
                          key: 'avg',
                          icon: 'star-half-outline',
                          label: 'Average',
                          value: reviewStats?.count ? Number(reviewStats.average).toFixed(1) : '—',
                        },
                        { key: 'five', icon: 'thumbs-up-outline', label: '5-star', value: String(reviewStats?.fiveStar || 0) },
                        { key: 'neg', icon: 'thumbs-down-outline', label: 'Negative', value: String(reviewStats?.negative || 0) },
                      ]
                    : focusTab === 'preorders'
                      ? [
                          { key: 'open', icon: 'cart-outline', label: 'Open', value: '—' },
                          { key: 'arrived', icon: 'cube-outline', label: 'Arrived', value: '—' },
                          { key: 'done', icon: 'checkmark-done-outline', label: 'Fulfilled', value: '—' },
                        ]
                      : focusTab === 'audit' || focusTab === 'triage'
                        ? [
                            { key: 'tx', icon: 'swap-horizontal-outline', label: 'Transactions', value: String(store?.txCount || 0) },
                            { key: 'sales', icon: 'arrow-up-outline', label: 'Sales', value: formatAmount(store?.soAmount, 'CAD') },
                            { key: 'purchases', icon: 'arrow-down-outline', label: 'Purchases', value: formatAmount(store?.poAmount, 'CAD') },
                            { key: 'till', icon: 'wallet-outline', label: 'Till', value: tillLabel },
                          ]
                          : focusTab === 'settings'
                            ? [
                                { key: 'phone', icon: 'call-outline', label: 'Phone', value: storeContact.phone || '—' },
                                { key: 'email', icon: 'mail-outline', label: 'Email', value: storeContact.email || '—' },
                                { key: 'addr', icon: 'location-outline', label: 'Address', value: storeContact.address || '—' },
                              ]
                            : []
    : [];
  const overviewStats = appStatsRows.length ? <OverviewStatsTable rows={appStatsRows} /> : null;
  const transactionsBody = useOverviewTxTable ? (
    <View style={styles.overviewListWrap}>
      <View style={styles.overviewListBox}>{mappedTxRows}</View>
    </View>
  ) : (
    mappedTxRows
  );
  const storeAppLabel =
    focusTab === 'overview'
      ? 'Overview'
      : SNAPSHOT_APPS[focusTab]?.label || '';
  const txListToolbar = useOverviewTxTable ? (
    <View style={styles.overviewListHead}>
      {focusTab === 'overview' ? (
        <Text style={styles.overviewListTitle}>Transactions</Text>
      ) : (
        <View />
      )}
      <View style={styles.overviewSearchField}>
        <Ionicons name="search-outline" size={17} color={MOBILE.secondary} />
        <TextInput
          style={styles.overviewSearchInput}
          value={txQuery}
          onChangeText={setTxQuery}
          placeholder="Search"
          placeholderTextColor={MOBILE.secondary}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          clearButtonMode="while-editing"
          accessibilityLabel="Search transactions"
        />
        {txQuery ? (
          <Pressable onPress={() => setTxQuery('')} hitSlop={8} accessibilityLabel="Clear search">
            <Ionicons name="close-circle" size={16} color="#c7c7cc" />
          </Pressable>
        ) : null}
      </View>
    </View>
  ) : null;
  const txFilterMenu = openTxFilter ? (
    <TxColumnFilterMenu
      label={openTxFilter.label}
      options={txColumnOptions[openTxFilter.key] || []}
      filter={txColumnFilters[openTxFilter.key] ?? null}
      onChange={(next) => {
        setTxColumnFilters((current) => ({
          ...current,
          [openTxFilter.key]: next,
        }));
      }}
      onClose={() => setOpenTxFilter(null)}
      anchor={openTxFilter.anchor}
      alignEnd={openTxFilter.end}
    />
  ) : null;
  const inventoryListToolbar = useOverviewInvTable ? (
    <View style={styles.overviewListHead}>
      <View />
      <View style={styles.overviewSearchCluster}>
        <View style={styles.overviewSearchField}>
          <Ionicons name="search-outline" size={17} color={MOBILE.secondary} />
          <TextInput
            style={styles.overviewSearchInput}
            value={inventoryQuery}
            onChangeText={setInventoryQuery}
            placeholder="Search"
            placeholderTextColor={MOBILE.secondary}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            clearButtonMode="while-editing"
            accessibilityLabel="Search inventory"
          />
          {inventoryQuery ? (
            <Pressable onPress={() => setInventoryQuery('')} hitSlop={8} accessibilityLabel="Clear search">
              <Ionicons name="close-circle" size={16} color="#c7c7cc" />
            </Pressable>
          ) : null}
        </View>
        <InventoryPriceRefresh
          compact
          loading={priceRefreshing}
          onPress={() => loadPrices({ force: true, silent: false })}
        />
      </View>
    </View>
  ) : null;
  const showDesktopStoreHead = !isMobile && !ticketOpen;
  const overviewHead = !showDesktopStoreHead ? null : selectedItem && useOverviewInvTable ? (
    <View style={styles.overviewHead}>
      {selectedItemHead}
      <View
        style={styles.overviewHeadRule}
        {...(Platform.OS === 'web' ? { className: 'cgold-home-row-rule' } : null)}
      />
      {inventoryListToolbar}
    </View>
  ) : (
    <View style={styles.overviewHead}>
      <View style={styles.overviewHeadRow}>
        <View style={styles.overviewTitleBlock}>
          <Text style={styles.overviewStoreName} numberOfLines={2}>
            {storeName}
          </Text>
          {focusTab === 'overview' ? (
            <View style={styles.overviewContactBlock}>
              <OverviewContactLine icon="location-outline">{storeContact.address}</OverviewContactLine>
              <OverviewContactLine icon="call-outline">{storeContact.phone}</OverviewContactLine>
              <OverviewContactLine icon="mail-outline">{storeContact.email}</OverviewContactLine>
            </View>
          ) : storeAppLabel ? (
            <Text style={styles.overviewStoreContact}>{storeAppLabel}</Text>
          ) : null}
        </View>
        {overviewStats}
      </View>
      <View
        style={styles.overviewHeadRule}
        {...(Platform.OS === 'web' ? { className: 'cgold-home-row-rule' } : null)}
      />
      {txListToolbar}
      {txFilterMenu}
      {inventoryListToolbar}
    </View>
  );

  const openSnapshot = useCallback(
    (key) => {
      if (!key) return;
      onOpenApp?.(key === focusTab ? 'overview' : key);
    },
    [focusTab, onOpenApp],
  );

  const listTab =
    embeddedApp || (focusTab && focusTab !== 'overview') ? focusTab : 'transactions';
  const listApp = SNAPSHOT_APPS[listTab] || SNAPSHOT_APPS.transactions;
  const listMeta =
    listTab === 'inventory'
      ? itemMeta
      : listTab === 'emails' && emailCapture
        ? String(emailCapture.customerCount || 0)
        : listTab === 'employees'
          ? String(presentEmployees.length)
          : listTab === 'phone'
            ? phoneRatio.rate == null
              ? String(phoneCalls.length)
              : phoneRatio.ratio
            : listTab === 'transactions'
            ? txMeta
            : '';
  const listTitle =
    listTab === 'transactions'
      ? heroFocus === 'sales'
        ? 'Sales'
        : heroFocus === 'purchases'
          ? 'Purchases'
          : listApp.label
      : listApp.label;
  const listBody = embeddedApp ? (
    <View style={styles.dashSheetApp}>{embeddedApp}</View>
  ) : listTab === 'inventory' ? (
    useOverviewInvTable ? (
      inventoryBody
    ) : (
      <>
        <InventorySearch
          value={inventoryQuery}
          onChangeText={setInventoryQuery}
          refreshing={priceRefreshing}
          onRefresh={() => loadPrices({ force: true, silent: false })}
        />
        {inventoryBody}
      </>
    )
  ) : listTab === 'financials' ? (
    financialsBody
  ) : listTab === 'employees' ? (
    employeesBody
  ) : listTab === 'emails' ? (
    <EmailsSnapshotBody
      storeName={storeName}
      txRows={txRows}
      periodLabel={periodLabel}
      ready={ready}
      full
      boxed={useDesktopAppTable}
    />
  ) : (
    transactionsBody
  );

  const ticketHeader = ticketOpen && isValidElement(transactionTicket)
    ? cloneElement(transactionTicket, { embedded: true, part: 'header' })
    : null;
  const ticketBody = ticketOpen && isValidElement(transactionTicket)
    ? cloneElement(transactionTicket, { embedded: true, part: 'body' })
    : null;

  const sheetFillHeight =
    stageHeight > 0
      ? Math.max(0, stageHeight - (isMobile ? (topInset > 0 ? topInset : 52) : 0))
      : undefined;

  const sheetLists = (
    <View
      style={[
        styles.storeHomeSheet,
        !isMobile && styles.storeHomeSheetDesktop,
        sheetFillHeight ? { minHeight: sheetFillHeight } : null,
      ]}
    >
      {ticketOpen ? (
        <View style={styles.dashSectionFill}>
          <View style={styles.dashSheetHandle}>
            <View style={styles.dashSheetGrabPill} />
            {ticketHeader}
          </View>
          {ticketBody}
          <View style={styles.dashTicketListHead}>
            <Text style={styles.dashHeadTitleCard}>Transactions</Text>
            {listMeta ? <Text style={styles.dashHeadMeta}>{listMeta}</Text> : null}
          </View>
          {transactionsBody}
        </View>
      ) : (
        <DashSection
          title={listTitle}
          meta={listMeta}
          fill
          hideHead={Boolean(selectedItem) || !isMobile || (listTab === 'phone' && Boolean(embeddedApp))}
        >
          {listBody}
        </DashSection>
      )}
    </View>
  );

  const mobileLists = sheetLists;

  const mobileContent = mobileLists;

  const showPinnedApps =
    isMobile &&
    (showFinancials || showPhone || showEmails || showInventory || desktopApps.length > 0);
  const pinnedAppRow = showPinnedApps ? (
      <View style={[styles.dashPinnedApps, isMobile && styles.dashPinnedAppsMobile, !isMobile && styles.deskPinnedApps]}>
        {showFinancials ? (
          <DashPinnedApp
            app={SNAPSHOT_APPS.financials}
            value={cashLoading && !cash ? '…' : cash ? formatAmount(cadAmt, 'CAD') : '—'}
            onOpen={openSnapshot}
            selected={listTab === 'financials'}
            roomy={isMobile}
          />
        ) : null}
        {showPhone ? (
          <DashPinnedApp
            app={SNAPSHOT_APPS.phone}
            value={phoneRatio.rate == null ? '—' : phoneRatio.ratio}
            onOpen={openSnapshot}
            selected={listTab === 'phone'}
            compact={!isMobile}
            roomy={isMobile}
          />
        ) : null}
        {showEmails ? (
          <DashPinnedApp
            app={SNAPSHOT_APPS.emails}
            value={
              !emailCapture || emailCapture.customerCount === 0
                ? '—'
                : `${Math.round(emailCapture.rate)}%`
            }
            onOpen={openSnapshot}
            selected={listTab === 'emails'}
            compact={!isMobile}
            roomy={isMobile}
          />
        ) : null}
        {showInventory ? (
          <DashPinnedApp
            app={SNAPSHOT_APPS.inventory}
            value="Search"
            onOpen={openSnapshot}
            selected={listTab === 'inventory'}
            compact={!isMobile}
            roomy={isMobile}
          />
        ) : null}
        {!isMobile && desktopApps.length ? (
          <View style={styles.deskAppsWrap}>
            <Pressable
              onPress={() => onAppsOpenChange?.(!appsOpen)}
              style={({ hovered, pressed }) => [
                styles.deskAppsButton,
                (appsOpen || hovered || pressed) && styles.deskAppsButtonActive,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Store apps"
              accessibilityState={{ expanded: appsOpen }}
            >
              <Ionicons name="apps" size={20} color={appsOpen ? LABEL : '#6B5E3A'} />
            </Pressable>
            {appsOpen ? (
              <View style={styles.deskAppsMenu}>
                <ScrollView
                  style={styles.deskAppsMenuScroll}
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={false}
                >
                  {desktopApps.map((tool) => {
                    const selected = tool.key === focusTab;
                    return (
                      <Pressable
                        key={tool.key}
                        onPress={() => {
                          onOpenApp?.(tool.key);
                          onAppsOpenChange?.(false);
                        }}
                        style={({ hovered, pressed }) => [
                          styles.deskAppsMenuRow,
                          selected && styles.deskAppsMenuRowSelected,
                          (hovered || pressed) && styles.deskAppsMenuRowPressed,
                        ]}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                        accessibilityLabel={tool.label}
                      >
                        <View style={[styles.deskAppsMenuIcon, { backgroundColor: tool.accent || '#1d1d1f' }]}>
                          <Ionicons name={filledIonicon(tool.icon)} size={15} color="#fff" />
                        </View>
                        <Text
                          style={[styles.deskAppsMenuLabel, selected && styles.deskAppsMenuLabelSelected]}
                          numberOfLines={1}
                        >
                          {tool.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </View>
            ) : null}
          </View>
        ) : null}
      </View>
    ) : null;

  if (!isMobile) {
    return (
      <View style={[styles.body, styles.bodyDesktopHome]}>
        {appsOpen ? (
          <Pressable
            style={styles.deskAppsBackdrop}
            onPress={() => onAppsOpenChange?.(false)}
            accessibilityLabel="Close apps"
          />
        ) : null}
        <View
          style={styles.storeHomeStage}
          onLayout={(event) => {
            const height = event.nativeEvent.layout.height;
            setStageHeight((current) => (Math.abs(current - height) < 0.5 ? current : height));
          }}
        >
          <ScrollView
            ref={pageScrollRef}
            style={styles.scroll}
            contentContainerStyle={[
              styles.storeHomeScrollContent,
              topInset > 0 ? { paddingTop: topInset } : null,
              stageHeight > 0 ? { minHeight: stageHeight } : null,
            ]}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            bounces={false}
            overScrollMode="never"
            scrollEventThrottle={16}
            {...tabBarScroll}
            {...(Platform.OS === 'web' ? { className: 'cgold-home-overlay-scroll' } : null)}
          >
            <View style={styles.storeHomeSheetPadDesktop}>
              {desktopHeader}
              {overviewHead}
              {sheetLists}
            </View>
          </ScrollView>
        </View>
        <TxnCashBreakdownModal
          visible={Boolean(cashSlips.editorRow)}
          session={session}
          row={cashSlips.editorRow}
          initialSheet={cashSlips.editorSheet}
          onClose={cashSlips.closeEditor}
          onSaved={cashSlips.onSaved}
        />
        <PriceCheckModal check={priceReview} onClose={() => setPriceReview(null)} />
      </View>
    );
  }

  return (
    <View
      style={[styles.body, styles.bodyMobile]}
      onLayout={(event) => {
        const height = event.nativeEvent.layout.height;
        setStageHeight((current) => (Math.abs(current - height) < 0.5 ? current : height));
      }}
    >
      <ScrollView
        ref={pageScrollRef}
        style={styles.scroll}
        {...(Platform.OS === 'web' ? { className: 'cgold-home-overlay-scroll' } : null)}
        contentContainerStyle={[
          styles.storeHomeScrollContent,
          {
            paddingTop: topInset > 0 ? topInset : 52,
            paddingBottom: mobileTabBarReserve() + 16,
          },
          stageHeight > 0 ? { minHeight: stageHeight } : null,
        ]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        bounces={false}
        overScrollMode="never"
        scrollEventThrottle={16}
        {...tabBarScroll}
      >
        {pinnedAppRow}
        {mobileContent}
      </ScrollView>
      <TxnCashBreakdownModal
        visible={Boolean(cashSlips.editorRow)}
        session={session}
        row={cashSlips.editorRow}
        initialSheet={cashSlips.editorSheet}
        onClose={cashSlips.closeEditor}
        onSaved={cashSlips.onSaved}
      />
      <PriceCheckModal check={priceReview} onClose={() => setPriceReview(null)} />
    </View>
  );
}

// The home screen hands us a fresh `store` object on every live refresh; only
// its name matters here, so compare that instead of the object identity.
export { TransactionRow as StoreTransactionRow, OverviewHero };

export default memo(
  StoreSnapshotPanel,
  (prev, next) =>
    prev.session === next.session &&
    (prev.store?.store || '') === (next.store?.store || '') &&
    prev.store?.totalAmount === next.store?.totalAmount &&
    prev.store?.txCount === next.store?.txCount &&
    prev.store?.soAmount === next.store?.soAmount &&
    prev.store?.poAmount === next.store?.poAmount &&
    prev.store?.saleCount === next.store?.saleCount &&
    prev.store?.purchaseCount === next.store?.purchaseCount &&
    prev.periodLabel === next.periodLabel &&
    prev.startKey === next.startKey &&
    prev.endKey === next.endKey &&
    prev.txRows === next.txRows &&
    prev.onOpenTransaction === next.onOpenTransaction &&
    prev.onOpenApp === next.onOpenApp &&
    prev.onAmountHover === next.onAmountHover &&
    prev.onFilterTop === next.onFilterTop &&
    prev.filterSlotWidth === next.filterSlotWidth &&
    prev.topInset === next.topInset &&
    prev.ready === next.ready &&
    prev.desktopHeader === next.desktopHeader &&
    prev.dateHero === next.dateHero &&
    prev.heroFocus === next.heroFocus &&
    prev.focusTab === next.focusTab &&
    prev.desktopApps === next.desktopApps &&
    prev.appsOpen === next.appsOpen &&
    prev.onAppsOpenChange === next.onAppsOpenChange &&
    prev.embeddedApp === next.embeddedApp &&
    prev.transactionTicket === next.transactionTicket &&
    prev.onSelectedItemChange === next.onSelectedItemChange &&
    prev.inventoryCloseRef === next.inventoryCloseRef,
);

const styles = StyleSheet.create({
  body: {
    flex: 1,
    minHeight: 0,
    backgroundColor: CANVAS,
    paddingHorizontal: 24,
  },
  bodyMobile: {
    paddingHorizontal: 0,
    backgroundColor: CANVAS,
  },
  bodyDesktopHome: {
    flex: 1,
    minHeight: 0,
    paddingHorizontal: 0,
    paddingTop: 0,
    paddingBottom: 0,
    backgroundColor: CANVAS,
  },
  storeHomeStage: {
    flex: 1,
    minHeight: 0,
    position: 'relative',
  },
  storeHomeScrollContent: {
    flexGrow: 1,
    backgroundColor: 'transparent',
  },
  storeHomeHeroPadMobile: {
    paddingHorizontal: MOBILE_FILTER_INSET,
  },
  storeHomeHeroPadDesktop: {
    paddingLeft: 32,
    paddingRight: 24,
  },
  storeHomeSheetPadDesktop: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  storeHomePinnedTop: {
    paddingTop: 4,
    paddingBottom: 16,
    backgroundColor: 'transparent',
  },
  storeHomePinnedTopDesktop: {
    paddingTop: 0,
    paddingBottom: 40,
  },
  storeHomeHeroShell: {
    alignSelf: 'stretch',
    alignItems: 'stretch',
    width: '100%',
  },
  storeHomeHeroSplit: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    alignSelf: 'stretch',
    width: '100%',
    gap: 24,
    rowGap: 22,
  },
  storeHomeHeroSplitMobile: {
    gap: 16,
    rowGap: 16,
  },
  storeHomeHeroFigures: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'flex-end',
    marginLeft: 'auto',
    flexShrink: 0,
    gap: 36,
  },
  storeHomeHeroFiguresMobile: {
    marginLeft: 0,
    width: '100%',
    justifyContent: 'space-between',
    gap: 16,
    flexWrap: 'wrap',
  },
  storeHomeHeroPair: {
    flexDirection: 'row',
    alignItems: 'stretch',
    flexShrink: 0,
    gap: 6,
  },
  storeHomeHeroPairMobile: {
    width: '100%',
    justifyContent: 'space-between',
  },
  storeHomeHeroMetricStack: {
    alignItems: 'flex-end',
    gap: 2,
    alignSelf: 'flex-start',
  },
  storeHomeHeroBlockTitle: {
    fontFamily,
    fontSize: 10,
    fontWeight: '400',
    color: '#aeaeb2',
    letterSpacing: 0.02,
    textAlign: 'right',
  },
  storeHomeHeroWithIconCol: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    alignSelf: 'stretch',
  },
  storeHomeHeroWithIconColMobile: {
    gap: 0,
    alignItems: 'flex-start',
  },
  storeHomeHeroIconCol: {
    marginLeft: HOME_STORE_ROW_PAD,
    width: HOME_STORE_ICON_COL_WIDTH,
    alignItems: 'center',
    justifyContent: 'flex-start',
    flexShrink: 0,
    paddingTop: 1,
  },
  storeHomeHeroIconColMobile: {
    marginLeft: 0,
    width: HOME_STORE_ICON_COL_WIDTH,
    paddingTop: 0,
  },
  storeHomeHeroIconWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  storeHomeHeroIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  storeHomeHeroContentCol: {
    flex: 1,
    minWidth: 0,
    marginLeft: HOME_STORE_BODY_LEADING,
  },
  storeHomeHeroContentColMobile: {
    marginLeft: HOME_STORE_BODY_LEADING,
  },
  storeHomeHeroInset: {
    alignSelf: 'stretch',
    gap: 12,
    paddingHorizontal: 0,
    paddingTop: 0,
    paddingBottom: 4,
    backgroundColor: 'transparent',
  },
  storeHomeHeroInsetDesktop: {
    gap: 10,
    paddingBottom: 0,
  },
  storeHomeHeroPrimary: {
    alignSelf: 'stretch',
  },
  storeHomeHeroMetricBlock: {
    flexDirection: 'row',
    alignItems: 'stretch',
    alignSelf: 'flex-start',
    gap: 14,
    overflow: 'visible',
  },
  storeHomeHeroMetricBlockDesktop: {
    gap: 18,
  },
  storeHomeHeroMetricBlockMobile: {
    alignSelf: 'stretch',
    width: '100%',
    justifyContent: 'space-between',
  },
  storeHomeHeroMetricMain: {
    flexShrink: 0,
    alignSelf: 'flex-start',
  },
  storeHomeHeroMetricMainMobile: {
    flex: 1,
    minWidth: 0,
  },
  storeHomeHeroAmountRow: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'baseline',
    flexWrap: 'nowrap',
    gap: 10,
    overflow: 'visible',
  },
  storeHomeHeroAmountRowMobile: {
    flex: 1,
    minWidth: 0,
  },
  storeHomeHeroAmount: {
    flexShrink: 0,
    fontFamily: titleFontFamily,
    fontSize: 22,
    lineHeight: 26,
    fontWeight: '400',
    color: '#1d1d1f',
    letterSpacing: -0.4,
    fontVariant: ['tabular-nums'],
    textAlign: 'right',
    alignSelf: 'flex-end',
  },
  storeHomeHeroAmountDesktop: {
    alignSelf: 'flex-end',
    fontSize: 22,
    lineHeight: 26,
  },
  storeHomeHeroAmountLow: {
    color: '#B91C1C',
  },
  storeHomeHeroAmountOk: {
    color: '#15803D',
  },
  storeHomeHeroAmountEmpty: {
    color: '#aeaeb2',
  },
  storeHomeHeroAmountMobile: {
    flexShrink: 1,
    minWidth: 0,
    maxWidth: '100%',
  },
  storeHomeHeroStats: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    alignSelf: 'stretch',
    gap: 20,
    backgroundColor: 'transparent',
  },
  storeHomeHeroStatsSide: {
    flexDirection: 'column',
    flexGrow: 0,
    flexShrink: 0,
    alignSelf: 'stretch',
    justifyContent: 'flex-start',
    gap: 4,
    minWidth: 108,
    maxWidth: 132,
    paddingTop: 2,
    paddingLeft: 10,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: 'rgba(42,38,30,0.08)',
  },
  storeHomeHeroStatsSideDesktop: {
    minWidth: 156,
    maxWidth: 220,
    paddingTop: 0,
    paddingLeft: 10,
  },
  storeHomeHeroStat: {
    flex: 1,
    minWidth: 0,
    gap: 3,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  storeHomeHeroStatSelected: {},
  storeHomeHeroStatPressed: {
    opacity: 0.72,
  },
  storeHomeHeroStatValue: {
    fontFamily,
    fontSize: 17,
    fontWeight: '500',
    color: '#aeaeb2',
    letterSpacing: -0.35,
    fontVariant: ['tabular-nums'],
  },
  storeHomeHeroStatValueSelected: {
    color: '#1d1d1f',
    fontWeight: '600',
  },
  storeHomeHeroStatLabel: {
    fontFamily,
    fontSize: 11,
    fontWeight: '500',
    color: '#aeaeb2',
    letterSpacing: 0.02,
  },
  storeHomeHeroStatLabelSelected: {
    color: '#1d1d1f',
    fontWeight: '600',
  },
  storeHomeHeroStatMarkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
    gap: 4,
  },
  storeHomeHeroStatCompact: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 8,
    paddingVertical: 2,
    borderRadius: 6,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  storeHomeHeroStatCompactSelected: {},
  storeHomeHeroStatLabelCompact: {
    flex: 1,
    minWidth: 0,
    fontFamily,
    fontSize: 10,
    fontWeight: '500',
    color: '#aeaeb2',
    letterSpacing: 0.02,
  },
  storeHomeHeroStatLabelCompactSelected: {
    color: '#1d1d1f',
    fontWeight: '600',
  },
  storeHomeHeroStatValueCompact: {
    fontFamily,
    fontSize: 13,
    fontWeight: '500',
    color: '#aeaeb2',
    letterSpacing: -0.2,
    fontVariant: ['tabular-nums'],
    textAlign: 'right',
    flexShrink: 0,
  },
  storeHomeHeroStatValueCompactSelected: {
    color: '#1d1d1f',
    fontWeight: '600',
  },
  storeHomeHeroStatLow: {
    color: '#B91C1C',
    fontWeight: '600',
  },
  storeHomeHeroStatOk: {
    color: '#15803D',
  },
  overviewHead: {
    marginBottom: 8,
    paddingTop: 20,
    paddingHorizontal: 48,
  },
  overviewTxTabHead: {
    marginBottom: 8,
    paddingTop: 20,
    paddingHorizontal: 48,
  },
  overviewHeadRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 24,
    paddingBottom: 32,
  },
  overviewTitleBlock: {
    flex: 1,
    minWidth: 0,
    paddingTop: 4,
    gap: 10,
  },
  overviewStoreName: {
    fontFamily: titleFontFamily,
    fontSize: 22,
    lineHeight: 26,
    fontWeight: '300',
    color: MOBILE.label,
    letterSpacing: -0.3,
    textAlign: 'left',
  },
  overviewContactBlock: {
    gap: 6,
  },
  overviewContactLine: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    maxWidth: 420,
  },
  overviewStoreContact: {
    flex: 1,
    minWidth: 0,
    fontFamily,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '400',
    color: SECONDARY,
    letterSpacing: -0.15,
  },
  overviewHeadRule: {
    alignSelf: 'stretch',
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(42,38,30,0.16)',
    marginTop: 4,
    marginBottom: 4,
  },
  overviewListHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    paddingTop: 32,
    paddingBottom: 8,
  },
  overviewListTitle: {
    flexShrink: 0,
    fontFamily: titleFontFamily,
    fontSize: 16,
    fontWeight: '300',
    color: MOBILE.label,
    letterSpacing: -0.2,
  },
  overviewSearchCluster: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
  },
  overviewSearchField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 32,
    minHeight: 32,
    width: 300,
    maxWidth: 340,
    paddingHorizontal: 10,
    borderRadius: NAV_TAB_ACTIVE_RADIUS,
    borderWidth: 1,
    borderColor: TAB_BORDER,
    backgroundColor: CANVAS,
    ...CHIP_SHADOW,
  },
  overviewSearchInput: {
    flex: 1,
    minWidth: 0,
    height: 30,
    fontFamily,
    fontSize: 14,
    fontWeight: '400',
    color: MOBILE.label,
    paddingVertical: 0,
    letterSpacing: -0.2,
    ...Platform.select({
      web: { outlineStyle: 'none' },
      default: {},
    }),
  },
  overviewListWrap: {
    paddingHorizontal: 48,
  },
  overviewListBox: {
    borderRadius: NAV_TAB_ACTIVE_RADIUS,
    borderWidth: 1,
    borderColor: TAB_BORDER,
    backgroundColor: CANVAS,
    overflow: 'hidden',
    ...CHIP_SHADOW,
  },
  overviewTxRow: {
    position: 'relative',
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 46,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(42,38,30,0.08)',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  overviewTxHeader: {
    minHeight: 34,
    ...Platform.select({
      web: { cursor: 'default' },
      default: {},
    }),
  },
  overviewTxRowLast: {
    borderBottomWidth: 0,
  },
  inventoryTxRow: {
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  itemBody: {
    paddingBottom: 24,
  },
  itemHeadMobileWrap: {
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  itemHeadRowMobile: {
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 16,
    paddingBottom: 8,
  },
  itemKicker: {
    alignSelf: 'flex-start',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  itemKickerText: {
    fontFamily,
    fontSize: 12,
    fontWeight: '500',
    color: SECONDARY,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  itemStatsPair: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    flexShrink: 0,
  },
  itemStatsPairMobile: {
    flexDirection: 'column',
    alignItems: 'stretch',
  },
  itemStatsBox: {
    width: 272,
  },
  itemStatsBoxMobile: {
    width: '100%',
  },
  itemStatsRow: {
    alignItems: 'flex-start',
    ...Platform.select({
      web: { cursor: 'default' },
      default: {},
    }),
  },
  itemStatsLead: {
    flex: 1,
    alignItems: 'flex-start',
    paddingTop: 1,
  },
  itemStatsLabel: {
    flexShrink: 1,
  },
  itemStatsTrail: {
    flexShrink: 1,
    maxWidth: '62%',
    alignItems: 'flex-end',
  },
  itemStatsSub: {
    fontFamily,
    fontSize: 11,
    lineHeight: 14,
    color: SECONDARY,
    letterSpacing: -0.1,
    fontVariant: ['tabular-nums'],
    textAlign: 'right',
  },
  itemStaticRow: {
    ...Platform.select({
      web: { cursor: 'default' },
      default: {},
    }),
  },
  itemStoreList: {
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#fff',
  },
  itemStoreHere: {
    fontWeight: '600',
  },
  itemListHeadMobile: {
    paddingHorizontal: 16,
    paddingTop: 20,
  },
  itemListMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  itemListMeta: {
    fontFamily,
    fontSize: 13,
    color: SECONDARY,
    fontVariant: ['tabular-nums'],
  },
  appColMain: {
    flex: 1.6,
    minWidth: 120,
    flexShrink: 1,
  },
  appColWide: {
    flex: 1.8,
    minWidth: 140,
    flexShrink: 1,
  },
  appColMid: {
    flex: 1,
    minWidth: 88,
    flexShrink: 1,
  },
  appColEnd: {
    width: 96,
    flexShrink: 0,
    textAlign: 'right',
  },
  invColItem: {
    flex: 1.6,
    minWidth: 140,
    flexShrink: 1,
  },
  invColBuy: {
    width: 122,
    flexShrink: 0,
  },
  invColSell: {
    width: 122,
    flexShrink: 0,
  },
  invColQty: {
    width: 64,
    flexShrink: 0,
    textAlign: 'right',
  },
  invColPreorder: {
    width: 80,
    flexShrink: 0,
    textAlign: 'right',
  },
  invPreorderOver: {
    color: GREEN,
    fontWeight: '600',
  },
  invMobilePreorder: {
    marginRight: 4,
  },
  overviewTxFilterCell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
    paddingRight: 2,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  overviewTxFilterLabel: {
    flexShrink: 0,
  },
  overviewTxFilterCellEnd: {
    justifyContent: 'flex-end',
  },
  overviewTxFilterCellHover: {
    opacity: 0.72,
  },
  overviewTxFilterLabelActive: {
    color: MOBILE.label,
    fontWeight: '600',
  },
  txFilterModalRoot: {
    flex: 1,
  },
  txFilterBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'transparent',
  },
  txFilterMenu: {
    position: 'absolute',
    width: TX_FILTER_MENU_WIDTH,
    maxHeight: TX_FILTER_MENU_MAX_HEIGHT,
    backgroundColor: CANVAS,
    borderRadius: NAV_TAB_ACTIVE_RADIUS,
    borderWidth: 1,
    borderColor: TAB_BORDER,
    overflow: 'hidden',
    zIndex: 40,
    ...CHIP_SHADOW,
    ...Platform.select({
      web: { boxShadow: '0 8px 24px rgba(0,0,0,0.12)' },
      default: { elevation: 8 },
    }),
  },
  txFilterField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    margin: 8,
    height: 28,
    paddingHorizontal: 8,
    borderRadius: NAV_TAB_ACTIVE_RADIUS,
    borderWidth: 1,
    borderColor: TAB_BORDER,
    backgroundColor: CANVAS,
  },
  txFilterFieldInput: {
    flex: 1,
    minWidth: 0,
    height: 26,
    fontFamily,
    fontSize: 13,
    color: '#1d1d1f',
    paddingVertical: 0,
    ...Platform.select({
      web: { outlineStyle: 'none' },
      default: {},
    }),
  },
  txFilterActions: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingBottom: 6,
    gap: 6,
  },
  txFilterActionText: {
    fontFamily,
    fontSize: 12,
    fontWeight: '500',
    color: '#1d1d1f',
  },
  txFilterActionDisabled: {
    color: '#c0c0c0',
  },
  txFilterActionSep: {
    fontFamily,
    fontSize: 11,
    color: '#d0d0d0',
  },
  txFilterList: {
    maxHeight: 196,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(42,38,30,0.08)',
  },
  txFilterOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    minHeight: 28,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  txFilterOptionText: {
    fontFamily,
    fontSize: 13,
    color: '#1d1d1f',
    letterSpacing: -0.2,
    flex: 1,
  },
  txFilterEmpty: {
    fontFamily,
    fontSize: 12,
    color: '#8a8a8a',
    textAlign: 'center',
    paddingVertical: 16,
  },
  overviewStatsBox: {
    width: 248,
    flexShrink: 0,
    borderRadius: NAV_TAB_ACTIVE_RADIUS,
    borderWidth: 1,
    borderColor: TAB_BORDER,
    backgroundColor: CANVAS,
    overflow: 'hidden',
    ...CHIP_SHADOW,
  },
  overviewStatsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    minHeight: 32,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(42,38,30,0.08)',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  overviewStatsRowLast: {
    borderBottomWidth: 0,
  },
  overviewStatsRowHover: {
    backgroundColor: '#f5f5f5',
  },
  overviewStatsLead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minWidth: 0,
    flexShrink: 1,
  },
  overviewStatsLabel: {
    fontFamily,
    fontSize: 14,
    fontWeight: '400',
    color: SECONDARY,
    letterSpacing: -0.2,
  },
  overviewStatsValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
    gap: 2,
  },
  overviewStatsValue: {
    fontFamily,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '400',
    color: MOBILE.label,
    letterSpacing: -0.2,
    fontVariant: ['tabular-nums'],
    textAlign: 'right',
  },
  storeHomeSheet: {
    backgroundColor: 'transparent',
    borderRadius: 0,
    overflow: 'hidden',
    marginTop: 8,
    width: '100%',
    alignSelf: 'stretch',
  },
  storeHomeSheetDesktop: {
    marginTop: 0,
    borderRadius: 0,
    paddingBottom: 24,
  },
  deskChromeRow: {
    zIndex: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    minHeight: 44,
    gap: 16,
    paddingHorizontal: 76,
    paddingTop: 10,
    paddingBottom: 12,
    backgroundColor: 'transparent',
  },
  deskChromeStore: {
    flex: 1,
    minWidth: 0,
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: '#6B5E3A',
    letterSpacing: 0.2,
  },
  deskChromePeriod: {
    flexShrink: 0,
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: '#6B5E3A',
    letterSpacing: 0.2,
    opacity: 0.78,
  },
  dashHeroCardWide: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 36,
    paddingHorizontal: 28,
    paddingVertical: 24,
  },
  dashHeroAmountWide: {
    flex: 1.1,
    fontSize: 52,
    lineHeight: 56,
  },
  dashHeroStatsWide: {
    flex: 1,
    marginTop: 0,
    paddingVertical: 14,
    paddingHorizontal: 12,
  },
  storeTxHeaderRow: {
    minHeight: 34,
    maxHeight: undefined,
    height: undefined,
    paddingVertical: 6,
    backgroundColor: CANVAS,
    ...Platform.select({
      web: { cursor: 'default' },
      default: {},
    }),
  },
  storeTxHeader: {
    fontFamily,
    fontSize: 13,
    fontWeight: '500',
    color: MOBILE.secondary,
    letterSpacing: -0.15,
  },
  storeTxHeaderEnd: {
    textAlign: 'right',
  },
  storeTxHeaderRule: {
    backgroundColor: 'rgba(42,38,30,0.16)',
  },
  storeTxRow: {
    position: 'relative',
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 46,
    paddingVertical: 6,
    paddingLeft: 0,
    overflow: 'visible',
    backgroundColor: 'transparent',
    ...Platform.select({
      web: {
        cursor: 'pointer',
        transitionProperty: 'background-color',
        transitionDuration: '120ms',
        transitionTimingFunction: 'ease',
      },
      default: {},
    }),
  },
  storeTxRowHit: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: -6,
    right: 0,
    borderRadius: NAV_TAB_ACTIVE_RADIUS,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  storeTxRowHovered: {
    borderColor: '#d0d0d0',
    backgroundColor: 'rgba(60, 60, 67, 0.045)',
  },
  storeTxRowHoveredNative: {
    marginLeft: -6,
    marginRight: 8,
    borderRadius: NAV_TAB_ACTIVE_RADIUS,
    backgroundColor: 'rgba(60, 60, 67, 0.045)',
    borderWidth: 1,
    borderColor: '#d0d0d0',
  },
  storeTxRowForeground: {
    flex: 1,
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    zIndex: 1,
  },
  storeTxRowBody: {
    flex: 1,
    minWidth: 0,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 20,
    marginLeft: 10,
    paddingRight: 28,
  },
  storeTxRowRule: {
    position: 'absolute',
    left: 32,
    right: 10,
    bottom: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(42,38,30,0.08)',
  },
  storeTxRowRuleLast: {
    opacity: 0,
  },
  storeTxColPhoto: {
    width: 48,
    flexShrink: 0,
    alignItems: 'flex-start',
    justifyContent: 'center',
    zIndex: 2,
    ...Platform.select({ web: { pointerEvents: 'auto' }, default: {} }),
  },
  storeTxPhotoEmpty: {
    width: 30,
    height: 30,
    borderRadius: 7,
    backgroundColor: 'rgba(42,38,30,0.06)',
  },
  storeTxColCustomer: {
    flex: 1.2,
    minWidth: 108,
    flexShrink: 1,
  },
  storeTxColKind: {
    width: 78,
    flexShrink: 0,
  },
  storeTxColNumber: {
    width: 88,
    flexShrink: 0,
  },
  storeTxColTime: {
    width: 72,
    flexShrink: 0,
  },
  storeTxColEmployee: {
    width: 128,
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 8,
  },
  storeTxColItem: {
    flex: 1,
    minWidth: 72,
  },
  storeTxColAmount: {
    width: 96,
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 6,
    zIndex: 2,
    ...Platform.select({ web: { pointerEvents: 'auto' }, default: {} }),
  },
  storeTxChevron: {
    position: 'absolute',
    right: 2,
    top: 0,
    bottom: 0,
    width: 22,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 3,
  },
  storeTxName: {
    fontFamily: titleFontFamily,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '400',
    color: MOBILE.label,
    letterSpacing: -0.2,
  },
  storeTxMeta: {
    fontFamily,
    fontSize: 13,
    lineHeight: 16,
    color: MOBILE.secondary,
    letterSpacing: -0.1,
  },
  storeTxAmount: {
    fontFamily: titleFontFamily,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '300',
    color: MOBILE.label,
    letterSpacing: -0.2,
    fontVariant: ['tabular-nums'],
    textAlign: 'left',
  },
  desktopTxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 20,
    minHeight: 76,
    paddingLeft: 32,
    paddingRight: 32,
    paddingVertical: 16,
    backgroundColor: CANVAS,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(60,60,67,0.14)',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  desktopTxThumb: {
    width: 48,
    height: 48,
    flexShrink: 0,
  },
  desktopTxKind: {
    width: 48,
    height: 48,
    borderRadius: 12,
  },
  desktopTxLead: {
    flex: 1.4,
    minWidth: 160,
    gap: 3,
  },
  desktopTxMid: {
    flex: 1,
    minWidth: 140,
    gap: 3,
  },
  desktopTxEmployee: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minWidth: 0,
  },
  desktopTxTrail: {
    minWidth: 168,
    maxWidth: 280,
    alignItems: 'flex-end',
    gap: 3,
    flexShrink: 0,
  },
  desktopTxCustomer: {
    fontFamily,
    fontSize: 16,
    fontWeight: '600',
    color: LABEL,
    letterSpacing: -0.28,
  },
  desktopTxMeta: {
    fontFamily,
    fontSize: 13,
    color: SECONDARY,
    letterSpacing: -0.06,
  },
  desktopTxAmountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 6,
  },
  desktopTxAmount: {
    fontFamily,
    fontSize: 16,
    fontWeight: '600',
    color: LABEL,
    letterSpacing: -0.28,
    fontVariant: ['tabular-nums'],
    textAlign: 'right',
  },
  desktopTxItems: {
    fontFamily,
    fontSize: 13,
    color: SECONDARY,
    letterSpacing: -0.06,
    textAlign: 'right',
  },
  dashPinnedTitleLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 5,
    paddingHorizontal: MOBILE_FILTER_INSET,
    paddingTop: 6,
    backgroundColor: 'transparent',
  },
  dashPinnedTitleBlock: {
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    marginBottom: 18,
    paddingHorizontal: MOBILE_FILTER_INSET,
    overflow: 'hidden',
  },
  dashPinnedTitle: {
    maxWidth: '100%',
    textAlign: 'center',
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: LABEL,
    letterSpacing: -0.2,
  },
  dashPinnedDate: {
    marginTop: 2,
    textAlign: 'center',
    fontFamily,
    fontSize: 12,
    fontWeight: '500',
    color: SECONDARY,
    letterSpacing: 0,
  },
  dashPinnedHours: {
    marginTop: 2,
    textAlign: 'center',
    fontFamily,
    fontSize: 12,
    fontWeight: '500',
    color: SECONDARY,
    letterSpacing: 0,
  },
  dashHeroCard: {
    alignSelf: 'stretch',
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 14,
    borderRadius: 20,
    backgroundColor: '#1F1E1B',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(212,175,55,0.22)',
    ...Platform.select({
      web: {
        boxShadow: 'inset 0 1px 0 rgba(255,236,180,0.12), inset 0 -1px 0 rgba(0,0,0,0.35)',
      },
      default: {},
    }),
  },
  dashHeroAmountChrome: {
    fontFamily: 'SohneLeicht',
    fontSize: 38,
    lineHeight: 44,
    fontWeight: '400',
    color: '#F6F1E6',
    letterSpacing: -1.1,
    fontVariant: ['tabular-nums'],
  },
  dashHeroAmountChromeEmpty: {
    color: 'rgba(246,241,230,0.45)',
  },
  dashHeroStatsChrome: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 16,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.28)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(212,175,55,0.14)',
    ...Platform.select({
      web: {
        boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.35)',
      },
      default: {},
    }),
  },
  dashHeroStatDividerChrome: {
    width: StyleSheet.hairlineWidth,
    height: 26,
    marginHorizontal: 10,
    backgroundColor: 'rgba(244,228,180,0.16)',
  },
  dashHeroStatValueChrome: {
    color: '#F6F1E6',
  },
  dashHeroStatLabelChrome: {
    fontWeight: '500',
    color: '#C4A35A',
    letterSpacing: 0.2,
  },
  dashPinnedApps: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 8,
    marginTop: 12,
  },
  dashPinnedAppsMobile: {
    flexWrap: 'wrap',
    alignItems: 'stretch',
    gap: 12,
    marginTop: 16,
  },
  deskPinnedApps: {
    marginTop: 14,
    gap: 10,
    zIndex: 4,
  },
  deskAppsWrap: {
    position: 'relative',
    flexShrink: 0,
    alignSelf: 'stretch',
    zIndex: 5,
  },
  deskAppsButton: {
    width: 52,
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.72)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(42,38,30,0.08)',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  deskAppsButtonActive: {
    backgroundColor: '#fff',
    borderColor: 'rgba(42,38,30,0.16)',
  },
  deskAppsBackdrop: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 14,
  },
  deskAppsMenu: {
    position: 'absolute',
    top: '100%',
    right: 0,
    marginTop: 8,
    width: 260,
    maxWidth: 320,
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(60,60,67,0.16)',
    zIndex: 20,
    ...Platform.select({
      web: { boxShadow: '0 10px 32px rgba(0,0,0,0.16)' },
      default: {
        shadowColor: '#000',
        shadowOpacity: 0.16,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 8 },
        elevation: 8,
      },
    }),
  },
  deskAppsMenuScroll: {
    maxHeight: 420,
  },
  deskAppsMenuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 44,
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderRadius: 10,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  deskAppsMenuRowSelected: {
    backgroundColor: 'rgba(0,122,255,0.08)',
  },
  deskAppsMenuRowPressed: {
    backgroundColor: 'rgba(60,60,67,0.08)',
  },
  deskAppsMenuIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  deskAppsMenuLabel: {
    flex: 1,
    minWidth: 0,
    fontFamily,
    fontSize: 15,
    fontWeight: '500',
    color: '#1a1a1a',
  },
  deskAppsMenuLabelSelected: {
    fontWeight: '600',
  },
  dashPinnedApp: {
    flex: 1.45,
    minWidth: 0,
    overflow: 'hidden',
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 6,
    backgroundColor: CANVAS,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(42,38,30,0.08)',
    gap: 6,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  dashPinnedAppSelected: {
    backgroundColor: '#e5e5ea',
    borderColor: 'transparent',
  },
  dashPinnedAppPressed: {
    backgroundColor: '#f5f5f5',
  },
  dashPinnedAppCompact: {
    flex: 0.72,
    paddingHorizontal: 8,
  },
  dashPinnedAppRoomy: {
    flexGrow: 1,
    flexBasis: '46%',
    minWidth: 0,
    paddingVertical: 14,
    paddingHorizontal: 14,
  },
  dashPinnedAppHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minWidth: 0,
  },
  dashPinnedAppIcon: {
    width: 22,
    height: 22,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  dashPinnedAppLabel: {
    flex: 1,
    minWidth: 0,
    fontFamily,
    fontSize: 11,
    fontWeight: '500',
    color: SECONDARY,
    letterSpacing: 0,
  },
  dashPinnedAppValue: {
    minWidth: 0,
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: '#1C1B18',
    letterSpacing: -0.3,
    fontVariant: ['tabular-nums'],
  },
  dashHero: {
    alignSelf: 'stretch',
    paddingTop: 8,
    paddingBottom: 14,
    paddingHorizontal: 16,
    backgroundColor: '#fff',
  },
  dashHeroLabel: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: SECONDARY,
    letterSpacing: -0.08,
  },
  dashHeroAmountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
    gap: 12,
  },
  dashHeroFilterSlot: {
    width: MOBILE_FILTER_SIZE + (MOBILE_FILTER_INSET - 16),
    height: MOBILE_FILTER_SIZE,
  },
  dashHeroAmount: {
    flex: 1,
    minWidth: 0,
    fontFamily: 'SohneLeicht',
    fontSize: 40,
    lineHeight: 46,
    fontWeight: '400',
    color: LABEL,
    letterSpacing: -1.2,
    fontVariant: ['tabular-nums'],
  },
  dashHeroStats: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(60,60,67,0.18)',
  },
  dashHeroStat: {
    flex: 1,
    minWidth: 0,
    gap: 1,
    paddingVertical: 2,
    paddingHorizontal: 4,
    borderRadius: 10,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  dashHeroStatSelected: {
    backgroundColor: 'rgba(246,241,230,0.1)',
  },
  dashHeroStatValueSelected: {
    color: '#FFF8E8',
  },
  dashHeroStatLabelSelected: {
    color: '#F6F1E6',
  },
  dashHeroStatDivider: {
    width: StyleSheet.hairlineWidth,
    height: 28,
    marginHorizontal: 12,
    backgroundColor: 'rgba(60,60,67,0.18)',
  },
  dashHeroStatValue: {
    fontFamily,
    fontSize: 17,
    fontWeight: '600',
    color: LABEL,
    letterSpacing: -0.3,
    fontVariant: ['tabular-nums'],
  },
  dashHeroStatLabel: {
    fontFamily,
    fontSize: 12,
    color: SECONDARY,
    letterSpacing: -0.05,
  },
  dashSection: {
    marginTop: 0,
  },
  dashSectionFill: {
    flex: 1,
    minHeight: 0,
  },
  dashSheetHandle: {
    paddingTop: 8,
  },
  dashSheetGrabPill: {
    alignSelf: 'center',
    width: 36,
    height: 5,
    borderRadius: 3,
    backgroundColor: 'rgba(60,60,67,0.22)',
    marginBottom: 2,
  },
  dashListFill: {
    flex: 1,
    minHeight: 0,
    borderTopWidth: 0,
  },
  dashSheetApp: {
    flex: 1,
    minHeight: 0,
  },
  dashTicketListHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingTop: 10,
    paddingBottom: 8,
  },
  dashHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 32,
    paddingVertical: 0,
    marginTop: 6,
    marginBottom: 6,
    minHeight: 32,
  },
  dashHeadLead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minWidth: 0,
    flexShrink: 1,
  },
  dashHeadIcon: {
    width: 26,
    height: 26,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  dashHeadTitle: {
    fontFamily,
    fontSize: 13,
    fontWeight: '400',
    color: SECONDARY,
    letterSpacing: -0.08,
    textTransform: 'uppercase',
  },
  dashHeadTitleCard: {
    flexShrink: 1,
    minWidth: 0,
    fontFamily,
    fontSize: 16,
    fontWeight: '600',
    color: MOBILE.label,
    letterSpacing: -0.2,
  },
  dashHeadTrail: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
  },
  dashHeadMeta: {
    flexShrink: 1,
    minWidth: 0,
    fontFamily,
    fontSize: 15,
    fontWeight: '500',
    color: SECONDARY,
    letterSpacing: -0.08,
    fontVariant: ['tabular-nums'],
  },
  dashList: {
    backgroundColor: 'transparent',
    borderTopWidth: 0,
  },
  dashTitle: {
    fontFamily,
    fontSize: 17,
    fontWeight: '600',
    color: LABEL,
    letterSpacing: -0.24,
  },
  dashMeta: {
    fontFamily,
    fontSize: 14,
    color: SECONDARY,
    letterSpacing: -0.08,
  },
  dashValue: {
    fontFamily,
    fontSize: 17,
    fontWeight: '600',
    color: LABEL,
    letterSpacing: -0.3,
    fontVariant: ['tabular-nums'],
    flexShrink: 1,
  },
  dashPersonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 72,
    paddingLeft: 16,
    paddingRight: 16,
    paddingVertical: 12,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(60,60,67,0.24)',
  },
  heroCard: {
    backgroundColor: CANVAS,
    borderRadius: 16,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 16,
  },
  heroKicker: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: SECONDARY,
    letterSpacing: -0.08,
  },
  heroAmount: {
    fontFamily,
    fontSize: 34,
    fontWeight: '700',
    color: LABEL,
    letterSpacing: -0.8,
    fontVariant: ['tabular-nums'],
    marginTop: 2,
  },
  heroAmountEmpty: {
    color: SECONDARY,
  },
  heroMeta: {
    fontFamily,
    fontSize: 15,
    color: SECONDARY,
    letterSpacing: -0.2,
    marginTop: 2,
  },
  heroSplit: {
    flexDirection: 'row',
    alignItems: 'stretch',
    marginTop: 16,
    paddingTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: SEPARATOR,
  },
  heroSplitCol: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  heroSplitRule: {
    width: StyleSheet.hairlineWidth,
    backgroundColor: SEPARATOR,
    marginHorizontal: 14,
  },
  heroSplitLabel: {
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
    color: SO_BLUE,
    letterSpacing: -0.04,
  },
  heroSplitLabelBuy: {
    color: PO_AMBER,
  },
  heroSplitValue: {
    fontFamily,
    fontSize: 20,
    fontWeight: '700',
    color: LABEL,
    letterSpacing: -0.4,
    fontVariant: ['tabular-nums'],
  },
  heroSplitMeta: {
    fontFamily,
    fontSize: 13,
    color: SECONDARY,
    letterSpacing: -0.08,
    fontVariant: ['tabular-nums'],
  },
  employeeAvatarRing: {
    borderWidth: 2,
    borderColor: '#fff',
  },
  mobileTxRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: HOME_STORE_BODY_LEADING,
    minHeight: 72,
    paddingLeft: MOBILE_FILTER_INSET,
    paddingRight: MOBILE_FILTER_INSET,
    paddingTop: 12,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(60,60,67,0.18)',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  mobileTxIconCol: {
    width: HOME_STORE_ICON_COL_WIDTH,
    alignItems: 'center',
    justifyContent: 'flex-start',
    flexShrink: 0,
    paddingTop: 0,
  },
  mobileTxThumb: {
    width: 48,
    height: 48,
    flexShrink: 0,
  },
  mobileTxKind: {
    width: 48,
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EEF3FF',
  },
  mobileTxKindBuy: {
    backgroundColor: '#FFF6E8',
  },
  mobileTxKindText: {
    fontFamily,
    fontSize: 12,
    fontWeight: '700',
    color: SO_BLUE,
    letterSpacing: 0.2,
  },
  mobileTxKindTextBuy: {
    color: PO_AMBER,
  },
  mobileTxBody: {
    flex: 1,
    minWidth: 0,
  },
  mobileTxMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minWidth: 0,
    width: '100%',
  },
  mobileTxCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  mobileTxLead: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  mobileTxTrail: {
    flexShrink: 1,
    maxWidth: '46%',
    alignItems: 'flex-end',
    gap: 2,
  },
  mobileTxTrailing: {
    maxWidth: '42%',
    flexShrink: 0,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  mobileTxChevron: {
    width: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  mobileTxCustomer: {
    fontFamily,
    minWidth: 0,
    fontSize: 16,
    fontWeight: '600',
    color: LABEL,
    letterSpacing: -0.2,
  },
  mobileTxAmount: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 4,
    flexShrink: 0,
  },
  mobileTxAmountText: {
    fontFamily,
    fontSize: 16,
    fontWeight: '600',
    color: LABEL,
    letterSpacing: -0.2,
    fontVariant: ['tabular-nums'],
    textAlign: 'right',
  },
  mobileTxMeta: {
    fontFamily,
    minWidth: 0,
    fontSize: 13,
    color: SECONDARY,
    letterSpacing: 0,
  },
  mobileTxItems: {
    fontFamily,
    minWidth: 0,
    fontSize: 13,
    lineHeight: 18,
    color: SECONDARY,
    letterSpacing: 0,
  },
  homeTxHeaderLabel: {
    fontFamily,
    fontSize: 13,
    fontWeight: '400',
    color: SECONDARY,
    letterSpacing: -0.08,
    textTransform: 'uppercase',
    flexShrink: 1,
    minWidth: 0,
  },
  homeTxEmpty: {
    fontFamily,
    fontSize: 13,
    color: SECONDARY,
    paddingHorizontal: 8,
    paddingVertical: 28,
  },
  homeTabHeader: {
    paddingLeft: 8,
    paddingRight: 8,
    gap: 12,
  },
  homeTabRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 52,
    paddingLeft: 8,
    paddingRight: 8,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: SEPARATOR,
  },
  homeTabColPerson: {
    flex: 1.2,
    minWidth: 0,
  },
  homeTabColEmail: {
    flex: 1.4,
    minWidth: 0,
  },
  homeTabColEmployee: {
    flex: 1,
    minWidth: 0,
  },
  txTableHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 36,
    paddingLeft: 8,
    backgroundColor: 'transparent',
  },
  txCell: {
    fontFamily,
    fontSize: 13,
    fontWeight: '400',
    color: LABEL,
    letterSpacing: 0,
  },
  txCellPrimary: {
    fontWeight: '500',
  },
  txCellSecondary: {
    color: SECONDARY,
  },
  cashHeroStack: {
    paddingHorizontal: 14,
    paddingVertical: 16,
    gap: 14,
  },
  cashHero: {
    gap: 4,
  },
  cashHeroLabel: {
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
    color: SECONDARY,
    letterSpacing: -0.04,
    textTransform: 'uppercase',
  },
  cashHeroValue: {
    fontFamily,
    fontSize: 28,
    fontWeight: '700',
    color: LABEL,
    letterSpacing: -0.6,
    fontVariant: ['tabular-nums'],
  },
  cashHeroUsd: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: SECONDARY,
    letterSpacing: -0.2,
    fontVariant: ['tabular-nums'],
    marginTop: -2,
  },
  cashHeroMeta: {
    fontFamily,
    fontSize: 13,
    fontWeight: '500',
    color: SECONDARY,
    letterSpacing: -0.08,
    fontVariant: ['tabular-nums'],
  },
  employeeCardGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    ...Platform.select({
      web: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(168px, 1fr))',
      },
    }),
  },
  employeeCard: {
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: '#fff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: SEPARATOR,
    gap: 4,
    minWidth: 148,
    flexGrow: 1,
    flexBasis: 168,
    ...Platform.select({
      web: {
        minWidth: 0,
        flexGrow: 0,
        flexBasis: 'auto',
      },
    }),
  },
  employeeCardName: {
    fontFamily,
    fontSize: 15,
    fontWeight: '700',
    color: LABEL,
    letterSpacing: -0.3,
    textAlign: 'center',
    marginTop: 8,
    alignSelf: 'stretch',
  },
  employeeCardMeta: {
    fontFamily,
    fontSize: 12,
    lineHeight: 16,
    color: SECONDARY,
    textAlign: 'center',
    alignSelf: 'stretch',
  },
  employeeAvatar: {
    overflow: 'hidden',
    backgroundColor: '#ececf0',
    flexShrink: 0,
  },
  employeeAvatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EFF6FF',
  },
  employeeInitials: {
    fontFamily,
    fontWeight: '700',
    color: '#1D4ED8',
  },
  inventorySearchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginRight: 12,
  },
  inventorySearchField: {
    flex: 1,
    marginHorizontal: 0,
    marginLeft: 12,
  },
  inventoryRefresh: {
    width: 40,
    height: 40,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: SEPARATOR,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  inventoryRefreshCompact: {
    width: 32,
    height: 32,
    borderRadius: NAV_TAB_ACTIVE_RADIUS,
    borderWidth: 1,
    borderColor: TAB_BORDER,
    backgroundColor: CANVAS,
    ...CHIP_SHADOW,
  },
  inventoryRefreshHover: {
    opacity: 0.72,
  },
  searchField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 40,
    marginHorizontal: 12,
    marginTop: 10,
    marginBottom: 4,
    paddingLeft: 12,
    paddingRight: 8,
    borderRadius: 8,
    backgroundColor: '#fff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: SEPARATOR,
  },
  searchInput: {
    flex: 1,
    fontFamily,
    fontSize: 13,
    fontWeight: '400',
    color: LABEL,
    paddingVertical: 10,
    ...Platform.select({
      web: { outlineStyle: 'none' },
      default: {},
    }),
  },
  scroll: {
    flex: 1,
    minHeight: 0,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 52,
    paddingHorizontal: 14,
    paddingVertical: 8,
    gap: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: SEPARATOR,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  rowStatic: {
    ...Platform.select({
      web: { cursor: 'default' },
      default: {},
    }),
  },
  rowLast: {
    borderBottomWidth: 0,
  },
  rowHovered: {
    backgroundColor: '#e8e8ed',
  },
  rowCopy: {
    flex: 1,
    minWidth: 0,
  },
  rowTitle: {
    fontFamily,
    fontSize: 15,
    fontWeight: '400',
    color: LABEL,
    letterSpacing: -0.2,
  },
  rowSubtitle: {
    fontFamily,
    fontSize: 12,
    color: SECONDARY,
    letterSpacing: -0.04,
    marginTop: 1,
  },
  priceBadgeOk: {
    backgroundColor: '#DCFCE7',
  },
  priceBadgeOff: {
    backgroundColor: '#FFEDD5',
  },
  priceBadgeMuted: {
    backgroundColor: FILL,
  },
  priceModalRoot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.32)',
    padding: 24,
  },
  priceModalCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 18,
    gap: 12,
  },
  priceModalHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  priceModalIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  priceModalCopy: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  priceModalTitle: {
    fontFamily,
    fontSize: 18,
    fontWeight: '600',
    color: LABEL,
    letterSpacing: -0.3,
  },
  priceModalIntro: {
    fontFamily,
    fontSize: 14,
    lineHeight: 19,
    color: SECONDARY,
  },
  priceLine: {
    gap: 3,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: SEPARATOR,
  },
  priceLineName: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: LABEL,
  },
  priceLineMeta: {
    fontFamily,
    fontSize: 13,
    color: SECONDARY,
  },
  priceLineReason: {
    fontFamily,
    fontSize: 13,
    fontWeight: '500',
    color: '#166534',
    marginTop: 2,
  },
  priceLineReasonOff: {
    color: '#9A3412',
  },
  priceModalDone: {
    alignSelf: 'flex-end',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  priceModalDoneText: {
    fontFamily,
    fontSize: 16,
    fontWeight: '600',
    color: BLUE,
  },
  rowValue: {
    fontFamily,
    fontSize: 15,
    fontWeight: '400',
    color: LABEL,
    letterSpacing: -0.2,
    fontVariant: ['tabular-nums'],
    flexShrink: 0,
  },
  rowValueMuted: {
    color: SECONDARY,
  },
  txThumbPress: {
    width: 32,
    height: 32,
    flexShrink: 0,
    position: 'relative',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  txThumb: {
    width: 32,
    height: 32,
    borderRadius: 7,
    backgroundColor: '#ececf0',
  },
  txThumbBadge: {
    position: 'absolute',
    right: -4,
    bottom: -4,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: LABEL,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  txThumbBadgeText: {
    fontFamily,
    fontSize: 9,
    fontWeight: '700',
    color: '#fff',
  },
  txViewerRoot: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  txViewerSheet: {
    width: '100%',
    maxWidth: 560,
    maxHeight: '90%',
    gap: 12,
  },
  txViewerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  txViewerTitle: {
    flex: 1,
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: LABEL,
  },
  txViewerImage: {
    width: '100%',
    height: 420,
    maxHeight: '70%',
    borderRadius: 12,
    backgroundColor: '#111',
  },
  txViewerNav: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
  },
  txViewerNavBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  priorityDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    flexShrink: 0,
  },
  priorityDotSpacer: {
    width: 7,
    flexShrink: 0,
  },
  emptyText: {
    fontFamily,
    flex: 1,
    minWidth: 0,
    fontSize: 14,
    color: SECONDARY,
    letterSpacing: -0.2,
  },
  showMoreRow: {
    minHeight: 44,
    justifyContent: 'center',
    gap: 4,
  },
  showMoreText: {
    fontFamily,
    fontSize: 14,
    fontWeight: '500',
    color: BLUE,
    letterSpacing: -0.2,
  },
  loadingRow: {
    justifyContent: 'center',
    minHeight: 52,
  },
  emailHero: {
    paddingHorizontal: 14,
    paddingTop: 16,
    paddingBottom: 12,
    gap: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: SEPARATOR,
  },
  emailHeroLabel: {
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
    color: SECONDARY,
    letterSpacing: -0.04,
    textTransform: 'uppercase',
  },
  emailHeroValue: {
    fontFamily,
    fontSize: 28,
    fontWeight: '700',
    color: LABEL,
    letterSpacing: -0.6,
    fontVariant: ['tabular-nums'],
  },
  emailHeroMeta: {
    fontFamily,
    fontSize: 12,
    color: SECONDARY,
    letterSpacing: -0.04,
  },
  emailSectionLabel: {
    fontFamily,
    fontSize: 11,
    fontWeight: '700',
    color: '#B91C1C',
    letterSpacing: 0.2,
    textTransform: 'uppercase',
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 4,
  },
  emailRow: {
    minHeight: 44,
    paddingVertical: 6,
  },
});
