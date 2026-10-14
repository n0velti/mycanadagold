/**
 * Tasks app: things the signed-in person still has to do, read from sources
 * they turn on (email, direct messages, phone) inside a rolling date window.
 *
 * Email comes only from `gmail/*` proxy routes for this session. Direct
 * messages are RLS-scoped to conversations they are in. Phone is the
 * RingCentral log for their store. Marks are cached on this device per
 * person; nothing from the sources is written to the database.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getGmailMessage, listGmailAccounts, listGmailMailbox, mapGmailMail } from './gmail';
import { getDirectProvider, streamChatCompletion } from './llmProviders';
import { contactName, conversationTitle, listDmInbox, listDmMessages } from './messages';
import { fetchPhoneHistory, fetchPhoneInbox, inboundOutcome, phoneHistoryNeeded } from './phoneCalls';
import { storeKeyFromName } from './storeSettings';
import { formatDateParam, parseDateParam } from './transactions';

/** Same catalog as Analytics AI — keys already saved in Settings. */
export const TASK_MODEL_OPTIONS = [
  { key: 'anthropic/claude-sonnet-5', label: 'Claude Sonnet 5', tag: 'Recommended' },
  { key: 'anthropic/claude-sonnet-4.6', label: 'Claude Sonnet 4.6', tag: 'Detailed' },
  { key: 'anthropic/claude-haiku-4.5', label: 'Claude Haiku 4.5', tag: 'Fast' },
  { key: 'x-ai/grok-4.7', label: 'Grok 4.7', tag: 'Grok' },
  { key: 'x-ai/grok-4.6', label: 'Grok 4.6', tag: 'Grok' },
  { key: 'x-ai/grok-4.20', label: 'Grok 4.20', tag: 'Grok' },
  { key: 'x-ai/grok-4.3', label: 'Grok 4.3', tag: 'Grok' },
  { key: 'openai/gpt-4.1', label: 'GPT-4.1', tag: 'GPT' },
  { key: 'openai/gpt-4.1-mini', label: 'GPT-4.1 mini', tag: 'Balanced' },
  { key: 'openai/gpt-4o-mini', label: 'GPT-4o mini', tag: 'Budget' },
];
export const DEFAULT_TASK_MODEL = TASK_MODEL_OPTIONS[0].key;

export const TASK_PRIORITIES = ['high', 'normal', 'low'];
const PRIORITY_RANK = { high: 0, normal: 1, low: 2 };

const INBOX_ROWS = 60;
const BODY_ROWS = 18;
const BODY_CHARS = 1400;
const SENT_ROWS = 25;
const DM_CONVERSATIONS = 20;
const DM_MESSAGES_PER = 40;
const DM_BODY_CHARS = 500;
const PHONE_ROWS = 40;
const MAX_TASKS = 40;

const SNAPSHOT_KEY = 'cgold.tasks.snapshot';
const STATE_KEY = 'cgold.tasks.state';
const MODEL_KEY = 'cgold.tasks.model';
const SOURCES_KEY = 'cgold.tasks.sources';

export const TASK_SOURCE_OPTIONS = [
  {
    key: 'email',
    label: 'Email',
    hint: 'Connected Google inboxes from the Emails app',
    icon: 'mail-outline',
  },
  {
    key: 'messages',
    label: 'Direct Messages',
    hint: 'Your chats with teammates and teams',
    icon: 'chatbubbles-outline',
  },
  {
    key: 'phone',
    label: 'Phone calls',
    hint: 'RingCentral calls and voicemail at your store',
    icon: 'call-outline',
  },
];

export const TASK_WINDOW_OPTIONS = [
  { days: 7, label: 'Last 7 days' },
  { days: 14, label: 'Last 14 days' },
  { days: 30, label: 'Last 30 days' },
  { days: 60, label: 'Last 60 days' },
  { days: 90, label: 'Last 90 days' },
];

export const DEFAULT_TASK_WINDOW_DAYS = 30;
const WINDOW_DAYS = new Set(TASK_WINDOW_OPTIONS.map((option) => option.days));

export function defaultTaskSources() {
  return { email: true, messages: true, phone: true, windowDays: DEFAULT_TASK_WINDOW_DAYS };
}

