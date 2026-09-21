/**
 * Aureus inventory transfers (GET /transfers, POST /transfers).
 * Used by the bullion audit so metal that is in transit, received late, or
 * sent out of a store is visible when counts do not match the system.
 * Create matches POS: POST /transfers with from/to, mode, comments, and items.
 */
import { API_BASE_URL, authHeaders, posFetch } from './auth';
import { resolveBullionSystem } from './bullionAudit';
import { ensureEmployeeAtLocation } from './aureusEmployees';
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
  const id = item?.id ?? item?.transfer_item_id ?? null;
  return {
    id: id != null && id !== '' ? String(id) : null,
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
    receivedDeliveries: Array.isArray(item?.received_deliveries)
      ? item.received_deliveries
      : Array.isArray(item?.receivedDeliveries)
        ? item.receivedDeliveries
        : [],
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
    transferMode: firstString(raw.transfer_mode, raw.mode) || 'Employee drop',
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

    const response = await posFetch(`${baseUrl}/transfers?${params.toString()}`, {
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

const DEFAULT_TRANSFER_MODE = 'Employee drop';

function posTransferCode(raw) {
  const id = raw?.id ?? raw?.transfer_id ?? null;
  return firstString(raw?.transfer_code, id != null ? `TF${id}` : '');
}

/**
 * Create a pending POS transfer. Same call as Inventory → Transfers → Add:
 * POST /transfers { from_location_id, to_location_id, transfer_mode, comments, items }.
 */
export async function createPosTransfer(
  token,
  {
    fromLocationId,
    toLocationId,
    comments,
    items,
    transferMode = DEFAULT_TRANSFER_MODE,
    trackingNumber = null,
  },
  baseUrl = API_BASE_URL,
) {
  if (!token) throw new Error('Not signed in.');
  const fromId = Number(fromLocationId);
  const toId = Number(toLocationId);
  if (!Number.isFinite(fromId) || !Number.isFinite(toId)) {
    throw new Error('Choose sending and receiving stores before creating a transfer.');
  }
  if (fromId === toId) {
    throw new Error('Sending and receiving stores must be different.');
  }
  const lines = (items || [])
    .map((item) => ({
      product_id: Number(item.product_id ?? item.productId),
      quantity: roundQty(item.quantity ?? item.sentQty ?? item.qty),
      gross_quantity: roundQty(
        item.gross_quantity ?? item.quantity ?? item.sentQty ?? item.qty,
      ),
    }))
    .filter((item) => Number.isFinite(item.product_id) && item.quantity > 0);
  if (lines.length === 0) {
    throw new Error('Add at least one product quantity to transfer.');
  }

  const body = {
    from_location_id: fromId,
    to_location_id: toId,
    transfer_mode: transferMode || DEFAULT_TRANSFER_MODE,
    tracking_number: trackingNumber || null,
    comments: comments ? String(comments).trim() || null : null,
    images: [],
    items: lines,
  };

  const response = await posFetch(`${baseUrl}/transfers`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(body),
  });
  const payload = await parseJsonResponse(response);
  if (!response.ok) {
    throw new Error(getErrorMessage(payload, 'Failed to create transfer in POS.'));
  }
  const raw = payload?.data && typeof payload.data === 'object' ? payload.data : payload;
  const transfer = normalizeTransfer(raw);
  if (!transfer) throw new Error('POS created the transfer but returned an empty record.');
  return {
    ...transfer,
    transferCode: posTransferCode(raw) || transfer.reference,
  };
}

export async function createPosTransfersFromGroups(
  token,
  groups,
  { comments, baseUrl = API_BASE_URL, employeeId, onLocationEnsured } = {},
) {
  if (!Array.isArray(groups) || groups.length === 0) {
    throw new Error('Nothing to transfer.');
  }
  if (!employeeId) {
    throw new Error('Your POS user is missing, so the transfer cannot be created.');
  }
  const created = [];
  for (const group of groups) {
    const { mapped, changed } = await ensureEmployeeAtLocation(token, employeeId, {
      locationId: group.fromLocationId,
      locationName: group.fromName,
      baseUrl,
    });
    if (changed) {
      await onLocationEnsured?.({
        locationId: mapped?.locationId || String(group.fromLocationId),
        locationName: mapped?.locationName || group.fromName || '',
      });
    }
    const transfer = await createPosTransfer(
      token,
      {
        fromLocationId: group.fromLocationId,
        toLocationId: group.toLocationId,
        comments,
        items: group.items,
      },
      baseUrl,
    );
    created.push({
      ...transfer,
      fromName: group.fromName || transfer.from?.name,
      toName: group.toName || transfer.to?.name,
    });
  }
  return created;
}

export function posLocationIdFromStoreKey(storeKey) {
  const text = String(storeKey || '').trim();
  if (!text) return null;
  const match = text.match(/-(\d+)$/);
  if (match) return Number(match[1]);
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

function unixSeconds(value) {
  if (value instanceof Date) return Math.floor(value.getTime() / 1000);
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 1e12 ? Math.floor(value / 1000) : Math.floor(value);
  }
  if (value == null || value === '') return Math.floor(Date.now() / 1000);
  const parsed = Date.parse(value);
  if (!Number.isNaN(parsed)) return Math.floor(parsed / 1000);
  return Math.floor(Date.now() / 1000);
}

/** Same delivery object POS sends for a new receive row (no delivery id). */
function posReceiveDelivery(quantity, date) {
  return {
    location_id: null,
    product_id: null,
    deliverable_type: null,
    deliverable_id: null,
    shipment_id: null,
    sign: null,
    product: null,
    order: null,
    purchase: null,
    transfer: null,
    adjustment: null,
    date: unixSeconds(date),
    updated_at: null,
    gross_quantity: null,
    quantity: roundQty(quantity),
    gross_after: null,
    after: null,
    total_gross_after: null,
    total_after: null,
    location_after: null,
    cost: null,
    price: null,
    awc: null,
    estate: null,
    estate_after: null,
    total_estate_after: null,
  };
}

function posExistingReceiveDelivery(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = Number(raw.id);
  const quantity = toNumber(raw.quantity ?? raw.gross_quantity);
  if (!Number.isFinite(id) || id <= 0 || quantity == null) return null;
  return { ...posReceiveDelivery(quantity, raw.date), id };
}

/**
 * Receive quantities on a pending POS transfer. Same call as Inventory →
 * Transfers → Receive: POST /transfers/:id/receive with item id + deliveries.
 */
export async function receivePosTransfer(token, transferId, lines, baseUrl = API_BASE_URL) {
  if (!token) throw new Error('Not signed in.');
  const id = transferId != null ? String(transferId).trim() : '';
  if (!id) throw new Error('Missing POS transfer.');
  const body = (lines || [])
    .map((line) => {
      const itemId = Number(line.id);
      const quantity = roundQty(line.quantity);
      if (!Number.isFinite(itemId) || quantity <= 0) return null;
      const existing = (line.existing || [])
        .map(posExistingReceiveDelivery)
        .filter(Boolean);
      return {
        id: itemId,
        deliveries: [...existing, posReceiveDelivery(quantity)],
      };
    })
    .filter(Boolean);
  if (body.length === 0) {
    throw new Error('Nothing to receive.');
  }

  const response = await posFetch(`${baseUrl}/transfers/${encodeURIComponent(id)}/receive`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(body),
  });
  const payload = await parseJsonResponse(response);
  if (!response.ok) {
    throw new Error(getErrorMessage(payload, 'Failed to receive transfer in POS.'));
  }
  return payload;
}

function plannedItemIds(itemIds) {
  if (itemIds == null) return null;
  if (itemIds instanceof Set) return itemIds;
  return new Set((Array.isArray(itemIds) ? itemIds : [itemIds]).map(String));
}

function plannedPosTransferIds(planned) {
  return [
    ...new Set(
      [
        ...(Array.isArray(planned?.aureusTransfers) ? planned.aureusTransfers.map((row) => row?.id) : []),
        planned?.aureusId,
      ]
        .map((id) => (id != null && String(id).trim() ? String(id).trim() : ''))
        .filter(Boolean),
    ),
  ];
}

async function loadPlannedPosDetails(token, planned, baseUrl) {
  const transferIds = plannedPosTransferIds(planned);
  if (transferIds.length === 0) {
    throw new Error('This transfer was not created in POS.');
  }
  const details = [];
  for (const id of transferIds) {
    details.push(await fetchTransferDetail(token, id, baseUrl));
  }
  return details;
}

function matchPosReceiveItem(details, plannedItem, used) {
  const aureusId = String(plannedItem.aureusId || '');
  if (aureusId) {
    for (const transfer of details) {
      const item = (transfer.items || []).find((row) => String(row?.id || '') === aureusId);
      if (item && !used.has(`${transfer.id}:${item.id}`)) {
        used.add(`${transfer.id}:${item.id}`);
        return { transfer, item };
      }
    }
  }
  const productId = String(plannedItem.productId || '');
  if (!productId) return null;
  const fromLoc = posLocationIdFromStoreKey(plannedItem.fromId);
  const toLoc = posLocationIdFromStoreKey(plannedItem.toId);
  const filtered = details.filter((transfer) => {
    if (fromLoc && transfer.from?.id && Number(transfer.from.id) !== fromLoc) return false;
    if (toLoc && transfer.to?.id && Number(transfer.to.id) !== toLoc) return false;
    return true;
  });
  const pool = filtered.length ? filtered : details;
  for (const transfer of pool) {
    const item = (transfer.items || []).find((row) => {
      if (!row?.id || String(row.productId) !== productId) return false;
      return !used.has(`${transfer.id}:${row.id}`);
    });
    if (item) {
      used.add(`${transfer.id}:${item.id}`);
      return { transfer, item };
    }
  }
  return null;
}

async function ensureAtTransferLocation(
  token,
  employeeId,
  locationId,
  locationName,
  onLocationEnsured,
  baseUrl,
  missingMessage,
) {
  if (!locationId) throw new Error(missingMessage);
  const { mapped, changed } = await ensureEmployeeAtLocation(token, employeeId, {
    locationId,
    locationName,
    baseUrl,
  });
  if (changed) {
    await onLocationEnsured?.({
      locationId: mapped?.locationId || String(locationId),
      locationName: mapped?.locationName || locationName || '',
    });
  }
}

function retryablePosStatus(status) {
  return status === 404 || status === 405 || status === 501;
}

async function postPosJson(url, token, body) {
  const response = await posFetch(url, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(body),
  });
  const payload = await parseJsonResponse(response);
  return { response, payload };
}

