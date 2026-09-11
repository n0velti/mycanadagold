/**
 * Item-centric bullion audit: reconstruct one product’s movement across
 * stores over a date range (counts, transfers, sales, and purchases).
 */
import { API_BASE_URL, getLinkedPosSessions } from './auth';
import { fetchInventoryLogs, fetchBullionAuditStores } from './bullionAudit';
import { loadShiftCounts } from './bullionNight';
import { fetchBullionProducts, fetchProductInventory, formatQty } from './inventory';
import { textMatchesQuery } from './itemSearch';
import {
  fetchTransactionDetail,
  fetchTransactions,
  formatAmount,
  formatDateParam,
  parseDateParam,
} from './transactions';
import { fetchTransferDetail, fetchTransfers, TRANSFER_STATUSES } from './transfers';

const DETAIL_CONCURRENCY = 6;
const MAX_TX_DETAILS = 120;
const MAX_TRANSFER_DETAILS = 80;
const MAX_RANGE_DAYS = 45;

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

function getErrorMessage(error, fallback) {
  return error?.message || fallback;
}

function toNumber(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function roundQty(value) {
  return Math.round((Number(value) || 0) * 1000) / 1000;
}

function namesMatch(a, b) {
  return (
    String(a || '')
      .trim()
      .localeCompare(String(b || '').trim(), undefined, { sensitivity: 'base' }) === 0
  );
}

function normalizeKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function normalizeTokens(value) {
  const raw = String(value || '')
    .toLowerCase()
    .replace(/grams?/g, 'g')
    .replace(/gms?/g, 'g')
    .replace(/kilos?/g, 'kg')
    .replace(/ounces?/g, 'oz');
  const tokens = raw.match(/[a-z]+|[0-9]+(?:\.[0-9]+)?/g) || [];
  return tokens.slice().sort().join('');
}

function shiftDate(date, days) {
  const next = parseDateParam(date);
  next.setDate(next.getDate() + days);
  return formatDateParam(next);
}

function daysBetween(start, end) {
  const a = parseDateParam(start);
  const b = parseDateParam(end);
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

function dateKeyOf(value) {
  if (value == null || value === '') return '';
  const text = String(value).trim();
  const match = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) return match[1];
  const parsed = Date.parse(text.replace(' ', 'T'));
  if (!Number.isNaN(parsed)) return new Date(parsed).toISOString().slice(0, 10);
  return '';
}

function qtyAtLocation(stocks, productId, locationId) {
  const entries = stocks[String(productId)];
  if (!Array.isArray(entries)) return 0;
  let qty = 0;
  for (const entry of entries) {
    if (String(entry?.location_id) === String(locationId)) {
      qty += Number(entry?.quantity) || 0;
    }
  }
  return roundQty(qty);
}

function logAmount(log) {
  if (!log) return null;
  if (log.amount != null && log.amount !== '') return toNumber(log.amount);
  const vault = toNumber(log.vault_count) ?? 0;
  const store = toNumber(log.store_count) ?? 0;
  const other = toNumber(log.other_count) ?? 0;
  return roundQty(vault + store + other);
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

function catalogKey(product) {
  const name = product?.name || '';
  const sku = product?.sku || '';
  return normalizeTokens(name) || normalizeKey(name) || normalizeKey(sku) || `id:${product?.id}`;
}

function productMetal(product) {
  const metal = product?.metal;
  if (typeof metal === 'string') return metal;
  return metal?.name || product?.metal_type || '';
}

function itemMatchesTarget(item, target) {
  if (!target) return false;
  const ids = new Set(
    [target.id, ...(target.matches || []).map((entry) => entry.id)]
      .filter(Boolean)
      .map(String),
  );
  if (item.productId && ids.has(String(item.productId))) return true;
  const sku = normalizeKey(item.sku);
  const name = normalizeKey(item.name);
  const tokens = normalizeTokens(item.name);
  for (const alias of [target, ...(target.matches || [])]) {
    const targetSku = normalizeKey(alias.sku);
    const targetName = normalizeKey(alias.name);
    const targetTokens = normalizeTokens(alias.name);
    if (sku && targetSku && sku === targetSku) return true;
    if (name && targetName && name === targetName) return true;
    if (tokens && targetTokens && tokens === targetTokens) return true;
  }
  return false;
}

function lineItemFields(item) {
  const product = item?.product || item?.inventory_product || {};
  const productId = String(
    item?.product_id ?? product?.id ?? item?.inventory_product_id ?? '',
  );
  const name =
    item?.description ||
    product?.name ||
    item?.name ||
    item?.quality_mark_description ||
    '';
  const sku = product?.sku || product?.code || item?.sku || '';
  const quantity = toNumber(
    item?.quantity ?? item?.qty ?? item?.amount ?? item?.weight ?? item?.pure_weight,
  );
  const deliveredQuantity = toNumber(
    item?.delivered_quantity ??
      item?.quantity_delivered ??
      item?.delivered_qty ??
      item?.delivery_quantity,
  );
  const deliveryStatus =
    item?.delivery_status || item?.delivered_status || item?.status || item?.item_status || '';
  const deliveredFlag =
    item?.delivered === true ||
    item?.is_delivered === true ||
    /delivered|complete|shipped/i.test(String(deliveryStatus));
  return {
    productId: productId || null,
    name: String(name || '').trim(),
    sku: String(sku || '').trim(),
    quantity,
    deliveredQuantity,
    deliveryStatus: String(deliveryStatus || ''),
    deliveredFlag,
  };
}

function effectiveLineQty(line) {
  if (line.deliveredQuantity != null) return line.deliveredQuantity;
  return line.quantity ?? 0;
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

function listRowLooksLikeItem(row, target) {
  const hay = [row.itemSearchText, ...(row.itemNames || []), ...(row.pricedLines || []).map((line) => line.name)]
    .filter(Boolean)
    .join(' ');
  if (!hay.trim()) return null;
  if (itemMatchesTarget({ name: hay, sku: hay }, target)) return true;
  const names = [...(row.itemNames || []), ...(row.pricedLines || []).map((line) => line.name)];
  return names.some((name) => itemMatchesTarget({ name, sku: name }, target));
}

function matchForStore(item, store) {
  const matches = item?.matches || [];
  return (
    matches.find((entry) => entry.systemKey === store.systemKey) ||
    matches[0] || {
      id: item?.id,
      name: item?.name,
      sku: item?.sku,
      systemKey: store.systemKey,
    }
  );
}

function weekAnchors(startDate, endDate) {
  const anchors = [];
  let cursor = formatDateParam(endDate);
  const start = formatDateParam(startDate);
  while (cursor >= start) {
    anchors.push(cursor);
    cursor = shiftDate(cursor, -7);
  }
  if (!anchors.includes(start)) anchors.push(start);
  return anchors;
}

function formatDayLabel(dateKey) {
  if (!dateKey) return '—';
  return parseDateParam(dateKey).toLocaleDateString('en-CA', {
    month: 'short',
    day: 'numeric',
  });
}

export function formatItemAuditRangeLabel(startDate, endDate) {
  return `${formatDayLabel(startDate)} – ${formatDayLabel(endDate)}`;
}

export { formatQty };

export async function loadItemCatalog(session) {
  const systems = posSystemsFromSession(session);
  if (!systems.length) throw new Error('Not signed in.');

  const results = await Promise.all(
    systems.map(async (system) => {
      try {
        const rows = await fetchBullionProducts(system.token, system.baseUrl);
        return { system, rows, error: '' };
      } catch (error) {
        return {
          system,
          rows: [],
          error: getErrorMessage(error, `Failed to load products (${system.label}).`),
        };
      }
    }),
  );

  const byKey = new Map();
  for (const entry of results) {
    for (const product of entry.rows) {
      const name = product.name || product.sku || `Product ${product.id}`;
      const sku = product.sku || '';
      const key = catalogKey(product);
      if (!byKey.has(key)) {
        byKey.set(key, {
          key,
          id: String(product.id),
          name,
          sku,
          metal: productMetal(product),
          matches: [],
        });
      }
      const item = byKey.get(key);
      if (entry.system.key === 'east') {
        item.id = String(product.id);
        item.name = name;
        item.sku = sku || item.sku;
        item.metal = productMetal(product) || item.metal;
      }
      item.matches.push({
        systemKey: entry.system.key,
        systemLabel: entry.system.label,
        id: String(product.id),
        name,
        sku,
      });
    }
  }

  const items = Array.from(byKey.values()).sort((a, b) => {
    const metal = String(a.metal).localeCompare(String(b.metal), undefined, { sensitivity: 'base' });
    if (metal !== 0) return metal;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });

  return {
    items,
    warning: results.map((entry) => entry.error).filter(Boolean).join(' '),
  };
}

export function filterItemCatalog(items, query) {
  const q = String(query || '').trim();
  if (!q) return items;
  return items.filter((item) => textMatchesQuery(`${item.name} ${item.sku} ${item.metal}`, q));
}

export async function loadItemAuditStores(session) {
  return fetchBullionAuditStores(session);
}

async function fetchLogsForRange(token, { productId, locationId, startDate, endDate }, baseUrl) {
  const anchors = weekAnchors(startDate, endDate);
  const parts = await Promise.all(
    anchors.map((date) =>
      fetchInventoryLogs(
        token,
        { productIds: [String(productId)], locationId, date, forWeek: true },
        baseUrl,
      ).catch(() => []),
    ),
  );
  const byDate = new Map();
  for (const log of parts.flat()) {
    if (String(log?.product_id) !== String(productId)) continue;
    const dateKey = dateKeyOf(log?.date);
    if (!dateKey || dateKey < startDate || dateKey > endDate) continue;
    byDate.set(dateKey, log);
  }
  return Array.from(byDate.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, log]) => ({
      date,
      amount: logAmount(log),
      vaultCount: toNumber(log.vault_count),
      storeCount: toNumber(log.store_count),
      otherCount: toNumber(log.other_count),
      logId: log.id ?? null,
    }));
}

async function gatherItemTransfers(session, { startDate, endDate, stores, target, onProgress }) {
  const systems = new Map();
  for (const store of stores) {
    const key = store.systemKey || 'east';
    if (!systems.has(key)) {
      systems.set(key, {
        key,
        token: store.token,
        baseUrl: store.baseUrl,
        stores: [],
      });
    }
    systems.get(key).stores.push(store);
  }

  const pendingSince = shiftDate(endDate, -60);
  const all = [];
  const warnings = [];

  await Promise.all(
    Array.from(systems.values()).map(async (system) => {
      onProgress?.(`Loading ${system.key.toUpperCase()} transfers…`);
      const results = await Promise.all(
        TRANSFER_STATUSES.map(async (status) => {
          try {
            const rows = await fetchTransfers(system.token, {
              status,
              since: status === 'pending' ? pendingSince : startDate,
              baseUrl: system.baseUrl,
            });
            return { status, rows, error: '' };
          } catch (error) {
            return {
              status,
              rows: [],
              error: getErrorMessage(error, `Failed to load ${status} transfers.`),
            };
          }
        }),
      );
      warnings.push(...results.map((entry) => entry.error).filter(Boolean));

      const seen = new Set();
      const touching = [];
      for (const entry of results) {
        for (const transfer of entry.rows) {
          if (transfer.id && seen.has(transfer.id)) continue;
          if (transfer.date && transfer.date > endDate) continue;
          if (transfer.status === 'received' && transfer.date && transfer.date < startDate) {
            if (!transfer.receivedDate || transfer.receivedDate < startDate) continue;
          }
          const hitsStore = system.stores.some(
            (store) =>
              namesMatch(transfer.from?.name, store.name) ||
              namesMatch(transfer.to?.name, store.name) ||
              String(transfer.from?.id) === String(store.id) ||
              String(transfer.to?.id) === String(store.id),
          );
          if (!hitsStore) continue;
          if (transfer.id) seen.add(transfer.id);
          touching.push({ ...transfer, systemKey: system.key, token: system.token, baseUrl: system.baseUrl });
        }
      }

      const needDetail = touching.filter((transfer) => !transfer.hasItems).slice(0, MAX_TRANSFER_DETAILS);
      if (needDetail.length) {
        onProgress?.(
          `Reading ${needDetail.length} transfer${needDetail.length === 1 ? '' : 's'}…`,
        );
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
          if (detail) touching[i] = { ...touching[i], ...detail };
        }
      }

      all.push(...touching);
    }),
  );

  const events = [];
  for (const transfer of all) {
    const lines = (transfer.items || []).filter((item) => itemMatchesTarget(item, target));
    if (!lines.length && transfer.hasItems) continue;
    if (!lines.length && !transfer.hasItems) continue;
    const qty = roundQty(lines.reduce((sum, line) => sum + (line.quantity || 0), 0));
    const receivedQty = roundQty(
      lines.reduce(
        (sum, line) => sum + (line.receivedQuantity != null ? line.receivedQuantity : line.quantity || 0),
        0,
      ),
    );
    const shortfall = roundQty(
      lines.reduce((sum, line) => sum + (line.shortfall || 0), 0),
    );
    if (!qty && !receivedQty && transfer.hasItems) continue;

    for (const store of stores) {
      const fromHere =
        namesMatch(transfer.from?.name, store.name) || String(transfer.from?.id) === String(store.id);
      const toHere =
        namesMatch(transfer.to?.name, store.name) || String(transfer.to?.id) === String(store.id);
      if (!fromHere && !toHere) continue;
      const pending = transfer.status !== 'received';
      const direction = fromHere && toHere ? 'internal' : fromHere ? 'out' : 'in';
      events.push({
        id: `tr-${transfer.id}-${store.id}`,
        kind: pending
          ? direction === 'in'
            ? 'pending_in'
            : 'pending_out'
          : direction === 'in'
            ? 'transfer_in'
            : 'transfer_out',
        date: transfer.receivedDate || transfer.date,
        sortDate: `${transfer.receivedDate || transfer.date || ''}T23:00:00`,
        storeName: store.name,
        storeId: store.id,
        title: pending
          ? direction === 'in'
            ? 'In transit in'
            : 'In transit out'
          : direction === 'in'
            ? 'Transfer received'
            : 'Transfer sent',
        reference: transfer.reference,
        from: transfer.from?.name || '',
        to: transfer.to?.name || '',
        qty: direction === 'out' ? -qty : pending ? qty : receivedQty,
        sentQty: qty,
        receivedQty,
        shortfall,
        status: transfer.status,
        comments: transfer.comments || '',
        createdBy: transfer.createdBy || '',
        receivedBy: transfer.receivedBy || '',
      });
    }
  }

  return { events, warning: warnings.filter(Boolean).join(' ') };
}

