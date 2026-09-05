import { fetchBullionAuditStores, fetchBullionAudit } from './bullionAudit';
import { fetchStoreCashPosition } from './cashTill';
import { fetchInventoryMatrix, peekInventoryMatrix } from './inventory';
import { fetchTransferStores } from './locations';
import { streamChatCompletion } from './llmProviders';
import { fetchMetalTrends } from './metalTrends';
import { compactWebsitePrices, fetchWebsitePrices } from './websitePrices';
import { fetchCashPayments, summarizeCashByStore, summarizeCashTotals } from './payments';
import { fetchPremiumJewelryByStore } from './premiumJewelry';
import { loadStoreTasks } from './tasks';
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
  { key: 'accounting', label: 'Accounting', icon: 'calculator-outline', ingestible: false, usesDate: false },
  { key: 'trends', label: 'Trends', icon: 'trending-up-outline', ingestible: true, usesDate: true },
  { key: 'pricing', label: 'Pricing', icon: 'pricetag-outline', ingestible: true, usesDate: false },
  { key: 'bonuses', label: 'Bonuses', icon: 'gift-outline', ingestible: false, usesDate: false },
  { key: 'leaderboards', label: 'Leaderboards', icon: 'trophy-outline', ingestible: false, usesDate: false },
  { key: 'tasks', label: 'Tasks', icon: 'checkbox-outline', ingestible: true, usesDate: false },
  { key: 'police-report', label: 'Police Report', icon: 'shield-outline', ingestible: false, usesDate: false },
  { key: 'security', label: 'Security', icon: 'lock-closed-outline', ingestible: false, usesDate: false },
  { key: 'serphint', label: 'Serphint', icon: 'eye-outline', ingestible: false, usesDate: false },
  { key: 'supplies', label: 'Supplies', icon: 'bag-handle-outline', ingestible: false, usesDate: false },
  { key: 'employees', label: 'Employees', icon: 'people-outline', ingestible: false, usesDate: false },
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

function compactTrends(result, locationName) {
  const roundMetals = (bag) => {
    const next = {};
    for (const [metal, grams] of Object.entries(bag || {})) {
      next[metal] = roundQty(grams);
    }
    return next;
  };
  return {
    location: locationName || 'All locations',
    unit: result.unit || 'g',
    scanned: result.scanned,
    total: result.total,
    totals: {
      sold: roundMetals(result.totals?.sold),
      bought: roundMetals(result.totals?.bought),
    },
    days: (result.days || []).map((day) => ({
      date: day.date,
      sold: roundMetals(day.sold),
      bought: roundMetals(day.bought),
    })),
    warning: result.warning || undefined,
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

function compactTasks(tasksByStore, locationName) {
  const entries = Object.entries(tasksByStore || {});
  const filtered = locationName
    ? entries.filter(([store]) => namesMatch(store, locationName))
    : entries;
  return {
    location: locationName || 'All locations',
    stores: filtered.map(([store, tasks]) => ({
      store,
      tasks: (tasks || []).map((task) => ({
        text: task.text,
        done: Boolean(task.done),
      })),
    })),
  };
}

function trimContext(payload) {
  let text = JSON.stringify(payload);
  if (text.length <= MAX_CONTEXT_CHARS) return payload;

  const next = { ...payload, data: { ...payload.data } };
  for (const key of ['transactions', 'financials', 'inventory', 'fintrac', 'audit', 'trends', 'pricing']) {
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

  const needTx =
    companyMode || selected.includes('transactions') || selected.includes('fintrac');
  const needInv =
    companyMode || selected.includes('inventory') || selected.includes('transfer');

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

  if (companyMode) {
    data.company = {
      inventory: matrix
        ? compactInventoryOverview(matrix, location)
        : { error: 'Inventory did not load.' },
      activity: compactTxOverview(txRows, location),
    };
    summaries.push({
      key: 'company',
      label: 'Company',
      detail: location || 'All locations',
    });
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

  if (selected.includes('trends')) {
    mark('Loading metal trends…');
    const trendResult = await settled('Trends', () =>
      fetchMetalTrends(session, {
        startDate: range.startDate,
        endDate: range.endDate,
        storeName: location || undefined,
      }),
    );
    if (!trendResult.ok) {
      errors.push(trendResult.error);
      data.trends = { error: trendResult.error };
    } else {
      data.trends = compactTrends(trendResult.value, location);
      summaries.push({
        key: 'trends',
        label: 'Trends',
        detail: `${data.trends.scanned || 0} txns`,
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

  if (selected.includes('tasks')) {
    mark('Loading tasks…');
    const taskResult = await settled('Tasks', () => loadStoreTasks());
    if (!taskResult.ok) {
      errors.push(taskResult.error);
      data.tasks = { error: taskResult.error };
    } else {
      data.tasks = compactTasks(taskResult.value, location);
      summaries.push({
        key: 'tasks',
        label: 'Tasks',
        detail: `${data.tasks.stores?.length || 0} stores`,
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

function buildSeedMessages(context) {
  const companyMode = context?.selection?.mode === 'company';
  const intro = companyMode
    ? `You are Canada Gold's internal operations assistant. No apps are selected, so you have a company-wide overview: stock rollups by store (live snapshot) and sales/purchase totals for the selected dates.

Answer general questions about how the company or stores are doing (busy vs quiet, which locations have stock, maple availability at a high level, sales vs purchases). Be concrete with store names and totals.
If the user needs SKU-level inventory, individual SO/PO rows, till counts, FINTRAC, or metal grams, tell them to select that app in the list.
Do not invent numbers that are not in the JSON.`
    : `You are Canada Gold's internal operations assistant. Answer from the ingested JSON only.

Rules:
- Be concrete: cite product names/SKUs, quantities, stores, dates, SO#/PO#, and dollar amounts.
- Gold Maple Leaf products are often labeled GML, Maplegram, Maple Leaf, or MLBD. Silver Maples are often SML.
- Inventory is a live snapshot, not historical for the date range. qty 0 means none on hand at that store.
- If the selection is missing the app, location, or date needed, say what to add. Do not invent stock or transactions.
- Keep answers tight. Use short markdown lists when listing products.`;

  return [
    {
      role: 'user',
      content: `${intro}

Ingested data:
${JSON.stringify(context)}`,
    },
    {
      role: 'assistant',
      content: companyMode
        ? 'Ready. Ask about how the company or stores are doing, or select apps for deeper data.'
        : 'Ready. Ask about inventory, transactions, cash, or anything else in this selection and I will answer from the ingested data.',
    },
  ];
}

/**
 * Fetch selected-app data and return hidden seed messages for the chat.
 */
export async function ingestAiChatContext(session, options = {}) {
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

  const messages = [...seedMessages, ...history, { role: 'user', content: question }];
  const text = await streamChatCompletion({
    model,
    messages,
    onDelta,
    signal,
    maxTokens: 8192,
  });

  return {
    text,
    turns: [...history, { role: 'user', content: question }, { role: 'assistant', content: text || '' }],
  };
}

