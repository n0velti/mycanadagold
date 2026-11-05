/**
 * Staff portrait helpers. Photos are compressed locally before upload.
 */
import { blobToDataUrl, compressImageDataUrl } from './imageEncode';

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
