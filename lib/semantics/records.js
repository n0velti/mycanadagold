/**
 * The records registry: every kind of record an app screen shows, the app
 * and tab it lives on, the API it comes from, and the fields the screen
 * prints. This is what the assistants read so they know what is in the app
 * at record grain, not only as the totals a dataset summarises: a call keeps
 * its caller's number, a punch its clock-in time, a payment its method and
 * reference.
 *
 * `tool` says how to read a kind. Kinds with `list: true` are loaded row by
 * row by lib/data/records.js behind the `list_records` tool; the others name
 * the tool that already lists them (tickets → list_transactions, reviews →
 * read_reviews, …). Add a screen's records here when the screen is built.
 */

const F = (key, label, format = 'text', note = '') => ({ key, label, format, note });

export const RECORD_KINDS = {
  // ---------------------------------------------------------------- Phone
  calls: {
    label: 'Calls',
    app: 'Phone',
    tabs: ['Incoming', 'Missed', 'Call log', 'Ratio'],
    source: 'RingCentral call log, one line per store',
    grain: 'one row per call, inbound or outbound',
    topic: 'analytics.phone',
    list: true,
    dated: true,
    maxDays: 92,
    fields: [
      F('store', 'Store'),
      F('date', 'Date'),
      F('time', 'Time'),
      F('direction', 'Direction', 'text', 'Inbound or Outbound'),
      F('number', 'Number', 'text', "the other party's phone number: the caller on an inbound call, the number dialled on an outbound one"),
      F('name', 'Name', 'text', 'caller ID name when RingCentral has one'),
      F('result', 'Result', 'text', 'Answered, Missed, Voicemail, Rejected, …'),
      F('outcome', 'Outcome', 'text', 'inbound only: answered, missed, voicemail, or rejected'),
      F('recovered', 'Recovered', 'text', 'inbound miss only: callback (we dialled them back), answered later (they called again and were answered), or still missed'),
      F('duration', 'Duration', 'text', 'm:ss'),
      F('recording', 'Recording', 'text', 'Yes when a recording exists (Recordings & AI tab)'),
    ],
    filters: ['stores', 'startDate/endDate', 'direction (inbound / outbound)', 'outcome (answered / missed / stillMissed / recovered / voicemail / rejected)', 'search (digits of a number, or a name)', 'hasRecording'],
    summaryTool: 'query_metrics (inboundCalls, answeredCalls, missedCalls, answerRate, firstRingRate) or lookup_company_data phone for counts and rates',
  },
  voicemails: {
    label: 'Voicemails',
    app: 'Phone',
    tabs: ['Voicemail'],
    source: 'RingCentral message store, per store line',
    grain: 'one row per voicemail',
    topic: 'analytics.phone',
    list: true,
    dated: true,
    maxDays: 92,
    fields: [
      F('store', 'Store'),
      F('date', 'Date'),
      F('time', 'Time'),
      F('number', 'From', 'text', "the caller's number"),
      F('name', 'Name', 'text', 'caller ID name'),
      F('to', 'To', 'text', 'the store number dialled'),
      F('duration', 'Length', 'text', 'm:ss'),
      F('read', 'Read', 'text', 'Read or Unread'),
      F('subject', 'Subject'),
    ],
    filters: ['stores', 'startDate/endDate', 'search (number or name)', 'status (read / unread)'],
  },
  callInsights: {
    label: 'Call recordings and AI analyses',
    app: 'Phone',
    tabs: ['Recordings & AI'],
    source: 'RingCentral AI / RingSense analyses of recorded calls, stored per store',
    grain: 'one row per analysed recording',
    topic: 'analytics.phone',
    list: true,
    dated: true,
    maxDays: 366,
    fields: [
      F('store', 'Store'),
      F('date', 'Date'),
      F('time', 'Time'),
      F('direction', 'Direction'),
      F('number', 'Number'),
      F('name', 'Name'),
      F('duration', 'Duration', 'text', 'm:ss'),
      F('status', 'Status', 'text', 'queued, processing, done, or failed'),
      F('sentiment', 'Sentiment', 'text', 'from the analysis'),
      F('summary', 'Summary', 'text', 'the AI summary of the conversation'),
      F('topics', 'Topics'),
    ],
    filters: ['stores', 'startDate/endDate', 'direction', 'search (number, name, or words in the summary and topics)', 'status'],
  },

  // -------------------------------------------------------------- People
  shifts: {
    label: 'Scheduled shifts',
    app: 'Calendar',
    tabs: ['Month', 'Week', 'Day'],
    alsoIn: 'Employees → a person → Shift schedule',
    source: 'Rippling shift report (imported by the hours feed)',
    grain: 'one row per scheduled shift per person per day',
    topic: 'analytics.hours',
    scope: 'hours',
    list: true,
    dated: true,
    allowFuture: true,
    maxDays: 120,
    fields: [
      F('employee', 'Employee'),
      F('store', 'Store', 'text', "the shift's Rippling location, else the person's default POS store"),
      F('date', 'Date'),
      F('start', 'Start'),
      F('end', 'End'),
      F('role', 'Role', 'text', 'Buying/Selling, Security, …'),
      F('hours', 'Hours', 'hours'),
      F('draft', 'Draft', 'text', 'Yes when the shift is still a draft in Rippling'),
    ],
    filters: ['stores', 'startDate/endDate (future dates allowed)', 'employee', 'search'],
    summaryTool: 'lookup_company_data calendar for who is clocked in and the schedule in one read; query_metrics shifts / staffOnDuty for counts',
  },
  punches: {
    label: 'Clock in / out punches',
    app: 'Calendar',
    tabs: ['Day'],
    alsoIn: 'Employees → a person → Hours; Home → store → Employees',
    source: 'Rippling time entries (imported by the hours feed)',
    grain: 'one row per punch (clock in to clock out)',
    topic: 'analytics.hours',
    scope: 'hours',
    list: true,
    dated: true,
    maxDays: 366,
    fields: [
      F('employee', 'Employee'),
      F('store', 'Store', 'text', "the person's default POS store (Rippling carries no store)"),
      F('date', 'Date'),
      F('clockIn', 'Clock in'),
      F('clockOut', 'Clock out', 'text', 'empty while still clocked in'),
      F('hours', 'Hours', 'hours'),
    ],
    filters: ['stores', 'startDate/endDate', 'employee', 'search'],
    summaryTool: 'query_metrics hoursWorked / shifts / staffOnDuty for totals and trends',
  },

  // --------------------------------------------------------------- Money
  payments: {
    label: 'Payments',
    app: 'Accounting',
    tabs: ['Ledger', 'Payments'],
    alsoIn: 'Financials (cash payments only); Debit → Ledger (debit / Interac / EFT only); Audit → Cash',
    source: 'Aureus payments ledger of East, GTA, and PMX (cleared payments)',
    grain: 'one row per cleared payment, any method',
    topic: 'analytics.cash',
    list: true,
    dated: true,
    maxDays: 31,
    fields: [
      F('date', 'Date'),
      F('store', 'Store'),
      F('direction', 'Direction', 'text', 'In (received) or Out (paid out)'),
      F('amount', 'Amount', 'money'),
      F('currency', 'Currency'),
      F('method', 'Method', 'text', 'Cash, Debit, Interac e-transfer, Cheque, Credit card, Bank wire, …'),
      F('till', 'Till'),
      F('customer', 'Customer'),
      F('reference', 'Reference', 'text', 'the PO# / SO# the payment settles'),
      F('title', 'For', 'text', 'what the payment was for (ticket, supplies, expense)'),
      F('cheque', 'Cheque #'),
      F('status', 'Status'),
      F('system', 'POS'),
    ],
    filters: ['stores', 'startDate/endDate (up to 31 days)', 'method (cash, debit, cheque, e-transfer, credit, wire, or all)', 'direction (in / out)', 'minAmount / maxAmount', 'search (customer, reference, title)'],
    summaryTool: 'lookup_company_data financials (cash) / debit for totals by store',
  },
  monerisReceipts: {
    label: 'Terminal receipts',
    app: 'Debit',
    tabs: ['Ledger'],
    source: 'Moneris Cloud terminal receipts the Debit app recorded',
    grain: 'one row per card transaction on a store terminal',
    topic: 'analytics.cash',
    list: true,
    dated: true,
    maxDays: 31,
    fields: [
      F('date', 'Date'),
      F('time', 'Time'),
      F('store', 'Store'),
      F('terminal', 'Terminal'),
      F('action', 'Action', 'text', 'purchase, refund, …'),
      F('amount', 'Amount', 'money'),
      F('card', 'Card', 'text', 'card type and last four digits'),
      F('approved', 'Approved', 'text', 'Yes or No'),
      F('orderId', 'Order'),
      F('authCode', 'Auth code'),
    ],
    filters: ['stores', 'startDate/endDate (up to 31 days)', 'search (order id, card, auth code)', 'status (approved / declined)'],
  },

  // -------------------------------------------------------------- Triage
  triageErrors: {
    label: 'Triage errors',
    app: 'Triage',
    tabs: ['Errors', 'People', 'Analytics', 'Accuracy → Incorrect'],
    source: 'Triage reviews of purchase tickets (Supabase workflow + Aureus purchases)',
    grain: 'one row per purchase evaluation marked incorrect',
    topic: 'analytics.triage',
    scope: 'employeePerformance',
    list: true,
    dated: true,
    maxDays: 366,
    fields: [
      F('date', 'Date', 'text', 'the purchase date'),
      F('store', 'Store'),
      F('employee', 'Employee', 'text', 'who priced the purchase'),
      F('role', 'Role'),
      F('errorType', 'Error type'),
      F('amount', 'Amount', 'money', 'the dollar value staff recorded on the error (the Amount column), not the PO total'),
    ],
    filters: ['stores', 'startDate/endDate', 'employee', 'search (error type)', 'minAmount / maxAmount'],
    summaryTool: 'query_metrics evaluationErrors / errorValue; lookup_company_data triage for accuracy by store and error types',
  },

  // ------------------------------------------------------------- Bonuses
  bonusRows: {
    label: 'Bonus credits',
    app: 'Bonuses',
    tabs: ['Store → employee → reviews'],
    source: 'Google reviews matched to POS tickets and the roster, as the Bonuses app credits them',
    grain: 'one row per eligible review per credited employee (a review naming two people is two half rows)',
    topic: 'analytics.compensation',
    scope: 'compensation',
    list: true,
    dated: true,
    maxDays: 184,
    fields: [
      F('date', 'Date', 'text', 'the day the review was posted'),
      F('store', 'Store'),
      F('employee', 'Employee'),
      F('reviewer', 'Reviewer'),
      F('rating', 'Stars', 'int'),
      F('photos', 'Photos', 'text', 'Yes when the review has photos'),
      F('attribution', 'How credited', 'text', 'named in the review, matched to a ticket, …'),
      F('share', 'Share', 'decimal', '1, or 0.5 when shared'),
      F('reviewBonus', 'Review bonus', 'money'),
      F('photoBonus', 'Photo bonus', 'money'),
      F('payout', 'Payout', 'money'),
      F('text', 'Review', 'text', 'the review text'),
    ],
    filters: ['stores', 'startDate/endDate', 'employee', 'search (reviewer or review text)', 'minAmount'],
    summaryTool: 'query_metrics bonusPayout / reviewBonus / photoBonus / bonusReviews; lookup_company_data bonuses for the board by store',
  },

  // ----------------------------------------------------------- Transfers
  transfers: {
    label: 'Stock transfers',
    app: 'Transfer',
    tabs: ['Dashboard'],
    source: 'Aureus transfers (pending and received)',
    grain: 'one row per transfer (TR#) between locations',
    topic: 'analytics.transfers',
    list: true,
    dated: true,
    maxDays: 366,
    fields: [
      F('reference', 'Transfer', 'text', 'TR# number'),
      F('date', 'Date'),
      F('status', 'Status', 'text', 'pending (in transit) or received'),
      F('from', 'From'),
      F('to', 'To'),
      F('items', 'Items', 'text', 'product names'),
      F('itemCount', 'Lines', 'int'),
      F('totalQty', 'Qty sent', 'decimal'),
      F('receivedQty', 'Qty received', 'decimal'),
      F('receivedDate', 'Received on'),
      F('createdBy', 'Created by'),
      F('receivedBy', 'Received by'),
      F('tracking', 'Tracking'),
      F('mode', 'Mode', 'text', 'Employee drop, courier, …'),
    ],
    filters: ['stores (from or to)', 'startDate/endDate', 'status (pending / received)', 'search (TR#, product, person)'],
    summaryTool: 'plan_transfer for what to move next (Transfer → Create)',
  },

  // ------------------------------------------------------------ Supplies
  supplies: {
    label: 'Store supplies',
    app: 'Supplies',
    tabs: ['one tab per category'],
    source: 'Supabase supply_items (staff-entered counts per store)',
    grain: 'one row per supply item per store',
    topic: 'analytics.supplies',
    list: true,
    dated: false,
    fields: [
      F('store', 'Store'),
      F('category', 'Category'),
      F('name', 'Item'),
      F('brand', 'Brand'),
      F('inUse', 'In use'),
      F('unopened', 'Unopened'),
      F('orderMore', 'Order more', 'text', 'No, Yes, or Yes (not urgent)'),
      F('status', 'Status'),
      F('lastBought', 'Last bought'),
      F('boughtFrom', 'Bought from'),
      F('notes', 'Notes'),
    ],
    filters: ['stores', 'search (item, brand, category)', 'status (order more)'],
  },

  // ---------------------------------------------------------------- Logs
  actionLogs: {
    label: 'Activity log',
    app: 'Logs',
    tabs: ['Everyone', 'Me'],
    source: 'Supabase action_logs (every press in the app, hash-chained)',
    grain: 'one row per action a person took in the app',
    topic: 'analytics.logs',
    list: true,
    dated: true,
    maxDays: 92,
    fields: [
      F('time', 'When'),
      F('actor', 'Who'),
      F('role', 'Role'),
      F('action', 'Action'),
      F('label', 'What', 'text', 'the button or item pressed'),
      F('app', 'App'),
      F('tab', 'Tab'),
      F('store', 'Store'),
      F('platform', 'Platform'),
    ],
    filters: ['startDate/endDate', 'search (person, label, app, store)', 'employee (the actor)', 'limit (newest first, up to 200)'],
  },

  // ---------------------------------------------------------- Numismatic
  numismaticCatalog: {
    label: 'Numismatic reference',
    app: 'Numismatic',
    tabs: ['Coins', 'Paper', 'Desk'],
    source: 'the in-app reference catalog (Royal Canadian Mint and Bank of Canada facts; no prices)',
    grain: 'one row per coin or note series',
    list: true,
    dated: false,
    fields: [
      F('tab', 'Tab', 'text', 'coins or paper'),
      F('group', 'Group', 'text', 'denomination or series group'),
      F('name', 'Series'),
      F('years', 'Years'),
      F('composition', 'Composition'),
      F('metal', 'Metal'),
      F('action', 'Floor action', 'text', 'Quote, Weigh, Check year, Face, or Melt'),
      F('keyDates', 'Key dates'),
      F('note', 'Note'),
    ],
    filters: ['search (series, group, year, composition)'],
  },

  // -------------------------------------------- Read by another tool
  tickets: {
    label: 'Tickets',
    app: 'Transactions',
    tabs: ['the list, with column filters and the FINTRAC cash toggle'],
    alsoIn: 'Home → store → Overview; Customers → profile → tickets; 100 Ways → store → premium purchases',
    source: 'Aureus orders (SO) and purchases (PO) of East, GTA, and PMX',
    grain: 'one row per ticket',
    topic: 'analytics.transactions',
    tool: 'list_transactions (the rows), query_transactions (totals and rankings), show_*_chart, export_spreadsheet',
    fields: [F('ticket', 'PO# / SO#'), F('date', 'Date'), F('time', 'Time'), F('store', 'Store'), F('employee', 'Employee'), F('customer', 'Customer'), F('items', 'Items'), F('amount', 'Amount', 'money'), F('payment', 'Payment'), F('source', 'Source'), F('delivery', 'Delivery'), F('status', 'Status'), F('bookkeeping', 'Bookkeeping'), F('tags', 'Tags')],
  },
  fintracDeals: {
    label: 'Large cash deals',
    app: 'FINTRAC',
    tabs: ['the list (Cash ≥ $10k toggle), the review form, linked LCTR reports'],
    source: 'Aureus sales with $10,000 or more in cash',
    grain: 'one row per ticket',
    topic: 'analytics.fintrac',
    tool: 'lookup_company_data fintrac (rows per ticket with date, ref, store, customer, employee, amount)',
    fields: [F('ref', 'SO#'), F('date', 'Date'), F('store', 'Store'), F('customer', 'Customer'), F('employee', 'Employee'), F('amount', 'Amount', 'money'), F('methods', 'Payment methods')],
  },
  customers: {
    label: 'Customers',
    app: 'Customers',
    tabs: ['Search', 'By visits', 'By volume', 'profile'],
    source: 'Aureus client records of all three POS systems',
    grain: 'one row per customer',
    topic: 'analytics.customers',
    tool: 'search_customers (name, phone, or email; details for their tickets), show_customer_map (where they live), query_transactions groupBy customer (rankings)',
    fields: [F('name', 'Name'), F('type', 'Type'), F('status', 'Status'), F('store', 'Home store'), F('city', 'City'), F('province', 'Province'), F('phone', 'Phone'), F('email', 'Email'), F('lastVisit', 'Last visit'), F('tickets', 'Tickets', 'int')],
  },
  reviews: {
    label: 'Google reviews',
    app: 'Reviews',
    tabs: ['store grid, review feed (rating chip, needs-reply filter)'],
    source: 'Google reviews per store',
    grain: 'one row per review',
    topic: 'analytics.reviews',
    tool: 'read_reviews (the text, by store, dates, rating, or search), query_metrics for counts over time, lookup_company_data reviews for counts and averages',
    fields: [F('store', 'Store'), F('date', 'Date'), F('rating', 'Stars', 'int'), F('author', 'Reviewer'), F('text', 'Review'), F('replied', 'Replied'), F('photos', 'Photos')],
  },
  stock: {
    label: 'Stock on hand',
    app: 'Inventory',
    tabs: ['the matrix (stores as columns; hide-zero, item search)'],
    alsoIn: 'Home → store → Inventory; Transfer → Create',
    source: 'Aureus product inventory of East, GTA, and PMX',
    grain: 'one row per product with a quantity per store',
    topic: 'analytics.inventory',
    tool: 'lookup_company_data inventory with inventorySearch (today), inventory_history (by day)',
    fields: [F('name', 'Product'), F('sku', 'SKU'), F('metal', 'Metal'), F('form', 'Form'), F('priority', 'Priority'), F('qty', 'Qty per store', 'decimal'), F('total', 'Total', 'decimal'), F('preorders', 'Preorders', 'decimal')],
  },
  bullionCounts: {
    label: 'Bullion audit counts',
    app: 'Audit',
    tabs: ['Bullion'],
    source: 'Aureus system counts with the staff vault, night, afternoon, and store counts saved per day',
    grain: 'one row per product at one store on one day',
    topic: 'analytics.audit',
    tool: 'lookup_company_data audit for one named store',
    fields: [F('name', 'Product'), F('sku', 'SKU'), F('systemCount', 'System', 'decimal'), F('counted', 'Counted', 'decimal'), F('variance', 'Variance', 'decimal')],
  },
  tills: {
    label: 'Cash tills',
    app: 'Home',
    tabs: ['store → Financials'],
    alsoIn: 'Audit → Cash (drawer counts by denomination and the expected balance)',
    source: 'Aureus cash logs and cash payments per store',
    grain: 'one row per store',
    topic: 'analytics.cash',
    tool: 'lookup_company_data tills',
    fields: [F('store', 'Store'), F('currentCad', 'Till 1 CAD now', 'money'), F('openingCad', 'Opening', 'money'), F('physicalCad', 'Counted', 'money'), F('currentUsd', 'USD drawer', 'money')],
  },
  prices: {
    label: 'Website prices',
    app: 'Pricing',
    tabs: ['What we buy', 'What we sell'],
    source: 'canadagold.ca buy and sell pages',
    grain: 'one row per product price',
    topic: 'analytics.pricing',
    tool: 'lookup_company_data pricing',
    fields: [F('name', 'Product'), F('price', 'Buy price', 'money'), F('sellPrice', 'Sell price', 'money'), F('spot', 'Spot', 'money')],
  },
  employees: {
    label: 'Staff directory',
    app: 'Employees',
    tabs: ['directory, person detail (work, contact, shifts, hours)'],
    alsoIn: 'Contacts; Teams',
    source: 'POS user directory and the app profiles',
    grain: 'one row per person',
    topic: 'analytics.staff',
    tool: 'lookup_company_data employees (POS directory: name, role, store), contacts (store, team, online), teams',
    fields: [F('name', 'Name'), F('role', 'Role'), F('store', 'Store'), F('team', 'Team'), F('online', 'Online'), F('active', 'Active')],
  },
  emails: {
    label: 'Emails',
    app: 'Emails',
    tabs: ['Inbox', 'Sent', 'per connected inbox'],
    source: "the signed-in user's own connected Gmail inboxes",
    grain: 'one row per message',
    topic: 'analytics.emails',
    own: true,
    tool: 'lookup_company_data emails',
    fields: [F('from', 'From'), F('to', 'To'), F('subject', 'Subject'), F('date', 'Date'), F('body', 'Body'), F('account', 'Inbox')],
  },
  messages: {
    label: 'Direct messages',
    app: 'Direct Messages',
    tabs: ['inbox, thread'],
    source: "the signed-in user's own conversations",
    grain: 'one row per message',
    topic: 'analytics.messages',
    own: true,
    tool: 'lookup_company_data messages',
    fields: [F('conversation', 'Conversation'), F('from', 'From'), F('text', 'Message'), F('date', 'Date')],
  },
  tasks: {
    label: 'Tasks',
    app: 'Tasks',
    tabs: ['Open', 'Done', 'All'],
    source: "requests found in the signed-in user's own mail, chats, and their store's calls",
    grain: 'one row per open request',
    own: true,
    tool: 'lookup_company_data with emails and messages together, then show_table',
    fields: [F('from', 'From'), F('request', 'Request'), F('where', 'Where'), F('when', 'When'), F('status', 'Status')],
  },
  documents: {
    label: 'Documents',
    app: 'Documents',
    tabs: ['folders, search'],
    source: 'Supabase staff-documents library',
    grain: 'one row per uploaded file',
    topic: 'analytics.documents',
    tool: 'search_documents, read_document',
    fields: [F('name', 'File'), F('folder', 'Folder'), F('kind', 'Kind'), F('added', 'Added'), F('addedBy', 'Added by'), F('excerpt', 'Excerpt')],
  },
  premiumPurchases: {
    label: 'Premium jewelry purchases',
    app: '100 Ways',
    tabs: ['store table, store drawer'],
    source: 'Aureus purchases whose lines are premium jewelry',
    grain: 'one row per premium purchase',
    topic: 'analytics.jewelry',
    tool: 'lookup_company_data 100-ways',
    fields: [F('store', 'Store'), F('ref', 'PO#'), F('date', 'Date'), F('employee', 'Employee'), F('customer', 'Customer'), F('amount', 'Amount', 'money'), F('items', 'Premium items')],
  },
  transferPlan: {
    label: 'Transfer plan',
    app: 'Transfer',
    tabs: ['Create'],
    source: 'live stock at each stop with the territory split applied',
    grain: 'one row per product to move',
    topic: 'analytics.transfers',
    tool: 'plan_transfer',
    fields: [F('product', 'Product'), F('from', 'From'), F('to', 'To'), F('qty', 'Send', 'decimal')],
  },
};

