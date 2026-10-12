import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { ANALYTICS_CHAT_MODELS, askAnalytics, completeOpenRouter } from '../lib/analyticsChartTools';
import { loadGoogleMapsBrowserKey } from '../lib/aiKeys';
import {
  addUsage,
  cachedOpenRouterPrices,
  formatModelRates,
  formatTokenCount,
  formatUsd,
  loadOpenRouterPrices,
  modelRates,
  priceUsage,
  storedUsage,
} from '../lib/openrouterPricing';
import {
  DIMENSIONS,
  MEASURES,
  formatMeasure,
  measureMeta,
} from '../lib/employeeMetrics';
import { formatDateParam, parseDateParam, parseDocReference } from '../lib/transactions';
import AnalyticsChartCard from './AnalyticsChartCard';
import AnalyticsMapCard from './AnalyticsMapCard';
import AnalyticsTableCard from './AnalyticsTableCard';
import { CANVAS, NAV_TAB_ACTIVE_BG, NAV_TAB_ACTIVE_RADIUS } from '../lib/mobileUi';
import { FONT, FONT_EXTRALIGHT } from '../lib/typography';

const MODEL_KEY = 'cgold.analytics.aiModel';

const INK = '#1a1a1a';
const CHIP_BORDER = '#d0d0d0';
const CHIP_RADIUS = 6;
const BUBBLE_RADIUS = 18;
const RULE = 'rgba(42,38,30,0.08)';
const SECONDARY = '#8e8e93';
const BUBBLE_THEM_BG = '#ffffff';
const BUBBLE_THEM_BORDER = 'rgba(60, 60, 67, 0.12)';

/** Friendly copy for the model sheet — keys match ANALYTICS_CHAT_MODELS. */
const MODEL_META = {
  'anthropic/claude-sonnet-5': { tag: 'Recommended', blurb: 'Best default for charts, maps, and follow-up questions.' },
  'anthropic/claude-sonnet-4.6': { tag: 'Detailed', blurb: 'Extra thorough when you want a deeper read.' },
  'anthropic/claude-haiku-4.5': { tag: 'Fast', blurb: 'Quick answers with lower cost.' },
  'x-ai/grok-4.7': { tag: 'Grok · latest', blurb: 'Strong general reasoning from xAI.' },
  'x-ai/grok-4.6': { tag: 'Grok', blurb: 'Previous Grok generation.' },
  'x-ai/grok-4.20': { tag: 'Grok · value', blurb: 'Lower cost Grok for simpler questions.' },
  'x-ai/grok-4.3': { tag: 'Grok · value', blurb: 'Lower cost Grok for simpler questions.' },
  'openai/gpt-4.1': { tag: 'GPT · full', blurb: 'OpenAI flagship for complex asks.' },
  'openai/gpt-4.1-mini': { tag: 'Balanced', blurb: 'Good quality at a moderate price.' },
  'openai/gpt-4o-mini': { tag: 'Budget', blurb: 'Lightest OpenAI option.' },
};

const START_HERE_KEYS = [
  'anthropic/claude-sonnet-5',
  'openai/gpt-4.1-mini',
  'anthropic/claude-haiku-4.5',
];

function modelPickerSections() {
  const start = new Set(START_HERE_KEYS);
  const rest = ANALYTICS_CHAT_MODELS.map((item) => item.key).filter((key) => !start.has(key));
  return [
    { title: 'Start here', keys: START_HERE_KEYS },
    ...(rest.length ? [{ title: 'More models', keys: rest }] : []),
  ];
}
const CHIP_SHADOW = Platform.select({
  web: { boxShadow: '0 1px 2px rgba(0,0,0,0.05)' },
  default: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 2,
    elevation: 1,
  },
});
const CHATS_KEY = 'cgold.analytics.aiChats';
const MAX_CHATS = 20;
const MAX_TURNS = 20;
const MAX_TURN_CHARS = 6000;
const MAX_ROWS = 80;

const ROW_NOTE = {
  employee: 'Each row is one employee. store is their home store when known.',
  store: 'Each row is one store.',
  role: 'Each row is one job role.',
  weekday: 'Each row is a day of the week across this range.',
  date: 'Each row is a calendar date.',
  txType: 'Each row is Buy or Sell.',
};

function storageKey(userKey) {
  return `${CHATS_KEY}.${userKey || 'local'}`;
}

