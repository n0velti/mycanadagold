/**
 * proxy — authenticated gateway to third-party APIs.
 *
 * Every request must carry a staff JWT minted by aureus-login and belong to an
 * active profile. Vendor secrets never leave this function:
 *
 *   /proxy/anthropic/v1/messages           POST  → api.anthropic.com
 *   /proxy/openai/v1/chat/completions      POST  → api.openai.com
 *   /proxy/openrouter/v1/chat/completions  POST  → openrouter.ai
 *   /proxy/avatars/inspect                 POST  → OpenAI vision (is there exactly one clear face? describe them)
 *   /proxy/avatars/stylize                 POST  → OpenAI images/edits (Disney cartoon of the person in the photo) + likeness check
 *   /proxy/fintrac/<path>                  *     → www142.fintrac-canafe.canada.ca
 *   /proxy/rippling/oauth/config           GET   → { clientId, configured, connected, canManage }
 *   /proxy/rippling/oauth/app              POST  → save company OAuth app (admin)
 *   /proxy/rippling/oauth/token            POST  → app.rippling.com/o/token (client secret held here)
 *   /proxy/rippling/company                POST  → save shared HR token (admin)
 *   /proxy/rippling/company/disconnect     POST  → clear shared HR token (admin)
 *   /proxy/rippling/<path>                 GET   → rest.ripplingapis.com
 *   /proxy/gmail/oauth/config              GET   → { clientId, configured, hostedDomain }
 *   /proxy/gmail/oauth/token               POST  → oauth2.googleapis.com/token (client secret held here)
 *   /proxy/gmail/mailbox                   POST  → Gmail inbox / sent list
 *   /proxy/gmail/message                   GET   → one Gmail message body
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
 * FINTRAC and Gmail user tokens are forwarded from
 * `X-Upstream-Authorization`. Rippling uses that header or the company
 * connection saved by a System Admin / GM / HR.
 */
import { corsHeaders, error, json, preflight, readJson, securityHeaders } from '../_shared/http.ts';
import { adminClient, requireActiveStaff, StaffAuthError, type StaffContext } from '../_shared/staff.ts';

const FUNCTION_PREFIX = '/proxy';
const MAX_BODY_BYTES = 25 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 120_000;
const RATE_LIMIT_AVATAR = 12;

const FINTRAC_ORIGIN = 'https://www142.fintrac-canafe.canada.ca';
const RIPPLING_API_ORIGIN = 'https://rest.ripplingapis.com';
const RIPPLING_OAUTH_TOKEN_URL = 'https://app.rippling.com/o/token';
const GMAIL_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GMAIL_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';
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
// Newest first: GPT Image 2.5 keeps the subject's face best. Older models
// are fallbacks for keys that do not have access yet.
const AVATAR_MODELS = ['gpt-image-2.5-sunburst', 'gpt-image-2.5-flare', 'gpt-image-2', 'gpt-image-1.5'];
// Vision models used to inspect the photo and to check the finished cartoon.
const AVATAR_VISION_MODELS = ['gpt-5.6-terra', 'gpt-5.4-mini', 'gpt-4.1-mini'];
const AVATAR_VISION_TIMEOUT_MS = 25_000;
// Supabase returns 504 if nothing is sent within 150 s. Every avatar request
// plans its work inside this budget instead of hoping the model is quick.
const AVATAR_REQUEST_BUDGET_MS = 135_000;
const AVATAR_GENERATE_MAX_MS = 110_000;
const AVATAR_GENERATE_MIN_MS = 30_000;
const AVATAR_VERIFY_MIN_MS = 10_000;

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

type ImageApiError = { error?: { message?: string; code?: string; type?: string } };

function imageApiError(payload: unknown): { message: string; code: string } {
  const err = payload && typeof payload === 'object' ? (payload as ImageApiError).error : null;
  return { message: String(err?.message || ''), code: String(err?.code || err?.type || '') };
}

/** The model name was rejected (not enabled on this key yet, or retired). Try the next one. */
function isRetryableImageModelError(payload: unknown): boolean {
  const { message, code } = imageApiError(payload);
  return /model|unknown|not found|does not exist|not available|invalid value/i.test(`${code} ${message}`);
}

/** The safety filter declined the photo; another model will say the same thing. */
function isModerationBlocked(payload: unknown): boolean {
  const { message, code } = imageApiError(payload);
  return /moderation|safety|content_policy|policy violation/i.test(`${code} ${message}`);
}

function sanitizeSubjectDescription(value: unknown): string {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.slice(0, 400);
}

function sanitizeIssues(value: unknown): string[] {
  const list = Array.isArray(value) ? value : typeof value === 'string' && value ? [value] : [];
  return list
    .map((item) => String(item ?? '').replace(/\s+/g, ' ').trim().slice(0, 160))
    .filter(Boolean)
    .slice(0, 4);
}

function buildAvatarPrompt(subject: string, shirt: string, background: string, corrections: string[] = []): string {
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
  if (corrections.length > 0) {
    parts.push(
      `A previous attempt did not look like this person. Look at the photo again and fix exactly these mistakes: ${corrections.join(' ')} Everything else about their likeness must still match the photo.`,
    );
  }
  return parts.join(' ');
}

/** Prompt for the photo pre-check. Strict JSON so the client can act on it. */
const AVATAR_INSPECT_PROMPT = [
  'You are checking a photo before an artist draws a cartoon portrait of the person in it.',
  'Return strict JSON only, with these keys:',
  '"faceCount": the number of people whose face is clearly visible (not tiny background figures);',
  '"framing": one of "good", "cut_off" (part of the main face is outside the frame), "too_small" (the face is a small part of the image), "too_dark" (the face is hard to see), or "no_face";',
  '"subject": one factual sentence describing the main person (the largest or most central face) so an artist can keep their exact likeness:',
  'apparent sex or gender presentation (woman, man, girl, boy, or as photographed), approximate age, ethnicity or skin tone, face shape, nose, mouth, jaw, eyebrow shape,',
  'eye color and eye shape, hair color, hair length and style, facial hair or clean-shaven, glasses, earrings or other visible accessories, and any distinctive marks.',
  'Do not guess a name. Do not invent features that are not visible. Do not describe lighting, clothing, or camera style. If there is no face, set "subject" to "".',
].join(' ');

/** Prompt for the likeness check after drawing. */
const AVATAR_VERIFY_PROMPT = [
  'Image 1 is a photograph of a person. Image 2 is a cartoon portrait that is supposed to be that same person.',
  'Decide whether someone who knows the person in Image 1 would immediately recognize Image 2 as them.',
  'A stylized cartoon look is expected and is NOT a problem: smoother skin, slightly larger eyes, simplified hair, different clothing, and a different background are all fine.',
  'Report a problem ONLY when you are confident Image 2 differs from Image 1 in one of these: gender presentation; skin tone; hair color; hair length or basic hairstyle;',
  'glasses present in one but not the other; facial hair present in one but not the other; a clearly different age group (child vs adult, young adult vs elderly);',
  'a distinctly different face shape or a face that is clearly a different person; more than one person or no face in Image 2; or Image 2 not being a cartoon at all.',
  'Return strict JSON only: {"match": true or false, "issues": [up to 4 short concrete corrections written as instructions to the artist, for example "Give her shoulder-length dark brown hair, not short blonde hair"; empty when match is true]}',
].join(' ');

function parseJsonObject(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  const text = String(value ?? '').trim();
  if (!text) return null;
  const candidates = [text, text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')];
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) candidates.push(text.slice(start, end + 1));
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      // try the next shape
    }
  }
  return null;
}

/**
 * Ask a vision model a question about one or two images and get a JSON
 * object back. Falls through the model list; returns null when none answer.
 */
async function avatarVisionJson(
  key: string,
  prompt: string,
  images: string[],
  timeoutMs: number,
): Promise<Record<string, unknown> | null> {
  const content = [
    { type: 'text', text: prompt },
    ...images.map((url) => ({ type: 'image_url', image_url: { url, detail: 'high' } })),
  ];
  for (const model of AVATAR_VISION_MODELS) {
    try {
      const body: Record<string, unknown> = {
        model,
        // Includes reasoning tokens on gpt-5.x; the JSON answer itself is tiny.
        max_completion_tokens: 1200,
        response_format: { type: 'json_object' },
        messages: [{ role: 'user', content }],
      };
      if (/^gpt-5/.test(model)) body.reasoning_effort = 'low';
      const upstream = await forward(
        'https://api.openai.com/v1/chat/completions',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${key}`,
          },
          body: JSON.stringify(body),
        },
        timeoutMs,
      );
      const result = await upstream.json().catch(() => null);
      if (!upstream.ok) continue;
      const parsed = parseJsonObject(result?.choices?.[0]?.message?.content);
      if (parsed) return parsed;
    } catch {
      // Timeout or network error: fall through to the next vision model.
    }
  }
  return null;
}

type AvatarInspection = {
  ok: boolean;
  reason: string;
  message: string;
  subject: string;
  faceCount: number | null;
  framing: string;
};

/** Look at the photo: exactly one clear face? Who is it? */
async function inspectAvatarPhoto(key: string, dataUrl: string, timeoutMs: number): Promise<AvatarInspection> {
  const result = await avatarVisionJson(key, AVATAR_INSPECT_PROMPT, [dataUrl], timeoutMs);
  const unknown: AvatarInspection = { ok: true, reason: '', message: '', subject: '', faceCount: null, framing: 'unknown' };
  if (!result) return unknown;

  const faceCountRaw = Number(result.faceCount);
  const faceCount = Number.isFinite(faceCountRaw) ? Math.max(0, Math.round(faceCountRaw)) : null;
  const framing = String(result.framing || '').toLowerCase().trim();
  const subject = sanitizeSubjectDescription(result.subject);

  if (faceCount === 0 || framing === 'no_face') {
    return {
      ok: false,
      reason: 'no_face',
      message: 'We could not see a face clearly. Face the camera in good light, then try again.',
      subject: '',
      faceCount,
      framing,
    };
  }
  if (faceCount !== null && faceCount > 1) {
    return {
      ok: false,
      reason: 'multiple_people',
      message: 'We can see more than one person. Make sure only you are in the frame, then try again.',
      subject: '',
      faceCount,
      framing,
    };
  }
  if (framing === 'cut_off') {
    return {
      ok: false,
      reason: 'cut_off',
      message: 'Part of your face is outside the frame. Center your face in the oval, then try again.',
      subject,
      faceCount,
      framing,
    };
  }
  return { ok: true, reason: '', message: '', subject, faceCount, framing: framing || 'unknown' };
}

async function handleAvatarInspect(req: Request, body: ArrayBuffer | null): Promise<Response> {
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
  if (!parseImageDataUrl(dataUrl)) {
    return error(req, 400, 'Send a JPEG, PNG, or WebP photo under 8 MB.', 'bad_request');
  }

  const inspection = await inspectAvatarPhoto(key, dataUrl, AVATAR_VISION_TIMEOUT_MS);
  return json(req, 200, inspection);
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

/**
 * One drawing pass. The client sends the photo plus the `subject` sentence
 * from /avatars/inspect (so we do not pay for vision twice) and, on a retry,
 * the `corrections` the likeness check asked for. We draw once, then compare
 * the cartoon with the photo and report `verified` so the client can decide
 * whether to ask for another pass. Everything stays inside the 150 s gateway
 * limit; when time runs short the check is skipped rather than the request
 * dying with a 504.
 */
async function handleAvatarStylize(req: Request, body: ArrayBuffer | null, staffId = ''): Promise<Response> {
  if (req.method !== 'POST') return error(req, 405, 'Use POST.', 'method_not_allowed');
  const startedAt = Date.now();
  const deadline = startedAt + AVATAR_REQUEST_BUDGET_MS;
  const remaining = () => deadline - Date.now();

  const key = await resolveAiApiKey('openai', 'OPENAI_API_KEY');
  if (!key) return error(req, 400, MISSING_AI_KEY, 'missing_key');

  let payload: { image?: string; subject?: string; corrections?: unknown; attempt?: number } = {};
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

  const corrections = sanitizeIssues(payload.corrections);
  const attempt = Math.max(1, Math.min(9, Math.round(Number(payload.attempt) || 1)));

  // Identity facts: reuse the client's inspection, else look once ourselves.
  let subject = sanitizeSubjectDescription(payload.subject);
  if (!subject) {
    const inspection = await inspectAvatarPhoto(key, dataUrl, Math.min(AVATAR_VISION_TIMEOUT_MS, 20_000));
    if (!inspection.ok) return error(req, 400, inspection.message, 'bad_request');
    subject = inspection.subject;
  }

  const seed = staffId || subject || String(image.bytes.byteLength);
  const shirt = pickForPerson(AVATAR_SHIRTS, seed, 'shirt');
  const background = pickForPerson(AVATAR_BACKGROUNDS, seed, 'background');
  const prompt = buildAvatarPrompt(subject, shirt, background, corrections);

  let cartoon = '';
  let usedModel = '';
  let lastMessage = 'Could not draw that portrait.';
  let lastStatus = 502;

  for (const model of AVATAR_MODELS) {
    if (remaining() < AVATAR_GENERATE_MIN_MS) {
      lastMessage = 'The portrait took too long to draw. Try again.';
      lastStatus = 504;
      break;
    }
    const timeoutMs = Math.min(AVATAR_GENERATE_MAX_MS, remaining() - 5_000);

    let upstream: Response;
    try {
      upstream = await forward(
        'https://api.openai.com/v1/images/edits',
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}` },
          body: buildAvatarEditForm(image, model, prompt),
        },
        timeoutMs,
      );
    } catch (err) {
      const aborted = err instanceof Error && err.name === 'AbortError';
      lastMessage = aborted ? 'The portrait took too long to draw. Try again.' : 'Could not reach the portrait service.';
      lastStatus = aborted ? 504 : 502;
      console.warn('avatar stylize transport failure', model, err instanceof Error ? err.message : err);
      continue;
    }

    let result: { data?: Array<{ b64_json?: string }> } & ImageApiError = {};
    try {
      result = await upstream.json();
    } catch {
      lastMessage = 'Portrait service returned an invalid response.';
      lastStatus = 502;
      continue;
    }

    if (!upstream.ok) {
      const { message } = imageApiError(result);
      lastMessage = message || `Portrait service error ${upstream.status}.`;
      lastStatus = upstream.status >= 500 ? 502 : upstream.status === 429 ? 429 : 400;
      console.warn('avatar stylize upstream error', model, upstream.status, lastMessage);
      if (isModerationBlocked(result)) {
        return error(
          req,
          400,
          'The image safety filter declined that photo. Try a plain head-and-shoulders photo with nothing else in the frame.',
          'bad_request',
        );
      }
      // Model unavailable, rate limited, or a server-side hiccup: try the next model.
      if (upstream.status >= 500 || upstream.status === 429 || isRetryableImageModelError(result)) continue;
      return error(req, 400, lastMessage, 'bad_request');
    }

    const b64 = result?.data?.[0]?.b64_json;
    if (!b64) {
      lastMessage = 'Portrait service did not return an image.';
      lastStatus = 502;
      continue;
    }
    cartoon = `data:image/jpeg;base64,${b64}`;
    usedModel = model;
    break;
  }

  if (!cartoon) {
    return error(req, lastStatus === 429 ? 429 : lastStatus, lastMessage, lastStatus === 429 ? 'throttled' : 'upstream_failed');
  }

  // Likeness check: does the cartoon still read as the person in the photo?
  let verified: boolean | null = null;
  let issues: string[] = [];
  if (remaining() >= AVATAR_VERIFY_MIN_MS) {
    const check = await avatarVisionJson(
      key,
      AVATAR_VERIFY_PROMPT,
      [dataUrl, cartoon],
      Math.min(AVATAR_VISION_TIMEOUT_MS, remaining() - 3_000),
    );
    if (check && typeof check.match === 'boolean') {
      verified = check.match;
      issues = verified ? [] : sanitizeIssues(check.issues);
    }
  }

  console.info('avatar stylize', {
    model: usedModel,
    attempt,
    verified,
    issues: issues.length,
    ms: Date.now() - startedAt,
  });

  return json(req, 200, { image: cartoon, verified, issues, model: usedModel, attempt, subject });
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

