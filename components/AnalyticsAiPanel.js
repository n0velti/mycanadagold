import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
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
import { ANALYTICS_CHAT_MODELS, askAnalytics, buildExportSheet, completeOpenRouter } from '../lib/analyticsChartTools';
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
import AnalyticsFileCard from './AnalyticsFileCard';
import {
  MAX_ATTACHMENTS,
  attachmentLabel,
  formatBytes,
  pickFiles,
  prepareAttachment,
  storableAttachment,
} from '../lib/aiAttachments';
import { CANVAS, NAV_TAB_ACTIVE_BG, NAV_TAB_ACTIVE_RADIUS } from '../lib/mobileUi';
import { FONT } from '../lib/typography';

const MODEL_KEY = 'cgold.analytics.aiModel';

const INK = '#1a1a1a';
const CHIP_BORDER = '#d0d0d0';
const CHIP_RADIUS = 6;
const BUBBLE_RADIUS = 18;
const RULE = 'rgba(42,38,30,0.08)';
const SECONDARY = '#8e8e93';
const BUBBLE_THEM_BG = '#ffffff';
const BUBBLE_THEM_BORDER = 'rgba(60, 60, 67, 0.12)';
const COMPOSER_LINE_HEIGHT = 22;
const COMPOSER_MAX_LINES = 4;

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

function byChatOrder(a, b) {
  const pin = Number(Boolean(b.pinned)) - Number(Boolean(a.pinned));
  if (pin) return pin;
  return String(b.updatedAt).localeCompare(String(a.updatedAt));
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
  if (chart.type === 'file' && Array.isArray(chart.sheets)) {
    // Rows are not persisted for sheets that came from a live source; the
    // card rebuilds those from `spec` when Download is pressed after a reload.
    const column = (item) => ({
      key: String(item?.key || '').slice(0, 60),
      label: String(item?.label || item?.key || '').slice(0, 60),
      format: ['int', 'decimal', 'money', 'hours'].includes(item?.format) ? item.format : 'text',
    });
    const sheets = chart.sheets
      .slice(0, 8)
      .map((sheet) => {
        const columns = (Array.isArray(sheet?.columns) ? sheet.columns : []).map(column).filter((item) => item.key);
        if (!columns.length) return null;
        const spec = sheet?.spec && typeof sheet.spec === 'object' ? sheet.spec : null;
        const rows = spec
          ? []
          : (Array.isArray(sheet?.rows) ? sheet.rows : []).slice(0, 200).map((row) =>
              Object.fromEntries(columns.map((item) => [item.key, row?.[item.key] ?? ''])),
            );
        return {
          name: String(sheet?.name || 'Sheet').slice(0, 31),
          columns,
          rows,
          total: Number(sheet?.total) || rows.length,
          scopeLabel: String(sheet?.scopeLabel || '').slice(0, 160),
          spec,
        };
      })
      .filter(Boolean);
    if (!sheets.length) return null;
    return {
      type: 'file',
      kind: 'xlsx',
      title,
      fileName: String(chart.fileName || title).slice(0, 80),
      subtitle,
      note: String(chart.note || '').slice(0, 200) || undefined,
      sheets,
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
      const attachments = (Array.isArray(turn.attachments) ? turn.attachments : [])
        .map(storableAttachment)
        .filter(Boolean)
        .slice(0, MAX_ATTACHMENTS);
      if (!content && !charts.length && !attachments.length) return null;
      const next = charts.length ? { role: turn.role, content, charts } : { role: turn.role, content };
      if (attachments.length) next.attachments = attachments;
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
        pinned: Boolean(item?.pinned),
        placeholder: Boolean(item?.placeholder),
        turns: storedTurns(item?.turns),
      }))
      .filter((chat) => chat.id && (chat.placeholder || chat.turns.some((turn) => turn.role === 'user')));
  } catch {
    return [];
  }
}

