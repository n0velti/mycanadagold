import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { fetchStoreCashPosition } from '../lib/cashTill';
import { checkTransactionPrices } from '../lib/priceCheck';
import { AUREUS_CASH_LIVE_MS, useLiveRefresh } from '../lib/liveRefresh';
import { fetchInventoryMatrix, formatQty, peekInventoryMatrix } from '../lib/inventory';
import { textMatchesQuery } from '../lib/itemSearch';
import { listStaffProfiles } from '../lib/permissions';
import { initialsFor } from '../lib/rippling';
import { formatAmount, isCashTransaction } from '../lib/transactions';
import { useTxnCashBreakdowns } from '../lib/txnCashBreakdowns';
import snapshot from '../lib/websitePriceSnapshot.json';
import { fetchWebsitePrices, reconcileCatalog } from '../lib/websitePrices';
import TxnCashBreakdownModal, { TxnCashIcon } from './TxnCashBreakdownModal';

const fontFamily = Platform.select({
  ios: 'Sohne',
  android: 'Sohne',
  default: 'Sohne',
});

const LABEL = '#1d1d1f';
const SECONDARY = '#8e8e93';
const FILL = 'rgba(118, 118, 128, 0.12)';
const SEPARATOR = '#e5e5ea';
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
  financials: { key: 'financials', label: 'Financials', icon: 'wallet', accent: '#3D8B4F' },
  inventory: { key: 'inventory', label: 'Inventory', icon: 'cube', accent: '#C47A12' },
  employees: { key: 'employees', label: 'Employees', icon: 'people', accent: '#1D4ED8' },
  transactions: { key: 'transactions', label: 'Transactions', icon: 'swap-horizontal', accent: '#2F6FED' },
};

function hasDrawerActivity(drawer) {
  if (!drawer) return false;
  return (
    Math.abs(drawer.openingBalance || 0) > 0 ||
    Math.abs(drawer.expectedOnHand || 0) > 0 ||
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

function pickStoreColumns(stores, storeName) {
  const matches = (stores || []).filter((store) => namesMatch(store.name, storeName));
  if (matches.length <= 1) return matches;
  const linked = matches.find((store) => store.systemKey === 'gta' || store.systemKey === 'pmx');
  return [linked || matches[0]];
}

function InventorySearch({ value, onChangeText }) {
  return (
    <View style={styles.searchField}>
      <Ionicons name="search" size={15} color={SECONDARY} />
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
  );
}

function AppBox({ app, meta, onOpen, children, style, bodyStyle }) {
  return (
    <View style={[styles.appBox, style]}>
      <Pressable
        onPress={() => onOpen?.(app.key)}
        style={({ hovered, pressed }) => [
          styles.appBoxHead,
          (hovered || pressed) && styles.appBoxHeadHovered,
        ]}
        accessibilityRole="button"
        accessibilityLabel={`Open ${app.label}`}
      >
        <View style={[styles.appBoxIcon, { backgroundColor: app.accent }]}>
          <Ionicons name={app.icon} size={16} color="#fff" />
        </View>
        <View style={styles.appBoxHeadCopy}>
          <Text style={styles.appBoxTitle}>{app.label}</Text>
          {meta ? <Text style={styles.appBoxMeta}>{meta}</Text> : null}
        </View>
        <Ionicons name="chevron-forward" size={14} color={SECONDARY} />
      </Pressable>
      <View style={[styles.appBoxBody, bodyStyle]}>{children}</View>
    </View>
  );
}

function EmployeeAvatar({ person, size = 32 }) {
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
      ]}
    >
      {showImage ? (
        <Image
          source={{ uri: photoUrl }}
          style={{ width: size, height: size, borderRadius: size / 2 }}
          onError={() => setFailed(true)}
        />
      ) : (
        <Text style={[styles.employeeInitials, { fontSize: size > 34 ? 13 : 11 }]}>
          {initialsFor(person?.name)}
        </Text>
      )}
    </View>
  );
}

