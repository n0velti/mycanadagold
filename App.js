import { createElement, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BlurView } from 'expo-blur';
import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Image,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Feather, Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import {
  login as loginRequest,
  logout as logoutRequest,
  onAureusSessionExpired,
  onSessionRevoked,
  restoreSession,
  watchAureusToken,
} from './lib/auth';
import {
  DEFAULT_APPS_VIEW,
  loadAppsView,
  loadPinnedTools,
  persistAppsView,
  persistPinnedTools,
  storeLocationFromSession,
  isRestrictedHomeEmployee,
  allocatedStoreName,
  scopedStoreName,
} from './lib/profiles';
import {
  AppAccessContext,
  canFilterApp,
  canManageAppAccess,
  findStaffByEmployeeName,
  listStaffProfiles,
  staffDisplayName,
  loadOwnUserAppAccess,
  loadRoleAppAccess,
  useAppAccess,
  visibleAppKeysForProfile,
} from './lib/permissions';
import { clearInventoryCache, prefetchInventoryMatrix } from './lib/inventory';
import {
  buildEmailCaptureByStore,
  defaultDateRange,
  fetchHomeStoreSummaries,
  fetchTransactionDetail,
  fetchTransactions,
  FINTRAC_CASH_THRESHOLD,
  formatAmount,
  formatUnitCost,
  formatDateParam,
  lineItemMoney,
  formatPickerDate,
  isCashTransaction,
  isFintracCash,
  needsLineItemEnrichment,
  needsPaymentEnrichment,
  parseDateParam,
  queryLooksLikeItem,
  resolvePosAuthForRow,
  rowMatchesQuery,
  withLineItems,
  withPaymentBreakdown,
} from './lib/transactions';
import { readRipplingOAuthCallback, readRipplingOAuthState } from './lib/rippling';
import { readGmailOAuthCallback } from './lib/gmail';
import AiScreen from './components/AiScreen';
import AnalyticsScreen from './components/AnalyticsScreen';
import AccountingScreen from './components/AccountingScreen';
import AuditScreen from './components/AuditScreen';
import BonusesScreen from './components/BonusesScreen';
import EmployeesScreen from './components/EmployeesScreen';
import DebitScreen from './components/DebitScreen';
import FinancialsScreen from './components/FinancialsScreen';
import PreordersScreen from './components/PreordersScreen';
import FintracScreen from './components/FintracScreen';
import HundredWaysScreen from './components/HundredWaysScreen';
import InventoryScreen from './components/InventoryScreen';
import SerphintScreen from './components/SerphintScreen';
import SettingsScreen from './components/SettingsScreen';
import StoreSettingsPanel from './components/StoreSettingsPanel';
import StoreSnapshotPanel, { StoreTransactionRow, OverviewHero } from './components/StoreSnapshotPanel';
import TxnCashBreakdownModal, { TxnCashIcon } from './components/TxnCashBreakdownModal';
import { AUREUS_TX_LIVE_MS, useLiveRefresh } from './lib/liveRefresh';
import { useTxnCashBreakdowns } from './lib/txnCashBreakdowns';
import TransferScreen from './components/TransferScreen';
import PricingScreen from './components/PricingScreen';
import TriageScreen, { clearTriageCache } from './components/TriageScreen';
import LogsScreen from './components/LogsScreen';
import { flushNow as flushActionLog, setActionLogActor, setActionLogContext } from './lib/actionLog';
import LoginScreen from './components/LoginScreen';
import MessagesScreen from './components/MessagesScreen';
import {
  MobileHomeHeader,
  MobileNavHeader,
  MobileSafeTop,
  MobileTabBar,
} from './components/MobileChrome';
import ProfileScreen, { profileTargetFromPerson } from './components/ProfileScreen';
import ProfileLocationPicker from './components/ProfileLocationPicker';
import MarketingScreen from './components/MarketingScreen';
import SharedServicesScreen from './components/SharedServicesScreen';
import PhoneScreen from './components/PhoneScreen';
import EmailsScreen from './components/EmailsScreen';
import { PhoneCallProvider, PhoneIncomingDock, usePhoneCalls } from './components/PhoneCallProvider';
import MobilePhoneDock from './components/MobilePhoneDock';
import { callsForStore, inboundCallRatio } from './lib/phoneCalls';
import {
  emptyStoreSettings,
  isStoreOpenNow,
  listSavedStoreSettings,
  storeKeyFromName,
} from './lib/storeSettings';
import TeamsScreen from './components/TeamsScreen';
import TradeScreen from './components/TradeScreen';
import LinePhotoCapturePage from './components/LinePhotoCapturePage';
import { captureTokenFromLocation } from './lib/qrCode';
import { fetchAureusEmployee } from './lib/aureusEmployees';
import { useDirectMessages } from './lib/messages';

if (Platform.OS === 'web' && typeof document !== 'undefined') {
  const styleId = 'cgold-tx-row-hover';
  let style = document.getElementById(styleId);
  if (!style) {
    style = document.createElement('style');
    style.id = styleId;
    document.head.appendChild(style);
  }
  style.textContent = [
    'html,body,#root{height:100%;max-height:100dvh;overflow:hidden;}',
    'html,body,input,textarea,button,select{font-family:Sohne,sans-serif;}',
    '.cgold-tx-row{cursor:pointer;transition:none!important;background-color:transparent;}',
    '.cgold-tx-row:hover{background-color:#e8e8ed!important;}',
    '.cgold-tx-row:active{background-color:#e5e5ea!important;}',
    '.cgold-tx-row-selected,.cgold-tx-row-selected:hover{background-color:#e8e8ed!important;}',
    '.cgold-home-row{cursor:pointer;background-color:transparent;transition:background-color 160ms ease;overflow:visible!important;}',
    '.cgold-home-row:hover{background-color:#e8e8ed!important;}',
    '.cgold-home-row:active{background-color:#e5e5ea!important;}',
    '.cgold-home-row-selected,.cgold-home-row-selected:hover{background-color:#e8e8ed!important;}',
    '.cgold-home-live{display:inline-block;max-width:100%;vertical-align:baseline;transform:translateY(0) scale(1);transition-property:color,transform;transition-timing-function:ease-out;}',
    '.cgold-home-live-hot-up{color:#34C759!important;transform:translateY(7px) scale(1.05);transition-duration:0ms;}',
    '.cgold-home-live-hot-down{color:#FF3B30!important;transform:translateY(-7px) scale(1.05);transition-duration:0ms;}',
    '.cgold-home-live-cool{transition-duration:820ms;}',
    '@media (prefers-reduced-motion:reduce){.cgold-home-live,.cgold-home-live-hot-up,.cgold-home-live-hot-down,.cgold-home-live-cool{transition:none!important;transform:none!important;}}',
    '.cgold-filter-option{cursor:pointer;transition:none!important;}',
    '.cgold-filter-option:hover{background-color:#f5f5f5!important;}',
    '.cgold-floating-tip{position:fixed;z-index:100000;pointer-events:none;max-width:280px;min-width:160px;padding:8px 10px;border-radius:6px;background:#1a1a1a;box-shadow:0 4px 16px rgba(0,0,0,0.18);font:12px/16px Sohne,sans-serif;color:#fff;white-space:pre-wrap;}',
    '.cgold-sidebar-item .cgold-sidebar-unpin{opacity:0;transition:opacity 120ms;}',
    '.cgold-sidebar-item:hover .cgold-sidebar-unpin,.cgold-sidebar-item:focus-within .cgold-sidebar-unpin{opacity:1;}',
    '.cgold-tab-well{background:rgba(242,242,247,0.94);box-shadow:inset 0 1px 1px rgba(255,255,255,0.9),0 1px 2px rgba(0,0,0,0.05),0 4px 10px rgba(0,0,0,0.05);}',
    '.cgold-tab-glass{-webkit-backdrop-filter:saturate(180%) blur(22px);backdrop-filter:saturate(180%) blur(22px);background-color:rgba(255,255,255,0.86)!important;box-shadow:inset 0 0.5px 0 rgba(255,255,255,0.95),0 0 0 0.5px rgba(0,0,0,0.04),0 1px 3px rgba(0,0,0,0.06)!important;}',
    '.cgold-apps-toolbar-blur{-webkit-backdrop-filter:saturate(180%) blur(20px);backdrop-filter:saturate(180%) blur(20px);background-color:rgba(255,255,255,0.62)!important;}',
    '.cgold-home-toolbar-blur{-webkit-backdrop-filter:saturate(180%) blur(20px);backdrop-filter:saturate(180%) blur(20px);background-color:rgba(255,255,255,0.62)!important;}',
    '.cgold-store-header-blur{-webkit-backdrop-filter:saturate(160%) blur(12px);backdrop-filter:saturate(160%) blur(12px);background-color:rgba(255,255,255,0.72)!important;transform:translateZ(0);}',
    '.cgold-dm-row{cursor:pointer;}',
    '.cgold-dm-row:hover{background-color:#f5f5f7!important;}',
    '.cgold-dm-row-active,.cgold-dm-row-active:hover{background-color:#ececef!important;}',
    '.cgold-store-status{position:relative;width:48px;height:48px;flex-shrink:0;overflow:visible!important;display:flex;align-items:center;justify-content:center;}',
    '.cgold-store-status-lg{width:48px;height:48px;}',
    '.cgold-store-status::before,.cgold-store-status::after{content:"";position:absolute;left:50%;top:50%;width:28px;height:28px;border-radius:50%;pointer-events:none;z-index:0;transform:translate(-50%,-50%) scale(.9);}',
    '.cgold-store-status-lg::before,.cgold-store-status-lg::after{width:40px;height:40px;}',
    '.cgold-store-status-open::before,.cgold-store-status-open::after{background:radial-gradient(circle,rgba(48,209,88,.42) 0%,rgba(48,209,88,.16) 38%,rgba(48,209,88,0) 70%);}',
    '.cgold-store-status-closed::before,.cgold-store-status-closed::after{background:radial-gradient(circle,rgba(255,69,58,.38) 0%,rgba(255,69,58,.14) 38%,rgba(255,69,58,0) 70%);}',
    '.cgold-store-status::before{animation:cgold-store-radiate 2.4s ease-out infinite;}',
    '.cgold-store-status::after{animation:cgold-store-radiate 2.4s ease-out infinite 1.2s;}',
    '.cgold-store-status .cgold-store-ambient{position:absolute;left:50%;top:50%;width:36px;height:36px;margin-left:-18px;margin-top:-18px;border-radius:50%;pointer-events:none;z-index:0;filter:blur(7px);animation:cgold-store-ambient 2.2s ease-in-out infinite;}',
    '.cgold-store-status-lg .cgold-store-ambient{width:46px;height:46px;margin-left:-23px;margin-top:-23px;filter:blur(9px);}',
    '.cgold-store-status-open .cgold-store-ambient{background:rgba(48,209,88,.42);}',
    '.cgold-store-status-closed .cgold-store-ambient{background:rgba(255,69,58,.38);}',
    '@keyframes cgold-store-radiate{0%{transform:translate(-50%,-50%) scale(.8);opacity:.48}100%{transform:translate(-50%,-50%) scale(1.7);opacity:0}}',
    '@keyframes cgold-store-ambient{0%,100%{opacity:.28;transform:scale(.92)}50%{opacity:.58;transform:scale(1.08)}}',
    '@media (prefers-reduced-motion:reduce){.cgold-store-status::before,.cgold-store-status::after{animation:none;opacity:.32;transform:translate(-50%,-50%) scale(1.12)}.cgold-store-status .cgold-store-ambient{animation:none;opacity:.4;transform:none}}',
    '@media (max-width:767px){',
    'html,body,#root{background:#fff;}',
    '.cgold-mobile-inset-top{height:max(12px,env(safe-area-inset-top,0px))!important;}',
    '.cgold-mobile-tab-bar{padding-bottom:max(8px,env(safe-area-inset-bottom,0px))!important;}',
    '.cgold-mobile-sheet-top{padding-top:max(18px,env(safe-area-inset-top,0px))!important;}',
    '.cgold-pin-button{opacity:1!important;pointer-events:auto!important;}',
    'input,textarea,button,select{-webkit-tap-highlight-color:transparent;}',
    '}',
  ].join('');
}

const TX_ROW_HEIGHT = 44;

const fontFamily = 'Sohne';
const titleFontFamily = 'SohneLeicht';

const FILTER_COLUMNS = [
  { key: 'storeName', label: 'Store', colStyle: 'colStore' },
  { key: 'dateLabel', label: 'Date', colStyle: 'colDate' },
  { key: 'timeLabel', label: 'Time', colStyle: 'colTime' },
  { key: 'reference', label: 'PO# / SO#', colStyle: 'colRef' },
  { key: 'customerName', label: 'Customer', colStyle: 'colCustomer' },
  { key: 'paymentMethodLabel', label: 'Payment Method', colStyle: 'colPayment' },
  { key: 'amountLabel', label: 'Amount', colStyle: 'colAmount' },
  { key: 'employeeName', label: 'Employee', colStyle: 'colEmployee' },
];

function buildColumnOptions(rows) {
  const options = {};
  for (const col of FILTER_COLUMNS) {
    const seen = new Set();
    for (let i = 0; i < rows.length; i += 1) {
      seen.add(rows[i][col.key] || '—');
    }
    options[col.key] = Array.from(seen).sort((a, b) =>
      String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' }),
    );
  }
  return options;
}

function ColumnFilterMenu({
  field,
  label,
  options,
  filter,
  onChange,
  onClose,
  fintracOnly,
  onToggleFintrac,
  fintracCount,
}) {
  const [search, setSearch] = useState('');
  const allValues = options;
  const selectedCount = filter == null ? allValues.length : Object.keys(filter).length;
  const allSelected = filter == null;
  const noneSelected = filter != null && selectedCount === 0;
  const isAmount = field === 'amountLabel';

  const visibleOptions = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allValues;
    return allValues.filter((value) => String(value).toLowerCase().includes(q));
  }, [allValues, search]);

  const isChecked = (value) => (filter == null ? true : Boolean(filter[value]));

  const selectAll = () => onChange(null);

  const clearAll = () => onChange({});

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

  const renderOption = ({ item }) => {
    const checked = isChecked(item);
    return (
      <Pressable
        style={styles.filterOption}
        onPress={() => toggleValue(item)}
        {...(Platform.OS === 'web' ? { className: 'cgold-filter-option' } : null)}
      >
        <Ionicons
          name={checked ? 'checkbox' : 'square-outline'}
          size={20}
          color={checked ? '#1d1d1f' : '#c7c7cc'}
        />
        <Text style={styles.filterOptionText} numberOfLines={1}>
          {item}
        </Text>
      </Pressable>
    );
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.filterModalRoot}>
        <Pressable style={styles.filterModalBackdrop} onPress={onClose} />
        <View style={styles.filterMenu}>
          <View style={styles.filterMenuHeader}>
            <Text style={styles.filterMenuTitle}>{label}</Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <Ionicons name="close" size={20} color="#8e8e93" />
            </Pressable>
          </View>

          {isAmount ? (
            <Pressable style={styles.filterPreset} onPress={onToggleFintrac}>
              <Ionicons
                name={fintracOnly ? 'checkbox' : 'square-outline'}
                size={20}
                color={fintracOnly ? '#8a1c1c' : '#c7c7cc'}
              />
              <View style={styles.filterPresetTextWrap}>
                <Text style={styles.filterPresetTitle}>
                  Cash ≥ {formatAmount(FINTRAC_CASH_THRESHOLD)}
                </Text>
                <Text style={styles.filterPresetSub}>
                  FINTRAC pre-report{typeof fintracCount === 'number' ? ` · ${fintracCount}` : ''}
                </Text>
              </View>
            </Pressable>
          ) : null}

          <View style={styles.filterField}>
            <Text style={styles.filterFieldLabel}>Search</Text>
            <TextInput
              style={styles.filterFieldInput}
              value={search}
              onChangeText={setSearch}
              placeholder="Filter values"
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

          <View style={styles.filterActions}>
            <Pressable onPress={selectAll} disabled={allSelected}>
              <Text style={[styles.filterActionText, allSelected && styles.filterActionDisabled]}>
                Select all
              </Text>
            </Pressable>
            <Text style={styles.filterActionSep}>·</Text>
            <Pressable onPress={clearAll} disabled={noneSelected}>
              <Text style={[styles.filterActionText, noneSelected && styles.filterActionDisabled]}>
                Clear
              </Text>
            </Pressable>
            <Text style={styles.filterCount}>
              {selectedCount}/{allValues.length}
            </Text>
          </View>

          <View style={styles.filterList}>
            <FlashList
              data={visibleOptions}
              keyExtractor={(item) => String(item)}
              renderItem={renderOption}
              extraData={filter}
              drawDistance={200}
              ListEmptyComponent={
                <Text style={styles.filterEmpty}>No matching values</Text>
              }
            />
          </View>

          <Pressable style={styles.filterDoneButton} onPress={onClose}>
            <Text style={styles.filterDoneButtonText}>Done</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function FilterableHeaderCell({ label, colStyle, active, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ hovered, pressed }) => [
        styles.txTableHeaderCell,
        colStyle,
        (hovered || pressed) && styles.txTableHeaderCellHover,
      ]}
    >
      <Text
        style={[styles.txTableHeaderLabel, active && styles.txTableHeaderLabelActive]}
        numberOfLines={1}
      >
        {label}
      </Text>
      <Ionicons
        name={active ? 'funnel' : 'chevron-down'}
        size={11}
        color={active ? '#1d1d1f' : '#c7c7cc'}
      />
    </Pressable>
  );
}

function TxTableHeader({
  hideStore = false,
  columnFilters,
  fintracCashOnly,
  onOpenFilter,
  interactive = true,
}) {
  const columns = hideStore
    ? FILTER_COLUMNS.filter((col) => col.key !== 'storeName')
    : FILTER_COLUMNS;

  return (
    <View style={styles.txTableHeader}>
      {columns.map((col) => {
        const active =
          columnFilters?.[col.key] != null ||
          (col.key === 'amountLabel' && fintracCashOnly);
        if (!interactive) {
          return (
            <Text
              key={col.key}
              style={[styles.txTableHeaderLabel, styles[col.colStyle]]}
              numberOfLines={1}
            >
              {col.label}
            </Text>
          );
        }
        return (
          <FilterableHeaderCell
            key={col.key}
            label={col.label}
            colStyle={styles[col.colStyle]}
            active={active}
            onPress={() => onOpenFilter(col.key)}
          />
        );
      })}
    </View>
  );
}

const APP_COLUMNS = 6;
const APP_COLUMNS_MOBILE = 4;
const APP_GAP = 16;
const APP_ICON_SIZE = 56;
const APP_ICON_SIZE_MOBILE = 48;
const APP_GRID_MAX_WIDTH = 880;
const MOBILE_BREAKPOINT = 768;

function useIsMobile() {
  const { width } = useWindowDimensions();
  return width < MOBILE_BREAKPOINT;
}

function useAppGridLayout() {
  const { width } = useWindowDimensions();
  if (width < MOBILE_BREAKPOINT) {
    return { columns: APP_COLUMNS_MOBILE, iconSize: APP_ICON_SIZE_MOBILE, maxWidth: undefined, gap: 10, rowGap: 14 };
  }
  if (width < 1240) {
    return { columns: 5, iconSize: 52, maxWidth: 740, gap: 14, rowGap: 16 };
  }
  return { columns: APP_COLUMNS, iconSize: APP_ICON_SIZE, maxWidth: APP_GRID_MAX_WIDTH, gap: APP_GAP, rowGap: 18 };
}

function filledIonicon(name) {
  return typeof name === 'string' && name.endsWith('-outline') ? name.slice(0, -8) : name;
}

const TAB_ICON_COLOR = '#8e8e93';
const TAB_ICON_ACTIVE_COLOR = '#007AFF';

function sidebarTabClassName(active, extra) {
  if (Platform.OS !== 'web') return extra || undefined;
  return [extra, active ? 'cgold-tab-glass' : null].filter(Boolean).join(' ') || undefined;
}

const MAIN_TABS = [
  { key: 'home', label: 'Home', icon: 'home-outline' },
  { key: 'tools', label: 'Apps', icon: 'apps-outline' },
  { key: 'messages', label: 'Direct Messages', shortLabel: 'Messages', icon: 'chatbubbles-outline' },
];

const TRADE_TABS = [
  { key: 'buy', label: 'Buy' },
  { key: 'sell', label: 'Sell' },
];

const TRADE_BUY = {
  accent: '#1F8A4E',
  icon: 'arrow-down-circle-outline',
  fill: 'rgba(31, 138, 78, 0.10)',
  fillHover: 'rgba(31, 138, 78, 0.16)',
};
const TRADE_SELL = {
  accent: '#C0392B',
  icon: 'arrow-up-circle-outline',
  fill: 'rgba(192, 57, 43, 0.09)',
  fillHover: 'rgba(192, 57, 43, 0.15)',
};

const PROFILE_TAB = { key: 'profile', label: 'Profile', icon: 'person-outline' };

const MOBILE_TABS = [
  { key: 'home', label: 'Home', icon: 'home-outline', iconActive: 'home' },
  { key: 'tools', label: 'Apps', icon: 'apps-outline', iconActive: 'apps' },
  { key: 'messages', label: 'Messages', icon: 'chatbubble-outline', iconActive: 'chatbubble' },
  { key: 'profile', label: 'Profile', icon: 'person-outline', iconActive: 'person' },
];

const HOME_APP = {
  key: 'home',
  label: 'Home',
  icon: 'home-outline',
  tint: '#EEF4FF',
  accent: '#0A84FF',
};

const TOOL_CARDS = [
  { key: 'transactions', label: 'Transactions', icon: 'swap-horizontal-outline', tint: '#E8F1FF', accent: '#2F6FED' },
  { key: 'inventory', label: 'Inventory', icon: 'cube-outline', tint: '#FFF4E5', accent: '#C47A12' },
  { key: 'preorders', label: 'Preorders', icon: 'cart-outline', tint: '#FFF7ED', accent: '#EA580C' },
  { key: 'ai', label: 'AI', icon: 'sparkles-outline', tint: '#F3EEFF', accent: '#6B4DE6' },
  { key: 'messages', label: 'Direct Messages', icon: 'chatbubbles-outline', tint: '#EEF4FF', accent: '#0A84FF' },
  { key: 'audit', label: 'Audit', icon: 'clipboard-outline', tint: '#EEF8F1', accent: '#2F8A4E' },
  { key: 'transfer', label: 'Transfer', icon: 'arrow-forward-outline', tint: '#EEF7FB', accent: '#1F7A9A' },
  { key: 'fintrac', label: 'FINTRAC', icon: 'document-text-outline', tint: '#F7F0EA', accent: '#8A5A3A' },
  { key: 'financials', label: 'Financials', icon: 'wallet-outline', tint: '#F0F8EE', accent: '#3D8B4F' },
  { key: 'debit', label: 'Debit', icon: 'card-outline', tint: '#EEF4FF', accent: '#1D4ED8' },
  { key: 'accounting', label: 'Accounting', icon: 'calculator-outline', tint: '#EEF2FF', accent: '#3730A3' },
  { key: 'analytics', label: 'Analytics', icon: 'analytics-outline', tint: '#EEF2FF', accent: '#4F46E5' },
  { key: 'pricing', label: 'Pricing', icon: 'pricetag-outline', tint: '#F8F1E3', accent: '#A67C2D' },
  { key: 'bonuses', label: 'Bonuses', icon: 'gift-outline', tint: '#FEF9C3', accent: '#A16207' },
  { key: 'leaderboards', label: 'Leaderboards', icon: 'trophy-outline', tint: '#FFF8E8', accent: '#B8860B' },
  { key: 'police-report', label: 'Police Report', icon: 'shield-outline', tint: '#F4F4F5', accent: '#3F3F46' },
  { key: 'security', label: 'Security', icon: 'lock-closed-outline', tint: '#EEF2FF', accent: '#374151' },
  { key: 'serphint', label: 'Serphint', icon: 'eye-outline', tint: '#ECFDF5', accent: '#047857' },
  { key: 'supplies', label: 'Supplies', icon: 'bag-handle-outline', tint: '#FFF1F2', accent: '#BE123C' },
  { key: 'employees', label: 'Employees', icon: 'people-outline', tint: '#EFF6FF', accent: '#1D4ED8' },
  { key: 'phone', label: 'Phone', icon: 'call-outline', tint: '#ECFDF5', accent: '#15803D' },
  { key: 'teams', label: 'Teams', icon: 'people-circle-outline', tint: '#EEF4FF', accent: '#2563EB' },
  { key: 'marketing', label: 'Marketing', icon: 'megaphone-outline', tint: '#FDF2F8', accent: '#DB2777' },
  { key: 'shared-services', label: 'Shared Services', icon: 'briefcase-outline', tint: '#F0FDFA', accent: '#0F766E' },
  { key: 'customers', label: 'Customers', icon: 'person-circle-outline', tint: '#F0FDFA', accent: '#0F766E' },
  { key: 'calendar', label: 'Calendar', icon: 'calendar-outline', tint: '#FEF3C7', accent: '#B45309' },
  { key: 'notifications', label: 'Notifications', icon: 'notifications-outline', tint: '#FEE2E2', accent: '#B91C1C' },
  { key: 'reviews', label: 'Reviews', icon: 'star-outline', tint: '#FEF9C3', accent: '#A16207' },
  { key: 'emails', label: 'Emails', icon: 'mail-outline', tint: '#E0E7FF', accent: '#4338CA' },
  { key: 'documents', label: 'Documents', icon: 'folder-outline', tint: '#E2E8F0', accent: '#475569' },
  { key: 'contacts', label: 'Contacts', icon: 'book-outline', tint: '#FCE7F3', accent: '#BE185D' },
  { key: 'triage', label: 'Triage', icon: 'medkit-outline', tint: '#FFEDD5', accent: '#C2410C' },
  { key: '100-ways', label: '100 Ways', icon: 'list-outline', tint: '#E0F2FE', accent: '#0369A1' },
  { key: 'cdn-coin', label: 'Cdn Coin', icon: 'logo-bitcoin', tint: '#FEF3C7', accent: '#D97706' },
  { key: 'pmx', label: 'PMX', icon: 'diamond-outline', tint: '#F5F3FF', accent: '#6D28D9' },
  { key: 'shipping', label: 'Shipping', icon: 'airplane-outline', tint: '#ECFEFF', accent: '#0E7490' },
  { key: 'storage', label: 'Storage', icon: 'archive-outline', tint: '#F1F5F9', accent: '#334155' },
  { key: 'logs', label: 'Logs', icon: 'reader-outline', tint: '#F1F5F9', accent: '#0F172A' },
  { key: 'settings', label: 'Settings', icon: 'settings-outline', tint: '#F4F4F5', accent: '#52525B' },
];

const TOOL_KEYS = new Set(TOOL_CARDS.map((tool) => tool.key));
const PERMISSION_APPS = [HOME_APP, ...TOOL_CARDS];
const ACCESS_CATALOG_KEYS = new Set(PERMISSION_APPS.map((app) => app.key));

const STORE_DRAWER_TAB_KEYS = [
  'transactions',
  'inventory',
  'preorders',
  'financials',
  'employees',
  'phone',
  'emails',
  'audit',
  'supplies',
  'serphint',
  'settings',
];

const STORE_DRAWER_TABS = STORE_DRAWER_TAB_KEYS.map((key) =>
  TOOL_CARDS.find((tool) => tool.key === key),
).filter(Boolean);

const TRANSACTION_DETAIL_TAB_KEYS = ['triage', 'ai', 'serphint'];

const TRANSACTION_DETAIL_TABS = TRANSACTION_DETAIL_TAB_KEYS.map((key) =>
  TOOL_CARDS.find((tool) => tool.key === key),
).filter(Boolean);

const STORE_DRAWER_RAIL_WIDTH = 68;

function displayName(session) {
  if (!session) return '';
  if (session.profile?.fullName) return session.profile.fullName;
  const user = session.user;
  if (!user) return '';

  const fromParts = [user.first_name, user.last_name]
    .filter(Boolean)
    .join(' ')
    .trim();

  return fromParts || user.name || user.full_name || '';
}

function initialsFromName(name) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return '';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

const HOME_PEOPLE_VISIBLE = 6;
const HOME_PEOPLE_SIZE = 28;
const HOME_PEOPLE_OVERLAP = 10;

function peopleInStore(storeName, transactions, staff) {
  const byKey = new Map();

  const applyStaff = (entry, person) => {
    if (!person) return entry;
    entry.photoUrl = person.avatarUrl || entry.photoUrl;
    entry.profileId = person.id || entry.profileId || '';
    entry.locationName = person.locationName || entry.locationName || '';
    return entry;
  };

  for (const row of transactions || []) {
    const name = String(row.employeeName || '').trim();
    if (!name || name === '—') continue;
    const key = name.toLowerCase();
    const match = findStaffByEmployeeName(staff, name);
    const current = byKey.get(key) || {
      name,
      photoUrl: '',
      profileId: '',
      locationName: '',
      txCount: 0,
    };
    current.txCount += 1;
    applyStaff(current, match);
    byKey.set(key, current);
  }

  for (const person of staff || []) {
    if (!rowMatchesAllocatedStore({ store: person.locationName }, storeName)) continue;
    const name = staffDisplayName(person);
    if (!name) continue;
    const match = [...byKey.values()].find((entry) => findStaffByEmployeeName([person], entry.name));
    if (match) {
      applyStaff(match, person);
      continue;
    }
    byKey.set(name.toLowerCase(), {
      name,
      photoUrl: person.avatarUrl || '',
      profileId: person.id || '',
      locationName: person.locationName || '',
      txCount: 0,
    });
  }

  return Array.from(byKey.values()).sort((a, b) => {
    if (Boolean(b.photoUrl) !== Boolean(a.photoUrl)) return b.photoUrl ? 1 : -1;
    if (b.txCount !== a.txCount) return b.txCount - a.txCount;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });
}

function uniqueStorePeople(rows, staff) {
  const byKey = new Map();
  for (const row of rows || []) {
    for (const person of peopleInStore(row.store, row.transactions, staff)) {
      const key = person.name.toLowerCase();
      const current = byKey.get(key);
      if (!current) {
        byKey.set(key, { ...person });
        continue;
      }
      current.txCount += person.txCount;
      current.photoUrl = current.photoUrl || person.photoUrl;
      current.profileId = current.profileId || person.profileId;
      current.locationName = current.locationName || person.locationName;
    }
  }
  return Array.from(byKey.values()).sort((a, b) => {
    if (Boolean(b.photoUrl) !== Boolean(a.photoUrl)) return b.photoUrl ? 1 : -1;
    if (b.txCount !== a.txCount) return b.txCount - a.txCount;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });
}

function salesPurchasesTip(row) {
  return `Sales  ${formatAmount(row?.soAmount)}\nPurchases  ${formatAmount(row?.poAmount)}`;
}

function rowMatchesAllocatedStore(row, storeName) {
  const store = String(row?.storeName || row?.store || '').trim();
  const location = String(storeName || '').trim();
  if (!store || !location) return false;
  if (store.localeCompare(location, undefined, { sensitivity: 'base' }) === 0) return true;
  const a = store.toLowerCase();
  const b = location.toLowerCase();
  return a.includes(b) || b.includes(a);
}

function ProfileAvatar({ uri, name, size = 24, style }) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [uri]);

  const initials = initialsFromName(name);
  const showImage = Boolean(uri) && !failed;

  return (
    <View
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#e8e8ed',
          overflow: 'hidden',
        },
        style,
      ]}
    >
      {showImage ? (
        <Image
          source={{ uri }}
          style={{ width: size, height: size }}
          onError={() => setFailed(true)}
        />
      ) : initials ? (
        <Text
          style={{
            fontFamily,
            fontSize: Math.max(10, Math.round(size * 0.38)),
            fontWeight: '600',
            color: '#1d1d1f',
          }}
        >
          {initials}
        </Text>
      ) : (
        <Ionicons name="person" size={Math.round(size * 0.5)} color="#8e8e93" />
      )}
    </View>
  );
}

