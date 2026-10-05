/**
 * Google Review & Email Bonus Policy (effective Aug 1, 2026).
 */

import { BONUS_ACCESS_DENIED, canViewBonusReviewData } from './auth';
import { bonusRosterCountByStore, listBonusRoster } from './bonusRoster';
import {
  findStaffByEmployeeName,
  hasFullAppAccess,
  normalizeAppRole,
  staffDisplayName,
} from './permissions';
import {
  buildEmailCaptureByStore,
  formatDateParam,
  isExcludedCustomerName,
  parseDateParam,
} from './transactions';
import { canonicalStoreName } from './storeCatalog';
import {
  fetchGoogleReviewsForStore,
  filterReviewsByDateRange,
  googleReviewPermalink,
  googleStoreBrand,
  GOOGLE_STORE_PLACES,
  getGooglePlaceForStore,
  peekCachedGoogleReviews,
  reviewMonthRange,
  reviewPeriodLabel,
  currentReviewMonth,
} from './googleReviews';

export const PHOTO_BONUS = 10;

/** Non-retail / internal locations hidden from the Bonuses store filter. */
export const BONUS_EXCLUDED_STORES = [
  'storage',
  'umicore',
  'workshop',
  'rcm pooled ounces',
  'in transit',
  'westgate',
  'pmx',
  '3rd party',
];

export function isBonusExcludedStore(storeName) {
  const key = String(storeName || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  if (!key) return true;
  // Never hide a configured Google retail store (e.g. Richmond Hill / Canadian PMX).
  if (getGooglePlaceForStore(key)) return false;
  return BONUS_EXCLUDED_STORES.some((name) => {
    if (name.length <= 3) return key === name || key.split(/\s+/).includes(name);
    return key === name || key.includes(name);
  });
}

export const EMAIL_BONUS_TIERS = [
  { id: 'lt50', min: 0, max: 50, base: 15, label: '<50%' },
  { id: '50-60', min: 50, max: 60, base: 20, label: '50–60%' },
  { id: '60-70', min: 60, max: 70, base: 25, label: '60–70%' },
  { id: '70-80', min: 70, max: 80, base: 30, label: '70–80%' },
  { id: 'gt80', min: 80, max: Infinity, base: 35, label: '>80%' },
];

/** Columns of the payout matrix (negative-review adjustment). */
export const NEGATIVE_COLUMNS = [
  { id: 'twoPlus', label: '2+ negative', adjustment: -15, maxNegatives: Infinity, minNegatives: 2 },
  { id: 'one', label: '1 negative', adjustment: 0, maxNegatives: 1, minNegatives: 1 },
  { id: 'none', label: 'No negative', adjustment: 15, maxNegatives: 0, minNegatives: 0 },
];

export function monthRange(year, monthIndex) {
  return reviewMonthRange(year, monthIndex);
}

export function currentBonusMonth() {
  return currentReviewMonth();
}

export function canonicalBonusStoreName(storeName) {
  const place = getGooglePlaceForStore(storeName);
  if (place) return place.storeName;
  return canonicalStoreName(storeName);
}

const BONUS_ALL_COUNTS_ROLES = new Set([
  'branch_manager',
  'general_manager',
  'system_admin',
  'hr',
]);

function isPosEmployee(profile) {
  const raw = String(profile?.employeeType || profile?.role || '')
    .trim()
    .toLowerCase();
  return raw === 'employee';
}

/** PMA and POS employees only see their own payouts. Managers and other roles see everyone. */
export function canViewAllBonusCounts(profile) {
  if (hasFullAppAccess(profile)) return true;
  const role = normalizeAppRole(profile?.appRole);
  if (BONUS_ALL_COUNTS_ROLES.has(role)) return true;
  if (role === 'precious_metal_analyst') return false;
  if (isPosEmployee(profile)) return false;
  return true;
}

export function bonusViewerMatchesEmployee(employeeName, profile) {
  const name = String(employeeName || '').trim();
  if (!profile || !name || name === '—' || /^unassigned$/i.test(name)) return false;
  if (findStaffByEmployeeName([profile], name)) return true;
  const display = String(
    profile.fullName ||
      [profile.firstName, profile.lastName].filter(Boolean).join(' ') ||
      profile.aureusLogin ||
      '',
  ).trim();
  if (!display) return false;
  return peopleLikelySame(
    { first: firstName(name), last: lastName(name) },
    { first: firstName(display), last: lastName(display) || lastName(profile.lastName) },
  );
}

function ownReview(review, profile) {
  const names = [
    ...(review?.attributedEmployees || []),
    ...(review?.namedEmployees || []),
  ];
  return names.some((name) => bonusViewerMatchesEmployee(name, profile));
}

export function restrictStoreBonusToViewer(store, profile) {
  if (!store) return store;
  const employees = (store.employees || []).filter(
    (row) =>
      !/^unassigned$/i.test(row.employeeName) &&
      bonusViewerMatchesEmployee(row.employeeName, profile),
  );
  const reviews = (store.reviews || []).filter((review) => ownReview(review, profile));
  const eligible = reviews.filter((review) => review.eligible);
  const mine = employees.reduce(
    (acc, row) => ({
      eligibleCount: acc.eligibleCount + (Number(row.eligibleCount) || 0),
      photoCount: acc.photoCount + (Number(row.photoCount) || 0),
      reviewBonus: acc.reviewBonus + (Number(row.reviewBonus) || 0),
      photoBonus: acc.photoBonus + (Number(row.photoBonus) || 0),
      total: acc.total + (Number(row.total) || 0),
    }),
    { eligibleCount: 0, photoCount: 0, reviewBonus: 0, photoBonus: 0, total: 0 },
  );
  const round2 = (value) => Math.round(value * 100) / 100;
  return {
    ...store,
    employees,
    reviews,
    eligibleCount: round2(mine.eligibleCount),
    photoReviewCount: round2(mine.photoCount),
    fiveStarCount: reviews.filter((review) => review.rating === 5).length,
    transactionAttributedCount: eligible.filter(
      (review) => review.attributionSource === 'transaction',
    ).length,
    ineligibleFiveStarCount: reviews.filter((review) => review.rating === 5 && !review.eligible)
      .length,
    reviewBonusTotal: round2(mine.reviewBonus),
    photoBonusTotal: round2(mine.photoBonus),
    totalPayout: round2(mine.total),
    selfOnly: true,
  };
}

export function restrictBonusBoardToViewer(board, profile) {
  if (!board) return board;
  if (canViewAllBonusCounts(profile)) return board;
  return {
    ...board,
    stores: (board.stores || []).map((store) => restrictStoreBonusToViewer(store, profile)),
    selfOnly: true,
  };
}

function emptyEmailRow(storeName) {
  return {
    store: storeName,
    customerCount: 0,
    walkInCount: 0,
    totalTransactions: 0,
    withEmail: 0,
    rate: 0,
    rateLabel: '0.0%',
    people: [],
  };
}

function mergeEmailRows(left, right, storeName) {
  const customerCount = (left.customerCount || 0) + (right.customerCount || 0);
  const withEmail = (left.withEmail || 0) + (right.withEmail || 0);
  const walkInCount = (left.walkInCount || 0) + (right.walkInCount || 0);
  const rate = customerCount > 0 ? (withEmail / customerCount) * 100 : 0;
  return {
    store: storeName,
    customerCount,
    walkInCount,
    totalTransactions: customerCount + walkInCount,
    withEmail,
    rate,
    rateLabel: `${rate.toFixed(1)}%`,
    people: [...(left.people || []), ...(right.people || [])],
  };
}

export function emailTierForRate(rate) {
  const value = Number(rate) || 0;
  for (const tier of EMAIL_BONUS_TIERS) {
    if (value >= tier.min && value < tier.max) return tier;
    if (tier.max === Infinity && value >= tier.min) return tier;
  }
  return EMAIL_BONUS_TIERS[0];
}

export function negativeColumnForCount(count) {
  const n = Number(count) || 0;
  if (n <= 0) return NEGATIVE_COLUMNS[2];
  if (n === 1) return NEGATIVE_COLUMNS[1];
  return NEGATIVE_COLUMNS[0];
}

export function bonusPerReview(emailRate, negativeCount) {
  const tier = emailTierForRate(emailRate);
  const column = negativeColumnForCount(negativeCount);
  const amount = Math.max(0, tier.base + column.adjustment);
  return {
    amount,
    base: tier.base,
    adjustment: column.adjustment,
    tier,
    column,
  };
}

export function payoutMatrix() {
  return EMAIL_BONUS_TIERS.map((tier) => ({
    tier,
    cells: NEGATIVE_COLUMNS.map((column) => ({
      column,
      amount: Math.max(0, tier.base + column.adjustment),
    })),
  }));
}

function normalizePersonToken(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function firstName(fullName) {
  const parts = normalizePersonToken(fullName).split(' ').filter(Boolean);
  return parts[0] || '';
}

function lastName(fullName) {
  const parts = normalizePersonToken(fullName).split(' ').filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 1] : '';
}

function editDistance(left, right) {
  const a = String(left || '');
  const b = String(right || '');
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  if (Math.abs(a.length - b.length) > 2) return 99;
  const prev = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) prev[j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const next = prev[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + cost);
      diag = next;
    }
  }
  return prev[b.length];
}

