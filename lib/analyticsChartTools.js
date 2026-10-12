import AsyncStorage from '@react-native-async-storage/async-storage';
import { WEEKDAYS, formatMeasure, isRetailStore, weekdayName } from './employeeMetrics';
import { proxyFetch, proxyJson } from './proxy';
import { HOME_PINNED_STORES, canonicalStoreName, storesMatch } from './storeCatalog';
import { COMPANY_DATA_SOURCES, loadCompanyData } from './aiChat';
import { authHeaders, posFetch } from './auth';
import { fetchInventoryMatrix, fetchProductInventory, peekInventoryMatrix } from './inventory';
import { fetchBullionAuditStores } from './bullionAudit';
import { loadItemCatalog } from './itemAudit';
import { loadCustomerProfile, searchClients } from './triageLookups';
import {
  fetchTransactionsAcrossPos,
  formatDateParam,
  parseDateParam,
  posSourcesFromSession,
} from './transactions';
import { addUsage, readOpenRouterUsage } from './openrouterPricing';

const FSA_CACHE_KEY = 'cgold.analytics.postalPoints';
const PLACE_CACHE_KEY = 'cgold.analytics.customerPoints';
const MAX_NEW_GEOCODES = 600;
const MAX_CUSTOMER_LOOKUPS = 1200;
const MAX_LINE_POINTS = 92;
const MAX_MARKER_CUSTOMERS = 12;
const MAX_BARS = 30;
const MAX_PIE_SLICES = 8;

export const ANALYTICS_CHAT_MODELS = [
  { key: 'anthropic/claude-sonnet-5', label: 'Claude Sonnet 5' },
  { key: 'anthropic/claude-sonnet-4.6', label: 'Claude Sonnet 4.6' },
  { key: 'anthropic/claude-haiku-4.5', label: 'Claude Haiku 4.5' },
  { key: 'x-ai/grok-4.7', label: 'Grok 4.7' },
  { key: 'x-ai/grok-4.6', label: 'Grok 4.6' },
  { key: 'x-ai/grok-4.20', label: 'Grok 4.20' },
  { key: 'x-ai/grok-4.3', label: 'Grok 4.3' },
  { key: 'openai/gpt-4.1', label: 'GPT-4.1' },
  { key: 'openai/gpt-4.1-mini', label: 'GPT-4.1 mini' },
  { key: 'openai/gpt-4o-mini', label: 'GPT-4o mini' },
];

const MEASURES = {
  transactions: { label: 'Transactions', format: 'int' },
  volume: { label: 'Volume', format: 'money' },
  buys: { label: 'Buys', format: 'int' },
  sells: { label: 'Sells', format: 'int' },
  buyVolume: { label: 'Buy volume', format: 'money' },
  sellVolume: { label: 'Sell volume', format: 'money' },
  avgTicket: { label: 'Avg ticket', format: 'money' },
};

const LINE_GROUPS = new Set(['date', 'weekday', 'employee', 'store', 'txType']);
const BAR_GROUPS = new Set(['employee', 'store', 'weekday', 'txType', 'date']);
const PIE_GROUPS = new Set(['store', 'employee', 'txType', 'weekday']);

const MAX_RANGE_DAYS = 92;
const RANGE_CACHE_LIMIT = 6;
const rangeCache = new Map();

const SCOPE_PROPERTIES = {
  startDate: {
    type: 'string',
    description:
      'YYYY-MM-DD. Set this and endDate whenever the user names a period (past month, last week, September). Omit to use the dates loaded on screen.',
  },
  endDate: { type: 'string', description: 'YYYY-MM-DD, inclusive.' },
  stores: {
    type: 'array',
    items: { type: 'string' },
    description:
      'Store names from the Stores list, when the user asks about one or more stores (["Montreal", "Laval"]). Omit for all stores.',
  },
};

// Narrow any transaction tool to a slice of the ledger: who, where they live,
// what they bought or sold, how much. All optional; all combine with AND.
const FILTER_PROPERTIES = {
  postalPrefixes: {
    type: 'array',
    items: { type: 'string' },
    description:
      'Customer home postal code starts with any of these. Use the 3-character forward sortation area for a neighbourhood: Griffintown is ["H3C"], Westmount ["H3Y","H3Z"], NDG ["H4A","H4B"], Laval ["H7"]. Several areas at once are fine.',
  },
  cities: {
    type: 'array',
    items: { type: 'string' },
    description: 'Customer home city on the POS record, such as ["Laval", "Longueuil"].',
  },
  customer: { type: 'string', description: 'Customer name contains these words.' },
  employee: { type: 'string', description: 'Employee (seller or buyer) name contains these words.' },
  product: {
    type: 'string',
    description: 'Line items contain these words, such as "gold maple", "GBAR", "scrap 14k", "silver".',
  },
  txType: { type: 'string', enum: ['buy', 'sell', 'all'], description: 'buy is a PO (we bought), sell is an SO (we sold). Default all.' },
  minAmount: { type: 'number', description: 'Keep tickets at or above this dollar total.' },
  maxAmount: { type: 'number', description: 'Keep tickets at or below this dollar total.' },
  paymentMethod: { type: 'string', description: 'Payment method contains these words, such as "cash", "debit", "e-transfer".' },
};

const FILTER_KEYS = Object.keys(FILTER_PROPERTIES);

const QUERY_GROUPS = ['employee', 'store', 'customer', 'date', 'weekday', 'txType', 'none'];

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'lookup_company_data',
      description:
        'Read live company data outside the transaction ledger: inventory stock on hand, cash tills, hours and who is clocked in, Google reviews, phone answering, emails, website metal prices, FINTRAC cash deals, cash and debit payments, bonuses, staff directory, teams, bullion audit variances, premium jewelry. Pick only the datasets the question needs. Everything comes back as real figures.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          sources: {
            type: 'array',
            minItems: 1,
            maxItems: 4,
            items: { type: 'string', enum: COMPANY_DATA_SOURCES.map((source) => source.key) },
          },
          inventorySearch: {
            type: 'string',
            description:
              'With the inventory source: words the product must match, such as "1 oz gold bar", "gold maple leaf", "GML", "SML", or "RCM". GBAR/GML/SML/RCM codes count. Leave empty for the whole stock list.',
          },
          ...SCOPE_PROPERTIES,
        },
        required: ['sources'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'inventory_history',
      description:
        'Stock on hand over time, straight from the POS: the system quantity of a product at each store on each day of a date range. Use this for any question about how inventory changed, trended, rose, fell, or compared across days or weeks ("1 oz gold bars this past month", "how many silver maples did Toronto have each week"). It returns the day-by-day numbers and draws the line chart for you; do not call draw_chart afterwards unless the user asks for a different picture.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          search: {
            type: 'string',
            description: 'Product words, such as "1 oz gold bar", "GML 1oz", "silver maple", "RCM". House codes GBAR/SBAR/GML/SML/RCM count.',
          },
          chart: {
            type: 'string',
            enum: ['line', 'bar', 'none'],
            description: 'line (default) draws the trend; bar compares the sampled dates; none returns numbers only.',
          },
          ...SCOPE_PROPERTIES,
        },
        required: ['search'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_customers',
      description:
        'Find customers in the POS by name, phone, or email across all three POS systems, with their home store, last visit, and ticket counts. Set details true to also get that customer\'s recent tickets.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          query: { type: 'string', description: 'Name, phone, or email. At least 2 characters.' },
          details: { type: 'boolean', description: 'Also load the best match\'s recent tickets.' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'query_transactions',
      description:
        'Aggregate POS transactions: totals, rankings, top customers, repeat customers, comparisons across stores or dates, grouped one row per employee, store, customer, date, weekday, or buy/sell. Filters narrow the slice first (a postal area, a city, a product, a payment method, an amount range). Every figure comes from the POS.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          groupBy: {
            type: 'string',
            enum: QUERY_GROUPS,
            description: 'One row per employee, store, customer, date, weekday, buy/sell, or "none" for one total row.',
          },
          sortBy: { type: 'string', enum: Object.keys(MEASURES), description: 'Highest first. Default transactions.' },
          limit: { type: 'integer', minimum: 1, maximum: 50, description: 'Rows to return. Default 10.' },
          minTransactions: {
            type: 'integer',
            minimum: 1,
            description: 'Keep only rows with at least this many transactions. Use 2 for repeat customers.',
          },
          ...SCOPE_PROPERTIES,
          ...FILTER_PROPERTIES,
        },
        required: ['groupBy'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_transactions',
      description:
        'The individual tickets (PO# and SO# numbers) that match a question, as a sortable table: date, type, store, employee, customer, postal code, items, amount. Use this whenever the user wants the actual transactions, ticket numbers, or a list rather than a total: "which POs came from Griffintown", "list the sales over $5,000 in Laval", "show the tickets for that customer". Filters narrow the slice; the table is drawn for you. Ticket numbers in your answer become links the user can open.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string', description: 'What the list is, such as "Griffintown tickets · Montreal · past month".' },
          sortBy: { type: 'string', enum: ['date', 'amount'], description: 'date newest first (default) or amount highest first.' },
          limit: { type: 'integer', minimum: 1, maximum: 60, description: 'Rows to show. Default 40.' },
          ...SCOPE_PROPERTIES,
          ...FILTER_PROPERTIES,
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'show_line_chart',
      description:
        'Draw a line chart of POS transactions only. The app computes every number from the ledger. Use this for trends over dates or weekdays and for how two measures move together. Filters narrow the slice first. For other numbers, use draw_chart.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string' },
          measures: {
            type: 'array',
            minItems: 1,
            maxItems: 2,
            items: { type: 'string', enum: Object.keys(MEASURES) },
          },
          groupBy: { type: 'string', enum: [...LINE_GROUPS] },
          ...SCOPE_PROPERTIES,
          ...FILTER_PROPERTIES,
        },
        required: ['measures', 'groupBy'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'show_bar_chart',
      description:
        'Draw a bar chart of POS transactions only. The app computes every number from the ledger; the labels are always employees, stores, dates, weekdays, or buy/sell. Use this to compare employees or stores, for example transactions per employee, ranked highest first. Filters narrow the slice first. For stock, tills, hours, or any other numbers, use draw_chart.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string' },
          measures: {
            type: 'array',
            minItems: 1,
            maxItems: 2,
            items: { type: 'string', enum: Object.keys(MEASURES) },
          },
          groupBy: { type: 'string', enum: [...BAR_GROUPS] },
          ...SCOPE_PROPERTIES,
          ...FILTER_PROPERTIES,
        },
        required: ['measures', 'groupBy'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'show_pie_chart',
      description:
        'Draw a pie chart of POS transactions only. The app computes every slice from the ledger. Use this for a share of one measure across stores, employees, buy versus sell, or weekdays. Filters narrow the slice first. For other numbers, use draw_chart.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string' },
          measure: { type: 'string', enum: Object.keys(MEASURES) },
          groupBy: { type: 'string', enum: [...PIE_GROUPS] },
          ...SCOPE_PROPERTIES,
          ...FILTER_PROPERTIES,
        },
        required: ['measure', 'groupBy'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'draw_chart',
      description:
        'Draw a bar, line, or pie chart from numbers you already have from a tool result: inventory counts by SKU or store, till balances, hours, reviews, FINTRAC counts, payment mixes, or any other figures that are not plain POS transactions. Pass the labels and values exactly as the tool returned them. Do not use this for transaction counts or volume; the show_*_chart tools compute those from the ledger.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          type: { type: 'string', enum: ['bar', 'line', 'pie'] },
          title: { type: 'string', description: 'What the chart shows, such as "Montreal 1 oz gold bars by SKU".' },
          subtitle: { type: 'string', description: 'Where the numbers came from and what they cover, such as "Live stock · Montreal".' },
          format: {
            type: 'string',
            enum: ['int', 'decimal', 'money', 'hours'],
            description: 'How to print the values. int for counts, decimal for fractions, money for dollars, hours for time.',
          },
          categories: {
            type: 'array',
            minItems: 1,
            maxItems: 40,
            items: { type: 'string' },
            description: 'Bar or line labels in order, one per point. Omit for a pie chart.',
          },
          series: {
            type: 'array',
            minItems: 1,
            maxItems: 6,
            description: 'Bar or line series, one per store or product. Each values array lines up with categories.',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                label: { type: 'string' },
                values: { type: 'array', items: { type: 'number' } },
                format: { type: 'string', enum: ['int', 'decimal', 'money', 'hours'] },
              },
              required: ['label', 'values'],
            },
          },
          slices: {
            type: 'array',
            minItems: 1,
            maxItems: 12,
            description: 'Pie slices. Omit for bar or line.',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                name: { type: 'string' },
                value: { type: 'number' },
              },
              required: ['name', 'value'],
            },
          },
        },
        required: ['type', 'title'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'show_table',
      description:
        'Show numbers as a sortable table. Use this whenever the user asks for a table, a list with several columns, or a breakdown that reads better as rows than as a chart: stock by SKU, tills by store, hours by employee, a ranking with more than one figure per row. Pass the rows exactly as the tool result gave them. Never write a table in markdown text; call this instead.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string', description: 'What the table shows, such as "Montreal 1 oz gold bars on hand".' },
          subtitle: { type: 'string', description: 'Source and coverage, such as "Live stock · Montreal".' },
          columns: {
            type: 'array',
            minItems: 1,
            maxItems: 8,
            description: 'Columns in display order. key matches the row field; format tells the app how to print numbers.',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                key: { type: 'string' },
                label: { type: 'string' },
                format: { type: 'string', enum: ['text', 'int', 'decimal', 'money', 'hours'] },
              },
              required: ['key', 'label'],
            },
          },
          rows: {
            type: 'array',
            minItems: 1,
            maxItems: 60,
            description: 'One object per row, keyed by column key. Numbers as numbers, not strings.',
            items: { type: 'object' },
          },
          total: {
            type: 'object',
            description: 'Optional footer row keyed by column key, such as {"sku": "Total", "qty": 22}.',
          },
          note: { type: 'string', description: 'Optional one-line caveat shown under the table.' },
        },
        required: ['title', 'columns', 'rows'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'show_area_map',
      description:
        'Outline a neighbourhood, borough, city, or region on a map, with no customer data: "where is NDG", "show me Griffintown on the map", "outline Laval". Pure geography. Add customers: true only when the user asks to see customers inside that area as well.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          places: {
            type: 'array',
            minItems: 1,
            maxItems: 5,
            items: { type: 'string' },
            description: 'Official place names with the city, such as ["Notre-Dame-de-Grâce, Montreal"], ["Le Plateau-Mont-Royal, Montreal"], ["Westmount, Quebec", "Hampstead, Quebec"]. Spell out abbreviations (NDG is Notre-Dame-de-Grâce). For a Montreal neighbourhood without its own boundary, the borough works: "Côte-des-Neiges–Notre-Dame-de-Grâce, Montreal".',
          },
          title: { type: 'string' },
          customers: {
            type: 'boolean',
            description: 'Also plot the customers for the scope (dates, stores, filters) as dots over the outline. Default false.',
          },
          ...SCOPE_PROPERTIES,
          ...FILTER_PROPERTIES,
        },
        required: ['places'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'show_customer_map',
      description:
        'Show an interactive map of where customers live, geocoded from the home address on their POS customer record (postal code when there is no street). "Customers of the Montreal store" means stores: ["Montreal"] with no city. Only set city when the user asks about customers who live in a city.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string' },
          style: {
            type: 'string',
            enum: ['dots', 'heat'],
            description: 'heat when the user asks for a heat map or density; dots otherwise.',
          },
          city: {
            type: 'string',
            description: 'Optional. Keep only customers whose home city matches, such as Laval.',
          },
          ...SCOPE_PROPERTIES,
          ...FILTER_PROPERTIES,
        },
        required: [],
      },
    },
  },
];

