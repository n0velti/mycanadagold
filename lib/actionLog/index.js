/**
 * Application-wide action ledger.
 *
 * Every `Pressable` in the app (see ./reactNative.js + metro.config.js) calls
 * `recordAction` when pressed. Events are queued in memory, mirrored to
 * AsyncStorage so a crash or app kill does not lose them, and flushed to the
 * append-only `action_logs` table in small batches.
 *
 * App.js tells this module who is signed in (`setActionLogActor`) and where
 * they are (`setActionLogContext`), so each row carries the tab, app, and
 * person without every screen having to know about logging.
 */
import { AppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { getSupabase } from '../supabase';

const FLUSH_DELAY_MS = 1500;
const MAX_BATCH = 40;
const MAX_QUEUE = 2000;
const MAX_LABEL = 160;
const STORAGE_KEY = 'mcg.actionLog.pending.v1';
const PAUSE_AFTER_HARD_ERROR_MS = 60 * 1000;

let actor = null;
let context = { tab: '', appKey: '', appLabel: '' };
let queue = [];
let flushTimer = null;
let retryDelayMs = 0;
let pausedUntil = 0;
let restored = false;
let persistTimer = null;
let appStateBound = false;
let lastError = '';
const listeners = new Set();

const appSessionId = randomId();

function randomId() {
  try {
    if (typeof Crypto.randomUUID === 'function') return Crypto.randomUUID();
  } catch {
    // fall through
  }
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  const hex = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
  return `${hex()}${hex()}-${hex()}-4${hex().slice(1)}-a${hex().slice(1)}-${hex()}${hex()}${hex()}`;
}

function asString(value, max) {
  if (value == null) return '';
  const text = String(value).replace(/\s+/g, ' ').trim();
  return max ? text.slice(0, max) : text;
}

function notify() {
  for (const listener of listeners) {
    try {
      listener(getActionLogStatus());
    } catch {
      // ignore listener failures
    }
  }
}

export function getActionLogStatus() {
  return {
    pending: queue.length,
    actor: actor ? { ...actor } : null,
    context: { ...context },
    lastError,
    appSessionId,
  };
}

export function subscribeActionLogStatus(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Called by App.js whenever the session changes. */
export function setActionLogActor(session) {
  const id = session?.supabaseUserId || session?.profile?.id || '';
  if (!id) {
    actor = null;
    notify();
    return;
  }
  const profile = session.profile || {};
  actor = {
    id: String(id),
    name: asString(
      profile.fullName || [profile.firstName, profile.lastName].filter(Boolean).join(' ') || session.login,
      120,
    ),
    login: asString(profile.aureusLogin || session.login, 80),
    role: asString(profile.appRole, 40),
    store: asString(profile.locationName, 120),
  };
  notify();
  scheduleFlush(0);
}

/** Called by App.js whenever the active tab / app changes. */
export function setActionLogContext(next) {
  context = {
    tab: asString(next?.tab, 40),
    appKey: asString(next?.appKey, 60),
    appLabel: asString(next?.appLabel, 80),
  };
}

export function getActionLogContext() {
  return { ...context };
}

/**
 * Enqueue one interaction. Presses that happen while nobody is signed in are
 * dropped: the ledger only accepts attributed rows.
 */
export function recordAction({ action = 'press', label, icon, testId } = {}) {
  if (!actor) return null;
  const event = {
    client_event_id: randomId(),
    actor_id: actor.id,
    store_name: actor.store,
    action: action === 'long_press' ? 'long_press' : 'press',
    label: asString(label, MAX_LABEL),
    icon: asString(icon, 80),
    test_id: asString(testId, 120),
    tab: context.tab,
    app_key: context.appKey,
    app_label: context.appLabel,
    platform: Platform.OS,
    app_session_id: appSessionId,
    client_ts: new Date().toISOString(),
  };
  queue.push(event);
  if (queue.length > MAX_QUEUE) {
    queue = queue.slice(queue.length - MAX_QUEUE);
  }
  schedulePersist();
  scheduleFlush(queue.length >= MAX_BATCH ? 0 : FLUSH_DELAY_MS);
  notify();
  return event;
}

function schedulePersist() {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    persistQueue();
  }, 400);
}

async function persistQueue() {
  try {
    if (queue.length === 0) {
      await AsyncStorage.removeItem(STORAGE_KEY);
    } else {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(queue.slice(-MAX_QUEUE)));
    }
  } catch {
    // Storage is best-effort; the in-memory queue still flushes.
  }
}

async function restoreQueue() {
  if (restored) return;
  restored = true;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return;
    const seen = new Set(queue.map((item) => item.client_event_id));
    const older = parsed.filter(
      (item) => item && typeof item === 'object' && item.client_event_id && !seen.has(item.client_event_id),
    );
    queue = [...older, ...queue].slice(-MAX_QUEUE);
    notify();
    scheduleFlush(0);
  } catch {
    // Corrupt cache: start fresh.
    AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
  }
}

