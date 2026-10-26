import { BONUS_ACCESS_DENIED, canViewBonusReviewData, posSystemsFromSession } from './auth';
import { fetchAureusEmployees } from './aureusEmployees';
import { fetchBullionAuditStores, fetchBullionAudit } from './bullionAudit';
import { aiPrivacyBlurb, employeeAllowedByScope, scopesFromSession } from './aiScopes';
import { bonusBoardAccessDenied, buildBonusBoard, canViewAllBonusCounts, filterReviewsForViewer } from './bonuses';
import { AUDIT_CASH_STORES, fetchStoreCashPosition, QUEBEC_STORES } from './cashTill';
import { listEmailContacts } from './emails';
import { getGmailMessage, listGmailAccounts, listGmailMailbox } from './gmail';
import { contactName, conversationTitle, listDmInbox, listDmMessages } from './messages';
import { fetchInventoryMatrix, peekInventoryMatrix } from './inventory';
import { fetchTransferStores } from './locations';
import { streamChatCompletion } from './llmProviders';
import { appendCompanyInstructions, loadAiInstruction } from './aiInstructions';
import { compactWebsitePrices, fetchWebsitePrices } from './websitePrices';
import { fetchCashPayments, fetchDebitPayments, summarizeCashByStore, summarizeCashTotals } from './payments';
import { fetchPremiumJewelryByStore } from './premiumJewelry';
import {
  fetchAllGoogleStoreReviews,
  GOOGLE_STORE_PLACES,
  summarizeReviews,
} from './googleReviews';
import { listTriageErrorFacts } from './employeeMetrics';
import {
  collapseNestedShifts,
  fetchHoursSummary,
  fetchRipplingCsvFiles,
  fetchShiftReportCoverage,
  fetchShiftRolesBetween,
  fetchTimeEntriesBetween,
  formatMinutes,
  formatShiftDate,
  formatShiftSpan,
  loadHoursFeedStatus,
  personNameKeys,
  shiftCoversNow,
  syncHoursFeed,
  torontoToday,
} from './ripplingTime';
import { fetchTriageInsightSnapshot, filterInsightStores } from './triageInsights';
import {
  fetchPhoneHistory,
  fetchPhoneInbox,
  inboundCallBreakdown,
  phoneHistoryNeeded,
} from './phoneCalls';
import { listTeams } from './teams';
import {
  buildHomeStoreSummaries,
  FINTRAC_CASH_THRESHOLD,
  fetchTransactionsAcrossPos,
  formatDateParam,
  HOME_FAST_EXTRAS,
  HOME_STORES,
  isFintracCash,
  parseDateParam,
} from './transactions';

