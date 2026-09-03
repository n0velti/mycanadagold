import { API_BASE_URL, getLinkedPosSessions } from './auth';
import { fetchPosLocations } from './locations';
import {
  fetchTransactionDetail,
  fetchTransactions,
  formatDateParam,
  parseDateParam,
} from './transactions';

const DETAIL_CONCURRENCY = 36;
const PARTIAL_EVERY = 20;
const LIST_CACHE_TTL_MS = 3 * 60 * 1000;
const DETAIL_CACHE_TTL_MS = 30 * 60 * 1000;
const GRAMS_PER_TROY_OZ = 31.1034768;

export const METALS = ['Gold', 'Silver', 'Platinum', 'Palladium'];

export const METAL_COLORS = {
  Gold: '#D4A017',
  Silver: '#7A8494',
  Platinum: '#2F6FED',
  Palladium: '#8B3A9C',
};

/** @type {Map<string, { expires: number, rows: object[], storeNames: string[], warning: string }>} */
const listCache = new Map();

/**
 * Per-transaction pure-metal contribution. Survives store filter changes.
 * @type {Map<string, { expires: number, date: string, storeName: string, type: string, sold: object, bought: object }>}
 */
const detailCache = new Map();

/** @type {Map<string, { expires: number, names: string[] }>} */
const storeListCache = new Map();

function posSystemsFromSession(session) {
  const systems = [];
  if (session?.token) {
    systems.push({
      key: 'east',
      label: 'Canada Gold East',
      baseUrl: session.baseUrl || API_BASE_URL,
      token: session.token,
    });
  }
  for (const linked of getLinkedPosSessions(session)) {
    if (!linked?.token) continue;
    systems.push({
      key: linked.key,
      label: linked.label,
      baseUrl: linked.baseUrl,
      token: linked.token,
    });
  }
  return systems;
}

function systemsCacheId(systems) {
  return systems.map((s) => `${s.key}:${String(s.token || '').slice(0, 12)}`).join('|');
}

function listCacheKey(systems, startDate, endDate) {
  return `${startDate}|${endDate}|${systemsCacheId(systems)}`;
}

function detailCacheKey(row) {
  return `${row.systemKey || 'east'}|${row.type}|${row.sourceId}|${row.baseUrl || ''}`;
}

async function mapPool(items, limit, mapper) {
  const results = new Array(items.length);
  let next = 0;

  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await mapper(items[index], index);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length || 1) }, () => worker());
  await Promise.all(workers);
  return results;
}

function toNumber(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const cleaned = String(value).replace(/,/g, '').trim();
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function dateKeyFromTx(value) {
  if (!value) return null;
  const match = String(value).match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) return match[1];
  const date = new Date(String(value).replace(' ', 'T'));
  if (Number.isNaN(date.getTime())) return null;
  return formatDateParam(date);
}

