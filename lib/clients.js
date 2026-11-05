/**
 * Aureus client directory (`GET /clients`) for East, GTA, and PMX.
 * One row per customer: name, type, sex (POS first, then first-name inference),
 * date of birth, age, and home address. Government ID numbers stay off
 * these rows.
 */
import { authHeaders, posFetch } from './auth';
import { sexFromClient } from './nameGender';
import { canonicalStoreName, storesMatch } from './storeCatalog';
import {
  fetchTransactionsAcrossPos,
  formatDateParam,
  isExcludedCustomerName,
  posSourcesFromSession,
} from './transactions';

const PAGE_SIZE = 200;
const PAGE_CONCURRENCY = 6;
const MAX_CLIENT_PAGES = 2000;
const CACHE_MS = 30 * 60 * 1000;
const TORONTO = 'America/Toronto';

const cache = new Map();

function asString(value) {
  return value == null ? '' : String(value).trim();
}

function fold(value) {
  return asString(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/^-+/, '')
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function titleCase(value) {
  const text = asString(value).replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
  if (!text) return '';
  return text.replace(/\b[a-zA-ZÀ-ÿ]/g, (char) => char.toUpperCase());
}

function clientEmail(client) {
  if (client?.is_fake_email) return '';
  const email = asString(client?.email);
  if (!email) return '';
  if (/@aureus\.com$/i.test(email)) return '';
  return email;
}

function pickAddress(client) {
  const addresses = Array.isArray(client?.addresses) ? client.addresses : [];
  return (
    addresses.find((row) => row?.default_for_billing) ||
    addresses.find((row) => row?.default_for_shipping) ||
    addresses[0] ||
    null
  );
}

function validDob(value) {
  const text = asString(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return '';
  if (text.startsWith('0000')) return '';
  const year = Number(text.slice(0, 4));
  if (year < 1900 || year > 2020) return '';
  return text;
}

function ageFromDob(dob, today) {
  if (!dob) return null;
  const born = new Date(`${dob}T12:00:00`);
  const now = new Date(`${today}T12:00:00`);
  if (!Number.isFinite(born.getTime()) || !Number.isFinite(now.getTime())) return null;
  let age = now.getFullYear() - born.getFullYear();
  const month = now.getMonth() - born.getMonth();
  if (month < 0 || (month === 0 && now.getDate() < born.getDate())) age -= 1;
  if (age < 0 || age > 120) return null;
  return age;
}

export function ageGroupFromAge(age) {
  if (age == null) return 'Unknown';
  if (age < 25) return 'Under 25';
  if (age < 35) return '25–34';
  if (age < 45) return '35–44';
  if (age < 55) return '45–54';
  if (age < 65) return '55–64';
  return '65+';
}

function todayToronto() {
  return new Date().toLocaleDateString('en-CA', { timeZone: TORONTO, year: 'numeric', month: '2-digit', day: '2-digit' });
}

function clientName(client) {
  const name = [client?.first_name, client?.last_name].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  return name || asString(client?.nickname) || asString(client?.business_name) || '';
}

function clientType(client) {
  const raw = asString(client?.client_type || client?.business_type).toLowerCase();
  if (raw === 'company') return 'Company';
  return 'Person';
}

export function cityMatchesPlace(city, wanted) {
  const have = fold(city);
  const needle = fold(wanted);
  if (!have || !needle) return false;
  if (have === needle || have.includes(needle) || needle.includes(have)) return true;
  const store = canonicalStoreName(wanted);
  if (store && (have === fold(store) || have.includes(fold(store)))) return true;
  return false;
}

export function normalizeClient(client, source, { today } = {}) {
  const day = today || todayToronto();
  const address = pickAddress(client);
  const city = titleCase(address?.city);
  const province = asString(address?.state).toUpperCase();
  const postal = asString(address?.zip).toUpperCase().replace(/\s+/g, ' ');
  const name = clientName(client);
  const type = clientType(client);
  const sexInfo = type === 'Company' ? { sex: '', source: '' } : sexFromClient(client);
  const dob = validDob(client?.dob);
  const age = ageFromDob(dob, day);
  const systemKey = source?.key || '';
  const id = client?.id;
  return {
    id,
    customer: id != null ? `${systemKey}:${id}` : name,
    name,
    firstName: asString(client?.first_name),
    lastName: asString(client?.last_name),
    type,
    status: titleCase(client?.status) || 'Active',
    sex: sexInfo.sex,
    sexSource: sexInfo.source,
    dob,
    age,
    ageGroup: ageGroupFromAge(age),
    city,
    province,
    postal,
    country: asString(address?.country_iso2 || address?.country) || 'CA',
    street: asString(address?.address_1),
    email: clientEmail(client),
    phone: asString(client?.phone || client?.alternate_phone),
    pos: source?.label || systemKey,
    posKey: systemKey,
    store: '',
    clientId: id != null ? String(id) : '',
  };
}

/** A named Canada Gold store is the branch, never "people who live in that city". */
export function resolveCustomerScope({ stores, city } = {}) {
  const asked = (Array.isArray(stores) ? stores : stores ? [stores] : [])
    .map((item) => asString(item))
    .filter(Boolean);
  const cityName = asString(city);
  const cityAsStore = cityName ? canonicalStoreName(cityName) : '';
  if (cityAsStore && !asked.length) asked.push(cityAsStore);
  return {
    stores: asked.map((name) => canonicalStoreName(name) || name),
    city: cityAsStore ? '' : cityName,
  };
}

function lastThirtyDays() {
  const end = todayToronto();
  const date = new Date(`${end}T12:00:00`);
  date.setDate(date.getDate() - 29);
  return { startDate: formatDateParam(date), endDate: end, assumed: true };
}

function ticketCustomerKey(tx) {
  const id = asString(tx?.customerId);
  const system = asString(tx?.systemKey);
  if (id && system) return `${system}:${id}`;
  const name = fold(tx?.customerName);
  if (!name || isExcludedCustomerName(tx?.customerName)) return '';
  return `name:${name}`;
}

function directoryCustomerKey(row) {
  if (row?.clientId && row?.posKey) return `${row.posKey}:${row.clientId}`;
  const name = fold(row?.name);
  return name ? `name:${name}` : '';
}

function paginationMeta(payload) {
  const meta = payload?.meta?.pagination || payload?.meta || payload?.pagination || {};
  const last =
    Number(meta.last_page ?? meta.total_pages ?? payload?.last_page ?? payload?.total_pages) || null;
  const total = Number(meta.total ?? payload?.total) || null;
  const perPage = Number(meta.per_page ?? meta.items_per_page ?? payload?.per_page) || PAGE_SIZE;
  return { last, total, perPage };
}

async function fetchClientsPage(source, page, perPage) {
  const params = new URLSearchParams({
    page: String(page),
    items_per_page: String(perPage),
  });
  params.set('sort[field]', 'name');
  params.set('sort[dir]', 'asc');
  const response = await posFetch(`${source.baseUrl}/clients?${params}`, {
    method: 'GET',
    headers: authHeaders(source.token),
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const message = payload?.error?.message || payload?.message || `Clients page ${page} failed (${response.status}).`;
    throw new Error(message);
  }
  const batch = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload) ? payload : [];
  return { batch, ...paginationMeta(payload) };
}

async function mapPool(items, limit, mapper) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      out[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return out;
}

function cacheKey(source) {
  return `${source.key}:${String(source.token || '').slice(-12)}`;
}

function collectClients(batches, today, source) {
  const rows = [];
  const seen = new Set();
  for (const batch of batches) {
    for (const client of batch || []) {
      const id = client?.id;
      const dedupe = id != null ? String(id) : '';
      if (dedupe) {
        if (seen.has(dedupe)) continue;
        seen.add(dedupe);
      }
      const name = clientName(client);
      if (!name || isExcludedCustomerName(name)) continue;
      rows.push(normalizeClient(client, source, { today }));
    }
  }
  return { rows, seen };
}

async function fetchSourceDirectory(source, onProgress) {
  const key = cacheKey(source);
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit;

  onProgress?.(`Loading ${source.label} customers…`);
  let first;
  let perPage = PAGE_SIZE;
  try {
    first = await fetchClientsPage(source, 1, PAGE_SIZE);
  } catch {
    perPage = 100;
    first = await fetchClientsPage(source, 1, 100);
  }
  perPage = first.batch.length && first.batch.length < perPage ? first.batch.length : first.perPage || perPage;
  const expected = first.total || 0;
  const last = Math.min(
    MAX_CLIENT_PAGES,
    expected && perPage ? Math.ceil(expected / perPage) : first.last || 1,
  );
  const pages = [first.batch];
  if (last > 1) {
    const rest = Array.from({ length: last - 1 }, (_, index) => index + 2);
    const batches = await mapPool(rest, PAGE_CONCURRENCY, async (page, index) => {
      if (index % 10 === 0) onProgress?.(`Loading ${source.label} customers (${page} of ${last})…`);
      const result = await fetchClientsPage(source, page, perPage);
      return result.batch;
    });
    pages.push(...batches);
  }

  let page = last;
  while (page < MAX_CLIENT_PAGES) {
    const unique = pages.reduce((count, batch) => count + (batch?.length || 0), 0);
    if (expected && unique >= expected) break;
    if (!pages[pages.length - 1]?.length) break;
    page += 1;
    onProgress?.(`Loading ${source.label} customers (page ${page})…`);
    const extra = await fetchClientsPage(source, page, perPage);
    if (!extra.batch.length) break;
    pages.push(extra.batch);
    if (expected && extra.batch.length && unique + extra.batch.length >= expected) break;
  }

  const today = todayToronto();
  const { rows } = collectClients(pages, today, source);
  const fetched = pages.reduce((count, batch) => count + (batch?.length || 0), 0);
  const value = {
    rows,
    total: expected || rows.length,
    expires: Date.now() + CACHE_MS,
    label: source.label,
    complete: !expected || fetched >= expected,
  };
  cache.set(key, value);
  return value;
}

export function clientMatchesStores(row, stores) {
  if (!stores?.length) return true;
  return stores.some((wanted) => {
    const name = asString(wanted);
    if (!name) return false;
    if (row.store && (storesMatch(row.store, name) || fold(row.store) === fold(name))) return true;
    return false;
  });
}

async function loadStoreTickets(session, { stores, startDate, endDate, onProgress, loadTickets }) {
  const range = startDate && endDate ? { startDate, endDate, assumed: false } : lastThirtyDays();
  onProgress?.(`Loading ${stores.join(', ')} tickets ${range.startDate} – ${range.endDate}…`);
  let rows = [];
  let warning = '';
  try {
    if (typeof loadTickets === 'function') {
      rows = (await loadTickets(range.startDate, range.endDate)) || [];
    } else {
      const result = await fetchTransactionsAcrossPos(session, {
        startDate: range.startDate,
        endDate: range.endDate,
      });
      rows = result.rows || [];
      warning = result.warning || '';
    }
  } catch (error) {
    throw new Error(error?.message || 'Store tickets did not load.');
  }
  const atStore = rows.filter((tx) => stores.some((wanted) => storesMatch(tx.storeName, wanted)));
  return { tickets: atStore, ...range, warning };
}

function customersFromTickets(tickets, directory) {
  const byKey = new Map();
  for (const row of directory || []) {
    const key = directoryCustomerKey(row);
    if (key) byKey.set(key, row);
  }
  const seen = new Map();
  for (const tx of tickets || []) {
    const key = ticketCustomerKey(tx);
    if (!key) continue;
    const store = canonicalStoreName(tx.storeName) || asString(tx.storeName);
    const day = asString(tx.date).slice(0, 10);
    const hit = seen.get(key);
    if (hit) {
      hit.visits += 1;
      if (day && day > hit.lastVisit) {
        hit.lastVisit = day;
        hit.store = store || hit.store;
      }
      continue;
    }
    const book = byKey.get(key);
    seen.set(key, {
      ...(book || {
        customer: key,
        name: asString(tx.customerName),
        firstName: '',
        lastName: '',
        type: 'Person',
        status: 'Active',
        sex: '',
        sexSource: '',
        dob: '',
        age: null,
        ageGroup: 'Unknown',
        city: asString(tx.customerCity),
        province: '',
        postal: asString(tx.customerPostal),
        country: 'CA',
        street: '',
        email: asString(tx.customerEmail),
        phone: '',
        pos: asString(tx.systemLabel),
        posKey: asString(tx.systemKey),
        clientId: asString(tx.customerId),
      }),
      store,
      visits: 1,
      lastVisit: day,
    });
  }
  return [...seen.values()];
}

export function filterClients(rows, { stores, city, province, sex, search, type } = {}) {
  const cityNeedle = asString(city);
  const provinceNeedle = fold(province);
  const sexNeedle = fold(sex);
  const typeNeedle = fold(type);
  const needles = fold(search)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  return (rows || []).filter((row) => {
    if (!clientMatchesStores(row, stores)) return false;
    if (cityNeedle && !cityMatchesPlace(row.city, cityNeedle)) return false;
    if (provinceNeedle && fold(row.province) !== provinceNeedle && !fold(row.province).includes(provinceNeedle)) return false;
    if (sexNeedle && sexNeedle !== 'all' && fold(row.sex) !== sexNeedle) return false;
    if (typeNeedle && typeNeedle !== 'all' && fold(row.type) !== typeNeedle) return false;
    if (needles.length) {
      const hay = fold(`${row.name} ${row.email} ${row.city} ${row.postal} ${row.phone}`);
      if (!needles.every((needle) => hay.includes(needle))) return false;
    }
    return true;
  });
}

/**
 * Full client directory for every POS tenant the session can reach.
 * Cached per tenant for half an hour.
 */
export async function loadClientDirectory(
  session,
  { stores, city, province, sex, search, type, startDate, endDate, onProgress, loadTickets } = {},
) {
  const scope = resolveCustomerScope({ stores, city });
  const sources = posSourcesFromSession(session);
  if (!sources.length) return { rows: [], errors: ['No POS login is linked.'], notes: [], covered: [] };

  const errors = [];
  const covered = [];
  const loaded = await Promise.all(
    sources.map(async (source) => {
      try {
        const result = await fetchSourceDirectory(source, onProgress);
        covered.push(source.label);
        if (result.complete === false) {
          errors.push(`${source.label}: loaded ${result.rows.length.toLocaleString('en-CA')} of ${result.total.toLocaleString('en-CA')} clients; say the list may still be short.`);
        }
        return result.rows;
      } catch (error) {
        errors.push(`${source.label}: ${error?.message || 'clients did not load'}`);
        return [];
      }
    }),
  );

  const directory = loaded.flat();
  let rows;
  const notes = [];
  if (scope.stores.length) {
    try {
      const ticketed = await loadStoreTickets(session, {
        stores: scope.stores,
        startDate,
        endDate,
        onProgress,
        loadTickets,
      });
      if (ticketed.warning) errors.push(ticketed.warning);
      rows = filterClients(customersFromTickets(ticketed.tickets, directory), {
        city: scope.city,
        province,
        sex,
        search,
        type,
      });
      notes.push(
        `${rows.length.toLocaleString('en-CA')} customers of ${scope.stores.join(', ')} who transacted ${ticketed.startDate} – ${ticketed.endDate}. That is the store, not home city — City on each row is where they live. Every matching customer is included, not a 500-name sample.`,
      );
      if (ticketed.assumed) notes.push('No dates were named, so this used the last 30 days ending today. Say that in one sentence.');
    } catch (error) {
      errors.push(error?.message || 'Store tickets did not load.');
      rows = [];
    }
  } else {
    rows = filterClients(directory, { city: scope.city, province, sex, search, type });
    notes.push(
      `These are POS client records (the customer book). City is the home address. Sex is taken from the ID when staff entered it, otherwise inferred from the first name. ${rows.length.toLocaleString('en-CA')} matching clients are included — the full directory, not a sample.`,
    );
  }
  return { rows, errors, notes, covered, asOf: formatDateParam(new Date()), stores: scope.stores, city: scope.city };
}

export function clientFactsFromRows(rows) {
  const today = todayToronto();
  return (rows || []).map((row) => ({
    store: row.store || '—',
    date: row.lastVisit || today,
    customer: row.customer,
    name: row.name,
    sex: row.sex || 'Unknown',
    city: row.city || 'No address on file',
    province: row.province || '—',
    ageGroup: row.ageGroup || 'Unknown',
    pos: row.pos || '—',
    age: row.age,
    type: row.type,
  }));
}

export async function loadClientFacts(session, { stores, startDate, endDate, onProgress } = {}) {
  const loaded = await loadClientDirectory(session, { stores, startDate, endDate, onProgress });
  return {
    rows: clientFactsFromRows(loaded.rows),
    errors: loaded.errors,
    notes: loaded.notes,
    coveredStores: [...new Set(loaded.rows.map((row) => row.store).filter(Boolean))],
  };
}

export async function loadCustomersLookup(session, { location, onProgress } = {}) {
  const stores = location ? [location] : [];
  const loaded = await loadClientDirectory(session, { stores, onProgress });
  const summary = summarizeClients(loaded.rows);
  const bySex = [
    { sex: 'Female', customers: summary.female },
    { sex: 'Male', customers: summary.male },
    { sex: 'Unknown', customers: summary.unknownSex },
  ].filter((row) => row.customers);
  return {
    asOf: loaded.asOf,
    scope: location || 'All POS systems',
    customers: summary.customers,
    female: summary.female,
    male: summary.male,
    unknownSex: summary.unknownSex,
    withDob: summary.withDob,
    avgAge: summary.avgAge,
    bySex,
    byCity: summary.topCities.map((row) => ({ city: row.city, customers: row.count })),
    covered: loaded.covered,
    errors: loaded.errors?.length ? loaded.errors : undefined,
    notes: loaded.notes,
    hint: 'Counts are the POS client book. A store name (Montreal, Laval) is that branch — people who transacted there — not residents of the city. For the rows themselves use list_records kind customers (stores for the branch, city only for a home city that is not a store). A spreadsheet is export_spreadsheet with that resultId or source customers.',
  };
}

export function summarizeClients(rows) {
  const bySex = { Female: 0, Male: 0, Unknown: 0 };
  const byCity = new Map();
  let ages = 0;
  let ageSum = 0;
  for (const row of rows || []) {
    const sex = row.sex === 'Female' || row.sex === 'Male' ? row.sex : 'Unknown';
    bySex[sex] += 1;
    const city = row.city || 'No address on file';
    byCity.set(city, (byCity.get(city) || 0) + 1);
    if (row.age != null) {
      ages += 1;
      ageSum += row.age;
    }
  }
  const topCities = [...byCity.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([city, count]) => ({ city, count }));
  return {
    customers: rows.length,
    female: bySex.Female,
    male: bySex.Male,
    unknownSex: bySex.Unknown,
    withDob: ages,
    avgAge: ages ? Math.round((ageSum / ages) * 10) / 10 : null,
    topCities,
  };
}
