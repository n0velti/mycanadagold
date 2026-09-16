import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import {
  callPartyLabel,
  controlPhoneCall,
  fetchPhoneInbox,
  fetchPhonePresence,
  isLiveAnsweredStatus,
  isRingingCall,
  liveLogEntry,
  mergeCallLog,
  sameInboundCall,
  startRingOut,
} from '../lib/phoneCalls';
import { PHONE_INBOX_MS, PHONE_LIVE_MS, useLiveRefresh } from '../lib/liveRefresh';
import { useAppAccess } from '../lib/permissions';
import { listRingCentralAccounts, formatPhoneNumber } from '../lib/ringcentral';
import { isStoreWatched, loadWatchStores, saveWatchStores } from '../lib/phoneWatch';
import { startRingtone, stopRingtone, unlockPhoneAudio } from '../lib/phoneSound';
import { storeKeyFromName } from '../lib/storeSettings';

const SILENT_KEY = 'cgold.phone.silent';
const ANSWERED_MS = 12_000;
const ACCENT = '#15803D';
const fontFamily = Platform.select({
  ios: 'Sohne',
  android: 'Sohne',
  default: 'Sohne',
});

function liveCallKey(call) {
  if (!call?.storeKey) return '';
  return `${call.storeKey}:${call.telephonySessionId || call.id}`;
}

