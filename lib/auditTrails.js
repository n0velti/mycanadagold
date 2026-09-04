import { API_BASE_URL, authHeaders, getLinkedPosSessions } from './auth';
import { formatDateParam, parseDateParam } from './transactions';

const ITEMS_PER_PAGE = 200;
const MAX_PAGES = 25;
const DETAIL_CONCURRENCY = 6;
const MAX_DETAILS = 120;
const MAX_PAYLOAD_EVENTS = 36;

const CASH_ENTITY_TYPES = ['cash_logs', 'payments', 'cash_transactions'];
const BULLION_ENTITY_TYPES = ['inventory_logs', 'orders', 'purchases', 'transfers'];
/** Entity types the POS may not expose; failures are ignored instead of warned. */
const OPTIONAL_ENTITY_TYPES = new Set(['transfers']);

const MATERIAL_FIELDS = new Set([
  'amount',
  'vault_count',
  'store_count',
  'other_count',
  'date',
  'type',
  'status',
  'payment_status',
  'item_status',
  'quantity',
  'fulfilled_quantity',
  'total_amount',
  'total_delivered',
  'total_products',
  'currency',
  'payment_type_id',
  'comments',
  'category',
  'till_id',
  'location_id',
  'product_id',
  'items',
  'payment_transactions',
  'from_location_id',
  'to_location_id',
  'received_at',
]);

const NOISY_FIELDS = new Set([
  'uuid',
  'user_id',
  'created_at',
  'updated_at',
  'charges',
  'exchange_rate',
  'irs_details',
  'reported_to_irs_at',
  'gateway',
  'gateway_details',
  'spot_prices',
  'ler_details',
  'shipping_address_id',
  'billing_address_id',
  'ebay_order_id',
  'non_inventoried_purchase_id',
  'tax_avalara_code',
  'avalara_tax_override',
  'statement_confirmed',
  'source',
  'notes',
  'card_id',
  'refund',
  'txn_id',
  'sub_type',
  'bank_account',
]);

const STATE_FIELDS = {
  cash_logs: ['location_id', 'till_id', 'date', 'amount', 'currency'],
  payments: [
    'location_id',
    'till_id',
    'date',
    'amount',
    'currency',
    'type',
    'status',
    'payment_type_id',
    'comments',
    'check_no',
    'payable_type',
    'payable_id',
  ],
  cash_transactions: [
    'location_id',
    'till_id',
    'date',
    'amount',
    'currency',
    'type',
    'category',
    'comments',
  ],
  inventory_logs: [
    'product_id',
    'location_id',
    'date',
    'vault_count',
    'store_count',
    'other_count',
    'amount',
  ],
  orders: [
    'location_id',
    'date',
    'currency',
    'item_status',
    'payment_status',
    'total_amount',
    'total_delivered',
    'total_products',
    'comments',
    'client_name',
  ],
  purchases: [
    'location_id',
    'date',
    'currency',
    'item_status',
    'payment_status',
    'total_amount',
    'total_products',
    'comments',
    'client_name',
  ],
  transfers: [
    'from_location_id',
    'to_location_id',
    'date',
    'status',
    'received_at',
    'total_products',
    'comments',
  ],
};

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

export function resolveAuditSystem(session, systemKey) {
  const systems = posSystemsFromSession(session);
  if (!systems.length) throw new Error('Not signed in.');
  if (systemKey) {
    const match = systems.find((system) => system.key === systemKey);
    if (match) return match;
  }
  return systems[0];
}

function paginationMeta(payload) {
  const meta = payload?.meta?.pagination || payload?.meta || payload?.pagination || {};
  const current = Number(meta.current_page ?? payload?.current_page ?? meta.page) || 1;
  const last =
    Number(meta.last_page ?? payload?.last_page ?? meta.total_pages ?? payload?.total_pages) ||
    null;
  const perPage = Number(meta.per_page ?? meta.items_per_page ?? payload?.per_page) || null;
  const total = Number(meta.total ?? payload?.total) || null;
  return { current, last, perPage, total };
}

