import { proxyFetch, proxyJson } from './proxy';
import { mapRingCentralAccount } from './ringcentral';
import { storeKeyFromName } from './storeSettings';

function asString(value) {
  if (value == null) return '';
  return String(value).trim();
}

export function mapLiveCall(row) {
  if (!row) return null;
  const id = asString(row.id || row.telephonySessionId || row.sessionId);
  if (!id) return null;
  return {
    id,
    storeKey: asString(row.storeKey || row.store_key),
    storeName: asString(row.storeName || row.store_name),
    direction: asString(row.direction) === 'Outbound' ? 'Outbound' : 'Inbound',
    status: asString(row.status),
    from: asString(row.from),
    fromName: asString(row.fromName || row.from_name),
    to: asString(row.to),
    toName: asString(row.toName || row.to_name),
    telephonySessionId: asString(row.telephonySessionId),
    partyId: asString(row.partyId),
    sessionId: asString(row.sessionId),
    startTime: asString(row.startTime),
    extensionNumber: asString(row.extensionNumber),
    extensionName: asString(row.extensionName),
  };
}

export function mapCallLogEntry(row) {
  if (!row) return null;
  const id = asString(row.id);
  if (!id) return null;
  return {
    id,
    storeKey: asString(row.storeKey || row.store_key),
    storeName: asString(row.storeName || row.store_name),
    direction: asString(row.direction),
    result: asString(row.result),
    duration: Number(row.duration) || 0,
    startTime: asString(row.startTime),
    from: asString(row.from),
    fromName: asString(row.fromName),
    to: asString(row.to),
    toName: asString(row.toName),
  };
}

export function mapVoicemail(row) {
  if (!row) return null;
  const id = asString(row.id);
  if (!id) return null;
  return {
    id,
    storeKey: asString(row.storeKey || row.store_key),
    storeName: asString(row.storeName || row.store_name),
    from: asString(row.from),
    fromName: asString(row.fromName),
    to: asString(row.to),
    toName: asString(row.toName),
    subject: asString(row.subject),
    creationTime: asString(row.creationTime),
    readStatus: asString(row.readStatus),
    duration: Number(row.duration) || 0,
    attachmentId: asString(row.attachmentId),
  };
}

export function isRingingCall(call) {
  return Boolean(call && call.direction === 'Inbound' && /ringing|proceeding|setup/i.test(call.status || ''));
}

export function callPartyLabel(call, { formatPhone } = {}) {
  if (!call) return '';
  const inbound = call.direction !== 'Outbound';
  const number = inbound ? call.from : call.to;
  const name = inbound ? call.fromName : call.toName;
  const formatted = formatPhone ? formatPhone(number) : number;
  return [name, formatted].filter(Boolean).join(' · ') || 'Unknown';
}

