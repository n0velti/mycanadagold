import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import {
  callPartyLabel,
  controlPhoneCall,
  fetchPhoneInbox,
  fetchPhonePresence,
  fetchSipProvision,
  isLiveAnsweredStatus,
  isPhoneRateLimitMessage,
  isRingingCall,
  incomingCallBelongsToStore,
  liveLogEntry,
  mergeCallLog,
  sameInboundCall,
  startRingOut,
} from '../lib/phoneCalls';
import { PHONE_INBOX_MS, PHONE_LIVE_MS, useLiveRefresh } from '../lib/liveRefresh';
import { fetchTransferStores } from '../lib/locations';
import { useAppAccess } from '../lib/permissions';
import { listRingCentralAccounts, formatPhoneNumber } from '../lib/ringcentral';
import { isStoreWatched, loadWatchStores, saveWatchStores } from '../lib/phoneWatch';
import { startRingtone, stopRingtone, unlockPhoneAudio } from '../lib/phoneSound';
import { storeKeyFromName } from '../lib/storeSettings';
import { isWebPhoneSupported, startWebPhone } from '../lib/webPhone';

const SILENT_KEY = 'cgold.phone.silent';
const SIP_CACHE_PREFIX = 'cgold.phone.sip.';
const SIP_CACHE_MS = 7 * 24 * 60 * 60 * 1000;

