/**
 * The query engine behind the `query_metrics` tool: metrics × groupBy ×
 * filters → rows, joined across sources on store and date. Each metric comes
 * from its own fact (tickets, calls, hours); the engine loads the facts the
 * question needs in parallel, aggregates each per bucket, and lines the
 * buckets up. A bucket with no rows for a metric is null, not 0, so a day
 * with no inbound calls has no answer rate.
 *
 * Rows are registered in lib/aiResults.js and returned with a resultId the
 * renderers draw from.
 */
import { WEEKDAYS, weekdayName } from './employeeMetrics';
import { rememberResult } from './aiResults';
import { loadCallFacts, loadHoursFacts, ticketFactsFromRows } from './data/facts';
import {
  DIMENSIONS,
  FACTS,
  METRICS,
  METRIC_KEYS,
  TIME_DIMENSIONS,
  formatMetricValue,
  unsupportedDimensions,
} from './semantics/metrics';
import { canonicalStoreName, storesMatch } from './storeCatalog';
import { formatDateParam, parseDateParam } from './transactions';

const MAX_POINTS = 370;
const MAX_CATEGORY_ROWS = 40;
const MAX_SERIES = 6;
const MAX_MODEL_ROWS = 120;

// How far back each source can be read live in one call.
const FACT_MAX_DAYS = { tickets: 366, calls: 92, hours: 366 };

function isoDate(value) {
  const text = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}

function shiftIso(day, days) {
  const date = parseDateParam(day);
  date.setDate(date.getDate() + days);
  return formatDateParam(date);
}

function dayCount(start, end) {
  return Math.round((parseDateParam(end) - parseDateParam(start)) / 86400000) + 1;
}

function weekStart(day) {
  const date = parseDateParam(day);
  const offset = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - offset);
  return formatDateParam(date);
}

function monthKey(day) {
  return String(day).slice(0, 7);
}

function shortDay(day, withYear = false) {
  return parseDateParam(day).toLocaleDateString('en-CA', withYear ? { month: 'short', day: 'numeric', year: 'numeric' } : { month: 'short', day: 'numeric' });
}

function monthLabel(key) {
  return parseDateParam(`${key}-01`).toLocaleDateString('en-CA', { month: 'short', year: 'numeric' });
}

function rangeLabel(start, end) {
  if (start === end) return shortDay(start, true);
  return `${shortDay(start)} – ${shortDay(end, true)}`;
}

/** Bucket key for one fact row along one dimension. */
function keyFor(row, dim) {
  if (dim === 'date') return row.date || '';
  if (dim === 'week') return row.date ? weekStart(row.date) : '';
  if (dim === 'month') return row.date ? monthKey(row.date) : '';
  if (dim === 'weekday') return row.date ? weekdayName(row.date) : '';
  if (dim === 'store') return row.store || '—';
  if (dim === 'employee') return row.employee || '—';
  return 'Total';
}

function labelFor(dim, key) {
  if (dim === 'date') return shortDay(key);
  if (dim === 'week') return `Week of ${shortDay(key)}`;
  if (dim === 'month') return monthLabel(key);
  return key;
}

/** Every bucket key in the range for a time dimension, so gaps appear as gaps. */
function timeKeys(dim, start, end) {
  const keys = [];
  if (dim === 'date') {
    for (let day = start; day <= end; day = shiftIso(day, 1)) keys.push(day);
  } else if (dim === 'week') {
    for (let day = weekStart(start); day <= end; day = shiftIso(day, 7)) keys.push(day);
  } else if (dim === 'month') {
    const cursor = parseDateParam(`${monthKey(start)}-01`);
    const stop = parseDateParam(end);
    while (cursor <= stop) {
      keys.push(formatDateParam(cursor).slice(0, 7));
      cursor.setMonth(cursor.getMonth() + 1, 1);
    }
  } else if (dim === 'weekday') {
    return [...WEEKDAYS];
  }
  return keys;
}

/** Calendar days a bucket covers inside the range (for per-day metrics). */
function bucketDays(dim, key, start, end) {
  if (dim === 'date') return 1;
  if (dim === 'week' || dim === 'month') {
    const from = dim === 'week' ? key : `${key}-01`;
    const toDate = parseDateParam(from);
    if (dim === 'week') toDate.setDate(toDate.getDate() + 6);
    else toDate.setMonth(toDate.getMonth() + 1, 0);
    const to = formatDateParam(toDate);
    const lo = from > start ? from : start;
    const hi = to < end ? to : end;
    return hi < lo ? 0 : dayCount(lo, hi);
  }
  if (dim === 'weekday') {
    const wanted = WEEKDAYS.indexOf(key);
    let count = 0;
    for (let day = start; day <= end; day = shiftIso(day, 1)) if (parseDateParam(day).getDay() === wanted) count += 1;
    return count;
  }
  return dayCount(start, end);
}