export function normalizeTaskSources(value) {
  const next = defaultTaskSources();
  if (!value || typeof value !== 'object') return next;
  const days = Number(value.windowDays);
  return {
    email: value.email !== false,
    messages: value.messages !== false,
    phone: value.phone !== false,
    windowDays: WINDOW_DAYS.has(days) ? days : DEFAULT_TASK_WINDOW_DAYS,
  };
}

export function sourcesEqual(a, b) {
  const left = normalizeTaskSources(a);
  const right = normalizeTaskSources(b);
  return (
    left.email === right.email &&
    left.messages === right.messages &&
    left.phone === right.phone &&
    left.windowDays === right.windowDays
  );
}

export function formatSourcesSummary(sources) {
  const prefs = normalizeTaskSources(sources);
  const labels = TASK_SOURCE_OPTIONS.filter((option) => prefs[option.key]).map((option) => option.label);
  const window =
    TASK_WINDOW_OPTIONS.find((option) => option.days === prefs.windowDays)?.label || `Last ${prefs.windowDays} days`;
  if (!labels.length) return `No sources · ${window}`;
  return `${labels.join(', ')} · ${window}`;
}

export function taskChannelLabel(channel) {
  if (channel === 'messages') return 'Messages';
  if (channel === 'phone') return 'Phone';
  return 'Email';
}

export function taskOpenLabel(channel) {
  if (channel === 'messages') return 'Open message';
  if (channel === 'phone') return 'Open call';
  return 'Open email';
}

export function taskConversationId(task) {
  if (task?.conversationId) return asString(task.conversationId);
  const id = asString(task?.id);
  if (id.startsWith('messages|')) return id.split('|')[1] || '';
  return '';
}

export function callbackNumberForTask(task) {
  const call = task?.phone;
  if (!call) return '';
  const inbound = asString(call.direction) !== 'Outbound';
  return inbound ? asString(call.from) : asString(call.to);
}

/** Live content for the Tasks source pane: the mail, thread, or call behind a task. */
export async function loadTaskSource(task, session) {
  const channel = task?.channel === 'messages' || task?.channel === 'phone' ? task.channel : 'email';
  if (channel === 'email') {
    if (!task?.account || !task?.messageId) throw new Error('This task is not linked to an email.');
    const { message } = await getGmailMessage(task.account, task.messageId);
    return { channel, mail: mapGmailMail({ ...message, account: task.account }) };
  }
  if (channel === 'messages') {
    const conversationId = taskConversationId(task);
    if (!conversationId) throw new Error('This task is not linked to a conversation.');
    const myId = session?.supabaseUserId || session?.profile?.id || '';
    const [messages, inbox] = await Promise.all([listDmMessages(conversationId, myId), listDmInbox()]);
    const conversation = (inbox || []).find((row) => row.conversationId === conversationId);
    const names = new Map((conversation?.members || []).map((member) => [member.id, contactName(member)]));
    return {
      channel,
      conversationId,
      title: asString(conversationTitle(conversation) || task.account || task.subject) || 'Messages',
      messages: messages.map((message) => ({
        ...message,
        fromName: message.senderId === myId ? 'You' : names.get(message.senderId) || 'Teammate',
      })),
    };
  }
  if (!task?.phone && !task?.messageId) throw new Error('This task is not linked to a call.');
  return { channel: 'phone', call: task.phone || null };
}

function asString(value) {
  if (value == null) return '';
  return String(value).trim();
}

function squash(text, limit) {
  return asString(text).replace(/\s+/g, ' ').slice(0, limit);
}

function compactAddress(address) {
  const email = asString(address?.email).toLowerCase();
  const name = asString(address?.name);
  if (name && email) return `${name} <${email}>`;
  return name || email || '';
}

async function mapPool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    const error = new Error('Cancelled.');
    error.name = 'AbortError';
    throw error;
  }
}

/** Account label the way the Emails app shows it: the part before the @. */
export function taskAccountLabel(email) {
  const text = asString(email).toLowerCase();
  return text.split('@')[0] || text || 'Inbox';
}

function windowStart(days) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (Math.max(1, Number(days) || DEFAULT_TASK_WINDOW_DAYS) - 1));
  return start;
}

function stampOf(value) {
  const at = new Date(value || 0).getTime();
  return Number.isFinite(at) ? at : 0;
}

function inWindow(value, start) {
  const at = stampOf(value);
  return at >= start.getTime();
}

function digestHasItems(digest) {
  return Boolean(
    (digest?.inboxes || []).some((inbox) => (inbox.messages?.length || 0) + (inbox.sent?.length || 0)) ||
      (digest?.threads || []).some((thread) => thread.messages?.length) ||
      (digest?.calls || []).length,
  );
}

