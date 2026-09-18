import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import TriageAccuracyPanel from './TriageAccuracyPanel';
import TriageDailyReceiptsDrawer from './TriageDailyReceiptsDrawer';
import TriageDeletedPanel from './TriageDeletedPanel';
import TriageTransfersPanel from './TriageTransfersPanel';
import { BarButton, EmptyState, FONT, IconAction, SearchField, SegmentedSlider, T, TextTabs } from './TriageKit';
import { useIsMobile } from '../lib/mobileUi';
import {
  buildDailyReceiptGrid,
  dailyReceiptStatus,
  summarizeDailyReceipts,
  useDailyReceipts,
} from '../lib/triageDailyReceipts';
import {
  batchStats,
  collectAccuracyTriagePos,
  isStandaloneTriage,
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
    '.cgold-triage-table-row:hover,.cgold-triage-table-row:has(:hover),.cgold-triage-table-row.is-hover{background-color:#f5f5f7!important;}',
    '.cgold-triage-table-row:hover > *,.cgold-triage-table-row:has(:hover) > *,.cgold-triage-table-row.is-hover > *{background-color:transparent!important;}',
    '.cgold-triage-row-selected,.cgold-triage-row-selected:hover{background-color:#EAF2FF!important;}',
    '.cgold-accuracy-row:hover{background-color:#f5f5f7!important;}',
    '.cgold-chrome-stats-btn{cursor:pointer;transition:background-color .12s ease,border-color .12s ease;}',
    '.cgold-chrome-stats-btn:hover{background-color:#f5f5f7;}',
    '.cgold-chrome-stats-btn-attention:hover{background-color:rgba(0,122,255,0.16);}',
  ].join('');
}

/** Drop cached transaction rows so nothing outlives the session that loaded them. */
export function clearTriageCache() {}

