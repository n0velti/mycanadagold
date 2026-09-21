import { useEffect, useState } from 'react';
import {
  PRICE_TOLERANCE,
  normalizePriceTolerance,
  snapshotPriceCatalog,
} from './priceCheck';
import { getSupabase } from './supabase';
import { fetchWebsitePrices } from './websitePrices';

const SETTINGS_TABLE = 'price_check_settings';
const SNAPSHOT_TABLE = 'website_price_snapshots';
const CHECK_TABLE = 'transaction_price_checks';

/** @type {number} */
let cachedTolerance = PRICE_TOLERANCE;
const toleranceListeners = new Set();

/** @type {Map<string, object>} */
const memorySnapshots = new Map();
/** @type {Map<string, Promise<object | null>>} */
const capturing = new Map();

function isMissingRelation(error, table) {
  const code = String(error?.code || '');
  const message = String(error?.message || '');
  if (code === '42P01' || code === 'PGRST205') return true;
  return /schema cache/i.test(message) && String(table || '').length > 0 && message.includes(table);
}

function isPermissionError(error) {
  const code = String(error?.code || '');
  const message = String(error?.message || '');
  return code === '42501' || code === 'PGRST301' || /permission denied|row-level security/i.test(message);
}

function describeSettingsError(error, action = 'load') {
  if (!error) return `Could not ${action} price-check settings.`;
  if (isMissingRelation(error, SETTINGS_TABLE)) {
    return 'Run the price-check SQL in Supabase, including the schema reload line, then refresh.';
  }
  if (error.code === 'NO_SESSION') return error.message;
  if (isPermissionError(error)) {
    return action === 'save'
      ? 'Only a System Admin or General Manager can change the price-check tolerance.'
      : 'No permission to load price-check settings. Sign out and sign in again, then retry.';
  }
  return error.message || `Could not ${action} price-check settings.`;
}

async function requireClient() {
  const supabase = getSupabase();
  const { data } = await supabase.auth.getSession();
  if (!data?.session?.user?.id) {
    const error = new Error('Sign out and sign in again so price-check settings can load.');
    error.code = 'NO_SESSION';
    throw error;
  }
  return supabase;
}

function emitTolerance(next) {
  cachedTolerance = next;
  for (const listener of toleranceListeners) listener(next);
}

export function getCachedPriceCheckTolerance() {
  return cachedTolerance;
}

export function subscribePriceCheckTolerance(listener) {
  toleranceListeners.add(listener);
  listener(cachedTolerance);
  return () => toleranceListeners.delete(listener);
}

export function usePriceCheckTolerance() {
  const [tolerance, setTolerance] = useState(cachedTolerance);
  useEffect(() => subscribePriceCheckTolerance(setTolerance), []);
  useEffect(() => {
    loadPriceCheckSettings().catch(() => {});
  }, []);
  return tolerance;
}

export async function loadPriceCheckSettings() {
  try {
    const supabase = await requireClient();
    const { data, error } = await supabase
      .from(SETTINGS_TABLE)
      .select('tolerance')
      .eq('id', 1)
      .maybeSingle();
    if (error) throw error;
    const next = normalizePriceTolerance(data?.tolerance, cachedTolerance);
    emitTolerance(next);
    return { tolerance: next, unavailable: false };
  } catch (error) {
    if (isMissingRelation(error, SETTINGS_TABLE)) {
      return { tolerance: cachedTolerance, unavailable: true };
    }
    throw new Error(describeSettingsError(error, 'load'));
  }
}

export async function savePriceCheckSettings(tolerance, userId) {
  const next = normalizePriceTolerance(tolerance);
  const supabase = await requireClient();
  const { data: authData } = await supabase.auth.getSession();
  const actorId = authData?.session?.user?.id || userId || null;
  const { data, error } = await supabase
    .from(SETTINGS_TABLE)
    .upsert(
      {
        id: 1,
        tolerance: next,
        updated_at: new Date().toISOString(),
        updated_by: actorId,
      },
      { onConflict: 'id' },
    )
    .select('tolerance')
    .maybeSingle();
  if (error) throw new Error(describeSettingsError(error, 'save'));
  const saved = normalizePriceTolerance(data?.tolerance, next);
  emitTolerance(saved);
  return { tolerance: saved, unavailable: false };
}

