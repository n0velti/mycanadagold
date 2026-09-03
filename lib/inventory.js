import { API_BASE_URL, authHeaders, getLinkedPosSessions } from './auth';
import { fetchPosLocations } from './locations';

function getErrorMessage(payload, fallback) {
  return payload?.error?.message || payload?.message || fallback;
}

async function parseJsonResponse(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function formatQty(value) {
  const n = toNumber(value);
  if (Object.is(n, -0)) return '0';
  if (Number.isInteger(n)) return String(n);
  const rounded = Math.round(n * 1000) / 1000;
  return String(rounded);
}

/** Locations that are warehouses / non-store buckets, kept out of the matrix columns. */
const EXCLUDED_LOCATION_NAMES = new Set([
  'in transit',
  'umicore',
  'workshop',
  'storage',
  'westgate',
  'rcm pooled ounces',
  'pmx',
  '3rd party',
]);

function isStoreLocation(location) {
  const name = String(location?.name || '').trim().toLowerCase();
  if (!name) return false;
  if (EXCLUDED_LOCATION_NAMES.has(name)) return false;
  const status = String(location?.status || '').toLowerCase();
  return !status || status === 'active';
}

function normalizeLabel(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/grams?/g, 'g')
    .replace(/gms?/g, 'g')
    .replace(/kilos?/g, 'kg')
    .replace(/ounces?/g, 'oz')
    .replace(/[^a-z0-9]+/g, '');
}

/** Order-insensitive key so "GML 1oz non-DNA" matches "GML non-DNA 1oz". */
function normalizeTokens(value) {
  const raw = String(value || '')
    .toLowerCase()
    .replace(/grams?/g, 'g')
    .replace(/gms?/g, 'g')
    .replace(/kilos?/g, 'kg')
    .replace(/ounces?/g, 'oz');
  const tokens = raw.match(/[a-z]+|[0-9]+(?:\.[0-9]+)?/g) || [];
  return tokens.slice().sort().join('');
}

function productLabels(product) {
  return [product?.name, product?.sku].filter(Boolean);
}

/**
 * Bullion stock priority (in-stock targets):
 * green ~95%, yellow ~90%, red ~80%. Unlisted products have no tier.
 */
export const BULLION_PRIORITY = {
  green: 'green',
  yellow: 'yellow',
  red: 'red',
};

const BULLION_PRIORITY_ORDER = {
  green: 0,
  yellow: 1,
  red: 2,
};

