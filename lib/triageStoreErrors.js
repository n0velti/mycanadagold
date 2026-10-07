/**
 * Store-level error rolls for the triage dashboard.
 * Every recorded error is included — the list is not filtered by calendar.
 */
import { currentReviewMonth, reviewMonthRange, reviewPeriodLabel } from './googleReviews';
import { listBonusRoster } from './bonusRoster';
import { findEmployeeRosterPerson } from './employeeRoster';
import { findStaffByEmployeeName, staffDisplayName } from './permissions';
import {
  HOME_PINNED_STORES,
  STORE_REGIONS,
  canonicalStoreName,
  pinnedStoresForRegion,
  regionKeyForStore,
  storeNameInRegion,
  storeRegionByKey,
  storesMatch,
} from './storeCatalog';
import { poDateKey } from './triageDailyReceipts';
import {
  errorAttributionStore,
  insightErrorType,
  itemNamesFromPo,
  poNeedsCorrection,
  reviewNeedsCorrection,
} from './triageInsights';
import { formatDateParam, parseDateParam, posCreatedByName, posEmployeeName } from './transactions';

export function errorAmountOf(row) {
  return Number(String(row?.review?.errorAmount || '').replace(/[^0-9.-]/g, '')) || 0;
}

export function errorTypeOf(row) {
  return insightErrorType(row?.review);
}

export function errorStoreName(row) {
  return errorAttributionStore(row, row?.storeName);
}

function reviewHeaderEmployee(row, key) {
  const field = (row?.review?.draft?.header || []).find((entry) => entry?.key === 'employee');
  return String(field?.[key] ?? '').trim();
}

function cleanEmployeeLabel(value) {
  const text = String(value || '').trim();
  if (!text || text === '—' || text === '[object Object]') return '';
  return text;
}

function createdByRaw(row) {
  return (
    posCreatedByName(row) ||
    cleanEmployeeLabel(row?.created_by) ||
    cleanEmployeeLabel(row?.createdBy) ||
    cleanEmployeeLabel(reviewHeaderEmployee(row, 'original')) ||
    posEmployeeName(row) ||
    cleanEmployeeLabel(row?.employeeName) ||
    cleanEmployeeLabel(reviewHeaderEmployee(row, 'value')) ||
    posCreatedByName(row?.review)
  );
}

function rosterPersonName(person) {
  return staffDisplayName(person) || String(person?.fullName || '').trim();
}

// The HR roster is a static list and the (name, store) pairs seen on POs are
// few, but the fuzzy match behind findStaffByEmployeeName costs thousands of
// locale compares per call. Resolve each pair once.
let bonusRosterCache = null;
const bonusRosterByStore = new Map();
const employeeMatchCache = new Map();
const EMPLOYEE_MATCH_CACHE_LIMIT = 5000;

function bonusRoster() {
  if (!bonusRosterCache) bonusRosterCache = listBonusRoster();
  return bonusRosterCache;
}

function bonusRosterAtStore(storeName) {
  const roster = bonusRoster();
  if (!storeName) return roster;
  const key = canonicalStoreName(storeName) || String(storeName);
  let list = bonusRosterByStore.get(key);
  if (!list) {
    list = roster.filter((person) => storesMatch(person.locationName, storeName));
    bonusRosterByStore.set(key, list);
  }
  return list;
}

const companyMatchCache = new Map();

/** Company-wide lookup (no store preference); depends only on the name. */
function matchCompanyEmployee(name) {
  if (companyMatchCache.has(name)) return companyMatchCache.get(name);
  const person = findStaffByEmployeeName(bonusRoster(), name) || findEmployeeRosterPerson(name) || null;
  if (companyMatchCache.size >= EMPLOYEE_MATCH_CACHE_LIMIT) companyMatchCache.clear();
  companyMatchCache.set(name, person);
  return person;
}

/** Match POS `created_by` to the same HR employee list bonuses uses. */
function matchBonusEmployeeName(raw, storeName) {
  const name = cleanEmployeeLabel(raw);
  if (!name) return '';
  const store = String(storeName || '');
  const cacheKey = `${name}\u0000${store}`;
  const cached = employeeMatchCache.get(cacheKey);
  if (cached !== undefined) return cached;
  const person = findStaffByEmployeeName(bonusRosterAtStore(store), name) || matchCompanyEmployee(name);
  const matched = rosterPersonName(person);
  if (employeeMatchCache.size >= EMPLOYEE_MATCH_CACHE_LIMIT) employeeMatchCache.clear();
  employeeMatchCache.set(cacheKey, matched);
  return matched;
}

