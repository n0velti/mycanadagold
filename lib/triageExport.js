import { HOME_PINNED_STORES, canonicalStoreName } from './storeCatalog';
import { formatPaymentMethodLabel, formatTransactionDate, formatTransactionTime } from './transactions';
import { destinationLabel, formatGrams } from './triageAllocations';
import { itemNamesFromPo } from './triageInsights';
import { lotPeriodLabel } from './triageLots';
import { errorEmployeeName, errorTypeOf } from './triageStoreErrors';
import {
  collectAllTriagePos,
  isTriagePoEvaluated,
  triagePoNeedsCorrection,
} from './transferWorkflow';
import { buildXlsx, safeFileName } from './xlsx';

const PO_COLUMNS = [
  { key: 'store', label: 'Store' },
  { key: 'date', label: 'Date' },
  { key: 'time', label: 'Time' },
  { key: 'reference', label: 'Reference' },
  { key: 'type', label: 'Type' },
  { key: 'customer', label: 'Customer' },
  { key: 'employee', label: 'Employee' },
  { key: 'amount', label: 'Amount', format: 'money' },
  { key: 'payment', label: 'Payment' },
  { key: 'items', label: 'Items' },
  { key: 'lot', label: 'Lot' },
  { key: 'status', label: 'Status' },
  { key: 'received', label: 'Received' },
  { key: 'evaluated', label: 'Evaluated' },
  { key: 'error', label: 'Error' },
  { key: 'errorType', label: 'Error type' },
  { key: 'errorAmount', label: 'Error amount', format: 'money' },
  { key: 'notes', label: 'Notes' },
  { key: 'corrections', label: 'Corrections' },
  { key: 'allocation', label: 'Allocation' },
  { key: 'reviewedBy', label: 'Reviewed by' },
  { key: 'reviewedAt', label: 'Reviewed at' },
  { key: 'batchDate', label: 'Batch date' },
  { key: 'triageLocation', label: 'Triage location' },
  { key: 'system', label: 'POS' },
  { key: 'bullionOnly', label: 'Bullion only' },
];

const DELETED_COLUMNS = [
  { key: 'store', label: 'Store' },
  { key: 'reference', label: 'Reference' },
  { key: 'kind', label: 'Kind' },
  { key: 'customer', label: 'Customer' },
  { key: 'employee', label: 'Employee' },
  { key: 'amount', label: 'Amount', format: 'money' },
  { key: 'deletedAt', label: 'Deleted at' },
  { key: 'deletedBy', label: 'Deleted by' },
];

function storeNameOf(row) {
  const name = canonicalStoreName(row?.storeName) || String(row?.storeName || '').trim();
  return name && name !== '—' ? name : 'Unknown store';
}

function sortStoreNames(names) {
  return [...names].sort((a, b) => {
    const ai = HOME_PINNED_STORES.findIndex((store) => store.toLowerCase() === a.toLowerCase());
    const bi = HOME_PINNED_STORES.findIndex((store) => store.toLowerCase() === b.toLowerCase());
    if (ai >= 0 && bi >= 0) return ai - bi;
    if (ai >= 0) return -1;
    if (bi >= 0) return 1;
    return a.localeCompare(b, undefined, { sensitivity: 'base' });
  });
}

