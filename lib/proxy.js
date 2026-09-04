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
]);

async function accessToken() {
  const { data } = await getSupabase().auth.getSession();
  return data?.session?.access_token || '';
}

function proxyUrl(path) {
  const clean = String(path || '').replace(/^\/+/, '');
  return `${getSupabaseUrl()}/functions/v1/proxy/${clean}`;
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

  const response = await fetch(proxyUrl(path), { ...init, headers: merged });

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
