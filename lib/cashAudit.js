import { API_BASE_URL, getLinkedPosSessions } from './auth';
import { fetchStoreCashPosition } from './cashTill';
import { fetchDayPayments, formatAmount } from './payments';
import {
  fetchTransactionDetail,
  fetchTransactions,
  formatDateParam,
  parseDateParam,
  toLookupTransaction,
} from './transactions';
import { compactAuditTrailsForPrompt, gatherCashAuditTrails } from './auditTrails';
import { streamChatCompletion } from './llmProviders';
import { classifyPayment, extractCheckNumber } from './paymentMethod';

const DETAIL_CONCURRENCY = 6;

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

function storeMatches(name, storeName) {
  if (!storeName) return true;
  return (
    String(name || '')
      .trim()
      .localeCompare(String(storeName || '').trim(), undefined, { sensitivity: 'base' }) === 0
  );
}

function summarizeDetailPayments(detail) {
  const payments = Array.isArray(detail?.payments) ? detail.payments : [];
  return payments.map((entry) => {
    const payment = entry?.payment || entry || {};
    const method =
      payment.payment_type?.name ||
      entry?.payment?.payment_type?.name ||
      'Other';
    const amount = Number(entry?.amount ?? payment.amount) || 0;
    const comments = payment.comments || entry?.comments || '';
    const classified = classifyPayment({ method, comments });
    return {
      method,
      amount,
      amountLabel: formatAmount(amount),
      status: payment.status || '',
      date: payment.date || '',
      comments,
      checkNumber: classified.checkNumber,
      inferredMethod: classified.inferred,
      likelyCheque: classified.likelyCheque,
      likelyDebit: classified.likelyDebit,
      likelyCash: classified.likelyCash,
      suspiciousCashWithCheckNumber: classified.suspiciousCashWithCheckNumber,
      chequeMissingCheckNumber: classified.chequeMissingCheckNumber,
    };
  });
}

