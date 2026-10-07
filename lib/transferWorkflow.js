import { useEffect, useState } from 'react';
import { classifyPurchaseForTriage, stampTriagePurchase } from './priceCheck';
import { poDateKey } from './triageDailyReceipts';
import { sanitizeAllocation, sanitizeAllocationRow } from './triageAllocations';
import { errorAttributionStore } from './triageInsights';
import { lotFromPo } from './triageLots';
import { canonicalStoreName, storesMatch } from './storeCatalog';
import { getSupabase } from './supabase';
import { formatDateParam, formatPickerDate } from './transactions';
import {
  dropLegacyTriageCache,
  readLegacyTriageCache,
  readTriageCache,
  writeTriageCache,
} from './triageCache';

export const RECEIVE_STATUS = {
  not_received: 'not_received',
  partially_received: 'partially_received',
  all_received: 'all_received',
};

export const RECEIVE_STATUS_LABELS = {
  not_received: 'Not Received',
  partially_received: 'Partially Received',
  all_received: 'All Received',
};

let state = {
  nextNumber: 1,
  planned: [],
  triage: [],
  deleted: [],
  reviews: [],
};

const listeners = new Set();
let persistTimer = null;
let remoteTimer = null;
let hydratePromise = null;
let pullPromise = null;
let hydrated = false;
let remoteLoaded = false;
let resolveLocalReady = () => {};
const localReady = new Promise((resolve) => {
  resolveLocalReady = resolve;
});
let localDirty = false;
let pushingRemote = false;
let pushQueued = false;
let authBound = false;
let realtimeChannel = null;
let realtimePullTimer = null;
let removedTriageDates = new Set();
let removedTriageIds = new Set();
let removedPlannedIds = new Set();
let removedDeletedIds = new Set();
let removedReviewIds = new Set();
let purgedSourceIds = new Set();
// Incremental push bookkeeping: only rows that changed by reference since the
// last successful push are sent. A full push only happens when asked for
// explicitly (`pushTransferWorkflowFull`).
let dirtyTriageIds = new Set();
let dirtyPlannedIds = new Set();
let dirtyDeletedIds = new Set();
let dirtyReviewIds = new Set();
let metaDirty = false;
let fullPushPending = false;
let lastPushDoneAt = 0;
// What the server held the last time we looked, per row. Pulls fetch only the
// rows whose `updated_at` moved and drop rows the server no longer has. Rows
// that were never seen remotely are local-only and get pushed.
let remoteSeen = {
  triage: new Map(),
  reviews: new Map(),
  planned: new Set(),
  deleted: new Set(),
};
// Rows as last written to the local cache, by reference, so a persist writes
// only the rows that changed.
let persistedTriage = new Map();
let persistedReviews = new Map();
let persistChain = Promise.resolve();
let legacyCachePending = false;

const LOCAL_PERSIST_MS = 250;
const REMOTE_PUSH_MS = 900;
const REALTIME_ECHO_MS = 3000;
const REALTIME_PULL_DEBOUNCE_MS = 350;
const REMOTE_INDEX_PAGE = 1000;
const REMOTE_FETCH_CHUNK = 40;
const REMOTE_FETCH_PARALLEL = 4;

function markDirtyRows(prevRows, nextRows, target) {
  if (prevRows === nextRows) return;
  const prevById = new Map((prevRows || []).map((row) => [String(row?.id || ''), row]));
  for (const row of nextRows || []) {
    const id = String(row?.id || '');
    if (id && prevById.get(id) !== row) target.add(id);
  }
}

function newId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function addedAtFromTriageId(id) {
  const match = String(id || '').match(/^(?:qpo|xfer)-(\d{10,})/);
  if (!match) return '';
  const time = Number(match[1]);
  if (!Number.isFinite(time) || time < 1e12) return '';
  return new Date(time).toISOString();
}

let lastSnapshot = null;

/** Same object while nothing changed, so subscribers can bail out of renders. */
function snapshot() {
  const previous = lastSnapshot;
  if (
    previous &&
    previous.nextNumber === state.nextNumber &&
    previous.planned === state.planned &&
    previous.triage === state.triage &&
    previous.deleted === state.deleted &&
    previous.reviews === state.reviews &&
    previous.remoteLoaded === remoteLoaded &&
    previous.localReady === hydrated
  ) {
    return previous;
  }
  lastSnapshot = {
    nextNumber: state.nextNumber,
    planned: state.planned,
    triage: state.triage,
    deleted: state.deleted,
    reviews: state.reviews,
    remoteLoaded,
    localReady: hydrated,
  };
  return lastSnapshot;
}

function emit() {
  const next = snapshot();
  listeners.forEach((listener) => listener(next));
}

function isMissingTriageRelation(error) {
  const code = String(error?.code || '');
  const message = String(error?.message || '');
  if (code === '42P01' || code === 'PGRST205') return true;
  return /schema cache/i.test(message) && /triage_/i.test(message);
}

async function triageClient() {
  try {
    const supabase = getSupabase();
    const { data } = await supabase.auth.getSession();
    if (!data?.session?.user?.id) return null;
    return supabase;
  } catch {
    return null;
  }
}

function dateKeyOf(row) {
  const key = String(row?.dateKey || '');
  if (/^\d{4}-\d{2}-\d{2}/.test(key)) return key.slice(0, 10);
  return key;
}

function triageRowKey(row) {
  return String(row?.id || '') || dateKeyOf(row);
}

export function isStandaloneTriage(row) {
  return row?.kind === 'po';
}

function deletedSourceIds(list = state.deleted) {
  return new Set((list || []).map((row) => String(row?.sourceId || '')).filter(Boolean));
}

function deletedDocIds(list = state.deleted) {
  const ids = new Set(
    (list || []).filter((row) => row.kind === 'doc').map((row) => String(row.sourceId || '')).filter(Boolean),
  );
  for (const id of purgedSourceIds) ids.add(id);
  return ids;
}

function sanitizeReviewEditor(value) {
  if (!value || typeof value !== 'object') return null;
  const id = String(value.id || '').trim();
  const name = String(value.name || '').trim();
  const avatarUrl = String(value.avatarUrl || '').trim();
  if (!id && !name) return null;
  return { id, name, avatarUrl };
}

export function triageEditorFromSession(session) {
  if (!session) return null;
  const profile = session.profile || {};
  const name = String(
    profile.fullName ||
      [session.user?.first_name, session.user?.last_name].filter(Boolean).join(' ') ||
      session.user?.name ||
      session.user?.full_name ||
      session.login ||
      '',
  ).trim();
  const id = String(session.supabaseUserId || profile.id || '').trim();
  const avatarUrl = String(profile.avatarUrl || '').trim();
  return sanitizeReviewEditor({ id, name, avatarUrl });
}

export function triageReviewEditor(review) {
  const editedBy = sanitizeReviewEditor(review?.editedBy);
  const at = String(review?.editedAt || '').trim();
  if (!editedBy) return null;
  return { ...editedBy, at };
}

/** Stable content used to decide whether a save is an edit or just a view. */
export function triageReviewEditKey(review) {
  const draft = review?.draft && typeof review.draft === 'object' ? review.draft : null;
  const header = (draft?.header || []).map((field) => [String(field?.key || ''), String(field?.value ?? '')]);
  const items = (draft?.items || []).map((item) => [
    String(item?.name?.value ?? ''),
    String(item?.qty?.value ?? ''),
    String(item?.unit?.value ?? ''),
    String(item?.amount?.value ?? ''),
  ]);
  const payments = (draft?.payments || []).map((payment) => [
    String(payment?.method?.value ?? ''),
    String(payment?.till?.value ?? ''),
    String(payment?.currency?.value ?? ''),
    String(payment?.amount?.value ?? ''),
    String(payment?.notes?.value ?? ''),
  ]);
  const images = (Array.isArray(review?.images) ? review.images : [])
    .map((item) => (typeof item === 'string' ? item : item?.uri))
    .filter(Boolean);
  return JSON.stringify({
    header,
    items,
    payments,
    note: String(review?.note || '').trim(),
    errorType: String(review?.errorType || '').trim(),
    errorAmount: String(review?.errorAmount || '').trim(),
    images,
    lineEdits: (Array.isArray(review?.lineEdits) ? review.lineEdits : []).map((line) => [
      Number(line?.index),
      String(line?.originalAmount || '').trim(),
      String(line?.amount || '').trim(),
      String(line?.errorGrams || '').trim(),
    ]),
  });
}

export function latestTriageEditor(items) {
  let best = null;
  let bestTime = -1;
  for (const item of items || []) {
    const editor = triageReviewEditor(item?.review);
    if (!editor) continue;
    const time = Date.parse(editor.at || '') || 0;
    if (!best || time >= bestTime) {
      best = editor;
      bestTime = time;
    }
  }
  return best;
}

function sanitizeReviewRow(row) {
  const id = String(row?.id || row?.poId || '');
  const review = row?.review && typeof row.review === 'object' ? row.review : row?.payload?.review;
  if (!id || !review || typeof review !== 'object') return null;
  const editedBy = sanitizeReviewEditor(review.editedBy);
  return {
    id,
    review: editedBy
      ? {
          ...review,
          editedBy,
          editedAt: String(review.editedAt || row.updatedAt || row.updated_at || '').trim() || undefined,
        }
      : review,
    updatedAt: String(row.updatedAt || row.updated_at || row.payload?.updatedAt || new Date().toISOString()),
  };
}

function reviewsFromTriage(triage) {
  const rows = [];
  for (const batch of triage || []) {
    for (const item of flattenBatchPos(batch)) {
      if (item?.id && item.review) rows.push(sanitizeReviewRow({ id: item.id, review: item.review }));
    }
  }
  return rows.filter(Boolean);
}

/** Structural equality for JSON-shaped values (reviews, priced lines). */
function jsonEqual(a, b) {
  if (a === b) return true;
  if (a == null || b == null || typeof a !== 'object' || typeof b !== 'object') {
    return a === b || (Number.isNaN(a) && Number.isNaN(b));
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) if (!jsonEqual(a[i], b[i])) return false;
    return true;
  }
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
    if (!jsonEqual(a[key], b[key])) return false;
  }
  return true;
}

/** True when applying the review would leave the PO exactly as it already is. */
function poUnchangedByReview(item, updated) {
  for (const key of Object.keys(updated)) {
    const before = item[key];
    const after = updated[key];
    if (before === after) continue;
    if (key === 'review' || key === 'pricedLines') {
      if (!jsonEqual(before, after)) return false;
      continue;
    }
    return false;
  }
  return true;
}

function applyReviewsToTriage(triage, reviews) {
  const byId = new Map((reviews || []).map((row) => [String(row.id), row.review]));
  if (!byId.size) return triage;
  let changed = false;
  const out = (triage || []).map((batch) => {
    let next = batch;
    const stores = batch.stores || [];
    for (const store of stores) {
      for (const item of store.meltPos || []) {
        const review = byId.get(String(item?.id || ''));
        if (!review) continue;
        const placed = reviewOnItem(item, review, store.name);
        if (poUnchangedByReview(item, placed.item)) {
          // Already applied and already filed on the right store folder.
          const dest = findStoreByLabel(next.stores || [], placed.folder);
          if (dest && dest.id === store.id) continue;
        }
        next = placeItemOnNamedStore(next, placed.item, placed.folder);
      }
    }
    if (next !== batch) changed = true;
    return next;
  });
  return changed ? out : triage;
}

function allocationsFromTriage(triage) {
  const rows = [];
  for (const batch of triage || []) {
    for (const item of flattenBatchPos(batch)) {
      if (item?.id && item.allocation) {
        rows.push(sanitizeAllocationRow({ id: item.id, allocation: item.allocation }));
      }
    }
  }
  return rows.filter(Boolean);
}

function applyAllocationsToTriage(triage, allocations) {
  const byId = new Map((allocations || []).map((row) => [String(row.id), row]));
  if (!byId.size) return triage;
  return (triage || []).map((batch) => {
    let touched = false;
    const stores = (batch.stores || []).map((store) => {
      let storeTouched = false;
      const meltPos = (store.meltPos || []).map((item) => {
        const remote = byId.get(String(item?.id || ''));
        if (!remote?.allocation) return item;
        const localAt = Date.parse(item.allocation?.allocatedAt || 0) || 0;
        const remoteAt = Date.parse(remote.allocation.allocatedAt || remote.updatedAt || 0) || 0;
        if (item.allocation && localAt >= remoteAt) return item;
        storeTouched = true;
        touched = true;
        return { ...item, allocation: remote.allocation };
      });
      return storeTouched ? { ...store, meltPos } : store;
    });
    return touched ? { ...batch, stores } : batch;
  });
}

function poIdsOfDeletedEntry(entry) {
  if (entry?.kind === 'doc') {
    return [String(entry.sourceId || entry.item?.id || '')].filter(Boolean);
  }
  if (entry?.kind === 'po') {
    return flattenBatchPos(entry.payload)
      .map((item) => String(item?.id || ''))
      .filter(Boolean);
  }
  return [];
}

function dropDeletedPos(list, poIds) {
  const wanted = new Set((poIds || []).map((id) => String(id || '')).filter(Boolean));
  if (!wanted.size) return { next: list || [], removed: [] };
  const removed = [];
  const next = (list || []).filter((entry) => {
    if (poIdsOfDeletedEntry(entry).some((id) => wanted.has(id))) {
      removed.push(entry);
      return false;
    }
    return true;
  });
  return { next, removed };
}

/** Explicit add from POS wins over a prior delete/purge of the same PO. */
function revivePosForAdd(poIds) {
  const ids = (poIds || []).map((id) => String(id || '')).filter(Boolean);
  for (const id of ids) purgedSourceIds.delete(id);
  const { next, removed } = dropDeletedPos(state.deleted, ids);
  for (const entry of removed) removedDeletedIds.add(entry.id);
  return next;
}

