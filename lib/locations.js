import { authHeaders, getLinkedPosSessions, posFetch, posSystemsFromSession, resolvePosAuth } from './auth';

function getErrorMessage(payload, fallback) {
  return payload?.error?.message || payload?.message || fallback;
}

function posSystemsForTransfer(session) {
  return posSystemsFromSession(session);
}

const EXCLUDED_LOCATION_NAMES = new Set([
  'in transit',
  'umicore',
  'storage',
  'westgate',
  'rcm pooled ounces',
  'pmx',
  '3rd party',
]);

const QUEBEC_STORE_NAMES = new Set(['montreal', 'quebec', 'laval']);

function namesMatch(a, b) {
  return (
    String(a || '')
      .trim()
      .localeCompare(String(b || '').trim(), undefined, { sensitivity: 'base' }) === 0
  );
}

/** Prefer GTA/PMX for Ontario stores; Quebec retail lives on East. */
function storeSystemRank(systemKey, storeName) {
  const quebec = QUEBEC_STORE_NAMES.has(String(storeName || '').trim().toLowerCase());
  if (quebec) {
    if (systemKey === 'east') return 0;
    if (systemKey === 'gta' || systemKey === 'pmx') return 1;
    return 2;
  }
  if (systemKey === 'gta' || systemKey === 'pmx') return 0;
  if (systemKey === 'east') return 1;
  return 2;
}

/** The POS location that should own tickets for this store name. */
export function preferStoreByName(stores, storeName) {
  const target = String(storeName || '').trim();
  if (!target) return null;
  const hits = (stores || []).filter((store) => namesMatch(store?.name || store?.label, target));
  if (!hits.length) return null;
  hits.sort((a, b) => {
    const rank = storeSystemRank(a.systemKey, target) - storeSystemRank(b.systemKey, target);
    if (rank !== 0) return rank;
    if (Boolean(a.selling) !== Boolean(b.selling)) return a.selling ? -1 : 1;
    return 0;
  });
  return hits[0];
}

/** One row per store name, already pointed at the owning Aureus instance. */
export function uniquePreferredStores(stores) {
  const byName = new Map();
  for (const store of stores || []) {
    const name = String(store?.name || '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    const prev = byName.get(key);
    byName.set(key, prev ? preferStoreByName([prev, store], name) : store);
  }
  return Array.from(byName.values()).sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
  );
}

/** Token + base URL for the Aureus instance that owns this store. */
export function posAuthForStore(session, store) {
  const auth = resolvePosAuth(session, store?.systemKey || 'east');
  return {
    ...auth,
    systemLabel: store?.systemLabel || auth.systemLabel,
    locationId: store?.sourceId ?? store?.locationId ?? null,
  };
}

/** Retail / branch locations usable as transfer stops (matches inventory matrix). */
function isTransferStore(location) {
  const name = String(location?.name || '').trim().toLowerCase();
  if (!name) return false;
  if (EXCLUDED_LOCATION_NAMES.has(name)) return false;
  const status = String(location?.status || '').toLowerCase();
  return !status || status === 'active';
}

function formatLocationAddress(location) {
  const line1 = [location?.address_1, location?.address_2].filter(Boolean).join(', ');
  const line2 = [location?.city, location?.state, location?.zip].filter(Boolean).join(' ');
  return [line1, line2].filter(Boolean).join(', ') || '—';
}

function mapLocation(location, system) {
  const name = String(location.name || '').trim() || '—';
  return {
    id: `${system.key}-${location.id}`,
    sourceId: location.id,
    systemKey: system.key,
    systemLabel: system.label,
    name,
    isWorkshop: name.toLowerCase() === 'workshop',
    address: formatLocationAddress(location),
    phone: location.main_phone || '',
    status: location.status || '',
    selling: location.selling_location === 'Yes' || location.selling_location === true,
    city: location.city || '',
    state: location.state || '',
  };
}

const LOCATION_CACHE_TTL_MS = 5 * 60 * 1000;
const locationCache = new Map();