async function loadEmailSource({ start, signal }) {
  const accounts = await listGmailAccounts();
  throwIfAborted(signal);
  const connected = accounts.filter((account) => account.connected);
  if (!connected.length) {
    return { accounts, connected: [], inboxes: [], messageCount: 0, empty: 'No Google inbox is connected in Emails.' };
  }
  const inboxes = await Promise.all(
    connected.map(async (account) => {
      try {
        const [inboxRes, sentRes] = await Promise.all([
          listGmailMailbox(account.email, 'inbox', { maxResults: INBOX_ROWS }),
          listGmailMailbox(account.email, 'sent', { maxResults: SENT_ROWS }),
        ]);
        throwIfAborted(signal);
        const rows = (inboxRes.messages || []).filter((row) => !row.createdAt || inWindow(row.createdAt, start));
        const sent = (sentRes.messages || []).filter((row) => !row.createdAt || inWindow(row.createdAt, start));
        const bodies = new Map();
        await mapPool(rows.slice(0, BODY_ROWS), 4, async (row) => {
          if (signal?.aborted) return;
          try {
            const { message } = await getGmailMessage(account.email, row.id);
            bodies.set(row.id, squash(message?.body, BODY_CHARS));
          } catch {
            // Keep the snippet for this one.
          }
        });
        throwIfAborted(signal);
        return {
          account: account.email,
          messages: rows.map((row) => ({
            id: asString(row.id),
            date: row.createdAt || undefined,
            from: compactAddress(row.from) || undefined,
            fromEmail: asString(row?.from?.email).toLowerCase() || undefined,
            to: (Array.isArray(row.to) ? row.to : []).map(compactAddress).filter(Boolean).slice(0, 4),
            subject: asString(row.subject) || '(No subject)',
            unread: row.unread || undefined,
            body: bodies.get(row.id) || undefined,
            preview: bodies.has(row.id) ? undefined : squash(row.snippet, 220) || undefined,
          })),
          sent: sent.map((row) => ({
            date: row.createdAt || undefined,
            to: (Array.isArray(row.to) ? row.to : []).map(compactAddress).filter(Boolean).slice(0, 4),
            subject: asString(row.subject) || '(No subject)',
            preview: squash(row.snippet, 160) || undefined,
          })),
        };
      } catch (error) {
        if (error?.name === 'AbortError') throw error;
        return { account: account.email, error: error?.message || 'This inbox did not load.' };
      }
    }),
  );
  const messageCount = inboxes.reduce((sum, inbox) => sum + (inbox.messages?.length || 0), 0);
  return { accounts, connected, inboxes, messageCount };
}

async function loadMessagesSource({ start, session, owner, signal }) {
  const myId = session?.supabaseUserId || session?.profile?.id || '';
  const inbox = await listDmInbox();
  throwIfAborted(signal);
  const conversations = inbox
    .filter((row) => !row.isAi && !row.isAgent)
    .filter((row) => !row.lastMessageAt || inWindow(row.lastMessageAt, start))
    .sort((a, b) => stampOf(b.lastMessageAt) - stampOf(a.lastMessageAt))
    .slice(0, DM_CONVERSATIONS);
  const threads = await mapPool(conversations, 4, async (conversation) => {
    const names = new Map((conversation.members || []).map((member) => [member.id, contactName(member)]));
    const title = conversationTitle(conversation);
    try {
      const messages = await listDmMessages(conversation.conversationId, myId);
      throwIfAborted(signal);
      const inRange = messages.filter((message) => !message.createdAt || inWindow(message.createdAt, start));
      return {
        id: conversation.conversationId,
        title,
        kind: conversation.isTeam ? 'team' : conversation.isGroup ? 'group' : 'direct',
        people: [...names.values()].slice(0, 12),
        unread: conversation.unreadCount || undefined,
        messages: inRange.slice(-DM_MESSAGES_PER).map((message) => ({
          id: asString(message.id),
          at: message.createdAt,
          from: message.senderId === myId ? `${owner || 'You'} (me)` : names.get(message.senderId) || 'Teammate',
          mine: message.senderId === myId || undefined,
          text: squash(message.body, DM_BODY_CHARS),
        })),
      };
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      return { id: conversation.conversationId, title, error: error?.message || 'This conversation did not load.' };
    }
  });
  return { threads: threads.filter((thread) => thread.error || thread.messages?.length) };
}

