/**
 * Transaction / inventory item search.
 * "1oz rcm" and "1oz royal canada mint gold coin" resolve to the same product.
 */

const OPTIONAL_WORDS = new Set([
  'a',
  'an',
  'and',
  'bar',
  'bars',
  'bullion',
  'by',
  'coin',
  'coins',
  'coint',
  'item',
  'items',
  'of',
  'or',
  'piece',
  'pieces',
  'round',
  'rounds',
  'the',
]);

/** Each group is one idea: any phrase in the group means the same thing. */
const PHRASE_GROUPS = [
  ['rcm', 'royal canadian mint', 'royal canada mint', 'canada mint', 'canadian mint', 'canadamint'],
  ['gml', 'gold maple leaf', 'gold maple', 'maple leaf gold', 'canadian gold maple'],
  ['sml', 'silver maple leaf', 'silver maple', 'maple leaf silver', 'canadian silver maple'],
  ['gbar', 'gold bar', 'goldbar', 'g bar'],
  ['sbar', 'silver bar', 'silverbar', 's bar'],
  ['sround', 's round', 'silver round', 'srounds'],
  ['se', 'seagle', 'silver eagle', 'american eagle', 'us eagle', 'american silver eagle'],
  ['pamp', 'pamp suisse', 'pamp swiss'],
  ['plat', 'platinum', 'pt'],
  ['palladium', 'pall', 'pd'],
  ['dna', 'assay', 'assayed'],
  ['nondna', 'non dna', 'non-dna', 'no dna'],
  ['carded', 'sealed'],
  ['uncarded', 'unsealed'],
  ['maplegram', 'maple gram', 'maplegrams'],
  ['gram', 'grams', 'by gram', 'by grams'],
];

const TOKEN_CANON = {
  ounce: 'oz',
  ounces: 'oz',
  ozt: 'oz',
  gram: 'g',
  grams: 'g',
  gm: 'g',
  gms: 'g',
  kilo: 'kg',
  kilos: 'kg',
  kilogram: 'kg',
  kilograms: 'kg',
  canadian: 'canada',
  canadas: 'canada',
  americans: 'american',
  platinum: 'plat',
  pt: 'plat',
  palladium: 'palladium',
  pd: 'palladium',
  golds: 'gold',
  silvers: 'silver',
  maples: 'maple',
  leaves: 'leaf',
  mints: 'mint',
  coins: 'coin',
  coint: 'coin',
  bars: 'bar',
  rounds: 'round',
};

const KNOWN_WORDS = new Set([
  'gold',
  'silver',
  'plat',
  'platinum',
  'palladium',
  'maple',
  'leaf',
  'mint',
  'canada',
  'canadian',
  'royal',
  'american',
  'eagle',
  'pamp',
  'suisse',
  'swiss',
  'bar',
  'coin',
  'round',
  'bullion',
  'carded',
  'uncarded',
  'sealed',
  'unsealed',
  'dna',
  'assay',
  'scrap',
  'tarnished',
  'damaged',
  'beaver',
  'generic',
  'other',
  'ounce',
  'gram',
  'kilo',
]);

const phraseIndex = buildPhraseIndex();

function buildPhraseIndex() {
  const byPhrase = new Map();
  const words = new Set(KNOWN_WORDS);

  for (const group of PHRASE_GROUPS) {
    const phrases = group.map((phrase) => normalizeWords(phrase)).filter(Boolean);
    for (const phrase of phrases) {
      byPhrase.set(phrase, phrases);
      for (const word of phrase.split(' ')) {
        if (word) words.add(word);
      }
    }
  }

  const splitWords = [...words].filter((word) => word.length >= 3).sort((a, b) => b.length - a.length);
  return { byPhrase, splitWords, words };
}

