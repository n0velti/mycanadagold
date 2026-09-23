/**
 * Find which till lines, sales, purchases, transfers, and log edits — alone or
 * combined — change expected cash by exactly the counted-vs-till difference.
 *
 * expectedDelta is how expected on hand changes if that mistake is corrected.
 * Counted − expected = variance, so a real explanation sums to the variance.
 */

const NEAR_CENTS = 100;
const BALANCE_CENTS = 1;

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function toCents(value) {
  return Math.round((Number(value) || 0) * 100);
}

function money(amount, currency) {
  const n = Math.abs(Number(amount) || 0);
  const text = n.toLocaleString('en-CA', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return currency ? `${currency} ${text}` : text;
}

function signedOf(row) {
  if (row?.signedAmount != null && Number.isFinite(Number(row.signedAmount))) {
    return Number(row.signedAmount);
  }
  const amount = Math.abs(Number(row?.amount) || 0);
  const direction = row?.direction || row?.type;
  return direction === 'Out' ? -amount : amount;
}

function rowId(row, index) {
  return String(row?.id ?? row?.sourceId ?? row?.reference ?? index);
}

function refOf(row) {
  const reference = String(row?.reference || '').trim();
  if (reference && reference !== '—') return reference;
  if (row?.id != null && row.id !== '') return `#${row.id}`;
  return 'entry';
}

function clip(text, max = 140) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  if (!value) return '';
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function refKeys(reference) {
  const keys = [];
  const re = /\b(SO|PO|TR)\s*#?\s*(\d+)/gi;
  const text = String(reference || '');
  let match = re.exec(text);
  while (match) {
    keys.push(`${match[1].toUpperCase()}:${match[2]}`);
    match = re.exec(text);
  }
  return keys;
}

function badStatus(status) {
  return /void|delete|cancel|pending|unpaid|incomplete|refunded/i.test(String(status || ''));
}

function looksDebit(text) {
  return /\b(debit|interac|eft|visa|mastercard|amex|credit)\b/i.test(String(text || ''));
}

function looksCash(text) {
  return /\bcash\b/i.test(String(text || ''));
}

function checkNumberIn(text) {
  const match = String(text || '').match(
    /\b(?:cheque|check|chq|chk)\b\.?\s*#?\s*(\d{3,})\b|\b(?:chq|chk)\s*#?\s*(\d{3,})\b|#\s*(\d{3,})\b/i,
  );
  return match ? match[1] || match[2] || match[3] || '' : '';
}

function dollarsInText(text) {
  const found = [];
  const re = /\$\s*(\d{1,7}(?:,\d{3})*(?:\.\d{1,2})?)/g;
  let match = re.exec(String(text || ''));
  while (match) {
    const n = Number(String(match[1]).replace(/,/g, ''));
    if (n >= 0.01) found.push(roundMoney(n));
    match = re.exec(String(text || ''));
  }
  return found;
}

function namesMatch(a, b) {
  return (
    String(a || '')
      .trim()
      .localeCompare(String(b || '').trim(), undefined, { sensitivity: 'base' }) === 0
  );
}

function varianceStatus(cents) {
  if (cents == null) return 'not_counted';
  if (Math.abs(cents) < BALANCE_CENTS) return 'balanced';
  return cents > 0 ? 'over' : 'short';
}

function varianceLabel(cents, currency) {
  const status = varianceStatus(cents);
  if (status === 'not_counted') return `${currency} counted cash was not entered`;
  if (status === 'balanced') return `${currency} counted cash matches the till`;
  const amount = money(cents / 100, currency);
  return status === 'over' ? `${currency} over by ${amount}` : `${currency} short by ${amount}`;
}

function pushCandidate(list, candidate) {
  const expectedDelta = roundMoney(candidate.expectedDelta);
  const cents = toCents(expectedDelta);
  if (!cents) return;
  list.push({
    ...candidate,
    expectedDelta,
    cents,
    ref: candidate.ref || 'entry',
    detail: clip(candidate.detail),
  });
}

function addPaymentCandidates(list, rows, { role, currency }) {
  const duplicates = new Map();
  (rows || []).forEach((row, index) => {
    const signed = roundMoney(signedOf(row));
    const key = [refOf(row), signed, row?.customerName || '', row?.paymentType || ''].join('|');
    const bucket = duplicates.get(key) || [];
    bucket.push(index);
    duplicates.set(key, bucket);
  });

  (rows || []).forEach((row, index) => {
    const id = rowId(row, index);
    const signed = roundMoney(signedOf(row));
    const amountLabel = money(Math.abs(signed), currency);
    const ref = refOf(row);
    const who = row?.customerName && row.customerName !== '—' ? ` (${row.customerName})` : '';
    const dir = signed >= 0 ? 'in' : 'out';
    const comments = row?.comments || '';
    const checkNumber = row?.checkNumber || checkNumberIn(comments);
    const group = `pay:${id}`;
    const dupKey = [ref, signed, row?.customerName || '', row?.paymentType || ''].join('|');
    const dupCount = duplicates.get(dupKey)?.length || 1;

    if (role === 'cash') {
      let score = dupCount > 1 ? 86 : 24;
      let kind = dupCount > 1 ? 'duplicate-cash' : 'extra-cash-entry';
      let detail = `${ref}${who} cash ${dir} ${amountLabel}. Dropping it changes expected on hand.`;
      if (dupCount > 1) {
        detail = `${ref}${who} cash ${dir} ${amountLabel} is on the till ${dupCount} times. Dropping one copy changes expected on hand.`;
      }
      if (row?.suspiciousCashWithCheckNumber || (looksCash(row?.paymentType) && checkNumber)) {
        score = 97;
        kind = 'cash-with-check-number';
        detail = `${ref}${who} is tagged cash ${dir} ${amountLabel}, but comments include check #${checkNumber}. It is likely a cheque and should not be in the till.`;
      } else if (badStatus(row?.status)) {
        score = 92;
        kind = 'cash-not-cleared';
        detail = `${ref}${who} cash ${dir} ${amountLabel} has status ${row.status}. It should not move the till.`;
      } else if (/transfer/i.test(comments)) {
        score = Math.max(score, 64);
        detail = `${ref}${who} cash ${dir} ${amountLabel} mentions a transfer. Dropping it changes expected on hand.`;
      }
      pushCandidate(list, {
        id: `drop:${id}`,
        group,
        score,
        kind,
        ref,
        expectedDelta: -signed,
        detail,
      });

      const commentsOut = /\b(paid out|payout|cash out|petty|refund)\b/i.test(comments);
      const commentsIn = /\b(received|cash in|drop off)\b/i.test(comments);
      const contradicted = (signed > 0 && commentsOut) || (signed < 0 && commentsIn);
      if (contradicted) {
        pushCandidate(list, {
          id: `flip:${id}`,
          group,
          score: 72,
          kind: 'wrong-direction',
          ref,
          expectedDelta: -2 * signed,
          detail: `${ref}${who} is cash ${dir} ${amountLabel}, but the comments describe the opposite direction. Reversing it changes expected on hand by twice that amount.`,
        });
      }
      return;
    }

    let score = 26;
    let kind = 'non-cash-should-be-cash';
    const method = row?.paymentType || 'non-cash';
    let detail = `${ref}${who} is ${method} ${dir} ${amountLabel}. If it was actually cash, the till is missing it.`;
    if (looksCash(comments) && !checkNumber) {
      score = 84;
      detail = `${ref}${who} is ${method} ${dir} ${amountLabel}, but the comments say cash. Adding it to the till changes expected on hand.`;
    } else if (row?.chequeMissingCheckNumber) {
      score = 58;
      kind = 'cheque-missing-number';
      detail = `${ref}${who} is cheque ${dir} ${amountLabel} with no check number. If it was cash, the till is missing it.`;
    } else if (checkNumber) {
      score = 18;
      detail = `${ref}${who} is ${method} ${dir} ${amountLabel} and comments include check #${checkNumber}. Unlikely to be cash.`;
    }
    pushCandidate(list, {
      id: `add:${id}`,
      group,
      score,
      kind,
      ref,
      expectedDelta: signed,
      detail,
    });
  });
}

function addTillCandidates(list, rows, { otherTill, currency }) {
  (rows || []).forEach((row, index) => {
    const id = rowId(row, index);
    const signed = roundMoney(signedOf(row));
    const amountLabel = money(Math.abs(signed), currency);
    const dir = signed >= 0 ? 'in' : 'out';
    const ref = refOf(row);
    const where = row?.tillName && row.tillName !== '—' ? ` on ${row.tillName}` : '';
    const category = row?.category || row?.paymentType || 'till entry';
    const comments = clip(row?.comments || '');
    const group = `${otherTill ? 'other' : 'till'}:${id}`;
    if (otherTill) {
      pushCandidate(list, {
        id: `move:${id}`,
        group,
        score: /till\s*1/i.test(String(row?.tillName || '')) ? 40 : 62,
        kind: 'other-till',
        ref,
        expectedDelta: signed,
        detail: `${category} cash ${dir} ${amountLabel}${where}${comments ? ` (${comments})` : ''}. It was left out of this drawer. Moving it here changes expected on hand.`,
      });
      return;
    }
    const transferish = /transfer/i.test(`${category} ${comments}`);
    pushCandidate(list, {
      id: `drop-till:${id}`,
      group,
      score: transferish ? 66 : 36,
      kind: transferish ? 'till-transfer' : 'till-entry',
      ref,
      expectedDelta: -signed,
      detail: `Till ${dir} ${amountLabel} ${category}${comments ? ` (${comments})` : ''}. Removing this adjustment changes expected on hand.`,
    });
    pushCandidate(list, {
      id: `flip-till:${id}`,
      group,
      score: 42,
      kind: 'till-wrong-direction',
      ref,
      expectedDelta: -2 * signed,
      detail: `Till ${dir} ${amountLabel} ${category}. If the direction is backwards, expected on hand changes by twice that amount.`,
    });
  });
}

function txDirection(tx) {
  return tx?.type === 'purchase' ? -1 : 1;
}

function addTransactionCandidates(list, transactions, cashPayments) {
  const covered = new Set();
  for (const row of cashPayments || []) {
    for (const key of refKeys(row?.reference)) covered.add(key);
  }

  for (const tx of transactions || []) {
    const ref = refOf(tx);
    const keys = refKeys(ref);
    const sign = txDirection(tx);
    const total = Math.abs(Number(tx?.amount) || 0);
    const lines = Array.isArray(tx?.payments) ? tx.payments : [];
    const lined = roundMoney(lines.reduce((sum, line) => sum + Math.abs(Number(line?.amount) || 0), 0));
    const kindLabel = tx?.type === 'purchase' ? 'purchase' : 'sale';

    if (lines.length && total - lined >= 0.01) {
      const gap = roundMoney(total - lined);
      pushCandidate(list, {
        id: `gap:${ref}`,
        group: `tx:${ref}`,
        score: 70,
        kind: 'payment-gap',
        ref,
        expectedDelta: sign * gap,
        detail: `${ref} ${kindLabel} is ${money(total)} but its payments add to ${money(lined)}. The ${money(gap)} gap may be unrecorded cash.`,
      });
    }

    const cashLines = lines.filter((line) => line?.likelyCash && !line?.suspiciousCashWithCheckNumber);
    const listedCash = looksCash(tx?.listedPaymentMethods) || tx?.flags?.hasCashSignal;
    const cashAmount = cashLines.length
      ? roundMoney(cashLines.reduce((sum, line) => sum + Math.abs(Number(line?.amount) || 0), 0))
      : listedCash
        ? total
        : 0;
    const alreadyInTill = keys.some((key) => covered.has(key));
    const nonCashCovers = lines.length > 0 && !cashLines.length && lined + 0.01 >= total;
    if (cashAmount >= 0.01 && !alreadyInTill && !nonCashCovers) {
      pushCandidate(list, {
        id: `missing:${ref}`,
        group: `tx:${ref}`,
        score: 76,
        kind: 'missing-cash-on-document',
        ref,
        expectedDelta: sign * cashAmount,
        detail: `${ref} ${kindLabel} shows cash but no cleared cash payment is on this till. Adding ${money(cashAmount)} changes expected on hand.`,
      });
    }

    if (tx?.flags?.notPaid) {
      for (const row of cashPayments || []) {
        const overlap = refKeys(row?.reference).some((key) => keys.includes(key));
        if (!overlap) continue;
        const group = `pay:${rowId(row, ref)}`;
        for (const candidate of list) {
          if (candidate.group !== group || !String(candidate.id).startsWith('drop:')) continue;
          candidate.score = Math.max(candidate.score, 90);
          candidate.kind = 'unpaid-sale-or-purchase';
          candidate.detail = `${ref} is not paid, but its cash is still on the till. Taking that cash off the till changes expected on hand.`;
        }
      }
    }
  }
}

function addTransferCandidates(list, transfers, storeName, currency) {
  for (const transfer of transfers || []) {
    const comments = transfer?.comments || '';
    const usd = /\busd\b|us\$/i.test(comments);
    if (currency === 'USD' ? !usd : usd) continue;
    const amounts = dollarsInText(comments);
    if (!amounts.length) continue;
    const from = namesMatch(transfer?.from?.name, storeName);
    const to = namesMatch(transfer?.to?.name, storeName);
    const ref = transfer?.reference || `TR# ${transfer?.id || ''}`;
    amounts.forEach((amount, index) => {
      if (from && !to) {
        pushCandidate(list, {
          id: `tr-out:${transfer.id}:${index}`,
          group: `tr:${transfer.id}:${index}`,
          score: 60,
          kind: 'transfer-cash',
          ref,
          expectedDelta: -amount,
          detail: `${ref} left ${transfer?.from?.name || 'this store'} for ${transfer?.to?.name || 'another store'}. Comments mention ${money(amount, currency)}. If that cash left with the transfer and was not posted, recording the out changes expected on hand.`,
        });
      } else if (to && !from) {
        pushCandidate(list, {
          id: `tr-in:${transfer.id}:${index}`,
          group: `tr:${transfer.id}:${index}`,
          score: 60,
          kind: 'transfer-cash',
          ref,
          expectedDelta: amount,
          detail: `${ref} arrived at ${transfer?.to?.name || 'this store'} from ${transfer?.from?.name || 'another store'}. Comments mention ${money(amount, currency)}. If that cash arrived and was not posted, recording the in changes expected on hand.`,
        });
      }
    });
  }
}

function addLogCandidates(list, reconciliation, currency, previousDate) {
  const payments = reconciliation?.payments || {};
  for (const event of payments.deleted || []) {
    const eventCurrency = String(event?.currency || '').toUpperCase();
    if (eventCurrency && eventCurrency !== currency) continue;
    if (!eventCurrency && currency !== 'CAD') continue;
    const comments = event?.comments || '';
    if (looksDebit(comments) && !looksCash(comments)) continue;
    const amount = Math.abs(Number(event?.amount) || 0);
    if (amount < 0.01) continue;
    const signed = String(event?.type) === 'Out' ? -amount : amount;
    const checkNumber = checkNumberIn(comments);
    let score = looksCash(comments) && !checkNumber ? 80 : 46;
    if (checkNumber && !looksCash(comments)) score = 22;
    pushCandidate(list, {
      id: `restore:${event.id}`,
      group: `restore:${event.id}`,
      score,
      kind: 'deleted-payment',
      ref: event.label || `payment ${event.id}`,
      expectedDelta: signed,
      detail: `${event.label || 'A payment'} was deleted${event.user ? ` by ${event.user}` : ''}. If that cash is still in the drawer, putting the payment back changes expected on hand.`,
    });
  }

  for (const event of payments.amountEdits || []) {
    const eventCurrency = String(event?.currency || '').toUpperCase();
    if (eventCurrency && eventCurrency !== currency) continue;
    if (!eventCurrency && currency !== 'CAD') continue;
    if (event?.amountDelta == null) continue;
    const direction = String(event?.type) === 'Out' ? -1 : 1;
    const revert = roundMoney(-(direction * Number(event.amountDelta)));
    pushCandidate(list, {
      id: `revert:${event.id}`,
      group: `edit:${event.id}`,
      score: 84,
      kind: 'amount-edit',
      ref: event.label || `payment ${event.id}`,
      expectedDelta: revert,
      detail: `${event.label || 'A payment'} amount was edited${event.user ? ` by ${event.user}` : ''}. Reverting that edit changes expected on hand.`,
    });
  }

  for (const timeline of reconciliation?.cashLogTimelines || []) {
    const logCurrency = String(timeline?.currency || 'CAD').toUpperCase();
    if (logCurrency !== currency) continue;
    if (previousDate && timeline?.recordDate && timeline.recordDate !== previousDate) continue;
    const delta = roundMoney(-(Number(timeline?.netRevision) || 0));
    pushCandidate(list, {
      id: `open-log:${timeline.cashLogId}`,
      group: 'opening',
      score: 74,
      kind: 'opening-count-edit',
      ref: `cash log ${timeline.cashLogId || ''}`.trim(),
      expectedDelta: delta,
      detail: `The opening count was edited from ${timeline.firstAmount} to ${timeline.lastAmount}. Using the earlier figure as today's opening changes expected on hand.`,
    });
  }
}

function addOpeningCandidate(list, { openingBalance, yesterdayPhysical, currency }) {
  if (openingBalance == null || yesterdayPhysical == null) return;
  const delta = roundMoney(Number(yesterdayPhysical) - Number(openingBalance));
  pushCandidate(list, {
    id: 'opening-gap',
    group: 'opening',
    score: 68,
    kind: 'opening-balance',
    ref: 'opening balance',
    expectedDelta: delta,
    detail: `Today's opening (${money(openingBalance, currency)}) does not match yesterday's physical count (${money(yesterdayPhysical, currency)}). Using yesterday's count changes expected on hand.`,
  });
}

function comboKey(parts) {
  return parts
    .map((part) => part.id)
    .slice()
    .sort()
    .join('|');
}

function comboRank(parts) {
  const average = parts.reduce((sum, part) => sum + (part.score || 0), 0) / parts.length;
  return average - (parts.length - 1) * 6;
}

function groupsClash(parts) {
  const seen = new Set();
  for (const part of parts) {
    if (!part.group) continue;
    if (seen.has(part.group)) return true;
    seen.add(part.group);
  }
  return false;
}

function findCombinations(candidates, targetCents) {
  const exact = [];
  const near = [];
  const seen = new Set();

  function consider(parts, allowNear) {
    if (!parts.length || groupsClash(parts)) return;
    const key = comboKey(parts);
    if (seen.has(key)) return;
    const sum = parts.reduce((total, part) => total + part.cents, 0);
    const distance = Math.abs(sum - targetCents);
    if (distance === 0) {
      seen.add(key);
      exact.push(parts);
      return;
    }
    if (!allowNear || distance > NEAR_CENTS) return;
    seen.add(key);
    near.push({ parts, distance, sum });
    if (near.length <= 12) return;
    near.sort((a, b) => a.distance - b.distance || comboRank(b.parts) - comboRank(a.parts));
    near.length = 8;
  }

  const indexed = candidates.map((candidate, index) => ({ ...candidate, index }));
  for (const candidate of indexed) consider([candidate], true);

  for (let i = 0; i < indexed.length; i += 1) {
    for (let j = i + 1; j < indexed.length; j += 1) {
      consider([indexed[i], indexed[j]], true);
    }
  }

  const byCents = new Map();
  indexed.forEach((candidate) => {
    const bucket = byCents.get(candidate.cents) || [];
    bucket.push(candidate);
    byCents.set(candidate.cents, bucket);
  });

  for (let i = 0; i < indexed.length; i += 1) {
    for (let j = i + 1; j < indexed.length; j += 1) {
      const need = targetCents - indexed[i].cents - indexed[j].cents;
      const hits = byCents.get(need) || [];
      let taken = 0;
      for (const hit of hits) {
        if (hit.index <= j) continue;
        consider([indexed[i], indexed[j], hit], false);
        taken += 1;
        if (taken >= 6) break;
      }
    }
  }

  const pool = indexed
    .slice()
    .sort((a, b) => b.score - a.score || Math.abs(b.cents) - Math.abs(a.cents))
    .slice(0, 16);
  for (let i = 0; i < pool.length; i += 1) {
    for (let j = i + 1; j < pool.length; j += 1) {
      for (let k = j + 1; k < pool.length; k += 1) {
        for (let l = k + 1; l < pool.length; l += 1) {
          const sum = pool[i].cents + pool[j].cents + pool[k].cents + pool[l].cents;
          if (sum === targetCents) consider([pool[i], pool[j], pool[k], pool[l]], false);
        }
      }
    }
  }

  exact.sort((a, b) => comboRank(b) - comboRank(a) || a.length - b.length);
  near.sort(
    (a, b) => a.distance - b.distance || comboRank(b.parts) - comboRank(a.parts) || a.parts.length - b.parts.length,
  );
  const singles = exact.filter((parts) => parts.length === 1).slice(0, 3);
  const combined = exact.filter((parts) => parts.length > 1).slice(0, 3);
  const picked = [...singles, ...combined];
  picked.sort((a, b) => comboRank(b) - comboRank(a) || a.length - b.length);
  return {
    exact: picked,
    near: picked.length ? [] : near.slice(0, 3),
  };
}

function presentMatch(parts, currency, { distance } = {}) {
  const sum = roundMoney(parts.reduce((total, part) => total + part.expectedDelta, 0));
  const lines = parts.map((part) => part.detail).filter(Boolean);
  const together =
    parts.length === 1
      ? `One mistake changes expected on hand by ${money(sum, currency)}.`
      : `These ${parts.length} mistakes together change expected on hand by ${money(sum, currency)}.`;
  const off =
    distance > 0 ? ` That is ${money(distance / 100, currency)} away from the difference.` : '';
  return {
    size: parts.length,
    expectedDelta: sum,
    kinds: parts.map((part) => part.kind),
    refs: [...new Set(parts.map((part) => part.ref).filter(Boolean))],
    parts: parts.map((part) => ({
      kind: part.kind,
      ref: part.ref,
      expectedDelta: part.expectedDelta,
      detail: part.detail,
    })),
    plain: `${together}${off} ${lines.join(' ')}`.trim(),
  };
}

/**
 * Explain one drawer's counted-vs-expected gap.
 */
export function explainDrawerVariance({
  currency = 'CAD',
  variance = null,
  openingBalance = null,
  yesterdayPhysical = null,
  cashPayments = [],
  nonCashPayments = [],
  cashTransactions = [],
  otherTillPayments = [],
  otherTillTransactions = [],
  transactions = [],
  transfers = [],
  reconciliation = null,
  previousDate = null,
  storeName = '',
} = {}) {
  const cents = variance == null || !Number.isFinite(Number(variance)) ? null : toCents(variance);
  const status = varianceStatus(cents);
  const drawerTransactions = (transactions || []).filter((tx) => {
    const code = String(tx?.currency || 'CAD').toUpperCase();
    return currency === 'USD' ? code === 'USD' : code !== 'USD';
  });
  const sales = drawerTransactions.filter((tx) => tx?.type !== 'purchase');
  const purchases = drawerTransactions.filter((tx) => tx?.type === 'purchase');
  const checked = {
    cashPayments: (cashPayments || []).length,
    nonCashPayments: (nonCashPayments || []).length,
    tillEntries: (cashTransactions || []).length,
    otherTillEntries: (otherTillPayments || []).length + (otherTillTransactions || []).length,
    sales: sales.length,
    purchases: purchases.length,
    transfers: (transfers || []).length,
    logEdits:
      (reconciliation?.payments?.deleted || []).length +
      (reconciliation?.payments?.amountEdits || []).length +
      (reconciliation?.cashLogTimelines || []).length,
  };

  if (status === 'not_counted' || status === 'balanced') {
    return {
      currency,
      variance: variance == null ? null : roundMoney(variance),
      status,
      label: varianceLabel(cents, currency),
      checked,
      exactMatches: [],
      closestMatches: [],
    };
  }

  const candidates = [];
  addPaymentCandidates(candidates, cashPayments, { role: 'cash', currency });
  addPaymentCandidates(candidates, nonCashPayments, { role: 'other', currency });
  addTillCandidates(candidates, cashTransactions, { otherTill: false, currency });
  addTillCandidates(candidates, otherTillPayments, { otherTill: true, currency });
  addTillCandidates(candidates, otherTillTransactions, { otherTill: true, currency });
  addTransactionCandidates(candidates, drawerTransactions, cashPayments);
  addTransferCandidates(candidates, transfers, storeName, currency);
  addLogCandidates(candidates, reconciliation, currency, previousDate);
  addOpeningCandidate(candidates, { openingBalance, yesterdayPhysical, currency });

  const { exact, near } = findCombinations(candidates, cents);
  return {
    currency,
    variance: roundMoney(variance),
    status,
    label: varianceLabel(cents, currency),
    checked,
    candidateCount: candidates.length,
    exactMatches: exact.map((parts, index) => ({
      rank: index + 1,
      ...presentMatch(parts, currency),
    })),
    closestMatches: near.map((entry) => presentMatch(entry.parts, currency, { distance: entry.distance })),
  };
}

export function explainCashVariances({ cad, usd, shared }) {
  return {
    howToRead:
      'expectedDelta is the change to expected on hand if that mistake is corrected. Counted cash minus expected cash is the variance. An exact match is one mistake, or a combination of up to 4, whose expectedDelta values add up to that variance.',
    cad: explainDrawerVariance({ ...(shared || {}), ...(cad || {}), currency: 'CAD' }),
    usd: explainDrawerVariance({ ...(shared || {}), ...(usd || {}), currency: 'USD' }),
  };
}
