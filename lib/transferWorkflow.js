import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { classifyPurchaseForTriage, stampTriagePurchase } from './priceCheck';
import { getSupabase } from './supabase';
import { formatDateParam, formatPickerDate } from './transactions';

const STORAGE_KEY = 'cgold_transfer_workflow';

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
};

const listeners = new Set();
let persistTimer = null;
let remoteTimer = null;
let hydratePromise = null;
let hydrated = false;
let remoteLoaded = false;
let localDirty = false;
let pushingRemote = false;
let pushQueued = false;
let authBound = false;
let realtimeChannel = null;
let removedTriageDates = new Set();
let removedTriageIds = new Set();
let removedPlannedIds = new Set();
// Incremental push bookkeeping: only rows that changed by reference since the
// last successful push are sent. A full push is forced after hydrate/pull.
let dirtyTriageIds = new Set();
let dirtyPlannedIds = new Set();
let metaDirty = false;
let fullPushPending = true;
let lastPushDoneAt = 0;

const LOCAL_PERSIST_MS = 250;
const REMOTE_PUSH_MS = 900;
const REALTIME_ECHO_MS = 3000;

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

function snapshot() {
  return {
    nextNumber: state.nextNumber,
    planned: state.planned,
    triage: state.triage,
  };
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

function persistLocalNow() {
  return AsyncStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      ...state,
      removedTriageDates: [...removedTriageDates],
      removedTriageIds: [...removedTriageIds],
      removedPlannedIds: [...removedPlannedIds],
    }),
  );
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
  syncTriageTombstones(state.triage, next?.triage);
  syncPlannedTombstones(state.planned, next?.planned);
  markDirtyRows(state.triage, next?.triage, dirtyTriageIds);
  markDirtyRows(state.planned, next?.planned, dirtyPlannedIds);
  if (next?.nextNumber !== state.nextNumber) metaDirty = true;
  state = next;
  localDirty = true;
  emit();
  schedulePersist();
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
    sentQty: Math.max(0, Math.round(Number(item?.sentQty) || 0)),
    receivedQty:
      item?.receivedQty === '' || item?.receivedQty == null
        ? null
        : Math.max(0, Math.round(Number(item.receivedQty) || 0)),
    received: Boolean(item?.received),
    fromHave: Math.max(0, Math.round(Number(item?.fromHave) || 0)),
    toHave: Math.max(0, Math.round(Number(item?.toHave) || 0)),
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

export async function hydrateTransferWorkflow() {
  if (hydrated && remoteLoaded) return snapshot();
  if (hydratePromise) return hydratePromise;
  hydratePromise = (async () => {
    if (!hydrated) {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
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
          const maxNumber = planned.reduce((max, row) => Math.max(max, row.number || 0), 0);
          state = {
            nextNumber: Math.max(Number(parsed?.nextNumber) || 1, maxNumber + 1),
            planned,
            triage,
          };
        }
      } catch {
        // Keep empty in-memory state if the cache is unreadable.
      }
      hydrated = true;
      emit();
    }
    await pullTriageRemote();
    bindTriageRemote();
    return snapshot();
  })().finally(() => {
    hydratePromise = null;
  });
  return hydratePromise;
}

async function fetchTriageRemote(supabase) {
  let batches = await supabase
    .from('triage_batches')
    .select('id, date_key, date_label, kind, census, triage_location, stores, updated_at')
    .order('date_key', { ascending: false });
  if (batches.error && /kind|census/i.test(String(batches.error.message || ''))) {
    batches = await supabase
      .from('triage_batches')
      .select('id, date_key, date_label, triage_location, stores, updated_at')
      .order('date_key', { ascending: false });
  }
  const [planned, meta] = await Promise.all([
    supabase.from('triage_planned').select('id, payload, updated_at'),
    supabase.from('triage_meta').select('next_number').eq('id', 'default').maybeSingle(),
  ]);
  if (batches.error) throw batches.error;
  if (planned.error) throw planned.error;
  if (meta.error) throw meta.error;
  return {
    triage: (batches.data || []).map(batchFromRemote).filter(Boolean),
    planned: (planned.data || [])
      .map((row) => sanitizePlanned(row?.payload || row))
      .filter(Boolean),
    nextNumber: Math.max(1, Math.round(Number(meta.data?.next_number) || 1)),
  };
}

