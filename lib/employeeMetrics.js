import { findStaffByEmployeeName, getCategory, normalizeAppRole } from './permissions';
import { getSupabase } from './supabase';
import { formatAmount, formatDateParam, parseDateParam } from './transactions';

export function jobRoleLabel(person) {
  const role = normalizeAppRole(person?.appRole);
  const category = getCategory(role);
  if (!category) return '';
  if (role === 'general_manager' && person?.isSystemAdmin) {
    return `${category.label} · System Admin`;
  }
  return category.label;
}

const EXCLUDED_STORES = [
  'storage',
  'umicore',
  'workshop',
  'rcm pooled',
  'in transit',
  'westgate',
  'pmx',
  '3rd party',
];

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const DIMENSIONS = [
  { key: 'store', label: 'Store' },
  { key: 'employee', label: 'Employee' },
  { key: 'role', label: 'Role' },
  { key: 'weekday', label: 'Day of week' },
  { key: 'date', label: 'Date' },
  { key: 'txType', label: 'Buy / Sell' },
];

export const MEASURES = [
  {
    key: 'staffDays',
    label: 'Work days',
    format: 'int',
    hint: 'Calendar days this person posted retail work. One day counts once, even at more than one store.',
  },
  { key: 'people', label: 'Employees', format: 'int', hint: 'Unique employees in the slice' },
  { key: 'transactions', label: 'Transactions', format: 'int' },
  { key: 'volume', label: 'Volume', format: 'money' },
  { key: 'buys', label: 'Buys', format: 'int' },
  { key: 'sells', label: 'Sells', format: 'int' },
  { key: 'buyVolume', label: 'Buy volume', format: 'money' },
  { key: 'sellVolume', label: 'Sell volume', format: 'money' },
  { key: 'avgTicket', label: 'Avg ticket', format: 'money' },
  { key: 'txPerStaffDay', label: 'Tx / work day', format: 'decimal' },
  {
    key: 'errors',
    label: 'Errors',
    format: 'int',
    hint: 'Purchases triage marked incorrect for that person',
  },
];

const COMPANION_MEASURES = ['staffDays', 'people', 'transactions', 'volume'];

function blankBucket() {
  return {
    staffDaySet: new Set(),
    peopleSet: new Set(),
    transactions: 0,
    volume: 0,
    buys: 0,
    sells: 0,
    buyVolume: 0,
    sellVolume: 0,
    errors: 0,
  };
}

function addFact(bucket, fact) {
  bucket.staffDaySet.add(`${fact.employee}\u0001${fact.date}`);
  bucket.peopleSet.add(fact.employee);
  if (fact.kind === 'error') {
    bucket.errors += 1;
    return;
  }
  bucket.transactions += 1;
  bucket.volume += fact.amount;
  if (fact.txType === 'Buy') {
    bucket.buys += 1;
    bucket.buyVolume += fact.amount;
  } else {
    bucket.sells += 1;
    bucket.sellVolume += fact.amount;
  }
}

function finishBucket(bucket) {
  const staffDays = bucket.staffDaySet.size;
  const people = bucket.peopleSet.size;
  return {
    staffDays,
    people,
    transactions: bucket.transactions,
    volume: bucket.volume,
    buys: bucket.buys,
    sells: bucket.sells,
    buyVolume: bucket.buyVolume,
    sellVolume: bucket.sellVolume,
    errors: bucket.errors,
    avgTicket: bucket.transactions ? bucket.volume / bucket.transactions : 0,
    txPerStaffDay: staffDays ? bucket.transactions / staffDays : 0,
  };
}

export function dimensionMeta(key) {
  return DIMENSIONS.find((item) => item.key === key) || null;
}

export function measureMeta(key) {
  return MEASURES.find((item) => item.key === key) || MEASURES[0];
}

export function weekdayName(value) {
  return WEEKDAYS[parseDateParam(value).getDay()] || '—';
}

export function isRetailStore(name) {
  const key = String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  if (!key || key === '—') return false;
  return !EXCLUDED_STORES.some((item) => key === item || key.includes(item));
}

