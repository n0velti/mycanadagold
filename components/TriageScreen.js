import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import TriageAccuracyPanel from './TriageAccuracyPanel';
import TriagePoCapture from './TriagePoCapture';
import TriageDailyReceiptsDrawer from './TriageDailyReceiptsDrawer';
import TriageDashboardPanel from './TriageDashboardPanel';
import TriageDeletedPanel from './TriageDeletedPanel';
import { BarButton, EmptyState, FONT, SearchField, SegmentedSlider, T, TextTabs } from './TriageKit';
import { MobileNavButton, MobileNavHeader } from './MobileChrome';
import { ensureLinkedPosSessions } from '../lib/auth';
import { fetchTransferStores } from '../lib/locations';
import { CANVAS, useIsMobile } from '../lib/mobileUi';
import {
  buildDailyReceiptGrid,
  dailyReceiptStatus,
  summarizeDailyReceipts,
  useDailyReceipts,
} from '../lib/triageDailyReceipts';
import {
  collectAccuracyTriagePos,
  syncTransferWorkflowRemote,
  triagePoNeedsCorrection,
  useTransferWorkflow,
} from '../lib/transferWorkflow';

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

const TRIAGE_TABS = [
  { key: 'transfers', label: 'Dashboard', icon: 'grid-outline' },
  { key: 'accuracy', label: 'Results', icon: 'folder-outline' },
  { key: 'deleted', label: 'Deleted', icon: 'trash-outline' },
];