/** Canonical / alias labels per priority tier (matched via normalizeLabel + tokens). */
const BULLION_PRIORITY_LABELS = {
  green: [
    'GBAR 1oz Carded',
    'GBAR 1 oz carded',
    'GBAR 1oz SEALED',
    'GBAR 1oz RCM',
    'GBAR 1 oz RCM',
    'GBAR 1g carded',
    'GBAR 1gram',
    'GBAR 1g',
    'GBAR 2.5g carded',
    'GBAR 2.5g',
    'GBAR 5g carded',
    'GBAR 5g',
    'GBAR 10g carded',
    'GBAR 10g (carded)',
    'GBAR 10g',
    'GML 1/2',
    'GML 1/2oz',
    'GML 1/4',
    'GML 1/4oz',
    'GML 1/10',
    'GML 1/10oz',
    'GML 1/20',
    'GML 1/20oz',
    'GML 1oz DNA',
    'GML DNA',
    'Maplegram 1g',
    'GML Maplegram 1g',
    'GML MapleGram 1g',
    'GML 1g',
    'Plat Bar 1oz',
    'PLAT BAR 1oz',
    'PLATBAR 1oz',
    'PlatBAR 1oz',
    'Plat Maple 1oz',
    'PLAT Maple 1oz',
    'PlatMAPLE 1oz',
    'RCM 1/2 oz',
    'RCM 1/2oz',
    'PLAT Maple 1/2 oz',
    'Plat Maple 1/2 oz',
    'SBAR 1kg',
    'SBAR/ROUND 1kg',
    'SBAR 10oz RCM',
    'SBAR 100oz RCM',
    'SML 1oz DNA',
    'SML DNA',
  ],
  yellow: [
    'GBAR 1oz uncarded',
    'GBAR 1 oz uncarded',
    'GBAR 1oz UNSEALED',
    'GML 1oz NON-DNA',
    'GML 1oz non-DNA',
    'GML NON-DNA',
    'Plat by gram',
    'PLAT by gram',
    'Platinum by gram',
    'S Round 1oz',
    'S ROUND 1oz',
    'SROUND 1oz',
    '1oz SRound',
    'S Round 2oz Generic',
    'SBAR/ROUND 2oz',
    '2oz Silver Round',
    'SBAR 1oz',
    'SBAR 5oz',
    'SBAR 5oz or round',
    'SBAR 10oz NON-RCM',
    'SBAR 10oz non-RCM',
    'SBAR 10oz non-RCM (or round)',
    'SBAR 10oz',
    'SBAR/ROUND 10oz',
    'SBAR 100oz NON-RCM',
    'SBAR 100oz non-RCM',
    'SBAR 100oz',
    'SBAR 50oz',
    'Silver 1oz American Eagle',
    'SE 1oz',
    'SEagle',
    'SML 1.5oz',
    'Silver 1.5oz RCM Coin',
    'SML 1oz NON-DNA',
    'SML 1oz non-DNA',
    'SML NON-DNA',
    'SML 1oz special',
    'SML 2oz',
  ],
  red: [
    'GBAR 1kg',
    '1kg GBAR',
    'GBAR 5oz',
    'GBAR 10oz',
    'GBAR 100g',
    'GML 999 or Damaged',
    'GML 999 or damaged',
    'GML 999',
    'Other Gold Bullion by OUNCE',
    'Other Gold Bullion by GRAM',
    'Other GB by OZ',
    'Other GB by GRAM',
    'Other Silver Bullion by OUNCE',
    'Other Silver Bullion by GRAM',
    'Other SB by OUNCE',
    'Other SB by GRAM',
    'Other Gold Bullion by gram',
    'Other Gold Bullion by ounce',
    'Other Silver Bullion by gram',
    'Other Silver Bullion by ounce',
    'SBAR Beaver Bullion 1oz',
    'SBAR Beaver Bullion 2oz',
    'Silver Bar Beaver Bullion 1oz',
    'Silver Bar Beaver Bullion 2oz',
    'Beaver Bullion 1oz',
    'Beaver Bullion 2oz',
    'SML 1oz Tarnished',
    'SML 1oz tarnished',
    'SML SCRAP',
    'SML 1oz SCRAP',
    'SML 1oz scrappy',
  ],
};

function buildPriorityLookup() {
  const byNorm = new Map();
  const byTokens = new Map();

  for (const [tier, labels] of Object.entries(BULLION_PRIORITY_LABELS)) {
    for (const label of labels) {
      const norm = normalizeLabel(label);
      const tokens = normalizeTokens(label);
      // First listed tier wins if a label somehow overlaps.
      if (norm && !byNorm.has(norm)) byNorm.set(norm, tier);
      if (tokens && !byTokens.has(tokens)) byTokens.set(tokens, tier);
    }
  }

  return { byNorm, byTokens };
}

const BULLION_PRIORITY_LOOKUP = buildPriorityLookup();

/**
 * Resolve green / yellow / red / null stock-priority for a bullion product.
 */
export function resolveBullionPriority(product) {
  for (const label of productLabels(product)) {
    const tier =
      BULLION_PRIORITY_LOOKUP.byNorm.get(normalizeLabel(label)) ||
      BULLION_PRIORITY_LOOKUP.byTokens.get(normalizeTokens(label));
    if (tier) return tier;
  }
  return null;
}

export function bullionPriorityRank(priority) {
  if (priority == null) return 3;
  return BULLION_PRIORITY_ORDER[priority] ?? 3;
}

/**
 * East product name/sku → PMX sku matchers.
 * Matching PMX quantities at Richmond Hill are summed into the East row.
 */