export const AI_CHAT_APPS = [
  { key: 'trove', label: 'Trove', icon: 'file-tray-full-outline', ingestible: false, usesDate: false },
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
  { key: 'tasks', label: 'Tasks', icon: 'checkbox-outline', ingestible: false, usesDate: false },
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
const MAX_TX_SAMPLE = 16;
const MAX_PAYMENT_ROWS = 80;
const MAX_FINTRAC_ROWS = 40;
const MAX_PAYMENT_DAYS = 7;
const PACE_LOOKBACK_DAYS = 28;
const PACE_MIN_DAYS = 4;

const STORE_ALIASES = {
  'quebec city': 'Quebec',
  'ville de quebec': 'Quebec',
  'qc': 'Quebec',
  'richmond': 'Richmond Hill',
  'sauga': 'Mississauga',
};

const KNOWN_STORES = [
  ...HOME_STORES,
  ...QUEBEC_STORES,
  'Quebec City',
  'Halifax',
  'Carlingwood',
  'Gloucester',
  'Calgary North',
  'Calgary South',
  'Calgary SW',
  'Edmonton',
  'Edmonton West',
  'Surrey',
  'Vancouver',
  'Winnipeg',
  'Canadian Coin & Currency',
  'Portland',
  'Seattle',
];

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

function cadLabel(value) {
  if (!Number.isFinite(value)) return null;
  const formatted = Math.abs(value).toLocaleString('en-CA', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${value < 0 ? '-' : ''}$${formatted}`;
}

function canonicalizeStoreName(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return '';
  const alias = STORE_ALIASES[trimmed.toLowerCase()];
  if (alias) return alias;
  const known = KNOWN_STORES.find((store) => namesMatch(store, trimmed));
  return known || trimmed;
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function storeNameMatches(rowName, wanted) {
  if (namesMatch(rowName, wanted)) return true;
  const a = String(rowName || '')
    .trim()
    .toLowerCase();
  const b = String(wanted || '')
    .trim()
    .toLowerCase();
  if (!a || !b) return false;
  return a.includes(b) || b.includes(a);
}

function addCalendarDays(date, days) {
  const next = parseDateParam(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function locationFromQuestion(question) {
  const text = String(question || '');
  if (!text.trim()) return null;
  if (/\bquebec stores?\b/i.test(text)) return null;
  const ranked = [...KNOWN_STORES].sort((a, b) => b.length - a.length);
  for (const store of ranked) {
    if (new RegExp(`\\b${escapeRegExp(store)}\\b`, 'i').test(text)) {
      return canonicalizeStoreName(store);
    }
  }
  for (const [alias, canonical] of Object.entries(STORE_ALIASES)) {
    if (alias.length < 3) continue;
    if (new RegExp(`\\b${escapeRegExp(alias)}\\b`, 'i').test(text)) return canonical;
  }
  return null;
}

export function dateRangeFromQuestion(question, fallbackStart, fallbackEnd) {
  const text = String(question || '');
  const today = parseDateParam(new Date());
  const fallback = {
    startDate: formatDateParam(fallbackStart || today),
    endDate: formatDateParam(fallbackEnd || today),
    label: null,
    explicit: false,
  };

  if (/\b(today|tonight|this afternoon|this morning|this evening)\b/i.test(text)) {
    const day = formatDateParam(today);
    return { startDate: day, endDate: day, label: 'today', explicit: true };
  }
  if (/\byesterday\b/i.test(text)) {
    const day = formatDateParam(addCalendarDays(today, -1));
    return { startDate: day, endDate: day, label: 'yesterday', explicit: true };
  }
  if (/\b(this week|past week|last 7 days|the week)\b/i.test(text)) {
    return {
      startDate: formatDateParam(addCalendarDays(today, -6)),
      endDate: formatDateParam(today),
      label: 'this week',
      explicit: true,
    };
  }
  if (/\blast week\b/i.test(text)) {
    return {
      startDate: formatDateParam(addCalendarDays(today, -13)),
      endDate: formatDateParam(addCalendarDays(today, -7)),
      label: 'last week',
      explicit: true,
    };
  }
  if (/\bthis month\b/i.test(text)) {
    return {
      startDate: formatDateParam(new Date(today.getFullYear(), today.getMonth(), 1)),
      endDate: formatDateParam(today),
      label: 'this month',
      explicit: true,
    };
  }
  return fallback;
}

function isStoreActivityQuestion(question) {
  return /\b(how did we|how have we|how'd we|how're we|how are we|how we do|sales?|purchases?|transactions?|busy|volume|buy(?:ing)?|sell(?:ing)?)\b/i.test(
    String(question || ''),
  );
}

function wantsTxDetail(question) {
  return /\b(list|each|every|which (ones?|deals?)|show me|walk me through|\bso\s*#|\bpo\s*#)\b/i.test(
    String(question || ''),
  );
}

export function resolveQuestionScope(question, { startDate, endDate, locationName, lastScope } = {}) {
  const followUp = isFollowUp(question);
  const askedLocation = locationFromQuestion(question);
  const askedDates = dateRangeFromQuestion(question, startDate, endDate);
  const selectedLocation = String(locationName || '').trim();
  const selected =
    selectedLocation && selectedLocation !== 'All locations' ? selectedLocation : null;

  const location =
    askedLocation || (followUp ? lastScope?.location : null) || selected || null;

  let rangeStart = startDate;
  let rangeEnd = endDate;
  let dateLabel = lastScope?.dateLabel || null;

  if (askedDates.explicit) {
    rangeStart = askedDates.startDate;
    rangeEnd = askedDates.endDate;
    dateLabel = askedDates.label;
  } else if (followUp && lastScope?.startDate && lastScope?.endDate) {
    rangeStart = lastScope.startDate;
    rangeEnd = lastScope.endDate;
    dateLabel = lastScope.dateLabel || null;
  } else if (isStoreActivityQuestion(question)) {
    const today = formatDateParam(new Date());
    rangeStart = today;
    rangeEnd = today;
    dateLabel = 'today';
  }

  return {
    location,
    startDate: formatDateParam(rangeStart || new Date()),
    endDate: formatDateParam(rangeEnd || new Date()),
    dateLabel,
    allStores: wantsAllStores(question) && !location,
    txRowLimit: wantsTxDetail(question) ? MAX_TX_ROWS : MAX_TX_SAMPLE,
  };
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
  const names = (Array.isArray(locationName) ? locationName : [locationName])
    .map((name) => String(name || '').trim())
    .filter(Boolean);
  if (!names.length) return rows || [];
  return (rows || []).filter((row) => names.some((name) => storeNameMatches(row?.[nameKey], name)));
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
    // Every label on the product travels with the row (metal, stock priority,
    // form) so a chart can roll stock up by any of them.
    ranked.push({
      maple,
      total,
      item: {
        name: row.name,
        sku: row.sku || undefined,
        metal: metalLabel(row.metal),
        form: looksLikeMaple(row.name, row.sku) ? 'Maple Leaf' : /\b(bar|wafer|ingot)\b/i.test(`${row.name} ${row.sku}`) ? 'Bar' : /\b(coin|round|eagle|krugerrand|philharmonic|britannia)\b/i.test(`${row.name} ${row.sku}`) ? 'Coin' : 'Other',
        priority: row.priority ? String(row.priority).replace(/^\w/, (char) => char.toUpperCase()) : 'Unranked',
        total: roundQty(total),
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
    note: 'Live stock snapshot — not historical for the selected date range. qty 0 means none on hand. Each item carries metal, form (Bar / Coin / Maple Leaf), and stock priority; roll the items up by any of those with draw_chart or show_table groupBy.',
    location: locationName || 'All locations',
    stores: stores.map((store) => store.name),
    itemCount: Math.min(ranked.length, MAX_INVENTORY_ITEMS),
    omittedZeroQtySkus: omittedZero,
    truncated: truncated || undefined,
    items: ranked.slice(0, MAX_INVENTORY_ITEMS).map((entry) => entry.item),
  };
}

function summarizePaymentMix(rows) {
  const mix = new Map();
  for (const row of rows || []) {
    const method = String(row.paymentMethodLabel || row.paymentMethods || 'Unknown').trim() || 'Unknown';
    const type = row.type === 'purchase' ? 'PO' : 'SO';
    const key = `${type}|${method}`;
    let entry = mix.get(key);
    if (!entry) {
      entry = { type, method, count: 0, amount: 0 };
      mix.set(key, entry);
    }
    entry.count += 1;
    entry.amount += money(row.amount);
  }
  return Array.from(mix.values())
    .map((entry) => ({
      ...entry,
      amount: money(entry.amount),
      amountLabel: cadLabel(money(entry.amount)),
    }))
    .sort((a, b) => b.amount - a.amount || b.count - a.count);
}

function compactTransactions(rows, locationName, { dates, rowLimit = MAX_TX_SAMPLE, baseline } = {}) {
  const filtered = filterByLocation(rows, locationName);
  const summary = summarizeTx(filtered);
  const overview = compactTxOverview(filtered, locationName);
  const limit = Math.max(1, Number(rowLimit) || MAX_TX_SAMPLE);
  const truncated = filtered.length > limit;
  return {
    note: 'saleCount, purchaseCount, txCount, amounts, byStore, and paymentMix are complete for this location and date range. rows is only a sample. Never count the rows array. Use byStore.pace before calling a day busy or heavy.',
    dates: dates || undefined,
    location: locationName || 'All locations',
    saleCount: summary.saleCount,
    purchaseCount: summary.purchaseCount,
    txCount: summary.txCount,
    soAmount: summary.soAmount,
    poAmount: summary.poAmount,
    soAmountLabel: cadLabel(summary.soAmount),
    poAmountLabel: cadLabel(summary.poAmount),
    totalAmount: summary.totalAmount,
    totalAmountLabel: cadLabel(summary.totalAmount),
    byStore: withStorePace(overview.byStore, filtered, baseline, dates),
    paymentMix: summarizePaymentMix(filtered),
    truncated: truncated || undefined,
    shownRows: Math.min(filtered.length, limit),
    rows: filtered.slice(0, limit).map(compactTxRow),
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
    .map((entry) => {
      const soAmount = money(entry.soAmount);
      const poAmount = money(entry.poAmount);
      return {
        ...entry,
        soAmount,
        poAmount,
        soAmountLabel: cadLabel(soAmount),
        poAmountLabel: cadLabel(poAmount),
        txCount: entry.saleCount + entry.purchaseCount,
        totalAmount: money(soAmount + poAmount),
      };
    })
    .sort((a, b) => a.store.localeCompare(b.store, undefined, { sensitivity: 'base' }));

  return {
    note: 'Complete store activity for the selected dates. Use these counts; do not recount rows.',
    location: locationName || 'All locations',
    ...summarizeTx(filtered),
    byStore,
  };
}

function median(values) {
  const nums = (values || []).filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!nums.length) return null;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
}

function roundPace(value) {
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 10) / 10;
}

function paceWord(actual, typical) {
  if (!Number.isFinite(actual) || !Number.isFinite(typical) || typical <= 0) return null;
  const ratio = actual / typical;
  if (ratio < 0.55) return 'quiet';
  if (ratio < 0.8) return 'light';
  if (ratio <= 1.25) return 'typical';
  if (ratio <= 1.7) return 'busy';
  return 'heavy';
}

function mixWord(actualShare, typicalShare) {
  if (!Number.isFinite(actualShare) || !Number.isFinite(typicalShare)) return null;
  const delta = actualShare - typicalShare;
  if (delta >= 0.18) return 'purchase-heavy';
  if (delta <= -0.18) return 'sales-heavy';
  return 'usual mix';
}

function storeDayBuckets(rows) {
  const map = new Map();
  for (const row of rows || []) {
    const store = String(row.storeName || '').trim();
    if (!store || store === '—') continue;
    const day = formatDateParam(row.date);
    const key = `${store.toLowerCase()}|${day}`;
    let entry = map.get(key);
    if (!entry) {
      entry = { store, day, saleCount: 0, purchaseCount: 0 };
      map.set(key, entry);
    }
    if (row.type === 'purchase') entry.purchaseCount += 1;
    else entry.saleCount += 1;
  }
  for (const entry of map.values()) {
    entry.txCount = entry.saleCount + entry.purchaseCount;
    entry.purchaseShare = entry.txCount ? entry.purchaseCount / entry.txCount : 0;
  }
  return map;
}

function buildStorePaceBaseline(rows, excludeStart, excludeEnd) {
  const exclude = new Set(eachDateKey(excludeStart, excludeEnd));
  const byStore = new Map();
  for (const entry of storeDayBuckets(rows).values()) {
    if (exclude.has(entry.day) || entry.txCount <= 0) continue;
    const key = entry.store.toLowerCase();
    let list = byStore.get(key);
    if (!list) {
      list = { store: entry.store, days: [] };
      byStore.set(key, list);
    }
    list.days.push(entry);
  }

  const out = new Map();
  for (const { store, days } of byStore.values()) {
    if (days.length < PACE_MIN_DAYS) {
      out.set(store.toLowerCase(), { store, enough: false, sampleDays: days.length });
      continue;
    }
    out.set(store.toLowerCase(), {
      store,
      enough: true,
      sampleDays: days.length,
      typicalTx: roundPace(median(days.map((day) => day.txCount))),
      typicalPurchases: roundPace(median(days.map((day) => day.purchaseCount))),
      typicalSales: roundPace(median(days.map((day) => day.saleCount))),
      typicalPurchaseShare: roundPace(median(days.map((day) => day.purchaseShare))),
    });
  }
  return out;
}

function findStorePace(baseline, storeName) {
  if (!storeName || !baseline) return null;
  const exact = baseline.get(String(storeName).toLowerCase());
  if (exact) return exact;
  for (const [key, entry] of baseline.entries()) {
    if (storeNameMatches(entry.store, storeName) || storeNameMatches(storeName, key)) return entry;
  }
  return null;
}

function paceForStore(current, baseline, { dayCount = 1 } = {}) {
  if (!baseline?.enough) {
    return {
      enough: false,
      sampleDays: baseline?.sampleDays || 0,
      note: 'Not enough recent open days at this store to say whether the day was quiet or heavy.',
    };
  }
  const divisor = Math.max(1, dayCount);
  const daily = {
    txCount: current.txCount / divisor,
    purchaseCount: current.purchaseCount / divisor,
    saleCount: current.saleCount / divisor,
  };
  const purchaseShare = current.txCount ? current.purchaseCount / current.txCount : 0;
  return {
    enough: true,
    versus: baseline.store,
    day: paceWord(daily.txCount, baseline.typicalTx),
    purchases: paceWord(daily.purchaseCount, baseline.typicalPurchases),
    sales: paceWord(daily.saleCount, baseline.typicalSales),
    mix: mixWord(purchaseShare, baseline.typicalPurchaseShare),
    typicalTx: baseline.typicalTx,
    typicalPurchases: baseline.typicalPurchases,
    typicalSales: baseline.typicalSales,
    typicalPurchaseShare: baseline.typicalPurchaseShare,
    sampleDays: baseline.sampleDays,
    note: `Compared with this store's last ${baseline.sampleDays} open days. Typical is ${baseline.typicalTx} tx / day.`,
  };
}

function openDayCount(rows, storeName, startDate, endDate) {
  const days = new Set();
  for (const row of filterByLocation(rows, storeName)) {
    const day = formatDateParam(row.date);
    if (day >= startDate && day <= endDate) days.add(day);
  }
  return Math.max(1, days.size);
}

function withStorePace(stores, rows, baseline, dates) {
  const startDate = dates?.startDate;
  const endDate = dates?.endDate;
  const rangeDays = startDate && endDate ? eachDateKey(startDate, endDate).length : 1;
  return (stores || []).map((store) => {
    const dayCount = rangeDays > 1 ? openDayCount(rows, store.store, startDate, endDate) : 1;
    return {
      ...store,
      pace: paceForStore(store, findStorePace(baseline, store.store), { dayCount }),
    };
  });
}

function paceLookbackRange(startDate) {
  const periodStart = parseDateParam(startDate || new Date());
  const end = addCalendarDays(periodStart, -1);
  const start = addCalendarDays(end, -(PACE_LOOKBACK_DAYS - 1));
  return { startDate: formatDateParam(start), endDate: formatDateParam(end) };
}

const paceRowCache = new Map();
const PACE_CACHE_MS = 15 * 60 * 1000;

async function fetchPaceRows(session, lookback) {
  const key = `${lookback.startDate}|${lookback.endDate}`;
  const hit = paceRowCache.get(key);
  if (hit && hit.expires > Date.now()) return hit.rows;
  const result = await fetchTransactionsAcrossPos(session, {
    startDate: lookback.startDate,
    endDate: lookback.endDate,
    includePurchases: true,
    extras: HOME_FAST_EXTRAS,
  });
  const rows = result.rows || [];
  paceRowCache.set(key, { rows, expires: Date.now() + PACE_CACHE_MS });
  return rows;
}

function compactHomeBoard(rows, locationName, dates, baseline) {
  const pinned = [...HOME_STORES, ...QUEBEC_STORES, ...(rows || []).map((row) => row.storeName)];
  const board = buildHomeStoreSummaries(rows, {
    includeExtras: true,
    pinnedStores: pinned,
  });
  const filtered = locationName
    ? board.filter((row) => storeNameMatches(row.store, locationName))
    : board.filter((row) => row.txCount > 0);
  const stores = withStorePace(
    filtered.map((row) => ({
      store: row.store,
      saleCount: row.saleCount,
      purchaseCount: row.purchaseCount,
      txCount: row.txCount,
      soAmount: money(row.soAmount),
      poAmount: money(row.poAmount),
      soAmountLabel: cadLabel(money(row.soAmount)),
      poAmountLabel: cadLabel(money(row.poAmount)),
    })),
    rows,
    baseline,
    dates,
  );
  return {
    note: 'Live Home scoreboard. saleCount and purchaseCount match the Home screen. pace.day and pace.mix are relative to this store only — never call a day heavy unless pace.day says heavy.',
    dates: dates || undefined,
    location: locationName || 'All locations',
    ...summarizeTx(filterByLocation(rows, locationName)),
    stores,
  };
}

function compactPeopleFromTx(rows, locationName, key, limit = 24) {
  const filtered = filterByLocation(rows, locationName);
  const byName = new Map();
  for (const row of filtered) {
    const name = String(row[key] || '').trim();
    if (!name || name === '—') continue;
    let entry = byName.get(name);
    if (!entry) {
      entry = { name, saleCount: 0, purchaseCount: 0, soAmount: 0, poAmount: 0 };
      byName.set(name, entry);
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
  return Array.from(byName.values())
    .map((entry) => ({
      ...entry,
      soAmount: money(entry.soAmount),
      poAmount: money(entry.poAmount),
      txCount: entry.saleCount + entry.purchaseCount,
      totalAmount: money(entry.soAmount + entry.poAmount),
    }))
    .sort((a, b) => b.txCount - a.txCount || b.totalAmount - a.totalAmount)
    .slice(0, limit);
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
    // One row per payment with every label the ledger record carries, so the
    // list can be rolled up by method, till, direction, currency, or store.
    rows: filtered.slice(0, MAX_PAYMENT_ROWS).map((row) => ({
      date: row.dateLabel || row.date,
      store: row.storeName,
      type: row.type,
      amount: money(row.amount),
      customer: row.customerName,
      ref: row.reference,
      method: row.paymentType,
      till: row.tillName && row.tillName !== '—' ? row.tillName : 'No till',
      currency: row.currency || 'CAD',
      status: row.status || undefined,
      system: row.systemLabel || undefined,
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
    test: /\b(transactions?|sales?|purchases?|how did we|how have we|how'd we|how're we|how are we|how we do|busy|volume|\bso\s*#|\bpo\s*#|buy(?:ing)?|sell(?:ing)?)\b/i,
    present: (data) =>
      Number.isFinite(data?.transactions?.txCount) || Array.isArray(data?.transactions?.rows),
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
  {
    app: 'bonuses',
    test: /\b(bonus|bonuses|payout|email rate)\b/i,
    present: (data) => data?.bonuses && !data.bonuses.error,
  },
  {
    app: 'reviews',
    test: /\b(reviews?|google|stars?|rating)\b/i,
    present: (data) => data?.reviews && !data.reviews.error,
  },
  {
    app: 'emails',
    test: /\b(e-?mails?|inbox(?:es)?|mailbox(?:es)?|unread mail|gmail)\b/i,
    present: (data) => data?.emails && !data.emails.error,
  },
  {
    app: 'messages',
    test: /\b(direct messages?|dms?|chats?|messaged me|texted me|group chat)\b/i,
    present: (data) => data?.messages && !data.messages.error,
  },
  {
    app: 'teams',
    test: /\b(teams?)\b/i,
    present: (data) => data?.teams && !data.teams.error,
  },
  {
    app: 'calendar',
    test: /\b(calendar|hours|clocked in|who's in|who is in|shifts?|timesheet|schedule[ds]?|roster(ed)?|rippling|working (today|tomorrow|tonight|this weekend|next week)|set to work)\b/i,
    present: (data) => data?.calendar && !data.calendar.error,
  },
  {
    app: 'contacts',
    test: /\b(contacts?|directory|who's online|who is online)\b/i,
    present: (data) => data?.contacts && !data.contacts.error,
  },
  {
    app: 'phone',
    test: /\b(phone|answering rate|answer rate|inbound|missed calls?|called back|callback|voicemail|call(?:s|ing)? ratio)\b/i,
    present: (data) => data?.phone && !data.phone.error,
  },
  {
    app: 'home',
    test: /\b(home board|scoreboard|how did we|how have we|how'd we)\b/i,
    present: (data) => Array.isArray(data?.home?.stores),
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
    note: 'Some sample rows were dropped to fit the model window. saleCount, purchaseCount, amounts, and byStore are still complete.',
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
  { apps = [], startDate, endDate, locationName, onProgress, txRowLimit } = {},
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
    selected.includes('transactions') || selected.includes('fintrac') || selected.includes('home');
  const needInv = selected.includes('inventory') || selected.includes('transfer');

  let txRows = [];
  let matrix = null;

  let paceBaseline = new Map();
  if (needTx) {
    mark('Loading transactions…');
    const lookback = paceLookbackRange(range.startDate);
    const [txResult, paceResult] = await Promise.all([
      settled('Transactions', () =>
        fetchTransactionsAcrossPos(session, {
          startDate: range.startDate,
          endDate: range.endDate,
          includePurchases: true,
        }),
      ),
      settled('Store pace', () => fetchPaceRows(session, lookback)),
    ]);
    if (!txResult.ok) {
      errors.push(txResult.error);
    } else {
      txRows = txResult.value.rows || [];
      if (txResult.value.warning) errors.push(txResult.value.warning);
    }
    if (paceResult.ok) {
      paceBaseline = buildStorePaceBaseline(paceResult.value || [], range.startDate, range.endDate);
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

  if (selected.includes('transactions') || selected.includes('home')) {
    const dates = { startDate: range.startDate, endDate: range.endDate };
    data.home = compactHomeBoard(txRows, location, dates, paceBaseline);
    data.transactions = compactTransactions(txRows, location, {
      dates,
      rowLimit: txRowLimit || MAX_TX_SAMPLE,
      baseline: paceBaseline,
    });
    data.transactions.staff = compactPeopleFromTx(txRows, location, 'employeeName');
    data.transactions.customers = compactPeopleFromTx(txRows, location, 'customerName');
    summaries.push({
      key: 'transactions',
      label: 'Transactions',
      detail: `${data.home.txCount ?? data.transactions.txCount} txns`,
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
    firstName: firstNameOfSession(session) || undefined,
    data,
    errors: errors.filter(Boolean),
  });

  return { context, summaries, errors: errors.filter(Boolean) };
}

const ANSWER_STYLE = `How to answer:
- Write like a sharp, kind colleague who just looked it up. Complete sentences, natural contractions, a little warmth. Not a briefing, not a text-message shrug.
- Lead with the answer in the first sentence. Then add the useful color in the same breath — counts, dollar totals, and how the mix felt.
- No markdown: no **bold**, headings, tables, code, or bullet/numbered lists. Do not use "Store — $amount" report lines. The one exception is tasks, to-dos, or outstanding requests from Lookup.emails and Lookup.messages: give those as a short numbered list in plain text, one line each with who asked, what they need, which inbox or chat it came through, and when, then one sentence on what is already handled.
- Do not add a definition footer, methodology note, or recap of what a field means. The person already knows.
- If you know their first name, use it the way a colleague would: once in a greeting, or when asking them a question, or when a finding is surprising. Skip it on most data answers so it does not sound forced. Never start every reply with their name.
- No sign-off, no "let me know if you need anything else."
- Do not tell the user to open another app or screen.
- Use only numbers that appear in the JSON. If a store has an error, say it did not load. Never treat a missing store as $0.
- For how a store did, prefer Lookup.home.stores. Those sale and purchase counts match the Home screen. If home is missing, use Lookup.transactions.saleCount, purchaseCount, txCount, soAmountLabel, and poAmountLabel. Never count the rows array, and never say the list is truncated unless you were asked for a full list and Lookup.transactions.truncated is true.
- Pace words are store-specific. 13 transactions can be heavy at Laval and quiet at Toronto. Only use quiet, light, typical, busy, or heavy if that store's pace.day is that word. Only say purchase-heavy or sales-heavy if pace.mix is that word. Purchases outnumbering sales is not "purchase-heavy" when mix is "usual mix". If pace.enough is false, stick to the counts and do not guess whether the day was big.
- Quote the dollar labels exactly (soAmountLabel, poAmountLabel, currentCadLabel). If they asked about today, answer for Lookup.scope dates only — do not invent a weekly total to explain a mismatch.
- For cash tills, use Lookup.tills.highest, Lookup.tills.lowest, and Lookup.tills.ranking. Quote currentCadLabel exactly. Mention every loaded store in the prose. physicalCad is a staff count and may be null.

Sounds like a person:
Laval had a typical day for them — 13 transactions, 8 purchases and 5 sales. That's about their usual mix, purchases $4,384.99 and sales $2,336.20.

Montreal has the most in Till 1 right now, $X. Quebec is the lowest at $Y. After that it's Toronto $A, Richmond Hill $B, Mississauga $C, Hamilton $D, and Laval $E.

Does not sound like a person:
Yeah, this pull is only showing today and it's truncated across all stores, so I'm only seeing 5 Laval rows.

**Montreal** currently has the most cash in Till 1 at **$X**, and **Quebec** has the least at **$Y**.

- Montreal — $X
- Quebec — $Y`;

const DATA_SOURCES = [
  { key: 'home', label: 'Home', hint: 'Live Home scoreboard: complete sale and purchase counts by store for the asked dates.' },
  { key: 'tills', label: 'Cash tills', hint: 'Live Till 1 CAD and USD by store. Current, highest, and lowest cash till or drawer.' },
  { key: 'inventory', label: 'Inventory', hint: 'Live SKU quantities by store, including maple leaf products.' },
  { key: 'transactions', label: 'Transactions', hint: 'Sales and purchases, with complete counts, staff, customers, and a sample of rows.' },
  { key: 'fintrac', label: 'FINTRAC', hint: 'Cash deals at or above $10,000.' },
  { key: 'financials', label: 'Financials', hint: 'Cash payment totals in and out. Not the till balance.' },
  { key: 'debit', label: 'Debit', hint: 'Debit and Interac payments.' },
  { key: 'pricing', label: 'Pricing', hint: 'Website buy and sell metal prices.' },
  { key: 'transfer', label: 'Transfer', hint: 'Store names and addresses for transfers.' },
  { key: 'audit', label: 'Audit', hint: 'Bullion count variances for one named store.' },
  { key: '100-ways', label: '100 Ways', hint: 'Premium jewelry purchases by store.' },
  { key: 'employees', label: 'Employees', hint: 'POS staff directory: name, role, and default store.' },
  { key: 'bonuses', label: 'Bonuses', hint: 'Review and email bonus payouts by store, as one total per store for the asked dates. Payouts over time or per person are query_metrics (bonusPayout, groupBy date, week, month, or employee).' },
  { key: 'reviews', label: 'Reviews', hint: 'Live Google review counts and star averages by store for the asked dates. Reviews over time are query_metrics (reviewsReceived, avgRating).' },
  { key: 'emails', label: 'Emails', hint: 'The signed-in user\'s own Google inboxes from the Emails app (every inbox they connected): recent messages with sender, subject, date, and body, plus recent sent mail. Use for tasks, outstanding requests, follow-ups, and "what do I need to do".' },
  { key: 'messages', label: 'Direct Messages', hint: 'The signed-in user\'s own direct messages: recent conversations with teammates and teams, with the message text. Use for requests teammates made in chat, promises, and open follow-ups.' },
  { key: 'teams', label: 'Teams', hint: 'Team names, members, and intake counts.' },
  { key: 'calendar', label: 'Calendar', hint: 'Rippling, read from the latest report files the hours feed imported (the result names each file and when it arrived): who is clocked in right now, the shift schedule by day (who is set to work today, tomorrow, or on any date, with role and shift times), hours worked this week and last week, and hoursInRange — punched hours per person for the startDate–endDate you pass (a week, a month, a pay period). Pass the asked dates as startDate and endDate for schedule and hours questions; future dates are fine for the schedule.' },
  { key: 'contacts', label: 'Contacts', hint: 'Staff directory with store, team, and who is online.' },
  { key: 'phone', label: 'Phone', hint: 'Inbound answering rate by store, including first-ring answers, missed calls later recovered by callback, later answered inbound, still missed, and voicemail. Includes per-day rows (rate null on days with no calls) when one store or a week or less is asked; longer trends are query_metrics.' },
  { key: 'triage', label: 'Triage', hint: 'Purchase evaluation accuracy by store and employee, error types, product kinds, error counts, and the dollar value of each error (amount — the same Amount column as the Triage app) in the asked dates. Totals or value per person, store, or day are query_metrics (errorValue, evaluationErrors).' },
];

const SOURCE_KEYS = new Set(DATA_SOURCES.map((source) => source.key));
const GATHER_APPS = new Set([
  'home',
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
const LIVE_SOURCES = new Set([
  'home',
  'tills',
  'transactions',
  'fintrac',
  'financials',
  'debit',
  'calendar',
  'emails',
  'messages',
  'reviews',
  'phone',
]);
const sourceCache = new Map();
const SOURCE_CACHE_MS = 45 * 1000;
const SOURCE_CACHE_STABLE_MS = 3 * 60 * 1000;

function cacheGet(key, { fresh } = {}) {
  if (fresh) {
    sourceCache.delete(key);
    return null;
  }
  const hit = sourceCache.get(key);
  if (!hit) return null;
  if (hit.expires < Date.now()) {
    sourceCache.delete(key);
    return null;
  }
  return hit.value;
}

function cacheSet(key, value, source) {
  if (!value || value.error) return;
  const ttl = LIVE_SOURCES.has(source) ? SOURCE_CACHE_MS : SOURCE_CACHE_STABLE_MS;
  sourceCache.set(key, { value, expires: Date.now() + ttl });
}

function sourceCacheKey(source, scope) {
  return [
    source,
    scope.startDate || '',
    scope.endDate || '',
    scope.location || '*',
    scope.tillDate || '',
    scope.tag || '',
  ].join('|');
}

function wantsTasks(question) {
  return /\b(tasks?|to-?dos?|outstanding|pending|follow[- ]?ups?|waiting on|action items?|owe|asked me|requests? (?:i|that i|i still)|need(?:s)? (?:a |my )?(?:reply|response|answer)|what do i (?:need|have) to do|on my plate)\b/i.test(
    String(question || ''),
  );
}

const PRIVATE_TOPIC =
  "(?:e-?mails?|inbox(?:es)?|mail(?:box)?|messages?|dms?|chats?|conversations?|tasks?|to-?dos?|requests?|follow[- ]?ups?|pay(?:cheques?|checks?|roll|slips?|ments?)?|salary|salaries|wages?|bonus(?:es)?|payouts?|earnings|commissions?)";
const PRIVATE_NAME_STOP = new Set(
  [
    ...KNOWN_STORES,
    'I', 'My', 'Me', 'Mine', 'You', 'Your', 'Our', 'Their', 'The', 'This', 'That', 'These', 'Those', 'What', 'Which', 'Who', 'Whose',
    'Any', 'All', 'Some', 'Each', 'Every', 'Everyone', 'Anyone', 'Someone', 'Nobody', 'Today', 'Tomorrow', 'Yesterday',
    'Canada', 'Gold', 'Google', 'Gmail', 'Team', 'Teams', 'Store', 'Stores', 'Staff', 'Customer', 'Customers', 'Company',
    'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
    'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December',
  ].map((word) => word.toLowerCase()),
);

/**
 * A question that names another person next to a private topic ("Julie's
 * emails", "what does Tom owe", "bonus for Sam") gets a note the model must
 * follow. The loaders can only ever return the signed-in user's own mail and
 * chats anyway; this makes the refusal explicit instead of leaving the model
 * to improvise, and reminds it that pay is role-gated.
 */
export function privateScopeNote(question, session) {
  const text = String(question || '');
  if (!text.trim()) return '';
  const first = firstNameOfSession(session).toLowerCase();
  const patterns = [
    // "Julie's tasks", "Tom's inbox"
    new RegExp(`\\b([A-Z][a-z]+)(?:'s|’s)\\s+(?:\\w+\\s+){0,2}?${PRIVATE_TOPIC}\\b`, 'g'),
    // "does Julie have any outstanding requests"
    new RegExp(`\\b[Dd](?:oes|o|id)\\s+([A-Z][a-z]+)\\s+(?:have|has|got|get|owe|need)\\b(?:\\s+\\w+){0,3}?\\s+${PRIVATE_TOPIC}\\b`, 'g'),
    // "bonus for Sam", "tasks of Julie"
    new RegExp(`\\b${PRIVATE_TOPIC}\\s+(?:for|of)\\s+([A-Z][a-z]+)\\b`, 'g'),
    // "how much pay does Mike get", "what bonus did Sam earn"
    new RegExp(`\\b(?:pay(?:cheques?|checks?|roll|slips?)?|salary|salaries|wages?|bonus(?:es)?|payouts?|earnings|commissions?)\\s+(?:does|do|did|has|have|is|was|will)\\s+([A-Z][a-z]+)\\b`, 'g'),
  ];
  const names = new Set();
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text))) {
      const name = String(match[1] || '').trim();
      const lower = name.toLowerCase();
      if (!name || lower === first || PRIVATE_NAME_STOP.has(lower)) continue;
      // "Julie's emails to me" and "did Tom have a request for us" are about
      // the user's own mail; leave those alone.
      const tail = text.slice(match.index + match[0].length, match.index + match[0].length + 24);
      if (/\b(?:me|us|my|mine|myself)\b/i.test(tail)) continue;
      names.add(name);
    }
  }
  if (!names.size) return '';
  const who = [...names].join(', ');
  const me = firstNameOfSession(session) || 'the signed-in user';
  const scopes = scopesFromSession(session);
  return `Privacy: the question names ${who}. Emails, direct messages, tasks, and requests here are only ever ${me}'s own; ${who}'s cannot be read by anyone but ${who}. Say so in one kind sentence and do not guess, summarize, or infer ${who}'s. ${aiPrivacyBlurb(scopes)}`;
}

export function analyticsPrivacyRules(session) {
  return `Privacy: emails, direct messages, tasks, and requests come only from the signed-in user's own connected inboxes and chats. The tools cannot reach anyone else's, no matter who asks or how. If the user asks about another person's emails, inbox, messages, chats, tasks, or requests, say in one kind sentence that you can only see their own mailbox and messages, and do not guess, summarize, or infer that person's. ${aiPrivacyBlurb(scopesFromSession(session))} Never carry private details from one person's mail or chat into an answer for someone else.`;
}

export const AI_PRIVACY_RULES = analyticsPrivacyRules(null);

function isCorrection(question) {
  return /\b(not correct|incorrect|wrong|i see|you missed|recount|count again|try again)\b/i.test(
    String(question || ''),
  );
}

function keywordSources(question) {
  const keys = [];
  if (wantsTillQuestion(question)) keys.push('tills');
  for (const entry of APP_LOOKUPS) {
    if (entry.test.test(question)) keys.push(entry.app);
  }
  if (isStoreActivityQuestion(question)) {
    keys.push('home', 'transactions');
  }
  if (/\b(employees?|staff|who works)\b/i.test(String(question || ''))) keys.push('employees');
  if (wantsTasks(question)) keys.push('emails', 'messages');
  if (
    /\b(clocked in|who's working|who is working|who works|on shift|scheduled|schedule|set to work|rostered|working (today|tomorrow|tonight))\b/i.test(
      String(question || ''),
    )
  ) {
    keys.push('calendar');
  }
  if (
    /\b(phone|answering rate|answer rate|inbound|missed calls?|called back|callback|voicemail|call(?:s|ing)? ratio)\b/i.test(
      String(question || ''),
    )
  ) {
    keys.push('phone');
  }
  return [...new Set(keys)].filter((key) => SOURCE_KEYS.has(key)).slice(0, 5);
}

function isFollowUp(question) {
  const text = String(question || '').trim();
  const words = text.split(/\s+/).filter(Boolean).length;
  if (
    words <= 16 &&
    /\b(that|those|them|same|too|also|what about|how about|not correct|incorrect|wrong|i see|you missed|try again|recount|count again)\b/i.test(
      text,
    )
  ) {
    return true;
  }
  return words <= 6 && Boolean(locationFromQuestion(text));
}

function parseSourcePlan(text) {
  const match = String(text || '').match(/\{[\s\S]*\}/);
  if (!match) return { sources: [], allStores: false };
  try {
    const parsed = JSON.parse(match[0]);
    const sources = (Array.isArray(parsed.sources) ? parsed.sources : [])
      .map((key) => String(key || '').trim())
      .filter((key) => SOURCE_KEYS.has(key))
      .slice(0, 5);
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
- Pick 1 to 5 keys from the list. Pick none only for greetings.
- home for how a store did, sales, purchases, or daily totals. Always include home for those questions. "Today" means that calendar day only.
- tills for cash till, drawer, or cash on hand. financials is payments, not the till balance.
- calendar for who is clocked in or working now, who is scheduled or set to work on a day (today, tomorrow, a date), shifts, or hours. reviews for Google ratings. bonuses for payout.
- emails for the user's own Google inbox; messages for their own direct messages; both together for tasks, to-dos, outstanding requests, follow-ups, or "what do I need to do".
- phone for answering rate, missed calls, callbacks, inbound calls, or voicemail by store.
- allStores true when the question compares stores or asks which is highest or lowest. If they name one store, allStores is false.
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

/** Every POS user across the signed-in tenants, with their default store. */
async function fetchPosDirectory(session) {
  const systems = posSystemsFromSession(session)
    .filter((system) => system.token)
    .map((system) => ({
      token: system.token,
      baseUrl: system.baseUrl,
      label: system.label || system.key,
    }));
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
      seen.add(key);
      rows.push(row);
    }
  }
  return { rows, errors };
}

async function loadEmployeeDirectory(session, locationName) {
  const { rows: directory, errors } = await fetchPosDirectory(session);
  const rows = [];
  for (const row of directory) {
    if (locationName && !namesMatch(row.locationName, locationName)) continue;
    rows.push({
      name: row.fullName || row.aureusLogin,
      role: row.role || undefined,
      store: row.locationName || undefined,
      active: row.isActive,
    });
  }
  return {
    note: 'POS staff directory. Name, role, and default store.',
    count: rows.length,
    employees: rows.slice(0, 180),
    truncated: rows.length > 180 || undefined,
    errors: errors.length ? errors : undefined,
  };
}

async function loadBonusBoard(session, scope) {
  const txResult = await fetchTransactionsAcrossPos(session, {
    startDate: scope.startDate,
    endDate: scope.endDate,
    includePurchases: true,
  });
  const board = await buildBonusBoard({
    session,
    transactionRows: txResult.rows || [],
    startDate: scope.startDate,
    endDate: scope.endDate,
    storeFilter: scope.location || null,
  });
  return {
    note: board.selfOnly
      ? 'Your bonus breakdown for the selected dates. Other employees are omitted.'
      : board.storeOnly
        ? 'Bonus board for this user\'s store. People at other stores are omitted.'
        : 'Live bonus board for the selected dates.',
    dates: { startDate: scope.startDate, endDate: scope.endDate },
    location: scope.location || 'All locations',
    selfOnly: board.selfOnly || undefined,
    storeOnly: board.storeOnly || undefined,
    stores: (board.stores || []).map((store) => ({
      store: store.storeName,
      emailRateLabel: store.emailRateLabel,
      customerCount: store.customerCount,
      withEmail: store.withEmail,
      reviewCount: store.reviewCount,
      fiveStarCount: store.fiveStarCount,
      negativeCount: store.negativeCount,
      eligibleCount: store.eligibleCount,
      totalPayout: money(store.totalPayout),
      totalPayoutLabel: cadLabel(money(store.totalPayout)),
      employees: (store.employees || []).map((row) => ({
        name: row.employeeName,
        eligibleCount: row.eligibleCount,
        photoCount: row.photoCount,
        reviewBonus: money(row.reviewBonus),
        photoBonus: money(row.photoBonus),
        total: money(row.total),
      })),
    })),
  };
}

async function loadReviews(locationName, dates, session) {
  const selfOnly = Boolean(session?.profile) && !canViewAllBonusCounts(session.profile);
  const batches = await fetchAllGoogleStoreReviews({
    storeName: locationName || undefined,
    startDate: dates.startDate,
    endDate: dates.endDate,
    purpose: canViewBonusReviewData(session) === true ? 'bonus' : 'home',
  });
  let transactionRows = [];
  if (selfOnly) {
    const tx = await fetchTransactionsAcrossPos(session, {
      startDate: dates.startDate,
      endDate: dates.endDate,
    });
    transactionRows = tx.rows || [];
  }
  return {
    note: selfOnly
      ? 'Your Google reviews and star breakdown for the selected dates. Reviews that name you or match your tickets are included; other employees are omitted.'
      : 'Live Google reviews for the selected dates.',
    dates,
    location: locationName || 'All locations',
    selfOnly: selfOnly || undefined,
    stores: (batches || []).map((batch) => {
      const reviews = selfOnly
        ? filterReviewsForViewer(batch.reviews || [], session.profile, {
            transactionRows,
            storeName: batch.storeName,
          })
        : batch.reviews || [];
      const summary = summarizeReviews(reviews);
      return {
        store: batch.storeName,
        count: summary.count,
        average: Math.round((summary.average || 0) * 100) / 100,
        breakdown: summary.breakdown,
        error: batch.error || undefined,
      };
    }),
    availableStores: GOOGLE_STORE_PLACES.map((place) => place.storeName),
  };
}

const EMAIL_INBOX_ROWS = 40;
const EMAIL_BODY_ROWS = 12;
const EMAIL_BODY_CHARS = 1400;
const EMAIL_SENT_ROWS = 15;
const DM_CONVERSATIONS = 12;
const DM_MESSAGES_PER = 30;
const DM_BODY_CHARS = 600;

function compactAddress(address) {
  const email = String(address?.email || '').trim();
  const name = String(address?.name || '').trim();
  if (name && email) return `${name} <${email}>`;
  return name || email || '';
}

function squash(text, limit) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

/**
 * The signed-in person's own Google inboxes, as connected in the Emails app.
 * The proxy only serves mailboxes tied to this session's user id, so there is
 * no way to point this at someone else's mail.
 */
async function loadEmails(session) {
  const owner = firstNameOfSession(session) || 'you';
  const accounts = await listGmailAccounts();
  const connected = accounts.filter((account) => account.connected);
  if (!connected.length) {
    return {
      note: `No Google inbox is connected in the Emails app for ${owner}, so there is no mail to read. Say so plainly and offer to look again once an inbox is connected.`,
      owner,
      accounts: [],
      inboxes: [],
    };
  }
  const inboxes = await Promise.all(
    connected.map(async (account) => {
      try {
        const [inboxRes, sentRes] = await Promise.all([
          listGmailMailbox(account.email, 'inbox', { maxResults: EMAIL_INBOX_ROWS }),
          listGmailMailbox(account.email, 'sent', { maxResults: EMAIL_SENT_ROWS }),
        ]);
        const rows = inboxRes.messages || [];
        const bodies = new Map();
        await mapPool(rows.slice(0, EMAIL_BODY_ROWS), 4, async (row) => {
          try {
            const { message } = await getGmailMessage(account.email, row.id);
            bodies.set(row.id, squash(message?.body, EMAIL_BODY_CHARS));
          } catch {
            // Keep the preview for this one.
          }
        });
        return {
          account: account.email,
          count: rows.length,
          unread: rows.filter((row) => row.unread).length,
          messages: rows.map((row) => ({
            id: row.id,
            date: row.createdAt || undefined,
            from: compactAddress(row.from) || undefined,
            to: (Array.isArray(row.to) ? row.to : []).map(compactAddress).filter(Boolean).slice(0, 4),
            subject: row.subject || '(No subject)',
            unread: row.unread || undefined,
            body: bodies.get(row.id) || undefined,
            preview: bodies.has(row.id) ? undefined : squash(row.snippet, 200) || undefined,
          })),
          sent: (sentRes.messages || []).map((row) => ({
            date: row.createdAt || undefined,
            to: (Array.isArray(row.to) ? row.to : []).map(compactAddress).filter(Boolean).slice(0, 4),
            subject: row.subject || '(No subject)',
            preview: squash(row.snippet, 160) || undefined,
          })),
        };
      } catch (error) {
        return { account: account.email, error: error?.message || 'This inbox did not load.' };
      }
    }),
  );
  return {
    note: `${owner}'s own connected Google inboxes (every inbox connected in the Emails app), newest first. The ${EMAIL_BODY_ROWS} newest messages per inbox carry the body; older ones carry a preview. sent is mail ${owner} already sent, so a request that already has a reply there is handled. For tasks, to-dos, or outstanding requests: read each message, and list what still needs a reply or an action from ${owner}, with who asked, what they want, which inbox it came to, and the date. Skip newsletters, receipts, and notifications unless they ask for action. These are only the signed-in user's messages; never present them as anyone else's.`,
    owner,
    accounts: connected.map((account) => account.email),
    inboxes,
  };
}

/** The signed-in person's own direct messages. RLS only returns conversations they are in. */
async function loadMessages(session) {
  const myId = session?.supabaseUserId || session?.profile?.id || '';
  const owner = firstNameOfSession(session) || 'you';
  const inbox = await listDmInbox();
  const stamp = (row) => {
    const at = new Date(row?.lastMessageAt || 0).getTime();
    return Number.isFinite(at) ? at : 0;
  };
  const conversations = inbox
    .filter((row) => !row.isAi && !row.isAgent)
    .sort((a, b) => stamp(b) - stamp(a))
    .slice(0, DM_CONVERSATIONS);
  const threads = await mapPool(conversations, 4, async (conversation) => {
    const names = new Map((conversation.members || []).map((member) => [member.id, contactName(member)]));
    const title = conversationTitle(conversation);
    try {
      const messages = await listDmMessages(conversation.conversationId, myId);
      return {
        title,
        kind: conversation.isTeam ? 'team' : conversation.isGroup ? 'group' : 'direct',
        people: [...names.values()].slice(0, 12),
        unread: conversation.unreadCount || undefined,
        messages: messages.slice(-DM_MESSAGES_PER).map((message) => ({
          at: message.createdAt,
          from: message.senderId === myId ? `${owner} (me)` : names.get(message.senderId) || 'Teammate',
          text: squash(message.body, DM_BODY_CHARS),
        })),
      };
    } catch (error) {
      return { title, error: error?.message || 'This conversation did not load.' };
    }
  });
  return {
    note: `${owner}'s own direct messages: the ${threads.length} most recent conversations they are part of, oldest to newest inside each. "(me)" marks ${owner}'s own messages. Use these for requests teammates made of ${owner}, things ${owner} said they would do, and follow-ups still open. Only the signed-in user's conversations exist here; nobody else's can be read.`,
    owner,
    conversationCount: inbox.filter((row) => !row.isAi && !row.isAgent).length,
    threads,
  };
}

async function loadTeamsBoard() {
  const teams = await listTeams();
  return {
    note: 'Live teams and members.',
    count: teams.length,
    teams: teams.map((team) => ({
      name: team.name,
      members: team.memberCount,
      intake: team.intakeCount,
      people: (team.members || []).slice(0, 12).map((person) => person.fullName || person.name),
    })),
  };
}

const CALENDAR_MAX_DAYS = 45;
const CALENDAR_MAX_SHIFT_ROWS = 700;
const CALENDAR_MAX_HOURS_PEOPLE = 120;
// The hours feed is checked by the open app every 7 minutes; this is the same
// call, so a report that just landed is imported before the answer is written.
// The server answers "checked recently" at once inside its cooldown.
const CALENDAR_SYNC_WAIT_MS = 12_000;

function withTimeout(promise, ms, fallback) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}

function whenLabel(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-CA', {
    timeZone: 'America/Toronto',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function fileKindLabel(kind) {
  if (kind === 'clock') return 'clock-in report';
  if (kind === 'shift') return 'shift report by role';
  if (kind === 'time') return 'time (hours) report';
  return 'report';
}

/**
 * Which Rippling files the numbers come from: the newest of each kind, when
 * it arrived, and the dates the hours file covers. The model quotes this so a
 * reader knows how fresh the figures are and where the stored hours end.
 */
function describeRipplingFiles(status, files) {
  const list = Array.isArray(files) ? files : [];
  const newestOfKind = (kind) => list.find((file) => file.kind === kind) || null;
  const current = list.find((file) => file.current) || list[0] || null;
  const describe = (file) =>
    file
      ? {
          file: file.name,
          kind: fileKindLabel(file.kind),
          receivedAt: whenLabel(file.receivedAt) || undefined,
          rows: file.rowCount || undefined,
          source: file.source === 'drop' ? 'dropped in the app' : 'hours mailbox email',
        }
      : undefined;
  return {
    feedSource: status?.feedSource === 'drop' ? 'files dropped in the app' : 'hours mailbox email',
    lastCheckedAt: whenLabel(status?.lastAttemptAt) || undefined,
    lastImportedAt: whenLabel(status?.lastSyncedAt) || undefined,
    hoursFile: describe(newestOfKind('time')) || (status?.attachmentName
      ? { file: status.attachmentName, kind: 'time (hours) report', receivedAt: whenLabel(status.lastMessageAt) || undefined, rows: status.rowCount || undefined }
      : undefined),
    hoursCoverage: status?.rangeStart && status?.rangeEnd
      ? { startDate: String(status.rangeStart).slice(0, 10), endDate: String(status.rangeEnd).slice(0, 10) }
      : undefined,
    clockFile: describe(newestOfKind('clock')),
    shiftFile: describe(newestOfKind('shift')) || (status?.shiftAttachmentName
      ? { file: status.shiftAttachmentName, kind: 'shift report by role', receivedAt: whenLabel(status.shiftReportedAt) || undefined }
      : undefined),
    latestFile: describe(current),
    feedError: status?.lastError || status?.syncError || undefined,
  };
}

/** Hours per person over the asked dates, straight from the stored time entries. */
function hoursInRange(entries, { startDate, endDate, inStore, stores, session }) {
  const hoursScope = scopesFromSession(session).hours;
  const byPerson = new Map();
  for (const entry of entries || []) {
    if (!entry?.name || !inStore(entry.name, '')) continue;
    if (
      !employeeAllowedByScope({
        scope: hoursScope,
        viewer: session?.profile,
        subjectName: entry.name,
        subjectStore: storeForName(stores, entry.name),
      })
    ) {
      continue;
    }
    const key = entry.id || entry.name;
    const row = byPerson.get(key) || { name: entry.name, minutes: 0, days: new Set(), shifts: 0 };
    row.minutes += Number(entry.minutes) || 0;
    if (entry.date) row.days.add(entry.date);
    row.shifts += 1;
    byPerson.set(key, row);
  }
  const people = [...byPerson.values()]
    .sort((a, b) => b.minutes - a.minutes)
    .slice(0, CALENDAR_MAX_HOURS_PEOPLE)
    .map((row) => ({
      name: row.name,
      store: storeForName(stores, row.name) || undefined,
      hours: formatMinutes(row.minutes),
      hoursDecimal: Math.round((row.minutes / 60) * 10) / 10,
      daysWorked: row.days.size,
      shifts: row.shifts,
    }));
  const totalMinutes = [...byPerson.values()].reduce((sum, row) => sum + row.minutes, 0);
  const days = isoDayCount(startDate, endDate);
  return {
    startDate,
    endDate,
    days,
    people: people.length,
    totalHours: formatMinutes(totalMinutes),
    totalHoursDecimal: Math.round((totalMinutes / 60) * 10) / 10,
    rows: people,
  };
}

function isoDayOrEmpty(value) {
  const text = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}

function shiftIsoDay(iso, days) {
  const [year, month, day] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function isoDayCount(start, end) {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1;
}

/**
 * Neither Rippling report (Clock-In-Data, Shift report by role) carries a
 * store, so a person's default store in the POS directory stands in. The POS
 * list covers every Aureus user; app profiles only cover people who have
 * signed in here, so they fill gaps rather than lead.
 */
function storeByPersonName(...sources) {
  const map = new Map();
  for (const people of sources) {
    for (const person of people || []) {
      const store = String(person?.locationName || '').trim();
      if (!store) continue;
      for (const key of personNameKeys(person.fullName || person.name)) {
        if (key && !map.has(key)) map.set(key, store);
      }
    }
  }
  return map;
}

function storeForName(map, name) {
  for (const key of personNameKeys(name)) {
    const store = map.get(key);
    if (store) return store;
  }
  return '';
}

/**
 * Rippling in one lookup: who is punched in now, the shift schedule by day
 * (asked dates plus today and tomorrow, so "who works tomorrow" needs no
 * dates), and hours worked. Shifts come from the "Shift report by role" email.
 */
async function loadCalendar(session, locationName, { startDate, endDate } = {}) {
  const today = torontoToday();
  const tomorrow = shiftIsoDay(today, 1);
  const askedStart = isoDayOrEmpty(startDate) || today;
  const askedEnd = isoDayOrEmpty(endDate) || askedStart;
  let windowStart = askedStart < today ? askedStart : today;
  let windowEnd = askedEnd > tomorrow ? askedEnd : tomorrow;
  if (isoDayCount(windowStart, windowEnd) > CALENDAR_MAX_DAYS) {
    windowStart = askedStart;
    windowEnd = shiftIsoDay(windowStart, CALENDAR_MAX_DAYS - 1);
  }

  // Pull any report that landed since the app last checked, then read. The
  // Supabase tables below hold whatever the newest file said, so this is the
  // step that keeps Analytics on the latest Rippling file.
  const synced = await withTimeout(syncHoursFeed(), CALENDAR_SYNC_WAIT_MS, null);

  const askedDates = Boolean(isoDayOrEmpty(startDate) || isoDayOrEmpty(endDate));
  const [summary, shiftRows, coverage, contacts, posDirectory, feedStatus, files, rangeEntries] = await Promise.all([
    fetchHoursSummary({ recentDays: 14 }),
    fetchShiftRolesBetween(windowStart, windowEnd).catch(() => []),
    fetchShiftReportCoverage().catch(() => null),
    listEmailContacts().catch(() => []),
    fetchPosDirectory(session).catch(() => ({ rows: [], errors: [] })),
    synced ? Promise.resolve(synced) : loadHoursFeedStatus().catch(() => null),
    fetchRipplingCsvFiles().catch(() => []),
    askedDates ? fetchTimeEntriesBetween(askedStart, askedEnd).catch(() => []) : Promise.resolve([]),
  ]);
  const stores = storeByPersonName(posDirectory.rows, contacts);
  const sourceFiles = describeRipplingFiles(feedStatus, files);
  const now = Date.now();
  const wantStore = String(locationName || '').trim();
  // Rippling is company-wide (head office, refinery, every store). When a
  // store is asked, only people whose default store matches belong in the
  // answer; someone with no store on file is reported separately, never
  // folded into the store's list.
  const inStore = (name, shiftLocation) => {
    if (!wantStore) return true;
    const store = String(shiftLocation || '').trim() || storeForName(stores, name);
    return Boolean(store) && storeNameMatches(store, wantStore);
  };
  const hasNoStore = (name) => Boolean(wantStore) && !storeForName(stores, name);

  const byDay = new Map();
  let shiftCount = 0;
  for (const shift of collapseNestedShifts(shiftRows)) {
    if (!inStore(shift.name, shift.location)) continue;
    const bucket = byDay.get(shift.date) || [];
    const row = {
      name: shift.name,
      role: shift.role && shift.role !== 'Shift' ? shift.role : undefined,
      time: formatShiftSpan(shift) || undefined,
      store: shift.location || storeForName(stores, shift.name) || undefined,
      draft: shift.draft ? true : undefined,
    };
    if (shift.date === today) {
      row.status = shiftCoversNow(shift, now)
        ? 'on shift now'
        : shift.end && shift.end.getTime() <= now
          ? 'shift finished'
          : 'later today';
    }
    bucket.push(row);
    byDay.set(shift.date, bucket);
    shiftCount += 1;
  }
  let remaining = CALENDAR_MAX_SHIFT_ROWS;
  const schedule = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, rows]) => {
      const kept = rows.slice(0, Math.max(0, remaining));
      remaining -= kept.length;
      return {
        date,
        day: date === today ? `Today, ${formatShiftDate(date)}` : date === tomorrow ? `Tomorrow, ${formatShiftDate(date)}` : formatShiftDate(date),
        scheduled: rows.length,
        people: kept,
        truncated: kept.length < rows.length ? rows.length - kept.length : undefined,
      };
    });

  const people = (summary.list || [])
    .filter((row) => inStore(row.name, ''))
    .sort((a, b) => Number(b.clockedIn) - Number(a.clockedIn) || String(a.name || '').localeCompare(String(b.name || '')));
  const clockedIn = people.filter((row) => row.clockedIn).map((row) => ({
    name: row.name,
    store: storeForName(stores, row.name) || undefined,
    since: row.openSince instanceof Date ? row.openSince.toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Toronto' }) : undefined,
    todayShift: (byDay.get(today) || []).find((shift) => personNameKeys(shift.name).some((key) => personNameKeys(row.name).includes(key)))?.time,
  }));
  const clockedInNoStore = (summary.list || [])
    .filter((row) => row.clockedIn && hasNoStore(row.name))
    .map((row) => row.name)
    .sort((a, b) => a.localeCompare(b));

  const hoursRange = askedDates ? hoursInRange(rangeEntries, { startDate: askedStart, endDate: askedEnd, inStore, stores, session }) : undefined;
  const coverageStart = sourceFiles.hoursCoverage?.startDate || '';
  const coverageEnd = sourceFiles.hoursCoverage?.endDate || '';

  const notes = [
    'Rippling data from the latest report files the hours feed imported (see sourceFiles for each file, when it arrived, and the dates it covers). clockedIn is who is punched in right now (from the Clock-In report); schedule is who is rostered per day with role and shift time (from the Shift report by role); hours are punched time, Mon–Sun weeks, Toronto time.',
    'Someone can be scheduled but not clocked in, or clocked in without a rostered shift. "Currently working" means clockedIn. "Set to work" or "scheduled" means the schedule list.',
    'Rippling reports carry no store. store is each person\'s default store from the POS staff directory. Rippling covers the whole company (head office, refinery, every store), so when a store is asked only people whose default store matches are in clockedIn, schedule, and hours.',
    'draft: true marks a shift that is written in Rippling but not published to the employee yet; treat it as tentative.',
  ];
  if (wantStore && clockedInNoStore.length) {
    notes.push(
      `clockedInNoStoreOnFile lists people punched in somewhere in the company who have no default store in the POS directory; they are not ${wantStore} staff as far as the data shows. Do not count or name them as working at ${wantStore}. Mention them only if asked who else is clocked in company-wide.`,
    );
  }
  if (hoursRange) {
    notes.push(
      `hoursInRange is each person's punched hours between ${askedStart} and ${askedEnd}, from the time report; use it for any hours question about named dates, a week, or a month, and quote hours as given. hours (today / thisWeek / lastWeek) is only the current and previous Mon–Sun week.`,
    );
    if (coverageStart && coverageEnd && (askedStart < coverageStart || askedEnd > coverageEnd)) {
      notes.push(
        `The stored hours file covers ${coverageStart} to ${coverageEnd}; days outside that window have no hours on file, so say so rather than treating them as zero.`,
      );
    }
  }
  if (sourceFiles.hoursFile?.receivedAt) {
    notes.push(`When asked how current the numbers are, say the hours report ${sourceFiles.hoursFile.file} arrived ${sourceFiles.hoursFile.receivedAt}${sourceFiles.clockFile?.receivedAt ? ` and the clock-in report ${sourceFiles.clockFile.receivedAt}` : ''}.`);
  }
  if (sourceFiles.feedError) notes.push(`The last check of the hours feed reported: ${sourceFiles.feedError}`);
  if (coverage?.lastDay && coverage.lastDay < windowEnd) {
    notes.push(
      `The shift report only covers ${coverage.firstDay} to ${coverage.lastDay}; there is no schedule after ${coverage.lastDay}, so say so rather than guessing who is scheduled.`,
    );
  }
  if (coverage?.firstDay && coverage.firstDay > windowStart) {
    notes.push(`No schedule is stored before ${coverage.firstDay}.`);
  }
  if (!shiftRows.length) notes.push('No shifts were found for these dates.');

  return {
    note: notes.join(' '),
    location: wantStore || 'All locations',
    today,
    sourceFiles,
    scheduleWindow: { startDate: windowStart, endDate: windowEnd },
    shiftReportCoverage: coverage ? { firstDay: coverage.firstDay, lastDay: coverage.lastDay, importedAt: coverage.updatedAt } : undefined,
    clockedInCount: clockedIn.length,
    clockedIn,
    clockedInNoStoreOnFile: wantStore && clockedInNoStore.length ? { count: clockedInNoStore.length, names: clockedInNoStore } : undefined,
    scheduledShiftCount: shiftCount,
    schedule,
    hoursInRange: hoursRange,
    hours: people.slice(0, CALENDAR_MAX_HOURS_PEOPLE).map((row) => ({
      name: row.name,
      clockedIn: Boolean(row.clockedIn),
      today: formatMinutes(row.todayMinutes),
      thisWeek: formatMinutes(row.weekMinutes),
      lastWeek: formatMinutes(row.lastWeekMinutes),
    })),
  };
}

async function loadPhoneBoard(locationName, { startDate, endDate, question } = {}) {
  const startKey = formatDateParam(startDate || new Date());
  const endKey = formatDateParam(endDate || new Date());
  const dateFrom = parseDateParam(startKey);
  const dateTo = parseDateParam(endKey);
  dateTo.setDate(dateTo.getDate() + 1);
  const needHistory = phoneHistoryNeeded(startKey, endKey);
  const asked = String(question || '');
  let stores = [...HOME_STORES, ...QUEBEC_STORES];
  if (/\bquebec stores?\b/i.test(asked)) {
    stores = [...QUEBEC_STORES];
  } else if (locationName) {
    stores = stores.filter(
      (name) => namesMatch(name, locationName) || storeNameMatches(name, locationName),
    );
    if (!stores.length) stores = [locationName];
  }

  const results = await Promise.all(
    stores.map(async (name) => {
      try {
        const payload = needHistory
          ? await fetchPhoneHistory(name, { dateFrom, dateTo })
          : await fetchPhoneInbox(name);
        const all = payload.calls || [];
        const inRange = all.filter((call) => {
          const at = call.startTime ? new Date(call.startTime) : null;
          if (!at || !Number.isFinite(at.getTime())) return false;
          return at >= dateFrom && at < dateTo;
        });
        const stats = inboundCallBreakdown(inRange, all);
        // The same calls, kept per Toronto day. A day with no inbound calls
        // has no rate (null), not 0%. Missed calls are still resolved
        // against the whole log so a next-morning callback counts.
        const byDay = new Map();
        for (const call of inRange) {
          const day = torontoDayOf(call.startTime);
          if (!day) continue;
          const bucket = byDay.get(day) || [];
          bucket.push(call);
          byDay.set(day, bucket);
        }
        const days = [];
        for (let day = startKey; day <= endKey; day = shiftIsoDay(day, 1)) {
          const dayStats = inboundCallBreakdown(byDay.get(day) || [], all);
          days.push({
            date: day,
            inbound: dayStats.inbound,
            answered: dayStats.answered,
            firstAnswered: dayStats.firstAnswered,
            stillMissed: dayStats.stillMissed,
            voicemail: dayStats.voicemail,
            rate: dayStats.rate,
            firstRingRate: dayStats.firstRate,
          });
        }
        return {
          store: name,
          inbound: stats.inbound,
          firstAnswered: stats.firstAnswered,
          recoveredByCallback: stats.recoveredCallback,
          recoveredByLaterAnswer: stats.recoveredInbound,
          recovered: stats.recovered,
          stillMissed: stats.stillMissed,
          answered: stats.answered,
          missed: stats.stillMissed,
          voicemail: stats.voicemail,
          firstRingRate: stats.firstRatio,
          rate: stats.ratio,
          days,
        };
      } catch (error) {
        return { store: name, error: error?.message || 'Phone log did not load.' };
      }
    }),
  );

  const ok = results.filter((row) => !row.error);
  const sum = (key) => ok.reduce((total, row) => total + (Number(row[key]) || 0), 0);
  const inbound = sum('inbound');
  const answered = sum('answered');
  const firstAnswered = sum('firstAnswered');
  const dayCount = isoDayCount(startKey, endKey);
  // Per-day rows ride along when they stay small (one store, or a short
  // range); otherwise query_metrics is the tool for a trend, and the per-store
  // totals here are enough for a ranking.
  const keepDays = ok.length === 1 || dayCount <= 7;
  const storeRows = results.map((row) => (keepDays || row.error ? row : { ...row, days: undefined }));
  const companyDays = [];
  if (keepDays) {
    for (let day = startKey; day <= endKey; day = shiftIsoDay(day, 1)) {
      const rows = ok.map((row) => (row.days || []).find((item) => item.date === day)).filter(Boolean);
      const dayInbound = rows.reduce((total, row) => total + row.inbound, 0);
      const dayAnswered = rows.reduce((total, row) => total + row.answered, 0);
      companyDays.push({
        date: day,
        inbound: dayInbound,
        answered: dayAnswered,
        stillMissed: rows.reduce((total, row) => total + row.stillMissed, 0),
        rate: dayInbound ? Math.round((dayAnswered / dayInbound) * 100) : null,
      });
    }
  }
  return {
    note: `Live RingCentral inbound stats by store. firstAnswered is picked up on the first ring. recoveredByCallback is an original miss that we later dialed back. recoveredByLaterAnswer is an original miss that later called in and was answered. stillMissed was never reached. answered = firstAnswered + recovered. rate uses answered / inbound. firstRingRate uses firstAnswered / inbound.${
      keepDays
        ? ' days lists every calendar day in the range per store; rate is null on a day with no inbound calls (no data, not 0%).'
        : ' For a per-day, per-week, or per-month trend call query_metrics with answerRate / inboundCalls / missedCalls.'
    }`,
    startDate: startKey,
    endDate: endKey,
    location: /\bquebec stores?\b/i.test(asked) ? 'Quebec stores' : locationName || 'All locations',
    inbound,
    firstAnswered,
    recoveredByCallback: sum('recoveredByCallback'),
    recoveredByLaterAnswer: sum('recoveredByLaterAnswer'),
    recovered: sum('recovered'),
    stillMissed: sum('stillMissed'),
    answered,
    missed: sum('stillMissed'),
    voicemail: sum('voicemail'),
    firstRingRate: inbound ? `${Math.round((firstAnswered / inbound) * 100)}%` : '—',
    rate: inbound ? `${Math.round((answered / inbound) * 100)}%` : '—',
    days: keepDays && ok.length > 1 ? companyDays : undefined,
    stores: storeRows,
  };
}

function torontoDayOf(value) {
  const date = value ? new Date(value) : null;
  if (!date || !Number.isFinite(date.getTime())) return '';
  return date.toLocaleDateString('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' });
}

async function loadContacts(locationName) {
  const people = await listEmailContacts();
  const rows = (people || []).filter(
    (person) => !locationName || storeNameMatches(person.locationName, locationName),
  );
  return {
    note: 'Staff contacts. Online means they have the app open.',
    location: locationName || 'All locations',
    count: rows.length,
    online: rows.filter((person) => person.isOnline).length,
    people: rows.slice(0, 120).map((person) => ({
      name: person.fullName,
      store: person.locationName || undefined,
      team: person.teamName || undefined,
      online: person.isOnline || undefined,
    })),
  };
}

/** Triage: PO evaluation accuracy plus error counts and recorded dollar amounts. */
async function loadTriage(locationName, { startDate, endDate } = {}) {
  const [snapshot, allFacts] = await Promise.all([
    fetchTriageInsightSnapshot().catch(() => ({ stores: [], totals: null })),
    listTriageErrorFacts([], { storeFilter: locationName || '' }).catch(() => []),
  ]);
  const facts = allFacts.filter((fact) => {
    if (startDate && fact.date < startDate) return false;
    if (endDate && fact.date > endDate) return false;
    return true;
  });
  const stores = filterInsightStores(snapshot, { storeName: locationName, allowAllStores: !locationName });
  const byEmployee = new Map();
  const byType = new Map();
  const byStore = new Map();
  const bump = (map, key, amount) => {
    const entry = map.get(key) || { count: 0, amount: 0 };
    entry.count += 1;
    entry.amount += amount;
    map.set(key, entry);
  };
  for (const fact of facts) {
    const amount = Number(fact.amount) || 0;
    bump(byEmployee, fact.employee, amount);
    bump(byType, fact.errorType || 'Unspecified', amount);
    bump(byStore, fact.store, amount);
  }
  const sumAmount = (rows) => rows.reduce((sum, fact) => sum + (Number(fact.amount) || 0), 0);
  const rank = (map) =>
    [...map.entries()]
      .sort((a, b) => b[1].amount - a[1].amount || b[1].count - a[1].count || a[0].localeCompare(b[0]))
      .slice(0, 25)
      .map(([name, { count, amount }]) => ({ name, count, amount }));
  return {
    note: 'allTime is every evaluated purchase in the triage workflow (accuracy). inPeriod is errors logged between the asked dates. amount is the dollar value staff recorded on each error — the same Amount column as the Triage app, not the PO ticket total. Use amount for the dollar impact; count is how many errors. byEmployee / byStore / byType amounts are complete totals.',
    location: locationName || 'All locations',
    allTime: {
      totals: {
        ...(snapshot?.totals || {}),
        errors: allFacts.length,
        amount: sumAmount(allFacts),
      },
      stores: stores.slice(0, 30).map((row) => ({
        store: row.store,
        evaluated: row.evaluated,
        correct: row.correct,
        incorrect: row.incorrect,
        accuracy: `${Math.round((row.accuracy || 0) * 100)}%`,
        topErrorTypes: (row.errorTypes || []).slice(0, 5),
        employees: (row.employees || []).slice(0, 10).map((person) => ({ name: person.name, incorrect: person.incorrect, types: (person.types || []).slice(0, 3) })),
        products: (row.products || []).slice(0, 6),
      })),
    },
    inPeriod: {
      startDate,
      endDate,
      errors: facts.length,
      amount: sumAmount(facts),
      byStore: rank(byStore),
      byEmployee: rank(byEmployee),
      byType: rank(byType),
    },
  };
}

async function loadCachedSource(source, scope, loader, onProgress, label) {
  const location = scope.allStores ? null : scope.location;
  const key = sourceCacheKey(source, { ...scope, location, tillDate: source === 'tills' ? scope.tillDate : '' });
  const cached = cacheGet(key, { fresh: scope.fresh });
  if (cached) return cached;
  onProgress?.(label);
  const value = await loader();
  cacheSet(key, value, source);
  return value;
}

async function loadChosenSources(session, sources, scope, onProgress) {
  const lookup = {};
  const errors = [];
  const location = scope.allStores ? null : scope.location;
  const cacheOpts = { fresh: scope.fresh };

  if (sources.includes('tills')) {
    lookup.tills = await loadCachedSource(
      'tills',
      scope,
      () => loadTillBoard(session, { locationName: location, date: scope.tillDate }),
      onProgress,
      'Loading cash tills…',
    );
  }

  if (sources.includes('employees')) {
    lookup.employees = await loadCachedSource(
      'employees',
      scope,
      () => loadEmployeeDirectory(session, location),
      onProgress,
      'Loading employees…',
    );
  }

  if (sources.includes('bonuses')) {
    if (bonusBoardAccessDenied(session)) {
      lookup.bonuses = { error: BONUS_ACCESS_DENIED };
      errors.push(BONUS_ACCESS_DENIED);
    } else {
      try {
        lookup.bonuses = await loadCachedSource(
          'bonuses',
          scope,
          () => loadBonusBoard(session, { ...scope, location }),
          onProgress,
          'Loading bonuses…',
        );
      } catch (error) {
        lookup.bonuses = { error: error?.message || 'Bonuses did not load.' };
        errors.push(lookup.bonuses.error);
      }
    }
  }

  if (sources.includes('reviews')) {
    if (bonusBoardAccessDenied(session)) {
      lookup.reviews = { error: BONUS_ACCESS_DENIED };
      errors.push(BONUS_ACCESS_DENIED);
    } else {
      try {
        lookup.reviews = await loadCachedSource(
          'reviews',
          scope,
          () =>
            loadReviews(location, { startDate: scope.startDate, endDate: scope.endDate }, session),
          onProgress,
          'Loading reviews…',
        );
      } catch (error) {
        lookup.reviews = { error: error?.message || 'Reviews did not load.' };
        errors.push(lookup.reviews.error);
      }
    }
  }

  if (sources.includes('emails')) {
    try {
      lookup.emails = await loadCachedSource('emails', scope, () => loadEmails(session), onProgress, 'Reading your inbox…');
    } catch (error) {
      lookup.emails = { error: error?.message || 'Emails did not load.' };
      errors.push(lookup.emails.error);
    }
  }

  if (sources.includes('messages')) {
    try {
      lookup.messages = await loadCachedSource('messages', scope, () => loadMessages(session), onProgress, 'Reading your messages…');
    } catch (error) {
      lookup.messages = { error: error?.message || 'Direct messages did not load.' };
      errors.push(lookup.messages.error);
    }
  }

  if (sources.includes('teams')) {
    try {
      lookup.teams = await loadCachedSource('teams', scope, () => loadTeamsBoard(), onProgress, 'Loading teams…');
    } catch (error) {
      lookup.teams = { error: error?.message || 'Teams did not load.' };
      errors.push(lookup.teams.error);
    }
  }

  if (sources.includes('calendar')) {
    try {
      lookup.calendar = await loadCachedSource(
        'calendar',
        scope,
        () => loadCalendar(session, location, { startDate: scope.startDate, endDate: scope.endDate }),
        onProgress,
        'Loading schedule and hours…',
      );
    } catch (error) {
      lookup.calendar = { error: error?.message || 'Schedule and hours did not load.' };
      errors.push(lookup.calendar.error);
    }
  }

  if (sources.includes('contacts')) {
    try {
      lookup.contacts = await loadCachedSource(
        'contacts',
        scope,
        () => loadContacts(location),
        onProgress,
        'Loading contacts…',
      );
    } catch (error) {
      lookup.contacts = { error: error?.message || 'Contacts did not load.' };
      errors.push(lookup.contacts.error);
    }
  }

  if (sources.includes('triage')) {
    try {
      lookup.triage = await loadCachedSource(
        'triage',
        scope,
        () => loadTriage(location, { startDate: scope.startDate, endDate: scope.endDate }),
        onProgress,
        'Loading triage…',
      );
    } catch (error) {
      lookup.triage = { error: error?.message || 'Triage did not load.' };
      errors.push(lookup.triage.error);
    }
  }

  if (sources.includes('phone')) {
    try {
      lookup.phone = await loadCachedSource(
        'phone',
        scope,
        () =>
          loadPhoneBoard(location, {
            startDate: scope.startDate,
            endDate: scope.endDate,
            question: scope.question,
          }),
        onProgress,
        'Loading phone rates…',
      );
    } catch (error) {
      lookup.phone = { error: error?.message || 'Phone rates did not load.' };
      errors.push(lookup.phone.error);
    }
  }

  const apps = [
    ...new Set(
      sources.filter((source) => GATHER_APPS.has(source)).map((source) => (source === 'home' ? 'transactions' : source)),
    ),
  ];
  const missing = [];
  for (const app of apps) {
    const key = sourceCacheKey(app, { ...scope, location, tillDate: '' });
    const cached = cacheGet(key, cacheOpts);
    const field = app === '100-ways' ? 'premiumJewelry' : app;
    if (cached) lookup[field] = cached;
    else missing.push(app);
  }

  if (sources.includes('home')) {
    const homeKey = sourceCacheKey('home', { ...scope, location, tillDate: '' });
    const homeCached = cacheGet(homeKey, cacheOpts);
    if (homeCached) lookup.home = homeCached;
    else if (!missing.includes('transactions')) missing.push('transactions');
  }

  if (missing.length) {
    onProgress?.('Loading company data…');
    const extra = await gatherAiChatContext(session, {
      apps: missing,
      startDate: scope.startDate,
      endDate: scope.endDate,
      locationName: location || undefined,
      txRowLimit: scope.txRowLimit,
      onProgress,
    });
    for (const app of missing) {
      const field = app === '100-ways' ? 'premiumJewelry' : app;
      const block = extra.context?.data?.[field] || extra.context?.data?.[app];
      if (block) {
        lookup[field] = block;
        cacheSet(sourceCacheKey(app, { ...scope, location, tillDate: '' }), block, app);
      }
    }
    if (extra.context?.data?.home) {
      lookup.home = extra.context.data.home;
      cacheSet(sourceCacheKey('home', { ...scope, location, tillDate: '' }), lookup.home, 'home');
    }
    if (extra.errors?.length) errors.push(...extra.errors);
  }

  if (errors.length) lookup.errors = errors;
  return lookup;
}

export const COMPANY_DATA_SOURCES = DATA_SOURCES.map(({ key, label, hint }) => ({ key, label, hint }));

/**
 * Load named datasets for a tool call. Same loaders and caches as the company
 * chat; the caller picks the sources, so nothing loads that was not asked for.
 */
export async function loadCompanyData(
  session,
  { sources = [], location = '', allStores = false, startDate, endDate, question = '', onProgress, fresh = false } = {},
) {
  const keys = [...new Set((sources || []).map((key) => String(key || '').trim()).filter((key) => SOURCE_KEYS.has(key)))];
  if (!keys.length) return { error: `Pick at least one dataset: ${DATA_SOURCES.map((source) => source.key).join(', ')}.` };
  const where = allStores ? '' : canonicalizeStoreName(location);
  const start = formatDateParam(startDate || new Date());
  const end = formatDateParam(endDate || new Date());
  const scope = {
    allStores: !where,
    location: where || null,
    startDate: start,
    endDate: end,
    tillDate: tillDateForQuestion(question, end),
    txRowLimit: MAX_TX_SAMPLE,
    fresh,
    question,
    tag: /\bquebec stores?\b/i.test(question) ? 'quebec-stores' : '',
  };
  const lookup = await loadChosenSources(session, keys, scope, onProgress);
  return {
    scope: { location: where || 'All locations', startDate: start, endDate: end },
    ...lookup,
  };
}

function firstNameOfSession(session) {
  const first = String(session?.profile?.firstName || '').trim();
  if (first) return first;
  const full = String(session?.profile?.fullName || '').trim();
  return full.split(/\s+/)[0] || '';
}

function buildSeedMessages(context) {
  const catalog = (context?.catalog || DATA_SOURCES)
    .map((source) => `- ${source.label}: ${source.hint}`)
    .join('\n');
  const name = String(context?.firstName || '').trim();
  const nameLine = name
    ? `You are talking to ${name}. Use their first name sparingly, the way a colleague would.`
    : '';
  const intro = `You are a Canada Gold colleague who can look things up. Answer the way a smart, pleasant person would after checking the numbers — clear, warm, and sure of the count.
${nameLine}

No company rows are loaded up front. The latest user message includes a Lookup object with the live datasets that question needs. Answer from Lookup. If a needed dataset failed to load, say so. Do not invent numbers and do not tell the user to open another app.

Gold Maple Leaf products are often labeled GML, Maplegram, Maple Leaf, or MLBD. Silver Maples are often SML. Inventory quantities are a live snapshot. 0 means none on hand.

Datasets that can be looked up:
${catalog}

${analyticsPrivacyRules(context?.session)}

Not searched: app settings.

Default scope: ${context?.selection?.location || 'All locations'}, ${context?.selection?.startDate || ''} to ${context?.selection?.endDate || ''}. Prefer Lookup.scope when it is present.

${ANSWER_STYLE}`;

  return [
    {
      role: 'user',
      content: `${intro}

Reply in plain sentences like a person. When Lookup.home is present, use those store counts. When Lookup.tills is present, mention every store from Lookup.tills.ranking in the same conversational reply.`,
    },
    {
      role: 'assistant',
      content: 'Of course — ask me how a store did and I’ll pull the live numbers.',
    },
  ];
}

/**
 * Chat opens with a catalog only. Rows load after a question.
 */
export function prepareAiChatSession({ apps = [], startDate, endDate, locationName, session, firstName } = {}) {
  const selected = (apps || []).filter(Boolean);
  const context = {
    selection: {
      mode: selected.length ? 'apps' : 'company',
      startDate: formatDateParam(startDate || new Date()),
      endDate: formatDateParam(endDate || new Date()),
      location: String(locationName || '').trim() || 'All locations',
      apps: selected,
    },
    firstName: String(firstName || firstNameOfSession(session)).trim() || undefined,
    catalog: DATA_SOURCES.map(({ key, label, hint }) => ({ key, label, hint })),
    notSearched: ['Settings'],
    session,
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

  const resolved = resolveQuestionScope(question, {
    startDate: startDate || context?.selection?.startDate,
    endDate: endDate || context?.selection?.endDate,
    locationName: locationName ?? context?.selection?.location,
    lastScope: context?.lastScope,
  });
  const rangeStart = resolved.startDate;
  const rangeEnd = resolved.endDate;
  const location = resolved.location;
  const hinted = [];
  if (isFollowUp(question)) {
    for (const key of context?.lastSources || []) hinted.push(key);
  }
  hinted.push(...keywordSources(question));
  const hintedKeys = [...new Set(hinted)].filter((key) => SOURCE_KEYS.has(key)).slice(0, 5);
  const hintedAllStores = resolved.allStores;
  const hintedScope = {
    allStores: hintedAllStores,
    location: hintedAllStores ? null : location,
    startDate: rangeStart,
    endDate: rangeEnd,
    tillDate: tillDateForQuestion(question, rangeEnd),
    txRowLimit: resolved.txRowLimit,
    fresh: isCorrection(question),
    question,
    tag: /\bquebec stores?\b/i.test(question) ? 'quebec-stores' : '',
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
    .slice(0, Math.max(0, 5 - hintedKeys.length));
  const allStores = hintedAllStores || (plan.allStores && !location);
  const extraScope = {
    allStores,
    location: allStores ? null : location,
    startDate: rangeStart,
    endDate: rangeEnd,
    tillDate: tillDateForQuestion(question, rangeEnd),
    txRowLimit: resolved.txRowLimit,
    fresh: isCorrection(question),
    question,
    tag: /\bquebec stores?\b/i.test(question) ? 'quebec-stores' : '',
  };
  const [hintedResult, extraResult] = await Promise.all([
    hintedLoad,
    extras.length ? loadChosenSources(session, extras, extraScope, onProgress) : Promise.resolve({}),
  ]);
  throwIfAborted(signal);

  const sources = [...new Set([...hintedKeys, ...extras])];
  const privacy = privateScopeNote(question, session);
  if (!sources.length) return privacy ? { sources: [], privacy } : null;
  const scope = {
    location: allStores ? null : location,
    startDate: rangeStart,
    endDate: rangeEnd,
    dateLabel: resolved.dateLabel,
    allStores,
  };
  return {
    sources,
    scope: {
      location: scope.location || 'All locations',
      startDate: rangeStart,
      endDate: rangeEnd,
      dateLabel: resolved.dateLabel,
    },
    privacy: privacy || undefined,
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
  extraContext,
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

  const framed = extraContext ? `${String(extraContext).trim()}\n\n${question}` : question;
  const modelQuestion = lookup
    ? `${framed}\n\nLookup:\n${JSON.stringify(lookup)}`
    : framed;
  const companyInstructions = await loadAiInstruction('chat');
  const seeds = companyInstructions
    ? seedMessages.map((message, index) =>
        index === 0
          ? {
              ...message,
              content: appendCompanyInstructions(message.content, companyInstructions, {
                figuresFrom: 'the Lookup JSON',
              }),
            }
          : message,
      )
    : seedMessages;
  const messages = [...seeds, ...history, { role: 'user', content: modelQuestion }];
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
    scope: lookup?.scope
      ? {
          location: lookup.scope.location === 'All locations' ? null : lookup.scope.location,
          startDate: lookup.scope.startDate,
          endDate: lookup.scope.endDate,
          dateLabel: lookup.scope.dateLabel,
        }
      : null,
    turns: [...history, { role: 'user', content: question }, { role: 'assistant', content: text || '' }],
  };
}