function eachDateKey(startDate, endDate) {
  const keys = [];
  const cursor = parseDateParam(startDate);
  const end = parseDateParam(endDate);
  while (cursor <= end) {
    keys.push(formatDateParam(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return keys;
}

function emptyMetalTotals() {
  return { Gold: 0, Silver: 0, Platinum: 0, Palladium: 0 };
}

function emptyDay(date) {
  return {
    date,
    sold: emptyMetalTotals(),
    bought: emptyMetalTotals(),
  };
}

function cloneMetals(bucket) {
  return { ...emptyMetalTotals(), ...bucket };
}

function lineSearchText(item) {
  const product = item?.product || item?.inventory_product || {};
  return [
    item?.description,
    product?.name,
    product?.description,
    item?.quality_mark_description,
    product?.sku,
    product?.code,
    product?.type,
    typeof product?.metal === 'string' ? product.metal : product?.metal?.name,
    item?.metal,
  ]
    .map((value) => (value == null ? '' : String(value).trim()))
    .filter(Boolean)
    .join(' ');
}

export function resolveMetal(item) {
  const product = item?.product || item?.inventory_product || {};
  const raw =
    (typeof product?.metal === 'string' ? product.metal : product?.metal?.name) ||
    item?.metal?.name ||
    item?.metal ||
    '';
  const fromField = String(raw || '').trim().toLowerCase();
  if (fromField.includes('palladium') || fromField === 'pd') return 'Palladium';
  if (fromField.includes('platinum') || fromField === 'pt') return 'Platinum';
  if (fromField.includes('silver') || fromField === 'ag') return 'Silver';
  if (fromField.includes('gold') || fromField === 'au') return 'Gold';

  const text = lineSearchText(item).toLowerCase();
  if (/\bpalladium\b|\bpd\b/.test(text)) return 'Palladium';
  if (/\bplatinum\b|\bpt\b/.test(text)) return 'Platinum';
  if (/\bsilver\b|\bag\b/.test(text)) return 'Silver';
  if (/\bgold\b|\bau\b|\b\d+\s*k\b|\bkarat/.test(text)) return 'Gold';
  return null;
}

/** Fraction 0–1 from karat mark (14k → 14/24). */
export function karatFractionFromText(text) {
  const value = String(text || '');
  const match = value.match(/\b(\d{1,2})\s*[-]?\s*k(?:arat)?s?\b/i);
  if (!match) return null;
  const karat = Number(match[1]);
  if (!Number.isFinite(karat) || karat <= 0 || karat > 24) return null;
  return karat / 24;
}

/** Fraction 0–1 from purity field or marks like .999 / 99.9%. */
export function purityFraction(item) {
  const direct = toNumber(item?.purity ?? item?.purity_percent ?? item?.fineness);
  if (direct != null) {
    if (direct > 1.5) return Math.min(direct / 100, 1);
    if (direct > 0) return Math.min(direct, 1);
  }

  const text = lineSearchText(item);
  const karat = karatFractionFromText(text);
  if (karat != null) return karat;

  const decimal = text.match(/(?:^|[^\d])\.(9{2,4}\d*)\b/);
  if (decimal) {
    const n = Number(`0.${decimal[1]}`);
    if (Number.isFinite(n) && n > 0 && n <= 1) return n;
  }

  const percent = text.match(/\b(\d{1,3}(?:\.\d+)?)\s*%/);
  if (percent) {
    const n = Number(percent[1]);
    if (Number.isFinite(n) && n > 0 && n <= 100) return n / 100;
  }

  const product = item?.product || {};
  const type = String(product?.type || '').toLowerCase();
  if (type === 'bullion' || type === 'refined' || type === 'coin' || type === 'bar') {
    return 1;
  }

  return null;
}

function gramsFromUnit(amount, unit) {
  if (amount == null || !Number.isFinite(amount)) return null;
  const u = String(unit || '')
    .trim()
    .toLowerCase()
    .replace(/\./g, '');
  if (!u || u === 'g' || u === 'gram' || u === 'grams' || u === 'gm') return amount;
  if (u === 'kg' || u === 'kilogram' || u === 'kilograms') return amount * 1000;
  if (
    u === 'oz' ||
    u === 'ozt' ||
    u === 'troy' ||
    u === 'troyoz' ||
    u === 'troyounce' ||
    u === 'troyounces' ||
    u === 'ounce' ||
    u === 'ounces'
  ) {
    return amount * GRAMS_PER_TROY_OZ;
  }
  if (u === 'dwt' || u === 'pennyweight' || u === 'pennyweights') {
    return amount * (GRAMS_PER_TROY_OZ / 20);
  }
  if (u === 'lb' || u === 'lbs' || u === 'pound' || u === 'pounds') {
    return amount * 453.59237;
  }
  if (
    u === 'pcs' ||
    u === 'pc' ||
    u === 'ea' ||
    u === 'each' ||
    u === 'unit' ||
    u === 'units' ||
    u === 'item' ||
    u === 'items'
  ) {
    return null;
  }
  return amount;
}

function weightFromProductText(text) {
  const value = String(text || '');
  const fractionOz = value.match(/\b(\d+)\s*\/\s*(\d+)\s*(?:oz|ozt|troy)\b/i);
  if (fractionOz) {
    const num = Number(fractionOz[1]);
    const den = Number(fractionOz[2]);
    if (den > 0) return { grams: (num / den) * GRAMS_PER_TROY_OZ, unit: 'oz' };
  }
  const oz = value.match(/\b(\d+(?:\.\d+)?)\s*(?:oz|ozt|troy\s*oz)\b/i);
  if (oz) return { grams: Number(oz[1]) * GRAMS_PER_TROY_OZ, unit: 'oz' };
  const grams = value.match(/\b(\d+(?:\.\d+)?)\s*(?:g|gram|grams)\b/i);
  if (grams) return { grams: Number(grams[1]), unit: 'g' };
  const kg = value.match(/\b(\d+(?:\.\d+)?)\s*kg\b/i);
  if (kg) return { grams: Number(kg[1]) * 1000, unit: 'kg' };
  return null;
}

/**
 * Pure metal grams for one line item.
 * Prefers pure_weight; otherwise gross × purity (karat / % for jewelry).
 */
export function pureGramsFromLineItem(item) {
  const metal = resolveMetal(item);
  if (!metal) return null;

  const pureDirect = toNumber(
    item?.pure_weight ?? item?.fine_weight ?? item?.pure_quantity ?? item?.fine_quantity,
  );
  if (pureDirect != null && pureDirect > 0) {
    const unit = item?.unit_type || item?.unit || item?.weight_unit || 'g';
    const asGrams = gramsFromUnit(pureDirect, unit);
    if (asGrams != null && asGrams > 0) {
      return { metal, grams: asGrams, source: 'pure_weight' };
    }
  }

  const qty = toNumber(
    item?.quantity ?? item?.gross_quantity ?? item?.weight ?? item?.qty,
  );
  const unit = item?.unit_type || item?.unit || item?.weight_unit || '';
  let grossGrams = gramsFromUnit(qty, unit);

  if (grossGrams == null || grossGrams <= 0) {
    const fromName = weightFromProductText(lineSearchText(item));
    if (fromName && qty != null && qty > 0) {
      grossGrams = fromName.grams * qty;
    } else if (fromName && (qty == null || qty === 0)) {
      grossGrams = fromName.grams;
    }
  }

  if (grossGrams == null || grossGrams <= 0) return null;

  const fraction = purityFraction(item);
  if (fraction == null) return null;

  const pureGrams = grossGrams * fraction;
  if (!(pureGrams > 0)) return null;

  return {
    metal,
    grams: pureGrams,
    source: 'gross_x_purity',
    purity: fraction,
  };
}

function addMetal(bucket, metal, grams) {
  if (!metal || !(grams > 0)) return;
  bucket[metal] = (bucket[metal] || 0) + grams;
}

function sumMetals(bucket) {
  return METALS.reduce((sum, metal) => sum + (Number(bucket[metal]) || 0), 0);
}

function metalsFromItems(items) {
  const bucket = emptyMetalTotals();
  for (const item of items) {
    const pure = pureGramsFromLineItem(item);
    if (!pure) continue;
    addMetal(bucket, pure.metal, pure.grams);
  }
  return bucket;
}

function contributionFromDetail(row, detail) {
  const items = Array.isArray(detail?.items)
    ? detail.items
    : Array.isArray(row?.items)
      ? row.items
      : [];
  const dayKey = dateKeyFromTx(detail?.date || row.date);
  const storeName =
    String(detail?.location_name || detail?.location?.name || row.storeName || '').trim() || '—';
  const metals = metalsFromItems(items);
  const sold = row.type === 'order' ? metals : emptyMetalTotals();
  const bought = row.type === 'purchase' ? metals : emptyMetalTotals();
  return {
    date: dayKey,
    storeName,
    type: row.type,
    sold,
    bought,
  };
}

function getCachedDetail(row) {
  const key = detailCacheKey(row);
  const cached = detailCache.get(key);
  if (!cached) return null;
  if (cached.expires <= Date.now()) {
    detailCache.delete(key);
    return null;
  }
  return cached;
}

function putCachedDetail(row, contribution) {
  detailCache.set(detailCacheKey(row), {
    ...contribution,
    expires: Date.now() + DETAIL_CACHE_TTL_MS,
  });
}

function storeMatches(name, storeName) {
  if (!storeName) return true;
  return (
    String(name || '')
      .trim()
      .localeCompare(String(storeName).trim(), undefined, { sensitivity: 'base' }) === 0
  );
}

function buildResult(contributions, { startDate, endDate, warning, scanned, total, storeNames }) {
  const byDate = new Map(eachDateKey(startDate, endDate).map((date) => [date, emptyDay(date)]));

  for (const entry of contributions) {
    if (!entry?.date || !byDate.has(entry.date)) continue;
    const day = byDate.get(entry.date);
    for (const metal of METALS) {
      day.sold[metal] += Number(entry.sold?.[metal]) || 0;
      day.bought[metal] += Number(entry.bought?.[metal]) || 0;
    }
  }

  const days = Array.from(byDate.values()).map((day) => ({
    date: day.date,
    sold: cloneMetals(day.sold),
    bought: cloneMetals(day.bought),
    soldTotal: sumMetals(day.sold),
    boughtTotal: sumMetals(day.bought),
  }));

  const totals = days.reduce(
    (acc, day) => {
      for (const metal of METALS) {
        acc.sold[metal] += day.sold[metal] || 0;
        acc.bought[metal] += day.bought[metal] || 0;
      }
      return acc;
    },
    { sold: emptyMetalTotals(), bought: emptyMetalTotals() },
  );

  return {
    days,
    totals: {
      sold: totals.sold,
      bought: totals.bought,
      soldTotal: sumMetals(totals.sold),
      boughtTotal: sumMetals(totals.bought),
    },
    storeNames: storeNames || [],
    startDate,
    endDate,
    warning,
    scanned,
    total,
    unit: 'g',
  };
}

async function loadStoreNames(systems) {
  const key = systemsCacheId(systems);
  const cached = storeListCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.names;

  const groups = await Promise.all(
    systems.map(async (system) => {
      try {
        const locations = await fetchPosLocations(system.baseUrl, system.token);
        return locations
          .filter((location) => {
            if (location.selling_location === 'No' || location.selling_location === false) {
              return false;
            }
            return true;
          })
          .map((location) => String(location.name || '').trim())
          .filter(Boolean);
      } catch {
        return [];
      }
    }),
  );

  const names = Array.from(new Set(groups.flat())).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: 'base' }),
  );
  storeListCache.set(key, { expires: Date.now() + LIST_CACHE_TTL_MS, names });
  return names;
}