const EAST_TO_PMX_MATCHERS = {
  'GML 1oz non-DNA': [
    { exact: 'GCOIN 1oz - MLBD' },
    { pattern: /^GCOIN 1oz - ML(?!999)\d+$/i },
  ],
  'GML NON-DNA': [
    { exact: 'GCOIN 1oz - MLBD' },
    { pattern: /^GCOIN 1oz - ML(?!999)\d+$/i },
  ],
  'GML 1oz DNA': [{ exact: 'GCOIN 1oz - MLBD' }],
  'GML DNA': [{ exact: 'GCOIN 1oz - MLBD' }],
  'GML 999 or damaged': [{ exact: 'GCOIN 1oz - ML999' }],
  'GML 999': [{ exact: 'GCOIN 1oz - ML999' }],
  'GML 1/20oz': [{ exact: 'GCOIN 1/20oz - MLBD' }],
  'GML 1/20': [{ exact: 'GCOIN 1/20oz - MLBD' }],
  'GML 1/10oz': [{ exact: 'GCOIN 1/10oz - MLBD' }],
  'GML 1/10': [{ exact: 'GCOIN 1/10oz - MLBD' }],
  'GML 1/4oz': [{ exact: 'GCOIN 1/4oz - MLBD' }],
  'GML 1/4': [{ exact: 'GCOIN 1/4oz - MLBD' }],
  'GML 1/2oz': [{ exact: 'GCOIN 1/2oz - MLBD' }],
  'GML 1/2': [{ exact: 'GCOIN 1/2oz - MLBD' }],
  'GML Maplegram 1g': [{ exact: 'GCOIN 1gm - MLBD' }],
  'GML 1g': [{ exact: 'GCOIN 1gm - MLBD' }],

  'GBAR 1 oz RCM': [{ exact: 'GBAR 1oz - RCM' }],
  'GBAR 1oz RCM': [{ exact: 'GBAR 1oz - RCM' }],
  'GBAR 1 oz uncarded': [{ exact: 'GBAR 1oz - MISC' }],
  'GBAR 1oz UNSEALED': [{ exact: 'GBAR 1oz - MISC' }],
  'GBAR 1 oz carded': [{ prefix: 'GBAR 1oz - PAMP' }],
  'GBAR 1oz SEALED': [{ prefix: 'GBAR 1oz - PAMP' }],
  'GBAR 100g': [{ prefix: 'GBAR 100g' }],
  'GBAR 1g carded': [{ prefix: 'GBAR 1gm -' }],
  'GBAR 1gram': [{ prefix: 'GBAR 1gm -' }],
  'GBAR 2.5g carded': [{ prefix: 'GBAR 2.5gm -' }],
  'GBAR 2.5g': [{ prefix: 'GBAR 2.5gm -' }],
  'GBAR 5g carded': [{ prefix: 'GBAR 5gm -' }],
  'GBAR 5g': [{ prefix: 'GBAR 5gm -' }],
  'GBAR 10g (carded)': [{ prefix: 'GBAR 10gm -' }],
  'GBAR 10g': [{ prefix: 'GBAR 10gm -' }],
  'GBAR 5oz': [{ prefix: 'GBAR 5oz' }],
  'GBAR 10oz': [{ prefix: 'GBAR 10oz' }],
  'GBAR 1kg': [{ exact: 'GBAR 1Kilo - RCM' }],

  'Silver 1oz American Eagle': [
    { exact: 'SC-US1ozEAGLE-BD' },
    { prefix: 'SC-US1ozEAGLE-' },
    { exact: 'PTC-USEAGLE1oz-BD' },
  ],
  'SE 1oz': [
    { exact: 'SC-US1ozEAGLE-BD' },
    { prefix: 'SC-US1ozEAGLE-' },
    { exact: 'PTC-USEAGLE1oz-BD' },
  ],

  'SML 1oz non-DNA': [{ exact: 'SC-SML1oz-BD' }, { prefix: 'SC-SML1oz-' }],
  'SML NON-DNA': [{ exact: 'SC-SML1oz-BD' }, { prefix: 'SC-SML1oz-' }],
  'SML 1oz DNA': [{ exact: 'SC-SML1oz-BD' }],
  'SML DNA': [{ exact: 'SC-SML1oz-BD' }],
  'SML 1oz tarnished': [{ exact: 'SC-SML1oz-BD' }],
  'SML SCRAP': [{ exact: 'SC-SML1oz-BD' }],
  'SML 1.5oz': [{ prefix: 'SC-RCM1.5oz' }],
  'SML 2oz': [{ exact: 'SR-2ozMISCMINT' }],

  'SBAR 5oz': [{ prefix: 'SB-5oz' }],
  'SBAR 10oz non-RCM': [{ prefix: 'SB-10ozMISC' }, { exact: 'SB-10ozCPMX-CAST' }],
  'SBAR/ROUND 10oz': [{ prefix: 'SB-10ozMISC' }, { exact: 'SB-10ozCPMX-CAST' }],
  'SBAR 10oz RCM': [{ exact: 'SB-10ozRCM' }],
  'SBAR 1kg': [{ prefix: 'SB-1kg' }],
  'SBAR/ROUND 1kg': [{ prefix: 'SB-1kg' }],
  'S ROUND 1oz': [{ prefix: 'SR-1oz' }],
  'SROUND 1oz': [{ prefix: 'SR-1oz' }],
  'S Round 2oz Generic': [{ exact: 'SR-2ozMISCMINT' }],
  'SBAR/ROUND 2oz': [{ exact: 'SR-2ozMISCMINT' }],
  'SBAR 50oz': [{ prefix: 'SB-50oz' }],
  'SBAR 100oz non-RCM': [
    { exact: 'SB-100ozMISCMINT' },
    { exact: 'SB-100ozPAMP' },
    { exact: 'SB-100ozCPMX-CAST' },
  ],
  'SBAR 100oz': [
    { exact: 'SB-100ozMISCMINT' },
    { exact: 'SB-100ozPAMP' },
    { exact: 'SB-100ozCPMX-CAST' },
  ],
  'SBAR 100oz RCM': [{ prefix: 'SB-100ozRCM' }],
  'SBAR 1oz': [{ prefix: 'SB-1oz' }],

  'PLAT Maple 1oz': [{ exact: 'PTC-SML1oz-BD' }, { prefix: 'PTC-SML1oz-' }],
  'PLAT BAR 1oz': [{ prefix: 'PTBAR 1oz' }],
  'PLATBAR 1oz': [{ prefix: 'PTBAR 1oz' }],
  'PLAT Maple 1/2 oz': [{ exact: 'PTC-SML1/2oz-BD' }],
  'Plat Maple 1/2 oz': [{ exact: 'PTC-SML1/2oz-BD' }],

  'PALLADIUM 1oz Maple': [{ exact: '1oz Palladium Maple' }],
  '1oz PALLADIUM Maple': [{ exact: '1oz Palladium Maple' }],
  'PALLADIUM 1oz BAR': [{ exact: '1oz Palladium Bar' }],
  '1oz PALLADIUM BAR': [{ exact: '1oz Palladium Bar' }],

  'STC - 100oz SB RCM': [{ exact: 'STC - 100oz SB RCM' }],
  'STC - GML 1oz': [{ exact: 'STC - 1oz GML' }],
};

