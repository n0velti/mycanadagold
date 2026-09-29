import { classifyPurchaseForTriage, fineMetalFromLine } from './priceCheck';

function formatDay(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function poDateKey(row) {
  const raw = row?.date;
  if (!raw) return '';
  const text = String(raw);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const time = Date.parse(text.replace(' ', 'T'));
  if (!Number.isFinite(time)) return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : '';
  return formatDay(new Date(time));
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

const MONTH_LABELS = {
  JAN: 'January',
  FEB: 'February',
  MAR: 'March',
  APR: 'April',
  MAY: 'May',
  JUN: 'June',
  JUL: 'July',
  AUG: 'August',
  SEP: 'September',
  OCT: 'October',
  NOV: 'November',
  DEC: 'December',
};

function cleanStoreName(value) {
  const raw = String(value || '').trim();
  if (!raw || raw === '—') return '';
  return raw.replace(/^canada\s*gold\s*/i, '').replace(/^cg\s+/i, '').trim() || raw;
}

/** Compact location token for lot ids: "Carlingwood", "QuebecCity". */
export function lotLocationToken(storeName) {
  const parts = cleanStoreName(storeName)
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  if (!parts.length) return 'Unknown';
  return parts
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

export function lotStoreName(po) {
  const name = cleanStoreName(po?.storeName || po?.systemLabel || '');
  return name || 'Unknown store';
}

function datePartsFromPo(po) {
  const day = poDateKey(po);
  if (/^\d{4}-\d{2}-\d{2}/.test(day)) {
    return { year: day.slice(0, 4), month: MONTHS[Number(day.slice(5, 7)) - 1] || 'JAN', dateKey: day };
  }
  const time = Date.parse(po?.date || po?.addedAt || '');
  const date = Number.isFinite(time) ? new Date(time) : new Date();
  const year = String(date.getFullYear());
  const month = MONTHS[date.getMonth()] || 'JAN';
  const dateKey = `${year}-${String(date.getMonth() + 1).padStart(2, '0')}-01`;
  return { year, month, dateKey };
}

/** Folder id like LOT_Carlingwood_JAN_2026 from a PO's store and date. */
export function lotFromPo(po) {
  const location = lotStoreName(po);
  const token = lotLocationToken(location);
  const { year, month, dateKey } = datePartsFromPo(po);
  const id = `LOT_${token}_${month}_${year}`;
  return {
    id,
    location,
    locationToken: token,
    month,
    year,
    dateKey,
    periodLabel: `${MONTH_LABELS[month] || month} ${year}`,
  };
}

export function lotPeriodLabel(lot) {
  if (!lot) return '';
  if (lot.periodLabel) return lot.periodLabel;
  const month = MONTH_LABELS[lot.month] || lot.month || '';
  return [month, lot.year].filter(Boolean).join(' ');
}

function monthIndex(month) {
  const index = MONTHS.indexOf(String(month || '').toUpperCase());
  return index >= 0 ? index : 0;
}

/** Melt-bound PO / SO. Bullion-only purchases stay in store and are not expected. */
export function isExpectedMeltPo(row) {
  if (!row) return false;
  if (row.bullionOnly) return false;
  try {
    return !classifyPurchaseForTriage(row).bullionOnly;
  } catch {
    return true;
  }
}

function lotOf(row) {
  return row?.lot && row.lot.id ? row.lot : lotFromPo(row);
}

function isEvaluatedPo(row) {
  return Boolean(row?.evaluated || row?.received || row?.incorrect);
}

/** Group finished POs into lot folders. A missing folder is created on first PO. */
export function groupPosIntoLots(rows = [], allRows) {
  const lots = new Map();
  for (const row of rows || []) {
    const lot = lotOf(row);
    let entry = lots.get(lot.id);
    if (!entry) {
      entry = {
        ...lot,
        pos: [],
        correct: 0,
        incorrect: 0,
        expected: 0,
        evaluated: 0,
      };
      lots.set(lot.id, entry);
    }
    entry.pos.push(row);
    if (row?.incorrect) entry.incorrect += 1;
    else entry.correct += 1;
  }

  const seen = new Set();
  for (const row of allRows || rows || []) {
    const entry = lots.get(lotOf(row).id);
    if (!entry) continue;
    const id = String(row?.id || '');
    if (id) {
      if (seen.has(id)) continue;
      seen.add(id);
    }
    if (!isExpectedMeltPo(row)) continue;
    entry.expected += 1;
    if (isEvaluatedPo(row)) entry.evaluated += 1;
  }

  return [...lots.values()].sort((a, b) => {
    const yearDelta = Number(b.year) - Number(a.year);
    if (yearDelta) return yearDelta;
    const monthDelta = monthIndex(b.month) - monthIndex(a.month);
    if (monthDelta) return monthDelta;
    return String(a.location || '').localeCompare(String(b.location || ''), undefined, { sensitivity: 'base' });
  });
}

const EMPTY_FINE = { gold: 0, silver: 0, platinum: 0, palladium: 0 };

function poMeltLines(row) {
  const lines = (Array.isArray(row?.pricedLines) ? row.pricedLines : []).filter(Boolean);
  if (lines.length) return lines;
  return [
    {
      name: (row?.itemNames || []).join(' '),
      searchText: String(row?.itemSearchText || ''),
    },
  ];
}

function addFineMetals(target, row) {
  for (const line of poMeltLines(row)) {
    const fine = fineMetalFromLine(line);
    if (!fine || !(fine.fineGrams > 0)) continue;
    target[fine.metal] = (target[fine.metal] || 0) + fine.fineGrams;
  }
}

export function formatFineWeight(grams) {
  if (!(grams > 0.0005)) return '—';
  if (grams >= 1000) return `${(grams / 1000).toFixed(2)} kg`;
  return `${grams.toFixed(grams >= 100 ? 0 : grams >= 10 ? 1 : 2)} g`;
}

export function formatFineProgress(completed, expected) {
  if (!(expected > 0.0005) && !(completed > 0.0005)) return '—';
  if (!(expected > 0.0005)) return formatFineWeight(completed);
  return `${formatFineWeight(completed)} / ${formatFineWeight(expected)}`;
}

/** Fine metal totals for a lot. Bullion-only POs are excluded. */
export function summarizeLotFineMetals(lot, allRows) {
  const expected = { ...EMPTY_FINE };
  const completed = { ...EMPTY_FINE };
  const id = lot?.id;
  if (!id) return { expected, completed };
  for (const row of allRows || lot?.pos || []) {
    if (lotOf(row).id !== id) continue;
    if (!isExpectedMeltPo(row)) continue;
    addFineMetals(expected, row);
    if (isEvaluatedPo(row)) addFineMetals(completed, row);
  }
  return { expected, completed };
}

export function summarizeLotsFineMetals(lots, allRows) {
  const expected = { ...EMPTY_FINE };
  const completed = { ...EMPTY_FINE };
  for (const lot of lots || []) {
    const part = summarizeLotFineMetals(lot, allRows);
    for (const key of Object.keys(EMPTY_FINE)) {
      expected[key] += part.expected[key] || 0;
      completed[key] += part.completed[key] || 0;
    }
  }
  return { expected, completed };
}

export const LOT_FINE_METALS = [
  { key: 'gold', label: 'AGW', name: 'All Gold Weight' },
  { key: 'silver', label: 'ASW', name: 'All Silver Weight' },
  { key: 'platinum', label: 'APW', name: 'All Platinum Weight' },
  { key: 'palladium', label: 'APalW', name: 'All Palladium Weight' },
];

export function lotMatchesQuery(lot, query) {
  const q = String(query || '')
    .trim()
    .toLowerCase();
  if (!q) return true;
  const hay = [
    lot?.id,
    lot?.location,
    lot?.locationToken,
    lot?.month,
    lot?.year,
    lotPeriodLabel(lot),
    ...(lot?.pos || []).flatMap((row) => [row.reference, row.storeName, row.customerName, row.employeeName]),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return hay.includes(q);
}
