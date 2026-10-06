import {
  Component,
  createElement,
  Fragment,
  lazy,
  memo,
  Suspense,
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { BlurView } from 'expo-blur';
import { loadAsync as loadFontsAsync, useFonts } from 'expo-font';
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
  accessiblePosSystems,
  hasStoredSession,
  login as loginRequest,
  logout as logoutRequest,
  onAureusSessionExpired,
  onSessionRevoked,
  posEmployeeId,
  primaryPosSystem,
  restoreSession,
  switchPrimaryPosSystem,
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
  loadUserAppAccessMap,
  canUseWorkshopLocation,
  canViewTriageInsights,
  shouldPrefetchTriage,
  useAppAccess,
  visibleAppKeysForProfile,
} from './lib/permissions';
import { clearInventoryCache, prefetchInventoryMatrix } from './lib/inventory';
import { clearCashTillCache, prefetchStoreCashPositions } from './lib/cashTill';
import { mergeStaffWithEmployeeRoster } from './lib/employeeRoster';
import { HOME_PINNED_STORES, storesMatch } from './lib/storeCatalog';
import { clearLocationCache } from './lib/locations';
import {
  buildEmailCaptureByStore,
  defaultDateRange,
  fetchHomeStoreSummaries,
  fetchTransactionDetail,
  fetchTransactions,
  HOME_FAST_EXTRAS,
  HOME_SUMMARY_EXTRAS,
  mergeHomeSummaryEmails,
  peekHomeEmailRows,
  rememberHomeEmailRows,
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
import { readHoursOAuthCallback } from './lib/ripplingTime';
import { readGmailOAuthCallback } from './lib/gmail';
import { clearClockedIn, ClockedInMark, startClockedInSync, useIsClockedIn } from './lib/clockedIn';
import StoreSnapshotPanel from './components/StoreSnapshotPanel';
import StoreTransactionPanel, { documentCrumb } from './components/StoreTransactionPanel';
import TxnCashBreakdownModal, { TxnCashIcon } from './components/TxnCashBreakdownModal';
import { AUREUS_TX_LIVE_MS, useLiveRefresh } from './lib/liveRefresh';
import { capturePurchasePriceCatalog } from './lib/priceCheckSettings';
import { useTxnCashBreakdowns } from './lib/txnCashBreakdowns';
import { flushNow as flushActionLog, setActionLogActor, setActionLogContext } from './lib/actionLog';
import { DISPLAY_CURRENCIES, DisplayCurrencyProvider, useDisplayCurrency } from './lib/displayCurrency';
import { AppDateProvider, AppDateRouteReset, useAppDate } from './lib/appDate';
import { SPOT_METALS } from './lib/spotPrices';
import HomeDatePicker from './components/HomeDatePicker';
import LoginScreen from './components/LoginScreen';
import ProfileLoginSwitcher from './components/ProfileLoginSwitcher';
import {
  MobileFeedTopBar,
  MobileNavHeader,
  MobileSafeTop,
  MobileTabBar,
} from './components/MobileChrome';
import {
  expandMobileTabBar,
  mobileTabBarReserve,
  useMobileTabBarScrollProps,
} from './lib/mobileTabBar';
import { profileTargetFromPerson } from './lib/profileTarget';
import ProfileLocationPicker from './components/ProfileLocationPicker';
import { PhoneCallProvider, PhoneIncomingDock, usePhoneCalls } from './components/PhoneCallProvider';
import MobilePhoneDock from './components/MobilePhoneDock';
import {
  callsForStore,
  clearPhoneHistoryCache,
  fetchPhoneHistory,
  inboundCallRatio,
  mergeCallLog,
  peekPhoneHistory,
  phoneHistoryNeeded,
} from './lib/phoneCalls';
import {
  emptyStoreSettings,
  isStoreOpenNow,
  listSavedStoreSettings,
  settingsForStoreName,
  storeKeyFromName,
} from './lib/storeSettings';
import {
  GOOGLE_STORE_PLACES,
  fetchGoogleReviewsForStore,
  peekHomeStoreReviews,
  rememberHomeStoreReviews,
  reviewStatsFromReviews,
  reviewsForStoreName,
} from './lib/googleReviews';
import { attributedReviewEmployeeNames, employeeNameMatchesAny } from './lib/bonuses';
import { captureTokenFromLocation } from './lib/qrCode';
import { fetchAureusEmployee } from './lib/aureusEmployees';
import { useDirectMessages } from './lib/messages';
import {
  CANVAS,
  DESKTOP_TOP_BAR_HEIGHT,
  MOBILE,
  MOBILE_FEED_TOP_BAR_HEIGHT,
  MOBILE_FILTER_INSET,
  MOBILE_FILTER_SIZE,
  NAV_ICON_ACTIVE,
  NAV_ICON_INACTIVE,
  NAV_TAB_ACTIVE_BG,
  mobileSafeBottom,
} from './lib/mobileUi';
import { FONT, FONT_LIGHT, SOHNE_NATIVE_FONTS, SOHNE_WEB_FONTS } from './lib/typography';

// Every tool screen is loaded on demand. On web, Metro turns each `import()`
// into its own chunk, so the first paint only ships the shell, login and home
// instead of every screen in the app. The loaders are kept in a map so a
// screen can also be warmed ahead of time (see `warmScreen`).
const SCREEN_LOADERS = {
  accounting: () => import('./components/AccountingScreen'),
  analytics: () => import('./components/AnalyticsScreen'),
  audit: () => import('./components/AuditScreen'),
  bonuses: () => import('./components/BonusesScreen'),
  calendar: () => import('./components/CalendarScreen'),
  customers: () => import('./components/CustomersScreen'),
  debit: () => import('./components/DebitScreen'),
  emails: () => import('./components/EmailsScreen'),
  employees: () => import('./components/EmployeesScreen'),
  financials: () => import('./components/FinancialsScreen'),
  fintrac: () => import('./components/FintracScreen'),
  '100-ways': () => import('./components/HundredWaysScreen'),
  inventory: () => import('./components/InventoryScreen'),
  'line-photo-capture': () => import('./components/LinePhotoCapturePage'),
  logs: () => import('./components/LogsScreen'),
  marketing: () => import('./components/MarketingScreen'),
  messages: () => import('./components/MessagesScreen'),
  phone: () => import('./components/PhoneScreen'),
  preorders: () => import('./components/PreordersScreen'),
  pricing: () => import('./components/PricingScreen'),
  profile: () => import('./components/ProfileScreen'),
  reviews: () => import('./components/ReviewsScreen'),
  search: () => import('./components/SearchScreen'),
  serphint: () => import('./components/SerphintScreen'),
  settings: () => import('./components/SettingsScreen'),
  'shared-services': () => import('./components/SharedServicesScreen'),
  'store-settings': () => import('./components/StoreSettingsPanel'),
  teams: () => import('./components/TeamsScreen'),
  trade: () => import('./components/TradeScreen'),
  transfer: () => import('./components/TransferScreen'),
  triage: () => import('./components/TriageScreen'),
};

const AccountingScreen = lazy(SCREEN_LOADERS.accounting);
const AnalyticsScreen = lazy(SCREEN_LOADERS.analytics);
const AuditScreen = lazy(SCREEN_LOADERS.audit);
const BonusesScreen = lazy(SCREEN_LOADERS.bonuses);
const CalendarScreen = lazy(SCREEN_LOADERS.calendar);
const CustomersScreen = lazy(SCREEN_LOADERS.customers);
const DebitScreen = lazy(SCREEN_LOADERS.debit);
const EmailsScreen = lazy(SCREEN_LOADERS.emails);
const EmployeesScreen = lazy(SCREEN_LOADERS.employees);
const FinancialsScreen = lazy(SCREEN_LOADERS.financials);
const FintracScreen = lazy(SCREEN_LOADERS.fintrac);
const HundredWaysScreen = lazy(SCREEN_LOADERS['100-ways']);
const InventoryScreen = lazy(SCREEN_LOADERS.inventory);
const LinePhotoCapturePage = lazy(SCREEN_LOADERS['line-photo-capture']);
const LogsScreen = lazy(SCREEN_LOADERS.logs);
const MarketingScreen = lazy(SCREEN_LOADERS.marketing);
const MessagesScreen = lazy(SCREEN_LOADERS.messages);
const PhoneScreen = lazy(SCREEN_LOADERS.phone);
const PreordersScreen = lazy(SCREEN_LOADERS.preorders);
const PricingScreen = lazy(SCREEN_LOADERS.pricing);
const ProfileScreen = lazy(SCREEN_LOADERS.profile);
const ReviewsScreen = lazy(SCREEN_LOADERS.reviews);
const SearchScreen = lazy(SCREEN_LOADERS.search);
const SerphintScreen = lazy(SCREEN_LOADERS.serphint);
const SettingsScreen = lazy(SCREEN_LOADERS.settings);
const SharedServicesScreen = lazy(SCREEN_LOADERS['shared-services']);
const StoreSettingsPanel = lazy(SCREEN_LOADERS['store-settings']);
const TeamsScreen = lazy(SCREEN_LOADERS.teams);
const TradeScreen = lazy(SCREEN_LOADERS.trade);
const TransferScreen = lazy(SCREEN_LOADERS.transfer);
const TriageScreen = lazy(SCREEN_LOADERS.triage);

/**
 * Runs a background warm-up (inventory matrix, till positions, triage cache)
 * once the browser has had a moment to paint what the person is actually
 * looking at. Browsers only allow a handful of connections per POS host, so
 * firing these the instant a session lands puts them in the same queue as the
 * Home summary and makes the first screen wait. Returns a cancel function.
 */
function scheduleWarmup(run, delayMs = 3500) {
  let cancelled = false;
  let idleHandle = null;
  const timer = setTimeout(() => {
    if (cancelled) return;
    if (typeof requestIdleCallback === 'function') {
      idleHandle = requestIdleCallback(
        () => {
          if (!cancelled) run();
        },
        { timeout: 2000 },
      );
    } else {
      run();
    }
  }, delayMs);
  return () => {
    cancelled = true;
    clearTimeout(timer);
    if (idleHandle != null && typeof cancelIdleCallback === 'function') cancelIdleCallback(idleHandle);
  };
}

/** Inventory + till + triage caches, after the first screen is on-screen. */
function warmSessionCaches(session) {
  if (!session?.token) return () => {};
  return scheduleWarmup(() => {
    prefetchInventoryMatrix(session);
    prefetchStoreCashPositions(session);
    if (shouldPrefetchTriage(session.profile)) {
      import('./lib/transferWorkflow')
        .then((mod) => mod.warmTriageWorkflow())
        .catch(() => {});
    }
  });
}

const warmedScreens = new Set();
/** Start downloading a screen's chunk before it is opened. Safe to call often. */
function warmScreen(key) {
  const loader = SCREEN_LOADERS[key];
  if (!loader || warmedScreens.has(key)) return;
  warmedScreens.add(key);
  loader().catch(() => {
    warmedScreens.delete(key);
  });
}

/** Shown in place of a screen while its chunk is still downloading. */
function ScreenFallback() {
  return (
    <View style={styles.centered}>
      <ActivityIndicator color="#1a1a1a" />
    </View>
  );
}

/**
 * Catches a screen that failed to load or render. The usual cause is a chunk
 * that no longer exists because a new version was deployed while this tab
 * stayed open; reloading picks up the new build. Without this, the failure
 * would unmount the whole app.
 */
function reloadFreshScreen() {
  const url = new URL(window.location.href);
  url.searchParams.set('screen', String(Date.now()));
  window.location.replace(url.toString());
}

function storedOpenTool() {
  try {
    return sessionStorage.getItem('cgold-open-tool') || '';
  } catch {
    return '';
  }
}

function rememberOpenTool(key) {
  try {
    if (key) sessionStorage.setItem('cgold-open-tool', key);
    else sessionStorage.removeItem('cgold-open-tool');
  } catch {
    /* ignore */
  }
}

function storedSidebarCollapsed() {
  try {
    return localStorage.getItem('cgold-sidebar-collapsed') === '1';
  } catch {
    return false;
  }
}

function rememberSidebarCollapsed(collapsed) {
  try {
    if (collapsed) localStorage.setItem('cgold-sidebar-collapsed', '1');
    else localStorage.removeItem('cgold-sidebar-collapsed');
  } catch {
    /* ignore */
  }
}

class ScreenBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidMount() {
    this.clearReloadFlag();
  }

  componentDidUpdate(prevProps) {
    if (this.state.failed && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ failed: false });
      return;
    }
    this.clearReloadFlag();
  }

  componentDidCatch() {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    try {
      if (sessionStorage.getItem('cgold-screen-reload')) return;
      sessionStorage.setItem('cgold-screen-reload', '1');
    } catch {
      return;
    }
    reloadFreshScreen();
  }

  clearReloadFlag() {
    if (this.state.failed || Platform.OS !== 'web') return;
    try {
      sessionStorage.removeItem('cgold-screen-reload');
    } catch {
      /* ignore */
    }
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <View style={styles.centered}>
        <Text style={styles.toolsEmpty}>This screen could not be loaded.</Text>
        {Platform.OS === 'web' ? (
          <Pressable
            accessibilityRole="button"
            onPress={reloadFreshScreen}
            style={styles.screenReloadButton}
          >
            <Text style={styles.screenReloadLabel}>Reload</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }
}

/** Suspense + error boundary for a lazily loaded screen. */
function ScreenGate({ resetKey, children }) {
  return (
    <ScreenBoundary resetKey={resetKey}>
      <Suspense fallback={<ScreenFallback />}>{children}</Suspense>
    </ScreenBoundary>
  );
}

// Web fonts. Only the text faces and the icon set used by the shell (tabs,
// tool cards) gate the first paint; they are small and preloaded from
// public/index.html. The larger icon sets are fetched in the background and
// glyphs appear as soon as they land instead of holding up the whole app.
const WEB_SHELL_FONTS = {
  ...SOHNE_WEB_FONTS,
  ionicons: '/fonts/Ionicons.ttf',
};
const WEB_DEFERRED_FONTS = {
  'material-community': '/fonts/MaterialCommunityIcons.ttf',
  feather: '/fonts/Feather.ttf',
};
const NATIVE_FONTS =
  Platform.OS === 'web'
    ? null
    : {
        ...SOHNE_NATIVE_FONTS,
        ...Ionicons.font,
        ...MaterialCommunityIcons.font,
        ...Feather.font,
      };

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
    '.cgold-home-row-inert,.cgold-home-row-inert *{pointer-events:none!important;}',
    '.cgold-home-row-inert .cgold-store-closed-hit{pointer-events:auto!important;}',
    '.cgold-home-row{cursor:pointer;background-color:transparent!important;overflow:visible!important;position:relative;}',
    '.cgold-home-row::before{content:"";position:absolute;top:0;bottom:0;left:-6px;right:8px;border-radius:6px;background:transparent;pointer-events:none;z-index:0;}',
    `.cgold-home-row:hover::before,.cgold-home-row-selected::before{background-color:${NAV_TAB_ACTIVE_BG};}`,
    '.cgold-store-tx-row{cursor:pointer;background-color:transparent!important;overflow:visible!important;position:relative;}',
    '.cgold-store-tx-row::before{content:"";position:absolute;inset:0 16px 0 26px;border-radius:6px;background:transparent;pointer-events:none;z-index:0;}',
    `.cgold-store-tx-row:hover::before{background-color:${NAV_TAB_ACTIVE_BG};}`,
    '.cgold-store-tx-row:hover .cgold-store-tx-rule,.cgold-store-tx-row:has(+ .cgold-store-tx-row:hover) .cgold-store-tx-rule{opacity:0!important;}',
    '.cgold-home-row:hover .cgold-home-row-rule,.cgold-home-row:has(+ .cgold-home-row:hover) .cgold-home-row-rule{opacity:0!important;}',
    '.cgold-home-header-row:has(+ .cgold-home-row:hover) .cgold-home-row-rule{opacity:0!important;}',
    '.cgold-home-row:hover + .cgold-home-total-row .cgold-home-row-rule{opacity:0!important;}',
    '.cgold-number-flow{font-family:Sohne,sans-serif!important;font-variant-numeric:tabular-nums;line-height:.9;}',
    '.cgold-home-live{display:inline-block;max-width:100%;vertical-align:baseline;transform:translateY(0) scale(1);transition-property:color,transform;transition-timing-function:ease-out;}',
    '.cgold-home-live-hot-up{color:#34C759!important;transform:translateY(7px) scale(1.05);transition-duration:0ms;}',
    '.cgold-home-live-hot-down{color:#FF3B30!important;transform:translateY(-7px) scale(1.05);transition-duration:0ms;}',
    '.cgold-home-live-cool{transition-duration:820ms;}',
    '.cgold-home-live-stable.cgold-home-live-hot-up{color:#34C759!important;transform:none!important;}',
    '.cgold-home-live-stable.cgold-home-live-hot-down{color:#FF3B30!important;transform:none!important;}',
    '.cgold-home-live-stable.cgold-home-live-cool{transition-property:color;}',
    '@media (prefers-reduced-motion:reduce){.cgold-home-live,.cgold-home-live-hot-up,.cgold-home-live-hot-down,.cgold-home-live-cool{transition:none!important;transform:none!important;}}',
    '.cgold-filter-option{cursor:pointer;transition:none!important;}',
    '.cgold-filter-option:hover{background-color:#f5f5f5!important;}',
    '.cgold-floating-tip{position:fixed;z-index:100000;pointer-events:none;max-width:280px;min-width:160px;padding:8px 10px;border-radius:6px;background:#1a1a1a;box-shadow:0 4px 16px rgba(0,0,0,0.18);font:12px/16px Sohne,sans-serif;color:#fff;white-space:pre-wrap;}',
    '.cgold-sidebar-item .cgold-sidebar-unpin{opacity:0;transition:opacity 120ms;}',
    '.cgold-sidebar-item:hover .cgold-sidebar-unpin,.cgold-sidebar-item:focus-within .cgold-sidebar-unpin{opacity:1;}',
    '@media (prefers-reduced-motion:reduce){#cgold-sidebar,[data-testid="cgold-sidebar"]{transition:none!important;}}',
    '.cgold-top-bar-blur{-webkit-backdrop-filter:saturate(180%) blur(22px);backdrop-filter:saturate(180%) blur(22px);background-color:rgba(252,252,251,0.72)!important;}',
    '.cgold-apps-toolbar-blur{-webkit-backdrop-filter:saturate(180%) blur(20px);backdrop-filter:saturate(180%) blur(20px);background-color:rgba(255,255,255,0.62)!important;}',
    '.cgold-home-toolbar-blur{-webkit-backdrop-filter:saturate(180%) blur(22px);backdrop-filter:saturate(180%) blur(22px);background-color:rgba(255,255,255,0.62)!important;}',
    '.cgold-home-top-blur{background:transparent!important;-webkit-backdrop-filter:saturate(140%) blur(18px);backdrop-filter:saturate(140%) blur(18px);-webkit-mask-image:linear-gradient(to bottom,#000 0%,rgba(0,0,0,0.5) 38%,transparent 100%);mask-image:linear-gradient(to bottom,#000 0%,rgba(0,0,0,0.5) 38%,transparent 100%);}',
    '.cgold-home-overlay-scroll{position:relative;z-index:4;}',
    '.cgold-home-overlay-scroll,.cgold-home-overlay-scroll>div{background:transparent!important;overscroll-behavior:none;}',
    '@media (max-width:767px){.cgold-home-overlay-scroll{-webkit-overflow-scrolling:touch;touch-action:pan-y;overflow-y:auto!important;pointer-events:auto!important;}}',
    '@media (min-width:768px){.cgold-store-overlay-scroll,.cgold-store-overlay-scroll *{pointer-events:none!important;}.cgold-store-sheet,.cgold-store-sheet *{pointer-events:auto!important;}}',
    '.cgold-home-chip-blur{-webkit-backdrop-filter:saturate(140%) blur(10px);backdrop-filter:saturate(140%) blur(10px);background-color:rgba(255,255,255,0.56)!important;border-radius:999px;}',
    '.cgold-apps-view-blur{-webkit-backdrop-filter:saturate(140%) blur(10px);backdrop-filter:saturate(140%) blur(10px);background-color:rgba(255,255,255,0.56)!important;border-radius:20px;}',
    '.cgold-app-icon .cgold-app-pin{opacity:0;transition:opacity 120ms;}',
    '.cgold-app-icon:hover .cgold-app-pin,.cgold-app-icon:focus-within .cgold-app-pin{opacity:1!important;}',
    '.cgold-store-header-blur{-webkit-backdrop-filter:saturate(160%) blur(12px);backdrop-filter:saturate(160%) blur(12px);background-color:rgba(255,255,255,0.72)!important;transform:translateZ(0);}',
    '.cgold-dm-row{cursor:pointer;}',
    '.cgold-dm-row:hover{background-color:#f5f5f7!important;}',
    '.cgold-dm-row-active,.cgold-dm-row-active:hover{background-color:#ececef!important;}',
    '@media (max-width:767px){',
    `html,body,#root{background:${CANVAS};}`,
    '.cgold-mobile-inset-top{height:max(12px,env(safe-area-inset-top,0px))!important;}',
    '.cgold-mobile-tab-bar-dock{padding-bottom:max(14px,calc(env(safe-area-inset-bottom,0px) + 10px))!important;}',
    '.cgold-mobile-tab-bar{-webkit-backdrop-filter:saturate(120%) blur(12px);backdrop-filter:saturate(120%) blur(12px);background-color:rgba(252,252,251,0.92)!important;border-radius:999px;}',
    '.cgold-mobile-tab-active{background-color:#f5f5f5!important;border-radius:999px;-webkit-backdrop-filter:none;backdrop-filter:none;}',
    '.cgold-mobile-filter-blur{background-color:#fff!important;}',
    '.cgold-mobile-chrome-blur{-webkit-backdrop-filter:saturate(180%) blur(22px);backdrop-filter:saturate(180%) blur(22px);background-color:rgba(242,242,247,0.72)!important;}',
    '.cgold-mobile-sheet-top{padding-top:max(18px,env(safe-area-inset-top,0px))!important;}',
    '.cgold-pin-button{opacity:1!important;pointer-events:auto!important;}',
    'input,textarea,button,select{-webkit-tap-highlight-color:transparent;}',
    '}',
  ].join('');
}

const TX_ROW_HEIGHT = 44;

/** `/c/<token>` opens the standalone photo-capture page. The path never changes after load. */
const CAPTURE_TOKEN = captureTokenFromLocation();

const fontFamily = FONT;
const titleFontFamily = FONT_LIGHT;

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

const APP_GRID_MAX_WIDTH = 880;
const APP_COLUMNS = 6;
const APP_COLUMNS_MOBILE = 4;
const APP_ICON_SIZE = 64;
const APP_GAP = 18;
const MOBILE_APP_GAP = 12;
const MOBILE_APP_ICON_MAX = 84;
const MOBILE_APP_ICON_SCALE = 0.94;
const MOBILE_BREAKPOINT = 768;

function useIsMobile() {
  const { width } = useWindowDimensions();
  return width < MOBILE_BREAKPOINT;
}

const HOME_PAGE_MAX_WIDTH = 1480;
const HOME_TABLE_MAX_WIDTH = 1980;
/** Extra left inset on desktop so search / hero / table sit slightly right of viewport center. */
const HOME_DESKTOP_LEADING_NUDGE = 28;
const HOME_STORE_ROW_PAD = 8;
const HOME_STORE_ICON_COL_WIDTH = 56;
const HOME_STORE_BODY_LEADING = 12;
const HOME_STORE_NAME_INSET = 42;

function useHomePageLayout() {
  const { width } = useWindowDimensions();
  const isMobile = width < MOBILE_BREAKPOINT;
  if (isMobile) {
    return {
      isMobile: true,
      contentMaxWidth: undefined,
      tableMaxWidth: undefined,
      homeSearchMaxWidth: undefined,
      pagePad: MOBILE_FILTER_INSET,
      tablePagePad: MOBILE_FILTER_INSET,
    };
  }
  const pagePad = width >= 1600 ? 24 : width >= 1200 ? 20 : 16;
  const tablePagePad = width >= 1600 ? 8 : width >= 1200 ? 6 : 4;
  const contentMaxWidth = Math.min(HOME_PAGE_MAX_WIDTH, Math.max(720, width - pagePad * 2));
  const tableMaxWidth = Math.min(
    HOME_TABLE_MAX_WIDTH,
    Math.max(1000, width - tablePagePad * 2),
  );
  const searchLayoutCap = width < 1240 ? 740 : 880;
  const homeSearchMaxWidth = Math.min(560, Math.max(340, Math.round(searchLayoutCap * 0.62)));
  return {
    isMobile: false,
    contentMaxWidth,
    tableMaxWidth,
    homeSearchMaxWidth,
    pagePad,
    tablePagePad,
  };
}

function filledIonicon(name) {
  return typeof name === 'string' && name.endsWith('-outline') ? name.slice(0, -8) : name;
}

const TAB_INK = '#1a1a1a';
const TAB_BORDER = '#d0d0d0';
const TAB_ICON_SIZE = 17;
const TOP_BAR_HEIGHT = DESKTOP_TOP_BAR_HEIGHT;
const SIDEBAR_EXPANDED_WIDTH = 252;
const SIDEBAR_COLLAPSED_WIDTH = 72;
const SIDEBAR_EXPANDED_PAD = 16;
const SIDEBAR_COLLAPSED_PAD = 10;
const SIDEBAR_TAB_ICON_SLOT = 26;
const SIDEBAR_TAB_GUTTER = 10;
const SIDEBAR_TAB_GUTTER_COLLAPSED = 6;
const SIDEBAR_TAB_ACTIVE_RADIUS = 6;
const SIDEBAR_TAB_INNER_PAD = SIDEBAR_EXPANDED_PAD - SIDEBAR_TAB_GUTTER;
const SIDEBAR_ANIM_MS = 280;
const SIDEBAR_COMPACT_DELAY_MS = 170;
const SIDEBAR_EASE = Easing.bezier(0.32, 0.72, 0, 1);

function prefersReducedMotion() {
  return (
    Platform.OS === 'web' &&
    typeof window !== 'undefined' &&
    !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
  );
}

function sidebarTabClassName(_active, extra) {
  if (Platform.OS !== 'web') return extra || undefined;
  return extra || undefined;
}

const MAIN_TABS = [
  { key: 'home', label: 'Home', icon: 'home-outline' },
  { key: 'search', label: 'Search', icon: 'search-outline' },
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
};
const TRADE_SELL = {
  accent: '#C0392B',
  icon: 'arrow-up-circle-outline',
};

const PROFILE_TAB = { key: 'profile', label: 'Profile', icon: 'person-outline' };

const MOBILE_TABS = [
  { key: 'home', label: 'Home', icon: 'home-outline', iconActive: 'home' },
  { key: 'search', label: 'Search', icon: 'search-outline', iconActive: 'search' },
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
  'reviews',
  'audit',
  'triage',
  'supplies',
  'settings',
];

const STORE_SNAPSHOT_TABS = new Set([
  'overview',
  'transactions',
  'inventory',
  'financials',
  'employees',
  'phone',
  'emails',
  'supplies',
]);

const STORE_DRAWER_TABS = STORE_DRAWER_TAB_KEYS.map((key) =>
  TOOL_CARDS.find((tool) => tool.key === key),
).filter(Boolean);

const TRANSACTION_DETAIL_TAB_KEYS = ['triage', 'serphint'];

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
const HOME_PEOPLE_SIZE = 36;
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

function salesPurchasesTip(row, money) {
  const format = typeof money === 'function' ? money : formatAmount;
  return `Sales  ${format(row?.soAmount)}\nPurchases  ${format(row?.poAmount)}`;
}

function homeAmountForFocus(row, focus) {
  if (focus === 'sales') {
    return { amount: Number(row?.soAmount) || 0, count: Number(row?.saleCount) || 0 };
  }
  if (focus === 'purchases') {
    return { amount: Number(row?.poAmount) || 0, count: Number(row?.purchaseCount) || 0 };
  }
  return { amount: Number(row?.totalAmount) || 0, count: Number(row?.txCount) || 0 };
}

function homeCountLabel(count, focus) {
  if (focus === 'sales') return count === 1 ? '1 sale' : `${count} sales`;
  if (focus === 'purchases') return count === 1 ? '1 purchase' : `${count} purchases`;
  return count === 1 ? '1 tx' : `${count} tx`;
}

function sortRowsForHeroFocus(rows, focus) {
  if (focus === 'all' || !rows?.length) return rows;
  return [...rows].sort((a, b) => {
    const av = homeAmountForFocus(a, focus);
    const bv = homeAmountForFocus(b, focus);
    if (bv.amount !== av.amount) return bv.amount - av.amount;
    if (bv.count !== av.count) return bv.count - av.count;
    return String(a.store || '').localeCompare(String(b.store || ''), undefined, { sensitivity: 'base' });
  });
}

function HomeHeroStat({
  value,
  label,
  selected = false,
  onPress,
  numeric,
  format,
  compact = false,
  interactive = true,
  reel = false,
}) {
  const valueStyle = [
    compact ? styles.igHomeHeroStatValueCompact : styles.igHomeHeroStatValue,
    selected &&
      (compact ? styles.igHomeHeroStatValueCompactSelected : styles.igHomeHeroStatValueSelected),
  ];
  const valueNode = reel ? (
    <HomeReelValue style={valueStyle} value={numeric ?? value} kind="count" />
  ) : numeric != null ? (
    <HomeLiveValue style={valueStyle} numeric={numeric} format={format}>
      {value}
    </HomeLiveValue>
  ) : (
    <Text style={valueStyle}>{value}</Text>
  );

  const compactBody = (
    <>
      <Text
        style={[styles.igHomeHeroStatLabelCompact, selected && styles.igHomeHeroStatLabelCompactSelected]}
        numberOfLines={1}
      >
        {label}
      </Text>
      {value === '' && numeric == null ? null : valueNode}
    </>
  );

  if (compact) {
    if (!interactive) {
      return <View style={styles.igHomeHeroStatCompact}>{compactBody}</View>;
    }
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [
          styles.igHomeHeroStatCompact,
          selected && styles.igHomeHeroStatCompactSelected,
          pressed && styles.igHomeHeroStatPressed,
        ]}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        accessibilityLabel={label}
      >
        {compactBody}
      </Pressable>
    );
  }

  const body = (
    <>
      <Text style={[styles.igHomeHeroStatLabel, selected && styles.igHomeHeroStatLabelSelected]}>{label}</Text>
      {valueNode}
    </>
  );

  if (!interactive) {
    return <View style={styles.igHomeHeroStat}>{body}</View>;
  }

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.igHomeHeroStat,
        selected && styles.igHomeHeroStatSelected,
        pressed && styles.igHomeHeroStatPressed,
      ]}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
    >
      {body}
    </Pressable>
  );
}

function rowMatchesAllocatedStore(row, storeName) {
  const store = String(row?.storeName || row?.store || '').trim();
  const location = String(storeName || '').trim();
  if (!store || !location) return false;
  if (storesMatch(store, location)) return true;
  const a = store.toLowerCase();
  const b = location.toLowerCase();
  return a.includes(b) || b.includes(a);
}

