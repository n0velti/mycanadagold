import WebPhone from 'ringcentral-web-phone';

/**
 * Browser softphone for one RingCentral extension (ringcentral-web-phone 2.x,
 * WebRTC over a SIP WebSocket). The proxy provisions `sipInfo` for the store's
 * JWT; this registers the tab as a device for that extension so inbound calls
 * ring here with real audio and outbound calls are placed from the browser.
 *
 * Everything the app needs is exposed through the handle returned by
 * `startWebPhone`; SDK sessions never leak past this module.
 */
export const isWebPhoneSupported =
  typeof window !== 'undefined' &&
  typeof window.RTCPeerConnection === 'function' &&
  typeof window.WebSocket === 'function' &&
  Boolean(navigator?.mediaDevices?.getUserMedia);

const INSTANCE_PREFIX = 'cgold.phone.instance.';
/** SIP round trips normally finish well under a second. */
export const SIP_ACTION_TIMEOUT_MS = 8_000;
/** Answering waits on the microphone prompt, so give it longer. */
export const SIP_ANSWER_TIMEOUT_MS = 30_000;
const RECONNECT_BASE_MS = 2_000;
const RECONNECT_MAX_MS = 60_000;

/**
 * One stable instance id per browser tab and extension: RingCentral allows
 * five registered instances per extension and only the newest registration of
 * a shared id rings, so each tab needs its own id that survives a reload.
 */
export function webPhoneInstanceId(extensionId) {
  const key = `${INSTANCE_PREFIX}${extensionId || 'default'}`;
  try {
    const existing = window.sessionStorage.getItem(key);
    if (existing) return existing;
    const next =
      typeof crypto?.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    window.sessionStorage.setItem(key, next);
    return next;
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

export class SipTimeoutError extends Error {
  constructor(action) {
    super(`The phone did not confirm "${action}" in time.`);
    this.name = 'SipTimeoutError';
    this.code = 'sip_timeout';
  }
}

/** Reject after `ms` so a lost SIP reply cannot leave the UI stuck. */
export function withSipTimeout(promise, action, ms = SIP_ACTION_TIMEOUT_MS) {
  let timer;
  return Promise.race([
    Promise.resolve(promise).finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new SipTimeoutError(action)), ms);
    }),
  ]);
}

/**
 * Ask for the microphone up front so a denied permission surfaces as a clear
 * error before any SIP signalling starts. Tracks are released immediately;
 * the SDK opens its own stream when the call is answered.
 */
export async function ensureMicrophone() {
  if (!navigator?.mediaDevices?.getUserMedia) throw new Error('This browser has no microphone access.');
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  for (const track of stream.getTracks()) track.stop();
}

/** RingCentral puts the telephony session and party ids in one SIP header. */
function rcApiIds(session) {
  const header = session?.sipMessage?.getHeader?.('p-rc-api-ids') || '';
  let sessionId = '';
  let partyId = '';
  try {
    sessionId = session?.sessionId || '';
    partyId = session?.partyId || '';
  } catch {
    // Getters throw before the first SIP reply on outbound calls.
  }
  return {
    sessionId: sessionId || header.match(/session-id=(s-[\w-]+)/i)?.[1] || '',
    partyId: partyId || header.match(/party-id=(p-[\w-]+)/i)?.[1] || '',
  };
}

function sipDisplayName(peer) {
  const match = String(peer || '').match(/^\s*"?([^"<]*?)"?\s*</);
  const name = match ? match[1].trim() : '';
  return /^\+?\d+$/.test(name) ? '' : name;
}

function safe(fn) {
  try {
    return fn() || '';
  } catch {
    return '';
  }
}

function last10(value) {
  return String(value || '').replace(/\D/g, '').slice(-10);
}

const fallbackIds = new WeakMap();
let fallbackSeq = 0;
function asFallbackId(session) {
  if (!session) return '';
  const existing = fallbackIds.get(session);
  if (existing) return existing;
  const next = `local-${Date.now().toString(36)}-${++fallbackSeq}`;
  fallbackIds.set(session, next);
  return next;
}