function locationCacheKey(baseUrl, token) {
  return `${baseUrl || ''}|${token || ''}`;
}

/** Forget cached POS locations on sign-out. */
export function clearLocationCache() {
  locationCache.clear();
}

async function requestPosLocations(baseUrl, token) {
  const response = await posFetch(`${baseUrl}/settings/locations`, {
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
    throw new Error(getErrorMessage(payload, 'Failed to load store locations.'));
  }

  const rows = Array.isArray(payload?.data)
    ? payload.data
    : Array.isArray(payload)
      ? payload
      : [];

  return rows.filter((location) => {
    const status = String(location?.status || '').toLowerCase();
    return !status || status === 'active';
  });
}

/** Store name for a POS location id, using the cached locations list. */
export async function resolveLocationName(baseUrl, token, locationId) {
  const id = locationId != null && locationId !== '' ? String(locationId) : '';
  if (!id || !token) return '';
  try {
    const locations = await fetchPosLocations(baseUrl, token);
    const hit = (locations || []).find((row) => String(row.id) === id);
    return String(hit?.name || '').trim();
  } catch {
    return '';
  }
}

export async function fetchPosLocations(baseUrl, token) {
  const key = locationCacheKey(baseUrl, token);
  const cached = locationCache.get(key);
  if (cached?.data && Date.now() - cached.at < LOCATION_CACHE_TTL_MS) return cached.data;
  if (cached?.promise) return cached.promise;

  const promise = requestPosLocations(baseUrl, token)
    .then((data) => {
      locationCache.set(key, { at: Date.now(), data, promise: null });
      return data;
    })
    .catch((error) => {
      const current = locationCache.get(key);
      if (current?.promise === promise) {
        locationCache.set(key, { at: current.at || 0, data: current.data || null, promise: null });
      }
      if (cached?.data) return cached.data;
      throw error;
    });

  locationCache.set(key, {
    at: cached?.at || 0,
    data: cached?.data || null,
    promise,
  });
  return promise;
}

export async function fetchLinkedStoreLocations(session) {
  const systems = getLinkedPosSessions(session).filter((system) => system.token);

  const groups = await Promise.all(
    systems.map(async (system) => {
      try {
        const locations = await fetchPosLocations(system.baseUrl, system.token);
        const stores = locations
          .map((location) => mapLocation(location, system))
          .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

        return {
          key: system.key,
          label: system.label,
          stores,
          error: '',
        };
      } catch (error) {
        return {
          key: system.key,
          label: system.label,
          stores: [],
          error: error?.message || 'Failed to load store locations.',
        };
      }
    }),
  );

  return groups;
}

/**
 * All retail stores across East + linked POS systems, for transfer routing.
 */
export async function fetchTransferStores(session) {
  const systems = posSystemsForTransfer(session);
  if (systems.length === 0) {
    throw new Error('Not signed in.');
  }

  const groups = await Promise.all(
    systems.map(async (system) => {
      if (!system.token) {
        return {
          key: system.key,
          label: system.label,
          stores: [],
          error: system.error || `Not signed in to ${system.label}.`,
        };
      }

      try {
        const locations = await fetchPosLocations(system.baseUrl, system.token);
        const stores = locations
          .filter(isTransferStore)
          .map((location) => mapLocation(location, system))
          .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

        return {
          key: system.key,
          label: system.label,
          stores,
          error: '',
        };
      } catch (error) {
        return {
          key: system.key,
          label: system.label,
          stores: [],
          error: error?.message || `Failed to load stores (${system.label}).`,
        };
      }
    }),
  );

  const stores = groups
    .flatMap((group) => group.stores)
    .sort((a, b) => {
      const byName = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      if (byName !== 0) return byName;
      return a.systemLabel.localeCompare(b.systemLabel, undefined, { sensitivity: 'base' });
    });

  const warning = groups
    .map((group) => group.error)
    .filter(Boolean)
    .join(' ');

  return { stores, groups, warning };
}