function EmployeeRow({ person, last }) {
  const subtitle = person.txCount
    ? `${person.txCount} transaction${person.txCount === 1 ? '' : 's'} today`
    : person.role || 'Assigned to this store';
  return (
    <View style={[styles.row, styles.rowStatic, last && styles.rowLast]}>
      <EmployeeAvatar person={person} />
      <View style={styles.rowCopy}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {person.name}
        </Text>
        <Text style={styles.rowSubtitle} numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
    </View>
  );
}

function ExpectedCash({ drawer }) {
  if (!drawer) return null;
  const currency = drawer.currency || 'CAD';
  return (
    <View style={styles.cashHero}>
      <Text style={styles.cashHeroLabel}>Expected {currency}</Text>
      <Text style={styles.cashHeroValue}>{formatAmount(drawer.expectedOnHand, currency)}</Text>
    </View>
  );
}

function itemSnapshotLabel(row) {
  const names = (row?.itemNames || [])
    .map((name) => String(name || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  if (!names.length) return '';
  const shown = names.slice(0, 2);
  const extra = names.length - shown.length;
  return extra > 0 ? `${shown.join(' · ')} +${extra}` : shown.join(' · ');
}

function priceBadgeMeta(check) {
  if (!check || check.status === 'loading') {
    return { label: 'Checking prices', icon: 'time-outline', tone: 'muted' };
  }
  if (check.status === 'off') {
    return { label: "Something's off", icon: 'warning-outline', tone: 'off' };
  }
  if (check.status === 'ok') {
    return { label: 'Makes sense', icon: 'checkmark-circle-outline', tone: 'ok' };
  }
  return { label: "Can't check", icon: 'help-circle-outline', tone: 'muted' };
}

function PriceCheckBadge({ check, onPress }) {
  const meta = priceBadgeMeta(check);
  const canOpen = check && check.status !== 'loading';
  return (
    <Pressable
      onPress={canOpen ? onPress : undefined}
      hitSlop={6}
      style={[
        styles.priceBadge,
        meta.tone === 'off' && styles.priceBadgeOff,
        meta.tone === 'ok' && styles.priceBadgeOk,
        meta.tone === 'muted' && styles.priceBadgeMuted,
      ]}
      accessibilityRole="button"
      accessibilityLabel={meta.label}
    >
      <Ionicons
        name={meta.icon}
        size={12}
        color={meta.tone === 'off' ? '#9A3412' : meta.tone === 'ok' ? '#166534' : '#6b6b6b'}
      />
      <Text
        style={[
          styles.priceBadgeText,
          meta.tone === 'off' && styles.priceBadgeTextOff,
          meta.tone === 'ok' && styles.priceBadgeTextOk,
          meta.tone === 'muted' && styles.priceBadgeTextMuted,
        ]}
      >
        {meta.label}
      </Text>
    </Pressable>
  );
}

function PriceCheckModal({ check, onClose }) {
  if (!check) return null;
  const off = check.status === 'off';
  const unknown = check.status === 'unknown' || check.status === 'loading';
  const title = off ? "Something's off" : unknown ? "Can't check yet" : 'Makes sense';
  const scrapUnknown = (check.lines || []).some((line) => line.kind === 'scrap' && line.status === 'unknown');
  const intro = off
    ? check.isPurchase
      ? 'This purchase does not match website we-buy prices (1% tolerance).'
      : 'This sale does not match website we-sell prices (1% tolerance).'
    : unknown
      ? scrapUnknown
        ? 'Scrap is checked by karat and premium vs standard: website $/g × the recorded weight.'
        : 'We need a website match and a unit price on each line to check this transaction.'
      : check.isPurchase
        ? 'These purchase prices are within 1% of website we-buy prices.'
        : 'These sale prices are within 1% of website we-sell prices.';

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

function TxnPhotoThumb({ urls, label }) {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [failed, setFailed] = useState(false);
  const photos = Array.isArray(urls) ? urls.filter(Boolean) : [];

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
        style={styles.txThumbPress}
        accessibilityRole="button"
        accessibilityLabel={
          hasMany ? `View ${photos.length} photos for ${label}` : `View photo for ${label}`
        }
      >
        <Image
          source={{ uri: photos[0] }}
          style={styles.txThumb}
          resizeMode="cover"
          onError={() => setFailed(true)}
        />
        {hasMany ? (
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

const TransactionRow = memo(function TransactionRow({
  item,
  last,
  onPress,
  cashSaved,
  onCashPress,
  priceCheck,
  onPricePress,
}) {
  const isBuy = item.type === 'purchase';
  const items = itemSnapshotLabel(item);
  const employee = String(item.employeeName || '').trim();
  const meta = [item.timeLabel || item.dateLabel, item.paymentMethodLabel, employee]
    .filter((part) => part && part !== '—')
    .join(' · ');
  const subtitle = [items || item.reference, meta].filter(Boolean).join('  ·  ');
  const showCash = typeof onCashPress === 'function' && isCashTransaction(item);

  return (
    <Pressable
      onPress={() => onPress?.(item)}
      style={({ hovered, pressed }) => [
        styles.row,
        last && styles.rowLast,
        (hovered || pressed) && styles.rowHovered,
      ]}
      accessibilityRole="button"
      accessibilityLabel={`${isBuy ? 'PO' : 'SO'} ${item.customerName || ''} ${item.amountLabel || ''}`}
    >
      <TxnPhotoThumb urls={item.imageUrls} label={item.reference || (isBuy ? 'PO' : 'SO')} />
      <Text style={[styles.kind, isBuy && styles.kindBuy]}>{isBuy ? 'PO' : 'SO'}</Text>
      <View style={styles.rowCopy}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {item.customerName || '—'}
        </Text>
        <Text style={styles.rowSubtitle} numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
      <View style={styles.rowAmountCol}>
        <View style={styles.rowAmount}>
          {showCash ? (
            <TxnCashIcon saved={cashSaved} onPress={() => onCashPress(item)} />
          ) : null}
          <Text style={styles.rowValue}>{item.amountLabel}</Text>
        </View>
        <PriceCheckBadge check={priceCheck} onPress={() => onPricePress?.(priceCheck)} />
      </View>
    </Pressable>
  );
});

const InventoryRow = memo(function InventoryRow({ row, qty, last }) {
  return (
    <View style={[styles.row, styles.rowStatic, last && styles.rowLast]}>
      {row.priority ? (
        <View style={[styles.priorityDot, { backgroundColor: PRIORITY_COLORS[row.priority] }]} />
      ) : (
        <View style={styles.priorityDotSpacer} />
      )}
      <View style={styles.rowCopy}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {row.name}
        </Text>
        {row.sku ? (
          <Text style={styles.rowSubtitle} numberOfLines={1}>
            {row.sku}
          </Text>
        ) : null}
      </View>
      <Text style={[styles.rowValue, qty === 0 && styles.rowValueMuted]}>
        {qty === 0 ? '—' : formatQty(qty)}
      </Text>
    </View>
  );
});

function ShowMoreRow({ remaining, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ hovered, pressed }) => [
        styles.row,
        styles.rowLast,
        styles.showMoreRow,
        (hovered || pressed) && styles.rowHovered,
      ]}
      accessibilityRole="button"
      accessibilityLabel={`Show ${remaining} more items`}
    >
      <Text style={styles.showMoreText}>Show {remaining} more</Text>
      <Ionicons name="chevron-down" size={14} color={BLUE} />
    </Pressable>
  );
}

function EmptyRow({ text }) {
  return (
    <View style={[styles.row, styles.rowStatic, styles.rowLast]}>
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}

function LoadingRow() {
  return (
    <View style={[styles.row, styles.rowLast, styles.loadingRow]}>
      <ActivityIndicator size="small" color={BLUE} />
    </View>
  );
}

function StoreSnapshotPanel({
  session,
  store,
  periodLabel = 'Today',
  txRows = [],
  onOpenTransaction,
  onOpenApp,
  topInset = 0,
  ready = true,
}) {
  const storeName = store?.store || '';
  const { width: windowWidth } = useWindowDimensions();
  const isMobile = windowWidth < 768;
  const [inventoryQuery, setInventoryQuery] = useState('');
  const [inventoryLimit, setInventoryLimit] = useState(INVENTORY_PAGE);
  const [cash, setCash] = useState(null);
  const [cashLoading, setCashLoading] = useState(false);
  const [cashError, setCashError] = useState('');
  const [inventoryStores, setInventoryStores] = useState([]);
  const [inventoryRows, setInventoryRows] = useState([]);
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [inventoryError, setInventoryError] = useState('');
  const [staff, setStaff] = useState([]);
  const [staffLoading, setStaffLoading] = useState(false);
  const [priceCatalog, setPriceCatalog] = useState(() => {
    try {
      return { ...snapshot, ...reconcileCatalog(snapshot.buy, snapshot.sell) };
    } catch {
      return null;
    }
  });
  const [priceReview, setPriceReview] = useState(null);
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
    setInventoryLimit(INVENTORY_PAGE);
    setCash(null);
    setCashError('');
  }, [storeName]);

  useEffect(() => {
    loadCash();
  }, [loadCash]);

  useEffect(() => {
    loadInventory();
  }, [loadInventory]);

  useEffect(() => {
    loadStaff();
  }, [loadStaff]);

  useLiveRefresh(loadCash, AUREUS_CASH_LIVE_MS, Boolean(session?.token && storeName));
  useLiveRefresh(
    (opts) => loadInventory({ ...opts, force: true }),
    20_000,
    Boolean(session?.token && storeName),
  );

  const storeColumns = useMemo(
    () => pickStoreColumns(inventoryStores, storeName),
    [inventoryStores, storeName],
  );
  const storeId = storeColumns[0]?.id;
  const searching = Boolean(inventoryQuery.trim());

  useEffect(() => {
    setInventoryLimit(INVENTORY_PAGE);
  }, [inventoryQuery]);

  useEffect(() => {
    let cancelled = false;
    fetchWebsitePrices({ force: true })
      .then((catalog) => {
        if (!cancelled && catalog) setPriceCatalog(catalog);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Reuse a row's price check while the row object and catalog are unchanged,
  // so unchanged rows keep the same `priceCheck` prop and stay memoized.
  const priceCheckCache = useRef({ catalog: null, byRow: new WeakMap() });
  const priceChecks = useMemo(() => {
    const cache = priceCheckCache.current;
    if (cache.catalog !== priceCatalog) {
      cache.catalog = priceCatalog;
      cache.byRow = new WeakMap();
    }
    const map = new Map();
    for (const row of txRows) {
      let check = cache.byRow.get(row);
      if (!check) {
        check = checkTransactionPrices(row, priceCatalog);
        cache.byRow.set(row, check);
      }
      map.set(row.id, check);
    }
    return map;
  }, [priceCatalog, txRows]);

  const allItems = useMemo(() => {
    if (!storeId) return [];
    return inventoryRows
      .map((row) => ({ row, qty: row.quantities[storeId] || 0 }))
      .filter(({ row, qty }) => (searching ? itemMatches(row, inventoryQuery) : qty !== 0));
  }, [inventoryRows, storeId, inventoryQuery, searching]);
  const visibleItems = useMemo(
    () => (allItems.length > inventoryLimit ? allItems.slice(0, inventoryLimit) : allItems),
    [allItems, inventoryLimit],
  );
  const hiddenItemCount = allItems.length - visibleItems.length;
  const showMoreItems = useCallback(() => {
    setInventoryLimit((current) => current + INVENTORY_PAGE);
  }, []);

  const cashSlips = useTxnCashBreakdowns(txRows);
  const showUsd = hasDrawerActivity(cash?.usd);
  const txMeta = `${periodLabel} · ${txRows.length}`;
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
      const match = staff.find((person) => personMatchesTxName(person, name));
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

  const employeeMeta = presentEmployees.length
    ? `${presentEmployees.length} here`
    : 'Now';

  const inventoryBody = inventoryError && !hasInventoryRef.current ? (
    <Pressable onPress={loadInventory}>
      <EmptyRow text={`${inventoryError} · Tap to retry`} />
    </Pressable>
  ) : (inventoryLoading && inventoryRows.length === 0) || !ready ? (
    <LoadingRow />
  ) : !storeId ? (
    <EmptyRow text={`No inventory data for ${storeName || 'this store'}.`} />
  ) : visibleItems.length === 0 ? (
    <EmptyRow text={searching ? 'No matching items.' : 'No stocked items.'} />
  ) : (
    <>
      {visibleItems.map(({ row, qty }, index) => (
        <InventoryRow
          key={row.id}
          row={row}
          qty={qty}
          last={hiddenItemCount === 0 && index === visibleItems.length - 1}
        />
      ))}
      {hiddenItemCount > 0 ? (
        <ShowMoreRow remaining={hiddenItemCount} onPress={showMoreItems} />
      ) : null}
    </>
  );

  const financialsBody = cashError ? (
    <Pressable onPress={loadCash}>
      <EmptyRow text={`${cashError} · Tap to retry`} />
    </Pressable>
  ) : cashLoading && !cash ? (
    <LoadingRow />
  ) : cash ? (
    <View style={styles.cashHeroStack}>
      <ExpectedCash drawer={cash.cad} />
      {showUsd ? <ExpectedCash drawer={cash.usd} /> : null}
    </View>
  ) : (
    <EmptyRow text="No cash data for this store." />
  );

  const employeesBody = staffLoading && presentEmployees.length === 0 ? (
    <LoadingRow />
  ) : presentEmployees.length === 0 ? (
    <EmptyRow text="No employees at this store right now." />
  ) : (
    presentEmployees.map((person, index) => (
      <EmployeeRow
        key={`${person.name}-${index}`}
        person={person}
        last={index === presentEmployees.length - 1}
      />
    ))
  );

  const transactionsBody =
    txRows.length === 0 ? (
      <EmptyRow
        text={`No transactions ${periodLabel === 'Today' ? 'today' : 'in this period'}.`}
      />
    ) : (
      txRows.map((item, index) => (
        <TransactionRow
          key={item.id}
          item={item}
          last={index === txRows.length - 1}
          onPress={onOpenTransaction}
          cashSaved={cashSlips.isSaved(item)}
          onCashPress={cashSlips.openEditor}
          priceCheck={priceChecks.get(item.id)}
          onPricePress={setPriceReview}
        />
      ))
    );

  const content = (
    <>
      <View style={[styles.appRow, isMobile && styles.appRowMobile]}>
        <AppBox
          app={SNAPSHOT_APPS.financials}
          meta="Now"
          onOpen={onOpenApp}
          style={[styles.appRowBox, !isMobile && styles.appRowBoxDesktop]}
        >
          {financialsBody}
        </AppBox>
        <AppBox
          app={SNAPSHOT_APPS.inventory}
          meta={itemMeta}
          onOpen={onOpenApp}
          style={[styles.appRowBox, !isMobile && styles.appRowBoxDesktop]}
          bodyStyle={!isMobile ? styles.inventoryBoxBody : null}
        >
          <InventorySearch value={inventoryQuery} onChangeText={setInventoryQuery} />
          {isMobile ? (
            inventoryBody
          ) : (
            <ScrollView
              style={styles.inventoryList}
              contentContainerStyle={styles.boxListContent}
              nestedScrollEnabled
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {inventoryBody}
            </ScrollView>
          )}
        </AppBox>
        <AppBox
          app={SNAPSHOT_APPS.employees}
          meta={employeeMeta}
          onOpen={onOpenApp}
          style={[styles.appRowBox, !isMobile && styles.appRowBoxDesktop]}
          bodyStyle={!isMobile ? styles.appBoxBodyFill : null}
        >
          {isMobile ? (
            employeesBody
          ) : (
            <ScrollView
              style={styles.employeeList}
              contentContainerStyle={styles.boxListContent}
              nestedScrollEnabled
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {employeesBody}
            </ScrollView>
          )}
        </AppBox>
      </View>

      <AppBox
        app={SNAPSHOT_APPS.transactions}
        meta={txMeta}
        onOpen={onOpenApp}
        style={styles.txAppBox}
      >
        {transactionsBody}
      </AppBox>
    </>
  );

  return (
    <View style={[styles.body, isMobile && styles.bodyMobile]}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingTop: topInset + 10 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {content}
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
export default memo(
  StoreSnapshotPanel,
  (prev, next) =>
    prev.session === next.session &&
    (prev.store?.store || '') === (next.store?.store || '') &&
    prev.periodLabel === next.periodLabel &&
    prev.txRows === next.txRows &&
    prev.onOpenTransaction === next.onOpenTransaction &&
    prev.onOpenApp === next.onOpenApp &&
    prev.topInset === next.topInset &&
    prev.ready === next.ready,
);

const styles = StyleSheet.create({
  body: {
    flex: 1,
    minHeight: 0,
    backgroundColor: '#f2f2f7',
    paddingHorizontal: 16,
  },
  bodyMobile: {
    paddingHorizontal: 14,
  },
  appRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 12,
  },
  appRowMobile: {
    flexDirection: 'column',
  },
  appRowBox: {
    flex: 1,
    minWidth: 0,
    minHeight: 200,
  },
  appRowBoxDesktop: {
    height: 280,
    maxHeight: 280,
    minHeight: 280,
  },
  appBox: {
    backgroundColor: '#fff',
    borderRadius: 14,
    overflow: 'hidden',
    flexDirection: 'column',
  },
  appBoxHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: SEPARATOR,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  appBoxHeadHovered: {
    backgroundColor: '#f7f7f8',
  },
  appBoxIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  appBoxHeadCopy: {
    flex: 1,
    minWidth: 0,
  },
  appBoxTitle: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: LABEL,
    letterSpacing: -0.2,
  },
  appBoxMeta: {
    fontFamily,
    fontSize: 12,
    color: SECONDARY,
    letterSpacing: -0.04,
    marginTop: 1,
  },
  appBoxBody: {
    minHeight: 0,
  },
  appBoxBodyFill: {
    flex: 1,
    minHeight: 0,
  },
  inventoryBoxBody: {
    flex: 1,
    minHeight: 0,
  },
  inventoryList: {
    flex: 1,
    minHeight: 0,
  },
  employeeList: {
    flex: 1,
    minHeight: 0,
  },
  boxListContent: {
    flexGrow: 1,
  },
  txAppBox: {
    marginTop: 0,
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
  searchField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 32,
    marginHorizontal: 12,
    marginTop: 10,
    marginBottom: 4,
    paddingHorizontal: 10,
    borderRadius: 9,
    backgroundColor: FILL,
  },
  searchInput: {
    flex: 1,
    fontFamily,
    fontSize: 15,
    fontWeight: '400',
    color: LABEL,
    paddingVertical: 6,
    ...Platform.select({
      web: { outlineStyle: 'none' },
      default: {},
    }),
  },
  scroll: {
    flex: 1,
    minHeight: 0,
  },
  scrollContent: {
    paddingBottom: 32,
    gap: 12,
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
  rowTitleStrong: {
    fontWeight: '600',
  },
  rowSubtitle: {
    fontFamily,
    fontSize: 12,
    color: SECONDARY,
    letterSpacing: -0.04,
    marginTop: 1,
  },
  rowAmountCol: {
    alignItems: 'flex-end',
    gap: 4,
    flexShrink: 0,
    maxWidth: 200,
  },
  rowAmount: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
  },
  priceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 7,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
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
  priceBadgeText: {
    fontFamily,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: -0.04,
  },
  priceBadgeTextOk: {
    color: '#166534',
  },
  priceBadgeTextOff: {
    color: '#9A3412',
  },
  priceBadgeTextMuted: {
    color: '#6b6b6b',
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
  kind: {
    fontFamily,
    width: 20,
    flexShrink: 0,
    fontSize: 11,
    fontWeight: '600',
    color: SO_BLUE,
    letterSpacing: -0.04,
  },
  kindBuy: {
    color: PO_AMBER,
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
});
