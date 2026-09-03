import { API_BASE_URL, getLinkedPosSessions } from './auth';
import { fetchPosLocations } from './locations';
import {
  fetchTransactionDetail,
  fetchTransactions,
} from './transactions';

/** Parallel purchase-detail fetches. Higher = faster; keep below browser connection limits. */
const DETAIL_CONCURRENCY = 20;
const PREMIUM_RE = /\bpremium\b/i;
const CACHE_TTL_MS = 5 * 60 * 1000;
const PARTIAL_EVERY = 8;

/** @type {Map<string, { expires: number, value: object }>} */
const resultCache = new Map();

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

function cacheKey(systems, startDate, endDate) {
  const ids = systems.map((s) => `${s.key}:${String(s.token || '').slice(0, 12)}`).join('|');
  return `${startDate}|${endDate}|${ids}`;
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

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

export function lineItemText(item) {
  const product = item?.product;
  return [
    item?.description,
    product?.name,
    product?.description,
    item?.quality_mark_description,
    product?.sku,
    product?.code,
  ]
    .map((value) => (value == null ? '' : String(value).trim()))
    .filter(Boolean)
    .join(' ');
}

/** Prefer short identity fields — avoid matching marketing HTML ("gold premium…"). */
function lineItemMatchText(item) {
  const product = item?.product;
  return [
    item?.description,
    product?.name,
    item?.quality_mark_description,
    product?.sku,
    product?.code,
    product?.type,
  ]
    .map((value) => (value == null ? '' : String(value).trim()))
    .filter(Boolean)
    .join(' ');
}

export function isPremiumLineItem(item) {
  return PREMIUM_RE.test(lineItemMatchText(item));
}

export function premiumItemsFromDetail(detail) {
  const items = Array.isArray(detail?.items) ? detail.items : [];
  return items.filter(isPremiumLineItem);
}

function emptyStoreEntry(store) {
  return {
    store,
    totalTxCount: 0,
    purchaseCount: 0,
    premiumTxCount: 0,
    premiumItemCount: 0,
    premiumTransactions: [],
  };
}

function rateLabel(count, total) {
  if (!total) return '0.0%';
  return `${((count / total) * 100).toFixed(1)}%`;
}

function buildResult(byStore, { startDate, endDate, warning }) {
  const rows = Array.from(byStore.values())
    .map((entry) => {
      const transactions = entry.premiumTransactions
        .slice()
        .sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0));
      return {
        store: entry.store,
        totalTxCount: entry.totalTxCount,
        purchaseCount: entry.purchaseCount,
        premiumTxCount: entry.premiumTxCount,
        premiumItemCount: entry.premiumItemCount,
        percentOfTx: entry.totalTxCount
          ? (entry.premiumTxCount / entry.totalTxCount) * 100
          : 0,
        percentLabel: rateLabel(entry.premiumTxCount, entry.totalTxCount),
        transactions,
      };
    })
    .sort((a, b) => {
      if (b.premiumTxCount !== a.premiumTxCount) return b.premiumTxCount - a.premiumTxCount;
      return a.store.localeCompare(b.store, undefined, { sensitivity: 'base' });
    });

  const totals = rows.reduce(
    (acc, row) => {
      acc.totalTxCount += row.totalTxCount;
      acc.purchaseCount += row.purchaseCount;
      acc.premiumTxCount += row.premiumTxCount;
      acc.premiumItemCount += row.premiumItemCount;
      return acc;
    },
    { totalTxCount: 0, purchaseCount: 0, premiumTxCount: 0, premiumItemCount: 0 },
  );

  return {
    rows,
    totals: {
      ...totals,
      percentLabel: rateLabel(totals.premiumTxCount, totals.totalTxCount),
      storeCount: rows.length,
    },
    startDate,
    endDate,
    warning,
  };
}

/**
 * Load all stores and count Premium Jewelry purchases by location.
 * "Premium" is matched on purchase line-item name/sku fields.
 * Percentage = premium purchase txs / total txs (sales + purchases) at that store.
 *
 * Supports onPartial for progressive UI updates and a short in-memory cache.
 */