/** Extra East → GTA label aliases when names diverge. */
const EAST_TO_GTA_ALIASES = {
  'SML 1oz tarnished': ['SML 1oz SCRAP', 'SML 1oz scrappy', 'SML SCRAP'],
  'SML SCRAP': ['SML 1oz SCRAP', 'SML 1oz scrappy'],
  'SBAR 10oz non-RCM': ['SBAR 10oz non-RCM (or round)', 'SBAR 10oz'],
  'SBAR/ROUND 10oz': ['SBAR 10oz non-RCM (or round)', 'SBAR 10oz'],
  'SBAR 5oz': ['SBAR 5oz or round', 'SBAR 5oz'],
  'Silver 1oz American Eagle': ['SEagle', 'Silver 1oz American Eagle'],
  'SE 1oz': ['SEagle', 'Silver 1oz American Eagle'],
  'PALLADIUM 1oz BAR': ['PALLADIUM', '1oz  Palladium Bar ', '1oz Palladium Bar'],
  '1oz PALLADIUM BAR': ['PALLADIUM', '1oz Palladium Bar'],
  'GBAR 1kg': ['1kg GBAR', 'GBAR 1kg'],
  'GML Maplegram 1g': ['GML MapleGram 1g', 'GML 1g'],
  'SML 1.5oz': ['Silver 1.5oz RCM Coin', 'SML 1.5oz'],
  'Other Gold Bullion by OUNCE': ['Other GB by OZ', 'Other Gold Bullion by OUNCE'],
  'Other Gold Bullion by GRAM': ['Other GB by GRAM', 'Other Gold Bullion by GRAM'],
  'Other Silver Bullion by OUNCE': ['Other SB by OUNCE', 'Other Silver Bullion by OUNCE'],
  'Other Silver Bullion by GRAM': ['Other SB by GRAM', 'Other Silver Bullion by GRAM'],
  'PLAT Maple 1oz': ['PlatMAPLE 1oz', 'PLAT Maple 1oz'],
  'PLAT BAR 1oz': ['PlatBAR 1oz', 'PLAT BAR 1oz'],
  'S ROUND 1oz': ['1oz SRound', 'S ROUND 1oz'],
  'SROUND 1oz': ['1oz SRound', 'S ROUND 1oz'],
  'S Round 2oz Generic': ['2oz Silver Round', 'S Round 2oz Generic'],
};