async function pullTriageRemote() {
  const supabase = await triageClient();
  if (!supabase) return snapshot();
  try {
    const remote = await fetchTriageRemote(supabase);
    const preferLocal = localDirty && !remoteLoaded;
    const planned = mergeByKey(
      state.planned,
      remote.planned,
      (row) => String(row?.id || ''),
      preferLocal,
      removedPlannedIds,
    ).sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0));
    const triage = mergeByKey(
      state.triage,
      remote.triage,
      triageRowKey,
      preferLocal,
      removedTriageIds,
    ).sort((a, b) => {
      const aPo = isStandaloneTriage(a) ? 1 : 0;
      const bPo = isStandaloneTriage(b) ? 1 : 0;
      if (aPo !== bPo) return aPo - bPo;
      return String(b.dateKey || '').localeCompare(String(a.dateKey || ''));
    });
    const maxNumber = planned.reduce((max, row) => Math.max(max, row.number || 0), 0);
    state = {
      nextNumber: Math.max(state.nextNumber, remote.nextNumber, maxNumber + 1),
      planned,
      triage,
    };
    remoteLoaded = true;
    emit();
    persistLocalNow().catch(() => {});
    const shouldPush =
      preferLocal ||
      state.triage.some((row) => !remote.triage.some((item) => item.id === row.id)) ||
      state.planned.some((row) => !remote.planned.some((item) => item.id === row.id));
    if (shouldPush) {
      fullPushPending = true;
      await pushTriageRemote();
    }
  } catch (error) {
    if (isMissingTriageRelation(error)) remoteLoaded = true;
  }
  return snapshot();
}

async function pushTriageRemote() {
  const supabase = await triageClient();
  if (!supabase) return;
  if (pushingRemote) {
    pushQueued = true;
    return;
  }
  const full = fullPushPending;
  const hasTombstones = removedTriageIds.size > 0 || removedTriageDates.size > 0 || removedPlannedIds.size > 0;
  if (!full && !hasTombstones && !metaDirty && dirtyTriageIds.size === 0 && dirtyPlannedIds.size === 0) {
    localDirty = false;
    return;
  }
  pushingRemote = true;
  // Snapshot what this push covers so edits made while it is in flight stay dirty.
  const triageIds = new Set(dirtyTriageIds);
  const plannedIds = new Set(dirtyPlannedIds);
  const pushMeta = metaDirty || full;
  dirtyTriageIds = new Set();
  dirtyPlannedIds = new Set();
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
      let { error } = await supabase.from('triage_batches').upsert(batchRows, { onConflict: 'id' });
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
        uniqueExtraIds.forEach((id) => removedTriageIds.delete(id));
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
    localDirty = dirtyTriageIds.size > 0 || dirtyPlannedIds.size > 0 || metaDirty;
    lastPushDoneAt = Date.now();
    if (removedTriageDates.size === 0 && removedPlannedIds.size === 0) {
      // Tombstones were flushed; refresh the cached copy off the click path.
      schedulePersistLocalOnly();
    }
  } catch (error) {
    // Put the rows back so the next save retries them.
    triageIds.forEach((id) => dirtyTriageIds.add(id));
    plannedIds.forEach((id) => dirtyPlannedIds.add(id));
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

function bindTriageRealtime(supabase) {
  if (realtimeChannel || !supabase) return;
  realtimeChannel = supabase
    .channel('triage-workflow')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'triage_batches' }, () => {
      if (!shouldIgnoreRealtime()) pullTriageRemote().catch(() => {});
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'triage_planned' }, () => {
      if (!shouldIgnoreRealtime()) pullTriageRemote().catch(() => {});
    })
    .subscribe();
}

export function subscribeTransferWorkflow(listener) {
  listeners.add(listener);
  listener(snapshot());
  return () => listeners.delete(listener);
}

export function useTransferWorkflow() {
  const [snapshotState, setSnapshotState] = useState(state);
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
      const sentQty = Math.max(0, Math.round(Number(row.qty) || 0));
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
        fromHave: Math.max(0, Math.round(Number(row.currentQty) || 0)),
        toHave: Math.max(0, Math.round(Number(row.partnerQty) || 0)),
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
  if ((existing.stores || []).some((entry) => entry.storeKey === storeKey)) {
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
  if (value === '' || value == null) return null;
  const n = Math.round(Number(value));
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
          : Math.max(0, Math.round(Number(next.receivedQty) || 0));
      const received = Boolean(next.received ?? (receivedQty >= item.sentQty));
      return { ...item, receivedQty, received };
    }),
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
    .catch(() => {});
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

export function removeTriagePo(batchId, poId) {
  if (!batchId || !poId) return;
  mapBatchPos(batchId, (melt) =>
    melt.some((item) => item.id === poId) ? melt.filter((item) => item.id !== poId) : melt,
  );
}

/** Add rows to the batch, routing each PO to the store whose name matches. */
export function mergeTriagePos(batchId, rows) {
  if (!batchId || !Array.isArray(rows) || rows.length === 0) return;
  updateTriageTransfers((current) =>
    current.map((batch) => {
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
          const pricedLines = (prev.pricedLines || []).length ? prev.pricedLines : incoming.pricedLines;
          const itemNames = (prev.itemNames || []).length ? prev.itemNames : incoming.itemNames;
          dest.meltPos[index] = stampTriagePurchase({
            ...prev,
            imageUrls,
            pricedLines: pricedLines || prev.pricedLines,
            itemNames: itemNames || prev.itemNames,
            itemSearchText: prev.itemSearchText || incoming.itemSearchText,
            hasHeldBullion: incoming.hasHeldBullion || prev.hasHeldBullion,
            bullionOnly: incoming.bullionOnly || prev.bullionOnly,
            bullionLineCount: incoming.bullionLineCount ?? prev.bullionLineCount,
            scrapLineCount: incoming.scrapLineCount ?? prev.scrapLineCount,
          });
          continue;
        }
        dest.meltPos.push(stampTriagePurchase({ ...item, received: false }));
      }
      for (const store of stores) {
        store.meltPos.sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0));
      }
      return { ...batch, stores };
    }),
  );
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

