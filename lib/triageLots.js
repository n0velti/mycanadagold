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

/** Group finished POs into lot folders. A missing folder is created on first PO. */
export function groupPosIntoLots(rows = []) {
  const lots = new Map();
  for (const row of rows || []) {
    const lot = row?.lot && row.lot.id ? row.lot : lotFromPo(row);
    let entry = lots.get(lot.id);
    if (!entry) {
      entry = {
        ...lot,
        pos: [],
        correct: 0,
        incorrect: 0,
      };
      lots.set(lot.id, entry);
    }
    entry.pos.push(row);
    if (row?.incorrect) entry.incorrect += 1;
    else entry.correct += 1;
  }
  return [...lots.values()].sort((a, b) => {
    const yearDelta = Number(b.year) - Number(a.year);
    if (yearDelta) return yearDelta;
    const monthDelta = monthIndex(b.month) - monthIndex(a.month);
    if (monthDelta) return monthDelta;
    return String(a.location || '').localeCompare(String(b.location || ''), undefined, { sensitivity: 'base' });
  });
}

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
