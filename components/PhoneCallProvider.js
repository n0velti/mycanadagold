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
  isPhoneRateLimitMessage,
  liveLogEntry,
  mergeCallLog,
  sameInboundCall,
  startRingOut,
} from '../lib/phoneCalls';
import {
  applyPresence,
  applySipCall,
  browserCalls,
  callKey,
  clearStore,
  createCallState,
  endCall,
  expirePresence,
  isConnectedStatus,
  isDialingStatus,
  isRingingStatus,
  listCalls,
  markAnswered,
  patchCall,
  pruneEnded,
  rekeyCall,
  ringingCalls,
} from '../lib/callState';
import { PHONE_INBOX_MS, PHONE_LIVE_MS, useLiveRefresh } from '../lib/liveRefresh';
import { fetchTransferStores } from '../lib/locations';
import { useAppAccess } from '../lib/permissions';
import { listRingCentralAccounts, formatPhoneNumber } from '../lib/ringcentral';
import { isStoreWatched, loadWatchStores, saveWatchStores } from '../lib/phoneWatch';
import { startRingtone, stopRingtone, unlockPhoneAudio } from '../lib/phoneSound';
import { storeKeyFromName } from '../lib/storeSettings';
import { ensureMicrophone, isWebPhoneSupported, startWebPhone } from '../lib/webPhone';

const SILENT_KEY = 'cgold.phone.silent';
const SIP_CACHE_PREFIX = 'cgold.phone.sip.';
const SIP_CACHE_MS = 7 * 24 * 60 * 60 * 1000;
const CALL_GONE_MESSAGE = 'That call already ended or was picked up elsewhere.';
const ANSWERED_MS = 1_000;
const ACCENT = '#15803D';
const fontFamily = Platform.select({
  ios: 'Sohne',
  android: 'Sohne',
  default: 'Sohne',
});

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
  return /NotAllowed|PermissionDenied|Permission denied|NotFound|NotReadable|getUserMedia|microphone|audio input/i.test(text);
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

function microphoneMessage(err, action = 'answer') {
  if (isMicrophoneBlockedError(err)) {
    return 'The microphone is blocked for this site (open it over HTTPS and check the host’s Permissions-Policy header allows microphone=(self)). Pick up on the RingCentral app for now.';
  }
  if (isMicrophoneError(err)) {
    return `Allow microphone access for this site in the browser, then press ${action === 'call' ? 'Call' : 'Answer'} again.`;
  }
  return '';
}

function answerErrorMessage(err) {
  const mic = microphoneMessage(err, 'answer');
  if (mic) return mic;
  if (err?.code === 'sip_timeout') {
    return 'RingCentral did not confirm the answer. The call may have ended; if it is still ringing, try again.';
  }
  return err?.message || 'Could not answer in the browser.';
}