function bindAppState() {
  if (appStateBound || Platform.OS === 'web') return;
  appStateBound = true;
  AppState.addEventListener('change', (state) => {
    if (state === 'background' || state === 'inactive') {
      scheduleFlush(0);
    }
  });
}

function scheduleFlush(delay) {
  bindAppState();
  if (!restored) {
    restoreQueue();
  }
  if (flushTimer) {
    if (delay > 0) return;
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  const wait = Math.max(delay, pausedUntil > Date.now() ? pausedUntil - Date.now() : 0, retryDelayMs);
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushNow();
  }, wait);
}

function isNetworkError(error) {
  const message = String(error?.message || '').toLowerCase();
  return (
    !error?.code &&
    (/network|fetch|timeout|failed to|socket|offline|abort/.test(message) || error?.name === 'TypeError')
  );
}

function isDuplicate(error) {
  return error?.code === '23505';
}

function isHardError(error) {
  const code = String(error?.code || '');
  // Missing table, missing column, not allowed by RLS, bad payload.
  return /^(42P01|42703|42501|22|23|PGRST)/.test(code) || /not allowed/i.test(String(error?.message || ''));
}

function sanitizeForInsert(event) {
  // Only send columns the table knows about; actor_id is re-stamped server-side.
  return {
    client_event_id: event.client_event_id,
    actor_id: event.actor_id,
    store_name: event.store_name || '',
    action: event.action,
    label: event.label || '',
    icon: event.icon || '',
    test_id: event.test_id || '',
    tab: event.tab || '',
    app_key: event.app_key || '',
    app_label: event.app_label || '',
    platform: event.platform || '',
    app_session_id: event.app_session_id || '',
    client_ts: event.client_ts,
  };
}

async function insertRows(rows) {
  const supabase = getSupabase();
  const { error } = await supabase.from('action_logs').insert(rows);
  if (error) throw error;
}

/** Sends one batch. Resolves true when the queue can keep draining. */
async function flushBatch() {
  const batch = queue.slice(0, MAX_BATCH);
  // Rows queued under a different signed-in user cannot be attributed now.
  const mine = batch.filter((event) => event.actor_id === actor.id);

  try {
    if (mine.length > 0) {
      try {
        await insertRows(mine.map(sanitizeForInsert));
      } catch (error) {
        if (!isDuplicate(error)) throw error;
        // A retry after a lost response: insert one at a time and treat
        // duplicates as already recorded.
        for (const event of mine) {
          try {
            await insertRows([sanitizeForInsert(event)]);
          } catch (inner) {
            if (!isDuplicate(inner)) throw inner;
          }
        }
      }
    }
    // Rows from another signed-in user (if any) are dropped with the batch.
    queue = queue.slice(batch.length);
    retryDelayMs = 0;
    lastError = '';
    return true;
  } catch (error) {
    if (isNetworkError(error)) {
      retryDelayMs = Math.min(Math.max(retryDelayMs * 2, 2000), 60 * 1000);
      lastError = 'Offline. Activity will sync when the connection returns.';
    } else if (isHardError(error)) {
      // Do not spin on a payload the server refuses; drop this batch.
      queue = queue.slice(batch.length);
      pausedUntil = Date.now() + PAUSE_AFTER_HARD_ERROR_MS;
      lastError = error?.message || 'Activity log rejected a batch.';
    } else {
      retryDelayMs = Math.min(Math.max(retryDelayMs * 2, 5000), 60 * 1000);
      lastError = error?.message || 'Activity log could not sync.';
    }
    return false;
  }
}

let flushPromise = null;

/**
 * Flush everything queued right now. Concurrent callers share one in-flight
 * drain, so awaiting this before sign-out lands the last presses.
 */
export function flushNow() {
  if (flushPromise) return flushPromise;
  if (!actor || queue.length === 0) return Promise.resolve();
  if (pausedUntil > Date.now()) {
    scheduleFlush(pausedUntil - Date.now());
    return Promise.resolve();
  }

  flushPromise = (async () => {
    try {
      while (actor && queue.length > 0 && pausedUntil <= Date.now()) {
        const keepGoing = await flushBatch();
        if (!keepGoing) break;
      }
    } finally {
      flushPromise = null;
      schedulePersist();
      notify();
      if (queue.length > 0) scheduleFlush(retryDelayMs || FLUSH_DELAY_MS);
    }
  })();
  return flushPromise;
}

// ---------------------------------------------------------------------------
// Reading the ledger (Logs app)
// ---------------------------------------------------------------------------

export const ACTION_LOG_COLUMNS =
  'id, seq, client_event_id, actor_id, actor_name, actor_login, actor_role, store_name, action, label, icon, test_id, tab, app_key, app_label, platform, app_session_id, client_ts, created_at, prev_hash, hash';

