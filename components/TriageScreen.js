import { useCallback, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import TriageAccuracyPanel from './TriageAccuracyPanel';
import TriageTransfersPanel from './TriageTransfersPanel';
import { MOBILE, useIsMobile } from '../lib/mobileUi';

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
    '.cgold-triage-row-selected,.cgold-triage-row-selected:hover{background-color:#FFF7ED!important;}',
  ].join('');
}

const fontFamily = Platform.select({
  ios: 'Sohne',
  android: 'Sohne',
  default: 'Sohne',
});

const ACCENT = '#C2410C';
const TEXT = '#1d1d1f';
const SECONDARY = '#8e8e93';
const HAIRLINE = '#e5e5ea';

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

function TabBar({ options, value, onChange, trailing, mobile }) {
  if (mobile) {
    return (
      <View style={styles.tabBarMobile}>
        <View style={styles.segment} accessibilityRole="tablist">
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
        {trailing ? <View style={styles.tabBarMobileTrailing}>{trailing}</View> : null}
      </View>
    );
  }

  return (
    <View style={styles.tabBar} accessibilityRole="tablist">
      <View style={styles.tabBarTabs}>
        {options.map((option) => {
          const active = option.key === value;
          return (
            <Pressable
              key={option.key}
              style={[styles.tab, active && styles.tabActive]}
              onPress={() => onChange(option.key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={option.label}
            >
              <Text style={[styles.tabLabel, active && styles.tabLabelActive]} numberOfLines={1}>
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
      <View style={styles.emptyIcon}>
        <Ionicons name={tab.icon} size={22} color={ACCENT} />
      </View>
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
  const isMobile = useIsMobile();
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
      isMobile ? (
        <IosTextAction label="New" onPress={() => setCreateTransferOpen(true)} />
      ) : (
        <Pressable
          style={styles.newButton}
          onPress={() => setCreateTransferOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="New"
        >
          <Ionicons name="add" size={18} color="#fff" />
          <Text style={styles.newButtonText}>New</Text>
        </Pressable>
      )
    ) : session?.token && activeTab === 'transfers' && canLeaveStore && !onStoreBackChange ? (
      <Pressable
        style={styles.titleBack}
        onPress={() => leaveStoreRef.current?.()}
        accessibilityRole="button"
        accessibilityLabel="Back to transfers"
      >
        <Ionicons name="chevron-back" size={isMobile ? 22 : 18} color={ACCENT} />
        <Text style={styles.titleBackText}>Transfers</Text>
      </Pressable>
    ) : null;

  return (
    <View style={[styles.body, embedded && styles.bodyEmbedded, isMobile && styles.bodyMobile]}>
      <TabBar
        options={TRIAGE_TABS}
        value={activeTab}
        onChange={changeTab}
        trailing={transferTrailing}
        mobile={isMobile}
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
  bodyMobile: {
    backgroundColor: MOBILE.bg,
  },
  tabBarMobile: {
    flexShrink: 0,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 8,
    gap: 8,
    backgroundColor: MOBILE.bg,
  },
  tabBarMobileTrailing: {
    alignItems: 'flex-end',
  },
  segment: {
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
    fontSize: 15,
    fontWeight: '600',
    color: ACCENT,
  },
  pageVisible: {
    flex: 1,
    minHeight: 0,
  },
  pageHidden: {
    display: 'none',
  },
  tabBar: {
    flexShrink: 0,
    marginTop: 22,
    marginBottom: 14,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HAIRLINE,
  },
  tabBarTabs: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 2,
  },
  tabBarTrailing: {
    flexShrink: 0,
    paddingBottom: 6,
  },
  tab: {
    paddingHorizontal: 14,
    paddingTop: 6,
    paddingBottom: 11,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
    marginBottom: -StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  tabActive: {
    borderBottomColor: ACCENT,
  },
  tabLabel: {
    fontFamily,
    fontSize: 15,
    fontWeight: '500',
    color: SECONDARY,
    letterSpacing: -0.2,
  },
  tabLabelActive: {
    color: TEXT,
    fontWeight: '600',
  },
  panel: {
    flex: 1,
    minHeight: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingBottom: 48,
  },
  emptyIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: '#FFEDD5',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  emptyTitle: {
    fontFamily,
    fontSize: 20,
    fontWeight: '600',
    color: TEXT,
    letterSpacing: -0.3,
    marginBottom: 6,
  },
  emptyBody: {
    fontFamily,
    fontSize: 15,
    lineHeight: 21,
    color: SECONDARY,
    textAlign: 'center',
    maxWidth: 320,
  },
  newButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: ACCENT,
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 32,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  newButtonText: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },
});
