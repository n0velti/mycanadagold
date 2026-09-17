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
  isCallGoneError,
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
import { isWebPhoneSupported, startWebPhone, withSipTimeout } from '../lib/webPhone';

const SILENT_KEY = 'cgold.phone.silent';
const SIP_CACHE_PREFIX = 'cgold.phone.sip.';
const SIP_CACHE_MS = 7 * 24 * 60 * 60 * 1000;
/**
 * After RingCentral cancels the INVITE here (caller hung up, answered
 * elsewhere, queue moved on), presence keeps reporting the call for up to two
 * poll cycles. Hide those rows for this long so nobody acts on a dead party.
 */
const GONE_MS = 30_000;
/** Answering waits on the microphone prompt, so give it longer than other SIP actions. */
const ANSWER_TIMEOUT_MS = 30_000;
const CALL_GONE_MESSAGE = 'That call already ended or was picked up elsewhere.';

function callSessionKey(call) {
  return String(call?.telephonySessionId || call?.id || '');
}

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

/**
 * Firefox and Safari report a microphone blocked by the site's
 * Permissions-Policy header (or a non-HTTPS page) as a SecurityError whose
 * message is just "The operation is insecure."
 */
function isMicrophoneBlockedError(err) {
  const text = `${err?.name || ''} ${err?.message || ''}`;
  return /SecurityError|operation is insecure|permissions policy|feature policy/i.test(text);
}

