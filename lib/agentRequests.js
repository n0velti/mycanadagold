import { proxyJson } from './proxy';
import { getSupabase } from './supabase';

export const AGENT_CONVERSATION_TITLE = 'The Agent';
export const AGENT_REQUEST_STATUSES = ['new', 'in_progress', 'done'];
export const AGENT_APPROVAL_STATES = ['pending_review', 'approved', 'not_approved'];

const REQUEST_COLUMNS =
  'id, conversation_id, sender_id, body, image_urls, status, approval_state, approval_reason, created_at, updated_at';
const REQUEST_COLUMNS_NO_IMAGES =
  'id, conversation_id, sender_id, body, status, approval_state, approval_reason, created_at, updated_at';
const REQUEST_COLUMNS_LEGACY = 'id, conversation_id, sender_id, body, status, created_at, updated_at';
const EVENT_COLUMNS = 'id, request_id, conversation_id, body, status, approval_state, approval_reason, created_at';
const REQUEST_SELECT = `${REQUEST_COLUMNS}, events:agent_request_events ( ${EVENT_COLUMNS}, kind )`;
// Before the agent_builds migration the events table has no `kind` column.
const REQUEST_SELECT_NO_KIND = `${REQUEST_COLUMNS}, events:agent_request_events ( ${EVENT_COLUMNS} )`;

function asString(value) {
  if (value == null) return '';
  return String(value).trim();
}

function isMissingRelation(error) {
  const code = String(error?.code || '');
  const message = String(error?.message || '');
  if (code === '42P01' || code === 'PGRST202' || code === 'PGRST205') return true;
  return /schema cache/i.test(message) && /agent_request/i.test(message);
}

function isMissingStatusShape(error) {
  const message = String(error?.message || '');
  return /approval_state|approval_reason|agent_request_events|kind/i.test(message);
}

function isMissingImageUrls(error) {
  const message = String(error?.message || '');
  return /image_urls/i.test(message);
}

function mapImageUrls(row) {
  const raw = row?.image_urls ?? row?.imageUrls;
  if (!Array.isArray(raw)) return [];
  return raw.map((url) => asString(url)).filter(Boolean).slice(0, 4);
}

export function newAgentConversationId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  const hex = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
  return `${hex()}${hex()}-${hex()}-4${hex().slice(1)}-a${hex().slice(1)}-${hex()}${hex()}${hex()}`;
}

function mapEvent(row) {
  if (!row?.id && !row?.body) return null;
  return {
    id: row.id,
    requestId: row.request_id || row.requestId || null,
    conversationId: row.conversation_id || row.conversationId,
    body: asString(row.body),
    status: asString(row.status) || 'new',
    approvalState: asString(row.approval_state || row.approvalState) || 'pending_review',
    approvalReason: asString(row.approval_reason || row.approvalReason),
    kind: asString(row.kind) === 'reply' ? 'reply' : 'status',
    createdAt: row.created_at || row.createdAt || null,
  };
}

export function mapAgentRequest(row) {
  const imageUrls = mapImageUrls(row);
  if (!row?.id && !row?.body && !imageUrls.length) return null;
  const events = Array.isArray(row.events)
    ? row.events
    : Array.isArray(row.agent_request_events)
      ? row.agent_request_events
      : [];
  return {
    id: row.id,
    conversationId: row.conversation_id || row.conversationId,
    senderId: row.sender_id || row.senderId || '',
    body: asString(row.body),
    imageUrls,
    status: asString(row.status) || 'new',
    approvalState: asString(row.approval_state || row.approvalState) || 'pending_review',
    approvalReason: asString(row.approval_reason || row.approvalReason),
    createdAt: row.created_at || row.createdAt || null,
    updatedAt: row.updated_at || row.updatedAt || null,
    events: events.map(mapEvent).filter(Boolean),
    localOnly: Boolean(row.localOnly),
  };
}

export function approvalLabel(state) {
  if (state === 'approved') return 'Approved';
  if (state === 'not_approved') return 'Not approved';
  return 'Pending review';
}

export function progressLabel(status) {
  if (status === 'done') return 'Done';
  if (status === 'in_progress') return 'In progress';
  return 'New';
}

export function requestStatusLine(request) {
  if (!request) return '';
  const line = `${approvalLabel(request.approvalState)} · ${progressLabel(request.status)}`;
  const reason = asString(request.approvalReason);
  if (request.approvalState === 'not_approved' && reason) return `${line} — ${reason}`;
  return line;
}