function personStore(session) {
  return asString(session?.profile?.locationName || session?.locationName);
}

function mentionsPerson(row, session) {
  const full = asString(session?.profile?.fullName).toLowerCase();
  const first = asString(session?.profile?.firstName).toLowerCase();
  const hay = [row?.fromName, row?.toName, row?.extensionName].map(asString).join(' ').toLowerCase();
  if (full && hay.includes(full)) return true;
  return Boolean(first && first.length > 2 && hay.includes(first));
}

async function loadPhoneSource({ start, session, windowDays, signal }) {
  const store = personStore(session);
  if (!store) {
    return { calls: [], error: 'No store is set on your profile, so phone calls were skipped.' };
  }
  const startKey = formatDateParam(start);
  const endKey = formatDateParam(new Date());
  const dateFrom = parseDateParam(startKey);
  const dateTo = parseDateParam(endKey);
  dateTo.setDate(dateTo.getDate() + 1);
  throwIfAborted(signal);
  const payload = phoneHistoryNeeded(startKey, endKey)
    ? await fetchPhoneHistory(store, { dateFrom, dateTo })
    : await fetchPhoneInbox(store);
  throwIfAborted(signal);
  const all = [
    ...(payload.calls || []).map((row) => ({
      kind: 'call',
      id: asString(row.id),
      at: row.startTime,
      direction: asString(row.direction),
      result: asString(row.result),
      outcome: inboundOutcome(row.result, row.duration),
      from: asString(row.from),
      fromName: asString(row.fromName),
      to: asString(row.to),
      toName: asString(row.toName),
      extensionName: asString(row.extensionName),
      duration: Number(row.duration) || 0,
      recordingId: asString(row.recordingId) || undefined,
    })),
    ...(payload.voicemails || []).map((row) => ({
      kind: 'voicemail',
      id: asString(row.id),
      at: row.creationTime,
      direction: 'Inbound',
      result: 'Voicemail',
      outcome: 'voicemail',
      from: asString(row.from),
      fromName: asString(row.fromName),
      to: asString(row.to),
      toName: asString(row.toName),
      subject: squash(row.subject, 160) || undefined,
      duration: Number(row.duration) || 0,
    })),
  ].filter((row) => row.id && (!row.at || inWindow(row.at, start)));

  const personal = all.filter((row) => mentionsPerson(row, session));
  const actionable = all.filter((row) => row.outcome === 'missed' || row.outcome === 'voicemail');
  const seen = new Set();
  const calls = [];
  for (const row of [...personal, ...actionable, ...all]) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    calls.push({ ...row, store, storeKey: storeKeyFromName(store) });
    if (calls.length >= PHONE_ROWS) break;
  }
  return {
    store,
    windowDays,
    error: payload.callLogError || payload.voicemailError || undefined,
    calls,
  };
}

/**
 * Pull the enabled sources inside the rolling window. Missing one source does
 * not block the others.
 */
export async function loadTaskDigest({ sources, session, owner, signal } = {}) {
  const prefs = normalizeTaskSources(sources);
  const start = windowStart(prefs.windowDays);
  const digest = {
    sources: prefs,
    since: start.toISOString(),
    windowDays: prefs.windowDays,
    accounts: [],
    connected: [],
    inboxes: [],
    threads: [],
    calls: [],
    store: '',
    messageCount: 0,
    itemCount: 0,
    noInbox: false,
    sourceErrors: [],
  };

  if (!prefs.email && !prefs.messages && !prefs.phone) {
    return digest;
  }

  const jobs = [];
  if (prefs.email) {
    jobs.push(
      loadEmailSource({ start, signal }).then((email) => {
        digest.accounts = email.connected?.map((account) => account.email) || [];
        digest.connected = email.connected || [];
        digest.inboxes = email.inboxes || [];
        digest.messageCount = email.messageCount || 0;
        digest.noInbox = Boolean(email.empty);
        if (email.empty) digest.sourceErrors.push(email.empty);
      }),
    );
  }
  if (prefs.messages) {
    jobs.push(
      loadMessagesSource({ start, session, owner, signal }).then((messages) => {
        digest.threads = messages.threads || [];
      }),
    );
  }
  if (prefs.phone) {
    jobs.push(
      loadPhoneSource({ start, session, windowDays: prefs.windowDays, signal }).then((phone) => {
        digest.calls = phone.calls || [];
        digest.store = phone.store || '';
        if (phone.error) digest.sourceErrors.push(phone.error);
      }),
    );
  }

  const results = await Promise.allSettled(jobs);
  results.forEach((result) => {
    if (result.status === 'rejected') {
      const error = result.reason;
      if (error?.name === 'AbortError') throw error;
      digest.sourceErrors.push(error?.message || 'A source did not load.');
    }
  });
  digest.itemCount =
    digest.messageCount +
    digest.threads.reduce((sum, thread) => sum + (thread.messages?.length || 0), 0) +
    digest.calls.length;
  return digest;
}

