import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import TriageAccuracyPanel from './TriageAccuracyPanel';
import TriagePoCapture from './TriagePoCapture';
import TriageDailyReceiptsDrawer from './TriageDailyReceiptsDrawer';
import TriageDashboardPanel, { ERROR_LIST_SORTS } from './TriageDashboardPanel';
import TriageDeletedPanel from './TriageDeletedPanel';
import TriageInsightsPanel from './TriageInsightsPanel';
import { canViewTriageInsights } from '../lib/permissions';
import { BarButton, FONT, SearchField, SegmentedSlider, T, TriageErrorBoundary } from './TriageKit';
import {
  MobileFeedAddButton,
  MobileFeedOutlineButton,
  MobileFeedTopBarActions,
} from './MobileChrome';
import { ensureLinkedPosSessions } from '../lib/auth';
import { fetchTransferStores } from '../lib/locations';
import { expandMobileTabBar } from '../lib/mobileTabBar';
import {
  CANVAS,
  DESKTOP_TOP_BAR_HEIGHT,
  MOBILE,
  MOBILE_FEED_TOP_BAR_HEIGHT,
  NAV_ICON_ACTIVE,
  NAV_ICON_INACTIVE,
  NAV_TAB_ACTIVE_BG,
  NAV_TAB_ACTIVE_RADIUS,
  useIsMobile,
} from '../lib/mobileUi';
import {
  buildDailyReceiptGrid,
  dailyReceiptStatus,
  summarizeDailyReceipts,
  useDailyReceipts,
} from '../lib/triageDailyReceipts';
import { syncTransferWorkflowRemote, useTransferWorkflow } from '../lib/transferWorkflow';
import { backfillTriageErrorBuyers } from '../lib/triageStoreErrors';

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
    '.cgold-triage-table-row:hover,.cgold-triage-table-row:has(:hover),.cgold-triage-table-row.is-hover{background-color:#f5f5f5!important;}',
    '.cgold-triage-table-row:hover > *,.cgold-triage-table-row:has(:hover) > *,.cgold-triage-table-row.is-hover > *{background-color:transparent!important;}',
    '.cgold-triage-row-selected,.cgold-triage-row-selected:hover{background-color:#f5f5f5!important;}',
    '.cgold-accuracy-row:hover{background-color:#f5f5f5!important;}',
    '.cgold-chrome-stats-btn{cursor:pointer;transition:background-color .12s ease;}',
    '.cgold-chrome-stats-btn:hover{background-color:#f5f5f5;}',
    '.cgold-chrome-stats-btn-attention:hover{background-color:#f0f0f0;}',
  ].join('');
}

/** Drop cached transaction rows so nothing outlives the session that loaded them. */
export function clearTriageCache() {}

const DASH_PAGE_LABELS = {
  errors: 'Errors',
  analytics: 'Analytics',
  stores: 'Stores',
  shipments: 'Transfers',
  lots: 'Lots',
  return: 'Expected Return',
};

const TRIAGE_RAIL = [
  { key: 'overview', label: 'Overview', icon: 'storefront-outline' },
  { key: 'lots', label: 'Lots', icon: 'layers-outline' },
  { key: 'errors', label: 'Errors', icon: 'alert-circle-outline' },
  { key: 'analytics', label: 'Analytics', icon: 'analytics-outline' },
];
const RAIL_WIDTH = 176;
const TAB_ICON_SIZE = 17;

function filledIonicon(name) {
  return typeof name === 'string' && name.endsWith('-outline') ? name.slice(0, -8) : name;
}

function TriageRailTab({ tab, selected, onPress }) {
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={({ hovered: pressHovered, pressed }) => [
        styles.railTab,
        (hovered || pressHovered || pressed) && !selected && styles.railTabHover,
        selected && styles.railTabActive,
      ]}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={tab.label}
    >
      <View style={styles.railTabGlyph}>
        <Ionicons
          name={selected ? filledIonicon(tab.icon) : tab.icon}
          size={TAB_ICON_SIZE}
          color={selected ? NAV_ICON_ACTIVE : NAV_ICON_INACTIVE}
        />
      </View>
      <Text
        style={[
          styles.railTabLabel,
          hovered && !selected && styles.railTabLabelHover,
          selected && styles.railTabLabelActive,
        ]}
        numberOfLines={1}
      >
        {tab.label}
      </Text>
    </Pressable>
  );
}

function triagePageTitle({ dashPage, activeTab, resultsLotId, storesView }) {
  if (dashPage === 'errors') return 'Errors';
  if (dashPage === 'analytics') return 'Analytics';
  if (dashPage === 'stores') return storesView?.selectedStore || 'Stores';
  if (dashPage === 'shipments') return 'Transfers';
  if (dashPage === 'lots') return 'Lots';
  if (dashPage === 'return') return 'Expected Return';
  if (activeTab === 'accuracy') return resultsLotId || 'Results';
  if (activeTab === 'deleted') return 'Deleted';
  return storesView?.selectedRegionLabel || 'Triage';
}

