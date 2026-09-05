/**
 * proxy — authenticated gateway to third-party APIs.
 *
 * Every request must carry a staff JWT minted by aureus-login and belong to an
 * active profile. Vendor secrets never leave this function:
 *
 *   /proxy/anthropic/v1/messages           POST  → api.anthropic.com
 *   /proxy/openai/v1/chat/completions      POST  → api.openai.com
 *   /proxy/openrouter/v1/chat/completions  POST  → openrouter.ai
 *   /proxy/avatars/stylize                 POST  → OpenAI images/edits (IGA-style 3D cartoon of the person)
 *   /proxy/fintrac/<path>                  *     → www142.fintrac-canafe.canada.ca
 *   /proxy/rippling/oauth/config           GET   → { clientId, configured }
 *   /proxy/rippling/oauth/token            POST  → app.rippling.com/o/token (client secret held here)
 *   /proxy/rippling/<path>                 GET   → rest.ripplingapis.com
 *   /proxy/google/local-boq                GET   → Google local reviews (GetLocalBoqProxy)
 *   /proxy/canadagold/page                 GET   → canadagold.ca buy/sell price pages
 *
 * AI providers use the company key saved in Settings (System Admin / GM) or,
 * if none is saved, the Edge Function secret. Clients never send vendor keys.
 * FINTRAC and Rippling user tokens are forwarded from
 * `X-Upstream-Authorization` (the caller's own session with that vendor).
 */
import { corsHeaders, error, json, preflight, securityHeaders } from '../_shared/http.ts';
import { adminClient, requireActiveStaff, StaffAuthError } from '../_shared/staff.ts';

const FUNCTION_PREFIX = '/proxy';
const MAX_BODY_BYTES = 25 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 120_000;
const AVATAR_TIMEOUT_MS = 180_000;
const RATE_LIMIT_AVATAR = 8;

const FINTRAC_ORIGIN = 'https://www142.fintrac-canafe.canada.ca';
const RIPPLING_API_ORIGIN = 'https://rest.ripplingapis.com';
const RIPPLING_OAUTH_TOKEN_URL = 'https://app.rippling.com/o/token';
const GOOGLE_BOQ_URL = 'https://www.google.com/httpservice/web/PrivateLocalSearchUiDataService/GetLocalBoqProxy';
const CANADAGOLD_PAGES: Record<string, string> = {
  buy: 'https://canadagold.ca/sell-to-us/todays-gold-prices/',
  sell: 'https://canadagold.ca/buy-from-us/bullion/',
};

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

const MISSING_AI_KEY =
  'No company API key is configured. A System Admin or General Manager can add one in Settings → AI models.';

async function loadCompanyAiKeys(): Promise<Record<string, string>> {
  const keys: Record<string, string> = {};
  try {
    const { data, error: queryError } = await adminClient().from('company_ai_keys').select('provider, api_key');
    if (!queryError) {
      for (const row of data || []) {
        const provider = String((row as { provider?: string }).provider || '').trim();
        const apiKey = String((row as { api_key?: string }).api_key || '').trim();
        if (provider && apiKey) keys[provider] = apiKey;
      }
    }
  } catch {
    // Table missing or unreachable: fall through to Edge Function secrets.
  }
  return keys;
}

