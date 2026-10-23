/**
 * Fact loaders: each source reduced to flat rows at its natural grain with
 * the shared keys `store`, `date` (Toronto YYYY-MM-DD), and where known
 * `employee`, `customer`, `docRef`. Nothing is summarised here; the metrics
 * registry (lib/semantics/metrics.js) says how rows become numbers and the
 * query engine joins them.
 *
 * Tickets are mapped from rows the caller already fetched (the Analytics
 * month cache); calls and hours are fetched here.
 */
import { fetchAureusEmployees } from '../aureusEmployees';
import { posSystemsFromSession } from '../auth';
import { QUEBEC_STORES } from '../cashTill';
import { isRetailStore } from '../employeeMetrics';
import {
  fetchPhoneHistory,
  fetchPhoneInbox,
  inboundCallsUnique,
  inboundOutcome,
  missedResolutionIndex,
  phoneHistoryNeeded,
  resolveMissedInbound,
} from '../phoneCalls';
import { fetchTimeEntriesBetween, personNameKeys } from '../ripplingTime';
import { canonicalStoreName, storesMatch } from '../storeCatalog';
import { HOME_STORES, formatDateParam, parseDateParam } from '../transactions';

export const PHONE_STORES = [...HOME_STORES, ...QUEBEC_STORES];

const TORONTO = 'America/Toronto';

/** Toronto calendar day for an instant. */
export function torontoDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return date.toLocaleDateString('en-CA', { timeZone: TORONTO, year: 'numeric', month: '2-digit', day: '2-digit' });
}

export function torontoHour(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const text = date.toLocaleTimeString('en-CA', { timeZone: TORONTO, hour: '2-digit', hour12: false });
  const hour = Number(text.slice(0, 2));
  return Number.isFinite(hour) ? hour : null;
}

export function canonicalStore(name) {
  const raw = String(name || '').trim();
  return canonicalStoreName(raw) || raw;
}

export function storeInList(name, stores) {
  if (!stores?.length) return true;
  return stores.some((wanted) => storesMatch(name, wanted));
}

/** POS transaction rows (lib/transactions.js) → ticket facts. */
export function ticketFactsFromRows(rows, { stores } = {}) {
  const facts = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || (row.type !== 'order' && row.type !== 'purchase')) continue;
    if (!isRetailStore(String(row.storeName || '').trim() || '—')) continue;
    const store = canonicalStore(row.storeName);
    if (!store || !storeInList(store, stores)) continue;
    facts.push({
      store,
      date: formatDateParam(row.date),
      employee: String(row.employeeName || '').trim() || '',
      customer: String(row.customerId ? `${row.systemKey || ''}:${row.customerId}` : row.customerName || '').trim(),
      docRef: row.reference || `${row.type === 'purchase' ? 'PO' : 'SO'}# ${row.sourceId}`,
      type: row.type === 'purchase' ? 'buy' : 'sell',
      amount: Number(row.amount) || 0,
    });
  }
  return facts;
}

function phoneStoresFor(stores) {
  if (!stores?.length) return PHONE_STORES;
  const picked = PHONE_STORES.filter((name) => stores.some((wanted) => storesMatch(name, wanted)));
  return picked.length ? picked : stores.map(canonicalStore);
}

/**
 * One row per unique inbound call in [startDate, endDate], per store. A
 * missed call is resolved against the whole fetched log so a callback the
 * next morning still counts as recovered.
 */