function ErrorFilterButton({ value, onChange, compact = false }) {
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const buttonRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState(null);
  const current = ERROR_LIST_SORTS.find((option) => option.key === value) || ERROR_LIST_SORTS[0];

  const openMenu = () => {
    const node = buttonRef.current;
    if (typeof node?.measureInWindow === 'function') {
      node.measureInWindow((x, y, width, height) => {
        setAnchor({ x, y, width, height });
        setOpen(true);
      });
      return;
    }
    setAnchor(null);
    setOpen(true);
  };

  const menuWidth = 232;
  const menuLeft = anchor
    ? Math.min(Math.max(12, anchor.x + anchor.width - menuWidth), Math.max(12, windowWidth - menuWidth - 12))
    : Math.max(12, windowWidth - menuWidth - 16);
  const menuTop = anchor ? Math.min(anchor.y + anchor.height + 6, Math.max(12, windowHeight - 240)) : 64;

  return (
    <>
      <View ref={buttonRef} collapsable={false}>
        {compact ? (
          <MobileFeedOutlineButton
            label="Filter"
            leadingIcon={current.key === 'recent' ? 'funnel-outline' : 'funnel'}
            active={open || current.key !== 'recent'}
            onPress={() => (open ? setOpen(false) : openMenu())}
            accessibilityLabel={current.key === 'recent' ? 'Filter errors' : `Filter errors, ${current.label}`}
          />
        ) : (
          <BarButton
            icon={current.key === 'recent' ? 'funnel-outline' : 'funnel'}
            label="Filter"
            onPress={() => (open ? setOpen(false) : openMenu())}
            accessibilityLabel={current.key === 'recent' ? 'Filter errors' : `Filter errors, ${current.label}`}
          />
        )}
      </View>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={styles.filterModal} pointerEvents="box-none">
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setOpen(false)} accessibilityLabel="Close filter" />
          <View style={[styles.filterMenu, { top: menuTop, left: menuLeft, width: menuWidth }]}>
            {ERROR_LIST_SORTS.map((option) => {
              const on = option.key === current.key;
              return (
                <Pressable
                  key={option.key}
                  onPress={() => {
                    onChange(option.key);
                    setOpen(false);
                  }}
                  style={({ hovered, pressed }) => [
                    styles.filterOption,
                    on && styles.filterOptionOn,
                    (hovered || pressed) && styles.filterOptionHover,
                  ]}
                  accessibilityRole="menuitem"
                  accessibilityState={{ selected: on }}
                  {...(Platform.OS === 'web' ? { className: 'cgold-triage-btn' } : null)}
                >
                  <Text style={[styles.filterOptionText, on && styles.filterOptionTextOn]} numberOfLines={1}>
                    {option.label}
                  </Text>
                  {on ? <Ionicons name="checkmark" size={16} color={T.text} /> : <View style={styles.filterCheckSpacer} />}
                </Pressable>
              );
            })}
          </View>
        </View>
      </Modal>
    </>
  );
}

function ChromeStats({ items, onPress, accessibilityLabel, wide = false, actionLabel, attention = false }) {
  if (!items?.length) return null;
  const body = (
    <View style={[styles.chromeStats, wide && styles.chromeStatsWide]}>
      {items.map((item) => (
        <View key={item.label} style={styles.chromeStat}>
          <Text style={styles.chromeStatLabel}>{item.label}</Text>
          <Text
            style={[
              styles.chromeStatValue,
              item.tone === 'green' && styles.chromeStatGreen,
              item.tone === 'red' && styles.chromeStatRed,
              item.tone === 'orange' && styles.chromeStatOrange,
            ]}
            numberOfLines={1}
          >
            {item.value}
          </Text>
        </View>
      ))}
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable
      style={({ pressed }) => [
        styles.chromeStatsHit,
        wide && styles.chromeStatsHitWide,
        attention && styles.chromeStatsHitAttention,
        pressed && (attention ? styles.chromeStatsHitAttentionPressed : styles.chromeStatsHitPressed),
      ]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || 'Open details'}
      accessibilityHint={actionLabel ? `Opens ${actionLabel.toLowerCase()}` : undefined}
      {...(Platform.OS === 'web'
        ? { className: attention ? 'cgold-chrome-stats-btn cgold-chrome-stats-btn-attention' : 'cgold-chrome-stats-btn' }
        : null)}
    >
      {body}
      <View style={styles.chromeStatsCta}>
        {actionLabel ? <Text style={styles.chromeStatsAction}>{actionLabel}</Text> : null}
        <Ionicons name="chevron-forward" size={15} color={T.secondary} />
      </View>
    </Pressable>
  );
}

