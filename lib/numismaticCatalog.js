/**
 * Floor reference for collector coins and paper money.
 * Years and compositions are public Royal Canadian Mint / Bank of Canada facts.
 * No catalog prices — those change and belong in a quote, not this file.
 */

export const NUMISMATIC_TABS = [
  { key: 'coins', label: 'Coins' },
  { key: 'paper', label: 'Paper' },
  { key: 'desk', label: 'Desk' },
];

export const ACTIONS = {
  quote: { label: 'Quote', hint: 'Hold for numismatics. Do not melt.' },
  weigh: { label: 'Weigh', hint: 'Pay metal unless a key date or variety.' },
  check: { label: 'Check year', hint: 'Year or variety decides melt vs quote.' },
  face: { label: 'Face', hint: 'Circulating. Little collector or melt value.' },
  melt: { label: 'Melt', hint: 'Buy as scrap metal after a quick key-date check.' },
};

export const DESK_CARDS = [
  {
    id: 'silver-cutoff',
    title: 'Canadian silver cutoff',
    body: '10¢, 25¢, 50¢, and $1 dated 1967 and earlier are 80% silver (sterling before 1920). 1968 dimes and quarters started 50% silver, then switched to nickel the same year. 5¢ silver ends in 1921. Weigh the silver; then check the year before you melt.',
  },
  {
    id: 'never-melt',
    title: 'Never melt these',
    body: '1921 silver 5¢, 1921 50¢, 1948 silver dollar, and any 1936 “dot” cent, dime, or quarter. Photo both sides and hold for numismatics — these are the famous Canadian keys.',
  },
  {
    id: 'modern-clad',
    title: '1968 and later circulation',
    body: 'Most circulating Canadian coins from 1968 on are nickel or plated steel. They are not melt. Commemorative quarters, proof sets, and anything in a mint package can still be a quote.',
  },
  {
    id: 'paper',
    title: 'Paper money',
    body: 'Bank of Canada 1954 “Devil’s Face” and every earlier note is a quote. Birds, Journey, and polymer are usually face unless the note is a replacement, error, or uncirculated pack. Dominion and chartered-bank notes are always a quote.',
  },
  {
    id: 'photos',
    title: 'What to photograph',
    body: 'Obverse, reverse, and the edge. For varieties, a tight shot of the date, mint mark, and the area called out in the series note. Send the photos to numismatics rather than guessing a number on the floor.',
  },
  {
    id: 'world',
    title: 'World coins in a jar',
    body: 'US dimes, quarters, and halves 1964 and earlier are 90% silver. US halves 1965–1970 are 40% silver. UK coins before 1947 are sterling. Most modern world circulating coinage is face. Gold and older silver — weigh, then quote if the type looks scarce.',
  },
];

