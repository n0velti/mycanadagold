/**
 * proxy — authenticated gateway to third-party APIs.
 *
 * Every request must carry a staff JWT minted by aureus-login and belong to an
 * active profile. Vendor secrets never leave this function:
 *
 *   /proxy/anthropic/v1/messages           POST  → api.anthropic.com
 *   /proxy/openai/v1/chat/completions      POST  → api.openai.com
 *   /proxy/openrouter/v1/chat/completions  POST  → openrouter.ai
 *   /proxy/avatars/stylize                 POST  → OpenAI images/edits (Disney cartoon of the person in the photo)
 *   /proxy/fintrac/<path>                  *     → www142.fintrac-canafe.canada.ca
 *   /proxy/rippling/oauth/config           GET   → { clientId, configured }
 *   /proxy/rippling/oauth/token            POST  → app.rippling.com/o/token (client secret held here)
 *   /proxy/rippling/<path>                 GET   → rest.ripplingapis.com
 *   /proxy/google/local-boq                GET   → Google local reviews (GetLocalBoqProxy)
 *   /proxy/canadagold/page                 GET   → canadagold.ca buy/sell price pages
 *   /proxy/moneris/cloud                   POST  → Moneris Cloud (Move 5000 / Go)
 *   /proxy/moneris/poll                    POST  → poll a Moneris receipt URL
 *   /proxy/ringcentral/stores              GET   → per-store RingCentral connection status
 *   /proxy/ringcentral/check               POST  → JWT auth + account / numbers for one store
 *   /proxy/ringcentral/details             POST  → JWT auth + numbers and extensions for one store
 *   /proxy/ringcentral/save                POST  → upsert per-store JWT credentials (service role)
 *   /proxy/ringcentral/delete              POST  → remove a store’s RingCentral credentials
 *   /proxy/ringcentral/phone               POST  → presence, call log, voicemail, RingOut, answer/reject
 *   /proxy/ringcentral/voicemail-content   GET   → voicemail audio for one message
 *
 * AI providers use the company key saved in Settings (System Admin / GM) or,
 * if none is saved, the Edge Function secret. Clients never send vendor keys.
 * FINTRAC and Rippling user tokens are forwarded from
 * `X-Upstream-Authorization` (the caller's own session with that vendor).
 */
import { corsHeaders, error, json, preflight, readJson, securityHeaders } from '../_shared/http.ts';
import { adminClient, requireActiveStaff, StaffAuthError, type StaffContext } from '../_shared/staff.ts';

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
const AVATAR_MODELS = ['gpt-image-2', 'gpt-image-1.5', 'gpt-image-1'];
const AVATAR_DESCRIBE_MODELS = ['gpt-4.1-mini', 'gpt-4o-mini'];
const AVATAR_DESCRIBE_TIMEOUT_MS = 25_000;

/**
 * Fun Disney 3D cartoon restyle. The attached photo is the identity source —
 * style, shirt, and background change; the face must stay that person.
 */
const AVATAR_IDENTITY_PROMPT = [
  'Edit the attached photograph. This is an image-to-image restyle of that exact person, not a new character and not a generated extra.',
  'The photo is the only identity source. Anyone who knows this person must recognize them immediately.',
  'Keep from the photo: the same person, same face, same identity, sex and gender presentation, apparent age, ethnicity, face shape, bone structure, nose, mouth, lips, jaw, chin, eyebrows, eye shape, eye color, skin tone, hair color, hairline, hair length and style, facial hair or a clean-shaven face, glasses, earrings, freckles, moles, and any distinctive marks.',
  'If the photo is a woman or girl, the cartoon MUST be that woman or girl. If the photo is a man or boy, the cartoon MUST be that man or boy.',
  'Do not invent a different person. Do not default to a generic Disney hero or heroine. Do not swap gender, age, or ethnicity. Do not enlarge the head or redesign the face into generic cartoon proportions.',
].join(' ');

const AVATAR_STYLE_PROMPT = [
  'Change only the rendering style, wardrobe, and background.',
  'Render them as a fun Disney 3D cartoon portrait in the look of a modern Disney feature film — warm studio lighting, painted cartoon skin without pores, stylized voluminous hair, richly textured clothes, a friendly expression, head-and-shoulders bust.',
  'Keep their real facial proportions and features; only the materials and lighting become cartoon.',
  'Not photoreal. Not live-action. Not 2D. Not anime. Not a grocery mascot. Not a vinyl toy.',
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
  'a sunlit meadow with soft leafy bokeh',
  'a cozy kitchen with shallow depth of field',
  'a warm office with window light and blurred shelves',
  'a gold and jewelry showroom with soft display lights out of focus',
  'a neighborhood cafe patio in soft daylight',
  'a living room with houseplants and window light',
  'bookstore shelves softly out of focus',
  'a bakery counter with warm bokeh',
  'a quiet workshop with tools softly blurred',
  'a garden patio with leafy bokeh',
  'a castle courtyard with warm daylight bokeh',
  'a holiday home interior with soft string-light bokeh',
  'a sunlit hallway with framed photos blurred',
  'a waterfront boardwalk in soft daylight',
  'a cream-to-gold studio gradient with gentle vignette',
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
    AVATAR_IDENTITY_PROMPT,
    AVATAR_STYLE_PROMPT,
    `Wardrobe for this person only: ${shirt}. Fit it to this person's body. Do not put every staff member in the same uniform. No logos, name tags, or text on clothing.`,
    `Background for this person only: ${background}. Keep shallow depth of field so the face stays sharp. No text, logos, watermarks, or extra people.`,
  ];
  if (subject) {
    parts.push(
      `Visible facts from the photo, for matching only — do not invent anyone else: ${subject}`,
    );
  }
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
  form.set('quality', 'high');
  form.set('output_format', 'jpeg');
  // gpt-image-2 always uses high input fidelity and rejects this field.
  if (!model.startsWith('gpt-image-2')) {
    form.set('input_fidelity', 'high');
  }
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
            'Describe the single person visible in this photo in one factual sentence so an artist can keep their exact likeness.',
            'Include apparent sex or gender presentation (woman, man, girl, boy, or as photographed), approximate age,',
            'ethnicity or skin tone, face shape, bone structure, nose, mouth, jaw, eyebrow shape, eye color and eye shape,',
            'hair color, hair length, hair style, facial hair or clean-shaven, glasses, earrings or other visible accessories,',
            'and any distinctive marks. Do not guess a name. Do not invent features that are not visible.',
            'Do not describe lighting, clothing, or camera style. If no clear face is visible, say that.'
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
// Moneris Cloud (Move 5000 / Go)
// ---------------------------------------------------------------------------

const MONERIS_HOSTS: Record<string, string> = {
  core: 'https://patpos.moneris.com/',
  production: 'https://ippos.moneris.com/v3/Terminal/',
  qa: 'https://ippostest.moneris.com/v3/Terminal/',
};

const MONERIS_RECEIPT_HOSTS = [
  'patpos.moneris.com',
  'ippos.moneris.com',
  'ippostest.moneris.com',
  'cloudreceipt.moneris.com',
  'cloudreceiptct.moneris.com',
  'ipterm2.moneris.io',
  'ipterm2ct.moneris.io',
];