async function gatherItemTransactions(session, { startDate, endDate, stores, target, onProgress }) {
  const systems = new Map();
  for (const store of stores) {
    const key = store.systemKey || 'east';
    if (!systems.has(key)) {
      systems.set(key, {
        key,
        label: store.systemLabel || key,
        token: store.token,
        baseUrl: store.baseUrl,
        storeNames: new Set(),
      });
    }
    systems.get(key).storeNames.add(store.name);
  }

  const events = [];
  const warnings = [];
  let skipped = 0;

  await Promise.all(
    Array.from(systems.values()).map(async (system) => {
      onProgress?.(`Loading ${system.label} sales and purchases…`);
      let rows = [];
      try {
        const result = await fetchTransactions(system.token, {
          startDate,
          endDate,
          baseUrl: system.baseUrl,
          system: { key: system.key, label: system.label, baseUrl: system.baseUrl },
        });
        rows = result.rows.filter((row) =>
          Array.from(system.storeNames).some((name) => namesMatch(row.storeName, name)),
        );
      } catch (error) {
        warnings.push(getErrorMessage(error, `Failed to load transactions (${system.label}).`));
        return;
      }

      const definite = [];
      const unknown = [];
      for (const row of rows) {
        const looksLike = listRowLooksLikeItem(row, target);
        if (looksLike === true) definite.push(row);
        else if (looksLike === false) continue;
        else unknown.push(row);
      }

      const toEnrich = [...definite, ...unknown].slice(0, MAX_TX_DETAILS);
      skipped += Math.max(0, definite.length + unknown.length - toEnrich.length);
      if (toEnrich.length) {
        onProgress?.(
          `Reviewing ${toEnrich.length} transaction${toEnrich.length === 1 ? '' : 's'} for this item…`,
        );
      }

      const enriched = await mapPool(toEnrich, DETAIL_CONCURRENCY, async (row) => {
        try {
          const detail = await fetchTransactionDetail(system.token, {
            type: row.type,
            sourceId: row.sourceId,
            baseUrl: system.baseUrl,
          });
          const rawItems = Array.isArray(detail?.items) ? detail.items : [];
          const lines = rawItems.map(lineItemFields).filter((line) => itemMatchesTarget(line, target));
          if (!lines.length) return null;
          const qty = roundQty(lines.reduce((sum, line) => sum + (effectiveLineQty(line) || 0), 0));
          const listed = roundQty(lines.reduce((sum, line) => sum + (line.quantity || 0), 0));
          const undelivered = lines.filter(lineIsUndelivered);
          return {
            id: `${row.type}-${row.sourceId}-${row.storeName}`,
            kind: row.type === 'purchase' ? 'purchase' : 'sale',
            date: dateKeyOf(row.date) || startDate,
            sortDate: row.date || `${dateKeyOf(row.date)}T12:00:00`,
            storeName: row.storeName,
            title: row.type === 'purchase' ? 'Purchase' : 'Sale',
            reference: row.reference,
            customerName: row.customerName || '',
            employeeName: row.employeeName || '',
            timeLabel: row.timeLabel || '',
            amountLabel: row.amountLabel || formatAmount(row.amount),
            paymentStatus: detail?.payment_status || '',
            itemStatus: detail?.item_status || '',
            comments: detail?.comments || '',
            qty: row.type === 'purchase' ? qty : -qty,
            listedQty: listed,
            undeliveredQty: roundQty(
              undelivered.reduce((sum, line) => {
                const listedQty = line.quantity || 0;
                const delivered = line.deliveredQuantity ?? 0;
                return sum + Math.max(0, listedQty - delivered);
              }, 0),
            ),
            lines: lines.map((line) => ({
              name: line.name,
              sku: line.sku,
              quantity: line.quantity,
              deliveredQuantity: line.deliveredQuantity,
              deliveryStatus: line.deliveryStatus,
            })),
            sourceId: row.sourceId,
            type: row.type,
            systemKey: system.key,
          };
        } catch {
          const looksLike = listRowLooksLikeItem(row, target);
          if (looksLike !== true) return null;
          const listed = roundQty(
            (row.pricedLines || [])
              .filter((line) => itemMatchesTarget({ name: line.name, sku: line.name }, target))
              .reduce((sum, line) => sum + (Number(line.quantity) || 0), 0),
          );
          if (!listed) return null;
          return {
            id: `${row.type}-${row.sourceId}-${row.storeName}`,
            kind: row.type === 'purchase' ? 'purchase' : 'sale',
            date: dateKeyOf(row.date) || startDate,
            sortDate: row.date || `${dateKeyOf(row.date)}T12:00:00`,
            storeName: row.storeName,
            title: row.type === 'purchase' ? 'Purchase' : 'Sale',
            reference: row.reference,
            customerName: row.customerName || '',
            employeeName: row.employeeName || '',
            timeLabel: row.timeLabel || '',
            amountLabel: row.amountLabel || formatAmount(row.amount),
            qty: row.type === 'purchase' ? listed : -listed,
            listedQty: listed,
            undeliveredQty: 0,
            lines: [],
            sourceId: row.sourceId,
            type: row.type,
            systemKey: system.key,
          };
        }
      });

      events.push(...enriched.filter(Boolean));
    }),
  );

  if (skipped) {
    warnings.push(`Stopped after ${MAX_TX_DETAILS} transaction details; some later tickets were skipped.`);
  }

  return { events, warning: warnings.filter(Boolean).join(' ') };
}

