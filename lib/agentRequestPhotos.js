import { normalizeReviewImages } from './triageDraft';
import { getSupabase } from './supabase';

export const AGENT_REQUEST_PHOTO_BUCKET = 'agent-request-photos';
export const MAX_AGENT_REQUEST_IMAGES = 4;
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

async function blobFromUri(uri) {
  const fromData = dataUrlToBlob(uri);
  if (fromData) return fromData;
  if (!uri) throw new Error('Choose a photo first.');
  const response = await fetch(uri);
  if (!response.ok) throw new Error('Could not read that photo.');
  return response.blob();
}

function safeConversationId(conversationId) {
  const id = asString(conversationId).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
  return id || 'thread';
}

export function normalizeAgentRequestImages(images) {
  return normalizeReviewImages(images).slice(0, MAX_AGENT_REQUEST_IMAGES);
}

export async function uploadAgentRequestPhotos(images, conversationId) {
  const list = normalizeAgentRequestImages(images);
  if (!list.length) return [];

  const supabase = getSupabase();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData?.user?.id) throw new Error('Sign in to attach photos.');
  const owner = authData.user.id;

  const saved = [];
  for (const image of list) {
    const uri = asString(image.uri);
    if (/^https?:\/\//i.test(uri)) {
      saved.push(uri);
      continue;
    }
    const blob = await blobFromUri(uri);
    if (!blob || blob.size < 32) throw new Error('Choose a photo first.');
    if (blob.size > MAX_BYTES) throw new Error('Choose a photo under 5 MB.');

    const mime = asString(blob.type || 'image/jpeg').toLowerCase() || 'image/jpeg';
    const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg';
    const contentType = mime.startsWith('image/') ? mime : 'image/jpeg';
    const path = `${owner}/${safeConversationId(conversationId)}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

    const { error } = await supabase.storage.from(AGENT_REQUEST_PHOTO_BUCKET).upload(path, blob, {
      upsert: false,
      contentType,
      cacheControl: '3600',
    });
    if (error) throw new Error(error.message || 'Could not save that photo.');

    const { data } = supabase.storage.from(AGENT_REQUEST_PHOTO_BUCKET).getPublicUrl(path);
    saved.push(`${data.publicUrl}?v=${Date.now()}`);
  }
  return saved;
}
