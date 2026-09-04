/**
 * Aureus inventory transfers (GET /transfers).
 * Used by the bullion audit so metal that is in transit, received late, or
 * sent out of a store is visible when counts do not match the system.
 */
import { API_BASE_URL, authHeaders } from './auth';
import { resolveBullionSystem } from './bullionAudit';
import { formatDateParam, parseDateParam } from './transactions';

const ITEMS_PER_PAGE = 100;
const MAX_PAGES = 12;
const DETAIL_CONCURRENCY = 5;
const MAX_DETAILS = 40;
const MAX_PROMPT_TRANSFERS = 30;

export const TRANSFER_STATUSES = ['pending', 'received'];

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

function roundQty(value) {
  return Math.round((Number(value) || 0) * 1000) / 1000;
}

function firstString(...values) {
  for (const value of values) {
    if (value == null) continue;
    if (typeof value === 'object') continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return '';
}

function dateKeyOf(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = value > 1e12 ? value : value * 1000;
    return new Date(ms).toISOString().slice(0, 10);
  }
  const text = String(value).trim();
  const match = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) return match[1];
  const parsed = Date.parse(text);
  if (!Number.isNaN(parsed)) return new Date(parsed).toISOString().slice(0, 10);
  return null;
}

function personName(value) {
  if (!value) return '';
  if (typeof value === 'string') return value.trim();
  return firstString(
    value.name,
    [value.first_name, value.last_name].filter(Boolean).join(' '),
    value.full_name,
    value.email,
  );
}

function paginationMeta(payload) {
  const meta = payload?.meta?.pagination || payload?.meta || payload?.pagination || {};
  const last =
    Number(meta.last_page ?? payload?.last_page ?? meta.total_pages ?? payload?.total_pages) ||
    null;
  const perPage = Number(meta.per_page ?? meta.items_per_page ?? payload?.per_page) || null;
  const total = Number(meta.total ?? payload?.total ?? meta.total_count) || null;
  return { last, perPage, total };
}

function pickLocation(raw, side) {
  const object =
    raw?.[`${side}_location`] ||
    raw?.[`${side}Location`] ||
    (side === 'from' ? raw?.source_location || raw?.origin_location || raw?.origin : null) ||
    (side === 'to' ? raw?.destination_location || raw?.destination : null) ||
    null;
  const id =
    raw?.[`${side}_location_id`] ??
    raw?.[`${side}LocationId`] ??
    (side === 'from' ? raw?.source_location_id ?? raw?.origin_location_id : null) ??
    (side === 'to' ? raw?.destination_location_id : null) ??
    object?.id ??
    null;
  const name = firstString(
    typeof object === 'string' ? object : object?.name,
    raw?.[`${side}_location_name`],
    side === 'from' ? raw?.source_location_name : raw?.destination_location_name,
  );
  const resolvedId =
    id != null && id !== ''
      ? id
      : typeof object === 'number' || (typeof object === 'string' && /^\d+$/.test(object))
        ? object
        : null;
  return { id: resolvedId != null && resolvedId !== '' ? String(resolvedId) : null, name };
}

function rawItems(raw) {
  const buckets = [
    raw?.items,
    raw?.transfer_items,
    raw?.transferItems,
    raw?.products,
    raw?.lines,
    raw?.inventory_items,
    raw?.inventoryItems,
    raw?.data?.items,
    raw?.data?.transfer_items,
  ];
  for (const bucket of buckets) {
    if (Array.isArray(bucket) && bucket.length) return bucket;
  }
  return Array.isArray(raw?.items) ? raw.items : [];
}

function normalizeItem(item) {
  const product = item?.product || item?.inventory_product || item?.inventoryProduct || {};
  const nested = product?.product && typeof product.product === 'object' ? product.product : {};
  const productId =
    item?.product_id ??
    product?.id ??
    item?.inventory_product_id ??
    nested?.id ??
    null;
  const quantity = toNumber(item?.quantity ?? item?.qty ?? item?.amount ?? item?.sent_quantity);
  const receivedQuantity = toNumber(
    item?.received_quantity ??
      item?.quantity_received ??
      item?.fulfilled_quantity ??
      item?.received_qty,
  );
  return {
    productId: productId != null && productId !== '' ? String(productId) : null,
    name: firstString(
      product?.name,
      nested?.name,
      product?.product_name,
      item?.product_name,
      item?.description,
      item?.name,
      item?.quality_mark_description,
      product?.description,
      nested?.description,
    ),
    sku: firstString(
      product?.sku,
      nested?.sku,
      product?.code,
      nested?.code,
      item?.sku,
      item?.code,
    ),
    metal: firstString(
      typeof product?.metal === 'string' ? product.metal : product?.metal?.name,
      nested?.metal?.name,
      item?.metal,
    ),
    quantity,
    receivedQuantity,
    shortfall:
      quantity != null && receivedQuantity != null ? roundQty(quantity - receivedQuantity) : null,
  };
}

