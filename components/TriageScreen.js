import { useCallback, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import TriageAccuracyPanel from './TriageAccuracyPanel';
import TriageTransfersPanel from './TriageTransfersPanel';
import { MOBILE } from '../lib/mobileUi';

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
const BLUE = MOBILE.blue;

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
      <Ionicons name="add" size={22} color={MOBILE.blue} />
      <Text style={styles.iosTextActionLabel}>{label}</Text>
    </Pressable>
  );
}

function TabBar({ options, value, onChange, trailing }) {
  return (
    <View style={styles.tabBar} accessibilityRole="tablist">
      <View style={styles.segment}>
        {options.map((option) => {
          const active = option.key === value;
          return (
            <Pressable
              key={option.key}
              style={[styles.segmentButton, active && styles.segmentButtonActive]}
              onPress={() => onChange(option.key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={option.label}
            >
              <Text style={[styles.segmentText, active && styles.segmentTextActive]} numberOfLines={1}>
                {option.label}
              </Text>
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
  const leaveStoreRef = useRef(null);
  const currentTab = TRIAGE_TABS.find((tab) => tab.key === activeTab) || TRIAGE_TABS[0];

  const changeTab = useCallback((key) => {
    setActiveTab(key);
    setCreateTransferOpen(false);
  }, []);

  const handleBackChange = useCallback((fn) => {
    leaveStoreRef.current = fn;
    setCanLeaveStore(Boolean(fn));
    onStoreBackChange?.(fn);
  }, [onStoreBackChange]);

  const transferTrailing =
    session?.token && activeTab === 'transfers' && transferView === 'list' ? (
      <IosTextAction label="New" onPress={() => setCreateTransferOpen(true)} />
    ) : session?.token && activeTab === 'transfers' && canLeaveStore && !onStoreBackChange ? (
      <Pressable
        style={styles.titleBack}
        onPress={() => leaveStoreRef.current?.()}
        accessibilityRole="button"
        accessibilityLabel="Back to transfers"
      >
        <Ionicons name="chevron-back" size={22} color={BLUE} />
        <Text style={styles.titleBackText}>Transfers</Text>
      </Pressable>
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
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 8,
    backgroundColor: MOBILE.bg,
  },
  tabBarTrailing: {
    flexShrink: 0,
  },
  segment: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    height: 36,
    backgroundColor: 'rgba(118,118,128,0.12)',
    borderRadius: 9,
    padding: 2,
  },
  segmentButton: {
    flex: 1,
    height: 32,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  segmentButtonActive: {
    backgroundColor: '#fff',
    ...Platform.select({
      web: { boxShadow: '0 1px 2px rgba(0,0,0,0.16)' },
      default: { elevation: 1 },
    }),
  },
  segmentText: {
    fontFamily,
    fontSize: 13,
    fontWeight: '500',
    color: MOBILE.label,
    letterSpacing: -0.2,
  },
  segmentTextActive: {
    fontWeight: '600',
  },
  iosTextAction: {
    minHeight: 44,
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
    fontSize: 17,
    fontWeight: '400',
    color: MOBILE.blue,
  },
  titleBack: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 2,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  titleBackText: {
    fontFamily,
    fontSize: 17,
    fontWeight: '400',
    color: BLUE,
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
