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

function toCallSnapshot(session, storeKey, storeName) {
  return {
    id: session.sessionId || session.callId || '',
    storeKey,
    storeName,
    direction: 'Inbound',
    status: session.state === 'answered' ? 'CallConnected' : 'Ringing',
    from: session.remoteNumber || '',
    fromName: '',
    to: session.localNumber || '',
    toName: '',
    telephonySessionId: session.sessionId || '',
    partyId: session.partyId || '',
    sessionId: session.sessionId || '',
    startTime: new Date().toISOString(),
    extensionNumber: '',
    extensionName: '',
    web: true,
  };
}

/**
 * Start a softphone. `onInbound(snapshot, session)` fires for every incoming
 * INVITE; `onChange(snapshot)` when it is answered or ends.
 */
export async function startWebPhone({ sipInfo, extensionId, storeKey, storeName, onInbound, onChange, debug = false }) {
  if (!isWebPhoneSupported) throw new Error('This browser cannot act as a phone.');
  if (!sipInfo) throw new Error('Missing SIP details.');
  const phone = new WebPhone({ sipInfo, instanceId: webPhoneInstanceId(extensionId), debug });
  const sessions = new Map();

  phone.on('inboundCall', (session) => {
    const snapshot = toCallSnapshot(session, storeKey, storeName);
    if (!snapshot.id) return;
    sessions.set(snapshot.id, session);
    onInbound?.(snapshot, session);
    session.once('answered', () => onChange?.({ ...snapshot, status: 'CallConnected' }));
    session.once('disposed', () => {
      sessions.delete(snapshot.id);
      onChange?.({ ...snapshot, status: 'NoCall', ended: true });
    });
  });

  await phone.start();

  const online = () => {
    if (!phone.disposed) phone.start().catch(() => {});
  };
  window.addEventListener('online', online);

  return {
    phone,
    /** Ringing or answered session for a telephony session id. */
    session(id) {
      return sessions.get(String(id || '')) || null;
    },
    sessions() {
      return [...sessions.values()];
    },
    async dispose() {
      window.removeEventListener('online', online);
      for (const session of sessions.values()) {
        try {
          if (session.state === 'answered') await session.hangup();
        } catch {
          // Already gone.
        }
      }
      sessions.clear();
      try {
        await phone.dispose();
      } catch {
        // Socket may already be closed.
      }
    },
  };
}
