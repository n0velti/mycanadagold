import {
  API_BASE_URL,
  authHeaders,
  getLinkedPosSessions,
} from './auth';
import { formatAmount, formatDateParam, parseDateParam } from './transactions';

function getErrorMessage(payload, fallback) {
  return payload?.error?.message || payload?.message || fallback;
}

/** Aureus payments filter date: YYYY/MM/DD */
export function formatPaymentDateParam(date) {
  return formatDateParam(parseDateParam(date)).replace(/-/g, '/');
}

function clientName(client) {
  if (!client) return '—';
  const name = [client.first_name, client.last_name].filter(Boolean).join(' ').trim();
  return name || client.nickname || client.email || '—';
}

function referenceFromPayment(payment) {
  const transactions = Array.isArray(payment?.transactions) ? payment.transactions : [];
  const refs = [];
  for (const entry of transactions) {
    const payableType = String(entry?.payable_type || '').toLowerCase();
    const payableId = entry?.payable_id ?? entry?.payable?.id;
    if (!payableId) continue;
    if (payableType.includes('purchase')) refs.push(`PO# ${payableId}`);
    else if (payableType.includes('order')) refs.push(`SO# ${payableId}`);
    else refs.push(`#${payableId}`);
  }
  return refs.length ? refs.join(' · ') : '—';
}

function mapPayment(payment, system) {
  const amount = Number(payment?.amount) || 0;
  const type = payment?.type === 'In' ? 'In' : 'Out';
  const storeName = payment?.location?.name || '—';
  const customerName = clientName(payment?.client);
  const reference = referenceFromPayment(payment);
  const dateLabel = formatDateParam(parseDateParam(payment?.date || new Date()));

  return {
    id: `${system.key}-${payment.id}`,
    sourceId: payment.id,
    systemKey: system.key,
    systemLabel: system.label,
    date: payment?.date || '',
    dateLabel,
    type,
    directionLabel: type === 'In' ? 'Received' : 'Paid out',
    amount,
    amountLabel: formatAmount(amount, payment?.currency),
    signedAmount: type === 'In' ? amount : -amount,
    storeName,
    locationId: payment?.location_id ?? payment?.location?.id ?? null,
    tillId: payment?.till_id ?? payment?.till?.id ?? null,
    tillName: payment?.till?.name || '—',
    tillCurrency: payment?.till?.currency || '',
    currency: payment?.currency || 'CAD',
    exchangeRate: Number(payment?.exchange_rate) || 1,
    customerName,
    reference,
    status: payment?.status || '',
    paymentType: payment?.payment_type?.name || 'Cash',
    comments: payment?.comments || '',
    searchText: [
      storeName,
      customerName,
      reference,
      type,
      payment?.payment_type?.name,
      payment?.comments,
      system.label,
    ]
      .join(' ')
      .toLowerCase(),
  };
}

