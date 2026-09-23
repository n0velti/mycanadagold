import { getLinkedPosSessions } from './auth';
import { fetchAureusEmployees } from './aureusEmployees';
import { fetchBullionAuditStores, fetchBullionAudit } from './bullionAudit';
import { AUDIT_CASH_STORES, fetchStoreCashPosition } from './cashTill';
import { fetchInventoryMatrix, peekInventoryMatrix } from './inventory';
import { fetchTransferStores } from './locations';
import { streamChatCompletion } from './llmProviders';
import { compactWebsitePrices, fetchWebsitePrices } from './websitePrices';
import { fetchCashPayments, fetchDebitPayments, summarizeCashByStore, summarizeCashTotals } from './payments';
import { fetchPremiumJewelryByStore } from './premiumJewelry';
import {
  FINTRAC_CASH_THRESHOLD,
  fetchTransactionsAcrossPos,
  formatDateParam,
  isFintracCash,
  parseDateParam,
} from './transactions';

export const AI_CHAT_APPS = [
  { key: 'transactions', label: 'Transactions', icon: 'swap-horizontal-outline', ingestible: true, usesDate: true },
  { key: 'inventory', label: 'Inventory', icon: 'cube-outline', ingestible: true, usesDate: false },
  { key: 'preorders', label: 'Preorders', icon: 'cart-outline', ingestible: false, usesDate: false },
  { key: 'messages', label: 'Direct Messages', icon: 'chatbubbles-outline', ingestible: false, usesDate: false },
  { key: 'audit', label: 'Audit', icon: 'clipboard-outline', ingestible: true, usesDate: true },
  { key: 'transfer', label: 'Transfer', icon: 'arrow-forward-outline', ingestible: true, usesDate: false },
  { key: 'fintrac', label: 'FINTRAC', icon: 'document-text-outline', ingestible: true, usesDate: true },
  { key: 'financials', label: 'Financials', icon: 'wallet-outline', ingestible: true, usesDate: true },
  { key: 'debit', label: 'Debit', icon: 'card-outline', ingestible: true, usesDate: true },
  { key: 'accounting', label: 'Accounting', icon: 'calculator-outline', ingestible: false, usesDate: false },
  { key: 'analytics', label: 'Analytics', icon: 'analytics-outline', ingestible: false, usesDate: false },
  { key: 'pricing', label: 'Pricing', icon: 'pricetag-outline', ingestible: true, usesDate: false },
  { key: 'bonuses', label: 'Bonuses', icon: 'gift-outline', ingestible: false, usesDate: false },
  { key: 'leaderboards', label: 'Leaderboards', icon: 'trophy-outline', ingestible: false, usesDate: false },
  { key: 'police-report', label: 'Police Report', icon: 'shield-outline', ingestible: false, usesDate: false },
  { key: 'security', label: 'Security', icon: 'lock-closed-outline', ingestible: false, usesDate: false },
  { key: 'serphint', label: 'Serphint', icon: 'eye-outline', ingestible: false, usesDate: false },
  { key: 'supplies', label: 'Supplies', icon: 'bag-handle-outline', ingestible: false, usesDate: false },
  { key: 'employees', label: 'Employees', icon: 'people-outline', ingestible: false, usesDate: false },
  { key: 'teams', label: 'Teams', icon: 'people-circle-outline', ingestible: false, usesDate: false },
  { key: 'marketing', label: 'Marketing', icon: 'megaphone-outline', ingestible: false, usesDate: false },
  { key: 'shared-services', label: 'Shared Services', icon: 'briefcase-outline', ingestible: false, usesDate: false },
  { key: 'customers', label: 'Customers', icon: 'person-circle-outline', ingestible: false, usesDate: false },
  { key: 'calendar', label: 'Calendar', icon: 'calendar-outline', ingestible: false, usesDate: false },
  { key: 'notifications', label: 'Notifications', icon: 'notifications-outline', ingestible: false, usesDate: false },
  { key: 'reviews', label: 'Reviews', icon: 'star-outline', ingestible: false, usesDate: false },
  { key: 'emails', label: 'Emails', icon: 'mail-outline', ingestible: false, usesDate: false },
  { key: 'documents', label: 'Documents', icon: 'folder-outline', ingestible: false, usesDate: false },
  { key: 'contacts', label: 'Contacts', icon: 'book-outline', ingestible: false, usesDate: false },
  { key: 'triage', label: 'Triage', icon: 'medkit-outline', ingestible: false, usesDate: false },
  { key: '100-ways', label: '100 Ways', icon: 'list-outline', ingestible: true, usesDate: true },
  { key: 'cdn-coin', label: 'Cdn Coin', icon: 'logo-bitcoin', ingestible: false, usesDate: false },
  { key: 'pmx', label: 'PMX', icon: 'diamond-outline', ingestible: false, usesDate: false },
  { key: 'shipping', label: 'Shipping', icon: 'airplane-outline', ingestible: false, usesDate: false },
  { key: 'storage', label: 'Storage', icon: 'archive-outline', ingestible: false, usesDate: false },
  { key: 'settings', label: 'Settings', icon: 'settings-outline', ingestible: false, usesDate: false },
];

const MAX_CONTEXT_CHARS = 90000;
const MAX_INVENTORY_ITEMS = 280;
const MAX_TX_ROWS = 120;
const MAX_PAYMENT_ROWS = 80;
const MAX_FINTRAC_ROWS = 40;
const MAX_PAYMENT_DAYS = 7;

function namesMatch(a, b) {
  return (
    String(a || '')
      .trim()
      .localeCompare(String(b || '').trim(), undefined, { sensitivity: 'base' }) === 0
  );
}

function looksLikeMaple(name, sku) {
  const text = `${name || ''} ${sku || ''}`.toLowerCase();
  return /maple|gml|sml|maplegram|mlbd/.test(text);
}

function roundQty(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  if (Object.is(n, -0)) return 0;
  return Math.round(n * 1000) / 1000;
}

