import { posSystemsFromSession } from './auth';
import { buildAureusCashLog, trimAureusCashLogs } from './aureusCashLog';
import { compactAuditTrailsForPrompt, gatherBullionAuditTrails, gatherCashAuditTrails } from './auditTrails';
import { fetchInventoryLogs, resolveBullionSystem } from './bullionAudit';
import { lineItemFields } from './bullionAuditAi';
import { enrichCashTransaction } from './cashAudit';
import { fetchStoreCashPosition, formatAmount } from './cashTill';
import { fetchBullionProducts, fetchProductInventory, formatQty } from './inventory';
import { streamChatCompletion } from './llmProviders';
import { classifyPayment } from './paymentMethod';
import { fetchDayPayments } from './payments';
import { storesMatch } from './storeCatalog';
import {
  fetchTransactionDetail,
  fetchTransactions,
  formatDateParam,
  parseDateParam,
  toLookupTransaction,
} from './transactions';
import { fetchTransferDetail, fetchTransfers } from './transfers';

/** Longest window one review will load (keeps POS calls and the prompt bounded). */
export const MAX_RANGE_DAYS = 31;

const DETAIL_CONCURRENCY = 6;
const DAY_CONCURRENCY = 3;
const MAX_TX_DETAILS = 320;
const MAX_TRANSFER_DETAILS = 60;
const MAX_PROMPT_PRODUCTS = 40;
const MAX_PROMPT_LIST = 30;

function toNumber(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function roundQty(value) {
  return Math.round((Number(value) || 0) * 1000) / 1000;
}

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function namesMatch(a, b) {
  return storesMatch(a, b);
}

function normalizeKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function dayKeyOf(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const match = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) return match[1];
  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? '' : formatDateParam(new Date(parsed));
}

