/**
 * Live-call registry shared by the browser softphone (SIP) and the presence
 * poll. Pure functions over a plain object so React can diff it and tests can
 * drive it without a browser.
 *
 * Every call is keyed by its RingCentral telephony session id. Two rules keep
 * phantom calls out:
 *
 *  1. Sessions that ended here (SIP BYE/CANCEL, a control action, or the
 *     server reporting them gone) are remembered as tombstones and presence
 *     rows for them are ignored until a fresh SIP INVITE re-opens the session.
 *  2. Presence-only calls carry the time they were last reported and expire
 *     when the poll stops confirming them, so a failed poll never leaves a
 *     stale "ringing" row behind.
 */

export const CALL_TOMBSTONE_MS = 15 * 60_000;
export const PRESENCE_STALE_MS = 30_000;
/**
 * A call answered from here but without a SIP leg yet (Call Control answer)
 * keeps its card this long after presence stops listing it: RingCentral moves
 * the party to a new INVITE on answer and the poll briefly loses it.
 */
export const WEB_PRESENCE_GRACE_MS = 20_000;

function asString(value) {
  if (value == null) return '';
  return String(value).trim();
}

export function callKey(call) {
  return asString(call?.telephonySessionId || call?.id);
}

export function createCallState() {
  return { calls: {}, ended: {} };
}

export function isRingingStatus(status) {
  return /ringing|proceeding|setup/i.test(asString(status));
}

export function isConnectedStatus(status) {
  return /connected|answered|hold|parked/i.test(asString(status));
}

export function isDialingStatus(status) {
  return /dialing/i.test(asString(status));
}

function isEnded(state, key, now) {
  const tomb = state.ended[key];
  return Boolean(tomb) && now - tomb.at < CALL_TOMBSTONE_MS;
}

function normalize(call) {
  const key = callKey(call);
  return {
    ...call,
    id: key,
    telephonySessionId: asString(call.telephonySessionId) || key,
    partyId: asString(call.partyId),
    callId: asString(call.callId),
    storeKey: asString(call.storeKey),
    storeName: asString(call.storeName),
    direction: asString(call.direction) === 'Outbound' ? 'Outbound' : 'Inbound',
    status: asString(call.status),
    from: asString(call.from),
    fromName: asString(call.fromName),
    to: asString(call.to),
    toName: asString(call.toName),
    startTime: asString(call.startTime),
  };
}

/** Fields presence may fill in when the softphone did not know them. */
function fillMissing(target, source) {
  const next = { ...target };
  for (const field of ['from', 'fromName', 'to', 'toName', 'partyId', 'startTime', 'extensionNumber', 'extensionName', 'storeName']) {
    if (!next[field] && source[field]) next[field] = source[field];
  }
  return next;
}

/**
 * Replace the presence view of one store. Softphone-sourced calls keep their
 * SIP status (except outbound, where the SIP "answered" is not meaningful and
 * presence knows better) and only gain fields they were missing.
 */
export function applyPresence(state, storeKey, liveCalls, now = Date.now()) {
  const store = asString(storeKey);
  if (!store) return state;
  const incoming = new Map();
  let ended = state.ended;
  for (const raw of Array.isArray(liveCalls) ? liveCalls : []) {
    const call = normalize({ ...raw, storeKey: store });
    if (!call.id) continue;
    if (isEnded(state, call.id, now)) {
      // A leg that stopped ringing here may legitimately show up again as a
      // conversation on another device of the store; anything else stays dead.
      const tomb = state.ended[call.id];
      if (tomb.reason !== 'missed' || !isConnectedStatus(call.status)) continue;
      if (ended === state.ended) ended = { ...state.ended };
      delete ended[call.id];
    }
    incoming.set(call.id, call);
  }

  let changed = ended !== state.ended;
  const calls = { ...state.calls };
  for (const [key, existing] of Object.entries(state.calls)) {
    if (existing.storeKey !== store) continue;
    const fresh = incoming.get(key);
    if (!fresh) {
      // SIP-backed calls stay until the softphone or a hang-up says they are
      // over. A browser-answered call with no SIP leg yet gets a grace period
      // (presence drops a party the moment we answer it) and is then trusted
      // to presence again, so a call that really moved elsewhere cannot leave
      // a permanent "on call" card behind.
      if (existing.sip) continue;
      if (existing.web && now - (existing.seenAt || 0) <= WEB_PRESENCE_GRACE_MS) continue;
      delete calls[key];
      changed = true;
      continue;
    }
    incoming.delete(key);
    let next = fillMissing(existing, fresh);
    next.seenAt = now;
    next.presence = true;
    if (!existing.sip) {
      // A call answered from this browser stays "connected" even when the
      // poll still reports the party as ringing: the server caches the
      // telephony-session snapshot for a few seconds after Answer, and that
      // stale row used to flip the live card back to an incoming one.
      const keepConnected =
        existing.web && isConnectedStatus(existing.status) && !isConnectedStatus(fresh.status);
      next = keepConnected
        ? { ...next, direction: fresh.direction || existing.direction }
        : { ...next, status: fresh.status, direction: fresh.direction };
      if (isConnectedStatus(next.status) && !next.answeredAt) next.answeredAt = now;
    } else if (existing.direction === 'Outbound' && fresh.status) {
      // The SIP side reports outbound calls as answered the moment the INVITE
      // is accepted; only presence knows when the other party picked up.
      next = { ...next, status: fresh.status };
      if (isConnectedStatus(fresh.status) && !existing.answeredAt) next.answeredAt = now;
    }
    if (JSON.stringify(next) !== JSON.stringify(existing)) {
      calls[key] = next;
      changed = true;
    }
  }
  for (const [key, fresh] of incoming.entries()) {
    calls[key] = {
      ...fresh,
      presence: true,
      sip: false,
      web: false,
      seenAt: now,
      ...(isConnectedStatus(fresh.status) ? { answeredAt: now } : {}),
    };
    changed = true;
  }
  return changed ? { calls, ended } : state;
}

