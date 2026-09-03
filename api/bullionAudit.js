import { API_BASE_URL, authHeaders, getLinkedPosSessions } from './auth';
import {
  fetchBullionProducts,
  fetchProductInventory,
  formatQty,
} from './inventory';
import { fetchPosLocations } from './locations';
import { AUDIT_CASH_STORES, QUEBEC_STORES } from './cashTill';
import { formatDateParam, HOME_STORES, parseDateParam } from './transactions';

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

function namesMatch(a, b) {
  return (
    String(a || '')
      .trim()
      .localeCompare(String(b || '').trim(), undefined, { sensitivity: 'base' }) === 0
  );
}

/** Prefer GTA/PMX when East has a same-named non-retail location. */
function storeSystemRank(systemKey) {
  if (systemKey === 'gta' || systemKey === 'pmx') return 0;
  if (systemKey === 'east') return 1;
  return 2;
}

export function resolveBullionSystem(session, systemKey) {
  const systems = posSystemsFromSession(session);
  if (!systems.length) throw new Error('Not signed in.');
  if (systemKey) {
    const match = systems.find((system) => system.key === systemKey);
    if (match) return match;
  }
  return systems[0];
}

function getErrorMessage(payload, fallback) {
  return payload?.error?.message || payload?.message || fallback;
}

