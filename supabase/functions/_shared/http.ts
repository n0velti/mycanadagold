/** Small HTTP helpers shared by the Edge Functions. */

const DEFAULT_ALLOWED_HEADERS = [
  'authorization',
  'apikey',
  'accept',
  'content-type',
  'x-client-info',
  'x-supabase-client-platform',
  'x-supabase-client-platform-version',
  'x-supabase-client-runtime',
  'x-supabase-client-runtime-version',
  'x-upstream-authorization',
  'x-upstream-api-key',
  'x-fintrac-referer',
  'anthropic-version',
  'anthropic-beta',
].join(', ');

function allowedOrigins(): string[] {
  return String(Deno.env.get('CGOLD_ALLOWED_ORIGINS') || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

/**
 * CORS headers. When CGOLD_ALLOWED_ORIGINS is set only those origins are
 * echoed back; otherwise any origin is accepted (tokens are bearer, not
 * cookies, so CORS is not the security boundary here).
 */
export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') || '';
  const list = allowedOrigins();
  const allow = list.length === 0 ? '*' : list.includes(origin) ? origin : list[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
    'Access-Control-Allow-Headers': DEFAULT_ALLOWED_HEADERS,
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}

export function securityHeaders(): Record<string, string> {
  return {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  };
}

export function json(req: Request, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(req),
      ...securityHeaders(),
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
}

export function error(req: Request, status: number, message: string, code?: string): Response {
  return json(req, status, { error: { message, code: code || undefined } });
}

export function preflight(req: Request): Response {
  return new Response(null, { status: 204, headers: corsHeaders(req) });
}

export function clientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for') || '';
  const first = forwarded.split(',')[0]?.trim();
  return first || req.headers.get('cf-connecting-ip') || req.headers.get('x-real-ip') || 'unknown';
}

export async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function readJson<T = Record<string, unknown>>(req: Request, maxBytes = 16 * 1024): Promise<T> {
  const length = Number(req.headers.get('content-length') || 0);
  if (length > maxBytes) throw new Error('Request body too large.');
  const text = await req.text();
  if (text.length > maxBytes) throw new Error('Request body too large.');
  if (!text.trim()) return {} as T;
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Body must be a JSON object.');
    }
    return parsed as T;
  } catch {
    throw new Error('Body must be valid JSON.');
  }
}

export function bearerToken(req: Request): string {
  const header = req.headers.get('authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}