function poIsBlocked(item, blocked) {
  if (!blocked?.size) return false;
  const id = String(item?.id || '');
  const sourceId = String(item?.sourceId || '');
  return Boolean((id && blocked.has(id)) || (sourceId && blocked.has(sourceId)));
}

function withoutDeletedDocs(list, deletedList = state.deleted) {
  const docIds = deletedDocIds(deletedList);
  const blocked = new Set([...docIds, ...purgedSourceIds]);
  if (!blocked.size) return list;
  return (list || []).map((row) => {
    let touched = false;
    const stores = (row.stores || []).map((store) => {
      const melt = (store.meltPos || []).filter((item) => !poIsBlocked(item, blocked));
      if (melt.length !== (store.meltPos || []).length) {
        touched = true;
        return { ...store, meltPos: melt };
      }
      return store;
    });
    return touched ? { ...row, stores } : row;
  });
}

function slimDeletedPurchase(item) {
  if (!item || typeof item !== 'object') return item;
  return {
    id: item.id,
    sourceId: item.sourceId,
    reference: item.reference,
    type: item.type,
    storeName: item.storeName,
    dateLabel: item.dateLabel,
    amountLabel: item.amountLabel,
    customerName: item.customerName,
    employeeName: item.employeeName,
    created_by: item.created_by,
    createdBy: item.createdBy,
    systemKey: item.systemKey,
    systemLabel: item.systemLabel,
  };
}

function sanitizeDeleted(row) {
  if (!row || typeof row !== 'object') return null;
  const kind = row.kind === 'po' || row.kind === 'doc' ? row.kind : 'batch';
  const id = String(row.id || newId('del'));
  const sourceId = String(row.sourceId || (kind === 'doc' ? row.item?.id : row.payload?.id) || id);
  const payload = kind === 'doc' ? null : sanitizeTriage(row.payload || row.row || row);
  const item = kind === 'doc' ? stampTriagePurchase(slimDeletedPurchase(row.item || row.payload || row)) : null;
  if (kind !== 'doc' && !payload) return null;
  if (kind === 'doc' && !item?.id) return null;
  return {
    id,
    kind,
    sourceId,
    sourceBatchId: String(row.sourceBatchId || '') || null,
    sourceDateKey: String(row.sourceDateKey || '') || null,
    sourceDateLabel: String(row.sourceDateLabel || '') || '',
    storeName: String(row.storeName || item?.storeName || '') || '',
    deletedAt: String(row.deletedAt || new Date().toISOString()),
    deletedBy: String(row.deletedBy || '') || '',
    payload,
    item,
  };
}

function syncTriageTombstones(prevRows, nextRows) {
  const nextIds = new Set((nextRows || []).map((row) => String(row?.id || '')).filter(Boolean));
  const nextDates = new Set(
    (nextRows || []).filter((row) => !isStandaloneTriage(row)).map(dateKeyOf).filter(Boolean),
  );
  for (const row of prevRows || []) {
    const id = String(row?.id || '');
    if (id && nextIds.has(id)) continue;
    if (id) removedTriageIds.add(id);
    const key = dateKeyOf(row);
    if (key && !isStandaloneTriage(row)) removedTriageDates.add(key);
  }
  for (const id of [...removedTriageIds]) {
    if (nextIds.has(id)) removedTriageIds.delete(id);
  }
  for (const key of [...removedTriageDates]) {
    if (nextDates.has(key)) removedTriageDates.delete(key);
  }
}

function syncPlannedTombstones(prevRows, nextRows) {
  const nextIds = new Set((nextRows || []).map((row) => String(row?.id || '')).filter(Boolean));
  for (const row of prevRows || []) {
    const id = String(row?.id || '');
    if (id && !nextIds.has(id)) removedPlannedIds.add(id);
  }
  for (const id of [...removedPlannedIds]) {
    if (nextIds.has(id)) removedPlannedIds.delete(id);
  }
}

function mergeByKey(localList, remoteList, keyFn, preferLocal, removedKeys) {
  const map = new Map();
  for (const row of localList || []) {
    const key = keyFn(row);
    if (!key || removedKeys?.has(key)) continue;
    map.set(key, row);
  }
  for (const row of remoteList || []) {
    const key = keyFn(row);
    if (!key || removedKeys?.has(key)) continue;
    if (!map.has(key) || !preferLocal) map.set(key, row);
  }
  return [...map.values()];
}

function mergeMeltPos(base, extra, blocked) {
  const map = new Map();
  for (const item of extra || []) {
    if (!item?.id || poIsBlocked(item, blocked)) continue;
    map.set(String(item.id), item);
  }
  for (const item of base || []) {
    if (!item?.id || poIsBlocked(item, blocked)) continue;
    map.set(String(item.id), item);
  }
  return [...map.values()];
}

function mergeTriageStores(baseStores, extraStores, blocked) {
  const stores = (baseStores || []).map((store) => ({
    ...store,
    meltPos: (store.meltPos || []).filter((item) => !poIsBlocked(item, blocked)),
  }));
  for (const extra of extraStores || []) {
    const dest = stores.find(
      (store) =>
        (extra.storeKey && store.storeKey && String(store.storeKey) === String(extra.storeKey)) ||
        namesMatch(store.name, extra.name),
    );
    const extraMelt = (extra.meltPos || []).filter((item) => !poIsBlocked(item, blocked));
    if (!dest) {
      stores.push({ ...extra, meltPos: extraMelt });
      continue;
    }
    dest.meltPos = mergeMeltPos(dest.meltPos, extraMelt, blocked);
  }
  return stores;
}

function mergeTriageRow(local, remote, preferLocal, blocked) {
  if (!local) return remote;
  if (!remote) return local;
  const base = preferLocal ? local : remote;
  const other = preferLocal ? remote : local;
  return {
    ...other,
    ...base,
    stores: mergeTriageStores(base.stores, other.stores, blocked),
  };
}

function mergeTriageLists(localList, remoteList, preferLocal, removedKeys, blockedItems) {
  const map = new Map();
  for (const row of localList || []) {
    const key = triageRowKey(row);
    if (!key || removedKeys?.has(key)) continue;
    map.set(key, row);
  }
  for (const row of remoteList || []) {
    const key = triageRowKey(row);
    if (!key || removedKeys?.has(key)) continue;
    const existing = map.get(key);
    map.set(key, existing ? mergeTriageRow(existing, row, preferLocal, blockedItems) : row);
  }
  return [...map.values()];
}

function reviewUpdatedAt(row) {
  return Date.parse(row?.updatedAt || row?.review?.editedAt || '') || 0;
}

function mergeReviews(localList, remoteList, preferLocal) {
  const map = new Map();
  for (const row of localList || []) {
    const key = String(row?.id || '');
    if (!key || removedReviewIds.has(key)) continue;
    map.set(key, row);
  }
  for (const row of remoteList || []) {
    const key = String(row?.id || '');
    if (!key || removedReviewIds.has(key)) continue;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, row);
      continue;
    }
    if (preferLocal) continue;
    if (reviewUpdatedAt(row) > reviewUpdatedAt(existing)) map.set(key, row);
  }
  return [...map.values()];
}

function batchFromRemote(row) {
  const dateKey = String(row?.date_key || '');
  return sanitizeTriage({
    id: row?.id,
    kind: row?.kind,
    dateKey: /^\d{4}-\d{2}-\d{2}/.test(dateKey) ? dateKey.slice(0, 10) : dateKey,
    dateLabel: row?.date_label,
    census: row?.census,
    triageLocation: row?.triage_location,
    stores: row?.stores,
  });
}

function cacheMeta() {
  return {
    version: 2,
    nextNumber: state.nextNumber,
    planned: state.planned,
    deleted: state.deleted,
    removedTriageDates: [...removedTriageDates],
    removedTriageIds: [...removedTriageIds],
    removedPlannedIds: [...removedPlannedIds],
    removedDeletedIds: [...removedDeletedIds],
    removedReviewIds: [...removedReviewIds],
    purgedSourceIds: [...purgedSourceIds],
    remoteSeen: {
      triage: [...remoteSeen.triage.entries()],
      reviews: [...remoteSeen.reviews.entries()],
      planned: [...remoteSeen.planned],
      deleted: [...remoteSeen.deleted],
    },
  };
}

function restoreRemoteSeen(parsed) {
  const seen = parsed?.remoteSeen;
  const pairs = (list) =>
    new Map(
      (Array.isArray(list) ? list : [])
        .filter((entry) => Array.isArray(entry) && entry[0])
        .map(([id, stamp]) => [String(id), String(stamp || '')]),
    );
  const ids = (list) => new Set((Array.isArray(list) ? list : []).map((id) => String(id || '')).filter(Boolean));
  remoteSeen = {
    triage: pairs(seen?.triage),
    reviews: pairs(seen?.reviews),
    planned: ids(seen?.planned),
    deleted: ids(seen?.deleted),
  };
}

/** Write the rows that changed since the last write, plus the small meta record. */
async function persistDiff() {
  const triagePut = [];
  const triageDelete = [];
  const nextTriage = new Map();
  for (const row of state.triage || []) {
    const id = String(row?.id || '');
    if (!id) continue;
    nextTriage.set(id, row);
    if (persistedTriage.get(id) !== row) triagePut.push(row);
  }
  for (const id of persistedTriage.keys()) {
    if (!nextTriage.has(id)) triageDelete.push(id);
  }
  const reviewPut = [];
  const reviewDelete = [];
  const nextReviews = new Map();
  for (const row of state.reviews || []) {
    const id = String(row?.id || '');
    if (!id) continue;
    nextReviews.set(id, row);
    if (persistedReviews.get(id) !== row) reviewPut.push(row);
  }
  for (const id of persistedReviews.keys()) {
    if (!nextReviews.has(id)) reviewDelete.push(id);
  }
  await writeTriageCache({ triagePut, triageDelete, reviewPut, reviewDelete, meta: cacheMeta() });
  persistedTriage = nextTriage;
  persistedReviews = nextReviews;
  if (legacyCachePending) {
    legacyCachePending = false;
    dropLegacyTriageCache().catch(() => {});
  }
}

function persistLocalNow() {
  persistChain = persistChain.then(persistDiff).catch(() => {});
  return persistChain;
}

function schedulePersist() {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    persistLocalNow().catch(() => {});
  }, LOCAL_PERSIST_MS);
  if (remoteTimer) clearTimeout(remoteTimer);
  remoteTimer = setTimeout(() => {
    remoteTimer = null;
    pushTriageRemote().catch(() => {});
  }, REMOTE_PUSH_MS);
}

function commit(next) {
  const resolved = {
    nextNumber: next?.nextNumber ?? state.nextNumber,
    planned: next?.planned ?? state.planned,
    deleted: next?.deleted ?? state.deleted,
    reviews: next?.reviews ?? state.reviews,
  };
  resolved.triage = applyReviewsToTriage(
    withoutDeletedDocs(resolved.triage ?? next?.triage ?? state.triage, resolved.deleted),
    resolved.reviews,
  );
  syncTriageTombstones(state.triage, resolved.triage);
  syncPlannedTombstones(state.planned, resolved.planned);
  markDirtyRows(state.triage, resolved.triage, dirtyTriageIds);
  markDirtyRows(state.planned, resolved.planned, dirtyPlannedIds);
  markDirtyRows(state.deleted, resolved.deleted, dirtyDeletedIds);
  markDirtyRows(state.reviews, resolved.reviews, dirtyReviewIds);
  if (resolved.nextNumber !== state.nextNumber) metaDirty = true;
  state = resolved;
  localDirty = true;
  emit();
  schedulePersist();
}

function roundQty(value) {
  const n = Math.round((Number(value) || 0) * 1000) / 1000;
  return Object.is(n, -0) ? 0 : n;
}

function sanitizeItems(items) {
  if (!Array.isArray(items)) return [];
  return items.map((item) => ({
    id: String(item?.id || newId('item')),
    productId: item?.productId != null ? String(item.productId) : '',
    productName: String(item?.productName || ''),
    sku: String(item?.sku || ''),
    priority: item?.priority || null,
    fromId: item?.fromId || '',
    fromName: String(item?.fromName || ''),
    toId: item?.toId || '',
    toName: String(item?.toName || ''),
    sentQty: roundQty(Math.max(0, Number(item?.sentQty) || 0)),
    receivedQty:
      item?.receivedQty === '' || item?.receivedQty == null
        ? null
        : roundQty(Math.max(0, Number(item.receivedQty) || 0)),
    received: Boolean(item?.received),
    fromHave: roundQty(Math.max(0, Number(item?.fromHave) || 0)),
    toHave: roundQty(Math.max(0, Number(item?.toHave) || 0)),
    aureusId: item?.aureusId != null ? String(item.aureusId) : null,
  }));
}

export function receiveStatusOf(items) {
  const list = Array.isArray(items) ? items : [];
  if (list.length === 0) return RECEIVE_STATUS.not_received;
  const fully = list.filter(
    (item) => item.received || (Number(item.receivedQty) || 0) >= (Number(item.sentQty) || 0),
  );
  const any = list.some((item) => item.received || (Number(item.receivedQty) || 0) > 0);
  if (!any) return RECEIVE_STATUS.not_received;
  if (fully.length >= list.length) return RECEIVE_STATUS.all_received;
  return RECEIVE_STATUS.partially_received;
}

function sanitizePlanned(row) {
  if (!row || typeof row !== 'object') return null;
  const items = sanitizeItems(row.items);
  return {
    id: String(row.id || newId('ptr')),
    number: Math.max(1, Math.round(Number(row.number) || 1)),
    reference: String(row.reference || `TR# ${row.number || ''}`),
    dateKey: String(row.dateKey || ''),
    dateLabel: String(row.dateLabel || ''),
    note: String(row.note || ''),
    forTriage: Boolean(row.forTriage),
    fromStoreKey: row.fromStoreKey || null,
    fromName: String(row.fromName || ''),
    toName: String(row.toName || ''),
    pathLabels: Array.isArray(row.pathLabels) ? row.pathLabels.map(String) : [],
    items,
    receiveStatus: receiveStatusOf(items),
    createdAt: Number(row.createdAt) || Date.now(),
    aureusId: row.aureusId != null ? String(row.aureusId) : null,
    transferCode: String(row.transferCode || ''),
    aureusTransfers: Array.isArray(row.aureusTransfers) ? row.aureusTransfers : [],
  };
}

