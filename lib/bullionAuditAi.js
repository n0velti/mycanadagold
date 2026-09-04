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
import { compressImageDataUrl } from './openrouter';
import {
  fetchTransactionDetail,
  fetchTransactions,
  formatAmount,
  formatDateParam,
  parseDateParam,
  toLookupTransaction,
} from './transactions';
import { gatherAuditTransfers } from './transfers';

const DETAIL_CONCURRENCY = 6;
const MAX_PHOTOS = 8;
const PHOTO_MAX_WIDTH = 1024;
const MODEL_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

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

/** Customer / staff photos attached to a purchase line (not catalog product images). */
function lineItemPhotoUrls(item) {
  const urls = [];
  const seen = new Set();
  const push = (image) => {
    const url = String(
      (typeof image === 'string' ? image : image?.url || image?.original || image?.thumbnail || image?.path) ||
        '',
    ).trim();
    if (!url || seen.has(url)) return;
    seen.add(url);
    urls.push(url);
  };
  for (const key of ['images', 'photos', 'attachments']) {
    for (const image of Array.isArray(item?.[key]) ? item[key] : []) push(image);
  }
  for (const key of ['image_url', 'image', 'photo_url', 'photo']) {
    if (item?.[key] && typeof item[key] !== 'object') push(item[key]);
  }
  return urls;
}

function transactionPhotoUrls(detail) {
  const urls = [];
  const seen = new Set();
  const push = (value) => {
    const url = String(typeof value === 'string' ? value : value?.url || value?.thumbnail || '').trim();
    if (!url || seen.has(url)) return;
    seen.add(url);
    urls.push(url);
  };
  for (const key of ['transaction_image_url', 'image_url', 'photo_url']) {
    if (detail?.[key]) push(detail[key]);
  }
  for (const key of ['images', 'photos', 'attachments']) {
    for (const image of Array.isArray(detail?.[key]) ? detail[key] : []) push(image);
  }
  return urls;
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Could not read image.'));
    reader.readAsDataURL(blob);
  });
}

function dataUrlMediaType(dataUrl) {
  const match = String(dataUrl || '').match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,/);
  return match ? match[1].toLowerCase() : '';
}

/**
 * Fetch a POS photo and shrink it for the model. Falls back to the https URL
 * (providers fetch it themselves) when the browser cannot read the bytes.
 */