function nameSegments(value) {
  return normalizePersonToken(value)
    .split(/[-\s]+/)
    .filter((part) => part.length >= 3 && !NAME_STOPWORDS.has(part));
}

const GIVEN_NAME_NICKNAMES = {
  abigail: ['abby'],
  abygael: ['abby'],
  alexander: ['alex'],
  alexandra: ['alex', 'alexa'],
  alexandre: ['alex'],
  alyssa: ['lyssa'],
  anastasia: ['ana', 'stacy'],
  andrea: ['angie', 'andi'],
  ashleigh: ['ash'],
  ashley: ['ash'],
  catherine: ['cate', 'cathy', 'kate'],
  daniel: ['dan', 'danny'],
  domenic: ['dom'],
  dominic: ['dom'],
  elizabeth: ['liz', 'beth'],
  jennifer: ['jen', 'jenny'],
  jessica: ['jess'],
  jonathan: ['jon'],
  joseph: ['joe'],
  joshua: ['josh'],
  jasmine: ['jas', 'jaz'],
  katharine: ['kate', 'kathy'],
  katherine: ['kate', 'kathy'],
  kayla: ['kay'],
  kayleigh: ['kay'],
  meagan: ['meg', 'megan'],
  megan: ['meg'],
  michael: ['mike'],
  nicholas: ['nick', 'niko'],
  nikolas: ['nick', 'niko'],
  reginald: ['reggie', 'reg'],
  robert: ['rob', 'bob'],
  samuel: ['sam'],
  samantha: ['sam', 'sammy'],
  valerie: ['val'],
  victoria: ['vicky', 'vic'],
  william: ['will'],
  yasmine: ['yas', 'jas'],
};

function nicknamesForGivenName(value) {
  const found = new Set();
  for (const part of nameSegments(value)) {
    for (const nick of GIVEN_NAME_NICKNAMES[part] || []) found.add(nick);
    for (const [canonical, nicks] of Object.entries(GIVEN_NAME_NICKNAMES)) {
      if (nicks.includes(part)) found.add(canonical);
    }
  }
  return Array.from(found);
}

function firstNamesLikelySame(left, right) {
  const a = normalizePersonToken(left);
  const b = normalizePersonToken(right);
  if (!a || !b) return false;
  if (a === b) return true;
  const aParts = nameSegments(a);
  const bParts = nameSegments(b);
  if (aParts.some((part) => bParts.includes(part))) return true;
  if (aParts.includes(b) || bParts.includes(a)) return true;
  const aNicks = new Set([...aParts, ...nicknamesForGivenName(a)]);
  const bNicks = new Set([...bParts, ...nicknamesForGivenName(b)]);
  if ([...aNicks].some((part) => bNicks.has(part))) return true;
  if (a[0] !== b[0]) return false;
  const dist = editDistance(a.replace(/-/g, ''), b.replace(/-/g, ''));
  const min = Math.min(a.length, b.length);
  if (dist <= 1 && min >= 4) return true;
  if (dist <= 2 && min >= 6) return true;
  return false;
}

function lastNamesCompatible(left, right) {
  const a = normalizePersonToken(left);
  const b = normalizePersonToken(right);
  if (!a || !b) return true;
  if (a === b) return true;
  if (a.length === 1 && b.startsWith(a)) return true;
  if (b.length === 1 && a.startsWith(b)) return true;
  if (a.length >= 3 && b.length >= 3 && (a.startsWith(b) || b.startsWith(a))) return true;
  if (a.length >= 4 && b.length >= 4 && a.slice(0, 2) === b.slice(0, 2) && editDistance(a, b) <= 3) {
    return true;
  }
  return false;
}

function lastNamesConflict(left, right) {
  const a = normalizePersonToken(left);
  const b = normalizePersonToken(right);
  if (!a || !b) return false;
  return !lastNamesCompatible(a, b);
}

/**
 * "Laura Lyne" parsed as first=laura / last=lyne is still Laura-Lyne Beaudoin:
 * when one side's "last name" is just a segment of the other's compound first
 * name, the last names do not really conflict.
 */
function lastIsPartOfCompoundFirst(last, person) {
  const l = normalizePersonToken(last);
  if (!l) return false;
  const surname = normalizePersonToken(person?.last || '');
  const given = nameSegments(person?.key || person?.name || person?.first || '').filter(
    (seg) => seg !== surname,
  );
  return given.includes(l) || nameSegments(person?.first || '').includes(l);
}

/** "Brant Michael" is the same person as "Brant Michael Fernandez". */
function nameIsPrefixOf(left, right) {
  const a = normalizePersonToken(left?.key || left?.name || '');
  const b = normalizePersonToken(right?.key || right?.name || '');
  if (!a || !b || a === b) return false;
  return b.startsWith(`${a} `) || a.startsWith(`${b} `);
}

function peopleLikelySame(left, right) {
  if (!left || !right) return false;
  if (nameIsPrefixOf(left, right)) return true;
  if (!firstNamesLikelySame(left.first, right.first)) return false;
  if (
    lastNamesConflict(left.last, right.last) &&
    !lastIsPartOfCompoundFirst(left.last, right) &&
    !lastIsPartOfCompoundFirst(right.last, left)
  ) {
    return false;
  }
  return true;
}

function addAlias(person, value) {
  const alias = String(value || '').trim();
  const norm = normalizePersonToken(alias);
  if (!alias || !norm || NAME_STOPWORDS.has(norm)) return;
  if (!person.aliases) person.aliases = [];
  if (person.aliases.some((item) => normalizePersonToken(item) === norm)) return;
  person.aliases.push(alias);
}

/** Segments of a name that belong to the surname, not the given name. */
function isSurnameSegment(segment, person) {
  const last = normalizePersonToken(person?.last || '');
  if (!last) return false;
  if (segment === last) return true;
  // "thoby" for last "thoby-timothee"; "moore" vs "more" style near-dupes.
  return segment.length >= 3 && lastNamesCompatible(segment, last) && last.includes(segment);
}

/**
 * Add the short forms people actually write in reviews: each segment of a
 * compound first name (Laura-Lyne → Laura, Lyne; Marie Therese → Marie),
 * parenthetical nicknames (Andrea (Angie) → Angie), and known nicknames
 * (Alexandre → Alex). Surname segments are deliberately excluded so "More"
 * or "Moore" in a sentence never reads as a first-name mention.
 */
function expandPersonAliases(person) {
  if (!person) return person;
  addAlias(person, person.first);
  addAlias(person, String(person.first || '').replace(/-/g, ' '));
  addAlias(person, String(person.name || '').replace(/-/g, ' '));
  const seeds = [person.first, ...(person.aliases || [])];
  for (const seed of seeds) {
    for (const part of nameSegments(seed)) {
      if (!isSurnameSegment(part, person)) addAlias(person, part);
    }
    for (const nick of nicknamesForGivenName(seed)) addAlias(person, nick);
  }
  return person;
}