/** POS `created_by` — the staff who wrote the purchase, resolved to a roster name. */
export function errorEmployeeName(row) {
  const raw = createdByRaw(row);
  const matched = matchBonusEmployeeName(raw, errorStoreName(row) || row?.storeName);
  return matched || raw || 'Unspecified';
}

export function errorDateKey(row) {
  const fromPo = poDateKey(row);
  if (fromPo) return fromPo;
  const lotDay = String(row?.lot?.dateKey || '');
  if (/^\d{4}-\d{2}-\d{2}/.test(lotDay)) return lotDay.slice(0, 10);
  const triageDay = String(row?.triageDateKey || '');
  if (/^\d{4}-\d{2}-\d{2}/.test(triageDay)) return triageDay.slice(0, 10);
  return '';
}

export function rowInPeriod(row, period) {
  const day = errorDateKey(row);
  if (!day || !period?.startDate || !period?.endDate) return false;
  return day >= period.startDate && day <= period.endDate;
}

export const rowInMonth = rowInPeriod;

export function currentErrorPeriod() {
  return { ...currentReviewMonth(), mode: 'month' };
}

export function errorPeriodFromDates(start, end, preferredMode) {
  const startDate = formatDateParam(start);
  const endDate = formatDateParam(end || start);
  const first = startDate <= endDate ? startDate : endDate;
  const last = startDate <= endDate ? endDate : startDate;
  const startDay = parseDateParam(first);
  const month = reviewMonthRange(startDay.getFullYear(), startDay.getMonth());
  const coversMonth = first === month.startDate && last === month.endDate;
  if (preferredMode === 'month' || (preferredMode !== 'range' && coversMonth)) {
    return { ...month, mode: 'month' };
  }
  return {
    startDate: first,
    endDate: last,
    label: reviewPeriodLabel(first, last, first === last ? 'day' : 'range'),
    mode: first === last ? 'day' : 'range',
  };
}

export function shiftErrorPeriod(period, delta) {
  const start = parseDateParam(period?.startDate || currentReviewMonth().startDate);
  if (period?.mode === 'range' || period?.mode === 'day') {
    const end = parseDateParam(period?.endDate || period?.startDate);
    const span = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
    const nextStart = new Date(start.getFullYear(), start.getMonth(), start.getDate() + delta * span);
    const nextEnd = new Date(nextStart.getFullYear(), nextStart.getMonth(), nextStart.getDate() + span - 1);
    const today = parseDateParam(new Date());
    if (formatDateParam(nextStart) > formatDateParam(today)) return period;
    return errorPeriodFromDates(nextStart, nextEnd > today ? today : nextEnd, 'range');
  }
  const next = reviewMonthRange(start.getFullYear(), start.getMonth() + delta);
  if (next.startDate > currentReviewMonth().startDate) return period;
  return { ...next, mode: 'month' };
}

export function canAdvanceErrorPeriod(period) {
  const start = parseDateParam(period?.startDate || currentReviewMonth().startDate);
  if (period?.mode === 'range' || period?.mode === 'day') {
    const today = formatDateParam(new Date());
    return period.endDate < today;
  }
  const next = reviewMonthRange(start.getFullYear(), start.getMonth() + 1);
  return next.startDate <= currentReviewMonth().startDate;
}

export function shiftErrorMonth(month, delta) {
  return shiftErrorPeriod({ ...month, mode: 'month' }, delta);
}

export function canAdvanceErrorMonth(month) {
  return canAdvanceErrorPeriod({ ...month, mode: 'month' });
}

function rankByCount(map) {
  return [...map.entries()]
    .map(([label, value]) => {
      const count = typeof value === 'number' ? value : value.count;
      const amount = typeof value === 'number' ? 0 : value.amount || 0;
      return { label, count, amount };
    })
    .sort(
      (a, b) =>
        b.count - a.count ||
        b.amount - a.amount ||
        a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }),
    );
}

function withPercents(rows, total) {
  const denom = Number(total) || 0;
  return (rows || []).map((row) => ({
    ...row,
    percent: denom ? row.count / denom : 0,
  }));
}

export function valueBandOf(amount) {
  const n = Number(amount) || 0;
  if (n <= 0) return 'No amount';
  if (n < 50) return 'Under $50';
  if (n < 250) return '$50–$249';
  if (n < 1000) return '$250–$999';
  return '$1,000+';
}

