import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
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
let hydratePromise = null;
let hydrated = false;

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

function schedulePersist() {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state)).catch(() => {});
  }, 200);
}

function commit(next) {
  state = next;
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
  if (hydrated) return snapshot();
  if (hydratePromise) return hydratePromise;
  hydratePromise = AsyncStorage.getItem(STORAGE_KEY)
    .then((raw) => {
      if (raw) {
        const parsed = JSON.parse(raw);
        const planned = Array.isArray(parsed?.planned)
          ? parsed.planned.map(sanitizePlanned).filter(Boolean)
          : [];
        const triage = Array.isArray(parsed?.triage)
          ? parsed.triage.map(sanitizeTriage).filter(Boolean)
          : [];
        const maxNumber = planned.reduce(
          (max, row) => Math.max(max, row.number || 0),
          0,
        );
        state = {
          nextNumber: Math.max(Number(parsed?.nextNumber) || 1, maxNumber + 1),
          planned,
          triage,
        };
      }
      hydrated = true;
      emit();
      return snapshot();
    })
    .catch(() => {
      hydrated = true;
      return snapshot();
    });
  return hydratePromise;
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

export function persistTransferWorkflowNow() {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  return AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function updateTriageTransfers(updater) {
  const next = typeof updater === 'function' ? updater(state.triage) : updater;
  commit({
    ...state,
    triage: Array.isArray(next) ? next : state.triage,
  });
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
  const rows = [];
  for (const transfer of Array.isArray(triage) ? triage : []) {
    for (const store of transfer.stores || []) {
      for (const item of store.meltPos || []) {
        if (!item?.received) continue;
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
    current.map((row) => ({
      ...row,
      stores: (row.stores || []).map((store) => ({
        ...store,
        meltPos: (store.meltPos || []).map((item) =>
          item.id === poId ? { ...item, review } : item,
        ),
      })),
    })),
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
