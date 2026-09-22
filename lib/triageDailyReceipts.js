/**
 * Daily receipt check for a triage batch.
 *
 * For every day covered by a batch and every store on it, the Workshop records
 * how many PO / SO actually arrived against how many the stores logged. Rows
 * live in `triage_daily_receipts` (one per batch × day × store) so the whole
 * team sees the same count, and the batch chrome can say "All received" or
 * "Not all received" once every cell has been checked.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { classifyPurchaseForTriage } from './priceCheck';
import { getSupabase } from './supabase';
import { formatDateParam, parseDateParam } from './transactions';

const MAX_CONTIGUOUS_DAYS = 31;
const DAY_MS = 24 * 60 * 60 * 1000;

function isMissingRelation(error) {
  const code = String(error?.code || '');
  const message = String(error?.message || '');
  if (code === '42P01' || code === 'PGRST205') return true;
  return /schema cache/i.test(message) && /triage_daily_receipts/i.test(message);
}

function describeError(error, action) {
  if (!error) return `Could not ${action}.`;
  if (isMissingRelation(error)) return 'Run the daily receipts SQL in Supabase, then refresh.';
  return error.message || `Could not ${action}.`;
}

function throwQueryError(error, action) {
  const wrapped = new Error(describeError(error, action));
  wrapped.code = error?.code;
  wrapped.missing = isMissingRelation(error);
  throw wrapped;
}

/** YYYY-MM-DD for a PO / SO row, in local time. */
export function poDateKey(row) {
  const raw = row?.date;
  if (!raw) return '';
  const text = String(raw);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const time = Date.parse(text.replace(' ', 'T'));
  if (!Number.isFinite(time)) return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : '';
  return formatDateParam(new Date(time));
}

export function dailyCellKey(dayKey, storeKey) {
  return `${dayKey}|${storeKey}`;
}

export function batchStoreKey(store) {
  return String(store?.storeKey || store?.id || store?.name || '');
}

function isBullionOnly(row) {
  if (row?.bullionOnly) return true;
  try {
    return Boolean(classifyPurchaseForTriage(row).bullionOnly);
  } catch {
    return false;
  }
}

function dayLabel(dayKey) {
  const date = parseDateParam(dayKey);
  return {
    weekday: date.toLocaleDateString(undefined, { weekday: 'short' }),
    label: date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
  };
}

function contiguousDays(fromKey, toKey) {
  const start = parseDateParam(fromKey).getTime();
  const end = parseDateParam(toKey).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return [fromKey];
  const span = Math.round((end - start) / DAY_MS) + 1;
  if (span > MAX_CONTIGUOUS_DAYS) return null;
  const days = [];
  for (let i = 0; i < span; i += 1) days.push(formatDateParam(new Date(start + i * DAY_MS)));
  return days;
}

/**
 * Day × store grid for a batch.
 * Days run from the earliest PO / SO on the batch through the batch date
 * (or the latest PO, whichever is later). Bullion-only purchases stay in the
 * store, so they do not count toward expected melt documents.
 */
export function buildDailyReceiptGrid(batch) {
  const batchId = String(batch?.id || '');
  const batchDay = /^\d{4}-\d{2}-\d{2}/.test(String(batch?.dateKey || '')) ? String(batch.dateKey).slice(0, 10) : '';
  const stores = [];
  const expected = {};
  const dayKeys = new Set();
  let totalExpected = 0;

  for (const store of Array.isArray(batch?.stores) ? batch.stores : []) {
    const key = batchStoreKey(store);
    if (!key) continue;
    stores.push({ key, id: store.id, name: String(store?.name || key) });
    for (const row of store?.meltPos || []) {
      if (isBullionOnly(row)) continue;
      const day = poDateKey(row) || batchDay;
      if (!day) continue;
      dayKeys.add(day);
      const cell = dailyCellKey(day, key);
      expected[cell] = (expected[cell] || 0) + 1;
      totalExpected += 1;
    }
  }
  stores.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

  let days = [];
  if (dayKeys.size === 0) {
    days = batchDay ? [batchDay] : [];
  } else {
    const sorted = [...dayKeys].sort();
    const first = sorted[0];
    const last = batchDay && batchDay > sorted[sorted.length - 1] ? batchDay : sorted[sorted.length - 1];
    days = contiguousDays(first, last) || sorted;
  }

  return {
    batchId,
    days: days.map((key) => ({ key, ...dayLabel(key) })),
    stores,
    expected,
    totalExpected,
  };
}

