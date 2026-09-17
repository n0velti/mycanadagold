import { Platform } from 'react-native';

export async function qrDataUrl(text) {
  const value = String(text || '').trim();
  if (!value) return '';
  try {
    const QRCode = (await import('qrcode')).default;
    return QRCode.toDataURL(value, {
      margin: 1,
      width: 280,
      errorCorrectionLevel: 'M',
      color: { dark: '#1d1d1f', light: '#ffffff' },
    });
  } catch {
    return '';
  }
}

export function capturePageUrl(token) {
  const path = `/c/${encodeURIComponent(String(token || '').trim())}`;
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin}${path}`;
  }
  return path;
}

export function captureTokenFromLocation() {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return '';
  const match = String(window.location.pathname || '').match(/^\/c\/([A-Za-z0-9_-]{16,64})\/?$/);
  return match ? match[1] : '';
}
