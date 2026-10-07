/**
 * Canonical retail stores on Home, plus HR / Google / POS name aliases.
 * GTA cash-till pins stay in HOME_STORES; this list is the full homepage set.
 */

function normalizeKey(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/** Stores always shown on Home, including branches with no East/GTA/PMX POS. */
export const HOME_PINNED_STORES = [
  'Hamilton',
  'Mississauga',
  'Toronto',
  'Richmond Hill',
  'Montreal',
  'Quebec',
  'Laval',
  'Calgary North',
  'Calgary South',
  'Calgary SW',
  'Edmonton',
  'Edmonton West',
  'Halifax',
  'Carlingwood',
  'Gloucester',
  'Surrey',
  'Vancouver',
  'Winnipeg',
  'Canadian Coin & Currency',
  'Portland',
  'Seattle',
];

const STORE_ALIASES = {
  'abbotsford': 'Abbotsford',
  'retail - abbotsford': 'Abbotsford',
  'calgary north': 'Calgary North',
  'calgary nw': 'Calgary North',
  'calgary north-west': 'Calgary North',
  'calgary northwest': 'Calgary North',
  'old calgary nw': 'Calgary North',
  'old calgary north west': 'Calgary North',
  'calgary - new north-west': 'Calgary North',
  'calgary - new nw': 'Calgary North',
  'canada gold - calgary nw': 'Calgary North',
  'canada gold calgary nw': 'Calgary North',
  'retail - calgary - new north-west': 'Calgary North',
  'retail - old calgary nw': 'Calgary North',
  'calgary south': 'Calgary South',
  'calgary south trail': 'Calgary South',
  'calgary - south trail': 'Calgary South',
  'south trail': 'Calgary South',
  'retail - calgary - south trail': 'Calgary South',
  'calgary sw': 'Calgary SW',
  'calgary south-west': 'Calgary SW',
  'calgary southwest': 'Calgary SW',
  'calgary south west': 'Calgary SW',
  'canada gold - calgary sw': 'Calgary SW',
  'canada gold calgary sw': 'Calgary SW',
  'retail - calgary sw': 'Calgary SW',
  'edmonton': 'Edmonton',
  'edmonton south': 'Edmonton',
  'canada gold - edmonton south': 'Edmonton',
  'edmonton east': 'Edmonton',
  'edmonton - north west': 'Edmonton',
  'edmonton north west': 'Edmonton',
  'edmonton nw': 'Edmonton',
  'canada gold - edmonton': 'Edmonton',
  'canada gold edmonton': 'Edmonton',
  'retail - edmonton - north west': 'Edmonton',
  'edmonton west': 'Edmonton West',
  'retail - edmonton west': 'Edmonton West',
  'halifax': 'Halifax',
  'canada gold - halifax': 'Halifax',
  'canada gold halifax': 'Halifax',
  'retail - halifax': 'Halifax',
  'hamilton': 'Hamilton',
  'canada gold - hamilton': 'Hamilton',
  'canada gold hamilton': 'Hamilton',
  'retail - hamilton': 'Hamilton',
  'laval': 'Laval',
  'canada or - laval': 'Laval',
  'canada gold laval': 'Laval',
  'retail - laval': 'Laval',
  'mississauga': 'Mississauga',
  'canada gold - mississauga': 'Mississauga',
  'retail - mississauga': 'Mississauga',
  'montreal': 'Montreal',
  'canada or - montreal (canada gold)': 'Montreal',
  'canada or montreal': 'Montreal',
  'canada gold montreal': 'Montreal',
  'retail - montreal': 'Montreal',
  'ottawa west': 'Carlingwood',
  'canada gold - ottawa west': 'Carlingwood',
  'canada gold ottawa west': 'Carlingwood',
  'retail - ottawa west': 'Carlingwood',
  'retail - ottawa carlingwood': 'Carlingwood',
  'carlingwood': 'Carlingwood',
  'ottawa east': 'Gloucester',
  'canada gold - ottawa east': 'Gloucester',
  'canada gold ottawa east': 'Gloucester',
  'retail - ottawa east': 'Gloucester',
  'retail - ottawa gloucester': 'Gloucester',
  'gloucester': 'Gloucester',
  'gloucester centre': 'Gloucester',
  'quebec': 'Quebec',
  'quebec city': 'Quebec',
  'ville de quebec': 'Quebec',
  'canada or - ville de quebec': 'Quebec',
  'canada gold quebec': 'Quebec',
  'retail - quebec city': 'Quebec',
  'surrey': 'Surrey',
  'retail - surrey': 'Surrey',
  'toronto': 'Toronto',
  'canada gold - toronto': 'Toronto',
  'retail - toronto': 'Toronto',
  'vancouver': 'Vancouver',
  'retail - vancouver': 'Vancouver',
  'winnipeg': 'Winnipeg',
  'retail - winnipeg': 'Winnipeg',
  'richmond hill': 'Richmond Hill',
  'canadian pmx': 'Richmond Hill',
  'canadian pmx - richmond hill': 'Richmond Hill',
  'retail - richmond hill': 'Richmond Hill',
  'canadian coin & currency': 'Canadian Coin & Currency',
  'canadian coin and currency': 'Canadian Coin & Currency',
  'richmond hill (office)': 'Canadian Coin & Currency',
  'portland': 'Portland',
  'portland gold exchange': 'Portland',
  'seattle': 'Seattle',
  'seattle gold': 'Seattle',
};

/** Homepage / HR store name, or the trimmed original when unknown. */
function resolveCanonicalStoreName(raw) {
  const key = normalizeKey(raw);
  if (STORE_ALIASES[key]) return STORE_ALIASES[key];
  const stripped = key
    .replace(/^retail\s+-\s+/, '')
    .replace(/^canada gold\s+-?\s*/, '')
    .replace(/^canada or\s+-?\s*/, '');
  if (STORE_ALIASES[stripped]) return STORE_ALIASES[stripped];
  const exact = HOME_PINNED_STORES.find((name) => normalizeKey(name) === key || normalizeKey(name) === stripped);
  if (exact) return exact;
  if (STORE_ALIASES[key.replace(/\s+$/, '')]) return STORE_ALIASES[key.replace(/\s+$/, '')];
  return raw;
}

// Store names come from a small fixed set (POS, HR, Google) but are matched
// on every PO in every triage pass, so the normalisation is cached.
const CANONICAL_CACHE = new Map();
const CANONICAL_CACHE_LIMIT = 4000;

export function canonicalStoreName(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const cached = CANONICAL_CACHE.get(raw);
  if (cached !== undefined) return cached;
  const resolved = resolveCanonicalStoreName(raw);
  if (CANONICAL_CACHE.size >= CANONICAL_CACHE_LIMIT) CANONICAL_CACHE.clear();
  CANONICAL_CACHE.set(raw, resolved);
  return resolved;
}

export function storesMatch(left, right) {
  const a = canonicalStoreName(left);
  const b = canonicalStoreName(right);
  if (!a || !b) return false;
  if (a === b) return true;
  return a.localeCompare(b, undefined, { sensitivity: 'base' }) === 0;
}

/**
 * Triage Stores picker groups. Named stores stay on their region;
 * everything else is West (Calgary / Edmonton / Vancouver / Winnipeg /
 * CCC / US, plus unknowns).
 */
export const STORE_REGIONS = [
  { key: 'ottawa', label: 'Ottawa', stores: ['Carlingwood', 'Gloucester'] },
  { key: 'quebec', label: 'Quebec', stores: ['Montreal', 'Laval', 'Quebec'] },
  { key: 'halifax', label: 'Halifax', stores: ['Halifax'] },
  { key: 'gta', label: 'GTA', stores: ['Toronto', 'Mississauga', 'Hamilton'] },
  { key: 'pmx', label: 'PMX', stores: ['Richmond Hill'] },
  { key: 'west', label: 'West', stores: [] },
];

export const DEFAULT_STORE_REGION = 'west';

const NAMED_REGION_BY_STORE = (() => {
  const map = new Map();
  for (const region of STORE_REGIONS) {
    if (region.key === 'west') continue;
    for (const store of region.stores) {
      map.set(canonicalStoreName(store), region.key);
    }
  }
  return map;
})();

export function regionKeyForStore(value) {
  const name = canonicalStoreName(value);
  if (!name) return DEFAULT_STORE_REGION;
  return NAMED_REGION_BY_STORE.get(name) || DEFAULT_STORE_REGION;
}

export function storeRegionOf(value) {
  const key = regionKeyForStore(value);
  return STORE_REGIONS.find((region) => region.key === key) || STORE_REGIONS[STORE_REGIONS.length - 1];
}

export function storeRegionByKey(key) {
  return STORE_REGIONS.find((region) => region.key === key) || null;
}

const REGION_MARK_COLORS = {
  ottawa: '#B91C1C',
  quebec: '#0F766E',
  halifax: '#1D4ED8',
  gta: '#2F8A4E',
  pmx: '#6B4DE6',
  west: '#C2410C',
};

export function regionMarkColor(key) {
  return REGION_MARK_COLORS[key] || '#8E8E93';
}

export function storeNameInRegion(name, regionKey) {
  if (!regionKey) return true;
  return regionKeyForStore(name) === regionKey;
}

/** Named stores for a region; West is every pinned store that is not named above. */
export function pinnedStoresForRegion(regionKey) {
  const region = storeRegionByKey(regionKey);
  if (!region) return [];
  if (region.key === 'west') {
    return HOME_PINNED_STORES.filter((name) => regionKeyForStore(name) === 'west');
  }
  return region.stores.slice();
}

function regionStoreRank(region, name) {
  if (region.key === 'west') {
    const pinned = HOME_PINNED_STORES.findIndex((store) => storesMatch(store, name));
    return pinned >= 0 ? pinned : HOME_PINNED_STORES.length;
  }
  const listed = region.stores.findIndex((store) => storesMatch(store, name));
  return listed >= 0 ? listed : region.stores.length;
}

/** Sort names the way that region's stores should appear. */
export function sortStoresInRegion(names, regionKey) {
  const region = STORE_REGIONS.find((entry) => entry.key === regionKey) || storeRegionOf('');
  return [...(names || [])].sort((left, right) => {
    const rank = regionStoreRank(region, left) - regionStoreRank(region, right);
    if (rank) return rank;
    return String(left || '').localeCompare(String(right || ''), undefined, { sensitivity: 'base' });
  });
}

export function filterStoresByRegion(stores, regionKey) {
  const list = Array.isArray(stores) ? stores : [];
  const key = regionKey || DEFAULT_STORE_REGION;
  const matched = list.filter((row) => regionKeyForStore(row?.store || row) === key);
  const names = sortStoresInRegion(
    matched.map((row) => row?.store || row),
    key,
  );
  const byName = new Map(matched.map((row) => [canonicalStoreName(row?.store || row), row]));
  return names.map((name) => byName.get(canonicalStoreName(name))).filter(Boolean);
}

/** Region groups with stores present in `stores`, empty regions omitted. */
export function groupStoresByRegion(stores) {
  return STORE_REGIONS.map((region) => ({
    key: region.key,
    label: region.label,
    stores: filterStoresByRegion(stores, region.key),
  })).filter((region) => region.stores.length);
}