function receivedOf(entry) {
  const value = entry?.received;
  if (value == null || value === '') return null;
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Roll the saved receipts up against the grid.
 * Only store-days where the store logged at least one PO / SO need checking;
 * a cell is checked once someone typed a received count for it. Counts typed
 * into an empty store-day still add to the received total.
 */
export function summarizeDailyReceipts(grid, receipts) {
  const days = grid?.days || [];
  const stores = grid?.stores || [];
  const expectedMap = grid?.expected || {};
  let gridCells = 0;
  let cells = 0;
  let checked = 0;
  let totalExpected = 0;
  let totalReceived = 0;
  let short = 0;
  let over = 0;
  let allReceived = true;

  for (const day of days) {
    for (const store of stores) {
      const cell = dailyCellKey(day.key, store.key);
      const expected = expectedMap[cell] || 0;
      const received = receivedOf(receipts?.[cell]);
      gridCells += 1;
      totalExpected += expected;
      if (expected > 0) cells += 1;
      if (received != null) {
        if (expected > 0) checked += 1;
        totalReceived += received;
        if (received < expected) {
          allReceived = false;
          short += expected - received;
        } else if (received > expected) {
          over += received - expected;
        }
      } else if (expected > 0) {
        allReceived = false;
      }
    }
  }

  const allChecked = cells > 0 && checked === cells;
  return {
    gridCells,
    cells,
    checked,
    allChecked,
    allReceived: allChecked && allReceived,
    totalExpected,
    totalReceived,
    short,
    over,
  };
}

/** Human label for the batch chrome. */
export function dailyReceiptStatus(summary) {
  if (!summary || summary.gridCells === 0) return { label: 'Daily check', value: '—', tone: undefined };
  if (summary.cells === 0) return { label: 'Daily check', value: 'Nothing expected', tone: undefined };
  if (summary.allChecked) {
    if (summary.allReceived) {
      return { label: 'Daily check', value: 'All received', tone: 'green' };
    }
    const detail = summary.short ? ` · ${summary.short} short` : summary.over ? ` · ${summary.over} extra` : '';
    return { label: 'Daily check', value: `Not all received${detail}`, tone: 'red' };
  }
  if (summary.checked === 0) return { label: 'Daily check', value: 'Not checked', tone: 'orange' };
  return { label: 'Daily check', value: `${summary.checked}/${summary.cells} checked`, tone: 'orange' };
}

function mapRow(row) {
  return {
    dateKey: String(row.date_key || '').slice(0, 10),
    storeKey: String(row.store_key || ''),
    storeName: String(row.store_name || ''),
    expected: Math.max(0, Math.round(Number(row.expected) || 0)),
    received: receivedOf(row),
    updatedAt: row.updated_at || null,
    updatedByName: String(row.updated_by_name || ''),
  };
}

export async function listDailyReceipts(batchId) {
  const id = String(batchId || '');
  if (!id) return {};
  const { data, error } = await getSupabase()
    .from('triage_daily_receipts')
    .select('batch_id, date_key, store_key, store_name, expected, received, updated_at, updated_by_name')
    .eq('batch_id', id);
  if (error) throwQueryError(error, 'load the daily check');
  const out = {};
  for (const row of data || []) {
    const mapped = mapRow(row);
    if (!mapped.dateKey || !mapped.storeKey) continue;
    out[dailyCellKey(mapped.dateKey, mapped.storeKey)] = mapped;
  }
  return out;
}

function namesMatch(a, b) {
  return (
    String(a || '')
      .trim()
      .localeCompare(String(b || '').trim(), undefined, { sensitivity: 'base' }) === 0
  );
}

function purchaseInBatch(batch, po) {
  const poId = String(po?.id || '');
  const sourceId = po?.sourceId != null ? String(po.sourceId) : '';
  const systemKey = po?.systemKey || 'east';
  for (const store of batch?.stores || []) {
    const item = (store.meltPos || []).find((entry) => {
      if (poId && entry.id === poId) return true;
      return sourceId && String(entry.sourceId) === sourceId && (entry.systemKey || 'east') === systemKey;
    });
    if (item) return { batch, store, item };
  }
  return null;
}

/**
 * Batch and store this physical PO belongs to.
 * Prefer the batch that already lists it, then the open batch, then any date
 * batch whose store name matches.
 */
export function placePurchaseOnBatch(triage, po, preferredBatchId = '') {
  const list = Array.isArray(triage) ? triage : [];
  const located = [];
  for (const batch of list) {
    const hit = purchaseInBatch(batch, po);
    if (hit) located.push(hit);
  }
  const onDateBatch = located.find((row) => row.batch?.kind !== 'po');
  if (onDateBatch) return onDateBatch;
  if (located[0]) return located[0];

  const day = poDateKey(po);
  const storeName = String(po?.storeName || '').trim();
  if (!storeName || storeName === '—') return null;
  const candidates = [];
  for (const batch of list) {
    if (batch?.kind === 'po') continue;
    const store = (batch.stores || []).find(
      (entry) => namesMatch(entry.name, storeName) || namesMatch(entry.storeKey, storeName),
    );
    if (!store) continue;
    const grid = buildDailyReceiptGrid(batch);
    const covers = Boolean(day && grid.days.some((entry) => entry.key === day));
    candidates.push({
      batch,
      store,
      item: null,
      covers,
      preferred: Boolean(preferredBatchId && batch.id === preferredBatchId),
    });
  }
  candidates.sort(
    (a, b) =>
      Number(b.preferred) - Number(a.preferred) ||
      Number(b.covers) - Number(a.covers) ||
      String(b.batch.dateKey || '').localeCompare(String(a.batch.dateKey || '')),
  );
  if (!candidates[0]) return null;
  return { batch: candidates[0].batch, store: candidates[0].store, item: null };
}

/**
 * Count one finished PO toward that store and date. The same PO is only
 * counted once. Returns the new received total for the cell.
 */
export async function countDailyReceiptPo(batchId, entry, actor) {
  const id = String(batchId || '');
  const poId = String(entry?.poId || '');
  const dayKey = String(entry?.dayKey || '').slice(0, 10);
  const storeKey = String(entry?.storeKey || '');
  if (!id || !poId || !dayKey || !storeKey) throw new Error('This PO has no store or date to count.');

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('triage_daily_receipts')
    .select('received, counted_po_ids')
    .eq('batch_id', id)
    .eq('date_key', dayKey)
    .eq('store_key', storeKey)
    .maybeSingle();
  if (error) throwQueryError(error, 'load the daily check');

  const ids = Array.isArray(data?.counted_po_ids) ? data.counted_po_ids.map(String) : [];
  const previous = receivedOf(data);
  if (ids.includes(poId)) return { counted: false, received: previous ?? 0 };

  const { data: authData } = await supabase.auth.getSession();
  const received = (previous ?? 0) + 1;
  const { error: writeError } = await supabase.from('triage_daily_receipts').upsert(
    {
      batch_id: id,
      date_key: dayKey,
      store_key: storeKey,
      store_name: String(entry.storeName || ''),
      expected: Math.max(0, Math.round(Number(entry.expected) || 0)),
      received,
      counted_po_ids: [...ids, poId],
      updated_at: new Date().toISOString(),
      updated_by: authData?.session?.user?.id || null,
      updated_by_name: String(actor || ''),
    },
    { onConflict: 'batch_id,date_key,store_key' },
  );
  if (writeError) throwQueryError(writeError, 'save the daily check');
  return { counted: true, received };
}

/**
 * Upsert the given cells. `entries` is a list of
 * `{ dayKey, storeKey, storeName, expected, received }`; `received` may be
 * null to clear a count.
 */
export async function saveDailyReceipts(batchId, entries, actor) {
  const id = String(batchId || '');
  const list = Array.isArray(entries) ? entries : [];
  if (!id || list.length === 0) return;
  const supabase = getSupabase();
  const { data: authData } = await supabase.auth.getSession();
  const actorId = authData?.session?.user?.id || null;
  const now = new Date().toISOString();
  const rows = list
    .filter((entry) => entry?.dayKey && entry?.storeKey)
    .map((entry) => ({
      batch_id: id,
      date_key: String(entry.dayKey).slice(0, 10),
      store_key: String(entry.storeKey),
      store_name: String(entry.storeName || ''),
      expected: Math.max(0, Math.round(Number(entry.expected) || 0)),
      received: receivedOf(entry),
      updated_at: now,
      updated_by: actorId,
      updated_by_name: String(actor || ''),
    }));
  if (rows.length === 0) return;
  const { error } = await supabase
    .from('triage_daily_receipts')
    .upsert(rows, { onConflict: 'batch_id,date_key,store_key' });
  if (error) throwQueryError(error, 'save the daily check');
}

export function subscribeDailyReceipts(batchId, onChange) {
  const id = String(batchId || '');
  if (!id || typeof onChange !== 'function') return () => {};
  let supabase;
  try {
    supabase = getSupabase();
  } catch {
    return () => {};
  }
  const channel = supabase
    .channel(`triage-daily-${id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'triage_daily_receipts', filter: `batch_id=eq.${id}` },
      () => onChange(),
    )
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}

/** Load + live-follow the saved receipts for one batch. */
export function useDailyReceipts(batchId, enabled = true) {
  const id = String(batchId || '');
  const [receipts, setReceipts] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const alive = useRef(true);

  const reload = useCallback(async () => {
    if (!id || !enabled) {
      setReceipts({});
      setError('');
      return;
    }
    setLoading(true);
    try {
      const next = await listDailyReceipts(id);
      if (!alive.current) return;
      setReceipts(next);
      setError('');
    } catch (err) {
      if (!alive.current) return;
      setError(err?.message || 'Could not load the daily check.');
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [enabled, id]);

  useEffect(() => {
    alive.current = true;
    setReceipts({});
    reload();
    const unsubscribe = id && enabled ? subscribeDailyReceipts(id, reload) : () => {};
    return () => {
      alive.current = false;
      unsubscribe();
    };
  }, [enabled, id, reload]);

  return { receipts, loading, error, reload };
}
