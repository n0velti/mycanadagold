/**
 * Google review text for the Analytics assistant. The reviews dataset and
 * the review metrics count stars; this reads the words. It loads the same
 * listings the Reviews app shows, for one store or every store over a
 * window, works out each store's star mix in code, and hands the model a
 * sample of the text that fits inside one tool result, so it can describe
 * the mood and the recurring themes instead of guessing them from counts.
 *
 * Access follows the Reviews app exactly: the employee-directory grant gates
 * the whole thing, and a self-scope viewer only reads reviews that name them
 * or match their own tickets.
 */
import { BONUS_ACCESS_DENIED, canViewBonusReviewData } from './auth';
import { bonusBoardAccessDenied, canViewAllBonusCounts, filterReviewsForViewer } from './bonuses';
import {
  fetchGoogleReviewsForStore,
  getGooglePlaceForStore,
  GOOGLE_STORE_PLACES,
  summarizeReviews,
} from './googleReviews';
import { fetchTransactionsAcrossPos, formatDateParam } from './transactions';

/** Longest excerpt of one review the model reads. */
export const REVIEW_EXCERPT_CHARS = 320;
const REPLY_EXCERPT_CHARS = 160;
const AUTHOR_CHARS = 40;

export function squashReviewText(text, limit = REVIEW_EXCERPT_CHARS) {
  const flat = String(text || '').replace(/\s+/g, ' ').trim();
  if (flat.length <= limit) return flat;
  return `${flat.slice(0, limit - 1).trimEnd()}…`;
}

function foldText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function isNegative(review) {
  const rating = Number(review?.rating);
  return rating >= 1 && rating <= 2;
}

function newestFirst(a, b) {
  return (Number(b?.timestampMs) || 0) - (Number(a?.timestampMs) || 0);
}

function reviewDay(review) {
  const ts = Number(review?.timestampMs);
  if (Number.isFinite(ts) && ts > 0) return formatDateParam(new Date(ts));
  return String(review?.relativeTime || '').trim();
}

function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function pct(part, whole) {
  if (!whole) return null;
  return Math.round((part / whole) * 100);
}

/** One review as the model (and show_table) sees it. Replies ride along on unhappy reviews only. */
export function readingRow(review, store) {
  const row = {
    store,
    date: reviewDay(review),
    rating: Number(review?.rating) || 0,
    author: String(review?.author || '').trim().slice(0, AUTHOR_CHARS) || undefined,
    text: squashReviewText(review?.text),
    replied: review?.ownerReply ? 'yes' : 'no',
  };
  if (isNegative(review) && review?.ownerReply) {
    row.reply = squashReviewText(review.ownerReply, REPLY_EXCERPT_CHARS);
  }
  return row;
}

/** Keep reviews with any of the asked star ratings and every searched word in the text. */
export function filterReviewsForReading(reviews, { ratings = [], search = '' } = {}) {
  const stars = new Set((ratings || []).map((value) => Number(value)).filter((value) => value >= 1 && value <= 5));
  const words = foldText(search).split(/\s+/).filter(Boolean);
  return (reviews || []).filter((review) => {
    if (stars.size && !stars.has(Number(review?.rating))) return false;
    if (!words.length) return true;
    const haystack = foldText(review?.text);
    return words.every((word) => haystack.includes(word));
  });
}

/**
 * Pick the reviews the model reads, inside a character budget. Within a
 * store, every 1–2 star review comes first (they are few and they carry the
 * complaints), then the newest of the rest; stores take turns so an
 * all-store read covers every listing. The star counts, not this sample,
 * say how the window felt overall, and the tool note tells the model so.
 */
export function selectReviewsForReading(batches, { maxChars = 10000 } = {}) {
  const queues = (batches || [])
    .map((batch) => ({
      store: batch.store,
      items: (batch.reviews || [])
        .filter((review) => squashReviewText(review?.text))
        .sort((a, b) => Number(isNegative(b)) - Number(isNegative(a)) || newestFirst(a, b))
        .map((review) => ({ review, row: readingRow(review, batch.store) })),
    }))
    .filter((queue) => queue.items.length);
  const picked = [];
  const shownByStore = new Map();
  let used = 2;
  let full = false;
  for (let index = 0; !full; index += 1) {
    let any = false;
    for (const queue of queues) {
      const item = queue.items[index];
      if (!item) continue;
      any = true;
      const cost = JSON.stringify(item.row).length + 1;
      if (used + cost > maxChars) {
        full = true;
        break;
      }
      used += cost;
      picked.push(item);
      shownByStore.set(queue.store, (shownByStore.get(queue.store) || 0) + 1);
    }
    if (!any) break;
  }
  picked.sort((a, b) => newestFirst(a.review, b.review));
  return { rows: picked.map((item) => item.row), shownByStore };
}

