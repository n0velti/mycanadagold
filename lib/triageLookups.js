import { API_BASE_URL, authHeaders, posFetch } from './auth';
import { fetchAureusEmployees } from './aureusEmployees';
import { fetchPosLocations } from './locations';

function getErrorMessage(payload, fallback) {
  return payload?.error?.message || payload?.message || fallback;
}

function clientLabel(client) {
  const name = [client?.first_name, client?.last_name].filter(Boolean).join(' ').trim();
  return name || client?.nickname || `Client ${client?.id || ''}`.trim();
}

function clientPhone(client) {
  return String(client?.phone || client?.alternate_phone || '').trim();
}

function clientEmail(client) {
  if (client?.is_fake_email) return '';
  const email = String(client?.email || '').trim();
  if (!email) return '';
  if (/@aureus\.com$/i.test(email)) return '';
  return email;
}

function clientPlace(client) {
  const addresses = Array.isArray(client?.addresses) ? client.addresses : [];
  const preferred =
    addresses.find((row) => row?.default_for_billing) ||
    addresses.find((row) => row?.default_for_shipping) ||
    addresses[0];
  if (!preferred) return '';
  return [preferred.city, preferred.state].filter(Boolean).join(', ');
}

function firstString(...values) {
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (text) return text;
  }
  return '';
}

