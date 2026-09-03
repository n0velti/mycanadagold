/**
 * proxy — authenticated gateway to third-party APIs.
 *
 * Every request must carry a staff JWT minted by aureus-login and belong to an
 * active profile. Vendor secrets never leave this function:
 *
 *   /proxy/anthropic/v1/messages           POST  → api.anthropic.com
 *   /proxy/openai/v1/chat/completions      POST  → api.openai.com
 *   /proxy/openrouter/v1/chat/completions  POST  → openrouter.ai
 *   /proxy/fintrac/<path>                  *     → www142.fintrac-canafe.canada.ca
 *   /proxy/rippling/oauth/config           GET   → { clientId, configured }
 *   /proxy/rippling/oauth/token            POST  → app.rippling.com/o/token (client secret held here)
 *   /proxy/rippling/<path>                 GET   → rest.ripplingapis.com
 *   /proxy/google/local-boq                GET   → Google local reviews (GetLocalBoqProxy)
 *
 * AI providers use the server key from secrets unless the caller supplies its
 * own via `X-Upstream-Api-Key`. FINTRAC and Rippling user tokens are forwarded
 * from `X-Upstream-Authorization` (the caller's own session with that vendor).
 */
import { corsHeaders, error, preflight, securityHeaders } from '../_shared/http.ts';
import { requireActiveStaff, StaffAuthError } from '../_shared/staff.ts';

const FUNCTION_PREFIX = '/proxy';
const MAX_BODY_BYTES = 25 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 120_000;

const FINTRAC_ORIGIN = 'https://www142.fintrac-canafe.canada.ca';
const RIPPLING_API_ORIGIN = 'https://rest.ripplingapis.com';
const RIPPLING_OAUTH_TOKEN_URL = 'https://app.rippling.com/o/token';
const GOOGLE_BOQ_URL = 'https://www.google.com/httpservice/web/PrivateLocalSearchUiDataService/GetLocalBoqProxy';

// Per-isolate request throttle: cheap protection against a runaway client.
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT_AI = 60;
const RATE_LIMIT_OTHER = 240;
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

function throttled(key: string, limit: number): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    if (rateBuckets.size > 10_000) {
      for (const [k, v] of rateBuckets) if (v.resetAt <= now) rateBuckets.delete(k);
    }
    return false;
  }
  bucket.count += 1;
  return bucket.count > limit;
}

function upstreamAuthorization(req: Request): string {
  return req.headers.get('x-upstream-authorization') || '';
}

function upstreamApiKey(req: Request, envName: string): string {
  const fromClient = (req.headers.get('x-upstream-api-key') || '').trim();
  if (fromClient) return fromClient;
  return (Deno.env.get(envName) || '').trim();
}

async function readBody(req: Request): Promise<ArrayBuffer | null> {
  if (req.method === 'GET' || req.method === 'HEAD') return null;
  const declared = Number(req.headers.get('content-length') || 0);
  if (declared > MAX_BODY_BYTES) throw new Error('Request body too large.');
  const buffer = await req.arrayBuffer();
  if (buffer.byteLength > MAX_BODY_BYTES) throw new Error('Request body too large.');
  return buffer;
}

function passthroughResponse(req: Request, upstream: Response): Response {
  const headers = new Headers({ ...corsHeaders(req), ...securityHeaders() });
  const contentType = upstream.headers.get('content-type');
  if (contentType) headers.set('Content-Type', contentType);
  const contentLength = upstream.headers.get('content-length');
  if (contentLength && !contentType?.includes('text/event-stream')) {
    headers.set('Content-Length', contentLength);
  }
  return new Response(upstream.body, { status: upstream.status, headers });
}

