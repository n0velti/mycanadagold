import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import {
  hasSheetValues,
  loadStoreCashCounts,
  subscribeStoreCashCounts,
} from '../lib/cashCounts';
import {
  addPieceMaps,
  denomPieceLabel,
  denomTitle,
  denomValueFromPieces,
  denomsForCurrency,
  piecesFromSheet,
} from '../lib/cashDenoms';
import { fetchStoreCashPosition, shiftDateParam } from '../lib/cashTill';
import { checkTransactionPrices } from '../lib/priceCheck';
import { AUREUS_CASH_LIVE_MS, useLiveRefresh } from '../lib/liveRefresh';
import { fetchInventoryMatrix, formatQty, peekInventoryMatrix } from '../lib/inventory';
import { textMatchesQuery } from '../lib/itemSearch';
import {
  formatAmount,
  formatDateParam,
  isCashTransaction,
  parseDateParam,
  rowMatchesQuery,
} from '../lib/transactions';
import {
  loadStoreDayTxnCashBreakdowns,
  subscribeStoreTxnCashBreakdowns,
  sumBreakdownPieces,
  useTxnCashBreakdowns,
} from '../lib/txnCashBreakdowns';
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

function namesMatch(a, b) {
  return (
    String(a || '')
      .trim()
      .localeCompare(String(b || '').trim(), undefined, { sensitivity: 'base' }) === 0
  );
}

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

function signedAmount(value, currency) {
  const n = Number(value) || 0;
  const label = formatAmount(Math.abs(n), currency);
  if (n > 0) return `+${label}`;
  if (n < 0) return `-${label}`;
  return label;
}

function formatScrapGrams(grams) {
  const n = Number(grams);
  if (!Number.isFinite(n)) return '';
  const text = n.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
  return `${text}g`;
}

function movementHaystack(row) {
  return [
    row?.comments,
    row?.category,
    row?.directionLabel,
    row?.amountLabel,
    row?.tillName,
    row?.type,
  ]
    .filter(Boolean)
    .join(' ');
}

function movementMatches(row, query) {
  const q = String(query || '').trim();
  if (!q) return true;
  const hay = movementHaystack(row);
  return hay.toLowerCase().includes(q.toLowerCase()) || textMatchesQuery(hay, q);
}

function txMatches(row, query) {
  const q = String(query || '').trim();
  if (!q) return true;
  if (rowMatchesQuery(row, q)) return true;
  const hay = String(row?.searchText || '');
  if (hay.toLowerCase().includes(q.toLowerCase())) return true;
  return (
    textMatchesQuery(hay, q) ||
    textMatchesQuery(row?.customerName, q) ||
    textMatchesQuery(row?.reference, q) ||
    textMatchesQuery(row?.employeeName, q) ||
    textMatchesQuery(row?.paymentMethodLabel, q)
  );
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

function SearchField({ value, onChangeText }) {
  return (
    <View style={styles.searchField}>
      <Ionicons name="search" size={16} color={SECONDARY} />
      <TextInput
        style={styles.searchInput}
        value={value}
        onChangeText={onChangeText}
        placeholder="Transactions, items, cash"
        placeholderTextColor={SECONDARY}
        autoCorrect={false}
        autoCapitalize="none"
        clearButtonMode="while-editing"
        returnKeyType="search"
        accessibilityLabel="Search store snapshot"
      />
      {value ? (
        <Pressable onPress={() => onChangeText('')} hitSlop={8} accessibilityLabel="Clear">
          <Ionicons name="close-circle" size={16} color={SECONDARY} />
        </Pressable>
      ) : null}
    </View>
  );
}

function SectionHeader({ title, meta }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {meta ? <Text style={styles.sectionMeta}>{meta}</Text> : null}
    </View>
  );
}

function Group({ children, flush }) {
  return <View style={[styles.group, flush && styles.groupFlush]}>{children}</View>;
}

