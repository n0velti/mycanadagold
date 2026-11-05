/**
 * Load a purchase (total and line weights) from every signed-in POS by PO number.
 */
import { ensureLinkedPosSessions } from './auth';
import { fetchPosLocations } from './locations';
import {
  fetchTransactionDetail,
  posSourcesFromSession,
  purchaseBuyerName,
  rowFromDocument,
  withLineItems,
} from './transactions';

/** Digits of a PO id. Accepts "PO# 184920", "184920", or a bare number. */
export function normalizePoNumber(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  const labeled = text.match(/(?:p\.?\s*o\.?|purchase)\s*#?\s*(\d{1,12})/i);
  const digits = (labeled ? labeled[1] : text).replace(/\D/g, '').replace(/^0+/, '');
  if (!digits || digits.length > 12) return '';
  return digits;
}

async function purchaseRowFromSource(detail, source, locations = []) {
  const row = withLineItems(rowFromDocument(detail, 'purchase', source), detail);
  const locationId = row.locationId ?? detail?.location_id ?? detail?.location?.id;
  const hit = (locations || []).find((location) => String(location.id) === String(locationId));
  const name = String(hit?.name || row.storeName || '').trim();
  const buyer = purchaseBuyerName(detail) || purchaseBuyerName(row);
  const next = name && name !== '—' ? { ...row, storeName: name } : row;
  if (!buyer) return next;
  return {
    ...next,
    created_by: buyer,
    createdBy: buyer,
    employeeName: next.employeeName && next.employeeName !== '—' ? next.employeeName : buyer,
    latest_editor_name: next.latest_editor_name || detail?.latest_editor_name || buyer,
  };
}

/** Purchases whose id matches, one per POS system that has it. */
export async function lookupPurchasesByPoNumber(session, poNumber, { onHit } = {}) {
  const id = normalizePoNumber(poNumber);
  if (!id) throw new Error('Enter a PO number.');

  const authed = await ensureLinkedPosSessions(session);
  const sources = posSourcesFromSession(authed);
  if (!sources.length) throw new Error('Sign in again to look up a PO.');

  const found = [];
  await Promise.all(
    sources.map(async (source) => {
      try {
        const locationsPromise = fetchPosLocations(source.baseUrl, source.token).catch(() => []);
        const detail = await fetchTransactionDetail(source.token, {
          type: 'purchase',
          sourceId: id,
          baseUrl: source.baseUrl,
        });
        if (!detail || detail.id == null) return;
        const locations = await locationsPromise;
        const row = await purchaseRowFromSource(detail, source, locations);
        found.push(row);
        onHit?.(row, found.slice());
      } catch {
        // This host does not have that PO, or it timed out.
      }
    }),
  );

  return found;
}