function ToolCard({
  tool,
  pinned,
  onPress,
  onTogglePin,
  wrapStyle,
  iconSize = APP_ICON_SIZE,
  selected = false,
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const hovered = useRef(false);
  const [isHovered, setIsHovered] = useState(false);
  const showPin = typeof onTogglePin === 'function';
  const radius = Math.round(iconSize * 0.223);
  const glyphSize = Math.round(iconSize * 0.44);

  const animateTo = (nextScale, duration = 160) => {
    Animated.timing(scale, {
      toValue: nextScale,
      duration,
      useNativeDriver: true,
    }).start();
  };

  const handleHoverIn = () => {
    hovered.current = true;
    setIsHovered(true);
    animateTo(1.04, 140);
  };

  const handleHoverOut = () => {
    hovered.current = false;
    setIsHovered(false);
    animateTo(1, 140);
  };

  const handlePressIn = () => {
    animateTo(0.9, 80);
  };

  const handlePressOut = () => {
    animateTo(hovered.current ? 1.04 : 1, 120);
  };

  return (
    <Animated.View
      style={[
        styles.toolCardWrap,
        wrapStyle,
        { transform: [{ scale }] },
      ]}
      onMouseEnter={handleHoverIn}
      onMouseLeave={handleHoverOut}
    >
      <View style={styles.toolCard}>
        <View style={styles.toolIconStack}>
          <Pressable
            onPress={onPress}
            onPressIn={handlePressIn}
            onPressOut={handlePressOut}
            accessibilityRole="button"
            accessibilityLabel={tool.label}
          >
            <View
              style={[
                styles.toolIconTile,
                selected && styles.toolIconTileSelected,
                {
                  width: iconSize,
                  height: iconSize,
                  borderRadius: radius,
                  backgroundColor: tool.accent,
                },
              ]}
            >
              <Ionicons name={filledIonicon(tool.icon)} size={glyphSize} color="#fff" />
            </View>
          </Pressable>
          {showPin ? (
            <Pressable
              style={[
                styles.pinButton,
                (isHovered || pinned) && styles.pinButtonVisible,
                pinned && styles.pinButtonActive,
              ]}
              {...(Platform.OS === 'web' ? { className: 'cgold-pin-button' } : null)}
              onPress={onTogglePin}
              pointerEvents={isHovered || pinned ? 'auto' : 'none'}
              hitSlop={8}
              accessibilityLabel={pinned ? `Unpin ${tool.label}` : `Pin ${tool.label}`}
            >
              <Ionicons
                name={pinned ? 'pin' : 'pin-outline'}
                size={11}
                color={pinned ? '#1a1a1a' : '#6b6b6b'}
              />
            </Pressable>
          ) : null}
        </View>
        <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={tool.label}>
          <Text
            style={[styles.toolCardLabel, selected && styles.toolCardLabelSelected]}
            numberOfLines={2}
            selectable={false}
          >
            {tool.label}
          </Text>
        </Pressable>
      </View>
    </Animated.View>
  );
}

function ToolsGrid({
  tools,
  pinnedKeys,
  onOpen,
  onTogglePin,
  columns = APP_COLUMNS,
  iconSize = APP_ICON_SIZE,
  gap = APP_GAP,
  rowGap = 22,
  selectedKey,
}) {
  const itemStyle = {
    width: `${100 / columns}%`,
    maxWidth: `${100 / columns}%`,
    paddingHorizontal: gap / 2,
  };
  const canPin = typeof onTogglePin === 'function';
  const pins = pinnedKeys || [];

  return (
    <View style={[styles.toolsGrid, { marginHorizontal: -(gap / 2), rowGap }]}>
      {tools.map((tool) => (
        <ToolCard
          key={tool.key}
          tool={tool}
          pinned={pins.includes(tool.key)}
          selected={Boolean(selectedKey) && tool.key === selectedKey}
          onPress={() => onOpen(tool)}
          onTogglePin={canPin ? () => onTogglePin(tool.key) : undefined}
          wrapStyle={itemStyle}
          iconSize={iconSize}
        />
      ))}
    </View>
  );
}

function ToolListRow({ tool, pinned, onPress, onTogglePin, last }) {
  const [isHovered, setIsHovered] = useState(false);
  const iconSize = 32;
  const radius = Math.round(iconSize * 0.223);

  return (
    <View
      style={[
        styles.toolListRow,
        isHovered && styles.toolListRowHovered,
        last && styles.toolListRowLast,
      ]}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <Pressable
        style={styles.toolListMain}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={tool.label}
      >
        <View
          style={[
            styles.toolListIcon,
            {
              width: iconSize,
              height: iconSize,
              borderRadius: radius,
              backgroundColor: tool.accent,
            },
          ]}
        >
          <Ionicons name={filledIonicon(tool.icon)} size={16} color="#fff" />
        </View>
        <Text style={styles.toolListLabel} numberOfLines={1} selectable={false}>
          {tool.label}
        </Text>
      </Pressable>
      <Pressable
        style={styles.toolListPin}
        onPress={onTogglePin}
        hitSlop={8}
        accessibilityLabel={pinned ? `Unpin ${tool.label}` : `Pin ${tool.label}`}
      >
        <Ionicons
          name={pinned ? 'pin' : 'pin-outline'}
          size={16}
          color={pinned ? '#1a1a1a' : '#c7c7cc'}
        />
      </Pressable>
    </View>
  );
}

function ToolsList({ tools, pinnedKeys, onOpen, onTogglePin }) {
  return (
    <View style={styles.toolsList}>
      {tools.map((tool, index) => (
        <ToolListRow
          key={tool.key}
          tool={tool}
          pinned={pinnedKeys.includes(tool.key)}
          onPress={() => onOpen(tool)}
          onTogglePin={() => onTogglePin(tool.key)}
          last={index === tools.length - 1}
        />
      ))}
    </View>
  );
}

function DatePickerField({
  label,
  value,
  onChange,
  minimumDate,
  maximumDate,
  plain = false,
  compact = false,
  fill = false,
}) {
  const [open, setOpen] = useState(false);
  const dateValue = parseDateParam(value);
  const chipStyle = [
    compact ? styles.homeDateFieldCompact : plain ? styles.homeDateField : styles.dateChip,
    fill && styles.homeDateFieldFill,
  ];
  const iconColor = plain || compact ? '#8e8e93' : '#6b6b6b';
  const valueSize = compact ? 13 : plain ? 16 : 13;
  const calendarSize = compact ? 13 : plain ? 16 : 14;
  const hideLabel = plain || compact;

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
      <View style={chipStyle}>
        {hideLabel ? null : <Text style={styles.dateChipLabel}>{label}</Text>}
        <View style={styles.dateChipControl}>
          <Ionicons name="calendar-outline" size={calendarSize} color={iconColor} />
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
              fontSize: valueSize,
              color: '#1d1d1f',
              padding: 0,
              margin: 0,
              outline: 'none',
              cursor: 'pointer',
              minWidth: compact ? 92 : fill ? 100 : plain ? 108 : 118,
            },
          })}
        </View>
      </View>
    );
  }

  return (
    <>
      <Pressable style={chipStyle} onPress={() => setOpen(true)}>
        {hideLabel ? null : <Text style={styles.dateChipLabel}>{label}</Text>}
        <View style={styles.dateChipControl}>
          <Ionicons name="calendar-outline" size={calendarSize} color={iconColor} />
          <Text
            style={[
              styles.dateChipValue,
              plain && styles.homeDateFieldValue,
              compact && styles.homeDateFieldValueCompact,
            ]}
          >
            {formatPickerDate(dateValue)}
          </Text>
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

const TransactionListRow = memo(function TransactionListRow({
  item,
  selected,
  onPress,
  employeeCount,
  employeePhotoUrl = '',
  onAmountHover,
  hideStore = false,
  cashSaved = false,
  onCashPress,
}) {
  const [splitTip, setSplitTip] = useState('');
  const [splitAnchor, setSplitAnchor] = useState(null);
  const [employeeAnchor, setEmployeeAnchor] = useState(null);
  const fintrac = isFintracCash(item);
  const isBuy = item.type === 'purchase';
  const showCash = typeof onCashPress === 'function' && isCashTransaction(item);
  const employeeName = item.employeeName || '—';

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

  return (
    <Pressable
      onPress={() => onPress(item)}
      style={({ hovered, pressed }) => [
        styles.txTableRow,
        (hovered || pressed) && styles.toolListRowHovered,
        selected && styles.txListRowSelected,
      ]}
      accessibilityRole="button"
      accessibilityLabel={`${isBuy ? 'PO' : 'SO'} ${item.customerName || ''} ${item.amountLabel || ''}`}
      {...(Platform.OS === 'web'
        ? { className: selected ? 'cgold-tx-row cgold-tx-row-selected' : 'cgold-tx-row' }
        : null)}
    >
      {hideStore ? null : (
        <Text style={[styles.txTableCell, styles.colStore]} numberOfLines={1}>
          {item.storeName || '—'}
        </Text>
      )}
      <Text style={[styles.txTableCell, styles.txTableCellSecondary, styles.colDate]} numberOfLines={1}>
        {item.dateLabel}
      </Text>
      <Text style={[styles.txTableCell, styles.txTableCellSecondary, styles.colTime]} numberOfLines={1}>
        {item.timeLabel}
      </Text>
      <View style={[styles.txTableRef, styles.colRef]}>
        <Text style={[styles.txTableKind, isBuy && styles.txTableKindBuy]}>
          {isBuy ? 'PO' : 'SO'}
        </Text>
        <Text style={[styles.txTableCell, styles.txTableCellSecondary]} numberOfLines={1}>
          {item.reference}
        </Text>
      </View>
      <Text style={[styles.txTableCell, styles.txTableCellPrimary, styles.colCustomer]} numberOfLines={1}>
        {item.customerName || '—'}
      </Text>
      <View style={styles.colPayment} {...splitHover}>
        <Text style={styles.txTableCell} numberOfLines={1}>
          {item.paymentMethodLabel || '—'}
        </Text>
      </View>
      <View style={[styles.txTableAmount, styles.colAmount]} {...splitHover}>
        {showCash ? (
          <TxnCashIcon saved={cashSaved} onPress={() => onCashPress(item)} />
        ) : null}
        {fintrac ? <View style={styles.fintracDot} /> : null}
        <Text
          style={[styles.txTableAmountText, fintrac && styles.amountCellFintrac]}
          numberOfLines={1}
        >
          {item.amountLabel}
        </Text>
      </View>
      <View
        style={[styles.colEmployee, styles.txEmployeeCell]}
        {...(Platform.OS === 'web'
          ? {
              onMouseEnter: (event) => setEmployeeAnchor(event?.currentTarget || null),
              onMouseLeave: () => setEmployeeAnchor(null),
            }
          : null)}
      >
        <ProfileAvatar uri={employeePhotoUrl} name={employeeName} size={24} />
        <Text style={[styles.txTableCell, styles.txTableCellSecondary]} numberOfLines={1}>
          {employeeName}
        </Text>
        <FloatingTooltip
          visible={Boolean(employeeAnchor)}
          text={`${employeeCount} transaction${employeeCount === 1 ? '' : 's'} in this period`}
          anchorEl={employeeAnchor}
          align="end"
        />
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

function FloatingTooltip({ visible, text, anchorEl, align = 'start', placement = 'bottom' }) {
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

  const style =
    placement === 'left'
      ? {
          top: coords.y + coords.height / 2,
          right: Math.max(8, window.innerWidth - coords.x + 8),
          transform: 'translateY(-50%)',
          minWidth: 'auto',
          whiteSpace: 'nowrap',
        }
      : {
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

function StoreDrawerAppButton({ tab, selected, onPress }) {
  const iconSize = 36;
  const radius = Math.round(iconSize * 0.223);

  return (
    <View style={styles.storeDrawerTabWrap}>
      {Platform.OS === 'web'
        ? createElement(
            'div',
            {
              className: 'cgold-floating-tip',
              style: {
                position: 'absolute',
                right: 56,
                top: '50%',
                transform: 'translateY(-50%)',
                minWidth: 'auto',
                whiteSpace: 'nowrap',
              },
            },
            tab.label,
          )
        : (
          <View style={styles.storeDrawerTabTip} pointerEvents="none">
            <View style={styles.storeDrawerTabTipBubble}>
              <Text style={styles.storeDrawerTabTipText} numberOfLines={1}>
                {tab.label}
              </Text>
            </View>
          </View>
        )}
      <Pressable
        onPress={onPress}
        style={({ hovered, pressed }) => [
          styles.storeDrawerTab,
          (hovered || pressed) && !selected && styles.tabHover,
          selected && styles.storeDrawerTabSelected,
        ]}
        accessibilityLabel={tab.label}
        accessibilityRole="button"
        accessibilityState={{ selected }}
      >
        <View
          style={[
            styles.toolIconTile,
            {
              width: iconSize,
              height: iconSize,
              borderRadius: radius,
              backgroundColor: tab.accent,
            },
          ]}
        >
          <Ionicons name={filledIonicon(tab.icon)} size={18} color="#fff" />
        </View>
      </Pressable>
    </View>
  );
}

function AppleDetailRow({ label, value, sub, last, dense, onPress, accessibilityLabel }) {
  const content = (
    <>
      <Text style={[styles.appleDetailLabel, dense && styles.txDetailLabel]}>{label}</Text>
      <View style={styles.appleDetailValueWrap}>
        <Text style={[styles.appleDetailValue, dense && styles.txDetailValue]} numberOfLines={2}>
          {value || '—'}
        </Text>
        {sub ? (
          <Text style={[styles.appleDetailSub, dense && styles.txDetailSub]} numberOfLines={2}>
            {sub}
          </Text>
        ) : null}
      </View>
      {onPress ? <Ionicons name="chevron-forward" size={16} color="#c7c7cc" /> : null}
    </>
  );

  const rowStyle = [
    styles.appleDetailRow,
    onPress && styles.appleDetailRowTappable,
    dense && styles.txDetailRow,
    last && styles.toolListRowLast,
  ];

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel || `${label}, ${value || 'Not set'}`}
        style={({ pressed, hovered }) => [
          rowStyle,
          (hovered || pressed) && styles.toolListRowHovered,
        ]}
      >
        {content}
      </Pressable>
    );
  }

  return <View style={rowStyle}>{content}</View>;
}

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

  if (candidates.length) {
    const primary = candidates[0];
    const quality = item?.quality_mark_description
      ? String(item.quality_mark_description).trim()
      : '';
    if (
      quality &&
      !primary.toLowerCase().includes(quality.toLowerCase()) &&
      quality.toLowerCase() !== primary.toLowerCase()
    ) {
      return `${primary} · ${quality}`;
    }
    return primary;
  }

  if (product?.metal?.name) {
    return product?.type === 'scrap'
      ? `Scrap ${product.metal.name}`
      : product.metal.name;
  }

  return 'Untitled item';
}

function lineItemMeta(item) {
  const product = item?.product;
  const bits = [];
  const name = lineItemName(item).toLowerCase();

  if (product?.sku && !name.includes(String(product.sku).toLowerCase())) {
    bits.push(product.sku);
  } else if (
    product?.code &&
    !name.includes(String(product.code).toLowerCase()) &&
    product.code !== product?.sku
  ) {
    bits.push(product.code);
  }

  if (item?.purity != null && item.purity !== '') {
    bits.push(`${item.purity}%`);
  }

  if (item?.unit_type) {
    const qty = item.quantity ?? item.gross_quantity;
    if (qty != null) bits.push(`${qty} ${item.unit_type}`);
  }

  return bits.join(' · ');
}

function toQtyNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function formatLineQty(value) {
  const n = toQtyNumber(value);
  if (n == null) return '—';
  if (Object.is(n, -0)) return '0';
  if (Number.isInteger(n)) return String(n);
  return String(Math.round(n * 1000) / 1000);
}

function collectImageUrls(images) {
  const urls = [];
  const seen = new Set();
  for (const image of Array.isArray(images) ? images : []) {
    const url = String(image?.url || image?.thumbnail || image || '').trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
  }
  return urls;
}

function lineItemImages(item) {
  const fromItem = collectImageUrls(item?.images);
  if (fromItem.length) return fromItem;
  return collectImageUrls(item?.product?.images);
}

function lineItemOrderedQty(item) {
  return toQtyNumber(item?.quantity ?? item?.gross_quantity) ?? 0;
}

function lineItemDeliveredQty(item) {
  const fulfilled = toQtyNumber(item?.fulfilled_quantity ?? item?.gross_fulfilled_quantity);
  if (fulfilled != null) return fulfilled;
  const deliveries = Array.isArray(item?.deliveries) ? item.deliveries : [];
  return deliveries.reduce(
    (sum, entry) => sum + (toQtyNumber(entry?.quantity ?? entry?.gross_quantity) || 0),
    0,
  );
}

function lineDeliveryState(item) {
  const ordered = lineItemOrderedQty(item);
  const delivered = lineItemDeliveredQty(item);
  if (delivered <= 0.0005) {
    return { key: 'undelivered', label: 'Undelivered', ordered, delivered };
  }
  if (ordered > 0 && delivered + 0.0005 < ordered) {
    return { key: 'partial', label: 'Partial', ordered, delivered };
  }
  return { key: 'delivered', label: 'Delivered', ordered, delivered };
}

function allocationState(detail) {
  if (!detail) return null;
  const raw = String(detail.allocation_status || '').trim();
  const allocated = toQtyNumber(detail.allocated_amount);
  const total = toQtyNumber(detail.total_amount);
  if (/partial/i.test(raw)) {
    return { key: 'partial', label: 'Partially allocated', raw, allocated, total };
  }
  if (/not paid|unallocated|unpaid|to be received/i.test(raw)) {
    return { key: 'unallocated', label: 'Unallocated', raw, allocated, total };
  }
  if (/paid|allocated|overpaid/i.test(raw)) {
    return { key: 'allocated', label: 'Allocated', raw, allocated, total };
  }
  if (allocated != null && total != null) {
    if (allocated <= 0.005) {
      return { key: 'unallocated', label: 'Unallocated', raw, allocated, total };
    }
    if (allocated + 0.005 < total) {
      return { key: 'partial', label: 'Partially allocated', raw, allocated, total };
    }
    return { key: 'allocated', label: 'Allocated', raw, allocated, total };
  }
  return raw ? { key: 'unknown', label: raw, raw, allocated, total } : null;
}

function documentDeliveryState(detail, items) {
  const lines = items.map(lineDeliveryState);
  const deliveredLines = lines.filter((line) => line.key === 'delivered').length;
  const partialLines = lines.filter((line) => line.key === 'partial').length;
  const ordered = lines.reduce((sum, line) => sum + line.ordered, 0);
  const delivered = lines.reduce((sum, line) => sum + line.delivered, 0);
  const itemStatus = String(detail?.item_status || '').trim();

  let key = 'undelivered';
  let label = 'Undelivered';
  if (lines.length && deliveredLines === lines.length) {
    key = 'delivered';
    label = 'Delivered';
  } else if (delivered > 0.0005 || partialLines > 0) {
    key = 'partial';
    label = 'Partially delivered';
  } else if (/sent|received|delivered|complete|fulfilled/i.test(itemStatus)) {
    key = 'delivered';
    label = 'Delivered';
  }

  return {
    key,
    label,
    ordered,
    delivered,
    deliveredLines,
    lineCount: lines.length,
    itemStatus,
  };
}

function statusTone(key) {
  if (key === 'allocated' || key === 'delivered') return 'ok';
  if (key === 'partial') return 'warn';
  if (key === 'unallocated' || key === 'undelivered') return 'muted';
  return 'neutral';
}

function TxStatusChip({ label, tone = 'neutral' }) {
  return (
    <View
      style={[
        styles.txStatusChip,
        tone === 'ok' && styles.txStatusChipOk,
        tone === 'warn' && styles.txStatusChipWarn,
        tone === 'muted' && styles.txStatusChipMuted,
      ]}
    >
      <Text
        style={[
          styles.txStatusChipText,
          tone === 'ok' && styles.txStatusChipTextOk,
          tone === 'warn' && styles.txStatusChipTextWarn,
          tone === 'muted' && styles.txStatusChipTextMuted,
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

function LineItemThumb({ urls, name }) {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
    setIndex(0);
  }, [urls[0]]);

  if (!urls.length || failed) {
    return <View style={styles.txLineThumbSlot} />;
  }

  const current = urls[Math.min(index, urls.length - 1)];
  const hasMany = urls.length > 1;

  return (
    <>
      <Pressable
        onPress={() => {
          setIndex(0);
          setOpen(true);
        }}
        style={styles.txLineThumbPress}
        accessibilityRole="button"
        accessibilityLabel={`View photo of ${name}`}
      >
        <Image
          source={{ uri: urls[0] }}
          style={styles.txLineThumb}
          resizeMode="cover"
          onError={() => setFailed(true)}
        />
        {hasMany ? (
          <View style={styles.txLineThumbBadge}>
            <Text style={styles.txLineThumbBadgeText}>{urls.length}</Text>
          </View>
        ) : null}
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={styles.txImageViewerRoot}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setOpen(false)} />
          <View style={styles.txImageViewerSheet} pointerEvents="box-none">
            <View style={styles.txImageViewerBar}>
              <Text style={styles.txImageViewerTitle} numberOfLines={1}>
                {name}
                {hasMany ? `  ${index + 1}/${urls.length}` : ''}
              </Text>
              <Pressable
                onPress={() => setOpen(false)}
                hitSlop={8}
                style={styles.appleCloseButton}
                accessibilityLabel="Close photo"
              >
                <Ionicons name="close" size={18} color="#1d1d1f" />
              </Pressable>
            </View>
            <Image
              source={{ uri: current }}
              style={styles.txImageViewerImage}
              resizeMode="contain"
            />
            {hasMany ? (
              <View style={styles.txImageViewerNav}>
                <Pressable
                  onPress={() => setIndex((currentIndex) => (currentIndex - 1 + urls.length) % urls.length)}
                  style={styles.txImageViewerNavBtn}
                  accessibilityLabel="Previous photo"
                >
                  <Ionicons name="chevron-back" size={20} color="#fff" />
                </Pressable>
                <Pressable
                  onPress={() => setIndex((currentIndex) => (currentIndex + 1) % urls.length)}
                  style={styles.txImageViewerNavBtn}
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

const DRAWER_OPEN_MS = 280;
const DRAWER_CLOSE_MS = 220;

function useRightDrawerAnimation(visible, slideDistance) {
  const [mounted, setMounted] = useState(visible);
  // True once the open animation has finished; lets callers defer heavy
  // work (large lists, backdrop blur) until the panel has stopped moving.
  const [settled, setSettled] = useState(false);
  const slide = useRef(new Animated.Value(slideDistance)).current;
  const backdrop = useRef(new Animated.Value(0)).current;
  const slideDistanceRef = useRef(slideDistance);
  const activeAnim = useRef(null);
  slideDistanceRef.current = slideDistance;

  const stopActiveAnim = () => {
    if (activeAnim.current) {
      activeAnim.current.stop();
      activeAnim.current = null;
    }
  };

  useEffect(() => {
    if (!mounted) {
      slide.setValue(slideDistance);
    }
  }, [slideDistance, mounted, slide]);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      return undefined;
    }

    if (!mounted) return undefined;

    stopActiveAnim();
    setSettled(false);
    const anim = Animated.parallel([
      Animated.timing(slide, {
        toValue: slideDistanceRef.current,
        duration: DRAWER_CLOSE_MS,
        easing: Easing.bezier(0.4, 0, 0.2, 1),
        useNativeDriver: true,
      }),
      Animated.timing(backdrop, {
        toValue: 0,
        duration: DRAWER_CLOSE_MS,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    ]);
    activeAnim.current = anim;

    anim.start(({ finished }) => {
      if (activeAnim.current === anim) activeAnim.current = null;
      if (finished) setMounted(false);
    });

    return () => {
      if (activeAnim.current === anim) {
        anim.stop();
        activeAnim.current = null;
      }
    };
  }, [visible, mounted, slide, backdrop]);

  useLayoutEffect(() => {
    if (!visible || !mounted) return undefined;

    stopActiveAnim();
    slide.setValue(slideDistanceRef.current);
    backdrop.setValue(0);
    setSettled(false);

    let cancelled = false;
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        if (cancelled) return;
        const anim = Animated.parallel([
          Animated.timing(slide, {
            toValue: 0,
            duration: DRAWER_OPEN_MS,
            easing: Easing.bezier(0.2, 0.8, 0.2, 1),
            useNativeDriver: true,
          }),
          Animated.timing(backdrop, {
            toValue: 1,
            duration: DRAWER_OPEN_MS,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
        ]);
        activeAnim.current = anim;
        anim.start(({ finished }) => {
          if (finished && activeAnim.current === anim) activeAnim.current = null;
          if (finished) setSettled(true);
        });
      });
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [visible, mounted, slide, backdrop]);

  return { mounted, slide, backdrop, settled };
}

function useHeldValue(value) {
  const held = useRef(value);
  if (value != null) held.current = value;
  return value ?? held.current;
}

function TransactionDetailDrawer({ visible, summary, detail, loading, error, onClose }) {
  const { width: windowWidth } = useWindowDimensions();
  const isMobile = windowWidth < MOBILE_BREAKPOINT;
  const [activeApp, setActiveApp] = useState(null);
  const { hasApp } = useAppAccess();
  const visibleTabs = TRANSACTION_DETAIL_TABS.filter((tab) => hasApp(tab.key));
  const showRail = visibleTabs.length > 0;
  const railWidth = showRail ? STORE_DRAWER_RAIL_WIDTH : 0;
  const panelWidth = isMobile
    ? Math.max(windowWidth - railWidth, 240)
    : Math.min(
        Math.max(Math.round(windowWidth * 0.82), 640),
        Math.round(windowWidth - 56),
      );
  const slideDistance = panelWidth + railWidth;
  const { mounted, slide, backdrop } = useRightDrawerAnimation(visible, slideDistance);
  const heldSummary = useHeldValue(summary);
  const heldDetail = useHeldValue(detail);

  useEffect(() => {
    if (visible) {
      setActiveApp(null);
    }
  }, [visible]);

  if (!mounted || !heldSummary) return null;

  const client = heldDetail?.client;
  const clientName = client
    ? [client.first_name, client.last_name].filter(Boolean).join(' ').trim()
    : heldSummary.customerName;
  const location = heldDetail?.location;
  const locationName = location?.name || heldSummary.storeName;
  const locationLine = location
    ? [location.address_1, location.city, location.state, location.zip].filter(Boolean).join(', ')
    : null;
  const items = Array.isArray(heldDetail?.items) ? heldDetail.items : [];
  const payments = Array.isArray(heldDetail?.payments) ? heldDetail.payments : [];
  const totalAmount = heldDetail?.total_amount ?? heldSummary.amount;
  const isPurchase = heldSummary.type === 'purchase';
  const docLabel = isPurchase ? 'Purchase order' : 'Sales invoice';
  const docKind = isPurchase ? 'PO' : 'SO';
  const partyLabel = isPurchase ? 'Vendor / customer' : 'Bill to';
  const allocation = heldDetail ? allocationState(heldDetail) : null;
  const delivery = heldDetail ? documentDeliveryState(heldDetail, items) : null;
  const paymentStatus = String(heldDetail?.payment_status || '').trim();
  const activeTool = visibleTabs.find((tab) => tab.key === activeApp);

  return (
    <Modal visible={mounted} transparent animationType="none" onRequestClose={onClose}>
      <View style={styles.drawerRoot}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose}>
          <Animated.View style={[styles.drawerBackdrop, { opacity: backdrop }]} />
        </Pressable>

        <Animated.View
          style={[
            styles.storeDrawerShell,
            { transform: [{ translateX: slide }] },
          ]}
        >
          {showRail ? (
            <View style={styles.storeDrawerAppsRail}>
              {visibleTabs.map((tab) => (
                <StoreDrawerAppButton
                  key={tab.key}
                  tab={tab}
                  selected={tab.key === activeApp}
                  onPress={() =>
                    setActiveApp((current) => (current === tab.key ? null : tab.key))
                  }
                />
              ))}
            </View>
          ) : null}

          <View style={[styles.drawerPanel, styles.appleSheetPanel, { width: panelWidth }]}>
            <View
              style={[
                styles.invoiceTopBar,
                styles.txSheetTopBar,
                isMobile && styles.invoiceTopBarMobile,
              ]}
              {...(Platform.OS === 'web' && isMobile ? { className: 'cgold-mobile-sheet-top' } : null)}
            >
              <Text style={styles.appleSheetTitle} numberOfLines={1}>
                {activeTool ? activeTool.label : docLabel}
              </Text>
              <Pressable
                onPress={onClose}
                hitSlop={8}
                style={styles.appleCloseButton}
                accessibilityLabel="Close"
              >
                <Ionicons name="close" size={18} color="#1d1d1f" />
              </Pressable>
            </View>

            <ScrollView
              style={styles.drawerBody}
              contentContainerStyle={[
                styles.drawerBodyContent,
                styles.txSheetBodyContent,
                isMobile && styles.drawerBodyContentMobile,
              ]}
              showsVerticalScrollIndicator={false}
            >
              {activeTool ? (
                <View style={styles.storeDrawerPlaceholder}>
                  <View
                    style={[
                      styles.toolIconTile,
                      styles.storeDrawerPlaceholderIcon,
                      { backgroundColor: activeTool.accent },
                    ]}
                  >
                    <Ionicons name={filledIonicon(activeTool.icon)} size={28} color="#fff" />
                  </View>
                  <Text style={styles.storeDrawerPlaceholderTitle}>{activeTool.label}</Text>
                  <Text style={styles.storeDrawerPlaceholderBody}>
                    {activeTool.label} for {heldSummary.reference} is coming soon.
                  </Text>
                </View>
              ) : (
                <>
                  <View style={styles.txSheetHero}>
                    <View style={styles.txSheetHeroRow}>
                      <View style={styles.txSheetHeroLeft}>
                        <Text style={styles.txSheetCustomer} numberOfLines={1}>
                          {clientName || '—'}
                        </Text>
                        <Text style={styles.txSheetMeta} numberOfLines={1}>
                          {heldSummary.reference}
                          {heldSummary.dateLabel
                            ? ` · ${heldSummary.dateLabel} ${heldSummary.timeLabel || ''}`.trim()
                            : ''}
                        </Text>
                      </View>
                      <Text style={styles.txSheetAmount}>{formatAmount(totalAmount)}</Text>
                    </View>
                    <View style={styles.txStatusRow}>
                      <TxStatusChip label={`${docKind} on file`} tone="neutral" />
                      {allocation ? (
                        <TxStatusChip
                          label={allocation.label}
                          tone={statusTone(allocation.key)}
                        />
                      ) : null}
                      {delivery ? (
                        <TxStatusChip
                          label={delivery.label}
                          tone={statusTone(delivery.key)}
                        />
                      ) : null}
                      {paymentStatus ? (
                        <TxStatusChip label={paymentStatus} tone="neutral" />
                      ) : null}
                    </View>
                  </View>

                  <View style={styles.txMetaGrid}>
                    <View style={[styles.appleGroup, styles.txMetaCol]}>
                      <AppleDetailRow
                        dense
                        label="Document"
                        value={`${docLabel} ${heldSummary.reference}`}
                        sub="On file whether allocated or delivered"
                      />
                      <AppleDetailRow
                        dense
                        label="Allocation"
                        value={
                          allocation
                            ? allocation.allocated != null && allocation.total != null
                              ? `${allocation.label} · ${formatAmount(allocation.allocated)} of ${formatAmount(allocation.total)}`
                              : allocation.label
                            : '—'
                        }
                        sub={
                          allocation?.raw && allocation.raw !== allocation.label
                            ? allocation.raw
                            : null
                        }
                      />
                      {delivery ? (
                        <AppleDetailRow
                          dense
                          label="Delivery"
                          value={
                            delivery.lineCount
                              ? `${delivery.label} · ${formatLineQty(delivery.delivered)} of ${formatLineQty(delivery.ordered)}`
                              : delivery.label
                          }
                          sub={
                            delivery.lineCount
                              ? `${delivery.deliveredLines} of ${delivery.lineCount} line${delivery.lineCount === 1 ? '' : 's'} fully delivered`
                              : null
                          }
                          last
                        />
                      ) : (
                        <AppleDetailRow dense label="Delivery" value="—" last />
                      )}
                    </View>
                    <View style={[styles.appleGroup, styles.txMetaCol]}>
                      <AppleDetailRow dense label={partyLabel} value={clientName} />
                      {client?.email ? (
                        <AppleDetailRow dense label="Email" value={client.email} />
                      ) : null}
                      {client?.phone || client?.alternate_phone ? (
                        <AppleDetailRow
                          dense
                          label="Phone"
                          value={client?.phone || client?.alternate_phone}
                        />
                      ) : null}
                      <AppleDetailRow dense label="Store" value={locationName} sub={locationLine} />
                      <AppleDetailRow
                        dense
                        label="Employee"
                        value={heldSummary.employeeName}
                        last
                      />
                    </View>
                  </View>

                  {loading ? (
                    <View style={styles.drawerLoading}>
                      <ActivityIndicator color="#1d1d1f" />
                    </View>
                  ) : null}

                  {error ? <Text style={styles.errorText}>{error}</Text> : null}

                  {!loading ? (
                    <View style={styles.txSheetSection}>
                      <Text style={styles.txSheetSectionLabel}>Line items</Text>
                      <View style={styles.appleGroup}>
                        <View style={styles.txTableHeader}>
                          <View style={styles.txLineThumbSlot} />
                          <Text style={[styles.txLineItem, styles.txTableHeaderText]}>
                            Item
                          </Text>
                          <Text style={[styles.txColQty, styles.txTableHeaderText]}>Qty</Text>
                          <Text style={[styles.txColDelivered, styles.txTableHeaderText]}>
                            Delivered
                          </Text>
                          <Text style={[styles.txColUnit, styles.txTableHeaderText]}>
                            Unit
                          </Text>
                          <Text style={[styles.txColAmount, styles.txTableHeaderText]}>
                            Amount
                          </Text>
                        </View>

                        {items.length === 0 ? (
                          <Text style={styles.homeTxEmpty}>No line items</Text>
                        ) : (
                          items.map((item, index) => {
                            const name = lineItemName(item);
                            const meta = lineItemMeta(item);
                            const images = lineItemImages(item);
                            const lineDelivery = lineDeliveryState(item);
                            const money = lineItemMoney(item);
                            const unitType = item?.unit_type || (money.grossQuantity ? 'g' : '');
                            return (
                              <View
                                key={item.id || `${name}-${index}`}
                                style={[
                                  styles.txLineRow,
                                  index === items.length - 1 &&
                                    !heldDetail?.total_charges &&
                                    styles.toolListRowLast,
                                ]}
                              >
                                <LineItemThumb urls={images} name={name} />
                                <View style={styles.txLineItem}>
                                  <Text style={styles.txLineName} numberOfLines={2}>
                                    {name}
                                  </Text>
                                  {meta ? (
                                    <Text style={styles.txLineMeta} numberOfLines={1}>
                                      {meta}
                                    </Text>
                                  ) : null}
                                </View>
                                <Text style={[styles.txColQty, styles.txLineCell]}>
                                  {formatLineQty(lineDelivery.ordered)}
                                </Text>
                                <View style={styles.txColDelivered}>
                                  <Text
                                    style={[
                                      styles.txLineCell,
                                      styles.txLineDeliveredQty,
                                      lineDelivery.key === 'delivered' && styles.txLineOk,
                                      lineDelivery.key === 'partial' && styles.txLineWarn,
                                      lineDelivery.key === 'undelivered' && styles.txLineMuted,
                                    ]}
                                  >
                                    {formatLineQty(lineDelivery.delivered)} of{' '}
                                    {formatLineQty(lineDelivery.ordered)}
                                  </Text>
                                  <Text
                                    style={[
                                      styles.txLineDeliveredLabel,
                                      lineDelivery.key === 'delivered' && styles.txLineOk,
                                      lineDelivery.key === 'partial' && styles.txLineWarn,
                                      lineDelivery.key === 'undelivered' && styles.txLineMuted,
                                    ]}
                                  >
                                    {lineDelivery.label}
                                  </Text>
                                </View>
                                <Text style={[styles.txColUnit, styles.txLineCell]}>
                                  {formatUnitCost(money.displayUnitPrice, unitType)}
                                </Text>
                                <Text style={[styles.txColAmount, styles.txLineCell]}>
                                  {formatAmount(money.lineTotal)}
                                </Text>
                              </View>
                            );
                          })
                        )}

                        {heldDetail?.total_charges ? (
                          <View style={styles.txLineRow}>
                            <View style={styles.txLineThumbSlot} />
                            <Text style={styles.txLineMutedFlex}>Charges</Text>
                            <Text style={[styles.txColAmount, styles.txLineMuted]}>
                              {formatAmount(heldDetail.total_charges)}
                            </Text>
                          </View>
                        ) : null}
                        <View style={[styles.txLineRow, styles.toolListRowLast]}>
                          <View style={styles.txLineThumbSlot} />
                          <Text style={styles.txLineTotalLabel}>Total</Text>
                          <Text style={[styles.txColAmount, styles.txLineTotalValue]}>
                            {formatAmount(totalAmount)}
                          </Text>
                        </View>
                      </View>
                    </View>
                  ) : null}

                  {!loading && payments.length > 0 ? (
                    <View style={styles.txSheetSection}>
                      <Text style={styles.txSheetSectionLabel}>Payments</Text>
                      <View style={styles.appleGroup}>
                        {payments.map((entry, index) => {
                          const payment = entry.payment || entry;
                          const method =
                            payment.payment_type?.name ||
                            entry.payment?.payment_type?.name ||
                            'Payment';
                          const payAlloc = String(
                            payment.allocation_status || entry.allocation_status || '',
                          ).trim();
                          return (
                            <View
                              key={entry.id || payment.id || `${method}-${index}`}
                              style={[
                                styles.txPaymentRow,
                                index === payments.length - 1 && styles.toolListRowLast,
                              ]}
                            >
                              <View style={styles.invoiceColItem}>
                                <Text style={styles.txLineName}>{method}</Text>
                                <Text style={styles.txLineMeta}>
                                  {[payment.status, payAlloc, payment.date]
                                    .filter(Boolean)
                                    .join(' · ')}
                                </Text>
                              </View>
                              <Text style={[styles.txColAmount, styles.txLineCell]}>
                                {formatAmount(entry.amount ?? payment.amount)}
                              </Text>
                            </View>
                          );
                        })}
                      </View>
                    </View>
                  ) : null}

                  {heldDetail?.comments ? (
                    <View style={styles.txSheetSection}>
                      <Text style={styles.txSheetSectionLabel}>Notes</Text>
                      <View style={styles.appleGroup}>
                        <Text style={styles.txNotes}>{heldDetail.comments}</Text>
                      </View>
                    </View>
                  ) : null}
                </>
              )}
            </ScrollView>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

function sameJson(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

function mergeLiveTxRows(current, incoming) {
  const next = incoming || [];
  if (!next.length) return next;
  const prevById = new Map((current || []).map((row) => [row.id, row]));
  return next.map((row) => {
    const prev = prevById.get(row.id);
    if (!prev) return row;
    return {
      ...row,
      itemNames: prev.itemNames?.length ? prev.itemNames : row.itemNames,
      itemSearchText: prev.itemSearchText || row.itemSearchText,
      pricedLines: prev.pricedLines?.length ? prev.pricedLines : row.pricedLines,
      imageUrls: prev.imageUrls?.length ? prev.imageUrls : row.imageUrls,
      lineItemsLoaded: prev.lineItemsLoaded || row.lineItemsLoaded,
      paymentBreakdown: prev.paymentBreakdown || row.paymentBreakdown,
      paymentBreakdownLabel: prev.paymentBreakdownLabel || row.paymentBreakdownLabel,
    };
  });
}

function HomeStoreDrawer({ visible, store, session, periodLabel = 'Today', date, startKey, endKey, onClose }) {
  const { width: windowWidth } = useWindowDimensions();
  const isMobile = windowWidth < MOBILE_BREAKPOINT;
  const { hasApp } = useAppAccess();
  const drawerTabs = STORE_DRAWER_TABS.filter((tab) => tab.key === 'settings' || hasApp(tab.key));
  const storeName = store?.store || '';
  const overviewTab = {
    key: 'overview',
    label: 'Overview',
    icon: 'storefront-outline',
    accent: storeAccent(storeName),
    tint: storeAccent(storeName),
    solid: true,
  };
  const tabStrip = [overviewTab, ...drawerTabs];
  const appIconSize = isMobile ? 42 : 54;
  const appItemWidth = appIconSize + (isMobile ? 36 : 30);
  const [headerHeight, setHeaderHeight] = useState(null);
  const topInset = headerHeight ?? (isMobile ? 154 : 140);
  const onHeaderLayout = useCallback((event) => {
    const next = Math.round(event?.nativeEvent?.layout?.height || 0);
    if (next > 0) setHeaderHeight((current) => (current === next ? current : next));
  }, []);
  const maxPanelWidth = Math.max(280, windowWidth - (isMobile ? 0 : 28));
  const panelWidth = isMobile
    ? windowWidth
    : Math.min(
        Math.max(Math.round(windowWidth * 0.88), Math.min(760, maxPanelWidth)),
        maxPanelWidth,
      );
  const slideDistance = panelWidth;
  const { mounted, slide, backdrop, settled } = useRightDrawerAnimation(visible, slideDistance);
  // backdrop-filter inside a translating layer forces a full re-composite every
  // frame on web, so keep the header opaque until the slide has finished.
  const blurHeader = Platform.OS !== 'web' || settled;
  const HeaderShell = blurHeader ? BlurView : View;
  const heldStore = useHeldValue(store);
  const [activeTab, setActiveTab] = useState('overview');
  const [txRows, setTxRows] = useState([]);
  const [selectedRow, setSelectedRow] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const detailRequestId = useRef(0);
  const paymentCache = useRef({});
  const [staff, setStaff] = useState([]);

  const lastStoreNameRef = useRef(store?.store);
  const incomingTxKey = (store?.transactions || []).map((row) => row.id).join('\n');
  const openApp = useCallback((key) => {
    if (key === 'overview' || key === 'settings' || hasApp(key)) {
      setActiveTab(key);
    }
  }, [hasApp]);
  // Point the embedded Emails app at this store and the drawer's period.
  const emailsFocus = useMemo(
    () =>
      storeName
        ? { key: `${storeName}|${startKey || ''}|${endKey || ''}`, storeName, startDate: startKey, endDate: endKey }
        : null,
    [endKey, startKey, storeName],
  );

  useEffect(() => {
    const storeChanged = lastStoreNameRef.current !== store?.store;
    lastStoreNameRef.current = store?.store;
    if (storeChanged) paymentCache.current = {};
    const next = store?.transactions || [];
    setTxRows((current) => {
      const merged = storeChanged ? next : mergeLiveTxRows(current, next);
      const prevById = storeChanged ? null : new Map((current || []).map((row) => [row.id, row]));
      let changed = storeChanged || merged.length !== (current || []).length;
      const result = merged.map((row, index) => {
        const cached = paymentCache.current[row.id];
        const enriched = cached
          ? {
              ...row,
              itemNames: cached.itemNames?.length ? cached.itemNames : row.itemNames,
              itemSearchText: cached.itemSearchText || row.itemSearchText,
              pricedLines: cached.pricedLines?.length ? cached.pricedLines : row.pricedLines,
              imageUrls: cached.imageUrls?.length ? cached.imageUrls : row.imageUrls,
              lineItemsLoaded: cached.lineItemsLoaded || row.lineItemsLoaded,
              paymentBreakdown: cached.paymentBreakdown || row.paymentBreakdown,
              paymentBreakdownLabel: cached.paymentBreakdownLabel || row.paymentBreakdownLabel,
            }
          : row;
        // The home screen refreshes every couple of seconds; keep the previous
        // row object when nothing changed so memoized rows below don't re-render.
        const prev = prevById?.get(row.id);
        if (prev && sameJson(prev, enriched)) {
          if (current[index] !== prev) changed = true;
          return prev;
        }
        changed = true;
        return enriched;
      });
      return changed ? result : current;
    });
    setSelectedRow((current) => {
      if (!current) return null;
      const match = next.find((row) => row.id === current.id) || null;
      return match && sameJson(match, current) ? current : match;
    });
  }, [store]);

  useEffect(() => {
    if (visible) {
      setActiveTab('overview');
      return;
    }

    if (!mounted) {
      setSelectedRow(null);
      setDetail(null);
      setDetailError('');
      setDetailLoading(false);
    }
  }, [visible, mounted, store?.store]);

  const employeeCounts = useMemo(() => {
    const counts = {};
    for (const row of txRows) {
      const key = row.employeeName || '—';
      counts[key] = (counts[key] || 0) + 1;
    }
    return counts;
  }, [txRows]);

  const employeePhotos = useMemo(() => {
    const map = {};
    for (const row of txRows) {
      const name = row.employeeName || '';
      if (!name || map[name] != null) continue;
      map[name] = findStaffByEmployeeName(staff, name)?.avatarUrl || '';
    }
    return map;
  }, [txRows, staff]);

  useEffect(() => {
    let cancelled = false;
    listStaffProfiles()
      .then((rows) => {
        if (cancelled) return;
        setStaff((rows || []).filter((row) => row.isActive !== false));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!visible || !session) return undefined;
    const queue = (store?.transactions || []).filter(needsLineItemEnrichment);
    if (!queue.length) return undefined;
    let cancelled = false;

    (async () => {
      const workers = Array.from({ length: Math.min(4, queue.length) }, async () => {
        while (queue.length && !cancelled) {
          const row = queue.shift();
          if (!row || paymentCache.current[row.id]?.lineItemsLoaded) continue;
          try {
            const auth = resolvePosAuthForRow(session, row);
            const detailPayload = await fetchTransactionDetail(auth.token, {
              type: row.type,
              sourceId: row.sourceId,
              baseUrl: auth.baseUrl,
            });
            if (cancelled) return;
            const enriched = withLineItems(row, detailPayload);
            paymentCache.current[row.id] = { ...enriched, lineItemsLoaded: true };
            setTxRows((current) =>
              current.map((entry) => (entry.id === row.id ? enriched : entry)),
            );
          } catch {
            paymentCache.current[row.id] = {
              ...(paymentCache.current[row.id] || row),
              lineItemsLoaded: true,
            };
            setTxRows((current) =>
              current.map((entry) =>
                entry.id === row.id ? { ...entry, lineItemsLoaded: true } : entry,
              ),
            );
          }
        }
      });
      await Promise.all(workers);
    })();

    return () => {
      cancelled = true;
    };
  }, [visible, session, store?.store, incomingTxKey]);

  const cashSlips = useTxnCashBreakdowns(txRows);

  const closeDetail = useCallback(() => {
    setSelectedRow(null);
    setDetail(null);
    setDetailError('');
    setDetailLoading(false);
  }, []);

  const ensurePaymentBreakdown = useCallback(
    async (row) => {
      if (!session?.token || !row) return row?.paymentBreakdownLabel || '';
      if (paymentCache.current[row.id]?.paymentBreakdownLabel) {
        return paymentCache.current[row.id].paymentBreakdownLabel;
      }
      if (row.paymentBreakdownLabel && row.paymentBreakdown) {
        return row.paymentBreakdownLabel;
      }

      try {
        const detailPayload = await fetchTransactionDetail(session.token, {
          type: row.type,
          sourceId: row.sourceId,
        });
        const enriched = withPaymentBreakdown(row, detailPayload);
        paymentCache.current[row.id] = enriched;
        setTxRows((current) =>
          current.map((entry) => (entry.id === row.id ? enriched : entry)),
        );
        return enriched.paymentBreakdownLabel;
      } catch {
        return row.paymentBreakdownLabel || '';
      }
    },
    [session?.token],
  );

  const openDetail = useCallback(
    async (row) => {
      setSelectedRow(row);
      setDetail(null);
      setDetailError('');
      setDetailLoading(true);

      const id = ++detailRequestId.current;

      try {
        const next = await fetchTransactionDetail(session.token, {
          type: row.type,
          sourceId: row.sourceId,
        });
        if (id !== detailRequestId.current) return;
        setDetail(next);
        const enriched = withPaymentBreakdown(row, next);
        paymentCache.current[row.id] = enriched;
        setTxRows((current) =>
          current.map((entry) => (entry.id === row.id ? enriched : entry)),
        );
        setSelectedRow(enriched);
      } catch (err) {
        if (id !== detailRequestId.current) return;
        setDetailError(err?.message || 'Failed to load transaction details.');
      } finally {
        if (id === detailRequestId.current) setDetailLoading(false);
      }
    },
    [session?.token],
  );

  if (!mounted || !heldStore) return null;

  const activeTool =
    activeTab === 'overview'
      ? overviewTab
      : drawerTabs.find((tab) => tab.key === activeTab) || drawerTabs[0];

  return (
    <>
      <Modal visible={mounted} transparent animationType="none" onRequestClose={onClose}>
        <View style={styles.drawerRoot}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose}>
            <Animated.View style={[styles.drawerBackdrop, { opacity: backdrop }]} />
          </Pressable>

          <Animated.View
            style={[
              styles.storeDrawerShell,
              isMobile && styles.storeDrawerShellMobile,
              { transform: [{ translateX: slide }] },
            ]}
          >
            <View
              style={[
                styles.drawerPanel,
                styles.storeDrawerPanel,
                isMobile && styles.storeDrawerPanelMobile,
                { width: panelWidth, maxWidth: panelWidth },
              ]}
            >
              {activeTab === 'overview' ||
              activeTab === 'inventory' ||
              activeTab === 'preorders' ||
              activeTab === 'financials' ||
              activeTab === 'employees' ||
              activeTab === 'debit' ||
              activeTab === 'audit' ||
              activeTab === 'ai' ||
              activeTab === 'triage' ||
              activeTab === 'phone' ||
              activeTab === 'emails' ||
              activeTab === 'settings' ? (
                <View style={[styles.drawerBody, styles.drawerBodyFill]}>
                  {activeTab === 'overview' ? (
                    <StoreSnapshotPanel
                      session={session}
                      store={heldStore}
                      periodLabel={periodLabel}
                      startKey={startKey}
                      endKey={endKey}
                      txRows={txRows}
                      onOpenTransaction={openDetail}
                      onOpenApp={openApp}
                      onAmountHover={ensurePaymentBreakdown}
                      topInset={topInset}
                      ready={settled}
                    />
                  ) : (
                  <View
                    style={[
                      styles.drawerBodyContentInventory,
                      isMobile && styles.drawerBodyContentInventoryMobile,
                      { paddingTop: topInset + 8 },
                    ]}
                  >
                    {activeTab === 'inventory' ? (
                      <InventoryScreen
                        session={session}
                        storeFilter={heldStore.store}
                        embedded
                      />
                    ) : activeTab === 'preorders' ? (
                      <PreordersScreen />
                    ) : activeTab === 'financials' ? (
                      <FinancialsScreen
                        session={session}
                        storeFilter={heldStore.store}
                        embedded
                      />
                    ) : activeTab === 'debit' ? (
                      <DebitScreen
                        session={session}
                        storeFilter={heldStore.store}
                        embedded
                      />
                    ) : activeTab === 'audit' ? (
                      <AuditScreen
                        key={heldStore.store}
                        session={session}
                        storeFilter={heldStore.store}
                        initialDate={date}
                        embedded
                      />
                    ) : activeTab === 'ai' ? (
                      <AiScreen
                        session={session}
                        storeFilter={heldStore.store}
                        embedded
                      />
                    ) : activeTab === 'triage' ? (
                      <TriageScreen
                        session={session}
                        storeFilter={heldStore.store}
                        embedded
                      />
                    ) : activeTab === 'employees' ? (
                      <EmployeesScreen
                        session={session}
                        storeFilter={heldStore.store}
                        embedded
                      />
                    ) : activeTab === 'phone' ? (
                      <PhoneScreen
                        session={session}
                        storeFilter={heldStore.store}
                        embedded
                      />
                    ) : activeTab === 'emails' ? (
                      <EmailsScreen
                        session={session}
                        focus={emailsFocus}
                        storeFilter={heldStore.store}
                        embedded
                        capture={
                          <EmailCaptureScreen
                            session={session}
                            focus={emailsFocus}
                            storeFilter={heldStore.store}
                          />
                        }
                      />
                    ) : (
                      <StoreSettingsPanel
                        session={session}
                        storeName={heldStore.store}
                        embedded
                      />
                    )}
                  </View>
                  )}
                </View>
              ) : (
              <ScrollView
                style={styles.drawerBody}
                contentContainerStyle={[
                  styles.drawerBodyContent,
                  isMobile && styles.drawerBodyContentMobile,
                  { paddingTop: topInset + 8 },
                ]}
                showsVerticalScrollIndicator={false}
              >
                {activeTab === 'transactions' ? (
                  isMobile ? (
                    <>
                      <View style={styles.storeTxMobileStack}>
                        <OverviewHero store={heldStore} periodLabel={periodLabel} />
                        <View style={styles.appleGroup}>
                        {txRows.length === 0 ? (
                          <Text style={[styles.invoiceEmptyLine, styles.storeTxMobileEmpty]}>
                            No transactions in this period.
                          </Text>
                        ) : (
                          txRows.map((item, index) => (
                            <StoreTransactionRow
                              key={item.id}
                              item={item}
                              last={index === txRows.length - 1}
                              onPress={openDetail}
                              cashSaved={cashSlips.isSaved(item)}
                              onCashPress={cashSlips.openEditor}
                              employeePerson={{
                                name: item.employeeName || '—',
                                photoUrl: employeePhotos[item.employeeName] || '',
                              }}
                              onAmountHover={ensurePaymentBreakdown}
                              stacked
                            />
                          ))
                        )}
                      </View>
                      </View>
                    </>
                  ) : (
                  <>
                    <View style={styles.invoiceHeaderRow}>
                      <View style={styles.invoiceHeaderLeft}>
                        <Text style={styles.invoiceNumber}>Transactions</Text>
                        <Text style={styles.emailDrawerSubtitle}>
                          {periodLabel} · {heldStore.txCount} transaction
                          {heldStore.txCount === 1 ? '' : 's'}
                        </Text>
                      </View>
                      <View style={styles.invoiceHeaderRight}>
                        <Text style={styles.invoiceTotalLabelTop}>Total</Text>
                        <Text style={styles.invoiceTotalHero}>
                          {formatAmount(heldStore.totalAmount)}
                        </Text>
                      </View>
                    </View>

                    <View style={styles.invoiceInfoGrid}>
                      <View style={styles.invoiceInfoCard}>
                        <Text style={styles.invoiceSectionLabel}>Sales</Text>
                        <Text style={styles.invoicePartyName}>{heldStore.saleCount}</Text>
                        <Text style={styles.invoicePartyDetail}>
                          {formatAmount(heldStore.soAmount)} SO
                        </Text>
                      </View>
                      <View style={styles.invoiceInfoCard}>
                        <Text style={styles.invoiceSectionLabel}>Purchases</Text>
                        <Text style={styles.invoicePartyName}>{heldStore.purchaseCount}</Text>
                        <Text style={styles.invoicePartyDetail}>
                          {formatAmount(heldStore.poAmount)} PO
                        </Text>
                      </View>
                    </View>

                    <View style={styles.invoiceSection}>
                      <Text style={styles.invoiceSectionLabel}>Transactions</Text>
                      <View style={[styles.txListWrap, styles.txDrawerTable]}>
                        {txRows.length === 0 ? (
                          <Text style={styles.homeTxEmpty}>No transactions in this period.</Text>
                        ) : (
                          <>
                            <TxTableHeader hideStore interactive={false} />
                            {txRows.map((item) => (
                              <TransactionListRow
                                key={item.id}
                                item={item}
                                selected={selectedRow?.id === item.id}
                                onPress={openDetail}
                                employeeCount={employeeCounts[item.employeeName] || 0}
                                employeePhotoUrl={employeePhotos[item.employeeName] || ''}
                                onAmountHover={ensurePaymentBreakdown}
                                hideStore
                                cashSaved={cashSlips.isSaved(item)}
                                onCashPress={cashSlips.openEditor}
                              />
                            ))}
                          </>
                        )}
                      </View>
                    </View>
                  </>
                  )
                ) : activeTool ? (
                  <View style={styles.storeDrawerPlaceholder}>
                    <View
                      style={[
                        styles.storeDrawerPlaceholderIcon,
                        { backgroundColor: activeTool.tint },
                      ]}
                    >
                      <Ionicons name={activeTool.icon} size={28} color={activeTool.accent} />
                    </View>
                    <Text style={styles.storeDrawerPlaceholderTitle}>{activeTool.label}</Text>
                    <Text style={styles.storeDrawerPlaceholderBody}>
                      {activeTool.label} for {heldStore.store} is coming soon.
                    </Text>
                  </View>
                ) : (
                  <View style={styles.storeDrawerPlaceholder}>
                    <Text style={styles.storeDrawerPlaceholderBody}>
                      No apps are available for this store.
                    </Text>
                  </View>
                )}
              </ScrollView>
              )}

              <HeaderShell
                intensity={58}
                tint="light"
                style={[styles.storeDrawerHeader, !blurHeader && styles.storeDrawerHeaderSolid]}
                onLayout={onHeaderLayout}
                {...(blurHeader && Platform.OS === 'web'
                  ? { className: 'cgold-store-header-blur' }
                  : null)}
              >
                <View
                  style={[
                    styles.invoiceTopBar,
                    isMobile && styles.invoiceTopBarMobile,
                    isMobile && styles.storeDrawerTopBarMobile,
                    styles.storeDrawerTitleRow,
                  ]}
                  {...(Platform.OS === 'web' && isMobile ? { className: 'cgold-mobile-sheet-top' } : null)}
                >
                  {isMobile ? (
                    activeTab !== 'overview' ? (
                      <Pressable
                        onPress={() => setActiveTab('overview')}
                        hitSlop={8}
                        style={styles.storeDrawerNavSide}
                        accessibilityLabel="Back"
                      >
                        <Ionicons name="chevron-back" size={28} color="#007AFF" />
                      </Pressable>
                    ) : (
                      <View style={styles.storeDrawerNavSide} />
                    )
                  ) : null}
                  <Pressable
                    onPress={() => setActiveTab('overview')}
                    style={styles.storeDrawerTitleHit}
                    accessibilityRole="button"
                    accessibilityLabel={heldStore.store}
                  >
                    <Text
                      style={[styles.appleSheetTitle, isMobile && styles.storeDrawerTitleMobile]}
                      numberOfLines={1}
                    >
                      {heldStore.store}
                    </Text>
                    {isMobile ? (
                      <Text style={styles.storeDrawerPeriod} numberOfLines={1}>
                        {periodLabel}
                      </Text>
                    ) : null}
                  </Pressable>
                  <View style={isMobile ? styles.storeDrawerNavSide : null}>
                    <Pressable
                      onPress={onClose}
                      hitSlop={8}
                      style={styles.appleCloseButton}
                      accessibilityLabel="Close"
                    >
                      <Ionicons name="close" size={18} color="#1d1d1f" />
                    </Pressable>
                  </View>
                </View>

                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={styles.storeDrawerTabsScroll}
                  contentContainerStyle={[
                    styles.storeDrawerAppsRow,
                    isMobile && styles.storeDrawerAppsRowMobile,
                  ]}
                >
                  {tabStrip.map((tool) => (
                    <ToolCard
                      key={tool.key}
                      tool={tool}
                      selected={tool.key === activeTab}
                      onPress={() => setActiveTab(tool.key)}
                      iconSize={appIconSize}
                      wrapStyle={{ width: appItemWidth }}
                    />
                  ))}
                </ScrollView>
              </HeaderShell>
            </View>
          </Animated.View>
        </View>
      </Modal>

      <TransactionDetailDrawer
        visible={Boolean(selectedRow)}
        summary={selectedRow}
        detail={detail}
        loading={detailLoading}
        error={detailError}
        onClose={closeDetail}
      />
      <TxnCashBreakdownModal
        visible={Boolean(cashSlips.editorRow)}
        session={session}
        row={cashSlips.editorRow}
        initialSheet={cashSlips.editorSheet}
        onClose={cashSlips.closeEditor}
        onSaved={cashSlips.onSaved}
      />
    </>
  );
}

const STORE_ACCENTS = {
  Hamilton: '#2F6FED',
  Mississauga: '#C47A12',
  Toronto: '#2F8A4E',
  'Richmond Hill': '#6B4DE6',
};

const STORE_ACCENT_FALLBACKS = [
  '#1D4ED8',
  '#0F766E',
  '#B91C1C',
  '#B45309',
  '#6D28D9',
  '#047857',
  '#4338CA',
  '#BE185D',
];

function storeAccent(name) {
  if (STORE_ACCENTS[name]) return STORE_ACCENTS[name];
  const value = String(name || '');
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return STORE_ACCENT_FALLBACKS[hash % STORE_ACCENT_FALLBACKS.length];
}

function HomeStoreNativeRadiance({ open, size }) {
  const ringA = useRef(new Animated.Value(0)).current;
  const ringB = useRef(new Animated.Value(0)).current;
  const ambient = useRef(new Animated.Value(0)).current;
  const color = open ? '#30D158' : '#FF453A';
  const halo = size + 14;

  useEffect(() => {
    const loopRing = (value, delay) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(value, {
            toValue: 1,
            duration: 2200,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.timing(value, { toValue: 0, duration: 0, useNativeDriver: true }),
        ]),
      );
    const loopAmbient = Animated.loop(
      Animated.sequence([
        Animated.timing(ambient, {
          toValue: 1,
          duration: 1200,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(ambient, {
          toValue: 0,
          duration: 1200,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    const anim = Animated.parallel([loopRing(ringA, 0), loopRing(ringB, 1100), loopAmbient]);
    anim.start();
    return () => {
      anim.stop();
      ringA.setValue(0);
      ringB.setValue(0);
      ambient.setValue(0);
    };
  }, [ambient, open, ringA, ringB]);

  return (
    <View pointerEvents="none" style={styles.homeStoreRadianceLayer}>
      <Animated.View
        style={[
          styles.homeStoreRadianceBlob,
          {
            width: halo,
            height: halo,
            borderRadius: halo / 2,
            backgroundColor: color,
            opacity: ambient.interpolate({ inputRange: [0, 1], outputRange: [0.2, 0.36] }),
            transform: [{ scale: ambient.interpolate({ inputRange: [0, 1], outputRange: [0.88, 1.08] }) }],
          },
        ]}
      />
      <Animated.View
        style={[
          styles.homeStoreRadianceBlob,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: color,
            opacity: ringA.interpolate({ inputRange: [0, 1], outputRange: [0.32, 0] }),
            transform: [{ scale: ringA.interpolate({ inputRange: [0, 1], outputRange: [0.72, 1.55] }) }],
          },
        ]}
      />
      <Animated.View
        style={[
          styles.homeStoreRadianceBlob,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: color,
            opacity: ringB.interpolate({ inputRange: [0, 1], outputRange: [0.32, 0] }),
            transform: [{ scale: ringB.interpolate({ inputRange: [0, 1], outputRange: [0.72, 1.55] }) }],
          },
        ]}
      />
    </View>
  );
}

function HomeStoreStatusIcon({ accent, open, compact = false }) {
  const tile = compact ? 40 : 28;
  const iconSize = compact ? 18 : 14;
  const isOpen = Boolean(open);
  const icon = (
    <View
      style={[
        compact ? styles.igStoreIcon : styles.homeStoreIconTile,
        styles.homeStoreIconForeground,
        { backgroundColor: accent },
      ]}
    >
      <Ionicons name="storefront" size={iconSize} color="#fff" />
    </View>
  );

  if (Platform.OS === 'web') {
    return createElement(
      'div',
      {
        className: `cgold-store-status${compact ? ' cgold-store-status-lg' : ''} ${
          isOpen ? 'cgold-store-status-open' : 'cgold-store-status-closed'
        }`,
      },
      createElement('div', { className: 'cgold-store-ambient' }),
      icon,
    );
  }

  return (
    <View style={[styles.homeStoreIconWrap, compact && styles.igStoreIconWrap]}>
      <HomeStoreNativeRadiance open={isOpen} size={tile} />
      {icon}
    </View>
  );
}

const HOME_LIVE_UP = '#34C759';
const HOME_LIVE_DOWN = '#FF3B30';

function parseHomeLiveNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const text = String(value ?? '').trim();
  if (!text || text === '—') return null;
  const percent = text.match(/^(-?\d+(?:\.\d+)?)\s*%$/);
  if (percent) return Number(percent[1]);
  const plain = text.match(/^-?\d+(?:\.\d+)?$/);
  if (plain) return Number(plain[0]);
  if (/tx/i.test(text) || text.includes('·')) return null;
  const stripped = text.replace(/[^\d,.\-]/g, '');
  if (!/^-?[\d,]+(?:\.\d{1,2})?$/.test(stripped)) return null;
  const n = Number(stripped.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function formatHomeLiveTick(display, format, fromN, toN, t) {
  const current = fromN + (toN - fromN) * t;
  if (typeof format === 'function') return format(current);
  if (/%\s*$/.test(String(display).trim())) return `${Math.round(current)}%`;
  if (/^-?\d+$/.test(String(display).trim())) return String(Math.round(current));
  if (parseHomeLiveNumber(display) != null) return formatAmount(current);
  return display;
}

function formatHomePercentTick(n) {
  return `${Math.round(n)}%`;
}

function formatHomeCountTick(n) {
  return String(Math.round(n));
}

function HomeLiveValue({
  children,
  numeric,
  format,
  style,
  numberOfLines = 1,
  adjustsFontSizeToFit,
  origin = 'start',
  accessibilityLabel,
}) {
  const display = children == null ? '' : String(children);
  const targetN =
    numeric == null || numeric === ''
      ? parseHomeLiveNumber(display)
      : Number.isFinite(Number(numeric))
        ? Number(numeric)
        : parseHomeLiveNumber(display);
  const flash = useRef(new Animated.Value(0)).current;
  const slide = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(1)).current;
  const primed = useRef(false);
  const prevDisplay = useRef(display);
  const currentN = useRef(Number.isFinite(targetN) ? targetN : null);
  const rafRef = useRef(null);
  const formatRef = useRef(format);
  formatRef.current = format;
  const targetNRef = useRef(targetN);
  targetNRef.current = targetN;
  const [shown, setShown] = useState(display);
  const [flashColor, setFlashColor] = useState(HOME_LIVE_UP);
  const [webFlash, setWebFlash] = useState('');
  const baseColor = StyleSheet.flatten(style)?.color || '#1d1d1f';

  useEffect(() => {
    if (!primed.current) {
      primed.current = true;
      prevDisplay.current = display;
      currentN.current = Number.isFinite(targetNRef.current) ? targetNRef.current : null;
      setShown(display);
      return undefined;
    }
    if (prevDisplay.current === display) return undefined;

    const fromN = currentN.current;
    const toN = Number.isFinite(targetNRef.current) ? targetNRef.current : null;
    const dir =
      fromN != null && toN != null ? Math.sign(toN - fromN) : toN == null && fromN ? -1 : 1;
    setFlashColor(dir < 0 ? HOME_LIVE_DOWN : HOME_LIVE_UP);
    prevDisplay.current = display;
    currentN.current = toN;

    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    const tickFormat = formatRef.current;
    const canTick =
      fromN != null &&
      toN != null &&
      fromN !== toN &&
      (typeof tickFormat === 'function' || parseHomeLiveNumber(display) != null);

    if (!canTick) {
      setShown(display);
    } else {
      const started = Date.now();
      const duration = 520;
      const tick = () => {
        const t = Math.min(1, (Date.now() - started) / duration);
        const eased = 1 - (1 - t) ** 3;
        setShown(formatHomeLiveTick(display, tickFormat, fromN, toN, eased));
        if (t < 1) {
          rafRef.current = requestAnimationFrame(tick);
        } else {
          rafRef.current = null;
          setShown(display);
        }
      };
      rafRef.current = requestAnimationFrame(tick);
    }

    let cancelled = false;
    let webCoolId = null;
    if (Platform.OS === 'web') {
      setWebFlash(dir < 0 ? 'down' : 'up');
      webCoolId = requestAnimationFrame(() => {
        webCoolId = requestAnimationFrame(() => {
          if (!cancelled) setWebFlash('cool');
        });
      });
    } else {
      flash.stopAnimation();
      slide.stopAnimation();
      scale.stopAnimation();
      flash.setValue(1);
      slide.setValue(dir < 0 ? -8 : 8);
      scale.setValue(1.05);
      Animated.parallel([
        Animated.timing(flash, {
          toValue: 0,
          duration: 980,
          easing: Easing.out(Easing.quad),
          useNativeDriver: false,
        }),
        Animated.spring(slide, {
          toValue: 0,
          friction: 7,
          tension: 140,
          useNativeDriver: false,
        }),
        Animated.spring(scale, {
          toValue: 1,
          friction: 7,
          tension: 140,
          useNativeDriver: false,
        }),
      ]).start();
    }

    return () => {
      cancelled = true;
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      if (webCoolId != null) cancelAnimationFrame(webCoolId);
    };
  }, [display, flash, slide, scale]);

  const color = flash.interpolate({
    inputRange: [0, 1],
    outputRange: [baseColor, flashColor],
  });
  const webClass =
    webFlash === 'up' || webFlash === 'down'
      ? `cgold-home-live cgold-home-live-hot-${webFlash}`
      : webFlash === 'cool'
        ? 'cgold-home-live cgold-home-live-cool'
        : 'cgold-home-live';

  return (
    <Animated.Text
      {...(Platform.OS === 'web' ? { className: webClass } : null)}
      style={[
        style,
        Platform.OS === 'web'
          ? {
              transformOrigin: origin === 'end' ? 'right center' : 'left center',
            }
          : {
              color,
              transform: [{ translateY: slide }, { scale }],
            },
      ]}
      numberOfLines={numberOfLines}
      adjustsFontSizeToFit={adjustsFontSizeToFit}
      accessibilityLabel={accessibilityLabel}
    >
      {shown}
    </Animated.Text>
  );
}

function HomeStoreMetric({ icon, stats, label }) {
  if (stats?.rate == null) return null;
  const low = stats.rate < 80;
  return (
    <View style={styles.igStoreMetric} accessibilityLabel={`${label} ${stats.ratio}`}>
      <Ionicons name={icon} size={12} color={low ? '#B91C1C' : '#15803D'} />
      <HomeLiveValue
        style={[styles.igStoreMetricText, low ? styles.homeStorePhoneLow : styles.homeStorePhoneHigh]}
        numeric={stats.rate}
        format={formatHomePercentTick}
      >
        {stats.ratio}
      </HomeLiveValue>
    </View>
  );
}

function HomeStoreCard({
  row,
  people,
  emailStats,
  phoneStats,
  selected,
  last,
  onOpenStore,
  onOpenPerson,
  open,
  showAmounts = true,
  canOpen = true,
}) {
  const accent = storeAccent(row.store);
  const hasActivity = Number(row.txCount) > 0;
  const hasMetrics = emailStats?.rate != null || phoneStats?.rate != null;
  const cardStyle = [styles.igStoreCard, selected && styles.igStoreCardSelected];

  if (!canOpen) {
    return (
      <View style={[cardStyle, styles.igStoreCardStatic]} accessibilityLabel={`${row.store}, ${open ? 'open' : 'closed'}`}>
        <HomeStoreStatusIcon accent={accent} open={open} compact />
        <View style={[styles.igStoreBody, !last && styles.igStoreBodyDivider]}>
          <View style={styles.igStoreCopy}>
            <Text style={styles.igStoreName} numberOfLines={1}>
              {row.store}
            </Text>
            <View style={styles.igStoreMetaRow}>
              <HomeLiveValue style={styles.igStoreMeta} numeric={row.txCount} numberOfLines={1}>
                {hasActivity ? `${row.txCount} tx` : 'No transactions'}
              </HomeLiveValue>
              {hasMetrics ? (
                <>
                  <HomeStoreMetric icon="mail" stats={emailStats} label="Email capture" />
                  <HomeStoreMetric icon="call" stats={phoneStats} label="Phone answer rate" />
                </>
              ) : null}
            </View>
          </View>
          <View style={styles.igStoreTrailing}>
            {people.length > 0 ? (
              <HomePeopleStack people={people} compact onOpenPerson={onOpenPerson} />
            ) : null}
          </View>
          <View style={styles.igStoreChevron} />
        </View>
      </View>
    );
  }

  return (
    <Pressable
      onPress={() => onOpenStore(row)}
      style={({ hovered, pressed }) => [
        ...cardStyle,
        (hovered || pressed) && styles.igStoreCardPressed,
      ]}
      accessibilityRole="button"
      accessibilityLabel={`${row.store}, ${open ? 'open' : 'closed'}`}
    >
      <HomeStoreStatusIcon accent={accent} open={open} compact />
      <View style={[styles.igStoreBody, !last && styles.igStoreBodyDivider]}>
        <View style={styles.igStoreCopy}>
          <Text style={styles.igStoreName} numberOfLines={1}>
            {row.store}
          </Text>
          <View style={styles.igStoreMetaRow}>
            <HomeLiveValue style={styles.igStoreMeta} numeric={row.txCount} numberOfLines={1}>
              {hasActivity ? `${row.txCount} tx` : 'No transactions'}
            </HomeLiveValue>
            {hasMetrics ? (
              <>
                <HomeStoreMetric icon="mail" stats={emailStats} label="Email capture" />
                <HomeStoreMetric icon="call" stats={phoneStats} label="Phone answer rate" />
              </>
            ) : null}
          </View>
        </View>
        <View style={styles.igStoreTrailing}>
          {showAmounts ? (
            <HomeStoreAmount amount={row.totalAmount} count={row.txCount} breakdown={row} compact />
          ) : null}
          {people.length > 0 ? (
            <HomePeopleStack people={people} compact onOpenPerson={onOpenPerson} />
          ) : null}
        </View>
        <Ionicons name="chevron-forward" size={16} color="#c7c7cc" style={styles.igStoreChevron} />
      </View>
    </Pressable>
  );
}

function homeStoreMeta(row) {
  return `${row.txCount} tx · ${row.saleCount} SO · ${row.purchaseCount} PO`;
}

function callsInHomeRange(calls, startKey, endKey) {
  if (!startKey || !endKey) return Array.isArray(calls) ? calls : [];
  return (Array.isArray(calls) ? calls : []).filter((call) => {
    const time = Date.parse(call.startTime);
    if (!Number.isFinite(time)) return false;
    const day = formatDateParam(new Date(time));
    return day >= startKey && day <= endKey;
  });
}

function phoneRatioForStore(mergedCallsByStore, storeName, startKey, endKey) {
  return inboundCallRatio(callsInHomeRange(callsForStore(mergedCallsByStore, storeName), startKey, endKey));
}

function emailRatioFromTransactions(transactions) {
  const captures = buildEmailCaptureByStore(transactions || []);
  let customerCount = 0;
  let walkInCount = 0;
  let withEmail = 0;
  for (const entry of captures) {
    customerCount += entry.customerCount;
    walkInCount += entry.walkInCount;
    withEmail += entry.withEmail;
  }
  const rate = customerCount > 0 ? (withEmail / customerCount) * 100 : null;
  return {
    rate,
    ratio: rate == null ? '—' : `${Math.round(rate)}%`,
    withEmail,
    customerCount,
    walkInCount,
  };
}

function HomePercentRate({ stats, compact = false, columnStyle, emptyLabel, noun, tip }) {
  const [anchor, setAnchor] = useState(null);
  const empty = stats?.rate == null;
  const hover =
    Platform.OS === 'web' && tip
      ? {
          onMouseEnter: (event) => setAnchor(event?.currentTarget || null),
          onMouseLeave: () => setAnchor(null),
        }
      : null;

  return (
    <View
      style={[compact ? styles.igStorePhoneWrap : columnStyle, hover && styles.homeStoreAmountHover]}
      {...hover}
      accessibilityLabel={empty ? emptyLabel : `${noun} ${stats.ratio}. ${tip}`}
    >
      <HomeLiveValue
        style={[
          compact ? styles.igStorePhone : styles.homeStorePhone,
          empty && styles.homeStoreMoneyEmpty,
          !empty && stats.rate < 80 && styles.homeStorePhoneLow,
          !empty && stats.rate >= 80 && styles.homeStorePhoneHigh,
        ]}
        numeric={empty ? null : stats.rate}
        format={formatHomePercentTick}
        origin="end"
        numberOfLines={1}
      >
        {empty ? '—' : stats.ratio}
      </HomeLiveValue>
      <FloatingTooltip visible={Boolean(anchor && tip)} text={tip} anchorEl={anchor} align="end" />
    </View>
  );
}

function HomeEmailRate({ stats, compact = false }) {
  const empty = stats?.rate == null;
  const tip = empty
    ? ''
    : `${stats.withEmail} of ${stats.customerCount} named with email${
        stats.walkInCount ? ` · ${stats.walkInCount} walk-in excluded` : ''
      }`;
  return (
    <HomePercentRate
      stats={stats}
      compact={compact}
      columnStyle={styles.homeStoreColEmail}
      emptyLabel="No email capture rate"
      noun="Email capture rate"
      tip={tip}
    />
  );
}

function HomePhoneRate({ stats, compact = false }) {
  const empty = stats?.rate == null;
  const tip = empty
    ? ''
    : `${stats.answered} of ${stats.total} inbound answered${stats.missed ? ` · ${stats.missed} missed` : ''}`;
  return (
    <HomePercentRate
      stats={stats}
      compact={compact}
      columnStyle={styles.homeStoreColPhone}
      emptyLabel="No phone answer rate"
      noun="Phone answer rate"
      tip={tip}
    />
  );
}

function HomePeopleStack({ people = [], compact = false, onOpenPerson, trailing = false }) {
  const [tip, setTip] = useState({ text: '', el: null });
  const size = compact ? 22 : HOME_PEOPLE_SIZE;
  const overlap = compact ? 8 : HOME_PEOPLE_OVERLAP;
  const max = compact ? 4 : HOME_PEOPLE_VISIBLE;
  const visible = people.slice(0, max);
  const extra = people.length - visible.length;
  const extraNames = extra > 0 ? people.slice(max).map((person) => person.name).join('\n') : '';

  const hoverHandlers = (text) =>
    Platform.OS === 'web'
      ? {
          onMouseEnter: (event) => {
            setTip({ text, el: event?.currentTarget || null });
          },
          onMouseLeave: () => setTip({ text: '', el: null }),
        }
      : null;

  if (people.length === 0) {
    if (compact) return null;
    return (
      <View style={[styles.homePeopleStack, trailing && styles.homePeopleStackTrailing]}>
        <Text style={[styles.homeStoreMoney, styles.homeStoreMoneyEmpty]}>—</Text>
      </View>
    );
  }

  return (
    <View
      style={[
        styles.homePeopleStack,
        compact && styles.homePeopleStackCompact,
        trailing && styles.homePeopleStackTrailing,
      ]}
      pointerEvents="box-none"
      accessibilityLabel={people.map((person) => person.name).join(', ')}
    >
      {visible.map((person, index) => (
        <Pressable
          key={`${person.name}-${index}`}
          onPress={(event) => {
            event?.stopPropagation?.();
            setTip({ text: '', el: null });
            onOpenPerson?.(person);
          }}
          onPointerDown={(event) => event?.stopPropagation?.()}
          style={[
            styles.homePeopleAvatarWrap,
            {
              width: size,
              height: size,
              marginLeft: index === 0 ? 0 : -overlap,
              zIndex: tip.text === person.name ? 20 : index + 1,
            },
          ]}
          accessibilityRole="button"
          accessibilityLabel={`${person.name} profile`}
          {...hoverHandlers(person.name)}
        >
          <ProfileAvatar
            uri={person.photoUrl}
            name={person.name}
            size={size}
            style={styles.homePeopleAvatarRing}
          />
        </Pressable>
      ))}
      {extra > 0 ? (
        <View
          style={[
            styles.homePeopleAvatarWrap,
            styles.homePeopleMore,
            {
              width: size,
              height: size,
              borderRadius: size / 2,
              marginLeft: -overlap,
              zIndex: visible.length + 1,
            },
          ]}
          accessibilityLabel={`${extra} more`}
          {...hoverHandlers(extraNames)}
        >
          <Text style={styles.homePeopleMoreText}>+{extra}</Text>
        </View>
      ) : null}
      <FloatingTooltip
        visible={Boolean(tip.el && tip.text)}
        text={tip.text}
        anchorEl={tip.el}
      />
    </View>
  );
}

function HomeStoreAmount({ amount, count, strong = false, breakdown = null, compact = false }) {
  const [anchor, setAnchor] = useState(null);
  const empty = !Number(amount) && !Number(count);
  const tip = breakdown && !empty ? salesPurchasesTip(breakdown) : '';
  const hover =
    Platform.OS === 'web' && tip
      ? {
          onMouseEnter: (event) => setAnchor(event?.currentTarget || null),
          onMouseLeave: () => setAnchor(null),
        }
      : null;

  return (
    <View
      style={[compact ? styles.igStoreAmountWrap : styles.homeStoreColMoney, hover && styles.homeStoreAmountHover]}
      {...hover}
      accessibilityLabel={
        empty
          ? 'No total'
          : tip
            ? `Total ${formatAmount(amount)}. ${tip.replace('\n', '. ')}`
            : formatAmount(amount)
      }
    >
      <HomeLiveValue
        style={[
          compact ? styles.igStoreAmount : styles.homeStoreMoney,
          strong && styles.homeStoreMoneyStrong,
          empty && styles.homeStoreMoneyEmpty,
        ]}
        numeric={Number(amount) || 0}
        format={formatAmount}
        origin="end"
        numberOfLines={1}
      >
        {empty ? '—' : formatAmount(amount)}
      </HomeLiveValue>
      <FloatingTooltip visible={Boolean(anchor && tip)} text={tip} anchorEl={anchor} align="end" />
    </View>
  );
}

function HomeStoreTableRow({
  row,
  people,
  emailStats,
  phoneStats,
  selected,
  last,
  onOpenStore,
  onOpenPerson,
  open,
  showAmounts = true,
  canOpen = true,
}) {
  const accent = storeAccent(row.store);
  const peopleColumn = (
    <HomePeopleStack
      people={people}
      onOpenPerson={onOpenPerson}
      trailing={!showAmounts}
    />
  );
  const rowBody = (
    <View style={[styles.homeStoreRowBody, !last && styles.homeStoreRowDivider]}>
      <View style={styles.homeStoreColStore}>
        <Text style={styles.homeStoreName} numberOfLines={1}>
          {row.store}
        </Text>
        <HomeLiveValue style={styles.homeStoreMeta} numeric={row.txCount} numberOfLines={1}>
          {homeStoreMeta(row)}
        </HomeLiveValue>
      </View>
      <HomeEmailRate stats={emailStats} />
      <HomePhoneRate stats={phoneStats} />
      {showAmounts ? peopleColumn : null}
      {showAmounts ? (
        <HomeStoreAmount amount={row.totalAmount} count={row.txCount} breakdown={row} strong />
      ) : (
        peopleColumn
      )}
      <View style={styles.homeStoreChevron}>
        {canOpen ? <Ionicons name="chevron-forward" size={16} color="#c7c7cc" /> : null}
      </View>
    </View>
  );

  if (!canOpen) {
    return (
      <View
        style={[styles.homeStoreRow, styles.homeStoreRowStatic]}
        accessibilityLabel={`${row.store}, ${open ? 'open' : 'closed'}`}
      >
        <HomeStoreStatusIcon accent={accent} open={open} />
        {rowBody}
      </View>
    );
  }

  return (
    <Pressable
      onPress={() => onOpenStore(row)}
      style={({ hovered, pressed }) => [
        styles.homeStoreRow,
        !selected && (hovered || pressed) && styles.homeStoreRowHovered,
        selected && styles.homeStoreRowSelected,
      ]}
      {...(Platform.OS === 'web'
        ? {
            className: selected
              ? 'cgold-home-row cgold-home-row-selected'
              : 'cgold-home-row',
          }
        : null)}
      accessibilityRole="button"
      accessibilityLabel={`${row.store}, ${open ? 'open' : 'closed'}`}
    >
      <HomeStoreStatusIcon accent={accent} open={open} />
      {rowBody}
    </Pressable>
  );
}

function HomeStoresTable({
  rows,
  selectedStore,
  totals,
  staff = [],
  startKey,
  endKey,
  onOpenStore,
  onOpenPerson,
  compact = false,
  showAmounts = true,
  canOpenStore,
}) {
  const phone = usePhoneCalls();
  const [hoursByKey, setHoursByKey] = useState(() => new Map());
  const [nowTick, setNowTick] = useState(() => Date.now());
  const peopleByStore = useMemo(
    () => new Map(rows.map((row) => [row.store, peopleInStore(row.store, row.transactions, staff)])),
    [rows, staff],
  );
  const totalPeople = useMemo(() => uniqueStorePeople(rows, staff), [rows, staff]);
  const phoneByStore = useMemo(() => {
    const next = new Map();
    for (const row of rows) {
      next.set(row.store, phoneRatioForStore(phone.mergedCallsByStore, row.store, startKey, endKey));
    }
    return next;
  }, [endKey, phone.mergedCallsByStore, rows, startKey]);
  const totalPhoneStats = useMemo(() => {
    const calls = rows.flatMap((row) =>
      callsInHomeRange(callsForStore(phone.mergedCallsByStore, row.store), startKey, endKey),
    );
    return inboundCallRatio(calls);
  }, [endKey, phone.mergedCallsByStore, rows, startKey]);
  const emailByStore = useMemo(() => {
    const next = new Map();
    for (const row of rows) {
      next.set(row.store, emailRatioFromTransactions(row.transactions));
    }
    return next;
  }, [rows]);
  const totalEmailStats = useMemo(
    () => emailRatioFromTransactions(rows.flatMap((row) => row.transactions || [])),
    [rows],
  );

  useEffect(() => {
    let cancelled = false;
    listSavedStoreSettings()
      .then((result) => {
        if (cancelled) return;
        setHoursByKey(new Map((result.rows || []).map((row) => [row.storeKey, row])));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);

  const openByStore = useMemo(() => {
    const now = new Date(nowTick);
    const next = new Map();
    for (const row of rows) {
      const settings = hoursByKey.get(storeKeyFromName(row.store)) || emptyStoreSettings(row.store);
      next.set(row.store, isStoreOpenNow(settings, now));
    }
    return next;
  }, [hoursByKey, nowTick, rows]);

  if (compact) {
    return (
      <View style={styles.igStoreList}>
        {rows.map((row, index) => (
          <HomeStoreCard
            key={row.store}
            row={row}
            people={peopleByStore.get(row.store) || []}
            emailStats={emailByStore.get(row.store)}
            phoneStats={phoneByStore.get(row.store)}
            selected={selectedStore?.store === row.store}
            last={index === rows.length - 1 && !totals}
            onOpenStore={onOpenStore}
            onOpenPerson={onOpenPerson}
            open={openByStore.get(row.store) === true}
            showAmounts={showAmounts}
            canOpen={canOpenStore ? canOpenStore(row) : true}
          />
        ))}
        {totals ? (
          <View style={[styles.igStoreCard, styles.igStoreTotalCard]}>
            <View style={styles.igStoreBody}>
              <View style={styles.igStoreCopy}>
                <Text style={styles.igStoreTotalLabel}>Total</Text>
                <View style={styles.igStoreMetaRow}>
                  <HomeLiveValue style={styles.igStoreMeta} numeric={totals.txCount} numberOfLines={1}>
                    {totals.txCount} tx
                  </HomeLiveValue>
                  <HomeStoreMetric icon="mail" stats={totalEmailStats} label="Email capture" />
                  <HomeStoreMetric icon="call" stats={totalPhoneStats} label="Phone answer rate" />
                </View>
              </View>
              <View style={styles.igStoreTrailing}>
                {showAmounts ? (
                  <HomeStoreAmount
                    amount={totals.totalAmount}
                    count={totals.txCount}
                    breakdown={totals}
                    compact
                  />
                ) : null}
                {totalPeople.length > 0 ? (
                  <HomePeopleStack people={totalPeople} compact onOpenPerson={onOpenPerson} />
                ) : null}
              </View>
            </View>
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.homeStoreTableCard}>
      <ScrollView
        horizontal
        nestedScrollEnabled
        showsHorizontalScrollIndicator={false}
        style={styles.homeStoreTableScroll}
        contentContainerStyle={styles.homeStoreTableScrollContent}
      >
        <View style={[styles.homeStoreTable, !showAmounts && styles.homeStoreTableNoAmounts]}>
          <View style={[styles.homeStoreRow, styles.homeStoreHeaderRow]}>
            <View style={styles.homeStoreIconSpacer} />
            <View style={styles.homeStoreRowBody}>
              <Text style={[styles.homeStoreHeader, styles.homeStoreColStore]}>Store</Text>
              <Text style={[styles.homeStoreHeader, styles.homeStoreColEmail]}>Email</Text>
              <Text style={[styles.homeStoreHeader, styles.homeStoreColPhone]}>Phone</Text>
              {showAmounts ? (
                <Text style={[styles.homeStoreHeader, styles.homeStoreColPeople]}>People</Text>
              ) : null}
              {showAmounts ? (
                <Text style={[styles.homeStoreHeader, styles.homeStoreColMoney]}>Total</Text>
              ) : (
                <Text style={[styles.homeStoreHeader, styles.homeStoreColPeople, styles.homeStoreColPeopleTrailing]}>
                  People
                </Text>
              )}
              <View style={styles.homeStoreChevron} />
            </View>
          </View>
          {rows.map((row, index) => (
            <HomeStoreTableRow
              key={row.store}
              row={row}
              people={peopleByStore.get(row.store) || []}
              emailStats={emailByStore.get(row.store)}
              phoneStats={phoneByStore.get(row.store)}
              selected={selectedStore?.store === row.store}
              last={index === rows.length - 1}
              onOpenStore={onOpenStore}
              onOpenPerson={onOpenPerson}
              open={openByStore.get(row.store) === true}
              showAmounts={showAmounts}
              canOpen={canOpenStore ? canOpenStore(row) : true}
            />
          ))}
          {totals ? (
            <View style={[styles.homeStoreRow, styles.homeStoreTotalRow]}>
              <View style={styles.homeStoreIconSpacer} />
              <View style={styles.homeStoreRowBody}>
                <View style={styles.homeStoreColStore}>
                  <Text style={styles.homeStoreTotalLabel} numberOfLines={1}>
                    Total
                  </Text>
                  <HomeLiveValue style={styles.homeStoreMeta} numeric={totals.txCount} numberOfLines={1}>
                    {homeStoreMeta(totals)}
                  </HomeLiveValue>
                </View>
                <HomeEmailRate stats={totalEmailStats} />
                <HomePhoneRate stats={totalPhoneStats} />
                {showAmounts ? (
                  <HomePeopleStack people={totalPeople} onOpenPerson={onOpenPerson} />
                ) : null}
                {showAmounts ? (
                  <HomeStoreAmount
                    amount={totals.totalAmount}
                    count={totals.txCount}
                    breakdown={totals}
                    strong
                  />
                ) : (
                  <HomePeopleStack people={totalPeople} onOpenPerson={onOpenPerson} trailing />
                )}
                <View style={styles.homeStoreChevron} />
              </View>
            </View>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}

function HomeScreen({ session, onRequireLogin, onOpenPerson }) {
  const isMobile = useIsMobile();
  const appGrid = useAppGridLayout();
  const { canFilter } = useAppAccess();
  const allowHomeFilters = canFilter('home');
  const dateRestricted = isRestrictedHomeEmployee(session?.profile);
  const assignedStore = allocatedStoreName(session?.profile);
  const initialRange = useMemo(() => defaultDateRange(7), []);
  const [dateMode, setDateMode] = useState('day');
  const [startDate, setStartDate] = useState(() => parseDateParam(new Date()));
  const [endDate, setEndDate] = useState(() => parseDateParam(new Date()));
  const [query, setQuery] = useState('');
  const [storeRows, setStoreRows] = useState([]);
  const [selectedStore, setSelectedStore] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [toolbarHeight, setToolbarHeight] = useState(0);
  const [staff, setStaff] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const requestId = useRef(0);

  const todayKey = formatDateParam(parseDateParam(new Date()));
  const startKey = dateRestricted ? todayKey : formatDateParam(startDate);
  const endKey = dateRestricted ? todayKey : dateMode === 'day' ? startKey : formatDateParam(endDate);
  const isToday = dateMode === 'day' && startKey === todayKey;
  const periodLabel =
    dateMode === 'day'
      ? isToday
        ? 'Today'
        : formatPickerDate(startDate)
      : `${formatPickerDate(startDate)} – ${formatPickerDate(endDate)}`;
  const sectionWidth = { maxWidth: Math.max(appGrid.maxWidth || 0, 1100) };

  const load = useCallback(
    async ({ silent = false } = {}) => {
      if (!session?.token) {
        setStoreRows([]);
        setSelectedStore(null);
        setError('');
        return;
      }

      const id = ++requestId.current;
      if (!silent) {
        setLoading(true);
        setError('');
      }

      try {
        const result = await fetchHomeStoreSummaries(session, {
          startDate: startKey,
          endDate: endKey,
        });
        if (id !== requestId.current) return;
        setStoreRows(result.rows);
        setSelectedStore((current) => {
          if (!current) return null;
          return result.rows.find((row) => row.store === current.store) || null;
        });
        setError(result.warning || '');
      } catch (err) {
        if (id !== requestId.current) return;
        if (!silent) {
          setStoreRows([]);
          setSelectedStore(null);
          setError(err?.message || 'Failed to load store summary.');
        }
      } finally {
        if (id === requestId.current && !silent) setLoading(false);
      }
    },
    [session, startKey, endKey],
  );

  useEffect(() => {
    if (!dateRestricted) return;
    const day = parseDateParam(new Date());
    setDateMode('day');
    setStartDate(day);
    setEndDate(day);
  }, [dateRestricted]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    listStaffProfiles()
      .then((rows) => {
        if (cancelled) return;
        setStaff((rows || []).filter((row) => row.isActive !== false));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const watchLive = Boolean(session?.token) && startKey <= todayKey && todayKey <= endKey;
  useLiveRefresh(load, AUREUS_TX_LIVE_MS, watchLive);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load({ silent: true });
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  const visibleRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return storeRows;
    return storeRows.filter((row) => row.store.toLowerCase().includes(q));
  }, [storeRows, query]);

  const hideHomeAmounts = !allowHomeFilters;
  const canOpenHomeStore = useCallback(
    (row) => allowHomeFilters || rowMatchesAllocatedStore(row, assignedStore),
    [allowHomeFilters, assignedStore],
  );

  const totals = useMemo(() => {
    return visibleRows.reduce(
      (acc, row) => {
        acc.txCount += row.txCount || 0;
        acc.totalAmount += row.totalAmount || 0;
        acc.saleCount += row.saleCount || 0;
        acc.soAmount += row.soAmount || 0;
        acc.purchaseCount += row.purchaseCount || 0;
        acc.poAmount += row.poAmount || 0;
        return acc;
      },
      {
        txCount: 0,
        totalAmount: 0,
        saleCount: 0,
        soAmount: 0,
        purchaseCount: 0,
        poAmount: 0,
      },
    );
  }, [visibleRows]);

  const selectToday = () => {
    const day = parseDateParam(new Date());
    setDateMode('day');
    setStartDate(day);
    setEndDate(day);
  };

  const selectRange = () => {
    if (dateRestricted) return;
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

  const openStore = useCallback(
    (row) => {
      if (!allowHomeFilters && !rowMatchesAllocatedStore(row, assignedStore)) return;
      setSelectedStore(row);
    },
    [allowHomeFilters, assignedStore],
  );

  useEffect(() => {
    if (!selectedStore) return;
    if (canOpenHomeStore(selectedStore)) return;
    setSelectedStore(null);
  }, [selectedStore, canOpenHomeStore]);

  const closeStore = useCallback(() => {
    setSelectedStore(null);
  }, []);

  if (!session?.token) {
    return (
      <View style={styles.toolsScreen}>
        <View style={styles.homeInnerCentered}>
          <Text style={[styles.contentTitle, styles.homeTitle]}>Home</Text>
          <Text style={styles.homeSubtitle}>Log in to see store summaries.</Text>
          <Pressable style={[styles.loginButton, styles.homeLoginButton]} onPress={onRequireLogin}>
            <Text style={styles.loginButtonText}>Log in</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const homeWidth = isMobile ? styles.igHomePad : sectionWidth;
  const compactControls = !isMobile;
  const segmentFills = false;

  const segmentStyle = [
    styles.homeSegment,
    compactControls && styles.homeSegmentCompact,
    isMobile && styles.igSegment,
    segmentFills && styles.igSegmentFill,
  ];
  const segmentButtonStyle = [
    styles.homeSegmentButton,
    compactControls && styles.homeSegmentButtonCompact,
    isMobile && styles.igSegmentButton,
    segmentFills && styles.igSegmentButtonFill,
  ];
  const segmentTextStyle = [
    styles.homeSegmentText,
    compactControls && styles.homeSegmentTextCompact,
    isMobile && styles.igSegmentText,
  ];

  const dateSegment = dateRestricted ? (
    <View style={segmentStyle}>
      <View style={[...segmentButtonStyle, styles.homeSegmentButtonActive]}>
        <Text style={[...segmentTextStyle, styles.homeSegmentTextActive]}>Today</Text>
      </View>
    </View>
  ) : (
    <View style={segmentStyle} accessibilityRole="tablist">
      <Pressable
        style={[...segmentButtonStyle, dateMode === 'day' && isToday && styles.homeSegmentButtonActive]}
        onPress={selectToday}
        accessibilityRole="tab"
        accessibilityState={{ selected: dateMode === 'day' && isToday }}
      >
        <Text style={[...segmentTextStyle, dateMode === 'day' && isToday && styles.homeSegmentTextActive]}>
          Today
        </Text>
      </Pressable>
      <Pressable
        style={[...segmentButtonStyle, dateMode === 'range' && styles.homeSegmentButtonActive]}
        onPress={selectRange}
        accessibilityRole="tab"
        accessibilityState={{ selected: dateMode === 'range' }}
      >
        <Text style={[...segmentTextStyle, dateMode === 'range' && styles.homeSegmentTextActive]}>
          Range
        </Text>
      </Pressable>
    </View>
  );

  const datePickers = dateRestricted ? null : dateMode === 'day' ? (
    <DatePickerField
      label="Date"
      value={startDate}
      onChange={handleDayChange}
      maximumDate={new Date()}
      compact={compactControls}
      plain={!compactControls}
      fill={isMobile}
    />
  ) : (
    <>
      <DatePickerField
        label="From"
        value={startDate}
        onChange={handleStartChange}
        maximumDate={endDate}
        compact={compactControls}
        plain={!compactControls}
        fill={isMobile}
      />
      <Text style={[styles.homeDateSep, compactControls && styles.homeDateSepCompact]}>–</Text>
      <DatePickerField
        label="To"
        value={endDate}
        onChange={handleEndChange}
        minimumDate={startDate}
        maximumDate={new Date()}
        compact={compactControls}
        plain={!compactControls}
        fill={isMobile}
      />
    </>
  );

  const searchField = (
    <View style={[styles.homeSearch, isMobile && styles.igSearchField]}>
      <Ionicons
        name="search"
        size={compactControls ? 14 : 16}
        color="#8e8e93"
        style={styles.homeSearchIcon}
      />
      <TextInput
        style={[styles.toolsSearchInput, compactControls && styles.homeSearchInput, isMobile && styles.igSearchInput]}
        value={query}
        onChangeText={setQuery}
        placeholder={isMobile ? 'Search stores' : 'Search'}
        placeholderTextColor="#8e8e93"
        autoCapitalize="none"
        autoCorrect={false}
        clearButtonMode="while-editing"
        returnKeyType="search"
      />
      {query ? (
        <Pressable onPress={() => setQuery('')} hitSlop={8} accessibilityLabel="Clear search">
          <Ionicons name="close-circle" size={compactControls ? 16 : 18} color="#c7c7cc" />
        </Pressable>
      ) : null}
    </View>
  );

  const homeToolbar = isMobile ? (
    <View style={styles.igHomeToolbar}>
      <View style={styles.igHomeToolbarRow}>
        {searchField}
        {dateSegment}
      </View>
      {datePickers ? <View style={styles.igHomeToolbarRow}>{datePickers}</View> : null}
    </View>
  ) : (
    <View style={[styles.homeToolbar, sectionWidth]}>
      {searchField}
      <View style={styles.homeToolbarFilters}>
        {dateSegment}
        {datePickers}
      </View>
      {loading && storeRows.length > 0 ? <ActivityIndicator size="small" color="#8e8e93" /> : null}
    </View>
  );

  return (
    <View style={styles.toolsScreen}>
      {isMobile ? homeToolbar : null}

      <ScrollView
        style={styles.toolsScroll}
        contentContainerStyle={[
          styles.toolsScrollContent,
          isMobile && styles.igHomeScroll,
          !isMobile && styles.homeScrollContent,
          !isMobile && { paddingTop: (toolbarHeight || 64) + 4 },
        ]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          isMobile ? (
            <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor="#8e8e93" />
          ) : undefined
        }
      >
        {error ? <Text style={[styles.errorText, styles.homeError, homeWidth]}>{error}</Text> : null}
        {isMobile && !(loading && storeRows.length === 0) && visibleRows.length > 0 ? (
          <View style={styles.igHomeHero}>
            <Text style={styles.igHomeHeroLabel}>{periodLabel}</Text>
            {hideHomeAmounts ? null : (
              <HomeLiveValue
                style={styles.igHomeHeroAmount}
                numeric={totals.totalAmount}
                format={formatAmount}
                numberOfLines={1}
                adjustsFontSizeToFit
              >
                {formatAmount(totals.totalAmount)}
              </HomeLiveValue>
            )}
            <View style={styles.igHomeHeroStats}>
              <View style={styles.igHomeHeroStat}>
                <HomeLiveValue
                  style={styles.igHomeHeroStatValue}
                  numeric={totals.txCount}
                  format={formatHomeCountTick}
                >
                  {totals.txCount}
                </HomeLiveValue>
                <Text style={styles.igHomeHeroStatLabel}>
                  Transaction{totals.txCount === 1 ? '' : 's'}
                </Text>
              </View>
              <View style={styles.igHomeHeroStatDivider} />
              <View style={styles.igHomeHeroStat}>
                <HomeLiveValue
                  style={styles.igHomeHeroStatValue}
                  numeric={totals.saleCount}
                  format={formatHomeCountTick}
                >
                  {totals.saleCount}
                </HomeLiveValue>
                <Text style={styles.igHomeHeroStatLabel}>Sales</Text>
              </View>
              <View style={styles.igHomeHeroStatDivider} />
              <View style={styles.igHomeHeroStat}>
                <HomeLiveValue
                  style={styles.igHomeHeroStatValue}
                  numeric={totals.purchaseCount}
                  format={formatHomeCountTick}
                >
                  {totals.purchaseCount}
                </HomeLiveValue>
                <Text style={styles.igHomeHeroStatLabel}>Purchases</Text>
              </View>
            </View>
            {loading && storeRows.length > 0 ? (
              <Text style={styles.igHomeHeroMeta}>Updating…</Text>
            ) : null}
          </View>
        ) : null}
        {isMobile && !(loading && storeRows.length === 0) && visibleRows.length > 0 ? (
          <View style={styles.igSectionHeaderRow}>
            <Text style={styles.igSectionHeader}>Stores</Text>
            <Text style={styles.igSectionHeaderMeta}>
              {visibleRows.length} store{visibleRows.length === 1 ? '' : 's'}
            </Text>
          </View>
        ) : null}

        {loading && storeRows.length === 0 ? (
          <View style={styles.homeTableEmpty}>
            <ActivityIndicator color="#1d1d1f" />
          </View>
        ) : visibleRows.length === 0 ? (
          <Text style={[styles.toolsEmpty, homeWidth]}>
            {query.trim()
              ? `No stores match “${query.trim()}”.`
              : 'No store activity in this period.'}
          </Text>
        ) : (
          <View
            style={[
              styles.toolsSection,
              isMobile && styles.toolsSectionMobile,
              isMobile && styles.igHomeSection,
              !isMobile && styles.homeTableSection,
              !isMobile && sectionWidth,
            ]}
          >
            <HomeStoresTable
              rows={visibleRows}
              selectedStore={selectedStore}
              totals={isMobile ? null : totals}
              staff={staff}
              startKey={startKey}
              endKey={endKey}
              onOpenStore={openStore}
              onOpenPerson={onOpenPerson}
              compact={isMobile}
              showAmounts={!hideHomeAmounts}
              canOpenStore={canOpenHomeStore}
            />
          </View>
        )}
      </ScrollView>

      {isMobile ? null : (
        <BlurView
          intensity={58}
          tint="light"
          style={styles.homeToolbarBlur}
          onLayout={(event) => {
            const next = Math.ceil(event.nativeEvent.layout.height);
            if (next > 0 && next !== toolbarHeight) setToolbarHeight(next);
          }}
          {...(Platform.OS === 'web' ? { className: 'cgold-home-toolbar-blur' } : null)}
        >
          {homeToolbar}
        </BlurView>
      )}

      <HomeStoreDrawer
        visible={Boolean(selectedStore)}
        store={selectedStore}
        session={session}
        periodLabel={periodLabel}
        date={startDate}
        startKey={startKey}
        endKey={endKey}
        onClose={closeStore}
      />
    </View>
  );
}

function EmailStoreDrawer({ visible, store, onClose }) {
  const { width: windowWidth } = useWindowDimensions();
  const isMobile = windowWidth < MOBILE_BREAKPOINT;
  const panelWidth = isMobile
    ? windowWidth
    : Math.max(Math.round(windowWidth * 0.5), 420);
  const { mounted, slide, backdrop } = useRightDrawerAnimation(visible, panelWidth);
  const heldStore = useHeldValue(store);

  if (!mounted || !heldStore) return null;

  return (
    <Modal visible={mounted} transparent animationType="none" onRequestClose={onClose}>
      <View style={styles.drawerRoot}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose}>
          <Animated.View style={[styles.drawerBackdrop, { opacity: backdrop }]} />
        </Pressable>

        <Animated.View
          style={[
            styles.drawerPanel,
            {
              width: panelWidth,
              transform: [{ translateX: slide }],
            },
          ]}
        >
          <View
            style={[styles.invoiceTopBar, isMobile && styles.invoiceTopBarMobile]}
            {...(Platform.OS === 'web' && isMobile ? { className: 'cgold-mobile-sheet-top' } : null)}
          >
            <Text style={styles.invoiceDocLabel}>Email capture</Text>
            <Pressable onPress={onClose} hitSlop={8} style={styles.drawerClose}>
              <Ionicons name="close" size={18} color="#6b6b6b" />
            </Pressable>
          </View>

          <ScrollView
            style={styles.drawerBody}
            contentContainerStyle={[
              styles.drawerBodyContent,
              isMobile && styles.drawerBodyContentMobile,
            ]}
            showsVerticalScrollIndicator={false}
          >
            <EmailStoreSummary store={heldStore} />
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

// Email-capture breakdown for one store. Shared by the capture drawer and the
// inline store-scoped view inside the store details drawer.
function EmailStoreSummary({ store, showName = true }) {
  if (!store) return null;
  return (
    <>
      <View style={styles.invoiceHeaderRow}>
        <View style={styles.invoiceHeaderLeft}>
          {showName ? <Text style={styles.invoiceNumber}>{store.store}</Text> : null}
          <Text style={styles.emailDrawerSubtitle}>
            {store.customerCount} named + {store.walkInCount} walk-in ={' '}
            {store.totalTransactions} transactions
          </Text>
        </View>
        <View style={styles.invoiceHeaderRight}>
          <Text style={styles.invoiceTotalLabelTop}>Email rate</Text>
          <Text style={styles.invoiceTotalHero}>{store.rateLabel}</Text>
          <Text style={styles.invoicePartyDetail}>
            {store.withEmail} ÷ {store.customerCount} named
          </Text>
        </View>
      </View>

      <Text style={[styles.emailDrawerSubtitle, { marginBottom: 12 }]}>
        Rate = customers with a valid email ÷ named customers. Walk-ins are excluded from
        the percentage.
      </Text>

      <View style={styles.invoiceInfoGrid}>
        <View style={styles.invoiceInfoCard}>
          <Text style={styles.invoiceSectionLabel}>Named customers</Text>
          <Text style={styles.invoicePartyName}>{store.customerCount}</Text>
          <Text style={styles.invoicePartyDetail}>
            {store.withEmail} with valid email · {store.peopleFractionLabel} of txs
          </Text>
        </View>
        <View style={styles.invoiceInfoCard}>
          <Text style={styles.invoiceSectionLabel}>Walk-in</Text>
          <Text style={styles.invoicePartyName}>{store.walkInCount}</Text>
          <Text style={styles.invoicePartyDetail}>
            Excluded from rate · {store.walkInCount} of{' '}
            {store.totalTransactions} transactions
          </Text>
        </View>
      </View>

      <View style={styles.invoiceSection}>
        <Text style={styles.invoiceSectionLabel}>Named customer breakdown</Text>
        <View style={styles.emailBreakdownHeader}>
          <Text style={[styles.emailBreakdownHeaderText, styles.emailBreakdownColPerson]}>
            Person
          </Text>
          <Text style={[styles.emailBreakdownHeaderText, styles.emailBreakdownColEmail]}>
            Email
          </Text>
          <Text style={[styles.emailBreakdownHeaderText, styles.emailBreakdownColEmployee]}>
            Employee
          </Text>
        </View>

        {store.people.length === 0 ? (
          <Text style={styles.invoiceEmptyLine}>No named customers in this period.</Text>
        ) : (
          store.people.map((person) => (
            <View key={person.id} style={styles.emailBreakdownRow}>
              <Text style={styles.emailBreakdownPerson} numberOfLines={2}>
                {person.customerName}
              </Text>
              <Text
                style={[
                  styles.emailBreakdownEmail,
                  !person.hasEmail && styles.emailBreakdownEmailMissing,
                ]}
                numberOfLines={2}
              >
                {person.emailLabel}
              </Text>
              <Text style={styles.emailBreakdownEmployee} numberOfLines={2}>
                {person.employeeName}
              </Text>
            </View>
          ))
        )}
      </View>
    </>
  );
}

function EmailCaptureScreen({
  session,
  onRequireLogin,
  focus = null,
  onFocusConsumed,
  storeFilter = '',
}) {
  const initialRange = useMemo(() => defaultDateRange(7), []);
  const [dateMode, setDateMode] = useState('day'); // 'day' | 'range'
  const [startDate, setStartDate] = useState(() => parseDateParam(new Date()));
  const [endDate, setEndDate] = useState(() => parseDateParam(new Date()));
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedStore, setSelectedStore] = useState(null);
  const requestId = useRef(0);
  const pendingStoreRef = useRef(null);
  const appliedFocusKey = useRef(null);

  const todayKey = formatDateParam(parseDateParam(new Date()));
  const startKey = formatDateParam(startDate);
  const endKey = dateMode === 'day' ? startKey : formatDateParam(endDate);
  const isToday = dateMode === 'day' && startKey === todayKey;

  useEffect(() => {
    if (!focus?.key || focus.key === appliedFocusKey.current) return;
    appliedFocusKey.current = focus.key;
    const nextStart = parseDateParam(focus.startDate || new Date());
    const nextEnd = parseDateParam(focus.endDate || focus.startDate || new Date());
    pendingStoreRef.current = focus.storeName || null;
    setDateMode(formatDateParam(nextStart) === formatDateParam(nextEnd) ? 'day' : 'range');
    setStartDate(nextStart);
    setEndDate(nextEnd);
    onFocusConsumed?.();
  }, [focus, onFocusConsumed]);

  const load = useCallback(async () => {
    if (!session?.token) {
      setRows([]);
      setError('');
      setSelectedStore(null);
      return;
    }

    const id = ++requestId.current;
    setLoading(true);
    setError('');

    try {
      const result = await fetchTransactions(session.token, {
        startDate: startKey,
        endDate: endKey,
      });
      if (id !== requestId.current) return;
      setRows(result.rows);
      if (!pendingStoreRef.current) {
        setSelectedStore(null);
      }
      setError('');
    } catch (err) {
      if (id !== requestId.current) return;
      setRows([]);
      setSelectedStore(null);
      setError(err?.message || 'Failed to load email capture.');
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [session?.token, startKey, endKey]);

  useEffect(() => {
    load();
  }, [load]);

  const storeRows = useMemo(() => {
    const all = buildEmailCaptureByStore(rows);
    if (!storeFilter) return all;
    return all.filter(
      (row) => row.store.localeCompare(storeFilter, undefined, { sensitivity: 'base' }) === 0,
    );
  }, [rows, storeFilter]);
  const scopedStoreRow = storeFilter ? storeRows[0] || null : null;

  useEffect(() => {
    const wanted = pendingStoreRef.current;
    // Store-scoped: the summary renders inline, so never pop the store drawer.
    if (storeFilter) {
      pendingStoreRef.current = null;
      return;
    }
    if (!wanted || !storeRows.length) return;
    const match = storeRows.find(
      (row) => row.store.localeCompare(wanted, undefined, { sensitivity: 'base' }) === 0,
    );
    if (match) {
      setSelectedStore(match);
      pendingStoreRef.current = null;
    }
  }, [storeFilter, storeRows]);

  const totals = useMemo(() => {
    const customerCount = storeRows.reduce((sum, row) => sum + row.customerCount, 0);
    const walkInCount = storeRows.reduce((sum, row) => sum + row.walkInCount, 0);
    const withEmail = storeRows.reduce((sum, row) => sum + row.withEmail, 0);
    const totalTransactions = customerCount + walkInCount;
    const rate = customerCount > 0 ? (withEmail / customerCount) * 100 : 0;
    return {
      customerCount,
      walkInCount,
      withEmail,
      totalTransactions,
      rateLabel: `${rate.toFixed(1)}%`,
      peopleFractionLabel:
        totalTransactions > 0 ? `${customerCount}/${totalTransactions}` : '0/0',
    };
  }, [storeRows]);

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
      <View style={styles.transactionsBody}>
        <Text style={styles.toolPageBody}>
          Sign in from Profile to load email capture by store.
        </Text>
        <Pressable style={styles.loginButton} onPress={onRequireLogin}>
          <Text style={styles.loginButtonText}>Go to Profile</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.transactionsBody}>
      <View style={styles.transactionsToolbar}>
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
            <DatePickerField
              label="Date"
              value={startDate}
              onChange={handleDayChange}
              maximumDate={new Date()}
            />
          ) : (
            <>
              <DatePickerField
                label="From"
                value={startDate}
                onChange={handleStartChange}
                maximumDate={endDate}
              />
              <Text style={styles.dateRangeSep}>–</Text>
              <DatePickerField
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

      <View style={styles.transactionsMetaRow}>
        <Text style={styles.transactionsMeta}>
          {loading && rows.length === 0
            ? 'Loading…'
            : storeFilter
              ? `${storeFilter} · ${totals.customerCount} named + ${totals.walkInCount} walk-in = ${totals.totalTransactions} txs · ${totals.rateLabel} email rate`
              : `${storeRows.length} store${storeRows.length === 1 ? '' : 's'} · ${totals.customerCount} named + ${totals.walkInCount} walk-in = ${totals.totalTransactions} txs · ${totals.rateLabel} email rate`}
          {dateMode === 'day'
            ? isToday
              ? ' · today'
              : ` · ${formatPickerDate(startDate)}`
            : ` · ${formatPickerDate(startDate)} – ${formatPickerDate(endDate)}`}
        </Text>
      </View>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      {storeFilter ? (
        <ScrollView
          style={styles.homeTableScroll}
          contentContainerStyle={styles.emailScopedContent}
          showsVerticalScrollIndicator={false}
        >
          {loading && rows.length === 0 ? (
            <View style={styles.homeTableEmpty}>
              <ActivityIndicator color="#1a1a1a" />
            </View>
          ) : scopedStoreRow ? (
            <EmailStoreSummary store={scopedStoreRow} showName={false} />
          ) : (
            <View style={styles.homeTableEmpty}>
              <Text style={styles.tableEmptyText}>
                No customers at {storeFilter} in this period.
              </Text>
            </View>
          )}
        </ScrollView>
      ) : (
      <View style={styles.homeTableWrap}>
        <View style={styles.homeTableHeader}>
          <Text style={[styles.homeHeaderCell, styles.homeColStore]}>Store</Text>
          <Text style={[styles.homeHeaderCell, styles.emailColCustomers]}>Customers</Text>
          <Text style={[styles.homeHeaderCell, styles.emailColRate]}>Email rate</Text>
        </View>

        {loading && storeRows.length === 0 ? (
          <View style={styles.homeTableEmpty}>
            <ActivityIndicator color="#1a1a1a" />
          </View>
        ) : storeRows.length === 0 ? (
          <View style={styles.homeTableEmpty}>
            <Text style={styles.tableEmptyText}>No customers in this period.</Text>
          </View>
        ) : (
          <ScrollView
            style={styles.homeTableScroll}
            contentContainerStyle={styles.homeTableListContent}
          >
            {storeRows.map((row) => {
              const selected = selectedStore?.store === row.store;
              return (
                <Pressable
                  key={row.store}
                  onPress={() => setSelectedStore(row)}
                  style={({ hovered, pressed }) => [
                    styles.homeTableRow,
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
                  <Text style={styles.homeCellEmailStore} numberOfLines={1}>
                    {row.store}
                  </Text>
                <View style={styles.emailColCustomers}>
                  <Text style={styles.homeCellPrimary} numberOfLines={1}>
                    {row.customerCount}
                  </Text>
                  <Text style={styles.homeCellSecondary} numberOfLines={1}>
                    ({row.withEmail} with email · {row.walkInCount} walk-in ·{' '}
                    {row.totalTransactions} txs)
                  </Text>
                </View>
                  <Text style={styles.emailCellRate} numberOfLines={1}>
                    {row.rateLabel}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        )}
      </View>
      )}

      <EmailStoreDrawer
        visible={Boolean(selectedStore)}
        store={selectedStore}
        onClose={() => setSelectedStore(null)}
      />
    </View>
  );
}

function TransactionsScreen({ session, onRequireLogin, storeFilter }) {
  const isMobile = useIsMobile();
  const { canFilter } = useAppAccess();
  const allowFilters = canFilter('transactions');
  const initialRange = useMemo(() => defaultDateRange(7), []);
  const [dateMode, setDateMode] = useState('day'); // 'day' | 'range'
  const [startDate, setStartDate] = useState(() => parseDateParam(new Date()));
  const [endDate, setEndDate] = useState(() => parseDateParam(new Date()));
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [summary, setSummary] = useState(null);
  const [columnFilters, setColumnFilters] = useState({});
  const [openFilter, setOpenFilter] = useState(null);
  const [fintracCashOnly, setFintracCashOnly] = useState(false);
  const [selectedRow, setSelectedRow] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const requestId = useRef(0);
  const detailRequestId = useRef(0);
  const paymentCache = useRef({});
  const enrichRequestId = useRef(0);
  const [itemLookup, setItemLookup] = useState(false);
  const [lookupQuery, setLookupQuery] = useState('');

  const todayKey = formatDateParam(parseDateParam(new Date()));
  const startKey = formatDateParam(startDate);
  const endKey = dateMode === 'day' ? startKey : formatDateParam(endDate);
  const isToday = dateMode === 'day' && startKey === todayKey;

  const load = useCallback(async () => {
    if (!session?.token) {
      setRows([]);
      setSummary(null);
      setError('');
      return;
    }

    const id = ++requestId.current;
    setLoading(true);
    setError('');

    try {
      const result = await fetchTransactions(session.token, {
        startDate: startKey,
        endDate: endKey,
      });
      if (id !== requestId.current) return;
      setRows(result.rows);
      setColumnFilters({});
      setOpenFilter(null);
      setFintracCashOnly(false);
      setSelectedRow(null);
      setDetail(null);
      setDetailError('');
      paymentCache.current = {};
      setItemLookup(false);
      setSummary({
        orderCount: result.orderCount,
        purchaseCount: result.purchaseCount,
      });
    } catch (err) {
      if (id !== requestId.current) return;
      setRows([]);
      setSummary(null);
      setError(err?.message || 'Failed to load transactions.');
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [session?.token, startKey, endKey]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const timer = setTimeout(() => setLookupQuery(query.trim()), 220);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!session?.token || rows.length === 0) return;

    const wantItems =
      lookupQuery.length >= 2 &&
      (queryLooksLikeItem(lookupQuery) || !rows.some((row) => rowMatchesQuery(row, lookupQuery)));
    const candidates = rows.filter((row) => {
      if (paymentCache.current[row.id]?.lineItemsLoaded && !needsPaymentEnrichment(row)) {
        return false;
      }
      if (needsPaymentEnrichment(row)) return true;
      return wantItems && needsLineItemEnrichment(row);
    });
    if (candidates.length === 0) {
      setItemLookup(false);
      return;
    }

    const enrichId = ++enrichRequestId.current;
    let cancelled = false;
    if (wantItems && candidates.some(needsLineItemEnrichment)) setItemLookup(true);

    (async () => {
      const queue = [...candidates];
      const workers = Array.from({ length: Math.min(4, queue.length) }, async () => {
        while (queue.length && !cancelled && enrichId === enrichRequestId.current) {
          const row = queue.shift();
          if (!row || paymentCache.current[row.id]?.lineItemsLoaded) continue;
          try {
            const detailPayload = await fetchTransactionDetail(session.token, {
              type: row.type,
              sourceId: row.sourceId,
            });
            if (cancelled || enrichId !== enrichRequestId.current) return;
            const enriched = needsPaymentEnrichment(row)
              ? withPaymentBreakdown(row, detailPayload)
              : withLineItems(row, detailPayload);
            paymentCache.current[row.id] = enriched;
            setRows((current) =>
              current.map((entry) => (entry.id === row.id ? enriched : entry)),
            );
          } catch {
            if (wantItems) {
              paymentCache.current[row.id] = { ...row, lineItemsLoaded: true };
              setRows((current) =>
                current.map((entry) =>
                  entry.id === row.id ? { ...entry, lineItemsLoaded: true } : entry,
                ),
              );
            }
          }
        }
      });
      await Promise.all(workers);
      if (!cancelled && enrichId === enrichRequestId.current) setItemLookup(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [session?.token, rows.length, startKey, endKey, lookupQuery]);

  const scopedRows = useMemo(() => {
    if (!storeFilter) return rows;
    return rows.filter((row) => rowMatchesAllocatedStore(row, storeFilter));
  }, [rows, storeFilter]);

  const columnOptions = useMemo(() => buildColumnOptions(scopedRows), [scopedRows]);

  const employeeCounts = useMemo(() => {
    const counts = {};
    for (const row of scopedRows) {
      const key = row.employeeName || '—';
      counts[key] = (counts[key] || 0) + 1;
    }
    return counts;
  }, [scopedRows]);

  const [staff, setStaff] = useState([]);
  useEffect(() => {
    let cancelled = false;
    listStaffProfiles()
      .then((rows) => {
        if (cancelled) return;
        setStaff((rows || []).filter((row) => row.isActive !== false));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const employeePhotos = useMemo(() => {
    const map = {};
    for (const row of scopedRows) {
      const name = row.employeeName || '';
      if (!name || map[name] != null) continue;
      map[name] = findStaffByEmployeeName(staff, name)?.avatarUrl || '';
    }
    return map;
  }, [scopedRows, staff]);

  const fintracCount = useMemo(
    () => scopedRows.reduce((count, row) => count + (isFintracCash(row) ? 1 : 0), 0),
    [scopedRows],
  );

  const activeFilterCount = useMemo(
    () =>
      FILTER_COLUMNS.reduce((count, col) => count + (columnFilters[col.key] != null ? 1 : 0), 0) +
      (fintracCashOnly ? 1 : 0),
    [columnFilters, fintracCashOnly],
  );

  const filteredRows = useMemo(() => {
    let result = scopedRows;

    if (fintracCashOnly) {
      result = result.filter((row) => isFintracCash(row));
    }

    for (let i = 0; i < FILTER_COLUMNS.length; i += 1) {
      const key = FILTER_COLUMNS[i].key;
      const filter = columnFilters[key];
      if (filter) {
        result = result.filter((row) => filter[row[key] || '—']);
      }
    }

    if (query.trim()) {
      result = result.filter((row) => rowMatchesQuery(row, query));
    }

    return result;
  }, [scopedRows, query, columnFilters, fintracCashOnly]);

  const openFilterColumn = openFilter
    ? FILTER_COLUMNS.find((col) => col.key === openFilter)
    : null;

  const clearColumnFilters = () => {
    setColumnFilters({});
    setOpenFilter(null);
    setFintracCashOnly(false);
  };

  useEffect(() => {
    if (allowFilters) return;
    setColumnFilters({});
    setOpenFilter(null);
    setFintracCashOnly(false);
  }, [allowFilters]);

  const cashSlips = useTxnCashBreakdowns(scopedRows);

  const closeDetail = useCallback(() => {
    setSelectedRow(null);
    setDetail(null);
    setDetailError('');
    setDetailLoading(false);
  }, []);

  const ensurePaymentBreakdown = useCallback(
    async (row) => {
      if (!session?.token || !row) return row?.paymentBreakdownLabel || '';
      if (paymentCache.current[row.id]?.paymentBreakdownLabel) {
        return paymentCache.current[row.id].paymentBreakdownLabel;
      }
      if (row.paymentBreakdownLabel && row.paymentBreakdown) {
        return row.paymentBreakdownLabel;
      }

      try {
        const detailPayload = await fetchTransactionDetail(session.token, {
          type: row.type,
          sourceId: row.sourceId,
        });
        const enriched = withPaymentBreakdown(row, detailPayload);
        paymentCache.current[row.id] = enriched;
        setRows((current) =>
          current.map((entry) => (entry.id === row.id ? enriched : entry)),
        );
        return enriched.paymentBreakdownLabel;
      } catch {
        return row.paymentBreakdownLabel || '';
      }
    },
    [session?.token],
  );

  const openDetail = useCallback(
    async (row) => {
      setSelectedRow(row);
      setDetail(null);
      setDetailError('');
      setDetailLoading(true);

      const id = ++detailRequestId.current;

      try {
        const next = await fetchTransactionDetail(session.token, {
          type: row.type,
          sourceId: row.sourceId,
        });
        if (id !== detailRequestId.current) return;
        setDetail(next);
        const enriched = withPaymentBreakdown(row, next);
        paymentCache.current[row.id] = enriched;
        setRows((current) =>
          current.map((entry) => (entry.id === row.id ? enriched : entry)),
        );
        setSelectedRow(enriched);
      } catch (err) {
        if (id !== detailRequestId.current) return;
        setDetailError(err?.message || 'Failed to load transaction details.');
      } finally {
        if (id === detailRequestId.current) setDetailLoading(false);
      }
    },
    [session?.token],
  );

  const renderTransaction = useCallback(
    ({ item }) => (
      <TransactionListRow
        item={item}
        selected={selectedRow?.id === item.id}
        onPress={openDetail}
        employeeCount={employeeCounts[item.employeeName] || 0}
        employeePhotoUrl={employeePhotos[item.employeeName] || ''}
        onAmountHover={ensurePaymentBreakdown}
        cashSaved={cashSlips.isSaved(item)}
        onCashPress={cashSlips.openEditor}
      />
    ),
    [
      selectedRow?.id,
      openDetail,
      employeeCounts,
      employeePhotos,
      ensurePaymentBreakdown,
      cashSlips.savedKey,
      cashSlips.isSaved,
      cashSlips.openEditor,
    ],
  );
  const keyExtractor = useCallback((item) => item.id, []);

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
      <View style={styles.transactionsBody}>
        <View style={styles.homeInnerCentered}>
          <Text style={[styles.contentTitle, styles.homeTitle]}>Transactions</Text>
          <Text style={styles.homeSubtitle}>Log in to load Aureus POS transactions.</Text>
          <Pressable style={[styles.loginButton, styles.homeLoginButton]} onPress={onRequireLogin}>
            <Text style={styles.loginButtonText}>Go to Profile</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.transactionsBody}>
      <View style={[styles.txToolbar, isMobile && styles.igToolPad, isMobile && styles.toolsToolbarMobile]}>
        <View style={[styles.toolsSearch, isMobile && styles.igSearchField]}>
          <Ionicons name="search" size={16} color="#8e8e93" style={styles.toolsSearchIcon} />
          <TextInput
            style={styles.toolsSearchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="Search items, customers, SO#"
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
      </View>

      <View style={[styles.homeControls, isMobile && styles.igToolPad, isMobile && styles.homeControlsMobile, styles.txControls]}>
        <View style={styles.homeSegment} accessibilityRole="tablist">
          <Pressable
            style={[
              styles.homeSegmentButton,
              dateMode === 'day' && isToday && styles.homeSegmentButtonActive,
            ]}
            onPress={selectToday}
            accessibilityRole="tab"
            accessibilityState={{ selected: dateMode === 'day' && isToday }}
          >
            <Text
              style={[
                styles.homeSegmentText,
                dateMode === 'day' && isToday && styles.homeSegmentTextActive,
              ]}
            >
              Today
            </Text>
          </Pressable>
          <Pressable
            style={[
              styles.homeSegmentButton,
              dateMode === 'range' && styles.homeSegmentButtonActive,
            ]}
            onPress={selectRange}
            accessibilityRole="tab"
            accessibilityState={{ selected: dateMode === 'range' }}
          >
            <Text
              style={[
                styles.homeSegmentText,
                dateMode === 'range' && styles.homeSegmentTextActive,
              ]}
            >
              Range
            </Text>
          </Pressable>
        </View>

        {dateMode === 'day' ? (
          <DatePickerField
            label="Date"
            value={startDate}
            onChange={handleDayChange}
            maximumDate={new Date()}
            plain
          />
        ) : (
          <>
            <DatePickerField
              label="From"
              value={startDate}
              onChange={handleStartChange}
              maximumDate={endDate}
              plain
            />
            <Text style={styles.homeDateSep}>–</Text>
            <DatePickerField
              label="To"
              value={endDate}
              onChange={handleEndChange}
              minimumDate={startDate}
              maximumDate={new Date()}
              plain
            />
          </>
        )}
      </View>

      <View style={[styles.homeMetaRow, styles.txMetaRow, isMobile && styles.igToolPad]}>
        <Text style={styles.homeMeta} numberOfLines={1}>
          {loading && rows.length === 0
            ? 'Loading…'
            : `${filteredRows.length}${
                filteredRows.length !== scopedRows.length || query.trim() || fintracCashOnly
                  ? ` of ${scopedRows.length}`
                  : ''
              } transaction${filteredRows.length === 1 ? '' : 's'}`}
          {summary && !query.trim() && activeFilterCount === 0
            ? ` · ${summary.orderCount} sales · ${summary.purchaseCount} purchases`
            : ''}
          {dateMode === 'day' && !query.trim() && activeFilterCount === 0
            ? isToday
              ? ' · today'
              : ` · ${formatPickerDate(startDate)}`
            : ''}
          {activeFilterCount > 0
            ? ` · ${activeFilterCount} filter${activeFilterCount > 1 ? 's' : ''}`
            : ''}
          {fintracCount > 0 && !fintracCashOnly ? ` · ${fintracCount} FINTRAC cash` : ''}
        </Text>
        {fintracCashOnly ? (
          <Text style={styles.fintracFilterBadge}>FINTRAC cash ≥ $10k</Text>
        ) : null}
        {activeFilterCount > 0 ? (
          <Pressable onPress={clearColumnFilters} hitSlop={6}>
            <Text style={styles.clearFiltersText}>Clear</Text>
          </Pressable>
        ) : null}
        {(loading && rows.length > 0) || itemLookup ? (
          <ActivityIndicator size="small" color="#8e8e93" />
        ) : null}
      </View>

      {error ? <Text style={[styles.errorText, styles.homeError]}>{error}</Text> : null}

      {loading && rows.length === 0 ? (
        <View style={styles.centered}>
          <ActivityIndicator color="#1d1d1f" />
        </View>
      ) : (
        <View style={styles.txListWrap}>
          <TxTableHeader
            columnFilters={columnFilters}
            fintracCashOnly={fintracCashOnly}
            onOpenFilter={setOpenFilter}
            interactive={allowFilters}
          />
          <FlashList
            data={filteredRows}
            keyExtractor={keyExtractor}
            renderItem={renderTransaction}
            extraData={`${selectedRow?.id}:${cashSlips.savedKey}:${staff.length}`}
            style={styles.tableList}
            contentContainerStyle={styles.txListContent}
            showsVerticalScrollIndicator={false}
            drawDistance={400}
            ListEmptyComponent={
              !loading && !error ? (
                <Text style={styles.homeTxEmpty}>
                  {itemLookup
                    ? 'Looking up items…'
                    : query.trim() || activeFilterCount > 0
                    ? 'No transactions match the current filters.'
                    : dateMode === 'day'
                      ? isToday
                        ? 'No transactions today.'
                        : `No transactions on ${formatPickerDate(startDate)}.`
                      : 'No transactions in this date range.'}
                </Text>
              ) : null
            }
          />

          {openFilterColumn && allowFilters ? (
            <ColumnFilterMenu
              field={openFilterColumn.key}
              label={openFilterColumn.label}
              options={columnOptions[openFilterColumn.key] || []}
              filter={columnFilters[openFilterColumn.key] ?? null}
              onChange={(next) => {
                setColumnFilters((current) => ({
                  ...current,
                  [openFilterColumn.key]: next,
                }));
              }}
              onClose={() => setOpenFilter(null)}
              fintracOnly={fintracCashOnly}
              onToggleFintrac={() => setFintracCashOnly((current) => !current)}
              fintracCount={fintracCount}
            />
          ) : null}

          <TransactionDetailDrawer
            visible={Boolean(selectedRow)}
            summary={selectedRow}
            detail={detail}
            loading={detailLoading}
            error={detailError}
            onClose={closeDetail}
          />
          <TxnCashBreakdownModal
            visible={Boolean(cashSlips.editorRow)}
            session={session}
            row={cashSlips.editorRow}
            initialSheet={cashSlips.editorSheet}
            onClose={cashSlips.closeEditor}
            onSaved={cashSlips.onSaved}
          />
        </View>
      )}
    </View>
  );
}

function moveArrayItem(array, fromIndex, toIndex) {
  if (
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= array.length ||
    toIndex >= array.length ||
    fromIndex === toIndex
  ) {
    return array;
  }
  const next = array.slice();
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item);
  return next;
}

function unreadBadgeText(count) {
  const n = Number(count) || 0;
  if (n <= 0) return '';
  if (n > 99) return '99+';
  return String(n);
}

function MessagesUnreadBadge({ count }) {
  const label = unreadBadgeText(count);
  if (!label) return null;
  return (
    <View style={styles.messagesUnreadBadge} pointerEvents="none">
      <Text style={styles.messagesUnreadBadgeText}>{label}</Text>
    </View>
  );
}

function SidebarNavItem({
  label,
  subtitle,
  icon,
  active,
  collapsed,
  onPress,
  grouped: _grouped,
  paintChrome = true,
  leading,
  trailing,
  style: extraStyle,
  accessibilityLabel,
  accessibilityHint,
  webClassName,
  onHoverIn,
  onHoverOut,
  onLayout,
}) {
  const [hovered, setHovered] = useState(false);
  const spoken = accessibilityLabel || (subtitle ? `${label}, ${subtitle}` : label);

  return (
    <Pressable
      onPress={onPress}
      onHoverIn={() => {
        setHovered(true);
        onHoverIn?.();
      }}
      onHoverOut={() => {
        setHovered(false);
        onHoverOut?.();
      }}
      onLayout={onLayout}
      accessibilityLabel={spoken}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityHint={accessibilityHint}
      {...(Platform.OS === 'web'
        ? { className: sidebarTabClassName(paintChrome && active, webClassName) }
        : null)}
      style={({ pressed, hovered: pressHovered }) => [
        styles.tab,
        collapsed && styles.tabCollapsed,
        subtitle && !collapsed && styles.tabWithSubtitle,
        extraStyle,
        (pressHovered || pressed) && !active && styles.tabHover,
        paintChrome && active && styles.tabActive,
      ]}
    >
      {leading || (
        <Ionicons
          name={active ? filledIonicon(icon) : icon}
          size={20}
          color={active ? TAB_ICON_ACTIVE_COLOR : TAB_ICON_COLOR}
          style={!collapsed ? styles.tabIcon : undefined}
        />
      )}
      {!collapsed ? (
        <View style={styles.tabLabelColumn}>
          <Text
            style={[
              styles.tabLabel,
              hovered && !active && styles.tabLabelHover,
              active && styles.tabLabelActive,
            ]}
            numberOfLines={1}
          >
            {label}
          </Text>
          {subtitle ? (
            <Text
              style={[styles.tabSubtitle, active && styles.tabSubtitleActive]}
              numberOfLines={1}
            >
              {subtitle}
            </Text>
          ) : null}
        </View>
      ) : null}
      {!collapsed ? trailing : null}
    </Pressable>
  );
}

function locationShortLabel(name) {
  const cleaned = String(name || '')
    .replace(/^canada\s*gold(?:\s*[-–—:])?\s*/i, '')
    .replace(/\s+canada\s*gold$/i, '')
    .trim();
  if (!cleaned) return '';
  const known = {
    montreal: 'MTL',
    toronto: 'TOR',
    ottawa: 'OTT',
    quebec: 'QC',
    'quebec city': 'QC',
    laval: 'LVL',
    mississauga: 'MIS',
    hamilton: 'HAM',
    calgary: 'CGY',
    edmonton: 'EDM',
    vancouver: 'VAN',
    'richmond hill': 'RH',
  };
  const match = known[cleaned.toLowerCase()];
  if (match) return match;
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return parts
      .map((part) => part[0])
      .join('')
      .slice(0, 3)
      .toUpperCase();
  }
  return cleaned.slice(0, 3).toUpperCase();
}

function SidebarIconButton({ icon, label, color, onPress, disabled, children }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      {...(Platform.OS === 'web' ? { title: label } : null)}
      style={({ pressed }) => [
        styles.profileQuickIcon,
        pressed && !disabled && styles.profileQuickIconPressed,
        disabled && styles.profileQuickIconDisabled,
      ]}
    >
      {children || <Ionicons name={icon} size={18} color={color || TAB_ICON_COLOR} />}
    </Pressable>
  );
}

function ProfileQuickActions({
  collapsed,
  locationName,
  notificationsActive,
  settingsActive,
  onOpenNotifications,
  onOpenLocation,
  onOpenSettings,
}) {
  const { silent, setSilent } = usePhoneCalls();
  const storeCode = locationShortLabel(locationName);
  const storeLabel = locationName ? `Store, ${locationName}` : 'Choose store location';

  return (
    <View style={[styles.profileQuickRow, collapsed && styles.profileQuickRowCollapsed]}>
      <SidebarIconButton
        icon={notificationsActive ? 'notifications' : 'notifications-outline'}
        label="Notifications"
        color={notificationsActive ? TAB_ICON_ACTIVE_COLOR : TAB_ICON_COLOR}
        onPress={onOpenNotifications}
      />
      <SidebarIconButton
        icon={silent ? 'volume-mute' : 'volume-high'}
        label={silent ? 'Turn ringtone on' : 'Ringtone on'}
        color={silent ? '#FF3B30' : TAB_ICON_COLOR}
        onPress={() => setSilent(!silent)}
      />
      <SidebarIconButton label={storeLabel} onPress={onOpenLocation}>
        {storeCode ? (
          <View style={[styles.profileStoreMark, { backgroundColor: storeAccent(locationName) }]}>
            <Text style={styles.profileStoreMarkText} numberOfLines={1}>
              {storeCode}
            </Text>
          </View>
        ) : (
          <Ionicons name="location-outline" size={18} color="#c7c7cc" />
        )}
      </SidebarIconButton>
      <SidebarIconButton
        icon={settingsActive ? 'settings' : 'settings-outline'}
        label="Profile settings"
        color={settingsActive ? TAB_ICON_ACTIVE_COLOR : TAB_ICON_COLOR}
        onPress={onOpenSettings}
      />
    </View>
  );
}

function TradeActionButton({ kind, label, collapsed, active, onPress, position }) {
  const palette = kind === 'sell' ? TRADE_SELL : TRADE_BUY;
  const hint =
    kind === 'sell' ? 'Sell metal to a customer' : 'Buy metal from a customer';
  const [hovered, setHovered] = useState(false);
  const labelColor = active ? palette.accent : hovered ? '#1d1d1f' : '#6e6e73';

  return (
    <Pressable
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ selected: active }}
      {...(Platform.OS === 'web' ? { title: `${label} — ${hint}` } : null)}
      style={({ pressed, hovered: pressHovered }) => [
        styles.tab,
        collapsed && styles.tabCollapsed,
        styles.tradeSegment,
        position === 'top' && styles.tradeSegmentTop,
        position === 'bottom' && styles.tradeSegmentBottom,
        { backgroundColor: palette.fill },
        (pressHovered || pressed || active) && { backgroundColor: palette.fillHover },
      ]}
    >
      <Ionicons
        name={active ? filledIonicon(palette.icon) : palette.icon}
        size={20}
        color={palette.accent}
        style={!collapsed ? styles.tabIcon : undefined}
      />
      {!collapsed ? (
        <Text
          style={[styles.tabLabel, { color: labelColor }, active && { fontWeight: '600' }]}
          numberOfLines={1}
        >
          {label}
        </Text>
      ) : null}
    </Pressable>
  );
}

function SidebarTradeActions({ collapsed, buyActive, sellActive, onSelectBuy, onSelectSell }) {
  return (
    <View style={styles.tradePair} accessibilityRole="toolbar" accessibilityLabel="Buy and sell">
      <TradeActionButton
        kind="buy"
        label="Buy"
        position="top"
        collapsed={collapsed}
        active={buyActive}
        onPress={onSelectBuy}
      />
      <TradeActionButton
        kind="sell"
        label="Sell"
        position="bottom"
        collapsed={collapsed}
        active={sellActive}
        onPress={onSelectSell}
      />
    </View>
  );
}

function SidebarNavGroup({
  collapsed,
  homeActive,
  appsActive,
  messagesActive,
  profileActive,
  notificationsActive,
  onSelectHome,
  onSelectApps,
  onSelectMessages,
  onSelectProfile,
  onOpenNotifications,
  onOpenLocation,
  onOpenSettings,
  profileLabel,
  profileLocation,
  profileAvatarUrl,
  showMessages = true,
  messagesUnread = 0,
  settingsActive = false,
}) {
  const items = [
    { key: 'home', label: 'Home', icon: 'home-outline', active: homeActive, onPress: onSelectHome },
    { key: 'tools', label: 'Apps', icon: 'apps-outline', active: appsActive, onPress: onSelectApps },
    showMessages
      ? {
          key: 'messages',
          label: 'Direct Messages',
          icon: 'chatbubbles-outline',
          active: messagesActive,
          onPress: onSelectMessages,
          accessibilityLabel:
            messagesUnread > 0
              ? `Direct Messages, ${messagesUnread} unread`
              : 'Direct Messages',
          leading: (
            <View style={[!collapsed ? styles.tabIcon : null, styles.sidebarMessagesIcon]}>
              <Ionicons
                name={messagesActive ? 'chatbubbles' : 'chatbubbles-outline'}
                size={20}
                color={messagesActive ? TAB_ICON_ACTIVE_COLOR : TAB_ICON_COLOR}
              />
              <MessagesUnreadBadge count={messagesUnread} />
            </View>
          ),
        }
      : null,
    {
      key: 'profile',
      label: profileLabel || PROFILE_TAB.label,
      icon: PROFILE_TAB.icon,
      active: profileActive,
      onPress: onSelectProfile,
      leading: (
        <ProfileAvatar
          uri={profileAvatarUrl}
          name={profileLabel}
          size={22}
          style={!collapsed ? styles.tabIcon : undefined}
        />
      ),
    },
  ].filter(Boolean);

  const layoutsRef = useRef({});
  const indicatorY = useRef(new Animated.Value(0)).current;
  const indicatorH = useRef(new Animated.Value(42)).current;
  const indicatorOpacity = useRef(new Animated.Value(0)).current;
  const positionedRef = useRef(false);
  const [layoutsVersion, setLayoutsVersion] = useState(0);

  const activeKey = homeActive
    ? 'home'
    : appsActive
      ? 'tools'
      : messagesActive
        ? 'messages'
        : profileActive
          ? 'profile'
          : null;

  const onItemLayout = (key, event) => {
    const { y, height } = event.nativeEvent.layout;
    if (!(height > 0)) return;
    const prev = layoutsRef.current[key];
    if (prev && Math.abs(prev.y - y) < 0.5 && Math.abs(prev.height - height) < 0.5) return;
    layoutsRef.current[key] = { y, height };
    setLayoutsVersion((value) => value + 1);
  };

  useEffect(() => {
    if (!activeKey) {
      Animated.timing(indicatorOpacity, {
        toValue: 0,
        duration: 140,
        easing: Easing.out(Easing.quad),
        useNativeDriver: false,
      }).start();
      return undefined;
    }

    const layout = layoutsRef.current[activeKey];
    if (!layout) return undefined;

    if (!positionedRef.current) {
      indicatorY.setValue(layout.y);
      indicatorH.setValue(layout.height);
      indicatorOpacity.setValue(1);
      positionedRef.current = true;
      return undefined;
    }

    Animated.parallel([
      Animated.spring(indicatorY, {
        toValue: layout.y,
        damping: 26,
        stiffness: 280,
        mass: 0.72,
        useNativeDriver: false,
      }),
      Animated.spring(indicatorH, {
        toValue: layout.height,
        damping: 26,
        stiffness: 280,
        mass: 0.72,
        useNativeDriver: false,
      }),
      Animated.timing(indicatorOpacity, {
        toValue: 1,
        duration: 120,
        easing: Easing.out(Easing.quad),
        useNativeDriver: false,
      }),
    ]).start();
    return undefined;
  }, [activeKey, layoutsVersion, collapsed, indicatorY, indicatorH, indicatorOpacity]);

  return (
    <View style={[styles.sidebarNavStack, collapsed && styles.sidebarNavGroupCollapsed]}>
      <View
        style={[styles.sidebarNavGroup, collapsed && styles.sidebarNavGroupCollapsed]}
        {...(Platform.OS === 'web' ? { className: 'cgold-tab-well' } : null)}
      >
        <Animated.View
          pointerEvents="none"
          {...(Platform.OS === 'web' ? { className: 'cgold-tab-glass' } : null)}
          style={[
            styles.tabIndicator,
            {
              top: indicatorY,
              height: indicatorH,
              opacity: indicatorOpacity,
            },
          ]}
        />
        {items.map((item) => (
          <SidebarNavItem
            key={item.key}
            label={item.label}
            subtitle={item.subtitle}
            icon={item.icon}
            leading={item.leading}
            trailing={item.trailing}
            accessibilityLabel={item.accessibilityLabel}
            active={item.active}
            collapsed={collapsed}
            grouped
            paintChrome={false}
            style={styles.sidebarNavItem}
            onLayout={(event) => onItemLayout(item.key, event)}
            onPress={item.onPress}
          />
        ))}
      </View>
      <ProfileQuickActions
        collapsed={collapsed}
        locationName={profileLocation}
        notificationsActive={notificationsActive}
        settingsActive={settingsActive}
        onOpenNotifications={onOpenNotifications}
        onOpenLocation={onOpenLocation}
        onOpenSettings={onOpenSettings}
      />
    </View>
  );
}

function PinnedToolsList({
  tools,
  activeToolKey,
  sidebarCollapsed,
  onOpen,
  onUnpin,
  onReorder,
}) {
  const listRef = useRef(null);
  const toolsRef = useRef(tools);
  const onReorderRef = useRef(onReorder);
  const draggingKeyRef = useRef(null);
  const didDragRef = useRef(false);
  const suppressPressRef = useRef(false);
  const startYRef = useRef(0);
  const listPageYRef = useRef(0);
  const itemHeightRef = useRef(46);
  const [draggingKey, setDraggingKey] = useState(null);

  toolsRef.current = tools;
  onReorderRef.current = onReorder;

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const endDrag = () => {
      if (!draggingKeyRef.current) return;
      if (didDragRef.current) {
        suppressPressRef.current = true;
      }
      draggingKeyRef.current = null;
      didDragRef.current = false;
      setDraggingKey(null);
    };

    const onPointerMove = (event) => {
      const fromKey = draggingKeyRef.current;
      if (!fromKey) return;

      const pageY = event.clientY;
      if (!didDragRef.current) {
        if (Math.abs(pageY - startYRef.current) < 5) return;
        didDragRef.current = true;
        setDraggingKey(fromKey);
      }

      const currentTools = toolsRef.current;
      const relativeY = pageY - listPageYRef.current;
      const height = itemHeightRef.current || 46;
      let toIndex = Math.floor((relativeY + height / 2) / height);
      toIndex = Math.max(0, Math.min(currentTools.length - 1, toIndex));
      const fromIndex = currentTools.findIndex((tool) => tool.key === fromKey);
      if (fromIndex >= 0 && fromIndex !== toIndex) {
        onReorderRef.current(fromIndex, toIndex);
      }
    };

    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
    window.addEventListener('pointermove', onPointerMove);
    return () => {
      window.removeEventListener('pointerup', endDrag);
      window.removeEventListener('pointercancel', endDrag);
      window.removeEventListener('pointermove', onPointerMove);
    };
  }, []);

  const measureList = () => {
    listRef.current?.measureInWindow?.((x, y) => {
      listPageYRef.current = y;
    });
  };

  const beginDrag = (toolKey, pageY) => {
    measureList();
    draggingKeyRef.current = toolKey;
    didDragRef.current = false;
    startYRef.current = pageY;
  };

  if (tools.length === 0) return null;

  return (
    <View style={styles.pinnedSection}>
      <View style={styles.pinnedSeparator} />
      <View
        ref={listRef}
        style={styles.pinnedList}
        onLayout={() => {
          measureList();
        }}
      >
        {tools.map((tool) => {
          const isActive = activeToolKey === tool.key;
          const isDragging = draggingKey === tool.key;
          return (
            <Pressable
              key={tool.key}
              onPress={() => {
                if (suppressPressRef.current) {
                  suppressPressRef.current = false;
                  return;
                }
                onOpen(tool);
              }}
              onPointerDown={(event) => {
                if (event?.nativeEvent?.button != null && event.nativeEvent.button !== 0) return;
                beginDrag(tool.key, event.nativeEvent.pageY ?? event.nativeEvent.clientY ?? 0);
              }}
              onLayout={(event) => {
                const { height } = event.nativeEvent.layout;
                if (height > 0) itemHeightRef.current = height + 2;
              }}
              {...(Platform.OS === 'web'
                ? { className: sidebarTabClassName(isActive, 'cgold-sidebar-item') }
                : null)}
              style={({ pressed, hovered }) => [
                styles.tab,
                styles.pinnedTab,
                sidebarCollapsed && styles.tabCollapsed,
                (hovered || pressed) && !isActive && styles.tabHover,
                isActive && styles.tabActive,
                isDragging && styles.pinnedTabDragging,
              ]}
              accessibilityLabel={tool.label}
              accessibilityHint="Drag to reorder"
            >
              <View
                style={[
                  styles.pinnedAppIcon,
                  sidebarCollapsed && styles.pinnedAppIconCollapsed,
                  { backgroundColor: tool.accent },
                ]}
              >
                <Ionicons name={filledIonicon(tool.icon)} size={14} color="#fff" />
              </View>
              {!sidebarCollapsed ? (
                <>
                  <Text
                    style={[styles.tabLabel, isActive && styles.tabLabelActive]}
                    numberOfLines={1}
                  >
                    {tool.label}
                  </Text>
                  <Pressable
                    style={styles.pinnedRemoveButton}
                    {...(Platform.OS === 'web' ? { className: 'cgold-sidebar-unpin' } : null)}
                    onPress={() => onUnpin(tool.key)}
                    onPointerDown={(event) => {
                      event?.stopPropagation?.();
                      draggingKeyRef.current = null;
                    }}
                    hitSlop={6}
                    accessibilityLabel={`Unpin ${tool.label}`}
                  >
                    <Ionicons name="remove-circle-outline" size={16} color="#c7c7cc" />
                  </Pressable>
                </>
              ) : null}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export default function App() {
  const isMobile = useIsMobile();
  const appGrid = useAppGridLayout();
  const [activeTab, setActiveTab] = useState('home');
  const [activeTool, setActiveTool] = useState(null);
  const [triageStoreBack, setTriageStoreBack] = useState(null);
  const [triageBatch, setTriageBatch] = useState(null);
  const [triageNav, setTriageNav] = useState(null);
  const [settingsPanel, setSettingsPanel] = useState(null);
  const [analyticsMini, setAnalyticsMini] = useState(null);
  const [toolsQuery, setToolsQuery] = useState('');
  const [pinnedKeys, setPinnedKeys] = useState([]);
  const [appsView, setAppsView] = useState(DEFAULT_APPS_VIEW);
  const [appsToolbarHeight, setAppsToolbarHeight] = useState(0);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [session, setSession] = useState(null);
  const [bootstrapping, setBootstrapping] = useState(true);
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [emailsFocus, setEmailsFocus] = useState(null);
  const [accessByRole, setAccessByRole] = useState(null);
  const [ownUserAccess, setOwnUserAccess] = useState(null);
  const [viewedProfile, setViewedProfile] = useState(null);
  const [dmFocusUserId, setDmFocusUserId] = useState('');
  const [teamsFocusId, setTeamsFocusId] = useState('');
  const [profileReturnTo, setProfileReturnTo] = useState(null);
  const [locationPickerOpen, setLocationPickerOpen] = useState(false);
  const emailsFocusSeq = useRef(0);

  const [fontsLoaded, fontsError] = useFonts(
    Platform.OS === 'web'
      ? {
          Sohne: '/fonts/Sohne-Buch.otf',
          SohneLeicht: '/fonts/Sohne-Leicht.otf',
          SohneMono: '/fonts/SohneMono-Buch.otf',
          ionicons: '/fonts/Ionicons.ttf',
          'material-community': '/fonts/MaterialCommunityIcons.ttf',
          feather: '/fonts/Feather.ttf',
        }
      : {
          Sohne: require('./assets/sohne-font-family/TestSohne-Buch-BF663d89cd32e6a.otf'),
          SohneLeicht: require('./assets/sohne-font-family/TestSohne-Leicht-BF663d89cd4952e.otf'),
          SohneMono: require('./assets/sohne-font-family/TestSohneMono-Buch-BF663d89cbcec64.otf'),
          ...Ionicons.font,
          ...MaterialCommunityIcons.font,
          ...Feather.font,
        },
  );

  const isLoggedIn = Boolean(session?.token && session?.supabaseUserId);
  const scopedStore = scopedStoreName(session?.profile);
  const userLabel = displayName(session) || PROFILE_TAB.label;
  const activeLabel =
    activeTab === 'profile'
      ? userLabel
      : TRADE_TABS.find((tab) => tab.key === activeTab)?.label ||
        MAIN_TABS.find((tab) => tab.key === activeTab)?.label;

  // Always enforced. When role_app_access is unreadable the category defaults
  // apply; there is no "show everything" fallback.
  const allowedToolKeys = useMemo(
    () => new Set(visibleAppKeysForProfile(session?.profile, accessByRole, ACCESS_CATALOG_KEYS, ownUserAccess)),
    [session?.profile, accessByRole, ownUserAccess],
  );
  const hasApp = useCallback((key) => allowedToolKeys.has(key), [allowedToolKeys]);
  const canFilter = useCallback(
    (key) => canFilterApp(session?.profile, key, ownUserAccess, allowedToolKeys),
    [session?.profile, ownUserAccess, allowedToolKeys],
  );
  const appAccessValue = useMemo(
    () => ({
      allowedKeys: allowedToolKeys,
      canManageAccess: canManageAppAccess(session?.profile),
      hasApp,
      canFilter,
    }),
    [allowedToolKeys, hasApp, canFilter, session?.profile],
  );

  const { unread: messagesUnread, refreshUnread: refreshMessagesUnread } = useDirectMessages(
    session,
    {
      enabled: isLoggedIn && hasApp('messages'),
    },
  );

  const normalizedToolsQuery = toolsQuery.trim().toLowerCase();
  const matchesToolsQuery = (tool) =>
    !normalizedToolsQuery || tool.label.toLowerCase().includes(normalizedToolsQuery);

  const pinnedTools = pinnedKeys
    .map((key) => TOOL_CARDS.find((tool) => tool.key === key))
    .filter((tool) => tool && hasApp(tool.key));
  const filteredTools = TOOL_CARDS.filter((tool) => hasApp(tool.key) && matchesToolsQuery(tool));
  const hasSearchResults = filteredTools.length > 0;

  const resetToSignedOut = useCallback(() => {
    clearInventoryCache();
    clearTriageCache();
    setSession(null);
    setPinnedKeys([]);
    setAppsView(DEFAULT_APPS_VIEW);
    setAccessByRole(null);
    setOwnUserAccess(null);
    setLoginId('');
    setPassword('');
    setLoginError('');
    setActiveTab('home');
    setActiveTool(null);
    setSettingsPanel(null);
    setAnalyticsMini(null);
    setViewedProfile(null);
    setDmFocusUserId('');
    setTeamsFocusId('');
    setProfileReturnTo(null);
    setLocationPickerOpen(false);
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      let restored = null;
      try {
        restored = await restoreSession();
      } catch {
        restored = null;
      }
      if (cancelled) return;

      if (restored?.token) {
        const [pins, access, view, userAccess] = await Promise.all([
          loadPinnedTools(restored, TOOL_KEYS),
          loadRoleAppAccess(ACCESS_CATALOG_KEYS),
          loadAppsView(restored),
          loadOwnUserAppAccess(restored.supabaseUserId || restored.profile?.id, ACCESS_CATALOG_KEYS),
        ]);
        if (cancelled) return;
        setSession(restored);
        setPinnedKeys(pins);
        setAppsView(view);
        setAccessByRole(access.byRole);
        setOwnUserAccess(userAccess);
        prefetchInventoryMatrix(restored);
      } else {
        setSession(null);
        setPinnedKeys([]);
        setAppsView(DEFAULT_APPS_VIEW);
        setAccessByRole(null);
        setOwnUserAccess(null);
      }

      setBootstrapping(false);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Tell the action ledger who is signed in and where they are so every
  // button press (see lib/actionLog) is attributed and placed.
  useEffect(() => {
    setActionLogActor(session);
  }, [session]);

  useEffect(() => {
    setActionLogContext({
      tab: activeTab,
      appKey: activeTab === 'tools' ? activeTool?.key || '' : '',
      appLabel: activeTab === 'tools' ? activeTool?.label || '' : '',
    });
  }, [activeTab, activeTool?.key, activeTool?.label]);

  // If Supabase revokes the session (another tab signed out, refresh token
  // rejected) or Aureus rejects the POS token, drop straight to the login screen.
  const hasSessionRef = useRef(false);
  const sessionLoginRef = useRef('');
  useEffect(() => {
    hasSessionRef.current = Boolean(session?.token);
  }, [session?.token]);
  useEffect(() => {
    sessionLoginRef.current = session?.login || '';
  }, [session?.login]);

  const expireToLogin = useCallback(
    async (message) => {
      if (!hasSessionRef.current) return;
      const rememberedLogin = sessionLoginRef.current;
      hasSessionRef.current = false;
      await logoutRequest().catch(() => {});
      resetToSignedOut();
      if (rememberedLogin) setLoginId(rememberedLogin);
      if (message) setLoginError(message);
    },
    [resetToSignedOut],
  );

  useEffect(() => {
    const unsubscribe = onSessionRevoked(() => {
      if (hasSessionRef.current) resetToSignedOut();
    });
    return unsubscribe;
  }, [resetToSignedOut]);

  useEffect(() => {
    return onAureusSessionExpired(() => {
      expireToLogin('Your Aureus session expired. Please log in again.');
    });
  }, [expireToLogin]);

  useEffect(() => {
    if (!session?.token) return undefined;
    return watchAureusToken({ token: session.token, baseUrl: session.baseUrl });
  }, [session?.token, session?.baseUrl]);

  useEffect(() => {
    const token = session?.token;
    const employeeId = session?.profile?.aureusUserId;
    const baseUrl = session?.baseUrl;
    if (!token || !employeeId) return undefined;

    let cancelled = false;
    fetchAureusEmployee(token, employeeId, baseUrl)
      .then(({ mapped }) => {
        if (cancelled || !mapped) return;
        const locationId = mapped.locationId || '';
        const locationName = mapped.locationName || '';
        if (!locationId && !locationName) return;
        setSession((current) => {
          if (!current?.profile) return current;
          if (
            String(current.profile.locationId || '') === String(locationId) &&
            (current.profile.locationName || '') === locationName
          ) {
            return current;
          }
          return {
            ...current,
            profile: {
              ...current.profile,
              locationId: locationId || current.profile.locationId,
              locationName: locationName || current.profile.locationName,
            },
          };
        });
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [session?.token, session?.profile?.aureusUserId, session?.baseUrl]);

  useEffect(() => {
    if (bootstrapping || !session?.token) return;
    if (readGmailOAuthCallback() && hasApp('emails')) {
      const emailsTool = TOOL_CARDS.find((tool) => tool.key === 'emails');
      setActiveTab('tools');
      setActiveTool(emailsTool || { key: 'emails', label: 'Emails' });
      setSettingsPanel(null);
      setToolsQuery('');
      return;
    }
    const callback = readRipplingOAuthCallback();
    if (!callback) return;
    const expected = readRipplingOAuthState();
    if (!expected || expected !== callback.state) return;
    if (!hasApp('employees')) return;
    const employeesTool = TOOL_CARDS.find((tool) => tool.key === 'employees');
    setActiveTab('tools');
    setActiveTool(employeesTool || { key: 'employees', label: 'Employees' });
    setSettingsPanel(null);
    setToolsQuery('');
  }, [bootstrapping, session?.token, hasApp]);

  const selectTab = (tabKey) => {
    if (tabKey === 'profile') {
      setViewedProfile(null);
      setProfileReturnTo(null);
    }
    setActiveTab(tabKey);
    setSettingsPanel(null);
    setAnalyticsMini(null);
    if (tabKey === 'tools') {
      setActiveTool(null);
    } else {
      setActiveTool(null);
      setToolsQuery('');
    }
  };

  const applyOwnLocation = useCallback(({ locationId, locationName }) => {
    setSession((current) => {
      if (!current?.profile) return current;
      return {
        ...current,
        user: current.user
          ? { ...current.user, location_id: locationId || current.user.location_id }
          : current.user,
        profile: {
          ...current.profile,
          locationId: locationId || current.profile.locationId,
          locationName: locationName || current.profile.locationName,
        },
      };
    });
  }, []);

  const openNotificationsApp = () => {
    const tool = TOOL_CARDS.find((item) => item.key === 'notifications') || {
      key: 'notifications',
      label: 'Notifications',
    };
    setActiveTab('tools');
    setActiveTool(tool);
    setSettingsPanel(null);
    setToolsQuery('');
  };

  const openSettingsApp = () => {
    const tool = TOOL_CARDS.find((item) => item.key === 'settings') || {
      key: 'settings',
      label: 'Settings',
    };
    if (!hasApp(tool.key)) return;
    setActiveTab('tools');
    setActiveTool(tool);
    setSettingsPanel(null);
    setToolsQuery('');
  };

  const openPersonProfile = (raw) => {
    const person = profileTargetFromPerson(raw);
    const myId = session?.supabaseUserId || session?.profile?.id || '';
    if (person?.profileId && myId && person.profileId === myId) {
      setViewedProfile(null);
      setProfileReturnTo(null);
    } else {
      setViewedProfile(person);
      setProfileReturnTo(activeTab === 'home' ? 'home' : null);
    }
    setActiveTab('profile');
    setActiveTool(null);
    setSettingsPanel(null);
    setToolsQuery('');
  };

  const messagePerson = (profileId) => {
    if (!profileId || !hasApp('messages')) return;
    setDmFocusUserId(profileId);
    selectTab('messages');
  };

  const openTeamsFromProfile = (teamId) => {
    if (!hasApp('teams')) return;
    setTeamsFocusId(teamId || '');
    const teamsTool = TOOL_CARDS.find((tool) => tool.key === 'teams');
    setActiveTab('tools');
    setActiveTool(teamsTool || { key: 'teams', label: 'Teams' });
    setSettingsPanel(null);
    setToolsQuery('');
  };

  const openTool = (tool) => {
    if (!hasApp(tool?.key)) return;
    setActiveTool(tool);
    setSettingsPanel(null);
    setAnalyticsMini(null);
  };

  const openPinnedTool = (tool) => {
    if (!hasApp(tool?.key)) return;
    setActiveTab('tools');
    setActiveTool(tool);
    setSettingsPanel(null);
    setToolsQuery('');
  };

  const openEmailsFromBonuses = useCallback((focus) => {
    if (!hasApp('emails')) return;
    emailsFocusSeq.current += 1;
    setEmailsFocus({
      key: emailsFocusSeq.current,
      storeName: focus?.storeName || null,
      startDate: focus?.startDate,
      endDate: focus?.endDate,
    });
    const emailsTool = TOOL_CARDS.find((tool) => tool.key === 'emails');
    setActiveTab('tools');
    setActiveTool(emailsTool || { key: 'emails', label: 'Emails' });
    setSettingsPanel(null);
    setToolsQuery('');
  }, [hasApp]);

  const togglePin = (toolKey) => {
    setPinnedKeys((current) => {
      const next = current.includes(toolKey)
        ? current.filter((key) => key !== toolKey)
        : [...current, toolKey];
      if (session?.token) {
        persistPinnedTools(session, next, TOOL_KEYS).catch(() => {});
      }
      return next;
    });
  };

  const selectAppsView = (view) => {
    if (view === appsView) return;
    setAppsView(view);
    if (session?.token) {
      persistAppsView(session, view).catch(() => {});
      setSession((current) => {
        if (!current?.profile) return current;
        return { ...current, profile: { ...current.profile, appsView: view } };
      });
    }
  };

  const reorderPinned = useCallback((fromIndex, toIndex) => {
    setPinnedKeys((current) => {
      const next = moveArrayItem(current, fromIndex, toIndex);
      if (next === current) return current;
      if (session?.token) {
        persistPinnedTools(session, next, TOOL_KEYS).catch(() => {});
      }
      return next;
    });
  }, [session?.token]);

  useEffect(() => {
    if (activeTool && !hasApp(activeTool.key)) {
      setActiveTool(null);
      setSettingsPanel(null);
      setAnalyticsMini(null);
    }
  }, [activeTool, hasApp]);

  const handleLogin = async () => {
    if (!loginId.trim() || !password.trim() || submitting) return;

    setSubmitting(true);
    setLoginError('');

    try {
      const next = await loginRequest(loginId, password);
      const [pins, access, view, userAccess] = await Promise.all([
        loadPinnedTools(next, TOOL_KEYS),
        loadRoleAppAccess(ACCESS_CATALOG_KEYS),
        loadAppsView(next),
        loadOwnUserAppAccess(next.supabaseUserId || next.profile?.id, ACCESS_CATALOG_KEYS),
      ]);
      setSession(next);
      setPinnedKeys(pins);
      setAppsView(view);
      setAccessByRole(access.byRole);
      setOwnUserAccess(userAccess);
      prefetchInventoryMatrix(next);
      setPassword('');
      setActiveTab('home');
      setActiveTool(null);
      setSettingsPanel(null);
      setAnalyticsMini(null);
    } catch (error) {
      setLoginError(error?.message || 'Login failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleLogout = async () => {
    // Land the sign-out press (and anything else still queued) in the ledger
    // while this user's session can still vouch for it.
    await flushActionLog().catch(() => {});
    await logoutRequest().catch(() => {});
    resetToSignedOut();
  };

  const renderToolsHeader = () => {
    if (!activeTool) {
      return null;
    }
    if ((activeTool.key === 'messages' || activeTool.key === 'emails') && !isMobile) {
      return null;
    }

    const settingsSubPanels = {
      'ai-models': 'AI models',
      permissions: 'Permissions',
      database: 'Database',
      'store-settings': 'Store Settings',
      ringcentral: 'Phone',
    };
    const settingsSubPanelLabel =
      activeTool.key === 'settings' ? settingsSubPanels[settingsPanel] : null;
    const nestedLabel = settingsSubPanelLabel;

    if (isMobile) {
      return null;
    }

    return (
      <View style={styles.breadcrumb}>
        <View style={styles.breadcrumbTrail}>
          <Pressable
            onPress={() => {
              setActiveTool(null);
              setSettingsPanel(null);
              setAnalyticsMini(null);
            }}
            style={styles.breadcrumbLink}
          >
            <Text style={styles.breadcrumbLinkText}>Apps</Text>
          </Pressable>
          <Text style={styles.breadcrumbSep}>›</Text>
          {nestedLabel ? (
            <>
              <Pressable
                onPress={() => {
                  setSettingsPanel(null);
                  setAnalyticsMini(null);
                }}
                style={styles.breadcrumbLink}
              >
                <Text style={styles.breadcrumbLinkText}>{activeTool.label}</Text>
              </Pressable>
              <Text style={styles.breadcrumbSep}>›</Text>
              <Text style={styles.breadcrumbCurrent}>{nestedLabel}</Text>
            </>
          ) : (activeTool.key === 'triage' || activeTool.key === 'phone') && triageStoreBack && triageBatch ? (
            <>
              <Pressable
                onPress={triageStoreBack}
                style={styles.breadcrumbLink}
                accessibilityRole="button"
                accessibilityLabel={activeTool.key === 'phone' ? 'Back to stores' : 'Back to triage dashboard'}
              >
                <Text style={styles.breadcrumbLinkText}>
                  {activeTool.key === 'phone' ? 'Stores' : activeTool.label}
                </Text>
              </Pressable>
              <Text style={styles.breadcrumbSep}>›</Text>
              <View style={styles.breadcrumbBatch}>
                <Text style={styles.breadcrumbCurrent} numberOfLines={1}>
                  {activeTool.key === 'phone'
                    ? triageBatch.storeName || triageBatch.dateLabel
                    : triageBatch.dateLabel}
                </Text>
                {activeTool.key !== 'phone' && triageBatch.storeNames ? (
                  <Text style={styles.breadcrumbSub} numberOfLines={1}>
                    {triageBatch.storeNames}
                  </Text>
                ) : null}
              </View>
            </>
          ) : (
            <Text style={styles.breadcrumbCurrent}>{activeTool.label}</Text>
          )}
        </View>
        {(activeTool.key === 'triage' || activeTool.key === 'audit' || activeTool.key === 'transfer') && triageNav ? (
          <View style={styles.breadcrumbNav}>{triageNav}</View>
        ) : null}
      </View>
    );
  };

  const renderContent = () => {
    if (activeTab === 'profile') {
      return (
        <ProfileScreen
          session={session}
          person={viewedProfile}
          canMessage={hasApp('messages')}
          canPhone={hasApp('phone')}
          canTeams={hasApp('teams')}
          onMessage={messagePerson}
          onOpenTeams={openTeamsFromProfile}
          onBack={() => {
            const next = profileReturnTo;
            setViewedProfile(null);
            setProfileReturnTo(null);
            if (next && next !== 'profile') selectTab(next);
          }}
          onLogout={handleLogout}
          onProfileChange={(patch) => {
            setSession((current) => {
              if (!current?.profile) return current;
              return { ...current, profile: { ...current.profile, ...patch } };
            });
          }}
        />
      );
    }

    if (activeTab === 'tools') {
      if (activeTool) {
        return (
          <View style={styles.toolsScreen}>
            {renderToolsHeader()}
            {activeTool.key === 'transactions' ? (
              <TransactionsScreen
                session={session}
                onRequireLogin={() => selectTab('profile')}
                storeFilter={scopedStore || undefined}
              />
            ) : activeTool.key === 'inventory' ? (
              <InventoryScreen
                session={session}
                onRequireLogin={() => selectTab('profile')}
                storeFilter={scopedStore || undefined}
              />
            ) : activeTool.key === 'preorders' ? (
              <PreordersScreen />
            ) : activeTool.key === 'ai' ? (
              <AiScreen
                session={session}
                onRequireLogin={() => selectTab('profile')}
                storeFilter={scopedStore || undefined}
              />
            ) : activeTool.key === 'financials' ? (
              <FinancialsScreen
                session={session}
                onRequireLogin={() => selectTab('profile')}
                storeFilter={scopedStore || undefined}
              />
            ) : activeTool.key === 'debit' ? (
              <DebitScreen
                session={session}
                onRequireLogin={() => selectTab('profile')}
                storeFilter={scopedStore || undefined}
              />
            ) : activeTool.key === 'accounting' ? (
              <AccountingScreen />
            ) : activeTool.key === 'analytics' ? (
              <AnalyticsScreen
                session={session}
                storeFilter={scopedStore || undefined}
              />
            ) : activeTool.key === 'audit' ? (
              <AuditScreen
                session={session}
                onRequireLogin={() => selectTab('profile')}
                storeFilter={scopedStore || undefined}
                onNavTabs={setTriageNav}
              />
            ) : activeTool.key === 'emails' ? (
              <View style={styles.messagesHost}>
                <EmailsScreen
                  session={session}
                  onRequireLogin={() => selectTab('profile')}
                  onOpenProfile={openPersonProfile}
                  focus={emailsFocus}
                  onFocusConsumed={() => setEmailsFocus(null)}
                  capture={
                    <EmailCaptureScreen
                      session={session}
                      onRequireLogin={() => selectTab('profile')}
                      focus={emailsFocus}
                      onFocusConsumed={() => setEmailsFocus(null)}
                    />
                  }
                />
              </View>
            ) : activeTool.key === 'serphint' ? (
              <SerphintScreen />
            ) : activeTool.key === '100-ways' ? (
              <HundredWaysScreen
                session={session}
                onRequireLogin={() => selectTab('profile')}
              />
            ) : activeTool.key === 'settings' ? (
              <SettingsScreen
                panel={settingsPanel}
                onOpenPanel={setSettingsPanel}
                session={session}
                apps={PERMISSION_APPS}
                onAccessSaved={(next) => {
                  setAccessByRole(next);
                }}
                onStaffAccessSaved={(staff) => {
                  setSession((current) => {
                    if (!current?.profile || current.profile.id !== staff.id) return current;
                    return {
                      ...current,
                      profile: {
                        ...current.profile,
                        appRole: staff.appRole,
                        isSystemAdmin: staff.isSystemAdmin,
                        isActive: staff.isActive ?? current.profile.isActive,
                      },
                    };
                  });
                }}
                onUserAccessSaved={(userId, access) => {
                  if (userId !== (session?.supabaseUserId || session?.profile?.id)) return;
                  setOwnUserAccess(access);
                }}
              />
            ) : activeTool.key === 'transfer' ? (
              <TransferScreen
                session={session}
                onRequireLogin={() => selectTab('profile')}
                onNavTabs={setTriageNav}
                onLocationChanged={({ locationId, locationName }) => {
                  setSession((current) => {
                    if (!current?.profile) return current;
                    return {
                      ...current,
                      user: current.user
                        ? { ...current.user, location_id: locationId || current.user.location_id }
                        : current.user,
                      profile: {
                        ...current.profile,
                        locationId: locationId || current.profile.locationId,
                        locationName: locationName || current.profile.locationName,
                      },
                    };
                  });
                }}
              />
            ) : activeTool.key === 'fintrac' ? (
              <FintracScreen
                session={session}
                onRequireLogin={() => selectTab('profile')}
                storeFilter={scopedStore || undefined}
              />
            ) : activeTool.key === 'pricing' ? (
              <PricingScreen />
            ) : activeTool.key === 'bonuses' ? (
              <BonusesScreen
                session={session}
                onRequireLogin={() => selectTab('profile')}
                onOpenEmails={openEmailsFromBonuses}
                storeFilter={scopedStore || undefined}
              />
            ) : activeTool.key === 'phone' ? (
              <PhoneScreen
                session={session}
                onRequireLogin={() => selectTab('profile')}
                storeFilter={scopedStore || undefined}
                onStoreBackChange={(fn, context) => {
                  setTriageStoreBack(() => fn || null);
                  setTriageBatch(context || null);
                }}
              />
            ) : activeTool.key === 'employees' ? (
              <EmployeesScreen
                session={session}
                onProfileUpdated={(profile) => {
                  setSession((current) => {
                    if (!current?.profile || current.profile.id !== profile.id) return current;
                    if (
                      current.profile.appRole === (profile.appRole ?? current.profile.appRole) &&
                      current.profile.employeeType ===
                        (profile.employeeType ?? current.profile.employeeType) &&
                      current.profile.role === (profile.role ?? current.profile.role)
                    ) {
                      return current;
                    }
                    return {
                      ...current,
                      profile: {
                        ...current.profile,
                        role: profile.role ?? current.profile.role,
                        employeeType: profile.employeeType ?? current.profile.employeeType,
                        locationId: profile.locationId ?? current.profile.locationId,
                        locationName: profile.locationName ?? current.profile.locationName,
                        appRole: profile.appRole ?? current.profile.appRole,
                        isSystemAdmin: profile.isSystemAdmin ?? current.profile.isSystemAdmin,
                      },
                    };
                  });
                }}
              />
            ) : activeTool.key === 'teams' ? (
              <TeamsScreen focusTeamId={teamsFocusId} />
            ) : activeTool.key === 'marketing' ? (
              <MarketingScreen />
            ) : activeTool.key === 'shared-services' ? (
              <SharedServicesScreen />
            ) : activeTool.key === 'logs' ? (
              <LogsScreen session={session} />
            ) : activeTool.key === 'triage' ? (
              <TriageScreen
                session={session}
                onRequireLogin={() => selectTab('profile')}
                storeFilter={scopedStore || undefined}
                onStoreBackChange={(fn, context) => {
                  setTriageStoreBack(() => fn || null);
                  setTriageBatch(context || null);
                }}
                onNavTabs={setTriageNav}
              />
            ) : activeTool.key === 'messages' ? (
              <View style={styles.messagesHost}>
                <MessagesScreen
                  session={session}
                  onUnreadChange={refreshMessagesUnread}
                  openUserId={dmFocusUserId}
                  onOpenedUser={() => setDmFocusUserId('')}
                  onOpenProfile={openPersonProfile}
                />
              </View>
            ) : (
              <Text style={styles.toolPageBody}>{activeTool.label} page</Text>
            )}
          </View>
        );
      }

      const appsToolbar = (
        <View
          style={[
            styles.toolsToolbar,
            styles.toolsToolbarOverlay,
            !isMobile && styles.appsToolbarCompact,
            isMobile && styles.igAppsToolbar,
            appGrid.maxWidth ? { maxWidth: appGrid.maxWidth } : null,
          ]}
        >
          <View style={[styles.toolsSearch, isMobile && styles.igSearchField, !isMobile && styles.homeSearch]}>
            <Ionicons
              name="search"
              size={isMobile ? 16 : 14}
              color="#8e8e93"
              style={isMobile ? styles.toolsSearchIcon : styles.homeSearchIcon}
            />
            <TextInput
              style={[styles.toolsSearchInput, !isMobile && styles.homeSearchInput]}
              value={toolsQuery}
              onChangeText={setToolsQuery}
              placeholder="Search"
              placeholderTextColor="#8e8e93"
              autoCapitalize="none"
              autoCorrect={false}
              clearButtonMode="while-editing"
            />
            {toolsQuery ? (
              <Pressable onPress={() => setToolsQuery('')} hitSlop={8}>
                <Ionicons name="close-circle" size={isMobile ? 18 : 16} color="#c7c7cc" />
              </Pressable>
            ) : null}
          </View>
          <View
            style={[styles.appsViewToggle, !isMobile && styles.appsViewToggleCompact]}
            accessibilityRole="tablist"
          >
            <Pressable
              style={[
                styles.appsViewToggleButton,
                !isMobile && styles.appsViewToggleButtonCompact,
                appsView === 'grid' && styles.appsViewToggleButtonActive,
              ]}
              onPress={() => selectAppsView('grid')}
              accessibilityRole="tab"
              accessibilityState={{ selected: appsView === 'grid' }}
              accessibilityLabel="Grid view"
            >
              <Ionicons
                name={appsView === 'grid' ? 'grid' : 'grid-outline'}
                size={isMobile ? 16 : 14}
                color={appsView === 'grid' ? '#1d1d1f' : '#8e8e93'}
              />
            </Pressable>
            <Pressable
              style={[
                styles.appsViewToggleButton,
                !isMobile && styles.appsViewToggleButtonCompact,
                appsView === 'list' && styles.appsViewToggleButtonActive,
              ]}
              onPress={() => selectAppsView('list')}
              accessibilityRole="tab"
              accessibilityState={{ selected: appsView === 'list' }}
              accessibilityLabel="List view"
            >
              <Ionicons
                name={appsView === 'list' ? 'list' : 'list-outline'}
                size={isMobile ? 18 : 15}
                color={appsView === 'list' ? '#1d1d1f' : '#8e8e93'}
              />
            </Pressable>
          </View>
        </View>
      );

      const appsBody = !hasSearchResults ? (
        <Text
          style={[
            styles.toolsEmpty,
            appGrid.maxWidth ? { maxWidth: appGrid.maxWidth } : null,
          ]}
        >
          No apps match “{toolsQuery.trim()}”.
        </Text>
      ) : (
        <View
          style={[
            styles.toolsSection,
            isMobile && styles.toolsSectionMobile,
            isMobile && styles.igAppsSection,
            appGrid.maxWidth ? { maxWidth: appGrid.maxWidth } : null,
          ]}
        >
          {appsView === 'list' ? (
            <ToolsList
              tools={filteredTools}
              pinnedKeys={pinnedKeys}
              onOpen={openTool}
              onTogglePin={togglePin}
            />
          ) : (
            <ToolsGrid
              tools={filteredTools}
              pinnedKeys={pinnedKeys}
              onOpen={openTool}
              onTogglePin={togglePin}
              columns={appGrid.columns}
              iconSize={appGrid.iconSize}
              gap={appGrid.gap}
              rowGap={appGrid.rowGap}
            />
          )}
        </View>
      );

      if (isMobile) {
        return (
          <View style={[styles.toolsScreen, styles.igGroupedScreen]}>
            <ScrollView
              style={styles.toolsScroll}
              contentContainerStyle={styles.igAppsScroll}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              <Text style={styles.igLargeTitle}>Apps</Text>
              {appsToolbar}
              {appsBody}
            </ScrollView>
          </View>
        );
      }

      return (
        <View style={styles.toolsScreen}>
          <ScrollView
            style={styles.toolsScroll}
            contentContainerStyle={[
              styles.toolsScrollContent,
              styles.appsLibraryScrollContent,
              { paddingTop: appsToolbarHeight || 90 },
            ]}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {appsBody}
          </ScrollView>

          <BlurView
            intensity={58}
            tint="light"
            style={styles.toolsToolbarBlur}
            onLayout={(event) => {
              const next = Math.ceil(event.nativeEvent.layout.height);
              if (next > 0 && next !== appsToolbarHeight) setAppsToolbarHeight(next);
            }}
            {...(Platform.OS === 'web' ? { className: 'cgold-apps-toolbar-blur' } : null)}
          >
            {appsToolbar}
          </BlurView>
        </View>
      );
    }

    if (activeTab === 'messages') {
      if (!hasApp('messages')) {
        return (
          <View style={styles.centered}>
            <Text style={styles.toolsEmpty}>You don’t have access to Direct Messages.</Text>
          </View>
        );
      }
      return (
        <View style={styles.messagesHost}>
          <MessagesScreen
            session={session}
            onUnreadChange={refreshMessagesUnread}
            openUserId={dmFocusUserId}
            onOpenedUser={() => setDmFocusUserId('')}
            onOpenProfile={openPersonProfile}
          />
        </View>
      );
    }

    if (activeTab === 'buy' || activeTab === 'sell') {
      return <TradeScreen mode={activeTab} hideHeader={isMobile} session={session} />;
    }

    if (activeTab === 'home') {
      return (
        <HomeScreen
          session={session}
          onRequireLogin={() => selectTab('profile')}
          onOpenPerson={openPersonProfile}
        />
      );
    }

    return <Text style={styles.contentTitle}>{activeLabel}</Text>;
  };

  const showingMessages =
    activeTab === 'messages' || (activeTab === 'tools' && activeTool?.key === 'messages');
  const showingMail = activeTab === 'tools' && activeTool?.key === 'emails';
  const isFullBleedTool =
    showingMessages ||
    showingMail ||
    (activeTab === 'tools' &&
    (activeTool?.key === 'transactions' ||
      activeTool?.key === 'inventory' ||
      activeTool?.key === 'audit' ||
      activeTool?.key === 'serphint' ||
      activeTool?.key === 'financials' ||
      activeTool?.key === 'debit' ||
      activeTool?.key === 'transfer' ||
      activeTool?.key === 'fintrac' ||
      activeTool?.key === 'pricing' ||
      activeTool?.key === 'bonuses' ||
      activeTool?.key === 'employees' ||
      activeTool?.key === 'analytics' ||
      activeTool?.key === 'triage'));

  const isAppsLibrary = activeTab === 'tools' && !activeTool;
  const settingsSubPanels = {
    'ai-models': 'AI Models',
    permissions: 'Permissions',
    database: 'Database',
    'store-settings': 'Store Settings',
    ringcentral: 'Phone',
  };
  const mobileToolTitle =
    activeTool?.key === 'settings'
      ? settingsSubPanels[settingsPanel] || activeTool?.label
      : activeTool?.label;
  const groupedMobileTab =
    isMobile && ((activeTab === 'tools' && !activeTool) || activeTab === 'home' || activeTab === 'profile');
  const showingSettings = isMobile && activeTab === 'tools' && activeTool?.key === 'settings';
  const contentStyle = [
    styles.content,
    isMobile && styles.contentMobile,
    isFullBleedTool && styles.contentTransactions,
    (showingMessages || showingMail) && styles.contentMessages,
    isMobile && ((activeTab === 'tools' && activeTool) || showingMessages || showingMail) && styles.contentMobileApp,
    styles.contentScrollFix,
    isAppsLibrary && styles.contentAppsLibrary,
    !isMobile && activeTab === 'home' && styles.contentAppsLibrary,
    (groupedMobileTab || showingSettings) && styles.contentMobileGrouped,
    isMobile &&
      !isFullBleedTool &&
      !showingMessages &&
      !isAppsLibrary &&
      activeTab !== 'home' &&
      activeTab !== 'profile' &&
      !showingSettings &&
      styles.contentMobilePadded,
  ];

  if (bootstrapping || (!fontsLoaded && !fontsError)) {
    return (
      <View style={styles.loginShell}>
        <StatusBar style="auto" />
        <View style={styles.centered}>
          <ActivityIndicator color="#1a1a1a" />
        </View>
      </View>
    );
  }

  const captureToken = captureTokenFromLocation();
  if (captureToken) {
    return <LinePhotoCapturePage token={captureToken} />;
  }

  if (!isLoggedIn) {
    return (
      <View style={styles.loginShell}>
        <StatusBar style="auto" />
        <LoginScreen
          loginId={loginId}
          password={password}
          error={loginError}
          submitting={submitting}
          onChangeLoginId={setLoginId}
          onChangePassword={setPassword}
          onSubmit={handleLogin}
        />
      </View>
    );
  }

  if (isMobile) {
    const mobileTabs = MOBILE_TABS.filter((tab) => tab.key !== 'messages' || hasApp('messages'));
    const groupedShell = groupedMobileTab || showingSettings;
    return (
      <AppAccessContext.Provider value={appAccessValue}>
      <PhoneCallProvider session={session} storeFilter={scopedStore || undefined} enabled={hasApp('phone')}>
        <View
          style={[
            styles.containerMobile,
            groupedShell ? styles.containerMobileGrouped : styles.containerMobileFeed,
          ]}
        >
          <StatusBar style="dark" />
          <MobileSafeTop />
          {activeTab === 'home' ? (
            <MobileHomeHeader
              onBuy={() => selectTab('buy')}
              onSell={() => selectTab('sell')}
            />
          ) : null}
          {activeTab === 'buy' || activeTab === 'sell' ? (
            <MobileNavHeader
              title={activeTab === 'buy' ? 'Buy' : 'Sell'}
              onBack={() => selectTab('home')}
            />
          ) : null}
          {activeTab === 'tools' && activeTool ? (
            <MobileNavHeader
              title={
                activeTool.key === 'triage' && triageBatch?.dateLabel
                  ? triageBatch.dateLabel
                  : activeTool.key === 'phone' && triageBatch?.storeName
                    ? triageBatch.storeName
                    : mobileToolTitle
              }
              subtitle={
                activeTool.key === 'triage' && triageBatch?.storeNames
                  ? triageBatch.storeNames
                  : undefined
              }
              onBack={() => {
                if (activeTool.key === 'settings' && settingsPanel) {
                  setSettingsPanel(null);
                  return;
                }
                if ((activeTool.key === 'triage' || activeTool.key === 'phone') && triageStoreBack) {
                  triageStoreBack();
                  return;
                }
                setActiveTool(null);
                setSettingsPanel(null);
                setAnalyticsMini(null);
              }}
            />
          ) : null}
          <View style={contentStyle}>{renderContent()}</View>
          <MobilePhoneDock />
          <MobileTabBar
            tabs={mobileTabs}
            activeKey={activeTab}
            onSelect={selectTab}
            messagesUnread={messagesUnread}
            profileAvatarUrl={session?.profile?.avatarUrl || ''}
            profileName={userLabel}
          />
        </View>
      </PhoneCallProvider>
      </AppAccessContext.Provider>
    );
  }

  return (
    <AppAccessContext.Provider value={appAccessValue}>
    <PhoneCallProvider session={session} storeFilter={scopedStore || undefined} enabled={hasApp('phone')}>
    <View style={styles.container}>
      <StatusBar style="auto" />

      <View
        nativeID="cgold-sidebar"
        testID="cgold-sidebar"
        style={[styles.sidebar, sidebarCollapsed && styles.sidebarCollapsed]}
      >
        <View style={[styles.sidebarHeader, sidebarCollapsed && styles.sidebarHeaderCollapsed]}>
          <Pressable
            onPress={() => selectTab('home')}
            style={({ pressed, hovered }) => [
              styles.sidebarBrand,
              sidebarCollapsed && styles.sidebarBrandCollapsed,
              (hovered || pressed) && styles.tabHover,
            ]}
            accessibilityLabel="MyCanadaGold"
          >
            <View style={styles.sidebarBrandIcon}>
              <Image
                source={require('./assets/small_logo.png')}
                style={styles.sidebarBrandLogo}
                resizeMode="cover"
              />
            </View>
          </Pressable>
          <Pressable
            onPress={() => setSidebarCollapsed((current) => !current)}
            style={[styles.sidebarToggle, sidebarCollapsed && styles.sidebarToggleCollapsed]}
            accessibilityLabel={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <Feather name="sidebar" size={16} color="#8e8e93" />
          </Pressable>
        </View>

        <View style={styles.tabList}>
          <SidebarNavGroup
            collapsed={sidebarCollapsed}
            homeActive={activeTab === 'home'}
            appsActive={
              activeTab === 'tools' &&
              activeTool?.key !== 'messages' &&
              activeTool?.key !== 'notifications' &&
              activeTool?.key !== 'settings' &&
              !pinnedTools.some((tool) => tool.key === activeTool?.key)
            }
            messagesActive={
              activeTab === 'messages' ||
              (activeTab === 'tools' && activeTool?.key === 'messages')
            }
            profileActive={activeTab === PROFILE_TAB.key}
            notificationsActive={activeTab === 'tools' && activeTool?.key === 'notifications'}
            settingsActive={activeTab === 'tools' && activeTool?.key === 'settings'}
            onSelectHome={() => selectTab('home')}
            onSelectApps={() => selectTab('tools')}
            onSelectMessages={() => selectTab('messages')}
            onSelectProfile={() => selectTab(PROFILE_TAB.key)}
            onOpenNotifications={openNotificationsApp}
            onOpenLocation={() => setLocationPickerOpen(true)}
            onOpenSettings={openSettingsApp}
            profileLabel={userLabel}
            profileLocation={storeLocationFromSession(session)}
            profileAvatarUrl={session?.profile?.avatarUrl || ''}
            showMessages={hasApp('messages')}
            messagesUnread={messagesUnread}
          />

          <PinnedToolsList
            tools={pinnedTools}
            activeToolKey={activeTab === 'tools' ? activeTool?.key : null}
            sidebarCollapsed={sidebarCollapsed}
            onOpen={openPinnedTool}
            onUnpin={togglePin}
            onReorder={reorderPinned}
          />
        </View>

        <View style={[styles.sidebarFooter, sidebarCollapsed && styles.sidebarFooterCollapsed]}>
          <PhoneIncomingDock collapsed={sidebarCollapsed} />
          <SidebarTradeActions
            collapsed={sidebarCollapsed}
            buyActive={activeTab === 'buy'}
            sellActive={activeTab === 'sell'}
            onSelectBuy={() => selectTab('buy')}
            onSelectSell={() => selectTab('sell')}
          />
        </View>
      </View>

      <View style={contentStyle}>{renderContent()}</View>
      <ProfileLocationPicker
        visible={locationPickerOpen}
        session={session}
        selectedId={session?.profile?.locationId}
        selectedName={storeLocationFromSession(session)}
        onClose={() => setLocationPickerOpen(false)}
        onChanged={applyOwnLocation}
      />
    </View>
    </PhoneCallProvider>
    </AppAccessContext.Provider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: '#fff',
    ...Platform.select({
      web: { height: '100%', maxHeight: '100dvh', overflow: 'hidden' },
      default: {},
    }),
  },
  loginShell: {
    flex: 1,
    backgroundColor: '#fff',
  },
  containerMobile: {
    flex: 1,
    flexDirection: 'column',
    backgroundColor: '#fff',
    ...Platform.select({
      web: { height: '100%', maxHeight: '100dvh', overflow: 'hidden' },
      default: {},
    }),
  },
  containerMobileFeed: {
    backgroundColor: '#fff',
  },
  containerMobileGrouped: {
    backgroundColor: '#f2f2f7',
  },
  mobileTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 54 : 14,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e5e5',
    backgroundColor: '#fafafa',
    gap: 10,
  },
  mobileTopTitle: {
    fontFamily: titleFontFamily,
    flex: 1,
    fontSize: 16,
    fontWeight: '400',
    color: '#1a1a1a',
  },
  mobileProfileButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f0f0f0',
  },
  mobileProfileButtonActive: {
    backgroundColor: '#e4e4e4',
  },
  bottomTabBar: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e5e5e5',
    backgroundColor: '#fafafa',
    paddingBottom: Platform.OS === 'ios' ? 20 : 8,
    paddingTop: 8,
    overflow: 'visible',
  },
  bottomTab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    minHeight: 44,
    overflow: 'visible',
    ...Platform.select({
      web: {
        cursor: 'pointer',
      },
      default: {},
    }),
  },
  bottomTabLabel: {
    fontFamily,
    fontSize: 11,
    fontWeight: '500',
    color: '#8a8a8a',
  },
  bottomTabLabelActive: {
    color: '#1a1a1a',
    fontWeight: '600',
  },
  bottomTabIconWrap: {
    position: 'relative',
    overflow: 'visible',
  },
  mobileAppHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    minHeight: 36,
  },
  mobileBackButton: {
    width: 36,
    height: 36,
    marginLeft: -8,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      web: {
        cursor: 'pointer',
      },
      default: {},
    }),
  },
  mobileBackButtonSpacer: {
    width: 36,
  },
  mobileAppTitle: {
    fontFamily,
    flex: 1,
    fontSize: 18,
    fontWeight: '600',
    color: '#1a1a1a',
    textAlign: 'center',
  },
  sidebar: {
    width: 252,
    paddingTop: 16,
    paddingBottom: 14,
    paddingHorizontal: 12,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: '#e5e5ea',
    backgroundColor: '#fff',
  },
  sidebarCollapsed: {
    width: 72,
    paddingHorizontal: 10,
  },
  sidebarHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
    marginBottom: 32,
  },
  sidebarHeaderCollapsed: {
    flexDirection: 'column',
    alignItems: 'stretch',
    marginBottom: 28,
  },
  sidebarBrand: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingLeft: 8,
    paddingRight: 4,
    borderRadius: 10,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  sidebarBrandCollapsed: {
    flex: 0,
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  sidebarToggle: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginLeft: 'auto',
    backgroundColor: 'transparent',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  sidebarToggleCollapsed: {
    alignSelf: 'flex-end',
    marginLeft: 0,
  },
  sidebarNavStack: {
    gap: 8,
  },
  sidebarNavGroup: {
    position: 'relative',
    backgroundColor: '#f2f2f7',
    borderRadius: 14,
    padding: 6,
    gap: 2,
    overflow: 'hidden',
    ...Platform.select({
      web: {
        boxShadow:
          'inset 0 1px 1px rgba(255,255,255,0.9), 0 1px 2px rgba(0,0,0,0.05), 0 4px 10px rgba(0,0,0,0.05)',
      },
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.08,
        shadowRadius: 6,
        elevation: 2,
      },
    }),
  },
  sidebarNavGroupCollapsed: {
    alignItems: 'stretch',
  },
  sidebarNavItem: {
    backgroundColor: 'transparent',
    zIndex: 1,
  },
  tabIndicator: {
    position: 'absolute',
    left: 6,
    right: 6,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.88)',
    zIndex: 0,
    ...Platform.select({
      web: {
        backdropFilter: 'saturate(180%) blur(22px)',
        WebkitBackdropFilter: 'saturate(180%) blur(22px)',
        boxShadow:
          'inset 0 0.5px 0 rgba(255,255,255,0.95), 0 0 0 0.5px rgba(0,0,0,0.04), 0 1px 3px rgba(0,0,0,0.06)',
        willChange: 'top, height, opacity',
      },
      default: {
        backgroundColor: '#fff',
      },
    }),
  },
  sidebarMessagesIcon: {
    position: 'relative',
    overflow: 'visible',
  },
  messagesUnreadBadge: {
    position: 'absolute',
    right: -7,
    bottom: -5,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 4,
    borderRadius: 8,
    backgroundColor: '#FF3B30',
    borderWidth: 1.5,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  messagesUnreadBadgeText: {
    fontFamily,
    fontSize: 9,
    fontWeight: '700',
    color: '#fff',
    lineHeight: 11,
    ...Platform.select({
      android: { includeFontPadding: false },
      default: {},
    }),
  },
  sidebarFooter: {
    flexDirection: 'column',
    alignItems: 'stretch',
    justifyContent: 'flex-end',
    marginTop: 'auto',
    paddingTop: 10,
    gap: 10,
    width: '100%',
  },
  sidebarFooterCollapsed: {
    flexDirection: 'column',
    alignItems: 'stretch',
  },
  sidebarBrandIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sidebarBrandLogo: {
    width: 28,
    height: 28,
  },
  brandIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFF8E8',
    ...Platform.select({
      web: {
        cursor: 'pointer',
      },
      default: {},
    }),
  },
  tabList: {
    flex: 1,
    gap: 0,
    overflow: 'visible',
  },
  tradePair: {
    borderRadius: 14,
    overflow: 'hidden',
  },
  tradeSegment: {
    borderRadius: 0,
    zIndex: 1,
  },
  tradeSegmentTop: {
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
  },
  tradeSegmentBottom: {
    borderBottomLeftRadius: 14,
    borderBottomRightRadius: 14,
  },
  pinnedSection: {
    marginTop: 0,
  },
  pinnedSeparator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#e5e5ea',
    marginTop: 22,
    marginBottom: 22,
    marginHorizontal: 10,
  },
  pinnedList: {
    gap: 2,
  },
  pinnedAppIcon: {
    width: 28,
    height: 28,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  pinnedAppIconCollapsed: {
    marginRight: 0,
  },
  pinnedTab: {
    paddingRight: 6,
    ...Platform.select({
      web: {
        cursor: 'grab',
        userSelect: 'none',
      },
      default: {},
    }),
  },
  pinnedTabDragging: {
    opacity: 0.55,
    backgroundColor: '#fff',
    ...Platform.select({
      web: {
        cursor: 'grabbing',
      },
      default: {},
    }),
  },
  pinnedRemoveButton: {
    marginLeft: 'auto',
    padding: 2,
    ...Platform.select({
      web: {
        cursor: 'pointer',
      },
      default: {},
    }),
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 42,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 10,
    overflow: 'visible',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  tabCollapsed: {
    justifyContent: 'center',
    paddingHorizontal: 6,
    paddingRight: 6,
  },
  tabHover: {
    backgroundColor: '#f2f2f7',
  },
  tabActive: {
    backgroundColor: 'rgba(255, 255, 255, 0.88)',
    ...Platform.select({
      web: {
        backdropFilter: 'saturate(180%) blur(22px)',
        WebkitBackdropFilter: 'saturate(180%) blur(22px)',
        boxShadow:
          'inset 0 0.5px 0 rgba(255,255,255,0.95), 0 0 0 0.5px rgba(0,0,0,0.04), 0 1px 3px rgba(0,0,0,0.06)',
      },
      default: {
        backgroundColor: '#fff',
      },
    }),
  },
  tabIcon: {
    marginRight: 10,
  },
  tabWithSubtitle: {
    minHeight: 52,
    alignItems: 'center',
  },
  tabLabelColumn: {
    flex: 1,
    minWidth: 0,
  },
  tabLabel: {
    fontFamily,
    fontSize: 15,
    fontWeight: '500',
    color: '#6e6e73',
    letterSpacing: -0.2,
    flexShrink: 1,
  },
  tabSubtitle: {
    fontFamily,
    fontSize: 12,
    fontWeight: '400',
    color: '#8e8e93',
    letterSpacing: -0.08,
    marginTop: 1,
  },
  tabSubtitleActive: {
    color: '#6e6e73',
  },
  tabLabelHover: {
    color: '#1d1d1f',
  },
  tabLabelActive: {
    color: '#1d1d1f',
    fontWeight: '600',
  },
  profileQuickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  profileQuickRowCollapsed: {
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 4,
    paddingHorizontal: 0,
  },
  profileQuickIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  profileQuickIconPressed: {
    opacity: 0.55,
  },
  profileQuickIconDisabled: {
    opacity: 0.4,
  },
  profileStoreMark: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileStoreMarkText: {
    fontFamily,
    fontSize: 9,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: 0.3,
  },
  content: {
    flex: 1,
    minHeight: 0,
    padding: 32,
  },
  contentMobile: {
    paddingHorizontal: 0,
    paddingTop: 0,
    paddingBottom: 0,
  },
  contentMobileApp: {
    paddingTop: 0,
  },
  contentMobileGrouped: {
    backgroundColor: '#f2f2f7',
  },
  contentMobilePadded: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
  },
  contentScrollFix: {
    ...Platform.select({
      web: { overflow: 'hidden', display: 'flex', flexDirection: 'column' },
      default: {},
    }),
  },
  contentAppsLibrary: {
    paddingTop: 0,
    paddingBottom: 0,
    paddingHorizontal: 0,
  },
  contentMessages: {
    padding: 0,
    paddingTop: 0,
    paddingBottom: 0,
    paddingHorizontal: 0,
  },
  messagesHost: {
    flex: 1,
    minHeight: 0,
    width: '100%',
  },
  contentTransactions: {
    paddingBottom: 0,
    paddingTop: 24,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  contentTitle: {
    fontFamily,
    fontSize: 20,
    fontWeight: '600',
    color: '#1a1a1a',
    alignSelf: 'stretch',
  },
  homeInnerCentered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  homeLoginButton: {
    alignSelf: 'center',
    minWidth: 160,
    paddingHorizontal: 24,
    marginTop: 16,
  },
  homeTitle: {
    textAlign: 'center',
  },
  homeSubtitle: {
    fontFamily,
    fontSize: 15,
    color: '#8e8e93',
    marginTop: 6,
    textAlign: 'center',
  },
  homeError: {
    textAlign: 'center',
    marginBottom: 8,
    width: '100%',
    alignSelf: 'center',
  },
  homeToolbarBlur: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 3,
    overflow: 'hidden',
    paddingTop: 20,
    paddingHorizontal: 32,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(0,0,0,0.06)',
  },
  homeToolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    width: '100%',
    alignSelf: 'center',
  },
  homeToolbarFilters: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
    gap: 8,
  },
  homeSearch: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 140,
    borderRadius: 8,
    paddingHorizontal: 10,
    backgroundColor: '#e8e8ed',
    minHeight: 32,
  },
  homeSearchIcon: {
    marginRight: 6,
  },
  homeSearchInput: {
    fontSize: 14,
    paddingVertical: 4,
  },
  homeScrollContent: {
    paddingHorizontal: 32,
    paddingBottom: 32,
  },
  homeTableSection: {
    marginTop: 0,
  },
  homeSegmentCompact: {
    borderRadius: 8,
    padding: 1,
  },
  homeSegmentButtonCompact: {
    paddingHorizontal: 10,
    height: 28,
    borderRadius: 6,
  },
  homeSegmentTextCompact: {
    fontSize: 13,
    letterSpacing: -0.08,
  },
  homeDateFieldCompact: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#e8e8ed',
    borderRadius: 8,
    paddingHorizontal: 8,
    minHeight: 32,
    justifyContent: 'center',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  homeDateFieldValueCompact: {
    fontSize: 13,
    color: '#1d1d1f',
    letterSpacing: -0.08,
  },
  homeDateSepCompact: {
    fontSize: 13,
  },
  homeControls: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 10,
    marginTop: 10,
    marginBottom: 4,
    width: '100%',
    maxWidth: APP_GRID_MAX_WIDTH,
    alignSelf: 'center',
  },
  homeControlsMobile: {
    maxWidth: '100%',
  },
  homeSegment: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
    backgroundColor: '#e8e8ed',
    borderRadius: 10,
    padding: 2,
  },
  homeSegmentButton: {
    paddingHorizontal: 14,
    height: 38,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  homeSegmentButtonActive: {
    backgroundColor: '#fff',
    ...Platform.select({
      web: {
        boxShadow: '0 1px 2px rgba(0,0,0,0.12)',
      },
      default: {
        elevation: 1,
      },
    }),
  },
  homeSegmentText: {
    fontFamily,
    fontSize: 15,
    fontWeight: '500',
    color: '#8e8e93',
    letterSpacing: -0.2,
  },
  homeSegmentTextActive: {
    color: '#1d1d1f',
    fontWeight: '600',
  },
  homeDateField: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#e8e8ed',
    borderRadius: 12,
    paddingHorizontal: 12,
    minHeight: 42,
    justifyContent: 'center',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  homeDateFieldValue: {
    fontSize: 16,
    color: '#1d1d1f',
    letterSpacing: -0.2,
  },
  homeDateSep: {
    fontFamily,
    fontSize: 16,
    color: '#c7c7cc',
  },
  homeListMeta: {
    fontFamily,
    fontSize: 15,
    color: '#8e8e93',
    fontVariant: ['tabular-nums'],
    marginRight: 10,
    flexShrink: 0,
  },
  homeListAmount: {
    fontFamily,
    fontSize: 17,
    fontWeight: '400',
    color: '#1d1d1f',
    letterSpacing: -0.2,
    fontVariant: ['tabular-nums'],
    marginRight: 4,
    flexShrink: 0,
  },
  homeStoreTableCard: {
    backgroundColor: '#fff',
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e5ea',
    overflow: 'hidden',
    width: '100%',
  },
  homeStoreTableScroll: {
    width: '100%',
  },
  homeStoreTableScrollContent: {
    flexGrow: 1,
  },
  homeStoreTable: {
    flexGrow: 1,
    minWidth: 728,
  },
  homeStoreTableNoAmounts: {
    minWidth: 600,
  },
  homeStoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 52,
    paddingLeft: 12,
    overflow: 'visible',
    ...Platform.select({
      web: {
        cursor: 'pointer',
        transitionProperty: 'background-color',
        transitionDuration: '160ms',
        transitionTimingFunction: 'ease',
      },
      default: {},
    }),
  },
  homeStoreRowHovered: {
    backgroundColor: '#e8e8ed',
  },
  homeStoreRowStatic: {
    ...Platform.select({
      web: { cursor: 'default' },
      default: {},
    }),
  },
  homeStoreRowSelected: {
    backgroundColor: '#e8e8ed',
  },
  homeStoreRowBody: {
    flex: 1,
    minWidth: 0,
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginLeft: 12,
    paddingRight: 16,
  },
  homeStoreRowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e5ea',
  },
  homeStoreHeaderRow: {
    backgroundColor: '#fff',
    minHeight: 34,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e5ea',
    ...Platform.select({
      web: {
        cursor: 'default',
        position: 'sticky',
        top: 0,
        zIndex: 3,
      },
      default: {},
    }),
  },
  homeStoreTotalRow: {
    minHeight: 52,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#d1d1d6',
    ...Platform.select({
      web: { cursor: 'default' },
      default: {},
    }),
  },
  homeStoreIconWrap: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    overflow: 'visible',
  },
  homeStoreRadianceLayer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  homeStoreRadianceBlob: {
    position: 'absolute',
  },
  homeStoreIconForeground: {
    zIndex: 1,
    position: 'relative',
  },
  homeStoreIconTile: {
    width: 28,
    height: 28,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  homeStoreIconSpacer: {
    width: 48,
    height: 48,
    flexShrink: 0,
  },
  homeStoreHeader: {
    fontFamily,
    fontSize: 13,
    fontWeight: '500',
    color: '#8e8e93',
    letterSpacing: -0.04,
  },
  homeStoreName: {
    fontFamily,
    fontSize: 16,
    fontWeight: '600',
    color: '#1d1d1f',
    letterSpacing: -0.16,
    flexShrink: 1,
    minWidth: 0,
  },
  homeStoreMeta: {
    fontFamily,
    fontSize: 14,
    color: '#8e8e93',
    letterSpacing: -0.04,
    fontVariant: ['tabular-nums'],
    flexShrink: 0,
  },
  homeStoreMoney: {
    fontFamily,
    fontSize: 16,
    fontWeight: '400',
    color: '#1d1d1f',
    letterSpacing: -0.16,
    fontVariant: ['tabular-nums'],
  },
  homeStoreMoneyStrong: {
    fontWeight: '600',
  },
  homeStoreMoneyEmpty: {
    color: '#c7c7cc',
  },
  homeStoreTotalLabel: {
    fontFamily,
    fontSize: 16,
    fontWeight: '600',
    color: '#1d1d1f',
    letterSpacing: -0.16,
    flexShrink: 1,
    minWidth: 0,
  },
  homeStoreColStore: {
    flex: 1,
    minWidth: 200,
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
    ...Platform.select({
      web: { whiteSpace: 'nowrap' },
      default: {},
    }),
  },
  homeStoreColMoney: {
    width: 128,
    flexShrink: 0,
    alignItems: 'flex-end',
    justifyContent: 'center',
    textAlign: 'right',
    ...Platform.select({
      web: { whiteSpace: 'nowrap' },
      default: {},
    }),
  },
  homeStoreColPeople: {
    width: 192,
    flexShrink: 0,
    paddingLeft: 20,
  },
  homeStoreColPeopleTrailing: {
    marginLeft: 'auto',
    paddingLeft: 0,
    textAlign: 'right',
  },
  homeStoreColEmail: {
    width: 72,
    flexShrink: 0,
    paddingRight: 8,
    alignItems: 'flex-end',
    justifyContent: 'center',
    textAlign: 'right',
    ...Platform.select({
      web: { whiteSpace: 'nowrap' },
      default: {},
    }),
  },
  homeStoreColPhone: {
    width: 72,
    flexShrink: 0,
    paddingRight: 12,
    marginRight: 8,
    alignItems: 'flex-end',
    justifyContent: 'center',
    textAlign: 'right',
    ...Platform.select({
      web: { whiteSpace: 'nowrap' },
      default: {},
    }),
  },
  homeStorePhone: {
    fontFamily,
    fontSize: 16,
    fontWeight: '600',
    color: '#1d1d1f',
    letterSpacing: -0.16,
    fontVariant: ['tabular-nums'],
  },
  homeStorePhoneLow: {
    color: '#B91C1C',
  },
  homeStorePhoneHigh: {
    color: '#15803D',
  },
  igStorePhoneWrap: {
    flexShrink: 0,
    minWidth: 40,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  igStorePhone: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: '#1d1d1f',
    letterSpacing: -0.08,
    fontVariant: ['tabular-nums'],
  },
  homePeopleStack: {
    width: 192,
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    height: HOME_PEOPLE_SIZE,
    paddingLeft: 20,
    overflow: 'visible',
    ...Platform.select({
      web: { isolation: 'isolate' },
      default: {},
    }),
  },
  homePeopleStackTrailing: {
    marginLeft: 'auto',
    paddingLeft: 0,
    justifyContent: 'flex-end',
  },
  homePeopleStackCompact: {
    width: 'auto',
    maxWidth: 140,
    height: 22,
    marginTop: 2,
    paddingLeft: 0,
  },
  homePeopleAvatarWrap: {
    position: 'relative',
    borderRadius: HOME_PEOPLE_SIZE / 2,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  homePeopleAvatarRing: {
    borderWidth: 2,
    borderColor: '#fff',
    backgroundColor: '#e8e8ed',
  },
  homePeopleMore: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#e8e8ed',
    borderWidth: 2,
    borderColor: '#fff',
    overflow: 'hidden',
  },
  homePeopleMoreText: {
    fontFamily,
    fontSize: 10,
    fontWeight: '600',
    color: '#6e6e73',
    letterSpacing: -0.2,
  },
  homeStoreAmountHover: {
    ...Platform.select({
      web: { cursor: 'default' },
      default: {},
    }),
  },
  igStoreAmountWrap: {
    flexShrink: 0,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  homeStoreChevron: {
    width: 18,
    alignItems: 'center',
    flexShrink: 0,
  },
  homeMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
    marginBottom: 2,
    minHeight: 18,
    width: '100%',
    maxWidth: APP_GRID_MAX_WIDTH,
    alignSelf: 'center',
  },
  homeMeta: {
    fontFamily,
    flex: 1,
    fontSize: 13,
    color: '#8e8e93',
    letterSpacing: -0.08,
  },
  homeTableWrap: {
    backgroundColor: 'transparent',
    overflow: 'hidden',
    alignSelf: 'stretch',
    flex: 1,
    minHeight: 0,
  },
  homeTableScroll: {
    flex: 1,
    minHeight: 0,
  },
  homeTableListContent: {
    paddingBottom: 8,
  },
  emailScopedContent: {
    paddingTop: 4,
    paddingBottom: 32,
  },
  homeTableHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e8e8e8',
    backgroundColor: 'transparent',
  },
  homeHeaderCell: {
    fontFamily,
    fontSize: 11,
    fontWeight: '600',
    color: '#9a9a9a',
    letterSpacing: 0.2,
  },
  homeTableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
    paddingVertical: 8,
    minHeight: 34,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f2f2f2',
    ...Platform.select({
      web: {
        cursor: 'pointer',
      },
      default: {},
    }),
  },
  homeTableRowHover: {
    backgroundColor: '#f7f7f7',
  },
  homeTableRowSelected: {
    backgroundColor: '#f0f0f0',
  },
  homeTableEmpty: {
    paddingVertical: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  homeColStore: {
    flex: 1.35,
    minWidth: 0,
    paddingRight: 12,
  },
  homeColNum: {
    width: 48,
    flexShrink: 0,
    textAlign: 'right',
    paddingRight: 8,
  },
  homeColMoney: {
    width: 92,
    flexShrink: 0,
    textAlign: 'right',
    paddingRight: 8,
  },
  homeColTx: {
    flex: 1.35,
    minWidth: 200,
    paddingRight: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  homeColAmount: {
    flex: 1.7,
    minWidth: 260,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  homeCellStore: {
    flex: 1,
    minWidth: 0,
    fontFamily,
    fontSize: 13,
    lineHeight: 16,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  homeCellEmailStore: {
    fontFamily,
    fontSize: 13,
    lineHeight: 16,
    fontWeight: '500',
    color: '#1a1a1a',
    flex: 1.05,
    minWidth: 110,
    paddingRight: 20,
  },
  homeCellCount: {
    fontFamily,
    fontSize: 13,
    lineHeight: 16,
    fontWeight: '500',
    color: '#1a1a1a',
    width: 28,
    fontVariant: ['tabular-nums'],
  },
  homeCellAmount: {
    fontFamily,
    fontSize: 13,
    lineHeight: 16,
    fontWeight: '500',
    color: '#1a1a1a',
    width: 108,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  homeCellPrimary: {
    fontFamily,
    fontSize: 13,
    lineHeight: 16,
    fontWeight: '500',
    color: '#1a1a1a',
    fontVariant: ['tabular-nums'],
  },
  homeCellSecondary: {
    fontFamily,
    fontSize: 12,
    lineHeight: 16,
    color: '#6b6b6b',
    fontVariant: ['tabular-nums'],
  },
  emailColCustomers: {
    flex: 1.4,
    minWidth: 140,
    paddingRight: 16,
  },
  emailColRate: {
    flex: 1,
    minWidth: 96,
    textAlign: 'right',
  },
  emailCellRate: {
    fontFamily,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '500',
    color: '#1a1a1a',
    flex: 1,
    minWidth: 96,
    textAlign: 'right',
  },
  emailDrawerSubtitle: {
    fontFamily,
    fontSize: 13,
    lineHeight: 18,
    color: '#8a8a8a',
    marginTop: 8,
  },
  emailBreakdownHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e5e5',
    marginBottom: 4,
  },
  emailBreakdownHeaderText: {
    fontFamily,
    fontSize: 11,
    fontWeight: '600',
    color: '#9a9a9a',
    letterSpacing: 0.2,
  },
  emailBreakdownRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f2f2f2',
    gap: 12,
  },
  emailBreakdownColPerson: {
    flex: 1.1,
    minWidth: 0,
  },
  emailBreakdownColEmail: {
    flex: 1.4,
    minWidth: 0,
  },
  emailBreakdownColEmployee: {
    flex: 1,
    minWidth: 0,
  },
  emailBreakdownPerson: {
    fontFamily,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
    color: '#1a1a1a',
    flex: 1.1,
    minWidth: 0,
  },
  emailBreakdownEmail: {
    fontFamily,
    fontSize: 13,
    lineHeight: 18,
    color: '#4a4a4a',
    flex: 1.4,
    minWidth: 0,
  },
  emailBreakdownEmailMissing: {
    color: '#b0b0b0',
  },
  emailBreakdownEmployee: {
    fontFamily,
    fontSize: 13,
    lineHeight: 18,
    color: '#4a4a4a',
    flex: 1,
    minWidth: 0,
  },
  homeCellInlineMeta: {
    fontFamily,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '400',
    color: '#8a8a8a',
    fontVariant: ['tabular-nums'],
    flexShrink: 1,
  },
  homeStoreTableWrap: {
    alignSelf: 'stretch',
  },
  storeDrawerShell: {
    height: '100%',
    maxWidth: '100%',
    flexDirection: 'row',
    alignItems: 'stretch',
    overflow: 'visible',
    ...Platform.select({
      web: { willChange: 'transform' },
      default: {},
    }),
  },
  storeDrawerShellMobile: {
    width: '100%',
    overflow: 'hidden',
  },
  storeDrawerPanel: {
    flexShrink: 0,
    minWidth: 0,
    minHeight: 0,
    overflow: 'hidden',
    flexDirection: 'column',
  },
  storeDrawerPanelMobile: {
    backgroundColor: '#f2f2f7',
    flex: 1,
  },
  storeDrawerHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 3,
    overflow: 'hidden',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(0,0,0,0.08)',
  },
  storeDrawerHeaderSolid: {
    backgroundColor: 'rgba(255,255,255,0.97)',
  },
  storeDrawerTitleRow: {
    paddingBottom: 2,
  },
  storeDrawerTitleHit: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  storeDrawerTabsScroll: {
    flexGrow: 0,
    flexShrink: 0,
  },
  storeDrawerAppsRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 14,
    paddingTop: 6,
    paddingBottom: 12,
  },
  storeDrawerAppsRowMobile: {
    paddingHorizontal: 8,
    paddingTop: 4,
    paddingBottom: 10,
  },
  storeDrawerTopBarMobile: {
    paddingHorizontal: 12,
  },
  storeDrawerNavSide: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  storeDrawerTitleMobile: {
    textAlign: 'center',
  },
  storeDrawerPeriod: {
    fontFamily,
    fontSize: 13,
    fontWeight: '400',
    color: '#8e8e93',
    textAlign: 'center',
    letterSpacing: -0.08,
    marginTop: 1,
  },
  storeDrawerAppsSection: {
    marginTop: 28,
  },
  storeDrawerGroupedList: {
    backgroundColor: '#fff',
  },
  storeDrawerAppRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
    paddingLeft: 12,
    paddingRight: 14,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e5ea',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  storeDrawerAppsRail: {
    width: STORE_DRAWER_RAIL_WIDTH,
    flexShrink: 0,
    justifyContent: 'flex-start',
    alignItems: 'center',
    paddingTop: 16,
    paddingBottom: 16,
    paddingHorizontal: 10,
    gap: 4,
    backgroundColor: 'transparent',
    overflow: 'visible',
  },
  storeDrawerRailSep: {
    width: 22,
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#d1d1d6',
    marginVertical: 4,
  },
  storeDrawerTabWrap: {
    width: 48,
    height: 48,
    position: 'relative',
    overflow: 'visible',
  },
  storeDrawerTab: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 48,
    height: 48,
    borderRadius: 12,
    ...Platform.select({
      web: {
        cursor: 'pointer',
      },
      default: {},
    }),
  },
  storeDrawerTabTip: {
    position: 'absolute',
    right: 56,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    zIndex: 2,
  },
  storeDrawerTabTipBubble: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 6,
    backgroundColor: '#1a1a1a',
    ...Platform.select({
      web: {
        boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
      },
      default: {
        elevation: 4,
      },
    }),
  },
  storeDrawerTabTipText: {
    fontFamily,
    fontSize: 12,
    lineHeight: 16,
    color: '#fff',
    ...Platform.select({
      web: {
        whiteSpace: 'nowrap',
      },
      default: {},
    }),
  },
  storeDrawerTabSelected: {
    backgroundColor: '#fff',
    ...Platform.select({
      web: {
        boxShadow: '0 1px 2px rgba(0,0,0,0.12)',
      },
      default: {
        elevation: 1,
      },
    }),
  },
  storeDrawerTabIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'transparent',
  },
  storeDrawerPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 64,
    paddingHorizontal: 24,
    gap: 12,
  },
  storeDrawerPlaceholderIcon: {
    width: 56,
    height: 56,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  storeDrawerPlaceholderTitle: {
    fontFamily,
    fontSize: 22,
    fontWeight: '600',
    color: '#1d1d1f',
    letterSpacing: -0.4,
  },
  storeDrawerPlaceholderBody: {
    fontFamily,
    fontSize: 15,
    lineHeight: 20,
    color: '#8e8e93',
    textAlign: 'center',
    letterSpacing: -0.2,
  },
  storeTxMobileStack: {
    gap: 12,
  },
  storeTxMobileEmpty: {
    paddingHorizontal: 16,
    paddingVertical: 18,
  },
  storeOverviewHero: {
    alignItems: 'center',
    paddingTop: 8,
    paddingBottom: 28,
    gap: 6,
  },
  storeOverviewHeroMobile: {
    paddingTop: 4,
    paddingBottom: 20,
  },
  storeOverviewName: {
    fontFamily,
    fontSize: 22,
    fontWeight: '600',
    color: '#1d1d1f',
    letterSpacing: -0.4,
    marginTop: 8,
  },
  storeOverviewPeriod: {
    fontFamily,
    fontSize: 15,
    color: '#8e8e93',
    letterSpacing: -0.2,
  },
  storeOverviewStatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 52,
    paddingLeft: 16,
    paddingRight: 14,
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e5ea',
  },
  storeOverviewStatPrimary: {
    fontWeight: '600',
    color: '#1d1d1f',
  },
  appleSheetTitle: {
    fontFamily,
    flex: 1,
    fontSize: 17,
    fontWeight: '600',
    color: '#1d1d1f',
    letterSpacing: -0.4,
  },
  appleCloseButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#e8e8ed',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  appleSheetHero: {
    paddingBottom: 24,
  },
  appleSheetCustomer: {
    fontFamily,
    fontSize: 28,
    fontWeight: '700',
    color: '#1d1d1f',
    letterSpacing: -0.6,
  },
  appleSheetMeta: {
    fontFamily,
    fontSize: 15,
    color: '#8e8e93',
    letterSpacing: -0.2,
    marginTop: 4,
  },
  appleSheetAmount: {
    fontFamily,
    fontSize: 34,
    fontWeight: '700',
    color: '#1d1d1f',
    letterSpacing: -0.8,
    fontVariant: ['tabular-nums'],
    marginTop: 8,
  },
  appleGroup: {
    backgroundColor: '#fff',
    borderRadius: 14,
    overflow: 'hidden',
  },
  appleDetailRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    minHeight: 44,
    paddingVertical: 11,
    paddingHorizontal: 16,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e5ea',
  },
  appleDetailRowTappable: {
    alignItems: 'center',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  appleDetailLabel: {
    fontFamily,
    width: 108,
    flexShrink: 0,
    fontSize: 15,
    fontWeight: '400',
    color: '#8e8e93',
    letterSpacing: -0.2,
    paddingTop: 1,
  },
  appleDetailValueWrap: {
    flex: 1,
    minWidth: 0,
    alignItems: 'flex-end',
  },
  appleDetailValue: {
    fontFamily,
    fontSize: 15,
    fontWeight: '400',
    color: '#1d1d1f',
    letterSpacing: -0.2,
    textAlign: 'right',
  },
  appleDetailSub: {
    fontFamily,
    fontSize: 13,
    color: '#8e8e93',
    letterSpacing: -0.08,
    textAlign: 'right',
    marginTop: 2,
  },
  appleSheetSection: {
    marginTop: 24,
  },
  appleSheetSectionLabel: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: '#8e8e93',
    letterSpacing: -0.08,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  appleTableHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 36,
    paddingHorizontal: 16,
    backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e5ea',
  },
  appleTableHeaderText: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: '#8e8e93',
    letterSpacing: -0.08,
    textTransform: 'none',
  },
  appleTableRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    minHeight: 44,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e5ea',
    backgroundColor: '#fff',
  },
  appleTableItemName: {
    fontFamily,
    fontSize: 15,
    fontWeight: '400',
    color: '#1d1d1f',
    letterSpacing: -0.2,
    lineHeight: 20,
  },
  appleTableItemMeta: {
    fontFamily,
    fontSize: 13,
    color: '#8e8e93',
    letterSpacing: -0.08,
    marginTop: 2,
  },
  appleTableCell: {
    fontFamily,
    fontSize: 15,
    fontWeight: '400',
    color: '#1d1d1f',
    letterSpacing: -0.2,
    fontVariant: ['tabular-nums'],
  },
  appleTableMuted: {
    fontFamily,
    flex: 1,
    fontSize: 15,
    color: '#8e8e93',
    letterSpacing: -0.2,
    fontVariant: ['tabular-nums'],
  },
  appleTableTotalLabel: {
    fontFamily,
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: '#1d1d1f',
    letterSpacing: -0.2,
  },
  appleTableTotalValue: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: '#1d1d1f',
    letterSpacing: -0.2,
    fontVariant: ['tabular-nums'],
  },
  applePaymentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 52,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e5ea',
    backgroundColor: '#fff',
  },
  appleNotes: {
    fontFamily,
    fontSize: 15,
    lineHeight: 22,
    color: '#1d1d1f',
    letterSpacing: -0.2,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  txSheetTopBar: {
    paddingTop: 10,
    paddingBottom: 4,
    paddingHorizontal: 16,
  },
  txSheetBodyContent: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 28,
  },
  txSheetHero: {
    paddingBottom: 10,
    gap: 8,
  },
  txSheetHeroRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  txSheetHeroLeft: {
    flex: 1,
    minWidth: 0,
  },
  txSheetCustomer: {
    fontFamily,
    fontSize: 18,
    fontWeight: '700',
    color: '#1d1d1f',
    letterSpacing: -0.4,
  },
  txSheetMeta: {
    fontFamily,
    fontSize: 12,
    color: '#8e8e93',
    letterSpacing: -0.08,
    marginTop: 2,
  },
  txSheetAmount: {
    fontFamily,
    fontSize: 20,
    fontWeight: '700',
    color: '#1d1d1f',
    letterSpacing: -0.4,
    fontVariant: ['tabular-nums'],
  },
  txMetaGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    alignItems: 'flex-start',
  },
  txMetaCol: {
    flexGrow: 1,
    flexBasis: 280,
    minWidth: 260,
  },
  txStatusRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  txStatusChip: {
    backgroundColor: '#e8e8ed',
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  txStatusChipOk: {
    backgroundColor: '#E3F6EA',
  },
  txStatusChipWarn: {
    backgroundColor: '#FFF3D6',
  },
  txStatusChipMuted: {
    backgroundColor: '#EEEEF0',
  },
  txStatusChipText: {
    fontFamily,
    fontSize: 11,
    fontWeight: '600',
    color: '#1d1d1f',
    letterSpacing: -0.08,
  },
  txStatusChipTextOk: {
    color: '#1B7A3F',
  },
  txStatusChipTextWarn: {
    color: '#9A6B00',
  },
  txStatusChipTextMuted: {
    color: '#6B6B70',
  },
  txDetailRow: {
    minHeight: 32,
    paddingVertical: 6,
    paddingHorizontal: 12,
    gap: 8,
  },
  txDetailLabel: {
    width: 88,
    fontSize: 12,
    paddingTop: 1,
  },
  txDetailValue: {
    fontSize: 13,
  },
  txDetailSub: {
    fontSize: 11,
    marginTop: 1,
  },
  txSheetSection: {
    marginTop: 12,
  },
  txSheetSectionLabel: {
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
    color: '#8e8e93',
    letterSpacing: -0.08,
    marginBottom: 6,
    paddingHorizontal: 4,
  },
  txTableHeaderText: {
    fontFamily,
    fontSize: 11,
    fontWeight: '600',
    color: '#8e8e93',
    letterSpacing: -0.08,
  },
  txLineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 40,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e5ea',
    backgroundColor: '#fff',
    gap: 8,
  },
  txLineThumbSlot: {
    width: 36,
    height: 36,
    flexShrink: 0,
  },
  txLineThumbPress: {
    width: 36,
    height: 36,
    flexShrink: 0,
    position: 'relative',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  txLineThumb: {
    width: 36,
    height: 36,
    borderRadius: 6,
    backgroundColor: '#ececf0',
  },
  txLineThumbBadge: {
    position: 'absolute',
    right: -3,
    bottom: -3,
    minWidth: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#1d1d1f',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  txLineThumbBadgeText: {
    fontFamily,
    fontSize: 9,
    fontWeight: '700',
    color: '#fff',
  },
  txLineItem: {
    flex: 1,
    minWidth: 0,
  },
  txLineName: {
    fontFamily,
    fontSize: 13,
    fontWeight: '500',
    color: '#1d1d1f',
    letterSpacing: -0.16,
    lineHeight: 17,
  },
  txLineMeta: {
    fontFamily,
    fontSize: 11,
    color: '#8e8e93',
    letterSpacing: -0.08,
    marginTop: 1,
  },
  txLineCell: {
    fontFamily,
    fontSize: 13,
    fontWeight: '500',
    color: '#1d1d1f',
    letterSpacing: -0.16,
    fontVariant: ['tabular-nums'],
    textAlign: 'right',
  },
  txColQty: {
    width: 52,
    textAlign: 'right',
  },
  txColDelivered: {
    width: 84,
    alignItems: 'flex-end',
  },
  txColUnit: {
    width: 88,
    textAlign: 'right',
  },
  txColAmount: {
    width: 88,
    textAlign: 'right',
  },
  txLineDeliveredQty: {
    fontSize: 12,
    width: '100%',
  },
  txLineDeliveredLabel: {
    fontFamily,
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: -0.04,
    marginTop: 1,
  },
  txLineOk: {
    color: '#1B7A3F',
  },
  txLineWarn: {
    color: '#9A6B00',
  },
  txLineMuted: {
    color: '#8e8e93',
  },
  txLineMutedFlex: {
    fontFamily,
    flex: 1,
    fontSize: 13,
    color: '#8e8e93',
    letterSpacing: -0.16,
  },
  txLineTotalLabel: {
    fontFamily,
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    color: '#1d1d1f',
    letterSpacing: -0.16,
  },
  txLineTotalValue: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: '#1d1d1f',
    letterSpacing: -0.16,
    fontVariant: ['tabular-nums'],
    textAlign: 'right',
  },
  txPaymentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 40,
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e5ea',
    backgroundColor: '#fff',
  },
  txNotes: {
    fontFamily,
    fontSize: 13,
    lineHeight: 18,
    color: '#1d1d1f',
    letterSpacing: -0.16,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  txImageViewerRoot: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  txImageViewerSheet: {
    width: '100%',
    maxWidth: 720,
    maxHeight: '90%',
    alignItems: 'stretch',
  },
  txImageViewerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 10,
  },
  txImageViewerTitle: {
    fontFamily,
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  txImageViewerImage: {
    width: '100%',
    height: 480,
    maxHeight: '75%',
    borderRadius: 10,
    backgroundColor: '#111',
  },
  txImageViewerNav: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
    marginTop: 12,
  },
  txImageViewerNavBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },

  breadcrumb: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    flexWrap: 'nowrap',
    gap: 16,
    alignSelf: 'stretch',
  },
  breadcrumbTrail: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    flexShrink: 1,
    minWidth: 0,
  },
  breadcrumbNav: {
    marginLeft: 'auto',
    flexShrink: 0,
  },
  breadcrumbLink: {
    paddingVertical: 2,
  },
  breadcrumbLinkText: {
    fontFamily,
    fontSize: 20,
    fontWeight: '600',
    color: '#6b6b6b',
  },
  breadcrumbSep: {
    fontFamily,
    fontSize: 18,
    color: '#b0b0b0',
  },
  breadcrumbCurrent: {
    fontFamily,
    fontSize: 20,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  breadcrumbBatch: {
    minWidth: 0,
    flexShrink: 1,
    justifyContent: 'center',
  },
  breadcrumbSub: {
    fontFamily,
    fontSize: 12,
    fontWeight: '500',
    color: '#8e8e93',
    marginTop: -1,
  },
  breadcrumbBack: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 8,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  breadcrumbBackText: {
    fontFamily,
    fontSize: 16,
    fontWeight: '600',
    color: '#C2410C',
  },
  mobileTitleBack: {
    flexDirection: 'row',
    alignItems: 'center',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  mobileTitleBackText: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: '#C2410C',
  },
  toolsScreen: {
    flex: 1,
    minHeight: 0,
    alignItems: 'stretch',
    width: '100%',
    ...Platform.select({
      web: { overflow: 'hidden' },
      default: {},
    }),
  },
  toolsToolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 4,
    marginBottom: 8,
    width: '100%',
    maxWidth: APP_GRID_MAX_WIDTH,
    alignSelf: 'center',
  },
  toolsToolbarOverlay: {
    marginTop: 0,
    marginBottom: 0,
  },
  toolsToolbarBlur: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 3,
    overflow: 'hidden',
    paddingTop: 20,
    paddingHorizontal: 32,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(0,0,0,0.06)',
  },
  toolsToolbarBlurMobile: {
    paddingTop: 16,
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  toolsToolbarMobile: {
    maxWidth: '100%',
    marginTop: 0,
  },
  appsLibraryScrollContent: {
    paddingHorizontal: 32,
  },
  appsLibraryScrollContentMobile: {
    paddingHorizontal: 16,
  },
  toolsSearch: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 0,
    borderRadius: 12,
    paddingHorizontal: 12,
    backgroundColor: '#e8e8ed',
    minHeight: 42,
  },
  toolsSearchMobile: {
    minHeight: 40,
  },
  appsViewToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
    backgroundColor: '#e8e8ed',
    borderRadius: 10,
    padding: 2,
    gap: 0,
  },
  appsViewToggleButton: {
    width: 38,
    height: 38,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  appsViewToggleButtonActive: {
    backgroundColor: '#fff',
    ...Platform.select({
      web: {
        boxShadow: '0 1px 2px rgba(0,0,0,0.12)',
      },
      default: {
        elevation: 1,
      },
    }),
  },
  appsToolbarCompact: {
    gap: 8,
  },
  appsViewToggleCompact: {
    borderRadius: 8,
    padding: 1,
  },
  appsViewToggleButtonCompact: {
    width: 28,
    height: 28,
    borderRadius: 6,
  },
  toolsScroll: {
    flex: 1,
    minHeight: 0,
    width: '100%',
    ...Platform.select({
      web: {
        overflowY: 'auto',
        overflowX: 'hidden',
        height: 0,
      },
      default: {},
    }),
  },
  toolsScrollContent: {
    paddingBottom: 40,
    paddingTop: 16,
  },
  toolsSectionMobile: {
    maxWidth: '100%',
  },
  toolsSearchIcon: {
    marginRight: 8,
  },
  toolsSearchInput: {
    flex: 1,
    fontFamily,
    fontSize: 16,
    color: '#1d1d1f',
    paddingVertical: 10,
    outlineStyle: 'none',
  },
  toolsEmpty: {
    fontFamily,
    fontSize: 15,
    color: '#8e8e93',
    marginTop: 48,
    maxWidth: APP_GRID_MAX_WIDTH,
    width: '100%',
    alignSelf: 'center',
    textAlign: 'center',
  },
  toolsSection: {
    marginTop: 12,
    width: '100%',
    maxWidth: APP_GRID_MAX_WIDTH,
    alignSelf: 'center',
  },
  toolsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    width: '100%',
    alignSelf: 'center',
    justifyContent: 'flex-start',
  },
  toolCardWrap: {
    position: 'relative',
    alignItems: 'center',
    ...Platform.select({
      web: {
        boxSizing: 'border-box',
      },
      default: {},
    }),
  },
  toolCard: {
    width: '100%',
    alignItems: 'center',
    gap: 6,
    ...Platform.select({
      web: {
        cursor: 'pointer',
      },
      default: {},
    }),
  },
  toolIconStack: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolIconTile: {
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      web: {
        boxShadow: '0 1px 1px rgba(0,0,0,0.06), 0 8px 18px rgba(0,0,0,0.12)',
      },
      default: {
        elevation: 4,
      },
    }),
  },
  toolCardLabel: {
    fontFamily,
    fontSize: 12,
    fontWeight: '500',
    color: '#1d1d1f',
    textAlign: 'center',
    lineHeight: 15,
    letterSpacing: -0.08,
    width: '100%',
    paddingHorizontal: 2,
  },
  toolCardLabelSelected: {
    fontWeight: '600',
  },
  toolIconTileSelected: {
    ...Platform.select({
      web: {
        boxShadow: '0 0 0 3px rgba(29,29,31,0.16), 0 1px 1px rgba(0,0,0,0.06), 0 8px 18px rgba(0,0,0,0.12)',
      },
      default: {
        borderWidth: 3,
        borderColor: 'rgba(29,29,31,0.18)',
      },
    }),
  },
  pinButton: {
    position: 'absolute',
    top: -5,
    right: -6,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#d0d0d0',
    opacity: 0,
    zIndex: 2,
    ...Platform.select({
      web: {
        cursor: 'pointer',
        transitionProperty: 'opacity',
        transitionDuration: '120ms',
      },
      default: {
        opacity: 1,
      },
    }),
  },
  pinButtonVisible: {
    opacity: 1,
  },
  pinButtonActive: {
    backgroundColor: '#f2f2f7',
    borderColor: '#c7c7cc',
    opacity: 1,
  },
  toolsList: {
    backgroundColor: '#f2f2f7',
    borderRadius: 10,
    overflow: 'hidden',
  },
  toolListRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 36,
    paddingRight: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e5ea',
  },
  toolListRowHovered: {
    backgroundColor: '#e8e8ed',
  },
  toolListRowLast: {
    borderBottomWidth: 0,
  },
  toolListMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 0,
    paddingVertical: 6,
    paddingLeft: 10,
    paddingRight: 8,
    gap: 10,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  toolListIcon: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolListLabel: {
    fontFamily,
    flex: 1,
    fontSize: 14,
    fontWeight: '400',
    color: '#1d1d1f',
    letterSpacing: -0.08,
  },
  toolListPin: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  toolPageBody: {
    fontFamily,
    fontSize: 14,
    color: '#6b6b6b',
    marginTop: 24,
  },
  transactionsBody: {
    flex: 1,
    minHeight: 0,
    alignSelf: 'stretch',
    width: '100%',
    marginTop: 8,
  },
  txToolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 4,
    marginBottom: 8,
    width: '100%',
  },
  txControls: {
    maxWidth: '100%',
    alignSelf: 'stretch',
    marginTop: 0,
  },
  txMetaRow: {
    maxWidth: '100%',
    alignSelf: 'stretch',
    marginTop: 10,
  },
  txListWrap: {
    flex: 1,
    minHeight: 0,
    backgroundColor: '#f2f2f7',
    borderRadius: 14,
    overflow: 'hidden',
    marginTop: 8,
    position: 'relative',
  },
  txDrawerTable: {
    flex: 0,
    minHeight: undefined,
    marginTop: 0,
  },
  txListContent: {
    paddingBottom: 24,
  },
  txTableHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 36,
    paddingHorizontal: 16,
    backgroundColor: '#ebebf0',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#d1d1d6',
  },
  txTableHeaderCell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 36,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  txTableHeaderCellHover: {
    opacity: 0.72,
  },
  txTableHeaderLabel: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: '#8e8e93',
    letterSpacing: -0.08,
    flexShrink: 1,
  },
  txTableHeaderLabelActive: {
    color: '#1d1d1f',
  },
  txTableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: TX_ROW_HEIGHT,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e5ea',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  txListRowSelected: {
    backgroundColor: '#e8e8ed',
  },
  txTableCell: {
    fontFamily,
    fontSize: 15,
    fontWeight: '400',
    color: '#1d1d1f',
    letterSpacing: -0.2,
  },
  txTableCellPrimary: {
    fontWeight: '500',
  },
  txTableCellSecondary: {
    color: '#6e6e73',
  },
  txTableRef: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minWidth: 0,
  },
  txTableKind: {
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
    color: '#2F6FED',
    letterSpacing: -0.08,
    width: 22,
    flexShrink: 0,
  },
  txTableKindBuy: {
    color: '#C47A12',
  },
  txTableAmount: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 6,
  },
  txTableAmountText: {
    fontFamily,
    fontSize: 15,
    fontWeight: '400',
    color: '#1d1d1f',
    letterSpacing: -0.2,
    fontVariant: ['tabular-nums'],
    textAlign: 'right',
  },
  transactionsToolbar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 12,
    marginBottom: 10,
  },
  transactionsToolbarMobile: {
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 10,
  },
  txSearch: {
    flexDirection: 'row',
    alignItems: 'center',
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 240,
    minWidth: 200,
    maxWidth: 420,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e0e0e0',
    borderRadius: 10,
    paddingHorizontal: 12,
    backgroundColor: '#f7f7f7',
    minHeight: 40,
  },
  txSearchMobile: {
    maxWidth: '100%',
    minWidth: 0,
    flexBasis: 'auto',
    width: '100%',
  },
  dateFiltersMobile: {
    width: '100%',
  },
  mobileTxCard: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ececec',
    backgroundColor: '#fff',
  },
  mobileTxCardSelected: {
    backgroundColor: '#f0f0f0',
  },
  mobileTxCardPressed: {
    backgroundColor: '#f5f5f5',
  },
  mobileTxCardTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 4,
  },
  mobileTxCustomer: {
    fontFamily,
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  mobileTxAmountWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  mobileTxAmount: {
    fontFamily,
    fontSize: 14,
    fontWeight: '600',
    color: '#1a1a1a',
    fontVariant: ['tabular-nums'],
  },
  mobileTxMeta: {
    fontFamily,
    fontSize: 12,
    color: '#6b6b6b',
    marginTop: 2,
  },
  mobileTxEmployee: {
    fontFamily,
    fontSize: 12,
    color: '#8a8a8a',
    marginTop: 4,
  },
  tableListContentMobile: {
    paddingBottom: 24,
  },
  txSearchIcon: {
    marginRight: 8,
  },
  txSearchInput: {
    flex: 1,
    fontFamily,
    fontSize: 13,
    color: '#1a1a1a',
    paddingVertical: 10,
    outlineStyle: 'none',
  },
  dateFilters: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  dateModeGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f3f3f3',
    borderRadius: 10,
    padding: 3,
    gap: 2,
  },
  dateModeChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    minHeight: 34,
    justifyContent: 'center',
    ...Platform.select({
      web: {
        cursor: 'pointer',
      },
      default: {},
    }),
  },
  dateModeChipActive: {
    backgroundColor: '#fff',
    ...Platform.select({
      web: {
        boxShadow: '0 1px 2px rgba(0,0,0,0.08)',
      },
      default: {
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: '#e0e0e0',
      },
    }),
  },
  dateModeChipText: {
    fontFamily,
    fontSize: 13,
    fontWeight: '500',
    color: '#6b6b6b',
  },
  dateModeChipTextActive: {
    color: '#1a1a1a',
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
    ...Platform.select({
      web: {
        cursor: 'pointer',
      },
      default: {},
    }),
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
  dateRangeSep: {
    fontFamily,
    fontSize: 14,
    color: '#c0c0c0',
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
    color: '#2F6FED',
  },
  transactionsMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
    minHeight: 18,
  },
  transactionsMeta: {
    fontFamily,
    fontSize: 12,
    color: '#8a8a8a',
  },
  tableWrap: {
    flex: 1,
    minHeight: 0,
    backgroundColor: '#fff',
    position: 'relative',
    overflow: 'visible',
  },
  tableList: {
    flex: 1,
    overflow: 'hidden',
  },
  tableListContent: {
    paddingBottom: 16,
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: TX_ROW_HEIGHT,
    paddingHorizontal: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f2f2f2',
    backgroundColor: '#fff',
    ...Platform.select({
      web: {
        cursor: 'pointer',
        transitionProperty: 'none',
      },
      default: {},
    }),
  },
  tableRowHover: {
    backgroundColor: '#ececec',
  },
  tableRowSelected: {
    backgroundColor: '#e4e4e4',
  },
  drawerRoot: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    overflow: 'visible',
  },
  drawerBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.28)',
  },
  drawerPanel: {
    height: '100%',
    backgroundColor: '#fff',
    ...Platform.select({
      web: {
        boxShadow: '-12px 0 32px rgba(0,0,0,0.18)',
      },
      default: {
        elevation: 12,
      },
    }),
  },
  appleSheetPanel: {
    backgroundColor: '#f2f2f7',
  },
  invoiceTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
    gap: 12,
  },
  invoiceTopBarMobile: {
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 54 : 18,
    paddingBottom: 10,
  },
  invoiceHeaderRowMobile: {
    flexDirection: 'column',
    gap: 12,
  },
  invoiceInfoGridMobile: {
    flexDirection: 'column',
  },
  drawerBodyContentMobile: {
    paddingHorizontal: 16,
    paddingBottom: 48,
  },
  drawerBodyContentInventoryMobile: {
    paddingHorizontal: 12,
  },
  invoiceDocLabel: {
    fontFamily,
    fontSize: 11,
    fontWeight: '600',
    color: '#8a8a8a',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  drawerClose: {
    padding: 2,
  },
  drawerBody: {
    flex: 1,
    minHeight: 0,
  },
  drawerBodyFill: {
    minHeight: 0,
  },
  drawerBodyContent: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 48,
  },
  drawerBodyContentInventory: {
    flex: 1,
    minHeight: 0,
    width: '100%',
    maxWidth: '100%',
    paddingHorizontal: 20,
    paddingBottom: 24,
  },
  drawerLoading: {
    paddingVertical: 36,
    alignItems: 'center',
  },
  invoiceHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 24,
    paddingTop: 8,
    paddingBottom: 28,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e5e5',
    marginBottom: 28,
  },
  invoiceHeaderLeft: {
    flex: 1,
    minWidth: 0,
  },
  invoiceHeaderRight: {
    alignItems: 'flex-end',
  },
  invoiceNumber: {
    fontFamily,
    fontSize: 24,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  invoiceTotalLabelTop: {
    fontFamily,
    fontSize: 11,
    fontWeight: '600',
    color: '#8a8a8a',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    marginBottom: 6,
  },
  invoiceTotalHero: {
    fontFamily,
    fontSize: 28,
    fontWeight: '600',
    color: '#1a1a1a',
    fontVariant: ['tabular-nums'],
  },
  invoiceInfoGrid: {
    flexDirection: 'row',
    gap: 20,
    marginBottom: 32,
  },
  invoiceInfoCard: {
    flex: 1,
    minWidth: 0,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e5e5',
    borderRadius: 8,
    padding: 16,
    backgroundColor: '#fafafa',
  },
  invoiceSection: {
    marginBottom: 32,
  },
  invoiceSectionLabel: {
    fontFamily,
    fontSize: 11,
    fontWeight: '600',
    color: '#8a8a8a',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    marginBottom: 12,
  },
  invoicePartyName: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: '#1a1a1a',
    marginBottom: 4,
  },
  invoicePartyDetail: {
    fontFamily,
    fontSize: 13,
    color: '#6b6b6b',
    marginTop: 4,
    lineHeight: 18,
  },
  invoiceDetailList: {
    gap: 12,
  },
  invoiceDetailRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  invoiceDetailKey: {
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
    color: '#8a8a8a',
    width: 72,
    paddingTop: 1,
  },
  invoiceDetailValWrap: {
    flex: 1,
    minWidth: 0,
  },
  invoiceDetailVal: {
    fontFamily,
    fontSize: 13,
    color: '#1a1a1a',
    flex: 1,
    lineHeight: 18,
  },
  invoiceDetailSub: {
    fontFamily,
    fontSize: 12,
    color: '#6b6b6b',
    marginTop: 3,
    lineHeight: 16,
  },
  invoiceStatusRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  invoiceStatusChip: {
    backgroundColor: '#e8e8ed',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  invoiceStatusText: {
    fontFamily,
    fontSize: 13,
    color: '#1d1d1f',
    fontWeight: '500',
    letterSpacing: -0.08,
  },
  invoiceTableHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: 10,
    marginBottom: 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#1a1a1a',
  },
  invoiceTableHeaderText: {
    fontFamily,
    fontSize: 11,
    fontWeight: '600',
    color: '#8a8a8a',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  invoiceTableRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#eeeeee',
  },
  invoiceColItem: {
    flex: 1,
    minWidth: 0,
    paddingRight: 16,
  },
  invoiceColQty: {
    width: 64,
    fontFamily,
    fontSize: 13,
    color: '#1a1a1a',
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
    paddingTop: 1,
  },
  invoiceColAmount: {
    width: 120,
    fontFamily,
    fontSize: 13,
    color: '#1a1a1a',
    textAlign: 'right',
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
    paddingTop: 1,
  },
  invoiceItemName: {
    fontFamily,
    fontSize: 13,
    color: '#1a1a1a',
    fontWeight: '500',
    lineHeight: 18,
  },
  invoiceItemSku: {
    fontFamily,
    fontSize: 12,
    color: '#8a8a8a',
    marginTop: 4,
    lineHeight: 16,
  },
  invoiceEmptyLine: {
    fontFamily,
    fontSize: 13,
    color: '#8a8a8a',
    paddingVertical: 20,
  },
  invoiceTotals: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#1a1a1a',
    gap: 8,
  },
  invoiceTotalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  invoiceTotalLabel: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  invoiceTotalValue: {
    fontFamily,
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
    fontVariant: ['tabular-nums'],
  },
  invoiceTotalMuted: {
    fontFamily,
    fontSize: 12,
    color: '#6b6b6b',
  },
  invoicePaymentRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#eeeeee',
  },
  invoiceNotesSection: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e5e5e5',
    paddingTop: 24,
  },
  invoiceNotes: {
    fontFamily,
    fontSize: 13,
    color: '#1a1a1a',
    lineHeight: 20,
  },
  tableHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    height: TX_ROW_HEIGHT,
    paddingHorizontal: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e8e8e8',
    zIndex: 2,
  },
  headerCell: {
    flexDirection: 'row',
    alignItems: 'center',
    height: '100%',
    gap: 4,
    ...Platform.select({
      web: {
        cursor: 'pointer',
      },
      default: {},
    }),
  },
  headerFilterIcon: {
    marginTop: 1,
    flexShrink: 0,
  },
  tableHeaderCell: {
    fontFamily,
    fontSize: 11,
    fontWeight: '600',
    color: '#9a9a9a',
    letterSpacing: 0.2,
    flexShrink: 1,
  },
  clearFiltersText: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: '#1d1d1f',
    letterSpacing: -0.2,
  },
  filterModalRoot: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  filterModalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.28)',
  },
  filterMenu: {
    width: '100%',
    maxWidth: 340,
    maxHeight: '80%',
    backgroundColor: '#fff',
    borderRadius: 14,
    overflow: 'hidden',
    ...Platform.select({
      web: {
        boxShadow: '0 12px 40px rgba(0,0,0,0.18)',
      },
      default: {
        elevation: 10,
      },
    }),
  },
  filterMenuHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  filterMenuTitle: {
    fontFamily,
    fontSize: 17,
    fontWeight: '600',
    color: '#1d1d1f',
    letterSpacing: -0.4,
  },
  filterField: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginBottom: 10,
    borderRadius: 10,
    paddingHorizontal: 12,
    backgroundColor: '#e8e8ed',
    minHeight: 36,
  },
  filterFieldLabel: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: '#8e8e93',
    width: 56,
  },
  filterFieldInput: {
    flex: 1,
    fontFamily,
    fontSize: 15,
    color: '#1d1d1f',
    paddingVertical: 8,
    paddingHorizontal: 0,
    outlineStyle: 'none',
  },
  filterActions: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 8,
    gap: 6,
  },
  filterActionText: {
    fontFamily,
    fontSize: 15,
    fontWeight: '500',
    color: '#1d1d1f',
  },
  filterActionDisabled: {
    color: '#c0c0c0',
  },
  filterActionSep: {
    fontFamily,
    fontSize: 12,
    color: '#d0d0d0',
  },
  filterCount: {
    fontFamily,
    fontSize: 11,
    color: '#8a8a8a',
    marginLeft: 'auto',
  },
  filterList: {
    height: 240,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e5e5e5',
  },
  filterOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    minHeight: 44,
    ...Platform.select({
      web: {
        cursor: 'pointer',
      },
      default: {},
    }),
  },
  filterOptionText: {
    fontFamily,
    fontSize: 15,
    color: '#1d1d1f',
    letterSpacing: -0.2,
    flex: 1,
  },
  filterEmpty: {
    fontFamily,
    fontSize: 13,
    color: '#8a8a8a',
    textAlign: 'center',
    paddingVertical: 20,
  },
  filterDoneButton: {
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 16,
    backgroundColor: '#1d1d1f',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignItems: 'center',
    minHeight: 40,
    justifyContent: 'center',
  },
  filterDoneButtonText: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
    letterSpacing: -0.2,
  },
  tableCell: {
    fontFamily,
    fontSize: 13,
    color: '#1a1a1a',
    lineHeight: 16,
  },
  cellStore: {
    fontFamily,
    fontSize: 13,
    lineHeight: 16,
    color: '#1a1a1a',
    flex: 1.1,
    minWidth: 72,
    paddingRight: 12,
  },
  cellDate: {
    fontFamily,
    fontSize: 13,
    lineHeight: 16,
    color: '#5a5a5a',
    flex: 1.2,
    minWidth: 96,
    paddingRight: 12,
  },
  cellTime: {
    fontFamily,
    fontSize: 13,
    lineHeight: 16,
    color: '#5a5a5a',
    flex: 0.75,
    minWidth: 64,
    paddingRight: 12,
  },
  cellRef: {
    fontFamily,
    fontSize: 13,
    lineHeight: 16,
    color: '#4a4a4a',
    flex: 1.05,
    minWidth: 84,
    paddingRight: 12,
    fontVariant: ['tabular-nums'],
  },
  cellCustomer: {
    fontFamily,
    fontSize: 13,
    lineHeight: 16,
    color: '#1a1a1a',
    flex: 2.4,
    minWidth: 120,
    paddingRight: 12,
  },
  cellPayment: {
    fontFamily,
    fontSize: 13,
    lineHeight: 16,
    color: '#4a4a4a',
    flex: 1.4,
    minWidth: 110,
    paddingRight: 12,
  },
  cellAmount: {
    flex: 1.2,
    minWidth: 96,
    paddingRight: 12,
    justifyContent: 'center',
  },
  amountCellInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    minWidth: 0,
  },
  amountCellText: {
    fontFamily,
    fontSize: 13,
    lineHeight: 16,
    color: '#1a1a1a',
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
    flexShrink: 1,
  },
  amountCellFintrac: {
    color: '#8a1c1c',
    fontWeight: '600',
  },
  fintracDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#b42318',
    flexShrink: 0,
  },
  cellEmployee: {
    flex: 1.5,
    minWidth: 100,
    justifyContent: 'center',
  },
  employeeCellText: {
    fontFamily,
    fontSize: 13,
    lineHeight: 16,
    color: '#1a1a1a',
  },
  filterPreset: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 10,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#fff7f7',
    ...Platform.select({
      web: {
        cursor: 'pointer',
      },
      default: {},
    }),
  },
  filterPresetTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  filterPresetTitle: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: '#8a1c1c',
    letterSpacing: -0.2,
  },
  filterPresetSub: {
    fontFamily,
    fontSize: 13,
    color: '#a05a5a',
    marginTop: 1,
  },
  fintracFilterBadge: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: '#8a1c1c',
    backgroundColor: '#fff7f7',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    overflow: 'hidden',
  },
  colStore: {
    flex: 1.15,
    minWidth: 86,
    paddingRight: 16,
  },
  colDate: {
    flex: 1.05,
    minWidth: 88,
    paddingRight: 16,
  },
  colTime: {
    flex: 0.7,
    minWidth: 58,
    paddingRight: 16,
  },
  colRef: {
    flex: 1.25,
    minWidth: 108,
    paddingRight: 16,
  },
  colCustomer: {
    flex: 2.5,
    minWidth: 140,
    paddingRight: 16,
  },
  colPayment: {
    flex: 1.35,
    minWidth: 108,
    paddingRight: 16,
  },
  colAmount: {
    flex: 1.2,
    minWidth: 118,
    paddingRight: 16,
    justifyContent: 'flex-end',
    textAlign: 'right',
  },
  colEmployee: {
    flex: 1.7,
    minWidth: 132,
  },
  txEmployeeCell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minWidth: 0,
  },
  tableEmpty: {
    paddingVertical: 48,
    alignItems: 'center',
  },
  tableEmptyText: {
    fontFamily,
    fontSize: 13,
    color: '#8a8a8a',
  },
  loginForm: {
    flex: 1,
    width: '100%',
    maxWidth: 360,
    alignSelf: 'center',
    justifyContent: 'center',
  },
  loginSubtitle: {
    fontFamily,
    fontSize: 13,
    color: '#6b6b6b',
    marginTop: 6,
    marginBottom: 24,
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#d0d0d0',
    borderRadius: 6,
    paddingHorizontal: 12,
    marginBottom: 14,
    backgroundColor: '#fff',
  },
  fieldLabel: {
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
    color: '#1a1a1a',
    width: 80,
  },
  input: {
    flex: 1,
    fontFamily,
    fontSize: 13,
    color: '#1a1a1a',
    paddingVertical: 10,
    paddingHorizontal: 0,
    outlineStyle: 'none',
  },
  errorText: {
    fontFamily,
    fontSize: 12,
    color: '#b42318',
    marginBottom: 12,
  },
  loginButton: {
    marginTop: 4,
    backgroundColor: '#1a1a1a',
    borderRadius: 6,
    paddingVertical: 10,
    alignItems: 'center',
    minHeight: 40,
    justifyContent: 'center',
  },
  loginButtonDisabled: {
    opacity: 0.7,
  },
  loginButtonText: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: '#fff',
  },
  igGroupedScreen: {
    backgroundColor: '#f2f2f7',
  },
  igLargeTitle: {
    fontFamily: titleFontFamily,
    fontSize: 34,
    fontWeight: '400',
    color: '#1d1d1f',
    letterSpacing: -0.8,
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 8,
  },
  igSearchField: {
    minHeight: 36,
    borderRadius: 10,
    backgroundColor: 'rgba(118,118,128,0.12)',
  },
  igHomePad: {
    width: '100%',
    maxWidth: '100%',
    paddingHorizontal: 16,
    alignSelf: 'stretch',
  },
  igHomeToolbar: {
    maxWidth: '100%',
    paddingHorizontal: 16,
    paddingTop: 2,
    paddingBottom: 10,
    gap: 8,
  },
  igHomeToolbarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    width: '100%',
  },
  igSearchInput: {
    fontSize: 16,
    paddingVertical: 7,
  },
  igSegment: {
    borderRadius: 10,
    padding: 2,
    backgroundColor: 'rgba(118,118,128,0.12)',
  },
  igSegmentFill: {
    flex: 1,
  },
  igSegmentButton: {
    height: 32,
    paddingHorizontal: 14,
    borderRadius: 8,
  },
  igSegmentButtonFill: {
    flex: 1,
  },
  igSegmentText: {
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: -0.15,
  },
  homeDateFieldFill: {
    flex: 1,
    minWidth: 0,
    minHeight: 36,
    borderRadius: 10,
    backgroundColor: 'rgba(118,118,128,0.12)',
  },
  igHomeControls: {
    maxWidth: '100%',
    marginTop: 4,
    marginBottom: 8,
    paddingHorizontal: 16,
  },
  igHomeScroll: {
    paddingTop: 4,
    paddingBottom: 32,
  },
  igHomeHero: {
    marginHorizontal: 16,
    marginBottom: 20,
    paddingTop: 16,
    paddingBottom: 14,
    paddingHorizontal: 16,
    borderRadius: 14,
    backgroundColor: '#fff',
  },
  igHomeHeroLabel: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: '#8e8e93',
    letterSpacing: -0.08,
  },
  igHomeHeroAmount: {
    fontFamily: titleFontFamily,
    fontSize: 40,
    lineHeight: 46,
    fontWeight: '400',
    color: '#1d1d1f',
    letterSpacing: -1.2,
    marginTop: 2,
    fontVariant: ['tabular-nums'],
  },
  igHomeHeroStats: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(60,60,67,0.18)',
  },
  igHomeHeroStat: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  igHomeHeroStatDivider: {
    width: StyleSheet.hairlineWidth,
    height: 28,
    marginHorizontal: 12,
    backgroundColor: 'rgba(60,60,67,0.18)',
  },
  igHomeHeroStatValue: {
    fontFamily,
    fontSize: 17,
    fontWeight: '600',
    color: '#1d1d1f',
    letterSpacing: -0.3,
    fontVariant: ['tabular-nums'],
  },
  igHomeHeroStatLabel: {
    fontFamily,
    fontSize: 12,
    color: '#8e8e93',
    letterSpacing: -0.05,
  },
  igHomeHeroMeta: {
    fontFamily,
    fontSize: 13,
    color: '#8e8e93',
    marginTop: 10,
    letterSpacing: -0.08,
  },
  igSectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingHorizontal: 32,
    marginBottom: 6,
  },
  igSectionHeader: {
    fontFamily,
    fontSize: 13,
    fontWeight: '400',
    color: '#8e8e93',
    letterSpacing: -0.08,
    textTransform: 'uppercase',
  },
  igSectionHeaderMeta: {
    fontFamily,
    fontSize: 13,
    color: '#8e8e93',
    letterSpacing: -0.08,
    fontVariant: ['tabular-nums'],
  },
  igHomeSection: {
    marginTop: 0,
    paddingHorizontal: 16,
  },
  igStoreList: {
    backgroundColor: '#fff',
    borderRadius: 14,
    overflow: 'hidden',
  },
  igStoreCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 68,
    paddingLeft: 12,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  igStoreCardStatic: {
    ...Platform.select({
      web: { cursor: 'default' },
      default: {},
    }),
  },
  igStoreBody: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 11,
    paddingRight: 12,
    alignSelf: 'stretch',
  },
  igStoreBodyDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(60,60,67,0.24)',
  },
  igStoreCardSelected: {
    backgroundColor: '#f2f2f7',
  },
  igStoreCardPressed: {
    backgroundColor: 'rgba(60,60,67,0.08)',
  },
  igStoreIconWrap: {
    width: 48,
    height: 48,
  },
  igStoreIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  igStoreCopy: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  igStoreMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minWidth: 0,
  },
  igStoreMetric: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    flexShrink: 0,
  },
  igStoreMetricText: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: -0.08,
    fontVariant: ['tabular-nums'],
  },
  igStoreTrailing: {
    alignItems: 'flex-end',
    justifyContent: 'center',
    flexShrink: 0,
    gap: 2,
  },
  igStoreChevron: {
    flexShrink: 0,
    marginLeft: -2,
  },
  igStoreName: {
    fontFamily,
    fontSize: 16,
    fontWeight: '600',
    color: '#1d1d1f',
    letterSpacing: -0.24,
  },
  igStoreMeta: {
    fontFamily,
    fontSize: 13,
    color: '#8e8e93',
    letterSpacing: -0.08,
    flexShrink: 1,
    minWidth: 0,
  },
  igStoreAmount: {
    fontFamily,
    fontSize: 16,
    fontWeight: '600',
    color: '#1d1d1f',
    letterSpacing: -0.3,
    fontVariant: ['tabular-nums'],
  },
  igStoreTotalCard: {
    backgroundColor: '#f2f2f7',
    ...Platform.select({
      web: { cursor: 'default' },
      default: {},
    }),
  },
  igStoreTotalLabel: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: '#1d1d1f',
  },
  igStoreTotalAmount: {
    fontFamily,
    fontSize: 16,
    fontWeight: '700',
    color: '#1d1d1f',
    fontVariant: ['tabular-nums'],
  },
  igAppsScroll: {
    paddingBottom: 40,
    paddingTop: 4,
  },
  igAppsToolbar: {
    maxWidth: '100%',
    marginTop: 0,
    marginBottom: 8,
    paddingHorizontal: 16,
  },
  igAppsSection: {
    marginTop: 12,
    paddingHorizontal: 12,
  },
  igToolPad: {
    paddingHorizontal: 16,
  },
});
