import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
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
import { parseDocReference } from '../lib/transactions';
import {
  avatarColorForId,
  contactName,
  formatInboxTime,
  initialsFromName,
  isDefaultAiTitle,
  listDmContacts,
  mapIncomingDmMessage,
  renameDmGroup,
  subscribeDmRealtime,
} from '../lib/messages';
import {
  hydrateAiDmChat,
  listSharedAiChats,
  mergeLocalAndSharedAiChats,
  persistMissingAiTurns,
  shareAiChat,
} from '../lib/aiDmShare';
import AnalyticsChartCard from './AnalyticsChartCard';
import AnalyticsMapCard from './AnalyticsMapCard';
import AnalyticsTableCard from './AnalyticsTableCard';
import AnalyticsFileCard from './AnalyticsFileCard';
import SendFromInput from './SendFromInput';
import {
  MAX_ATTACHMENTS,
  attachmentLabel,
  formatBytes,
  pickFiles,
  prepareAttachment,
  storableAttachment,
} from '../lib/aiAttachments';
import { CANVAS, MOBILE, NAV_TAB_ACTIVE_BG, NAV_TAB_ACTIVE_RADIUS } from '../lib/mobileUi';
import { FONT, FONT_LIGHT } from '../lib/typography';
import { MobileFeedTopBarActions } from './MobileChrome';

const MODEL_KEY = 'cgold.analytics.aiModel';

const INK = '#1a1a1a';
const CHIP_BORDER = '#d0d0d0';
const CHIP_RADIUS = 6;
const BUBBLE_RADIUS = 20;
const BUBBLE_TAIL = 5;
const RULE = 'rgba(42,38,30,0.08)';
const SECONDARY = '#8e8e93';
const BUBBLE_MINE = MOBILE.blue;
const BUBBLE_THEM_BG = '#e9e9eb';
const BUBBLE_THEM_BORDER = 'rgba(60, 60, 67, 0.08)';
const COMPOSER_LINE_HEIGHT = 22;
const COMPOSER_MAX_LINES = 4;
const SIDEBAR_WIDTH = 320;

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
const COMPOSER_PILL_IDLE_SHADOW = Platform.select({
  web: { boxShadow: '0 1px 2px rgba(0,0,0,0.03)' },
  default: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 2,
    elevation: 0,
  },
});
const COMPOSER_PILL_ACTIVE_SHADOW = Platform.select({
  web: { boxShadow: '0 2px 8px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)' },
  default: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 5,
    elevation: 1,
  },
});
const CHATS_KEY = 'cgold.analytics.aiChats';
const PROMPTS_KEY = 'cgold.analytics.savedPrompts';
const MAX_CHATS = 20;
const MAX_TURNS = 20;
const MAX_TURN_CHARS = 6000;
const MAX_PROMPTS = 40;
const MAX_PROMPT_CHARS = 4000;
// A year of daily points, matching MAX_LINE_POINTS in lib/analyticsChartTools.
const MAX_CHART_POINTS = 370;

function storageKey(userKey) {
  return `${CHATS_KEY}.${userKey || 'local'}`;
}

function promptsStorageKey(userKey) {
  return `${PROMPTS_KEY}.${userKey || 'local'}`;
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

function byChatOrder(a, b) {
  const pin = Number(Boolean(b.pinned)) - Number(Boolean(a.pinned));
  if (pin) return pin;
  return String(b.updatedAt).localeCompare(String(a.updatedAt));
}

function isUnusedPlaceholder(chat) {
  if (!chat?.placeholder) return false;
  return !(chat.turns || []).some((turn) => turn.role === 'user' && String(turn.content || '').trim());
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
      categories: chart.categories.slice(0, MAX_CHART_POINTS).map((item) => String(item).slice(0, 24)),
      series: chart.series.slice(0, 8).map((series) => ({
        key: String(series.key || ''),
        label: String(series.label || '').slice(0, 40),
        format: ['money', 'decimal', 'hours'].includes(series.format) ? series.format : 'int',
        axis: series.axis === 'right' ? 'right' : 'left',
        values: (series.values || []).slice(0, MAX_CHART_POINTS).map((value) => Number(value) || 0),
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
      if (turn.senderId) next.senderId = String(turn.senderId);
      if (turn.messageId) next.messageId = String(turn.messageId);
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
        conversationId: String(item?.conversationId || ''),
        title: String(item?.title || 'New analysis').slice(0, 80),
        scopeLabel: String(item?.scopeLabel || ''),
        createdAt: String(item?.createdAt || ''),
        updatedAt: String(item?.updatedAt || item?.createdAt || ''),
        pinned: Boolean(item?.pinned),
        placeholder: Boolean(item?.placeholder),
        members: Array.isArray(item?.members) ? item.members : [],
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

function parsePrompts(raw) {
  try {
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return list
      .map((item) => ({
        id: String(item?.id || ''),
        text: String(item?.text || '').trim().slice(0, MAX_PROMPT_CHARS),
        createdAt: String(item?.createdAt || ''),
      }))
      .filter((item) => item.id && item.text);
  } catch {
    return [];
  }
}

async function loadPrompts(userKey) {
  try {
    return parsePrompts(await AsyncStorage.getItem(promptsStorageKey(userKey)));
  } catch {
    return [];
  }
}

async function writePrompts(userKey, rows) {
  const slim = (Array.isArray(rows) ? rows : [])
    .map((item) => ({
      id: String(item?.id || ''),
      text: String(item?.text || '').trim().slice(0, MAX_PROMPT_CHARS),
      createdAt: String(item?.createdAt || ''),
    }))
    .filter((item) => item.id && item.text)
    .slice(0, MAX_PROMPTS);
  await AsyncStorage.setItem(promptsStorageKey(userKey), JSON.stringify(slim));
}

async function copyToClipboard(text) {
  const value = String(text || '');
  if (!value) return false;
  if (Platform.OS === 'web' && typeof navigator !== 'undefined') {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        return true;
      }
    } catch {
      // Fall through to the document copy path.
    }
    try {
      const field = document.createElement('textarea');
      field.value = value;
      field.setAttribute('readonly', '');
      field.style.position = 'fixed';
      field.style.left = '-9999px';
      document.body.appendChild(field);
      field.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(field);
      return ok;
    } catch {
      return false;
    }
  }
  return false;
}

async function writeChats(userKey, chats) {
  const slim = (Array.isArray(chats) ? chats : [])
    .map((chat) => ({
      id: chat.id,
      conversationId: chat.conversationId || '',
      title: String(chat.title || 'New analysis').slice(0, 80),
      scopeLabel: String(chat.scopeLabel || ''),
      createdAt: chat.createdAt,
      updatedAt: chat.updatedAt,
      pinned: Boolean(chat.pinned),
      placeholder: Boolean(chat.placeholder),
      members: Array.isArray(chat.members) ? chat.members : [],
      turns: storedTurns(chat.turns),
    }))
    .filter((chat) => chat.id && (chat.placeholder || chat.turns.some((turn) => turn.role === 'user')))
    .sort(byChatOrder)
    .slice(0, MAX_CHATS);
  await AsyncStorage.setItem(storageKey(userKey), JSON.stringify(slim));
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
function TicketText({ text, style, linkStyle, resolveTicket, onOpenDocument }) {
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
            style={[styles.ticketLink, linkStyle]}
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

function firstNameOfSession(session) {
  const first = String(session?.profile?.firstName || '').trim();
  if (first) return first;
  const full = String(session?.profile?.fullName || '').trim();
  return full.split(/\s+/)[0] || '';
}

function firstNameOfPerson(person) {
  const first = String(person?.firstName || '').trim();
  if (first) return first;
  return contactName(person).split(/\s+/)[0] || 'Teammate';
}

function PersonMark({ person, size = 28 }) {
  const name = contactName(person);
  const uri = String(person?.avatarUrl || '').trim();
  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: '#e8e8ed' }}
        accessibilityLabel={name}
      />
    );
  }
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: avatarColorForId(person?.id || name),
      }}
    >
      <Text style={{ color: '#fff', fontFamily: FONT, fontSize: Math.max(10, Math.round(size * 0.36)), fontWeight: '600' }}>
        {initialsFromName(name) || '?'}
      </Text>
    </View>
  );
}