function triagePageTitle({ dashPage, activeTab, resultsLotId }) {
  if (dashPage === 'errors') return 'Errors';
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
}) {
  const isMobile = useIsMobile();
  const { triage, deleted = [] } = useTransferWorkflow();
  const [activeTab, setActiveTab] = useState('transfers');
  const [dashPage, setDashPage] = useState('');
  const [accuracyTab, setAccuracyTab] = useState('all');
  const [accuracyStats, setAccuracyStats] = useState({ correct: 0, incorrect: 0, total: 0, lots: 0, ratio: '0/0', percent: 0 });
  const [accuracyBreakdownOpen, setAccuracyBreakdownOpen] = useState(false);
  const [resultsLotId, setResultsLotId] = useState('');
  const [storeTab, setStoreTab] = useState('melt');
  const [listQuery, setListQuery] = useState('');
  const [canLeaveStore, setCanLeaveStore] = useState(false);
  const [batchContext, setBatchContext] = useState(null);
  const [dailyOpen, setDailyOpen] = useState(false);
  const leaveStoreRef = useRef(null);
  const openScanRef = useRef(() => {});
  const onStoreBackChangeRef = useRef(onStoreBackChange);
  onStoreBackChangeRef.current = onStoreBackChange;
  const currentTab = TRIAGE_TABS.find((tab) => tab.key === activeTab) || TRIAGE_TABS[0];

  useEffect(() => {
    if (!session?.supabaseUserId && !session?.token) return undefined;
    syncTransferWorkflowRemote().catch(() => {});
    if (session?.token) {
      ensureLinkedPosSessions(session).catch(() => {});
      fetchTransferStores(session).catch(() => {});
    }
    return undefined;
  }, [session?.supabaseUserId, session?.token]);

  const dashCounts = useMemo(() => {
    const flagged = collectAccuracyTriagePos(triage).filter(triagePoNeedsCorrection).length;
    return { errorCount: flagged };
  }, [triage]);

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
      key === 'allocation' || key === 'return' || key === 'errors' || key === 'shipments' || key === 'lots'
        ? key
        : '';
    if (!dashPageKey) leaveStoreRef.current?.();
    setActiveTab(dashPageKey ? 'transfers' : key);
    setListQuery('');
    setAccuracyBreakdownOpen(false);
    setDailyOpen(false);
    setResultsLotId('');
    setDashPage(dashPageKey);
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
  const tabOptions = useMemo(() => {
    const flagged = dashCounts.errorCount;
    return TRIAGE_TABS.map((tab) => {
      if (tab.key === 'transfers' && flagged > 0) return { ...tab, count: flagged };
      if (tab.key === 'accuracy' && flagged > 0) return { ...tab, count: flagged };
      if (tab.key === 'deleted' && deleted.length > 0) return { ...tab, count: deleted.length };
      return tab;
    });
  }, [dashCounts.errorCount, deleted.length]);
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
    session?.token && activeTab === 'transfers' && !inBatch && (dashPage === 'errors' || dashPage === 'lots') ? (
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

  const navTabs = useMemo(
    () => (
      <TextTabs
        options={tabOptions}
        value={activeTab}
        onChange={changeTab}
        size="lg"
        layout={isMobile ? 'bar' : 'inline'}
      />
    ),
    [activeTab, changeTab, isMobile, tabOptions],
  );

  const portalNav = Boolean(onNavTabs) && !isMobile;
  const lotsListView =
    dashPage === 'lots' || (activeTab === 'accuracy' && !resultsLotId);
  const canAdd =
    Boolean(session?.token) &&
    ((activeTab === 'transfers' && !dashPage) ||
      (inBatch && storeTab === 'melt') ||
      lotsListView);
  const canGoBack = canLeaveStore || activeTab !== 'transfers' || Boolean(dashPage);
  const pageTitle = triagePageTitle({ dashPage, activeTab, resultsLotId });

  const goBack = useCallback(() => {
    if (leaveStoreRef.current) {
      leaveStoreRef.current();
      return;
    }
    if (activeTab !== 'transfers' || dashPage) changeTab('transfers');
  }, [activeTab, changeTab, dashPage]);

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
  const leading =
    session?.token && canGoBack ? (
      <>
        <BarButton icon="chevron-back" label="Back" onPress={goBack} accessibilityLabel="Back" />
        {leadTools}
      </>
    ) : (
      leadTools
    );

  useLayoutEffect(() => {
    if (!portalNav) return undefined;
    onNavTabs(navTabs);
    return () => onNavTabs(null);
  }, [navTabs, onNavTabs, portalNav]);

  useLayoutEffect(() => {
    if (!onMobileHeader) return undefined;
    if (!isMobile) {
      onMobileHeader(null);
      return () => onMobileHeader(null);
    }
    onMobileHeader({
      hideAppHeader: lotsListView,
      trailing:
        canAdd && !lotsListView ? (
          <MobileNavButton
            tone="green"
            label="Add"
            onPress={() => openScanRef.current()}
            accessibilityLabel="Add a PO"
          >
            <Ionicons name="add" size={20} color="#fff" />
          </MobileNavButton>
        ) : null,
    });
    return () => onMobileHeader(null);
  }, [canAdd, isMobile, lotsListView, onMobileHeader]);

  return (
    <View style={[styles.body, embedded && styles.bodyEmbedded, isMobile && styles.bodyMobile]}>
      {isMobile && lotsListView ? (
        <MobileNavHeader
          title={pageTitle}
          onBack={goBack}
          trailing={
            canAdd ? (
              <MobileNavButton
                tone="green"
                label="Add"
                onPress={() => openScanRef.current()}
                accessibilityLabel="Add a PO"
              >
                <Ionicons name="add" size={20} color="#fff" />
              </MobileNavButton>
            ) : null
          }
        />
      ) : null}
      <View style={styles.pageVisible}>
      {portalNav || isMobile ? null : <View style={styles.localNavRow}>{navTabs}</View>}
      {isMobile ? null : leading || trailing ? (
        <View style={styles.deskChrome}>
          <View style={styles.deskChromeStart}>{leading}</View>
          {trailing ? <View style={styles.deskChromeEnd}>{trailing}</View> : null}
        </View>
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
          onOpenTab={changeTab}
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
      ) : activeTab !== 'transfers' ? (
        <View style={styles.pageVisible}>
          <EmptyState
            icon={currentTab.icon}
            title={currentTab.label}
            body={`Nothing to review in ${currentTab.label.toLowerCase()} yet.`}
          />
        </View>
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
  localNavRow: {
    flexShrink: 0,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'flex-end',
    paddingBottom: 2,
    backgroundColor: CANVAS,
  },
  localNavRowMobile: {
    justifyContent: 'flex-start',
    alignItems: 'stretch',
    paddingBottom: 0,
    backgroundColor: CANVAS,
  },
  mobileChrome: {
    flexShrink: 0,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 10,
    gap: 10,
    backgroundColor: CANVAS,
  },
  mobileActions: {
    flexDirection: 'row',
    gap: 8,
  },
  mobileFabLayer: {
    flexShrink: 0,
  },
  mobileTitle: {
    flex: 1,
    minWidth: 0,
    fontFamily: FONT,
    fontSize: 15,
    fontWeight: '600',
    color: '#6B5E3A',
    textAlign: 'center',
    letterSpacing: 0.2,
    paddingHorizontal: 8,
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
  mobileTitleSpacer: {
    width: 40,
    height: 40,
  },
  mobileStatCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 72,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: '#fff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: T.hairline,
  },
  mobileStatCardOn: {
    backgroundColor: '#fff',
    borderColor: T.text,
  },
  mobileStatCopy: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  mobileStatKicker: {
    fontFamily: FONT,
    fontSize: 12,
    fontWeight: '600',
    color: T.secondary,
    textTransform: 'uppercase',
    letterSpacing: -0.08,
  },
  mobileStatTitle: {
    fontFamily: FONT,
    fontSize: 17,
    fontWeight: '600',
    color: T.text,
    letterSpacing: -0.3,
  },
  mobileStatMeta: {
    fontFamily: FONT,
    fontSize: 13,
    color: T.secondary,
  },
  mobileStatCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    flexShrink: 0,
  },
  mobileStatAction: {
    fontFamily: FONT,
    fontSize: 13,
    fontWeight: '600',
    color: T.text,
  },
  pageChromeFloat: {
    flexShrink: 0,
    marginTop: 16,
    marginHorizontal: 20,
    marginBottom: 8,
    borderRadius: 16,
    ...Platform.select({
      web: { boxShadow: '0 8px 28px rgba(0,0,0,0.12)' },
      default: {
        shadowColor: '#000',
        shadowOpacity: 0.12,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 6 },
        elevation: 6,
      },
    }),
  },
  pageChromeBlur: {
    overflow: 'hidden',
    borderRadius: 16,
    backgroundColor: Platform.OS === 'web' ? 'transparent' : 'rgba(255,255,255,0.62)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,0,0,0.08)',
  },
  pageChrome: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 8,
    paddingVertical: 8,
    backgroundColor: 'transparent',
  },
  pageChromeStart: {
    flexShrink: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  pageChromeEnd: {
    marginLeft: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
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
