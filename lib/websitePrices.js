import { ProxyError, proxyFetch } from './proxy';
import snapshot from './websitePriceSnapshot.json';

const BUY_URL = 'https://canadagold.ca/sell-to-us/todays-gold-prices/';
const SELL_URL = 'https://canadagold.ca/buy-from-us/bullion/';
const CACHE_TTL_MS = 45 * 1000;

/** @type {{ expires: number, catalog: object } | null} */
let catalogCache = null;

const ENTITY_MAP = {
  '&amp;': '&',
  '&nbsp;': ' ',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&lt;': '<',
  '&gt;': '>',
  '&#8217;': '\u2019',
  '&#8216;': '\u2018',
  '&#8220;': '\u201c',
  '&#8221;': '\u201d',
  '&#038;': '&',
};

function decodeEntities(value) {
  return String(value || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(Number(num)))
    .replace(/&[a-z0-9#]+;/gi, (entity) => ENTITY_MAP[entity.toLowerCase()] || entity);
}

function stripTags(html) {
  return decodeEntities(String(html || '').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function tidyPrice(raw) {
  const value = stripTags(raw)
    .replace(/\$\s+/g, '$')
    .replace(/([^\s$])\$/g, '$1 · $')
    .replace(/\s+/g, ' ')
    .trim();
  return value;
}

function extractUpdated(html) {
  const match =
    String(html || '').match(/Updated on:\s*([^<]+)/i) ||
    String(html || '').match(/Prices updated as of:?\s*(?:<[^>]+>)?\s*([^<]+)/i);
  return match ? stripTags(match[1]) : '';
}

function buyGroup(title) {
  if (/spot/i.test(title)) return 'Spot Price Per Gram';
  if (/premium jewellery/i.test(title)) return 'Premium Jewellery';
  if (/gold jewellery/i.test(title) || title === 'Silver' || title === 'Platinum') return 'Jewellery';
  if (/gold coins/i.test(title)) return 'Gold Coins';
  if (/silver coins/i.test(title)) return 'Silver Coins';
  if (/bullion/i.test(title)) return 'Bullion';
  return title;
}

function parseBuyTables(html) {
  const sections = [];
  const tableRe = /<table class="cg-table[^"]*">([\s\S]*?)<\/table>/gi;
  let tableMatch;
  while ((tableMatch = tableRe.exec(html))) {
    const table = tableMatch[1];
    const headers = [...table.matchAll(/<th(?:\s[^>]*)?>([\s\S]*?)<\/th>/gi)].map((row) =>
      stripTags(row[1]),
    );
    const title = headers[0] && headers[0] !== 'Metal' ? headers[0] : 'Spot Price Per Gram';
    const items = [];
    const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch;
    while ((rowMatch = rowRe.exec(table))) {
      const cells = [...rowMatch[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) =>
        tidyPrice(cell[1]),
      );
      if (cells.length < 2 || !cells[0] || !cells[1]) continue;
      if (headers.includes(cells[0])) continue;
      items.push({
        name: cells[0].replace(/\*$/, '').trim(),
        price: cells[1],
      });
    }
    if (items.length) sections.push({ title, group: buyGroup(title), items });
  }
  return sections;
}

function parseBuySpots(sections) {
  const spot = sections.find((section) => /spot/i.test(section.title));
  if (!spot) return [];
  return spot.items.map((item) => ({
    metal: item.name.replace(/\s+price per gram$/i, ''),
    price: item.price,
  }));
}

export function parseBuyHtml(html) {
  const sections = parseBuyTables(html);
  return {
    source: BUY_URL,
    updated: extractUpdated(html),
    spots: parseBuySpots(sections),
    sections,
  };
}

function parseSellTiers(cellHtml) {
  const tiers = [];
  const re =
    /<span class="text-(?:green|gold)">([\s\S]*?)<\/span>\s*<div class="pricelabel">([\s\S]*?)<\/div>/gi;
  let match;
  while ((match = re.exec(cellHtml))) {
    const label = stripTags(match[1]).replace(/:$/, '');
    const price = tidyPrice(match[2]).replace(/\s+each$/i, '');
    if (label && price) tiers.push({ label, price });
  }
  return tiers;
}

function parseSellSection(html, title) {
  const items = [];
  const blocks = String(html || '').split(/<td class="table-img">/i).slice(1);
  for (const block of blocks) {
    const nameMatch = block.match(/<strong>([\s\S]*?)<\/strong>/i);
    if (!nameMatch) continue;
    const name = stripTags(nameMatch[1]);
    if (!name || /^see more/i.test(name)) continue;
    const buyMatch = block.match(/table-data="We buy">\s*<h6>([\s\S]*?)<\/h6>/i);
    const sellMatch = block.match(/table-data="We Sell">([\s\S]*?)<\/td>/i);
    const tiers = sellMatch ? parseSellTiers(sellMatch[1]) : [];
    const badgeMatch = block.match(/\b(Most Popular|Special price|Lowest premium)\b/i);
    if (!tiers.length && !buyMatch) continue;
    items.push({
      name,
      buyPrice: buyMatch ? tidyPrice(buyMatch[1]) : '',
      tiers,
      badge: badgeMatch ? badgeMatch[1] : '',
    });
  }
  return items.length ? { title, items } : null;
}

function parseSellSpots(html) {
  const spots = [];
  const re =
    /<div class="gold-price-title[\s\S]*?<h4[^>]*>([\s\S]*?)<\/h4>[\s\S]*?<div class="gold-price-right">\s*<p>([\s\S]*?)<span/gi;
  let match;
  while ((match = re.exec(html))) {
    const metal = stripTags(match[1]);
    const price = tidyPrice(match[2]);
    if (metal && price) spots.push({ metal, price });
  }
  return spots;
}

function normalizeItemName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[()$,]/g, ' ')
    .replace(/\b1kg\b/g, '1 kg')
    .replace(/(\d)(oz|g|kg)\b/g, '$1 $2')
    .replace(/non[\s-]*rcm/g, 'non-rcm')
    .replace(/\s+/g, ' ')
    .trim();
}

const BUY_SELL_ALIASES = new Map([
  ['1 oz gold maple leaf 9999', '1 oz standard gold maple leaf coin 9999'],
  ['1 oz gold maple leaf 9999 2014 or later', '1 oz dna gold maple leaf coin 9999'],
  ['1 oz recognized gold bar', '1 oz recognized gold bar carded'],
  ['silver maple leaf coin', '1 oz standard silver maple leaf coin'],
  ['silver maple leaf coin 5', '1 oz standard silver maple leaf coin'],
  ['silver maple leaf coin 2015 or later', '1 oz dna silver maple leaf coin'],
  ['american eagle silver coin', '1 oz silver eagle coin'],
  ['silver american eagle', '1 oz silver eagle coin'],
  ['recognized platinum bar', '1 oz recognized platinum bar'],
  ['sbar 10 oz non-rcm', '10 oz recognized silver bar'],
  ['sbar 10 oz non rcm', '10 oz recognized silver bar'],
  ['10 oz non-rcm', '10 oz recognized silver bar'],
  ['10 oz non rcm', '10 oz recognized silver bar'],
  ['sbar 10 oz', '10 oz recognized silver bar'],
  ['sbar 100 oz non-rcm', '100 oz recognized silver bar'],
  ['sbar 100 oz non rcm', '100 oz recognized silver bar'],
  ['sbar 100 oz', '100 oz recognized silver bar'],
  ['sbar 1 oz', '1 oz recognized silver bar'],
  ['sbar 5 oz', '5 oz recognized silver bar'],
  ['sbar 10 oz rcm', '10 oz rcm royal canadian mint silver bar'],
  ['sbar 100 oz rcm', '100 oz rcm royal canadian mint silver bar'],
  ['sml 2 oz', '2 oz standard silver maple leaf coin'],
  ['sml 2oz', '2 oz standard silver maple leaf coin'],
  ['sml 2 oz dna', '2 oz dna silver maple leaf coin'],
  ['sml 2oz dna', '2 oz dna silver maple leaf coin'],
  ['other gold bullion by ounce', 'unrecognized gold bars'],
  ['other gold bullion by oz', 'unrecognized gold bars'],
  ['other silver bullion by ounce', 'unrecognized silver bar'],
  ['other silver bullion by oz', 'unrecognized silver bar'],
  ['other platinum bullion by ounce', 'unrecognized platinum bar'],
  ['other palladium bullion by ounce', 'unrecognized palladium bar'],
]);

export function itemMatchKey(name) {
  const normalized = normalizeItemName(name);
  return BUY_SELL_ALIASES.get(normalized) || normalized;
}

/** Match keys for products listed on What we sell (bullion we also buy). */
export function catalogSellMatchKeys(catalog) {
  const keys = new Set();
  for (const section of catalog?.sell?.sections || []) {
    for (const item of section.items || []) {
      const name = String(item.name || '').trim();
      if (name) keys.add(itemMatchKey(name));
    }
  }
  return keys;
}

export const BUY_MODAL_TABS = [
  { key: 'buy', label: 'What we buy' },
  { key: 'watches', label: 'Watches' },
  { key: 'diamonds', label: 'Diamonds' },
  { key: 'numismatics', label: 'Numismatics' },
];

const SPECIALTY_BUY = {
  watches: {
    source: 'https://canadagold.ca/sell-to-us/watches/',
    itemType: 'Watch',
    sections: [
      {
        title: 'Brands we buy',
        group: 'Watches',
        itemType: 'Watch',
        items: [
          { name: 'Rolex', price: 'Quote' },
          { name: 'Omega', price: 'Quote' },
          { name: 'Cartier', price: 'Quote' },
          { name: 'Tudor', price: 'Quote' },
          { name: 'Patek Philippe', price: 'Quote' },
          { name: 'Audemars Piguet', price: 'Quote' },
          { name: 'Breitling', price: 'Quote' },
          { name: 'IWC', price: 'Quote' },
          { name: 'Hublot', price: 'Quote' },
          { name: 'Breguet', price: 'Quote' },
          { name: 'Tiffany', price: 'Quote' },
          { name: 'Perrelet', price: 'Quote' },
        ],
      },
      {
        title: 'Recent sales',
        group: 'Watches',
        itemType: 'Watch',
        items: [
          { name: 'Rolex Submariner', price: '$13,700' },
          { name: 'Rolex President', price: '$17,200' },
        ],
      },
    ],
  },
  diamonds: {
    source: 'https://canadagold.ca/sell-to-us/sell-your-diamonds/',
    itemType: 'Diamond',
    sections: [
      {
        title: 'Jewellery',
        group: 'Diamonds',
        itemType: 'Diamond',
        items: [
          { name: 'Engagement ring', price: 'Quote' },
          { name: 'Diamond earrings', price: 'Quote' },
          { name: 'Diamond bracelet', price: 'Quote' },
          { name: 'Diamond necklace', price: 'Quote' },
        ],
      },
      {
        title: 'Stones',
        group: 'Diamonds',
        itemType: 'Diamond',
        items: [
          { name: 'Loose diamond', price: 'Quote' },
          { name: 'Diamond 0.40 ct and over', price: 'Quote' },
          { name: 'Diamond under 0.40 ct', price: 'Quote' },
          { name: 'Coloured gemstone', price: 'Quote' },
        ],
      },
    ],
  },
  numismatics: {
    source: 'https://canadagold.ca/sell-to-us/coins-paper-money/',
    itemType: 'Numismatic',
    sections: [
      {
        title: 'Collector coins',
        group: 'Numismatics',
        itemType: 'Numismatic',
        items: [
          { name: 'Canadian collector coins', price: 'Quote' },
          { name: 'World collector coins', price: 'Quote' },
          { name: 'Rare or error coins', price: 'Quote' },
          { name: 'Coin collection', price: 'Quote' },
        ],
      },
      {
        title: 'Paper money',
        group: 'Numismatics',
        itemType: 'Numismatic',
        items: [
          { name: 'Canadian paper money', price: 'Quote' },
          { name: 'World paper money', price: 'Quote' },
          { name: 'Bank note collection', price: 'Quote' },
        ],
      },
    ],
  },
};

export function specialtyBuyCatalog(tab) {
  return SPECIALTY_BUY[tab] || null;
}

/** Bullion = what-we-sell products we also buy, excluding jewellery. */
export function catalogItemType(name, group, sellKeys) {
  const text = `${group || ''} ${name || ''}`;
  if (/watch|rolex|omega|patek|tudor|breitling|cartier|hublot|iwc|audemars|breguet|perrelet|tiffany/i.test(text)) {
    return 'Watch';
  }
  if (/diamond|gemstone/i.test(text)) return 'Diamond';
  if (/numismatic|paper money|bank note|collector coin/i.test(text)) return 'Numismatic';
  if (/jewell?ery/i.test(text)) return 'Scrap';
  if (/bullion/i.test(String(group || ''))) return 'Bullion';
  if (sellKeys?.has(itemMatchKey(name))) return 'Bullion';
  return 'Scrap';
}

function parsePriceNumber(value) {
  const match = String(value || '').match(/-?\$?\s*[\d,]+(?:\.\d+)?/);
  if (!match) return null;
  const n = Number(match[0].replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** What-we-buy catalog lines with a unit price, for PMA purchase tickets. */
export function catalogBuyPricelist(catalog) {
  const items = [];
  const seen = new Set();
  const sellKeys = catalogSellMatchKeys(catalog);
  for (const section of catalog?.buy?.sections || []) {
    const group = section.group || section.title || '';
    if (/spot/i.test(group) || /spot/i.test(section.title || '')) continue;
    for (const item of section.items || []) {
      const name = String(item.name || '').trim();
      if (!name) continue;
      const key = itemMatchKey(name);
      if (seen.has(key)) continue;
      const unitPrice = parsePriceNumber(item.price);
      if (unitPrice == null) continue;
      seen.add(key);
      const jewellery = /jewellery|jewelry/i.test(group);
      const perGram = jewellery || /\/\s*g\b/i.test(String(item.price || ''));
      items.push({
        key,
        name,
        group,
        unitPrice,
        priceLabel: String(item.price || '').trim(),
        unitType: perGram ? 'g' : 'ea',
        itemType: catalogItemType(name, group, sellKeys),
        searchText: [name, group, item.price].filter(Boolean).join(' '),
      });
    }
  }
  return items;
}

export function catalogSpecialtyPricelist() {
  const items = [];
  const seen = new Set();
  for (const tab of Object.values(SPECIALTY_BUY)) {
    for (const section of tab.sections || []) {
      const group = section.group || section.title || '';
      for (const item of section.items || []) {
        const name = String(item.name || '').trim();
        if (!name) continue;
        const key = itemMatchKey(name);
        if (seen.has(key)) continue;
        seen.add(key);
        items.push({
          key,
          name,
          group,
          unitPrice: parsePriceNumber(item.price),
          priceLabel: String(item.price || 'Quote').trim(),
          unitType: 'ea',
          itemType: section.itemType || tab.itemType || 'Scrap',
          searchText: [name, group, item.price].filter(Boolean).join(' '),
        });
      }
    }
  }
  return items;
}

function sellItems(sell) {
  const items = [];
  for (const section of sell?.sections || []) {
    for (const item of section.items || []) {
      items.push({ section, item });
    }
  }
  return items;
}

function bullionSectionForMetal(metal) {
  if (metal === 'Silver') return { title: 'Silver Bullion', group: 'Bullion' };
  if (metal === 'Platinum') return { title: 'Platinum Bullion', group: 'Bullion' };
  return { title: 'Gold Bullion', group: 'Bullion' };
}

/** Same product uses the bullion "We Buy" price on both tabs. */
export function reconcileCatalog(buy, sell) {
  const nextBuy = {
    ...buy,
    sections: (buy?.sections || []).map((section) => ({
      ...section,
      items: (section.items || []).map((item) => ({ ...item })),
    })),
  };
  const nextSell = {
    ...sell,
    sections: (sell?.sections || []).map((section) => ({
      ...section,
      items: (section.items || []).map((item) => ({ ...item })),
    })),
  };

  const sellByKey = new Map();
  for (const { section, item } of sellItems(nextSell)) {
    const key = itemMatchKey(item.name);
    if (!sellByKey.has(key)) sellByKey.set(key, { section, item });
  }

  const used = new Set();
  for (const section of nextBuy.sections) {
    for (const item of section.items) {
      const match = sellByKey.get(itemMatchKey(item.name));
      if (!match?.item.buyPrice) continue;
      used.add(itemMatchKey(match.item.name));
      item.price = match.item.buyPrice;
      match.item.buyPrice = match.item.buyPrice;
    }
  }

  for (const { section, item } of sellItems(nextSell)) {
    const key = itemMatchKey(item.name);
    if (used.has(key) || !item.buyPrice) continue;
    const dest = bullionSectionForMetal(section.title);
    let target = nextBuy.sections.find((entry) => entry.title === dest.title);
    if (!target) {
      target = { ...dest, items: [] };
      nextBuy.sections.push(target);
    }
    target.items.push({ name: item.name, price: item.buyPrice });
    used.add(key);
  }

  return { buy: nextBuy, sell: nextSell };
}

export function parseSellHtml(html) {
  const source = String(html || '');
  const goldStart = source.search(/id="gold-prices-table"/i);
  const silverStart = source.search(/id="silver-prices-table"/i);
  const platinumStart = source.search(/id="platinum-prices-table"/i);
  const goldHtml =
    goldStart >= 0 ? source.slice(goldStart, silverStart >= 0 ? silverStart : platinumStart) : source;
  const silverHtml =
    silverStart >= 0 ? source.slice(silverStart, platinumStart >= 0 ? platinumStart : undefined) : '';
  const platinumHtml = platinumStart >= 0 ? source.slice(platinumStart) : '';

  const sections = [
    parseSellSection(goldHtml, 'Gold'),
    parseSellSection(silverHtml, 'Silver'),
    parseSellSection(platinumHtml, 'Platinum'),
  ].filter(Boolean);

  return {
    source: SELL_URL,
    updated: extractUpdated(html),
    spots: parseSellSpots(html),
    sections,
  };
}

async function fetchPageHtml(page) {
  try {
    const response = await proxyFetch(`canadagold/page?page=${page}`);
    const html = await response.text();
    if (!response.ok) {
      let message = `Could not load Canada Gold ${page} prices.`;
      try {
        const payload = JSON.parse(html);
        if (payload?.error?.message) message = payload.error.message;
      } catch {
        // keep default
      }
      throw new ProxyError(message, response.status, 'upstream_failed');
    }
    return html;
  } catch (err) {
    const url = page === 'sell' ? SELL_URL : BUY_URL;
    const response = await fetch(url, {
      headers: { Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'en-CA,en;q=0.9' },
    });
    if (!response.ok) throw err;
    return await response.text();
  }
}

function snapshotCatalog() {
  const reconciled = reconcileCatalog(snapshot.buy, snapshot.sell);
  return {
    ...snapshot,
    ...reconciled,
    stale: true,
    warning: 'Showing saved website prices. Live refresh will update them when available.',
  };
}

export async function fetchWebsitePrices({ force = false } = {}) {
  const now = Date.now();
  if (!force && catalogCache && catalogCache.expires > now) {
    return catalogCache.catalog;
  }

  try {
    const [buyHtml, sellHtml] = await Promise.all([fetchPageHtml('buy'), fetchPageHtml('sell')]);
    const buy = parseBuyHtml(buyHtml);
    const sell = parseSellHtml(sellHtml);
    if (!buy.sections.length) throw new Error('Buy prices did not load from canadagold.ca.');
    if (!sell.sections.length) throw new Error('Sell prices did not load from canadagold.ca.');

    const reconciled = reconcileCatalog(buy, sell);
    const catalog = {
      currency: 'CAD',
      updated: buy.updated || sell.updated,
      fetchedAt: new Date().toISOString(),
      ...reconciled,
    };
    catalogCache = { expires: now + CACHE_TTL_MS, catalog };
    return catalog;
  } catch (err) {
    if (snapshot?.buy?.sections?.length && snapshot?.sell?.sections?.length) {
      const catalog = snapshotCatalog();
      catalogCache = { expires: now + CACHE_TTL_MS, catalog };
      return catalog;
    }
    throw err;
  }
}

export function compactWebsitePrices(catalog) {
  if (!catalog) return null;
  return {
    currency: catalog.currency || 'CAD',
    updated: catalog.updated || '',
    buy: (catalog.buy?.sections || []).map((section) => ({
      section: section.title,
      items: (section.items || []).map((item) => `${item.name} ${item.price}`),
    })),
    sell: (catalog.sell?.sections || []).map((section) => ({
      section: section.title,
      items: (section.items || []).map((item) => {
        const tiers = (item.tiers || []).map((tier) => `${tier.label} ${tier.price}`).join('; ');
        return `${item.name} buy ${item.buyPrice || '—'}${tiers ? ` · sell ${tiers}` : ''}`;
      }),
    })),
  };
}

function normalizeKaratText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\b(\d{1,2})\s*k(?:t|arat)?s?\b/gi, '$1kt')
    .replace(/[^a-z0-9./]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function catalogTextMatches(haystack, query) {
  const hay = normalizeKaratText(haystack);
  const tokens = normalizeKaratText(query).split(' ').filter(Boolean);
  if (!tokens.length) return true;
  return tokens.every((token) => hay.includes(token));
}

function karatFromText(value) {
  const match = String(value || '').match(/\b(\d{1,2})\s*k(?:t|arat)?s?\b/i);
  return match ? match[1] : '';
}

function jewelleryRecommendLabel(name, group) {
  const karat = karatFromText(name);
  if (!karat) return { label: name, aliases: [] };
  const premium = /premium/i.test(name) || /premium/i.test(group);
  const tier = premium ? 'Premium' : 'Standard';
  return {
    label: `${karat}kt ${tier}`,
    aliases: [
      `${karat}k`,
      `${karat}kt`,
      `${karat}k ${tier}`,
      `${karat}kt ${tier}`,
      `${karat} karat ${tier}`,
      tier,
      'scrap gold',
      'scrap',
    ],
  };
}

/** Pricing-page product lines for triage / lookup suggestions. */
export function catalogProductOptions(catalog) {
  const options = [];
  const seen = new Set();

  const push = (id, label, sub, aliases, searchText) => {
    const key = String(label || '')
      .trim()
      .toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    options.push({ id, label, sub, aliases, searchText });
  };

  for (const section of catalog?.buy?.sections || []) {
    const group = section.group || section.title || '';
    if (/spot/i.test(group)) continue;
    for (const item of section.items || []) {
      const name = String(item.name || '').trim();
      if (!name) continue;
      const jewellery = /jewellery|jewelry/i.test(group);
      const karatLine = jewellery && /^\d{1,2}\s*k(?:t)?\b/i.test(name);
      const { label, aliases } = karatLine
        ? jewelleryRecommendLabel(name, group)
        : { label: name, aliases: [] };
      const sub = [group, item.price].filter(Boolean).join(' · ');
      const searchText = [label, name, group, ...aliases].join(' ');
      push(`buy-${itemMatchKey(name)}`, label, sub, aliases, searchText);
    }
  }

  for (const section of catalog?.sell?.sections || []) {
    for (const item of section.items || []) {
      const name = String(item.name || '').trim();
      if (!name) continue;
      const sub = ['What we sell', section.title, item.buyPrice].filter(Boolean).join(' · ');
      push(`sell-${itemMatchKey(name)}`, name, sub, [], name);
    }
  }

  return options;
}

export function filterCatalogProductOptions(options, query, seed = '') {
  const q = String(query || '').trim();
  const seedText = String(seed || '').trim();
  const seedKarat = karatFromText(seedText);
  const scored = [];

  for (const option of options || []) {
    const hay = normalizeKaratText(
      [option.label, option.sub, option.searchText, ...(option.aliases || [])].join(' '),
    );
    if (q && !catalogTextMatches(hay, q)) continue;

    let score = 1;
    if (/standard|premium/i.test(option.label)) score += 2;
    if (q && String(option.label).toLowerCase().startsWith(q.toLowerCase())) score += 8;
    if (q && catalogTextMatches(option.label, q)) score += 4;
    if (seedKarat && karatFromText(option.label) === seedKarat) {
      score += 12;
      if (/standard/i.test(option.label) && !/premium/i.test(seedText)) score += 4;
      if (/premium/i.test(option.label) && /premium/i.test(seedText)) score += 4;
    }
    if (/\bscrap\b/i.test(seedText) && /standard|premium/i.test(option.label)) score += 3;
    scored.push({ option, score });
  }

  scored.sort((a, b) => b.score - a.score || a.option.label.localeCompare(b.option.label));
  return scored.slice(0, 40).map((row) => row.option);
}

const LINE_KARAT_PURITIES = [
  { purity: 99.9, karat: 24 },
  { purity: 91.6, karat: 22 },
  { purity: 87.5, karat: 21 },
  { purity: 75.0, karat: 18 },
  { purity: 58.5, karat: 14 },
  { purity: 41.7, karat: 10 },
  { purity: 37.5, karat: 9 },
];

function karatFromLinePurity(purity) {
  if (purity == null || purity === '') return '';
  let n = Number(String(purity).replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n > 0 && n <= 1) n *= 100;
  if (n > 100 && n <= 1000) n /= 10;
  if (LINE_KARAT_PURITIES.some((row) => row.karat === n)) return String(n);
  let best = null;
  for (const row of LINE_KARAT_PURITIES) {
    const delta = Math.abs(n - row.purity);
    if (delta <= 2 && (!best || delta < best.delta)) best = { karat: row.karat, delta };
  }
  return best ? String(best.karat) : '';
}

function lineBlob(line) {
  return [line?.name, line?.quality, line?.searchText, line?.productGroup, line?.productType, line?.metal]
    .filter(Boolean)
    .join(' ');
}

function lineKarat(line) {
  const fromText = karatFromText(lineBlob(line));
  if (fromText && LINE_KARAT_PURITIES.some((row) => String(row.karat) === fromText)) return fromText;
  return karatFromLinePurity(line?.purity) || karatFromLinePurity(line?.quality);
}

function cleanCatalogName(name) {
  return String(name || '')
    .replace(/\*+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function jewellerySections(catalog) {
  const book = catalog?.buy?.sections?.length ? catalog : snapshot;
  return (book.buy?.sections || []).filter((section) => {
    const group = `${section.group || ''} ${section.title || ''}`;
    return /jewellery|jewelry/i.test(group) && !/coin/i.test(group);
  });
}

function catalogMetal(name) {
  const title = cleanCatalogName(name);
  if (/platinum/i.test(title)) return 'platinum';
  if (/silver|sterling|mexican/i.test(title)) return 'silver';
  if (/gold/i.test(title) || /^\d{1,2}kt\b/i.test(title)) return 'gold';
  return '';
}

function lineMetal(line) {
  const blob = lineBlob(line);
  if (/platinum/i.test(blob)) return 'platinum';
  if (/silver/i.test(blob) && !/gold/i.test(blob)) return 'silver';
  if (/gold/i.test(blob)) return 'gold';
  return '';
}

function genericBuyName(name) {
  const text = String(name || '').trim();
  if (!text) return true;
  if (/\bscrap\b/i.test(text)) return true;
  return /^(gold|silver|platinum)(\s+jewellery|\s+jewelry)?$/i.test(text);
}

function perGramRate(price) {
  const match = String(price || '').match(/([0-9]+(?:\.[0-9]+)?)\s*\/\s*g\b/i);
  return match ? Number(match[1]) : null;
}

function paidPerGram(line) {
  const weight = Number(line?.weight);
  const total = Number(line?.lineTotal);
  if (weight > 0 && total > 0) return total / weight;
  const unit = Number(line?.unitPrice);
  return Number.isFinite(unit) && unit > 0 ? unit : null;
}

function findJewelleryItem(catalog, test) {
  for (const section of jewellerySections(catalog)) {
    const group = section.group || section.title || '';
    for (const item of section.items || []) {
      if (test(item, group)) return cleanCatalogName(item.name);
    }
  }
  return '';
}

function titleFromRate(line, catalog, metal) {
  const paid = paidPerGram(line);
  if (!metal || paid == null) return '';
  const rows = [];
  for (const section of jewellerySections(catalog)) {
    for (const item of section.items || []) {
      if (catalogMetal(item.name) !== metal) continue;
      const rate = perGramRate(item.price);
      if (rate == null || rate <= 0) continue;
      rows.push({
        name: cleanCatalogName(item.name),
        rate,
        delta: Math.abs(paid - rate) / rate,
      });
    }
  }
  rows.sort((a, b) => a.delta - b.delta || a.name.localeCompare(b.name));
  const best = rows[0];
  const next = rows[1];
  if (!best || best.delta > 0.08) return '';
  if (next && next.delta - best.delta < 0.004) return '';
  return best.name;
}

/**
 * Name a purchase line with the What we buy product title.
 * "Scrap Gold" becomes the karat row, such as "14kt (58.5% pure)".
 * Pass the live catalog from fetchWebsitePrices so the paid $/g can pick the row.
 */
export function catalogNameForPurchaseLine(line, catalog) {
  const name = String(line?.name || '').trim();
  const blob = lineBlob(line);
  const book = catalog?.buy?.sections?.length ? catalog : snapshot;

  const exact = findJewelleryItem(
    book,
    (item) => cleanCatalogName(item.name).toLowerCase() === cleanCatalogName(name).toLowerCase(),
  );
  if (exact) return exact;

  if (!genericBuyName(name) && name && !/\bscrap\b/i.test(name)) return name;

  if (/gold\s*filled/i.test(blob)) {
    const filled = findJewelleryItem(book, (item) => /gold filled/i.test(item.name));
    if (filled) return filled;
  }

  const metal = lineMetal(line);
  const premium = Boolean(line?.premium) || /\bpremium\b/i.test(blob);

  if (metal === 'gold' || (!metal && lineKarat(line))) {
    const karat = lineKarat(line);
    if (karat) {
      const titled = findJewelleryItem(
        book,
        (item, group) =>
          catalogMetal(item.name) === 'gold' &&
          new RegExp(`^${karat}kt\\b`, 'i').test(cleanCatalogName(item.name)) &&
          (premium ? /\bpremium\b/i.test(item.name) : !/\bpremium\b/i.test(item.name)) &&
          (/premium jewellery/i.test(group)) === premium,
      );
      if (titled) return titled;
    }
  }

  if (metal === 'silver') {
    const mexican = /mexican/i.test(blob);
    const flatware = /flatware|cutlery/i.test(blob);
    if (mexican || flatware || /sterling|jewellery|jewelry/i.test(blob)) {
      const titled = findJewelleryItem(book, (item) => {
        if (catalogMetal(item.name) !== 'silver') return false;
        if (mexican) return /mexican/i.test(item.name);
        if (flatware) return /flatware/i.test(item.name);
        return /sterling silver jewellery/i.test(item.name);
      });
      if (titled && (mexican || flatware)) return titled;
    }
  }

  if (metal === 'platinum') {
    const kind = /\b999\b/.test(blob) ? '999' : /\b950\b/.test(blob) ? '950' : '';
    if (kind) {
      const titled = findJewelleryItem(
        book,
        (item) => catalogMetal(item.name) === 'platinum' && cleanCatalogName(item.name).startsWith(kind),
      );
      if (titled) return titled;
    }
  }

  if (catalog?.buy?.sections?.length && !catalog.stale) {
    const rated = titleFromRate(line, book, metal);
    if (rated) return rated;
  }

  if (metal === 'silver') {
    const sterling = findJewelleryItem(book, (item) => /sterling silver jewellery/i.test(item.name));
    if (sterling) return sterling;
  }

  return name.replace(/\bscrap\b/gi, '').replace(/\s+/g, ' ').trim() || 'Item';
}