function pieceCountLabel(denom, count) {
  const n = Number(count) || 0;
  if (!n) return '—';
  const abs = Math.abs(n);
  const label = `${abs} ${denomPieceLabel(denom, abs)}`;
  return n < 0 ? `−${label}` : label;
}

function sheetCountedTotal(sheet, currency) {
  if (!hasSheetValues(sheet)) return null;
  const listed = Number(sheet.countedTotal);
  if (String(sheet.countedTotal || '').trim() !== '' && Number.isFinite(listed)) return listed;
  const denoms = denomsForCurrency(currency);
  const pieces = piecesFromSheet(denoms, sheet.loose, sheet.stacks);
  const other = Number(sheet.otherCash);
  const otherN = String(sheet.otherCash || '').trim() !== '' && Number.isFinite(other) ? other : 0;
  return Math.round((denomValueFromPieces(denoms, pieces) + otherN) * 100) / 100;
}

function buildDenomCompare(currency, openingSheet, todaySheet, slips) {
  const denoms = denomsForCurrency(currency);
  const opening = hasSheetValues(openingSheet)
    ? piecesFromSheet(denoms, openingSheet.loose, openingSheet.stacks)
    : null;
  const txns = sumBreakdownPieces(slips, currency);
  const expectedPieces = opening || txns.count ? addPieceMaps(opening || {}, txns.net) : null;
  const hasActual = hasSheetValues(todaySheet);
  const actualPieces = hasActual
    ? piecesFromSheet(denoms, todaySheet.loose, todaySheet.stacks)
    : null;
  const actualOther = hasActual ? Number(todaySheet.otherCash) || 0 : 0;
  const rows = [];
  for (const denom of denoms) {
    const expected = expectedPieces ? Number(expectedPieces[denom.key]) || 0 : 0;
    const actual = actualPieces ? Number(actualPieces[denom.key]) || 0 : 0;
    if (!expected && !actual) continue;
    rows.push({
      key: denom.key,
      title: denomTitle(denom),
      color: denom.color,
      expected,
      actual,
      expectedLabel: expectedPieces ? pieceCountLabel(denom, expected) : '—',
      actualLabel: hasActual ? pieceCountLabel(denom, actual) : '—',
      actualAmount: Math.round(actual * denom.face * 100) / 100,
    });
  }
  if (actualOther) {
    rows.push({
      key: 'other',
      title: 'Other',
      color: '#8e8e93',
      expected: 0,
      actual: 0,
      expectedLabel: '—',
      actualLabel: 'Cheques, extras',
      actualAmount: actualOther,
    });
  }
  return {
    rows,
    hasExpected: Boolean(expectedPieces),
    hasActual,
    actualTotal: sheetCountedTotal(todaySheet, currency),
  };
}