async function forward(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    // Streams keep the body open after headers arrive; only the connect phase is timed.
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// AI providers
// ---------------------------------------------------------------------------

async function handleAnthropic(req: Request, body: ArrayBuffer | null): Promise<Response> {
  const key = upstreamApiKey(req, 'ANTHROPIC_API_KEY');
  if (!key) return error(req, 400, 'No Anthropic API key is configured. Add one in Settings → AI models.', 'missing_key');
  const headers: Record<string, string> = {
    'Content-Type': req.headers.get('content-type') || 'application/json',
    Accept: req.headers.get('accept') || 'text/event-stream',
    'x-api-key': key,
    'anthropic-version': req.headers.get('anthropic-version') || '2023-06-01',
  };
  const beta = req.headers.get('anthropic-beta');
  if (beta) headers['anthropic-beta'] = beta;
  const upstream = await forward('https://api.anthropic.com/v1/messages', { method: 'POST', headers, body });
  return passthroughResponse(req, upstream);
}

async function handleOpenAI(req: Request, body: ArrayBuffer | null): Promise<Response> {
  const key = upstreamApiKey(req, 'OPENAI_API_KEY');
  if (!key) return error(req, 400, 'No OpenAI API key is configured. Add one in Settings → AI models.', 'missing_key');
  const upstream = await forward('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': req.headers.get('content-type') || 'application/json',
      Accept: req.headers.get('accept') || 'text/event-stream',
      Authorization: `Bearer ${key}`,
    },
    body,
  });
  return passthroughResponse(req, upstream);
}

async function handleOpenRouter(req: Request, body: ArrayBuffer | null): Promise<Response> {
  const key = upstreamApiKey(req, 'OPENROUTER_API_KEY');
  if (!key) return error(req, 400, 'No OpenRouter API key is configured. Add one in Settings → AI models.', 'missing_key');
  const upstream = await forward('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': req.headers.get('content-type') || 'application/json',
      Accept: req.headers.get('accept') || 'text/event-stream',
      Authorization: `Bearer ${key}`,
      'HTTP-Referer': Deno.env.get('CGOLD_APP_URL') || 'https://mycanadagold.app',
      'X-Title': 'MyCanadaGold',
    },
    body,
  });
  return passthroughResponse(req, upstream);
}

// ---------------------------------------------------------------------------
// FINTRAC Web Reporting (user's own portal token)
// ---------------------------------------------------------------------------

async function handleFintrac(req: Request, rest: string, search: string, body: ArrayBuffer | null): Promise<Response> {
  const authorization = upstreamAuthorization(req);
  if (!authorization) return error(req, 401, 'Connect FINTRAC first.', 'fintrac_unauthenticated');
  if (!['GET', 'POST', 'PUT'].includes(req.method)) return error(req, 405, 'Method not allowed.', 'method_not_allowed');
  if (!rest.startsWith('/experiencelayer/')) return error(req, 404, 'Unknown FINTRAC path.', 'not_found');

  const referer = req.headers.get('x-fintrac-referer') || `${FINTRAC_ORIGIN}/manage-reports`;
  const headers: Record<string, string> = {
    Accept: req.headers.get('accept') || 'application/json, text/plain, */*',
    Authorization: authorization,
    Origin: FINTRAC_ORIGIN,
    Referer: referer.startsWith(FINTRAC_ORIGIN) ? referer : `${FINTRAC_ORIGIN}/manage-reports`,
    'User-Agent': req.headers.get('user-agent') || 'Mozilla/5.0 (compatible; MyCanadaGold/1.0)',
  };
  const contentType = req.headers.get('content-type');
  if (contentType) headers['Content-Type'] = contentType;

  const upstream = await forward(`${FINTRAC_ORIGIN}${rest}${search}`, { method: req.method, headers, body });
  return passthroughResponse(req, upstream);
}

// ---------------------------------------------------------------------------
// Rippling (OAuth app credentials held server-side; user tokens forwarded)
// ---------------------------------------------------------------------------

function ripplingOAuthApp(): { clientId: string; clientSecret: string } {
  return {
    clientId: (Deno.env.get('RIPPLING_CLIENT_ID') || '').trim(),
    clientSecret: (Deno.env.get('RIPPLING_CLIENT_SECRET') || '').trim(),
  };
}