export const RECORD_KIND_KEYS = Object.keys(RECORD_KINDS);

/** Kinds `list_records` loads itself. */
export const LISTABLE_RECORD_KINDS = RECORD_KIND_KEYS.filter((key) => RECORD_KINDS[key].list);

/** Apps on the grid whose screens hold nothing an assistant can read yet. */
export const APPS_WITHOUT_RECORDS = [
  { app: 'Preorders', why: 'placeholder tabs (Open, Arrived, Fulfilled) with no data yet' },
  { app: 'Marketing', why: 'placeholder tabs (Campaigns, Promotions, Assets)' },
  { app: 'Shared Services', why: 'placeholder tabs (Requests, Operations, Knowledge)' },
  { app: 'Trove', why: 'opens an external site' },
  { app: 'Serphint', why: 'analyses a photo the user takes; nothing is stored' },
  { app: 'Audit → Audit by Item', why: 'the item timeline is built on demand per item and date range' },
  { app: 'Audit → Cash', why: 'denomination count sheets; the expected balance is the tills dataset' },
  { app: 'Triage → Lots, Shipments, Deleted', why: 'workflow folders; the errors themselves are list_records triageErrors' },
  { app: 'Dashboards, Notifications, Settings', why: 'per-user app state' },
];

export function recordKind(key) {
  return RECORD_KINDS[String(key || '').trim()] || null;
}

