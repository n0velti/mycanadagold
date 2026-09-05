export const CASH_DENOMS = [
  { key: 'd100', label: '100', face: 100, stackBills: 50, color: '#6B3F24' },
  { key: 'd50', label: '50', face: 50, stackBills: 50, color: '#C43B4B' },
  { key: 'd20', label: '20', face: 20, stackBills: 50, color: '#2F8A4E' },
  { key: 'd10', label: '10', face: 10, stackBills: 50, color: '#6B4C9A' },
  { key: 'd5', label: '5', face: 5, stackBills: 50, color: '#2F6FED' },
  { key: 'd2', label: '$2', face: 2, stackValue: 50, color: '#C4A35A' },
  { key: 'd1', label: '$1', face: 1, stackValue: 25, color: '#D4A017' },
  { key: 'd025', label: '$0.25', face: 0.25, stackValue: 10, color: '#8A8F98' },
];

export const USD_DENOMS = [
  { key: 'd100', label: '100', face: 100, stackBills: 50, color: '#1B6B45' },
  { key: 'd50', label: '50', face: 50, stackBills: 50, color: '#8E3F6A' },
  { key: 'd20', label: '20', face: 20, stackBills: 50, color: '#2F8A4E' },
  { key: 'd10', label: '10', face: 10, stackBills: 50, color: '#C48A2A' },
  { key: 'd5', label: '5', face: 5, stackBills: 50, color: '#5B4B9A' },
  { key: 'd1', label: '1', face: 1, stackBills: 50, color: '#3F6B4A' },
];

