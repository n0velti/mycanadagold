import {
  API_BASE_URL,
  authHeaders,
  ensureLinkedPosSessions,
  posFetch,
  posSystemsFromSession,
} from './auth';

function getErrorMessage(payload, fallback) {
  return payload?.error?.message || payload?.message || fallback;
}

async function parseJsonResponse(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/** Normalize SO# 41229 / SO41229 / so 41229 → SO41229 */
export function normalizeAureusTxnId(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/^(SO|PO)\s*#?\s*(\d+)$/i);
  if (match) return `${match[1].toUpperCase()}${match[2]}`;
  return raw.replace(/\s+/g, '').replace(/#/g, '').toUpperCase();
}

export function isPaymentReportedToIrs(payment) {
  const value = payment?.reported_to_irs_at;
  return value != null && value !== '' && value !== false;
}

export function paymentNeedsIrsReporting(payment) {
  return Boolean(payment?.irs_details?.report) || isPaymentReportedToIrs(payment);
}

function isTruthyFlag(value) {
  return value === true || value === 1 || value === '1' || value === 'true';
}

function isCashPayment(payment, methodName) {
  if (isTruthyFlag(payment?.payment_type?.is_cash)) return true;
  const name = String(methodName || payment?.payment_type?.name || '')
    .trim()
    .toLowerCase();
  if (!name) return false;
  return name === 'cash' || name === 'espèces' || name === 'especes' || name.startsWith('cash ');
}

/** Scalar id, or `{ id }` / `{ payment_id }` from nested POS payloads. */
export function normalizePaymentId(value) {
  if (value == null || value === '') return '';
  if (typeof value === 'object') {
    const nested = value.id ?? value.payment_id ?? value.paymentId;
    return nested != null && nested !== '' ? String(nested) : '';
  }
  const text = String(value).trim();
  return text && text !== '[object Object]' ? text : '';
}

function addPaymentId(ids, value) {
  const id = normalizePaymentId(value);
  if (id) ids.add(id);
}

/**
 * Cash / IRS-flagged payment ids that Aureus expects to mark after FINTRAC submit.
 * Always includes this ticket's own cash payment ids, plus any same-day
 * aggregate ids on `irs_details.payments`.
 */
export function getIrsPaymentIdsToMark(detail) {
  const ids = new Set();
  const payments = Array.isArray(detail?.payments) ? detail.payments : [];

  for (const entry of payments) {
    const payment = entry?.payment || entry || {};
    const methodName = payment.payment_type?.name || entry?.payment_type?.name || '';
    const flagged = Boolean(payment.irs_details?.report);
    if (!isCashPayment(payment, methodName) && !flagged) continue;

    addPaymentId(ids, payment.id ?? entry?.id);

    const listed = payment.irs_details?.payments;
    if (Array.isArray(listed)) {
      for (const item of listed) addPaymentId(ids, item);
    }
  }

  return Array.from(ids);
}

export function extractIrsReportingFromDetail(detail) {
  const payments = Array.isArray(detail?.payments) ? detail.payments : [];
  const paymentIds = getIrsPaymentIdsToMark(detail);
  let reported = false;
  let needsReport = false;

  for (const entry of payments) {
    const payment = entry?.payment || entry || {};
    if (isPaymentReportedToIrs(payment)) reported = true;
    if (payment.irs_details?.report) needsReport = true;
  }

  return {
    irsPaymentIds: paymentIds,
    irsReported: reported,
    irsNeedsReport: needsReport || paymentIds.length > 0,
  };
}

function alreadyReportedMessage(message) {
  return /already (been )?reported|previously reported|has already been marked/i.test(
    String(message || ''),
  );
}

/**
 * POST /payments/{id}/reported_to_irs
 * Marks the payment as reported in Aureus (IRS / FINTRAC flag).
 * Matches the POS call: empty body, no JSON Content-Type.
 */
export async function markPaymentReportedToIrs(
  token,
  paymentId,
  baseUrl = API_BASE_URL,
) {
  if (!token) throw new Error('Aureus session required.');
  const id = normalizePaymentId(paymentId);
  if (!id) throw new Error('paymentId is required.');

  const response = await posFetch(`${baseUrl}/payments/${id}/reported_to_irs`, {
    method: 'POST',
    headers: {
      Accept: 'application/json, text/plain, */*',
      Authorization: `Bearer ${token}`,
    },
  });

  const payload = await parseJsonResponse(response);
  if (response.ok) {
    return { id, already: false, payload: payload?.data ?? payload ?? { ok: true } };
  }
  const message = getErrorMessage(payload, `Failed to mark payment ${id} as reported.`);
  if (alreadyReportedMessage(message)) {
    return { id, already: true, payload };
  }
  throw new Error(message);
}

export async function markPaymentsReportedToIrs(
  token,
  paymentIds,
  baseUrl = API_BASE_URL,
) {
  const ids = Array.from(
    new Set((paymentIds || []).map((id) => normalizePaymentId(id)).filter(Boolean)),
  );
  const marked = [];
  const already = [];
  const failed = [];
  for (const id of ids) {
    try {
      const result = await markPaymentReportedToIrs(token, id, baseUrl);
      if (result.already) already.push(id);
      else marked.push(id);
    } catch (error) {
      failed.push({ id, error: error?.message || `Failed to mark payment ${id}.` });
    }
  }
  return { marked, already, failed, paymentIds: ids };
}

/**
 * GET /payments?filters[irs_reporting]=true&filters[type]=In…
 * Used to know which SOs are already marked reported in Aureus.
 */
export async function fetchIrsReportingPayments(
  token,
  {
    startDate,
    endDate,
    baseUrl = API_BASE_URL,
    page = 1,
    itemsPerPage = 500,
  } = {},
) {
  if (!token) throw new Error('Aureus session required.');

  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('items_per_page', String(itemsPerPage));
  if (startDate) params.set('filters[start_date]', startDate);
  if (endDate) params.set('filters[end_date]', endDate);
  params.set('filters[irs_reporting]', 'true');
  params.set('filters[type]', 'In');
  params.set('sort[field]', 'amount');
  params.set('sort[dir]', 'desc');
  params.set('extra', 'client');

  const response = await posFetch(`${baseUrl}/payments?${params}`, {
    method: 'GET',
    headers: authHeaders(token),
  });

  const payload = await parseJsonResponse(response);
  if (!response.ok) {
    throw new Error(getErrorMessage(payload, 'Failed to load IRS reporting payments.'));
  }

  const rows = Array.isArray(payload?.data)
    ? payload.data
    : Array.isArray(payload)
      ? payload
      : [];

  return rows.map((payment) => ({
    id: payment.id,
    amount: Number(payment.amount) || 0,
    txnId: normalizeAureusTxnId(payment.txn_id || ''),
    reportedToIrsAt: payment.reported_to_irs_at || null,
    reported: isPaymentReportedToIrs(payment),
    irsDetails: payment.irs_details || null,
    paymentType: payment.payment_type?.name || '',
    clientName: [payment.client?.first_name, payment.client?.last_name]
      .filter(Boolean)
      .join(' ')
      .trim(),
    raw: payment,
  }));
}

export async function fetchIrsReportingPaymentsAcrossPos(
  session,
  { startDate, endDate } = {},
) {
  const authed = await ensureLinkedPosSessions(session);
  const sources = posSystemsFromSession(authed).filter((source) => source.token);
  const batches = await Promise.all(
    sources.map(async (source) => {
      const rows = await fetchIrsReportingPayments(source.token, {
        startDate,
        endDate,
        baseUrl: source.baseUrl,
      }).catch(() => []);
      return rows.map((row) => ({ ...row, systemKey: source.key }));
    }),
  );
  return batches.flat();
}

function irsOverlayKey(systemKey, txnId) {
  return systemKey ? `${systemKey}:${txnId}` : txnId;
}

/** Map system:txn and txn → { reported, paymentIds } */
export function buildIrsReportedByTxn(payments) {
  const byTxn = new Map();
  const add = (key, payment) => {
    if (!key) return;
    let entry = byTxn.get(key);
    if (!entry) {
      entry = { reported: false, paymentIds: [], payments: [] };
      byTxn.set(key, entry);
    }
    const paymentId = normalizePaymentId(payment.id);
    if (paymentId) entry.paymentIds.push(paymentId);
    entry.payments.push(payment);
    if (payment.reported || isPaymentReportedToIrs(payment)) {
      entry.reported = true;
    }
  };

  for (const payment of payments || []) {
    const txnId = normalizeAureusTxnId(payment.txnId || payment.txn_id || '');
    if (!txnId) continue;
    add(irsOverlayKey(payment.systemKey, txnId), payment);
    add(txnId, payment);
  }
  return byTxn;
}

export function lookupIrsOverlay(irsMap, row) {
  if (!irsMap || !row) return null;
  const txnId = normalizeAureusTxnId(row.reference);
  if (!txnId) return null;
  return (
    irsMap.get(irsOverlayKey(row.systemKey, txnId)) ||
    irsMap.get(txnId) ||
    null
  );
}