export function mapActionLogRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    seq: Number(row.seq) || 0,
    clientEventId: row.client_event_id || '',
    actorId: row.actor_id || '',
    actorName: row.actor_name || 'Staff',
    actorLogin: row.actor_login || '',
    actorRole: row.actor_role || '',
    storeName: row.store_name || '',
    action: row.action || 'press',
    label: row.label || '',
    icon: row.icon || '',
    testId: row.test_id || '',
    tab: row.tab || '',
    appKey: row.app_key || '',
    appLabel: row.app_label || '',
    platform: row.platform || '',
    appSessionId: row.app_session_id || '',
    clientTs: row.client_ts || row.created_at || null,
    createdAt: row.created_at || null,
    prevHash: row.prev_hash || '',
    hash: row.hash || '',
  };
}

function escapeIlike(value) {
  return String(value || '')
    .replace(/[%_\\]/g, (match) => `\\${match}`)
    .replace(/[,()"]/g, ' ')
    .trim();
}

/**
 * Newest first. Pass `beforeSeq` to page further back.
 */
export async function listActionLogs({ limit = 60, beforeSeq, query, actorId, appKey } = {}) {
  const supabase = getSupabase();
  let request = supabase
    .from('action_logs')
    .select(ACTION_LOG_COLUMNS)
    .order('seq', { ascending: false })
    .limit(Math.max(1, Math.min(200, limit)));

  if (beforeSeq != null && Number.isFinite(Number(beforeSeq))) {
    request = request.lt('seq', Number(beforeSeq));
  }
  if (actorId) request = request.eq('actor_id', actorId);
  if (appKey) request = request.eq('app_key', appKey);

  const term = escapeIlike(query);
  if (term) {
    const pattern = `%${term}%`;
    request = request.or(
      [
        `label.ilike.${pattern}`,
        `actor_name.ilike.${pattern}`,
        `actor_login.ilike.${pattern}`,
        `app_label.ilike.${pattern}`,
        `icon.ilike.${pattern}`,
        `store_name.ilike.${pattern}`,
      ].join(','),
    );
  }

  const { data, error } = await request;
  if (error) throw error;
  return (data || []).map(mapActionLogRow).filter(Boolean);
}

export async function countActionLogs() {
  const supabase = getSupabase();
  const { count, error } = await supabase.from('action_logs').select('id', { count: 'exact', head: true });
  if (error) throw error;
  return count || 0;
}

export async function verifyActionLogChain() {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc('verify_action_log_chain');
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return {
    ok: Boolean(row?.ok),
    checked: Number(row?.checked) || 0,
    firstBadSeq: row?.first_bad_seq == null ? null : Number(row.first_bad_seq),
    lastSeq: Number(row?.last_seq) || 0,
  };
}

export function subscribeActionLogInserts(onInsert) {
  if (typeof onInsert !== 'function') return () => {};
  let supabase;
  try {
    supabase = getSupabase();
  } catch {
    return () => {};
  }
  const channel = supabase
    .channel(`action-logs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'action_logs' }, (payload) => {
      const mapped = mapActionLogRow(payload?.new);
      if (mapped) onInsert(mapped);
    })
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

// ---------------------------------------------------------------------------
// Describing a Pressable so the ledger has something human-readable
// ---------------------------------------------------------------------------

const MAX_DESCRIBE_DEPTH = 8;

function isIconElement(element) {
  const type = element?.type;
  if (!type || typeof type === 'string') return false;
  return Boolean(type.glyphMap || type.font) && typeof element.props?.name === 'string';
}

function collectText(node, out, depth) {
  if (node == null || node === false || depth > MAX_DESCRIBE_DEPTH) return;
  if (out.text.join(' ').length >= MAX_LABEL) return;

  if (typeof node === 'string' || typeof node === 'number') {
    const text = asString(node);
    if (text) out.text.push(text);
    return;
  }
  if (Array.isArray(node)) {
    for (const child of node) collectText(child, out, depth + 1);
    return;
  }
  if (typeof node === 'function') {
    try {
      collectText(node({ pressed: false, hovered: false, focused: false }), out, depth + 1);
    } catch {
      // render-prop children that need real state are skipped
    }
    return;
  }
  if (typeof node !== 'object') return;

  const props = node.props || {};
  if (isIconElement(node)) {
    if (!out.icon) out.icon = props.name;
    return;
  }
  if (typeof props.accessibilityLabel === 'string' && props.accessibilityLabel.trim()) {
    out.text.push(asString(props.accessibilityLabel));
    return;
  }
  for (const key of ['label', 'title', 'text']) {
    if (typeof props[key] === 'string' && props[key].trim()) {
      out.text.push(asString(props[key]));
      return;
    }
  }
  if ('children' in props) {
    collectText(props.children, out, depth + 1);
  }
}

/**
 * Turn Pressable props into { label, icon, testId } using the accessibility
 * label first, then any text rendered inside, then the first icon name.
 */
export function describePressable(props) {
  const out = { text: [], icon: '' };
  const explicit = asString(props?.accessibilityLabel || props?.['aria-label']);
  collectText(props?.children, out, 0);
  const label = explicit || out.text.join(' ').replace(/\s+/g, ' ').trim().slice(0, MAX_LABEL);
  return {
    label,
    icon: out.icon || '',
    testId: asString(props?.testID, 120),
  };
}
