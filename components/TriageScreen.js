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
import { BarButton, ChromeBackRow, FONT, SearchField, SegmentedSlider, T } from './TriageKit';
import {
  MobileFeedAddButton,
  MobileFeedDateButton,
  MobileFeedTopBarActions,
} from './MobileChrome';
import { ensureLinkedPosSessions } from '../lib/auth';
import { fetchTransferStores } from '../lib/locations';
import { expandMobileTabBar } from '../lib/mobileTabBar';
import { CANVAS, DESKTOP_TOP_BAR_HEIGHT, useIsMobile } from '../lib/mobileUi';
import {
  buildDailyReceiptGrid,
  dailyReceiptStatus,
  summarizeDailyReceipts,
  useDailyReceipts,
} from '../lib/triageDailyReceipts';
import { syncTransferWorkflowRemote } from '../lib/transferWorkflow';
import { useAppDate } from '../lib/appDate';
import { errorPeriodFromDates } from '../lib/triageStoreErrors';

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
  return: 'Expected Return',
};

function triagePageTitle({ dashPage, activeTab, resultsLotId, storesView, lotLabel }) {
  if (dashPage === 'errors') return 'Errors';
  if (dashPage === 'stores') return storesView?.selectedStore || 'Stores';
  if (dashPage === 'shipments') return 'Transfers';
  if (dashPage === 'lots') return 'Lots';
  if (dashPage === 'return') return 'Expected Return';
  if (activeTab === 'accuracy') return lotLabel || resultsLotId || 'Results';
  if (activeTab === 'deleted') return 'Deleted';
  return storesView?.selectedRegionLabel || 'Triage';
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
  const showStoreInsights = Boolean(embedded && storeFilter && canViewTriageInsights(session?.profile));
  const [activeTab, setActiveTab] = useState('transfers');
  const [dashPage, setDashPage] = useState('');
  const [storesView, setStoresView] = useState({ selectedStore: '' });
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
  const [captureFlowOpen, setCaptureFlowOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const mobileChromeHidden = captureFlowOpen || (isMobile && reviewOpen);
  const leaveStoreRef = useRef(null);
  const screenRootRef = useRef(null);
  const openScanRef = useRef(() => {});
  const triageDateOpenRef = useRef(null);
  const triageDateAnchorRef = useRef(null);
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
              ? 'Month / store'
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
    Boolean(storesView.selectedRegion);
  const pageTitle = triagePageTitle({
    dashPage,
    activeTab,
    resultsLotId,
    storesView,
    lotLabel: batchContext?.dateLabel,
  });

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

  const backLabel =
    resultsLotId || activeTab === 'accuracy'
      ? 'Lots'
      : activeTab === 'deleted'
        ? storesView.selectedRegionLabel || 'Triage'
        : dashPage === 'stores' && storesView.selectedStore
          ? 'Stores'
          : dashPage
            ? storesView.selectedRegionLabel || 'Regions'
            : storesView.selectedRegion
              ? 'Regions'
              : 'Back';

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
                storesNavRef.current?.closeStore?.();
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
      if (resultsLotId) crumbs.push({ label: batchContext?.dateLabel || resultsLotId });
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
    storesView.selectedRegion,
    storesView.selectedRegionLabel,
    storesView.selectedStore,
  ]);

  useEffect(() => () => onCrumbsChange?.([]), [onCrumbsChange]);

  useEffect(() => {
    if (dashPage && dashPage !== 'lots' && dashPage !== 'errors') {
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

  useEffect(() => {
    if (embedded) return undefined;
    return () => appDate.resetToToday();
  }, [appDate.resetToToday, embedded]);

  const triageDateActive =
    appDate.mode === 'range' || (appDate.mode === 'day' && !appDate.isToday);
  const openTriageDatePicker = useCallback(() => {
    expandMobileTabBar();
    triageDateOpenRef.current?.({ range: appDate.mode === 'range' });
  }, [appDate.mode]);

  const mobileTopBarTrailing = useMemo(
    () => (
      <MobileFeedTopBarActions>
        <View ref={triageDateAnchorRef} collapsable={false} style={{ flexShrink: 1, minWidth: 0 }}>
          <MobileFeedDateButton
            label={appDate.label}
            active={triageDateActive}
            onPress={openTriageDatePicker}
          />
          <HomeDatePicker
            startDate={appDate.startDate}
            endDate={appDate.endDate}
            dateMode={appDate.mode}
            onChange={appDate.applyPicker}
            maximumDate={new Date()}
            hideField
            openRef={triageDateOpenRef}
            anchorRef={triageDateAnchorRef}
          />
        </View>
        {canAdd ? (
          <MobileFeedAddButton
            onPress={() => openScanRef.current()}
            accessibilityLabel="Add a PO"
          />
        ) : null}
      </MobileFeedTopBarActions>
    ),
    [
      appDate.applyPicker,
      appDate.endDate,
      appDate.label,
      appDate.mode,
      appDate.startDate,
      canAdd,
      openTriageDatePicker,
      triageDateActive,
    ],
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
      <View style={styles.pageVisible}>
      {isMobile ? null : leadTools || trailing ? (
        <View style={styles.deskChrome}>
          <View style={styles.deskChromeStart}>{leadTools}</View>
          {trailing ? <View style={styles.deskChromeEnd}>{trailing}</View> : null}
        </View>
      ) : null}

      {canGoBack && !inBatch && !isMobile ? (
        <ChromeBackRow label={backLabel} onPress={goBack} />
      ) : null}

      <View style={activeTab === 'transfers' ? styles.pageVisible : styles.pageHidden}>
        <TriageDashboardPanel
          session={session}
          onRequireLogin={onRequireLogin}
          active={activeTab === 'transfers'}
          listQuery={listQuery}
          page={dashPage}
          onPageChange={setDashPage}
          onBackChange={handleBackChange}
          onStoresViewChange={setStoresView}
          storesNavRef={storesNavRef}
          storePeriod={storePeriod}
          onOpenLot={(lotId) => {
            setDashPage('');
            setActiveTab('accuracy');
            setResultsLotId(lotId || '');
            setListQuery('');
            setAccuracyTab('all');
          }}
          onReviewOpenChange={isMobile ? setReviewOpen : undefined}
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
          regionKey={storesView.selectedRegion}
          onOpenLotChange={(id) => {
            setResultsLotId(id || '');
            setListQuery('');
            setAccuracyTab('all');
          }}
          onBackChange={handleBackChange}
        />
      ) : activeTab === 'deleted' ? (
        <TriageDeletedPanel
          session={session}
          query={listQuery}
          regionKey={storesView.selectedRegion}
        />
      ) : null}
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
