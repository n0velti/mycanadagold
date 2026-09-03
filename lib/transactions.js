import { API_BASE_URL, authHeaders, getLinkedPosSessions } from './auth';

/** GTA / PMX stores shown on the Home summary table. */
export const HOME_STORES = ['Hamilton', 'Mississauga', 'Toronto', 'Richmond Hill'];

export function normalizeHomeStoreName(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return null;
  const match = HOME_STORES.find(
    (store) => store.localeCompare(trimmed, undefined, { sensitivity: 'base' }) === 0,
  );
  return match || null;
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
  return name || client.nickname || client.email || '—';
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
  return /walk[\s-]*in/i.test(String(name || '').trim());
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

function employeeName(record) {
  return record.created_by || record.latest_editor_name || record.user?.name || '—';
}

export function isCashMethod(name) {
  const n = String(name || '').trim().toLowerCase();
  if (!n) return false;
  return n === 'cash' || n === 'espèces' || n === 'especes' || n.startsWith('cash ');
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
    const method =
      payment.payment_type?.name ||
      entry?.payment?.payment_type?.name ||
      'Other';
    const amount = Number(entry?.amount ?? payment.amount) || 0;
    totals[method] = (totals[method] || 0) + amount;
  }

  return Object.entries(totals).map(([method, amount]) => ({
    method,
    amount,
    label: `${formatAmount(amount)} ${method}`,
  }));
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
  return (breakdown || [])
    .filter((entry) => isCashMethod(entry.method))
    .reduce((sum, entry) => sum + (Number(entry.amount) || 0), 0);
}

export function isFintracCash(row) {
  if (!row) return false;
  if (typeof row.cashAmount === 'number') {
    return row.cashAmount >= FINTRAC_CASH_THRESHOLD;
  }
  return Boolean(row.fintracCash);
}

function recordItems(record) {
  if (Array.isArray(record?.items)) return record.items;
  if (Array.isArray(record?.order_items)) return record.order_items;
  if (Array.isArray(record?.purchase_items)) return record.purchase_items;
  return [];
}

export function lineItemsFromDetail(detail) {
  const items = recordItems(detail);
  const names = [];
  const searchParts = [];

  for (const item of items) {
    const product = item?.product;
    const parts = [
      item?.description,
      product?.name,
      product?.description,
      product?.sku,
      product?.code,
      item?.quality_mark_description,
    ]
      .map((value) => String(value || '').trim())
      .filter(Boolean);
    if (parts[0]) names.push(parts[0]);
    searchParts.push(...parts);
  }

  return {
    itemNames: names,
    itemSearchText: searchParts.join(' ').toLowerCase(),
  };
}

export function withLineItems(row, detail) {
  const { itemNames, itemSearchText } = lineItemsFromDetail(detail);
  return {
    ...row,
    itemNames,
    itemSearchText,
    searchText: [row.searchText, itemSearchText].filter(Boolean).join(' ').trim(),
  };
}

function mapOrder(order, system = null) {
  const systemKey = system?.key || 'east';
  const baseId = `so-${order.id}`;
  const { itemNames, itemSearchText } = lineItemsFromDetail(order);
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
    employeeName: employeeName(order),
    storeName: order.location_name || '—',
    amount: Number(order.total_amount) || 0,
    currency: order.currency || 'CAD',
    paymentMethods: order.payment_methods || '',
    itemNames,
    itemSearchText,
  });
}

