/**
 * Canada Gold staff portraits. The raw photo is sent through the proxy, which
 * restyles that same person as a fun Disney cartoon, with a unique shirt
 * and background so portraits do not all look the same.
 */
import { compressImageDataUrl } from './openrouter';
import { ProxyError, proxyFetch } from './proxy';

const SOURCE_MAX_WIDTH = 1280;
const SOURCE_QUALITY = 0.82;
const PORTRAIT_MAX_WIDTH = 768;
const PORTRAIT_QUALITY = 0.84;

function asString(value) {
  if (value == null) return '';
  return String(value).trim();
}

function parseDataUrl(value) {
  const match = asString(value).match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) return null;
  return { mediaType: match[1], data: match[2] };
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Could not read that photo.'));
    reader.readAsDataURL(blob);
  });
}

export async function assetToDataUrl(asset) {
  if (typeof asset === 'string') {
    if (parseDataUrl(asset)) return asset;
    throw new Error('Choose a photo first.');
  }

  const uri = asString(asset?.uri);
  if (parseDataUrl(uri)) return uri;

  const mime = asString(asset?.mimeType || asset?.type || 'image/jpeg') || 'image/jpeg';
  if (asset?.base64) return `data:${mime};base64,${asset.base64}`;
  if (!uri) throw new Error('Choose a photo first.');

  const response = await fetch(uri);
  if (!response.ok) throw new Error('Could not read that photo.');
  return blobToDataUrl(await response.blob());
}

export async function prepareAvatarAsset(dataUrl) {
  const compressed = await compressImageDataUrl(dataUrl, {
    maxWidth: PORTRAIT_MAX_WIDTH,
    quality: PORTRAIT_QUALITY,
  });
  return { uri: compressed, mimeType: 'image/jpeg' };
}

/**
 * Restyle a webcam still or library photo into a Disney cartoon of them.
 * Returns a JPEG data URL ready to upload.
 */
export async function stylizeAvatarPhoto(asset, { signal } = {}) {
  const source = await assetToDataUrl(asset);
  const compressed = await compressImageDataUrl(source, {
    maxWidth: SOURCE_MAX_WIDTH,
    quality: SOURCE_QUALITY,
  });
  if (!parseDataUrl(compressed)) throw new Error('Choose a JPEG, PNG, or WebP photo.');

  const response = await proxyFetch('avatars/stylize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ image: compressed }),
    signal,
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      payload?.error?.message || payload?.message || 'Could not draw that portrait. Try another photo.';
    throw new ProxyError(message, response.status, payload?.error?.code);
  }

  const image = asString(payload?.image);
  if (!parseDataUrl(image)) throw new Error('Portrait service did not return an image.');
  return image;
}
