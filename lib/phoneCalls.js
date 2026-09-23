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
    telephonySessionId: asString(row.telephonySessionId),
    /** Set when RingCentral recorded the call; play it with fetchRecordingAudioUrl. */
    recordingId: asString(row.recordingId),
    recordingType: asString(row.recordingType),
  };
}

export function hasRecording(row) {
  return Boolean(asString(row?.recordingId));
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

/**
 * The proxy reads each store's own extensions, so a live call already carries
 * the store it rang at. A toll-free → IVR → store call has a shared dialled
 * number, which is why the number is not re-checked here.
 */
export function incomingCallBelongsToStore(call, store) {
  if (!call) return false;
  if (!store) return true;
  const callStore = asString(call.storeKey);
  return !callStore || callStore === asString(store.storeKey);
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

/** Call log for a POS store name, including RingCentral keys like "canada gold laval". */
export function callsForStore(mergedCallsByStore, storeName) {
  const merged = mergedCallsByStore && typeof mergedCallsByStore === 'object' ? mergedCallsByStore : {};
  const key = storeKeyFromName(storeName);
  if (!key) return [];
  if (Array.isArray(merged[key])) return merged[key];
  const matches = Object.keys(merged).filter((item) => {
    if (!item) return false;
    if (item === key) return true;
    if (item.includes(key)) return true;
    return key.length >= 4 && key.includes(item);
  });
  if (!matches.length) return [];
  matches.sort((a, b) => b.length - a.length);
  const hit = matches[0];
  return Array.isArray(merged[hit]) ? merged[hit] : [];
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

export function isPhoneRateLimitMessage(message) {
  return /rate[- ]limit|rate exceeded|paused this phone line|cmn-301|request rate exceeded/i.test(
    asString(message),
  );
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
  const rate = total ? Math.round((answered / total) * 100) : null;
  return {
    inbound: total,
    total,
    answered,
    missed,
    voicemail,
    rejected,
    other: 0,
    scored: total,
    rate,
    ratio: rate == null ? '—' : `${rate}%`,
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

export async function fetchPhonePresence(storeKey, { storePhone = '' } = {}) {
  const key = storeKeyFromName(storeKey);
  if (!key) throw new Error('Choose a store.');
  const payload = await phoneAction('presence', { storeKey: key, storePhone: asString(storePhone) });
  return withStore(payload);
}

export async function fetchPhoneInbox(storeKey, { storePhone = '' } = {}) {
  const key = storeKeyFromName(storeKey);
  if (!key) throw new Error('Choose a store.');
  const payload = await phoneAction('inbox', { storeKey: key, storePhone: asString(storePhone) });
  return {
    ...withStore(payload),
    calls: (Array.isArray(payload?.calls) ? payload.calls : []).map(mapCallLogEntry).filter(Boolean),
    voicemails: (Array.isArray(payload?.voicemails) ? payload.voicemails : []).map(mapVoicemail).filter(Boolean),
    callLogError: asString(payload?.callLogError),
    voicemailError: asString(payload?.voicemailError),
  };
}

/**
 * Call log + voicemail for one store inside [dateFrom, dateTo). Used when the
 * chosen day or range reaches past the rolling 14-day inbox.
 */
export async function fetchPhoneHistory(storeKey, { dateFrom, dateTo } = {}) {
  const key = storeKeyFromName(storeKey);
  if (!key) throw new Error('Choose a store.');
  const toIso = (value) => {
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) throw new Error('Pick a valid date.');
    return date.toISOString();
  };
  const payload = await phoneAction('history', { storeKey: key, dateFrom: toIso(dateFrom), dateTo: toIso(dateTo) });
  return {
    ...withStore(payload),
    dateFrom: asString(payload?.dateFrom),
    dateTo: asString(payload?.dateTo),
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

/** SIP details so this browser can register as the store's phone. */
export async function fetchSipProvision(storeKey) {
  const key = storeKeyFromName(storeKey);
  if (!key) throw new Error('Choose a store.');
  const payload = await phoneAction('sip', { storeKey: key });
  return {
    store: mapRingCentralAccount(payload?.store) || null,
    sipInfo: payload?.sipInfo || null,
    extensionId: asString(payload?.extensionId),
    extensionName: asString(payload?.extensionName),
    deviceId: asString(payload?.deviceId),
    callerIds: (Array.isArray(payload?.callerIds) ? payload.callerIds : []).map(asString).filter(Boolean),
    defaultCallerId: asString(payload?.defaultCallerId),
  };
}

/**
 * RingCentral says the party is not in a state that allows the action: it was
 * answered elsewhere, sent to voicemail, or the caller hung up.
 */
export function isCallGoneError(err) {
  if (err?.code === 'ringcentral_wrong_state' || err?.status === 409 || err?.status === 404) return true;
  return /WrongState|Incorrect State|not found|no longer|already (?:ended|answered)/i.test(asString(err?.message));
}

export async function controlPhoneCall(action, call, { deviceId = '' } = {}) {
  if (!call?.storeKey || !call?.telephonySessionId) {
    throw new Error('That call is no longer available.');
  }
  const payload = await phoneAction(action, {
    storeKey: call.storeKey,
    telephonySessionId: call.telephonySessionId,
    partyId: call.partyId,
    ...(action === 'answer' && deviceId ? { deviceId: asString(deviceId) } : {}),
  });
  return withStore(payload);
}

/**
 * Call Control "Make CallOut": RingCentral rings this browser's registered
 * device first (auto-answered by the softphone), then dials `to`. The
 * telephony session and party ids come back immediately.
 */
export async function startCallOut(storeKey, to, deviceId) {
  const key = storeKeyFromName(storeKey);
  if (!key) throw new Error('Choose a store.');
  const payload = await phoneAction('callout', { storeKey: key, to: asString(to), deviceId: asString(deviceId) });
  return {
    ...withStore(payload),
    call: mapLiveCall(payload?.call),
  };
}

/** RingCentral would not use this browser's device for call-out; dial over SIP instead. */
export function isCallOutRejected(err) {
  return err?.code === 'ringcentral_callout_rejected' || err?.code === 'ringcentral_no_device';
}

/**
 * On-demand recording of the store's leg of a live call. Start with no
 * recordingId; pass one with `active` false/true to pause/resume.
 */
export async function controlRecording(call, { recordingId = '', active } = {}) {
  if (!call?.storeKey || !call?.telephonySessionId) {
    throw new Error('That call is no longer available.');
  }
  const payload = await phoneAction('record', {
    storeKey: call.storeKey,
    telephonySessionId: call.telephonySessionId,
    partyId: call.partyId,
    ...(recordingId ? { recordingId: asString(recordingId), active: active !== false } : {}),
  });
  const recording = payload?.recording || {};
  return {
    id: asString(recording.id),
    active: recording.active !== false,
    telephonySessionId: asString(recording.telephonySessionId),
    partyId: asString(recording.partyId),
  };
}

/** Object URL for a call recording's audio (revoke it when done). */
export async function fetchRecordingAudioUrl(storeKey, recordingId) {
  const key = storeKeyFromName(storeKey);
  if (!key || !recordingId) throw new Error('Missing recording.');
  const params = new URLSearchParams({ storeKey: key, recordingId: String(recordingId) });
  const response = await proxyFetch(`ringcentral/recording-content?${params.toString()}`);
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error?.message || 'Could not load that recording.');
  }
  const blob = await response.blob();
  return URL.createObjectURL(blob);
}

export const INSIGHT_LANGUAGES = [
  { key: 'en-US', label: 'English' },
  { key: 'fr-CA', label: 'Français' },
];

export function mapCallInsight(row) {
  if (!row) return null;
  const id = asString(row.id);
  if (!id) return null;
  return {
    id,
    storeKey: asString(row.storeKey),
    storeName: asString(row.storeName),
    telephonySessionId: asString(row.telephonySessionId),
    recordingId: asString(row.recordingId),
    callLogId: asString(row.callLogId),
    source: asString(row.source) === 'ringsense' ? 'ringsense' : 'rc_ai',
    status: asString(row.status) || 'queued',
    languageCode: asString(row.languageCode),
    direction: asString(row.direction),
    from: asString(row.from),
    fromName: asString(row.fromName),
    to: asString(row.to),
    toName: asString(row.toName),
    duration: Number(row.duration) || 0,
    startTime: asString(row.startTime),
    result: row.result && typeof row.result === 'object' ? row.result : null,
    error: asString(row.error),
    createdAt: asString(row.createdAt),
    completedAt: asString(row.completedAt),
  };
}

/**
 * Send recorded calls to RingCentral's AI (Interaction Analytics). Each call
 * needs a `recordingId`; up to 25 per request. Results arrive asynchronously —
 * poll fetchCallInsights until `status` is done/failed.
 */
export async function requestCallInsights(storeKey, calls, { languageCode = 'en-US' } = {}) {
  const key = storeKeyFromName(storeKey);
  if (!key) throw new Error('Choose a store.');
  const rows = (Array.isArray(calls) ? calls : [])
    .filter(hasRecording)
    .slice(0, 25)
    .map((row) => ({
      id: row.id,
      telephonySessionId: row.telephonySessionId,
      recordingId: row.recordingId,
      direction: row.direction,
      from: row.from,
      fromName: row.fromName,
      to: row.to,
      toName: row.toName,
      duration: row.duration,
      startTime: row.startTime,
    }));
  if (!rows.length) throw new Error('Pick at least one recorded call.');
  const payload = await phoneAction('analyze', { storeKey: key, calls: rows, languageCode });
  return {
    queued: Number(payload?.queued) || 0,
    submitted: Number(payload?.submitted) || 0,
    skipped: Number(payload?.skipped) || 0,
    aiError: asString(payload?.aiError),
    insights: (Array.isArray(payload?.insights) ? payload.insights : []).map(mapCallInsight).filter(Boolean),
  };
}

/** Stored analyses for a store (also nudges queued jobs along). */
export async function fetchCallInsights(storeKey, { ids } = {}) {
  const key = storeKeyFromName(storeKey);
  if (!key) throw new Error('Choose a store.');
  const payload = await phoneAction('insights', { storeKey: key, ...(Array.isArray(ids) && ids.length ? { ids } : {}) });
  return {
    insights: (Array.isArray(payload?.insights) ? payload.insights : []).map(mapCallInsight).filter(Boolean),
    aiError: asString(payload?.aiError),
    tableMissing: Boolean(payload?.tableMissing),
  };
}

/** RingSense for RingEX insights for one call (needs a RingSense licence on the line). */
export async function fetchRingSenseInsight(storeKey, call) {
  const key = storeKeyFromName(storeKey);
  if (!key) throw new Error('Choose a store.');
  if (!call?.telephonySessionId) throw new Error('That call has no RingCentral session id.');
  const payload = await phoneAction('ringsense', {
    storeKey: key,
    telephonySessionId: call.telephonySessionId,
    calls: [
      {
        id: call.id,
        recordingId: call.recordingId,
        direction: call.direction,
        from: call.from,
        fromName: call.fromName,
        to: call.to,
        toName: call.toName,
        duration: call.duration,
        startTime: call.startTime,
      },
    ],
  });
  return { insight: mapCallInsight(payload?.insight), aiError: asString(payload?.aiError) };
}

// ---------------------------------------------------------------------------
// Insight result readers (RingCentral AI `InteractionObject` and RingSense)
// ---------------------------------------------------------------------------

function conversational(result, name) {
  const list = Array.isArray(result?.conversationalInsights) ? result.conversationalInsights : [];
  const hit = list.find((item) => asString(item?.name) === name);
  return Array.isArray(hit?.values) ? hit.values : [];
}

function speakerInsight(result, name) {
  const list = Array.isArray(result?.speakerInsights?.insights) ? result.speakerInsights.insights : [];
  const hit = list.find((item) => asString(item?.name) === name);
  return Array.isArray(hit?.values) ? hit.values : [];
}

/** One flat, display-ready view of whatever RingCentral returned. */
export function summarizeInsight(insight) {
  const result = insight?.result;
  if (!result || typeof result !== 'object') return null;
  if (insight.source === 'ringsense') return summarizeRingSense(result);
  const short = conversational(result, 'AbstractiveSummaryShort').map((v) => asString(v?.value)).filter(Boolean);
  const long = conversational(result, 'AbstractiveSummaryLong').map((v) => asString(v?.value)).filter(Boolean);
  const extractive = conversational(result, 'ExtractiveSummary').map((v) => asString(v?.value)).filter(Boolean);
  const sentimentRow = conversational(result, 'OverallSentiment')[0];
  const topics = conversational(result, 'Topics').map((v) => asString(v?.value)).filter(Boolean);
  const keyPhrases = conversational(result, 'KeyPhrases').map((v) => asString(v?.value)).filter(Boolean);
  const questions = conversational(result, 'QuestionsAsked')
    .map((v) => ({ question: asString(v?.question || v?.value), answer: asString(v?.answer), speaker: asString(v?.speakerId) }))
    .filter((row) => row.question);
  const utterances = (Array.isArray(result.utteranceInsights) ? result.utteranceInsights : [])
    .map((u) => ({
      start: Number(u?.start) || 0,
      end: Number(u?.end) || 0,
      speaker: asString(u?.speakerId),
      text: asString(u?.text),
      emotion: asString((Array.isArray(u?.insights) ? u.insights : []).find((i) => asString(i?.name) === 'Emotion')?.value),
    }))
    .filter((u) => u.text);
  const talk = speakerInsight(result, 'TalkToListenRatio').map((v) => ({
    speaker: asString(v?.speakerId),
    value: Number(v?.value) || 0,
  }));
  const emotions = {};
  for (const u of utterances) {
    if (!u.emotion) continue;
    emotions[u.emotion] = (emotions[u.emotion] || 0) + 1;
  }
  return {
    summary: short[0] || extractive[0] || long[0] || '',
    summaryLong: long.join('\n\n') || extractive.join(' ') || '',
    sentiment: asString(sentimentRow?.value),
    sentimentScore: Number(sentimentRow?.confidence) || null,
    topics: [...new Set(topics)].slice(0, 12),
    keyPhrases: [...new Set(keyPhrases)].slice(0, 20),
    questions: questions.slice(0, 20),
    utterances,
    talkToListen: talk,
    emotions,
    speakerCount: Number(result.speakerInsights?.speakerCount) || 0,
  };
}

function summarizeRingSense(result) {
  // RingSense returns { insights: [{ name, value | values }] } (Summary, Transcript,
  // KeyPhrases, Topics, Sentiment…). Read defensively: names vary by release.
  const list = Array.isArray(result?.insights) ? result.insights : [];
  const byName = (name) => list.find((item) => new RegExp(`^${name}$`, 'i').test(asString(item?.name)));
  const values = (item) => {
    if (!item) return [];
    if (Array.isArray(item.values)) return item.values;
    if (item.value != null) return [item.value];
    return [];
  };
  const text = (item) =>
    values(item)
      .map((v) => (typeof v === 'string' ? v : asString(v?.value || v?.text)))
      .filter(Boolean);
  const summary = text(byName('(Abstractive)?Summary(Short)?'))[0] || text(byName('AISummary'))[0] || '';
  const transcript = values(byName('Transcript')).map((u) => ({
    start: Number(u?.start) || 0,
    end: Number(u?.end) || 0,
    speaker: asString(u?.speakerId || u?.speakerName || u?.speaker),
    text: typeof u === 'string' ? u : asString(u?.text || u?.value),
    emotion: '',
  }));
  return {
    summary,
    summaryLong: text(byName('(Abstractive)?SummaryLong')).join('\n\n'),
    sentiment: text(byName('(Overall)?Sentiment'))[0] || '',
    sentimentScore: null,
    topics: text(byName('Topics')).slice(0, 12),
    keyPhrases: text(byName('KeyPhrases')).slice(0, 20),
    questions: text(byName('Questions(Asked)?')).map((q) => ({ question: q, answer: '', speaker: '' })),
    utterances: transcript.filter((u) => u.text),
    talkToListen: [],
    emotions: {},
    speakerCount: 0,
  };
}

/** Roll a batch of finished analyses into one view (sentiment mix, top topics, phrases). */
export function summarizeInsightBatch(insights) {
  const done = (Array.isArray(insights) ? insights : []).filter((row) => row?.status === 'done' && row.result);
  const sentiments = {};
  const topics = new Map();
  const phrases = new Map();
  let totalDuration = 0;
  const summaries = [];
  for (const row of done) {
    const view = summarizeInsight(row);
    if (!view) continue;
    totalDuration += row.duration || 0;
    if (view.sentiment) sentiments[view.sentiment] = (sentiments[view.sentiment] || 0) + 1;
    for (const topic of view.topics) topics.set(topic, (topics.get(topic) || 0) + 1);
    for (const phrase of view.keyPhrases) phrases.set(phrase, (phrases.get(phrase) || 0) + 1);
    if (view.summary) summaries.push({ id: row.id, summary: view.summary, label: callPartyLabel(row) });
  }
  const top = (map, limit) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([value, count]) => ({ value, count }));
  return {
    analyzed: done.length,
    totalDuration,
    sentiments,
    topics: top(topics, 10),
    keyPhrases: top(phrases, 15),
    summaries,
  };
}

export function insightStatusLabel(row) {
  const status = asString(row?.status);
  if (status === 'done') return row.source === 'ringsense' ? 'RingSense' : 'Analyzed';
  if (status === 'processing') return 'Analyzing…';
  if (status === 'queued') return 'Queued';
  if (status === 'failed') return 'Failed';
  return '';
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