function money(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function metalLabel(metal) {
  if (typeof metal === 'string' && metal.trim()) return metal.trim();
  if (metal && typeof metal === 'object') {
    const name = metal.name || metal.label || metal.code;
    if (name) return String(name);
  }
  return undefined;
}

function eachDateKey(startDate, endDate) {
  const keys = [];
  let current = parseDateParam(startDate);
  let end = parseDateParam(endDate);
  if (current > end) {
    const swap = current;
    current = end;
    end = swap;
  }
  while (current <= end) {
    keys.push(formatDateParam(current));
    current = new Date(current.getFullYear(), current.getMonth(), current.getDate() + 1);
  }
  return keys;
}

function filterByLocation(rows, locationName, nameKey = 'storeName') {
  if (!locationName) return rows || [];
  return (rows || []).filter((row) => namesMatch(row?.[nameKey], locationName));
}

function compactTxRow(row) {
  return {
    date: row.dateLabel || row.date,
    type: row.type === 'purchase' ? 'PO' : 'SO',
    ref: row.reference,
    store: row.storeName,
    customer: row.customerName,
    employee: row.employeeName,
    amount: money(row.amount),
    methods: row.paymentMethodLabel || row.paymentMethods || undefined,
  };
}

function summarizeTx(rows) {
  let saleCount = 0;
  let purchaseCount = 0;
  let soAmount = 0;
  let poAmount = 0;
  for (const row of rows) {
    const amount = money(row.amount);
    if (row.type === 'purchase') {
      purchaseCount += 1;
      poAmount += amount;
    } else {
      saleCount += 1;
      soAmount += amount;
    }
  }
  return {
    saleCount,
    purchaseCount,
    soAmount: money(soAmount),
    poAmount: money(poAmount),
    txCount: saleCount + purchaseCount,
    totalAmount: money(soAmount + poAmount),
  };
}

function compactInventory(matrix, locationName) {
  const stores = locationName
    ? (matrix.stores || []).filter((store) => namesMatch(store.name, locationName))
    : matrix.stores || [];

  if (locationName && stores.length === 0) {
    return {
      error: `No inventory location matching "${locationName}".`,
      availableStores: (matrix.stores || []).map((store) => store.name),
    };
  }

  const ranked = [];
  let omittedZero = 0;

  for (const row of matrix.rows || []) {
    const qtyByStore = {};
    let total = 0;
    for (const store of stores) {
      const qty = roundQty(row.quantities?.[store.id] || 0);
      qtyByStore[store.name] = qty;
      total += qty;
    }
    const maple = looksLikeMaple(row.name, row.sku);
    if (total === 0 && !(maple && locationName)) {
      omittedZero += 1;
      continue;
    }
    ranked.push({
      maple,
      total,
      item: {
        name: row.name,
        sku: row.sku || undefined,
        metal: metalLabel(row.metal),
        qty: locationName && stores.length === 1 ? total : qtyByStore,
      },
    });
  }

  ranked.sort((a, b) => {
    if (a.maple !== b.maple) return a.maple ? -1 : 1;
    return Math.abs(b.total) - Math.abs(a.total);
  });

  const truncated = ranked.length > MAX_INVENTORY_ITEMS;
  return {
    note: 'Live stock snapshot — not historical for the selected date range. qty 0 means none on hand.',
    location: locationName || 'All locations',
    stores: stores.map((store) => store.name),
    itemCount: Math.min(ranked.length, MAX_INVENTORY_ITEMS),
    omittedZeroQtySkus: omittedZero,
    truncated: truncated || undefined,
    items: ranked.slice(0, MAX_INVENTORY_ITEMS).map((entry) => entry.item),
  };
}

function compactTransactions(rows, locationName) {
  const filtered = filterByLocation(rows, locationName);
  const summary = summarizeTx(filtered);
  const truncated = filtered.length > MAX_TX_ROWS;
  return {
    location: locationName || 'All locations',
    ...summary,
    truncated: truncated || undefined,
    rows: filtered.slice(0, MAX_TX_ROWS).map(compactTxRow),
  };
}

function compactInventoryOverview(matrix, locationName) {
  const stores = locationName
    ? (matrix.stores || []).filter((store) => namesMatch(store.name, locationName))
    : matrix.stores || [];

  if (locationName && stores.length === 0) {
    return {
      error: `No inventory location matching "${locationName}".`,
      availableStores: (matrix.stores || []).map((store) => store.name),
    };
  }

  const byStore = stores.map((store) => {
    let skuInStock = 0;
    let totalQty = 0;
    let mapleQty = 0;
    const maples = [];
    for (const row of matrix.rows || []) {
      const qty = roundQty(row.quantities?.[store.id] || 0);
      if (qty !== 0) skuInStock += 1;
      totalQty += qty;
      if (looksLikeMaple(row.name, row.sku)) {
        mapleQty += qty;
        if (qty !== 0) {
          maples.push({ name: row.name, qty });
        }
      }
    }
    maples.sort((a, b) => Math.abs(b.qty) - Math.abs(a.qty));
    return {
      store: store.name,
      skuInStock,
      totalQty: roundQty(totalQty),
      mapleQty: roundQty(mapleQty),
      maplesInStock: maples.slice(0, 12),
    };
  });

  return {
    note: 'Company stock rollup (live snapshot). Select Inventory for full SKU quantities.',
    location: locationName || 'All locations',
    stores: stores.map((store) => store.name),
    byStore,
  };
}

function compactTxOverview(rows, locationName) {
  const filtered = filterByLocation(rows, locationName);
  const byStoreMap = new Map();
  for (const row of filtered) {
    const store = String(row.storeName || '').trim() || '—';
    let entry = byStoreMap.get(store);
    if (!entry) {
      entry = { store, saleCount: 0, purchaseCount: 0, soAmount: 0, poAmount: 0 };
      byStoreMap.set(store, entry);
    }
    const amount = money(row.amount);
    if (row.type === 'purchase') {
      entry.purchaseCount += 1;
      entry.poAmount += amount;
    } else {
      entry.saleCount += 1;
      entry.soAmount += amount;
    }
  }

  const byStore = Array.from(byStoreMap.values())
    .map((entry) => ({
      ...entry,
      soAmount: money(entry.soAmount),
      poAmount: money(entry.poAmount),
      txCount: entry.saleCount + entry.purchaseCount,
      totalAmount: money(entry.soAmount + entry.poAmount),
    }))
    .sort((a, b) => a.store.localeCompare(b.store, undefined, { sensitivity: 'base' }));

  return {
    note: 'Store activity for the selected dates. Select Transactions for individual SO/PO rows.',
    location: locationName || 'All locations',
    ...summarizeTx(filtered),
    byStore,
  };
}

function compactFintrac(rows, locationName) {
  const filtered = filterByLocation(rows, locationName).filter((row) => {
    if (isFintracCash(row)) return true;
    const cashish = /cash/i.test(String(row.paymentMethods || row.paymentMethodLabel || ''));
    return cashish && money(row.amount) >= FINTRAC_CASH_THRESHOLD;
  });
  const truncated = filtered.length > MAX_FINTRAC_ROWS;
  return {
    location: locationName || 'All locations',
    threshold: FINTRAC_CASH_THRESHOLD,
    count: filtered.length,
    totalAmount: money(filtered.reduce((sum, row) => sum + money(row.amount), 0)),
    truncated: truncated || undefined,
    note: filtered.length
      ? undefined
      : 'No $10,000+ cash candidates in this selection. List payloads may miss cash splits until a transaction is opened.',
    rows: filtered.slice(0, MAX_FINTRAC_ROWS).map(compactTxRow),
  };
}

function compactPayments(rows, locationName, dates) {
  const filtered = filterByLocation(rows, locationName);
  const truncated = filtered.length > MAX_PAYMENT_ROWS;
  return {
    location: locationName || 'All locations',
    dates,
    totals: summarizeCashTotals(filtered),
    byStore: summarizeCashByStore(filtered).map((entry) => ({
      store: entry.storeName,
      count: entry.count,
      cashIn: money(entry.cashIn),
      cashOut: money(entry.cashOut),
      net: money(entry.net),
    })),
    truncated: truncated || undefined,
    rows: filtered.slice(0, MAX_PAYMENT_ROWS).map((row) => ({
      date: row.dateLabel || row.date,
      store: row.storeName,
      type: row.type,
      amount: money(row.amount),
      customer: row.customerName,
      ref: row.reference,
      method: row.paymentType,
    })),
  };
}

function moneyOrNull(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

async function mapPool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function cadLabel(value) {
  if (!Number.isFinite(value)) return null;
  const formatted = Math.abs(value).toLocaleString('en-CA', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${value < 0 ? '-' : ''}$${formatted}`;
}

function compactTillRow(position) {
  const cad = position?.cad || {};
  const usd = position?.usd || {};
  return {
    store: position.storeName,
    currentCad: moneyOrNull(cad.expectedOnHand),
    currentCadLabel: cadLabel(moneyOrNull(cad.expectedOnHand)),
    openingCad: moneyOrNull(cad.openingBalance),
    physicalCad: moneyOrNull(cad.todayPhysical),
    movementCad: moneyOrNull(cad.movementNet),
    currentUsd: moneyOrNull(usd.expectedOnHand),
    warning: position.warning || undefined,
  };
}

/**
 * Live Till 1 balances. currentCad is expected cash in the drawer now.
 */
export async function loadTillBoard(session, { locationName, date } = {}) {
  const names = locationName ? [locationName] : [...AUDIT_CASH_STORES];
  const day = formatDateParam(date || new Date());
  const rows = await mapPool(names, 3, async (storeName) => {
    try {
      const position = await fetchStoreCashPosition(session, { storeName, date: day });
      return compactTillRow(position);
    } catch (error) {
      return { store: storeName, error: error?.message || 'Till did not load.' };
    }
  });

  const ranked = rows
    .filter((row) => !row.error && Number.isFinite(row.currentCad))
    .sort(
      (a, b) => b.currentCad - a.currentCad || a.store.localeCompare(b.store, undefined, { sensitivity: 'base' }),
    );

  return {
    note: 'Live Till 1 CAD. currentCad is expected cash in the drawer now (opening balance plus today’s cash in and out). Use currentCad for current, highest, and lowest. physicalCad is a staff count and is often empty. Do not treat a store with an error as $0.',
    date: day,
    scope: locationName || 'All retail stores',
    currency: 'CAD',
    highest: ranked[0]
      ? { store: ranked[0].store, currentCad: ranked[0].currentCad, currentCadLabel: ranked[0].currentCadLabel }
      : null,
    lowest: ranked.length
      ? {
          store: ranked[ranked.length - 1].store,
          currentCad: ranked[ranked.length - 1].currentCad,
          currentCadLabel: ranked[ranked.length - 1].currentCadLabel,
        }
      : null,
    ranking: ranked.map((row) => `${row.store} — ${row.currentCadLabel}`),
    stores: ranked.concat(rows.filter((row) => row.error)),
  };
}

function wantsTillQuestion(question) {
  return /\b(tills?|cash drawers?|drawers?|cash till|cash on hand)\b/i.test(String(question || ''));
}

function wantsAllStores(question) {
  return /\b(which store|what store|highest|lowest|most|least|compare|all stores|every store|by store|ranking)\b/i.test(
    String(question || ''),
  );
}

function tillDateForQuestion(question, endDate) {
  if (/\b(current|right now|today|live|now)\b/i.test(String(question || ''))) {
    return formatDateParam(new Date());
  }
  return formatDateParam(endDate || new Date());
}

const APP_LOOKUPS = [
  {
    app: 'fintrac',
    test: /\bfintrac\b|\b10[, ]?000\b|\blarge cash\b/i,
    present: (data) => data?.fintrac && !data.fintrac.error,
  },
  {
    app: 'debit',
    test: /\b(debit|interac)\b/i,
    present: (data) => data?.debit && !data.debit.error,
  },
  {
    app: 'financials',
    test: /\b(cash payments?|financials)\b/i,
    present: (data) => data?.financials && !data.financials.error,
  },
  {
    app: 'pricing',
    test: /\b(spot price|website prices?|pricing)\b/i,
    present: (data) => data?.pricing && !data.pricing.error,
  },
  {
    app: 'inventory',
    test: /\b(sku\b|maples?|in stock|do we have|inventory)\b/i,
    present: (data) => Array.isArray(data?.inventory?.items),
  },
  {
    app: 'transactions',
    test: /\b(transactions?|sales orders?|purchase orders?|\bso\s*#|\bpo\s*#)\b/i,
    present: (data) => Array.isArray(data?.transactions?.rows),
  },
  {
    app: 'transfer',
    test: /\btransfers?\b/i,
    present: (data) => data?.transfer && !data.transfer.error,
  },
  {
    app: '100-ways',
    test: /\b(100 ways|premium jewelry)\b/i,
    present: (data) => data?.premiumJewelry && !data.premiumJewelry.error,
  },
  {
    app: 'audit',
    test: /\b(bullion count|unbalanced|audit variance)\b/i,
    present: (data) => data?.audit && !data.audit.error,
  },
];

function compactAuditPosition(position) {
  const drawer = (side) => {
    if (!side) return null;
    return {
      currency: side.currency,
      yesterdayClosing: money(side.yesterdayClosing),
      openingBalance: money(side.openingBalance),
      todayPhysical: money(side.todayPhysical),
      movementNet: money(side.movementNet),
      expectedOnHand: money(side.expectedOnHand),
      payments: side.paymentTotals,
      tillAdjustments: side.cashTxnTotals,
    };
  };
  return {
    store: position.storeName,
    date: position.date,
    cad: drawer(position.cad),
    usd: drawer(position.usd),
    warning: position.warning || undefined,
  };
}

function compactBullionAudit(audit, locationName) {
  const unbalanced = (audit.rows || [])
    .map((row) => {
      const counted =
        row.amount == null &&
        row.vaultCount == null &&
        row.nightCount == null &&
        row.afternoonCount == null
          ? null
          : roundQty((row.vaultCount || 0) + (row.nightCount || 0) + (row.afternoonCount || 0));
      const system = roundQty(row.systemCount);
      const delta = counted == null ? null : roundQty(counted - system);
      return {
        name: row.name,
        sku: row.sku || undefined,
        metal: metalLabel(row.metal),
        system,
        counted,
        delta,
      };
    })
    .filter((row) => row.counted != null && row.delta !== 0);

  return {
    store: locationName,
    date: audit.date,
    unbalancedCount: unbalanced.length,
    unbalanced: unbalanced.slice(0, 80),
  };
}

function compactPremium(result, locationName) {
  const rows = locationName
    ? (result.rows || []).filter((row) => namesMatch(row.store, locationName))
    : result.rows || [];
  return {
    location: locationName || 'All locations',
    totals: result.totals,
    stores: rows.map((row) => ({
      store: row.store,
      totalTxCount: row.totalTxCount,
      purchaseCount: row.purchaseCount,
      premiumTxCount: row.premiumTxCount,
      premiumItemCount: row.premiumItemCount,
      percentLabel: row.percentLabel,
      sample: (row.transactions || []).slice(0, 8).map((tx) => ({
        date: tx.date,
        ref: tx.reference,
        customer: tx.customerName,
        items: tx.premiumItemNames,
      })),
    })),
    warning: result.warning || undefined,
  };
}

function trimContext(payload) {
  let text = JSON.stringify(payload);
  if (text.length <= MAX_CONTEXT_CHARS) return payload;

  const next = { ...payload, data: { ...payload.data } };
  for (const key of ['transactions', 'financials', 'debit', 'inventory', 'fintrac', 'audit', 'pricing']) {
    const block = next.data[key];
    if (block?.rows && Array.isArray(block.rows)) {
      block.rows = block.rows.slice(0, Math.ceil(block.rows.length / 2));
      block.truncated = true;
    }
    if (block?.items && Array.isArray(block.items)) {
      block.items = block.items.slice(0, Math.ceil(block.items.length / 2));
      block.truncated = true;
    }
  }
  text = JSON.stringify(next);
  if (text.length <= MAX_CONTEXT_CHARS) return next;
  return {
    ...next,
    truncated: true,
    note: 'Context truncated to fit the model window. Ask with a tighter location or fewer apps if a product is missing.',
  };
}

async function settled(label, fn) {
  try {
    return { ok: true, label, value: await fn() };
  } catch (error) {
    return { ok: false, label, error: error?.message || `Failed to load ${label}.` };
  }
}

/**
 * Pull live POS/app data for the selected filters and compact it for a chat prompt.
 */
export async function gatherAiChatContext(
  session,
  { apps = [], startDate, endDate, locationName, onProgress } = {},
) {
  const selected = [...new Set(apps.filter(Boolean))];
  const companyMode = selected.length === 0;
  const range = {
    startDate: formatDateParam(startDate || new Date()),
    endDate: formatDateParam(endDate || new Date()),
  };
  const location = String(locationName || '').trim() || null;
  const data = {};
  const errors = [];
  const summaries = [];

  const mark = (label) => onProgress?.(label);

  const needTx = selected.includes('transactions') || selected.includes('fintrac');
  const needInv = selected.includes('inventory') || selected.includes('transfer');

  let txRows = [];
  let matrix = null;

  if (needTx) {
    mark('Loading transactions…');
    const txResult = await settled('Transactions', () =>
      fetchTransactionsAcrossPos(session, {
        startDate: range.startDate,
        endDate: range.endDate,
        includePurchases: true,
      }),
    );
    if (!txResult.ok) {
      errors.push(txResult.error);
    } else {
      txRows = txResult.value.rows || [];
      if (txResult.value.warning) errors.push(txResult.value.warning);
    }
  }

  if (needInv) {
    mark('Loading inventory…');
    const cached = peekInventoryMatrix(session);
    const invResult = cached
      ? { ok: true, value: cached }
      : await settled('Inventory', () => fetchInventoryMatrix(session));
    if (!invResult.ok) {
      errors.push(invResult.error);
    } else {
      matrix = invResult.value;
      if (matrix.warning) errors.push(matrix.warning);
    }
  }

  const unavailable = selected
    .map((key) => AI_CHAT_APPS.find((app) => app.key === key))
    .filter((app) => app && !app.ingestible);
  if (unavailable.length > 0) {
    data.unavailableApps = unavailable.map((app) => app.label);
    errors.push(
      `No live data feed yet for ${unavailable.map((app) => app.label).join(', ')}.`,
    );
  }

  if (selected.includes('inventory')) {
    if (matrix) {
      data.inventory = compactInventory(matrix, location);
      summaries.push({
        key: 'inventory',
        label: 'Inventory',
        detail: `${data.inventory.itemCount || 0} SKUs`,
      });
    } else {
      data.inventory = { error: 'Inventory did not load.' };
    }
  }

  if (selected.includes('transactions')) {
    data.transactions = compactTransactions(txRows, location);
    summaries.push({
      key: 'transactions',
      label: 'Transactions',
      detail: `${data.transactions.txCount} txns`,
    });
  }

  if (selected.includes('fintrac')) {
    data.fintrac = compactFintrac(txRows, location);
    summaries.push({
      key: 'fintrac',
      label: 'FINTRAC',
      detail: `${data.fintrac.count} cash $10k+`,
    });
  }

  if (selected.includes('financials')) {
    mark('Loading financials…');
    const dayKeys = eachDateKey(range.startDate, range.endDate).slice(-MAX_PAYMENT_DAYS);
    const payResult = await settled('Financials', async () => {
      const batches = await Promise.all(
        dayKeys.map((date) =>
          fetchCashPayments(session, {
            date,
            storeName: location || undefined,
          }),
        ),
      );
      return {
        rows: batches.flatMap((batch) => batch.rows || []),
        warning: batches.map((batch) => batch.warning).filter(Boolean).join(' '),
        dates: dayKeys,
      };
    });
    if (!payResult.ok) {
      errors.push(payResult.error);
      data.financials = { error: payResult.error };
    } else {
      if (payResult.value.warning) errors.push(payResult.value.warning);
      data.financials = compactPayments(payResult.value.rows, location, payResult.value.dates);
      summaries.push({
        key: 'financials',
        label: 'Financials',
        detail: `${data.financials.rows?.length || 0} cash payments`,
      });
    }
  }

  if (selected.includes('debit')) {
    mark('Loading debit…');
    const dayKeys = eachDateKey(range.startDate, range.endDate).slice(-MAX_PAYMENT_DAYS);
    const debitResult = await settled('Debit', async () => {
      const batches = await Promise.all(
        dayKeys.map((date) =>
          fetchDebitPayments(session, {
            date,
            storeName: location || undefined,
          }),
        ),
      );
      return {
        rows: batches.flatMap((batch) => batch.rows || []),
        warning: batches.map((batch) => batch.warning).filter(Boolean).join(' '),
        dates: dayKeys,
      };
    });
    if (!debitResult.ok) {
      errors.push(debitResult.error);
      data.debit = { error: debitResult.error };
    } else {
      if (debitResult.value.warning) errors.push(debitResult.value.warning);
      data.debit = compactPayments(debitResult.value.rows, location, debitResult.value.dates);
      summaries.push({
        key: 'debit',
        label: 'Debit',
        detail: `${data.debit.rows?.length || 0} debit payments`,
      });
    }
  }

  if (selected.includes('audit')) {
    if (!location) {
      data.audit = {
        error: 'Pick a location to ingest Audit till and bullion counts.',
      };
    } else {
      mark('Loading audit…');
      const cashResult = await settled('Audit cash', () =>
        fetchStoreCashPosition(session, { storeName: location, date: range.endDate }),
      );
      const auditBlock = {};
      if (cashResult.ok) {
        auditBlock.cash = compactAuditPosition(cashResult.value);
      } else {
        auditBlock.cashError = cashResult.error;
        errors.push(cashResult.error);
      }

      const storesResult = await settled('Audit stores', () => fetchBullionAuditStores(session));
      if (storesResult.ok) {
        const store = (storesResult.value || []).find((entry) => namesMatch(entry.name, location));
        if (store) {
          const bullionResult = await settled('Audit bullion', () =>
            fetchBullionAudit(session, {
              date: range.endDate,
              locationId: store.id,
              systemKey: store.systemKey,
              storeName: store.name,
            }),
          );
          if (bullionResult.ok) {
            auditBlock.bullion = compactBullionAudit(bullionResult.value, location);
          } else {
            auditBlock.bullionError = bullionResult.error;
            errors.push(bullionResult.error);
          }
        }
      }

      data.audit = auditBlock;
      summaries.push({
        key: 'audit',
        label: 'Audit',
        detail: location,
      });
    }
  }

  if (selected.includes('pricing')) {
    mark('Loading website prices…');
    const priceResult = await settled('Pricing', () => fetchWebsitePrices());
    if (!priceResult.ok) {
      errors.push(priceResult.error);
      data.pricing = { error: priceResult.error };
    } else {
      data.pricing = compactWebsitePrices(priceResult.value);
      summaries.push({
        key: 'pricing',
        label: 'Pricing',
        detail: data.pricing.updated || 'CAD',
      });
    }
  }

  if (selected.includes('transfer')) {
    mark('Loading transfer stores…');
    const transferResult = await settled('Transfer', () => fetchTransferStores(session));
    if (!transferResult.ok) {
      errors.push(transferResult.error);
      data.transfer = { error: transferResult.error };
    } else {
      const stores = location
        ? transferResult.value.stores.filter((store) => namesMatch(store.name, location))
        : transferResult.value.stores;
      data.transfer = {
        location: location || 'All locations',
        stores: stores.map((store) => ({
          name: store.name,
          city: store.city || undefined,
          address: store.address || undefined,
          system: store.systemLabel,
        })),
        warning: transferResult.value.warning || undefined,
        note: selected.includes('inventory')
          ? 'Stock quantities are in the Inventory block.'
          : 'Select Inventory as well to include on-hand quantities.',
      };
      summaries.push({
        key: 'transfer',
        label: 'Transfer',
        detail: `${stores.length} stores`,
      });
    }
  }

  if (selected.includes('100-ways')) {
    mark('Loading 100 Ways…');
    const premiumResult = await settled('100 Ways', () =>
      fetchPremiumJewelryByStore(session, {
        startDate: range.startDate,
        endDate: range.endDate,
      }),
    );
    if (!premiumResult.ok) {
      errors.push(premiumResult.error);
      data.premiumJewelry = { error: premiumResult.error };
    } else {
      data.premiumJewelry = compactPremium(premiumResult.value, location);
      summaries.push({
        key: '100-ways',
        label: '100 Ways',
        detail: `${data.premiumJewelry.totals?.premiumTxCount || 0} premium`,
      });
    }
  }

  const context = trimContext({
    selection: {
      mode: companyMode ? 'company' : 'apps',
      startDate: range.startDate,
      endDate: range.endDate,
      location: location || 'All locations',
      apps: selected,
    },
    data,
    errors: errors.filter(Boolean),
  });

  return { context, summaries, errors: errors.filter(Boolean) };
}

const ANSWER_STYLE = `How to answer:
- First sentence is the answer. Bold the key store names and amounts with **double asterisks**.
- Then a blank line and a simple list. One fact per line. Each line starts with "- ".
- Add one short last line only when a figure needs a definition.
- No headings, tables, code blocks, or sign-off.
- Do not tell the user to open another app or screen.
- Use only numbers that appear in the JSON. If a store has an error, say it did not load. Never treat a missing store as $0.
- For cash tills, use Lookup.tills.highest, Lookup.tills.lowest, and Lookup.tills.ranking. Quote currentCadLabel exactly. List every loaded store. physicalCad is a staff count and may be null.

Shape only. Do not copy these placeholders:
**Store A** has the highest Till 1 CAD at **$X**. **Store B** is the lowest at **$Y**.

- Store A — $X
- Store B — $Y

Current means expected cash in Till 1 right now.`;

const DATA_SOURCES = [
  { key: 'tills', label: 'Cash tills', hint: 'Live Till 1 CAD and USD by store. Current, highest, and lowest cash till or drawer.' },
  { key: 'inventory', label: 'Inventory', hint: 'Live SKU quantities by store, including maple leaf products.' },
  { key: 'transactions', label: 'Transactions', hint: 'Sales and purchases in the selected dates, with totals by store.' },
  { key: 'fintrac', label: 'FINTRAC', hint: 'Cash deals at or above $10,000.' },
  { key: 'financials', label: 'Financials', hint: 'Cash payment totals in and out. Not the till balance.' },
  { key: 'debit', label: 'Debit', hint: 'Debit and Interac payments.' },
  { key: 'pricing', label: 'Pricing', hint: 'Website buy and sell metal prices.' },
  { key: 'transfer', label: 'Transfer', hint: 'Store names and addresses for transfers.' },
  { key: 'audit', label: 'Audit', hint: 'Bullion count variances for one named store.' },
  { key: '100-ways', label: '100 Ways', hint: 'Premium jewelry purchases by store.' },
  { key: 'employees', label: 'Employees', hint: 'POS staff directory: name, role, and default store.' },
];

const SOURCE_KEYS = new Set(DATA_SOURCES.map((source) => source.key));
const GATHER_APPS = new Set([
  'inventory',
  'transactions',
  'fintrac',
  'financials',
  'debit',
  'pricing',
  'transfer',
  'audit',
  '100-ways',
]);
const sourceCache = new Map();
const SOURCE_CACHE_MS = 3 * 60 * 1000;

function cacheGet(key) {
  const hit = sourceCache.get(key);
  if (!hit) return null;
  if (hit.expires < Date.now()) {
    sourceCache.delete(key);
    return null;
  }
  return hit.value;
}

function cacheSet(key, value) {
  if (!value || value.error) return;
  sourceCache.set(key, { value, expires: Date.now() + SOURCE_CACHE_MS });
}

function sourceCacheKey(source, scope) {
  return [
    source,
    scope.startDate || '',
    scope.endDate || '',
    scope.location || '*',
    scope.tillDate || '',
  ].join('|');
}

function keywordSources(question) {
  const keys = [];
  if (wantsTillQuestion(question)) keys.push('tills');
  for (const entry of APP_LOOKUPS) {
    if (entry.test.test(question)) keys.push(entry.app);
  }
  if (/\b(employees?|staff|who works)\b/i.test(String(question || ''))) keys.push('employees');
  return [...new Set(keys)].filter((key) => SOURCE_KEYS.has(key)).slice(0, 3);
}

function isFollowUp(question) {
  return (
    String(question || '').trim().split(/\s+/).length <= 8 &&
    /\b(that|those|them|same|too|also|what about|how about)\b/i.test(String(question || ''))
  );
}

function parseSourcePlan(text) {
  const match = String(text || '').match(/\{[\s\S]*\}/);
  if (!match) return { sources: [], allStores: false };
  try {
    const parsed = JSON.parse(match[0]);
    const sources = (Array.isArray(parsed.sources) ? parsed.sources : [])
      .map((key) => String(key || '').trim())
      .filter((key) => SOURCE_KEYS.has(key))
      .slice(0, 3);
    return { sources, allStores: Boolean(parsed.allStores) };
  } catch {
    return { sources: [], allStores: false };
  }
}

async function planDataSources({ model, question, history, signal, location, startDate, endDate }) {
  if (!model) return { sources: [], allStores: false };
  const catalog = DATA_SOURCES.map((source) => `- ${source.key}: ${source.hint}`).join('\n');
  const earlier = (history || [])
    .filter((turn) => turn.role === 'user')
    .slice(-3)
    .map((turn) => turn.content)
    .join(' | ');
  const text = await streamChatCompletion({
    model,
    signal,
    maxTokens: 180,
    messages: [
      {
        role: 'user',
        content: `Choose datasets for this question. Reply with JSON only, no markdown:
{"sources":["tills"],"allStores":true}

Datasets:
${catalog}

Rules:
- Pick 1 to 3 keys from the list. Pick none only for greetings.
- tills for cash till, drawer, or cash on hand. financials is payments, not the till balance.
- allStores true when the question compares stores or asks which is highest or lowest.
- A follow-up keeps the earlier topic.

Dates: ${startDate || 'today'} to ${endDate || 'today'}
Location: ${location || 'All'}
Earlier questions: ${earlier || 'none'}
Question: ${question}`,
      },
    ],
  });
  return parseSourcePlan(text);
}

async function loadEmployeeDirectory(session, locationName) {
  const systems = [];
  if (session?.token) {
    systems.push({ token: session.token, baseUrl: session.baseUrl, label: 'East' });
  }
  for (const linked of getLinkedPosSessions(session)) {
    if (linked?.token) {
      systems.push({ token: linked.token, baseUrl: linked.baseUrl, label: linked.label || linked.key });
    }
  }
  const batches = await Promise.all(
    systems.map(async (system) => {
      try {
        return await fetchAureusEmployees(system.token, system.baseUrl);
      } catch (error) {
        return { error: error?.message || `Employees did not load (${system.label}).` };
      }
    }),
  );
  const errors = batches.filter((batch) => batch && !Array.isArray(batch) && batch.error).map((batch) => batch.error);
  const rows = [];
  const seen = new Set();
  for (const batch of batches) {
    if (!Array.isArray(batch)) continue;
    for (const row of batch) {
      const key = String(row.email || row.aureusLogin || row.id || '').toLowerCase();
      if (!key || seen.has(key)) continue;
      if (locationName && !namesMatch(row.locationName, locationName)) continue;
      seen.add(key);
      rows.push({
        name: row.fullName || row.aureusLogin,
        role: row.role || undefined,
        store: row.locationName || undefined,
        active: row.isActive,
      });
    }
  }
  return {
    note: 'POS staff directory. Name, role, and default store.',
    count: rows.length,
    employees: rows.slice(0, 180),
    truncated: rows.length > 180 || undefined,
    errors: errors.length ? errors : undefined,
  };
}

async function loadChosenSources(session, sources, scope, onProgress) {
  const lookup = {};
  const errors = [];
  const location = scope.allStores ? null : scope.location;

  if (sources.includes('tills')) {
    const key = sourceCacheKey('tills', { ...scope, location });
    const cached = cacheGet(key);
    if (cached) {
      lookup.tills = cached;
    } else {
      onProgress?.('Loading cash tills…');
      lookup.tills = await loadTillBoard(session, { locationName: location, date: scope.tillDate });
      cacheSet(key, lookup.tills);
    }
  }

  if (sources.includes('employees')) {
    const key = sourceCacheKey('employees', { ...scope, location, tillDate: '' });
    const cached = cacheGet(key);
    if (cached) {
      lookup.employees = cached;
    } else {
      onProgress?.('Loading employees…');
      lookup.employees = await loadEmployeeDirectory(session, location);
      cacheSet(key, lookup.employees);
    }
  }

  const apps = sources.filter((source) => GATHER_APPS.has(source));
  const missing = [];
  for (const app of apps) {
    const key = sourceCacheKey(app, { ...scope, location, tillDate: '' });
    const cached = cacheGet(key);
    const field = app === '100-ways' ? 'premiumJewelry' : app;
    if (cached) lookup[field] = cached;
    else missing.push(app);
  }

  if (missing.length) {
    onProgress?.('Loading company data…');
    const extra = await gatherAiChatContext(session, {
      apps: missing,
      startDate: scope.startDate,
      endDate: scope.endDate,
      locationName: location || undefined,
      onProgress,
    });
    for (const app of missing) {
      const field = app === '100-ways' ? 'premiumJewelry' : app;
      const block = extra.context?.data?.[field] || extra.context?.data?.[app];
      if (block) {
        lookup[field] = block;
        cacheSet(sourceCacheKey(app, { ...scope, location, tillDate: '' }), block);
      }
    }
    if (extra.errors?.length) errors.push(...extra.errors);
  }

  if (errors.length) lookup.errors = errors;
  return lookup;
}

function buildSeedMessages(context) {
  const catalog = (context?.catalog || DATA_SOURCES)
    .map((source) => `- ${source.label}: ${source.hint}`)
    .join('\n');
  const intro = `You are Canada Gold's internal operations assistant.

No company rows are loaded up front. The latest user message includes a Lookup object with only the datasets that question needs. Answer from Lookup. If Lookup is missing, say which topic to ask about. Do not invent numbers and do not tell the user to open another app.

Gold Maple Leaf products are often labeled GML, Maplegram, Maple Leaf, or MLBD. Silver Maples are often SML. Inventory quantities are a live snapshot. 0 means none on hand.

Datasets that can be looked up:
${catalog}

Not searched: direct messages, email bodies, bonuses, and settings.

Scope: ${context?.selection?.location || 'All locations'}, ${context?.selection?.startDate || ''} to ${context?.selection?.endDate || ''}.

${ANSWER_STYLE}`;

  return [
    {
      role: 'user',
      content: `${intro}

Answer in one sentence, then a "- " list. When Lookup.tills is present, rank stores from Lookup.tills.ranking.`,
    },
    {
      role: 'assistant',
      content: 'Ready. Ask a question and I will look up only the data it needs.',
    },
  ];
}

/**
 * Chat opens with a catalog only. Rows load after a question.
 */
export function prepareAiChatSession({ apps = [], startDate, endDate, locationName } = {}) {
  const selected = (apps || []).filter(Boolean);
  const context = {
    selection: {
      mode: selected.length ? 'apps' : 'company',
      startDate: formatDateParam(startDate || new Date()),
      endDate: formatDateParam(endDate || new Date()),
      location: String(locationName || '').trim() || 'All locations',
      apps: selected,
    },
    catalog: DATA_SOURCES.map(({ key, label, hint }) => ({ key, label, hint })),
    notSearched: ['Direct messages', 'Email bodies', 'Bonuses', 'Settings'],
  };
  return {
    context,
    summaries: [{ key: 'ready', label: 'On ask', detail: 'Loads per question' }],
    errors: [],
    seedMessages: buildSeedMessages(context),
  };
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  const abort = new Error('Aborted');
  abort.name = 'AbortError';
  throw abort;
}

/**
 * After a question, choose and load only the datasets it needs.
 */
export async function lookupAiChatData(
  session,
  { question, context, startDate, endDate, locationName, history, model, onProgress, signal } = {},
) {
  if (!session?.token || !question) return null;
  throwIfAborted(signal);

  const rangeStart = startDate || context?.selection?.startDate;
  const rangeEnd = endDate || context?.selection?.endDate;
  const selectedLocation = String(locationName ?? context?.selection?.location ?? '').trim();
  const location =
    selectedLocation && selectedLocation !== 'All locations' ? selectedLocation : null;
  const hinted = [];
  if (isFollowUp(question)) {
    for (const key of context?.lastSources || []) hinted.push(key);
  }
  hinted.push(...keywordSources(question));
  const hintedKeys = [...new Set(hinted)].filter((key) => SOURCE_KEYS.has(key)).slice(0, 3);
  const hintedAllStores = wantsAllStores(question);
  const hintedScope = {
    allStores: hintedAllStores,
    location: hintedAllStores ? null : location,
    startDate: rangeStart,
    endDate: rangeEnd,
    tillDate: tillDateForQuestion(question, rangeEnd),
  };

  onProgress?.('Choosing data…');
  const hintedLoad = hintedKeys.length
    ? loadChosenSources(session, hintedKeys, hintedScope, onProgress)
    : Promise.resolve({});
  let plan = { sources: [], allStores: false };
  try {
    plan = await planDataSources({
      model,
      question,
      history,
      signal,
      location,
      startDate: rangeStart,
      endDate: rangeEnd,
    });
  } catch (error) {
    if (signal?.aborted || error?.name === 'AbortError') throw error;
    plan = { sources: [], allStores: false };
  }
  throwIfAborted(signal);

  const extras = (plan.sources || [])
    .filter((key) => !hintedKeys.includes(key))
    .slice(0, Math.max(0, 3 - hintedKeys.length));
  const allStores = hintedAllStores || plan.allStores;
  const extraScope = {
    allStores,
    location: allStores ? null : location,
    startDate: rangeStart,
    endDate: rangeEnd,
    tillDate: tillDateForQuestion(question, rangeEnd),
  };
  const [hintedResult, extraResult] = await Promise.all([
    hintedLoad,
    extras.length ? loadChosenSources(session, extras, extraScope, onProgress) : Promise.resolve({}),
  ]);
  throwIfAborted(signal);

  const sources = [...new Set([...hintedKeys, ...extras])];
  if (!sources.length) return null;
  return {
    sources,
    ...hintedResult,
    ...extraResult,
  };
}

export function fallbackAiChatTitle(turns) {
  const first = (turns || []).find((turn) => turn?.role === 'user' && String(turn.content || '').trim());
  const cleaned = String(first?.content || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return 'MyCanadaGold AI chat';
  if (cleaned.length <= 42) return cleaned;
  return `${cleaned.slice(0, 41).trim()}…`;
}

export async function titleAiChat(turns, model) {
  const usable = (turns || []).filter((turn) => String(turn?.content || '').trim());
  if (!usable.some((turn) => turn.role === 'user')) return '';
  if (!model) return fallbackAiChatTitle(usable);
  const transcript = usable
    .slice(0, 6)
    .map((turn) => `${turn.role === 'user' ? 'User' : 'AI'}: ${String(turn.content).slice(0, 240)}`)
    .join('\n');
  try {
    const text = await streamChatCompletion({
      model,
      maxTokens: 40,
      messages: [
        {
          role: 'user',
          content: `Write a chat title in 3 to 6 words. No quotes. No period. Name the topic of this conversation.\n\n${transcript}`,
        },
      ],
    });
    const line = String(text || '')
      .split('\n')[0]
      .replace(/^["'`]+|["'`.]+$/g, '')
      .trim();
    if (!line) return fallbackAiChatTitle(usable);
    return line.slice(0, 80);
  } catch {
    return fallbackAiChatTitle(usable);
  }
}

/**
 * Fetch selected-app data and return hidden seed messages for the chat.
 */
export async function ingestAiChatContext(session, options = {}) {
  const apps = (options.apps || []).filter(Boolean);
  if (!apps.length) return prepareAiChatSession(options);
  const { context, summaries, errors } = await gatherAiChatContext(session, options);
  return {
    context,
    summaries,
    errors,
    seedMessages: buildSeedMessages(context),
  };
}

/**
 * Send a user question (and later follow-ups) against the ingested seed.
 */
export async function sendAiChatMessage({
  seedMessages,
  turns = [],
  userMessage,
  model,
  onDelta,
  signal,
  session,
  context,
  startDate,
  endDate,
  locationName,
  onLookup,
} = {}) {
  const question = String(userMessage || '').trim();
  if (!question) throw new Error('Enter a question.');
  if (!Array.isArray(seedMessages) || seedMessages.length === 0) {
    throw new Error('Wait for company or app data to finish loading, then try again.');
  }
  if (!model) throw new Error('Select an AI model.');

  const history = (turns || [])
    .filter((turn) => turn?.role === 'user' || turn?.role === 'assistant')
    .map((turn) => ({ role: turn.role, content: String(turn.content || '') }));

  let lookup = null;
  if (session?.token) {
    try {
      lookup = await lookupAiChatData(session, {
        question,
        context,
        startDate,
        endDate,
        locationName,
        history,
        model,
        onProgress: onLookup,
        signal,
      });
    } catch (error) {
      if (signal?.aborted || error?.name === 'AbortError') throw error;
      lookup = { error: error?.message || 'Lookup failed.' };
    }
  }

  const modelQuestion = lookup
    ? `${question}\n\nLookup:\n${JSON.stringify(lookup)}`
    : question;
  const messages = [...seedMessages, ...history, { role: 'user', content: modelQuestion }];
  const text = await streamChatCompletion({
    model,
    messages,
    onDelta,
    signal,
    maxTokens: 8192,
  });

  return {
    text,
    sources: lookup?.sources || [],
    turns: [...history, { role: 'user', content: question }, { role: 'assistant', content: text || '' }],
  };
}

