import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { textMatchesQuery } from '../lib/itemSearch';
import { useLiveRefresh } from '../lib/liveRefresh';
import { fetchWebsitePrices } from '../lib/websitePrices';

const fontFamily = Platform.select({
  ios: 'Sohne',
  android: 'Sohne',
  default: 'Sohne',
});

const ACCENT = '#A67C2D';
const LABEL = '#1d1d1f';
const SECONDARY = '#8e8e93';
const FILL = 'rgba(118, 118, 128, 0.12)';
const HAIRLINE = '#e6e6e6';
const BLUE = '#007AFF';

const TABS = [
  { key: 'buy', label: 'What we buy' },
  { key: 'sell', label: 'What we sell' },
];

const PRICE_LIVE_MS = 60 * 1000;

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

function SearchField({ value, onChangeText }) {
  return (
    <View style={styles.searchField}>
      <Ionicons name="search" size={16} color={SECONDARY} />
      <TextInput
        style={styles.searchInput}
        value={value}
        onChangeText={onChangeText}
        placeholder="Search items"
        placeholderTextColor={SECONDARY}
        autoCorrect={false}
        autoCapitalize="none"
        clearButtonMode="while-editing"
        returnKeyType="search"
        accessibilityLabel="Search prices"
      />
      {value ? (
        <Pressable onPress={() => onChangeText('')} hitSlop={8} accessibilityLabel="Clear">
          <Ionicons name="close-circle" size={16} color={SECONDARY} />
        </Pressable>
      ) : null}
    </View>
  );
}

function itemMatches(item, query) {
  if (!query.trim()) return true;
  const hay = [item.name, item.price, item.buyPrice, item.badge, ...(item.tiers || []).flatMap((tier) => [tier.label, tier.price])]
    .filter(Boolean)
    .join(' ');
  return textMatchesQuery(hay, query);
}

function filterCatalogSide(side, query, sectionFilter) {
  if (!side) return { spots: [], sections: [], count: 0 };
  const sections = [];
  let count = 0;
  for (const section of side.sections || []) {
    const group = section.group || section.title;
    if (sectionFilter && group !== sectionFilter && section.title !== sectionFilter) continue;
    const items = (section.items || []).filter((item) => itemMatches(item, query));
    if (!items.length) continue;
    sections.push({ ...section, group, items });
    count += items.length;
  }
  return { spots: side.spots || [], sections, count };
}

function SpotStrip({ spots }) {
  if (!spots.length) return null;
  return (
    <View style={styles.spotRow}>
      {spots.map((spot) => (
        <View key={spot.metal} style={styles.spotChip}>
          <Text style={styles.spotMetal}>{spot.metal}</Text>
          <Text style={styles.spotPrice}>{spot.price}</Text>
        </View>
      ))}
    </View>
  );
}

function BuyRow({ item }) {
  return (
    <View style={styles.row} {...(Platform.OS === 'web' ? { className: 'cgold-filter-option' } : null)}>
      <Text style={styles.itemName}>{item.name}</Text>
      <Text style={styles.itemPrice}>{item.price}</Text>
    </View>
  );
}

function SellPills({ tiers }) {
  return (
    <View style={styles.pillWrap}>
      {(tiers || []).map((tier, index) => (
        <View key={`${tier.label}-${tier.price}`} style={[styles.pill, index === 0 ? styles.pillGreen : styles.pillGold]}>
          <Text style={[styles.pillText, index === 0 ? styles.pillTextGreen : styles.pillTextGold]}>
            {tier.label}: {tier.price} each
          </Text>
        </View>
      ))}
    </View>
  );
}

function SellHeader({ compact }) {
  if (compact) return null;
  return (
    <View style={styles.sellHeader}>
      <Text style={[styles.sellHeadLabel, styles.sellNameCol]}>Item</Text>
      <View style={styles.sellCols}>
        <Text style={[styles.sellHeadLabel, styles.sellBuyCol]}>We Buy</Text>
        <Text style={[styles.sellHeadLabel, styles.sellSellCol]}>We Sell</Text>
      </View>
    </View>
  );
}