type MonerisTerminalRow = {
  id: string;
  store_key: string;
  store_name: string;
  terminal_id: string;
  store_id: string;
  api_token: string;
  environment: string;
  ist_config_code: string;
};

function torontoStamp(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const pick = (type: string) => parts.find((part) => part.type === type)?.value || '00';
  return `${pick('year')}-${pick('month')}-${pick('day')} ${pick('hour')}:${pick('minute')}:${pick('second')}`;
}

function torontoDate(date = new Date()): string {
  return torontoStamp(date).slice(0, 10);
}

function asTrimmed(value: unknown): string {
  return String(value ?? '').trim();
}

function firstResponse(payload: unknown): Record<string, unknown> {
  const root = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
  const receipt = root.receipt && typeof root.receipt === 'object'
    ? (root.receipt as Record<string, unknown>)
    : root;
  const data = receipt.data && typeof receipt.data === 'object'
    ? (receipt.data as Record<string, unknown>)
    : {};
  const list = Array.isArray(data.response) ? data.response : [];
  const item = list[0] && typeof list[0] === 'object' ? (list[0] as Record<string, unknown>) : {};
  return { ...receipt, ...item };
}

function isCompleted(entry: Record<string, unknown>): boolean {
  const value = asTrimmed(entry.completed ?? entry.Completed).toLowerCase();
  return value === 'true' || value === '1';
}

function isApproved(entry: Record<string, unknown>): boolean {
  if (asTrimmed(entry.approved ?? entry.Approved).toLowerCase() === 'true') return true;
  if (asTrimmed(entry.Error ?? entry.error).toLowerCase() === 'true') return false;
  const code = Number(asTrimmed(entry.responseCode ?? entry.ResponseCode));
  return Number.isFinite(code) && code >= 0 && code < 50;
}

function amountFromEntry(entry: Record<string, unknown>, fallbackCents?: number): number {
  const raw = asTrimmed(entry.amount ?? entry.totalAmount ?? entry.Amount);
  if (raw.includes('.')) {
    const dollars = Number(raw);
    return Number.isFinite(dollars) ? dollars : 0;
  }
  const cents = raw ? Number(raw) : fallbackCents;
  if (!Number.isFinite(cents)) return 0;
  return Number(cents) / 100;
}

function receiptUrlFrom(entry: Record<string, unknown>, payload: unknown): string {
  const direct = asTrimmed(entry.receiptUrl ?? entry.ReceiptUrl);
  if (direct) return direct;
  const root = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
  return asTrimmed(root.receiptUrl);
}

function allowedReceiptUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    return MONERIS_RECEIPT_HOSTS.includes(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

async function loadMonerisTerminal(terminalRowId: string): Promise<MonerisTerminalRow | null> {
  const { data, error: queryError } = await adminClient()
    .from('moneris_terminals')
    .select('id, store_key, store_name, terminal_id, store_id, api_token, environment, ist_config_code')
    .eq('id', terminalRowId)
    .maybeSingle();
  if (queryError || !data) return null;
  return data as MonerisTerminalRow;
}

async function markTerminalStatus(id: string, status: string, errorText = '') {
  await adminClient()
    .from('moneris_terminals')
    .update({
      last_seen_at: new Date().toISOString(),
      last_status: status,
      last_error: errorText,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);
}

function normalizeCloudResult(
  payload: unknown,
  terminal: MonerisTerminalRow,
  action: string,
  amountCents?: number,
) {
  const entry = firstResponse(payload);
  const completed = isCompleted(entry);
  const approved = completed && isApproved(entry);
  return {
    completed,
    approved,
    action: asTrimmed(entry.action) || action,
    orderId: asTrimmed(entry.orderId ?? entry.order_id),
    cloudTicket: asTrimmed(entry.cloudTicket ?? entry.CloudTicket),
    receiptUrl: receiptUrlFrom(entry, payload),
    responseCode: asTrimmed(entry.responseCode ?? entry.ResponseCode),
    status: asTrimmed(entry.status ?? entry.Status),
    statusCode: asTrimmed(entry.statusCode ?? entry.StatusCode),
    authCode: asTrimmed(entry.authCode ?? entry.AuthCode),
    cardType: asTrimmed(entry.cardType ?? entry.CardType),
    cardLast4: asTrimmed(entry.lastFour ?? entry.panLast4 ?? entry.LastFourDigits),
    amount: amountFromEntry(entry, amountCents),
    storeName: terminal.store_name,
    terminalId: terminal.terminal_id,
    receipt: payload,
  };
}

async function persistMonerisTransaction(
  staffUserId: string,
  terminal: MonerisTerminalRow,
  result: ReturnType<typeof normalizeCloudResult>,
) {
  if (!result.completed || !result.orderId) return;
  if (result.action === 'initialization') return;

  const { error: upsertError } = await adminClient().from('moneris_transactions').upsert(
    {
      terminal_id_ref: terminal.id,
      store_key: terminal.store_key,
      store_name: terminal.store_name,
      terminal_id: terminal.terminal_id,
      order_id: result.orderId,
      cloud_ticket: result.cloudTicket,
      action: result.action || 'purchase',
      amount: result.amount,
      currency: 'CAD',
      card_type: result.cardType,
      card_last4: result.cardLast4,
      auth_code: result.authCode,
      response_code: result.responseCode,
      approved: result.approved,
      transacted_on: torontoDate(),
      transacted_at: new Date().toISOString(),
      receipt: result.receipt ?? {},
      created_by: staffUserId,
    },
    { onConflict: 'order_id' },
  );
  if (upsertError) console.error('moneris persist failed', upsertError.message);
}

function dollarsToCents(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

async function postMonerisCloud(terminal: MonerisTerminalRow, body: Record<string, unknown>) {
  const host = MONERIS_HOSTS[terminal.environment] || MONERIS_HOSTS.core;
  const upstream = await forward(host, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await upstream.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text };
  }
  if (!upstream.ok) {
    const message =
      (payload && typeof payload === 'object' && 'error' in payload
        ? asTrimmed((payload as { error?: { message?: string } }).error?.message)
        : '') || `Moneris Cloud returned ${upstream.status}.`;
    throw new Error(message);
  }
  return payload;
}

async function handleMonerisCloud(req: Request, staffUserId: string): Promise<Response> {
  if (req.method !== 'POST') return error(req, 405, 'Use POST.', 'method_not_allowed');

  let body: Record<string, unknown>;
  try {
    body = await readJson<Record<string, unknown>>(req);
  } catch (err) {
    return error(req, 400, err instanceof Error ? err.message : 'Invalid JSON.', 'bad_request');
  }

  const terminalRowId = asTrimmed(body.terminalId);
  const action = asTrimmed(body.action) || 'purchase';
  const allowed = new Set(['initialization', 'purchase', 'refund', 'purchase_correction']);
  if (!terminalRowId) return error(req, 400, 'Choose a terminal.', 'bad_request');
  if (!allowed.has(action)) return error(req, 400, 'Unsupported Moneris action.', 'bad_request');

  const terminal = await loadMonerisTerminal(terminalRowId);
  if (!terminal) return error(req, 404, 'That terminal is not configured.', 'moneris_unconfigured');
  if (!asTrimmed(terminal.api_token) || !asTrimmed(terminal.store_id)) {
    return error(req, 400, 'This terminal is missing its Store ID or API token.', 'moneris_unconfigured');
  }

  let amountCents: number | undefined;
  if (action !== 'initialization') {
    const cents = dollarsToCents(body.amount);
    if (cents == null || cents <= 0) {
      return error(req, 400, 'Enter an amount greater than zero.', 'bad_request');
    }
    amountCents = cents;
  }

  const request: Record<string, string> = {
    action,
    terminalId: terminal.terminal_id,
    orderId: asTrimmed(body.orderId) || `cgold-${Date.now()}`,
    idempotencyKey: crypto.randomUUID(),
  };
  if (amountCents != null) request.totalAmount = String(amountCents);
  const txnNumber = asTrimmed(body.txnNumber);
  if (txnNumber) request.txnNumber = txnNumber;

  const envelope: Record<string, unknown> = {
    apiVersion: '3.0',
    apiToken: terminal.api_token,
    storeId: terminal.store_id,
    polling: 'true',
    dataId: `${Date.now()}-001`,
    dataTimestamp: torontoStamp(),
    data: { request: [request] },
  };
  if (asTrimmed(terminal.ist_config_code)) {
    envelope.istConfigCode = asTrimmed(terminal.ist_config_code);
  }

  try {
    const payload = await postMonerisCloud(terminal, envelope);
    const result = normalizeCloudResult(payload, terminal, action, amountCents);
    await persistMonerisTransaction(staffUserId, terminal, result);
    await markTerminalStatus(
      terminal.id,
      result.completed ? (result.approved ? 'Approved' : result.status || 'Complete') : 'Waiting on terminal',
      result.completed && !result.approved ? result.status : '',
    );
    return json(req, 200, result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Moneris Cloud request failed.';
    await markTerminalStatus(terminal.id, 'Error', message);
    return error(req, 502, message, 'upstream_failed');
  }
}

async function handleMonerisPoll(req: Request, staffUserId: string): Promise<Response> {
  if (req.method !== 'POST') return error(req, 405, 'Use POST.', 'method_not_allowed');

  let body: Record<string, unknown>;
  try {
    body = await readJson<Record<string, unknown>>(req);
  } catch (err) {
    return error(req, 400, err instanceof Error ? err.message : 'Invalid JSON.', 'bad_request');
  }

  const receiptUrl = asTrimmed(body.receiptUrl);
  const terminalRowId = asTrimmed(body.terminalId);
  if (!allowedReceiptUrl(receiptUrl)) {
    return error(req, 400, 'That receipt URL is not a Moneris Cloud host.', 'bad_request');
  }

  const terminal = terminalRowId ? await loadMonerisTerminal(terminalRowId) : null;
  const upstream = await forward(receiptUrl, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  const text = await upstream.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    return error(req, 502, 'Moneris receipt was not valid JSON.', 'upstream_invalid');
  }
  if (!upstream.ok) {
    return error(req, 502, `Moneris receipt poll failed (${upstream.status}).`, 'upstream_failed');
  }

  if (!terminal) {
    return json(req, 200, normalizeCloudResult(payload, {
      id: '',
      store_key: '',
      store_name: '',
      terminal_id: '',
      store_id: '',
      api_token: '',
      environment: 'core',
      ist_config_code: '',
    }, asTrimmed(body.action) || 'purchase'));
  }

  const result = normalizeCloudResult(payload, terminal, asTrimmed(body.action) || 'purchase');
  await persistMonerisTransaction(staffUserId, terminal, result);
  if (result.completed) {
    await markTerminalStatus(
      terminal.id,
      result.approved ? 'Approved' : result.status || 'Complete',
      result.approved ? '' : result.status,
    );
  }
  return json(req, 200, result);
}

// ---------------------------------------------------------------------------
// RingCentral (per-store JWT)
// ---------------------------------------------------------------------------

const RC_PRODUCTION = 'https://platform.ringcentral.com';
const RC_SANDBOX = 'https://platform.devtest.ringcentral.com';
const RC_JWT_GRANT = 'urn:ietf:params:oauth:grant-type:jwt-bearer';
const RC_PUBLIC_COLUMNS =
  'id, store_key, store_name, server_url, account_id, company_name, main_number, extension_count, last_status, last_error, last_checked_at, created_at, updated_at, has_client_id, has_secret, has_jwt';

type RingCentralAccount = {
  id: string;
  store_key: string;
  store_name: string;
  client_id: string;
  client_secret: string;
  jwt: string;
  server_url: string;
  account_id: string;
  company_name: string;
  main_number: string;
  extension_count: number;
  last_status: string;
  last_error: string;
  last_checked_at: string | null;
  has_client_id?: boolean;
  has_secret?: boolean;
  has_jwt?: boolean;
  created_at?: string;
  updated_at?: string;
};

const rcTokenCache = new Map<string, { token: string; expiresAt: number }>();

function rcServerUrl(value: string): string {
  return value === RC_SANDBOX ? RC_SANDBOX : RC_PRODUCTION;
}

function storeKeyOf(name: string): string {
  return String(name || '').trim().toLowerCase();
}

function publicRingCentralAccount(row: Partial<RingCentralAccount> | null) {
  if (!row) return null;
  const clientId = String(row.client_id || '').trim();
  const secret = String(row.client_secret || '').trim();
  const jwt = String(row.jwt || '').trim();
  return {
    id: row.id || '',
    store_key: row.store_key || '',
    store_name: row.store_name || '',
    server_url: rcServerUrl(String(row.server_url || '')),
    account_id: row.account_id || '',
    company_name: row.company_name || '',
    main_number: row.main_number || '',
    extension_count: Number(row.extension_count) || 0,
    last_status: row.last_status || '',
    last_error: row.last_error || '',
    last_checked_at: row.last_checked_at || null,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
    has_client_id: row.has_client_id ?? Boolean(clientId),
    has_secret: row.has_secret ?? Boolean(secret),
    has_jwt: row.has_jwt ?? Boolean(jwt),
  };
}

function describeRingCentralError(raw: string, fallback: string): string {
  const message = String(raw || '').trim();
  if (/unauthorized for this grant type/i.test(message)) {
    return 'RingCentral rejected the JWT for this app. Confirm JWT auth is enabled and the JWT is assigned to this client ID.';
  }
  if (/invalid_grant|invalid jwt|invalid assertion/i.test(message)) {
    return 'RingCentral rejected the JWT. Paste a fresh JWT from the developer console in Settings → RingCentral.';
  }
  return message || fallback;
}

function rcErrorMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== 'object') return fallback;
  const row = payload as Record<string, unknown>;
  const nested = row.error;
  let raw = '';
  if (nested && typeof nested === 'object') {
    const inner = nested as Record<string, unknown>;
    raw = String(inner.message || inner.error_description || '');
  } else {
    raw = String(
      row.error_description || row.message || (typeof nested === 'string' ? nested : '') || '',
    );
  }
  return describeRingCentralError(raw, fallback);
}

async function rcJson(url: string, init: RequestInit): Promise<{ ok: boolean; status: number; payload: unknown }> {
  const upstream = await forward(url, init, 30_000);
  const payload = await upstream.json().catch(() => null);
  return { ok: upstream.ok, status: upstream.status, payload };
}

type EnvStoreCreds = {
  storeKey: string;
  storeName: string;
  clientId: string;
  clientSecret: string;
  jwt: string;
  serverUrl: string;
};

function envRingCentralStores(): EnvStoreCreds[] {
  const rows: EnvStoreCreds[] = [];
  const montreal: EnvStoreCreds = {
    storeKey: 'montreal',
    storeName: 'Montreal',
    clientId: (Deno.env.get('RINGCENTRAL_MONTREAL_CLIENT_ID') || '').trim(),
    clientSecret: (Deno.env.get('RINGCENTRAL_MONTREAL_CLIENT_SECRET') || '').trim(),
    jwt: (Deno.env.get('RINGCENTRAL_MONTREAL_JWT') || '').trim(),
    serverUrl: rcServerUrl((Deno.env.get('RINGCENTRAL_MONTREAL_SERVER_URL') || '').trim()),
  };
  if (montreal.clientId || montreal.clientSecret || montreal.jwt) rows.push(montreal);

  const raw = (Deno.env.get('RINGCENTRAL_STORES') || '').trim();
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      const list = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of list) {
        if (!item || typeof item !== 'object') continue;
        const storeName = String((item as { storeName?: string }).storeName || '').trim();
        const storeKey = storeKeyOf((item as { storeKey?: string }).storeKey || storeName);
        if (!storeKey) continue;
        rows.push({
          storeKey,
          storeName: storeName || storeKey,
          clientId: String((item as { clientId?: string }).clientId || '').trim(),
          clientSecret: String((item as { clientSecret?: string }).clientSecret || '').trim(),
          jwt: jwtFromUnknown((item as { jwt?: unknown }).jwt),
          serverUrl: rcServerUrl(String((item as { serverUrl?: string }).serverUrl || '')),
        });
      }
    } catch {
      // Ignore malformed RINGCENTRAL_STORES JSON; Montreal env vars still apply.
    }
  }
  return rows;
}