export function mapTriageStore(store) {
  return {
    id: newId('store'),
    storeKey: store.id || store.storeKey,
    name: store.name,
    systemKey: store.systemKey,
    systemLabel: store.systemLabel,
    sourceId: store.sourceId,
    city: store.city || '',
    meltPos: Array.isArray(store.meltPos) ? store.meltPos : [],
  };
}

function sanitizeCensus(value) {
  if (!value || typeof value !== 'object') return null;
  const ids = Array.isArray(value.ids) ? value.ids.map((id) => String(id || '')).filter(Boolean) : [];
  return {
    total: Math.max(0, Math.round(Number(value.total) || ids.length || 0)),
    expected: Math.max(0, Math.round(Number(value.expected) || 0)),
    bullionOnly: Math.max(0, Math.round(Number(value.bullionOnly) || 0)),
    mixed: Math.max(0, Math.round(Number(value.mixed) || 0)),
    ids: ids.slice(0, 8000),
  };
}

function sanitizeTriage(row) {
  if (!row || typeof row !== 'object') return null;
  const location = row.triageLocation && typeof row.triageLocation === 'object' ? row.triageLocation : null;
  const kind = row.kind === 'po' ? 'po' : 'batch';
  return {
    id: String(row.id || newId(kind === 'po' ? 'qpo' : 'xfer')),
    kind,
    addedAt: String(row.addedAt || addedAtFromTriageId(row.id) || ''),
    dateKey: dateKeyOf(row),
    dateLabel: String(row.dateLabel || ''),
    census: sanitizeCensus(row.census),
    triageLocation: location
      ? {
          storeKey: location.storeKey || location.id || '',
          name: String(location.name || ''),
          systemKey: location.systemKey,
          systemLabel: location.systemLabel,
          city: String(location.city || ''),
        }
      : null,
    stores: Array.isArray(row.stores)
      ? row.stores.map((store) => ({
          id: String(store?.id || newId('store')),
          storeKey: store?.storeKey || store?.id,
          name: String(store?.name || ''),
          systemKey: store?.systemKey,
          systemLabel: store?.systemLabel,
          sourceId: store?.sourceId,
          city: String(store?.city || ''),
          meltPos: Array.isArray(store?.meltPos) ? store.meltPos.map((item) => stampTriagePurchase(item)) : [],
        }))
      : [],
  };
}

export function warmTriageWorkflow() {
  hydrateTransferWorkflow().catch(() => {});
}

export async function hydrateTransferWorkflow() {
  if (hydrated && remoteLoaded) return snapshot();
  if (hydratePromise) return hydratePromise;
  hydratePromise = (async () => {
    if (!hydrated) {
      try {
        let parsed = null;
        const cached = await readTriageCache();
        if (cached) {
          parsed = { ...(cached.meta || {}), triage: cached.triage, reviews: cached.reviews };
        } else {
          parsed = await readLegacyTriageCache();
          legacyCachePending = Boolean(parsed);
        }
        if (parsed) {
          restoreRemoteSeen(parsed);
          const planned = Array.isArray(parsed?.planned)
            ? parsed.planned.map(sanitizePlanned).filter(Boolean)
            : [];
          const triage = Array.isArray(parsed?.triage)
            ? parsed.triage.map(sanitizeTriage).filter(Boolean)
            : [];
          removedTriageDates = new Set(
            (parsed?.removedTriageDates || []).map((key) => String(key || '').slice(0, 10)).filter(Boolean),
          );
          removedTriageIds = new Set(
            (parsed?.removedTriageIds || []).map((id) => String(id || '')).filter(Boolean),
          );
          removedPlannedIds = new Set(
            (parsed?.removedPlannedIds || []).map((id) => String(id || '')).filter(Boolean),
          );
          removedDeletedIds = new Set(
            (parsed?.removedDeletedIds || []).map((id) => String(id || '')).filter(Boolean),
          );
          purgedSourceIds = new Set(
            (parsed?.purgedSourceIds || []).map((id) => String(id || '')).filter(Boolean),
          );
          removedReviewIds = new Set(
            (parsed?.removedReviewIds || []).map((id) => String(id || '')).filter(Boolean),
          );
          const deleted = Array.isArray(parsed?.deleted)
            ? parsed.deleted.map(sanitizeDeleted).filter(Boolean)
            : [];
          const cachedReviews = Array.isArray(parsed?.reviews)
            ? parsed.reviews.map(sanitizeReviewRow).filter(Boolean)
            : [];
          const reviews = cachedReviews.length ? cachedReviews : reviewsFromTriage(triage);
          const maxNumber = planned.reduce((max, row) => Math.max(max, row.number || 0), 0);
          const archived = deletedSourceIds(deleted);
          state = {
            nextNumber: Math.max(Number(parsed?.nextNumber) || 1, maxNumber + 1),
            planned,
            deleted,
            reviews,
            triage: applyReviewsToTriage(
              withoutDeletedDocs(
                triage.filter((row) => {
                  const id = String(row?.id || '');
                  return !archived.has(id) && !purgedSourceIds.has(id);
                }),
                deleted,
              ),
              reviews,
            ),
          };
          if (!legacyCachePending) {
            // The per-row cache already holds these; only later changes need writing.
            persistedTriage = new Map(state.triage.map((row) => [String(row.id), row]));
            persistedReviews = new Map(state.reviews.map((row) => [String(row.id), row]));
          }
        }
      } catch {
        // Keep empty in-memory state if the cache is unreadable.
      }
      hydrated = true;
      resolveLocalReady();
      emit();
    } else {
      resolveLocalReady();
    }
    await pullTriageRemote();
    bindTriageRemote();
    return snapshot();
  })().finally(() => {
    hydratePromise = null;
  });
  return hydratePromise;
}

const TRIAGE_BATCH_COLUMNS = 'id, date_key, date_label, kind, census, triage_location, stores, updated_at';
const TRIAGE_BATCH_COLUMNS_LEGACY = 'id, date_key, date_label, triage_location, stores, updated_at';

let batchColumnsLegacy = false;

/**
 * `id, updated_at` for every row, paged past PostgREST's row cap. Small even
 * for thousands of rows; it decides which full rows actually need fetching.
 */
async function fetchRemoteIndex(supabase, table) {
  const out = [];
  for (let from = 0; ; from += REMOTE_INDEX_PAGE) {
    const { data, error } = await supabase
      .from(table)
      .select('id, updated_at')
      .order('id', { ascending: true })
      .range(from, from + REMOTE_INDEX_PAGE - 1);
    if (error) throw error;
    const rows = data || [];
    for (const row of rows) {
      if (row?.id) out.push({ id: String(row.id), updatedAt: String(row.updated_at || '') });
    }
    if (rows.length < REMOTE_INDEX_PAGE) break;
  }
  return out;
}

function changedRemoteIds(index, seen) {
  const ids = [];
  for (const row of index) {
    if (seen.get(row.id) !== row.updatedAt) ids.push(row.id);
  }
  return ids;
}

async function fetchRowsByIds(supabase, table, columns, ids) {
  const rows = [];
  const chunks = [];
  for (let i = 0; i < ids.length; i += REMOTE_FETCH_CHUNK) {
    chunks.push(ids.slice(i, i + REMOTE_FETCH_CHUNK));
  }
  let cursor = 0;
  const worker = async () => {
    while (cursor < chunks.length) {
      const chunk = chunks[cursor];
      cursor += 1;
      const { data, error } = await supabase.from(table).select(columns).in('id', chunk);
      if (error) throw error;
      for (const row of data || []) rows.push(row);
    }
  };
  await Promise.all(Array.from({ length: Math.min(REMOTE_FETCH_PARALLEL, chunks.length) }, worker));
  return rows;
}

async function fetchBatchRows(supabase, ids) {
  if (!ids.length) return [];
  const columns = batchColumnsLegacy ? TRIAGE_BATCH_COLUMNS_LEGACY : TRIAGE_BATCH_COLUMNS;
  try {
    return await fetchRowsByIds(supabase, 'triage_batches', columns, ids);
  } catch (error) {
    if (!batchColumnsLegacy && /kind|census/i.test(String(error?.message || ''))) {
      batchColumnsLegacy = true;
      return fetchRowsByIds(supabase, 'triage_batches', TRIAGE_BATCH_COLUMNS_LEGACY, ids);
    }
    throw error;
  }
}

/** Drop rows the server used to have and no longer does, unless they are waiting to be pushed. */
function dropVanishedRows(list, remoteIds, seen, dirty) {
  const out = [];
  let changed = false;
  for (const row of list || []) {
    const id = String(row?.id || '');
    if (id && !remoteIds.has(id) && seen.has(id) && !dirty.has(id)) {
      changed = true;
      continue;
    }
    out.push(row);
  }
  return changed ? out : list;
}

function sameList(a, b) {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

function mapRemoteSideTables(planned, deleted, reviews, meta, allocations) {
  return {
    planned: (planned.data || [])
      .map((row) => sanitizePlanned(row?.payload || row))
      .filter(Boolean),
    deleted: deleted.error
      ? null
      : (deleted.data || []).map((row) => sanitizeDeleted(row?.payload || row)).filter(Boolean),
    reviews: reviews.error
      ? null
      : (reviews.data || [])
          .map((row) =>
            sanitizeReviewRow({
              id: row?.id,
              ...(row?.payload && typeof row.payload === 'object' ? row.payload : {}),
              updatedAt: row?.updated_at,
            }),
          )
          .filter(Boolean),
    allocations: allocations?.error
      ? null
      : (allocations?.data || [])
          .map((row) =>
            sanitizeAllocationRow({
              id: row?.id,
              ...(row?.payload && typeof row.payload === 'object' ? row.payload : {}),
              updatedAt: row?.updated_at,
            }),
          )
          .filter(Boolean),
    nextNumber: Math.max(1, Math.round(Number(meta.data?.next_number) || 1)),
  };
}

/**
 * Fold one pull into local state. `remote.triage` / `remote.reviews` hold only
 * the rows whose `updated_at` moved since the last pull; `remote.triageIds` /
 * `remote.reviewIds` are the complete id sets so rows the server dropped can
 * be dropped here too. Unchanged rows keep their identity so the UI only
 * recomputes what actually changed.
 */
function applyRemoteTriage(remote, preferLocal) {
  const plannedIds = new Set(remote.planned.map((row) => String(row?.id || '')));
  const planned = dropVanishedRows(
    mergeByKey(state.planned, remote.planned, (row) => String(row?.id || ''), preferLocal, removedPlannedIds),
    plannedIds,
    remoteSeen.planned,
    dirtyPlannedIds,
  ).sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0));

  let deleted = mergeByKey(
    state.deleted,
    remote.deleted || [],
    (row) => String(row?.id || ''),
    preferLocal,
    removedDeletedIds,
  );
  if (remote.deleted) {
    const deletedIds = new Set(remote.deleted.map((row) => String(row?.id || '')));
    deleted = dropVanishedRows(deleted, deletedIds, remoteSeen.deleted, dirtyDeletedIds);
  }
  deleted = deleted
    .filter((row) => !purgedSourceIds.has(String(row?.sourceId || '')) && !purgedSourceIds.has(String(row?.id || '')))
    .sort((a, b) => String(b.deletedAt || '').localeCompare(String(a.deletedAt || '')));

  let reviews = mergeReviews(
    mergeReviews(state.reviews, reviewsFromTriage(state.triage), true),
    remote.reviews || [],
    preferLocal || localDirty || remote.reviews == null,
  );
  if (remote.reviewIds) {
    reviews = dropVanishedRows(reviews, remote.reviewIds, remoteSeen.reviews, dirtyReviewIds);
  }

  const blocked = new Set([...removedTriageIds, ...purgedSourceIds, ...deletedSourceIds(deleted)]);
  const blockedItems = deletedDocIds(deleted);
  const kept = dropVanishedRows(state.triage, remote.triageIds, remoteSeen.triage, dirtyTriageIds);
  const merged = mergeTriageLists(kept, remote.triage, preferLocal, blocked, blockedItems).sort((a, b) => {
    const aPo = isStandaloneTriage(a) ? 1 : 0;
    const bPo = isStandaloneTriage(b) ? 1 : 0;
    if (aPo !== bPo) return aPo - bPo;
    return String(b.dateKey || '').localeCompare(String(a.dateKey || ''));
  });
  const triage = applyAllocationsToTriage(
    applyReviewsToTriage(withoutDeletedDocs(merged, deleted), reviews),
    remote.allocations || allocationsFromTriage(state.triage),
  );

  // Remember what the server holds now.
  for (const id of [...remoteSeen.triage.keys()]) if (!remote.triageIds.has(id)) remoteSeen.triage.delete(id);
  for (const row of remote.triageStamps) remoteSeen.triage.set(row.id, row.updatedAt);
  if (remote.reviewIds) {
    for (const id of [...remoteSeen.reviews.keys()]) if (!remote.reviewIds.has(id)) remoteSeen.reviews.delete(id);
    for (const row of remote.reviewStamps) remoteSeen.reviews.set(row.id, row.updatedAt);
  }
  remoteSeen.planned = plannedIds;
  if (remote.deleted) remoteSeen.deleted = new Set(remote.deleted.map((row) => String(row?.id || '')));

  const maxNumber = planned.reduce((max, row) => Math.max(max, row.number || 0), 0);
  const next = {
    nextNumber: Math.max(state.nextNumber, remote.nextNumber, maxNumber + 1),
    planned: sameList(planned, state.planned) ? state.planned : planned,
    deleted: sameList(deleted, state.deleted) ? state.deleted : deleted,
    reviews: sameList(reviews, state.reviews) ? state.reviews : reviews,
    triage: sameList(triage, state.triage) ? state.triage : triage,
  };
  const unchanged =
    next.nextNumber === state.nextNumber &&
    next.planned === state.planned &&
    next.deleted === state.deleted &&
    next.reviews === state.reviews &&
    next.triage === state.triage;
  if (!unchanged) state = next;
}