function shiftDateKey(date, days) {
  const next = parseDateParam(date);
  next.setDate(next.getDate() + days);
  return formatDateParam(next);
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

/**
 * Order the two dates, clamp the end to today and the span to MAX_RANGE_DAYS.
 */
export function normalizeAuditRange(start, end) {
  let from = parseDateParam(start || new Date());
  let to = parseDateParam(end || start || new Date());
  if (from > to) [from, to] = [to, from];
  const today = parseDateParam(new Date());
  if (to > today) to = today;
  if (from > to) from = to;
  const earliest = parseDateParam(shiftDateKey(formatDateParam(to), -(MAX_RANGE_DAYS - 1)));
  const clamped = from < earliest;
  if (clamped) from = earliest;
  const startDate = formatDateParam(from);
  const endDate = formatDateParam(to);
  return { startDate, endDate, days: rangeDateKeys(startDate, endDate).length, clamped };
}

export function rangeDateKeys(startDate, endDate) {
  const keys = [];
  let cursor = formatDateParam(parseDateParam(startDate));
  const last = formatDateParam(parseDateParam(endDate));
  while (cursor <= last && keys.length < MAX_RANGE_DAYS) {
    keys.push(cursor);
    cursor = shiftDateKey(cursor, 1);
  }
  return keys;
}

export function formatRangeLabel(startDate, endDate) {
  const opts = { month: 'short', day: 'numeric' };
  const from = parseDateParam(startDate).toLocaleDateString('en-CA', opts);
  const to = parseDateParam(endDate).toLocaleDateString('en-CA', opts);
  return startDate === endDate ? from : `${from} – ${to}`;
}

async function loadStoreRangeTransactions(session, { startDate, endDate, storeName }) {
  const systems = posSystemsFromSession(session).filter((system) => system.token);
  const results = await Promise.all(
    systems.map(async (system) => {
      try {
        const result = await fetchTransactions(system.token, {
          startDate,
          endDate,
          baseUrl: system.baseUrl,
          system,
        });
        const rows = result.rows
          .filter((row) => namesMatch(row.storeName, storeName))
          .map((row) => ({
            ...row,
            systemKey: system.key,
            systemLabel: system.label,
            baseUrl: system.baseUrl,
            token: system.token,
          }));
        return { rows, error: '' };
      } catch (error) {
        return { rows: [], error: error?.message || `Failed to load transactions (${system.label}).` };
      }
    }),
  );
  const rows = results
    .flatMap((result) => result.rows)
    .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
  return { rows, warning: results.map((result) => result.error).filter(Boolean).join(' ') };
}

function sideTouchesStore(side, locationId, storeName) {
  if (locationId != null && side?.id != null && String(side.id) === String(locationId)) return true;
  return namesMatch(side?.name, storeName);
}

function transferDirection(transfer, locationId, storeName) {
  const out = sideTouchesStore(transfer.from, locationId, storeName);
  const inbound = sideTouchesStore(transfer.to, locationId, storeName);
  if (out && inbound) return 'internal';
  if (out) return 'out';
  if (inbound) return 'in';
  return null;
}

/**
 * Transfers that touch the store inside the window. Pending transfers are
 * included from 60 days back because the metal is still between stores.
 */
async function loadStoreRangeTransfers(session, { startDate, endDate, storeName, locationId, systemKey, onProgress }) {
  const systems = posSystemsFromSession(session);
  const system = systems.find((entry) => entry.key === systemKey) || systems[0];
  if (!system?.token) return { rows: [], warning: '' };

  onProgress?.('Loading transfers…');
  const results = await Promise.all(
    ['pending', 'received'].map(async (status) => {
      try {
        const rows = await fetchTransfers(system.token, {
          status,
          since: status === 'pending' ? shiftDateKey(startDate, -60) : startDate,
          baseUrl: system.baseUrl,
        });
        return { rows, error: '' };
      } catch (error) {
        return { rows: [], error: error?.message || `Failed to load ${status} transfers.` };
      }
    }),
  );

  const seen = new Set();
  const touching = [];
  for (const entry of results) {
    for (const transfer of entry.rows) {
      if (!transfer?.id || seen.has(transfer.id)) continue;
      const direction = transferDirection(transfer, locationId, storeName);
      if (!direction) continue;
      const created = transfer.date || '';
      const received = transfer.receivedDate || '';
      const inWindow =
        (created >= startDate && created <= endDate) || (received >= startDate && received <= endDate);
      const pendingBefore = transfer.status !== 'received' && created <= endDate;
      if (!inWindow && !pendingBefore) continue;
      seen.add(transfer.id);
      touching.push({ ...transfer, direction });
    }
  }

  const needDetail = touching.filter((transfer) => !transfer.hasItems).slice(0, MAX_TRANSFER_DETAILS);
  if (needDetail.length) {
    onProgress?.(`Reading ${needDetail.length} transfer${needDetail.length === 1 ? '' : 's'}…`);
    const details = await mapPool(needDetail, DETAIL_CONCURRENCY, async (transfer) => {
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

  touching.sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
  return { rows: touching, warning: results.map((entry) => entry.error).filter(Boolean).join(' ') };
}

function slimTransfer(transfer) {
  return {
    ref: transfer.reference,
    direction: transfer.direction,
    status: transfer.status,
    date: transfer.date,
    receivedDate: transfer.receivedDate || undefined,
    from: transfer.from?.name || transfer.from?.id,
    to: transfer.to?.name || transfer.to?.id,
    createdBy: transfer.createdBy || undefined,
    receivedBy: transfer.receivedBy || undefined,
    comments: transfer.comments || undefined,
    totalQty: transfer.totalQty,
    receivedQty: transfer.status === 'received' ? transfer.receivedQty : undefined,
    items: (transfer.items || []).slice(0, 12).map((item) => ({
      product: item.name || item.sku || item.productId,
      qty: item.quantity,
      receivedQty: item.receivedQuantity ?? undefined,
      shortfall: item.shortfall || undefined,
    })),
  };
}

// ---------------------------------------------------------------------------
// Bullion
// ---------------------------------------------------------------------------

function buildProductIndex(products) {
  const byId = new Map();
  const bySku = new Map();
  const byName = new Map();
  for (const product of products) {
    const id = String(product.id);
    const entry = {
      id,
      name: product.name || product.sku || `Product ${id}`,
      sku: product.sku || '',
      metal:
        typeof product.metal === 'string' ? product.metal : product.metal?.name || product.metal_type || '',
    };
    byId.set(id, entry);
    if (entry.sku) bySku.set(normalizeKey(entry.sku), entry);
    if (entry.name) byName.set(normalizeKey(entry.name), entry);
  }
  return { byId, bySku, byName, list: Array.from(byId.values()) };
}

function matchProduct(line, index) {
  if (line.productId && index.byId.has(String(line.productId))) return index.byId.get(String(line.productId));
  const sku = normalizeKey(line.sku);
  if (sku && index.bySku.has(sku)) return index.bySku.get(sku);
  const name = normalizeKey(line.name);
  if (name && index.byName.has(name)) return index.byName.get(name);
  return null;
}

function lineIsUndelivered(line) {
  if (line.deliveredQuantity != null && line.quantity != null) {
    return Math.abs(line.deliveredQuantity - line.quantity) > 0.0005;
  }
  if (line.deliveryStatus) {
    return !line.deliveredFlag && !/delivered|complete/i.test(line.deliveryStatus);
  }
  return false;
}

function docFlags(detail) {
  const paymentStatus = String(detail?.payment_status || '');
  const itemStatus = String(detail?.item_status || '');
  return {
    paymentStatus,
    itemStatus,
    allocationStatus: String(detail?.allocation_status || ''),
    notPaid: Boolean(paymentStatus) && !/paid|cleared|complete/i.test(paymentStatus),
    itemNotComplete: Boolean(itemStatus) && !/complete|delivered|fulfilled/i.test(itemStatus),
  };
}

async function enrichBullionRangeTransaction(row, index) {
  try {
    const detail = await fetchTransactionDetail(row.token, {
      type: row.type,
      sourceId: row.sourceId,
      baseUrl: row.baseUrl,
    });
    const rawItems = Array.isArray(detail?.items) ? detail.items : [];
    const lines = [];
    for (const item of rawItems) {
      const fields = lineItemFields(item);
      const product = matchProduct(fields, index);
      if (!product) continue;
      lines.push({
        productId: product.id,
        productName: product.name,
        sku: product.sku,
        quantity: fields.quantity,
        deliveredQuantity: fields.deliveredQuantity,
        deliveryStatus: fields.deliveryStatus,
        undelivered: lineIsUndelivered(fields),
        lineTotal: fields.lineTotal,
      });
    }
    if (!lines.length) return null;

    const payments = (Array.isArray(detail?.payments) ? detail.payments : []).map((entry) => {
      const payment = entry?.payment || entry || {};
      return {
        method: payment.payment_type?.name || entry?.payment?.payment_type?.name || 'Other',
        amount: Number(entry?.amount ?? payment.amount) || 0,
        status: payment.status || '',
        date: dayKeyOf(payment.date) || undefined,
      };
    });
    const paidTotal = roundMoney(payments.reduce((sum, payment) => sum + payment.amount, 0));
    const flags = docFlags(detail);

    return {
      reference: row.reference,
      type: row.type,
      sourceId: row.sourceId,
      date: dayKeyOf(row.date),
      timeLabel: row.timeLabel,
      customerName: row.customerName,
      employeeName: row.employeeName,
      amount: row.amount,
      amountLabel: row.amountLabel,
      paymentMethods: row.paymentMethods || '',
      ...flags,
      payments,
      paidTotal,
      paidShort: roundMoney((Number(row.amount) || 0) - paidTotal),
      comments: detail?.comments || '',
      lines,
    };
  } catch (error) {
    return {
      reference: row.reference,
      type: row.type,
      sourceId: row.sourceId,
      date: dayKeyOf(row.date),
      amount: row.amount,
      error: error?.message || 'Failed to load detail',
      lines: [],
    };
  }
}

function qtyAtLocation(stocks, productId, locationId) {
  const entries = stocks?.[String(productId)];
  if (!Array.isArray(entries)) return 0;
  let qty = 0;
  for (const entry of entries) {
    if (String(entry?.location_id) === String(locationId)) qty += Number(entry?.quantity) || 0;
  }
  return qty;
}

function logPhysical(log) {
  if (!log) return null;
  if (log.amount != null && log.amount !== '') return toNumber(log.amount);
  const vault = toNumber(log.vault_count);
  const store = toNumber(log.store_count);
  const other = toNumber(log.other_count);
  if (vault == null && store == null && other == null) return null;
  return (vault ?? 0) + (store ?? 0) + (other ?? 0);
}

/**
 * Everything that moved bullion at one store between two dates: opening and
 * closing system stock, every physical count logged, sales, purchases,
 * transfers, delivery and payment state, and POS edits.
 */
export async function gatherBullionRangeContext(
  session,
  { startDate, endDate, storeName, locationId, systemKey, products, focusProductIds, onProgress } = {},
) {
  if (!storeName) throw new Error('Select a store first.');
  if (locationId == null || locationId === '') throw new Error('Store location is missing.');

  const range = normalizeAuditRange(startDate, endDate);
  const days = rangeDateKeys(range.startDate, range.endDate);
  const openingDate = shiftDateKey(range.startDate, -1);
  const system = resolveBullionSystem(session, systemKey);
  const { token, baseUrl } = system;

  onProgress?.('Loading bullion products…');
  const catalog = Array.isArray(products) && products.length ? products : await fetchBullionProducts(token, baseUrl);
  const index = buildProductIndex(catalog);
  const productIds = index.list.map((product) => product.id);
  const focus = new Set((focusProductIds || []).map(String));

  onProgress?.('Loading opening and closing system stock…');
  const [opening, closing, logsByDay, transactions, transfers, auditTrails] = await Promise.all([
    fetchProductInventory(token, productIds, baseUrl, { locations: locationId, date: openingDate }).catch(
      () => ({ stocks: {} }),
    ),
    fetchProductInventory(token, productIds, baseUrl, { locations: locationId, date: range.endDate }).catch(
      () => ({ stocks: {} }),
    ),
    mapPool(days, DAY_CONCURRENCY, async (day, i) => {
      onProgress?.(`Loading vault counts · day ${i + 1} of ${days.length}…`);
      try {
        return await fetchInventoryLogs(token, { productIds, locationId, date: day, forWeek: false }, baseUrl);
      } catch {
        return [];
      }
    }),
    loadStoreRangeTransactions(session, {
      startDate: range.startDate,
      endDate: range.endDate,
      storeName,
    }),
    loadStoreRangeTransfers(session, {
      startDate: range.startDate,
      endDate: range.endDate,
      storeName,
      locationId,
      systemKey: system.key,
      onProgress,
    }),
    gatherBullionAuditTrails(session, {
      date: range.endDate,
      previousDate: range.startDate,
      locationId,
      systemKey: system.key,
      productIds: Array.from(focus),
      onProgress,
    }).catch((error) => ({
      trailCount: 0,
      materialCount: 0,
      dateMismatches: [],
      events: [],
      reconciliation: null,
      warning: error?.message || 'Failed to load POS audit trails.',
    })),
  ]);

  const txRows = transactions.rows.slice(0, MAX_TX_DETAILS);
  onProgress?.(`Reviewing ${txRows.length} sale and purchase detail${txRows.length === 1 ? '' : 's'}…`);
  const enriched = (await mapPool(txRows, DETAIL_CONCURRENCY, (row) => enrichBullionRangeTransaction(row, index))).filter(
    Boolean,
  );

  // Per-product ledger: opening + bought − sold + in − out, walked day by day
  // so each logged physical count can be compared to where the system should be.
  const ledgers = new Map();
  const ensure = (product) => {
    const key = String(product.id);
    if (!ledgers.has(key)) {
      ledgers.set(key, {
        productId: key,
        name: product.name,
        sku: product.sku,
        metal: product.metal,
        opening: qtyAtLocation(opening.stocks, key, locationId),
        systemClosing: qtyAtLocation(closing.stocks, key, locationId),
        bought: 0,
        sold: 0,
        transferIn: 0,
        transferOut: 0,
        pendingIn: 0,
        pendingOut: 0,
        byDay: new Map(),
        physicalByDay: new Map(),
        transactions: [],
        transfers: [],
        undeliveredLines: [],
      });
    }
    return ledgers.get(key);
  };
  const bump = (ledger, day, field, qty) => {
    const key = day && day >= range.startDate && day <= range.endDate ? day : range.startDate;
    if (!ledger.byDay.has(key)) ledger.byDay.set(key, { bought: 0, sold: 0, transferIn: 0, transferOut: 0 });
    ledger.byDay.get(key)[field] = roundQty(ledger.byDay.get(key)[field] + qty);
    ledger[field] = roundQty(ledger[field] + qty);
  };

  for (const product of index.list) {
    const hasStock = qtyAtLocation(opening.stocks, product.id, locationId) || qtyAtLocation(closing.stocks, product.id, locationId);
    if (hasStock || focus.has(product.id)) ensure(product);
  }

  days.forEach((day, i) => {
    for (const log of logsByDay[i] || []) {
      const product = index.byId.get(String(log?.product_id));
      if (!product) continue;
      const physical = logPhysical(log);
      if (physical == null) continue;
      ensure(product).physicalByDay.set(day, {
        physical,
        vault: toNumber(log.vault_count),
        store: toNumber(log.store_count),
        other: toNumber(log.other_count),
      });
    }
  });

  const undeliveredLines = [];
  const unpaidDocs = [];
  const incompleteDocs = [];
  for (const tx of enriched) {
    if (tx.error) continue;
    if (tx.notPaid || (tx.paidShort > 0.005 && tx.payments.length)) {
      unpaidDocs.push({
        ref: tx.reference,
        type: tx.type,
        date: tx.date,
        customer: tx.customerName,
        amount: tx.amount,
        paidTotal: tx.paidTotal,
        paymentStatus: tx.paymentStatus,
        methods: tx.paymentMethods || undefined,
      });
    }
    if (tx.itemNotComplete) {
      incompleteDocs.push({ ref: tx.reference, type: tx.type, date: tx.date, itemStatus: tx.itemStatus });
    }
    for (const line of tx.lines) {
      const ledger = ensure(index.byId.get(line.productId));
      const qty = line.quantity || 0;
      bump(ledger, tx.date, tx.type === 'purchase' ? 'bought' : 'sold', qty);
      ledger.transactions.push({
        ref: tx.reference,
        type: tx.type,
        date: tx.date,
        qty,
        deliveredQty: line.deliveredQuantity ?? undefined,
        undelivered: line.undelivered || undefined,
        paymentStatus: tx.paymentStatus || undefined,
        itemStatus: tx.itemStatus || undefined,
        customer: tx.customerName,
        employee: tx.employeeName,
        payments: (tx.payments || []).map((payment) => ({
          method: payment.method,
          amount: payment.amount,
          status: payment.status || undefined,
        })),
      });
      if (line.undelivered) {
        const entry = {
          ref: tx.reference,
          type: tx.type,
          date: tx.date,
          product: line.productName,
          qty,
          deliveredQty: line.deliveredQuantity,
          deliveryStatus: line.deliveryStatus || undefined,
          customer: tx.customerName,
        };
        undeliveredLines.push(entry);
        ledger.undeliveredLines.push(entry);
      }
    }
  }

  for (const transfer of transfers.rows) {
    for (const item of transfer.items || []) {
      const product = matchProduct({ productId: item.productId, sku: item.sku, name: item.name }, index);
      if (!product) continue;
      const ledger = ensure(product);
      const qty = item.quantity || 0;
      const received = item.receivedQuantity != null ? item.receivedQuantity : qty;
      const pending = transfer.status !== 'received';
      if (transfer.direction === 'out') {
        // Stock leaves the sending store when the transfer is created.
        bump(ledger, transfer.date, 'transferOut', qty);
        if (pending) ledger.pendingOut = roundQty(ledger.pendingOut + qty);
      } else if (transfer.direction === 'in') {
        if (pending) ledger.pendingIn = roundQty(ledger.pendingIn + qty);
        else bump(ledger, transfer.receivedDate || transfer.date, 'transferIn', received);
      }
      ledger.transfers.push({
        ref: transfer.reference,
        direction: transfer.direction,
        status: transfer.status,
        date: transfer.date,
        receivedDate: transfer.receivedDate || undefined,
        from: transfer.from?.name,
        to: transfer.to?.name,
        qty,
        receivedQty: item.receivedQuantity ?? undefined,
        shortfall: item.shortfall || undefined,
      });
    }
  }

  const productReports = [];
  for (const ledger of ledgers.values()) {
    let running = ledger.opening;
    const dailyDiffs = [];
    let firstDayOff = null;
    let lastPhysical = null;
    let lastPhysicalDate = null;
    for (const day of days) {
      const move = ledger.byDay.get(day);
      if (move) running = roundQty(running + move.bought - move.sold + move.transferIn - move.transferOut);
      const count = ledger.physicalByDay.get(day);
      if (!count) continue;
      const diff = roundQty(count.physical - running);
      lastPhysical = count.physical;
      lastPhysicalDate = day;
      if (firstDayOff == null && Math.abs(diff) >= 0.0005) firstDayOff = day;
      dailyDiffs.push({
        date: day,
        physical: count.physical,
        vault: count.vault,
        store: count.store,
        other: count.other,
        expectedSystem: running,
        diff,
        moved: move || undefined,
      });
    }
    const expectedClosing = running;
    const unexplainedSystemChange = roundQty(ledger.systemClosing - expectedClosing);
    // Only compare against the end-date system figure when the count is from that day.
    const physicalVsSystemAtClose =
      lastPhysical != null && lastPhysicalDate === range.endDate
        ? roundQty(lastPhysical - ledger.systemClosing)
        : null;
    const lastCountDiff = dailyDiffs.length ? dailyDiffs[dailyDiffs.length - 1].diff : null;
    const activity = ledger.bought + ledger.sold + ledger.transferIn + ledger.transferOut + ledger.pendingIn + ledger.pendingOut;
    const closeDiff = physicalVsSystemAtClose ?? lastCountDiff;
    const offAtClose = closeDiff != null && Math.abs(closeDiff) >= 0.0005;
    const drift = Math.abs(unexplainedSystemChange) >= 0.0005;
    const flagged = offAtClose || drift || firstDayOff != null || ledger.undeliveredLines.length > 0;
    const severity =
      (offAtClose ? 100 + Math.abs(closeDiff) : 0) +
      (drift ? 50 + Math.abs(unexplainedSystemChange) : 0) +
      ledger.undeliveredLines.length * 10 +
      (focus.has(ledger.productId) ? 1000 : 0) +
      Math.min(activity, 20);

    productReports.push({
      productId: ledger.productId,
      name: ledger.name,
      sku: ledger.sku || undefined,
      metal: ledger.metal || undefined,
      opening: ledger.opening,
      bought: ledger.bought,
      sold: ledger.sold,
      transferIn: ledger.transferIn,
      transferOut: ledger.transferOut,
      pendingIn: ledger.pendingIn || undefined,
      pendingOut: ledger.pendingOut || undefined,
      expectedClosing,
      systemClosing: ledger.systemClosing,
      unexplainedSystemChange,
      lastPhysical,
      lastPhysicalDate,
      physicalVsSystemAtClose,
      lastCountDiff,
      firstDayOff,
      countsLogged: dailyDiffs.length,
      dailyDiffs,
      transactions: ledger.transactions,
      transfers: ledger.transfers,
      undeliveredLines: ledger.undeliveredLines,
      flagged,
      activity,
      severity,
    });
  }
  productReports.sort((a, b) => b.severity - a.severity || a.name.localeCompare(b.name));

  const warning = [transactions.warning, transfers.warning, auditTrails?.warning].filter(Boolean).join(' ');
  if (transactions.rows.length > MAX_TX_DETAILS) {
    const skipped = transactions.rows.length - MAX_TX_DETAILS;
    onProgress?.(`Skipped ${skipped} transaction detail${skipped === 1 ? '' : 's'} (limit).`);
  }

  return {
    kind: 'bullion',
    storeName,
    locationId: String(locationId),
    startDate: range.startDate,
    endDate: range.endDate,
    days: days.length,
    clamped: range.clamped,
    openingDate,
    products: productReports,
    flaggedProducts: productReports.filter((product) => product.flagged),
    transactions: enriched,
    transactionCount: transactions.rows.length,
    bullionTransactionCount: enriched.length,
    undeliveredLines,
    unpaidDocs,
    incompleteDocs,
    transfers: transfers.rows,
    auditTrails,
    lookupTransactions: transactions.rows.map(toLookupTransaction).filter(Boolean),
    warning,
  };
}

function slimProductForPrompt(product) {
  return {
    product: product.name,
    sku: product.sku,
    metal: product.metal,
    productId: product.productId,
    opening: product.opening,
    bought: product.bought,
    sold: product.sold,
    transferIn: product.transferIn,
    transferOut: product.transferOut,
    pendingIn: product.pendingIn,
    pendingOut: product.pendingOut,
    expectedClosing: product.expectedClosing,
    systemClosing: product.systemClosing,
    unexplainedSystemChange: product.unexplainedSystemChange,
    lastPhysical: product.lastPhysical,
    lastPhysicalDate: product.lastPhysicalDate,
    physicalVsSystemAtClose: product.physicalVsSystemAtClose,
    lastCountDiff: product.lastCountDiff,
    firstDayOff: product.firstDayOff,
    dailyCounts: product.dailyDiffs.map((row) => ({
      date: row.date,
      physical: row.physical,
      vault: row.vault,
      store: row.store,
      other: row.other,
      expectedSystem: row.expectedSystem,
      diff: row.diff,
      moved: row.moved,
    })),
    salesAndPurchases: product.transactions.slice(0, 40),
    salesAndPurchasesOmitted:
      product.transactions.length > 40 ? product.transactions.length - 40 : undefined,
    transfers: product.transfers.slice(0, 10),
  };
}

function buildBullionRangeMessages(context) {
  const flagged = context.flaggedProducts.slice(0, MAX_PROMPT_PRODUCTS).map(slimProductForPrompt);
  const quiet = context.products
    .filter((product) => !product.flagged && product.activity > 0)
    .slice(0, 12)
    .map((product) => ({
      product: product.name,
      opening: product.opening,
      bought: product.bought,
      sold: product.sold,
      transferIn: product.transferIn,
      transferOut: product.transferOut,
      systemClosing: product.systemClosing,
      lastPhysical: product.lastPhysical,
      lastPhysicalDate: product.lastPhysicalDate,
    }));

  const payload = {
    store: context.storeName,
    range: { from: context.startDate, to: context.endDate, days: context.days, openingStockDate: context.openingDate },
    summary: {
      productsTracked: context.products.length,
      productsFlagged: context.flaggedProducts.length,
      salesAndPurchasesAtStore: context.transactionCount,
      withBullionLines: context.bullionTransactionCount,
      undeliveredLines: context.undeliveredLines.length,
      notFullyPaidDocuments: context.unpaidDocs.length,
      itemStatusIncomplete: context.incompleteDocs.length,
      transfersTouchingStore: context.transfers.length,
      pendingTransfers: context.transfers.filter((transfer) => transfer.status !== 'received').length,
      posChanges: context.auditTrails?.trailCount || 0,
    },
    flaggedProducts: flagged,
    productsWithActivityButBalanced: quiet,
    undeliveredLines: context.undeliveredLines.slice(0, MAX_PROMPT_LIST),
    notFullyPaidDocuments: context.unpaidDocs.slice(0, MAX_PROMPT_LIST),
    itemStatusIncomplete: context.incompleteDocs.slice(0, MAX_PROMPT_LIST),
    transfers: context.transfers.slice(0, MAX_PROMPT_LIST).map(slimTransfer),
    posAuditTrails: compactAuditTrailsForPrompt(context.auditTrails),
    notes: {
      ledger:
        'expectedClosing = opening + bought − sold + transferIn − transferOut using the documents found. unexplainedSystemChange = systemClosing − expectedClosing: stock the POS moved without a sale, purchase, or transfer in this window (edits, deletes, backdated documents, other-location moves).',
      counts:
        'dailyCounts are the Aureus inventory log for that product and day: vault, store, and other, with physical = vault + store + other (or the log amount). diff = physical − expectedSystem. firstDayOff is the first logged day the count disagreed. Negative = short. vault in Aureus already includes night and afternoon.',
      payments:
        'salesAndPurchases.payments is the payment breakdown on that sale or purchase (cash, debit, cheque, and the rest), not only the line quantity.',
      close:
        'physicalVsSystemAtClose = physical logged on the end date − Aureus system on the end date (null when no count was logged that day). lastCountDiff is the diff on the most recent logged day (lastPhysicalDate). Null for both means nobody logged a count in the window.',
      delivery:
        'undeliveredLines are bullion lines on an invoice where delivered quantity ≠ quantity or status is not delivered. Sold-but-not-delivered metal is still in the vault; bought-but-not-delivered metal is on paper only.',
      transfers:
        'Outbound stock leaves on the transfer date; inbound stock arrives on receivedDate. Pending transfers are counted in pendingIn/pendingOut, not in the ledger.',
      trails:
        'posAuditTrails lists edits, deletes, deliveries, and recordDate ≠ trailDate. Cite user and previous → new.',
    },
  };

  return [
    {
      role: 'system',
      content: `You are a bullion vault auditor for a Canadian precious-metals retailer (Canada Gold).
Review one store over a date range and explain where physical bullion counts and the Aureus system count drifted apart, and which documents are not finished.

Work through the JSON context:
1. Start with flaggedProducts. For each, say when it first went off (firstDayOff), how far it is off at close (physicalVsSystemAtClose), and what moved it (sales, purchases, transfers, undelivered lines, POS edits). dailyCounts.vault, store, and other are the Aureus inventory log breakdown. salesAndPurchases.payments is the payment breakdown on that document.
2. Separate two kinds of problems: counting problems (physical ≠ expectedSystem on a logged day with no document explaining it) and paperwork problems (unexplainedSystemChange ≠ 0, undelivered lines, documents not paid, pending transfers, item status incomplete).
3. Check delivery and payment on every cited sale or purchase: a sale not delivered means the metal should still be in the vault; a purchase not delivered means the metal may never have arrived; a document not paid may have been cancelled or is still open.
4. Use transfers to explain metal between stores. Pending transfers and receivedQty < qty are strong leads.
5. Use posAuditTrails before guessing a miscount: deleted or delivered documents, quantity edits, count revisions, and recordDate ≠ trailDate.
6. If a product shows no movement and matching counts, say it is fine in one short line or skip it.
7. Be concrete: product name, dates, quantities, SO# 12345 / PO# 12345 / TR# 12345, customer, staff, previous → new.

Write in plain English only. Do not use markdown. Do not use # headings, * asterisks, ** bold, or bullet lists.
Cite every sale or purchase as SO# 12345 or PO# 12345 so it can be opened.

Use exactly this layout and these three labels:

Problem
Two or three short sentences: which metals are off over the range, by how much, and when it started.

Solution
Two or three short sentences on what to check or fix first.

Reasons
One short line per finding, each on its own line, starting with the date or product. No numbers or dashes. Cover every flagged product and every undelivered or unpaid document that matters.

Keep every sentence short.`,
    },
    {
      role: 'user',
      content: `Review bullion at this store from ${context.startDate} to ${context.endDate}.\n\n${JSON.stringify(payload)}`,
    },
  ];
}

export async function analyzeBullionRange({
  session,
  startDate,
  endDate,
  storeName,
  locationId,
  systemKey,
  products,
  focusProductIds,
  model,
  onProgress,
  onDelta,
  signal,
}) {
  const context = await gatherBullionRangeContext(session, {
    startDate,
    endDate,
    storeName,
    locationId,
    systemKey,
    products,
    focusProductIds,
    onProgress,
  });
  if (signal?.aborted) throw new Error('Cancelled.');

  onProgress?.('Asking AI…');
  const seedMessages = buildBullionRangeMessages(context);
  const text = await streamChatCompletion({
    model,
    messages: seedMessages,
    onDelta,
    signal,
    maxTokens: 16384,
    via: 'openrouter',
  });
  return { context, text, messages: [...seedMessages, { role: 'assistant', content: text || '' }] };
}

// ---------------------------------------------------------------------------
// Cash
// ---------------------------------------------------------------------------

function physicalOrNull(value) {
  const n = toNumber(value);
  if (n == null || Math.abs(n) < 0.005) return null;
  return n;
}

function slimPayment(row) {
  const classified = classifyPayment({ method: row.paymentType, comments: row.comments || '' });
  const out = {
    id: row.sourceId ?? row.id,
    date: dayKeyOf(row.date) || undefined,
    dir: row.type,
    amount: row.amount,
    currency: row.currency || 'CAD',
    method: row.paymentType,
    customer: row.customerName,
    ref: row.reference,
    status: row.status,
    till: row.tillName || undefined,
  };
  if (row.comments) out.comments = String(row.comments).slice(0, 160);
  if (classified.checkNumber) out.checkNumber = classified.checkNumber;
  if (classified.suspiciousCashWithCheckNumber) out.suspiciousCashWithCheckNumber = true;
  if (classified.chequeMissingCheckNumber) out.chequeMissingCheckNumber = true;
  return out;
}

function slimTillTxn(row, date) {
  return {
    id: row.sourceId ?? row.id,
    date,
    dir: row.type,
    amount: row.amount,
    currency: row.currency || 'CAD',
    category: row.category,
    comments: row.comments ? String(row.comments).slice(0, 160) : undefined,
    till: row.tillName || undefined,
  };
}

function drawerDayRow(drawer, date, priorPhysical) {
  if (!drawer) return null;
  const physical = physicalOrNull(drawer.todayPhysical);
  const opening = roundMoney(drawer.openingBalance);
  const expected = roundMoney(drawer.expectedOnHand);
  const variance = physical == null ? null : roundMoney(physical - expected);
  const openingGap = priorPhysical == null ? null : roundMoney(opening - priorPhysical);
  return {
    date,
    opening,
    priorPhysical,
    openingGap: openingGap != null && Math.abs(openingGap) >= 0.005 ? openingGap : undefined,
    cashIn: drawer.paymentTotals?.cashIn ?? 0,
    cashOut: drawer.paymentTotals?.cashOut ?? 0,
    paymentNet: drawer.paymentTotals?.net ?? 0,
    paymentCount: drawer.paymentTotals?.count ?? (drawer.paymentRows || []).length,
    tillNet: drawer.cashTxnTotals?.net ?? 0,
    tillCount: drawer.cashTxnTotals?.count ?? (drawer.cashTransactions || []).length,
    expected,
    physical,
    variance,
    counted: physical != null,
  };
}

function summarizeDrawerDays(rows) {
  const counted = rows.filter((row) => row.counted);
  const off = counted.filter((row) => Math.abs(row.variance) >= 0.005);
  const largest = off.reduce(
    (best, row) => (best == null || Math.abs(row.variance) > Math.abs(best.variance) ? row : best),
    null,
  );
  return {
    days: rows.length,
    daysCounted: counted.length,
    daysOff: off.length,
    daysNotCounted: rows.filter((row) => !row.counted).map((row) => row.date),
    cashIn: roundMoney(rows.reduce((sum, row) => sum + row.cashIn, 0)),
    cashOut: roundMoney(rows.reduce((sum, row) => sum + row.cashOut, 0)),
    tillNet: roundMoney(rows.reduce((sum, row) => sum + row.tillNet, 0)),
    varianceSum: roundMoney(off.reduce((sum, row) => sum + row.variance, 0)),
    openingGaps: rows.filter((row) => row.openingGap != null).map((row) => ({ date: row.date, gap: row.openingGap })),
    largestVariance: largest ? { date: largest.date, variance: largest.variance } : null,
    firstDayOff: off[0]?.date || null,
  };
}

/**
 * Every day's till position for one store across the window, plus every
 * payment, sale, purchase, transfer, and POS edit that could move cash.
 */
export async function gatherCashRangeContext(session, { startDate, endDate, storeName, onProgress } = {}) {
  if (!storeName) throw new Error('Select a store first.');

  const range = normalizeAuditRange(startDate, endDate);
  const days = rangeDateKeys(range.startDate, range.endDate);

  const positions = await mapPool(days, DAY_CONCURRENCY, async (day, i) => {
    onProgress?.(`Loading till · day ${i + 1} of ${days.length}…`);
    try {
      return { day, position: await fetchStoreCashPosition(session, { date: day, storeName }) };
    } catch (error) {
      return { day, position: null, error: error?.message || `Failed to load ${day}.` };
    }
  });
  const firstGood = positions.find((entry) => entry.position)?.position;
  if (!firstGood) {
    throw new Error(positions.find((entry) => entry.error)?.error || 'Could not load the till for this range.');
  }
  const locationId = firstGood.locationId;
  const systemKey = firstGood.systemKey;
  const resolvedStore = firstGood.storeName;

  onProgress?.('Loading card, debit, and cheque payments…');
  const [nonCashByDay, transactions, transfers, auditTrails] = await Promise.all([
    mapPool(days, DAY_CONCURRENCY, async (day) => {
      try {
        const result = await fetchDayPayments(session, {
          date: day,
          storeName: resolvedStore,
          locationId,
          systemKey,
          paymentTypeCategory: null,
        });
        return result.rows.filter((row) => String(row.paymentType || '').trim().toLowerCase() !== 'cash');
      } catch {
        return [];
      }
    }),
    loadStoreRangeTransactions(session, {
      startDate: range.startDate,
      endDate: range.endDate,
      storeName: resolvedStore,
    }),
    loadStoreRangeTransfers(session, {
      startDate: range.startDate,
      endDate: range.endDate,
      storeName: resolvedStore,
      locationId,
      systemKey,
      onProgress,
    }),
    gatherCashAuditTrails(session, {
      date: range.endDate,
      previousDate: range.startDate,
      locationId,
      systemKey,
      includeDocuments: true,
      onProgress,
    }).catch((error) => ({
      trailCount: 0,
      materialCount: 0,
      dateMismatches: [],
      events: [],
      documentEvents: [],
      reconciliation: null,
      warning: error?.message || 'Failed to load POS audit trails.',
    })),
  ]);

  const txRows = transactions.rows.slice(0, MAX_TX_DETAILS);
  onProgress?.(`Reviewing ${txRows.length} sale and purchase detail${txRows.length === 1 ? '' : 's'}…`);
  const enriched = await mapPool(txRows, DETAIL_CONCURRENCY, enrichCashTransaction);

  const cadDays = [];
  const usdDays = [];
  const cashPayments = [];
  const tillTxns = [];
  const aureusLogs = [];
  const dayErrors = [];
  let priorCad = null;
  let priorUsd = null;
  for (const entry of positions) {
    if (!entry.position) {
      dayErrors.push({ date: entry.day, error: entry.error });
      continue;
    }
    const { position, day } = entry;
    const cad = drawerDayRow(position.cad, day, priorCad);
    const usd = drawerDayRow(position.usd, day, priorUsd);
    if (cad) cadDays.push(cad);
    if (usd) usdDays.push(usd);
    const dayLog = buildAureusCashLog(position, enriched);
    if (dayLog) aureusLogs.push(dayLog);
    priorCad = cad?.physical ?? priorCad;
    priorUsd = usd?.physical ?? priorUsd;
    for (const row of position.cad?.paymentRows || []) cashPayments.push({ ...slimPayment(row), drawer: 'CAD', date: day });
    for (const row of position.usd?.paymentRows || []) cashPayments.push({ ...slimPayment(row), drawer: 'USD', date: day });
    for (const row of position.otherPayments || []) cashPayments.push({ ...slimPayment(row), drawer: 'other till', date: day });
    for (const row of position.cad?.cashTransactions || []) tillTxns.push({ ...slimTillTxn(row, day), drawer: 'CAD' });
    for (const row of position.usd?.cashTransactions || []) tillTxns.push({ ...slimTillTxn(row, day), drawer: 'USD' });
    for (const row of position.otherTxns || []) tillTxns.push({ ...slimTillTxn(row, day), drawer: 'other till' });
  }

  const nonCashPayments = nonCashByDay.flat().map(slimPayment);
  const byMethod = {};
  for (const row of nonCashPayments) {
    const method = row.method || 'Other';
    if (!byMethod[method]) byMethod[method] = { method, count: 0, in: 0, out: 0 };
    byMethod[method].count += 1;
    if (row.dir === 'Out') byMethod[method].out = roundMoney(byMethod[method].out + (row.amount || 0));
    else byMethod[method].in = roundMoney(byMethod[method].in + (row.amount || 0));
  }

  const flaggedPayments = [...cashPayments, ...nonCashPayments].filter(
    (row) => row.suspiciousCashWithCheckNumber || row.chequeMissingCheckNumber,
  );

  const unpaidDocs = [];
  const flaggedDocs = [];
  const cashDocs = [];
  for (const tx of enriched) {
    if (tx.error) continue;
    const slim = {
      ref: tx.reference,
      type: tx.type,
      date: dayKeyOf(tx.date),
      customer: tx.customerName,
      employee: tx.employeeName,
      amount: tx.amount,
      methods: tx.listedPaymentMethods || undefined,
      paymentStatus: tx.paymentStatus || undefined,
      itemStatus: tx.itemStatus || undefined,
      checkNumber: tx.checkNumber || undefined,
      comments: tx.comments ? String(tx.comments).slice(0, 160) : undefined,
      payments: (tx.payments || []).map((payment) => ({
        method: payment.method,
        amount: payment.amount,
        status: payment.status || undefined,
        date: dayKeyOf(payment.date) || undefined,
        checkNumber: payment.checkNumber || undefined,
      })),
    };
    const paidTotal = roundMoney((tx.payments || []).reduce((sum, payment) => sum + (payment.amount || 0), 0));
    const paidShort = roundMoney((Number(tx.amount) || 0) - paidTotal);
    if (tx.flags?.notPaid || !(tx.payments || []).length || paidShort > 0.005) {
      unpaidDocs.push({ ...slim, paidTotal, stillOwing: paidShort });
    }
    if (tx.flags?.suspiciousCashWithCheckNumber || tx.flags?.chequeMissingCheckNumber || tx.flags?.mixedMethods) {
      flaggedDocs.push({ ...slim, flags: tx.flags });
    }
    if (tx.flags?.hasCashSignal) cashDocs.push(slim);
  }

  const warning = [
    transactions.warning,
    transfers.warning,
    auditTrails?.warning,
    dayErrors.length ? `${dayErrors.length} day${dayErrors.length === 1 ? '' : 's'} failed to load.` : '',
  ]
    .filter(Boolean)
    .join(' ');

  return {
    kind: 'cash',
    storeName: resolvedStore,
    locationId: String(locationId),
    startDate: range.startDate,
    endDate: range.endDate,
    days: days.length,
    clamped: range.clamped,
    cad: { days: cadDays, summary: summarizeDrawerDays(cadDays) },
    usd: { days: usdDays, summary: summarizeDrawerDays(usdDays) },
    cashPayments,
    tillTxns,
    aureusLogs,
    nonCashPayments,
    nonCashByMethod: Object.values(byMethod),
    flaggedPayments,
    transactions: enriched,
    transactionCount: transactions.rows.length,
    unpaidDocs,
    flaggedDocs,
    cashDocs,
    transfers: transfers.rows,
    auditTrails,
    dayErrors,
    lookupTransactions: transactions.rows.map(toLookupTransaction).filter(Boolean),
    warning,
  };
}

function buildCashRangeMessages(context) {
  const offDays = (rows) => rows.filter((row) => row.counted && Math.abs(row.variance) >= 0.005);
  const cadOff = new Set(offDays(context.cad.days).map((row) => row.date));
  const usdOff = new Set(offDays(context.usd.days).map((row) => row.date));
  const onOffDay = (row) =>
    (row.drawer === 'USD' ? usdOff : cadOff).has(row.date) || row.drawer === 'other till';

  const payload = {
    store: context.storeName,
    range: { from: context.startDate, to: context.endDate, days: context.days },
    evaluateSeparately: ['Till 1 CAD and USD are separate drawers. Never add or convert one into the other.'],
    till1Cad: { summary: context.cad.summary, days: context.cad.days },
    usd: { summary: context.usd.summary, days: context.usd.days },
    formula:
      'Per day and per drawer: expected = opening + paymentNet + tillNet. variance = physical − expected (null when nobody counted). openingGap = today opening − yesterday physical; a non-zero gap means the day did not start from the prior count.',
    aureusLog: trimAureusCashLogs(context.aureusLogs, {
      priorityDates: [...cadOff, ...usdOff],
      maxLines: 400,
    }),
    cashPaymentsOnOffDays: context.cashPayments.filter(onOffDay).slice(0, 80),
    cashPaymentsOtherDaysCount: context.cashPayments.filter((row) => !onOffDay(row)).length,
    tillAdjustments: context.tillTxns.slice(0, 80),
    otherMethodsByMethod: context.nonCashByMethod,
    flaggedPayments: context.flaggedPayments.slice(0, 40),
    documents: {
      reviewed: context.transactions.length,
      atStore: context.transactionCount,
      notFullyPaid: context.unpaidDocs.slice(0, MAX_PROMPT_LIST),
      flagged: context.flaggedDocs.slice(0, MAX_PROMPT_LIST),
      paidWithCashCount: context.cashDocs.length,
      paidWithCashOnOffDays: context.cashDocs.filter((row) => cadOff.has(row.date) || usdOff.has(row.date)).slice(0, 40),
    },
    transfers: context.transfers.slice(0, MAX_PROMPT_LIST).map(slimTransfer),
    posAuditTrails: {
      ...compactAuditTrailsForPrompt(context.auditTrails),
      salePurchaseTransferLogs: (context.auditTrails?.documentEvents || []).slice(0, 30),
    },
    daysFailedToLoad: context.dayErrors.length ? context.dayErrors : undefined,
  };

  return [
    {
      role: 'system',
      content: `You are a cash till auditor for a Canadian precious-metals retailer (Canada Gold).
Review one store over a date range and explain which days the counted cash did not match expected cash, whether the mistakes carry forward, and what caused them.

There are TWO separate drawers. Evaluate each independently:
- Till 1 CAD: Canadian cash in Till 1.
- USD: US-dollar cash.
Do not mix CAD and USD. Do not FX-convert.

Work through the JSON context:
1. Read till1Cad.days and usd.days in date order. Name every day with a non-zero variance and the amount. Say whether the next day's openingGap absorbs it (the count was corrected) or whether it carries forward. Use summary.varianceSum and firstDayOff.
2. For each off day, read aureusLog for that date first. It is the Aureus Daily Cash log: every cleared cash payment (receipt / outlay) and its paymentBreakdown (cash, debit, cheque, and the rest on that sale or purchase), plus banking and other till lines. beginning + cashChangeFromTransactions + cashChangeFromBanking + cashChangeFromOther = expectedEnding. Then use flaggedPayments, documents, transfers, and posAuditTrails. Prefer one entry or a small combination that equals the variance. A transactionsOmitted count means more cash lines exist than were pasted; the day's totals still include them.
3. Payment method rules: Cash means method Cash with no cheque number in comments. Method Cash with a cheque number is probably a cheque mis-tagged as cash. Method Cheque with no cheque number is incomplete. Debit is only method Debit/Interac/EFT.
4. Paid check: a sale or purchase must be Paid / Cleared with payments that add up to its total. notFullyPaid lists documents that are unpaid, have no payment, or are still owing. Unpaid cash purchases mean cash should not have left the drawer; unpaid cash sales mean cash should not have entered.
5. Till adjustments are manual drawer entries (petty cash, trips, supplies, floats). Check they are on the right day, right drawer, right direction, and not duplicated.
6. Days not counted (daysNotCounted) hide problems. Say which days have no physical count.
7. Use posAuditTrails for deleted payments, amount edits, cash log revisions, and recordDate ≠ trailDate. Cite user and previous → new.
8. Be concrete: dates, drawer, amounts, SO# 12345 / PO# 12345 / TR# 12345, customer, staff.

Write in plain English only. Do not use markdown. Do not use # headings, * asterisks, ** bold, or bullet lists.
Cite every sale or purchase as SO# 12345 or PO# 12345 so it can be opened.

Use exactly this layout and these three labels:

Problem
Two or three short sentences: which drawer, how many days off, the net over or short across the range, and whether it carries forward.

Solution
Two or three short sentences on what to fix or check first.

Reasons
First line: how many days, payments, till entries, sales, purchases, transfers, and log edits were checked.
Then one short line per off day in date order with the best explanation and amount, then one line per unpaid or mis-tagged document that matters. Each on its own line. No numbers or dashes.

Keep every sentence short.`,
    },
    {
      role: 'user',
      content: `Review cash at this store from ${context.startDate} to ${context.endDate} (Till 1 CAD and USD separately).\n\n${JSON.stringify(payload)}`,
    },
  ];
}

export async function analyzeCashRange({ session, startDate, endDate, storeName, model, onProgress, onDelta, signal }) {
  const context = await gatherCashRangeContext(session, { startDate, endDate, storeName, onProgress });
  if (signal?.aborted) throw new Error('Cancelled.');

  onProgress?.('Asking AI…');
  const seedMessages = buildCashRangeMessages(context);
  const text = await streamChatCompletion({
    model,
    messages: seedMessages,
    onDelta,
    signal,
    maxTokens: 16384,
    via: 'openrouter',
  });
  return { context, text, messages: [...seedMessages, { role: 'assistant', content: text || '' }] };
}

// ---------------------------------------------------------------------------
// Follow-up chat (shared)
// ---------------------------------------------------------------------------

const FOLLOW_UP_NOTE = {
  bullion:
    'Stay in the Problem / Solution / Reasons plain layout. No markdown. Keep answering from the same range review context. Cite sales as SO# 12345, purchases as PO# 12345, and transfers as TR# 12345, with the date.',
  cash:
    'Stay in the Problem / Solution / Reasons plain layout. No markdown. Keep answering from the same range review context and keep CAD and USD separate. Cite sales as SO# 12345, purchases as PO# 12345, and transfers as TR# 12345, with the date.',
};

/**
 * Continue a range review conversation. `messages` is the saved transcript
 * (system + context + prior turns) from analyzeBullionRange / analyzeCashRange.
 */
export async function continueRangeChat({ kind, messages, userMessage, model, onDelta, signal }) {
  const question = String(userMessage || '').trim();
  if (!question) throw new Error('Enter a follow-up question.');
  if (!Array.isArray(messages) || !messages.length) throw new Error('Run a range review before chatting.');

  const nextMessages = [
    ...messages,
    { role: 'system', content: FOLLOW_UP_NOTE[kind] || FOLLOW_UP_NOTE.bullion },
    { role: 'user', content: question },
  ];
  const text = await streamChatCompletion({
    model,
    messages: nextMessages,
    onDelta,
    signal,
    maxTokens: 8192,
    via: 'openrouter',
  });
  return { text, messages: [...nextMessages, { role: 'assistant', content: text || '' }] };
}

export { formatAmount, formatQty };