async function seedRingCentralFromEnv(): Promise<void> {
  const seeds = envRingCentralStores();
  if (seeds.length === 0) return;
  for (const seed of seeds) {
    const { data: existing } = await adminClient()
      .from('ringcentral_accounts')
      .select('id, client_id, client_secret, jwt')
      .eq('store_key', seed.storeKey)
      .maybeSingle();

    const current = (existing || {}) as Partial<RingCentralAccount>;
    const next = {
      store_key: seed.storeKey,
      store_name: seed.storeName,
      server_url: seed.serverUrl,
      updated_at: new Date().toISOString(),
    } as Record<string, string>;
    if (seed.clientId) next.client_id = seed.clientId;
    if (seed.clientSecret) next.client_secret = seed.clientSecret;
    if (seed.jwt) next.jwt = seed.jwt;
    if (!next.client_id && !next.client_secret && !next.jwt && current.id) continue;

    await adminClient().from('ringcentral_accounts').upsert(next, { onConflict: 'store_key' });
  }
}

async function loadRingCentralAccount(storeKey: string): Promise<RingCentralAccount | null> {
  const { data, error: queryError } = await adminClient()
    .from('ringcentral_accounts')
    .select(
      'id, store_key, store_name, client_id, client_secret, jwt, server_url, account_id, company_name, main_number, extension_count, last_status, last_error, last_checked_at, has_client_id, has_secret, has_jwt, created_at, updated_at',
    )
    .eq('store_key', storeKey)
    .maybeSingle();
  if (queryError || !data) return null;
  return data as RingCentralAccount;
}

async function listRingCentralRows(): Promise<unknown[]> {
  const { data, error: queryError } = await adminClient()
    .from('ringcentral_accounts')
    .select(RC_PUBLIC_COLUMNS)
    .order('store_name');
  if (queryError) throw queryError;
  return (data || []).map((row) => publicRingCentralAccount(row as RingCentralAccount));
}