/** Given-name segments a review word may fuzzy-match (typos like Eric → Erich). */
function fuzzyGivenNameTokens(person) {
  const out = new Set();
  const seeds = [person.first, ...(person.aliases || [])];
  for (const seed of seeds) {
    const norm = normalizePersonToken(seed);
    // Skip aliases that contain the surname ("Katharine Marisa"); their given
    // part is covered by person.first / shorter aliases already.
    if (norm.includes(' ') && nameSegments(norm).some((seg) => isSurnameSegment(seg, person))) {
      const given = nameSegments(norm).filter((seg) => !isSurnameSegment(seg, person));
      for (const seg of given) if (seg.length >= 4) out.add(seg);
      continue;
    }
    for (const seg of nameSegments(norm)) {
      if (seg.length >= 4 && !isSurnameSegment(seg, person) && !isKnownNickname(seg)) out.add(seg);
    }
  }
  return Array.from(out);
}

function isKnownNickname(value) {
  return Object.values(GIVEN_NAME_NICKNAMES).some((nicks) => nicks.includes(value));
}

/** Build searchable employee tokens from POS names. */
export function buildEmployeeDirectory(employeeNames, source = 'pos') {
  const directory = [];
  const seen = new Set();
  for (const name of employeeNames || []) {
    const full = String(name || '').trim();
    if (!full || full === '—') continue;
    const key = normalizePersonToken(full);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const first = firstName(full);
    const last = lastName(full);
    directory.push(
      expandPersonAliases({
        name: full,
        key,
        first,
        last,
        source,
        aliases: first && first !== key ? [first] : [],
      }),
    );
  }
  return directory;
}

function staffNamesFromProfiles(orgEmployees) {
  const names = [];
  for (const person of orgEmployees || []) {
    const display = staffDisplayName(person);
    if (display) names.push(display);
    const full = String(person?.fullName || '').trim();
    if (full && full !== display) names.push(full);
    const firstLast = [person?.firstName, person?.lastName].filter(Boolean).join(' ').trim();
    if (firstLast && firstLast !== display && firstLast !== full) names.push(firstLast);
    const login = String(person?.aureusLogin || '').trim();
    if (login) names.push(login);
    for (const alias of person?.aliases || []) {
      const value = String(alias || '').trim();
      if (value) names.push(value);
    }
  }
  return names;
}

function findBonusRosterPerson(roster, name) {
  const trimmed = String(name || '').trim();
  if (!trimmed || trimmed === '—' || /^unassigned$/i.test(trimmed)) return null;
  const list = roster || [];
  if (!list.length) return null;

  const staff = findStaffByEmployeeName(list, trimmed);
  if (staff) return staff;

  const query = {
    first: firstName(trimmed),
    last: lastName(trimmed),
  };
  if (!query.first) return null;

  const likely = list.filter((person) =>
    peopleLikelySame(query, {
      first: firstName(staffDisplayName(person) || person.fullName || person.firstName),
      last: lastName(person.lastName || staffDisplayName(person) || person.fullName),
    }),
  );
  if (likely.length === 1) return likely[0];

  if (!query.last) {
    const firstOnly = list.filter((person) =>
      firstNamesLikelySame(query.first, person.firstName) ||
      (person.aliases || []).some((alias) => firstNamesLikelySame(query.first, firstName(alias))),
    );
    if (firstOnly.length === 1) return firstOnly[0];
  }
  return likely[0] || null;
}

/** True when the name is a PMA / manager on this store’s HR roster. */
function isOrgEmployeeName(name, orgEmployees) {
  return Boolean(findBonusRosterPerson(orgEmployees, name));
}

function canonicalOrgEmployeeName(name, directory, orgEmployees) {
  const staff = findBonusRosterPerson(orgEmployees || [], name);
  if (staff) return staffDisplayName(staff) || canonicalEmployeeName(name, directory);
  return canonicalEmployeeName(name, directory);
}

/** Which Aureus host owns each bonus store’s employee directory. */
export const BONUS_STORE_POS_SYSTEM = {
  Laval: 'east',
  Montreal: 'east',
  Quebec: 'east',
  Carlingwood: 'east',
  Gloucester: 'east',
  Halifax: 'east',
  Hamilton: 'gta',
  Mississauga: 'gta',
  Toronto: 'gta',
  'Richmond Hill': 'pmx',
  'Calgary North': 'east',
  'Calgary South': 'east',
  'Calgary SW': 'east',
  Edmonton: 'east',
  'Edmonton West': 'east',
  Surrey: 'east',
  Vancouver: 'east',
  Winnipeg: 'east',
  'Canadian Coin & Currency': 'pmx',
  Portland: 'east',
  Seattle: 'east',
};

export function posSystemForBonusStore(storeName) {
  const name = canonicalBonusStoreName(storeName) || String(storeName || '').trim();
  return BONUS_STORE_POS_SYSTEM[name] || 'east';
}

/** PMA / branch managers assigned to this retail store on the HR roster. */
export function orgEmployeesForBonusStore(orgEmployees, storeName) {
  const name = canonicalBonusStoreName(storeName) || String(storeName || '').trim();
  if (!name) return [];
  const fromHr = listBonusRoster().filter(
    (row) => canonicalBonusStoreName(row.locationName) === name,
  );
  if (fromHr.length) return fromHr;
  return (orgEmployees || []).filter((row) => {
    const location = canonicalBonusStoreName(row.locationName || row.storeName || '');
    return location === name;
  });
}

/** HR store roster is the bonus employee directory — no POS token fetch. */
export function loadBonusRoster() {
  const out = listBonusRoster();
  out.errors = [];
  out.notes = [];
  out.sourceBySystem = { hr: 'hr' };
  out.systemsLoaded = ['hr'];
  out.systemsMissing = [];
  out.bySystem = bonusRosterCountByStore();
  return out;
}

/** Merge Brock / Brock Z. / Brock Zaman (and Piyush / Piyosh) into one directory person. */
export function collapseEmployeeDirectory(directory) {
  const ordered = [...(directory || [])].sort((a, b) => {
    const aPos = a.source === 'mention' ? 1 : 0;
    const bPos = b.source === 'mention' ? 1 : 0;
    if (aPos !== bPos) return aPos - bPos;
    return b.key.length - a.key.length || a.name.localeCompare(b.name);
  });
  const kept = [];
  for (const person of ordered) {
    const host = kept.find((row) => peopleLikelySame(person, row));
    if (!host) {
      kept.push({
        ...person,
        aliases: [...(person.aliases || [])],
      });
      continue;
    }
    addAlias(host, person.name);
    addAlias(host, person.first);
    for (const alias of person.aliases || []) addAlias(host, alias);
    const preferIncoming =
      (person.source !== 'mention' && host.source === 'mention') ||
      (person.source === host.source && person.key.length > host.key.length);
    if (preferIncoming) {
      host.name = person.name;
      host.key = person.key;
      if (person.last) host.last = person.last;
    }
    if (person.source !== 'mention') host.source = person.source || 'pos';
    if (person.last && person.last.length > (host.last || '').length) host.last = person.last;
    expandPersonAliases(host);
  }
  return kept.map(expandPersonAliases);
}

export function resolveDirectoryPerson(name, directory) {
  const raw = String(name || '').trim();
  if (!raw || raw === '—' || /^unassigned$/i.test(raw)) return null;
  const query = {
    name: raw,
    key: normalizePersonToken(raw),
    first: firstName(raw),
    last: lastName(raw),
  };
  if (!query.first) return null;

  const pool = directory || [];
  const exact = pool.find((person) => person.key === query.key);
  if (exact) return exact;

  const hits = pool.filter((person) => peopleLikelySame(query, person));
  if (!hits.length) return null;
  if (hits.length === 1) return hits[0];

  const withLast = query.last
    ? hits.filter((person) => lastNamesCompatible(query.last, person.last) && person.last)
    : [];
  if (withLast.length === 1) return withLast[0];

  const posHits = hits.filter((person) => person.source !== 'mention');
  if (posHits.length === 1) return posHits[0];

  const longest = [...hits].sort((a, b) => b.key.length - a.key.length);
  if (!query.last && new Set(hits.map((person) => person.last || person.key)).size > 1) {
    return null;
  }
  return longest[0];
}

export function canonicalEmployeeName(name, directory) {
  return resolveDirectoryPerson(name, directory)?.name || String(name || '').trim();
}

function posEmployeeNamesForStore(transactionRows, employeesByStore, storeName) {
  const name = canonicalBonusStoreName(storeName) || String(storeName || '').trim();
  const names = [];
  const fromMap = employeesByStore && name ? employeesByStore.get(name) : null;
  if (fromMap) names.push(...fromMap);
  for (const row of transactionRows || []) {
    const txStore = transactionStoreName(row);
    if (txStore && !storeNamesMatch(txStore, name)) continue;
    if (!txStore) continue;
    const emp = String(row.employeeName || '').trim();
    if (emp && emp !== '—') names.push(emp);
  }
  return names;
}