async function parseJsonResponse(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function toNumber(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toQty(value) {
  return toNumber(value) ?? 0;
}

const EXCLUDED_LOCATION_NAMES = new Set([
  'in transit',
  'umicore',
  'workshop',
  'storage',
  'westgate',
  'rcm pooled ounces',
  'pmx',
  '3rd party',
]);

function isStoreLocation(location) {
  const name = String(location?.name || '').trim().toLowerCase();
  if (!name) return false;
  if (EXCLUDED_LOCATION_NAMES.has(name)) return false;
  const status = String(location?.status || '').toLowerCase();
  return !status || status === 'active';
}

/** Stores available in Audit → Bullion (same retail set as Cash). */
export const AUDIT_BULLION_STORES = [...AUDIT_CASH_STORES];

function storeSortRank(name) {
  if (HOME_STORES.includes(name)) return 0;
  if (QUEBEC_STORES.includes(name)) return 1;
  return 2;
}

/**
 * Previous 7 calendar days before `date` (exclusive of selected date),
 * matching the POS bullion audit week columns.
 */
export function weekHistoryDates(date) {
  const base = parseDateParam(date);
  const dates = [];
  for (let i = 7; i >= 1; i -= 1) {
    const d = new Date(base);
    d.setDate(base.getDate() - i);
    dates.push(formatDateParam(d));
  }
  return dates;
}

export function formatWeekColumnLabel(dateKey) {
  return parseDateParam(dateKey).toLocaleDateString('en-CA', {
    month: 'short',
    day: 'numeric',
  });
}

function logDateKey(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw.slice(0, 10);
}

function qtyAtLocation(stocks, productId, locationId) {
  const entries = stocks[String(productId)];
  if (!Array.isArray(entries)) return 0;
  let qty = 0;
  for (const entry of entries) {
    if (String(entry?.location_id) === String(locationId)) {
      qty += toQty(entry?.quantity);
    }
  }
  return qty;
}

function chunkIds(ids, size) {
  const chunks = [];
  for (let i = 0; i < ids.length; i += size) {
    chunks.push(ids.slice(i, i + size));
  }
  return chunks;
}

const LOG_CHUNK_SIZE = 80;

export async function fetchInventoryLogs(
  token,
  { productIds, locationId, date, forWeek = true },
  baseUrl = API_BASE_URL,
) {
  if (!productIds.length || locationId == null || locationId === '') return [];

  const chunks = chunkIds(productIds.map(String), LOG_CHUNK_SIZE);
  const parts = await Promise.all(
    chunks.map(async (chunk) => {
      const params = new URLSearchParams({
        product_ids: chunk.join(','),
        location_id: String(locationId),
        date: formatDateParam(date),
        for_week: forWeek ? 'true' : 'false',
      });

      const response = await fetch(`${baseUrl}/inventory_logs?${params.toString()}`, {
        method: 'GET',
        headers: authHeaders(token),
      });
      const payload = await parseJsonResponse(response);

      if (!response.ok) {
        throw new Error(getErrorMessage(payload, 'Failed to load inventory logs.'));
      }

      return Array.isArray(payload) ? payload : [];
    }),
  );

  return parts.flat();
}

export async function saveInventoryLog(
  token,
  {
    productId,
    locationId,
    date,
    vaultCount = null,
    storeCount = null,
    otherCount = null,
  },
  baseUrl = API_BASE_URL,
) {
  const vault = toNumber(vaultCount);
  const store = toNumber(storeCount);
  const other = toNumber(otherCount);
  const amount = (vault ?? 0) + (store ?? 0) + (other ?? 0);

  const body = {
    product_id: Number(productId),
    location_id: Number(locationId),
    vault_count: vault,
    store_count: store,
    other_count: other,
    amount,
    date: formatDateParam(date),
  };

  const response = await fetch(`${baseUrl}/inventory_logs`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(body),
  });
  const payload = await parseJsonResponse(response);

  if (!response.ok) {
    throw new Error(getErrorMessage(payload, 'Failed to save inventory count.'));
  }

  return payload;
}

/**
 * Resolve retail store locations across East + linked POS (GTA/PMX).
 * Home-tab store names (Hamilton, Toronto, …) live on GTA.
 */
export async function fetchBullionAuditStores(session) {
  const systems = posSystemsFromSession(session);
  if (!systems.length) throw new Error('Not signed in.');

  const byName = new Map();
  await Promise.all(
    systems.map(async (system) => {
      try {
        const locations = await fetchPosLocations(system.baseUrl, system.token);
        for (const location of locations) {
          if (!isStoreLocation(location)) continue;
          const name = String(location?.name || '').trim();
          if (!name) continue;
          const key = name.toLowerCase();
          const next = {
            id: String(location.id),
            name,
            city: location.city || '',
            systemKey: system.key,
            systemLabel: system.label,
            baseUrl: system.baseUrl,
            token: system.token,
          };
          const prev = byName.get(key);
          if (!prev || storeSystemRank(next.systemKey) < storeSystemRank(prev.systemKey)) {
            byName.set(key, next);
          }
        }
      } catch {
        // Skip systems that fail to load locations.
      }
    }),
  );

  const preferred = AUDIT_BULLION_STORES.map((name) => byName.get(name.toLowerCase())).filter(
    Boolean,
  );

  const extras = Array.from(byName.values())
    .filter(
      (store) =>
        !AUDIT_BULLION_STORES.some((name) => namesMatch(name, store.name)),
    )
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

  return [...preferred, ...extras].sort((a, b) => {
    const rank = storeSortRank(a.name) - storeSortRank(b.name);
    if (rank !== 0) return rank;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });
}

function buildLogIndex(logs) {
  /** productId -> dateKey -> log */
  const byProduct = new Map();
  for (const log of logs) {
    const productId = String(log?.product_id ?? '');
    const dateKey = logDateKey(log?.date);
    if (!productId || !dateKey) continue;
    if (!byProduct.has(productId)) byProduct.set(productId, new Map());
    byProduct.get(productId).set(dateKey, log);
  }
  return byProduct;
}

function historyAmount(log) {
  if (!log) return null;
  if (log.amount != null && log.amount !== '') return toNumber(log.amount);
  const vault = toQty(log.vault_count);
  const store = toQty(log.store_count);
  const other = toQty(log.other_count);
  return vault + store + other;
}

/**
 * Load bullion products + system qty + week inventory logs for one store/date.
 * Uses the POS system that owns the location (East / GTA / PMX).
 */
export async function fetchBullionAudit(session, { date, locationId, systemKey }) {
  if (locationId == null || locationId === '') {
    throw new Error('Select a store.');
  }

  const system = resolveBullionSystem(session, systemKey);
  const { token, baseUrl } = system;
  const dateKey = formatDateParam(date);
  const historyDates = weekHistoryDates(dateKey);

  const products = await fetchBullionProducts(token, baseUrl);
  const productIds = products.map((product) => String(product.id));

  const [inventory, logs] = await Promise.all([
    fetchProductInventory(token, productIds, baseUrl, {
      locations: locationId,
      date: dateKey,
    }),
    fetchInventoryLogs(
      token,
      { productIds, locationId, date: dateKey, forWeek: true },
      baseUrl,
    ),
  ]);

  const logIndex = buildLogIndex(logs);
  const stocks = inventory.stocks || {};

  const rows = products
    .map((product) => {
      const id = String(product.id);
      const systemCount = qtyAtLocation(stocks, id, locationId);
      const todayLog = logIndex.get(id)?.get(dateKey) || null;
      const history = {};
      for (const day of historyDates) {
        history[day] = historyAmount(logIndex.get(id)?.get(day));
      }

      return {
        id,
        name: product.name || product.sku || `Product ${id}`,
        sku: product.sku || '',
        metal:
          typeof product.metal === 'string'
            ? product.metal
            : product.metal?.name || product.metal_type || '',
        description: product.description || product.name || product.sku || '',
        systemCount,
        history,
        vaultCount: todayLog ? toNumber(todayLog.vault_count) : null,
        storeCount: todayLog ? toNumber(todayLog.store_count) : null,
        otherCount: todayLog ? toNumber(todayLog.other_count) : null,
        amount: todayLog ? historyAmount(todayLog) : null,
        logId: todayLog?.id ?? null,
      };
    })
    .sort((a, b) => {
      const metal = String(a.metal).localeCompare(String(b.metal), undefined, {
        sensitivity: 'base',
      });
      if (metal !== 0) return metal;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });

  return {
    date: dateKey,
    locationId: String(locationId),
    systemKey: system.key,
    historyDates,
    rows,
  };
}

export { formatQty };