async function loadTransactionRows(systems, startDate, endDate) {
  const key = listCacheKey(systems, startDate, endDate);
  const cached = listCache.get(key);
  if (cached && cached.expires > Date.now()) {
    return { rows: cached.rows, storeNames: cached.storeNames, warning: cached.warning };
  }

  const txResults = await Promise.all(
    systems.map(async (system) => {
      try {
        const result = await fetchTransactions(system.token, {
          startDate,
          endDate,
          baseUrl: system.baseUrl,
          includePurchases: true,
          system,
        });
        return {
          rows: result.rows.map((row) => ({
            ...row,
            systemKey: system.key,
            systemLabel: system.label,
            baseUrl: system.baseUrl,
            token: system.token,
          })),
          error: '',
        };
      } catch (error) {
        return {
          rows: [],
          error: error?.message || `Failed to load transactions (${system.label}).`,
        };
      }
    }),
  );

  const rows = txResults.flatMap((result) => result.rows);
  const warning = txResults.map((result) => result.error).filter(Boolean).join(' ');
  const storeNames = Array.from(
    new Set(
      rows
        .map((row) => String(row.storeName || '').trim())
        .filter((name) => name && name !== '—'),
    ),
  ).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

  listCache.set(key, {
    expires: Date.now() + LIST_CACHE_TTL_MS,
    rows,
    storeNames,
    warning,
  });

  return { rows, storeNames, warning };
}

