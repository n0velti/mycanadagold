import {
  addDmGroupMembers,
  findBlankAiDm,
  getOrCreateAiDm,
  isDefaultAiTitle,
  listDmInbox,
  listDmMessages,
  renameDmGroup,
  sendDmMessage,
} from './messages';

function asString(value) {
  return value == null ? '' : String(value).trim();
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    asString(value),
  );
}

export function dmMessageToTurn(message) {
  if (!message) return null;
  const content = asString(message.body);
  const charts = (Array.isArray(message.charts) ? message.charts : []).filter(
    (item) => item && typeof item === 'object',
  );
  const attachments = Array.isArray(message.attachments) ? message.attachments : [];
  if (!content && !charts.length && !attachments.length) return null;
  return {
    role: message.isAssistant ? 'assistant' : 'user',
    content,
    charts,
    attachments,
    senderId: message.senderId || '',
    messageId: message.id || '',
    createdAt: message.createdAt || '',
  };
}

export function turnsFromDmMessages(messages) {
  return (Array.isArray(messages) ? messages : []).map(dmMessageToTurn).filter(Boolean);
}

export function chatFromAiInboxRow(row) {
  if (!row?.conversationId) return null;
  const title = asString(row.title);
  const preview = asString(row.lastMessagePreview);
  return {
    id: row.conversationId,
    conversationId: row.conversationId,
    title: title && !isDefaultAiTitle(title) ? title : title || 'MyCanadaGold AI',
    scopeLabel: '',
    createdAt: row.lastMessageAt || '',
    updatedAt: row.lastMessageAt || '',
    pinned: false,
    placeholder: !preview,
    previewOnly: Boolean(preview),
    members: Array.isArray(row.members) ? row.members : [],
    turns: preview
      ? [
          {
            role: row.lastMessageIsAssistant ? 'assistant' : 'user',
            content: preview,
            senderId: row.lastMessageSenderId || '',
          },
        ]
      : [],
  };
}

export async function listSharedAiChats() {
  const inbox = await listDmInbox();
  return (inbox || []).filter((row) => row?.isAi).map(chatFromAiInboxRow).filter(Boolean);
}

/** Identity of a turn: its stored message when it has one, else its text. */
export function turnKey(turn) {
  if (turn?.messageId) return `id:${turn.messageId}`;
  return textKey(turn);
}

function textKey(turn) {
  return `${turn?.role || ''}:${asString(turn?.content)}`;
}

function isPendingTurn(turn) {
  return turn?.role === 'assistant' && !asString(turn?.content);
}

/**
 * `current` with `saved` folded in. A saved turn replaces the current turn
 * with the same message id, or, when one of the two has not been stored
 * yet, the current turn with the same words (two stored turns that share
 * their words are two messages and both stay). Local-only fields such as
 * usage survive the replacement; new turns are appended. Empty assistant
 * placeholders in `current` are dropped; the caller re-adds any it still
 * needs.
 */
export function mergeTurns(current, saved) {
  const next = (Array.isArray(current) ? current : []).filter((turn) => turn && !isPendingTurn(turn));
  const byId = new Map();
  const byText = new Map();
  const index = (turn, at) => {
    if (turn.messageId) byId.set(String(turn.messageId), at);
    const text = textKey(turn);
    if (!byText.has(text)) byText.set(text, []);
    byText.get(text).push(at);
  };
  next.forEach(index);
  (Array.isArray(saved) ? saved : []).forEach((turn) => {
    if (!turn) return;
    let at = turn.messageId ? byId.get(String(turn.messageId)) : undefined;
    if (at == null) {
      const candidates = byText.get(textKey(turn)) || [];
      at = candidates.find((candidate) => !turn.messageId || !next[candidate].messageId);
    }
    if (at != null) {
      next[at] = { ...next[at], ...turn };
      if (turn.messageId) byId.set(String(turn.messageId), at);
      return;
    }
    next.push(turn);
    index(turn, next.length - 1);
  });
  return next;
}

/** Thread turns from the database, with the usage this device recorded for them. */
export function withLocalTurnMeta(hydrated, local) {
  const byId = new Map();
  const byText = new Map();
  (Array.isArray(local?.turns) ? local.turns : []).forEach((turn) => {
    if (!turn?.usage) return;
    if (turn.messageId) byId.set(String(turn.messageId), turn.usage);
    if (!byText.has(textKey(turn))) byText.set(textKey(turn), turn.usage);
  });
  if (!byId.size && !byText.size) return hydrated;
  return {
    ...hydrated,
    turns: (hydrated.turns || []).map((turn) => {
      if (turn.usage) return turn;
      const usage = (turn.messageId && byId.get(String(turn.messageId))) || byText.get(textKey(turn));
      return usage ? { ...turn, usage } : turn;
    }),
  };
}

