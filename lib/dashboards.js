import AsyncStorage from '@react-native-async-storage/async-storage';
import { askAnalytics, completeOpenRouter } from './analyticsChartTools';
import { storedChart } from './analyticsStoredChart';
import { getSupabase } from './supabase';
import { formatDateParam } from './transactions';

const DASHBOARD_COLUMNS = 'id, user_id, title, source_chat_id, position, created_at, updated_at';
const WIDGET_COLUMNS =
  'id, dashboard_id, user_id, position, title, question, kind, model, store_filter, snapshot, created_at, updated_at';

export const WIDGET_KINDS = ['chart', 'table', 'map', 'text', 'file'];
const MAX_WIDGETS_PER_SUBMIT = 12;
const MAX_QUESTION_CHARS = 2000;
const MAX_SNAPSHOT_TEXT = 1500;

const CACHE_KEY = 'cgold.dashboards.results';
const MAX_CACHE_ENTRIES = 80;
// Today's figures move all day; a finished day only changes when a ticket is
// edited after the fact, so it can sit longer.
const FRESH_TODAY_MS = 15 * 60 * 1000;
const FRESH_PAST_MS = 12 * 60 * 60 * 1000;

function asString(value) {
  return String(value ?? '').trim();
}

function mapWidget(row) {
  if (!row?.id) return null;
  const snapshot = row.snapshot && typeof row.snapshot === 'object' ? row.snapshot : {};
  return {
    id: row.id,
    dashboardId: row.dashboard_id,
    position: Number(row.position) || 0,
    title: asString(row.title) || 'Card',
    question: asString(row.question),
    kind: WIDGET_KINDS.includes(row.kind) ? row.kind : 'text',
    model: asString(row.model),
    storeFilter: asString(row.store_filter),
    snapshot: {
      text: asString(snapshot.text).slice(0, MAX_SNAPSHOT_TEXT),
      charts: (Array.isArray(snapshot.charts) ? snapshot.charts : []).map(storedChart).filter(Boolean),
      date: asString(snapshot.date),
      question: asString(snapshot.question),
    },
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

function mapDashboard(row, widgets) {
  if (!row?.id) return null;
  return {
    id: row.id,
    title: asString(row.title) || 'Dashboard',
    sourceChatId: asString(row.source_chat_id),
    position: Number(row.position) || 0,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    widgets: (widgets || []).slice().sort((a, b) => a.position - b.position || String(a.createdAt).localeCompare(String(b.createdAt))),
  };
}

async function currentUserId() {
  const supabase = getSupabase();
  const { data } = await supabase.auth.getSession();
  const id = asString(data?.session?.user?.id);
  if (!id) throw new Error('Sign in again to use Dashboards.');
  return id;
}

export async function listDashboards() {
  const supabase = getSupabase();
  const [boards, widgets] = await Promise.all([
    supabase.from('dashboards').select(DASHBOARD_COLUMNS).order('position', { ascending: true }).order('created_at', { ascending: true }),
    supabase.from('dashboard_widgets').select(WIDGET_COLUMNS).order('position', { ascending: true }),
  ]);
  if (boards.error) throw boards.error;
  if (widgets.error) throw widgets.error;
  const byBoard = new Map();
  for (const row of widgets.data || []) {
    const widget = mapWidget(row);
    if (!widget) continue;
    if (!byBoard.has(widget.dashboardId)) byBoard.set(widget.dashboardId, []);
    byBoard.get(widget.dashboardId).push(widget);
  }
  return (boards.data || []).map((row) => mapDashboard(row, byBoard.get(row.id))).filter(Boolean);
}

export async function renameDashboard(id, title) {
  const next = asString(title).slice(0, 80);
  if (!next) throw new Error('Give the dashboard a name.');
  const supabase = getSupabase();
  const { error } = await supabase
    .from('dashboards')
    .update({ title: next, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
  return next;
}

/** Removes a tab and its cards. User action from the tab menu. */
export async function deleteDashboard(id) {
  const key = asString(id);
  if (!key) return;
  const supabase = getSupabase();
  const { error } = await supabase.from('dashboards').delete().eq('id', key);
  if (error) throw error;
}

/** Removes one card from a tab. User action from the card's menu. */
export async function removeDashboardWidget(id) {
  const key = asString(id);
  if (!key) return;
  const supabase = getSupabase();
  const { error } = await supabase.from('dashboard_widgets').delete().eq('id', key);
  if (error) throw error;
}

export async function updateDashboardWidget(id, { title, question }) {
  const patch = { updated_at: new Date().toISOString() };
  if (title != null) {
    const next = asString(title).slice(0, 120);
    if (!next) throw new Error('Give the card a title.');
    patch.title = next;
  }
  if (question != null) {
    const next = asString(question).slice(0, MAX_QUESTION_CHARS);
    if (!next) throw new Error('The card needs a question.');
    patch.question = next;
  }
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('dashboard_widgets')
    .update(patch)
    .eq('id', id)
    .select(WIDGET_COLUMNS)
    .maybeSingle();
  if (error) throw error;
  return mapWidget(data);
}

// ---------------------------------------------------------------------------
// Building a dashboard from checked answers

export function widgetKindForCharts(charts) {
  const list = Array.isArray(charts) ? charts : [];
  if (list.some((chart) => chart?.type === 'map')) return 'map';
  if (list.some((chart) => chart?.type === 'line' || chart?.type === 'bar' || chart?.type === 'pie')) return 'chart';
  if (list.some((chart) => chart?.type === 'table')) return 'table';
  if (list.some((chart) => chart?.type === 'file')) return 'file';
  return 'text';
}

/** Indexes of assistant turns that can become a card (an answer with content). */
export function dashboardableTurnIndexes(turns) {
  const out = [];
  (turns || []).forEach((turn, index) => {
    if (turn?.role !== 'assistant') return;
    const hasText = asString(turn.content).length > 0;
    const hasCharts = Array.isArray(turn.charts) && turn.charts.length > 0;
    if (hasText || hasCharts) out.push(index);
  });
  return out;
}

function questionBefore(turns, index) {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    if (turns[cursor]?.role === 'user' && asString(turns[cursor].content)) return asString(turns[cursor].content);
  }
  return '';
}

function shortTitle(text, fallback) {
  const cleaned = asString(text).replace(/\s+/g, ' ');
  if (!cleaned) return fallback;
  return cleaned.length <= 60 ? cleaned : `${cleaned.slice(0, 59).trim()}…`;
}

function fallbackWidgetTitle(turn, question) {
  const chart = (turn.charts || []).find((item) => asString(item?.title));
  if (chart) return shortTitle(chart.title, 'Card');
  return shortTitle(question.replace(/[?]+$/, ''), 'Card');
}

function parseJsonBlock(text) {
  const raw = String(text || '').trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : raw;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * One model call turns each checked answer into a question that stands on its
 * own (a follow-up like "same for Laval" needs the earlier context folded in)
 * with relative dates kept relative, and names the tab after what the cards
 * show. Falls back to the typed questions when the model is unavailable.
 */
async function describeCards({ turns, indexes, model, chatTitle, signal }) {
  const drafts = indexes.map((index, order) => {
    const turn = turns[index];
    const question = questionBefore(turns, index);
    const earlier = turns
      .slice(Math.max(0, index - 6), index)
      .filter((item) => item.role === 'user' && asString(item.content))
      .map((item) => asString(item.content))
      .slice(-3);
    return {
      n: order + 1,
      question,
      earlierQuestions: earlier.filter((item) => item !== question),
      answer: asString(turn.content).slice(0, 400),
      kind: widgetKindForCharts(turn.charts),
      chartTitles: (turn.charts || []).map((chart) => [chart?.title, chart?.subtitle].filter(Boolean).join(' — ')).filter(Boolean),
    };
  });
  const fallback = {
    title: shortTitle(chatTitle, 'Dashboard'),
    cards: drafts.map((draft, order) => ({
      question: draft.question || draft.chartTitles[0] || 'Summarize this',
      title: fallbackWidgetTitle(turns[indexes[order]], draft.question),
    })),
  };
  if (!model) return fallback;
  try {
    const message = await completeOpenRouter({
      model,
      maxTokens: 1200,
      signal,
      messages: [
        {
          role: 'user',
          content: `These answers from an analytics chat are being pinned to a dashboard. The dashboard has a date picker, and each card is re-asked for whatever date is picked, so every question has to stand alone and keep its dates relative.

For each card write:
- "question": one self-contained request the analytics assistant can answer with no other context. Fold in anything the person relied on from earlier questions (store, product, employee, grouping). Keep relative periods relative: say "today", "yesterday", "this week", "this month", "the past 30 days", never a calendar date. If the original named a specific calendar period, keep that period. Name the form of answer the original got: "as a bar chart", "as a line chart", "as a pie chart", "as a table", "on a map", or, for a plain reply, "in one or two sentences".
- "title": 2 to 6 words naming what the card shows (the data, not the question). No dates. No quotes.

Then "dashboardTitle": 2 to 5 words naming what this set of cards represents, like "Montreal daily pulse" or "Staffing and volume". No dates. No quotes.

Reply with JSON only: {"dashboardTitle": "...", "cards": [{"n": 1, "question": "...", "title": "..."}]}

Chat title: ${chatTitle || '(none)'}

Cards:
${JSON.stringify(drafts, null, 1)}`,
        },
      ],
    });
    const parsed = parseJsonBlock(message?.content);
    if (!parsed || !Array.isArray(parsed.cards)) return fallback;
    const byN = new Map(parsed.cards.map((card) => [Number(card?.n), card]));
    return {
      title: shortTitle(parsed.dashboardTitle, fallback.title),
      cards: drafts.map((draft, order) => {
        const card = byN.get(draft.n) || {};
        return {
          question: asString(card.question).slice(0, MAX_QUESTION_CHARS) || fallback.cards[order].question,
          title: shortTitle(card.title, fallback.cards[order].title),
        };
      }),
    };
  } catch {
    return fallback;
  }
}

/**
 * Creates a tab from the checked answers of a chat. Each card keeps the model
 * and store lock the chat used so the refresh asks the same way.
 */
export async function createDashboardFromAnswers({
  turns,
  indexes,
  model,
  chatId,
  chatTitle,
  storeFilter,
  signal,
}) {
  const list = Array.isArray(turns) ? turns : [];
  const picked = [...new Set((Array.isArray(indexes) ? indexes : []).map(Number))]
    .filter((index) => list[index]?.role === 'assistant')
    .sort((a, b) => a - b)
    .slice(0, MAX_WIDGETS_PER_SUBMIT);
  if (!picked.length) throw new Error('Check at least one answer.');

  const userId = await currentUserId();
  const described = await describeCards({ turns: list, indexes: picked, model, chatTitle, signal });
  const today = formatDateParam(new Date());
  const now = new Date().toISOString();
  const supabase = getSupabase();

  const { data: existing } = await supabase
    .from('dashboards')
    .select('position')
    .order('position', { ascending: false })
    .limit(1);
  const position = (Number(existing?.[0]?.position) || 0) + 1;

  const { data: board, error: boardError } = await supabase
    .from('dashboards')
    .insert({
      user_id: userId,
      title: described.title,
      source_chat_id: asString(chatId).slice(0, 80),
      position,
      created_at: now,
      updated_at: now,
    })
    .select(DASHBOARD_COLUMNS)
    .single();
  if (boardError) throw boardError;

  const rows = picked.map((index, order) => {
    const turn = list[index];
    const card = described.cards[order];
    return {
      dashboard_id: board.id,
      user_id: userId,
      position: order,
      title: card.title,
      question: card.question,
      kind: widgetKindForCharts(turn.charts),
      model: asString(model).slice(0, 80),
      store_filter: asString(storeFilter).slice(0, 80),
      snapshot: {
        text: asString(turn.content).slice(0, MAX_SNAPSHOT_TEXT),
        charts: (turn.charts || []).map(storedChart).filter(Boolean).slice(0, 2),
        date: today,
        question: questionBefore(list, index).slice(0, 400),
      },
      created_at: now,
      updated_at: now,
    };
  });
  const { data: widgets, error: widgetError } = await supabase
    .from('dashboard_widgets')
    .insert(rows)
    .select(WIDGET_COLUMNS);
  if (widgetError) throw widgetError;
  return mapDashboard(board, (widgets || []).map(mapWidget).filter(Boolean));
}

// ---------------------------------------------------------------------------
// Running cards for a date

const KIND_INSTRUCTIONS = {
  chart:
    'This is a saved dashboard card. Answer by drawing the chart (bar, line, or pie as the question says) with a title and a subtitle that name the dates and stores it covers, a label on every series and axis, and then one short sentence.',
  table:
    'This is a saved dashboard card. Answer with show_table (labeled columns, a title and subtitle that name the dates and stores it covers), then one short sentence.',
  map:
    'This is a saved dashboard card. Answer with the customer map (a title and subtitle that name the dates and stores it covers), then one short sentence.',
  file:
    'This is a saved dashboard card. Answer with a table on screen (show_table with labeled columns and a title that names the dates and stores) rather than a file, then one short sentence.',
  text:
    'This is a saved dashboard card. Answer in one to three plain sentences that name the date it covers and quote the figures or names. No chart unless the question asks for one.',
};

export function widgetInstructions(kind) {
  return KIND_INSTRUCTIONS[kind] || KIND_INSTRUCTIONS.text;
}

/** Re-asks a card's question with the dashboard date as "today". */
export async function runDashboardWidget(widget, { date, session, mapsKey, signal, onStatus }) {
  const question = asString(widget?.question);
  if (!question) throw new Error('This card has no question.');
  const model = asString(widget?.model);
  if (!model) throw new Error('This card has no model saved.');
  const result = await askAnalytics({
    model,
    history: [],
    question,
    attachments: [],
    storeFilter: widget.storeFilter || undefined,
    session,
    mapsKey,
    signal,
    onStatus,
    asOfDate: date,
    instructions: widgetInstructions(widget.kind),
    requireTool: widget.kind !== 'text',
  });
  return {
    text: asString(result?.text),
    charts: (result?.charts || []).map(storedChart).filter(Boolean).slice(0, 2),
    ranAt: new Date().toISOString(),
    date,
  };
}

// ---------------------------------------------------------------------------
// Local cache of results per card and date

function cacheKey(userKey) {
  return `${CACHE_KEY}.${userKey || 'local'}`;
}

function entryKey(widgetId, date) {
  return `${widgetId}|${date}`;
}

export async function loadDashboardCache(userKey) {
  try {
    const raw = await AsyncStorage.getItem(cacheKey(userKey));
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function cachedResult(cache, widgetId, date) {
  const entry = cache?.[entryKey(widgetId, date)];
  if (!entry || typeof entry !== 'object') return null;
  return entry;
}

export function isFreshResult(entry, date) {
  if (!entry?.ranAt) return false;
  const age = Date.now() - Date.parse(entry.ranAt);
  if (!Number.isFinite(age)) return false;
  const today = formatDateParam(new Date());
  return age < (date >= today ? FRESH_TODAY_MS : FRESH_PAST_MS);
}

export function withCachedResult(cache, widgetId, date, result) {
  const next = { ...(cache || {}) };
  next[entryKey(widgetId, date)] = {
    text: asString(result?.text).slice(0, MAX_SNAPSHOT_TEXT),
    charts: (result?.charts || []).map(storedChart).filter(Boolean).slice(0, 2),
    ranAt: result?.ranAt || new Date().toISOString(),
    date,
  };
  const keys = Object.keys(next);
  if (keys.length > MAX_CACHE_ENTRIES) {
    keys
      .sort((a, b) => String(next[a]?.ranAt || '').localeCompare(String(next[b]?.ranAt || '')))
      .slice(0, keys.length - MAX_CACHE_ENTRIES)
      .forEach((key) => {
        delete next[key];
      });
  }
  return next;
}

export function withoutWidgetResults(cache, widgetIds) {
  const drop = new Set((widgetIds || []).map(String));
  const next = {};
  for (const [key, value] of Object.entries(cache || {})) {
    if (!drop.has(key.split('|')[0])) next[key] = value;
  }
  return next;
}

export async function saveDashboardCache(userKey, cache) {
  try {
    await AsyncStorage.setItem(cacheKey(userKey), JSON.stringify(cache || {}));
  } catch {
    // The cache is a convenience; the cards still run without it.
  }
}

export function formatRanAt(iso) {
  const time = Date.parse(iso || '');
  if (!Number.isFinite(time)) return '';
  const when = new Date(time);
  const today = formatDateParam(new Date());
  const day = formatDateParam(when);
  const clock = when.toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' });
  if (day === today) return `Updated ${clock}`;
  return `Updated ${when.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })} ${clock}`;
}