export default function TriageScreen({
  session,
  onRequireLogin,
  storeFilter,
  embedded = false,
  onStoreBackChange,
  onNavTabs,
  onMobileHeader,
  onMobileOverlayChange,
  onCrumbsChange,
}) {
  const isMobile = useIsMobile();
  const { triage } = useTransferWorkflow();
  const showStoreInsights = Boolean(embedded && storeFilter && canViewTriageInsights(session?.profile));
  const [activeTab, setActiveTab] = useState('transfers');
  const [dashPage, setDashPage] = useState('');
  const [storesView, setStoresView] = useState({ selectedStore: '' });
  const storesNavRef = useRef({ closeStore() {} });
  const [accuracyTab, setAccuracyTab] = useState('all');
  const [accuracyStats, setAccuracyStats] = useState({ correct: 0, incorrect: 0, total: 0, lots: 0, ratio: '0/0', percent: 0 });
  const [accuracyBreakdownOpen, setAccuracyBreakdownOpen] = useState(false);
  const [resultsLotId, setResultsLotId] = useState('');
  const [storeTab, setStoreTab] = useState('melt');
  const [listQuery, setListQuery] = useState('');
  const [errorSort, setErrorSort] = useState('recent');
  const [canLeaveStore, setCanLeaveStore] = useState(false);
  const [batchContext, setBatchContext] = useState(null);
  const [dailyOpen, setDailyOpen] = useState(false);
  const [captureFlowOpen, setCaptureFlowOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const mobileChromeHidden = captureFlowOpen || (isMobile && reviewOpen);
  const leaveStoreRef = useRef(null);
  const screenRootRef = useRef(null);
  const openScanRef = useRef(() => {});
  const onStoreBackChangeRef = useRef(onStoreBackChange);
  onStoreBackChangeRef.current = onStoreBackChange;

  useLayoutEffect(() => {
    if (!showStoreInsights) return undefined;
    onNavTabs?.(null);
    onMobileHeader?.(null);
    onStoreBackChangeRef.current?.(null, null);
    return undefined;
  }, [onMobileHeader, onNavTabs, showStoreInsights]);

  useEffect(() => {
    if (!session?.supabaseUserId && !session?.token) return undefined;
    syncTransferWorkflowRemote().catch(() => {});
    if (session?.token) {
      ensureLinkedPosSessions(session).catch(() => {});
      fetchTransferStores(session).catch(() => {});
    }
    return undefined;
  }, [session?.supabaseUserId, session?.token]);

  useEffect(() => {
    if (!session?.token) return undefined;
    let cancelled = false;
    backfillTriageErrorBuyers(session, triage).catch(() => {
      if (cancelled) return;
    });
    return () => {
      cancelled = true;
    };
  }, [session, triage]);

  const accuracyTabOptions = useMemo(
    () => [
      { key: 'all', label: 'All', ...(accuracyStats.total ? { count: accuracyStats.total } : {}) },
      { key: 'correct', label: 'Correct', ...(accuracyStats.correct ? { count: accuracyStats.correct } : {}) },
      { key: 'incorrect', label: 'Incorrect', ...(accuracyStats.incorrect ? { count: accuracyStats.incorrect } : {}) },
    ],
    [accuracyStats],
  );

  const changeAccuracyTab = useCallback((key) => {
    setAccuracyTab(key);
    setListQuery('');
  }, []);

  const changeStoreTab = useCallback((key) => {
    setStoreTab(key);
  }, []);

  const handleBackChange = useCallback((fn, context) => {
    leaveStoreRef.current = fn;
    setCanLeaveStore(Boolean(fn));
    setBatchContext(context || null);
  }, []);

  const inBatch = activeTab === 'transfers' && canLeaveStore && Boolean(batchContext?.batch);
  const dailyBatch = inBatch ? batchContext?.batch || null : null;
  const daily = useDailyReceipts(dailyBatch?.id, Boolean(session?.token && dailyBatch));
  const dailyGrid = useMemo(() => buildDailyReceiptGrid(dailyBatch), [dailyBatch]);
  const dailySummary = useMemo(() => summarizeDailyReceipts(dailyGrid, daily.receipts), [daily.receipts, dailyGrid]);
  const dailyStatus = useMemo(() => dailyReceiptStatus(dailySummary), [dailySummary]);

  useEffect(() => {
    if (!dailyBatch) setDailyOpen(false);
  }, [dailyBatch]);

  const scanButton = (size) => (
    <BarButton
      tone="green"
      size={size}
      icon="add"
      label="Add"
      onPress={() => openScanRef.current()}
      accessibilityLabel="Add a PO"
    />
  );

  const searchField = session?.token ? (
    <SearchField
      value={listQuery}
      onChangeText={setListQuery}
      placeholder={
        activeTab === 'accuracy'
          ? resultsLotId
            ? 'PO / person / store'
            : 'Lot / store'
          : dashPage === 'errors'
            ? 'PO / person / store'
            : dashPage === 'lots'
              ? 'Lot / store'
            : activeTab === 'deleted'
              ? 'PO / store'
              : !dashPage && !storesView.selectedStore
                ? 'Store'
                : 'PO / SO'
      }
      size={isMobile ? 'lg' : undefined}
      style={[styles.tabSearch, isMobile && styles.tabSearchMobile]}
    />
  ) : null;

  const storeTabOptions = useMemo(() => {
    const melt = batchContext?.stats?.expected || 0;
    return [
      { key: 'melt', label: 'Melt', ...(melt ? { count: melt } : {}) },
      { key: 'bullion', label: 'Bullion' },
    ];
  }, [batchContext]);

  const trailing =
    session?.token && activeTab === 'transfers' && !inBatch && (isMobile || embedded) && !dashPage ? (
      <>
        {searchField}
        {scanButton()}
      </>
    ) : session?.token && inBatch ? (
      <>
        <ChromeStats
          wide
          items={[
            { label: 'Expected', value: String(batchContext.stats?.expected || 0) },
            { label: 'Bullion only', value: String(batchContext.stats?.bullionOnly || 0) },
            {
              label: 'Progress',
              value: batchContext.stats?.expected
                ? `${batchContext.stats.received}/${batchContext.stats.expected}`
                : '0',
              tone: batchContext.stats?.complete ? 'green' : undefined,
            },
            { label: dailyStatus.label, value: dailyStatus.value, tone: dailyStatus.tone },
          ]}
          onPress={() => setDailyOpen(true)}
          actionLabel={dailySummary.allChecked ? 'Open' : 'Check'}
          attention={!dailySummary.allChecked && dailySummary.cells > 0}
          accessibilityLabel="Open the daily receipt check"
        />
        {storeTab === 'melt' ? (
          <>
            <BarButton
              icon="phone-portrait-outline"
              label="Feed"
              onPress={() => batchContext.onOpenFeed?.()}
              accessibilityLabel="Open feed view"
            />
            {scanButton()}
          </>
        ) : null}
      </>
    ) : session?.token && activeTab === 'accuracy' ? (
      <View style={styles.deskChromeActions}>
        {resultsLotId ? (
          <SegmentedSlider
            options={accuracyTabOptions}
            value={accuracyTab}
            onChange={changeAccuracyTab}
            compact
            style={styles.lotFilterSlider}
          />
        ) : null}
        {searchField}
        <BarButton label="Details" onPress={() => setAccuracyBreakdownOpen(true)} accessibilityLabel="Open lot details" />
      </View>
    ) : session?.token && activeTab === 'deleted' ? (
      searchField
    ) : null;

  const canAdd =
    Boolean(session?.token) &&
    ((activeTab === 'transfers' && !dashPage) ||
      (inBatch && storeTab === 'melt') ||
      dashPage === 'lots' ||
      (activeTab === 'accuracy' && !resultsLotId));
  const canGoBack =
    canLeaveStore ||
    activeTab !== 'transfers' ||
    Boolean(dashPage) ||
    Boolean(storesView.selectedStore || storesView.selectedRegion);
  const pageTitle = triagePageTitle({ dashPage, activeTab, resultsLotId, storesView });

  const goBack = useCallback(() => {
    if (activeTab === 'accuracy' || resultsLotId) {
      setResultsLotId('');
      setListQuery('');
      setAccuracyTab('all');
      setAccuracyBreakdownOpen(false);
      setActiveTab('transfers');
      setDashPage('lots');
      return;
    }
    if (activeTab === 'deleted') {
      setActiveTab('transfers');
      setDashPage('');
      setListQuery('');
      return;
    }
    if (leaveStoreRef.current) {
      leaveStoreRef.current();
      return;
    }
    if (dashPage) {
      setDashPage('');
      return;
    }
    storesNavRef.current?.closeRegion?.();
  }, [activeTab, dashPage, resultsLotId]);

  const goDashboard = useCallback(() => {
    storesNavRef.current?.closeRegion?.();
    leaveStoreRef.current?.();
    setActiveTab('transfers');
    setDashPage('');
    setResultsLotId('');
    setListQuery('');
    setAccuracyBreakdownOpen(false);
    setDailyOpen(false);
  }, []);

  const storeOpen = Boolean(storesView.selectedStore);
  const showDesktopRail =
    Boolean(session?.token) && !isMobile && !embedded && !inBatch && storeOpen && activeTab === 'transfers';
  const railKey =
    activeTab === 'accuracy' || resultsLotId
      ? 'lots'
      : dashPage === 'errors' || dashPage === 'analytics' || dashPage === 'lots'
        ? dashPage
        : 'overview';

  const selectRail = useCallback((key) => {
    setAccuracyBreakdownOpen(false);
    setDailyOpen(false);
    setListQuery('');
    setResultsLotId('');
    setAccuracyTab('all');
    setActiveTab('transfers');
    setDashPage(key === 'overview' ? '' : key);
  }, []);

  const contentInsetTop = embedded
    ? 0
    : isMobile
      ? MOBILE_FEED_TOP_BAR_HEIGHT
      : DESKTOP_TOP_BAR_HEIGHT + 12;

  const desktopToolbar =
    session?.token && !isMobile && !embedded && activeTab === 'transfers' && !inBatch && dashPage ? (
      <View style={[styles.tableToolbar, storeOpen && styles.overviewToolbar]}>
        <SearchField
          value={listQuery}
          onChangeText={setListQuery}
          placeholder={
            dashPage === 'errors'
              ? 'PO / person'
              : dashPage === 'lots'
                ? storesView.selectedLot
                  ? 'PO / person'
                  : 'Lot'
                : dashPage === 'analytics'
                  ? 'Search'
                  : 'Store'
          }
          style={styles.tableSearch}
        />
        {dashPage === 'errors' ? (
          <ErrorFilterButton value={errorSort} onChange={setErrorSort} />
        ) : null}
        <View style={styles.tableToolbarGrow} />
      </View>
    ) : null;

  useEffect(() => {
    if (!onCrumbsChange) return undefined;
    const pageLabel = DASH_PAGE_LABELS[dashPage];
    const crumbs = [];
    const regionLabel = storesView.selectedRegionLabel;
    const onTriage =
      !inBatch &&
      activeTab === 'transfers' &&
      !dashPage &&
      !resultsLotId &&
      !regionLabel
        ? undefined
        : goDashboard;
    crumbs.push({ label: 'Triage', onPress: onTriage });

    if (inBatch) {
      crumbs.push({ label: batchContext?.dateLabel || pageTitle });
      onCrumbsChange(crumbs);
      return undefined;
    }

    if (regionLabel) {
      crumbs.push({
        label: regionLabel,
        onPress:
          dashPage || activeTab !== 'transfers' || resultsLotId
            ? () => {
                setActiveTab('transfers');
                setDashPage('');
                setResultsLotId('');
                setListQuery('');
              }
            : undefined,
      });
    }

    if (activeTab === 'deleted') {
      crumbs.push({ label: 'Deleted' });
      onCrumbsChange(crumbs);
      return undefined;
    }

    if (activeTab === 'accuracy') {
      crumbs.push({
        label: 'Lots',
        onPress: resultsLotId
          ? () => {
              setResultsLotId('');
              setListQuery('');
              setAccuracyTab('all');
              setActiveTab('transfers');
              setDashPage('lots');
            }
          : undefined,
      });
      if (resultsLotId) crumbs.push({ label: resultsLotId });
      onCrumbsChange(crumbs);
      return undefined;
    }

    if (pageLabel && dashPage !== 'stores') {
      crumbs.push({
        label: pageLabel,
        onPress: storesView.selectedLot
          ? () => {
              storesNavRef.current?.closeLot?.();
              setListQuery('');
            }
          : undefined,
      });
    }
    if (storesView.selectedLotLabel) {
      crumbs.push({ label: storesView.selectedLotLabel });
    }

    onCrumbsChange(crumbs);
    return undefined;
  }, [
    activeTab,
    batchContext?.dateLabel,
    dashPage,
    goDashboard,
    inBatch,
    onCrumbsChange,
    pageTitle,
    resultsLotId,
    storesView.selectedRegion,
    storesView.selectedRegionLabel,
    storesView.selectedStore,
    storesView.selectedLot,
    storesView.selectedLotLabel,
  ]);

  useEffect(() => () => onCrumbsChange?.([]), [onCrumbsChange]);

  useEffect(() => {
    if (storesView.selectedStore) setListQuery('');
  }, [storesView.selectedStore]);

  useEffect(() => {
    if (storesView.selectedLot) setListQuery('');
  }, [storesView.selectedLot]);

  useEffect(() => {
    if (dashPage && dashPage !== 'lots' && dashPage !== 'errors' && dashPage !== 'analytics') {
      setDashPage('');
    }
    if (activeTab === 'deleted') {
      setActiveTab('transfers');
      setDashPage('');
    }
  }, [activeTab, dashPage]);

  useEffect(() => {
    if (!canGoBack) {
      onStoreBackChangeRef.current?.(null, null);
      return undefined;
    }
    onStoreBackChangeRef.current?.(goBack, batchContext || { dateLabel: pageTitle });
    return () => onStoreBackChangeRef.current?.(null, null);
  }, [batchContext, canGoBack, goBack, pageTitle]);

  const leadTools =
    session?.token && inBatch ? (
      <SegmentedSlider
        options={storeTabOptions}
        value={storeTab}
        onChange={changeStoreTab}
        style={styles.tabSlider}
      />
    ) : session?.token && activeTab === 'accuracy' ? (
      <View style={styles.accuracyLead}>{searchField}</View>
    ) : null;

  useLayoutEffect(() => {
    onNavTabs?.(null);
    return () => onNavTabs?.(null);
  }, [onNavTabs]);

  useEffect(() => {
    expandMobileTabBar();
  }, []);

  const onErrorsPage = activeTab === 'transfers' && !inBatch && dashPage === 'errors';
  const mobileTopBarTrailing = useMemo(
    () =>
      canAdd || onErrorsPage ? (
        <MobileFeedTopBarActions>
          {onErrorsPage ? (
            <ErrorFilterButton value={errorSort} onChange={setErrorSort} compact />
          ) : null}
          {canAdd ? (
            <MobileFeedAddButton
              onPress={() => openScanRef.current()}
              accessibilityLabel="Add a PO"
            />
          ) : null}
        </MobileFeedTopBarActions>
      ) : null,
    [canAdd, errorSort, onErrorsPage],
  );

  useEffect(() => {
    onMobileOverlayChange?.(mobileChromeHidden);
    return () => onMobileOverlayChange?.(false);
  }, [mobileChromeHidden, onMobileOverlayChange]);

  useLayoutEffect(() => {
    if (!onMobileHeader) return undefined;
    if (!isMobile || showStoreInsights || mobileChromeHidden) {
      onMobileHeader(null);
      return () => onMobileHeader(null);
    }
    onMobileHeader({ trailing: mobileTopBarTrailing });
    return () => onMobileHeader(null);
  }, [isMobile, mobileChromeHidden, mobileTopBarTrailing, onMobileHeader, showStoreInsights]);

  if (showStoreInsights) {
    return (
      <TriageErrorBoundary>
        <View style={[styles.body, styles.bodyEmbedded, isMobile && styles.bodyMobile]}>
          <TriageInsightsPanel session={session} storeFilter={storeFilter} onRequireLogin={onRequireLogin} />
        </View>
      </TriageErrorBoundary>
    );
  }

  return (
    <TriageErrorBoundary>
    <View
      ref={screenRootRef}
      style={[
        styles.body,
        embedded && styles.bodyEmbedded,
        isMobile && styles.bodyMobile,
        showDesktopRail && styles.bodyDesktopRail,
      ]}
    >
      {showDesktopRail ? (
        <View style={[styles.rail, { paddingTop: DESKTOP_TOP_BAR_HEIGHT + 12 }]}>
          {TRIAGE_RAIL.map((tab) => (
            <TriageRailTab
              key={tab.key}
              tab={tab}
              selected={railKey === tab.key}
              onPress={() => selectRail(tab.key)}
            />
          ))}
          <View style={styles.railGrow} />
          {canAdd ? (
            <View style={styles.railFooter}>
              <Pressable
                onPress={() => openScanRef.current()}
                style={({ hovered, pressed }) => [
                  styles.railAdd,
                  (hovered || pressed) && styles.railAddHover,
                ]}
                accessibilityRole="button"
                accessibilityLabel="Add a PO"
              >
                <Ionicons name="add-circle-outline" size={TAB_ICON_SIZE} color="#1F8A4E" />
                <Text style={styles.railAddLabel}>Add</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      ) : null}

      <View style={styles.feed}>
      <View style={styles.pageVisible}>
      {isMobile ? null : leadTools || trailing ? (
        <View style={[styles.deskChrome, !embedded && styles.deskChromeOverlay]} pointerEvents="box-none">
          <View style={styles.deskChromeStart}>{leadTools}</View>
          {trailing ? <View style={styles.deskChromeEnd}>{trailing}</View> : null}
        </View>
      ) : null}

      <View style={activeTab === 'transfers' ? styles.pageVisible : styles.pageHidden}>
        <TriageDashboardPanel
          session={session}
          onRequireLogin={onRequireLogin}
          active={activeTab === 'transfers'}
          listQuery={listQuery}
          onQueryChange={setListQuery}
          onAdd={canAdd ? () => openScanRef.current() : undefined}
          page={dashPage}
          onPageChange={setDashPage}
          onBackChange={handleBackChange}
          onStoresViewChange={setStoresView}
          storesNavRef={storesNavRef}
          onOpenLot={(lotId) => {
            setDashPage('lots');
            setActiveTab('accuracy');
            setResultsLotId(lotId || '');
            setListQuery('');
            setAccuracyTab('all');
          }}
          onReviewOpenChange={isMobile ? setReviewOpen : undefined}
          errorSort={errorSort}
          desktopRail={showDesktopRail}
          insetTop={contentInsetTop}
          toolbar={desktopToolbar}
        />
      </View>

      {activeTab === 'accuracy' ? (
        <TriageAccuracyPanel
          session={session}
          storeFilter={storeFilter}
          accuracyTab={accuracyTab}
          onAccuracyTabChange={setAccuracyTab}
          listQuery={listQuery}
          onStatsChange={setAccuracyStats}
          breakdownOpen={accuracyBreakdownOpen}
          onBreakdownOpenChange={setAccuracyBreakdownOpen}
          openLotId={resultsLotId}
          onOpenLotChange={(id) => {
            setResultsLotId(id || '');
            setListQuery('');
            setAccuracyTab('all');
          }}
          onBackChange={handleBackChange}
          insetTop={contentInsetTop}
        />
      ) : activeTab === 'deleted' ? (
        <TriageDeletedPanel
          session={session}
          query={listQuery}
          regionKey={storesView.selectedRegion}
          storeName={storesView.selectedStore}
        />
      ) : null}
      </View>
      </View>

      {session?.token ? (
        <TriagePoCapture
          session={session}
          openerRef={openScanRef}
          onFlowOpenChange={setCaptureFlowOpen}
        />
      ) : null}

      <TriageDailyReceiptsDrawer
        visible={dailyOpen && Boolean(dailyBatch)}
        onClose={() => setDailyOpen(false)}
        batch={dailyBatch}
        session={session}
        receipts={daily.receipts}
        loading={daily.loading}
        loadError={daily.error}
        onSaved={daily.reload}
      />

    </View>
    </TriageErrorBoundary>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    minHeight: 0,
    position: 'relative',
    backgroundColor: CANVAS,
  },
  bodyMobile: {
    backgroundColor: CANVAS,
  },
  bodyEmbedded: {
    width: '100%',
    maxWidth: '100%',
  },
  bodyDesktopRail: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  rail: {
    width: RAIL_WIDTH,
    flexShrink: 0,
    justifyContent: 'flex-start',
    alignItems: 'stretch',
    paddingBottom: 12,
    gap: 2,
    backgroundColor: CANVAS,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: 'rgba(42,38,30,0.08)',
  },
  railGrow: {
    flex: 1,
    minHeight: 12,
  },
  railFooter: {
    paddingTop: 10,
    paddingBottom: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(42,38,30,0.08)',
  },
  railAdd: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 32,
    minHeight: 32,
    marginHorizontal: 8,
    paddingHorizontal: 12,
    borderRadius: NAV_TAB_ACTIVE_RADIUS,
    borderWidth: 1,
    borderColor: '#d0d0d0',
    backgroundColor: CANVAS,
    ...Platform.select({
      web: { cursor: 'pointer', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' },
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.06,
        shadowRadius: 2,
        elevation: 1,
      },
    }),
  },
  railAddHover: {
    backgroundColor: '#f5f5f5',
  },
  railAddLabel: {
    fontFamily: FONT,
    fontSize: 14,
    fontWeight: '400',
    color: '#1F8A4E',
    letterSpacing: -0.2,
  },
  tableToolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    width: '100%',
    maxWidth: 960,
    marginHorizontal: 16,
    gap: 12,
    paddingTop: 4,
    paddingBottom: 14,
  },
  overviewToolbar: {
    alignSelf: 'stretch',
    maxWidth: '100%',
    marginHorizontal: 0,
    paddingTop: 0,
    paddingBottom: 0,
  },
  tableToolbarGrow: {
    flex: 1,
    minWidth: 0,
  },
  tableSearch: {
    width: 320,
    maxWidth: 400,
    flexGrow: 0,
  },
  tableAdd: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 32,
    minHeight: 32,
    paddingHorizontal: 18,
    paddingVertical: 0,
    borderRadius: NAV_TAB_ACTIVE_RADIUS,
    borderWidth: 1,
    borderColor: '#d0d0d0',
    backgroundColor: CANVAS,
    ...Platform.select({
      web: { cursor: 'pointer', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' },
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.06,
        shadowRadius: 2,
        elevation: 1,
      },
    }),
  },
  tableAddHover: {
    backgroundColor: '#f5f5f5',
  },
  tableAddLabel: {
    fontFamily: FONT,
    fontSize: 14,
    fontWeight: '400',
    color: '#1F8A4E',
    letterSpacing: -0.2,
  },
  railTab: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
    minHeight: 36,
    marginHorizontal: 10,
    paddingVertical: 7,
    paddingHorizontal: 6,
    borderRadius: NAV_TAB_ACTIVE_RADIUS,
    overflow: 'visible',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  railTabHover: {
    backgroundColor: '#f5f5f5',
    borderRadius: NAV_TAB_ACTIVE_RADIUS,
  },
  railTabActive: {
    borderWidth: 1,
    borderColor: '#d0d0d0',
    backgroundColor: NAV_TAB_ACTIVE_BG,
    borderRadius: NAV_TAB_ACTIVE_RADIUS,
  },
  railTabGlyph: {
    width: 26,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
    flexShrink: 0,
  },
  railTabLabel: {
    fontFamily: FONT,
    fontSize: 14,
    fontWeight: '400',
    color: MOBILE.secondary,
    letterSpacing: -0.2,
    flexShrink: 1,
  },
  railTabLabelHover: {
    color: MOBILE.label,
  },
  railTabLabelActive: {
    color: '#3A3A3C',
  },
  feed: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    position: 'relative',
  },
  tabSearch: {
    width: 280,
    maxWidth: 320,
  },
  homeStoreSearch: {
    width: 148,
    maxWidth: 168,
    minWidth: 112,
    flexGrow: 1,
    flexShrink: 1,
  },
  tabSlider: {
    minWidth: 220,
    maxWidth: 320,
  },
  lotFilterSlider: {
    minWidth: 260,
    maxWidth: 360,
  },
  tabSearchMobile: {
    width: '100%',
    maxWidth: '100%',
    minWidth: 0,
  },
  deskChrome: {
    zIndex: 24,
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 32,
    paddingTop: 8,
    paddingBottom: 8,
    backgroundColor: 'transparent',
  },
  deskChromeOverlay: {
    position: 'absolute',
    top: DESKTOP_TOP_BAR_HEIGHT + 6,
    right: 16,
    left: 16,
    paddingHorizontal: 0,
    paddingTop: 0,
    paddingBottom: 0,
    zIndex: 30,
  },
  deskChromeStart: {
    flexShrink: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  deskChromeEnd: {
    marginLeft: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
  },
  deskChromeActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  filterModal: {
    flex: 1,
  },
  filterMenu: {
    position: 'absolute',
    backgroundColor: CANVAS,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#d0d0d0',
    paddingVertical: 4,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  filterOption: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  filterOptionOn: {
    backgroundColor: 'rgba(0,0,0,0.04)',
  },
  filterOptionHover: {
    backgroundColor: '#f5f5f5',
  },
  filterOptionText: {
    fontFamily: FONT,
    flex: 1,
    fontSize: 15,
    color: T.text,
  },
  filterOptionTextOn: {
    fontWeight: '600',
  },
  filterCheckSpacer: {
    width: 16,
    height: 16,
  },
  accuracyLead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flexShrink: 1,
    minWidth: 0,
  },
  chromeStats: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    gap: 10,
    maxWidth: 268,
    rowGap: 2,
    flexShrink: 1,
  },
  chromeStatsWide: {
    maxWidth: 520,
  },
  chromeStatsHit: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    maxWidth: 360,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: CANVAS,
    borderWidth: 1,
    borderColor: '#d0d0d0',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  chromeStatsHitWide: {
    maxWidth: 640,
  },
  chromeStatsHitPressed: {
    backgroundColor: '#f5f5f5',
  },
  chromeStatsHitAttention: {
    backgroundColor: '#fff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: T.text,
  },
  chromeStatsHitAttentionPressed: {
    backgroundColor: '#f5f5f5',
  },
  chromeStatsCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    flexShrink: 0,
    marginLeft: 2,
  },
  chromeStatsAction: {
    fontFamily: FONT,
    fontSize: 13,
    fontWeight: '600',
    color: T.text,
    letterSpacing: 0,
  },
  chromeStat: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
  },
  chromeStatLabel: {
    fontFamily: FONT,
    fontSize: 10,
    fontWeight: '600',
    color: T.secondary,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  chromeStatValue: {
    fontFamily: FONT,
    fontSize: 13,
    fontWeight: '600',
    color: T.text,
    fontVariant: ['tabular-nums'],
  },
  chromeStatGreen: {
    color: '#15803D',
  },
  chromeStatRed: {
    color: '#B91C1C',
  },
  chromeStatOrange: {
    color: '#C2410C',
  },
  pageVisible: {
    flex: 1,
    minHeight: 0,
  },
  pageHidden: {
    display: 'none',
  },
});
