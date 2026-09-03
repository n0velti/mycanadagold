import { API_BASE_URL, authHeaders } from './auth';

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

/**
 * Cash / IRS-flagged payment ids that Aureus expects to mark after FINTRAC submit.
 * Prefer ids listed on irs_details.payments (supports same-day aggregates).
 */
export function getIrsPaymentIdsToMark(detail) {
  const ids = new Set();
  const payments = Array.isArray(detail?.payments) ? detail.payments : [];

  for (const entry of payments) {
    const payment = entry?.payment || entry || {};
    const methodName = payment.payment_type?.name || '';
    const isCash =
      payment.payment_type?.is_cash === true ||
      String(methodName).trim().toLowerCase() === 'cash';
    const flagged = Boolean(payment.irs_details?.report);

    if (!isCash && !flagged) continue;

    const listed = payment.irs_details?.payments;
    if (Array.isArray(listed) && listed.length > 0) {
      for (const id of listed) {
        if (id != null && id !== '') ids.add(String(id));
      }
    } else if (payment.id != null) {
      ids.add(String(payment.id));
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

/**
 * POST /payments/{id}/reported_to_irs
 * Marks the payment as reported in Aureus (IRS / FINTRAC flag).
 */
export async function markPaymentReportedToIrs(
  token,
  paymentId,
  baseUrl = API_BASE_URL,
) {
  if (!token) throw new Error('Aureus session required.');
  if (paymentId == null || paymentId === '') {
    throw new Error('paymentId is required.');
  }

  const response = await fetch(`${baseUrl}/payments/${paymentId}/reported_to_irs`, {
    method: 'POST',
    headers: authHeaders(token),
  });

  const payload = await parseJsonResponse(response);
  if (!response.ok) {
    throw new Error(
      getErrorMessage(payload, `Failed to mark payment ${paymentId} as reported.`),
    );
  }

  return payload?.data ?? payload ?? { ok: true };
}

export async function markPaymentsReportedToIrs(
  token,
  paymentIds,
  baseUrl = API_BASE_URL,
) {
  const ids = Array.from(
    new Set((paymentIds || []).map((id) => String(id)).filter(Boolean)),
  );
  const results = [];
  for (const id of ids) {
    results.push(await markPaymentReportedToIrs(token, id, baseUrl));
  }
  return results;
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

  const response = await fetch(`${baseUrl}/payments?${params}`, {
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

/** Map normalized txn id → { reported, paymentIds } */
export function buildIrsReportedByTxn(payments) {
  const byTxn = new Map();
  for (const payment of payments || []) {
    const txnId = normalizeAureusTxnId(payment.txnId || payment.txn_id || '');
    if (!txnId) continue;
    let entry = byTxn.get(txnId);
    if (!entry) {
      entry = { reported: false, paymentIds: [], payments: [] };
      byTxn.set(txnId, entry);
    }
    entry.paymentIds.push(String(payment.id));
    entry.payments.push(payment);
    if (payment.reported || isPaymentReportedToIrs(payment)) {
      entry.reported = true;
    }
  }
  return byTxn;
}