/** RingCentral's SIP side wants `16505550100`, never `+1 (650) …`. */
function sipCallee(value) {
  const raw = String(value || '').trim();
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 10) return `1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return digits;
  if (digits.length <= 6) return digits; // extension or short code
  return digits;
}

function formatCallClock(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

function liveCallKey(call) {
  if (!call?.storeKey) return '';
  return `${call.storeKey}:${callKey(call)}`;
}

const PhoneCallContext = createContext({
  stores: [],
  allStores: [],
  selectedStoreKey: '',
  setSelectedStoreKey: () => {},
  liveCalls: [],
  incoming: [],
  recentAnswered: [],
  activeCall: null,
  muted: false,
  toggleMute: () => {},
  sendDtmf: () => {},
  webPhoneStatus: {},
  canDialInBrowser: () => false,
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
  watchedStores: [],
  silent: false,
  setSilent: () => {},
  busy: false,
  error: '',
  setError: () => {},
  answer: async () => {},
  reject: async () => {},
  hangup: async () => {},
  dial: async () => {},
  ringOut: async () => {},
  refreshPresence: async () => {},
});

export function usePhoneCalls() {
  return useContext(PhoneCallContext);
}

export function PhoneCallProvider({ session, storeFilter, enabled = true, children }) {
  const { hasApp } = useAppAccess();
  const active = Boolean(enabled && session?.token && hasApp('phone'));
  const [stores, setStores] = useState([]);
  const [selectedStoreKey, setSelectedStoreKey] = useState('');
  const [watchPrefs, setWatchPrefs] = useState({ mode: 'all', keys: [] });
  const [recentAnswered, setRecentAnswered] = useState([]);
  const [inboxByStore, setInboxByStore] = useState({});
  const [liveLogByStore, setLiveLogByStore] = useState({});
  const [inboxFetching, setInboxFetching] = useState({});
  const [silent, setSilentState] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [muted, setMuted] = useState(false);
  const [webPhoneStatus, setWebPhoneStatus] = useState({});

  // The one registry of live calls (softphone + verified presence).
  const [callState, setCallState] = useState(createCallState);
  const callStateRef = useRef(callState);
  const updateCalls = useCallback((fn) => {
    const next = fn(callStateRef.current);
    if (next !== callStateRef.current) {
      callStateRef.current = next;
      setCallState(next);
    }
  }, []);

  // Browser softphone per store, plus what the proxy told us about each line.
  const webPhonesRef = useRef(new Map());
  const webPhoneByExtensionRef = useRef(new Map());
  const webDeviceIdRef = useRef(new Map());
  const webCallerIdRef = useRef(new Map());
  // Keys of calls this tab is in the middle of answering. Call Control cancels
  // the ringing INVITE and replaces it; that CANCEL must not close the live card.
  const answeringRef = useRef(new Map());
  const requestId = useRef(0);
  const storesRequestId = useRef(0);
  const skipUntil = useRef(new Map());
  const inboxSkipUntil = useRef(new Map());
  const inboxInFlight = useRef(new Set());
  const inboxCursor = useRef(0);
  const inboxByStoreRef = useRef(inboxByStore);
  inboxByStoreRef.current = inboxByStore;
  const [posPhones, setPosPhones] = useState({});
  const posPhonesRef = useRef(posPhones);
  posPhonesRef.current = posPhones;
  const sessionRef = useRef(session);
  sessionRef.current = session;

  // ---------------------------------------------------------------------
  // Stores, preferences
  // ---------------------------------------------------------------------

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
        const [silentRaw, watch] = await Promise.all([AsyncStorage.getItem(SILENT_KEY), loadWatchStores()]);
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

  const removeStoreAccount = useCallback(
    (storeKey) => {
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
      updateCalls((state) => clearStore(state, key));
      writeSipCache(key, null);
      setSelectedStoreKey((current) => (current === key ? '' : current));
    },
    [updateCalls],
  );

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
        const chosen = preferred ? list.find((row) => row.storeKey === preferred && row.hasJwt) : null;
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
      setInboxByStore({});
      setLiveLogByStore({});
      setInboxFetching({});
      updateCalls(() => createCallState());
      return undefined;
    }
    reloadStores();
    return undefined;
  }, [active, reloadStores, session?.token, updateCalls]);

  useEffect(() => {
    if (selectedStoreKey && connectedStores.some((row) => row.storeKey === selectedStoreKey)) return;
    const preferred = storeFilter ? storeKeyFromName(storeFilter) : '';
    const next =
      connectedStores.find((row) => row.storeKey === preferred)?.storeKey || connectedStores[0]?.storeKey || '';
    if (next !== selectedStoreKey) setSelectedStoreKey(next);
  }, [connectedStores, selectedStoreKey, storeFilter]);

  // ---------------------------------------------------------------------
  // Presence poll (server-verified live calls)
  // ---------------------------------------------------------------------

  const refreshPresence = useCallback(async () => {
    if (!active || connectedStores.length === 0) return;
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
    updateCalls((state) => {
      let next = state;
      for (const item of settled) {
        if (item.status !== 'fulfilled') continue;
        const key = item.value.store?.storeKey;
        if (!key) continue;
        succeeded.add(key);
        next = applyPresence(next, key, item.value.liveCalls || []);
      }
      next = expirePresence(next);
      return pruneEnded(next);
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
  }, [active, connectedStores, selectedStoreKey, updateCalls, watchedStores]);

  useLiveRefresh(refreshPresence, PHONE_LIVE_MS, active && connectedStores.length > 0);

  useEffect(() => {
    if (!active || connectedStores.length === 0) return undefined;
    refreshPresence();
    return undefined;
  }, [active, connectedStores, refreshPresence]);

  // ---------------------------------------------------------------------
  // Call log / voicemail inbox
  // ---------------------------------------------------------------------

  const appendLiveLog = useCallback((entry) => {
    if (!entry?.storeKey || !entry?.id) return;
    setLiveLogByStore((current) => {
      const list = current[entry.storeKey] || [];
      if (list.some((row) => row.id === entry.id || sameInboundCall(row, entry))) return current;
      return { ...current, [entry.storeKey]: [entry, ...list].slice(0, 80) };
    });
  }, []);

  const refreshInbox = useCallback(async (storeKey, { silent: quiet = false, force = false } = {}) => {
    const key = storeKeyFromName(storeKey);
    if (!key) return null;
    if (!force && (inboxSkipUntil.current.get(key) || 0) > Date.now()) {
      return inboxByStoreRef.current[key] || null;
    }
    if (!force) {
      const cached = inboxByStoreRef.current[key];
      if (cached && Date.now() - (cached.at || 0) < PHONE_INBOX_MS) return cached;
    }
    if (inboxInFlight.current.has(key)) return inboxByStoreRef.current[key] || null;
    inboxInFlight.current.add(key);
    if (!quiet) setInboxFetching((current) => ({ ...current, [key]: true }));
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
      if (notes.length && !quiet) setError(notes.join(' '));
      return payload;
    } catch (err) {
      if (err?.status === 429 || isPhoneRateLimitMessage(err?.message)) {
        inboxSkipUntil.current.set(key, Date.now() + 60_000);
        setError((current) => (isPhoneRateLimitMessage(current) ? '' : current));
      }
      if (!quiet && !isPhoneRateLimitMessage(err?.message)) setError(err?.message || 'Could not load calls.');
      throw err;
    } finally {
      inboxInFlight.current.delete(key);
      if (!quiet) {
        setInboxFetching((current) => {
          if (!current[key]) return current;
          const next = { ...current };
          delete next[key];
          return next;
        });
      }
    }
  }, []);

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

  // ---------------------------------------------------------------------
  // Browser softphone registration (web only)
  // ---------------------------------------------------------------------

  const connectedNames = useMemo(
    () => Object.fromEntries(connectedStores.map((row) => [row.storeKey, row.storeName || row.storeKey])),
    [connectedStores],
  );
  const connectedNamesRef = useRef(connectedNames);
  connectedNamesRef.current = connectedNames;

  const setStorePhoneStatus = useCallback((storeKey, next) => {
    setWebPhoneStatus((current) => ({ ...current, [storeKey]: { ...(current[storeKey] || {}), ...next } }));
  }, []);

  const onSipCall = useCallback(
    (snapshot) => {
      answeringRef.current.delete(callKey(snapshot));
      updateCalls((state) => {
        const key = callKey(snapshot);
        const existing = state.calls[key];
        const next = applySipCall(state, snapshot);
        // A call-control Answer lands here as a fresh auto-answered INVITE: the
        // card already says connected, so do not flash back to "ringing".
        if (existing && existing.answeredAt && isConnectedStatus(existing.status) && snapshot.direction !== 'Outbound') {
          return patchCall(next, key, { status: existing.status, answeredAt: existing.answeredAt, web: true });
        }
        return next;
      });
    },
    [updateCalls],
  );

  const onSipChange = useCallback(
    (snapshot, meta = {}) => {
      updateCalls((state) => {
        let next = state;
        let key = callKey(snapshot);
        if (meta.previousId && meta.previousId !== key) {
          next = rekeyCall(next, meta.previousId, snapshot);
        }
        if (snapshot.ended) {
          const existing = next.calls[key] || next.calls[meta.previousId || ''];
          const holding =
            answeringRef.current.has(key) ||
            answeringRef.current.has(meta.previousId || '') ||
            (existing && existing.web && isConnectedStatus(existing.status) && !snapshot.answered);
          if (holding) {
            return next;
          }
          const wasAnswered = snapshot.answered || (existing && isConnectedStatus(existing.status) && existing.web);
          const reason = wasAnswered ? 'hangup' : existing?.direction === 'Outbound' ? 'hangup' : 'missed';
          next = endCall(next, key, reason);
          if (meta.previousId) next = endCall(next, meta.previousId, reason);
          return next;
        }
        if (!next.calls[key]) {
          // Ids learned before we tracked the call (auto-answered INVITE).
          next = applySipCall(next, snapshot);
        }
        if (snapshot.status === 'CallConnected') {
          answeringRef.current.delete(key);
          // Outbound: the SIP server accepts the INVITE right away, so this is
          // not the callee picking up. Presence flips it to connected later.
          if (snapshot.direction === 'Outbound') return patchCall(next, key, { web: true });
          return markAnswered(next, key);
        }
        return patchCall(next, key, {
          partyId: snapshot.partyId || next.calls[key]?.partyId || '',
          telephonySessionId: snapshot.telephonySessionId || next.calls[key]?.telephonySessionId || key,
          callId: snapshot.callId || next.calls[key]?.callId || '',
        });
      });
      if (snapshot.status === 'CallConnected' && snapshot.direction !== 'Outbound') {
        setError('');
        setMuted(false);
      }
    },
    [updateCalls],
  );

  useEffect(() => {
    if (Platform.OS !== 'web') return undefined;
    const disposeAll = () => {
      for (const handle of webPhonesRef.current.values()) handle.dispose().catch(() => {});
      webPhonesRef.current.clear();
      webPhoneByExtensionRef.current.clear();
      webDeviceIdRef.current.clear();
      webCallerIdRef.current.clear();
    };
    if (!active || !connectedKeyList) {
      disposeAll();
      setWebPhoneStatus({});
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
      webCallerIdRef.current.delete(storeKey);
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
          webCallerIdRef.current.set(storeKey, {
            callerIds: provision.callerIds || [],
            defaultCallerId: provision.defaultCallerId || '',
          });
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
            onInbound: onSipCall,
            onOutbound: onSipCall,
            onChange: onSipChange,
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
  }, [active, connectedKeyList, onSipCall, onSipChange, setStorePhoneStatus]);

  useEffect(
    () => () => {
      for (const handle of webPhonesRef.current.values()) handle.dispose().catch(() => {});
      webPhonesRef.current.clear();
    },
    [],
  );

  // ---------------------------------------------------------------------
  // Derived views
  // ---------------------------------------------------------------------

  const allLiveCalls = useMemo(() => listCalls(callState), [callState]);

  const incoming = useMemo(() => {
    const ringing = ringingCalls(callState).filter((call) => isStoreWatched(watchPrefs, call.storeKey));
    ringing.sort((a, b) => (a.seenAt || 0) - (b.seenAt || 0));
    return ringing;
  }, [callState, watchPrefs]);

  const activeCall = useMemo(() => {
    const mine = browserCalls(callState);
    if (!mine.length) return null;
    mine.sort((a, b) => (b.answeredAt || b.seenAt || 0) - (a.answeredAt || a.seenAt || 0));
    return mine[0];
  }, [callState]);

  /** The handle holding the SIP leg of this call, whichever store registered it. */
  const webHandleFor = useCallback((call) => {
    if (!call) return { handle: null, id: '' };
    const own = webPhonesRef.current.get(call.storeKey);
    const handles = own
      ? [own, ...[...webPhonesRef.current.values()].filter((h) => h !== own)]
      : [...webPhonesRef.current.values()];
    for (const handle of handles) {
      if (handle.sessionFor?.(call) || handle.stateOf?.(call)) return { handle, id: call };
      const ids = [call.telephonySessionId, call.id, call.partyId, call.callId].filter(Boolean);
      for (const id of ids) {
        if (handle.session(id)) return { handle, id };
      }
    }
    return { handle: null, id: '' };
  }, []);

  /** The registration that rings for this store, and this browser's device on it. */
  const webPhoneFor = useCallback(
    (storeKey) => {
      const status = webPhoneStatus[storeKey];
      const owner = status?.state === 'shared' && status.sharedWith ? status.sharedWith : storeKey;
      const handle = webPhonesRef.current.get(owner) || null;
      const ids = webCallerIdRef.current.get(storeKey) || webCallerIdRef.current.get(owner) || {};
      return {
        handle,
        deviceId: webDeviceIdRef.current.get(storeKey) || webDeviceIdRef.current.get(owner) || '',
        state: status?.state || '',
        callerId: ids.defaultCallerId || '',
        callerIds: ids.callerIds || [],
        ready: Boolean(handle && handle.isConnected() && (status?.state === 'ready' || status?.state === 'shared')),
      };
    },
    [webPhoneStatus],
  );

  const canDialInBrowser = useCallback(
    (storeKey) => Platform.OS === 'web' && webPhoneFor(storeKey || selectedStoreKey).ready,
    [selectedStoreKey, webPhoneFor],
  );

  // ---------------------------------------------------------------------
  // Local call log: outcome of every call seen ringing here
  // ---------------------------------------------------------------------

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

  const ringingRef = useRef(new Map());
  const settledRef = useRef(new Set());

  useEffect(() => {
    if (!active) {
      ringingRef.current.clear();
      return;
    }
    const ringing = new Map(ringingCalls(callState).map((call) => [liveCallKey(call), call]));
    for (const [key, prev] of [...ringingRef.current.entries()]) {
      if (ringing.has(key)) {
        ringingRef.current.set(key, ringing.get(key));
        continue;
      }
      ringingRef.current.delete(key);
      if (settledRef.current.has(key)) continue;
      settledRef.current.add(key);
      const still = callState.calls[callKey(prev)];
      const reason = callState.ended[callKey(prev)]?.reason || '';
      let result = 'Missed';
      if (still && isConnectedStatus(still.status)) result = 'Accepted';
      else if (reason === 'answered' || reason === 'hangup') result = 'Accepted';
      else if (reason === 'rejected') result = 'Rejected';
      appendLiveLog(liveLogEntry(still || prev, result));
      if (result === 'Accepted') rememberAnswered(still || prev);
    }
    for (const [key, call] of ringing.entries()) {
      if (!settledRef.current.has(key)) ringingRef.current.set(key, call);
    }
    if (settledRef.current.size > 200) settledRef.current = new Set([...settledRef.current].slice(-100));
  }, [active, appendLiveLog, callState, rememberAnswered]);

  useEffect(() => {
    if (!recentAnswered.length) return undefined;
    const nextUntil = Math.min(...recentAnswered.map((row) => row.until));
    const timer = setTimeout(() => {
      const now = Date.now();
      setRecentAnswered((current) => current.filter((row) => row.until > now));
    }, Math.max(0, nextUntil - Date.now()));
    return () => clearTimeout(timer);
  }, [recentAnswered]);

  // Ringtone: only for verified inbound calls, and never over a live conversation.
  useEffect(() => {
    if (!active || silent || incoming.length === 0 || activeCall) {
      stopRingtone();
      return undefined;
    }
    startRingtone();
    return () => stopRingtone();
  }, [active, activeCall, incoming.length, silent]);

  useEffect(() => () => stopRingtone(), []);

  // ---------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------

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

  /** RingCentral call-control. A party that is over is dropped locally and surfaces as `call_gone`. */
  const runControl = useCallback(
    async (action, call, extra) => {
      if (!call) throw new Error('That call is no longer available.');
      try {
        const result = await controlPhoneCall(action, call, extra);
        updateCalls((state) => applyPresence(state, call.storeKey, result.liveCalls || []));
        return result;
      } catch (err) {
        if (isCallGoneError(err)) {
          updateCalls((state) => endCall(state, callKey(call), 'gone'));
          const gone = new Error(CALL_GONE_MESSAGE);
          gone.code = 'call_gone';
          throw gone;
        }
        throw err;
      }
    },
    [updateCalls],
  );

  /** Why Answer could not take the call in this browser. */
  const webPhoneFallbackReason = useCallback(
    (storeKey, err) => {
      if (Platform.OS !== 'web') {
        return 'Answering in the app works in the web version; pick up on the RingCentral app or desk phone.';
      }
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
        return `That call could not be moved to this browser${detail}. Pick up on the RingCentral app or desk phone, or send it to voicemail.`;
      }
      return status.message || 'This browser is not registered as the store phone.';
    },
    [webPhoneStatus],
  );

  const answer = useCallback(
    (call) =>
      perform(async () => {
        if (!call) throw new Error('That call is no longer available.');
        const key = callKey(call);
        answeringRef.current.set(key, Date.now());
        updateCalls((state) => markAnswered(state, key));
        setMuted(false);

        const revert = () => {
          answeringRef.current.delete(key);
          updateCalls((state) => {
            const existing = state.calls[key];
            if (!existing) return state;
            return patchCall(state, key, { status: 'Ringing', web: false, answeredAt: null });
          });
        };

        const { handle, id } = webHandleFor(call);
        const sipState = handle ? handle.stateOf(id) : '';

        if (sipState === 'answered') {
          answeringRef.current.delete(key);
          return { ok: true };
        }

        if (sipState === 'ringing' || sipState === 'init') {
          try {
            await ensureMicrophone();
            await handle.answer(id);
            updateCalls((state) => markAnswered(state, key));
            answeringRef.current.delete(key);
            setMuted(false);
            return { ok: true };
          } catch (err) {
            if (isMicrophoneError(err) || isMicrophoneBlockedError(err) || err?.code === 'sip_timeout') {
              revert();
              throw new Error(answerErrorMessage(err));
            }
            // No session / SIP rejected: Call Control can still park the audio
            // on this browser's device via a replacement auto-answered INVITE.
          }
        }

        const line = webPhoneFor(call.storeKey);
        const useBrowser = line.ready && Boolean(line.deviceId);
        if (useBrowser) {
          try {
            await ensureMicrophone();
          } catch (err) {
            revert();
            throw new Error(answerErrorMessage(err));
          }
        }
        try {
          await runControl('answer', call, { deviceId: useBrowser ? line.deviceId : '' });
        } catch (err) {
          if (err?.code === 'call_gone') {
            answeringRef.current.delete(key);
            throw err;
          }
          revert();
          throw new Error(webPhoneFallbackReason(call.storeKey, err));
        }
        updateCalls((state) =>
          patchCall(state, key, {
            status: 'CallConnected',
            web: true,
            answeredAt: Date.now(),
          }),
        );
        return { ok: true };
      }),
    [perform, runControl, updateCalls, webHandleFor, webPhoneFallbackReason, webPhoneFor],
  );

  const reject = useCallback(
    (call) =>
      perform(async () => {
        if (!call) throw new Error('That call is no longer available.');
        const key = callKey(call);
        const done = () => {
          updateCalls((state) => endCall(state, key, 'rejected'));
          return { ok: true };
        };
        const { handle, id } = webHandleFor(call);
        if (handle && handle.stateOf(id) === 'ringing') {
          try {
            await handle.toVoicemail(id);
            handle.release(id);
            return done();
          } catch {
            // Queue legs do not always honour the voicemail command; decline the INVITE instead.
          }
          try {
            await handle.decline(id);
            handle.release(id);
            return done();
          } catch {
            handle.release(id);
            // Fall through to the call-control API.
          }
        }
        try {
          await runControl('reject', call);
          return done();
        } catch (err) {
          // Already over (answered elsewhere, voicemail, caller hung up), or the
          // SIP leg here stopped ringing: either way there is nothing left to reject.
          if (err?.code === 'call_gone' || handle) return done();
          throw err;
        }
      }),
    [perform, runControl, updateCalls, webHandleFor],
  );

  const hangup = useCallback(
    (call) =>
      perform(async () => {
        const target = call || activeCall;
        if (!target) throw new Error('There is no call to hang up.');
        const key = callKey(target);
        const wasAnswered = isConnectedStatus(target.status);
        const done = () => {
          updateCalls((state) => endCall(state, key, wasAnswered ? 'hangup' : 'rejected'));
          setMuted(false);
          return { ok: true };
        };
        const { handle, id } = webHandleFor(target);
        if (handle) {
          try {
            await handle.hangup(id);
          } catch {
            // No BYE reply (socket dropped mid-call): media is already released;
            // ask RingCentral to drop the party so the caller is not left hanging.
            if (target.telephonySessionId) await runControl('hangup', target).catch(() => {});
          }
          return done();
        }
        if (target.web && !target.telephonySessionId) return done(); // Browser call whose SIP leg already ended.
        try {
          await runControl('hangup', target);
          return done();
        } catch (err) {
          if (err?.code === 'call_gone') return done();
          throw err;
        }
      }),
    [activeCall, perform, runControl, updateCalls, webHandleFor],
  );

  const toggleMute = useCallback(() => {
    const { handle, id } = webHandleFor(activeCall);
    if (!handle) return;
    if (handle.setMuted(id, !muted)) setMuted(!muted);
  }, [activeCall, muted, webHandleFor]);

  const sendDtmf = useCallback(
    (tones) => {
      const { handle, id } = webHandleFor(activeCall);
      if (!handle) return false;
      return handle.sendDtmf(id, tones);
    },
    [activeCall, webHandleFor],
  );

  /**
   * Place a call. From a browser registered as the store phone the call is
   * made here with audio; elsewhere RingOut rings the store phone first and
   * then dials the number.
   */
  const dial = useCallback(
    (to, { storeKey: wanted = '', from = '' } = {}) =>
      perform(async () => {
        const storeKey = storeKeyFromName(wanted) || selectedStoreKey || connectedStores[0]?.storeKey;
        if (!storeKey) throw new Error('Connect a store in Settings → RingCentral first.');
        const callee = sipCallee(to);
        if (!callee) throw new Error('Enter a number to call.');
        if (activeCall) throw new Error('Finish the current call before placing another.');

        const line = webPhoneFor(storeKey);
        if (Platform.OS === 'web' && line.ready) {
          const callerId = sipCallee(from) && line.callerIds.some((n) => sipCallee(n) === sipCallee(from))
            ? sipCallee(from)
            : sipCallee(line.callerId);
          try {
            const snapshot = await line.handle.call(callee, callerId || undefined);
            updateCalls((state) => applySipCall(state, { ...snapshot, storeKey, to: snapshot.to || callee }));
            setMuted(false);
            return { web: true, call: snapshot };
          } catch (err) {
            const mic = microphoneMessage(err, 'call');
            if (mic) throw new Error(mic);
            if (err?.code === 'sip_offline') {
              // Registration dropped between polls: fall back to RingOut below.
            } else {
              throw new Error(err?.message || 'Could not start the call from this browser.');
            }
          }
        }

        const result = await startRingOut(storeKey, to, from);
        updateCalls((state) => applyPresence(state, storeKey, result.liveCalls || []));
        return { web: false, ringOut: result.ringOut };
      }),
    [activeCall, connectedStores, perform, selectedStoreKey, updateCalls, webPhoneFor],
  );

  const ringOut = useCallback((to, from) => dial(to, { from }), [dial]);

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
      sendDtmf,
      webPhoneStatus,
      canDialInBrowser,
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
      dial,
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
      busy,
      canDialInBrowser,
      connectedStores,
      dial,
      error,
      hangup,
      inboxByStore,
      inboxFetching,
      incoming,
      mergedCallsByStore,
      muted,
      recentAnswered,
      refreshInbox,
      refreshPresence,
      reject,
      reloadStores,
      removeStoreAccount,
      ringOut,
      selectedStoreKey,
      sendDtmf,
      setSilent,
      setStoreWatched,
      silent,
      stores,
      syncStoreAccounts,
      toggleMute,
      watchPrefs,
      watchedStores,
      webPhoneStatus,
    ],
  );

  return <PhoneCallContext.Provider value={value}>{children}</PhoneCallContext.Provider>;
}

// ---------------------------------------------------------------------------
// UI: incoming dock, active call row, ringer toggle
// ---------------------------------------------------------------------------

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

/** "Calling…" while an outbound leg is being set up; a running clock once connected. */
export function activeCallKicker(call) {
  if (!call) return '';
  if (call.direction === 'Outbound' && (isDialingStatus(call.status) || isRingingStatus(call.status))) return 'Calling';
  if (/hold/i.test(call.status || '')) return 'On hold';
  return 'On call';
}

function ActiveCallRow({ call, collapsed, busy, muted, onMute, onHangup }) {
  const label = callPartyLabel(call, { formatPhone: formatPhoneNumber });
  const kicker = activeCallKicker(call);
  const connected = isConnectedStatus(call.status);
  return (
    <View
      style={[styles.dockRow, styles.dockRowActive, collapsed && styles.dockRowCollapsed]}
      accessibilityLabel={`${kicker} ${label} at ${call.storeName || 'store'}`}
    >
      <View style={styles.dockCopy}>
        <Text style={styles.kicker} numberOfLines={1}>
          {kicker} · {call.storeName || 'Store'}
        </Text>
        {collapsed ? (
          connected && call.answeredAt ? <CallClock since={call.answeredAt} /> : null
        ) : (
          <View style={styles.activeLine}>
            <Text style={styles.caller} numberOfLines={1}>
              {label}
            </Text>
            {connected && call.answeredAt ? <CallClock since={call.answeredAt} /> : null}
          </View>
        )}
      </View>
      <View style={styles.actionsCompact}>
        {call.web ? (
          <Pressable
            style={[styles.action, styles.actionCompact, muted ? styles.muteOn : styles.mute]}
            onPress={onMute}
            disabled={busy || !connected}
            accessibilityLabel={muted ? 'Unmute microphone' : 'Mute microphone'}
          >
            <Ionicons name={muted ? 'mic-off' : 'mic'} size={14} color="#fff" />
          </Pressable>
        ) : null}
        <Pressable
          style={[styles.action, styles.reject, styles.actionCompact]}
          onPress={onHangup}
          disabled={busy}
          accessibilityLabel="Hang up"
        >
          {busy ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Ionicons name="call" size={14} color="#fff" style={styles.hangupIcon} />
          )}
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
      {incoming
        .filter((call) => call.id !== activeCall?.id)
        .map((call) => {
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
                {call.queueName ? ` · ${call.queueName}` : ''}
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
      {recentAnswered
        .filter((row) => row.callId !== activeCall?.id)
        .map((row) => (
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
  actions: {
    flexDirection: 'row',
    gap: 8,
  },
  actionsCompact: {
    flexDirection: 'row',
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
