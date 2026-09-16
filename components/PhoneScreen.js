import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { fetchTransferStores } from '../lib/locations';
import {
  canManageRingCentral,
  checkRingCentralAccount,
  connectionLabel,
  formatCheckedAt,
  formatPhoneNumber,
  listRingCentralAccounts,
} from '../lib/ringcentral';
import { storeKeyFromName } from '../lib/storeSettings';

const fontFamily = Platform.select({
  ios: 'Sohne',
  android: 'Sohne',
  default: 'Sohne',
});

const ACCENT = '#15803D';

function statusTone(row) {
  const status = row?.lastStatus || connectionLabel(row);
  if (status === 'connected' || status === 'Connected') return styles.statusConnected;
  if (status === 'error' || status === 'Error') return styles.statusError;
  return styles.statusMuted;
}

export default function PhoneScreen({ session, onRequireLogin, storeFilter }) {
  const canManage = canManageRingCentral(session?.profile);
  const [stores, setStores] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [checkingKey, setCheckingKey] = useState('');
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [query, setQuery] = useState('');
  const requestId = useRef(0);

  const load = useCallback(async () => {
    if (!session?.token) {
      setStores([]);
      setAccounts([]);
      setError('');
      setWarning('');
      return;
    }

    const id = ++requestId.current;
    setLoading(true);
    setError('');
    setWarning('');

    try {
      const [pos, ringcentral] = await Promise.all([
        fetchTransferStores(session),
        listRingCentralAccounts(),
      ]);
      if (id !== requestId.current) return;
      setStores(pos.stores || []);
      setAccounts(ringcentral.rows || []);
      const notes = [pos.warning];
      if (ringcentral.unavailable) {
        notes.push('RingCentral tables are not installed yet. Run the Phone migration in Supabase.');
      }
      setWarning(notes.filter(Boolean).join(' '));
    } catch (err) {
      if (id !== requestId.current) return;
      setStores([]);
      setAccounts([]);
      setError(err?.message || 'Failed to load stores.');
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    load();
  }, [load]);

  const accountByKey = useMemo(() => {
    const next = new Map();
    for (const row of accounts) next.set(row.storeKey, row);
    return next;
  }, [accounts]);

  const rows = useMemo(() => {
    const seen = new Set();
    const next = [];
    const posStores = storeFilter
      ? stores.filter((store) => storeKeyFromName(store.name) === storeKeyFromName(storeFilter))
      : stores;

    for (const store of posStores) {
      const key = storeKeyFromName(store.name);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const account = accountByKey.get(key) || null;
      next.push({
        key,
        storeName: store.name,
        address: store.address || '',
        posPhone: store.phone || '',
        account,
      });
    }

    for (const account of accounts) {
      if (seen.has(account.storeKey)) continue;
      if (storeFilter && account.storeKey !== storeKeyFromName(storeFilter)) continue;
      seen.add(account.storeKey);
      next.push({
        key: account.storeKey,
        storeName: account.storeName,
        address: '',
        posPhone: '',
        account,
      });
    }

    const needle = query.trim().toLowerCase();
    const filtered = needle
      ? next.filter((row) =>
          [row.storeName, row.account?.mainNumber, row.account?.companyName, row.posPhone]
            .join(' ')
            .toLowerCase()
            .includes(needle),
        )
      : next;

    filtered.sort((a, b) => a.storeName.localeCompare(b.storeName, undefined, { sensitivity: 'base' }));
    return filtered;
  }, [accounts, accountByKey, query, storeFilter, stores]);

  const onCheck = async (storeKey) => {
    setCheckingKey(storeKey);
    setError('');
    try {
      const checked = await checkRingCentralAccount(storeKey);
      setAccounts((current) => {
        const without = current.filter((row) => row.storeKey !== checked.storeKey);
        return [...without, checked];
      });
      if (checked.lastStatus === 'error' && checked.lastError) {
        setError(checked.lastError);
      }
    } catch (err) {
      setError(err?.message || 'Could not reach RingCentral.');
    } finally {
      setCheckingKey('');
    }
  };

  const connectedCount = accounts.filter((row) => row.lastStatus === 'connected').length;

  if (!session?.token) {
    return (
      <View style={[styles.screen, styles.listContent]}>
        <Text style={styles.emptyText}>
          Sign in to view store phones.{' '}
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
    <View style={styles.screen}>
      <ScrollView style={styles.list} contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}>
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Stores</Text>
            <Text style={styles.sectionMeta}>
              {canManage
                ? 'Numbers and connection status. Add each store’s RingCentral JWT in Settings → RingCentral.'
                : 'Numbers and connection status for each branch.'}
            </Text>
          </View>

          <View style={styles.summaryCards}>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryLabel}>Stores</Text>
              <Text style={styles.summaryValue}>{rows.length}</Text>
            </View>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryLabel}>Connected</Text>
              <Text style={[styles.summaryValue, connectedCount ? styles.statusConnected : null]}>
                {connectedCount}
              </Text>
              <Text style={styles.summaryHint}>of {accounts.length} saved</Text>
            </View>
          </View>

          <View style={styles.toolbar}>
            <View style={styles.search}>
              <Ionicons name="search" size={14} color="#8e8e93" />
              <TextInput
                style={styles.searchInput}
                value={query}
                onChangeText={setQuery}
                placeholder="Search stores"
                placeholderTextColor="#8e8e93"
                autoCapitalize="none"
                autoCorrect={false}
                clearButtonMode="while-editing"
              />
            </View>
            <Pressable style={styles.refresh} onPress={load} hitSlop={8} accessibilityLabel="Refresh">
              {loading ? (
                <ActivityIndicator size="small" color={ACCENT} />
              ) : (
                <Ionicons name="refresh" size={16} color="#6b6b6b" />
              )}
            </Pressable>
          </View>

          {error ? (
            <View style={styles.errorBanner}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}
          {warning ? <Text style={styles.warningText}>{warning}</Text> : null}

          <View style={[styles.row, styles.headerRow]}>
            <Text style={[styles.headerText, styles.colStore]}>Store</Text>
            <Text style={[styles.headerText, styles.colStatus]}>RingCentral</Text>
            <Text style={[styles.headerText, styles.colNumber]}>Number</Text>
            <Text style={[styles.headerText, styles.colExts]}>Exts</Text>
            <Text style={[styles.headerText, styles.colAccount]}>Account</Text>
            <Text style={[styles.headerText, styles.colActions]}> </Text>
          </View>

          {loading && rows.length === 0 ? (
            <View style={styles.centered}>
              <ActivityIndicator color={ACCENT} />
            </View>
          ) : rows.length === 0 ? (
            <Text style={styles.emptyText}>No stores to show.</Text>
          ) : (
            rows.map((row) => {
              const account = row.account;
              const status = connectionLabel(account);
              const checking = checkingKey === row.key;
              return (
                <View key={row.key} style={styles.row}>
                  <View style={styles.colStore}>
                    <Text style={styles.cell} numberOfLines={1}>
                      {row.storeName}
                    </Text>
                    {row.address ? (
                      <Text style={styles.cellSub} numberOfLines={1}>
                        {row.address}
                      </Text>
                    ) : null}
                  </View>
                  <View style={styles.colStatus}>
                    <Text style={[styles.cell, statusTone(account)]} numberOfLines={1}>
                      {status}
                    </Text>
                    {account?.lastError ? (
                      <Text style={styles.cellError} numberOfLines={2}>
                        {account.lastError}
                      </Text>
                    ) : account?.lastCheckedAt ? (
                      <Text style={styles.cellSub} numberOfLines={1}>
                        {formatCheckedAt(account.lastCheckedAt)}
                      </Text>
                    ) : null}
                  </View>
                  <Text style={[styles.cell, styles.colNumber]} numberOfLines={1}>
                    {account?.mainNumber
                      ? formatPhoneNumber(account.mainNumber)
                      : row.posPhone
                        ? formatPhoneNumber(row.posPhone)
                        : '—'}
                  </Text>
                  <Text style={[styles.cell, styles.colExts]} numberOfLines={1}>
                    {account?.extensionCount ? String(account.extensionCount) : '—'}
                  </Text>
                  <Text style={[styles.cell, styles.colAccount]} numberOfLines={1}>
                    {account?.companyName || '—'}
                  </Text>
                  <View style={styles.colActions}>
                    {account?.hasJwt ? (
                      <Pressable onPress={() => onCheck(row.key)} disabled={checking} hitSlop={6}>
                        {checking ? (
                          <ActivityIndicator size="small" color={ACCENT} />
                        ) : (
                          <Text style={styles.link}>Check</Text>
                        )}
                      </Pressable>
                    ) : null}
                  </View>
                </View>
              );
            })
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#fff',
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 32,
    maxWidth: 1100,
    width: '100%',
    alignSelf: 'center',
  },
  section: {
    gap: 14,
  },
  sectionHeader: {
    gap: 2,
  },
  sectionTitle: {
    fontFamily,
    fontSize: 18,
    fontWeight: '700',
    color: '#1a1a1a',
  },
  sectionMeta: {
    fontFamily,
    fontSize: 12,
    color: '#8a8a8a',
  },
  summaryCards: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  summaryCard: {
    flexGrow: 1,
    flexBasis: 120,
    minWidth: 110,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: '#F3FBF6',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#D5EBD9',
  },
  summaryLabel: {
    fontFamily,
    fontSize: 11,
    fontWeight: '600',
    color: '#8a8a8a',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 4,
  },
  summaryValue: {
    fontFamily,
    fontSize: 18,
    fontWeight: '700',
    color: '#1a1a1a',
    fontVariant: ['tabular-nums'],
  },
  summaryHint: {
    fontFamily,
    fontSize: 12,
    color: '#8a8a8a',
    marginTop: 2,
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  search: {
    flex: 1,
    minWidth: 160,
    maxWidth: 320,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e0e0e0',
    paddingBottom: 6,
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
  refresh: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorBanner: {
    marginBottom: 2,
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
  },
  headerRow: {
    borderBottomColor: '#e5e5e5',
    marginBottom: 2,
    minHeight: 28,
  },
  headerText: {
    fontFamily,
    fontSize: 11,
    fontWeight: '600',
    color: '#9a9a9a',
    letterSpacing: 0.2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    width: '100%',
    minHeight: 44,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f0f0f0',
    gap: 8,
  },
  cell: {
    fontFamily,
    fontSize: 13,
    color: '#1a1a1a',
  },
  cellSub: {
    fontFamily,
    fontSize: 11,
    color: '#8a8a8a',
    marginTop: 2,
  },
  cellError: {
    fontFamily,
    fontSize: 11,
    color: '#991B1B',
    marginTop: 2,
  },
  colStore: {
    flex: 1.4,
    minWidth: 0,
  },
  colStatus: {
    flex: 1.1,
    minWidth: 0,
  },
  colNumber: {
    flex: 1.1,
    minWidth: 0,
  },
  colExts: {
    flex: 0.45,
    minWidth: 0,
  },
  colAccount: {
    flex: 1.1,
    minWidth: 0,
  },
  colActions: {
    flex: 0.6,
    minWidth: 48,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 10,
  },
  statusConnected: {
    color: '#15803D',
    fontWeight: '600',
  },
  statusError: {
    color: '#B91C1C',
    fontWeight: '600',
  },
  statusMuted: {
    color: '#8a8a8a',
  },
  link: {
    color: ACCENT,
    fontWeight: '600',
    fontFamily,
    fontSize: 13,
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 24,
  },
  emptyText: {
    fontFamily,
    fontSize: 13,
    color: '#8a8a8a',
    paddingTop: 16,
    paddingBottom: 8,
  },
});