const GTA_STORE_NAMES = ['Toronto', 'Mississauga', 'Hamilton'];
const PMX_STORE_NAMES = ['Richmond Hill'];

function matcherHits(sku, matcher) {
  const label = String(sku || '');
  if (!label) return false;
  if (matcher.exact) {
    return label.localeCompare(matcher.exact, undefined, { sensitivity: 'base' }) === 0;
  }
  if (matcher.prefix) {
    return label.toLowerCase().startsWith(String(matcher.prefix).toLowerCase());
  }
  if (matcher.includes) {
    return label.toLowerCase().includes(String(matcher.includes).toLowerCase());
  }
  if (matcher.pattern instanceof RegExp) {
    return matcher.pattern.test(label);
  }
  return false;
}

function buildProductIndex(products) {
  const byNorm = new Map();
  const byTokens = new Map();

  const add = (map, key, product) => {
    if (!key) return;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(product);
  };

  for (const product of products) {
    for (const label of productLabels(product)) {
      add(byNorm, normalizeLabel(label), product);
      add(byTokens, normalizeTokens(label), product);
    }
  }

  return { byNorm, byTokens };
}

function findLinkedProducts(eastProduct, index, aliasMap = {}) {
  const seen = new Set();
  const matches = [];

  const consider = (product) => {
    const id = String(product.id);
    if (seen.has(id)) return;
    seen.add(id);
    matches.push(product);
  };

  const labels = productLabels(eastProduct);
  for (const label of labels) {
    for (const product of index.byNorm.get(normalizeLabel(label)) || []) {
      consider(product);
    }
    for (const product of index.byTokens.get(normalizeTokens(label)) || []) {
      consider(product);
    }
    for (const alias of aliasMap[label] || []) {
      for (const product of index.byNorm.get(normalizeLabel(alias)) || []) {
        consider(product);
      }
      for (const product of index.byTokens.get(normalizeTokens(alias)) || []) {
        consider(product);
      }
    }
  }

  return matches;
}

function pmxQtyForEastProduct(eastProduct, pmxProducts, qtyByProductId) {
  const labels = productLabels(eastProduct);
  const matchers = [];
  for (const label of labels) {
    const listed = EAST_TO_PMX_MATCHERS[label];
    if (listed) matchers.push(...listed);
  }

  const eastKeys = new Set(labels.map(normalizeLabel).filter(Boolean));
  let total = 0;
  const seen = new Set();

  for (const product of pmxProducts) {
    const sku = product.sku || product.name || '';
    const id = String(product.id);
    if (seen.has(id)) continue;

    const exactNorm =
      eastKeys.has(normalizeLabel(product.sku)) || eastKeys.has(normalizeLabel(product.name));
    const aliasHit = matchers.some((matcher) => matcherHits(sku, matcher));

    if (!exactNorm && !aliasHit) continue;
    seen.add(id);
    total += qtyByProductId.get(id) || 0;
  }

  return total;
}

