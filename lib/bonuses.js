/**
 * Google Review & Email Bonus Policy (effective Aug 1, 2026).
 */

import {
  findStaffByEmployeeName,
  hasFullAppAccess,
  normalizeAppRole,
} from './permissions';
import {
  buildEmailCaptureByStore,
  formatDateParam,
  parseDateParam,
} from './transactions';
import {
  canonicalGoogleStoreName,
  fetchGoogleReviewsForStore,
  filterReviewsByDateRange,
  GOOGLE_STORE_PLACES,
  getGooglePlaceForStore,
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
  'toronto',
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
  return BONUS_EXCLUDED_STORES.some(
    (name) => key === name || key.includes(name),
  );
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
  return canonicalGoogleStoreName(storeName);
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
  return Boolean(findStaffByEmployeeName([profile], name));
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

/** Build searchable employee tokens from POS names. */
export function buildEmployeeDirectory(employeeNames) {
  const directory = [];
  const seen = new Set();
  for (const name of employeeNames || []) {
    const full = String(name || '').trim();
    if (!full || full === '—') continue;
    const key = normalizePersonToken(full);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const first = firstName(full);
    directory.push({
      name: full,
      key,
      first,
      aliases: first && first !== key ? [first] : [],
    });
  }
  return directory;
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

export function findNamedEmployees(text, directory) {
  const hay = normalizePersonToken(text);
  if (!hay || !directory?.length) return [];

  const matched = [];
  const used = new Set();

  // Prefer longer / full-name matches first.
  const ordered = [...directory].sort(
    (a, b) => b.key.length - a.key.length || a.name.localeCompare(b.name),
  );

  for (const emp of ordered) {
    if (used.has(emp.key)) continue;
    const candidates = [emp.key, emp.first, ...(emp.aliases || [])].filter(
      (token) => token && token.length >= 3,
    );
    const hit = candidates.some((token) => {
      const re = new RegExp(`(?:^|\\s)${token}(?:\\s|$)`);
      return re.test(hay);
    });
    if (hit) {
      matched.push(emp);
      used.add(emp.key);
    }
  }

  return matched;
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
    if (!customerName || customerName === '—' || isWalkInLike(customerName)) continue;
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
    employees,
    reference: best.reference,
    dateLabel: best.dateLabel,
    score: best.score,
    dayDelta: best.dayDelta,
  };
}

function isWalkInLike(name) {
  return /walk[\s-]*in/i.test(String(name || '').trim());
}

export function classifyReview(review, directory, storeTransactions = []) {
  const named = findNamedEmployees(review.text, directory);
  const nameOnly = isNameOnlyReview(review.text, named.length ? named : directory);
  const fiveStar = review.rating === 5;
  const eligible = fiveStar && !nameOnly;

  let attributionSource = 'none';
  let attributedEmployees = named.map((emp) => emp.name);
  let transactionMatch = null;

  if (named.length > 0) {
    attributionSource = 'named';
  } else if (eligible) {
    transactionMatch = matchReviewerToTransactions(review, storeTransactions);
    if (transactionMatch?.employees?.length) {
      attributionSource = 'transaction';
      attributedEmployees = transactionMatch.employees;
    } else {
      attributionSource = 'unassigned';
    }
  }

  return {
    ...review,
    namedEmployees: named.map((emp) => emp.name),
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

function employeePayoutRows(classified, perReviewBonus) {
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
    const names = attributedEmployeeNames(review).filter(
      (name) => name && name !== '—' && !/^unassigned$/i.test(name),
    );
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

  return Array.from(byEmployee.values())
    .map((row) => ({
      ...row,
      eligibleCount: Math.round(row.eligibleCount * 100) / 100,
      photoCount: Math.round(row.photoCount * 100) / 100,
      reviewBonus: Math.round(row.reviewBonus * 100) / 100,
      photoBonus: Math.round(row.photoBonus * 100) / 100,
      total: Math.round(row.total * 100) / 100,
    }))
    .sort((a, b) => b.total - a.total || a.employeeName.localeCompare(b.employeeName));
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
  startDate,
  endDate,
} = {}) {
  const name = canonicalBonusStoreName(storeName) || storeName;
  const place = getGooglePlaceForStore(name);
  const emailRow = email || emptyEmailRow(name);
  const periodReviews = filterReviewsByDateRange(reviews || [], startDate, endDate);
  const directory = buildEmployeeDirectory([
    ...((employeesByStore && employeesByStore.get(name)) || []),
    ...Array.from(
      new Set(
        (transactionRows || [])
          .map((row) => row.employeeName)
          .filter(Boolean),
      ),
    ),
    ...extractCandidateNames(periodReviews),
  ]);
  const storeTransactions = (transactionRows || []).filter((row) =>
    storeNamesMatch(row.storeName, name),
  );
  const classified = periodReviews.map((review) =>
    classifyReview(review, directory, storeTransactions),
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
  const employees = employeePayoutRows(classified, payout.amount);
  const storeReviewBonus = paidEligible.length * payout.amount;
  const storePhotoBonus = withPhotos * PHOTO_BONUS;

  return {
    storeName: name,
    googleConfigured: Boolean(place),
    googleLabel: place?.label || '',
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
  transactionRows,
  year,
  monthIndex,
  startDate,
  endDate,
  storeFilter = null,
  onStore,
} = {}) {
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
  const emailMap = emailRowsByCanonicalStore(transactionRows);
  const employeesByStore = employeesByCanonicalStore(transactionRows);

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

  const seed = stores.map((storeName) =>
    publish(
      buildStoreBonus({
        storeName,
        email: emailMap.get(storeName.toLowerCase()) || emptyEmailRow(storeName),
        reviews: [],
        reviewsLoading: Boolean(getGooglePlaceForStore(storeName)),
        transactionRows,
        employeesByStore,
        startDate: range.startDate,
        endDate: range.endDate,
      }),
    ),
  );

  await Promise.all(
    stores.map(async (storeName) => {
      const place = getGooglePlaceForStore(storeName);
      if (!place) return;
      const email = emailMap.get(storeName.toLowerCase()) || emptyEmailRow(storeName);
      const fetched = await fetchGoogleReviewsForStore(storeName, {
        startDate: range.startDate,
        endDate: range.endDate,
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
          startDate: range.startDate,
          endDate: range.endDate,
        }),
      );
    }),
  );

  return {
    range,
    matrix,
    stores: stores.map((name) => results.get(name) || seed.find((row) => row.storeName === name)),
  };
}

export function formatMoney(amount) {
  const value = Number(amount) || 0;
  return `$${value.toLocaleString('en-CA', {
    minimumFractionDigits: value % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}
