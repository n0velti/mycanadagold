/**
 * Topics a permission rule can block in the AI assistants (feature keys
 * `analytics.*`, see lib/permissionRules.js). Each topic names the Analytics
 * tools, lookup_company_data datasets, query_metrics facts, list_records
 * kinds, and spreadsheet sources that reach it, so a block is enforced where
 * data is read, not only in the prompt: a blocked tool is not offered, a
 * blocked dataset, metric, or record kind comes back `refused` with reason
 * `permission`, and the model is told to say so. Applies to Analytics,
 * Dashboards (they re-run Analytics), and Messages @ai, which load through
 * the same functions.
 *
 * Keep this module light: it is imported by permissionRules.js (everyone's
 * sign-in) and by the Analytics and chat loaders. The metric → fact lookup is
 * injected by the caller so lib/semantics/metrics.js (and the POS client it
 * pulls in) stays out of the sign-in path; record kinds are listed by key
 * here for the same reason (lib/semantics/records.js names them).
 */

export const ANALYTICS_TOPICS = [
  {
    key: 'analytics.phone',
    label: 'Phone data in Analytics',
    phrase: 'phone data in Analytics',
    description: 'Calls, answer rates, first-ring rate, missed calls, and voicemail: the phone dataset, every call metric, and the call log itself (caller numbers and names, voicemails, recordings and their AI analyses).',
    aliases: ['phone data', 'phone', 'calls', 'call data', 'answer rate', 'phone answer rate', 'ringcentral', 'missed calls', 'caller numbers', 'voicemails', 'call recordings'],
    datasets: ['phone'],
    facts: ['calls'],
    records: ['calls', 'voicemails', 'callInsights'],
  },
  {
    key: 'analytics.hours',
    label: 'Hours and schedule in Analytics',
    phrase: 'hours and the schedule in Analytics',
    description: 'Rippling hours worked, shifts, the schedule, and who is clocked in: the calendar dataset, the hours metrics, and the punches and scheduled shifts themselves.',
    aliases: ['hours', 'hours data', 'schedule', 'shifts', 'clocked in', 'rippling', 'calendar', 'punches'],
    datasets: ['calendar'],
    facts: ['hours'],
    records: ['shifts', 'punches'],
  },
  {
    key: 'analytics.compensation',
    label: 'Pay and bonuses in Analytics',
    phrase: 'pay and bonuses in Analytics',
    description: 'Bonus payouts and any pay figure: the bonuses dataset, the bonus metrics, and the per-review bonus credits.',
    aliases: ['pay', 'bonuses', 'bonus data', 'payouts', 'compensation', 'earnings'],
    datasets: ['bonuses'],
    facts: ['bonuses'],
    records: ['bonusRows'],
  },
  {
    key: 'analytics.reviews',
    label: 'Reviews in Analytics',
    phrase: 'reviews in Analytics',
    description: 'Google review counts, ratings, and review text: the reviews dataset, the review metrics, and reading the reviews themselves for sentiment and themes.',
    aliases: ['reviews', 'review data', 'google reviews', 'ratings', 'stars', 'review text', 'review sentiment'],
    tools: ['read_reviews'],
    datasets: ['reviews'],
    facts: ['reviews'],
  },
  {
    key: 'analytics.transactions',
    label: 'Transactions in Analytics',
    phrase: 'transactions in Analytics',
    description: 'The POS ticket ledger: sales, purchases, volume, averages, rankings, charts, and the Home scoreboard.',
    aliases: ['transactions', 'sales data', 'sales', 'purchases', 'tickets', 'volume', 'revenue data', 'ledger'],
    tools: ['query_transactions', 'list_transactions', 'show_line_chart', 'show_bar_chart', 'show_pie_chart', 'show_customer_map'],
    datasets: ['transactions', 'home'],
    facts: ['tickets'],
    exportSources: ['transactions', 'transaction_summary'],
  },
  {
    key: 'analytics.inventory',
    label: 'Inventory in Analytics',
    phrase: 'inventory in Analytics',
    description: 'Stock on hand and stock history by SKU and store.',
    aliases: ['inventory', 'stock', 'stock data', 'on hand', 'inventory history'],
    tools: ['inventory_history'],
    datasets: ['inventory'],
    exportSources: ['inventory', 'inventory_history'],
  },
  {
    key: 'analytics.customers',
    label: 'Customers in Analytics',
    phrase: 'customers in Analytics',
    description: 'Customer lookups and where customers live: search_customers, the customer map, and areas with customers.',
    aliases: ['customers', 'customer data', 'clients', 'customer map', 'where customers live'],
    tools: ['search_customers', 'show_customer_map'],
    datasets: [],
  },
  {
    key: 'analytics.cash',
    label: 'Cash, tills, and debit in Analytics',
    phrase: 'cash, tills, and debit in Analytics',
    description: 'Till balances, cash payments in and out, debit / Interac payments, the payments ledger row by row, and terminal receipts.',
    aliases: ['cash', 'tills', 'till data', 'financials', 'debit', 'interac', 'cash payments', 'money', 'payments', 'accounting', 'receipts'],
    datasets: ['tills', 'financials', 'debit'],
    records: ['payments', 'monerisReceipts'],
  },
  {
    key: 'analytics.fintrac',
    label: 'FINTRAC in Analytics',
    phrase: 'FINTRAC in Analytics',
    description: 'Large cash deals at or above $10,000.',
    aliases: ['fintrac', 'lctr', 'large cash'],
    datasets: ['fintrac'],
  },
  {
    key: 'analytics.triage',
    label: 'Triage in Analytics',
    phrase: 'triage in Analytics',
    description: 'Purchase evaluation accuracy, error types, error dollar values, and the errors themselves.',
    aliases: ['triage', 'triage data', 'evaluation errors', 'accuracy'],
    datasets: ['triage'],
    facts: ['triageErrors'],
    records: ['triageErrors'],
  },
  {
    key: 'analytics.transfers',
    label: 'Transfers in Analytics',
    phrase: 'transfers in Analytics',
    description: 'The transfer planner, the TR# transfer list, and store addresses for transfers.',
    aliases: ['transfers', 'transfer plan', 'transfer planner', 'tr#'],
    tools: ['plan_transfer'],
    datasets: ['transfer'],
    records: ['transfers'],
  },
  {
    key: 'analytics.pricing',
    label: 'Pricing in Analytics',
    phrase: 'pricing in Analytics',
    description: 'Website buy and sell metal prices.',
    aliases: ['pricing', 'prices', 'spot prices', 'website prices'],
    datasets: ['pricing'],
  },
  {
    key: 'analytics.audit',
    label: 'Audit in Analytics',
    phrase: 'audit in Analytics',
    description: 'Bullion count variances per store.',
    aliases: ['audit', 'audits', 'variances', 'bullion audit'],
    datasets: ['audit'],
  },
  {
    key: 'analytics.staff',
    label: 'Staff directory in Analytics',
    phrase: 'the staff directory in Analytics',
    description: 'Employees, contacts, and teams: names, roles, stores, who is online.',
    aliases: ['staff', 'staff directory', 'employees', 'employee directory', 'contacts', 'teams'],
    datasets: ['employees', 'contacts', 'teams'],
  },
  {
    key: 'analytics.documents',
    label: 'Documents in Analytics',
    phrase: 'documents in Analytics',
    description: 'Searching and reading uploaded company files.',
    aliases: ['documents', 'files', 'uploaded files', 'policies'],
    tools: ['search_documents', 'read_document'],
    datasets: [],
  },
  {
    key: 'analytics.emails',
    label: 'Emails in Analytics',
    phrase: 'emails in Analytics',
    description: 'Reading the user’s own connected inboxes for tasks and follow-ups.',
    aliases: ['emails', 'email', 'inbox', 'mail'],
    datasets: ['emails'],
  },
  {
    key: 'analytics.messages',
    label: 'Direct messages in Analytics',
    phrase: 'direct messages in Analytics',
    description: 'Reading the user’s own direct messages for tasks and follow-ups.',
    aliases: ['messages', 'direct messages', 'dms', 'chats'],
    datasets: ['messages'],
  },
  {
    key: 'analytics.jewelry',
    label: '100 Ways in Analytics',
    phrase: '100 Ways in Analytics',
    description: 'Premium jewelry purchases by store.',
    aliases: ['100 ways', 'hundred ways', 'jewelry', 'premium jewelry'],
    datasets: ['100-ways'],
  },
  {
    key: 'analytics.supplies',
    label: 'Supplies in Analytics',
    phrase: 'supplies in Analytics',
    description: 'Store supply counts and what needs reordering, as entered in the Supplies app.',
    aliases: ['supplies', 'supply counts', 'reorder', 'order more'],
    datasets: [],
    records: ['supplies'],
  },
  {
    key: 'analytics.logs',
    label: 'Activity log in Analytics',
    phrase: 'the activity log in Analytics',
    description: 'The Logs app: who pressed what in the app, when, and where.',
    aliases: ['logs', 'activity log', 'action log', 'audit log', 'who did what'],
    datasets: [],
    records: ['actionLogs'],
  },
];

