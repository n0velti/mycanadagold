import { API_BASE_URL, authHeaders, getLinkedPosSessions, posFetch } from './auth';
import { fetchPosLocations } from './locations';
import {
  fetchCashPayments,
  formatAmount,
  summarizeCashTotals,
} from './payments';
import {
  formatDateParam,
  HOME_STORES,
  parseDateParam,
} from './transactions';

/** East POS Quebec retail stores. */
export const QUEBEC_STORES = ['Montreal', 'Quebec', 'Laval'];

/** Stores available in Audit → Cash. */
export const AUDIT_CASH_STORES = [...HOME_STORES, ...QUEBEC_STORES];

function getErrorMessage(payload, fallback) {
  return payload?.error?.message || payload?.message || fallback;
}

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

function namesMatch(a, b) {
  return (
    String(a || '')
      .trim()
      .localeCompare(String(b || '').trim(), undefined, { sensitivity: 'base' }) === 0
  );
}

/** Prefer GTA/PMX when East has a same-named non-retail location. */
function storeSystemRank(systemKey) {
  if (systemKey === 'gta' || systemKey === 'pmx') return 0;
  if (systemKey === 'east') return 1;
  return 2;
}

function isSellingLocation(location) {
  return location?.selling_location === 'Yes' || location?.selling_location === true;
}

function readMoney(row, keys) {
  if (!row || typeof row !== 'object') return null;
  for (const key of keys) {
    const raw = row[key];
    if (raw == null || raw === '') continue;
    const n = Number(raw);
    if (Number.isFinite(n)) return roundMoney(n);
  }
  return null;
}

function asObjectList(value) {
  if (Array.isArray(value)) return value.filter((row) => row && typeof row === 'object');
  if (value && typeof value === 'object') return [value];
  return [];
}

function nestedTillRows(row) {
  if (!row || typeof row !== 'object') return [];
  return [
    ...asObjectList(row.tills),
    ...asObjectList(row.cash_logs),
    ...asObjectList(row.till_logs),
  ].filter((child) => child !== row);
}

function cashLogRows(payload) {
  const roots = Array.isArray(payload)
    ? asObjectList(payload)
    : Array.isArray(payload?.data)
      ? asObjectList(payload.data)
      : Array.isArray(payload?.cash_logs)
        ? asObjectList(payload.cash_logs)
        : payload?.data && typeof payload.data === 'object'
          ? [payload.data]
          : payload && typeof payload === 'object'
            ? [payload]
            : [];
  const rows = [];
  for (const row of roots) {
    rows.push(row);
    for (const child of nestedTillRows(row)) rows.push(child);
  }
  return rows;
}

function logTillName(row) {
  return String(row?.till?.name || row?.till_name || row?.name || '').trim();
}

function logCurrency(row) {
  const fromField = String(row?.currency || row?.till?.currency || '').trim().toUpperCase();
  if (fromField === 'USD' || fromField === 'CAD') return fromField;
  if (isUsdName(logTillName(row))) return 'USD';
  return '';
}

function isUsdName(value) {
  return /\b(usd|us\$|us dollar|dollar us|devise us)\b/i.test(String(value || ''));
}

function isTillScopedLog(row) {
  if (!row || typeof row !== 'object') return false;
  return Boolean(
    row.till_id ||
      row.till?.id ||
      logTillName(row) ||
      logCurrency(row) === 'USD' ||
      logCurrency(row) === 'CAD',
  );
}

function isUsdCashLog(row) {
  if (!row) return false;
  if (logCurrency(row) === 'USD') return true;
  return isUsdName(logTillName(row));
}

function isCadTill1Log(row) {
  if (!row || isUsdCashLog(row)) return false;
  const till = logTillName(row);
  if (isUsdName(till)) return false;
  if (!till) return !isTillScopedLog(row);
  if (/till\s*1\b/i.test(till)) return true;
  if (/till\s*[2-9]\b/i.test(till)) return false;
  return logCurrency(row) !== 'USD';
}

function looksLikeCashLog(row) {
  if (!row || typeof row !== 'object') return false;
  return [
    'start_balance',
    'start_balance_usd',
    'physical',
    'physical_usd',
    'amount',
    'opening_balance',
    'opening',
    'currency',
  ].some((key) => row[key] != null && row[key] !== '');
}

/**
 * Aureus cash_logs is either one location object with CAD + USD fields,
 * or a list of per-till / per-currency rows.
 */