function buildPrompt({ digest, owner, today }) {
  const name = owner || 'the signed-in person';
  const prefs = digest.sources || defaultTaskSources();
  const window = `the last ${prefs.windowDays} days (since ${String(digest.since || '').slice(0, 10)})`;
  const enabled = TASK_SOURCE_OPTIONS.filter((option) => prefs[option.key]).map((option) => option.label);
  const payload = {
    today,
    windowDays: prefs.windowDays,
    since: digest.since,
    sources: enabled,
    email: prefs.email
      ? {
          inboxes: (digest.inboxes || []).map((inbox) => ({
            account: inbox.account,
            error: inbox.error,
            inbox: inbox.messages,
            sent: inbox.sent,
          })),
        }
      : undefined,
    messages: prefs.messages ? { threads: digest.threads } : undefined,
    phone: prefs.phone ? { store: digest.store || undefined, calls: digest.calls } : undefined,
  };
  return `You are an assistant that turns ${name}'s selected sources into a to-do list. The JSON below is ${name}'s own data from ${enabled.join(', ') || 'no sources'} for ${window}.

Read every item and list each thing that still needs a reply, decision, callback, or action from ${name}. Skip newsletters, receipts, shipping notices, calendar auto-replies, marketing, system notifications, and answered phone calls unless one plainly asks ${name} to do something. Combine duplicate asks about the same thing into one task. Write for a busy colleague: short, concrete, no filler.

Return ONLY a JSON object, no prose and no code fence, shaped exactly like this:
{
  "summary": "Two or three plain sentences: how many things are open, which ones matter most and why, and anything already handled. No markdown.",
  "tasks": [
    {
      "sourceId": "email|<account email>|<message id>  OR  messages|<conversation id>|<message id>  OR  phone|<call id>",
      "channel": "email | messages | phone",
      "title": "Imperative, under 12 words, e.g. Send Julie the October bonus sheet",
      "detail": "One or two sentences on what is being asked, in your own words, with any numbers, names, or dates from the source.",
      "requester": "Person or company asking",
      "requesterEmail": "their address if known, else empty",
      "due": "a date or timing cue (e.g. Friday, Oct 20, before the audit), else empty",
      "priority": "high | normal | low",
      "handled": false,
      "handledNote": "when handled is true: one short sentence on what covers it, else empty"
    }
  ]
}

Rules: priority is high when someone is waiting, money, customers, compliance, a missed call/voicemail, or a date within a few days is involved; low when it is optional or informational. Keep tasks newest and most urgent first. At most ${MAX_TASKS} tasks. If there is nothing to do, return an empty tasks array and say so in summary. Use only the JSON below; never invent details. For email, "sent" is mail ${name} already sent, so a matching reply there is handled. For messages, "(me)" marks ${name}'s own chat. For phone, missed calls and voicemail still need a callback unless a later outbound to that number is present.

Sources:
${JSON.stringify(payload)}`;
}

function extractJsonObject(text) {
  const raw = asString(text)
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '');
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('The model did not return a task list. Try again.');
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    throw new Error('The model returned an unreadable task list. Try again or pick another model.');
  }
}

function normalizePriority(value) {
  const text = asString(value).toLowerCase();
  if (text.startsWith('h') || text === 'urgent') return 'high';
  if (text.startsWith('l')) return 'low';
  return 'normal';
}

function hashId(text) {
  let hash = 0;
  const value = asString(text);
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return `task-${Math.abs(hash).toString(36)}`;
}