function chatId() {
  return `ai-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function fallbackTitle(question) {
  const cleaned = String(question || '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return 'New analysis';
  if (cleaned.length <= 42) return cleaned;
  return `${cleaned.slice(0, 41).trim()}…`;
}

function shortRange(start, end) {
  const from = parseDateParam(start);
  const to = parseDateParam(end);
  const sameDay = formatDateParam(from) === formatDateParam(end);
  const endLabel = to.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' });
  if (sameDay) return endLabel;
  const startLabel = from.toLocaleDateString('en-CA', {
    month: 'short',
    day: 'numeric',
    year: from.getFullYear() === to.getFullYear() ? undefined : 'numeric',
  });
  return `${startLabel} – ${endLabel}`;
}

function chatTime(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (sameDay) return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function storedChart(chart) {
  if (!chart || typeof chart !== 'object') return null;
  const title = String(chart.title || '').slice(0, 80);
  const subtitle = String(chart.subtitle || '').slice(0, 80);
  if ((chart.type === 'line' || chart.type === 'bar') && Array.isArray(chart.categories) && Array.isArray(chart.series)) {
    return {
      type: chart.type,
      title,
      subtitle,
      categories: chart.categories.slice(0, 92).map((item) => String(item).slice(0, 24)),
      series: chart.series.slice(0, 8).map((series) => ({
        key: String(series.key || ''),
        label: String(series.label || '').slice(0, 40),
        format: ['money', 'decimal', 'hours'].includes(series.format) ? series.format : 'int',
        axis: series.axis === 'right' ? 'right' : 'left',
        values: (series.values || []).slice(0, 92).map((value) => Number(value) || 0),
      })),
    };
  }
  if (chart.type === 'pie' && Array.isArray(chart.slices)) {
    return {
      type: 'pie',
      title,
      subtitle,
      format: ['money', 'decimal', 'hours'].includes(chart.format) ? chart.format : 'int',
      slices: chart.slices.slice(0, 12).map((slice) => ({
        name: String(slice.name || '').slice(0, 40),
        value: Number(slice.value) || 0,
      })),
    };
  }
  if (chart.type === 'table' && Array.isArray(chart.columns) && Array.isArray(chart.rows)) {
    const columns = chart.columns
      .slice(0, 8)
      .map((column) => ({
        key: String(column?.key || '').slice(0, 40),
        label: String(column?.label || '').slice(0, 40),
        format: ['int', 'decimal', 'money', 'hours'].includes(column?.format) ? column.format : 'text',
      }))
      .filter((column) => column.key);
    if (!columns.length) return null;
    const cell = (value, format) => {
      if (value == null) return '';
      if (format === 'text') return String(value).slice(0, 80);
      return Number.isFinite(Number(value)) ? Number(value) : String(value).slice(0, 80);
    };
    const pick = (row) =>
      row && typeof row === 'object'
        ? Object.fromEntries(columns.map((column) => [column.key, cell(row[column.key], column.format)]))
        : null;
    const footer = chart.footer && typeof chart.footer === 'object' ? pick(chart.footer) : null;
    return {
      type: 'table',
      title,
      subtitle,
      columns,
      rows: chart.rows.slice(0, 60).map(pick).filter(Boolean),
      footer: footer || undefined,
      note: String(chart.note || '').slice(0, 160) || undefined,
      tickets: (Array.isArray(chart.tickets) ? chart.tickets : [])
        .slice(0, 60)
        .map((ticket) => ({
          reference: String(ticket?.reference || '').slice(0, 24),
          type: ticket?.type === 'purchase' ? 'purchase' : 'order',
          sourceId: String(ticket?.sourceId || '').slice(0, 24),
          systemKey: String(ticket?.systemKey || 'east').slice(0, 16),
        }))
        .filter((ticket) => ticket.sourceId),
    };
  }
  if (chart.type === 'map' && (Array.isArray(chart.markers) || Array.isArray(chart.areas))) {
    // Street lines are not kept in saved chats; the popup falls back to postal code and city.
    return {
      type: 'map',
      style: ['heat', 'area'].includes(chart.style) ? chart.style : 'dots',
      title,
      subtitle,
      city: String(chart.city || '').slice(0, 40),
      note: String(chart.note || '').slice(0, 160),
      areas: (Array.isArray(chart.areas) ? chart.areas : []).slice(0, 5).map((area) => ({
        name: String(area?.name || '').slice(0, 60),
        lat: Number(area?.lat),
        lng: Number(area?.lng),
        approximate: area?.approximate ? true : undefined,
        rings: (Array.isArray(area?.rings) ? area.rings : [])
          .slice(0, 12)
          .map((ring) =>
            (Array.isArray(ring) ? ring : [])
              .slice(0, 400)
              .map((pair) => [Number(pair?.[0]), Number(pair?.[1])])
              .filter((pair) => Number.isFinite(pair[0]) && Number.isFinite(pair[1])),
          )
          .filter((ring) => ring.length >= 3),
      })),
      missingPostal: Number(chart.missingPostal) || 0,
      unplaced: Number(chart.unplaced) || 0,
      markers: (Array.isArray(chart.markers) ? chart.markers : [])
        .slice(0, 1500)
        .map((marker) => ({
          lat: Number(marker.lat),
          lng: Number(marker.lng),
          label: String(marker.label || '').slice(0, 16),
          city: String(marker.city || '').slice(0, 40),
          count: Number(marker.count) || 0,
          customers: (Array.isArray(marker.customers) ? marker.customers : [])
            .slice(0, 12)
            .map((customer) => ({
              id: String(customer?.id || '').slice(0, 40),
              systemKey: String(customer?.systemKey || '').slice(0, 16),
              name: String(customer?.name || '').slice(0, 60),
              transactions: Number(customer?.transactions) || 0,
            }))
            .filter((customer) => customer.id),
        }))
        .filter((marker) => Number.isFinite(marker.lat) && Number.isFinite(marker.lng)),
    };
  }
  return null;
}

function storedTurns(turns) {
  return (Array.isArray(turns) ? turns : [])
    .map((turn) => {
      if (turn?.role !== 'user' && turn?.role !== 'assistant') return null;
      const content = String(turn.content || '').trim().slice(0, MAX_TURN_CHARS);
      const charts = (Array.isArray(turn.charts) ? turn.charts : []).map(storedChart).filter(Boolean).slice(0, 2);
      if (!content && !charts.length) return null;
      const usage = storedUsage(turn.usage);
      const next = charts.length ? { role: turn.role, content, charts } : { role: turn.role, content };
      return usage ? { ...next, usage } : next;
    })
    .filter(Boolean)
    .slice(-MAX_TURNS);
}

function parseChats(raw) {
  try {
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return list
      .map((item) => ({
        id: String(item?.id || ''),
        title: String(item?.title || 'New analysis').slice(0, 80),
        scopeLabel: String(item?.scopeLabel || ''),
        createdAt: String(item?.createdAt || ''),
        updatedAt: String(item?.updatedAt || item?.createdAt || ''),
        turns: storedTurns(item?.turns),
      }))
      .filter((chat) => chat.id && chat.turns.some((turn) => turn.role === 'user'));
  } catch {
    return [];
  }
}

async function loadChats(userKey) {
  try {
    const rows = parseChats(await AsyncStorage.getItem(storageKey(userKey)));
    return rows.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  } catch {
    return [];
  }
}

async function writeChats(userKey, chats) {
  const slim = (Array.isArray(chats) ? chats : [])
    .map((chat) => ({
      id: chat.id,
      title: String(chat.title || 'New analysis').slice(0, 80),
      scopeLabel: String(chat.scopeLabel || ''),
      createdAt: chat.createdAt,
      updatedAt: chat.updatedAt,
      turns: storedTurns(chat.turns),
    }))
    .filter((chat) => chat.id && chat.turns.some((turn) => turn.role === 'user'))
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
    .slice(0, MAX_CHATS);
  await AsyncStorage.setItem(storageKey(userKey), JSON.stringify(slim));
}

function measureMap(bucket) {
  return Object.fromEntries(
    MEASURES.map((item) => [item.label, formatMeasure(bucket?.[item.key], item.format)]),
  );
}

// The reply stays on the breakdown in front of them. Search still does company-wide lookup.
function buildBrief({ pivot, measure, groupBy, startDate, endDate, storeFilter, eventCount, warning }) {
  const measureInfo = measureMeta(measure);
  const groupLabel = DIMENSIONS.find((item) => item.key === groupBy)?.label || 'Employee';
  const chronological = groupBy === 'date' || groupBy === 'weekday';
  const all = Array.isArray(pivot?.rows) ? pivot.rows : [];
  const shown = chronological ? all.slice(-MAX_ROWS) : all.slice(0, MAX_ROWS);
  const omitted = all.length - shown.length;
  const rows = shown.map((row, index) => {
    const entry = {
      name: row.key,
      ...measureMap(row.total),
    };
    if (!chronological) entry.rank = index + 1;
    if (row.role) entry.role = row.role;
    if (row.store) entry.store = row.store;
    return entry;
  });
  const definitions = Object.fromEntries(
    MEASURES.filter((item) => item.hint).map((item) => [item.label, item.hint]),
  );
  return {
    view: {
      from: startDate,
      to: endDate,
      store: storeFilter || 'All stores',
      groupedBy: groupLabel,
      highlightedMeasure: measureInfo.label,
      order: chronological ? 'chronological' : `highest ${measureInfo.label} first`,
      events: eventCount,
      rowMeans: ROW_NOTE[groupBy] || '',
      warning: warning || undefined,
    },
    definitions,
    grand: measureMap(pivot?.grand),
    rows,
    omittedEarlierRows: chronological && omitted > 0 ? omitted : undefined,
    omittedLowerRows: !chronological && omitted > 0 ? omitted : undefined,
  };
}

function isAbort(error) {
  return error?.name === 'AbortError' || /aborted/i.test(String(error?.message || ''));
}

async function nameChat(turns, model) {
  const usable = (turns || []).filter((turn) => String(turn?.content || '').trim());
  const first = usable.find((turn) => turn.role === 'user');
  if (!first || !model) return { title: '', usage: null };
  const transcript = usable
    .slice(0, 6)
    .map((turn) => `${turn.role === 'user' ? 'User' : 'AI'}: ${String(turn.content).slice(0, 240)}`)
    .join('\n');
  try {
    const message = await completeOpenRouter({
      model,
      maxTokens: 40,
      messages: [
        {
          role: 'user',
          content: `Write a chat title in 3 to 6 words. No quotes. No period. Name the analysis topic.\n\n${transcript}`,
        },
      ],
    });
    const line = String(message?.content || '')
      .split('\n')[0]
      .replace(/^["'`]+|["'`.]+$/g, '')
      .trim();
    return { title: (line || fallbackTitle(first.content)).slice(0, 80), usage: message?.usage || null };
  } catch {
    return { title: '', usage: null };
  }
}

