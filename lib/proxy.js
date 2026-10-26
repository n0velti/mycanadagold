/**
 * Client for the `proxy` Edge Function. Every third-party call (AI models,
 * FINTRAC, Rippling, Google reviews) goes through it with the staff JWT so
 * vendor secrets stay server-side and CORS is never an issue on the web.
 */
import { getPublishableKey, getSupabase, getSupabaseUrl } from './supabase';

export class ProxyError extends Error {
  constructor(message, status, code) {
    super(message);
    this.name = 'ProxyError';
    this.status = status;
    this.code = code;
  }
}

const PROXY_CODES = new Set([
  'unauthenticated',
  'forbidden',
  'deactivated',
  'throttled',
  'too_large',
  'missing_key',
  'misconfigured',
  'rippling_unconfigured',
  'rippling_unauthenticated',
  'fintrac_unauthenticated',
  'method_not_allowed',
  'bad_request',
  'moneris_unconfigured',
  'ringcentral_unconfigured',
  'gmail_unconfigured',
  'gmail_unauthenticated',
  'not_found',
]);

async function accessToken() {
  const { data } = await getSupabase().auth.getSession();
  return data?.session?.access_token || '';
}

export function proxyUrl(path) {
  const clean = String(path || '').replace(/^\/+/, '');
  return `${getSupabaseUrl()}/functions/v1/proxy/${clean}`;
}

// ---------------------------------------------------------------------------
// Transport: bounded in-flight calls + throttle retry
// ---------------------------------------------------------------------------

/**
 * Supabase meters Edge Function invocations. One tab can trip that meter on
 * its own: screens fan POS reads out across three tenants, paginated, each
 * call preceded by a CORS preflight that counts too. The platform answers
 * `429 {"code":"RATE_LIMIT_EXCEEDED","message":"Too many requests. Re-try the
 * request in 1 seconds."}`; when the preflight is the call refused, the browser
 * only reports "Load failed" / "Failed to fetch". Every call to the function
 * goes through here: a bounded number in flight, a shared pause whenever the
 * platform asks for one, and a short retry for the call that was refused.
 */
const MAX_IN_FLIGHT = 8;
/** A slot covers the wait for response headers; anything slower is not part of a burst. */
const MAX_SLOT_HOLD_MS = 10_000;
const MAX_THROTTLE_RETRIES = 3;
const MAX_NETWORK_RETRIES = 2;
const DEFAULT_RETRY_MS = 1000;
const MAX_RETRY_MS = 10_000;
const NETWORK_RETRY_MS = 600;
const PLATFORM_RATE_LIMIT_CODE = 'RATE_LIMIT_EXCEEDED';

let inFlight = 0;
let pausedUntil = 0;
let pumpTimer = null;
const waiting = [];

function pump() {
  const now = Date.now();
  if (pausedUntil > now) {
    if (!pumpTimer) {
      pumpTimer = setTimeout(() => {
        pumpTimer = null;
        pump();
      }, pausedUntil - now);
    }
    return;
  }
  while (inFlight < MAX_IN_FLIGHT && waiting.length) {
    const entry = waiting.shift();
    inFlight += 1;
    entry.resolve(slotRelease());
  }
}

function slotRelease() {
  let done = false;
  const release = () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    inFlight -= 1;
    pump();
  };
  const timer = setTimeout(release, MAX_SLOT_HOLD_MS);
  return release;
}

function abortError(signal) {
  if (signal?.reason) return signal.reason;
  const error = new Error('The operation was aborted.');
  error.name = 'AbortError';
  return error;
}

function acquireSlot(signal) {
  if (signal?.aborted) return Promise.reject(abortError(signal));
  return new Promise((resolve, reject) => {
    const entry = {
      resolve: (release) => {
        signal?.removeEventListener?.('abort', onAbort);
        resolve(release);
      },
    };
    const onAbort = () => {
      const index = waiting.indexOf(entry);
      if (index >= 0) waiting.splice(index, 1);
      reject(abortError(signal));
    };
    signal?.addEventListener?.('abort', onAbort, { once: true });
    waiting.push(entry);
    pump();
  });
}

function pauseProxyCalls(ms) {
  pausedUntil = Math.max(pausedUntil, Date.now() + ms);
}

function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError(signal));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError(signal));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener?.('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener?.('abort', onAbort, { once: true });
  });
}

function jitter() {
  return Math.floor(Math.random() * 400);
}

/** fetch() rejects with a TypeError for CORS and network failures. */
function isNetworkFailure(error) {
  return error instanceof TypeError || error?.name === 'TypeError';
}

/** Strings, FormData, Blobs, and buffers can be sent again; a stream cannot. */
function bodyResendable(body) {
  if (body == null || typeof body === 'string') return true;
  return !(typeof ReadableStream !== 'undefined' && body instanceof ReadableStream);
}