const TRIAGE_TABS = [
  { key: 'transfers', label: 'Dashboard', icon: 'grid-outline' },
  { key: 'accuracy', label: 'Accuracy', icon: 'checkmark-done-outline' },
  { key: 'allocation', label: 'Allocation', icon: 'git-branch-outline' },
  { key: 'deleted', label: 'Deleted', icon: 'trash-outline' },
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
        <Ionicons name="chevron-forward" size={15} color={T.blue} />
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
}) {
  const isMobile = useIsMobile();
  const { triage, deleted = [] } = useTransferWorkflow();
  const [activeTab, setActiveTab] = useState('transfers');
  const [dashTab, setDashTab] = useState('poso');
  const [accuracyTab, setAccuracyTab] = useState('correct');
  const [accuracyStats, setAccuracyStats] = useState({ correct: 0, incorrect: 0, total: 0, ratio: '0/0', percent: 0 });
  const [accuracyBreakdownOpen, setAccuracyBreakdownOpen] = useState(false);
  const [storeTab, setStoreTab] = useState('melt');
  const [createTransferOpen, setCreateTransferOpen] = useState(false);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [listQuery, setListQuery] = useState('');
  const [transferView, setTransferView] = useState('list');
  const [canLeaveStore, setCanLeaveStore] = useState(false);
  const [batchContext, setBatchContext] = useState(null);
  const [dailyOpen, setDailyOpen] = useState(false);
  const leaveStoreRef = useRef(null);
  const onStoreBackChangeRef = useRef(onStoreBackChange);
  onStoreBackChangeRef.current = onStoreBackChange;
  const currentTab = TRIAGE_TABS.find((tab) => tab.key === activeTab) || TRIAGE_TABS[0];

  useEffect(() => {
    if (!session?.supabaseUserId && !session?.token) return undefined;
    syncTransferWorkflowRemote().catch(() => {});
    return undefined;
  }, [session?.supabaseUserId, session?.token]);

  const tabOptions = useMemo(() => {
    let openDocs = 0;
    for (const batch of triage) openDocs += batchStats(batch).open;
    const flagged = collectAccuracyTriagePos(triage).filter(triagePoNeedsCorrection).length;
    return TRIAGE_TABS.map((tab) => {
      if (tab.key === 'transfers' && openDocs > 0) return { ...tab, count: openDocs };
      if (tab.key === 'accuracy' && flagged > 0) return { ...tab, count: flagged };
      if (tab.key === 'deleted' && deleted.length > 0) return { ...tab, count: deleted.length };
      return tab;
    });
  }, [deleted.length, triage]);

  const dashTabOptions = useMemo(() => {
    let poCount = 0;
    let batchCount = 0;
    for (const row of triage) {
      if (isStandaloneTriage(row)) poCount += 1;
      else batchCount += 1;
    }
    return [
      { key: 'poso', label: 'PO / SO', ...(poCount ? { count: poCount } : {}) },
      { key: 'batch', label: 'Batch', ...(batchCount ? { count: batchCount } : {}) },
    ];
  }, [triage]);

  const accuracyTabOptions = useMemo(
    () => [
      { key: 'correct', label: 'Correct', ...(accuracyStats.correct ? { count: accuracyStats.correct } : {}) },
      { key: 'incorrect', label: 'Incorrect', ...(accuracyStats.incorrect ? { count: accuracyStats.incorrect } : {}) },
    ],
    [accuracyStats],
  );

  const changeTab = useCallback((key) => {
    leaveStoreRef.current?.();
    setActiveTab(key);
    setCreateTransferOpen(false);
    setQuickAddOpen(false);
    setListQuery('');
    setAccuracyBreakdownOpen(false);
    setDailyOpen(false);
  }, []);

  const changeDashTab = useCallback((key) => {
    setDashTab(key);
    setListQuery('');
    setCreateTransferOpen(false);
    setQuickAddOpen(false);
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

  const inBatch = activeTab === 'transfers' && canLeaveStore && Boolean(batchContext);
  const dailyBatch = inBatch ? batchContext?.batch || null : null;
  const daily = useDailyReceipts(dailyBatch?.id, Boolean(session?.token && dailyBatch));
  const dailyGrid = useMemo(() => buildDailyReceiptGrid(dailyBatch), [dailyBatch]);
  const dailySummary = useMemo(() => summarizeDailyReceipts(dailyGrid, daily.receipts), [daily.receipts, dailyGrid]);
  const dailyStatus = useMemo(() => dailyReceiptStatus(dailySummary), [dailySummary]);

  useEffect(() => {
    if (!dailyBatch) setDailyOpen(false);
  }, [dailyBatch]);

  const searchField = session?.token ? (
    <SearchField
      value={listQuery}
      onChangeText={setListQuery}
      placeholder={
        activeTab === 'accuracy'
          ? 'PO / person / store'
          : activeTab === 'deleted'
            ? 'Batch / PO'
            : dashTab === 'batch'
              ? 'Batch / store'
              : 'PO / SO'
      }
      style={[styles.tabSearch, isMobile && styles.tabSearchMobile]}
    />
  ) : null;

  const trailing =
    session?.token && activeTab === 'transfers' && transferView === 'list' ? (
      <>
        {searchField}
        <BarButton
          label="Quick Add"
          onPress={() => {
            setDashTab('poso');
            setListQuery('');
            setQuickAddOpen(true);
          }}
          accessibilityLabel="Quick Add a PO from any store"
        />
        <BarButton
          icon="add"
          label="Add Batch"
          onPress={() => {
            setDashTab('batch');
            setListQuery('');
            setCreateTransferOpen(true);
          }}
          accessibilityLabel="Add a new batch"
        />
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
            <IconAction
              icon="phone-portrait-outline"
              onPress={() => batchContext.onOpenFeed?.()}
              accessibilityLabel="Open feed view"
            />
            <BarButton
              label="Quick Add"
              onPress={() => batchContext.onAddMelt?.()}
              accessibilityLabel="Quick Add a PO / SO"
            />
          </>
        ) : null}
      </>
    ) : session?.token && activeTab === 'accuracy' ? (
      <ChromeStats
        items={[
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

  const storeTabOptions = useMemo(() => {
    const melt = batchContext?.stats?.expected || 0;
    return [
      { key: 'melt', label: 'Melt', ...(melt ? { count: melt } : {}) },
      { key: 'bullion', label: 'Bullion' },
    ];
  }, [batchContext]);

  const leading =
    session?.token && activeTab === 'transfers' && transferView === 'list' ? (
      <SegmentedSlider
        options={dashTabOptions}
        value={dashTab}
        onChange={changeDashTab}
        style={styles.tabSlider}
      />
    ) : session?.token && inBatch ? (
      <SegmentedSlider
        options={storeTabOptions}
        value={storeTab}
        onChange={changeStoreTab}
        style={styles.tabSlider}
      />
    ) : session?.token && activeTab === 'accuracy' ? (
      <View style={styles.accuracyLead}>
        <SegmentedSlider
          options={accuracyTabOptions}
          value={accuracyTab}
          onChange={changeAccuracyTab}
          style={styles.tabSlider}
        />
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
        layout="inline"
      />
    ),
    [activeTab, changeTab, tabOptions],
  );

  const portalNav = Boolean(onNavTabs) && !isMobile;

  useLayoutEffect(() => {
    if (!portalNav) return undefined;
    onNavTabs(navTabs);
    return () => onNavTabs(null);
  }, [navTabs, onNavTabs, portalNav]);

  return (
    <View style={[styles.body, embedded && styles.bodyEmbedded]}>
      {portalNav ? null : <View style={styles.localNavRow}>{navTabs}</View>}
      {leading || trailing ? (
        <View style={[styles.pageChrome, isMobile && styles.pageChromeMobile]}>
          <View style={styles.pageChromeStart}>{leading}</View>
          {trailing ? <View style={styles.pageChromeEnd}>{trailing}</View> : null}
        </View>
      ) : null}

      <View style={activeTab === 'transfers' ? styles.pageVisible : styles.pageHidden}>
        <TriageTransfersPanel
          session={session}
          onRequireLogin={onRequireLogin}
          createOpen={createTransferOpen}
          onCreateOpenChange={setCreateTransferOpen}
          quickAddOpen={quickAddOpen}
          onQuickAddOpenChange={setQuickAddOpen}
          dashTab={dashTab}
          onDashTabChange={changeDashTab}
          onViewChange={setTransferView}
          onBackChange={handleBackChange}
          listQuery={listQuery}
          storeTab={storeTab}
          onStoreTabChange={changeStoreTab}
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
    backgroundColor: T.bg,
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
    flexGrow: 1,
    flexBasis: 140,
    width: 'auto',
    maxWidth: '100%',
    minWidth: 120,
  },
  localNavRow: {
    flexShrink: 0,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'flex-end',
    paddingBottom: 2,
  },
  pageChrome: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingTop: 28,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: T.hairline,
  },
  pageChromeMobile: {
    flexWrap: 'wrap',
    gap: 8,
    paddingTop: 18,
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
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    maxWidth: 360,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: T.hairline,
    backgroundColor: T.card,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  chromeStatsHitWide: {
    maxWidth: 640,
  },
  chromeStatsHitPressed: {
    backgroundColor: '#f5f5f7',
  },
  chromeStatsHitAttention: {
    backgroundColor: 'rgba(0,122,255,0.10)',
    borderColor: 'rgba(0,122,255,0.38)',
  },
  chromeStatsHitAttentionPressed: {
    backgroundColor: 'rgba(0,122,255,0.16)',
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
    color: T.blue,
    letterSpacing: -0.15,
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
    color: '#248A3D',
  },
  chromeStatRed: {
    color: '#D70015',
  },
  chromeStatOrange: {
    color: '#C93400',
  },
  pageVisible: {
    flex: 1,
    minHeight: 0,
  },
  pageHidden: {
    display: 'none',
  },
});
