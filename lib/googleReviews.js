/**
 * Google Maps reviews via GetLocalBoqProxy (same endpoint Chrome local search uses).
 * Fetched through the authenticated proxy (`google/local-boq`).
 */
import { proxyJson } from './proxy';

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

function extractReviewsAndToken(payload) {
  const body = Array.isArray(payload) ? payload[1] : null;
  const bucket = Array.isArray(body) ? body[10] : null;
  if (!Array.isArray(bucket)) {
    return { reviews: [], nextToken: null };
  }
  const rawReviews = Array.isArray(bucket[2]) ? bucket[2] : [];
  const reviews = rawReviews.map(parseReview).filter(Boolean);
  const nextToken = typeof bucket[6] === 'string' && bucket[6] ? bucket[6] : null;
  return { reviews, nextToken };
}

async function fetchBoqPage({ featureId, mapsId, token }) {
  const params = new URLSearchParams({
    featureId,
    mapsId,
  });
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

/**
 * Fetch Google reviews for a configured place, following pagination.
 * @param {{ featureId: string, mapsId: string, maxPages?: number }} options
 */
export async function fetchGoogleReviewsForPlace({
  featureId,
  mapsId,
  maxPages = 8,
} = {}) {
  if (!featureId || !mapsId) {
    throw new Error('Google place featureId and mapsId are required.');
  }

  const all = [];
  const seen = new Set();
  let token = null;

  for (let page = 0; page < maxPages; page += 1) {
    const payload = await fetchBoqPage({ featureId, mapsId, token });
    const { reviews, nextToken } = extractReviewsAndToken(payload);
    for (const review of reviews) {
      if (seen.has(review.id)) continue;
      seen.add(review.id);
      all.push(review);
    }
    if (!nextToken || reviews.length === 0) break;
    token = nextToken;
  }

  all.sort((a, b) => (b.timestampMs || 0) - (a.timestampMs || 0));
  return all;
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

export async function fetchGoogleReviewsForStore(storeName, { maxPages = 8 } = {}) {
  const place = getGooglePlaceForStore(storeName);
  if (!place) {
    return { storeName, place: null, reviews: [], error: 'No Google place configured for this store.' };
  }
  try {
    const reviews = await fetchGoogleReviewsForPlace({
      featureId: place.featureId,
      mapsId: place.mapsId,
      maxPages,
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