export function factsFromTransactions(rows, staff = [], { storeFilter } = {}) {
  const lock = String(storeFilter || '').trim();
  const facts = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const store = String(row?.storeName || '').trim() || '—';
    if (!isRetailStore(store)) continue;
    if (lock && store.localeCompare(lock, undefined, { sensitivity: 'base' }) !== 0) continue;
    const employee = String(row?.employeeName || '').trim() || '—';
    const person = findStaffByEmployeeName(staff, employee);
    const date = formatDateParam(row?.date);
    facts.push({
      employee,
      employeeId: person?.id || '',
      store,
      homeStore: String(person?.locationName || '').trim(),
      role: jobRoleLabel(person),
      date,
      weekday: weekdayName(date),
      txType: row?.type === 'purchase' ? 'Buy' : 'Sell',
      amount: Number(row?.amount) || 0,
    });
  }
  return facts;
}

function reviewIsError(review) {
  if (!review || typeof review !== 'object') return false;
  if (Array.isArray(review.corrections) && review.corrections.length > 0) return true;
  if (String(review.note || '').trim()) return true;
  if (String(review.errorType || '').trim()) return true;
  if (String(review.errorAmount || '').trim()) return true;
  return false;
}

function reviewHeader(review, key) {
  const field = (review?.draft?.header || []).find((entry) => entry.key === key);
  return String(field?.value ?? '').trim();
}

function reviewErrorType(review) {
  const type = String(review?.errorType || '').trim();
  if (type) return type;
  const corrections = Array.isArray(review?.corrections) ? review.corrections : [];
  if (corrections.length) {
    const labels = corrections.map((item) => String(item?.label || '').toLowerCase());
    if (labels.some((label) => /\bqty\b|quantity/.test(label))) return 'Wrong quantity';
    if (labels.some((label) => /price|amount|unit/.test(label))) return 'Wrong price';
    if (labels.some((label) => /customer|client/.test(label))) return 'Wrong customer';
    if (labels.some((label) => /payment/.test(label))) return 'Wrong payment';
    if (labels.some((label) => /name|item/.test(label))) return 'Wrong item';
    return corrections[0].label || 'Unspecified';
  }
  if (String(review?.note || '').trim()) return 'Note only';
  return 'Unspecified';
}

function reviewDateKey(review, fallback) {
  const raw = reviewHeader(review, 'date') || review?.dateLabel || review?.date || fallback;
  const text = String(raw || '').trim();
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const parsed = Date.parse(text);
  if (!Number.isNaN(parsed)) return formatDateParam(new Date(parsed));
  const fallbackText = String(fallback || '').trim();
  const fallbackIso = fallbackText.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (fallbackIso) return `${fallbackIso[1]}-${fallbackIso[2]}-${fallbackIso[3]}`;
  const fallbackParsed = Date.parse(fallbackText);
  if (!Number.isNaN(fallbackParsed)) return formatDateParam(new Date(fallbackParsed));
  return '';
}

export function errorFactsFromReviews(rows, staff = [], { storeFilter, startDate, endDate } = {}) {
  const lock = String(storeFilter || '').trim();
  const facts = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const review = row?.payload?.review || row?.review || null;
    if (!reviewIsError(review)) continue;
    const employee =
      reviewHeader(review, 'employee') || String(review.employeeName || row?.employeeName || '').trim();
    if (!employee || employee === '—') continue;
    const store =
      reviewHeader(review, 'store') || String(review.storeName || row?.storeName || '').trim() || '—';
    if (lock && store !== '—' && store.localeCompare(lock, undefined, { sensitivity: 'base' }) !== 0) {
      continue;
    }
    const date = reviewDateKey(review, row?.updated_at || row?.updatedAt);
    if (!date) continue;
    if (startDate && date < startDate) continue;
    if (endDate && date > endDate) continue;
    const person = findStaffByEmployeeName(staff, employee);
    facts.push({
      kind: 'error',
      employee,
      employeeId: person?.id || '',
      store,
      homeStore: String(person?.locationName || '').trim(),
      role: jobRoleLabel(person),
      date,
      weekday: weekdayName(date),
      txType: 'Buy',
      amount: 0,
      errorType: reviewErrorType(review),
    });
  }
  return facts;
}