function firstNumber(...values) {
  for (const value of values) {
    if (value == null || value === '') continue;
    const n = Number(value);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return null;
}

function parseStamp(value) {
  const text = String(value || '').trim();
  if (!text) return 0;
  const ms = Date.parse(text.includes('T') ? text : text.replace(' ', 'T'));
  return Number.isFinite(ms) ? ms : 0;
}

function clientStoreName(client) {
  return firstString(
    client?.location?.name,
    client?.location_name,
    client?.store_name,
    client?.store?.name,
    client?.default_location?.name,
    client?.preferred_location?.name,
  );
}

function activityFromClient(client) {
  const lastSoldAt = firstString(
    client?.last_order_date,
    client?.last_sale_date,
    client?.last_order_at,
    client?.last_sold_at,
  );
  const lastBoughtAt = firstString(
    client?.last_purchase_date,
    client?.last_purchase_at,
    client?.last_bought_at,
  );
  const lastAt = firstString(client?.last_transaction_date, client?.last_transaction_at, lastSoldAt, lastBoughtAt);
  let lastKind = '';
  if (lastSoldAt && (!lastBoughtAt || parseStamp(lastSoldAt) >= parseStamp(lastBoughtAt))) lastKind = 'sold';
  else if (lastBoughtAt) lastKind = 'bought';
  const soldCount = firstNumber(client?.orders_count, client?.sales_count);
  const boughtCount = firstNumber(client?.purchases_count);
  const combined =
    soldCount != null || boughtCount != null ? (soldCount || 0) + (boughtCount || 0) : null;
  return {
    storeName: clientStoreName(client),
    lastAt,
    lastKind,
    txCount: firstNumber(client?.transactions_count, client?.transaction_count, combined),
  };
}

function mapClient(client, system = null) {
  const phone = clientPhone(client);
  const place = clientPlace(client);
  const email = clientEmail(client);
  const activity = activityFromClient(client);
  return {
    id: client.id,
    label: clientLabel(client),
    sub: [phone, place, email].filter(Boolean).join(' · '),
    storeName: activity.storeName,
    lastAt: activity.lastAt,
    lastKind: activity.lastKind,
    txCount: activity.txCount,
    activityReady: false,
    systemKey: system?.key || system?.systemKey || '',
    systemLabel: system?.label || system?.systemLabel || '',
    token: system?.token || '',
    baseUrl: system?.baseUrl || '',
    client,
  };
}

function recordClientId(record) {
  return String(record?.client_id ?? record?.client?.id ?? '').trim();
}

function recordStoreName(record) {
  return firstString(record?.location_name, record?.location?.name, record?.store_name);
}

function recordDate(record) {
  return firstString(record?.date, record?.created_at, record?.transacted_at, record?.updated_at);
}

async function fetchClientDetail(token, baseUrl, clientId) {
  const response = await posFetch(`${baseUrl}/clients/${clientId}`, {
    method: 'GET',
    headers: authHeaders(token),
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) return null;
  return payload?.data ?? payload ?? null;
}

async function fetchClientTxKind(token, baseUrl, clientId, path) {
  const attempts = [
    (params) => {
      params.set('filters[client_id]', String(clientId));
    },
    (params) => {
      params.set('client_id', String(clientId));
    },
  ];

  for (const applyFilter of attempts) {
    const params = new URLSearchParams({
      page: '1',
      items_per_page: '1',
      extra: 'client',
    });
    params.set('sort[field]', 'date');
    params.set('sort[dir]', 'desc');
    applyFilter(params);

    const response = await posFetch(`${baseUrl}/${path}?${params}`, {
      method: 'GET',
      headers: authHeaders(token),
    });
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    if (!response.ok) continue;

    const rows = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload) ? payload : [];
    const first = rows[0] || null;
    const firstId = recordClientId(first);
    const matches = Boolean(first && firstId === String(clientId));
    if (!matches) continue;
    const total = Number(payload?.meta?.total ?? payload?.total);
    return {
      last: first,
      count: Number.isFinite(total) ? total : rows.length,
    };
  }

  return { last: null, count: 0 };
}

function pickLatestTx(orders, purchases) {
  const soldAt = recordDate(orders?.last);
  const boughtAt = recordDate(purchases?.last);
  const soldMs = parseStamp(soldAt);
  const boughtMs = parseStamp(boughtAt);
  if (soldMs && soldMs >= boughtMs) {
    return { lastAt: soldAt, lastKind: 'sold', storeName: recordStoreName(orders.last) };
  }
  if (boughtMs) {
    return { lastAt: boughtAt, lastKind: 'bought', storeName: recordStoreName(purchases.last) };
  }
  return { lastAt: '', lastKind: '', storeName: '' };
}

/** Last store, last buy/sell stamp, and lifetime ticket count for a search hit. */
export async function enrichClientActivity(row, token, baseUrl) {
  const clientId = row?.id;
  const authToken = token || row?.token;
  const root = baseUrl || row?.baseUrl || API_BASE_URL;
  if (clientId == null || !authToken) return row;

  const [detail, orders, purchases] = await Promise.all([
    fetchClientDetail(authToken, root, clientId).catch(() => null),
    fetchClientTxKind(authToken, root, clientId, 'orders').catch(() => ({ last: null, count: 0 })),
    fetchClientTxKind(authToken, root, clientId, 'purchases').catch(() => ({ last: null, count: 0 })),
  ]);

  const fromDetail = activityFromClient(detail || row.client);
  const latest = pickLatestTx(orders, purchases);
  const listedCount = (orders?.count || 0) + (purchases?.count || 0);
  return {
    ...row,
    client: detail || row.client,
    storeName: latest.storeName || fromDetail.storeName || row.storeName || '',
    lastAt: latest.lastAt || fromDetail.lastAt || row.lastAt || '',
    lastKind: latest.lastKind || fromDetail.lastKind || row.lastKind || '',
    txCount: listedCount || fromDetail.txCount || row.txCount,
    activityReady: true,
  };
}

export function productLabel(product) {
  const name = String(product?.name || '').trim();
  const sku = String(product?.sku || product?.code || '').trim();
  const description = String(product?.description || '').trim();
  if (name && sku && sku.toLowerCase() !== name.toLowerCase()) return `${name} · ${sku}`;
  if (name) return name;
  if (description) return description;
  if (sku) return sku;
  return `Product ${product?.id || ''}`.trim();
}

const CLIENT_SEARCH_TTL_MS = 30_000;
const clientSearchCache = new Map();

function clientSearchKey(baseUrl, query) {
  return `${baseUrl || ''}|${String(query || '').trim().toLowerCase()}`;
}

export async function searchClients(token, query, baseUrl = API_BASE_URL, system = null) {
  const q = String(query || '').trim();
  if (q.length < 2) return [];

  const cacheKey = clientSearchKey(baseUrl, q);
  const cached = clientSearchCache.get(cacheKey);
  if (cached && Date.now() - cached.at < CLIENT_SEARCH_TTL_MS) {
    return cached.rows.map((row) => ({ ...row, ...mapClient(row.client, system) }));
  }

  const params = new URLSearchParams({ query: q, items_per_page: '25' });
  const response = await posFetch(`${baseUrl}/clients/search?${params}`, {
    method: 'GET',
    headers: authHeaders(token),
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new Error(getErrorMessage(payload, 'Failed to search customers.'));
  }

  const rows = (Array.isArray(payload?.data) ? payload.data : []).slice(0, 25).map((client) =>
    mapClient(client, system),
  );
  clientSearchCache.set(cacheKey, { at: Date.now(), rows });
  if (clientSearchCache.size > 40) {
    const oldest = clientSearchCache.keys().next().value;
    if (oldest) clientSearchCache.delete(oldest);
  }
  return rows;
}

export async function createClient(
  token,
  { firstName, lastName, email, phone } = {},
  baseUrl = API_BASE_URL,
  system = null,
) {
  const first = String(firstName || '').trim();
  const last = String(lastName || '').trim();
  const mail = String(email || '').trim();
  if (!first || !last || !mail) {
    throw new Error('First name, last name, and email are required.');
  }

  const body = {
    first_name: first,
    last_name: last,
    email: mail,
    client_type: 'person',
    status: 'Active',
    is_high_risk: false,
  };
  const phoneValue = String(phone || '').trim();
  if (phoneValue) body.phone = phoneValue;

  const response = await posFetch(`${baseUrl}/clients`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(body),
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const fieldErrors = payload?.error?.errors;
    if (fieldErrors && typeof fieldErrors === 'object') {
      const firstError = Object.values(fieldErrors).flat().find(Boolean);
      throw new Error(firstError || getErrorMessage(payload, 'Failed to add customer.'));
    }
    throw new Error(getErrorMessage(payload, 'Failed to add customer.'));
  }

  const client = payload?.data ?? payload;
  return mapClient(client, system);
}

export async function searchProducts(token, query, baseUrl = API_BASE_URL) {
  const q = String(query || '').trim();
  if (q.length < 2) return [];

  const params = new URLSearchParams({ query: q, items_per_page: '25' });
  const response = await posFetch(`${baseUrl}/products/search?${params}`, {
    method: 'GET',
    headers: authHeaders(token),
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new Error(getErrorMessage(payload, 'Failed to search products.'));
  }

  const rows = Array.isArray(payload?.data) ? payload.data : [];
  return rows.slice(0, 25).map((product) => ({
    id: product.id,
    label: productLabel(product),
    sub: [product.type, product.sku || product.code].filter(Boolean).join(' · '),
    product,
  }));
}

export async function fetchLookupLocations(token, baseUrl = API_BASE_URL) {
  const locations = await fetchPosLocations(baseUrl, token);
  return locations
    .map((location) => ({
      id: location.id,
      label: String(location.name || '').trim(),
      sub: [location.city, location.state].filter(Boolean).join(', '),
      location,
    }))
    .filter((entry) => entry.label)
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
}

export async function fetchLookupUsers(token, baseUrl = API_BASE_URL) {
  try {
    const employees = await fetchAureusEmployees(token, baseUrl);
    if (employees.length) {
      return employees
        .map((row) => {
          const label = row.fullName || row.email || row.aureusLogin;
          if (!label) return null;
          return {
            id: row.id,
            label,
            sub: [row.locationName, row.employeeType || row.role, row.email].filter(Boolean).join(' · '),
            user: row,
          };
        })
        .filter(Boolean);
    }
  } catch {
    // Fall through to /users when this session cannot read /employees.
  }

  const response = await posFetch(`${baseUrl}/users?items_per_page=200`, {
    method: 'GET',
    headers: authHeaders(token),
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) return [];

  const rows = Array.isArray(payload?.data) ? payload.data : [];
  return rows
    .map((user) => {
      const label =
        String(user?.name || '').trim() ||
        [user?.first_name, user?.last_name].filter(Boolean).join(' ').trim() ||
        String(user?.email || '').trim();
      return label
        ? {
            id: user.id,
            label,
            sub: user.email || '',
            user,
          }
        : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
}

export function employeesFromTransactions(rows) {
  const seen = new Map();
  for (const row of rows || []) {
    const label = String(row?.employeeName || '').trim();
    if (!label || label === '—') continue;
    const key = label.toLowerCase();
    if (!seen.has(key)) seen.set(key, { id: `tx-${key}`, label, sub: 'From recent transactions' });
  }
  return Array.from(seen.values()).sort((a, b) =>
    a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }),
  );
}

export function mergeEmployeeOptions(users, rows) {
  const seen = new Map();
  for (const option of [...(users || []), ...employeesFromTransactions(rows)]) {
    const key = String(option.label || '').trim().toLowerCase();
    if (!key) continue;
    if (!seen.has(key)) seen.set(key, option);
  }
  return Array.from(seen.values()).sort((a, b) =>
    a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }),
  );
}