function explainStore(store) {
  const reasons = [];
  const off = store.countDiff;
  const offNow = store.systemDiff;

  if (store.pendingIn > 0) {
    reasons.push(
      `${formatQty(store.pendingIn)} still in transit to ${store.name} — not in this vault, and usually not in system until received.`,
    );
  }
  if (store.pendingOut > 0) {
    reasons.push(
      `${formatQty(store.pendingOut)} sent out and not yet received — metal may have left the vault while system still shows it here.`,
    );
  }
  if (store.receivedShort > 0) {
    reasons.push(
      `A received transfer was short ${formatQty(store.receivedShort)} versus what was sent.`,
    );
  }
  if (store.undeliveredSold > 0) {
    reasons.push(
      `${formatQty(store.undeliveredSold)} sold but not delivered — still physically here if system already removed it, or still on the ticket.`,
    );
  }
  if (store.undeliveredBought > 0) {
    reasons.push(
      `${formatQty(store.undeliveredBought)} bought but not received — may be in system without being in the vault.`,
    );
  }
  if (store.nightCount != null || store.afternoonCount != null) {
    reasons.push(
      `Today’s shift counts: night ${store.nightCount == null ? '—' : formatQty(store.nightCount)}, afternoon ${store.afternoonCount == null ? '—' : formatQty(store.afternoonCount)}.`,
    );
  }
  if (store.lastCount && store.lastCount.date && Math.abs(store.countDiff) >= 0.0005) {
    reasons.push(
      `Last count on ${formatDayLabel(store.lastCount.date)} was ${formatQty(store.lastCount.amount)} vs system ${formatQty(store.systemNow)} (${off > 0 ? '+' : ''}${formatQty(off)}).`,
    );
  }
  if (store.openingCount && Math.abs(store.openingCount.diff || 0) >= 0.0005) {
    reasons.push(
      `Already off at the start of the range: counted ${formatQty(store.openingCount.amount)} vs system ${formatQty(store.openingSystem)} on ${formatDayLabel(store.openingCount.date)}.`,
    );
  }
  if (Math.abs(offNow) >= 0.0005) {
    reasons.push(
      `Expected system from this range is ${formatQty(store.expectedNow)} vs system now ${formatQty(store.systemNow)} (${offNow > 0 ? '+' : ''}${formatQty(offNow)} unexplained by these tickets).`,
    );
  } else if (Math.abs(store.countDiff) < 0.0005 && store.lastCount) {
    reasons.push('Last count matches system. Nothing obvious is still open on this item at this store.');
  } else if (!store.lastCount) {
    reasons.push('No vault count was saved in this range, so the off amount is system movement only.');
  }

  if (!reasons.length) {
    reasons.push('No transfers, tickets, or counts in this range explain a variance.');
  }
  return reasons;
}

