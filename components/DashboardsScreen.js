import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import Ionicons from '@expo/vector-icons/Ionicons';
import { loadGoogleMapsBrowserKey } from '../lib/aiKeys';
import {
  cachedResult,
  deleteDashboard,
  formatRanAt,
  isFreshResult,
  listDashboards,
  loadDashboardCache,
  removeDashboardWidget,
  renameDashboard,
  runDashboardWidget,
  saveDashboardCache,
  withCachedResult,
  withoutWidgetResults,
} from '../lib/dashboards';
import { CANVAS, MOBILE, useIsMobile } from '../lib/mobileUi';
import { formatDateParam, formatPickerDate, parseDateParam, parseDocReference } from '../lib/transactions';
import { FONT, FONT_LIGHT } from '../lib/typography';
import AnalyticsChartCard, { warmCharts } from './AnalyticsChartCard';
import AnalyticsMapCard from './AnalyticsMapCard';
import AnalyticsTableCard from './AnalyticsTableCard';
import HomeDatePicker from './HomeDatePicker';
import { confirmDestructive, EmptyState } from './TriageKit';

const INK = '#1a1a1a';
const SECONDARY = '#8e8e93';
const RULE = 'rgba(42,38,30,0.08)';
const CHIP_BORDER = '#d0d0d0';
const BLUE = MOBILE.blue;
const GAP = 16;
const MAX_COLUMNS = 3;
// Two cards at a time: each one is a full AI turn with POS reads behind it.
const CONCURRENCY = 2;
const LOOKAHEAD_DAYS = 31;

const CARD_SHADOW = Platform.select({
  web: { boxShadow: '0 1px 2px rgba(0,0,0,0.04), 0 4px 14px rgba(0,0,0,0.04)' },
  default: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 1,
  },
});

function shiftDay(iso, delta) {
  const date = parseDateParam(iso);
  date.setDate(date.getDate() + delta);
  return formatDateParam(date);
}

function dateLabel(iso) {
  const today = formatDateParam(new Date());
  if (iso === today) return 'Today';
  if (iso === shiftDay(today, -1)) return 'Yesterday';
  if (iso === shiftDay(today, 1)) return 'Tomorrow';
  return formatPickerDate(parseDateParam(iso));
}

function entryKey(widgetId, date) {
  return `${widgetId}|${date}`;
}

function columnsForWidth(width) {
  if (width >= 1080) return MAX_COLUMNS;
  if (width >= 680) return 2;
  return 1;
}

// Table cells carry PO#/SO# text; the chart's ticket list says which POS the
// id lives in, and a bare mention falls back to East like the chat does.
function ticketOpener(chart, onOpenDocument) {
  if (!onOpenDocument) return null;
  return (ref) => {
    const known = (chart?.tickets || []).find((ticket) => {
      const parsed = parseDocReference(ticket);
      return parsed && parsed.key === ref.key;
    });
    onOpenDocument({
      type: ref.type,
      sourceId: ref.sourceId,
      reference: ref.reference,
      systemKey: known?.systemKey || 'east',
    });
  };
}

function kindIcon(kind) {
  if (kind === 'map') return 'map-outline';
  if (kind === 'table' || kind === 'file') return 'grid-outline';
  if (kind === 'chart') return 'bar-chart-outline';
  return 'chatbubble-ellipses-outline';
}

