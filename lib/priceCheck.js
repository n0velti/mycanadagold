import { textMatchesQuery } from './itemSearch';
import { itemMatchKey } from './websitePrices';

export const PRICE_TOLERANCE = 0.01;

const GRAMS_PER_TROY_OZ = 31.1034768;
const GOLD_KARATS = [24, 22, 21, 18, 14, 10, 9];
const KARAT_PURITIES = [
  { purity: 99.9, karat: 24 },
  { purity: 91.6, karat: 22 },
  { purity: 87.5, karat: 21 },
  { purity: 75.0, karat: 18 },
  { purity: 58.5, karat: 14 },
  { purity: 41.7, karat: 10 },
  { purity: 37.5, karat: 9 },
];
const BULLION_NAME_RE =
  /\b(gml|sml|maplegram|maple leaf|gold maple|silver maple|eagle|buffalo|krugerrand|pamp|britannia|panda|sovereign)\b/i;
const BULLION_WEIGHT_RE = /\b(?:1\/20|1\/10|1\/4|1\/2|\d+(?:\.\d+)?)\s*oz\b/i;
const SCRAP_HINT_RE =
  /\b(scrap|jewellery|jewelry|gold filled|sterling|flatware|mexican silver)\b/i;
const KARAT_RE = /\b(24|22|21|18|14|10|9)\s*[-]?\s*k(?:t|arat)?s?\b/i;

