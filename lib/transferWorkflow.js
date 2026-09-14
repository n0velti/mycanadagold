import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
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
let authBound = false;
let realtimeChannel = null;

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

function mergeByKey(localList, remoteList, keyFn, preferLocal) {
  const map = new Map();
  const first = preferLocal ? remoteList : localList;
  const second = preferLocal ? localList : remoteList;
  for (const row of first || []) {
    const key = keyFn(row);
    if (key) map.set(key, row);
  }
  for (const row of second || []) {
    const key = keyFn(row);
    if (key) map.set(key, row);
  }
  return [...map.values()];
}

function batchFromRemote(row) {
  return sanitizeTriage({
    id: row?.id,
    dateKey: String(row?.date_key || '').slice(0, 10),
    dateLabel: row?.date_label,
    triageLocation: row?.triage_location,
    stores: row?.stores,
  });
}

function persistLocalNow() {
  return AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function schedulePersist() {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    persistLocalNow().catch(() => {});
  }, 200);
  if (remoteTimer) clearTimeout(remoteTimer);
  remoteTimer = setTimeout(() => {
    remoteTimer = null;
    pushTriageRemote().catch(() => {});
  }, 400);
}

function commit(next) {
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

function sanitizeTriage(row) {
  if (!row || typeof row !== 'object') return null;
  const location = row.triageLocation && typeof row.triageLocation === 'object' ? row.triageLocation : null;
  return {
    id: String(row.id || newId('xfer')),
    dateKey: String(row.dateKey || ''),
    dateLabel: String(row.dateLabel || ''),
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
          meltPos: Array.isArray(store?.meltPos) ? store.meltPos : [],
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
  const [batches, planned, meta] = await Promise.all([
    supabase
      .from('triage_batches')
      .select('id, date_key, date_label, triage_location, stores, updated_at')
      .order('date_key', { ascending: false }),
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
    ).sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0));
    const triage = mergeByKey(
      state.triage,
      remote.triage,
      (row) => String(row?.dateKey || ''),
      preferLocal,
    ).sort((a, b) => String(b.dateKey || '').localeCompare(String(a.dateKey || '')));
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
      state.triage.some((row) => !remote.triage.some((item) => item.dateKey === row.dateKey)) ||
      state.planned.some((row) => !remote.planned.some((item) => item.id === row.id));
    if (shouldPush) await pushTriageRemote();
  } catch (error) {
    if (isMissingTriageRelation(error)) remoteLoaded = true;
  }
  return snapshot();
}

async function pushTriageRemote() {
  const supabase = await triageClient();
  if (!supabase || pushingRemote) return;
  pushingRemote = true;
  try {
    const { data: authData } = await supabase.auth.getSession();
    const actorId = authData?.session?.user?.id || null;
    const now = new Date().toISOString();
    const batchRows = (state.triage || [])
      .map(sanitizeTriage)
      .filter((row) => row?.dateKey)
      .map((row) => ({
        id: row.id,
        date_key: row.dateKey,
        date_label: row.dateLabel || '',
        triage_location: row.triageLocation,
        stores: row.stores || [],
        updated_at: now,
        updated_by: actorId,
      }));
    if (batchRows.length) {
      const { error } = await supabase.from('triage_batches').upsert(batchRows, { onConflict: 'date_key' });
      if (error) throw error;
    }
    if (remoteLoaded) {
      const { data: remoteBatches, error: listError } = await supabase
        .from('triage_batches')
        .select('date_key');
      if (listError) throw listError;
      const localDates = new Set(batchRows.map((row) => String(row.date_key).slice(0, 10)));
      const extra = (remoteBatches || [])
        .map((row) => String(row.date_key || '').slice(0, 10))
        .filter((key) => key && !localDates.has(key));
      if (extra.length) {
        const { error } = await supabase.from('triage_batches').delete().in('date_key', extra);
        if (error) throw error;
      }
    }

    const plannedRows = (state.planned || [])
      .map(sanitizePlanned)
      .filter(Boolean)
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
    if (remoteLoaded) {
      const { data: remotePlanned, error: listError } = await supabase.from('triage_planned').select('id');
      if (listError) throw listError;
      const localIds = new Set(plannedRows.map((row) => row.id));
      const extra = (remotePlanned || []).map((row) => row.id).filter((id) => id && !localIds.has(id));
      if (extra.length) {
        const { error } = await supabase.from('triage_planned').delete().in('id', extra);
        if (error) throw error;
      }
    }

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
    localDirty = false;
  } catch (error) {
    if (!isMissingTriageRelation(error)) {
      // Leave localDirty so the next save retries.
    }
  } finally {
    pushingRemote = false;
  }
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
      if (!pushingRemote && !localDirty) pullTriageRemote().catch(() => {});
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'triage_planned' }, () => {
      if (!pushingRemote && !localDirty) pullTriageRemote().catch(() => {});
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

export function updateTriageTransfers(updater) {
  const next = typeof updater === 'function' ? updater(state.triage) : updater;
  commit({
    ...state,
    triage: Array.isArray(next) ? next : state.triage,
  });
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