function SellRow({ item, compact }) {
  return (
    <View
      style={[styles.sellRow, compact && styles.sellRowCompact]}
      {...(Platform.OS === 'web' ? { className: 'cgold-filter-option' } : null)}
    >
      <View style={[styles.sellNameCol, compact && styles.sellNameColCompact]}>
        <Text style={styles.itemName}>{item.name}</Text>
        {item.badge ? <Text style={styles.badge}>{item.badge}</Text> : null}
      </View>
      <View style={[styles.sellCols, compact && styles.sellColsCompact]}>
        <View style={compact ? styles.compactPriceBlock : styles.sellBuyCol}>
          {compact ? <Text style={styles.compactLabel}>We Buy</Text> : null}
          <Text style={[styles.itemPrice, !compact && styles.sellBuyAlign]}>{item.buyPrice || '—'}</Text>
        </View>
        <View style={compact ? styles.compactPriceBlock : styles.sellSellCol}>
          {compact ? <Text style={styles.compactLabel}>We Sell</Text> : null}
          <SellPills tiers={item.tiers} />
        </View>
      </View>
    </View>
  );
}

export default function PricingScreen() {
  const [activeTab, setActiveTab] = useState('buy');
  const [query, setQuery] = useState('');
  const [sectionFilter, setSectionFilter] = useState('');
  const { width } = useWindowDimensions();
  const compactSell = width < 760;
  const [catalog, setCatalog] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async ({ force = false, silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const next = await fetchWebsitePrices({ force });
      setCatalog(next);
      setError('');
    } catch (err) {
      setError(err?.message || 'Could not load Canada Gold prices.');
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useLiveRefresh((options) => load({ ...options, force: true }), PRICE_LIVE_MS, true);

  useEffect(() => {
    setSectionFilter('');
    setQuery('');
  }, [activeTab]);

  const side = activeTab === 'sell' ? catalog?.sell : catalog?.buy;
  const filtered = useMemo(
    () => filterCatalogSide(side, query, sectionFilter),
    [side, query, sectionFilter],
  );
  const sectionTitles = useMemo(() => {
    const seen = new Set();
    const titles = [];
    for (const section of side?.sections || []) {
      const title = section.group || section.title;
      if (seen.has(title)) continue;
      seen.add(title);
      titles.push(title);
    }
    return titles;
  }, [side]);

  return (
    <View style={styles.screen}>
      <TabBar options={TABS} value={activeTab} onChange={setActiveTab} />

      <View style={styles.toolbar}>
        <SearchField value={query} onChangeText={setQuery} />
        <Pressable
          onPress={() => load({ force: true })}
          disabled={loading}
          hitSlop={8}
          style={styles.refresh}
          accessibilityLabel="Refresh prices"
        >
          {loading ? (
            <ActivityIndicator size="small" color={BLUE} />
          ) : (
            <Ionicons name="refresh" size={16} color={SECONDARY} />
          )}
        </Pressable>
      </View>

      <View style={styles.metaRow}>
        <Text style={styles.meta} numberOfLines={1}>
          {catalog?.updated ? `Updated ${catalog.updated}` : 'Live from canadagold.ca'}
          {filtered.count ? ` · ${filtered.count} items` : ''}
          {' · CAD'}
        </Text>
      </View>

      {error ? (
        <Pressable style={styles.banner} onPress={() => load({ force: true })}>
          <Text style={styles.errorText}>{error} · Tap to retry</Text>
        </Pressable>
      ) : catalog?.warning ? (
        <Text style={styles.warningText}>{catalog.warning}</Text>
      ) : null}

      {sectionTitles.length > 1 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
          style={styles.chipScroll}
        >
          <Pressable
            onPress={() => setSectionFilter('')}
            style={[styles.chip, !sectionFilter && styles.chipActive]}
          >
            <Text style={[styles.chipText, !sectionFilter && styles.chipTextActive]}>All</Text>
          </Pressable>
          {sectionTitles.map((title) => {
            const active = sectionFilter === title;
            return (
              <Pressable
                key={title}
                onPress={() => setSectionFilter(active ? '' : title)}
                style={[styles.chip, active && styles.chipActive]}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{title}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}

      {loading && !catalog ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={ACCENT} />
        </View>
      ) : (
        <ScrollView
          style={styles.list}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {!query.trim() && !sectionFilter ? <SpotStrip spots={filtered.spots} /> : null}

          {filtered.sections.length === 0 ? (
            <Text style={styles.emptyText}>{query.trim() ? 'No matching items.' : 'No prices loaded.'}</Text>
          ) : (
            filtered.sections.map((section) => (
              <View key={`${section.group}-${section.title}`} style={styles.section}>
                <Text style={styles.sectionTitle}>
                  {section.group && section.group !== section.title
                    ? `${section.group} · ${section.title}`
                    : section.title}
                </Text>
                <View style={styles.card}>
                  {activeTab === 'sell' ? <SellHeader compact={compactSell} /> : null}
                  {section.items.map((item) =>
                    activeTab === 'sell' ? (
                      <SellRow key={item.name} item={item} compact={compactSell} />
                    ) : (
                      <BuyRow key={item.name} item={item} />
                    ),
                  )}
                </View>
              </View>
            ))
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    minHeight: 0,
    backgroundColor: '#f2f2f7',
  },
  tabBar: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'stretch',
    paddingHorizontal: 16,
    marginTop: 4,
    backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HAIRLINE,
  },
  tab: {
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 12,
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
    color: LABEL,
    fontWeight: '600',
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 6,
  },
  searchField: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 36,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: FILL,
  },
  searchInput: {
    flex: 1,
    fontFamily,
    fontSize: 17,
    fontWeight: '400',
    color: LABEL,
    paddingVertical: 8,
    ...Platform.select({
      web: { outlineStyle: 'none' },
      default: {},
    }),
  },
  refresh: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: FILL,
  },
  metaRow: {
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  meta: {
    fontFamily,
    fontSize: 12,
    color: SECONDARY,
  },
  banner: {
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  errorText: {
    fontFamily,
    fontSize: 13,
    color: '#FF3B30',
  },
  warningText: {
    fontFamily,
    fontSize: 13,
    color: '#B45309',
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  chipScroll: {
    flexGrow: 0,
    flexShrink: 0,
  },
  chipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 16,
    backgroundColor: FILL,
  },
  chipActive: {
    backgroundColor: LABEL,
  },
  chipText: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: LABEL,
    letterSpacing: -0.08,
  },
  chipTextActive: {
    color: '#fff',
  },
  list: {
    flex: 1,
    minHeight: 0,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 32,
    gap: 14,
  },
  spotRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  spotChip: {
    minWidth: 120,
    flexGrow: 1,
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  spotMetal: {
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
    color: SECONDARY,
    marginBottom: 4,
  },
  spotPrice: {
    fontFamily,
    fontSize: 18,
    fontWeight: '600',
    color: LABEL,
    letterSpacing: -0.3,
  },
  section: {
    gap: 8,
  },
  sectionTitle: {
    fontFamily,
    fontSize: 13,
    fontWeight: '700',
    color: SECONDARY,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    paddingHorizontal: 4,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HAIRLINE,
  },
  sellHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: '#f3f3f6',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HAIRLINE,
  },
  sellHeadLabel: {
    fontFamily,
    fontSize: 13,
    fontWeight: '700',
    color: '#1f3b5b',
  },
  sellRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HAIRLINE,
  },
  sellNameCol: {
    flex: 1.4,
    minWidth: 140,
    gap: 4,
  },
  sellBuyCol: {
    width: 88,
    flexShrink: 0,
  },
  sellBuyAlign: {
    textAlign: 'left',
  },
  sellSellCol: {
    flex: 1.2,
    minWidth: 160,
  },
  sellCols: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1.2,
  },
  sellRowCompact: {
    flexDirection: 'column',
    alignItems: 'stretch',
  },
  sellNameColCompact: {
    minWidth: 0,
  },
  sellColsCompact: {
    flex: 0,
    alignItems: 'flex-start',
  },
  compactPriceBlock: {
    gap: 4,
    minWidth: 120,
  },
  compactLabel: {
    fontFamily,
    fontSize: 11,
    fontWeight: '700',
    color: '#1f3b5b',
  },
  itemName: {
    flex: 1,
    fontFamily,
    fontSize: 15,
    fontWeight: '500',
    color: LABEL,
    letterSpacing: -0.2,
  },
  itemPrice: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: LABEL,
    letterSpacing: -0.2,
    textAlign: 'right',
  },
  badge: {
    fontFamily,
    fontSize: 11,
    fontWeight: '600',
    color: ACCENT,
  },
  pillWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  pill: {
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  pillGreen: {
    backgroundColor: '#E3F4E8',
  },
  pillGold: {
    backgroundColor: '#F4E8D2',
  },
  pillText: {
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
  },
  pillTextGreen: {
    color: '#1F7A3E',
  },
  pillTextGold: {
    color: '#8A6A2F',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    fontFamily,
    fontSize: 15,
    color: SECONDARY,
    textAlign: 'center',
    paddingVertical: 32,
  },
});
