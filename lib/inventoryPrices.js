import { catalogEntries, parseMoney } from './priceCheck';
import { itemMatchKey } from './websitePrices';

/**
 * Website buy / sell prices for POS bullion inventory labels.
 *
 * POS names are terse ("GBAR 1oz RCM", "SML 1oz non-DNA", "SBAR/ROUND 1kg") and the
 * fuzzy transaction matcher in priceCheck mis-reads most of them, so this resolves
 * each label to one canonical canadagold.ca product with explicit rules. Sizes the
 * website does not list (2 oz maples, 1.5 oz RCM, 2 oz rounds, 1/20 oz maple,
 * 1/2 oz platinum maple, bullion by gram) are derived from the listed unit price and
 * flagged `derived`. Anything else stays blank rather than guess.
 */

const GRAMS_PER_TROY_OZ = 31.1034768;

const W = {
  GML_STD: '1 oz Standard Gold Maple Leaf Coin 9999',
  GML_DNA: '1 oz DNA Gold Maple Leaf Coin 9999',
  GML_999: '1 oz Gold Maple Leaf Damaged or 999',
  GML_UNDER_1OZ: 'Gold Maple Leaf under 1 oz',
  GML_HALF: 'Fractional Gold Maple Leaf 1/2 oz Coin',
  GML_QUARTER: 'Fractional Gold Maple Leaf 1/4 oz Coin',
  GML_TENTH: 'Fractional Gold Maple Leaf 1/10 oz Coin',
  MAPLEGRAM: 'Maplegram',
  GBAR_1OZ_CARDED: '1 oz Recognized Gold Bar (Carded)',
  GBAR_1OZ_UNCARDED: '1 oz Uncarded Recognized Gold Bar',
  GBAR_5G: '5 Gram Recognized Gold Bar (Carded)',
  GBAR_10G: '10 Gram Recognized Gold Bar (Carded)',
  GBAR_5OZ: '5 oz Recognized Gold Bar',
  GBAR_10OZ: '10 oz Recognized Gold Bar',
  GOLD_UNREC: 'Unrecognized Gold Bars',
  SML_STD: '1 oz Standard Silver Maple Leaf Coin',
  SML_DNA: '1 oz DNA Silver Maple Leaf Coin',
  SROUND: '1 oz Recognized Silver Round',
  SBAR_1OZ: '1 oz Recognized Silver Bar',
  SBAR_5OZ: '5 oz Recognized Silver Bar',
  SBAR_10OZ: '10 oz Recognized Silver Bar',
  SBAR_10OZ_RCM: '10 oz RCM (Royal Canadian Mint) Silver Bar',
  SBAR_50OZ: '50 oz Recognized Silver Bar',
  SBAR_100OZ: '100 oz Recognized Silver Bar',
  SBAR_100OZ_RCM: '100 oz RCM (Royal Canadian Mint) Silver Bar',
  SBAR_1KG: '1 kg Recognized Silver Bar',
  SEAGLE: '1 oz Silver Eagle Coin',
  SILVER_COINS: 'Recognized Silver Bullion Coins',
  SILVER_UNREC: 'Unrecognized Silver Bar',
  PT_BAR: '1 oz Recognized Platinum Bar',
  PT_MAPLE: '1 oz Platinum Maple Leaf Coin',
  PT_UNREC: 'Unrecognized Platinum Bar',
  PD_MAPLE: '1 oz Palladium Maple Leaf Coin',
  PD_BAR: 'Recognized Palladium Bar',
  PD_UNREC: 'Unrecognized Palladium Bar',
};