function ProfileAvatar({ uri, name, size = 24, style, showClock = true, clockMark = 'ring' }) {
  const [failed, setFailed] = useState(false);
  const clockedIn = useIsClockedIn(name);
  const ringClock = showClock && clockedIn && clockMark === 'ring';

  useEffect(() => {
    setFailed(false);
  }, [uri]);

  const initials = initialsFromName(name);
  const showImage = Boolean(uri) && !failed;

  const face = (
      <View
        accessibilityLabel={ringClock ? undefined : name || 'Profile'}
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
          ringClock ? { borderWidth: 0 } : null,
        ]}
      >
        {showImage ? (
          <Image
            source={{ uri }}
            style={{ width: size, height: size, borderRadius: size / 2 }}
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

  if (!showClock) return face;
  return (
    <ClockedInMark name={name} size={size} variant={clockMark}>
      {face}
    </ClockedInMark>
  );
}

function useAppGridLayout() {
  const { width } = useWindowDimensions();
  const isMobile = width < MOBILE_BREAKPOINT;
  if (isMobile) {
    const gap = MOBILE_APP_GAP;
    const pagePad = MOBILE_FILTER_INSET;
    const gridWidth = Math.max(0, width - pagePad * 2);
    const cell = (gridWidth - gap * (APP_COLUMNS_MOBILE - 1)) / APP_COLUMNS_MOBILE;
    const iconSize = Math.floor(
      Math.min(MOBILE_APP_ICON_MAX, Math.max(56, cell)) * MOBILE_APP_ICON_SCALE,
    );
    return {
      isMobile: true,
      columns: APP_COLUMNS_MOBILE,
      iconSize,
      radius: Math.round(iconSize * 0.223),
      glyph: Math.round(iconSize * 0.44),
      gap,
      rowGap: 24,
      maxWidth: undefined,
      labelBleed: gap / 2,
    };
  }
  if (width < 1240) {
    const iconSize = 52;
    const gap = 14;
    return {
      isMobile: false,
      columns: 5,
      iconSize,
      radius: Math.round(iconSize * 0.223),
      glyph: Math.round(iconSize * 0.44),
      gap,
      rowGap: 22,
      maxWidth: 740,
      labelBleed: gap / 2,
    };
  }
  const iconSize = APP_ICON_SIZE;
  const gap = APP_GAP;
  return {
    isMobile: false,
    columns: APP_COLUMNS,
    iconSize,
    radius: Math.round(iconSize * 0.223),
    glyph: Math.round(iconSize * 0.44),
    gap,
    rowGap: 26,
    maxWidth: APP_GRID_MAX_WIDTH,
    labelBleed: gap / 2,
  };
}

function ToolCard({ tool, pinned, onPress, onTogglePin, layout, wrapStyle }) {
  const { iconSize, radius, glyph, isMobile, labelBleed } = layout;

  return (
    <View
      style={[styles.toolCardWrap, wrapStyle]}
      {...(Platform.OS === 'web' ? { className: 'cgold-app-icon' } : null)}
    >
      <Pressable
        onPress={onPress}
        onLongPress={onTogglePin}
        delayLongPress={420}
        style={({ pressed }) => [
          styles.toolCard,
          isMobile && styles.toolCardMobile,
          pressed && styles.toolCardPressed,
        ]}
        accessibilityRole="button"
        accessibilityLabel={tool.label}
      >
        <View style={styles.toolIconStack}>
          <View
            style={[
              styles.appsGridIcon,
              {
                width: iconSize,
                height: iconSize,
                borderRadius: radius,
                backgroundColor: tool.accent,
              },
            ]}
          >
            <Ionicons name={filledIonicon(tool.icon)} size={glyph} color="#fff" />
          </View>
          <Pressable
            style={[
              styles.appsGridPin,
              pinned && styles.appsGridPinActive,
            ]}
            {...(Platform.OS === 'web' ? { className: 'cgold-app-pin' } : null)}
            onPress={(event) => {
              event?.stopPropagation?.();
              onTogglePin();
            }}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={pinned ? `Unpin ${tool.label}` : `Pin ${tool.label}`}
          >
            <Ionicons
              name={pinned ? 'pin' : 'pin-outline'}
              size={13}
              color={pinned ? TAB_INK : MOBILE.secondary}
            />
          </Pressable>
        </View>
        <Text
          style={[
            styles.appsGridLabel,
            isMobile && styles.toolCardLabelMobile,
            pinned && styles.appsGridLabelPinned,
            labelBleed
              ? { marginHorizontal: -labelBleed, alignSelf: 'stretch' }
              : null,
          ]}
          numberOfLines={2}
          ellipsizeMode="tail"
          selectable={false}
        >
          {tool.label}
        </Text>
      </Pressable>
    </View>
  );
}

function ToolsGrid({ tools, pinnedKeys, onOpen, onTogglePin, layout }) {
  const { columns, gap, rowGap } = layout;
  const wrapStyle = {
    width: `${100 / columns}%`,
    maxWidth: `${100 / columns}%`,
    flexBasis: `${100 / columns}%`,
    flexGrow: 0,
    flexShrink: 0,
    paddingHorizontal: gap / 2,
    ...Platform.select({
      web: { minWidth: 0, boxSizing: 'border-box' },
      default: {},
    }),
  };

  return (
    <View
      style={[
        styles.toolsGrid,
        { marginHorizontal: -(gap / 2), rowGap },
        Platform.OS === 'web'
          ? {
              display: 'grid',
              gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
              justifyItems: 'center',
            }
          : null,
      ]}
    >
      {tools.map((tool) => (
        <ToolCard
          key={tool.key}
          tool={tool}
          pinned={pinnedKeys.includes(tool.key)}
          onPress={() => onOpen(tool)}
          onTogglePin={() => onTogglePin(tool.key)}
          layout={layout}
          wrapStyle={wrapStyle}
        />
      ))}
    </View>
  );
}

function ToolListRow({ tool, pinned, onPress, onTogglePin, last, compact = false }) {
  const iconSize = compact ? 46 : 28;
  const radius = compact ? 13 : 7;
  const glyphSize = compact ? 22 : 15;
  const pinControl = (
    <Pressable
      style={compact ? styles.toolListPin : styles.appsRowPin}
      onPress={(event) => {
        event?.stopPropagation?.();
        onTogglePin();
      }}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={pinned ? `Unpin ${tool.label}` : `Pin ${tool.label}`}
    >
      <Ionicons
        name={pinned ? 'pin' : 'pin-outline'}
        size={compact ? 18 : 16}
        color={pinned ? TAB_INK : '#C7C7CC'}
      />
    </Pressable>
  );

  if (compact) {
    return (
      <Pressable
        onPress={onPress}
        style={({ hovered, pressed }) => [
          styles.igStoreCard,
          (hovered || pressed) && styles.igStoreCardPressed,
        ]}
        accessibilityRole="button"
        accessibilityLabel={tool.label}
      >
        <View
          style={[
            styles.igStoreIcon,
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
        <View style={[styles.igStoreBody, !last && styles.igStoreBodyDivider]}>
          <View style={styles.igStoreBodyMain}>
            <View style={styles.igStoreCopy}>
              <Text style={styles.igStoreName} numberOfLines={1} selectable={false}>
                {tool.label}
              </Text>
              <Text style={styles.igStoreMeta} numberOfLines={1}>
                {pinned ? 'Pinned' : 'App'}
              </Text>
            </View>
            {pinControl}
            <Ionicons name="chevron-forward" size={18} color="#c7c7cc" style={styles.igStoreChevron} />
          </View>
        </View>
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      style={({ hovered, pressed }) => [
        styles.homeStoreRow,
        (hovered || pressed) && styles.homeStoreRowHovered,
      ]}
      accessibilityRole="button"
      accessibilityLabel={tool.label}
    >
      <View style={styles.homeStoreIconWrap}>
        <View style={[styles.homeStoreIconTile, { backgroundColor: tool.accent }]}>
          <Ionicons name={filledIonicon(tool.icon)} size={glyphSize} color="#fff" />
        </View>
      </View>
      <View style={[styles.homeStoreRowBody, !last && styles.homeStoreRowDivider]}>
        <View style={styles.homeStoreColStore}>
          <Text style={styles.homeStoreName} numberOfLines={1} selectable={false}>
            {tool.label}
          </Text>
          <Text style={styles.homeStoreMeta} numberOfLines={1}>
            {pinned ? 'Pinned to sidebar' : 'Available'}
          </Text>
        </View>
        <View style={styles.appsRowStatus}>
          <Text
            style={[styles.homeStoreMeta, pinned && styles.appsRowStatusPinned]}
            numberOfLines={1}
          >
            {pinned ? 'Pinned' : ''}
          </Text>
        </View>
        {pinControl}
        <View style={styles.homeStoreChevron}>
          <Ionicons name="chevron-forward" size={18} color="#c7c7cc" />
        </View>
      </View>
    </Pressable>
  );
}

function ToolsList({ tools, pinnedKeys, onOpen, onTogglePin, compact = false }) {
  if (compact) {
    return (
      <View style={styles.igStoreList}>
        {tools.map((tool, index) => (
          <ToolListRow
            key={tool.key}
            tool={tool}
            pinned={pinnedKeys.includes(tool.key)}
            onPress={() => onOpen(tool)}
            onTogglePin={() => onTogglePin(tool.key)}
            last={index === tools.length - 1}
            compact
          />
        ))}
      </View>
    );
  }

  return (
    <View style={styles.homeStoreTableCard}>
      <View style={[styles.homeStoreRow, styles.homeStoreHeaderRow]}>
        <View style={styles.homeStoreIconSpacer} />
        <View style={[styles.homeStoreRowBody, styles.homeStoreHeaderRule]}>
          <Text style={[styles.homeStoreHeader, styles.homeStoreColStore]}>App</Text>
          <Text style={[styles.homeStoreHeader, styles.appsRowStatus]}>Status</Text>
          <View style={styles.appsRowPinSpacer} />
          <View style={styles.homeStoreChevron} />
        </View>
      </View>
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

function AppsViewToggle({ appsView, onSelectView, sheet = false, compact = false }) {
  return (
    <View
      style={[
        styles.appsViewToggle,
        sheet && styles.appsViewToggleSheet,
        compact && styles.appsViewToggleCompact,
      ]}
      accessibilityRole="tablist"
    >
      {[
        { key: 'list', icon: 'list', label: 'List' },
        { key: 'grid', icon: 'grid', label: 'Grid' },
      ].map((option) => {
        const selected = appsView === option.key;
        return (
          <Pressable
            key={option.key}
            style={[
              styles.appsViewToggleButton,
              sheet && styles.appsViewToggleButtonSheet,
              compact && styles.appsViewToggleButtonCompact,
              selected && styles.appsViewToggleButtonActive,
            ]}
            onPress={() => onSelectView(option.key)}
            accessibilityRole="tab"
            accessibilityLabel={option.label}
            accessibilityState={{ selected }}
          >
            <Ionicons name={option.icon} size={16} color={selected ? TAB_INK : MOBILE.secondary} />
          </Pressable>
        );
      })}
    </View>
  );
}

function AppsLibrary({
  tools,
  pinnedKeys,
  appsView,
  query,
  onQueryChange,
  onSelectView,
  onOpen,
  onTogglePin,
  appGrid,
}) {
  const { isMobile, pagePad, contentMaxWidth } = useHomePageLayout();
  const tabBarScroll = useMobileTabBarScrollProps();
  const searching = Boolean(query.trim());
  const emptyCopy = searching
    ? `No apps match “${query.trim()}”.`
    : 'No apps are available.';

  const viewToggle = (
    <AppsViewToggle
      appsView={appsView}
      onSelectView={onSelectView}
      sheet={isMobile}
      compact={isMobile}
    />
  );

  const searchField = isMobile ? (
    <View style={styles.igHomeMobileAppsSearch}>
      <Ionicons name="search" size={15} color={MOBILE.secondary} />
      <TextInput
        style={styles.igHomeMobileAppsSearchInput}
        value={query}
        onChangeText={onQueryChange}
        placeholder="Search apps"
        placeholderTextColor={MOBILE.secondary}
        autoCapitalize="none"
        autoCorrect={false}
        clearButtonMode="while-editing"
        returnKeyType="search"
      />
      {query ? (
        <Pressable onPress={() => onQueryChange('')} hitSlop={8} accessibilityLabel="Clear search">
          <Ionicons name="close-circle" size={16} color="#c7c7cc" />
        </Pressable>
      ) : null}
    </View>
  ) : (
    <View style={[styles.igHomeChromeChip, styles.igHomeChromeSearchDesktop, styles.appsChromeSearch]}>
      <BlurView
        intensity={32}
        tint="light"
        style={styles.igHomeChromeSearch}
        {...(Platform.OS === 'web' ? { className: 'cgold-home-chip-blur' } : null)}
      >
        <Ionicons name="search" size={16} color={MOBILE.secondary} />
        <TextInput
          style={styles.igHomeChromeSearchInput}
          value={query}
          onChangeText={onQueryChange}
          placeholder="Search apps"
          placeholderTextColor={MOBILE.secondary}
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
          returnKeyType="search"
        />
        {query ? (
          <Pressable onPress={() => onQueryChange('')} hitSlop={8} accessibilityLabel="Clear search">
            <Ionicons name="close-circle" size={18} color="#c7c7cc" />
          </Pressable>
        ) : null}
      </BlurView>
    </View>
  );

  const appsBody =
    tools.length === 0 ? (
      <Text style={[styles.toolsEmpty, isMobile ? { paddingTop: 20 } : { paddingTop: 28 }]}>
        {emptyCopy}
      </Text>
    ) : appsView === 'grid' ? (
      <View
        style={[
          styles.toolsSection,
          styles.toolsSectionMobile,
          isMobile && { marginTop: 0, maxWidth: '100%' },
          !isMobile && appGrid.maxWidth ? { maxWidth: appGrid.maxWidth } : null,
        ]}
      >
        <ToolsGrid
          tools={tools}
          pinnedKeys={pinnedKeys}
          onOpen={onOpen}
          onTogglePin={onTogglePin}
          layout={appGrid}
        />
      </View>
    ) : (
      <ToolsList
        tools={tools}
        pinnedKeys={pinnedKeys}
        onOpen={onOpen}
        onTogglePin={onTogglePin}
        compact={isMobile}
      />
    );

  return (
    <View
      style={[
        styles.toolsScreen,
        styles.canvasFill,
        styles.igHomeScreen,
        !isMobile && styles.igHomeDesktopHost,
      ]}
    >
      <View
        style={[
          styles.toolsScreen,
          styles.canvasFill,
          styles.igHomeScreen,
          !isMobile && styles.igHomeDesktopFeed,
        ]}
      >
        {isMobile ? (
          <View pointerEvents="box-none" style={styles.igHomeMobileTopBarShell}>
            <View style={styles.igHomeMobileTopBarClip}>
              <BlurView
                intensity={32}
                tint="light"
                pointerEvents="none"
                style={styles.igHomeMobileTopBarBlur}
                {...(Platform.OS === 'web' ? { className: 'cgold-mobile-tab-bar' } : null)}
              />
              <View style={styles.igHomeMobileTopBarRow}>
                <View style={styles.igHomeMobileBrand} accessibilityLabel="Canada Gold">
                  <HomeGlyph size={22} />
                </View>
                <View style={styles.igHomeMobileTopBarTrailing}>
                  {searchField}
                  {viewToggle}
                </View>
              </View>
            </View>
          </View>
        ) : (
          <View
            pointerEvents="box-none"
            style={[styles.igHomeChromeRow, styles.igHomeChromeRowDesktop, styles.appsChromeRow]}
          >
            <View style={styles.appsViewChrome}>
              <BlurView
                intensity={32}
                tint="light"
                style={styles.appsViewChromeBlur}
                {...(Platform.OS === 'web' ? { className: 'cgold-apps-view-blur' } : null)}
              >
                <AppsViewToggle appsView={appsView} onSelectView={onSelectView} />
              </BlurView>
            </View>
            {searchField}
          </View>
        )}
        <View style={styles.igHomeStage}>
          <ScrollView
            style={[styles.toolsScroll, styles.igHomeOverlayScroll]}
            contentContainerStyle={[
              styles.igHomeScroll,
              styles.igHomeScrollContent,
              {
                flexGrow: 1,
                paddingTop: isMobile ? MOBILE_FEED_TOP_BAR_HEIGHT : TOP_BAR_HEIGHT + 28,
                paddingBottom: isMobile ? mobileTabBarReserve() + 24 : 36,
              },
            ]}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            bounces={false}
            overScrollMode="never"
            {...tabBarScroll}
            {...(Platform.OS === 'web' ? { className: 'cgold-home-overlay-scroll' } : null)}
          >
            <View
              style={[
                styles.igHomeContentInset,
                isMobile
                  ? { paddingHorizontal: pagePad, width: '100%' }
                  : {
                      paddingLeft: pagePad,
                      paddingRight: pagePad,
                      width: '100%',
                      ...(contentMaxWidth ? { maxWidth: contentMaxWidth } : null),
                    },
              ]}
            >
              {appsBody}
            </View>
          </ScrollView>
        </View>
      </View>
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
              color: '#1a1a1a',
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

function FloatingTooltip({ visible, text, anchorEl, align = 'start', placement = 'bottom', compact = false }) {
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
      : placement === 'right'
        ? {
            top: coords.y + coords.height / 2,
            left: coords.x + coords.width + 10,
            transform: 'translateY(-50%)',
            minWidth: 'auto',
            whiteSpace: 'nowrap',
          }
      : {
          top: coords.y + coords.height + 4,
          ...(align === 'end'
            ? { right: Math.max(8, window.innerWidth - (coords.x + coords.width)) }
            : align === 'center'
              ? {
                  left: coords.x + coords.width / 2,
                  transform: 'translateX(-50%)',
                }
              : { left: Math.max(8, coords.x) }),
          ...(compact || align === 'center' ? { minWidth: 'auto', whiteSpace: 'nowrap' } : {}),
        };

  return createPortal(
    createElement('div', { className: 'cgold-floating-tip', style }, text),
    document.body,
  );
}

function StoreAppsRailItem({ tab, selected, onPress }) {
  const [anchor, setAnchor] = useState(null);
  return (
    <>
      <Pressable
        onPress={onPress}
        onHoverIn={(event) => setAnchor(event?.currentTarget || null)}
        onHoverOut={() => setAnchor(null)}
        style={({ hovered, pressed }) => [
          styles.storeRailTab,
          (hovered || pressed) && !selected && styles.tabHover,
          selected && styles.tabActive,
        ]}
        accessibilityLabel={tab.label}
        accessibilityRole="button"
        accessibilityState={{ selected }}
      >
        <Ionicons
          name={selected ? filledIonicon(tab.icon) : tab.icon}
          size={TAB_ICON_SIZE}
          color={selected ? NAV_ICON_ACTIVE : NAV_ICON_INACTIVE}
        />
      </Pressable>
      <FloatingTooltip
        visible={Boolean(anchor)}
        text={tab.label}
        anchorEl={anchor}
        placement="right"
        compact
      />
    </>
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

function useUpSheetAnimation(visible, sheetHeight) {
  const [mounted, setMounted] = useState(visible);
  const slide = useRef(new Animated.Value(sheetHeight)).current;
  const sheetHeightRef = useRef(sheetHeight);
  const activeAnim = useRef(null);
  sheetHeightRef.current = sheetHeight;

  const stopActiveAnim = () => {
    if (activeAnim.current) {
      activeAnim.current.stop();
      activeAnim.current = null;
    }
  };

  useEffect(() => {
    if (!mounted) slide.setValue(sheetHeight);
  }, [sheetHeight, mounted, slide]);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      return undefined;
    }
    if (!mounted) return undefined;
    stopActiveAnim();
    const anim = Animated.timing(slide, {
      toValue: sheetHeightRef.current,
      duration: DRAWER_CLOSE_MS,
      easing: Easing.bezier(0.4, 0, 0.2, 1),
      useNativeDriver: true,
    });
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
  }, [visible, mounted, slide]);

  useLayoutEffect(() => {
    if (!visible || !mounted) return undefined;
    stopActiveAnim();
    slide.setValue(sheetHeightRef.current);
    let cancelled = false;
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        if (cancelled) return;
        const anim = Animated.timing(slide, {
          toValue: 0,
          duration: DRAWER_OPEN_MS,
          easing: Easing.bezier(0.2, 0.8, 0.2, 1),
          useNativeDriver: true,
        });
        activeAnim.current = anim;
        anim.start(({ finished }) => {
          if (finished && activeAnim.current === anim) activeAnim.current = null;
        });
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [visible, mounted, slide]);

  return { mounted, slide };
}

function useHeldValue(value) {
  const held = useRef(value);
  if (value != null) held.current = value;
  return value ?? held.current;
}

function BuyTicketRow({ label, value, sub, last = false }) {
  return (
    <View style={[styles.buyTxField, last && styles.buyTxFieldLast]}>
      <Text style={styles.buyTxFieldLabel}>{label}</Text>
      <View style={styles.buyTxFieldValueWrap}>
        <Text style={styles.buyTxFieldValue} numberOfLines={2}>
          {value || '—'}
        </Text>
        {sub ? (
          <Text style={styles.buyTxFieldSub} numberOfLines={2}>
            {sub}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function TransactionTicketBody({
  summary,
  detail,
  loading = false,
  error = '',
  onClose,
  embedded = false,
  scrollProps = null,
  part = 'all',
}) {
  const client = detail?.client;
  const clientName = client
    ? [client.first_name, client.last_name].filter(Boolean).join(' ').trim()
    : summary?.customerName;
  const location = detail?.location;
  const locationName = location?.name || summary?.storeName;
  const locationLine = location
    ? [location.address_1, location.city, location.state, location.zip].filter(Boolean).join(', ')
    : null;
  const items = Array.isArray(detail?.items) ? detail.items : [];
  const payments = Array.isArray(detail?.payments) ? detail.payments : [];
  const totalAmount = detail?.total_amount ?? summary?.amount;
  const isPurchase = summary?.type === 'purchase';
  const docLabel = isPurchase ? 'Purchase order' : 'Sales invoice';
  const docKind = isPurchase ? 'PO' : 'SO';
  const allocation = detail ? allocationState(detail) : null;
  const delivery = detail ? documentDeliveryState(detail, items) : null;
  const paymentStatus = String(detail?.payment_status || '').trim();
  const occurred = [summary?.dateLabel, summary?.timeLabel].filter(Boolean).join(' · ');
  const paymentLabel =
    summary?.paymentBreakdownLabel || summary?.paymentMethodLabel || paymentStatus || '—';

  const header = embedded ? (
    <Pressable
      onPress={onClose}
      style={styles.buyTxEmbedHead}
      accessibilityRole="button"
      accessibilityLabel="Back"
    >
      <Ionicons name="chevron-back" size={28} color="#007AFF" />
      <View style={styles.buyTxEmbedTitles}>
        <Text style={styles.buyTxEmbedTitle} numberOfLines={1}>
          {summary?.reference || docKind}
        </Text>
        <Text style={styles.buyTxEmbedSub} numberOfLines={1}>
          {clientName || docLabel}
        </Text>
      </View>
    </Pressable>
  ) : null;

  const body = (
    <>
        <View style={styles.buyTxCard}>
          <View style={styles.buyTxTotalsRow}>
            <Text style={styles.buyTxTotalsLabel}>{docKind}</Text>
            <Text style={styles.buyTxTotalsAmount}>{summary?.reference || '—'}</Text>
          </View>
          <View style={[styles.buyTxTotalsRow, styles.buyTxTotalsGrand]}>
            <Text style={styles.buyTxTotalsGrandLabel}>Total</Text>
            <Text style={styles.buyTxTotalsGrandAmount}>{formatAmount(totalAmount)}</Text>
          </View>
        </View>

        <View style={styles.buyTxCard}>
          <BuyTicketRow label="Customer" value={clientName} sub={client?.email || client?.phone} />
          <BuyTicketRow label="Type" value={docLabel} />
          <BuyTicketRow
            label="Status"
            value={[allocation?.label, delivery?.label, paymentStatus].filter(Boolean).join(' · ') || 'On file'}
          />
          <BuyTicketRow label="Store" value={locationName} sub={locationLine} />
          <BuyTicketRow label="Employee" value={summary?.employeeName} />
          <BuyTicketRow label="Payment" value={paymentLabel} />
          <BuyTicketRow label="Date" value={occurred || '—'} last />
        </View>

        <Text style={styles.buyTxSection}>Items</Text>
        <View style={styles.buyTxCard}>
          {loading ? (
            <View style={styles.buyTxLoading}>
              <ActivityIndicator color="#1F8A4E" />
            </View>
          ) : error ? (
            <Text style={styles.buyTxEmpty}>{error}</Text>
          ) : items.length === 0 ? (
            <Text style={styles.buyTxEmpty}>No line items</Text>
          ) : (
            items.map((item, index) => {
              const name = lineItemName(item);
              const meta = lineItemMeta(item);
              const images = lineItemImages(item);
              const money = lineItemMoney(item);
              const unitType = item?.unit_type || (money.grossQuantity ? 'g' : '');
              return (
                <View
                  key={item.id || `${name}-${index}`}
                  style={[
                    styles.buyTxItemRow,
                    index === items.length - 1 && !detail?.total_charges && styles.buyTxItemRowLast,
                  ]}
                >
                  <LineItemThumb urls={images} name={name} />
                  <View style={styles.buyTxItemCopy}>
                    <Text style={styles.buyTxItemName} numberOfLines={2}>
                      {name}
                    </Text>
                    {meta ? (
                      <Text style={styles.buyTxItemMeta} numberOfLines={1}>
                        {meta}
                      </Text>
                    ) : null}
                    <Text style={styles.buyTxItemAmount}>{formatAmount(money.lineTotal)}</Text>
                  </View>
                  <View style={styles.buyTxItemQty}>
                    <Text style={styles.buyTxItemQtyValue}>{formatLineQty(lineDeliveryState(item).ordered)}</Text>
                    <Text style={styles.buyTxItemQtyUnit}>{formatUnitCost(money.displayUnitPrice, unitType)}</Text>
                  </View>
                </View>
              );
            })
          )}
          {detail?.total_charges ? (
            <View style={styles.buyTxItemRow}>
              <Text style={styles.buyTxItemMeta}>Charges</Text>
              <Text style={styles.buyTxItemAmount}>{formatAmount(detail.total_charges)}</Text>
            </View>
          ) : null}
        </View>

        {!loading && payments.length > 0 ? (
          <>
            <Text style={styles.buyTxSection}>Payments</Text>
            <View style={styles.buyTxCard}>
              {payments.map((entry, index) => {
                const payment = entry.payment || entry;
                const method =
                  payment.payment_type?.name || entry.payment?.payment_type?.name || 'Payment';
                return (
                  <BuyTicketRow
                    key={entry.id || payment.id || `${method}-${index}`}
                    label={method}
                    value={formatAmount(entry.amount ?? payment.amount)}
                    sub={[payment.status, payment.date].filter(Boolean).join(' · ')}
                    last={index === payments.length - 1}
                  />
                );
              })}
            </View>
          </>
        ) : null}

        {detail?.comments ? (
          <>
            <Text style={styles.buyTxSection}>Notes</Text>
            <View style={styles.buyTxCard}>
              <Text style={styles.buyTxNotes}>{detail.comments}</Text>
            </View>
          </>
        ) : null}
    </>
  );

  if (part === 'header') return header;
  if (part === 'body') return body;

  return (
    <View style={embedded ? styles.buyTxEmbed : styles.buyTxSheet}>
      {header}
      <ScrollView
        style={styles.buyTxScroll}
        contentContainerStyle={styles.buyTxScrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        nestedScrollEnabled
        {...(scrollProps || null)}
      >
        {body}
      </ScrollView>
    </View>
  );
}

function TransactionDetailDrawer({
  visible,
  summary,
  detail,
  loading,
  error,
  onClose,
  fromRight = false,
}) {
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  const isMobile = windowWidth < MOBILE_BREAKPOINT;
  const [activeApp, setActiveApp] = useState(null);
  const { hasApp } = useAppAccess();
  const visibleTabs = TRANSACTION_DETAIL_TABS.filter((tab) => hasApp(tab.key));
  const showRail = !isMobile && visibleTabs.length > 0;
  const railWidth = showRail ? STORE_DRAWER_RAIL_WIDTH : 0;
  const panelWidth = isMobile
    ? windowWidth
    : Math.min(
        Math.max(Math.round(windowWidth * 0.82), 640),
        Math.round(windowWidth - 56),
      );
  const pushRight = isMobile && fromRight;
  const slideDistance = pushRight ? windowWidth : panelWidth + railWidth;
  const sideAnim = useRightDrawerAnimation((!isMobile || pushRight) && visible, slideDistance);
  const upAnim = useUpSheetAnimation(isMobile && !pushRight && visible, windowHeight);
  const mounted = isMobile && !pushRight ? upAnim.mounted : sideAnim.mounted;
  const slide = isMobile && !pushRight ? upAnim.slide : sideAnim.slide;
  const backdrop = sideAnim.backdrop;
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

  if (isMobile) {
    return (
      <Modal visible={mounted} transparent animationType="none" onRequestClose={onClose}>
        <Animated.View
          style={[
            styles.buyTxSheet,
            {
              transform: pushRight ? [{ translateX: slide }] : [{ translateY: slide }],
            },
          ]}
        >
          <MobileSafeTop />
          <MobileNavHeader
            title={heldSummary.reference || docKind}
            subtitle={clientName || docLabel}
            onBack={onClose}
          />
          <ScrollView
            style={styles.buyTxScroll}
            contentContainerStyle={styles.buyTxScrollContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <TransactionTicketBody
              summary={heldSummary}
              detail={heldDetail}
              loading={loading}
              error={error}
              part="body"
            />
          </ScrollView>
        </Animated.View>
      </Modal>
    );
  }

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

/**
 * Structural equality for the plain data the POS returns (objects, arrays,
 * primitives). Exits on the first difference and allocates nothing, so it is
 * cheap enough to run against every store on every live poll.
 */
function samePlainData(a, b) {
  if (a === b) return true;
  if (a == null || b == null || typeof a !== 'object' || typeof b !== 'object') {
    return a !== a && b !== b; // NaN
  }
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (!samePlainData(a[i], b[i])) return false;
    }
    return true;
  }
  if (Array.isArray(b)) return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (let i = 0; i < keysA.length; i += 1) {
    const key = keysA[i];
    if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
    if (!samePlainData(a[key], b[key])) return false;
  }
  return true;
}

/**
 * Home polls the POS every few seconds. Most passes return the same numbers,
 * so keep the previous row objects (and the previous array) whenever a store
 * has not changed. Every memo and row below then bails out instead of
 * re-rendering the whole screen on each tick.
 */
function reconcileHomeRows(current, incoming) {
  const next = Array.isArray(incoming) ? incoming : [];
  const prev = Array.isArray(current) ? current : [];
  if (prev === next) return prev;
  if (!prev.length) return next;
  const prevByStore = new Map(prev.map((row) => [row.store, row]));
  let reused = prev.length === next.length;
  const result = next.map((row, index) => {
    const before = prevByStore.get(row.store);
    if (before && samePlainData(before, row)) {
      if (prev[index] !== before) reused = false;
      return before;
    }
    reused = false;
    return row;
  });
  return reused ? prev : result;
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

function HomeStoreDrawer({
  visible,
  store,
  session,
  periodLabel = 'Today',
  date,
  startKey,
  endKey,
  onClose,
  appsOpen = false,
  onAppsOpenChange,
  onMobileFilterTop,
  mobileChromeWidth = HOME_FILTER_SIZE,
  desktopHeader = null,
  dateHero = null,
  contentPadTop = 0,
  txFocus = 'all',
  onOpenCustomer,
  onSelectedDocumentChange,
  documentCloseRef,
}) {
  const { width: windowWidth } = useWindowDimensions();
  const isMobile = windowWidth < MOBILE_BREAKPOINT;
  const { hasApp } = useAppAccess();
  const drawerTabs = STORE_DRAWER_TABS.filter((tab) => {
    if (tab.key === 'settings') return true;
    if (tab.key === 'reviews') return hasApp('reviews') || hasApp('bonuses');
    if (tab.key === 'triage') return canViewTriageInsights(session?.profile);
    return hasApp(tab.key);
  });
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
  const topInset = 0;
  const onMobileFilterTopRef = useRef(onMobileFilterTop);
  const onAppsOpenChangeRef = useRef(onAppsOpenChange);
  onMobileFilterTopRef.current = onMobileFilterTop;
  onAppsOpenChangeRef.current = onAppsOpenChange;
  const alignFilter = useCallback((top) => {
    if (!Number.isFinite(top)) return;
    onMobileFilterTopRef.current?.(top);
  }, []);
  const panelWidth = windowWidth;
  const slideDistance = panelWidth;
  const { mounted, slide, settled } = useRightDrawerAnimation(visible, slideDistance);
  const heldStore = useHeldValue(store);
  const [activeTab, setActiveTab] = useState('overview');
  const [txRows, setTxRows] = useState([]);
  const [selectedRow, setSelectedRow] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const detailRequestId = useRef(0);
  const paymentCache = useRef({});

  const lastStoreNameRef = useRef(store?.store);
  const incomingTxKey = (store?.transactions || []).map((row) => row.id).join('\n');
  const openApp = useCallback((key) => {
    if (
      key === 'overview' ||
      key === 'settings' ||
      hasApp(key) ||
      (key === 'reviews' && hasApp('bonuses')) ||
      (key === 'triage' && canViewTriageInsights(session?.profile))
    ) {
      setSelectedRow(null);
      setDetail(null);
      setDetailError('');
      setDetailLoading(false);
      setActiveTab(key);
    }
  }, [hasApp, session?.profile]);

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
      onAppsOpenChangeRef.current?.(false);
      return;
    }

    if (!mounted) {
      setSelectedRow(null);
      setDetail(null);
      setDetailError('');
      setDetailLoading(false);
    }
  }, [visible, mounted, store?.store]);

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
            capturePurchasePriceCatalog(enriched).catch(() => {});
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

  const closeDetail = useCallback(() => {
    setSelectedRow(null);
    setDetail(null);
    setDetailError('');
    setDetailLoading(false);
  }, []);

  useEffect(() => {
    if (documentCloseRef) documentCloseRef.current = closeDetail;
    return () => {
      if (documentCloseRef) documentCloseRef.current = null;
    };
  }, [closeDetail, documentCloseRef]);

  useEffect(() => {
    const crumb = selectedRow ? documentCrumb(selectedRow) : '';
    onSelectedDocumentChange?.(crumb);
    return () => onSelectedDocumentChange?.('');
  }, [onSelectedDocumentChange, selectedRow]);

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
      onAppsOpenChangeRef.current?.(false);
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

  const ticketAnim = useRightDrawerAnimation(Boolean(selectedRow), slideDistance);
  const heldTicketSummary = useHeldValue(selectedRow);
  const heldTicketDetail = useHeldValue(detail);

  if (!mounted || !heldStore) return null;

  const drawerTree = (
        <View style={[styles.drawerRoot, styles.storeDrawerRoot]}>
          <Animated.View
            style={[
              styles.storeDrawerShell,
              styles.storeDrawerShellFill,
              { transform: [{ translateX: slide }] },
            ]}
          >
            {!isMobile ? (
              <View style={[styles.storeDrawerAppsRail, { paddingTop: TOP_BAR_HEIGHT + 12 }]}>
                {tabStrip.map((tab) => (
                  <StoreAppsRailItem
                    key={tab.key}
                    tab={tab}
                    selected={tab.key === activeTab}
                    onPress={() => openApp(tab.key)}
                  />
                ))}
              </View>
            ) : null}
            <View
              style={[
                styles.drawerPanel,
                styles.storeDrawerPanel,
                styles.storeDrawerPanelMobile,
                { width: '100%', maxWidth: '100%', flex: 1 },
              ]}
            >
              <View style={styles.storeDrawerMain}>
              <View style={[styles.drawerBody, styles.drawerBodyFill]}>
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
                  onFilterTop={alignFilter}
                  filterSlotWidth={mobileChromeWidth}
                  topInset={contentPadTop || topInset}
                  ready={settled}
                  desktopHeader={desktopHeader}
                  dateHero={dateHero}
                  heroFocus={txFocus}
                  focusTab={activeTab}
                  desktopApps={isMobile ? tabStrip : []}
                  appsOpen={appsOpen}
                  onAppsOpenChange={onAppsOpenChange}
                  embeddedApp={
                    STORE_SNAPSHOT_TABS.has(activeTab) ? null : (
                      <ScreenGate resetKey={activeTab}>
                        {activeTab === 'phone' ? (
                          <PhoneScreen
                            key={heldStore.store}
                            session={session}
                            storeFilter={heldStore.store}
                            embedded
                          />
                        ) : activeTab === 'preorders' ? (
                          <PreordersScreen storeFilter={heldStore.store} embedded />
                        ) : activeTab === 'audit' ? (
                          <AuditScreen
                            key={heldStore.store}
                            session={session}
                            storeFilter={heldStore.store}
                            initialDate={date}
                            embedded
                          />
                        ) : activeTab === 'reviews' ? (
                          <BonusesScreen
                            key={heldStore.store}
                            session={session}
                            storeFilter={heldStore.store}
                            embedded
                            title="Reviews"
                            onOpenEmails={() => openApp('emails')}
                            onOpenCustomer={onOpenCustomer}
                          />
                        ) : activeTab === 'triage' ? (
                          <TriageScreen
                            key={heldStore.store}
                            session={session}
                            storeFilter={heldStore.store}
                            embedded
                            onRequireLogin={() => {}}
                          />
                        ) : (
                          <StoreSettingsPanel
                            session={session}
                            storeName={heldStore.store}
                            embedded
                          />
                        )}
                      </ScreenGate>
                    )
                  }
                />
              </View>

              {appsOpen && isMobile ? (
                <View style={styles.storeAppsLayer}>
                  <Pressable
                    style={StyleSheet.absoluteFill}
                    onPress={() => onAppsOpenChange?.(false)}
                    accessibilityLabel="Close apps"
                  />
                  <View style={[styles.storeAppsCard, styles.storeAppsCardDocked]}>
                    <Text style={styles.igFilterLabel}>Apps</Text>
                    <ScrollView
                      style={styles.storeAppsScroll}
                      keyboardShouldPersistTaps="handled"
                      showsVerticalScrollIndicator={false}
                    >
                      {tabStrip.map((tool) => {
                        const selected = tool.key === activeTab;
                        return (
                          <Pressable
                            key={tool.key}
                            onPress={() => {
                              setActiveTab(tool.key);
                              onAppsOpenChange?.(false);
                            }}
                            style={({ pressed }) => [
                              styles.igFilterAction,
                              selected && styles.storeAppsRowSelected,
                              pressed && styles.storeAppsRowPressed,
                            ]}
                            accessibilityRole="button"
                            accessibilityState={{ selected }}
                            accessibilityLabel={tool.label}
                          >
                            <View style={[styles.igFilterActionIcon, { backgroundColor: tool.accent || '#1d1d1f' }]}>
                              <Ionicons name={filledIonicon(tool.icon)} size={16} color="#fff" />
                            </View>
                            <Text
                              style={[
                                styles.igFilterActionLabel,
                                styles.storeAppsLabel,
                                selected && styles.storeAppsLabelSelected,
                              ]}
                              numberOfLines={1}
                            >
                              {tool.label}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </ScrollView>
                  </View>
                </View>
              ) : null}
              </View>
            </View>
            {ticketAnim.mounted && heldTicketSummary ? (
              <Animated.View
                style={[
                  styles.storeTxSlide,
                  { transform: [{ translateX: ticketAnim.slide }] },
                ]}
              >
                <StoreTransactionPanel
                  storeName={heldStore.store}
                  periodLabel={periodLabel}
                  summary={heldTicketSummary}
                  detail={heldTicketDetail}
                  loading={detailLoading}
                  error={detailError}
                  onClose={closeDetail}
                  topInset={contentPadTop || topInset}
                />
              </Animated.View>
            ) : null}
          </Animated.View>
        </View>
  );

  const overlayHost =
    Platform.OS === 'web' && typeof document !== 'undefined'
      ? document.getElementById('cgold-app-shell')
      : null;
  const hostedDrawer =
    overlayHost ? createPortal(drawerTree, overlayHost) : drawerTree;

  return hostedDrawer;
}

const STORE_ACCENTS = {
  Hamilton: '#2F6FED',
  Mississauga: '#C47A12',
  Toronto: '#2F8A4E',
  'Richmond Hill': '#6B4DE6',
  Montreal: '#1D4ED8',
  Quebec: '#B45309',
  Laval: '#0F766E',
  'Calgary North': '#9A3412',
  'Calgary South': '#B91C1C',
  'Calgary SW': '#C2410C',
  Edmonton: '#047857',
  'Edmonton West': '#0E7490',
  Halifax: '#7C2D12',
  Carlingwood: '#BE185D',
  Gloucester: '#4338CA',
  Surrey: '#166534',
  Vancouver: '#1D4ED8',
  Winnipeg: '#6D28D9',
  'Canadian Coin & Currency': '#854D0E',
  Portland: '#334155',
  Seattle: '#0F172A',
  'In Transit': '#64748B',
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
  if (String(name || '').trim().toLowerCase() === 'in transit') return '#64748B';
  if (STORE_ACCENTS[name]) return STORE_ACCENTS[name];
  const value = String(name || '');
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return STORE_ACCENT_FALLBACKS[hash % STORE_ACCENT_FALLBACKS.length];
}

function HomeStoreStatusIcon({ accent, open, compact = false, onPress }) {
  const [anchor, setAnchor] = useState(null);
  const iconSize = compact ? 21 : 14;
  const closed = !open;
  const hover =
    Platform.OS === 'web' && closed
      ? {
          className: 'cgold-store-closed-hit',
          pointerEvents: 'auto',
          onMouseEnter: (event) => setAnchor(event?.currentTarget || null),
          onMouseLeave: () => setAnchor(null),
          onClick: onPress
            ? (event) => {
                event?.stopPropagation?.();
                onPress();
              }
            : undefined,
        }
      : null;

  return (
    <View
      style={[styles.homeStoreIconWrap, compact && styles.igStoreIconWrap, hover && styles.homeStoreIconHit]}
      accessibilityLabel={closed ? 'Closed' : undefined}
      {...hover}
    >
      <View
        style={[
          compact ? styles.igStoreIcon : styles.homeStoreIconTile,
          { backgroundColor: accent },
          closed && styles.homeStoreIconClosed,
        ]}
      >
        <Ionicons name="storefront" size={iconSize} color="#fff" />
      </View>
      <FloatingTooltip visible={Boolean(anchor)} text="Closed" anchorEl={anchor} align="center" compact />
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

const NumberFlowWeb =
  Platform.OS === 'web' ? require('@number-flow/react').default : null;

const REEL_SPIN = { duration: 280, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' };
const REEL_FADE = { duration: 120, easing: 'ease-out' };

const HomeReelValue = memo(function HomeReelValue({
  value,
  kind = 'count',
  style,
  accessibilityLabel,
}) {
  const { currency, fromCad, money } = useDisplayCurrency();
  const n = kind === 'currency' ? fromCad(value) : Number(value) || 0;
  const [shown, setShown] = useState(0);
  const flat = StyleSheet.flatten(style) || {};

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      startTransition(() => setShown(n));
    });
    return () => cancelAnimationFrame(raf);
  }, [n]);
  const format =
    kind === 'currency'
      ? { style: 'currency', currency, currencyDisplay: 'narrowSymbol', maximumFractionDigits: 2 }
      : { maximumFractionDigits: 0 };
  const label = accessibilityLabel || (kind === 'currency' ? money(value) : formatHomeCountTick(n));

  if (NumberFlowWeb) {
    return (
      <View style={styles.homeReelRow} accessibilityLabel={label}>
        {createElement(NumberFlowWeb, {
          value: shown,
          locales: 'en-CA',
          format,
          isolate: true,
          willChange: true,
          transformTiming: REEL_SPIN,
          spinTiming: REEL_SPIN,
          opacityTiming: REEL_FADE,
          className: 'cgold-number-flow',
          style: {
            fontFamily: 'Sohne, sans-serif',
            fontSize: flat.fontSize || 16,
            lineHeight: 0.9,
            fontWeight: flat.fontWeight || 400,
            color: flat.color || '#1d1d1f',
            fontVariantNumeric: 'tabular-nums',
            letterSpacing: flat.letterSpacing,
            '--number-flow-mask-height': '0.15em',
          },
        })}
      </View>
    );
  }

  return <Text style={style}>{label}</Text>;
});

function HomeLiveValue({
  children,
  numeric,
  format,
  style,
  numberOfLines = 1,
  adjustsFontSizeToFit,
  minimumFontScale,
  origin = 'start',
  accessibilityLabel,
  stableLayout = false,
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
    } else if (stableLayout) {
      flash.stopAnimation();
      flash.setValue(1);
      Animated.timing(flash, {
        toValue: 0,
        duration: 980,
        easing: Easing.out(Easing.quad),
        useNativeDriver: false,
      }).start();
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
  }, [display, flash, slide, scale, stableLayout]);

  const color = flash.interpolate({
    inputRange: [0, 1],
    outputRange: [baseColor, flashColor],
  });
  const webStable = stableLayout ? ' cgold-home-live-stable' : '';
  const webClass =
    webFlash === 'up' || webFlash === 'down'
      ? `cgold-home-live cgold-home-live-hot-${webFlash}${webStable}`
      : webFlash === 'cool'
        ? `cgold-home-live cgold-home-live-cool${webStable}`
        : `cgold-home-live${webStable}`;

  return (
    <Animated.Text
      {...(Platform.OS === 'web' ? { className: webClass } : null)}
      style={[
        style,
        Platform.OS === 'web'
          ? {
              transformOrigin: origin === 'end' ? 'right center' : 'left center',
            }
          : stableLayout
            ? { color }
            : {
                color,
                transform: [{ translateY: slide }, { scale }],
              },
      ]}
      numberOfLines={numberOfLines}
      adjustsFontSizeToFit={adjustsFontSizeToFit}
      {...(minimumFontScale != null ? { minimumFontScale } : null)}
      accessibilityLabel={accessibilityLabel}
    >
      {shown}
    </Animated.Text>
  );
}

const HOME_RATE_EMPTY = '#c7c7cc';

function homeRateIconColor(stats) {
  if (stats?.rate == null) return HOME_RATE_EMPTY;
  return stats.rate < 80 ? '#B91C1C' : '#15803D';
}

function homeMetricFormat(stats) {
  return stats?.format === 'count' ? formatHomeCountTick : formatHomePercentTick;
}

function HomeStoreMetric({ icon, stats, label, stretch = false }) {
  const empty = stats?.rate == null;
  const low = !empty && stats.rate < 80;
  const detail =
    !empty && Number(stats.average) > 0 ? `${Number(stats.average).toFixed(1)} average` : '';
  return (
    <View
      style={[styles.igStoreMetric, stretch && styles.igHomeStoreMetric]}
      accessibilityLabel={
        empty ? `${label}, no activity` : `${label} ${stats.ratio}${detail ? `, ${detail}` : ''}`
      }
    >
      <Ionicons name={icon} size={14} color={homeRateIconColor(stats)} />
      {empty ? (
        <View style={[styles.igStoreMetricText, stretch && styles.igHomeStoreMetricText]} />
      ) : (
        <HomeLiveValue
          style={[
            styles.igStoreMetricText,
            stretch && styles.igHomeStoreMetricText,
            low ? styles.homeStorePhoneLow : styles.homeStorePhoneHigh,
          ]}
          numeric={stats.numeric ?? stats.rate}
          format={homeMetricFormat(stats)}
        >
          {stats.ratio}
        </HomeLiveValue>
      )}
    </View>
  );
}

const HomeStoreCard = memo(function HomeStoreCard({
  row,
  people,
  emailStats,
  phoneStats,
  reviewStats,
  selected,
  last,
  onOpenStore,
  onOpenPerson,
  open,
  showAmounts = true,
  canOpen = true,
  peopleInteractive = false,
  wide = false,
  tile = false,
  amountFocus = 'all',
}) {
  const accent = storeAccent(row.store);
  const focused = homeAmountForFocus(row, amountFocus);
  const hasActivity = focused.count > 0;
  const closed = open === false;
  const cardStyle = [
    styles.igStoreCard,
    !wide && !tile && styles.igHomeStoreCard,
    wide && styles.igStoreCardWide,
    tile && styles.igStoreTile,
    selected && styles.igStoreCardSelected,
  ];
  const rateMetrics = (
    <View
      style={[styles.igStoreMetrics, closed && styles.igStoreSlotHidden]}
      pointerEvents="none"
      accessibilityElementsHidden={closed}
      importantForAccessibility={closed ? 'no-hide-descendants' : 'auto'}
    >
      <HomeStoreMetric icon="mail" stats={emailStats} label="Email capture" />
      <HomeStoreMetric icon="call" stats={phoneStats} label="Phone answer rate" />
      <HomeStoreMetric icon="star" stats={reviewStats} label="Reviews" />
    </View>
  );
  const nameBlock = (
    <View style={styles.igStoreCopy}>
      <Text style={styles.igStoreName} numberOfLines={1}>
        {row.store}
      </Text>
      <HomeLiveValue
        style={[styles.igStoreMeta, closed && styles.igStoreSlotHidden]}
        numeric={focused.count}
        numberOfLines={1}
      >
        {hasActivity ? homeCountLabel(focused.count, amountFocus) : amountFocus === 'sales' ? 'No sales' : amountFocus === 'purchases' ? 'No purchases' : 'No transactions'}
      </HomeLiveValue>
    </View>
  );
  const trailingBlock = (
    <View style={styles.igStoreTrailing}>
      {closed ? (
        <Text style={styles.igStoreClosedLabel}>Closed</Text>
      ) : canOpen && showAmounts ? (
        <HomeStoreAmount
          amount={focused.amount}
          count={focused.count}
          breakdown={amountFocus === 'all' ? row : null}
          compact
        />
      ) : null}
      {!closed && people.length > 0 ? (
        <HomePeopleStack
          people={people}
          compact
          interactive={peopleInteractive}
          onOpenPerson={onOpenPerson}
        />
      ) : (
        <View style={styles.igStorePeopleSlot} />
      )}
    </View>
  );
  const stackedBody = (
    <View style={[styles.igStoreBody, styles.igHomeStoreBody]}>
      <View style={styles.igHomeStoreMain}>
        <View style={styles.igHomeStoreCopy}>
          <Text style={styles.igHomeStoreName} numberOfLines={1}>
            {row.store}
          </Text>
          <HomeLiveValue style={styles.igHomeStoreMeta} numeric={focused.count} numberOfLines={1}>
            {hasActivity
              ? homeCountLabel(focused.count, amountFocus)
              : amountFocus === 'sales'
                ? 'No sales'
                : amountFocus === 'purchases'
                  ? 'No purchases'
                  : 'No transactions'}
          </HomeLiveValue>
        </View>
        <View style={styles.igHomeStoreTrailing}>
          {closed ? (
            <Text style={styles.igHomeStoreClosed} numberOfLines={1}>
              Closed
            </Text>
          ) : canOpen && showAmounts ? (
            <HomeStoreAmount
              amount={focused.amount}
              count={focused.count}
              breakdown={amountFocus === 'all' ? row : null}
              compact
            />
          ) : null}
          {!closed && people.length > 0 ? (
            <HomePeopleStack
              people={people}
              compact
              interactive={peopleInteractive}
              onOpenPerson={onOpenPerson}
            />
          ) : null}
        </View>
        <View style={styles.igHomeStoreChevron}>
          {canOpen ? <Ionicons name="chevron-forward" size={18} color="#c7c7cc" /> : null}
        </View>
      </View>
      {closed && canOpen && showAmounts ? (
        <View style={styles.igHomeStoreMetricsRow}>
          <View
            style={styles.igHomeStoreMetrics}
            pointerEvents="none"
            accessibilityElementsHidden={false}
          >
            <HomeStoreMetric icon="mail" stats={emailStats} label="Email capture" stretch />
            <View style={styles.igHomeStoreMetricRule} />
            <HomeStoreMetric icon="call" stats={phoneStats} label="Phone answer rate" stretch />
            <View style={styles.igHomeStoreMetricRule} />
            <HomeStoreMetric icon="star" stats={reviewStats} label="Reviews" stretch />
          </View>
          <HomeStoreAmount
            amount={focused.amount}
            count={focused.count}
            breakdown={amountFocus === 'all' ? row : null}
            compact
          />
        </View>
      ) : (
        <View
          style={styles.igHomeStoreMetrics}
          pointerEvents="none"
          accessibilityElementsHidden={false}
        >
          <HomeStoreMetric icon="mail" stats={emailStats} label="Email capture" stretch />
          <View style={styles.igHomeStoreMetricRule} />
          <HomeStoreMetric icon="call" stats={phoneStats} label="Phone answer rate" stretch />
          <View style={styles.igHomeStoreMetricRule} />
          <HomeStoreMetric icon="star" stats={reviewStats} label="Reviews" stretch />
        </View>
      )}
    </View>
  );

  const tileBody = (
    <>
      <View style={styles.igStoreTileTop}>
        <HomeStoreStatusIcon accent={accent} open={open} compact onPress={canOpen ? () => onOpenStore(row) : undefined} />
        {nameBlock}
        {closed ? (
          <Text style={styles.igStoreClosedLabel}>Closed</Text>
        ) : canOpen && showAmounts ? (
          <HomeStoreAmount
            amount={focused.amount}
            count={focused.count}
            breakdown={amountFocus === 'all' ? row : null}
            compact
          />
        ) : null}
      </View>
      <View style={styles.igStoreTileFoot}>
        {rateMetrics}
        {!closed && people.length > 0 ? (
          <HomePeopleStack
            people={people}
            compact
            interactive={peopleInteractive}
            onOpenPerson={onOpenPerson}
          />
        ) : (
          <View style={styles.igStorePeopleSlot} />
        )}
      </View>
    </>
  );

  if (tile) {
    if (!canOpen) {
      return (
        <View style={[cardStyle, styles.igStoreCardStatic]} accessibilityLabel={`${row.store}, ${open ? 'open' : 'closed'}`}>
          {tileBody}
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
        {tileBody}
      </Pressable>
    );
  }

  if (!canOpen) {
    return (
      <View style={[cardStyle, styles.igStoreCardStatic]} accessibilityLabel={`${row.store}, ${open ? 'open' : 'closed'}`}>
        <HomeStoreStatusIcon accent={accent} open={open} compact />
        {wide ? (
          <View
            style={[
              styles.igStoreBody,
              styles.igStoreBodyWide,
              !last && styles.igStoreBodyDivider,
            ]}
          >
            {nameBlock}
            {rateMetrics}
            {trailingBlock}
            <View style={styles.igStoreChevron} />
          </View>
        ) : (
          <>
            {stackedBody}
            {!last ? <View style={styles.igHomeStoreCardRule} /> : null}
          </>
        )}
      </View>
    );
  }

  const cardLabel = `${row.store}, ${open ? 'open' : 'closed'}`;

  return (
    <Pressable
      onPress={() => onOpenStore(row)}
      style={({ hovered, pressed }) => [
        ...cardStyle,
        (hovered || pressed) && styles.igStoreCardPressed,
      ]}
      accessibilityRole="button"
      accessibilityLabel={cardLabel}
    >
      <HomeStoreStatusIcon
        accent={accent}
        open={open}
        compact
        onPress={() => onOpenStore(row)}
      />
      {wide ? (
        <View
          style={[
            styles.igStoreBody,
            styles.igStoreBodyWide,
            !last && styles.igStoreBodyDivider,
          ]}
        >
          {nameBlock}
          {rateMetrics}
          {trailingBlock}
          <Ionicons name="chevron-forward" size={18} color="#c7c7cc" style={styles.igStoreChevron} />
        </View>
      ) : (
        <>
          {stackedBody}
          {!last ? <View style={styles.igHomeStoreCardRule} /> : null}
        </>
      )}
    </Pressable>
  );
});

function callsInHomeRange(calls, startKey, endKey) {
  if (!startKey || !endKey) return Array.isArray(calls) ? calls : [];
  return (Array.isArray(calls) ? calls : []).filter((call) => {
    const time = Date.parse(call.startTime);
    if (!Number.isFinite(time)) return false;
    const day = formatDateParam(new Date(time));
    return day >= startKey && day <= endKey;
  });
}

function homeCallsForStore(mergedCallsByStore, historyByStore, storeName, startKey, endKey) {
  const inbox = callsInHomeRange(callsForStore(mergedCallsByStore, storeName), startKey, endKey);
  const history = callsInHomeRange(callsForStore(historyByStore, storeName), startKey, endKey);
  return mergeCallLog(history, inbox);
}

function homeCallsForStoreAll(mergedCallsByStore, historyByStore, storeName) {
  return mergeCallLog(callsForStore(historyByStore, storeName), callsForStore(mergedCallsByStore, storeName));
}

function phoneRatioForStore(mergedCallsByStore, historyByStore, storeName, startKey, endKey) {
  return inboundCallRatio(
    homeCallsForStore(mergedCallsByStore, historyByStore, storeName, startKey, endKey),
    homeCallsForStoreAll(mergedCallsByStore, historyByStore, storeName),
  );
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

function homeAppTool(key) {
  return TOOL_CARDS.find((tool) => tool.key === key);
}

function HomeStoreTableIconHeader({ toolKey, style, accessibilityLabel, rowIcon = false }) {
  const tool = homeAppTool(toolKey);
  if (!tool) return <View style={style} />;
  return (
    <View
      style={[style, styles.homeStoreHeaderIconCell]}
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel || tool.label}
    >
      <View
        style={[
          rowIcon ? styles.igStoreIcon : styles.homeStoreHeaderIconTile,
          { backgroundColor: tool.accent },
        ]}
      >
        <Ionicons name={filledIonicon(tool.icon)} size={rowIcon ? 21 : 13} color="#fff" />
      </View>
    </View>
  );
}

function HomePercentRate({ stats, compact = false, columnStyle, emptyLabel, noun, tip, icon }) {
  const [anchor, setAnchor] = useState(null);
  const empty = stats?.rate == null;
  const low = !empty && stats.rate < 80;
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
      {icon ? (
        <View style={compact ? null : styles.homeStoreRateIcon}>
          <Ionicons name={icon} size={13} color={homeRateIconColor(stats)} />
        </View>
      ) : null}
      {empty ? (
        compact ? null : <View style={styles.homeStoreRateValue} />
      ) : (
        <View style={compact ? null : styles.homeStoreRateValue}>
          <HomeLiveValue
            style={[
              compact ? styles.igStorePhone : styles.homeStorePhone,
              low && styles.homeStorePhoneLow,
              !low && styles.homeStorePhoneHigh,
            ]}
            numeric={stats.numeric ?? stats.rate}
            format={homeMetricFormat(stats)}
            numberOfLines={1}
          >
            {stats.ratio}
          </HomeLiveValue>
        </View>
      )}
      <FloatingTooltip visible={Boolean(anchor && tip)} text={tip} anchorEl={anchor} align="end" />
    </View>
  );
}

function HomeEmailRate({ stats, compact = false, showIcon = true }) {
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
      icon={showIcon ? 'mail' : null}
    />
  );
}

function HomePhoneRate({ stats, compact = false, showIcon = true }) {
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
      icon={showIcon ? 'call' : null}
    />
  );
}

function HomeReviewRate({ stats, compact = false, showIcon = true }) {
  const empty = stats?.rate == null;
  const tip = empty
    ? ''
    : `${stats.count} review${stats.count === 1 ? '' : 's'} · ${Number(stats.average).toFixed(1)} average${
        stats.negative ? ` · ${stats.negative} low` : ''
      }`;
  return (
    <HomePercentRate
      stats={{ ...stats, ratio: empty ? '—' : String(stats.count) }}
      compact={compact}
      columnStyle={styles.homeStoreColReview}
      emptyLabel="No reviews"
      noun="Reviews"
      tip={tip}
      icon={showIcon ? 'star' : null}
    />
  );
}

function HomeReviewStar({ size }) {
  const badge = Math.max(12, Math.round(size * 0.42));
  const icon = Math.max(7, Math.round(badge * 0.62));
  return (
    <View
      pointerEvents="none"
      style={[
        styles.homeReviewStar,
        {
          width: badge,
          height: badge,
          borderRadius: badge / 2,
          top: -2,
          right: -3,
        },
      ]}
    >
      <Ionicons name="star" size={icon} color="#F5D76A" />
    </View>
  );
}

function HomePersonFace({
  person,
  index,
  size,
  overlap,
  raised,
  onOpenPerson,
  hoverHandlers,
  setTip,
  interactive = true,
}) {
  const clockedIn = useIsClockedIn(person.name);
  const reviewStar = Boolean(person.reviewStar);
  const faceStyle = [
    styles.homePeopleAvatarWrap,
    {
      width: size,
      height: size,
      marginLeft: index === 0 ? 0 : -overlap,
      zIndex: clockedIn || reviewStar || raised ? 30 + index : index + 1,
    },
  ];
  const hoverLabel = reviewStar ? `${person.name}\nGoogle review` : person.name;
  const accessLabel = [
    person.name,
    clockedIn ? 'clocked in' : '',
    reviewStar ? 'Google review' : '',
  ]
    .filter(Boolean)
    .join(', ');
  const avatar = (
    <View style={{ width: size, height: size }}>
      <ProfileAvatar
        uri={person.photoUrl}
        name={person.name}
        size={size}
        style={styles.homePeopleAvatarRing}
        clockMark="badge"
      />
      {reviewStar ? <HomeReviewStar size={size} /> : null}
    </View>
  );

  if (!interactive) {
    return (
      <View pointerEvents="none" style={faceStyle}>
        {avatar}
      </View>
    );
  }

  return (
    <Pressable
      pointerEvents="auto"
      onPress={(event) => {
        event?.stopPropagation?.();
        setTip({ text: '', el: null });
        onOpenPerson?.(person);
      }}
      onPointerDown={(event) => event?.stopPropagation?.()}
      style={faceStyle}
      accessibilityRole="button"
      accessibilityLabel={accessLabel}
      {...(clockedIn && !reviewStar ? null : hoverHandlers(hoverLabel))}
    >
      {avatar}
    </Pressable>
  );
}

function HomePeopleStack({
  people = [],
  compact = false,
  onOpenPerson,
  trailing = false,
  interactive,
}) {
  const [tip, setTip] = useState({ text: '', el: null });
  const canInteract = interactive ?? !compact;
  const size = compact ? 32 : HOME_PEOPLE_SIZE;
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
      pointerEvents={canInteract ? 'box-none' : 'none'}
      accessibilityLabel={people.map((person) => person.name).join(', ')}
    >
      {visible.map((person, index) => (
        <HomePersonFace
          key={`${person.name}-${index}`}
          person={person}
          index={index}
          size={size}
          overlap={overlap}
          raised={tip.text === person.name}
          onOpenPerson={onOpenPerson}
          hoverHandlers={hoverHandlers}
          setTip={setTip}
          interactive={canInteract}
        />
      ))}
      {extra > 0 ? (
        <View
          pointerEvents={canInteract ? 'auto' : 'none'}
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
  const { currency, fromCad, money } = useDisplayCurrency();
  const [anchor, setAnchor] = useState(null);
  const empty = !Number(amount) && !Number(count);
  const tip = breakdown && !empty ? salesPurchasesTip(breakdown, money) : '';
  const shown = fromCad(amount);
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
            ? `Total ${money(amount)}. ${tip.replace('\n', '. ')}`
            : money(amount)
      }
    >
      {compact || empty ? (
        <HomeLiveValue
          style={[
            compact ? styles.igStoreAmount : styles.homeStoreMoney,
            strong && styles.homeStoreMoneyStrong,
            empty && styles.homeStoreMoneyEmpty,
          ]}
          numeric={shown}
          format={(value) => formatAmount(value, currency)}
          origin="end"
          numberOfLines={1}
        >
          {empty ? '—' : money(amount)}
        </HomeLiveValue>
      ) : (
        <HomeReelValue
          style={[styles.homeStoreMoney, strong && styles.homeStoreMoneyStrong]}
          value={amount}
          kind="currency"
          accessibilityLabel={money(amount)}
        />
      )}
      <FloatingTooltip visible={Boolean(anchor && tip)} text={tip} anchorEl={anchor} align="end" />
    </View>
  );
}

const HomeStoreTableRow = memo(function HomeStoreTableRow({
  row,
  people,
  emailStats,
  phoneStats,
  reviewStats,
  selected,
  last,
  onOpenStore,
  onOpenPerson,
  open,
  showAmounts = true,
  canOpen = true,
  peopleInteractive = false,
  amountFocus = 'all',
  hideRule = false,
  onHoverRow,
}) {
  const accent = storeAccent(row.store);
  const closed = open === false;
  const focused = homeAmountForFocus(row, amountFocus);
  const hasActivity = focused.count > 0;
  const peopleColumn = (
    <View style={[styles.homeStoreColPeople, !showAmounts && styles.homeStoreColPeopleTrailing]}>
      {closed ? null : (
        <HomePeopleStack
          people={people}
          compact
          onOpenPerson={onOpenPerson}
          trailing={!showAmounts}
          interactive={peopleInteractive}
        />
      )}
    </View>
  );
  const metricCells = closed ? (
    <>
      <View style={styles.homeStoreColEmail} />
      <View style={styles.homeStoreColPhone} />
      <View style={styles.homeStoreColReview} />
    </>
  ) : (
    <>
      <HomeEmailRate stats={emailStats} />
      <HomePhoneRate stats={phoneStats} />
      <HomeReviewRate stats={reviewStats} />
    </>
  );
  const rowBody = (
    <View style={styles.homeStoreRowBody}>
      <View style={styles.homeStoreColStore}>
        <Text style={styles.homeStoreName} numberOfLines={1}>
          {row.store}
        </Text>
        {closed ? (
          <Text style={styles.homeStoreMeta}>Closed</Text>
        ) : (
          <HomeLiveValue style={styles.homeStoreMeta} numeric={focused.count} numberOfLines={1}>
            {hasActivity
              ? homeCountLabel(focused.count, amountFocus)
              : amountFocus === 'sales'
                ? 'No sales'
                : amountFocus === 'purchases'
                  ? 'No purchases'
                  : 'No transactions'}
          </HomeLiveValue>
        )}
      </View>
      <View style={styles.homeStoreRateSpacer} />
      {metricCells}
      <View style={styles.homeStoreTrailingGap} />
      {showAmounts ? peopleColumn : null}
      {showAmounts ? (
        closed ? (
          <View style={styles.homeStoreColMoney} />
        ) : (
          <HomeStoreAmount
            amount={focused.amount}
            count={focused.count}
            breakdown={amountFocus === 'all' ? row : null}
            strong
          />
        )
      ) : (
        peopleColumn
      )}
      <View style={styles.homeStoreChevron}>
        {canOpen ? <Ionicons name="chevron-forward" size={14} color="#c7c7cc" /> : null}
      </View>
    </View>
  );

  if (!canOpen) {
    return (
      <View
        style={[styles.homeStoreRow, styles.homeStoreRowStatic]}
        accessibilityLabel={`${row.store}, ${open ? 'open' : 'closed'}`}
        onMouseEnter={() => onHoverRow?.(row.store)}
        onMouseLeave={() => onHoverRow?.(null)}
      >
        <HomeStoreStatusIcon accent={accent} open={open} />
        {rowBody}
        <HomeStoreRowRule last={last} hidden={hideRule} />
      </View>
    );
  }

  const label = `${row.store}, ${open ? 'open' : 'closed'}`;
  // Profile avatars are buttons. On web the row control has to be a sibling of
  // those buttons; a Pressable with accessibilityRole="button" renders a
  // <button>, and a button cannot contain another button.
  if (Platform.OS === 'web') {
    return (
      <View
        style={[
          styles.homeStoreRow,
          selected && styles.homeStoreRowSelected,
        ]}
        className={selected ? 'cgold-home-row cgold-home-row-selected' : 'cgold-home-row'}
        onMouseEnter={() => onHoverRow?.(row.store)}
        onMouseLeave={() => onHoverRow?.(null)}
      >
        <Pressable
          onPress={() => onOpenStore(row)}
          style={({ hovered, pressed }) => [
            StyleSheet.absoluteFill,
            (hovered || pressed || selected) && styles.homeStoreRowHovered,
          ]}
          accessibilityRole="button"
          accessibilityLabel={label}
        />
        <View pointerEvents="none" style={styles.homeStoreRowForeground}>
          <HomeStoreStatusIcon
            accent={accent}
            open={open}
            onPress={() => onOpenStore(row)}
          />
          {rowBody}
        </View>
        <HomeStoreRowRule last={last} hidden={hideRule} />
      </View>
    );
  }

  return (
    <Pressable
      onPress={() => onOpenStore(row)}
      style={({ hovered, pressed }) => [
        styles.homeStoreRow,
        (hovered || pressed || selected) && styles.homeStoreRowHoveredNative,
      ]}
      onHoverIn={() => onHoverRow?.(row.store)}
      onHoverOut={() => onHoverRow?.(null)}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <HomeStoreStatusIcon accent={accent} open={open} />
      {rowBody}
      <HomeStoreRowRule last={last} hidden={hideRule} />
    </Pressable>
  );
});

const HOME_PHONE_STORES = [...HOME_PINNED_STORES];
const HOME_EMAIL_REFRESH_MS = 15_000;

function HomeStoreRowRule({ last = false, header = false, total = false, hidden = false }) {
  if (last && !header && !total) return null;
  return (
    <View
      pointerEvents="none"
      style={[
        styles.homeStoreRowRule,
        header && styles.homeStoreRowRuleHeader,
        total && styles.homeStoreRowRuleTotal,
        hidden && styles.homeStoreRowRuleHidden,
      ]}
      {...(Platform.OS === 'web' ? { className: 'cgold-home-row-rule' } : null)}
    />
  );
}

function nextHomeStoreSort(current, column) {
  if (current.key !== column) {
    return { key: column, dir: column === 'store' ? 'asc' : 'desc' };
  }
  if (column === 'store') {
    if (current.dir === 'asc') return { key: column, dir: 'desc' };
    return { key: null, dir: 'default' };
  }
  if (current.dir === 'desc') return { key: column, dir: 'asc' };
  return { key: null, dir: 'default' };
}

function homeStoreSortLabel(dir, active) {
  if (!active || dir === 'default') return 'default';
  return dir === 'asc' ? 'ascending' : 'descending';
}

function HomeStoreHeaderCell({
  label,
  column,
  sortKey,
  sortDir,
  onSort,
  style,
  align = 'start',
}) {
  const active = sortKey === column && sortDir !== 'default';
  const icon =
    !active ? 'swap-vertical' : sortDir === 'asc' ? 'chevron-up' : 'chevron-down';
  const state = homeStoreSortLabel(sortDir, active);
  return (
    <Pressable
      onPress={() => onSort(column)}
      style={[
        style,
        styles.homeStoreHeaderButton,
        align === 'center' && styles.homeStoreHeaderButtonCenter,
        align === 'end' && styles.homeStoreHeaderButtonEnd,
      ]}
      accessibilityRole="button"
      accessibilityLabel={`Sort by ${label}, ${state}`}
    >
      <Text style={[styles.homeStoreHeader, active && styles.homeStoreHeaderActive]} numberOfLines={1}>
        {label}
      </Text>
      <Ionicons name={icon} size={12} color={active ? MOBILE.label : '#c7c7cc'} />
    </Pressable>
  );
}

function HomeStoresTableHeader({ showAmounts, sortKey, sortDir, onSort, hideRule = false }) {
  return (
    <View
      style={[styles.homeStoreRow, styles.homeStoreHeaderRow]}
      {...(Platform.OS === 'web' ? { className: 'cgold-home-header-row' } : null)}
    >
      <View style={styles.homeStoreIconSpacer} />
      <View style={styles.homeStoreRowBody}>
        <HomeStoreHeaderCell
          label="Store"
          column="store"
          sortKey={sortKey}
          sortDir={sortDir}
          onSort={onSort}
          style={styles.homeStoreColStore}
        />
        <View style={styles.homeStoreRateSpacer} />
        <HomeStoreHeaderCell
          label="Email"
          column="email"
          sortKey={sortKey}
          sortDir={sortDir}
          onSort={onSort}
          style={styles.homeStoreColEmail}
          align="center"
        />
        <HomeStoreHeaderCell
          label="Phone"
          column="phone"
          sortKey={sortKey}
          sortDir={sortDir}
          onSort={onSort}
          style={styles.homeStoreColPhone}
          align="center"
        />
        <HomeStoreHeaderCell
          label="Reviews"
          column="review"
          sortKey={sortKey}
          sortDir={sortDir}
          onSort={onSort}
          style={styles.homeStoreColReview}
          align="center"
        />
        <View style={styles.homeStoreTrailingGap} />
        {showAmounts ? (
          <HomeStoreHeaderCell
            label="Employees"
            column="people"
            sortKey={sortKey}
            sortDir={sortDir}
            onSort={onSort}
            style={styles.homeStoreColPeople}
          />
        ) : null}
        {showAmounts ? (
          <HomeStoreHeaderCell
            label="Financials"
            column="money"
            sortKey={sortKey}
            sortDir={sortDir}
            onSort={onSort}
            style={styles.homeStoreColMoney}
            align="end"
          />
        ) : (
          <HomeStoreHeaderCell
            label="Employees"
            column="people"
            sortKey={sortKey}
            sortDir={sortDir}
            onSort={onSort}
            style={[styles.homeStoreColPeople, styles.homeStoreColPeopleTrailing]}
            align="end"
          />
        )}
        <View style={styles.homeStoreChevron} />
      </View>
      <HomeStoreRowRule header hidden={hideRule} />
    </View>
  );
}

function prefetchHomePhoneInboxes(refreshInbox, names) {
  const keys = [];
  const seen = new Set();
  for (const name of names || []) {
    const key = storeKeyFromName(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
  }
  if (!keys.length || typeof refreshInbox !== 'function') return Promise.resolve();
  let next = 0;
  const workers = Math.min(6, keys.length);
  return Promise.all(
    Array.from({ length: workers }, async () => {
      while (next < keys.length) {
        const key = keys[next];
        next += 1;
        try {
          await refreshInbox(key, { silent: true });
        } catch {
          // Live refresh retries a store that rate-limited or failed.
        }
      }
    }),
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
  peopleInteractive = false,
  amountFocus = 'all',
}) {
  const phone = usePhoneCalls();
  const [hoursByKey, setHoursByKey] = useState(() => new Map());
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [callHistoryByStore, setCallHistoryByStore] = useState({});
  const [reviewsByStore, setReviewsByStore] = useState(() => new Map());
  const [sort, setSort] = useState({ key: null, dir: 'default' });
  const [hoveredStore, setHoveredStore] = useState(null);
  const cycleSort = useCallback((column) => {
    setSort((current) => nextHomeStoreSort(current, column));
  }, []);
  const reviewEmployeesByStore = useMemo(() => {
    const next = new Map();
    for (const row of rows) {
      next.set(
        row.store,
        attributedReviewEmployeeNames({
          reviews: reviewsForStoreName(reviewsByStore, row.store),
          transactionRows: row.transactions,
          storeName: row.store,
          staffProfiles: staff,
        }),
      );
    }
    return next;
  }, [reviewsByStore, rows, staff]);
  const peopleByStore = useMemo(
    () =>
      new Map(
        rows.map((row) => {
          const attributed = reviewEmployeesByStore.get(row.store) || [];
          const people = peopleInStore(row.store, row.transactions, staff).map((person) => ({
            ...person,
            reviewStar: employeeNameMatchesAny(person.name, attributed),
          }));
          return [row.store, people];
        }),
      ),
    [reviewEmployeesByStore, rows, staff],
  );
  const totalPeople = useMemo(() => {
    const people = uniqueStorePeople(rows, staff);
    return people.map((person) => ({
      ...person,
      reviewStar: rows.some((row) =>
        employeeNameMatchesAny(person.name, reviewEmployeesByStore.get(row.store) || []),
      ),
    }));
  }, [reviewEmployeesByStore, rows, staff]);
  const storeNamesKey = useMemo(() => rows.map((row) => row.store).filter(Boolean).join('\n'), [rows]);
  const phoneByStore = useMemo(() => {
    const next = new Map();
    for (const row of rows) {
      next.set(
        row.store,
        phoneRatioForStore(phone.mergedCallsByStore, callHistoryByStore, row.store, startKey, endKey),
      );
    }
    return next;
  }, [callHistoryByStore, endKey, phone.mergedCallsByStore, rows, startKey]);
  const totalPhoneStats = useMemo(() => {
    const calls = rows.flatMap((row) =>
      homeCallsForStore(phone.mergedCallsByStore, callHistoryByStore, row.store, startKey, endKey),
    );
    const resolveFrom = rows.flatMap((row) => homeCallsForStoreAll(phone.mergedCallsByStore, callHistoryByStore, row.store));
    return inboundCallRatio(calls, resolveFrom);
  }, [callHistoryByStore, endKey, phone.mergedCallsByStore, rows, startKey]);
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
  const reviewByStore = useMemo(() => {
    const next = new Map();
    for (const row of rows) {
      next.set(row.store, reviewStatsFromReviews(reviewsForStoreName(reviewsByStore, row.store)));
    }
    return next;
  }, [reviewsByStore, rows]);
  const totalReviewStats = useMemo(() => {
    const seen = new Set();
    const reviews = [];
    for (const row of rows) {
      for (const review of reviewsForStoreName(reviewsByStore, row.store)) {
        const id = review.id || `${review.author}-${review.timestampMs}`;
        if (seen.has(id)) continue;
        seen.add(id);
        reviews.push(review);
      }
    }
    return reviewStatsFromReviews(reviews);
  }, [reviewsByStore, rows]);

  useEffect(() => {
    if (!startKey || !endKey || !storeNamesKey) {
      setCallHistoryByStore({});
      return undefined;
    }
    const names = storeNamesKey.split('\n').filter(Boolean);
    const dateFrom = parseDateParam(startKey);
    const dateTo = parseDateParam(endKey);
    dateTo.setDate(dateTo.getDate() + 1);
    const needHistory = phoneHistoryNeeded(startKey, endKey);
    const seeded = {};
    for (const name of names) {
      const key = storeKeyFromName(name);
      if (!key) continue;
      const peeked = peekPhoneHistory(name, { dateFrom, dateTo });
      if (peeked?.calls) seeded[key] = peeked.calls;
    }
    setCallHistoryByStore(seeded);
    prefetchHomePhoneInboxes(phone.refreshInbox, names);
    if (!needHistory) return undefined;
    let cancelled = false;
    let historyNext = 0;
    const historyWorkers = Math.min(4, names.length);
    Promise.all(
      Array.from({ length: historyWorkers }, async () => {
        while (historyNext < names.length && !cancelled) {
          const name = names[historyNext];
          historyNext += 1;
          try {
            const payload = await fetchPhoneHistory(name, { dateFrom, dateTo });
            const key = storeKeyFromName(name);
            if (cancelled || !key) continue;
            setCallHistoryByStore((current) => ({ ...current, [key]: payload.calls || [] }));
          } catch {
            // The live inbox still covers this store.
          }
        }
      }),
    );
    return () => {
      cancelled = true;
    };
  }, [endKey, phone.refreshInbox, startKey, storeNamesKey]);

  useEffect(() => {
    if (!startKey || !endKey) {
      setReviewsByStore(new Map());
      return undefined;
    }
    const seeded = new Map();
    for (const place of GOOGLE_STORE_PLACES) {
      const cached = peekHomeStoreReviews(place.storeName, startKey, endKey);
      if (cached) seeded.set(place.storeName, cached);
    }
    setReviewsByStore(seeded);
    let cancelled = false;
    Promise.all(
      GOOGLE_STORE_PLACES.map(async (place) => {
        try {
          const fetched = await fetchGoogleReviewsForStore(place.storeName, {
            startDate: startKey,
            endDate: endKey,
          });
          if (cancelled) return;
          const reviews = fetched.reviews || [];
          rememberHomeStoreReviews(place.storeName, startKey, endKey, reviews);
          setReviewsByStore((current) => {
            const next = new Map(current);
            next.set(place.storeName, reviews);
            return next;
          });
        } catch {
          // Email and phone stay visible if Google is slow or down.
        }
      }),
    );
    return () => {
      cancelled = true;
    };
  }, [endKey, startKey]);

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
      const settings = settingsForStoreName(hoursByKey, row.store) || emptyStoreSettings(row.store);
      next.set(row.store, isStoreOpenNow(settings, now));
    }
    return next;
  }, [hoursByKey, nowTick, rows]);

  if (compact) {
    return (
      <View style={styles.homeStoreTableWrap}>
        <View style={styles.igStoreList}>
          {rows.map((row, index) => (
            <HomeStoreCard
              key={row.store}
              row={row}
              people={peopleByStore.get(row.store) || []}
              emailStats={emailByStore.get(row.store)}
              phoneStats={phoneByStore.get(row.store)}
              reviewStats={reviewByStore.get(row.store)}
              selected={selectedStore?.store === row.store}
              last={index === rows.length - 1}
              onOpenStore={onOpenStore}
              onOpenPerson={onOpenPerson}
              open={openByStore.get(row.store) === true}
              showAmounts={showAmounts}
              canOpen={canOpenStore ? canOpenStore(row) : true}
              peopleInteractive={peopleInteractive}
              amountFocus={amountFocus}
            />
          ))}
        </View>
      </View>
    );
  }

  const tableMinStyle = [styles.homeStoreTable, !showAmounts && styles.homeStoreTableNoAmounts];
  const focusedTotals = totals ? homeAmountForFocus(totals, amountFocus) : null;
  const sortedRows = useMemo(() => {
    if (!sort.key || sort.dir === 'default') return rows;
    const dir = sort.dir === 'asc' ? 1 : -1;
    const valueOf = (row) => {
      if (sort.key === 'store') return String(row.store || '');
      if (sort.key === 'email') return Number(emailByStore.get(row.store)?.rate);
      if (sort.key === 'phone') return Number(phoneByStore.get(row.store)?.rate);
      if (sort.key === 'review') return Number(reviewByStore.get(row.store)?.count);
      if (sort.key === 'people') return (peopleByStore.get(row.store) || []).length;
      return homeAmountForFocus(row, amountFocus).amount;
    };
    return [...rows].sort((a, b) => {
      const av = valueOf(a);
      const bv = valueOf(b);
      if (typeof av === 'string' || typeof bv === 'string') {
        return dir * String(av).localeCompare(String(bv), undefined, { sensitivity: 'base' });
      }
      const an = Number.isFinite(av) ? av : -1;
      const bn = Number.isFinite(bv) ? bv : -1;
      if (an !== bn) return dir * (an - bn);
      return String(a.store || '').localeCompare(String(b.store || ''), undefined, { sensitivity: 'base' });
    });
  }, [amountFocus, emailByStore, peopleByStore, phoneByStore, reviewByStore, rows, sort.dir, sort.key]);
  const tableContent = (
    <>
      <HomeStoresTableHeader
        showAmounts={showAmounts}
        sortKey={sort.key}
        sortDir={sort.dir}
        onSort={cycleSort}
        hideRule={hoveredStore === sortedRows[0]?.store}
      />
      {sortedRows.map((row, index) => (
        <HomeStoreTableRow
          key={row.store}
          row={row}
          people={peopleByStore.get(row.store) || []}
          emailStats={emailByStore.get(row.store)}
          phoneStats={phoneByStore.get(row.store)}
          reviewStats={reviewByStore.get(row.store)}
          selected={selectedStore?.store === row.store}
          last={index === sortedRows.length - 1 && !totals}
          onOpenStore={onOpenStore}
          onOpenPerson={onOpenPerson}
          open={openByStore.get(row.store) === true}
          showAmounts={showAmounts}
          canOpen={canOpenStore ? canOpenStore(row) : true}
          peopleInteractive={peopleInteractive}
          amountFocus={amountFocus}
          hideRule={
            hoveredStore === row.store || hoveredStore === sortedRows[index + 1]?.store
          }
          onHoverRow={setHoveredStore}
        />
      ))}
      {totals ? (
        <View
          style={[styles.homeStoreRow, styles.homeStoreTotalRow]}
          {...(Platform.OS === 'web' ? { className: 'cgold-home-total-row' } : null)}
        >
          <View style={styles.homeStoreIconSpacer} />
          <View style={styles.homeStoreRowBody}>
            <View style={styles.homeStoreColStore}>
              <Text style={styles.homeStoreTotalLabel}>Total</Text>
              <HomeLiveValue style={styles.homeStoreMeta} numeric={focusedTotals.count} numberOfLines={1}>
                {homeCountLabel(focusedTotals.count, amountFocus)}
              </HomeLiveValue>
            </View>
            <View style={styles.homeStoreRateSpacer} />
            <HomeEmailRate stats={totalEmailStats} />
            <HomePhoneRate stats={totalPhoneStats} />
            <HomeReviewRate stats={totalReviewStats} />
            <View style={styles.homeStoreTrailingGap} />
            {showAmounts ? (
              <View style={styles.homeStoreColPeople}>
                {totalPeople.length > 0 ? (
                  <HomePeopleStack
                    people={totalPeople}
                    compact
                    onOpenPerson={onOpenPerson}
                    interactive={peopleInteractive}
                  />
                ) : null}
              </View>
            ) : null}
            {showAmounts ? (
              <HomeStoreAmount
                amount={focusedTotals.amount}
                count={focusedTotals.count}
                breakdown={amountFocus === 'all' ? totals : null}
                strong
              />
            ) : (
              <View style={[styles.homeStoreColPeople, styles.homeStoreColPeopleTrailing]}>
                {totalPeople.length > 0 ? (
                  <HomePeopleStack
                    people={totalPeople}
                    compact
                    onOpenPerson={onOpenPerson}
                    trailing
                    interactive={peopleInteractive}
                  />
                ) : null}
              </View>
            )}
            <View style={styles.homeStoreChevron} />
          </View>
          <HomeStoreRowRule
            total
            hidden={hoveredStore === sortedRows[sortedRows.length - 1]?.store}
          />
        </View>
      ) : null}
    </>
  );

  return (
    <View style={styles.homeStoreTableWrap}>
      <View style={[styles.homeStoreTableCard, ...tableMinStyle]}>{tableContent}</View>
    </View>
  );
}

const HOME_FILTER_SIZE = MOBILE_FILTER_SIZE;
const HOME_TOP_FILTER_SIZE = 44;
const HOME_FILTER_RIGHT = MOBILE_FILTER_INSET;
// Mobile top-bar row: 8pt top + 32pt controls + 8pt bottom. Scroll views and
// the store drawer pad by this so content starts below the bar and slides
// underneath its blur.
const HOME_MOBILE_TOP_BAR_HEIGHT = 48;

function HomeFilterLines({ color, large = false }) {
  return (
    <View style={[styles.igFilterLines, large && styles.igFilterLinesLarge]}>
      <View style={[styles.igFilterLine, large && styles.igFilterLineLarge, { width: large ? 20 : 15, backgroundColor: color }]} />
      <View style={[styles.igFilterLine, large && styles.igFilterLineLarge, { width: large ? 14 : 11, backgroundColor: color }]} />
      <View style={[styles.igFilterLine, large && styles.igFilterLineLarge, { width: large ? 9 : 7, backgroundColor: color }]} />
    </View>
  );
}

function HomeGlyph({ size = 16, dimmed = false }) {
  return (
    <Image
      source={require('./assets/small_logo.png')}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        opacity: dimmed ? 0.55 : 1,
      }}
      resizeMode="cover"
      accessibilityIgnoresInvertColors
    />
  );
}

function tabGroupEdgeStyle(index, count) {
  if (count <= 1) return styles.tabEdgeSingle;
  if (index === 0) return styles.tabEdgeTop;
  if (index === count - 1) return styles.tabEdgeBottom;
  return styles.tabEdgeMiddle;
}

function HomeScreen({
  session,
  onRequireLogin,
  onOpenPerson,
  onOpenCustomer,
  onBuy,
  onSell,
  onOpenAnalytics,
  homeRootTick = 0,
  onSelectedStoreChange,
  onSelectedDocumentChange,
  documentCloseRef,
}) {
  const { isMobile, tableMaxWidth, pagePad, tablePagePad } = useHomePageLayout();
  const homeHeroPad = pagePad + HOME_STORE_NAME_INSET;
  const homeContentInset = useMemo(
    () => [
      styles.igHomeContentInset,
      isMobile
        ? { paddingHorizontal: pagePad }
        : {
            paddingLeft: pagePad,
            paddingRight: pagePad,
            width: '100%',
            ...(tableMaxWidth ? { maxWidth: tableMaxWidth } : null),
          },
    ],
    [isMobile, pagePad, tableMaxWidth],
  );
  const homeTableInset = useMemo(
    () => [
      styles.igHomeContentInset,
      styles.igHomeTableInset,
      isMobile
        ? { paddingHorizontal: 0 }
        : {
            paddingLeft: pagePad,
            paddingRight: pagePad,
            width: '100%',
            ...(tableMaxWidth ? { maxWidth: tableMaxWidth } : null),
          },
    ],
    [isMobile, pagePad, tableMaxWidth],
  );
  const tabBarScroll = useMobileTabBarScrollProps();
  const { canFilter, hasApp } = useAppAccess();
  const { money } = useDisplayCurrency();
  const homeRootRef = useRef(null);
  const filterButtonRef = useRef(null);
  const homeScrollYRef = useRef(0);
  const [stageHeight, setStageHeight] = useState(0);
  const [storeAppsOpen, setStoreAppsOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filterAnchor, setFilterAnchor] = useState({
    top: HOME_TOP_FILTER_SIZE + MOBILE_FILTER_INSET,
    right: MOBILE_FILTER_INSET,
  });
  const allowHomeFilters = canFilter('home');
  const dateRestricted = isRestrictedHomeEmployee(session?.profile);
  const assignedStore = allocatedStoreName(session?.profile);
  const appDate = useAppDate();
  const dateMode = appDate.mode;
  const startDate = parseDateParam(appDate.startDate);
  const endDate = parseDateParam(appDate.endDate);
  const [heroFocus, setHeroFocus] = useState('all');
  const [heroFocusLoading, setHeroFocusLoading] = useState(false);
  const heroFocusTimer = useRef(null);
  const heroDateOpenRef = useRef(null);
  const heroDateAnchorRef = useRef(null);
  const storeDateOpenRef = useRef(null);
  const storeDateAnchorRef = useRef(null);
  const tableFade = useRef(new Animated.Value(1)).current;
  const [storeRows, setStoreRows] = useState([]);
  const [selectedStore, setSelectedStore] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [staff, setStaff] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const requestId = useRef(0);
  const emailFetchedAt = useRef(0);
  const phone = usePhoneCalls();

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
  const heroDateLabel =
    dateMode === 'day'
      ? formatPickerDate(startDate)
      : `${formatPickerDate(startDate)} – ${formatPickerDate(endDate)}`;

  // Only the POS credentials matter for loading; profile edits (location,
  // role, avatar) must not restart the fetch loop.
  const posToken = session?.token || '';
  const posBaseUrl = session?.baseUrl || '';
  const posSystemKey = session?.systemKey || '';
  const posLinked = session?.linked || null;
  const posSession = useMemo(
    () =>
      posToken
        ? { token: posToken, baseUrl: posBaseUrl, systemKey: posSystemKey, linked: posLinked }
        : null,
    [posToken, posBaseUrl, posSystemKey, posLinked],
  );

  const load = useCallback(
    async ({ silent = false } = {}) => {
      if (!posSession) {
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
        const needEmail = !silent || Date.now() - emailFetchedAt.current > HOME_EMAIL_REFRESH_MS;
        const emailPromise = needEmail
          ? fetchHomeStoreSummaries(posSession, {
              startDate: startKey,
              endDate: endKey,
              extras: HOME_SUMMARY_EXTRAS,
            })
          : null;
        const fast = await fetchHomeStoreSummaries(posSession, {
          startDate: startKey,
          endDate: endKey,
          extras: HOME_FAST_EXTRAS,
        });
        if (id !== requestId.current) return;
        setStoreRows((current) => {
          const seeded = current.length ? current : peekHomeEmailRows(startKey, endKey) || [];
          return reconcileHomeRows(current, mergeHomeSummaryEmails(fast.rows, seeded));
        });
        setError(fast.warning || '');
        if (!silent) setLoading(false);

        if (!emailPromise) return;
        try {
          const rich = await emailPromise;
          if (id !== requestId.current) return;
          emailFetchedAt.current = Date.now();
          rememberHomeEmailRows(startKey, endKey, rich.rows);
          setStoreRows((current) => reconcileHomeRows(current, rich.rows));
          setError(rich.warning || '');
        } catch {
          // Totals already painted; email rates retry on the next pass.
        }
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
    [posSession, startKey, endKey],
  );

  // The open store follows its row: same object while nothing changed, the
  // fresh row when the poll brought new numbers.
  useEffect(() => {
    setSelectedStore((current) => {
      if (!current) return null;
      return storeRows.find((row) => row.store === current.store) || current;
    });
  }, [storeRows]);


  useEffect(() => {
    emailFetchedAt.current = 0;
    const cached = peekHomeEmailRows(startKey, endKey);
    if (cached?.length) {
      setStoreRows((current) => (current.length ? current : cached));
    }
  }, [endKey, startKey]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    prefetchHomePhoneInboxes(phone.refreshInbox, HOME_PHONE_STORES);
  }, [phone.refreshInbox]);

  const homeStoreNamesKey = useMemo(
    () => storeRows.map((row) => row.store).filter(Boolean).join('\n'),
    [storeRows],
  );
  useEffect(() => {
    if (!posSession || !homeStoreNamesKey) return undefined;
    // Warm the till positions the store drawers will show, once the table and
    // its email / phone / review rates have had the network to themselves.
    return scheduleWarmup(
      () => prefetchStoreCashPositions(posSession, homeStoreNamesKey.split('\n')),
      2500,
    );
  }, [homeStoreNamesKey, posSession]);

  useEffect(() => {
    if (!homeStoreNamesKey) return;
    prefetchHomePhoneInboxes(phone.refreshInbox, homeStoreNamesKey.split('\n'));
  }, [homeStoreNamesKey, phone.refreshInbox]);

  useEffect(() => {
    let cancelled = false;
    listStaffProfiles()
      .then((rows) => {
        if (cancelled) return;
        setStaff(mergeStaffWithEmployeeRoster((rows || []).filter((row) => row.isActive !== false)));
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

  const visibleRows = storeRows;

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

  const listedRows = useMemo(() => sortRowsForHeroFocus(visibleRows, heroFocus), [heroFocus, visibleRows]);
  const heroTotals = homeAmountForFocus(totals, heroFocus);
  const selectHeroFocus = useCallback((next) => {
    if (next === heroFocus || heroFocusLoading) return;
    setHeroFocusLoading(true);
    if (heroFocusTimer.current) clearTimeout(heroFocusTimer.current);
    heroFocusTimer.current = setTimeout(() => {
      setHeroFocus(next);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setHeroFocusLoading(false));
      });
    }, 70);
  }, [heroFocus, heroFocusLoading]);
  const toggleHeroFocus = (next) => {
    selectHeroFocus(heroFocus === next ? 'all' : next);
  };

  useEffect(() => {
    Animated.timing(tableFade, {
      toValue: heroFocusLoading ? 0.22 : 1,
      duration: heroFocusLoading ? 100 : 240,
      useNativeDriver: true,
    }).start();
  }, [heroFocusLoading, tableFade]);

  useEffect(
    () => () => {
      if (heroFocusTimer.current) clearTimeout(heroFocusTimer.current);
    },
    [],
  );

  const handleHomeDateChange = appDate.applyPicker;

  const selectToday = () => {
    if (dateRestricted) return;
    const day = parseDateParam(new Date());
    handleHomeDateChange({ mode: 'day', start: day, end: day });
  };
  const storeHistoryRef = useRef({ entry: false, fromPop: false });
  const [homeDocRef, setHomeDocRef] = useState('');
  const fallbackDocCloseRef = useRef(null);
  const closeHomeDocRef = documentCloseRef || fallbackDocCloseRef;

  const openStore = useCallback(
    (row) => {
      if (!allowHomeFilters && !rowMatchesAllocatedStore(row, assignedStore)) return;
      setStoreAppsOpen(false);
      setFiltersOpen(false);
      setSelectedStore(row);
      if (Platform.OS === 'web' && typeof window !== 'undefined' && window.history) {
        const state = { cgoldHomeStore: row.store };
        if (storeHistoryRef.current.entry) {
          window.history.replaceState(state, '', window.location.href);
        } else {
          window.history.pushState(state, '', window.location.href);
          storeHistoryRef.current.entry = true;
        }
      }
    },
    [allowHomeFilters, assignedStore],
  );

  useEffect(() => {
    if (!selectedStore) return;
    if (canOpenHomeStore(selectedStore)) return;
    setSelectedStore(null);
  }, [selectedStore, canOpenHomeStore]);

  const closeStore = useCallback(() => {
    closeHomeDocRef.current?.();
    setStoreAppsOpen(false);
    setSelectedStore(null);
    if (
      Platform.OS === 'web' &&
      typeof window !== 'undefined' &&
      storeHistoryRef.current.entry &&
      !storeHistoryRef.current.fromPop
    ) {
      storeHistoryRef.current.entry = false;
      window.history.back();
      return;
    }
    storeHistoryRef.current.entry = false;
  }, []);

  const closeStoreOrDocument = useCallback(() => {
    if (homeDocRef && closeHomeDocRef.current) {
      closeHomeDocRef.current();
      return;
    }
    closeStore();
  }, [closeStore, homeDocRef]);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return undefined;
    const onPopState = () => {
      if (!storeHistoryRef.current.entry) return;
      storeHistoryRef.current.fromPop = true;
      storeHistoryRef.current.entry = false;
      setStoreAppsOpen(false);
      setSelectedStore(null);
      storeHistoryRef.current.fromPop = false;
    };
    window.addEventListener('popstate', onPopState);
    return () => {
      window.removeEventListener('popstate', onPopState);
      if (storeHistoryRef.current.entry) {
        storeHistoryRef.current.entry = false;
        window.history.replaceState({}, '', window.location.href);
      }
    };
  }, []);

  const homeRootTickRef = useRef(homeRootTick);
  useEffect(() => {
    if (homeRootTickRef.current === homeRootTick) return;
    homeRootTickRef.current = homeRootTick;
    closeStore();
  }, [homeRootTick, closeStore]);

  useEffect(() => {
    onSelectedStoreChange?.(selectedStore?.store || '');
    return () => onSelectedStoreChange?.('');
  }, [onSelectedStoreChange, selectedStore?.store]);

  useEffect(() => {
    onSelectedDocumentChange?.(homeDocRef);
    return () => onSelectedDocumentChange?.('');
  }, [homeDocRef, onSelectedDocumentChange]);

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

  const renderHiddenDatePicker = (openRef, anchorRef) => (
    <HomeDatePicker
      startDate={startDate}
      endDate={endDate}
      dateMode={dateMode}
      onChange={handleHomeDateChange}
      maximumDate={new Date()}
      hideField
      openRef={openRef}
      anchorRef={anchorRef}
      disabled={dateRestricted}
    />
  );

  const filtersActive = dateMode === 'range' || (dateMode === 'day' && !isToday);
  const closeFilters = () => setFiltersOpen(false);
  const placeFilterMenu = () => {
    const button = filterButtonRef.current;
    const home = homeRootRef.current;
    if (!button?.measureInWindow || !home?.measureInWindow) return;
    button.measureInWindow((x, y, width, height) => {
      home.measureInWindow((homeX, homeY, homeWidth) => {
        setFilterAnchor({
          top: y - homeY + height + 8,
          right: Math.max(8, homeWidth - (x - homeX + width)),
        });
      });
    });
  };

  const showHomeHero = !(loading && storeRows.length === 0) && visibleRows.length > 0;
  const onHomeScroll = (event) => {
    tabBarScroll.onScroll?.(event);
    const y = event?.nativeEvent?.contentOffset?.y;
    if (!Number.isFinite(y)) return;
    const dy = y - homeScrollYRef.current;
    homeScrollYRef.current = y;
    if (dy > 4) {
      if (filtersOpen) setFiltersOpen(false);
      if (storeAppsOpen) setStoreAppsOpen(false);
    }
  };

  const pressHomeFilter = () => {
    expandMobileTabBar();
    if (selectedStore) {
      setStoreAppsOpen((open) => !open);
      return;
    }
    placeFilterMenu();
    setFiltersOpen((open) => !open);
  };

  const heroStatInteractive = true;
  const renderDateHero = (openRef, anchorRef, inset = true) => (
    <View
      ref={anchorRef}
      collapsable={false}
      style={[styles.igHomeHeroPair, !isMobile && inset && { paddingLeft: HOME_STORE_NAME_INSET }]}
    >
      <View style={[styles.igHomeHeroMetricMain, styles.igHomeHeroRevenueStack]}>
        <Text
          style={[
            styles.igHomeHeroAmount,
            styles.igHomeHeroAmountEnd,
            !isMobile && styles.igHomeHeroAmountDesktop,
          ]}
          numberOfLines={1}
        >
          {heroDateLabel}
        </Text>
        <Text style={styles.igHomeHeroBlockTitle}>Date</Text>
      </View>
      <View
        style={[
          styles.igHomeHeroStats,
          styles.igHomeHeroStatsSide,
          !isMobile && styles.igHomeHeroStatsSideDesktop,
        ]}
      >
        <HomeHeroStat
          compact
          interactive={!dateRestricted}
          label="Today"
          value=""
          selected={isToday}
          onPress={selectToday}
        />
        <HomeHeroStat
          compact
          interactive={!dateRestricted}
          label="Change"
          value=""
          selected={dateMode === 'day' && !isToday}
          onPress={() => {
            if (dateRestricted) return;
            openRef.current?.({ range: false });
          }}
        />
        <HomeHeroStat
          compact
          interactive={!dateRestricted}
          label="Range"
          value=""
          selected={dateMode === 'range'}
          onPress={() => {
            if (dateRestricted) return;
            openRef.current?.({ range: true });
          }}
        />
      </View>
      {renderHiddenDatePicker(openRef, anchorRef)}
    </View>
  );
  const txStats = (
    <>
      <HomeHeroStat
        compact={!hideHomeAmounts}
        interactive={heroStatInteractive}
        value={totals.txCount}
        numeric={totals.txCount}
        format={formatHomeCountTick}
        reel
        label="Tx"
        selected={heroFocus === 'all'}
        onPress={() => selectHeroFocus('all')}
      />
      <HomeHeroStat
        compact={!hideHomeAmounts}
        interactive={heroStatInteractive}
        value={totals.saleCount}
        numeric={totals.saleCount}
        format={formatHomeCountTick}
        reel
        label="Sales"
        selected={heroFocus === 'sales'}
        onPress={() => toggleHeroFocus('sales')}
      />
      <HomeHeroStat
        compact={!hideHomeAmounts}
        interactive={heroStatInteractive}
        value={totals.purchaseCount}
        numeric={totals.purchaseCount}
        format={formatHomeCountTick}
        reel
        label="Purchases"
        selected={heroFocus === 'purchases'}
        onPress={() => toggleHeroFocus('purchases')}
      />
    </>
  );
  const heroInset = (
    <View
      style={[
        styles.igHomeHeroInset,
        !isMobile && styles.igHomeHeroInsetDesktop,
      ]}
    >
      <View
        style={[
          styles.igHomeHeroSplit,
          isMobile && styles.igHomeHeroSplitMobile,
          hideHomeAmounts && styles.igHomeHeroSplitBare,
        ]}
      >
        {hideHomeAmounts ? null : renderDateHero(heroDateOpenRef, heroDateAnchorRef)}
        <View
          style={[
            styles.igHomeHeroFigures,
            hideHomeAmounts && styles.igHomeHeroFiguresBare,
          ]}
        >
        <View
          style={[
            styles.igHomeHeroPair,
            !isMobile && !hideHomeAmounts && styles.igHomeHeroPairEnd,
            hideHomeAmounts && styles.igHomeHeroPairBare,
          ]}
        >
          {hideHomeAmounts ? (
            txStats
          ) : (
            <>
              {isMobile ? null : (
                <View style={[styles.igHomeHeroMetricMain, styles.igHomeHeroRevenueStack]}>
                  <View style={[styles.igHomeHeroAmountSlot, styles.igHomeHeroAmountSlotTight, styles.igHomeHeroRevenueAmount]}>
                    {heroFocusLoading ? (
                      <ActivityIndicator color="#1d1d1f" />
                    ) : (
                      <HomeReelValue
                        style={[
                          styles.igHomeHeroAmount,
                          styles.igHomeHeroAmountEnd,
                          styles.igHomeHeroAmountDesktop,
                        ]}
                        value={heroTotals.amount}
                        kind="currency"
                        accessibilityLabel={money(heroTotals.amount)}
                      />
                    )}
                  </View>
                  <Text style={styles.igHomeHeroBlockTitle}>Revenue</Text>
                </View>
              )}
              <View
                style={[
                  styles.igHomeHeroStats,
                  styles.igHomeHeroStatsSide,
                  !isMobile && styles.igHomeHeroStatsSideDesktop,
                ]}
              >
                {txStats}
              </View>
            </>
          )}
        </View>
        </View>
      </View>
    </View>
  );
  const homeHeroCard = <View style={styles.igHomeHeroShell}>{heroInset}</View>;

  return (
    <View style={[styles.toolsScreen, styles.canvasFill, styles.igHomeScreen, !isMobile && styles.igHomeDesktopHost]}>
      <View
        ref={homeRootRef}
        style={[styles.toolsScreen, styles.canvasFill, styles.igHomeScreen, !isMobile && styles.igHomeDesktopFeed]}
      >
      {isMobile ? (
        <View pointerEvents="box-none" style={styles.igHomeMobileTopBarShell}>
          <View style={styles.igHomeMobileTopBarClip}>
            <BlurView
              intensity={32}
              tint="light"
              pointerEvents="none"
              style={styles.igHomeMobileTopBarBlur}
              {...(Platform.OS === 'web' ? { className: 'cgold-mobile-tab-bar' } : null)}
            />
            <View style={styles.igHomeMobileTopBarRow}>
              {selectedStore ? (
                <View style={styles.igHomeMobileStoreLeft}>
                  <Pressable
                    onPress={closeStoreOrDocument}
                    hitSlop={8}
                    style={styles.igHomeMobileCrumbHome}
                    accessibilityRole="button"
                    accessibilityLabel={homeDocRef ? 'Back to store' : 'Back to Home'}
                  >
                    <HomeGlyph size={22} />
                  </Pressable>
                  <Text style={styles.igHomeMobileCrumbSep} accessible={false}>
                    /
                  </Text>
                  <Text style={styles.igHomeMobileStoreName} numberOfLines={1}>
                    {selectedStore.store}
                  </Text>
                </View>
              ) : (
                <View style={styles.igHomeMobileBrand} accessibilityLabel="Canada Gold">
                  <HomeGlyph size={22} />
                </View>
              )}
              <View style={styles.igHomeMobileTopBarTrailing}>
          <View
            ref={heroDateAnchorRef}
            collapsable={false}
            style={styles.igHomeMobileDateAnchor}
          >
            <Pressable
              onPress={() => {
                if (dateRestricted) return;
                expandMobileTabBar();
                heroDateOpenRef.current?.({ range: dateMode === 'range' });
              }}
              style={({ pressed }) => [
                styles.igHomeMobileDateBtn,
                dateMode === 'range' || (dateMode === 'day' && !isToday)
                  ? styles.igHomeMobileDateBtnActive
                  : null,
                dateRestricted && styles.igHomeMobileDateBtnDisabled,
                pressed && !dateRestricted && styles.igHomeMobileDateBtnPressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel={`Date: ${heroDateLabel}`}
              accessibilityHint="Change date or set a range"
              disabled={dateRestricted}
            >
              <Ionicons name="calendar-outline" size={15} color={MOBILE.secondary} />
              <Text style={styles.igHomeMobileDateText} numberOfLines={1}>
                {heroDateLabel}
              </Text>
              <View style={styles.igHomeMobileDateChevrons}>
                <Ionicons name="chevron-up" size={9} color="#8e8e93" />
                <Ionicons name="chevron-down" size={9} color="#8e8e93" style={styles.topSpotChevronDown} />
              </View>
            </Pressable>
            {renderHiddenDatePicker(heroDateOpenRef, heroDateAnchorRef)}
          </View>
          <Pressable
            ref={filterButtonRef}
            onLayout={placeFilterMenu}
            onPress={pressHomeFilter}
            hitSlop={6}
            style={({ pressed }) => [
              styles.igHomeMobileFilterBtn,
              (selectedStore ? storeAppsOpen : filtersOpen || filtersActive) &&
                styles.igHomeMobileFilterBtnActive,
              pressed && styles.igHomeMobileFilterBtnPressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel={selectedStore ? `${selectedStore.store} apps` : 'Home filters'}
            accessibilityState={{ expanded: selectedStore ? storeAppsOpen : filtersOpen }}
          >
            <HomeFilterLines
              color={
                (selectedStore ? storeAppsOpen : filtersOpen || filtersActive) ? TAB_INK : '#3A3A3C'
              }
            />
          </Pressable>
              </View>
            </View>
          </View>
        </View>
      ) : null}
      <View
        style={styles.igHomeStage}
        onLayout={(event) => {
          const height = event.nativeEvent.layout.height;
          setStageHeight((current) => (Math.abs(current - height) < 0.5 ? current : height));
        }}
      >
      <ScrollView
        style={[styles.toolsScroll, styles.igHomeOverlayScroll]}
        contentContainerStyle={[
          styles.igHomeScroll,
          styles.igHomeScrollContent,
          {
            flexGrow: 1,
            paddingTop: isMobile ? HOME_MOBILE_TOP_BAR_HEIGHT : TOP_BAR_HEIGHT + homeHeroPad - 10,
            paddingBottom: isMobile ? mobileTabBarReserve() + 8 : 24,
          },
        ]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        bounces={false}
        overScrollMode="never"
        {...tabBarScroll}
        {...(Platform.OS === 'web' ? { className: 'cgold-home-overlay-scroll' } : null)}
        onScroll={onHomeScroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor="#8e8e93" />}
      >
        <View style={homeContentInset}>
          {!isMobile && showHomeHero ? (
            <View
              style={[
                styles.igHomePinnedTop,
                !isMobile && styles.igHomePinnedTopDesktop,
              ]}
            >
              {homeHeroCard}
            </View>
          ) : null}
          {error ? <Text style={[styles.errorText, styles.homeError]}>{error}</Text> : null}

          {loading && storeRows.length === 0 ? (
            <View pointerEvents="auto" style={[styles.homeTableEmpty, styles.igHomeScrollEnd]}>
              <ActivityIndicator color="#1d1d1f" />
            </View>
          ) : visibleRows.length === 0 ? (
            <Text pointerEvents="auto" style={[styles.toolsEmpty, styles.igHomeScrollEnd]}>
              No store activity in this period.
            </Text>
          ) : null}
        </View>
        {visibleRows.length > 0 ? (
          <View style={homeTableInset}>
            <View
              pointerEvents="auto"
              style={[
                styles.toolsSection,
                styles.toolsSectionMobile,
                styles.igHomeSection,
                isMobile && styles.igHomeSectionMobile,
                styles.igHomeTableSection,
                isMobile && styles.igHomeTableSectionMobile,
                !isMobile && styles.igHomeDesktopSheet,
                stageHeight > 0 ? { minHeight: stageHeight } : null,
              ]}
            >
              {visibleRows.length > 0 ? (
                <View style={styles.homeFocusStage}>
                  <Animated.View style={{ opacity: tableFade }} pointerEvents={heroFocusLoading ? 'none' : 'auto'}>
                    <HomeStoresTable
                      rows={listedRows}
                      selectedStore={null}
                      totals={!isMobile && !hideHomeAmounts ? totals : null}
                      staff={staff}
                      startKey={startKey}
                      endKey={endKey}
                      onOpenStore={openStore}
                      onOpenPerson={onOpenPerson}
                      compact={isMobile}
                      showAmounts={!hideHomeAmounts}
                      canOpenStore={canOpenHomeStore}
                      amountFocus={heroFocus}
                    />
                  </Animated.View>
                  {heroFocusLoading ? (
                    <View style={styles.homeFocusLoading} pointerEvents="none">
                      <ActivityIndicator color="#1d1d1f" />
                    </View>
                  ) : null}
                </View>
              ) : null}
            </View>
          </View>
        ) : null}
      </ScrollView>
      </View>

      {isMobile && !selectedStore && filtersOpen ? (
        <View style={styles.igHomeFilterLayer}>
          <Pressable style={StyleSheet.absoluteFill} onPress={closeFilters} accessibilityLabel="Close filters" />
          <View
            style={[
              styles.igHomeFilterCard,
              styles.igHomeFiltersCard,
              { top: filterAnchor.top, right: filterAnchor.right },
            ]}
          >
            <BlurView
              intensity={32}
              tint="light"
              style={styles.igHomeFiltersCardBlur}
              {...(Platform.OS === 'web' ? { className: 'cgold-mobile-tab-bar' } : null)}
            />
            <View style={styles.igHomeFiltersCardBody}>
              <View style={styles.igHomeFiltersControls}>
                <CurrencyToggle compact />
                <SpotMetalToggle compact />
              </View>
              <View style={styles.igHomeFiltersTradeRow}>
                <Pressable
                  onPress={() => {
                    closeFilters();
                    onBuy?.();
                  }}
                  style={({ pressed }) => [
                    styles.topTradeButton,
                    styles.igHomeFiltersTradeBtn,
                    pressed && styles.topTradeButtonHover,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Buy"
                >
                  <Ionicons name="arrow-down" size={TAB_ICON_SIZE} color={TRADE_BUY.accent} />
                  <Text style={styles.topTradeLabel}>Buy</Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    closeFilters();
                    onSell?.();
                  }}
                  style={({ pressed }) => [
                    styles.topTradeButton,
                    styles.igHomeFiltersTradeBtn,
                    pressed && styles.topTradeButtonHover,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Sell"
                >
                  <Ionicons name="arrow-up" size={TAB_ICON_SIZE} color={TRADE_SELL.accent} />
                  <Text style={styles.topTradeLabel}>Sell</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </View>
      ) : null}

      <HomeStoreDrawer
        visible={Boolean(selectedStore)}
        store={selectedStore}
        session={session}
        onOpenCustomer={onOpenCustomer}
        periodLabel={periodLabel}
        date={startDate}
        startKey={startKey}
        endKey={endKey}
        onClose={closeStore}
        appsOpen={storeAppsOpen}
        onAppsOpenChange={setStoreAppsOpen}
        txFocus={heroFocus}
        mobileChromeWidth={0}
        dateHero={!isMobile && !hideHomeAmounts ? renderDateHero(storeDateOpenRef, storeDateAnchorRef, false) : null}
        contentPadTop={isMobile ? HOME_MOBILE_TOP_BAR_HEIGHT : TOP_BAR_HEIGHT + homeHeroPad - 10}
        onSelectedDocumentChange={setHomeDocRef}
        documentCloseRef={closeHomeDocRef}
      />

      </View>
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
  const appDate = useAppDate();
  const initialRange = useMemo(() => defaultDateRange(7), []);
  const dateMode = appDate.mode;
  const startDate = parseDateParam(appDate.startDate);
  const endDate = parseDateParam(appDate.endDate);
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
    appDate.applyPicker({
      mode: formatDateParam(nextStart) === formatDateParam(nextEnd) ? 'day' : 'range',
      start: nextStart,
      end: nextEnd,
    });
    onFocusConsumed?.();
  }, [appDate, focus, onFocusConsumed]);

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
        extras: HOME_SUMMARY_EXTRAS,
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
    appDate.applyPicker({ mode: 'day', start: day, end: day });
  };

  const selectRange = () => {
    if (formatDateParam(startDate) === formatDateParam(endDate)) {
      appDate.applyPicker({ mode: 'range', start: initialRange.start, end: initialRange.end });
      return;
    }
    appDate.applyPicker({ mode: 'range', start: startDate, end: endDate });
  };

  const handleDayChange = (date) => {
    const next = parseDateParam(date);
    appDate.applyPicker({ mode: 'day', start: next, end: next });
  };

  const handleStartChange = (date) => {
    const next = parseDateParam(date);
    appDate.applyPicker({ mode: 'range', start: next, end: next > endDate ? next : endDate });
  };

  const handleEndChange = (date) => {
    const next = parseDateParam(date);
    appDate.applyPicker({ mode: 'range', start: next < startDate ? next : startDate, end: next });
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
  const appDate = useAppDate();
  const initialRange = useMemo(() => defaultDateRange(7), []);
  const dateMode = appDate.mode;
  const startDate = parseDateParam(appDate.startDate);
  const endDate = parseDateParam(appDate.endDate);
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
            capturePurchasePriceCatalog(enriched).catch(() => {});
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
        setStaff(mergeStaffWithEmployeeRoster((rows || []).filter((row) => row.isActive !== false)));
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
    appDate.applyPicker({ mode: 'day', start: day, end: day });
  };

  const selectRange = () => {
    if (formatDateParam(startDate) === formatDateParam(endDate)) {
      appDate.applyPicker({ mode: 'range', start: initialRange.start, end: initialRange.end });
      return;
    }
    appDate.applyPicker({ mode: 'range', start: startDate, end: endDate });
  };

  const handleDayChange = (date) => {
    const next = parseDateParam(date);
    appDate.applyPicker({ mode: 'day', start: next, end: next });
  };

  const handleStartChange = (date) => {
    const next = parseDateParam(date);
    appDate.applyPicker({ mode: 'range', start: next, end: next > endDate ? next : endDate });
  };

  const handleEndChange = (date) => {
    const next = parseDateParam(date);
    appDate.applyPicker({ mode: 'range', start: next < startDate ? next : startDate, end: next });
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
  grouped = false,
  edge,
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
        grouped && styles.tabGrouped,
        grouped && collapsed && styles.tabGroupedCollapsed,
        grouped && !collapsed && styles.tabGroupedExpanded,
        edge,
        collapsed && styles.tabCollapsed,
        subtitle && !collapsed && styles.tabWithSubtitle,
        extraStyle,
        paintChrome && active && styles.tabActive,
      ]}
    >
      <View
        style={[
          styles.tabGlyph,
          collapsed && styles.tabGlyphCollapsed,
          !collapsed && styles.tabGlyphExpanded,
        ]}
      >
        {leading || (
          <Ionicons
            name={active ? filledIonicon(icon) : icon}
            size={TAB_ICON_SIZE}
            color={active ? MOBILE.label : MOBILE.secondary}
          />
        )}
      </View>
      <View
        style={[styles.tabLabelColumn, collapsed && styles.tabLabelColumnCollapsed]}
        pointerEvents={collapsed ? 'none' : 'auto'}
        accessibilityElementsHidden={collapsed}
        importantForAccessibility={collapsed ? 'no-hide-descendants' : 'auto'}
      >
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
      {trailing ? (
        <View
          style={collapsed ? styles.tabTrailingCollapsed : styles.tabTrailing}
          pointerEvents={collapsed ? 'none' : 'auto'}
        >
          {trailing}
        </View>
      ) : null}
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
    'in transit': 'TRN',
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

function ProfileStoreButton({ locationName, onPress }) {
  const storeCode = locationShortLabel(locationName);
  const storeLabel = locationName ? `Switch store, ${locationName}` : 'Choose store location';

  return (
    <Pressable
      onPress={(event) => {
        event?.stopPropagation?.();
        onPress?.();
      }}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={storeLabel}
      {...(Platform.OS === 'web' ? { title: storeLabel } : null)}
      style={({ pressed }) => [styles.profileStoreButton, pressed && styles.profileStoreButtonPressed]}
    >
      {storeCode ? (
        <View style={[styles.profileStoreMark, { backgroundColor: storeAccent(locationName) }]}>
          <Text style={styles.profileStoreMarkText} numberOfLines={1}>
            {storeCode}
          </Text>
        </View>
      ) : (
        <Ionicons name="storefront-outline" size={TAB_ICON_SIZE} color="#c7c7cc" />
      )}
    </Pressable>
  );
}

function TopTradeButton({ kind, label, active, onPress }) {
  const palette = kind === 'sell' ? TRADE_SELL : TRADE_BUY;
  const hint =
    kind === 'sell' ? 'Sell metal to a customer' : 'Buy metal from a customer';
  const labelColor = active ? MOBILE.label : MOBILE.secondary;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ selected: active }}
      {...(Platform.OS === 'web' ? { title: `${label} — ${hint}` } : null)}
      style={({ hovered, pressed }) => [
        styles.topTradeButton,
        (hovered || pressed) && !active && styles.topTradeButtonHover,
        active && styles.tabActive,
      ]}
    >
      <Ionicons
        name={active ? filledIonicon(palette.icon) : palette.icon}
        size={TAB_ICON_SIZE}
        color={active ? MOBILE.label : palette.accent}
      />
      <Text
        style={[styles.topTradeLabel, { color: labelColor }, active && styles.tradeButtonLabelActive]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function TopDateToggle() {
  const { mode, startDate, endDate, label, applyPicker } = useAppDate();
  const fieldRef = useRef(null);
  const openRef = useRef(null);
  const [open, setOpen] = useState(false);

  return (
    <View ref={fieldRef} collapsable={false} style={styles.topSpotWrap}>
      <Pressable
        onPress={() => {
          if (open) openRef.current?.({ close: true });
          else openRef.current?.();
        }}
        style={[styles.topSpot, styles.topDateField, mode === 'range' && styles.topDateFieldRange]}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`Date ${label}`}
      >
        <Ionicons name="calendar-outline" size={14} color={MOBILE.secondary} />
        <Text style={styles.topSpotPrice} numberOfLines={1}>
          {label}
        </Text>
        <View style={styles.topSpotChevrons}>
          <Ionicons name="chevron-up" size={9} color="#8e8e93" />
          <Ionicons name="chevron-down" size={9} color="#8e8e93" style={styles.topSpotChevronDown} />
        </View>
      </Pressable>
      <HomeDatePicker
        hideField
        startDate={startDate}
        endDate={endDate}
        dateMode={mode}
        onChange={applyPicker}
        maximumDate={new Date()}
        openRef={openRef}
        anchorRef={fieldRef}
        onOpenChange={setOpen}
      />
    </View>
  );
}

function TopNavSearch({ value, onChangeText, onFocus, onSubmit, onClear }) {
  return (
    <View style={styles.topSearchField}>
      <Ionicons name="search-outline" size={TAB_ICON_SIZE} color={MOBILE.secondary} />
      <TextInput
        style={styles.topSearchInput}
        value={value}
        onChangeText={onChangeText}
        onFocus={onFocus}
        onSubmitEditing={onSubmit}
        placeholder="Search"
        placeholderTextColor={MOBILE.secondary}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        clearButtonMode="while-editing"
      />
      {value ? (
        <Pressable onPress={onClear} hitSlop={8} accessibilityLabel="Clear search">
          <Ionicons name="close-circle" size={16} color="#c7c7cc" />
        </Pressable>
      ) : null}
    </View>
  );
}

function formatSpotMoney(value) {
  return `$${new Intl.NumberFormat('en-CA', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value) || 0)}`;
}

function SpotMetalToggle({ compact = false }) {
  const { currency, fromCad, quotes, spotSymbol, setSpotSymbol } = useDisplayCurrency();
  const [open, setOpen] = useState(false);
  const fieldRef = useRef(null);
  const [anchor, setAnchor] = useState(null);
  const selected = quotes.find((quote) => quote.symbol === spotSymbol) || quotes[0] || SPOT_METALS[0];
  const empty = selected?.price == null;
  const shown = empty ? null : fromCad(selected.price);
  const label = selected?.name || 'Gold';

  const close = () => {
    setOpen(false);
    setAnchor(null);
  };

  const openMenu = () => {
    const node = fieldRef.current;
    if (node?.measureInWindow) {
      node.measureInWindow((x, y, width, height) => {
        setAnchor({ x, y, width, height });
        setOpen(true);
      });
      return;
    }
    setAnchor(null);
    setOpen(true);
  };

  const pick = (symbol) => {
    setSpotSymbol(symbol);
    close();
  };

  const menuLeft = anchor
    ? Math.min(Math.max(12, anchor.x), Math.max(12, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 196))
    : 16;
  const menuTop = anchor ? anchor.y + anchor.height + 6 : 56;

  return (
    <>
      <View ref={fieldRef} collapsable={false} style={[styles.topSpotWrap, compact && styles.topSpotWrapCompact]}>
        <Text style={[styles.topSpotMetal, compact && styles.topSpotMetalCompact]} numberOfLines={1}>
          {label}
        </Text>
        <Pressable
          onPress={open ? close : openMenu}
          style={[styles.topSpot, compact && styles.topSpotCompact]}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel={`${label} spot ${empty ? 'unavailable' : `${formatSpotMoney(shown)} ${currency}`}`}
        >
          <Text style={[styles.topSpotPrice, compact && styles.topSpotPriceCompact]} numberOfLines={1}>
            {empty ? '—' : formatSpotMoney(shown)}
          </Text>
          <View style={styles.topSpotChevrons}>
            <Ionicons name="chevron-up" size={compact ? 10 : 9} color="#8e8e93" />
            <Ionicons name="chevron-down" size={compact ? 10 : 9} color="#8e8e93" style={styles.topSpotChevronDown} />
          </View>
        </Pressable>
      </View>
      <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
        <View style={styles.topSpotOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel="Close metal picker" />
          <View style={[styles.topSpotMenu, { top: menuTop, left: compact ? undefined : menuLeft, right: compact ? 16 : undefined }]}>
            {SPOT_METALS.map((metal) => {
              const quote = quotes.find((row) => row.symbol === metal.symbol);
              const quoteEmpty = quote?.price == null;
              const quoteShown = quoteEmpty ? null : fromCad(quote.price);
              const active = metal.symbol === (selected?.symbol || spotSymbol);
              return (
                <Pressable
                  key={metal.symbol}
                  onPress={() => pick(metal.symbol)}
                  style={[styles.topSpotOption, active && styles.topSpotOptionActive]}
                  accessibilityRole="menuitem"
                  accessibilityState={{ selected: active }}
                >
                  <Text style={[styles.topSpotOptionName, active && styles.topSpotOptionNameActive]}>
                    {metal.name}
                  </Text>
                  <Text style={[styles.topSpotOptionPrice, active && styles.topSpotOptionPriceActive]}>
                    {quoteEmpty ? '—' : formatSpotMoney(quoteShown)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </Modal>
    </>
  );
}

function CurrencyToggle({ compact = false }) {
  const { currency, setCurrency } = useDisplayCurrency();
  const [open, setOpen] = useState(false);
  const fieldRef = useRef(null);
  const [anchor, setAnchor] = useState(null);

  const close = () => {
    setOpen(false);
    setAnchor(null);
  };

  const openMenu = () => {
    const node = fieldRef.current;
    if (node?.measureInWindow) {
      node.measureInWindow((x, y, width, height) => {
        setAnchor({ x, y, width, height });
        setOpen(true);
      });
      return;
    }
    setAnchor(null);
    setOpen(true);
  };

  const pick = (code) => {
    setCurrency(code);
    close();
  };

  const menuLeft = anchor
    ? Math.min(Math.max(12, anchor.x), Math.max(12, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 196))
    : 16;
  const menuTop = anchor ? anchor.y + anchor.height + 6 : 56;

  return (
    <>
      <View ref={fieldRef} collapsable={false} style={[styles.topSpotWrap, compact && styles.topSpotWrapCompact]}>
        <Text style={[styles.topSpotMetal, compact && styles.topSpotMetalCompact]} numberOfLines={1}>
          Currency
        </Text>
        <Pressable
          onPress={open ? close : openMenu}
          style={[styles.topSpot, styles.topCurrencyField, compact && styles.topSpotCompact]}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel={currency === 'USD' ? 'US dollars' : 'Canadian dollars'}
        >
          <Text style={[styles.topSpotPrice, compact && styles.topSpotPriceCompact]} numberOfLines={1}>
            {currency}
          </Text>
          <View style={styles.topSpotChevrons}>
            <Ionicons name="chevron-up" size={compact ? 10 : 9} color="#8e8e93" />
            <Ionicons name="chevron-down" size={compact ? 10 : 9} color="#8e8e93" style={styles.topSpotChevronDown} />
          </View>
        </Pressable>
      </View>
      <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
        <View style={styles.topSpotOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel="Close currency picker" />
          <View style={[styles.topSpotMenu, { top: menuTop, left: compact ? undefined : menuLeft, right: compact ? 16 : undefined }]}>
            {DISPLAY_CURRENCIES.map((code) => {
              const active = currency === code;
              return (
                <Pressable
                  key={code}
                  onPress={() => pick(code)}
                  style={[styles.topSpotOption, active && styles.topSpotOptionActive]}
                  accessibilityRole="menuitem"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={code === 'USD' ? 'US dollars' : 'Canadian dollars'}
                >
                  <Text style={[styles.topSpotOptionName, active && styles.topSpotOptionNameActive]}>
                    {code}
                  </Text>
                  <Text style={[styles.topSpotOptionPrice, active && styles.topSpotOptionPriceActive]}>
                    {code === 'USD' ? 'US dollars' : 'Canadian dollars'}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </Modal>
    </>
  );
}

function TopNavBar({
  buyActive,
  sellActive,
  onSelectHome,
  onSelectBuy,
  onSelectSell,
  onSelectStore,
  onBack,
  searchValue,
  onSearchChange,
  onSearchFocus,
  onSearchSubmit,
  onSearchClear,
  storeName = '',
  documentRef = '',
  crumbs,
}) {
  const trail =
    Array.isArray(crumbs) && crumbs.length
      ? crumbs.filter((crumb) => crumb?.label)
      : storeName
        ? [
            { label: storeName, onPress: documentRef && onSelectStore ? onSelectStore : undefined },
            documentRef ? { label: documentRef } : null,
          ].filter(Boolean)
        : [];

  return (
    <BlurView
      intensity={56}
      tint="light"
      style={styles.topBar}
      accessibilityRole="toolbar"
      accessibilityLabel="Canada Gold"
      {...(Platform.OS === 'web' ? { className: 'cgold-top-bar-blur' } : null)}
    >
      <View style={styles.topBarBrandRow}>
        {onBack ? (
          <Pressable
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel="Back"
            hitSlop={8}
            style={styles.topBarBack}
          >
            <Ionicons name="chevron-back" size={22} color={MOBILE.label} />
          </Pressable>
        ) : null}
        <Pressable
          onPress={onSelectHome}
          accessibilityRole="button"
          accessibilityLabel="Home"
          style={styles.topBarBrand}
        >
          <HomeGlyph size={22} />
        </Pressable>
        {trail.map((crumb, index) => (
          <Fragment key={`${crumb.label}-${index}`}>
            <Text style={styles.topBarCrumbSep} accessible={false}>
              /
            </Text>
            {crumb.onPress ? (
              <Pressable
                onPress={crumb.onPress}
                accessibilityRole="button"
                accessibilityLabel={crumb.label}
                style={styles.topBarCrumbPress}
              >
                <Text style={styles.topBarPlace} numberOfLines={1}>
                  {crumb.label}
                </Text>
              </Pressable>
            ) : (
              <Text style={styles.topBarPlace} numberOfLines={1}>
                {crumb.label}
              </Text>
            )}
          </Fragment>
        ))}
      </View>
      <View style={styles.topBarRight}>
        <TopDateToggle />
        <TopNavSearch
          value={searchValue}
          onChangeText={onSearchChange}
          onFocus={onSearchFocus}
          onSubmit={onSearchSubmit}
          onClear={onSearchClear}
        />
        <SpotMetalToggle />
        <CurrencyToggle />
        <View style={styles.topBarTrades}>
          <TopTradeButton kind="buy" label="Buy" active={buyActive} onPress={onSelectBuy} />
          <TopTradeButton kind="sell" label="Sell" active={sellActive} onPress={onSelectSell} />
        </View>
      </View>
    </BlurView>
  );
}

function SidebarNavGroup({
  collapsed,
  homeActive,
  appsActive,
  messagesActive,
  profileActive,
  onSelectHome,
  onSelectApps,
  onSelectMessages,
  onSelectProfile,
  onOpenLocation,
  profileLabel,
  profileLocation,
  profileAvatarUrl,
  showMessages = true,
  messagesUnread = 0,
}) {
  const items = [
    {
      key: 'home',
      label: 'Home',
      icon: 'home-outline',
      active: homeActive,
      onPress: onSelectHome,
    },
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
            <View style={styles.sidebarMessagesIcon}>
              <Ionicons
                name={messagesActive ? 'chatbubbles' : 'chatbubbles-outline'}
                size={TAB_ICON_SIZE}
                color={messagesActive ? MOBILE.label : MOBILE.secondary}
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
          size={TAB_ICON_SIZE}
        />
      ),
      trailing: <ProfileStoreButton locationName={profileLocation} onPress={onOpenLocation} />,
    },
  ].filter(Boolean);

  return (
    <View style={[styles.sidebarNavStack, collapsed && styles.sidebarNavGroupCollapsed]}>
      <View style={[styles.sidebarNavGroup, collapsed && styles.sidebarNavGroupCollapsed]}>
        {items.map((item, index) => {
          const edge = tabGroupEdgeStyle(index, items.length);
          const showStore = item.key === 'profile' && !collapsed && item.trailing;
          return (
            <View key={item.key} style={styles.sidebarNavRow}>
              <View
                style={
                  showStore
                    ? [
                        styles.sidebarProfileRow,
                        styles.tabGrouped,
                        styles.tabGroupedExpanded,
                        edge,
                        item.active && styles.tabActive,
                      ]
                    : undefined
                }
              >
                <SidebarNavItem
                  label={item.label}
                  subtitle={item.subtitle}
                  icon={item.icon}
                  leading={item.leading}
                  trailing={showStore ? null : item.trailing}
                  accessibilityLabel={item.accessibilityLabel}
                  active={item.active}
                  collapsed={collapsed}
                  grouped={!showStore}
                  paintChrome={!showStore}
                  edge={showStore ? undefined : edge}
                  style={[styles.sidebarNavItem, showStore && styles.sidebarProfileItem]}
                  onPress={item.onPress}
                />
                {showStore ? item.trailing : null}
              </View>
            </View>
          );
        })}
      </View>
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
  const itemHeightRef = useRef(36);
  const [draggingKey, setDraggingKey] = useState(null);
  const [hoveredKey, setHoveredKey] = useState(null);

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
      <View
        ref={listRef}
        style={styles.pinnedList}
        onLayout={() => {
          measureList();
        }}
      >
        {tools.map((tool, index) => {
          const isActive = activeToolKey === tool.key;
          const isDragging = draggingKey === tool.key;
          return (
            <View key={tool.key} style={styles.sidebarNavRow}>
              <Pressable
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
                  styles.tabGrouped,
                  sidebarCollapsed && styles.tabGroupedCollapsed,
                  !sidebarCollapsed && styles.tabGroupedExpanded,
                  tabGroupEdgeStyle(index, tools.length),
                  styles.pinnedTab,
                  sidebarCollapsed && styles.tabCollapsed,
                  sidebarCollapsed && styles.pinnedTabCollapsed,
                  isActive && styles.tabActive,
                  isDragging && styles.pinnedTabDragging,
                ]}
                onHoverIn={() => setHoveredKey(tool.key)}
                onHoverOut={() => setHoveredKey((key) => (key === tool.key ? null : key))}
                accessibilityLabel={tool.label}
                accessibilityHint="Drag to reorder"
              >
                <View
                  style={[
                    styles.tabGlyph,
                    sidebarCollapsed && styles.tabGlyphCollapsed,
                    !sidebarCollapsed && styles.tabGlyphExpanded,
                  ]}
                >
                  <View
                    style={[
                      styles.pinnedAppIcon,
                      sidebarCollapsed && styles.pinnedAppIconCollapsed,
                      { backgroundColor: tool.accent },
                    ]}
                  >
                    <Ionicons name={filledIonicon(tool.icon)} size={13} color="#fff" />
                  </View>
                </View>
                <Text
                  style={[
                    styles.tabLabel,
                    sidebarCollapsed && styles.tabLabelCollapsed,
                    hoveredKey === tool.key && !isActive && styles.tabLabelHover,
                    isActive && styles.tabLabelActive,
                  ]}
                  numberOfLines={1}
                >
                  {tool.label}
                </Text>
                <Pressable
                  style={[
                    styles.pinnedRemoveButton,
                    sidebarCollapsed && styles.tabTrailingCollapsed,
                  ]}
                  {...(Platform.OS === 'web' ? { className: 'cgold-sidebar-unpin' } : null)}
                  onPress={() => onUnpin(tool.key)}
                  onPointerDown={(event) => {
                    event?.stopPropagation?.();
                    draggingKeyRef.current = null;
                  }}
                  hitSlop={6}
                  pointerEvents={sidebarCollapsed ? 'none' : 'auto'}
                  accessibilityLabel={`Unpin ${tool.label}`}
                >
                  <Ionicons name="remove-circle-outline" size={16} color="#c7c7cc" />
                </Pressable>
              </Pressable>
            </View>
          );
        })}
      </View>
    </View>
  );
}

export default function App() {
  const isMobile = useIsMobile();
  const [activeTab, setActiveTab] = useState('home');
  const [homeRootTick, setHomeRootTick] = useState(0);
  const [homeStoreName, setHomeStoreName] = useState('');
  const [homeDocRef, setHomeDocRef] = useState('');
  const homeDocumentCloseRef = useRef(null);
  const [activeTool, setActiveTool] = useState(null);
  const [triageStoreBack, setTriageStoreBack] = useState(null);
  const [triageBatch, setTriageBatch] = useState(null);
  const [triageNav, setTriageNav] = useState(null);
  const [triageMobileHeader, setTriageMobileHeader] = useState(null);
  const handleTriageMobileHeader = useCallback((next) => {
    setTriageMobileHeader((prev) => {
      if (!next && !prev) return prev;
      if (prev?.trailing === next?.trailing) return prev;
      return next;
    });
  }, []);
  const [triageCrumbs, setTriageCrumbs] = useState([]);
  const [triageMobileOverlay, setTriageMobileOverlay] = useState(false);
  const [settingsPanel, setSettingsPanel] = useState(null);
  const [pinnedKeys, setPinnedKeys] = useState([]);
  const [toolsQuery, setToolsQuery] = useState('');
  const [appsView, setAppsView] = useState(DEFAULT_APPS_VIEW);
  const appGrid = useAppGridLayout();
  const [searchQuery, setSearchQuery] = useState('');
  const searchEnterRef = useRef(null);
  const [searchDoc, setSearchDoc] = useState(null);
  const [customerFocus, setCustomerFocus] = useState(null);
  const [searchDocDetail, setSearchDocDetail] = useState(null);
  const [searchDocLoading, setSearchDocLoading] = useState(false);
  const [searchDocError, setSearchDocError] = useState('');
  const searchDocReq = useRef(0);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(storedSidebarCollapsed);
  const [sidebarCompact, setSidebarCompact] = useState(storedSidebarCollapsed);
  const sidebarProgress = useRef(new Animated.Value(storedSidebarCollapsed() ? 1 : 0)).current;
  const sidebarCompactTimer = useRef(null);
  const sidebarWidth = useMemo(
    () =>
      sidebarProgress.interpolate({
        inputRange: [0, 1],
        outputRange: [SIDEBAR_EXPANDED_WIDTH, SIDEBAR_COLLAPSED_WIDTH],
      }),
    [sidebarProgress],
  );
  const sidebarPad = useMemo(
    () =>
      sidebarProgress.interpolate({
        inputRange: [0, 1],
        outputRange: [SIDEBAR_EXPANDED_PAD, SIDEBAR_COLLAPSED_PAD],
      }),
    [sidebarProgress],
  );
  useEffect(
    () => () => {
      if (sidebarCompactTimer.current) clearTimeout(sidebarCompactTimer.current);
    },
    [],
  );

  const applySidebarCollapsed = useCallback(
    (next) => {
      if (sidebarCollapsed === next) return;
      setSidebarCollapsed(next);
      rememberSidebarCollapsed(next);
      if (sidebarCompactTimer.current) {
        clearTimeout(sidebarCompactTimer.current);
        sidebarCompactTimer.current = null;
      }
      if (prefersReducedMotion()) {
        sidebarProgress.setValue(next ? 1 : 0);
        setSidebarCompact(next);
        return;
      }
      if (next) {
        sidebarCompactTimer.current = setTimeout(() => {
          setSidebarCompact(true);
          sidebarCompactTimer.current = null;
        }, SIDEBAR_COMPACT_DELAY_MS);
      } else {
        setSidebarCompact(false);
      }
      Animated.timing(sidebarProgress, {
        toValue: next ? 1 : 0,
        duration: SIDEBAR_ANIM_MS,
        easing: SIDEBAR_EASE,
        useNativeDriver: false,
      }).start();
    },
    [sidebarCollapsed, sidebarProgress],
  );
  const toggleSidebarCollapsed = useCallback(() => {
    applySidebarCollapsed(!sidebarCollapsed);
  }, [applySidebarCollapsed, sidebarCollapsed]);
  const [session, setSession] = useState(null);
  const [bootstrapping, setBootstrapping] = useState(true);
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [switchingPos, setSwitchingPos] = useState(false);
  const [switchError, setSwitchError] = useState('');
  const [loginSwitcherOpen, setLoginSwitcherOpen] = useState(false);
  const [emailsFocus, setEmailsFocus] = useState(null);
  const [accessByRole, setAccessByRole] = useState(null);
  const [ownUserAccess, setOwnUserAccess] = useState(null);
  const [viewedProfile, setViewedProfile] = useState(null);
  const [dmFocusUserId, setDmFocusUserId] = useState('');
  const [dmConversationOpen, setDmConversationOpen] = useState(false);
  const [teamsFocusId, setTeamsFocusId] = useState('');
  const [profileReturnTo, setProfileReturnTo] = useState(null);
  const [locationPickerOpen, setLocationPickerOpen] = useState(false);
  const emailsFocusSeq = useRef(0);

  useEffect(() => {
    if (!session?.token) {
      clearClockedIn();
      return undefined;
    }
    return startClockedInSync();
  }, [session?.token]);

  const [fontsLoaded, fontsError] = useFonts(Platform.OS === 'web' ? WEB_SHELL_FONTS : NATIVE_FONTS);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    // Icons from these sets render as soon as the file lands; nothing waits on them.
    loadFontsAsync(WEB_DEFERRED_FONTS).catch(() => {});
  }, []);

  const isLoggedIn = Boolean(session?.token && session?.supabaseUserId);
  const scopedStore = scopedStoreName(session?.profile);
  const activeToolKey = activeTool?.key || '';
  useEffect(() => {
    if (Platform.OS === 'web' && activeToolKey) rememberOpenTool(activeToolKey);
  }, [activeToolKey]);
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

  // Once the shell is up, fetch the chunks for the screens this person is most
  // likely to open next while the browser is otherwise idle, so opening them
  // later is instant.
  const pinnedKeysSignature = pinnedKeys.join('|');
  useEffect(() => {
    if (Platform.OS !== 'web' || bootstrapping || !isLoggedIn) return undefined;
    const keys = ['trade', 'profile', ...pinnedKeysSignature.split('|').filter(Boolean)];
    if (allowedToolKeys.has('messages')) keys.push('messages');
    let cancelled = false;
    const run = () => {
      if (cancelled) return;
      keys.forEach(warmScreen);
    };
    const hasIdle = typeof requestIdleCallback === 'function';
    const handle = hasIdle ? requestIdleCallback(run, { timeout: 4000 }) : setTimeout(run, 1500);
    return () => {
      cancelled = true;
      if (hasIdle) cancelIdleCallback(handle);
      else clearTimeout(handle);
    };
  }, [bootstrapping, isLoggedIn, pinnedKeysSignature, allowedToolKeys]);

  const { unread: messagesUnread, refreshUnread: refreshMessagesUnread } = useDirectMessages(
    session,
    {
      enabled: isLoggedIn && hasApp('messages'),
    },
  );

  const pinnedTools = pinnedKeys
    .map((key) => TOOL_CARDS.find((tool) => tool.key === key))
    .filter((tool) => tool && hasApp(tool.key));
  const normalizedToolsQuery = toolsQuery.trim().toLowerCase();
  const matchesToolsQuery = (tool) =>
    !normalizedToolsQuery || tool.label.toLowerCase().includes(normalizedToolsQuery);
  const filteredTools = TOOL_CARDS.filter((tool) => hasApp(tool.key) && matchesToolsQuery(tool));

  const resetToSignedOut = useCallback(() => {
    clearInventoryCache();
    clearCashTillCache();
    clearLocationCache();
    clearPhoneHistoryCache();
    setSession(null);
    setPinnedKeys([]);
    setToolsQuery('');
    setAppsView(DEFAULT_APPS_VIEW);
    setAccessByRole(null);
    setOwnUserAccess(null);
    setLoginId('');
    setPassword('');
    setLoginError('');
    setActiveTab('home');
    setActiveTool(null);
    setSettingsPanel(null);
    setViewedProfile(null);
    setDmFocusUserId('');
    setDmConversationOpen(false);
    setTeamsFocusId('');
    setProfileReturnTo(null);
    setLocationPickerOpen(false);
    setLoginSwitcherOpen(false);
    setSwitchError('');
  }, []);

  useEffect(() => {
    let cancelled = false;
    let cancelWarmup = () => {};

    (async () => {
      // The permission tables do not depend on anything restoreSession works
      // out, so when there is a session to restore, fetch them alongside it
      // instead of afterwards. This removes a full network round trip from
      // the time to first screen.
      let accessPromise = null;
      if (await hasStoredSession()) {
        accessPromise = Promise.all([
          loadRoleAppAccess(ACCESS_CATALOG_KEYS),
          loadUserAppAccessMap(ACCESS_CATALOG_KEYS),
        ]);
      }

      let restored = null;
      try {
        restored = await restoreSession({
          onProfileSynced: (profile) => {
            if (cancelled || !profile) return;
            setSession((current) => {
              if (!current?.profile || current.profile.id !== profile.id) return current;
              return {
                ...current,
                profile: {
                  ...current.profile,
                  role: profile.role,
                  employeeType: profile.employeeType,
                  locationId: profile.locationId,
                  locationName: profile.locationName,
                  canViewBonusData:
                    profile.canViewBonusData == null
                      ? current.profile.canViewBonusData
                      : profile.canViewBonusData,
                  bonusEmployeeVisibility:
                    profile.bonusEmployeeVisibility || current.profile.bonusEmployeeVisibility,
                },
                bonusAccess: profile.bonusAccess || current.bonusAccess,
                bonusAuth: profile.bonusAuth || current.bonusAuth,
              };
            });
          },
        });
      } catch {
        restored = null;
      }
      if (cancelled) return;

      if (restored?.token) {
        const [pins, view, [access, userAccessMap]] = await Promise.all([
          loadPinnedTools(restored, TOOL_KEYS),
          loadAppsView(restored),
          accessPromise ||
            Promise.all([loadRoleAppAccess(ACCESS_CATALOG_KEYS), loadUserAppAccessMap(ACCESS_CATALOG_KEYS)]),
        ]);
        if (cancelled) return;
        const ownUserId = String(restored.supabaseUserId || restored.profile?.id || '').trim();
        const userAccess = (ownUserId && userAccessMap.byUser[ownUserId]) || null;
        setSession(restored);
        setPinnedKeys(pins);
        setAppsView(view);
        setAccessByRole(access.byRole);
        setOwnUserAccess(userAccess);
        cancelWarmup = warmSessionCaches(restored);
        const reopenKey = storedOpenTool();
        const reopen = TOOL_CARDS.find((tool) => tool.key === reopenKey);
        if (reopen) {
          setActiveTab('tools');
          setActiveTool(reopen);
        }
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
      cancelWarmup();
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
    const employeeId = posEmployeeId(session?.profile?.aureusUserId);
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
      return;
    }
    const callback = readRipplingOAuthCallback();
    if (!callback) return;
    const hoursCallback = readHoursOAuthCallback();
    const expected = readRipplingOAuthState();
    if (!hoursCallback && (!expected || expected !== callback.state)) return;
    if (!hasApp('settings')) return;
    const settingsTool = TOOL_CARDS.find((tool) => tool.key === 'settings');
    setActiveTab('tools');
    setActiveTool(settingsTool || { key: 'settings', label: 'Settings' });
    setSettingsPanel('rippling');
  }, [bootstrapping, session?.token, hasApp]);

  const selectTab = (tabKey) => {
    if (tabKey === 'home' && activeTab === 'home') {
      setHomeRootTick((tick) => tick + 1);
    }
    if (tabKey === 'profile') {
      setViewedProfile(null);
      setProfileReturnTo(null);
    }
    setActiveTab(tabKey);
    setSettingsPanel(null);
    rememberOpenTool('');
    if (tabKey !== 'search') {
      setSearchDoc(null);
      setSearchDocDetail(null);
      setSearchDocError('');
      setSearchDocLoading(false);
    }
    setActiveTool(null);
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

  const openAnalyticsApp = useCallback(() => {
    const tool = TOOL_CARDS.find((item) => item.key === 'analytics');
    if (!tool || !hasApp('analytics')) return;
    startTransition(() => {
      setActiveTab('tools');
      setActiveTool(tool);
      setSettingsPanel(null);
    });
  }, [hasApp]);

  const openPersonProfile = (raw) => {
    const person = profileTargetFromPerson(raw);
    const myId = session?.supabaseUserId || session?.profile?.id || '';
    if (person?.profileId && myId && person.profileId === myId) {
      setViewedProfile(null);
      setProfileReturnTo(null);
    } else {
      setViewedProfile(person);
      setProfileReturnTo(activeTab === 'home' || activeTab === 'search' ? activeTab : null);
    }
    setActiveTab('profile');
    setActiveTool(null);
    setSettingsPanel(null);
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
  };

  const closeSearchDocument = useCallback(() => {
    setSearchDoc(null);
    setSearchDocDetail(null);
    setSearchDocError('');
    setSearchDocLoading(false);
  }, []);

  const openCustomerProfile = useCallback(
    (row) => {
      if (!row || !hasApp('customers')) return;
      const customersTool = TOOL_CARDS.find((tool) => tool.key === 'customers');
      setCustomerFocus(row);
      setActiveTab('tools');
      setActiveTool(customersTool || { key: 'customers', label: 'Customers' });
      setSettingsPanel(null);
    },
    [hasApp],
  );

  const openSearchDocument = useCallback(
    async (row) => {
      if (!row) return;
      setSearchDoc(row);
      setSearchDocDetail(null);
      setSearchDocError('');
      setSearchDocLoading(true);
      const id = ++searchDocReq.current;
      try {
        const auth = resolvePosAuthForRow(session, row);
        const next = await fetchTransactionDetail(auth.token, {
          type: row.type,
          sourceId: row.sourceId,
          baseUrl: auth.baseUrl,
        });
        if (id !== searchDocReq.current) return;
        const enriched = withPaymentBreakdown(row, next);
        setSearchDocDetail(next);
        setSearchDoc(enriched);
      } catch (err) {
        if (id !== searchDocReq.current) return;
        setSearchDocError(err?.message || 'Failed to load that ticket.');
      } finally {
        if (id === searchDocReq.current) setSearchDocLoading(false);
      }
    },
    [session],
  );

  const openTool = (tool) => {
    if (!hasApp(tool?.key)) return;
    expandMobileTabBar();
    setActiveTool(tool);
    setSettingsPanel(null);
  };

  const openPinnedTool = (tool) => {
    if (!hasApp(tool?.key)) return;
    expandMobileTabBar();
    setActiveTab('tools');
    setActiveTool(tool);
    setSettingsPanel(null);
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
  }, [hasApp]);

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
      rememberOpenTool('');
    }
  }, [activeTool, hasApp]);

  const handleLogin = async () => {
    if (!loginId.trim() || !password.trim() || submitting) return;

    setSubmitting(true);
    setLoginError('');

    try {
      const next = await loginRequest(loginId, password);
      const [pins, view, access, userAccess] = await Promise.all([
        loadPinnedTools(next, TOOL_KEYS),
        loadAppsView(next),
        loadRoleAppAccess(ACCESS_CATALOG_KEYS),
        loadOwnUserAppAccess(next.supabaseUserId || next.profile?.id, ACCESS_CATALOG_KEYS),
      ]);
      setSession(next);
      setPinnedKeys(pins);
      setAppsView(view);
      setAccessByRole(access.byRole);
      setOwnUserAccess(userAccess);
      warmSessionCaches(next);
      setPassword('');
      setActiveTab('home');
      setActiveTool(null);
      setSettingsPanel(null);
      setSwitchError('');
      setLoginSwitcherOpen(false);
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
    setSwitchError('');
    setLoginSwitcherOpen(false);
  };

  const handleChangeLogin = async (systemKey) => {
    if (!session?.token || !systemKey) return;
    if (primaryPosSystem(session).key === systemKey) return;
    const target = accessiblePosSystems(session).find((system) => system.key === systemKey);
    if (!target?.available) {
      setSwitchError('This login does not have access to that Aureus database.');
      setLoginSwitcherOpen(true);
      return;
    }
    setSwitchingPos(true);
    setSwitchError('');
    try {
      const next = await switchPrimaryPosSystem(session, systemKey);
      clearInventoryCache();
      clearCashTillCache();
      clearLocationCache();
      setSession(next);
    } catch (error) {
      setSwitchError(error?.message || 'Could not switch Aureus database.');
      setLoginSwitcherOpen(true);
    } finally {
      setSwitchingPos(false);
    }
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
      'price-check': 'Price Check',
      ringcentral: 'Phone',
      rippling: 'Rippling',
    };
    const settingsSubPanelLabel =
      activeTool.key === 'settings' ? settingsSubPanels[settingsPanel] : null;
    const nestedLabel = settingsSubPanelLabel;

    if (isMobile) {
      return null;
    }
    if (
      activeTool.key === 'employees' ||
      activeTool.key === 'customers' ||
      activeTool.key === 'triage'
    ) {
      return null;
    }

    return (
      <View style={[styles.breadcrumb, !isMobile && styles.breadcrumbDesktop]}>
        <View style={styles.breadcrumbTrail}>
          <Pressable
            onPress={() => {
              setActiveTool(null);
              setSettingsPanel(null);
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
        <ScreenGate resetKey={viewedProfile?.profileId || 'self'}>
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
                const profile = { ...current.profile, ...patch };
                if (shouldPrefetchTriage(profile)) {
                  import('./lib/transferWorkflow')
                    .then((mod) => mod.warmTriageWorkflow())
                    .catch(() => {});
                }
                return { ...current, profile };
              });
            }}
          />
        </ScreenGate>
      );
    }

    if (activeTab === 'tools') {
      if (activeTool) {
        return (
          <View style={styles.toolsScreen}>
            {renderToolsHeader()}
            <ScreenGate resetKey={activeTool.key}>
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
              <PreordersScreen storeFilter={scopedStore || undefined} />
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
                    const profile = {
                      ...current.profile,
                      appRole: staff.appRole,
                      allowedAppRoles: staff.allowedAppRoles || current.profile.allowedAppRoles || [],
                      isSystemAdmin: staff.isSystemAdmin,
                      isActive: staff.isActive ?? current.profile.isActive,
                    };
                    if (shouldPrefetchTriage(profile)) {
                      import('./lib/transferWorkflow')
                        .then((mod) => mod.warmTriageWorkflow())
                        .catch(() => {});
                    }
                    return { ...current, profile };
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
                onOpenCustomer={openCustomerProfile}
                storeFilter={scopedStore || undefined}
              />
            ) : activeTool.key === 'reviews' ? (
              <ReviewsScreen
                session={session}
                onRequireLogin={() => selectTab('profile')}
                onOpenCustomer={openCustomerProfile}
                storeFilter={scopedStore || undefined}
              />
            ) : activeTool.key === 'calendar' ? (
              <CalendarScreen
                session={session}
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
            ) : activeTool.key === 'customers' ? (
              <CustomersScreen
                session={session}
                focusCustomer={customerFocus}
                onFocusConsumed={() => setCustomerFocus(null)}
                onOpenDocument={openSearchDocument}
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
                storeFilter={undefined}
                onStoreBackChange={(fn, context) => {
                  setTriageStoreBack(() => fn || null);
                  setTriageBatch(context || null);
                }}
                onNavTabs={setTriageNav}
                onMobileHeader={handleTriageMobileHeader}
                onMobileOverlayChange={setTriageMobileOverlay}
                onCrumbsChange={setTriageCrumbs}
              />
            ) : activeTool.key === 'messages' ? (
              <View style={styles.messagesHost}>
                <MessagesScreen
                  session={session}
                  onUnreadChange={refreshMessagesUnread}
                  openUserId={dmFocusUserId}
                  onOpenedUser={() => setDmFocusUserId('')}
                  onOpenProfile={openPersonProfile}
                  onConversationOpenChange={setDmConversationOpen}
                />
              </View>
            ) : (
              <Text style={styles.toolPageBody}>{activeTool.label} page</Text>
            )}
            </ScreenGate>
          </View>
        );
      }

      return (
        <AppsLibrary
          tools={filteredTools}
          pinnedKeys={pinnedKeys}
          appsView={appsView}
          query={toolsQuery}
          onQueryChange={setToolsQuery}
          onSelectView={selectAppsView}
          onOpen={openTool}
          onTogglePin={togglePin}
          appGrid={appGrid}
        />
      );
    }

    if (activeTab === 'search') {
      return (
        <ScreenGate resetKey="search">
          <SearchScreen
            session={session}
            query={isMobile ? undefined : searchQuery}
            onQueryChange={isMobile ? undefined : setSearchQuery}
            hideSearchField={!isMobile}
            enterRef={isMobile ? undefined : searchEnterRef}
            onOpenPerson={openPersonProfile}
            onOpenDocument={openSearchDocument}
            onOpenCustomer={openCustomerProfile}
            onMessage={messagePerson}
          />
        </ScreenGate>
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
          <ScreenGate resetKey="messages">
            <MessagesScreen
              session={session}
              onUnreadChange={refreshMessagesUnread}
              openUserId={dmFocusUserId}
              onOpenedUser={() => setDmFocusUserId('')}
              onOpenProfile={openPersonProfile}
              onConversationOpenChange={setDmConversationOpen}
            />
          </ScreenGate>
        </View>
      );
    }

    if (activeTab === 'buy' || activeTab === 'sell') {
      return (
        <ScreenGate resetKey={activeTab}>
          <TradeScreen mode={activeTab} hideHeader={isMobile} session={session} />
        </ScreenGate>
      );
    }

    if (activeTab === 'home') {
      return (
        <HomeScreen
          session={session}
          homeRootTick={homeRootTick}
          onRequireLogin={() => selectTab('profile')}
          onOpenPerson={openPersonProfile}
          onOpenCustomer={openCustomerProfile}
          onBuy={() => selectTab('buy')}
          onSell={() => selectTab('sell')}
          onOpenAnalytics={openAnalyticsApp}
          onSelectedStoreChange={setHomeStoreName}
          onSelectedDocumentChange={setHomeDocRef}
          documentCloseRef={homeDocumentCloseRef}
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
      activeTool?.key === 'reviews' ||
      activeTool?.key === 'calendar' ||
      activeTool?.key === 'employees' ||
      activeTool?.key === 'customers' ||
      activeTool?.key === 'analytics' ||
      activeTool?.key === 'triage'));

  const isAppsLibrary = activeTab === 'tools' && !activeTool;
  const settingsSubPanels = {
    'ai-models': 'AI Models',
    permissions: 'Permissions',
    database: 'Database',
    'store-settings': 'Store Settings',
    'price-check': 'Price Check',
    ringcentral: 'Phone',
    rippling: 'Rippling',
  };
  const mobileToolTitle =
    activeTool?.key === 'settings'
      ? settingsSubPanels[settingsPanel] || activeTool?.label
      : activeTool?.label;
  const mobileToolSegments = useMemo(() => {
    if (!activeTool) return [];
    if (activeTool.key === 'triage') {
      return (triageCrumbs || []).map((crumb) => ({
        label: crumb.label,
        onPress: crumb.onPress,
      }));
    }
    if (activeTool.key === 'phone' && triageBatch?.storeName) {
      return [
        {
          label: 'Phone',
          onPress: triageStoreBack || undefined,
        },
        { label: triageBatch.storeName },
      ];
    }
    return [{ label: mobileToolTitle }];
  }, [activeTool, mobileToolTitle, triageBatch?.storeName, triageCrumbs, triageStoreBack]);
  const handleMobileToolBrandPress = useCallback(() => {
    if (activeTool?.key === 'settings' && settingsPanel) {
      setSettingsPanel(null);
      return;
    }
    if ((activeTool?.key === 'triage' || activeTool?.key === 'phone') && triageStoreBack) {
      triageStoreBack();
      return;
    }
    setActiveTool(null);
    setSettingsPanel(null);
    rememberOpenTool('');
  }, [activeTool?.key, rememberOpenTool, settingsPanel, triageStoreBack]);
  const canvasMobileTab =
    isMobile &&
    (activeTab === 'home' ||
      activeTab === 'search' ||
      activeTab === 'messages' ||
      activeTab === 'profile' ||
      isAppsLibrary);
  const groupedMobileTab = false;
  const showingSettings = isMobile && activeTab === 'tools' && activeTool?.key === 'settings';
  const contentStyle = [
    styles.content,
    isMobile && styles.contentMobile,
    isFullBleedTool && styles.contentTransactions,
    (showingMessages || showingMail) && styles.contentMessages,
    isMobile && ((activeTab === 'tools' && activeTool) || showingMessages || showingMail) && styles.contentMobileApp,
    styles.contentScrollFix,
    isAppsLibrary && styles.contentAppsLibrary,
    !isMobile && (activeTab === 'home' || activeTab === 'search' || activeTab === 'profile' || activeTab === 'messages') && styles.contentAppsLibrary,
    !isMobile &&
      activeTab === 'tools' &&
      (activeTool?.key === 'employees' || activeTool?.key === 'customers') &&
      styles.contentAppsLibrary,
    !isMobile && isFullBleedTool && styles.contentUnderTopBar,
    (groupedMobileTab || showingSettings) && styles.contentMobileGrouped,
    canvasMobileTab && styles.canvasFill,
    isMobile &&
      activeTab !== 'home' &&
      activeTab !== 'search' &&
      !isAppsLibrary &&
      !showingMessages &&
      styles.contentMobileTabInset,
    isMobile &&
      !isFullBleedTool &&
      !showingMessages &&
      !isAppsLibrary &&
      activeTab !== 'home' &&
      activeTab !== 'search' &&
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

  if (CAPTURE_TOKEN) {
    return <LinePhotoCapturePage token={CAPTURE_TOKEN} />;
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

  const datePageKey = activeTab === 'tools' && activeTool?.key ? `tools:${activeTool.key}` : activeTab;

  if (isMobile) {
    const mobileTabs = MOBILE_TABS.filter((tab) => tab.key !== 'messages' || hasApp('messages'));
    const groupedShell = groupedMobileTab || showingSettings;
    return (
      <AppAccessContext.Provider value={appAccessValue}>
      <DisplayCurrencyProvider enabled={Boolean(session?.token)}>
      <AppDateProvider>
      <AppDateRouteReset pageKey={datePageKey} />
      <PhoneCallProvider session={session} storeFilter={scopedStore || undefined} enabled={hasApp('phone')}>
        <View
          style={[
            styles.containerMobile,
            groupedShell ? styles.containerMobileGrouped : styles.containerMobileFeed,
            canvasMobileTab && styles.canvasFill,
          ]}
        >
          <StatusBar style="dark" />
          <MobileSafeTop />
          {activeTab === 'buy' || activeTab === 'sell' ? (
            <MobileNavHeader
              title={activeTab === 'buy' ? 'Buy' : 'Sell'}
              onBack={() => selectTab('home')}
            />
          ) : null}
          {activeTab === 'tools' && activeTool && !(activeTool.key === 'triage' && triageMobileOverlay) ? (
            <MobileFeedTopBar
              segments={mobileToolSegments}
              onBrandPress={handleMobileToolBrandPress}
              trailing={activeTool.key === 'triage' ? triageMobileHeader?.trailing : null}
            />
          ) : null}
          <View style={contentStyle}>{renderContent()}</View>
          <View
            pointerEvents="box-none"
            style={[
              styles.mobilePhoneDockSlot,
              dmConversationOpen && styles.mobilePhoneDockSlotThread,
            ]}
          >
            <MobilePhoneDock />
          </View>
          {dmConversationOpen ? null : (
            <MobileTabBar
              tabs={mobileTabs}
              activeKey={activeTab}
              onSelect={selectTab}
              messagesUnread={messagesUnread}
              profileAvatarUrl={session?.profile?.avatarUrl || ''}
              profileName={userLabel}
            />
          )}
          <ProfileLoginSwitcher
            visible={loginSwitcherOpen}
            session={session}
            switchError={switchError}
            switching={switchingPos}
            onClose={() => setLoginSwitcherOpen(false)}
            onChangeLogin={handleChangeLogin}
            onLogout={handleLogout}
          />
          <TransactionDetailDrawer
            visible={Boolean(searchDoc)}
            summary={searchDoc}
            detail={searchDocDetail}
            loading={searchDocLoading}
            error={searchDocError}
            onClose={closeSearchDocument}
          />
        </View>
      </PhoneCallProvider>
      </AppDateProvider>
      </DisplayCurrencyProvider>
      </AppAccessContext.Provider>
    );
  }

  return (
    <AppAccessContext.Provider value={appAccessValue}>
    <DisplayCurrencyProvider enabled={Boolean(session?.token)}>
    <AppDateProvider>
    <AppDateRouteReset pageKey={datePageKey} />
    <PhoneCallProvider session={session} storeFilter={scopedStore || undefined} enabled={hasApp('phone')}>
    <View nativeID="cgold-app-shell" style={styles.container}>
      <StatusBar style="auto" />
      <View style={styles.desktopBody}>
      <Animated.View
        nativeID="cgold-sidebar"
        testID="cgold-sidebar"
        style={[
          styles.sidebar,
          sidebarCollapsed && styles.sidebarCollapsed,
          { width: sidebarWidth },
        ]}
      >
        <View style={styles.tabList}>
          <SidebarNavGroup
            collapsed={sidebarCompact}
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
            onSelectHome={() => selectTab('home')}
            onSelectApps={() => selectTab('tools')}
            onSelectMessages={() => selectTab('messages')}
            onSelectProfile={() => selectTab(PROFILE_TAB.key)}
            onOpenLocation={() => setLocationPickerOpen(true)}
            profileLabel={userLabel}
            profileLocation={storeLocationFromSession(session)}
            profileAvatarUrl={session?.profile?.avatarUrl || ''}
            showMessages={hasApp('messages')}
            messagesUnread={messagesUnread}
          />

          <PinnedToolsList
            tools={pinnedTools}
            activeToolKey={activeTab === 'tools' ? activeTool?.key : null}
            sidebarCollapsed={sidebarCompact}
            onOpen={openPinnedTool}
            onUnpin={togglePin}
            onReorder={reorderPinned}
          />
        </View>

        <View style={[styles.sidebarFooter, sidebarCompact && styles.sidebarFooterCollapsed]}>
          <Animated.View style={{ paddingHorizontal: sidebarPad }}>
            <PhoneIncomingDock collapsed={sidebarCompact} />
          </Animated.View>
          <Animated.View
            style={[
              styles.sidebarToggleWrap,
              sidebarCompact && styles.sidebarToggleWrapCollapsed,
              { paddingHorizontal: sidebarPad },
            ]}
          >
            <Pressable
              onPress={toggleSidebarCollapsed}
              style={[styles.sidebarToggle, sidebarCompact && styles.sidebarToggleCollapsed]}
              accessibilityLabel={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              <Feather name="sidebar" size={TAB_ICON_SIZE} color="#8e8e93" />
            </Pressable>
          </Animated.View>
        </View>
      </Animated.View>

      <View style={contentStyle}>{renderContent()}</View>
      </View>
      <TopNavBar
        buyActive={activeTab === 'buy'}
        sellActive={activeTab === 'sell'}
        storeName={activeTab === 'home' ? homeStoreName : ''}
        documentRef={activeTab === 'home' ? homeDocRef : ''}
        crumbs={activeTab === 'tools' && activeTool?.key === 'triage' ? triageCrumbs : undefined}
        onBack={
          activeTab === 'tools' && activeTool?.key === 'triage' && triageStoreBack
            ? triageStoreBack
            : undefined
        }
        onSelectHome={() => selectTab('home')}
        onSelectStore={homeDocRef ? () => homeDocumentCloseRef.current?.() : undefined}
        onSelectBuy={() => selectTab('buy')}
        onSelectSell={() => selectTab('sell')}
        searchValue={searchQuery}
        onSearchChange={(text) => {
          setSearchQuery(text);
          if (activeTab !== 'search') selectTab('search');
        }}
        onSearchFocus={() => {
          if (activeTab !== 'search') selectTab('search');
        }}
        onSearchSubmit={() => {
          if (activeTab !== 'search') selectTab('search');
          searchEnterRef.current?.();
        }}
        onSearchClear={() => setSearchQuery('')}
      />
      <ProfileLoginSwitcher
        visible={loginSwitcherOpen}
        session={session}
        switchError={switchError}
        switching={switchingPos}
        onClose={() => setLoginSwitcherOpen(false)}
        onChangeLogin={handleChangeLogin}
        onLogout={handleLogout}
      />
      <TransactionDetailDrawer
        visible={Boolean(searchDoc)}
        summary={searchDoc}
        detail={searchDocDetail}
        loading={searchDocLoading}
        error={searchDocError}
        onClose={closeSearchDocument}
      />
      <ProfileLocationPicker
        visible={locationPickerOpen}
        session={session}
        selectedId={session?.profile?.locationId}
        selectedName={storeLocationFromSession(session)}
        includeWorkshop={canUseWorkshopLocation(session?.profile)}
        onClose={() => setLocationPickerOpen(false)}
        onChanged={applyOwnLocation}
      />
    </View>
    </PhoneCallProvider>
    </AppDateProvider>
    </DisplayCurrencyProvider>
    </AppAccessContext.Provider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    flexDirection: 'column',
    position: 'relative',
    backgroundColor: CANVAS,
    ...Platform.select({
      web: { height: '100%', maxHeight: '100dvh', overflow: 'hidden' },
      default: {},
    }),
  },
  desktopBody: {
    flex: 1,
    flexDirection: 'row',
    minHeight: 0,
    minWidth: 0,
  },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 80,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    minHeight: TOP_BAR_HEIGHT,
    paddingHorizontal: 16,
    paddingVertical: 8,
    overflow: 'visible',
    backgroundColor: 'transparent',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(42,38,30,0.08)',
  },
  topBarBrandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minWidth: 0,
    flexShrink: 1,
    paddingRight: 12,
  },
  topBarBrand: {
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  topBarBack: {
    height: 32,
    width: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: -4,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  topBarCrumbSep: {
    fontFamily: FONT,
    fontSize: 16,
    fontWeight: '400',
    color: '#c7c7cc',
    lineHeight: 20,
  },
  topBarCrumbPress: {
    flexShrink: 1,
    minWidth: 0,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  topBarPlace: {
    flexShrink: 1,
    minWidth: 0,
    fontFamily: 'SohneHalbfett',
    fontSize: 15,
    fontWeight: '600',
    color: MOBILE.label,
    letterSpacing: -0.2,
  },
  storeTxSlide: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 40,
    backgroundColor: CANVAS,
  },
  topBarRight: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 32,
    gap: 16,
    flexShrink: 1,
    minWidth: 0,
  },
  topSearchField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 32,
    minHeight: 32,
    width: 268,
    maxWidth: 308,
    paddingHorizontal: 10,
    borderRadius: SIDEBAR_TAB_ACTIVE_RADIUS,
    borderWidth: 1,
    borderColor: TAB_BORDER,
    backgroundColor: CANVAS,
  },
  topSearchInput: {
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
  topSpotWrap: {
    position: 'relative',
    flexShrink: 0,
    height: 32,
    justifyContent: 'center',
  },
  topSpotWrapCompact: {
    paddingTop: 8,
    alignSelf: 'stretch',
  },
  topDateField: {
    minWidth: 124,
    maxWidth: 248,
    gap: 8,
  },
  topDateFieldRange: {
    minWidth: 168,
    maxWidth: 280,
  },
  topSpot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexShrink: 0,
    minWidth: 148,
    height: 32,
    paddingLeft: 10,
    paddingRight: 6,
    gap: 12,
    borderRadius: SIDEBAR_TAB_ACTIVE_RADIUS,
    borderWidth: 1,
    borderColor: TAB_BORDER,
    backgroundColor: CANVAS,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  topSpotCompact: {
    alignSelf: 'stretch',
    height: 44,
    minWidth: 0,
    borderRadius: 12,
    backgroundColor: '#fff',
    paddingHorizontal: 12,
  },
  topSpotMetal: {
    position: 'absolute',
    top: -6,
    left: 10,
    zIndex: 1,
    paddingHorizontal: 4,
    backgroundColor: CANVAS,
    fontFamily,
    fontSize: 10,
    fontWeight: '400',
    lineHeight: 12,
    color: '#8e8e93',
    letterSpacing: -0.1,
  },
  topSpotMetalCompact: {
    left: 12,
    backgroundColor: '#fff',
    fontSize: 11,
    lineHeight: 13,
  },
  topSpotPrice: {
    fontFamily,
    fontSize: 14,
    fontWeight: '400',
    color: '#1a1a1a',
    letterSpacing: -0.2,
    fontVariant: ['tabular-nums'],
    flexShrink: 0,
  },
  topSpotPriceCompact: {
    fontSize: 16,
    flex: 1,
  },
  topSpotChevrons: {
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 'auto',
    marginTop: 1,
    flexShrink: 0,
  },
  topSpotChevronDown: {
    marginTop: -4,
  },
  topSpotOverlay: {
    flex: 1,
  },
  topSpotMenu: {
    position: 'absolute',
    minWidth: 176,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: '#fff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(42,38,30,0.10)',
    ...Platform.select({
      web: { boxShadow: '0 10px 28px rgba(18,16,12,0.14)' },
      default: { elevation: 6 },
    }),
  },
  topSpotOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    minHeight: 36,
    paddingHorizontal: 12,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  topSpotOptionActive: {
    backgroundColor: '#f4f4f5',
  },
  topSpotOptionName: {
    fontFamily,
    fontSize: 14,
    fontWeight: '400',
    color: '#8e8e93',
    letterSpacing: -0.2,
  },
  topSpotOptionNameActive: {
    color: '#1a1a1a',
  },
  topSpotOptionPrice: {
    fontFamily,
    fontSize: 14,
    fontWeight: '400',
    color: '#aeaeb2',
    letterSpacing: -0.2,
    fontVariant: ['tabular-nums'],
  },
  topSpotOptionPriceActive: {
    color: '#1a1a1a',
  },
  topCurrencyField: {
    minWidth: 88,
  },
  topCurrency: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
    height: 32,
    padding: 2,
    gap: 2,
    borderRadius: SIDEBAR_TAB_ACTIVE_RADIUS,
    borderWidth: 1,
    borderColor: TAB_BORDER,
    backgroundColor: CANVAS,
  },
  topCurrencyCompact: {
    alignSelf: 'stretch',
    height: 40,
    borderRadius: 12,
    backgroundColor: '#e8e8ed',
    borderWidth: 0,
    padding: 3,
  },
  topCurrencyButton: {
    minWidth: 40,
    height: 26,
    paddingHorizontal: 8,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  topCurrencyButtonCompact: {
    flex: 1,
    height: 34,
    borderRadius: 9,
  },
  topCurrencyButtonActive: {
    backgroundColor: '#fff',
    ...Platform.select({
      web: { boxShadow: '0 1px 2px rgba(0,0,0,0.10)' },
      default: { elevation: 1 },
    }),
  },
  topCurrencyLabel: {
    fontFamily,
    fontSize: 12,
    fontWeight: '500',
    color: '#8e8e93',
    letterSpacing: 0.2,
  },
  topCurrencyLabelActive: {
    color: '#1a1a1a',
    fontWeight: '600',
  },
  topBarTrades: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 32,
    gap: 4,
  },
  topTradeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 32,
    minHeight: 32,
    paddingHorizontal: 18,
    paddingVertical: 0,
    borderRadius: SIDEBAR_TAB_ACTIVE_RADIUS,
    borderWidth: 1,
    borderColor: TAB_BORDER,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  topTradeButtonHover: {
    backgroundColor: '#f5f5f5',
  },
  topTradeLabel: {
    fontFamily,
    fontSize: 14,
    fontWeight: '400',
    letterSpacing: -0.2,
  },
  loginShell: {
    flex: 1,
    backgroundColor: CANVAS,
  },
  containerMobile: {
    flex: 1,
    flexDirection: 'column',
    backgroundColor: CANVAS,
    ...Platform.select({
      web: { height: '100%', maxHeight: '100dvh', overflow: 'hidden' },
      default: {},
    }),
  },
  containerMobileFeed: {
    backgroundColor: CANVAS,
  },
  canvasFill: {
    backgroundColor: CANVAS,
  },
  containerMobileGrouped: {
    backgroundColor: '#f2f2f7',
  },
  sidebar: {
    width: SIDEBAR_EXPANDED_WIDTH,
    paddingTop: TOP_BAR_HEIGHT + 12,
    paddingBottom: 12,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: 'rgba(42,38,30,0.08)',
    backgroundColor: CANVAS,
    overflow: 'hidden',
    flexShrink: 0,
  },
  sidebarCollapsed: {
    width: SIDEBAR_COLLAPSED_WIDTH,
  },
  sidebarToggleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    width: '100%',
    paddingTop: 10,
  },
  sidebarToggleWrapCollapsed: {
    justifyContent: 'center',
  },
  sidebarToggle: {
    width: SIDEBAR_TAB_ICON_SLOT,
    height: SIDEBAR_TAB_ICON_SLOT,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    backgroundColor: 'transparent',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  sidebarToggleCollapsed: {
    alignSelf: 'center',
    marginLeft: 0,
  },
  sidebarNavStack: {
    gap: 0,
    width: '100%',
  },
  sidebarNavGroup: {
    position: 'relative',
    backgroundColor: CANVAS,
    overflow: 'hidden',
    paddingVertical: 0,
    width: '100%',
    alignSelf: 'stretch',
  },
  sidebarNavRow: {
    width: '100%',
    alignSelf: 'stretch',
  },
  sidebarProfileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
  },
  sidebarProfileItem: {
    flex: 1,
    minWidth: 0,
    marginHorizontal: 0,
    paddingHorizontal: 0,
  },
  sidebarNavGroupCollapsed: {
    alignItems: 'stretch',
    width: '100%',
  },
  sidebarNavItem: {
    backgroundColor: 'transparent',
    zIndex: 1,
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
  tabList: {
    flex: 1,
    gap: 0,
    width: '100%',
    overflow: 'visible',
  },
  tradePair: {
    overflow: 'hidden',
    backgroundColor: CANVAS,
    paddingVertical: 0,
    width: '100%',
  },
  tradeSegment: {
    zIndex: 1,
  },
  tradeButtonLabelActive: {
    color: MOBILE.label,
    fontWeight: '600',
  },
  pinnedSection: {
    marginTop: 10,
    width: '100%',
  },
  pinnedList: {
    overflow: 'hidden',
    backgroundColor: CANVAS,
    paddingVertical: 0,
    width: '100%',
  },
  pinnedAppIcon: {
    width: 22,
    height: 22,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
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
  pinnedTabCollapsed: {
    paddingRight: 0,
  },
  pinnedTabDragging: {
    opacity: 0.55,
    backgroundColor: '#f5f5f5',
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
    minHeight: 36,
    paddingVertical: 7,
    borderRadius: 0,
    overflow: 'hidden',
    ...Platform.select({
      web: {
        cursor: 'pointer',
        transitionProperty: 'padding, border-radius',
        transitionDuration: `${SIDEBAR_ANIM_MS}ms`,
        transitionTimingFunction: 'cubic-bezier(0.32, 0.72, 0, 1)',
      },
      default: {},
    }),
  },
  tabCollapsed: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 0,
    paddingRight: 0,
  },
  tabGlyph: {
    width: SIDEBAR_TAB_ICON_SLOT,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible',
    flexShrink: 0,
  },
  tabGlyphCollapsed: {
    width: undefined,
    minWidth: 0,
  },
  tabGlyphExpanded: {
    marginRight: 8,
  },
  tabGrouped: {
    marginHorizontal: SIDEBAR_TAB_GUTTER,
    borderRadius: 0,
    alignSelf: 'stretch',
  },
  tabGroupedCollapsed: {
    marginHorizontal: SIDEBAR_TAB_GUTTER_COLLAPSED,
  },
  tabGroupedExpanded: {
    paddingHorizontal: SIDEBAR_TAB_INNER_PAD,
  },
  tabEdgeTop: {
    borderRadius: 0,
  },
  tabEdgeMiddle: {
    borderRadius: 0,
  },
  tabEdgeBottom: {
    borderRadius: 0,
  },
  tabEdgeSingle: {
    borderRadius: 0,
  },
  tabHover: {
    backgroundColor: '#f5f5f5',
    borderRadius: 0,
  },
  tabActive: {
    backgroundColor: NAV_TAB_ACTIVE_BG,
    borderRadius: SIDEBAR_TAB_ACTIVE_RADIUS,
  },
  tabWithSubtitle: {
    minHeight: 46,
    alignItems: 'center',
  },
  tabLabelColumn: {
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
    ...Platform.select({
      web: {
        transitionProperty: 'opacity, flex, max-width',
        transitionDuration: `${Math.round(SIDEBAR_ANIM_MS * 0.55)}ms`,
        transitionTimingFunction: 'ease',
      },
      default: {},
    }),
  },
  tabLabelColumnCollapsed: {
    position: 'absolute',
    width: 0,
    height: 0,
    maxWidth: 0,
    opacity: 0,
    overflow: 'hidden',
    flexGrow: 0,
    flexShrink: 0,
    ...Platform.select({
      web: { display: 'none' },
      default: {},
    }),
  },
  tabLabel: {
    fontFamily,
    fontSize: 14,
    fontWeight: '400',
    color: MOBILE.secondary,
    letterSpacing: -0.2,
    flexShrink: 1,
    ...Platform.select({
      web: {
        whiteSpace: 'nowrap',
        transitionProperty: 'opacity, max-width',
        transitionDuration: `${Math.round(SIDEBAR_ANIM_MS * 0.55)}ms`,
        transitionTimingFunction: 'ease',
      },
      default: {},
    }),
  },
  tabLabelCollapsed: {
    position: 'absolute',
    width: 0,
    height: 0,
    maxWidth: 0,
    opacity: 0,
    overflow: 'hidden',
    ...Platform.select({
      web: { display: 'none' },
      default: {},
    }),
  },
  tabTrailing: {
    marginLeft: 'auto',
    flexShrink: 0,
  },
  tabTrailingCollapsed: {
    position: 'absolute',
    width: 0,
    height: 0,
    opacity: 0,
    overflow: 'hidden',
    margin: 0,
    padding: 0,
    ...Platform.select({
      web: { display: 'none' },
      default: {},
    }),
  },
  tabSubtitle: {
    fontFamily,
    fontSize: 12,
    fontWeight: '400',
    color: MOBILE.secondary,
    letterSpacing: -0.2,
    marginTop: 1,
  },
  tabSubtitleActive: {
    color: MOBILE.secondary,
  },
  tabLabelHover: {
    color: MOBILE.label,
  },
  tabLabelActive: {
    color: MOBILE.label,
    fontWeight: '600',
  },
  profileStoreButton: {
    width: SIDEBAR_TAB_ICON_SLOT,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: (SIDEBAR_TAB_ICON_SLOT - TAB_ICON_SIZE) / 2,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  profileStoreButtonPressed: {
    opacity: 0.55,
  },
  profileStoreMark: {
    width: 26,
    height: 26,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileStoreMarkText: {
    fontFamily,
    fontSize: 10,
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
  contentMobileTabInset: {
    paddingBottom: mobileTabBarReserve(),
  },
  mobilePhoneDockSlot: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: mobileTabBarReserve(),
    zIndex: 50,
  },
  mobilePhoneDockSlotThread: {
    bottom: mobileSafeBottom(),
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
  contentUnderTopBar: {
    paddingTop: TOP_BAR_HEIGHT,
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
    backgroundColor: CANVAS,
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
  homeSearch: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 140,
    borderRadius: 8,
    paddingHorizontal: 12,
    backgroundColor: '#fff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: TAB_BORDER,
    minHeight: 40,
  },
  homeSearchIcon: {
    marginRight: 8,
  },
  homeDateFieldCompact: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: TAB_BORDER,
    paddingHorizontal: 12,
    minHeight: 40,
    justifyContent: 'center',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  homeDateFieldValueCompact: {
    fontSize: 13,
    color: '#1a1a1a',
    letterSpacing: 0,
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
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: TAB_BORDER,
    padding: 0,
    overflow: 'hidden',
  },
  homeSegmentButton: {
    paddingHorizontal: 14,
    height: 38,
    borderRadius: 0,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  homeSegmentButtonActive: {
    backgroundColor: '#1a1a1a',
  },
  homeSegmentText: {
    fontFamily,
    fontSize: 13,
    fontWeight: '400',
    color: '#8e8e93',
    letterSpacing: 0,
  },
  homeSegmentTextActive: {
    color: '#fff',
    fontWeight: '600',
  },
  homeDateField: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: TAB_BORDER,
    paddingHorizontal: 12,
    minHeight: 40,
    justifyContent: 'center',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  homeDateFieldValue: {
    fontSize: 13,
    color: '#1a1a1a',
    letterSpacing: 0,
  },
  homeDateSep: {
    fontFamily,
    fontSize: 16,
    color: '#c7c7cc',
  },
  homeStoreTableCard: {
    backgroundColor: 'transparent',
    width: '100%',
    overflow: 'visible',
  },
  homeStoreTable: {
    flexGrow: 1,
    minWidth: 860,
  },
  homeStoreTableNoAmounts: {
    minWidth: 680,
  },
  homeStoreRow: {
    position: 'relative',
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 46,
    paddingVertical: 6,
    paddingLeft: 0,
    overflow: 'visible',
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
  homeStoreRowHovered: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: -6,
    right: 8,
    borderRadius: SIDEBAR_TAB_ACTIVE_RADIUS,
    backgroundColor: NAV_TAB_ACTIVE_BG,
  },
  homeStoreRowHoveredNative: {
    marginLeft: -6,
    marginRight: 8,
    borderRadius: SIDEBAR_TAB_ACTIVE_RADIUS,
    backgroundColor: NAV_TAB_ACTIVE_BG,
    borderBottomColor: 'transparent',
  },
  homeStoreRowStatic: {
    ...Platform.select({
      web: { cursor: 'default' },
      default: {},
    }),
  },
  homeStoreRowSelected: {
    backgroundColor: 'transparent',
  },
  homeStoreRowForeground: {
    flex: 1,
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    zIndex: 1,
  },
  homeStoreRowBody: {
    flex: 1,
    minWidth: 0,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginLeft: 10,
    paddingRight: 10,
  },
  homeStoreRowRule: {
    position: 'absolute',
    left: 32,
    right: 10,
    bottom: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(42,38,30,0.08)',
  },
  homeStoreRowRuleHeader: {
    backgroundColor: 'rgba(42,38,30,0.16)',
  },
  homeStoreRowRuleTotal: {
    top: 0,
    bottom: null,
  },
  homeStoreRowRuleHidden: {
    opacity: 0,
  },
  homeStoreRowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(42,38,30,0.08)',
  },
  homeStoreHeaderRow: {
    backgroundColor: CANVAS,
    minHeight: 34,
    ...Platform.select({
      web: {
        cursor: 'default',
      },
      default: {},
    }),
  },
  homeStoreHeaderRule: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(42,38,30,0.16)',
  },
  homeStoreTotalRow: {
    minHeight: 46,
    backgroundColor: '#f5f5f5',
    ...Platform.select({
      web: { cursor: 'default' },
      default: {},
    }),
  },
  homeStoreTotalRule: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(42,38,30,0.08)',
  },
  homeStoreIconWrap: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    flexShrink: 0,
  },
  homeStoreIconHit: {
    zIndex: 2,
    ...Platform.select({
      web: { cursor: 'default' },
      default: {},
    }),
  },
  homeStoreIconClosed: {
    opacity: 0.5,
    ...Platform.select({
      web: { filter: 'grayscale(0.4)' },
      default: {},
    }),
  },
  homeStoreIconTile: {
    width: 22,
    height: 22,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  homeStoreIconSpacer: {
    width: 32,
    flexShrink: 0,
  },
  homeStoreHeader: {
    fontFamily,
    fontSize: 13,
    fontWeight: '500',
    color: MOBILE.secondary,
    letterSpacing: -0.15,
  },
  homeStoreHeaderActive: {
    color: MOBILE.label,
    fontWeight: '600',
  },
  homeStoreHeaderButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 3,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  homeStoreHeaderButtonCenter: {
    justifyContent: 'center',
  },
  homeStoreHeaderButtonEnd: {
    justifyContent: 'flex-end',
  },
  homeStoreHeaderMetric: {
    textAlign: 'center',
  },
  homeStoreHeaderIconCell: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  homeStoreHeaderIconTile: {
    width: 26,
    height: 26,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  homeStoreName: {
    fontFamily: titleFontFamily,
    fontSize: 14,
    fontWeight: '400',
    color: MOBILE.label,
    letterSpacing: -0.2,
    flexShrink: 1,
    minWidth: 0,
  },
  homeStoreMeta: {
    fontFamily,
    fontSize: 12,
    color: MOBILE.secondary,
    letterSpacing: -0.1,
    fontVariant: ['tabular-nums'],
    flexShrink: 1,
    minWidth: 0,
  },
  homeStoreMoney: {
    fontFamily,
    fontSize: 14,
    fontWeight: '400',
    color: MOBILE.label,
    letterSpacing: -0.2,
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
    fontSize: 14,
    fontWeight: '600',
    color: MOBILE.label,
    letterSpacing: -0.2,
    flexShrink: 1,
    minWidth: 0,
  },
  homeStoreColStore: {
    flexGrow: 0,
    flexShrink: 1,
    minWidth: 160,
    maxWidth: 240,
    flexDirection: 'column',
    alignItems: 'flex-start',
    justifyContent: 'center',
    gap: 1,
  },
  homeStoreColMoney: {
    width: 112,
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
    width: 148,
    flexShrink: 0,
    paddingLeft: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  homeStoreColPeopleTrailing: {
    marginLeft: 'auto',
    paddingLeft: 0,
    textAlign: 'right',
  },
  homeStoreColEmail: {
    width: 76,
    minWidth: 76,
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    ...Platform.select({
      web: { whiteSpace: 'nowrap' },
      default: {},
    }),
  },
  homeStoreColPhone: {
    width: 76,
    minWidth: 76,
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    ...Platform.select({
      web: { whiteSpace: 'nowrap' },
      default: {},
    }),
  },
  homeStoreColReview: {
    width: 76,
    minWidth: 76,
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    ...Platform.select({
      web: { whiteSpace: 'nowrap' },
      default: {},
    }),
  },
  homeStoreRateIcon: {
    width: 14,
    height: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  homeStoreRateValue: {
    flexShrink: 0,
    alignItems: 'flex-start',
  },
  homeStoreRateSpacer: {
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 28,
  },
  homeStoreTrailingGap: {
    width: 36,
    flexShrink: 0,
  },
  homeStorePhone: {
    fontFamily,
    fontSize: 12,
    fontWeight: '500',
    color: MOBILE.label,
    letterSpacing: -0.1,
    fontVariant: ['tabular-nums'],
    flexShrink: 0,
    textAlign: 'left',
    ...Platform.select({
      web: { fontVariantNumeric: 'tabular-nums' },
      default: {},
    }),
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
    width: 148,
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    height: HOME_PEOPLE_SIZE,
    paddingLeft: 12,
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
    maxWidth: 148,
    height: 32,
    marginTop: 0,
    paddingLeft: 0,
  },
  homePeopleAvatarWrap: {
    position: 'relative',
    borderRadius: HOME_PEOPLE_SIZE / 2,
    overflow: 'visible',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  homeReviewStar: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#7A5410',
    borderWidth: 1.5,
    borderColor: '#fff',
    zIndex: 4,
    ...Platform.select({
      web: { boxShadow: '0 1px 2px rgba(0,0,0,0.18)' },
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
    width: 14,
    alignItems: 'center',
    flexShrink: 0,
  },
  appsRowStatus: {
    width: 88,
    flexShrink: 0,
    alignItems: 'flex-end',
    justifyContent: 'center',
    textAlign: 'right',
  },
  appsRowStatusPinned: {
    color: '#1a1a1a',
    fontWeight: '600',
  },
  appsRowPin: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  appsRowPinSpacer: {
    width: 32,
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
  storeDrawerShellFill: {
    width: '100%',
    overflow: 'hidden',
    backgroundColor: CANVAS,
    position: 'relative',
  },
  storeDrawerRoot: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    width: '100%',
    height: '100%',
    zIndex: 35,
  },
  storeRailTab: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 44,
    height: 36,
    borderRadius: SIDEBAR_TAB_ACTIVE_RADIUS,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  storeAppsLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 18,
  },
  storeAppsCardDocked: {
    top: HOME_MOBILE_TOP_BAR_HEIGHT + 8,
    right: MOBILE_FILTER_INSET,
  },
  storeAppsCard: {
    position: 'absolute',
    right: HOME_FILTER_RIGHT,
    width: 308,
    maxWidth: '92%',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    gap: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: TAB_BORDER,
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
  storeAppsScroll: {
    maxHeight: 420,
  },
  storeAppsRowSelected: {
    backgroundColor: 'rgba(0,122,255,0.08)',
  },
  storeAppsRowPressed: {
    backgroundColor: 'rgba(60,60,67,0.08)',
  },
  storeAppsLabel: {
    flex: 1,
    minWidth: 0,
  },
  storeAppsLabelSelected: {
    color: '#1a1a1a',
  },
  storeDrawerPanel: {
    flexShrink: 0,
    minWidth: 0,
    minHeight: 0,
    overflow: 'hidden',
    flexDirection: 'column',
    backgroundColor: CANVAS,
  },
  storeDrawerMain: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    flexDirection: 'column',
    backgroundColor: CANVAS,
  },
  storeDrawerPanelMobile: {
    backgroundColor: CANVAS,
    flex: 1,
  },
  storeDrawerAppsRail: {
    width: STORE_DRAWER_RAIL_WIDTH,
    flexShrink: 0,
    justifyContent: 'flex-start',
    alignItems: 'center',
    paddingTop: 16,
    paddingBottom: 16,
    paddingHorizontal: 10,
    gap: 2,
    backgroundColor: CANVAS,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: 'rgba(42,38,30,0.08)',
    overflow: 'visible',
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
    fontFamily: titleFontFamily,
    fontSize: 22,
    fontWeight: '400',
    color: '#1a1a1a',
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
  appleSheetTitle: {
    fontFamily,
    flex: 1,
    fontSize: 17,
    fontWeight: '600',
    color: '#1a1a1a',
    letterSpacing: -0.4,
  },
  appleCloseButton: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  buyTxSheet: {
    flex: 1,
    backgroundColor: '#fff',
  },
  buyTxEmbed: {
    backgroundColor: '#fff',
  },
  buyTxEmbedHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 44,
    paddingHorizontal: 8,
    paddingBottom: 4,
  },
  buyTxEmbedTitles: {
    flex: 1,
    minWidth: 0,
  },
  buyTxEmbedTitle: {
    fontFamily,
    fontSize: 17,
    fontWeight: '600',
    color: '#1d1d1f',
    letterSpacing: -0.3,
  },
  buyTxEmbedSub: {
    fontFamily,
    fontSize: 13,
    fontWeight: '400',
    color: '#6e6e73',
    marginTop: 1,
  },
  buyTxScroll: {
    flex: 1,
    minHeight: 0,
  },
  buyTxScrollContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 40,
    gap: 14,
  },
  buyTxCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e5ea',
    borderRadius: 12,
    backgroundColor: '#fff',
    overflow: 'hidden',
    ...Platform.select({
      web: { boxShadow: '0 8px 24px rgba(0,0,0,0.04)' },
      default: {},
    }),
  },
  buyTxTotalsRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 16,
    minHeight: 44,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  buyTxTotalsGrand: {
    alignItems: 'center',
    minHeight: 58,
    paddingVertical: 14,
    backgroundColor: '#EAF6EE',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#d7eadc',
  },
  buyTxTotalsLabel: {
    fontFamily,
    fontSize: 13,
    fontWeight: '500',
    color: '#6e6e73',
  },
  buyTxTotalsAmount: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: '#1d1d1f',
    letterSpacing: -0.2,
  },
  buyTxTotalsGrandLabel: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: '#1F8A4E',
  },
  buyTxTotalsGrandAmount: {
    fontFamily,
    fontSize: 26,
    fontWeight: '600',
    color: '#1d1d1f',
    letterSpacing: -0.6,
    fontVariant: ['tabular-nums'],
  },
  buyTxField: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    minHeight: 42,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ececef',
  },
  buyTxFieldLast: {
    borderBottomWidth: 0,
  },
  buyTxFieldLabel: {
    fontFamily,
    width: 82,
    flexShrink: 0,
    fontSize: 13,
    fontWeight: '500',
    color: '#6e6e73',
    paddingTop: 2,
  },
  buyTxFieldValueWrap: {
    flex: 1,
    minWidth: 0,
    alignItems: 'flex-end',
  },
  buyTxFieldValue: {
    fontFamily,
    fontSize: 15,
    fontWeight: '500',
    color: '#1d1d1f',
    letterSpacing: -0.2,
    textAlign: 'right',
  },
  buyTxFieldSub: {
    fontFamily,
    fontSize: 12,
    color: '#8e8e93',
    textAlign: 'right',
    marginTop: 2,
  },
  buyTxSection: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: '#1d1d1f',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
    marginTop: 4,
    marginBottom: -6,
  },
  buyTxLoading: {
    minHeight: 72,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buyTxEmpty: {
    fontFamily,
    fontSize: 14,
    color: '#8e8e93',
    paddingHorizontal: 16,
    paddingVertical: 18,
  },
  buyTxItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ececef',
  },
  buyTxItemRowLast: {
    borderBottomWidth: 0,
  },
  buyTxItemCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  buyTxItemName: {
    fontFamily,
    fontSize: 15,
    fontWeight: '500',
    color: '#1d1d1f',
    letterSpacing: -0.2,
  },
  buyTxItemMeta: {
    fontFamily,
    fontSize: 12,
    color: '#8e8e93',
  },
  buyTxItemAmount: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: '#1d1d1f',
    letterSpacing: -0.2,
    fontVariant: ['tabular-nums'],
  },
  buyTxItemQty: {
    alignItems: 'flex-end',
    flexShrink: 0,
    gap: 2,
  },
  buyTxItemQtyValue: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: '#1d1d1f',
    fontVariant: ['tabular-nums'],
  },
  buyTxItemQtyUnit: {
    fontFamily,
    fontSize: 11,
    color: '#8e8e93',
    maxWidth: 88,
    textAlign: 'right',
  },
  buyTxNotes: {
    fontFamily,
    fontSize: 15,
    color: '#1d1d1f',
    lineHeight: 22,
    paddingHorizontal: 16,
    paddingVertical: 14,
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
  breadcrumbDesktop: {
    paddingTop: TOP_BAR_HEIGHT + 12,
    paddingBottom: 8,
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
  toolsToolbarMobile: {
    maxWidth: '100%',
    marginTop: 0,
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
  appsViewToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
    height: 34,
    padding: 2,
    gap: 2,
    backgroundColor: 'transparent',
  },
  appsViewToggleSheet: {
    height: 40,
    alignSelf: 'stretch',
    justifyContent: 'space-between',
    backgroundColor: '#e8e8ed',
    borderRadius: 12,
    padding: 3,
    gap: 0,
  },
  appsViewToggleButton: {
    width: 34,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
    borderWidth: 0,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  appsViewToggleButtonSheet: {
    flex: 1,
    width: undefined,
    height: 34,
    borderRadius: 9,
  },
  appsViewToggleButtonActive: {
    backgroundColor: '#fff',
    borderWidth: 0,
    ...Platform.select({
      web: {
        boxShadow: '0 1px 2px rgba(0,0,0,0.10)',
      },
      default: {
        elevation: 1,
      },
    }),
  },
  appsViewToggleCompact: {
    height: 32,
    alignSelf: 'center',
    flexShrink: 0,
  },
  appsViewToggleButtonCompact: {
    width: 30,
    height: 28,
    borderRadius: 7,
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
  homeTxEmpty: {
    fontFamily,
    fontSize: 13,
    color: '#8e8e93',
    paddingHorizontal: 8,
    paddingVertical: 28,
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
  screenReloadButton: {
    marginTop: 16,
    paddingHorizontal: 18,
    paddingVertical: 9,
    borderRadius: 8,
    backgroundColor: '#1a1a1a',
  },
  screenReloadLabel: {
    fontFamily,
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
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
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  toolCardPressed: {
    opacity: 0.7,
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
    gap: 7,
    paddingTop: 4,
    paddingBottom: 2,
    paddingHorizontal: 0,
    ...Platform.select({
      web: {
        cursor: 'pointer',
      },
      default: {},
    }),
  },
  appsGridIcon: {
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    ...Platform.select({
      web: {
        boxShadow: '0 1px 1px rgba(0,0,0,0.06), 0 8px 18px rgba(0,0,0,0.12)',
      },
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.14,
        shadowRadius: 10,
        elevation: 4,
      },
    }),
  },
  appsGridPin: {
    position: 'absolute',
    top: -8,
    right: -14,
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0,
    zIndex: 2,
    ...Platform.select({
      web: {
        cursor: 'pointer',
      },
      default: {
        opacity: 1,
      },
    }),
  },
  appsGridPinActive: {
    opacity: 1,
  },
  appsGridLabel: {
    fontFamily,
    fontSize: 12,
    fontWeight: '500',
    color: '#1d1d1f',
    letterSpacing: -0.08,
    textAlign: 'center',
    lineHeight: 16,
    minHeight: 32,
    width: '100%',
    ...Platform.select({
      web: {
        overflowWrap: 'anywhere',
        wordBreak: 'normal',
      },
      default: {},
    }),
  },
  appsGridLabelPinned: {
    fontWeight: '600',
  },
  toolIconStack: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolCardMobile: {
    gap: 8,
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
  toolIconTileMobile: {
    ...Platform.select({
      web: {
        boxShadow: '0 1px 2px rgba(0,0,0,0.14), 0 8px 16px rgba(0,0,0,0.16)',
      },
      default: {
        elevation: 6,
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
  toolCardLabelMobile: {
    fontSize: 12,
    fontWeight: '600',
    color: '#000',
    lineHeight: 15,
    letterSpacing: -0.2,
    paddingHorizontal: 0,
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
  toolListRowHovered: {
    backgroundColor: '#f2f2f7',
  },
  toolListRowLast: {
    borderBottomWidth: 0,
  },
  toolListPin: {
    width: 32,
    height: 32,
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
  tableList: {
    flex: 1,
    overflow: 'hidden',
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
    backgroundColor: CANVAS,
    ...Platform.select({
      web: {
        boxShadow: '-8px 0 24px rgba(0,0,0,0.08)',
      },
      default: {
        elevation: 8,
      },
    }),
  },
  appleSheetPanel: {
    backgroundColor: CANVAS,
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
  drawerBodyContentMobile: {
    paddingHorizontal: 16,
    paddingBottom: 48,
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
    borderColor: TAB_BORDER,
    borderRadius: 8,
    padding: 16,
    backgroundColor: '#fff',
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
  invoiceColItem: {
    flex: 1,
    minWidth: 0,
    paddingRight: 16,
  },
  invoiceEmptyLine: {
    fontFamily,
    fontSize: 13,
    color: '#8a8a8a',
    paddingVertical: 20,
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
  tableEmptyText: {
    fontFamily,
    fontSize: 13,
    color: '#8a8a8a',
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
  loginButtonText: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: '#fff',
  },
  igSearchField: {
    minHeight: 40,
    borderRadius: 8,
    backgroundColor: '#fff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: TAB_BORDER,
  },
  igHomePad: {
    width: '100%',
    maxWidth: '100%',
    paddingHorizontal: 16,
    alignSelf: 'stretch',
  },
  igFilterLines: {
    width: 15,
    height: 11,
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  igFilterLinesLarge: {
    width: 20,
    height: 15,
  },
  igFilterLine: {
    height: 1.5,
    borderRadius: 1,
  },
  igFilterLineLarge: {
    height: 2,
  },
  igHomeFilterLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 20,
  },
  igHomeFilterCard: {
    position: 'absolute',
    width: 264,
    maxWidth: '92%',
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(42,38,30,0.08)',
    ...Platform.select({
      web: {
        boxShadow: '0 10px 28px rgba(0,0,0,0.12), 0 1px 3px rgba(0,0,0,0.06)',
      },
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.12,
        shadowRadius: 16,
        elevation: 10,
      },
    }),
  },
  igHomeFiltersCard: {
    width: 264,
  },
  igHomeFiltersCardBlur: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(252,252,251,0.92)',
    ...Platform.select({
      web: {
        backdropFilter: 'saturate(120%) blur(12px)',
        WebkitBackdropFilter: 'saturate(120%) blur(12px)',
      },
      default: {},
    }),
  },
  igHomeFiltersCardBody: {
    paddingHorizontal: 12,
    paddingTop: 14,
    paddingBottom: 12,
    gap: 14,
  },
  igHomeFiltersControls: {
    alignSelf: 'stretch',
    gap: 18,
  },
  igHomeFiltersTradeRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 8,
    paddingTop: 2,
  },
  igHomeFiltersTradeBtn: {
    flex: 1,
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  igFilterAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 40,
    paddingHorizontal: 4,
    borderRadius: 10,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  igFilterActionIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  igFilterActionBuy: {
    backgroundColor: '#1F8A4E',
  },
  igFilterActionSell: {
    backgroundColor: '#C0392B',
  },
  igFilterActionLabel: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: '#1a1a1a',
    letterSpacing: 0,
  },
  igFilterDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: TAB_BORDER,
    marginHorizontal: 4,
  },
  igFilterSearch: {
    flex: 0,
    alignSelf: 'stretch',
    width: '100%',
  },
  igFilterLabel: {
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
    color: '#8e8e93',
    letterSpacing: -0.08,
    textTransform: 'uppercase',
    paddingHorizontal: 4,
  },
  igSearchInput: {
    fontSize: 16,
    paddingVertical: 10,
    color: '#1a1a1a',
  },
  homeDateFieldFill: {
    flex: 1,
    minWidth: 0,
    minHeight: 40,
    borderRadius: 8,
    backgroundColor: '#fff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: TAB_BORDER,
  },
  igHomeDesktopHost: {
    alignItems: 'stretch',
    backgroundColor: CANVAS,
  },
  igHomeDesktopFeed: {
    width: '100%',
    maxWidth: '100%',
    alignSelf: 'stretch',
    paddingHorizontal: 0,
    paddingTop: 0,
  },
  igHomeContentInset: {
    width: '100%',
    alignSelf: 'center',
  },
  igHomeTableInset: {
    width: '100%',
    alignSelf: 'center',
  },
  igHomeScrollContent: {
    alignItems: 'center',
  },
  igHomeStage: {
    flex: 1,
    minHeight: 0,
    position: 'relative',
  },
  appsChromeRow: {
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  appsChromeSearch: {
    marginLeft: 0,
    flexGrow: 0,
  },
  appsViewChrome: {
    flexShrink: 0,
    height: 40,
    borderRadius: 20,
    overflow: 'hidden',
    ...Platform.select({
      web: {
        boxShadow: '0 10px 28px rgba(0,0,0,0.14), 0 1px 3px rgba(0,0,0,0.08)',
      },
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.16,
        shadowRadius: 18,
        elevation: 12,
      },
    }),
  },
  appsViewChromeBlur: {
    height: 40,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 3,
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,0,0,0.08)',
    backgroundColor: 'rgba(255,255,255,0.56)',
  },
  igHomeChromeRow: {
    zIndex: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    width: '100%',
    minHeight: 40,
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 10,
    backgroundColor: 'transparent',
  },
  igHomeChromeShell: {
    marginBottom: 4,
  },
  igHomeChromeShellMobile: {
    marginBottom: 0,
  },
  igHomeChromeRowMobile: {
    alignItems: 'flex-start',
    gap: 10,
    paddingHorizontal: 0,
    paddingTop: 4,
    paddingBottom: 10,
  },
  igHomeChromeControlsMobile: {
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 8,
  },
  igHomeChromeRowDesktop: {
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    paddingHorizontal: 0,
    paddingTop: 20,
    paddingBottom: 16,
  },
  igHomeChromeControls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
    flexShrink: 0,
  },
  igHomeChromeControlsFull: {
    flex: 1,
  },
  igHomeHeroStack: {
    alignSelf: 'stretch',
    gap: 14,
  },
  igHomeHeroTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  igHomeHeroTitleIcon: {
    width: undefined,
    minWidth: 0,
  },
  igHomeHeroTitle: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: MOBILE.label,
    letterSpacing: -0.2,
  },
  igHomeHeroWithIconCol: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    alignSelf: 'stretch',
  },
  igHomeHeroIconCol: {
    marginLeft: HOME_STORE_ROW_PAD,
    width: HOME_STORE_ICON_COL_WIDTH,
    alignItems: 'center',
    justifyContent: 'flex-start',
    flexShrink: 0,
    paddingTop: 1,
  },
  igHomeHeroContentCol: {
    flex: 1,
    minWidth: 0,
    marginLeft: HOME_STORE_BODY_LEADING,
  },
  igHomeHeroToolIcon: {
    width: undefined,
    minWidth: 0,
  },
  igStoreDeskChrome: {
    zIndex: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 20,
    width: '100%',
    minHeight: 44,
    paddingHorizontal: 48,
    paddingTop: 16,
    paddingBottom: 12,
    backgroundColor: 'transparent',
  },
  igStoreDeskName: {
    flexShrink: 1,
    minWidth: 0,
    maxWidth: 320,
    fontFamily,
    fontSize: 22,
    fontWeight: '600',
    color: '#6B5E3A',
    letterSpacing: -0.3,
  },
  igHomeChromeChip: {
    marginLeft: 'auto',
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 180,
    minWidth: 0,
    maxWidth: 320,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'transparent',
    ...Platform.select({
      web: {
        boxShadow: '0 10px 28px rgba(0,0,0,0.14), 0 1px 3px rgba(0,0,0,0.08)',
      },
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.16,
        shadowRadius: 18,
        elevation: 12,
      },
    }),
  },
  igHomeChromeSearch: {
    flex: 1,
    height: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 12,
    paddingRight: 10,
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,0,0,0.08)',
    backgroundColor: 'rgba(255,255,255,0.56)',
  },
  igHomeChromeSearchDesktop: {
    flexGrow: 0,
    flexBasis: 280,
    width: 280,
    maxWidth: 280,
  },
  igHomeChromeSearchInput: {
    flex: 1,
    minWidth: 0,
    height: 40,
    paddingVertical: 0,
    margin: 0,
    fontFamily,
    fontSize: 15,
    lineHeight: 20,
    color: '#1a1a1a',
    outlineStyle: 'none',
  },
  homeTabSearchField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: '#fff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(60, 60, 67, 0.18)',
  },
  homeTabSearchFieldMobile: {
    minHeight: 40,
    borderRadius: 10,
  },
  homeTabSearchFieldDesktop: {
    borderRadius: 6,
    minHeight: 40,
    height: 40,
    paddingHorizontal: 12,
  },
  homeTabSearchInput: {
    flex: 1,
    minWidth: 0,
    fontFamily,
    fontSize: 16,
    color: '#1d1d1f',
    paddingVertical: 8,
    outlineStyle: 'none',
  },
  homeTabSearchInputDesktop: {
    paddingVertical: 0,
    height: 40,
    lineHeight: 20,
    fontSize: 16,
  },
  igHomePinnedTopDesktop: {
    paddingTop: 0,
    paddingBottom: 40,
  },
  igHomeDesktopSheet: {
    marginTop: 0,
    marginHorizontal: 0,
    paddingBottom: 24,
    width: '100%',
    maxWidth: '100%',
    alignSelf: 'stretch',
    backgroundColor: 'transparent',
  },
  igStoreCardWide: {
    minHeight: 76,
    paddingLeft: 32,
  },
  igStoreBodyWide: {
    gap: 20,
    paddingVertical: 16,
    paddingRight: 32,
    ...Platform.select({
      web: {
        display: 'grid',
        gridTemplateColumns: 'minmax(160px, 1fr) 216px 148px 18px',
        alignItems: 'center',
        columnGap: 24,
      },
      default: {},
    }),
  },
  igStoreTileFoot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    gap: 12,
  },
  igHomeHeroInsetDesktop: {
    gap: 10,
    paddingHorizontal: 0,
    paddingTop: 0,
    paddingBottom: 0,
  },
  igHomeHeroAmountDesktop: {
    alignSelf: 'flex-end',
    fontSize: 24,
    lineHeight: 28,
  },
  igHomeHeroMainRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    alignSelf: 'stretch',
  },
  igHomeHeroMainRowBare: {
    flexDirection: 'column',
  },
  igHomeHeroPrimary: {
    alignSelf: 'stretch',
  },
  igHomeHeroSplit: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    alignSelf: 'stretch',
    width: '100%',
    gap: 24,
  },
  igHomeHeroSplitMobile: {
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    gap: 12,
  },
  igHomeHeroSplitBare: {
    alignItems: 'flex-start',
  },
  igHomeHeroFigures: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'flex-end',
    marginLeft: 'auto',
    marginRight: 0,
    gap: 28,
    flexShrink: 0,
  },
  igHomeHeroFiguresBare: {
    marginLeft: 0,
    width: '100%',
    justifyContent: 'space-between',
  },
  igHomeHeroPair: {
    flexDirection: 'row',
    alignItems: 'stretch',
    flexShrink: 0,
    gap: 6,
  },
  igHomeHeroPairEnd: {
    marginLeft: 'auto',
    alignSelf: 'flex-end',
  },
  igHomeHeroPairBare: {
    gap: 16,
    alignItems: 'flex-start',
  },
  igHomeHeroMetricBlock: {
    flexDirection: 'row',
    alignItems: 'stretch',
    alignSelf: 'flex-start',
    gap: 8,
    overflow: 'visible',
  },
  igHomeHeroMetricBlockDesktop: {
    gap: 8,
  },
  igHomeHeroMetricBlockMobile: {
    alignSelf: 'stretch',
    width: '100%',
    justifyContent: 'space-between',
  },
  igHomeHeroMetricMain: {
    flexShrink: 0,
    alignSelf: 'flex-start',
  },
  igHomeHeroPeriod: {
    fontFamily,
    fontSize: 14,
    fontWeight: '400',
    color: '#8e8e93',
    letterSpacing: -0.2,
    alignSelf: 'center',
    marginRight: 0,
    flexShrink: 0,
  },
  igHomeHeroRevenueStack: {
    alignItems: 'flex-end',
    gap: 2,
    alignSelf: 'flex-start',
  },
  igHomeHeroRevenueAmount: {
    alignItems: 'flex-end',
  },
  igHomeHeroRevenueLabel: {
    fontFamily,
    fontSize: 11,
    fontWeight: '500',
    color: '#8e8e93',
    letterSpacing: 0.02,
    textAlign: 'right',
  },
  igHomeHeroBlockTitle: {
    fontFamily,
    fontSize: 10,
    fontWeight: '400',
    color: '#aeaeb2',
    letterSpacing: 0.02,
    textAlign: 'right',
  },
  igHomeHeroAmountEnd: {
    textAlign: 'right',
    alignSelf: 'flex-end',
  },
  igStoreTile: {
    flexGrow: 1,
    flexBasis: 340,
    maxWidth: '100%',
    minHeight: 132,
    paddingLeft: 16,
    paddingRight: 16,
    paddingTop: 16,
    paddingBottom: 14,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(42,38,30,0.08)',
    alignItems: 'stretch',
    flexDirection: 'column',
    gap: 14,
    ...Platform.select({
      web: {
        boxShadow: '0 8px 24px rgba(18,16,12,0.06)',
      },
      default: {},
    }),
  },
  igStoreTileTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    width: '100%',
  },
  igHomeScreen: {
    backgroundColor: CANVAS,
    position: 'relative',
    overflow: 'hidden',
  },
  igHomeScroll: {
    paddingTop: 0,
    paddingBottom: 0,
    backgroundColor: 'transparent',
  },
  igHomeOverlayScroll: {
    zIndex: 4,
    backgroundColor: 'transparent',
  },
  igHomeScrollEnd: {
    paddingBottom: mobileTabBarReserve() + 40,
  },
  igHomePinnedTop: {
    paddingHorizontal: 0,
    paddingTop: 8,
    paddingBottom: 20,
    backgroundColor: 'transparent',
    marginBottom: 0,
  },
  igHomePinnedTopMobile: {
    paddingTop: 4,
    paddingBottom: 12,
  },
  igHomeMobileTopBarShell: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    // Above the store drawer panel (zIndex 35) so the bar stays visible and
    // tappable in store details. Below modals, which render in their own root.
    zIndex: 40,
  },
  igHomeMobileTopBarClip: {
    position: 'relative',
    overflow: 'hidden',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(0,0,0,0.08)',
  },
  igHomeMobileTopBarBlur: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(252,252,251,0.92)',
    ...Platform.select({
      web: {
        backdropFilter: 'saturate(120%) blur(12px)',
        WebkitBackdropFilter: 'saturate(120%) blur(12px)',
      },
      default: {},
    }),
  },
  igHomeMobileTopBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingHorizontal: MOBILE_FILTER_INSET,
    paddingTop: 8,
    paddingBottom: 8,
    minHeight: 48,
  },
  igHomeMobileBrand: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  igHomeMobileStoreLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
    minWidth: 0,
    gap: 8,
  },
  igHomeMobileCrumbHome: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  igHomeMobileCrumbSep: {
    fontFamily,
    fontSize: 16,
    fontWeight: '400',
    color: '#c7c7cc',
    flexShrink: 0,
  },
  igHomeMobileStoreName: {
    flexShrink: 1,
    minWidth: 0,
    fontFamily,
    fontSize: 17,
    fontWeight: '600',
    color: MOBILE.label,
    letterSpacing: -0.3,
  },
  igHomeMobileTopBarTrailing: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
    flexShrink: 1,
    minWidth: 0,
  },
  igHomeMobileFilterBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 32,
    minWidth: 44,
    paddingHorizontal: 12,
    borderRadius: SIDEBAR_TAB_ACTIVE_RADIUS,
    borderWidth: 1,
    borderColor: TAB_BORDER,
    backgroundColor: 'transparent',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  igHomeMobileFilterBtnActive: {
    backgroundColor: NAV_TAB_ACTIVE_BG,
  },
  igHomeMobileFilterBtnPressed: {
    opacity: 0.6,
  },
  igHomeMobileDateAnchor: {
    flexShrink: 1,
    minWidth: 0,
    maxWidth: '100%',
    alignItems: 'flex-end',
    alignSelf: 'flex-end',
  },
  igHomeMobileDateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-end',
    height: 32,
    flexGrow: 0,
    flexShrink: 1,
    maxWidth: '100%',
    paddingLeft: 10,
    paddingRight: 6,
    gap: 8,
    borderRadius: SIDEBAR_TAB_ACTIVE_RADIUS,
    borderWidth: 1,
    borderColor: TAB_BORDER,
    backgroundColor: 'transparent',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  igHomeMobileDateBtnActive: {
    backgroundColor: NAV_TAB_ACTIVE_BG,
  },
  igHomeMobileDateBtnDisabled: {
    opacity: 0.45,
  },
  igHomeMobileDateBtnPressed: {
    opacity: 0.6,
  },
  igHomeMobileDateText: {
    flexShrink: 1,
    fontFamily: FONT,
    fontSize: 14,
    fontWeight: '400',
    color: '#1a1a1a',
    letterSpacing: -0.2,
    fontVariant: ['tabular-nums'],
  },
  igHomeMobileDateChevrons: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
    flexShrink: 0,
  },
  igHomeMobileAppsSearch: {
    flex: 1,
    flexShrink: 1,
    minWidth: 64,
    flexDirection: 'row',
    alignItems: 'center',
    height: 32,
    paddingHorizontal: 10,
    gap: 6,
    borderRadius: SIDEBAR_TAB_ACTIVE_RADIUS,
    borderWidth: 1,
    borderColor: TAB_BORDER,
    backgroundColor: 'transparent',
  },
  igHomeMobileAppsSearchInput: {
    flex: 1,
    minWidth: 0,
    fontFamily,
    fontSize: 14,
    fontWeight: '400',
    color: '#1a1a1a',
    letterSpacing: -0.2,
    paddingVertical: 0,
    outlineStyle: 'none',
  },
  igHomeHeroShell: {
    alignSelf: 'stretch',
  },
  igHomeHeroAnalyticsLink: {
    alignSelf: 'flex-start',
    overflow: 'visible',
    borderRadius: 12,
    marginVertical: -2,
    paddingVertical: 6,
    paddingHorizontal: 10,
    marginHorizontal: -10,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  igHomeHeroAnalyticsLinkDesktop: {
    paddingVertical: 0,
    paddingHorizontal: 0,
    marginHorizontal: 0,
  },
  igHomeHeroAnalyticsLinkMobile: {
    alignSelf: 'stretch',
    width: '100%',
    paddingVertical: 2,
    paddingHorizontal: 0,
    marginHorizontal: 0,
  },
  igHomeHeroWithIconColMobile: {
    gap: 0,
    alignItems: 'flex-start',
  },
  igHomeHeroIconColMobile: {
    marginLeft: 0,
    width: HOME_STORE_ICON_COL_WIDTH,
    paddingTop: 0,
  },
  igHomeHeroContentColMobile: {
    marginLeft: HOME_STORE_BODY_LEADING,
  },
  igHomeHeroAnalyticsLinkActive: {
    backgroundColor: '#f2f2f7',
  },
  igHomeHeroInset: {
    alignSelf: 'stretch',
    gap: 12,
    paddingHorizontal: 0,
    paddingTop: 0,
    paddingBottom: 4,
    backgroundColor: 'transparent',
  },
  igHomeHeroAmountRow: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'baseline',
    flexWrap: 'nowrap',
    gap: 10,
    rowGap: 4,
    overflow: 'visible',
  },
  igHomeHeroAmountSlot: {
    position: 'relative',
    alignSelf: 'flex-start',
    flexShrink: 0,
    overflow: 'visible',
    minWidth: 160,
  },
  igHomeHeroAmountSlotTight: {
    minWidth: 0,
    alignSelf: 'center',
  },
  igHomeHeroSpotFigure: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
  },
  igHomeHeroCurrencyCode: {
    fontFamily,
    fontSize: 12,
    fontWeight: '500',
    color: '#8e8e93',
    letterSpacing: 0.3,
  },
  igHomeHeroAmountSizer: {
    opacity: 0,
  },
  igHomeHeroAmountLive: {
    position: 'absolute',
    left: 0,
    top: 0,
    maxWidth: undefined,
  },
  homeReelRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    flexShrink: 0,
  },
  homeReelWindow: {
    overflow: 'hidden',
    flexShrink: 0,
  },
  homeReelStrip: {
    flexDirection: 'column',
    alignItems: 'center',
  },
  homeReelGlyph: {
    fontFamily,
    fontVariant: ['tabular-nums'],
    textAlign: 'center',
    padding: 0,
    margin: 0,
    ...Platform.select({
      android: { includeFontPadding: false },
      default: {},
    }),
  },
  igHomeHeroAmount: {
    flexShrink: 0,
    fontFamily,
    fontSize: 22,
    lineHeight: 26,
    fontWeight: '400',
    color: '#1d1d1f',
    letterSpacing: -0.4,
    fontVariant: ['tabular-nums'],
  },
  igHomeHeroStats: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    alignSelf: 'stretch',
    gap: 20,
    backgroundColor: 'transparent',
  },
  igHomeHeroStatsSide: {
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
  igHomeHeroStatsSideDesktop: {
    minWidth: 156,
    maxWidth: 220,
    paddingTop: 0,
    paddingLeft: 10,
  },
  igHomeHeroSpotSide: {
    minWidth: 148,
    maxWidth: 196,
  },
  igHomeHeroStatsBare: {
    flexDirection: 'row',
    flex: 1,
    gap: 20,
    paddingTop: 4,
    borderLeftWidth: 0,
    paddingLeft: 0,
    maxWidth: '100%',
  },
  igHomeHeroStat: {
    flex: 1,
    minWidth: 0,
    gap: 3,
    paddingVertical: 0,
    paddingHorizontal: 0,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  igHomeHeroStatSelected: {},
  igHomeHeroStatPressed: {
    opacity: 0.72,
  },
  igHomeHeroStatValue: {
    fontFamily,
    fontSize: 13,
    fontWeight: '500',
    color: '#aeaeb2',
    letterSpacing: -0.2,
    fontVariant: ['tabular-nums'],
  },
  igHomeHeroStatValueSelected: {
    color: '#1d1d1f',
    fontWeight: '600',
  },
  igHomeHeroStatLabel: {
    fontFamily,
    fontSize: 10,
    fontWeight: '500',
    color: '#aeaeb2',
    letterSpacing: 0.02,
  },
  igHomeHeroStatLabelSelected: {
    color: '#1d1d1f',
    fontWeight: '600',
  },
  igHomeHeroStatCompact: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 8,
    paddingVertical: 1,
    paddingHorizontal: 0,
    borderRadius: 6,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  igHomeHeroStatCompactSelected: {},
  igHomeHeroStatLabelCompact: {
    flex: 1,
    minWidth: 0,
    fontFamily,
    fontSize: 10,
    fontWeight: '500',
    color: '#aeaeb2',
    letterSpacing: 0.02,
  },
  igHomeHeroStatLabelCompactSelected: {
    color: '#1d1d1f',
    fontWeight: '600',
  },
  igHomeHeroStatValueCompact: {
    fontFamily,
    fontSize: 12,
    fontWeight: '500',
    color: '#aeaeb2',
    letterSpacing: -0.2,
    fontVariant: ['tabular-nums'],
    textAlign: 'right',
    flexShrink: 0,
  },
  igHomeHeroStatValueCompactSelected: {
    color: '#1d1d1f',
    fontWeight: '600',
  },
  igHomeSection: {
    marginTop: 16,
    paddingHorizontal: 0,
    alignSelf: 'stretch',
    width: '100%',
    maxWidth: '100%',
    backgroundColor: 'transparent',
    paddingBottom: 0,
    borderTopWidth: 0,
  },
  igHomeTableSection: {
    paddingHorizontal: 0,
    marginTop: 8,
  },
  homeFocusStage: {
    position: 'relative',
    width: '100%',
  },
  homeFocusLoading: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  igHomeSectionMobile: {
    marginTop: 0,
  },
  igHomeTableSectionMobile: {
    marginTop: 0,
    paddingTop: 0,
  },
  igStoreList: {
    backgroundColor: '#fff',
    borderRadius: 0,
    overflow: 'hidden',
    width: '100%',
    alignSelf: 'stretch',
  },
  igHomeStoreCard: {
    alignItems: 'center',
    gap: HOME_STORE_BODY_LEADING,
    minHeight: 72,
    paddingLeft: MOBILE_FILTER_INSET,
    paddingTop: 12,
    paddingBottom: 12,
  },
  igHomeStoreCardRule: {
    position: 'absolute',
    bottom: 0,
    left: MOBILE_FILTER_INSET + 56 + HOME_STORE_BODY_LEADING,
    right: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: TAB_BORDER,
  },
  igHomeStoreBody: {
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 12,
    paddingVertical: 0,
    paddingRight: MOBILE_FILTER_INSET,
  },
  igHomeStoreMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minWidth: 0,
    width: '100%',
  },
  igHomeStoreCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  igHomeStoreName: {
    fontFamily,
    fontSize: 16,
    fontWeight: '600',
    color: MOBILE.label,
    letterSpacing: -0.2,
  },
  igHomeStoreMeta: {
    fontFamily,
    fontSize: 13,
    color: MOBILE.secondary,
    letterSpacing: 0,
  },
  igHomeStoreTrailing: {
    width: 108,
    maxWidth: '46%',
    flexShrink: 0,
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 4,
  },
  igHomeStoreClosed: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: MOBILE.secondary,
    letterSpacing: -0.1,
  },
  igHomeStoreChevron: {
    width: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  igHomeStoreMetrics: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    width: 216,
    gap: 0,
    paddingVertical: 3,
    paddingHorizontal: 2,
    borderRadius: SIDEBAR_TAB_ACTIVE_RADIUS,
    borderWidth: 1,
    borderColor: TAB_BORDER,
    backgroundColor: 'transparent',
    overflow: 'hidden',
  },
  igHomeStoreMetricsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    alignSelf: 'stretch',
    width: '100%',
    gap: 10,
  },
  igHomeStoreMetric: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-start',
    minWidth: 0,
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  igHomeStoreMetricRule: {
    width: StyleSheet.hairlineWidth,
    height: 12,
    backgroundColor: MOBILE.separator,
  },
  igHomeStoreMetricText: {
    width: undefined,
    flexShrink: 1,
    minWidth: 0,
  },
  igStoreCard: {
    position: 'relative',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 68,
    paddingLeft: 16,
    backgroundColor: '#fff',
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
    gap: 12,
    paddingVertical: 14,
    paddingRight: 16,
    alignSelf: 'stretch',
  },
  igStoreBodyStack: {
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 6,
  },
  igStoreBodyMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minWidth: 0,
    width: '100%',
  },
  igStoreBodyDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: TAB_BORDER,
  },
  igStoreCardSelected: {
    backgroundColor: '#f5f5f5',
  },
  igStoreCardPressed: {
    backgroundColor: '#f5f5f5',
  },
  igStoreIconWrap: {
    width: 56,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  igStoreIcon: {
    width: 46,
    height: 46,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  igStoreCopy: {
    flex: 1,
    minWidth: 0,
    gap: 3,
    ...Platform.select({
      web: { width: '100%' },
      default: {},
    }),
  },
  igStoreMetrics: {
    flexDirection: 'row',
    alignItems: 'center',
    width: 216,
    gap: 8,
    flexShrink: 0,
  },
  igStoreMetric: {
    flexDirection: 'row',
    alignItems: 'center',
    width: 66,
    gap: 5,
    flexShrink: 0,
  },
  igStoreMetricText: {
    fontFamily,
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: -0.08,
    fontVariant: ['tabular-nums'],
    width: 40,
    flexShrink: 0,
    textAlign: 'left',
  },
  igStoreTrailing: {
    width: 148,
    alignItems: 'flex-end',
    justifyContent: 'center',
    flexShrink: 0,
    gap: 2,
    overflow: 'visible',
  },
  igStorePeopleSlot: {
    height: 32,
  },
  igStoreSlotHidden: {
    opacity: 0,
  },
  igStoreChevron: {
    flexShrink: 0,
    marginLeft: -2,
  },
  igStoreName: {
    fontFamily: titleFontFamily,
    fontSize: 15,
    fontWeight: '400',
    color: '#1a1a1a',
    letterSpacing: -0.2,
  },
  igStoreMeta: {
    fontFamily,
    fontSize: 13,
    color: '#8e8e93',
    letterSpacing: 0,
    flexShrink: 1,
    minWidth: 0,
  },
  igStoreClosedLabel: {
    fontFamily,
    fontSize: 15,
    fontWeight: '500',
    color: '#8e8e93',
    letterSpacing: -0.2,
    flexShrink: 0,
  },
  igStoreAmount: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: '#1a1a1a',
    letterSpacing: 0,
    fontVariant: ['tabular-nums'],
  },
  igToolPad: {
    paddingHorizontal: 16,
  },
});