async function fetchDetailOnce(row) {
  try {
    const detail = await fetchTransactionDetail(row.token, {
      type: row.type,
      sourceId: row.sourceId,
      baseUrl: row.baseUrl,
    });
    return contributionFromDetail(row, detail);
  } catch {
    // One retry for transient failures — keeps totals accurate.
    try {
      const detail = await fetchTransactionDetail(row.token, {
        type: row.type,
        sourceId: row.sourceId,
        baseUrl: row.baseUrl,
      });
      return contributionFromDetail(row, detail);
    } catch {
      return {
        date: dateKeyFromTx(row.date),
        storeName: String(row.storeName || '').trim() || '—',
        type: row.type,
        sold: emptyMetalTotals(),
        bought: emptyMetalTotals(),
        failed: true,
      };
    }
  }
}

/**
 * Daily pure-metal sold (orders) and bought (purchases, incl. jewelry → pure).
 * Values are grams of fine metal.
 *
 * Speeds:
 * - Persistent per-tx detail cache (store filter switches are instant)
 * - Only fetch details missing from cache / for selected store
 * - High concurrency + progressive partial updates
 */
export async function fetchMetalTrends(
  session,
  { startDate, endDate, storeName, onProgress, onPartial, bypassCache = false } = {},
) {
  const systems = posSystemsFromSession(session);
  if (systems.length === 0) {
    throw new Error('No POS sessions available. Log in again to load metal trends.');
  }

  if (bypassCache) {
    const listKey = listCacheKey(systems, startDate, endDate);
    listCache.delete(listKey);
  }

  const [locationNames, list] = await Promise.all([
    loadStoreNames(systems),
    loadTransactionRows(systems, startDate, endDate),
  ]);

  const storeNames = Array.from(new Set([...locationNames, ...list.storeNames])).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: 'base' }),
  );

  const targetRows = storeName
    ? list.rows.filter((row) => storeMatches(row.storeName, storeName))
    : list.rows;

  const cachedContributions = [];
  const missing = [];

  for (const row of targetRows) {
    if (!bypassCache) {
      const cached = getCachedDetail(row);
      if (cached) {
        cachedContributions.push(cached);
        continue;
      }
    }
    // List payloads occasionally embed items — use them and skip a round trip.
    if (Array.isArray(row.items) && row.items.length > 0) {
      const contribution = contributionFromDetail(row, row);
      putCachedDetail(row, contribution);
      cachedContributions.push(contribution);
      continue;
    }
    missing.push(row);
  }

  let scanned = cachedContributions.length;
  const total = targetRows.length;
  const warning = list.warning;

  // targetRows are already store-filtered; do not drop on detail location rename quirks.
  const collectMerged = () => targetRows.map((row) => getCachedDetail(row)).filter(Boolean);

  const emit = () => {
    if (typeof onPartial !== 'function') return;
    onPartial(
      buildResult(collectMerged(), {
        startDate,
        endDate,
        warning,
        scanned,
        total,
        storeNames,
      }),
    );
  };

  if (typeof onProgress === 'function') {
    onProgress({ scanned, total, pending: missing.length });
  }
  emit();

  if (missing.length === 0) {
    return buildResult(collectMerged(), {
      startDate,
      endDate,
      warning,
      scanned: total,
      total,
      storeNames,
    });
  }

  await mapPool(missing, DETAIL_CONCURRENCY, async (row) => {
    const contribution = await fetchDetailOnce(row);
    putCachedDetail(row, contribution);
    scanned += 1;
    if (typeof onProgress === 'function') {
      onProgress({ scanned, total, pending: Math.max(total - scanned, 0) });
    }
    if (scanned === total || scanned % PARTIAL_EVERY === 0) {
      emit();
    }
  });

  return buildResult(collectMerged(), {
    startDate,
    endDate,
    warning,
    scanned: total,
    total,
    storeNames,
  });
}

export function clearMetalTrendsCache() {
  listCache.clear();
  detailCache.clear();
  storeListCache.clear();
}

export function formatPureGrams(grams, { digits = 2 } = {}) {
  const n = Number(grams) || 0;
  if (Math.abs(n) >= 1000) return `${n.toFixed(0)} g`;
  if (Math.abs(n) >= 100) return `${n.toFixed(1)} g`;
  return `${n.toFixed(digits)} g`;
}