async function loadChats(userKey) {
  try {
    const rows = parseChats(await AsyncStorage.getItem(storageKey(userKey)));
    return rows.sort(byChatOrder);
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
      pinned: Boolean(chat.pinned),
      placeholder: Boolean(chat.placeholder),
      turns: storedTurns(chat.turns),
    }))
    .filter((chat) => chat.id && (chat.placeholder || chat.turns.some((turn) => turn.role === 'user')))
    .sort(byChatOrder)
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

function defaultQuestionFor(attachments) {
  const kinds = new Set((attachments || []).map((item) => item.kind));
  if (kinds.size === 1 && (kinds.has('image') || kinds.has('video'))) return 'What do you see here?';
  return 'Summarize what is in the attached files.';
}

function attachmentIcon(kind) {
  if (kind === 'image') return 'image-outline';
  if (kind === 'video') return 'videocam-outline';
  if (kind === 'spreadsheet') return 'grid-outline';
  if (kind === 'pdf') return 'document-text-outline';
  if (kind === 'document') return 'document-outline';
  return 'attach-outline';
}

/** Chips for files attached to a message, in the composer or on a sent bubble. */
function AttachmentChips({ items, onRemove, mine }) {
  if (!items?.length) return null;
  return (
    <View style={[styles.attachRow, mine && styles.attachRowMine]}>
      {items.map((item) => (
        <View key={item.id} style={[styles.attachChip, mine && styles.attachChipMine]}>
          {item.thumb ? (
            <Image source={{ uri: item.thumb }} style={styles.attachThumb} accessibilityIgnoresInvertColors />
          ) : (
            <View style={[styles.attachIcon, mine && styles.attachIconMine]}>
              <Ionicons name={attachmentIcon(item.kind)} size={14} color={mine ? '#fff' : INK} />
            </View>
          )}
          <View style={styles.attachCopy}>
            <Text style={[styles.attachName, mine && styles.attachNameMine]} numberOfLines={1}>
              {item.name}
            </Text>
            <Text style={[styles.attachMeta, mine && styles.attachMetaMine]} numberOfLines={1}>
              {[attachmentLabel(item), item.summary || (item.size ? formatBytes(item.size) : '')].filter(Boolean).join(' · ')}
            </Text>
          </View>
          {onRemove ? (
            <Pressable
              onPress={() => onRemove(item.id)}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${item.name}`}
              style={styles.attachRemove}
            >
              <Ionicons name="close" size={14} color={SECONDARY} />
            </Pressable>
          ) : null}
        </View>
      ))}
    </View>
  );
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
  onClose = null,
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
  const [pending, setPending] = useState([]);
  const [attaching, setAttaching] = useState('');
  const [busyId, setBusyId] = useState('');
  const [busyNote, setBusyNote] = useState('');
  const [error, setError] = useState('');
  const [mobileList, setMobileList] = useState(true);
  const [model, setModel] = useState(ANALYTICS_CHAT_MODELS[0].key);
  const [modelOpen, setModelOpen] = useState(false);
  const [menuChatId, setMenuChatId] = useState(null);
  const [hoverChatId, setHoverChatId] = useState(null);
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
  const [inputHeight, setInputHeight] = useState(COMPOSER_LINE_HEIGHT);
  const composerMaxHeight = COMPOSER_LINE_HEIGHT * COMPOSER_MAX_LINES;

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
        .filter((chat) => chat.placeholder || chat.turns.some((turn) => turn.role === 'user' && String(turn.content || '').trim()))
        .sort(byChatOrder),
    [chats],
  );
  const activeChat = history.find((chat) => chat.id === activeId) || null;
  const turns = (activeChat?.turns || []).filter((turn) => turn.role === 'user' || turn.role === 'assistant');
  const showList = compact && mobileList;
  const tail = turns[turns.length - 1]?.content || '';
  // After a reload a file card only has its sheet specs; run them again to get the rows.
  const rebuildFile = async (chart) => {
    const context = {
      rows,
      startDate,
      endDate,
      storeFilter,
      session,
      mapsKey,
      signal: undefined,
      onStatus: () => {},
      question: '',
    };
    const sheets = [];
    for (const sheet of chart.sheets || []) {
      if (Array.isArray(sheet.rows) && sheet.rows.length) {
        sheets.push(sheet);
        continue;
      }
      if (!sheet.spec) {
        sheets.push(sheet);
        continue;
      }
      const built = await buildExportSheet(sheet.spec, context);
      if (built.error) throw new Error(`${sheet.name}: ${built.error}`);
      sheets.push({ ...sheet, columns: built.columns, rows: built.rows, total: built.total });
    }
    return { ...chart, sheets };
  };

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

  useEffect(() => {
    if (!draft) setInputHeight(COMPOSER_LINE_HEIGHT);
  }, [draft]);

  const syncInputHeight = (event) => {
    const raw = event?.nativeEvent?.contentSize?.height;
    if (!Number.isFinite(raw) || raw <= 0) return;
    const next = Math.ceil(raw);
    setInputHeight(Math.min(composerMaxHeight, Math.max(COMPOSER_LINE_HEIGHT, next)));
  };

  const startNew = () => {
    const now = new Date().toISOString();
    const id = chatId();
    commit(
      (current) => [
        {
          id,
          title: 'New chat',
          scopeLabel,
          createdAt: now,
          updatedAt: now,
          pinned: false,
          placeholder: true,
          turns: [],
        },
        ...current,
      ],
      { persist: true },
    );
    selectChat(id);
    setDraft('');
    setError('');
    setMenuChatId(null);
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

  const togglePin = (id) => {
    commit(
      (current) => current.map((chat) => (chat.id === id ? { ...chat, pinned: !chat.pinned } : chat)),
      { persist: true },
    );
  };

  const addFiles = async () => {
    if (attaching || busyId) return;
    let files = [];
    try {
      files = await pickFiles();
    } catch (err) {
      setError(err?.message || 'Could not open the file picker.');
      return;
    }
    if (!files.length) return;
    const room = MAX_ATTACHMENTS - pending.length;
    if (room <= 0) {
      setError(`Up to ${MAX_ATTACHMENTS} files per message.`);
      return;
    }
    setError('');
    const problems = [];
    for (const file of files.slice(0, room)) {
      setAttaching(`Reading ${file.name || 'file'}…`);
      try {
        const prepared = await prepareAttachment(file);
        if (!mountedRef.current) return;
        setPending((current) => (current.length < MAX_ATTACHMENTS ? [...current, prepared] : current));
      } catch (err) {
        problems.push(err?.message || `Could not read ${file.name || 'that file'}.`);
      }
    }
    if (files.length > room) problems.push(`Only ${MAX_ATTACHMENTS} files per message; the rest were skipped.`);
    if (mountedRef.current) {
      setAttaching('');
      if (problems.length) setError(problems.join(' '));
    }
  };

  const removePending = (id) => setPending((current) => current.filter((item) => item.id !== id));

  const send = async (raw) => {
    const attachments = raw == null ? pending : [];
    const typed = String(raw ?? draft).trim();
    const text = typed || (attachments.length ? defaultQuestionFor(attachments) : '');
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
    if (attachments.length) setPending([]);
    selectChat(id);
    setMobileList(false);

    const stored = attachments.map(storableAttachment).filter(Boolean);
    const userTurnBase = stored.length ? { role: 'user', content: text, attachments: stored } : { role: 'user', content: text };
    const nextChat = {
      id,
      title: nameThis ? fallbackTitle(text) : (existing?.title || fallbackTitle(text)),
      scopeLabel: existing?.scopeLabel || scopeLabel,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      pinned: Boolean(existing?.pinned),
      placeholder: false,
      turns: [...history, userTurnBase, { role: 'assistant', content: '' }],
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
        attachments,
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
      const userTurn = priced ? { ...userTurnBase, usage: priced } : userTurnBase;
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
          if (!nextTurns.some((turn) => turn.role === 'user' && String(turn.content || '').trim())) {
            return [{ ...chat, title: 'New chat', placeholder: true, turns: [] }];
          }
          return [{ ...chat, turns: nextTurns, placeholder: false }];
        }),
      { persist: true });
      const kept = chatsRef.current.find((chat) => chat.id === id);
      if (!kept && activeIdRef.current === id) selectChat(null);
      if (mountedRef.current) {
        const keptQuestion = kept?.turns?.some((turn) => turn.role === 'user' && turn.content === text);
        if (!keptQuestion) {
          setDraft(typed);
          if (attachments.length) setPending(attachments);
        }
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

  const streaming = Boolean(busyId && busyId === activeId);
  const canSend = (Boolean(draft.trim()) || pending.length > 0) && !busyId && !blocked && !attaching;
  const stopStreaming = () => {
    const id = busyId;
    if (!id) return;
    abortsRef.current.get(id)?.abort();
  };
  const composerPlaceholder = waiting
    ? 'Loading this breakdown…'
    : turns.length
      ? 'Send follow-up'
      : 'Message Analytics…';
  const composerMeta =
    chatCost > 0
      ? `${formatUsd(chatCost)} this chat · ${formatTokenCount(chatTokens)} tokens`
      : turns.length
        ? 'Cost appears after the first reply'
        : '';
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
      <View style={styles.listHead}>
        {compact && onClose ? (
          <Pressable
            onPress={onClose}
            hitSlop={8}
            style={styles.chromeCircle}
            accessibilityRole="button"
            accessibilityLabel="Close"
          >
            <Ionicons name="close" size={16} color={INK} />
          </Pressable>
        ) : null}
        <View style={styles.listHeadSpacer} />
        <Pressable
          onPress={startNew}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityState={{ selected: !activeId }}
          accessibilityLabel="New chat"
          style={({ hovered, pressed }) => [
            styles.listNewChatHit,
            (hovered || pressed) && styles.listNewChatHitOn,
          ]}
        >
          <Ionicons name="create-outline" size={22} color={INK} />
        </Pressable>
      </View>
      <ScrollView
        style={styles.sideScroll}
        contentContainerStyle={[
          styles.sideScrollContent,
          ready && !history.length && styles.sideScrollEmpty,
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {!ready ? (
          <ActivityIndicator color="#8e8e93" style={styles.sideSpinner} />
        ) : history.length ? (
          history.map((chat) => {
            const selected = chat.id === activeId;
            const busy = busyId === chat.id;
            const pinned = Boolean(chat.pinned);
            const menuOpen = menuChatId === chat.id;
            const showMore = menuOpen || hoverChatId === chat.id || Platform.OS !== 'web';
            return (
              <View
                key={chat.id}
                style={[styles.chatRowWrap, menuOpen && styles.chatRowMenuOpen]}
                {...(Platform.OS === 'web'
                  ? {
                      onMouseEnter: () => setHoverChatId(chat.id),
                      onMouseLeave: () => setHoverChatId((current) => (current === chat.id ? null : current)),
                    }
                  : null)}
              >
                <Pressable
                  onPress={() => {
                    setMenuChatId(null);
                    openChat(chat.id);
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={chat.title}
                  style={[
                    styles.chatRow,
                    selected && styles.chatRowOn,
                    hoverChatId === chat.id && !selected && styles.chatRowHover,
                  ]}
                >
                  <View style={styles.chatRowTitleLine}>
                    <View style={[styles.chatDot, (selected || pinned) && styles.chatDotOn]} />
                    <Text style={[styles.chatRowTitle, selected && styles.chatRowTitleOn]} numberOfLines={1}>
                      {chat.title}
                    </Text>
                    {busy ? <ActivityIndicator size="small" color={SECONDARY} style={styles.chatRowSpinner} /> : null}
                  </View>
                </Pressable>
                {showMore ? (
                  <Pressable
                    onPress={(event) => {
                      event?.stopPropagation?.();
                      event?.preventDefault?.();
                      setMenuChatId(menuOpen ? null : chat.id);
                    }}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={`Options for ${chat.title}`}
                    style={({ hovered, pressed }) => [
                      styles.chatMoreHit,
                      (hovered || pressed || menuOpen) && styles.chatMoreHitOn,
                    ]}
                  >
                    <Ionicons name="ellipsis-vertical" size={16} color={SECONDARY} />
                  </Pressable>
                ) : null}
                    {menuOpen ? (
                      <View style={styles.chatMenu}>
                        <Pressable
                          onPress={(event) => {
                            event?.stopPropagation?.();
                            togglePin(chat.id);
                            setMenuChatId(null);
                          }}
                          accessibilityRole="button"
                          style={({ hovered: itemHovered, pressed }) => [
                            styles.chatMenuItem,
                            (itemHovered || pressed) && styles.chatMenuItemHover,
                          ]}
                        >
                          <Ionicons name={pinned ? 'pin' : 'pin-outline'} size={15} color={INK} />
                          <Text style={styles.chatMenuText}>{pinned ? 'Unpin' : 'Pin'}</Text>
                        </Pressable>
                        <Pressable
                          onPress={(event) => {
                            event?.stopPropagation?.();
                            setMenuChatId(null);
                            removeChat(chat.id);
                          }}
                          accessibilityRole="button"
                          style={({ hovered: itemHovered, pressed }) => [
                            styles.chatMenuItem,
                            (itemHovered || pressed) && styles.chatMenuItemHover,
                          ]}
                        >
                          <Ionicons name="trash-outline" size={15} color="#b91c1c" />
                          <Text style={styles.chatMenuDelete}>Delete</Text>
                        </Pressable>
                      </View>
                    ) : null}
              </View>
            );
          })
        ) : (
          <View style={styles.sideEmptyWrap}>
            <View style={styles.sideEmptyMark}>
              <Ionicons name="chatbubbles-outline" size={18} color={SECONDARY} />
            </View>
            <Text style={styles.sideEmptyTitle}>No chats yet</Text>
            <Text style={styles.sideEmpty}>Saved threads appear here after you send a message.</Text>
          </View>
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
          <View style={styles.listHeadSpacer} />
          {onClose ? (
            <Pressable
              onPress={onClose}
              hitSlop={8}
              style={styles.chromeCircle}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <Ionicons name="close" size={16} color={INK} />
            </Pressable>
          ) : (
            <View style={styles.chromeCircleGhost} />
          )}
        </View>
      ) : null}
      <ScrollView
        ref={scrollRef}
        style={styles.threadScroll}
        contentContainerStyle={[
          styles.threadContent,
          !turns.length && styles.threadEmpty,
          !turns.length && (compact ? styles.threadEmptyPhone : styles.threadEmptyDesktop),
        ]}
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
                  {mine ? <AttachmentChips items={turn.attachments} mine /> : null}
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
                        ) : chart.type === 'file' ? (
                          <AnalyticsFileCard key={`${chart.type}-${chartIndex}`} chart={chart} onRebuild={rebuildFile} />
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
              Chart questions start from the last 7 days of transactions by employee. Live stock, tills, hours, reviews, and other company data can span any period you ask for.
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
        {composerMeta ? (
          <Text style={styles.composerMeta} numberOfLines={1}>
            {composerMeta}
          </Text>
        ) : null}
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
        {attaching ? (
          <View style={styles.attachBusy}>
            <ActivityIndicator size="small" color={SECONDARY} />
            <Text style={styles.attachBusyText} numberOfLines={1}>
              {attaching}
            </Text>
          </View>
        ) : null}
        <AttachmentChips items={pending} onRemove={removePending} />
        <View
          style={[
            styles.composerPill,
            inputHeight > COMPOSER_LINE_HEIGHT && styles.composerPillMultiline,
          ]}
        >
          <Pressable
            onPress={addFiles}
            disabled={Boolean(attaching) || Boolean(busyId)}
            accessibilityRole="button"
            accessibilityLabel="Attach a photo, video, spreadsheet, PDF, or document"
            style={({ hovered, pressed }) => [
              styles.composerLead,
              (hovered || pressed) && styles.composerLeadHover,
              (attaching || busyId) && styles.composerLeadOff,
            ]}
          >
            <Ionicons name="add" size={20} color={INK} />
          </Pressable>
          <TextInput
            ref={inputRef}
            value={draft}
            onChangeText={setDraft}
            placeholder={composerPlaceholder}
            placeholderTextColor={SECONDARY}
            editable={!busyId && !blocked}
            multiline
            blurOnSubmit={false}
            scrollEnabled={inputHeight >= composerMaxHeight}
            style={[styles.composerInput, { height: inputHeight, maxHeight: composerMaxHeight }]}
            onContentSizeChange={syncInputHeight}
            {...Platform.select({
              ios: { textAlignVertical: inputHeight > COMPOSER_LINE_HEIGHT ? 'top' : 'center' },
              android: { textAlignVertical: inputHeight > COMPOSER_LINE_HEIGHT ? 'top' : 'center' },
              default: {},
            })}
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
          <View style={styles.composerTrail}>
            <Pressable
              onPress={() => setModelOpen(true)}
              accessibilityRole="button"
              accessibilityLabel={`Model, ${modelLabel}${modelTag ? `, ${modelTag}` : ''}`}
              style={({ hovered, pressed }) => [
                styles.composerModel,
                (hovered || pressed) && styles.composerModelHover,
              ]}
            >
              <Text style={styles.composerModelText} numberOfLines={1}>
                {modelLabel}
              </Text>
              <Ionicons name="chevron-down" size={12} color={SECONDARY} />
            </Pressable>
            <Pressable
              disabled
              accessibilityRole="button"
              accessibilityLabel="Voice input not available"
              accessibilityState={{ disabled: true }}
              style={styles.composerMic}
            >
              <Ionicons name="mic-outline" size={18} color={SECONDARY} />
            </Pressable>
            <Pressable
              onPress={() => (streaming ? stopStreaming() : send())}
              disabled={!streaming && !canSend}
              accessibilityRole="button"
              accessibilityLabel={streaming ? 'Stop' : 'Send'}
              style={[
                styles.composerAction,
                streaming || canSend ? styles.composerActionOn : styles.composerActionOff,
              ]}
            >
              {streaming ? (
                <View style={styles.composerStopMark} />
              ) : (
                <Ionicons name="arrow-up" size={16} color="#fff" />
              )}
            </Pressable>
          </View>
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
    width: 320,
    flexShrink: 0,
    flexDirection: 'column',
    minHeight: 0,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: RULE,
    backgroundColor: CANVAS,
  },
  sidebarPhone: {
    width: '100%',
    flex: 1,
    borderRightWidth: 0,
    backgroundColor: CANVAS,
  },
  listHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    minHeight: 52,
    marginHorizontal: 0,
    paddingHorizontal: 8,
    paddingVertical: 6,
    gap: 4,
    flexShrink: 0,
    backgroundColor: CANVAS,
  },
  listHeadSpacer: {
    flex: 1,
    minWidth: 0,
  },
  listNewChatHit: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    borderRadius: 20,
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  listNewChatHitOn: {
    backgroundColor: 'rgba(0,0,0,0.05)',
  },
  sideScroll: {
    flex: 1,
    minHeight: 0,
  },
  sideScrollContent: {
    marginHorizontal: 0,
    paddingHorizontal: 0,
    paddingBottom: 22,
  },
  sideScrollEmpty: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingTop: 12,
    paddingBottom: 32,
  },
  sideSpinner: {
    marginTop: 28,
    alignSelf: 'center',
  },
  sideEmptyWrap: {
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
  },
  sideEmptyMark: {
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
  sideEmptyTitle: {
    fontFamily: FONT,
    fontSize: 14,
    fontWeight: '500',
    color: INK,
    letterSpacing: -0.2,
    textAlign: 'center',
  },
  sideEmpty: {
    fontFamily: FONT,
    fontSize: 13,
    lineHeight: 18,
    color: SECONDARY,
    textAlign: 'center',
  },
  chatRowWrap: {
    position: 'relative',
    width: '100%',
  },
  chatRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 48,
    paddingVertical: 12,
    paddingLeft: 16,
    paddingRight: 12,
    backgroundColor: CANVAS,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: RULE,
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  chatRowMenuOpen: {
    zIndex: 4,
  },
  chatRowTitleLine: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingRight: 28,
  },
  chatDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: '#d1d1d6',
    backgroundColor: 'transparent',
    flexShrink: 0,
  },
  chatDotOn: {
    borderColor: INK,
    backgroundColor: INK,
  },
  chatRowOn: {
    backgroundColor: '#f2f2f7',
  },
  chatRowHover: {
    backgroundColor: '#f2f2f7',
  },
  chatRowTitle: {
    flex: 1,
    minWidth: 0,
    fontFamily: FONT,
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '400',
    color: '#636366',
    letterSpacing: -0.2,
  },
  chatRowTitleOn: {
    color: '#3a3a3c',
  },
  chatRowSpinner: {
    flexShrink: 0,
  },
  chatMoreHit: {
    position: 'absolute',
    right: 8,
    top: 0,
    bottom: 0,
    width: 32,
    zIndex: 3,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  chatMoreHitOn: {
    backgroundColor: 'rgba(0,0,0,0.06)',
  },
  chatMenu: {
    position: 'absolute',
    top: 40,
    right: 8,
    minWidth: 148,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: '#fff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,0,0,0.08)',
    zIndex: 5,
    ...Platform.select({
      web: { boxShadow: '0 8px 24px rgba(0,0,0,0.12)' },
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.12,
        shadowRadius: 16,
        elevation: 6,
      },
    }),
  },
  chatMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  chatMenuItemHover: {
    backgroundColor: '#f5f5f7',
  },
  chatMenuText: {
    fontFamily: FONT,
    fontSize: 14,
    color: INK,
  },
  chatMenuDelete: {
    fontFamily: FONT,
    fontSize: 14,
    color: '#b91c1c',
  },
  rowHover: {
    backgroundColor: '#f5f5f5',
  },
  main: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    flexDirection: 'column',
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
  chromeCircleGhost: {
    width: 32,
    height: 32,
    flexShrink: 0,
  },
  threadScroll: {
    flex: 1,
    minHeight: 0,
  },
  threadContent: {
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 20,
    gap: 14,
  },
  threadEmpty: {
    flexGrow: 1,
  },
  threadEmptyDesktop: {
    justifyContent: 'flex-start',
    paddingTop: 56,
    paddingBottom: 28,
    ...Platform.select({
      web: { minHeight: '100%' },
      default: {},
    }),
  },
  threadEmptyPhone: {
    justifyContent: 'flex-start',
    paddingTop: 28,
    paddingBottom: 16,
  },
  empty: {
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 8,
    width: '100%',
  },
  emptyMark: {
    width: 44,
    height: 44,
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
    lineHeight: 21,
    color: '#8e8e93',
    textAlign: 'center',
    maxWidth: 480,
    marginTop: 2,
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
    gap: 10,
    marginTop: 20,
    maxWidth: 560,
  },
  suggest: {
    maxWidth: '100%',
    paddingHorizontal: 14,
    paddingVertical: 10,
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
    maxWidth: 720,
    alignSelf: 'center',
    flexShrink: 0,
    paddingHorizontal: 24,
    paddingTop: 10,
    paddingBottom: Platform.select({ web: 22, ios: 28, default: 18 }),
    gap: 8,
    backgroundColor: CANVAS,
  },
  composerMeta: {
    fontFamily: FONT,
    fontSize: 11,
    lineHeight: 14,
    color: SECONDARY,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  composerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 48,
    paddingLeft: 8,
    paddingRight: 8,
    paddingVertical: 4,
    gap: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: CHIP_BORDER,
    backgroundColor: BUBBLE_THEM_BG,
    ...CHIP_SHADOW,
  },
  composerPillMultiline: {
    alignItems: 'flex-end',
    paddingVertical: 8,
  },
  composerLead: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: CANVAS,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: BUBBLE_THEM_BORDER,
    flexShrink: 0,
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  composerLeadHover: {
    backgroundColor: NAV_TAB_ACTIVE_BG,
  },
  composerLeadOff: {
    opacity: 0.4,
  },
  attachBusy: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 4,
    paddingBottom: 6,
  },
  attachBusyText: {
    fontFamily: FONT,
    fontSize: 12,
    color: SECONDARY,
    flexShrink: 1,
  },
  attachRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    paddingBottom: 8,
  },
  attachRowMine: {
    justifyContent: 'flex-end',
    paddingBottom: 6,
  },
  attachChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    maxWidth: 260,
    paddingLeft: 6,
    paddingRight: 8,
    paddingVertical: 5,
    borderRadius: NAV_TAB_ACTIVE_RADIUS,
    borderWidth: 1,
    borderColor: CHIP_BORDER,
    backgroundColor: CANVAS,
  },
  attachChipMine: {
    borderColor: INK,
    backgroundColor: INK,
  },
  attachThumb: {
    width: 32,
    height: 32,
    borderRadius: 4,
    backgroundColor: NAV_TAB_ACTIVE_BG,
  },
  attachIcon: {
    width: 32,
    height: 32,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: NAV_TAB_ACTIVE_BG,
  },
  attachIconMine: {
    backgroundColor: '#3a3a3c',
  },
  attachCopy: {
    flexShrink: 1,
    minWidth: 0,
    gap: 1,
  },
  attachName: {
    fontFamily: FONT,
    fontSize: 12,
    fontWeight: '500',
    color: INK,
  },
  attachNameMine: {
    color: '#fff',
  },
  attachMeta: {
    fontFamily: FONT,
    fontSize: 11,
    color: SECONDARY,
  },
  attachMetaMine: {
    color: 'rgba(255,255,255,0.72)',
  },
  attachRemove: {
    marginLeft: 2,
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  composerInput: {
    flex: 1,
    minWidth: 0,
    minHeight: COMPOSER_LINE_HEIGHT,
    paddingVertical: 0,
    paddingHorizontal: 4,
    backgroundColor: 'transparent',
    fontFamily: FONT,
    fontSize: 15,
    lineHeight: COMPOSER_LINE_HEIGHT,
    color: INK,
    ...Platform.select({
      web: { outlineStyle: 'none', lineHeight: `${COMPOSER_LINE_HEIGHT}px`, padding: 0, resize: 'none' },
      default: {},
    }),
  },
  composerTrail: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    flexShrink: 0,
    maxWidth: '46%',
  },
  composerModel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    maxWidth: 148,
    minHeight: 32,
    paddingHorizontal: 8,
    borderRadius: 999,
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  composerModelHover: {
    backgroundColor: 'rgba(0,0,0,0.04)',
  },
  composerModelText: {
    flexShrink: 1,
    fontFamily: FONT,
    fontSize: 13,
    fontWeight: '400',
    color: SECONDARY,
    letterSpacing: -0.1,
  },
  composerMic: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.45,
    flexShrink: 0,
  },
  composerAction: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  composerActionOn: {
    backgroundColor: INK,
  },
  composerActionOff: {
    backgroundColor: '#c7c7cc',
  },
  composerStopMark: {
    width: 12,
    height: 12,
    borderRadius: 2,
    backgroundColor: '#fff',
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
  composerHint: {
    fontFamily: FONT,
    fontSize: 11,
    lineHeight: 14,
    color: SECONDARY,
    textAlign: 'center',
    ...Platform.select({ web: { display: 'none' }, default: {} }),
  },
});
