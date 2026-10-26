import { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useIsMobile } from '../lib/mobileUi';
import {
  ACTIONS,
  CATALOG,
  DESK_CARDS,
  NUMISMATIC_TABS,
  catalogGroups,
  filterCatalog,
} from '../lib/numismaticCatalog';

const fontFamily = Platform.select({
  ios: 'Sohne',
  android: 'Sohne',
  default: 'Sohne',
});

const ACCENT = '#B45309';
const LABEL = '#1d1d1f';
const SECONDARY = '#8e8e93';
const FILL = 'rgba(118, 118, 128, 0.12)';
const HAIRLINE = '#e6e6e6';
const ACTION_TONE = {
  quote: { bg: '#FEF3C7', fg: '#92400E' },
  weigh: { bg: '#ECFDF5', fg: '#047857' },
  check: { bg: '#EEF4FF', fg: '#1D4ED8' },
  face: { bg: '#F4F4F5', fg: '#52525B' },
  melt: { bg: '#F7F0EA', fg: '#8A5A3A' },
};

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
        placeholder="Year, denomination, or variety"
        placeholderTextColor={SECONDARY}
        autoCorrect={false}
        autoCapitalize="none"
        clearButtonMode="while-editing"
        returnKeyType="search"
        accessibilityLabel="Search coins and notes"
      />
      {value ? (
        <Pressable onPress={() => onChangeText('')} hitSlop={8} accessibilityLabel="Clear">
          <Ionicons name="close-circle" size={16} color={SECONDARY} />
        </Pressable>
      ) : null}
    </View>
  );
}

function ActionBadge({ action }) {
  const meta = ACTIONS[action];
  const tone = ACTION_TONE[action] || ACTION_TONE.check;
  if (!meta) return null;
  return (
    <View style={[styles.badge, { backgroundColor: tone.bg }]}>
      <Text style={[styles.badgeText, { color: tone.fg }]}>{meta.label}</Text>
    </View>
  );
}

function SeriesRow({ item, selected, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ hovered, pressed }) => [
        styles.row,
        (hovered || pressed) && !selected && styles.rowHover,
        selected && styles.rowSelected,
      ]}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={item.name}
    >
      <View style={styles.rowMain}>
        <Text style={styles.itemName}>{item.name}</Text>
        <Text style={styles.itemMeta} numberOfLines={1}>
          {item.years}
          {item.composition ? ` · ${item.composition}` : ''}
        </Text>
      </View>
      <ActionBadge action={item.action} />
    </Pressable>
  );
}