function buildStoreDossier({ store, match, openingSystem, systemNow, logs, events, shift }) {
  const storeEvents = events.filter((event) => namesMatch(event.storeName, store.name));
  const sales = storeEvents.filter((event) => event.kind === 'sale');
  const purchases = storeEvents.filter((event) => event.kind === 'purchase');
  const transferIn = storeEvents.filter((event) => event.kind === 'transfer_in');
  const transferOut = storeEvents.filter((event) => event.kind === 'transfer_out');
  const pendingIn = storeEvents.filter((event) => event.kind === 'pending_in');
  const pendingOut = storeEvents.filter((event) => event.kind === 'pending_out');

  const soldQty = roundQty(sales.reduce((sum, event) => sum + Math.abs(event.qty || 0), 0));
  const boughtQty = roundQty(purchases.reduce((sum, event) => sum + Math.abs(event.qty || 0), 0));
  const receivedIn = roundQty(transferIn.reduce((sum, event) => sum + Math.abs(event.qty || 0), 0));
  const sentOut = roundQty(transferOut.reduce((sum, event) => sum + Math.abs(event.qty || 0), 0));
  const pendingInQty = roundQty(pendingIn.reduce((sum, event) => sum + Math.abs(event.qty || 0), 0));
  const pendingOutQty = roundQty(pendingOut.reduce((sum, event) => sum + Math.abs(event.qty || 0), 0));
  const receivedShort = roundQty(
    [...transferIn, ...transferOut].reduce((sum, event) => sum + (event.shortfall || 0), 0),
  );
  const undeliveredSold = roundQty(sales.reduce((sum, event) => sum + (event.undeliveredQty || 0), 0));
  const undeliveredBought = roundQty(
    purchases.reduce((sum, event) => sum + (event.undeliveredQty || 0), 0),
  );

  const expectedNow = roundQty(openingSystem - soldQty + boughtQty - sentOut + receivedIn);
  const lastCount = logs.length ? logs[logs.length - 1] : null;
  const openingCount = logs.length ? logs[0] : null;
  const countedNow = lastCount?.amount ?? null;
  const night = shift?.night ?? null;
  const afternoon = shift?.afternoon ?? null;
  const todayLog = logs.find((log) => log.date === shift?.today) || (lastCount?.date === shift?.today ? lastCount : null);
  const physicalNow =
    shift && (night != null || afternoon != null)
      ? roundQty((todayLog?.amount ?? 0) + (night ?? 0) + (afternoon ?? 0))
      : countedNow;

  const countBase = physicalNow != null ? physicalNow : countedNow;
  const dossier = {
    id: store.id,
    name: store.name,
    systemKey: store.systemKey,
    productId: match.id,
    openingSystem,
    systemNow,
    expectedNow,
    lastCount,
    openingCount: openingCount
      ? {
          ...openingCount,
          diff: openingCount.amount == null ? null : roundQty(openingCount.amount - openingSystem),
        }
      : null,
    countedNow,
    physicalNow,
    nightCount: night,
    afternoonCount: afternoon,
    soldQty,
    boughtQty,
    receivedIn,
    sentOut,
    pendingIn: pendingInQty,
    pendingOut: pendingOutQty,
    receivedShort,
    undeliveredSold,
    undeliveredBought,
    countDiff: countBase == null ? 0 : roundQty(countBase - systemNow),
    systemDiff: roundQty(expectedNow - systemNow),
    logs,
    events: storeEvents.sort((a, b) => String(b.sortDate || b.date).localeCompare(String(a.sortDate || a.date))),
  };
  dossier.off = Math.abs(dossier.countDiff) >= 0.0005 || Math.abs(dossier.systemDiff) >= 0.0005
    || pendingInQty > 0
    || pendingOutQty > 0
    || receivedShort > 0
    || undeliveredSold > 0
    || undeliveredBought > 0;
  dossier.reasons = explainStore(dossier);
  return dossier;
}