function CompareBand({ title, total, currency, rows, empty, showAmounts }) {
  return (
    <View style={styles.compareBand}>
      <View style={styles.compareBandHead}>
        <Text style={styles.compareColTitle}>{title}</Text>
        <Text style={styles.compareColTotal}>
          {total != null ? formatAmount(total, currency) : '—'}
        </Text>
      </View>
      {rows.length === 0 ? (
        <Text style={styles.compareEmpty}>{empty}</Text>
      ) : (
        <View style={styles.compareChips}>
          {rows.map((row) => (
            <View key={row.key} style={styles.compareChip}>
              <View style={[styles.cashDot, { backgroundColor: row.color }]} />
              <Text style={styles.compareChipTitle}>{row.title}</Text>
              <Text style={styles.compareChipCount}>
                {showAmounts ? row.actualLabel : row.expectedLabel}
              </Text>
              {showAmounts && row.actualAmount ? (
                <Text style={styles.compareChipAmount}>
                  {formatAmount(row.actualAmount, currency)}
                </Text>
              ) : null}
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function CashDrawerCard({ drawer, compare }) {
  if (!drawer) return null;
  const currency = drawer.currency || 'CAD';
  const expectedRows = (compare?.rows || []).filter((row) => row.expected);
  const actualRows = (compare?.rows || []).filter(
    (row) => row.actual || row.key === 'other',
  );

  return (
    <Group flush>
      <View style={styles.compareStack}>
        <CompareBand
          title="Expected"
          total={drawer.expectedOnHand}
          currency={currency}
          rows={expectedRows}
          empty="No bill count yet"
        />
        <View style={styles.compareRule} />
        <CompareBand
          title="Actual"
          total={compare?.hasActual ? compare.actualTotal : null}
          currency={currency}
          rows={actualRows}
          empty="No count saved"
          showAmounts
        />
      </View>
    </Group>
  );
}

function MovementRow({ row, last, cashSaved, onCashPress }) {
  const inbound = row.type === 'In';
  return (
    <View style={[styles.row, styles.rowStatic, last && styles.rowLast]}>
      <View style={styles.rowCopy}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {row.comments || row.category || row.directionLabel}
        </Text>
        <Text style={styles.rowSubtitle} numberOfLines={1}>
          {[row.directionLabel, row.category !== row.comments ? row.category : null]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      </View>
      <View style={styles.rowAmount}>
        {onCashPress ? (
          <TxnCashIcon saved={cashSaved} onPress={() => onCashPress(row)} />
        ) : null}
        <Text style={[styles.rowValue, { color: inbound ? GREEN : RED }]}>
          {signedAmount(row.signedAmount, row.currency)}
        </Text>
      </View>
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

function TransactionRow({ item, last, onPress, cashSaved, onCashPress, priceCheck, onPricePress }) {
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
}

function InventoryRow({ row, qty, last }) {
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

export default function StoreSnapshotPanel({
  session,
  store,
  periodLabel = 'Today',
  txRows = [],
  onOpenTransaction,
  apps,
  onOpenApp,
}) {
  const storeName = store?.store || '';
  const { width: windowWidth } = useWindowDimensions();
  const isMobile = windowWidth < 768;
  const [query, setQuery] = useState('');
  const [cash, setCash] = useState(null);
  const [cashLoading, setCashLoading] = useState(false);
  const [cashError, setCashError] = useState('');
  const [openingCounts, setOpeningCounts] = useState({ cad: null, usd: null });
  const [todayCounts, setTodayCounts] = useState({ cad: null, usd: null });
  const [daySlips, setDaySlips] = useState([]);
  const [inventoryStores, setInventoryStores] = useState([]);
  const [inventoryRows, setInventoryRows] = useState([]);
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [inventoryError, setInventoryError] = useState('');
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
      setOpeningCounts({ cad: null, usd: null });
      setTodayCounts({ cad: null, usd: null });
      setDaySlips([]);
      setCashError('');
      return;
    }
    const id = ++cashRequestId.current;
    if (!silent) {
      setCashLoading(true);
      setCashError('');
    }
    try {
      const dateKey = formatDateParam(parseDateParam(new Date()));
      const previousDate = shiftDateParam(dateKey, -1);
      const [result, opening, today, slips] = await Promise.all([
        fetchStoreCashPosition(session, {
          storeName,
          date: dateKey,
        }),
        loadStoreCashCounts(storeName, previousDate).catch(() => ({
          cad: null,
          usd: null,
        })),
        loadStoreCashCounts(storeName, dateKey).catch(() => ({
          cad: null,
          usd: null,
        })),
        loadStoreDayTxnCashBreakdowns(storeName, dateKey).catch(() => []),
      ]);
      if (id !== cashRequestId.current) return;
      setCash(result);
      setOpeningCounts({
        cad: opening.cad || null,
        usd: opening.usd || null,
      });
      setTodayCounts({
        cad: today.cad || null,
        usd: today.usd || null,
      });
      setDaySlips(slips);
      setCashError('');
    } catch (err) {
      if (id !== cashRequestId.current) return;
      if (silent) return;
      setCash(null);
      setOpeningCounts({ cad: null, usd: null });
      setTodayCounts({ cad: null, usd: null });
      setDaySlips([]);
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
      setInventoryStores(cached.stores);
      setInventoryRows(cached.rows);
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
      setInventoryStores(result.stores);
      setInventoryRows(result.rows);
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

  useEffect(() => {
    setQuery('');
    setCash(null);
    setOpeningCounts({ cad: null, usd: null });
    setTodayCounts({ cad: null, usd: null });
    setDaySlips([]);
    setCashError('');
  }, [storeName]);

  useEffect(() => {
    loadCash();
  }, [loadCash]);

  useEffect(() => {
    loadInventory();
  }, [loadInventory]);

  useLiveRefresh(loadCash, AUREUS_CASH_LIVE_MS, Boolean(session?.token && storeName));
  useLiveRefresh(
    (opts) => loadInventory({ ...opts, force: true }),
    20_000,
    Boolean(session?.token && storeName),
  );

  useEffect(() => {
    if (!session?.token || !storeName) return undefined;
    const reload = () => {
      loadCash({ silent: true });
    };
    const unsubs = [
      subscribeStoreCashCounts(storeName, reload),
      subscribeStoreTxnCashBreakdowns(storeName, reload),
    ];
    return () => {
      for (const unsub of unsubs) unsub();
    };
  }, [session?.token, storeName, loadCash]);

  const storeColumns = useMemo(
    () => pickStoreColumns(inventoryStores, storeName),
    [inventoryStores, storeName],
  );
  const storeId = storeColumns[0]?.id;
  const searching = Boolean(query.trim());

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

  const priceChecks = useMemo(() => {
    const map = new Map();
    for (const row of txRows) {
      map.set(row.id, checkTransactionPrices(row, priceCatalog));
    }
    return map;
  }, [priceCatalog, txRows]);

  const visibleTx = useMemo(() => txRows.filter((row) => txMatches(row, query)), [txRows, query]);

  const visibleItems = useMemo(() => {
    if (!storeId) return [];
    return inventoryRows
      .map((row) => ({ row, qty: row.quantities[storeId] || 0 }))
      .filter(({ row, qty }) => (searching ? itemMatches(row, query) : qty !== 0));
  }, [inventoryRows, storeId, query, searching]);

  const tillMoves = useMemo(() => {
    const rows = [
      ...(cash?.cad?.cashTransactions || []),
      ...(cash?.usd?.cashTransactions || []),
    ];
    return rows.filter((row) => movementMatches(row, query));
  }, [cash, query]);

  const cashSlipRows = useMemo(() => [...txRows, ...tillMoves], [txRows, tillMoves]);
  const cashSlips = useTxnCashBreakdowns(cashSlipRows);

  const mergedSlips = useMemo(() => {
    const map = {};
    for (const row of daySlips) {
      if (row?.transactionId) map[row.transactionId] = row;
    }
    for (const [id, sheet] of Object.entries(cashSlips.byId)) {
      if (sheet?.hasCount) map[id] = sheet;
      else delete map[id];
    }
    return Object.values(map);
  }, [daySlips, cashSlips.byId]);

  const cadCompare = useMemo(
    () => buildDenomCompare('CAD', openingCounts.cad, todayCounts.cad, mergedSlips),
    [openingCounts.cad, todayCounts.cad, mergedSlips],
  );
  const usdCompare = useMemo(
    () => buildDenomCompare('USD', openingCounts.usd, todayCounts.usd, mergedSlips),
    [openingCounts.usd, todayCounts.usd, mergedSlips],
  );
  const showUsd =
    hasDrawerActivity(cash?.usd) || usdCompare.hasExpected || usdCompare.hasActual;
  const showApps = Array.isArray(apps) && typeof onOpenApp === 'function' && apps.length > 0;
  const txMeta = searching
    ? `${visibleTx.length} match${visibleTx.length === 1 ? '' : 'es'}`
    : `${periodLabel} · ${txRows.length}`;
  const itemMeta = searching
    ? `${visibleItems.length} match${visibleItems.length === 1 ? '' : 'es'}`
    : storeId
      ? `${visibleItems.length} in stock`
      : '';

  return (
    <View style={[styles.body, isMobile && styles.bodyMobile]}>
      <SearchField value={query} onChangeText={setQuery} />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <SectionHeader title="Cash" meta="Today" />
        {cashError ? (
          <Pressable onPress={loadCash}>
            <Group>
              <EmptyRow text={`${cashError} · Tap to retry`} />
            </Group>
          </Pressable>
        ) : cashLoading && !cash ? (
          <Group>
            <LoadingRow />
          </Group>
        ) : cash ? (
          <>
            <View style={styles.cashStack}>
              <CashDrawerCard drawer={cash.cad} compare={cadCompare} />
              {showUsd ? (
                <CashDrawerCard drawer={cash.usd} compare={usdCompare} />
              ) : null}
              {tillMoves.length > 0 ? (
                <Group flush>
                  {tillMoves.map((row, index) => (
                    <MovementRow
                      key={row.id}
                      row={row}
                      last={index === tillMoves.length - 1}
                      cashSaved={cashSlips.isSaved(row)}
                      onCashPress={cashSlips.openEditor}
                    />
                  ))}
                </Group>
              ) : null}
            </View>
          </>
        ) : (
          <Group>
            <EmptyRow text="No cash data for this store." />
          </Group>
        )}

        <SectionHeader title="Transactions" meta={txMeta} />
        <Group>
          {visibleTx.length === 0 ? (
            <EmptyRow
              text={
                searching
                  ? 'No matching transactions.'
                  : `No transactions ${periodLabel === 'Today' ? 'today' : 'in this period'}.`
              }
            />
          ) : (
            visibleTx.map((item, index) => (
              <TransactionRow
                key={item.id}
                item={item}
                last={index === visibleTx.length - 1}
                onPress={onOpenTransaction}
                cashSaved={cashSlips.isSaved(item)}
                onCashPress={cashSlips.openEditor}
                priceCheck={priceChecks.get(item.id)}
                onPricePress={setPriceReview}
              />
            ))
          )}
        </Group>

        <SectionHeader title="Inventory" meta={itemMeta} />
        {inventoryError && !hasInventoryRef.current ? (
          <Pressable onPress={loadInventory}>
            <Group>
              <EmptyRow text={`${inventoryError} · Tap to retry`} />
            </Group>
          </Pressable>
        ) : inventoryLoading && inventoryRows.length === 0 ? (
          <Group>
            <LoadingRow />
          </Group>
        ) : !storeId ? (
          <Group>
            <EmptyRow text={`No inventory data for ${storeName || 'this store'}.`} />
          </Group>
        ) : (
          <Group>
            {visibleItems.length === 0 ? (
              <EmptyRow text={searching ? 'No matching items.' : 'No stocked items.'} />
            ) : (
              visibleItems.map(({ row, qty }, index) => (
                <InventoryRow
                  key={row.id}
                  row={row}
                  qty={qty}
                  last={index === visibleItems.length - 1}
                />
              ))
            )}
          </Group>
        )}

        {showApps ? (
          <View style={styles.appsSection}>
            <SectionHeader title="Apps" />
            <Group>
              {apps.map((tab, index) => (
                <Pressable
                  key={tab.key}
                  onPress={() => onOpenApp(tab.key)}
                  style={({ hovered, pressed }) => [
                    styles.row,
                    index === apps.length - 1 && styles.rowLast,
                    (hovered || pressed) && styles.rowHovered,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={tab.label}
                >
                  <View
                    style={[
                      styles.appIcon,
                      { backgroundColor: tab.accent },
                    ]}
                  >
                    <Ionicons
                      name={
                        typeof tab.icon === 'string' && tab.icon.endsWith('-outline')
                          ? tab.icon.slice(0, -8)
                          : tab.icon
                      }
                      size={18}
                      color="#fff"
                    />
                  </View>
                  <Text style={styles.rowTitle}>{tab.label}</Text>
                  <Ionicons name="chevron-forward" size={16} color="#c7c7cc" />
                </Pressable>
              ))}
            </Group>
          </View>
        ) : null}
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

const styles = StyleSheet.create({
  body: {
    flex: 1,
    minHeight: 0,
    backgroundColor: '#f2f2f7',
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  bodyMobile: {
    paddingHorizontal: 16,
  },
  searchField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 36,
    marginBottom: 18,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: FILL,
  },
  searchInput: {
    flex: 1,
    fontFamily,
    fontSize: 17,
    fontWeight: '400',
    color: LABEL,
    paddingVertical: 8,
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
    paddingBottom: 40,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  sectionTitle: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: SECONDARY,
    letterSpacing: -0.08,
    textTransform: 'uppercase',
  },
  sectionMeta: {
    fontFamily,
    fontSize: 13,
    fontWeight: '500',
    color: SECONDARY,
    letterSpacing: -0.08,
  },
  group: {
    backgroundColor: '#fff',
    borderRadius: 14,
    overflow: 'hidden',
    marginBottom: 22,
  },
  groupFlush: {
    marginBottom: 0,
  },
  cashStack: {
    gap: 10,
    marginBottom: 22,
  },
  compareStack: {
    flexDirection: 'column',
  },
  compareBand: {
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  compareBandHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 12,
  },
  compareRule: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: SEPARATOR,
    alignSelf: 'stretch',
  },
  compareColTitle: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: SECONDARY,
    letterSpacing: -0.08,
  },
  compareColTotal: {
    fontFamily,
    fontSize: 17,
    fontWeight: '700',
    color: LABEL,
    letterSpacing: -0.3,
    fontVariant: ['tabular-nums'],
  },
  compareEmpty: {
    fontFamily,
    fontSize: 13,
    color: SECONDARY,
    letterSpacing: -0.08,
    marginTop: 4,
  },
  compareChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    marginTop: 6,
  },
  compareChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  compareChipTitle: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: LABEL,
    letterSpacing: -0.08,
  },
  compareChipCount: {
    fontFamily,
    fontSize: 13,
    fontWeight: '400',
    color: SECONDARY,
    letterSpacing: -0.08,
  },
  compareChipAmount: {
    fontFamily,
    fontSize: 13,
    fontWeight: '500',
    color: LABEL,
    letterSpacing: -0.08,
    fontVariant: ['tabular-nums'],
  },
  cashDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    flexShrink: 0,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 64,
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 10,
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
    fontSize: 17,
    fontWeight: '400',
    color: LABEL,
    letterSpacing: -0.2,
  },
  rowTitleStrong: {
    fontWeight: '600',
  },
  rowSubtitle: {
    fontFamily,
    fontSize: 13,
    color: SECONDARY,
    letterSpacing: -0.08,
    marginTop: 2,
  },
  rowAmountCol: {
    alignItems: 'flex-end',
    gap: 5,
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
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
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
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: -0.08,
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
    fontSize: 17,
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
    width: 36,
    height: 36,
    flexShrink: 0,
    position: 'relative',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  txThumb: {
    width: 36,
    height: 36,
    borderRadius: 8,
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
    width: 22,
    flexShrink: 0,
    fontSize: 12,
    fontWeight: '600',
    color: SO_BLUE,
    letterSpacing: -0.08,
  },
  kindBuy: {
    color: PO_AMBER,
  },
  priorityDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    flexShrink: 0,
  },
  priorityDotSpacer: {
    width: 8,
    flexShrink: 0,
  },
  emptyText: {
    fontFamily,
    flex: 1,
    fontSize: 15,
    color: SECONDARY,
    letterSpacing: -0.2,
  },
  loadingRow: {
    justifyContent: 'center',
    minHeight: 64,
  },
  appsSection: {
    marginTop: 6,
  },
  appIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