function parseSourceId(value, hintedChannel) {
  const parts = asString(value)
    .split('|')
    .map((part) => asString(part))
    .filter(Boolean);
  if (parts[0] === 'email' || parts[0] === 'messages' || parts[0] === 'phone') {
    return { channel: parts[0], rest: parts.slice(1) };
  }
  if (hintedChannel === 'messages' || hintedChannel === 'phone' || hintedChannel === 'email') {
    return { channel: hintedChannel, rest: parts };
  }
  return { channel: 'email', rest: parts };
}

function normalizeTask(row, digest, index) {
  if (!row || typeof row !== 'object') return null;
  const title = squash(row.title, 140);
  if (!title) return null;
  const hinted = asString(row.channel).toLowerCase();
  const parsed = parseSourceId(row.sourceId, hinted);
  let channel = parsed.channel;
  let account = '';
  let messageId = '';
  let subject = '';
  let receivedAt = null;
  let requester = squash(row.requester, 80);
  let requesterEmail = asString(row.requesterEmail).toLowerCase();
  let id = '';

  if (channel === 'messages') {
    const conversationId = parsed.rest[0] || '';
    messageId = parsed.rest[1] || parsed.rest[0] || '';
    const thread = (digest.threads || []).find(
      (item) => item.id === conversationId || (item.messages || []).some((message) => message.id === messageId),
    );
    const found = (thread?.messages || []).find((message) => message.id === messageId) || null;
    account = thread?.title || 'Messages';
    subject = thread?.title || '';
    receivedAt = found?.at || thread?.messages?.[thread.messages.length - 1]?.at || null;
    if (!requester && found?.from && !found.mine) requester = found.from;
    id = found && thread ? `messages|${thread.id}|${found.id}` : hashId(`messages|${conversationId}|${title}|${index}`);
    return {
      id,
      channel,
      messageId,
      conversationId: thread?.id || conversationId,
      account,
      title,
      detail: squash(row.detail, 600),
      requester,
      requesterEmail,
      subject,
      receivedAt,
      due: squash(row.due, 80),
      priority: normalizePriority(row.priority),
      handled: row.handled === true,
      handledNote: squash(row.handledNote, 200),
    };
  } else if (channel === 'phone') {
    const callId = parsed.rest[0] || '';
    const found = (digest.calls || []).find((call) => call.id === callId) || null;
    account = found?.store || digest.store || 'Phone';
    messageId = found?.id || callId;
    subject = found?.kind === 'voicemail' ? found.subject || 'Voicemail' : found?.result || 'Call';
    receivedAt = found?.at || null;
    if (!requester) requester = found?.fromName || found?.toName || found?.from || found?.to || '';
    id = found ? `phone|${found.id}` : hashId(`phone|${callId}|${title}|${index}`);
    return {
      id,
      channel,
      messageId,
      account,
      title,
      detail: squash(row.detail, 600),
      requester,
      requesterEmail,
      subject,
      receivedAt,
      due: squash(row.due, 80),
      priority: normalizePriority(row.priority),
      handled: row.handled === true,
      handledNote: squash(row.handledNote, 200),
      phone: found
        ? {
            store: found.store,
            storeKey: found.storeKey || storeKeyFromName(found.store || account),
            direction: found.direction,
            from: found.from,
            fromName: found.fromName,
            to: found.to,
            toName: found.toName,
            kind: found.kind,
            outcome: found.outcome,
            result: found.result,
            duration: found.duration,
            subject: found.subject,
            at: found.at,
          }
        : null,
    };
  } else {
    channel = 'email';
    const accountPart = parsed.rest.length > 1 ? parsed.rest[0] : '';
    messageId = parsed.rest.length > 1 ? parsed.rest[1] : parsed.rest[0] || '';
    account = asString(accountPart).toLowerCase();
    let source = null;
    for (const inbox of digest.inboxes || []) {
      if (account && inbox.account !== account) continue;
      const found = (inbox.messages || []).find((message) => message.id === messageId);
      if (found) {
        source = { ...found, account: inbox.account };
        break;
      }
    }
    account = source?.account || account || (digest.connected?.[0]?.email ?? '');
    subject = source?.subject || '';
    receivedAt = source?.date || null;
    if (!requester && source?.from) requester = source.from.replace(/\s*<.*>$/, '');
    requesterEmail = requesterEmail || source?.fromEmail || '';
    id = source ? `email|${source.account}|${source.id}` : hashId(`email|${account}|${title}|${index}`);
    messageId = source?.id || messageId;
  }

  return {
    id,
    channel,
    messageId,
    conversationId: '',
    account,
    title,
    detail: squash(row.detail, 600),
    requester,
    requesterEmail,
    subject,
    receivedAt,
    due: squash(row.due, 80),
    priority: normalizePriority(row.priority),
    handled: row.handled === true,
    handledNote: squash(row.handledNote, 200),
  };
}