export async function hydrateAiDmChat(chat, myId) {
  const conversationId = asString(chat?.conversationId || chat?.id);
  if (!conversationId || !isUuid(conversationId)) return chat;
  const messages = await listDmMessages(conversationId, myId);
  if (!messages.length) {
    return { ...chat, id: conversationId, conversationId, previewOnly: false };
  }
  const last = messages[messages.length - 1];
  return withLocalTurnMeta(
    {
      ...chat,
      id: conversationId,
      conversationId,
      previewOnly: false,
      placeholder: false,
      updatedAt: last?.createdAt || chat.updatedAt,
      turns: turnsFromDmMessages(messages),
    },
    chat,
  );
}

export function mergeLocalAndSharedAiChats(local, shared) {
  const localRows = Array.isArray(local) ? local : [];
  const sharedRows = Array.isArray(shared) ? shared : [];
  const byConversation = new Map();
  sharedRows.forEach((row) => {
    if (row?.conversationId) byConversation.set(row.conversationId, row);
  });
  const extras = [];
  localRows.forEach((row) => {
    const conversationId = asString(row?.conversationId);
    if (!conversationId) {
      extras.push(row);
      return;
    }
    const sharedChat = byConversation.get(conversationId);
    if (!sharedChat) {
      extras.push({ ...row, conversationId });
      return;
    }
    const localTurns = Array.isArray(row.turns) ? row.turns : [];
    const sharedTurns = Array.isArray(sharedChat.turns) ? sharedChat.turns : [];
    // The thread in the database is the record. This device's copy is only
    // kept when nothing newer has landed there (someone else may have asked
    // the AI since); otherwise the row shows the thread's preview and loads
    // the full thread when opened.
    const sharedNewer = Boolean(sharedChat.updatedAt)
      && Boolean(row.updatedAt)
      && String(sharedChat.updatedAt) > String(row.updatedAt);
    const keepLocalTurns = !sharedNewer
      && (localTurns.length > sharedTurns.length || (sharedChat.previewOnly && localTurns.length > 0));
    byConversation.set(conversationId, {
      ...sharedChat,
      pinned: Boolean(row.pinned),
      previewOnly: keepLocalTurns ? false : Boolean(sharedChat.previewOnly),
      title: asString(row.title) && !isDefaultAiTitle(row.title) ? row.title : sharedChat.title,
      turns: keepLocalTurns ? localTurns : sharedTurns,
      members: sharedChat.members?.length ? sharedChat.members : row.members || [],
    });
  });
  return [...byConversation.values(), ...extras];
}

function persistableAttachments(attachments) {
  return (Array.isArray(attachments) ? attachments : []).filter((item) => item && (item.path || item.name));
}

export async function persistMissingAiTurns(conversationId, turns) {
  const id = asString(conversationId);
  if (!id) return Array.isArray(turns) ? turns : [];
  const next = [];
  for (const turn of Array.isArray(turns) ? turns : []) {
    if (!turn || (turn.role !== 'user' && turn.role !== 'assistant')) continue;
    const content = asString(turn.content);
    const charts = (Array.isArray(turn.charts) ? turn.charts : []).filter(
      (item) => item && typeof item === 'object',
    );
    const attachments = persistableAttachments(turn.attachments);
    if (!content && !charts.length && !attachments.length) continue;
    if (turn.messageId && isUuid(turn.messageId)) {
      next.push(turn);
      continue;
    }
    const saved = await sendDmMessage(id, content || '(Attachment)', {
      assistant: turn.role === 'assistant',
      charts,
      attachments,
    });
    next.push({
      ...turn,
      content: content || saved.body,
      messageId: saved.id,
      senderId: saved.senderId || turn.senderId,
      createdAt: saved.createdAt || turn.createdAt,
    });
  }
  return next;
}

async function openAiDm(conversationId) {
  const existing = asString(conversationId);
  if (existing && isUuid(existing)) return existing;
  const blank = findBlankAiDm(await listDmInbox());
  return blank?.conversationId || getOrCreateAiDm();
}

/**
 * Makes sure the chat has a thread in Messages and that every turn is in it.
 * Returns the thread id and the turns as stored (each with its messageId);
 * callers must keep those, or the next save writes the same turns again.
 */
export async function ensureAiDmForChat(chat) {
  const id = await openAiDm(chat?.conversationId);
  const label = asString(chat?.title);
  if (label && !isDefaultAiTitle(label)) {
    try {
      await renameDmGroup(id, label);
    } catch {
      // Title is best-effort; the thread still lands in Messages.
    }
  }
  const turns = Array.isArray(chat?.turns) ? chat.turns : [];
  const stored = turns.length ? await persistMissingAiTurns(id, turns) : [];
  return { id, turns: stored };
}

export async function shareAiChat({ conversationId, title, turns, memberIds }) {
  const ids = [...new Set((Array.isArray(memberIds) ? memberIds : []).map(asString).filter(Boolean))];
  const ensured = await ensureAiDmForChat({ conversationId, title, turns });
  if (ids.length) await addDmGroupMembers(ensured.id, ids);
  return ensured;
}
