import { API_BASE_URL, getLinkedPosSessions } from './auth';
import {
  fetchInventoryLogs,
  formatQty,
  resolveBullionSystem,
} from './bullionAudit';
import { compactAuditTrailsForPrompt, gatherBullionAuditTrails } from './auditTrails';
import { fetchStoreCashPosition } from './cashTill';
import { fetchProductInventory } from './inventory';
import { streamChatCompletion } from './llmProviders';
import {
  fetchTransactionDetail,
  fetchTransactions,
  formatAmount,
  formatDateParam,
  parseDateParam,
  toLookupTransaction,
} from './transactions';

const DETAIL_CONCURRENCY = 6;

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

function storeMatches(name, storeName) {
  if (!storeName) return true;
  return (
    String(name || '')
      .trim()
      .localeCompare(String(storeName || '').trim(), undefined, { sensitivity: 'base' }) === 0
  );
}

function toNumber(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
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
  return qty;
}

function stockMetaAtLocation(stocks, productId, locationId) {
  const entries = stocks[String(productId)];
  if (!Array.isArray(entries)) return { quantity: 0, lastDeliveryDate: null };
  let quantity = 0;
  let lastDeliveryDate = null;
  for (const entry of entries) {
    if (String(entry?.location_id) !== String(locationId)) continue;
    quantity += Number(entry?.quantity) || 0;
    const delivery = entry?.last_delivery_date || null;
    if (delivery && (!lastDeliveryDate || String(delivery) > String(lastDeliveryDate))) {
      lastDeliveryDate = delivery;
    }
  }
  return { quantity, lastDeliveryDate };
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

function shiftDateKey(date, days) {
  const next = parseDateParam(date);
  next.setDate(next.getDate() + days);
  return formatDateParam(next);
}

function normalizeKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
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
  const metal = product?.metal?.name || product?.metal || item?.metal || '';
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
    item?.delivery_status ||
    item?.delivered_status ||
    item?.status ||
    item?.item_status ||
    '';
  const deliveredFlag =
    item?.delivered === true ||
    item?.is_delivered === true ||
    /delivered|complete|shipped/i.test(String(deliveryStatus));

  return {
    productId: productId || null,
    name: String(name || '').trim(),
    sku: String(sku || '').trim(),
    metal: typeof metal === 'string' ? metal : metal?.name || '',
    quantity,
    deliveredQuantity,
    deliveryStatus: String(deliveryStatus || ''),
    deliveredFlag,
    unitPrice: toNumber(item?.price ?? item?.unit_price ?? item?.amount_per_unit),
    lineTotal: toNumber(item?.total ?? item?.line_total ?? item?.extended_price),
  };
}

function itemMatchesTargets(line, targets) {
  if (!targets.length) return false;
  const id = line.productId ? String(line.productId) : '';
  const nameKey = normalizeKey(line.name);
  const skuKey = normalizeKey(line.sku);

  return targets.some((target) => {
    if (id && String(target.id) === id) return true;
    const targetName = normalizeKey(target.name);
    const targetSku = normalizeKey(target.sku);
    if (skuKey && targetSku && skuKey === targetSku) return true;
    if (nameKey && targetName && (nameKey === targetName || nameKey.includes(targetName) || targetName.includes(nameKey))) {
      return true;
    }
    const metal = normalizeKey(line.metal);
    const targetMetal = normalizeKey(target.metal);
    if (metal && targetMetal && metal === targetMetal && (nameKey.includes(targetSku) || skuKey.includes(normalizeKey(target.name)))) {
      return true;
    }
    return false;
  });
}

async function loadStoreDayTransactions(session, { date, storeName }) {
  const day = formatDateParam(date);
  const systems = posSystemsFromSession(session);
  const results = await Promise.all(
    systems.map(async (system) => {
      try {
        const result = await fetchTransactions(system.token, {
          startDate: day,
          endDate: day,
          baseUrl: system.baseUrl,
        });
        const rows = result.rows
          .filter((row) => storeMatches(row.storeName, storeName))
          .map((row) => ({
            ...row,
            systemKey: system.key,
            systemLabel: system.label,
            baseUrl: system.baseUrl,
            token: system.token,
          }));
        return { rows, error: '' };
      } catch (error) {
        return {
          rows: [],
          error: error?.message || `Failed to load transactions (${system.label}).`,
        };
      }
    }),
  );

  return {
    rows: results.flatMap((result) => result.rows),
    warning: results.map((result) => result.error).filter(Boolean).join(' '),
  };
}

