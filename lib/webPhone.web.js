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
/** A REGISTER that gets no reply this fast means the socket is dead, not slow. */
export const SIP_PROBE_TIMEOUT_MS = 4_000;
/** ringcentral-web-phone closes its socket when a REGISTER goes unanswered this long. */
const SDK_REGISTER_CLOSE_MS = 5_000;
const RECONNECT_BASE_MS = 2_000;
const RECONNECT_MAX_MS = 60_000;
/**
 * A tab hidden this long may have been suspended by the OS (phones do this the
 * moment the screen locks): its timers stopped, so the SDK's re-REGISTER never
 * went out and the socket may be dead while still reporting OPEN.
 */
const SUSPECT_HIDDEN_MS = 5_000;

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
 * Safari iOS treats a second getUserMedia() after an await as "The operation
 * is insecure," and the SDK always opens capture with `deviceId: { exact: id }`.
 * A blank or missing id on that constraint is the same SecurityError. Capture
 * once during the Answer tap, keep the stream, and hand clones to the SDK.
 */
let primedMic = null;
let primedMicPromise = null;
let nativeGetUserMedia = null;

function liveAudioTracks(stream) {
  return stream?.getAudioTracks?.().filter((track) => track.readyState === 'live') || [];
}

function stopPrimedMic() {
  if (!primedMic) return;
  for (const track of primedMic.getTracks()) {
    try {
      track.stop();
    } catch {
      // Already ended.
    }
  }
  primedMic = null;
  primedMicPromise = null;
}

function clonePrimedMic() {
  const tracks = liveAudioTracks(primedMic).map((track) => track.clone());
  return tracks.length ? new MediaStream(tracks) : null;
}

function installGetUserMediaGuard() {
  if (installGetUserMediaGuard.done) return;
  const media = navigator?.mediaDevices;
  if (!media?.getUserMedia) return;
  nativeGetUserMedia = media.getUserMedia.bind(media);
  media.getUserMedia = (constraints) => {
    const audio = constraints === true ? true : constraints?.audio;
    const video = constraints && constraints !== true ? constraints.video : false;
    if (audio && !video) {
      const cloned = clonePrimedMic();
      if (cloned) return Promise.resolve(cloned);
      const exact =
        audio && typeof audio === 'object'
          ? audio.deviceId && typeof audio.deviceId === 'object'
            ? audio.deviceId.exact
            : audio.deviceId
          : undefined;
      if (exact == null || exact === '') return nativeGetUserMedia({ audio: true, video: false });
    }
    return nativeGetUserMedia(constraints);
  };
  installGetUserMediaGuard.done = true;
}

function startMicPrime() {
  installGetUserMediaGuard();
  if (liveAudioTracks(primedMic).length) return Promise.resolve(primedMic);
  if (primedMicPromise) return primedMicPromise;
  const request = nativeGetUserMedia || navigator?.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices);
  if (!request) return Promise.reject(new Error('This browser has no microphone access.'));
  primedMicPromise = Promise.resolve(request({ audio: true, video: false }))
    .then((stream) => {
      primedMic = stream;
      primedMicPromise = null;
      for (const track of stream.getAudioTracks()) {
        track.addEventListener('ended', () => {
          if (primedMic === stream) primedMic = null;
        });
      }
      return stream;
    })
    .catch((err) => {
      primedMicPromise = null;
      throw err;
    });
  return primedMicPromise;
}

/**
 * Ask for the microphone up front so a denied permission surfaces as a clear
 * error before any SIP signalling starts. The stream is kept so the SDK does
 * not have to call getUserMedia again after an await (Safari iOS forbids that).
 */
export async function ensureMicrophone() {
  installGetUserMediaGuard();
  if (!navigator?.mediaDevices?.getUserMedia) throw new Error('This browser has no microphone access.');
  const stream = await startMicPrime();
  if (!liveAudioTracks(stream).length) throw new Error('This browser has no microphone access.');
  return stream;
}

/**
 * The SDK opens its capture stream with `deviceId: { exact: id }`. A blank id
 * is a SecurityError on Safari ("The operation is insecure"). Prefer a real
 * id from the stream we already opened; otherwise omit it so the getUserMedia
 * guard falls back to `{ audio: true }`.
 */