function sortStoreRows(rows) {
  return rows.slice().sort((a, b) => {
    const ai = HOME_PINNED_STORES.findIndex((store) => storesMatch(store, a.store));
    const bi = HOME_PINNED_STORES.findIndex((store) => storesMatch(store, b.store));
    if (ai >= 0 && bi >= 0) return ai - bi;
    if (ai >= 0) return -1;
    if (bi >= 0) return 1;
    return a.store.localeCompare(b.store, undefined, { sensitivity: 'base' });
  });
}

export function filterErrorRowsForMonth(rows, period) {
  return (rows || []).filter((row) => rowInPeriod(row, period));
}

export function summarizeStoreErrors(rows) {
  const list = rows || [];
  const types = new Map();
  const employees = new Map();
  const items = new Map();
  const values = new Map();
  let amount = 0;

  for (const row of list) {
    const value = errorAmountOf(row);
    amount += value;

    const type = errorTypeOf(row) || 'Unspecified';
    const typeEntry = types.get(type) || { count: 0, amount: 0 };
    typeEntry.count += 1;
    typeEntry.amount += value;
    types.set(type, typeEntry);

    const employee = errorEmployeeName(row);
    const person = employees.get(employee) || { count: 0, amount: 0, types: new Map() };
    person.count += 1;
    person.amount += value;
    const typeBucket = person.types.get(type) || { count: 0, amount: 0 };
    typeBucket.count += 1;
    typeBucket.amount += value;
    person.types.set(type, typeBucket);
    employees.set(employee, person);

    const band = valueBandOf(value);
    const valueEntry = values.get(band) || { count: 0, amount: 0 };
    valueEntry.count += 1;
    valueEntry.amount += value;
    values.set(band, valueEntry);

    const names = itemNamesFromPo(row);
    const seen = new Set();
    for (const name of names) {
      const key = String(name || '').trim();
      if (!key) continue;
      const fold = key.toLowerCase();
      if (seen.has(fold)) continue;
      seen.add(fold);
      const item = items.get(fold) || { label: key, count: 0, amount: 0 };
      item.count += 1;
      item.amount += value;
      items.set(fold, item);
    }
  }

  const typeRows = withPercents(rankByCount(types), list.length);
  const itemRows = withPercents(
    rankByCount(items).map((row) => ({
      ...row,
      label: items.get(row.label)?.label || row.label,
    })),
    list.length,
  );
  const valueRows = withPercents(rankByCount(values), list.length);
  const employeeRows = withPercents(rankByCount(employees), list.length).map((row) => {
    const person = employees.get(row.label);
    const typeRows = rankByCount(person?.types || new Map());
    return {
      name: row.label,
      count: row.count,
      amount: row.amount,
      percent: row.percent,
      type: typeRows[0]?.label || 'Unspecified',
      types: typeRows.map((entry) => ({ label: entry.label, count: entry.count })),
    };
  });

  return {
    rows: list,
    count: list.length,
    amount,
    average: list.length ? amount / list.length : 0,
    types: typeRows,
    topType: typeRows[0] || null,
    employees: employeeRows,
    items: itemRows,
    values: valueRows,
  };
}

/** Home list: pinned stores plus error counts. No lot / analytics work. */
export function listStoreErrorCounts(triage) {
  const byKey = new Map();
  const ensure = (name) => {
    const store = canonicalStoreName(name) || name || 'Unknown store';
    const key = store.toLowerCase();
    if (!byKey.has(key)) byKey.set(key, { store, count: 0, amount: 0 });
    return byKey.get(key);
  };

  for (const name of HOME_PINNED_STORES) ensure(name);

  for (const transfer of Array.isArray(triage) ? triage : []) {
    for (const store of transfer.stores || []) {
      const fallback = store?.name || store?.storeKey;
      for (const item of store.meltPos || []) {
        if (!poNeedsCorrection(item)) continue;
        const entry = ensure(errorStoreName({ ...item, storeName: item.storeName || fallback }));
        entry.count += 1;
        entry.amount += errorAmountOf(item);
      }
    }
  }

  return sortStoreRows([...byKey.values()]);
}

/** Every pinned store plus any extra store that has recorded errors. */
export function listStoreErrorSummaries(errorRows) {
  const monthRows = errorRows || [];
  const byKey = new Map();

  const ensure = (name) => {
    const store = canonicalStoreName(name) || name || 'Unknown store';
    const key = store.toLowerCase();
    if (!byKey.has(key)) {
      byKey.set(key, { store, rows: [], count: 0, amount: 0 });
    }
    return byKey.get(key);
  };

  for (const name of HOME_PINNED_STORES) ensure(name);

  for (const row of monthRows) {
    const entry = ensure(errorStoreName(row));
    entry.rows.push(row);
    entry.count += 1;
    entry.amount += errorAmountOf(row);
  }

  return sortStoreRows(
    [...byKey.values()].map((entry) => ({
      ...entry,
      ...summarizeStoreErrors(entry.rows),
    })),
  );
}