/** App-level view of a SIP session. Ids are re-read every time: outbound calls learn them late. */
export function toCallSnapshot(session, storeKey, storeName, extra = {}) {
  const ids = rcApiIds(session);
  const callId = safe(() => session.callId);
  const outbound = session.direction === 'outbound';
  const id = ids.sessionId || callId || asFallbackId(session);
  const remoteNumber = safe(() => session.remoteNumber);
  const localNumber = safe(() => session.localNumber);
  let status = 'Ringing';
  if (session.state === 'answered') status = 'CallConnected';
  else if (outbound) status = 'Dialing';
  const callInfo = safe(() => session.rcApiCallInfo) || {};
  return {
    id,
    storeKey,
    storeName,
    direction: outbound ? 'Outbound' : 'Inbound',
    status,
    from: outbound ? localNumber : remoteNumber,
    fromName: outbound ? '' : sipDisplayName(session.remotePeer) || String(callInfo.callerIdName || ''),
    to: outbound ? remoteNumber : localNumber,
    toName: '',
    queueName: String(callInfo.queueName || ''),
    telephonySessionId: ids.sessionId,
    partyId: ids.partyId,
    sessionId: ids.sessionId,
    callId,
    startTime: new Date().toISOString(),
    extensionNumber: '',
    extensionName: '',
    web: true,
    sip: true,
    ...extra,
  };
}

/**
 * Start a softphone.
 *
 *   onInbound(snapshot)                  a new INVITE is ringing this tab
 *   onOutbound(snapshot)                 a call placed from this tab was sent
 *   onChange(snapshot, { previousId })   answered / ids learned / ended
 *   onStatus(state, message)             SIP registration connects, drops, reconnects
 */