function normalizeWords(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[’'`]/g, '')
    .replace(/ounces?\b/g, 'oz')
    .replace(/grams?\b/g, 'g')
    .replace(/\bgms?\b/g, 'g')
    .replace(/kilograms?\b/g, 'kg')
    .replace(/kilos?\b/g, 'kg')
    .replace(/(\d)\s*\/\s*(\d)/g, '$1/$2')
    .replace(/(\d(?:\.\d+)?)(oz|g|kg|dwt)\b/g, '$1 $2')
    .replace(/[^a-z0-9./]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function canonToken(token) {
  const raw = String(token || '').toLowerCase();
  if (!raw) return '';
  if (TOKEN_CANON[raw]) return TOKEN_CANON[raw];
  if (raw.length > 4 && raw.endsWith('s') && !raw.endsWith('ss')) {
    const sliced = raw.slice(0, -1);
    return TOKEN_CANON[sliced] || sliced;
  }
  return raw;
}

function tokenize(value) {
  const text = normalizeWords(value);
  if (!text) return [];
  const raw = text.match(/\d+\/\d+|\d+(?:\.\d+)?|[a-z]+/g) || [];
  const tokens = [];
  for (const part of raw) {
    const split = splitConcatenated(part);
    for (const token of split) {
      const canon = canonToken(token);
      if (canon) tokens.push(canon);
    }
  }
  return tokens;
}

function splitConcatenated(token) {
  if (!token || token.length < 6 || /\d/.test(token)) return [token];
  if (phraseIndex.words.has(token) || TOKEN_CANON[token]) return [token];

  const parts = [];
  let rest = token;
  while (rest.length) {
    let hit = '';
    for (const word of phraseIndex.splitWords) {
      if (rest.startsWith(word) && rest.length - word.length !== 1) {
        hit = word;
        break;
      }
    }
    if (!hit) {
      parts.push(rest);
      break;
    }
    parts.push(hit);
    rest = rest.slice(hit.length);
  }
  return parts.length ? parts : [token];
}

function editDistance(a, b) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 1) return 99;
  const rows = a.length + 1;
  const cols = b.length + 1;
  const prev = new Array(cols);
  const cur = new Array(cols);
  for (let j = 0; j < cols; j += 1) prev[j] = j;
  for (let i = 1; i < rows; i += 1) {
    cur[0] = i;
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j < cols; j += 1) prev[j] = cur[j];
  }
  return prev[b.length];
}

function correctTypo(token) {
  if (!token || token.length < 4 || phraseIndex.words.has(token) || TOKEN_CANON[token]) {
    return token;
  }
  let best = token;
  let bestDist = 2;
  for (const word of phraseIndex.words) {
    if (Math.abs(word.length - token.length) > 1) continue;
    const dist = editDistance(token, word);
    if (dist < bestDist) {
      best = word;
      bestDist = dist;
      if (dist === 1) break;
    }
  }
  return canonToken(best);
}

function initialsFor(tokens) {
  const letters = tokens
    .map((token) => (token && !/^\d/.test(token) ? token[0] : ''))
    .filter(Boolean);
  const extra = [];
  for (let i = 0; i < letters.length; i += 1) {
    for (let len = 2; len <= 4 && i + len <= letters.length; len += 1) {
      extra.push(letters.slice(i, i + len).join(''));
    }
  }
  return extra;
}

function expandTokens(tokens) {
  const set = new Set(tokens.map(correctTypo).map(canonToken).filter(Boolean));

  for (const token of [...set]) {
    const phrases = phraseIndex.byPhrase.get(token);
    if (!phrases) continue;
    for (const phrase of phrases) {
      for (const part of phrase.split(' ')) {
        const canon = canonToken(part);
        if (canon) set.add(canon);
      }
    }
  }

  const joined = tokens.join(' ');
  for (const [phrase, group] of phraseIndex.byPhrase) {
    if (phrase.length < 3) continue;
    if (joined.includes(phrase) || tokens.includes(phrase)) {
      for (const alt of group) {
        for (const part of alt.split(' ')) {
          const canon = canonToken(part);
          if (canon) set.add(canon);
        }
      }
    }
  }

  for (const initial of initialsFor(tokens)) set.add(initial);
  return set;
}

function compact(value) {
  return normalizeWords(value).replace(/\s+/g, '');
}