function handleRipplingOAuthConfig(req: Request): Response {
  const { clientId, clientSecret } = ripplingOAuthApp();
  const configured = Boolean(clientId && clientSecret);
  return new Response(JSON.stringify({ clientId: configured ? clientId : '', configured }), {
    status: 200,
    headers: { ...corsHeaders(req), ...securityHeaders(), 'Content-Type': 'application/json; charset=utf-8' },
  });
}

async function handleRipplingOAuthToken(req: Request, body: ArrayBuffer | null): Promise<Response> {
  const { clientId, clientSecret } = ripplingOAuthApp();
  if (!clientId || !clientSecret) {
    return error(req, 503, 'Rippling sign-in is not configured. Ask a system admin to add the Rippling OAuth app.', 'rippling_unconfigured');
  }

  let payload: Record<string, unknown> = {};
  try {
    payload = body ? JSON.parse(new TextDecoder().decode(body)) : {};
  } catch {
    return error(req, 400, 'Body must be JSON.', 'bad_request');
  }

  const form = new URLSearchParams();
  const grantType = String(payload.grant_type || 'authorization_code');
  if (grantType === 'refresh_token') {
    const refreshToken = String(payload.refresh_token || '').trim();
    if (!refreshToken) return error(req, 400, 'refresh_token is required.', 'bad_request');
    form.set('grant_type', 'refresh_token');
    form.set('refresh_token', refreshToken);
  } else {
    const code = String(payload.code || '').trim();
    const redirectUri = String(payload.redirectUri || payload.redirect_uri || '').trim();
    if (!code || !redirectUri) return error(req, 400, 'OAuth code and redirect URI are required.', 'bad_request');
    if (!/^https:\/\//i.test(redirectUri) && !/^http:\/\/(localhost|127\.0\.0\.1)/i.test(redirectUri)) {
      return error(req, 400, 'Redirect URI must use HTTPS.', 'bad_request');
    }
    form.set('grant_type', 'authorization_code');
    form.set('code', code);
    form.set('redirect_uri', redirectUri);
  }

  const basic = btoa(`${clientId}:${clientSecret}`);
  const upstream = await forward(RIPPLING_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${basic}`,
    },
    body: form.toString(),
  });
  return passthroughResponse(req, upstream);
}

async function handleRippling(req: Request, rest: string, search: string): Promise<Response> {
  const authorization = upstreamAuthorization(req);
  if (!authorization) return error(req, 401, 'Connect Rippling first.', 'rippling_unauthenticated');
  if (req.method !== 'GET') return error(req, 405, 'Rippling access is read-only.', 'method_not_allowed');

  const upstream = await forward(`${RIPPLING_API_ORIGIN}${rest}${search}`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: authorization,
      'User-Agent': 'MyCanadaGold/1.0',
    },
  });
  return passthroughResponse(req, upstream);
}

// ---------------------------------------------------------------------------
// Google local reviews
// ---------------------------------------------------------------------------

function buildGoogleBoqSearch(query: URLSearchParams): string | null {
  const featureId = (query.get('featureId') || '').trim();
  const mapsId = (query.get('mapsId') || '').trim();
  const token = (query.get('token') || '').trim();
  if (!/^0x[0-9a-f]+:0x[0-9a-f]+$/i.test(featureId) || !/^\/g\/[0-9a-z_]+$/i.test(mapsId)) return null;

  const reqpld = [
    null,
    [
      null, null, null, null, null, null, null, null, null,
      [
        null, 1, null, null, null, null, null, null, null, null, null,
        [featureId, null, null, mapsId],
        null, null, '', null,
        [1, 1, null, [[3], [4], [5], [6], [7]]],
        null, null,
        token || null,
        null, null, null, 0,
      ],
    ],
  ];

  return new URLSearchParams({
    sourceid: 'chrome',
    reqpld: JSON.stringify(reqpld),
    msc: 'gwsrpc',
    opi: '89978449',
  }).toString();
}

async function handleGoogleBoq(req: Request, query: URLSearchParams): Promise<Response> {
  if (req.method !== 'GET') return error(req, 405, 'Use GET.', 'method_not_allowed');
  const search = buildGoogleBoqSearch(query);
  if (!search) return error(req, 400, 'featureId and mapsId are required.', 'bad_request');

  const upstream = await forward(`${GOOGLE_BOQ_URL}?${search}`, {
    method: 'GET',
    headers: {
      Accept: '*/*',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36',
      Referer: 'https://www.google.com/',
    },
  });

  let text = await upstream.text();
  if (text.startsWith(")]}'")) text = text.slice(4).trimStart();
  if (!upstream.ok) return error(req, 502, `Google reviews upstream failed (${upstream.status}).`, 'upstream_failed');

  try {
    const json = JSON.parse(text);
    return new Response(JSON.stringify(json), {
      status: 200,
      headers: { ...corsHeaders(req), ...securityHeaders(), 'Content-Type': 'application/json; charset=utf-8' },
    });
  } catch {
    return error(req, 502, 'Google reviews response was not valid JSON.', 'upstream_invalid');
  }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

function routePath(req: Request): { path: string; search: string; query: URLSearchParams } {
  const url = new URL(req.url);
  let path = url.pathname;
  const index = path.indexOf(FUNCTION_PREFIX);
  if (index >= 0) path = path.slice(index + FUNCTION_PREFIX.length);
  if (!path.startsWith('/')) path = `/${path}`;
  return { path, search: url.search, query: url.searchParams };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight(req);

  let staff;
  try {
    staff = await requireActiveStaff(req);
  } catch (err) {
    if (err instanceof StaffAuthError) return error(req, err.status, err.message, err.code);
    console.error('proxy auth failure', err instanceof Error ? err.message : err);
    return error(req, 500, 'Proxy is not configured.', 'misconfigured');
  }

  const { path, search, query } = routePath(req);
  const isAi = path.startsWith('/anthropic/') || path.startsWith('/openai/') || path.startsWith('/openrouter/');
  if (throttled(`${staff.userId}:${isAi ? 'ai' : 'other'}`, isAi ? RATE_LIMIT_AI : RATE_LIMIT_OTHER)) {
    return error(req, 429, 'Too many requests. Slow down and try again.', 'throttled');
  }

  try {
    if (path === '/anthropic/v1/messages' && req.method === 'POST') {
      return await handleAnthropic(req, await readBody(req));
    }
    if (path === '/openai/v1/chat/completions' && req.method === 'POST') {
      return await handleOpenAI(req, await readBody(req));
    }
    if (path === '/openrouter/v1/chat/completions' && req.method === 'POST') {
      return await handleOpenRouter(req, await readBody(req));
    }
    if (path.startsWith('/fintrac/')) {
      return await handleFintrac(req, path.slice('/fintrac'.length), search, await readBody(req));
    }
    if (path === '/rippling/oauth/config') {
      return handleRipplingOAuthConfig(req);
    }
    if (path === '/rippling/oauth/token' && req.method === 'POST') {
      return await handleRipplingOAuthToken(req, await readBody(req));
    }
    if (path.startsWith('/rippling/')) {
      return await handleRippling(req, path.slice('/rippling'.length), search);
    }
    if (path === '/google/local-boq') {
      return await handleGoogleBoq(req, query);
    }
    return error(req, 404, 'Unknown proxy route.', 'not_found');
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Upstream request failed.';
    console.error('proxy upstream failure', path, message);
    const status = /too large/i.test(message) ? 413 : 502;
    return error(req, status, status === 413 ? message : 'Upstream request failed.', status === 413 ? 'too_large' : 'upstream_failed');
  }
});