function parseCashLogs(payload, dateKey) {
  const rows = cashLogRows(payload);
  const root = rows[0] || {};
  const tillRows = rows.filter(isTillScopedLog);

  if (tillRows.length >= 2) {
    const cadRow =
      tillRows
        .filter((row) => !isUsdCashLog(row))
        .sort((a, b) => {
          const aTill1 = /till\s*1\b/i.test(logTillName(a)) ? 0 : 1;
          const bTill1 = /till\s*1\b/i.test(logTillName(b)) ? 0 : 1;
          if (aTill1 !== bTill1) return aTill1 - bTill1;
          const aId = a.till_id || a.till?.id ? 0 : 1;
          const bId = b.till_id || b.till?.id ? 0 : 1;
          return aId - bId;
        })[0] || null;
    const usdRow = tillRows.find(isUsdCashLog) || null;
    return {
      date: dateKey,
      startBalance:
        readMoney(cadRow, ['start_balance', 'startBalance', 'opening_balance', 'opening']) ?? 0,
      startBalanceUsd:
        readMoney(usdRow, [
          'start_balance_usd',
          'start_balance',
          'startBalance',
          'opening_balance',
          'opening',
        ]) ?? 0,
      physical: readMoney(cadRow, ['physical', 'physical_count', 'counted', 'amount']) ?? 0,
      physicalUsd:
        readMoney(usdRow, ['physical_usd', 'physical', 'physical_count', 'counted', 'amount']) ?? 0,
      raw: payload,
    };
  }

  return {
    date: dateKey,
    startBalance: readMoney(root, ['start_balance', 'startBalance']) ?? 0,
    startBalanceUsd: readMoney(root, ['start_balance_usd']) ?? 0,
    physical: readMoney(root, ['physical', 'physical_count']) ?? 0,
    physicalUsd: readMoney(root, ['physical_usd']) ?? 0,
    raw: payload,
  };
}

function pickClosing(physical, start) {
  if (physical != null && Math.abs(physical) >= 0.005) {
    return { closing: physical, source: 'physical' };
  }
  return { closing: start || 0, source: 'start_balance' };
}

export function shiftDateParam(date, days) {
  const next = parseDateParam(date);
  next.setDate(next.getDate() + days);
  return formatDateParam(next);
}

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function mapCashTransaction(row, system, storeName) {
  const amount = Number(row?.amount) || 0;
  const type = row?.type === 'In' ? 'In' : 'Out';
  return {
    id: `${system.key}-ctx-${row.id}`,
    sourceId: row.id,
    systemKey: system.key,
    systemLabel: system.label,
    date: row?.date || '',
    type,
    directionLabel: type === 'In' ? 'Till in' : 'Till out',
    amount,
    amountLabel: formatAmount(amount, row?.currency),
    signedAmount: type === 'In' ? amount : -amount,
    storeName: storeName || '—',
    locationId: row?.location_id ?? null,
    tillId: row?.till_id ?? row?.till?.id ?? null,
    tillName: row?.till?.name || '—',
    tillCurrency: row?.till?.currency || '',
    category: row?.category || 'Other',
    comments: row?.comments || '',
    currency: row?.currency || 'CAD',
    kind: 'cash_transaction',
  };
}

function isUsdCashRow(row) {
  const currency = String(row?.currency || '').trim().toUpperCase();
  const tillCurrency = String(row?.tillCurrency || '').trim().toUpperCase();
  if (currency === 'USD' || tillCurrency === 'USD') return true;
  return isUsdName(row?.tillName);
}

function isTill1CadRow(row) {
  if (isUsdCashRow(row)) return false;
  const till = String(row?.tillName || '').trim();
  if (!till || till === '—') return true;
  if (isUsdName(till)) return false;
  return /till\s*1/i.test(till);
}

function rowMatchesTill(row, till) {
  if (!till?.id) return false;
  return String(row?.tillId ?? '') === String(till.id);
}

function roundTotals(totals) {
  return {
    ...totals,
    cashIn: roundMoney(totals.cashIn),
    cashOut: roundMoney(totals.cashOut),
    net: roundMoney(totals.net),
  };
}