const PhoneCallContext = createContext({
  stores: [],
  selectedStoreKey: '',
  setSelectedStoreKey: () => {},
  liveCalls: [],
  incoming: [],
  recentAnswered: [],
  inboxByStore: {},
  mergedCallsByStore: {},
  inboxFetching: {},
  refreshInbox: async () => {},
  watchPrefs: { mode: 'all', keys: [] },
  setStoreWatched: async () => {},
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
  const [watchPrefs, setWatchPrefs] = useState({ mode: 'all', keys: [] });
  const [recentAnswered, setRecentAnswered] = useState([]);
  const [inboxByStore, setInboxByStore] = useState({});
  const [liveLogByStore, setLiveLogByStore] = useState({});
  const [inboxFetching, setInboxFetching] = useState({});
  const [silent, setSilentState] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const requestId = useRef(0);
  const skipUntil = useRef(new Map());
  const inboxSkipUntil = useRef(new Map());
  const inboxInFlight = useRef(new Set());
  const inboxCursor = useRef(0);
  const ringingRef = useRef(new Map());
  const settledRef = useRef(new Set());
  const inboxByStoreRef = useRef(inboxByStore);
  inboxByStoreRef.current = inboxByStore;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [silentRaw, watch] = await Promise.all([
          AsyncStorage.getItem(SILENT_KEY),
          loadWatchStores(),
        ]);
        if (cancelled) return;
        setSilentState(silentRaw === '1');
        setWatchPrefs(watch);
      } catch {
        // Keep ringing on and watch every connected store.
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
    () => stores.filter((row) => row.hasJwt),
    [stores],
  );

  const watchedStores = useMemo(
    () => connectedStores.filter((row) => isStoreWatched(watchPrefs, row.storeKey)),
    [connectedStores, watchPrefs],
  );

  const setStoreWatched = useCallback(
    async (storeKey, on) => {
      const key = String(storeKey || '').trim();
      if (!key) return;
      const connectedKeys = connectedStores.map((row) => row.storeKey);
      setWatchPrefs((current) => {
        const baseKeys = current.mode === 'selected' ? current.keys : connectedKeys;
        const nextKeys = new Set(baseKeys);
        if (on) nextKeys.add(key);
        else nextKeys.delete(key);
        const next = { mode: 'selected', keys: [...nextKeys] };
        saveWatchStores(next).catch(() => {});
        return next;
      });
    },
    [connectedStores],
  );

  useEffect(() => {
    if (!active) {
      setStores([]);
      setLiveCalls([]);
      setInboxByStore({});
      setLiveLogByStore({});
      setInboxFetching({});
      ringingRef.current.clear();
      settledRef.current.clear();
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
      const now = Date.now();
      const preferred = selectedStoreKey || watchedStores[0]?.storeKey || connectedStores[0]?.storeKey;
      const watchKeys = new Set(watchedStores.map((row) => row.storeKey));
      if (preferred) watchKeys.add(preferred);
      const targets = connectedStores.filter(
        (row) => watchKeys.has(row.storeKey) && (skipUntil.current.get(row.storeKey) || 0) <= now,
      );
      const settled = await Promise.allSettled(
        targets.map(async (row) => {
          try {
            return await fetchPhonePresence(row.storeKey);
          } catch (err) {
            if (err?.status === 429 || /rate[- ]limit|rate exceeded|paused this phone line/i.test(err?.message || '')) {
              skipUntil.current.set(row.storeKey, Date.now() + 60_000);
            }
            throw err;
          }
        }),
      );
      if (id !== requestId.current) return;
      const succeeded = new Set();
      const next = [];
      for (const item of settled) {
        if (item.status !== 'fulfilled') continue;
        const key = item.value.store?.storeKey;
        if (key) succeeded.add(key);
        next.push(...(item.value.liveCalls || []));
        if (item.value.incoming) {
          const extras = item.value.incoming.filter(
            (call) => !next.some((row) => row.id === call.id && row.storeKey === call.storeKey),
          );
          next.push(...extras);
        }
      }
      setLiveCalls((current) => {
        const kept = current.filter((call) => !succeeded.has(call.storeKey));
        return [...kept, ...next];
      });
      if (succeeded.size) {
        setStores((current) => {
          let changed = false;
          const mapped = current.map((row) => {
            if (!succeeded.has(row.storeKey) || row.lastStatus === 'connected') return row;
            changed = true;
            return { ...row, lastStatus: 'connected', lastError: '' };
          });
          return changed ? mapped : current;
        });
      }
    },
    [active, connectedStores, selectedStoreKey, watchedStores],
  );

  useLiveRefresh(refreshPresence, PHONE_LIVE_MS, active && connectedStores.length > 0);

  useEffect(() => {
    if (!active || connectedStores.length === 0) return undefined;
    refreshPresence();
    return undefined;
  }, [active, connectedStores, refreshPresence]);

  const appendLiveLog = useCallback((entry) => {
    if (!entry?.storeKey || !entry?.id) return;
    setLiveLogByStore((current) => {
      const list = current[entry.storeKey] || [];
      if (list.some((row) => row.id === entry.id || sameInboundCall(row, entry))) return current;
      return { ...current, [entry.storeKey]: [entry, ...list].slice(0, 80) };
    });
  }, []);

  const refreshInbox = useCallback(
    async (storeKey, { silent = false, force = false } = {}) => {
      const key = storeKeyFromName(storeKey);
      if (!key) return null;
      if (!force && (inboxSkipUntil.current.get(key) || 0) > Date.now()) return null;
      if (inboxInFlight.current.has(key)) return null;
      inboxInFlight.current.add(key);
      if (!silent) {
        setInboxFetching((current) => ({ ...current, [key]: true }));
      }
      try {
        const payload = await fetchPhoneInbox(key);
        setInboxByStore((current) => ({
          ...current,
          [key]: {
            calls: payload.calls || [],
            voicemails: payload.voicemails || [],
            callLogError: payload.callLogError || '',
            voicemailError: payload.voicemailError || '',
            at: Date.now(),
          },
        }));
        setLiveLogByStore((current) => {
          const live = current[key] || [];
          if (!live.length) return current;
          const kept = live.filter((row) => !(payload.calls || []).some((call) => sameInboundCall(call, row)));
          if (kept.length === live.length) return current;
          return { ...current, [key]: kept };
        });
        const notes = [payload.callLogError, payload.voicemailError].filter(Boolean);
        if (notes.length) setError(notes.join(' '));
        return payload;
      } catch (err) {
        if (err?.status === 429 || /rate[- ]limit|rate exceeded|paused this phone line/i.test(err?.message || '')) {
          inboxSkipUntil.current.set(key, Date.now() + 60_000);
        }
        if (!silent) {
          setError(err?.message || 'Could not load calls.');
        }
        throw err;
      } finally {
        inboxInFlight.current.delete(key);
        if (!silent) {
          setInboxFetching((current) => {
            if (!current[key]) return current;
            const next = { ...current };
            delete next[key];
            return next;
          });
        }
      }
    },
    [],
  );

  const refreshInboxRound = useCallback(async () => {
    const preferred = selectedStoreKey;
    const others = watchedStores.map((row) => row.storeKey).filter((key) => key && key !== preferred);
    const keys = [];
    if (preferred) keys.push(preferred);
    if (others.length) {
      inboxCursor.current += 1;
      keys.push(others[(inboxCursor.current - 1) % others.length]);
    }
    for (const key of keys) {
      try {
        await refreshInbox(key, { silent: true });
      } catch {
        // Rate-limit skip or network; the next round retries.
      }
    }
  }, [refreshInbox, selectedStoreKey, watchedStores]);

  useLiveRefresh(refreshInboxRound, PHONE_INBOX_MS, active && connectedStores.length > 0);

  useEffect(() => {
    if (!active || !selectedStoreKey) return;
    refreshInbox(selectedStoreKey).catch(() => {});
  }, [active, refreshInbox, selectedStoreKey]);

  const watchKeyList = watchedStores.map((row) => row.storeKey).sort().join(',');

  useEffect(() => {
    if (!active || !watchKeyList) return undefined;
    let cancelled = false;
    const keys = watchKeyList.split(',').filter(Boolean);
    (async () => {
      for (const key of keys) {
        if (cancelled) return;
        const cached = inboxByStoreRef.current[key];
        if (cached && Date.now() - (cached.at || 0) < 60_000) continue;
        try {
          await refreshInbox(key, { silent: true });
        } catch {
          // Keep showing whatever we already have for this store.
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active, refreshInbox, watchKeyList]);

  const incoming = useMemo(
    () => liveCalls.filter((call) => isRingingCall(call) && isStoreWatched(watchPrefs, call.storeKey)),
    [liveCalls, watchPrefs],
  );

  const rememberAnswered = useCallback((call) => {
    if (!call) return;
    const item = {
      id: `${call.id}-${Date.now()}`,
      callId: call.id,
      storeKey: call.storeKey,
      storeName: call.storeName || 'Store',
      label: callPartyLabel(call, { formatPhone: formatPhoneNumber }),
      until: Date.now() + ANSWERED_MS,
    };
    setRecentAnswered((current) => [...current.filter((row) => row.callId !== call.id), item]);
  }, []);

  useEffect(() => {
    if (!active || connectedStores.length === 0) {
      ringingRef.current.clear();
      return;
    }
    const ringing = liveCalls.filter((call) => isRingingCall(call));
    const currentKeys = new Set(ringing.map(liveCallKey).filter(Boolean));

    for (const [key, prev] of [...ringingRef.current.entries()]) {
      if (currentKeys.has(key) || settledRef.current.has(key)) {
        if (currentKeys.has(key)) {
          ringingRef.current.set(key, ringing.find((call) => liveCallKey(call) === key) || prev);
        }
        continue;
      }
      const still = liveCalls.find((call) => liveCallKey(call) === key);
      const answered = still ? isLiveAnsweredStatus(still.status) : false;
      settledRef.current.add(key);
      ringingRef.current.delete(key);
      const source = still || prev;
      appendLiveLog(liveLogEntry(source, answered ? 'Accepted' : 'Missed'));
      if (answered) rememberAnswered(source);
    }

    for (const call of ringing) {
      const key = liveCallKey(call);
      if (key && !settledRef.current.has(key)) ringingRef.current.set(key, call);
    }

    if (settledRef.current.size > 200) {
      settledRef.current = new Set([...settledRef.current].slice(-100));
    }
  }, [active, appendLiveLog, connectedStores.length, liveCalls, rememberAnswered]);

  useEffect(() => {
    if (!recentAnswered.length) return undefined;
    const timer = setInterval(() => {
      const now = Date.now();
      setRecentAnswered((current) => {
        const next = current.filter((row) => row.until > now);
        return next.length === current.length ? current : next;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [recentAnswered.length]);

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

  const answer = useCallback(
    async (call) => {
      const key = liveCallKey(call);
      if (key) settledRef.current.add(key);
      try {
        const result = await runControl('answer', call);
        appendLiveLog(liveLogEntry(call, 'Accepted'));
        rememberAnswered(call);
        if (key) ringingRef.current.delete(key);
        return result;
      } catch (err) {
        if (key) settledRef.current.delete(key);
        throw err;
      }
    },
    [appendLiveLog, rememberAnswered, runControl],
  );
  const reject = useCallback(
    async (call) => {
      const key = liveCallKey(call);
      if (key) settledRef.current.add(key);
      try {
        const result = await runControl('reject', call);
        appendLiveLog(liveLogEntry(call, 'Rejected'));
        if (key) ringingRef.current.delete(key);
        return result;
      } catch (err) {
        if (key) settledRef.current.delete(key);
        throw err;
      }
    },
    [appendLiveLog, runControl],
  );
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

  const mergedCallsByStore = useMemo(() => {
    const keys = new Set([...Object.keys(inboxByStore), ...Object.keys(liveLogByStore)]);
    const next = {};
    for (const key of keys) {
      next[key] = mergeCallLog(inboxByStore[key]?.calls, liveLogByStore[key]);
    }
    return next;
  }, [inboxByStore, liveLogByStore]);

  const value = useMemo(
    () => ({
      stores: connectedStores,
      allStores: stores,
      selectedStoreKey,
      setSelectedStoreKey,
      liveCalls,
      incoming,
      recentAnswered,
      inboxByStore,
      mergedCallsByStore,
      inboxFetching,
      refreshInbox,
      watchPrefs,
      setStoreWatched,
      watchedStores,
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
      inboxByStore,
      inboxFetching,
      incoming,
      liveCalls,
      mergedCallsByStore,
      recentAnswered,
      refreshInbox,
      refreshPresence,
      reject,
      ringOut,
      selectedStoreKey,
      setSilent,
      setStoreWatched,
      silent,
      stores,
      watchPrefs,
      watchedStores,
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
  const { incoming, recentAnswered, busy, error, answer, reject } = usePhoneCalls();
  if (!incoming.length && !recentAnswered.length) return null;

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

  return (
    <View style={[styles.dock, collapsed && styles.dockCollapsed, banner && styles.dockBanner]}>
      {incoming.map((call) => {
        const label = callPartyLabel(call, { formatPhone: formatPhoneNumber });
        return (
          <View
            key={`${call.storeKey}-${call.id}`}
            style={[styles.dockRow, collapsed && styles.dockRowCollapsed]}
            accessibilityLabel={`Incoming call from ${label} at ${call.storeName || 'store'}`}
          >
            <View style={styles.dockCopy}>
              <Text style={styles.kicker} numberOfLines={1}>
                {call.storeName || 'Incoming'}
              </Text>
              {collapsed ? null : (
                <Text style={styles.caller} numberOfLines={1}>
                  {label}
                </Text>
              )}
            </View>
            <IncomingActions call={call} compact busy={busy} onAnswer={onAnswer} onReject={onReject} />
          </View>
        );
      })}
      {recentAnswered.map((row) => (
        <View key={row.id} style={[styles.dockRow, styles.dockRowAnswered, collapsed && styles.dockRowCollapsed]}>
          <View style={styles.dockCopy}>
            <Text style={styles.answeredKicker}>Answered</Text>
            {collapsed ? null : (
              <Text style={styles.answeredText} numberOfLines={1}>
                {row.storeName}
                {row.label ? ` · ${row.label}` : ''}
              </Text>
            )}
          </View>
        </View>
      ))}
      {error && incoming.length ? (
        <Text style={styles.error} numberOfLines={2}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  dock: {
    width: '100%',
    borderRadius: 10,
    backgroundColor: '#14532D',
    padding: 6,
    gap: 4,
  },
  dockBanner: {
    marginHorizontal: 12,
    marginBottom: 8,
  },
  dockCollapsed: {
    padding: 4,
    alignItems: 'stretch',
  },
  dockRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 32,
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  dockRowCollapsed: {
    justifyContent: 'center',
  },
  dockRowAnswered: {
    minHeight: 24,
  },
  dockCopy: {
    flex: 1,
    minWidth: 0,
    gap: 0,
  },
  kicker: {
    fontFamily,
    fontSize: 9,
    fontWeight: '700',
    color: '#BBF7D0',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  caller: {
    fontFamily,
    fontSize: 12,
    fontWeight: '700',
    color: '#fff',
  },
  answeredKicker: {
    fontFamily,
    fontSize: 9,
    fontWeight: '700',
    color: '#86EFAC',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  answeredText: {
    fontFamily,
    fontSize: 11,
    color: '#D1FAE5',
  },
  error: {
    fontFamily,
    fontSize: 11,
    color: '#FECACA',
    paddingHorizontal: 4,
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
    minHeight: 26,
    borderRadius: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: 6,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  actionCompact: {
    flex: 0,
    width: 26,
    height: 26,
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