export function sortTasks(tasks) {
  const stamp = (task) => {
    const at = new Date(task?.receivedAt || 0).getTime();
    return Number.isFinite(at) ? at : 0;
  };
  return [...(tasks || [])].sort((a, b) => {
    const rank = (PRIORITY_RANK[a.priority] ?? 1) - (PRIORITY_RANK[b.priority] ?? 1);
    if (rank !== 0) return rank;
    return stamp(b) - stamp(a);
  });
}

function isProviderKeyError(message) {
  const text = String(message || '').toLowerCase();
  return /invalid x-api-key|invalid.?api.?key|incorrect api key|authentication_error|missing.?key|unauthorized/.test(
    text,
  );
}

/** Prefer the chosen model, then other Settings providers (OpenRouter, OpenAI, …). */
function modelsToTry(preferred) {
  const chosen = asString(preferred) || DEFAULT_TASK_MODEL;
  const keys = TASK_MODEL_OPTIONS.map((option) => option.key);
  const rest = keys.filter((key) => key !== chosen);
  const chosenProvider = getDirectProvider(chosen);
  const otherProviders = rest.filter((key) => getDirectProvider(key) !== chosenProvider);
  const sameProvider = rest.filter((key) => getDirectProvider(key) === chosenProvider);
  return [chosen, ...otherProviders, ...sameProvider];
}

/**
 * Ask the model for the task list. Returns `{ summary, tasks, model }`; tasks
 * are de-duplicated by source message and sorted by priority, then recency.
 * If the chosen provider's key is rejected, tries the other connected APIs.
 */
export async function extractTasks({ digest, model, owner, signal, onDelta } = {}) {
  if (!model) throw new Error('Pick an AI model.');
  if (!digestHasItems(digest)) {
    return { summary: 'Nothing in the selected sources for this window yet.', tasks: [], model };
  }
  const today = new Date().toISOString().slice(0, 10);
  const messages = [{ role: 'user', content: buildPrompt({ digest, owner, today }) }];
  const candidates = modelsToTry(model);
  const failedProviders = new Set();
  let lastKeyError = '';

  let text = '';
  let usedModel = model;
  for (const candidate of candidates) {
    const provider = getDirectProvider(candidate);
    if (failedProviders.has(provider)) continue;
    throwIfAborted(signal);
    try {
      text = await streamChatCompletion({
        model: candidate,
        maxTokens: 6000,
        signal,
        onDelta,
        messages,
      });
      usedModel = candidate;
      lastKeyError = '';
      break;
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      if (!isProviderKeyError(error?.message)) throw error;
      failedProviders.add(provider);
      lastKeyError = error?.message || 'invalid API key';
    }
  }
  if (!text) {
    throw new Error(
      lastKeyError
        ? `${lastKeyError}. Tasks uses the same Anthropic, OpenAI, and OpenRouter keys as Analytics — pick another model or update the key in Settings.`
        : 'Could not reach an AI model. Try another model or check Settings.',
    );
  }
  const parsed = extractJsonObject(text);
  const seen = new Set();
  const tasks = [];
  (Array.isArray(parsed.tasks) ? parsed.tasks : []).forEach((row, index) => {
    const task = normalizeTask(row, digest, index);
    if (!task || seen.has(task.id)) return;
    seen.add(task.id);
    tasks.push(task);
  });
  return {
    summary: squash(parsed.summary, 600) || (tasks.length ? '' : 'Nothing in the selected sources needs action right now.'),
    tasks: sortTasks(tasks.slice(0, MAX_TASKS)),
    model: usedModel,
  };
}

function storageKey(prefix, userId) {
  return `${prefix}.${asString(userId) || 'local'}`;
}

function parseJson(text, fallback) {
  if (!text) return fallback;
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' ? value : fallback;
  } catch {
    return fallback;
  }
}