function qtyAtLocation(stocks, productId, locationId) {
  const entries = stocks[String(productId)];
  if (!Array.isArray(entries)) return 0;
  let qty = 0;
  for (const entry of entries) {
    if (String(entry?.location_id) === String(locationId)) {
      qty += toNumber(entry?.quantity);
    }
  }
  return qty;
}

const PRODUCT_PAGE_SIZE = 1000;
const INVENTORY_CHUNK_SIZE = 100;
const MATRIX_CACHE_TTL_MS = 90_000;

let matrixCache = {
  key: '',
  data: null,
  fetchedAt: 0,
  promise: null,
};

function matrixCacheKey(session) {
  const linked = getLinkedPosSessions(session)
    .map((system) => `${system.key}:${system.token ? '1' : '0'}`)
    .join(',');
  return `${session?.token || ''}|${session?.baseUrl || API_BASE_URL}|${linked}`;
}

export function peekInventoryMatrix(session) {
  if (!session?.token) return null;
  const key = matrixCacheKey(session);
  if (
    matrixCache.key === key &&
    matrixCache.data &&
    Date.now() - matrixCache.fetchedAt < MATRIX_CACHE_TTL_MS
  ) {
    return matrixCache.data;
  }
  return null;
}

/** Forget cached inventory on sign-out so the next user never sees stale data. */
export function clearInventoryCache() {
  matrixCache = { key: '', data: null, fetchedAt: 0, promise: null };
}

/** Warm the shared matrix cache (Home / login). Errors are ignored. */
export function prefetchInventoryMatrix(session) {
  if (!session?.token) return;
  if (peekInventoryMatrix(session)) return;
  fetchInventoryMatrix(session).catch(() => {});
}

async function fetchBullionProductsPage(token, baseUrl, page, itemsPerPage) {
  const params = new URLSearchParams({
    inventory: 'true',
    page: String(page),
    items_per_page: String(itemsPerPage),
    type: 'bullion',
    'sort[dir]': 'asc',
  });

  const response = await fetch(`${baseUrl}/products?${params.toString()}`, {
    method: 'GET',
    headers: authHeaders(token),
  });
  const payload = await parseJsonResponse(response);

  if (!response.ok) {
    throw new Error(getErrorMessage(payload, 'Failed to load products.'));
  }

  return {
    rows: Array.isArray(payload?.data) ? payload.data : [],
    totalPages: Number(payload?.meta?.pagination?.total_pages) || 1,
  };
}

export async function fetchBullionProducts(token, baseUrl = API_BASE_URL) {
  const first = await fetchBullionProductsPage(token, baseUrl, 1, PRODUCT_PAGE_SIZE);
  if (first.totalPages <= 1) return first.rows;

  const rest = await Promise.all(
    Array.from({ length: first.totalPages - 1 }, (_, index) =>
      fetchBullionProductsPage(token, baseUrl, index + 2, PRODUCT_PAGE_SIZE),
    ),
  );

  return first.rows.concat(...rest.map((page) => page.rows));
}

