import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { FlashList } from '@shopify/flash-list';
import { fetchInventoryMatrix, formatQty, peekInventoryMatrix } from '../lib/inventory';
import { useLiveRefresh } from '../lib/liveRefresh';
import { textMatchesQuery } from '../lib/itemSearch';
import { useAppAccess } from '../lib/permissions';

const fontFamily = Platform.select({
  ios: 'Sohne',
  android: 'Sohne',
  default: 'Sohne',
});

const LABEL = '#1d1d1f';
const SECONDARY = '#8e8e93';
const FILL = 'rgba(118, 118, 128, 0.12)';
const SEPARATOR = '#e5e5ea';
const BLUE = '#007AFF';

const PRIORITY_COLORS = {
  green: '#34C759',
  yellow: '#FF9F0A',
  red: '#FF3B30',
};

const PRIORITY_LEGEND = [
  { key: 'green', label: '~95% in-stock' },
  { key: 'yellow', label: '~90%' },
  { key: 'red', label: '~80%' },
];

function shortStoreName(name) {
  const value = String(name || '').trim();
  if (value.length <= 12) return value;
  return value
    .replace(/\bRichmond Hill\b/i, 'Rich. Hill')
    .replace(/\bMississauga\b/i, 'Miss.')
    .replace(/\bCarlingwood\b/i, 'Carling.')
    .replace(/\bGloucester\b/i, 'Glouc.');
}

function systemLabel(key) {
  if (key === 'gta') return 'GTA';
  if (key === 'pmx') return 'PMX';
  return 'East';
}

function storeDisplayName(store, stores) {
  const name = String(store?.name || '').trim();
  const same = stores.filter(
    (item) =>
      String(item.name || '')
        .trim()
        .localeCompare(name, undefined, { sensitivity: 'base' }) === 0,
  );
  if (same.length <= 1) return name;
  return `${name} · ${systemLabel(store.systemKey)}`;
}

function storeMatchesQuery(store, query) {
  const q = String(query || '')
    .trim()
    .toLowerCase();
  if (!q) return true;
  const name = String(store?.name || '').toLowerCase();
  const short = shortStoreName(store?.name).toLowerCase();
  const system = systemLabel(store?.systemKey).toLowerCase();
  return name.includes(q) || short.includes(q) || system.includes(q);
}

function rowMatchesItem(row, query) {
  const q = String(query || '').trim();
  if (!q) return true;
  return textMatchesQuery(row?.name, q) || textMatchesQuery(row?.sku, q);
}

function storeBreakdown(row, stores) {
  const parts = [];
  for (const store of stores) {
    const qty = row.quantities[store.id] || 0;
    if (qty === 0) continue;
    parts.push(`${shortStoreName(store.name)} ${formatQty(qty)}`);
  }
  return parts.join('  ·  ');
}

function SearchField({ value, onChangeText, placeholder, accessibilityLabel }) {
  return (
    <View style={styles.searchField}>
      <Ionicons name="search" size={16} color={SECONDARY} />
      <TextInput
        style={styles.searchInput}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={SECONDARY}
        autoCorrect={false}
        autoCapitalize="none"
        clearButtonMode="while-editing"
        returnKeyType="search"
        accessibilityLabel={accessibilityLabel}
      />
      {value ? (
        <Pressable onPress={() => onChangeText('')} hitSlop={8} accessibilityLabel="Clear">
          <Ionicons name="close-circle" size={16} color={SECONDARY} />
        </Pressable>
      ) : null}
    </View>
  );
}