function buildBonusDirectory(transactionRows, employeesByStore, storeName, orgEmployees) {
  const name = canonicalBonusStoreName(storeName) || String(storeName || '').trim();
  const storeRoster = orgEmployeesForBonusStore(orgEmployees, name);
  if (!storeRoster.length) return [];
  const staffDirectory = collapseEmployeeDirectory(
    buildEmployeeDirectory(staffNamesFromProfiles(storeRoster), 'staff'),
  );
  const posNames = posEmployeeNamesForStore(transactionRows, employeesByStore, name);
  const posOnRoster = collapseEmployeeDirectory(buildEmployeeDirectory(posNames, 'pos')).filter(
    (person) => findBonusRosterPerson(storeRoster, person.name),
  );
  return collapseEmployeeDirectory([...staffDirectory, ...posOnRoster]);
}

/**
 * Reviews that list only an employee name (no experience text) are ineligible.
 * Empty 5-star reviews are eligible.
 */
export function isNameOnlyReview(text, namedEmployees) {
  const raw = String(text || '').trim();
  if (!raw) return false;

  let remainder = normalizePersonToken(raw);
  const names = (namedEmployees || [])
    .flatMap((emp) => [emp.name, emp.first, ...(emp.aliases || [])])
    .map(normalizePersonToken)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);

  for (const name of names) {
    remainder = remainder.split(name).join(' ');
  }

  remainder = remainder
    .replace(/\b(and|&|with|thanks|thank you|great|awesome|amazing|service|staff|team)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Only names / filler left, or extremely short leftover.
  if (!remainder) return true;
  if (remainder.length <= 2 && names.length > 0) return true;
  return false;
}

const NAME_STOPWORDS = new Set([
  'the',
  'and',
  'with',
  'from',
  'this',
  'that',
  'they',
  'them',
  'were',
  'was',
  'have',
  'has',
  'had',
  'very',
  'great',
  'good',
  'best',
  'thank',
  'thanks',
  'canada',
  'gold',
  'laval',
  'montreal',
  'quebec',
  'toronto',
  'hamilton',
  'mississauga',
  'richmond',
  'ottawa',
  'carlingwood',
  'gloucester',
  'halifax',
  'pmx',
  'store',
  'team',
  'staff',
  'service',
  'customer',
  'experience',
  'professional',
  'today',
  'location',
  'centre',
  'center',
  'hi',
  'hello',
  'dear',
  'shauna',
  'pollock',
  'laurel',
  'devin',
  'director',
  'manager',
  'learning',
  'development',
  'appreciate',
  'delighted',
  'wonderful',
  'lovely',
  'sorry',
  'please',
  'email',
  'visit',
  'again',
  'soon',
  'hope',
  'look',
  'forward',
  'seeing',
  'taking',
  'time',
  'leave',
  'review',
  'kind',
  'words',
  'positive',
  'negative',
  'first',
  'your',
  'our',
  'you',
  'we',
  're',
  've',
  'll',
]);

function pushName(found, value) {
  const part = String(value || '').replace(/’/g, "'").trim();
  const norm = normalizePersonToken(part);
  if (!norm || norm.length < 3 || NAME_STOPWORDS.has(norm)) return;
  found.add(part);
}