function cleanList(value) {
  return [...new Set((Array.isArray(value) ? value : value ? [value] : []).map((item) => String(item || '').trim()).filter(Boolean))];
}

/**
 * Validate the request. Returns { error } (plain refusal) or
 * { refusal } (structured: what was unsupported and what is available) or
 * the parsed plan.
 */
export function planMetricsQuery(args) {
  const metrics = cleanList(args?.metrics);
  if (!metrics.length) return { error: `Name at least one metric: ${METRIC_KEYS.join(', ')}.` };
  const unknown = metrics.filter((key) => !METRICS[key]);
  if (unknown.length) {
    return {
      refusal: {
        unsupported: unknown.map((key) => ({ metric: key, reason: 'not a metric' })),
        availableMetrics: METRIC_KEYS,
        hint: 'Pick metrics from availableMetrics. For a number that is not here, lookup_company_data may hold it.',
      },
    };
  }
  const groupBy = String(args?.groupBy || 'none').trim() || 'none';
  const splitBy = String(args?.splitBy || '').trim();
  if (!DIMENSIONS.includes(groupBy)) return { error: `groupBy must be one of ${DIMENSIONS.join(', ')}.` };
  if (splitBy && (!DIMENSIONS.includes(splitBy) || splitBy === groupBy || splitBy === 'none')) {
    return { error: `splitBy must be a different dimension from groupBy: ${DIMENSIONS.filter((dim) => dim !== 'none').join(', ')}.` };
  }
  const dims = [groupBy, splitBy].filter((dim) => dim && dim !== 'none');
  const unsupported = metrics
    .map((key) => ({ metric: key, dimensions: unsupportedDimensions(key, dims) }))
    .filter((item) => item.dimensions.length);
  if (unsupported.length) {
    return {
      refusal: {
        unsupported: unsupported.map((item) => ({
          metric: item.metric,
          cannotGroupBy: item.dimensions,
          available: FACTS[METRICS[item.metric].fact].dimensions,
          reason: FACTS[METRICS[item.metric].fact].note || `${FACTS[METRICS[item.metric].fact].label} has no ${item.dimensions.join(' or ')}.`,
        })),
        hint: 'Ask again with a supported groupBy, or drop that metric. Do not estimate the missing grain.',
      },
    };
  }
  const facts = [...new Set(metrics.map((key) => METRICS[key].fact))];
  const startDate = isoDate(args?.startDate);
  const endDate = isoDate(args?.endDate) || startDate;
  if (!startDate) {
    return { error: 'Pass startDate and endDate (YYYY-MM-DD): the dates the user named, or the dates from the earlier answer on a follow-up. If none were named, ask which dates.' };
  }
  const today = formatDateParam(new Date());
  let start = startDate;
  let end = endDate;
  if (start > end) [start, end] = [end, start];
  if (start > today) return { error: 'That range is in the future.' };
  if (end > today) end = today;
  const maxDays = Math.min(...facts.map((fact) => FACT_MAX_DAYS[fact] || 92));
  const days = dayCount(start, end);
  if (days > maxDays) {
    return {
      refusal: {
        unsupported: facts.filter((fact) => days > (FACT_MAX_DAYS[fact] || 92)).map((fact) => ({ fact, maxDays: FACT_MAX_DAYS[fact] })),
        hint: `That range is ${days} days. ${facts.map((fact) => `${FACTS[fact].label} can be read live for up to ${FACT_MAX_DAYS[fact]} days`).join('; ')}. Ask for a shorter range or group by week or month over a shorter span.`,
      },
    };
  }
  const stores = cleanList(args?.stores).map((name) => canonicalStoreName(name) || name);
  const employee = String(args?.employee || '').trim();
  const chart = ['line', 'bar', 'none'].includes(String(args?.chart || '')) ? String(args.chart) : groupBy === 'none' ? 'none' : TIME_DIMENSIONS.has(groupBy) ? 'line' : 'bar';
  return { metrics, groupBy, splitBy, dims, facts, startDate: start, endDate: end, stores, employee, chart, title: String(args?.title || '').trim() };
}

