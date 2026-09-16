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

export function inboundOutcome(result) {
  const key = asString(result).toLowerCase();
  if (/voicemail/.test(key)) return 'voicemail';
  if (/rejected|busy|blocked/.test(key)) return 'rejected';
  if (/accepted|answered|call connected|received/.test(key)) return 'answered';
  if (/missed|no answer|abandoned|hang up|ip phone offline/.test(key)) return 'missed';
  return 'other';
}

export function inboundCallRatio(calls) {
  const inbound = (Array.isArray(calls) ? calls : []).filter((row) => row?.direction === 'Inbound');
  let answered = 0;
  let missed = 0;
  let voicemail = 0;
  let rejected = 0;
  let other = 0;
  for (const row of inbound) {
    const outcome = inboundOutcome(row.result);
    if (outcome === 'answered') answered += 1;
    else if (outcome === 'voicemail') {
      voicemail += 1;
      missed += 1;
    } else if (outcome === 'rejected') {
      rejected += 1;
      missed += 1;
    } else if (outcome === 'missed') missed += 1;
    else other += 1;
  }
  const scored = answered + missed;
  const simplified = scored ? gcd(answered, missed) : 1;
  return {
    inbound: inbound.length,
    answered,
    missed,
    voicemail,
    rejected,
    other,
    scored,
    rate: scored ? Math.round((answered / scored) * 100) : null,
    ratio: scored ? `${answered}:${missed}` : '—',
    simplified: scored ? `${answered / simplified}:${missed / simplified}` : '—',
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
