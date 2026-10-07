import { normalizeReviewImages } from './triageDraft';
import { getSupabase } from './supabase';

export const TRIAGE_ERROR_PHOTO_BUCKET = 'triage-error-photos';
/** Hard ceiling after optional compression. Storage bucket must match. */
export const MAX_BYTES = 20 * 1024 * 1024;
const COMPRESS_OVER_BYTES = 12 * 1024 * 1024;
const COMPRESS_MAX_EDGE = 2400;
const COMPRESS_QUALITY = 0.82;

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

async function blobFromUri(uri) {
  const fromData = dataUrlToBlob(uri);
  if (fromData) return fromData;
  if (!uri) throw new Error('Choose a photo first.');
  const response = await fetch(uri);
  if (!response.ok) throw new Error('Could not read that photo.');
  return response.blob();
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Could not read that photo.'));
    reader.readAsDataURL(blob);
  });
}

function loadHtmlImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not read that photo.'));
    image.src = src;
  });
}

async function compressImageBlob(blob, { maxEdge = COMPRESS_MAX_EDGE, quality = COMPRESS_QUALITY } = {}) {
  if (typeof document === 'undefined') return blob;
  try {
    const dataUrl = await blobToDataUrl(blob);
    const image = await loadHtmlImage(dataUrl);
    const longest = Math.max(image.width, image.height, 1);
    const scale = Math.min(1, maxEdge / longest);
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return blob;
    ctx.drawImage(image, 0, 0, width, height);
    const next = dataUrlToBlob(canvas.toDataURL('image/jpeg', quality));
    if (!next || next.size < 32) return blob;
    return next.size < blob.size ? next : blob;
  } catch {
    return blob;
  }
}

async function prepareUploadBlob(blob) {
  if (!blob || blob.size < 32) throw new Error('Choose a photo first.');
  let next = blob;
  if (next.size > COMPRESS_OVER_BYTES || next.size > MAX_BYTES) {
    next = await compressImageBlob(next);
  }
  if (next.size > MAX_BYTES) {
    next = await compressImageBlob(next, { maxEdge: 1800, quality: 0.7 });
  }
  if (next.size > MAX_BYTES) throw new Error('Choose a photo under 20 MB.');
  return next;
}

function safePoId(poId) {
  const id = asString(poId).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
  return id || 'po';
}

export async function uploadTriageErrorPhotos(images, poId) {
  const list = normalizeReviewImages(images);
  if (!list.length) return [];

  const supabase = getSupabase();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData?.user?.id) throw new Error('Sign in to save photos.');
  const owner = authData.user.id;

  const saved = [];
  for (const image of list) {
    const uri = asString(image.uri);
    if (/^https?:\/\//i.test(uri)) {
      saved.push(image);
      continue;
    }
    const blob = await prepareUploadBlob(await blobFromUri(uri));

    const mime = asString(blob.type || 'image/jpeg').toLowerCase() || 'image/jpeg';
    const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg';
    const contentType = mime.startsWith('image/') ? mime : 'image/jpeg';
    const path = `${owner}/${safePoId(poId)}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

    const { error } = await supabase.storage.from(TRIAGE_ERROR_PHOTO_BUCKET).upload(path, blob, {
      upsert: false,
      contentType,
      cacheControl: '3600',
    });
    if (error) throw new Error(error.message || 'Could not save that photo.');

    const { data } = supabase.storage.from(TRIAGE_ERROR_PHOTO_BUCKET).getPublicUrl(path);
    saved.push({ id: image.id, uri: `${data.publicUrl}?v=${Date.now()}` });
  }
  return saved;
}
