import { getSupabase } from './supabase';

export const AGENT_CONVERSATION_TITLE = 'The Agent';
export const AGENT_REQUEST_STATUSES = ['new', 'in_progress', 'done'];

function asString(value) {
  if (value == null) return '';
  return String(value).trim();
}

function isMissingRelation(error) {
  const code = String(error?.code || '');
  const message = String(error?.message || '');
  if (code === '42P01' || code === 'PGRST202' || code === 'PGRST205') return true;
  return /schema cache/i.test(message) && /agent_requests/i.test(message);
}

export function newAgentConversationId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  const hex = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
  return `${hex()}${hex()}-${hex()}-4${hex().slice(1)}-a${hex().slice(1)}-${hex()}${hex()}${hex()}`;
}

export function mapAgentRequest(row) {
  if (!row?.id && !row?.body) return null;
  return {
    id: row.id,
    conversationId: row.conversation_id || row.conversationId,
    senderId: row.sender_id || row.senderId || '',
    body: asString(row.body),
    status: asString(row.status) || 'new',
    createdAt: row.created_at || row.createdAt || null,
    updatedAt: row.updated_at || row.updatedAt || null,
    localOnly: Boolean(row.localOnly),
  };
}

export function agentReceivedCopy(status) {
  if (status === 'done') return 'Done. This request is finished.';
  if (status === 'in_progress') return 'Received. This is in progress.';
  return 'Received. I’ll take it from here.';
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
    createdAt: request.createdAt,
    likedByMe: false,
    likeCount: 0,
    isAssistant: false,
    deliveryState: 'received',
    requestStatus: request.status,
  };
}

function requestToAckMessage(request) {
  return {
    id: `${request.id}-ack`,
    conversationId: request.conversationId,
    senderId: null,
    body: agentReceivedCopy(request.status),
    createdAt: request.updatedAt || request.createdAt,
    likedByMe: false,
    likeCount: 0,
    isAssistant: true,
    isAgentAck: true,
    deliveryState: 'received',
    requestStatus: request.status,
  };
}

export function groupAgentConversations(requests, myId) {
  const byConversation = new Map();
  (Array.isArray(requests) ? requests : []).forEach((request) => {
    if (!request?.conversationId || !request.body) return;
    const list = byConversation.get(request.conversationId) || [];
    list.push(request);
    byConversation.set(request.conversationId, list);
  });

  const inbox = [];
  const messages = {};
  byConversation.forEach((rows, conversationId) => {
    const ordered = rows.slice().sort((left, right) => {
      const a = left.createdAt ? new Date(left.createdAt).getTime() : 0;
      const b = right.createdAt ? new Date(right.createdAt).getTime() : 0;
      return a - b;
    });
    const last = ordered[ordered.length - 1];
    inbox.push({
      ...emptyAgentThread(conversationId),
      lastMessagePreview: last.body,
      lastMessageAt: last.createdAt,
      lastMessageSenderId: last.senderId || myId,
    });
    messages[conversationId] = ordered.flatMap((row) => [
      requestToUserMessage(row, myId),
      requestToAckMessage(row),
    ]);
  });

  inbox.sort((left, right) => {
    const a = left.lastMessageAt ? new Date(left.lastMessageAt).getTime() : 0;
    const b = right.lastMessageAt ? new Date(right.lastMessageAt).getTime() : 0;
    return b - a;
  });

  return { inbox, messages };
}

export async function listAgentRequests() {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('agent_requests')
    .select('id, conversation_id, sender_id, body, status, created_at, updated_at')
    .order('created_at', { ascending: true });
  if (error) {
    if (isMissingRelation(error)) return [];
    throw new Error(error.message || 'Could not load agent requests.');
  }
  return (data || []).map(mapAgentRequest).filter(Boolean);
}

export async function createAgentRequest({ conversationId, body, senderId } = {}) {
  const text = asString(body).slice(0, 4000);
  if (!text) throw new Error('Type a message first.');
  const threadId = asString(conversationId) || newAgentConversationId();
  const supabase = getSupabase();
  const payload = {
    conversation_id: threadId,
    body: text,
    status: 'new',
  };
  if (senderId) payload.sender_id = senderId;

  const { data, error } = await supabase
    .from('agent_requests')
    .insert(payload)
    .select('id, conversation_id, sender_id, body, status, created_at, updated_at')
    .single();

  if (error) {
    if (isMissingRelation(error)) {
      const now = new Date().toISOString();
      return {
        id: newAgentConversationId(),
        conversationId: threadId,
        senderId: senderId || '',
        body: text,
        status: 'new',
        createdAt: now,
        updatedAt: now,
        localOnly: true,
      };
    }
    throw new Error(error.message || 'Could not save that request.');
  }
  return mapAgentRequest(data);
}

/**
 * Isolated hand-off for a staff change request.
 *
 * TODO: Forward this request to the coding agent (webhook / Cursor Cloud).
 * Do not call any external URL until a destination is configured.
 * When ready, POST through the proxy Edge Function (`/proxy/agent/change-request`)
 * so vendor URLs and secrets stay server-side. The matching server hook is
 * `forwardAgentChangeRequest` in `supabase/functions/proxy/index.ts`.
 */
export async function forwardAgentRequest(request) {
  if (!request?.body) return { forwarded: false };
  // TODO: hand the request to the agent. No network call on purpose.
  return { forwarded: false, requestId: request.id || null };
}
