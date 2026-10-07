/**
 * Shared store-level triage aggregations.
 *
 * Store-details Triage insights should import from here instead of
 * re-querying batches/reviews or recomputing correct/incorrect rolls.
 * Does not import transferWorkflow — that module hydrates the full triage cache.
 */
import { isBullionResaleLine, isScrapJewelleryLine } from './priceCheck';
import { canonicalStoreName } from './storeCatalog';
import { HOME_STORES } from './transactions';

export function reviewNeedsCorrection(review) {
  if (!review || typeof review !== 'object') return false;
  if (Array.isArray(review.corrections) && review.corrections.length > 0) return true;
  if (String(review.note || '').trim()) return true;
  if (String(review.errorType || '').trim()) return true;
  if (String(review.errorAmount || '').trim()) return true;
  if (Array.isArray(review.lineEdits) && review.lineEdits.length > 0) return true;
  return false;
}

export function poNeedsCorrection(po) {
  return reviewNeedsCorrection(po?.review);
}

export function poIsEvaluated(po) {
  if (!po) return false;
  if (po.received) return true;
  if (poNeedsCorrection(po)) return true;
  const editor = po?.review?.editedBy;
  return Boolean(editor && (editor.id || editor.name));
}

export function cleanInsightStoreName(value) {
  const raw = String(value || '').trim();
  if (!raw || raw === '—') return '';
  return raw.replace(/^canada\s*gold\s*/i, '').replace(/^cg\s+/i, '').trim() || raw;
}

function namedStore(value) {
  const cleaned = cleanInsightStoreName(value) || String(value || '').trim();
  if (!cleaned || cleaned === '—') return '';
  return canonicalStoreName(cleaned) || cleaned;
}

/**
 * Store that wrote the purchase. A later correction of the store field does
 * not move the error — the stamp, then the original store on the review, wins.
 */
export function errorAttributionStore(row, fallback = '') {
  const stamped = namedStore(row?.originStoreName || row?.review?.errorStore);
  if (stamped) return stamped;
  const header = (Array.isArray(row?.review?.draft?.header) ? row.review.draft.header : []).find(
    (entry) => entry?.key === 'store',
  );
  const original = namedStore(header?.original);
  if (original && reviewNeedsCorrection(row?.review)) return original;
  return namedStore(fallback || row?.storeName) || 'Unknown store';
}

export function insightStoresMatch(a, b) {
  const left = cleanInsightStoreName(a).toLowerCase();
  const right = cleanInsightStoreName(b).toLowerCase();
  if (!left || !right) return false;
  return left === right || left.includes(right) || right.includes(left);
}

function headerValue(review, key) {
  const field = (review?.draft?.header || []).find((entry) => entry.key === key);
  return String(field?.value ?? field?.original ?? '').trim();
}

function isUnspecifiedErrorType(label) {
  return /^(notes?\s+only|not\s+only)$/i.test(String(label || '').trim());
}

export function insightErrorType(review) {
  const type = String(review?.errorType || '').trim();
  if (type && !isUnspecifiedErrorType(type)) return type;
  const corrections = Array.isArray(review?.corrections) ? review.corrections : [];
  if (corrections.length) {
    const labels = corrections.map((item) => String(item?.label || '').toLowerCase());
    if (labels.some((label) => /\bqty\b|quantity/.test(label))) return 'Wrong quantity';
    if (labels.some((label) => /price|amount|unit/.test(label))) return 'Wrong price';
    if (labels.some((label) => /customer|client/.test(label))) return 'Wrong customer';
    if (labels.some((label) => /payment/.test(label))) return 'Wrong payment';
    if (labels.some((label) => /name|item/.test(label))) return 'Wrong item';
    const first = corrections[0].label || 'Unspecified';
    return isUnspecifiedErrorType(first) ? 'Unspecified' : first;
  }
  return 'Unspecified';
}

function lineSearch(line) {
  return [line?.name, line?.searchText, line?.quality, line?.productType, line?.metal]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join(' ');
}