function normalizeLabel(label) {
  return String(label || '')
    .toLowerCase()
    .replace(/\(|\)/g, ' ')
    .replace(/\bgrams?\b/g, 'g')
    .replace(/\bgms?\b/g, 'g')
    .replace(/\bkilos?\b/g, 'kg')
    .replace(/\bounces?\b/g, 'oz')
    .replace(/(\d)\s+(oz|g|kg)\b/g, '$1$2')
    .replace(/non[\s-]*(dna|rcm)/g, 'non-$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Size in troy ounces from "1/4oz", "2.5g", "1kg", "10oz". null when absent. */
function sizeOz(text) {
  const frac = text.match(/\b1\/(2|4|10|20)\s*(?:oz)?\b/);
  if (frac) return 1 / Number(frac[1]);
  const m = text.match(/\b(\d+(?:\.\d+)?)(oz|g|kg)\b/);
  if (!m) return null;
  const n = Number(m[1]);
  if (m[2] === 'oz') return n;
  if (m[2] === 'kg') return (n * 1000) / GRAMS_PER_TROY_OZ;
  return n / GRAMS_PER_TROY_OZ;
}

function sizeGrams(text) {
  const m = text.match(/\b(\d+(?:\.\d+)?)(g|kg)\b/);
  if (!m) return null;
  return m[2] === 'kg' ? Number(m[1]) * 1000 : Number(m[1]);
}

function has(text, re) {
  return re.test(text);
}

const PER_OZ = { unit: '/oz', factor: 1, derived: false, sell: false };
const PER_G = { unit: '/g', factor: 1 / GRAMS_PER_TROY_OZ, derived: true, sell: false };

/**
 * Pick the website product for a POS label.
 * Returns { name, factor, unit, derived, sell } or null.
 *  - factor scales the website unit price (N× for multiples, grams for per-gram rates)
 *  - sell=false means only the buy side is shown (website lists no sell price)
 */
function resolveRule(label) {
  const t = normalizeLabel(label);
  if (!t) return null;
  const oz = sizeOz(t);
  const grams = sizeGrams(t);
  const nonDna = has(t, /non-dna/);
  const nonRcm = has(t, /non-rcm|generic/);
  const rcm = !nonRcm && has(t, /\brcm\b/);
  const byGram = has(t, /by gram|\bby g\b|per gram/);
  const byOz = has(t, /by oz|per oz/);
  const other = has(t, /\bother\b/);

  // "Other … bullion" catch-all buckets (priced per oz / per gram on the website)
  if (other || byGram || byOz) {
    const perG = byGram;
    if (has(t, /gold|\bgb\b/)) return { name: W.GOLD_UNREC, ...(perG ? PER_G : PER_OZ) };
    if (has(t, /silver|\bsb\b/)) return { name: W.SILVER_UNREC, ...(perG ? PER_G : PER_OZ) };
    if (has(t, /plat/)) return { name: W.PT_UNREC, ...(perG ? PER_G : PER_OZ) };
    if (has(t, /pallad/)) return { name: W.PD_UNREC, ...(perG ? PER_G : PER_OZ) };
    return null;
  }

  // Palladium
  if (has(t, /pallad/)) {
    if (has(t, /maple|\bml\b/)) return { name: W.PD_MAPLE, factor: 1, unit: '', derived: false, sell: false };
    if (has(t, /bar/)) return { name: W.PD_BAR, factor: 1, unit: '', derived: false, sell: false };
    return null;
  }

  // Platinum
  if (has(t, /\bplat(inum)?\b|platbar|platmaple/)) {
    if (has(t, /bar/)) return { name: W.PT_BAR, factor: 1, unit: '', derived: false, sell: true };
    if (oz != null && oz < 1) return { name: W.PT_MAPLE, factor: oz, unit: '', derived: true, sell: false };
    return { name: W.PT_MAPLE, factor: 1, unit: '', derived: false, sell: true };
  }
  // "RCM 1/2 oz" sits with the platinum maples in the POS catalog.
  if (has(t, /^rcm\b/) && oz === 0.5) {
    return { name: W.PT_MAPLE, factor: 0.5, unit: '', derived: true, sell: false };
  }

  // Gold maples
  if (has(t, /\bgml\b|gold maple|maplegram/)) {
    if (has(t, /\b999\b|damaged/)) return { name: W.GML_999, factor: 1, unit: '', derived: false, sell: false };
    if (has(t, /maplegram/) || grams === 1) return { name: W.MAPLEGRAM, factor: 1, unit: '', derived: false, sell: true };
    if (oz === 0.5) return { name: W.GML_HALF, factor: 1, unit: '', derived: false, sell: true };
    if (oz === 0.25) return { name: W.GML_QUARTER, factor: 1, unit: '', derived: false, sell: true };
    if (oz === 0.1) return { name: W.GML_TENTH, factor: 1, unit: '', derived: false, sell: true };
    if (oz === 0.05) {
      return { name: W.GML_UNDER_1OZ, factor: GRAMS_PER_TROY_OZ / 20, unit: '', derived: true, sell: false };
    }
    const base = !nonDna && has(t, /\bdna\b/) ? W.GML_DNA : W.GML_STD;
    if (oz != null && oz > 1) return { name: base, factor: oz, unit: '', derived: true, sell: true };
    return { name: base, factor: 1, unit: '', derived: false, sell: true };
  }

  // Gold bars
  if (has(t, /\bgbar\b|gold bar/)) {
    if (oz === 1) {
      const uncarded = has(t, /uncarded|unsealed/);
      return { name: uncarded ? W.GBAR_1OZ_UNCARDED : W.GBAR_1OZ_CARDED, factor: 1, unit: '', derived: false, sell: true };
    }
    if (grams === 5) return { name: W.GBAR_5G, factor: 1, unit: '', derived: false, sell: true };
    if (grams === 10) return { name: W.GBAR_10G, factor: 1, unit: '', derived: false, sell: true };
    if (oz === 5) return { name: W.GBAR_5OZ, factor: 1, unit: '', derived: false, sell: false };
    if (oz === 10) return { name: W.GBAR_10OZ, factor: 1, unit: '', derived: false, sell: false };
    return null;
  }

  // Silver eagles
  if (has(t, /eagle|\bse\b/) && !has(t, /gold/)) {
    return { name: W.SEAGLE, factor: 1, unit: '', derived: false, sell: true };
  }

  // Silver maples (incl. 1.5 oz RCM coin)
  if (has(t, /\bsml\b|silver maple|silver 1\.5oz rcm/)) {
    if (has(t, /tarnish|scrap/)) return { name: W.SILVER_COINS, factor: 1, unit: '', derived: false, sell: false };
    const base = !nonDna && has(t, /\bdna\b/) ? W.SML_DNA : W.SML_STD;
    if (oz != null && oz > 1) return { name: base, factor: oz, unit: '', derived: true, sell: true };
    return { name: base, factor: 1, unit: '', derived: false, sell: true };
  }

  // Silver bars (and bar/round combos, Beaver Bullion)
  const silverBar = has(t, /\bsbar\b|silver bar|beaver/);
  const silverRound = has(t, /round/);
  if (silverBar || silverRound) {
    if (silverBar) {
      if (rcm && oz === 10) return { name: W.SBAR_10OZ_RCM, factor: 1, unit: '', derived: false, sell: true };
      if (rcm && oz === 100) return { name: W.SBAR_100OZ_RCM, factor: 1, unit: '', derived: false, sell: true };
      if (grams === 1000) return { name: W.SBAR_1KG, factor: 1, unit: '', derived: false, sell: true };
      if (oz === 1) return { name: W.SBAR_1OZ, factor: 1, unit: '', derived: false, sell: true };
      if (oz === 5) return { name: W.SBAR_5OZ, factor: 1, unit: '', derived: false, sell: false };
      if (oz === 10) return { name: W.SBAR_10OZ, factor: 1, unit: '', derived: false, sell: true };
      if (oz === 50) return { name: W.SBAR_50OZ, factor: 1, unit: '', derived: false, sell: false };
      if (oz === 100) return { name: W.SBAR_100OZ, factor: 1, unit: '', derived: false, sell: true };
    }
    // Sizes the website does not list (2 oz): N × the 1 oz bar or round.
    const base = silverBar && !silverRound ? W.SBAR_1OZ : W.SROUND;
    if (oz != null && oz !== 1) return { name: base, factor: oz, unit: '', derived: true, sell: true };
    return { name: base, factor: 1, unit: '', derived: false, sell: true };
  }

  return null;
}

function formatMoney(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return '';
  return `$${n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

function buildIndex(catalog) {
  const byKey = new Map();
  for (const entry of catalogEntries(catalog)) {
    if (!entry?.key || byKey.has(entry.key)) continue;
    byKey.set(entry.key, entry);
  }
  return byKey;
}

const indexCache = new WeakMap();
function indexFor(catalog) {
  if (!catalog || typeof catalog !== 'object') return new Map();
  let index = indexCache.get(catalog);
  if (!index) {
    index = buildIndex(catalog);
    indexCache.set(catalog, index);
  }
  return index;
}

const EMPTY = Object.freeze({
  buyAmount: null,
  sellAmount: null,
  buyLabel: '',
  sellLabel: '',
  websiteName: '',
  derived: false,
  metal: '',
  oz: null,
  unit: '',
});

const EMPTY_SIDE = Object.freeze({
  dollars: null,
  percent: null,
  dollarLabel: '',
  percentLabel: '',
  label: '',
});

const EMPTY_SPREADS = Object.freeze({
  spotAmount: null,
  spotLabel: '',
  metal: '',
  buy: EMPTY_SIDE,
  sell: EMPTY_SIDE,
  spread: EMPTY_SIDE,
});

const LIVE_SYMBOL = {
  gold: 'XAU',
  silver: 'XAG',
  platinum: 'XPT',
  palladium: 'XPD',
};

function inferMetal(name) {
  const t = String(name || '').toLowerCase();
  if (t.includes('pallad')) return 'palladium';
  if (t.includes('plat')) return 'platinum';
  if (t.includes('silver') || /\bsml\b|\bsbar\b|\bsround\b/.test(t)) return 'silver';
  if (t.includes('gold') || /\bgml\b|\bgbar\b|maplegram/.test(t)) return 'gold';
  return '';
}

function inferOz(rule) {
  if (!rule) return null;
  if (rule.unit === '/g') return 1 / GRAMS_PER_TROY_OZ;
  if (rule.unit === '/oz') return 1;
  const name = normalizeLabel(rule.name);
  if (/maplegram/.test(name)) return 1 / GRAMS_PER_TROY_OZ;
  const grams = sizeGrams(name);
  if (grams) return grams / GRAMS_PER_TROY_OZ;
  const oz = sizeOz(name);
  if (oz) return rule.derived && rule.factor && oz === 1 ? oz * rule.factor : oz;
  if (rule.derived && rule.factor > 1 && /under 1 oz/.test(name)) {
    return rule.factor / GRAMS_PER_TROY_OZ;
  }
  if (rule.factor && rule.factor !== 1 && !rule.unit) return rule.factor;
  return 1;
}

function annotateRule(rule) {
  if (!rule) return null;
  return {
    ...rule,
    metal: inferMetal(rule.name),
    oz: inferOz(rule),
  };
}

function metalKey(value) {
  const t = String(value || '').toLowerCase();
  if (t.includes('pallad')) return 'palladium';
  if (t.includes('plat')) return 'platinum';
  if (t.includes('silver')) return 'silver';
  if (t.includes('gold')) return 'gold';
  return '';
}

function spotsToPerOz(spots) {
  const map = {};
  for (const row of spots || []) {
    const metal = metalKey(row.metal);
    const amount = parseMoney(row.price);
    if (!metal || amount == null) continue;
    map[metal] = /\/\s*g\b/i.test(String(row.price || ''))
      ? amount * GRAMS_PER_TROY_OZ
      : amount;
  }
  return map;
}

export function catalogSpotPerOz(catalog, metal) {
  const key = metalKey(metal) || String(metal || '').toLowerCase();
  if (!key) return null;
  const sell = spotsToPerOz(catalog?.sell?.spots);
  if (sell[key] != null) return sell[key];
  const buy = spotsToPerOz(catalog?.buy?.spots);
  return buy[key] ?? null;
}

function liveSpotCadPerOz(metal, quotes, usdCadRate) {
  const symbol = LIVE_SYMBOL[metal];
  const quote = (quotes || []).find((row) => row.symbol === symbol);
  const usd = Number(quote?.price);
  const rate = Number(usdCadRate);
  if (!Number.isFinite(usd) || usd <= 0 || !Number.isFinite(rate) || rate <= 0) return null;
  return usd * rate;
}

function signedMoney(amount, unit = '') {
  if (!Number.isFinite(amount)) return '';
  const sign = amount > 0 ? '+' : amount < 0 ? '−' : '';
  return `${sign}${formatMoney(Math.abs(amount))}${unit}`;
}

function signedPercent(amount) {
  if (!Number.isFinite(amount)) return '';
  const sign = amount > 0 ? '+' : amount < 0 ? '−' : '';
  return `${sign}${Math.abs(amount).toFixed(2)}%`;
}

function vsSpot(price, spot, unit = '') {
  if (price == null || !Number.isFinite(price) || !Number.isFinite(spot) || spot === 0) {
    return EMPTY_SIDE;
  }
  const dollars = price - spot;
  const percent = (dollars / spot) * 100;
  const dollarLabel = signedMoney(dollars, unit);
  const percentLabel = signedPercent(percent);
  return {
    dollars,
    percent,
    dollarLabel,
    percentLabel,
    label: `${dollarLabel} · ${percentLabel}`,
  };
}

function vsEachOther(buy, sell, unit = '') {
  if (buy == null || sell == null || !Number.isFinite(buy) || !Number.isFinite(sell)) {
    return EMPTY_SIDE;
  }
  const dollars = sell - buy;
  const percent = buy === 0 ? null : (dollars / buy) * 100;
  const dollarLabel = signedMoney(dollars, unit);
  const percentLabel = percent == null ? '' : signedPercent(percent);
  return {
    dollars,
    percent,
    dollarLabel,
    percentLabel,
    label: [dollarLabel, percentLabel].filter(Boolean).join(' · '),
  };
}

/**
 * Buy/sell versus website (or live) spot, in the same unit as the listed price.
 * Buy is usually under spot; sell is usually over.
 */
export function inventoryPriceSpreads(price, catalog, live = {}) {
  const metal = price?.metal || '';
  const oz = Number(price?.oz);
  if (!metal || !Number.isFinite(oz) || oz <= 0) return EMPTY_SPREADS;
  const spotPerOz =
    catalogSpotPerOz(catalog, metal) ??
    liveSpotCadPerOz(metal, live.quotes, live.usdCadRate);
  if (spotPerOz == null) return EMPTY_SPREADS;
  const spotAmount = spotPerOz * oz;
  const unit = price.unit || '';
  return {
    spotAmount,
    spotLabel: `${formatMoney(spotAmount)}${unit}`,
    metal,
    buy: vsSpot(price.buyAmount, spotAmount, unit),
    sell: vsSpot(price.sellAmount, spotAmount, unit),
    spread: vsEachOther(price.buyAmount, price.sellAmount, unit),
  };
}

/**
 * Website prices for one POS inventory product.
 * Returns { buyAmount, sellAmount, buyLabel, sellLabel, websiteName, derived }.
 * Labels are always "$1,234.56" (+ "/oz" or "/g" for by-weight buckets).
 */
export function inventoryWebsitePrice(label, catalog) {
  const rule = annotateRule(resolveRule(label));
  if (!rule) return EMPTY;
  const entry = indexFor(catalog).get(itemMatchKey(rule.name));
  if (!entry) return EMPTY;

  const buyAmount = entry.buyAmount != null ? entry.buyAmount * rule.factor : null;
  const firstTier = (entry.sellTiers || []).find((tier) => tier.amount != null) || null;
  const sellAmount = rule.sell && firstTier ? firstTier.amount * rule.factor : null;

  return {
    buyAmount,
    sellAmount,
    buyLabel: buyAmount != null ? `${formatMoney(buyAmount)}${rule.unit}` : '',
    sellLabel: sellAmount != null ? `${formatMoney(sellAmount)}${rule.unit}` : '',
    websiteName: entry.name || rule.name,
    derived: Boolean(rule.derived),
    metal: rule.metal,
    oz: rule.oz,
    unit: rule.unit || '',
  };
}

const NAME_WORDS = {
  gbar: 'Gold Bar',
  sbar: 'Silver Bar',
  gml: 'Gold Maple Leaf',
  sml: 'Silver Maple Leaf',
  sround: 'Silver Round',
  seagle: 'Silver Eagle',
  se: 'Silver Eagle',
  gb: 'Gold Bullion',
  sb: 'Silver Bullion',
  ml: 'Maple Leaf',
  rcm: 'RCM',
  dna: 'DNA',
  'non-dna': 'Non-DNA',
  nondna: 'Non-DNA',
  'non-rcm': 'Non-RCM',
  nonrcm: 'Non-RCM',
  plat: 'Platinum',
  pt: 'Platinum',
  platbar: 'Platinum Bar',
  platmaple: 'Platinum Maple Leaf',
  pd: 'Palladium',
  pall: 'Palladium',
  pdbar: 'Palladium Bar',
  pdmaple: 'Palladium Maple Leaf',
  pamp: 'PAMP',
  oz: 'oz',
  g: 'g',
  kg: 'kg',
  dwt: 'dwt',
};

const SIZE_WORD = /^(\d+(?:\.\d+)?(?:\/\d+)?)(oz|g|kg|dwt)?$/i;

function expandNameWord(word) {
  const raw = String(word || '').trim();
  if (!raw) return '';
  if (SIZE_WORD.test(raw)) return raw.toLowerCase();
  const key = raw.toLowerCase().replace(/[()]/g, '');
  if (NAME_WORDS[key]) return NAME_WORDS[key];
  if (/^[A-Z0-9]+$/.test(raw) && raw.length <= 4) return raw;
  return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
}

/**
 * Long-form title for a POS bullion label: "GBAR 1oz carded" → "Gold Bar 1oz Carded".
 * Unknown words are title-cased; sizes and short acronyms are left alone.
 */
export function inventoryDisplayName(label) {
  const text = String(label || '')
    .replace(/\s+/g, ' ')
    .replace(/non\s*-\s*(dna|rcm)/gi, 'non-$1')
    .replace(/(\d)\s+(oz|g|kg|dwt)\b/gi, '$1$2')
    .trim();
  if (!text) return '';
  return text
    .split(' ')
    .map((word) =>
      word.includes('/') && !SIZE_WORD.test(word)
        ? word.split('/').map(expandNameWord).join(' / ')
        : expandNameWord(word),
    )
    .filter(Boolean)
    .join(' ');
}

/** Resolve by product name, then SKU, so either POS field can carry the label. */
export function inventoryRowWebsitePrice(row, catalog) {
  const byName = inventoryWebsitePrice(row?.name, catalog);
  if (byName.buyLabel || byName.sellLabel) return byName;
  if (row?.sku && row.sku !== row.name) return inventoryWebsitePrice(row.sku, catalog);
  return byName;
}