function buildCurrencyDrawer({
  currency,
  label,
  yesterdayPhysical,
  todayStart,
  todayPhysical,
  paymentRows,
  cashTransactions,
}) {
  const yesterday = pickClosing(yesterdayPhysical, todayStart);
  const paymentTotals = roundTotals(summarizeCashTotals(paymentRows));
  const cashTxnTotals = summarizeCashTxnTotals(cashTransactions);
  const openingBalance = todayStart;
  const movementNet = roundMoney(paymentTotals.net + cashTxnTotals.net);
  const expectedOnHand = roundMoney(openingBalance + movementNet);
  return {
    currency,
    label,
    yesterdayClosing: yesterday.closing,
    yesterdaySource: yesterday.source,
    yesterdayPhysical,
    openingBalance,
    todayPhysical,
    paymentRows,
    paymentTotals,
    cashTransactions,
    cashTxnTotals,
    movementNet,
    expectedOnHand,
    aureusOnHand: expectedOnHand,
  };
}

function summarizeCashTxnTotals(rows) {
  let cashIn = 0;
  let cashOut = 0;
  let inCount = 0;
  let outCount = 0;
  for (const row of rows) {
    if (row.type === 'In') {
      cashIn += row.amount;
      inCount += 1;
    } else {
      cashOut += row.amount;
      outCount += 1;
    }
  }
  return {
    count: rows.length,
    cashIn: roundMoney(cashIn),
    cashOut: roundMoney(cashOut),
    net: roundMoney(cashIn - cashOut),
    inCount,
    outCount,
  };
}

/**
 * Resolve a store name to the POS system + location id that owns it.
 */
export async function resolveStoreLocation(session, storeName) {
  const target = String(storeName || '').trim();
  if (!target) throw new Error('Select a store.');

  const systems = posSystemsFromSession(session);
  if (systems.length === 0) throw new Error('Not signed in.');

  const results = await Promise.all(
    systems.map(async (system) => {
      try {
        const locations = await fetchPosLocations(system.baseUrl, system.token);
        const match = locations.find((location) => namesMatch(location?.name, target));
        if (!match) return null;
        return {
          storeName: String(match.name || '').trim() || target,
          locationId: match.id,
          city: match.city || '',
          state: match.state || '',
          selling: isSellingLocation(match),
          system,
        };
      } catch {
        return null;
      }
    }),
  );

  const hits = results.filter(Boolean);
  if (!hits.length) {
    throw new Error(`Could not find location for ${target}.`);
  }
  hits.sort((a, b) => {
    const rank = storeSystemRank(a.system.key) - storeSystemRank(b.system.key);
    if (rank !== 0) return rank;
    if (a.selling !== b.selling) return a.selling ? -1 : 1;
    return 0;
  });
  return hits[0];
}

async function fetchLocationTills(system, locationId) {
  const id = locationId != null ? String(locationId) : '';
  if (!id) return [];
  const response = await posFetch(
    `${system.baseUrl}/settings/locations/${encodeURIComponent(id)}/tills`,
    {
      method: 'GET',
      headers: authHeaders(system.token),
    },
  );
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) return [];
  const rows = Array.isArray(payload?.data)
    ? payload.data
    : Array.isArray(payload)
      ? payload
      : [];
  return rows
    .map((till) => ({
      id: till?.id ?? till?.till_id ?? till?.value ?? null,
      name: String(till?.name || till?.label || '').trim(),
      currency: String(till?.currency || '').trim().toUpperCase(),
    }))
    .filter((till) => till.id != null && till.id !== '');
}

function classifyStoreTills(tills) {
  const rows = Array.isArray(tills) ? tills : [];
  const usd =
    rows.find((till) => till.currency === 'USD' || isUsdName(till.name)) || null;
  const cad =
    rows.find(
      (till) =>
        (!usd || String(till.id) !== String(usd.id)) &&
        till.currency !== 'USD' &&
        !isUsdName(till.name) &&
        /till\s*1\b/i.test(till.name),
    ) ||
    rows.find(
      (till) =>
        (!usd || String(till.id) !== String(usd.id)) &&
        till.currency !== 'USD' &&
        !isUsdName(till.name),
    ) ||
    null;
  return { cad, usd };
}