export const ANALYTICS_TOPIC_KEYS = ANALYTICS_TOPICS.map((topic) => topic.key);

const TOPIC_BY_KEY = new Map(ANALYTICS_TOPICS.map((topic) => [topic.key, topic]));

function asString(value) {
  if (value == null) return '';
  return String(value).trim();
}

export function analyticsTopicByKey(key) {
  return TOPIC_BY_KEY.get(asString(key)) || null;
}

function hiddenSet(sessionOrHidden) {
  const raw = Array.isArray(sessionOrHidden) || sessionOrHidden instanceof Set
    ? sessionOrHidden
    : sessionOrHidden?.hiddenFeatures;
  if (raw instanceof Set) return raw;
  return new Set(Array.isArray(raw) ? raw : []);
}

/**
 * Topics blocked for this session, from `session.hiddenFeatures` (the
 * resolved rule set App.js puts on the session). Empty for admins and for
 * anyone with no matching rule.
 */
export function blockedAnalyticsTopics(session) {
  const hidden = hiddenSet(session);
  if (!hidden.size) return [];
  return ANALYTICS_TOPICS.filter((topic) => hidden.has(topic.key));
}

export function topicsForTool(blocked, toolName) {
  const name = asString(toolName);
  return (blocked || []).filter((topic) => (topic.tools || []).includes(name));
}