function linesFromPo(row) {
  const priced = (Array.isArray(row?.pricedLines) ? row.pricedLines : []).filter(Boolean);
  if (priced.length) return priced;

  const draftItems = Array.isArray(row?.review?.draft?.items) ? row.review.draft.items : [];
  if (draftItems.length) {
    return draftItems.map((item) => {
      const name = String(item?.name?.value || item?.name?.original || item?.name || '').trim();
      return {
        name,
        searchText: name,
        productType: item?.productType || '',
        metal: item?.metal || '',
      };
    });
  }

  const names = Array.isArray(row?.itemNames) ? row.itemNames : [];
  if (names.length) {
    return names.map((name) => ({
      name,
      searchText: [name, row?.itemSearchText].filter(Boolean).join(' '),
      productType: '',
    }));
  }

  const fallback = String(row?.itemSearchText || '').trim();
  return fallback ? [{ name: fallback, searchText: fallback, productType: '' }] : [];
}

/** Infer scrap / jewellery / bullion from PO lines. Reviews do not store a product kind. */
export function productKindFromLine(line) {
  const type = String(line?.productType || '').toLowerCase();
  if (type === 'scrap') return 'Scrap';
  if (type === 'jewellery' || type === 'jewelry') return 'Jewellery';
  if (type === 'coin' || type === 'bar' || type === 'bullion' || type === 'numismatic') return 'Bullion';
  if (isBullionResaleLine(line)) return 'Bullion';
  if (isScrapJewelleryLine(line)) {
    return /\bjewel/.test(lineSearch(line)) ? 'Jewellery' : 'Scrap';
  }
  return lineSearch(line) ? 'Other' : 'Unspecified';
}

export function productKindsFromPo(row) {
  const kinds = [];
  const seen = new Set();
  for (const line of linesFromPo(row)) {
    const kind = productKindFromLine(line);
    const key = kind.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    kinds.push(kind);
  }
  return kinds.length ? kinds : ['Unspecified'];
}

const GENERIC_ITEM_LABEL = /^(scrap|other|unspecified|jewellery|jewelry|bullion)$/i;

function displayItemName(line) {
  const raw = String(line?.name || '').trim();
  if (raw && !GENERIC_ITEM_LABEL.test(raw)) return raw;
  const composed = [line?.quality, line?.metal]
    .map((value) => String(value || '').trim())
    .filter((value) => value && !GENERIC_ITEM_LABEL.test(value));
  if (composed.length) return composed.join(' ');
  const search = String(line?.searchText || '').trim();
  if (search && !GENERIC_ITEM_LABEL.test(search)) return search;
  return '';
}

/** Concrete PO line names (e.g. 10K gold standard), not scrap/other buckets. */
export function itemNamesFromPo(row) {
  const names = [];
  const seen = new Set();
  for (const line of linesFromPo(row)) {
    const label = displayItemName(line);
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(label);
  }
  return names;
}

function rankCounts(map) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], undefined, { sensitivity: 'base' }))
    .map(([label, count]) => ({ label, count }));
}

function sortInsightStores(rows) {
  return rows.slice().sort((a, b) => {
    const ai = HOME_STORES.findIndex(
      (store) => store.localeCompare(a.store, undefined, { sensitivity: 'base' }) === 0,
    );
    const bi = HOME_STORES.findIndex(
      (store) => store.localeCompare(b.store, undefined, { sensitivity: 'base' }) === 0,
    );
    if (ai >= 0 && bi >= 0) return ai - bi;
    if (ai >= 0) return -1;
    if (bi >= 0) return 1;
    return a.store.localeCompare(b.store, undefined, { sensitivity: 'base' });
  });
}

function emptyStoreEntry(store) {
  return {
    store,
    correct: 0,
    incorrect: 0,
    errorTypes: new Map(),
    products: new Map(),
    employeeErrors: new Map(),
  };
}

function bumpProduct(entry, kind, incorrect) {
  const current = entry.products.get(kind) || { correct: 0, incorrect: 0 };
  if (incorrect) current.incorrect += 1;
  else current.correct += 1;
  entry.products.set(kind, current);
}