function readSipCache(storeKey) {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(`${SIP_CACHE_PREFIX}${storeKey}`);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed?.sipInfo || Date.now() - (parsed.at || 0) > SIP_CACHE_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeSipCache(storeKey, value) {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;
  try {
    if (!value) window.localStorage.removeItem(`${SIP_CACHE_PREFIX}${storeKey}`);
    else window.localStorage.setItem(`${SIP_CACHE_PREFIX}${storeKey}`, JSON.stringify({ ...value, at: Date.now() }));
  } catch {
    // Provision again next time.
  }
}

function isMicrophoneError(err) {
  const text = `${err?.name || ''} ${err?.message || ''}`;
  return /NotAllowed|PermissionDenied|Permission denied|NotFound|getUserMedia|microphone|audio input/i.test(text);
}

function formatCallClock(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}
const ANSWERED_MS = 1_000;
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
  reloadStores: async () => [],
  applyStoreAccount: () => {},
  syncStoreAccounts: () => {},
  removeStoreAccount: () => {},
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
  activeCall: null,
  muted: false,
  toggleMute: () => {},
  webPhoneStatus: {},
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
  // Browser softphone: calls ringing on this tab's SIP registration, the call
  // in progress here, and each store's registration state.
  const [webCalls, setWebCalls] = useState([]);
  const [activeCall, setActiveCall] = useState(null);
  const [muted, setMuted] = useState(false);
  const [webPhoneStatus, setWebPhoneStatus] = useState({});
  const webPhonesRef = useRef(new Map());
  const webPhoneByExtensionRef = useRef(new Map());
  const requestId = useRef(0);
  const storesRequestId = useRef(0);
  const skipUntil = useRef(new Map());
  const inboxSkipUntil = useRef(new Map());
  const inboxInFlight = useRef(new Set());
  const inboxCursor = useRef(0);
  const ringingRef = useRef(new Map());
  const settledRef = useRef(new Set());
  const inboxByStoreRef = useRef(inboxByStore);
  inboxByStoreRef.current = inboxByStore;
  // Each store's published phone from the POS: the number that rings there.
  const [posPhones, setPosPhones] = useState({});
  const posPhonesRef = useRef(posPhones);
  posPhonesRef.current = posPhones;
  const sessionRef = useRef(session);
  sessionRef.current = session;

  useEffect(() => {
    if (!active) {
      setPosPhones({});
      return undefined;
    }
    let cancelled = false;
    (async () => {
      try {
        const { stores: posStores } = await fetchTransferStores(sessionRef.current);
        if (cancelled) return;
        const next = {};
        for (const store of posStores || []) {
          const key = storeKeyFromName(store?.name);
          if (key && store?.phone && !next[key]) next[key] = String(store.phone);
        }
        setPosPhones(next);
      } catch {
        // Without POS phones the server falls back to assigned RingCentral numbers.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active, session?.token]);

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
    () =>
      stores
        .filter((row) => row.hasJwt)
        .map((row) => ({ ...row, posPhone: posPhones[row.storeKey] || row.posPhone || '' })),
    [posPhones, stores],
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

  const watchStoreKey = useCallback((storeKey) => {
    const key = String(storeKey || '').trim();
    if (!key) return;
    setWatchPrefs((current) => {
      if (current.mode !== 'selected') return current;
      if (current.keys.includes(key)) return current;
      const next = { mode: 'selected', keys: [...current.keys, key] };
      saveWatchStores(next).catch(() => {});
      return next;
    });
  }, []);

  const applyStoreAccount = useCallback(
    (account, { select = false, watch = false } = {}) => {
      if (!account?.storeKey) return;
      setStores((current) => {
        const without = current.filter((row) => row.storeKey !== account.storeKey);
        return [...without, account];
      });
      if (!account.hasJwt) return;
      if (select) setSelectedStoreKey(account.storeKey);
      if (watch) watchStoreKey(account.storeKey);
    },
    [watchStoreKey],
  );

  const syncStoreAccounts = useCallback((rows) => {
    if (!Array.isArray(rows) || rows.length === 0) return;
    setStores((current) => {
      const map = new Map(current.map((row) => [row.storeKey, row]));
      for (const row of rows) {
        if (row?.storeKey) map.set(row.storeKey, row);
      }
      return [...map.values()];
    });
  }, []);

  const removeStoreAccount = useCallback((storeKey) => {
    const key = storeKeyFromName(storeKey);
    if (!key) return;
    setStores((current) => current.filter((row) => row.storeKey !== key));
    setInboxByStore((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
    setLiveLogByStore((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
    setLiveCalls((current) => current.filter((call) => call.storeKey !== key));
    setSelectedStoreKey((current) => (current === key ? '' : current));
  }, []);

  const reloadStores = useCallback(
    async ({ selectKey, watch = false } = {}) => {
      if (!active) {
        setStores([]);
        return [];
      }
      const id = ++storesRequestId.current;
      try {
        const { rows } = await listRingCentralAccounts();
        if (id !== storesRequestId.current) return rows || [];
        const list = rows || [];
        setStores(list);
        const preferred = storeKeyFromName(selectKey);
        const chosen = preferred
          ? list.find((row) => row.storeKey === preferred && row.hasJwt)
          : null;
        if (chosen) {
          setSelectedStoreKey(chosen.storeKey);
          if (watch) watchStoreKey(chosen.storeKey);
        }
        return list;
      } catch {
        return [];
      }
    },
    [active, watchStoreKey],
  );

  useEffect(() => {
    if (!active) {
      storesRequestId.current += 1;
      setStores([]);
      setLiveCalls([]);
      setInboxByStore({});
      setLiveLogByStore({});
      setInboxFetching({});
      ringingRef.current.clear();
      settledRef.current.clear();
      return undefined;
    }
    reloadStores();
    return undefined;
  }, [active, reloadStores, session?.token]);

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
            return await fetchPhonePresence(row.storeKey, { storePhone: row.posPhone });
          } catch (err) {
            if (err?.status === 429 || isPhoneRateLimitMessage(err?.message)) {
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
      if (!force && (inboxSkipUntil.current.get(key) || 0) > Date.now()) {
        return inboxByStoreRef.current[key] || null;
      }
      if (!force) {
        const cached = inboxByStoreRef.current[key];
        if (cached && Date.now() - (cached.at || 0) < PHONE_INBOX_MS) {
          return cached;
        }
      }
      if (inboxInFlight.current.has(key)) return inboxByStoreRef.current[key] || null;
      inboxInFlight.current.add(key);
      if (!silent) {
        setInboxFetching((current) => ({ ...current, [key]: true }));
      }
      try {
        const payload = await fetchPhoneInbox(key, { storePhone: posPhonesRef.current[key] || '' });
        const rateLimited =
          isPhoneRateLimitMessage(payload.callLogError) || isPhoneRateLimitMessage(payload.voicemailError);
        if (rateLimited) {
          inboxSkipUntil.current.set(key, Date.now() + 60_000);
          setError((current) => (isPhoneRateLimitMessage(current) ? '' : current));
          const existing = inboxByStoreRef.current[key];
          if (existing || !(payload.calls || []).length) return existing || null;
        }
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
        const notes = [payload.callLogError, payload.voicemailError].filter(
          (note) => note && !isPhoneRateLimitMessage(note),
        );
        if (notes.length && !silent) setError(notes.join(' '));
        return payload;
      } catch (err) {
        if (err?.status === 429 || isPhoneRateLimitMessage(err?.message)) {
          inboxSkipUntil.current.set(key, Date.now() + 60_000);
          setError((current) => (isPhoneRateLimitMessage(current) ? '' : current));
        }
        if (!silent && !isPhoneRateLimitMessage(err?.message)) {
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
    const others = connectedStores.map((row) => row.storeKey).filter((key) => key && key !== preferred);
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
  }, [connectedStores, refreshInbox, selectedStoreKey]);

  useLiveRefresh(refreshInboxRound, PHONE_INBOX_MS, active && connectedStores.length > 0);

  useEffect(() => {
    if (!active || !selectedStoreKey) return;
    refreshInbox(selectedStoreKey, { silent: true }).catch(() => {});
  }, [active, refreshInbox, selectedStoreKey]);

  const connectedKeyList = connectedStores.map((row) => row.storeKey).sort().join(',');

  useEffect(() => {
    if (!active || !connectedKeyList) return undefined;
    let cancelled = false;
    const keys = connectedKeyList.split(',').filter(Boolean);
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
  }, [active, connectedKeyList, refreshInbox]);

  // Register this tab as each connected store's phone (web only). One
  // registration per RingCentral extension: stores that share a JWT share it.
  const connectedNames = useMemo(
    () => Object.fromEntries(connectedStores.map((row) => [row.storeKey, row.storeName || row.storeKey])),
    [connectedStores],
  );
  const connectedNamesRef = useRef(connectedNames);
  connectedNamesRef.current = connectedNames;

  const setStorePhoneStatus = useCallback((storeKey, next) => {
    setWebPhoneStatus((current) => ({ ...current, [storeKey]: { ...(current[storeKey] || {}), ...next } }));
  }, []);

  const onWebInbound = useCallback((snapshot) => {
    setWebCalls((current) => [...current.filter((row) => row.id !== snapshot.id), snapshot]);
  }, []);

  const onWebChange = useCallback((snapshot) => {
    if (snapshot.ended) {
      setWebCalls((current) => current.filter((row) => row.id !== snapshot.id));
      setActiveCall((current) => (current && current.id === snapshot.id ? null : current));
      setMuted((current) => (current ? false : current));
      return;
    }
    setWebCalls((current) => current.map((row) => (row.id === snapshot.id ? { ...row, ...snapshot } : row)));
    if (snapshot.status === 'CallConnected') {
      setActiveCall((current) =>
        current && current.id === snapshot.id ? current : { ...snapshot, answeredAt: Date.now() },
      );
    }
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'web') return undefined;
    const disposeAll = () => {
      for (const handle of webPhonesRef.current.values()) handle.dispose().catch(() => {});
      webPhonesRef.current.clear();
      webPhoneByExtensionRef.current.clear();
    };
    if (!active || !connectedKeyList) {
      disposeAll();
      setWebPhoneStatus({});
      setWebCalls([]);
      setActiveCall(null);
      return undefined;
    }
    if (!isWebPhoneSupported) {
      setWebPhoneStatus(
        Object.fromEntries(
          connectedKeyList
            .split(',')
            .filter(Boolean)
            .map((key) => [key, { state: 'unsupported', message: 'This browser cannot act as a phone.' }]),
        ),
      );
      return undefined;
    }
    let cancelled = false;
    const keys = connectedKeyList.split(',').filter(Boolean);

    // Drop registrations for stores that are no longer connected.
    for (const [storeKey, handle] of [...webPhonesRef.current.entries()]) {
      if (keys.includes(storeKey)) continue;
      handle.dispose().catch(() => {});
      webPhonesRef.current.delete(storeKey);
      for (const [extId, owner] of [...webPhoneByExtensionRef.current.entries()]) {
        if (owner === storeKey) webPhoneByExtensionRef.current.delete(extId);
      }
    }

    const register = async (storeKey) => {
      if (webPhonesRef.current.has(storeKey)) return;
      setStorePhoneStatus(storeKey, { state: 'connecting', message: '' });
      let provision = readSipCache(storeKey);
      for (let attempt = 0; attempt < 2 && !cancelled; attempt += 1) {
        try {
          if (!provision) {
            provision = await fetchSipProvision(storeKey);
            writeSipCache(storeKey, provision);
          }
          if (cancelled) return;
          const owner = webPhoneByExtensionRef.current.get(provision.extensionId || '');
          if (owner && owner !== storeKey && webPhonesRef.current.has(owner)) {
            setStorePhoneStatus(storeKey, {
              state: 'shared',
              message: `Rings through ${connectedNamesRef.current[owner] || owner}’s line (same RingCentral user).`,
              extensionName: provision.extensionName,
            });
            return;
          }
          const storeName = connectedNamesRef.current[storeKey] || storeKey;
          const handle = await startWebPhone({
            sipInfo: provision.sipInfo,
            extensionId: provision.extensionId,
            storeKey,
            storeName,
            onInbound: onWebInbound,
            onChange: onWebChange,
          });
          if (cancelled) {
            handle.dispose().catch(() => {});
            return;
          }
          webPhonesRef.current.set(storeKey, handle);
          if (provision.extensionId) webPhoneByExtensionRef.current.set(provision.extensionId, storeKey);
          setStorePhoneStatus(storeKey, { state: 'ready', message: '', extensionName: provision.extensionName });
          return;
        } catch (err) {
          if (cancelled) return;
          const message = err?.message || 'Could not register this browser as the store phone.';
          if (err?.code === 'ringcentral_other_extension' || err?.status === 409) {
            setStorePhoneStatus(storeKey, { state: 'other', message });
            return;
          }
          // A cached registration may have been revoked: provision once more.
          writeSipCache(storeKey, null);
          provision = null;
          if (attempt === 1 || err?.status === 429) {
            setStorePhoneStatus(storeKey, { state: 'error', message });
            return;
          }
        }
      }
    };

    (async () => {
      for (const key of keys) {
        if (cancelled) return;
        await register(key);
      }
    })();

    const onHide = () => disposeAll();
    window.addEventListener('pagehide', onHide);
    return () => {
      cancelled = true;
      window.removeEventListener('pagehide', onHide);
    };
  }, [active, connectedKeyList, onWebChange, onWebInbound, setStorePhoneStatus]);

  useEffect(
    () => () => {
      for (const handle of webPhonesRef.current.values()) handle.dispose().catch(() => {});
      webPhonesRef.current.clear();
    },
    [],
  );

  // Presence (8 s poll) plus calls the softphone already knows about.
  const allLiveCalls = useMemo(() => {
    if (!webCalls.length) return liveCalls;
    const merged = liveCalls.map((call) => {
      const web = webCalls.find(
        (row) => row.storeKey === call.storeKey && (row.telephonySessionId || row.id) === (call.telephonySessionId || call.id),
      );
      if (!web) return call;
      return {
        ...call,
        partyId: call.partyId || web.partyId,
        status: web.status === 'CallConnected' ? web.status : call.status,
        web: true,
      };
    });
    for (const web of webCalls) {
      const known = merged.some(
        (call) => call.storeKey === web.storeKey && (call.telephonySessionId || call.id) === (web.telephonySessionId || web.id),
      );
      if (!known) merged.push(web);
    }
    return merged;
  }, [liveCalls, webCalls]);

  const webSessionFor = useCallback((call) => {
    const handle = webPhonesRef.current.get(call?.storeKey);
    if (!handle) return null;
    return handle.session(call?.telephonySessionId || call?.id) || null;
  }, []);

  const incoming = useMemo(() => {
    const ringing = allLiveCalls.filter((call) => {
      if (!isRingingCall(call) || !isStoreWatched(watchPrefs, call.storeKey)) return false;
      const store = connectedStores.find((row) => row.storeKey === call.storeKey);
      return incomingCallBelongsToStore(call, store);
    });
    const seen = new Set();
    const unique = [];
    for (const call of ringing) {
      const key = `${call.telephonySessionId || call.id}:${call.from || ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(call);
    }
    return unique;
  }, [allLiveCalls, connectedStores, watchPrefs]);

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
    const ringing = allLiveCalls.filter((call) => isRingingCall(call));
    const currentKeys = new Set(ringing.map(liveCallKey).filter(Boolean));

    for (const [key, prev] of [...ringingRef.current.entries()]) {
      if (currentKeys.has(key) || settledRef.current.has(key)) {
        if (currentKeys.has(key)) {
          ringingRef.current.set(key, ringing.find((call) => liveCallKey(call) === key) || prev);
        }
        continue;
      }
      const still = allLiveCalls.find((call) => liveCallKey(call) === key);
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
  }, [active, allLiveCalls, appendLiveLog, connectedStores.length, rememberAnswered]);

  useEffect(() => {
    if (!recentAnswered.length) return undefined;
    const nextUntil = Math.min(...recentAnswered.map((row) => row.until));
    const timer = setTimeout(() => {
      const now = Date.now();
      setRecentAnswered((current) => current.filter((row) => row.until > now));
    }, Math.max(0, nextUntil - Date.now()));
    return () => clearTimeout(timer);
  }, [recentAnswered]);

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

  /** Why Answer has to fall back to a RingCentral device for this store. */
  const webPhoneFallbackReason = useCallback(
    (storeKey) => {
      if (Platform.OS !== 'web') return 'Answering in the app works in the web version; pick up on the RingCentral app or desk phone.';
      const status = webPhoneStatus[storeKey];
      if (!status || status.state === 'connecting') {
        return 'This browser is still registering as the store phone. Try again in a moment, or pick up on the RingCentral app.';
      }
      if (status.state === 'ready' || status.state === 'shared') {
        return 'That call is not ringing this browser. Pick up on the RingCentral app or desk phone, or send it to voicemail.';
      }
      return status.message || 'This browser is not registered as the store phone.';
    },
    [webPhoneStatus],
  );

  const answer = useCallback(
    async (call) => {
      const key = liveCallKey(call);
      if (key) settledRef.current.add(key);
      const session = webSessionFor(call);
      if (session && session.state === 'ringing') {
        setBusy(true);
        setError('');
        try {
          await session.answer();
          const connected = { ...call, status: 'CallConnected', web: true, answeredAt: Date.now() };
          setActiveCall(connected);
          setMuted(false);
          setWebCalls((current) =>
            current.map((row) => (row.id === (call.telephonySessionId || call.id) ? { ...row, status: 'CallConnected' } : row)),
          );
          appendLiveLog(liveLogEntry(call, 'Accepted'));
          rememberAnswered(call);
          if (key) ringingRef.current.delete(key);
          return { ok: true, liveCalls: [] };
        } catch (err) {
          if (key) settledRef.current.delete(key);
          const message = isMicrophoneError(err)
            ? 'Allow microphone access for this site in the browser, then press Answer again.'
            : err?.message || 'Could not answer in the browser.';
          setError(message);
          throw new Error(message);
        } finally {
          setBusy(false);
        }
      }
      try {
        const result = await runControl('answer', call);
        appendLiveLog(liveLogEntry(call, 'Accepted'));
        rememberAnswered(call);
        if (key) ringingRef.current.delete(key);
        return result;
      } catch {
        // RingCentral could not ring a device for this line; explain what to do instead.
        if (key) settledRef.current.delete(key);
        const reason = webPhoneFallbackReason(call?.storeKey);
        setError(reason);
        throw new Error(reason);
      }
    },
    [appendLiveLog, rememberAnswered, runControl, webPhoneFallbackReason, webSessionFor],
  );
  const reject = useCallback(
    async (call) => {
      const key = liveCallKey(call);
      if (key) settledRef.current.add(key);
      const session = webSessionFor(call);
      if (session && session.state === 'ringing') {
        setBusy(true);
        setError('');
        try {
          try {
            await session.toVoicemail();
          } catch {
            await session.decline();
          }
          setWebCalls((current) => current.filter((row) => row.id !== (call.telephonySessionId || call.id)));
          appendLiveLog(liveLogEntry(call, 'Rejected'));
          if (key) ringingRef.current.delete(key);
          return { ok: true, liveCalls: [] };
        } catch (err) {
          if (key) settledRef.current.delete(key);
          setError(err?.message || 'Could not reject the call.');
          throw err;
        } finally {
          setBusy(false);
        }
      }
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
    [appendLiveLog, runControl, webSessionFor],
  );
  const hangup = useCallback(
    async (call) => {
      const target = call || activeCall;
      const session = webSessionFor(target);
      if (session && session.state === 'answered') {
        setBusy(true);
        setError('');
        try {
          await session.hangup();
          setActiveCall((current) => (current && current.id === target.id ? null : current));
          setMuted(false);
          return { ok: true, liveCalls: [] };
        } catch (err) {
          setError(err?.message || 'Could not hang up.');
          throw err;
        } finally {
          setBusy(false);
        }
      }
      return runControl('hangup', target);
    },
    [activeCall, runControl, webSessionFor],
  );
  const toggleMute = useCallback(() => {
    const session = webSessionFor(activeCall);
    if (!session || session.state !== 'answered') return;
    if (muted) session.unmute();
    else session.mute();
    setMuted(!muted);
  }, [activeCall, muted, webSessionFor]);

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
      liveCalls: allLiveCalls,
      incoming,
      recentAnswered,
      activeCall,
      muted,
      toggleMute,
      webPhoneStatus,
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
      reloadStores,
      applyStoreAccount,
      syncStoreAccounts,
      removeStoreAccount,
    }),
    [
      activeCall,
      allLiveCalls,
      answer,
      applyStoreAccount,
      syncStoreAccounts,
      busy,
      connectedStores,
      error,
      hangup,
      inboxByStore,
      inboxFetching,
      incoming,
      mergedCallsByStore,
      muted,
      toggleMute,
      webPhoneStatus,
      recentAnswered,
      refreshInbox,
      refreshPresence,
      reject,
      reloadStores,
      removeStoreAccount,
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
      <Ionicons name={silent ? 'volume-mute' : 'volume-high'} size={16} color={silent ? '#991B1B' : '#6e6e73'} />
      {collapsed ? null : (
        <Text style={[styles.ringerText, silent && styles.ringerTextSilent]}>
          {silent ? 'Silent' : 'Ringtone on'}
        </Text>
      )}
    </Pressable>
  );
}

function CallClock({ since }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <Text style={styles.clock} numberOfLines={1}>
      {formatCallClock(now - (since || now))}
    </Text>
  );
}

function ActiveCallRow({ call, collapsed, busy, muted, onMute, onHangup }) {
  const label = callPartyLabel(call, { formatPhone: formatPhoneNumber });
  return (
    <View
      style={[styles.dockRow, styles.dockRowActive, collapsed && styles.dockRowCollapsed]}
      accessibilityLabel={`On a call with ${label} at ${call.storeName || 'store'}`}
    >
      <View style={styles.dockCopy}>
        <Text style={styles.kicker} numberOfLines={1}>
          On call · {call.storeName || 'Store'}
        </Text>
        {collapsed ? null : (
          <View style={styles.activeLine}>
            <Text style={styles.caller} numberOfLines={1}>
              {label}
            </Text>
            <CallClock since={call.answeredAt} />
          </View>
        )}
      </View>
      <View style={styles.actionsCompact}>
        <Pressable
          style={[styles.action, styles.actionCompact, muted ? styles.muteOn : styles.mute]}
          onPress={onMute}
          disabled={busy}
          accessibilityLabel={muted ? 'Unmute microphone' : 'Mute microphone'}
        >
          <Ionicons name={muted ? 'mic-off' : 'mic'} size={14} color="#fff" />
        </Pressable>
        <Pressable
          style={[styles.action, styles.reject, styles.actionCompact]}
          onPress={onHangup}
          disabled={busy}
          accessibilityLabel="Hang up"
        >
          {busy ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="call" size={14} color="#fff" style={styles.hangupIcon} />}
        </Pressable>
      </View>
    </View>
  );
}

export function PhoneIncomingDock({ collapsed = false, variant = 'sidebar' }) {
  const { incoming, recentAnswered, activeCall, muted, toggleMute, busy, error, answer, reject, hangup } =
    usePhoneCalls();
  if (!incoming.length && !recentAnswered.length && !activeCall) return null;

  const banner = variant === 'banner';
  const onHangup = async () => {
    try {
      await hangup(activeCall);
    } catch {
      // Error is shown below.
    }
  };

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
      {activeCall ? (
        <ActiveCallRow
          call={activeCall}
          collapsed={collapsed}
          busy={busy}
          muted={muted}
          onMute={toggleMute}
          onHangup={onHangup}
        />
      ) : null}
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
      {error && (incoming.length || activeCall) ? (
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
  dockRowActive: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 8,
  },
  activeLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minWidth: 0,
  },
  clock: {
    fontFamily,
    fontSize: 11,
    color: '#BBF7D0',
    fontVariant: ['tabular-nums'],
  },
  mute: {
    backgroundColor: 'rgba(255, 255, 255, 0.22)',
  },
  muteOn: {
    backgroundColor: '#B45309',
  },
  hangupIcon: {
    transform: [{ rotate: '135deg' }],
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