function answerErrorMessage(err) {
  if (isMicrophoneBlockedError(err)) {
    return 'The microphone is blocked for this site (open it over HTTPS and check the host’s Permissions-Policy header allows microphone=(self)). Pick up on the RingCentral app for now.';
  }
  if (isMicrophoneError(err)) return 'Allow microphone access for this site in the browser, then press Answer again.';
  if (err?.code === 'sip_timeout') {
    return 'RingCentral did not confirm the answer. The call may have ended; if it is still ringing, try again.';
  }
  return err?.message || 'Could not answer in the browser.';
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
  const [rawLiveCalls, setLiveCalls] = useState([]);
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
  // This browser's RingCentral device per store, so a server-side Answer can
  // push the call to this tab instead of whatever device is listed first.
  const webDeviceIdRef = useRef(new Map());
  // Telephony sessions RingCentral already cancelled here → hidden until GONE_MS passes.
  const goneRef = useRef(new Map());
  const [goneVersion, setGoneVersion] = useState(0);
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
      goneRef.current.clear();
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

  const markGone = useCallback((id) => {
    const key = String(id || '');
    if (!key) return;
    goneRef.current.set(key, Date.now());
    if (goneRef.current.size > 100) {
      const cutoff = Date.now() - GONE_MS;
      for (const [k, at] of goneRef.current.entries()) if (at < cutoff) goneRef.current.delete(k);
    }
    setGoneVersion((v) => v + 1);
  }, []);

  /** Drop a call from every local list: it is over as far as this browser is concerned. */
  const dropCall = useCallback(
    (call) => {
      const id = callSessionKey(call);
      if (!id) return;
      markGone(id);
      setWebCalls((current) => current.filter((row) => callSessionKey(row) !== id));
      setLiveCalls((current) => current.filter((row) => callSessionKey(row) !== id));
      setActiveCall((current) => (current && callSessionKey(current) === id ? null : current));
      setMuted((current) => (current ? false : current));
    },
    [markGone],
  );

  const onWebInbound = useCallback((snapshot) => {
    // A fresh INVITE for a session we hid (queue re-ring) makes it live again.
    if (goneRef.current.delete(snapshot.id)) setGoneVersion((v) => v + 1);
    setWebCalls((current) => [...current.filter((row) => row.id !== snapshot.id), snapshot]);
  }, []);

  const onWebChange = useCallback(
    (snapshot) => {
      if (snapshot.ended) {
        markGone(snapshot.id);
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
        setError('');
      }
    },
    [markGone],
  );

  useEffect(() => {
    if (Platform.OS !== 'web') return undefined;
    const disposeAll = () => {
      for (const handle of webPhonesRef.current.values()) handle.dispose().catch(() => {});
      webPhonesRef.current.clear();
      webPhoneByExtensionRef.current.clear();
      webDeviceIdRef.current.clear();
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
      webDeviceIdRef.current.delete(storeKey);
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
          if (provision.deviceId) webDeviceIdRef.current.set(storeKey, provision.deviceId);
          const owner = webPhoneByExtensionRef.current.get(provision.extensionId || '');
          if (owner && owner !== storeKey && webPhonesRef.current.has(owner)) {
            setStorePhoneStatus(storeKey, {
              state: 'shared',
              sharedWith: owner,
              message: `Rings through ${connectedNamesRef.current[owner] || owner}’s line (same RingCentral user).`,
              extensionName: provision.extensionName,
            });
            return;
          }
          const storeName = connectedNamesRef.current[storeKey] || storeKey;
          let handle = null;
          handle = await startWebPhone({
            sipInfo: provision.sipInfo,
            extensionId: provision.extensionId,
            storeKey,
            storeName,
            onInbound: onWebInbound,
            onChange: onWebChange,
            onStatus: (state, message) => {
              // Only the live registration for this store may report its state
              // (handles outlive this effect run, so `cancelled` is not checked).
              if (handle && webPhonesRef.current.get(storeKey) !== handle) return;
              setStorePhoneStatus(storeKey, { state, message: message || '' });
            },
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

  // Presence (8 s poll) plus calls the softphone already knows about. Presence
  // rows for sessions RingCentral already cancelled here are hidden: acting on
  // them only yields "Incorrect State" from the call-control API.
  const allLiveCalls = useMemo(() => {
    const now = Date.now();
    const gone = (call) => {
      const at = goneRef.current.get(callSessionKey(call));
      return Boolean(at) && now - at < GONE_MS;
    };
    const liveCalls = rawLiveCalls.filter((call) => !gone(call));
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
    // goneVersion re-runs this when a session is hidden or re-rings.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawLiveCalls, webCalls, goneVersion]);

  /**
   * The SIP session for a call, whichever store's registration it rang on:
   * stores sharing a RingCentral user share one registration.
   */
  const webSessionFor = useCallback((call) => {
    if (!call) return null;
    const ids = [call.telephonySessionId, call.id, call.partyId, call.callId].filter(Boolean);
    if (!ids.length) return null;
    const own = webPhonesRef.current.get(call.storeKey);
    const handles = own
      ? [own, ...[...webPhonesRef.current.values()].filter((h) => h !== own)]
      : [...webPhonesRef.current.values()];
    for (const handle of handles) {
      for (const id of ids) {
        const session = handle.session(id);
        if (session) return session;
      }
    }
    return null;
  }, []);

  /** The registration that would ring for this store, and this browser's device on it. */
  const webPhoneFor = useCallback(
    (storeKey) => {
      const status = webPhoneStatus[storeKey];
      const owner = status?.state === 'shared' && status.sharedWith ? status.sharedWith : storeKey;
      return {
        handle: webPhonesRef.current.get(owner) || null,
        deviceId: webDeviceIdRef.current.get(storeKey) || webDeviceIdRef.current.get(owner) || '',
        state: status?.state || '',
      };
    },
    [webPhoneStatus],
  );

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

  /** One call action at a time; `busy` and `error` always settle, even on a lost SIP reply. */
  const perform = useCallback(async (fn) => {
    setBusy(true);
    setError('');
    try {
      return await fn();
    } catch (err) {
      setError(err?.message || 'Could not update that call.');
      throw err;
    } finally {
      setBusy(false);
    }
  }, []);

  /**
   * RingCentral call-control API. A party that is no longer in a controllable
   * state is removed locally and surfaces as a `call_gone` error.
   */
  const runControl = useCallback(
    async (action, call, extra) => {
      if (!call) throw new Error('That call is no longer available.');
      try {
        const result = await controlPhoneCall(action, call, extra);
        setLiveCalls((current) => {
          const others = current.filter((row) => row.storeKey !== call.storeKey);
          return [...others, ...(result.liveCalls || [])];
        });
        return result;
      } catch (err) {
        if (isCallGoneError(err)) {
          dropCall(call);
          const gone = new Error(CALL_GONE_MESSAGE);
          gone.code = 'call_gone';
          throw gone;
        }
        throw err;
      }
    },
    [dropCall],
  );

  /** Why Answer could not take the call in this browser. */
  const webPhoneFallbackReason = useCallback(
    (storeKey, err) => {
      if (Platform.OS !== 'web') return 'Answering in the app works in the web version; pick up on the RingCentral app or desk phone.';
      const status = webPhoneStatus[storeKey];
      const raw = String(err?.message || '');
      const detail = raw && raw.length <= 90 ? ` (${raw.replace(/\.$/, '')})` : '';
      if (!status || status.state === 'connecting') {
        return 'This browser is still registering as the store phone. Try again in a moment, or pick up on the RingCentral app.';
      }
      if (status.state === 'reconnecting') {
        return 'This browser lost its connection to RingCentral and is reconnecting. Pick up on the RingCentral app, or try again in a moment.';
      }
      if (status.state === 'ready' || status.state === 'shared') {
        return `That call is not ringing this browser${detail}. Pick up on the RingCentral app or desk phone, or send it to voicemail.`;
      }
      return status.message || 'This browser is not registered as the store phone.';
    },
    [webPhoneStatus],
  );

  /** Record the outcome of a ringing call once, whichever path settled it. */
  const settleRinging = useCallback(
    (call, result) => {
      const key = liveCallKey(call);
      if (key) {
        settledRef.current.add(key);
        ringingRef.current.delete(key);
      }
      appendLiveLog(liveLogEntry(call, result));
      if (result === 'Accepted') rememberAnswered(call);
    },
    [appendLiveLog, rememberAnswered],
  );

  const answer = useCallback(
    (call) =>
      perform(async () => {
        if (!call) throw new Error('That call is no longer available.');
        const connected = () => ({ ...call, status: 'CallConnected', web: true, answeredAt: Date.now() });
        const session = webSessionFor(call);

        if (session?.state === 'answered') {
          // RingCentral already pushed it here (auto-answer) while the card still showed Ringing.
          setActiveCall((current) => current || connected());
          settleRinging(call, 'Accepted');
          return { ok: true, liveCalls: [] };
        }

        if (session?.state === 'ringing') {
          try {
            await withSipTimeout(session.answer(), 'answer', ANSWER_TIMEOUT_MS);
          } catch (err) {
            throw new Error(answerErrorMessage(err));
          }
          setActiveCall(connected());
          setMuted(false);
          setWebCalls((current) =>
            current.map((row) => (callSessionKey(row) === callSessionKey(call) ? { ...row, status: 'CallConnected' } : row)),
          );
          settleRinging(call, 'Accepted');
          return { ok: true, liveCalls: [] };
        }

        // Not ringing this tab's SIP registration. Ask RingCentral to hand the
        // call to this browser's device (it arrives as an auto-answered INVITE);
        // without one, the line's first device picks up.
        const { deviceId, state } = webPhoneFor(call.storeKey);
        try {
          const result = await runControl('answer', call, {
            deviceId: state === 'ready' || state === 'shared' ? deviceId : '',
          });
          settleRinging(call, 'Accepted');
          return result;
        } catch (err) {
          if (err?.code === 'call_gone') throw err;
          throw new Error(webPhoneFallbackReason(call.storeKey, err));
        }
      }),
    [perform, runControl, settleRinging, webPhoneFallbackReason, webPhoneFor, webSessionFor],
  );

  const reject = useCallback(
    (call) =>
      perform(async () => {
        if (!call) throw new Error('That call is no longer available.');
        const done = () => {
          settleRinging(call, 'Rejected');
          dropCall(call);
          return { ok: true, liveCalls: [] };
        };
        const session = webSessionFor(call);
        if (session?.state === 'ringing') {
          try {
            await withSipTimeout(session.toVoicemail(), 'send to voicemail');
            return done();
          } catch {
            // Queue legs do not always honour the voicemail command; decline the INVITE instead.
          }
          try {
            await withSipTimeout(session.decline(), 'decline');
            return done();
          } catch {
            // Fall through to the call-control API.
          }
        }
        try {
          await runControl('reject', call);
          return done();
        } catch (err) {
          // Already over (answered elsewhere, voicemail, caller hung up), or the
          // SIP leg here stopped ringing: either way there is nothing left to reject.
          if (err?.code === 'call_gone' || session) return done();
          throw err;
        }
      }),
    [dropCall, perform, runControl, settleRinging, webSessionFor],
  );

  const hangup = useCallback(
    (call) =>
      perform(async () => {
        const target = call || activeCall;
        if (!target) throw new Error('There is no call to hang up.');
        const id = callSessionKey(target);
        const done = () => {
          setActiveCall((current) => (current && callSessionKey(current) === id ? null : current));
          setMuted(false);
          markGone(id);
          return { ok: true, liveCalls: [] };
        };
        const session = webSessionFor(target);
        if (session) {
          try {
            if (session.state === 'answered') await withSipTimeout(session.hangup(), 'hang up');
            else await withSipTimeout(session.decline(), 'decline');
          } catch {
            // No BYE reply (socket dropped mid-call): release the media here and
            // ask RingCentral to drop the party so the caller is not left hanging.
            try {
              session.dispose();
            } catch {
              // Already released.
            }
            if (target.telephonySessionId && target.partyId) {
              await runControl('hangup', target).catch(() => {});
            }
          }
          return done();
        }
        if (target.web) return done(); // Browser call whose SIP leg already ended.
        try {
          await runControl('hangup', target);
          return done();
        } catch (err) {
          if (err?.code === 'call_gone') return done();
          throw err;
        }
      }),
    [activeCall, markGone, perform, runControl, webSessionFor],
  );

  const toggleMute = useCallback(() => {
    const session = webSessionFor(activeCall);
    if (!session || session.state !== 'answered') return;
    try {
      if (muted) session.unmute();
      else session.mute();
      setMuted(!muted);
    } catch {
      // Media already released.
    }
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