/**
 * Undo received quantities on a POS transfer. POS treats the deliveries array
 * as the kept set, same as the receive form — empty deliveries unreceives.
 */
export async function unreceivePosTransfer(token, transferId, lines, baseUrl = API_BASE_URL) {
  if (!token) throw new Error('Not signed in.');
  const id = transferId != null ? String(transferId).trim() : '';
  if (!id) throw new Error('Missing POS transfer.');
  const body = (lines || [])
    .map((line) => {
      const itemId = Number(line.id);
      if (!Number.isFinite(itemId) || itemId <= 0) return null;
      const keep = (line.keep || []).map(posExistingReceiveDelivery).filter(Boolean);
      return { id: itemId, deliveries: keep };
    })
    .filter(Boolean);
  if (body.length === 0) {
    throw new Error('Nothing to unreceive.');
  }

  const itemIds = body.map((row) => row.id);
  const attempts = [
    { url: `${baseUrl}/transfers/${encodeURIComponent(id)}/unreceive`, body },
    { url: `${baseUrl}/transfers/${encodeURIComponent(id)}/unreceive`, body: { items: body } },
    { url: `${baseUrl}/transfers/${encodeURIComponent(id)}/unreceive`, body: { item_ids: itemIds } },
    { url: `${baseUrl}/transfers/${encodeURIComponent(id)}/receive`, body },
  ];

  let lastError = null;
  for (const attempt of attempts) {
    const { response, payload } = await postPosJson(attempt.url, token, attempt.body);
    if (response.ok) return payload;
    lastError = new Error(getErrorMessage(payload, 'Failed to unreceive transfer in POS.'));
    if (!retryablePosStatus(response.status) && response.status !== 422) throw lastError;
  }
  throw lastError || new Error('Failed to unreceive transfer in POS.');
}

