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
export function canonicalStoreName(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
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

export function storesMatch(left, right) {
  const a = canonicalStoreName(left);
  const b = canonicalStoreName(right);
  if (!a || !b) return false;
  return a.localeCompare(b, undefined, { sensitivity: 'base' }) === 0;
}
