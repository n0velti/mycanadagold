import { ensureLinkedPosSessions } from './auth';
import { fetchPosLocations } from './locations';
import {
  fetchTransactionDetail,
  parseDocReference,
  posSourcesFromSession,
  rowFromDocument,
} from './transactions';

function addCandidate(list, seen, ref) {
  if (!ref || seen.has(ref.key)) return;
  seen.add(ref.key);
  list.push(ref);
}

/** SO/PO refs implied by a search box value. Bare digits try both kinds. */
export function documentQueryCandidates(value) {
  const text = String(value || '').trim();
  if (!text) return [];

  const seen = new Set();
  const candidates = [];
  addCandidate(candidates, seen, parseDocReference(text));

  const compact = text.replace(/\s+/g, '');
  const labeled = compact.match(/^(SO|PO)#?(\d{1,12})$/i);
  if (labeled) {
    addCandidate(candidates, seen, parseDocReference(`${labeled[1]}# ${labeled[2]}`));
    return candidates;
  }

  const digits = text.replace(/\D/g, '').replace(/^0+/, '');
  const stripped = text.replace(/[\s#.-]/g, '');
  const numeric = /^\d+$/.test(stripped);
  if (digits && digits.length >= 3 && digits.length <= 12 && numeric) {
    addCandidate(candidates, seen, parseDocReference(`SO# ${digits}`));
    addCandidate(candidates, seen, parseDocReference(`PO# ${digits}`));
  }
  return candidates;
}

async function rowWithStore(detail, type, source) {
  let row = rowFromDocument(detail, type, source);
  if (row.storeName && row.storeName !== '—') return row;
  const locations = await fetchPosLocations(source.baseUrl, source.token).catch(() => []);
  const locationId = row.locationId ?? detail?.location_id ?? detail?.location?.id;
  const hit = (locations || []).find((location) => String(location.id) === String(locationId));
  const name = String(hit?.name || '').trim();
  return name ? { ...row, storeName: name } : row;
}

/** Load matching PO/SO records from every signed-in POS. */
export async function lookupDocuments(session, query, { onHit } = {}) {
  const candidates = documentQueryCandidates(query);
  if (!candidates.length) return [];

  const authed = await ensureLinkedPosSessions(session);
  const sources = posSourcesFromSession(authed);
  if (!sources.length) throw new Error('Sign in again to look up a PO or SO.');

  const found = [];
  const seen = new Set();

  await Promise.all(
    candidates.flatMap((doc) =>
      sources.map(async (source) => {
        try {
          const detail = await fetchTransactionDetail(source.token, {
            type: doc.type,
            sourceId: doc.sourceId,
            baseUrl: source.baseUrl,
          });
          if (!detail || detail.id == null) return;
          const row = await rowWithStore(detail, doc.type, source);
          if (!row?.id || seen.has(row.id)) return;
          seen.add(row.id);
          found.push(row);
          onHit?.(row, found.slice());
        } catch {
          // This host does not have that ticket, or it timed out.
        }
      }),
    ),
  );

  return found.sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0));
}
