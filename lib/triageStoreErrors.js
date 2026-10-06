/**
 * Store-level error rolls for the triage dashboard Stores page.
 * Period is a calendar month or a custom date range, same idea as Home / bonuses.
 */
import { currentReviewMonth, reviewMonthRange, reviewPeriodLabel } from './googleReviews';
import {
  HOME_PINNED_STORES,
  STORE_REGIONS,
  canonicalStoreName,
  filterStoresByRegion,
  regionKeyForStore,
  storesMatch,
} from './storeCatalog';
import { poDateKey } from './triageDailyReceipts';
import {
  cleanInsightStoreName,
  insightErrorType,
  itemNamesFromPo,
} from './triageInsights';
import { formatDateParam, parseDateParam, posCreatedByName, posEmployeeName } from './transactions';

export function errorAmountOf(row) {
  return Number(String(row?.review?.errorAmount || '').replace(/[^0-9.-]/g, '')) || 0;
}

export function errorTypeOf(row) {
  return insightErrorType(row?.review);
}

export function errorStoreName(row) {
  const name = canonicalStoreName(cleanInsightStoreName(row?.storeName) || row?.storeName);
  return name || 'Unknown store';
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

/** POS `created_by` — the staff who wrote the purchase, not a later editor. */
export function errorEmployeeName(row) {
  const name =
    posCreatedByName(row) ||
    cleanEmployeeLabel(row?.created_by) ||
    cleanEmployeeLabel(reviewHeaderEmployee(row, 'original')) ||
    posEmployeeName(row) ||
    cleanEmployeeLabel(reviewHeaderEmployee(row, 'value')) ||
    posCreatedByName(row?.review);
  return name || 'Unspecified';
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
  const employeeRows = rankByCount(employees).map((row) => {
    const person = employees.get(row.label);
    const typeRows = rankByCount(person?.types || new Map());
    return {
      name: row.label,
      count: row.count,
      amount: row.amount,
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
  };
}

/** Every pinned store plus any extra store that has errors in the month. */
export function listStoreErrorSummaries(errorRows, month) {
  const monthRows = filterErrorRowsForMonth(errorRows, month);
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

/**
 * Region rolls for the triage home: error rate across the region's stores,
 * plus this region's error dollars against every other region.
 */
export function listRegionErrorSummaries(errorRows, period, evaluatedRows) {
  const stores = listStoreErrorSummaries(errorRows, period);
  const periodErrors = filterErrorRowsForMonth(errorRows, period);
  const periodEvaluated = filterErrorRowsForMonth(evaluatedRows, period);
  const totalCount = periodErrors.length;
  const totalAmount = periodErrors.reduce((sum, row) => sum + errorAmountOf(row), 0);
  const totalEvaluated = periodEvaluated.length;

  const evaluatedByRegion = new Map();
  for (const row of periodEvaluated) {
    const key = regionKeyForStore(errorStoreName(row));
    evaluatedByRegion.set(key, (evaluatedByRegion.get(key) || 0) + 1);
  }

  const regions = STORE_REGIONS.map((region) => {
    const regionStores = filterStoresByRegion(stores, region.key);
    const count = regionStores.reduce((sum, row) => sum + (row.count || 0), 0);
    const amount = regionStores.reduce((sum, row) => sum + (row.amount || 0), 0);
    const evaluated = evaluatedByRegion.get(region.key) || 0;
    return {
      key: region.key,
      label: region.label,
      stores: regionStores,
      storeCount: regionStores.length,
      count,
      amount,
      evaluated,
      rate: evaluated ? count / evaluated : 0,
      share: totalCount ? count / totalCount : 0,
      otherCount: Math.max(0, totalCount - count),
      otherAmount: Math.max(0, totalAmount - amount),
    };
  });

  return {
    regions,
    totals: {
      count: totalCount,
      amount: totalAmount,
      evaluated: totalEvaluated,
      rate: totalEvaluated ? totalCount / totalEvaluated : 0,
      stores: stores.length,
    },
  };
}

export { currentReviewMonth, reviewPeriodLabel };
