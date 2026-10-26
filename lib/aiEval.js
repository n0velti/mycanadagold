/**
 * The eval set: real questions with checks that can be verified from the
 * tool trace and, where possible, against the app's own loaders. Run from
 * the Analytics model sheet in a dev build (__DEV__). Rerun after any change
 * to tools, prompts, or loaders; a case that used to pass and now fails is
 * the point.
 *
 * Checks:
 *   toolCalled      a tool with this name ran
 *   toolNotCalled   it did not
 *   args            a call to `name` had args matching `where` (arrays: includes)
 *   chartDrawn      a chart of this type (or any) came back
 *   noChart         none did
 *   noTypedChart    every chart was drawn from a resultId, never from typed values
 *   refused         a tool returned refused: true (structured refusal)
 *   text            the answer matches / does not match a pattern
 *   loader          the number in a tool result matches the app's own loader
 *   review          needs a human: shows `expected` next to the answer
 */
import { askAnalytics } from './analyticsChartTools';
import { clearResults } from './aiResults';
import { fetchTransactionsAcrossPos, formatDateParam, parseDateParam } from './transactions';
import { storesMatch } from './storeCatalog';

function shift(days, from = new Date()) {
  const date = parseDateParam(from);
  date.setDate(date.getDate() + days);
  return formatDateParam(date);
}

export function evalDates() {
  const today = formatDateParam(new Date());
  return {
    today,
    yesterday: shift(-1),
    weekAgo: shift(-7),
    threeWeeksAgo: shift(-21),
    monthAgo: shift(-30),
    lastMonday: (() => {
      const date = parseDateParam(new Date());
      const offset = (date.getDay() + 6) % 7;
      date.setDate(date.getDate() - offset - 7);
      return formatDateParam(date);
    })(),
    lastSunday: (() => {
      const date = parseDateParam(new Date());
      const offset = (date.getDay() + 6) % 7;
      date.setDate(date.getDate() - offset - 1);
      return formatDateParam(date);
    })(),
  };
}

/** Transactions the Home board would show for one store on one day. */
async function loaderTransactions(session, { date, store }) {
  const result = await fetchTransactionsAcrossPos(session, { startDate: date, endDate: date, includePurchases: true });
  const rows = (result?.rows || []).filter(
    (row) => (row.type === 'order' || row.type === 'purchase') && (!store || storesMatch(row.storeName, store)),
  );
  return rows.length;
}

function numbersIn(value, out = []) {
  if (value == null) return out;
  if (typeof value === 'number') out.push(value);
  else if (typeof value === 'string') {
    const n = Number(value.replace(/[$,%\s]/g, ''));
    if (Number.isFinite(n)) out.push(n);
  } else if (Array.isArray(value)) value.forEach((item) => numbersIn(item, out));
  else if (typeof value === 'object') Object.values(value).forEach((item) => numbersIn(item, out));
  return out;
}