export function agentReceivedCopy(requestOrStatus) {
  const status = typeof requestOrStatus === 'string' ? requestOrStatus : requestOrStatus?.status;
  const approval =
    typeof requestOrStatus === 'string' ? 'pending_review' : requestOrStatus?.approvalState || 'pending_review';
  if (status === 'done') return 'Done. This request is finished.';
  if (status === 'in_progress') return 'Received. This is being worked on.';
  if (approval === 'approved') return 'Approved. I’ll take it from here.';
  if (approval === 'not_approved') return 'Not approved.';
  return 'Received. Pending review — I’ll take it from here.';
}

export function agentStatusUpdateCopy(request, previous) {
  const approval = request?.approvalState || 'pending_review';
  const status = request?.status || 'new';
  const reason = asString(request?.approvalReason);
  const approvalChanged = !previous || previous.approvalState !== approval;
  const progressChanged = !previous || previous.status !== status;
  const parts = [];
  if (approvalChanged || !progressChanged) {
    if (approval === 'approved') parts.push('Approved.');
    else if (approval === 'not_approved') parts.push(reason ? `Not approved. ${reason}` : 'Not approved.');
    else parts.push('Pending review.');
  }
  if (progressChanged) {
    if (status === 'done') parts.push('Done. This request is finished.');
    else if (status === 'in_progress') parts.push('This is being worked on.');
    else parts.push('This request is new.');
  }
  return parts.join(' ').trim();
}

export function emptyAgentThread(conversationId = newAgentConversationId()) {
  return {
    conversationId,
    isAgent: true,
    isGroup: false,
    isAi: false,
    title: AGENT_CONVERSATION_TITLE,
    members: [],
    other: null,
    lastMessagePreview: '',
    lastMessageAt: null,
    lastMessageSenderId: null,
    unreadCount: 0,
  };
}

function requestToUserMessage(request, myId) {
  return {
    id: request.id,
    conversationId: request.conversationId,
    senderId: request.senderId || myId,
    body: request.body,
    imageUrls: Array.isArray(request.imageUrls) ? request.imageUrls : [],
    createdAt: request.createdAt,
    likedByMe: false,
    likeCount: 0,
    isAssistant: false,
    deliveryState: 'received',
    requestStatus: request.status,
    approvalState: request.approvalState,
    approvalReason: request.approvalReason,
    requestStatusLine: requestStatusLine(request),
  };
}

function requestToAckMessage(request) {
  return {
    id: `${request.id}-ack`,
    conversationId: request.conversationId,
    senderId: null,
    body: agentReceivedCopy(request),
    createdAt: request.createdAt,
    likedByMe: false,
    likeCount: 0,
    isAssistant: true,
    isAgentAck: true,
    deliveryState: 'received',
    requestStatus: request.status,
    approvalState: request.approvalState,
  };
}

function eventToStatusMessage(event) {
  return {
    id: event.id,
    conversationId: event.conversationId,
    senderId: null,
    body: event.body,
    createdAt: event.createdAt,
    likedByMe: false,
    likeCount: 0,
    isAssistant: true,
    isAgentAck: true,
    isAgentStatusUpdate: event.kind !== 'reply',
    isAgentReply: event.kind === 'reply',
    deliveryState: 'received',
    requestStatus: event.status,
    approvalState: event.approvalState,
    approvalReason: event.approvalReason,
  };
}

function sortByCreated(left, right) {
  const a = left.createdAt ? new Date(left.createdAt).getTime() : 0;
  const b = right.createdAt ? new Date(right.createdAt).getTime() : 0;
  return a - b;
}

export function groupAgentConversations(requests, myId) {
  const byConversation = new Map();
  (Array.isArray(requests) ? requests : []).forEach((request) => {
    if (!request?.conversationId || (!request.body && !(request.imageUrls || []).length)) return;
    const list = byConversation.get(request.conversationId) || [];
    list.push(request);
    byConversation.set(request.conversationId, list);
  });

  const inbox = [];
  const messages = {};
  byConversation.forEach((rows, conversationId) => {
    const ordered = rows.slice().sort(sortByCreated);
    const thread = ordered.flatMap((row) => {
      const events = (row.events || []).slice().sort(sortByCreated);
      return [requestToUserMessage(row, myId), requestToAckMessage(row), ...events.map(eventToStatusMessage)];
    });
    const last = thread[thread.length - 1];
    inbox.push({
      ...emptyAgentThread(conversationId),
      lastMessagePreview: last?.body || '',
      lastMessageAt: last?.createdAt || ordered[ordered.length - 1]?.createdAt || null,
      lastMessageSenderId: last && !last.isAssistant ? last.senderId || myId : null,
      lastMessageIsAssistant: Boolean(last?.isAssistant),
    });
    messages[conversationId] = thread;
  });

  inbox.sort((left, right) => {
    const a = left.lastMessageAt ? new Date(left.lastMessageAt).getTime() : 0;
    const b = right.lastMessageAt ? new Date(right.lastMessageAt).getTime() : 0;
    return b - a;
  });

  return { inbox, messages };
}