/** Rows that only exist here (or are newer here) still need to reach the server. */
function markLocalOnlyRowsDirty(remote) {
  for (const row of state.triage || []) {
    const id = String(row?.id || '');
    if (id && !remote.triageIds.has(id) && !removedTriageIds.has(id)) dirtyTriageIds.add(id);
  }
  const plannedIds = new Set(remote.planned.map((row) => String(row?.id || '')));
  for (const row of state.planned || []) {
    const id = String(row?.id || '');
    if (id && !plannedIds.has(id)) dirtyPlannedIds.add(id);
  }
  if (remote.deleted) {
    const deletedIds = new Set(remote.deleted.map((row) => String(row?.id || '')));
    for (const row of state.deleted || []) {
      const id = String(row?.id || '');
      if (id && !deletedIds.has(id)) dirtyDeletedIds.add(id);
    }
  }
  if (remote.reviewIds) {
    const remoteById = new Map((remote.reviews || []).map((row) => [String(row.id), row]));
    for (const row of state.reviews || []) {
      const id = String(row?.id || '');
      if (!id) continue;
      if (!remote.reviewIds.has(id)) {
        dirtyReviewIds.add(id);
        continue;
      }
      const fetched = remoteById.get(id);
      if (fetched && reviewUpdatedAt(row) > reviewUpdatedAt(fetched)) dirtyReviewIds.add(id);
    }
  }
  const hasTombstones =
    removedTriageIds.size > 0 ||
    removedTriageDates.size > 0 ||
    removedPlannedIds.size > 0 ||
    removedDeletedIds.size > 0 ||
    removedReviewIds.size > 0;
  return (
    dirtyTriageIds.size > 0 ||
    dirtyPlannedIds.size > 0 ||
    dirtyDeletedIds.size > 0 ||
    dirtyReviewIds.size > 0 ||
    metaDirty ||
    // Archived ids stay tombstoned for good; only retry them when an earlier
    // push did not finish.
    (localDirty && hasTombstones)
  );
}

async function fetchTriageSideTables(supabase) {
  const [planned, meta, deleted, allocations] = await Promise.all([
    supabase.from('triage_planned').select('id, payload, updated_at'),
    supabase.from('triage_meta').select('next_number').eq('id', 'default').maybeSingle(),
    supabase.from('triage_deleted').select('id, payload, updated_at'),
    supabase.from('triage_allocations').select('id, payload, updated_at'),
  ]);
  if (planned.error) throw planned.error;
  if (meta.error) throw meta.error;
  if (deleted.error && !isMissingTriageRelation(deleted.error)) throw deleted.error;
  if (allocations.error && !isMissingTriageRelation(allocations.error)) throw allocations.error;
  return mapRemoteSideTables(planned, deleted, { error: null, data: [] }, meta, allocations);
}

async function fetchRemoteDelta(supabase) {
  const [batchIndex, reviewIndex, side] = await Promise.all([
    fetchRemoteIndex(supabase, 'triage_batches'),
    fetchRemoteIndex(supabase, 'triage_reviews').catch((error) => {
      if (isMissingTriageRelation(error)) return null;
      throw error;
    }),
    fetchTriageSideTables(supabase),
  ]);
  const batchIds = changedRemoteIds(batchIndex, remoteSeen.triage);
  const reviewIds = reviewIndex ? changedRemoteIds(reviewIndex, remoteSeen.reviews) : [];
  const [batchRows, reviewRows] = await Promise.all([
    fetchBatchRows(supabase, batchIds),
    reviewIndex ? fetchRowsByIds(supabase, 'triage_reviews', 'id, payload, updated_at', reviewIds) : [],
  ]);
  const triageStamps = [];
  const triage = [];
  for (const row of batchRows) {
    const mapped = batchFromRemote(row);
    if (!mapped) continue;
    triage.push(mapped);
    triageStamps.push({ id: String(row.id), updatedAt: String(row.updated_at || '') });
  }
  const reviewStamps = [];
  const reviews = reviewIndex ? [] : null;
  for (const row of reviewRows) {
    const mapped = sanitizeReviewRow({
      id: row?.id,
      ...(row?.payload && typeof row.payload === 'object' ? row.payload : {}),
      updatedAt: row?.updated_at,
    });
    if (!mapped) continue;
    reviews.push(mapped);
    reviewStamps.push({ id: String(row.id), updatedAt: String(row.updated_at || '') });
  }
  return {
    ...side,
    triage,
    triageStamps,
    triageIds: new Set(batchIndex.map((row) => row.id)),
    reviews,
    reviewStamps,
    reviewIds: reviewIndex ? new Set(reviewIndex.map((row) => row.id)) : null,
  };
}

async function pullTriageRemote() {
  if (pullPromise) return pullPromise;
  pullPromise = (async () => {
    if (!hydrated) await localReady;
    const supabase = await triageClient();
    if (!supabase) {
      remoteLoaded = true;
      emit();
      return snapshot();
    }
    try {
      const preferLocal = localDirty;
      const remote = await fetchRemoteDelta(supabase);
      applyRemoteTriage(remote, preferLocal);
      persistLocalNow().catch(() => {});
      if (markLocalOnlyRowsDirty(remote)) {
        pushTriageRemote().catch(() => {});
      }
    } catch (error) {
      if (isMissingTriageRelation(error)) remoteLoaded = true;
    }
    remoteLoaded = true;
    emit();
    return snapshot();
  })().finally(() => {
    pullPromise = null;
  });
  return pullPromise;
}

async function pushTriageRemote() {
  const supabase = await triageClient();
  if (!supabase) return;
  if (pushingRemote) {
    pushQueued = true;
    return;
  }
  const full = fullPushPending;
  const hasTombstones =
    removedTriageIds.size > 0 ||
    removedTriageDates.size > 0 ||
    removedPlannedIds.size > 0 ||
    removedDeletedIds.size > 0 ||
    removedReviewIds.size > 0;
  if (
    !full &&
    !hasTombstones &&
    !metaDirty &&
    dirtyTriageIds.size === 0 &&
    dirtyPlannedIds.size === 0 &&
    dirtyDeletedIds.size === 0 &&
    dirtyReviewIds.size === 0
  ) {
    localDirty = false;
    return;
  }
  pushingRemote = true;
  // Snapshot what this push covers so edits made while it is in flight stay dirty.
  const triageIds = new Set(dirtyTriageIds);
  const plannedIds = new Set(dirtyPlannedIds);
  const deletedIds = new Set(dirtyDeletedIds);
  const reviewIds = new Set(dirtyReviewIds);
  const pushMeta = metaDirty || full;
  dirtyTriageIds = new Set();
  dirtyPlannedIds = new Set();
  dirtyDeletedIds = new Set();
  dirtyReviewIds = new Set();
  metaDirty = false;
  fullPushPending = false;
  try {
    const { data: authData } = await supabase.auth.getSession();
    const actorId = authData?.session?.user?.id || null;
    const now = new Date().toISOString();

    const batchRows = (state.triage || [])
      .filter((row) => full || triageIds.has(String(row?.id || '')))
      .map(sanitizeTriage)
      .filter((row) => row?.id && !removedTriageIds.has(String(row.id)))
      .map((row) => ({
        id: row.id,
        kind: row.kind || 'batch',
        date_key: dateKeyOf(row) || row.id,
        date_label: row.dateLabel || '',
        census: row.census,
        triage_location: row.triageLocation,
        stores: row.stores || [],
        updated_at: now,
        updated_by: actorId,
      }));
    if (batchRows.length) {
      let { data: savedBatches, error } = await supabase
        .from('triage_batches')
        .upsert(batchRows, { onConflict: 'id' })
        .select('id, updated_at');
      if (!error) rememberPushedStamps(remoteSeen.triage, savedBatches);
      if (error && /kind|census/i.test(String(error.message || ''))) {
        const slim = batchRows
          .filter((row) => row.kind !== 'po')
          .map((row) => {
            const next = { ...row };
            delete next.kind;
            delete next.census;
            return next;
          });
        if (slim.length) {
          ({ error } = await supabase.from('triage_batches').upsert(slim, { onConflict: 'id' }));
        } else {
          error = null;
        }
      }
      if (error && /no unique|on conflict/i.test(String(error.message || ''))) {
        const byDate = batchRows
          .filter((row) => row.kind !== 'po')
          .map((row) => {
            const next = { ...row };
            delete next.kind;
            delete next.census;
            return next;
          });
        if (byDate.length) {
          ({ error } = await supabase.from('triage_batches').upsert(byDate, { onConflict: 'date_key' }));
        }
      }
      if (error) throw error;
    }

    if (full || removedTriageIds.size || removedTriageDates.size) {
      const localIds = new Set((state.triage || []).map((row) => String(row?.id || '')).filter(Boolean));
      const extraIds = [...removedTriageIds];
      if (full) {
        const { data: remoteBatches, error: listError } = await supabase.from('triage_batches').select('id');
        if (listError) throw listError;
        for (const row of remoteBatches || []) {
          if (row.id && !localIds.has(String(row.id))) extraIds.push(row.id);
        }
      }
      const uniqueExtraIds = [...new Set(extraIds)].filter((id) => !localIds.has(String(id)));
      if (uniqueExtraIds.length) {
        const { error } = await supabase.from('triage_batches').delete().in('id', uniqueExtraIds);
        if (error) throw error;
        const archived = deletedSourceIds();
        uniqueExtraIds.forEach((id) => {
          if (!archived.has(String(id)) && !purgedSourceIds.has(String(id))) removedTriageIds.delete(id);
        });
      }
      if (removedTriageDates.size) {
        const localDates = new Set(
          (state.triage || []).filter((row) => !isStandaloneTriage(row)).map(dateKeyOf).filter(Boolean),
        );
        const extraDates = [...removedTriageDates].filter((key) => !localDates.has(key));
        if (extraDates.length) {
          const { error } = await supabase.from('triage_batches').delete().in('date_key', extraDates);
          if (error) throw error;
        }
        extraDates.forEach((key) => removedTriageDates.delete(key));
      }
    }

    const plannedRows = (state.planned || [])
      .filter((row) => full || plannedIds.has(String(row?.id || '')))
      .map(sanitizePlanned)
      .filter((row) => row && !removedPlannedIds.has(String(row.id || '')))
      .map((row) => ({
        id: row.id,
        payload: row,
        updated_at: now,
        updated_by: actorId,
      }));
    if (plannedRows.length) {
      const { error } = await supabase.from('triage_planned').upsert(plannedRows, { onConflict: 'id' });
      if (error) throw error;
      for (const row of plannedRows) remoteSeen.planned.add(String(row.id));
    }

    if (full || removedPlannedIds.size) {
      const localIds = new Set((state.planned || []).map((row) => String(row?.id || '')).filter(Boolean));
      const extraPlanned = [...removedPlannedIds];
      if (full) {
        const { data: remotePlanned, error: plannedListError } = await supabase.from('triage_planned').select('id');
        if (plannedListError) throw plannedListError;
        for (const row of remotePlanned || []) {
          if (row.id && !localIds.has(String(row.id))) extraPlanned.push(row.id);
        }
      }
      const uniquePlanned = [...new Set(extraPlanned)].filter((id) => !localIds.has(String(id)));
      if (uniquePlanned.length) {
        const { error } = await supabase.from('triage_planned').delete().in('id', uniquePlanned);
        if (error) throw error;
        uniquePlanned.forEach((id) => removedPlannedIds.delete(id));
      }
    }

    const deletedRows = (state.deleted || [])
      .filter((row) => full || deletedIds.has(String(row?.id || '')))
      .map(sanitizeDeleted)
      .filter((row) => row?.id && !removedDeletedIds.has(String(row.id)))
      .map((row) => ({
        id: row.id,
        kind: row.kind,
        payload: row,
        deleted_at: row.deletedAt,
        updated_at: now,
        updated_by: actorId,
      }));
    if (deletedRows.length) {
      const { error } = await supabase.from('triage_deleted').upsert(deletedRows, { onConflict: 'id' });
      if (error && !isMissingTriageRelation(error)) throw error;
      if (!error) for (const row of deletedRows) remoteSeen.deleted.add(String(row.id));
    }

    if (full || removedDeletedIds.size) {
      const localDeleted = new Set((state.deleted || []).map((row) => String(row?.id || '')).filter(Boolean));
      const extraDeleted = [...removedDeletedIds];
      if (full) {
        const { data: remoteDeleted, error: deletedListError } = await supabase.from('triage_deleted').select('id');
        if (deletedListError) {
          if (!isMissingTriageRelation(deletedListError)) throw deletedListError;
        } else {
          for (const row of remoteDeleted || []) {
            if (row.id && !localDeleted.has(String(row.id))) extraDeleted.push(row.id);
          }
        }
      }
      const uniqueDeleted = [...new Set(extraDeleted)].filter((id) => !localDeleted.has(String(id)));
      if (uniqueDeleted.length) {
        const { error } = await supabase.from('triage_deleted').delete().in('id', uniqueDeleted);
        if (error && !isMissingTriageRelation(error)) throw error;
        uniqueDeleted.forEach((id) => removedDeletedIds.delete(id));
      }
    }

    const reviewRows = (state.reviews || [])
      .filter((row) => full || reviewIds.has(String(row?.id || '')))
      .map(sanitizeReviewRow)
      .filter((row) => row?.id && !removedReviewIds.has(String(row.id)))
      .map((row) => ({
        id: row.id,
        payload: row,
        updated_at: now,
        updated_by: actorId,
      }));
    if (reviewRows.length) {
      const { data: savedReviews, error } = await supabase
        .from('triage_reviews')
        .upsert(reviewRows, { onConflict: 'id' })
        .select('id, updated_at');
      if (error && !isMissingTriageRelation(error)) throw error;
      if (!error) rememberPushedStamps(remoteSeen.reviews, savedReviews);
    }

    if (full || removedReviewIds.size) {
      const localReviews = new Set((state.reviews || []).map((row) => String(row?.id || '')).filter(Boolean));
      const extraReviews = [...removedReviewIds];
      if (full) {
        const { data: remoteReviews, error: reviewListError } = await supabase.from('triage_reviews').select('id');
        if (reviewListError) {
          if (!isMissingTriageRelation(reviewListError)) throw reviewListError;
        } else {
          for (const row of remoteReviews || []) {
            if (row.id && !localReviews.has(String(row.id))) extraReviews.push(row.id);
          }
        }
      }
      const uniqueReviews = [...new Set(extraReviews)].filter((id) => !localReviews.has(String(id)));
      if (uniqueReviews.length) {
        const { error } = await supabase.from('triage_reviews').delete().in('id', uniqueReviews);
        if (error && !isMissingTriageRelation(error)) throw error;
        uniqueReviews.forEach((id) => removedReviewIds.delete(id));
      }
    }

    // Allocations live on the PO, so only batches in this push can carry new ones.
    const allocationRows = allocationsFromTriage(
      (state.triage || []).filter((row) => full || triageIds.has(String(row?.id || ''))),
    )
      .filter((row) => row?.id && !removedReviewIds.has(String(row.id)))
      .map((row) => ({
        id: row.id,
        payload: row,
        updated_at: now,
        updated_by: actorId,
      }));
    if (allocationRows.length) {
      const { error } = await supabase.from('triage_allocations').upsert(allocationRows, { onConflict: 'id' });
      if (error && !isMissingTriageRelation(error)) throw error;
    }

    if (pushMeta) {
      const { error: metaError } = await supabase.from('triage_meta').upsert(
        {
          id: 'default',
          next_number: state.nextNumber,
          updated_at: now,
          updated_by: actorId,
        },
        { onConflict: 'id' },
      );
      if (metaError) throw metaError;
    }
    localDirty =
      dirtyTriageIds.size > 0 ||
      dirtyPlannedIds.size > 0 ||
      dirtyDeletedIds.size > 0 ||
      dirtyReviewIds.size > 0 ||
      metaDirty;
    lastPushDoneAt = Date.now();
    if (removedTriageDates.size === 0 && removedPlannedIds.size === 0) {
      // Tombstones were flushed; refresh the cached copy off the click path.
      schedulePersistLocalOnly();
    }
  } catch (error) {
    // Put the rows back so the next save retries them.
    triageIds.forEach((id) => dirtyTriageIds.add(id));
    plannedIds.forEach((id) => dirtyPlannedIds.add(id));
    deletedIds.forEach((id) => dirtyDeletedIds.add(id));
    reviewIds.forEach((id) => dirtyReviewIds.add(id));
    if (pushMeta) metaDirty = true;
    if (full) fullPushPending = true;
    if (isMissingTriageRelation(error)) {
      dirtyTriageIds = new Set();
      dirtyPlannedIds = new Set();
      metaDirty = false;
      fullPushPending = false;
      localDirty = false;
    }
  } finally {
    pushingRemote = false;
    if (pushQueued) {
      pushQueued = false;
      pushTriageRemote().catch(() => {});
    }
  }
}