type CompanyRipplingRow = {
  oauth_client_id: string;
  oauth_client_secret: string;
  access_token: string;
  refresh_token: string;
  token_source: string;
  company_name: string;
};

function canManageCompanyRippling(staff: StaffContext): boolean {
  if (staff.isSystemAdmin) return true;
  return staff.appRole === 'system_admin' || staff.appRole === 'general_manager' || staff.appRole === 'hr';
}

function emptyCompanyRippling(): CompanyRipplingRow {
  return {
    oauth_client_id: '',
    oauth_client_secret: '',
    access_token: '',
    refresh_token: '',
    token_source: '',
    company_name: '',
  };
}

async function loadCompanyRippling(): Promise<CompanyRipplingRow> {
  try {
    const { data, error: queryError } = await adminClient()
      .from('company_rippling')
      .select('oauth_client_id, oauth_client_secret, access_token, refresh_token, token_source, company_name')
      .eq('id', true)
      .maybeSingle();
    if (queryError || !data) return emptyCompanyRippling();
    const row = data as CompanyRipplingRow;
    return {
      oauth_client_id: String(row.oauth_client_id || '').trim(),
      oauth_client_secret: String(row.oauth_client_secret || '').trim(),
      access_token: String(row.access_token || '').trim(),
      refresh_token: String(row.refresh_token || '').trim(),
      token_source: String(row.token_source || '').trim(),
      company_name: String(row.company_name || '').trim(),
    };
  } catch {
    return emptyCompanyRippling();
  }
}

async function upsertCompanyRippling(
  staff: StaffContext,
  patch: Partial<CompanyRipplingRow>,
): Promise<CompanyRipplingRow> {
  const current = await loadCompanyRippling();
  const next: CompanyRipplingRow = {
    ...current,
    ...patch,
  };
  const { error: writeError } = await adminClient().from('company_rippling').upsert(
    {
      id: true,
      oauth_client_id: next.oauth_client_id,
      oauth_client_secret: next.oauth_client_secret,
      access_token: next.access_token,
      refresh_token: next.refresh_token,
      token_source: next.token_source,
      company_name: next.company_name,
      updated_at: new Date().toISOString(),
      updated_by: staff.userId,
    },
    { onConflict: 'id' },
  );
  if (writeError) throw writeError;
  return next;
}

async function ripplingOAuthApp(): Promise<{ clientId: string; clientSecret: string }> {
  const fromEnv = {
    clientId: (Deno.env.get('RIPPLING_CLIENT_ID') || '').trim(),
    clientSecret: (Deno.env.get('RIPPLING_CLIENT_SECRET') || '').trim(),
  };
  if (fromEnv.clientId && fromEnv.clientSecret) return fromEnv;
  const stored = await loadCompanyRippling();
  return {
    clientId: stored.oauth_client_id,
    clientSecret: stored.oauth_client_secret,
  };
}

function ripplingPublicConfig(
  app: { clientId: string; clientSecret: string },
  stored: CompanyRipplingRow,
  staff: StaffContext,
) {
  const configured = Boolean(app.clientId && app.clientSecret);
  return {
    clientId: configured ? app.clientId : '',
    configured,
    connected: Boolean(stored.access_token),
    companyName: stored.access_token ? stored.company_name : '',
    tokenSource: stored.access_token ? stored.token_source : '',
    canManage: canManageCompanyRippling(staff),
  };
}

async function handleRipplingOAuthConfig(req: Request, staff: StaffContext): Promise<Response> {
  const [app, stored] = await Promise.all([ripplingOAuthApp(), loadCompanyRippling()]);
  return json(req, 200, ripplingPublicConfig(app, stored, staff));
}

async function handleRipplingOAuthAppSave(
  req: Request,
  staff: StaffContext,
  body: ArrayBuffer | null,
): Promise<Response> {
  if (!canManageCompanyRippling(staff)) {
    return error(req, 403, 'Only a System Admin, General Manager, or HR can add the Rippling sign-in app.', 'forbidden');
  }

  let payload: Record<string, unknown> = {};
  try {
    payload = body ? JSON.parse(new TextDecoder().decode(body)) : {};
  } catch {
    return error(req, 400, 'Body must be JSON.', 'bad_request');
  }

  const clientId = String(payload.clientId || payload.client_id || '').trim();
  const clientSecret = String(payload.clientSecret || payload.client_secret || '').trim();
  if (!clientId || !clientSecret) {
    return error(req, 400, 'Paste the Rippling app client ID and secret.', 'bad_request');
  }
  if (clientId.length > 256 || clientSecret.length > 512) {
    return error(req, 400, 'Those Rippling app credentials are too long.', 'bad_request');
  }

  const stored = await upsertCompanyRippling(staff, {
    oauth_client_id: clientId,
    oauth_client_secret: clientSecret,
  });
  return json(req, 200, ripplingPublicConfig({ clientId, clientSecret }, stored, staff));
}

async function fetchRipplingCompanyName(token: string): Promise<string> {
  const upstream = await forward(`${RIPPLING_API_ORIGIN}/companies/?expand=parent_legal_entity`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'MyCanadaGold/1.0',
    },
  });
  const payload = await upstream.json().catch(() => null);
  const results = Array.isArray((payload as { results?: unknown[] } | null)?.results)
    ? (payload as { results: Array<Record<string, unknown>> }).results
    : [];
  const first = results[0] || {};
  const parent = (first.parent_legal_entity || {}) as Record<string, unknown>;
  return String(parent.legal_name || first.name || '').trim();
}

async function probeRipplingAccessToken(token: string): Promise<string> {
  const upstream = await forward(`${RIPPLING_API_ORIGIN}/workers/?limit=1`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'MyCanadaGold/1.0',
    },
  });
  if (!upstream.ok) {
    const payload = await upstream.json().catch(() => null);
    const message = String(
      (payload as { message?: string; detail?: string } | null)?.message ||
        (payload as { detail?: string } | null)?.detail ||
        '',
    );
    if (upstream.status === 401 || /incorrect authentication|invalid api key|unauthorized/i.test(message)) {
      throw new Error(
        'Rippling rejected this token. In Rippling, open Tools → Developer → API Tokens, create a token with workers.read, then paste only the token.',
      );
    }
    if (upstream.status === 403) {
      throw new Error(
        'This Rippling token authenticated but cannot read employees. Enable workers.read, or sign in as an admin who can view the whole company.',
      );
    }
    throw new Error(message || `Rippling request failed (${upstream.status}).`);
  }
  return fetchRipplingCompanyName(token).catch(() => '');
}

async function saveCompanyRipplingTokens(
  staff: StaffContext,
  tokens: { accessToken: string; refreshToken?: string; source: 'oauth' | 'api-token' },
): Promise<CompanyRipplingRow> {
  const companyName = await probeRipplingAccessToken(tokens.accessToken);
  return upsertCompanyRippling(staff, {
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken || '',
    token_source: tokens.source,
    company_name: companyName,
  });
}

async function handleRipplingCompanySave(
  req: Request,
  staff: StaffContext,
  body: ArrayBuffer | null,
): Promise<Response> {
  if (!canManageCompanyRippling(staff)) {
    return error(req, 403, 'Only a System Admin, General Manager, or HR can connect Rippling for everyone.', 'forbidden');
  }

  let payload: Record<string, unknown> = {};
  try {
    payload = body ? JSON.parse(new TextDecoder().decode(body)) : {};
  } catch {
    return error(req, 400, 'Body must be JSON.', 'bad_request');
  }

  const token = String(payload.token || payload.access_token || '')
    .replace(/^Bearer\s+/i, '')
    .trim();
  if (!token) return error(req, 400, 'Paste a Rippling API token to connect.', 'bad_request');

  try {
    const stored = await saveCompanyRipplingTokens(staff, { accessToken: token, source: 'api-token' });
    const app = await ripplingOAuthApp();
    return json(req, 200, { ...ripplingPublicConfig(app, stored, staff), companyName: stored.company_name });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not connect Rippling.';
    return error(req, 400, message, 'bad_request');
  }
}

async function handleRipplingCompanyDisconnect(req: Request, staff: StaffContext): Promise<Response> {
  if (!canManageCompanyRippling(staff)) {
    return error(req, 403, 'Only a System Admin, General Manager, or HR can disconnect Rippling.', 'forbidden');
  }
  const stored = await upsertCompanyRippling(staff, {
    access_token: '',
    refresh_token: '',
    token_source: '',
    company_name: '',
  });
  const app = await ripplingOAuthApp();
  return json(req, 200, ripplingPublicConfig(app, stored, staff));
}