export function formatCallWhen(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-CA', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function formatDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  if (mins <= 0) return `${secs}s`;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

export function resultLabel(value) {
  const key = asString(value);
  if (key === 'Accepted') return 'Answered';
  if (key === 'Missed') return 'Missed';
  if (key === 'Voicemail') return 'Voicemail';
  if (key === 'Rejected') return 'Rejected';
  if (key === 'Call connected') return 'Connected';
  if (!key) return '';
  return key.replace(/([a-z])([A-Z])/g, '$1 $2');
}

function gcd(a, b) {
  let x = Math.abs(Number(a) || 0);
  let y = Math.abs(Number(b) || 0);
  while (y) {
    const next = x % y;
    x = y;
    y = next;
  }
  return x || 1;
}

export function inboundOutcome(result, duration = 0) {
  const key = asString(result).toLowerCase();
  const seconds = Math.max(0, Number(duration) || 0);
  if (/voicemail/.test(key)) return 'voicemail';
  if (/rejected|declined|busy|blocked/.test(key)) return 'rejected';
  if (/missed|no answer|not answered|abandoned|offline|call failed|internal error/.test(key)) return 'missed';
  if (/hang[\s-]?up/.test(key)) return seconds > 0 ? 'answered' : 'missed';
  if (/accepted|call connected|\banswered\b|\breceived\b|forwarded/.test(key)) return 'answered';
  if (seconds > 0) return 'answered';
  return 'missed';
}

export function isAnsweredInbound(row) {
  return inboundOutcome(row?.result, row?.duration) === 'answered';
}

export function inboundCallsUnique(calls) {
  const inbound = (Array.isArray(calls) ? calls : []).filter((row) => asString(row?.direction) === 'Inbound');
  const unique = [];
  for (const row of inbound) {
    if (unique.some((existing) => sameInboundCall(existing, row))) continue;
    unique.push(row);
  }
  return unique;
}

export function liveLogEntry(call, result) {
  if (!call) return null;
  const id = `live:${asString(call.storeKey)}:${asString(call.telephonySessionId || call.id)}`;
  if (!call.storeKey || id === 'live::') return null;
  return {
    id,
    storeKey: asString(call.storeKey),
    storeName: asString(call.storeName),
    direction: 'Inbound',
    result: asString(result) || 'Missed',
    duration: 0,
    startTime: asString(call.startTime) || new Date().toISOString(),
    from: asString(call.from),
    fromName: asString(call.fromName),
    to: asString(call.to),
    toName: asString(call.toName),
  };
}

function inboundFingerprint(row) {
  return {
    store: asString(row?.storeKey),
    from: asString(row?.from).replace(/\D/g, '').slice(-10),
    start: Date.parse(row?.startTime) || 0,
  };
}

export function sameInboundCall(a, b) {
  if (a?.id && b?.id && a.id === b.id) return true;
  const left = inboundFingerprint(a);
  const right = inboundFingerprint(b);
  if (!left.store || left.store !== right.store) return false;
  if (!left.from || left.from !== right.from) return false;
  if (!left.start || !right.start) return false;
  return Math.abs(left.start - right.start) < 3 * 60 * 1000;
}

export function mergeCallLog(inboxCalls, liveEntries) {
  const inbox = Array.isArray(inboxCalls) ? inboxCalls : [];
  const extras = [];
  for (const live of Array.isArray(liveEntries) ? liveEntries : []) {
    if (!live?.id) continue;
    if (inbox.some((row) => sameInboundCall(row, live))) continue;
    extras.push(live);
  }
  return [...extras, ...inbox];
}

export function isLiveAnsweredStatus(status) {
  return /connected|answered|hold|parked/i.test(asString(status));
}

export function inboundCallRatio(calls) {
  const inbound = inboundCallsUnique(calls);
  let answered = 0;
  let missed = 0;
  let voicemail = 0;
  let rejected = 0;
  for (const row of inbound) {
    const outcome = inboundOutcome(row.result, row.duration);
    if (outcome === 'answered') answered += 1;
    else if (outcome === 'voicemail') {
      voicemail += 1;
      missed += 1;
    } else if (outcome === 'rejected') {
      rejected += 1;
      missed += 1;
    } else {
      missed += 1;
    }
  }
  const total = inbound.length;
  const simplified = total ? gcd(answered, total) : 1;
  return {
    inbound: total,
    total,
    answered,
    missed,
    voicemail,
    rejected,
    other: 0,
    scored: total,
    rate: total ? Math.round((answered / total) * 100) : null,
    ratio: total ? `${answered}:${total}` : '—',
    simplified: total ? `${answered / simplified}:${total / simplified}` : '—',
  };
}

async function phoneAction(action, body) {
  return proxyJson('ringcentral/phone', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...body }),
  });
}

function withStore(payload, extra = {}) {
  return {
    store: mapRingCentralAccount(payload?.store) || null,
    liveCalls: (Array.isArray(payload?.liveCalls) ? payload.liveCalls : []).map(mapLiveCall).filter(Boolean),
    incoming: (Array.isArray(payload?.incoming) ? payload.incoming : []).map(mapLiveCall).filter(Boolean),
    ...extra,
  };
}

export async function fetchPhonePresence(storeKey) {
  const key = storeKeyFromName(storeKey);
  if (!key) throw new Error('Choose a store.');
  const payload = await phoneAction('presence', { storeKey: key });
  return withStore(payload);
}

export async function fetchPhoneInbox(storeKey) {
  const key = storeKeyFromName(storeKey);
  if (!key) throw new Error('Choose a store.');
  const payload = await phoneAction('inbox', { storeKey: key });
  return {
    ...withStore(payload),
    calls: (Array.isArray(payload?.calls) ? payload.calls : []).map(mapCallLogEntry).filter(Boolean),
    voicemails: (Array.isArray(payload?.voicemails) ? payload.voicemails : []).map(mapVoicemail).filter(Boolean),
    callLogError: asString(payload?.callLogError),
    voicemailError: asString(payload?.voicemailError),
  };
}

export async function startRingOut(storeKey, to, from) {
  const key = storeKeyFromName(storeKey);
  if (!key) throw new Error('Choose a store.');
  const payload = await phoneAction('ringout', { storeKey: key, to, from });
  return {
    ...withStore(payload),
    ringOut: payload?.ringOut || null,
  };
}

export async function controlPhoneCall(action, call) {
  if (!call?.storeKey || !call?.telephonySessionId || !call?.partyId) {
    throw new Error('That call is no longer available.');
  }
  const payload = await phoneAction(action, {
    storeKey: call.storeKey,
    telephonySessionId: call.telephonySessionId,
    partyId: call.partyId,
  });
  return withStore(payload);
}

export async function fetchVoicemailAudioUrl(storeKey, messageId, attachmentId) {
  const key = storeKeyFromName(storeKey);
  if (!key || !messageId) throw new Error('Missing voicemail.');
  const params = new URLSearchParams({ storeKey: key, messageId: String(messageId) });
  if (attachmentId) params.set('attachmentId', String(attachmentId));
  const response = await proxyFetch(`ringcentral/voicemail-content?${params.toString()}`);
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error?.message || 'Could not load that voicemail.');
  }
  const blob = await response.blob();
  return URL.createObjectURL(blob);
}