/** Stamps the server assigned to rows we just wrote, so the next pull skips them. */
function rememberPushedStamps(target, rows) {
  for (const row of Array.isArray(rows) ? rows : []) {
    if (row?.id) target.set(String(row.id), String(row.updated_at || ''));
  }
}

function schedulePersistLocalOnly() {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    persistLocalNow().catch(() => {});
  }, LOCAL_PERSIST_MS);
}

function shouldIgnoreRealtime() {
  if (pushingRemote || localDirty) return true;
  // Our own writes echo back through realtime; skip the refetch storm.
  return Date.now() - lastPushDoneAt < REALTIME_ECHO_MS;
}

function bindTriageRemote() {
  if (authBound) return;
  authBound = true;
  try {
    const supabase = getSupabase();
    supabase.auth.onAuthStateChange((event, session) => {
      if (session?.user?.id) {
        pullTriageRemote().catch(() => {});
        bindTriageRealtime(supabase);
      } else if (realtimeChannel) {
        supabase.removeChannel(realtimeChannel);
        realtimeChannel = null;
      }
    });
  } catch {
    authBound = false;
  }
}

/** One save by someone else fans out as several row events; fold them into one pull. */
function scheduleRealtimePull() {
  if (shouldIgnoreRealtime()) return;
  if (realtimePullTimer) clearTimeout(realtimePullTimer);
  realtimePullTimer = setTimeout(() => {
    realtimePullTimer = null;
    if (!shouldIgnoreRealtime()) pullTriageRemote().catch(() => {});
  }, REALTIME_PULL_DEBOUNCE_MS);
}

function bindTriageRealtime(supabase) {
  if (realtimeChannel || !supabase) return;
  let channel = supabase.channel('triage-workflow');
  for (const table of ['triage_batches', 'triage_planned', 'triage_deleted', 'triage_reviews', 'triage_allocations']) {
    channel = channel.on('postgres_changes', { event: '*', schema: 'public', table }, scheduleRealtimePull);
  }
  realtimeChannel = channel.subscribe();
}

export function subscribeTransferWorkflow(listener) {
  listeners.add(listener);
  listener(snapshot());
  return () => listeners.delete(listener);
}