export function parseMoney(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const n = Number(String(value).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

export function withinPriceTolerance(actual, expected, tolerance = PRICE_TOLERANCE) {
  const a = Number(actual);
  const e = Number(expected);
  if (!Number.isFinite(a) || !Number.isFinite(e) || e === 0) return false;
  return Math.abs(a - e) / Math.abs(e) <= tolerance;
}

export function tierFitsQuantity(label, quantity) {
  const qty = Number(quantity);
  if (!Number.isFinite(qty) || qty <= 0) return true;
  const text = String(label || '').toLowerCase();
  const upTo = text.match(/up\s*to\s*(\d+)/);
  if (upTo) return qty <= Number(upTo[1]);
  const range = text.match(/(\d+)\s*[-–to]+\s*(\d+)/);
  if (range) return qty >= Number(range[1]) && qty <= Number(range[2]);
  const plus = text.match(/(\d+)\s*\+/);
  if (plus) return qty >= Number(plus[1]);
  return true;
}

function jewelleryGroup(group) {
  const value = String(group || '');
  return /premium jewellery/i.test(value) || value === 'Jewellery' || /jewellery|jewelry/i.test(value);
}

function parseJewelleryCatalogItem(name, group) {
  if (!jewelleryGroup(group)) return null;
  const title = String(name || '');
  const lower = title.toLowerCase();
  const karatMatch = title.match(/\b(\d{1,2})\s*kt\b/i);
  const karat = karatMatch ? Number(karatMatch[1]) : null;
  const goldFilled = /gold filled/i.test(lower);
  let metal = null;
  let silverKind = null;
  let platinumKind = null;

  if (/platinum/i.test(lower)) {
    metal = 'platinum';
    if (/\b999\b/.test(title)) platinumKind = '999';
    else if (/\b950\b/.test(title)) platinumKind = '950';
  } else if (/silver|sterling|mexican/i.test(lower)) {
    metal = 'silver';
    if (/mexican/i.test(lower)) silverKind = 'mexican';
    else if (/flatware/i.test(lower)) silverKind = 'flatware';
    else silverKind = 'jewellery';
  } else if (goldFilled || karat != null || /gold/i.test(lower) || /jewellery/i.test(String(group || ''))) {
    metal = 'gold';
  }

  if (!metal) return null;
  return {
    metal,
    karat: GOLD_KARATS.includes(karat) ? karat : null,
    premium: metal === 'gold' && !goldFilled && /premium/i.test(`${title} ${group}`),
    goldFilled,
    silverKind,
    platinumKind,
  };
}

function flattenCatalog(catalog) {
  const byKey = new Map();

  const upsert = (name, patch) => {
    const key = itemMatchKey(name);
    const current = byKey.get(key) || {
      key,
      name,
      buyAmount: null,
      buyLabel: '',
      sellTiers: [],
      jewellery: null,
      spot: false,
    };
    byKey.set(key, {
      ...current,
      ...patch,
      name: patch.name || current.name,
      sellTiers: patch.sellTiers?.length ? patch.sellTiers : current.sellTiers,
      buyAmount: patch.buyAmount != null ? patch.buyAmount : current.buyAmount,
      buyLabel: patch.buyLabel || current.buyLabel,
      jewellery: patch.jewellery || current.jewellery,
      spot: patch.spot || current.spot,
    });
  };

  for (const section of catalog?.buy?.sections || []) {
    const group = section.group || section.title || '';
    const spot = /spot/i.test(group);
    for (const item of section.items || []) {
      upsert(item.name, {
        name: item.name,
        buyAmount: parseMoney(item.price),
        buyLabel: item.price,
        jewellery: parseJewelleryCatalogItem(item.name, group),
        spot,
      });
    }
  }

  for (const section of catalog?.sell?.sections || []) {
    for (const item of section.items || []) {
      upsert(item.name, {
        name: item.name,
        buyAmount: parseMoney(item.buyPrice),
        buyLabel: item.buyPrice,
        sellTiers: (item.tiers || [])
          .map((tier) => ({
            label: tier.label,
            labelText: `${tier.label}: ${tier.price}`,
            amount: parseMoney(tier.price),
          }))
          .filter((tier) => tier.amount != null),
      });
    }
  }

  return expandMapleMultiples(
    [...byKey.values()].filter((entry) => entry.buyAmount != null || entry.sellTiers.length),
  );
}

function ounceSize(name) {
  const text = String(name || '');
  if (/maplegram/i.test(text)) return 0;
  const oz = text.match(/\b(\d+(?:\.\d+)?)\s*oz\b/i);
  if (oz) return Number(oz[1]);
  return null;
}

function isOneOzMapleLeaf(name) {
  const text = String(name || '');
  if (/maplegram/i.test(text) || /under\s*1\s*oz/i.test(text)) return false;
  if (!/maple leaf|\bsml\b|\bgml\b/i.test(text)) return false;
  const oz = ounceSize(text);
  return oz == null || oz === 1;
}

function scaleMoneyLabel(label, factor) {
  const text = String(label || '');
  if (!text) return '';
  return text.replace(/\$[\d,]+(?:\.\d+)?/g, (match) => {
    const n = parseMoney(match);
    if (n == null) return match;
    return `$${n * factor === Math.round(n * factor) ? (n * factor).toLocaleString('en-US') : (n * factor).toFixed(2)}`;
  });
}

/** 2oz SML/GML are not on the website tables — they are N × the 1oz maple price. */
function expandMapleMultiples(entries) {
  const extras = [];
  for (const entry of entries) {
    if (!isOneOzMapleLeaf(entry.name)) continue;
    for (const ounces of [2, 5, 10]) {
      const factor = ounces;
      const baseName = String(entry.name).replace(/^1\s*oz\s*/i, '');
      extras.push({
        ...entry,
        key: `${entry.key}::${ounces}oz`,
        name: `${ounces} oz ${baseName}`,
        buyAmount: entry.buyAmount != null ? entry.buyAmount * factor : null,
        buyLabel: entry.buyLabel ? `${scaleMoneyLabel(entry.buyLabel, factor)} (${ounces}× 1oz)` : '',
        sellTiers: (entry.sellTiers || []).map((tier) => ({
          ...tier,
          amount: tier.amount != null ? tier.amount * factor : null,
          labelText: `${tier.label}: ${scaleMoneyLabel(tier.labelText.replace(/^[^:]+:\s*/, ''), factor)} (${ounces}× 1oz)`,
        })),
      });
    }
  }
  return extras.length ? [...entries, ...extras] : entries;
}

function hasToken(name, token) {
  return new RegExp(`\\b${token}\\b`, 'i').test(String(name || ''));
}

function hasNonRcmToken(name) {
  return /non[\s-]*rcm|\bnonrcm\b|\bgeneric\b/i.test(String(name || ''));
}

function hasRcmToken(name) {
  const text = String(name || '');
  if (hasNonRcmToken(text)) return false;
  return /\brcm\b|royal canadian mint/i.test(text);
}

function isByOunceLine(name) {
  return /by\s*(ounces?|oz)\b|other\s+(gold|silver|platinum|palladium)\s+bullion/i.test(
    String(name || ''),
  );
}

function scoreCatalogMatch(lineName, entry) {
  const query = String(lineName || '').trim();
  const hay = String(entry.name || '');
  if (!query || !hay) return 0;
  if (/\bscrap\b/i.test(query)) return 0;
  if (hasNonRcmToken(query) && hasRcmToken(hay)) return 0;
  if (hasRcmToken(query) && hasNonRcmToken(hay)) return 0;
  const queryOz = ounceSize(query);
  const hayOz = ounceSize(hay);
  if (queryOz != null && hayOz != null && queryOz !== hayOz) return 0;
  if (queryOz != null && queryOz !== 1 && /maplegram/i.test(hay)) return 0;
  if (/maplegram/i.test(query) && hayOz != null && hayOz !== 0) return 0;
  if (queryOz != null && queryOz !== 1 && hayOz == null && isOneOzMapleLeaf(hay)) return 0;
  if (
    isByOunceLine(query) &&
    /maple|eagle|buffalo|panda|sovereign|krugerrand|maplegram|\bcoin\b/i.test(hay) &&
    !/unrecognized|other gold|other silver/i.test(hay)
  ) {
    return 0;
  }
  const matches = textMatchesQuery(hay, query) || textMatchesQuery(query, hay);
  if (!matches && itemMatchKey(query) !== itemMatchKey(hay)) return 0;

  let score = matches ? 4 : 1;
  if (itemMatchKey(query) === itemMatchKey(hay)) score += 8;
  if (hay.toLowerCase() === query.toLowerCase()) score += 6;
  if (hasNonRcmToken(query) && /\brecognized\b|\bstandard\b/i.test(hay)) score += 5;
  if (hasRcmToken(query) && hasRcmToken(hay)) score += 5;
  if (isByOunceLine(query) && /unrecognized/i.test(hay)) score += 8;

  for (const token of ['dna', 'uncarded', 'carded', 'standard', 'premium', 'damaged', '1/2', '1/4', '1/10']) {
    if (hasToken(query, token) && hasToken(hay, token)) score += 3;
    else if (hasToken(query, token) && !hasToken(hay, token)) score -= 2;
  }
  return score;
}

function bestMatches(lineName, entries) {
  const scored = entries
    .map((entry) => ({ entry, score: scoreCatalogMatch(lineName, entry) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score);
  if (!scored.length) return [];
  const top = scored[0].score;
  return scored.filter((row) => row.score >= top - 2).map((row) => row.entry);
}

function sellForQuantity(entry, quantity) {
  const tiers = entry?.sellTiers || [];
  if (!tiers.length) return null;
  return tiers.find((tier) => tierFitsQuantity(tier.label, quantity)) || tiers[tiers.length - 1];
}

function closestAmount(actual, amounts) {
  const a = Number(actual);
  let best = null;
  for (const amount of amounts) {
    if (amount == null) continue;
    const delta = Math.abs(a - amount);
    if (!best || delta < best.delta) best = { amount, delta };
  }
  return best;
}

function lineSearch(line) {
  return [line?.name, line?.searchText, line?.quality, line?.productType, line?.metal]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join(' ');
}

function isNamedBullionProduct(line) {
  const text = lineSearch(line);
  if (BULLION_NAME_RE.test(text)) return true;
  if (BULLION_WEIGHT_RE.test(text) && /\b(bar|round|coin|maple)\b/i.test(text)) return true;
  return false;
}

function isBullionNamed(line) {
  if (isNamedBullionProduct(line)) return true;
  const type = String(line?.productType || '').toLowerCase();
  return type === 'bullion' || type === 'coin' || type === 'bar';
}

function looksLikeScrap(line) {
  const type = String(line?.productType || '').toLowerCase();
  if (type === 'scrap' || type === 'jewellery' || type === 'jewelry') return true;
  const text = lineSearch(line);
  if (SCRAP_HINT_RE.test(text) || KARAT_RE.test(text)) return true;
  return false;
}

export function isScrapJewelleryLine(line) {
  if (!line) return false;
  if (isNamedBullionProduct(line)) return false;
  return looksLikeScrap(line);
}

function karatFromText(text) {
  const match = String(text || '').match(KARAT_RE);
  return match ? Number(match[1]) : null;
}

function karatFromPurity(purity) {
  if (purity == null || purity === '') return null;
  let n = Number(purity);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n > 0 && n <= 1) n *= 100;
  if (GOLD_KARATS.includes(n)) return n;
  let best = null;
  for (const row of KARAT_PURITIES) {
    const delta = Math.abs(n - row.purity);
    if (delta <= 2 && (!best || delta < best.delta)) best = { karat: row.karat, delta };
  }
  return best?.karat ?? null;
}

function metalFromLine(line) {
  const field = String(line?.metal || '').toLowerCase();
  if (field.includes('platinum')) return 'platinum';
  if (field.includes('silver')) return 'silver';
  if (field.includes('gold')) return 'gold';
  const text = lineSearch(line).toLowerCase();
  if (/\bplatinum\b|\bpt\b/.test(text)) return 'platinum';
  if (/\bsilver\b|\bsterling\b|\bmexican\b|\b925\b/.test(text)) return 'silver';
  if (/\bgold\b|\bau\b|gold filled/.test(text) || KARAT_RE.test(text)) return 'gold';
  return null;
}

function silverKindFromLine(text) {
  const value = String(text || '').toLowerCase();
  if (/mexican/.test(value)) return 'mexican';
  if (/flatware|cutlery|utensil|\bspoon\b|\bfork\b/.test(value)) return 'flatware';
  if (/\bsterling\b|\b925\b|silver jewellery|silver jewelry/.test(value)) return 'jewellery';
  return null;
}

function platinumKindFromLine(text) {
  const value = String(text || '');
  if (/\b999\b|\.999\b|99\.9/.test(value)) return '999';
  if (/\b950\b|\.950\b|95\s*%/.test(value)) return '950';
  return null;
}

function isGramUnit(unit) {
  const u = String(unit || '')
    .trim()
    .toLowerCase()
    .replace(/\./g, '');
  return !u || u === 'g' || u === 'gram' || u === 'grams' || u === 'gm';
}

function isCountUnit(unit) {
  const u = String(unit || '')
    .trim()
    .toLowerCase()
    .replace(/\./g, '');
  return ['pcs', 'pc', 'ea', 'each', 'unit', 'units', 'item', 'items'].includes(u);
}

function gramsFromUnit(amount, unit) {
  if (amount == null || !Number.isFinite(amount) || amount <= 0) return null;
  const u = String(unit || '')
    .trim()
    .toLowerCase()
    .replace(/\./g, '');
  if (isGramUnit(u)) return amount;
  if (u === 'kg' || u === 'kilogram' || u === 'kilograms') return amount * 1000;
  if (['oz', 'ozt', 'troy', 'troyoz', 'troyounce', 'troyounces', 'ounce', 'ounces'].includes(u)) {
    return amount * GRAMS_PER_TROY_OZ;
  }
  if (u === 'dwt' || u === 'pennyweight' || u === 'pennyweights') {
    return amount * (GRAMS_PER_TROY_OZ / 20);
  }
  if (isCountUnit(u)) return null;
  return amount;
}

export function weightGramsFromLine(line, { allowQuantity = false } = {}) {
  const unit = line?.unitType || '';
  const fromWeight = gramsFromUnit(Number(line?.weight), unit);
  if (fromWeight != null) return fromWeight;
  const type = String(line?.productType || '').toLowerCase();
  if (!allowQuantity && (type === 'scrap' || type === 'jewellery' || type === 'jewelry')) return null;
  const qty = Number(line?.quantity);
  if (!(qty > 0) || isCountUnit(unit)) return null;
  const fromQty = gramsFromUnit(qty, unit);
  if (fromQty != null) return fromQty;
  if (isGramUnit(unit)) return qty;
  if (!unit && qty === 1) return null;
  return qty;
}

function scrapMetaFromLine(line) {
  const text = lineSearch(line);
  const metal = metalFromLine(line);
  const namedKarat = karatFromText(text);
  const karat =
    namedKarat ??
    (KARAT_RE.test(text) || /jewellery|jewelry/i.test(text) ? karatFromPurity(line?.purity) : null);
  const premium = Boolean(line?.premium) || /\bpremium\b/i.test(text);
  return {
    name: String(line?.name || '').trim(),
    metal,
    karat,
    premium: metal === 'gold' ? premium : false,
    goldFilled: /gold filled/i.test(text),
    silverKind: metal === 'silver' ? silverKindFromLine(text) : null,
    platinumKind: metal === 'platinum' ? platinumKindFromLine(text) : null,
    weightGrams: weightGramsFromLine(line),
  };
}

function jewelleryTierLabel(meta, entry) {
  const jewel = entry?.jewellery || {};
  if (jewel.goldFilled || meta?.goldFilled) return 'gold filled';
  if (jewel.metal === 'silver') {
    if (jewel.silverKind === 'flatware') return 'sterling flatware';
    if (jewel.silverKind === 'mexican') return 'Mexican silver';
    return 'sterling jewellery';
  }
  if (jewel.metal === 'platinum') return `${jewel.platinumKind || ''} platinum`.trim();
  const karat = jewel.karat || meta?.karat;
  const tier = jewel.premium ? 'premium' : 'standard';
  return karat ? `${tier} ${karat}kt` : tier;
}

function matchJewelleryEntry(meta, entries) {
  const jewellery = entries.filter((entry) => entry.jewellery && entry.buyAmount != null);
  if (meta.goldFilled) {
    return jewellery.find((entry) => entry.jewellery.goldFilled) || null;
  }
  if (meta.metal === 'silver') {
    if (!meta.silverKind) return null;
    return (
      jewellery.find((entry) => entry.jewellery.metal === 'silver' && entry.jewellery.silverKind === meta.silverKind) ||
      null
    );
  }
  if (meta.metal === 'platinum') {
    if (!meta.platinumKind) return null;
    return jewellery.find((entry) => entry.jewellery.platinumKind === meta.platinumKind) || null;
  }
  if (meta.metal === 'gold' && meta.karat) {
    return (
      jewellery.find(
        (entry) =>
          entry.jewellery.metal === 'gold' &&
          entry.jewellery.karat === meta.karat &&
          Boolean(entry.jewellery.premium) === Boolean(meta.premium) &&
          !entry.jewellery.goldFilled,
      ) || null
    );
  }
  return null;
}

function enteredScrapTotal(line, weightGrams, rate) {
  const lineTotal = Number(line?.lineTotal);
  if (Number.isFinite(lineTotal) && lineTotal > 0) return lineTotal;
  const unitPrice = Number(line?.unitPrice);
  if (!Number.isFinite(unitPrice) || unitPrice <= 0) return null;
  if (withinPriceTolerance(unitPrice, rate) || unitPrice < rate * 4) return unitPrice * weightGrams;
  if (withinPriceTolerance(unitPrice, rate * weightGrams)) return unitPrice;
  const qty = Number(line?.quantity);
  if (qty > 0 && Math.abs(qty - weightGrams) / weightGrams <= 0.05) return unitPrice * qty;
  return unitPrice * weightGrams;
}

function scrapResult(patch) {
  return {
    kind: 'scrap',
    quantity: patch.weightGrams ?? patch.quantity,
    actual: patch.actualTotal ?? patch.actual,
    ...patch,
  };
}

function silverGramEntries(catalogEntries) {
  return catalogEntries.filter((entry) => {
    if (entry.spot || entry.buyAmount == null) return false;
    const label = String(entry.buyLabel || '');
    if (!/\/g/i.test(label)) return false;
    return /silver|sterling|mexican|asw/i.test(entry.name);
  });
}

function checkSilverGramRates(line, catalogEntries, meta) {
  const name = meta.name;
  const unitPrice = Number(line?.unitPrice);
  const lineTotal = Number(line?.lineTotal);
  const hasUnit = Number.isFinite(unitPrice) && unitPrice > 0;
  const weightGrams = weightGramsFromLine(line, { allowQuantity: true });
  const actualTotal =
    Number.isFinite(lineTotal) && lineTotal > 0
      ? lineTotal
      : hasUnit && weightGrams
        ? unitPrice * weightGrams
        : null;
  const actualUnit =
    hasUnit ? unitPrice : actualTotal != null && weightGrams ? actualTotal / weightGrams : null;

  const hit = silverGramEntries(catalogEntries).find((entry) => {
    const unitHit = actualUnit != null && withinPriceTolerance(actualUnit, entry.buyAmount);
    const totalHit =
      actualTotal != null && weightGrams && withinPriceTolerance(actualTotal, entry.buyAmount * weightGrams);
    return unitHit || totalHit;
  });

  if (!hit) {
    return scrapResult({
      status: 'unknown',
      name,
      weightGrams,
      actualTotal,
      reason: 'Need sterling, flatware, or Mexican — or a website silver $/g that matches this line.',
    });
  }

  const expectedTotal = weightGrams ? hit.buyAmount * weightGrams : actualTotal;
  return scrapResult({
    status: 'ok',
    name,
    weightGrams,
    actual: actualUnit ?? actualTotal,
    actualTotal,
    expected: expectedTotal,
    expectedTotal,
    websiteName: hit.name,
    buyAmount: hit.buyAmount,
    buyLabel: hit.buyLabel,
    rate: hit.buyAmount,
    rateLabel: hit.buyLabel,
    tierLabel: hit.name,
    reason: `Matches website ${hit.name} ${hit.buyLabel}.`,
  });
}

function checkScrapLine(line, catalogEntries, txType) {
  const meta = scrapMetaFromLine(line);
  const name = meta.name;
  const unitPrice = Number(line?.unitPrice);
  const lineTotal = Number(line?.lineTotal);
  const hasUnit = Number.isFinite(unitPrice) && unitPrice > 0;
  const hasTotal = Number.isFinite(lineTotal) && lineTotal > 0;
  if (!name || (!hasUnit && !hasTotal)) {
    return scrapResult({
      status: 'skip',
      name,
      reason: 'No price on this scrap line.',
    });
  }

  if (meta.metal === 'silver' && !meta.silverKind) {
    return checkSilverGramRates(line, catalogEntries, meta);
  }

  if (!meta.goldFilled && meta.metal === 'gold' && !meta.karat) {
    return scrapResult({
      status: 'unknown',
      name,
      reason: 'Need a karat (9/10/14/18/21/22/24kt) to check scrap gold.',
    });
  } else if (!meta.metal) {
    return scrapResult({
      status: 'unknown',
      name,
      reason: 'Need gold, silver, or platinum (and karat for gold) to check scrap.',
    });
  } else if (meta.metal === 'platinum' && !meta.platinumKind) {
    return scrapResult({
      status: 'unknown',
      name,
      reason: 'Need 950 or 999 to check scrap platinum.',
    });
  }

  if (!(meta.weightGrams > 0)) {
    return scrapResult({
      status: 'unknown',
      name,
      reason: 'Need a recorded weight to check scrap against website $/g.',
    });
  }

  const matched = matchJewelleryEntry(meta, catalogEntries);
  if (!matched) {
    return scrapResult({
      status: 'unknown',
      name,
      weightGrams: meta.weightGrams,
      reason: 'No matching website jewellery rate for this karat or metal.',
    });
  }

  const rate = matched.buyAmount;
  const expectedTotal = rate * meta.weightGrams;
  const actualTotal = enteredScrapTotal(line, meta.weightGrams, rate);
  const tierLabel = jewelleryTierLabel(meta, matched);
  const rateLabel = matched.buyLabel || `$${rate.toFixed(2)}/g`;
  const unitOk = hasUnit && withinPriceTolerance(unitPrice, rate);
  const totalOk = actualTotal != null && withinPriceTolerance(actualTotal, expectedTotal);
  const base = {
    name,
    quantity: meta.weightGrams,
    weightGrams: meta.weightGrams,
    actual: hasUnit ? unitPrice : actualTotal,
    actualTotal,
    expected: expectedTotal,
    expectedTotal,
    expectedLabel: rateLabel,
    websiteName: matched.name,
    buyAmount: rate,
    buyLabel: rateLabel,
    sellAmount: null,
    sellLabel: '',
    rate,
    rateLabel,
    tierLabel,
    isPurchase: txType === 'purchase',
  };

  if (unitOk || totalOk) {
    return scrapResult({
      ...base,
      status: 'ok',
      reason: `${tierLabel} at ${rateLabel} × ${formatGrams(meta.weightGrams)} = ${formatMoney(expectedTotal)}, within 1%.`,
    });
  }

  const others = catalogEntries.filter(
    (entry) =>
      entry.jewellery &&
      entry.buyAmount != null &&
      entry !== matched &&
      entry.jewellery.metal === (meta.metal || matched.jewellery.metal),
  );
  const wrong = others.find((entry) => {
    const otherTotal = entry.buyAmount * meta.weightGrams;
    return (
      (hasUnit && withinPriceTolerance(unitPrice, entry.buyAmount)) ||
      (actualTotal != null && withinPriceTolerance(actualTotal, otherTotal))
    );
  });

  if (wrong) {
    const wrongLabel = jewelleryTierLabel(meta, wrong);
    return scrapResult({
      ...base,
      status: 'off',
      nearest: wrong.buyAmount * meta.weightGrams,
      reason: `Looks like ${wrongLabel} (${wrong.buyLabel}) × ${formatGrams(meta.weightGrams)} instead of ${tierLabel} at ${rateLabel}.`,
    });
  }

  return scrapResult({
    ...base,
    status: 'off',
    nearest: closestAmount(actualTotal ?? unitPrice, [expectedTotal])?.amount ?? expectedTotal,
    reason: `Paid ${formatMoney(actualTotal ?? unitPrice)} for ${formatGrams(meta.weightGrams)} of ${tierLabel}; website is ${rateLabel} × weight = ${formatMoney(expectedTotal)}.`,
  });
}

function formatGrams(grams) {
  const n = Number(grams);
  if (!Number.isFinite(n)) return '';
  const text = n.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
  return `${text}g`;
}

function formatMoney(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return '';
  return `$${n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

export function checkPricedLine(line, catalogEntries, txType) {
  if (isScrapJewelleryLine(line) || (looksLikeScrap(line) && !isNamedBullionProduct(line))) {
    return checkScrapLine(line, catalogEntries, txType);
  }

  const name = String(line?.name || '').trim();
  const quantity = Number(line?.quantity) > 0 ? Number(line.quantity) : 1;
  const listedUnit = Number(line?.unitPrice);
  const lineTotal = Number(line?.lineTotal);
  const actual =
    quantity > 1 &&
    Number.isFinite(listedUnit) &&
    Number.isFinite(lineTotal) &&
    lineTotal > 0 &&
    Math.abs(listedUnit - lineTotal) / lineTotal <= PRICE_TOLERANCE
      ? lineTotal / quantity
      : listedUnit;
  if (!name || !Number.isFinite(actual) || actual <= 0) {
    return { status: 'skip', name, quantity, actual, reason: 'No unit price on this line.' };
  }

  const matches = bestMatches(
    name,
    catalogEntries.filter((entry) => !entry.jewellery && !entry.spot),
  );
  if (!matches.length) {
    return { status: 'unknown', name, quantity, actual, reason: 'No matching website price for this item.' };
  }

  const isPurchase = txType === 'purchase';
  const candidates = matches.map((entry) => {
    const sell = sellForQuantity(entry, quantity);
    return {
      entry,
      buyAmount: entry.buyAmount,
      buyLabel: entry.buyLabel,
      sellAmount: sell?.amount ?? null,
      sellLabel: sell?.labelText || '',
    };
  });

  const correct = candidates
    .map((row) => (isPurchase ? row.buyAmount : row.sellAmount))
    .filter((amount) => amount != null);
  const opposite = candidates
    .map((row) => (isPurchase ? row.sellAmount : row.buyAmount))
    .filter((amount) => amount != null);
  const allSell = matches.flatMap((entry) => entry.sellTiers.map((tier) => tier.amount));

  const hitCorrect = correct.find((amount) => withinPriceTolerance(actual, amount));
  if (hitCorrect != null) {
    const row =
      candidates.find((entry) =>
        withinPriceTolerance(actual, isPurchase ? entry.buyAmount : entry.sellAmount),
      ) || candidates[0];
    return {
      status: 'ok',
      name,
      quantity,
      actual,
      websiteName: row.entry.name,
      expected: hitCorrect,
      expectedLabel: isPurchase ? row.buyLabel : row.sellLabel,
      buyAmount: row.buyAmount,
      buyLabel: row.buyLabel,
      sellAmount: row.sellAmount,
      sellLabel: row.sellLabel,
      reason: isPurchase
        ? `Website we-buy is ${row.buyLabel}, within 1%.`
        : `Website we-sell is ${row.sellLabel}, within 1%.`,
    };
  }

  const hitWrong = opposite.find((amount) => withinPriceTolerance(actual, amount));
  const hitOtherSell = !isPurchase
    ? null
    : allSell.find((amount) => withinPriceTolerance(actual, amount));
  const swappedAmount = hitWrong ?? hitOtherSell;
  const row = candidates[0];

  if (swappedAmount != null) {
    return {
      status: 'off',
      kind: 'swapped',
      name,
      quantity,
      actual,
      websiteName: row.entry.name,
      expected: isPurchase ? row.buyAmount : row.sellAmount,
      expectedLabel: isPurchase ? row.buyLabel : row.sellLabel,
      buyAmount: row.buyAmount,
      buyLabel: row.buyLabel,
      sellAmount: row.sellAmount,
      sellLabel: row.sellLabel,
      reason: isPurchase
        ? `Looks like we bought at the website sell price instead of we-buy ${row.buyLabel}.`
        : `Looks like we sold at the website buy price (${row.buyLabel}) instead of we-sell ${row.sellLabel}.`,
    };
  }

  const nearest = closestAmount(actual, [...correct, ...opposite]);
  return {
    status: 'off',
    kind: 'wrong',
    name,
    quantity,
    actual,
    websiteName: row.entry.name,
    expected: isPurchase ? row.buyAmount : row.sellAmount,
    expectedLabel: isPurchase ? row.buyLabel : row.sellLabel,
    buyAmount: row.buyAmount,
    buyLabel: row.buyLabel,
    sellAmount: row.sellAmount,
    sellLabel: row.sellLabel,
    nearest: nearest?.amount ?? null,
    reason: isPurchase
      ? `Paid a price that does not match website we-buy ${row.buyLabel}.`
      : `Charged a price that does not match website we-sell ${row.sellLabel}.`,
  };
}

export function checkTransactionPrices(row, catalog) {
  const lines = Array.isArray(row?.pricedLines) ? row.pricedLines : [];
  const entries = flattenCatalog(catalog);
  const isPurchase = row?.type === 'purchase';
  const results = lines.map((line) => checkPricedLine(line, entries, row?.type));
  const checked = results.filter((line) => line.status === 'ok' || line.status === 'off');
  const flagged = checked.filter((line) => line.status === 'off');

  if (!row?.lineItemsLoaded && !checked.length) {
    return { status: 'loading', isPurchase, lines: results, flagged };
  }
  if (!checked.length) {
    return { status: 'unknown', isPurchase, lines: results, flagged };
  }
  if (flagged.length) {
    return { status: 'off', isPurchase, lines: results, flagged };
  }
  return { status: 'ok', isPurchase, lines: results, flagged };
}
