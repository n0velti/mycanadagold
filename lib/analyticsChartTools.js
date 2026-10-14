import AsyncStorage from '@react-native-async-storage/async-storage';
import { WEEKDAYS, formatMeasure, isRetailStore, weekdayName } from './employeeMetrics';
import { proxyFetch, proxyJson } from './proxy';
import { HOME_PINNED_STORES, canonicalStoreName, storesMatch } from './storeCatalog';
import { AI_PRIVACY_RULES, COMPANY_DATA_SOURCES, loadCompanyData, privateScopeNote } from './aiChat';
import { authHeaders, posFetch, posSystemsFromSession } from './auth';
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
import { attachmentLabel, attachmentParts, attachmentsText, hasPdf } from './aiAttachments';
import { readDocumentForAssistant, searchDocumentsForAssistant } from './documents';
import { fetchTransferStores } from './locations';
import { computeTransferPlan, defaultSplitsForMode, detectTransferMode, fetchTransferInventory } from './transferPlan';
import { appendCompanyInstructions, loadAiInstruction } from './aiInstructions';

const FSA_CACHE_KEY = 'cgold.analytics.postalPoints';
const PLACE_CACHE_KEY = 'cgold.analytics.customerPoints';
const MAX_NEW_GEOCODES = 600;
const MAX_CUSTOMER_LOOKUPS = 1200;
const MAX_LINE_POINTS = 370;
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
  transactionsPerDay: { label: 'Transactions per day', format: 'decimal' },
  volumePerDay: { label: 'Volume per day', format: 'money' },
};

// Per-day measures divide by the calendar days a bucket covers inside the
// asked range (a week is 7, a partial week at either end is fewer, a store
// or employee row is the whole range), so the model never averages by hand.
const PER_DAY_MEASURES = { transactionsPerDay: 'transactions', volumePerDay: 'volume' };
const TIME_GROUPS = new Set(['date', 'week', 'month']);

const LINE_GROUPS = new Set(['date', 'week', 'month', 'weekday', 'employee', 'store', 'txType']);
const BAR_GROUPS = new Set(['employee', 'store', 'weekday', 'txType', 'date', 'week', 'month']);
const PIE_GROUPS = new Set(['store', 'employee', 'txType', 'weekday']);

// The ledger tools take up to a year in one call; the POS is read a calendar
// month at a time and each month is kept, so "since January" is one fetch and
// every follow-up on the same period is free. Other dated lookups (inventory
// history, company datasets) stay at a quarter because they are heavier per day.
const MAX_RANGE_DAYS = 366;
const MAX_LOOKUP_RANGE_DAYS = 92;
const MAX_TOOL_ROUNDS = 6;
const MAX_CALLS_PER_ROUND = 8;
const MAX_TOOL_RESULT_CHARS = 16000;
const TOOL_CONCURRENCY = 3;
const MONTH_CACHE_LIMIT = 14;
const MONTH_FETCH_CONCURRENCY = 2;
const monthCache = new Map();