export function findTriagePo(poId) {
  if (!poId) return null;
  for (const batch of state.triage || []) {
    for (const store of batch.stores || []) {
      const item = (store.meltPos || []).find((entry) => entry.id === poId);
      if (item) return { batch, store, item };
    }
  }
  return null;
}

export function addStandaloneTriagePo(row) {
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
  const stamped = stampTriagePurchase({ ...row, received: false });
  const dateKey = `po:${row.id}`;
  const next = sanitizeTriage({
    id: newId('qpo'),
    kind: 'po',
    dateKey,
    dateLabel: row.dateLabel || formatPickerDate(row.date) || '',
    stores: [
      {
        storeKey: row.storeName || row.sourceId || row.id,
        name: row.storeName || 'Unknown store',
        systemKey: row.systemKey,
        systemLabel: row.systemLabel,
        sourceId: row.sourceId,
        meltPos: [stamped],
      },
    ],
  });
  updateTriageTransfers((current) => [next, ...(current || [])]);
  return { ok: true, batch: next, item: stamped };
}

export function removeTriageBatch(batchId) {
  if (!batchId) return;
  updateTriageTransfers((current) => current.filter((row) => row.id !== batchId));
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
  return (
    String(a || '')
      .trim()
      .localeCompare(String(b || '').trim(), undefined, { sensitivity: 'base' }) === 0
  );
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
  if (store) next.storeName = store;
  if (customer) next.customerName = customer;
  if (employee) next.employeeName = employee;
  if (date) next.dateLabel = date;
  if (total) next.amountLabel = total;
  return next;
}

function applyPoReviewToTransfer(transfer, poId, review) {
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

  const updated = applyTriageReviewToPo(currentItem, review);
  const destName = String(updated.storeName || '').trim();
  const destStore =
    destName &&
    stores.find((store) => store.id !== currentStore.id && namesMatch(store.name, destName));

  return {
    ...transfer,
    stores: stores.map((store) => {
      let meltPos = store.meltPos || [];
      if (store.id === currentStore.id) {
        meltPos = meltPos.filter((entry) => entry.id !== poId);
        if (!destStore) meltPos = [...meltPos, updated];
      } else if (destStore && store.id === destStore.id) {
        meltPos = [...meltPos.filter((entry) => entry.id !== poId), updated];
      }
      return { ...store, meltPos };
    }),
  };
}

export function triagePoNeedsCorrection(po) {
  const review = po?.review;
  if (!review || typeof review !== 'object') return false;
  if (Array.isArray(review.corrections) && review.corrections.length > 0) return true;
  if (String(review.note || '').trim()) return true;
  if (String(review.errorType || '').trim()) return true;
  if (String(review.errorAmount || '').trim()) return true;
  return false;
}

export function collectReceivedTriagePos(triage = []) {
  return collectAccuracyTriagePos(triage).filter((row) => row.received);
}

export function collectAccuracyTriagePos(triage = []) {
  const rows = [];
  for (const transfer of Array.isArray(triage) ? triage : []) {
    for (const store of transfer.stores || []) {
      for (const item of store.meltPos || []) {
        const reviewed = triagePoNeedsCorrection(item);
        if (!item?.received && !reviewed) continue;
        rows.push({
          ...item,
          triageId: transfer.id,
          triageDateKey: transfer.dateKey,
          triageDateLabel: transfer.dateLabel,
          triageLocationName: transfer.triageLocation?.name || '',
          storeId: store.id,
          storeKey: store.storeKey,
          storeName: item.storeName || store.name,
        });
      }
    }
  }
  return rows.sort((a, b) => {
    const dateDelta = (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0);
    if (dateDelta) return dateDelta;
    return String(b.reference || '').localeCompare(String(a.reference || ''));
  });
}

export function saveTriagePoReview(poId, review) {
  if (!poId) return;
  updateTriageTransfers((current) =>
    current.map((row) => applyPoReviewToTransfer(row, poId, review)),
  );
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
  updateTriageTransfers((current) =>
    current.map((transfer) => {
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
  );
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
  return state.planned.filter((row) => {
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
  return state.planned.filter((row) => {
    if (row.fromStoreKey !== storeKey) return false;
    if (transferGoesToWorkshop(row)) return true;
    return Boolean(row.forTriage && dateKey && row.dateKey === dateKey);
  });
}

hydrateTransferWorkflow();
bindTriageRemote();