export function parseCount(value) {
  const cleaned = String(value ?? '')
    .replace(/[^0-9.-]/g, '')
    .trim();
  if (!cleaned || cleaned === '-' || cleaned === '.' || cleaned === '-.') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function emptyDenomCounts(denoms = CASH_DENOMS) {
  return Object.fromEntries(denoms.map((denom) => [denom.key, '']));
}

function denomLooseValue(denom, countText) {
  const n = parseCount(countText);
  if (n == null) return 0;
  return n * denom.face;
}

function denomStackValue(denom, countText) {
  const n = parseCount(countText);
  if (n == null) return 0;
  if (denom.stackValue != null) return n * denom.stackValue;
  return n * denom.stackBills * denom.face;
}

export function computeCountedFromDenoms(denoms, looseCounts, stackCounts, otherText) {
  const otherCash = parseCount(otherText);
  const hasDenomCount =
    Boolean(String(otherText || '').trim()) ||
    denoms.some(
      (denom) =>
        String(looseCounts?.[denom.key] || '').trim() !== '' ||
        String(stackCounts?.[denom.key] || '').trim() !== '',
    );
  const columns = denoms.map((denom) => {
    const loose = denomLooseValue(denom, looseCounts?.[denom.key]);
    const stacks = denomStackValue(denom, stackCounts?.[denom.key]);
    return {
      key: denom.key,
      loose,
      stacks,
      total: loose + stacks,
    };
  });
  const otherTotal = otherCash != null ? otherCash : 0;
  const total = hasDenomCount
    ? Math.round((columns.reduce((sum, col) => sum + col.total, 0) + otherTotal) * 100) / 100
    : null;
  return { hasDenomCount, columns, otherTotal, total };
}

export function denomTitle(denom) {
  if (denom.face === 0.25) return '25¢';
  if (denom.face < 1) return `${Math.round(denom.face * 100)}¢`;
  return `$${denom.face}`;
}

export function denomHint(denom) {
  if (denom.stackValue != null) return `$${denom.stackValue}/roll`;
  return `${denom.stackBills} bills`;
}

export function denomPieceLabel(denom, count) {
  const n = Number(count) || 0;
  if (denom.stackValue != null) return n === 1 ? 'coin' : 'coins';
  return n === 1 ? 'bill' : 'bills';
}

export function denomStackLabel(denom, count) {
  const n = Number(count) || 0;
  if (denom.stackValue != null) return n === 1 ? 'roll' : 'rolls';
  return n === 1 ? 'strap' : 'straps';
}

export function splitCashDenoms(denoms) {
  return {
    bills: denoms.filter((denom) => denom.stackBills != null),
    coins: denoms.filter((denom) => denom.stackValue != null),
  };
}

export function bumpCountText(current, delta) {
  const n = parseCount(current) ?? 0;
  const next = Math.max(0, Math.round(n + delta));
  return next === 0 ? '' : String(next);
}

export function looseBreakdownLine(denoms, looseCounts) {
  return denoms
    .map((denom) => {
      const n = parseCount(looseCounts?.[denom.key]);
      if (n == null || n === 0) return null;
      return `${n}×${denomTitle(denom)}`;
    })
    .filter(Boolean)
    .join('  ·  ');
}

export function stackBreakdownLine(denoms, stackCounts) {
  return denoms
    .map((denom) => {
      const n = parseCount(stackCounts?.[denom.key]);
      if (n == null || n === 0) return null;
      return `${n} ${denomStackLabel(denom, n)} ${denomTitle(denom)}`;
    })
    .filter(Boolean)
    .join('  ·  ');
}

export function denomsForCurrency(currency) {
  return String(currency || 'CAD').toUpperCase() === 'USD' ? USD_DENOMS : CASH_DENOMS;
}

export function piecesPerStack(denom) {
  if (denom?.stackBills != null) return denom.stackBills;
  if (denom?.stackValue != null && denom.face) return denom.stackValue / denom.face;
  return 0;
}

export function countedPiecesForDenom(denom, looseText, stackText) {
  const looseN = parseCount(looseText) || 0;
  const stackN = parseCount(stackText) || 0;
  return looseN + stackN * piecesPerStack(denom);
}

export function piecesFromSheet(denoms, looseCounts, stackCounts) {
  const next = {};
  for (const denom of denoms) {
    next[denom.key] = countedPiecesForDenom(
      denom,
      looseCounts?.[denom.key],
      stackCounts?.[denom.key],
    );
  }
  return next;
}

export function addPieceMaps(left, right, sign = 1) {
  const keys = new Set([...Object.keys(left || {}), ...Object.keys(right || {})]);
  const next = {};
  for (const key of keys) {
    next[key] = (Number(left?.[key]) || 0) + sign * (Number(right?.[key]) || 0);
  }
  return next;
}

export function pieceBreakdownLine(denoms, pieces) {
  return denoms
    .map((denom) => {
      const n = Number(pieces?.[denom.key]) || 0;
      if (!n) return null;
      return `${n}×${denomTitle(denom)}`;
    })
    .filter(Boolean)
    .join('  ·  ');
}

export function denomValueFromPieces(denoms, pieces) {
  return Math.round(
    denoms.reduce((sum, denom) => sum + (Number(pieces?.[denom.key]) || 0) * denom.face, 0) * 100,
  ) / 100;
}

export function rowsFromPieces(currency, pieces) {
  const denoms = denomsForCurrency(currency);
  const rows = [];
  for (const denom of denoms) {
    const n = Number(pieces?.[denom.key]) || 0;
    if (!n) continue;
    rows.push({
      key: denom.key,
      title: denomTitle(denom),
      color: denom.color,
      detail: `${n} ${denomPieceLabel(denom, n)}`,
      amount: Math.round(n * denom.face * 100) / 100,
      count: n,
    });
  }
  return {
    rows,
    total: denomValueFromPieces(denoms, pieces),
    looseLine: pieceBreakdownLine(denoms, pieces),
    hasCount: rows.length > 0,
  };
}

export function breakdownRows(currency, looseCounts, stackCounts, otherText) {
  const denoms = denomsForCurrency(currency);
  const computed = computeCountedFromDenoms(denoms, looseCounts, stackCounts, otherText);
  const rows = [];
  for (const denom of denoms) {
    const looseN = parseCount(looseCounts?.[denom.key]);
    const stackN = parseCount(stackCounts?.[denom.key]);
    if (!looseN && !stackN) continue;
    const col = computed.columns.find((entry) => entry.key === denom.key);
    const parts = [];
    if (looseN) parts.push(`${looseN} ${denomPieceLabel(denom, looseN)}`);
    if (stackN) parts.push(`${stackN} ${denomStackLabel(denom, stackN)}`);
    rows.push({
      key: denom.key,
      title: denomTitle(denom),
      color: denom.color,
      detail: parts.join(' · '),
      amount: col?.total || 0,
    });
  }
  if (computed.otherTotal) {
    rows.push({
      key: 'other',
      title: 'Other',
      color: '#8e8e93',
      detail: 'Cheques, extras',
      amount: computed.otherTotal,
    });
  }
  return {
    rows,
    total: computed.total,
    looseLine: looseBreakdownLine(denoms, looseCounts),
    stackLine: stackBreakdownLine(denoms, stackCounts),
    hasCount: computed.hasDenomCount,
  };
}
