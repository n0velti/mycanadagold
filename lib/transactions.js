import { API_BASE_URL, authHeaders, ensureLinkedPosSessions, posFetch, posSystemsFromSession, resolvePosAuth } from './auth';
import { fetchTransferStores } from './locations';
import { HOME_PINNED_STORES, canonicalStoreName, storesMatch } from './storeCatalog';
import { silverCategoryFromText } from './websitePrices';

export { queryLooksLikeItem, rowMatchesQuery, textMatchesQuery } from './itemSearch';

/** GTA / PMX stores shown on the Home summary table. */
export const HOME_STORES = ['Hamilton', 'Mississauga', 'Toronto', 'Richmond Hill'];

const HOME_EXCLUDED_STORE_NAMES = ['rcm pooled', 'workshop'];

function isDevSupabaseProject() {
  return String(process.env.EXPO_PUBLIC_SUPABASE_URL || '').includes('mrvyckltclmcwshnnqfu');
}

export function isHomeExcludedStore(name) {
  const key = String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  if (!key) return false;
  return HOME_EXCLUDED_STORE_NAMES.some((item) => key === item || key.includes(item));
}

export function normalizeHomeStoreName(name, pinnedStores = HOME_STORES) {
  const trimmed = String(name || '').trim();
  if (!trimmed || trimmed === '—') return null;
  const pins = Array.isArray(pinnedStores) && pinnedStores.length ? pinnedStores : HOME_STORES;
  const match = pins.find((store) => storesMatch(store, trimmed));
  return match || null;
}

function uniqueStoreNames(names) {
  const seen = new Set();
  const next = [];
  for (const name of names || []) {
    const canonical = canonicalStoreName(name) || String(name || '').trim();
    if (!canonical) continue;
    const key = canonical.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(canonical);
  }
  return next;
}

function sortHomeStoreNames(names) {
  return uniqueStoreNames(names).sort((a, b) => {
    const ai = HOME_PINNED_STORES.findIndex(
      (store) => store.localeCompare(a, undefined, { sensitivity: 'base' }) === 0,
    );
    const bi = HOME_PINNED_STORES.findIndex(
      (store) => store.localeCompare(b, undefined, { sensitivity: 'base' }) === 0,
    );
    if (ai >= 0 && bi >= 0) return ai - bi;
    if (ai >= 0) return -1;
    if (bi >= 0) return 1;
    return a.localeCompare(b, undefined, { sensitivity: 'base' });
  });
}

function getErrorMessage(payload, fallback) {
  return payload?.error?.message || payload?.message || fallback;
}

export function parseDateParam(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return new Date();
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

export function formatDateParam(date) {
  const value = parseDateParam(date);
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, '0');
  const d = String(value.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

const MONTH_NAME_TO_NUM = {
  jan: '01',
  january: '01',
  feb: '02',
  february: '02',
  mar: '03',
  march: '03',
  apr: '04',
  april: '04',
  may: '05',
  jun: '06',
  june: '06',
  jul: '07',
  july: '07',
  aug: '08',
  august: '08',
  sep: '09',
  sept: '09',
  september: '09',
  oct: '10',
  october: '10',
  nov: '11',
  november: '11',
  dec: '12',
  december: '12',
};

/** YYYY-MM-DD from a POS date, dateLabel ("Sep 16, 2026"), or slashed report date. */
export function posRecordDateKey(record) {
  if (record == null) return '';
  if (typeof record === 'string' || record instanceof Date) return dateValueToKey(record);
  const candidates = [
    record.date,
    record.created_at,
    record.createdAt,
    record.datetime,
    record.transaction_date,
    record.dateLabel,
  ];
  for (const value of candidates) {
    const key = dateValueToKey(value);
    if (key) return key;
  }
  return '';
}

function dateValueToKey(value) {
  if (!value) return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) return formatDateParam(value);
  const text = String(value).trim();
  if (!text || text === '—') return '';
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const slashed = text.match(/^(\d{4})\/(\d{2})\/(\d{2})/);
  if (slashed) return `${slashed[1]}-${slashed[2]}-${slashed[3]}`;
  const pretty = text.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})/);
  if (pretty) {
    const month = MONTH_NAME_TO_NUM[pretty[1].toLowerCase()];
    if (month) return `${pretty[3]}-${month}-${String(pretty[2]).padStart(2, '0')}`;
  }
  const time = Date.parse(text.includes('T') ? text : text.replace(' ', 'T'));
  if (!Number.isFinite(time)) return '';
  return formatDateParam(new Date(time));
}

function shiftDateKey(day, delta) {
  const date = parseDateParam(day);
  date.setDate(date.getDate() + delta);
  return formatDateParam(date);
}