/** Flatten one API transfer into the shape the audit uses. */
export function normalizeTransfer(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = raw.id ?? raw.transfer_id ?? null;
  const from = pickLocation(raw, 'from');
  const to = pickLocation(raw, 'to');
  const status = firstString(raw.status, raw.state).toLowerCase();
  const items = rawItems(raw).map(normalizeItem);
  const totalQty = items.reduce((sum, item) => sum + (item.quantity || 0), 0);
  const receivedQty = items.reduce((sum, item) => sum + (item.receivedQuantity || 0), 0);
  const listedCount = toNumber(
    raw.total_products ?? raw.products_count ?? raw.items_count ?? raw.total_items,
  );

  return attachSearchFields({
    id: id != null ? String(id) : null,
    reference: id != null ? `TR# ${id}` : 'TR# ?',
    status,
    date: dateKeyOf(raw.date ?? raw.transfer_date ?? raw.created_at),
    shippedDate: dateKeyOf(raw.shipped_at ?? raw.sent_at ?? raw.shipped_date),
    receivedDate: dateKeyOf(raw.received_at ?? raw.received_date ?? raw.completed_at),
    createdAt: dateKeyOf(raw.created_at),
    from,
    to,
    createdBy: personName(raw.created_by || raw.user || raw.creator || raw.user_name),
    receivedBy: personName(raw.received_by || raw.receiver || raw.received_by_name),
    comments: firstString(raw.comments, raw.notes, raw.description),
    tracking: firstString(raw.tracking_number, raw.tracking, raw.carrier),
    items,
    itemCount: items.length || listedCount || 0,
    totalQty: roundQty(totalQty),
    receivedQty: roundQty(receivedQty),
    hasItems: items.length > 0,
    itemsLoaded: items.length > 0,
  });
}

function attachSearchFields(transfer) {
  const itemNames = (transfer.items || [])
    .map((item) => firstString(item.name, item.sku, item.productId))
    .filter(Boolean);
  const itemSearchText = (transfer.items || [])
    .map((item) => [item.name, item.sku, item.metal, item.productId].filter(Boolean).join(' '))
    .join(' ')
    .toLowerCase();
  const searchText = [
    transfer.reference,
    transfer.id,
    transfer.status,
    transfer.date,
    transfer.receivedDate,
    transfer.from?.name,
    transfer.to?.name,
    transfer.from?.id,
    transfer.to?.id,
    transfer.comments,
    transfer.tracking,
    transfer.createdBy,
    transfer.receivedBy,
    ...itemNames,
    itemSearchText,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return { ...transfer, itemNames, itemSearchText, searchText };
}

function preferLocation(primary, fallback) {
  if (primary?.name) return primary;
  if (fallback?.name) {
    return {
      id: primary?.id || fallback.id,
      name: fallback.name,
    };
  }
  return primary || fallback || { id: null, name: '' };
}

/** Merge a GET /transfers/:id payload onto a list row without dropping store names. */
export function mergeTransferDetail(row, detail) {
  if (!detail) return attachSearchFields({ ...row, itemsLoaded: true });
  return attachSearchFields({
    ...row,
    ...detail,
    from: preferLocation(detail.from, row?.from),
    to: preferLocation(detail.to, row?.to),
    itemsLoaded: true,
    itemCount: detail.itemCount || row?.itemCount || 0,
  });
}

async function fetchTransfersPage(token, baseUrl, { status, page }) {
  const extras = ['items,product,inventory_product,from_location,to_location', ''];
  let lastError = null;

  for (const extra of extras) {
    const params = new URLSearchParams({
      page: String(page),
      items_per_page: String(ITEMS_PER_PAGE),
      'sort[field]': 'date',
      'sort[dir]': 'desc',
    });
    if (status) params.set('filters[status]', status);
    if (extra) params.set('extra', extra);

    const response = await fetch(`${baseUrl}/transfers?${params.toString()}`, {
      method: 'GET',
      headers: authHeaders(token),
    });
    const payload = await parseJsonResponse(response);
    if (!response.ok) {
      lastError = new Error(getErrorMessage(payload, `Failed to load ${status || ''} transfers.`.trim()));
      continue;
    }
    const rows = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload) ? payload : [];
    return { rows, ...paginationMeta(payload) };
  }

  throw lastError || new Error('Failed to load transfers.');
}

