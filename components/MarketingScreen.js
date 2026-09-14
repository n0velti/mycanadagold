import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const fontFamily = Platform.select({
  ios: 'Sohne',
  android: 'Sohne',
  default: 'Sohne',
});

const ACCENT = '#DB2777';
const HAIRLINE = '#e6e6e6';

const TABS = [
  {
    key: 'campaigns',
    label: 'Campaigns',
    icon: 'megaphone-outline',
    empty: 'Seasonal offers, store events, and paid campaigns will be planned here.',
  },
  {
    key: 'promotions',
    label: 'Promotions',
    icon: 'pricetag-outline',
    empty: 'Price promotions and featured product pushes will appear here.',
  },
  {
    key: 'assets',
    label: 'Assets',
    icon: 'images-outline',
    empty: 'Brand photos, copy decks, and social creatives will be stored here.',
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

export default function MarketingScreen() {
  const [activeTab, setActiveTab] = useState('campaigns');
  const tab = TABS.find((item) => item.key === activeTab) || TABS[0];

  return (
    <View style={styles.screen}>
      <TabBar options={TABS} value={activeTab} onChange={setActiveTab} />
      <View style={styles.emptyPanel}>
        <View style={styles.emptyIcon}>
          <Ionicons name={tab.icon} size={22} color={ACCENT} />
        </View>
        <Text style={styles.emptyTitle}>{tab.label}</Text>
        <Text style={styles.emptyBody}>{tab.empty}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#fff',
  },
  tabBar: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'stretch',
    paddingHorizontal: 20,
    marginTop: 8,
    marginBottom: 8,
    maxWidth: 860,
    width: '100%',
    alignSelf: 'center',
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
    borderBottomColor: ACCENT,
  },
  tabLabel: {
    fontFamily,
    fontSize: 15,
    fontWeight: '500',
    color: '#6b6b6b',
    letterSpacing: -0.2,
  },
  tabLabelActive: {
    color: '#1a1a1a',
    fontWeight: '600',
  },
  emptyPanel: {
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
    backgroundColor: '#FDF2F8',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  emptyTitle: {
    fontFamily,
    fontSize: 20,
    fontWeight: '600',
    color: '#1a1a1a',
    letterSpacing: -0.3,
    marginBottom: 6,
  },
  emptyBody: {
    fontFamily,
    fontSize: 15,
    lineHeight: 21,
    color: '#6b6b6b',
    textAlign: 'center',
    maxWidth: 320,
  },
});