export async function fetchProductInventory(
  token,
  productIds,
  baseUrl = API_BASE_URL,
  { locations, date } = {},
) {
  if (!productIds.length) {
    return { stocks: {}, onSaleOrders: {}, onPurchaseOrders: {}, exclusions: [] };
  }

  const chunks = [];
  for (let i = 0; i < productIds.length; i += INVENTORY_CHUNK_SIZE) {
    chunks.push(productIds.slice(i, i + INVENTORY_CHUNK_SIZE));
  }

  const parts = await Promise.all(
    chunks.map(async (chunk) => {
      const params = new URLSearchParams({
        products: chunk.join(','),
      });
      if (locations != null && locations !== '') {
        params.set('locations', Array.isArray(locations) ? locations.join(',') : String(locations));
      }
      if (date) params.set('date', date);

      const response = await fetch(`${baseUrl}/products/inventory?${params.toString()}`, {
        method: 'GET',
        headers: authHeaders(token),
      });
      const payload = await parseJsonResponse(response);

      if (!response.ok) {
        throw new Error(getErrorMessage(payload, 'Failed to load inventory.'));
      }

      return payload && typeof payload === 'object' ? payload : {};
    }),
  );

  const stocks = Object.assign({}, ...parts.map((part) => part.stocks || {}));
  const onSaleOrders = Object.assign({}, ...parts.map((part) => part.onSaleOrders || {}));
  const onPurchaseOrders = Object.assign({}, ...parts.map((part) => part.onPurchaseOrders || {}));
  const exclusions = parts.flatMap((part) => (Array.isArray(part.exclusions) ? part.exclusions : []));

  return { stocks, onSaleOrders, onPurchaseOrders, exclusions };
}

/**
 * Loads selected store columns from a linked POS system.
 * Returns stores + stocks + products for matching into East rows.
 */
async function fetchLinkedSystemColumns(session, systemKey, storeNames) {
  const system = getLinkedPosSessions(session).find(
    (entry) => entry.key === systemKey && entry.token,
  );
  if (!system?.token) {
    return { stores: [], products: [], stocks: {}, error: '' };
  }

  try {
    const [locations, products] = await Promise.all([
      fetchPosLocations(system.baseUrl, system.token),
      fetchBullionProducts(system.token, system.baseUrl),
    ]);

    const wanted = new Map(
      storeNames.map((name) => [name.toLowerCase(), name]),
    );

    const stores = [];
    for (const location of locations) {
      const trimmed = String(location?.name || '').trim();
      const canonical = wanted.get(trimmed.toLowerCase());
      if (!canonical) continue;
      if (!isStoreLocation({ ...location, name: trimmed })) continue;
      stores.push({
        id: `${systemKey}-${location.id}`,
        sourceId: String(location.id),
        name: canonical,
        city: location.city || '',
        systemKey,
      });
    }

    stores.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

    const missing = storeNames.filter(
      (name) => !stores.some((store) => store.name.toLowerCase() === name.toLowerCase()),
    );

    const productIds = products.map((product) => String(product.id));
    const { stocks } = await fetchProductInventory(system.token, productIds, system.baseUrl);

    return {
      stores,
      products,
      stocks,
      error: missing.length
        ? `${system.label || systemKey}: missing ${missing.join(', ')}.`
        : '',
    };
  } catch (error) {
    return {
      stores: [],
      products: [],
      stocks: {},
      error: error?.message || `Failed to load ${systemKey} inventory.`,
    };
  }
}

function linkedQtyForEastProduct({
  eastProduct,
  systemKey,
  store,
  products,
  stocks,
  index,
  qtyByProductId,
}) {
  if (systemKey === 'pmx') {
    const map =
      qtyByProductId ||
      (() => {
        const next = new Map();
        for (const product of products) {
          const id = String(product.id);
          next.set(id, qtyAtLocation(stocks, id, store.sourceId));
        }
        return next;
      })();
    return pmxQtyForEastProduct(eastProduct, products, map);
  }

  // GTA (and any similar catalogs): match by name/sku tokens + aliases.
  const matches = findLinkedProducts(eastProduct, index, EAST_TO_GTA_ALIASES);
  let total = 0;
  for (const product of matches) {
    total += qtyAtLocation(stocks, product.id, store.sourceId);
  }
  return total;
}

function buildLocationQtyMap(products, stocks, locationId) {
  const map = new Map();
  for (const product of products) {
    const id = String(product.id);
    map.set(id, qtyAtLocation(stocks, id, locationId));
  }
  return map;
}

/**
 * Builds a product × store inventory matrix across East + GTA + PMX.
 * Results are cached briefly so Tools + store-drawer tabs share one fetch.
 */
