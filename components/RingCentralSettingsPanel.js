import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
  RINGCENTRAL_SERVERS,
  canManageRingCentral,
  checkRingCentralAccount,
  connectionLabel,
  deleteRingCentralAccount,
  formatCheckedAt,
  formatPhoneNumber,
  listRingCentralAccounts,
  saveRingCentralAccount,
} from '../lib/ringcentral';
import { storeKeyFromName } from '../lib/storeSettings';

const fontFamily = Platform.select({
  ios: 'Sohne',
  android: 'Sohne',
  default: 'Sohne',
});

function confirmRemove(name) {
  const message = `Remove RingCentral credentials for ${name}?`;
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.confirm) {
    return Promise.resolve(window.confirm(message));
  }
  return new Promise((resolve) => {
    Alert.alert('Remove credentials', message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: 'Remove', style: 'destructive', onPress: () => resolve(true) },
    ]);
  });
}

function Field({ label, value, onChangeText, placeholder, secure, multiline, hint }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      <TextInput
        style={[styles.fieldInput, multiline && styles.fieldInputTall]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#9a9a9a"
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry={secure}
        multiline={multiline}
        textAlignVertical={multiline ? 'top' : 'center'}
      />
    </View>
  );
}

function statusHint(account) {
  if (!account) return 'Not connected';
  const status = connectionLabel(account);
  const number = account.mainNumber ? formatPhoneNumber(account.mainNumber) : '';
  const checked = formatCheckedAt(account.lastCheckedAt);
  return [status, number, checked].filter(Boolean).join(' · ');
}

