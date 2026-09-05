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