async function selectAgentRequests(supabase, { conversationId } = {}) {
  const attempts = [
    REQUEST_SELECT,
    REQUEST_SELECT_NO_KIND,
    REQUEST_COLUMNS,
    REQUEST_COLUMNS_NO_IMAGES,
    REQUEST_COLUMNS_LEGACY,
  ];
  let lastError = null;
  for (const columns of attempts) {
    let query = supabase.from('agent_requests').select(columns).order('created_at', { ascending: true });
    if (conversationId) query = query.eq('conversation_id', conversationId);
    const { data, error } = await query;
    if (!error) return (data || []).map(mapAgentRequest).filter(Boolean);
    lastError = error;
    if (isMissingRelation(error)) return [];
    if (!isMissingStatusShape(error) && !isMissingImageUrls(error)) break;
  }
  throw new Error(lastError?.message || 'Could not load agent requests.');
}

export async function listAgentRequests() {
  return selectAgentRequests(getSupabase());
}

export async function createAgentRequest({ conversationId, body, senderId, imageUrls } = {}) {
  const text = asString(body).slice(0, 4000);
  const urls = (Array.isArray(imageUrls) ? imageUrls : []).map((url) => asString(url)).filter(Boolean).slice(0, 4);
  if (!text && !urls.length) throw new Error('Type a message or attach a photo.');
  const threadId = asString(conversationId) || newAgentConversationId();
  const supabase = getSupabase();
  const payload = {
    conversation_id: threadId,
    body: text,
    status: 'new',
  };
  if (urls.length) payload.image_urls = urls;
  if (senderId) payload.sender_id = senderId;

  const attempts = [REQUEST_COLUMNS, REQUEST_COLUMNS_NO_IMAGES, REQUEST_COLUMNS_LEGACY];
  let lastError = null;
  for (const columns of attempts) {
    const row = { ...payload };
    if (columns === REQUEST_COLUMNS_NO_IMAGES || columns === REQUEST_COLUMNS_LEGACY) {
      delete row.image_urls;
    }
    const { data, error } = await supabase.from('agent_requests').insert(row).select(columns).single();
    if (!error) return mapAgentRequest(data);
    lastError = error;
    if (isMissingRelation(error)) break;
    if (!isMissingStatusShape(error) && !isMissingImageUrls(error)) break;
  }

  if (isMissingRelation(lastError)) {
    const now = new Date().toISOString();
    return {
      id: newAgentConversationId(),
      conversationId: threadId,
      senderId: senderId || '',
      body: text,
      imageUrls: urls,
      status: 'new',
      approvalState: 'pending_review',
      approvalReason: '',
      createdAt: now,
      updatedAt: now,
      events: [],
      localOnly: true,
    };
  }
  throw new Error(lastError?.message || 'Could not save that request.');
}

/**
 * Isolated hand-off for a staff change request.
 *
 * POSTs through the proxy Edge Function (`/proxy/agent/change-request`) so
 * the webhook URL and key stay server-side. Webhook errors must not fail
 * the user's submit — the row is already saved.
 */
export async function forwardAgentRequest(request) {
  if (!request?.body && !(request.imageUrls || []).length) return { forwarded: false };
  try {
    return await proxyJson('agent/change-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: request.id || null,
        body: request.body,
        image_urls: Array.isArray(request.imageUrls) ? request.imageUrls : [],
        created_at: request.createdAt || null,
        sender_id: request.senderId || null,
      }),
    });
  } catch (err) {
    console.warn('agent change request', err instanceof Error ? err.message : err);
    return { forwarded: false, requestId: request.id || null };
  }
}

/**
 * Trusted status update. The proxy accepts a System Admin session or the
 * server-side agent status secret. Requesting staff cannot change status.
 */
export async function updateAgentRequestStatus({ id, status, approvalState, reason } = {}) {
  const requestId = asString(id);
  if (!requestId) throw new Error('Missing request id.');
  const payload = { id: requestId };
  if (status) payload.status = status;
  if (approvalState) payload.approvalState = approvalState;
  if (reason !== undefined) payload.reason = reason;
  return proxyJson('agent/request-status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export function subscribeAgentRequests(onChange) {
  const supabase = getSupabase();
  const channel = supabase
    .channel(`agent-requests-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'agent_requests' }, () => {
      onChange?.();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'agent_request_events' }, () => {
      onChange?.();
    })
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}