function InventoryRow({ row, stores, singleStore }) {
  const qty = singleStore ? row.quantities[stores[0].id] || 0 : row.total;
  const subtitle = singleStore
    ? row.sku || row.metal || ''
    : storeBreakdown(row, stores) || 'Out of stock';

  return (
    <View style={styles.itemRow}>
      {row.priority ? (
        <View style={[styles.priorityDot, { backgroundColor: PRIORITY_COLORS[row.priority] }]} />
      ) : (
        <View style={styles.priorityDotSpacer} />
      )}
      <View style={styles.itemCopy}>
        <Text style={styles.itemName} numberOfLines={1}>
          {row.name}
        </Text>
        {subtitle ? (
          <Text style={styles.itemSubtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <Text style={[styles.itemQty, qty === 0 && styles.itemQtyZero]} numberOfLines={1}>
        {qty === 0 ? '—' : formatQty(qty)}
      </Text>
    </View>
  );
}

export default function InventoryScreen({
  session,
  onRequireLogin,
  storeFilter,
  embedded = false,
}) {
  const { width: windowWidth } = useWindowDimensions();
  const isMobile = windowWidth < 768;
  const { canFilter } = useAppAccess();
  const allowFilters = canFilter('inventory');
  const lockedStore = Boolean(storeFilter);
  const [stores, setStores] = useState([]);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [itemQuery, setItemQuery] = useState('');
  const [storeQuery, setStoreQuery] = useState('');
  const [selectedStoreId, setSelectedStoreId] = useState(null);
  const [hideZeroRows, setHideZeroRows] = useState(true);
  const requestId = useRef(0);
  const hasDataRef = useRef(false);

  const load = useCallback(
    async ({ force = false, silent = false } = {}) => {
      if (!session?.token) {
        setStores([]);
        setRows([]);
        setError('');
        setWarning('');
        hasDataRef.current = false;
        return;
      }

      const id = ++requestId.current;
      const cached = !force ? peekInventoryMatrix(session) : null;
      if (cached) {
        setStores(cached.stores);
        setRows(cached.rows);
        setWarning(cached.warning || '');
        setError('');
        hasDataRef.current = true;
        setLoading(false);
        return;
      }

      if (!silent && (force || !hasDataRef.current)) setLoading(true);
      if (!silent) setError('');
      if (!silent && force) setWarning('');

      try {
        const result = await fetchInventoryMatrix(session, { force });
        if (id !== requestId.current) return;
        setStores(result.stores);
        setRows(result.rows);
        setWarning(result.warning || '');
        setError('');
        hasDataRef.current = true;
      } catch (err) {
        if (id !== requestId.current) return;
        if (silent && hasDataRef.current) return;
        if (!hasDataRef.current) {
          setStores([]);
          setRows([]);
        }
        setError(err?.message || 'Failed to load inventory.');
        if (!hasDataRef.current) setWarning('');
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    },
    [session],
  );

  useEffect(() => {
    load();
  }, [load]);

  useLiveRefresh(
    (opts) => load({ ...opts, force: true }),
    20_000,
    Boolean(session?.token),
  );

  useEffect(() => {
    setSelectedStoreId(null);
    setStoreQuery('');
  }, [storeFilter]);

  const lockedStores = useMemo(() => {
    if (!storeFilter) return stores;
    const target = String(storeFilter).trim();
    const matches = stores.filter(
      (store) =>
        String(store.name || '')
          .trim()
          .localeCompare(target, undefined, { sensitivity: 'base' }) === 0,
    );
    if (matches.length <= 1) return matches;
    const linked = matches.find(
      (store) => store.systemKey === 'gta' || store.systemKey === 'pmx',
    );
    return [linked || matches[0]];
  }, [stores, storeFilter]);

  const baseStores = lockedStore ? lockedStores : stores;

  const queriedStores = useMemo(() => {
    if (lockedStore) return baseStores;
    return baseStores.filter((store) => storeMatchesQuery(store, storeQuery));
  }, [baseStores, lockedStore, storeQuery]);

  const visibleStores = useMemo(() => {
    if (storeQuery.trim() && !lockedStore) return queriedStores;
    if (selectedStoreId && !lockedStore) {
      const pinned = queriedStores.find((store) => store.id === selectedStoreId);
      if (pinned) return [pinned];
    }
    return queriedStores;
  }, [queriedStores, selectedStoreId, lockedStore, storeQuery]);

  const singleStore = visibleStores.length === 1;

  const filteredRows = useMemo(() => {
    let result = rows;
    if (hideZeroRows) {
      if (visibleStores.length === 1) {
        const storeId = visibleStores[0].id;
        result = result.filter((row) => (row.quantities[storeId] || 0) !== 0);
      } else if (visibleStores.length > 1) {
        const storeIds = visibleStores.map((store) => store.id);
        result = result.filter((row) =>
          storeIds.some((storeId) => (row.quantities[storeId] || 0) !== 0),
        );
      } else {
        result = result.filter((row) => row.total !== 0);
      }
    }
    if (itemQuery.trim()) {
      result = result.filter((row) => rowMatchesItem(row, itemQuery));
    }
    return result;
  }, [rows, itemQuery, hideZeroRows, visibleStores]);

  const renderItem = useCallback(
    ({ item }) => (
      <InventoryRow row={item} stores={visibleStores} singleStore={singleStore} />
    ),
    [visibleStores, singleStore],
  );

  const keyExtractor = useCallback((item) => item.id, []);

  const activeStoreName = singleStore
    ? storeDisplayName(visibleStores[0], stores)
    : storeQuery.trim()
      ? `${visibleStores.length} stores`
      : 'All stores';

  const itemCountLabel =
    filteredRows.length === 1 ? '1 item' : `${filteredRows.length} items`;

  if (!session?.token) {
    return (
      <View style={[styles.body, embedded && styles.bodyEmbedded]}>
        <Text style={styles.hint}>
          Sign in to view inventory.{' '}
          {onRequireLogin ? (
            <Text style={styles.link} onPress={onRequireLogin}>
              Go to Profile
            </Text>
          ) : null}
        </Text>
      </View>
    );
  }

  const showStoreFilters = allowFilters && !lockedStore && stores.length > 0;

  return (
    <View style={[styles.body, embedded && styles.bodyEmbedded]}>
      <View style={styles.filters}>
        <View style={[styles.searchPair, !isMobile && styles.searchPairWide]}>
          {showStoreFilters ? (
            <SearchField
              value={storeQuery}
              onChangeText={setStoreQuery}
              placeholder="Store"
              accessibilityLabel="Filter by store"
            />
          ) : null}
          <SearchField
            value={itemQuery}
            onChangeText={setItemQuery}
            placeholder="Item"
            accessibilityLabel="Filter by item"
          />
        </View>

        {showStoreFilters ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipRow}
          >
            <Pressable
              onPress={() => {
                setSelectedStoreId(null);
                setStoreQuery('');
              }}
              style={({ pressed }) => [
                styles.chip,
                !selectedStoreId && !storeQuery.trim() && styles.chipActive,
                pressed && styles.chipPressed,
              ]}
            >
              <Text
                style={[
                  styles.chipText,
                  !selectedStoreId && !storeQuery.trim() && styles.chipTextActive,
                ]}
              >
                All
              </Text>
            </Pressable>
            {queriedStores.map((store) => {
              const active = visibleStores.length === 1 && visibleStores[0].id === store.id;
              return (
                <Pressable
                  key={store.id}
                  onPress={() => {
                    setSelectedStoreId((current) => (current === store.id ? null : store.id));
                    setStoreQuery('');
                  }}
                  style={({ pressed }) => [
                    styles.chip,
                    active && styles.chipActive,
                    pressed && styles.chipPressed,
                  ]}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]} numberOfLines={1}>
                    {storeDisplayName(store, stores)}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        ) : null}

        <View style={styles.toolbar}>
          <Text style={styles.scopeLabel} numberOfLines={1}>
            {activeStoreName}
            {rows.length > 0 ? ` · ${itemCountLabel}` : ''}
          </Text>
          <View style={styles.toolbarActions}>
            {allowFilters ? (
              <View style={styles.segment}>
                <Pressable
                  onPress={() => setHideZeroRows(true)}
                  style={[styles.segmentItem, hideZeroRows && styles.segmentItemActive]}
                >
                  <Text style={[styles.segmentText, hideZeroRows && styles.segmentTextActive]}>
                    Stocked
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => setHideZeroRows(false)}
                  style={[styles.segmentItem, !hideZeroRows && styles.segmentItemActive]}
                >
                  <Text style={[styles.segmentText, !hideZeroRows && styles.segmentTextActive]}>
                    All
                  </Text>
                </Pressable>
              </View>
            ) : null}
            <Pressable
              onPress={() => load({ force: true })}
              disabled={loading}
              hitSlop={8}
              style={styles.refresh}
              accessibilityLabel="Refresh inventory"
            >
              {loading ? (
                <ActivityIndicator size="small" color={BLUE} />
              ) : (
                <Ionicons name="refresh" size={16} color={SECONDARY} />
              )}
            </Pressable>
          </View>
        </View>

        {error ? (
          <Pressable style={styles.banner} onPress={() => load({ force: true })}>
            <Text style={styles.errorText}>{error} · Tap to retry</Text>
          </Pressable>
        ) : null}

        {warning && !error ? <Text style={styles.warningText}>{warning}</Text> : null}

        {!embedded ? (
          <View style={styles.legend}>
            {PRIORITY_LEGEND.map((item) => (
              <View key={item.key} style={styles.legendItem}>
                <View style={[styles.priorityDot, { backgroundColor: PRIORITY_COLORS[item.key] }]} />
                <Text style={styles.legendText}>{item.label}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>

      <View style={[styles.listCard, embedded && styles.listCardEmbedded]}>
        {loading && rows.length === 0 ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={BLUE} />
          </View>
        ) : stores.length === 0 ? (
          <View style={styles.centered}>
            <Text style={styles.emptyText}>No stores found.</Text>
          </View>
        ) : lockedStore && visibleStores.length === 0 ? (
          <View style={styles.centered}>
            <Text style={styles.emptyText}>
              No inventory data for {String(storeFilter).trim()}.
            </Text>
          </View>
        ) : visibleStores.length === 0 ? (
          <View style={styles.centered}>
            <Text style={styles.emptyText}>No stores match that filter.</Text>
          </View>
        ) : (
          <FlashList
            data={filteredRows}
            keyExtractor={keyExtractor}
            renderItem={renderItem}
            extraData={`${visibleStores.map((store) => store.id).join(',')}|${singleStore}`}
            style={styles.list}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={
              <Text style={styles.emptyText}>
                {itemQuery.trim() ? 'No matching items.' : 'No stocked items.'}
              </Text>
            }
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    minHeight: 0,
    backgroundColor: '#f2f2f7',
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  bodyEmbedded: {
    backgroundColor: 'transparent',
    paddingHorizontal: 0,
    paddingTop: 0,
    width: '100%',
    maxWidth: '100%',
  },
  filters: {
    gap: 10,
    marginBottom: 12,
    flexShrink: 0,
  },
  searchPair: {
    gap: 8,
  },
  searchPairWide: {
    flexDirection: 'row',
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
  chipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingRight: 8,
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
  chipPressed: {
    opacity: 0.72,
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
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  scopeLabel: {
    flex: 1,
    minWidth: 0,
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: SECONDARY,
    letterSpacing: -0.08,
  },
  toolbarActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  segment: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: FILL,
    borderRadius: 9,
    padding: 2,
  },
  segmentItem: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 7,
  },
  segmentItemActive: {
    backgroundColor: '#fff',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOpacity: 0.08,
        shadowRadius: 2,
        shadowOffset: { width: 0, height: 1 },
      },
      android: { elevation: 1 },
      default: {},
    }),
  },
  segmentText: {
    fontFamily,
    fontSize: 13,
    fontWeight: '500',
    color: SECONDARY,
  },
  segmentTextActive: {
    color: LABEL,
    fontWeight: '600',
  },
  refresh: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: FILL,
  },
  banner: {
    paddingVertical: 2,
  },
  errorText: {
    fontFamily,
    fontSize: 13,
    color: '#FF3B30',
  },
  warningText: {
    fontFamily,
    fontSize: 13,
    color: '#FF9F0A',
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 14,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  legendText: {
    fontFamily,
    fontSize: 12,
    color: SECONDARY,
  },
  priorityDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    flexShrink: 0,
  },
  priorityDotSpacer: {
    width: 8,
    height: 8,
    flexShrink: 0,
  },
  hint: {
    fontFamily,
    fontSize: 15,
    color: SECONDARY,
  },
  link: {
    color: BLUE,
    fontWeight: '600',
  },
  listCard: {
    flex: 1,
    minHeight: 0,
    backgroundColor: '#fff',
    borderRadius: 14,
    overflow: 'hidden',
  },
  listCardEmbedded: {
    width: '100%',
    maxWidth: '100%',
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingBottom: 24,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: SEPARATOR,
  },
  itemCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  itemName: {
    fontFamily,
    fontSize: 17,
    fontWeight: '400',
    color: LABEL,
    letterSpacing: -0.4,
  },
  itemSubtitle: {
    fontFamily,
    fontSize: 13,
    color: SECONDARY,
    letterSpacing: -0.08,
  },
  itemQty: {
    fontFamily,
    fontSize: 17,
    fontWeight: '600',
    color: LABEL,
    letterSpacing: -0.4,
    fontVariant: ['tabular-nums'],
    minWidth: 36,
    textAlign: 'right',
  },
  itemQtyZero: {
    color: SECONDARY,
    fontWeight: '400',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 120,
    paddingVertical: 24,
  },
  emptyText: {
    fontFamily,
    fontSize: 15,
    color: SECONDARY,
    textAlign: 'center',
    paddingHorizontal: 24,
    paddingTop: 28,
  },
});