export const CATALOG = [
  {
    id: 'cent-large',
    tab: 'coins',
    group: '1¢ Cents',
    name: 'Large cent',
    years: '1858–1920',
    composition: 'Bronze (~95% copper)',
    metal: 'copper',
    action: 'check',
    keyDates: ['1858', '1859 wide 9', '1920 large'],
    note: 'Province of Canada 1858–1859, then Dominion. 1920 was struck in both large and small. Common dates are copper scrap in quantity; early Victoria and low-mintage years are a quote.',
  },
  {
    id: 'cent-small-bronze',
    tab: 'coins',
    group: '1¢ Cents',
    name: 'Small cent, bronze',
    years: '1920–1996',
    composition: 'Bronze (~95% copper)',
    metal: 'copper',
    action: 'check',
    keyDates: ['1923', '1925', '1936 dot'],
    note: 'Most dates are common. 1923 and 1925 are low mintage. The 1936 dot is rare — never melt. Bulk common bronze cents can be weighed as copper.',
  },
  {
    id: 'cent-plated',
    tab: 'coins',
    group: '1¢ Cents',
    name: 'Plated small cent',
    years: '1997–2012',
    composition: 'Copper-plated zinc (1997–1999), then copper-plated steel',
    metal: 'none',
    action: 'face',
    keyDates: [],
    note: 'Last circulation year 2012. Withdrawn in 2013. No melt worth taking. A full original roll or a proof can still be a quote.',
  },
  {
    id: 'nickel-silver',
    tab: 'coins',
    group: '5¢ Nickels',
    name: 'Silver 5¢',
    years: '1858–1921',
    composition: 'Sterling to 1919, then 80% silver (1920–1921)',
    metal: 'silver',
    action: 'quote',
    keyDates: ['1858', '1921'],
    note: 'The 1921 silver 5¢ is the King of Canadian Coins. Almost the whole mintage was melted. Any 1921 5¢ is a quote — do not weigh it into a melt lot. Other silver 5¢ dates are still collector coins first.',
  },
  {
    id: 'nickel-tombac-steel',
    tab: 'coins',
    group: '5¢ Nickels',
    name: 'Wartime 5¢',
    years: '1942–1945',
    composition: 'Tombac (1942–1943), chrome-plated steel (1944–1945)',
    metal: 'none',
    action: 'check',
    keyDates: ['1944 tombac', '1947 maple leaf'],
    note: '12-sided from 1942. Tombac is brass-looking; steel will stick to a magnet. 1943 and 1945 Victory “V” design. Common dates are face; odd compositions or mint errors are a quote.',
  },
  {
    id: 'nickel-modern',
    tab: 'coins',
    group: '5¢ Nickels',
    name: 'Nickel and steel 5¢',
    years: '1922–present',
    composition: 'Nickel, then nickel-plated steel (1982+), multi-ply steel (2000+)',
    metal: 'none',
    action: 'check',
    keyDates: ['1925', '1926 far 6'],
    note: '1925 and 1926 Far 6 are the keys of the nickel years. 12-sided 1942–1962 and again from 1982 (smaller). Common dates are face.',
  },
  {
    id: 'dime-sterling',
    tab: 'coins',
    group: '10¢ Dimes',
    name: 'Sterling dime',
    years: '1858–1919',
    composition: '92.5% silver',
    metal: 'silver',
    action: 'weigh',
    keyDates: ['1875-H', '1884', '1889'],
    note: 'Weigh as sterling unless the date is a key. 1875-H, 1884, and 1889 are scarce — pull those for a quote before they hit the melt.',
  },
  {
    id: 'dime-800',
    tab: 'coins',
    group: '10¢ Dimes',
    name: '80% silver dime',
    years: '1920–1967',
    composition: '80% silver, 20% copper',
    metal: 'silver',
    action: 'weigh',
    keyDates: ['1936 dot'],
    note: 'Standard Canadian silver dime. 1967 is the rabbit centennial. 1936 dot is rare. Common dates go to silver melt after a date check.',
  },
  {
    id: 'dime-1968',
    tab: 'coins',
    group: '10¢ Dimes',
    name: '1968 dime (mixed)',
    years: '1968',
    composition: '50% silver early, then nickel',
    metal: 'silver',
    action: 'check',
    keyDates: [],
    note: 'First 1968 dimes are 50% silver; later ones are nickel. Silver will not stick to a magnet. Nickel will. Weigh only the silver pieces.',
  },
  {
    id: 'dime-clad',
    tab: 'coins',
    group: '10¢ Dimes',
    name: 'Nickel and steel dime',
    years: '1968–present',
    composition: 'Nickel to 1999, multi-ply plated steel from 2000',
    metal: 'none',
    action: 'face',
    keyDates: [],
    note: 'No melt. Commemorative or proof issues in packaging can still be a quote.',
  },
  {
    id: 'quarter-sterling',
    tab: 'coins',
    group: '25¢ Quarters',
    name: 'Sterling quarter',
    years: '1870–1919',
    composition: '92.5% silver',
    metal: 'silver',
    action: 'weigh',
    keyDates: ['1875-H', '1889', '1891'],
    note: 'Weigh as sterling. 1875-H and 1889 are the dates to pull for a quote.',
  },
  {
    id: 'quarter-800',
    tab: 'coins',
    group: '25¢ Quarters',
    name: '80% silver quarter',
    years: '1920–1967',
    composition: '80% silver, 20% copper',
    metal: 'silver',
    action: 'weigh',
    keyDates: ['1936 dot'],
    note: '1967 is the lynx centennial. 1936 dot is rare. Common dates are silver melt.',
  },
  {
    id: 'quarter-1968',
    tab: 'coins',
    group: '25¢ Quarters',
    name: '1968 quarter (mixed)',
    years: '1968',
    composition: '50% silver early, then nickel',
    metal: 'silver',
    action: 'check',
    keyDates: [],
    note: 'Same story as the 1968 dime. Magnet test: silver stays off, nickel sticks. Weigh only silver.',
  },
  {
    id: 'quarter-commem',
    tab: 'coins',
    group: '25¢ Quarters',
    name: 'Commemorative quarters',
    years: '1992–present',
    composition: 'Nickel, then plated steel',
    metal: 'none',
    action: 'check',
    keyDates: ['1992 125th', '1999–2000 millennium', 'coloured'],
    note: 'Caribou circulation quarters are face. 1992 provincial, millennium, coloured, and mint-packaged sets can have a collector bid — quote the unusual ones.',
  },
  {
    id: 'half-silver',
    tab: 'coins',
    group: '50¢ Half dollars',
    name: 'Silver 50¢',
    years: '1870–1967',
    composition: 'Sterling to 1919, 80% silver 1920–1967',
    metal: 'silver',
    action: 'check',
    keyDates: ['1890-H', '1894', '1921'],
    note: '1921 is a major Canadian rarity. 1890-H and 1894 are also keys. Later silver 50¢ are often melt, but mintages are lumpy — check the year first.',
  },
  {
    id: 'half-clad',
    tab: 'coins',
    group: '50¢ Half dollars',
    name: 'Nickel and steel 50¢',
    years: '1968–present',
    composition: 'Nickel, later plated steel',
    metal: 'none',
    action: 'check',
    keyDates: [],
    note: 'Not a circulating coin for most people. Proof-like and specimen strikes from mint sets can be a quote. Common circulation strikes are face.',
  },
  {
    id: 'dollar-silver',
    tab: 'coins',
    group: '$1 Dollars',
    name: 'Silver dollar',
    years: '1935–1967',
    composition: '80% silver',
    metal: 'silver',
    action: 'check',
    keyDates: ['1948', '1947 maple leaf', '1945'],
    note: '1935 Voyageur is the first Canadian dollar. 1948 is the key of the series — never melt. 1945 and 1947 Maple Leaf are also scarce. 1967 is the goose. Common dates can be melt after a date check.',
  },
  {
    id: 'dollar-nickel',
    tab: 'coins',
    group: '$1 Dollars',
    name: 'Nickel voyageur dollar',
    years: '1968–1986',
    composition: 'Nickel',
    metal: 'none',
    action: 'check',
    keyDates: ['1982 Constitution', '1984 Jacques Cartier'],
    note: 'Same voyageur canoe, no silver. Commemorative types (Constitution, Cartier, and others) in nice condition can be a quote; worn circulation pieces are face.',
  },
  {
    id: 'dollar-loonie',
    tab: 'coins',
    group: '$1 Dollars',
    name: 'Loonie',
    years: '1987–present',
    composition: 'Aureate bronze, later brass-plated steel',
    metal: 'none',
    action: 'face',
    keyDates: ['1987'],
    note: 'Circulation loonies are face. First-year 1987, specimen, and mint-packaged commemoratives can be a quote.',
  },
  {
    id: 'toonie',
    tab: 'coins',
    group: '$2 Toonies',
    name: 'Toonie',
    years: '1996–present',
    composition: 'Bi-metallic: aluminum-bronze ring, nickel or steel core',
    metal: 'none',
    action: 'face',
    keyDates: ['1996'],
    note: 'Circulation toonies are face. 1996 first year and mint errors (rotated core, missing core) are a quote.',
  },
  {
    id: 'gold-five-ten',
    tab: 'coins',
    group: 'Gold',
    name: 'Canada $5 and $10 gold',
    years: '1912–1914',
    composition: '90% gold',
    metal: 'gold',
    action: 'quote',
    keyDates: ['1912', '1913', '1914'],
    note: 'Short pre-war issue. These are collector coins with a gold bid underneath. Photo and quote — do not toss them into a gold melt without a number from numismatics.',
  },
  {
    id: 'gold-sovereign',
    tab: 'coins',
    group: 'Gold',
    name: 'Canada sovereign',
    years: '1908–1919',
    composition: '22 karat (91.67% gold)',
    metal: 'gold',
    action: 'quote',
    keyDates: ['1908-C', '1916-C'],
    note: 'Ottawa Mint, “C” mint mark on the groundline. 1908-C and 1916-C are scarce. Treat as a numismatic gold coin, not a generic sovereign melt.',
  },
  {
    id: 'gold-bullion',
    tab: 'coins',
    group: 'Gold',
    name: 'Maple Leaf and modern bullion',
    years: '1979–present',
    composition: '24k gold Maple Leaf; silver, platinum, palladium siblings',
    metal: 'gold',
    action: 'weigh',
    keyDates: ['1982 1/4 oz', 'early fractional'],
    note: 'These are bullion, priced in Pricing / Trove, not this desk. Special privy marks, early fractionals, and impaired or counterfeit-looking pieces still get a second look.',
  },
  {
    id: 'us-90',
    tab: 'coins',
    group: 'World',
    name: 'US 90% silver',
    years: '–1964',
    composition: '90% silver dimes, quarters, halves, and dollars',
    metal: 'silver',
    action: 'weigh',
    keyDates: ['1916-D dime', '1909-S VDB cent', '1893-S dollar'],
    note: 'Standard US junk silver through 1964. Weigh the common dates. Famous US keys and any gold ($5, $10, $20) are a quote.',
  },
  {
    id: 'us-40',
    tab: 'coins',
    group: 'World',
    name: 'US 40% half dollars',
    years: '1965–1970',
    composition: '40% silver Kennedy halves',
    metal: 'silver',
    action: 'weigh',
    keyDates: [],
    note: 'Only the half dollar kept silver after 1964, and only through 1970. Dimes and quarters of these years are clad — face.',
  },
  {
    id: 'world-silver-gold',
    tab: 'coins',
    group: 'World',
    name: 'World silver and gold',
    years: 'varies',
    composition: 'Sterling, .800, .900, and fine gold are common',
    metal: 'silver',
    action: 'weigh',
    keyDates: [],
    note: 'UK before 1947 is sterling; 1947–1970 often 50% silver. Most euro-era circulating coinage is face. Gold sovereigns, 20 francs, and similar trade coins: weigh, then quote scarce dates.',
  },
  {
    id: 'paper-dominion',
    tab: 'paper',
    group: 'Canada',
    name: 'Dominion of Canada notes',
    years: '1870–1925',
    composition: 'Paper',
    metal: 'none',
    action: 'quote',
    keyDates: ['1870 25¢ shinplaster', '1897 $1', '1911 $1'],
    note: 'Issued before the Bank of Canada. Every denomination is a quote, including the 25¢ “shinplaster.” Condition and signature variety move the number a lot.',
  },
  {
    id: 'paper-chartered',
    tab: 'paper',
    group: 'Canada',
    name: 'Chartered bank notes',
    years: '–1944',
    composition: 'Paper',
    metal: 'none',
    action: 'quote',
    keyDates: [],
    note: 'Private Canadian banks issued their own notes into the 1930s and 1940s. Bank name, denomination, and condition decide the bid. Always a quote.',
  },
  {
    id: 'paper-1935',
    tab: 'paper',
    group: 'Canada',
    name: 'Bank of Canada 1935',
    years: '1935',
    composition: 'Paper',
    metal: 'none',
    action: 'quote',
    keyDates: ['$25 commemorative', '$500', '$1000'],
    note: 'First Bank of Canada issue. English and French were printed as separate notes. All denominations are a quote, especially $25 and the high values.',
  },
  {
    id: 'paper-1937',
    tab: 'paper',
    group: 'Canada',
    name: 'Bank of Canada 1937',
    years: '1937',
    composition: 'Paper',
    metal: 'none',
    action: 'quote',
    keyDates: ['Osborne-Towers'],
    note: 'Bilingual notes. Osborne-Towers signatures are scarcer. Still a quote in any grade above junk.',
  },
  {
    id: 'paper-1954-devil',
    tab: 'paper',
    group: 'Canada',
    name: '1954 Devil’s Face',
    years: '1954',
    composition: 'Paper',
    metal: 'none',
    action: 'quote',
    keyDates: ['Devil’s Face'],
    note: 'Early 1954 portraits show a devil’s face in the Queen’s hair. The plate was modified the same year. Devil’s Face notes are always a quote. Modified 1954 can still be a quote in high grade or as a replacement.',
  },
  {
    id: 'paper-1954-mod',
    tab: 'paper',
    group: 'Canada',
    name: '1954 modified',
    years: '1954–1967',
    composition: 'Paper',
    metal: 'none',
    action: 'check',
    keyDates: ['asterisk replacement', '$1 1867–1967'],
    note: 'The common “modified hair” 1954 issue. Worn $1 and $2 are often face-to-small-premium. Asterisk replacements, high denominations, and the 1967 centennial $1 are a quote.',
  },
  {
    id: 'paper-scenes',
    tab: 'paper',
    group: 'Canada',
    name: 'Scenes of Canada',
    years: '1969–1979',
    composition: 'Paper',
    metal: 'none',
    action: 'check',
    keyDates: ['asterisk / replacement'],
    note: 'The multi-colour scenes series. Circulated $1–$20 are usually face. Replacements, $50, $100, and uncirculated packs are a quote.',
  },
  {
    id: 'paper-birds',
    tab: 'paper',
    group: 'Canada',
    name: 'Birds of Canada',
    years: '1986–1991',
    composition: 'Paper',
    metal: 'none',
    action: 'face',
    keyDates: ['replacement', 'insert'],
    note: 'Circulated birds are face. Uncirculated original packs, replacements, and errors are a quote.',
  },
  {
    id: 'paper-journey',
    tab: 'paper',
    group: 'Canada',
    name: 'Canadian Journey',
    years: '2001–2006',
    composition: 'Paper',
    metal: 'none',
    action: 'face',
    keyDates: ['$5', 'replacement'],
    note: 'Hologram-strip paper notes. Circulated pieces are face. Packs and replacements can still be a quote.',
  },
  {
    id: 'paper-polymer',
    tab: 'paper',
    group: 'Canada',
    name: 'Polymer',
    years: '2011–present',
    composition: 'Polymer',
    metal: 'none',
    action: 'face',
    keyDates: ['error', 'replacement'],
    note: 'Current notes. Face unless the note is an error, a replacement, or an original bundle. Do not buy polymer at a premium on the floor.',
  },
  {
    id: 'paper-world',
    tab: 'paper',
    group: 'World',
    name: 'World paper money',
    years: 'varies',
    composition: 'Paper or polymer',
    metal: 'none',
    action: 'quote',
    keyDates: [],
    note: 'US large-size, Confederate, and early European notes are a quote. Modern circulated world notes are usually face. When the pile is mixed, photo the oldest and highest denominations.',
  },
];