async function loadPhotoForModel(url) {
  try {
    const response = await fetch(url, { mode: 'cors' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    const raw = await blobToDataUrl(blob);
    if (!raw.startsWith('data:image/')) throw new Error('Not an image.');
    const compressed = await compressImageDataUrl(raw, { maxWidth: PHOTO_MAX_WIDTH, quality: 0.72 });
    const mediaType = dataUrlMediaType(compressed);
    if (MODEL_IMAGE_TYPES.has(mediaType)) return { src: compressed, inline: true };
    if (MODEL_IMAGE_TYPES.has(dataUrlMediaType(raw))) return { src: raw, inline: true };
    throw new Error(`Unsupported image type ${mediaType || blob.type}`);
  } catch (error) {
    if (/^https:\/\//i.test(url)) return { src: url, inline: false };
    return { src: null, inline: false, error: error?.message || 'Could not load photo.' };
  }
}

/**
 * Pick the photos worth showing the model: purchases first (customer metal
 * coming in), then sales, capped so the prompt stays fast.
 */
async function collectPhotoEvidence(relatedTransactions, onProgress) {
  const candidates = [];
  for (const tx of relatedTransactions) {
    for (const photo of tx.photos || []) {
      candidates.push({ ...photo, reference: tx.reference, type: tx.type });
    }
  }
  candidates.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'purchase' ? -1 : 1;
    return 0;
  });
  const picked = candidates.slice(0, MAX_PHOTOS);
  if (!picked.length) return { photos: [], skipped: candidates.length };

  onProgress?.(`Loading ${picked.length} line-item photo${picked.length === 1 ? '' : 's'}…`);
  const loaded = await mapPool(picked, 4, async (photo) => {
    const result = await loadPhotoForModel(photo.url);
    return { ...photo, ...result };
  });

  const photos = loaded
    .filter((photo) => photo.src)
    .map((photo, index) => ({ ...photo, index: index + 1 }));
  return { photos, skipped: candidates.length - photos.length };
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
    const lines = rawItems.map((item) => ({ ...lineItemFields(item), raw: item }));
    const matched = lines.filter((line) => itemMatchesTargets(line, targets));
    if (!matched.length) return null;

    const photos = [];
    for (const line of matched) {
      const matchedTargets = targets.filter((target) => itemMatchesTargets(line, [target]));
      for (const url of lineItemPhotoUrls(line.raw)) {
        photos.push({
          url,
          itemName: line.name || line.sku || 'line item',
          sku: line.sku,
          quantity: line.quantity,
          productIds: matchedTargets.map((target) => String(target.id)),
        });
      }
    }
    for (const url of transactionPhotoUrls(detail)) {
      photos.push({
        url,
        itemName: 'whole transaction',
        quantity: null,
        productIds: [],
      });
    }
    const matchedLines = matched.map(({ raw, ...line }) => ({
      ...line,
      photoCount: lineItemPhotoUrls(raw).length,
      matchedProductIds: targets
        .filter((target) => itemMatchesTargets(line, [target]))
        .map((target) => String(target.id)),
    }));

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
      photos,
      photoCount: photos.length,
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
      (draft.night != null && String(draft.night).trim() !== '') ||
      (draft.store != null && String(draft.store).trim() !== '') ||
      (draft.other != null && String(draft.other).trim() !== '') ||
      row.amount != null ||
      row.nightCount != null;

    if (!hasEntry) continue;

    const vault = toNumber(draft.vault) ?? toNumber(row.vaultCount) ?? 0;
    const night = toNumber(draft.night) ?? toNumber(row.nightCount) ?? 0;
    const store = toNumber(draft.store) ?? toNumber(row.storeCount) ?? 0;
    const other = toNumber(draft.other) ?? toNumber(row.otherCount) ?? 0;
    const countedTotal = vault + night;
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
      nightCount: night,
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
  const [yesterdayInventory, yesterdayLogs, cashPosition, dayTx, auditTrails, transfers] = await Promise.all([
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
    gatherAuditTransfers(session, {
      date: day,
      locationId,
      storeName,
      systemKey: system.key,
      targets,
      lookbackDays: 7,
      onProgress,
    }).catch((error) => ({
      transferCount: 0,
      pendingCount: 0,
      relevantCount: 0,
      byProduct: [],
      transfers: [],
      warning: error?.message || 'Failed to load transfers.',
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
    const yNight = toNumber(item.nightCount) ?? 0;
    const yCounted =
      yLog != null
        ? (toNumber(yLog.vault_count) ?? 0) + yNight
        : item.yesterdayCount != null
          ? item.yesterdayCount
          : null;
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

  const photoEvidence = await collectPhotoEvidence(relatedTransactions, onProgress);
  const transferByProduct = new Map(
    (transfers?.byProduct || []).map((entry) => [String(entry.productId), entry]),
  );
  const trailByProduct = new Map(
    (auditTrails?.reconciliation?.products || []).map((entry) => [String(entry.productId), entry]),
  );

  // One dossier per unbalanced product so each gets its own investigation.
  const investigations = enrichedUnbalanced.map((item) => {
    const id = String(item.id);
    const txs = relatedTransactions
      .filter((tx) => (tx.matchedItems || []).some((line) => (line.matchedProductIds || []).includes(id)))
      .map((tx) => ({
        reference: tx.reference,
        type: tx.type,
        customerName: tx.customerName,
        employeeName: tx.employeeName,
        timeLabel: tx.timeLabel,
        amountLabel: tx.amountLabel,
        paymentStatus: tx.paymentStatus,
        itemStatus: tx.itemStatus,
        lines: (tx.matchedItems || [])
          .filter((line) => (line.matchedProductIds || []).includes(id))
          .map((line) => ({
            name: line.name,
            sku: line.sku,
            quantity: line.quantity,
            deliveredQuantity: line.deliveredQuantity,
            deliveryStatus: line.deliveryStatus,
            photoCount: line.photoCount,
          })),
        flags: tx.flags,
        error: tx.error,
      }));
    const soldQty = txs
      .filter((tx) => tx.type === 'order')
      .reduce((sum, tx) => sum + tx.lines.reduce((inner, line) => inner + (line.quantity || 0), 0), 0);
    const boughtQty = txs
      .filter((tx) => tx.type === 'purchase')
      .reduce((sum, tx) => sum + tx.lines.reduce((inner, line) => inner + (line.quantity || 0), 0), 0);
    const transfer = transferByProduct.get(id);
    const trail = trailByProduct.get(id);
    const photos = photoEvidence.photos
      .filter((photo) => (photo.productIds || []).includes(id))
      .map((photo) => `Photo ${photo.index}`);

    return {
      productId: id,
      name: item.name,
      sku: item.sku,
      metal: item.metal,
      diff: item.diff,
      diffLabel: item.diffLabel,
      systemCount: item.systemCount,
      countedTotal: item.countedTotal,
      vaultCount: item.vaultCount,
      nightCount: item.nightCount,
      storeCount: item.storeCount,
      otherCount: item.otherCount,
      yesterdayBalanced: item.yesterdayBalanced,
      yesterdayDiff: item.yesterdayDiff,
      lastDeliveryDate: item.lastDeliveryDate,
      sameDay: {
        soldQty,
        boughtQty,
        transactions: txs,
      },
      transfers: transfer
        ? {
            sentOut: transfer.sentOut,
            receivedIn: transfer.receivedIn,
            pendingIn: transfer.pendingIn,
            pendingOut: transfer.pendingOut,
            receivedShort: transfer.receivedShort,
            list: transfer.transfers,
          }
        : { sentOut: 0, receivedIn: 0, pendingIn: 0, pendingOut: 0, receivedShort: 0, list: [] },
      posTrail: trail
        ? {
            countRevisions: (trail.countRevisions || []).slice(0, 8),
            relatedOrders: (trail.relatedOrders || []).slice(0, 8),
            relatedPurchases: (trail.relatedPurchases || []).slice(0, 8),
          }
        : null,
      photos,
    };
  });

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
    investigations,
    relatedTransactions,
    lookupTransactions: dayTx.rows.map(toLookupTransaction).filter(Boolean),
    undeliveredItemCount: undeliveredAcross.length,
    cash,
    auditTrails,
    transfers,
    photos: photoEvidence.photos,
    photosSkipped: photoEvidence.skipped,
    transactionCount: dayTx.rows.length,
    relatedTransactionCount: relatedTransactions.length,
    warning: [dayTx.warning, cash.warning, auditTrails?.warning, transfers?.warning]
      .filter(Boolean)
      .join(' '),
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
      diffMeaning: 'diff = countedTotal (vault+night) − systemCount. Negative = short vs system.',
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
Investigate why physical vault/night counts do not match Aureus system inventory for specific bullion products at one store/day.

Investigate thoroughly using the JSON context:
1. For each unbalanced metal/product, review related sales (SO) and purchases (PO) that day involving that product or metal.
2. Check whether it already failed to balance yesterday (yesterdayBalanced / yesterdayDiff). If yesterday was off, say the issue likely predates today.
3. Compare same-day cash activity (cashSameDay) with metal movement — e.g. cash paid for a purchase but metal not in vault, or sale recorded without metal leaving stock.
4. Check delivery vs entry: items entered/allocated in a transaction but not delivered (undeliveredItems, delivered_quantity ≠ quantity, item_status incomplete). Metal may be on the invoice but never physically received or handed over.
5. Look for wrong product/SKU, wrong qty, void/unpaid txs still affecting stock, transfers, or count entry mistakes (vault vs night vs store vs other).
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
