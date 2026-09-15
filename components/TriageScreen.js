import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import TriageAccuracyPanel from './TriageAccuracyPanel';
import TriageDeletedPanel from './TriageDeletedPanel';
import TriageTransfersPanel from './TriageTransfersPanel';
import { BarButton, EmptyState, FONT, SearchField, T, TextTabs } from './TriageKit';
import { useIsMobile } from '../lib/mobileUi';
import {
  batchStats,
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
    '.cgold-triage-row:hover{background-color:#f5f5f7!important;}',
    '.cgold-triage-row-selected,.cgold-triage-row-selected:hover{background-color:#EAF2FF!important;}',
    '.cgold-triage-row-mixed{background-color:rgba(255,149,0,0.16)!important;}',
    '.cgold-triage-row-mixed .cgold-triage-row:hover{background-color:rgba(255,149,0,0.26)!important;}',
    '.cgold-triage-row-bullion{background-color:rgba(255,59,48,0.16)!important;}',
    '.cgold-triage-row-bullion .cgold-triage-row:hover{background-color:rgba(255,59,48,0.26)!important;}',
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

export default function TriageScreen({
  session,
  onRequireLogin,
  storeFilter,
  embedded = false,
  onStoreBackChange,
}) {
  const isMobile = useIsMobile();
  const { triage, deleted = [] } = useTransferWorkflow();
  const [activeTab, setActiveTab] = useState('transfers');
  const [createTransferOpen, setCreateTransferOpen] = useState(false);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [listQuery, setListQuery] = useState('');
  const [transferView, setTransferView] = useState('list');
  const [canLeaveStore, setCanLeaveStore] = useState(false);
  const [batchContext, setBatchContext] = useState(null);
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

  const changeTab = useCallback((key) => {
    leaveStoreRef.current?.();
    setActiveTab(key);
    setCreateTransferOpen(false);
    setQuickAddOpen(false);
    setListQuery('');
  }, []);

  const handleBackChange = useCallback((fn, context) => {
    leaveStoreRef.current = fn;
    setCanLeaveStore(Boolean(fn));
    setBatchContext(context || null);
    onStoreBackChangeRef.current?.(fn, context || null);
  }, []);

  const inBatch = activeTab === 'transfers' && canLeaveStore && Boolean(batchContext);
  const trailing =
    session?.token && activeTab === 'transfers' && transferView === 'list' ? (
      <>
        <SearchField
          value={listQuery}
          onChangeText={setListQuery}
          placeholder="PO / SO"
          style={[styles.tabSearch, isMobile && styles.tabSearchMobile]}
        />
        <BarButton
          label="Quick Add"
          onPress={() => setQuickAddOpen(true)}
          accessibilityLabel="Quick Add a PO from any store"
        />
        <BarButton
          icon="add"
          label="Add Batch"
          onPress={() => setCreateTransferOpen(true)}
          accessibilityLabel="Add a new batch"
        />
      </>
    ) : session?.token && inBatch && !onStoreBackChange ? (
      <View style={styles.batchTitle} pointerEvents="none">
        <Text style={styles.batchTitleDate} numberOfLines={1}>
          {batchContext.dateLabel}
        </Text>
        {batchContext.storeNames ? (
          <Text style={styles.batchTitleStores} numberOfLines={1}>
            {batchContext.storeNames}
          </Text>
        ) : null}
      </View>
    ) : null;

  return (
    <View style={[styles.body, embedded && styles.bodyEmbedded]}>
      <TextTabs options={tabOptions} value={activeTab} onChange={changeTab} trailing={trailing} size="lg" />

      <View style={activeTab === 'transfers' ? styles.pageVisible : styles.pageHidden}>
        <TriageTransfersPanel
          session={session}
          onRequireLogin={onRequireLogin}
          createOpen={createTransferOpen}
          onCreateOpenChange={setCreateTransferOpen}
          quickAddOpen={quickAddOpen}
          onQuickAddOpenChange={setQuickAddOpen}
          onViewChange={setTransferView}
          onBackChange={handleBackChange}
          listQuery={listQuery}
        />
      </View>

      {activeTab === 'accuracy' ? (
        <TriageAccuracyPanel session={session} storeFilter={storeFilter} />
      ) : activeTab === 'deleted' ? (
        <TriageDeletedPanel session={session} />
      ) : activeTab !== 'transfers' ? (
        <EmptyState
          icon={currentTab.icon}
          title={currentTab.label}
          body={`Nothing to review in ${currentTab.label.toLowerCase()} yet.`}
        />
      ) : null}
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
  tabSearchMobile: {
    flexGrow: 1,
    flexBasis: 140,
    width: 'auto',
    maxWidth: '100%',
    minWidth: 120,
  },
  batchTitle: {
    maxWidth: 220,
    alignItems: 'flex-end',
  },
  batchTitleDate: {
    fontFamily: FONT,
    fontSize: 13,
    fontWeight: '600',
    color: T.text,
    letterSpacing: -0.2,
    textAlign: 'right',
  },
  batchTitleStores: {
    fontFamily: FONT,
    fontSize: 11,
    color: T.secondary,
    textAlign: 'right',
  },
  pageVisible: {
    flex: 1,
    minHeight: 0,
  },
  pageHidden: {
    display: 'none',
  },
});