async function markRingCentralStatus(
  id: string,
  patch: Partial<RingCentralAccount>,
): Promise<RingCentralAccount | null> {
  const { data } = await adminClient()
    .from('ringcentral_accounts')
    .update({
      ...patch,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select(
      'id, store_key, store_name, client_id, client_secret, jwt, server_url, account_id, company_name, main_number, extension_count, last_status, last_error, last_checked_at, has_client_id, has_secret, has_jwt, created_at, updated_at',
    )
    .maybeSingle();
  return (data as RingCentralAccount) || null;
}

async function ringCentralAccessToken(account: RingCentralAccount): Promise<string> {
  const cached = rcTokenCache.get(account.store_key);
  if (cached && cached.expiresAt > Date.now() + 30_000) return cached.token;

  const clientId = String(account.client_id || '').trim();
  const clientSecret = String(account.client_secret || '').trim();
  const jwt = String(account.jwt || '').trim();
  if (!clientId || !clientSecret || !jwt) {
    throw new Error('missing_credentials');
  }

  const origin = rcServerUrl(account.server_url);
  const { ok, payload } = await rcJson(`${origin}/restapi/oauth/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({
      grant_type: RC_JWT_GRANT,
      assertion: jwt,
    }).toString(),
  });

  if (!ok) {
    throw new Error(rcErrorMessage(payload, 'RingCentral rejected the JWT credentials.'));
  }
  const row = (payload || {}) as { access_token?: string; expires_in?: number };
  const token = String(row.access_token || '').trim();
  if (!token) throw new Error('RingCentral did not return an access token.');
  const expiresIn = Number(row.expires_in) || 3600;
  rcTokenCache.set(account.store_key, {
    token,
    expiresAt: Date.now() + Math.max(60, expiresIn) * 1000,
  });
  return token;
}

type RingCentralNumber = {
  phoneNumber?: string;
  usageType?: string;
  type?: string;
  label?: string;
  primary?: boolean;
  extension?: { id?: string | number; extensionNumber?: string; name?: string };
};

type RingCentralExtension = {
  id?: string | number;
  extensionNumber?: string;
  name?: string;
  type?: string;
  status?: string;
  hidden?: boolean;
  contact?: { firstName?: string; lastName?: string; email?: string; businessPhone?: string };
};

function publicRingCentralNumber(row: RingCentralNumber) {
  return {
    phoneNumber: String(row.phoneNumber || ''),
    usageType: String(row.usageType || ''),
    type: String(row.type || ''),
    label: String(row.label || ''),
    primary: Boolean(row.primary),
    extensionNumber: String(row.extension?.extensionNumber || ''),
    extensionName: String(row.extension?.name || ''),
  };
}

function publicRingCentralExtension(row: RingCentralExtension) {
  const contactName = [row.contact?.firstName, row.contact?.lastName].filter(Boolean).join(' ').trim();
  return {
    id: String(row.id || ''),
    extensionNumber: String(row.extensionNumber || ''),
    name: String(row.name || contactName || ''),
    type: String(row.type || ''),
    status: String(row.status || ''),
    hidden: Boolean(row.hidden),
    email: String(row.contact?.email || ''),
    businessPhone: String(row.contact?.businessPhone || ''),
  };
}

async function refreshRingCentralAccount(account: RingCentralAccount): Promise<{
  store: RingCentralAccount;
  numbers: ReturnType<typeof publicRingCentralNumber>[];
  extensions: ReturnType<typeof publicRingCentralExtension>[];
}> {
  const origin = rcServerUrl(account.server_url);
  const token = await ringCentralAccessToken(account);
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };

  const [info, numbers, extensions] = await Promise.all([
    rcJson(`${origin}/restapi/v1.0/account/~`, { method: 'GET', headers }),
    rcJson(`${origin}/restapi/v1.0/account/~/phone-number?perPage=200`, { method: 'GET', headers }),
    rcJson(`${origin}/restapi/v1.0/account/~/extension?perPage=200`, { method: 'GET', headers }),
  ]);

  if (!info.ok) {
    throw new Error(rcErrorMessage(info.payload, 'Could not load the RingCentral account.'));
  }

  const accountInfo = (info.payload || {}) as {
    id?: string | number;
    mainNumber?: string;
    operator?: { name?: string };
    serviceInfo?: { brand?: { name?: string } };
  };
  const numberPayload = (numbers.payload || {}) as { records?: RingCentralNumber[] };
  const extensionPayload = (extensions.payload || {}) as {
    paging?: { totalElements?: number };
    records?: RingCentralExtension[];
  };

  const numberRecords = Array.isArray(numberPayload.records) ? numberPayload.records : [];
  const extensionRecords = Array.isArray(extensionPayload.records) ? extensionPayload.records : [];
  const mainFromList =
    numberRecords.find((row) => row.usageType === 'MainCompanyNumber')?.phoneNumber ||
    numberRecords.find((row) => row.primary)?.phoneNumber ||
    numberRecords[0]?.phoneNumber ||
    '';

  const updated = await markRingCentralStatus(account.id, {
    last_status: 'connected',
    last_error: '',
    last_checked_at: new Date().toISOString(),
    account_id: String(accountInfo.id || account.account_id || ''),
    company_name: String(
      accountInfo.operator?.name || accountInfo.serviceInfo?.brand?.name || account.company_name || '',
    ),
    main_number: String(accountInfo.mainNumber || mainFromList || ''),
    extension_count:
      Number(extensionPayload.paging?.totalElements) || extensionRecords.length || 0,
  });

  return {
    store: updated || account,
    numbers: numberRecords.map(publicRingCentralNumber).filter((row) => row.phoneNumber),
    extensions: extensionRecords.map(publicRingCentralExtension).filter((row) => row.id || row.extensionNumber),
  };
}

async function configuredRingCentralAccount(
  req: Request,
  storeKey: string,
): Promise<{ account: RingCentralAccount } | { response: Response }> {
  const account = await loadRingCentralAccount(storeKey);
  if (!account) {
    return {
      response: error(req, 404, 'That store has no RingCentral credentials yet.', 'ringcentral_unconfigured'),
    };
  }
  if (
    !String(account.client_id || '').trim() ||
    !String(account.client_secret || '').trim() ||
    !String(account.jwt || '').trim()
  ) {
    return {
      response: error(
        req,
        400,
        'Paste the RingCentral client ID, client secret, and JWT for this store.',
        'ringcentral_unconfigured',
      ),
    };
  }
  return { account };
}

function canManageRingCentralStaff(staff: StaffContext): boolean {
  if (staff.isSystemAdmin) return true;
  if (
    staff.appRole === 'branch_manager' ||
    staff.appRole === 'general_manager' ||
    staff.appRole === 'system_admin'
  ) {
    return true;
  }
  const pos = `${staff.posRole} ${staff.employeeType}`.toLowerCase();
  return /general\s*manager|\bgm\b|system\s*admin|\badmins?\b|owner|president|director|vice\s*president|\bvp\b/.test(
    pos,
  );
}

function jwtFromUnknown(value: unknown): string {
  if (typeof value === 'string') return value.replace(/\s+/g, '').trim();
  if (value && typeof value === 'object') {
    const first = Object.values(value as Record<string, unknown>).find(
      (item) => typeof item === 'string' && item.trim(),
    );
    return jwtFromUnknown(first);
  }
  return '';
}

function ringCentralFailureMessage(err: unknown): string {
  if (err instanceof Error && err.message === 'missing_credentials') {
    return 'Paste the RingCentral client ID, client secret, and JWT for this store.';
  }
  if (err instanceof Error) return describeRingCentralError(err.message, 'Could not reach RingCentral.');
  return 'Could not reach RingCentral.';
}

async function handleRingCentralStores(req: Request): Promise<Response> {
  try {
    await seedRingCentralFromEnv();
  } catch (err) {
    console.error('ringcentral seed failed', err instanceof Error ? err.message : err);
  }
  try {
    const stores = await listRingCentralRows();
    return json(req, 200, { stores });
  } catch (err) {
    const message = err instanceof Error ? err.message : '';
    if (/schema cache|does not exist|42P01|PGRST205/i.test(message)) {
      return error(
        req,
        400,
        'Run the Phone / RingCentral SQL in Supabase, including the schema reload line, then refresh.',
        'ringcentral_unconfigured',
      );
    }
    throw err;
  }
}

async function handleRingCentralLive(req: Request, includeDetails: boolean): Promise<Response> {
  const body = await readJson<{ storeKey?: string; storeName?: string }>(req);
  const storeKey = storeKeyOf(body.storeKey || body.storeName || '');
  if (!storeKey) return error(req, 400, 'Choose a store to check.', 'bad_request');

  try {
    await seedRingCentralFromEnv();
  } catch (err) {
    console.error('ringcentral seed failed', err instanceof Error ? err.message : err);
  }

  const loaded = await configuredRingCentralAccount(req, storeKey);
  if ('response' in loaded) return loaded.response;
  const account = loaded.account;

  try {
    const refreshed = await refreshRingCentralAccount(account);
    return json(req, 200, {
      store: publicRingCentralAccount(refreshed.store),
      ...(includeDetails ? { numbers: refreshed.numbers, extensions: refreshed.extensions } : {}),
    });
  } catch (err) {
    const message = ringCentralFailureMessage(err);
    rcTokenCache.delete(storeKey);
    const failed = await markRingCentralStatus(account.id, {
      last_status: 'error',
      last_error: message.slice(0, 300),
      last_checked_at: new Date().toISOString(),
    });
    return json(req, 200, {
      store: publicRingCentralAccount(failed || account),
      ...(includeDetails ? { numbers: [], extensions: [] } : {}),
    });
  }
}

async function handleRingCentralSave(req: Request, staff: StaffContext): Promise<Response> {
  if (!canManageRingCentralStaff(staff)) {
    return error(
      req,
      403,
      'No permission to change RingCentral credentials. Branch managers and above can edit them.',
      'forbidden',
    );
  }

  const body = await readJson<{
    id?: string;
    storeKey?: string;
    storeName?: string;
    clientId?: string;
    clientSecret?: string;
    jwt?: unknown;
    serverUrl?: string;
  }>(req);

  const storeName = String(body.storeName || '').trim();
  const storeKey = storeKeyOf(body.storeKey || storeName);
  if (!storeKey || !storeName) return error(req, 400, 'Choose a store.', 'bad_request');

  const clientId = String(body.clientId || '').trim();
  const clientSecret = String(body.clientSecret || '').trim();
  const jwt = jwtFromUnknown(body.jwt);
  const existingId = String(body.id || '').trim();
  if (!existingId && (!clientId || !clientSecret || !jwt)) {
    return error(req, 400, 'Paste the RingCentral client ID, client secret, and JWT for this store.', 'bad_request');
  }

  const row: Record<string, string> = {
    store_key: storeKey,
    store_name: storeName,
    server_url: rcServerUrl(String(body.serverUrl || '')),
    updated_at: new Date().toISOString(),
    updated_by: staff.userId,
  };
  if (clientId) row.client_id = clientId;
  if (clientSecret) row.client_secret = clientSecret;
  if (jwt) {
    row.jwt = jwt;
    rcTokenCache.delete(storeKey);
  }

  const writer = existingId
    ? adminClient().from('ringcentral_accounts').update(row).eq('id', existingId)
    : adminClient().from('ringcentral_accounts').upsert(row, { onConflict: 'store_key' });

  const { data, error: writeError } = await writer.select(RC_PUBLIC_COLUMNS).maybeSingle();
  if (writeError) {
    return error(req, 400, writeError.message || 'The RingCentral account could not be saved.', 'bad_request');
  }
  if (!data) return error(req, 400, 'The RingCentral account could not be saved.', 'bad_request');
  return json(req, 200, { store: publicRingCentralAccount(data as RingCentralAccount) });
}

async function handleRingCentralDelete(req: Request, staff: StaffContext): Promise<Response> {
  if (!canManageRingCentralStaff(staff)) {
    return error(
      req,
      403,
      'No permission to change RingCentral credentials. Branch managers and above can edit them.',
      'forbidden',
    );
  }
  const body = await readJson<{ id?: string; storeKey?: string }>(req);
  const id = String(body.id || '').trim();
  const storeKey = storeKeyOf(body.storeKey || '');
  if (!id && !storeKey) return error(req, 400, 'Missing account.', 'bad_request');

  let query = adminClient().from('ringcentral_accounts').delete();
  query = id ? query.eq('id', id) : query.eq('store_key', storeKey);
  const { error: deleteError } = await query;
  if (deleteError) {
    return error(req, 400, deleteError.message || 'Could not remove credentials.', 'bad_request');
  }
  if (storeKey) rcTokenCache.delete(storeKey);
  return json(req, 200, { ok: true });
}

function rcSafeId(value: unknown): string {
  const id = String(value || '').trim();
  return /^[\w.-]+$/.test(id) ? id : '';
}

function rcDigits(value: unknown): string {
  return String(value || '').replace(/\D/g, '');
}

function rcE164(value: unknown): string {
  const digits = rcDigits(value);
  if (!digits) return '';
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (String(value || '').trim().startsWith('+')) return `+${digits}`;
  return `+${digits}`;
}

function rcParty(value: unknown): { phoneNumber: string; name: string } {
  if (!value) return { phoneNumber: '', name: '' };
  if (typeof value === 'string') return { phoneNumber: value, name: '' };
  if (typeof value === 'object') {
    const row = value as Record<string, unknown>;
    return {
      phoneNumber: String(row.phoneNumber || row.extensionNumber || ''),
      name: String(row.name || ''),
    };
  }
  return { phoneNumber: '', name: '' };
}

function rcStatusFromCode(code: string): string {
  if (code === 'Proceeding' || code === 'Setup') return 'Ringing';
  if (code === 'Answered') return 'CallConnected';
  if (code === 'Hold' || code === 'Parked') return 'OnHold';
  if (code === 'VoiceMail' || code === 'VoiceMailScreening') return 'Voicemail';
  return code || '';
}

type LivePhoneCall = {
  id: string;
  storeKey: string;
  storeName: string;
  direction: string;
  status: string;
  from: string;
  fromName: string;
  to: string;
  toName: string;
  telephonySessionId: string;
  partyId: string;
  sessionId: string;
  startTime: string;
  extensionNumber: string;
  extensionName: string;
};

function mapPresenceCalls(account: RingCentralAccount, payload: unknown): LivePhoneCall[] {
  const root = (payload || {}) as Record<string, unknown>;
  const records = Array.isArray(root.records)
    ? root.records
    : Array.isArray(root.activeCalls) || root.telephonyStatus
      ? [root]
      : [];
  const calls: LivePhoneCall[] = [];
  for (const item of records) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const extension = (rec.extension || {}) as Record<string, unknown>;
    const active = Array.isArray(rec.activeCalls) ? rec.activeCalls : [];
    for (const raw of active) {
      if (!raw || typeof raw !== 'object') continue;
      const call = raw as Record<string, unknown>;
      const from = rcParty(call.from);
      const to = rcParty(call.to);
      const telephonySessionId = String(call.telephonySessionId || '');
      const sessionId = String(call.sessionId || call.id || '');
      const status = String(call.telephonyStatus || rec.telephonyStatus || '');
      calls.push({
        id: telephonySessionId || sessionId,
        storeKey: account.store_key,
        storeName: account.store_name,
        direction: String(call.direction || '') === 'Outbound' ? 'Outbound' : 'Inbound',
        status,
        from: from.phoneNumber,
        fromName: from.name,
        to: to.phoneNumber,
        toName: to.name,
        telephonySessionId,
        partyId: String(call.partyId || ''),
        sessionId,
        startTime: String(call.startTime || ''),
        extensionNumber: String(extension.extensionNumber || ''),
        extensionName: String(extension.name || ''),
      });
    }
  }
  return calls.filter((row) => row.id);
}

function mapSessionCalls(account: RingCentralAccount, payload: unknown): LivePhoneCall[] {
  const root = (payload || {}) as Record<string, unknown>;
  const records = Array.isArray(root.records) ? root.records : Array.isArray(payload) ? payload : [];
  const calls: LivePhoneCall[] = [];
  for (const item of records) {
    if (!item || typeof item !== 'object') continue;
    const session = item as Record<string, unknown>;
    const parties = Array.isArray(session.parties) ? session.parties : [];
    const telephonySessionId = String(session.id || '');
    for (const raw of parties) {
      if (!raw || typeof raw !== 'object') continue;
      const party = raw as Record<string, unknown>;
      const statusRow = (party.status || {}) as Record<string, unknown>;
      const from = rcParty(party.from);
      const to = rcParty(party.to);
      const direction = String(party.direction || '') === 'Outbound' ? 'Outbound' : 'Inbound';
      calls.push({
        id: `${telephonySessionId}:${String(party.id || '')}`,
        storeKey: account.store_key,
        storeName: account.store_name,
        direction,
        status: rcStatusFromCode(String(statusRow.code || '')),
        from: from.phoneNumber,
        fromName: from.name,
        to: to.phoneNumber,
        toName: to.name,
        telephonySessionId,
        partyId: String(party.id || ''),
        sessionId: telephonySessionId,
        startTime: String(session.creationTime || party.startTime || ''),
        extensionNumber: '',
        extensionName: '',
      });
    }
  }
  return calls.filter((row) => row.telephonySessionId);
}

function mergeLiveCalls(rows: LivePhoneCall[]): LivePhoneCall[] {
  const byKey = new Map<string, LivePhoneCall>();
  for (const row of rows) {
    const key = row.telephonySessionId || row.sessionId || row.id;
    const current = byKey.get(key);
    if (!current) {
      byKey.set(key, row);
      continue;
    }
    byKey.set(key, {
      ...current,
      ...row,
      partyId: row.partyId || current.partyId,
      telephonySessionId: row.telephonySessionId || current.telephonySessionId,
      from: row.from || current.from,
      fromName: row.fromName || current.fromName,
      to: row.to || current.to,
      toName: row.toName || current.toName,
      status: row.status || current.status,
      extensionNumber: current.extensionNumber || row.extensionNumber,
      extensionName: current.extensionName || row.extensionName,
    });
  }
  return [...byKey.values()];
}

function mapCallLog(account: RingCentralAccount, payload: unknown) {
  const root = (payload || {}) as { records?: unknown[] };
  const records = Array.isArray(root.records) ? root.records : [];
  return records
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const row = item as Record<string, unknown>;
      const from = rcParty(row.from);
      const to = rcParty(row.to);
      return {
        id: String(row.id || ''),
        storeKey: account.store_key,
        storeName: account.store_name,
        direction: String(row.direction || ''),
        result: String(row.result || ''),
        duration: Number(row.duration) || 0,
        startTime: String(row.startTime || ''),
        from: from.phoneNumber,
        fromName: from.name,
        to: to.phoneNumber,
        toName: to.name,
      };
    })
    .filter((row) => row?.id);
}

function mapVoicemails(account: RingCentralAccount, payload: unknown) {
  const root = (payload || {}) as { records?: unknown[] };
  const records = Array.isArray(root.records) ? root.records : [];
  return records
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const row = item as Record<string, unknown>;
      const from = rcParty(row.from);
      const toList = Array.isArray(row.to) ? row.to : [];
      const to = rcParty(toList[0] || row.to);
      const attachments = Array.isArray(row.attachments) ? row.attachments : [];
      const audio = attachments.find((att) => {
        if (!att || typeof att !== 'object') return false;
        const type = String((att as Record<string, unknown>).type || '');
        const contentType = String((att as Record<string, unknown>).contentType || '');
        return type === 'AudioRecording' || contentType.startsWith('audio/');
      }) as Record<string, unknown> | undefined;
      const vm = (row.vm || {}) as Record<string, unknown>;
      return {
        id: String(row.id || ''),
        storeKey: account.store_key,
        storeName: account.store_name,
        from: from.phoneNumber,
        fromName: from.name,
        to: to.phoneNumber,
        toName: to.name,
        subject: String(row.subject || ''),
        creationTime: String(row.creationTime || ''),
        readStatus: String(row.readStatus || ''),
        duration: Number(vm.duration || row.vmDuration) || 0,
        attachmentId: String(audio?.id || ''),
      };
    })
    .filter((row) => row?.id);
}

async function ringCentralSession(
  req: Request,
  storeKey: string,
): Promise<{ account: RingCentralAccount; origin: string; headers: Record<string, string> } | { response: Response }> {
  const loaded = await configuredRingCentralAccount(req, storeKey);
  if ('response' in loaded) return loaded;
  const account = loaded.account;
  try {
    const token = await ringCentralAccessToken(account);
    return {
      account,
      origin: rcServerUrl(account.server_url),
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
    };
  } catch (err) {
    const message = ringCentralFailureMessage(err);
    rcTokenCache.delete(storeKey);
    await markRingCentralStatus(account.id, {
      last_status: 'error',
      last_error: message.slice(0, 300),
      last_checked_at: new Date().toISOString(),
    });
    return { response: error(req, 400, message, 'ringcentral_unconfigured') };
  }
}

async function collectLiveCalls(
  account: RingCentralAccount,
  origin: string,
  headers: Record<string, string>,
): Promise<LivePhoneCall[]> {
  const [presence, sessions] = await Promise.all([
    rcJson(`${origin}/restapi/v1.0/account/~/presence?detailedTelephonyState=true&perPage=200`, {
      method: 'GET',
      headers,
    }),
    rcJson(`${origin}/restapi/v1.0/account/~/telephony/sessions`, { method: 'GET', headers }),
  ]);

  let presencePayload = presence.payload;
  if (!presence.ok) {
    const fallback = await rcJson(
      `${origin}/restapi/v1.0/account/~/extension/~/presence?detailedTelephonyState=true`,
      { method: 'GET', headers },
    );
    presencePayload = fallback.ok ? fallback.payload : {};
  }

  return mergeLiveCalls([
    ...mapPresenceCalls(account, presencePayload),
    ...mapSessionCalls(account, sessions.ok ? sessions.payload : {}),
  ]);
}

async function firstRingCentralDevice(
  origin: string,
  headers: Record<string, string>,
): Promise<string> {
  const devices = await rcJson(`${origin}/restapi/v1.0/account/~/extension/~/device`, {
    method: 'GET',
    headers,
  });
  if (!devices.ok) return '';
  const records = Array.isArray((devices.payload as { records?: unknown[] })?.records)
    ? ((devices.payload as { records: Record<string, unknown>[] }).records)
    : [];
  const ranked = [...records].sort((a, b) => {
    const rank = (row: Record<string, unknown>) => {
      const type = String(row.type || '');
      if (type === 'WebPhone' || type === 'WebRTC') return 0;
      if (type === 'SoftPhone') return 1;
      if (type === 'HardPhone') return 2;
      return 3;
    };
    return rank(a) - rank(b);
  });
  return String(ranked[0]?.id || '');
}

async function handleRingCentralPhone(req: Request): Promise<Response> {
  const body = await readJson<{
    action?: string;
    storeKey?: string;
    storeName?: string;
    to?: string;
    from?: string;
    telephonySessionId?: string;
    partyId?: string;
  }>(req);
  const action = String(body.action || 'presence').trim().toLowerCase();
  const storeKey = storeKeyOf(body.storeKey || body.storeName || '');
  if (!storeKey) return error(req, 400, 'Choose a store.', 'bad_request');

  const session = await ringCentralSession(req, storeKey);
  if ('response' in session) return session.response;
  const { account, origin, headers } = session;

  try {
    if (action === 'presence') {
      const liveCalls = await collectLiveCalls(account, origin, headers);
      return json(req, 200, {
        store: publicRingCentralAccount(account),
        liveCalls,
        incoming: liveCalls.filter(
          (row) => row.direction === 'Inbound' && /ringing|proceeding|setup/i.test(row.status),
        ),
      });
    }

    if (action === 'inbox') {
      const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
      const [logRes, vmRes, liveCalls] = await Promise.all([
        rcJson(
          `${origin}/restapi/v1.0/account/~/call-log?view=Simple&type=Voice&perPage=50&dateFrom=${encodeURIComponent(since)}`,
          { method: 'GET', headers },
        ),
        rcJson(
          `${origin}/restapi/v1.0/account/~/extension/~/message-store?messageType=VoiceMail&perPage=50`,
          { method: 'GET', headers },
        ),
        collectLiveCalls(account, origin, headers),
      ]);
      return json(req, 200, {
        store: publicRingCentralAccount(account),
        liveCalls,
        incoming: liveCalls.filter(
          (row) => row.direction === 'Inbound' && /ringing|proceeding|setup/i.test(row.status),
        ),
        calls: logRes.ok ? mapCallLog(account, logRes.payload) : [],
        voicemails: vmRes.ok ? mapVoicemails(account, vmRes.payload) : [],
        callLogError: logRes.ok ? '' : rcErrorMessage(logRes.payload, 'Could not load the call log.'),
        voicemailError: vmRes.ok ? '' : rcErrorMessage(vmRes.payload, 'Could not load voicemail.'),
      });
    }

    if (action === 'ringout') {
      const to = rcE164(body.to);
      if (!to) return error(req, 400, 'Enter a number to call.', 'bad_request');
      const from = rcE164(body.from || account.main_number);
      if (!from) return error(req, 400, 'This store has no caller number yet.', 'bad_request');
      const result = await rcJson(`${origin}/restapi/v1.0/account/~/extension/~/ring-out`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          from: { phoneNumber: from },
          to: { phoneNumber: to },
          playPrompt: false,
          callerId: { phoneNumber: from },
        }),
      });
      if (!result.ok) {
        return error(req, 400, rcErrorMessage(result.payload, 'Could not start the call.'), 'bad_request');
      }
      const row = (result.payload || {}) as Record<string, unknown>;
      const liveCalls = await collectLiveCalls(account, origin, headers);
      return json(req, 200, {
        store: publicRingCentralAccount(account),
        ringOut: {
          id: String(row.id || ''),
          status: String((row.status as { callStatus?: string } | undefined)?.callStatus || row.status || ''),
        },
        liveCalls,
      });
    }

    if (action === 'answer' || action === 'reject' || action === 'hangup') {
      const telephonySessionId = rcSafeId(body.telephonySessionId);
      const partyId = rcSafeId(body.partyId);
      if (!telephonySessionId || !partyId) {
        return error(req, 400, 'That call is no longer available.', 'bad_request');
      }
      const base = `${origin}/restapi/v1.0/account/~/telephony/sessions/${telephonySessionId}/parties/${partyId}`;
      let result;
      if (action === 'answer') {
        const deviceId = await firstRingCentralDevice(origin, headers);
        result = await rcJson(`${base}/answer`, {
          method: 'POST',
          headers,
          body: JSON.stringify(deviceId ? { deviceId } : {}),
        });
        if (!result.ok && !deviceId) {
          return error(
            req,
            400,
            'Open the RingCentral app or desk phone to take this call, then use Answer. You can still reject it here.',
            'bad_request',
          );
        }
      } else if (action === 'reject') {
        result = await rcJson(`${base}/reject`, { method: 'POST', headers, body: '{}' });
      } else {
        result = await rcJson(`${base}`, { method: 'DELETE', headers });
      }
      if (!result.ok) {
        const fallbackMessage =
          action === 'answer'
            ? 'Could not answer. Pick up on the RingCentral app or desk phone, or reject the call here.'
            : action === 'reject'
              ? 'Could not reject the call.'
              : 'Could not hang up.';
        return error(req, 400, rcErrorMessage(result.payload, fallbackMessage), 'bad_request');
      }
      const liveCalls = await collectLiveCalls(account, origin, headers);
      return json(req, 200, { store: publicRingCentralAccount(account), liveCalls, ok: true });
    }

    return error(req, 400, 'Unknown phone action.', 'bad_request');
  } catch (err) {
    const message = ringCentralFailureMessage(err);
    rcTokenCache.delete(storeKey);
    return error(req, 502, message, 'upstream_failed');
  }
}

async function handleRingCentralVoicemailContent(req: Request, query: URLSearchParams): Promise<Response> {
  const storeKey = storeKeyOf(query.get('storeKey') || '');
  const messageId = rcSafeId(query.get('messageId'));
  const attachmentId = rcSafeId(query.get('attachmentId'));
  if (!storeKey || !messageId) return error(req, 400, 'Missing voicemail.', 'bad_request');

  const session = await ringCentralSession(req, storeKey);
  if ('response' in session) return session.response;
  const { origin, headers } = session;
  const path = attachmentId
    ? `${origin}/restapi/v1.0/account/~/extension/~/message-store/${messageId}/content/${attachmentId}`
    : `${origin}/restapi/v1.0/account/~/extension/~/message-store/${messageId}/content`;
  const upstream = await forward(path, { method: 'GET', headers: { Authorization: headers.Authorization } }, 30_000);
  if (!upstream.ok) {
    const payload = await upstream.json().catch(() => null);
    return error(req, 400, rcErrorMessage(payload, 'Could not load that voicemail.'), 'bad_request');
  }
  return passthroughResponse(req, upstream);
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
    if (path === '/moneris/cloud') {
      return await handleMonerisCloud(req, staff.userId);
    }
    if (path === '/moneris/poll') {
      return await handleMonerisPoll(req, staff.userId);
    }
    if (path === '/ringcentral/stores' && req.method === 'GET') {
      return await handleRingCentralStores(req);
    }
    if (path === '/ringcentral/check' && req.method === 'POST') {
      return await handleRingCentralLive(req, false);
    }
    if (path === '/ringcentral/details' && req.method === 'POST') {
      return await handleRingCentralLive(req, true);
    }
    if (path === '/ringcentral/save' && req.method === 'POST') {
      return await handleRingCentralSave(req, staff);
    }
    if (path === '/ringcentral/delete' && req.method === 'POST') {
      return await handleRingCentralDelete(req, staff);
    }
    if (path === '/ringcentral/phone' && req.method === 'POST') {
      return await handleRingCentralPhone(req);
    }
    if (path === '/ringcentral/voicemail-content' && req.method === 'GET') {
      return await handleRingCentralVoicemailContent(req, query);
    }
    return error(req, 404, 'Unknown proxy route.', 'not_found');
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Upstream request failed.';
    console.error('proxy upstream failure', path, message);
    const status = /too large/i.test(message) ? 413 : 502;
    return error(req, status, status === 413 ? message : 'Upstream request failed.', status === 413 ? 'too_large' : 'upstream_failed');
  }
});
