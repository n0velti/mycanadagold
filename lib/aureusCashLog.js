/**
 * Aureus Daily Cash log (Daily → Cash).
 * Beginning, cash from transactions, banking, and other, plus every line.
 * paymentBreakdown is the full split on the linked sale or purchase.
 */

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function signedAmount(row) {
  const amount = Number(row?.amount) || 0;
  const dir = row?.type || row?.direction;
  return dir === 'Out' ? -amount : amount;
}

function sumRows(rows) {
  return roundMoney((rows || []).reduce((sum, row) => sum + signedAmount(row), 0));
}

function refKeys(reference) {
  const keys = [];
  const re = /\b(SO|PO)\s*#?\s*(\d+)/gi;
  const text = String(reference || '');
  let match = re.exec(text);
  while (match) {
    keys.push(`${match[1].toUpperCase()}:${match[2]}`);
    match = re.exec(text);
  }
  return keys;
}

function indexDocs(transactions) {
  const map = new Map();
  for (const tx of transactions || []) {
    for (const key of refKeys(tx?.reference)) {
      if (!map.has(key)) map.set(key, tx);
    }
  }
  return map;
}

function breakdownFor(reference, docs) {
  const parts = [];
  const seen = new Set();
  for (const key of refKeys(reference)) {
    const tx = docs.get(key);
    if (!tx || seen.has(tx.reference || key)) continue;
    seen.add(tx.reference || key);
    for (const payment of tx.payments || []) {
      const part = {
        ref: tx.reference,
        method: payment.method,
        amount: payment.amount,
      };
      if (payment.status) part.status = payment.status;
      if (payment.checkNumber) part.checkNumber = payment.checkNumber;
      parts.push(part);
    }
  }
  return parts.length ? parts : undefined;
}

function cleanName(value) {
  const text = String(value || '').trim();
  if (!text || text === '—') return undefined;
  return text;
}

function paymentLine(row, docs) {
  const inbound = (row.type || row.direction) !== 'Out';
  const line = {
    till: cleanName(row.tillName),
    customer: cleanName(row.customerName),
    transaction: cleanName(row.reference),
    method: cleanName(row.paymentType || row.paymentMethod),
    status: cleanName(row.status),
  };
  if (inbound) line.receipt = row.amount;
  else line.outlay = row.amount;
  if (row.comments) line.comments = String(row.comments).slice(0, 180);
  const split = breakdownFor(row.reference, docs);
  if (split) line.paymentBreakdown = split;
  return line;
}

function tillLine(row) {
  const inbound = row.type !== 'Out';
  const line = {
    category: row.category || 'Other',
    till: cleanName(row.tillName),
  };
  if (inbound) line.receipt = row.amount;
  else line.outlay = row.amount;
  if (row.comments) line.comments = String(row.comments).slice(0, 180);
  return line;
}

function isBank(row) {
  return /bank/i.test(String(row?.category || ''));
}

function drawerLog(drawer, docs) {
  if (!drawer) return null;
  const payments = drawer.paymentRows || [];
  const txns = drawer.cashTransactions || [];
  const banking = txns.filter(isBank);
  const other = txns.filter((row) => !isBank(row));
  const physical = Number(drawer.todayPhysical);
  const counted = Number.isFinite(physical) && Math.abs(physical) >= 0.005;
  const expected = drawer.expectedOnHand;
  return {
    drawer: drawer.label,
    currency: drawer.currency,
    beginning: drawer.openingBalance,
    cashChangeFromTransactions: sumRows(payments),
    cashChangeFromBanking: sumRows(banking),
    cashChangeFromOther: sumRows(other),
    expectedEnding: expected,
    physicalCount: counted ? physical : null,
    variance: counted ? roundMoney(physical - expected) : null,
    transactionCount: payments.length,
    transactions: payments.map((row) => paymentLine(row, docs)),
    banking: banking.map(tillLine),
    other: other.map(tillLine),
  };
}

/**
 * One store-day, in the same shape as Aureus Daily → Cash.
 * `transactions` are enriched sales/purchases; their payment splits are
 * attached to each cash line that cites that SO# or PO#.
 */
export function buildAureusCashLog(position, transactions) {
  if (!position || position.error) return null;
  const docs = indexDocs(transactions);
  const otherPayments = position.otherPayments || [];
  const otherTxns = position.otherTxns || [];
  return {
    source: 'Aureus Daily Cash log',
    store: position.storeName,
    date: position.date,
    note:
      'Every cleared cash payment is in transactions (receipt = cash in, outlay = cash out). paymentBreakdown is the full split on that sale or purchase: cash, debit, cheque, and anything else. banking and other are manual till lines. beginning + cashChangeFromTransactions + cashChangeFromBanking + cashChangeFromOther = expectedEnding.',
    till1Cad: drawerLog(position.cad, docs),
    usd: drawerLog(position.usd, docs),
    otherTills:
      otherPayments.length || otherTxns.length
        ? {
            transactions: otherPayments.map((row) => paymentLine(row, docs)),
            lines: otherTxns.map(tillLine),
          }
        : undefined,
  };
}

function scoreLine(line, date, priorityDates) {
  let score = 0;
  if (priorityDates?.has(date)) score += 4;
  if ((line.paymentBreakdown || []).length > 1) score += 6;
  if (line.comments) score += 1;
  return score;
}

function lineSlot(dayIndex, key, index) {
  return `${dayIndex}:${key}:${index}`;
}

/**
 * Keep every day's totals. Cap payment lines across the range so the prompt
 * still fits, preferring off days and mixed payment splits.
 */
export function trimAureusCashLogs(logs, { priorityDates = [], maxLines = 400 } = {}) {
  const days = (Array.isArray(logs) ? logs : []).filter(Boolean);
  const priority = new Set(priorityDates);
  const slots = [];
  days.forEach((log, dayIndex) => {
    for (const key of ['till1Cad', 'usd']) {
      (log[key]?.transactions || []).forEach((line, index) => {
        slots.push({
          dayIndex,
          key,
          index,
          score: scoreLine(line, log.date, priority),
        });
      });
    }
    (log.otherTills?.transactions || []).forEach((line, index) => {
      slots.push({
        dayIndex,
        key: 'otherTills',
        index,
        score: scoreLine(line, log.date, priority),
      });
    });
  });

  const keep = new Set();
  const ranked = [...slots].sort(
    (a, b) => b.score - a.score || a.dayIndex - b.dayIndex || a.index - b.index,
  );
  ranked.slice(0, maxLines).forEach((slot) => keep.add(lineSlot(slot.dayIndex, slot.key, slot.index)));

  return days.map((log, dayIndex) => {
    const copy = { ...log };
    const take = (key, lines) => {
      const kept = (lines || []).filter((_, index) => keep.has(lineSlot(dayIndex, key, index)));
      const omitted = (lines || []).length - kept.length;
      return { kept, omitted };
    };
    for (const key of ['till1Cad', 'usd']) {
      if (!log[key]) continue;
      const trimmed = take(key, log[key].transactions);
      copy[key] = {
        ...log[key],
        transactions: trimmed.kept,
        transactionsOmitted: trimmed.omitted || undefined,
      };
    }
    if (log.otherTills) {
      const trimmed = take('otherTills', log.otherTills.transactions);
      copy.otherTills = {
        ...log.otherTills,
        transactions: trimmed.kept,
        transactionsOmitted: trimmed.omitted || undefined,
      };
    }
    return copy;
  });
}
