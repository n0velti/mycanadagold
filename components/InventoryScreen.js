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
import { fetchInventoryMatrix, formatQty, peekInventoryMatrix } from '../lib/inventory';
import { useAppAccess } from '../lib/permissions';

const fontFamily = Platform.select({
  ios: 'Sohne',
  android: 'Sohne',
  default: 'Sohne',
});

const ACCENT = '#C47A12';

const PRIORITY_COLORS = {
  green: '#2F8A4E',
  yellow: '#C9A227',
  red: '#C43C3C',
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
  const [stores, setStores] = useState([]);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [query, setQuery] = useState('');
  const [hideZeroRows, setHideZeroRows] = useState(true);
  const requestId = useRef(0);
  const hasDataRef = useRef(false);
  const singleStore = Boolean(storeFilter);
  const ListContainer = ScrollView;
  const listProps = {
    style: embedded ? styles.listEmbedded : styles.list,
    contentContainerStyle: styles.listContent,
    showsVerticalScrollIndicator: false,
  };

  const load = useCallback(async ({ force = false } = {}) => {
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

    if (force || !hasDataRef.current) setLoading(true);
    setError('');
    if (force) setWarning('');

    try {
      const result = await fetchInventoryMatrix(session, { force });
      if (id !== requestId.current) return;
      setStores(result.stores);
      setRows(result.rows);
      setWarning(result.warning || '');
      hasDataRef.current = true;
    } catch (err) {
      if (id !== requestId.current) return;
      if (!hasDataRef.current) {
        setStores([]);
        setRows([]);
      }
      setError(err?.message || 'Failed to load inventory.');
      if (!hasDataRef.current) setWarning('');
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    load();
  }, [load]);

  const visibleStores = useMemo(() => {
    if (!storeFilter) return stores;
    const target = String(storeFilter).trim();
    const matches = stores.filter(
      (store) =>
        String(store.name || '')
          .trim()
          .localeCompare(target, undefined, { sensitivity: 'base' }) === 0,
    );
    if (matches.length <= 1) return matches;
    // Prefer linked GTA/PMX columns when East has a same-named location.
    const linked = matches.find(
      (store) => store.systemKey === 'gta' || store.systemKey === 'pmx',
    );
    return [linked || matches[0]];
  }, [stores, storeFilter]);

  const filteredRows = useMemo(() => {
    let result = rows;
    if (hideZeroRows) {
      if (visibleStores.length === 1) {
        const storeId = visibleStores[0].id;
        result = result.filter((row) => (row.quantities[storeId] || 0) !== 0);
      } else {
        result = result.filter((row) => row.total !== 0);
      }
    }
    const q = query.trim().toLowerCase();
    if (q) {
      result = result.filter(
        (row) =>
          row.name.toLowerCase().includes(q) ||
          row.sku.toLowerCase().includes(q),
      );
    }
    return result;
  }, [rows, query, hideZeroRows, visibleStores]);

  if (!session?.token) {
    return (
      <View style={styles.body}>
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

  return (
    <View style={[styles.body, embedded && styles.bodyEmbedded]}>
      <View style={styles.toolbar}>
        <View style={[styles.search, embedded && styles.searchEmbedded]}>
          <Ionicons name="search-outline" size={14} color="#8a8a8a" />
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="Search"
            placeholderTextColor="#9a9a9a"
            autoCorrect={false}
            autoCapitalize="none"
          />
          {query ? (
            <Pressable onPress={() => setQuery('')} hitSlop={8}>
              <Ionicons name="close-circle" size={14} color="#9a9a9a" />
            </Pressable>
          ) : null}
        </View>

        {allowFilters ? (
          <Pressable onPress={() => setHideZeroRows((v) => !v)} hitSlop={6}>
            <Text style={[styles.toggle, hideZeroRows && styles.toggleOn]}>
              {hideZeroRows ? 'Showing stocked' : 'Showing all'}
            </Text>
          </Pressable>
        ) : null}

        <Pressable
          onPress={() => load({ force: true })}
          disabled={loading}
          hitSlop={8}
          style={styles.refresh}
        >
          {loading ? (
            <ActivityIndicator size="small" color={ACCENT} />
          ) : (
            <Ionicons name="refresh-outline" size={15} color="#8a8a8a" />
          )}
        </Pressable>
      </View>

      {error ? (
        <Pressable style={styles.errorBanner} onPress={() => load({ force: true })}>
          <Text style={styles.errorText}>{error} · Tap to retry</Text>
        </Pressable>
      ) : null}

      {warning && !error ? (
        <Text style={styles.warningText}>{warning}</Text>
      ) : null}

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

      <View style={[styles.table, embedded && styles.tableEmbedded]}>
        {loading && rows.length === 0 ? (
          <View style={[styles.centered, embedded && styles.centeredEmbedded]}>
            <ActivityIndicator size="large" color={ACCENT} />
          </View>
        ) : stores.length === 0 ? (
          <View style={[styles.centered, embedded && styles.centeredEmbedded]}>
            <Text style={styles.emptyText}>No stores found.</Text>
          </View>
        ) : singleStore && visibleStores.length === 0 ? (
          <View style={[styles.centered, embedded && styles.centeredEmbedded]}>
            <Text style={styles.emptyText}>
              No inventory data for {String(storeFilter).trim()}.
            </Text>
          </View>
        ) : (
          <ScrollView
            horizontal={isMobile && !singleStore}
            nestedScrollEnabled
            showsHorizontalScrollIndicator={isMobile && !singleStore}
            contentContainerStyle={
              isMobile && !singleStore ? styles.tableScrollContent : undefined
            }
          >
            <View style={isMobile && !singleStore ? styles.tableScrollInner : undefined}>
              <View style={[styles.row, styles.headerRow]}>
                <View
                  style={[
                    styles.productCell,
                    singleStore && styles.productCellWide,
                    styles.productCellInner,
                  ]}
                >
                  <View style={styles.priorityDotSpacer} />
                  <Text style={styles.headerText} numberOfLines={1}>
                    Product
                  </Text>
                </View>
                {visibleStores.map((store) => (
                  <Text
                    key={store.id}
                    style={[
                      styles.qtyCell,
                      singleStore && styles.qtyCellSingle,
                      styles.headerText,
                    ]}
                    numberOfLines={1}
                  >
                    {singleStore ? 'Qty' : shortStoreName(store.name)}
                  </Text>
                ))}
              </View>

              <ListContainer {...listProps}>
                {filteredRows.length === 0 ? (
                  <Text style={styles.emptyText}>
                    {query.trim() ? 'No matching products.' : 'No stocked products.'}
                  </Text>
                ) : (
                  filteredRows.map((row) => (
                    <View key={row.id} style={styles.row}>
                      <View
                        style={[
                          styles.productCell,
                          singleStore && styles.productCellWide,
                          styles.productCellInner,
                        ]}
                      >
                        {row.priority ? (
                          <View
                            style={[
                              styles.priorityDot,
                              { backgroundColor: PRIORITY_COLORS[row.priority] },
                            ]}
                          />
                        ) : (
                          <View style={styles.priorityDotSpacer} />
                        )}
                        <Text style={styles.productName} numberOfLines={1}>
                          {row.name}
                        </Text>
                      </View>
                      {visibleStores.map((store) => {
                        const qty = row.quantities[store.id] || 0;
                        return (
                          <Text
                            key={store.id}
                            style={[
                              styles.qtyCell,
                              singleStore && styles.qtyCellSingle,
                              qty === 0 && styles.qtyZero,
                            ]}
                            numberOfLines={1}
                          >
                            {qty === 0 ? '' : formatQty(qty)}
                          </Text>
                        );
                      })}
                    </View>
                  ))
                )}
              </ListContainer>
            </View>
          </ScrollView>
        )}
      </View>
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
  toolbar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 14,
    marginBottom: 12,
    width: '100%',
    maxWidth: '100%',
    flexShrink: 0,
  },
  search: {
    flex: 1,
    maxWidth: 280,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e0e0e0',
    paddingBottom: 6,
  },
  searchEmbedded: {
    maxWidth: '100%',
  },
  searchInput: {
    flex: 1,
    fontFamily,
    fontSize: 14,
    color: '#1a1a1a',
    paddingVertical: 0,
    ...Platform.select({
      web: { outlineStyle: 'none' },
      default: {},
    }),
  },
  toggle: {
    fontFamily,
    fontSize: 12,
    color: '#9a9a9a',
  },
  toggleOn: {
    color: ACCENT,
    fontWeight: '600',
  },
  refresh: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorBanner: {
    marginBottom: 10,
  },
  errorText: {
    fontFamily,
    fontSize: 13,
    color: '#991B1B',
  },
  warningText: {
    fontFamily,
    fontSize: 12,
    color: '#9a6b2f',
    marginBottom: 8,
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 14,
    marginBottom: 10,
    flexShrink: 0,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  legendText: {
    fontFamily,
    fontSize: 11,
    color: '#8a8a8a',
  },
  priorityDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    flexShrink: 0,
  },
  priorityDotSpacer: {
    width: 7,
    height: 7,
    flexShrink: 0,
  },
  productCellInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  productName: {
    flex: 1,
    minWidth: 0,
    fontFamily,
    fontSize: 14,
    color: '#1a1a1a',
  },
  hint: {
    fontFamily,
    fontSize: 14,
    color: '#6b6b6b',
  },
  link: {
    color: ACCENT,
    fontWeight: '600',
  },
  table: {
    flex: 1,
    minHeight: 0,
  },
  tableEmbedded: {
    flex: 1,
    minHeight: 0,
    width: '100%',
    maxWidth: '100%',
  },
  tableScrollContent: {
    flexGrow: 1,
  },
  tableScrollInner: {
    minWidth: 720,
    flex: 1,
  },
  list: {
    flex: 1,
  },
  listEmbedded: {
    flex: 1,
    minHeight: 0,
    width: '100%',
    maxWidth: '100%',
  },
  listContent: {
    paddingBottom: 24,
  },
  centeredEmbedded: {
    minHeight: 120,
    paddingVertical: 24,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    maxWidth: '100%',
    minHeight: 40,
    overflow: 'hidden',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f0f0f0',
  },
  headerRow: {
    borderBottomColor: '#e5e5e5',
    marginBottom: 2,
  },
  headerText: {
    fontFamily,
    fontSize: 11,
    fontWeight: '600',
    color: '#9a9a9a',
    letterSpacing: 0.2,
  },
  productCell: {
    flex: 1.8,
    flexShrink: 1,
    minWidth: 0,
    paddingRight: 12,
    overflow: 'hidden',
  },
  productCellWide: {
    flex: 1,
    flexShrink: 1,
  },
  qtyCell: {
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
    textAlign: 'right',
    paddingHorizontal: 2,
    fontFamily,
    fontSize: 14,
    color: '#1a1a1a',
    fontVariant: ['tabular-nums'],
  },
  qtyCellSingle: {
    flexGrow: 0,
    flexShrink: 0,
    flexBasis: 64,
    width: 64,
    maxWidth: 64,
  },
  qtyZero: {
    color: 'transparent',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    fontFamily,
    fontSize: 13,
    color: '#8a8a8a',
    paddingTop: 24,
  },
});
