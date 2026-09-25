import { createElement, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { fetchStoreCashPosition } from '../lib/cashTill';
import { checkTransactionPrices, formatPriceTolerance } from '../lib/priceCheck';
import {
  capturePurchasePriceCatalog,
  loadTransactionPriceSnapshots,
  peekPriceCatalogSnapshot,
  usePriceCheckTolerance,
} from '../lib/priceCheckSettings';
import { AUREUS_CASH_LIVE_MS, useLiveRefresh } from '../lib/liveRefresh';
import { fetchInventoryMatrix, formatQty, peekInventoryMatrix } from '../lib/inventory';
import { textMatchesQuery } from '../lib/itemSearch';
import { findStaffByEmployeeName, listStaffProfiles, useAppAccess } from '../lib/permissions';
import { initialsFor } from '../lib/rippling';
import {
  buildEmailCaptureByStore,
  formatAmount,
  formatDateParam,
  isCashTransaction,
  parseDateParam,
} from '../lib/transactions';
import { useTxnCashBreakdowns } from '../lib/txnCashBreakdowns';
import { callPartyLabel, callsForStore, fetchPhoneHistory, inboundCallRatio, isPhoneRateLimitMessage, mergeCallLog } from '../lib/phoneCalls';
import { formatPhoneNumber } from '../lib/ringcentral';
import { storeKeyFromName } from '../lib/storeSettings';
import { CANVAS, MOBILE_FILTER_INSET, MOBILE_FILTER_SIZE, useIsMobile } from '../lib/mobileUi';
import { activeCallKicker, formatCallClock, usePhoneCalls } from './PhoneCallProvider';
import { isConnectedStatus } from '../lib/callState';
import TxnCashBreakdownModal, { TxnCashIcon } from './TxnCashBreakdownModal';

const fontFamily = Platform.select({
  ios: 'Sohne',
  android: 'Sohne',
  default: 'Sohne',
});

const LABEL = '#1a1a1a';
const SECONDARY = '#8e8e93';
const FILL = 'rgba(118, 118, 128, 0.12)';
const SEPARATOR = '#d0d0d0';
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
  financials: { key: 'financials', label: 'Financials', icon: 'wallet-outline', accent: '#3D8B4F' },
  inventory: { key: 'inventory', label: 'Inventory', icon: 'cube-outline', accent: '#C47A12' },
  employees: { key: 'employees', label: 'Employees', icon: 'people-outline', accent: '#1D4ED8' },
  phone: { key: 'phone', label: 'Phone', icon: 'call-outline', accent: '#15803D' },
  emails: { key: 'emails', label: 'Emails', icon: 'mail-outline', accent: '#4338CA' },
  transactions: { key: 'transactions', label: 'Transactions', icon: 'swap-horizontal-outline', accent: '#2F6FED' },
};

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

function pickStoreColumns(stores, storeName) {
  const matches = (stores || []).filter((store) => namesMatch(store.name, storeName));
  if (matches.length <= 1) return matches;
  const linked = matches.find((store) => store.systemKey === 'gta' || store.systemKey === 'pmx');
  return [linked || matches[0]];
}

function InventorySearch({ value, onChangeText }) {
  return (
    <View style={styles.searchField}>
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
  );
}