/** Star mix for one store's window: what the model should judge the mood from. */
export function storeReviewMix(store, reviews) {
  const summary = summarizeReviews(reviews);
  const positive = (summary.breakdown[5] || 0) + (summary.breakdown[4] || 0);
  const negative = (summary.breakdown[2] || 0) + (summary.breakdown[1] || 0);
  return {
    store,
    reviews: summary.count,
    average: summary.count ? round2(summary.average) : null,
    positivePct: pct(positive, summary.count),
    negativePct: pct(negative, summary.count),
    stars5: summary.breakdown[5] || 0,
    stars4: summary.breakdown[4] || 0,
    stars3: summary.breakdown[3] || 0,
    stars2: summary.breakdown[2] || 0,
    stars1: summary.breakdown[1] || 0,
  };
}

function resolvePlaces(stores) {
  const places = [];
  const unknown = [];
  for (const name of stores || []) {
    const place = getGooglePlaceForStore(name);
    if (!place) unknown.push(String(name || '').trim());
    else if (!places.includes(place)) places.push(place);
  }
  return { places, unknown };
}

export function googleReviewStoreNames() {
  return GOOGLE_STORE_PLACES.map((place) => place.storeName);
}

/**
 * Reviews for the assistant: per-store star mix plus the text sample.
 * `stores` empty means every Google listing. Dates are inclusive YYYY-MM-DD.
 * `maxChars` bounds the JSON of what comes back (stores + reviews together).
 */
export async function loadReviewReading(
  session,
  { stores = [], startDate, endDate, ratings = [], search = '', maxChars = 12000, onProgress } = {},
) {
  if (bonusBoardAccessDenied(session)) return { error: BONUS_ACCESS_DENIED };
  const { places, unknown } = resolvePlaces(stores);
  if (unknown.length) {
    return {
      error: `No Google listing for ${unknown.join(', ')}. Stores with reviews: ${googleReviewStoreNames().join(', ')}.`,
    };
  }
  const wanted = places.length ? places : GOOGLE_STORE_PLACES;
  const selfOnly = Boolean(session?.profile) && !canViewAllBonusCounts(session.profile);
  const purpose = canViewBonusReviewData(session) === true ? 'bonus' : 'home';
  const filtered = Boolean((ratings || []).length || String(search || '').trim());

  let pages = 0;
  const [batches, transactionRows] = await Promise.all([
    Promise.all(
      wanted.map((place) =>
        fetchGoogleReviewsForStore(place.storeName, {
          startDate,
          endDate,
          purpose,
          onPage: (info) => {
            if (info?.done) return;
            pages += 1;
            onProgress?.(pages);
          },
        }),
      ),
    ),
    selfOnly
      ? fetchTransactionsAcrossPos(session, { startDate, endDate }).then((tx) => tx?.rows || [])
      : Promise.resolve([]),
  ]);

  const errors = [];
  const perStore = wanted.map((place, index) => {
    const batch = batches[index] || {};
    const visible = selfOnly
      ? filterReviewsForViewer(batch.reviews || [], session.profile, { transactionRows, storeName: place.storeName })
      : batch.reviews || [];
    const matching = filtered ? filterReviewsForReading(visible, { ratings, search }) : visible;
    if (batch.error) errors.push(`${place.storeName}: ${batch.error}`);
    return { place, visible, matching, error: batch.error || '' };
  });

  const storeRows = perStore.map(({ place, visible, matching, error }) => ({
    ...storeReviewMix(place.storeName, visible),
    matching: filtered ? matching.length : undefined,
    withText: matching.filter((review) => squashReviewText(review?.text)).length,
    replied: matching.filter((review) => review?.ownerReply).length,
    shown: 0,
    error: error || undefined,
  }));

  const fixed = JSON.stringify({ stores: storeRows, errors }).length;
  const { rows, shownByStore } = selectReviewsForReading(
    perStore.map(({ place, matching }) => ({ store: place.storeName, reviews: matching })),
    { maxChars: Math.max(0, maxChars - fixed) },
  );
  for (const row of storeRows) row.shown = shownByStore.get(row.store) || 0;

  const totals = storeRows.reduce(
    (acc, row) => ({
      reviews: acc.reviews + row.reviews,
      matching: acc.matching + (row.matching ?? row.reviews),
      withText: acc.withText + row.withText,
      shown: acc.shown + row.shown,
    }),
    { reviews: 0, matching: 0, withText: 0, shown: 0 },
  );

  return {
    location: places.length ? places.map((place) => place.storeName).join(', ') : 'All stores',
    selfOnly: selfOnly || undefined,
    filtered: filtered ? { ratings: (ratings || []).length ? ratings : undefined, search: search || undefined } : undefined,
    totals,
    stores: storeRows,
    reviews: rows,
    errors: errors.length ? errors : undefined,
  };
}