async function resolveAiApiKey(provider: string, envName: string): Promise<string> {
  const company = await loadCompanyAiKeys();
  if (company[provider]) return company[provider];
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

async function forward(url: string, init: RequestInit, timeoutMs = UPSTREAM_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
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
  const key = await resolveAiApiKey('anthropic', 'ANTHROPIC_API_KEY');
  if (!key) return error(req, 400, MISSING_AI_KEY, 'missing_key');
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
  const key = await resolveAiApiKey('openai', 'OPENAI_API_KEY');
  if (!key) return error(req, 400, MISSING_AI_KEY, 'missing_key');
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

const AVATAR_IMAGE_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);
const AVATAR_MAX_BYTES = 8 * 1024 * 1024;
const AVATAR_MODELS = ['gpt-image-1.5', 'gpt-image-1'];
const AVATAR_DESCRIBE_MODELS = ['gpt-4.1-mini', 'gpt-4o-mini'];
const AVATAR_DESCRIBE_TIMEOUT_MS = 25_000;

/**
 * IGA grocery-mascot / modern Pixar 3D cartoon. Face is locked to the photo.
 * Shirt and background are picked per staff member so portraits do not clone.
 */
const AVATAR_STYLE_PROMPT = [
  'Restyle this photograph as a polished 3D CGI character portrait in the IGA grocery-mascot cartoon style — the friendly vinyl-toy look of a modern Pixar or DreamWorks feature, not a photoreal human.',
  'This must look like high-end 3D animation: soft studio-quality lighting, gentle rim light, subsurface-scattering skin with a matte glow, no pores, no live-action photography, no flat 2D cartoon, no anime.',
  'Art direction every portrait shares: head-and-shoulders bust, the person clearly recognizable, large soulful expressive eyes with detailed irises and bright catchlights, slightly stylized proportions (a touch larger head and eyes, rounded features, clean facial lines), sculpted voluminous hair in stylized clumps with visible texture and a slight sheen, richly textured fabrics, a friendly approachable expression.',
  'Identity lock: this is the SAME person as in the photo. Keep their exact likeness — sex and gender presentation, age, face shape, bone structure, nose, jaw, eyebrows, skin tone, eye color, hair color, hair length and style, facial hair or a clean-shaven face, freckles, moles, glasses, and any distinctive marks. If the photo is a woman or girl, the cartoon MUST be a woman or girl. If the photo is a man or boy, the cartoon MUST be a man or boy. Never default to a generic or male character. Do not invent a different person.',
].join(' ');

const AVATAR_SHIRTS = [
  'a navy crew-neck knit sweater',
  'a plain white cotton t-shirt',
  'a light blue oxford button-down shirt',
  'a forest green cardigan over a cream tee',
  'a burgundy henley',
  'a camel knit polo',
  'a charcoal quarter-zip sweater',
  'a mustard yellow crew sweater',
  'a soft denim overshirt',
  'an olive utility shirt',
  'a rust flannel shirt',
  'a teal henley',
  'a cream cable-knit sweater',
  'a deep plum button-up shirt',
  'a warm brown corduroy shirt',
  'a sky blue linen shirt',
  'a terracotta knit sweater',
  'a heather grey crew-neck sweatshirt',
];

const AVATAR_BACKGROUNDS = [
  'a softly blurred grocery produce aisle with warm store lighting',
  'a cozy kitchen with shallow depth of field',
  'a warm office with window light and blurred shelves',
  'a gold and jewelry showroom with soft display lights out of focus',
  'a neighborhood cafe patio in soft daylight',
  'a living room with houseplants and window light',
  'bookstore shelves softly out of focus',
  'a bakery counter with warm bokeh',
  'a quiet workshop with tools softly blurred',
  'a garden patio with leafy bokeh',
  'a brick indoor market with produce in the blur',
  'a holiday home interior with soft string-light bokeh',
  'a sunlit hallway with framed photos blurred',
  'a waterfront boardwalk in soft daylight',
  'a cream-to-taupe studio gradient with gentle vignette',
  'a coffee shop interior with warm bokeh lights',
];

function hashSeed(value: string): number {
  let hash = 2166136261;
  const text = String(value || '');
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function pickForPerson<T>(items: readonly T[], seed: string, salt: string): T {
  return items[hashSeed(`${salt}:${seed}`) % items.length];
}

function parseImageDataUrl(value: string): { mediaType: string; bytes: Uint8Array; filename: string } | null {
  const match = String(value || '').trim().match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/);
  if (!match) return null;
  const mediaType = match[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : match[1].toLowerCase();
  if (!AVATAR_IMAGE_TYPES.has(mediaType)) return null;
  try {
    const binary = atob(match[2].replace(/\s/g, ''));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    if (!bytes.byteLength || bytes.byteLength > AVATAR_MAX_BYTES) return null;
    const ext = mediaType.includes('png') ? 'png' : mediaType.includes('webp') ? 'webp' : 'jpg';
    return { mediaType, bytes, filename: `photo.${ext}` };
  } catch {
    return null;
  }
}

function isRetryableImageModelError(payload: unknown): boolean {
  const error = payload && typeof payload === 'object' ? (payload as { error?: { message?: string; code?: string } }).error : null;
  const message = String(error?.message || '');
  const code = String(error?.code || '');
  return /model|unknown|not found|does not exist|not available/i.test(`${code} ${message}`);
}

function sanitizeSubjectDescription(value: string): string {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.slice(0, 400);
}

function buildAvatarPrompt(subject: string, shirt: string, background: string): string {
  const parts = [
    AVATAR_STYLE_PROMPT,
    `Wardrobe for this person only: ${shirt}. Fit it to this person's body. Do not put every staff member in the same uniform. No logos, name tags, or text on clothing.`,
    `Background for this person only: ${background}. Keep shallow depth of field so the face stays sharp. No text, logos, watermarks, or extra people.`,
  ];
  if (subject) parts.push(`The person in the photo: ${subject}`);
  return parts.join(' ');
}

function buildAvatarEditForm(
  image: { mediaType: string; bytes: Uint8Array; filename: string },
  model: string,
  prompt: string,
): FormData {
  const form = new FormData();
  form.set('model', model);
  form.set('prompt', prompt);
  form.set('size', '1024x1024');
  form.set('quality', 'medium');
  form.set('input_fidelity', 'high');
  form.set('output_format', 'jpeg');
  form.set('image', new File([image.bytes], image.filename, { type: image.mediaType }));
  return form;
}

async function describePortraitSubject(key: string, dataUrl: string): Promise<string> {
  const messages = [
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: [
            'Describe the single person in this photo in one factual sentence so a 3D cartoon artist can keep their likeness.',
            'Include apparent sex or gender presentation (woman, man, girl, boy, or as photographed), approximate age,',
            'face shape, bone structure, nose and jaw, eyebrow shape, skin tone, eye color, hair color, hair length, hair style,',
            'facial hair or clean-shaven, glasses, earrings or other visible accessories, and any distinctive marks.',
            'Do not guess a name. Do not invent features that are not visible. Do not describe lighting, clothing, or camera style.',
          ].join(' '),
        },
        { type: 'image_url', image_url: { url: dataUrl } },
      ],
    },
  ];

  for (const model of AVATAR_DESCRIBE_MODELS) {
    try {
      const upstream = await forward(
        'https://api.openai.com/v1/chat/completions',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${key}`,
          },
          body: JSON.stringify({ model, max_tokens: 180, messages }),
        },
        AVATAR_DESCRIBE_TIMEOUT_MS,
      );
      const result = await upstream.json().catch(() => null);
      const text = sanitizeSubjectDescription(result?.choices?.[0]?.message?.content || '');
      if (upstream.ok && text) return text;
    } catch {
      // Fall through to the next vision model, then to the locked prompt alone.
    }
  }
  return '';
}

async function handleAvatarStylize(req: Request, body: ArrayBuffer | null, staffId = ''): Promise<Response> {
  if (req.method !== 'POST') return error(req, 405, 'Use POST.', 'method_not_allowed');
  const key = await resolveAiApiKey('openai', 'OPENAI_API_KEY');
  if (!key) return error(req, 400, MISSING_AI_KEY, 'missing_key');

  let payload: { image?: string } = {};
  try {
    payload = body ? JSON.parse(new TextDecoder().decode(body)) : {};
  } catch {
    return error(req, 400, 'Body must be JSON.', 'bad_request');
  }

  const dataUrl = String(payload.image || '');
  const image = parseImageDataUrl(dataUrl);
  if (!image) {
    return error(req, 400, 'Send a JPEG, PNG, or WebP photo under 8 MB.', 'bad_request');
  }

  const subject = await describePortraitSubject(key, dataUrl);
  const seed = staffId || subject || String(image.bytes.byteLength);
  const shirt = pickForPerson(AVATAR_SHIRTS, seed, 'shirt');
  const background = pickForPerson(AVATAR_BACKGROUNDS, seed, 'background');
  const prompt = buildAvatarPrompt(subject, shirt, background);

  let lastMessage = 'Could not draw that portrait.';
  for (const model of AVATAR_MODELS) {
    const upstream = await forward(
      'https://api.openai.com/v1/images/edits',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}` },
        body: buildAvatarEditForm(image, model, prompt),
      },
      AVATAR_TIMEOUT_MS,
    );

    let result: { data?: Array<{ b64_json?: string }>; error?: { message?: string; code?: string } } = {};
    try {
      result = await upstream.json();
    } catch {
      lastMessage = 'Portrait service returned an invalid response.';
      continue;
    }

    if (!upstream.ok) {
      lastMessage = result?.error?.message || `Portrait service error ${upstream.status}.`;
      if (isRetryableImageModelError(result) && model !== AVATAR_MODELS[AVATAR_MODELS.length - 1]) {
        continue;
      }
      return error(req, upstream.status >= 500 ? 502 : 400, lastMessage, upstream.status >= 500 ? 'upstream_failed' : 'bad_request');
    }

    const b64 = result?.data?.[0]?.b64_json;
    if (!b64) {
      lastMessage = 'Portrait service did not return an image.';
      continue;
    }
    return json(req, 200, { image: `data:image/jpeg;base64,${b64}` });
  }

  return error(req, 502, lastMessage, 'upstream_failed');
}