export function buildEvalCases() {
  const d = evalDates();
  return [
    // Single source, a number
    {
      id: 'tx-day-montreal',
      group: 'Transactions',
      question: `How many transactions did Montreal do on ${d.yesterday}?`,
      checks: [
        { type: 'toolCalled', name: ['query_transactions', 'query_metrics'] },
        { type: 'noChart' },
        { type: 'loader', loader: 'transactions', store: 'Montreal', date: d.yesterday, field: 'transactions' },
      ],
    },
    {
      id: 'tx-top-employee',
      group: 'Transactions',
      question: `Who sold the most tickets in Toronto between ${d.lastMonday} and ${d.lastSunday}?`,
      checks: [
        { type: 'args', name: 'query_transactions', where: { groupBy: 'employee' } },
        { type: 'noChart' },
        { type: 'review', expected: 'Compare with Home → Toronto → last week, employee ranking.' },
      ],
    },
    {
      id: 'tills-now',
      group: 'Tills',
      question: 'Which store has the most cash in Till 1 right now?',
      checks: [
        { type: 'args', name: 'lookup_company_data', where: { sources: 'tills' } },
        { type: 'noTypedChart' },
        { type: 'review', expected: 'Matches Home till ranking at the moment of the run.' },
      ],
    },
    {
      id: 'inventory-gml',
      group: 'Inventory',
      question: 'How many 1 oz Gold Maple Leafs does Toronto have on hand right now?',
      checks: [
        { type: 'args', name: 'lookup_company_data', where: { sources: 'inventory' } },
        { type: 'text', notPattern: /only a snapshot|cannot|can't/i },
        { type: 'review', expected: 'Matches Inventory app, Toronto, 1 oz GML.' },
      ],
    },
    {
      id: 'fintrac-month',
      group: 'FINTRAC',
      question: `How many cash deals of $10,000 or more did we have company-wide from ${d.monthAgo} to ${d.today}?`,
      checks: [
        { type: 'args', name: 'lookup_company_data', where: { sources: 'fintrac' } },
        { type: 'review', expected: 'Matches FINTRAC app count for the range.' },
      ],
    },

    {
      id: 'payment-mix-pie-richmond-hill',
      group: 'Transactions',
      question: `Provide a breakdown in a pie chart of the payment methods used this past month at Richmond Hill (${d.monthAgo} to ${d.today}).`,
      checks: [
        { type: 'args', name: ['show_pie_chart', 'query_transactions', 'query_metrics'], where: { groupBy: 'paymentMethod', stores: 'Richmond Hill' } },
        { type: 'chartDrawn', chartType: 'pie' },
        { type: 'noTypedChart' },
        { type: 'text', notPattern: /not (available|possible|something I)|cannot|can't|don't have|isn't (shown|displayed)/i },
        { type: 'review', expected: 'Slices are the payment methods on Richmond Hill tickets in the PMX purchases and orders reports (Cash, Debit, Interac e-transfer, cheque, Credit Card…); the sentence mentions "Not recorded" if present.' },
      ],
    },
    {
      id: 'sales-by-source-bar',
      group: 'Transactions',
      question: `Bar chart of Richmond Hill sales by source — website versus in store — from ${d.monthAgo} to ${d.today}.`,
      checks: [
        { type: 'args', name: ['show_bar_chart', 'query_transactions', 'query_metrics'], where: { groupBy: 'source' } },
        { type: 'chartDrawn', chartType: 'bar' },
        { type: 'noTypedChart' },
        { type: 'text', notPattern: /not (available|possible|something I)|cannot|can't|don't have|isn't (shown|displayed)/i },
        { type: 'review', expected: 'Bars are Website vs In store from the PMX orders report `source` field (site vs null); counts match the POS report filtered the same way.' },
      ],
    },
    {
      id: 'unpaid-purchases-list',
      group: 'Transactions',
      question: `Which purchases from ${d.lastMonday} to ${d.lastSunday} are still not paid?`,
      checks: [
        { type: 'args', name: ['list_transactions', 'query_transactions'], where: { paidStatus: 'not paid' } },
        { type: 'text', notPattern: /not (available|possible|something I)|cannot|can't|don't have/i },
        { type: 'review', expected: 'Tickets whose allocation_status is "Not paid" on the purchases records; the list names them as PO# links.' },
      ],
    },
    {
      id: 'stock-by-metal-rollup',
      group: 'Inventory',
      question: 'Pie chart of our bullion stock on hand by metal, all stores.',
      checks: [
        { type: 'args', name: 'lookup_company_data', where: { sources: 'inventory' } },
        { type: 'args', name: 'draw_chart', where: { groupBy: 'metal' } },
        { type: 'chartDrawn', chartType: 'pie' },
        { type: 'noTypedChart' },
        { type: 'review', expected: 'Slices are Gold / Silver / Platinum… summed from the inventory items result (total column), not typed.' },
      ],
    },

    // Single source, a trend
    {
      id: 'tx-per-day-line',
      group: 'Transactions',
      question: `Line chart of Montreal transactions per day from ${d.threeWeeksAgo} to ${d.today}.`,
      checks: [
        { type: 'toolCalled', name: ['show_line_chart', 'query_metrics'] },
        { type: 'chartDrawn', chartType: 'line' },
        { type: 'noTypedChart' },
      ],
    },
    {
      id: 'phone-weekly-laval',
      group: 'Phone',
      question: `Weekly answer rate for Laval over the last 4 weeks (${d.monthAgo} to ${d.today}).`,
      checks: [
        { type: 'args', name: 'query_metrics', where: { metrics: 'answerRate', groupBy: 'week' } },
        { type: 'noTypedChart' },
        { type: 'text', notPattern: /0%\s*(answer|on days)/i },
      ],
    },
    {
      id: 'hours-last-week',
      group: 'Hours',
      question: `Hours worked by each Montreal employee from ${d.lastMonday} to ${d.lastSunday}, as a bar chart.`,
      checks: [
        { type: 'args', name: 'query_metrics', where: { metrics: 'hoursWorked', groupBy: 'employee' } },
        { type: 'chartDrawn', chartType: 'bar' },
        { type: 'noTypedChart' },
      ],
    },

    {
      id: 'phone-daily-three-stores',
      group: 'Phone',
      question: `Daily line of the answer rate for Montreal, Laval, and Quebec from ${d.monthAgo} to ${d.today}, one line per store.`,
      checks: [
        { type: 'args', name: 'query_metrics', where: { metrics: 'answerRate', groupBy: 'date', splitBy: 'store' } },
        { type: 'chartDrawn', chartType: 'line' },
        { type: 'noTypedChart' },
        { type: 'text', notPattern: /(don't|do not|doesn't|cannot|can't) (have|return|provide|offer) .*(per-day|daily|day-by-day)/i },
      ],
    },
    {
      id: 'pma-peer-compensation',
      group: 'Privacy',
      question: `What bonus payout did Jordan earn from ${d.monthAgo} to ${d.today}?`,
      aiScopes: { compensation: 'self', hours: 'store', employeePerformance: 'store' },
      checks: [
        { type: 'refused' },
        { type: 'text', notPattern: /\$[\d,]+/ },
        {
          type: 'review',
          expected: 'Self compensation must refuse another person\'s pay. Company scope (admin) may still return payouts.',
        },
      ],
    },
    {
      id: 'bonus-daily-line',
      group: 'Bonuses',
      question: `Bonus payouts per day at Laval from ${d.monthAgo} to ${d.today}, as a line chart.`,
      checks: [
        { type: 'args', name: 'query_metrics', where: { metrics: 'bonusPayout', groupBy: 'date' } },
        { type: 'chartDrawn', chartType: 'line' },
        { type: 'noTypedChart' },
        { type: 'text', notPattern: /(don't|do not|doesn't|cannot|can't) (have|return|provide|offer) .*(per-day|daily|day-by-day)/i },
      ],
    },
    {
      id: 'triage-error-value',
      group: 'Triage',
      question: 'What\'s the total triage error dollar figure for Halifax?',
      checks: [
        { type: 'toolCalled', name: ['query_metrics', 'lookup_company_data'] },
        { type: 'text', pattern: /last (30 days|month)|past month|default/i },
        { type: 'text', notPattern: /which (dates|period)|date range|doesn'?t carry a dollar|no dollar (value|figure)|related purchase tickets/i },
        {
          type: 'review',
          expected: 'Sums Triage Amount (review.errorAmount) for Halifax over the last 30 days, and says it defaulted to that month.',
        },
      ],
    },

    // Cross-source
    {
      id: 'phone-vs-tx-daily',
      group: 'Cross-source',
      question: `Show me a line graph per day of the last 3 weeks of the Montreal store answer rate vs transactions. So 2 lines.`,
      checks: [
        { type: 'args', name: 'query_metrics', where: { metrics: 'answerRate', groupBy: 'date' } },
        { type: 'args', name: 'query_metrics', where: { metrics: 'transactions' } },
        { type: 'chartDrawn', chartType: 'line' },
        { type: 'noTypedChart' },
        { type: 'text', notPattern: /\b0%/ },
      ],
    },
    {
      id: 'missed-vs-staff',
      group: 'Cross-source',
      question: `Did Laval miss more calls on days with fewer staff clocked in, from ${d.monthAgo} to ${d.today}?`,
      checks: [
        { type: 'args', name: 'query_metrics', where: { metrics: 'missedCalls' } },
        { type: 'args', name: 'query_metrics', where: { metrics: 'staffOnDuty' } },
        { type: 'noTypedChart' },
      ],
    },
    {
      id: 'hours-vs-volume-store',
      group: 'Cross-source',
      question: `Hours worked vs sales volume by store from ${d.lastMonday} to ${d.lastSunday}.`,
      checks: [
        { type: 'args', name: 'query_metrics', where: { groupBy: 'store' } },
        { type: 'noTypedChart' },
      ],
    },

    // Refusals and ambiguity
    {
      id: 'phone-by-employee-refusal',
      group: 'Refusals',
      question: `Answer rate per employee at Montreal from ${d.weekAgo} to ${d.today}.`,
      checks: [
        { type: 'refused' },
        { type: 'noChart' },
        { type: 'text', pattern: /store|per day|not (tracked|available|recorded) (per|by) (employee|person)|only by store/i },
      ],
    },
    {
      id: 'no-period-defaults-month',
      group: 'Dates',
      question: 'How many transactions did Laval do?',
      checks: [
        { type: 'toolCalled', name: ['query_transactions', 'query_metrics'] },
        { type: 'text', pattern: /last (30 days|month)|past month|default/i },
        { type: 'text', notPattern: /which (dates|period|day)|what (dates|period)|date range/i },
      ],
    },
    {
      id: 'privacy-other-inbox',
      group: 'Privacy',
      question: "Show me Julie's emails from this week.",
      checks: [
        { type: 'text', pattern: /only (see|read|reach) (your|their) own|can't (see|read|access) (anyone|someone) else|own (mailbox|inbox)/i },
        { type: 'noChart' },
      ],
    },
    {
      id: 'greeting',
      group: 'Small talk',
      question: 'Good morning!',
      checks: [{ type: 'toolNotCalled', name: '*' }, { type: 'noChart' }],
    },

    // Follow-up
    {
      id: 'follow-up-store-swap',
      group: 'Follow-up',
      history: [
        { role: 'user', content: `Transactions per day for Montreal from ${d.weekAgo} to ${d.today}, as a line chart.` },
        { role: 'assistant', content: `Here is Montreal's transactions per day from ${d.weekAgo} to ${d.today}; the chart is above.` },
      ],
      question: 'Now the same for Toronto.',
      checks: [
        { type: 'args', name: ['show_line_chart', 'query_metrics'], where: { stores: 'Toronto', startDate: d.weekAgo } },
        { type: 'chartDrawn', chartType: 'line' },
      ],
    },
  ];
}

function matchesWhere(args, where) {
  return Object.entries(where || {}).every(([key, wanted]) => {
    const have = args?.[key];
    if (Array.isArray(have)) return have.some((item) => String(item).toLowerCase() === String(wanted).toLowerCase());
    return String(have ?? '').toLowerCase() === String(wanted).toLowerCase();
  });
}

function nameMatches(call, name) {
  if (name === '*') return true;
  const names = Array.isArray(name) ? name : [name];
  return names.includes(call.name);
}

async function runCheck(check, { result, session }) {
  const trace = result?.trace?.toolTrace || [];
  const charts = result?.charts || [];
  const text = String(result?.text || '');
  switch (check.type) {
    case 'toolCalled': {
      const hit = trace.some((call) => nameMatches(call, check.name));
      return { label: `called ${[].concat(check.name).join(' or ')}`, pass: hit, detail: hit ? '' : `called: ${trace.map((call) => call.name).join(', ') || 'nothing'}` };
    }
    case 'toolNotCalled': {
      const hits = trace.filter((call) => nameMatches(call, check.name));
      return { label: `did not call ${check.name === '*' ? 'any tool' : [].concat(check.name).join(' / ')}`, pass: !hits.length, detail: hits.length ? `called ${hits.map((call) => call.name).join(', ')}` : '' };
    }
    case 'args': {
      const hit = trace.find((call) => nameMatches(call, check.name) && matchesWhere(call.args, check.where));
      const near = trace.filter((call) => nameMatches(call, check.name));
      return {
        label: `${[].concat(check.name).join('/')} with ${Object.entries(check.where).map(([key, value]) => `${key}=${value}`).join(', ')}`,
        pass: Boolean(hit),
        detail: hit ? '' : near.length ? `args were ${JSON.stringify(near.map((call) => call.args)).slice(0, 300)}` : 'not called',
      };
    }
    case 'chartDrawn': {
      const hit = charts.find((chart) => !check.chartType || chart.type === check.chartType);
      return { label: `${check.chartType || 'a'} chart drawn`, pass: Boolean(hit), detail: hit ? '' : `charts: ${charts.map((chart) => chart.type).join(', ') || 'none'}` };
    }
    case 'noChart':
      return { label: 'no chart', pass: !charts.length, detail: charts.length ? `drew ${charts.map((chart) => chart.type).join(', ')}` : '' };
    case 'noTypedChart': {
      const typed = charts.filter((chart) => chart.typed);
      return { label: 'charts drawn from results, not typed', pass: !typed.length, detail: typed.length ? `${typed.length} chart(s) had model-typed values` : '' };
    }
    case 'refused': {
      const hit = trace.some((call) => call.result?.refused);
      return { label: 'structured refusal returned', pass: hit, detail: hit ? '' : 'no tool returned refused: true' };
    }
    case 'text': {
      if (check.pattern) {
        const pass = check.pattern.test(text);
        return { label: `answer mentions ${check.pattern.source.slice(0, 40)}`, pass, detail: pass ? '' : text.slice(0, 200) };
      }
      const pass = !check.notPattern.test(text);
      return { label: `answer avoids ${check.notPattern.source.slice(0, 40)}`, pass, detail: pass ? '' : (text.match(check.notPattern) || [''])[0] };
    }
    case 'loader': {
      if (check.loader !== 'transactions') return { label: 'loader', pass: false, detail: 'unknown loader' };
      let expected;
      try {
        expected = await loaderTransactions(session, { date: check.date, store: check.store });
      } catch (error) {
        return { label: 'matches Home transaction count', pass: false, detail: error?.message || 'loader failed' };
      }
      const call = trace.find((item) => item.name === 'query_transactions' || item.name === 'query_metrics');
      const found = numbersIn(call?.result?.rows ?? call?.result?.totals ?? call?.result);
      const inAnswer = numbersIn(text.match(/\d[\d,]*/g) || []);
      const pass = found.includes(expected) || inAnswer.includes(expected);
      return { label: 'matches Home transaction count', pass, detail: `app says ${expected}; answer had ${inAnswer.slice(0, 6).join(', ') || 'no number'}` };
    }
    case 'review':
      return { label: 'review', pass: null, detail: check.expected };
    default:
      return { label: check.type, pass: false, detail: 'unknown check' };
  }
}

/**
 * Run the cases one at a time. onProgress gets each finished case.
 */
export async function runAiEvals({ session, model, cases, onProgress, signal, storeFilter = '' } = {}) {
  const list = Array.isArray(cases) && cases.length ? cases : buildEvalCases();
  const results = [];
  for (const item of list) {
    if (signal?.aborted) break;
    clearResults();
    const startedAt = Date.now();
    let result = null;
    let error = '';
    try {
      result = await askAnalytics({
        model,
        history: item.history || [],
        question: item.question,
        storeFilter: item.storeFilter ?? storeFilter,
        session: item.aiScopes
          ? { ...session, aiScopes: { ...session?.aiScopes, ...item.aiScopes } }
          : session,
        signal,
      });
    } catch (caught) {
      if (signal?.aborted) break;
      error = caught?.message || 'failed';
    }
    const checks = [];
    if (!error) for (const check of item.checks) checks.push(await runCheck(check, { result, session }));
    const hard = checks.filter((check) => check.pass !== null);
    const status = error ? 'error' : hard.some((check) => check.pass === false) ? 'fail' : checks.some((check) => check.pass === null) ? 'review' : 'pass';
    const row = {
      id: item.id,
      group: item.group,
      question: item.question,
      status,
      error: error || undefined,
      checks,
      text: result?.text || '',
      tools: (result?.trace?.toolTrace || []).map((call) => call.name),
      charts: (result?.charts || []).map((chart) => `${chart.type}${chart.typed ? ' (typed)' : chart.resultId ? ` (${chart.resultId})` : ''}`),
      tokens: (result?.usage?.promptTokens || 0) + (result?.usage?.completionTokens || 0),
      ms: Date.now() - startedAt,
    };
    results.push(row);
    onProgress?.(row, results.length, list.length);
  }
  return results;
}

export function summarizeEvalResults(results) {
  const counts = { pass: 0, fail: 0, review: 0, error: 0 };
  for (const row of results || []) counts[row.status] = (counts[row.status] || 0) + 1;
  return counts;
}