/**
 * One page of transfers — same call as POS:
 * GET /transfers?page=1&items_per_page=100&filters[status]=received&sort[field]=date&sort[dir]=desc
 */
export async function fetchTransferList(
  token,
  { status = 'received', page = 1, baseUrl = API_BASE_URL } = {},
) {
  if (!token) throw new Error('Not signed in.');
  const { rows, last, perPage, total } = await fetchTransfersPage(token, baseUrl, { status, page });
  return {
    transfers: rows.map(normalizeTransfer).filter(Boolean),
    page,
    lastPage: last,
    perPage: perPage || ITEMS_PER_PAGE,
    total,
    status,
  };
}

function statusRank(status) {
  return status === 'pending' ? 0 : 1;
}

/**
 * Dashboard list: pending (in transit) plus received, pending first then newest.
 * Pending: GET /transfers?filters[status]=pending
 * Received: GET /transfers?filters[status]=received
 */
export async function fetchDashboardTransfers(token, { page = 1, baseUrl = API_BASE_URL } = {}) {
  if (!token) throw new Error('Not signed in.');

  const results = await Promise.all(
    TRANSFER_STATUSES.map(async (status) => {
      try {
        return await fetchTransferList(token, { status, page, baseUrl });
      } catch (error) {
        return {
          status,
          transfers: [],
          total: 0,
          error: error?.message || `Failed to load ${status} transfers.`,
        };
      }
    }),
  );

  const seen = new Set();
  const transfers = [];
  for (const result of results) {
    for (const transfer of result.transfers) {
      if (transfer.id && seen.has(transfer.id)) continue;
      if (transfer.id) seen.add(transfer.id);
      transfers.push(transfer);
    }
  }

  transfers.sort((a, b) => {
    const rank = statusRank(a.status) - statusRank(b.status);
    if (rank !== 0) return rank;
    const dates = String(b.date || '').localeCompare(String(a.date || ''));
    if (dates !== 0) return dates;
    return Number(b.id) - Number(a.id);
  });

  const warning = results.map((result) => result.error).filter(Boolean).join(' ');
  const failed = results.filter((result) => result.error);
  if (failed.length === results.length) {
    throw new Error(warning || 'Failed to load transfers.');
  }

  return {
    transfers,
    pendingCount: transfers.filter((transfer) => transfer.status === 'pending').length,
    receivedCount: transfers.filter((transfer) => transfer.status === 'received').length,
    total: results.reduce((sum, result) => sum + (Number(result.total) || 0), 0) || transfers.length,
    warning,
  };
}

/**
 * Transfers with one status, newest first. Stops once rows are older than
 * `since` (YYYY-MM-DD) because the API sorts by date desc.
 */
export async function fetchTransfers(token, { status, since, baseUrl = API_BASE_URL } = {}) {
  const all = [];
  const seen = new Set();
  let page = 1;

  while (page <= MAX_PAGES) {
    const { rows, last, perPage } = await fetchTransfersPage(token, baseUrl, { status, page });
    let reachedOld = false;
    for (const raw of rows) {
      const transfer = normalizeTransfer(raw);
      if (!transfer) continue;
      if (transfer.id && seen.has(transfer.id)) continue;
      if (transfer.id) seen.add(transfer.id);
      if (since && transfer.date && transfer.date < since) {
        reachedOld = true;
        continue;
      }
      all.push(transfer);
    }
    const pageSize = perPage || ITEMS_PER_PAGE;
    if (reachedOld) break;
    if (rows.length === 0 || rows.length < pageSize) break;
    if (last != null && page >= last) break;
    page += 1;
  }

  return all;
}