export async function fetchPremiumJewelryByStore(
  session,
  { startDate, endDate, onProgress, onPartial, bypassCache = false } = {},
) {
  const systems = posSystemsFromSession(session);
  if (systems.length === 0) {
    throw new Error('No POS sessions available. Log in again to load Premium Jewelry stats.');
  }

  const key = cacheKey(systems, startDate, endDate);
  if (!bypassCache) {
    const cached = resultCache.get(key);
    if (cached && cached.expires > Date.now()) {
      if (typeof onProgress === 'function') {
        onProgress({ scanned: cached.value.totals?.purchaseCount || 0, total: cached.value.totals?.purchaseCount || 0 });
      }
      return cached.value;
    }
  }

  // Locations + transaction lists in parallel (was sequential before).
  const [locationGroups, txResults] = await Promise.all([
    Promise.all(
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
    ),
    Promise.all(
      systems.map(async (system) => {
        try {
          const result = await fetchTransactions(system.token, {
            startDate,
            endDate,
            baseUrl: system.baseUrl,
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
    ),
  ]);

  const storeNames = new Set();
  for (const names of locationGroups) {
    for (const name of names) storeNames.add(name);
  }

  const allRows = txResults.flatMap((result) => result.rows);
  const warnings = txResults.map((result) => result.error).filter(Boolean);

  for (const row of allRows) {
    const store = String(row.storeName || '').trim();
    if (store && store !== '—') storeNames.add(store);
  }

  const byStore = new Map();
  for (const store of storeNames) {
    byStore.set(store, emptyStoreEntry(store));
  }

  for (const row of allRows) {
    const store = String(row.storeName || '').trim();
    if (!store || store === '—') continue;
    let entry = byStore.get(store);
    if (!entry) {
      entry = emptyStoreEntry(store);
      byStore.set(store, entry);
    }
    entry.totalTxCount += 1;
    if (row.type === 'purchase') entry.purchaseCount += 1;
  }

  const purchases = allRows.filter((row) => row.type === 'purchase');
  let scanned = 0;
  const warning = warnings.join(' ');

  const emitPartial = () => {
    if (typeof onPartial !== 'function') return;
    onPartial(buildResult(byStore, { startDate, endDate, warning }));
  };

  if (typeof onProgress === 'function') {
    onProgress({ scanned: 0, total: purchases.length });
  }
  // Show store totals immediately while premium scan runs.
  emitPartial();

  await mapPool(purchases, DETAIL_CONCURRENCY, async (row) => {
    try {
      const detail = await fetchTransactionDetail(row.token, {
        type: row.type,
        sourceId: row.sourceId,
        baseUrl: row.baseUrl,
      });
      const premiumItems = premiumItemsFromDetail(detail);
      if (premiumItems.length > 0) {
        const store = String(row.storeName || '').trim() || '—';
        let entry = byStore.get(store);
        if (!entry) {
          entry = emptyStoreEntry(store);
          byStore.set(store, entry);
        }
        entry.premiumTxCount += 1;
        entry.premiumItemCount += premiumItems.length;
        entry.premiumTransactions.push({
          ...row,
          premiumItemCount: premiumItems.length,
          premiumItemNames: premiumItems.map(lineItemText),
        });
      }
    } catch {
      // Skip failed detail lookups; still count toward scan progress.
    } finally {
      scanned += 1;
      if (typeof onProgress === 'function') {
        onProgress({ scanned, total: purchases.length });
      }
      if (scanned === purchases.length || scanned % PARTIAL_EVERY === 0) {
        emitPartial();
      }
    }
  });

  const result = buildResult(byStore, { startDate, endDate, warning });
  resultCache.set(key, { expires: Date.now() + CACHE_TTL_MS, value: result });
  return result;
}

/** Drop cached premium scans (e.g. after forced refresh). */
export function clearPremiumJewelryCache() {
  resultCache.clear();
}
