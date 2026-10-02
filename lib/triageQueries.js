/**
 * Item-level triage reads for Store Details and the BM Triage app.
 * Store rolls (correct/incorrect, employee/error/product counts) live in
 * `lib/triageInsights.js` — import those instead of recomputing them here.
 */
import {
  cleanInsightStoreName,
  fetchTriageInsightSnapshot,
  insightErrorType,
  insightForStore,
  insightStoresMatch,
  poIsEvaluated,
  poNeedsCorrection,
  productKindsFromPo,
  reviewNeedsCorrection,
} from './triageInsights';
import { getSupabase } from './supabase';
import { formatDateParam } from './transactions';

function asString(value) {
  if (value == null) return '';
  return String(value).trim();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

export {
  cleanInsightStoreName,
  fetchTriageInsightSnapshot,
  insightErrorType,
  insightForStore,
  insightStoresMatch,
  poIsEvaluated,
  poNeedsCorrection,
  productKindsFromPo,
  reviewNeedsCorrection,
};

export function reviewFromRow(row) {
  if (!row) return null;
  if (row.review && typeof row.review === 'object') return row.review;
  if (row.payload?.review && typeof row.payload.review === 'object') return row.payload.review;
  return null;
}

export function reviewHeaderValue(review, key) {
  const wanted = asString(key);
  if (!wanted) return '';
  const field = asArray(review?.draft?.header).find((entry) => asString(entry?.key) === wanted);
  return asString(field?.value ?? field?.original);
}

export function reviewDateKey(review, fallback) {
  const raw = reviewHeaderValue(review, 'date') || review?.dateLabel || review?.date || fallback;
  const text = asString(raw);
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const parsed = Date.parse(text);
  if (!Number.isNaN(parsed)) return formatDateParam(new Date(parsed));
  const fallbackText = asString(fallback);
  const fallbackIso = fallbackText.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (fallbackIso) return `${fallbackIso[1]}-${fallbackIso[2]}-${fallbackIso[3]}`;
  const fallbackParsed = Date.parse(fallbackText);
  if (!Number.isNaN(fallbackParsed)) return formatDateParam(new Date(fallbackParsed));
  return '';
}

export function reviewStoreName(review, row) {
  return (
    cleanInsightStoreName(reviewHeaderValue(review, 'store')) ||
    cleanInsightStoreName(review?.storeName) ||
    cleanInsightStoreName(row?.storeName) ||
    cleanInsightStoreName(row?.store_name)
  );
}

export function reviewEmployeeName(review, row) {
  return (
    reviewHeaderValue(review, 'employee') ||
    asString(review?.employeeName) ||
    asString(row?.employeeName)
  );
}

export function reviewProductNames(review, row) {
  const fromDraft = asArray(review?.draft?.items)
    .map((item) => asString(item?.name?.value ?? item?.name?.original ?? item?.name))
    .filter(Boolean);
  if (fromDraft.length) return fromDraft;
  const fromEdits = asArray(review?.lineEdits)
    .map((line) => asString(line?.name))
    .filter(Boolean);
  if (fromEdits.length) return fromEdits;
  const fromRow = asArray(row?.itemNames || review?.itemNames).map(asString).filter(Boolean);
  if (fromRow.length) return fromRow;
  const search = asString(row?.itemSearchText || review?.itemSearchText);
  return search ? [search] : [];
}

export function reviewReference(review, row) {
  return (
    reviewHeaderValue(review, 'reference') ||
    asString(review?.reference) ||
    asString(row?.reference) ||
    asString(row?.id)
  );
}

export function reviewDocKind(review, row) {
  const explicit = asString(review?.docKind || row?.docKind || row?.type || review?.type).toLowerCase();
  if (/sale|sell|\bso\b/.test(explicit)) return 'sale';
  if (/purchase|buy|\bpo\b/.test(explicit)) return 'purchase';
  const ref = reviewReference(review, row);
  if (/^so\b|^s\.?o\.?\b|sales?\s*order/i.test(ref)) return 'sale';
  return 'purchase';
}

export function reviewDetailSummary(review) {
  const note = asString(review?.note);
  const amount = asString(review?.errorAmount);
  const edits = asArray(review?.lineEdits)
    .map((line) => {
      const name = asString(line?.name) || 'Line';
      const was = asString(line?.originalAmount) || '—';
      const now = asString(line?.amount) || '—';
      return `${name}: ${was} → ${now}`;
    })
    .filter(Boolean);
  return [note, amount ? `Set amount ${amount}` : '', ...edits].filter(Boolean).join(' · ');
}

function isMissingRelation(error, relation) {
  const code = asString(error?.code);
  const message = asString(error?.message);
  if (code === '42P01' || code === 'PGRST205') return true;
  if (code === '42703') return true;
  return /schema cache/i.test(message) && new RegExp(relation || 'triage_|staff_notifications', 'i').test(message);
}

export function mapTriageErrorItem(row) {
  const review = reviewFromRow(row);
  if (!review) return null;
  const po = { ...row, review, storeName: reviewStoreName(review, row) };
  const products = reviewProductNames(review, po);
  const kinds = productKindsFromPo(po);
  return {
    id: asString(row?.id),
    reference: reviewReference(review, po),
    storeName: po.storeName,
    employeeName: reviewEmployeeName(review, po),
    customerName: reviewHeaderValue(review, 'customer') || asString(review?.customerName),
    dateKey: reviewDateKey(review, row?.updated_at || row?.updatedAt),
    dateLabel: reviewHeaderValue(review, 'date') || asString(review?.dateLabel),
    errorType: insightErrorType(review),
    errorAmount: asString(review?.errorAmount),
    note: asString(review?.note),
    detail: reviewDetailSummary(review),
    products,
    productLabel: products.join(', ') || kinds.filter((kind) => kind !== 'Unspecified').join(', ') || '—',
    productKinds: kinds,
    docKind: reviewDocKind(review, po),
    incorrect: poNeedsCorrection(po),
    evaluated: poIsEvaluated(po),
    updatedAt: asString(row?.updated_at || row?.updatedAt),
    review,
  };
}

export async function listTriageReviewRows() {
  try {
    const supabase = getSupabase();
    const full = await supabase
      .from('triage_reviews')
      .select('id, payload, store_name, store_key, is_incorrect, updated_at')
      .order('updated_at', { ascending: false });
    if (!full.error) return asArray(full.data);
    if (!isMissingRelation(full.error, 'triage_reviews')) throw full.error;
    const legacy = await supabase.from('triage_reviews').select('id, payload, updated_at');
    if (legacy.error) {
      if (isMissingRelation(legacy.error, 'triage_reviews')) return [];
      throw legacy.error;
    }
    return asArray(legacy.data);
  } catch (error) {
    if (isMissingRelation(error, 'triage_reviews')) return [];
    throw error;
  }
}

/** Incorrect reviews for one store. Does not compute store-level insight rolls. */
export async function listStoreTriageErrors(storeName, { incorrectOnly = true, startKey = '', endKey = '' } = {}) {
  const lock = asString(storeName);
  const rows = await listTriageReviewRows();
  return rows
    .map(mapTriageErrorItem)
    .filter(Boolean)
    .filter((row) => {
      if (incorrectOnly && !row.incorrect) return false;
      if (lock && !insightStoresMatch(row.storeName, lock)) return false;
      if (startKey && row.dateKey && row.dateKey < startKey) return false;
      if (endKey && row.dateKey && row.dateKey > endKey) return false;
      return true;
    });
}

/** Snapshot rollup when the caller can read batches; otherwise insight is null. */
export async function loadStoreTriageView(storeName, options = {}) {
  const items = await listStoreTriageErrors(storeName, options);
  let insight = null;
  try {
    insight = insightForStore(await fetchTriageInsightSnapshot(), storeName);
  } catch {
    insight = null;
  }
  return { insight, items };
}