export async function fetchTransferDetail(token, id, baseUrl = API_BASE_URL) {
  const extras = ['items,product,inventory_product,from_location,to_location', ''];
  let lastError = null;
  let transfer = null;

  for (const extra of extras) {
    const params = new URLSearchParams();
    if (extra) params.set('extra', extra);
    const qs = params.toString();
    const response = await fetch(`${baseUrl}/transfers/${id}${qs ? `?${qs}` : ''}`, {
      method: 'GET',
      headers: authHeaders(token),
    });
    const payload = await parseJsonResponse(response);
    if (!response.ok) {
      lastError = new Error(getErrorMessage(payload, `Failed to load transfer ${id}.`));
      continue;
    }
    const raw = payload?.data && typeof payload.data === 'object' ? payload.data : payload;
    transfer = normalizeTransfer(raw);
    break;
  }

  if (!transfer) throw lastError || new Error(`Failed to load transfer ${id}.`);

  if (!transfer.hasItems) {
    const lines = await fetchTransferItemLines(token, id, baseUrl);
    if (lines.length) {
      const totalQty = lines.reduce((sum, item) => sum + (item.quantity || 0), 0);
      const receivedQty = lines.reduce((sum, item) => sum + (item.receivedQuantity || 0), 0);
      transfer = attachSearchFields({
        ...transfer,
        items: lines,
        itemCount: lines.length,
        totalQty: roundQty(totalQty),
        receivedQty: roundQty(receivedQty),
        hasItems: true,
        itemsLoaded: true,
      });
    }
  }
  return transfer;
}

async function fetchTransferItemLines(token, id, baseUrl) {
  const paths = [`${baseUrl}/transfers/${id}/items`, `${baseUrl}/transfers/${id}/transfer_items`];
  for (const url of paths) {
    try {
      const response = await fetch(url, { method: 'GET', headers: authHeaders(token) });
      if (!response.ok) continue;
      const payload = await parseJsonResponse(response);
      const rows = Array.isArray(payload?.data)
        ? payload.data
        : Array.isArray(payload)
          ? payload
          : [];
      if (rows.length) return rows.map(normalizeItem);
    } catch {
      // Try the next nested items URL.
    }
  }
  return [];
}

function namesMatch(a, b) {
  const left = String(a || '').trim();
  const right = String(b || '').trim();
  if (!left || !right) return false;
  return left.localeCompare(right, undefined, { sensitivity: 'base' }) === 0;
}

function sideTouchesStore(side, locationId, storeName) {
  if (locationId != null && side.id != null && String(side.id) === String(locationId)) return true;
  return namesMatch(side.name, storeName);
}

function directionFor(transfer, locationId, storeName) {
  const out = sideTouchesStore(transfer.from, locationId, storeName);
  const inbound = sideTouchesStore(transfer.to, locationId, storeName);
  if (out && inbound) return 'internal';
  if (out) return 'out';
  if (inbound) return 'in';
  return null;
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
  await Promise.all(Array.from({ length: Math.min(limit, items.length || 1) }, () => worker()));
  return results;
}

function shiftDate(date, days) {
  const next = parseDateParam(date);
  next.setDate(next.getDate() + days);
  return formatDateParam(next);
}

function itemMatchesTarget(item, target) {
  if (item.productId && String(target.id) === item.productId) return true;
  const norm = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const sku = norm(item.sku);
  const name = norm(item.name);
  const targetSku = norm(target.sku);
  const targetName = norm(target.name);
  if (sku && targetSku && sku === targetSku) return true;
  if (name && targetName && name === targetName) return true;
  return false;
}

/**
 * Transfers that touch one store around the audit day, with the effect on
 * each unbalanced product (units sent out, received in, or still in transit).
 */