export async function listTriageErrorFacts(staff = [], options = {}) {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase.from('triage_reviews').select('id, payload, updated_at');
    if (error || !Array.isArray(data)) return [];
    return errorFactsFromReviews(data, staff, options);
  } catch {
    return [];
  }
}

function dimValue(fact, key) {
  if (!key) return '';
  return String(fact?.[key] || '—');
}

function compareDim(key, a, b) {
  if (key === 'weekday') return WEEKDAYS.indexOf(a) - WEEKDAYS.indexOf(b);
  if (key === 'date') return String(a).localeCompare(String(b));
  if (key === 'txType') return String(a).localeCompare(String(b));
  return String(a).localeCompare(String(b), undefined, { sensitivity: 'base' });
}

function sortKeys(keys, dim) {
  return keys.slice().sort((a, b) => compareDim(dim, a, b));
}

function topStore(rowKey, rowDim, rowHomeStore, rowStoreCounts) {
  if (rowDim === 'store') return rowKey;
  const home = rowHomeStore.get(rowKey);
  if (home) return home;
  const counts = rowStoreCounts.get(rowKey);
  if (!counts?.size) return '';
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
}

export function pivotFacts(facts, { groupBy = 'store', thenBy = '', measure = 'staffDays' } = {}) {
  const rowDim = DIMENSIONS.some((item) => item.key === groupBy) ? groupBy : 'store';
  const colDim = DIMENSIONS.some((item) => item.key === thenBy) && thenBy !== rowDim ? thenBy : '';
  const measureKey = MEASURES.some((item) => item.key === measure) ? measure : 'staffDays';

  const cells = new Map();
  const rowTotals = new Map();
  const colTotals = new Map();
  const rowRoles = new Map();
  const rowHomeStore = new Map();
  const rowStoreCounts = new Map();
  const grand = blankBucket();

  for (const fact of facts) {
    const rowKey = dimValue(fact, rowDim);
    const colKey = colDim ? dimValue(fact, colDim) : '';
    const cellKey = `${rowKey}\u0001${colKey}`;
    if (!cells.has(cellKey)) cells.set(cellKey, blankBucket());
    if (!rowTotals.has(rowKey)) rowTotals.set(rowKey, blankBucket());
    if (colDim && !colTotals.has(colKey)) colTotals.set(colKey, blankBucket());
    if (!rowRoles.has(rowKey)) rowRoles.set(rowKey, fact.role || '');
    if (fact.homeStore && !rowHomeStore.has(rowKey)) rowHomeStore.set(rowKey, fact.homeStore);
    const storeCounts = rowStoreCounts.get(rowKey) || new Map();
    storeCounts.set(fact.store, (storeCounts.get(fact.store) || 0) + 1);
    rowStoreCounts.set(rowKey, storeCounts);
    addFact(cells.get(cellKey), fact);
    addFact(rowTotals.get(rowKey), fact);
    if (colDim) addFact(colTotals.get(colKey), fact);
    addFact(grand, fact);
  }

  const rowKeys = sortKeys(Array.from(rowTotals.keys()), rowDim);
  const colKeys = colDim ? sortKeys(Array.from(colTotals.keys()), colDim) : [];

  const timed = rowDim === 'date' || rowDim === 'weekday';
  if (!timed) {
    rowKeys.sort((a, b) => {
      const delta = (finishBucket(rowTotals.get(b))[measureKey] || 0) - (finishBucket(rowTotals.get(a))[measureKey] || 0);
      return delta || compareDim(rowDim, a, b);
    });
  }

  const rows = rowKeys.map((rowKey) => {
    const total = finishBucket(rowTotals.get(rowKey));
    const values = {};
    colKeys.forEach((colKey) => {
      const bucket = cells.get(`${rowKey}\u0001${colKey}`);
      values[colKey] = bucket ? finishBucket(bucket) : finishBucket(blankBucket());
    });
    return {
      key: rowKey,
      role: rowRoles.get(rowKey) || '',
      store: topStore(rowKey, rowDim, rowHomeStore, rowStoreCounts),
      total,
      values,
    };
  });

  return {
    rowDim,
    colDim,
    measure: measureKey,
    rowKeys,
    colKeys,
    rows,
    colTotals: Object.fromEntries(colKeys.map((key) => [key, finishBucket(colTotals.get(key))])),
    grand: finishBucket(grand),
  };
}