async function refreshCompanyRipplingToken(): Promise<string> {
  const stored = await loadCompanyRippling();
  if (!stored.refresh_token) return '';
  const app = await ripplingOAuthApp();
  if (!app.clientId || !app.clientSecret) return '';

  const form = new URLSearchParams();
  form.set('grant_type', 'refresh_token');
  form.set('refresh_token', stored.refresh_token);
  const basic = btoa(`${app.clientId}:${app.clientSecret}`);
  const upstream = await forward(RIPPLING_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${basic}`,
    },
    body: form.toString(),
  });
  const payload = (await upstream.json().catch(() => null)) as
    | { access_token?: string; refresh_token?: string }
    | null;
  const accessToken = String(payload?.access_token || '').trim();
  if (!upstream.ok || !accessToken) return '';

  await adminClient()
    .from('company_rippling')
    .update({
      access_token: accessToken,
      refresh_token: String(payload?.refresh_token || stored.refresh_token).trim(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', true);
  return accessToken;
}

async function handleRipplingOAuthToken(
  req: Request,
  staff: StaffContext,
  body: ArrayBuffer | null,
): Promise<Response> {
  const { clientId, clientSecret } = await ripplingOAuthApp();
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

  if (upstream.ok && canManageCompanyRippling(staff)) {
    const tokens = (await upstream.clone().json().catch(() => null)) as
      | { access_token?: string; refresh_token?: string }
      | null;
    const accessToken = String(tokens?.access_token || '').trim();
    if (accessToken) {
      try {
        await saveCompanyRipplingTokens(staff, {
          accessToken,
          refreshToken: String(tokens?.refresh_token || '').trim(),
          source: 'oauth',
        });
      } catch (err) {
        console.error('rippling company save failed', err instanceof Error ? err.message : err);
      }
    }
  }

  return passthroughResponse(req, upstream);
}

function gmailOAuthApp(): { clientId: string; clientSecret: string; hostedDomain: string } {
  return {
    clientId: (Deno.env.get('GOOGLE_MAIL_CLIENT_ID') || '').trim(),
    clientSecret: (Deno.env.get('GOOGLE_MAIL_CLIENT_SECRET') || '').trim(),
    hostedDomain: (Deno.env.get('GOOGLE_MAIL_HOSTED_DOMAIN') || 'canadagold.ca').trim().toLowerCase() || 'canadagold.ca',
  };
}

function gmailAllowedDomains(hostedDomain: string): string[] {
  return hostedDomain
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

function emailDomain(email: string): string {
  const at = String(email || '').toLowerCase().lastIndexOf('@');
  return at >= 0 ? String(email).toLowerCase().slice(at + 1) : '';
}

function handleGmailOAuthConfig(req: Request): Response {
  const { clientId, clientSecret, hostedDomain } = gmailOAuthApp();
  const configured = Boolean(clientId && clientSecret);
  return json(req, 200, {
    clientId: configured ? clientId : '',
    configured,
    hostedDomain,
  });
}

function gmailHeader(headers: { name?: string; value?: string }[] | undefined, name: string): string {
  const wanted = name.toLowerCase();
  const match = (headers || []).find((row) => String(row?.name || '').toLowerCase() === wanted);
  return String(match?.value || '').trim();
}

function decodeGmailBody(data: string): string {
  if (!data) return '';
  try {
    const padded = data.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  } catch {
    return '';
  }
}

type GmailPart = {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailPart[];
};

function extractGmailText(part: GmailPart | undefined, preferHtml = false): string {
  if (!part) return '';
  const mime = String(part.mimeType || '').toLowerCase();
  if (mime === 'text/plain' && part.body?.data && !preferHtml) {
    return decodeGmailBody(part.body.data);
  }
  if (Array.isArray(part.parts) && part.parts.length) {
    let html = '';
    for (const child of part.parts) {
      const plain = extractGmailText(child, false);
      if (plain) return plain;
      if (!html) html = extractGmailText(child, true);
    }
    if (html) return html;
  }
  if ((mime === 'text/html' || preferHtml) && part.body?.data) {
    return decodeGmailBody(part.body.data)
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }
  return '';
}

function parseAddressList(value: string): { name: string; email: string }[] {
  const rows: { name: string; email: string }[] = [];
  const source = String(value || '');
  const re = /(?:"([^"]+)"|([^,<]+?))?\s*<([^>]+)>|([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source))) {
    const email = String(match[3] || match[4] || '').trim().toLowerCase();
    if (!email) continue;
    const name = String(match[1] || match[2] || '').trim();
    rows.push({ name, email });
  }
  return rows;
}

function mapGmailListMessage(payload: Record<string, unknown>) {
  const headers = (payload.payload as { headers?: { name?: string; value?: string }[] } | undefined)?.headers;
  const from = parseAddressList(gmailHeader(headers, 'From'))[0] || { name: '', email: '' };
  const to = parseAddressList(gmailHeader(headers, 'To'));
  const cc = parseAddressList(gmailHeader(headers, 'Cc'));
  const labels = Array.isArray(payload.labelIds) ? payload.labelIds.map((value) => String(value)) : [];
  const internal = Number(payload.internalDate);
  return {
    id: String(payload.id || ''),
    threadId: String(payload.threadId || ''),
    subject: gmailHeader(headers, 'Subject'),
    snippet: String(payload.snippet || ''),
    from,
    to,
    cc,
    createdAt: Number.isFinite(internal) ? new Date(internal).toISOString() : gmailHeader(headers, 'Date'),
    unread: labels.includes('UNREAD'),
    labelIds: labels,
  };
}

async function googleJson(
  url: string,
  authorization: string,
  timeoutMs = 30_000,
): Promise<{ ok: boolean; status: number; payload: Record<string, unknown> | null }> {
  const upstream = await forward(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: authorization,
    },
  }, timeoutMs);
  const payload = await upstream.json().catch(() => null);
  return {
    ok: upstream.ok,
    status: upstream.status,
    payload: payload && typeof payload === 'object' ? payload as Record<string, unknown> : null,
  };
}

function googleErrorMessage(payload: Record<string, unknown> | null, fallback: string): string {
  const nested = payload?.error;
  if (nested && typeof nested === 'object') {
    const message = (nested as { message?: string }).message
      || (nested as { error_description?: string }).error_description;
    if (message) return String(message);
  }
  if (typeof nested === 'string' && nested) return nested;
  if (typeof payload?.error_description === 'string' && payload.error_description) {
    return payload.error_description;
  }
  return fallback;
}

async function handleGmailOAuthToken(req: Request, body: ArrayBuffer | null): Promise<Response> {
  const { clientId, clientSecret, hostedDomain } = gmailOAuthApp();
  if (!clientId || !clientSecret) {
    return error(req, 503, 'Google mail sign-in is not configured. Ask a system admin to add the Google OAuth app.', 'gmail_unconfigured');
  }

  let payload: Record<string, unknown> = {};
  try {
    payload = body ? JSON.parse(new TextDecoder().decode(body)) : {};
  } catch {
    return error(req, 400, 'Body must be JSON.', 'bad_request');
  }

  const form = new URLSearchParams();
  form.set('client_id', clientId);
  form.set('client_secret', clientSecret);
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

  const tokenRes = await forward(GMAIL_TOKEN_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
  }, 30_000);
  const tokenPayload = await tokenRes.json().catch(() => null) as Record<string, unknown> | null;
  if (!tokenRes.ok) {
    return error(req, tokenRes.status >= 400 ? tokenRes.status : 400, googleErrorMessage(tokenPayload, 'Google sign-in failed.'), 'bad_request');
  }
  const accessToken = String(tokenPayload?.access_token || '').trim();
  if (!accessToken) {
    return error(req, 400, 'Google did not return an access token.', 'bad_request');
  }

  const info = await googleJson(GMAIL_USERINFO_URL, `Bearer ${accessToken}`);
  const email = String(info.payload?.email || '').trim().toLowerCase();
  const hd = String(info.payload?.hd || '').trim().toLowerCase();
  const allowed = gmailAllowedDomains(hostedDomain);
  const domainOk = allowed.includes(emailDomain(email)) || allowed.includes(hd);
  if (!info.ok || !email || !domainOk) {
    return error(
      req,
      403,
      `Sign in with your ${allowed[0] || 'company'} Google account, not a personal Gmail address.`,
      'forbidden',
    );
  }

  return json(req, 200, {
    access_token: accessToken,
    refresh_token: String(tokenPayload?.refresh_token || '').trim() || undefined,
    expires_in: Number(tokenPayload?.expires_in) || undefined,
    token_type: String(tokenPayload?.token_type || 'Bearer'),
    email,
    name: String(info.payload?.name || '').trim(),
    picture: String(info.payload?.picture || '').trim(),
    hd: hd || emailDomain(email),
  });
}

async function handleGmailMailbox(req: Request, body: ArrayBuffer | null): Promise<Response> {
  const authorization = upstreamAuthorization(req);
  if (!authorization) return error(req, 401, 'Connect Google mail first.', 'gmail_unauthenticated');
  if (req.method !== 'POST') return error(req, 405, 'Use POST.', 'method_not_allowed');

  let payload: Record<string, unknown> = {};
  try {
    payload = body ? JSON.parse(new TextDecoder().decode(body)) : {};
  } catch {
    return error(req, 400, 'Body must be JSON.', 'bad_request');
  }

  const folder = String(payload.folder || 'inbox').toLowerCase() === 'sent' ? 'SENT' : 'INBOX';
  const pageToken = String(payload.pageToken || '').trim();
  const params = new URLSearchParams({
    labelIds: folder,
    maxResults: '40',
  });
  if (pageToken) params.set('pageToken', pageToken);

  const list = await googleJson(`${GMAIL_API}/messages?${params.toString()}`, authorization);
  if (!list.ok) {
    const status = list.status === 401 ? 401 : 400;
    const code = list.status === 401 ? 'gmail_unauthenticated' : 'bad_request';
    return error(req, status, googleErrorMessage(list.payload, 'Could not load Gmail.'), code);
  }

  const refs = Array.isArray(list.payload?.messages) ? list.payload.messages as { id?: string }[] : [];
  const messages: ReturnType<typeof mapGmailListMessage>[] = [];
  const chunkSize = 8;
  for (let i = 0; i < refs.length; i += chunkSize) {
    const chunk = refs.slice(i, i + chunkSize);
    const rows = await Promise.all(chunk.map(async (row) => {
      const id = String(row?.id || '').trim();
      if (!id) return null;
      const metaParams = new URLSearchParams({ format: 'metadata' });
      metaParams.append('metadataHeaders', 'From');
      metaParams.append('metadataHeaders', 'To');
      metaParams.append('metadataHeaders', 'Cc');
      metaParams.append('metadataHeaders', 'Subject');
      metaParams.append('metadataHeaders', 'Date');
      const detail = await googleJson(`${GMAIL_API}/messages/${encodeURIComponent(id)}?${metaParams.toString()}`, authorization);
      if (!detail.ok || !detail.payload) return null;
      return mapGmailListMessage(detail.payload);
    }));
    for (const row of rows) {
      if (row?.id) messages.push(row);
    }
  }

  return json(req, 200, {
    messages,
    nextPageToken: String(list.payload?.nextPageToken || ''),
    resultSizeEstimate: Number(list.payload?.resultSizeEstimate) || messages.length,
  });
}

async function handleGmailMessage(req: Request, query: URLSearchParams): Promise<Response> {
  const authorization = upstreamAuthorization(req);
  if (!authorization) return error(req, 401, 'Connect Google mail first.', 'gmail_unauthenticated');
  const id = String(query.get('id') || '').trim();
  if (!id) return error(req, 400, 'Missing message id.', 'bad_request');

  const detail = await googleJson(`${GMAIL_API}/messages/${encodeURIComponent(id)}?format=full`, authorization, 45_000);
  if (!detail.ok || !detail.payload) {
    const status = detail.status === 401 ? 401 : 400;
    const code = detail.status === 401 ? 'gmail_unauthenticated' : 'bad_request';
    return error(req, status, googleErrorMessage(detail.payload, 'Could not open that email.'), code);
  }

  const mapped = mapGmailListMessage(detail.payload);
  const body = extractGmailText(detail.payload.payload as GmailPart | undefined);
  return json(req, 200, {
    ...mapped,
    body: body || mapped.snippet,
  });
}

async function handleRippling(req: Request, rest: string, search: string): Promise<Response> {
  if (req.method !== 'GET') return error(req, 405, 'Rippling access is read-only.', 'method_not_allowed');

  let authorization = upstreamAuthorization(req);
  let usingCompany = false;
  if (!authorization) {
    const stored = await loadCompanyRippling();
    if (stored.access_token) {
      authorization = `Bearer ${stored.access_token}`;
      usingCompany = true;
    }
  }
  if (!authorization) return error(req, 401, 'Connect Rippling first.', 'rippling_unauthenticated');

  const headers = {
    Accept: 'application/json',
    Authorization: authorization,
    'User-Agent': 'MyCanadaGold/1.0',
  };
  let upstream = await forward(`${RIPPLING_API_ORIGIN}${rest}${search}`, { method: 'GET', headers });
  if (upstream.status === 401 && usingCompany) {
    const refreshed = await refreshCompanyRipplingToken();
    if (refreshed) {
      upstream = await forward(`${RIPPLING_API_ORIGIN}${rest}${search}`, {
        method: 'GET',
        headers: { ...headers, Authorization: `Bearer ${refreshed}` },
      });
    }
  }
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
  'id, store_key, store_name, server_url, account_id, company_name, main_number, phone_numbers, extension_count, last_status, last_error, last_checked_at, created_at, updated_at, has_client_id, has_secret, has_jwt';

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
  phone_numbers?: unknown;
  extension_count: number;
  last_status: string;
  last_error: string;
  last_checked_at: string | null;
  access_token?: string;
  refresh_token?: string;
  token_expires_at?: string | null;
  live_calls?: unknown;
  live_calls_at?: string | null;
  has_client_id?: boolean;
  has_secret?: boolean;
  has_jwt?: boolean;
  created_at?: string;
  updated_at?: string;
};

type RcCachedToken = { token: string; refreshToken: string; expiresAt: number };
type RcTokens = { accessToken: string; refreshToken: string; expiresAt: number };

const RC_ACCOUNT_CORE =
  'id, store_key, store_name, client_id, client_secret, jwt, server_url, account_id, company_name, main_number, phone_numbers, extension_count, last_status, last_error, last_checked_at, has_client_id, has_secret, has_jwt, created_at, updated_at';
const RC_ACCOUNT_CACHE = 'access_token, refresh_token, token_expires_at, live_calls, live_calls_at';
// Limits from the RingCentral app console (Demonstration App), per app + user:
// Auth 5/60s, Heavy 10/60s, Medium 40/60s, Light 50/60s, penalty 60s.
// Measured groups: account presence, call-log, phone-number list and
// active-calls are HEAVY; extension presence, queue members, an extension's
// phone numbers and message-store are LIGHT; the extension directory is MEDIUM.
// All stores share one RingCentral account (and usually one user's JWT), so
// every budget below is tracked per account, not per store.
const RC_PENALTY_MS = 60_000;
const RC_PRESENCE_TTL_MS = 8_000; // per-extension presence is Light (50/min)
const RC_CALL_LOG_TTL_MS = 60_000; // account call-log is Heavy (10/min): one poll per account per minute
const RC_VOICEMAIL_TTL_MS = 45_000; // message-store is Light
const RC_HEAVY_BUDGET_PER_MINUTE = 6; // leave headroom for Settings checks and other isolates
const RC_RATE_LIMIT_MESSAGE =
  'RingCentral paused this phone line for a minute after too many requests. It will recover on its own.';
const RC_TOKEN_RETRY_MS = RC_PENALTY_MS;

const rcTokenCache = new Map<string, RcCachedToken>();
const rcTokenInflight = new Map<string, Promise<string>>();
const rcTokenBackoffUntil = new Map<string, number>();
const rcPresenceCache = new Map<string, { at: number; calls: unknown[] }>();
const rcPresenceInflight = new Map<string, Promise<unknown[]>>();
const rcCallLogScope = new Map<string, 'company' | 'extension'>();
const rcGroupBackoffUntil = new Map<string, number>();
const rcHeavyHits = new Map<string, number[]>();
const RC_NUMBERS_TTL_MS = 10 * 60 * 1000;
const rcNumberCache = new Map<string, { at: number; records: StorePhoneNumber[] }>();

/** Rate limits are per RingCentral user; every store row points at the same account. */
function rcScope(account: Pick<RingCentralAccount, 'account_id' | 'store_key'>): string {
  return String(account.account_id || account.store_key || '').trim() || 'ringcentral';
}

/** Reserve one Heavy request for this account; false when this minute's budget is spent. */
function rcTakeHeavy(scope: string): boolean {
  const now = Date.now();
  const hits = (rcHeavyHits.get(scope) || []).filter((at) => now - at < 60_000);
  if (hits.length >= RC_HEAVY_BUDGET_PER_MINUTE) {
    rcHeavyHits.set(scope, hits);
    return false;
  }
  hits.push(now);
  rcHeavyHits.set(scope, hits);
  return true;
}

function rcServerUrl(value: string): string {
  return value === RC_SANDBOX ? RC_SANDBOX : RC_PRODUCTION;
}

function storeKeyOf(name: string): string {
  return String(name || '').trim().toLowerCase();
}

function rcLast10(value: unknown): string {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}

type StorePhoneNumber = {
  phoneNumber: string;
  usageType: string;
  type: string;
  label: string;
  primary: boolean;
  extensionNumber: string;
  extensionName: string;
  siteName: string;
};

function parseStoredPhoneNumbers(value: unknown): StorePhoneNumber[] {
  const rows = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  const next: StorePhoneNumber[] = [];
  for (const item of rows) {
    if (!item) continue;
    if (typeof item === 'string') {
      const phoneNumber = String(item).trim();
      const key = rcLast10(phoneNumber);
      if (!phoneNumber || (key && seen.has(key))) continue;
      if (key) seen.add(key);
      next.push({
        phoneNumber,
        usageType: '',
        type: '',
        label: '',
        primary: false,
        extensionNumber: '',
        extensionName: '',
        siteName: '',
      });
      continue;
    }
    if (typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const extension = row.extension && typeof row.extension === 'object'
      ? (row.extension as Record<string, unknown>)
      : {};
    const site = row.site && typeof row.site === 'object' ? (row.site as Record<string, unknown>) : {};
    const phoneNumber = String(row.phoneNumber || '').trim();
    const key = rcLast10(phoneNumber);
    if (!phoneNumber || (key && seen.has(key))) continue;
    if (key) seen.add(key);
    next.push({
      phoneNumber,
      usageType: String(row.usageType || ''),
      type: String(row.type || ''),
      label: String(row.label || ''),
      primary: Boolean(row.primary),
      extensionNumber: String(row.extensionNumber || extension.extensionNumber || ''),
      extensionName: String(row.extensionName || extension.name || ''),
      siteName: String(row.siteName || site.name || ''),
    });
  }
  return next;
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
    phoneNumbers: parseStoredPhoneNumbers(row.phone_numbers),
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
  if (/request rate exceeded|cmn-301|too many requests|rate[- ]limit/i.test(message)) {
    return RC_RATE_LIMIT_MESSAGE;
  }
  if (/ReadCompanyCallLog/i.test(message)) {
    return 'This RingCentral login cannot read the whole company call log. Use a JWT for an admin user, or grant ReadCompanyCallLog on that user.';
  }
  return message || fallback;
}

/**
 * Call control on a party that is no longer Setup/Proceeding (answered
 * elsewhere, voicemail, caller hung up) or that RingCentral has already
 * forgotten. "Incorrect State [WrongState]" is the usual text.
 */
function isRingCentralWrongState(result: RcJsonResult): boolean {
  if (result.status === 404 || result.status === 409) return true;
  const raw = `${rcErrorMessage(result.payload, '')} ${JSON.stringify(result.payload ?? '')}`;
  return /WrongState|Incorrect State|CMN-102|Resource for parameter \[partyId\]|not found/i.test(raw);
}

function isRingCentralRateLimit(status: number, payload?: unknown, message = ''): boolean {
  if (status === 429) return true;
  const raw = `${message} ${rcErrorMessage(payload, '')}`;
  return /request rate exceeded|cmn-301|too many requests|rate[- ]limit/i.test(raw);
}

function isRcCacheSchemaError(err: unknown): boolean {
  const message = err && typeof err === 'object'
    ? String((err as { message?: string }).message || (err as { details?: string }).details || '')
    : String(err || '');
  const code = err && typeof err === 'object' ? String((err as { code?: string }).code || '') : '';
  return (
    code === '42703' ||
    code === 'PGRST204' ||
    (/schema cache|column/i.test(message) &&
      /access_token|refresh_token|token_expires_at|live_calls|phone_numbers/i.test(message))
  );
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
  if (!raw && Array.isArray(row.errors)) {
    // Call-control errors only carry the text inside `errors[]`.
    const first = row.errors.find((item) => item && typeof item === 'object') as
      | Record<string, unknown>
      | undefined;
    raw = String(first?.message || first?.errorCode || '');
  }
  return describeRingCentralError(raw, fallback);
}

type RcJsonResult = {
  ok: boolean;
  status: number;
  payload: unknown;
  rateGroup: string;
  remaining: number | null;
  retryAfterMs: number;
};

function rcHeader(response: Response, name: string): string {
  return response.headers.get(name) || response.headers.get(name.toLowerCase()) || '';
}

/** `scope` is rcScope(account) for API groups and the store key for the auth group. */
function rcGroupKey(scope: string, group: string): string {
  return `${scope}:${String(group || 'medium').trim().toLowerCase()}`;
}

function rcGroupBlocked(scope: string, group: string): boolean {
  return (rcGroupBackoffUntil.get(rcGroupKey(scope, group)) || 0) > Date.now();
}

function noteRcRateHeaders(scope: string, result: RcJsonResult): void {
  const group = (result.rateGroup || 'medium').toLowerCase();
  if (result.status === 429 || (result.remaining != null && result.remaining <= 0)) {
    rcGroupBackoffUntil.set(rcGroupKey(scope, group), Date.now() + (result.retryAfterMs || RC_PENALTY_MS));
  }
  if (group === 'heavy' && result.remaining != null && result.remaining <= 2 && result.status !== 429) {
    // Another isolate (or the Settings screen) is eating the same budget: back off early.
    rcGroupBackoffUntil.set(rcGroupKey(scope, group), Date.now() + 20_000);
  }
}

async function rcJson(url: string, init: RequestInit): Promise<RcJsonResult> {
  const upstream = await forward(url, init, 30_000);
  const payload = await upstream.json().catch(() => null);
  const retryAfter = Number(rcHeader(upstream, 'Retry-After'));
  const remainingRaw = rcHeader(upstream, 'X-Rate-Limit-Remaining');
  const remaining = remainingRaw === '' ? null : Number(remainingRaw);
  return {
    ok: upstream.ok,
    status: upstream.status,
    payload,
    rateGroup: rcHeader(upstream, 'X-Rate-Limit-Group'),
    remaining: Number.isFinite(remaining as number) ? remaining : null,
    retryAfterMs: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 0,
  };
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
  const full = await adminClient()
    .from('ringcentral_accounts')
    .select(`${RC_ACCOUNT_CORE}, ${RC_ACCOUNT_CACHE}`)
    .eq('store_key', storeKey)
    .maybeSingle();
  if (!full.error) return (full.data as RingCentralAccount) || null;
  if (!isRcCacheSchemaError(full.error)) return null;

  const withoutNumbers = RC_ACCOUNT_CORE.replace(', phone_numbers', '');
  const fallback = await adminClient()
    .from('ringcentral_accounts')
    .select(`${withoutNumbers}, ${RC_ACCOUNT_CACHE}`)
    .eq('store_key', storeKey)
    .maybeSingle();
  if (!fallback.error) return (fallback.data as RingCentralAccount) || null;

  const coreOnly = await adminClient()
    .from('ringcentral_accounts')
    .select(withoutNumbers)
    .eq('store_key', storeKey)
    .maybeSingle();
  if (coreOnly.error || !coreOnly.data) return null;
  return coreOnly.data as RingCentralAccount;
}

async function listRingCentralRows(): Promise<unknown[]> {
  let { data, error: queryError } = await adminClient()
    .from('ringcentral_accounts')
    .select(RC_PUBLIC_COLUMNS)
    .order('store_name');
  if (queryError && isRcCacheSchemaError(queryError)) {
    ({ data, error: queryError } = await adminClient()
      .from('ringcentral_accounts')
      .select(RC_PUBLIC_COLUMNS.replace(', phone_numbers', ''))
      .order('store_name'));
  }
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
      'id, store_key, store_name, client_id, client_secret, jwt, server_url, account_id, company_name, main_number, phone_numbers, extension_count, last_status, last_error, last_checked_at, has_client_id, has_secret, has_jwt, created_at, updated_at',
    )
    .maybeSingle();
  return (data as RingCentralAccount) || null;
}

function rememberRcToken(storeKey: string, tokens: RcTokens): RcCachedToken {
  const cached: RcCachedToken = {
    token: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: tokens.expiresAt,
  };
  rcTokenCache.set(storeKey, cached);
  return cached;
}

function tokenFromAccount(account: RingCentralAccount): RcCachedToken | null {
  const token = String(account.access_token || '').trim();
  if (!token) return null;
  const expiresAt = account.token_expires_at ? Date.parse(account.token_expires_at) : 0;
  return {
    token,
    refreshToken: String(account.refresh_token || '').trim(),
    expiresAt: Number.isFinite(expiresAt) ? expiresAt : 0,
  };
}

async function persistRingCentralCache(
  account: RingCentralAccount,
  patch: Record<string, unknown>,
): Promise<void> {
  try {
    const { error: writeError } = await adminClient()
      .from('ringcentral_accounts')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', account.id);
    if (writeError && !isRcCacheSchemaError(writeError)) {
      console.error('ringcentral cache persist failed', writeError.message);
    }
  } catch (err) {
    console.error('ringcentral cache persist failed', err instanceof Error ? err.message : err);
  }
}

async function persistRingCentralTokens(account: RingCentralAccount, tokens: RcTokens): Promise<void> {
  account.access_token = tokens.accessToken;
  account.refresh_token = tokens.refreshToken;
  account.token_expires_at = new Date(tokens.expiresAt).toISOString();
  await persistRingCentralCache(account, {
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
    token_expires_at: account.token_expires_at,
  });
}

async function rcOAuthToken(account: RingCentralAccount, body: URLSearchParams): Promise<RcTokens> {
  const clientId = String(account.client_id || '').trim();
  const clientSecret = String(account.client_secret || '').trim();
  const origin = rcServerUrl(account.server_url);
  const result = await rcJson(`${origin}/restapi/oauth/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
  });
  noteRcRateHeaders(account.store_key, { ...result, rateGroup: result.rateGroup || 'auth' });
  if (!result.ok) {
    const message = rcErrorMessage(result.payload, 'RingCentral rejected the JWT credentials.');
    if (isRingCentralRateLimit(result.status, result.payload, message)) {
      throw new Error(RC_RATE_LIMIT_MESSAGE);
    }
    throw new Error(message);
  }
  const row = (result.payload || {}) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  const accessToken = String(row.access_token || '').trim();
  if (!accessToken) throw new Error('RingCentral did not return an access token.');
  const expiresIn = Number(row.expires_in) || 3600;
  return {
    accessToken,
    refreshToken: String(row.refresh_token || '').trim(),
    expiresAt: Date.now() + Math.max(60, expiresIn) * 1000,
  };
}