/** The kinds a permission topic (`analytics.*`) covers. */
export function recordKindsForTopic(topicKey) {
  return RECORD_KIND_KEYS.filter((key) => RECORD_KINDS[key].topic === topicKey);
}

/** show_table / export columns for a kind, from its fields. */
export function recordColumns(key) {
  const kind = recordKind(key);
  if (!kind) return [];
  return kind.fields.map((field) => ({ key: field.key, label: field.label, format: field.format }));
}

function fieldText(field) {
  return field.note ? `${field.key} (${field.note})` : field.key;
}

/**
 * The catalog the assistants read: every app, its tabs, the record kind each
 * shows with its fields, and the tool that lists it. Grouped by app so the
 * model can map a question to a screen and then to a tool.
 */
export function recordsCatalogText() {
  const byApp = new Map();
  for (const key of RECORD_KIND_KEYS) {
    const kind = RECORD_KINDS[key];
    const bucket = byApp.get(kind.app) || [];
    bucket.push({ key, kind });
    byApp.set(kind.app, bucket);
  }
  const lines = [];
  for (const [app, kinds] of byApp) {
    lines.push(`${app}:`);
    for (const { key, kind } of kinds) {
      const tabs = kind.tabs?.length ? `${kind.tabs.join(' / ')}` : '';
      const tool = kind.list
        ? `list_records kind "${key}"${kind.filters?.length ? ` (filters: ${kind.filters.join('; ')})` : ''}`
        : kind.tool;
      const parts = [
        `  - ${tabs ? `${tabs} → ` : ''}${kind.label}: ${kind.grain}, from ${kind.source}.`,
        `Fields: ${kind.fields.map(fieldText).join(', ')}.`,
        `Read with ${tool}.`,
      ];
      if (kind.summaryTool) parts.push(`Counts and rates: ${kind.summaryTool}.`);
      if (kind.alsoIn) parts.push(`Also shown in ${kind.alsoIn}.`);
      if (kind.own) parts.push("Only the signed-in user's own.");
      lines.push(parts.join(' '));
    }
  }
  lines.push(
    `Nothing to read yet: ${APPS_WITHOUT_RECORDS.map((item) => `${item.app} (${item.why})`).join('; ')}.`,
  );
  return lines.join('\n');
}
