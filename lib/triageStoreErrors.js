/**
 * Store-level error rolls for the triage dashboard Stores page.
 * Month window matches bonuses (full calendar month, current month clipped to today).
 */
import { currentReviewMonth, reviewMonthRange } from './googleReviews';
import { HOME_PINNED_STORES, canonicalStoreName, storesMatch } from './storeCatalog';
import { poDateKey } from './triageDailyReceipts';
import {
  cleanInsightStoreName,
  insightErrorType,
  productKindsFromPo,
} from './triageInsights';
import { parseDateParam } from './transactions';

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

export function errorEmployeeName(row) {
  const name = String(row?.employeeName || '').trim();
  return name && name !== '—' ? name : 'Unspecified';
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

export function rowInMonth(row, month) {
  const day = errorDateKey(row);
  if (!day || !month?.startDate || !month?.endDate) return false;
  return day >= month.startDate && day <= month.endDate;
}

export function shiftErrorMonth(month, delta) {
  const start = parseDateParam(month?.startDate || currentReviewMonth().startDate);
  const next = reviewMonthRange(start.getFullYear(), start.getMonth() + delta);
  const current = currentReviewMonth();
  if (next.startDate > current.startDate) return month;
  return next;
}

export function canAdvanceErrorMonth(month) {
  const start = parseDateParam(month?.startDate || currentReviewMonth().startDate);
  const next = reviewMonthRange(start.getFullYear(), start.getMonth() + 1);
  return next.startDate <= currentReviewMonth().startDate;
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

export function filterErrorRowsForMonth(rows, month) {
  return (rows || []).filter((row) => rowInMonth(row, month));
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
    const person = employees.get(employee) || { count: 0, amount: 0 };
    person.count += 1;
    person.amount += value;
    employees.set(employee, person);

    const kinds = productKindsFromPo(row);
    const seen = new Set();
    for (const kind of kinds) {
      const key = String(kind || 'Unspecified').trim() || 'Unspecified';
      if (seen.has(key)) continue;
      seen.add(key);
      const item = items.get(key) || { count: 0, amount: 0 };
      item.count += 1;
      item.amount += value;
      items.set(key, item);
    }
  }

  const typeRows = withPercents(rankByCount(types), list.length);
  const itemRows = withPercents(rankByCount(items), list.length);
  const employeeRows = rankByCount(employees).map((row) => ({
    name: row.label,
    count: row.count,
    amount: row.amount,
  }));

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

export { currentReviewMonth };