export function topicsForDataset(blocked, datasetKey) {
  const key = asString(datasetKey);
  return (blocked || []).filter((topic) => (topic.datasets || []).includes(key));
}

/** `fact` is the metric's source fact (lib/semantics/metrics.js METRICS[key].fact). */
export function topicsForFact(blocked, fact) {
  const key = asString(fact);
  if (!key) return [];
  return (blocked || []).filter((topic) => (topic.facts || []).includes(key));
}

export function topicsForExportSource(blocked, source) {
  const key = asString(source);
  return (blocked || []).filter((topic) => (topic.exportSources || []).includes(key));
}

/** `kind` is a list_records kind (lib/semantics/records.js). */
export function topicsForRecordKind(blocked, kind) {
  const key = asString(kind);
  if (!key) return [];
  return (blocked || []).filter((topic) => (topic.records || []).includes(key));
}

function joinPhrases(topics) {
  const list = [...new Set((topics || []).map((topic) => topic.phrase))];
  if (list.length <= 1) return list[0] || '';
  if (list.length === 2) return `${list[0]} and ${list[1]}`;
  return `${list.slice(0, -1).join(', ')}, and ${list[list.length - 1]}`;
}

/** The sentence the assistant gives back for a blocked topic. */
export function permissionRefusalMessage(topics) {
  const what = joinPhrases(topics) || 'that topic';
  return `Your permissions do not include ${what}. A System Admin can change that in Settings → Permissions.`;
}