export function useTransferWorkflow() {
  const [snapshotState, setSnapshotState] = useState(snapshot);
  useEffect(() => {
    let cancelled = false;
    hydrateTransferWorkflow().then((next) => {
      if (!cancelled) setSnapshotState(next);
    });
    const unsubscribe = subscribeTransferWorkflow((next) => {
      if (!cancelled) setSnapshotState(next);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);
  return snapshotState;
}

export function itemsFromPlan(plan) {
  const items = [];
  for (const sheet of plan?.stopSheets || []) {
    for (const row of sheet.outs || []) {
      const sentQty = roundQty(Math.max(0, Number(row.qty) || 0));
      if (sentQty <= 0) continue;
      items.push({
        id: `${row.productId}|${sheet.storeId}|${row.partnerId}`,
        productId: String(row.productId),
        productName: row.productName,
        sku: row.sku || '',
        priority: row.priority,
        fromId: sheet.storeId,
        fromName: sheet.storeName,
        toId: row.partnerId,
        toName: row.partnerName,
        sentQty,
        receivedQty: null,
        received: false,
        fromHave: roundQty(Math.max(0, Number(row.currentQty) || 0)),
        toHave: roundQty(Math.max(0, Number(row.partnerQty) || 0)),
      });
    }
  }
  return items;
}

export function posTransferGroupsFromPlan(plan) {
  const storeById = new Map((plan?.stores || []).map((store) => [String(store.id), store]));
  const groups = new Map();

  for (const item of itemsFromPlan(plan)) {
    const from = storeById.get(String(item.fromId));
    const to = storeById.get(String(item.toId));
    const fromLocationId = Number(from?.sourceId);
    const toLocationId = Number(to?.sourceId);
    if (!Number.isFinite(fromLocationId) || !Number.isFinite(toLocationId)) {
      throw new Error(`Missing POS location for ${item.fromName} → ${item.toName}.`);
    }
    if (
      (from?.systemKey && from.systemKey !== 'east') ||
      (to?.systemKey && to.systemKey !== 'east')
    ) {
      throw new Error('POS transfers can only be created for Canada Gold East stores.');
    }
    const productId = Number(item.productId);
    if (!Number.isFinite(productId) || item.sentQty <= 0) continue;
    const key = `${fromLocationId}|${toLocationId}`;
    if (!groups.has(key)) {
      groups.set(key, {
        fromLocationId,
        toLocationId,
        fromName: from?.name || item.fromName,
        toName: to?.name || item.toName,
        items: [],
      });
    }
    const group = groups.get(key);
    const existing = group.items.find((entry) => entry.product_id === productId);
    if (existing) {
      existing.quantity += item.sentQty;
      existing.gross_quantity += item.sentQty;
    } else {
      group.items.push({
        product_id: productId,
        quantity: item.sentQty,
        gross_quantity: item.sentQty,
      });
    }
  }

  return Array.from(groups.values()).filter((group) => group.items.length > 0);
}

export function triageDatesForStore(storeKey) {
  if (!storeKey) return [];
  return state.triage
    .filter((row) => (row.stores || []).some((store) => store.storeKey === storeKey))
    .slice()
    .sort((a, b) => b.dateKey.localeCompare(a.dateKey));
}

function attachStoreToTriageDate(triage, { dateKey, dateLabel, store }) {
  const storeKey = store.id || store.storeKey;
  const existing = triage.find((row) => row.dateKey === dateKey);
  if (!existing) {
    return [
      {
        id: newId('xfer'),
        dateKey,
        dateLabel,
        stores: [mapTriageStore(store)],
      },
      ...triage,
    ].sort((a, b) => b.dateKey.localeCompare(a.dateKey));
  }
  if (
    (existing.stores || []).some(
      (entry) => entry.storeKey === storeKey || namesMatch(entry.name, store.name),
    )
  ) {
    return triage;
  }
  return triage.map((row) => {
    if (row.id !== existing.id) return row;
    return {
      ...row,
      stores: [...row.stores, mapTriageStore(store)].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
      ),
    };
  });
}

export function createPlannedTransfer({
  plan,
  note,
  forTriage,
  triageDateKey,
  triageDateLabel,
  fromStore,
  aureusTransfers = [],
}) {
  const items = itemsFromPlan(plan);
  if (items.length === 0) {
    throw new Error('Nothing to transfer. Adjust send quantities first.');
  }

  const useTriage = Boolean(forTriage);
  const dateKey = useTriage && triageDateKey ? triageDateKey : formatDateParam(new Date());
  const dateLabel =
    useTriage && triageDateLabel ? triageDateLabel : formatPickerDate(new Date());
  const posted = Array.isArray(aureusTransfers) ? aureusTransfers.filter(Boolean) : [];
  const primary = posted[0] || null;
  const transferCode = posted
    .map((row) => row.transferCode || (row.id ? `TF${row.id}` : ''))
    .filter(Boolean)
    .join(', ');
  const number = Number(primary?.id) || state.nextNumber;
  const stores = plan?.stores || [];
  const transfer = {
    id: newId('ptr'),
    number,
    reference: transferCode || `TR# ${number}`,
    dateKey,
    dateLabel,
    note: String(note || '').trim(),
    forTriage: useTriage,
    fromStoreKey: fromStore?.id || fromStore?.storeKey || null,
    fromName: fromStore?.name || stores[0]?.name || '',
    toName: stores[stores.length - 1]?.name || '',
    pathLabels: stores.map((store) => store.name).filter(Boolean),
    items,
    receiveStatus: RECEIVE_STATUS.not_received,
    createdAt: Date.now(),
    aureusId: primary?.id != null ? String(primary.id) : null,
    transferCode,
    aureusTransfers: posted.map((row) => ({
      id: row.id != null ? String(row.id) : null,
      transferCode: row.transferCode || (row.id ? `TF${row.id}` : ''),
      fromName: row.fromName || row.from?.name || '',
      toName: row.toName || row.to?.name || '',
      fromLocationId: row.from?.id != null ? String(row.from.id) : null,
      toLocationId: row.to?.id != null ? String(row.to.id) : null,
    })),
  };

  let triage = state.triage;
  if (useTriage && fromStore) {
    triage = attachStoreToTriageDate(triage, {
      dateKey,
      dateLabel,
      store: fromStore,
    });
  }

  commit({
    nextNumber: Math.max(state.nextNumber, Number(number) + 1 || state.nextNumber + 1),
    planned: [transfer, ...state.planned],
    triage,
  });
  return transfer;
}

function patchPlanned(id, patcher) {
  commit({
    ...state,
    planned: state.planned.map((row) => {
      if (row.id !== id) return row;
      const next = patcher(row);
      return { ...next, receiveStatus: receiveStatusOf(next.items) };
    }),
  });
}

function parseQty(value) {
  if (value === '' || value == null || value === '.') return null;
  const n = roundQty(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

export function setPlannedItemReceivedQty(id, itemId, qty) {
  patchPlanned(id, (row) => ({
    ...row,
    items: row.items.map((item) =>
      item.id === itemId ? { ...item, receivedQty: parseQty(qty) } : item,
    ),
  }));
}

export function fillPlannedItemReceivedQty(id, itemId) {
  patchPlanned(id, (row) => ({
    ...row,
    items: row.items.map((item) =>
      item.id === itemId ? { ...item, receivedQty: item.sentQty } : item,
    ),
  }));
}

export function markPlannedItemReceived(id, itemId) {
  patchPlanned(id, (row) => ({
    ...row,
    items: row.items.map((item) => {
      if (item.id !== itemId) return item;
      const qty = item.receivedQty == null ? item.sentQty : item.receivedQty;
      return { ...item, receivedQty: qty, received: true };
    }),
  }));
}

export function receiveAllPlanned(id) {
  patchPlanned(id, (row) => ({
    ...row,
    items: row.items.map((item) => ({
      ...item,
      receivedQty: item.sentQty,
      received: true,
    })),
  }));
}

export function applyPlannedReceive(id, updates) {
  if (!updates || typeof updates !== 'object') return;
  patchPlanned(id, (row) => ({
    ...row,
    items: row.items.map((item) => {
      const next = updates[item.id];
      if (!next) return item;
      const receivedQty =
        next.receivedQty == null
          ? item.receivedQty
          : roundQty(Math.max(0, Number(next.receivedQty) || 0));
      const received = Boolean(next.received ?? (receivedQty >= item.sentQty));
      const aureusId = next.aureusId != null ? String(next.aureusId) : item.aureusId;
      return { ...item, receivedQty, received, aureusId };
    }),
  }));
}

export function removePlannedItems(id, itemIds, meta) {
  const wanted = new Set((itemIds || []).map(String));
  const row = state.planned.find((entry) => entry.id === id);
  if (!row) return;
  const items = (row.items || []).filter((item) => !wanted.has(String(item.id)));
  if (items.length === 0) {
    commit({
      ...state,
      planned: state.planned.filter((entry) => entry.id !== id),
    });
    return;
  }
  patchPlanned(id, (current) => ({
    ...current,
    items,
    aureusTransfers: meta?.aureusTransfers ?? current.aureusTransfers,
    aureusId: meta?.aureusId !== undefined ? meta.aureusId : current.aureusId,
    transferCode: meta?.transferCode !== undefined ? meta.transferCode : current.transferCode,
  }));
}

export function applyPlannedPosMeta(id, meta) {
  if (!meta || typeof meta !== 'object') return;
  patchPlanned(id, (row) => ({
    ...row,
    aureusTransfers: meta.aureusTransfers ?? row.aureusTransfers,
    aureusId: meta.aureusId !== undefined ? meta.aureusId : row.aureusId,
    transferCode: meta.transferCode !== undefined ? meta.transferCode : row.transferCode,
  }));
}

export function syncTransferWorkflowRemote() {
  return pullTriageRemote();
}

export function persistTransferWorkflowNow() {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  if (remoteTimer) {
    clearTimeout(remoteTimer);
    remoteTimer = null;
  }
  return persistLocalNow()
    .then(() => pushTriageRemote())
    .catch(() => {
      localDirty = true;
      schedulePersist();
    });
}

/** Flush everything (not just dirty rows) to Supabase. Used sparingly. */
export function pushTransferWorkflowFull() {
  fullPushPending = true;
  return persistTransferWorkflowNow();
}

export function updateTriageTransfers(updater) {
  const next = typeof updater === 'function' ? updater(state.triage) : updater;
  commit({
    ...state,
    triage: Array.isArray(next) ? next : state.triage,
  });
}

/* ------------------------------------------------------------------ */
/* Batch helpers: everything the triage UI needs to read or mutate a  */
/* date batch lives here so panels stay presentational.               */
/* ------------------------------------------------------------------ */

function amountOf(row) {
  if (row == null) return 0;
  const raw = row.amount ?? row.total ?? row.amountLabel;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  const n = Number(String(raw ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function receiptStamp(actor) {
  return {
    receivedAt: new Date().toISOString(),
    receivedBy: String(actor || '').trim(),
  };
}

function mapBatchPos(batchId, mapper) {
  updateTriageTransfers((current) =>
    current.map((batch) => {
      if (batch.id !== batchId) return batch;
      let touched = false;
      const stores = (batch.stores || []).map((store) => {
        const melt = store.meltPos || [];
        const next = mapper(melt, store);
        if (next === melt) return store;
        touched = true;
        return { ...store, meltPos: next };
      });
      return touched ? { ...batch, stores } : batch;
    }),
  );
}

export function flattenBatchPos(batch) {
  const rows = [];
  for (const store of batch?.stores || []) {
    for (const item of store.meltPos || []) rows.push(item);
  }
  return rows.sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0));
}

/** Roll-up counts for a batch: documents, received, flagged, totals per store. */
export function batchStats(batch) {
  const stores = Array.isArray(batch?.stores) ? batch.stores : [];
  const perStore = [];
  let documents = 0;
  let received = 0;
  let flagged = 0;
  let amount = 0;
  let receivedAmount = 0;
  let lastReceivedAt = 0;
  let expected = 0;
  let bullionOnly = 0;
  let mixed = 0;
  for (const store of stores) {
    const melt = store.meltPos || [];
    let storeExpected = 0;
    let storeReceived = 0;
    let storeFlagged = 0;
    const storeAmount = melt.reduce((sum, row) => sum + amountOf(row), 0);
    for (const row of melt) {
      const cls = classifyPurchaseForTriage(row);
      const onlyBullion = Boolean(row?.bullionOnly) || cls.bullionOnly;
      const heldBullion = Boolean(row?.hasHeldBullion) || cls.hasHeldBullion;
      if (onlyBullion) bullionOnly += 1;
      else {
        expected += 1;
        storeExpected += 1;
        if (heldBullion) mixed += 1;
        if (row.received) {
          received += 1;
          storeReceived += 1;
          receivedAmount += amountOf(row);
        }
        if (triagePoNeedsCorrection(row)) {
          flagged += 1;
          storeFlagged += 1;
        }
      }
      const t = Date.parse(row.receivedAt || '');
      if (Number.isFinite(t) && t > lastReceivedAt) lastReceivedAt = t;
    }
    perStore.push({
      id: store.id,
      storeKey: store.storeKey,
      name: store.name,
      documents: melt.length,
      received: storeReceived,
      flagged: storeFlagged,
      amount: storeAmount,
      expected: storeExpected,
    });
    documents += melt.length;
    amount += storeAmount;
  }
  const census = sanitizeCensus(batch?.census);
  const totalPurchases = Math.max(census?.total || 0, documents);
  if (census && census.total > documents) {
    expected = census.expected;
    bullionOnly = census.bullionOnly;
    mixed = census.mixed || mixed;
  }
  const open = Math.max(0, expected - received);
  const complete = expected > 0 && open === 0;
  return {
    documents,
    received,
    open,
    flagged,
    amount,
    receivedAmount,
    percent: expected > 0 ? Math.round((received / expected) * 100) : 0,
    complete,
    empty: documents === 0,
    lastReceivedAt: lastReceivedAt || null,
    stores: perStore,
    expected,
    totalPurchases,
    bullionOnly,
    mixed,
  };
}

export function setTriagePoReceived(batchId, poId, received, actor) {
  if (!batchId || !poId) return;
  mapBatchPos(batchId, (melt) => {
    if (!melt.some((item) => item.id === poId)) return melt;
    return melt.map((item) => {
      if (item.id !== poId) return item;
      if (received) return { ...item, received: true, ...receiptStamp(actor) };
      const next = { ...item, received: false };
      delete next.receivedAt;
      delete next.receivedBy;
      return next;
    });
  });
}

export function toggleTriagePoReceived(batchId, poId, actor) {
  const batch = state.triage.find((row) => row.id === batchId);
  const item = flattenBatchPos(batch).find((row) => row.id === poId);
  if (!item) return;
  setTriagePoReceived(batchId, poId, !item.received, actor);
}

export function receiveAllTriagePos(batchId, actor, storeId) {
  if (!batchId) return;
  mapBatchPos(batchId, (melt, store) => {
    if (storeId && store.id !== storeId) return melt;
    const due = melt.filter((item) => !item.received && !classifyPurchaseForTriage(item).bullionOnly && !item.bullionOnly);
    if (due.length === 0) return melt;
    return melt.map((item) =>
      item.received || classifyPurchaseForTriage(item).bullionOnly || item.bullionOnly
        ? item
        : { ...item, received: true, ...receiptStamp(actor) },
    );
  });
}

export function removeTriagePo(batchId, poId, actor) {
  if (!batchId || !poId) return;
  const found = findTriagePo(poId);
  const item = found?.item;
  const batch = found?.batch || state.triage.find((row) => row.id === batchId);
  mapBatchPos(batchId, (melt) =>
    melt.some((entry) => poIdsMatch(entry.id, poId))
      ? melt.filter((entry) => !poIdsMatch(entry.id, poId))
      : melt,
  );
  if (!item || !batch) return;
  const entry = sanitizeDeleted({
    id: newId('del'),
    kind: 'doc',
    sourceId: item.id,
    sourceBatchId: batch.id,
    sourceDateKey: batch.dateKey,
    sourceDateLabel: batch.dateLabel,
    storeName: item.storeName || found?.store?.name || '',
    deletedAt: new Date().toISOString(),
    deletedBy: String(actor || ''),
    item,
  });
  if (!entry) return;
  commit({
    deleted: [entry, ...state.deleted.filter((row) => row.sourceId !== entry.sourceId || row.kind !== 'doc')],
  });
  persistTransferWorkflowNow();
}

/** Remove a PO from lots / errors and keep the review from coming back. */
export function deleteTriageDocument(poId, actor) {
  const id = String(poId || '');
  if (!id) return false;
  const found = findTriagePo(id);
  const item = found?.item;
  const batch = found?.batch;
  const sourceIds = [...new Set([id, item?.id, item?.sourceId].map((value) => String(value || '')).filter(Boolean))];
  for (const source of sourceIds) {
    purgedSourceIds.add(source);
    removedReviewIds.add(source);
  }
  const entry = item
    ? sanitizeDeleted({
        id: newId('del'),
        kind: 'doc',
        sourceId: String(item.id || id),
        sourceBatchId: batch?.id,
        sourceDateKey: batch?.dateKey,
        sourceDateLabel: batch?.dateLabel,
        storeName: item.storeName || found?.store?.name || '',
        deletedAt: new Date().toISOString(),
        deletedBy: String(actor || ''),
        item,
      })
    : null;
  commit({
    triage: (state.triage || [])
      .map((row) => {
        let touched = false;
        const stores = (row.stores || []).map((store) => {
          const melt = (store.meltPos || []).filter((entry) => !poIsBlocked(entry, new Set(sourceIds)));
          if (melt.length !== (store.meltPos || []).length) {
            touched = true;
            return { ...store, meltPos: melt };
          }
          return store;
        });
        return touched ? { ...row, stores } : row;
      })
      .filter((row) => !isStandaloneTriage(row) || flattenBatchPos(row).length > 0),
    deleted: entry
      ? [entry, ...state.deleted.filter((row) => row.sourceId !== entry.sourceId || row.kind !== 'doc')]
      : state.deleted,
    reviews: state.reviews.filter((row) => !sourceIds.includes(String(row.id))),
  });
  persistTransferWorkflowNow();
  return true;
}

function purchaseMatches(entry, po) {
  if (!entry || !po) return false;
  if (po.id && entry.id === po.id) return true;
  const sourceId = po.sourceId != null ? String(po.sourceId) : '';
  return Boolean(sourceId) && String(entry.sourceId) === sourceId && (entry.systemKey || 'east') === (po.systemKey || 'east');
}

/**
 * File a finished PO on the batch for its own date. Creates that date batch
 * and store when they are not there yet, and keeps the PO marked received so
 * a later batch for the same date still shows it as already counted.
 */
export function ensurePurchaseOnDateBatch(po, actor) {
  const day = poDateKey(po);
  const storeName = triageStoreLabel(po);
  if (!po?.id || !day || !storeName) return null;

  const stamped = stampTriagePurchase({
    ...po,
    storeName,
    received: true,
    ...receiptStamp(actor),
  });
  const deleted = revivePosForAdd([stamped.id]);
  let triage = [...(state.triage || [])];
  let batch = triage.find((row) => !isStandaloneTriage(row) && dateKeyOf(row) === day);

  const placeOnStores = (stores) => {
    const next = stores.map((store) => ({ ...store, meltPos: [...(store.meltPos || [])] }));
    let store = next.find((entry) => namesMatch(entry.name, storeName) || namesMatch(entry.storeKey, storeName));
    if (!store) {
      store = mapTriageStore({
        storeKey: storeName,
        name: storeName,
        systemKey: po.systemKey,
        systemLabel: po.systemLabel,
        sourceId: po.sourceId,
        meltPos: [],
      });
      next.push(store);
      next.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' }));
    }
    const index = store.meltPos.findIndex((entry) => purchaseMatches(entry, po));
    if (index >= 0) {
      const prev = store.meltPos[index];
      store.meltPos[index] = stampTriagePurchase({
        ...prev,
        ...stamped,
        received: true,
        receivedAt: prev.receivedAt || stamped.receivedAt,
        receivedBy: prev.receivedBy || stamped.receivedBy,
        review: prev.review || stamped.review,
        imageUrls: (prev.imageUrls || []).length ? prev.imageUrls : stamped.imageUrls,
      });
    } else {
      store.meltPos.push(stamped);
    }
    return { stores: next, store };
  };

  if (!batch) {
    const placed = placeOnStores([]);
    batch = sanitizeTriage({
      id: newId('xfer'),
      kind: 'batch',
      dateKey: day,
      dateLabel: po.dateLabel || formatPickerDate(po.date) || day,
      stores: placed.stores,
    });
    triage = [batch, ...triage].sort((a, b) => String(b.dateKey || '').localeCompare(String(a.dateKey || '')));
  } else {
    const placed = placeOnStores(batch.stores || []);
    triage = triage.map((row) => (row.id === batch.id ? { ...row, stores: placed.stores } : row));
  }

  commit({ triage, deleted });
  const saved = (state.triage || []).find((row) => !isStandaloneTriage(row) && dateKeyOf(row) === day) || batch;
  const store =
    (saved.stores || []).find((entry) => namesMatch(entry.name, storeName) || namesMatch(entry.storeKey, storeName)) ||
    saved.stores?.[0] ||
    null;
  const item = (store?.meltPos || []).find((entry) => purchaseMatches(entry, po)) || stamped;
  return { batch: saved, store, item };
}

/** Add rows to the batch, routing each PO to the store whose name matches. */
export function mergeTriagePos(batchId, rows) {
  if (!batchId || !Array.isArray(rows) || rows.length === 0) return;
  const incomingIds = rows.map((row) => row?.id).filter(Boolean);
  const deleted = revivePosForAdd(incomingIds);
  const triage = (state.triage || []).map((batch) => {
    if (batch.id !== batchId) return batch;
    const stores = (batch.stores || []).map((store) => ({
      ...store,
      meltPos: [...(store.meltPos || [])],
    }));
    for (const item of rows) {
      const dest = stores.find((store) => namesMatch(store.name, item.storeName)) || stores[0];
      if (!dest) continue;
      const index = dest.meltPos.findIndex((entry) => entry.id === item.id);
      if (index >= 0) {
        const prev = dest.meltPos[index];
        const incoming = stampTriagePurchase(item);
        const imageUrls = (prev.imageUrls || []).length > 0 ? prev.imageUrls : incoming.imageUrls || [];
        const pricedLines = (incoming.pricedLines || []).length ? incoming.pricedLines : prev.pricedLines;
        const itemNames = (incoming.itemNames || []).length ? incoming.itemNames : prev.itemNames;
        dest.meltPos[index] = stampTriagePurchase({
          ...prev,
          ...incoming,
          received: prev.received,
          receivedAt: prev.receivedAt,
          receivedBy: prev.receivedBy,
          review: prev.review || incoming.review,
          imageUrls,
          pricedLines: pricedLines || prev.pricedLines,
          itemNames: itemNames || prev.itemNames,
          itemSearchText: incoming.itemSearchText || prev.itemSearchText,
        });
        continue;
      }
      const prior = findTriagePo(item.id)?.item;
      dest.meltPos.push(
        stampTriagePurchase({
          ...item,
          received: Boolean(prior?.received),
          receivedAt: prior?.receivedAt,
          receivedBy: prior?.receivedBy,
        }),
      );
    }
    for (const store of stores) {
      store.meltPos.sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0));
    }
    return { ...batch, stores };
  });
  commit({ triage, deleted });
}

export function patchTriagePosDetails(batchId, rows) {
  if (!batchId || !Array.isArray(rows) || rows.length === 0) return;
  const byId = new Map(rows.filter((row) => row?.id).map((row) => [row.id, row]));
  updateTriageTransfers((current) =>
    current.map((batch) => {
      if (batch.id !== batchId) return batch;
      let changed = false;
      const stores = (batch.stores || []).map((store) => {
        const meltPos = (store.meltPos || []).map((item) => {
          const incoming = byId.get(item.id);
          if (!incoming) return stampTriagePurchase(item);
          changed = true;
          return stampTriagePurchase({
            ...item,
            pricedLines: incoming.pricedLines?.length ? incoming.pricedLines : item.pricedLines,
            itemNames: incoming.itemNames?.length ? incoming.itemNames : item.itemNames,
            itemSearchText: incoming.itemSearchText || item.itemSearchText,
            imageUrls: (item.imageUrls || []).length ? item.imageUrls : incoming.imageUrls,
          });
        });
        return { ...store, meltPos };
      });
      return changed ? { ...batch, stores } : batch;
    }),
  );
}

export function refreshPurchaseCensus(batchId, rows) {
  if (!batchId) return;
  const list = Array.isArray(rows) ? rows : [];
  updateTriageTransfers((current) =>
    current.map((batch) => {
      if (batch.id !== batchId) return batch;
      const ids = [];
      const seen = new Set();
      let total = 0;
      let expected = 0;
      let bullionOnly = 0;
      let mixed = 0;
      for (const row of list) {
        const id = String(row?.id || '');
        if (!id || seen.has(id)) continue;
        seen.add(id);
        ids.push(id);
        total += 1;
        const cls = classifyPurchaseForTriage(row);
        if (cls.bullionOnly) bullionOnly += 1;
        else {
          expected += 1;
          if (cls.hasHeldBullion) mixed += 1;
        }
      }
      return { ...batch, census: { total, expected, bullionOnly, mixed, ids } };
    }),
  );
}

export function recordPurchaseCensus(batchId, rows) {
  if (!batchId || !Array.isArray(rows) || rows.length === 0) return;
  updateTriageTransfers((current) =>
    current.map((batch) => {
      if (batch.id !== batchId) return batch;
      const census = sanitizeCensus(batch.census) || { total: 0, expected: 0, bullionOnly: 0, mixed: 0, ids: [] };
      const seen = new Set(census.ids);
      const ids = [...census.ids];
      let total = census.total;
      let expected = census.expected;
      let bullionOnly = census.bullionOnly;
      let mixed = census.mixed;
      for (const row of rows) {
        const id = String(row?.id || '');
        if (!id || seen.has(id)) continue;
        seen.add(id);
        ids.push(id);
        total += 1;
        const cls = classifyPurchaseForTriage(row);
        if (cls.bullionOnly) bullionOnly += 1;
        else {
          expected += 1;
          if (cls.hasHeldBullion) mixed += 1;
        }
      }
      return { ...batch, census: { total, expected, bullionOnly, mixed, ids } };
    }),
  );
}

function poIdsMatch(left, right) {
  return Boolean(left) && String(left) === String(right);
}

export function findTriagePo(poId) {
  const id = String(poId || '');
  if (!id) return null;
  for (const batch of state.triage || []) {
    for (const store of batch.stores || []) {
      const item = (store.meltPos || []).find((entry) => poIdsMatch(entry.id, id));
      if (item) return { batch, store, item };
    }
  }
  return null;
}

function triageStoreLabel(row) {
  const raw = String(row?.storeName || '').trim();
  const fallback = raw && raw !== '—' ? raw : String(row?.systemLabel || '').trim();
  return canonicalStoreName(fallback) || fallback || 'Unknown store';
}

export function addStandaloneTriagePo(row, { received = false, actor } = {}) {
  if (!row?.id) return { ok: false, reason: 'missing' };
  const existing = findTriagePo(row.id);
  if (existing) {
    return {
      ok: false,
      reason: 'exists',
      batch: existing.batch,
      item: existing.item,
    };
  }
  const storeName = triageStoreLabel(row);
  const stamped = stampTriagePurchase({
    ...row,
    storeName,
    originStoreName: row.originStoreName || storeName,
    received: Boolean(received),
    addedAt: row.addedAt || new Date().toISOString(),
    ...(received ? receiptStamp(actor) : {}),
  });
  const stampedId = String(stamped.id || row.id);
  const deleted = revivePosForAdd([stampedId]);
  const dateKey = `po:${row.id}`;
  const next = sanitizeTriage({
    id: newId('qpo'),
    kind: 'po',
    addedAt: stamped.addedAt,
    dateKey,
    dateLabel: row.dateLabel || formatPickerDate(row.date) || '',
    stores: [
      {
        storeKey: storeName || row.sourceId || row.id,
        name: storeName,
        systemKey: row.systemKey,
        systemLabel: row.systemLabel,
        sourceId: row.sourceId,
        meltPos: [stamped],
      },
    ],
  });
  commit({
    triage: [next, ...(state.triage || [])],
    deleted,
  });
  const saved = (state.triage || []).find((row) => row.id === next.id) || next;
  const item = flattenBatchPos(saved)[0] || stamped;
  return { ok: true, batch: saved, item };
}

/** Finish a PO into its store+month lot. Creates the lot folder on first PO. */
export function fileTriagePoToLot(po, actor) {
  if (!po?.id) return { ok: false, reason: 'missing' };
  po = { ...po, storeName: triageStoreLabel(po) };
  const existing = findTriagePo(po.id);
  if (existing) {
    const origin = existing.item.originStoreName || po.originStoreName || po.storeName;
    const nextItem = stampTriagePurchase({
      ...existing.item,
      ...po,
      storeName: origin,
      originStoreName: origin,
      created_by: po.created_by || existing.item.created_by,
      createdBy: po.createdBy || existing.item.createdBy,
      employeeName: po.employeeName || existing.item.employeeName || po.created_by,
      review: existing.item.review,
      received: true,
    });
    updateTriageTransfers((current) =>
      current.map((batch) =>
        batch.id === existing.batch.id ? placeItemOnNamedStore(batch, nextItem, origin) : batch,
      ),
    );
    setTriagePoReceived(existing.batch.id, existing.item.id, true, actor);
    const found = findTriagePo(po.id);
    const item = found?.item || existing.item;
    return {
      ok: true,
      existed: true,
      batch: found?.batch || existing.batch,
      item,
      lot: lotFromPo({ ...po, ...item, storeName: item?.storeName || po.storeName }),
    };
  }
  const added = addStandaloneTriagePo(po, { received: true, actor });
  if (!added.ok) return added;
  return {
    ok: true,
    existed: false,
    batch: added.batch,
    item: added.item,
    lot: lotFromPo({ ...po, ...added.item, storeName: added.item?.storeName || po.storeName }),
  };
}

function archiveTriageRow(row, actor) {
  if (!row?.id) return;
  const entry = sanitizeDeleted({
    id: newId('del'),
    kind: isStandaloneTriage(row) ? 'po' : 'batch',
    sourceId: row.id,
    sourceDateKey: row.dateKey,
    sourceDateLabel: row.dateLabel,
    deletedAt: new Date().toISOString(),
    deletedBy: String(actor || ''),
    payload: row,
  });
  if (!entry) return;
  removedTriageIds.add(String(row.id));
  commit({
    triage: state.triage.filter((item) => item.id !== row.id),
    deleted: [entry, ...state.deleted.filter((item) => item.sourceId !== String(row.id))],
  });
}

export function removeTriageBatch(batchId, actor) {
  if (!batchId) return;
  const row = state.triage.find((item) => item.id === batchId);
  if (!row) {
    updateTriageTransfers((current) => current.filter((item) => item.id !== batchId));
    return;
  }
  archiveTriageRow(row, actor);
}

function mergeStoresIntoBatch(target, incoming) {
  const stores = (target.stores || []).map((store) => ({
    ...store,
    meltPos: [...(store.meltPos || [])],
  }));
  for (const store of incoming?.stores || []) {
    const dest = stores.find((entry) => entry.storeKey === store.storeKey || namesMatch(entry.name, store.name));
    if (!dest) {
      stores.push({
        ...store,
        meltPos: [...(store.meltPos || [])],
      });
      continue;
    }
    for (const item of store.meltPos || []) {
      if (dest.meltPos.some((entry) => entry.id === item.id)) continue;
      dest.meltPos.push(item);
    }
  }
  return { ...target, stores };
}

export function restoreTriageDeleted(entryId) {
  const entry = state.deleted.find((row) => row.id === entryId);
  if (!entry) return { ok: false, reason: 'missing' };

  let triage = state.triage;
  if (entry.kind === 'doc') {
    const item = stampTriagePurchase(entry.item);
    const dest =
      triage.find((row) => row.id === entry.sourceBatchId) ||
      triage.find((row) => !isStandaloneTriage(row) && row.dateKey === entry.sourceDateKey);
    if (dest) {
      const already = flattenBatchPos(dest).some((row) => row.id === item.id);
      if (!already) {
        triage = triage.map((row) => {
          if (row.id !== dest.id) return row;
          const stores = (row.stores || []).map((store) => ({ ...store, meltPos: [...(store.meltPos || [])] }));
          const target =
            stores.find((store) => namesMatch(store.name, item.storeName || entry.storeName)) || stores[0];
          if (target) target.meltPos.push(item);
          return { ...row, stores };
        });
      }
    } else {
      const next = sanitizeTriage({
        id: newId('qpo'),
        kind: 'po',
        dateKey: `po:${item.id}`,
        dateLabel: item.dateLabel || entry.sourceDateLabel || '',
        stores: [
          {
            storeKey: item.storeName || entry.storeName || item.id,
            name: item.storeName || entry.storeName || 'Unknown store',
            meltPos: [item],
          },
        ],
      });
      triage = [next, ...triage];
    }
  } else {
    const payload = sanitizeTriage(entry.payload);
    if (!payload) return { ok: false, reason: 'missing' };
    const already = triage.some((row) => row.id === payload.id);
    if (!already) {
      if (!isStandaloneTriage(payload)) {
        const existing = triage.find((row) => !isStandaloneTriage(row) && row.dateKey === payload.dateKey);
        if (existing) {
          triage = triage.map((row) => (row.id === existing.id ? mergeStoresIntoBatch(row, payload) : row));
        } else {
          removedTriageIds.delete(String(payload.id));
          triage = [payload, ...triage].sort((a, b) => String(b.dateKey || '').localeCompare(String(a.dateKey || '')));
        }
      } else if (!findTriagePo(flattenBatchPos(payload)[0]?.id)) {
        removedTriageIds.delete(String(payload.id));
        triage = [payload, ...triage];
      }
    } else {
      removedTriageIds.delete(String(payload.id));
    }
  }

  removedDeletedIds.add(String(entry.id));
  commit({
    triage,
    deleted: state.deleted.filter((row) => row.id !== entry.id),
  });
  return { ok: true };
}

function collectPurgeIds(entry) {
  const ids = [];
  if (entry?.id) ids.push(entry.id);
  if (entry?.sourceId) ids.push(entry.sourceId);
  if (entry?.kind === 'doc' && entry.item?.id) ids.push(entry.item.id);
  if (entry?.kind === 'po' || entry?.kind === 'batch') {
    for (const item of flattenBatchPos(entry.payload)) {
      if (item?.id) ids.push(item.id);
    }
    if (entry.payload?.id) ids.push(entry.payload.id);
  }
  return [...new Set(ids.map((id) => String(id)).filter(Boolean))];
}

/** Drop a Deleted-tab row from triage storage. Does not change Aureus. */
export function purgeTriageDeleted(entryId) {
  const entry = state.deleted.find((row) => row.id === entryId);
  if (!entry) return { ok: false, reason: 'missing' };
  for (const id of collectPurgeIds(entry)) {
    purgedSourceIds.add(id);
    removedTriageIds.add(id);
  }
  removedDeletedIds.add(String(entry.id));
  commit({
    triage: state.triage.filter((row) => !purgedSourceIds.has(String(row.id))),
    deleted: state.deleted.filter((row) => row.id !== entry.id),
  });
  return { ok: true };
}

export function removeTriageBatchStore(batchId, storeId) {
  if (!batchId || !storeId) return;
  updateTriageTransfers((current) =>
    current.map((batch) =>
      batch.id !== batchId
        ? batch
        : { ...batch, stores: (batch.stores || []).filter((store) => store.id !== storeId) },
    ),
  );
}

function namesMatch(a, b) {
  const left = String(a || '').trim();
  const right = String(b || '').trim();
  if (left === right) return true;
  if (!left || !right) return false;
  return left.localeCompare(right, undefined, { sensitivity: 'base' }) === 0;
}

// Store folder lookups compare the same dozen labels on every reviewed PO;
// the locale-aware compare is the slow part, so remember each pair.
const storeLabelMatchCache = new Map();
const STORE_LABEL_CACHE_LIMIT = 4000;

function storeLabelsMatch(a, b) {
  const left = String(a || '');
  const right = String(b || '');
  const key = `${left}\u0000${right}`;
  const cached = storeLabelMatchCache.get(key);
  if (cached !== undefined) return cached;
  const result = storesMatch(left, right) || namesMatch(left, right);
  if (storeLabelMatchCache.size >= STORE_LABEL_CACHE_LIMIT) storeLabelMatchCache.clear();
  storeLabelMatchCache.set(key, result);
  return result;
}

function findStoreByLabel(stores, storeName) {
  return (stores || []).find(
    (store) => storeLabelsMatch(store.name, storeName) || storeLabelsMatch(store.storeKey, storeName),
  );
}

/** Keep the PO on the store folder that matches its canonical store name. */
function placeItemOnNamedStore(transfer, item, storeName) {
  if (!transfer || !item?.id) return transfer;
  const destName = canonicalStoreName(storeName) || String(storeName || '').trim() || 'Unknown store';
  const updated = { ...item, storeName: destName };
  const stores = Array.isArray(transfer.stores) ? transfer.stores : [];
  const dest = findStoreByLabel(stores, destName);
  if (!dest) {
    return {
      ...transfer,
      stores: [
        ...stores.map((store) => ({
          ...store,
          meltPos: (store.meltPos || []).filter((entry) => !poIdsMatch(entry.id, updated.id)),
        })),
        {
          id: newId('store'),
          storeKey: destName,
          name: destName,
          meltPos: [updated],
        },
      ],
    };
  }
  return {
    ...transfer,
    stores: stores.map((store) => {
      const melt = (store.meltPos || []).filter((entry) => !poIdsMatch(entry.id, updated.id));
      if (store.id === dest.id) {
        return { ...store, name: dest.name || destName, meltPos: [...melt, updated] };
      }
      return melt.length === (store.meltPos || []).length ? store : { ...store, meltPos: melt };
    }),
  };
}

function headerFieldValue(review, key) {
  const field = (review?.draft?.header || []).find((entry) => entry.key === key);
  if (!field) return null;
  return String(field.value ?? '').trim();
}

export function applyTriageReviewToPo(item, review) {
  if (!item) return item;
  const next = { ...item, review };
  const store = headerFieldValue(review, 'store');
  const customer = headerFieldValue(review, 'customer');
  const employee = headerFieldValue(review, 'employee');
  const date = headerFieldValue(review, 'date');
  const total = headerFieldValue(review, 'total');
  if (store) next.storeName = canonicalStoreName(store) || store;
  else if (next.storeName) next.storeName = canonicalStoreName(next.storeName) || next.storeName;
  if (customer) next.customerName = customer;
  if (employee) next.employeeName = employee;
  if (date) next.dateLabel = date;
  if (total) next.amountLabel = total;
  const edits = Array.isArray(review?.lineEdits) ? review.lineEdits : [];
  if (edits.length && Array.isArray(item.pricedLines)) {
    next.pricedLines = item.pricedLines.map((line, index) => {
      const edit = edits.find((row) => Number(row?.index) === index);
      const rawAmount = String(edit?.amount || '').trim();
      const amount = Number(rawAmount.replace(/[^0-9.-]/g, ''));
      if (!edit || !rawAmount || !Number.isFinite(amount)) return line;
      const original = line?.originalLineTotal != null ? line.originalLineTotal : line?.lineTotal;
      return { ...line, originalLineTotal: original, lineTotal: amount };
    });
  }
  return next;
}

/** Keep an entered error on the store that wrote the PO. */
function reviewOnItem(item, review, fallbackStore) {
  const preset = String(item?.originStoreName || review?.errorStore || item?.review?.errorStore || '').trim();
  const attributed =
    preset && preset !== '—'
      ? canonicalStoreName(preset) || preset
      : errorAttributionStore(
          { ...item, storeName: item?.storeName || fallbackStore, review },
          fallbackStore,
        );
  const nextReview = { ...review, errorStore: review?.errorStore || attributed };
  const updated = applyTriageReviewToPo(item, nextReview);
  updated.originStoreName = item?.originStoreName || attributed;
  if (!updated.storeName) updated.storeName = attributed;
  const folder = triagePoNeedsCorrection(updated) ? updated.originStoreName || attributed : updated.storeName;
  return { item: updated, folder };
}

function applyPoReviewToTransfer(transfer, poId, review) {
  const stores = Array.isArray(transfer?.stores) ? transfer.stores : [];
  let currentStore = null;
  let currentItem = null;
  for (const store of stores) {
    const item = (store.meltPos || []).find((entry) => poIdsMatch(entry.id, poId));
    if (item) {
      currentStore = store;
      currentItem = item;
      break;
    }
  }
  if (!currentStore || !currentItem) return transfer;

  const placed = reviewOnItem(currentItem, review, currentStore.name);
  return placeItemOnNamedStore(transfer, placed.item, placed.folder);
}

export function triagePoNeedsCorrection(po) {
  const review = po?.review;
  if (!review || typeof review !== 'object') return false;
  if (Array.isArray(review.corrections) && review.corrections.length > 0) return true;
  if (String(review.note || '').trim()) return true;
  if (String(review.errorType || '').trim()) return true;
  if (String(review.errorAmount || '').trim()) return true;
  if (Array.isArray(review.lineEdits) && review.lineEdits.length > 0) return true;
  return false;
}

/** A PO / SO someone has finished or reviewed — not just queued. */
export function isTriagePoEvaluated(po) {
  if (!po) return false;
  if (po.received) return true;
  if (triagePoNeedsCorrection(po)) return true;
  return Boolean(triageReviewEditor(po.review));
}

const collectPosCache = { source: null, all: null, evaluated: null };
// Flattened rows per batch object. Pulls and saves keep untouched batches by
// reference, so only the batches that changed are flattened again.
const batchPosCache = new WeakMap();

function flattenTriageBatchRows(transfer) {
  const cached = batchPosCache.get(transfer);
  if (cached) return cached;
  const rows = [];
  for (const store of transfer.stores || []) {
    for (const item of store.meltPos || []) {
      const reviewed = triagePoNeedsCorrection(item);
      const evaluated = isTriagePoEvaluated(item);
      const storeName = errorAttributionStore(item, store.name);
      const lot = lotFromPo({ ...item, storeName });
      rows.push({
        ...item,
        triageId: transfer.id,
        triageDateKey: transfer.dateKey,
        triageDateLabel: transfer.dateLabel,
        triageLocationName: transfer.triageLocation?.name || '',
        storeId: store.id,
        storeKey: store.storeKey,
        storeName,
        lotId: lot.id,
        lot,
        incorrect: reviewed,
        evaluated,
      });
    }
  }
  batchPosCache.set(transfer, rows);
  return rows;
}

function collectTriagePos(triage = [], { evaluatedOnly = false } = {}) {
  if (collectPosCache.source !== triage) {
    const rows = [];
    for (const transfer of Array.isArray(triage) ? triage : []) {
      if (!transfer || typeof transfer !== 'object') continue;
      const batchRows = flattenTriageBatchRows(transfer);
      for (let i = 0; i < batchRows.length; i += 1) rows.push(batchRows[i]);
    }
    const timeOf = new Map();
    for (const row of rows) timeOf.set(row, Date.parse(row.date) || 0);
    rows.sort((a, b) => {
      const dateDelta = timeOf.get(b) - timeOf.get(a);
      if (dateDelta) return dateDelta;
      return String(b.reference || '').localeCompare(String(a.reference || ''));
    });
    collectPosCache.source = triage;
    collectPosCache.all = rows;
    collectPosCache.evaluated = rows.filter((row) => row.evaluated);
  }
  return evaluatedOnly ? collectPosCache.evaluated : collectPosCache.all;
}

export function collectReceivedTriagePos(triage = []) {
  return collectAccuracyTriagePos(triage).filter((row) => row.received);
}

/** Every PO / SO on a triage batch, including ones still waiting. */
export function collectAllTriagePos(triage = []) {
  return collectTriagePos(triage);
}

export function collectAccuracyTriagePos(triage = []) {
  return collectTriagePos(triage, { evaluatedOnly: true });
}

export function saveTriagePoReview(poId, review, editor) {
  if (!poId) return null;
  const editedBy = sanitizeReviewEditor(editor) || sanitizeReviewEditor(review?.editedBy);
  const now = new Date().toISOString();
  const nextReview = sanitizeReviewRow({
    id: poId,
    review: {
      ...review,
      editedBy: editedBy || undefined,
      editedAt: editedBy ? now : review?.editedAt,
    },
    updatedAt: now,
  });
  if (!nextReview) return null;
  removedReviewIds.delete(String(poId));
  commit({
    reviews: [nextReview, ...state.reviews.filter((row) => String(row.id) !== String(poId))],
    triage: state.triage.map((row) => applyPoReviewToTransfer(row, poId, nextReview.review)),
  });
  const found = findTriagePo(poId);
  if (found && !found.item?.received) {
    setTriagePoReceived(found.batch.id, poId, true, editedBy?.name);
  }
  persistTransferWorkflowNow();
  return nextReview.review;
}

export function saveTriagePoAllocation(poId, allocation, editor) {
  if (!poId) return null;
  const found = findTriagePo(poId);
  if (!found) return null;
  const editedBy = sanitizeReviewEditor(editor) || sanitizeReviewEditor(allocation?.allocatedBy);
  const now = new Date().toISOString();
  const next = sanitizeAllocation({
    ...allocation,
    allocatedBy: editedBy || undefined,
    allocatedAt: now,
  });
  if (!next) return null;
  mapBatchPos(found.batch.id, (melt) => {
    if (!melt.some((item) => item.id === poId)) return melt;
    return melt.map((item) => (item.id === poId ? { ...item, allocation: next } : item));
  });
  persistTransferWorkflowNow();
  return next;
}

function originalHeaderMap(review) {
  const out = {};
  for (const field of review?.draft?.header || []) {
    out[field.key] = String(field.original ?? '').trim();
  }
  return out;
}

export function revertTriageReviewOnPo(item) {
  if (!item) return item;
  const originals = originalHeaderMap(item.review);
  const next = { ...item };
  delete next.review;
  if (originals.store) next.storeName = originals.store;
  if (originals.customer) next.customerName = originals.customer;
  if (originals.employee) next.employeeName = originals.employee;
  if (originals.date) next.dateLabel = originals.date;
  if (originals.total) next.amountLabel = originals.total;
  return next;
}

export function clearTriagePoReview(poId) {
  if (!poId) return;
  removedReviewIds.add(String(poId));
  commit({
    reviews: state.reviews.filter((row) => String(row.id) !== String(poId)),
    triage: state.triage.map((transfer) => {
      const stores = Array.isArray(transfer?.stores) ? transfer.stores : [];
      let currentStore = null;
      let currentItem = null;
      for (const store of stores) {
        const item = (store.meltPos || []).find((entry) => entry.id === poId);
        if (item) {
          currentStore = store;
          currentItem = item;
          break;
        }
      }
      if (!currentStore || !currentItem) return transfer;

      const reverted = revertTriageReviewOnPo(currentItem);
      const destName = String(reverted.storeName || '').trim();
      const destStore =
        destName &&
        stores.find((store) => store.id !== currentStore.id && namesMatch(store.name, destName));

      return {
        ...transfer,
        stores: stores.map((store) => {
          let meltPos = store.meltPos || [];
          if (store.id === currentStore.id) {
            meltPos = meltPos.filter((entry) => entry.id !== poId);
            if (!destStore) meltPos = [...meltPos, reverted];
          } else if (destStore && store.id === destStore.id) {
            meltPos = [...meltPos.filter((entry) => entry.id !== poId), reverted];
          }
          return { ...store, meltPos };
        }),
      };
    }),
  });
  persistTransferWorkflowNow();
}

function isWorkshopName(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .includes('workshop');
}

export function transferGoesToWorkshop(row) {
  if (!row) return false;
  if (isWorkshopName(row.toName) || isWorkshopName(row.to?.name)) return true;
  if ((row.pathLabels || []).some(isWorkshopName)) return true;
  return (row.items || []).some((item) => isWorkshopName(item.toName) || isWorkshopName(item.to?.name));
}

export function plannedWorkshopTransfersForStore(storeKey, storeName) {
  if (!storeKey && !storeName) return [];
  return (state.planned || []).filter((row) => {
    const fromHere =
      (storeKey && row.fromStoreKey === storeKey) ||
      (storeName &&
        String(row.fromName || '').localeCompare(String(storeName), undefined, {
          sensitivity: 'base',
        }) === 0);
    return fromHere && transferGoesToWorkshop(row);
  });
}

export function plannedForTriageStore(dateKey, storeKey) {
  if (!storeKey) return [];
  return (state.planned || []).filter((row) => {
    if (row.fromStoreKey !== storeKey) return false;
    if (transferGoesToWorkshop(row)) return true;
    return Boolean(row.forTriage && dateKey && row.dateKey === dateKey);
  });
}

hydrateTransferWorkflow();
bindTriageRemote();
