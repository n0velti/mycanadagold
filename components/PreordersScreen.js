import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

const fontFamily = Platform.select({
  ios: 'Sohne',
  android: 'Sohne',
  default: 'Sohne',
});

const SECONDARY = '#8e8e93';
const HAIRLINE = '#e6e6e6';

const TABS = [
  {
    key: 'open',
    label: 'Open',
    empty: 'Customer deposits waiting on product will appear here.',
  },
  {
    key: 'arrived',
    label: 'Arrived',
    empty: 'Preorders whose stock has landed, ready to fulfill.',
  },
  {
    key: 'fulfilled',
    label: 'Fulfilled',
    empty: 'Completed preorders will be listed here.',
  },
];

function TabBar({ options, value, onChange }) {
  return (
    <View style={styles.tabBar} accessibilityRole="tablist">
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
  );
}

export default function PreordersScreen({ storeFilter = '', embedded = false }) {
  const [activeTab, setActiveTab] = useState('open');
  const tab = TABS.find((item) => item.key === activeTab) || TABS[0];
  const storeName = String(storeFilter || '').trim();
  const empty = storeName
    ? `No ${tab.label.toLowerCase()} preorders at ${storeName}.`
    : tab.empty;

  return (
    <View style={[styles.screen, embedded && styles.screenEmbedded]}>
      <TabBar options={TABS} value={activeTab} onChange={setActiveTab} />
      <Text style={styles.emptyText}>{empty}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: 'rgb(252, 252, 251)',
  },
  screenEmbedded: {
    backgroundColor: 'transparent',
  },
  tabBar: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'stretch',
    paddingHorizontal: 8,
    marginTop: 8,
    marginBottom: 8,
    width: '100%',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HAIRLINE,
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
    borderBottomColor: '#1a1a1a',
  },
  tabLabel: {
    fontFamily,
    fontSize: 13,
    fontWeight: '400',
    color: SECONDARY,
    letterSpacing: -0.08,
    textTransform: 'uppercase',
  },
  tabLabelActive: {
    color: '#1a1a1a',
    fontWeight: '600',
  },
  emptyText: {
    fontFamily,
    fontSize: 13,
    color: SECONDARY,
    paddingHorizontal: 8,
    paddingVertical: 28,
  },
});