function DetailBody({ item }) {
  if (!item) {
    return <Text style={styles.emptyText}>Select a series.</Text>;
  }
  const action = ACTIONS[item.action];
  return (
    <View style={styles.detailInner}>
      <View style={styles.detailHead}>
        <View style={styles.detailTitleBlock}>
          <Text style={styles.detailKicker}>{item.group}</Text>
          <Text style={styles.detailTitle}>{item.name}</Text>
          <Text style={styles.detailYears}>{item.years}</Text>
        </View>
        <ActionBadge action={item.action} />
      </View>
      {action ? <Text style={styles.detailHint}>{action.hint}</Text> : null}

      <View style={styles.factBlock}>
        <Text style={styles.factLabel}>Composition</Text>
        <Text style={styles.factValue}>{item.composition}</Text>
      </View>

      {item.keyDates?.length ? (
        <View style={styles.factBlock}>
          <Text style={styles.factLabel}>Key dates</Text>
          <View style={styles.keyWrap}>
            {item.keyDates.map((date) => (
              <View key={date} style={styles.keyChip}>
                <Text style={styles.keyChipText}>{date}</Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      <View style={styles.factBlock}>
        <Text style={styles.factLabel}>Floor note</Text>
        <Text style={styles.factValue}>{item.note}</Text>
      </View>
    </View>
  );
}

function GroupedList({ items, selectedId, onSelect }) {
  const sections = useMemo(() => {
    const byGroup = [];
    const index = new Map();
    for (const item of items) {
      let section = index.get(item.group);
      if (!section) {
        section = { group: item.group, items: [] };
        index.set(item.group, section);
        byGroup.push(section);
      }
      section.items.push(item);
    }
    return byGroup;
  }, [items]);

  if (!items.length) {
    return <Text style={styles.emptyText}>No matching series.</Text>;
  }

  return sections.map((section) => (
    <View key={section.group} style={styles.section}>
      <Text style={styles.sectionTitle}>{section.group}</Text>
      <View style={styles.card}>
        {section.items.map((item) => (
          <SeriesRow
            key={item.id}
            item={item}
            selected={item.id === selectedId}
            onPress={() => onSelect(item)}
          />
        ))}
      </View>
    </View>
  ));
}

function DeskList() {
  return (
    <View style={styles.deskList}>
      {DESK_CARDS.map((card) => (
        <View key={card.id} style={styles.deskCard}>
          <Text style={styles.deskTitle}>{card.title}</Text>
          <Text style={styles.deskBody}>{card.body}</Text>
        </View>
      ))}
    </View>
  );
}

export default function NumismaticScreen() {
  const isMobile = useIsMobile();
  const [tab, setTab] = useState('coins');
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState('');
  const [selectedId, setSelectedId] = useState(CATALOG[0]?.id || '');
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setQuery('');
    setGroup('');
    setMobileOpen(false);
  }, [tab]);

  const groups = useMemo(() => catalogGroups(tab), [tab]);
  const items = useMemo(() => filterCatalog(tab, query, group), [tab, query, group]);
  const selected = useMemo(
    () => items.find((item) => item.id === selectedId) || items[0] || null,
    [items, selectedId],
  );

  const selectItem = (item) => {
    setSelectedId(item.id);
    if (isMobile) setMobileOpen(true);
  };

  return (
    <View style={styles.screen}>
      <TabBar options={NUMISMATIC_TABS} value={tab} onChange={setTab} />

      {tab !== 'desk' ? (
        <>
          <View style={styles.toolbar}>
            <SearchField value={query} onChangeText={setQuery} />
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.meta} numberOfLines={1}>
              {items.length} series · years and compositions, not catalog prices
            </Text>
          </View>
          {groups.length > 1 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chipRow}
              style={styles.chipScroll}
            >
              <Pressable
                onPress={() => setGroup('')}
                style={[styles.chip, !group && styles.chipActive]}
              >
                <Text style={[styles.chipText, !group && styles.chipTextActive]}>All</Text>
              </Pressable>
              {groups.map((title) => {
                const active = group === title;
                return (
                  <Pressable
                    key={title}
                    onPress={() => setGroup(active ? '' : title)}
                    style={[styles.chip, active && styles.chipActive]}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>{title}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          ) : null}
        </>
      ) : (
        <View style={styles.metaRow}>
          <Text style={styles.meta}>When to weigh, when to quote, when to take a photo.</Text>
        </View>
      )}

      {tab === 'desk' ? (
        <ScrollView
          style={styles.list}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        >
          <DeskList />
        </ScrollView>
      ) : isMobile ? (
        <>
          <ScrollView
            style={styles.list}
            contentContainerStyle={styles.listContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <GroupedList items={items} selectedId={selected?.id} onSelect={selectItem} />
          </ScrollView>
          <Modal
            visible={mobileOpen && Boolean(selected)}
            animationType="slide"
            transparent
            onRequestClose={() => setMobileOpen(false)}
          >
            <View style={styles.sheetBackdrop}>
              <Pressable style={StyleSheet.absoluteFill} onPress={() => setMobileOpen(false)} />
              <View style={styles.sheet}>
                <View style={styles.sheetBar}>
                  <Text style={styles.sheetKicker}>Series</Text>
                  <Pressable onPress={() => setMobileOpen(false)} hitSlop={8} accessibilityLabel="Close">
                    <Ionicons name="close" size={22} color={LABEL} />
                  </Pressable>
                </View>
                <ScrollView
                  style={styles.sheetScroll}
                  contentContainerStyle={styles.sheetScrollContent}
                  showsVerticalScrollIndicator={false}
                >
                  <DetailBody item={selected} />
                </ScrollView>
              </View>
            </View>
          </Modal>
        </>
      ) : (
        <View style={styles.columns}>
          <ScrollView
            style={styles.listCol}
            contentContainerStyle={styles.listContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <GroupedList items={items} selectedId={selected?.id} onSelect={selectItem} />
          </ScrollView>
          <ScrollView
            style={styles.detailCol}
            contentContainerStyle={styles.detailContent}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.detailCard}>
              <DetailBody item={selected} />
            </View>
          </ScrollView>
        </View>
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
  metaRow: {
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  meta: {
    fontFamily,
    fontSize: 12,
    color: SECONDARY,
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
  columns: {
    flex: 1,
    minHeight: 0,
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  listCol: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
  },
  detailCol: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
  },
  detailContent: {
    paddingRight: 16,
    paddingBottom: 32,
  },
  detailCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    overflow: 'hidden',
    minHeight: 280,
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
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HAIRLINE,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  rowSelected: {
    backgroundColor: '#FFF7ED',
  },
  rowHover: {
    backgroundColor: 'rgba(60,60,67,0.04)',
  },
  rowMain: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  itemName: {
    fontFamily,
    fontSize: 16,
    fontWeight: '500',
    color: LABEL,
    letterSpacing: -0.2,
  },
  itemMeta: {
    fontFamily,
    fontSize: 13,
    color: SECONDARY,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  badgeText: {
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: -0.08,
  },
  emptyText: {
    fontFamily,
    fontSize: 15,
    color: SECONDARY,
    paddingHorizontal: 4,
    paddingTop: 12,
  },
  detailInner: {
    padding: 20,
    gap: 16,
  },
  detailHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  detailTitleBlock: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  detailKicker: {
    fontFamily,
    fontSize: 12,
    fontWeight: '700',
    color: SECONDARY,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  detailTitle: {
    fontFamily,
    fontSize: 22,
    fontWeight: '600',
    color: LABEL,
    letterSpacing: -0.4,
  },
  detailYears: {
    fontFamily,
    fontSize: 15,
    color: SECONDARY,
  },
  detailHint: {
    fontFamily,
    fontSize: 15,
    lineHeight: 21,
    color: LABEL,
  },
  factBlock: {
    gap: 6,
  },
  factLabel: {
    fontFamily,
    fontSize: 12,
    fontWeight: '700',
    color: SECONDARY,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  factValue: {
    fontFamily,
    fontSize: 15,
    lineHeight: 22,
    color: LABEL,
  },
  keyWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  keyChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: FILL,
  },
  keyChipText: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: LABEL,
  },
  deskList: {
    gap: 12,
  },
  deskCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 8,
  },
  deskTitle: {
    fontFamily,
    fontSize: 17,
    fontWeight: '600',
    color: LABEL,
    letterSpacing: -0.2,
  },
  deskBody: {
    fontFamily,
    fontSize: 15,
    lineHeight: 22,
    color: LABEL,
  },
  sheetBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.28)',
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: '86%',
    minHeight: 280,
  },
  sheetBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 8,
  },
  sheetKicker: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: SECONDARY,
  },
  sheetScroll: {
    flexGrow: 0,
  },
  sheetScrollContent: {
    paddingBottom: 28,
  },
});