export async function loadTasksSnapshot(userId) {
  const value = parseJson(await AsyncStorage.getItem(storageKey(SNAPSHOT_KEY, userId)).catch(() => null), null);
  if (!value || !Array.isArray(value.tasks)) return null;
  return {
    generatedAt: value.generatedAt || null,
    model: asString(value.model),
    summary: asString(value.summary),
    accounts: Array.isArray(value.accounts) ? value.accounts.map((email) => asString(email).toLowerCase()).filter(Boolean) : [],
    messageCount: Number(value.messageCount) || 0,
    itemCount: Number(value.itemCount) || Number(value.messageCount) || 0,
    sources: normalizeTaskSources(value.sources),
    tasks: value.tasks
      .map((task) => ({
        ...task,
        channel: task?.channel === 'messages' || task?.channel === 'phone' ? task.channel : 'email',
        conversationId: asString(task?.conversationId),
        phone: task?.phone && typeof task.phone === 'object' ? task.phone : null,
        priority: normalizePriority(task?.priority),
      }))
      .filter((task) => task?.id && task?.title),
  };
}

export async function saveTasksSnapshot(userId, snapshot) {
  await AsyncStorage.setItem(storageKey(SNAPSHOT_KEY, userId), JSON.stringify(snapshot)).catch(() => {});
}

/** Done / dismissed marks keyed by task id, each holding the ISO time it was set. */
export async function loadTasksState(userId) {
  const value = parseJson(await AsyncStorage.getItem(storageKey(STATE_KEY, userId)).catch(() => null), {});
  return {
    done: value.done && typeof value.done === 'object' ? value.done : {},
    dismissed: value.dismissed && typeof value.dismissed === 'object' ? value.dismissed : {},
  };
}

export async function saveTasksState(userId, state) {
  await AsyncStorage.setItem(storageKey(STATE_KEY, userId), JSON.stringify(state)).catch(() => {});
}

export async function loadTasksModel(userId) {
  const saved = asString(await AsyncStorage.getItem(storageKey(MODEL_KEY, userId)).catch(() => ''));
  return TASK_MODEL_OPTIONS.some((option) => option.key === saved) ? saved : DEFAULT_TASK_MODEL;
}

export async function saveTasksModel(userId, model) {
  await AsyncStorage.setItem(storageKey(MODEL_KEY, userId), asString(model)).catch(() => {});
}

export async function loadTasksSources(userId) {
  const saved = parseJson(await AsyncStorage.getItem(storageKey(SOURCES_KEY, userId)).catch(() => null), null);
  return normalizeTaskSources(saved);
}

export async function saveTasksSources(userId, sources) {
  await AsyncStorage.setItem(storageKey(SOURCES_KEY, userId), JSON.stringify(normalizeTaskSources(sources))).catch(() => {});
}

/** Drop marks for tasks that no longer exist so storage does not grow forever. */
export function pruneTasksState(state, tasks) {
  const ids = new Set((tasks || []).map((task) => task.id));
  const keep = (map) => Object.fromEntries(Object.entries(map || {}).filter(([id]) => ids.has(id)));
  return { done: keep(state?.done), dismissed: keep(state?.dismissed) };
}

/** Calendar days since the source arrived (0 = today). */
export function daysSinceReceived(value) {
  const at = new Date(value || 0);
  if (!value || !Number.isFinite(at.getTime())) return null;
  const start = new Date(at.getFullYear(), at.getMonth(), at.getDate());
  const today = new Date();
  const now = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.max(0, Math.round((now - start) / 86400000));
}

export function formatDaysAgo(value) {
  const days = daysSinceReceived(value);
  if (days == null) return '';
  if (days === 0) return 'Received today';
  if (days === 1) return 'Received 1 day ago';
  return `Received ${days} days ago`;
}

export function formatTaskWhen(value) {
  const at = new Date(value || 0);
  if (!Number.isFinite(at.getTime()) || !value) return '';
  const now = new Date();
  const sameDay = at.toDateString() === now.toDateString();
  if (sameDay) return at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (at.toDateString() === yesterday.toDateString()) return 'Yesterday';
  const days = Math.round((now - at) / 86400000);
  if (days < 7) return at.toLocaleDateString([], { weekday: 'short' });
  return at.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    year: at.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  });
}

export function formatUpdatedAgo(value) {
  const at = new Date(value || 0).getTime();
  if (!value || !Number.isFinite(at)) return '';
  const minutes = Math.max(0, Math.round((Date.now() - at) / 60000));
  if (minutes < 1) return 'Updated just now';
  if (minutes < 60) return `Updated ${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Updated ${hours} hr ago`;
  return `Updated ${formatTaskWhen(value)}`;
}