function retryAfterHeaderMs(response) {
  const seconds = Number(response.headers.get('retry-after'));
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0;
}

function retryHintFromMessage(message) {
  const match = /in\s+(\d+(?:\.\d+)?)\s*(ms|milliseconds?|s|secs?|seconds?)\b/i.exec(String(message || ''));
  if (!match) return 0;
  const value = Number(match[1]);
  return /^m/i.test(match[2]) ? value : value * 1000;
}

/**
 * Milliseconds to wait before sending again, or 0 when this response should be
 * returned as-is. Only the platform limiter is retried here: a 429 from the
 * proxy's own per-user bucket or from a vendor is the caller's to explain.
 */
async function throttleRetryMs(response) {
  if (response.status !== 429) return 0;
  let payload = null;
  try {
    payload = await response.clone().json();
  } catch {
    payload = null;
  }
  const code = response.headers.get('sb-error-code') || payload?.code || payload?.error?.code || '';
  const message = String(payload?.message || payload?.error?.message || '');
  const platform = code === PLATFORM_RATE_LIMIT_CODE || /re-?try the request in \d+/i.test(message);
  if (!platform) return 0;
  const hint = retryAfterHeaderMs(response) || retryHintFromMessage(message) || DEFAULT_RETRY_MS;
  return Math.min(Math.max(hint, DEFAULT_RETRY_MS), MAX_RETRY_MS);
}

/**
 * fetch() against the Edge Function with the gate and retries above. Network
 * failures are retried for GET/HEAD only; a throttled call is re-sent when its
 * body can be. The last response or error is handed back unchanged.
 */
export async function proxyTransportFetch(url, init) {
  const signal = init?.signal;
  const method = String(init?.method || 'GET').toUpperCase();
  const idempotent = method === 'GET' || method === 'HEAD';
  const resendable = bodyResendable(init?.body);
  let throttleRetries = 0;
  let networkRetries = 0;
  for (;;) {
    const release = await acquireSlot(signal);
    let response;
    try {
      response = await fetch(url, init);
    } catch (error) {
      release();
      if (!idempotent || networkRetries >= MAX_NETWORK_RETRIES || signal?.aborted || !isNetworkFailure(error)) {
        throw error;
      }
      networkRetries += 1;
      await wait(NETWORK_RETRY_MS * networkRetries + jitter(), signal);
      continue;
    }
    release();
    const retryMs = resendable && throttleRetries < MAX_THROTTLE_RETRIES ? await throttleRetryMs(response) : 0;
    if (!retryMs) return response;
    throttleRetries += 1;
    pauseProxyCalls(retryMs);
    await wait(retryMs + NETWORK_RETRY_MS * (throttleRetries - 1) + jitter(), signal);
  }
}

/**
 * Staff JWT + publishable key for a raw fetch() against the proxy, or null
 * when there is no Supabase session. `lib/auth.js` uses this to relay POS
 * calls the browser cannot make directly.
 */
export async function proxyAuthHeaders() {
  const token = await accessToken();
  if (!token) return null;
  return { Authorization: `Bearer ${token}`, apikey: getPublishableKey() };
}

/**
 * fetch() against the proxy. `upstreamAuthorization` forwards the caller's
 * own vendor session (FINTRAC / Rippling). AI keys stay on the server.
 * Returns the raw Response so callers can stream. Throws ProxyError only
 * when the proxy itself rejects the call.
 */
export async function proxyFetch(path, { upstreamAuthorization, upstreamApiKey, headers, ...init } = {}) {
  const token = await accessToken();
  if (!token) {
    throw new ProxyError('Your session has expired. Sign in again.', 401, 'unauthenticated');
  }

  const merged = new Headers(headers || {});
  merged.set('Authorization', `Bearer ${token}`);
  merged.set('apikey', getPublishableKey());
  if (upstreamAuthorization) merged.set('X-Upstream-Authorization', upstreamAuthorization);
  if (upstreamApiKey) merged.set('X-Upstream-Api-Key', upstreamApiKey);

  const response = await proxyTransportFetch(proxyUrl(path), { ...init, headers: merged });

  // Proxy-level rejections are JSON { error: { message, code } } with these codes;
  // anything else is an upstream response the caller interprets itself.
  if (response.status >= 400 && response.status !== 404) {
    const payload = await response.clone().json().catch(() => null);
    const code = payload?.error?.code;
    if (PROXY_CODES.has(code)) {
      throw new ProxyError(payload.error.message, response.status, code);
    }
  }
  return response;
}

/** Convenience for JSON endpoints. */
export async function proxyJson(path, options = {}) {
  const response = await proxyFetch(path, options);
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload?.error?.message || payload?.message || `Request failed (${response.status}).`;
    throw new ProxyError(typeof message === 'string' ? message : `Request failed (${response.status}).`, response.status, payload?.error?.code);
  }
  return payload;
}
