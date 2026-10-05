import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import TriageAccuracyPanel from './TriageAccuracyPanel';
import TriagePoCapture from './TriagePoCapture';
import TriageDailyReceiptsDrawer from './TriageDailyReceiptsDrawer';
import TriageDashboardPanel from './TriageDashboardPanel';
import TriageDeletedPanel from './TriageDeletedPanel';
import TriageInsightsPanel from './TriageInsightsPanel';
import { canViewTriageInsights } from '../lib/permissions';
import HomeDatePicker from './HomeDatePicker';
import { BarButton, FONT, SearchField, SegmentedSlider, T } from './TriageKit';
import {
  MobileChromeCircle,
  MobileFilterDock,
  MobileFilterSheet,
  MobileFilterSheetAction,
  MobileFilterSheetDivider,
  MobileFilterSheetLabel,
  MobileNavHeader,
} from './MobileChrome';
import { ensureLinkedPosSessions } from '../lib/auth';
import { fetchTransferStores } from '../lib/locations';
import { expandMobileTabBar } from '../lib/mobileTabBar';
import { CANVAS, DESKTOP_TOP_BAR_HEIGHT, MOBILE_FILTER_INSET, MOBILE_TOP_FILTER_SIZE, useIsMobile } from '../lib/mobileUi';
import {
  buildDailyReceiptGrid,
  dailyReceiptStatus,
  summarizeDailyReceipts,
  useDailyReceipts,
} from '../lib/triageDailyReceipts';
import { syncTransferWorkflowRemote } from '../lib/transferWorkflow';
import { useAppDate } from '../lib/appDate';
import { currentErrorPeriod, errorPeriodFromDates } from '../lib/triageStoreErrors';

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
  stores: 'Stores',
  shipments: 'Transfers',
  lots: 'Lots',
  allocation: 'Allocation',
  return: 'Expected Return',
};

