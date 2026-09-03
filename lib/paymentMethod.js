/**
 * Shared Cash / Cheque / Debit classification from POS method + comments.
 *
 * Rules:
 * - Debit = issue payment method is Debit (Interac/EFT count as debit-like).
 * - Cheque/Check should have a check # in comments.
 * - Cash + check # in comments is suspicious (likely mis-tagged).
 */

export function normalizeMethod(name) {
  return String(name || '').trim().toLowerCase();
}

export function isCashMethod(name) {
  return normalizeMethod(name) === 'cash';
}

export function isDebitMethod(name) {
  return /\b(debit|interac|eft)\b/.test(normalizeMethod(name));
}

export function isChequeMethod(name) {
  return /\b(cheque|check|chk|chq)\b/.test(normalizeMethod(name));
}

/**
 * Prefer explicit cheque markers near a number; fall back to bare #NNNN.
 * Returns the number string or null.
 */
export function extractCheckNumber(comments) {
  const text = String(comments || '');
  const explicit = text.match(
    /\b(?:cheque|check|chq|chk)\b\.?\s*#?\s*(\d{3,})\b|\b(?:chq|chk)\s*#?\s*(\d{3,})\b/i
  );
  if (explicit) return explicit[1] || explicit[2] || null;

  const bareHash = text.match(/#\s*(\d{3,})\b/);
  return bareHash ? bareHash[1] : null;
}

export function hasCheckNumberSignal(comments) {
  return Boolean(extractCheckNumber(comments));
}

/**
 * Classify one payment (or transaction comments + listed method).
 */
export function classifyPayment({ method, comments } = {}) {
  const methodName = method || '';
  const note = comments || '';
  const checkNumber = extractCheckNumber(note);
  const methodCash = isCashMethod(methodName);
  const methodDebit = isDebitMethod(methodName);
  const methodCheque = isChequeMethod(methodName);

  let inferred = 'other';
  if (methodCheque || checkNumber) inferred = 'cheque';
  else if (methodDebit) inferred = 'debit';
  else if (methodCash) inferred = 'cash';

  return {
    method: methodName,
    checkNumber,
    inferred,
    methodCash,
    methodDebit,
    methodCheque,
    // Cash labeled but check # in comments → likely error
    suspiciousCashWithCheckNumber: methodCash && Boolean(checkNumber),
    // Method is cheque/check but no check # in comments
    chequeMissingCheckNumber: methodCheque && !checkNumber,
    likelyCheque: methodCheque || Boolean(checkNumber),
    // Debit is method-only (issue payment), not comment text
    likelyDebit: methodDebit,
    likelyCash: methodCash && !checkNumber,
  };
}