class TolerantDeviceManager {
  async list(kind) {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.filter((device) => device.kind === kind && device.deviceId);
    } catch {
      return [];
    }
  }

  async getInputDeviceId() {
    const fromStream = liveAudioTracks(primedMic)[0]?.getSettings?.()?.deviceId;
    if (fromStream) return fromStream;
    const inputs = await this.list('audioinput');
    const preferred = inputs.find((device) => device.deviceId === 'default') || inputs[0];
    return preferred?.deviceId || undefined;
  }

  async getOutputDeviceId() {
    // We play the far end through our own element (below); the SDK's element is silenced.
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Remote audio
//
// The SDK parks the far end's track on a detached, autoplay <audio> element
// and never calls play(). Chrome usually tolerates that; Safari and any tab
// without a recent gesture do not, and the result is a connected call with no
// sound. We own the element instead: it lives in the document, is unlocked by
// the Answer/Call click, and play() failures are reported so the UI can offer
// an "Enable sound" button.
// ---------------------------------------------------------------------------

const sessionAudio = new WeakMap();
let primedAudio = null;
let primeCtx = null;

function createAudioElement() {
  const el = document.createElement('audio');
  el.autoplay = true;
  el.setAttribute('playsinline', '');
  el.style.display = 'none';
  el.dataset.cgoldCallAudio = '1';
  document.body.appendChild(el);
  return el;
}

/**
 * Call from a click handler before answering or dialling. Starts playback on
 * a silent stream so the browser treats the element as user-initiated; the
 * remote track is swapped in later without needing a second gesture.
 */
export function primeCallAudio() {
  // Start capture inside the click/tap: Safari iOS will not grant the mic after
  // an await. Errors surface from ensureMicrophone() / answer().
  startMicPrime().catch(() => {});
  if (typeof document === 'undefined' || !document.body) return;
  try {
    if (!primedAudio || primedAudio.__inUse || !primedAudio.isConnected) primedAudio = createAudioElement();
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (Ctor) {
      primeCtx = primeCtx || new Ctor();
      if (primeCtx.state === 'suspended') primeCtx.resume().catch(() => {});
      primedAudio.srcObject = primeCtx.createMediaStreamDestination().stream;
    }
    primedAudio.muted = false;
    primedAudio.volume = 1;
    primedAudio.play().catch(() => {});
  } catch {
    // No audio output on this device; the call can still be answered.
  }
}

function remoteTracksOf(session) {
  const pc = session?.rtcPeerConnection;
  if (!pc || typeof pc.getReceivers !== 'function') return [];
  return pc
    .getReceivers()
    .map((receiver) => receiver.track)
    .filter((track) => track && track.kind === 'audio' && track.readyState !== 'ended');
}

function sameTracks(stream, tracks) {
  if (!stream) return false;
  const have = stream.getTracks().map((track) => track.id).sort();
  const want = tracks.map((track) => track.id).sort();
  return have.length === want.length && have.every((id, i) => id === want[i]);
}

/**
 * Play the far end through our element. Returns 'playing', 'blocked' (autoplay
 * policy refused; needs a click) or 'none' (no remote track yet).
 */
async function attachRemoteAudio(session) {
  if (typeof document === 'undefined' || !document.body) return 'none';
  const tracks = remoteTracksOf(session);
  if (!tracks.length) return 'none';
  let el = sessionAudio.get(session);
  if (!el || !el.isConnected) {
    if (primedAudio && !primedAudio.__inUse && primedAudio.isConnected) el = primedAudio;
    else el = createAudioElement();
    el.__inUse = true;
    sessionAudio.set(session, el);
  }
  // Silence the SDK's detached element so the caller is not heard twice.
  try {
    if (session.audioElement && session.audioElement !== el) {
      session.audioElement.muted = true;
      session.audioElement.srcObject = null;
    }
  } catch {
    // SDK internals moved.
  }
  if (!sameTracks(el.srcObject, tracks)) el.srcObject = new MediaStream(tracks);
  el.muted = false;
  el.volume = 1;
  try {
    await el.play();
    return 'playing';
  } catch (err) {
    if (err?.name === 'AbortError') return 'playing'; // play() superseded by a newer play(): fine.
    return 'blocked';
  }
}

function releaseRemoteAudio(session) {
  const el = sessionAudio.get(session);
  if (!el) return;
  sessionAudio.delete(session);
  try {
    el.pause();
    el.srcObject = null;
  } catch {
    // Already torn down.
  }
  el.__inUse = false;
  if (el !== primedAudio) el.remove();
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
 *   onAudio(snapshot, state)             remote audio 'playing' | 'blocked' | 'none'
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
  onAudio,
  onStatus,
  debug = false,
}) {
  if (!isWebPhoneSupported) throw new Error('This browser cannot act as a phone.');
  if (!sipInfo) throw new Error('Missing SIP details.');
  installGetUserMediaGuard();
  // autoAnswer is required for Call Control `/answer`: RingCentral cancels the
  // ringing INVITE and sends a new one with Alert-Info: Auto Answer. Without
  // this the replacement INVITE just sits there and the original card vanishes.
  const phone = new WebPhone({
    sipInfo,
    instanceId: webPhoneInstanceId(extensionId),
    autoAnswer: true,
    deviceManager: new TolerantDeviceManager(),
    debug,
  });

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

    // Remote audio: attach once the peer connection has a receiver, and again
    // whenever a track is (re)negotiated (hold/unhold, re-INVITE).
    let pcWatched = null;
    const playRemote = async () => {
      if (!live(session)) return;
      const result = await attachRemoteAudio(session);
      onAudio?.({ ...snapshot }, result);
    };
    const watchPeer = () => {
      const pc = session.rtcPeerConnection;
      if (!pc || pc === pcWatched) return;
      pcWatched = pc;
      pc.addEventListener('track', () => {
        // Give the SDK's own ontrack a turn first so we can silence its element.
        setTimeout(playRemote, 0);
      });
    };

    // The SDK stores a reply on the session only after this event has fired.
    session.on('inboundMessage', () => setTimeout(refreshIds, 0));
    session.once('answered', () => {
      answered = true;
      refreshIds();
      onChange?.({ ...snapshot, status: 'CallConnected' }, {});
      watchPeer();
      playRemote();
    });
    session.once('failed', (reason) => {
      onChange?.({ ...snapshot, status: 'NoCall', ended: true, answered: false, failed: String(reason || '') }, {});
    });
    session.once('disposed', () => {
      forgetSession(session);
      releaseRemoteAudio(session);
      onChange?.({ ...snapshot, status: 'NoCall', ended: true, answered }, {});
    });
    if (session.state === 'answered') {
      watchPeer();
      playRemote();
    }
  };

  phone.on('inboundCall', (session) => {
    track(session, (snapshot) => onInbound?.(snapshot));
  });
  phone.on('outboundCall', (session) => {
    track(session, (snapshot) => onOutbound?.(snapshot));
  });

  const socket = () => phone.sipClient?.wsc || null;
  const isConnected = () => socket()?.readyState === 1;
  /** Stop the SDK's periodic re-REGISTER; `start()`/`register()` arm a fresh one. */
  const stopSdkRegisterTimer = () => {
    try {
      clearTimeout(phone.sipClient.timeoutHandle);
      phone.sipClient.timeoutHandle = undefined;
    } catch {
      // Private field may move; harmless if it does.
    }
  };
  /** Close a socket we are abandoning without treating its close as a drop. */
  const discardSocket = (ws) => {
    if (!ws) return;
    ws.__cgoldDiscarded = true;
    try {
      ws.close();
    } catch {
      // Already closed.
    }
  };

  const watchSocket = () => {
    const ws = socket();
    if (!ws || ws.__cgoldWatched) return;
    ws.__cgoldWatched = true;
    ws.addEventListener('close', () => {
      if (disposed || ws.__cgoldDiscarded || socket() !== ws) return;
      // The SDK re-registers on a timer against this now-dead socket; stop it.
      stopSdkRegisterTimer();
      onStatus?.('reconnecting', 'The phone connection dropped. Reconnecting…');
      scheduleReconnect();
    });
  };

  // The SDK's register() arms `setTimeout(() => this.wsc.close(), 5s)` and only
  // clears it when the reply arrives. `this.wsc` is read when the timer fires,
  // so opening a new socket inside that window gets it closed by a timer meant
  // for the dead one. Track unanswered REGISTERs and wait the window out.
  let pendingRegisterSince = 0; // when the last unanswered REGISTER went out; 0 = none pending
  const isRegisterCSeq = (value) => / REGISTER\s*$/i.test(String(value || ''));
  phone.sipClient.on('outboundMessage', (message) => {
    if (isRegisterCSeq(message?.headers?.CSeq)) pendingRegisterSince = Date.now();
  });
  phone.sipClient.on('inboundMessage', (message) => {
    if (isRegisterCSeq(safe(() => message.getHeader('CSeq')))) pendingRegisterSince = 0;
  });
  const waitOutPendingRegister = async () => {
    if (!pendingRegisterSince) return;
    const remaining = pendingRegisterSince + SDK_REGISTER_CLOSE_MS + 300 - Date.now();
    pendingRegisterSince = 0; // the socket it was sent on is being discarded
    if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
  };

  /**
   * Fresh WebSocket + REGISTER (the SDK's documented recovery: `webPhone.start()`).
   * The previous socket is discarded first; the SDK would otherwise leave it
   * open and still listening.
   */
  const connect = async () => {
    if (disposed) return;
    if (connecting) return connecting;
    connecting = (async () => {
      const previous = socket();
      const hadCalls = [...tracked].filter((session) => session.state === 'answered');
      try {
        stopSdkRegisterTimer();
        discardSocket(previous);
        await waitOutPendingRegister();
        if (disposed) return;
        await withSipTimeout(phone.start(), 'register', 15_000);
        if (disposed) return;
        reconnectAttempt = 0;
        watchSocket();
        onStatus?.('ready', '');
        // Calls that survived a dead socket may have lost their media path too
        // (network change on a phone). The README's recovery: re-INVITE them.
        for (const session of hadCalls) {
          if (session.state === 'answered') session.reInvite?.().catch?.(() => {});
        }
      } catch (err) {
        if (disposed) return;
        discardSocket(socket());
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

  /** Reconnect now (not on the backoff timer). Rejects if RingCentral cannot be reached. */
  const reconnectNow = async () => {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    reconnectAttempt = 0;
    onStatus?.('reconnecting', 'Reconnecting the phone…');
    try {
      await connect();
    } catch (err) {
      if (!disposed) {
        onStatus?.('reconnecting', 'Could not reach RingCentral. Retrying…');
        scheduleReconnect();
      }
      throw err;
    }
  };

  /**
   * Prove the registration is alive: send a REGISTER over the current socket
   * and wait for its 200. A socket the OS silently killed never answers, so a
   * timeout (or the SDK closing the socket itself) means "dead" and we rebuild.
   */
  let probing = null;
  const probeRegistration = () => {
    if (probing) return probing;
    probing = (async () => {
      const ws = socket();
      try {
        stopSdkRegisterTimer();
        await withSipTimeout(phone.sipClient.register(60), 'register', SIP_PROBE_TIMEOUT_MS);
        if (socket() !== ws || !isConnected()) throw new SipTimeoutError('register');
        onStatus?.('ready', '');
      } catch {
        if (disposed) return;
        if (socket() !== ws) {
          // Someone else already rebuilt the socket while we waited.
          if (isConnected()) return;
        } else {
          discardSocket(ws);
        }
        await reconnectNow();
      } finally {
        probing = null;
      }
    })();
    return probing;
  };

  /**
   * Make sure this tab is registered *right now*. Resolves once it is;
   * rejects when RingCentral cannot be reached (a retry is scheduled).
   *
   *   verify: also re-REGISTER over an open-looking socket to prove it is live
   *           (after the tab was hidden, before pulling a call here).
   */
  const ensureConnected = async ({ verify = false } = {}) => {
    if (disposed) throw new Error('The phone has been closed.');
    if (connecting) return connecting;
    if (!isConnected()) return reconnectNow();
    if (verify) return probeRegistration();
    return undefined;
  };

  await connect();
  harvestSdkSessions();

  let hiddenAt = 0;
  const onOnline = () => {
    ensureConnected({ verify: true }).catch(() => {});
  };
  const onVisible = () => {
    if (document.visibilityState !== 'visible') {
      hiddenAt = Date.now();
      return;
    }
    const hiddenFor = hiddenAt ? Date.now() - hiddenAt : 0;
    hiddenAt = 0;
    ensureConnected({ verify: hiddenFor >= SUSPECT_HIDDEN_MS }).catch(() => {});
  };
  const onPageShow = (event) => {
    if (event?.persisted) ensureConnected({ verify: true }).catch(() => {});
  };
  window.addEventListener('online', onOnline);
  window.addEventListener('pageshow', onPageShow);
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
    /**
     * Answer the INVITE this tab received: `inboundCallSession.answer()`, the
     * SDK's recommended path. The 200 OK goes out on the socket the INVITE came
     * in on, so a dead socket must fail here (as `sip_offline`) rather than
     * "answer" into the void and leave a silent call on the card.
     */
    async answer(idOrCall) {
      const session = require(idOrCall);
      if (session.state === 'answered') return;
      if (session.direction !== 'inbound') throw new Error('Only inbound calls can be answered.');
      if (!isConnected()) {
        const err = new Error('This browser is not connected to RingCentral right now.');
        err.code = 'sip_offline';
        throw err;
      }
      primeCallAudio();
      await withSipTimeout(session.answer(), 'answer', SIP_ANSWER_TIMEOUT_MS);
    },
    /**
     * Retry playing the far end (call from a click). Returns 'playing',
     * 'blocked' or 'none'.
     */
    async resumeAudio(idOrCall) {
      const session = resolve(idOrCall);
      if (!session || session.state !== 'answered') return 'none';
      return attachRemoteAudio(session);
    },
    /** Whether the far end is currently being played by this tab. */
    audioPlaying(idOrCall) {
      const session = resolve(idOrCall);
      const el = session ? sessionAudio.get(session) : null;
      return Boolean(el && el.srcObject && !el.paused);
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
        if (![...tracked].some(live)) stopPrimedMic();
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
      primeCallAudio();
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
      window.removeEventListener('pageshow', onPageShow);
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
      stopPrimedMic();
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