const SCOPE_PROPERTIES = {
  startDate: {
    type: 'string',
    description:
      'YYYY-MM-DD. Required for anything about a period: the dates the user named (past month, last week, September), or the dates from the earlier answer when this is a follow-up. There is no default period; if the user has not named one, ask them instead of calling the tool.',
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

const QUERY_GROUPS = ['employee', 'store', 'customer', 'date', 'week', 'month', 'weekday', 'txType', 'none'];
const QUERY_LIMIT_DEFAULT = 10;
const QUERY_LIMIT_MAX = 400;

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'lookup_company_data',
      description:
        'Read live company data outside the transaction ledger: inventory stock on hand, cash tills, Rippling from its latest imported report files (the shift schedule for any date, who is clocked in, hours this week and last week, and hours per person between startDate and endDate), Google reviews, phone answering, the signed-in user\'s own emails (every Gmail inbox they connected in the Emails app, with message bodies) and their own direct messages — use emails and messages together for tasks, to-dos, outstanding requests, and follow-ups — website metal prices, FINTRAC cash deals, cash and debit payments, bonuses, staff directory, teams, bullion audit variances, premium jewelry. Pick only the datasets the question needs. Everything comes back as real figures.',
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
        'Aggregate POS transactions: totals, rankings, top customers, repeat customers, comparisons across stores or dates, grouped one row per employee, store, customer, date, week, month, weekday, or buy/sell. Every row carries transactions, volume, buys, sells, avgTicket, and the per-day averages (transactionsPerDay, volumePerDay) already computed over the calendar days that row covers, so never average by hand. One call covers up to a year: "since January" is one call with groupBy week or month, not one call per month. Filters narrow the slice first (a postal area, a city, a product, a payment method, an amount range). Every figure comes from the POS.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          groupBy: {
            type: 'string',
            enum: QUERY_GROUPS,
            description: 'One row per employee, store, customer, date, week (Monday to Sunday), month, weekday, buy/sell, or "none" for one total row.',
          },
          sortBy: { type: 'string', enum: Object.keys(MEASURES), description: 'Highest first. Default transactions. Ignored for date, week, and month, which come back in order.' },
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: QUERY_LIMIT_MAX,
            description: `Rows to return. Default ${QUERY_LIMIT_DEFAULT} for rankings; date, week, and month return every bucket in the range unless you set this.`,
          },
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
        'Draw a line chart of POS transactions only. The app computes every number from the ledger, including per-day averages, over up to a year in one call. Use this for trends over dates, weeks, months, or weekdays and for how two measures move together: "average transactions per day for each week since January" is one call with measures ["transactionsPerDay"], groupBy "week", and startDate January 1. Filters narrow the slice first. For other numbers, use draw_chart.',
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
        'Draw a bar chart of POS transactions only. The app computes every number from the ledger; the labels are always employees, stores, dates, weeks, months, weekdays, or buy/sell. Use this to compare employees or stores, for example transactions per employee, ranked highest first, or month-by-month totals over up to a year. Filters narrow the slice first. For stock, tills, hours, or any other numbers, use draw_chart.',
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
            maxItems: 120,
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
      name: 'export_spreadsheet',
      description:
        'Build an Excel (.xlsx) file the user can download from the chat. Use it whenever the user asks for a spreadsheet, Excel, xlsx, CSV, export, download, or "send me the data". Each sheet is a tab. A sheet either pulls a full dataset itself (source: every matching ticket, a grouped summary, current stock, or stock history, with the user\'s filters and the columns they asked for) or takes rows you already have (rows). Pulled sheets include every matching row, not just what was shown in chat. The user can name the tabs and choose columns; honour that exactly.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          fileName: { type: 'string', description: 'Without extension, such as "Montreal tickets Sep 11 to Oct 11".' },
          sheets: {
            type: 'array',
            minItems: 1,
            maxItems: 8,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                name: { type: 'string', description: 'Tab name, up to 31 characters.' },
                source: {
                  type: 'string',
                  enum: ['transactions', 'transaction_summary', 'inventory', 'inventory_history'],
                  description:
                    'transactions: one row per PO/SO ticket. transaction_summary: one row per groupBy value with counts and dollars. inventory: current stock per product per store. inventory_history: stock per product per store per day. Omit when passing rows.',
                },
                columns: {
                  type: 'array',
                  items: { type: 'string' },
                  description:
                    'Column keys in order. transactions: ticket, date, time, type, store, employee, customer, email, city, postal, items, amount, currency, payment, system. transaction_summary: name, transactions, volume, buys, sells, buyVolume, sellVolume, avgTicket, transactionsPerDay, volumePerDay, days, daysWithSales, uniqueCustomers, stores, firstVisit, lastVisit. inventory: name, sku, metal, total, then one column per store. inventory_history: date, product, store, qty. For rows you pass yourself, the keys of your row objects. Omit for the default set.',
                },
                columnLabels: {
                  type: 'object',
                  description: 'Optional header text per column key, such as {"amount": "Total $"}.',
                },
                groupBy: { type: 'string', enum: QUERY_GROUPS, description: 'transaction_summary only.' },
                sortBy: { type: 'string', enum: ['date', 'amount', ...Object.keys(MEASURES)], description: 'transactions: date or amount. transaction_summary: a measure.' },
                search: { type: 'string', description: 'inventory and inventory_history: product words. Omit for the whole stock list.' },
                rows: {
                  type: 'array',
                  maxItems: 500,
                  items: { type: 'object' },
                  description: 'Rows you already have from a tool result, when no source applies.',
                },
                ...SCOPE_PROPERTIES,
                ...FILTER_PROPERTIES,
              },
              required: ['name'],
            },
          },
        },
        required: ['sheets'],
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
  {
    type: 'function',
    function: {
      name: 'plan_transfer',
      description:
        'The Transfer app\'s plan: what bullion to move between Canada Gold East stores along a one-way route such as Montreal → Laval, Montreal → Laval → Quebec, or a route ending at Workshop. It reads live stock at every stop, applies the Transfer app\'s territory split (green and yellow priority products balanced 50% Montreal, 25% Laval, 25% Quebec City; when Workshop is on the route it takes 50% of yellow and all red), and returns every move with the quantity to send and the stock at both ends. Use this whenever the user asks what to transfer, what to send, what to move, how to balance stock, or for a transfer list. The table is drawn for you.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          route: {
            type: 'array',
            minItems: 2,
            maxItems: 5,
            items: { type: 'string' },
            description: 'Store names in travel order, the sending store first: ["Montreal", "Laval"]. Quebec City is "Quebec".',
          },
          search: {
            type: 'string',
            description: 'Optional product words to keep only some products, such as "gold bar", "GML", "silver maple".',
          },
        },
        required: ['route'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_documents',
      description:
        'Search the Documents library: files staff uploaded (Excel, Word, PDF, images, video, text, and other formats), organized in folders. Matches file names and the text extracted from spreadsheets, Word, and text files. Use this when the question is about a policy, memo, price sheet, report, or any uploaded file rather than live POS data.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          query: { type: 'string', description: 'Words from the file name or its contents. At least 2 characters.' },
          folder: { type: 'string', description: 'Optional folder name to keep, such as "Policies".' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_document',
      description:
        'Read one file from Documents. Pass the id from search_documents. Spreadsheets, Word, and text come back as text. Photos, video frames, and PDFs are attached for you to look at. Quote figures as they appear, and say when the text was trimmed.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', description: 'Document id from search_documents.' },
          name: { type: 'string', description: 'File name, used only when you do not have an id.' },
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

function abortError() {
  return Object.assign(new Error('aborted'), { name: 'AbortError' });
}

// Calendar-month windows covering [startDate, endDate], clipped at both ends.
function monthWindows(startDate, endDate) {
  const windows = [];
  let cursor = parseDateParam(startDate);
  const end = parseDateParam(endDate);
  while (cursor <= end) {
    const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    const stop = monthEnd < end ? monthEnd : end;
    windows.push({ startDate: formatDateParam(cursor), endDate: formatDateParam(stop) });
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  }
  return windows;
}

// One POS read per calendar month, shared by every tool call in the session.
// The promise is cached (not the rows) so parallel tool calls for overlapping
// periods wait on the same fetch instead of each hitting the POS. The month
// that holds today is keyed by today so tomorrow reads it fresh.
function monthRows(session, window, userKey) {
  const today = formatDateParam(new Date());
  const live = window.endDate >= today;
  const key = `${userKey}|${window.startDate}|${live ? today : window.endDate}`;
  if (monthCache.has(key)) {
    const hit = monthCache.get(key);
    monthCache.delete(key);
    monthCache.set(key, hit);
    return hit;
  }
  const pending = fetchTransactionsAcrossPos(session, { ...window, includePurchases: true })
    .then((result) => (Array.isArray(result?.rows) ? result.rows : []))
    .catch((error) => {
      monthCache.delete(key);
      throw error;
    });
  if (monthCache.size >= MONTH_CACHE_LIMIT) monthCache.delete(monthCache.keys().next().value);
  monthCache.set(key, pending);
  return pending;
}

async function fetchRange(session, startDate, endDate, signal, onStatus) {
  if (!session?.token) throw new Error('Sign in again to load other dates.');
  const userKey = String(session?.supabaseUserId || session?.profile?.id || session?.token || '').slice(0, 40);
  const windows = monthWindows(startDate, endDate);
  let done = 0;
  const label = rangeLabel(startDate, endDate);
  const batches = await mapPool(windows, MONTH_FETCH_CONCURRENCY, async (window) => {
    const rows = await monthRows(session, window, userKey);
    if (signal?.aborted) throw abortError();
    done += 1;
    if (windows.length > 1) onStatus?.(`Loading ${label}… ${done} of ${windows.length} months`);
    return rows;
  });
  if (signal?.aborted) throw abortError();
  // A month window is wider than the asked range at the edges; keep the asked days.
  const rows = [];
  for (const batch of batches) {
    for (const row of batch) {
      const day = formatDateParam(row.date);
      if (day >= startDate && day <= endDate) rows.push(row);
    }
  }
  return rows;
}

const NO_PERIOD_ERROR =
  'No period was given. Pass startDate and endDate: the dates the user named, or the dates from the earlier answer if this is a follow-up. If the user has not named a period, ask which dates to look at instead of guessing.';

// No default period. The screen preloads a week as a cache, but a tool call
// without dates is answered with a request for them, not with that week.
// allowFuture: the shift schedule is the one dataset that legitimately runs past today.
function resolveDates(args, { todayIfMissing = false, allowFuture = false, maxDays = MAX_RANGE_DAYS } = {}) {
  const today = formatDateParam(new Date());
  const askedStart = isoDate(args?.startDate);
  const askedEnd = isoDate(args?.endDate);
  if (!askedStart && !askedEnd) {
    if (!todayIfMissing) return { error: NO_PERIOD_ERROR };
    return { startDate: today, endDate: today };
  }
  if ((args?.startDate && !askedStart) || (args?.endDate && !askedEnd)) return { error: 'Dates must be YYYY-MM-DD.' };
  let startDate = askedStart || askedEnd;
  let endDate = askedEnd || askedStart;
  if (startDate > endDate) [startDate, endDate] = [endDate, startDate];
  if (!allowFuture) {
    if (endDate > today) endDate = today;
    if (startDate > today) return { error: 'That range is in the future.' };
  }
  const days = dayCount(startDate, endDate);
  if (days > maxDays) {
    return { error: `That range is ${days} days. Ask for ${maxDays} days or fewer.` };
  }
  return { startDate, endDate };
}

/**
 * Which transactions a tool call is about: the asked range fetched from the
 * POS (or the preloaded rows when they happen to cover exactly that range),
 * narrowed to one store when asked.
 */
async function resolveScope(args, context) {
  const dates = resolveDates(args);
  if (dates.error) return dates;
  const { startDate, endDate } = dates;

  let rows = context.rows;
  const sameRange =
    Array.isArray(rows) && startDate === isoDate(context.startDate) && endDate === isoDate(context.endDate);
  if (!sameRange) {
    context.onStatus?.(`Loading ${rangeLabel(startDate, endDate)}…`);
    rows = await fetchRange(context.session, startDate, endDate, context.signal, context.onStatus);
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
  // Ticket rows rarely carry the customer's postal code or city; the customer
  // record does. Fill those in the same way the map does so a postal or city
  // filter sees the same people the map and pie did.
  const places = filters.postalPrefixes.length || filters.cities.length
    ? await customerPlacesFor(unfiltered, context)
    : null;
  const source = filters.active ? unfiltered.filter((row) => rowPassesFilters(row, filters, places)) : unfiltered;
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
    places,
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

/** Postal code and city per customer key, from the ticket or the customer record. */
async function customerPlacesFor(rows, context) {
  const people = new Map();
  for (const row of rows) {
    const key = customerKey(row);
    if (!key || people.has(key)) continue;
    people.set(key, {
      key,
      systemKey: String(row.systemKey || ''),
      clientId: String(row.customerId || '').trim(),
      postal: normalizePostal(row.customerPostal),
      city: String(row.customerCity || '').trim(),
      street: '',
      province: '',
      lat: null,
      lng: null,
      lookedUp: false,
      transactions: 0,
    });
  }
  if (people.size) {
    context.onStatus?.('Reading customer addresses…');
    await fillCustomerPlaces(people, context.session, context.signal, context.onStatus);
  }
  return people;
}

function rowPassesFilters(row, filters, places) {
  const person = places?.get(customerKey(row));
  if (filters.postalPrefixes.length) {
    const postal = String(person?.postal || row.customerPostal || '').toUpperCase().replace(/\s+/g, '');
    if (!postal || !filters.postalPrefixes.some((prefix) => postal.startsWith(prefix))) return false;
  }
  if (filters.cities.length) {
    const city = fold(person?.city || row.customerCity);
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
    postal: String(scope.places?.get(customerKey(row))?.postal || row.customerPostal || '').toUpperCase().trim() || '',
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

// Monday of the week holding `day`, as YYYY-MM-DD.
function weekStart(day) {
  const date = parseDateParam(day);
  const offset = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - offset);
  return formatDateParam(date);
}

function monthStart(day) {
  return `${String(day).slice(0, 7)}-01`;
}

function shortDay(day, withYear = false) {
  return parseDateParam(day).toLocaleDateString('en-CA', withYear ? { month: 'short', day: 'numeric', year: 'numeric' } : { month: 'short', day: 'numeric' });
}

function monthLabel(key) {
  return parseDateParam(`${String(key).slice(0, 7)}-01`).toLocaleDateString('en-CA', { month: 'short', year: 'numeric' });
}

function bucketName(groupBy, key) {
  if (groupBy === 'week') return `Week of ${shortDay(key, true)}`;
  if (groupBy === 'month') return monthLabel(key);
  return key;
}

// Calendar days a bucket covers inside the asked range. Partial weeks and
// months at either end count only their days in range; a store or employee
// row covers the whole range; a weekday row counts that weekday's occurrences.
function bucketDays(groupBy, key, scope) {
  const start = isoDate(scope?.startDate);
  const end = isoDate(scope?.endDate);
  if (!start || !end) return 0;
  if (groupBy === 'date') return 1;
  if (groupBy === 'week' || groupBy === 'month') {
    const from = groupBy === 'week' ? key : monthStart(key);
    const toDate = parseDateParam(from);
    if (groupBy === 'week') toDate.setDate(toDate.getDate() + 6);
    else toDate.setMonth(toDate.getMonth() + 1, 0);
    const to = formatDateParam(toDate);
    const lo = from > start ? from : start;
    const hi = to < end ? to : end;
    return hi < lo ? 0 : dayCount(lo, hi);
  }
  if (groupBy === 'weekday') {
    const wanted = WEEKDAYS.indexOf(key);
    if (wanted < 0) return 0;
    let count = 0;
    const cursor = parseDateParam(start);
    const stop = parseDateParam(end);
    while (cursor <= stop) {
      if (cursor.getDay() === wanted) count += 1;
      cursor.setDate(cursor.getDate() + 1);
    }
    return count;
  }
  return dayCount(start, end);
}

function groupLabel(row, groupBy) {
  if (groupBy === 'date') return formatDateParam(row.date);
  if (groupBy === 'week') return weekStart(formatDateParam(row.date));
  if (groupBy === 'month') return String(formatDateParam(row.date)).slice(0, 7);
  if (groupBy === 'weekday') return weekdayName(row.date);
  if (groupBy === 'store') return String(row.storeName || '').trim() || '—';
  if (groupBy === 'employee') return String(row.employeeName || '').trim() || '—';
  if (groupBy === 'txType') return row.type === 'purchase' ? 'Buy' : 'Sell';
  if (groupBy === 'customer') return customerKey(row);
  if (groupBy === 'none') return 'Total';
  return '';
}

function axisLabel(groupBy, key) {
  if (groupBy === 'date' || groupBy === 'week') return shortDay(key);
  if (groupBy === 'month') return monthLabel(key);
  return key;
}

function sortTimeKeys(groupBy, keys) {
  if (groupBy === 'weekday') return keys.sort((a, b) => WEEKDAYS.indexOf(a) - WEEKDAYS.indexOf(b));
  return keys.sort((a, b) => String(a).localeCompare(String(b)));
}

// Time buckets come back in calendar order, including the empty ones in the
// range (a week with no sales is a real zero, not a missing point).
function timeKeysFor(groupBy, scope) {
  const start = isoDate(scope?.startDate);
  const end = isoDate(scope?.endDate);
  if (!start || !end || !TIME_GROUPS.has(groupBy)) return [];
  const keys = [];
  if (groupBy === 'date') {
    for (let day = start; day <= end; day = shiftIso(day, 1)) keys.push(day);
  } else if (groupBy === 'week') {
    for (let day = weekStart(start); day <= end; day = shiftIso(day, 7)) keys.push(day);
  } else {
    const cursor = parseDateParam(monthStart(start));
    const stop = parseDateParam(end);
    while (cursor <= stop) {
      keys.push(formatDateParam(cursor).slice(0, 7));
      cursor.setMonth(cursor.getMonth() + 1, 1);
    }
  }
  return keys;
}

function emptyBucket(groupBy, key, name) {
  return {
    key,
    name,
    transactions: 0,
    volume: 0,
    buys: 0,
    sells: 0,
    buyVolume: 0,
    sellVolume: 0,
    stores: new Set(),
    customers: new Set(),
    days: new Set(),
    firstDate: '',
    lastDate: '',
  };
}

function accumulate(rows, groupBy, scope) {
  const buckets = new Map();
  for (const key of timeKeysFor(groupBy, scope)) buckets.set(key, emptyBucket(groupBy, key, bucketName(groupBy, key)));
  for (const row of rows) {
    const key = groupLabel(row, groupBy);
    if (!key) continue;
    const bucket = buckets.get(key) || emptyBucket(
      groupBy,
      key,
      groupBy === 'customer' ? String(row.customerName || '').trim() || '—' : bucketName(groupBy, key),
    );
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
    bucket.days.add(day);
    if (!bucket.firstDate || day < bucket.firstDate) bucket.firstDate = day;
    if (!bucket.lastDate || day > bucket.lastDate) bucket.lastDate = day;
    buckets.set(key, bucket);
  }
  for (const bucket of buckets.values()) {
    bucket.avgTicket = bucket.transactions ? bucket.volume / bucket.transactions : 0;
    bucket.daysInRange = bucketDays(groupBy, bucket.key, scope) || bucket.days.size;
    bucket.daysWithSales = bucket.days.size;
    for (const [measure, base] of Object.entries(PER_DAY_MEASURES)) {
      bucket[measure] = bucket.daysInRange ? bucket[base] / bucket.daysInRange : 0;
    }
  }
  return buckets;
}

// Time buckets in calendar order; everything else highest first by `sortBy`.
function orderBuckets(groupBy, entries, sortBy) {
  if (TIME_GROUPS.has(groupBy)) return entries.sort((a, b) => String(a.key).localeCompare(String(b.key)));
  if (groupBy === 'weekday') return entries.sort((a, b) => WEEKDAYS.indexOf(a.key) - WEEKDAYS.indexOf(b.key));
  return entries.sort((a, b) => (b[sortBy] || 0) - (a[sortBy] || 0));
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
  const timeSeries = TIME_GROUPS.has(groupBy);
  const sortBy = MEASURES[args?.sortBy] ? args.sortBy : 'transactions';
  const asked = Number(args?.limit) || 0;
  const limit = Math.min(QUERY_LIMIT_MAX, Math.max(1, asked || (timeSeries ? QUERY_LIMIT_MAX : QUERY_LIMIT_DEFAULT)));
  // Empty weeks and months are real zeros; keep them unless the model asks for a floor.
  const minTransactions = Math.max(timeSeries ? 0 : 1, Number(args?.minTransactions) || 0);
  const { source, scope } = scoped;
  if (!source.length) return { error: `No transactions for ${scope.label}.` };

  const buckets = accumulate(source, groupBy, scope);
  let entries = orderBuckets(groupBy, [...buckets.values()].filter((bucket) => bucket.transactions >= minTransactions), sortBy);
  const total = entries.length;
  entries = entries.slice(0, limit);

  const showDays = timeSeries || groupBy === 'weekday' || groupBy === 'none';
  const rows = entries.map((bucket) => {
    const row = { [groupBy === 'none' ? 'row' : groupBy]: bucket.name };
    if (groupBy === 'week') {
      const weekEnd = shiftIso(bucket.key, 6);
      row.from = bucket.key < scope.startDate ? scope.startDate : bucket.key;
      row.to = weekEnd > scope.endDate ? scope.endDate : weekEnd;
    }
    if (showDays) {
      row.days = bucket.daysInRange;
      row.daysWithSales = bucket.daysWithSales;
    }
    for (const [key, meta] of Object.entries(MEASURES)) row[meta.label] = formatMeasure(bucket[key], meta.format);
    if (groupBy === 'customer' || groupBy === 'employee') row.stores = [...bucket.stores].join(', ');
    if (groupBy === 'store' || groupBy === 'employee' || groupBy === 'none') row.uniqueCustomers = bucket.customers.size;
    if (groupBy === 'customer') {
      row.firstVisit = bucket.firstDate;
      row.lastVisit = bucket.lastDate;
    }
    return row;
  });
  const grand = accumulate(source, 'none', scope).get('Total');
  return {
    modelResult: {
      scope: scope.label,
      transactionsInScope: scope.transactions,
      filters: scope.filters,
      transactionsBeforeFilters: scope.beforeFilters,
      groupBy,
      sortedBy: timeSeries ? 'calendar order' : MEASURES[sortBy].label,
      minTransactions: minTransactions > 1 ? minTransactions : undefined,
      rowsReturned: rows.length,
      rowsMatching: total,
      perDayNote: showDays
        ? 'Per-day figures divide by "days", the calendar days that row covers inside the asked range (a partial first or last week has fewer). Quote them as given; do not recompute.'
        : undefined,
      rows,
      totals: grand
        ? {
            days: grand.daysInRange,
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
  if (!source.length) return { error: `No transactions for ${scope.label}.` };
  const buckets = accumulate(source, groupBy, scope);
  let keys = [...buckets.keys()];
  if (TIME_GROUPS.has(groupBy) || groupBy === 'weekday') {
    sortTimeKeys(groupBy, keys);
    if (keys.length > MAX_LINE_POINTS) {
      return { error: `That range has ${keys.length} ${groupBy}s. Ask for ${MAX_LINE_POINTS} points or fewer, or group by week or month.` };
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
  const perDay = measures.some((key) => PER_DAY_MEASURES[key]);
  const showDays = perDay && (TIME_GROUPS.has(groupBy) || groupBy === 'weekday');
  return {
    chart,
    modelResult: {
      title,
      scope: scope.label,
      transactionsInScope: scope.transactions,
      groupBy,
      perDayNote: perDay
        ? 'Per-day values divide by the calendar days each point covers inside the asked range; a partial first or last week has fewer days. Quote them as drawn.'
        : undefined,
      points: categories.map((label, index) => ({
        label,
        ...(groupBy === 'week' ? { from: keys[index] < scope.startDate ? scope.startDate : keys[index] } : {}),
        ...(showDays ? { days: buckets.get(keys[index]).daysInRange } : {}),
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
  const buckets = accumulate(source, groupBy, scope);
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

// ---------------------------------------------------------------------------
// Spreadsheet export
// ---------------------------------------------------------------------------

const EXPORT_MAX_ROWS = 5000;
const EXPORT_MAX_SHEETS = 8;
const EXPORT_MAX_INLINE_ROWS = 500;

const TX_COLUMNS = {
  ticket: { label: 'Ticket', format: 'text', value: (row) => ticketRef(row) },
  date: { label: 'Date', format: 'text', value: (row) => formatDateParam(row.date) },
  time: { label: 'Time', format: 'text', value: (row) => String(row.timeLabel || '').trim() || timeOf(row.date) },
  type: { label: 'Type', format: 'text', value: (row) => (row.type === 'purchase' ? 'PO' : 'SO') },
  store: { label: 'Store', format: 'text', value: (row) => String(row.storeName || '').trim() },
  employee: { label: 'Employee', format: 'text', value: (row) => String(row.employeeName || '').trim() },
  customer: { label: 'Customer', format: 'text', value: (row) => String(row.customerName || '').trim() },
  email: { label: 'Email', format: 'text', value: (row) => String(row.customerEmail || '').trim() },
  city: { label: 'City', format: 'text', value: (row, place) => String(place?.city || row.customerCity || '').trim() },
  postal: { label: 'Postal', format: 'text', value: (row, place) => String(place?.postal || row.customerPostal || '').toUpperCase().trim() },
  items: { label: 'Items', format: 'text', value: (row) => (row.itemNames || []).join('; ').slice(0, 500) },
  amount: { label: 'Amount', format: 'money', value: (row) => Math.round((Number(row.amount) || 0) * 100) / 100 },
  currency: { label: 'Currency', format: 'text', value: (row) => String(row.currency || 'CAD') },
  payment: { label: 'Payment', format: 'text', value: (row) => String(row.paymentMethodLabel || row.paymentMethods || '').trim() },
  system: { label: 'POS', format: 'text', value: (row) => String(row.systemLabel || row.systemKey || '').trim() },
};
const TX_DEFAULT = ['ticket', 'date', 'type', 'store', 'employee', 'customer', 'postal', 'items', 'amount'];

const SUMMARY_COLUMNS = {
  name: { label: 'Name', format: 'text' },
  transactions: { label: 'Transactions', format: 'int' },
  volume: { label: 'Volume', format: 'money' },
  buys: { label: 'Buys', format: 'int' },
  sells: { label: 'Sells', format: 'int' },
  buyVolume: { label: 'Buy volume', format: 'money' },
  sellVolume: { label: 'Sell volume', format: 'money' },
  avgTicket: { label: 'Avg ticket', format: 'money' },
  transactionsPerDay: { label: 'Transactions per day', format: 'decimal' },
  volumePerDay: { label: 'Volume per day', format: 'money' },
  days: { label: 'Days', format: 'int' },
  daysWithSales: { label: 'Days with sales', format: 'int' },
  uniqueCustomers: { label: 'Unique customers', format: 'int' },
  stores: { label: 'Stores', format: 'text' },
  firstVisit: { label: 'First visit', format: 'text' },
  lastVisit: { label: 'Last visit', format: 'text' },
};
const SUMMARY_DEFAULT = ['name', 'transactions', 'volume', 'buys', 'sells', 'avgTicket'];

function timeOf(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return date.toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' });
}

function pickColumns(requested, catalog, fallback, labels) {
  const asked = (Array.isArray(requested) ? requested : [])
    .map((key) => String(key || '').trim())
    .filter((key) => catalog[key]);
  const keys = asked.length ? [...new Set(asked)] : fallback;
  return keys.map((key) => ({
    key,
    label: String(labels?.[key] || catalog[key].label).slice(0, 60),
    format: catalog[key].format,
  }));
}

async function exportTransactionsSheet(sheet, context) {
  const scoped = await resolveScope(sheet, context);
  if (scoped.error) return { error: scoped.error };
  const { source, scope } = scoped;
  const needPlaces = ['city', 'postal'].some((key) => (sheet.columns || TX_DEFAULT).includes(key));
  const places = scope.places || (needPlaces ? await customerPlacesFor(source, context) : null);
  const sortBy = String(sheet.sortBy || 'date');
  const sorted = source.slice().sort((a, b) =>
    sortBy === 'amount'
      ? (Number(b.amount) || 0) - (Number(a.amount) || 0)
      : String(b.date || '').localeCompare(String(a.date || '')),
  );
  const columns = pickColumns(sheet.columns, TX_COLUMNS, TX_DEFAULT, sheet.columnLabels);
  const rows = sorted.slice(0, EXPORT_MAX_ROWS).map((row) => {
    const place = places?.get(customerKey(row));
    return Object.fromEntries(columns.map((column) => [column.key, TX_COLUMNS[column.key].value(row, place)]));
  });
  return { columns, rows, total: source.length, scopeLabel: scope.label, startDate: scope.startDate, endDate: scope.endDate };
}

async function exportSummarySheet(sheet, context) {
  const groupBy = QUERY_GROUPS.includes(String(sheet.groupBy || '')) ? String(sheet.groupBy) : 'store';
  const scoped = await resolveScope(sheet, context);
  if (scoped.error) return { error: scoped.error };
  const { source, scope } = scoped;
  const buckets = accumulate(source, groupBy, scope);
  const sortBy = MEASURES[sheet.sortBy] ? sheet.sortBy : 'transactions';
  const entries = orderBuckets(groupBy, [...buckets.values()], sortBy);
  const columns = pickColumns(sheet.columns, SUMMARY_COLUMNS, SUMMARY_DEFAULT, sheet.columnLabels);
  const rows = entries.slice(0, EXPORT_MAX_ROWS).map((bucket) =>
    Object.fromEntries(
      columns.map((column) => {
        const key = column.key;
        if (key === 'name') return [key, bucket.name];
        if (key === 'uniqueCustomers') return [key, bucket.customers.size];
        if (key === 'days') return [key, bucket.daysInRange];
        if (key === 'daysWithSales') return [key, bucket.daysWithSales];
        if (key === 'stores') return [key, [...bucket.stores].join(', ')];
        if (key === 'firstVisit') return [key, bucket.firstDate];
        if (key === 'lastVisit') return [key, bucket.lastDate];
        const n = Number(bucket[key]) || 0;
        return [key, column.format === 'money' ? Math.round(n * 100) / 100 : n];
      }),
    ),
  );
  return {
    columns,
    rows,
    total: entries.length,
    scopeLabel: `${scope.label} · by ${groupNoun(groupBy)}`,
    startDate: scope.startDate,
    endDate: scope.endDate,
  };
}

async function exportInventorySheet(sheet, context) {
  const session = context.session;
  const asked = [...(Array.isArray(sheet.stores) ? sheet.stores : [])].map((item) => String(item || '').trim()).filter(Boolean);
  const stores = asked.map((name) => canonicalStoreName(name) || name);
  const search = String(sheet.search || '').trim();
  const matrix = peekInventoryMatrix(session) || (await fetchInventoryMatrix(session));
  const columnsForStores = stores.length
    ? (matrix.stores || []).filter((store) => stores.some((name) => storesMatch(store.name, name) || cityMatches(store.name, name)))
    : matrix.stores || [];
  const lowered = search.toLowerCase();
  const wantBar = /\b(bar|bars|wafer|ingot)\b/.test(lowered);
  const wantCoin = /\b(coin|coins)\b/.test(lowered);
  const terms = inventoryTerms(search);
  const rowsAll = (matrix.rows || []).filter((row) => !search || inventoryMatches(row, terms, wantBar, wantCoin));
  const catalog = {
    name: { label: 'Product', format: 'text' },
    sku: { label: 'SKU', format: 'text' },
    metal: { label: 'Metal', format: 'text' },
    total: { label: 'Total on hand', format: 'decimal' },
  };
  for (const store of columnsForStores) catalog[`store:${store.name}`] = { label: store.name, format: 'decimal' };
  const requested = (Array.isArray(sheet.columns) ? sheet.columns : []).map((key) => {
    const text = String(key || '').trim();
    if (catalog[text]) return text;
    const store = columnsForStores.find((item) => storesMatch(item.name, text));
    return store ? `store:${store.name}` : text;
  });
  const fallback = ['name', 'sku', 'metal', 'total', ...columnsForStores.map((store) => `store:${store.name}`)];
  const columns = pickColumns(requested, catalog, fallback, sheet.columnLabels);
  const rows = rowsAll.slice(0, EXPORT_MAX_ROWS).map((row) => {
    const out = {};
    let total = 0;
    for (const store of columnsForStores) total += Number(row.quantities?.[store.id]) || 0;
    for (const column of columns) {
      if (column.key === 'name') out.name = row.name;
      else if (column.key === 'sku') out.sku = row.sku || '';
      else if (column.key === 'metal') out.metal = metalWords(row.metal);
      else if (column.key === 'total') out.total = Math.round(total * 1000) / 1000;
      else if (column.key.startsWith('store:')) {
        const store = columnsForStores.find((item) => `store:${item.name}` === column.key);
        out[column.key] = Math.round((Number(row.quantities?.[store?.id]) || 0) * 1000) / 1000;
      }
    }
    return out;
  });
  return {
    columns,
    rows,
    total: rowsAll.length,
    scopeLabel: `Live stock · ${stores.length ? stores.join(', ') : 'All stores'}${search ? ` · "${search}"` : ''}`,
  };
}

async function exportInventoryHistorySheet(sheet, context) {
  const result = await inventoryHistory({ ...sheet, chart: 'none' }, context);
  if (result.error) return { error: result.error };
  const data = result.modelResult;
  const columns = pickColumns(
    sheet.columns,
    { date: { label: 'Date', format: 'text' }, product: { label: 'Product', format: 'text' }, store: { label: 'Store', format: 'text' }, qty: { label: 'On hand', format: 'decimal' } },
    ['date', 'product', 'store', 'qty'],
    sheet.columnLabels,
  );
  // One product → the series are per store; several products → per product,
  // summed over the chosen stores. Long format either way: one row per day.
  const rows = [];
  const storeList = data.stores.join(', ');
  for (const point of data.points) {
    if (data.products.length === 1) {
      const product = data.products[0];
      for (const store of product.byStore) {
        const qty = point[store.store];
        if (qty == null) continue;
        rows.push({ date: point.date, product: product.name, store: store.store, qty });
      }
    } else {
      for (const product of data.products) {
        const qty = point[product.name];
        if (qty == null) continue;
        rows.push({ date: point.date, product: product.name, store: storeList, qty });
      }
    }
  }
  return {
    columns,
    rows: rows.slice(0, EXPORT_MAX_ROWS),
    total: rows.length,
    scopeLabel: `${data.stores.join(', ')} · ${data.dates.from} – ${data.dates.to} · ${data.dates.step}`,
  };
}

function exportInlineSheet(sheet) {
  const rows = (Array.isArray(sheet.rows) ? sheet.rows : [])
    .filter((row) => row && typeof row === 'object')
    .slice(0, EXPORT_MAX_INLINE_ROWS);
  if (!rows.length) return { error: `Sheet "${sheet.name}" has no rows and no source.` };
  const keys = (Array.isArray(sheet.columns) && sheet.columns.length ? sheet.columns : Object.keys(rows[0]))
    .map((key) => String(key || '').trim())
    .filter(Boolean);
  const columns = keys.map((key) => ({
    key,
    label: String(sheet.columnLabels?.[key] || key).slice(0, 60),
    format: guessFormat(rows, key) === 'text' ? 'text' : guessFormat(rows, key),
  }));
  const clean = rows.map((row) => Object.fromEntries(columns.map((column) => [column.key, tableCell(row[column.key], column.format)])));
  return { columns, rows: clean, total: clean.length, scopeLabel: '' };
}

/** One sheet's rows, from a live source or the model's own rows. */
export async function buildExportSheet(sheet, context) {
  const source = String(sheet?.source || '');
  if (source === 'transactions') return exportTransactionsSheet(sheet, context);
  if (source === 'transaction_summary') return exportSummarySheet(sheet, context);
  if (source === 'inventory') return exportInventorySheet(sheet, context);
  if (source === 'inventory_history') return exportInventoryHistorySheet(sheet, context);
  return exportInlineSheet(sheet);
}

async function exportSpreadsheet(args, context) {
  const specs = (Array.isArray(args?.sheets) ? args.sheets : []).slice(0, EXPORT_MAX_SHEETS);
  if (!specs.length) return { error: 'Describe at least one sheet.' };
  const built = [];
  const problems = [];
  for (const spec of specs) {
    if (context.signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    const name = String(spec?.name || `Sheet ${built.length + 1}`).trim().slice(0, 31);
    context.onStatus?.(`Building "${name}"…`);
    try {
      const result = await buildExportSheet(spec, context);
      if (result.error) {
        problems.push(`${name}: ${result.error}`);
        continue;
      }
      built.push({
        name,
        columns: result.columns,
        rows: result.rows,
        total: result.total,
        scopeLabel: result.scopeLabel,
        // Kept so the file can be rebuilt after a reload without storing every
        // row. The resolved dates ride along since there is no default period.
        spec: spec.source
          ? { ...spec, startDate: result.startDate || spec.startDate, endDate: result.endDate || spec.endDate, rows: undefined }
          : null,
      });
    } catch (error) {
      if (context.signal?.aborted || error?.name === 'AbortError') throw error;
      problems.push(`${name}: ${error?.message || 'failed'}`);
    }
  }
  if (!built.length) return { error: problems.join(' ') || 'Nothing to export.' };

  const fileName = cleanTitle(args?.fileName, built.length === 1 ? built[0].name : 'Canada Gold export');
  const chart = {
    type: 'file',
    kind: 'xlsx',
    title: fileName,
    fileName,
    subtitle: built.map((sheet) => `${sheet.name} (${sheet.rows.length.toLocaleString('en-CA')})`).join(' · ').slice(0, 160),
    note: problems.length ? problems.join(' ') : undefined,
    sheets: built,
  };
  return {
    chart,
    modelResult: {
      fileName: `${fileName}.xlsx`,
      sheets: built.map((sheet) => ({
        name: sheet.name,
        columns: sheet.columns.map((column) => column.label),
        rows: sheet.rows.length,
        totalMatching: sheet.total,
        truncated: sheet.total > sheet.rows.length ? `first ${sheet.rows.length} of ${sheet.total}` : undefined,
        covers: sheet.scopeLabel || undefined,
      })),
      skipped: problems.length ? problems : undefined,
      note: 'The file card is on screen with a Download button. One or two sentences: name the file, the tabs, and the row counts.',
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
  const dates = resolveDates(args, { maxDays: MAX_LOOKUP_RANGE_DAYS });
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

// Datasets that answer for a period. The rest are live (tills, stock, prices,
// reviews, who is clocked in) and read as of today when no dates are passed.
const DATED_LOOKUPS = new Set(['home', 'transactions', 'fintrac', 'financials', 'debit', 'audit', '100-ways', 'bonuses', 'phone', 'triage']);

async function companyLookup(args, context) {
  const sources = [...new Set((Array.isArray(args?.sources) ? args.sources : []).map((key) => String(key || '')))];
  const dates = resolveDates(args, {
    todayIfMissing: !sources.some((key) => DATED_LOOKUPS.has(key)),
    allowFuture: sources.includes('calendar') && !sources.some((key) => DATED_LOOKUPS.has(key)),
    maxDays: MAX_LOOKUP_RANGE_DAYS,
  });
  if (dates.error) return dates;
  const asked = [...(Array.isArray(args?.stores) ? args.stores : []), ...(args?.store ? [args.store] : [])]
    .map((item) => String(item || '').trim())
    .filter(Boolean);
  const lock = String(context.storeFilter || '').trim();
  const stores = asked.length ? asked.map((name) => canonicalStoreName(name) || name) : lock ? [lock] : [];
  const location = stores.length === 1 ? stores[0] : '';
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
  const privacy = privateScopeNote(context.question, context.session);
  if (privacy) lookup.privacy = privacy;
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
  'export_spreadsheet',
  'show_area_map',
  'show_customer_map',
  'search_documents',
  'read_document',
  'plan_transfer',
]);

function transferStoreFor(wanted, stores) {
  const needle = fold(wanted).replace(/\bquebec city\b/, 'quebec').replace(/\bstore\b/g, '').trim();
  if (!needle) return null;
  const exact = stores.find((store) => fold(store.name) === needle);
  if (exact) return exact;
  const loose = stores.filter((store) => fold(store.name).includes(needle) || needle.includes(fold(store.name)));
  return loose.length === 1 ? loose[0] : null;
}

function productMatches(row, search) {
  const words = fold(search).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const text = fold(`${row.name} ${row.sku} ${row.metal}`);
  return words.every((word) => text.includes(word));
}

/** The Transfer app's planner, run for the route the user named. */
async function transferPlan(args, context) {
  const wanted = (Array.isArray(args?.route) ? args.route : []).map((item) => String(item || '').trim()).filter(Boolean);
  if (wanted.length < 2) return { error: 'Name at least two stores in travel order, such as ["Montreal", "Laval"].' };
  context.onStatus?.('Loading transfer stores…');
  const { stores } = await fetchTransferStores(context.session);
  const eastStores = stores.filter((store) => store.systemKey === 'east');
  const route = [];
  const missing = [];
  for (const name of wanted) {
    const store = transferStoreFor(name, eastStores);
    if (!store) missing.push(name);
    else if (!route.some((item) => item.id === store.id)) route.push(store);
  }
  if (missing.length) {
    return {
      error: `The Transfer app covers Canada Gold East stores only. Could not place ${missing.join(', ')}. Stores available: ${eastStores.map((store) => store.name).join(', ')}.`,
    };
  }
  if (route.length < 2) return { error: 'The route needs two different stores.' };
  const east = posSystemsFromSession(context.session).find((system) => system.key === 'east' && system.token);
  if (!east) return { error: 'Sign in to Canada Gold East to plan a transfer.' };

  context.onStatus?.('Reading stock at each stop…');
  const inventory = await fetchTransferInventory({ token: east.token, baseUrl: east.baseUrl }, route);
  const search = String(args?.search || '').trim();
  const rows = search ? inventory.rows.filter((row) => productMatches(row, search)) : inventory.rows;
  const mode = detectTransferMode(route);
  const plan = computeTransferPlan({ stores: route, rows, splits: defaultSplitsForMode(mode) });
  const routeLabel = route.map((store) => store.name).join(' → ');
  const title = `Transfer plan · ${routeLabel}`;

  const tableRows = [];
  for (const product of plan.products) {
    for (const move of product.moves) {
      tableRows.push({
        product: product.name,
        priority: product.priority,
        from: move.fromName,
        to: move.toName,
        qty: move.qty,
        fromOnHand: product.currentById[move.fromId] ?? 0,
        toOnHand: product.currentById[move.toId] ?? 0,
        toTarget: product.targetById[move.toId] ?? 0,
      });
    }
  }
  const shown = tableRows.slice(0, MAX_TABLE_ROWS);
  const splitRule =
    mode === 'workshop'
      ? 'Green: 50% Montreal, 25% Laval, 25% Quebec City. Yellow: 25% Montreal, 12.5% Laval, 12.5% Quebec City, 50% Workshop. Red: all to Workshop.'
      : 'Green and yellow: 50% Montreal, 25% Laval, 25% Quebec City. Red stock stays where it is.';
  const notes = [
    inventory.warning,
    search ? `Products matching “${search}”.` : '',
    plan.unknownStores.length ? `${plan.unknownStores.join(', ')} has no territory in the split and was skipped.` : '',
    plan.unmetUnits ? `${plan.unmetUnits} unit(s) of need could not be filled from an earlier stop on this route.` : '',
    plan.strandedUnits ? `${plan.strandedUnits} surplus unit(s) sit at a stop with nowhere forward to go.` : '',
    tableRows.length > shown.length ? `Showing ${shown.length} of ${tableRows.length} moves.` : '',
  ].filter(Boolean);
  const chart = tableRows.length
    ? {
        type: 'table',
        title,
        subtitle: `Live stock · Transfer app split · ${plan.products.length} products`,
        columns: [
          { key: 'product', label: 'Product', format: 'text' },
          { key: 'priority', label: 'Tier', format: 'text' },
          { key: 'from', label: 'From', format: 'text' },
          { key: 'to', label: 'To', format: 'text' },
          { key: 'qty', label: 'Send', format: 'decimal' },
          { key: 'fromOnHand', label: 'From on hand', format: 'decimal' },
          { key: 'toOnHand', label: 'To on hand', format: 'decimal' },
          { key: 'toTarget', label: 'To target', format: 'decimal' },
        ],
        rows: shown,
        footer: { product: `Total (${plan.totalMoves} moves)`, qty: plan.totalUnits },
        note: notes.join(' ') || undefined,
      }
    : null;
  const modelResult = clampJson(
    {
      title,
      route: routeLabel,
      mode,
      splitRule,
      productsConsidered: rows.length,
      productsMoving: plan.products.length,
      totalMoves: plan.totalMoves,
      totalUnits: plan.totalUnits,
      unmetUnits: plan.unmetUnits || undefined,
      strandedUnits: plan.strandedUnits || undefined,
      moves: tableRows.slice(0, 80),
      notes: notes.length ? notes : undefined,
      note: chart
        ? 'The table is on screen. Summarize it in a few sentences: how many products move, the biggest sends, anything that could not be filled. Do not repeat every row.'
        : 'Nothing needs to move on this route: every stop already holds its share, or no prioritized bullion was found. Say so plainly.',
    },
    MAX_LOOKUP_CHARS,
  );
  return chart ? { chart, modelResult } : { modelResult };
}

// The apps in the Apps tab, what each holds, and which tool reaches it. The
// model reads this; `appsForQuestion` also matches a question against it so the
// turn starts pointed at the right app.
const APP_GUIDE = [
  { app: 'Transactions', holds: 'every sale and purchase ticket (PO#, SO#), by store, employee, customer, date', tool: 'query_transactions, list_transactions, show_line_chart, show_bar_chart, show_pie_chart', match: /\b(transactions?|tickets?|sales?|sold|purchases?|bought|buys?|sells?|volume|avg(erage)? ticket|revenue|PO ?#?\d*|SO ?#?\d*)\b/i },
  { app: 'Inventory', holds: 'live stock on hand by SKU and store, and stock history by day', tool: 'lookup_company_data (inventory) or inventory_history', match: /\b(inventory|stock|on hand|in stock|how many .* (do we|does .* have)|GBAR|SBAR|GML|SML|RCM|maple|bars?|coins?|ounces?|oz)\b/i },
  { app: 'Transfer', holds: 'the transfer planner: what bullion to move between East stores along a route, using the territory split; store addresses', tool: 'plan_transfer (lookup_company_data transfer for addresses)', match: /\b(transfers?|transferr?ing|send(ing)? (stock|bullion|product|inventory|gold|silver)|move (stock|bullion|product|inventory)|ship(ping)? to|balance (the )?(stock|inventory)|rebalance|restock)\b/i },
  { app: 'Audit', holds: 'bullion count variances per store', tool: 'lookup_company_data (audit)', match: /\b(audit|variances?|count(ed|s)? (short|over)|discrepanc)/i },
  { app: 'FINTRAC', holds: 'cash deals at or above $10,000', tool: 'lookup_company_data (fintrac)', match: /\b(fintrac|lctr|large cash|10,?000|10k)\b/i },
  { app: 'Financials', holds: 'cash payment totals in and out', tool: 'lookup_company_data (financials); tills for the drawer balance', match: /\b(financials?|cash (in|out|payments?|flow)|paid in cash)\b/i },
  { app: 'Cash tills (Home)', holds: 'live Till 1 CAD and USD balances per store', tool: 'lookup_company_data (tills)', match: /\b(tills?|drawers?|float|cash (balance|position|on hand))\b/i },
  { app: 'Debit', holds: 'debit and Interac payments', tool: 'lookup_company_data (debit)', match: /\b(debit|interac|moneris|terminal)\b/i },
  { app: 'Pricing', holds: 'website buy and sell metal prices', tool: 'lookup_company_data (pricing)', match: /\b(pric(e|es|ing)|spot|premium|what (do|are) we (pay|charge))\b/i },
  { app: 'Bonuses', holds: 'review and email bonus payouts by store', tool: 'lookup_company_data (bonuses)', match: /\b(bonus(es)?|payouts?)\b/i },
  { app: 'Employees / Contacts', holds: 'staff directory: name, role, store, team, who is online', tool: 'lookup_company_data (employees, contacts)', match: /\b(employees?|staff|who works|directory|contacts?|manager of)\b/i },
  { app: 'Teams', holds: 'team names, members, intake counts', tool: 'lookup_company_data (teams)', match: /\bteams?\b/i },
  { app: 'Calendar', holds: 'Rippling, from the latest report files the hours feed imported: who is clocked in right now, the shift schedule by day (who is set to work today, tomorrow, or a date, with role and times), hours this week and last week, and hours per person for any asked dates (hoursInRange)', tool: 'lookup_company_data (calendar), with the asked dates as startDate and endDate', match: /\b(clocked|hours|shifts?|schedule[ds]?|roster(ed)?|rippling|calendar|set to work|who( is|'s) (in|working|on)|working (today|tomorrow|tonight|this weekend|next week))\b/i },
  { app: 'Reviews', holds: 'Google review counts and star averages by store', tool: 'lookup_company_data (reviews)', match: /\b(reviews?|stars?|rating|google)\b/i },
  { app: 'Emails', holds: 'the signed-in user\'s own Google inboxes (every inbox connected in the Emails app): recent messages with sender, subject, date, body, and recent sent mail', tool: 'lookup_company_data (emails)', match: /\b(e-?mails?|inbox(?:es)?|mailbox|unread|gmail)\b/i },
  { app: 'Direct Messages', holds: 'the signed-in user\'s own chats with teammates and teams: recent conversations and message text', tool: 'lookup_company_data (messages)', match: /\b(direct messages?|dms?|chats?|messaged me|texted me)\b/i },
  { app: 'Tasks (Emails + Direct Messages)', holds: 'what the signed-in user still needs to do: requests, follow-ups, and to-dos found in their own mail and chats', tool: 'lookup_company_data (emails, messages)', match: /\b(tasks?|to-?dos?|outstanding|pending requests?|follow[- ]?ups?|waiting on|action items?|on my plate|what do i (?:need|have) to do|asked me)\b/i },
  { app: 'Phone', holds: 'inbound answering rate, missed calls, callbacks, voicemail by store', tool: 'lookup_company_data (phone)', match: /\b(phones?|calls?|answer(ed|ing)? rate|missed|voicemail|ringcentral)\b/i },
  { app: 'Triage', holds: 'purchase evaluation accuracy by store and employee, error types', tool: 'lookup_company_data (triage)', match: /\b(triage|accuracy|evaluation errors?|mis-?graded|mistakes?)\b/i },
  { app: '100 Ways', holds: 'premium jewelry purchases by store', tool: 'lookup_company_data (100-ways)', match: /\b(100 ways|hundred ways|premium jewel+ery)\b/i },
  { app: 'Customers', holds: 'POS customer records: name, phone, email, home store, visits, tickets, and where they live', tool: 'search_customers, show_customer_map, show_area_map', match: /\b(customers?|clients?|who (bought|sold)|where .* live|repeat|heat ?map)\b/i },
  { app: 'Documents', holds: 'uploaded company files in folders: Excel, Word, PDF, images, video, text', tool: 'search_documents, read_document', match: /\b(documents?|files?|folders?|uploaded|policy|policies|memo|manual|handbook|spreadsheet we|sheet we|pdf)\b/i },
];

const APPS_NOT_SEARCHABLE = 'Preorders, Accounting, Leaderboards, Police Report, Security, Serphint, Supplies, Marketing, Shared Services, Notifications, Cdn Coin, PMX, Shipping, Storage, Logs, Settings';

function appGuideText() {
  return APP_GUIDE.map((entry) => `- ${entry.app}: ${entry.holds}. Tool: ${entry.tool}.`).join('\n');
}

/** Apps a question points to, by its wording. Names only; the model picks the tool. */
export function appsForQuestion(question) {
  const text = String(question || '');
  return APP_GUIDE.filter((entry) => entry.match.test(text)).map((entry) => ({ app: entry.app, tool: entry.tool }));
}

async function runTool(name, args, context) {
  if (!TOOL_NAMES.has(name)) return { error: 'That tool is not available.' };
  if (name === 'plan_transfer') {
    try {
      return await transferPlan(args, context);
    } catch (error) {
      if (context.signal?.aborted || error?.name === 'AbortError') throw error;
      return { error: error?.message || 'Could not build the transfer plan.' };
    }
  }
  if (name === 'search_documents' || name === 'read_document') {
    context.onStatus?.(name === 'search_documents' ? 'Searching documents…' : 'Opening a document…');
    try {
      if (context.signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      return name === 'search_documents'
        ? await searchDocumentsForAssistant(args?.query, args?.folder)
        : await readDocumentForAssistant(args);
    } catch (error) {
      if (context.signal?.aborted || error?.name === 'AbortError') throw error;
      return { error: error?.message || 'Could not read Documents.' };
    }
  }
  if (name === 'lookup_company_data') return companyLookup(args, context);
  if (name === 'search_customers') return customerSearch(args, context);
  if (name === 'export_spreadsheet') {
    try {
      return await exportSpreadsheet(args, context);
    } catch (error) {
      if (context.signal?.aborted || error?.name === 'AbortError') throw error;
      return { error: error?.message || 'Could not build the spreadsheet.' };
    }
  }
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
  return /\b(chart|graph|plot|pie|map|draw|drawn|visuali[sz]e|table|tabulate|spreadsheet|grid|outline|excel|xlsx|csv|export|download|list|listing|ranking|rank|breakdown|top \d+)\b/i.test(question);
}

// A bare greeting gets a greeting back. The model is not offered tools for
// it, so it cannot wander off and summarize a week nobody asked about.
const SMALL_TALK =
  /^(?:(?:hi|hii+|hello|hey|heya|yo|sup|hiya|howdy|bonjour|salut|allo|good\s*(?:morning|afternoon|evening|day)|morning|afternoon|evening|thanks|thank\s*you|thx|ty|merci|ok|okay|cool|great|nice|how\s*are\s*you(?:\s*doing)?(?:\s*today)?|how\s*is\s*it\s*going|how'?s\s*it\s*going|what'?s\s*up|you\s*there|are\s*you\s*there|anyone\s*there|there|analytics|test|testing)[\s,!.?]*)+$/i;

export function isSmallTalk(question) {
  const text = String(question || '').trim();
  if (!text || text.length > 60) return false;
  return SMALL_TALK.test(text);
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
export async function completeOpenRouter({ model, messages, tools, toolChoice, maxTokens = 2500, signal, plugins }) {
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
  if (Array.isArray(plugins) && plugins.length) body.plugins = plugins;
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

function firstNameOfSession(session) {
  const first = String(session?.profile?.firstName || '').trim();
  if (first) return first;
  const full = String(session?.profile?.fullName || '').trim();
  return full.split(/\s+/)[0] || '';
}

function systemPrompt({ storeFilter, hasAttachments, firstName }) {
  const today = formatDateParam(new Date());
  const name = String(firstName || '').trim();
  const nameLine = name
    ? `You know their first name is ${name}. Almost never say it. The screen already greeted them. Skip it on data answers, follow-ups, and any question you ask. If you do use it, once in a whole conversation is plenty. Never use a last name or a title.`
    : '';
  const attachmentLine = hasAttachments
    ? `\nThe user attached files. Photos and video frames are in the message as images; spreadsheets, Word documents, and text files are included as text under "Attached"; PDFs are included as documents. Read them directly and answer from them. When the user asks to compare, match, or reconcile a file against our data, look the data up with the tools and then compare. Quote figures from the file as they appear. If a sheet or document was trimmed, say so and ask which part matters.\n`
    : '';
  const storeLine = `${storeFilter ? `The screen is set to the ${storeFilter} store; that applies only when the user names no store. ` : ''}Canada Gold stores: ${HOME_PINNED_STORES.join(', ')}.`;
  return `You are a Canada Gold colleague in Analytics. Always be kind. Sound like a helpful person sitting beside them, never like a manager giving orders. Do not tell them what they should do, must do, or need to do. When you need something (dates, a store, a product), ask gently as an offer, not a command. Today is ${today}. Nothing is loaded or selected ahead of time: there is no default period, no default store, and no report waiting to be summarized. Every day in the POS is on equal footing until the user names one.
${storeLine}
${nameLine}
${attachmentLine}
Start from a blank slate. When the message is a greeting, thanks, or small talk with no question in it (hi, hello, hey, good morning, thanks, how are you), reply in one or two warm sentences without using their name, and let them know you are happy to look anything up about Canada Gold when they are ready — a store, an employee, a customer, a product, stock, tills, hours, reviews, or a document. Do not call a tool, do not quote any number, and do not pick a period or a report on their behalf. Only answer a question once the user has asked one, and answer only that question.

Numbers come only from a tool result, from a file the user attached, or from a file in Documents. Never invent a count, a dollar amount, a name, or a place.

Know when a question is general. "Where is NDG", "what does FSA mean", "which postal codes are Westmount", "what is a Maple Leaf DNA coin", "how far is Laval from Montreal" are general knowledge, not questions about our data: answer them plainly from what you know, without calling a data tool or mentioning customers, transactions, or stock. If a general question asks to see a place, call show_area_map with the place name and nothing else; only add customers when the user says customers. Only reach for company data when the question is about our stores, staff, customers, tickets, or stock.

Decide the best form of answer. If they ask for a chart, graph, pie, line, bar, or map, draw exactly that kind, with the grouping they asked for (a line chart per employee is a line chart grouped by employee). If they ask a question that needs numbers but no picture (top customers, repeat customers, totals, who sold the most, compare three stores), call query_transactions and answer in words, unless the company instructions at the end of this prompt say to add a chart. Do not describe a picture you did not ask a tool to draw. Tools pull real POS transactions for any dates and several stores at once.

Anything that is not a sale or purchase comes from lookup_company_data. Datasets:
${COMPANY_DATA_SOURCES.map((source) => `- ${source.key}: ${source.hint}`).join('\n')}
Stock on hand "right now" is the inventory dataset with inventorySearch set to the product words (for "1 ounce gold bars" use "1 oz gold bar"); that lookup is today's snapshot. Stock over time is inventory_history: it reads the POS quantity as of each day in the range and draws the line chart. Inventory does have history; never say it is only a snapshot. House labels: GBAR is a gold bar (carded, uncarded, SEALED, UNSEALED). SBAR is a silver bar. GML is a Gold Maple Leaf (also Maplegram, MLBD). SML is a Silver Maple Leaf. RCM is Royal Canadian Mint (GBAR 1oz RCM, SBAR 10oz RCM). Treat those codes and the long names as the same product. A named person who is a customer is search_customers. Never say you lack inventory, till, hours, review, phone, email, message, pricing, triage, audit, payment, customer, or document data; look it up, and combine several tools in one turn when a question spans them.

Hours and schedule: anything about hours worked, overtime, who worked, shifts, or who is clocked in is lookup_company_data with calendar and the asked dates as startDate and endDate. The figures come from the newest Rippling report files the hours feed imported (the result lists them under sourceFiles with the time each arrived); for hours over named dates use hoursInRange, and if the asked dates fall outside the hours file's coverage say which days have no hours on file instead of reporting zero. When the user asks how current the data is, name the file and when it arrived. "Hours per employee as a chart" is calendar first, then draw_chart with format "hours" from hoursInRange.

Tasks: "what do I need to do", "any outstanding requests", "what am I waiting on", "follow-ups", or "my to-dos" is lookup_company_data with emails and messages together. Read every message body and chat line, then put the open items in show_table (columns: From, Request, Where (inbox address or chat name), When, Status) with one row per thing that still needs a reply or an action, introduced by a sentence or two; skip newsletters, receipts, and automated notices; and close with one sentence on what already has a reply in sent. If they ask for it in words rather than a table, a short numbered list in plain text is fine. If no inbox is connected, say so and offer to look again once one is connected in the Emails app.

${AI_PRIVACY_RULES}

Uploaded company files live in Documents: Excel, Word, PDF, images, video, text, and other formats, inside folders. When the question is about a policy, memo, price sheet, report, or anything that would be in an uploaded file, call search_documents, then read_document for each file that matters. Quote the file, name it, and say when the text was trimmed. Photos, video frames, and PDFs show up with the read result; look at them. Reading an uploaded file is search_documents, not export_spreadsheet. export_spreadsheet builds a new Excel file from live data. Live store numbers still come from the POS tools.

The apps in the Apps tab, what each holds, and the tool that reads it. Work out which app a question belongs to, then call that app's tool; the user message may also name the likely apps.
${appGuideText()}
Not searchable from here: ${APPS_NOT_SEARCHABLE}.

Transfers: any question about what to transfer, send, move, or how to balance stock between stores is the Transfer app. Call plan_transfer with the route in travel order (the sending store first) and answer from its moves; that is the same plan the Transfer app prints, with the territory split already applied. Do not improvise a transfer list from raw inventory counts. If the user names only a product, pass it as search. Only when the user asks where a store is or its address is lookup_company_data with the transfer dataset the right call.

Lists: when the user asks for a list, a ranking, a breakdown, or says "make a list", the answer is a table on screen, not lines of prose. Use the tool that draws it (list_transactions for tickets, plan_transfer for a transfer, show_table for anything else, with the rows from the tool result), then introduce it in a sentence or two.

Dates: there is no default period, so every transaction tool call carries startDate and endDate. Use the period the user named: "today" is ${today}; "yesterday" is the day before; "past month" or "last 30 days" is the 30 days ending today; "this month" is the 1st of this month to today; "last week" is the previous Monday to Sunday; "past week" is the 7 days ending today; a month name is that whole month. On a follow-up, reuse the dates from the earlier answer in this conversation. If the question needs a period and the user has not named one here or earlier, ask which dates would help, in one kind sentence; do not pick a week on their behalf. Live datasets (stock on hand, tills, prices, reviews, who is clocked in) need no dates. Transaction tools (query_transactions, list_transactions, the show_*_chart tools, export_spreadsheet, show_customer_map) take up to a year in one call: "since January" is startDate ${today.slice(0, 4)}-01-01 and endDate ${today} in a single call, "this year" the same, "the past six months" one call. Never split a period into several calls or one call per month; one call with groupBy month or week already returns every month or week. Inventory history and lookup_company_data stay within ${MAX_LOOKUP_RANGE_DAYS} days. The one exception to "no future dates" is the calendar dataset: "who is working tomorrow", "who is on Saturday", or "next week's schedule" is lookup_company_data with calendar and that future day (or days) as startDate and endDate. Today and tomorrow are always included, so "who is working right now" or "who is in today" needs no dates; answer "currently working" from clockedIn and "scheduled" from schedule.

Stores: if the user names stores (Montreal, Laval, Quebec, Toronto, …), pass stores with those names. "Quebec City" is the Quebec store. Omit stores for all stores. Never tell the user to change a filter, a date picker, or a setting; the tools take the stores and dates directly. Never say you lack a tool for numbers; query_transactions returns any ranking or total.

Time buckets and averages: "per month", "monthly", or "each month" is groupBy month; "per week", "weekly", or "each week" is groupBy week (Monday to Sunday); "per day" or "daily" over a short range is groupBy date; "by day of the week" is weekday. "Average per day", "a day", or "daily average" is the transactionsPerDay or volumePerDay measure, which the tools compute from the calendar days each bucket covers inside the range; a partial week or month at either end is divided by its own days, and the result says how many. So "average transaction count per day for each week since January, on a line graph" is one show_line_chart call with measures ["transactionsPerDay"], groupBy "week", startDate January 1, endDate today, and the store; "average transactions per month" is one query_transactions call with groupBy month, and the monthly average across months is the total divided by the number of months (say if the last month is partial). Never pull daily rows and average them yourself, never add up months by hand when one call with groupBy none gives the total, and never compute a number the tool already returns. Quote the tool's figures as given.

Multi-step questions: work out every lookup the question needs and make those calls together in one round; the app runs them side by side. After the results arrive, either draw (draw_chart or show_table from the figures) or answer; do not re-fetch what you already have in this conversation's tool results. Never write a sentence about what you are about to look up or "let me grab"; call the tool instead, and write only once the figures are in front of you.

Chart choice: transactions per employee or per store is a bar chart. Trends over days, weeks, or months are a line chart. Share of a total is a pie chart. Where customers live is a map: "the Montreal store's customers" is store Montreal with no city, and the dots can be in Laval, Longueuil, or anywhere else those customers live. Set city only when the user asks about customers who live in a city.

Any other relationship can be drawn too. When the user wants a picture of something that is not transactions (stock by SKU or by store, till balances, hours, reviews, payment mix, FINTRAC counts), first call lookup_company_data or search_customers, then call draw_chart with the labels and values from that result. If the numbers are already in this conversation from an earlier tool result, call draw_chart with them directly. Never answer a transaction chart tool for an inventory question, and never say a chart cannot be drawn; draw_chart takes any labels and numbers. Give the chart a title and subtitle that say what the numbers are and where they came from.

Spreadsheets: at any point the user can ask for an Excel file of anything discussed; call export_spreadsheet. Each tab is a sheet. When the data is a live dataset (tickets, a summary, stock, stock history), set source and the same scope and filters as the question so the file holds every matching row, not just what was shown. When the user names tabs or columns, use exactly those names and only those columns, in that order (columnLabels renames a header). "CSV" also means export_spreadsheet. After the call, say the file is ready and what is in it; do not paste the data.

Tables: when the user asks for a table, or the answer has several columns per row, call show_table with the rows from the tool result (numbers as numbers, a total row when it helps). The app renders it sortable. Never type a table as markdown pipes in your answer; the text should be one or two sentences that introduce the table.

Slicing the ledger: every transaction tool takes filters. Postal and city filters read the customer's home address from their customer record, the same source the customer map and its postal-area counts use, so a list filtered by an area matches the dots and the pie for that area. A neighbourhood, borough, or postal area is postalPrefixes with its forward sortation areas (Griffintown H3C; Westmount H3Y, H3Z; NDG H4A, H4B; Plateau H2H, H2J, H2T, H2W; Old Montreal H2Y; Laval H7; Longueuil J4; Brossard J4W–J4Z; Toronto downtown M5; Mississauga L4, L5). A city is cities. A customer, an employee, a product, a payment method, or an amount range each has its own filter, and they combine. When the user wants the tickets themselves (PO#, SO#, "which transactions", "list them"), call list_transactions; when they want a total or ranking over a slice, call query_transactions with the same filters; when they want a picture of a slice, call the chart tool with the filters. Never say transactions cannot be filtered by neighbourhood or postal code, and never offer to do it by hand. Write ticket numbers exactly as the tool gives them (PO# 12345, SO# 67890); the app turns them into links.

After a tool result, write the answer in plain, kind sentences. No markdown, no bullet list, no sign-off. Do not sound commanding or lecture them. Say which dates and stores it covers, then quote the formatted values from the tool result. For a ranking, name each entry with its figure, in order. For a chart or table, keep it to a few sentences; the picture shows the detail. Once you have the numbers, stop calling tools and write the answer.

Transaction count is "transactions". Transaction cost or dollar volume is "volume". Average ticket is "avgTicket". Average transactions a day is "transactionsPerDay"; average dollars a day is "volumePerDay". Buys and sells are separate.

Customer maps place each customer at the home address on their POS record, or the postal code when there is no street. Report customersOnMap out of customers, and say how many had no address on file. Do not claim more dots than customersOnMap.`;
}

function localSummary(charts, failure) {
  const first = charts[0];
  const tail = failure ? ` (${failure})` : '';
  if (!first) return `Here’s what the transactions show.${tail}`;
  const where = first.subtitle ? ` It covers ${first.subtitle}.` : '';
  if (first.type === 'map' && first.style === 'area') return `${first.title} is outlined on the map.${tail}`.trim();
  if (first.type === 'file') return `${first.fileName}.xlsx is ready to download: ${first.subtitle}.${tail}`;
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
// Earlier attachments are not re-sent as images; their extracted text travels
// with the turn so follow-up questions can still refer to them.
function priorTurnContent(turn) {
  const base = String(turn.content || '');
  const extracts = attachmentsText(turn.attachments || []);
  const names = (turn.attachments || []).map((item) => item?.name).filter(Boolean);
  if (!names.length) return base;
  const header = `[Attached: ${names.join(', ')}]`;
  return extracts ? `${base}\n\n${header}\n${extracts}` : `${base}\n\n${header}`;
}

function pdfPlugins(model, attachments) {
  if (!hasPdf(attachments)) return undefined;
  // Claude and GPT read PDFs natively (billed as tokens); for everyone else
  // use OpenRouter's free text parser rather than the paid OCR default.
  const native = /^(anthropic|openai)\//.test(String(model || ''));
  return [{ id: 'file-parser', pdf: { engine: native ? 'native' : 'cloudflare-ai' } }];
}

function toolResultPayload(result) {
  return result?.modelResult || { error: result?.error || 'Could not complete that.' };
}

function fallbackAnswer(toolResults, charts, failure) {
  if (charts.length) return localSummary(charts, failure);
  const tail = failure ? ` (${failure})` : '';
  for (let index = toolResults.length - 1; index >= 0; index -= 1) {
    const data = toolResults[index];
    if (!data || data.error) continue;
    if (Array.isArray(data.rows) && data.rows.length) {
      const sample = data.rows
        .slice(0, 8)
        .map((row) => Object.values(row).filter((value) => value != null && value !== '').slice(0, 4).join(' · '))
        .join('; ');
      return `Here are the figures for ${data.scope || 'that period'}: ${sample}.${tail}`;
    }
    if (data.transactionsInScope != null) {
      return `${data.scope || 'That period'} has ${data.transactionsInScope} transactions.${tail}`;
    }
    if (data.title) return `${data.title}.${tail}`;
  }
  return '';
}

function slimMessages(messages) {
  return (messages || []).map((message) => {
    if (message?.role !== 'tool') return message;
    try {
      const parsed = JSON.parse(String(message.content || ''));
      return { ...message, content: JSON.stringify(clampJson(parsed, MAX_TOOL_RESULT_CHARS)) };
    } catch {
      const text = String(message.content || '');
      if (text.length <= MAX_TOOL_RESULT_CHARS) return message;
      return { ...message, content: JSON.stringify(clampJson({ preview: text }, MAX_TOOL_RESULT_CHARS)) };
    }
  });
}

// `rows` with `startDate`/`endDate` are only a cache: a tool call that asks
// for exactly that range skips the POS fetch. They never choose the period.
export async function askAnalytics({
  model,
  history = [],
  question,
  attachments = [],
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
    .map((turn) => ({ role: turn.role, content: turn.role === 'user' ? priorTurnContent(turn) : String(turn.content) }));
  const extracts = attachmentsText(attachments);
  const attachedNames = (attachments || []).map((item) => `${item.name} (${attachmentLabel(item).toLowerCase()}${item.summary ? `, ${item.summary}` : ''})`);
  const likelyApps = appsForQuestion(question);
  const privacy = privateScopeNote(question, session);
  const questionText = [
    question,
    likelyApps.length
      ? `Likely apps for this question: ${likelyApps.map((item) => `${item.app} (${item.tool})`).join('; ')}.`
      : '',
    privacy,
    attachedNames.length ? `Attached: ${attachedNames.join('; ')}.` : '',
    extracts,
  ]
    .filter(Boolean)
    .join('\n\n');
  const parts = attachmentParts(attachments);
  const userMessage = parts.length
    ? { role: 'user', content: [{ type: 'text', text: questionText }, ...parts] }
    : { role: 'user', content: questionText };
  const companyInstructions = await loadAiInstruction('analytics');
  const messages = [
    {
      role: 'system',
      content: appendCompanyInstructions(
        systemPrompt({ storeFilter, hasAttachments: attachments.length > 0, firstName: firstNameOfSession(session) }),
        companyInstructions,
        { figuresFrom: 'a tool result, a file the user attached, or a file in Documents' },
      ),
    },
    ...prior,
    userMessage,
  ];
  let opened = [];
  const pluginsFor = () => pdfPlugins(model, [...attachments, ...opened]);
  const context = { rows, startDate, endDate, storeFilter, session, mapsKey, signal, onStatus, question };

  onStatus?.('Reading the question…');
  const charts = [];
  let usage = null;
  const smallTalk = !attachments.length && isSmallTalk(question);
  // A transfer question always runs the Transfer app's planner first.
  let toolChoice =
    wantsPicture(question) || likelyApps.some((item) => item.app === 'Transfer') ? 'required' : 'auto';
  const toolResults = [];
  let toolCalls = 0;
  // Several rounds: the model can look something up, then refine (fix a store
  // name, narrow a search, draw from what came back) before it writes the
  // answer. Calls within a round run together, so a question that spans
  // stores or datasets costs one wait, not one per call.
  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const reply = await completeOpenRouter({
      model,
      messages: slimMessages(messages),
      tools: smallTalk ? undefined : TOOLS,
      toolChoice: smallTalk ? undefined : toolChoice,
      maxTokens: 4000,
      signal,
      plugins: pluginsFor(),
    });
    usage = addUsage(usage, reply?.usage);
    const calls = Array.isArray(reply?.tool_calls) ? reply.tool_calls.slice(0, MAX_CALLS_PER_ROUND) : [];
    if (!calls.length) {
      const text = String(reply?.content || '').trim();
      if (text) return finishAnswer(text, charts, usage);
      break;
    }

    toolCalls += calls.length;
    onStatus?.(calls.length > 1 ? `Looking up ${calls.length} things…` : 'Looking that up…');
    messages.push({ role: 'assistant', content: reply.content || '', tool_calls: calls });
    const results = await mapPool(calls, TOOL_CONCURRENCY, async (call) => {
      const name = call?.function?.name || '';
      const args = parseToolArgs(call?.function?.arguments);
      if (!args) return { error: 'The request was not valid.' };
      try {
        return await runTool(name, args, context);
      } catch (error) {
        if (signal?.aborted || error?.name === 'AbortError') throw error;
        return { error: error?.message || 'Could not complete that.' };
      }
    });
    const viewed = [];
    results.forEach((result, index) => {
      if (result.chart) charts.push(result.chart);
      if (result.viewAttachments?.length) viewed.push(...result.viewAttachments);
      const payload = clampJson(toolResultPayload(result), MAX_TOOL_RESULT_CHARS);
      toolResults.push(payload);
      messages.push({
        role: 'tool',
        tool_call_id: calls[index].id,
        content: JSON.stringify(payload),
      });
    });
    if (viewed.length) {
      opened = opened.concat(viewed);
      const viewedParts = attachmentParts(viewed);
      messages.push({
        role: 'user',
        content: viewedParts.length
          ? [{ type: 'text', text: 'Documents opened these files. Read them and answer from them.' }, ...viewedParts]
          : 'Documents opened these files.',
      });
    }
    toolChoice = 'auto';
  }

  onStatus?.('Writing the answer…');
  let text = '';
  let failure = '';
  const closingHint =
    toolCalls > 0
      ? `Lookups for this turn are finished (${toolCalls} tool ${toolCalls === 1 ? 'call' : 'calls'}). Write the final answer now from the tool results already in this conversation. Do not call any tool or say what you will fetch next. One or two kind sentences that name the dates and stores, then stop. If part of the question is still unanswered, say which part in one sentence and offer to continue.`
      : 'Write the final answer now from the tool results already in this conversation. Do not call any tool. One or two kind sentences that name the dates and stores, then stop.';
  const answerMessages = slimMessages([
    ...messages,
    { role: 'user', content: closingHint },
  ]);
  try {
    const summary = await completeOpenRouter({
      model,
      maxTokens: 8000,
      signal,
      messages: answerMessages,
      plugins: pluginsFor(),
      reasoning: false,
    });
    usage = addUsage(usage, summary?.usage);
    text = String(summary?.content || '').trim();
    if (!text && /length/i.test(String(summary?.finishReason || ''))) {
      failure = 'The model ran out of room before answering.';
    }
  } catch (error) {
    if (signal?.aborted || error?.name === 'AbortError') throw error;
    failure = error?.message || 'The model could not write the answer.';
  }
  if (!text) text = fallbackAnswer(toolResults, charts, failure);
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