function fold(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function inStore(row, stores) {
  const name = String(row?.storeName || '').trim() || '—';
  if (!isRetailStore(name)) return false;
  if (!stores?.length) return true;
  return stores.some(
    (store) => storesMatch(name, store) || name.localeCompare(store, undefined, { sensitivity: 'base' }) === 0,
  );
}

function retailRows(rows, stores) {
  return (Array.isArray(rows) ? rows : []).filter(
    (row) => row && (row.type === 'order' || row.type === 'purchase') && inStore(row, stores),
  );
}

export function storeNamesIn(rows) {
  const names = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const raw = String(row?.storeName || '').trim();
    if (!raw || !isRetailStore(raw)) continue;
    const name = canonicalStoreName(raw) || raw;
    names.set(fold(name), name);
  }
  return [...names.values()].sort((a, b) => a.localeCompare(b));
}

function matchStore(wanted, rows) {
  const needle = fold(wanted);
  if (!needle) return '';
  const names = storeNamesIn(rows);
  const exact = names.find((name) => fold(name) === needle || fold(canonicalStoreName(name)) === fold(canonicalStoreName(wanted)));
  if (exact) return exact;
  const loose = names.filter((name) => fold(name).includes(needle) || needle.includes(fold(name)));
  return loose.length === 1 ? loose[0] : '';
}

function isoDate(value) {
  const text = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}

function dayCount(start, end) {
  return Math.round((parseDateParam(end) - parseDateParam(start)) / 86400000) + 1;
}

function rangeLabel(start, end) {
  const from = parseDateParam(start);
  const to = parseDateParam(end);
  const opts = { month: 'short', day: 'numeric' };
  if (start === end) return to.toLocaleDateString('en-CA', { ...opts, year: 'numeric' });
  const sameYear = from.getFullYear() === to.getFullYear();
  return `${from.toLocaleDateString('en-CA', sameYear ? opts : { ...opts, year: 'numeric' })} – ${to.toLocaleDateString('en-CA', { ...opts, year: 'numeric' })}`;
}