async function fetchPaymentsForSystem(
  system,
  { date, locationId, tillId, paymentTypeCategory = 'cash', status = 'Cleared' } = {},
) {
  const params = new URLSearchParams();
  params.set('page', '1');
  params.set('items_per_page', '10000');
  params.set('filters[date]', formatPaymentDateParam(date));
  if (status) {
    params.set('filters[status]', status);
  }
  if (paymentTypeCategory) {
    params.set('filters[payment_type_category]', paymentTypeCategory);
  }
  if (locationId != null && locationId !== '') {
    params.set('filters[location_id]', String(locationId));
  }
  if (tillId != null && tillId !== '') {
    params.set('filters[till_id]', String(tillId));
  }

  const response = await fetch(`${system.baseUrl}/payments?${params}`, {
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
    throw new Error(getErrorMessage(payload, `Failed to load payments (${system.label}).`));
  }

  const rows = Array.isArray(payload?.data)
    ? payload.data
    : Array.isArray(payload)
      ? payload
      : [];

  return rows.map((payment) => mapPayment(payment, system));
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

export function summarizeCashByStore(rows) {
  const byStore = new Map();

  for (const row of rows) {
    const key = row.storeName || '—';
    let entry = byStore.get(key);
    if (!entry) {
      entry = {
        storeName: key,
        count: 0,
        cashIn: 0,
        cashOut: 0,
        net: 0,
        inCount: 0,
        outCount: 0,
      };
      byStore.set(key, entry);
    }
    entry.count += 1;
    if (row.type === 'In') {
      entry.cashIn += row.amount;
      entry.inCount += 1;
    } else {
      entry.cashOut += row.amount;
      entry.outCount += 1;
    }
    entry.net = entry.cashIn - entry.cashOut;
  }

  return Array.from(byStore.values()).sort((a, b) =>
    a.storeName.localeCompare(b.storeName, undefined, { sensitivity: 'base' }),
  );
}

export function summarizeCashTotals(rows) {
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
    cashIn,
    cashOut,
    net: cashIn - cashOut,
    inCount,
    outCount,
  };
}

function filterRowsByStoreName(rows, storeName) {
  if (!storeName) return rows;
  const target = String(storeName).trim();
  return rows.filter(
    (row) =>
      row.storeName.localeCompare(target, undefined, { sensitivity: 'base' }) === 0,
  );
}

function sortPaymentRows(rows) {
  return [...rows].sort((a, b) => {
    const storeCmp = a.storeName.localeCompare(b.storeName, undefined, {
      sensitivity: 'base',
    });
    if (storeCmp !== 0) return storeCmp;
    return String(b.id).localeCompare(String(a.id), undefined, { numeric: true });
  });
}

/**
 * Cleared payments for a calendar day across primary + linked POS systems.
 * Pass paymentTypeCategory: 'cash' (default for cash helpers) or null for all methods.
 * When systemKey is set, only that POS system is queried (safe with locationId).
 */
export async function fetchDayPayments(
  session,
  {
    date,
    locationId,
    tillId,
    storeName,
    paymentTypeCategory = null,
    status = 'Cleared',
    systemKey,
  } = {},
) {
  if (!session?.token) {
    throw new Error('Not signed in.');
  }

  const day = parseDateParam(date || new Date());
  let systems = posSystemsFromSession(session);
  if (systemKey) {
    systems = systems.filter((system) => system.key === systemKey);
    if (systems.length === 0) {
      throw new Error(`POS system not available (${systemKey}).`);
    }
  }
  const results = await Promise.all(
    systems.map(async (system) => {
      try {
        const rows = await fetchPaymentsForSystem(system, {
          date: day,
          locationId: systemKey ? locationId : undefined,
          tillId: systemKey ? tillId : undefined,
          paymentTypeCategory,
          status,
        });
        return { rows, error: '' };
      } catch (error) {
        return {
          rows: [],
          error: error?.message || `Failed to load payments (${system.label}).`,
        };
      }
    }),
  );

  let rows = filterRowsByStoreName(
    results.flatMap((result) => result.rows),
    storeName,
  );
  const warnings = results.map((result) => result.error).filter(Boolean);
  rows = sortPaymentRows(rows);

  if (rows.length === 0 && warnings.length === systems.length && systems.length > 0) {
    throw new Error(warnings[0]);
  }

  return {
    rows,
    warning: warnings.join(' '),
    date: formatDateParam(day),
  };
}

/**
 * Cleared cash payments for a calendar day across primary + linked POS systems.
 */
export async function fetchCashPayments(
  session,
  { date, locationId, tillId, storeName, systemKey } = {},
) {
  const result = await fetchDayPayments(session, {
    date,
    locationId,
    tillId,
    storeName,
    systemKey,
    paymentTypeCategory: 'cash',
  });

  const storeSummaries = summarizeCashByStore(result.rows);
  const totals = summarizeCashTotals(result.rows);

  return {
    ...result,
    storeSummaries,
    totals,
  };
}

export { formatAmount };
