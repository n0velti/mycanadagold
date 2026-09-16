import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import {
  callPartyLabel,
  controlPhoneCall,
  fetchPhonePresence,
  isRingingCall,
  startRingOut,
} from '../lib/phoneCalls';
import { PHONE_LIVE_MS, useLiveRefresh } from '../lib/liveRefresh';
import { useAppAccess } from '../lib/permissions';
import { listRingCentralAccounts, formatPhoneNumber } from '../lib/ringcentral';
import { startRingtone, stopRingtone, unlockPhoneAudio } from '../lib/phoneSound';
import { storeKeyFromName } from '../lib/storeSettings';

const SILENT_KEY = 'cgold.phone.silent';
const ACCENT = '#15803D';
const fontFamily = Platform.select({
  ios: 'Sohne',
  android: 'Sohne',
  default: 'Sohne',
});

const PhoneCallContext = createContext({
  stores: [],
  selectedStoreKey: '',
  setSelectedStoreKey: () => {},
  liveCalls: [],
  incoming: [],
  silent: false,
  setSilent: () => {},
  busy: false,
  error: '',
  answer: async () => {},
  reject: async () => {},
  hangup: async () => {},
  ringOut: async () => {},
});

export function usePhoneCalls() {
  return useContext(PhoneCallContext);
}