function yearBounds(years) {
  const text = String(years || '');
  const nums = text.match(/\d{4}/g);
  if (!nums?.length) return null;
  const first = Number(nums[0]);
  if (!Number.isFinite(first)) return null;
  if (nums.length > 1) {
    const second = Number(nums[1]);
    return { start: first, end: Number.isFinite(second) ? Math.max(first, second) : first };
  }
  if (/^[\s–—-]/.test(text.trim())) return { start: 1, end: first };
  return { start: first, end: first };
}

export function seriesCoversYear(item, year) {
  const n = Number(year);
  if (!Number.isFinite(n)) return false;
  if ((item.keyDates || []).some((date) => String(date).includes(String(n)))) return true;
  const bounds = yearBounds(item.years);
  if (!bounds) return false;
  return n >= bounds.start && n <= bounds.end;
}

export function itemHaystack(item) {
  return [
    item.name,
    item.years,
    item.composition,
    item.note,
    item.group,
    item.action,
    item.metal,
    ...(item.keyDates || []),
  ]
    .filter(Boolean)
    .join(' ');
}

export function catalogGroups(tab) {
  const seen = new Set();
  const groups = [];
  for (const item of CATALOG) {
    if (tab && item.tab !== tab) continue;
    if (seen.has(item.group)) continue;
    seen.add(item.group);
    groups.push(item.group);
  }
  return groups;
}

export function filterCatalog(tab, query, group) {
  const raw = String(query || '').trim();
  const yearOnly = /^\d{4}$/.test(raw) ? Number(raw) : null;
  const items = [];
  for (const item of CATALOG) {
    if (tab && item.tab !== tab) continue;
    if (group && item.group !== group) continue;
    if (yearOnly != null) {
      if (seriesCoversYear(item, yearOnly)) items.push(item);
      continue;
    }
    if (!raw) {
      items.push(item);
      continue;
    }
    const hay = itemHaystack(item).toLowerCase();
    const tokens = raw.toLowerCase().split(/\s+/).filter(Boolean);
    if (tokens.every((token) => hay.includes(token))) items.push(item);
  }
  return items;
}