export async function fetchInventoryMatrix(session, { force = false } = {}) {
  const token = session?.token;
  if (!token) {
    throw new Error('Not signed in.');
  }

  const key = matrixCacheKey(session);
  const now = Date.now();

  if (
    !force &&
    matrixCache.key === key &&
    matrixCache.data &&
    now - matrixCache.fetchedAt < MATRIX_CACHE_TTL_MS
  ) {
    return matrixCache.data;
  }

  if (!force && matrixCache.key === key && matrixCache.promise) {
    return matrixCache.promise;
  }

  const promise = loadInventoryMatrix(session)
    .then((data) => {
      matrixCache = {
        key,
        data,
        fetchedAt: Date.now(),
        promise: null,
      };
      return data;
    })
    .catch((error) => {
      if (matrixCache.promise === promise) {
        matrixCache = { ...matrixCache, promise: null };
      }
      throw error;
    });

  matrixCache = {
    ...matrixCache,
    key,
    promise,
  };

  return promise;
}

async function loadInventoryMatrix(session) {
  const token = session.token;
  const baseUrl = session.baseUrl || API_BASE_URL;

  const eastProductsPromise = fetchBullionProducts(token, baseUrl);
  const eastLocationsPromise = fetchPosLocations(baseUrl, token);
  const gtaPromise = fetchLinkedSystemColumns(session, 'gta', GTA_STORE_NAMES);
  const pmxPromise = fetchLinkedSystemColumns(session, 'pmx', PMX_STORE_NAMES);

  const products = await eastProductsPromise;
  const productIds = products.map((product) => String(product.id));
  const eastInventoryPromise = fetchProductInventory(token, productIds, baseUrl);

  const [locations, inventory, gta, pmx] = await Promise.all([
    eastLocationsPromise,
    eastInventoryPromise,
    gtaPromise,
    pmxPromise,
  ]);

  const eastStores = locations
    .filter(isStoreLocation)
    .map((location) => ({
      id: String(location.id),
      sourceId: String(location.id),
      name: String(location.name || '').trim() || `Location ${location.id}`,
      city: location.city || '',
      systemKey: 'east',
    }));

  const stores = [...eastStores, ...gta.stores, ...pmx.stores].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
  );

  const stocks = inventory.stocks;
  const eastStoreIds = new Set(
    stores.filter((store) => store.systemKey === 'east').map((store) => store.id),
  );

  const gtaIndex = buildProductIndex(gta.products);
  const pmxQtyByStore = new Map(
    pmx.stores.map((store) => [
      store.id,
      buildLocationQtyMap(pmx.products, pmx.stocks, store.sourceId),
    ]),
  );

  const rows = products
    .map((product) => {
      const id = String(product.id);
      const entries = Array.isArray(stocks[id]) ? stocks[id] : [];
      const quantities = {};

      for (const store of stores) {
        quantities[store.id] = 0;
      }

      for (const entry of entries) {
        const locationId = String(entry?.location_id ?? '');
        if (!eastStoreIds.has(locationId)) continue;
        quantities[locationId] = toNumber(entry?.quantity);
      }

      for (const store of gta.stores) {
        quantities[store.id] = linkedQtyForEastProduct({
          eastProduct: product,
          systemKey: 'gta',
          store,
          products: gta.products,
          stocks: gta.stocks,
          index: gtaIndex,
        });
      }

      for (const store of pmx.stores) {
        quantities[store.id] = linkedQtyForEastProduct({
          eastProduct: product,
          systemKey: 'pmx',
          store,
          products: pmx.products,
          stocks: pmx.stocks,
          qtyByProductId: pmxQtyByStore.get(store.id),
        });
      }

      const total = stores.reduce((sum, store) => sum + (quantities[store.id] || 0), 0);
      const priority = resolveBullionPriority(product);

      return {
        id,
        name: product.name || product.sku || `Product ${id}`,
        sku: product.sku || '',
        metal: product.metal || '',
        priority,
        quantities,
        total,
      };
    })
    .sort((a, b) => {
      const rankDiff = bullionPriorityRank(a.priority) - bullionPriorityRank(b.priority);
      if (rankDiff !== 0) return rankDiff;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });

  const warning = [gta.error, pmx.error].filter(Boolean).join(' ');

  return {
    stores,
    rows,
    warning,
  };
}