export function formatPickerDate(date) {
  return parseDateParam(date).toLocaleDateString('en-CA', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function defaultDateRange(days = 7) {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - (days - 1));
  return {
    startDate: formatDateParam(start),
    endDate: formatDateParam(end),
    start: parseDateParam(start),
    end: parseDateParam(end),
  };
}

export const FINTRAC_CASH_THRESHOLD = 10000;

/** Non-retail / internal locations excluded from the FINTRAC list. */
export const FINTRAC_EXCLUDED_STORE_NAMES = [
  'rcm pooled',
  'richmond hill',
  'storage',
  'workshop',
];

export function isFintracExcludedStore(storeName) {
  const key = String(storeName || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  if (!key) return false;
  return FINTRAC_EXCLUDED_STORE_NAMES.some(
    (name) => key === name || key.includes(name),
  );
}

function clientName(client) {
  if (!client) return '—';
  const name = [client.first_name, client.last_name].filter(Boolean).join(' ').trim();
  const company = String(client.business_name || client.company_name || '').trim();
  return name || company || client.nickname || client.email || '—';
}

function clientEmail(client) {
  const email = String(client?.email || '').trim();
  return email || '';
}

function clientId(client) {
  if (client?.id == null || client?.id === '') return null;
  return String(client.id);
}

export function isWalkInCustomer(name) {
  return /(?:walk[\s-]*in|in[\s-]*walk)/i.test(String(name || '').trim());
}

export function isInventoryAdjustmentCustomer(name) {
  return /inventory[\s-]*adjust/i.test(String(name || '').trim());
}

/** Internal POS names that should not appear as real customers. */
export function isExcludedCustomerName(name) {
  return isWalkInCustomer(name) || isInventoryAdjustmentCustomer(name);
}

export function isInventoryAdjustmentTicket(row) {
  if (isInventoryAdjustmentCustomer(row?.customerName || row?.label)) return true;
  const hay = [
    row?.paymentMethods,
    row?.paymentMethodLabel,
    row?.itemSearchText,
    ...(Array.isArray(row?.itemNames) ? row.itemNames : []),
  ]
    .filter(Boolean)
    .join(' ');
  return /inventory[\s-]*adjust/i.test(hay);
}

export function isValidCustomerEmail(email) {
  const value = String(email || '').trim();
  if (!value) return false;
  if (/@aureus/i.test(value)) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function buildEmailCaptureByStore(rows) {
  const byStore = new Map();

  const ensureStore = (store) => {
    let entry = byStore.get(store);
    if (!entry) {
      entry = {
        store,
        customerTxCount: 0,
        walkInTxCount: 0,
        withEmail: 0,
        transactions: [],
      };
      byStore.set(store, entry);
    }
    return entry;
  };

  for (const row of rows) {
    const store = row.storeName || '—';
    const entry = ensureStore(store);
    const isWalkIn = isWalkInCustomer(row.customerName);

    if (isWalkIn) {
      entry.walkInTxCount += 1;
      continue;
    }

    const hasEmail = isValidCustomerEmail(row.customerEmail);
    entry.customerTxCount += 1;
    if (hasEmail) entry.withEmail += 1;

    entry.transactions.push({
      id: row.id,
      customerName: row.customerName || '—',
      email: String(row.customerEmail || '').trim(),
      hasEmail,
      emailLabel: hasEmail
        ? String(row.customerEmail).trim()
        : row.customerEmail
          ? `${String(row.customerEmail).trim()} (invalid)`
          : '—',
      employeeName: row.employeeName || '—',
      dateLabel: row.dateLabel,
      timeLabel: row.timeLabel,
      reference: row.reference,
    });
  }

  return Array.from(byStore.values())
    .map((entry) => {
      const customerCount = entry.customerTxCount;
      const walkInCount = entry.walkInTxCount;
      const totalTransactions = customerCount + walkInCount;
      const withEmail = entry.withEmail;
      const rate = customerCount > 0 ? (withEmail / customerCount) * 100 : 0;
      const people = entry.transactions
        .slice()
        .sort((a, b) =>
          a.customerName.localeCompare(b.customerName, undefined, { sensitivity: 'base' }),
        );

      return {
        store: entry.store,
        customerCount,
        walkInCount,
        totalTransactions,
        withEmail,
        rate,
        rateLabel: `${rate.toFixed(1)}%`,
        peopleFractionLabel:
          totalTransactions > 0 ? `${customerCount}/${totalTransactions}` : '0/0',
        people,
        transactions: people,
      };
    })
    .filter((entry) => entry.totalTransactions > 0)
    .sort((a, b) => a.store.localeCompare(b.store, undefined, { sensitivity: 'base' }));
}

function personNameFromValue(value) {
  if (!value) return '';
  if (typeof value === 'string') {
    const text = value.trim();
    return !text || text === '—' || text === '[object Object]' || /^site$/i.test(text) ? '' : text;
  }
  if (typeof value !== 'object') return '';
  return (
    [
      value.name,
      value.full_name,
      value.fullName,
      value.display_name,
      value.displayName,
      [value.first_name, value.last_name].filter(Boolean).join(' '),
      [value.firstName, value.lastName].filter(Boolean).join(' '),
      value.employeeName,
      value.login,
      value.username,
      value.user_name,
      value.email,
    ]
      .map((part) => String(part || '').trim())
      .find((part) => part && part !== '—' && part !== '[object Object]' && !/^site$/i.test(part)) || ''
  );
}

function isPosWebsiteCreator(value) {
  const text = typeof value === 'string' ? value.trim() : personNameFromValue(value);
  return /^site$/i.test(text);
}

function posLatestEditorName(record) {
  if (!record || typeof record !== 'object') return '';
  return (
    personNameFromValue(record.latest_editor_name) ||
    personNameFromValue(record.latestEditorName) ||
    personNameFromValue(record.latest_editor) ||
    ''
  );
}

/** Staff on the ticket. `created_by`, or `latest_editor_name` when that is blank or "site". */
export function posCreatedByName(record) {
  if (!record || typeof record !== 'object') return '';
  const raw = record.created_by ?? record.createdBy;
  // PMX website orders leave created_by null; website POs set it to "site".
  const named = isPosWebsiteCreator(raw) ? '' : personNameFromValue(raw);
  return named || posLatestEditorName(record);
}

/** Buyer on a purchase: POS `created_by`, or PMX `latest_editor_name` when created_by is "site". */
export function purchaseBuyerName(record) {
  return (
    posCreatedByName(record) ||
    personNameFromValue(record?.employeeName) ||
    ''
  );
}

/** Staff who created the PO/SO on POS — the buyer on a purchase. */
export function posEmployeeName(record) {
  if (!record || typeof record !== 'object') return '';
  return (
    posCreatedByName(record) ||
    personNameFromValue(record.created_by_user) ||
    personNameFromValue(record.user) ||
    personNameFromValue(record.user_data) ||
    personNameFromValue(record.creator) ||
    personNameFromValue(record.employee) ||
    personNameFromValue(record.salesperson) ||
    personNameFromValue(record.employeeName) ||
    ''
  );
}

export function posDocumentId(row) {
  const source = String(row?.sourceId ?? '').trim();
  if (/^\d+$/.test(source)) return source;
  const raw = String(row?.id || source || '').trim();
  const tagged = raw.match(/(?:^|-)(?:po|so)[-#\s]*(\d+)$/i);
  if (tagged) return tagged[1];
  const digits = raw.match(/^(\d+)$/);
  return digits ? digits[1] : source;
}

function employeeName(record) {
  return posEmployeeName(record) || '—';
}

export function isCashMethod(name) {
  const n = String(name || '').trim().toLowerCase();
  if (!n) return false;
  if (/\b(cheque|check|chk|chq|debit|draft|interac|eft|visa|mastercard|amex|credit)\b/.test(n)) {
    return false;
  }
  return n === 'cash' || n === 'espèces' || n === 'especes' || n.startsWith('cash ');
}

function isAureusCashPayment(payment, methodName) {
  if (payment?.payment_type?.is_cash === true) return true;
  return isCashMethod(methodName);
}

export function hasCashPaymentMethod(paymentMethods) {
  return String(paymentMethods || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .some(isCashMethod);
}

export function isCashOnlyPaymentMethod(paymentMethods) {
  const methods = String(paymentMethods || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  return methods.length > 0 && methods.every(isCashMethod);
}

export function extractPaymentBreakdown(detail) {
  const payments = Array.isArray(detail?.payments) ? detail.payments : [];
  const totals = {};

  for (const entry of payments) {
    const payment = entry?.payment || entry || {};
    const type = payment.payment_type || entry?.payment_type || {};
    const method = type.name || payment.payment_type?.name || 'Other';
    const amount = Number(entry?.amount ?? payment.amount) || 0;
    const cash = isAureusCashPayment(payment, method);
    if (!totals[method]) totals[method] = { method, amount: 0, cash };
    totals[method].amount += amount;
    totals[method].cash = totals[method].cash || cash;
  }

  return Object.values(totals).map((entry) => ({
    method: entry.method,
    amount: Math.round(entry.amount * 100) / 100,
    cash: entry.cash,
    label: `${formatAmount(entry.amount)} ${entry.method}`,
  }));
}

export const PAYMENT_METHOD_UNRECORDED = 'Not recorded';

/**
 * One label per ticket for grouping by how it was paid. The POS list field
 * repeats a method per payment line ("Cash, Cash") and names each method on a
 * split ticket ("Cash, Debit"); here that is "Cash" and "Cash + Debit". A row
 * enriched with its payment breakdown uses those methods instead.
 */
export function paymentMethodGroup(rowOrMethods) {
  const breakdown = Array.isArray(rowOrMethods?.paymentBreakdown) ? rowOrMethods.paymentBreakdown : [];
  const raw =
    typeof rowOrMethods === 'string'
      ? rowOrMethods
      : breakdown.length
        ? breakdown.map((entry) => entry?.method).filter(Boolean).join(',')
        : rowOrMethods?.paymentMethods;
  const seen = new Map();
  for (const part of String(raw || '').split(',')) {
    const method = part.trim().replace(/\s+/g, ' ');
    if (!method || method === '—') continue;
    const key = method.toLowerCase();
    if (!seen.has(key)) seen.set(key, method);
  }
  if (!seen.size) return PAYMENT_METHOD_UNRECORDED;
  return [...seen.values()]
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
    .join(' + ');
}

export function formatPaymentMethodLabel(paymentMethods) {
  const methods = String(paymentMethods || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  return methods.length ? methods.join(' · ') : '—';
}

export function formatPaymentBreakdown(breakdown, fallbackMethods) {
  if (Array.isArray(breakdown) && breakdown.length > 0) {
    return breakdown.map((entry) => entry.label).join(' · ');
  }
  const methods = String(fallbackMethods || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  return methods.length ? methods.join(' · ') : '';
}

export function cashAmountFromBreakdown(breakdown) {
  return Math.round(
    (breakdown || [])
      .filter((entry) => entry.cash || isCashMethod(entry.method))
      .reduce((sum, entry) => sum + (Number(entry.amount) || 0), 0) * 100,
  ) / 100;
}

export function isFintracCash(row) {
  if (!row) return false;
  if (typeof row.cashAmount === 'number') {
    return row.cashAmount >= FINTRAC_CASH_THRESHOLD;
  }
  return Boolean(row.fintracCash);
}

export function isCashTransaction(row) {
  if (!row) return false;
  if (row.kind === 'cash_transaction') return true;
  if (typeof row.cashAmount === 'number' && row.cashAmount > 0) return true;
  if (hasCashPaymentMethod(row.paymentMethods)) return true;
  if (isCashMethod(row.paymentType) || isCashMethod(row.paymentMethodLabel)) return true;
  if (Array.isArray(row.paymentBreakdown) && cashAmountFromBreakdown(row.paymentBreakdown) > 0) {
    return true;
  }
  return false;
}

export function txnCashAmount(row) {
  if (Array.isArray(row?.paymentBreakdown) && row.paymentBreakdown.length) {
    return cashAmountFromBreakdown(row.paymentBreakdown);
  }
  if (typeof row?.cashAmount === 'number') return row.cashAmount;
  if (row?.kind === 'cash_transaction') return Number(row.amount) || 0;
  if (isCashOnlyPaymentMethod(row?.paymentMethods)) return Number(row.amount) || 0;
  if (isCashMethod(row?.paymentType) && !String(row?.paymentMethods || '').trim()) {
    return Number(row.amount) || 0;
  }
  return null;
}

export function needsTxnCashEnrichment(row) {
  if (!row) return false;
  if (row.kind === 'cash_transaction') return false;
  if (row.type !== 'order' && row.type !== 'purchase') return false;
  if (Array.isArray(row.paymentBreakdown) && row.paymentBreakdown.length) return false;
  if (isCashOnlyPaymentMethod(row.paymentMethods) && typeof row.cashAmount === 'number') return false;
  return (
    isCashTransaction(row) ||
    hasCashPaymentMethod(row.paymentMethods) ||
    !isCashOnlyPaymentMethod(row.paymentMethods)
  );
}

function currencyCodeFrom(value) {
  const raw =
    value && typeof value === 'object'
      ? value.code || value.iso || value.name || value.currency || ''
      : value;
  const code = String(raw || '')
    .trim()
    .toUpperCase();
  if (code === 'USD' || code === 'US' || code === 'US$' || /\bUS\s*DOLLAR/.test(code)) return 'USD';
  if (code === 'CAD' || code === 'CA' || code === 'C$' || /\bCANADIAN/.test(code)) return 'CAD';
  return '';
}

export function txnCashCurrency(row) {
  const till = currencyCodeFrom(row?.tillCurrency);
  if (till) return till;
  if (/\busd\b/i.test(String(row?.tillName || ''))) return 'USD';

  // SO/PO document currency is often USD (bullion). Cash in the till is CAD
  // unless the payment itself is on a USD till.
  if (row?.type === 'order' || row?.type === 'purchase') return 'CAD';
  if (row?.kind === 'cash_transaction') return currencyCodeFrom(row?.currency) || 'CAD';

  return currencyCodeFrom(row?.currency) || 'CAD';
}

function asItemArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function pushImageUrl(urls, seen, image) {
  const url = String(
    typeof image === 'string'
      ? image
      : image?.url || image?.original || image?.thumbnail || image?.path || '',
  ).trim();
  if (!url || seen.has(url)) return;
  seen.add(url);
  urls.push(url);
}

function pushItemImageUrls(urls, seen, item) {
  if (!item) return;
  for (const key of ['images', 'photos', 'attachments']) {
    for (const image of asItemArray(item?.[key])) pushImageUrl(urls, seen, image);
  }
  for (const key of ['image_url', 'image', 'photo_url', 'photo', 'transaction_image_url']) {
    if (item?.[key] && typeof item[key] !== 'object') pushImageUrl(urls, seen, item[key]);
  }
  const product = item?.product || item?.inventory_product || item?.product_details || {};
  for (const image of asItemArray(product.images)) pushImageUrl(urls, seen, image);
  for (const key of ['image_url', 'image', 'photo_url', 'photo']) {
    if (product?.[key] && typeof product[key] !== 'object') pushImageUrl(urls, seen, product[key]);
  }
}

export function collectItemImageUrls(item) {
  const urls = [];
  const seen = new Set();
  pushItemImageUrls(urls, seen, item);
  return urls;
}

export function collectRecordImageUrls(record) {
  const urls = [];
  const seen = new Set();
  if (!record) return urls;

  for (const key of ['transaction_image_url', 'image_url', 'photo_url']) {
    if (record[key]) pushImageUrl(urls, seen, record[key]);
  }
  for (const key of ['items_images', 'images', 'photos', 'attachments']) {
    for (const image of asItemArray(record[key])) pushImageUrl(urls, seen, image);
  }
  for (const item of recordItems(record)) pushItemImageUrls(urls, seen, item);
  return urls;
}

function recordItems(record) {
  for (const value of [
    record?.items,
    record?.order_items,
    record?.purchase_items,
    record?.line_items,
  ]) {
    const items = asItemArray(value);
    if (items.length) return items;
  }
  return [];
}

function lineNumber(...values) {
  for (const value of values) {
    if (value == null || value === '') continue;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const n = Number(String(value).replace(/[^0-9.-]/g, ''));
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function isGramWeightItem(item) {
  const product = item?.product || item?.inventory_product || item?.product_details || {};
  const type = String(product?.type || item?.type || '').toLowerCase();
  if (type === 'scrap' || type === 'jewellery' || type === 'jewelry') return true;
  const unit = String(item?.unit_type || item?.unit || item?.weight_unit || '')
    .trim()
    .toLowerCase()
    .replace(/\./g, '');
  return unit === 'g' || unit === 'gram' || unit === 'grams' || unit === 'gm';
}

/**
 * POS scrap lines store spot in `price` and the paid share in `payout` (%).
 * Line total is quantity × price × payout/100. Bullion is quantity × price.
 * Sales often send gross_quantity = 1.00000 — that is not a scale weight.
 */
export function lineItemMoney(item) {
  const quantity = lineNumber(item?.quantity, item?.qty);
  const listedGross = lineNumber(item?.gross_quantity, item?.weight, item?.gross_weight);
  const qty = quantity ?? (isGramWeightItem(item) ? listedGross : null) ?? 1;
  const listedPrice = lineNumber(
    item?.price,
    item?.unit_price,
    item?.amount_per_unit,
    item?.default_unit_price,
  );
  const payoutPct = lineNumber(item?.payout);
  const explicitTotal = lineNumber(item?.total, item?.line_total, item?.extended_price);
  const grossQuantity =
    isGramWeightItem(item) && listedGross > 0 && !(listedGross === 1 && qty !== 1)
      ? listedGross
      : null;

  let unitPrice = listedPrice;
  let lineTotal = explicitTotal;

  if (payoutPct != null && payoutPct > 0 && listedPrice != null && qty > 0) {
    const factor = payoutPct > 1.5 ? payoutPct / 100 : payoutPct;
    unitPrice = listedPrice * factor;
    lineTotal = qty * unitPrice;
  } else if (lineTotal == null && listedPrice != null) {
    lineTotal = qty * listedPrice;
  } else if ((unitPrice == null || unitPrice <= 0) && lineTotal != null && qty > 0) {
    unitPrice = lineTotal / qty;
  }

  if (qty > 1 && unitPrice != null && lineTotal != null && Math.abs(unitPrice - lineTotal) < 0.005) {
    unitPrice = lineTotal / qty;
  }

  const grossUnitPrice =
    isGramWeightItem(item) && lineTotal != null && grossQuantity > 0
      ? lineTotal / grossQuantity
      : null;

  return {
    quantity: qty,
    grossQuantity,
    unitPrice,
    displayUnitPrice: grossUnitPrice ?? unitPrice,
    grossUnitPrice,
    lineTotal,
    payout: payoutPct,
    listedPrice,
  };
}

export function formatUnitCost(unitPrice, unitType) {
  if (unitPrice == null || !Number.isFinite(Number(unitPrice))) return '—';
  const money = formatAmount(unitPrice);
  const unit = String(unitType || '')
    .trim()
    .toLowerCase()
    .replace(/\./g, '');
  if (!unit || ['ea', 'each', 'pc', 'pcs', 'unit', 'units', 'item', 'items'].includes(unit)) {
    return money;
  }
  return `${money}/${unit}`;
}

export function lineItemsFromDetail(detail) {
  const items = recordItems(detail);
  const names = [];
  const searchParts = [];
  const pricedLines = [];
  const recordImages = collectRecordImageUrls(detail);

  for (const item of items) {
    const product = item?.product || item?.inventory_product || item?.product_details || {};
    const metal =
      typeof product?.metal === 'string' ? product.metal : product?.metal?.name || item?.metal;
    const productGroup = String(
      product?.group?.name ||
        product?.group_name ||
        (typeof product?.group === 'string' ? product.group : '') ||
        product?.category?.name ||
        (typeof product?.category === 'string' ? product.category : '') ||
        '',
    ).trim();
    const parts = [
      item?.description,
      product?.name,
      product?.description,
      item?.name,
      product?.sku,
      product?.code,
      item?.quality_mark_description,
      product?.type,
      productGroup,
      metal,
    ]
      .map((value) => String(value || '').trim())
      .filter(Boolean);
    if (parts[0]) names.push(parts[0]);
    searchParts.push(...parts);

    const money = lineItemMoney(item);
    if (parts[0]) {
      const matchText = [
        item?.description,
        product?.name,
        item?.quality_mark_description,
        product?.sku,
        product?.code,
        product?.type,
      ]
        .map((value) => String(value || '').trim())
        .filter(Boolean)
        .join(' ');
      const unitType = String(item?.unit_type || item?.unit || item?.weight_unit || '');
      const specificName = parts.find((part) => {
        if (/^\s*scrap\b/i.test(part)) return false;
        if (silverCategoryFromText(part)) return true;
        return /\d\s*k(?:t|arat)?|sterling|flatware|mexican|gold filled|\bpure\b/i.test(part);
      });
      const quality = [
        item?.quality_mark_description,
        product?.quality_mark_description,
        item?.karat,
        product?.karat,
        item?.quality,
        product?.quality,
      ]
        .map((value) => (value == null ? '' : String(value).trim()))
        .filter(Boolean)
        .join(' ');
      const itemImages = collectItemImageUrls(item);
      const productId =
        item?.product_id ?? product?.id ?? item?.inventory_product_id ?? item?.inventory_product?.id;
      pricedLines.push({
        name: specificName || parts[0],
        productId: productId == null || productId === '' ? null : String(productId),
        productName: String(product?.name || '').trim(),
        sku: String(product?.sku || product?.code || item?.sku || '').trim(),
        quantity: money.quantity,
        unitPrice: money.displayUnitPrice ?? money.unitPrice,
        lineTotal: money.lineTotal,
        searchText: parts.join(' '),
        productType: String(product?.type || item?.product_type || item?.type || ''),
        productGroup,
        metal: String(metal || ''),
        unitType,
        weight: money.grossQuantity,
        purity:
          item?.purity ??
          item?.purity_percent ??
          item?.fineness ??
          product?.purity ??
          product?.purity_percent ??
          product?.fineness,
        quality,
        premium: /\bpremium\b/i.test(matchText),
        payout: money.payout,
        imageUrls: itemImages,
      });
    }
  }

  if (pricedLines.length === 1 && recordImages.length && !pricedLines[0].imageUrls?.length) {
    pricedLines[0].imageUrls = recordImages;
  }

  const tagText = [detail?.product_tags, detail?.transaction_tags]
    .map((value) => (value == null ? '' : String(value).trim()))
    .filter(Boolean)
    .join(' ');
  if (tagText) {
    if (!names.length) names.push(tagText);
    searchParts.push(tagText);
  }

  return {
    itemNames: names,
    itemSearchText: searchParts.join(' ').toLowerCase(),
    pricedLines,
    imageUrls: recordImages,
  };
}

function applyLineItems(row, detail) {
  const fromDetail = detail
    ? lineItemsFromDetail(detail)
    : { itemNames: [], itemSearchText: '', pricedLines: [], imageUrls: [] };
  const itemNames = fromDetail.itemNames.length ? fromDetail.itemNames : row.itemNames || [];
  const itemSearchText = fromDetail.itemSearchText || row.itemSearchText || '';
  const pricedLines = fromDetail.pricedLines.length ? fromDetail.pricedLines : row.pricedLines || [];
  const imageUrls = fromDetail.imageUrls.length ? fromDetail.imageUrls : row.imageUrls || [];
  return {
    itemNames,
    itemSearchText,
    pricedLines,
    imageUrls,
    lineItemsLoaded: Boolean(detail) || Boolean(row.lineItemsLoaded),
  };
}

export function withLineItems(row, detail) {
  const items = applyLineItems(row, detail);
  return {
    ...row,
    ...items,
    searchText: [row.searchText, items.itemSearchText].filter(Boolean).join(' ').trim(),
  };
}

function scrapLineNeedsWeight(line) {
  const text = `${line?.name || ''} ${line?.searchText || ''} ${line?.productType || ''}`;
  if (!/\b(scrap|jewellery|jewelry|gold filled|sterling|\d+\s*k(?:t|arat)?)\b/i.test(text)) {
    return false;
  }
  return !line?.unitType && line?.weight == null;
}

export function needsLineItemEnrichment(row) {
  if (!row || row.lineItemsLoaded) return false;
  if (!(Array.isArray(row.imageUrls) ? row.imageUrls : []).filter(Boolean).length) return true;
  if (!String(row.itemSearchText || '').trim()) return true;
  const lines = Array.isArray(row.pricedLines) ? row.pricedLines : [];
  if (!lines.some((line) => Number(line?.unitPrice) > 0 || Number(line?.lineTotal) > 0)) return true;
  return lines.some(scrapLineNeedsWeight);
}

// City and postal code only. Street lines stay out of transaction rows.
function clientPlace(client, record = null) {
  const addresses = Array.isArray(client?.addresses) ? client.addresses : [];
  const candidates = [
    addresses.find((row) => row?.default_for_billing),
    addresses.find((row) => row?.default_for_shipping),
    addresses[0],
    client?.address && typeof client.address === 'object' ? client.address : null,
    record?.billing_address,
    record?.shipping_address,
    client,
  ];
  for (const place of candidates) {
    if (!place || typeof place !== 'object') continue;
    const city = String(place.city || '').trim();
    const postal = String(place.zip || place.postal_code || place.postal || place.postcode || '')
      .trim()
      .toUpperCase();
    if (city || postal) return { customerCity: city, customerPostal: postal };
  }
  return { customerCity: '', customerPostal: '' };
}

function storeNameFromRecord(record, system = null) {
  const raw = String(
    record?.location_name || record?.location?.name || record?.store_name || '',
  ).trim();
  if (raw && raw !== '—') return canonicalStoreName(raw) || raw;
  // PMX is the Richmond Hill tenant; report rows sometimes omit location_name.
  if (system?.key === 'pmx' || isPmxApi(system?.baseUrl)) return 'Richmond Hill';
  return '';
}

function labelText(value) {
  if (value && typeof value === 'object') return labelText(value.name ?? value.label ?? '');
  const text = String(value ?? '').trim();
  return text && text !== '—' ? text : '';
}

/** Unique entries of a POS label list: "2026 maple, 2026 maple" → ["2026 maple"]. */
export function splitLabelList(value) {
  const parts = Array.isArray(value) ? value : String(value ?? '').split(',');
  const seen = new Map();
  for (const part of parts) {
    const text = labelText(part).replace(/\s+/g, ' ');
    if (!text) continue;
    const key = text.toLowerCase();
    if (!seen.has(key)) seen.set(key, text);
  }
  return [...seen.values()];
}

function tillNames(tills) {
  return splitLabelList((Array.isArray(tills) ? tills : []).map((till) => till?.name ?? till));
}

function optionalNumber(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * The labels on a POS orders / purchases record, kept as-is so any of them can
 * be a grouping or a filter later (status, bookkeeping, source, delivery,
 * client type, tags, tills). Website POs mark created_by "site".
 */
function recordLabels(record) {
  return {
    itemStatus: labelText(record?.item_status),
    paidStatus: labelText(record?.allocation_status),
    source: labelText(record?.source),
    deliveryMode: labelText(record?.delivery_mode),
    clientType: labelText(record?.client?.client_type ?? record?.client_type),
    productTags: splitLabelList(record?.product_tags),
    transactionTags: splitLabelList(record?.transaction_tags),
    tills: tillNames(record?.tills),
    allocatedAmount: optionalNumber(record?.allocated_amount),
    exchangeRate: optionalNumber(record?.exchange_rate),
    websiteCreated: isPosWebsiteCreator(record?.created_by ?? record?.createdBy),
  };
}

function mapOrder(order, system = null) {
  const systemKey = system?.key || 'east';
  const baseId = `so-${order.id}`;
  const { itemNames, itemSearchText, pricedLines, imageUrls } = lineItemsFromDetail(order);
  return finalizeRow({
    id: systemKey === 'east' ? baseId : `${systemKey}-${baseId}`,
    sourceId: order.id,
    type: 'order',
    systemKey,
    systemLabel: system?.label || 'Canada Gold East',
    baseUrl: system?.baseUrl || API_BASE_URL,
    date: order.date,
    reference: `SO# ${order.id}`,
    customerName: clientName(order.client),
    customerEmail: clientEmail(order.client),
    customerId: clientId(order.client),
    ...clientPlace(order.client, order),
    created_by: posCreatedByName(order),
    employeeName: employeeName(order),
    latest_editor_name: posLatestEditorName(order),
    storeName: storeNameFromRecord(order, system) || '—',
    locationId: order.location_id ?? order.location?.id ?? null,
    amount: Number(order.total_amount) || 0,
    currency: order.currency || 'CAD',
    paymentMethods: order.payment_methods || '',
    ...recordLabels(order),
    itemNames,
    itemSearchText,
    pricedLines,
    imageUrls,
  });
}

export function rowFromDocument(detail, type, system = null) {
  const locationName = detail?.location_name || detail?.location?.name || '';
  const record = locationName ? { ...detail, location_name: locationName } : detail;
  return type === 'purchase' ? mapPurchase(record, system) : mapOrder(record, system);
}

function mapPurchase(purchase, system = null) {
  const systemKey = system?.key || 'east';
  const baseId = `po-${purchase.id}`;
  const { itemNames, itemSearchText, pricedLines, imageUrls } = lineItemsFromDetail(purchase);
  const buyer = purchaseBuyerName(purchase);
  return finalizeRow({
    id: systemKey === 'east' ? baseId : `${systemKey}-${baseId}`,
    sourceId: purchase.id,
    type: 'purchase',
    systemKey,
    systemLabel: system?.label || 'Canada Gold East',
    baseUrl: system?.baseUrl || API_BASE_URL,
    date: purchase.date,
    reference: `PO# ${purchase.id}`,
    customerName: clientName(purchase.client),
    customerEmail: clientEmail(purchase.client),
    customerId: clientId(purchase.client),
    ...clientPlace(purchase.client, purchase),
    created_by: buyer,
    employeeName: buyer || employeeName(purchase),
    latest_editor_name: posLatestEditorName(purchase),
    storeName: storeNameFromRecord(purchase, system) || '—',
    locationId: purchase.location_id ?? purchase.location?.id ?? null,
    amount: Number(purchase.total_amount) || 0,
    currency: purchase.currency || 'CAD',
    paymentMethods: purchase.payment_methods || '',
    ...recordLabels(purchase),
    itemNames,
    itemSearchText,
    pricedLines,
    imageUrls,
  });
}

function finalizeRow(row) {
  const dateLabel = formatTransactionDate(row.date);
  const timeLabel = formatTransactionTime(row.date);
  const amountLabel = formatAmount(row.amount);
  const paymentMethodLabel = formatPaymentMethodLabel(row.paymentMethods);
  const cashOnly = isCashOnlyPaymentMethod(row.paymentMethods);
  const fintracCash =
    cashOnly && Number(row.amount) >= FINTRAC_CASH_THRESHOLD;

  return {
    ...row,
    dateLabel,
    timeLabel,
    amountLabel,
    paymentMethodLabel,
    paymentBreakdown: null,
    paymentBreakdownLabel: formatPaymentBreakdown(null, row.paymentMethods),
    cashAmount: cashOnly ? Number(row.amount) || 0 : null,
    fintracCash,
    searchText: [
      row.reference,
      row.type === 'purchase' ? 'purchase po buy' : 'sale sales so order',
      row.customerName,
      row.employeeName,
      row.storeName,
      dateLabel,
      timeLabel,
      amountLabel,
      paymentMethodLabel,
      row.paymentMethods,
      String(row.amount),
      ...(row.itemNames || []),
      row.itemSearchText,
      fintracCash ? 'fintrac' : '',
    ]
      .join(' ')
      .toLowerCase(),
  };
}

export function withPaymentBreakdown(row, detail) {
  const breakdown = extractPaymentBreakdown(detail);
  const cashAmount = cashAmountFromBreakdown(breakdown);
  const fintracCash = cashAmount >= FINTRAC_CASH_THRESHOLD;
  const paymentBreakdownLabel =
    formatPaymentBreakdown(breakdown, row.paymentMethods) || row.paymentBreakdownLabel;
  const paymentMethodLabel =
    breakdown.length > 0
      ? breakdown.map((entry) => entry.method).join(' · ')
      : row.paymentMethodLabel || formatPaymentMethodLabel(row.paymentMethods);
  const items = applyLineItems(row, detail);

  const payments = Array.isArray(detail?.payments) ? detail.payments : [];
  const irsPaymentIds = [];
  let irsReported = Boolean(row.irsReported);
  for (const entry of payments) {
    const payment = entry?.payment || entry || {};
    const isCash =
      payment.payment_type?.is_cash === true ||
      String(payment.payment_type?.name || '')
        .trim()
        .toLowerCase() === 'cash';
    if (payment.irs_details?.report || isCash) {
      const listed = payment.irs_details?.payments;
      if (Array.isArray(listed) && listed.length) {
        for (const id of listed) {
          if (id != null && id !== '') irsPaymentIds.push(String(id));
        }
      } else if (payment.id != null && (payment.irs_details?.report || isCash)) {
        if (payment.irs_details?.report) irsPaymentIds.push(String(payment.id));
      }
    }
    if (payment.reported_to_irs_at) irsReported = true;
  }

  return {
    ...row,
    ...items,
    paymentMethodLabel,
    paymentBreakdown: breakdown,
    paymentBreakdownLabel,
    cashAmount,
    fintracCash,
    irsPaymentIds: Array.from(new Set(irsPaymentIds)),
    irsReported,
    searchText: [
      row.reference,
      row.type === 'purchase' ? 'purchase po buy' : 'sale sales so order',
      row.customerName,
      row.employeeName,
      row.storeName,
      row.dateLabel,
      row.timeLabel,
      row.amountLabel,
      paymentMethodLabel,
      paymentBreakdownLabel,
      String(row.amount),
      ...(items.itemNames || []),
      items.itemSearchText,
      fintracCash ? 'fintrac' : '',
      irsReported ? 'reported irs added' : '',
    ]
      .join(' ')
      .toLowerCase(),
  };
}

export function needsPaymentEnrichment(row) {
  if (!row || row.paymentBreakdown) return false;
  const amount = Number(row.amount) || 0;
  if (amount < FINTRAC_CASH_THRESHOLD) return false;

  // List payment_methods is often incomplete (blank, mixed, or missing Cash).
  // Any SO/PO ≥ $10k needs detail so we can compute true cash ≥ $10k.
  if (!isCashOnlyPaymentMethod(row.paymentMethods)) return true;
  if (!String(row.paymentMethods || '').trim()) return true;
  return false;
}

function paginationMeta(payload) {
  const meta = payload?.meta || payload?.pagination || {};
  const current =
    Number(meta.current_page ?? payload?.current_page ?? meta.page) || 1;
  const last =
    Number(
      meta.last_page ??
        payload?.last_page ??
        meta.total_pages ??
        payload?.total_pages,
    ) || null;
  const perPage =
    Number(meta.per_page ?? meta.items_per_page ?? payload?.per_page) || null;
  const total = Number(meta.total ?? payload?.total) || null;
  return { current, last, perPage, total };
}

/** Aureus rejects a single search when the result set is too large. */
const SEARCH_CHUNK_DAYS = 7;
const SEARCH_CHUNK_CONCURRENCY = 3;

function addCalendarDays(date, days) {
  const next = parseDateParam(date);
  next.setDate(next.getDate() + days);
  return next;
}

function inclusiveDayCount(startDate, endDate) {
  const start = parseDateParam(startDate);
  const end = parseDateParam(endDate);
  return Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
}

function splitDateWindows(startDate, endDate, chunkDays) {
  const windows = [];
  const end = parseDateParam(endDate);
  let cursor = parseDateParam(startDate);
  const size = Math.max(1, Number(chunkDays) || 1);

  while (cursor.getTime() <= end.getTime()) {
    const windowEnd = addCalendarDays(cursor, size - 1);
    const clamped = windowEnd.getTime() > end.getTime() ? end : windowEnd;
    windows.push({
      startDate: formatDateParam(cursor),
      endDate: formatDateParam(clamped),
    });
    cursor = addCalendarDays(clamped, 1);
  }

  return windows.length ? windows : [{ startDate, endDate }];
}

function isTooManyResultsError(error) {
  return /too many (purchases|orders)|restrict your search criteria/i.test(
    String(error?.message || ''),
  );
}

function mergeSearchRows(batches) {
  const all = [];
  const seenIds = new Set();
  for (const batch of batches) {
    for (const item of batch || []) {
      const key = item?.id != null ? String(item.id) : null;
      if (key != null) {
        if (seenIds.has(key)) continue;
        seenIds.add(key);
      }
      all.push(item);
    }
  }
  return all;
}

async function mapPool(items, limit, mapper) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Math.min(Math.max(1, limit), Math.max(items.length, 1));

  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await mapper(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results;
}

const DEFAULT_TX_EXTRAS = [
  'client,items,product,inventory_product',
  'items,product,inventory_product',
  'items,product',
  '',
];

/** Fast totals only — no client payload, so the home table can paint immediately. */
export const HOME_FAST_EXTRAS = [''];

/** Client only. Skip the heavy items extra so email capture lands sooner. */
export const HOME_SUMMARY_EXTRAS = ['client', ''];

const homeEmailCache = new Map();

function homeEmailCacheKey(startDate, endDate) {
  return `${startDate || ''}|${endDate || ''}`;
}

export function peekHomeEmailRows(startDate, endDate) {
  const cached = homeEmailCache.get(homeEmailCacheKey(startDate, endDate));
  return cached?.rows || null;
}

export function rememberHomeEmailRows(startDate, endDate, rows) {
  homeEmailCache.set(homeEmailCacheKey(startDate, endDate), {
    at: Date.now(),
    rows: Array.isArray(rows) ? rows : [],
  });
}

/** Keep previously loaded customer emails when a faster totals-only fetch lands. */
export function mergeHomeSummaryEmails(nextRows, previousRows) {
  const prevById = new Map();
  for (const row of previousRows || []) {
    for (const tx of row.transactions || []) {
      if (tx?.id) prevById.set(tx.id, tx);
    }
  }
  if (prevById.size === 0) return nextRows || [];
  return (nextRows || []).map((row) => ({
    ...row,
    transactions: (row.transactions || []).map((tx) => {
      const prev = prevById.get(tx.id);
      if (!prev) return tx;
      if (tx.customerEmail) return tx;
      return {
        ...tx,
        customerEmail: prev.customerEmail || tx.customerEmail,
        customerName:
          tx.customerName && tx.customerName !== '—'
            ? tx.customerName
            : prev.customerName || tx.customerName,
        customerId: tx.customerId || prev.customerId,
      };
    }),
  }));
}

function isPmxApi(baseUrl) {
  return /canadianpmx\.com/i.test(String(baseUrl || ''));
}

function isPmxSource(baseUrl, systemKey) {
  return systemKey === 'pmx' || isPmxApi(baseUrl);
}

/** POS transaction report paths. `purchases/search` does not return this list. */
function pmxReportPath(path) {
  if (path === 'purchases/search') return 'reports/transactions/purchases';
  if (path === 'orders/search') return 'reports/transactions/orders';
  return '';
}

/** Report filters use `2026/10/25`, not the `2026-10-25` search dates. */
function aureusSlashDate(date) {
  const match = String(date || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}/${match[2]}/${match[3]}` : String(date || '');
}

function posRecordList(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.data?.data)) return payload.data.data;
  if (Array.isArray(payload?.transactions)) return payload.transactions;
  return [];
}

/**
 * Canadian PMX's transaction report (the call the POS makes for Richmond Hill):
 * GET reports/transactions/purchases?start_date=YYYY/MM/DD&end_date=YYYY/MM/DD&type=all
 * and the same query on reports/transactions/orders.
 */
async function fetchPmxTransactionReport(token, path, startDate, endDate, baseUrl) {
  const reportPath = pmxReportPath(path);
  const params = new URLSearchParams({
    start_date: aureusSlashDate(startDate),
    end_date: aureusSlashDate(endDate),
    type: 'all',
  });
  const response = await posFetch(`${baseUrl}/${reportPath}?${params}`, {
    method: 'GET',
    headers: {
      Accept: 'application/json, text/plain, */*',
      Authorization: `Bearer ${token}`,
    },
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new Error(getErrorMessage(payload, `Failed to load ${reportPath}.`));
  }

  return posRecordList(payload);
}

async function fetchSearchRange(
  token,
  path,
  startDate,
  endDate,
  baseUrl,
  itemsPerPage,
  extras,
) {
  const extraOptions = Array.isArray(extras)
    ? extras
    : /^(purchases|orders)\//.test(path)
      ? DEFAULT_TX_EXTRAS
      : [''];
  let extraIndex = 0;
  const all = [];
  let page = 1;
  const maxPages = 100;
  const seenIds = new Set();

  while (page <= maxPages) {
    const params = new URLSearchParams({
      start_date: startDate,
      end_date: endDate,
      page: String(page),
      items_per_page: String(itemsPerPage),
    });
    const extra = extraOptions[extraIndex];
    if (extra) params.set('extra', extra);

    const response = await posFetch(`${baseUrl}/${path}?${params}`, {
      method: 'GET',
      headers: authHeaders(token),
    });

    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (!response.ok) {
      // A rejected `extra` is a 4xx about the query; a 429 is about volume,
      // and re-sending the same search with another extra only adds to it.
      if (page === 1 && response.status !== 429 && extraIndex < extraOptions.length - 1) {
        extraIndex += 1;
        continue;
      }
      throw new Error(getErrorMessage(payload, `Failed to load ${path}.`));
    }

    const batch = Array.isArray(payload?.data)
      ? payload.data
      : Array.isArray(payload)
        ? payload
        : [];

    let newCount = 0;
    for (const item of batch) {
      const id = item?.id;
      const key = id != null ? String(id) : null;
      if (key != null) {
        if (seenIds.has(key)) continue;
        seenIds.add(key);
      }
      all.push(item);
      newCount += 1;
    }

    const { last, perPage } = paginationMeta(payload);
    const pageSize = perPage || itemsPerPage;

    // Aureus orders/search often returns the full set with no pagination meta.
    if (last == null) break;
    if (page >= last) break;
    if (batch.length === 0 || newCount === 0) break;
    if (batch.length < pageSize) break;
    page += 1;
  }

  return all;
}

async function fetchSearch(
  token,
  path,
  startDate,
  endDate,
  baseUrl = API_BASE_URL,
  { itemsPerPage = 5000, extras, systemKey } = {},
) {
  const days = inclusiveDayCount(startDate, endDate);

  if (days > SEARCH_CHUNK_DAYS) {
    const windows = splitDateWindows(startDate, endDate, SEARCH_CHUNK_DAYS);
    const batches = await mapPool(windows, SEARCH_CHUNK_CONCURRENCY, (window) =>
      fetchSearch(token, path, window.startDate, window.endDate, baseUrl, {
        itemsPerPage,
        extras,
        systemKey,
      }),
    );
    return mergeSearchRows(batches);
  }

  try {
    if (isPmxSource(baseUrl, systemKey) && pmxReportPath(path)) {
      try {
        const reported = await fetchPmxTransactionReport(token, path, startDate, endDate, baseUrl);
        if (reported.length) return reported;
      } catch (reportError) {
        try {
          return await fetchSearchRange(
            token,
            path,
            startDate,
            endDate,
            baseUrl,
            itemsPerPage,
            extras,
          );
        } catch {
          throw reportError;
        }
      }
    }
    return await fetchSearchRange(
      token,
      path,
      startDate,
      endDate,
      baseUrl,
      itemsPerPage,
      extras,
    );
  } catch (error) {
    if (!isTooManyResultsError(error) || days <= 1) throw error;

    const leftDays = Math.floor(days / 2);
    const start = parseDateParam(startDate);
    const mid = addCalendarDays(start, leftDays - 1);
    const rightStart = addCalendarDays(mid, 1);
    const [left, right] = await Promise.all([
      fetchSearch(
        token,
        path,
        formatDateParam(start),
        formatDateParam(mid),
        baseUrl,
        { itemsPerPage, extras, systemKey },
      ),
      fetchSearch(
        token,
        path,
        formatDateParam(rightStart),
        endDate,
        baseUrl,
        { itemsPerPage, extras, systemKey },
      ),
    ]);
    return mergeSearchRows([left, right]);
  }
}

export function posSourcesFromSession(session) {
  return posSystemsFromSession(session)
    .filter((system) => system.token)
    .map((system) => ({
      key: system.key,
      label: system.label,
      token: system.token,
      baseUrl: system.baseUrl,
    }));
}

function createdByMapFromSearch(rows) {
  const byId = {};
  for (const row of rows || []) {
    const name = posCreatedByName(row);
    if (!name) continue;
    for (const key of [row?.id, row?.sourceId, posDocumentId(row)]) {
      if (key == null || key === '') continue;
      byId[String(key)] = name;
    }
  }
  return byId;
}

function searchMatchesDocument(row, detail) {
  if (!row || detail == null) return false;
  const want = new Set(
    [detail.id, detail.sourceId, posDocumentId(detail)]
      .map((value) => (value == null ? '' : String(value)))
      .filter(Boolean),
  );
  if (!want.size) return false;
  return [row.id, row.sourceId, posDocumentId(row)].some((value) => value != null && want.has(String(value)));
}

/** Buyer names from Aureus orders/search or PMX reports/transactions/purchases `created_by`. */
export async function fetchSearchCreatedByNames(
  token,
  {
    startDate,
    endDate,
    baseUrl = API_BASE_URL,
    includePurchases = true,
    includeOrders = false,
    systemKey,
  } = {},
) {
  const opts = { extras: ['client', ''], systemKey };
  const [purchases, orders] = await Promise.all([
    includePurchases
      ? fetchSearch(token, 'purchases/search', startDate, endDate, baseUrl, opts)
      : Promise.resolve([]),
    includeOrders
      ? fetchSearch(token, 'orders/search', startDate, endDate, baseUrl, opts)
      : Promise.resolve([]),
  ]);
  return {
    ...createdByMapFromSearch(orders),
    ...createdByMapFromSearch(purchases),
  };
}

/** Resolve Aureus token/baseUrl for a transaction row (multi-POS). */
export function resolvePosAuthForRow(session, row) {
  const auth = resolvePosAuth(session, row?.systemKey || 'east');
  return {
    token: auth.token,
    baseUrl: row?.baseUrl || auth.baseUrl || API_BASE_URL,
  };
}

export async function fetchTransactions(
  token,
  {
    startDate,
    endDate,
    baseUrl = API_BASE_URL,
    includePurchases = true,
    includeOrders = true,
    system = null,
    extras,
  } = {},
) {
  const range = startDate && endDate ? { startDate, endDate } : defaultDateRange();
  const systemInfo = system || {
    key: 'east',
    label: 'Canada Gold East',
    baseUrl,
  };
  const searchOpts = {
    ...(extras ? { extras } : {}),
    systemKey: systemInfo.key,
  };

  const [orders, purchases] = await Promise.all([
    includeOrders
      ? fetchSearch(token, 'orders/search', range.startDate, range.endDate, baseUrl, searchOpts)
      : Promise.resolve([]),
    includePurchases
      ? fetchSearch(token, 'purchases/search', range.startDate, range.endDate, baseUrl, searchOpts)
      : Promise.resolve([]),
  ]);

  const rows = [
    ...orders.map((order) => mapOrder(order, systemInfo)),
    ...purchases.map((purchase) => mapPurchase(purchase, systemInfo)),
  ].sort((a, b) => {
    const aTime = Date.parse(a.date) || 0;
    const bTime = Date.parse(b.date) || 0;
    return bTime - aTime;
  });

  return {
    rows,
    startDate: range.startDate,
    endDate: range.endDate,
    orderCount: orders.length,
    purchaseCount: purchases.length,
  };
}

/**
 * Orders (and optional purchases) across primary East + linked POS systems.
 * Used by FINTRAC so every store is included.
 */
export async function fetchTransactionsAcrossPos(
  session,
  { startDate, endDate, includePurchases = true, extras } = {},
) {
  const authed = await ensureLinkedPosSessions(session);
  const sources = posSourcesFromSession(authed);
  if (sources.length === 0) {
    throw new Error('No POS sessions available. Log in again.');
  }

  const results = await Promise.all(
    sources.map(async (source) => {
      try {
        const result = await fetchTransactions(source.token, {
          startDate,
          endDate,
          baseUrl: source.baseUrl,
          includePurchases,
          extras,
          system: source,
        });
        return { ...result, error: '', source };
      } catch (error) {
        return {
          rows: [],
          orderCount: 0,
          purchaseCount: 0,
          startDate,
          endDate,
          error: error?.message || `Failed to load ${source.label}.`,
          source,
        };
      }
    }),
  );

  const rows = results
    .flatMap((result) => result.rows)
    .sort((a, b) => {
      const aTime = Date.parse(a.date) || 0;
      const bTime = Date.parse(b.date) || 0;
      return bTime - aTime;
    });

  const errors = results.map((r) => r.error).filter(Boolean);
  if (rows.length === 0 && errors.length) {
    throw new Error(errors[0]);
  }

  return {
    rows,
    startDate: results[0]?.startDate || startDate,
    endDate: results[0]?.endDate || endDate,
    orderCount: results.reduce((sum, r) => sum + (r.orderCount || 0), 0),
    purchaseCount: results.reduce((sum, r) => sum + (r.purchaseCount || 0), 0),
    warning: errors.length ? errors.join(' ') : '',
  };
}

export function buildHomeStoreSummaries(rows, { includeExtras = true, pinnedStores = HOME_STORES } = {}) {
  const pins = sortHomeStoreNames(pinnedStores);
  const emptyEntry = (store) => ({
    store,
    saleCount: 0,
    purchaseCount: 0,
    soAmount: 0,
    poAmount: 0,
    transactions: [],
  });

  const byStore = new Map(pins.map((store) => [store, emptyEntry(store)]));

  for (const row of rows) {
    const trimmed = String(row.storeName || '').trim();
    if (!trimmed || trimmed === '—' || isHomeExcludedStore(trimmed)) continue;

    const pinned = normalizeHomeStoreName(trimmed, pins);
    if (pinned) {
      const entry = byStore.get(pinned);
      const amount = Number(row.amount) || 0;
      if (row.type === 'order') {
        entry.saleCount += 1;
        entry.soAmount += amount;
      } else {
        entry.purchaseCount += 1;
        entry.poAmount += amount;
      }
      entry.transactions.push(row);
      continue;
    }

    if (!includeExtras) continue;

    let entry = byStore.get(trimmed);
    if (!entry) {
      entry = emptyEntry(trimmed);
      byStore.set(trimmed, entry);
    }

    const amount = Number(row.amount) || 0;
    if (row.type === 'order') {
      entry.saleCount += 1;
      entry.soAmount += amount;
    } else {
      entry.purchaseCount += 1;
      entry.poAmount += amount;
    }
    entry.transactions.push(row);
  }

  const finalize = (entry) => {
    const txCount = entry.saleCount + entry.purchaseCount;
    const totalAmount = entry.soAmount + entry.poAmount;
    const transactions = entry.transactions
      .slice()
      .sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0));
    return {
      ...entry,
      txCount,
      totalAmount,
      transactions,
    };
  };

  const pinned = pins.map((store) => finalize(byStore.get(store)));
  if (!includeExtras) return pinned;

  const extras = Array.from(byStore.values())
    .filter((entry) => !normalizeHomeStoreName(entry.store, pins))
    .filter((entry) => !isHomeExcludedStore(entry.store))
    .filter((entry) => entry.saleCount + entry.purchaseCount > 0)
    .sort((a, b) => a.store.localeCompare(b.store, undefined, { sensitivity: 'base' }))
    .map(finalize);

  return [...pinned, ...extras];
}

function mergeHomeStoreSummaries(summaries, pinnedStores = HOME_STORES) {
  const pins = sortHomeStoreNames(pinnedStores);
  const byStore = new Map();

  for (const summary of summaries) {
    for (const row of summary) {
      const key = normalizeHomeStoreName(row.store, pins) || row.store;
      const existing = byStore.get(key);
      if (!existing) {
        byStore.set(key, {
          ...row,
          store: key,
          transactions: [...(row.transactions || [])],
        });
        continue;
      }
      existing.saleCount += row.saleCount;
      existing.purchaseCount += row.purchaseCount;
      existing.soAmount += row.soAmount;
      existing.poAmount += row.poAmount;
      existing.txCount += row.txCount;
      existing.totalAmount += row.totalAmount;
      existing.transactions = [...existing.transactions, ...(row.transactions || [])];
    }
  }

  const finalize = (entry) => ({
    ...entry,
    transactions: (entry.transactions || [])
      .slice()
      .sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0)),
  });

  const pinned = pins.map((store) => {
    const entry = byStore.get(store);
    if (entry) return finalize(entry);
    return {
      store,
      saleCount: 0,
      purchaseCount: 0,
      soAmount: 0,
      poAmount: 0,
      txCount: 0,
      totalAmount: 0,
      transactions: [],
    };
  });

  const extras = Array.from(byStore.values())
    .filter((entry) => !normalizeHomeStoreName(entry.store, pins))
    .filter((entry) => !isHomeExcludedStore(entry.store))
    .sort((a, b) => a.store.localeCompare(b.store, undefined, { sensitivity: 'base' }))
    .map(finalize);

  return [...pinned, ...extras];
}

function attachStoreNames(rows, stores) {
  const bySystemId = new Map();
  for (const store of stores || []) {
    const id = store.sourceId ?? store.locationId;
    if (id == null || store.systemKey == null) continue;
    bySystemId.set(`${store.systemKey}:${id}`, store);
  }
  return (rows || []).map((row) => {
    const named = canonicalStoreName(row.storeName);
    if (named && named !== '—') {
      return named === row.storeName ? row : { ...row, storeName: named };
    }
    const hit =
      row.locationId != null ? bySystemId.get(`${row.systemKey}:${row.locationId}`) : null;
    const resolved =
      canonicalStoreName(hit?.name) ||
      (row.systemKey === 'pmx' ? 'Richmond Hill' : '');
    if (!resolved) return row;
    return { ...row, storeName: resolved };
  });
}

export async function fetchHomeStoreSummaries(session, { startDate, endDate, extras } = {}) {
  const today = formatDateParam(parseDateParam(new Date()));
  const range = {
    startDate: startDate || today,
    endDate: endDate || today,
  };
  const extraOptions = Array.isArray(extras) ? extras : HOME_SUMMARY_EXTRAS;
  const authed = await ensureLinkedPosSessions(session);

  const systems = posSystemsFromSession(authed);
  const sources = systems
    .filter((system) => system.token)
    .map((system) => ({
      key: system.key,
      label: system.label,
      token: system.token,
      baseUrl: system.baseUrl,
    }));
  // Hosts this session cannot read, with the reason sign-in gave (shown on
  // the store cards that live on that host).
  const posErrors = Object.fromEntries(
    systems.filter((system) => !system.token).map((system) => [system.key, String(system.error || '')]),
  );

  if (sources.length === 0) {
    throw new Error('No POS sessions available. Log in again to load store summaries.');
  }

  const [results, locationResult] = await Promise.all([
    Promise.all(
      sources.map(async (source) => {
        try {
          const result = await fetchTransactions(source.token, {
            ...range,
            baseUrl: source.baseUrl,
            extras: extraOptions,
            system: source,
          });
          return {
            rows: result.rows,
            error: '',
          };
        } catch (error) {
          return {
            rows: [],
            error: error?.message || `Failed to load ${source.label} transactions.`,
          };
        }
      }),
    ),
    fetchTransferStores(authed).catch(() => ({ stores: [], warning: '' })),
  ]);

  for (const result of results) {
    result.rows = attachStoreNames(result.rows, locationResult.stores);
  }

  const pinnedStores = sortHomeStoreNames([
    ...HOME_PINNED_STORES,
    ...(locationResult.stores || []).map((store) => store.name),
  ]).filter((name) => !isHomeExcludedStore(name));

  const summaries = results
    .map((result) =>
      buildHomeStoreSummaries(result.rows, {
        includeExtras: true,
        pinnedStores,
      }),
    )
    .filter((rows) => rows.length > 0);
  const errors = [
    ...results.map((result) => result.error),
    locationResult.warning,
  ]
    .filter(Boolean)
    .flatMap((message) => String(message).split(/(?<=\.)\s+/))
    .map((part) => part.trim())
    .filter((part) => part && !(isDevSupabaseProject() && /^Not signed in to\b/.test(part)));
  if (summaries.length === 0) {
    throw new Error(errors[0] || 'Failed to load store summaries.');
  }

  return {
    rows: mergeHomeStoreSummaries(summaries, pinnedStores),
    startDate: range.startDate,
    endDate: range.endDate,
    unsignedSystems: ['gta', 'pmx'].filter((key) => !sources.some((system) => system.key === key)),
    posErrors,
    warning: errors.length > 0 ? errors.join(' ') : '',
  };
}

function unwrapPosRecord(payload) {
  let data = payload?.data ?? payload;
  if (Array.isArray(data)) data = data[0];
  if (!data || typeof data !== 'object') return data;
  if (data.id != null) return data;
  for (const key of ['purchase', 'order', 'record', 'transaction']) {
    const nested = data[key];
    if (nested && typeof nested === 'object' && nested.id != null) return nested;
  }
  return data;
}

const DETAIL_TIMEOUT_MS = 8000;

function isAbortError(error) {
  return error?.name === 'AbortError' || /aborted|abort/i.test(String(error?.message || ''));
}

async function fetchPosJson(url, token, timeoutMs = DETAIL_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await posFetch(url, {
      method: 'GET',
      headers: authHeaders(token),
      signal: controller.signal,
    });
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    return { response, payload };
  } catch (error) {
    if (isAbortError(error)) throw new Error('POS lookup timed out.');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function mergePosRecords(base, extra) {
  if (!base) return extra;
  if (!extra) return base;
  const items = Array.isArray(extra.items) && extra.items.length ? extra.items : base.items;
  return {
    ...base,
    ...extra,
    location_name: extra.location_name || extra.location?.name || base.location_name || base.location?.name,
    location: extra.location || base.location,
    items,
    client: extra.client || base.client,
    created_by: richerPerson(extra.created_by, base.created_by),
    createdBy: richerPerson(extra.createdBy, base.createdBy),
    latest_editor_name: richerPerson(extra.latest_editor_name, base.latest_editor_name),
    latestEditorName: richerPerson(extra.latestEditorName, base.latestEditorName),
    user: richerPerson(extra.user, base.user),
  };
}

function richerPerson(next, prev) {
  if (personNameFromValue(next)) return next;
  if (personNameFromValue(prev)) return prev;
  return next ?? prev;
}

function recordHasLocation(record) {
  return Boolean(String(record?.location_name || record?.location?.name || '').trim());
}

function recordHasItems(record) {
  return Array.isArray(record?.items) && record.items.length > 0;
}

/** Detail GET sometimes omits `created_by`; the purchases report includes it (e.g. "Alfredo C."). */
export async function enrichPurchaseCreatedBy(token, detail, baseUrl = API_BASE_URL, systemKey) {
  if (!detail || (detail.id == null && detail.sourceId == null)) return detail;
  if (purchaseBuyerName(detail)) return detail;
  const day = posRecordDateKey(detail);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return detail;
  const key = systemKey || (isPmxApi(baseUrl) ? 'pmx' : undefined);
  const days = [day, shiftDateKey(day, -1), shiftDateKey(day, 1)];
  try {
    for (const start of days) {
      const rows = await fetchSearch(token, 'purchases/search', start, start, baseUrl, { systemKey: key });
      const hit = (rows || []).find((row) => searchMatchesDocument(row, detail));
      if (hit) return mergePosRecords(detail, hit);
    }
    return detail;
  } catch {
    return detail;
  }
}

export async function fetchTransactionDetail(token, { type, sourceId, baseUrl = API_BASE_URL }) {
  const path = type === 'purchase' ? `purchases/${sourceId}` : `orders/${sourceId}`;
  // Bare URL first so a miss 404s without building line items. GTA/PMX hang
  // on the heavy extra; East (Richmond Hill) used to win that race every time.
  const extras = ['', 'client,items,product'];
  let found = null;
  let lastError = null;

  for (const extra of extras) {
    if (extra && found && recordHasLocation(found) && recordHasItems(found)) break;
    const url = extra
      ? `${baseUrl}/${path}?${new URLSearchParams({ extra }).toString()}`
      : `${baseUrl}/${path}`;
    try {
      const { response, payload } = await fetchPosJson(url, token);
      if (!response.ok) {
        lastError = new Error(getErrorMessage(payload, 'Failed to load transaction details.'));
        if (response.status === 404) break;
        continue;
      }
      found = mergePosRecords(found, unwrapPosRecord(payload));
    } catch (error) {
      lastError = error;
      if (found) return found;
      if (String(error?.message || '').includes('timed out')) break;
    }
  }

  if (found && !posEmployeeName(found)) {
    try {
      const url = `${baseUrl}/${path}?${new URLSearchParams({ extra: 'user' }).toString()}`;
      const { response, payload } = await fetchPosJson(url, token);
      if (response.ok) found = mergePosRecords(found, unwrapPosRecord(payload));
    } catch {
      // Buyer name is optional; keep the document we already have.
    }
  }

  if (found) {
    if (type === 'purchase' && !purchaseBuyerName(found)) {
      found = await enrichPurchaseCreatedBy(
        token,
        found,
        baseUrl,
        isPmxApi(baseUrl) ? 'pmx' : undefined,
      );
    }
    return found;
  }
  throw lastError || new Error('Failed to load transaction details.');
}

export function formatTransactionDate(value) {
  if (!value) return '—';
  const date = new Date(value.replace(' ', 'T'));
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return date.toLocaleDateString('en-CA', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function formatTransactionTime(value) {
  if (!value) return '—';
  const date = new Date(value.replace(' ', 'T'));
  if (Number.isNaN(date.getTime())) {
    const match = String(value).match(/(\d{1,2}:\d{2}(?::\d{2})?)/);
    return match ? match[1] : '—';
  }
  return date.toLocaleTimeString('en-CA', {
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function formatAmount(amount, currency = 'CAD') {
  const n = Number(amount) || 0;
  const isUsd = String(currency || 'CAD').trim().toUpperCase() === 'USD';
  try {
    const formatted = new Intl.NumberFormat('en-CA', {
      style: 'currency',
      currency: isUsd ? 'USD' : 'CAD',
      currencyDisplay: 'narrowSymbol',
      maximumFractionDigits: 2,
    }).format(n);
    if (isUsd && !/US/i.test(formatted)) {
      return `US${formatted}`;
    }
    return formatted;
  } catch {
    return `${isUsd ? 'US$' : '$'}${n.toFixed(2)}`;
  }
}

const DOC_REF_RE = /\b(SO|PO)\s*#?\s*(\d+)\b/i;

export function parseDocReference(value) {
  if (value && typeof value === 'object') {
    const sourceId = value.sourceId ?? value.id;
    if (sourceId != null && value.type) {
      const type = value.type === 'purchase' ? 'purchase' : 'order';
      const kind = type === 'purchase' ? 'PO' : 'SO';
      return {
        kind,
        type,
        sourceId: String(sourceId),
        reference: value.reference || `${kind}# ${sourceId}`,
        key: `${kind}${sourceId}`,
      };
    }
    return parseDocReference(value.reference || value.label || '');
  }

  const match = String(value || '').match(DOC_REF_RE);
  if (!match) return null;
  const kind = match[1].toUpperCase();
  return {
    kind,
    type: kind === 'PO' ? 'purchase' : 'order',
    sourceId: match[2],
    reference: `${kind}# ${match[2]}`,
    key: `${kind}${match[2]}`,
  };
}

export function toLookupTransaction(row) {
  if (!row || row.sourceId == null || !row.type) return null;
  return {
    reference: row.reference,
    type: row.type === 'purchase' ? 'purchase' : 'order',
    sourceId: row.sourceId,
    token: row.token,
    baseUrl: row.baseUrl,
    customerName: row.customerName,
    employeeName: row.employeeName,
    storeName: row.storeName,
    amount: row.amount,
    amountLabel: row.amountLabel,
    date: row.date,
    dateLabel: row.dateLabel,
    timeLabel: row.timeLabel,
  };
}

export function findLookupTransaction(list, ref) {
  const parsed = parseDocReference(ref);
  if (!parsed) return null;
  return (
    (list || []).find((row) => {
      if (row == null) return false;
      if (String(row.sourceId) === parsed.sourceId) {
        const rowType = row.type === 'purchase' ? 'purchase' : 'order';
        if (rowType === parsed.type) return true;
      }
      return parseDocReference(row.reference)?.key === parsed.key;
    }) || null
  );
}