const UNIT_WORDS = new Set(['g', 'oz', 'kg', 'dwt', 'ozt']);

function isOptionalQueryToken(token, required) {
  if (OPTIONAL_WORDS.has(token)) return true;
  if (!UNIT_WORDS.has(token)) return false;
  return required.some((part) => !OPTIONAL_WORDS.has(part) && !UNIT_WORDS.has(part) && !/^\d/.test(part));
}

function tokenInHaystack(token, haySet, hayCompact) {
  if (!token) return false;
  if (haySet.has(token)) return true;
  if (token.length >= 3 && hayCompact.includes(token)) return true;
  if (token.length >= 4) {
    for (const hay of haySet) {
      if (hay.length >= 4 && (hay.startsWith(token) || token.startsWith(hay))) return true;
    }
  }
  const phrases = phraseIndex.byPhrase.get(token);
  if (phrases) {
    return phrases.some((phrase) => {
      const parts = phrase.split(' ').map(canonToken).filter(Boolean);
      return parts.every((part) => haySet.has(part) || hayCompact.includes(part));
    });
  }
  return false;
}

/**
 * True when query describes the same item as haystack
 * (abbreviations, word order, extra "gold coin", light typos).
 */
export function textMatchesQuery(haystack, query) {
  const q = String(query || '').trim();
  if (!q) return true;
  const text = String(haystack || '');
  if (!text) return false;

  const lower = text.toLowerCase();
  const needle = q.toLowerCase();
  if (lower.includes(needle)) return true;

  const compactQuery = compact(q);
  const compactHay = compact(text);
  if (compactQuery && compactHay.includes(compactQuery)) return true;

  const queryTokens = tokenize(q);
  if (!queryTokens.length) return true;

  const hayTokens = tokenize(text);
  const haySet = expandTokens(hayTokens);
  const required = queryTokens.map(correctTypo).map(canonToken).filter(Boolean);

  let i = 0;
  while (i < required.length) {
    const token = required[i];
    if (tokenInHaystack(token, haySet, compactHay)) {
      i += 1;
      continue;
    }
    if (isOptionalQueryToken(token, required)) {
      i += 1;
      continue;
    }

    let grouped = false;
    for (let len = Math.min(4, required.length - i); len >= 2; len -= 1) {
      const slice = required.slice(i, i + len);
      if (slice.every((part) => OPTIONAL_WORDS.has(part))) continue;
      const initial = slice
        .filter((part) => part && !/^\d/.test(part) && !OPTIONAL_WORDS.has(part))
        .map((part) => part[0])
        .join('');
      if (initial.length >= 2 && haySet.has(initial)) {
        i += len;
        grouped = true;
        break;
      }
      const phrase = slice.join(' ');
      const alts = phraseIndex.byPhrase.get(phrase);
      if (alts && alts.some((alt) => alt.split(' ').every((part) => haySet.has(canonToken(part))))) {
        i += len;
        grouped = true;
        break;
      }
    }
    if (!grouped) return false;
  }

  return true;
}

const ITEM_HINT =
  /(?:\d+\s*(?:\/\s*\d+\s*)?(?:oz|g|kg|dwt)|rcm|gml|sml|gbar|sbar|maple|eagle|pamp|mint|bar|coin|round|bullion|grams?\b|other\s+gold|plat|palladium|dna)/i;

/** True when the query is likely a product, not just a name or SO#. */
export function queryLooksLikeItem(query) {
  const q = String(query || '').trim();
  if (q.length < 2) return false;
  if (ITEM_HINT.test(q)) return true;
  const tokens = tokenize(q);
  return tokens.some((token) => phraseIndex.byPhrase.has(token));
}

export function rowMatchesQuery(row, query) {
  const q = String(query || '').trim();
  if (!q) return true;
  if (!row) return false;

  const haystacks = [
    row.searchText,
    row.itemSearchText,
    ...(Array.isArray(row.itemNames) ? row.itemNames : []),
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean);

  if (!haystacks.length) return false;
  return haystacks.some((text) => textMatchesQuery(text, q));
}