async function mintRingCentralToken(account: RingCentralAccount, stored: RcCachedToken | null): Promise<string> {
  const jwt = String(account.jwt || '').trim();
  const clientId = String(account.client_id || '').trim();
  const clientSecret = String(account.client_secret || '').trim();
  if (!clientId || !clientSecret || !jwt) throw new Error('missing_credentials');

  const refreshToken = stored?.refreshToken || String(account.refresh_token || '').trim();
  if (refreshToken) {
    try {
      const refreshed = await rcOAuthToken(
        account,
        new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
        }),
      );
      if (!refreshed.refreshToken) refreshed.refreshToken = refreshToken;
      rememberRcToken(account.store_key, refreshed);
      await persistRingCentralTokens(account, refreshed);
      return refreshed.accessToken;
    } catch (err) {
      if (err instanceof Error && err.message === RC_RATE_LIMIT_MESSAGE) throw err;
      // Expired refresh tokens fall through to a JWT grant.
    }
  }

  const minted = await rcOAuthToken(
    account,
    new URLSearchParams({
      grant_type: RC_JWT_GRANT,
      assertion: jwt,
    }),
  );
  rememberRcToken(account.store_key, minted);
  await persistRingCentralTokens(account, minted);
  return minted.accessToken;
}

async function ringCentralAccessToken(account: RingCentralAccount): Promise<string> {
  const storeKey = account.store_key;
  const freshEnough = (row: RcCachedToken | null | undefined) =>
    Boolean(row?.token && row.expiresAt > Date.now() + 30_000);
  const usableStale = (row: RcCachedToken | null | undefined) =>
    Boolean(row?.token && row.expiresAt > Date.now() - 5 * 60_000);

  const memory = rcTokenCache.get(storeKey);
  if (freshEnough(memory)) return memory!.token;

  const inflight = rcTokenInflight.get(storeKey);
  if (inflight) return inflight;

  const pending = (async () => {
    const again = rcTokenCache.get(storeKey);
    if (freshEnough(again)) return again!.token;

    const stored = memory || tokenFromAccount(account);
    if (stored && freshEnough(stored)) {
      rcTokenCache.set(storeKey, stored);
      return stored.token;
    }

    const backoffUntil = rcTokenBackoffUntil.get(storeKey) || 0;
    if (backoffUntil > Date.now() || rcGroupBlocked(storeKey, 'auth')) {
      if (usableStale(stored) && stored) return stored.token;
      throw new Error(RC_RATE_LIMIT_MESSAGE);
    }

    try {
      return await mintRingCentralToken(account, stored);
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      if (isRingCentralRateLimit(0, null, message)) {
        rcTokenBackoffUntil.set(storeKey, Date.now() + RC_TOKEN_RETRY_MS);
        if (usableStale(stored) && stored) {
          rcTokenCache.set(storeKey, stored);
          return stored.token;
        }
      }
      throw err;
    }
  })();

  rcTokenInflight.set(storeKey, pending);
  try {
    return await pending;
  } finally {
    rcTokenInflight.delete(storeKey);
  }
}