async function enrichBullionTransaction(row, targets) {
  try {
    const detail = await fetchTransactionDetail(row.token, {
      type: row.type,
      sourceId: row.sourceId,
      baseUrl: row.baseUrl,
    });
    const rawItems = Array.isArray(detail?.items) ? detail.items : [];
    const lines = rawItems.map(lineItemFields);
    const matchedLines = lines.filter((line) => itemMatchesTargets(line, targets));
    if (!matchedLines.length) return null;

    const payments = Array.isArray(detail?.payments) ? detail.payments : [];
    const paymentSummary = payments.map((entry) => {
      const payment = entry?.payment || entry || {};
      return {
        method: payment.payment_type?.name || entry?.payment?.payment_type?.name || 'Other',
        amount: Number(entry?.amount ?? payment.amount) || 0,
        amountLabel: formatAmount(Number(entry?.amount ?? payment.amount) || 0),
        comments: payment.comments || entry?.comments || '',
        status: payment.status || '',
      };
    });

    const undeliveredLines = matchedLines.filter((line) => {
      if (line.deliveredQuantity != null && line.quantity != null) {
        return Math.abs(line.deliveredQuantity - line.quantity) > 0.0005;
      }
      if (line.deliveryStatus) {
        return !line.deliveredFlag && !/delivered|complete/i.test(line.deliveryStatus);
      }
      return false;
    });

    return {
      reference: row.reference,
      type: row.type,
      sourceId: row.sourceId,
      date: row.date,
      dateLabel: row.dateLabel,
      timeLabel: row.timeLabel,
      customerName: row.customerName,
      employeeName: row.employeeName,
      storeName: row.storeName,
      amount: row.amount,
      amountLabel: row.amountLabel,
      paymentMethods: row.paymentMethods || '',
      paymentStatus: detail?.payment_status || '',
      itemStatus: detail?.item_status || '',
      allocationStatus: detail?.allocation_status || '',
      comments: detail?.comments || '',
      payments: paymentSummary,
      matchedItems: matchedLines,
      undeliveredItems: undeliveredLines,
      flags: {
        hasUndeliveredItems: undeliveredLines.length > 0,
        notPaid:
          detail?.payment_status &&
          !/paid|cleared|complete/i.test(String(detail.payment_status)),
        itemNotComplete:
          detail?.item_status &&
          !/complete|delivered|fulfilled/i.test(String(detail.item_status)),
      },
    };
  } catch (error) {
    return {
      reference: row.reference,
      type: row.type,
      sourceId: row.sourceId,
      amount: row.amount,
      amountLabel: row.amountLabel,
      error: error?.message || 'Failed to load detail',
    };
  }
}

/**
 * Build imbalance rows from current audit drafts (UI state).
 */
export function buildUnbalancedBullionItems(rows, drafts) {
  const unbalanced = [];
  for (const row of rows) {
    const draft = drafts?.[row.id] || {};
    const hasEntry =
      (draft.vault != null && String(draft.vault).trim() !== '') ||
      (draft.store != null && String(draft.store).trim() !== '') ||
      (draft.other != null && String(draft.other).trim() !== '') ||
      row.amount != null;

    if (!hasEntry) continue;

    const vault = toNumber(draft.vault) ?? toNumber(row.vaultCount) ?? 0;
    const store = toNumber(draft.store) ?? toNumber(row.storeCount) ?? 0;
    const other = toNumber(draft.other) ?? toNumber(row.otherCount) ?? 0;
    const countedTotal = vault + store + other;
    const systemCount = Number(row.systemCount) || 0;
    const diff = Math.round((countedTotal - systemCount) * 1000) / 1000;
    if (Math.abs(diff) < 0.0005) continue;

    const historyDates = Object.keys(row.history || {}).sort();
    const yesterdayKey = historyDates[historyDates.length - 1] || null;
    const yesterdayCount =
      yesterdayKey != null ? toNumber(row.history?.[yesterdayKey]) : null;

    unbalanced.push({
      id: row.id,
      name: row.name,
      sku: row.sku,
      metal: row.metal,
      systemCount,
      countedTotal,
      vaultCount: vault,
      storeCount: store,
      otherCount: other,
      diff,
      diffLabel: `${diff > 0 ? '+' : ''}${formatQty(diff)}`,
      yesterdayCount,
      yesterdayDate: yesterdayKey,
    });
  }
  return unbalanced.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
}

