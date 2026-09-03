import { API_BASE_URL, authHeaders, getLinkedPosSessions } from './auth';
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
  return /\busd\b/i.test(String(row?.tillName || ''));
}

function isTill1CadRow(row) {
  if (isUsdCashRow(row)) return false;
  const till = String(row?.tillName || '').trim();
  if (!till || till === '—') return true;
  return /till\s*1/i.test(till);
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
  const yesterdayClosing = yesterdayPhysical > 0 ? yesterdayPhysical : todayStart;
  const yesterdaySource = yesterdayPhysical > 0 ? 'physical' : 'start_balance';
  const paymentTotals = roundTotals(summarizeCashTotals(paymentRows));
  const cashTxnTotals = summarizeCashTxnTotals(cashTransactions);
  const openingBalance = todayStart;
  const movementNet = roundMoney(paymentTotals.net + cashTxnTotals.net);
  const expectedOnHand = roundMoney(openingBalance + movementNet);
  return {
    currency,
    label,
    yesterdayClosing,
    yesterdaySource,
    yesterdayPhysical,
    openingBalance,
    todayPhysical,
    paymentRows,
    paymentTotals,
    cashTransactions,
    cashTxnTotals,
    movementNet,
    expectedOnHand,
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
          system,
        };
      } catch {
        return null;
      }
    }),
  );

  const hit = results.find(Boolean);
  if (!hit) {
    throw new Error(`Could not find location for ${target}.`);
  }
  return hit;
}

export async function fetchCashLogs(system, { locationId, date }) {
  const day = formatDateParam(parseDateParam(date));
  const params = new URLSearchParams({
    location_id: String(locationId),
    date: day,
  });
  const response = await fetch(`${system.baseUrl}/cash_logs?${params}`, {
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
    throw new Error(getErrorMessage(payload, `Failed to load cash logs (${system.label}).`));
  }

  return {
    date: day,
    startBalance: roundMoney(payload?.start_balance),
    startBalanceUsd: roundMoney(payload?.start_balance_usd),
    physical: roundMoney(payload?.physical),
    physicalUsd: roundMoney(payload?.physical_usd),
    raw: payload,
  };
}

export async function fetchCashTransactions(system, { locationId, date }) {
  const day = formatDateParam(parseDateParam(date));
  const params = new URLSearchParams();
  params.set('page', '1');
  params.set('items_per_page', '1000');
  params.set('filters[location_id]', String(locationId));
  params.set('filters[date]', day);

  const response = await fetch(`${system.baseUrl}/cash_transactions?${params}`, {
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

  const [yesterdayLog, todayLog, cashTxnRaw, paymentsResult] = await Promise.all([
    fetchCashLogs(system, { locationId: location.locationId, date: previousDateKey }),
    fetchCashLogs(system, { locationId: location.locationId, date: dateKey }),
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

  const cadPayments = paymentRows.filter(isTill1CadRow);
  const usdPayments = paymentRows.filter(isUsdCashRow);
  const cadTxns = cashTransactions.filter(isTill1CadRow);
  const usdTxns = cashTransactions.filter(isUsdCashRow);
  const otherPayments = paymentRows.filter(
    (row) => !isTill1CadRow(row) && !isUsdCashRow(row),
  );
  const otherTxns = cashTransactions.filter(
    (row) => !isTill1CadRow(row) && !isUsdCashRow(row),
  );

  const cad = buildCurrencyDrawer({
    currency: 'CAD',
    label: 'Till 1 CAD',
    yesterdayPhysical: yesterdayLog.physical,
    todayStart: todayLog.startBalance,
    todayPhysical: todayLog.physical,
    paymentRows: cadPayments,
    cashTransactions: cadTxns,
  });
  const usd = buildCurrencyDrawer({
    currency: 'USD',
    label: 'USD',
    yesterdayPhysical: yesterdayLog.physicalUsd,
    todayStart: todayLog.startBalanceUsd,
    todayPhysical: todayLog.physicalUsd,
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
      ...yesterdayLog,
      closing: cad.yesterdayClosing,
      closingUsd: usd.yesterdayClosing,
      source: cad.yesterdaySource,
      sourceUsd: usd.yesterdaySource,
    },
    todayLog,
    openingBalance: cad.openingBalance,
    openingBalanceUsd: usd.openingBalance,
    paymentRows: cad.paymentRows,
    paymentTotals: cad.paymentTotals,
    cashTransactions: cad.cashTransactions,
    cashTxnTotals: cad.cashTxnTotals,
    movementNet: cad.movementNet,
    expectedOnHand: cad.expectedOnHand,
    expectedOnHandUsd: usd.expectedOnHand,
    warning: extraWarnings.join(' '),
  };
}

export { formatAmount, summarizeCashTxnTotals };
