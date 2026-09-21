/**
 * Canada Gold staff portraits. The raw photo is sent through the proxy, which
 * restyles that same person as a fun Disney cartoon, with a unique shirt
 * and background so portraits do not all look the same.
 *
 * Flow: inspect the photo (exactly one clear face, who is it) → draw → the
 * server compares the cartoon with the photo → redraw with corrections if it
 * does not look like them. Transient network / gateway failures are retried
 * so one slow model call does not leave the user with nothing.
 */
import { compressImageDataUrl } from './openrouter';
import { ProxyError, proxyFetch } from './proxy';

const SOURCE_MAX_WIDTH = 1280;
const SOURCE_QUALITY = 0.82;
const PORTRAIT_MAX_WIDTH = 768;
const PORTRAIT_QUALITY = 0.84;
/** Drawing passes before we accept the closest result. */
const MAX_DRAW_ATTEMPTS = 3;
/** Extra tries per network call when the failure is transient (5xx, 429, network). */
const TRANSIENT_RETRIES = 1;
const RETRY_DELAY_MS = 1500;
const GENERIC_CORRECTION =
  'Study the photo again and match this exact person: same face, same gender presentation, same hair, same skin tone, same glasses or none.';

function asString(value) {
  if (value == null) return '';
  return String(value).trim();
}

function parseDataUrl(value) {
  const match = asString(value).match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) return null;
  return { mediaType: match[1], data: match[2] };
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Could not read that photo.'));
    reader.readAsDataURL(blob);
  });
}

export async function assetToDataUrl(asset) {
  if (typeof asset === 'string') {
    if (parseDataUrl(asset)) return asset;
    throw new Error('Choose a photo first.');
  }

  const uri = asString(asset?.uri);
  if (parseDataUrl(uri)) return uri;

  const mime = asString(asset?.mimeType || asset?.type || 'image/jpeg') || 'image/jpeg';
  if (asset?.base64) return `data:${mime};base64,${asset.base64}`;
  if (!uri) throw new Error('Choose a photo first.');

  const response = await fetch(uri);
  if (!response.ok) throw new Error('Could not read that photo.');
  return blobToDataUrl(await response.blob());
}

export async function prepareAvatarAsset(dataUrl) {
  const compressed = await compressImageDataUrl(dataUrl, {
    maxWidth: PORTRAIT_MAX_WIDTH,
    quality: PORTRAIT_QUALITY,
  });
  return { uri: compressed, mimeType: 'image/jpeg' };
}

function isAbort(err, signal) {
  return Boolean(signal?.aborted) || err?.name === 'AbortError';
}

/** Worth an automatic retry: gateway / model hiccups, not a bad photo. */
export function isTransientAvatarError(err) {
  if (!err || err.name === 'AbortError') return false;
  const status = Number(err.status);
  if (Number.isFinite(status) && status > 0) return status >= 500 || status === 429 || status === 408;
  // fetch() rejects with a TypeError when the network drops.
  return err.name === 'TypeError' || /network|fetch|load failed|timed out/i.test(String(err.message || ''));
}

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener?.('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
    };
    signal?.addEventListener?.('abort', onAbort, { once: true });
  });
}

async function postAvatar(path, body, signal) {
  const response = await proxyFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      payload?.error?.message || payload?.message || 'Could not draw that portrait. Try another photo.';
    throw new ProxyError(message, response.status, payload?.error?.code);
  }
  return payload || {};
}

async function withTransientRetry(run, { signal, onRetry } = {}) {
  let lastError;
  for (let i = 0; i <= TRANSIENT_RETRIES; i += 1) {
    try {
      return await run();
    } catch (err) {
      if (isAbort(err, signal)) throw err;
      if (!isTransientAvatarError(err) || i === TRANSIENT_RETRIES) throw err;
      lastError = err;
      onRetry?.(err);
      await delay(RETRY_DELAY_MS, signal);
    }
  }
  throw lastError;
}

/**
 * Look at the photo before drawing: is there exactly one clear face, and
 * who is it? Throws a user-facing error (with `retake: true`) when the photo
 * cannot produce an accurate portrait. If the vision service is down we let
 * the drawing step proceed rather than block the user.
 */
export async function inspectAvatarPhoto(compressed, { signal } = {}) {
  let inspection;
  try {
    inspection = await withTransientRetry(() => postAvatar('avatars/inspect', { image: compressed }, signal), { signal });
  } catch (err) {
    if (isAbort(err, signal) || !isTransientAvatarError(err)) throw err;
    return { ok: true, subject: '', faceCount: null, framing: 'unknown' };
  }
  if (inspection?.ok === false) {
    const error = new Error(asString(inspection.message) || 'We could not see a face clearly. Try another photo.');
    error.code = asString(inspection.reason) || 'photo_rejected';
    error.retake = true;
    throw error;
  }
  return {
    ok: true,
    subject: asString(inspection?.subject),
    faceCount: inspection?.faceCount ?? null,
    framing: asString(inspection?.framing) || 'unknown',
  };
}

/**
 * Restyle a webcam still or library photo into a Disney cartoon of them.
 * Resolves to `{ image, verified, attempts }` where `image` is a JPEG data
 * URL ready to upload and `verified` is true when the likeness check passed,
 * false when every pass was flagged, or null when the check could not run.
 * `onStatus(text)` receives short progress messages for the UI.
 */
export async function stylizeAvatarPhoto(asset, { signal, onStatus } = {}) {
  const source = await assetToDataUrl(asset);
  const compressed = await compressImageDataUrl(source, {
    maxWidth: SOURCE_MAX_WIDTH,
    quality: SOURCE_QUALITY,
  });
  if (!parseDataUrl(compressed)) throw new Error('Choose a JPEG, PNG, or WebP photo.');

  onStatus?.('Checking your photo…');
  const inspection = await inspectAvatarPhoto(compressed, { signal });

  let best = '';
  let corrections = [];
  let attemptsMade = 0;

  for (let attempt = 1; attempt <= MAX_DRAW_ATTEMPTS; attempt += 1) {
    attemptsMade = attempt;
    onStatus?.(
      attempt === 1
        ? 'Drawing your portrait…'
        : `Fixing the likeness (pass ${attempt} of ${MAX_DRAW_ATTEMPTS})…`,
    );

    let result;
    try {
      result = await withTransientRetry(
        () =>
          postAvatar(
            'avatars/stylize',
            { image: compressed, subject: inspection.subject, corrections, attempt },
            signal,
          ),
        {
          signal,
          onRetry: () => onStatus?.('Taking longer than usual — trying again…'),
        },
      );
    } catch (err) {
      if (isAbort(err, signal)) throw err;
      // A transient failure on a retry pass should not throw away a usable earlier drawing.
      if (best && isTransientAvatarError(err)) break;
      throw err;
    }

    const image = asString(result?.image);
    if (!parseDataUrl(image)) {
      if (best) break;
      throw new Error('Portrait service did not return an image.');
    }

    // Verified, or the check could not run: this is the portrait.
    if (result?.verified !== false) {
      return { image, verified: result?.verified === true ? true : null, attempts: attempt };
    }

    best = image;
    const issues = Array.isArray(result?.issues) ? result.issues.map(asString).filter(Boolean) : [];
    corrections = issues.length > 0 ? issues : [GENERIC_CORRECTION];
  }

  return { image: best, verified: false, attempts: attemptsMade };
}