function StoreEditor({ session, storeName, account, onBack, onAccountChange, onRemoved }) {
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [jwt, setJwt] = useState('');
  const [serverUrl, setServerUrl] = useState(account?.serverUrl || RINGCENTRAL_SERVERS[0].key);
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [current, setCurrent] = useState(account || null);

  useEffect(() => {
    setCurrent(account || null);
    setServerUrl(account?.serverUrl || RINGCENTRAL_SERVERS[0].key);
    setClientId('');
    setClientSecret('');
    setJwt('');
    setError('');
    setMessage('');
  }, [account, storeName]);

  const saved = Boolean(current?.id);
  const status = connectionLabel(current);

  const applyAccount = (next) => {
    setCurrent(next);
    onAccountChange?.(next);
  };

  const onSave = async () => {
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const next = await saveRingCentralAccount(
        {
          id: current?.id || '',
          storeName,
          clientId,
          clientSecret,
          jwt,
          serverUrl,
        },
        session?.supabaseUserId || session?.profile?.id,
      );
      setClientId('');
      setClientSecret('');
      setJwt('');
      applyAccount(next);
      setChecking(true);
      const checked = await checkRingCentralAccount(next.storeKey);
      applyAccount(checked);
      if (checked.lastStatus === 'error' && checked.lastError) {
        setError(checked.lastError);
      } else {
        setMessage('RingCentral credentials saved.');
      }
    } catch (err) {
      setError(err?.message || 'Could not save RingCentral credentials.');
    } finally {
      setSaving(false);
      setChecking(false);
    }
  };

  const onCheck = async () => {
    if (!current?.storeKey && !storeName) return;
    setChecking(true);
    setError('');
    setMessage('');
    try {
      const checked = await checkRingCentralAccount(current?.storeKey || storeName);
      applyAccount(checked);
      if (checked.lastStatus === 'error' && checked.lastError) {
        setError(checked.lastError);
      } else {
        setMessage('Connected to RingCentral.');
      }
    } catch (err) {
      setError(err?.message || 'Could not reach RingCentral.');
    } finally {
      setChecking(false);
    }
  };

  const onRemove = async () => {
    if (!current?.id) return;
    const ok = await confirmRemove(storeName);
    if (!ok) return;
    setError('');
    setMessage('');
    try {
      await deleteRingCentralAccount(current.id);
      applyAccount(null);
      onRemoved?.();
      setMessage('Credentials removed.');
    } catch (err) {
      setError(err?.message || 'Could not remove credentials.');
    }
  };

  return (
    <ScrollView style={styles.body} contentContainerStyle={styles.content}>
      {onBack ? (
        <Pressable style={styles.backRow} onPress={onBack}>
          <Ionicons name="chevron-back" size={16} color="#1a1a1a" />
          <Text style={styles.backText}>All stores</Text>
        </Pressable>
      ) : null}

      <Text style={styles.storeTitle}>{storeName}</Text>
      <Text style={styles.intro}>
        Paste the REST API app client ID, client secret, and JWT from the RingCentral Developer Console.
        Leave a field blank to keep the value already saved. Secrets never come back to this screen.
      </Text>

      <View style={styles.statusCard}>
        <Text style={styles.statusLabel}>Status</Text>
        <Text
          style={[
            styles.statusValue,
            status === 'Connected' && styles.statusConnected,
            status === 'Error' && styles.statusError,
          ]}
        >
          {status}
        </Text>
        {current?.companyName ? <Text style={styles.hint}>{current.companyName}</Text> : null}
        {current?.mainNumber ? (
          <Text style={styles.hint}>{formatPhoneNumber(current.mainNumber)}</Text>
        ) : null}
        {current?.lastCheckedAt ? (
          <Text style={styles.hint}>Checked {formatCheckedAt(current.lastCheckedAt)}</Text>
        ) : null}
        {current?.extensionCount ? (
          <Text style={styles.hint}>{current.extensionCount} extensions</Text>
        ) : null}
      </View>

      <Field
        label="Client ID"
        value={clientId}
        onChangeText={setClientId}
        placeholder={current?.hasClientId ? 'Saved — paste to replace' : 'Client ID'}
      />
      <Field
        label="Client secret"
        value={clientSecret}
        onChangeText={setClientSecret}
        placeholder={current?.hasSecret ? 'Saved — paste to replace' : 'Client secret'}
        secure
      />
      <Field
        label="JWT"
        value={jwt}
        onChangeText={setJwt}
        placeholder={current?.hasJwt ? 'Saved — paste to replace' : 'eyJ…'}
        hint="The JWT credential from the developer console, not an access token."
        secure
        multiline
      />

      <Text style={styles.fieldLabel}>Environment</Text>
      <View style={styles.chipRow}>
        {RINGCENTRAL_SERVERS.map((server) => {
          const selected = serverUrl === server.key;
          return (
            <Pressable
              key={server.key}
              style={[styles.chip, selected && styles.chipActive]}
              onPress={() => setServerUrl(server.key)}
            >
              <Text style={[styles.chipText, selected && styles.chipTextActive]}>{server.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      {message ? <Text style={styles.savedText}>{message}</Text> : null}

      <View style={styles.actions}>
        <Pressable
          style={[styles.saveButton, (saving || checking) && styles.saveButtonDisabled]}
          onPress={onSave}
          disabled={saving || checking}
        >
          {saving || checking ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.saveButtonText}>Save and check</Text>
          )}
        </Pressable>
        {current?.hasJwt ? (
          <Pressable
            style={styles.secondaryButton}
            onPress={onCheck}
            disabled={saving || checking}
          >
            <Text style={styles.secondaryButtonText}>Check only</Text>
          </Pressable>
        ) : null}
        {saved ? (
          <Pressable style={styles.dangerButton} onPress={onRemove} disabled={saving}>
            <Text style={styles.dangerButtonText}>Remove</Text>
          </Pressable>
        ) : null}
      </View>
    </ScrollView>
  );
}

export default function RingCentralSettingsPanel({ session, storeName }) {
  const canEdit = canManageRingCentral(session?.profile);
  const [stores, setStores] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [selectedName, setSelectedName] = useState(storeName || '');
  const [loading, setLoading] = useState(!storeName);
  const [error, setError] = useState('');

  useEffect(() => {
    setSelectedName(storeName || '');
  }, [storeName]);

  const load = useCallback(async () => {
    if (!session?.token) {
      setStores([]);
      setAccounts([]);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const [pos, ringcentral] = await Promise.all([
        fetchTransferStores(session),
        listRingCentralAccounts(),
      ]);
      const homeName = session?.profile?.locationName || '';
      const sorted = [...(pos.stores || [])].sort((a, b) => {
        if (homeName) {
          const aHome = a.name.localeCompare(homeName, undefined, { sensitivity: 'base' }) === 0;
          const bHome = b.name.localeCompare(homeName, undefined, { sensitivity: 'base' }) === 0;
          if (aHome !== bHome) return aHome ? -1 : 1;
        }
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      });
      setStores(sorted);
      setAccounts(ringcentral.rows || []);
      if (ringcentral.unavailable) {
        setError('Run the Phone / RingCentral SQL in Supabase, then refresh this page.');
      } else if (pos.warning) {
        setError(pos.warning);
      }
    } catch (nextError) {
      setStores([]);
      setAccounts([]);
      setError(nextError?.message || 'Could not load stores.');
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    if (storeName) {
      listRingCentralAccounts()
        .then((result) => setAccounts(result.rows || []))
        .catch(() => {});
      return undefined;
    }
    load();
    return undefined;
  }, [load, storeName]);

  const accountByKey = useMemo(() => {
    const next = new Map();
    for (const row of accounts) next.set(row.storeKey, row);
    return next;
  }, [accounts]);

  const rows = useMemo(() => {
    const seen = new Set();
    const next = [];
    for (const store of stores) {
      const key = storeKeyFromName(store.name);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      next.push({
        key,
        storeName: store.name,
        account: accountByKey.get(key) || null,
      });
    }
    for (const account of accounts) {
      if (seen.has(account.storeKey)) continue;
      seen.add(account.storeKey);
      next.push({
        key: account.storeKey,
        storeName: account.storeName,
        account,
      });
    }
    return next;
  }, [accountByKey, accounts, stores]);

  const selected = rows.find((row) => row.storeName === selectedName) || null;
  const selectedAccount =
    selected?.account || accountByKey.get(storeKeyFromName(selectedName)) || null;

  if (!canEdit) {
    return (
      <ScrollView style={styles.body} contentContainerStyle={styles.content}>
        <Text style={styles.intro}>
          RingCentral credentials are managed by a branch manager, general manager, or system admin.
        </Text>
      </ScrollView>
    );
  }

  if (selectedName) {
    return (
      <StoreEditor
        session={session}
        storeName={selectedName}
        account={selectedAccount}
        onBack={storeName ? null : () => setSelectedName('')}
        onAccountChange={(next) => {
          if (!next) {
            setAccounts((current) =>
              current.filter((row) => storeKeyFromName(row.storeName) !== storeKeyFromName(selectedName)),
            );
            return;
          }
          setAccounts((current) => {
            const without = current.filter((row) => row.storeKey !== next.storeKey);
            return [...without, next];
          });
        }}
        onRemoved={() => {
          setAccounts((current) =>
            current.filter((row) => storeKeyFromName(row.storeName) !== storeKeyFromName(selectedName)),
          );
        }}
      />
    );
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color="#1a1a1a" />
      </View>
    );
  }

  return (
    <ScrollView style={styles.body} contentContainerStyle={styles.content}>
      <Text style={styles.intro}>
        Each branch uses its own RingCentral REST API app (JWT auth flow). Choose a store to paste
        client ID, client secret, and JWT.
      </Text>
      {rows.length === 0 ? (
        <Text style={styles.hint}>No stores found. Sign in and confirm locations are loading.</Text>
      ) : (
        <View style={styles.menuList}>
          {rows.map((row) => (
            <Pressable
              key={row.key}
              style={styles.menuRow}
              onPress={() => setSelectedName(row.storeName)}
            >
              <View style={[styles.menuIcon, { backgroundColor: '#ECFDF5' }]}>
                <Ionicons name="call-outline" size={16} color="#15803D" />
              </View>
              <View style={styles.menuTextWrap}>
                <Text style={styles.menuLabel}>{row.storeName}</Text>
                <Text style={styles.hint}>{statusHint(row.account)}</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color="#9a9a9a" />
            </Pressable>
          ))}
        </View>
      )}
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    minHeight: 0,
    marginTop: 20,
    alignSelf: 'stretch',
  },
  content: {
    paddingBottom: 40,
    maxWidth: 640,
  },
  centered: {
    flex: 1,
    minHeight: 120,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 20,
  },
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginBottom: 12,
    alignSelf: 'flex-start',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  backText: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  storeTitle: {
    fontFamily,
    fontSize: 18,
    fontWeight: '600',
    color: '#1a1a1a',
    marginBottom: 6,
  },
  intro: {
    fontFamily,
    fontSize: 13,
    color: '#6b6b6b',
    marginBottom: 20,
    lineHeight: 18,
  },
  statusCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e5e5',
    borderRadius: 8,
    padding: 12,
    marginBottom: 20,
    backgroundColor: '#fafafa',
    gap: 2,
  },
  statusLabel: {
    fontFamily,
    fontSize: 11,
    fontWeight: '600',
    color: '#8a8a8a',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 4,
  },
  statusValue: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  statusConnected: {
    color: '#15803D',
  },
  statusError: {
    color: '#B91C1C',
  },
  field: {
    marginBottom: 16,
    gap: 4,
  },
  fieldLabel: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  fieldInput: {
    fontFamily,
    fontSize: 13,
    color: '#1a1a1a',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#d0d0d0',
    borderRadius: 6,
    paddingVertical: 8,
    paddingHorizontal: 10,
    backgroundColor: '#fff',
    ...Platform.select({
      web: { outlineStyle: 'none' },
      default: {},
    }),
  },
  fieldInputTall: {
    minHeight: 88,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
    marginBottom: 18,
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#f3f3f3',
  },
  chipActive: {
    backgroundColor: '#E8F8EE',
  },
  chipText: {
    fontFamily,
    fontSize: 12,
    fontWeight: '500',
    color: '#6b6b6b',
  },
  chipTextActive: {
    color: '#15803D',
    fontWeight: '600',
  },
  hint: {
    fontFamily,
    fontSize: 12,
    color: '#8a8a8a',
    marginTop: 2,
    lineHeight: 17,
  },
  errorText: {
    fontFamily,
    fontSize: 12,
    color: '#b42318',
    marginBottom: 12,
  },
  savedText: {
    fontFamily,
    fontSize: 12,
    color: '#2F8A4E',
    marginBottom: 12,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  saveButton: {
    backgroundColor: '#1a1a1a',
    borderRadius: 6,
    paddingVertical: 10,
    alignItems: 'center',
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: 24,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  saveButtonDisabled: {
    opacity: 0.7,
  },
  saveButtonText: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: '#fff',
  },
  secondaryButton: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#d0d0d0',
    borderRadius: 6,
    paddingVertical: 10,
    paddingHorizontal: 14,
    minHeight: 40,
    justifyContent: 'center',
    backgroundColor: '#fff',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  secondaryButtonText: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  dangerButton: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    minHeight: 40,
    justifyContent: 'center',
  },
  dangerButtonText: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: '#B91C1C',
  },
  menuList: {
    gap: 10,
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e5e5',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 12,
    backgroundColor: '#fff',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  menuIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  menuTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  menuLabel: {
    fontFamily,
    fontSize: 14,
    fontWeight: '600',
    color: '#1a1a1a',
  },
});