async function handleOpenRouter(req: Request, body: ArrayBuffer | null): Promise<Response> {
  const key = await resolveAiApiKey('openrouter', 'OPENROUTER_API_KEY');
  if (!key) return error(req, 400, MISSING_AI_KEY, 'missing_key');
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

async function handleCanadaGoldPage(req: Request, query: URLSearchParams): Promise<Response> {
  const page = String(query.get('page') || '').trim();
  const url = CANADAGOLD_PAGES[page];
  if (!url) return error(req, 400, 'Unknown Canada Gold price page.', 'bad_request');

  const upstream = await forward(
    url,
    {
      method: 'GET',
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-CA,en;q=0.9',
        'User-Agent': 'CanadaGoldStaff/1.0 (+https://mycanadagold.app)',
      },
    },
    30_000,
  );
  if (!upstream.ok) {
    return error(req, 502, `Canada Gold prices failed (${upstream.status}).`, 'upstream_failed');
  }

  const html = await upstream.text();
  return new Response(html, {
    status: 200,
    headers: {
      ...corsHeaders(req),
      ...securityHeaders(),
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'private, max-age=30',
    },
  });
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
  const isAvatar = path === '/avatars/stylize';
  const isAi = path.startsWith('/anthropic/') || path.startsWith('/openai/') || path.startsWith('/openrouter/');
  const bucket = isAvatar ? 'avatar' : isAi ? 'ai' : 'other';
  const limit = isAvatar ? RATE_LIMIT_AVATAR : isAi ? RATE_LIMIT_AI : RATE_LIMIT_OTHER;
  if (throttled(`${staff.userId}:${bucket}`, limit)) {
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
    if (path === '/avatars/stylize') {
      return await handleAvatarStylize(req, await readBody(req), staff.userId);
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
    if (path === '/canadagold/page' && req.method === 'GET') {
      return await handleCanadaGoldPage(req, query);
    }
    return error(req, 404, 'Unknown proxy route.', 'not_found');
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Upstream request failed.';
    console.error('proxy upstream failure', path, message);
    const status = /too large/i.test(message) ? 413 : 502;
    return error(req, status, status === 413 ? message : 'Upstream request failed.', status === 413 ? 'too_large' : 'upstream_failed');
  }
});
