const STORE_SHORT_CODES = {
  montreal: 'MTL',
  toronto: 'TOR',
  ottawa: 'OTT',
  quebec: 'QC',
  'quebec city': 'QC',
  laval: 'LVL',
  mississauga: 'MIS',
  hamilton: 'HAM',
  calgary: 'CGY',
  edmonton: 'EDM',
  vancouver: 'VAN',
  'richmond hill': 'RH',
  workshop: 'WKS',
};

const STORE_MARK_COLORS = {
  montreal: '#1D4ED8',
  laval: '#C2410C',
  quebec: '#0F766E',
  'quebec city': '#0F766E',
  workshop: '#6B4DE6',
  toronto: '#2F8A4E',
  mississauga: '#C47A12',
  hamilton: '#2F6FED',
  'richmond hill': '#6B4DE6',
  ottawa: '#B91C1C',
  calgary: '#0F766E',
  edmonton: '#1D4ED8',
  vancouver: '#1F8A4E',
};

const STORE_MARK_FALLBACKS = ['#1D4ED8', '#0F766E', '#B91C1C', '#C2410C', '#6B4DE6', '#2F8A4E'];

export function storeDisplayName(name) {
  return String(name || '')
    .replace(/^canada\s*gold(?:\s*[-–—:])?\s*/i, '')
    .replace(/\s+canada\s*gold$/i, '')
    .trim();
}

function storeLookupKey(name) {
  return storeDisplayName(name).toLowerCase();
}

export function storeShortCode(name) {
  const cleaned = storeDisplayName(name);
  if (!cleaned) return '';
  const known = STORE_SHORT_CODES[cleaned.toLowerCase()];
  if (known) return known;
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return parts
      .map((part) => part[0])
      .join('')
      .slice(0, 3)
      .toUpperCase();
  }
  return cleaned.slice(0, 3).toUpperCase();
}

export function storeMarkColor(name) {
  const key = storeLookupKey(name);
  if (STORE_MARK_COLORS[key]) return STORE_MARK_COLORS[key];
  const value = String(name || '');
  if (!value) return '#8E8E93';
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return STORE_MARK_FALLBACKS[hash % STORE_MARK_FALLBACKS.length];
}
