import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import TriageAccuracyPanel from './TriageAccuracyPanel';
import TriagePoCapture from './TriagePoCapture';
import TriageDailyReceiptsDrawer from './TriageDailyReceiptsDrawer';
import TriageDashboardPanel from './TriageDashboardPanel';
import TriageDeletedPanel from './TriageDeletedPanel';
import { BarButton, EmptyState, FONT, IconAction, SearchField, SegmentedSlider, T, TextTabs } from './TriageKit';
import { MobileCircleButton, MobileFilterLines } from './MobileChrome';
import { ensureLinkedPosSessions } from '../lib/auth';
import { fetchTransferStores } from '../lib/locations';
import { CANVAS, MOBILE_FILTER_INSET, useIsMobile } from '../lib/mobileUi';
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

const FILTER_VIEWS = [
  { key: 'transfers', label: 'Dashboard' },
  { key: 'shipments', label: 'Transfers' },
  { key: 'allocation', label: 'Allocation' },
  { key: 'return', label: 'Expected Return' },
  { key: 'accuracy', label: 'Results' },
  { key: 'deleted', label: 'Deleted' },
];

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
  const [accuracyTab, setAccuracyTab] = useState('correct');
  const [accuracyStats, setAccuracyStats] = useState({ correct: 0, incorrect: 0, total: 0, lots: 0, ratio: '0/0', percent: 0 });
  const [accuracyBreakdownOpen, setAccuracyBreakdownOpen] = useState(false);
  const [resultsLotId, setResultsLotId] = useState('');
  const [storeTab, setStoreTab] = useState('melt');
  const [listQuery, setListQuery] = useState('');
  const [canLeaveStore, setCanLeaveStore] = useState(false);
  const [batchContext, setBatchContext] = useState(null);
  const [dailyOpen, setDailyOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
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
      { key: 'correct', label: 'Correct', ...(accuracyStats.correct ? { count: accuracyStats.correct } : {}) },
      { key: 'incorrect', label: 'Incorrect', ...(accuracyStats.incorrect ? { count: accuracyStats.incorrect } : {}) },
    ],
    [accuracyStats],
  );

  const changeTab = useCallback((key) => {
    const dashPageKey =
      key === 'allocation' || key === 'return' || key === 'errors' || key === 'shipments' ? key : '';
    if (!dashPageKey) leaveStoreRef.current?.();
    setActiveTab(dashPageKey ? 'transfers' : key);
    setListQuery('');
    setAccuracyBreakdownOpen(false);
    setDailyOpen(false);
    setFiltersOpen(false);
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
    onStoreBackChangeRef.current?.(fn, context || null);
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
      label="+ Add"
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
    session?.token && activeTab === 'transfers' && !inBatch && dashPage === 'errors' ? (
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
            <IconAction
              icon="phone-portrait-outline"
              onPress={() => batchContext.onOpenFeed?.()}
              accessibilityLabel="Open feed view"
            />
            {scanButton()}
          </>
        ) : null}
      </>
    ) : session?.token && activeTab === 'accuracy' ? (
      <ChromeStats
        items={[
          ...(resultsLotId ? [] : [{ label: 'Lots', value: String(accuracyStats.lots || 0) }]),
          { label: 'Correct', value: String(accuracyStats.correct) },
          {
            label: 'Incorrect',
            value: String(accuracyStats.incorrect),
            tone: accuracyStats.incorrect ? 'red' : undefined,
          },
          {
            label: 'Ratio',
            value: accuracyStats.total ? `${accuracyStats.ratio} · ${accuracyStats.percent}%` : '0/0',
            tone: accuracyStats.percent >= 90 ? 'green' : undefined,
          },
        ]}
        onPress={() => setAccuracyBreakdownOpen(true)}
        actionLabel="Details"
        accessibilityLabel="Open errors breakdown"
      />
    ) : session?.token && activeTab === 'deleted' ? (
      searchField
    ) : null;

  const leading =
    session?.token && inBatch ? (
      <SegmentedSlider
        options={storeTabOptions}
        value={storeTab}
        onChange={changeStoreTab}
        style={styles.tabSlider}
      />
    ) : session?.token && activeTab === 'accuracy' ? (
      <View style={styles.accuracyLead}>
        {resultsLotId ? (
          <SegmentedSlider
            options={accuracyTabOptions}
            value={accuracyTab}
            onChange={changeAccuracyTab}
            style={styles.tabSlider}
          />
        ) : null}
        {searchField}
      </View>
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
  const canAdd =
    Boolean(session?.token) &&
    ((activeTab === 'transfers' && !dashPage) || (inBatch && storeTab === 'melt'));
  const filtersActive = Boolean(listQuery.trim()) || (activeTab !== 'transfers' && activeTab !== 'accuracy');
  const filterShow =
    session?.token && inBatch
      ? { options: storeTabOptions, value: storeTab, onChange: changeStoreTab }
      : session?.token && activeTab === 'accuracy' && resultsLotId
        ? { options: accuracyTabOptions, value: accuracyTab, onChange: changeAccuracyTab }
        : null;

  useLayoutEffect(() => {
    if (!portalNav) return undefined;
    onNavTabs(navTabs);
    return () => onNavTabs(null);
  }, [navTabs, onNavTabs, portalNav]);

  useLayoutEffect(() => {
    if (!onMobileHeader) return undefined;
    onMobileHeader(null);
    return () => onMobileHeader(null);
  }, [onMobileHeader]);

  const mobileChrome =
    !session?.token ? null : inBatch ? (
      <View style={styles.mobileChrome}>
        <Pressable
          style={[styles.mobileStatCard, !dailySummary.allChecked && dailySummary.cells > 0 && styles.mobileStatCardOn]}
          onPress={() => setDailyOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="Open the daily receipt check"
        >
          <View style={styles.mobileStatCopy}>
            <Text style={styles.mobileStatKicker}>Daily check</Text>
            <Text style={styles.mobileStatTitle}>
              {batchContext.stats?.expected
                ? `${batchContext.stats.received}/${batchContext.stats.expected} received`
                : 'No PO / SO yet'}
            </Text>
            <Text style={styles.mobileStatMeta}>{dailyStatus.label}</Text>
          </View>
          <View style={styles.mobileStatCta}>
            <Text style={styles.mobileStatAction}>{dailySummary.allChecked ? 'Open' : 'Check'}</Text>
            <Ionicons name="chevron-forward" size={16} color={T.secondary} />
          </View>
        </Pressable>
        {storeTab === 'melt' ? (
          <View style={styles.mobileActions}>
            <BarButton
              size="lg"
              icon="phone-portrait-outline"
              label="Feed"
              onPress={() => batchContext.onOpenFeed?.()}
              accessibilityLabel="Open feed view"
            />
          </View>
        ) : null}
      </View>
    ) : activeTab === 'accuracy' ? (
      <View style={styles.mobileChrome}>
        <Pressable
          style={styles.mobileStatCard}
          onPress={() => setAccuracyBreakdownOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="Open errors breakdown"
        >
          <View style={styles.mobileStatCopy}>
            <Text style={styles.mobileStatKicker}>{resultsLotId || 'Results'}</Text>
            <Text style={styles.mobileStatTitle}>
              {accuracyStats.total ? `${accuracyStats.percent}% correct` : 'No purchases yet'}
            </Text>
            <Text style={styles.mobileStatMeta}>
              {resultsLotId
                ? accuracyStats.incorrect
                  ? `${accuracyStats.incorrect} incorrect · tap for details`
                  : `${accuracyStats.correct} correct`
                : `${accuracyStats.lots || 0} ${accuracyStats.lots === 1 ? 'lot' : 'lots'}`}
            </Text>
          </View>
          <View style={styles.mobileStatCta}>
            <Text style={styles.mobileStatAction}>Details</Text>
            <Ionicons name="chevron-forward" size={16} color={T.secondary} />
          </View>
        </Pressable>
      </View>
    ) : null;

  return (
    <View style={[styles.body, embedded && styles.bodyEmbedded, isMobile && styles.bodyMobile]}>
      {isMobile && session?.token ? (
        <View pointerEvents="box-none" style={styles.mobileFabLayer}>
          <MobileCircleButton
            active={filtersOpen || filtersActive}
            onPress={() => setFiltersOpen((open) => !open)}
            accessibilityLabel="Triage filters"
            accessibilityState={{ expanded: filtersOpen }}
          >
            <MobileFilterLines color={filtersOpen || filtersActive ? T.text : T.secondary} />
          </MobileCircleButton>
          {canAdd ? (
            <MobileCircleButton
              tone="green"
              onPress={() => {
                setFiltersOpen(false);
                openScanRef.current();
              }}
              accessibilityLabel="Add a PO"
            >
              <Ionicons name="add" size={22} color="#fff" />
            </MobileCircleButton>
          ) : null}
        </View>
      ) : null}
      <View style={styles.pageVisible}>
      {portalNav || isMobile ? null : <View style={styles.localNavRow}>{navTabs}</View>}
      {isMobile ? (
        <>
          <View style={styles.mobileFabSlot} />
          {mobileChrome}
        </>
      ) : leading || trailing ? (
        <View style={styles.pageChromeFloat}>
          <BlurView
            intensity={72}
            tint="light"
            style={styles.pageChromeBlur}
            {...(Platform.OS === 'web' ? { className: 'cgold-home-toolbar-blur' } : null)}
          >
            <View style={styles.pageChrome}>
              <View style={styles.pageChromeStart}>{leading}</View>
              {trailing ? <View style={styles.pageChromeEnd}>{trailing}</View> : null}
            </View>
          </BlurView>
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
        />
      </View>

      {activeTab === 'accuracy' ? (
        <TriageAccuracyPanel
          session={session}
          storeFilter={storeFilter}
          accuracyTab={accuracyTab}
          listQuery={listQuery}
          onStatsChange={setAccuracyStats}
          breakdownOpen={accuracyBreakdownOpen}
          onBreakdownOpenChange={setAccuracyBreakdownOpen}
          openLotId={resultsLotId}
          onOpenLotChange={(id) => {
            setResultsLotId(id || '');
            setListQuery('');
            setAccuracyTab('correct');
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

      {isMobile && filtersOpen ? (
        <View style={styles.filterLayer}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setFiltersOpen(false)}
            accessibilityLabel="Close filters"
          />
          <View style={styles.filterCard}>
            <Text style={styles.filterLabel}>Search</Text>
            {searchField}
            <Text style={styles.filterLabel}>View</Text>
            {FILTER_VIEWS.map((tab) => {
              const selected = tab.key === (dashPage || activeTab);
              const count = tabOptions.find((option) => option.key === tab.key)?.count;
              return (
                <Pressable
                  key={tab.key}
                  style={styles.filterRow}
                  onPress={() => changeTab(tab.key)}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={tab.label}
                >
                  <Text style={[styles.filterRowLabel, selected && styles.filterRowLabelOn]}>{tab.label}</Text>
                  {count != null ? <Text style={styles.filterRowCount}>{count}</Text> : null}
                  {selected ? <Ionicons name="checkmark" size={18} color={T.text} /> : <View style={styles.filterRowCheck} />}
                </Pressable>
              );
            })}
            {filterShow ? (
              <>
                <View style={styles.filterDivider} />
                <Text style={styles.filterLabel}>Show</Text>
                <SegmentedSlider
                  fill
                  options={filterShow.options}
                  value={filterShow.value}
                  onChange={(key) => {
                    filterShow.onChange(key);
                    setFiltersOpen(false);
                  }}
                />
              </>
            ) : null}
          </View>
        </View>
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
    position: 'absolute',
    top: 8,
    left: MOBILE_FILTER_INSET,
    right: MOBILE_FILTER_INSET,
    zIndex: 24,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  mobileFabSlot: {
    height: 56,
    flexShrink: 0,
  },
  filterLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 30,
  },
  filterCard: {
    position: 'absolute',
    top: 56,
    left: MOBILE_FILTER_INSET,
    width: 300,
    maxWidth: '92%',
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 12,
    gap: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: T.hairline,
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
  filterLabel: {
    fontFamily: FONT,
    fontSize: 12,
    fontWeight: '600',
    color: T.secondary,
    letterSpacing: -0.08,
    textTransform: 'uppercase',
    paddingHorizontal: 4,
  },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 40,
    paddingHorizontal: 4,
    borderRadius: 8,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  filterRowLabel: {
    flex: 1,
    fontFamily: FONT,
    fontSize: 15,
    fontWeight: '600',
    color: T.text,
    letterSpacing: -0.15,
  },
  filterRowLabelOn: {
    color: T.text,
  },
  filterRowCount: {
    fontFamily: FONT,
    fontSize: 13,
    fontWeight: '600',
    color: T.secondary,
    fontVariant: ['tabular-nums'],
  },
  filterRowCheck: {
    width: 18,
  },
  filterDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: T.hairline,
    marginHorizontal: 4,
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