function AppBox({ app, meta, onOpen, children, style, bodyStyle, muted = false }) {
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
        <View style={[styles.appBoxIcon, { backgroundColor: app.accent }, muted && styles.appIconMuted]}>
          <Ionicons name={filledIonicon(app.icon)} size={14} color="#fff" />
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

function DashStat({ value, label }) {
  return (
    <View style={styles.dashHeroStat}>
      <Text style={styles.dashHeroStatValue}>{value}</Text>
      <Text style={styles.dashHeroStatLabel}>{label}</Text>
    </View>
  );
}

function OverviewHero({ store, periodLabel, plain = false, onAmountLayout, filterSlotWidth = 0 }) {
  const total = Number(store?.totalAmount) || 0;
  const txCount = Number(store?.txCount) || 0;
  const saleCount = Number(store?.saleCount) || 0;
  const purchaseCount = Number(store?.purchaseCount) || 0;
  const empty = !total && !txCount;
  const txLabel = `${txCount} transaction${txCount === 1 ? '' : 's'}`;
  const label = `${periodLabel}, ${empty ? 'No total' : formatAmount(total)}, ${txLabel}`;

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

function DashSection({ title, meta, onPress, children }) {
  return (
    <View style={styles.dashSection}>
      <Pressable
        onPress={onPress}
        disabled={!onPress}
        style={styles.dashHead}
        accessibilityRole={onPress ? 'button' : undefined}
        accessibilityLabel={onPress ? `Open ${title}` : title}
      >
        <Text style={styles.dashHeadTitle}>{title}</Text>
        <View style={styles.dashHeadTrail}>
          {meta ? <Text style={styles.dashHeadMeta}>{meta}</Text> : null}
          {onPress ? <Ionicons name="chevron-forward" size={14} color={SECONDARY} /> : null}
        </View>
      </Pressable>
      <View style={styles.dashList}>{children}</View>
    </View>
  );
}

function DashLink({ app, value, meta, tone, onOpen, last, accessory, loading, muted = false }) {
  const valueColor =
    tone === 'low' ? styles.phoneRateLow : tone === 'high' ? styles.phoneRateHigh : null;

  return (
    <Pressable
      onPress={() => onOpen?.(app.key)}
      style={({ hovered, pressed }) => [
        styles.dashRow,
        (hovered || pressed) && styles.dashRowPressed,
      ]}
      accessibilityRole="button"
      accessibilityLabel={`${app.label}${value ? `, ${value}` : ''}${meta ? `, ${meta}` : ''}`}
    >
      <View style={[styles.dashIcon, { backgroundColor: app.accent }, muted && styles.appIconMuted]}>
        <Ionicons name={filledIonicon(app.icon)} size={14} color="#fff" />
      </View>
      <View style={[styles.dashRowBody, !last && styles.dashRowDivider]}>
        <View style={styles.dashCopy}>
          <Text style={styles.dashTitle} numberOfLines={1}>
            {app.label}
          </Text>
          {meta ? (
            <Text style={styles.dashMeta} numberOfLines={2}>
              {meta}
            </Text>
          ) : null}
          {accessory}
        </View>
        {loading ? (
          <ActivityIndicator size="small" color={BLUE} />
        ) : (
          <Text style={[styles.dashValue, valueColor]} numberOfLines={1}>
            {value || '—'}
          </Text>
        )}
        <Ionicons name="chevron-forward" size={18} color="#c7c7cc" />
      </View>
    </Pressable>
  );
}

function PeopleStack({ people = [], size = 28 }) {
  const visible = people.slice(0, 4);
  const extra = people.length - visible.length;
  if (!visible.length) return null;
  return (
    <View style={styles.peopleStack}>
      {visible.map((person, index) => (
        <View
          key={`${person.name}-${index}`}
          style={[
            styles.peopleStackItem,
            { marginLeft: index === 0 ? 0 : -10, zIndex: visible.length - index },
          ]}
        >
          <EmployeeAvatar person={person} size={size} ring />
        </View>
      ))}
      {extra > 0 ? <Text style={styles.peopleExtra}>+{extra}</Text> : null}
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

function EmployeeRow({ person, last, dashboard = false }) {
  const subtitle = person.txCount
    ? `${person.txCount} transaction${person.txCount === 1 ? '' : 's'} today`
    : person.role || 'Assigned to this store';
  return (
    <View style={[dashboard ? styles.dashPersonRow : styles.row, styles.rowStatic, last && styles.rowLast]}>
      <EmployeeAvatar person={person} size={dashboard ? 46 : 32} />
      <View style={styles.rowCopy}>
        <Text style={dashboard ? styles.dashTitle : styles.rowTitle} numberOfLines={1}>
          {person.name}
        </Text>
        <Text style={dashboard ? styles.dashMeta : styles.rowSubtitle} numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
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

function TxTableHeader() {
  return (
    <View style={styles.txTableHeader}>
      <View style={styles.colPhoto} />
      <View style={[styles.txTableRowBody, styles.homeTxHeaderRule]}>
        <Text style={[styles.homeTxHeaderLabel, styles.colDate]} numberOfLines={1}>
          Date
        </Text>
        <Text style={[styles.homeTxHeaderLabel, styles.colRef]} numberOfLines={1}>
          PO# / SO#
        </Text>
        <Text style={[styles.homeTxHeaderLabel, styles.colCustomer]} numberOfLines={1}>
          Customer
        </Text>
        <Text style={[styles.homeTxHeaderLabel, styles.colPayment]} numberOfLines={1}>
          Payment
        </Text>
        <Text style={[styles.homeTxHeaderLabel, styles.colAmount]} numberOfLines={1}>
          Amount
        </Text>
        <Text style={[styles.homeTxHeaderLabel, styles.colEmployee]} numberOfLines={1}>
          Employee
        </Text>
      </View>
    </View>
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
  employeePerson,
  onAmountHover,
  stacked = false,
}) {
  const [splitTip, setSplitTip] = useState('');
  const [splitAnchor, setSplitAnchor] = useState(null);
  const isBuy = item.type === 'purchase';
  const items = itemSnapshotLabel(item);
  const employee = String(item.employeeName || employeePerson?.name || '').trim();
  const showCash = typeof onCashPress === 'function' && isCashTransaction(item);
  const hoverPerson = employeePerson || { name: employee || '—', photoUrl: '' };
  const photos = Array.isArray(item.imageUrls) ? item.imageUrls.filter(Boolean) : [];
  const when = [item.dateLabel, item.timeLabel].filter(Boolean).join(' · ');
  const reference = String(item.reference || '').trim();
  const refLabel = /\b(SO|PO)\b/i.test(reference)
    ? reference
    : `${isBuy ? 'PO' : 'SO'}${reference ? ` ${reference}` : ''}`;
  const meta = [refLabel, when, item.paymentMethodLabel]
    .filter((part) => part && part !== '—')
    .join(' · ');

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
        <View style={styles.mobileTxThumb}>
          {photos.length ? (
            <TxnPhotoThumb urls={photos} label={item.reference || (isBuy ? 'PO' : 'SO')} size={44} />
          ) : (
            <View style={[styles.mobileTxKind, isBuy && styles.mobileTxKindBuy]}>
              <Text style={[styles.mobileTxKindText, isBuy && styles.mobileTxKindTextBuy]}>
                {isBuy ? 'PO' : 'SO'}
              </Text>
            </View>
          )}
        </View>
        <View style={styles.mobileTxCopy}>
          <View style={styles.mobileTxTop}>
            <Text style={styles.mobileTxCustomer} numberOfLines={1}>
              {item.customerName || '—'}
            </Text>
            <View style={styles.mobileTxAmount} {...splitHover}>
              {showCash ? (
                <TxnCashIcon saved={cashSaved} onPress={() => onCashPress(item)} />
              ) : null}
              <Text style={styles.mobileTxAmountText} numberOfLines={1}>
                {item.amountLabel || '—'}
              </Text>
            </View>
          </View>
          {meta ? (
            <Text style={styles.mobileTxMeta} numberOfLines={1}>
              {meta}
            </Text>
          ) : null}
          {items ? (
            <Text style={styles.mobileTxItems} numberOfLines={2}>
              {items}
            </Text>
          ) : null}
          <View style={styles.mobileTxFooter}>
            <PriceCheckBadge check={priceCheck} onPress={() => onPricePress?.(priceCheck)} />
            {employee && employee !== '—' ? (
              <View style={styles.mobileTxEmployee}>
                <EmployeeAvatar person={hoverPerson} size={18} />
                <Text style={styles.mobileTxEmployeeName} numberOfLines={1}>
                  {employee}
                </Text>
              </View>
            ) : null}
          </View>
        </View>
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={() => onPress?.(item)}
      style={({ hovered, pressed }) => [
        styles.txTableRow,
        last && styles.rowLast,
        (hovered || pressed) && styles.homeTxRowHovered,
      ]}
      accessibilityRole="button"
      accessibilityLabel={`${isBuy ? 'PO' : 'SO'} ${item.customerName || ''} ${item.amountLabel || ''}`}
    >
      <View style={styles.colPhoto}>
        <TxnPhotoThumb urls={item.imageUrls} label={item.reference || (isBuy ? 'PO' : 'SO')} />
      </View>
      <View style={[styles.txTableRowBody, !last && styles.txTableRowDivider]}>
        <View style={styles.colDate}>
          <Text style={[styles.txCell, styles.txCellPrimary]} numberOfLines={1}>
            {item.dateLabel || '—'}
          </Text>
          {item.timeLabel ? (
            <Text style={[styles.txCell, styles.txCellSecondary, styles.txTimeUnder]} numberOfLines={1}>
              {item.timeLabel}
            </Text>
          ) : null}
        </View>
        <Text style={[styles.txCell, styles.txCellSecondary, styles.colRef]} numberOfLines={1}>
          {item.reference || '—'}
        </Text>
        <Text style={[styles.txCell, styles.txCellPrimary, styles.colCustomer]} numberOfLines={1}>
          {item.customerName || '—'}
        </Text>
        <View style={styles.colPayment} {...splitHover}>
          <Text style={styles.txCell} numberOfLines={1}>
            {item.paymentMethodLabel || '—'}
          </Text>
        </View>
        <View style={[styles.txAmount, styles.colAmount]} {...splitHover}>
          {showCash ? (
            <TxnCashIcon saved={cashSaved} onPress={() => onCashPress(item)} />
          ) : null}
          <Text style={styles.rowValue}>{item.amountLabel}</Text>
        </View>
        <View style={[styles.colEmployee, styles.txEmployee]}>
          <EmployeeAvatar person={hoverPerson} size={24} />
          <Text style={[styles.txCell, styles.txCellSecondary]} numberOfLines={1}>
            {employee || '—'}
          </Text>
        </View>
      </View>
      <FloatingTooltip
        visible={Boolean(splitAnchor && splitTip)}
        text={splitTip}
        anchorEl={splitAnchor}
        align="end"
      />
    </Pressable>
  );
});

const InventoryRow = memo(function InventoryRow({ row, qty, last, dashboard = false }) {
  return (
    <View style={[dashboard ? styles.dashPersonRow : styles.row, styles.rowStatic, last && styles.rowLast]}>
      {row.priority ? (
        <View style={[styles.priorityDot, { backgroundColor: PRIORITY_COLORS[row.priority] }]} />
      ) : (
        <View style={dashboard ? null : styles.priorityDotSpacer} />
      )}
      <View style={styles.rowCopy}>
        <Text style={dashboard ? styles.dashTitle : styles.rowTitle} numberOfLines={1}>
          {row.name}
        </Text>
        {row.sku ? (
          <Text style={dashboard ? styles.dashMeta : styles.rowSubtitle} numberOfLines={1}>
            {row.sku}
          </Text>
        ) : null}
      </View>
      <Text style={[dashboard ? styles.dashValue : styles.rowValue, qty === 0 && styles.rowValueMuted]}>
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

function callsInRange(calls, startKey, endKey) {
  if (!startKey || !endKey) return Array.isArray(calls) ? calls : [];
  return (Array.isArray(calls) ? calls : []).filter((call) => {
    const time = Date.parse(call.startTime);
    if (!Number.isFinite(time)) return false;
    const day = formatDateParam(new Date(time));
    return day >= startKey && day <= endKey;
  });
}

function PhoneIncomingRow({ call, busy, onAnswer, onReject, last }) {
  const label = callPartyLabel(call, { formatPhone: formatPhoneNumber });
  return (
    <View style={[styles.phoneLiveRow, last && styles.rowLast]}>
      <View style={styles.rowCopy}>
        <Text style={styles.phoneLiveKicker}>Incoming</Text>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {label}
        </Text>
      </View>
      <View style={styles.phoneLiveActions}>
        <Pressable
          onPress={() => onReject(call)}
          disabled={busy}
          style={[styles.phoneLiveBtn, styles.phoneRejectBtn]}
          accessibilityRole="button"
          accessibilityLabel="Reject call"
        >
          <Text style={styles.phoneLiveBtnText}>Reject</Text>
        </Pressable>
        <Pressable
          onPress={() => onAnswer(call)}
          disabled={busy}
          style={[styles.phoneLiveBtn, styles.phoneAnswerBtn]}
          accessibilityRole="button"
          accessibilityLabel="Answer call"
        >
          {busy ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.phoneLiveBtnText}>Answer</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

function PhoneActiveRow({ call, busy, muted, audioState, onMute, onHangup, onEnableSound, last }) {
  const label = callPartyLabel(call, { formatPhone: formatPhoneNumber });
  const connected = isConnectedStatus(call.status);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!connected) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [connected]);
  const since = call.answeredAt || Date.parse(call.startTime) || now;
  return (
    <View style={[styles.phoneLiveRow, styles.phoneActiveRow, last && styles.rowLast]}>
      <View style={styles.rowCopy}>
        <Text style={styles.phoneLiveKicker}>
          {activeCallKicker(call)}
          {connected ? ` · ${formatCallClock(now - since)}` : ' · Connecting…'}
        </Text>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {label}
        </Text>
        {audioState === 'blocked' ? (
          <Text style={styles.phoneError}>The browser blocked the call audio. Tap Sound to hear the caller.</Text>
        ) : null}
      </View>
      <View style={styles.phoneLiveActions}>
        {audioState === 'blocked' ? (
          <Pressable
            onPress={onEnableSound}
            style={[styles.phoneLiveBtn, styles.phoneSoundBtn]}
            accessibilityRole="button"
            accessibilityLabel="Enable sound for this call"
          >
            <Text style={[styles.phoneLiveBtnText, styles.phoneSoundBtnText]}>Sound</Text>
          </Pressable>
        ) : call.web ? (
          <Pressable
            onPress={onMute}
            disabled={busy || !connected}
            style={[styles.phoneLiveBtn, styles.phoneMuteBtn, muted && styles.phoneMuteBtnOn]}
            accessibilityRole="button"
            accessibilityLabel={muted ? 'Unmute microphone' : 'Mute microphone'}
          >
            <Text style={[styles.phoneLiveBtnText, styles.phoneMuteBtnText]}>{muted ? 'Unmute' : 'Mute'}</Text>
          </Pressable>
        ) : null}
        <Pressable
          onPress={onHangup}
          disabled={busy}
          style={[styles.phoneLiveBtn, styles.phoneRejectBtn]}
          accessibilityRole="button"
          accessibilityLabel="Hang up"
        >
          {busy ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.phoneLiveBtnText}>Hang up</Text>}
        </Pressable>
      </View>
    </View>
  );
}

function PhoneSnapshotBody({ storeName, startKey, endKey, periodLabel, calls = null }) {
  const phone = usePhoneCalls();
  const storeKey = storeKeyFromName(storeName);
  const activeCall = phone.activeCall && phone.activeCall.storeKey === storeKey ? phone.activeCall : null;
  const incoming = useMemo(
    () =>
      (phone.incoming || []).filter(
        (call) => call.storeKey === storeKey && call.id !== phone.activeCall?.id,
      ),
    [phone.activeCall?.id, phone.incoming, storeKey],
  );
  const recentAnswered = useMemo(
    () => (phone.recentAnswered || []).filter((row) => row.storeKey === storeKey),
    [phone.recentAnswered, storeKey],
  );
  const ratio = useMemo(() => {
    if (calls) return inboundCallRatio(calls);
    return inboundCallRatio(callsInRange(callsForStore(phone.mergedCallsByStore, storeName), startKey, endKey));
  }, [calls, endKey, phone.mergedCallsByStore, startKey, storeName]);
  const inboxLoading = Boolean(phone.inboxFetching?.[storeKey]);
  const phoneError = isPhoneRateLimitMessage(phone.error) ? '' : phone.error;

  const answer = async (call) => {
    try {
      await phone.answer(call);
    } catch {
      // Error is shown from phone context.
    }
  };
  const reject = async (call) => {
    try {
      await phone.reject(call);
    } catch {
      // Keep the live row so they can retry.
    }
  };
  const hangUp = async () => {
    try {
      await phone.hangup(activeCall);
    } catch {
      // Error is shown from phone context.
    }
  };
  const enableSound = () => {
    phone.resumeAudio?.().catch?.(() => {});
  };

  if (incoming.length || activeCall) {
    return (
      <>
        {activeCall ? (
          <PhoneActiveRow
            call={activeCall}
            busy={phone.busy}
            muted={phone.muted}
            audioState={phone.audioState}
            onMute={phone.toggleMute}
            onHangup={hangUp}
            onEnableSound={enableSound}
            last={!incoming.length && !ratio.total && !phoneError}
          />
        ) : null}
        {incoming.map((call, index) => (
          <PhoneIncomingRow
            key={`${call.storeKey}-${call.id}`}
            call={call}
            busy={phone.busy}
            onAnswer={answer}
            onReject={reject}
            last={index === incoming.length - 1 && !ratio.total && !phoneError}
          />
        ))}
        {phoneError ? (
          <Text style={styles.phoneError}>{phoneError}</Text>
        ) : ratio.total ? (
          <Text style={[styles.phoneRateMeta, styles.phoneRateMetaPad]}>
            {ratio.ratio} answered · {periodLabel}
          </Text>
        ) : null}
      </>
    );
  }

  if (inboxLoading && !ratio.total && !recentAnswered.length) {
    return <LoadingRow />;
  }

  return (
    <View style={styles.phoneIdle}>
      {recentAnswered.map((row) => (
        <Text key={row.id} style={styles.phoneAnswered} numberOfLines={1}>
          Answered{row.label ? ` · ${row.label}` : ''}
        </Text>
      ))}
      <Text
        style={[
          styles.phoneRateValue,
          ratio.rate == null && styles.rowValueMuted,
          ratio.rate != null && ratio.rate < 80 && styles.phoneRateLow,
          ratio.rate != null && ratio.rate >= 80 && styles.phoneRateHigh,
        ]}
      >
        {ratio.ratio}
      </Text>
      <Text style={styles.phoneRateMeta}>
        {ratio.total
          ? `${ratio.answered} answered · ${ratio.missed} missed · ${periodLabel}`
          : `No inbound calls ${periodLabel === 'Today' ? 'today' : 'in this period'}.`}
      </Text>
      {phoneError ? <Text style={styles.phoneError}>{phoneError}</Text> : null}
    </View>
  );
}

function storeEmailCapture(txRows, storeName) {
  const rows = buildEmailCaptureByStore(Array.isArray(txRows) ? txRows : []);
  if (!rows.length) return null;
  return rows.find((row) => namesMatch(row.store, storeName)) || (rows.length === 1 ? rows[0] : null);
}

function EmailsSnapshotBody({ storeName, txRows, periodLabel, ready }) {
  const capture = useMemo(() => storeEmailCapture(txRows, storeName), [storeName, txRows]);
  const missing = useMemo(
    () => (capture?.people || []).filter((person) => !person.hasEmail),
    [capture],
  );
  const periodText = periodLabel === 'Today' ? 'today' : 'in this period';

  if (!ready && !capture) return <LoadingRow />;

  if (!capture || capture.totalTransactions === 0) {
    return <EmptyRow text={`No customers ${periodText}.`} />;
  }

  return (
    <>
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
  onHeaderStats,
  desktopHeader = null,
}) {
  const storeName = store?.store || '';
  const isMobile = useIsMobile();
  const { hasApp } = useAppAccess();
  const phone = usePhoneCalls();
  const showPhone = hasApp('phone');
  const showEmails = hasApp('emails');
  const showFinancials = hasApp('financials');
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
  const [txCatalogs, setTxCatalogs] = useState(() => new Map());
  const [priceReview, setPriceReview] = useState(null);
  const tolerance = usePriceCheckTolerance();
  const onFilterTopRef = useRef(onFilterTop);
  onFilterTopRef.current = onFilterTop;
  const heroYRef = useRef(0);
  const amountRowRef = useRef(null);
  const emitFilterTop = useCallback(() => {
    const row = amountRowRef.current;
    if (!row || !onFilterTopRef.current) return;
    onFilterTopRef.current(heroYRef.current + row.y + (row.height - MOBILE_FILTER_SIZE) / 2);
  }, []);
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

  const employeeMeta = presentEmployees.length
    ? `${presentEmployees.length} here`
    : 'Now';

  const storeKey = storeKeyFromName(storeName);
  const [historyCalls, setHistoryCalls] = useState([]);
  const incomingCalls = useMemo(
    () => (phone.incoming || []).filter((call) => call.storeKey === storeKey),
    [phone.incoming, storeKey],
  );
  useEffect(() => {
    if (!storeName || !startKey || !endKey) {
      setHistoryCalls([]);
      return undefined;
    }
    let cancelled = false;
    const dateFrom = parseDateParam(startKey);
    const dateTo = parseDateParam(endKey);
    dateTo.setDate(dateTo.getDate() + 1);
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
  const phoneRatio = useMemo(() => inboundCallRatio(phoneCalls), [phoneCalls]);
  const emailCapture = useMemo(
    () => storeEmailCapture(txRows, storeName),
    [storeName, txRows],
  );

  useEffect(() => {
    if (!onHeaderStats) return;
    const emailEmpty = !emailCapture || emailCapture.customerCount === 0;
    onHeaderStats({
      email: showEmails
        ? {
            ratio: emailEmpty ? '—' : `${Math.round(emailCapture.rate)}%`,
            tone: emailEmpty ? null : emailCapture.rate < 80 ? 'low' : 'high',
          }
        : null,
      phone: showPhone
        ? {
            ratio: phoneRatio.rate == null ? '—' : phoneRatio.ratio,
            tone: phoneRatio.rate == null ? null : phoneRatio.rate < 80 ? 'low' : 'high',
          }
        : null,
      people: presentEmployees,
      till: showFinancials
        ? {
            amount:
              cashLoading && !cash
                ? '…'
                : cash
                  ? formatAmount(cash.cad?.aureusOnHand ?? cash.cad?.expectedOnHand ?? 0, 'CAD')
                  : cashError || '—',
          }
        : null,
    });
  }, [
    cash,
    cashError,
    cashLoading,
    emailCapture,
    onHeaderStats,
    phoneRatio,
    presentEmployees,
    showEmails,
    showFinancials,
    showPhone,
  ]);

  const missingEmails = useMemo(
    () => (emailCapture?.people || []).filter((person) => !person.hasEmail),
    [emailCapture],
  );
  const cadAmt = cash?.cad?.aureusOnHand ?? cash?.cad?.expectedOnHand ?? 0;
  const usdAmt = cash?.usd?.aureusOnHand ?? cash?.usd?.expectedOnHand ?? 0;
  const showUsd = Math.abs(usdAmt) >= 0.005 || hasDrawerActivity(cash?.usd);
  const cadMoved = Math.abs(cash?.cad?.movementNet || 0) >= 0.005;
  const cashMeta = cash
    ? [
        showUsd ? `USD ${formatAmount(usdAmt, 'USD')}` : 'CAD till',
        `Open ${formatAmount(cash.cad?.openingBalance, 'CAD')}`,
        cadMoved ? `Today ${formatAmount(cash.cad.movementNet, 'CAD')}` : '',
      ]
        .filter(Boolean)
        .join(' · ')
    : cashError || 'Till';
  const emailMeta = !emailCapture || emailCapture.customerCount === 0
    ? `${emailCapture?.walkInCount || 0} walk-in`
    : `${emailCapture.withEmail} of ${emailCapture.customerCount} named`;
  const visibleMissing = missingEmails.slice(0, 4);
  const hiddenMissing = missingEmails.length - visibleMissing.length;

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
          dashboard={isMobile}
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
      <ExpectedCash cad={cash.cad} usd={cash.usd} />
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
        dashboard={isMobile}
        last={index === presentEmployees.length - 1}
      />
    ))
  );

  const mappedTxRows =
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
          employeePerson={employeePersonForTx(item, employeesByName, staff)}
          onAmountHover={onAmountHover}
          stacked={isMobile}
        />
      ))
    );

  const transactionsBody = isMobile ? (
    mappedTxRows
  ) : (
    <ScrollView
      horizontal
      nestedScrollEnabled
      showsHorizontalScrollIndicator={false}
      style={styles.txTableScroll}
      contentContainerStyle={styles.txTableScrollContent}
    >
      <View style={styles.txTable}>
        <TxTableHeader />
        {mappedTxRows}
      </View>
    </ScrollView>
  );

  const metricRows = [
    {
      app: SNAPSHOT_APPS.financials,
      value: cash ? formatAmount(cadAmt, 'CAD') : '—',
      meta: cashMeta,
      loading: cashLoading && !cash,
    },
  ];

  const mobileContent = (
    <>
      <View
        onLayout={(event) => {
          heroYRef.current = event.nativeEvent.layout.y;
          emitFilterTop();
        }}
      >
        <OverviewHero
          store={store}
          periodLabel={periodLabel}
          plain
          filterSlotWidth={filterSlotWidth}
          onAmountLayout={(row) => {
            amountRowRef.current = row;
            emitFilterTop();
          }}
        />
      </View>

      <View style={[styles.dashList, styles.dashListLead]}>
        {metricRows.map((row, index) => (
          <DashLink
            key={row.app.key}
            app={row.app}
            value={row.value}
            meta={row.meta}
            tone={row.tone}
            muted={row.muted}
            loading={row.loading}
            accessory={row.accessory}
            onOpen={onOpenApp}
            last={index === metricRows.length - 1}
          />
        ))}
      </View>

      <DashSection title="Transactions" meta={txMeta} onPress={() => onOpenApp?.('transactions')}>
        {transactionsBody}
      </DashSection>

      <DashSection title="Inventory" meta={itemMeta} onPress={() => onOpenApp?.('inventory')}>
        <InventorySearch value={inventoryQuery} onChangeText={setInventoryQuery} />
        {inventoryBody}
      </DashSection>
    </>
  );

  const desktopContent = (
    <>
      {desktopHeader}
      <View style={styles.homeTxTable}>
        <TxTableHeader />
        {txRows.length === 0 ? (
          <Text style={styles.homeTxEmpty}>
            {`No transactions ${periodLabel === 'Today' ? 'today' : 'in this period'}.`}
          </Text>
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
              employeePerson={employeePersonForTx(item, employeesByName, staff)}
              onAmountHover={onAmountHover}
            />
          ))
        )}
      </View>
    </>
  );

  return (
    <View style={[styles.body, isMobile && styles.bodyMobile]}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          isMobile && styles.scrollContentMobile,
          {
            paddingTop: isMobile ? topInset + 8 : desktopHeader ? 0 : 8,
            paddingBottom: isMobile ? 104 : 32,
          },
        ]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {isMobile ? mobileContent : desktopContent}
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
    prev.onHeaderStats === next.onHeaderStats &&
    prev.desktopHeader === next.desktopHeader,
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
    backgroundColor: '#fff',
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
    marginTop: 8,
  },
  dashHead: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    marginTop: 12,
    marginBottom: 8,
  },
  dashHeadTitle: {
    fontFamily,
    fontSize: 13,
    fontWeight: '400',
    color: SECONDARY,
    letterSpacing: -0.08,
    textTransform: 'uppercase',
  },
  dashHeadTrail: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  dashHeadMeta: {
    fontFamily,
    fontSize: 13,
    color: SECONDARY,
    letterSpacing: -0.08,
    fontVariant: ['tabular-nums'],
  },
  dashList: {
    backgroundColor: '#fff',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(60,60,67,0.18)',
  },
  dashListLead: {
    marginTop: 8,
  },
  dashRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 72,
    backgroundColor: '#fff',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  dashRowPressed: {
    backgroundColor: 'rgba(60,60,67,0.08)',
  },
  dashIcon: {
    width: 22,
    height: 22,
    borderRadius: 6,
    marginLeft: 16,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  dashRowBody: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    alignSelf: 'stretch',
    paddingVertical: 14,
    paddingRight: 16,
  },
  dashRowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(60,60,67,0.24)',
  },
  dashCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
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
    backgroundColor: '#fff',
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
  metricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  metricTile: {
    flexGrow: 1,
    flexBasis: '47%',
    minWidth: 148,
    backgroundColor: '#fff',
    borderRadius: 16,
    overflow: 'hidden',
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 14,
    gap: 6,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  metricTilePressed: {
    backgroundColor: '#f7f7f8',
  },
  metricHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  metricIcon: {
    width: 22,
    height: 22,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  metricTitle: {
    fontFamily,
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    fontWeight: '600',
    color: LABEL,
    letterSpacing: -0.08,
  },
  metricValue: {
    fontFamily,
    fontSize: 26,
    fontWeight: '700',
    color: LABEL,
    letterSpacing: -0.6,
    fontVariant: ['tabular-nums'],
  },
  metricMeta: {
    fontFamily,
    fontSize: 12,
    lineHeight: 16,
    color: SECONDARY,
    letterSpacing: -0.04,
  },
  metricSpinner: {
    alignSelf: 'flex-start',
    marginVertical: 8,
  },
  peopleStack: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  peopleStackItem: {
    borderRadius: 16,
  },
  peopleExtra: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: SECONDARY,
    marginLeft: 6,
  },
  employeeAvatarRing: {
    borderWidth: 2,
    borderColor: '#fff',
  },
  mobileTxRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingLeft: 16,
    paddingRight: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(60,60,67,0.24)',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  mobileTxThumb: {
    width: 44,
    height: 44,
    flexShrink: 0,
  },
  mobileTxKind: {
    width: 44,
    height: 44,
    borderRadius: 10,
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
  mobileTxCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  mobileTxTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  mobileTxCustomer: {
    fontFamily,
    flex: 1,
    minWidth: 0,
    fontSize: 17,
    fontWeight: '600',
    color: LABEL,
    letterSpacing: -0.3,
  },
  mobileTxAmount: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexShrink: 0,
  },
  mobileTxAmountText: {
    fontFamily,
    fontSize: 17,
    fontWeight: '600',
    color: LABEL,
    letterSpacing: -0.3,
    fontVariant: ['tabular-nums'],
  },
  mobileTxMeta: {
    fontFamily,
    fontSize: 13,
    color: SECONDARY,
    letterSpacing: -0.08,
  },
  mobileTxItems: {
    fontFamily,
    fontSize: 13,
    lineHeight: 18,
    color: SECONDARY,
    letterSpacing: -0.08,
  },
  mobileTxFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginTop: 4,
  },
  mobileTxEmployee: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
    minWidth: 0,
  },
  mobileTxEmployeeName: {
    fontFamily,
    fontSize: 12,
    color: SECONDARY,
    letterSpacing: -0.04,
    flexShrink: 1,
  },
  appRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    flexWrap: 'wrap',
    gap: 12,
  },
  appRowMobile: {
    flexDirection: 'column',
  },
  appRowBox: {
    flex: 1,
    minWidth: 220,
    minHeight: 200,
  },
  appRowBoxDesktop: {
    height: 280,
    maxHeight: 280,
    minHeight: 280,
  },
  appBox: {
    backgroundColor: '#fff',
    borderRadius: 8,
    overflow: 'hidden',
    flexDirection: 'column',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: SEPARATOR,
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
    width: 22,
    height: 22,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  appIconMuted: {
    opacity: 0.38,
  },
  appBoxHeadCopy: {
    flex: 1,
    minWidth: 0,
  },
  appBoxTitle: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: LABEL,
    letterSpacing: 0,
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
  txTableScroll: {
    flexGrow: 0,
  },
  txTableScrollContent: {
    flexGrow: 1,
    minWidth: '100%',
  },
  txTable: {
    width: '100%',
  },
  tillRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 8,
    paddingVertical: 8,
    marginBottom: 8,
    alignSelf: 'flex-start',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  tillRowHovered: {
    opacity: 0.72,
  },
  tillAmount: {
    fontFamily,
    fontSize: 22,
    fontWeight: '600',
    color: LABEL,
    letterSpacing: -0.4,
    fontVariant: ['tabular-nums'],
  },
  tillLabel: {
    fontFamily,
    fontSize: 13,
    color: SECONDARY,
  },
  homeTxTable: {
    alignSelf: 'stretch',
    width: '100%',
  },
  homeTxHeader: {
    backgroundColor: 'transparent',
    minHeight: 36,
    paddingLeft: 8,
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
  homeTxHeaderRule: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: SEPARATOR,
  },
  homeTxEmpty: {
    fontFamily,
    fontSize: 13,
    color: SECONDARY,
    paddingHorizontal: 8,
    paddingVertical: 28,
  },
  homeTxRowHovered: {
    backgroundColor: '#f5f5f5',
  },
  txTableHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 36,
    paddingLeft: 8,
    backgroundColor: 'transparent',
  },
  txTableHeaderLabel: {
    fontFamily,
    fontSize: 13,
    fontWeight: '400',
    color: SECONDARY,
    letterSpacing: -0.08,
    flexShrink: 1,
  },
  txTableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 64,
    paddingLeft: 8,
    ...Platform.select({
      web: {
        cursor: 'pointer',
        transitionProperty: 'background-color',
        transitionDuration: '120ms',
      },
      default: {},
    }),
  },
  txTableRowBody: {
    flex: 1,
    minWidth: 0,
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginLeft: 12,
    paddingRight: 16,
  },
  txTableRowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: SEPARATOR,
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
  txTimeUnder: {
    fontSize: 12,
    marginTop: 1,
  },
  txRef: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minWidth: 0,
  },
  txAmount: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 6,
    minWidth: 0,
  },
  colPhoto: {
    width: 36,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  colDate: {
    flex: 1.1,
    minWidth: 0,
    justifyContent: 'center',
  },
  colTime: {
    flex: 0.75,
    minWidth: 0,
  },
  colRef: {
    flex: 1.2,
    minWidth: 0,
  },
  colCustomer: {
    flex: 1.8,
    minWidth: 0,
  },
  colItems: {
    flex: 2.2,
    minWidth: 0,
  },
  colPayment: {
    flex: 1.2,
    minWidth: 0,
  },
  colAmount: {
    flex: 1.15,
    minWidth: 0,
    justifyContent: 'flex-end',
    textAlign: 'right',
  },
  colEmployee: {
    flex: 1.6,
    minWidth: 0,
  },
  txEmployee: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minWidth: 0,
  },
  colCheck: {
    flex: 1.1,
    minWidth: 0,
    alignItems: 'flex-end',
    textAlign: 'right',
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
  scrollContent: {
    paddingBottom: 32,
    gap: 12,
  },
  scrollContentMobile: {
    gap: 0,
    backgroundColor: '#fff',
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
  phoneLiveRow: {
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#ECFDF5',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#BBF7D0',
  },
  phoneLiveKicker: {
    fontFamily,
    fontSize: 11,
    fontWeight: '700',
    color: '#15803D',
    letterSpacing: 0.2,
    textTransform: 'uppercase',
  },
  phoneLiveActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
  },
  phoneLiveBtn: {
    flex: 1,
    minHeight: 32,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  phoneRejectBtn: {
    backgroundColor: '#B91C1C',
  },
  phoneAnswerBtn: {
    backgroundColor: '#15803D',
  },
  phoneActiveRow: {
    backgroundColor: '#F0FDF4',
  },
  phoneMuteBtn: {
    backgroundColor: '#E5E7EB',
  },
  phoneMuteBtnOn: {
    backgroundColor: '#FDE68A',
  },
  phoneMuteBtnText: {
    color: '#1a1a1a',
  },
  phoneSoundBtn: {
    backgroundColor: '#FCD34D',
  },
  phoneSoundBtnText: {
    color: '#1a1a1a',
  },
  phoneLiveBtnText: {
    fontFamily,
    fontSize: 13,
    fontWeight: '700',
    color: '#fff',
  },
  phoneIdle: {
    paddingHorizontal: 14,
    paddingVertical: 16,
    gap: 4,
  },
  phoneRateValue: {
    fontFamily,
    fontSize: 28,
    fontWeight: '700',
    color: LABEL,
    letterSpacing: -0.6,
    fontVariant: ['tabular-nums'],
  },
  phoneRateLow: {
    color: '#B91C1C',
  },
  phoneRateHigh: {
    color: '#15803D',
  },
  phoneRateMeta: {
    fontFamily,
    fontSize: 12,
    color: SECONDARY,
    letterSpacing: -0.04,
  },
  phoneAnswered: {
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
    color: '#15803D',
  },
  phoneError: {
    fontFamily,
    fontSize: 12,
    color: RED,
    paddingHorizontal: 14,
    paddingBottom: 10,
  },
  phoneRateMetaPad: {
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 12,
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
