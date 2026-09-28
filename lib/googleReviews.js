/**
 * Google Maps reviews via GetLocalBoqProxy (same endpoint Chrome local search uses).
 * Fetched through the authenticated proxy (`google/local-boq`).
 */
import { proxyJson } from './proxy';
import { formatDateParam, parseDateParam } from './transactions';

/** Google place bindings for Canada Gold stores. Add featureId + mapsId per store. */
export const GOOGLE_STORE_PLACES = [
  {
    storeName: 'Laval',
    label: 'Canada Gold Laval',
    featureId: '0x4cc9232a22b06153:0x1e345a29a66f6c67',
    mapsId: '/g/11swrtnxfb',
  },
  {
    storeName: 'Montreal',
    label: 'Canada Or - Montreal (Canada Gold)',
    featureId: '0x4cc919bbb25ad36b:0xaff70ca96768f177',
    mapsId: '/g/11rcll8q99',
  },
  {
    storeName: 'Quebec',
    label: 'Canada Gold Quebec',
    featureId: '0x4cb8977fdee0b7e7:0x355c6c0dc0de49f9',
    mapsId: '/g/11tgc19xs_',
  },
];

function decodeHtml(value) {
  return String(value || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#8212;/g, '—')
    .replace(/&#8217;/g, "'")
    .replace(/&#8230;/g, '…')
    .trim();
}

function photoCountFromReview(raw) {
  const bucket = raw?.[47];
  const pairs = Array.isArray(bucket?.[1]) ? bucket[1] : [];
  for (const pair of pairs) {
    if (Array.isArray(pair) && Number(pair[0]) === 3) {
      return Number(pair[1]) || 0;
    }
  }
  return 0;
}

function parseReview(raw) {
  if (!Array.isArray(raw) || typeof raw[1] !== 'number') return null;
  const rating = raw[1];
  if (rating < 1 || rating > 5) return null;

  const relativeTime = Array.isArray(raw[2]) ? raw[2][0] || '' : '';
  const timestampMs = Array.isArray(raw[2]) && raw[2][2] != null ? Number(raw[2][2]) : null;
  const author = Array.isArray(raw[3]) ? String(raw[3][0] || '').trim() : '';
  const avatarUrl = Array.isArray(raw[3]) ? String(raw[3][1] || '') : '';
  const reviewId = typeof raw[5] === 'string' ? raw[5] : '';

  let text = '';
  if (typeof raw[27] === 'string' && raw[27].trim()) {
    text = decodeHtml(raw[27]);
  } else if (typeof raw[28] === 'string') {
    text = decodeHtml(raw[28]);
  }

  const ownerReply =
    Array.isArray(raw[4]) && typeof raw[4][1] === 'string' ? decodeHtml(raw[4][1]) : '';

  return {
    id: reviewId || `${author}-${timestampMs || relativeTime}-${rating}`,
    rating,
    author,
    avatarUrl,
    relativeTime,
    timestampMs: Number.isFinite(timestampMs) ? timestampMs : null,
    date: timestampMs ? new Date(timestampMs) : null,
    text,
    ownerReply,
    photoCount: photoCountFromReview(raw),
    hasPhotos: photoCountFromReview(raw) > 0,
  };
}

function isReviewLike(review) {
  return Boolean(review && (review.author || review.id) && (review.text || review.relativeTime || review.timestampMs));
}

function collectReviews(node, out, seen) {
  if (!Array.isArray(node)) return;
  const parsed = parseReview(node);
  if (parsed && isReviewLike(parsed)) {
    if (!seen.has(parsed.id)) {
      seen.add(parsed.id);
      out.push(parsed);
    }
    return;
  }
  for (const child of node) collectReviews(child, out, seen);
}

/** Page cursors look like the Safari `reqpld` token: Ci8IARInCgoAP72F9… */
export function looksLikePageToken(value) {
  return typeof value === 'string' && /^Ci[A-Za-z0-9_\-+/]{30,}={0,2}$/.test(value);
}

function collectPageTokens(node, out, depth = 0) {
  if (depth > 10 || out.length > 8) return;
  if (looksLikePageToken(node)) {
    out.push(node);
    return;
  }
  if (!Array.isArray(node)) return;
  for (const child of node) collectPageTokens(child, out, depth + 1);
}

function nextPageToken(payload, usedToken) {
  const body = Array.isArray(payload) ? payload[1] : null;
  const bucket = Array.isArray(body) ? body[10] : null;
  const slotted = bucket?.[6];
  if (looksLikePageToken(slotted) && slotted !== usedToken) return slotted;

  const found = [];
  collectPageTokens(bucket ?? payload, found);
  return found.find((token) => token !== usedToken) || null;
}

export function extractReviewsAndToken(payload, usedToken = null) {
  const body = Array.isArray(payload) ? payload[1] : null;
  const bucket = Array.isArray(body) ? body[10] : null;
  const rawReviews = Array.isArray(bucket?.[2]) ? bucket[2] : [];
  const reviews = rawReviews.map(parseReview).filter(Boolean);
  const nextToken = nextPageToken(payload, usedToken);
  if (reviews.length) return { reviews, nextToken };

  const fallback = [];
  collectReviews(payload, fallback, new Set());
  return { reviews: fallback, nextToken };
}

/**
 * Pull featureId / pagination token / sort mode out of a captured
 * GetLocalBoqProxy URL (the request Chrome/Safari local search fires).
 */
export function parseLocalBoqRequest(input) {
  try {
    const url = new URL(String(input || ''));
    const raw = url.searchParams.get('reqpld');
    if (!raw) return null;
    const reqpld = JSON.parse(raw);
    const inner = Array.isArray(reqpld?.[1]) ? reqpld[1][9] : null;
    if (!Array.isArray(inner)) return null;
    const place = Array.isArray(inner[11]) ? inner[11] : [];
    const featureId = typeof place[0] === 'string' ? place[0] : '';
    const mapsId = typeof place[3] === 'string' ? place[3] : '';
    const token = typeof inner[18] === 'string' && inner[18] ? inner[18] : null;
    const mode = Number(inner[1]) || null;
    const known = GOOGLE_STORE_PLACES.find((item) => item.featureId === featureId) || null;
    return {
      featureId,
      mapsId,
      token,
      mode,
      storeName: known?.storeName || '',
      label: known?.label || '',
    };
  } catch {
    return null;
  }
}

export function summarizeReviews(reviews = []) {
  const breakdown = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let sum = 0;
  for (const review of reviews) {
    const rating = Number(review.rating);
    if (rating >= 1 && rating <= 5) {
      breakdown[rating] += 1;
      sum += rating;
    }
  }
  const count = reviews.length;
  return { count, average: count ? sum / count : 0, breakdown };
}

function startOfDayMs(value) {
  const day = parseDateParam(value);
  return new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
}

function endOfDayMs(value) {
  const day = parseDateParam(value);
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), 23, 59, 59, 999).getTime();
}

/** First-to-last day of a month, clipped to today when it is the current month. */
export function reviewMonthRange(year, monthIndex) {
  const now = parseDateParam(new Date());
  const start = new Date(year, monthIndex, 1);
  const last = new Date(year, monthIndex + 1, 0);
  const isCurrent = start.getFullYear() === now.getFullYear() && start.getMonth() === now.getMonth();
  const end = isCurrent && last > now ? now : last;
  return {
    start,
    end,
    startDate: formatDateParam(start),
    endDate: formatDateParam(end),
    label: start.toLocaleDateString('en-CA', { month: 'long', year: 'numeric' }),
  };
}

export function currentReviewMonth() {
  const now = parseDateParam(new Date());
  return reviewMonthRange(now.getFullYear(), now.getMonth());
}

export function reviewPeriodLabel(startDate, endDate, dateMode = 'range') {
  const start = parseDateParam(startDate);
  const end = parseDateParam(endDate);
  const month = reviewMonthRange(start.getFullYear(), start.getMonth());
  const coversMonth =
    formatDateParam(start) === month.startDate && formatDateParam(end) === month.endDate;
  if (coversMonth) return month.label;
  if (dateMode === 'day' || formatDateParam(start) === formatDateParam(end)) {
    return start.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' });
  }
  const startLabel = start.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
  const endLabel = end.toLocaleDateString('en-CA', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  return `${startLabel} – ${endLabel}`;
}

export function reviewInDateRange(review, startDate, endDate) {
  if (startDate == null && endDate == null) return true;
  const startMs = startDate != null ? startOfDayMs(startDate) : null;
  const endMs = endDate != null ? endOfDayMs(endDate) : null;
  const ts = Number(review?.timestampMs);
  if (Number.isFinite(ts)) {
    if (startMs != null && ts < startMs) return false;
    if (endMs != null && ts > endMs) return false;
    return true;
  }
  const now = Date.now();
  if (startMs != null && now < startMs) return false;
  if (endMs != null && now > endMs) return false;
  return true;
}

export function filterReviewsByDateRange(reviews = [], startDate, endDate) {
  if (startDate == null && endDate == null) return reviews;
  return reviews.filter((review) => reviewInDateRange(review, startDate, endDate));
}

async function fetchBoqPage({ featureId, mapsId, token }) {
  const params = new URLSearchParams({ featureId });
  if (mapsId) params.set('mapsId', mapsId);
  if (token) params.set('token', token);

  const payload = await proxyJson(`google/local-boq?${params.toString()}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  if (!Array.isArray(payload)) {
    throw new Error(payload?.error?.message || 'Google reviews returned an unexpected response.');
  }
  return payload;
}

/** One GetLocalBoqProxy page — first page is token=null, later pages pass the cursor from the previous response. */
export async function fetchGoogleReviewsPage({ featureId, mapsId, token } = {}) {
  if (!featureId) {
    throw new Error('Google place featureId is required.');
  }
  const payload = await fetchBoqPage({ featureId, mapsId, token });
  return extractReviewsAndToken(payload, token || null);
}

/** Safety cap while following GetLocalBoqProxy cursors (same scroll tokens Google uses). */
export const GOOGLE_REVIEW_MAX_PAGES = 80;

/**
 * Fetch Google reviews for a configured place, following pagination.
 * Pass startDate/endDate to stop once Google has scrolled past that window.
 * @param {{ featureId: string, mapsId?: string, maxPages?: number, onPage?: Function, startDate?: Date|string, endDate?: Date|string }} options
 */
export async function fetchGoogleReviewsForPlace({
  featureId,
  mapsId,
  maxPages = GOOGLE_REVIEW_MAX_PAGES,
  onPage,
  startDate,
  endDate,
} = {}) {
  if (!featureId) {
    throw new Error('Google place featureId is required.');
  }

  const startMs = startDate != null ? startOfDayMs(startDate) : null;
  const all = [];
  const seen = new Set();
  let token = null;
  let pageError = '';

  const visible = () => filterReviewsByDateRange(all, startDate, endDate);

  for (let page = 0; page < maxPages; page += 1) {
    let reviews = [];
    let nextToken = null;
    try {
      ({ reviews, nextToken } = await fetchGoogleReviewsPage({ featureId, mapsId, token }));
    } catch (error) {
      pageError = error?.message || 'Failed to load more Google reviews.';
      onPage?.({
        page: page + 1,
        added: 0,
        reviews: visible(),
        nextToken: null,
        done: true,
        error: pageError,
      });
      break;
    }
    for (const review of reviews) {
      if (seen.has(review.id)) continue;
      seen.add(review.id);
      all.push(review);
    }
    const dated = reviews.filter((review) => Number.isFinite(review.timestampMs));
    const oldestOnPage = dated.length
      ? Math.min(...dated.map((review) => review.timestampMs))
      : null;
    const pastStart = startMs != null && oldestOnPage != null && oldestOnPage < startMs;
    const done = !nextToken || nextToken === token || reviews.length === 0 || pastStart;
    const inRange = visible();
    onPage?.({
      page: page + 1,
      added: reviews.length,
      reviews: inRange,
      nextToken: done ? null : nextToken,
      done,
    });
    if (done) break;
    token = nextToken;
  }

  const inRange = visible();
  inRange.sort((a, b) => (b.timestampMs || 0) - (a.timestampMs || 0));
  if (!inRange.length && pageError) throw new Error(pageError);
  return inRange;
}

export function getGooglePlaceForStore(storeName) {
  const key = String(storeName || '').trim().toLowerCase();
  if (!key) return null;
  return (
    GOOGLE_STORE_PLACES.find(
      (place) => place.storeName.toLowerCase() === key || place.label.toLowerCase() === key,
    ) || null
  );
}

export async function fetchGoogleReviewsForStore(
  storeName,
  { maxPages = GOOGLE_REVIEW_MAX_PAGES, onPage, startDate, endDate } = {},
) {
  const place = getGooglePlaceForStore(storeName);
  if (!place) {
    return { storeName, place: null, reviews: [], error: 'No Google place configured for this store.' };
  }
  try {
    const reviews = await fetchGoogleReviewsForPlace({
      featureId: place.featureId,
      mapsId: place.mapsId,
      maxPages,
      onPage,
      startDate,
      endDate,
    });
    return { storeName: place.storeName, place, reviews, error: '' };
  } catch (error) {
    return {
      storeName: place.storeName,
      place,
      reviews: [],
      error: error?.message || 'Failed to load Google reviews.',
    };
  }
}

export async function fetchAllGoogleStoreReviews({
  maxPages = GOOGLE_REVIEW_MAX_PAGES,
  storeName,
  onPage,
  startDate,
  endDate,
} = {}) {
  const key = String(storeName || '').trim().toLowerCase();
  const places = key
    ? GOOGLE_STORE_PLACES.filter(
        (place) => place.storeName.toLowerCase() === key || place.label.toLowerCase() === key,
      )
    : GOOGLE_STORE_PLACES;
  const out = [];
  for (const place of places) {
    out.push(
      await fetchGoogleReviewsForStore(place.storeName, {
        maxPages,
        startDate,
        endDate,
        onPage: onPage
          ? (info) => onPage({ storeName: place.storeName, ...info })
          : undefined,
      }),
    );
  }
  return out;
}