function mapPurchase(purchase, system = null) {
  const systemKey = system?.key || 'east';
  const baseId = `po-${purchase.id}`;
  const { itemNames, itemSearchText } = lineItemsFromDetail(purchase);
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
    employeeName: employeeName(purchase),
    storeName: purchase.location_name || '—',
    amount: Number(purchase.total_amount) || 0,
    currency: purchase.currency || 'CAD',
    paymentMethods: purchase.payment_methods || '',
    itemNames,
    itemSearchText,
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
      ...(row.itemNames || []),
      row.itemSearchText,
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

async function fetchSearchRange(
  token,
  path,
  startDate,
  endDate,
  baseUrl,
  itemsPerPage,
) {
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

    const response = await fetch(`${baseUrl}/${path}?${params}`, {
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
  { itemsPerPage = 5000 } = {},
) {
  const days = inclusiveDayCount(startDate, endDate);

  if (days > SEARCH_CHUNK_DAYS) {
    const windows = splitDateWindows(startDate, endDate, SEARCH_CHUNK_DAYS);
    const batches = await mapPool(windows, SEARCH_CHUNK_CONCURRENCY, (window) =>
      fetchSearch(token, path, window.startDate, window.endDate, baseUrl, {
        itemsPerPage,
      }),
    );
    return mergeSearchRows(batches);
  }

  try {
    return await fetchSearchRange(
      token,
      path,
      startDate,
      endDate,
      baseUrl,
      itemsPerPage,
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
        { itemsPerPage },
      ),
      fetchSearch(
        token,
        path,
        formatDateParam(rightStart),
        endDate,
        baseUrl,
        { itemsPerPage },
      ),
    ]);
    return mergeSearchRows([left, right]);
  }
}

function posSourcesFromSession(session) {
  const sources = [];
  if (session?.token) {
    sources.push({
      key: 'east',
      label: 'Canada Gold East',
      token: session.token,
      baseUrl: session.baseUrl || API_BASE_URL,
    });
  }
  for (const linked of getLinkedPosSessions(session)) {
    if (!linked?.token) continue;
    sources.push({
      key: linked.key,
      label: linked.label,
      token: linked.token,
      baseUrl: linked.baseUrl,
    });
  }
  return sources;
}

/** Resolve Aureus token/baseUrl for a transaction row (multi-POS). */
export function resolvePosAuthForRow(session, row) {
  const systemKey = row?.systemKey || 'east';
  if (systemKey && systemKey !== 'east') {
    const linked = getLinkedPosSessions(session).find((s) => s.key === systemKey);
    if (linked?.token) {
      return { token: linked.token, baseUrl: linked.baseUrl || row.baseUrl };
    }
  }
  return {
    token: session?.token,
    baseUrl: row?.baseUrl || session?.baseUrl || API_BASE_URL,
  };
}

export async function fetchTransactions(
  token,
  {
    startDate,
    endDate,
    baseUrl = API_BASE_URL,
    includePurchases = true,
    system = null,
  } = {},
) {
  const range = startDate && endDate ? { startDate, endDate } : defaultDateRange();
  const systemInfo = system || {
    key: 'east',
    label: 'Canada Gold East',
    baseUrl,
  };

  const [orders, purchases] = await Promise.all([
    fetchSearch(token, 'orders/search', range.startDate, range.endDate, baseUrl),
    includePurchases
      ? fetchSearch(token, 'purchases/search', range.startDate, range.endDate, baseUrl)
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
  { startDate, endDate, includePurchases = true } = {},
) {
  const sources = posSourcesFromSession(session);
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

export function buildHomeStoreSummaries(rows, { includeExtras = true } = {}) {
  const emptyEntry = (store) => ({
    store,
    saleCount: 0,
    purchaseCount: 0,
    soAmount: 0,
    poAmount: 0,
    transactions: [],
  });

  const byStore = new Map(HOME_STORES.map((store) => [store, emptyEntry(store)]));

  for (const row of rows) {
    const trimmed = String(row.storeName || '').trim();
    if (!trimmed || trimmed === '—') continue;

    const pinned = normalizeHomeStoreName(trimmed);
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

  const pinned = HOME_STORES.map((store) => finalize(byStore.get(store)));
  if (!includeExtras) return pinned;

  const extras = Array.from(byStore.values())
    .filter((entry) => !HOME_STORES.includes(entry.store))
    .filter((entry) => entry.saleCount + entry.purchaseCount > 0)
    .sort((a, b) => a.store.localeCompare(b.store, undefined, { sensitivity: 'base' }))
    .map(finalize);

  return [...pinned, ...extras];
}

function mergeHomeStoreSummaries(summaries) {
  const byStore = new Map();

  for (const summary of summaries) {
    for (const row of summary) {
      const existing = byStore.get(row.store);
      if (!existing) {
        byStore.set(row.store, {
          ...row,
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

  const pinned = HOME_STORES.map((store) => {
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
    .filter((entry) => !HOME_STORES.includes(entry.store))
    .sort((a, b) => a.store.localeCompare(b.store, undefined, { sensitivity: 'base' }))
    .map(finalize);

  return [...pinned, ...extras];
}

export async function fetchHomeStoreSummaries(session, { startDate, endDate } = {}) {
  const today = formatDateParam(parseDateParam(new Date()));
  const range = {
    startDate: startDate || today,
    endDate: endDate || today,
  };

  const sources = [];

  if (session?.token) {
    sources.push({
      key: 'primary',
      label: 'Canada Gold East',
      token: session.token,
      baseUrl: session.baseUrl || API_BASE_URL,
      includeExtras: true,
    });
  }

  for (const system of getLinkedPosSessions(session)) {
    if (!system.token) continue;
    sources.push({
      key: system.key,
      label: system.label,
      token: system.token,
      baseUrl: system.baseUrl,
      includeExtras: false,
    });
  }

  if (sources.length === 0) {
    throw new Error('No POS sessions available. Log in again to load store summaries.');
  }

  const results = await Promise.all(
    sources.map(async (source) => {
      try {
        const result = await fetchTransactions(source.token, {
          ...range,
          baseUrl: source.baseUrl,
        });
        return {
          rows: buildHomeStoreSummaries(result.rows, {
            includeExtras: source.includeExtras,
          }),
          error: '',
        };
      } catch (error) {
        return {
          rows: [],
          error: error?.message || `Failed to load ${source.label} transactions.`,
        };
      }
    }),
  );

  const summaries = results.map((result) => result.rows).filter((rows) => rows.length > 0);
  const errors = results.map((result) => result.error).filter(Boolean);
  if (summaries.length === 0) {
    throw new Error(errors[0] || 'Failed to load store summaries.');
  }

  return {
    rows: mergeHomeStoreSummaries(summaries),
    startDate: range.startDate,
    endDate: range.endDate,
    warning: errors.length > 0 ? errors.join(' ') : '',
  };
}

export async function fetchTransactionDetail(token, { type, sourceId, baseUrl = API_BASE_URL }) {
  const path = type === 'purchase' ? `purchases/${sourceId}` : `orders/${sourceId}`;
  const response = await fetch(`${baseUrl}/${path}`, {
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
    throw new Error(getErrorMessage(payload, 'Failed to load transaction details.'));
  }

  return payload?.data ?? payload;
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