export async function loadCallFacts({ startDate, endDate, stores, onProgress } = {}) {
  const startKey = formatDateParam(startDate || new Date());
  const endKey = formatDateParam(endDate || startDate || new Date());
  const dateFrom = parseDateParam(startKey);
  const dateTo = parseDateParam(endKey);
  dateTo.setDate(dateTo.getDate() + 1);
  const needHistory = phoneHistoryNeeded(startKey, endKey);
  const wanted = phoneStoresFor(stores);
  onProgress?.(`Reading calls for ${wanted.length} ${wanted.length === 1 ? 'store' : 'stores'}…`);

  const facts = [];
  const errors = [];
  const failedStores = [];
  await Promise.all(
    wanted.map(async (store) => {
      try {
        const payload = needHistory ? await fetchPhoneHistory(store, { dateFrom, dateTo }) : await fetchPhoneInbox(store);
        const all = payload.calls || [];
        const index = missedResolutionIndex(all);
        for (const call of inboundCallsUnique(all)) {
          const at = call.startTime ? new Date(call.startTime) : null;
          if (!at || !Number.isFinite(at.getTime()) || at < dateFrom || at >= dateTo) continue;
          const outcome = inboundOutcome(call.result, call.duration);
          const firstAnswered = outcome === 'answered' ? 1 : 0;
          let recovered = 0;
          let recoveredBy = '';
          if (!firstAnswered) {
            const fix = resolveMissedInbound(call, all, index);
            if (fix) {
              recovered = 1;
              recoveredBy = fix.kind;
            }
          }
          facts.push({
            store: canonicalStore(store),
            date: torontoDate(at),
            hour: torontoHour(at),
            docRef: '',
            inbound: 1,
            firstAnswered,
            recovered,
            recoveredBy,
            answered: firstAnswered || recovered,
            stillMissed: firstAnswered || recovered ? 0 : 1,
            voicemail: outcome === 'voicemail' ? 1 : 0,
          });
        }
      } catch (error) {
        failedStores.push(canonicalStore(store));
        errors.push(`${store}: ${error?.message || 'phone log did not load'}`);
      }
    }),
  );
  const covered = wanted.map(canonicalStore).filter((store) => !failedStores.includes(store));
  return { rows: facts, errors, stores: wanted.map(canonicalStore), coveredStores: covered };
}

const directoryCache = { at: 0, promise: null };
const DIRECTORY_TTL_MS = 10 * 60_000;

/** Every POS user with their default store, cached for a few minutes. */
export async function loadStaffDirectory(session) {
  if (directoryCache.promise && Date.now() - directoryCache.at < DIRECTORY_TTL_MS) return directoryCache.promise;
  const systems = posSystemsFromSession(session).filter((system) => system.token);
  const promise = Promise.all(
    systems.map((system) => fetchAureusEmployees(system.token, system.baseUrl).catch(() => [])),
  ).then((batches) => {
    const rows = [];
    const seen = new Set();
    for (const batch of batches) {
      for (const row of Array.isArray(batch) ? batch : []) {
        const key = String(row.email || row.aureusLogin || row.id || '').toLowerCase();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        rows.push(row);
      }
    }
    return rows;
  });
  directoryCache.at = Date.now();
  directoryCache.promise = promise;
  promise.catch(() => {
    directoryCache.promise = null;
  });
  return promise;
}

/** name key → default store, from the POS directory. */
export function storeIndexFromDirectory(directory) {
  const map = new Map();
  for (const person of directory || []) {
    const store = canonicalStore(person?.locationName);
    if (!store) continue;
    for (const key of personNameKeys(person.fullName || person.name)) {
      if (key && !map.has(key)) map.set(key, store);
    }
  }
  return map;
}

export function storeForPerson(index, name) {
  for (const key of personNameKeys(name)) {
    const store = index.get(key);
    if (store) return store;
  }
  return '';
}

/**
 * One row per punch from the Rippling time report. Store comes from the
 * person's default store in the POS directory; people with no store on file
 * are kept with store '' so company-wide totals still include them.
 */
export async function loadHoursFacts(session, { startDate, endDate, stores, onProgress } = {}) {
  const startKey = formatDateParam(startDate || new Date());
  const endKey = formatDateParam(endDate || startDate || new Date());
  onProgress?.('Reading hours…');
  const [entries, directory] = await Promise.all([
    fetchTimeEntriesBetween(startKey, endKey),
    loadStaffDirectory(session).catch(() => []),
  ]);
  const index = storeIndexFromDirectory(directory);
  const facts = [];
  let unmatched = 0;
  for (const entry of entries || []) {
    if (!entry?.name) continue;
    const store = storeForPerson(index, entry.name);
    if (!store) unmatched += 1;
    if (stores?.length && !storeInList(store, stores)) continue;
    facts.push({
      store,
      date: entry.date,
      employee: entry.name,
      employeeId: entry.id || '',
      docRef: '',
      minutes: Number(entry.minutes) || 0,
      shifts: 1,
    });
  }
  return {
    rows: facts,
    errors: [],
    note: unmatched ? `${unmatched} punches belong to people with no default store in the POS directory.` : '',
  };
}