function toNumber(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function roundQty(value) {
  return Math.round((Number(value) || 0) * 1000) / 1000;
}

function stripHtml(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function dateKeyFromValue(value) {
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

function trailClock(unix) {
  const seconds = Number(unix);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return { at: null, trailDate: null, trailTime: null };
  }
  const ms = seconds > 1e12 ? seconds : seconds * 1000;
  const iso = new Date(ms).toISOString();
  return {
    at: iso,
    trailDate: iso.slice(0, 10),
    trailTime: iso.slice(11, 19) + 'Z',
  };
}

function idsEqual(a, b) {
  if (a == null || b == null || a === '' || b === '') return false;
  return String(a) === String(b);
}

function locationIdOf(row) {
  return (
    row?.entity?.location_id ??
    row?.state_after?.location_id ??
    row?.location_id ??
    null
  );
}

/** Transfers touch two locations; everything else has one. */
function trailTouchesLocation(row, locationId) {
  if (idsEqual(locationIdOf(row), locationId)) return true;
  const sources = [row?.entity, row?.state_after, row?.state_before, row];
  return sources.some(
    (source) =>
      source &&
      (idsEqual(source.from_location_id, locationId) || idsEqual(source.to_location_id, locationId)),
  );
}

function productIdOf(row) {
  return row?.entity?.product_id ?? row?.state_after?.product_id ?? row?.product_id ?? null;
}

function parseMaybeJson(value) {
  if (typeof value !== 'string') return value;
  const text = value.trim();
  if (!text || (text[0] !== '{' && text[0] !== '[')) return value;
  try {
    return JSON.parse(text);
  } catch {
    return value;
  }
}

function compactLineItem(item) {
  if (!item || typeof item !== 'object') return null;
  const details = item.product_details || {};
  return {
    productId: item.product_id ?? details.id ?? null,
    sku: details.code || details.sku || item.sku || '',
    name: item.description || details.description || details.name || '',
    quantity: toNumber(item.quantity),
    fulfilledQuantity: toNumber(item.fulfilled_quantity),
    price: toNumber(item.price ?? item.default_unit_price),
  };
}

function compactItems(value) {
  const parsed = parseMaybeJson(value);
  if (!Array.isArray(parsed)) return null;
  return parsed.map(compactLineItem).filter(Boolean);
}

function compactPaymentLinks(value) {
  const parsed = parseMaybeJson(value);
  if (!Array.isArray(parsed)) return null;
  return parsed
    .map((entry) => ({
      paymentId: entry?.payment_id ?? null,
      payableType: entry?.payable_type || '',
      payableId: entry?.payable_id ?? null,
      amount: toNumber(entry?.amount),
    }))
    .filter((entry) => entry.paymentId != null || entry.payableId != null);
}

function pickState(state, entityType) {
  if (!state || typeof state !== 'object') return null;
  const keys = STATE_FIELDS[entityType] || Object.keys(state).slice(0, 12);
  const out = {};
  for (const key of keys) {
    if (state[key] != null && state[key] !== '') out[key] = state[key];
  }
  return Object.keys(out).length ? out : null;
}

function compactDiffValue(field, value) {
  if (field === 'items') return compactItems(value) ?? value;
  if (field === 'payment_transactions') return compactPaymentLinks(value) ?? value;
  if (typeof value === 'string' && value.length > 280) return `${value.slice(0, 280)}…`;
  return parseMaybeJson(value);
}

function compactDiffs(diffs) {
  if (!Array.isArray(diffs)) return [];
  const out = [];
  for (const diff of diffs) {
    const field = String(diff?.field || '');
    if (!field || NOISY_FIELDS.has(field)) continue;
    const type = String(diff?.type || 'change');
    const entry = {
      field,
      type,
    };
    if (type === 'unset' || diff?.previous !== undefined) {
      entry.previous = compactDiffValue(field, diff.previous);
    }
    if (type !== 'unset' && (diff?.value !== undefined || diff?.new !== undefined)) {
      entry.value = compactDiffValue(field, diff.value ?? diff.new);
    }
    out.push(entry);
  }
  return out;
}

function numericDelta(previous, next) {
  const from = toNumber(previous);
  const to = toNumber(next);
  if (from == null || to == null) return null;
  return roundMoney(to - from);
}

function signedPaymentAmount(state) {
  const amount = toNumber(state?.amount) || 0;
  return String(state?.type || '') === 'Out' ? -amount : amount;
}

function recordDateOf(row) {
  return dateKeyFromValue(row?.state_after?.date ?? row?.entity?.date ?? row?.date);
}

function entityLabel(entityType, entityId, state) {
  const id = entityId != null ? `#${entityId}` : '';
  if (entityType === 'orders') return `SO${id}`;
  if (entityType === 'purchases') return `PO${id}`;
  if (entityType === 'payments') return `payment ${id}`;
  if (entityType === 'cash_logs') {
    const currency = state?.currency ? ` ${state.currency}` : '';
    return `cash log ${id}${currency}`;
  }
  if (entityType === 'cash_transactions') return `till txn ${id}`;
  if (entityType === 'transfers') return `TR${id}`;
  if (entityType === 'inventory_logs') {
    const product = state?.product_id != null ? ` product #${state.product_id}` : '';
    return `inventory log ${id}${product}`;
  }
  return `${entityType} ${id}`.trim();
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

  const workers = Array.from(
    { length: Math.min(limit, items.length || 1) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}

/**
 * GET /audit_trails?extra=user,auditable&filters[start_date]&filters[end_date]
 * POS list does not include readable_differences; those are on the detail call.
 */
export async function fetchAuditTrailList(
  token,
  { startDate, endDate, entityType, baseUrl = API_BASE_URL } = {},
) {
  const all = [];
  let page = 1;
  const seen = new Set();
  const start = formatDateParam(parseDateParam(startDate));
  const end = formatDateParam(parseDateParam(endDate || startDate));

  while (page <= MAX_PAGES) {
    const params = new URLSearchParams();
    params.set('extra', 'user,auditable');
    params.set('page', String(page));
    params.set('items_per_page', String(ITEMS_PER_PAGE));
    params.set('filters[start_date]', start);
    params.set('filters[end_date]', end);
    params.set('sort[field]', 'date');
    params.set('sort[dir]', 'desc');
    if (entityType) params.set('filters[entity_type]', entityType);

    const response = await fetch(`${baseUrl}/audit_trails?${params.toString()}`, {
      method: 'GET',
      headers: authHeaders(token),
    });
    const payload = await parseJsonResponse(response);
    if (!response.ok) {
      throw new Error(getErrorMessage(payload, 'Failed to load audit trails.'));
    }

    const batch = Array.isArray(payload?.data)
      ? payload.data
      : Array.isArray(payload)
        ? payload
        : [];

    let newCount = 0;
    for (const item of batch) {
      const key = item?.id != null ? String(item.id) : null;
      if (key != null) {
        if (seen.has(key)) continue;
        seen.add(key);
      }
      all.push(item);
      newCount += 1;
    }

    const { last, perPage } = paginationMeta(payload);
    const pageSize = perPage || ITEMS_PER_PAGE;
    if (last == null) break;
    if (page >= last) break;
    if (batch.length === 0 || newCount === 0) break;
    if (batch.length < pageSize) break;
    page += 1;
  }

  return all;
}

/** GET /audit_trails/:id — includes readable_differences (previous → value). */
export async function fetchAuditTrailDetail(token, id, baseUrl = API_BASE_URL) {
  const response = await fetch(`${baseUrl}/audit_trails/${id}`, {
    method: 'GET',
    headers: authHeaders(token),
  });
  const payload = await parseJsonResponse(response);
  if (!response.ok) {
    throw new Error(getErrorMessage(payload, `Failed to load audit trail ${id}.`));
  }
  return payload?.data && typeof payload.data === 'object' ? payload.data : payload;
}

function needsDetail(row) {
  const action = String(row?.action || '').toLowerCase();
  return action === 'update' || action === 'delivered';
}

function compactTrail(row, detail) {
  const merged = detail ? { ...row, ...detail } : row;
  const entityType = String(merged.entity_type || '');
  const action = String(merged.action || '');
  const state = merged.state_after || {};
  const clock = trailClock(merged.date);
  const recordDate = recordDateOf(merged);
  const changes = compactDiffs(merged.readable_differences);
  const amountChange = changes.find((change) => change.field === 'amount');
  const dateChange = changes.find((change) => change.field === 'date');

  const trail = {
    id: merged.id,
    entityType,
    entityId: merged.entity_id ?? null,
    label: entityLabel(entityType, merged.entity_id, state),
    action,
    user: merged.user_name || 'Unknown',
    at: clock.at,
    trailDate: clock.trailDate,
    recordDate,
    dateMismatch: Boolean(
      clock.trailDate && recordDate && clock.trailDate !== recordDate,
    ),
    locationId: locationIdOf(merged),
    productId: productIdOf(merged),
    description: stripHtml(merged.description),
    after: pickState(state, entityType),
    changes,
  };

  if (amountChange) {
    trail.amountFrom = toNumber(amountChange.previous);
    trail.amountTo = toNumber(amountChange.value);
    trail.amountDelta = numericDelta(amountChange.previous, amountChange.value);
  } else if (action === 'create' || action === 'delete') {
    const amount = toNumber(state.amount ?? state.total_amount);
    if (amount != null) {
      trail.amountTo = action === 'delete' ? 0 : amount;
      trail.amountFrom = action === 'delete' ? amount : 0;
      trail.amountDelta =
        action === 'delete' ? roundMoney(-amount) : roundMoney(amount);
    }
  }

  if (dateChange) {
    trail.recordDateFrom = dateKeyFromValue(dateChange.previous);
    trail.recordDateTo = dateKeyFromValue(dateChange.value) || recordDate;
  }

  const itemChange = changes.find((change) => change.field === 'items');
  if (itemChange) {
    trail.itemsPrevious = Array.isArray(itemChange.previous) ? itemChange.previous : null;
    trail.items = Array.isArray(itemChange.value) ? itemChange.value : null;
  }

  return trail;
}

function isMaterialTrail(trail) {
  const action = String(trail.action || '').toLowerCase();
  if (action === 'report_to_irs' || action === 'report') return false;
  if (action === 'delete' || action === 'delivered') return true;
  if (trail.dateMismatch) return true;
  if (action === 'create') {
    return (
      trail.entityType === 'cash_logs' ||
      trail.entityType === 'inventory_logs' ||
      trail.entityType === 'cash_transactions' ||
      trail.entityType === 'transfers'
    );
  }
  if (trail.entityType === 'transfers') return true;
  if (trail.amountDelta != null && Math.abs(trail.amountDelta) >= 0.005) return true;
  return (trail.changes || []).some(
    (change) => MATERIAL_FIELDS.has(change.field) && change.type !== 'set',
  );
}

function rankTrail(trail) {
  const action = String(trail.action || '').toLowerCase();
  let score = 0;
  if (action === 'delete') score += 50;
  if (trail.dateMismatch) score += 40;
  if (action === 'delivered') score += 20;
  if (trail.amountDelta != null) score += Math.min(30, Math.abs(trail.amountDelta) / 50);
  if ((trail.changes || []).some((change) => change.field === 'vault_count' || change.field === 'store_count')) {
    score += 25;
  }
  if ((trail.changes || []).some((change) => change.field === 'items')) score += 15;
  if (action === 'update') score += 8;
  if (action === 'create') score += 2;
  return score;
}

function countFieldChanges(trails, entityType, field) {
  const rows = [];
  for (const trail of trails) {
    if (entityType && trail.entityType !== entityType) continue;
    const change = (trail.changes || []).find((entry) => entry.field === field);
    if (!change) continue;
    const from = toNumber(change.previous);
    const to = toNumber(change.value);
    rows.push({
      id: trail.id,
      label: trail.label,
      user: trail.user,
      at: trail.at,
      trailDate: trail.trailDate,
      recordDate: trail.recordDate,
      from,
      to,
      delta: numericDelta(change.previous, change.value),
      currency: trail.after?.currency || null,
    });
  }
  return rows;
}

function paymentImpact(trails) {
  let backdatedCreatedIn = 0;
  let backdatedCreatedOut = 0;
  let deletedIn = 0;
  let deletedOut = 0;
  let amountChangeNet = 0;
  const backdated = [];
  const deleted = [];
  const amountEdits = [];
  const seenDelete = new Set();
  const seenAmount = new Set();

  for (const trail of trails) {
    if (trail.entityType !== 'payments') continue;
    const state = trail.after || {};
    const signed = signedPaymentAmount(state);
    const action = String(trail.action || '').toLowerCase();
    const entityKey = String(trail.entityId ?? trail.id);
    if (action === 'create' && trail.dateMismatch) {
      if (signed >= 0) backdatedCreatedIn += signed;
      else backdatedCreatedOut += Math.abs(signed);
      backdated.push(summarizeEvent(trail));
    } else if (action === 'delete') {
      if (seenDelete.has(entityKey)) continue;
      seenDelete.add(entityKey);
      if (signed >= 0) deletedIn += signed;
      else deletedOut += Math.abs(signed);
      deleted.push(summarizeEvent(trail));
    } else if (action === 'update' && trail.amountDelta != null) {
      const changeKey = `${entityKey}:${trail.amountFrom}->${trail.amountTo}`;
      if (seenAmount.has(changeKey)) continue;
      seenAmount.add(changeKey);
      const direction = String(state.type || '') === 'Out' ? -1 : 1;
      amountChangeNet += trail.amountDelta * direction;
      amountEdits.push(summarizeEvent(trail));
    } else if (action === 'update' && trail.dateMismatch) {
      backdated.push(summarizeEvent(trail));
    }
  }

  return {
    backdatedCreatedIn: roundMoney(backdatedCreatedIn),
    backdatedCreatedOut: roundMoney(backdatedCreatedOut),
    deletedIn: roundMoney(deletedIn),
    deletedOut: roundMoney(deletedOut),
    amountChangeNet: roundMoney(amountChangeNet),
    netRemovedFromTill: roundMoney(deletedIn - deletedOut),
    backdated,
    deleted,
    amountEdits,
  };
}

function summarizeEvent(trail) {
  const event = {
    id: trail.id,
    label: trail.label,
    action: trail.action,
    user: trail.user,
    trailDate: trail.trailDate,
    recordDate: trail.recordDate,
    amount: toNumber(trail.after?.amount ?? trail.after?.total_amount),
    currency: trail.after?.currency || null,
  };
  if (trail.dateMismatch) event.dateMismatch = true;
  if (trail.amountDelta != null) event.amountDelta = trail.amountDelta;
  if (trail.after?.type) event.type = trail.after.type;
  if (trail.after?.status || trail.after?.payment_status || trail.after?.item_status) {
    event.status = trail.after.status || trail.after.payment_status || trail.after.item_status;
  }
  if (trail.after?.payment_type_id != null) event.paymentTypeId = trail.after.payment_type_id;
  if (trail.productId != null) event.productId = trail.productId;
  if (trail.after?.comments) event.comments = trail.after.comments;
  const items = trail.items || trail.itemsPrevious;
  if (items?.length) event.items = items;
  const changes = (trail.changes || []).filter((change) => MATERIAL_FIELDS.has(change.field));
  if (changes.length) event.changes = changes;
  return event;
}

/** Compact trail block for the AI prompt (numbers + top events, no duplicate lists). */
export function compactAuditTrailsForPrompt(trails) {
  if (!trails) return null;
  const recon = trails.reconciliation || {};
  const payments = recon.payments
    ? {
        deletedIn: recon.payments.deletedIn,
        deletedOut: recon.payments.deletedOut,
        amountChangeNet: recon.payments.amountChangeNet,
        netRemovedFromTill: recon.payments.netRemovedFromTill,
        backdatedCreatedIn: recon.payments.backdatedCreatedIn,
        backdatedCreatedOut: recon.payments.backdatedCreatedOut,
      }
    : null;
  const timelines = (recon.cashLogTimelines || []).filter(
    (row) => Math.abs(row.netRevision || 0) >= 0.005 || row.edits?.length,
  );
  return {
    trailCount: trails.trailCount || 0,
    materialCount: trails.materialCount || 0,
    dateMismatches: (trails.dateMismatches || []).slice(0, 16),
    cashLogTimelines: timelines.length ? timelines : undefined,
    tillAdjustmentRevisions: recon.tillAdjustmentRevisions?.length
      ? recon.tillAdjustmentRevisions
      : undefined,
    paymentImpact: payments || undefined,
    bullion: recon.products
      ? {
          products: recon.products.slice(0, 12),
          deliveredOrDeletedTx: (recon.deliveredOrDeletedTx || []).slice(0, 16),
        }
      : undefined,
    events: (trails.events || []).slice(0, MAX_PAYLOAD_EVENTS),
  };
}

function cashLogTimelines(trails) {
  const groups = new Map();
  for (const trail of trails) {
    if (trail.entityType !== 'cash_logs') continue;
    const currency = String(trail.after?.currency || 'CAD').toUpperCase();
    const key = `${trail.entityId || trail.id}:${currency}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(trail);
  }

  const timelines = [];
  for (const events of groups.values()) {
    events.sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')));
    const first = events[0];
    const last = events[events.length - 1];
    const revisions = events.filter(
      (trail) =>
        String(trail.action).toLowerCase() === 'update' && trail.amountDelta != null,
    );
    const created = events.find((trail) => String(trail.action).toLowerCase() === 'create');
    const firstAmount =
      created?.amountTo ??
      created?.after?.amount ??
      revisions[0]?.amountFrom ??
      toNumber(first.after?.amount);
    const lastAmount = toNumber(last.after?.amount) ?? last.amountTo ?? firstAmount;
    const firstNum = toNumber(firstAmount);
    const lastNum = toNumber(lastAmount);
    timelines.push({
      cashLogId: first.entityId,
      currency: String(first.after?.currency || 'CAD').toUpperCase(),
      recordDate: last.recordDate || first.recordDate,
      firstAmount: firstNum,
      lastAmount: lastNum,
      netRevision:
        firstNum != null && lastNum != null ? roundMoney(lastNum - firstNum) : roundMoney(0),
      edits: revisions.map((trail) => ({
        id: trail.id,
        user: trail.user,
        at: trail.at,
        from: trail.amountFrom,
        to: trail.amountTo,
        delta: trail.amountDelta,
      })),
    });
  }
  return timelines;
}

function buildCashReconciliation(trails) {
  const cashLogRevisions = countFieldChanges(trails, 'cash_logs', 'amount');
  const tillAdjRevisions = countFieldChanges(trails, 'cash_transactions', 'amount');

  return {
    howToAddUp:
      'Cash log amount revisions are physical-count edits (firstAmount → lastAmount). Same-day payment creates are already in cashPayments — do not double-count them. Focus on payment deletes, amount edits, and any recordDate that does not equal trailDate (backdated / post-dated). Those edits change expected vs counted even when the till sheet looks internally consistent.',
    cashLogTimelines: cashLogTimelines(trails),
    cashLogPhysicalRevisions: cashLogRevisions,
    tillAdjustmentRevisions: tillAdjRevisions,
    payments: paymentImpact(trails),
  };
}

function buildBullionReconciliation(trails, productIds) {
  const wanted = new Set((productIds || []).map(String));
  const byProduct = new Map();

  const ensure = (productId) => {
    const key = String(productId);
    if (!byProduct.has(key)) {
      byProduct.set(key, {
        productId: key,
        countRevisions: [],
        relatedOrders: [],
        relatedPurchases: [],
      });
    }
    return byProduct.get(key);
  };

  for (const trail of trails) {
    if (trail.entityType === 'inventory_logs' && trail.productId != null) {
      const wantedProduct = !wanted.size || wanted.has(String(trail.productId));
      if (!wantedProduct) continue;
      const bucket = ensure(trail.productId);
      const vault = (trail.changes || []).find((change) => change.field === 'vault_count');
      const store = (trail.changes || []).find((change) => change.field === 'store_count');
      const other = (trail.changes || []).find((change) => change.field === 'other_count');
      const amount = (trail.changes || []).find((change) => change.field === 'amount');
      bucket.countRevisions.push({
        ...summarizeEvent(trail),
        vaultFrom: vault ? toNumber(vault.previous) : null,
        vaultTo: vault ? toNumber(vault.value) : toNumber(trail.after?.vault_count),
        storeFrom: store ? toNumber(store.previous) : null,
        storeTo: store ? toNumber(store.value) : toNumber(trail.after?.store_count),
        otherFrom: other ? toNumber(other.previous) : null,
        otherTo: other ? toNumber(other.value) : toNumber(trail.after?.other_count),
        amountFrom: amount ? toNumber(amount.previous) : trail.amountFrom ?? null,
        amountTo: amount ? toNumber(amount.value) : trail.amountTo ?? toNumber(trail.after?.amount),
      });
    }

    const itemProductIds = [
      ...(trail.items || []),
      ...(trail.itemsPrevious || []),
    ]
      .map((item) => (item?.productId != null ? String(item.productId) : ''))
      .filter(Boolean);

    const matchesWanted =
      wanted.size === 0 ||
      itemProductIds.some((id) => wanted.has(id)) ||
      (trail.productId != null && wanted.has(String(trail.productId)));

    if (!matchesWanted && trail.entityType !== 'inventory_logs') continue;

    if (trail.entityType === 'orders') {
      const ids = itemProductIds.length ? itemProductIds : ['unknown'];
      for (const id of ids) {
        if (wanted.size && !wanted.has(id) && id !== 'unknown') continue;
        ensure(id === 'unknown' ? trail.entityId : id).relatedOrders.push({
          ...summarizeEvent(trail),
          items: trail.items || trail.itemsPrevious || null,
        });
      }
    }
    if (trail.entityType === 'purchases') {
      const ids = itemProductIds.length ? itemProductIds : ['unknown'];
      for (const id of ids) {
        if (wanted.size && !wanted.has(id) && id !== 'unknown') continue;
        ensure(id === 'unknown' ? trail.entityId : id).relatedPurchases.push({
          ...summarizeEvent(trail),
          items: trail.items || trail.itemsPrevious || null,
        });
      }
    }
  }

  const products = Array.from(byProduct.values()).filter((entry) => {
    if (wanted.size && !wanted.has(String(entry.productId))) {
      return (
        entry.relatedOrders.length > 0 ||
        entry.relatedPurchases.length > 0 ||
        entry.countRevisions.length > 0
      );
    }
    return true;
  });

  return {
    howToAddUp:
      'Inventory log vault/store/other/amount revisions are physical count edits. SO/PO delivered/deleted/updated (and item qty changes) move system stock. If recordDate ≠ trailDate, stock moved on a different calendar day than the document date.',
    products,
    deliveredOrDeletedTx: trails
      .filter(
        (trail) =>
          (trail.entityType === 'orders' || trail.entityType === 'purchases') &&
          /delete|delivered/i.test(trail.action),
      )
      .map(summarizeEvent),
  };
}

function payloadEvents(trails, { productIds } = {}) {
  const wanted = new Set((productIds || []).map(String));
  const ranked = trails
    .filter(isMaterialTrail)
    .slice()
    .sort((a, b) => rankTrail(b) - rankTrail(a));

  const preferred = wanted.size
    ? ranked.filter((trail) => {
        if (trail.productId != null && wanted.has(String(trail.productId))) return true;
        const items = [...(trail.items || []), ...(trail.itemsPrevious || [])];
        return items.some((item) => wanted.has(String(item.productId)));
      })
    : ranked;

  const rest = ranked.filter((trail) => !preferred.includes(trail));
  const picked = [...preferred, ...rest].slice(0, MAX_PAYLOAD_EVENTS);
  return picked.map(summarizeEvent);
}

async function loadEntityTrails(system, { startDate, endDate, entityTypes, locationId }) {
  const lists = await Promise.all(
    entityTypes.map(async (entityType) => {
      try {
        const rows = await fetchAuditTrailList(system.token, {
          startDate,
          endDate,
          entityType,
          baseUrl: system.baseUrl,
        });
        return { entityType, rows, error: '' };
      } catch (error) {
        return {
          entityType,
          rows: [],
          error: OPTIONAL_ENTITY_TYPES.has(entityType)
            ? ''
            : error?.message || `Failed to load ${entityType} audit trails.`,
        };
      }
    }),
  );

  const warning = lists.map((entry) => entry.error).filter(Boolean).join(' ');
  const atLocation = lists
    .flatMap((entry) => entry.rows)
    .filter((row) => trailTouchesLocation(row, locationId));

  return { warning, rows: atLocation, scanned: lists.reduce((sum, entry) => sum + entry.rows.length, 0) };
}

async function hydrateDetails(system, rows, { productIds } = {}) {
  const wanted = new Set((productIds || []).map(String));
  const candidates = rows.filter(needsDetail);
  candidates.sort((a, b) => {
    const aWanted = a.entity_type === 'inventory_logs' && wanted.has(String(productIdOf(a)));
    const bWanted = b.entity_type === 'inventory_logs' && wanted.has(String(productIdOf(b)));
    if (aWanted !== bWanted) return aWanted ? -1 : 1;
    const order = {
      cash_logs: 0,
      cash_transactions: 1,
      payments: 2,
      inventory_logs: 3,
      transfers: 4,
      orders: 5,
      purchases: 6,
    };
    return (order[a.entity_type] ?? 9) - (order[b.entity_type] ?? 9);
  });
  const selected = candidates.slice(0, MAX_DETAILS);
  const details = await mapPool(selected, DETAIL_CONCURRENCY, async (row) => {
    try {
      const detail = await fetchAuditTrailDetail(system.token, row.id, system.baseUrl);
      return compactTrail(row, detail);
    } catch {
      return compactTrail(row, null);
    }
  });
  const detailedIds = new Set(selected.map((row) => String(row.id)));
  const rest = rows
    .filter((row) => !detailedIds.has(String(row.id)))
    .map((row) => compactTrail(row, null));
  const merged = details.concat(rest).sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
  return dedupeTrails(merged);
}

function dedupeTrails(trails) {
  const seen = new Set();
  const out = [];
  for (const trail of trails) {
    const amount = trail.after?.amount ?? trail.amountTo ?? '';
    const changeKey = (trail.changes || [])
      .map((change) => `${change.field}:${change.previous}->${change.value}`)
      .join(',');
    const key = [
      trail.entityType,
      trail.entityId,
      trail.action,
      trail.recordDate,
      amount,
      changeKey,
    ].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trail);
  }
  return out;
}

function emptyTrailContext(extra = {}) {
  return {
    trailCount: 0,
    materialCount: 0,
    dateMismatches: [],
    events: [],
    warning: '',
    ...extra,
  };
}

/**
 * POS audit trails for a store cash audit (cash logs, payments, till cash_transactions).
 * Dates on the document vs when the change was made, plus previous→new amounts.
 */
export async function gatherCashAuditTrails(
  session,
  { date, previousDate, locationId, systemKey, onProgress } = {},
) {
  if (locationId == null || locationId === '') {
    return emptyTrailContext({
      reconciliation: null,
      warning: 'Store location missing; skipped POS audit trails.',
    });
  }

  const system = resolveAuditSystem(session, systemKey);
  const day = formatDateParam(parseDateParam(date));
  const prior = formatDateParam(parseDateParam(previousDate || day));

  onProgress?.('Loading POS audit trails…');
  let loaded;
  try {
    loaded = await loadEntityTrails(system, {
      startDate: prior,
      endDate: day,
      entityTypes: CASH_ENTITY_TYPES,
      locationId,
    });
  } catch (error) {
    return emptyTrailContext({
      reconciliation: null,
      warning: error?.message || 'Failed to load POS audit trails.',
    });
  }

  onProgress?.(
    `Reviewing ${loaded.rows.length} POS change${loaded.rows.length === 1 ? '' : 's'}…`,
  );
  const trails = await hydrateDetails(system, loaded.rows);
  const material = trails.filter(isMaterialTrail);
  const dateMismatches = material.filter((trail) => trail.dateMismatch).map(summarizeEvent);

  return {
    date: day,
    previousDate: prior,
    locationId: String(locationId),
    trailCount: trails.length,
    materialCount: material.length,
    dateMismatches,
    reconciliation: buildCashReconciliation(trails),
    events: payloadEvents(trails),
    warning: loaded.warning,
  };
}

/**
 * POS audit trails for a store bullion audit (inventory logs, SO/PO mutations).
 */
export async function gatherBullionAuditTrails(
  session,
  { date, previousDate, locationId, systemKey, productIds, onProgress } = {},
) {
  if (locationId == null || locationId === '') {
    return emptyTrailContext({
      reconciliation: null,
      warning: 'Store location missing; skipped POS audit trails.',
    });
  }

  const system = resolveAuditSystem(session, systemKey);
  const day = formatDateParam(parseDateParam(date));
  const prior = formatDateParam(parseDateParam(previousDate || day));
  const ids = Array.isArray(productIds) ? productIds.map(String) : [];

  onProgress?.('Loading POS audit trails…');
  let loaded;
  try {
    loaded = await loadEntityTrails(system, {
      startDate: prior,
      endDate: day,
      entityTypes: BULLION_ENTITY_TYPES,
      locationId,
    });
  } catch (error) {
    return emptyTrailContext({
      reconciliation: null,
      warning: error?.message || 'Failed to load POS audit trails.',
    });
  }

  onProgress?.(
    `Reviewing ${loaded.rows.length} POS change${loaded.rows.length === 1 ? '' : 's'}…`,
  );
  const trails = await hydrateDetails(system, loaded.rows, { productIds: ids });
  const material = trails.filter(isMaterialTrail);
  const dateMismatches = material.filter((trail) => trail.dateMismatch).map(summarizeEvent);

  return {
    date: day,
    previousDate: prior,
    locationId: String(locationId),
    trailCount: trails.length,
    materialCount: material.length,
    dateMismatches,
    reconciliation: buildBullionReconciliation(trails, ids),
    events: payloadEvents(trails, { productIds: ids }),
    warning: loaded.warning,
  };
}