/** Drop presence-only rows the poll has not confirmed recently. */
export function expirePresence(state, now = Date.now()) {
  let changed = false;
  const calls = { ...state.calls };
  for (const [key, call] of Object.entries(state.calls)) {
    if (call.sip || call.web || isConnectedStatus(call.status) || isDialingStatus(call.status)) continue;
    if (now - (call.seenAt || 0) > PRESENCE_STALE_MS) {
      delete calls[key];
      changed = true;
    }
  }
  return changed ? { ...state, calls } : state;
}

/** A fresh INVITE (or outbound INVITE) from the softphone. Re-opens a tombstoned session. */
export function applySipCall(state, snapshot, now = Date.now()) {
  const call = normalize(snapshot);
  if (!call.id) return state;
  const ended = { ...state.ended };
  delete ended[call.id];
  const existing = state.calls[call.id];
  const merged = existing ? fillMissing(call, existing) : call;
  return {
    ended,
    calls: {
      ...state.calls,
      [call.id]: {
        ...merged,
        status: call.status || (call.direction === 'Outbound' ? 'Dialing' : 'Ringing'),
        sip: true,
        web: true,
        seenAt: now,
      },
    },
  };
}

/**
 * The softphone learned the RingCentral ids of a call it started (outbound
 * INVITEs only get `p-rc-api-ids` on the first provisional reply).
 */
export function rekeyCall(state, fromKey, snapshot, now = Date.now()) {
  const from = asString(fromKey);
  const next = normalize(snapshot);
  if (!from || !next.id || from === next.id) return state;
  const existing = state.calls[from];
  if (!existing) return state;
  const calls = { ...state.calls };
  delete calls[from];
  calls[next.id] = { ...fillMissing(next, existing), status: existing.status, sip: true, web: true, seenAt: now };
  if (state.calls[next.id]) calls[next.id] = fillMissing(calls[next.id], state.calls[next.id]);
  return { ...state, calls };
}

export function markAnswered(state, key, now = Date.now()) {
  const id = asString(key);
  const existing = state.calls[id];
  if (!existing) return state;
  return {
    ...state,
    calls: {
      ...state.calls,
      [id]: {
        ...existing,
        status: 'CallConnected',
        web: true,
        sip: existing.sip || false,
        answeredAt: existing.answeredAt || now,
        seenAt: now,
      },
    },
  };
}

export function setCallStatus(state, key, status, now = Date.now()) {
  const id = asString(key);
  const existing = state.calls[id];
  if (!existing || existing.status === status) return state;
  return { ...state, calls: { ...state.calls, [id]: { ...existing, status, seenAt: now } } };
}

/** Merge fields into a live call (ids learned late, names from presence, flags). */
export function patchCall(state, key, patch, now = Date.now()) {
  const id = asString(key);
  const existing = state.calls[id];
  if (!existing) return state;
  const next = { ...existing, ...patch, seenAt: now };
  if (JSON.stringify(next) === JSON.stringify(existing)) return state;
  return { ...state, calls: { ...state.calls, [id]: next } };
}

/**
 * The call is over as far as this browser is concerned. `reason` is one of
 * answered | rejected | missed | hangup | gone (used for the local call log).
 * A session that is already a tombstone keeps its first reason.
 */
export function endCall(state, key, reason = 'gone', now = Date.now()) {
  const id = asString(key);
  if (!id) return state;
  const existing = state.calls[id];
  if (!existing && state.ended[id]) return state;
  const calls = { ...state.calls };
  delete calls[id];
  const ended = { ...state.ended, [id]: { at: now, reason, call: existing || null } };
  return { calls, ended };
}

export function pruneEnded(state, now = Date.now()) {
  const keys = Object.keys(state.ended);
  if (keys.length <= 200 && !keys.some((key) => now - state.ended[key].at > CALL_TOMBSTONE_MS)) return state;
  const ended = {};
  for (const key of keys) {
    if (now - state.ended[key].at < CALL_TOMBSTONE_MS) ended[key] = state.ended[key];
  }
  return { ...state, ended };
}

export function clearStore(state, storeKey) {
  const store = asString(storeKey);
  const calls = {};
  let changed = false;
  for (const [key, call] of Object.entries(state.calls)) {
    if (call.storeKey === store) changed = true;
    else calls[key] = call;
  }
  return changed ? { ...state, calls } : state;
}

export function listCalls(state) {
  return Object.values(state.calls);
}

export function ringingCalls(state) {
  return listCalls(state).filter((call) => call.direction === 'Inbound' && isRingingStatus(call.status));
}

/** Calls whose audio is (or is about to be) in this browser. */
export function browserCalls(state) {
  return listCalls(state).filter(
    (call) => call.web && (isConnectedStatus(call.status) || isDialingStatus(call.status) || (call.direction === 'Outbound' && isRingingStatus(call.status))),
  );
}

export function endedReason(state, key) {
  return state.ended[asString(key)]?.reason || '';
}
