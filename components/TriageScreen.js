import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import TriageAccuracyPanel from './TriageAccuracyPanel';
import TriageTransfersPanel from './TriageTransfersPanel';
import { MOBILE } from '../lib/mobileUi';
import { syncTransferWorkflowRemote } from '../lib/transferWorkflow';

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
  ].join('');
}

const fontFamily = Platform.select({
  ios: 'Sohne',
  android: 'Sohne',
  default: 'Sohne',
});

const TEXT = '#1d1d1f';
const SECONDARY = '#8e8e93';

/** Drop cached transaction rows so nothing outlives the session that loaded them. */
export function clearTriageCache() {}

const TRIAGE_TABS = [
  { key: 'transfers', label: 'Dashboard', icon: 'grid-outline' },
  { key: 'accuracy', label: 'Accuracy', icon: 'checkmark-done-outline' },
  { key: 'allocation', label: 'Allocation', icon: 'git-branch-outline' },
];

function IosTextAction({ label, onPress, accessibilityLabel }) {
  return (
    <Pressable
      style={styles.iosTextAction}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || label}
    >
      <Ionicons name="add" size={18} color={MOBILE.blue} />
      <Text style={styles.iosTextActionLabel}>{label}</Text>
    </Pressable>
  );
}

function TabBar({ options, value, onChange, trailing }) {
  return (
    <View style={styles.tabBar} accessibilityRole="tablist">
      <View style={styles.textTabs}>
        {options.map((option) => {
          const active = option.key === value;
          return (
            <Pressable
              key={option.key}
              style={styles.textTab}
              onPress={() => onChange(option.key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={option.label}
            >
              <Text style={[styles.textTabLabel, active && styles.textTabLabelActive]} numberOfLines={1}>
                {option.label}
              </Text>
              <View style={[styles.textTabLine, active && styles.textTabLineActive]} />
            </Pressable>
          );
        })}
      </View>
      {trailing ? <View style={styles.tabBarTrailing}>{trailing}</View> : null}
    </View>
  );
}

function TabPanel({ tab }) {
  return (
    <View style={styles.panel}>
      <Ionicons name={tab.icon} size={40} color={SECONDARY} />
      <Text style={styles.emptyTitle}>{tab.label}</Text>
      <Text style={styles.emptyBody}>Nothing to review in {tab.label.toLowerCase()} yet.</Text>
    </View>
  );
}

export default function TriageScreen({
  session,
  onRequireLogin,
  storeFilter,
  embedded = false,
  onStoreBackChange,
}) {
  const [activeTab, setActiveTab] = useState('transfers');
  const [createTransferOpen, setCreateTransferOpen] = useState(false);
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

  const changeTab = useCallback((key) => {
    if (key === 'transfers' && leaveStoreRef.current) {
      leaveStoreRef.current();
    } else if (key !== 'transfers') {
      leaveStoreRef.current?.();
    }
    setActiveTab(key);
    setCreateTransferOpen(false);
  }, []);

  const handleBackChange = useCallback((fn, context) => {
    leaveStoreRef.current = fn;
    setCanLeaveStore(Boolean(fn));
    setBatchContext(context || null);
    onStoreBackChangeRef.current?.(fn, context || null);
  }, []);

  const transferTrailing =
    session?.token && activeTab === 'transfers' && transferView === 'list' ? (
      <IosTextAction label="New" onPress={() => setCreateTransferOpen(true)} />
    ) : session?.token && activeTab === 'transfers' && canLeaveStore && !onStoreBackChange && batchContext ? (
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
    <View style={[styles.body, embedded && styles.bodyEmbedded, styles.bodyTinted]}>
      <TabBar
        options={TRIAGE_TABS}
        value={activeTab}
        onChange={changeTab}
        trailing={transferTrailing}
      />

      <View style={activeTab === 'transfers' ? styles.pageVisible : styles.pageHidden}>
        <TriageTransfersPanel
          session={session}
          onRequireLogin={onRequireLogin}
          createOpen={createTransferOpen}
          onCreateOpenChange={setCreateTransferOpen}
          onViewChange={setTransferView}
          onBackChange={handleBackChange}
        />
      </View>

      {activeTab === 'accuracy' ? (
        <TriageAccuracyPanel session={session} storeFilter={storeFilter} />
      ) : activeTab !== 'transfers' ? (
        <TabPanel tab={currentTab} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    minHeight: 0,
  },
  bodyEmbedded: {
    flex: 1,
    minHeight: 0,
    width: '100%',
    maxWidth: '100%',
  },
  bodyTinted: {
    backgroundColor: MOBILE.bg,
  },
  bodyMobile: {
    backgroundColor: MOBILE.bg,
  },
  tabBar: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 4,
    backgroundColor: MOBILE.bg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: MOBILE.separator,
  },
  tabBarTrailing: {
    flexShrink: 0,
    paddingBottom: 6,
  },
  textTabs: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 16,
  },
  textTab: {
    paddingTop: 6,
    alignItems: 'center',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  textTabLabel: {
    fontFamily,
    fontSize: 13,
    fontWeight: '400',
    color: MOBILE.secondary,
    letterSpacing: -0.2,
  },
  textTabLabelActive: {
    fontWeight: '600',
    color: MOBILE.blue,
  },
  textTabLine: {
    marginTop: 6,
    height: 2,
    alignSelf: 'stretch',
    borderRadius: 1,
    backgroundColor: 'transparent',
  },
  textTabLineActive: {
    backgroundColor: MOBILE.blue,
  },
  iosTextAction: {
    minHeight: 28,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 2,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  iosTextActionLabel: {
    fontFamily,
    fontSize: 15,
    fontWeight: '400',
    color: MOBILE.blue,
  },
  batchTitle: {
    maxWidth: 220,
    alignItems: 'flex-end',
  },
  batchTitleDate: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: TEXT,
    letterSpacing: -0.2,
    textAlign: 'right',
  },
  batchTitleStores: {
    fontFamily,
    fontSize: 11,
    fontWeight: '400',
    color: SECONDARY,
    textAlign: 'right',
  },
  pageVisible: {
    flex: 1,
    minHeight: 0,
  },
  pageHidden: {
    display: 'none',
  },
  panel: {
    flex: 1,
    minHeight: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 24,
    paddingBottom: 48,
  },
  emptyTitle: {
    fontFamily,
    fontSize: 22,
    fontWeight: '600',
    color: TEXT,
    letterSpacing: -0.4,
  },
  emptyBody: {
    fontFamily,
    fontSize: 15,
    lineHeight: 21,
    color: SECONDARY,
    textAlign: 'center',
    maxWidth: 320,
  },
});