export async function gatherBullionAuditContext(
  session,
  { date, storeName, locationId, systemKey, unbalancedItems, onProgress } = {},
) {
  if (!storeName) throw new Error('Select a store first.');
  if (!locationId) throw new Error('Store location is missing.');

  const day = formatDateParam(date);
  const yesterday = shiftDateKey(day, -1);
  const targets = Array.isArray(unbalancedItems) ? unbalancedItems : [];
  if (!targets.length) {
    throw new Error('No unbalanced metals to investigate. Enter vault counts and Update first.');
  }

  const system = resolveBullionSystem(session, systemKey);
  const { token, baseUrl } = system;
  const productIds = targets.map((item) => String(item.id));

  onProgress?.('Loading yesterday system counts…');
  const [yesterdayInventory, yesterdayLogs, cashPosition, dayTx, auditTrails] = await Promise.all([
    fetchProductInventory(token, productIds, baseUrl, {
      locations: locationId,
      date: yesterday,
    }).catch(() => ({ stocks: {} })),
    fetchInventoryLogs(
      token,
      { productIds, locationId, date: yesterday, forWeek: false },
      baseUrl,
    ).catch(() => []),
    fetchStoreCashPosition(session, { date: day, storeName }).catch((error) => ({
      error: error?.message || 'Failed to load cash position.',
    })),
    (async () => {
      onProgress?.('Loading store transactions…');
      return loadStoreDayTransactions(session, { date: day, storeName });
    })(),
    gatherBullionAuditTrails(session, {
      date: day,
      previousDate: yesterday,
      locationId,
      systemKey: system.key,
      productIds,
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

  const yesterdayLogByProduct = new Map();
  for (const log of yesterdayLogs) {
    yesterdayLogByProduct.set(String(log.product_id), log);
  }

  onProgress?.('Loading today’s stock delivery dates…');
  let todayStocks = {};
  try {
    const inv = await fetchProductInventory(token, productIds, baseUrl, {
      locations: locationId,
      date: day,
    });
    todayStocks = inv.stocks || {};
  } catch {
    todayStocks = {};
  }

  const enrichedUnbalanced = targets.map((item) => {
    const ySystem = qtyAtLocation(yesterdayInventory.stocks || {}, item.id, locationId);
    const yLog = yesterdayLogByProduct.get(String(item.id));
    const yCounted =
      yLog != null
        ? (toNumber(yLog.amount) ??
          (toNumber(yLog.vault_count) || 0) +
            (toNumber(yLog.store_count) || 0) +
            (toNumber(yLog.other_count) || 0))
        : item.yesterdayCount;
    const yDiff =
      yCounted == null ? null : Math.round((yCounted - ySystem) * 1000) / 1000;
    const meta = stockMetaAtLocation(todayStocks, item.id, locationId);

    return {
      ...item,
      yesterdaySystemCount: ySystem,
      yesterdayCounted: yCounted,
      yesterdayDiff: yDiff,
      yesterdayBalanced: yDiff != null && Math.abs(yDiff) < 0.0005,
      lastDeliveryDate: meta.lastDeliveryDate,
      systemCountLabel: formatQty(item.systemCount),
      countedTotalLabel: formatQty(item.countedTotal),
    };
  });

  onProgress?.(
    `Reviewing ${dayTx.rows.length} transaction detail${dayTx.rows.length === 1 ? '' : 's'}…`,
  );
  const enrichedAll = await mapPool(dayTx.rows, DETAIL_CONCURRENCY, (row) =>
    enrichBullionTransaction(row, targets),
  );
  const relatedTransactions = enrichedAll.filter(Boolean);
  const undeliveredAcross = relatedTransactions.flatMap(
    (tx) => tx.undeliveredItems || [],
  );

  const cash =
    cashPosition && !cashPosition.error
      ? {
          expectedOnHand: cashPosition.expectedOnHand,
          paymentNet: cashPosition.paymentTotals?.net ?? 0,
          paymentCashIn: cashPosition.paymentTotals?.cashIn ?? 0,
          paymentCashOut: cashPosition.paymentTotals?.cashOut ?? 0,
          tillAdjNet: cashPosition.cashTxnTotals?.net ?? 0,
          openingBalance: cashPosition.openingBalance,
          yesterdayClosing: cashPosition.yesterday?.closing,
          warning: cashPosition.warning || '',
        }
      : {
          error: cashPosition?.error || 'Cash position unavailable.',
        };

  return {
    storeName,
    locationId: String(locationId),
    date: day,
    yesterday,
    unbalancedItems: enrichedUnbalanced,
    unbalancedCount: enrichedUnbalanced.length,
    relatedTransactions,
    lookupTransactions: dayTx.rows.map(toLookupTransaction).filter(Boolean),
    undeliveredItemCount: undeliveredAcross.length,
    cash,
    auditTrails,
    transactionCount: dayTx.rows.length,
    relatedTransactionCount: relatedTransactions.length,
    warning: [dayTx.warning, cash.warning, auditTrails?.warning].filter(Boolean).join(' '),
  };
}

function buildBullionAuditMessages(context) {
  const payload = {
    store: context.storeName,
    date: context.date,
    yesterday: context.yesterday,
    unbalancedMetals: context.unbalancedItems,
    cashSameDay: context.cash,
    relatedSalesAndPurchases: (context.relatedTransactions || []).slice(0, 24),
    undeliveredItemCount: context.undeliveredItemCount,
    posAuditTrails: compactAuditTrailsForPrompt(context.auditTrails),
    notes: {
      diffMeaning: 'diff = countedTotal (vault+store+other) − systemCount. Negative = short vs system.',
      deliveryCheck:
        'Prefer undeliveredItems / delivered_quantity mismatches and item_status not complete. Inventory lastDeliveryDate is also provided per product.',
      yesterdayCheck:
        'yesterdayBalanced false means yesterday physical count already disagreed with yesterday system — problem may be older than today.',
      cashCompare:
        'Use cashSameDay to see if cash movement that day lines up with metal buys/sells (e.g. purchase paid cash but metal not received/delivered).',
      auditTrails:
        'Use posAuditTrails before guessing a miscount. Cite user, previous → new, trailDate vs recordDate, and SO#/PO#/product id.',
    },
  };

  return [
    {
      role: 'system',
      content: `You are a bullion vault auditor for a Canadian precious-metals retailer (Canada Gold).
Investigate why physical vault/store counts do not match Aureus system inventory for specific bullion products at one store/day.

Investigate thoroughly using the JSON context:
1. For each unbalanced metal/product, review related sales (SO) and purchases (PO) that day involving that product or metal.
2. Check whether it already failed to balance yesterday (yesterdayBalanced / yesterdayDiff). If yesterday was off, say the issue likely predates today.
3. Compare same-day cash activity (cashSameDay) with metal movement — e.g. cash paid for a purchase but metal not in vault, or sale recorded without metal leaving stock.
4. Check delivery vs entry: items entered/allocated in a transaction but not delivered (undeliveredItems, delivered_quantity ≠ quantity, item_status incomplete). Metal may be on the invoice but never physically received or handed over.
5. Look for wrong product/SKU, wrong qty, void/unpaid txs still affecting stock, transfers, or count entry mistakes (vault vs store vs other).
6. POS audit trails: inventory-log vault/store/other/amount revisions, SO/PO delivered/deleted/updated, item qty changes, and recordDate ≠ trailDate. Add those qty/amount deltas to counted vs system before guessing.
7. Prefer concrete citations: product name/SKU, SO# 12345 or PO# 12345, qty, payment method, statuses, delivery flags, $ amounts, trail user, and previous → new.

Write in plain English only. Do not use markdown. Do not use # headings, * asterisks, ** bold, or bullet lists.
Cite every sale or purchase as SO# 12345 or PO# 12345 so it can be opened.

Use exactly this layout and these three labels:

Problem
One or two short sentences on what is wrong. Name the metal and the short or over.

Solution
One or two short sentences on what to do now.

Reasons
Two or three short sentences. Each reason on its own line. No numbers or dashes.

Keep every sentence short.`,
    },
    {
      role: 'user',
      content: `Audit this store bullion vault imbalance.\n\n${JSON.stringify(payload)}`,
    },
  ];
}

/**
 * Run AI bullion discrepancy analysis; streams text via onDelta.
 */
export async function analyzeBullionDiscrepancy({
  session,
  date,
  storeName,
  locationId,
  systemKey,
  unbalancedItems,
  model,
  onProgress,
  onDelta,
  signal,
}) {
  const context = await gatherBullionAuditContext(session, {
    date,
    storeName,
    locationId,
    systemKey,
    unbalancedItems,
    onProgress,
  });

  onProgress?.('Asking AI…');
  const seedMessages = buildBullionAuditMessages(context);
  const text = await streamChatCompletion({
    model,
    messages: seedMessages,
    onDelta,
    signal,
    maxTokens: 16384,
  });

  const messages = [...seedMessages, { role: 'assistant', content: text || '' }];
  return { context, text, messages };
}

/**
 * Continue a bullion audit conversation with a follow-up question.
 */
export async function continueBullionAuditChat({
  messages,
  userMessage,
  model,
  onDelta,
  signal,
}) {
  const question = String(userMessage || '').trim();
  if (!question) throw new Error('Enter a follow-up question.');
  if (!Array.isArray(messages) || !messages.length) {
    throw new Error('Run Find out why before chatting.');
  }

  const nextMessages = [
    ...messages,
    {
      role: 'system',
      content:
        'Stay in the Problem / Solution / Reasons plain layout. No markdown. Cite sales and purchases as SO# 12345 or PO# 12345.',
    },
    { role: 'user', content: question },
  ];
  const text = await streamChatCompletion({
    model,
    messages: nextMessages,
    onDelta,
    signal,
    maxTokens: 8192,
  });

  return {
    text,
    messages: [...nextMessages, { role: 'assistant', content: text || '' }],
  };
}
