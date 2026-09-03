import { API_BASE_URL, authHeaders, getLinkedPosSessions, LINKED_POS_SYSTEMS } from './auth';

function getErrorMessage(payload, fallback) {
  return payload?.error?.message || payload?.message || fallback;
}

/**
 * East plus every linked POS system. Linked tokens are issued by the sign-in
 * service at login; a system without a token is reported, never re-logged
 * from the client.
 */
function posSystemsForTransfer(session) {
  const systems = [];

  if (session?.token) {
    systems.push({
      key: 'east',
      label: 'Canada Gold East',
      baseUrl: session.baseUrl || API_BASE_URL,
      token: session.token,
    });
  }

  const linked = getLinkedPosSessions(session);
  for (const system of LINKED_POS_SYSTEMS) {
    const entry = linked.find((item) => item.key === system.key);
    systems.push({
      key: system.key,
      label: entry?.label || system.label,
      baseUrl: entry?.baseUrl || system.baseUrl,
      token: entry?.token || '',
      error: entry?.error || '',
    });
  }

  return systems;
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

export async function fetchPosLocations(baseUrl, token) {
  const response = await fetch(`${baseUrl}/settings/locations`, {
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
