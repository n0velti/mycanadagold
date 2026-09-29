import { cloneElement, createElement, isValidElement, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ActivityIndicator,
  Animated,
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
import { fetchStoreCashPosition, peekStoreCashPosition } from '../lib/cashTill';
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
import {
  callsForStore,
  fetchPhoneHistory,
  formatCallWhen,
  formatDuration,
  inboundCallRatio,
  mergeCallLog,
  peekPhoneHistory,
  phoneHistoryNeeded,
  resultLabel,
} from '../lib/phoneCalls';
import { storeKeyFromName } from '../lib/storeSettings';
import { CANVAS, MOBILE_FILTER_INSET, MOBILE_FILTER_SIZE, useIsMobile } from '../lib/mobileUi';
import { usePhoneCalls } from './PhoneCallProvider';
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
  reviews: { key: 'reviews', label: 'Reviews', icon: 'star-outline', accent: '#A16207' },
  transactions: { key: 'transactions', label: 'Transactions', icon: 'swap-horizontal-outline', accent: '#2F6FED' },
  preorders: { key: 'preorders', label: 'Preorders', icon: 'cart-outline', accent: '#EA580C' },
  audit: { key: 'audit', label: 'Audit', icon: 'clipboard-outline', accent: '#2F8A4E' },
  supplies: { key: 'supplies', label: 'Supplies', icon: 'bag-handle-outline', accent: '#BE123C' },
  settings: { key: 'settings', label: 'Settings', icon: 'settings-outline', accent: '#52525B' },
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

function DashPinnedApp({ app, value, onOpen, compact = false, roomy = false, selected = false }) {
  return (
    <Pressable
      onPress={() => onOpen?.(app.key)}
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
        <Text style={styles.dashPinnedAppLabel} numberOfLines={1}>
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

function DashSection({ title, meta, onPress, children, style, headStyle, app, fill = false, grab = false, panHandlers, ...rest }) {
  return (
    <View style={[styles.dashSection, fill && styles.dashSectionFill, style]} {...rest}>
      <View {...(grab ? panHandlers : null)} style={grab ? styles.dashSheetHandle : null}>
        {grab ? <View style={styles.dashSheetGrabPill} /> : null}
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
          <Text style={app ? styles.dashHeadTitleCard : styles.dashHeadTitle}>{title}</Text>
        </View>
        <View style={styles.dashHeadTrail}>
          {meta ? <Text style={styles.dashHeadMeta}>{meta}</Text> : null}
          {onPress ? <Ionicons name="chevron-forward" size={app ? 16 : 14} color={SECONDARY} /> : null}
        </View>
      </Pressable>
      </View>
      <View style={[styles.dashList, fill && styles.dashListFill]}>{children}</View>
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

function itemSnapshotLabel(row) {
  const names = (row?.itemNames || [])
    .map((name) => String(name || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  if (!names.length) return '';
  const shown = names.slice(0, 2);
  const extra = names.length - shown.length;
  return extra > 0 ? `${shown.join(' · ')} +${extra}` : shown.join(' · ');
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
  const itemLine = firstItemLineLabel(item);
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
          <View style={styles.mobileTxLead}>
            <Text style={styles.mobileTxCustomer} numberOfLines={1}>
              {item.customerName || '—'}
            </Text>
            <Text style={styles.mobileTxMeta} numberOfLines={1}>
              {[refLabel, item.timeLabel].filter(Boolean).join(' · ') || '—'}
            </Text>
          </View>
          <View style={styles.mobileTxTrail}>
            <View style={styles.mobileTxAmount} {...splitHover}>
              <Text style={styles.mobileTxAmountText} numberOfLines={1}>
                {item.amountLabel || '—'}
              </Text>
            </View>
            {itemLine ? (
              <Text style={styles.mobileTxItems} numberOfLines={1}>
                {itemLine}
              </Text>
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
        styles.desktopTxRow,
        last && styles.rowLast,
        (hovered || pressed) && styles.rowHovered,
      ]}
      accessibilityRole="button"
      accessibilityLabel={`${isBuy ? 'PO' : 'SO'} ${item.customerName || ''} ${item.amountLabel || ''}`}
    >
      <View style={styles.desktopTxThumb}>
        {photos.length ? (
          <TxnPhotoThumb urls={photos} label={item.reference || (isBuy ? 'PO' : 'SO')} size={48} />
        ) : (
          <View style={[styles.mobileTxKind, styles.desktopTxKind, isBuy && styles.mobileTxKindBuy]}>
            <Text style={[styles.mobileTxKindText, isBuy && styles.mobileTxKindTextBuy]}>
              {isBuy ? 'PO' : 'SO'}
            </Text>
          </View>
        )}
      </View>
      <View style={styles.desktopTxLead}>
        <Text style={styles.desktopTxCustomer} numberOfLines={1}>
          {item.customerName || '—'}
        </Text>
        <Text style={styles.desktopTxMeta} numberOfLines={1}>
          {[refLabel, item.timeLabel].filter(Boolean).join('  ·  ') || '—'}
        </Text>
      </View>
      <View style={styles.desktopTxMid}>
        <View style={styles.desktopTxEmployee}>
          <EmployeeAvatar person={hoverPerson} size={28} />
          <Text style={styles.desktopTxMeta} numberOfLines={1}>
            {employee || '—'}
          </Text>
        </View>
        {item.paymentMethodLabel && item.paymentMethodLabel !== '—' ? (
          <Text style={styles.desktopTxMeta} numberOfLines={1}>
            {item.paymentMethodLabel}
          </Text>
        ) : null}
      </View>
      <View style={styles.desktopTxTrail} {...splitHover}>
        <View style={styles.desktopTxAmountRow}>
          {showCash ? <TxnCashIcon saved={cashSaved} onPress={() => onCashPress(item)} /> : null}
          <Text style={styles.desktopTxAmount} numberOfLines={1}>
            {item.amountLabel || '—'}
          </Text>
        </View>
        {itemLine ? (
          <Text style={styles.desktopTxItems} numberOfLines={1}>
            {itemLine}
          </Text>
        ) : null}
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

function phonePartyLabel(call) {
  const inbound = String(call?.direction || '') !== 'Outbound';
  const name = inbound ? call?.fromName : call?.toName;
  const number = inbound ? call?.from : call?.to;
  return [name, number].filter(Boolean).join(' · ') || 'Unknown';
}

function PhoneSnapshotBody({ calls = [], periodLabel, ratio }) {
  const periodText = periodLabel === 'Today' ? 'today' : 'in this period';
  if (!calls.length) {
    return <EmptyRow text={`No calls ${periodText}.`} />;
  }
  return (
    <>
      {ratio?.ratio && ratio.ratio !== '—' ? (
        <Text style={styles.emailSectionLabel}>
          Answer rate {ratio.ratio}
          {ratio.answered != null ? ` · ${ratio.answered} answered` : ''}
          {ratio.missed != null ? ` · ${ratio.missed} missed` : ''}
        </Text>
      ) : null}
      {calls.map((call, index) => {
        const inbound = String(call.direction || '') !== 'Outbound';
        const missed = inbound && String(call.result || call.status || '') === 'Missed';
        return (
          <View
            key={call.id || `${call.startTime}-${index}`}
            style={[styles.row, styles.rowStatic, index === calls.length - 1 && styles.rowLast]}
          >
            <Ionicons
              name={!inbound ? 'arrow-up' : missed ? 'call-outline' : 'arrow-down'}
              size={16}
              color={missed ? RED : GREEN}
            />
            <View style={styles.rowCopy}>
              <Text style={styles.rowTitle} numberOfLines={1}>
                {phonePartyLabel(call)}
              </Text>
              <Text style={styles.rowSubtitle} numberOfLines={1}>
                {[
                  inbound ? 'Inbound' : 'Outbound',
                  resultLabel(call.result || call.status),
                  formatCallWhen(call.startTime),
                  call.duration ? formatDuration(call.duration) : '',
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            </View>
          </View>
        );
      })}
    </>
  );
}

function storeEmailCapture(txRows, storeName) {
  const rows = buildEmailCaptureByStore(Array.isArray(txRows) ? txRows : []);
  if (!rows.length) return null;
  return rows.find((row) => namesMatch(row.store, storeName)) || (rows.length === 1 ? rows[0] : null);
}

function EmailsSnapshotBody({ storeName, txRows, periodLabel, ready, full = false }) {
  const capture = useMemo(() => storeEmailCapture(txRows, storeName), [storeName, txRows]);
  const people = capture?.people || [];
  const missing = useMemo(
    () => people.filter((person) => !person.hasEmail),
    [people],
  );
  const periodText = periodLabel === 'Today' ? 'today' : 'in this period';

  if (!ready && !capture) return <LoadingRow />;

  if (!capture || capture.totalTransactions === 0) {
    return full ? (
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
  onHeaderStats,
  desktopHeader = null,
  heroFocus: heroFocusProp = 'all',
  focusTab = 'overview',
  desktopApps = [],
  appsOpen = false,
  onAppsOpenChange,
  embeddedApp = null,
  transactionTicket = null,
}) {
  const storeName = store?.store || '';
  const isMobile = useIsMobile();
  const { hasApp } = useAppAccess();
  const phone = usePhoneCalls();
  const showPhone = hasApp('phone');
  const showEmails = hasApp('emails');
  const showFinancials = hasApp('financials');
  const showInventory = hasApp('inventory');
  const [inventoryQuery, setInventoryQuery] = useState('');
  const [inventoryLimit, setInventoryLimit] = useState(INVENTORY_PAGE);
  const [cash, setCash] = useState(() => peekStoreCashPosition(session, { storeName: store?.store || '' }));
  const [cashLoading, setCashLoading] = useState(() => !peekStoreCashPosition(session, { storeName: store?.store || '' }));
  const [cashError, setCashError] = useState('');
  const [inventoryStores, setInventoryStores] = useState([]);
  const [inventoryRows, setInventoryRows] = useState([]);
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [inventoryError, setInventoryError] = useState('');
  const [staff, setStaff] = useState([]);
  const [staffLoading, setStaffLoading] = useState(false);
  const [txCatalogs, setTxCatalogs] = useState(() => new Map());
  const [priceReview, setPriceReview] = useState(null);
  const [heroFocus, setHeroFocus] = useState(heroFocusProp || 'all');
  useEffect(() => {
    setHeroFocus(heroFocusProp || 'all');
  }, [heroFocusProp, storeName]);
  const tolerance = usePriceCheckTolerance();
  const onFilterTopRef = useRef(onFilterTop);
  onFilterTopRef.current = onFilterTop;
  const heroYRef = useRef(0);
  const amountRowRef = useRef(null);
  const storeHeroLift = useRef(new Animated.Value(1)).current;
  const [pinnedTopHeight, setPinnedTopHeight] = useState(220);
  const [stageHeight, setStageHeight] = useState(0);
  const [titleBarBottom, setTitleBarBottom] = useState(62);
  const ticketId = transactionTicket?.props?.summary?.id || '';
  const ticketOpen = Boolean(transactionTicket);
  const sheetOpen = focusTab !== 'overview' || ticketOpen;
  const sheetKey = `${sheetOpen ? focusTab : 'overview'}:${ticketOpen ? ticketId || 'ticket' : ''}`;
  const pageScrollRef = useRef(null);
  const restGap = isMobile ? 10 : 18;
  const raisedOffset = Math.max(0, pinnedTopHeight + restGap);
  const raisedOffsetRef = useRef(raisedOffset);
  raisedOffsetRef.current = raisedOffset;

  useEffect(() => {
    const node = pageScrollRef.current;
    if (!node?.scrollTo) return;
    const y = sheetOpen ? raisedOffsetRef.current : 0;
    const frame = requestAnimationFrame(() => {
      node.scrollTo({ y, animated: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [sheetKey, sheetOpen]);

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
    setInventoryLimit(focusTab === 'inventory' ? 80 : INVENTORY_PAGE);
  }, [focusTab, inventoryQuery, storeName]);

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
  const visibleTxRows = useMemo(() => {
    if (heroFocus === 'sales') return txRows.filter((row) => row.type !== 'purchase');
    if (heroFocus === 'purchases') return txRows.filter((row) => row.type === 'purchase');
    return txRows;
  }, [heroFocus, txRows]);
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

  const employeeMeta = presentEmployees.length
    ? `${presentEmployees.length} here`
    : 'Now';

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
          dashboard
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
    <View style={styles.employeeCardGrid}>
      {presentEmployees.map((person, index) => (
        <EmployeeCard key={`${person.name}-${index}`} person={person} />
      ))}
    </View>
  );

  const emptyTxCopy =
    heroFocus === 'sales'
      ? `No sales ${periodLabel === 'Today' ? 'today' : 'in this period'}.`
      : heroFocus === 'purchases'
        ? `No purchases ${periodLabel === 'Today' ? 'today' : 'in this period'}.`
        : `No transactions ${periodLabel === 'Today' ? 'today' : 'in this period'}.`;
  const mappedTxRows =
    visibleTxRows.length === 0 ? (
      <EmptyRow text={emptyTxCopy} />
    ) : (
      visibleTxRows.map((item, index) => (
        <TransactionRow
          key={item.id}
          item={item}
          last={index === visibleTxRows.length - 1}
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

  const transactionsBody = mappedTxRows;

  const metricRows = [
    {
      app: SNAPSHOT_APPS.financials,
      value: cash ? formatAmount(cadAmt, 'CAD') : '—',
      meta: cashMeta,
      loading: cashLoading && !cash,
    },
  ];

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
    <>
      <InventorySearch value={inventoryQuery} onChangeText={setInventoryQuery} />
      {inventoryBody}
    </>
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
    />
  ) : listTab === 'phone' ? (
    <PhoneSnapshotBody calls={phoneCalls} periodLabel={periodLabel} ratio={phoneRatio} />
  ) : listTab === 'supplies' ? (
    <EmptyRow text={`No supplies recorded for ${storeName || 'this store'}.`} />
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
      ? Math.max(0, stageHeight - (isMobile ? Math.max(52, titleBarBottom + 4) : 0))
      : undefined;

  const sheetLists = (
    <View
      style={[
        styles.dashListSheet,
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
        <DashSection title={listTitle} app={listApp} meta={listMeta} fill>
          {listBody}
        </DashSection>
      )}
    </View>
  );

  const mobileLists = sheetLists;

  const mobileContent = mobileLists;

  const showPinnedApps = showFinancials || showPhone || showEmails || showInventory || (!isMobile && desktopApps.length > 0);
  const pinnedAppRow = showPinnedApps ? (
      <View style={[styles.dashPinnedApps, !isMobile && styles.deskPinnedApps]}>
        {showFinancials ? (
          <DashPinnedApp
            app={SNAPSHOT_APPS.financials}
            value={cashLoading && !cash ? '…' : cash ? formatAmount(cadAmt, 'CAD') : '—'}
            onOpen={openSnapshot}
            selected={listTab === 'financials'}
          />
        ) : null}
        {showPhone ? (
          <DashPinnedApp
            app={SNAPSHOT_APPS.phone}
            value={phoneRatio.rate == null ? '—' : phoneRatio.ratio}
            onOpen={openSnapshot}
            selected={listTab === 'phone'}
            compact
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
            compact
          />
        ) : null}
        {showInventory ? (
          <DashPinnedApp
            app={SNAPSHOT_APPS.inventory}
            value="Search"
            onOpen={openSnapshot}
            selected={listTab === 'inventory'}
            compact
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
        {desktopHeader || (
          <View pointerEvents="box-none" style={styles.deskChromeRow}>
            <Text style={styles.deskChromeStore} numberOfLines={1}>
              {storeName || 'Store'}
            </Text>
            <Text style={styles.deskChromePeriod} numberOfLines={1}>
              {periodLabel}
            </Text>
          </View>
        )}
        <View
          style={styles.deskStage}
          onLayout={(event) => {
            const height = event.nativeEvent.layout.height;
            setStageHeight((current) => (Math.abs(current - height) < 0.5 ? current : height));
          }}
        >
          <View
            pointerEvents="box-none"
            style={[styles.deskPinnedHero, appsOpen && styles.deskPinnedHeroRaised]}
            onLayout={(event) => {
              const height = event.nativeEvent.layout.height;
              setPinnedTopHeight((current) => (Math.abs(current - height) < 0.5 ? current : height));
            }}
          >
            <View style={styles.dashHeroShell}>
              <View pointerEvents="none" style={styles.dashHeroLift} />
              <OverviewHero
                store={store}
                periodLabel={periodLabel}
                chrome
                wide
                focus={heroFocus}
                onFocus={setHeroFocus}
                txSelected={listTab === 'transactions'}
                onPress={() => onOpenApp?.('transactions')}
              />
            </View>
            {pinnedAppRow}
          </View>
          <ScrollView
            ref={pageScrollRef}
            pointerEvents="box-none"
            style={styles.deskOverlayScroll}
            contentContainerStyle={[
              styles.deskOverlayScrollContent,
              {
                flexGrow: 1,
                pointerEvents: 'box-none',
                ...(stageHeight > 0 ? { minHeight: stageHeight + (sheetOpen ? raisedOffset : 0) } : null),
              },
            ]}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            bounces
            scrollEventThrottle={16}
            {...(Platform.OS === 'web' ? { className: 'cgold-home-overlay-scroll cgold-store-overlay-scroll' } : null)}
          >
            <View pointerEvents="none" style={{ height: raisedOffset }} />
            <View
              pointerEvents="auto"
              style={styles.deskSheet}
              {...(Platform.OS === 'web' ? { className: 'cgold-store-sheet' } : null)}
            >
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

  const mobileTitle = (
    <View style={styles.dashPinnedTitleBlock}>
      <Text style={styles.dashPinnedTitle} numberOfLines={1}>
        {storeName || 'Store'}
      </Text>
      <Text style={styles.dashPinnedDate} numberOfLines={1}>
        {periodLabel}
      </Text>
    </View>
  );

  return (
    <View
      style={[styles.body, styles.bodyMobile]}
      onLayout={(event) => {
        const height = event.nativeEvent.layout.height;
        setStageHeight((current) => (Math.abs(current - height) < 0.5 ? current : height));
      }}
    >
      <View
        pointerEvents="box-none"
        style={styles.dashPinnedTop}
        onLayout={(event) => {
          const height = event.nativeEvent.layout.height;
          setPinnedTopHeight((current) => (Math.abs(current - height) < 0.5 ? current : height));
        }}
      >
        <View pointerEvents="none" style={styles.dashPinnedTitleBlock} />
        <View style={styles.dashHeroShell}>
          <Animated.View pointerEvents="none" style={[styles.dashHeroLift, { opacity: storeHeroLift }]} />
          <OverviewHero
            store={store}
            periodLabel={periodLabel}
            chrome
            focus={heroFocus}
            onFocus={setHeroFocus}
            txSelected={listTab === 'transactions'}
            onPress={() => onOpenApp?.('transactions')}
          />
        </View>
        {pinnedAppRow}
      </View>
      <View
        pointerEvents="box-none"
        style={styles.dashPinnedTitleLayer}
        onLayout={(event) => {
          const { y, height } = event.nativeEvent.layout;
          const bottom = y + height;
          setTitleBarBottom((current) => (Math.abs(current - bottom) < 0.5 ? current : bottom));
        }}
      >
        {mobileTitle}
      </View>
      <ScrollView
        ref={pageScrollRef}
        pointerEvents="box-none"
        style={[styles.scroll, styles.scrollOverlay]}
        {...(Platform.OS === 'web' ? { className: 'cgold-home-overlay-scroll cgold-store-overlay-scroll' } : null)}
        contentContainerStyle={[
          styles.scrollContent,
          styles.scrollContentMobile,
          { paddingBottom: 104, pointerEvents: 'box-none' },
        ]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        scrollEventThrottle={16}
        onScroll={(event) => {
          const y = event?.nativeEvent?.contentOffset?.y;
          if (!Number.isFinite(y)) return;
          const reach = Math.max(1, pinnedTopHeight - 12);
          storeHeroLift.setValue(1 - Math.max(0, Math.min(1, y / reach)));
        }}
      >
        <View pointerEvents="none" style={{ height: raisedOffset }} />
        <View
          pointerEvents="auto"
          {...(Platform.OS === 'web' ? { className: 'cgold-store-sheet' } : null)}
        >
          {mobileContent}
        </View>
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
    prev.desktopHeader === next.desktopHeader &&
    prev.heroFocus === next.heroFocus &&
    prev.focusTab === next.focusTab &&
    prev.desktopApps === next.desktopApps &&
    prev.appsOpen === next.appsOpen &&
    prev.onAppsOpenChange === next.onAppsOpenChange &&
    prev.embeddedApp === next.embeddedApp &&
    prev.transactionTicket === next.transactionTicket,
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
  deskStage: {
    flex: 1,
    minHeight: 0,
    position: 'relative',
  },
  deskPinnedHero: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 1,
    elevation: 0,
    paddingHorizontal: 48,
    paddingTop: 0,
    paddingBottom: 4,
    backgroundColor: 'transparent',
  },
  deskPinnedHeroRaised: {
    zIndex: 16,
  },
  deskOverlayScroll: {
    zIndex: 4,
    backgroundColor: 'transparent',
  },
  deskOverlayScrollContent: {
    paddingBottom: 0,
    paddingHorizontal: 48,
    backgroundColor: 'transparent',
  },
  deskSheet: {
    width: '100%',
    alignSelf: 'stretch',
    backgroundColor: '#fff',
    borderRadius: 24,
    paddingBottom: 24,
    overflow: 'hidden',
  },
  deskSheetBody: {
    flex: 1,
    minHeight: 0,
  },
  deskDashHead: {
    paddingHorizontal: 24,
    marginTop: 12,
    marginBottom: 8,
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
  desktopTxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 20,
    minHeight: 76,
    paddingLeft: 24,
    paddingRight: 24,
    paddingVertical: 16,
    backgroundColor: '#fff',
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
  dashPinnedTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 1,
    elevation: 0,
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 8,
    backgroundColor: 'transparent',
  },
  dashPinnedTitleLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 5,
    paddingHorizontal: 16,
    paddingTop: 6,
    backgroundColor: 'transparent',
  },
  dashPinnedTitleBlock: {
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    marginBottom: 18,
    paddingHorizontal: 52,
  },
  dashPinnedTitle: {
    textAlign: 'center',
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: '#6B5E3A',
    letterSpacing: 0.2,
  },
  dashPinnedDate: {
    marginTop: 2,
    textAlign: 'center',
    fontFamily,
    fontSize: 12,
    fontWeight: '500',
    color: '#6B5E3A',
    letterSpacing: 0.2,
    opacity: 0.72,
  },
  dashHeroShell: {
    alignSelf: 'stretch',
    position: 'relative',
  },
  dashHeroLift: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 20,
    ...Platform.select({
      web: {
        boxShadow: '0 2px 6px rgba(18,16,12,0.08), 0 14px 32px rgba(18,16,12,0.18)',
      },
      default: {
        shadowColor: '#12100C',
        shadowOpacity: 0.22,
        shadowRadius: 20,
        shadowOffset: { width: 0, height: 10 },
        elevation: 0,
      },
    }),
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
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.72)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(42,38,30,0.08)',
    gap: 6,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  dashPinnedAppSelected: {
    backgroundColor: '#fff',
    borderColor: 'rgba(42,38,30,0.22)',
  },
  dashPinnedAppPressed: {
    backgroundColor: '#fff',
  },
  dashPinnedAppCompact: {
    flex: 0.72,
    paddingHorizontal: 8,
  },
  dashPinnedAppRoomy: {
    flexGrow: 1,
    flexBasis: '46%',
    minWidth: 148,
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
    color: '#6B5E3A',
    letterSpacing: 0.2,
  },
  dashPinnedAppValue: {
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
  dashSheetHost: {
    flex: 1,
    minHeight: 0,
    zIndex: 2,
  },
  dashSheetDock: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 4,
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
  dashListSheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: 'hidden',
    paddingTop: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,0,0,0.08)',
    ...Platform.select({
      web: {
        boxShadow: '0 -8px 24px rgba(0,0,0,0.12), 0 -1px 0 rgba(255,255,255,0.9)',
      },
      default: {
        shadowColor: '#000',
        shadowOpacity: 0.14,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: -6 },
        elevation: 8,
      },
    }),
  },
  dashListSheetFill: {
    flex: 1,
    minHeight: 0,
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
  buyTxSheetAttach: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 40,
    gap: 14,
  },
  dashSheetScroll: {
    flex: 1,
    minHeight: 0,
  },
  dashSheetScrollContent: {
    paddingBottom: 104,
    flexGrow: 1,
  },
  dashHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
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
    fontFamily,
    fontSize: 16,
    fontWeight: '600',
    color: '#6B5E3A',
    letterSpacing: 0.15,
  },
  dashHeadTrail: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dashHeadMeta: {
    fontFamily,
    fontSize: 15,
    fontWeight: '500',
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
    marginTop: 0,
    borderTopWidth: 0,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: 'hidden',
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
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
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
  mobileTxTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  mobileTxCustomer: {
    fontFamily,
    minWidth: 0,
    fontSize: 17,
    fontWeight: '600',
    color: LABEL,
    letterSpacing: -0.3,
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
    fontSize: 17,
    fontWeight: '600',
    color: LABEL,
    letterSpacing: -0.3,
    fontVariant: ['tabular-nums'],
    textAlign: 'right',
  },
  mobileTxMeta: {
    fontFamily,
    minWidth: 0,
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
    textAlign: 'right',
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
  employeeCardWrap: {
    alignSelf: 'stretch',
    width: '100%',
    paddingHorizontal: 8,
    paddingTop: 8,
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
  scrollOverlay: {
    zIndex: 4,
    backgroundColor: 'transparent',
  },
  scrollContent: {
    paddingBottom: 32,
    gap: 12,
  },
  scrollContentMobile: {
    gap: 0,
    backgroundColor: 'transparent',
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