export function formatMeasure(value, format) {
  const n = Number(value) || 0;
  if (format === 'money') return formatAmount(n);
  if (format === 'decimal') return n.toLocaleString('en-CA', { maximumFractionDigits: 1 });
  return String(Math.round(n));
}

export function tableColumns(pivot) {
  const measure = measureMeta(pivot.measure);
  const companions = COMPANION_MEASURES.filter((key) => key !== pivot.measure).slice(0, 3);
  return {
    measure,
    companions: companions.map((key) => measureMeta(key)),
  };
}

export const INSIGHT_MEASURES = [
  { key: 'volume', label: 'Volume' },
  { key: 'transactions', label: 'Transactions' },
  { key: 'errors', label: 'Errors' },
  { key: 'staffDays', label: 'Work days' },
  { key: 'avgTicket', label: 'Avg ticket' },
  { key: 'txPerStaffDay', label: 'Tx / work day' },
];

function rankFor(rows, name, measureKey) {
  const sorted = rows
    .slice()
    .sort((a, b) => (b.total[measureKey] || 0) - (a.total[measureKey] || 0) || a.key.localeCompare(b.key));
  const index = sorted.findIndex((row) => row.key === name);
  const mine = index >= 0 ? sorted[index] : null;
  return {
    rank: index >= 0 ? index + 1 : null,
    of: sorted.length,
    value: mine?.total?.[measureKey] || 0,
  };
}

export function buildEmployeeInsight(facts, employeeName) {
  const name = String(employeeName || '').trim();
  const mine = (facts || []).filter((fact) => fact.employee === name);
  if (!name || !mine.length) return null;

  const peers = pivotFacts(facts, { groupBy: 'employee', measure: 'volume' });
  const me = peers.rows.find((row) => row.key === name);
  const ranks = Object.fromEntries(INSIGHT_MEASURES.map((item) => [item.key, rankFor(peers.rows, name, item.key)]));
  const mistakes = mine.filter((fact) => fact.kind === 'error');
  const errorTypes = {};
  for (const fact of mistakes) {
    const type = fact.errorType || 'Unspecified';
    errorTypes[type] = (errorTypes[type] || 0) + 1;
  }

  return {
    name,
    role: me?.role || mine[0].role || '',
    store: me?.store || mine[0].homeStore || mine[0].store || '',
    totals: me?.total || finishBucket(blankBucket()),
    ranks,
    peers: peers.rows,
    errors: mistakes.length,
    errorTypes: Object.entries(errorTypes)
      .map(([key, value]) => ({ key, value }))
      .sort((a, b) => b.value - a.value || a.key.localeCompare(b.key)),
    byDate: pivotFacts(mine, { groupBy: 'date', measure: 'volume' }),
    byWeekday: pivotFacts(mine, { groupBy: 'weekday', measure: 'volume' }),
    byStore: pivotFacts(mine, { groupBy: 'store', measure: 'volume' }),
    byType: pivotFacts(mine.filter((fact) => fact.kind !== 'error'), { groupBy: 'txType', measure: 'volume' }),
  };
}

export function chartSeries(pivot) {
  const measure = pivot.measure;
  return pivot.rows.map((row) => ({
    key: row.key,
    label:
      pivot.rowDim === 'employee' && row.role && row.role !== row.key
        ? `${row.key} · ${row.role}`
        : row.key,
    value: Number(row.total[measure]) || 0,
  }));
}