export function PhoneCallProvider({ session, storeFilter, enabled = true, children }) {
  const { hasApp } = useAppAccess();
  const active = Boolean(enabled && session?.token && hasApp('phone'));
  const [stores, setStores] = useState([]);
  const [selectedStoreKey, setSelectedStoreKey] = useState('');
  const [liveCalls, setLiveCalls] = useState([]);
  const [silent, setSilentState] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const requestId = useRef(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(SILENT_KEY);
        if (!cancelled) setSilentState(raw === '1');
      } catch {
        // Keep ringing on.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!active) return undefined;
    const unlock = () => unlockPhoneAudio();
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.addEventListener('pointerdown', unlock, { once: true });
      return () => window.removeEventListener('pointerdown', unlock);
    }
    return undefined;
  }, [active]);

  const setSilent = useCallback(async (next) => {
    const value = Boolean(next);
    setSilentState(value);
    if (value) stopRingtone();
    try {
      await AsyncStorage.setItem(SILENT_KEY, value ? '1' : '0');
    } catch {
      // Preference is still applied for this session.
    }
  }, []);

  const connectedStores = useMemo(
    () =>
      stores.filter((row) => {
        if (!row.hasJwt) return false;
        if (!storeFilter) return true;
        return row.storeKey === storeKeyFromName(storeFilter);
      }),
    [storeFilter, stores],
  );

  useEffect(() => {
    if (!active) {
      setStores([]);
      setLiveCalls([]);
      return undefined;
    }
    let cancelled = false;
    (async () => {
      try {
        const { rows } = await listRingCentralAccounts();
        if (cancelled) return;
        setStores(rows || []);
      } catch {
        if (!cancelled) setStores([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active, session?.token]);

  useEffect(() => {
    if (selectedStoreKey && connectedStores.some((row) => row.storeKey === selectedStoreKey)) return;
    const preferred = storeFilter ? storeKeyFromName(storeFilter) : '';
    const next =
      connectedStores.find((row) => row.storeKey === preferred)?.storeKey ||
      connectedStores[0]?.storeKey ||
      '';
    if (next !== selectedStoreKey) setSelectedStoreKey(next);
  }, [connectedStores, selectedStoreKey, storeFilter]);

  const refreshPresence = useCallback(
    async () => {
      if (!active || connectedStores.length === 0) {
        setLiveCalls([]);
        return;
      }
      const id = ++requestId.current;
      const settled = await Promise.allSettled(
        connectedStores.map((row) => fetchPhonePresence(row.storeKey)),
      );
      if (id !== requestId.current) return;
      const next = [];
      for (const item of settled) {
        if (item.status !== 'fulfilled') continue;
        next.push(...(item.value.liveCalls || []));
        if (item.value.incoming) {
          const extras = item.value.incoming.filter(
            (call) => !next.some((row) => row.id === call.id && row.storeKey === call.storeKey),
          );
          next.push(...extras);
        }
      }
      setLiveCalls(next);
    },
    [active, connectedStores],
  );

  useLiveRefresh(refreshPresence, PHONE_LIVE_MS, active && connectedStores.length > 0);

  useEffect(() => {
    if (!active || connectedStores.length === 0) return undefined;
    refreshPresence();
    return undefined;
  }, [active, connectedStores, refreshPresence]);

  const incoming = useMemo(() => liveCalls.filter(isRingingCall), [liveCalls]);

  useEffect(() => {
    if (!active || silent || incoming.length === 0) {
      stopRingtone();
      return undefined;
    }
    startRingtone();
    return () => stopRingtone();
  }, [active, incoming.length, silent]);

  useEffect(() => () => stopRingtone(), []);

  const runControl = useCallback(async (action, call) => {
    if (!call) throw new Error('That call is no longer available.');
    setBusy(true);
    setError('');
    try {
      const result = await controlPhoneCall(action, call);
      setLiveCalls((current) => {
        const others = current.filter((row) => row.storeKey !== call.storeKey);
        return [...others, ...(result.liveCalls || [])];
      });
      return result;
    } catch (err) {
      const message = err?.message || 'Could not update that call.';
      setError(message);
      throw err;
    } finally {
      setBusy(false);
    }
  }, []);

  const answer = useCallback((call) => runControl('answer', call), [runControl]);
  const reject = useCallback((call) => runControl('reject', call), [runControl]);
  const hangup = useCallback((call) => runControl('hangup', call), [runControl]);

  const ringOut = useCallback(
    async (to, from) => {
      const storeKey = selectedStoreKey || connectedStores[0]?.storeKey;
      if (!storeKey) throw new Error('Connect a store in Settings → RingCentral first.');
      setBusy(true);
      setError('');
      try {
        const result = await startRingOut(storeKey, to, from);
        setLiveCalls((current) => {
          const others = current.filter((row) => row.storeKey !== storeKey);
          return [...others, ...(result.liveCalls || [])];
        });
        return result;
      } catch (err) {
        const message = err?.message || 'Could not start the call.';
        setError(message);
        throw err;
      } finally {
        setBusy(false);
      }
    },
    [connectedStores, selectedStoreKey],
  );

  const value = useMemo(
    () => ({
      stores: connectedStores,
      allStores: stores,
      selectedStoreKey,
      setSelectedStoreKey,
      liveCalls,
      incoming,
      silent,
      setSilent,
      busy,
      error,
      setError,
      answer,
      reject,
      hangup,
      ringOut,
      refreshPresence,
    }),
    [
      answer,
      busy,
      connectedStores,
      error,
      hangup,
      incoming,
      liveCalls,
      refreshPresence,
      reject,
      ringOut,
      selectedStoreKey,
      setSilent,
      silent,
      stores,
    ],
  );

  return <PhoneCallContext.Provider value={value}>{children}</PhoneCallContext.Provider>;
}

function IncomingActions({ call, compact, busy, onAnswer, onReject }) {
  return (
    <View style={compact ? styles.actionsCompact : styles.actions}>
      <Pressable
        style={[styles.action, styles.reject, compact && styles.actionCompact]}
        onPress={() => onReject(call)}
        disabled={busy}
        accessibilityLabel="Reject call"
      >
        <Ionicons name="close" size={compact ? 14 : 16} color="#fff" />
        {compact ? null : <Text style={styles.actionText}>Reject</Text>}
      </Pressable>
      <Pressable
        style={[styles.action, styles.answer, compact && styles.actionCompact]}
        onPress={() => onAnswer(call)}
        disabled={busy}
        accessibilityLabel="Answer call"
      >
        {busy ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <Ionicons name="call" size={compact ? 14 : 16} color="#fff" />
        )}
        {compact ? null : <Text style={styles.actionText}>Answer</Text>}
      </Pressable>
    </View>
  );
}

export function PhoneRingerToggle({ collapsed = false }) {
  const { silent, setSilent, stores } = usePhoneCalls();
  if (!stores.length) return null;
  return (
    <Pressable
      style={[styles.ringer, collapsed && styles.ringerCollapsed]}
      onPress={() => setSilent(!silent)}
      accessibilityLabel={silent ? 'Turn ringtone on' : 'Silence ringtone'}
    >
      <Ionicons name={silent ? 'notifications-off' : 'notifications-outline'} size={16} color={silent ? '#991B1B' : '#6e6e73'} />
      {collapsed ? null : (
        <Text style={[styles.ringerText, silent && styles.ringerTextSilent]}>
          {silent ? 'Silent' : 'Ringtone on'}
        </Text>
      )}
    </Pressable>
  );
}

export function PhoneIncomingDock({ collapsed = false, variant = 'sidebar' }) {
  const { incoming, busy, error, answer, reject, silent, setSilent } = usePhoneCalls();
  const call = incoming[0];
  if (!call) return null;

  const label = callPartyLabel(call, { formatPhone: formatPhoneNumber });
  const more = incoming.length > 1 ? ` +${incoming.length - 1}` : '';
  const banner = variant === 'banner';

  const onAnswer = async (row) => {
    try {
      await answer(row);
    } catch {
      // Error is shown from context on the Phone screen; keep the dock visible.
    }
  };
  const onReject = async (row) => {
    try {
      await reject(row);
    } catch {
      // Keep the dock visible so they can retry.
    }
  };

  if (collapsed && !banner) {
    return (
      <View style={styles.dockCollapsed} accessibilityLabel={`Incoming call from ${label}`}>
        <View style={styles.pulse}>
          <Ionicons name="call" size={14} color="#fff" />
        </View>
        <IncomingActions call={call} compact busy={busy} onAnswer={onAnswer} onReject={onReject} />
      </View>
    );
  }

  return (
    <View style={[styles.dock, banner && styles.dockBanner]} accessibilityLabel={`Incoming call from ${label}`}>
      <View style={styles.dockCopy}>
        <Text style={styles.kicker}>Incoming{more}</Text>
        <Text style={styles.caller} numberOfLines={1}>
          {label}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {call.storeName || 'Store'}
          {call.extensionNumber ? ` · ext ${call.extensionNumber}` : ''}
        </Text>
        {error ? (
          <Text style={styles.error} numberOfLines={3}>
            {error}
          </Text>
        ) : null}
      </View>
      <IncomingActions call={call} busy={busy} onAnswer={onAnswer} onReject={onReject} />
      <Pressable
        onPress={() => setSilent(!silent)}
        accessibilityLabel={silent ? 'Turn ringtone on' : 'Silence ringtone'}
        style={styles.ringer}
      >
        <Ionicons name={silent ? 'notifications-off' : 'notifications-outline'} size={14} color="#D1FAE5" />
        <Text style={[styles.ringerText, { color: '#D1FAE5' }]}>{silent ? 'Silent' : 'Ringtone on'}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  dock: {
    width: '100%',
    borderRadius: 12,
    backgroundColor: '#14532D',
    padding: 10,
    gap: 10,
  },
  dockBanner: {
    marginHorizontal: 12,
    marginBottom: 8,
  },
  dockCollapsed: {
    width: '100%',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
  },
  dockCopy: {
    gap: 2,
  },
  kicker: {
    fontFamily,
    fontSize: 10,
    fontWeight: '700',
    color: '#BBF7D0',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  caller: {
    fontFamily,
    fontSize: 13,
    fontWeight: '700',
    color: '#fff',
  },
  meta: {
    fontFamily,
    fontSize: 11,
    color: '#D1FAE5',
  },
  error: {
    fontFamily,
    fontSize: 11,
    color: '#FECACA',
    marginTop: 4,
  },
  pulse: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
  },
  actionsCompact: {
    gap: 6,
    alignItems: 'center',
  },
  action: {
    flex: 1,
    minHeight: 32,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 8,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  actionCompact: {
    flex: 0,
    width: 32,
    height: 32,
    paddingHorizontal: 0,
  },
  reject: {
    backgroundColor: '#B91C1C',
    flexGrow: 1,
  },
  answer: {
    backgroundColor: ACCENT,
    flexGrow: 1,
  },
  actionText: {
    fontFamily,
    fontSize: 12,
    fontWeight: '700',
    color: '#fff',
  },
  ringer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 28,
    paddingHorizontal: 4,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  ringerCollapsed: {
    justifyContent: 'center',
    paddingHorizontal: 0,
  },
  ringerText: {
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
    color: '#6e6e73',
  },
  ringerTextSilent: {
    color: '#991B1B',
  },
});