/** Pull likely staff first names from reviews and owner replies. */
export function extractCandidateNames(reviews = []) {
  const found = new Set();
  for (const review of reviews) {
    const text = decodeBasic(review?.text || '');
    const reply = decodeBasic(review?.ownerReply || '');
    const textNorm = normalizePersonToken(text);

    // Names called out in the owner reply, but only if the customer also mentioned them.
    const replyNames = reply.match(
      /\b([A-ZÀ-ÖØ-Ý][a-zà-öø-ÿ'’-]{2,})(?:'s)?\b/g,
    );
    if (replyNames) {
      for (const match of replyNames) {
        const cleaned = match.replace(/'s$/i, '');
        const norm = normalizePersonToken(cleaned);
        if (norm && textNorm.includes(norm)) pushName(found, cleaned);
      }
    }

    const patterns = [
      /\b(?:with|from)\s+([A-ZÀ-ÖØ-Ý][a-zà-öø-ÿ'’-]{2,})(?:\s+and\s+([A-ZÀ-ÖØ-Ý][a-zà-öø-ÿ'’-]{2,}))?/g,
      /\b([A-ZÀ-ÖØ-Ý][a-zà-öø-ÿ'’-]{2,})\s+and\s+([A-ZÀ-ÖØ-Ý][a-zà-öø-ÿ'’-]{2,})\b/g,
      /\b([A-ZÀ-ÖØ-Ý][a-zà-öø-ÿ'’-]{2,})\s+was\b/g,
      /\b([A-ZÀ-ÖØ-Ý][a-zà-öø-ÿ'’-]{2,})\s+took care\b/gi,
      /\b(?:served by|helped by|thanks?)\s+([A-ZÀ-ÖØ-Ý][a-zà-öø-ÿ'’-]{2,})/gi,
    ];
    for (const re of patterns) {
      re.lastIndex = 0;
      let match;
      while ((match = re.exec(text))) {
        pushName(found, match[1]);
        if (match[2]) pushName(found, match[2]);
      }
    }
  }
  return Array.from(found);
}

function decodeBasic(value) {
  return String(value || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&');
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function phraseInHay(hay, phrase) {
  const token = normalizePersonToken(phrase);
  if (!token || token.length < 3) return false;
  return new RegExp(`(?:^|\\s)${escapeRegExp(token)}(?:\\s|$)`).test(hay);
}

/**
 * Everyday review vocabulary (EN + FR) that must never fuzzy-match a name.
 * Exact matches are unaffected — a real "Faith" or "Prince" still counts.
 */
const FUZZY_BLOCKED_WORDS = new Set(
  `about above after again against along also always among amount another answer answered anyone anything
   around asked attentive back bars because been before being below best better between block bought bring
   brought buying called came cannot care cared cash chain check cheque clean clear clearly close coins come
   comes coming could counter course customer customers days deal dealt dear done door down each early easy
   either else email enough even ever every everyone everything exactly explain explained extra fair fast feel
   felt find fine first five four friend friendly from front full gate gave gentle girl give given glad goes
   going gold gone good great guys hand hands happy hard have having hear heard help helped helpful here high
   highly hold home honest hope hour hours house however item items just keep kept kind kindly knew know known
   late later least leave left less like liked little live local login long look looked looking lots love
   loved made make makes making many mean meet mind mine minute minutes money month months more morning most
   annee annees
   much must name near need needed never nice night none note nothing offer offered office often okay once ones
   only open other others ours over owner paid part parked parking patient people perfect person phone place
   point polite poor price prices pure quick quickly quite rate rather real really reason recommend ring rings
   right room safe said sale sales same scale second seems seen sell sent service shop shown show shows side
   since small smooth sold some someone something soon sorry speak staff stand star stars start state stay
   still stop store story such sure take taken takes taking talk team tell test than thank thanks that their
   them then there these they thing things think third this those though three through time times today told
   took total touch toward trust turn twice under until upon used using value very visit wait waited wanted
   wants watch week weeks weight well went were what when where which while whole will wish with within
   without woman women wonderful word words work worked works worth would write year years young
   aussi autre avant avec beaucoup bien bonne bonjour cela cette chaque chez comme comptoir dans deux donc
   encore entre ensuite entendu equipe etait etre faire fait fois gens heure heures jour jours jusqu leur leurs
   magasin mais meme merci mois monde nous notre nouveau peut plus pour prix quand rien sans semaine service
   seul sommes sont sous sur tous tout toute toutes tres trop vente vous votre vraiment`
    .split(/\s+/)
    .filter(Boolean),
);

function reviewWordMatchesExact(word, exactTokens) {
  return exactTokens.has(word);
}

/**
 * Typo tolerance for given names only (Eric → Erich, Vicent → Vincent).
 * Capitalised words in the original text get a little more slack because
 * reviewers capitalise names far more reliably than ordinary words.
 */
function reviewWordFuzzyDistance(word, fuzzyTokens, capitalized) {
  if (word.length < 4 || FUZZY_BLOCKED_WORDS.has(word) || NAME_STOPWORDS.has(word)) return Infinity;
  let best = Infinity;
  for (const token of fuzzyTokens) {
    if (word[0] !== token[0]) continue;
    const dist = editDistance(word, token);
    const min = Math.min(word.length, token.length);
    const ok =
      (dist <= 1 && min >= 4) ||
      (dist <= 2 && min >= 6 && capitalized) ||
      // "Erik" for Erich: capitalised, same opening three letters, two edits.
      (dist <= 2 && min >= 4 && capitalized && word.slice(0, 3) === token.slice(0, 3));
    if (ok && dist < best) best = dist;
  }
  return best;
}

function capitalizedWordsIn(text) {
  const out = new Set();
  const re = /(^|[^\p{L}])(\p{Lu}[\p{L}'’-]*)/gu;
  let match;
  while ((match = re.exec(String(text || '')))) {
    for (const part of normalizePersonToken(match[2]).split(/[-\s]+/)) {
      if (part) out.add(part);
    }
  }
  return out;
}

export function findNamedEmployees(text, directory) {
  const hay = normalizePersonToken(text);
  if (!hay || !directory?.length) return [];
  const words = hay.split(/[-\s]+/).filter(Boolean);
  const capitalized = capitalizedWordsIn(text);

  const hits = [];
  const ordered = [...directory].sort(
    (a, b) => b.key.length - a.key.length || a.name.localeCompare(b.name),
  );

  for (const emp of ordered) {
    const phrases = [emp.key, emp.name, ...(emp.aliases || [])].filter(
      (token) => normalizePersonToken(token).includes(' '),
    );
    if (phrases.some((phrase) => phraseInHay(hay, phrase))) {
      hits.push({ emp, strength: 'full', exact: true });
      continue;
    }
    const exactTokens = new Set(
      [emp.first, emp.key, ...(emp.aliases || [])]
        .map(normalizePersonToken)
        .filter((token) => token && token.length >= 3 && !token.includes(' ')),
    );
    const fuzzyTokens = fuzzyGivenNameTokens(emp);
    const lastHit =
      emp.last &&
      (emp.last.length > 1
        ? phraseInHay(hay, emp.last)
        : words.some((word) => word === emp.last));
    const exactHit = words.some((word) => reviewWordMatchesExact(word, exactTokens));
    let fuzzyDist = Infinity;
    if (!exactHit) {
      for (const word of words) {
        const dist = reviewWordFuzzyDistance(word, fuzzyTokens, capitalized.has(word));
        if (dist < fuzzyDist) fuzzyDist = dist;
      }
    }
    if (exactHit || fuzzyDist < Infinity) {
      hits.push({
        emp,
        strength: lastHit ? 'firstLast' : 'first',
        exact: exactHit,
        dist: exactHit ? 0 : fuzzyDist,
      });
    }
  }

  const unique = [];
  const used = new Set();
  const add = (emp) => {
    const person = resolveDirectoryPerson(emp.name, directory) || emp;
    if (used.has(person.key)) return;
    used.add(person.key);
    unique.push(person);
  };

  for (const hit of hits.filter((row) => row.strength !== 'first')) add(hit.emp);

  const firstHits = hits.filter((row) => row.strength === 'first');
  const grouped = [];
  for (const hit of firstHits) {
    const existing = grouped.find((group) =>
      group.some((row) => firstNamesLikelySame(row.emp.first, hit.emp.first)),
    );
    if (existing) existing.push(hit);
    else grouped.push([hit]);
  }
  for (const group of grouped) {
    const people = [];
    const seen = new Set();
    const exactKeys = new Set();
    const bestDist = new Map();
    for (const hit of group) {
      const person = resolveDirectoryPerson(hit.emp.name, directory) || hit.emp;
      if (hit.exact) exactKeys.add(person.key);
      bestDist.set(person.key, Math.min(bestDist.get(person.key) ?? Infinity, hit.dist ?? 0));
      if (seen.has(person.key)) continue;
      seen.add(person.key);
      people.push(person);
    }
    if (people.length === 1) {
      add(people[0]);
      continue;
    }
    // "Yohann" written exactly beats a fuzzy "Yohance" in the same store.
    const exactPeople = people.filter((person) => exactKeys.has(person.key));
    if (exactPeople.length === 1) {
      add(exactPeople[0]);
      continue;
    }
    // "Yohan" is one edit from Yohann and two from Yohance: take the closer one.
    const minDist = Math.min(...people.map((person) => bestDist.get(person.key) ?? Infinity));
    const closest = people.filter((person) => (bestDist.get(person.key) ?? Infinity) === minDist);
    if (closest.length === 1 && minDist < Infinity) {
      add(closest[0]);
      continue;
    }
    const lastWords = words.filter((word) => word.length === 1);
    const narrowed = people.filter(
      (person) =>
        person.last &&
        (phraseInHay(hay, person.last) || lastWords.some((word) => person.last.startsWith(word))),
    );
    if (narrowed.length === 1) add(narrowed[0]);
  }

  return unique;
}

function nameTokens(value) {
  return normalizePersonToken(value)
    .split(' ')
    .filter((token) => token && token.length >= 2 && !NAME_STOPWORDS.has(token));
}

/**
 * Score how well a Google reviewer name matches a POS customer name.
 * Handles "First Last", "First L", and single-token reviewers.
 */
export function reviewerCustomerMatchScore(reviewerName, customerName) {
  const reviewer = nameTokens(reviewerName);
  const customer = nameTokens(customerName);
  if (!reviewer.length || !customer.length) return 0;

  const revFull = reviewer.join(' ');
  const custFull = customer.join(' ');
  if (revFull === custFull) return 100;

  const revFirst = reviewer[0];
  const revLast = reviewer[reviewer.length - 1];
  const custFirst = customer[0];
  const custLast = customer[customer.length - 1];

  if (reviewer.length === 1) {
    // Too ambiguous unless the customer is also a single token.
    if (customer.length === 1 && revFirst === custFirst) return 70;
    return 0;
  }

  if (revFirst === custFirst && revLast === custLast) return 95;

  // Google often truncates last name: "Pierre D" vs "Pierre Deschenes"
  if (
    revFirst === custFirst &&
    revLast.length === 1 &&
    custLast.startsWith(revLast)
  ) {
    return 90;
  }

  if (
    revFirst === custFirst &&
    custLast.length === 1 &&
    revLast.startsWith(custLast)
  ) {
    return 88;
  }

  // First + last initial inside a longer Google display name
  if (revFirst === custFirst && custLast.startsWith(revLast[0])) {
    return 80;
  }

  return 0;
}

/**
 * When a review does not name an employee, try matching the Google reviewer
 * to a store customer transaction and attribute the serving analyst(s).
 */
export function matchReviewerToTransactions(review, storeTransactions = []) {
  const author = String(review?.author || '').trim();
  // Strip Google placeholder suffixes like "(UserGoogle301)" before matching.
  const authorClean = author
    .replace(/\(\s*usergoogle\d+\s*\)/gi, '')
    .replace(/\busergoogle\d+\b/gi, '')
    .trim();
  if (
    !authorClean ||
    /^(anonymous|google user|a google user)$/i.test(authorClean)
  ) {
    return null;
  }

  const reviewDay = review?.date ? parseDateParam(review.date) : null;
  const scored = [];

  for (const tx of storeTransactions) {
    const customerName = String(tx.customerName || '').trim();
    const employeeName = String(tx.employeeName || '').trim();
    if (!customerName || customerName === '—' || isExcludedCustomerName(customerName)) continue;
    if (!employeeName || employeeName === '—') continue;

    const score = reviewerCustomerMatchScore(authorClean, customerName);
    if (score < 80) continue;

    const txDay = tx.date ? parseDateParam(tx.date) : null;
    let dayDelta = 9999;
    if (reviewDay && txDay) {
      dayDelta = Math.abs(Math.round((reviewDay - txDay) / 86400000));
    }
    // Prefer visits within ~45 days before the review (or same month window).
    if (dayDelta > 45) continue;

    scored.push({
      score,
      dayDelta,
      customerName,
      employeeName,
      reference: tx.reference || '',
      dateLabel: tx.dateLabel || '',
      tx,
    });
  }

  if (!scored.length) return null;

  scored.sort(
    (a, b) =>
      b.score - a.score ||
      a.dayDelta - b.dayDelta ||
      String(b.tx?.date || '').localeCompare(String(a.tx?.date || '')),
  );

  const bestScore = scored[0].score;
  const top = scored.filter((row) => row.score === bestScore && row.dayDelta === scored[0].dayDelta);

  // If multiple distinct customers tie, do not guess.
  const customers = new Set(top.map((row) => normalizePersonToken(row.customerName)));
  if (customers.size > 1) return null;

  const employees = [];
  const seenEmp = new Set();
  for (const row of top) {
    const key = normalizePersonToken(row.employeeName);
    if (seenEmp.has(key)) continue;
    seenEmp.add(key);
    employees.push(row.employeeName);
  }
  if (!employees.length) return null;

  const best = top[0];
  return {
    customerName: best.customerName,
    customerId: best.tx?.customerId || '',
    systemKey: best.tx?.systemKey || '',
    employees,
    reference: best.reference,
    dateLabel: best.dateLabel,
    score: best.score,
    dayDelta: best.dayDelta,
  };
}

function transactionStoreName(row) {
  return row?.storeName || row?.store || '';
}

/**
 * Employee names tied to a store review for the period: named in the text
 * or matched through a POS customer transaction.
 */
export function attributedReviewEmployeeNames({
  reviews = [],
  transactionRows = [],
  storeName,
  orgEmployees = [],
  /** @deprecated use orgEmployees — kept so older callers keep working */
  staffProfiles = [],
} = {}) {
  const name = canonicalBonusStoreName(storeName) || String(storeName || '').trim();
  if (!name) return [];
  const roster = orgEmployeesForBonusStore(
    orgEmployees?.length ? orgEmployees : staffProfiles,
    name,
  );
  const storeTransactions = (transactionRows || [])
    .filter((row) => {
      const txStore = transactionStoreName(row);
      return !txStore || storeNamesMatch(txStore, name);
    })
    .map((row) => ({
      ...row,
      storeName: transactionStoreName(row) || name,
    }));
  const employeesByStore = employeesByCanonicalStore(storeTransactions);
  const directory = buildBonusDirectory(
    storeTransactions,
    employeesByStore,
    name,
    roster,
  );
  const names = [];
  const seen = new Set();
  for (const review of reviews || []) {
    const classified = classifyReview(review, directory, storeTransactions, roster);
    if (
      classified.attributionSource !== 'named' &&
      classified.attributionSource !== 'transaction'
    ) {
      continue;
    }
    for (const employeeName of classified.attributedEmployees || []) {
      const canonical = canonicalOrgEmployeeName(employeeName, directory, roster);
      if (!isOrgEmployeeName(canonical, roster)) continue;
      const key = normalizePersonToken(canonical);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      names.push(canonical);
    }
  }
  return names;
}

/** True when a home-stack person is one of the attributed review employees. */
export function employeeNameMatchesAny(personName, employeeNames = []) {
  const person = String(personName || '').trim();
  if (!person || !employeeNames.length) return false;
  const personKey = normalizePersonToken(person);
  const profile = {
    fullName: person,
    firstName: firstName(person),
    lastName: lastName(person),
  };
  return employeeNames.some((name) => {
    const other = String(name || '').trim();
    if (!other) return false;
    if (personKey && personKey === normalizePersonToken(other)) return true;
    return (
      bonusViewerMatchesEmployee(other, profile) ||
      bonusViewerMatchesEmployee(person, { fullName: other })
    );
  });
}

/** Drop repeats so one person never gets a 50/50 split with themselves. */
function uniqueNames(names) {
  const out = [];
  const seen = new Set();
  for (const name of names || []) {
    const key = normalizePersonToken(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

export function classifyReview(review, directory, storeTransactions = [], orgEmployees = []) {
  const named = findNamedEmployees(review.text, directory).filter((emp) =>
    isOrgEmployeeName(emp.name, orgEmployees),
  );
  const nameOnly = isNameOnlyReview(review.text, named.length ? named : directory);
  const fiveStar = review.rating === 5;
  const eligible = fiveStar && !nameOnly;

  let attributionSource = 'none';
  let attributedEmployees = uniqueNames(
    named.map((emp) => canonicalOrgEmployeeName(emp.name, directory, orgEmployees)),
  );
  let transactionMatch = null;

  if (named.length > 0) {
    attributionSource = 'named';
  } else if (eligible) {
    transactionMatch = matchReviewerToTransactions(review, storeTransactions);
    if (transactionMatch?.employees?.length) {
      const employees = uniqueNames(
        transactionMatch.employees
          .map((employeeName) => canonicalOrgEmployeeName(employeeName, directory, orgEmployees))
          .filter((employeeName) => isOrgEmployeeName(employeeName, orgEmployees)),
      );
      if (employees.length) {
        attributionSource = 'transaction';
        attributedEmployees = employees;
      } else {
        attributionSource = 'unassigned';
      }
    } else {
      attributionSource = 'unassigned';
    }
  }

  return {
    ...review,
    namedEmployees: uniqueNames(named.map((emp) => emp.name)),
    attributedEmployees,
    attributionSource,
    transactionMatch,
    nameOnly,
    eligible,
    ineligibleReason: !fiveStar
      ? 'Not a 5-star review'
      : nameOnly
        ? 'Name-only review (no experience description)'
        : '',
  };
}

function attributedEmployeeNames(review) {
  if (review?.attributedEmployees?.length) return review.attributedEmployees;
  if (review?.namedEmployees?.length) return review.namedEmployees;
  return [];
}

function employeePayoutRows(classified, perReviewBonus, directory, orgEmployees = []) {
  const byEmployee = new Map();

  const ensure = (name) => {
    let row = byEmployee.get(name);
    if (!row) {
      row = {
        employeeName: name,
        eligibleCount: 0,
        photoCount: 0,
        shareSum: 0,
        reviewBonus: 0,
        photoBonus: 0,
        total: 0,
        reviews: [],
      };
      byEmployee.set(name, row);
    }
    return row;
  };

  for (const review of classified) {
    if (!review.eligible) continue;
    const names = [
      ...new Set(
        attributedEmployeeNames(review)
          .filter((name) => name && name !== '—' && !/^unassigned$/i.test(name))
          .map((name) => canonicalOrgEmployeeName(name, directory, orgEmployees))
          .filter((name) => isOrgEmployeeName(name, orgEmployees)),
      ),
    ];
    if (!names.length) continue;
    const share = 1 / names.length;
    const reviewShare = perReviewBonus * share;
    const photoShare = review.hasPhotos ? PHOTO_BONUS * share : 0;

    for (const name of names) {
      const row = ensure(name);
      row.eligibleCount += share;
      row.shareSum += share;
      if (review.hasPhotos) row.photoCount += share;
      row.reviewBonus += reviewShare;
      row.photoBonus += photoShare;
      row.total += reviewShare + photoShare;
      row.reviews.push({
        ...review,
        share,
        reviewShare,
        photoShare,
        payout: reviewShare + photoShare,
      });
    }
  }

  const merged = new Map();
  for (const row of byEmployee.values()) {
    const name =
      canonicalOrgEmployeeName(row.employeeName, directory || [], orgEmployees) ||
      row.employeeName;
    const prev = merged.get(name);
    if (!prev) {
      merged.set(name, {
        ...row,
        employeeName: name,
        reviews: [...row.reviews],
      });
      continue;
    }
    prev.eligibleCount += row.eligibleCount;
    prev.photoCount += row.photoCount;
    prev.shareSum += row.shareSum;
    prev.reviewBonus += row.reviewBonus;
    prev.photoBonus += row.photoBonus;
    prev.total += row.total;
    prev.reviews.push(...row.reviews);
  }

  for (const person of orgEmployees || []) {
    const display = staffDisplayName(person) || String(person?.fullName || '').trim();
    if (!display) continue;
    const name = canonicalOrgEmployeeName(display, directory || [], orgEmployees) || display;
    const existing = merged.get(name);
    if (existing) {
      existing.onRoster = true;
      existing.title = existing.title || person.title || person.role || '';
      existing.roleKey = existing.roleKey || person.roleKey || '';
      continue;
    }
    merged.set(name, {
      employeeName: name,
      eligibleCount: 0,
      photoCount: 0,
      shareSum: 0,
      reviewBonus: 0,
      photoBonus: 0,
      total: 0,
      reviews: [],
      onRoster: true,
      title: person.title || person.role || '',
      roleKey: person.roleKey || '',
    });
  }

  return Array.from(merged.values())
    .map((row) => ({
      ...row,
      eligibleCount: Math.round(row.eligibleCount * 100) / 100,
      photoCount: Math.round(row.photoCount * 100) / 100,
      reviewBonus: Math.round(row.reviewBonus * 100) / 100,
      photoBonus: Math.round(row.photoBonus * 100) / 100,
      total: Math.round(row.total * 100) / 100,
      zeroPayout: (Number(row.total) || 0) === 0,
    }))
    .sort(
      (a, b) =>
        Number(b.total) - Number(a.total) ||
        Number(Boolean(a.zeroPayout)) - Number(Boolean(b.zeroPayout)) ||
        a.employeeName.localeCompare(b.employeeName),
    );
}

function storeNamesMatch(left, right) {
  const a = canonicalBonusStoreName(left);
  const b = canonicalBonusStoreName(right);
  if (!a || !b) return false;
  return a.localeCompare(b, undefined, { sensitivity: 'base' }) === 0;
}

function emailRowsByCanonicalStore(transactionRows) {
  const emailByStore = buildEmailCaptureByStore(transactionRows || []);
  const emailMap = new Map();
  for (const row of emailByStore) {
    const storeName = canonicalBonusStoreName(row.store);
    if (!storeName || isBonusExcludedStore(storeName)) continue;
    const key = storeName.toLowerCase();
    const prev = emailMap.get(key);
    emailMap.set(key, prev ? mergeEmailRows(prev, row, storeName) : { ...row, store: storeName });
  }
  return emailMap;
}

function employeesByCanonicalStore(transactionRows) {
  const employeesByStore = new Map();
  for (const row of transactionRows || []) {
    const store = canonicalBonusStoreName(row.storeName || '');
    const emp = String(row.employeeName || '').trim();
    if (!store || !emp || emp === '—') continue;
    if (!employeesByStore.has(store)) employeesByStore.set(store, new Set());
    employeesByStore.get(store).add(emp);
  }
  return employeesByStore;
}

/**
 * Score one store from POS email capture + Google reviews for the period.
 */
export function buildStoreBonus({
  storeName,
  email,
  reviews = [],
  reviewsError = '',
  reviewsLoading = false,
  transactionRows = [],
  employeesByStore,
  orgEmployees = [],
  staffProfiles = [],
  startDate,
  endDate,
} = {}) {
  const name = canonicalBonusStoreName(storeName) || storeName;
  const allRoster = orgEmployees?.length ? orgEmployees : staffProfiles;
  // Richmond Hill → PMX employees only; GTA stores → GTA; Ottawa/Quebec/Halifax → East.
  const roster = orgEmployeesForBonusStore(allRoster, name);
  const place = getGooglePlaceForStore(name);
  const emailRow = email || emptyEmailRow(name);
  const periodReviews = filterReviewsByDateRange(reviews || [], startDate, endDate);
  const directory = buildBonusDirectory(
    transactionRows,
    employeesByStore,
    name,
    allRoster,
  );
  const storeTransactions = (transactionRows || []).filter((row) =>
    storeNamesMatch(row.storeName, name),
  );
  const classified = periodReviews.map((review) =>
    classifyReview(review, directory, storeTransactions, roster),
  );

  const negativeCount = classified.filter((row) => row.rating <= 2).length;
  const fiveStarCount = classified.filter((row) => row.rating === 5).length;
  const eligible = classified.filter((row) => row.eligible);
  const paidEligible = eligible.filter((row) => attributedEmployeeNames(row).length > 0);
  const ineligibleFiveStar = classified.filter((row) => row.rating === 5 && !row.eligible);
  const withPhotos = paidEligible.filter((row) => row.hasPhotos).length;
  const transactionAttributedCount = paidEligible.filter(
    (row) => row.attributionSource === 'transaction',
  ).length;
  const ratingBreakdown = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const review of classified) {
    const star = Number(review.rating);
    if (ratingBreakdown[star] != null) ratingBreakdown[star] += 1;
  }

  const payout = bonusPerReview(emailRow.rate, negativeCount);
  const employees = employeePayoutRows(
    classified,
    payout.amount,
    directory,
    roster,
  );
  const storeReviewBonus = paidEligible.length * payout.amount;
  const storePhotoBonus = withPhotos * PHOTO_BONUS;

  return {
    storeName: name,
    googleConfigured: Boolean(place),
    googleLabel: place?.label || '',
    posSystemKey: posSystemForBonusStore(name),
    aureusEmployeeCount: roster.length,
    rosterSource: roster.length ? 'hr' : 'none',
    directoryCount: directory.length,
    emailRate: emailRow.rate,
    emailRateLabel: emailRow.rateLabel,
    customerCount: emailRow.customerCount,
    withEmail: emailRow.withEmail,
    walkInCount: emailRow.walkInCount,
    totalTransactions: emailRow.totalTransactions,
    negativeCount,
    fiveStarCount,
    eligibleCount: paidEligible.length,
    ineligibleFiveStarCount: ineligibleFiveStar.length,
    transactionAttributedCount,
    photoReviewCount: withPhotos,
    ratingBreakdown,
    reviewCount: classified.length,
    perReviewBonus: payout.amount,
    payout,
    reviewBonusTotal: storeReviewBonus,
    photoBonusTotal: storePhotoBonus,
    totalPayout: storeReviewBonus + storePhotoBonus,
    employees,
    reviews: classified.sort((a, b) => (b.timestampMs || 0) - (a.timestampMs || 0)),
    reviewsError:
      reviewsError || (place ? '' : 'Google reviews not configured for this store yet.'),
    reviewsLoaded: periodReviews.length,
    reviewsLoading,
  };
}

function sortBonusStores(names) {
  const googleOrder = new Map(GOOGLE_STORE_PLACES.map((place, index) => [place.storeName, index]));
  return [...names].sort((a, b) => {
    const ai = googleOrder.has(a) ? googleOrder.get(a) : 100 + a.localeCompare(b);
    const bi = googleOrder.has(b) ? googleOrder.get(b) : 100 + b.localeCompare(a);
    if (ai !== bi) return ai - bi;
    return a.localeCompare(b, undefined, { sensitivity: 'base' });
  });
}

/**
 * Build per-store bonus board from transactions + the Reviews-app Google feed.
 */
export async function buildBonusBoard({
  session = null,
  transactionRows,
  year,
  monthIndex,
  startDate,
  endDate,
  storeFilter = null,
  orgEmployees = null,
  staffProfiles = null,
  refresh = false,
  onStore,
} = {}) {
  const grant = canViewBonusReviewData(session);
  const reviewPurpose = grant === true ? 'bonus' : 'home';
  const range =
    startDate && endDate
      ? {
          start: parseDateParam(startDate),
          end: parseDateParam(endDate),
          startDate: formatDateParam(startDate),
          endDate: formatDateParam(endDate),
          label: reviewPeriodLabel(startDate, endDate),
        }
      : monthRange(year, monthIndex);

  if (grant === false) {
    return {
      range,
      matrix: payoutMatrix(),
      stores: [],
      roster: {
        total: 0,
        bySystem: { east: 0, gta: 0, pmx: 0 },
        systemsLoaded: [],
        systemsMissing: ['east', 'gta', 'pmx'],
        sourceBySystem: {},
        errors: [BONUS_ACCESS_DENIED],
        notes: [],
        denied: true,
      },
    };
  }
  const emailMap = emailRowsByCanonicalStore(transactionRows);
  const employeesByStore = employeesByCanonicalStore(transactionRows);

  const roster = Array.isArray(orgEmployees)
    ? orgEmployees
    : Array.isArray(staffProfiles) && staffProfiles.length
      ? staffProfiles
      : listBonusRoster();
  const rosterByStore = bonusRosterCountByStore();
  const rosterErrors = [];
  const rosterNotes = [];
  const systemsLoaded = ['hr'];
  const systemsMissing = [];
  const sourceBySystem = { hr: 'hr' };

  const storeNames = new Set([
    ...GOOGLE_STORE_PLACES.map((place) => place.storeName),
    ...Array.from(emailMap.values()).map((row) => row.store),
  ]);

  let stores = sortBonusStores(
    Array.from(storeNames).filter((name) => !isBonusExcludedStore(name)),
  );
  if (storeFilter) {
    const wanted = canonicalBonusStoreName(storeFilter);
    stores = stores.filter((name) => storeNamesMatch(name, wanted));
  }

  const matrix = payoutMatrix();
  const results = new Map();

  const publish = (store) => {
    results.set(store.storeName, store);
    onStore?.(store);
    return store;
  };

  const seed = stores.map((storeName) => {
    const cached = peekCachedGoogleReviews(storeName, range.startDate, range.endDate, reviewPurpose) || [];
    const place = getGooglePlaceForStore(storeName);
    return publish(
      buildStoreBonus({
        storeName,
        email: emailMap.get(storeName.toLowerCase()) || emptyEmailRow(storeName),
        reviews: cached,
        reviewsLoading: Boolean(place),
        transactionRows,
        employeesByStore,
        orgEmployees: roster,
        startDate: range.startDate,
        endDate: range.endDate,
      }),
    );
  });

  // One store at a time so Google pages stay under the proxy budget; the
  // shared review cache from the Reviews app makes repeat opens instant.
  for (const storeName of stores) {
    const place = getGooglePlaceForStore(storeName);
    if (!place) continue;
    const email = emailMap.get(storeName.toLowerCase()) || emptyEmailRow(storeName);
    const fetched = await fetchGoogleReviewsForStore(storeName, {
      startDate: range.startDate,
      endDate: range.endDate,
      purpose: reviewPurpose,
      refresh,
      onPage: ({ reviews, done, error }) => {
        publish(
          buildStoreBonus({
            storeName,
            email,
            reviews,
            reviewsError: error || '',
            reviewsLoading: !done,
            transactionRows,
            employeesByStore,
            orgEmployees: roster,
            startDate: range.startDate,
            endDate: range.endDate,
          }),
        );
      },
    });
    publish(
      buildStoreBonus({
        storeName,
        email,
        reviews: fetched.reviews || [],
        reviewsError: fetched.error || '',
        reviewsLoading: false,
        transactionRows,
        employeesByStore,
        orgEmployees: roster,
        startDate: range.startDate,
        endDate: range.endDate,
      }),
    );
  }

  return {
    range,
    matrix,
    stores: stores.map((name) => results.get(name) || seed.find((row) => row.storeName === name)),
    roster: {
      total: roster.length,
      byStore: rosterByStore,
      bySystem: rosterByStore,
      systemsLoaded,
      systemsMissing,
      sourceBySystem,
      errors: rosterErrors,
      notes: rosterNotes,
    },
  };
}

export function formatMoney(amount) {
  const value = Number(amount) || 0;
  return `$${value.toLocaleString('en-CA', {
    minimumFractionDigits: value % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

function csvCell(value) {
  const text = value == null ? '' : String(value);
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function bonusSpreadsheetFilename({ startDate, endDate, storeName } = {}) {
  const start = String(startDate || '').replace(/-/g, '');
  const end = String(endDate || '').replace(/-/g, '');
  const store = storeName
    ? `-${String(storeName)
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '-')}`
    : '';
  return `bonuses${store}-${start || 'period'}${end && end !== start ? `-${end}` : ''}.csv`;
}

/** Excel-friendly CSV of store roster payouts for the loaded bonus board. */
export function buildBonusSpreadsheetCsv(board, { periodLabel = '' } = {}) {
  const header = [
    'Period',
    'Store',
    'Employee',
    'Title',
    'Eligible reviews',
    'Photo reviews',
    'Per review',
    'Review bonus',
    'Photo bonus',
    'Total',
    'Email rate',
    'Negatives',
  ];
  const rows = [header];
  for (const store of board?.stores || []) {
    const people = store.employees?.length
      ? store.employees
      : [
          {
            employeeName: '',
            title: '',
            eligibleCount: store.eligibleCount,
            photoCount: store.photoReviewCount,
            reviewBonus: store.reviewBonusTotal,
            photoBonus: store.photoBonusTotal,
            total: store.totalPayout,
          },
        ];
    for (const emp of people) {
      rows.push([
        periodLabel,
        store.storeName,
        emp.employeeName || '',
        emp.title || '',
        emp.eligibleCount ?? 0,
        emp.photoCount ?? 0,
        store.perReviewBonus ?? 0,
        emp.reviewBonus ?? 0,
        emp.photoBonus ?? 0,
        emp.total ?? 0,
        store.emailRateLabel || '',
        store.negativeCount ?? 0,
      ]);
    }
  }
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

export const BONUS_REVIEW_SPREADSHEET_HEADERS = [
  'Date',
  'brand',
  'location',
  'Customer name',
  'staff mentioned',
  'stars',
  'photos included',
  'number of photos',
  'photo link',
  'review link',
  'review text',
];

function spreadsheetDate(review) {
  if (review?.date instanceof Date && !Number.isNaN(review.date.getTime())) {
    return formatDateParam(review.date);
  }
  const ts = Number(review?.timestampMs);
  if (Number.isFinite(ts)) return formatDateParam(new Date(ts));
  return '';
}

function staffMentionedLabel(review) {
  const named = [...new Set((review?.namedEmployees || []).map((name) => String(name || '').trim()).filter(Boolean))];
  if (named.length) return named.join(', ');
  const attributed = [
    ...new Set((review?.attributedEmployees || []).map((name) => String(name || '').trim()).filter(Boolean)),
  ];
  return attributed.join(', ');
}

function photoLinkLabel(review) {
  const urls = (review?.photoUrls || []).map((url) => String(url || '').trim()).filter(Boolean);
  return urls.join('; ');
}

export function bonusReviewSpreadsheetRows(stores) {
  const rows = [];
  for (const store of stores || []) {
    const location = canonicalBonusStoreName(store?.storeName) || String(store?.storeName || '').trim();
    const brand = googleStoreBrand(location);
    for (const review of store?.reviews || []) {
      const photoCount = Number(review?.photoCount) || 0;
      rows.push({
        Date: spreadsheetDate(review),
        brand,
        location,
        'Customer name': String(review?.author || '').trim(),
        'staff mentioned': staffMentionedLabel(review),
        stars: Number(review?.rating) || 0,
        'photos included': review?.hasPhotos || photoCount > 0 ? 'Yes' : 'No',
        'number of photos': photoCount,
        'photo link': photoLinkLabel(review),
        'review link': googleReviewPermalink(review, location),
        'review text': String(review?.text || ''),
      });
    }
  }
  return rows.sort(
    (a, b) =>
      String(a.Date).localeCompare(String(b.Date)) ||
      String(a.location).localeCompare(String(b.location)) ||
      String(a['Customer name']).localeCompare(String(b['Customer name'])),
  );
}

function csvFromRows(rows) {
  const lines = [
    BONUS_REVIEW_SPREADSHEET_HEADERS.join(','),
    ...rows.map((row) => BONUS_REVIEW_SPREADSHEET_HEADERS.map((key) => csvCell(row[key])).join(',')),
  ];
  return `\uFEFF${lines.join('\r\n')}`;
}

export function bonusReviewSpreadsheetCsv(stores) {
  return csvFromRows(bonusReviewSpreadsheetRows(stores));
}

export function bonusReviewSpreadsheetFilename(startDate, endDate) {
  const start = startDate ? formatDateParam(startDate) : '';
  const end = endDate ? formatDateParam(endDate) : '';
  if (start && end && start !== end) return `google-review-bonuses-${start}-to-${end}.csv`;
  if (start) return `google-review-bonuses-${start}.csv`;
  return 'google-review-bonuses.csv';
}

export function downloadBonusReviewSpreadsheet(stores, { startDate, endDate } = {}) {
  if (typeof document === 'undefined') {
    throw new Error('Open the web app to download the spreadsheet.');
  }
  const rows = bonusReviewSpreadsheetRows(stores);
  const filename = bonusReviewSpreadsheetFilename(startDate, endDate);
  const blob = new Blob([csvFromRows(rows)], { type: 'text/csv;charset=utf-8;' });
  const uri = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = uri;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(uri), 1000);
  return { filename, rows: rows.length };
}