async function fetchRange(session, startDate, endDate, signal) {
  const key = `${startDate}|${endDate}`;
  if (rangeCache.has(key)) return rangeCache.get(key);
  if (!session?.token) throw new Error('Sign in again to load other dates.');
  const result = await fetchTransactionsAcrossPos(session, { startDate, endDate, includePurchases: true });
  if (signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
  const rows = Array.isArray(result?.rows) ? result.rows : [];
  if (rangeCache.size >= RANGE_CACHE_LIMIT) rangeCache.delete(rangeCache.keys().next().value);
  rangeCache.set(key, rows);
  return rows;
}

function resolveDates(args, context) {
  const loadedStart = isoDate(context.startDate);
  const loadedEnd = isoDate(context.endDate);
  let startDate = isoDate(args?.startDate) || loadedStart;
  let endDate = isoDate(args?.endDate) || (isoDate(args?.startDate) ? startDate : loadedEnd);
  if (!startDate || !endDate) return { error: 'Dates must be YYYY-MM-DD.' };
  if (startDate > endDate) [startDate, endDate] = [endDate, startDate];
  const today = formatDateParam(new Date());
  if (endDate > today) endDate = today;
  if (startDate > today) return { error: 'That range is in the future.' };
  const days = dayCount(startDate, endDate);
  if (days > MAX_RANGE_DAYS) {
    return { error: `That range is ${days} days. Ask for ${MAX_RANGE_DAYS} days or fewer.` };
  }
  return { startDate, endDate };
}

/**
 * Which transactions a tool call is about: the on-screen rows, or a different
 * range fetched from the POS, narrowed to one store when asked.
 */
async function resolveScope(args, context) {
  const dates = resolveDates(args, context);
  if (dates.error) return dates;
  const { startDate, endDate } = dates;

  let rows = context.rows;
  const sameRange = startDate === isoDate(context.startDate) && endDate === isoDate(context.endDate);
  if (!sameRange) {
    context.onStatus?.(`Loading ${rangeLabel(startDate, endDate)}…`);
    rows = await fetchRange(context.session, startDate, endDate, context.signal);
  }

  // Stores named in the question win over the Home store lock.
  const lock = String(context.storeFilter || '').trim();
  const asked = [
    ...(Array.isArray(args?.stores) ? args.stores : []),
    ...(args?.store ? [args.store] : []),
  ]
    .map((item) => String(item || '').trim())
    .filter(Boolean);
  let stores = lock ? [lock] : [];
  if (asked.length) {
    stores = [];
    const unknown = [];
    for (const wanted of asked) {
      const match = matchStore(wanted, rows);
      if (match && !stores.includes(match)) stores.push(match);
      else if (!match) unknown.push(wanted);
    }
    if (unknown.length) {
      const names = storeNamesIn(rows);
      return {
        error: names.length
          ? `No store called ${unknown.join(' or ')} in ${rangeLabel(startDate, endDate)}. Stores with transactions: ${names.join(', ')}.`
          : `No transactions in ${rangeLabel(startDate, endDate)}.`,
      };
    }
  }
  const unfiltered = retailRows(rows, stores);
  const filters = readFilters(args);
  const source = filters.active ? unfiltered.filter((row) => rowPassesFilters(row, filters)) : unfiltered;
  const storeLabel = stores.length ? stores.join(', ') : 'All stores';
  const filterLabel = filters.active ? ` · ${filters.label}` : '';
  const scope = {
    startDate,
    endDate,
    store: stores.length === 1 ? stores[0] : '',
    stores,
    label: `${storeLabel} · ${rangeLabel(startDate, endDate)}${filterLabel}`,
    transactions: source.length,
    filters: filters.active ? filters.summary : undefined,
    beforeFilters: filters.active ? unfiltered.length : undefined,
  };
  return { source, scope };
}

function words(value) {
  return fold(value)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function readFilters(args) {
  const list = (value) =>
    (Array.isArray(value) ? value : value ? [value] : []).map((item) => String(item || '').trim()).filter(Boolean);
  const postalPrefixes = list(args?.postalPrefixes).map((item) => item.toUpperCase().replace(/\s+/g, ''));
  const cities = list(args?.cities).map(fold);
  const customer = words(args?.customer);
  const employee = words(args?.employee);
  const product = words(args?.product);
  const paymentMethod = words(args?.paymentMethod);
  const txType = ['buy', 'sell'].includes(String(args?.txType || '').toLowerCase()) ? String(args.txType).toLowerCase() : '';
  const minAmount = Number.isFinite(Number(args?.minAmount)) && args?.minAmount != null ? Number(args.minAmount) : null;
  const maxAmount = Number.isFinite(Number(args?.maxAmount)) && args?.maxAmount != null ? Number(args.maxAmount) : null;
  const parts = [];
  if (postalPrefixes.length) parts.push(`postal ${postalPrefixes.join('/')}`);
  if (cities.length) parts.push(list(args?.cities).join('/'));
  if (customer.length) parts.push(`customer "${String(args.customer).trim()}"`);
  if (employee.length) parts.push(`employee "${String(args.employee).trim()}"`);
  if (product.length) parts.push(`items "${String(args.product).trim()}"`);
  if (txType) parts.push(txType === 'buy' ? 'POs' : 'SOs');
  if (minAmount != null && maxAmount != null) parts.push(`$${minAmount}–$${maxAmount}`);
  else if (minAmount != null) parts.push(`≥ $${minAmount}`);
  else if (maxAmount != null) parts.push(`≤ $${maxAmount}`);
  if (paymentMethod.length) parts.push(`paid by "${String(args.paymentMethod).trim()}"`);
  return {
    active: parts.length > 0,
    label: parts.join(' · '),
    summary: Object.fromEntries(FILTER_KEYS.filter((key) => args?.[key] != null && args[key] !== '').map((key) => [key, args[key]])),
    postalPrefixes,
    cities,
    customer,
    employee,
    product,
    paymentMethod,
    txType,
    minAmount,
    maxAmount,
  };
}

function containsAllWords(haystack, needles) {
  if (!needles.length) return true;
  const text = fold(haystack);
  return needles.every((needle) => text.includes(needle));
}

function rowPassesFilters(row, filters) {
  if (filters.postalPrefixes.length) {
    const postal = String(row.customerPostal || '').toUpperCase().replace(/\s+/g, '');
    if (!postal || !filters.postalPrefixes.some((prefix) => postal.startsWith(prefix))) return false;
  }
  if (filters.cities.length) {
    const city = fold(row.customerCity);
    if (!city || !filters.cities.some((wanted) => city === wanted || city.includes(wanted) || wanted.includes(city))) return false;
  }
  if (filters.txType === 'buy' && row.type !== 'purchase') return false;
  if (filters.txType === 'sell' && row.type !== 'order') return false;
  if (filters.minAmount != null && (Number(row.amount) || 0) < filters.minAmount) return false;
  if (filters.maxAmount != null && (Number(row.amount) || 0) > filters.maxAmount) return false;
  if (!containsAllWords(row.customerName, filters.customer)) return false;
  if (!containsAllWords(`${row.employeeName || ''} ${row.created_by || ''}`, filters.employee)) return false;
  if (filters.product.length) {
    const items = `${(row.itemNames || []).join(' ')} ${row.itemSearchText || ''} ${row.searchText || ''}`;
    if (!containsAllWords(items, filters.product)) return false;
  }
  if (!containsAllWords(`${row.paymentMethods || ''} ${row.paymentMethodLabel || ''}`, filters.paymentMethod)) return false;
  return true;
}

const LIST_DEFAULT = 40;
const LIST_MAX = 60;

function ticketRef(row) {
  return row.reference || `${row.type === 'purchase' ? 'PO' : 'SO'}# ${row.sourceId}`;
}

/** The matching tickets themselves, as a table the user can open row by row. */
function listTransactions(args, scoped) {
  const { source, scope } = scoped;
  if (!source.length) {
    return {
      error: scope.beforeFilters
        ? `${scope.beforeFilters} transactions for ${scope.label.split(' · ').slice(0, 2).join(' · ')}, but none match ${scope.label.split(' · ').slice(2).join(' · ')}.`
        : `No transactions for ${scope.label}.`,
    };
  }
  const sortBy = String(args?.sortBy || 'date').toLowerCase() === 'amount' ? 'amount' : 'date';
  const limit = Math.min(LIST_MAX, Math.max(1, Number(args?.limit) || LIST_DEFAULT));
  const sorted = source.slice().sort((a, b) =>
    sortBy === 'amount'
      ? (Number(b.amount) || 0) - (Number(a.amount) || 0)
      : String(b.date || '').localeCompare(String(a.date || '')),
  );
  const shown = sorted.slice(0, limit);
  const total = source.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
  const buys = source.filter((row) => row.type === 'purchase').length;

  const rows = shown.map((row) => ({
    ticket: ticketRef(row),
    date: formatDateParam(row.date),
    type: row.type === 'purchase' ? 'PO' : 'SO',
    store: String(row.storeName || '').trim() || '—',
    employee: String(row.employeeName || '').trim() || '—',
    customer: String(row.customerName || '').trim() || '—',
    postal: String(row.customerPostal || '').toUpperCase().trim() || '',
    items: (row.itemNames || []).slice(0, 3).join(', ').slice(0, 60),
    amount: Math.round((Number(row.amount) || 0) * 100) / 100,
  }));
  const columns = [
    { key: 'ticket', label: 'Ticket', format: 'text' },
    { key: 'date', label: 'Date', format: 'text' },
    { key: 'type', label: 'Type', format: 'text' },
    { key: 'store', label: 'Store', format: 'text' },
    { key: 'employee', label: 'Employee', format: 'text' },
    { key: 'customer', label: 'Customer', format: 'text' },
    { key: 'postal', label: 'Postal', format: 'text' },
    { key: 'items', label: 'Items', format: 'text' },
    { key: 'amount', label: 'Amount', format: 'money' },
  ].filter((column) => column.key !== 'postal' || rows.some((row) => row.postal));
  if (scope.stores.length === 1) columns.splice(columns.findIndex((column) => column.key === 'store'), 1);

  const title = cleanTitle(args?.title, `${source.length} ${source.length === 1 ? 'ticket' : 'tickets'}`);
  const chart = {
    type: 'table',
    title,
    subtitle: scope.label,
    columns,
    rows,
    footer: { ticket: shown.length < source.length ? `Total (${source.length})` : 'Total', amount: Math.round(total * 100) / 100 },
    note: shown.length < source.length ? `Showing ${shown.length} of ${source.length}, ${sortBy === 'amount' ? 'highest first' : 'newest first'}.` : undefined,
    tickets: shown.map((row) => ({
      reference: ticketRef(row),
      type: row.type === 'purchase' ? 'purchase' : 'order',
      sourceId: String(row.sourceId),
      systemKey: row.systemKey || 'east',
    })),
  };
  return {
    chart,
    modelResult: {
      title,
      scope: scope.label,
      matched: source.length,
      shown: shown.length,
      buys,
      sells: source.length - buys,
      totalAmount: formatMeasure(total, 'money'),
      filters: scope.filters,
      tickets: rows.map((row) => ({
        ticket: row.ticket,
        date: row.date,
        type: row.type,
        store: row.store,
        employee: row.employee,
        customer: row.customer,
        postal: row.postal || undefined,
        items: row.items || undefined,
        amount: formatMeasure(row.amount, 'money'),
      })),
      note: 'The table is on screen. Mention the count and total; name a few tickets by their PO#/SO# only if the user asked about specific ones.',
    },
  };
}

function groupLabel(row, groupBy) {
  if (groupBy === 'date') return formatDateParam(row.date);
  if (groupBy === 'weekday') return weekdayName(row.date);
  if (groupBy === 'store') return String(row.storeName || '').trim() || '—';
  if (groupBy === 'employee') return String(row.employeeName || '').trim() || '—';
  if (groupBy === 'txType') return row.type === 'purchase' ? 'Buy' : 'Sell';
  if (groupBy === 'customer') return customerKey(row);
  if (groupBy === 'none') return 'Total';
  return '';
}

function axisLabel(groupBy, key) {
  if (groupBy !== 'date') return key;
  const date = parseDateParam(key);
  return date.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
}

function accumulate(rows, groupBy) {
  const buckets = new Map();
  for (const row of rows) {
    const key = groupLabel(row, groupBy);
    if (!key) continue;
    const bucket = buckets.get(key) || {
      name: groupBy === 'customer' ? String(row.customerName || '').trim() || '—' : key,
      transactions: 0,
      volume: 0,
      buys: 0,
      sells: 0,
      buyVolume: 0,
      sellVolume: 0,
      stores: new Set(),
      customers: new Set(),
      firstDate: '',
      lastDate: '',
    };
    const amount = Number(row.amount) || 0;
    const day = formatDateParam(row.date);
    bucket.transactions += 1;
    bucket.volume += amount;
    if (row.type === 'purchase') {
      bucket.buys += 1;
      bucket.buyVolume += amount;
    } else {
      bucket.sells += 1;
      bucket.sellVolume += amount;
    }
    const store = canonicalStoreName(row.storeName) || String(row.storeName || '').trim();
    if (store) bucket.stores.add(store);
    const person = customerKey(row);
    if (person) bucket.customers.add(person);
    if (!bucket.firstDate || day < bucket.firstDate) bucket.firstDate = day;
    if (!bucket.lastDate || day > bucket.lastDate) bucket.lastDate = day;
    buckets.set(key, bucket);
  }
  for (const bucket of buckets.values()) {
    bucket.avgTicket = bucket.transactions ? bucket.volume / bucket.transactions : 0;
  }
  return buckets;
}

function cleanTitle(value, fallback) {
  const title = String(value || '').replace(/\s+/g, ' ').trim();
  return (title || fallback).slice(0, 80);
}

function groupNoun(groupBy) {
  return groupBy === 'txType' ? 'buy / sell' : groupBy;
}

/** Numbers only, for the model to answer in words. Nothing is drawn. */
function queryTransactions(args, scoped) {
  const groupBy = String(args?.groupBy || '');
  if (!QUERY_GROUPS.includes(groupBy)) return { error: `groupBy must be one of ${QUERY_GROUPS.join(', ')}.` };
  const sortBy = MEASURES[args?.sortBy] ? args.sortBy : 'transactions';
  const limit = Math.min(50, Math.max(1, Number(args?.limit) || 10));
  const minTransactions = Math.max(1, Number(args?.minTransactions) || 1);
  const { source, scope } = scoped;
  if (!source.length) return { error: `No transactions for ${scope.label}.` };

  const buckets = accumulate(source, groupBy);
  let entries = [...buckets.values()].filter((bucket) => bucket.transactions >= minTransactions);
  if (groupBy === 'date' || groupBy === 'weekday') {
    entries.sort((a, b) =>
      groupBy === 'weekday' ? WEEKDAYS.indexOf(a.name) - WEEKDAYS.indexOf(b.name) : a.name.localeCompare(b.name),
    );
  } else {
    entries.sort((a, b) => (b[sortBy] || 0) - (a[sortBy] || 0));
  }
  const total = entries.length;
  entries = entries.slice(0, limit);

  const rows = entries.map((bucket) => {
    const row = { [groupBy === 'none' ? 'row' : groupBy]: bucket.name };
    for (const [key, meta] of Object.entries(MEASURES)) row[meta.label] = formatMeasure(bucket[key], meta.format);
    if (groupBy === 'customer' || groupBy === 'employee') row.stores = [...bucket.stores].join(', ');
    if (groupBy === 'store' || groupBy === 'employee' || groupBy === 'none') row.uniqueCustomers = bucket.customers.size;
    if (groupBy === 'customer') {
      row.firstVisit = bucket.firstDate;
      row.lastVisit = bucket.lastDate;
    }
    return row;
  });
  const grand = accumulate(source, 'none').get('Total');
  return {
    modelResult: {
      scope: scope.label,
      transactionsInScope: scope.transactions,
      filters: scope.filters,
      transactionsBeforeFilters: scope.beforeFilters,
      groupBy,
      sortedBy: MEASURES[sortBy].label,
      minTransactions: minTransactions > 1 ? minTransactions : undefined,
      rowsReturned: rows.length,
      rowsMatching: total,
      rows,
      totals: grand
        ? {
            ...Object.fromEntries(Object.entries(MEASURES).map(([key, meta]) => [meta.label, formatMeasure(grand[key], meta.format)])),
            uniqueCustomers: grand.customers.size,
          }
        : undefined,
    },
  };
}

function seriesChart(type, args, scoped) {
  const measures = [...new Set((Array.isArray(args?.measures) ? args.measures : []).map((item) => String(item || '')))];
  const groupBy = String(args?.groupBy || '');
  const groups = type === 'line' ? LINE_GROUPS : BAR_GROUPS;
  if (!measures.length || measures.some((key) => !MEASURES[key])) {
    return { error: `Use one or two of: ${Object.keys(MEASURES).join(', ')}.` };
  }
  if (measures.length > 2) return { error: `A ${type} chart can show one or two measures.` };
  if (!groups.has(groupBy)) return { error: `Group a ${type} chart by ${[...groups].join(', ')}.` };

  const { source, scope } = scoped;
  const buckets = accumulate(source, groupBy);
  let keys = [...buckets.keys()];
  if (groupBy === 'weekday') {
    keys.sort((a, b) => WEEKDAYS.indexOf(a) - WEEKDAYS.indexOf(b));
  } else if (groupBy === 'date') {
    keys.sort((a, b) => String(a).localeCompare(String(b)));
    if (keys.length > MAX_LINE_POINTS) {
      return { error: `That range has ${keys.length} days with sales. Ask for ${MAX_LINE_POINTS} days or fewer.` };
    }
  } else {
    keys.sort((a, b) => (buckets.get(b)[measures[0]] || 0) - (buckets.get(a)[measures[0]] || 0));
    keys = keys.slice(0, MAX_BARS);
  }
  if (!keys.length) return { error: `No transactions for ${scope.label}.` };

  const series = measures.map((key, index) => ({
    key,
    label: MEASURES[key].label,
    format: MEASURES[key].format,
    axis: index === 0 ? 'left' : 'right',
    values: keys.map((bucketKey) => Number(buckets.get(bucketKey)[key]) || 0),
  }));
  const categories = keys.map((key) => axisLabel(groupBy, key));
  const title = cleanTitle(args?.title, `${series.map((item) => item.label).join(' and ')} by ${groupNoun(groupBy)}`);
  const chart = { type, title, subtitle: scope.label, categories, series };
  return {
    chart,
    modelResult: {
      title,
      scope: scope.label,
      transactionsInScope: scope.transactions,
      groupBy,
      points: categories.map((label, index) => ({
        label,
        ...Object.fromEntries(series.map((item) => [item.label, formatMeasure(item.values[index], item.format)])),
      })),
      truncated: buckets.size > keys.length ? `${buckets.size - keys.length} more ${groupBy}s not shown` : undefined,
    },
  };
}

function pieChart(args, scoped) {
  const measure = String(args?.measure || '');
  const groupBy = String(args?.groupBy || '');
  if (!MEASURES[measure]) return { error: `Use one of: ${Object.keys(MEASURES).join(', ')}.` };
  if (!PIE_GROUPS.has(groupBy)) return { error: `Group a pie chart by ${[...PIE_GROUPS].join(', ')}.` };

  const { source, scope } = scoped;
  const buckets = accumulate(source, groupBy);
  const ranked = [...buckets.entries()]
    .map(([key, bucket]) => ({ key, value: Number(bucket[measure]) || 0 }))
    .filter((item) => item.value > 0)
    .sort((a, b) => b.value - a.value);
  if (!ranked.length) return { error: `No transactions for ${scope.label}.` };

  const head = ranked.slice(0, MAX_PIE_SLICES);
  const rest = ranked.slice(MAX_PIE_SLICES);
  const slices = head.map((item) => ({
    name: axisLabel(groupBy, item.key),
    value: item.value,
  }));
  if (rest.length) {
    slices.push({ name: 'Other', value: rest.reduce((sum, item) => sum + item.value, 0) });
  }
  const meta = MEASURES[measure];
  const title = cleanTitle(args?.title, `${meta.label} by ${groupNoun(groupBy)}`);
  const chart = { type: 'pie', title, subtitle: scope.label, format: meta.format, slices };
  return {
    chart,
    modelResult: {
      title,
      scope: scope.label,
      transactionsInScope: scope.transactions,
      measure: meta.label,
      slices: slices.map((slice) => ({
        name: slice.name,
        value: formatMeasure(slice.value, meta.format),
      })),
    },
  };
}

const FREE_FORMATS = new Set(['int', 'decimal', 'money', 'hours']);

function freeFormat(value, fallback = 'int') {
  const key = String(value || '').toLowerCase();
  return FREE_FORMATS.has(key) ? key : fallback;
}

function finiteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

// Numbers the model already got from another tool (stock, tills, hours…).
// Nothing is computed here; the labels and values are drawn as given.
function freeChart(args) {
  const type = String(args?.type || '').toLowerCase();
  if (!['bar', 'line', 'pie'].includes(type)) return { error: 'Chart type must be bar, line, or pie.' };
  const title = cleanTitle(args?.title, 'Chart');
  const subtitle = String(args?.subtitle || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  const format = freeFormat(args?.format);

  if (type === 'pie') {
    const slices = (Array.isArray(args?.slices) ? args.slices : [])
      .map((slice) => ({ name: String(slice?.name || '').trim().slice(0, 40), value: finiteNumber(slice?.value) }))
      .filter((slice) => slice.name && slice.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 12);
    if (!slices.length) return { error: 'Give slices with a name and a value above zero.' };
    const chart = { type: 'pie', title, subtitle, format, slices };
    return {
      chart,
      modelResult: {
        title,
        drawn: 'pie',
        slices: slices.map((slice) => ({ name: slice.name, value: formatMeasure(slice.value, format) })),
      },
    };
  }

  const categories = (Array.isArray(args?.categories) ? args.categories : [])
    .map((label) => String(label ?? '').trim().slice(0, 24))
    .slice(0, 40);
  if (!categories.length) return { error: 'Give categories, one label per point.' };
  const series = (Array.isArray(args?.series) ? args.series : [])
    .slice(0, 6)
    .map((item, index) => {
      const values = (Array.isArray(item?.values) ? item.values : []).map(finiteNumber);
      while (values.length < categories.length) values.push(0);
      return {
        key: `s${index}`,
        label: String(item?.label || `Series ${index + 1}`).trim().slice(0, 40),
        format: freeFormat(item?.format, format),
        axis: index === 0 ? 'left' : 'right',
        values: values.slice(0, categories.length),
      };
    });
  if (!series.length) return { error: 'Give at least one series with values.' };
  if (series.every((item) => item.values.every((value) => value === 0))) {
    return { error: 'Every value is zero; check the numbers from the lookup.' };
  }
  const chart = { type, title, subtitle, categories, series };
  return {
    chart,
    modelResult: {
      title,
      drawn: type,
      points: categories.map((label, index) => ({
        label,
        ...Object.fromEntries(series.map((item) => [item.label, formatMeasure(item.values[index], item.format)])),
      })),
    },
  };
}

const TABLE_FORMATS = new Set(['text', 'int', 'decimal', 'money', 'hours']);
const MAX_TABLE_ROWS = 60;
const MAX_TABLE_COLS = 8;

function tableKey(value, index) {
  const raw = String(value || '').trim();
  return (raw || `col${index + 1}`).slice(0, 40);
}

function tableCell(value, format) {
  if (value == null) return '';
  if (format === 'text') return String(value).trim().slice(0, 80);
  const n = typeof value === 'number' ? value : Number(String(value).replace(/[$,\s]/g, ''));
  if (Number.isFinite(n)) return n;
  return String(value).trim().slice(0, 80);
}

function guessFormat(rows, key) {
  const values = rows.map((row) => row?.[key]).filter((value) => value != null && value !== '');
  if (!values.length) return 'text';
  const numeric = values.every((value) => Number.isFinite(typeof value === 'number' ? value : Number(String(value).replace(/[$,\s]/g, ''))));
  if (!numeric) return 'text';
  if (values.some((value) => /^\s*-?\$/.test(String(value)))) return 'money';
  if (values.some((value) => !Number.isInteger(Number(String(value).replace(/[$,\s]/g, ''))))) return 'decimal';
  return 'int';
}

/** Rows the model already has from a tool result, shown as a sortable table. */
function freeTable(args) {
  const title = cleanTitle(args?.title, 'Table');
  const subtitle = String(args?.subtitle || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  const note = String(args?.note || '').replace(/\s+/g, ' ').trim().slice(0, 160);
  const rawRows = (Array.isArray(args?.rows) ? args.rows : []).filter((row) => row && typeof row === 'object').slice(0, MAX_TABLE_ROWS);
  if (!rawRows.length) return { error: 'Give at least one row.' };
  const rawColumns = (Array.isArray(args?.columns) ? args.columns : []).slice(0, MAX_TABLE_COLS);
  const columns = (rawColumns.length ? rawColumns : Object.keys(rawRows[0]).map((key) => ({ key, label: key })))
    .map((column, index) => {
      const key = tableKey(column?.key, index);
      const format = TABLE_FORMATS.has(String(column?.format || '')) ? String(column.format) : guessFormat(rawRows, key);
      return { key, label: String(column?.label || key).trim().slice(0, 40) || key, format };
    });
  if (!columns.length) return { error: 'Give at least one column.' };
  const rows = rawRows.map((row) => Object.fromEntries(columns.map((column) => [column.key, tableCell(row[column.key], column.format)])));
  const footer =
    args?.total && typeof args.total === 'object'
      ? Object.fromEntries(
          columns
            .filter((column) => args.total[column.key] != null && args.total[column.key] !== '')
            .map((column) => [column.key, tableCell(args.total[column.key], column.format)]),
        )
      : undefined;
  const chart = { type: 'table', title, subtitle, columns, rows, footer: footer && Object.keys(footer).length ? footer : undefined, note: note || undefined };
  return {
    chart,
    modelResult: {
      title,
      drawn: 'table',
      columns: columns.map((column) => column.label),
      rowCount: rows.length,
      note: 'The table is on screen; summarize it in one or two sentences and do not repeat every row.',
    },
  };
}

// A markdown table in the prose becomes a real table card and leaves the text.
const MD_TABLE_ROW = /^\s*\|.*\|\s*$/;
const MD_TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function splitMarkdownRow(line) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.replace(/\*\*/g, '').trim());
}

function isTotalRow(cells) {
  return /^(total|totals|all|sum)$/i.test(String(cells[0] || '').trim());
}

export function extractMarkdownTables(text) {
  const lines = String(text || '').split('\n');
  const charts = [];
  const kept = [];
  let i = 0;
  while (i < lines.length) {
    const headerLine = lines[i];
    const ruleLine = lines[i + 1];
    if (MD_TABLE_ROW.test(headerLine) && ruleLine && MD_TABLE_RULE.test(ruleLine)) {
      const header = splitMarkdownRow(headerLine);
      let j = i + 2;
      const body = [];
      while (j < lines.length && MD_TABLE_ROW.test(lines[j])) {
        body.push(splitMarkdownRow(lines[j]));
        j += 1;
      }
      if (header.length >= 2 && body.length) {
        const keys = header.map((label, index) => tableKey(label.toLowerCase().replace(/[^a-z0-9]+/g, '_'), index));
        const dataRows = body.filter((cells) => !isTotalRow(cells));
        const totalCells = body.find(isTotalRow);
        const rawRows = dataRows.map((cells) => Object.fromEntries(keys.map((key, index) => [key, cells[index] ?? ''])));
        const built = freeTable({
          title: 'Table',
          columns: header.map((label, index) => ({ key: keys[index], label })),
          rows: rawRows,
          total: totalCells ? Object.fromEntries(keys.map((key, index) => [key, totalCells[index] ?? ''])) : undefined,
        });
        if (built.chart) {
          charts.push(built.chart);
          i = j;
          continue;
        }
      }
    }
    kept.push(headerLine);
    i += 1;
  }
  return { text: kept.join('\n').replace(/\n{3,}/g, '\n\n').trim(), charts };
}

function postalArea(postal) {
  const compact = String(postal || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!/^[A-Z]\d[A-Z]/.test(compact)) return '';
  return compact.slice(0, 3);
}

function customerKey(row) {
  const id = String(row.customerId || '').trim();
  if (id) return `${row.systemKey || ''}:${id}`;
  const name = fold(row.customerName);
  return name && name !== '—' ? `name:${name}` : '';
}

function cityMatches(rowCity, wanted) {
  const city = fold(rowCity);
  const needle = fold(wanted);
  if (!city || !needle) return false;
  return city === needle || city.includes(needle) || needle.includes(city);
}

async function readJsonCache(key) {
  try {
    const raw = JSON.parse(await AsyncStorage.getItem(key));
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

async function writeJsonCache(key, value) {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Caches only save time on the next question.
  }
}

async function geocode(query, apiKey, signal) {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&components=country:CA&key=${encodeURIComponent(apiKey)}`;
  const response = await fetch(url, { signal });
  const payload = await response.json().catch(() => null);
  const best = payload?.results?.[0];
  const location = best?.geometry?.location;
  const lat = Number(location?.lat);
  const lng = Number(location?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng, precision: best?.geometry?.location_type || '' };
}

async function runPool(items, size, work) {
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const item = items[cursor];
      cursor += 1;
      await work(item);
    }
  }
  if (!items.length) return;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, () => worker()));
}

function normalizePostal(value) {
  const compact = String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!/^[A-Z]\d[A-Z]\d[A-Z]\d$/.test(compact)) return postalArea(compact);
  return `${compact.slice(0, 3)} ${compact.slice(3)}`;
}

function placeFromClientDetail(detail) {
  const client = detail?.client && typeof detail.client === 'object' ? detail.client : detail;
  const addresses = Array.isArray(client?.addresses) ? client.addresses : [];
  const preferred =
    addresses.find((row) => row?.default_for_billing) ||
    addresses.find((row) => row?.default_for_shipping) ||
    addresses[0] ||
    (client?.address && typeof client.address === 'object' ? client.address : null) ||
    client ||
    null;
  if (!preferred) return null;
  const postal = normalizePostal(preferred.zip || preferred.postal_code || preferred.postal || preferred.postcode);
  const city = String(preferred.city || '').trim();
  const street = [
    preferred.address1 || preferred.address_1 || preferred.street || preferred.line1 || preferred.address,
    preferred.address2 || preferred.address_2 || preferred.line2,
  ]
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .filter(Boolean)
    .join(', ');
  const province = String(preferred.state || preferred.province || '').trim();
  if (!postal && !city && !street) return null;
  return { postal, city, street, province };
}

/**
 * Tickets from the POS search list usually omit the customer address, so the
 * customer record is fetched for each person once. What persists on this
 * device is the postal code, city, and the geocoded point. The street line is
 * kept in memory for the current map only.
 */
async function fillCustomerPlaces(people, session, signal, onStatus) {
  const cache = await readJsonCache(PLACE_CACHE_KEY);
  const sources = new Map(posSourcesFromSession(session).map((source) => [source.key, source]));
  const pending = [];
  for (const person of people.values()) {
    const cached = cache[person.key];
    if (cached) {
      person.postal = person.postal || cached.postal || '';
      person.city = person.city || cached.city || '';
      if (Number.isFinite(cached.lat) && Number.isFinite(cached.lng)) {
        person.lat = cached.lat;
        person.lng = cached.lng;
      }
      person.lookedUp = true;
      if (person.lat != null || cached.noAddress) continue;
    }
    if (person.clientId && sources.has(person.systemKey)) pending.push(person);
    else person.lookedUp = true;
  }
  const fresh = pending.slice(0, MAX_CUSTOMER_LOOKUPS);
  let done = 0;
  const report = () => {
    if (fresh.length >= 20 && (done % 20 === 0 || done === fresh.length)) {
      onStatus?.(`Reading customer addresses… ${done} of ${fresh.length}`);
    }
  };
  if (fresh.length) onStatus?.(`Reading ${fresh.length} customer ${fresh.length === 1 ? 'address' : 'addresses'}…`);
  await runPool(fresh, 8, async (person) => {
    if (signal?.aborted) return;
    const source = sources.get(person.systemKey);
    try {
      const response = await posFetch(`${source.baseUrl}/clients/${encodeURIComponent(person.clientId)}`, {
        method: 'GET',
        headers: authHeaders(source.token),
        signal,
      });
      if (!response.ok) return;
      const payload = await response.json().catch(() => null);
      const place = placeFromClientDetail(payload?.data ?? payload);
      person.lookedUp = true;
      if (!place) {
        cache[person.key] = { ...(cache[person.key] || {}), noAddress: true };
        return;
      }
      person.postal = place.postal || person.postal;
      person.city = place.city || person.city;
      person.street = place.street;
      person.province = place.province;
      cache[person.key] = { ...(cache[person.key] || {}), postal: person.postal, city: person.city };
    } catch {
      // Left for the summary to count as not looked up.
    } finally {
      done += 1;
      report();
    }
  });
  return { cache, notLookedUp: pending.length - fresh.length };
}

async function locateCustomers(people, cache, apiKey, signal, onStatus) {
  const postalCache = await readJsonCache(FSA_CACHE_KEY);
  const todo = [...people.values()].filter((person) => person.lat == null && (person.street || person.postal));
  const fresh = todo.slice(0, MAX_NEW_GEOCODES);
  let done = 0;
  if (fresh.length) onStatus?.(`Placing ${fresh.length} ${fresh.length === 1 ? 'address' : 'addresses'} on the map…`);
  let wrotePostal = false;
  await runPool(fresh, 6, async (person) => {
    if (signal?.aborted) return;
    try {
      let point = null;
      if (person.street) {
        const query = [person.street, person.city, person.province, person.postal, 'Canada'].filter(Boolean).join(', ');
        point = await geocode(query, apiKey, signal).catch(() => null);
      }
      if (!point && person.postal) {
        point = postalCache[person.postal] || (await geocode(`${person.postal}, Canada`, apiKey, signal).catch(() => null));
        if (point) {
          postalCache[person.postal] = { lat: point.lat, lng: point.lng };
          wrotePostal = true;
        }
      }
      if (!point) return;
      person.lat = point.lat;
      person.lng = point.lng;
      cache[person.key] = { ...(cache[person.key] || {}), postal: person.postal, city: person.city, lat: point.lat, lng: point.lng };
    } finally {
      done += 1;
      if (fresh.length >= 20 && (done % 20 === 0 || done === fresh.length)) {
        onStatus?.(`Placing addresses… ${done} of ${fresh.length}`);
      }
    }
  });
  if (wrotePostal) await writeJsonCache(FSA_CACHE_KEY, postalCache);
  await writeJsonCache(PLACE_CACHE_KEY, cache);
  return { notPlaced: todo.length - fresh.length };
}

const MAX_RING_POINTS = 400;
const MAX_RINGS = 12;

function ringFromCoords(coords) {
  const points = (Array.isArray(coords) ? coords : [])
    .map((pair) => (Array.isArray(pair) ? [Number(pair[1]), Number(pair[0])] : null))
    .filter((pair) => pair && Number.isFinite(pair[0]) && Number.isFinite(pair[1]));
  if (points.length < 3) return null;
  const stride = Math.max(1, Math.ceil(points.length / MAX_RING_POINTS));
  const thinned = points.filter((_, index) => index % stride === 0);
  return thinned.length >= 3 ? thinned : points.slice(0, MAX_RING_POINTS);
}

// Outer rings only; holes and islands below a few points are dropped.
function ringsFromGeoJson(geojson, bounds) {
  const rings = [];
  const type = String(geojson?.type || '');
  if (type === 'Polygon') {
    const ring = ringFromCoords(geojson.coordinates?.[0]);
    if (ring) rings.push(ring);
  } else if (type === 'MultiPolygon') {
    for (const polygon of geojson.coordinates || []) {
      const ring = ringFromCoords(polygon?.[0]);
      if (ring) rings.push(ring);
      if (rings.length >= MAX_RINGS) break;
    }
  }
  if (!rings.length && bounds) {
    rings.push([
      [bounds.south, bounds.west],
      [bounds.south, bounds.east],
      [bounds.north, bounds.east],
      [bounds.north, bounds.west],
    ]);
  }
  return rings;
}

function shortPlaceName(displayName, asked) {
  const first = String(displayName || '').split(',')[0].trim();
  return first || String(asked || '').split(',')[0].trim();
}

async function lookupArea(place, signal) {
  const payload = await proxyJson(`geo/area?q=${encodeURIComponent(place)}`, { signal });
  if (!payload?.found) return null;
  const bounds = payload.bounds && Number.isFinite(payload.bounds.south) ? payload.bounds : null;
  const rings = ringsFromGeoJson(payload.geojson, bounds);
  if (!rings.length) return null;
  return {
    name: shortPlaceName(payload.name, place),
    fullName: String(payload.name || place).slice(0, 160),
    kind: String(payload.kind || ''),
    asked: place,
    lat: Number(payload.lat),
    lng: Number(payload.lng),
    bounds,
    rings,
    approximate: !payload.geojson || !['Polygon', 'MultiPolygon'].includes(String(payload.geojson.type)),
  };
}

/** Outline one or more places. Customers are overlaid only when asked. */
async function areaMap(args, context) {
  const places = (Array.isArray(args?.places) ? args.places : [])
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .slice(0, 5);
  if (!places.length) return { error: 'Name the neighbourhood, city, or region to outline.' };
  if (!context.mapsKey) {
    return { error: 'Add a Google Maps browser key in Settings → AI Models. Restrict it by HTTP referrer.' };
  }

  context.onStatus?.(`Finding ${places.join(', ')}…`);
  const areas = [];
  const missing = [];
  for (const place of places) {
    if (context.signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    try {
      const area = await lookupArea(place, context.signal);
      if (area) areas.push(area);
      else missing.push(place);
    } catch (error) {
      if (context.signal?.aborted || error?.name === 'AbortError') throw error;
      missing.push(place);
    }
  }
  if (!areas.length) {
    return { error: `Could not find a boundary for ${missing.join(', ')}. Try the full name with the city, such as "Notre-Dame-de-Grâce, Montreal".` };
  }

  let markers = [];
  let customersNote = '';
  let scopeLabel = '';
  if (args?.customers) {
    const scoped = await resolveScope(args, context);
    if (!scoped.error) {
      const drawn = await customerMap({ ...args, title: '' }, scoped, context);
      if (drawn.chart) {
        markers = drawn.chart.markers;
        customersNote = drawn.chart.note;
        scopeLabel = scoped.scope.label;
      }
    }
  }

  const title = cleanTitle(args?.title, areas.map((area) => area.name).join(', '));
  const chart = {
    type: 'map',
    style: 'area',
    title,
    subtitle: scopeLabel || areas.map((area) => area.fullName).join(' · ').slice(0, 120),
    note: [
      customersNote,
      areas.some((area) => area.approximate) ? 'Lighter boxes are approximate: that place has no published boundary, so its borough may be a better name to ask for.' : '',
      missing.length ? `Not found: ${missing.join(', ')}.` : '',
    ]
      .filter(Boolean)
      .join(' '),
    areas: areas.map((area) => ({
      name: area.name,
      rings: area.rings,
      approximate: area.approximate || undefined,
      lat: area.lat,
      lng: area.lng,
    })),
    markers,
    missingPostal: 0,
    unplaced: 0,
  };
  return {
    chart,
    modelResult: {
      title,
      drawn: 'area map',
      areas: areas.map((area) => ({
        asked: area.asked,
        matched: area.fullName,
        kind: area.kind,
        center: { lat: area.lat, lng: area.lng },
        exactBoundary: !area.approximate,
      })),
      notFound: missing.length ? missing : undefined,
      customersPlotted: markers.length ? markers.reduce((sum, marker) => sum + (marker.count || 0), 0) : undefined,
      note: 'The outline is on screen. One or two sentences: name the place and where it sits relative to the city. Do not list customers unless they were plotted.',
    },
  };
}

async function customerMap(args, scoped, context) {
  const city = String(args?.city || '').trim();
  const style = String(args?.style || '').toLowerCase() === 'heat' ? 'heat' : 'dots';
  const { source, scope } = scoped;
  if (!source.length) return { error: `No transactions for ${scope.label}.` };
  if (!context.mapsKey) {
    return {
      error: 'Add a Google Maps browser key in Settings → AI Models. Restrict it by HTTP referrer.',
    };
  }

  const people = new Map();
  for (const row of source) {
    const key = customerKey(row);
    if (!key) continue;
    const person = people.get(key) || {
      key,
      systemKey: String(row.systemKey || ''),
      clientId: String(row.customerId || '').trim(),
      name: String(row.customerName || '').trim(),
      postal: normalizePostal(row.customerPostal),
      city: String(row.customerCity || '').trim(),
      street: '',
      province: '',
      lat: null,
      lng: null,
      lookedUp: false,
      transactions: 0,
    };
    person.transactions += 1;
    if (!person.name) person.name = String(row.customerName || '').trim();
    if (!person.postal) person.postal = normalizePostal(row.customerPostal);
    if (!person.city) person.city = String(row.customerCity || '').trim();
    people.set(key, person);
  }
  if (!people.size) return { error: `No named customers on the transactions for ${scope.label}.` };

  const filled = await fillCustomerPlaces(people, context.session, context.signal, context.onStatus);

  const wanted = city
    ? [...people.values()].filter((person) => cityMatches(person.city, city))
    : [...people.values()];
  if (city && !wanted.length) {
    return { error: `None of the ${people.size} customers for ${scope.label} have ${city} as their city.` };
  }

  const located = await locateCustomers(
    new Map(wanted.map((person) => [person.key, person])),
    filled.cache,
    context.mapsKey,
    context.signal,
    context.onStatus,
  );

  const byPoint = new Map();
  let noAddress = 0;
  let notLookedUp = 0;
  let notPlaced = 0;
  for (const person of wanted) {
    if (person.lat == null) {
      if (!person.lookedUp) notLookedUp += 1;
      else if (person.street || person.postal) notPlaced += 1;
      else noAddress += 1;
      continue;
    }
    const pointKey = `${person.lat.toFixed(5)},${person.lng.toFixed(5)}`;
    const entry = byPoint.get(pointKey) || {
      lat: person.lat,
      lng: person.lng,
      label: person.postal || person.city || '',
      city: person.city,
      address: person.street,
      count: 0,
      transactions: 0,
      customers: [],
    };
    entry.count += 1;
    entry.transactions += person.transactions;
    // Who is at this dot, so the popup can open their profile. Only customers
    // with a POS id can be opened; name-only rows are counted but not listed.
    if (person.clientId && entry.customers.length < MAX_MARKER_CUSTOMERS) {
      entry.customers.push({
        id: person.clientId,
        systemKey: person.systemKey,
        name: person.name || 'Customer',
        transactions: person.transactions,
      });
    }
    byPoint.set(pointKey, entry);
  }
  for (const entry of byPoint.values()) {
    entry.customers.sort((a, b) => b.transactions - a.transactions);
  }
  const markers = [...byPoint.values()].sort((a, b) => b.count - a.count);
  const placedCustomers = wanted.length - noAddress - notLookedUp - notPlaced;
  if (!markers.length) {
    return {
      error: `${wanted.length} customers for ${scope.label}, but none could be placed: ${noAddress} have no address on file, ${notLookedUp} were not looked up yet, ${notPlaced} addresses could not be located.`,
    };
  }

  const who = city ? `Customers in ${city}` : scope.store ? `Customers of ${scope.store}` : 'Customers';
  const title = cleanTitle(args?.title, who);
  const cities = new Map();
  const areas = new Map();
  for (const person of wanted) {
    if (person.lat == null) continue;
    const name = person.city || 'Unknown city';
    cities.set(name, (cities.get(name) || 0) + 1);
    const fsa = postalArea(person.postal);
    if (fsa) areas.set(fsa, (areas.get(fsa) || 0) + 1);
  }
  const chart = {
    type: 'map',
    style,
    title,
    subtitle: scope.label,
    city,
    note: `${placedCustomers} of ${wanted.length} customers placed at their home address or postal code.`,
    markers,
    missingPostal: noAddress,
    unplaced: notPlaced + notLookedUp,
  };
  return {
    chart,
    modelResult: {
      title,
      style,
      scope: scope.label,
      cityFilter: city || 'none',
      customers: wanted.length,
      customersOnMap: placedCustomers,
      customersWithNoAddressOnFile: noAddress,
      customersNotLookedUpYet: notLookedUp + filled.notLookedUp,
      addressesNotLocated: notPlaced + located.notPlaced,
      distinctPoints: markers.length,
      byCity: [...cities.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12)
        .map(([name, count]) => ({ city: name, customers: count })),
      topPostalAreas: [...areas.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([fsa, count]) => ({ area: fsa, customers: count })),
      note: 'Points are geocoded home addresses when the customer record has a street, otherwise the postal code.',
    },
  };
}

const MAX_LOOKUP_CHARS = 60000;

function metalWords(metal) {
  const raw =
    typeof metal === 'string'
      ? metal
      : metal?.name || metal?.label || metal?.code || '';
  const text = String(raw || '').toLowerCase().trim();
  if (!text) return '';
  if (/^(au|xau)$/.test(text) || /\bgold\b/.test(text)) return 'gold';
  if (/^(ag|xag)$/.test(text) || /\bsilver\b/.test(text)) return 'silver';
  if (/^(pt|xpt)$/.test(text) || /\bplat/.test(text)) return 'platinum';
  if (/^(pd|xpd)$/.test(text) || /\bpallad/.test(text)) return 'palladium';
  return text;
}

function normalizeInventoryText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/\bleafs?\b/g, 'leaf')
    .replace(/\bmapleleaf\b/g, 'maple leaf')
    .replace(/\bounces?\b/g, 'oz')
    .replace(/(\d)\s*[-]?\s*(oz|g|gram|grams|kg)\b/g, '$1$2')
    .replace(/\bgrams?\b/g, 'g');
}

function expandInventoryCodes(hay) {
  const extras = [];
  const goldMaple = /\b(gml|maplegram|mlbd)\b/.test(hay) || (/\bgold\b/.test(hay) && /\bmaple\b/.test(hay));
  const silverMaple = /\bsml\b/.test(hay) || (/\bsilver\b/.test(hay) && /\bmaple\b/.test(hay));
  const platMaple = /\bpml\b/.test(hay) || (/\bplat/.test(hay) && /\bmaple\b/.test(hay));
  const rcm = /\brcm\b/.test(hay) || /\broyal canadian mint\b/.test(hay);
  if (/\bgbar\b/.test(hay) || /\bgold bars?\b/.test(hay)) extras.push('gold', 'bar', 'gbar');
  if (/\bsbar\b/.test(hay) || /\bsilver bars?\b/.test(hay)) extras.push('silver', 'bar', 'sbar');
  if (/\bplatbar\b/.test(hay) || /\bplatinum bars?\b/.test(hay)) extras.push('platinum', 'bar', 'platbar');
  if (goldMaple) extras.push('gold', 'maple', 'leaf', 'gml');
  if (silverMaple) extras.push('silver', 'maple', 'leaf', 'sml');
  if (platMaple) extras.push('platinum', 'maple', 'leaf', 'pml');
  if (rcm) extras.push('rcm', 'royal', 'canadian', 'mint');
  return extras.length ? `${hay} ${extras.join(' ')}` : hay;
}

// POS names are GBAR / GML / SML / RCM. Expand those so "1 oz gold maple leaf"
// hits "GML 1oz DNA" and "royal canadian mint" hits "GBAR 1oz RCM".
function inventoryHay(item) {
  const metal = metalWords(item?.metal);
  return expandInventoryCodes(normalizeInventoryText(`${item?.name || ''} ${item?.sku || ''} ${metal}`));
}

function inventoryTerms(text) {
  return expandInventoryCodes(normalizeInventoryText(text))
    .split(/[^a-z0-9./]+/)
    .filter((term) => term && !['the', 'a', 'an', 'of', 'and', 'bar', 'bars', 'coin', 'coins'].includes(term));
}

// Whole words only, so "carded" does not pull in "uncarded" and "sealed"
// does not pull in "unsealed". Plurals still match.
function termInHay(hay, term) {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (/^\d/.test(term) && /(oz|g|kg)$/.test(term)) {
    return new RegExp(`(?:^|[^0-9/])${escaped}\\b`).test(hay);
  }
  if (/^[a-z]+$/.test(term)) {
    const stem = term.length > 3 ? term.replace(/s$/, '') : term;
    return new RegExp(`\\b${stem}(?:e?s)?\\b`).test(hay);
  }
  return hay.includes(term);
}

function inventoryMatches(item, terms, wantBar, wantCoin) {
  const hay = inventoryHay(item);
  if (wantBar && !/\b(bar|wafer|ingot)s?\b/.test(hay)) return false;
  if (wantCoin && !/\b(coin|maple|eagle|britannia|krugerrand|philharmonic|kangaroo|round)s?\b/.test(hay)) return false;
  return terms.every((term) => termInHay(hay, term));
}

/**
 * Search the full live stock matrix (every SKU, every store), not the ranked
 * sample the company chat sends, so a low-count product is never cut off.
 */
async function searchInventory(session, search, stores, signal) {
  const matrix = peekInventoryMatrix(session) || (await fetchInventoryMatrix(session));
  if (signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
  const lowered = String(search).toLowerCase();
  const wantBar = /\b(bar|bars|wafer|ingot)\b/.test(lowered);
  const wantCoin = /\b(coin|coins)\b/.test(lowered);
  const terms = inventoryTerms(search);
  const columns = stores.length
    ? (matrix.stores || []).filter((store) => stores.some((name) => storesMatch(store.name, name) || cityMatches(store.name, name)))
    : matrix.stores || [];
  if (stores.length && !columns.length) {
    return { error: `No inventory location matching ${stores.join(', ')}.`, availableStores: (matrix.stores || []).map((store) => store.name) };
  }
  const items = [];
  let matchedSkus = 0;
  let total = 0;
  for (const row of matrix.rows || []) {
    if (!inventoryMatches(row, terms, wantBar, wantCoin)) continue;
    matchedSkus += 1;
    const qty = {};
    let rowTotal = 0;
    for (const store of columns) {
      const value = Math.round((Number(row.quantities?.[store.id]) || 0) * 1000) / 1000;
      if (value) qty[store.name] = value;
      rowTotal += value;
    }
    total += rowTotal;
    const preorders = columns.reduce((sum, store) => sum + (Number(row.preorders?.[store.id]) || 0), 0);
    items.push({
      name: row.name,
      sku: row.sku || undefined,
      metal: row.metal || undefined,
      qty: columns.length === 1 ? rowTotal : qty,
      total: rowTotal,
      preordered: preorders ? Math.round(preorders * 1000) / 1000 : undefined,
    });
  }
  items.sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
  return {
    note: 'Live stock snapshot. qty 0 means none on hand. Matched product names contain every search word.',
    search,
    stores: columns.map((store) => store.name),
    matchedSkus,
    totalOnHand: Math.round(total * 1000) / 1000,
    items: items.slice(0, 80),
    truncated: items.length > 80 ? true : undefined,
    warning: matrix.warning || undefined,
  };
}

const HISTORY_DAILY_LIMIT = 35;
const HISTORY_MAX_PRODUCTS = 8;
const HISTORY_MAX_SERIES = 6;
const HISTORY_CONCURRENCY = 4;
const CATALOG_TTL_MS = 10 * 60 * 1000;
const catalogCache = new Map();

async function cachedForSession(session, kind, loader) {
  const key = `${kind}:${session?.token || ''}`;
  const hit = catalogCache.get(key);
  if (hit && Date.now() - hit.at < CATALOG_TTL_MS) return hit.value;
  const value = await loader();
  catalogCache.set(key, { at: Date.now(), value });
  return value;
}

function shiftIso(date, days) {
  const next = parseDateParam(date);
  next.setDate(next.getDate() + days);
  return formatDateParam(next);
}

// Every day for about a month; weekly samples (plus the last day) beyond that
// so a 90-day question stays at a dozen POS calls per system.
function sampleDates(startDate, endDate) {
  const days = dayCount(startDate, endDate);
  const step = days <= HISTORY_DAILY_LIMIT ? 1 : 7;
  const dates = [];
  for (let cursor = startDate; cursor <= endDate; cursor = shiftIso(cursor, step)) dates.push(cursor);
  if (dates[dates.length - 1] !== endDate) dates.push(endDate);
  return { dates, step };
}

function historyDateLabel(date) {
  return parseDateParam(date).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
}

async function mapPool(items, limit, mapper) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length || 1) }, () => worker()));
  return results;
}

function qtyAt(stocks, productId, locationId) {
  const entries = stocks?.[String(productId)];
  if (!Array.isArray(entries)) return 0;
  let qty = 0;
  for (const entry of entries) {
    if (String(entry?.location_id) === String(locationId)) qty += Number(entry?.quantity) || 0;
  }
  return Math.round(qty * 1000) / 1000;
}

/**
 * Daily system stock per product per store, from the POS as-of-date
 * inventory endpoint. Nothing is estimated; each point is what the POS
 * reports for that day.
 */
async function inventoryHistory(args, context) {
  const dates = resolveDates(args, context);
  if (dates.error) return dates;
  const { startDate, endDate } = dates;
  const search = String(args?.search || '').trim();
  if (!search) return { error: 'Say which product, such as "1 oz gold bar".' };
  const session = context.session;
  if (!session?.token) return { error: 'Sign in again to read inventory history.' };

  context.onStatus?.('Finding the product…');
  const [catalog, allStores] = await Promise.all([
    cachedForSession(session, 'catalog', () => loadItemCatalog(session)),
    cachedForSession(session, 'stores', () => fetchBullionAuditStores(session)),
  ]);
  if (context.signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });

  const lowered = search.toLowerCase();
  const wantBar = /\b(bar|bars|wafer|ingot)\b/.test(lowered);
  const wantCoin = /\b(coin|coins)\b/.test(lowered);
  const terms = inventoryTerms(search);
  const products = (catalog.items || []).filter((item) => inventoryMatches(item, terms, wantBar, wantCoin));
  if (!products.length) return { error: `No product matches "${search}".`, hint: 'Try the house code, such as GBAR 1oz or GML.' };
  if (products.length > HISTORY_MAX_PRODUCTS) {
    return {
      error: `"${search}" matches ${products.length} products. Name one more precisely.`,
      matches: products.slice(0, 20).map((item) => item.name),
    };
  }

  const asked = [...(Array.isArray(args?.stores) ? args.stores : []), ...(args?.store ? [args.store] : [])]
    .map((item) => String(item || '').trim())
    .filter(Boolean);
  const lock = String(context.storeFilter || '').trim();
  const wanted = asked.length ? asked.map((name) => canonicalStoreName(name) || name) : lock ? [lock] : [];
  const stores = wanted.length
    ? allStores.filter((store) => wanted.some((name) => storesMatch(store.name, name) || cityMatches(store.city, name) || cityMatches(store.name, name)))
    : allStores;
  if (!stores.length) {
    return { error: `No store matching ${wanted.join(', ')}.`, availableStores: allStores.map((store) => store.name) };
  }

  const { dates: sampled, step } = sampleDates(startDate, endDate);
  const bySystem = new Map();
  for (const store of stores) {
    const key = store.systemKey || 'east';
    if (!bySystem.has(key)) bySystem.set(key, { token: store.token, baseUrl: store.baseUrl, stores: [], productIds: new Map() });
    bySystem.get(key).stores.push(store);
  }
  for (const product of products) {
    for (const match of product.matches || []) {
      const system = bySystem.get(match.systemKey);
      if (system) system.productIds.set(String(match.id), product.key);
    }
  }

  const jobs = [];
  for (const [systemKey, system] of bySystem) {
    if (!system.productIds.size || !system.token) continue;
    for (const date of sampled) jobs.push({ systemKey, system, date });
  }
  if (!jobs.length) return { error: 'Those stores do not carry that product in the POS.' };

  context.onStatus?.(`Reading ${sampled.length} days of stock…`);
  const problems = [];
  // product.key -> store.name -> date -> qty
  const series = new Map();
  let done = 0;
  await mapPool(jobs, HISTORY_CONCURRENCY, async (job) => {
    if (context.signal?.aborted) return;
    try {
      // The POS honours a single `locations` id, not a list (a list reads as the
      // first id only). Pull every location for the system and pick each store
      // out of the response; one call per system per day either way.
      const result = await fetchProductInventory(job.system.token, [...job.system.productIds.keys()], job.system.baseUrl, {
        date: job.date,
      });
      for (const [productId, productKey] of job.system.productIds) {
        for (const store of job.system.stores) {
          if (!series.has(productKey)) series.set(productKey, new Map());
          const byStore = series.get(productKey);
          if (!byStore.has(store.name)) byStore.set(store.name, new Map());
          const byDate = byStore.get(store.name);
          byDate.set(job.date, (byDate.get(job.date) || 0) + qtyAt(result.stocks, productId, store.id));
        }
      }
    } catch (error) {
      problems.push(`${job.systemKey} ${job.date}: ${error?.message || 'failed'}`);
    }
    done += 1;
    if (done % 5 === 0) context.onStatus?.(`Reading stock… ${done}/${jobs.length}`);
  });
  if (context.signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });

  const rows = products.map((product) => {
    const byStore = series.get(product.key) || new Map();
    const perStore = stores
      .filter((store) => byStore.has(store.name))
      .map((store) => ({ store: store.name, values: sampled.map((date) => byStore.get(store.name)?.get(date) ?? 0) }));
    const total = sampled.map((_, index) => Math.round(perStore.reduce((sum, item) => sum + item.values[index], 0) * 1000) / 1000);
    return { name: product.name, sku: product.sku || undefined, perStore, total };
  });

  // One product across stores → a line per store; several products → a line per product.
  let lines;
  if (rows.length === 1 && rows[0].perStore.length > 1) {
    lines = rows[0].perStore.map((item) => ({ label: item.store, values: item.values }));
  } else {
    lines = rows.map((row) => ({ label: row.name, values: row.total }));
  }
  lines.sort((a, b) => b.values[b.values.length - 1] - a.values[a.values.length - 1]);
  const shown = lines.slice(0, HISTORY_MAX_SERIES);
  const rest = lines.slice(HISTORY_MAX_SERIES);
  if (rest.length) {
    shown.push({
      label: `Other (${rest.length})`,
      values: sampled.map((_, index) => rest.reduce((sum, item) => sum + item.values[index], 0)),
    });
  }
  // A combined line only helps once there are several products to add up.
  if (rows.length > 2) {
    shown.push({ label: 'All matched', values: sampled.map((_, index) => rows.reduce((sum, row) => sum + row.total[index], 0)) });
  }

  const storeLabel = stores.length === allStores.length ? 'All stores' : stores.map((store) => store.name).join(', ');
  const where = `${storeLabel} · ${rangeLabel(startDate, endDate)}`;
  const chartKind = String(args?.chart || 'line').toLowerCase();
  const title = cleanTitle(
    '',
    rows.length === 1 ? `${rows[0].name} on hand` : `${search} on hand`,
  );
  const chart =
    chartKind === 'none'
      ? null
      : {
          type: chartKind === 'bar' ? 'bar' : 'line',
          title,
          subtitle: `${where}${step > 1 ? ' · weekly samples' : ''}`,
          categories: sampled.map((date) => historyDateLabel(date)),
          series: shown.map((line, index) => ({
            key: `s${index}`,
            label: line.label.slice(0, 40),
            format: shown.some((item) => item.values.some((value) => !Number.isInteger(value))) ? 'decimal' : 'int',
            axis: 'left',
            values: line.values,
          })),
        };

  const first = sampled[0];
  const last = sampled[sampled.length - 1];
  return {
    chart: chart || undefined,
    modelResult: {
      search,
      stores: stores.map((store) => store.name),
      dates: { from: startDate, to: endDate, sampled: sampled.length, step: step === 1 ? 'daily' : 'weekly' },
      note:
        'System quantity on hand at the end of each listed day, from the POS. Physical vault counts are separate (Audit → Item).',
      products: rows.map((row) => ({
        name: row.name,
        sku: row.sku,
        start: row.total[0],
        end: row.total[row.total.length - 1],
        change: Math.round((row.total[row.total.length - 1] - row.total[0]) * 1000) / 1000,
        low: Math.min(...row.total),
        high: Math.max(...row.total),
        byStore: row.perStore.map((item) => ({
          store: item.store,
          start: item.values[0],
          end: item.values[item.values.length - 1],
        })),
      })),
      points: sampled.map((date, index) => ({
        date,
        ...Object.fromEntries(shown.map((line) => [line.label, line.values[index]])),
      })),
      firstDay: first,
      lastDay: last,
      drawn: chart ? chart.type : undefined,
      warnings: problems.length ? problems.slice(0, 5) : undefined,
    },
  };
}

function clampJson(value, limit) {
  const text = JSON.stringify(value);
  if (text.length <= limit) return value;
  return { truncated: true, note: `Result trimmed to ${limit} characters; ask a narrower question.`, preview: text.slice(0, limit) };
}

async function customerSearch(args, context) {
  const query = String(args?.query || '').trim();
  if (query.length < 2) return { error: 'Give at least two characters of a name, phone, or email.' };
  const sources = posSourcesFromSession(context.session);
  if (!sources.length) return { error: 'Sign in again to search customers.' };
  context.onStatus?.(`Searching customers for “${query}”…`);
  const hits = [];
  const problems = [];
  await Promise.all(
    sources.map(async (source) => {
      try {
        const rows = await searchClients(source.token, query, source.baseUrl, source);
        for (const row of rows) hits.push(row);
      } catch (error) {
        problems.push(`${source.label}: ${error?.message || 'search failed'}`);
      }
    }),
  );
  if (context.signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
  hits.sort((a, b) => (Number(b.txCount) || 0) - (Number(a.txCount) || 0));
  const top = hits.slice(0, 12);
  const summary = top.map((row) => ({
    id: row.id,
    name: row.label,
    system: row.systemLabel || row.systemKey,
    store: row.storeName || undefined,
    lastVisit: row.lastAt ? formatDateParam(row.lastAt) : undefined,
    lastKind: row.lastKind || undefined,
    tickets: Number(row.txCount) || undefined,
    city: String(row.client?.addresses?.[0]?.city || '').trim() || undefined,
  }));
  let profile;
  if (args?.details && top[0]) {
    context.onStatus?.(`Loading ${top[0].label}…`);
    try {
      const loaded = await loadCustomerProfile(top[0], top[0].token, top[0].baseUrl);
      profile = {
        name: loaded.label,
        store: loaded.storeName || undefined,
        sold: loaded.soldCount,
        bought: loaded.boughtCount,
        tickets: loaded.txCount,
        recent: (loaded.tickets || []).slice(0, 15).map((ticket) => ({
          date: formatDateParam(ticket.date),
          type: ticket.type === 'purchase' ? 'Buy' : 'Sell',
          store: ticket.storeName,
          employee: ticket.employeeName,
          amount: formatMeasure(ticket.amount, 'money'),
          items: String(ticket.itemNames || '').slice(0, 120) || undefined,
        })),
      };
    } catch (error) {
      profile = { error: error?.message || 'Could not load that customer.' };
    }
  }
  return {
    modelResult: {
      query,
      matches: summary.length,
      customers: summary,
      profile,
      note: hits.length > top.length ? `${hits.length - top.length} more matches not shown; refine the search.` : undefined,
      warnings: problems.length ? problems : undefined,
    },
  };
}

async function companyLookup(args, context) {
  const dates = resolveDates(args, context);
  if (dates.error) return dates;
  const asked = [...(Array.isArray(args?.stores) ? args.stores : []), ...(args?.store ? [args.store] : [])]
    .map((item) => String(item || '').trim())
    .filter(Boolean);
  const lock = String(context.storeFilter || '').trim();
  const stores = asked.length ? asked.map((name) => canonicalStoreName(name) || name) : lock ? [lock] : [];
  const location = stores.length === 1 ? stores[0] : '';
  const sources = [...new Set((Array.isArray(args?.sources) ? args.sources : []).map((key) => String(key || '')))];
  const search = String(args?.inventorySearch || '').trim();
  const lookup = {};
  try {
    if (sources.includes('inventory') && search) {
      context.onStatus?.('Searching stock…');
      lookup.inventory = await searchInventory(context.session, search, stores, context.signal);
    }
    const rest = sources.filter((key) => key !== 'inventory' || !search);
    if (rest.length) {
      context.onStatus?.('Loading company data…');
      const loaded = await loadCompanyData(context.session, {
        sources: rest,
        location,
        allStores: !location,
        startDate: dates.startDate,
        endDate: dates.endDate,
        question: context.question,
        onProgress: (label) => context.onStatus?.(label),
      });
      if (loaded?.error) return { error: loaded.error };
      Object.assign(lookup, loaded);
    }
  } catch (error) {
    if (context.signal?.aborted || error?.name === 'AbortError') throw error;
    return { error: error?.message || 'Company data did not load.' };
  }
  if (!Object.keys(lookup).length) return { error: 'Pick at least one dataset.' };
  if (stores.length > 1) {
    lookup.note = `Datasets other than inventory cover all stores here; keep only ${stores.join(', ')} when you answer.`;
  }
  return { modelResult: clampJson(lookup, MAX_LOOKUP_CHARS) };
}

const TOOL_NAMES = new Set([
  'lookup_company_data',
  'search_customers',
  'query_transactions',
  'list_transactions',
  'show_line_chart',
  'show_bar_chart',
  'show_pie_chart',
  'draw_chart',
  'show_table',
  'inventory_history',
  'show_area_map',
  'show_customer_map',
]);

async function runTool(name, args, context) {
  if (!TOOL_NAMES.has(name)) return { error: 'That tool is not available.' };
  if (name === 'lookup_company_data') return companyLookup(args, context);
  if (name === 'search_customers') return customerSearch(args, context);
  if (name === 'show_area_map') {
    try {
      return await areaMap(args, context);
    } catch (error) {
      if (context.signal?.aborted || error?.name === 'AbortError') throw error;
      return { error: error?.message || 'Could not draw that area.' };
    }
  }
  if (name === 'inventory_history') {
    try {
      return await inventoryHistory(args, context);
    } catch (error) {
      if (context.signal?.aborted || error?.name === 'AbortError') throw error;
      return { error: error?.message || 'Could not read inventory history.' };
    }
  }
  if (name === 'draw_chart') return freeChart(args);
  if (name === 'show_table') return freeTable(args);
  let scoped;
  try {
    scoped = await resolveScope(args, context);
  } catch (error) {
    if (context.signal?.aborted || error?.name === 'AbortError') throw error;
    return { error: error?.message || 'Could not load those transactions.' };
  }
  if (scoped.error) return { error: scoped.error };
  if (name === 'query_transactions') return queryTransactions(args, scoped);
  if (name === 'list_transactions') return listTransactions(args, scoped);
  if (name === 'show_line_chart') return seriesChart('line', args, scoped);
  if (name === 'show_bar_chart') return seriesChart('bar', args, scoped);
  if (name === 'show_pie_chart') return pieChart(args, scoped);
  return customerMap(args, scoped, context);
}

// Only an explicit ask for a picture forces a tool; otherwise the model decides
// between a chart, a numbers lookup, or a plain answer.
function wantsPicture(question) {
  return /\b(chart|graph|plot|pie|map|draw|drawn|visuali[sz]e|table|tabulate|spreadsheet|grid|outline)\b/i.test(question);
}

function friendlyUpstreamError(status, message) {
  const text = String(message || '');
  if (status === 402 || /credits/i.test(text)) {
    return 'OpenRouter has no credits left for this key. Add credits at openrouter.ai, or wait for other requests to finish, then try again.';
  }
  if (status === 429) return 'OpenRouter is rate limiting this key. Wait a moment and try again.';
  if (status === 404 && /model/i.test(text)) return 'That model is not available on OpenRouter right now. Pick another model.';
  return text || 'OpenRouter could not answer.';
}

// Some models count reasoning against max_tokens, so leave room or replies get cut off.
export async function completeOpenRouter({ model, messages, tools, toolChoice, maxTokens = 2500, signal }) {
  const body = {
    model,
    messages,
    stream: false,
    max_tokens: maxTokens,
    // Keep hidden reasoning short so the visible answer is not squeezed out. Ignored by models without it.
    reasoning: { effort: 'low' },
  };
  if (tools) {
    body.tools = tools;
    body.tool_choice = toolChoice || 'auto';
  }
  const response = await proxyFetch('openrouter/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(friendlyUpstreamError(response.status, payload?.error?.message || payload?.message));
  }
  // OpenRouter can return 200 with an error body when the upstream provider refuses.
  if (payload?.error && !payload?.choices?.length) {
    throw new Error(friendlyUpstreamError(Number(payload.error.code) || 0, payload.error.message));
  }
  const choice = payload?.choices?.[0];
  const message = choice?.message || null;
  if (message && Array.isArray(message.content)) {
    message.content = message.content
      .map((part) => (typeof part === 'string' ? part : part?.text || ''))
      .join('')
      .trim();
  }
  if (message) message.finishReason = choice?.finish_reason || choice?.native_finish_reason || '';
  const usage = readOpenRouterUsage(payload?.usage);
  if (message) {
    if (usage) message.usage = usage;
    return message;
  }
  return { role: 'assistant', content: '', usage: usage || undefined };
}

function systemPrompt({ scopeLabel, startDate, endDate, storeFilter, stores }) {
  const today = formatDateParam(new Date());
  const storeLine = `${storeFilter ? `The screen is set to the ${storeFilter} store; that applies only when the user names no store. ` : ''}Stores with transactions in the loaded dates: ${stores.length ? stores.join(', ') : 'none yet'}. All Canada Gold stores: ${HOME_PINNED_STORES.join(', ')}.`;
  return `You are a Canada Gold colleague in Analytics. Today is ${today}. The loaded view is ${scopeLabel}, covering ${startDate} to ${endDate}.
${storeLine}

Numbers come only from Analysis or from a tool result. Never invent a count, a dollar amount, a name, or a place.

Know when a question is general. "Where is NDG", "what does FSA mean", "which postal codes are Westmount", "what is a Maple Leaf DNA coin", "how far is Laval from Montreal" are general knowledge, not questions about our data: answer them plainly from what you know, without calling a data tool or mentioning customers, transactions, or stock. If a general question asks to see a place, call show_area_map with the place name and nothing else; only add customers when the user says customers. Only reach for company data when the question is about our stores, staff, customers, tickets, or stock.

Decide the best form of answer. If they ask for a chart, graph, pie, line, bar, or map, draw exactly that kind, with the grouping they asked for (a line chart per employee is a line chart grouped by employee). If they ask a question that needs numbers but no picture (top customers, repeat customers, totals, who sold the most, compare three stores), call query_transactions and answer in words. If the question is about the loaded view and Analysis already has the figures, answer in words. Do not describe a picture you did not request. Tools pull real POS transactions, so they can cover dates other than the loaded view and several stores at once.

Anything that is not a sale or purchase comes from lookup_company_data. Datasets:
${COMPANY_DATA_SOURCES.map((source) => `- ${source.key}: ${source.hint}`).join('\n')}
Stock on hand "right now" is the inventory dataset with inventorySearch set to the product words (for "1 ounce gold bars" use "1 oz gold bar"); that lookup is today's snapshot. Stock over time is inventory_history: it reads the POS quantity as of each day in the range and draws the line chart. Inventory does have history; never say it is only a snapshot. House labels: GBAR is a gold bar (carded, uncarded, SEALED, UNSEALED). SBAR is a silver bar. GML is a Gold Maple Leaf (also Maplegram, MLBD). SML is a Silver Maple Leaf. RCM is Royal Canadian Mint (GBAR 1oz RCM, SBAR 10oz RCM). Treat those codes and the long names as the same product. A named person who is a customer is search_customers. Private direct messages are the only thing not searchable. Never say you lack inventory, till, hours, review, phone, email, pricing, triage, audit, payment, or customer data; look it up, and combine several tools in one turn when a question spans them.

Dates: if the user names a period, pass startDate and endDate. "Past month" or "last 30 days" is the 30 days ending today. "This month" is the 1st of this month to today. "Last week" is the previous Monday to Sunday. "Past week" is the 7 days ending today. If they name no period, omit the dates and the loaded view is used. Keep ranges to ${MAX_RANGE_DAYS} days or fewer.

Stores: if the user names stores (Montreal, Laval, Quebec, Toronto, …), pass stores with those names. "Quebec City" is the Quebec store. Omit stores for all stores. Never tell the user to change a filter, a date picker, or a setting; the tools take the stores and dates directly. Never say you lack a tool for numbers; query_transactions returns any ranking or total.

Analysis below describes only the loaded view. For any other dates or a single store, call a tool and trust its result, not Analysis. Do not answer a store or period question from Analysis when a tool can answer it.

Chart choice: transactions per employee or per store is a bar chart. Trends over days are a line chart. Share of a total is a pie chart. Where customers live is a map: "the Montreal store's customers" is store Montreal with no city, and the dots can be in Laval, Longueuil, or anywhere else those customers live. Set city only when the user asks about customers who live in a city.

Any other relationship can be drawn too. When the user wants a picture of something that is not transactions (stock by SKU or by store, till balances, hours, reviews, payment mix, FINTRAC counts), first call lookup_company_data or search_customers, then call draw_chart with the labels and values from that result. If the numbers are already in this conversation from an earlier tool result, call draw_chart with them directly. Never answer a transaction chart tool for an inventory question, and never say a chart cannot be drawn; draw_chart takes any labels and numbers. Give the chart a title and subtitle that say what the numbers are and where they came from.

Tables: when the user asks for a table, or the answer has several columns per row, call show_table with the rows from the tool result (numbers as numbers, a total row when it helps). The app renders it sortable. Never type a table as markdown pipes in your answer; the text should be one or two sentences that introduce the table.

Slicing the ledger: every transaction tool takes filters. A neighbourhood, borough, or postal area is postalPrefixes with its forward sortation areas (Griffintown H3C; Westmount H3Y, H3Z; NDG H4A, H4B; Plateau H2H, H2J, H2T, H2W; Old Montreal H2Y; Laval H7; Longueuil J4; Brossard J4W–J4Z; Toronto downtown M5; Mississauga L4, L5). A city is cities. A customer, an employee, a product, a payment method, or an amount range each has its own filter, and they combine. When the user wants the tickets themselves (PO#, SO#, "which transactions", "list them"), call list_transactions; when they want a total or ranking over a slice, call query_transactions with the same filters; when they want a picture of a slice, call the chart tool with the filters. Never say transactions cannot be filtered by neighbourhood or postal code, and never offer to do it by hand. Write ticket numbers exactly as the tool gives them (PO# 12345, SO# 67890); the app turns them into links.

After a tool result, write the answer in plain sentences. No markdown, no bullet list, no sign-off. Say which dates and stores it covers, then quote the formatted values from the tool result. For a ranking, name each entry with its figure, in order. For a chart, keep it to a few sentences; the chart shows the detail.

Transaction count is "transactions". Transaction cost or dollar volume is "volume". Average ticket is "avgTicket". Buys and sells are separate.

Customer maps place each customer at the home address on their POS record, or the postal code when there is no street. Report customersOnMap out of customers, and say how many had no address on file. Do not claim more dots than customersOnMap.`;
}

function localSummary(charts, failure) {
  const first = charts[0];
  const tail = failure ? ` (${failure})` : '';
  if (!first) return `Here’s what the transactions show.${tail}`;
  const where = first.subtitle ? ` It covers ${first.subtitle}.` : '';
  if (first.type === 'map' && first.style === 'area') return `${first.title} is outlined on the map.${tail}`.trim();
  if (first.type === 'map') return `${first.title}.${where} ${first.note || ''}${tail}`.trim();
  if (first.type === 'table') return `${first.title}: ${first.rows?.length || 0} rows.${where}${tail}`;
  return `${first.title}.${where}${tail}`;
}

function parseToolArgs(raw) {
  if (raw && typeof raw === 'object') return raw;
  try {
    return JSON.parse(String(raw || ''));
  } catch {
    return null;
  }
}

/**
 * One typed turn. Charts are computed here; the model only chooses the tool
 * and writes the sentence afterwards.
 */
export async function askAnalytics({
  model,
  history = [],
  question,
  scopeLabel,
  brief,
  rows,
  startDate,
  endDate,
  storeFilter,
  session,
  mapsKey,
  signal,
  onStatus,
}) {
  const prior = (history || [])
    .filter((turn) => (turn.role === 'user' || turn.role === 'assistant') && String(turn.content || '').trim())
    .slice(-12)
    .map((turn) => ({ role: turn.role, content: String(turn.content) }));
  const messages = [
    {
      role: 'system',
      content: systemPrompt({ scopeLabel, startDate, endDate, storeFilter, stores: storeNamesIn(rows) }),
    },
    ...prior,
    {
      role: 'user',
      content: `${question}\n\nAnalysis:\n${JSON.stringify(brief || {})}`,
    },
  ];
  const context = { rows, startDate, endDate, storeFilter, session, mapsKey, signal, onStatus, question };

  onStatus?.('Reading the question…');
  const charts = [];
  let usage = null;
  let toolChoice = wantsPicture(question) ? 'required' : 'auto';
  let usedTools = false;
  // Up to three rounds: the model can look something up, then refine (fix a store
  // name, narrow a search) before it writes the answer.
  for (let round = 0; round < 3; round += 1) {
    const reply = await completeOpenRouter({ model, messages, tools: TOOLS, toolChoice, signal });
    usage = addUsage(usage, reply?.usage);
    const calls = Array.isArray(reply?.tool_calls) ? reply.tool_calls.slice(0, 4) : [];
    if (!calls.length) {
      const text = String(reply?.content || '').trim();
      if (text) return finishAnswer(text, charts, usage);
      if (!usedTools) {
        throw new Error(
          reply?.finishReason === 'length'
            ? 'The model ran out of room before answering. Try a shorter question or another model.'
            : 'The model sent back an empty answer. Try again or pick another model.',
        );
      }
      break;
    }

    usedTools = true;
    onStatus?.('Looking that up…');
    messages.push({ role: 'assistant', content: reply.content || '', tool_calls: calls });
    for (const call of calls) {
      const name = call?.function?.name || '';
      const args = parseToolArgs(call?.function?.arguments);
      const result = args ? await runTool(name, args, context) : { error: 'The request was not valid.' };
      if (result.chart) charts.push(result.chart);
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(result.modelResult || { error: result.error || 'Could not complete that.' }),
      });
    }
    toolChoice = 'auto';
  }

  onStatus?.('Writing the answer…');
  let text = '';
  let failure = '';
  try {
    const summary = await completeOpenRouter({ model, maxTokens: 4000, signal, messages });
    usage = addUsage(usage, summary?.usage);
    text = String(summary?.content || '').trim();
    if (!text && summary?.finishReason === 'length') failure = 'The model ran out of room before answering.';
  } catch (error) {
    if (signal?.aborted || error?.name === 'AbortError') throw error;
    failure = error?.message || 'The model could not write the answer.';
  }
  if (!text && !charts.length) {
    throw new Error(failure || 'The model sent back an empty answer. Try again or pick another model.');
  }
  return finishAnswer(text || localSummary(charts, failure), charts, usage);
}

// A pipe table typed into the prose is lifted out into a real table card.
function finishAnswer(text, charts, usage) {
  const lifted = extractMarkdownTables(text);
  if (!lifted.charts.length) return { text, charts, usage };
  const tableTitle = charts.length ? 'Table' : firstSentence(text) || 'Table';
  const tables = lifted.charts.map((chart, index) => ({
    ...chart,
    title: index === 0 ? tableTitle : chart.title,
  }));
  return { text: lifted.text || localSummary(tables, ''), charts: [...charts, ...tables], usage };
}

function firstSentence(text) {
  const line = String(text || '')
    .split('\n')
    .map((item) => item.trim())
    .find(Boolean);
  if (!line) return '';
  return line.replace(/[:.\s]+$/, '').replace(/^(here is|here's|here are|below is|this is)\s+/i, '').slice(0, 80);
}