export async function startWebPhone({
  sipInfo,
  extensionId,
  storeKey,
  storeName,
  onInbound,
  onOutbound,
  onChange,
  onStatus,
  debug = false,
}) {
  if (!isWebPhoneSupported) throw new Error('This browser cannot act as a phone.');
  if (!sipInfo) throw new Error('Missing SIP details.');
  // autoAnswer is required for Call Control `/answer`: RingCentral cancels the
  // ringing INVITE and sends a new one with Alert-Info: Auto Answer. Without
  // this the replacement INVITE just sits there and the original card vanishes.
  const phone = new WebPhone({ sipInfo, instanceId: webPhoneInstanceId(extensionId), autoAnswer: true, debug });

  // Every id a caller may use to find a session: telephony session id (what
  // presence reports), SIP Call-Id and party id.
  const index = new Map();
  const tracked = new Set();
  let disposed = false;
  let reconnectTimer = null;
  let reconnectAttempt = 0;
  let connecting = null;

  const keysOf = (snapshot) =>
    [snapshot.id, snapshot.callId, snapshot.partyId, snapshot.telephonySessionId].filter(Boolean).map(String);
  const indexSession = (snapshot, session) => {
    for (const key of keysOf(snapshot)) index.set(key, session);
    tracked.add(session);
  };
  const forgetSession = (session) => {
    for (const [key, owner] of [...index.entries()]) if (owner === session) index.delete(key);
    tracked.delete(session);
  };
  const live = (session) => session && session.state !== 'disposed' && session.state !== 'failed';
  const harvestSdkSessions = () => {
    try {
      for (const session of phone.callSessions || []) {
        if (live(session) && !tracked.has(session)) {
          track(session, (snapshot) => {
            if (snapshot.direction === 'Outbound') onOutbound?.(snapshot);
            else onInbound?.(snapshot);
          });
        }
      }
    } catch {
      // SDK internals moved.
    }
  };
  const match = (call) => {
    harvestSdkSessions();
    if (!call) return null;
    if (typeof call !== 'object') return find(call);
    const ids = [call.telephonySessionId, call.id, call.partyId, call.callId].filter(Boolean);
    for (const id of ids) {
      const found = find(id);
      if (found) return found;
    }
    const inbound = [...tracked].filter((session) => live(session) && session.direction === 'inbound');
    const want = last10(call.from) || last10(call.to);
    if (want) {
      const byNumber = inbound.find((session) => last10(safe(() => session.remoteNumber)) === want);
      if (byNumber) return byNumber;
    }
    const ringing = inbound.filter((session) => session.state === 'ringing' || session.state === 'init');
    if (ringing.length === 1) return ringing[0];
    return null;
  };
  const resolve = (idOrCall) => (typeof idOrCall === 'object' ? match(idOrCall) : find(idOrCall));

  const track = (session, first) => {
    let snapshot = toCallSnapshot(session, storeKey, storeName);
    indexSession(snapshot, session);
    first?.(snapshot);
    let answered = session.state === 'answered';

    const refreshIds = () => {
      const next = toCallSnapshot(session, storeKey, storeName);
      if (next.id !== snapshot.id) {
        const previousId = snapshot.id;
        snapshot = next;
        indexSession(snapshot, session);
        onChange?.({ ...snapshot }, { previousId });
      } else if (next.partyId && next.partyId !== snapshot.partyId) {
        snapshot = next;
        indexSession(snapshot, session);
        onChange?.({ ...snapshot }, {});
      }
    };

    // The SDK stores a reply on the session only after this event has fired.
    session.on('inboundMessage', () => setTimeout(refreshIds, 0));
    session.once('answered', () => {
      answered = true;
      refreshIds();
      onChange?.({ ...snapshot, status: 'CallConnected' }, {});
    });
    session.once('failed', (reason) => {
      onChange?.({ ...snapshot, status: 'NoCall', ended: true, answered: false, failed: String(reason || '') }, {});
    });
    session.once('disposed', () => {
      forgetSession(session);
      onChange?.({ ...snapshot, status: 'NoCall', ended: true, answered }, {});
    });
  };

  phone.on('inboundCall', (session) => {
    track(session, (snapshot) => onInbound?.(snapshot));
  });
  phone.on('outboundCall', (session) => {
    track(session, (snapshot) => onOutbound?.(snapshot));
  });

  const socket = () => phone.sipClient?.wsc || null;
  const isConnected = () => socket()?.readyState === 1;

  const watchSocket = () => {
    const ws = socket();
    if (!ws || ws.__cgoldWatched) return;
    ws.__cgoldWatched = true;
    ws.addEventListener('close', () => {
      if (disposed || socket() !== ws) return;
      // The SDK re-registers on a timer against this now-dead socket; stop it.
      try {
        clearTimeout(phone.sipClient.timeoutHandle);
      } catch {
        // Private field may move; harmless if it does.
      }
      onStatus?.('reconnecting', 'The phone connection dropped. Reconnecting…');
      scheduleReconnect();
    });
  };

  const connect = async () => {
    if (disposed) return;
    if (connecting) return connecting;
    connecting = (async () => {
      try {
        await withSipTimeout(phone.start(), 'register', 15_000);
        if (disposed) return;
        reconnectAttempt = 0;
        watchSocket();
        onStatus?.('ready', '');
      } catch (err) {
        if (disposed) return;
        try {
          socket()?.close();
        } catch {
          // Already closed.
        }
        throw err;
      } finally {
        connecting = null;
      }
    })();
    return connecting;
  };

  const scheduleReconnect = () => {
    if (disposed || reconnectTimer) return;
    const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** Math.min(reconnectAttempt, 5));
    reconnectAttempt += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect().catch(() => {
        if (!disposed) {
          onStatus?.('reconnecting', 'Could not reach RingCentral. Retrying…');
          scheduleReconnect();
        }
      });
    }, delay);
  };

  /** Reconnect right away if the socket is not open (network back, tab visible). */
  const ensureConnected = () => {
    if (disposed || isConnected() || connecting) return;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    reconnectAttempt = 0;
    scheduleReconnect();
  };

  await connect();
  harvestSdkSessions();

  const onOnline = () => ensureConnected();
  const onVisible = () => {
    if (document.visibilityState === 'visible') ensureConnected();
  };
  window.addEventListener('online', onOnline);
  document.addEventListener('visibilitychange', onVisible);

  const find = (id) => {
    const key = String(id || '');
    if (!key) return null;
    const found = index.get(key) || null;
    return live(found) ? found : null;
  };
  const require = (idOrCall) => {
    const session = resolve(idOrCall);
    if (!session) {
      const err = new Error('That call is not on this browser any more.');
      err.code = 'sip_no_session';
      throw err;
    }
    return session;
  };
  /** Drop a session locally: close media and forget it, whatever RingCentral thinks. */
  const release = (session) => {
    if (!session) return;
    try {
      const list = phone.callSessions;
      const at = list.indexOf(session);
      if (at !== -1) list.splice(at, 1);
    } catch {
      // SDK internals moved; disposing is what matters.
    }
    try {
      if (session.state !== 'disposed') session.dispose();
      else forgetSession(session);
    } catch {
      forgetSession(session);
    }
  };

  return {
    phone,
    storeKey,
    extensionId: extensionId || '',
    isConnected,
    ensureConnected,
    /** Live session for a telephony session, party or SIP call id. */
    session: find,
    sessionFor: match,
    sessions() {
      harvestSdkSessions();
      return [...tracked].filter(live);
    },
    /** SDK state for an id or call: ringing | answered | init | '' */
    stateOf(idOrCall) {
      return resolve(idOrCall)?.state || '';
    },
    async answer(idOrCall) {
      const session = require(idOrCall);
      if (session.state === 'answered') return;
      if (session.direction !== 'inbound') throw new Error('Only inbound calls can be answered.');
      await withSipTimeout(session.answer(), 'answer', SIP_ANSWER_TIMEOUT_MS);
    },
    async toVoicemail(idOrCall) {
      const session = require(idOrCall);
      await withSipTimeout(session.toVoicemail(), 'send to voicemail');
    },
    async decline(idOrCall) {
      const session = require(idOrCall);
      await withSipTimeout(session.decline(), 'decline');
    },
    /** End a call this browser is on; releases media even if RingCentral never replies. */
    async hangup(idOrCall) {
      const session = resolve(idOrCall);
      if (!session) return false;
      try {
        if (session.state === 'answered') {
          await withSipTimeout(session.hangup(), 'hang up');
        } else if (session.direction === 'outbound') {
          await withSipTimeout(session.cancel(), 'cancel');
        } else {
          await withSipTimeout(session.decline(), 'decline');
        }
      } finally {
        release(session);
      }
      return true;
    },
    /** Forget a session without signalling (used after RingCentral already ended it). */
    release(idOrCall) {
      release(resolve(idOrCall));
    },
    setMuted(idOrCall, muted) {
      const session = resolve(idOrCall);
      if (!session || session.state !== 'answered') return false;
      if (muted) session.mute();
      else session.unmute();
      return true;
    },
    sendDtmf(idOrCall, tones) {
      const session = resolve(idOrCall);
      if (!session || session.state !== 'answered') return false;
      session.sendDtmf(String(tones || '').replace(/[^0-9*#A-D]/gi, ''));
      return true;
    },
    /**
     * Place a call. Resolves as soon as the INVITE is on the wire with a
     * snapshot of the new session; progress arrives through onChange.
     */
    async call(to, callerId) {
      if (!isConnected()) {
        const err = new Error('This browser is not connected to RingCentral right now.');
        err.code = 'sip_offline';
        throw err;
      }
      const callee = String(to || '').replace(/[^\d*#+]/g, '');
      if (!callee) throw new Error('Enter a number to call.');
      await ensureMicrophone();
      return new Promise((resolve, reject) => {
        let settled = false;
        const onOut = (session) => {
          if (settled) return;
          settled = true;
          resolve(toCallSnapshot(session, storeKey, storeName));
        };
        phone.once('outboundCall', onOut);
        phone.call(callee, callerId ? String(callerId).replace(/\D/g, '') : undefined).catch((err) => {
          phone.off?.('outboundCall', onOut);
          if (!settled) {
            settled = true;
            reject(err);
          }
        });
      });
    },
    async dispose() {
      disposed = true;
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      for (const session of [...tracked]) {
        try {
          if (session.state === 'answered') await withSipTimeout(session.hangup(), 'hang up', 2_000);
        } catch {
          // Already gone.
        }
      }
      index.clear();
      tracked.clear();
      try {
        // The SDK's dispose waits on SIP replies that a dead socket never sends.
        await withSipTimeout(phone.dispose(), 'unregister', 3_000);
      } catch {
        try {
          socket()?.close();
        } catch {
          // Socket may already be closed.
        }
      }
    },
  };
}