function employeeMatches(row, wanted) {
  if (!wanted) return true;
  const have = String(row.employee || '').toLowerCase();
  return wanted
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => have.includes(word));
}

/**
 * Run a planned query. `context.loadTickets(startDate, endDate)` returns POS
 * rows (the Analytics month cache); calls and hours load here.
 */
export async function runMetricsQuery(plan, context = {}) {
  const { metrics, groupBy, splitBy, facts, startDate, endDate, stores, employee } = plan;
  const notes = [];
  const errors = [];
  const factRows = {};
  // Stores a fact was actually read for. A store outside its coverage gets
  // null for that fact's metrics, not 0.
  const coverage = {};

  await Promise.all(
    facts.map(async (fact) => {
      try {
        if (fact === 'tickets') {
          if (typeof context.loadTickets !== 'function') throw new Error('Ticket loader unavailable.');
          context.onStatus?.(`Loading tickets ${rangeLabel(startDate, endDate)}…`);
          const rows = await context.loadTickets(startDate, endDate);
          factRows.tickets = ticketFactsFromRows(rows, { stores });
        } else if (fact === 'calls') {
          const loaded = await loadCallFacts({ startDate, endDate, stores, onProgress: context.onStatus });
          factRows.calls = loaded.rows;
          coverage.calls = loaded.coveredStores;
          errors.push(...loaded.errors);
        } else if (fact === 'hours') {
          const loaded = await loadHoursFacts(context.session, { startDate, endDate, stores, onProgress: context.onStatus });
          factRows.hours = loaded.rows;
          if (loaded.note) notes.push(loaded.note);
        }
      } catch (error) {
        if (context.signal?.aborted || error?.name === 'AbortError') throw error;
        factRows[fact] = [];
        errors.push(`${FACTS[fact].label}: ${error?.message || 'did not load'}`);
      }
    }),
  );
  if (context.signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });

  if (employee) {
    for (const fact of facts) factRows[fact] = (factRows[fact] || []).filter((row) => employeeMatches(row, employee));
  }

  // Bucket keys: every time key in range; otherwise the keys the facts have.
  let keys = timeKeys(groupBy, startDate, endDate);
  if (!keys.length) {
    const seen = new Set();
    for (const fact of facts) for (const row of factRows[fact] || []) seen.add(keyFor(row, groupBy));
    if (groupBy === 'store' && stores.length) for (const store of stores) seen.add(store);
    keys = [...seen].filter((key) => key && (groupBy !== 'store' || key !== '—' || !stores.length));
  }
  const splits = splitBy
    ? [...new Set(facts.flatMap((fact) => (factRows[fact] || []).map((row) => keyFor(row, splitBy))))].filter(Boolean)
    : [''];

  // Group each fact's rows once by (bucket, split).
  const grouped = {};
  for (const fact of facts) {
    const map = new Map();
    for (const row of factRows[fact] || []) {
      const key = `${keyFor(row, groupBy)}|${splitBy ? keyFor(row, splitBy) : ''}`;
      const bucket = map.get(key) || [];
      bucket.push(row);
      map.set(key, bucket);
    }
    grouped[fact] = map;
  }

  const cells = [];
  for (const key of keys) {
    const days = bucketDays(groupBy, key, startDate, endDate);
    for (const split of splits) {
      const cell = { key, split, label: labelFor(groupBy, key), days, values: {} };
      for (const metricKey of metrics) {
        const metric = METRICS[metricKey];
        const rows = grouped[metric.fact]?.get(`${key}|${split}`) || [];
        // Empty buckets: counts are 0 when the source was read for that
        // store (a day with no tickets is 0 transactions); ratios are null.
        const storeKey = groupBy === 'store' ? key : splitBy === 'store' ? split : '';
        const read = coverage[metric.fact];
        const covered = !read || (storeKey ? read.some((name) => storesMatch(name, storeKey)) : read.length > 0);
        cell.values[metricKey] = covered ? metric.agg(rows, { days }) : null;
      }
      cells.push(cell);
    }
  }

  // Order: time in calendar order; categories by the first metric, highest first.
  let ordered = cells;
  if (!TIME_DIMENSIONS.has(groupBy) && groupBy !== 'weekday' && groupBy !== 'none') {
    ordered = cells
      .slice()
      .sort((a, b) => (Number(b.values[metrics[0]]) || 0) - (Number(a.values[metrics[0]]) || 0))
      .slice(0, MAX_CATEGORY_ROWS * Math.max(1, splits.length));
  }
  if (TIME_DIMENSIONS.has(groupBy) && keys.length > MAX_POINTS) {
    return { error: `That range has ${keys.length} ${groupBy}s. Group by week or month, or ask for a shorter range.` };
  }

  const columns = [
    { key: groupBy === 'none' ? 'row' : groupBy, label: groupBy === 'none' ? 'Row' : groupBy, format: 'text' },
    ...(splitBy ? [{ key: splitBy, label: splitBy, format: 'text' }] : []),
    ...metrics.map((key) => ({ key, label: METRICS[key].label, format: METRICS[key].format })),
  ];
  const rows = ordered.map((cell) => {
    const row = { [columns[0].key]: cell.label };
    if (splitBy) row[splitBy] = cell.split;
    if (groupBy === 'date') row.isoDate = cell.key;
    if (groupBy === 'week') row.weekStart = cell.key;
    for (const metricKey of metrics) row[metricKey] = cell.values[metricKey] == null ? null : round(cell.values[metricKey]);
    return row;
  });

  const storeLabel = stores.length ? stores.join(', ') : 'All stores';
  const scope = `${storeLabel} · ${rangeLabel(startDate, endDate)}${employee ? ` · ${employee}` : ''}`;
  const title = plan.title || `${metrics.map((key) => METRICS[key].label).join(' and ')}${groupBy === 'none' ? '' : ` by ${groupBy}`}`;
  const resultId = rememberResult({ tool: 'query_metrics', title, scope, columns, rows });

  const nullMetrics = metrics.filter((key) => rows.some((row) => row[key] == null));
  if (nullMetrics.length) {
    notes.push(`null means no ${nullMetrics.map((key) => METRICS[key].label.toLowerCase()).join(' / ')} data for that ${groupBy}; it is a gap, not zero. Say so if it matters.`);
  }
  const sourceNotes = facts.map((fact) => FACTS[fact].note).filter(Boolean);
  notes.push(...sourceNotes);

  let chart = null;
  if (plan.chart !== 'none' && groupBy !== 'none' && ordered.length) {
    const categories = [...new Set(ordered.map((cell) => cell.label))];
    const series = [];
    for (const metricKey of metrics) {
      for (const split of splits) {
        if (series.length >= MAX_SERIES) break;
        const bySplit = ordered.filter((cell) => cell.split === split);
        series.push({
          key: `${metricKey}${split ? `:${split}` : ''}`,
          label: split ? `${METRICS[metricKey].label} · ${split}` : METRICS[metricKey].label,
          format: METRICS[metricKey].format,
          axis: metrics.indexOf(metricKey) === 0 ? 'left' : 'right',
          values: categories.map((label) => {
            const cell = bySplit.find((item) => item.label === label);
            return cell && cell.values[metricKey] != null ? round(cell.values[metricKey]) : null;
          }),
        });
      }
    }
    chart = { type: plan.chart, title, subtitle: scope, categories, series, resultId };
  }

  const shown = rows.slice(0, MAX_MODEL_ROWS).map((row) => {
    const out = {};
    for (const column of columns) out[column.key] = column.format === 'text' ? row[column.key] : row[column.key] == null ? null : formatMetricValue(row[column.key], column.format);
    if (row.isoDate) out.isoDate = row.isoDate;
    if (row.weekStart) out.weekStart = row.weekStart;
    return out;
  });
  const modelResult = {
    resultId,
    title,
    scope,
    groupBy,
    splitBy: splitBy || undefined,
    metrics: Object.fromEntries(metrics.map((key) => [key, `${METRICS[key].label} (${METRICS[key].format})`])),
    columns: columns.map((column) => column.key),
    rowCount: rows.length,
    rows: shown,
    truncated: rows.length > shown.length ? `${rows.length - shown.length} more rows in resultId ${resultId}` : undefined,
    drawn: chart ? chart.type : undefined,
    notes: notes.length ? notes : undefined,
    errors: errors.length ? errors : undefined,
    howToUse: chart
      ? 'The chart is on screen. Summarize in two or three sentences from these rows; say which points are null and why.'
      : `To draw these, call draw_chart with resultId ${resultId}, x = "${columns[0].key}", and the metric keys as series. To tabulate, call show_table with the same resultId.`,
  };
  return chart ? { chart, modelResult } : { modelResult };
}

function round(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

/** The query_metrics tool. */
export async function queryMetricsTool(args, context) {
  const plan = planMetricsQuery(args);
  if (plan.error) return { error: plan.error };
  if (plan.refusal) return { modelResult: { refused: true, ...plan.refusal } };
  return runMetricsQuery(plan, context);
}
