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

function mapClient(client, system = null) {
  const phone = clientPhone(client);
  const place = clientPlace(client);
  const email = clientEmail(client);
  return {
    id: client.id,
    label: clientLabel(client),
    sub: [phone, place, email].filter(Boolean).join(' · '),
    systemKey: system?.key || system?.systemKey || '',
    systemLabel: system?.label || system?.systemLabel || '',
    client,
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