export function summarizeTriageInsights(rows) {
  const byStore = new Map();
  for (const row of rows || []) {
    const store = cleanInsightStoreName(row.storeName) || 'Unknown store';
    const key = store.toLowerCase();
    const entry = byStore.get(key) || emptyStoreEntry(store);
    if (!byStore.has(key)) byStore.set(key, entry);

    const incorrect = Boolean(row.incorrect);
    for (const kind of productKindsFromPo(row)) bumpProduct(entry, kind, incorrect);

    if (incorrect) {
      entry.incorrect += 1;
      const type = insightErrorType(row.review);
      entry.errorTypes.set(type, (entry.errorTypes.get(type) || 0) + 1);
      const employee = String(row.employeeName || '').trim() || 'Unspecified';
      const person = entry.employeeErrors.get(employee) || {
        name: employee,
        incorrect: 0,
        types: new Map(),
      };
      person.incorrect += 1;
      person.types.set(type, (person.types.get(type) || 0) + 1);
      entry.employeeErrors.set(employee, person);
    } else {
      entry.correct += 1;
    }
  }

  const stores = sortInsightStores(
    [...byStore.values()].map((entry) => {
      const evaluated = entry.correct + entry.incorrect;
      return {
        store: entry.store,
        correct: entry.correct,
        incorrect: entry.incorrect,
        evaluated,
        accuracy: evaluated ? entry.correct / evaluated : 0,
        employees: [...entry.employeeErrors.values()]
          .map((person) => ({
            name: person.name,
            incorrect: person.incorrect,
            types: rankCounts(person.types),
          }))
          .sort(
            (a, b) =>
              b.incorrect - a.incorrect || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
          ),
        errorTypes: rankCounts(entry.errorTypes),
        products: [...entry.products.entries()]
          .map(([label, counts]) => ({
            label,
            correct: counts.correct,
            incorrect: counts.incorrect,
            evaluated: counts.correct + counts.incorrect,
          }))
          .sort(
            (a, b) =>
              b.incorrect - a.incorrect ||
              b.evaluated - a.evaluated ||
              a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }),
          ),
      };
    }),
  );

  const totals = stores.reduce(
    (acc, row) => {
      acc.correct += row.correct;
      acc.incorrect += row.incorrect;
      acc.evaluated += row.evaluated;
      return acc;
    },
    { correct: 0, incorrect: 0, evaluated: 0 },
  );
  totals.accuracy = totals.evaluated ? totals.correct / totals.evaluated : 0;

  return { stores, totals };
}

function flattenRemoteBatches(batches) {
  const rows = [];
  for (const batch of batches || []) {
    for (const store of Array.isArray(batch?.stores) ? batch.stores : []) {
      for (const item of store?.meltPos || []) {
        if (!item) continue;
        rows.push({
          ...item,
          storeName: item.storeName || store.name || store.storeName || '',
        });
      }
    }
  }
  return rows;
}

/**
 * Store insight roll-up from the shared triage workflow (local cache plus the
 * delta pull), so opening a store does not download every batch again.
 * Reviews are already applied to each PO there.
 */
export async function fetchTriageInsightSnapshot() {
  const { hydrateTransferWorkflow } = await import('./transferWorkflow');
  const snapshot = await hydrateTransferWorkflow();

  const evaluated = [];
  for (const po of flattenRemoteBatches(snapshot?.triage)) {
    if (!poIsEvaluated(po)) continue;
    const employee =
      String(po.employeeName || '').trim() || headerValue(po.review, 'employee') || '';
    const storeName =
      cleanInsightStoreName(po.storeName) ||
      cleanInsightStoreName(headerValue(po.review, 'store')) ||
      '';
    evaluated.push({
      id: po.id,
      storeName,
      employeeName: employee,
      review: po.review,
      pricedLines: po.pricedLines,
      itemNames: po.itemNames,
      itemSearchText: po.itemSearchText,
      incorrect: poNeedsCorrection(po),
    });
  }

  return summarizeTriageInsights(evaluated);
}

export function insightForStore(snapshot, storeName) {
  return (snapshot?.stores || []).find((row) => insightStoresMatch(row.store, storeName)) || null;
}

export function filterInsightStores(snapshot, { storeName = '', allowAllStores = true } = {}) {
  const stores = snapshot?.stores || [];
  if (allowAllStores || !String(storeName || '').trim()) return stores;
  return stores.filter((row) => insightStoresMatch(row.store, storeName));
}

export function formatInsightPercent(rate, evaluated) {
  if (evaluated != null && !Number(evaluated)) return '—';
  const n = Number(rate);
  if (!Number.isFinite(n) || n < 0) return '—';
  return `${Math.round(n * 100)}%`;
}

export function formatInsightCount(count, singular, plural = `${singular}s`) {
  const n = Number(count) || 0;
  return `${n} ${n === 1 ? singular : plural}`;
}