async function requestCashLogs(system, params) {
  const response = await posFetch(`${system.baseUrl}/cash_logs?${params}`, {
    method: 'GET',
    headers: authHeaders(system.token),
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  return { ok: response.ok, payload };
}

export async function fetchCashLogs(system, { locationId, date, tillId } = {}) {
  const day = formatDateParam(parseDateParam(date));
  const direct = new URLSearchParams({
    location_id: String(locationId),
    date: day,
  });
  if (tillId != null && tillId !== '') direct.set('till_id', String(tillId));
  const first = await requestCashLogs(system, direct);
  const firstOk = first.ok && cashLogRows(first.payload).some(looksLikeCashLog);
  if (firstOk) return parseCashLogs(first.payload, day);

  const filtered = new URLSearchParams();
  filtered.set('page', '1');
  filtered.set('items_per_page', '100');
  filtered.set('filters[location_id]', String(locationId));
  filtered.set('filters[date]', day);
  if (tillId != null && tillId !== '') filtered.set('filters[till_id]', String(tillId));
  const second = await requestCashLogs(system, filtered);
  if (second.ok && cashLogRows(second.payload).some(looksLikeCashLog)) {
    return parseCashLogs(second.payload, day);
  }

  if (!first.ok && !second.ok) {
    throw new Error(
      getErrorMessage(first.payload, `Failed to load cash logs (${system.label}).`),
    );
  }

  return parseCashLogs((second.ok ? second.payload : first.payload) || first.payload, day);
}

export async function fetchCashTransactions(system, { locationId, date }) {
  const day = formatDateParam(parseDateParam(date));
  const params = new URLSearchParams();
  params.set('page', '1');
  params.set('items_per_page', '1000');
  params.set('filters[location_id]', String(locationId));
  params.set('filters[date]', day);

  const response = await posFetch(`${system.baseUrl}/cash_transactions?${params}`, {
    method: 'GET',
    headers: authHeaders(system.token),
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new Error(
      getErrorMessage(payload, `Failed to load cash transactions (${system.label}).`),
    );
  }

  const rows = Array.isArray(payload?.data)
    ? payload.data
    : Array.isArray(payload)
      ? payload
      : [];

  return rows;
}

/**
 * Full till position for Audit Cash:
 * yesterday closing → today’s expected on hand.
 */
export async function fetchStoreCashPosition(session, { storeName, date } = {}) {
  if (!session?.token) throw new Error('Not signed in.');

  const day = parseDateParam(date || new Date());
  const dateKey = formatDateParam(day);
  const previousDateKey = shiftDateParam(day, -1);
  const location = await resolveStoreLocation(session, storeName);
  const { system } = location;
  const tills = classifyStoreTills(await fetchLocationTills(system, location.locationId));
  const emptyLog = (day) => ({
    date: day,
    startBalance: 0,
    startBalanceUsd: 0,
    physical: 0,
    physicalUsd: 0,
    raw: null,
  });

  const [yesterdayCad, todayCad, yesterdayUsd, todayUsd, cashTxnRaw, paymentsResult] =
    await Promise.all([
      fetchCashLogs(system, {
        locationId: location.locationId,
        date: previousDateKey,
        tillId: tills.cad?.id,
      }),
      fetchCashLogs(system, {
        locationId: location.locationId,
        date: dateKey,
        tillId: tills.cad?.id,
      }),
      tills.usd
        ? fetchCashLogs(system, {
            locationId: location.locationId,
            date: previousDateKey,
            tillId: tills.usd.id,
          })
        : Promise.resolve(emptyLog(previousDateKey)),
      tills.usd
        ? fetchCashLogs(system, {
            locationId: location.locationId,
            date: dateKey,
            tillId: tills.usd.id,
          })
        : Promise.resolve(emptyLog(dateKey)),
      fetchCashTransactions(system, { locationId: location.locationId, date: dateKey }),
      fetchCashPayments(session, {
        date: dateKey,
        storeName: location.storeName,
        locationId: location.locationId,
        systemKey: system.key,
      }),
    ]);

  const paymentRows = paymentsResult.rows || [];
  const cashTransactions = cashTxnRaw.map((row) =>
    mapCashTransaction(row, system, location.storeName),
  );

  const cadPayments = paymentRows.filter((row) =>
    tills.cad ? rowMatchesTill(row, tills.cad) || (!row.tillId && isTill1CadRow(row)) : isTill1CadRow(row),
  );
  const usdPayments = paymentRows.filter((row) =>
    tills.usd ? rowMatchesTill(row, tills.usd) || isUsdCashRow(row) : isUsdCashRow(row),
  );
  const cadTxns = cashTransactions.filter((row) =>
    tills.cad ? rowMatchesTill(row, tills.cad) || (!row.tillId && isTill1CadRow(row)) : isTill1CadRow(row),
  );
  const usdTxns = cashTransactions.filter((row) =>
    tills.usd ? rowMatchesTill(row, tills.usd) || isUsdCashRow(row) : isUsdCashRow(row),
  );
  const cadIds = new Set(cadPayments.map((row) => row.id).concat(cadTxns.map((row) => row.id)));
  const usdIds = new Set(usdPayments.map((row) => row.id).concat(usdTxns.map((row) => row.id)));
  const otherPayments = paymentRows.filter((row) => !cadIds.has(row.id) && !usdIds.has(row.id));
  const otherTxns = cashTransactions.filter((row) => !cadIds.has(row.id) && !usdIds.has(row.id));

  const usdUsesCadLog =
    todayUsd.startBalance === todayCad.startBalance &&
    ((todayUsd.startBalanceUsd || 0) > 0 || (todayCad.startBalanceUsd || 0) > 0);
  const yUsdUsesCadLog =
    yesterdayUsd.startBalance === yesterdayCad.startBalance &&
    ((yesterdayUsd.startBalanceUsd || 0) > 0 || (yesterdayCad.startBalanceUsd || 0) > 0);

  const cad = buildCurrencyDrawer({
    currency: 'CAD',
    label: 'Till 1 CAD',
    yesterdayPhysical: yesterdayCad.physical,
    todayStart: todayCad.startBalance,
    todayPhysical: todayCad.physical,
    paymentRows: cadPayments.filter((row) => !usdIds.has(row.id)),
    cashTransactions: cadTxns.filter((row) => !usdIds.has(row.id)),
  });
  const usd = buildCurrencyDrawer({
    currency: 'USD',
    label: 'USD',
    yesterdayPhysical: yUsdUsesCadLog
      ? yesterdayUsd.physicalUsd || yesterdayCad.physicalUsd
      : yesterdayUsd.physical || yesterdayUsd.physicalUsd || yesterdayCad.physicalUsd,
    todayStart: usdUsesCadLog
      ? todayUsd.startBalanceUsd || todayCad.startBalanceUsd
      : todayUsd.startBalance || todayUsd.startBalanceUsd || todayCad.startBalanceUsd,
    todayPhysical: usdUsesCadLog
      ? todayUsd.physicalUsd || todayCad.physicalUsd
      : todayUsd.physical || todayUsd.physicalUsd || todayCad.physicalUsd,
    paymentRows: usdPayments,
    cashTransactions: usdTxns,
  });

  const extraWarnings = [];
  if (paymentsResult.warning) extraWarnings.push(paymentsResult.warning);
  if (otherPayments.length || otherTxns.length) {
    extraWarnings.push(
      `${otherPayments.length + otherTxns.length} cash ${
        otherPayments.length + otherTxns.length === 1 ? 'entry' : 'entries'
      } on other tills were left out of Till 1 CAD / USD.`,
    );
  }

  return {
    storeName: location.storeName,
    locationId: location.locationId,
    systemKey: system.key,
    systemLabel: system.label,
    date: dateKey,
    previousDate: previousDateKey,
    cad,
    usd,
    otherPayments,
    otherTxns,
    yesterday: {
      ...yesterdayCad,
      closing: cad.yesterdayClosing,
      closingUsd: usd.yesterdayClosing,
      source: cad.yesterdaySource,
      sourceUsd: usd.yesterdaySource,
      physical: yesterdayCad.physical,
      physicalUsd: yesterdayUsd.physical || yesterdayUsd.physicalUsd || yesterdayCad.physicalUsd,
    },
    todayLog: todayCad,
    openingBalance: cad.openingBalance,
    openingBalanceUsd: usd.openingBalance,
    paymentRows: cad.paymentRows,
    paymentTotals: cad.paymentTotals,
    cashTransactions: cad.cashTransactions,
    cashTxnTotals: cad.cashTxnTotals,
    movementNet: cad.movementNet,
    expectedOnHand: cad.expectedOnHand,
    expectedOnHandUsd: usd.expectedOnHand,
    aureusOnHand: cad.aureusOnHand,
    aureusOnHandUsd: usd.aureusOnHand,
    warning: extraWarnings.join(' '),
  };
}

export { formatAmount, summarizeCashTxnTotals };