/** Tool-result payload for a blocked call; the model repeats the message. */
export function permissionRefusal(topics, extra = {}) {
  return {
    refused: true,
    reason: 'permission',
    blocked: (topics || []).map((topic) => topic.key),
    message: permissionRefusalMessage(topics),
    hint: 'Tell the user this in one kind sentence. Do not estimate, infer, or work around it with another tool.',
    ...extra,
  };
}

/**
 * Splits a dataset list into what may load and what a rule blocks. The
 * loaders call this so Analytics and Messages @ai refuse the same way.
 */
export function partitionDatasets(session, sources) {
  const blocked = blockedAnalyticsTopics(session);
  const allowed = [];
  const refused = [];
  const topics = [];
  for (const key of sources || []) {
    const hits = topicsForDataset(blocked, key);
    if (hits.length) {
      refused.push(key);
      topics.push(...hits);
    } else {
      allowed.push(key);
    }
  }
  return { allowed, refused, topics: [...new Set(topics)] };
}

/**
 * Why a tool call must not run, or null. Covers whole tools, facts behind
 * query_metrics metrics (`metricFact(key)` → fact name, `metricKeys` → every
 * metric, both from lib/semantics/metrics.js), list_records kinds,
 * spreadsheet sources, and customer dots on an area map. Datasets inside
 * lookup_company_data are split by partitionDatasets() in the loader
 * instead, so allowed ones still load.
 */
export function refusalForToolCall(blocked, name, args, { metricFact, metricKeys } = {}) {
  if (!blocked?.length) return null;
  const tool = asString(name);
  const whole = topicsForTool(blocked, tool);
  if (whole.length) return permissionRefusal(whole, { tool });
  if (tool === 'list_records') {
    const hits = topicsForRecordKind(blocked, args?.kind);
    if (hits.length) return permissionRefusal(hits, { tool, kind: asString(args?.kind) });
    return null;
  }
  if (tool === 'query_metrics') {
    const metrics = Array.isArray(args?.metrics) ? args.metrics : args?.metrics ? [args.metrics] : [];
    const factOf = typeof metricFact === 'function' ? metricFact : () => '';
    const hits = [];
    const blockedMetrics = [];
    for (const metric of metrics) {
      const topics = topicsForFact(blocked, factOf(asString(metric)));
      if (topics.length) {
        blockedMetrics.push(asString(metric));
        hits.push(...topics);
      }
    }
    if (hits.length) {
      const availableMetrics = (metricKeys || []).filter((key) => !topicsForFact(blocked, factOf(key)).length);
      return permissionRefusal([...new Set(hits)], { tool, blockedMetrics, availableMetrics });
    }
    return null;
  }
  if (tool === 'export_spreadsheet') {
    const sheets = Array.isArray(args?.sheets) ? args.sheets : [];
    const hits = sheets.flatMap((sheet) => topicsForExportSource(blocked, sheet?.source));
    if (hits.length) return permissionRefusal([...new Set(hits)], { tool });
    return null;
  }
  if (tool === 'show_area_map' && args?.customers) {
    const hits = topicsForTool(blocked, 'show_customer_map');
    if (hits.length) return permissionRefusal(hits, { tool, hint: 'Call show_area_map again without customers to outline the area, and tell the user customers cannot be shown.' });
    return null;
  }
  return null;
}

/** Tools the model may be offered, with wholly blocked ones removed. */
export function filterToolsForSession(tools, blocked) {
  if (!blocked?.length) return tools;
  return (tools || []).filter((tool) => !topicsForTool(blocked, tool?.function?.name).length);
}

/** Prompt paragraph for the assistants; empty when nothing is blocked. */
export function analyticsPermissionNote(blocked) {
  if (!blocked?.length) return '';
  const lines = blocked.map((topic) => `${topic.phrase} (${topic.description.replace(/\.$/, '').toLowerCase()})`);
  return `Permissions: a System Admin rule blocks these topics for this user: ${lines.join('; ')}. When a question is about a blocked topic, do not call a tool for it and do not reason around it from other data; say in one kind sentence that their permissions do not include that topic and that a System Admin can change it in Settings → Permissions, then answer any other part of the question normally. A tool result with refused true and reason permission means the same thing: repeat its message and stop.`;
}