function modelMeta(key) {
  return MODEL_META[key] || { tag: '', blurb: 'OpenRouter-hosted model.' };
}

function friendlyRates(rates) {
  const line = formatModelRates(rates);
  if (!line) return 'Pricing loads from OpenRouter when you are online.';
  return `${line} tokens`;
}

const DOC_REF_SPLIT = /(\b(?:SO|PO)\s*#?\s*\d+\b)/gi;
const DOC_REF_ANY = /\b(?:SO|PO)\s*#?\s*\d+\b/i;

/** PO#/SO# mentions become taps that open the ticket drawer. */
function TicketText({ text, style, resolveTicket, onOpenDocument }) {
  if (!onOpenDocument || !DOC_REF_ANY.test(String(text || ''))) {
    return (
      <Text selectable style={style}>
        {text}
      </Text>
    );
  }
  const parts = String(text || '').split(DOC_REF_SPLIT);
  return (
    <Text selectable style={style}>
      {parts.map((part, index) => {
        const parsed = index % 2 === 1 ? parseDocReference(part) : null;
        if (!parsed) return part;
        return (
          <Text
            key={`${parsed.key}-${index}`}
            accessibilityRole="link"
            onPress={() => onOpenDocument(resolveTicket(parsed))}
            style={styles.ticketLink}
          >
            {part}
          </Text>
        );
      })}
    </Text>
  );
}

// Tool results carry the POS system for each ticket; a bare mention in prose
// falls back to East, which is where the ids are unique anyway.
function ticketIndex(turns) {
  const index = new Map();
  for (const turn of turns || []) {
    for (const chart of turn?.charts || []) {
      for (const ticket of chart?.tickets || []) {
        const parsed = parseDocReference(ticket);
        if (parsed) index.set(parsed.key, { ...parsed, systemKey: ticket.systemKey || 'east' });
      }
    }
  }
  return index;
}

function turnCostLine(turn, side) {
  const usage = turn?.usage;
  if (!usage) return '';
  const mine = side === 'user';
  const amount = mine ? usage.promptCost : usage.completionCost ?? usage.cost;
  const tokens = mine ? usage.promptTokens : usage.completionTokens;
  const money = formatUsd(amount);
  const count = formatTokenCount(tokens);
  const unit = mine ? 'in' : 'out';
  if (money && count) return `${money} · ${count} ${unit}`;
  if (money) return money;
  if (count) return `${count} ${unit}`;
  return '';
}

export default function AnalyticsAiPanel({
  session,
  compact = false,
  active = true,
  onClose,
  startDate,
  endDate,
  groupBy,
  measure,
  storeFilter,
  pivot,
  rows = [],
  eventCount = 0,
  loading = false,
  dataError = '',
  warning = '',
  onOpenCustomer,
  onOpenDocument,
}) {
  const userKey = session?.supabaseUserId || session?.profile?.id || '';
  const [chats, setChats] = useState([]);
  const [ready, setReady] = useState(false);
  const [activeId, setActiveId] = useState(null);
  const [draft, setDraft] = useState('');
  const [busyId, setBusyId] = useState('');
  const [busyNote, setBusyNote] = useState('');
  const [error, setError] = useState('');
  const [mobileList, setMobileList] = useState(true);
  const [model, setModel] = useState(ANALYTICS_CHAT_MODELS[0].key);
  const [modelOpen, setModelOpen] = useState(false);
  const [mapsKey, setMapsKey] = useState('');
  const [prices, setPrices] = useState(() => cachedOpenRouterPrices());
  const pricesRef = useRef(prices);
  const chatsRef = useRef([]);
  const activeIdRef = useRef(null);
  const mountedRef = useRef(true);
  const revisionRef = useRef(0);
  const genRef = useRef(new Map());
  const abortsRef = useRef(new Map());
  const sendingRef = useRef(false);
  const writeChainRef = useRef(Promise.resolve());
  const openedEmptyRef = useRef(false);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);

  const measureInfo = measureMeta(measure);
  const scopeLabel = useMemo(() => {
    const groupLabel = DIMENSIONS.find((item) => item.key === groupBy)?.label || 'Employee';
    const store = storeFilter ? ` · ${storeFilter}` : '';
    return `${measureInfo.label} by ${groupLabel} · ${shortRange(startDate, endDate)}${store}`;
  }, [measureInfo.label, groupBy, startDate, endDate, storeFilter]);
  const suggestions = useMemo(
    () => [
      'Transactions per employee at Montreal over the past month',
      'Transactions and volume by day',
      'Volume by store as a pie chart',
      'Where do Montreal customers live?',
    ],
    [],
  );
  const waiting = loading && !eventCount;
  const blocked = !ready || waiting || (Boolean(dataError) && !eventCount);
  const history = useMemo(
    () =>
      chats
        .filter((chat) => chat.turns.some((turn) => turn.role === 'user' && String(turn.content || '').trim()))
        .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))),
    [chats],
  );
  const activeChat = history.find((chat) => chat.id === activeId) || null;
  const turns = (activeChat?.turns || []).filter((turn) => turn.role === 'user' || turn.role === 'assistant');
  const showList = compact && mobileList;
  const tail = turns[turns.length - 1]?.content || '';
  const tickets = useMemo(() => ticketIndex(turns), [turns]);
  const resolveTicket = (parsed) => {
    const known = tickets.get(parsed.key);
    return {
      type: parsed.type,
      sourceId: parsed.sourceId,
      reference: parsed.reference,
      systemKey: known?.systemKey || 'east',
    };
  };
  // Each exchange stores the same priced usage on both bubbles; count it once.
  const chatCost = turns.reduce(
    (sum, turn) => (turn.role === 'assistant' ? sum + (Number(turn.usage?.cost) || 0) : sum),
    0,
  );
  const chatTokens = turns.reduce(
    (sum, turn) =>
      turn.role === 'assistant'
        ? sum + (Number(turn.usage?.promptTokens) || 0) + (Number(turn.usage?.completionTokens) || 0)
        : sum,
    0,
  );

  const selectChat = (id) => {
    activeIdRef.current = id;
    setActiveId(id);
  };

  const scheduleWrite = () => {
    const key = userKey;
    writeChainRef.current = writeChainRef.current
      .then(() => writeChats(key, chatsRef.current))
      .catch(() => {
        if (mountedRef.current) setError('Could not save this chat on this device.');
      });
  };

  const commit = (updater, { persist = false } = {}) => {
    revisionRef.current += 1;
    const next = updater(chatsRef.current);
    chatsRef.current = next;
    if (mountedRef.current) setChats(next);
    if (persist) scheduleWrite();
    return next;
  };

  const bump = (id) => {
    const gen = (genRef.current.get(id) || 0) + 1;
    genRef.current.set(id, gen);
    abortsRef.current.get(id)?.abort();
    const controller = new AbortController();
    abortsRef.current.set(id, controller);
    return { gen, controller };
  };

  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(`${MODEL_KEY}.${userKey || 'local'}`).then((saved) => {
      if (alive && ANALYTICS_CHAT_MODELS.some((item) => item.key === saved)) setModel(saved);
    });
    loadGoogleMapsBrowserKey()
      .then((key) => {
        if (alive) setMapsKey(key);
      })
      .catch(() => {
        if (alive) setMapsKey('');
      });
    loadOpenRouterPrices(ANALYTICS_CHAT_MODELS.map((item) => item.key))
      .then((byId) => {
        if (!alive) return;
        pricesRef.current = byId;
        setPrices(byId);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [userKey]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    const seen = revisionRef.current;
    setReady(false);
    activeIdRef.current = null;
    setActiveId(null);
    setMobileList(true);
    setError('');
    loadChats(userKey).then((rows) => {
      if (!alive) return;
      setReady(true);
      if (revisionRef.current !== seen) return;
      chatsRef.current = rows;
      setChats(rows);
    });
    return () => {
      alive = false;
    };
  }, [userKey]);

  useEffect(() => {
    if (!ready || openedEmptyRef.current) return;
    openedEmptyRef.current = true;
    if (compact && chatsRef.current.length === 0) setMobileList(false);
  }, [ready, compact]);

  useEffect(() => {
    if (!active || showList || activeId) return undefined;
    if (Platform.OS !== 'web') return undefined;
    const timer = setTimeout(() => inputRef.current?.focus?.(), 60);
    return () => clearTimeout(timer);
  }, [active, showList, activeId]);

  useEffect(() => {
    if (!active || showList) return undefined;
    const frame = requestAnimationFrame(() => scrollRef.current?.scrollToEnd?.({ animated: true }));
    return () => cancelAnimationFrame(frame);
  }, [active, showList, activeId, turns.length, tail]);

  const startNew = () => {
    selectChat(null);
    setDraft('');
    setError('');
    setMobileList(false);
  };

  const openChat = (id) => {
    selectChat(id);
    setDraft('');
    setError('');
    setMobileList(false);
  };

  const removeChat = (id) => {
    bump(id);
    if (busyId === id) {
      sendingRef.current = false;
      setBusyId('');
    }
    commit((current) => current.filter((chat) => chat.id !== id), { persist: true });
    if (activeIdRef.current === id) {
      selectChat(null);
      setDraft('');
      setError('');
    }
  };

  const send = async (raw) => {
    const text = String(raw ?? draft).trim();
    if (!text || sendingRef.current) return;
    if (!session?.token) {
      setError('Sign in again to use AI.');
      return;
    }
    if (!model) {
      setError('Pick a model.');
      return;
    }
    if (!ready) {
      setError('Chats are still loading.');
      return;
    }
    if (waiting || (Boolean(dataError) && !eventCount)) {
      setError(dataError || 'This breakdown is still loading.');
      return;
    }

    const existing = activeIdRef.current
      ? chatsRef.current.find((chat) => chat.id === activeIdRef.current)
      : null;
    const priorUsers = (existing?.turns || []).filter((turn) => turn.role === 'user' && String(turn.content || '').trim()).length;
    const id = existing?.id || chatId();
    const nameThis = priorUsers === 0;
    const now = new Date().toISOString();
    const history = (existing?.turns || [])
      .filter((turn) => (turn.role === 'user' || turn.role === 'assistant') && String(turn.content || '').trim())
      .slice(-MAX_TURNS);
    const { gen, controller } = bump(id);
    sendingRef.current = true;
    setBusyId(id);
    setBusyNote('');
    setError('');
    setDraft('');
    selectChat(id);
    setMobileList(false);

    const nextChat = {
      id,
      title: existing?.title || fallbackTitle(text),
      scopeLabel: existing?.scopeLabel || scopeLabel,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      turns: [...history, { role: 'user', content: text }, { role: 'assistant', content: '' }],
    };
    commit((current) => {
      const rest = current.filter((chat) => chat.id !== id);
      return [nextChat, ...rest];
    }, { persist: true });

    try {
      const brief = buildBrief({
        pivot,
        measure,
        groupBy,
        startDate,
        endDate,
        storeFilter,
        eventCount,
        warning,
      });
      const result = await askAnalytics({
        model,
        history,
        question: text,
        scopeLabel,
        brief,
        rows,
        startDate,
        endDate,
        storeFilter,
        session,
        mapsKey,
        signal: controller.signal,
        onStatus: (label) => {
          if (genRef.current.get(id) !== gen || !mountedRef.current) return;
          setBusyNote(label);
        },
      });
      if (genRef.current.get(id) !== gen) return;
      const answer = String(result.text || '').trim();
      if (!answer) throw new Error('No answer came back. Try again.');
      const priced = priceUsage(result.usage, model, pricesRef.current);
      const userTurn = priced ? { role: 'user', content: text, usage: priced } : { role: 'user', content: text };
      const assistantTurn = priced
        ? { role: 'assistant', content: answer, charts: result.charts || [], usage: priced }
        : { role: 'assistant', content: answer, charts: result.charts || [] };
      const savedTurns = [...history, userTurn, assistantTurn];
      commit((current) =>
        current.map((chat) => (
          chat.id === id ? { ...chat, turns: savedTurns, updatedAt: new Date().toISOString() } : chat
        )),
      { persist: true });
      if (!nameThis) return;
      const named = await nameChat(savedTurns, model);
      if (named.usage) {
        const withTitle = priceUsage(addUsage(result.usage, named.usage), model, pricesRef.current);
        if (withTitle) {
          commit((current) =>
            current.map((chat) => {
              if (chat.id !== id) return chat;
              return {
                ...chat,
                turns: chat.turns.map((turn, index) => (
                  index >= chat.turns.length - 2 ? { ...turn, usage: withTitle } : turn
                )),
              };
            }),
          { persist: true });
        }
      }
      if (!named.title || genRef.current.get(id) !== gen) return;
      const currentTitle = chatsRef.current.find((chat) => chat.id === id)?.title;
      if (currentTitle && currentTitle !== fallbackTitle(text)) return;
      commit((current) =>
        current.map((chat) => (chat.id === id ? { ...chat, title: named.title } : chat)),
      { persist: true });
    } catch (err) {
      if (isAbort(err) || genRef.current.get(id) !== gen) return;
      commit((current) =>
        current.flatMap((chat) => {
          if (chat.id !== id) return [chat];
          const nextTurns = chat.turns.slice();
          const last = nextTurns[nextTurns.length - 1];
          if (last?.role === 'assistant' && !String(last.content || '').trim()) nextTurns.pop();
          const prev = nextTurns[nextTurns.length - 1];
          if (prev?.role === 'user' && prev.content === text) nextTurns.pop();
          if (!nextTurns.some((turn) => turn.role === 'user' && String(turn.content || '').trim())) return [];
          return [{ ...chat, turns: nextTurns }];
        }),
      { persist: true });
      const kept = chatsRef.current.find((chat) => chat.id === id);
      if (!kept && activeIdRef.current === id) selectChat(null);
      if (mountedRef.current) {
        const keptQuestion = kept?.turns?.some((turn) => turn.role === 'user' && turn.content === text);
        if (!keptQuestion) setDraft(text);
        setError(err?.message || 'Could not get an answer.');
      }
    } finally {
      if (genRef.current.get(id) === gen) {
        sendingRef.current = false;
        if (mountedRef.current) {
          setBusyId('');
          setBusyNote('');
        }
      }
    }
  };

  const canSend = Boolean(draft.trim()) && !busyId && !blocked;
  const chatTitle = activeChat?.title || 'New chat';
  const modelEntry = ANALYTICS_CHAT_MODELS.find((item) => item.key === model);
  const modelLabel = modelEntry?.label || 'Model';
  const modelTag = modelMeta(model).tag;
  const chooseModel = (key) => {
    setModel(key);
    setModelOpen(false);
    AsyncStorage.setItem(`${MODEL_KEY}.${userKey || 'local'}`, key).catch(() => {});
  };

  const modelSheet = (
    <Modal
      visible={modelOpen}
      transparent
      animationType="fade"
      onRequestClose={() => setModelOpen(false)}
    >
      <View style={styles.modelSheetRoot}>
        <Pressable
          style={styles.modelSheetBackdrop}
          accessibilityRole="button"
          accessibilityLabel="Close model list"
          onPress={() => setModelOpen(false)}
        />
        <View style={[styles.modelSheetCard, compact && styles.modelSheetCardPhone]}>
          <View style={styles.modelSheetHead}>
            <Text style={styles.modelSheetTitle}>Choose a model</Text>
            <Text style={styles.modelSheetSubtitle}>
              Used for this chat only. You can switch anytime before sending.
            </Text>
          </View>
          <ScrollView
            style={styles.modelSheetScroll}
            contentContainerStyle={styles.modelSheetScrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {modelPickerSections().map((section) => {
              const items = section.keys
                .map((key) => ANALYTICS_CHAT_MODELS.find((row) => row.key === key))
                .filter(Boolean);
              if (!items.length) return null;
              return (
                <View key={section.title} style={styles.modelSection}>
                  <Text style={styles.modelSectionTitle}>{section.title}</Text>
                  {items.map((item) => {
                    const selected = item.key === model;
                    const meta = modelMeta(item.key);
                    const rateLabel = friendlyRates(modelRates(prices, item.key));
                    return (
                      <Pressable
                        key={item.key}
                        onPress={() => chooseModel(item.key)}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                        accessibilityLabel={`${item.label}. ${meta.blurb}`}
                        style={({ hovered, pressed }) => [
                          styles.modelOption,
                          selected && styles.modelOptionOn,
                          (hovered || pressed) && !selected && styles.modelOptionHover,
                        ]}
                      >
                        <View style={styles.modelOptionMain}>
                          <View style={styles.modelOptionTitleRow}>
                            <Text style={[styles.modelOptionLabel, selected && styles.modelOptionLabelOn]}>
                              {item.label}
                            </Text>
                            {meta.tag ? (
                              <View style={[styles.modelTag, selected && styles.modelTagOn]}>
                                <Text style={[styles.modelTagText, selected && styles.modelTagTextOn]}>
                                  {meta.tag}
                                </Text>
                              </View>
                            ) : null}
                          </View>
                          <Text style={styles.modelOptionBlurb}>{meta.blurb}</Text>
                          <Text style={styles.modelOptionRate}>{rateLabel}</Text>
                        </View>
                        {selected ? (
                          <View style={styles.modelOptionCheck}>
                            <Ionicons name="checkmark" size={16} color="#fff" />
                          </View>
                        ) : (
                          <View style={styles.modelOptionCheckGhost} />
                        )}
                      </Pressable>
                    );
                  })}
                </View>
              );
            })}
          </ScrollView>
          <Pressable
            onPress={() => setModelOpen(false)}
            accessibilityRole="button"
            style={({ hovered, pressed }) => [
              styles.modelSheetDone,
              (hovered || pressed) && styles.modelSheetDoneHover,
            ]}
          >
            <Text style={styles.modelSheetDoneText}>Done</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );

  const list = (
    <View style={[styles.sidebar, compact && styles.sidebarPhone]}>
      {compact ? (
        <View style={styles.nav}>
          <Text style={styles.navTitle}>Chats</Text>
          <Pressable
            onPress={onClose}
            hitSlop={8}
            style={styles.chromeCircle}
            accessibilityRole="button"
            accessibilityLabel="Back to analytics"
          >
            <Ionicons name="close" size={16} color={INK} />
          </Pressable>
        </View>
      ) : (
        <Text style={styles.sideLabel}>Chats</Text>
      )}
      <Pressable
        onPress={startNew}
        accessibilityRole="button"
        accessibilityState={{ selected: !activeId }}
        accessibilityLabel="New chat"
        style={({ hovered, pressed }) => [
          styles.newChat,
          !activeId && styles.newChatOn,
          (hovered || pressed) && styles.rowHover,
        ]}
      >
        <Ionicons name="add" size={16} color={INK} />
        <Text style={styles.newChatText}>New chat</Text>
      </Pressable>
      <ScrollView style={styles.sideScroll} contentContainerStyle={styles.sideScrollContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {!ready ? (
          <ActivityIndicator color="#8e8e93" style={styles.sideSpinner} />
        ) : history.length ? (
          history.map((chat) => {
            const selected = chat.id === activeId;
            return (
              <View
                key={chat.id}
                style={[styles.chatRow, selected && styles.chatRowOn]}
              >
                <Pressable
                  onPress={() => openChat(chat.id)}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={chat.title}
                  style={({ hovered, pressed }) => [
                    styles.chatHit,
                    (hovered || pressed) && !selected && styles.rowHover,
                  ]}
                >
                  <Text style={[styles.chatRowTitle, selected && styles.chatRowTitleOn]} numberOfLines={1}>
                    {chat.title}
                  </Text>
                  <Text style={styles.chatRowScope} numberOfLines={1}>
                    {chat.scopeLabel || 'Analysis'}
                  </Text>
                </Pressable>
                <View style={styles.chatMeta}>
                  {busyId === chat.id ? (
                    <ActivityIndicator size="small" color={INK} />
                  ) : (
                    <Text style={styles.chatRowTime}>{chatTime(chat.updatedAt)}</Text>
                  )}
                  <Pressable
                    onPress={() => removeChat(chat.id)}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={`Delete ${chat.title}`}
                    style={styles.chatDelete}
                  >
                    <Ionicons name="close" size={14} color="#8e8e93" />
                  </Pressable>
                </View>
              </View>
            );
          })
        ) : (
          <Text style={styles.sideEmpty}>No previous analysis yet.</Text>
        )}
      </ScrollView>
    </View>
  );

  const conversation = (
    <View style={styles.main}>
      {compact ? (
        <View style={styles.nav}>
          <Pressable
            onPress={() => setMobileList(true)}
            hitSlop={8}
            style={styles.chromeCircle}
            accessibilityRole="button"
            accessibilityLabel="Chats"
          >
            <Ionicons name="chevron-back" size={16} color={INK} />
          </Pressable>
          <Text style={styles.navTitle} numberOfLines={1}>
            {chatTitle}
          </Text>
          <Pressable
            onPress={onClose}
            hitSlop={8}
            style={styles.chromeCircle}
            accessibilityRole="button"
            accessibilityLabel="Back to analytics"
          >
            <Ionicons name="close" size={16} color={INK} />
          </Pressable>
        </View>
      ) : (
        <View style={styles.chatHead}>
          <Text style={styles.chatTitle} numberOfLines={1}>
            {chatTitle}
          </Text>
        </View>
      )}
      <ScrollView
        ref={scrollRef}
        style={styles.threadScroll}
        contentContainerStyle={[styles.threadContent, !turns.length && styles.threadEmpty]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {turns.length ? (
          turns.map((turn, index) => {
            const mine = turn.role === 'user';
            const streaming = !mine && busyId === activeId && index === turns.length - 1 && !String(turn.content || '').trim();
            if (!mine && !String(turn.content || '').trim() && !streaming) return null;
            const costLine = streaming ? '' : turnCostLine(turn, turn.role);
            return (
              <View
                key={`${turn.role}-${index}`}
                style={[styles.turnRow, mine ? styles.turnRowMine : styles.turnRowTheirs]}
              >
                {!mine ? (
                  <View style={styles.turnAvatar}>
                    <Ionicons name="sparkles" size={14} color={INK} />
                  </View>
                ) : null}
                <View style={[styles.turnBody, mine && styles.turnBodyMine]}>
                  {!mine ? <Text style={styles.turnLabel}>Analytics</Text> : null}
                  <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
                    {streaming ? (
                      <View style={styles.busyRow}>
                        <ActivityIndicator size="small" color={SECONDARY} />
                        {busyNote ? <Text style={styles.busyNote}>{busyNote}</Text> : null}
                      </View>
                    ) : (
                      <TicketText
                        text={turn.content}
                        style={[styles.bubbleText, mine && styles.bubbleTextMine]}
                        resolveTicket={resolveTicket}
                        onOpenDocument={onOpenDocument}
                      />
                    )}
                  </View>
                  {costLine ? (
                    <Text style={[styles.costMeta, mine && styles.costMetaMine]}>{costLine}</Text>
                  ) : null}
                  {mine
                    ? null
                    : (turn.charts || []).map((chart, chartIndex) =>
                        chart.type === 'map' ? (
                          <AnalyticsMapCard
                            key={`${chart.type}-${chartIndex}`}
                            chart={chart}
                            apiKey={mapsKey}
                            onOpenCustomer={onOpenCustomer}
                          />
                        ) : chart.type === 'table' ? (
                          <AnalyticsTableCard
                            key={`${chart.type}-${chartIndex}`}
                            chart={chart}
                            onOpenTicket={onOpenDocument ? (ref) => onOpenDocument(resolveTicket(ref)) : null}
                          />
                        ) : (
                          <AnalyticsChartCard key={`${chart.type}-${chartIndex}`} chart={chart} />
                        ),
                      )}
                </View>
              </View>
            );
          })
        ) : waiting ? (
          <View style={styles.empty}>
            <ActivityIndicator color="#8e8e93" />
            <Text style={styles.emptyBody}>Loading this breakdown…</Text>
          </View>
        ) : dataError && !eventCount ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>Could not load</Text>
            <Text style={styles.emptyBody}>{dataError}</Text>
          </View>
        ) : (
          <View style={styles.empty}>
            <View style={styles.emptyMark}>
              <Ionicons name="sparkles" size={18} color={INK} />
            </View>
            <Text style={styles.emptyTitle}>Ask about the stores</Text>
            <Text style={styles.emptyBody}>
              Questions about the table use the dates and filters shown below. Live stock, tills, hours, reviews, and other company data can span any period — not just that range.
            </Text>
            <View style={styles.suggestRow}>
              {suggestions.map((item) => (
                <Pressable
                  key={item}
                  onPress={() => send(item)}
                  disabled={Boolean(busyId) || blocked}
                  accessibilityRole="button"
                  style={({ hovered, pressed }) => [
                    styles.suggest,
                    (hovered || pressed) && styles.suggestHover,
                  ]}
                >
                  <Text style={styles.suggestText}>{item}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}
      </ScrollView>
      <View style={styles.composerWrap}>
        <View style={styles.composerToolbar}>
          <Pressable
            onPress={() => setModelOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={`Model, ${modelLabel}${modelTag ? `, ${modelTag}` : ''}`}
            style={({ hovered, pressed }) => [
              styles.modelChip,
              (hovered || pressed) && styles.modelChipHover,
            ]}
          >
            <Ionicons name="hardware-chip-outline" size={14} color={INK} />
            <Text style={styles.modelChipText} numberOfLines={1}>
              {modelLabel}
            </Text>
            {modelTag ? (
              <View style={styles.modelChipTag}>
                <Text style={styles.modelChipTagText} numberOfLines={1}>
                  {modelTag}
                </Text>
              </View>
            ) : null}
            <Ionicons name="chevron-down" size={12} color={SECONDARY} />
          </Pressable>
          <Text style={styles.scopeChip} numberOfLines={1}>
            {chatCost > 0
              ? `${formatUsd(chatCost)} this chat · ${formatTokenCount(chatTokens)} tokens`
              : turns.length
                ? 'Cost appears after the first reply'
                : ''}
          </Text>
        </View>
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
        <View style={styles.composerCard}>
          <TextInput
            ref={inputRef}
            value={draft}
            onChangeText={setDraft}
            placeholder={waiting ? 'Loading this breakdown…' : 'Message Analytics…'}
            placeholderTextColor={SECONDARY}
            editable={!busyId && !blocked}
            multiline
            blurOnSubmit={false}
            style={styles.input}
            onSubmitEditing={() => {
              if (canSend) void send();
            }}
            onKeyPress={(event) => {
              const key = event?.nativeEvent?.key || event?.key;
              if (key !== 'Enter') return;
              if (event?.nativeEvent?.shiftKey || event?.shiftKey) return;
              event?.preventDefault?.();
              if (canSend) void send();
            }}
          />
          <Pressable
            onPress={() => send()}
            disabled={!canSend}
            accessibilityRole="button"
            accessibilityLabel="Send"
            style={[styles.send, canSend ? styles.sendOn : styles.sendOff]}
          >
            {busyId && busyId === activeId ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Ionicons name="arrow-up" size={16} color="#fff" />
            )}
          </Pressable>
        </View>
        <Text style={styles.composerHint}>Enter to send · Shift+Enter for a new line</Text>
      </View>
    </View>
  );

  return (
    <View style={[styles.root, compact && styles.rootPhone]}>
      {modelSheet}
      {showList ? list : compact ? conversation : (
        <>
          {list}
          {conversation}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    minHeight: 0,
    flexDirection: 'row',
    backgroundColor: CANVAS,
  },
  rootPhone: {
    flexDirection: 'column',
  },
  sidebar: {
    width: 268,
    flexShrink: 0,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: RULE,
    backgroundColor: 'transparent',
    paddingTop: 14,
  },
  sidebarPhone: {
    width: '100%',
    flex: 1,
    borderRightWidth: 0,
    paddingTop: 0,
    backgroundColor: CANVAS,
  },
  sideLabel: {
    fontFamily: FONT_EXTRALIGHT,
    fontSize: 14,
    fontWeight: '200',
    color: INK,
    letterSpacing: -0.2,
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  newChat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginHorizontal: 12,
    marginBottom: 10,
    height: 32,
    paddingHorizontal: 10,
    borderRadius: NAV_TAB_ACTIVE_RADIUS,
    borderWidth: 1,
    borderColor: CHIP_BORDER,
    backgroundColor: CANVAS,
    ...CHIP_SHADOW,
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  newChatOn: {
    backgroundColor: NAV_TAB_ACTIVE_BG,
  },
  newChatText: {
    fontFamily: FONT,
    fontSize: 13,
    fontWeight: '500',
    color: INK,
    letterSpacing: -0.2,
  },
  sideScroll: {
    flex: 1,
    minHeight: 0,
  },
  sideScrollContent: {
    paddingBottom: 16,
  },
  sideSpinner: {
    marginTop: 24,
  },
  sideEmpty: {
    fontFamily: FONT,
    fontSize: 13,
    lineHeight: 18,
    color: '#8e8e93',
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  chatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 8,
    marginBottom: 1,
    minHeight: 44,
    paddingRight: 8,
    borderRadius: NAV_TAB_ACTIVE_RADIUS,
  },
  chatHit: {
    flex: 1,
    minWidth: 0,
    gap: 2,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: NAV_TAB_ACTIVE_RADIUS,
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  chatRowOn: {
    backgroundColor: NAV_TAB_ACTIVE_BG,
  },
  rowHover: {
    backgroundColor: '#f5f5f5',
  },
  chatRowTitle: {
    fontFamily: FONT,
    fontSize: 14,
    fontWeight: '500',
    color: INK,
    letterSpacing: -0.2,
  },
  chatRowTitleOn: {
    color: INK,
  },
  chatRowScope: {
    fontFamily: FONT,
    fontSize: 12,
    color: '#8e8e93',
    letterSpacing: -0.1,
  },
  chatMeta: {
    alignItems: 'flex-end',
    gap: 4,
  },
  chatRowTime: {
    fontFamily: FONT,
    fontSize: 12,
    color: '#8e8e93',
  },
  chatDelete: {
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  main: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    backgroundColor: CANVAS,
  },
  nav: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 48,
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: RULE,
    backgroundColor: CANVAS,
  },
  chromeCircle: {
    width: 32,
    height: 32,
    borderRadius: NAV_TAB_ACTIVE_RADIUS,
    borderWidth: 1,
    borderColor: CHIP_BORDER,
    backgroundColor: CANVAS,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    ...CHIP_SHADOW,
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  navTitle: {
    flex: 1,
    fontFamily: FONT_EXTRALIGHT,
    fontSize: 14,
    fontWeight: '200',
    color: INK,
    letterSpacing: -0.2,
  },
  chatHead: {
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: RULE,
    backgroundColor: 'transparent',
  },
  chatTitle: {
    fontFamily: FONT_EXTRALIGHT,
    fontSize: 14,
    fontWeight: '200',
    color: INK,
    letterSpacing: -0.2,
  },
  threadScroll: {
    flex: 1,
    minHeight: 0,
  },
  threadContent: {
    width: '100%',
    maxWidth: 760,
    alignSelf: 'center',
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 14,
  },
  threadEmpty: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  empty: {
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
  },
  emptyMark: {
    width: 40,
    height: 40,
    borderRadius: NAV_TAB_ACTIVE_RADIUS,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: CANVAS,
    borderWidth: 1,
    borderColor: CHIP_BORDER,
    marginBottom: 4,
    ...CHIP_SHADOW,
  },
  emptyTitle: {
    fontFamily: FONT,
    fontSize: 18,
    fontWeight: '500',
    color: INK,
    letterSpacing: -0.3,
    textAlign: 'center',
  },
  emptyBody: {
    fontFamily: FONT,
    fontSize: 14,
    lineHeight: 20,
    color: '#8e8e93',
    textAlign: 'center',
    maxWidth: 420,
  },
  emptyScope: {
    fontFamily: FONT,
    fontSize: 13,
    lineHeight: 18,
    color: INK,
    textAlign: 'center',
  },
  suggestRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    marginTop: 8,
  },
  suggest: {
    maxWidth: '100%',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: BUBBLE_RADIUS,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: BUBBLE_THEM_BORDER,
    backgroundColor: BUBBLE_THEM_BG,
    ...CHIP_SHADOW,
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  suggestHover: {
    backgroundColor: NAV_TAB_ACTIVE_BG,
  },
  suggestText: {
    fontFamily: FONT,
    fontSize: 13,
    fontWeight: '400',
    color: INK,
    letterSpacing: -0.1,
  },
  turnRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    maxWidth: '100%',
  },
  turnRowTheirs: {
    alignSelf: 'flex-start',
  },
  turnRowMine: {
    alignSelf: 'flex-end',
    flexDirection: 'row-reverse',
  },
  turnAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 18,
    backgroundColor: NAV_TAB_ACTIVE_BG,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: BUBBLE_THEM_BORDER,
    flexShrink: 0,
  },
  turnBody: {
    flex: 1,
    minWidth: 0,
    maxWidth: '88%',
    gap: 6,
  },
  turnBodyMine: {
    alignItems: 'flex-end',
    maxWidth: '84%',
  },
  turnLabel: {
    fontFamily: FONT,
    fontSize: 11,
    lineHeight: 14,
    color: SECONDARY,
    marginLeft: 4,
  },
  bubble: {
    maxWidth: '100%',
    borderRadius: BUBBLE_RADIUS,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  costMeta: {
    fontFamily: FONT,
    fontSize: 11,
    lineHeight: 14,
    color: SECONDARY,
    marginLeft: 4,
    marginTop: -2,
  },
  costMetaMine: {
    marginLeft: 0,
    marginRight: 4,
    textAlign: 'right',
  },
  busyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 20,
  },
  busyNote: {
    fontFamily: FONT,
    fontSize: 13,
    color: '#8e8e93',
  },
  bubbleMine: {
    backgroundColor: INK,
  },
  bubbleTheirs: {
    backgroundColor: BUBBLE_THEM_BG,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: BUBBLE_THEM_BORDER,
  },
  bubbleText: {
    fontFamily: FONT,
    fontSize: 16,
    lineHeight: 22,
    color: '#1d1d1f',
  },
  bubbleTextMine: {
    color: '#fff',
  },
  ticketLink: {
    textDecorationLine: 'underline',
    fontWeight: '500',
    ...Platform.select({ web: { cursor: 'pointer', textUnderlineOffset: 2 }, default: {} }),
  },
  composerWrap: {
    width: '100%',
    maxWidth: 760,
    alignSelf: 'center',
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 14,
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: RULE,
    backgroundColor: CANVAS,
  },
  composerToolbar: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  modelChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    maxWidth: '58%',
    minHeight: 32,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: CHIP_RADIUS,
    borderWidth: 1,
    borderColor: CHIP_BORDER,
    backgroundColor: CANVAS,
    ...CHIP_SHADOW,
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  modelChipHover: {
    backgroundColor: NAV_TAB_ACTIVE_BG,
  },
  modelChipText: {
    flexShrink: 1,
    fontFamily: FONT,
    fontSize: 13,
    fontWeight: '500',
    color: INK,
    letterSpacing: -0.1,
  },
  modelChipTag: {
    maxWidth: 88,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: NAV_TAB_ACTIVE_BG,
  },
  modelChipTagText: {
    fontFamily: FONT,
    fontSize: 10,
    fontWeight: '600',
    color: SECONDARY,
    letterSpacing: 0.1,
  },
  scopeChip: {
    flex: 1,
    minWidth: 0,
    fontFamily: FONT,
    fontSize: 12,
    lineHeight: 16,
    color: SECONDARY,
    paddingTop: 7,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  modelSheetRoot: {
    flex: 1,
    justifyContent: 'flex-end',
    ...Platform.select({
      web: { justifyContent: 'center', alignItems: 'center' },
      default: {},
    }),
  },
  modelSheetBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.36)',
  },
  modelSheetCard: {
    maxHeight: '78%',
    width: 420,
    maxWidth: '92%',
    marginHorizontal: 12,
    marginBottom: 28,
    borderRadius: 16,
    backgroundColor: '#fff',
    overflow: 'hidden',
    ...Platform.select({
      web: { marginBottom: 0, boxShadow: '0 12px 40px rgba(0,0,0,0.18)' },
      default: {
        shadowColor: '#000',
        shadowOpacity: 0.18,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 8 },
        elevation: 8,
      },
    }),
  },
  modelSheetCardPhone: {
    width: '100%',
    maxWidth: '100%',
    marginHorizontal: 0,
    marginBottom: 0,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  },
  modelSheetHead: {
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 10,
    gap: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: RULE,
  },
  modelSheetTitle: {
    fontFamily: FONT,
    fontSize: 17,
    fontWeight: '600',
    color: '#1d1d1f',
    letterSpacing: -0.2,
  },
  modelSheetSubtitle: {
    fontFamily: FONT,
    fontSize: 13,
    lineHeight: 18,
    color: SECONDARY,
  },
  modelSheetScroll: {
    maxHeight: 360,
  },
  modelSheetScrollContent: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 12,
  },
  modelSection: {
    gap: 6,
  },
  modelSectionTitle: {
    fontFamily: FONT,
    fontSize: 12,
    fontWeight: '600',
    color: SECONDARY,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    paddingHorizontal: 8,
    paddingTop: 2,
  },
  modelOption: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'transparent',
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  modelOptionHover: {
    backgroundColor: '#f5f5f7',
  },
  modelOptionOn: {
    backgroundColor: NAV_TAB_ACTIVE_BG,
    borderColor: BUBBLE_THEM_BORDER,
  },
  modelOptionMain: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  modelOptionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  modelOptionLabel: {
    fontFamily: FONT,
    fontSize: 15,
    fontWeight: '500',
    color: INK,
    letterSpacing: -0.2,
  },
  modelOptionLabelOn: {
    fontWeight: '600',
  },
  modelTag: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: '#eef0f3',
  },
  modelTagOn: {
    backgroundColor: 'rgba(26,26,26,0.08)',
  },
  modelTagText: {
    fontFamily: FONT,
    fontSize: 10,
    fontWeight: '700',
    color: SECONDARY,
    letterSpacing: 0.2,
  },
  modelTagTextOn: {
    color: INK,
  },
  modelOptionBlurb: {
    fontFamily: FONT,
    fontSize: 13,
    lineHeight: 18,
    color: '#636366',
  },
  modelOptionRate: {
    fontFamily: FONT,
    fontSize: 11,
    lineHeight: 14,
    color: SECONDARY,
  },
  modelOptionCheck: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: INK,
    marginTop: 2,
    flexShrink: 0,
  },
  modelOptionCheckGhost: {
    width: 24,
    height: 24,
    marginTop: 2,
    flexShrink: 0,
  },
  modelSheetDone: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: RULE,
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  modelSheetDoneHover: {
    backgroundColor: '#f5f5f7',
  },
  modelSheetDoneText: {
    fontFamily: FONT,
    fontSize: 16,
    fontWeight: '600',
    color: INK,
  },
  errorText: {
    fontFamily: FONT,
    fontSize: 13,
    lineHeight: 18,
    color: '#b42318',
  },
  composerCard: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    minHeight: 44,
    paddingLeft: 14,
    paddingRight: 6,
    paddingVertical: 6,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: CHIP_BORDER,
    backgroundColor: BUBBLE_THEM_BG,
    ...CHIP_SHADOW,
  },
  input: {
    flex: 1,
    minHeight: 28,
    maxHeight: 120,
    padding: 0,
    paddingVertical: 4,
    backgroundColor: 'transparent',
    fontFamily: FONT,
    fontSize: 16,
    lineHeight: 22,
    color: '#1d1d1f',
    ...Platform.select({
      web: { outlineStyle: 'none' },
      default: {},
    }),
  },
  composerHint: {
    fontFamily: FONT,
    fontSize: 11,
    lineHeight: 14,
    color: SECONDARY,
    textAlign: 'center',
    ...Platform.select({ web: { display: 'none' }, default: {} }),
  },
  send: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
    flexShrink: 0,
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  sendOn: {
    backgroundColor: INK,
  },
  sendOff: {
    backgroundColor: '#c7c7cc',
  },
});