export function storeErrorSummary(summaries, storeName) {
  return (summaries || []).find((row) => storesMatch(row.store, storeName)) || null;
}

export function poInStore(row, storeName) {
  if (!storeName) return true;
  return storesMatch(errorStoreName(row) || row?.storeName || row?.location, storeName);
}

export function poInRegion(row, regionKey) {
  if (!regionKey) return true;
  return storeNameInRegion(errorStoreName(row) || row?.storeName || row?.location, regionKey);
}

export function transferInRegion(row, regionKey) {
  if (!regionKey) return true;
  return storeNameInRegion(row?.fromName, regionKey) || storeNameInRegion(row?.toName, regionKey);
}

function rankRegions(regions, getValue) {
  const sorted = [...regions].sort(
    (a, b) =>
      getValue(b) - getValue(a) ||
      a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }),
  );
  const ranks = new Map();
  let rank = 0;
  let previous = null;
  sorted.forEach((row, index) => {
    const value = getValue(row);
    if (previous == null || value !== previous) rank = index + 1;
    ranks.set(row.key, rank);
    previous = value;
  });
  return ranks;
}

export function formatOrdinal(value) {
  const n = Number(value) || 0;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  if (n % 10 === 1) return `${n}st`;
  if (n % 10 === 2) return `${n}nd`;
  if (n % 10 === 3) return `${n}rd`;
  return `${n}th`;
}

function isIncorrectRow(row) {
  if (typeof row?.incorrect === 'boolean') return row.incorrect;
  return reviewNeedsCorrection(row?.review);
}

/**
 * Region rolls for the triage home.
 *
 * Error % is the pooled rate for the region: flagged (incorrect) evaluated
 * POs ÷ all evaluated POs in the selected period. Dollar figure is the sum
 * of review.errorAmount on those flagged POs. Comparison is rank + share of
 * company-wide error dollars.
 */
export function listRegionErrorSummaries(evaluatedRows) {
  const periodRows = evaluatedRows || [];
  const regions = STORE_REGIONS.map((region) => {
    const listed = pinnedStoresForRegion(region.key);
    return {
      key: region.key,
      label: region.label,
      stores: listed.slice(),
      storeSet: new Set(listed.map((name) => canonicalStoreName(name) || name)),
      rows: [],
      evaluated: 0,
      count: 0,
      amount: 0,
    };
  });
  const byKey = new Map(regions.map((row) => [row.key, row]));

  for (const row of periodRows) {
    const entry = byKey.get(regionKeyForStore(errorStoreName(row)));
    if (!entry) continue;
    entry.evaluated += 1;
    entry.rows.push(row);
    const store = errorStoreName(row);
    if (store) entry.storeSet.add(store);
    if (isIncorrectRow(row)) {
      entry.count += 1;
      entry.amount += errorAmountOf(row);
    }
  }

  const totals = regions.reduce(
    (acc, row) => {
      acc.evaluated += row.evaluated;
      acc.count += row.count;
      acc.amount += row.amount;
      return acc;
    },
    { evaluated: 0, count: 0, amount: 0 },
  );
  totals.errorRate = totals.evaluated ? totals.count / totals.evaluated : 0;

  const summarized = regions.map((row) => {
    const stores = [...row.storeSet].filter(Boolean);
    return {
      key: row.key,
      label: row.label,
      stores,
      storeCount: stores.length,
      rows: row.rows,
      evaluated: row.evaluated,
      count: row.count,
      amount: row.amount,
      errorRate: row.evaluated ? row.count / row.evaluated : 0,
    };
  });

  const amountRanks = rankRegions(summarized, (row) => row.amount);
  const rateRanks = rankRegions(summarized, (row) => row.errorRate);
  const regionCount = summarized.length;

  return {
    regions: summarized.map((row) => ({
      ...row,
      amountShare: totals.amount ? row.amount / totals.amount : 0,
      countShare: totals.count ? row.count / totals.count : 0,
      amountRank: amountRanks.get(row.key) || regionCount,
      rateRank: rateRanks.get(row.key) || regionCount,
      regionCount,
    })),
    totals,
  };
}

export function regionErrorSummary(snapshot, regionKey) {
  const key = String(regionKey || '').trim();
  if (!key) return null;
  return (snapshot?.regions || []).find((row) => row.key === key) || storeRegionByKey(key);
}

export { currentReviewMonth, reviewPeriodLabel };