async function deletePosTransferRecord(token, transferId, baseUrl = API_BASE_URL) {
  const id = String(transferId || '').trim();
  if (!id) throw new Error('Missing POS transfer.');
  const response = await posFetch(`${baseUrl}/transfers/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: authHeaders(token),
  });
  if (response.ok || response.status === 204 || response.status === 404) return true;
  const payload = await parseJsonResponse(response);
  throw new Error(getErrorMessage(payload, 'Failed to delete transfer in POS.'));
}

async function deletePosTransferItemLine(token, transferId, itemId, baseUrl) {
  const id = String(transferId || '').trim();
  const lineId = String(itemId || '').trim();
  if (!id || !lineId) throw new Error('Missing POS transfer item.');

  const deleteUrls = [
    `${baseUrl}/transfers/${encodeURIComponent(id)}/items/${encodeURIComponent(lineId)}`,
    `${baseUrl}/transfers/${encodeURIComponent(id)}/transfer_items/${encodeURIComponent(lineId)}`,
  ];
  let lastError = null;
  for (const url of deleteUrls) {
    const response = await posFetch(url, {
      method: 'DELETE',
      headers: authHeaders(token),
    });
    if (response.ok || response.status === 204) return true;
    const payload = await parseJsonResponse(response);
    lastError = new Error(getErrorMessage(payload, 'Failed to delete transfer item in POS.'));
    if (!retryablePosStatus(response.status)) throw lastError;
  }
  throw lastError || new Error('Failed to delete transfer item in POS.');
}

async function putPosTransferItems(token, transfer, remainingItems, baseUrl) {
  const fromId = Number(transfer?.from?.id);
  const toId = Number(transfer?.to?.id);
  if (!Number.isFinite(fromId) || !Number.isFinite(toId)) {
    throw new Error('Failed to delete transfer item in POS.');
  }
  const body = {
    from_location_id: fromId,
    to_location_id: toId,
    transfer_mode: transfer?.transferMode || DEFAULT_TRANSFER_MODE,
    tracking_number: transfer?.tracking || null,
    comments: transfer?.comments || null,
    images: [],
    items: remainingItems.map((item) => ({
      id: Number(item.id),
      product_id: Number(item.productId),
      quantity: roundQty(item.quantity),
      gross_quantity: roundQty(item.quantity ?? item.gross_quantity),
    })),
  };
  const response = await posFetch(`${baseUrl}/transfers/${encodeURIComponent(transfer.id)}`, {
    method: 'PUT',
    headers: authHeaders(token),
    body: JSON.stringify(body),
  });
  const payload = await parseJsonResponse(response);
  if (!response.ok) {
    throw new Error(getErrorMessage(payload, 'Failed to delete transfer item in POS.'));
  }
  return payload;
}

/**
 * Remove line items from a POS transfer. Received lines are unreceived first
 * so inventory returns to the sending store.
 */
export async function deletePosTransferItems(
  token,
  transfer,
  itemIds,
  { employeeId, onLocationEnsured, baseUrl = API_BASE_URL } = {},
) {
  if (!token) throw new Error('Not signed in.');
  const id = transfer?.id != null ? String(transfer.id).trim() : '';
  if (!id) throw new Error('Missing POS transfer.');
  const wanted = new Set((itemIds || []).map(String));
  const items = (transfer.items || []).filter((item) => item?.id && wanted.has(String(item.id)));
  if (items.length === 0) throw new Error('Nothing to delete.');

  const received = items.filter((item) => (Number(item.receivedQuantity) || 0) > 0);
  if (received.length) {
    if (!employeeId) {
      throw new Error('Your POS user is missing, so the transfer cannot be unreceived.');
    }
    await ensureAtTransferLocation(
      token,
      employeeId,
      transfer.to?.id,
      transfer.to?.name || '',
      onLocationEnsured,
      baseUrl,
      'POS did not return the receiving store.',
    );
    await unreceivePosTransfer(
      token,
      id,
      received.map((item) => ({ id: item.id, keep: [] })),
      baseUrl,
    );
  }

  if (employeeId && transfer.from?.id) {
    await ensureAtTransferLocation(
      token,
      employeeId,
      transfer.from.id,
      transfer.from.name || '',
      onLocationEnsured,
      baseUrl,
      'POS did not return the sending store.',
    );
  }

  const remaining = (transfer.items || []).filter((item) => item?.id && !wanted.has(String(item.id)));
  let deletedTransfer = false;
  if (remaining.length === 0) {
    await deletePosTransferRecord(token, id, baseUrl);
    deletedTransfer = true;
  } else {
    const failed = [];
    for (const item of items) {
      try {
        await deletePosTransferItemLine(token, id, item.id, baseUrl);
      } catch (err) {
        failed.push({ item, err });
      }
    }
    if (failed.length === items.length) {
      await putPosTransferItems(token, transfer, remaining, baseUrl);
    } else if (failed.length) {
      throw failed[0].err;
    }
  }

  if (deletedTransfer) {
    return { transfer: null, deletedTransfer: true, removedIds: items.map((item) => String(item.id)) };
  }
  const next = await fetchTransferDetail(token, id, baseUrl);
  return { transfer: next, deletedTransfer: false, removedIds: items.map((item) => String(item.id)) };
}

export async function receivePosTransferItems(
  token,
  transfer,
  itemIds,
  { employeeId, onLocationEnsured, baseUrl = API_BASE_URL } = {},
) {
  if (!token) throw new Error('Not signed in.');
  if (!employeeId) {
    throw new Error('Your POS user is missing, so the transfer cannot be received.');
  }
  const id = transfer?.id != null ? String(transfer.id).trim() : '';
  if (!id) throw new Error('Missing POS transfer.');
  const wanted = itemIds == null ? null : new Set((itemIds || []).map(String));
  const lines = (transfer.items || [])
    .map((item) => {
      if (!item?.id) return null;
      if (wanted && !wanted.has(String(item.id))) return null;
      const sent = Number(item.quantity) || 0;
      const already = Number(item.receivedQuantity) || 0;
      const qty = roundQty(Math.max(0, sent - already));
      if (qty <= 0) return null;
      return { id: item.id, quantity: qty, existing: item.receivedDeliveries };
    })
    .filter(Boolean);
  if (lines.length === 0) throw new Error('Nothing left to receive.');

  await ensureAtTransferLocation(
    token,
    employeeId,
    transfer.to?.id,
    transfer.to?.name || '',
    onLocationEnsured,
    baseUrl,
    'POS did not return the receiving store.',
  );
  await receivePosTransfer(token, id, lines, baseUrl);
  return fetchTransferDetail(token, id, baseUrl);
}

export async function unreceivePosTransferItems(
  token,
  transfer,
  itemIds,
  { employeeId, onLocationEnsured, baseUrl = API_BASE_URL } = {},
) {
  if (!token) throw new Error('Not signed in.');
  if (!employeeId) {
    throw new Error('Your POS user is missing, so the transfer cannot be unreceived.');
  }
  const id = transfer?.id != null ? String(transfer.id).trim() : '';
  if (!id) throw new Error('Missing POS transfer.');
  const wanted = itemIds == null ? null : new Set((itemIds || []).map(String));
  const lines = (transfer.items || []).filter((item) => {
    if (!item?.id) return false;
    if (wanted && !wanted.has(String(item.id))) return false;
    return (Number(item.receivedQuantity) || 0) > 0 || (item.receivedDeliveries || []).length > 0;
  });
  if (lines.length === 0) throw new Error('Nothing to unreceive.');

  await ensureAtTransferLocation(
    token,
    employeeId,
    transfer.to?.id,
    transfer.to?.name || '',
    onLocationEnsured,
    baseUrl,
    'POS did not return the receiving store.',
  );
  await unreceivePosTransfer(
    token,
    id,
    lines.map((item) => ({ id: item.id, keep: [] })),
    baseUrl,
  );
  return fetchTransferDetail(token, id, baseUrl);
}

/**
 * Receive one or all Active-tab lines into POS. Switches the employee to each
 * destination store first — POS only posts receive at the to location.
 */
export async function receivePlannedPosItems(
  token,
  planned,
  { itemIds, employeeId, onLocationEnsured, baseUrl = API_BASE_URL } = {},
) {
  if (!token) throw new Error('Not signed in.');
  if (!employeeId) {
    throw new Error('Your POS user is missing, so the transfer cannot be received.');
  }
  const details = await loadPlannedPosDetails(token, planned, baseUrl);

  const wanted = plannedItemIds(itemIds);
  const targets = (planned?.items || []).filter((item) => {
    if (wanted && !wanted.has(String(item.id))) return false;
    if (item.received) return false;
    return (item.sentQty || 0) > 0;
  });
  if (targets.length === 0) {
    throw new Error('Nothing left to receive.');
  }

  const used = new Set();
  const groups = new Map();
  const localUpdates = {};

  for (const item of targets) {
    const matched = matchPosReceiveItem(details, item, used);
    if (!matched) {
      throw new Error(`POS has no line for ${item.productName || 'this item'}.`);
    }
    const sent = Number(matched.item.quantity) || item.sentQty || 0;
    const already = Number(matched.item.receivedQuantity) || 0;
    const remaining = Math.max(0, roundQty(sent - already));
    const requested = wanted
      ? item.receivedQty == null
        ? item.sentQty
        : Math.max(0, Number(item.receivedQty) || 0)
      : item.sentQty;
    const qty = Math.min(requested || remaining, remaining);
    if (qty <= 0) {
      localUpdates[item.id] = {
        receivedQty: already,
        received: already >= item.sentQty,
        aureusId: matched.item.id,
      };
      continue;
    }
    if (!groups.has(matched.transfer.id)) {
      groups.set(matched.transfer.id, {
        transfer: matched.transfer,
        lines: [],
        local: [],
      });
    }
    const group = groups.get(matched.transfer.id);
    group.lines.push({
      id: matched.item.id,
      quantity: qty,
      existing: matched.item.receivedDeliveries,
    });
    group.local.push({
      itemId: item.id,
      qty,
      sent: item.sentQty,
      already,
      aureusId: matched.item.id,
    });
  }

  if (groups.size === 0) return localUpdates;

  for (const group of groups.values()) {
    await ensureAtTransferLocation(
      token,
      employeeId,
      group.transfer.to?.id,
      group.transfer.to?.name || '',
      onLocationEnsured,
      baseUrl,
      'POS did not return the receiving store.',
    );
    await receivePosTransfer(token, group.transfer.id, group.lines, baseUrl);
    for (const loc of group.local) {
      const receivedQty = roundQty(loc.already + loc.qty);
      localUpdates[loc.itemId] = {
        receivedQty,
        received: receivedQty >= loc.sent,
        aureusId: loc.aureusId,
      };
    }
  }

  return localUpdates;
}

/**
 * Undo received Active-tab lines in POS and return local receivedQty updates.
 */
export async function unreceivePlannedPosItems(
  token,
  planned,
  { itemIds, employeeId, onLocationEnsured, baseUrl = API_BASE_URL } = {},
) {
  if (!token) throw new Error('Not signed in.');
  if (!employeeId) {
    throw new Error('Your POS user is missing, so the transfer cannot be unreceived.');
  }
  if (plannedPosTransferIds(planned).length === 0) {
    const wanted = plannedItemIds(itemIds);
    const localUpdates = {};
    for (const item of planned?.items || []) {
      if (wanted && !wanted.has(String(item.id))) continue;
      if (!item.received && !(Number(item.receivedQty) || 0)) continue;
      localUpdates[item.id] = { receivedQty: 0, received: false };
    }
    if (Object.keys(localUpdates).length === 0) throw new Error('Nothing to unreceive.');
    return localUpdates;
  }
  const details = await loadPlannedPosDetails(token, planned, baseUrl);
  const wanted = plannedItemIds(itemIds);
  const targets = (planned?.items || []).filter((item) => {
    if (wanted && !wanted.has(String(item.id))) return false;
    return item.received || (Number(item.receivedQty) || 0) > 0;
  });
  if (targets.length === 0) {
    throw new Error('Nothing to unreceive.');
  }

  const used = new Set();
  const groups = new Map();
  const localUpdates = {};

  for (const item of targets) {
    const matched = matchPosReceiveItem(details, item, used);
    if (!matched) {
      throw new Error(`POS has no line for ${item.productName || 'this item'}.`);
    }
    if (!groups.has(matched.transfer.id)) {
      groups.set(matched.transfer.id, { transfer: matched.transfer, lines: [], local: [] });
    }
    const group = groups.get(matched.transfer.id);
    group.lines.push({ id: matched.item.id, keep: [] });
    group.local.push({ itemId: item.id, aureusId: matched.item.id });
  }

  for (const group of groups.values()) {
    await ensureAtTransferLocation(
      token,
      employeeId,
      group.transfer.to?.id,
      group.transfer.to?.name || '',
      onLocationEnsured,
      baseUrl,
      'POS did not return the receiving store.',
    );
    await unreceivePosTransfer(token, group.transfer.id, group.lines, baseUrl);
    for (const loc of group.local) {
      localUpdates[loc.itemId] = { receivedQty: 0, received: false, aureusId: loc.aureusId };
    }
  }

  return localUpdates;
}

/**
 * Delete Active-tab lines from POS. Received lines are unreceived first.
 */
export async function deletePlannedPosItems(
  token,
  planned,
  { itemIds, employeeId, onLocationEnsured, baseUrl = API_BASE_URL } = {},
) {
  if (!token) throw new Error('Not signed in.');
  if (!employeeId) {
    throw new Error('Your POS user is missing, so the transfer cannot be updated.');
  }
  if (plannedPosTransferIds(planned).length === 0) {
    const wanted = plannedItemIds(itemIds);
    const removedIds = (planned?.items || [])
      .filter((item) => !wanted || wanted.has(String(item.id)))
      .map((item) => item.id);
    if (removedIds.length === 0) throw new Error('Nothing to delete.');
    return {
      removedIds,
      deletedTransfer: removedIds.length >= (planned.items || []).length,
      aureusTransfers: [],
      aureusId: null,
      transferCode: '',
    };
  }
  const details = await loadPlannedPosDetails(token, planned, baseUrl);
  const wanted = plannedItemIds(itemIds);
  const targets = (planned?.items || []).filter((item) => {
    if (wanted && !wanted.has(String(item.id))) return false;
    return true;
  });
  if (targets.length === 0) {
    throw new Error('Nothing to delete.');
  }

  const used = new Set();
  const groups = new Map();
  const removedIds = [];

  for (const item of targets) {
    const matched = matchPosReceiveItem(details, item, used);
    if (!matched) {
      throw new Error(`POS has no line for ${item.productName || 'this item'}.`);
    }
    if (!groups.has(matched.transfer.id)) {
      groups.set(matched.transfer.id, {
        transfer: matched.transfer,
        itemIds: [],
        localIds: [],
      });
    }
    const group = groups.get(matched.transfer.id);
    group.itemIds.push(matched.item.id);
    group.localIds.push(item.id);
  }

  const remainingPosIds = new Set(details.map((row) => String(row.id)));
  for (const group of groups.values()) {
    const result = await deletePosTransferItems(token, group.transfer, group.itemIds, {
      employeeId,
      onLocationEnsured,
      baseUrl,
    });
    removedIds.push(...group.localIds);
    if (result.deletedTransfer) remainingPosIds.delete(String(group.transfer.id));
  }

  const aureusTransfers = (planned.aureusTransfers || []).filter((row) =>
    remainingPosIds.has(String(row?.id || '')),
  );
  const primary = aureusTransfers[0] || null;
  return {
    removedIds,
    deletedTransfer: remainingPosIds.size === 0,
    aureusTransfers,
    aureusId: primary?.id != null ? String(primary.id) : null,
    transferCode: primary?.transferCode || '',
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
  const extras = ['items,product,inventory_product,from_location,to_location,received_deliveries', ''];
  let lastError = null;
  let transfer = null;

  for (const extra of extras) {
    const params = new URLSearchParams();
    if (extra) params.set('extra', extra);
    const qs = params.toString();
    const response = await posFetch(`${baseUrl}/transfers/${id}${qs ? `?${qs}` : ''}`, {
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

  if (!transfer.hasItems || !(transfer.items || []).some((item) => item.id)) {
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
      const response = await posFetch(url, { method: 'GET', headers: authHeaders(token) });
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