type RingCentralNumber = {
  phoneNumber?: string;
  usageType?: string;
  type?: string;
  label?: string;
  primary?: boolean;
  extension?: { id?: string | number; extensionNumber?: string; name?: string };
  site?: { id?: string | number; name?: string };
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
    siteName: String(row.site?.name || ''),
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

function rememberCompanyNumbers(
  account: RingCentralAccount,
  records: ReturnType<typeof publicRingCentralNumber>[],
): void {
  rcNumberCache.set(rcScope(account), { at: Date.now(), records });
}

function exclusiveNumbersForStore(
  account: RingCentralAccount,
  records: ReturnType<typeof publicRingCentralNumber>[],
  siblings: { store_key: string; store_name: string }[],
): ReturnType<typeof publicRingCentralNumber>[] {
  const stores = [
    { store_key: account.store_key, store_name: account.store_name },
    ...siblings.filter((row) => row.store_key && row.store_key !== account.store_key),
  ];
  return records.filter((row) => {
    if (!row.phoneNumber) return false;
    const scored = stores
      .map((store) => ({
        store_key: store.store_key,
        score: rcNumberMatchScore(row, store.store_key, store.store_name),
      }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score);
    if (!scored.length || scored[0].store_key !== account.store_key) return false;
    return scored.length === 1 || scored[0].score > scored[1].score;
  });
}

async function loadRcStoreNumberRows(): Promise<
  { id: string; store_key: string; store_name: string; account_id: string; phone_numbers: unknown; main_number: string }[]
> {
  let { data, error } = await adminClient()
    .from('ringcentral_accounts')
    .select('id, store_key, store_name, account_id, phone_numbers, main_number');
  if (error && isRcCacheSchemaError(error)) {
    ({ data, error } = await adminClient()
      .from('ringcentral_accounts')
      .select('id, store_key, store_name, account_id, main_number'));
  }
  if (error) return [];
  return (data || []) as {
    id: string;
    store_key: string;
    store_name: string;
    account_id: string;
    phone_numbers: unknown;
    main_number: string;
  }[];
}

async function claimStoreNumbers(
  storeKey: string,
  numbers: ReturnType<typeof publicRingCentralNumber>[],
): Promise<void> {
  const claimed = new Set(numbers.map((row) => rcLast10(row.phoneNumber)).filter((row) => row.length >= 7));
  if (!claimed.size) return;
  const rows = await loadRcStoreNumberRows();
  for (const row of rows) {
    if (row.store_key === storeKey) continue;
    const current = parseStoredPhoneNumbers(row.phone_numbers);
    const next = current.filter((item) => !claimed.has(rcLast10(item.phoneNumber)));
    if (next.length === current.length && !claimed.has(rcLast10(row.main_number))) continue;
    const patch: Record<string, unknown> = {
      phone_numbers: next,
      updated_at: new Date().toISOString(),
    };
    if (claimed.has(rcLast10(row.main_number))) {
      patch.main_number = next[0]?.phoneNumber || '';
    }
    await adminClient().from('ringcentral_accounts').update(patch).eq('id', row.id);
    rcStoreExtensionCache.delete(row.store_key);
    rcPresenceCache.delete(row.store_key);
  }
}

async function persistStoreNumbers(
  account: RingCentralAccount,
  numbers: ReturnType<typeof publicRingCentralNumber>[],
  mainNumber = '',
): Promise<void> {
  account.phone_numbers = numbers;
  if (mainNumber) account.main_number = mainNumber;
  const patch: Record<string, unknown> = { phone_numbers: numbers };
  if (mainNumber) patch.main_number = mainNumber;
  await persistRingCentralCache(account, patch);
  await claimStoreNumbers(account.store_key, numbers);
}

async function companyPhoneRecords(
  account: RingCentralAccount,
  origin: string,
  headers: Record<string, string>,
): Promise<ReturnType<typeof publicRingCentralNumber>[]> {
  const scope = rcScope(account);
  const cached = rcNumberCache.get(scope);
  if (cached && Date.now() - cached.at < RC_NUMBERS_TTL_MS) return cached.records;
  if (rcGroupBlocked(scope, 'heavy') || !rcTakeHeavy(scope)) {
    return cached?.records || parseStoredPhoneNumbers(account.phone_numbers);
  }
  const result = await rcJson(`${origin}/restapi/v1.0/account/~/phone-number?perPage=200`, {
    method: 'GET',
    headers,
  });
  noteRcRateHeaders(scope, result);
  if (!result.ok) return cached?.records || parseStoredPhoneNumbers(account.phone_numbers);
  const payload = (result.payload || {}) as { records?: RingCentralNumber[] };
  const records = (Array.isArray(payload.records) ? payload.records : [])
    .map(publicRingCentralNumber)
    .filter((row) => row.phoneNumber);
  rememberCompanyNumbers(account, records);
  return records;
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
  const publicNumbers = numberRecords.map(publicRingCentralNumber).filter((row) => row.phoneNumber);
  rememberCompanyNumbers(
    { ...account, account_id: String(accountInfo.id || account.account_id || '') },
    publicNumbers,
  );
  const siblings = await loadRcStoreNumberRows();
  const savedNumbers = parseStoredPhoneNumbers(account.phone_numbers);
  const assigned = savedNumbers.length
    ? savedNumbers
    : exclusiveNumbersForStore(account, publicNumbers, siblings);
  const mainFromAssigned = [...assigned].sort((a, b) => {
    const rank = (row: ReturnType<typeof publicRingCentralNumber>) => {
      if (row.usageType === 'DirectNumber') return 0;
      if (row.primary) return 1;
      return 2;
    };
    return rank(a) - rank(b);
  })[0]?.phoneNumber || '';
  const sameCompany = siblings.some(
    (row) =>
      row.store_key !== account.store_key &&
      row.account_id &&
      String(accountInfo.id || account.account_id || '') &&
      row.account_id === String(accountInfo.id || account.account_id || ''),
  );
  const companyMain =
    numberRecords.find((row) => row.usageType === 'MainCompanyNumber')?.phoneNumber ||
    numberRecords.find((row) => row.primary)?.phoneNumber ||
    numberRecords[0]?.phoneNumber ||
    '';
  const mainFromList = mainFromAssigned || (sameCompany ? account.main_number : companyMain);

  const statusPatch: Partial<RingCentralAccount> = {
    last_status: 'connected',
    last_error: '',
    last_checked_at: new Date().toISOString(),
    account_id: String(accountInfo.id || account.account_id || ''),
    company_name: String(
      accountInfo.operator?.name || accountInfo.serviceInfo?.brand?.name || account.company_name || '',
    ),
    main_number: String(mainFromList || account.main_number || ''),
    extension_count:
      Number(extensionPayload.paging?.totalElements) || extensionRecords.length || 0,
  };
  if (assigned.length) statusPatch.phone_numbers = assigned;

  let updated = await markRingCentralStatus(account.id, statusPatch);
  if (!updated && assigned.length) {
    const withoutNumbers = { ...statusPatch };
    delete withoutNumbers.phone_numbers;
    updated = await markRingCentralStatus(account.id, withoutNumbers);
  }
  if (assigned.length) {
    account.phone_numbers = assigned;
    await claimStoreNumbers(account.store_key, assigned);
  }
  if (updated) {
    updated.phone_numbers = assigned.length ? assigned : updated.phone_numbers;
  }

  return {
    store: updated || { ...account, ...statusPatch, phone_numbers: assigned },
    numbers: publicNumbers,
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
    if (isRingCentralRateLimit(0, null, message)) {
      return error(req, 429, message, 'throttled');
    }
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
    phoneNumbers?: unknown;
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

  const assignedNumbers = Array.isArray(body.phoneNumbers) ? parseStoredPhoneNumbers(body.phoneNumbers) : null;

  const row: Record<string, unknown> = {
    store_key: storeKey,
    store_name: storeName,
    server_url: rcServerUrl(String(body.serverUrl || '')),
    updated_at: new Date().toISOString(),
    updated_by: staff.userId,
  };
  if (clientId) row.client_id = clientId;
  if (clientSecret) row.client_secret = clientSecret;
  if (jwt) row.jwt = jwt;
  if (assignedNumbers) {
    row.phone_numbers = assignedNumbers;
    if (assignedNumbers[0]?.phoneNumber) row.main_number = assignedNumbers[0].phoneNumber;
  }
  const clearSession = Boolean(clientId || clientSecret || jwt);
  if (clearSession) {
    rcTokenCache.delete(storeKey);
    rcTokenBackoffUntil.delete(storeKey);
    rcPresenceCache.delete(storeKey);
    rcVoicemailCache.delete(storeKey);
    rcOwnExtensionCache.delete(storeKey);
    rcCallerIdCache.delete(storeKey);
    rcStoreExtensionCache.delete(storeKey);
    row.access_token = '';
    row.refresh_token = '';
    row.token_expires_at = null;
    row.live_calls = [];
    row.live_calls_at = null;
  }

  const write = (payload: Record<string, unknown>) =>
    existingId
      ? adminClient().from('ringcentral_accounts').update(payload).eq('id', existingId)
      : adminClient().from('ringcentral_accounts').upsert(payload, { onConflict: 'store_key' });

  let writer = write(row);
  let { data, error: writeError } = await writer.select(RC_PUBLIC_COLUMNS).maybeSingle();
  if (writeError && isRcCacheSchemaError(writeError)) {
    const fallback = { ...row };
    delete fallback.access_token;
    delete fallback.refresh_token;
    delete fallback.token_expires_at;
    delete fallback.live_calls;
    delete fallback.live_calls_at;
    delete fallback.phone_numbers;
    ({ data, error: writeError } = await write(fallback).select(RC_PUBLIC_COLUMNS.replace(', phone_numbers', '')).maybeSingle());
  }
  if (writeError) {
    return error(req, 400, writeError.message || 'The RingCentral account could not be saved.', 'bad_request');
  }
  if (!data) return error(req, 400, 'The RingCentral account could not be saved.', 'bad_request');
  if (assignedNumbers) {
    rcStoreExtensionCache.delete(storeKey);
    rcPresenceCache.delete(storeKey);
    await claimStoreNumbers(storeKey, assignedNumbers);
  }
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
  if (storeKey) {
    rcTokenCache.delete(storeKey);
    rcTokenBackoffUntil.delete(storeKey);
    rcPresenceCache.delete(storeKey);
    rcVoicemailCache.delete(storeKey);
    rcOwnExtensionCache.delete(storeKey);
    rcCallerIdCache.delete(storeKey);
    rcStoreExtensionCache.delete(storeKey);
  }
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

function rcNumberHaystack(row: {
  label?: string;
  extensionName?: string;
  extensionNumber?: string;
  siteName?: string;
  usageType?: string;
}): string {
  return [row.label, row.extensionName, row.extensionNumber, row.siteName, row.usageType]
    .join(' ')
    .toLowerCase();
}

/** Province / brand words that appear on every Quebec DID label. */
const RC_GENERIC_LOCATION_TOKENS = new Set([
  'quebec',
  'ontario',
  'canada',
  'gold',
  'city',
  'store',
  'branch',
]);

function storeNameTokens(storeName: string, storeKey: string): string[] {
  const raw = `${storeName || ''} ${storeKey || ''}`.toLowerCase();
  return [...new Set(raw.split(/[^a-z0-9]+/).filter((token) => token.length >= 4))];
}

function rcNumberMatchScore(
  row: { label?: string; extensionName?: string; extensionNumber?: string; siteName?: string; usageType?: string },
  storeKey: string,
  storeName: string,
): number {
  const hay = rcNumberHaystack(row);
  if (!hay) return 0;
  const name = String(storeName || '').trim().toLowerCase();
  const key = String(storeKey || '').trim().toLowerCase();
  const tokenSet = new Set(hay.split(/[^a-z0-9]+/).filter(Boolean));
  const distinctive = storeNameTokens(storeName, storeKey).filter(
    (token) => !RC_GENERIC_LOCATION_TOKENS.has(token),
  );
  if (distinctive.length) {
    let score = 0;
    for (const token of distinctive) {
      if (tokenSet.has(token) || hay.includes(token)) score += token.length * 10;
    }
    return score;
  }
  if (name && (tokenSet.has(name) || hay.includes(name))) return name.length;
  if (key && key !== name && (tokenSet.has(key) || hay.includes(key))) return key.length;
  return 0;
}

/**
 * Store ↔ RingCentral extension mapping.
 *
 * Every store shares one company account. A store is its call queue (a
 * "Department" extension such as "Montreal" 661 that owns the local DID) plus
 * the user extensions that queue rings ("Montreal Canada Gold Or" 61,
 * "Montreal Line 2" 662). Live calls are read from those user extensions'
 * presence (Light group) and the call log is attributed by extension id, so a
 * toll-free → IVR → store call lands on the right store even though the dialled
 * number is shared.
 */
type RcDirectoryRow = { id: string; extensionNumber: string; name: string; type: string; status: string };

type StoreExtensions = {
  /** Queue + user extension ids: call-log rows for any of these belong to the store. */
  ids: Set<string>;
  /** User extensions whose presence is polled for live calls. */
  userIds: string[];
  info: Map<string, RcDirectoryRow>;
  /** The extension behind this store row's JWT (voicemail lives there). */
  ownId: string;
  source: 'assigned' | 'name' | 'own' | 'none';
};

const RC_DIRECTORY_TTL_MS = 10 * 60 * 1000;
const RC_STORE_EXTENSION_TYPES = new Set(['User', 'Department', 'Limited', 'SharedLinesGroup']);
const rcDirectoryCache = new Map<string, { at: number; rows: RcDirectoryRow[] }>();
const rcDirectoryInflight = new Map<string, Promise<RcDirectoryRow[]>>();
const rcOwnExtensionCache = new Map<string, { at: number; row: RcDirectoryRow | null }>();
const rcQueueMemberCache = new Map<string, { at: number; ids: string[] }>();
const rcExtensionNumberCache = new Map<string, { at: number; rows: StorePhoneNumber[] }>();
const rcStoreExtensionCache = new Map<string, { at: number; value: StoreExtensions }>();

function rcDirectoryRow(row: RingCentralExtension): RcDirectoryRow | null {
  const pub = publicRingCentralExtension(row);
  if (!pub.id) return null;
  return { id: pub.id, extensionNumber: pub.extensionNumber, name: pub.name, type: pub.type, status: pub.status };
}

/** Enabled extensions of the company (Medium group, cached 10 min per account). */
async function rcDirectory(
  account: RingCentralAccount,
  origin: string,
  headers: Record<string, string>,
): Promise<RcDirectoryRow[]> {
  const scope = rcScope(account);
  const cached = rcDirectoryCache.get(scope);
  if (cached && Date.now() - cached.at < RC_DIRECTORY_TTL_MS) return cached.rows;
  const inflight = rcDirectoryInflight.get(scope);
  if (inflight) return inflight;
  if (rcGroupBlocked(scope, 'medium')) return cached?.rows || [];

  const pending = (async () => {
    const rows: RcDirectoryRow[] = [];
    for (let page = 1; page <= 4; page++) {
      const result = await rcJson(
        `${origin}/restapi/v1.0/account/~/extension?perPage=500&page=${page}&status=Enabled`,
        { method: 'GET', headers },
      );
      noteRcRateHeaders(scope, result);
      if (!result.ok) break;
      const payload = (result.payload || {}) as {
        records?: RingCentralExtension[];
        navigation?: { nextPage?: unknown };
      };
      for (const item of Array.isArray(payload.records) ? payload.records : []) {
        const row = rcDirectoryRow(item);
        if (row) rows.push(row);
      }
      if (!payload.navigation?.nextPage) break;
    }
    if (rows.length) rcDirectoryCache.set(scope, { at: Date.now(), rows });
    return rows.length ? rows : cached?.rows || [];
  })();
  rcDirectoryInflight.set(scope, pending);
  try {
    return await pending;
  } finally {
    rcDirectoryInflight.delete(scope);
  }
}

/** The extension the store row's JWT belongs to (Light group, cached 10 min per store). */
async function rcOwnExtension(
  account: RingCentralAccount,
  origin: string,
  headers: Record<string, string>,
): Promise<RcDirectoryRow | null> {
  const key = account.store_key;
  const cached = rcOwnExtensionCache.get(key);
  if (cached && Date.now() - cached.at < RC_DIRECTORY_TTL_MS) return cached.row;
  if (rcGroupBlocked(rcScope(account), 'light')) return cached?.row || null;
  const result = await rcJson(`${origin}/restapi/v1.0/account/~/extension/~`, { method: 'GET', headers });
  noteRcRateHeaders(rcScope(account), result);
  if (!result.ok) return cached?.row || null;
  const row = rcDirectoryRow((result.payload || {}) as RingCentralExtension);
  rcOwnExtensionCache.set(key, { at: Date.now(), row });
  return row;
}

/** User extensions a call queue rings (Light group, cached 10 min). */
async function rcQueueMembers(
  account: RingCentralAccount,
  origin: string,
  headers: Record<string, string>,
  queueId: string,
): Promise<string[]> {
  const scope = rcScope(account);
  const key = `${scope}:${queueId}`;
  const cached = rcQueueMemberCache.get(key);
  if (cached && Date.now() - cached.at < RC_DIRECTORY_TTL_MS) return cached.ids;
  if (rcGroupBlocked(scope, 'light')) return cached?.ids || [];
  const result = await rcJson(`${origin}/restapi/v1.0/account/~/call-queues/${queueId}/members?perPage=100`, {
    method: 'GET',
    headers,
  });
  noteRcRateHeaders(scope, result);
  if (!result.ok) return cached?.ids || [];
  const payload = (result.payload || {}) as { records?: { id?: string | number }[] };
  const ids = (Array.isArray(payload.records) ? payload.records : [])
    .map((row) => String(row?.id || ''))
    .filter(Boolean);
  rcQueueMemberCache.set(key, { at: Date.now(), ids });
  return ids;
}

/** DIDs that belong to one extension (Light group, cached 10 min). Company-wide numbers are skipped. */
async function rcExtensionNumbers(
  account: RingCentralAccount,
  origin: string,
  headers: Record<string, string>,
  ext: RcDirectoryRow,
): Promise<StorePhoneNumber[]> {
  const scope = rcScope(account);
  const key = `${scope}:${ext.id}`;
  const cached = rcExtensionNumberCache.get(key);
  if (cached && Date.now() - cached.at < RC_DIRECTORY_TTL_MS) return cached.rows;
  if (rcGroupBlocked(scope, 'light')) return cached?.rows || [];
  const result = await rcJson(`${origin}/restapi/v1.0/account/~/extension/${ext.id}/phone-number?perPage=100`, {
    method: 'GET',
    headers,
  });
  noteRcRateHeaders(scope, result);
  if (!result.ok) return cached?.rows || [];
  const payload = (result.payload || {}) as { records?: RingCentralNumber[] };
  const rows: StorePhoneNumber[] = [];
  for (const raw of Array.isArray(payload.records) ? payload.records : []) {
    const phoneNumber = String(raw?.phoneNumber || '').trim();
    if (!phoneNumber) continue;
    if (String(raw.usageType || '') === 'MainCompanyNumber') continue;
    const ownerId = String(raw.extension?.id || '');
    if (ownerId && ownerId !== ext.id) continue;
    rows.push({
      phoneNumber,
      usageType: String(raw.usageType || ''),
      type: String(raw.type || ''),
      label: String(raw.label || ''),
      primary: Boolean(raw.primary),
      extensionNumber: ext.extensionNumber,
      extensionName: ext.name,
      siteName: String(raw.site?.name || ''),
    });
  }
  rcExtensionNumberCache.set(key, { at: Date.now(), rows });
  return rows;
}

function rcNameTokens(value: unknown): string[] {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** Brand / role words that appear on every extension and never identify a store. */
const RC_BRAND_TOKENS = new Set([
  'canada',
  'gold',
  'or',
  'store',
  'boutique',
  'magasin',
  'inc',
  'the',
  'line',
  'user',
  'queue',
  'team',
  'cx',
  'main',
  'company',
]);

function storeDistinctiveTokens(storeName: string, storeKey: string): string[] {
  const tokens = rcNameTokens(`${storeName || ''} ${storeKey || ''}`).filter(
    (token) => token.length >= 2 && !RC_BRAND_TOKENS.has(token),
  );
  return [...new Set(tokens)];
}

/** "Quebec" matches "Quebec City Canada Or"; "Calgary NW" matches "Calgary NW" but not "Calgary SW". */
function extensionMatchesStore(row: RcDirectoryRow, tokens: string[]): boolean {
  if (!tokens.length || !RC_STORE_EXTENSION_TYPES.has(row.type)) return false;
  const hay = new Set(rcNameTokens(row.name));
  return tokens.every((token) => hay.has(token));
}

/**
 * Which extensions are this store, in priority order:
 *   1. the extensions behind numbers assigned in Settings → RingCentral
 *   2. enabled queues / users whose name carries the store's name
 *   3. the extension the store's own JWT belongs to
 * Call queues are expanded to their members. Cached 10 min per store.
 */
async function resolveStoreExtensions(
  account: RingCentralAccount,
  origin: string,
  headers: Record<string, string>,
): Promise<StoreExtensions> {
  const cached = rcStoreExtensionCache.get(account.store_key);
  if (cached && Date.now() - cached.at < RC_DIRECTORY_TTL_MS && cached.value.source !== 'none') {
    return cached.value;
  }

  const [directory, own] = await Promise.all([
    rcDirectory(account, origin, headers),
    rcOwnExtension(account, origin, headers),
  ]);
  const byId = new Map(directory.map((row) => [row.id, row]));
  const byNumber = new Map(directory.filter((row) => row.extensionNumber).map((row) => [row.extensionNumber, row]));

  const picked = new Map<string, RcDirectoryRow>();
  let source: StoreExtensions['source'] = 'none';

  const assigned = parseStoredPhoneNumbers(account.phone_numbers);
  for (const row of assigned) {
    const ext = row.extensionNumber ? byNumber.get(String(row.extensionNumber).trim()) : undefined;
    if (ext) picked.set(ext.id, ext);
  }
  if (picked.size) source = 'assigned';

  if (!picked.size) {
    const tokens = storeDistinctiveTokens(account.store_name, account.store_key);
    for (const row of directory) {
      if (extensionMatchesStore(row, tokens)) picked.set(row.id, row);
    }
    if (picked.size) source = 'name';
  }

  if (!picked.size && own) {
    picked.set(own.id, own);
    source = 'own';
  }

  const ids = new Set<string>();
  const userIds: string[] = [];
  const info = new Map<string, RcDirectoryRow>();
  const addUser = (id: string) => {
    if (!id) return;
    ids.add(id);
    if (!userIds.includes(id)) userIds.push(id);
    const meta = byId.get(id);
    if (meta) info.set(id, meta);
  };
  for (const row of picked.values()) {
    ids.add(row.id);
    info.set(row.id, row);
    if (row.type === 'Department') {
      for (const id of await rcQueueMembers(account, origin, headers, row.id)) addUser(id);
    } else {
      addUser(row.id);
    }
  }
  if (!userIds.length && own) {
    addUser(own.id);
    info.set(own.id, own);
  }

  const value: StoreExtensions = {
    ids,
    userIds: userIds.slice(0, 6),
    info,
    ownId: own?.id || '',
    source,
  };
  rcStoreExtensionCache.set(account.store_key, { at: Date.now(), value });

  if (!assigned.length && (source === 'name' || source === 'assigned')) {
    void persistStoreExtensionNumbers(account, origin, headers, picked).catch((err) => {
      console.error('ringcentral store numbers', err instanceof Error ? err.message : err);
    });
  }
  return value;
}

/** Save the DIDs behind a store's extensions so Settings, RingOut and the app show them. */
async function persistStoreExtensionNumbers(
  account: RingCentralAccount,
  origin: string,
  headers: Record<string, string>,
  picked: Map<string, RcDirectoryRow>,
): Promise<void> {
  const ordered = [...picked.values()].sort((a, b) => {
    const rank = (row: RcDirectoryRow) => (row.type === 'Department' ? 0 : 1);
    return rank(a) - rank(b);
  });
  const seen = new Set<string>();
  const numbers: StorePhoneNumber[] = [];
  for (const ext of ordered.slice(0, 6)) {
    for (const row of await rcExtensionNumbers(account, origin, headers, ext)) {
      const key = rcLast10(row.phoneNumber);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      numbers.push(row);
    }
  }
  if (!numbers.length) return;
  await persistStoreNumbers(account, numbers, numbers[0].phoneNumber);
}

/** Only rows for one of the store's extensions, one row per call (best outcome wins). */
function callLogForStore(
  account: RingCentralAccount,
  rows: RcCallLogRow[],
  ext: StoreExtensions,
  logScope: 'company' | 'extension',
): RcCallLogRow[] {
  let mine: RcCallLogRow[];
  if (logScope === 'extension') {
    mine = !ext.ownId || ext.ids.has(ext.ownId) ? rows : [];
  } else if (rows.some((row) => row.extensionId)) {
    mine = rows.filter((row) => row.extensionId && ext.ids.has(row.extensionId));
  } else {
    mine = rows;
  }
  const bySession = new Map<string, RcCallLogRow>();
  for (const row of mine) {
    const key = row.sessionId || row.id;
    const current = bySession.get(key);
    if (!current || rcOutcomeRank(row.result, row.duration) > rcOutcomeRank(current.result, current.duration)) {
      bySession.set(key, row);
    }
  }
  return [...bySession.values()]
    .map((row) => ({ ...row, storeKey: account.store_key, storeName: account.store_name }))
    .sort((a, b) => (Date.parse(b.startTime) || 0) - (Date.parse(a.startTime) || 0));
}

function rcOutcomeRank(result: string, duration: number): number {
  const key = String(result || '').toLowerCase();
  if (/voicemail/.test(key)) return 2;
  if (/missed|no answer|not answered|abandoned|rejected|declined|busy|blocked|failed/.test(key)) return 1;
  if (/accepted|connected|answered|received|forwarded/.test(key)) return 3;
  return (Number(duration) || 0) > 0 ? 3 : 1;
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
        fromName: from.name || String(call.fromName || ''),
        to: to.phoneNumber,
        toName: to.name || String(call.toName || ''),
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

type RcCallLogRow = {
  id: string;
  storeKey: string;
  storeName: string;
  direction: string;
  result: string;
  duration: number;
  startTime: string;
  from: string;
  fromName: string;
  to: string;
  toName: string;
  /** Extension this leg belongs to (account call log only). */
  extensionId: string;
  /** Shared by every leg of one call: the queue's and each member's. */
  sessionId: string;
};

function mapCallLog(account: RingCentralAccount, payload: unknown): RcCallLogRow[] {
  const root = (payload || {}) as { records?: unknown[] };
  const records = Array.isArray(root.records) ? root.records : [];
  const rows: RcCallLogRow[] = [];
  for (const item of records) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const id = String(row.id || '');
    if (!id) continue;
    const from = rcParty(row.from);
    const to = rcParty(row.to);
    const extension = (row.extension || {}) as Record<string, unknown>;
    rows.push({
      id,
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
      extensionId: String(extension.id || ''),
      sessionId: String(row.sessionId || row.telephonySessionId || ''),
    });
  }
  return rows;
}

function isCompanyCallLogForbidden(result: RcJsonResult): boolean {
  if (result.ok) return false;
  return /ReadCompanyCallLog/i.test(rcErrorMessage(result.payload, ''));
}

type RcCallLogSnapshot = { at: number; scope: 'company' | 'extension'; rows: RcCallLogRow[]; error: string };
const rcCallLogCache = new Map<string, RcCallLogSnapshot>();
const rcCallLogInflight = new Map<string, Promise<RcCallLogSnapshot>>();

/**
 * One call-log GET, preferring the company log and falling back to the JWT
 * user's own log when the app lacks ReadCompanyCallLog. Remembers which one
 * worked for this account so later requests skip the failed attempt.
 */
async function rcCallLogRequest(
  scope: string,
  origin: string,
  headers: Record<string, string>,
  query: string,
): Promise<{ result: RcJsonResult; logScope: 'company' | 'extension' }> {
  const preferExtension = rcCallLogScope.get(scope) === 'extension';
  let logScope: 'company' | 'extension' = preferExtension ? 'extension' : 'company';
  let result: RcJsonResult;
  if (!preferExtension) {
    result = await rcJson(`${origin}/restapi/v1.0/account/~/call-log?${query}`, { method: 'GET', headers });
    noteRcRateHeaders(scope, result);
    if (!result.ok && isCompanyCallLogForbidden(result) && rcTakeHeavy(scope)) {
      rcCallLogScope.set(scope, 'extension');
      logScope = 'extension';
      result = await rcJson(`${origin}/restapi/v1.0/account/~/extension/~/call-log?${query}`, {
        method: 'GET',
        headers,
      });
      noteRcRateHeaders(scope, result);
    }
  } else {
    result = await rcJson(`${origin}/restapi/v1.0/account/~/extension/~/call-log?${query}`, {
      method: 'GET',
      headers,
    });
    noteRcRateHeaders(scope, result);
  }
  if (result.ok && logScope === 'company') rcCallLogScope.set(scope, 'company');
  return { result, logScope };
}

const RC_HISTORY_MAX_DAYS = 92; // RingCentral keeps ~90 days of call log online
const RC_HISTORY_PAGES = 8; // 8 × 250 rows per window
const RC_HISTORY_TTL_MS = 5 * 60_000; // window that still includes now
const RC_HISTORY_CLOSED_TTL_MS = 60 * 60_000; // window entirely in the past
const rcHistoryCache = new Map<string, RcCallLogSnapshot>();
const rcHistoryInflight = new Map<string, Promise<RcCallLogSnapshot>>();

type RcHistoryWindow = { from: Date; to: Date; closed: boolean };

/** Validate a client-supplied [dateFrom, dateTo] window; `null` when unusable. */
function rcHistoryWindow(dateFrom: unknown, dateTo: unknown): RcHistoryWindow | null {
  const from = new Date(String(dateFrom || ''));
  const to = new Date(String(dateTo || ''));
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime())) return null;
  if (to <= from) return null;
  const now = Date.now();
  if (from.getTime() > now) return null;
  if (to.getTime() - from.getTime() > RC_HISTORY_MAX_DAYS * 24 * 60 * 60 * 1000) return null;
  const capped = new Date(Math.min(to.getTime(), now + 60_000));
  return { from, to: capped, closed: to.getTime() < now };
}

/**
 * Call log for an arbitrary window (Heavy, paged). Shared by every store on
 * the same account like `accountCallLog`; cached for longer when the window
 * is entirely in the past because it can no longer change.
 */
async function accountCallLogWindow(
  account: RingCentralAccount,
  origin: string,
  headers: Record<string, string>,
  window: RcHistoryWindow,
): Promise<RcCallLogSnapshot> {
  const scope = rcScope(account);
  const preferExtension = rcCallLogScope.get(scope) === 'extension';
  const base = preferExtension ? `${scope}:${account.store_key}` : scope;
  const cacheKey = `${base}|${window.from.toISOString()}|${window.to.toISOString()}`;
  const ttl = window.closed ? RC_HISTORY_CLOSED_TTL_MS : RC_HISTORY_TTL_MS;
  const cached = rcHistoryCache.get(cacheKey);
  if (cached && Date.now() - cached.at < ttl) return cached;
  const inflight = rcHistoryInflight.get(cacheKey);
  if (inflight) return inflight;

  const stale = (message: string): RcCallLogSnapshot =>
    cached ? { ...cached, error: cached.rows.length ? '' : message } : { at: 0, scope: 'company', rows: [], error: message };

  if (rcGroupBlocked(scope, 'heavy') || !rcTakeHeavy(scope)) return stale(RC_RATE_LIMIT_MESSAGE);

  const pending = (async (): Promise<RcCallLogSnapshot> => {
    const rows: RcCallLogRow[] = [];
    let logScope: 'company' | 'extension' = preferExtension ? 'extension' : 'company';
    let message = '';
    for (let page = 1; page <= RC_HISTORY_PAGES; page++) {
      if (page > 1 && !rcTakeHeavy(scope)) {
        message = RC_RATE_LIMIT_MESSAGE;
        break;
      }
      const query =
        `view=Simple&type=Voice&perPage=250&page=${page}` +
        `&dateFrom=${encodeURIComponent(window.from.toISOString())}` +
        `&dateTo=${encodeURIComponent(window.to.toISOString())}`;
      const { result, logScope: usedScope } = await rcCallLogRequest(scope, origin, headers, query);
      logScope = usedScope;
      if (!result.ok) {
        message = isRingCentralRateLimit(result.status, result.payload)
          ? RC_RATE_LIMIT_MESSAGE
          : rcErrorMessage(result.payload, 'Could not load the call log.');
        break;
      }
      rows.push(...mapCallLog(account, result.payload));
      const nav = (result.payload || {}) as { navigation?: { nextPage?: unknown } };
      if (!nav.navigation?.nextPage) break;
    }
    if (!rows.length && message) return stale(message);
    const snapshot: RcCallLogSnapshot = { at: Date.now(), scope: logScope, rows, error: rows.length ? '' : message };
    rcHistoryCache.set(cacheKey, snapshot);
    if (rcHistoryCache.size > 64) {
      const oldest = [...rcHistoryCache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (oldest) rcHistoryCache.delete(oldest[0]);
    }
    return snapshot;
  })();
  rcHistoryInflight.set(cacheKey, pending);
  try {
    return await pending;
  } finally {
    rcHistoryInflight.delete(cacheKey);
  }
}

const rcVoicemailWindowCache = new Map<string, { at: number; rows: ReturnType<typeof mapVoicemails>; error: string }>();

/** Voicemail for the JWT's extension inside a window (Light group). */
async function storeVoicemailsWindow(
  account: RingCentralAccount,
  origin: string,
  headers: Record<string, string>,
  window: RcHistoryWindow,
): Promise<{ rows: ReturnType<typeof mapVoicemails>; error: string }> {
  const key = `${account.store_key}|${window.from.toISOString()}|${window.to.toISOString()}`;
  const ttl = window.closed ? RC_HISTORY_CLOSED_TTL_MS : RC_HISTORY_TTL_MS;
  const cached = rcVoicemailWindowCache.get(key);
  if (cached && Date.now() - cached.at < ttl) return cached;
  const scope = rcScope(account);
  if (rcGroupBlocked(scope, 'light')) return cached || { rows: [], error: RC_RATE_LIMIT_MESSAGE };
  const query =
    `messageType=VoiceMail&perPage=250` +
    `&dateFrom=${encodeURIComponent(window.from.toISOString())}` +
    `&dateTo=${encodeURIComponent(window.to.toISOString())}`;
  const result = await rcJson(`${origin}/restapi/v1.0/account/~/extension/~/message-store?${query}`, {
    method: 'GET',
    headers,
  });
  noteRcRateHeaders(scope, result);
  if (!result.ok) {
    const message = isRingCentralRateLimit(result.status, result.payload)
      ? RC_RATE_LIMIT_MESSAGE
      : rcErrorMessage(result.payload, 'Could not load voicemail.');
    return cached ? { ...cached, error: cached.rows.length ? '' : message } : { rows: [], error: message };
  }
  const next = { at: Date.now(), rows: mapVoicemails(account, result.payload), error: '' };
  rcVoicemailWindowCache.set(key, next);
  if (rcVoicemailWindowCache.size > 64) {
    const oldest = [...rcVoicemailWindowCache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) rcVoicemailWindowCache.delete(oldest[0]);
  }
  return next;
}

/**
 * The company call log (Heavy, 10/min) is fetched once per account per minute
 * and shared by every store; each store then keeps its own extensions' rows.
 * When the JWT may not read the company log, the user's own log is used and
 * cached per store instead.
 */
async function accountCallLog(
  account: RingCentralAccount,
  origin: string,
  headers: Record<string, string>,
): Promise<RcCallLogSnapshot> {
  const scope = rcScope(account);
  const preferExtension = rcCallLogScope.get(scope) === 'extension';
  const cacheKey = preferExtension ? `${scope}:${account.store_key}` : scope;
  const cached = rcCallLogCache.get(cacheKey);
  if (cached && Date.now() - cached.at < RC_CALL_LOG_TTL_MS) return cached;
  const inflight = rcCallLogInflight.get(cacheKey);
  if (inflight) return inflight;

  const stale = (message: string): RcCallLogSnapshot =>
    cached ? { ...cached, error: cached.rows.length ? '' : message } : { at: 0, scope: 'company', rows: [], error: message };

  if (rcGroupBlocked(scope, 'heavy') || !rcTakeHeavy(scope)) return stale(RC_RATE_LIMIT_MESSAGE);

  const pending = (async (): Promise<RcCallLogSnapshot> => {
    const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const query = `view=Simple&type=Voice&perPage=250&dateFrom=${encodeURIComponent(since)}`;
    const { result, logScope } = await rcCallLogRequest(scope, origin, headers, query);
    if (!result.ok) {
      const message = isRingCentralRateLimit(result.status, result.payload)
        ? RC_RATE_LIMIT_MESSAGE
        : rcErrorMessage(result.payload, 'Could not load the call log.');
      return stale(message);
    }
    const snapshot: RcCallLogSnapshot = {
      at: Date.now(),
      scope: logScope,
      rows: mapCallLog(account, result.payload),
      error: '',
    };
    rcCallLogCache.set(logScope === 'extension' ? `${scope}:${account.store_key}` : scope, snapshot);
    return snapshot;
  })();
  rcCallLogInflight.set(cacheKey, pending);
  try {
    return await pending;
  } finally {
    rcCallLogInflight.delete(cacheKey);
  }
}

const rcVoicemailCache = new Map<string, { at: number; rows: ReturnType<typeof mapVoicemails>; error: string }>();

/** Voicemail of the extension behind this store's JWT (Light group, cached per store). */
async function storeVoicemails(
  account: RingCentralAccount,
  origin: string,
  headers: Record<string, string>,
): Promise<{ rows: ReturnType<typeof mapVoicemails>; error: string }> {
  const key = account.store_key;
  const cached = rcVoicemailCache.get(key);
  if (cached && Date.now() - cached.at < RC_VOICEMAIL_TTL_MS) return cached;
  const scope = rcScope(account);
  if (rcGroupBlocked(scope, 'light')) return cached || { rows: [], error: RC_RATE_LIMIT_MESSAGE };
  const result = await rcJson(
    `${origin}/restapi/v1.0/account/~/extension/~/message-store?messageType=VoiceMail&perPage=50`,
    { method: 'GET', headers },
  );
  noteRcRateHeaders(scope, result);
  if (!result.ok) {
    const message = isRingCentralRateLimit(result.status, result.payload)
      ? RC_RATE_LIMIT_MESSAGE
      : rcErrorMessage(result.payload, 'Could not load voicemail.');
    return cached ? { ...cached, error: cached.rows.length ? '' : message } : { rows: [], error: message };
  }
  const next = { at: Date.now(), rows: mapVoicemails(account, result.payload), error: '' };
  rcVoicemailCache.set(key, next);
  return next;
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
    const rateLimited = isRingCentralRateLimit(0, null, message);
    if (!rateLimited) rcTokenCache.delete(storeKey);
    if (!rateLimited) {
      await markRingCentralStatus(account.id, {
        last_status: 'error',
        last_error: message.slice(0, 300),
        last_checked_at: new Date().toISOString(),
      });
    }
    return {
      response: error(req, rateLimited ? 429 : 400, message, rateLimited ? 'throttled' : 'ringcentral_unconfigured'),
    };
  }
}

function cachedLiveCalls(account: RingCentralAccount): { at: number; calls: LivePhoneCall[] } | null {
  const memory = rcPresenceCache.get(account.store_key) as { at: number; calls: LivePhoneCall[] } | undefined;
  if (memory) return memory;
  const storedAt = account.live_calls_at ? Date.parse(account.live_calls_at) : 0;
  if (!Number.isFinite(storedAt) || storedAt <= 0) return null;
  const records = Array.isArray(account.live_calls) ? account.live_calls : [];
  const calls = records
    .map((row) => (row && typeof row === 'object' ? (row as LivePhoneCall) : null))
    .filter((row): row is LivePhoneCall => Boolean(row?.id && row.storeKey));
  return { at: storedAt, calls };
}

function rememberLiveCalls(account: RingCentralAccount, calls: LivePhoneCall[]): void {
  const at = Date.now();
  rcPresenceCache.set(account.store_key, { at, calls });
  account.live_calls = calls;
  account.live_calls_at = new Date(at).toISOString();
}

const rcExtensionPresenceCache = new Map<string, { at: number; calls: LivePhoneCall[] }>();
const rcExtensionPresenceInflight = new Map<string, Promise<LivePhoneCall[]>>();

/**
 * Live calls on one user extension (Light group, 50/min). Cached per account +
 * extension so two stores sharing a phone do not poll it twice.
 */
async function extensionLiveCalls(
  account: RingCentralAccount,
  origin: string,
  headers: Record<string, string>,
  ext: RcDirectoryRow,
): Promise<LivePhoneCall[]> {
  const scope = rcScope(account);
  const key = `${scope}:${ext.id}`;
  const cached = rcExtensionPresenceCache.get(key);
  if (cached && Date.now() - cached.at < RC_PRESENCE_TTL_MS) return cached.calls;
  const inflight = rcExtensionPresenceInflight.get(key);
  if (inflight) return inflight;
  if (rcGroupBlocked(scope, 'light')) {
    if (cached) return cached.calls;
    throw new Error(RC_RATE_LIMIT_MESSAGE);
  }

  const pending = (async () => {
    const result = await rcJson(
      `${origin}/restapi/v1.0/account/~/extension/${ext.id}/presence?detailedTelephonyState=true`,
      { method: 'GET', headers },
    );
    noteRcRateHeaders(scope, result);
    if (isRingCentralRateLimit(result.status, result.payload)) {
      if (cached) return cached.calls;
      throw new Error(RC_RATE_LIMIT_MESSAGE);
    }
    if (!result.ok) return cached?.calls || [];
    const calls = mapPresenceCalls(account, result.payload).map((call) => ({
      ...call,
      extensionNumber: call.extensionNumber || ext.extensionNumber,
      extensionName: call.extensionName || ext.name,
    }));
    rcExtensionPresenceCache.set(key, { at: Date.now(), calls });
    return calls;
  })();
  rcExtensionPresenceInflight.set(key, pending);
  try {
    return await pending;
  } finally {
    rcExtensionPresenceInflight.delete(key);
  }
}

// ---------------------------------------------------------------------------
// Call-session verification.
//
// Extension presence (`activeCalls`) is a cache on RingCentral's side and is
// known to keep a "Ringing" leg around after the caller hung up or someone
// else picked up, sometimes for minutes. Presence is therefore only used to
// discover candidate sessions; every candidate is confirmed against the Call
// Control API (Light group) before it is reported, and sessions that are over
// are remembered so they can never come back as a phantom call.
// ---------------------------------------------------------------------------

type RcPartySnapshot = {
  partyId: string;
  status: string;
  reason: string;
  direction: string;
  /** The extension this party belongs to (callee for inbound, caller for outbound). */
  extensionId: string;
  from: { phoneNumber: string; name: string };
  to: { phoneNumber: string; name: string };
};
type RcSessionSnapshot = { at: number; gone: boolean; parties: RcPartySnapshot[] };

const RC_SESSION_TTL_MS = 4_000;
const RC_DEAD_SESSION_MS = 15 * 60_000;
const rcSessionCache = new Map<string, RcSessionSnapshot>();
const rcSessionInflight = new Map<string, Promise<RcSessionSnapshot | null>>();
const rcDeadSessions = new Map<string, number>();

function rcMarkSessionDead(sessionId: string): void {
  if (!sessionId) return;
  rcDeadSessions.set(sessionId, Date.now());
  rcSessionCache.delete(sessionId);
  if (rcDeadSessions.size > 500) {
    const cutoff = Date.now() - RC_DEAD_SESSION_MS;
    for (const [id, at] of rcDeadSessions.entries()) if (at < cutoff) rcDeadSessions.delete(id);
  }
}

function rcSessionIsDead(sessionId: string): boolean {
  const at = rcDeadSessions.get(sessionId);
  return Boolean(at) && Date.now() - (at as number) < RC_DEAD_SESSION_MS;
}

/** Party states in which the leg is still on the phone (ringing, talking, held, parked). */
function rcPartyIsLive(status: string): boolean {
  return /^(Setup|Proceeding|Answered|Hold|Parked)$/i.test(status);
}

function rcPartyIsRinging(status: string): boolean {
  return /^(Setup|Proceeding)$/i.test(status);
}

/** Call Control party status → the presence vocabulary the app already speaks. */
function rcPresenceStatusFor(status: string): string {
  if (/^(Setup|Proceeding)$/i.test(status)) return 'Ringing';
  if (/^Answered$/i.test(status)) return 'CallConnected';
  if (/^Hold$/i.test(status)) return 'OnHold';
  if (/^Parked$/i.test(status)) return 'ParkedCall';
  return 'NoCall';
}

function rcPartySnapshot(raw: unknown): RcPartySnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const partyId = String(row.id || '');
  if (!partyId) return null;
  const status = (row.status || {}) as Record<string, unknown>;
  const from = (row.from || {}) as Record<string, unknown>;
  const to = (row.to || {}) as Record<string, unknown>;
  const owner = (row.owner || {}) as Record<string, unknown>;
  const direction = String(row.direction || '');
  const extensionId =
    String((direction === 'Outbound' ? from.extensionId : to.extensionId) || '') ||
    String(to.extensionId || from.extensionId || owner.extensionId || '');
  return {
    partyId,
    status: String(status.code || ''),
    reason: String(status.reason || ''),
    direction,
    extensionId,
    from: { phoneNumber: String(from.phoneNumber || ''), name: String(from.name || '') },
    to: { phoneNumber: String(to.phoneNumber || ''), name: String(to.name || '') },
  };
}

/**
 * Current state of one telephony session (Light group, cached 4 s per account
 * so stores sharing a phone verify it once). `null` means "could not check";
 * callers keep the presence row in that case.
 */
async function rcTelephonySession(
  account: RingCentralAccount,
  origin: string,
  headers: Record<string, string>,
  sessionId: string,
): Promise<RcSessionSnapshot | null> {
  const id = rcSafeId(sessionId);
  if (!id) return null;
  if (rcSessionIsDead(id)) return { at: Date.now(), gone: true, parties: [] };
  const cached = rcSessionCache.get(id);
  if (cached && Date.now() - cached.at < RC_SESSION_TTL_MS) return cached;
  const inflight = rcSessionInflight.get(id);
  if (inflight) return inflight;
  const scope = rcScope(account);
  if (rcGroupBlocked(scope, 'light')) return cached || null;

  const pending = (async (): Promise<RcSessionSnapshot | null> => {
    const result = await rcJson(`${origin}/restapi/v1.0/account/~/telephony/sessions/${id}`, {
      method: 'GET',
      headers,
    });
    noteRcRateHeaders(scope, result);
    if (result.status === 404) {
      rcMarkSessionDead(id);
      return { at: Date.now(), gone: true, parties: [] };
    }
    if (!result.ok) return cached || null;
    const payload = (result.payload || {}) as { parties?: unknown[] };
    const parties = (Array.isArray(payload.parties) ? payload.parties : [])
      .map(rcPartySnapshot)
      .filter((row): row is RcPartySnapshot => Boolean(row));
    const gone = parties.length > 0 && parties.every((row) => !rcPartyIsLive(row.status));
    const snapshot: RcSessionSnapshot = { at: Date.now(), gone, parties };
    if (gone) rcMarkSessionDead(id);
    else rcSessionCache.set(id, snapshot);
    return snapshot;
  })();
  rcSessionInflight.set(id, pending);
  try {
    return await pending;
  } finally {
    rcSessionInflight.delete(id);
  }
}

/** The store's own leg of a session: prefer the party presence named, then a ringing one. */
function rcPickStoreParty(
  parties: RcPartySnapshot[],
  ext: StoreExtensions,
  preferredPartyId = '',
): RcPartySnapshot | null {
  const mine = parties.filter((row) => !row.extensionId || ext.ids.has(row.extensionId));
  const pool = mine.length ? mine : parties;
  const live = pool.filter((row) => rcPartyIsLive(row.status));
  if (!live.length) return null;
  return (
    live.find((row) => preferredPartyId && row.partyId === preferredPartyId) ||
    live.find((row) => rcPartyIsRinging(row.status)) ||
    live[0]
  );
}

/**
 * Drop presence rows whose session is over and correct the status / party id
 * of the rest from the Call Control API.
 */
async function verifyLiveCalls(
  account: RingCentralAccount,
  origin: string,
  headers: Record<string, string>,
  calls: LivePhoneCall[],
  ext: StoreExtensions,
): Promise<LivePhoneCall[]> {
  const checked = await Promise.all(
    calls.map(async (call): Promise<LivePhoneCall | null> => {
      const sessionId = rcSafeId(call.telephonySessionId || call.id);
      if (!sessionId) return call;
      if (rcSessionIsDead(sessionId)) return null;
      let snapshot: RcSessionSnapshot | null = null;
      try {
        snapshot = await rcTelephonySession(account, origin, headers, sessionId);
      } catch {
        snapshot = null;
      }
      if (!snapshot) return call; // Could not check: trust presence for this poll.
      if (snapshot.gone) return null;
      const party = rcPickStoreParty(snapshot.parties, ext, call.partyId);
      if (!party) {
        // The session is alive for someone else (answered elsewhere, voicemail);
        // our leg is not. Nothing here is ringing this store any more.
        return null;
      }
      return {
        ...call,
        id: sessionId,
        telephonySessionId: sessionId,
        partyId: party.partyId || call.partyId,
        status: rcPresenceStatusFor(party.status) || call.status,
        direction: party.direction === 'Outbound' ? 'Outbound' : party.direction === 'Inbound' ? 'Inbound' : call.direction,
        from: call.from || party.from.phoneNumber,
        fromName: call.fromName || party.from.name,
        to: call.to || party.to.phoneNumber,
        toName: call.toName || party.to.name,
      };
    }),
  );
  return checked.filter((row): row is LivePhoneCall => Boolean(row));
}

/** Every live call on the store's phones, already attributed to the store. */
async function collectLiveCalls(
  account: RingCentralAccount,
  origin: string,
  headers: Record<string, string>,
): Promise<LivePhoneCall[]> {
  const storeKey = account.store_key;
  const cached = cachedLiveCalls(account);
  if (cached && Date.now() - cached.at < RC_PRESENCE_TTL_MS) return cached.calls;

  const inflight = rcPresenceInflight.get(storeKey);
  if (inflight) return (await inflight) as LivePhoneCall[];

  const pending = (async () => {
    const again = cachedLiveCalls(account);
    if (again && Date.now() - again.at < RC_PRESENCE_TTL_MS) return again.calls;

    const ext = await resolveStoreExtensions(account, origin, headers);
    const targets = ext.userIds.map(
      (id) => ext.info.get(id) || { id, extensionNumber: '', name: '', type: 'User', status: '' },
    );
    if (!targets.length) {
      if (cached?.calls) return cached.calls;
      throw new Error('No RingCentral extension is linked to this store yet. Assign its number in Settings → RingCentral.');
    }

    const settled = await Promise.allSettled(
      targets.map((row) => extensionLiveCalls(account, origin, headers, row)),
    );
    const found: LivePhoneCall[] = [];
    let throttled = false;
    for (const item of settled) {
      if (item.status === 'fulfilled') found.push(...item.value);
      else if (isRingCentralRateLimit(0, null, item.reason instanceof Error ? item.reason.message : '')) {
        throttled = true;
      }
    }
    if (throttled && !found.length) {
      if (cached?.calls) return cached.calls;
      throw new Error(RC_RATE_LIMIT_MESSAGE);
    }
    const merged = mergeLiveCalls(found).map((call) => ({
      ...call,
      storeKey: account.store_key,
      storeName: account.store_name,
    }));
    const calls = await verifyLiveCalls(account, origin, headers, merged, ext);
    rememberLiveCalls(account, calls);
    void persistRingCentralCache(account, {
      live_calls: calls,
      live_calls_at: account.live_calls_at,
    });
    return calls;
  })();

  rcPresenceInflight.set(storeKey, pending);
  try {
    return (await pending) as LivePhoneCall[];
  } finally {
    rcPresenceInflight.delete(storeKey);
  }
}

const rcCallerIdCache = new Map<string, { at: number; numbers: StorePhoneNumber[] }>();

/**
 * Numbers the JWT's extension may present as caller ID (Light group, cached
 * 10 min per store). The browser softphone passes one of these to `call()`.
 */
async function rcOwnCallerIds(
  account: RingCentralAccount,
  origin: string,
  headers: Record<string, string>,
): Promise<StorePhoneNumber[]> {
  const key = account.store_key;
  const cached = rcCallerIdCache.get(key);
  if (cached && Date.now() - cached.at < RC_DIRECTORY_TTL_MS) return cached.numbers;
  const scope = rcScope(account);
  if (rcGroupBlocked(scope, 'light')) return cached?.numbers || [];
  const result = await rcJson(`${origin}/restapi/v1.0/account/~/extension/~/phone-number?perPage=100`, {
    method: 'GET',
    headers,
  });
  noteRcRateHeaders(scope, result);
  if (!result.ok) return cached?.numbers || [];
  const payload = (result.payload || {}) as { records?: (RingCentralNumber & { features?: string[] })[] };
  const numbers: StorePhoneNumber[] = [];
  for (const raw of Array.isArray(payload.records) ? payload.records : []) {
    const phoneNumber = String(raw?.phoneNumber || '').trim();
    if (!phoneNumber) continue;
    const features = Array.isArray(raw.features) ? raw.features.map(String) : [];
    if (features.length && !features.includes('CallerId')) continue;
    numbers.push({
      phoneNumber,
      usageType: String(raw.usageType || ''),
      type: String(raw.type || ''),
      label: String(raw.label || ''),
      primary: Boolean(raw.primary),
      extensionNumber: String(raw.extension?.extensionNumber || ''),
      extensionName: String(raw.extension?.name || ''),
      siteName: String(raw.site?.name || ''),
    });
  }
  rcCallerIdCache.set(key, { at: Date.now(), numbers });
  return numbers;
}

/** The caller ID a store should present: its own DID when allowed, else the line's direct number. */
function rcDefaultCallerId(account: RingCentralAccount, allowed: StorePhoneNumber[]): string {
  const main = rcLast10(account.main_number);
  const byMain = main ? allowed.find((row) => rcLast10(row.phoneNumber) === main) : undefined;
  if (byMain) return byMain.phoneNumber;
  const assigned = parseStoredPhoneNumbers(account.phone_numbers);
  for (const row of assigned) {
    const hit = allowed.find((item) => rcLast10(item.phoneNumber) === rcLast10(row.phoneNumber));
    if (hit) return hit.phoneNumber;
  }
  return (
    allowed.find((row) => row.usageType === 'DirectNumber')?.phoneNumber ||
    allowed.find((row) => row.primary)?.phoneNumber ||
    allowed[0]?.phoneNumber ||
    ''
  );
}

/**
 * The party the store controls in a session, verified against Call Control.
 * Presence sometimes omits `partyId` or names a leg that already ended.
 */
async function rcResolveStoreParty(
  account: RingCentralAccount,
  origin: string,
  headers: Record<string, string>,
  telephonySessionId: string,
  partyId: string,
): Promise<{ party: RcPartySnapshot | null; gone: boolean }> {
  const ext = await resolveStoreExtensions(account, origin, headers);
  rcSessionCache.delete(telephonySessionId); // Always read fresh before acting.
  const snapshot = await rcTelephonySession(account, origin, headers, telephonySessionId);
  if (!snapshot) return { party: null, gone: false };
  if (snapshot.gone) return { party: null, gone: true };
  return { party: rcPickStoreParty(snapshot.parties, ext, partyId), gone: false };
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
    deviceId?: string; // the browser's own WebRTC device from `sip`, so Answer lands in that tab
    storePhone?: string; // legacy hint from older web builds; attribution is by extension now
    dateFrom?: string; // `history`: ISO window start
    dateTo?: string; // `history`: ISO window end (exclusive)
  }>(req);
  const action = String(body.action || 'presence').trim().toLowerCase();
  const storeKey = storeKeyOf(body.storeKey || body.storeName || '');
  if (!storeKey) return error(req, 400, 'Choose a store.', 'bad_request');

  const session = await ringCentralSession(req, storeKey);
  if ('response' in session) return session.response;
  let { account, origin, headers } = session;
  if (account.last_status === 'error') {
    const recovered = await markRingCentralStatus(account.id, {
      last_status: 'connected',
      last_error: '',
      last_checked_at: new Date().toISOString(),
    });
    account = recovered || { ...account, last_status: 'connected', last_error: '' };
  }

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
      const ext = await resolveStoreExtensions(account, origin, headers);
      const log = await accountCallLog(account, origin, headers);
      // Voicemail can only be read for the JWT's own extension; when this store
      // row borrows another store's JWT, say so instead of showing their inbox.
      const ownsVoicemail = !ext.ownId || ext.ids.has(ext.ownId);
      const voicemail = ownsVoicemail
        ? await storeVoicemails(account, origin, headers)
        : {
            rows: [],
            error:
              'Voicemail needs this store’s own RingCentral user. Connect its JWT in Settings → RingCentral.',
          };
      const liveCalls = cachedLiveCalls(account)?.calls || [];
      return json(req, 200, {
        store: publicRingCentralAccount(account),
        liveCalls,
        incoming: liveCalls.filter(
          (row) => row.direction === 'Inbound' && /ringing|proceeding|setup/i.test(row.status),
        ),
        calls: callLogForStore(account, log.rows, ext, log.scope),
        voicemails: voicemail.rows,
        callLogError: log.error,
        voicemailError: voicemail.error,
      });
    }

    if (action === 'history') {
      // Call log + voicemail for a chosen day or date range, beyond the rolling
      // 14-day inbox. Heavy group, so windows are bounded and cached.
      const window = rcHistoryWindow(body.dateFrom, body.dateTo);
      if (!window) {
        return error(req, 400, `Pick a date range within the last ${RC_HISTORY_MAX_DAYS} days.`, 'bad_request');
      }
      const ext = await resolveStoreExtensions(account, origin, headers);
      const log = await accountCallLogWindow(account, origin, headers, window);
      const ownsVoicemail = !ext.ownId || ext.ids.has(ext.ownId);
      const voicemail = ownsVoicemail
        ? await storeVoicemailsWindow(account, origin, headers, window)
        : {
            rows: [],
            error:
              'Voicemail needs this store’s own RingCentral user. Connect its JWT in Settings → RingCentral.',
          };
      return json(req, 200, {
        store: publicRingCentralAccount(account),
        dateFrom: window.from.toISOString(),
        dateTo: window.to.toISOString(),
        calls: callLogForStore(account, log.rows, ext, log.scope),
        voicemails: voicemail.rows,
        callLogError: log.error,
        voicemailError: voicemail.error,
      });
    }

    if (action === 'sip') {
      // Register this browser as a WebRTC phone for the JWT's extension so the
      // app can answer with real audio. sipInfo is reusable for days; the
      // client caches it, so this Heavy call happens rarely.
      const scope = rcScope(account);
      const ext = await resolveStoreExtensions(account, origin, headers);
      const ringsForStore = !ext.ownId || ext.ids.has(ext.ownId);
      if (!ringsForStore) {
        return error(
          req,
          409,
          `${account.store_name || 'This store'} is using another store’s RingCentral user. Paste this store’s own JWT in Settings → RingCentral to answer its calls here.`,
          'ringcentral_other_extension',
        );
      }
      if (rcGroupBlocked(scope, 'heavy') || !rcTakeHeavy(scope)) {
        return error(req, 429, RC_RATE_LIMIT_MESSAGE, 'throttled');
      }
      const result = await rcJson(`${origin}/restapi/v1.0/client-info/sip-provision`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ sipInfo: [{ transport: 'WSS' }] }),
      });
      noteRcRateHeaders(scope, result);
      if (!result.ok) {
        return error(
          req,
          result.status === 429 ? 429 : 400,
          rcErrorMessage(result.payload, 'RingCentral would not register this browser as a phone.'),
          result.status === 429 ? 'throttled' : 'bad_request',
        );
      }
      const payload = (result.payload || {}) as {
        sipInfo?: unknown[];
        sipFlags?: unknown;
        device?: { id?: string | number; name?: string };
      };
      const sipInfo = Array.isArray(payload.sipInfo) ? payload.sipInfo[0] || null : null;
      if (!sipInfo) return error(req, 400, 'RingCentral returned no SIP details for this line.', 'bad_request');
      const callerIds = await rcOwnCallerIds(account, origin, headers).catch(() => [] as StorePhoneNumber[]);
      return json(req, 200, {
        store: publicRingCentralAccount(account),
        sipInfo,
        sipFlags: payload.sipFlags || null,
        deviceId: String(payload.device?.id || ''),
        extensionId: ext.ownId,
        extensionName: ext.info.get(ext.ownId)?.name || '',
        callerIds: callerIds.map((row) => row.phoneNumber),
        defaultCallerId: rcDefaultCallerId(account, callerIds),
      });
    }

    if (action === 'ringout') {
      // Two-legged call: RingCentral rings `from` first (the store's phone),
      // then dials `to`. Used where the browser cannot be the phone.
      const to = rcE164(body.to);
      if (!to) return error(req, 400, 'Enter a number to call.', 'bad_request');
      const allowed = await rcOwnCallerIds(account, origin, headers).catch(() => [] as StorePhoneNumber[]);
      const from =
        rcE164(body.from) ||
        rcE164(account.main_number) ||
        rcE164(parseStoredPhoneNumbers(account.phone_numbers)[0]?.phoneNumber) ||
        rcE164(rcDefaultCallerId(account, allowed));
      if (!from) {
        return error(
          req,
          400,
          'This store has no phone number to ring first. Assign its number in Settings → RingCentral.',
          'bad_request',
        );
      }
      // Caller ID must be a number this extension may present; otherwise let RingCentral pick.
      const callerId = allowed.some((row) => rcLast10(row.phoneNumber) === rcLast10(from))
        ? from
        : rcE164(rcDefaultCallerId(account, allowed));
      const result = await rcJson(`${origin}/restapi/v1.0/account/~/extension/~/ring-out`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          from: { phoneNumber: from },
          to: { phoneNumber: to },
          playPrompt: false,
          ...(callerId ? { callerId: { phoneNumber: callerId } } : {}),
        }),
      });
      if (!result.ok) {
        return error(
          req,
          result.status === 429 ? 429 : 400,
          rcErrorMessage(result.payload, 'Could not start the call.'),
          result.status === 429 ? 'throttled' : 'bad_request',
        );
      }
      const row = (result.payload || {}) as Record<string, unknown>;
      rcPresenceCache.delete(storeKey);
      account.live_calls_at = null;
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
      if (!telephonySessionId) {
        return error(req, 400, 'That call is no longer available.', 'bad_request');
      }
      const goneMessage =
        action === 'hangup' ? 'That call already ended.' : 'That call already ended or was picked up elsewhere.';
      const gone = () => {
        rcPresenceCache.delete(storeKey);
        account.live_calls_at = null;
        return error(req, 409, goneMessage, 'ringcentral_wrong_state');
      };

      // Confirm the leg with Call Control first: presence may name a party
      // that already ended, or omit the id altogether.
      const resolved = await rcResolveStoreParty(
        account,
        origin,
        headers,
        telephonySessionId,
        rcSafeId(body.partyId),
      );
      if (resolved.gone) return gone();
      const party = resolved.party;
      const partyId = party?.partyId || rcSafeId(body.partyId);
      if (!partyId) return gone();
      if (party && (action === 'answer' || action === 'reject') && !rcPartyIsRinging(party.status)) {
        return gone();
      }

      const base = `${origin}/restapi/v1.0/account/~/telephony/sessions/${telephonySessionId}/parties/${partyId}`;
      let result;
      if (action === 'answer') {
        // Prefer the device the browser registered through `sip`: RingCentral
        // then re-INVITEs that tab with Alert-Info: Auto Answer and the call
        // lands where Answer was pressed.
        const deviceId = rcSafeId(body.deviceId) || (await firstRingCentralDevice(origin, headers));
        if (!deviceId) {
          return error(
            req,
            400,
            'No phone is registered for this line. Allow the microphone in this browser so the app can be the phone, or pick up on the RingCentral app.',
            'bad_request',
          );
        }
        result = await rcJson(`${base}/answer`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ deviceId }),
        });
      } else if (action === 'reject') {
        result = await rcJson(`${base}/reject`, { method: 'POST', headers, body: '{}' });
      } else {
        result = await rcJson(`${base}`, { method: 'DELETE', headers });
        if (!result.ok && isRingCentralWrongState(result) && (!party || rcPartyIsRinging(party.status))) {
          // A leg that is still ringing cannot be dropped, only rejected.
          result = await rcJson(`${base}/reject`, { method: 'POST', headers, body: '{}' });
        }
      }
      rcSessionCache.delete(telephonySessionId);
      if (!result.ok) {
        // Whatever happened, the cached presence for this line is now suspect.
        rcPresenceCache.delete(storeKey);
        account.live_calls_at = null;
        if (isRingCentralWrongState(result)) return gone();
        const fallbackMessage =
          action === 'answer'
            ? 'Could not answer on a RingCentral device. The line’s only device (the RingCentral app) is offline; the browser phone needs microphone access to take the call.'
            : action === 'reject'
              ? 'Could not reject the call.'
              : 'Could not hang up.';
        return error(
          req,
          result.status === 429 ? 429 : 400,
          rcErrorMessage(result.payload, fallbackMessage),
          result.status === 429 ? 'throttled' : 'bad_request',
        );
      }
      rcPresenceCache.delete(storeKey);
      account.live_calls_at = null;
      const liveCalls = await collectLiveCalls(account, origin, headers);
      return json(req, 200, { store: publicRingCentralAccount(account), liveCalls, ok: true });
    }

    return error(req, 400, 'Unknown phone action.', 'bad_request');
  } catch (err) {
    const message = ringCentralFailureMessage(err);
    const rateLimited = isRingCentralRateLimit(0, null, message);
    if (!rateLimited) rcTokenCache.delete(storeKey);
    return error(req, rateLimited ? 429 : 502, message, rateLimited ? 'throttled' : 'upstream_failed');
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
  const isAvatar = path.startsWith('/avatars/');
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
    if (path === '/avatars/inspect') {
      return await handleAvatarInspect(req, await readBody(req));
    }
    if (path === '/avatars/stylize') {
      return await handleAvatarStylize(req, await readBody(req), staff.userId);
    }
    if (path.startsWith('/fintrac/')) {
      return await handleFintrac(req, path.slice('/fintrac'.length), search, await readBody(req));
    }
    if (path === '/rippling/oauth/config') {
      return await handleRipplingOAuthConfig(req, staff);
    }
    if (path === '/rippling/oauth/app' && req.method === 'POST') {
      return await handleRipplingOAuthAppSave(req, staff, await readBody(req));
    }
    if (path === '/rippling/oauth/token' && req.method === 'POST') {
      return await handleRipplingOAuthToken(req, staff, await readBody(req));
    }
    if (path === '/rippling/company' && req.method === 'POST') {
      return await handleRipplingCompanySave(req, staff, await readBody(req));
    }
    if (path === '/rippling/company/disconnect' && req.method === 'POST') {
      return await handleRipplingCompanyDisconnect(req, staff);
    }
    if (path.startsWith('/rippling/')) {
      return await handleRippling(req, path.slice('/rippling'.length), search);
    }
    if (path === '/gmail/oauth/config') {
      return handleGmailOAuthConfig(req);
    }
    if (path === '/gmail/oauth/token' && req.method === 'POST') {
      return await handleGmailOAuthToken(req, await readBody(req));
    }
    if (path === '/gmail/mailbox' && req.method === 'POST') {
      return await handleGmailMailbox(req, await readBody(req));
    }
    if (path === '/gmail/message' && req.method === 'GET') {
      return await handleGmailMessage(req, query);
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