function triagePageTitle({ dashPage, activeTab, resultsLotId, storesView }) {
  if (dashPage === 'errors') return 'Errors';
  if (dashPage === 'stores') return storesView?.selectedStore || 'Stores';
  if (dashPage === 'shipments') return 'Transfers';
  if (dashPage === 'lots') return 'Lots';
  if (dashPage === 'allocation') return 'Allocation';
  if (dashPage === 'return') return 'Expected Return';
  if (activeTab === 'accuracy') return resultsLotId || 'Results';
  if (activeTab === 'deleted') return 'Deleted';
  return 'Triage';
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
  onCrumbsChange,
}) {
  const isMobile = useIsMobile();
  const showStoreInsights = Boolean(embedded && storeFilter && canViewTriageInsights(session?.profile));
  const [activeTab, setActiveTab] = useState('transfers');
  const [dashPage, setDashPage] = useState('');
  const [storesView, setStoresView] = useState({ selectedStore: '' });
  const [storeInsightTab, setStoreInsightTab] = useState('purchases');
  const appDate = useAppDate();
  const storePeriod = useMemo(
    () =>
      errorPeriodFromDates(
        appDate.startDate,
        appDate.endDate,
        appDate.mode === 'range' ? 'range' : appDate.mode === 'day' ? 'day' : 'month',
      ),
    [appDate.endDate, appDate.generation, appDate.mode, appDate.startDate],
  );
  const setStorePeriod = useCallback(
    (period) => {
      appDate.setAppDate({
        mode: period?.mode === 'month' || period?.startDate !== period?.endDate ? 'range' : 'day',
        startDate: period?.startDate,
        endDate: period?.endDate,
      });
    },
    [appDate],
  );
  const storesNavRef = useRef({ closeStore() {} });
  const [accuracyTab, setAccuracyTab] = useState('all');
  const [accuracyStats, setAccuracyStats] = useState({ correct: 0, incorrect: 0, total: 0, lots: 0, ratio: '0/0', percent: 0 });
  const [accuracyBreakdownOpen, setAccuracyBreakdownOpen] = useState(false);
  const [resultsLotId, setResultsLotId] = useState('');
  const [storeTab, setStoreTab] = useState('melt');
  const [listQuery, setListQuery] = useState('');
  const [canLeaveStore, setCanLeaveStore] = useState(false);
  const [batchContext, setBatchContext] = useState(null);
  const [dailyOpen, setDailyOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filterAnchor, setFilterAnchor] = useState({
    top: MOBILE_TOP_FILTER_SIZE + MOBILE_FILTER_INSET,
    right: MOBILE_FILTER_INSET,
  });
  const leaveStoreRef = useRef(null);
  const filterButtonRef = useRef(null);
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

  const accuracyTabOptions = useMemo(
    () => [
      { key: 'all', label: 'All', ...(accuracyStats.total ? { count: accuracyStats.total } : {}) },
      { key: 'correct', label: 'Correct', ...(accuracyStats.correct ? { count: accuracyStats.correct } : {}) },
      { key: 'incorrect', label: 'Incorrect', ...(accuracyStats.incorrect ? { count: accuracyStats.incorrect } : {}) },
    ],
    [accuracyStats],
  );

  const changeTab = useCallback((key) => {
    const dashPageKey =
      key === 'allocation' ||
      key === 'return' ||
      key === 'errors' ||
      key === 'stores' ||
      key === 'shipments' ||
      key === 'lots'
        ? key
        : '';
    if (!dashPageKey) leaveStoreRef.current?.();
    setActiveTab(dashPageKey ? 'transfers' : key);
    setListQuery('');
    setAccuracyBreakdownOpen(false);
    setDailyOpen(false);
    setResultsLotId('');
    setDashPage(dashPageKey);
    setFiltersOpen(false);
  }, []);

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
    session?.token && activeTab === 'transfers' && !inBatch && dashPage === 'stores' ? (
      null
    ) : session?.token && activeTab === 'transfers' && !inBatch && (dashPage === 'errors' || dashPage === 'lots') ? (
      searchField
    ) : session?.token && activeTab === 'transfers' && !inBatch ? (
      scanButton()
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

  const lotsListView =
    dashPage === 'lots' || (activeTab === 'accuracy' && !resultsLotId);
  const storesPageView = dashPage === 'stores';
  const showMobileNav = lotsListView || storesPageView;
  const canAdd =
    Boolean(session?.token) &&
    ((activeTab === 'transfers' && !dashPage) ||
      (inBatch && storeTab === 'melt') ||
      lotsListView);
  const canGoBack = canLeaveStore || activeTab !== 'transfers' || Boolean(dashPage);
  const pageTitle = triagePageTitle({ dashPage, activeTab, resultsLotId, storesView });

  const goBack = useCallback(() => {
    setFiltersOpen(false);
    if (leaveStoreRef.current) {
      leaveStoreRef.current();
      return;
    }
    if (activeTab !== 'transfers' || dashPage) changeTab('transfers');
  }, [activeTab, changeTab, dashPage]);

  const goDashboard = useCallback(() => {
    setFiltersOpen(false);
    leaveStoreRef.current?.();
    setActiveTab('transfers');
    setDashPage('');
    setResultsLotId('');
    setListQuery('');
    setAccuracyBreakdownOpen(false);
    setDailyOpen(false);
  }, []);

  useEffect(() => {
    if (!onCrumbsChange) return undefined;
    const pageLabel = DASH_PAGE_LABELS[dashPage];
    const crumbs = [];
    const onTriage =
      !inBatch &&
      activeTab === 'transfers' &&
      !dashPage &&
      !resultsLotId
        ? undefined
        : goDashboard;
    crumbs.push({ label: 'Triage', onPress: onTriage });

    if (inBatch) {
      crumbs.push({ label: batchContext?.dateLabel || pageTitle });
      onCrumbsChange(crumbs);
      return undefined;
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

    if (pageLabel) {
      const storeOpen = dashPage === 'stores' && storesView.selectedStore;
      crumbs.push({
        label: pageLabel,
        onPress: storeOpen ? () => storesNavRef.current?.closeStore?.() : undefined,
      });
    }
    if (dashPage === 'stores' && storesView.selectedStore) {
      crumbs.push({ label: storesView.selectedStore });
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
    storesView.selectedStore,
  ]);

  useEffect(() => {
    setStoreInsightTab('purchases');
  }, [storesView.selectedStore]);

  useEffect(() => () => onCrumbsChange?.([]), [onCrumbsChange]);

  const closeFilters = useCallback(() => setFiltersOpen(false), []);

  const placeFilterMenu = useCallback(() => {
    const button = filterButtonRef.current;
    const root = screenRootRef.current;
    if (!button || !root || typeof button.measureInWindow !== 'function') return;
    button.measureInWindow((x, y, width, height) => {
      root.measureInWindow((rootX, rootY, rootWidth) => {
        setFilterAnchor({
          top: y - rootY + height + 8,
          right: Math.max(8, rootWidth - (x - rootX + width)),
        });
      });
    });
  }, []);

  const pressFilter = useCallback(() => {
    expandMobileTabBar();
    placeFilterMenu();
    setFiltersOpen((open) => !open);
  }, [placeFilterMenu]);

  const showMobileFilter = isMobile && Boolean(session?.token);
  const currentStorePeriod = currentErrorPeriod();
  const storePeriodActive =
    dashPage === 'stores' &&
    (storePeriod.mode !== 'month' ||
      storePeriod.startDate !== currentStorePeriod.startDate ||
      storePeriod.endDate !== currentStorePeriod.endDate);
  const filtersActive =
    Boolean(listQuery.trim()) || Boolean(resultsLotId && accuracyTab !== 'all') || storePeriodActive;

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

  useLayoutEffect(() => {
    if (!onMobileHeader) return undefined;
    if (!isMobile) {
      onMobileHeader(null);
      return () => onMobileHeader(null);
    }
    onMobileHeader({
      hideAppHeader: showMobileNav,
      trailing: null,
    });
    return () => onMobileHeader(null);
  }, [isMobile, onMobileHeader, showMobileNav]);

  if (showStoreInsights) {
    return (
      <View style={[styles.body, styles.bodyEmbedded, isMobile && styles.bodyMobile]}>
        <TriageInsightsPanel session={session} storeFilter={storeFilter} onRequireLogin={onRequireLogin} />
      </View>
    );
  }

  return (
    <View
      ref={screenRootRef}
      style={[
        styles.body,
        embedded && styles.bodyEmbedded,
        isMobile && styles.bodyMobile,
        !isMobile && !embedded && styles.bodyUnderTopBar,
      ]}
    >
      {isMobile && showMobileNav ? <MobileNavHeader title={pageTitle} onBack={goBack} /> : null}
      {showMobileFilter ? (
        <MobileFilterDock>
          <MobileChromeCircle
            buttonRef={filterButtonRef}
            active={filtersOpen || filtersActive}
            onLayout={placeFilterMenu}
            onPress={pressFilter}
            accessibilityLabel="Triage filters"
            accessibilityState={{ expanded: filtersOpen }}
          />
        </MobileFilterDock>
      ) : null}
      <View style={styles.pageVisible}>
      {isMobile ? null : leadTools || trailing ? (
        <View style={styles.deskChrome}>
          <View style={styles.deskChromeStart}>{leadTools}</View>
          {trailing ? <View style={styles.deskChromeEnd}>{trailing}</View> : null}
        </View>
      ) : null}

      <View style={activeTab === 'transfers' ? styles.pageVisible : styles.pageHidden}>
        <TriageDashboardPanel
          session={session}
          onRequireLogin={onRequireLogin}
          active={activeTab === 'transfers'}
          listQuery={dashPage === 'stores' ? '' : listQuery}
          page={dashPage}
          onPageChange={setDashPage}
          onBackChange={handleBackChange}
          onOpenTab={changeTab}
          onStoresViewChange={setStoresView}
          storesNavRef={storesNavRef}
          storePeriod={storePeriod}
          onStorePeriodChange={setStorePeriod}
          storeInsightTab={storeInsightTab}
          onStoreInsightTabChange={setStoreInsightTab}
          onOpenLot={(lotId) => {
            setDashPage('');
            setActiveTab('accuracy');
            setResultsLotId(lotId || '');
            setListQuery('');
            setAccuracyTab('all');
          }}
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
        />
      ) : activeTab === 'deleted' ? (
        <TriageDeletedPanel session={session} query={listQuery} />
      ) : null}
      </View>

      {session?.token ? (
        <TriagePoCapture
          session={session}
          openerRef={openScanRef}
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

      {showMobileFilter && filtersOpen ? (
        <MobileFilterSheet
          visible
          top={filterAnchor.top}
          right={filterAnchor.right}
          onClose={closeFilters}
        >
          {searchField && dashPage !== 'stores' ? (
            <>
              <MobileFilterSheetLabel>Search</MobileFilterSheetLabel>
              {searchField}
            </>
          ) : null}
          {dashPage === 'stores' ? (
            <>
              <MobileFilterSheetLabel>Date</MobileFilterSheetLabel>
              <HomeDatePicker
                startDate={storePeriod.startDate}
                endDate={storePeriod.endDate}
                dateMode={storePeriod.mode === 'month' ? 'day' : 'range'}
                onChange={({ mode, start, end }) =>
                  setStorePeriod(errorPeriodFromDates(start, end, mode === 'range' ? 'range' : 'day'))
                }
                maximumDate={new Date()}
                fill
                searchChrome
              />
            </>
          ) : null}
          {resultsLotId ? (
            <>
              <MobileFilterSheetLabel>Results</MobileFilterSheetLabel>
              <SegmentedSlider
                options={accuracyTabOptions}
                value={accuracyTab}
                onChange={changeAccuracyTab}
                fill
                compact
                style={styles.sheetSlider}
              />
            </>
          ) : null}
          {inBatch ? (
            <>
              <MobileFilterSheetLabel>Store</MobileFilterSheetLabel>
              <SegmentedSlider
                options={storeTabOptions}
                value={storeTab}
                onChange={changeStoreTab}
                fill
                compact
                style={styles.sheetSlider}
              />
            </>
          ) : null}
          {canAdd || (session?.token && activeTab === 'accuracy') ? (
            <MobileFilterSheetDivider />
          ) : null}
          {canAdd ? (
            <MobileFilterSheetAction
              icon="add"
              iconBg="#1F8A4E"
              label="Add"
              onPress={() => {
                closeFilters();
                openScanRef.current();
              }}
              accessibilityLabel="Add a PO"
            />
          ) : null}
          {session?.token && activeTab === 'accuracy' ? (
            <MobileFilterSheetAction
              icon="list-outline"
              iconBg="#3A3A3C"
              label="Details"
              onPress={() => {
                closeFilters();
                setAccuracyBreakdownOpen(true);
              }}
              accessibilityLabel="Open lot details"
            />
          ) : null}
        </MobileFilterSheet>
      ) : null}
    </View>
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
  bodyUnderTopBar: {
    paddingTop: DESKTOP_TOP_BAR_HEIGHT,
  },
  tabSearch: {
    width: 220,
    maxWidth: 220,
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
  accuracyLead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flexShrink: 1,
    minWidth: 0,
  },
  sheetSlider: {
    alignSelf: 'stretch',
    width: '100%',
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
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    maxWidth: 360,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#fff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: T.hairline,
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