function rememberSnapshot(transactionId, snapshot) {
  if (!transactionId || !snapshot) return snapshot;
  memorySnapshots.set(String(transactionId), snapshot);
  return snapshot;
}

export function peekPriceCatalogSnapshot(transactionId) {
  const id = String(transactionId || '');
  return id ? memorySnapshots.get(id) || null : null;
}

export async function loadTransactionPriceSnapshots(transactionIds) {
  const ids = [...new Set((transactionIds || []).map((id) => String(id || '')).filter(Boolean))];
  const found = new Map();
  const missing = [];
  for (const id of ids) {
    const cached = memorySnapshots.get(id);
    if (cached) found.set(id, cached);
    else missing.push(id);
  }
  if (!missing.length) return found;

  try {
    const supabase = await requireClient();
    const { data, error } = await supabase
      .from(CHECK_TABLE)
      .select('transaction_id, catalog_updated')
      .in('transaction_id', missing);
    if (error) throw error;
    const keys = [...new Set((data || []).map((row) => row.catalog_updated).filter(Boolean))];
    if (!keys.length) return found;

    const { data: catalogs, error: catalogError } = await supabase
      .from(SNAPSHOT_TABLE)
      .select('catalog_updated, fetched_at, catalog')
      .in('catalog_updated', keys);
    if (catalogError) throw catalogError;

    const byKey = new Map();
    for (const row of catalogs || []) {
      const snapshot = snapshotPriceCatalog(row?.catalog);
      if (snapshot) byKey.set(row.catalog_updated, snapshot);
    }
    for (const row of data || []) {
      const snapshot = byKey.get(row.catalog_updated);
      if (!snapshot) continue;
      rememberSnapshot(row.transaction_id, snapshot);
      found.set(String(row.transaction_id), snapshot);
    }
  } catch (error) {
    if (!isMissingRelation(error, CHECK_TABLE) && !isMissingRelation(error, SNAPSHOT_TABLE)) {
      // Keep whatever we already have in memory.
    }
  }
  return found;
}

async function persistSnapshot(transactionId, snapshot) {
  const key = snapshot?.key;
  if (!key) return;
  try {
    const supabase = await requireClient();
    const { error: snapError } = await supabase.from(SNAPSHOT_TABLE).upsert(
      {
        catalog_updated: key,
        fetched_at: snapshot.fetchedAt || new Date().toISOString(),
        catalog: snapshot,
      },
      { onConflict: 'catalog_updated' },
    );
    if (snapError) return;
    await supabase.from(CHECK_TABLE).upsert(
      {
        transaction_id: String(transactionId),
        catalog_updated: key,
        checked_at: new Date().toISOString(),
      },
      { onConflict: 'transaction_id', ignoreDuplicates: true },
    );
  } catch {
    // In-memory freeze still holds for this session.
  }
}

/**
 * Website prices at the moment this transaction's line items arrived from
 * Aureus. Existing snapshots are never overwritten.
 */
export async function capturePurchasePriceCatalog(row) {
  const id = String(row?.id || '');
  if (!id) return null;
  const cached = memorySnapshots.get(id);
  if (cached) return cached;
  if (capturing.has(id)) return capturing.get(id);

  const work = (async () => {
    const loaded = await loadTransactionPriceSnapshots([id]);
    const stored = loaded.get(id);
    if (stored) return stored;
    const lines = Array.isArray(row?.pricedLines) ? row.pricedLines : [];
    if (!lines.length) return null;
    const live = await fetchWebsitePrices();
    const snapshot = snapshotPriceCatalog(live);
    if (!snapshot) return null;
    rememberSnapshot(id, snapshot);
    persistSnapshot(id, snapshot);
    return snapshot;
  })();

  capturing.set(id, work);
  try {
    return await work;
  } finally {
    capturing.delete(id);
  }
}
