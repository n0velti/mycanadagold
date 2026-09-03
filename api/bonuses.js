/**
 * Google Review & Email Bonus Policy (effective Aug 1, 2026).
 */

import {
  buildEmailCaptureByStore,
  formatDateParam,
  parseDateParam,
} from './transactions';
import {
  fetchGoogleReviewsForStore,
  GOOGLE_STORE_PLACES,
  getGooglePlaceForStore,
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
  const start = new Date(year, monthIndex, 1);
  const end = new Date(year, monthIndex + 1, 0);
  return {
    start,
    end,
    startDate: formatDateParam(start),
    endDate: formatDateParam(end),
    label: start.toLocaleDateString('en-CA', { month: 'long', year: 'numeric' }),
  };
}

export function currentBonusMonth() {
  const now = new Date();
  return monthRange(now.getFullYear(), now.getMonth());
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

function inMonth(review, start, end) {
  if (!review?.date) return false;
  const day = parseDateParam(review.date);
  return day >= start && day <= end;
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
    const names =
      review.attributedEmployees?.length > 0
        ? review.attributedEmployees
        : review.namedEmployees.length > 0
          ? review.namedEmployees
          : ['Unassigned'];
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

/**
 * Build per-store bonus board from transactions + Google reviews.
 */
export async function buildBonusBoard({
  transactionRows,
  year,
  monthIndex,
  storeFilter = null,
} = {}) {
  const range = monthRange(year, monthIndex);
  const emailByStore = buildEmailCaptureByStore(transactionRows || []);
  const emailMap = new Map(emailByStore.map((row) => [row.store.toLowerCase(), row]));

  const storeNames = new Set([
    ...GOOGLE_STORE_PLACES.map((p) => p.storeName),
    ...emailByStore.map((row) => row.store),
  ]);

  // Employees seen on txs help attribution.
  const employeesByStore = new Map();
  for (const row of transactionRows || []) {
    const store = row.storeName || '—';
    const emp = String(row.employeeName || '').trim();
    if (!emp || emp === '—') continue;
    if (!employeesByStore.has(store)) employeesByStore.set(store, new Set());
    employeesByStore.get(store).add(emp);
  }

  let stores = Array.from(storeNames)
    .filter((name) => !isBonusExcludedStore(name))
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  if (storeFilter) {
    stores = stores.filter(
      (name) => name.localeCompare(storeFilter, undefined, { sensitivity: 'base' }) === 0,
    );
  }

  const matrix = payoutMatrix();
  const results = [];

  for (const storeName of stores) {
    const email = emailMap.get(storeName.toLowerCase()) || {
      store: storeName,
      customerCount: 0,
      walkInCount: 0,
      totalTransactions: 0,
      withEmail: 0,
      rate: 0,
      rateLabel: '0.0%',
    };

    const place = getGooglePlaceForStore(storeName);
    let reviews = [];
    let reviewsError = '';
    if (place) {
      const fetched = await fetchGoogleReviewsForStore(storeName);
      reviews = fetched.reviews || [];
      reviewsError = fetched.error || '';
    } else {
      reviewsError = 'Google reviews not configured for this store yet.';
    }

    const monthReviews = reviews.filter((review) => inMonth(review, range.start, range.end));

    const mentioned = extractCandidateNames(monthReviews);
    const directory = buildEmployeeDirectory([
      ...(employeesByStore.get(storeName) || []),
      ...Array.from(
        new Set(
          (transactionRows || [])
            .map((row) => row.employeeName)
            .filter(Boolean),
        ),
      ),
      ...mentioned,
    ]);

    const storeTransactions = (transactionRows || []).filter(
      (row) =>
        String(row.storeName || '').localeCompare(storeName, undefined, {
          sensitivity: 'base',
        }) === 0,
    );

    const classified = monthReviews.map((review) =>
      classifyReview(review, directory, storeTransactions),
    );

    const negativeCount = classified.filter((r) => r.rating <= 2).length;
    const fiveStarCount = classified.filter((r) => r.rating === 5).length;
    const eligible = classified.filter((r) => r.eligible);
    const ineligibleFiveStar = classified.filter((r) => r.rating === 5 && !r.eligible);
    const withPhotos = eligible.filter((r) => r.hasPhotos).length;
    const transactionAttributedCount = eligible.filter(
      (r) => r.attributionSource === 'transaction',
    ).length;
    const ratingBreakdown = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const review of classified) {
      const star = Number(review.rating);
      if (ratingBreakdown[star] != null) ratingBreakdown[star] += 1;
    }

    const payout = bonusPerReview(email.rate, negativeCount);
    const employees = employeePayoutRows(classified, payout.amount);

    const storeReviewBonus = eligible.length * payout.amount;
    const storePhotoBonus = withPhotos * PHOTO_BONUS;
    const storeTotal = storeReviewBonus + storePhotoBonus;

    results.push({
      storeName,
      googleConfigured: Boolean(place),
      googleLabel: place?.label || '',
      emailRate: email.rate,
      emailRateLabel: email.rateLabel,
      customerCount: email.customerCount,
      withEmail: email.withEmail,
      walkInCount: email.walkInCount,
      totalTransactions: email.totalTransactions,
      negativeCount,
      fiveStarCount,
      eligibleCount: eligible.length,
      ineligibleFiveStarCount: ineligibleFiveStar.length,
      transactionAttributedCount,
      photoReviewCount: withPhotos,
      ratingBreakdown,
      reviewCount: classified.length,
      perReviewBonus: payout.amount,
      payout,
      reviewBonusTotal: storeReviewBonus,
      photoBonusTotal: storePhotoBonus,
      totalPayout: storeTotal,
      employees,
      reviews: classified.sort((a, b) => (b.timestampMs || 0) - (a.timestampMs || 0)),
      reviewsError,
      reviewsLoaded: reviews.length,
    });
  }

  return {
    range,
    matrix,
    stores: results,
  };
}

export function formatMoney(amount) {
  const value = Number(amount) || 0;
  return `$${value.toLocaleString('en-CA', {
    minimumFractionDigits: value % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}