async function mapPool(items, limit, mapper) {
  const results = new Array(items.length);
  let next = 0;

  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await mapper(items[index], index);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

async function loadStoreDayTransactions(session, { date, storeName }) {
  const day = formatDateParam(parseDateParam(date));
  const systems = posSystemsFromSession(session);
  const results = await Promise.all(
    systems.map(async (system) => {
      try {
        const result = await fetchTransactions(system.token, {
          startDate: day,
          endDate: day,
          baseUrl: system.baseUrl,
        });
        const rows = result.rows
          .filter((row) => storeMatches(row.storeName, storeName))
          .map((row) => ({
            ...row,
            systemKey: system.key,
            systemLabel: system.label,
            baseUrl: system.baseUrl,
            token: system.token,
          }));
        return { rows, error: '' };
      } catch (error) {
        return {
          rows: [],
          error: error?.message || `Failed to load transactions (${system.label}).`,
        };
      }
    }),
  );

  return {
    rows: results.flatMap((result) => result.rows),
    warning: results.map((result) => result.error).filter(Boolean).join(' '),
  };
}

async function enrichTransaction(row) {
  try {
    const detail = await fetchTransactionDetail(row.token, {
      type: row.type,
      sourceId: row.sourceId,
      baseUrl: row.baseUrl,
    });
    const paymentEntries = summarizeDetailPayments(detail);
    const detailComments = detail?.comments || '';
    const detailCheckNumber = extractCheckNumber(detailComments);
    const listedCash = /\bcash\b/i.test(String(row.paymentMethods || ''));
    const cashWithCheckInNotes =
      paymentEntries.some((p) => p.suspiciousCashWithCheckNumber) ||
      (listedCash && Boolean(detailCheckNumber)) ||
      (paymentEntries.some((p) => p.likelyCash) && Boolean(detailCheckNumber));

    return {
      reference: row.reference,
      type: row.type,
      sourceId: row.sourceId,
      date: row.date,
      dateLabel: row.dateLabel,
      timeLabel: row.timeLabel,
      customerName: row.customerName,
      employeeName: row.employeeName,
      storeName: row.storeName,
      amount: row.amount,
      amountLabel: row.amountLabel,
      listedPaymentMethods: row.paymentMethods || '',
      paymentStatus: detail?.payment_status || '',
      itemStatus: detail?.item_status || '',
      allocationStatus: detail?.allocation_status || '',
      comments: detailComments,
      checkNumber: detailCheckNumber || paymentEntries.find((p) => p.checkNumber)?.checkNumber || null,
      payments: paymentEntries,
      flags: {
        notPaid:
          detail?.payment_status &&
          !/paid|cleared|complete/i.test(String(detail.payment_status)),
        hasChequeSignal:
          paymentEntries.some((p) => p.likelyCheque) || Boolean(detailCheckNumber),
        hasDebitSignal: paymentEntries.some((p) => p.likelyDebit),
        hasCashSignal:
          paymentEntries.some((p) => p.likelyCash) || listedCash,
        mixedMethods: paymentEntries.length > 1,
        // Cash method + check # in comments → likely mis-tagged
        suspiciousCashWithCheckNumber: cashWithCheckInNotes,
        // Check/cheque method but no check # in comments
        chequeMissingCheckNumber: paymentEntries.some((p) => p.chequeMissingCheckNumber),
      },
    };
  } catch (error) {
    return {
      reference: row.reference,
      type: row.type,
      sourceId: row.sourceId,
      customerName: row.customerName,
      amount: row.amount,
      amountLabel: row.amountLabel,
      listedPaymentMethods: row.paymentMethods || '',
      error: error?.message || 'Failed to load detail',
    };
  }
}

function compactPaymentRow(row) {
  const classified = classifyPayment({
    method: row.paymentType,
    comments: row.comments || '',
  });
  return {
    id: row.sourceId,
    direction: row.type,
    directionLabel: row.directionLabel,
    amount: row.amount,
    amountLabel: row.amountLabel,
    customerName: row.customerName,
    reference: row.reference,
    status: row.status,
    paymentType: row.paymentType,
    comments: row.comments || '',
    tillName: row.tillName,
    currency: row.currency || 'CAD',
    systemLabel: row.systemLabel,
    checkNumber: classified.checkNumber,
    inferredMethod: classified.inferred,
    likelyCheque: classified.likelyCheque,
    likelyDebit: classified.likelyDebit,
    likelyCash: classified.likelyCash,
    suspiciousCashWithCheckNumber: classified.suspiciousCashWithCheckNumber,
    chequeMissingCheckNumber: classified.chequeMissingCheckNumber,
  };
}

function compactCashTxnRow(row) {
  return {
    id: row.sourceId,
    direction: row.type,
    directionLabel: row.directionLabel,
    amount: row.amount,
    amountLabel: row.amountLabel,
    category: row.category,
    comments: row.comments || '',
    tillName: row.tillName,
    currency: row.currency || 'CAD',
  };
}

/**
 * Gather cash + day payment/transaction context for a store cash audit.
 */
function compactDrawer(drawer) {
  if (!drawer) return null;
  return {
    currency: drawer.currency,
    label: drawer.label,
    yesterdayClosing: drawer.yesterdayClosing,
    yesterdaySource: drawer.yesterdaySource,
    yesterdayPhysical: drawer.yesterdayPhysical,
    openingBalance: drawer.openingBalance,
    todayPhysical: drawer.todayPhysical,
    paymentTotals: drawer.paymentTotals,
    cashTxnTotals: drawer.cashTxnTotals,
    movementNet: drawer.movementNet,
    expectedOnHand: drawer.expectedOnHand,
    cashPayments: (drawer.paymentRows || []).map(compactPaymentRow),
    cashTransactions: (drawer.cashTransactions || []).map(compactCashTxnRow),
  };
}

export async function gatherCashAuditContext(
  session,
  { date, storeName, cashOnHand, cashOnHandUsd, expectedNet, onProgress } = {},
) {
  if (!storeName) {
    throw new Error('Select a store first.');
  }

  onProgress?.('Loading till position…');
  const position = await fetchStoreCashPosition(session, { date, storeName });
  const cad = compactDrawer(position.cad);
  const usd = compactDrawer(position.usd);
  const totals = cad?.paymentTotals || position.paymentTotals;
  const expected =
    typeof expectedNet === 'number' ? expectedNet : cad?.expectedOnHand ?? position.expectedOnHand;

  onProgress?.('Loading payments, transactions, and POS audit trails…');
  const [allPayments, dayTx, auditTrails] = await Promise.all([
    fetchDayPayments(session, {
      date,
      storeName: position.storeName,
      locationId: position.locationId,
      systemKey: position.systemKey,
      paymentTypeCategory: null,
    }).catch((error) => ({ rows: [], warning: error?.message || '' })),
    loadStoreDayTransactions(session, {
      date,
      storeName: position.storeName,
    }),
    gatherCashAuditTrails(session, {
      date: position.date,
      previousDate: position.previousDate,
      locationId: position.locationId,
      systemKey: position.systemKey,
      onProgress,
    }).catch((error) => ({
      trailCount: 0,
      materialCount: 0,
      dateMismatches: [],
      events: [],
      reconciliation: null,
      warning: error?.message || 'Failed to load POS audit trails.',
    })),
  ]);

  onProgress?.(
    `Reviewing ${dayTx.rows.length} transaction detail${dayTx.rows.length === 1 ? '' : 's'}…`,
  );
  const enriched = await mapPool(dayTx.rows, DETAIL_CONCURRENCY, enrichTransaction);

  const nonCashPayments = allPayments.rows.filter(
    (row) => String(row.paymentType || '').trim().toLowerCase() !== 'cash',
  );

  const cashPayments = cad?.cashPayments || position.paymentRows.map(compactPaymentRow);
  const usdPayments = usd?.cashPayments || [];
  const otherMethodPayments = nonCashPayments.map(compactPaymentRow);
  const suspiciousCashWithCheckNumber = [
    ...cashPayments.filter((row) => row.suspiciousCashWithCheckNumber),
    ...usdPayments.filter((row) => row.suspiciousCashWithCheckNumber),
    ...otherMethodPayments.filter((row) => row.suspiciousCashWithCheckNumber),
    ...enriched.filter((row) => row.flags?.suspiciousCashWithCheckNumber),
  ];
  const chequeMissingCheckNumber = [
    ...cashPayments.filter((row) => row.chequeMissingCheckNumber),
    ...usdPayments.filter((row) => row.chequeMissingCheckNumber),
    ...otherMethodPayments.filter((row) => row.chequeMissingCheckNumber),
    ...enriched.filter((row) => row.flags?.chequeMissingCheckNumber),
  ];

  const countedCad = Number(cashOnHand);
  const countedUsd = Number(cashOnHandUsd);
  const expectedUsd = usd?.expectedOnHand ?? 0;
  const varianceCad = Number.isFinite(countedCad) ? countedCad - expected : null;
  const varianceUsd = Number.isFinite(countedUsd) ? countedUsd - expectedUsd : null;

  return {
    storeName: position.storeName,
    date: position.date,
    previousDate: position.previousDate,
    till1Cad: cad,
    usd,
    yesterdayClosing: cad?.yesterdayClosing ?? position.yesterday.closing,
    yesterdaySource: cad?.yesterdaySource ?? position.yesterday.source,
    yesterdayPhysical: cad?.yesterdayPhysical ?? position.yesterday.physical,
    openingBalance: cad?.openingBalance ?? position.openingBalance,
    cashTotals: totals,
    cashTxnTotals: cad?.cashTxnTotals ?? position.cashTxnTotals,
    movementNet: cad?.movementNet ?? position.movementNet,
    expectedOnHand: expected,
    expectedNet: expected,
    cashOnHand: Number.isFinite(countedCad) ? countedCad : null,
    cashOnHandUsd: Number.isFinite(countedUsd) ? countedUsd : null,
    variance: varianceCad,
    varianceUsd,
    cashPayments,
    cashTransactions: cad?.cashTransactions || position.cashTransactions.map(compactCashTxnRow),
    nonCashPayments: otherMethodPayments,
    suspiciousCashWithCheckNumber,
    chequeMissingCheckNumber,
    transactions: enriched,
    lookupTransactions: dayTx.rows.map(toLookupTransaction).filter(Boolean),
    auditTrails,
    warning: [position.warning, allPayments.warning, dayTx.warning, auditTrails?.warning]
      .filter(Boolean)
      .join(' '),
  };
}

function varianceLabelFor(variance, currency) {
  if (variance == null) return `${currency} cash on hand not entered`;
  if (Math.abs(variance) < 0.005) return `${currency} balanced (no variance)`;
  return variance > 0
    ? `${currency} OVER by ${formatAmount(variance, currency)}`
    : `${currency} SHORT by ${formatAmount(Math.abs(variance), currency)}`;
}

function slimPaymentForPrompt(row) {
  const out = {
    id: row.id ?? row.reference,
    dir: row.direction,
    amount: row.amount,
    currency: row.currency || 'CAD',
    customer: row.customerName,
    ref: row.reference,
    status: row.status,
    method: row.paymentType,
  };
  if (row.comments) out.comments = row.comments;
  if (row.checkNumber) out.checkNumber = row.checkNumber;
  if (row.inferredMethod && row.inferredMethod !== 'other') out.inferred = row.inferredMethod;
  if (row.suspiciousCashWithCheckNumber) out.suspiciousCashWithCheckNumber = true;
  if (row.chequeMissingCheckNumber) out.chequeMissingCheckNumber = true;
  return out;
}

function summarizeOtherMethods(rows) {
  const byMethod = {};
  const flagged = [];
  for (const row of rows || []) {
    const method = row.paymentType || 'Other';
    if (!byMethod[method]) byMethod[method] = { method, count: 0, in: 0, out: 0 };
    byMethod[method].count += 1;
    if (row.direction === 'Out') byMethod[method].out += Number(row.amount) || 0;
    else byMethod[method].in += Number(row.amount) || 0;
    if (row.suspiciousCashWithCheckNumber || row.chequeMissingCheckNumber) {
      flagged.push(slimPaymentForPrompt(row));
    }
  }
  return { byMethod: Object.values(byMethod), flagged };
}

function txIsFlagged(row) {
  const flags = row?.flags || {};
  return Boolean(
    flags.suspiciousCashWithCheckNumber ||
      flags.chequeMissingCheckNumber ||
      flags.notPaid ||
      flags.mixedMethods,
  );
}

function slimLinkedTx(row) {
  const out = {
    ref: row.reference,
    type: row.type,
    amount: row.amount,
    customer: row.customerName,
    employee: row.employeeName,
    methods: row.listedPaymentMethods,
    paymentStatus: row.paymentStatus,
    comments: row.comments || undefined,
    checkNumber: row.checkNumber || undefined,
    flags: row.flags || undefined,
  };
  if (row.payments?.length) {
    out.payments = row.payments.map((payment) => ({
      method: payment.method,
      amount: payment.amount,
      status: payment.status || undefined,
      comments: payment.comments || undefined,
      checkNumber: payment.checkNumber || undefined,
    }));
  }
  if (row.error) out.error = row.error;
  return out;
}

function pickLinkedTransactions(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const flagged = list.filter(txIsFlagged).map(slimLinkedTx);
  const sample = list.filter((row) => !txIsFlagged(row)).slice(0, 12).map(slimLinkedTx);
  return { reviewedCount: list.length, flagged, sample };
}

function slimDrawerForPrompt(drawer) {
  if (!drawer) return null;
  return {
    currency: drawer.currency,
    label: drawer.label,
    yesterdayClosing: drawer.yesterdayClosing,
    yesterdaySource: drawer.yesterdaySource,
    yesterdayPhysical: drawer.yesterdayPhysical,
    openingBalance: drawer.openingBalance,
    todayPhysical: drawer.todayPhysical,
    paymentTotals: drawer.paymentTotals,
    cashTxnTotals: drawer.cashTxnTotals,
    movementNet: drawer.movementNet,
    expectedOnHand: drawer.expectedOnHand,
    cashPayments: (drawer.cashPayments || []).map(slimPaymentForPrompt),
    cashTransactions: drawer.cashTransactions || [],
  };
}

function buildAuditMessages(context) {
  const payload = {
    store: context.storeName,
    date: context.date,
    previousDate: context.previousDate,
    evaluateSeparately: [
      'Till 1 CAD and USD are separate drawers. Never add or convert one into the other.',
    ],
    till1Cad: {
      ...slimDrawerForPrompt(context.till1Cad),
      countedCashOnHand: context.cashOnHand,
      variance: context.variance,
      varianceLabel: varianceLabelFor(context.variance, 'CAD'),
    },
    usd: {
      ...slimDrawerForPrompt(context.usd),
      countedCashOnHand: context.cashOnHandUsd,
      variance: context.varianceUsd,
      varianceLabel: varianceLabelFor(context.varianceUsd, 'USD'),
    },
    formula:
      'For each drawer: expectedOnHand = openingBalanceToday + paymentNet + tillAdjustmentNet (opening usually equals yesterday physical count for that currency)',
    otherMethodPaymentsSameDay: summarizeOtherMethods(context.nonCashPayments),
    suspiciousCashWithCheckNumber: (context.suspiciousCashWithCheckNumber || []).map((row) =>
      row.reference || row.flags ? slimLinkedTx(row) : slimPaymentForPrompt(row),
    ),
    chequeMissingCheckNumber: (context.chequeMissingCheckNumber || []).map((row) =>
      row.reference || row.flags ? slimLinkedTx(row) : slimPaymentForPrompt(row),
    ),
    linkedSalesAndPurchases: pickLinkedTransactions(context.transactions),
    posAuditTrails: compactAuditTrailsForPrompt(context.auditTrails),
  };

  return [
    {
      role: 'system',
      content: `You are a cash till auditor for a Canadian precious-metals retailer (Canada Gold).
Investigate why counted cash on hand may not match expected on hand for one store/day.

There are TWO separate drawers. Evaluate each independently:
- Till 1 CAD: Canadian cash in Till 1 (start_balance / physical, CAD cash payments, CAD till cash_transactions).
- USD: US-dollar cash (start_balance_usd / physical_usd, USD cash payments, USD till cash_transactions).
Do not mix CAD and USD. Do not FX-convert unless a payment's exchange_rate is clearly involved in a mispost.

For each drawer, expected on hand = yesterday's closing for that currency (usually yesterday's physical count, carried as today's start balance) + today's cleared cash payments net in that currency + today's till cash_transactions net in that currency.

Rules for classifying payment methods (follow exactly):
- Cash: issue payment method is Cash AND comments do NOT contain a check/cheque #.
- Debit: issue payment method is Debit (also Interac/EFT). Do not infer debit from comments alone.
- Cheque/Check: issue payment method is Cheque/Check/Chq/Chk, OR comments contain a check # (e.g. "chq 4521", "check #1234", "cheque 8891"). A real cheque payment should have a check # in comments.
- ERROR FLAG: method says Cash but comments have a check # → treat as likely cheque mis-tagged as cash (do not trust Cash).
- WARNING: method says Cheque/Check but comments have no check # → incomplete cheque record; call it out.
- Prefer the structured flags on each row (suspiciousCashWithCheckNumber, chequeMissingCheckNumber, inferredMethod, checkNumber, likelyCheque, likelyDebit) over free-text guessing.
- Status: a transaction or payment must actually be Paid / Cleared. Unpaid, void, pending, or incomplete should not move cash.
- Till cash_transactions are manual drawer adjustments (petty cash, trips, supplies) — verify comments and amounts.

Focus on causes of the variance:
1. Payments tagged Cash that were actually debit or cheque (especially cash + check # in comments).
2. Debit/cheque payments that should have been cash (or vice versa).
3. Cheque methods missing a check # in comments.
4. Transactions not actually Paid but still affecting cash.
5. Wrong or missing till cash_transactions.
6. Duplicate, missing, wrong-amount, or wrong-direction (In vs Out) cash entries.
7. Yesterday's closing / today's opening balance issues.
8. CAD posted to USD (or vice versa).
9. POS audit trails: deleted payments, cash-log amount revisions (firstAmount → lastAmount), till cash_transaction edits, and recordDate ≠ trailDate. Add those deltas to expected vs counted before guessing a mis-tag.

Be concrete: cite SO# 12345 or PO# 12345, payment/cash-log ids, user, previous → new amounts, document date vs change date, currency, methods, statuses, and comments.
If a drawer is balanced, say so. If USD is a large unused float, say whether it moved.

Write in plain English only. Do not use markdown. Do not use # headings, * asterisks, ** bold, or bullet lists.
Cite every sale or purchase as SO# 12345 or PO# 12345 so it can be opened.

Use exactly this layout and these three labels:

Problem
One or two short sentences on what is wrong. Name the drawer and the short or over.

Solution
One or two short sentences on what to do now.

Reasons
Two or three short sentences. Each reason on its own line. No numbers or dashes.

Keep every sentence short.`,
    },
    {
      role: 'user',
      content: `Audit this store cash (Till 1 CAD and USD separately).\n\n${JSON.stringify(payload)}`,
    },
  ];
}

/**
 * Run AI cash discrepancy analysis; streams text via onDelta.
 */
export async function analyzeCashDiscrepancy({
  session,
  date,
  storeName,
  cashOnHand,
  cashOnHandUsd,
  expectedNet,
  model,
  onProgress,
  onDelta,
  signal,
}) {
  const context = await gatherCashAuditContext(session, {
    date,
    storeName,
    cashOnHand,
    cashOnHandUsd,
    expectedNet,
    onProgress,
  });

  onProgress?.('Asking AI…');
  const seedMessages = buildAuditMessages(context);
  const text = await streamChatCompletion({
    model,
    messages: seedMessages,
    onDelta,
    signal,
    maxTokens: 16384,
  });

  const messages = [...seedMessages, { role: 'assistant', content: text || '' }];
  return { context, text, messages };
}

/**
 * Continue a cash audit conversation with a follow-up question.
 */
export async function continueCashAuditChat({
  messages,
  userMessage,
  model,
  onDelta,
  signal,
}) {
  const question = String(userMessage || '').trim();
  if (!question) throw new Error('Enter a follow-up question.');
  if (!Array.isArray(messages) || !messages.length) {
    throw new Error('Run Find Out Why before chatting.');
  }

  const nextMessages = [
    ...messages,
    {
      role: 'system',
      content:
        'Stay in the Problem / Solution / Reasons plain layout. No markdown. Cite sales and purchases as SO# 12345 or PO# 12345.',
    },
    { role: 'user', content: question },
  ];
  const text = await streamChatCompletion({
    model,
    messages: nextMessages,
    onDelta,
    signal,
    maxTokens: 16384,
  });

  return {
    text,
    messages: [...nextMessages, { role: 'assistant', content: text || '' }],
  };
}