/** One grid cell: title, status line, the answer, and the card's actions. */
function WidgetCard({
  widget,
  entry,
  width,
  mapsKey,
  compact,
  onRefresh,
  onRemove,
  onOpenCustomer,
  onOpenDocument,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const status = entry?.status || 'idle';
  const loading = status === 'loading';
  const charts = Array.isArray(entry?.charts) ? entry.charts : [];
  const text = String(entry?.text || '').trim();
  const hasBody = charts.length > 0 || Boolean(text);
  const meta = loading
    ? entry?.note || 'Updating…'
    : status === 'error'
      ? ''
      : entry?.ranAt
        ? formatRanAt(entry.ranAt)
        : '';

  return (
    <View style={[styles.card, { width }, compact && styles.cardPhone]}>
      <View style={styles.cardHead}>
        <View style={styles.cardIcon}>
          <Ionicons name={kindIcon(widget.kind)} size={14} color={INK} />
        </View>
        <View style={styles.cardHeadText}>
          <Text style={styles.cardTitle} numberOfLines={1}>
            {widget.title}
          </Text>
          <Text style={styles.cardQuestion} numberOfLines={2}>
            {widget.question}
          </Text>
        </View>
        <Pressable
          onPress={onRefresh}
          disabled={loading}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={`Refresh ${widget.title}`}
          style={({ hovered, pressed }) => [styles.cardAction, (hovered || pressed) && styles.cardActionOn, loading && styles.cardActionOff]}
        >
          {loading ? <ActivityIndicator size="small" color={SECONDARY} /> : <Ionicons name="refresh" size={15} color={INK} />}
        </Pressable>
        <View style={styles.cardMenuAnchor}>
          <Pressable
            onPress={() => setMenuOpen((open) => !open)}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={`Options for ${widget.title}`}
            style={({ hovered, pressed }) => [styles.cardAction, (hovered || pressed || menuOpen) && styles.cardActionOn]}
          >
            <Ionicons name="ellipsis-horizontal" size={15} color={INK} />
          </Pressable>
          {menuOpen ? (
            <View style={styles.cardMenu}>
              <Pressable
                onPress={() => {
                  setMenuOpen(false);
                  onRefresh();
                }}
                accessibilityRole="button"
                style={({ hovered, pressed }) => [styles.cardMenuItem, (hovered || pressed) && styles.cardMenuItemOn]}
              >
                <Ionicons name="refresh" size={14} color={INK} />
                <Text style={styles.cardMenuText}>Refresh now</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  setMenuOpen(false);
                  onRemove();
                }}
                accessibilityRole="button"
                style={({ hovered, pressed }) => [styles.cardMenuItem, (hovered || pressed) && styles.cardMenuItemOn]}
              >
                <Ionicons name="trash-outline" size={14} color="#b91c1c" />
                <Text style={[styles.cardMenuText, styles.cardMenuDanger]}>Remove card</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      </View>
      {meta ? (
        <Text style={[styles.cardMeta, loading && styles.cardMetaBusy]} numberOfLines={1}>
          {meta}
        </Text>
      ) : null}
      {status === 'error' ? (
        <View style={styles.cardError}>
          <Ionicons name="alert-circle-outline" size={15} color="#b42318" />
          <Text style={styles.cardErrorText}>{entry?.error || 'Could not run this card.'}</Text>
          <Pressable onPress={onRefresh} accessibilityRole="button" style={styles.cardRetry}>
            <Text style={styles.cardRetryText}>Try again</Text>
          </Pressable>
        </View>
      ) : null}
      {hasBody ? (
        <View style={[styles.cardBody, loading && styles.cardBodyStale]}>
          {charts.map((chart, index) =>
            chart.type === 'map' ? (
              <AnalyticsMapCard key={`${chart.type}-${index}`} chart={chart} apiKey={mapsKey} onOpenCustomer={onOpenCustomer} />
            ) : chart.type === 'table' ? (
              <AnalyticsTableCard key={`${chart.type}-${index}`} chart={chart} onOpenTicket={ticketOpener(chart, onOpenDocument)} />
            ) : chart.type === 'file' ? null : (
              <AnalyticsChartCard key={`${chart.type}-${index}`} chart={chart} />
            ),
          )}
          {text ? (
            <Text selectable style={[styles.cardText, !charts.length && styles.cardTextOnly]}>
              {text}
            </Text>
          ) : null}
        </View>
      ) : loading ? (
        <View style={styles.cardPending}>
          <ActivityIndicator color={SECONDARY} />
          <Text style={styles.cardPendingText}>{entry?.note || 'Asking…'}</Text>
        </View>
      ) : status !== 'error' ? (
        <View style={styles.cardPending}>
          <Text style={styles.cardPendingText}>Nothing yet for this day.</Text>
        </View>
      ) : null}
    </View>
  );
}

/**
 * Tabs of cards pinned from Analytics. Each card re-asks its question for the
 * date at the top (today by default), with the last answer kept on this
 * device so the grid fills in while the fresh one runs.
 */
export default function DashboardsScreen({
  session,
  onOpenCustomer,
  onOpenDocument,
  onOpenAnalytics,
  focusId = '',
  onFocusConsumed = null,
}) {
  const compact = useIsMobile();
  const userKey = session?.supabaseUserId || session?.profile?.id || '';
  const today = formatDateParam(new Date());
  const [boards, setBoards] = useState([]);
  const [loadingBoards, setLoadingBoards] = useState(true);
  const [boardsError, setBoardsError] = useState('');
  const [activeId, setActiveId] = useState('');
  const [date, setDate] = useState(today);
  const [results, setResults] = useState({});
  const [cacheReady, setCacheReady] = useState(false);
  const [mapsKey, setMapsKey] = useState('');
  const [mapsReady, setMapsReady] = useState(false);
  const [gridWidth, setGridWidth] = useState(0);
  const [tabMenuId, setTabMenuId] = useState('');
  const [renaming, setRenaming] = useState(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [renameBusy, setRenameBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const cacheRef = useRef({});
  const queueRef = useRef([]);
  const activeRef = useRef(0);
  const controllersRef = useRef(new Map());
  const mountedRef = useRef(true);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const mapsKeyRef = useRef('');
  mapsKeyRef.current = mapsKey;

  const activeBoard = useMemo(() => boards.find((board) => board.id === activeId) || null, [boards, activeId]);
  const maxDate = useMemo(() => shiftDay(today, LOOKAHEAD_DAYS), [today]);

  useEffect(() => {
    mountedRef.current = true;
    const controllers = controllersRef.current;
    const queue = queueRef;
    // Dashboards are mostly charts; fetch the chart library right away.
    warmCharts();
    return () => {
      mountedRef.current = false;
      controllers.forEach((controller) => controller.abort());
      controllers.clear();
      queue.current = [];
    };
  }, []);

  useEffect(() => {
    let alive = true;
    loadDashboardCache(userKey).then((cache) => {
      if (!alive) return;
      cacheRef.current = cache;
      setCacheReady(true);
    });
    loadGoogleMapsBrowserKey()
      .then((key) => {
        if (alive) setMapsKey(key || '');
      })
      .catch(() => {
        if (alive) setMapsKey('');
      })
      .finally(() => {
        if (alive) setMapsReady(true);
      });
    return () => {
      alive = false;
    };
  }, [userKey]);

  const reloadBoards = useCallback(async () => {
    setBoardsError('');
    try {
      const rows = await listDashboards();
      if (!mountedRef.current) return rows;
      setBoards(rows);
      return rows;
    } catch (error) {
      if (mountedRef.current) setBoardsError(error?.message || 'Could not load dashboards.');
      return null;
    } finally {
      if (mountedRef.current) setLoadingBoards(false);
    }
  }, []);

  useEffect(() => {
    if (!session?.token) {
      setLoadingBoards(false);
      return;
    }
    void reloadBoards().then((rows) => {
      if (!rows || !mountedRef.current) return;
      setActiveId((current) => {
        if (focusId && rows.some((board) => board.id === focusId)) return focusId;
        if (current && rows.some((board) => board.id === current)) return current;
        return rows[0]?.id || '';
      });
      if (focusId) onFocusConsumed?.();
    });
    // focusId is read once per change so a newly created tab opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.token, focusId, reloadBoards]);

  const setEntry = useCallback((key, patch) => {
    if (!mountedRef.current) return;
    setResults((current) => ({ ...current, [key]: { ...(current[key] || {}), ...patch } }));
  }, []);

  const pump = useCallback(() => {
    while (activeRef.current < CONCURRENCY && queueRef.current.length) {
      const job = queueRef.current.shift();
      if (controllersRef.current.has(job.key)) continue;
      const controller = new AbortController();
      controllersRef.current.set(job.key, controller);
      activeRef.current += 1;
      setEntry(job.key, { status: 'loading', note: 'Starting…', error: '' });
      runDashboardWidget(job.widget, {
        date: job.date,
        session: sessionRef.current,
        mapsKey: mapsKeyRef.current,
        signal: controller.signal,
        onStatus: (note) => {
          if (!controller.signal.aborted) setEntry(job.key, { note });
        },
      })
        .then((result) => {
          if (controller.signal.aborted) return;
          cacheRef.current = withCachedResult(cacheRef.current, job.widget.id, job.date, result);
          void saveDashboardCache(userKey, cacheRef.current);
          setEntry(job.key, {
            status: 'done',
            text: result.text,
            charts: result.charts,
            ranAt: result.ranAt,
            note: '',
            error: '',
          });
        })
        .catch((error) => {
          if (controller.signal.aborted) return;
          setEntry(job.key, { status: 'error', error: error?.message || 'Could not run this card.', note: '' });
        })
        .finally(() => {
          // A refresh may already have a newer run under this key; leave it be.
          if (controllersRef.current.get(job.key) === controller) controllersRef.current.delete(job.key);
          activeRef.current = Math.max(0, activeRef.current - 1);
          pump();
        });
    }
  }, [setEntry, userKey]);

  const cancelAll = useCallback(() => {
    queueRef.current = [];
    controllersRef.current.forEach((controller) => controller.abort());
    controllersRef.current.clear();
  }, []);

  const queueWidgets = useCallback(
    (widgets, runDate, { force = false } = {}) => {
      const jobs = [];
      for (const widget of widgets) {
        const key = entryKey(widget.id, runDate);
        if (controllersRef.current.has(key) || queueRef.current.some((job) => job.key === key)) continue;
        const cached = cachedResult(cacheRef.current, widget.id, runDate);
        if (cached && !force && isFreshResult(cached, runDate)) {
          setEntry(key, { status: 'done', text: cached.text, charts: cached.charts, ranAt: cached.ranAt, error: '', note: '' });
          continue;
        }
        // Stale figures stay on screen while the fresh ones run; a card made
        // today can also show the answer it was pinned with.
        const seed = cached
          || (widget.snapshot?.date === runDate && (widget.snapshot.charts.length || widget.snapshot.text)
            ? { text: widget.snapshot.text, charts: widget.snapshot.charts, ranAt: '' }
            : null);
        setEntry(key, {
          status: 'loading',
          text: seed?.text || '',
          charts: seed?.charts || [],
          ranAt: seed?.ranAt || '',
          note: 'Queued…',
          error: '',
        });
        jobs.push({ key, widget, date: runDate });
      }
      queueRef.current.push(...jobs);
      pump();
    },
    [pump, setEntry],
  );

  // A new tab or date runs every card for it; anything still running for the
  // previous view is dropped. Removing one card does not restart the others.
  const viewRef = useRef('');
  const activeBoardRef = useRef(activeBoard);
  activeBoardRef.current = activeBoard;
  const widgetSignature = activeBoard ? activeBoard.widgets.map((widget) => widget.id).join(',') : '';
  useEffect(() => {
    const board = activeBoardRef.current;
    if (!cacheReady || !mapsReady || !board || !session?.token) return;
    const view = `${board.id}|${date}`;
    if (viewRef.current !== view) {
      viewRef.current = view;
      cancelAll();
    }
    queueWidgets(board.widgets, date);
  }, [activeBoard?.id, widgetSignature, date, cacheReady, mapsReady, session?.token, cancelAll, queueWidgets]);

  const refreshAll = () => {
    if (!activeBoard) return;
    cancelAll();
    queueWidgets(activeBoard.widgets, date, { force: true });
  };

  const refreshOne = (widget) => {
    const key = entryKey(widget.id, date);
    controllersRef.current.get(key)?.abort();
    controllersRef.current.delete(key);
    queueRef.current = queueRef.current.filter((job) => job.key !== key);
    queueWidgets([widget], date, { force: true });
  };

  const removeWidget = (widget) => {
    confirmDestructive(
      'Remove this card?',
      `“${widget.title}” comes off this dashboard. You can pin it again from Analytics.`,
      async () => {
        try {
          const key = entryKey(widget.id, date);
          controllersRef.current.get(key)?.abort();
          controllersRef.current.delete(key);
          await removeDashboardWidget(widget.id);
          cacheRef.current = withoutWidgetResults(cacheRef.current, [widget.id]);
          void saveDashboardCache(userKey, cacheRef.current);
          if (!mountedRef.current) return;
          setBoards((current) =>
            current.map((board) =>
              board.id === widget.dashboardId
                ? { ...board, widgets: board.widgets.filter((item) => item.id !== widget.id) }
                : board,
            ),
          );
        } catch (error) {
          if (mountedRef.current) setNotice(error?.message || 'Could not remove that card.');
        }
      },
      'Remove',
    );
  };

  const removeBoard = (board) => {
    setTabMenuId('');
    confirmDestructive(
      `Delete “${board.title}”?`,
      `Its ${board.widgets.length} ${board.widgets.length === 1 ? 'card' : 'cards'} go with it.`,
      async () => {
        try {
          cancelAll();
          await deleteDashboard(board.id);
          cacheRef.current = withoutWidgetResults(cacheRef.current, board.widgets.map((item) => item.id));
          void saveDashboardCache(userKey, cacheRef.current);
          if (!mountedRef.current) return;
          setBoards((current) => {
            const next = current.filter((item) => item.id !== board.id);
            if (activeId === board.id) setActiveId(next[0]?.id || '');
            return next;
          });
        } catch (error) {
          if (mountedRef.current) setNotice(error?.message || 'Could not delete that dashboard.');
        }
      },
      'Delete',
    );
  };

  const openRename = (board) => {
    setTabMenuId('');
    setRenaming(board);
    setRenameDraft(board.title);
  };

  const saveRename = async () => {
    if (!renaming || renameBusy) return;
    const next = renameDraft.trim();
    if (!next) return;
    setRenameBusy(true);
    try {
      const title = await renameDashboard(renaming.id, next);
      if (!mountedRef.current) return;
      setBoards((current) => current.map((board) => (board.id === renaming.id ? { ...board, title } : board)));
      setRenaming(null);
    } catch (error) {
      if (mountedRef.current) setNotice(error?.message || 'Could not rename that dashboard.');
    } finally {
      if (mountedRef.current) setRenameBusy(false);
    }
  };

  const columns = gridWidth ? columnsForWidth(gridWidth) : 1;
  const cellWidth = gridWidth ? Math.floor((gridWidth - GAP * (columns - 1)) / columns) : undefined;
  const runningCount = activeBoard
    ? activeBoard.widgets.filter((widget) => results[entryKey(widget.id, date)]?.status === 'loading').length
    : 0;

  if (!session?.token) {
    return (
      <View style={styles.screen}>
        <EmptyState icon="grid-outline" title="Dashboards" body="Sign in to see your dashboards." />
      </View>
    );
  }

  const renameSheet = (
    <Modal visible={Boolean(renaming)} transparent animationType="fade" onRequestClose={() => setRenaming(null)}>
      <View style={styles.sheetRoot}>
        <Pressable style={styles.sheetBackdrop} accessibilityRole="button" accessibilityLabel="Close" onPress={() => setRenaming(null)} />
        <View style={[styles.sheetCard, compact && styles.sheetCardPhone]}>
          <Text style={styles.sheetTitle}>Rename dashboard</Text>
          <TextInput
            value={renameDraft}
            onChangeText={setRenameDraft}
            autoFocus
            maxLength={80}
            placeholder="Dashboard name"
            placeholderTextColor={SECONDARY}
            style={styles.sheetInput}
            onSubmitEditing={saveRename}
            returnKeyType="done"
          />
          <View style={styles.sheetActions}>
            <Pressable onPress={() => setRenaming(null)} accessibilityRole="button" style={({ hovered, pressed }) => [styles.ghost, (hovered || pressed) && styles.ghostOn]}>
              <Text style={styles.ghostText}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={saveRename}
              disabled={renameBusy || !renameDraft.trim()}
              accessibilityRole="button"
              style={({ hovered, pressed }) => [styles.solid, (hovered || pressed) && styles.solidOn, (renameBusy || !renameDraft.trim()) && styles.solidOff]}
            >
              {renameBusy ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.solidText}>Save</Text>}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );

  const datePicker = (
    <View style={styles.dateGroup}>
      <Pressable
        onPress={() => setDate((current) => shiftDay(current, -1))}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel="Previous day"
        style={({ hovered, pressed }) => [styles.dateArrow, (hovered || pressed) && styles.dateArrowOn]}
      >
        <Ionicons name="chevron-back" size={16} color={INK} />
      </Pressable>
      <HomeDatePicker
        startDate={date}
        endDate={date}
        dateMode="day"
        compact
        maximumDate={maxDate}
        onChange={({ start }) => setDate(formatDateParam(start))}
      />
      <Pressable
        onPress={() => setDate((current) => (current < maxDate ? shiftDay(current, 1) : current))}
        disabled={date >= maxDate}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel="Next day"
        style={({ hovered, pressed }) => [styles.dateArrow, (hovered || pressed) && styles.dateArrowOn, date >= maxDate && styles.dateArrowOff]}
      >
        <Ionicons name="chevron-forward" size={16} color={INK} />
      </Pressable>
      {date !== today ? (
        <Pressable onPress={() => setDate(today)} accessibilityRole="button" style={({ hovered, pressed }) => [styles.ghost, (hovered || pressed) && styles.ghostOn]}>
          <Text style={styles.ghostText}>Today</Text>
        </Pressable>
      ) : null}
    </View>
  );

  return (
    <View style={styles.screen}>
      {renameSheet}
      <View style={[styles.topBar, compact && styles.topBarPhone]}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          style={styles.tabsScroll}
          contentContainerStyle={styles.tabsRow}
        >
          {boards.map((board) => {
            const active = board.id === activeId;
            const menuOpen = tabMenuId === board.id;
            return (
              <View key={board.id} style={[styles.tabWrap, menuOpen && styles.tabWrapMenu]}>
                <Pressable
                  onPress={() => {
                    setTabMenuId('');
                    setActiveId(board.id);
                  }}
                  onLongPress={() => setTabMenuId(menuOpen ? '' : board.id)}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={board.title}
                  style={({ hovered, pressed }) => [styles.tab, active && styles.tabOn, (hovered || pressed) && !active && styles.tabHover]}
                >
                  <Text style={[styles.tabText, active && styles.tabTextOn]} numberOfLines={1}>
                    {board.title}
                  </Text>
                  <Text style={[styles.tabCount, active && styles.tabCountOn]}>{board.widgets.length}</Text>
                  {active ? (
                    <Pressable
                      onPress={(event) => {
                        event?.stopPropagation?.();
                        setTabMenuId(menuOpen ? '' : board.id);
                      }}
                      hitSlop={6}
                      accessibilityRole="button"
                      accessibilityLabel={`Options for ${board.title}`}
                      style={styles.tabMore}
                    >
                      <Ionicons name="chevron-down" size={12} color="#fff" />
                    </Pressable>
                  ) : null}
                </Pressable>
                {menuOpen ? (
                  <View style={styles.tabMenu}>
                    <Pressable onPress={() => openRename(board)} accessibilityRole="button" style={({ hovered, pressed }) => [styles.cardMenuItem, (hovered || pressed) && styles.cardMenuItemOn]}>
                      <Ionicons name="pencil-outline" size={14} color={INK} />
                      <Text style={styles.cardMenuText}>Rename</Text>
                    </Pressable>
                    <Pressable onPress={() => removeBoard(board)} accessibilityRole="button" style={({ hovered, pressed }) => [styles.cardMenuItem, (hovered || pressed) && styles.cardMenuItemOn]}>
                      <Ionicons name="trash-outline" size={14} color="#b91c1c" />
                      <Text style={[styles.cardMenuText, styles.cardMenuDanger]}>Delete dashboard</Text>
                    </Pressable>
                  </View>
                ) : null}
              </View>
            );
          })}
          {onOpenAnalytics ? (
            <Pressable
              onPress={onOpenAnalytics}
              accessibilityRole="button"
              accessibilityLabel="Open Analytics to make a dashboard"
              style={({ hovered, pressed }) => [styles.tabAdd, (hovered || pressed) && styles.tabHover]}
            >
              <Ionicons name="add" size={16} color={INK} />
              {boards.length ? null : <Text style={styles.tabAddText}>New from Analytics</Text>}
            </Pressable>
          ) : null}
        </ScrollView>
        {compact ? null : (
          <View style={styles.topBarTrail}>
            {datePicker}
            <Pressable
              onPress={refreshAll}
              disabled={!activeBoard || runningCount > 0}
              accessibilityRole="button"
              accessibilityLabel="Refresh every card"
              style={({ hovered, pressed }) => [styles.refreshAll, (hovered || pressed) && styles.ghostOn, (!activeBoard || runningCount > 0) && styles.dateArrowOff]}
            >
              {runningCount > 0 ? <ActivityIndicator size="small" color={SECONDARY} /> : <Ionicons name="refresh" size={15} color={INK} />}
              <Text style={styles.ghostText}>{runningCount > 0 ? `${runningCount} updating` : 'Refresh'}</Text>
            </Pressable>
          </View>
        )}
      </View>
      {compact ? (
        <View style={styles.phoneDateRow}>
          {datePicker}
          <Pressable
            onPress={refreshAll}
            disabled={!activeBoard || runningCount > 0}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel="Refresh every card"
            style={({ hovered, pressed }) => [styles.dateArrow, (hovered || pressed) && styles.dateArrowOn, (!activeBoard || runningCount > 0) && styles.dateArrowOff]}
          >
            {runningCount > 0 ? <ActivityIndicator size="small" color={SECONDARY} /> : <Ionicons name="refresh" size={16} color={INK} />}
          </Pressable>
        </View>
      ) : null}
      {notice ? (
        <Pressable onPress={() => setNotice('')} style={styles.notice} accessibilityRole="button" accessibilityLabel="Dismiss">
          <Text style={styles.noticeText}>{notice}</Text>
        </Pressable>
      ) : null}
      <ScrollView
        style={styles.body}
        contentContainerStyle={[styles.bodyContent, compact && styles.bodyContentPhone]}
        keyboardShouldPersistTaps="handled"
        onScrollBeginDrag={() => setTabMenuId('')}
      >
        {loadingBoards ? (
          <View style={styles.center}>
            <ActivityIndicator color={INK} />
          </View>
        ) : boardsError ? (
          <EmptyState
            icon="alert-circle-outline"
            title="Dashboards did not load"
            body={boardsError}
            action={
              <Pressable onPress={() => { setLoadingBoards(true); void reloadBoards(); }} accessibilityRole="button" style={styles.solid}>
                <Text style={styles.solidText}>Try again</Text>
              </Pressable>
            }
          />
        ) : !boards.length ? (
          <EmptyState
            icon="grid-outline"
            title="No dashboards yet"
            body="Ask Analytics a few questions, then press + Dashboard under the chat and check the answers you want to see every day."
            action={
              onOpenAnalytics ? (
                <Pressable onPress={onOpenAnalytics} accessibilityRole="button" style={styles.solid}>
                  <Text style={styles.solidText}>Open Analytics</Text>
                </Pressable>
              ) : null
            }
          />
        ) : !activeBoard ? null : !activeBoard.widgets.length ? (
          <EmptyState
            icon="grid-outline"
            title="This dashboard is empty"
            body="Pin answers to it from Analytics, or delete the tab from its menu."
          />
        ) : (
          <>
            <Text style={styles.dateHeading}>
              {activeBoard.title} · {dateLabel(date)}
            </Text>
            <View style={styles.grid} onLayout={(event) => setGridWidth(Math.round(event.nativeEvent.layout.width))}>
              {cellWidth
                ? activeBoard.widgets.map((widget) => (
                    <WidgetCard
                      key={widget.id}
                      widget={widget}
                      entry={results[entryKey(widget.id, date)]}
                      width={cellWidth}
                      mapsKey={mapsKey}
                      compact={compact}
                      onRefresh={() => refreshOne(widget)}
                      onRemove={() => removeWidget(widget)}
                      onOpenCustomer={onOpenCustomer}
                      onOpenDocument={onOpenDocument}
                    />
                  ))
                : null}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    minHeight: 0,
    backgroundColor: CANVAS,
  },
  center: {
    paddingTop: 48,
    alignItems: 'center',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: RULE,
    zIndex: 5,
  },
  topBarPhone: {
    paddingHorizontal: 12,
    borderBottomWidth: 0,
    paddingBottom: 4,
  },
  topBarTrail: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
  },
  tabsScroll: {
    flex: 1,
    minWidth: 0,
  },
  tabsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingRight: 8,
    paddingBottom: 2,
  },
  tabWrap: {
    position: 'relative',
  },
  tabWrapMenu: {
    zIndex: 20,
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 34,
    paddingLeft: 12,
    paddingRight: 10,
    borderRadius: 17,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: CHIP_BORDER,
    backgroundColor: '#fff',
    maxWidth: 260,
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  tabHover: {
    backgroundColor: '#f0f0f2',
  },
  tabOn: {
    backgroundColor: INK,
    borderColor: INK,
  },
  tabText: {
    fontFamily: FONT,
    fontSize: 13,
    fontWeight: '500',
    color: INK,
    flexShrink: 1,
  },
  tabTextOn: {
    color: '#fff',
  },
  tabCount: {
    fontFamily: FONT,
    fontSize: 11,
    color: SECONDARY,
  },
  tabCountOn: {
    color: 'rgba(255,255,255,0.7)',
  },
  tabMore: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  tabAdd: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 34,
    paddingHorizontal: 10,
    borderRadius: 17,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: CHIP_BORDER,
    borderStyle: 'dashed',
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  tabAddText: {
    fontFamily: FONT,
    fontSize: 13,
    color: INK,
  },
  tabMenu: {
    position: 'absolute',
    top: 38,
    left: 0,
    minWidth: 190,
    paddingVertical: 4,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: CHIP_BORDER,
    backgroundColor: '#fff',
    ...CARD_SHADOW,
    zIndex: 30,
  },
  dateGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  dateArrow: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  dateArrowOn: {
    backgroundColor: 'rgba(0,0,0,0.05)',
  },
  dateArrowOff: {
    opacity: 0.35,
  },
  phoneDateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: RULE,
  },
  refreshAll: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 34,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: CHIP_BORDER,
    backgroundColor: '#fff',
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  ghost: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 8,
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  ghostOn: {
    backgroundColor: 'rgba(0,0,0,0.05)',
  },
  ghostText: {
    fontFamily: FONT,
    fontSize: 13,
    fontWeight: '500',
    color: INK,
  },
  solid: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: INK,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 72,
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  solidOn: {
    backgroundColor: '#000',
  },
  solidOff: {
    opacity: 0.4,
  },
  solidText: {
    fontFamily: FONT,
    fontSize: 13,
    fontWeight: '600',
    color: '#fff',
  },
  notice: {
    marginHorizontal: 20,
    marginTop: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: '#FEE2E2',
  },
  noticeText: {
    fontFamily: FONT,
    fontSize: 13,
    color: '#b42318',
  },
  body: {
    flex: 1,
    minHeight: 0,
  },
  bodyContent: {
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 40,
  },
  bodyContentPhone: {
    paddingHorizontal: 12,
    paddingTop: 10,
  },
  dateHeading: {
    fontFamily: FONT_LIGHT,
    fontSize: 20,
    lineHeight: 26,
    color: INK,
    letterSpacing: -0.3,
    marginBottom: 12,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GAP,
    alignItems: 'flex-start',
  },
  card: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: CHIP_BORDER,
    backgroundColor: '#fff',
    padding: 14,
    gap: 8,
    ...CARD_SHADOW,
  },
  cardPhone: {
    padding: 12,
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  cardIcon: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f0f0f2',
    marginTop: 1,
  },
  cardHeadText: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  cardTitle: {
    fontFamily: FONT,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '600',
    color: INK,
    letterSpacing: -0.2,
  },
  cardQuestion: {
    fontFamily: FONT,
    fontSize: 12,
    lineHeight: 16,
    color: SECONDARY,
  },
  cardAction: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  cardActionOn: {
    backgroundColor: 'rgba(0,0,0,0.05)',
  },
  cardActionOff: {
    opacity: 0.6,
  },
  cardMenuAnchor: {
    position: 'relative',
    zIndex: 10,
  },
  cardMenu: {
    position: 'absolute',
    top: 32,
    right: 0,
    minWidth: 170,
    paddingVertical: 4,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: CHIP_BORDER,
    backgroundColor: '#fff',
    ...CARD_SHADOW,
    zIndex: 30,
  },
  cardMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  cardMenuItemOn: {
    backgroundColor: '#f0f0f2',
  },
  cardMenuText: {
    fontFamily: FONT,
    fontSize: 13,
    color: INK,
  },
  cardMenuDanger: {
    color: '#b91c1c',
  },
  cardMeta: {
    fontFamily: FONT,
    fontSize: 11,
    lineHeight: 14,
    color: SECONDARY,
    marginTop: -2,
  },
  cardMetaBusy: {
    color: BLUE,
  },
  cardError: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: '#FEF2F2',
  },
  cardErrorText: {
    flex: 1,
    minWidth: 120,
    fontFamily: FONT,
    fontSize: 12,
    lineHeight: 16,
    color: '#b42318',
  },
  cardRetry: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  cardRetryText: {
    fontFamily: FONT,
    fontSize: 12,
    fontWeight: '600',
    color: INK,
  },
  cardBody: {
    gap: 8,
  },
  cardBodyStale: {
    opacity: 0.55,
  },
  cardText: {
    fontFamily: FONT,
    fontSize: 13,
    lineHeight: 19,
    color: INK,
  },
  cardTextOnly: {
    fontSize: 15,
    lineHeight: 22,
    paddingVertical: 4,
  },
  cardPending: {
    minHeight: 120,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 12,
    backgroundColor: '#fafafa',
  },
  cardPendingText: {
    fontFamily: FONT,
    fontSize: 12,
    color: SECONDARY,
    textAlign: 'center',
    paddingHorizontal: 12,
  },
  sheetRoot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  sheetCard: {
    width: 380,
    maxWidth: '92%',
    borderRadius: 16,
    backgroundColor: '#fff',
    padding: 18,
    gap: 12,
    ...CARD_SHADOW,
  },
  sheetCardPhone: {
    width: '92%',
  },
  sheetTitle: {
    fontFamily: FONT,
    fontSize: 16,
    fontWeight: '600',
    color: INK,
  },
  sheetInput: {
    fontFamily: FONT,
    fontSize: 15,
    color: INK,
    height: 42,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: CHIP_BORDER,
    backgroundColor: '#fff',
  },
  sheetActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
});