/**
 * `embedded`: hosted inside another screen (Direct Messages). Opens straight
 * into that conversation (`conversationId`) and writes turns there so people
 * you add can see the history and talk to the AI with you.
 * `title` names the assistant in the header, the bubble label, and the placeholder.
 * `startBlank` opens a new empty chat (Talk to AI). `onMobileHeader` puts New
 * chat / history on the app top bar so a phone does not stack two headers.
 */
export default function AnalyticsAiPanel({
  session,
  compact = false,
  active = true,
  onClose = null,
  storeFilter,
  onOpenCustomer,
  onOpenDocument,
  embedded = false,
  conversationId = '',
  members = null,
  startBlank = false,
  onBlankStarted = null,
  onNewChat = null,
  onInboxChanged = null,
  shareApiRef = null,
  onMobileHeader = null,
  title = 'Analytics',
}) {
  const userKey = session?.supabaseUserId || session?.profile?.id || '';
  const myId = session?.supabaseUserId || session?.profile?.id || '';
  const firstName = firstNameOfSession(session);
  const [chats, setChats] = useState([]);
  const [ready, setReady] = useState(false);
  const [activeId, setActiveId] = useState(null);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState([]);
  const [attaching, setAttaching] = useState('');
  const [busyId, setBusyId] = useState('');
  const [busyNote, setBusyNote] = useState('');
  const [error, setError] = useState('');
  const [mobileList, setMobileList] = useState(false);
  const [model, setModel] = useState(ANALYTICS_CHAT_MODELS[0].key);
  const [modelOpen, setModelOpen] = useState(false);
  const [savedPrompts, setSavedPrompts] = useState([]);
  const [promptsOpen, setPromptsOpen] = useState(false);
  const [copiedKey, setCopiedKey] = useState('');
  const [savedKey, setSavedKey] = useState('');
  const [menuChatId, setMenuChatId] = useState(null);
  const [hoverChatId, setHoverChatId] = useState(null);
  const [people, setPeople] = useState([]);
  const [shareOpen, setShareOpen] = useState(false);
  const [sharing, setSharing] = useState(false);
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
  const onBlankStartedRef = useRef(onBlankStarted);
  onBlankStartedRef.current = onBlankStarted;
  const startBlankRef = useRef(startBlank);
  startBlankRef.current = startBlank;
  const onMobileHeaderRef = useRef(onMobileHeader);
  onMobileHeaderRef.current = onMobileHeader;
  const onInboxChangedRef = useRef(onInboxChanged);
  onInboxChangedRef.current = onInboxChanged;
  const conversationIdRef = useRef(conversationId);
  conversationIdRef.current = conversationId;
  const scrollRef = useRef(null);
  const inputRef = useRef(null);
  const composerPillRef = useRef(null);
  const sendPop = useRef(new Animated.Value(1)).current;
  const [inputHeight, setInputHeight] = useState(COMPOSER_LINE_HEIGHT);
  const [composerHover, setComposerHover] = useState(false);
  const [composerFocus, setComposerFocus] = useState(false);
  const [sentAnim, setSentAnim] = useState(null);
  const composerActive = composerHover || composerFocus;
  const composerMaxHeight = COMPOSER_LINE_HEIGHT * COMPOSER_MAX_LINES;

  // Kept on each saved chat for older entries that recorded one; new chats
  // start from nothing but the store lock.
  const scopeLabel = storeFilter ? String(storeFilter) : '';
  const suggestions = useMemo(
    () =>
      compact
        ? ['Volume by day', 'By store (pie)', 'This month by person', 'Where customers live']
        : [
            'Transactions per employee at Montreal over the past month',
            'Transactions and volume by day',
            'Volume by store as a pie chart',
            'Where do Montreal customers live?',
          ],
    [compact],
  );
  const blocked = !ready;
  const history = useMemo(
    () =>
      chats
        .filter((chat) => chat.placeholder || chat.turns.some((turn) => turn.role === 'user' && String(turn.content || '').trim()))
        .sort(byChatOrder),
    [chats],
  );
  const activeChat = history.find((chat) => chat.id === activeId) || null;
  const activeMembers = (Array.isArray(members) && members.length
    ? members
    : activeChat?.members) || [];
  const turns = (activeChat?.turns || []).filter((turn) => turn.role === 'user' || turn.role === 'assistant');
  const showList = compact && mobileList && !embedded;
  const tail = turns[turns.length - 1]?.content || '';
  // After a reload a file card only has its sheet specs; run them again to get the rows.
  const rebuildFile = async (chart) => {
    const context = {
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
    listDmContacts()
      .then((rows) => {
        if (alive) setPeople(rows);
      })
      .catch(() => {
        if (alive) setPeople([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    const seen = revisionRef.current;
    setReady(false);
    activeIdRef.current = null;
    setActiveId(null);
    setMobileList(false);
    setError('');
    const boot = async () => {
      const local = await loadChats(userKey);
      let shared = [];
      try {
        shared = await listSharedAiChats();
      } catch {
        shared = [];
      }
      if (!alive) return;
      let rows = mergeLocalAndSharedAiChats(local, shared);
      const boundId = conversationIdRef.current;
      if (boundId) {
        const current = rows.find((chat) => chat.conversationId === boundId || chat.id === boundId);
        const seed = !startBlankRef.current
          ? current || rows.slice().sort(byChatOrder)[0]
          : current;
        try {
          const hydrated = await hydrateAiDmChat(
            {
              id: boundId,
              conversationId: boundId,
              title: seed?.title || 'New chat',
              scopeLabel: seed?.scopeLabel || '',
              createdAt: seed?.createdAt || new Date().toISOString(),
              updatedAt: seed?.updatedAt || new Date().toISOString(),
              pinned: Boolean(seed?.pinned),
              placeholder: true,
              members: seed?.members || [],
              turns: seed?.turns || [],
            },
            myId,
          );
          if (!hydrated.turns.length && seed?.turns?.length && !startBlankRef.current) {
            hydrated.turns = seed.turns;
            hydrated.placeholder = false;
          }
          rows = [
            hydrated,
            ...rows.filter((chat) => chat.conversationId !== boundId && chat.id !== boundId),
          ];
        } catch {
          rows = [
            {
              id: boundId,
              conversationId: boundId,
              title: seed?.title || 'New chat',
              scopeLabel: seed?.scopeLabel || '',
              createdAt: seed?.createdAt || new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              pinned: false,
              placeholder: !seed?.turns?.length,
              members: seed?.members || [],
              turns: startBlankRef.current ? [] : seed?.turns || [],
            },
            ...rows.filter((chat) => chat.conversationId !== boundId && chat.id !== boundId),
          ];
        }
      }
      if (!alive || revisionRef.current !== seen) return;
      chatsRef.current = rows;
      setChats(rows);
      setReady(true);
      if (boundId) {
        activeIdRef.current = boundId;
        setActiveId(boundId);
        return;
      }
      if (embedded && !startBlankRef.current && rows.length) {
        const latest = rows.slice().sort(byChatOrder)[0];
        if (latest) {
          activeIdRef.current = latest.id;
          setActiveId(latest.id);
        }
      }
    };
    boot();
    loadPrompts(userKey).then((rows) => {
      if (alive) setSavedPrompts(rows);
    });
    return () => {
      alive = false;
    };
  }, [userKey, embedded, conversationId, myId]);

  useEffect(() => {
    if (!active || showList || activeId) return undefined;
    if (Platform.OS !== 'web') return undefined;
    const timer = setTimeout(() => inputRef.current?.focus?.(), 60);
    return () => clearTimeout(timer);
  }, [active, showList, activeId]);

  useEffect(() => {
    if (!active || showList) return undefined;
    const frame = requestAnimationFrame(() =>
      scrollRef.current?.scrollToEnd?.({ animated: !sentAnim }),
    );
    return () => cancelAnimationFrame(frame);
  }, [active, showList, activeId, turns.length, tail, sentAnim]);

  useEffect(() => {
    if (!draft) setInputHeight(COMPOSER_LINE_HEIGHT);
  }, [draft]);

  const syncInputHeight = (event) => {
    const raw = event?.nativeEvent?.contentSize?.height;
    if (!Number.isFinite(raw) || raw <= 0) return;
    const next = Math.ceil(raw);
    setInputHeight(Math.min(composerMaxHeight, Math.max(COMPOSER_LINE_HEIGHT, next)));
  };

  const startNew = useCallback(() => {
    if (embedded && onNewChat) {
      onNewChat();
      return;
    }
    const unused = chatsRef.current.find(isUnusedPlaceholder);
    if (unused) {
      selectChat(unused.id);
      setDraft('');
      setError('');
      setMenuChatId(null);
      setMobileList(false);
      setSentAnim(null);
      return;
    }
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
    setSentAnim(null);
  }, [embedded, onNewChat, scopeLabel]);

  const didAutoBlankRef = useRef(false);
  useEffect(() => {
    if (!ready) {
      didAutoBlankRef.current = false;
      return;
    }
    if (startBlank) {
      if (!embedded) startNew();
      onBlankStartedRef.current?.();
      return;
    }
    if (!embedded && !didAutoBlankRef.current) {
      didAutoBlankRef.current = true;
      startNew();
    }
  }, [ready, startBlank, embedded, startNew]);

  const mobileTopBarTrailing = useMemo(
    () => (
      <MobileFeedTopBarActions>
        <Pressable
          onPress={() => setMobileList((open) => !open)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={mobileList ? 'Back to chat' : 'Chats'}
          style={({ hovered, pressed }) => [
            styles.listNewChatHit,
            (hovered || pressed) && styles.listNewChatHitOn,
          ]}
        >
          <Ionicons name={mobileList ? 'close-outline' : 'chatbubbles-outline'} size={20} color={INK} />
        </Pressable>
        <Pressable
          onPress={() => setShareOpen(true)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Add people to this chat"
          style={({ hovered, pressed }) => [
            styles.listNewChatHit,
            (hovered || pressed) && styles.listNewChatHitOn,
          ]}
        >
          <Ionicons name="person-add-outline" size={20} color={INK} />
        </Pressable>
        <Pressable
          onPress={startNew}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="New chat"
          style={({ hovered, pressed }) => [
            styles.listNewChatHit,
            (hovered || pressed) && styles.listNewChatHitOn,
          ]}
        >
          <Ionicons name="create-outline" size={22} color={INK} />
        </Pressable>
      </MobileFeedTopBarActions>
    ),
    [mobileList, startNew],
  );

  useEffect(() => {
    const setHeader = onMobileHeaderRef.current;
    if (!setHeader) return undefined;
    if (!compact || embedded) {
      setHeader(null);
      return () => setHeader(null);
    }
    setHeader({ trailing: mobileTopBarTrailing });
    return () => setHeader(null);
  }, [compact, embedded, mobileTopBarTrailing]);

  const openChat = (id) => {
    selectChat(id);
    setDraft('');
    setError('');
    setMobileList(false);
    setSentAnim(null);
    const chat = chatsRef.current.find((item) => item.id === id);
    if (!chat?.conversationId || !chat.previewOnly) return;
    hydrateAiDmChat(chat, myId)
      .then((hydrated) => {
        commit((current) => current.map((item) => (item.id === id ? hydrated : item)));
      })
      .catch(() => {});
  };

  const addPeopleToActive = useCallback(async (memberIds) => {
    const ids = [...new Set((Array.isArray(memberIds) ? memberIds : []).filter(Boolean))];
    if (!ids.length) return;
    const chat = chatsRef.current.find((item) => item.id === activeIdRef.current);
    if (!chat) throw new Error('Open a chat first.');
    setSharing(true);
    try {
      const conversation = await shareAiChat({
        conversationId: chat.conversationId || conversationIdRef.current,
        title: chat.title,
        turns: chat.turns,
        memberIds: ids,
      });
      const added = people.filter((person) => ids.includes(person.id));
      const known = new Set((chat.members || []).map((person) => person.id));
      commit((current) =>
        current.map((item) =>
          item.id === chat.id
            ? {
                ...item,
                id: conversation,
                conversationId: conversation,
                members: [...(item.members || []), ...added.filter((person) => !known.has(person.id))],
              }
            : item,
        ),
        { persist: true },
      );
      if (activeIdRef.current === chat.id && chat.id !== conversation) {
        selectChat(conversation);
      }
      onInboxChangedRef.current?.();
    } finally {
      setSharing(false);
    }
  }, [people]);

  useEffect(() => {
    if (!shareApiRef) return undefined;
    shareApiRef.current = { addPeople: addPeopleToActive };
    return () => {
      if (shareApiRef.current?.addPeople === addPeopleToActive) {
        shareApiRef.current = null;
      }
    };
  }, [addPeopleToActive, shareApiRef]);

  useEffect(() => {
    const boundId = conversationId || activeChat?.conversationId;
    if (!boundId || !myId) return undefined;
    return subscribeDmRealtime({
      onMessage: (payload) => {
        const row = payload?.new;
        if (!row?.id || row.conversation_id !== boundId) return;
        if (payload.eventType !== 'INSERT') return;
        void mapIncomingDmMessage(row, myId).then((mapped) => {
          const turn = {
            role: mapped.isAssistant ? 'assistant' : 'user',
            content: String(mapped.body || '').trim(),
            charts: mapped.charts || [],
            attachments: mapped.attachments || [],
            senderId: mapped.senderId || '',
            messageId: mapped.id,
            createdAt: mapped.createdAt,
          };
          if (!turn.content && !turn.charts.length && !turn.attachments.length) return;
          commit((current) =>
            current.map((chat) => {
              if (chat.conversationId !== boundId && chat.id !== boundId) return chat;
              const turns = chat.turns || [];
              if (turns.some((item) => item.messageId === mapped.id)) return chat;
              const match = turns.findIndex(
                (item) =>
                  !item.messageId
                  && item.role === turn.role
                  && String(item.content || '').trim() === turn.content,
              );
              if (match >= 0) {
                const nextTurns = turns.slice();
                nextTurns[match] = { ...nextTurns[match], ...turn };
                return { ...chat, previewOnly: false, turns: nextTurns };
              }
              return {
                ...chat,
                placeholder: false,
                previewOnly: false,
                updatedAt: mapped.createdAt || chat.updatedAt,
                turns: [...turns.filter((item) => String(item.content || '').trim() || item.role === 'user'), turn],
              };
            }),
          );
        }).catch(() => {});
      },
      onParticipant: () => {
        onInboxChangedRef.current?.();
      },
    });
  }, [activeChat?.conversationId, conversationId, myId]);

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

  const persistPrompts = (rows) => {
    setSavedPrompts(rows);
    writePrompts(userKey, rows).catch(() => {
      if (mountedRef.current) setError('Could not save that prompt on this device.');
    });
  };

  const savePrompt = (text) => {
    const cleaned = String(text || '').trim().slice(0, MAX_PROMPT_CHARS);
    if (!cleaned) return false;
    if (savedPrompts.some((item) => item.text === cleaned)) return 'exists';
    persistPrompts([
      { id: chatId(), text: cleaned, createdAt: new Date().toISOString() },
      ...savedPrompts,
    ].slice(0, MAX_PROMPTS));
    return true;
  };

  const removePrompt = (id) => {
    persistPrompts(savedPrompts.filter((item) => item.id !== id));
  };

  const flashKey = (setter, key) => {
    setter(key);
    setTimeout(() => {
      if (!mountedRef.current) return;
      setter((current) => (current === key ? '' : current));
    }, 1400);
  };

  const copyTurn = async (key, text) => {
    const ok = await copyToClipboard(text);
    if (ok) flashKey(setCopiedKey, key);
    else if (mountedRef.current) setError('Could not copy to the clipboard.');
  };

  const saveTurn = (key, text) => {
    const result = savePrompt(text);
    if (!result) return;
    flashKey(setSavedKey, key);
  };

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
    setSentAnim({ chatId: id, content: text });
    sendPop.setValue(0.86);
    Animated.spring(sendPop, {
      toValue: 1,
      friction: 5,
      tension: 180,
      useNativeDriver: true,
    }).start();

    const stored = attachments.map(storableAttachment).filter(Boolean);
    const boundId = existing?.conversationId || conversationId || '';
    const userTurnBase = stored.length
      ? { role: 'user', content: text, attachments: stored, senderId: myId }
      : { role: 'user', content: text, senderId: myId };
    const nextChat = {
      id,
      conversationId: boundId || existing?.conversationId || '',
      title: nameThis ? fallbackTitle(text) : (existing?.title || fallbackTitle(text)),
      scopeLabel: existing?.scopeLabel || scopeLabel,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      pinned: Boolean(existing?.pinned),
      placeholder: false,
      members: existing?.members || [],
      turns: [...history, userTurnBase, { role: 'assistant', content: '' }],
    };
    commit((current) => {
      const rest = current.filter((chat) => chat.id !== id);
      return [nextChat, ...rest];
    }, { persist: true });

    if (boundId) {
      persistMissingAiTurns(boundId, [...history, userTurnBase])
        .then((stored) => {
          if (genRef.current.get(id) !== gen) return;
          commit((current) =>
            current.map((chat) => {
              if (chat.id !== id) return chat;
              const pending = (chat.turns || []).filter((turn) => turn.role === 'assistant' && !String(turn.content || '').trim());
              return { ...chat, conversationId: boundId, turns: [...stored, ...pending] };
            }),
          );
        })
        .catch(() => {});
    }

    try {
      const result = await askAnalytics({
        model,
        history,
        question: text,
        attachments,
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
      let storedTurns = savedTurns;
      if (boundId) {
        try {
          storedTurns = await persistMissingAiTurns(boundId, savedTurns);
        } catch {
          // Keep the answer on this device even if the shared thread is late.
        }
      }
      commit((current) =>
        current.map((chat) => (
          chat.id === id
            ? { ...chat, conversationId: boundId || chat.conversationId, turns: storedTurns, updatedAt: new Date().toISOString() }
            : chat
        )),
      { persist: true });
      if (boundId) onInboxChangedRef.current?.();
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
      if (boundId && named.title && !isDefaultAiTitle(named.title)) {
        renameDmGroup(boundId, named.title).catch(() => {});
      }
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
          setSentAnim((current) => (current?.chatId === id ? null : current));
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
  const composerPlaceholder = turns.length ? 'Send follow-up' : `Message ${title}…`;
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

  const promptsSheet = (
    <Modal
      visible={promptsOpen}
      transparent
      animationType="fade"
      onRequestClose={() => setPromptsOpen(false)}
    >
      <View style={styles.modelSheetRoot}>
        <Pressable
          style={styles.modelSheetBackdrop}
          accessibilityRole="button"
          accessibilityLabel="Close saved prompts"
          onPress={() => setPromptsOpen(false)}
        />
        <View style={[styles.modelSheetCard, compact && styles.modelSheetCardPhone]}>
          <View style={styles.modelSheetHead}>
            <Text style={styles.modelSheetTitle}>Saved prompts</Text>
            <Text style={styles.modelSheetSubtitle}>
              Pick one to send it now, or save what you have typed.
            </Text>
          </View>
          <ScrollView
            style={styles.modelSheetScroll}
            contentContainerStyle={styles.modelSheetScrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {draft.trim() ? (
              <Pressable
                onPress={() => {
                  const result = savePrompt(draft);
                  if (result) flashKey(setSavedKey, 'draft');
                }}
                accessibilityRole="button"
                accessibilityLabel="Save the message in the input"
                style={({ hovered, pressed }) => [
                  styles.promptSaveDraft,
                  (hovered || pressed) && styles.promptSaveDraftHover,
                ]}
              >
                <Ionicons
                  name={savedKey === 'draft' ? 'bookmark' : 'bookmark-outline'}
                  size={15}
                  color={INK}
                />
                <Text style={styles.promptSaveDraftText}>
                  {savedKey === 'draft' ? 'Saved' : "Save what's typed"}
                </Text>
              </Pressable>
            ) : null}
            {savedPrompts.length ? (
              savedPrompts.map((item) => (
                <View key={item.id} style={styles.promptRow}>
                  <Pressable
                    onPress={() => {
                      setPromptsOpen(false);
                      void send(item.text);
                    }}
                    disabled={Boolean(busyId) || blocked}
                    accessibilityRole="button"
                    accessibilityLabel={`Send saved prompt: ${item.text}`}
                    style={({ hovered, pressed }) => [
                      styles.promptPick,
                      (hovered || pressed) && styles.promptPickHover,
                      (busyId || blocked) && styles.promptPickOff,
                    ]}
                  >
                    <Text style={styles.promptPickText} numberOfLines={3}>
                      {item.text}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => removePrompt(item.id)}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel="Remove saved prompt"
                    style={({ hovered, pressed }) => [
                      styles.promptDelete,
                      (hovered || pressed) && styles.promptDeleteHover,
                    ]}
                  >
                    <Ionicons name="trash-outline" size={15} color="#b91c1c" />
                  </Pressable>
                </View>
              ))
            ) : (
              <Text style={styles.promptEmpty}>
                Nothing saved yet. Use the bookmark under a message, or save what you type.
              </Text>
            )}
          </ScrollView>
          <Pressable
            onPress={() => setPromptsOpen(false)}
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

  const shareMemberIds = new Set(activeMembers.map((person) => person.id));
  const shareAddable = people.filter((person) => person.id !== myId && !shareMemberIds.has(person.id));
  const shareSheet = (
    <Modal
      visible={shareOpen}
      transparent
      animationType="fade"
      onRequestClose={() => setShareOpen(false)}
    >
      <View style={styles.modelSheetRoot}>
        <Pressable
          style={styles.modelSheetBackdrop}
          accessibilityRole="button"
          accessibilityLabel="Close add people"
          onPress={() => setShareOpen(false)}
        />
        <View style={[styles.modelSheetCard, compact && styles.modelSheetCardPhone]}>
          <View style={styles.modelSheetHead}>
            <Text style={styles.modelSheetTitle}>Add people</Text>
            <Text style={styles.modelSheetSubtitle}>
              They get this chat and its history, and can talk to the AI with you.
            </Text>
          </View>
          <ScrollView
            style={styles.modelSheetScroll}
            contentContainerStyle={styles.modelSheetScrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {activeMembers.length ? (
              <View style={styles.modelSection}>
                <Text style={styles.modelSectionTitle}>In this chat</Text>
                {activeMembers.map((person) => (
                  <View key={person.id} style={styles.sharePerson}>
                    <PersonMark person={person} size={36} />
                    <Text style={styles.sharePersonName} numberOfLines={1}>
                      {contactName(person)}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}
            <View style={styles.modelSection}>
              <Text style={styles.modelSectionTitle}>Add</Text>
              {shareAddable.length ? (
                shareAddable.map((person) => (
                  <Pressable
                    key={person.id}
                    disabled={sharing}
                    onPress={() => {
                      void addPeopleToActive([person.id]).catch((err) => {
                        setError(err?.message || 'Could not add that person.');
                      });
                    }}
                    style={({ hovered, pressed }) => [
                      styles.sharePerson,
                      (hovered || pressed) && styles.sharePersonHover,
                    ]}
                  >
                    <PersonMark person={person} size={36} />
                    <Text style={styles.sharePersonName} numberOfLines={1}>
                      {contactName(person)}
                    </Text>
                    {sharing ? (
                      <ActivityIndicator size="small" color={SECONDARY} />
                    ) : (
                      <Ionicons name="add-circle-outline" size={20} color={BUBBLE_MINE} />
                    )}
                  </Pressable>
                ))
              ) : (
                <Text style={styles.promptEmpty}>
                  {people.length ? 'Everyone you can add is already here.' : 'No other staff have signed in yet.'}
                </Text>
              )}
            </View>
          </ScrollView>
          <Pressable
            onPress={() => setShareOpen(false)}
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

  const listBody = (
    <>
      <View style={styles.listHead}>
        {compact && (onClose || embedded) ? (
          <Pressable
            onPress={() => (embedded ? setMobileList(false) : onClose?.())}
            hitSlop={8}
            style={styles.chromeCircle}
            accessibilityRole="button"
            accessibilityLabel={embedded ? 'Back to the chat' : 'Close'}
          >
            <Ionicons name={embedded ? 'chevron-back' : 'close'} size={16} color={INK} />
          </Pressable>
        ) : null}
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
            // Inbox-style row: title + time, a scope line, then the last thing said.
            const lastTurn = [...(chat.turns || [])].reverse().find((turn) => String(turn?.content || '').trim());
            const lastLine = lastTurn
              ? `${
                  lastTurn.role === 'user'
                    ? lastTurn.senderId && lastTurn.senderId !== myId
                      ? `${firstNameOfPerson(
                          (chat.members || []).find((person) => person.id === lastTurn.senderId)
                            || people.find((person) => person.id === lastTurn.senderId),
                        )}: `
                      : 'You: '
                    : ''
                }${String(lastTurn.content).replace(/\s+/g, ' ').trim()}`
              : 'New analysis';
            const memberCount = (chat.members || []).length;
            const scopeLine = memberCount
              ? `${memberCount + 1} people`
              : chat.scopeLabel || (chat.placeholder ? 'Draft' : 'Analytics');
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
                  <View style={[styles.chatAvatar, selected && styles.chatAvatarOn]}>
                    <Ionicons name="sparkles" size={18} color={selected ? '#fff' : INK} />
                    {pinned ? (
                      <View style={styles.chatPinBadge}>
                        <Ionicons name="pin" size={9} color="#fff" />
                      </View>
                    ) : null}
                  </View>
                  <View style={styles.chatRowCopy}>
                    <View style={styles.chatRowTitleLine}>
                      <Text style={[styles.chatRowTitle, selected && styles.chatRowTitleOn]} numberOfLines={1}>
                        {chat.title}
                      </Text>
                      {busy ? (
                        <ActivityIndicator size="small" color={SECONDARY} style={styles.chatRowSpinner} />
                      ) : (
                        <Text style={styles.chatRowTime}>{formatInboxTime(chat.updatedAt)}</Text>
                      )}
                    </View>
                    <Text style={styles.chatRowScope} numberOfLines={1}>
                      {scopeLine}
                    </Text>
                    <Text style={styles.chatRowPreview} numberOfLines={1}>
                      {lastLine}
                    </Text>
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
                            setMenuChatId(null);
                            selectChat(chat.id);
                            setShareOpen(true);
                          }}
                          accessibilityRole="button"
                          style={({ hovered: itemHovered, pressed }) => [
                            styles.chatMenuItem,
                            (itemHovered || pressed) && styles.chatMenuItemHover,
                          ]}
                        >
                          <Ionicons name="person-add-outline" size={15} color={INK} />
                          <Text style={styles.chatMenuText}>Add people</Text>
                        </Pressable>
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
    </>
  );

  const list = compact ? (
    <View style={[styles.sidebar, styles.sidebarPhone]}>{listBody}</View>
  ) : (
    <View style={styles.sidebar}>{listBody}</View>
  );

  const conversation = (
    <View style={styles.main}>
      {compact && embedded ? (
        <View style={styles.nav}>
          <Pressable
            onPress={() => onClose?.()}
            hitSlop={8}
            style={styles.chromeCircle}
            accessibilityRole="button"
            accessibilityLabel="Back to messages"
          >
            <Ionicons name="chevron-back" size={16} color={INK} />
          </Pressable>
          <View style={styles.navTitleWrap}>
            <Text style={styles.navTitle} numberOfLines={1}>
              {activeChat && !activeChat.placeholder ? activeChat.title : title}
            </Text>
            {streaming ? (
              <Text style={styles.navSubtitle} numberOfLines={1}>
                {busyNote || 'Thinking…'}
              </Text>
            ) : activeMembers.length ? (
              <Text style={styles.navSubtitle} numberOfLines={1}>
                {activeMembers.length + 1} people
              </Text>
            ) : null}
          </View>
          <Pressable
            onPress={() => setShareOpen(true)}
            hitSlop={8}
            style={styles.chromeCircle}
            accessibilityRole="button"
            accessibilityLabel="Add people to this chat"
          >
            <Ionicons name="person-add-outline" size={16} color={INK} />
          </Pressable>
          <Pressable
            onPress={startNew}
            hitSlop={8}
            style={styles.chromeCircle}
            accessibilityRole="button"
            accessibilityLabel="New chat"
          >
            <Ionicons name="create-outline" size={16} color={INK} />
          </Pressable>
        </View>
      ) : null}
      <ScrollView
        ref={scrollRef}
        style={styles.threadScroll}
        contentContainerStyle={[
          styles.threadContent,
          compact && styles.threadContentPhone,
          !turns.length && styles.threadEmpty,
          !turns.length && (compact ? styles.threadEmptyPhone : styles.threadEmptyDesktop),
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {turns.length ? (
          turns.map((turn, index) => {
            const mine = turn.role === 'user' && (!turn.senderId || turn.senderId === myId);
            const otherPerson = !mine && turn.role === 'user'
              ? activeMembers.find((person) => person.id === turn.senderId)
                || people.find((person) => person.id === turn.senderId)
              : null;
            const streaming = turn.role === 'assistant' && busyId === activeId && index === turns.length - 1 && !String(turn.content || '').trim();
            if (!mine && !String(turn.content || '').trim() && !streaming) return null;
            const costLine = streaming ? '' : turnCostLine(turn, turn.role);
            const flying = Boolean(
              mine
              && sentAnim
              && sentAnim.chatId === activeId
              && sentAnim.content === turn.content
              && !turns.slice(index + 1).some((later) => later.role === 'user' && later.content === turn.content),
            );
            const bubble = (
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
                    linkStyle={mine ? styles.ticketLinkMine : null}
                    resolveTicket={resolveTicket}
                    onOpenDocument={onOpenDocument}
                  />
                )}
              </View>
            );
            const charts = mine ? [] : turn.charts || [];
            return (
              <View key={`${turn.role}-${index}`} style={styles.turnGroup}>
                <View style={[styles.turnRow, mine ? styles.turnRowMine : styles.turnRowTheirs]}>
                  {!mine ? (
                    otherPerson ? (
                      <View style={styles.turnAvatar}>
                        <PersonMark person={otherPerson} size={28} />
                      </View>
                    ) : (
                      <View style={styles.turnAvatar}>
                        <Ionicons name="sparkles" size={14} color={BUBBLE_MINE} />
                      </View>
                    )
                  ) : null}
                  <View style={[styles.turnBody, mine && styles.turnBodyMine, compact && (mine ? styles.turnBodyMinePhone : styles.turnBodyPhone)]}>
                    {!mine ? (
                      <Text style={styles.turnLabel}>
                        {otherPerson ? contactName(otherPerson) : title}
                      </Text>
                    ) : null}
                    {mine ? <AttachmentChips items={turn.attachments} mine /> : null}
                    {mine ? (
                      <SendFromInput
                        active={flying}
                        originRef={composerPillRef}
                        onSettled={() => setSentAnim((current) => (
                          current?.chatId === activeId && current?.content === turn.content ? null : current
                        ))}
                      >
                        {bubble}
                      </SendFromInput>
                    ) : bubble}
                    {!streaming && String(turn.content || '').trim() ? (
                      <View style={[styles.bubbleActions, mine && styles.bubbleActionsMine]}>
                        <Pressable
                          onPress={() => copyTurn(`${activeId}-${index}`, turn.content)}
                          hitSlop={6}
                          accessibilityRole="button"
                          accessibilityLabel="Copy message"
                          style={({ hovered, pressed }) => [
                            styles.bubbleAction,
                            (hovered || pressed) && styles.bubbleActionHover,
                          ]}
                        >
                          <Ionicons
                            name={copiedKey === `${activeId}-${index}` ? 'checkmark' : 'copy-outline'}
                            size={13}
                            color={SECONDARY}
                          />
                        </Pressable>
                        <Pressable
                          onPress={() => saveTurn(`${activeId}-${index}`, turn.content)}
                          hitSlop={6}
                          accessibilityRole="button"
                          accessibilityLabel="Save as prompt"
                          style={({ hovered, pressed }) => [
                            styles.bubbleAction,
                            (hovered || pressed) && styles.bubbleActionHover,
                          ]}
                        >
                          <Ionicons
                            name={
                              savedKey === `${activeId}-${index}`
                              || savedPrompts.some((item) => item.text === String(turn.content || '').trim())
                                ? 'bookmark'
                                : 'bookmark-outline'
                            }
                            size={13}
                            color={SECONDARY}
                          />
                        </Pressable>
                      </View>
                    ) : null}
                    {costLine ? (
                      <Text style={[styles.costMeta, mine && styles.costMetaMine]}>{costLine}</Text>
                    ) : null}
                  </View>
                </View>
                {charts.length ? (
                  // Charts, maps, and tables sit under the bubble at full thread
                  // width rather than inside the 88% bubble column, so a phone
                  // gets the whole screen width for the plot.
                  <View style={[styles.vizBlock, compact && styles.vizBlockPhone]}>
                    {charts.map((chart, chartIndex) =>
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
                ) : null}
              </View>
            );
          })
        ) : (
          <View style={[styles.empty, compact && styles.emptyPhone]}>
            <View style={[styles.emptyMark, compact && styles.emptyMarkPhone]}>
              <Ionicons name="sparkles" size={compact ? 16 : 18} color={INK} />
            </View>
            <Text style={[styles.emptyGreeting, compact && styles.emptyGreetingPhone]}>
              {firstName ? `Hi ${firstName} 👋` : 'Hi 👋'}
            </Text>
          </View>
        )}
      </ScrollView>
      <View style={[styles.composerWrap, compact && styles.composerWrapPhone]}>
        {composerMeta || !compact ? (
        <View style={styles.composerToolbar}>
          <View style={styles.composerToolbarLead}>
            {composerMeta ? (
              <Text style={styles.composerMeta} numberOfLines={1}>
                {composerMeta}
              </Text>
            ) : null}
          </View>
          {compact ? null : (
          <Pressable
            onPress={() => setShareOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="Add people to this chat"
            style={({ hovered, pressed }) => [
              styles.promptsHit,
              (hovered || pressed) && styles.promptsHitHover,
            ]}
          >
            <Ionicons name="person-add-outline" size={13} color={INK} />
            <Text style={styles.promptsHitText}>
              {activeMembers.length ? `${activeMembers.length + 1} people` : 'Add people'}
            </Text>
          </Pressable>
          )}
          {compact ? null : (
          <Pressable
            onPress={() => setPromptsOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="Saved prompts"
            style={({ hovered, pressed }) => [
              styles.promptsHit,
              (hovered || pressed) && styles.promptsHitHover,
            ]}
          >
            <Ionicons name="bookmark-outline" size={13} color={INK} />
            <Text style={styles.promptsHitText}>Saved</Text>
          </Pressable>
          )}
        </View>
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
        {!turns.length ? (
          compact ? (
            <View style={styles.suggestWrapPhone}>
              {suggestions.map((item) => (
                <Pressable
                  key={item}
                  onPress={() => send(item)}
                  disabled={Boolean(busyId) || blocked}
                  accessibilityRole="button"
                  style={({ hovered, pressed }) => [
                    styles.suggest,
                    styles.suggestPhone,
                    (hovered || pressed) && styles.suggestHover,
                  ]}
                >
                  <Text style={styles.suggestText} numberOfLines={1}>
                    {item}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : (
          <ScrollView
            horizontal
            style={styles.suggestScroll}
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.suggestRow}
          >
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
                <Text style={styles.suggestText} numberOfLines={1}>
                  {item}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
          )
        ) : null}
        <View ref={composerPillRef} collapsable={false} style={styles.composerPillAnchor}>
        <Pressable
          onHoverIn={() => setComposerHover(true)}
          onHoverOut={() => setComposerHover(false)}
          onPress={() => inputRef.current?.focus?.()}
          style={[
            styles.composerPill,
            composerActive && styles.composerPillActive,
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
            onFocus={() => setComposerFocus(true)}
            onBlur={() => setComposerFocus(false)}
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
          <View style={[styles.composerTrail, compact && styles.composerTrailPhone]}>
            {compact ? (
              <Pressable
                onPress={() => setShareOpen(true)}
                accessibilityRole="button"
                accessibilityLabel="Add people to this chat"
                style={({ hovered, pressed }) => [
                  styles.composerModel,
                  styles.composerModelPhone,
                  (hovered || pressed) && styles.composerModelHover,
                ]}
              >
                <Ionicons name="person-add-outline" size={16} color={SECONDARY} />
              </Pressable>
            ) : null}
            {compact ? (
              <Pressable
                onPress={() => setPromptsOpen(true)}
                accessibilityRole="button"
                accessibilityLabel="Saved prompts"
                style={({ hovered, pressed }) => [
                  styles.composerModel,
                  styles.composerModelPhone,
                  (hovered || pressed) && styles.composerModelHover,
                ]}
              >
                <Ionicons name="bookmark-outline" size={16} color={SECONDARY} />
              </Pressable>
            ) : null}
            <Pressable
              onPress={() => setModelOpen(true)}
              accessibilityRole="button"
              accessibilityLabel={`Model, ${modelLabel}${modelTag ? `, ${modelTag}` : ''}`}
              style={({ hovered, pressed }) => [
                styles.composerModel,
                compact && styles.composerModelPhone,
                (hovered || pressed) && styles.composerModelHover,
              ]}
            >
              {compact ? (
                <Ionicons name="options-outline" size={16} color={SECONDARY} />
              ) : (
                <>
                  <Text style={styles.composerModelText} numberOfLines={1}>
                    {modelLabel}
                  </Text>
                  <Ionicons name="chevron-down" size={12} color={SECONDARY} />
                </>
              )}
            </Pressable>
            {compact ? null : (
              <Pressable
                disabled
                accessibilityRole="button"
                accessibilityLabel="Voice input not available"
                accessibilityState={{ disabled: true }}
                style={styles.composerMic}
              >
                <Ionicons name="mic-outline" size={18} color={SECONDARY} />
              </Pressable>
            )}
            <Animated.View style={{ transform: [{ scale: sendPop }] }}>
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
            </Animated.View>
          </View>
        </Pressable>
        </View>
        {compact ? null : (
          <Text style={styles.composerHint}>Enter to send · Shift+Enter for a new line</Text>
        )}
      </View>
    </View>
  );

  return (
    <View style={[styles.root, compact && styles.rootPhone]}>
      {modelSheet}
      {promptsSheet}
      {shareSheet}
      {embedded ? conversation : showList ? list : compact ? conversation : (
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
    width: SIDEBAR_WIDTH,
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
  // Same shape as the Emails inbox row: avatar, title + time, scope line, preview.
  chatRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 64,
    paddingVertical: 10,
    paddingLeft: 14,
    paddingRight: 14,
    backgroundColor: CANVAS,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: RULE,
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  chatRowMenuOpen: {
    zIndex: 4,
  },
  chatAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#e8e8ed',
    flexShrink: 0,
  },
  chatAvatarOn: {
    backgroundColor: INK,
  },
  chatPinBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#8e8e93',
    borderWidth: 2,
    borderColor: CANVAS,
  },
  chatRowCopy: {
    flex: 1,
    minWidth: 0,
    paddingRight: 24,
  },
  chatRowTitleLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  chatRowOn: {
    backgroundColor: '#ececef',
  },
  chatRowHover: {
    backgroundColor: '#f5f5f7',
  },
  chatRowTitle: {
    flex: 1,
    minWidth: 0,
    fontFamily: FONT,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '600',
    color: '#1d1d1f',
    letterSpacing: -0.15,
  },
  chatRowTitleOn: {
    color: INK,
  },
  chatRowTime: {
    fontFamily: FONT,
    fontSize: 12,
    color: SECONDARY,
    flexShrink: 0,
  },
  chatRowScope: {
    fontFamily: FONT,
    fontSize: 14,
    lineHeight: 19,
    color: '#1d1d1f',
    marginTop: 1,
  },
  chatRowPreview: {
    fontFamily: FONT,
    fontSize: 13,
    lineHeight: 18,
    color: SECONDARY,
    marginTop: 1,
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
  navTitleWrap: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  navTitle: {
    fontFamily: FONT,
    fontSize: 15,
    lineHeight: 19,
    fontWeight: '600',
    color: INK,
    letterSpacing: -0.2,
    textAlign: 'center',
  },
  navSubtitle: {
    fontFamily: FONT,
    fontSize: 11,
    lineHeight: 14,
    color: SECONDARY,
    textAlign: 'center',
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
  threadContentPhone: {
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 14,
    gap: 12,
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
  emptyPhone: {
    gap: 8,
    paddingHorizontal: 4,
  },
  emptyMarkPhone: {
    width: 36,
    height: 36,
    marginBottom: 0,
  },
  emptyGreeting: {
    fontFamily: FONT_LIGHT,
    fontSize: 28,
    fontWeight: '300',
    color: SECONDARY,
    letterSpacing: -0.4,
    textAlign: 'center',
  },
  emptyGreetingPhone: {
    fontSize: 22,
    letterSpacing: -0.3,
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
  suggestScroll: {
    width: '100%',
    flexGrow: 0,
    flexShrink: 0,
    maxHeight: 34,
    ...Platform.select({
      web: { overflowX: 'auto', overflowY: 'hidden' },
      default: {},
    }),
  },
  suggestWrapPhone: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
    width: '100%',
  },
  suggestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 34,
  },
  suggest: {
    flexShrink: 0,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: BUBBLE_THEM_BORDER,
    backgroundColor: '#fff',
    ...CHIP_SHADOW,
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  suggestPhone: {
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  suggestHover: {
    backgroundColor: NAV_TAB_ACTIVE_BG,
  },
  suggestText: {
    fontFamily: FONT,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '400',
    color: INK,
    letterSpacing: -0.1,
    ...Platform.select({ web: { whiteSpace: 'nowrap' }, default: {} }),
  },
  turnGroup: {
    alignSelf: 'stretch',
    width: '100%',
    gap: 4,
  },
  turnRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    alignSelf: 'stretch',
    width: '100%',
    gap: 8,
  },
  vizBlock: {
    alignSelf: 'stretch',
    width: '100%',
    // Lines up with the bubble: avatar (28) + row gap (8).
    paddingLeft: 36,
  },
  vizBlockPhone: {
    paddingLeft: 0,
  },
  turnRowTheirs: {
    justifyContent: 'flex-start',
  },
  turnRowMine: {
    justifyContent: 'flex-end',
  },
  turnAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 18,
    backgroundColor: BUBBLE_THEM_BG,
    flexShrink: 0,
  },
  turnBody: {
    maxWidth: '88%',
    flexShrink: 1,
    gap: 6,
  },
  turnBodyMine: {
    maxWidth: '78%',
  },
  turnBodyPhone: {
    maxWidth: '92%',
  },
  turnBodyMinePhone: {
    maxWidth: '88%',
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
    paddingHorizontal: 15,
    paddingVertical: 10,
    ...Platform.select({
      web: { width: 'fit-content', maxWidth: '100%', overflow: 'visible' },
      default: {},
    }),
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
    alignSelf: 'flex-end',
    backgroundColor: BUBBLE_MINE,
    borderBottomRightRadius: BUBBLE_TAIL,
  },
  bubbleTheirs: {
    alignSelf: 'flex-start',
    backgroundColor: BUBBLE_THEM_BG,
    borderBottomLeftRadius: BUBBLE_TAIL,
  },
  bubbleText: {
    fontFamily: FONT,
    fontSize: 16,
    lineHeight: 22,
    color: '#1c1c1e',
    ...Platform.select({
      web: { display: 'block', overflow: 'visible' },
      default: {},
    }),
  },
  bubbleTextMine: {
    color: '#fff',
  },
  ticketLink: {
    textDecorationLine: 'underline',
    fontWeight: '500',
    ...Platform.select({ web: { cursor: 'pointer', textUnderlineOffset: 2 }, default: {} }),
  },
  ticketLinkMine: {
    color: '#fff',
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
  composerWrapPhone: {
    paddingHorizontal: 10,
    paddingTop: 6,
    paddingBottom: Platform.select({ web: 8, ios: 8, default: 8 }),
    gap: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: RULE,
  },
  composerToolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 24,
  },
  composerToolbarLead: {
    flex: 1,
    minWidth: 0,
  },
  composerMeta: {
    fontFamily: FONT,
    fontSize: 11,
    lineHeight: 14,
    color: SECONDARY,
    textAlign: 'left',
    fontVariant: ['tabular-nums'],
  },
  promptsHit: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: CHIP_RADIUS,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: CHIP_BORDER,
    backgroundColor: '#fff',
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  promptsHitHover: {
    backgroundColor: NAV_TAB_ACTIVE_BG,
  },
  promptsHitText: {
    fontFamily: FONT,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500',
    color: INK,
  },
  bubbleActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginLeft: 2,
    marginTop: -2,
  },
  bubbleActionsMine: {
    justifyContent: 'flex-end',
    marginLeft: 0,
    marginRight: 2,
  },
  bubbleAction: {
    width: 24,
    height: 24,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  bubbleActionHover: {
    backgroundColor: 'rgba(60, 60, 67, 0.08)',
  },
  promptSaveDraft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: NAV_TAB_ACTIVE_BG,
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  promptSaveDraftHover: {
    backgroundColor: '#ececef',
  },
  promptSaveDraftText: {
    fontFamily: FONT,
    fontSize: 14,
    fontWeight: '500',
    color: INK,
  },
  promptRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 4,
  },
  promptPick: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderRadius: 12,
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  promptPickHover: {
    backgroundColor: '#f5f5f7',
  },
  promptPickOff: {
    opacity: 0.45,
  },
  promptPickText: {
    fontFamily: FONT,
    fontSize: 14,
    lineHeight: 20,
    color: INK,
  },
  promptDelete: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  promptDeleteHover: {
    backgroundColor: '#fef2f2',
  },
  promptEmpty: {
    fontFamily: FONT,
    fontSize: 13,
    lineHeight: 18,
    color: SECONDARY,
    paddingHorizontal: 8,
    paddingVertical: 12,
  },
  composerPillAnchor: {
    width: '100%',
  },
  composerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 48,
    paddingLeft: 8,
    paddingRight: 8,
    paddingVertical: 4,
    gap: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: CHIP_BORDER,
    backgroundColor: BUBBLE_THEM_BG,
    ...COMPOSER_PILL_IDLE_SHADOW,
    ...Platform.select({
      web: { transition: 'box-shadow 180ms ease' },
      default: {},
    }),
  },
  composerPillActive: {
    ...COMPOSER_PILL_ACTIVE_SHADOW,
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
    borderColor: BUBBLE_MINE,
    backgroundColor: BUBBLE_MINE,
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
  composerTrailPhone: {
    maxWidth: '42%',
    gap: 0,
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
  composerModelPhone: {
    maxWidth: 36,
    minHeight: 32,
    paddingHorizontal: 6,
    justifyContent: 'center',
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
    backgroundColor: BUBBLE_MINE,
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
    maxHeight: '86%',
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    paddingBottom: 12,
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
  sharePerson: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
    paddingHorizontal: 2,
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  sharePersonHover: {
    backgroundColor: '#f5f5f7',
  },
  sharePersonName: {
    flex: 1,
    minWidth: 0,
    fontFamily: FONT,
    fontSize: 15,
    fontWeight: '500',
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
