/** Normalize photos so Storage gets JPEG or PNG — never HEIC/HEIF. */

const HEIC_HINT = /heic|heif/i;
const PNG_HINT = /png/i;
const JPEG_HINT = /jpe?g/i;

function asString(value) {
  if (value == null) return '';
  return String(value).trim();
}

export function dataUrlToBlob(dataUrl) {
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

export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Could not read that photo.'));
    reader.readAsDataURL(blob);
  });
}

async function sniffKind(blob) {
  if (!blob?.slice) return '';
  try {
    const buf = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
    const ascii = String.fromCharCode(...buf);
    if (/ftypheic|ftypheix|ftyphevc|ftypmif1|ftypmsf1|ftypheim|ftypheis/i.test(ascii)) return 'heic';
  } catch {
    return '';
  }
  return '';
}

function hintKind(mime, name, uri) {
  const text = `${mime} ${name} ${uri}`.toLowerCase();
  if (HEIC_HINT.test(text)) return 'heic';
  if (PNG_HINT.test(text)) return 'png';
  if (JPEG_HINT.test(text)) return 'jpeg';
  return '';
}

export function normalizeImageContentType(mime, kind = '') {
  const value = asString(mime).toLowerCase();
  if (value === 'image/jpg' || value === 'image/jpeg' || kind === 'jpeg') return 'image/jpeg';
  if (value === 'image/png' || kind === 'png') return 'image/png';
  return 'image/jpeg';
}

export function uploadExtForType(contentType) {
  return contentType === 'image/png' ? 'png' : 'jpg';
}

function loadHtmlImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not read that photo.'));
    image.src = src;
  });
}

function drawToJpegBlob(source, quality = 0.85) {
  const width = Math.max(1, source.naturalWidth || source.width || 0);
  const height = Math.max(1, source.naturalHeight || source.height || 0);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not convert that photo.');
  ctx.drawImage(source, 0, 0, width, height);
  const dataUrl = canvas.toDataURL('image/jpeg', quality);
  const blob = dataUrlToBlob(dataUrl);
  if (!blob || blob.size < 32) throw new Error('Could not convert that photo.');
  return blob;
}

async function decodeBlob(blob) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(blob);
    } catch {
      /* Safari / Chrome sometimes need an <img> for HEIC. */
    }
  }
  if (typeof document === 'undefined') {
    throw new Error('That photo format is not supported. Use PNG, JPG, or JPEG.');
  }
  const url = URL.createObjectURL(blob);
  try {
    return await loadHtmlImage(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function convertBlobToJpeg(blob, quality = 0.85) {
  const source = await decodeBlob(blob);
  try {
    return drawToJpegBlob(source, quality);
  } finally {
    if (typeof source.close === 'function') source.close();
  }
}

export async function blobFromPhotoUri(uri) {
  const fromData = dataUrlToBlob(uri);
  if (fromData) return fromData;
  if (!uri) throw new Error('Choose a photo first.');
  const response = await fetch(uri);
  if (!response.ok) throw new Error('Could not read that photo.');
  return response.blob();
}

/**
 * Returns a JPEG or PNG blob. HEIC/HEIF (and unknown types) become JPEG.
 */
export async function toSupportedImageBlob(blob, { mime = '', name = '', uri = '' } = {}) {
  if (!blob || blob.size < 32) throw new Error('Choose a photo first.');
  const kind = hintKind(mime || blob.type, name, uri) || (await sniffKind(blob));
  if (kind === 'png') {
    return { blob: blob.type === 'image/png' ? blob : new Blob([blob], { type: 'image/png' }), contentType: 'image/png' };
  }
  if (kind === 'jpeg') {
    return { blob: blob.type === 'image/jpeg' ? blob : new Blob([blob], { type: 'image/jpeg' }), contentType: 'image/jpeg' };
  }
  if (kind === 'heic' || HEIC_HINT.test(String(blob.type || ''))) {
    try {
      const jpeg = await convertBlobToJpeg(blob);
      return { blob: jpeg, contentType: 'image/jpeg' };
    } catch {
      throw new Error('Could not convert that HEIC photo. Save it as PNG or JPEG and try again.');
    }
  }
  const type = normalizeImageContentType(blob.type || mime, kind);
  if (type === 'image/png' || type === 'image/jpeg') {
    return { blob: blob.type === type ? blob : new Blob([blob], { type }), contentType: type };
  }
  try {
    const jpeg = await convertBlobToJpeg(blob);
    return { blob: jpeg, contentType: 'image/jpeg' };
  } catch {
    throw new Error('That photo format is not supported. Use PNG, JPG, or JPEG.');
  }
}

export async function encodePickerAsset(asset) {
  const mime = asString(asset?.mimeType || asset?.type);
  const name = asString(asset?.fileName || asset?.name);
  const uri = asset?.base64 ? `data:${mime || 'image/jpeg'};base64,${asset.base64}` : asString(asset?.uri);
  const blob = await blobFromPhotoUri(uri);
  const supported = await toSupportedImageBlob(blob, { mime, name, uri });
  return blobToDataUrl(supported.blob);
}