function money(value) {
  if (value == null || value === '') return '';
  const n = Number(String(value).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : '';
}

function yesNo(value) {
  return value ? 'Yes' : 'No';
}

function statusOf(row) {
  if (triagePoNeedsCorrection(row)) return 'Error';
  if (row?.received) return 'Received';
  if (isTriagePoEvaluated(row) || row?.evaluated) return 'Evaluated';
  return 'Waiting';
}

function typeOf(row) {
  if (row?.type === 'order' || /^so#/i.test(String(row?.reference || ''))) return 'SO';
  return 'PO';
}

function formatIso(value) {
  const time = Date.parse(value || '');
  if (!Number.isFinite(time)) return String(value || '').trim();
  return new Date(time).toLocaleString('en-CA', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatCorrections(row) {
  const corrections = Array.isArray(row?.review?.corrections) ? row.review.corrections : [];
  return corrections
    .map((item) => {
      const label = String(item?.label || '').trim();
      const original = String(item?.original ?? '').trim();
      const next = String(item?.value ?? '').trim();
      if (!label) return '';
      if (original && next && original !== next) return `${label}: ${original} → ${next}`;
      return label;
    })
    .filter(Boolean)
    .join('; ');
}

function formatAllocation(row) {
  const totals = row?.allocation?.totals;
  if (!totals || typeof totals !== 'object') return '';
  return Object.values(totals)
    .filter((entry) => Number(entry?.objectGrams) > 0 || Number(entry?.fineGrams) > 0)
    .map((entry) => {
      const label = entry.label || destinationLabel(entry.destination);
      const fine = Number(entry.fineGrams) > 0 ? `${formatGrams(entry.fineGrams)} g fine` : '';
      const object = Number(entry.objectGrams) > 0 ? `${formatGrams(entry.objectGrams)} g` : '';
      return [label, fine || object].filter(Boolean).join(' ');
    })
    .join('; ');
}

function dateText(value) {
  if (value == null || value === '') return '';
  return String(value);
}

function poRow(row) {
  const review = row?.review || {};
  const errorAmount = money(review.errorAmount);
  const date = dateText(row?.date);
  return {
    store: storeNameOf(row),
    date: (date ? formatTransactionDate(date) : '') || row?.dateLabel || '',
    time: date ? formatTransactionTime(date) : '',
    reference: String(row?.reference || '').trim(),
    type: typeOf(row),
    customer: String(row?.customerName || '').trim(),
    employee: errorEmployeeName(row),
    amount: money(row?.amount),
    payment: formatPaymentMethodLabel(row?.paymentMethods) || String(row?.paymentMethods || '').trim(),
    items: itemNamesFromPo(row).join('; '),
    lot: lotPeriodLabel(row?.lot) || String(row?.lotId || '').trim(),
    status: statusOf(row),
    received: yesNo(row?.received),
    evaluated: yesNo(isTriagePoEvaluated(row) || row?.evaluated),
    error: yesNo(triagePoNeedsCorrection(row)),
    errorType: triagePoNeedsCorrection(row) ? errorTypeOf(row) : '',
    errorAmount: errorAmount === '' ? '' : errorAmount,
    notes: String(review.note || '').trim(),
    corrections: formatCorrections(row),
    allocation: formatAllocation(row),
    reviewedBy: String(review.editedBy?.name || '').trim(),
    reviewedAt: formatIso(review.editedAt),
    batchDate: String(row?.triageDateLabel || row?.triageDateKey || '').trim(),
    triageLocation: String(row?.triageLocationName || '').trim(),
    system: String(row?.systemLabel || row?.systemKey || '').trim(),
    bullionOnly: yesNo(row?.bullionOnly),
  };
}

function deletedRow(entry) {
  const item = entry?.item || null;
  const payload = entry?.payload || null;
  const firstStore = payload?.stores?.[0];
  const firstPo = firstStore?.meltPos?.[0];
  const source = item || firstPo || {};
  return {
    store: canonicalStoreName(entry?.storeName || source.storeName || firstStore?.name) || entry?.storeName || '',
    reference: String(source.reference || payload?.dateLabel || entry?.sourceId || '').trim(),
    kind: entry?.kind === 'doc' ? 'Document' : entry?.kind === 'po' ? 'PO' : 'Batch',
    customer: String(source.customerName || '').trim(),
    employee: source.id ? errorEmployeeName(source) : '',
    amount: money(source.amount),
    deletedAt: formatIso(entry?.deletedAt),
    deletedBy: String(entry?.deletedBy || '').trim(),
  };
}

function sheet(name, columns, rows) {
  return { name, columns, rows };
}

export function buildTriageExportWorkbook(triage, deleted = []) {
  const pos = collectAllTriagePos(triage).map(poRow);
  const byStore = new Map();
  for (const row of pos) {
    const store = row.store || 'Unknown store';
    if (!byStore.has(store)) byStore.set(store, []);
    byStore.get(store).push(row);
  }
  const sheets = [sheet('All stores', PO_COLUMNS, pos)];
  for (const store of sortStoreNames(byStore.keys())) {
    sheets.push(sheet(store, PO_COLUMNS, byStore.get(store) || []));
  }
  const deletedRows = (Array.isArray(deleted) ? deleted : []).map(deletedRow).filter((row) => row.reference || row.store);
  if (deletedRows.length) sheets.push(sheet('Deleted', DELETED_COLUMNS, deletedRows));
  return buildXlsx({ title: 'Triage export', sheets });
}

export function triageExportFilename(when = new Date()) {
  const stamp = `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, '0')}-${String(when.getDate()).padStart(2, '0')}`;
  return safeFileName(`triage-export-${stamp}`);
}
