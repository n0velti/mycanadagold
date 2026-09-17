import * as Crypto from 'expo-crypto';
import { getSupabase, invokeEdgeFunction } from './supabase';

export const LINE_PHOTO_BUCKET = 'trade-line-photos';
const MAX_BYTES = 5 * 1024 * 1024;

function asString(value) {
  if (value == null) return '';
  return String(value).trim();
}

function dataUrlToBlob(dataUrl) {
  const match = asString(dataUrl).match(/^data:([^;]+);base64,([A-Za-z0-9+/=\s]+)$/);
  if (!match) return null;
  try {
    const binary = atob(match[2].replace(/\s/g, ''));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: match[1] || 'image/jpeg' });
  } catch {
    return null;
  }
}

async function blobFromAsset(asset) {
  const uri = asString(asset?.uri);
  const fromData = dataUrlToBlob(uri);
  if (fromData) return fromData;
  if (typeof Blob !== 'undefined' && asset instanceof Blob) return asset;
  if (!uri) throw new Error('Choose a photo first.');
  const response = await fetch(uri);
  if (!response.ok) throw new Error('Could not read that photo.');
  return response.blob();
}

function bytesToBase64Url(bytes) {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  const base64 =
    typeof btoa === 'function'
      ? btoa(binary)
      : globalThis.Buffer
        ? globalThis.Buffer.from(bytes).toString('base64')
        : '';
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export async function randomCaptureToken() {
  const bytes = await Crypto.getRandomBytesAsync(18);
  return bytesToBase64Url(bytes);
}

export async function uploadLinePhoto(asset, lineId, userId) {
  const supabase = getSupabase();
  const owner = asString(userId);
  if (!owner) throw new Error('Sign in to attach a photo.');
  const blob = await blobFromAsset(asset);
  if (!blob || blob.size < 32) throw new Error('Choose a photo first.');
  if (blob.size > MAX_BYTES) throw new Error('Choose a photo under 5 MB.');

  const mime = asString(asset?.mimeType || asset?.type || blob.type || 'image/jpeg').toLowerCase() || 'image/jpeg';
  const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg';
  const contentType = mime.startsWith('image/') ? mime : `image/${ext === 'jpg' ? 'jpeg' : ext}`;
  const path = `${owner}/${asString(lineId) || 'line'}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  const { error } = await supabase.storage.from(LINE_PHOTO_BUCKET).upload(path, blob, {
    upsert: false,
    contentType,
    cacheControl: '3600',
  });
  if (error) throw new Error(error.message || 'Could not save that photo.');

  const { data } = supabase.storage.from(LINE_PHOTO_BUCKET).getPublicUrl(path);
  return `${data.publicUrl}?v=${Date.now()}`;
}

export async function createCaptureSession({ lineId, itemName, userId }) {
  const supabase = getSupabase();
  const owner = asString(userId);
  if (!owner) throw new Error('Sign in to create a phone capture link.');
  const token = await randomCaptureToken();
  const { data, error } = await supabase
    .from('trade_capture_sessions')
    .insert({
      token,
      line_id: asString(lineId),
      item_name: asString(itemName).slice(0, 120),
      created_by: owner,
    })
    .select('id, token, expires_at')
    .single();
  if (error) throw new Error(error.message || 'Could not start phone capture.');
  return data;
}

export function subscribeCaptureSession(id, onPhoto) {
  if (!id) return () => {};
  const supabase = getSupabase();
  const channel = supabase
    .channel(`trade-capture-${id}`)
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'trade_capture_sessions', filter: `id=eq.${id}` },
      (payload) => {
        const url = asString(payload?.new?.photo_url);
        if (url) onPhoto?.(url);
      },
    )
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}

export async function uploadCapturePhoto(token, imageDataUrl) {
  const data = await invokeEdgeFunction('trade-capture', { token, image: imageDataUrl });
  return asString(data?.photoUrl);
}
