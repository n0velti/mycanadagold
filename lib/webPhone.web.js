import WebPhone from 'ringcentral-web-phone';

/**
 * Browser softphone for one RingCentral extension (RingCentral WebRTC SDK).
 * The proxy provisions `sipInfo` for the store's JWT; this registers the tab
 * as a phone for that extension so Answer produces real audio here.
 */
export const isWebPhoneSupported =
  typeof window !== 'undefined' &&
  typeof window.RTCPeerConnection === 'function' &&
  typeof window.WebSocket === 'function' &&
  Boolean(navigator?.mediaDevices?.getUserMedia);

const INSTANCE_PREFIX = 'cgold.phone.instance.';
/** SIP round trips normally finish in well under a second. */
export const SIP_ACTION_TIMEOUT_MS = 8_000;
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

/** RingCentral puts the telephony session and party ids in one SIP header. */
function rcApiIds(session) {
  const header = session?.sipMessage?.getHeader?.('p-rc-api-ids') || '';
  return {
    sessionId: header.match(/session-id=(s-[\w-]+)/i)?.[1] || session?.sessionId || '',
    partyId: header.match(/party-id=(p-[\w-]+)/i)?.[1] || session?.partyId || '',
  };
}

function sipDisplayName(peer) {
  const match = String(peer || '').match(/^\s*"?([^"<]*?)"?\s*</);
  const name = match ? match[1].trim() : '';
  return /^\+?\d+$/.test(name) ? '' : name;
}

function safeNumber(fn) {
  try {
    return fn() || '';
  } catch {
    return '';
  }
}

export function toCallSnapshot(session, storeKey, storeName) {
  const ids = rcApiIds(session);
  const id = ids.sessionId || session.callId || '';
  return {
    id,
    storeKey,
    storeName,
    direction: 'Inbound',
    status: session.state === 'answered' ? 'CallConnected' : 'Ringing',
    from: safeNumber(() => session.remoteNumber),
    fromName: sipDisplayName(session.remotePeer),
    to: safeNumber(() => session.localNumber),
    toName: '',
    telephonySessionId: ids.sessionId,
    partyId: ids.partyId,
    sessionId: ids.sessionId,
    callId: session.callId || '',
    startTime: new Date().toISOString(),
    extensionNumber: '',
    extensionName: '',
    web: true,
  };
}

/**
 * Start a softphone. `onInbound(snapshot, session)` fires for every incoming
 * INVITE; `onChange(snapshot)` when it is answered or ends; `onStatus(state,
 * message)` as the SIP registration connects, drops and reconnects.
 */
export async function startWebPhone({
  sipInfo,
  extensionId,
  storeKey,
  storeName,
  onInbound,
  onChange,
  onStatus,
  debug = false,
}) {
  if (!isWebPhoneSupported) throw new Error('This browser cannot act as a phone.');
  if (!sipInfo) throw new Error('Missing SIP details.');
  const phone = new WebPhone({ sipInfo, instanceId: webPhoneInstanceId(extensionId), debug });
  // Every id a caller may use to find a session: telephony session id (what
  // presence reports), SIP Call-Id and party id.
  const sessions = new Map();
  const index = new Map();
  let disposed = false;
  let reconnectTimer = null;
  let reconnectAttempt = 0;
  let connecting = null;

  const indexSession = (snapshot, session) => {
    for (const key of [snapshot.id, snapshot.callId, snapshot.partyId, snapshot.telephonySessionId]) {
      if (key) index.set(String(key), session);
    }
    sessions.set(snapshot.id, session);
  };
  const forgetSession = (snapshot) => {
    for (const key of [snapshot.id, snapshot.callId, snapshot.partyId, snapshot.telephonySessionId]) {
      if (key && index.get(String(key)) === sessions.get(snapshot.id)) index.delete(String(key));
    }
    sessions.delete(snapshot.id);
  };

  phone.on('inboundCall', (session) => {
    const snapshot = toCallSnapshot(session, storeKey, storeName);
    if (!snapshot.id) return;
    indexSession(snapshot, session);
    onInbound?.(snapshot, session);
    let answered = false;
    session.once('answered', () => {
      answered = true;
      onChange?.({ ...snapshot, status: 'CallConnected' });
    });
    session.once('disposed', () => {
      forgetSession(snapshot);
      onChange?.({ ...snapshot, status: 'NoCall', ended: true, answered });
    });
  });

  const socket = () => phone.sipClient?.wsc || null;

  const watchSocket = () => {
    const ws = socket();
    if (!ws || ws.__cgoldWatched) return;
    ws.__cgoldWatched = true;
    ws.addEventListener('close', () => {
      if (disposed || socket() !== ws) return;
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

  const isConnected = () => socket()?.readyState === 1;

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

  const onOnline = () => ensureConnected();
  const onVisible = () => {
    if (document.visibilityState === 'visible') ensureConnected();
  };
  window.addEventListener('online', onOnline);
  document.addEventListener('visibilitychange', onVisible);

  return {
    phone,
    storeKey,
    extensionId: extensionId || '',
    isConnected,
    /** Ringing or answered session for a telephony session, party or SIP call id. */
    session(id) {
      const key = String(id || '');
      if (!key) return null;
      const found = index.get(key) || sessions.get(key) || null;
      return found && found.state !== 'disposed' ? found : null;
    },
    sessions() {
      return [...sessions.values()].filter((row) => row.state !== 'disposed');
    },
    async dispose() {
      disposed = true;
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      for (const session of sessions.values()) {
        try {
          if (session.state === 'answered') await withSipTimeout(session.hangup(), 'hang up', 2_000);
        } catch {
          // Already gone.
        }
      }
      sessions.clear();
      index.clear();
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