export async function gatherAuditTransfers(
  session,
  { date, locationId, storeName, systemKey, targets = [], lookbackDays = 7, onProgress } = {},
) {
  const day = formatDateParam(parseDateParam(date));
  const since = shiftDate(day, -Math.max(1, lookbackDays));
  const system = resolveBullionSystem(session, systemKey);

  onProgress?.('Loading transfers…');
  const results = await Promise.all(
    TRANSFER_STATUSES.map(async (status) => {
      try {
        // Pending transfers matter regardless of age: the metal is somewhere between stores.
        const rows = await fetchTransfers(system.token, {
          status,
          since: status === 'pending' ? shiftDate(day, -60) : since,
          baseUrl: system.baseUrl,
        });
        return { status, rows, error: '' };
      } catch (error) {
        return { status, rows: [], error: error?.message || `Failed to load ${status} transfers.` };
      }
    }),
  );

  const warning = results.map((entry) => entry.error).filter(Boolean).join(' ');
  const touching = [];
  const seen = new Set();
  for (const entry of results) {
    for (const transfer of entry.rows) {
      if (transfer.id && seen.has(transfer.id)) continue;
      const direction = directionFor(transfer, locationId, storeName);
      if (!direction) continue;
      if (transfer.date && transfer.date > day) continue;
      if (transfer.id) seen.add(transfer.id);
      touching.push({ ...transfer, direction });
    }
  }

  const needDetail = touching.filter((transfer) => !transfer.hasItems).slice(0, MAX_DETAILS);
  if (needDetail.length) {
    onProgress?.(`Reading ${needDetail.length} transfer${needDetail.length === 1 ? '' : 's'}…`);
    const details = await mapPool(needDetail, DETAIL_CONCURRENCY, async (transfer) => {
      if (!transfer.id) return null;
      try {
        return await fetchTransferDetail(system.token, transfer.id, system.baseUrl);
      } catch {
        return null;
      }
    });
    const byId = new Map();
    details.forEach((detail, index) => {
      if (detail) byId.set(needDetail[index].id, detail);
    });
    for (let i = 0; i < touching.length; i += 1) {
      const detail = byId.get(touching[i].id);
      if (detail) touching[i] = { ...touching[i], ...detail, direction: touching[i].direction };
    }
  }

  touching.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));

  const byProduct = new Map();
  const ensure = (target) => {
    const key = String(target.id);
    if (!byProduct.has(key)) {
      byProduct.set(key, {
        productId: key,
        name: target.name,
        sentOut: 0,
        receivedIn: 0,
        pendingIn: 0,
        pendingOut: 0,
        receivedShort: 0,
        transfers: [],
      });
    }
    return byProduct.get(key);
  };
  for (const target of targets) ensure(target);

  for (const transfer of touching) {
    for (const item of transfer.items) {
      for (const target of targets) {
        if (!itemMatchesTarget(item, target)) continue;
        const bucket = ensure(target);
        const qty = item.quantity || 0;
        const received = item.receivedQuantity != null ? item.receivedQuantity : qty;
        const pending = transfer.status !== 'received';
        if (transfer.direction === 'out') {
          if (pending) bucket.pendingOut = roundQty(bucket.pendingOut + qty);
          else bucket.sentOut = roundQty(bucket.sentOut + qty);
        } else if (transfer.direction === 'in') {
          if (pending) bucket.pendingIn = roundQty(bucket.pendingIn + qty);
          else {
            bucket.receivedIn = roundQty(bucket.receivedIn + received);
            if (item.shortfall) bucket.receivedShort = roundQty(bucket.receivedShort + item.shortfall);
          }
        }
        bucket.transfers.push({
          reference: transfer.reference,
          direction: transfer.direction,
          status: transfer.status,
          date: transfer.date,
          receivedDate: transfer.receivedDate,
          from: transfer.from.name || transfer.from.id,
          to: transfer.to.name || transfer.to.id,
          qty,
          receivedQty: item.receivedQuantity,
          shortfall: item.shortfall,
          sameDay: transfer.date === day || transfer.receivedDate === day,
        });
      }
    }
  }

  const compactTransfer = (transfer) => ({
    reference: transfer.reference,
    direction: transfer.direction,
    status: transfer.status,
    date: transfer.date,
    shippedDate: transfer.shippedDate || undefined,
    receivedDate: transfer.receivedDate || undefined,
    from: transfer.from.name || transfer.from.id,
    to: transfer.to.name || transfer.to.id,
    createdBy: transfer.createdBy || undefined,
    receivedBy: transfer.receivedBy || undefined,
    comments: transfer.comments || undefined,
    tracking: transfer.tracking || undefined,
    totalQty: transfer.totalQty,
    receivedQty: transfer.status === 'received' ? transfer.receivedQty : undefined,
    items: transfer.items.slice(0, 20).map((item) => ({
      product: item.name || item.sku || item.productId,
      productId: item.productId,
      sku: item.sku || undefined,
      qty: item.quantity,
      receivedQty: item.receivedQuantity ?? undefined,
      shortfall: item.shortfall || undefined,
    })),
    itemsLoaded: transfer.hasItems,
  });

  const relevant = touching.filter((transfer) =>
    transfer.items.some((item) => targets.some((target) => itemMatchesTarget(item, target))),
  );
  const pending = touching.filter((transfer) => transfer.status !== 'received');

  return {
    windowStart: since,
    windowEnd: day,
    transferCount: touching.length,
    pendingCount: pending.length,
    relevantCount: relevant.length,
    byProduct: Array.from(byProduct.values()),
    transfers: [...relevant, ...touching.filter((t) => !relevant.includes(t))]
      .slice(0, MAX_PROMPT_TRANSFERS)
      .map(compactTransfer),
    howToRead:
      'direction out = metal left this store; in = metal came to this store. status pending = created but not received (metal in transit, not in either count). received transfers move system stock on receivedDate, not the ship date. shortfall = sent qty − received qty.',
    warning,
  };
}