export async function gatherItemAudit(
  session,
  { item, stores, startDate, endDate, onProgress } = {},
) {
  if (!item) throw new Error('Select an item.');
  const selected = (stores || []).filter(Boolean);
  if (!selected.length) throw new Error('Select at least one store.');

  const start = formatDateParam(startDate);
  const end = formatDateParam(endDate);
  if (start > end) throw new Error('Start date must be before the end date.');
  if (daysBetween(start, end) > MAX_RANGE_DAYS) {
    throw new Error(`Keep the range to ${MAX_RANGE_DAYS} days or fewer.`);
  }

  const openingDate = shiftDate(start, -1);
  const today = formatDateParam(new Date());
  const warnings = [];

  onProgress?.('Loading system counts…');
  const storeResults = await Promise.all(
    selected.map(async (store) => {
      const match = matchForStore(item, store);
      if (!match?.id || !store.token) {
        return { store, match, openingSystem: 0, systemNow: 0, logs: [], shift: null, error: 'Missing product or store login.' };
      }
      try {
        const [openingInv, currentInv, logs] = await Promise.all([
          fetchProductInventory(store.token, [String(match.id)], store.baseUrl, {
            locations: store.id,
            date: openingDate,
          }).catch(() => ({ stocks: {} })),
          fetchProductInventory(store.token, [String(match.id)], store.baseUrl, {
            locations: store.id,
            date: end,
          }).catch(() => ({ stocks: {} })),
          fetchLogsForRange(
            store.token,
            { productId: match.id, locationId: store.id, startDate: start, endDate: end },
            store.baseUrl,
          ),
        ]);
        let shift = null;
        if (end === today) {
          try {
            const counts = await loadShiftCounts(store.name);
            const night = counts?.night?.[String(match.id)];
            const afternoon = counts?.afternoon?.[String(match.id)];
            shift = {
              today,
              night: night != null ? toNumber(night) : null,
              afternoon: afternoon != null ? toNumber(afternoon) : null,
            };
          } catch {
            shift = null;
          }
        }
        return {
          store,
          match,
          openingSystem: qtyAtLocation(openingInv.stocks || {}, match.id, store.id),
          systemNow: qtyAtLocation(currentInv.stocks || {}, match.id, store.id),
          logs,
          shift,
          error: '',
        };
      } catch (error) {
        return {
          store,
          match,
          openingSystem: 0,
          systemNow: 0,
          logs: [],
          shift: null,
          error: getErrorMessage(error, `Failed to load counts for ${store.name}.`),
        };
      }
    }),
  );
  warnings.push(...storeResults.map((entry) => entry.error).filter(Boolean));

  const [transfers, transactions] = await Promise.all([
    gatherItemTransfers(session, {
      startDate: start,
      endDate: end,
      stores: selected,
      target: item,
      onProgress,
    }),
    gatherItemTransactions(session, {
      startDate: start,
      endDate: end,
      stores: selected,
      target: item,
      onProgress,
    }),
  ]);
  if (transfers.warning) warnings.push(transfers.warning);
  if (transactions.warning) warnings.push(transactions.warning);

  const events = [...transfers.events, ...transactions.events];
  const locations = storeResults.map((entry) =>
    buildStoreDossier({
      store: entry.store,
      match: entry.match,
      openingSystem: entry.openingSystem,
      systemNow: entry.systemNow,
      logs: entry.logs,
      events,
      shift: entry.shift,
    }),
  );

  const timeline = [
    ...events,
    ...locations.flatMap((location) =>
      location.logs.map((log) => ({
        id: `count-${location.id}-${log.date}`,
        kind: 'count',
        date: log.date,
        sortDate: `${log.date}T23:50:00`,
        storeName: location.name,
        storeId: location.id,
        title: 'Vault count',
        reference: '',
        qty: log.amount,
        vaultCount: log.vaultCount,
        storeCount: log.storeCount,
        otherCount: log.otherCount,
      })),
    ),
  ].sort((a, b) => String(b.sortDate || b.date).localeCompare(String(a.sortDate || a.date)));

  return {
    item: {
      id: item.id,
      name: item.name,
      sku: item.sku,
      metal: item.metal,
    },
    startDate: start,
    endDate: end,
    openingDate,
    locations,
    timeline,
    warning: warnings.filter(Boolean).join(' '),
  };
}
