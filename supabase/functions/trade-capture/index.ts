/**
 * trade-capture — phone uploads a line-item photo from a QR session.
 *
 *   POST { token, image }   image is a data URL (jpeg/png/webp)
 *
 * verify_jwt is off: the capture token is the credential. The phone page
 * still sends the public anon key the same way other functions do.
 */
import { createClient } from 'npm:@supabase/supabase-js@2';
import { error, json, preflight } from '../_shared/http.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SECRET_KEY') ?? '';
const BUCKET = 'trade-line-photos';
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_BODY = 6_800_000;
const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;

function admin() {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    throw new Error('Edge Function is missing SUPABASE_URL or the service role key.');
  }
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function parseDataUrl(value: string): { bytes: Uint8Array; contentType: string; ext: string } | null {
  const match = String(value || '').trim().match(/^data:(image\/(jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!match) return null;
  const contentType = match[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : match[1].toLowerCase();
  const b64 = match[3].replace(/\s/g, '');
  try {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg';
    return { bytes, contentType, ext };
  } catch {
    return null;
  }
}

async function readBody(req: Request): Promise<{ token?: string; image?: string }> {
  const length = Number(req.headers.get('content-length') || 0);
  if (length > MAX_BODY) throw new Error('Photo is too large.');
  const text = await req.text();
  if (text.length > MAX_BODY) throw new Error('Photo is too large.');
  if (!text.trim()) return {};
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Body must be a JSON object.');
  }
  return parsed as { token?: string; image?: string };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight(req);
  if (req.method !== 'POST') return error(req, 405, 'Use POST.', 'method');

  let body: { token?: string; image?: string };
  try {
    body = await readBody(req);
  } catch (err) {
    return error(req, 400, err instanceof Error ? err.message : 'Invalid photo.', 'bad_body');
  }

  const token = String(body.token || '').trim();
  if (!TOKEN_RE.test(token)) return error(req, 400, 'That capture link is invalid.', 'bad_token');

  const parsed = parseDataUrl(String(body.image || ''));
  if (!parsed) return error(req, 400, 'Send a JPEG, PNG, or WebP photo.', 'bad_image');
  if (parsed.bytes.byteLength < 32) return error(req, 400, 'That photo is empty.', 'bad_image');
  if (parsed.bytes.byteLength > MAX_BYTES) return error(req, 400, 'Choose a photo under 5 MB.', 'too_large');

  const supabase = admin();
  const { data: session, error: loadError } = await supabase
    .from('trade_capture_sessions')
    .select('id, token, line_id, created_by, expires_at')
    .eq('token', token)
    .maybeSingle();

  if (loadError) return error(req, 500, 'Could not look up that capture link.', 'lookup');
  if (!session) return error(req, 404, 'That capture link was not found.', 'missing');
  if (new Date(session.expires_at).getTime() < Date.now()) {
    return error(req, 410, 'That capture link expired. Generate a new QR code.', 'expired');
  }

  const path = `${session.created_by}/${session.line_id}/${crypto.randomUUID()}.${parsed.ext}`;
  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, new Blob([parsed.bytes], { type: parsed.contentType }), {
      contentType: parsed.contentType,
      upsert: false,
      cacheControl: '3600',
    });
  if (uploadError) return error(req, 500, 'Could not save that photo.', 'upload');

  const { data: publicUrl } = supabase.storage.from(BUCKET).getPublicUrl(path);
  const photoUrl = `${publicUrl.publicUrl}?v=${Date.now()}`;

  const { error: updateError } = await supabase
    .from('trade_capture_sessions')
    .update({ photo_url: photoUrl, captured_at: new Date().toISOString() })
    .eq('id', session.id);
  if (updateError) return error(req, 500, 'Photo saved but the ticket did not update.', 'update');

  return json(req, 200, { photoUrl });
});
