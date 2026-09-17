import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  countActionLogs,
  getActionLogStatus,
  listActionLogs,
  subscribeActionLogInserts,
  subscribeActionLogStatus,
  verifyActionLogChain,
} from '../lib/actionLog';

const fontFamily = Platform.select({ ios: 'Sohne', android: 'Sohne', default: 'Sohne' });
const monoFamily = Platform.select({ ios: 'SohneMono', android: 'SohneMono', default: 'SohneMono' });

const ACCENT = '#0F172A';
const HAIRLINE = '#e6e6e6';
const TEXT = '#1a1a1a';
const MUTED = '#6b6b6b';
const FAINT = '#9a9a9a';
const GREEN = '#2F8A4E';
const RED = '#B91C1C';
const PAGE = 60;

const SCOPES = [
  { key: 'all', label: 'Everyone' },
  { key: 'mine', label: 'Me' },
];

function pad(n) {
  return String(n).padStart(2, '0');
}

function timeLabel(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function dayKey(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function dayLabel(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (dayKey(date.toISOString()) === dayKey(today.toISOString())) return 'Today';
  if (dayKey(date.toISOString()) === dayKey(yesterday.toISOString())) return 'Yesterday';
  return date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

function actionVerb(action) {
  return action === 'long_press' ? 'long-pressed' : 'pressed';
}

function targetLabel(entry) {
  if (entry.label) return `“${entry.label}”`;
  if (entry.icon) return `the ${entry.icon.replace(/-outline$/, '').replace(/-/g, ' ')} icon`;
  if (entry.testId) return entry.testId;
  return 'an unlabeled control';
}

function whereLabel(entry) {
  const parts = [];
  if (entry.appLabel) parts.push(entry.appLabel);
  else if (entry.tab) parts.push(entry.tab.charAt(0).toUpperCase() + entry.tab.slice(1));
  if (entry.storeName) parts.push(entry.storeName);
  if (entry.platform) parts.push(entry.platform);
  return parts.join(' · ');
}

function matchesQuery(entry, query) {
  const q = String(query || '')
    .trim()
    .toLowerCase();
  if (!q) return true;
  return [entry.label, entry.actorName, entry.actorLogin, entry.appLabel, entry.icon, entry.storeName]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(q));
}

function SearchField({ value, onChangeText }) {
  return (
    <View style={styles.search}>
      <Ionicons name="search" size={14} color={FAINT} />
      <TextInput
        style={styles.searchInput}
        value={value}
        onChangeText={onChangeText}
        placeholder="Search people, buttons, apps"
        placeholderTextColor={FAINT}
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel="Search logs"
      />
      {value ? (
        <Pressable onPress={() => onChangeText('')} hitSlop={8} accessibilityLabel="Clear log search">
          <Ionicons name="close-circle" size={16} color="#c7c7cc" />
        </Pressable>
      ) : null}
    </View>
  );
}

function Segmented({ options, value, onChange }) {
  return (
    <View style={styles.segmented} accessibilityRole="tablist">
      {options.map((option) => {
        const active = option.key === value;
        return (
          <Pressable
            key={option.key}
            style={[styles.segment, active && styles.segmentActive]}
            onPress={() => onChange(option.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`Show logs for ${option.label.toLowerCase()}`}
          >
            <Text style={[styles.segmentLabel, active && styles.segmentLabelActive]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function LogRow({ entry, expanded, onToggle, showDay }) {
  return (
    <View>
      {showDay ? (
        <View style={styles.dayDivider}>
          <Text style={styles.dayLabel}>{dayLabel(entry.clientTs)}</Text>
        </View>
      ) : null}
      <Pressable
        style={[styles.row, expanded && styles.rowExpanded]}
        onPress={onToggle}
        accessibilityLabel={`Log entry ${entry.seq}`}
      >
        <Text style={styles.time}>{timeLabel(entry.clientTs)}</Text>
        <View style={styles.rowBody}>
          <Text style={styles.rowTitle} numberOfLines={expanded ? undefined : 2}>
            <Text style={styles.actor}>{entry.actorName}</Text>
            <Text style={styles.verb}> {actionVerb(entry.action)} </Text>
            <Text style={styles.target}>{targetLabel(entry)}</Text>
          </Text>
          {whereLabel(entry) ? (
            <Text style={styles.rowMeta} numberOfLines={1}>
              {whereLabel(entry)}
            </Text>
          ) : null}
          {expanded ? (
            <View style={styles.details}>
              <Detail label="Sequence" value={`#${entry.seq}`} />
              <Detail label="Recorded" value={new Date(entry.createdAt || entry.clientTs).toLocaleString()} />
              <Detail label="Login" value={entry.actorLogin || '—'} />
              <Detail label="Role" value={entry.actorRole || '—'} />
              <Detail label="Tab" value={entry.tab || '—'} />
              <Detail label="App" value={entry.appKey || '—'} />
              <Detail label="Icon" value={entry.icon || '—'} />
              <Detail label="Test ID" value={entry.testId || '—'} />
              <Detail label="Session" value={entry.appSessionId || '—'} mono />
              <Detail label="Event" value={entry.clientEventId || '—'} mono />
              <Detail label="Hash" value={entry.hash || '—'} mono />
              <Detail label="Previous" value={entry.prevHash || '—'} mono />
            </View>
          ) : null}
        </View>
        <View style={styles.rowRight}>
          <Text style={styles.seq}>#{entry.seq}</Text>
          <Text style={styles.hash} numberOfLines={1}>
            {entry.hash.slice(0, 10)}
          </Text>
        </View>
      </Pressable>
    </View>
  );
}

function Detail({ label, value, mono }) {
  return (
    <View style={styles.detail}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={[styles.detailValue, mono && styles.detailMono]} selectable>
        {value}
      </Text>
    </View>
  );
}

export default function LogsScreen({ session }) {
  const myId = session?.supabaseUserId || session?.profile?.id || '';
  const [scope, setScope] = useState('all');
  const [query, setQuery] = useState('');
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState('');
  const [total, setTotal] = useState(null);
  const [expandedId, setExpandedId] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [verification, setVerification] = useState(null);
  const [status, setStatus] = useState(() => getActionLogStatus());
  const [live, setLive] = useState(false);
  const requestSeq = useRef(0);
  const filtersRef = useRef({ scope, query });

  const [debouncedQuery, setDebouncedQuery] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    filtersRef.current = { scope, query: debouncedQuery };
  }, [scope, debouncedQuery]);

  const filters = useMemo(
    () => ({
      query: debouncedQuery,
      actorId: scope === 'mine' ? myId : '',
    }),
    [debouncedQuery, scope, myId],
  );

  const load = useCallback(
    async ({ append = false, beforeSeq } = {}) => {
      const requestId = ++requestSeq.current;
      if (append) setLoadingMore(true);
      else setLoading(true);
      setError('');
      try {
        const rows = await listActionLogs({ ...filters, limit: PAGE, beforeSeq });
        if (requestId !== requestSeq.current) return;
        setEntries((current) => {
          if (!append) return rows;
          const seen = new Set(current.map((item) => item.id));
          return [...current, ...rows.filter((item) => !seen.has(item.id))];
        });
        setHasMore(rows.length >= PAGE);
      } catch (loadError) {
        if (requestId !== requestSeq.current) return;
        setError(loadError?.message || 'Could not load the ledger.');
        if (!append) setEntries([]);
        setHasMore(false);
      } finally {
        if (requestId === requestSeq.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [filters],
  );

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    countActionLogs()
      .then((count) => {
        if (!cancelled) setTotal(count);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [filters]);

  useEffect(() => subscribeActionLogStatus(setStatus), []);

  useEffect(() => {
    setLive(false);
    const unsubscribe = subscribeActionLogInserts((entry) => {
      setLive(true);
      setTotal((count) => (count == null ? count : count + 1));
      const current = filtersRef.current;
      if (current.scope === 'mine' && entry.actorId !== myId) return;
      if (!matchesQuery(entry, current.query)) return;
      setEntries((list) => {
        if (list.some((item) => item.id === entry.id)) return list;
        return [entry, ...list];
      });
    });
    return unsubscribe;
  }, [myId]);

  const verify = useCallback(async () => {
    setVerifying(true);
    try {
      const result = await verifyActionLogChain();
      setVerification({ ...result, at: new Date() });
    } catch (verifyError) {
      setVerification({ ok: false, error: verifyError?.message || 'Could not verify the ledger.', at: new Date() });
    } finally {
      setVerifying(false);
    }
  }, []);

  const loadMore = useCallback(() => {
    if (loading || loadingMore || !hasMore || entries.length === 0) return;
    const oldest = entries[entries.length - 1];
    load({ append: true, beforeSeq: oldest.seq });
  }, [entries, hasMore, load, loading, loadingMore]);

  const summary = useMemo(() => {
    const parts = [];
    if (total != null) parts.push(`${total.toLocaleString()} ${total === 1 ? 'entry' : 'entries'}`);
    parts.push('append-only');
    if (status.pending > 0) parts.push(`${status.pending} syncing`);
    return parts.join(' · ');
  }, [total, status.pending]);

  const renderItem = useCallback(
    ({ item, index }) => {
      const previous = index > 0 ? entries[index - 1] : null;
      const showDay = !previous || dayKey(previous.clientTs) !== dayKey(item.clientTs);
      return (
        <LogRow
          entry={item}
          expanded={expandedId === item.id}
          showDay={showDay}
          onToggle={() => setExpandedId((current) => (current === item.id ? '' : item.id))}
        />
      );
    },
    [entries, expandedId],
  );

  return (
    <View style={styles.screen}>
      <View style={styles.toolbar}>
        <SearchField value={query} onChangeText={setQuery} />
        <Segmented options={SCOPES} value={scope} onChange={setScope} />
        <Pressable
          style={[styles.verifyButton, verifying && styles.verifyButtonBusy]}
          onPress={verify}
          disabled={verifying}
          accessibilityLabel="Verify ledger integrity"
        >
          {verifying ? (
            <ActivityIndicator size="small" color={ACCENT} />
          ) : (
            <Ionicons
              name={
                verification == null
                  ? 'shield-checkmark-outline'
                  : verification.ok
                    ? 'shield-checkmark'
                    : 'alert-circle'
              }
              size={15}
              color={verification == null ? ACCENT : verification.ok ? GREEN : RED}
            />
          )}
          <Text style={styles.verifyLabel}>Verify</Text>
        </Pressable>
      </View>

      <View style={styles.summaryRow}>
        <View style={[styles.liveDot, live && styles.liveDotOn]} />
        <Text style={styles.summary} numberOfLines={1}>
          {summary}
        </Text>
        {verification ? (
          <Text style={[styles.verifyResult, { color: verification.ok ? GREEN : RED }]} numberOfLines={1}>
            {verification.error
              ? verification.error
              : verification.ok
                ? `Chain intact · ${verification.checked.toLocaleString()} checked`
                : `Break at #${verification.firstBadSeq}`}
          </Text>
        ) : null}
      </View>

      {status.lastError ? <Text style={styles.syncNotice}>{status.lastError}</Text> : null}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={ACCENT} />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <View style={styles.emptyIcon}>
            <Ionicons name="alert-circle-outline" size={22} color={RED} />
          </View>
          <Text style={styles.emptyTitle}>Ledger unavailable</Text>
          <Text style={styles.emptyBody}>{error}</Text>
          <Pressable style={styles.retry} onPress={() => load()} accessibilityLabel="Retry loading logs">
            <Text style={styles.retryLabel}>Try again</Text>
          </Pressable>
        </View>
      ) : entries.length === 0 ? (
        <View style={styles.center}>
          <View style={styles.emptyIcon}>
            <Ionicons name="reader-outline" size={22} color={ACCENT} />
          </View>
          <Text style={styles.emptyTitle}>No activity yet</Text>
          <Text style={styles.emptyBody}>
            {debouncedQuery
              ? `Nothing in the ledger matches “${debouncedQuery}”.`
              : 'Every button press across the app is recorded here as it happens.'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={entries}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          onEndReached={loadMore}
          onEndReachedThreshold={0.6}
          ListFooterComponent={
            loadingMore ? (
              <View style={styles.footer}>
                <ActivityIndicator size="small" color={FAINT} />
              </View>
            ) : !hasMore ? (
              <View style={styles.footer}>
                <Text style={styles.footerText}>Beginning of ledger</Text>
              </View>
            ) : null
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#fff',
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 20,
    paddingTop: 8,
    width: '100%',
    maxWidth: 960,
    alignSelf: 'center',
  },
  search: {
    flex: 1,
    minWidth: 140,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 36,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: '#f2f2f4',
  },
  searchInput: {
    flex: 1,
    fontFamily,
    fontSize: 14,
    color: TEXT,
    paddingVertical: 0,
    ...Platform.select({ web: { outlineStyle: 'none' }, default: {} }),
  },
  segmented: {
    flexDirection: 'row',
    backgroundColor: '#f2f2f4',
    borderRadius: 10,
    padding: 3,
  },
  segment: {
    paddingHorizontal: 12,
    height: 30,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  segmentActive: {
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
  },
  segmentLabel: {
    fontFamily,
    fontSize: 13,
    fontWeight: '500',
    color: MUTED,
  },
  segmentLabelActive: {
    color: TEXT,
    fontWeight: '600',
  },
  verifyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 36,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#d4d4d8',
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  verifyButtonBusy: {
    opacity: 0.7,
  },
  verifyLabel: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: TEXT,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 8,
    width: '100%',
    maxWidth: 960,
    alignSelf: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HAIRLINE,
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#d4d4d8',
  },
  liveDotOn: {
    backgroundColor: GREEN,
  },
  summary: {
    flexShrink: 1,
    fontFamily,
    fontSize: 12,
    color: MUTED,
  },
  verifyResult: {
    marginLeft: 'auto',
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
  },
  syncNotice: {
    fontFamily,
    fontSize: 12,
    color: '#A16207',
    paddingHorizontal: 20,
    paddingTop: 8,
    width: '100%',
    maxWidth: 960,
    alignSelf: 'center',
  },
  listContent: {
    paddingBottom: 40,
    width: '100%',
    maxWidth: 960,
    alignSelf: 'center',
  },
  dayDivider: {
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 6,
  },
  dayLabel: {
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
    color: FAINT,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HAIRLINE,
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  rowExpanded: {
    backgroundColor: '#fafafa',
  },
  time: {
    fontFamily: monoFamily,
    fontSize: 12,
    color: MUTED,
    width: 64,
    paddingTop: 2,
  },
  rowBody: {
    flex: 1,
    minWidth: 0,
  },
  rowTitle: {
    fontFamily,
    fontSize: 14,
    lineHeight: 20,
    color: TEXT,
  },
  actor: {
    fontWeight: '600',
  },
  verb: {
    color: MUTED,
  },
  target: {
    color: TEXT,
  },
  rowMeta: {
    marginTop: 2,
    fontFamily,
    fontSize: 12,
    color: FAINT,
  },
  rowRight: {
    alignItems: 'flex-end',
    width: 84,
  },
  seq: {
    fontFamily: monoFamily,
    fontSize: 12,
    color: MUTED,
  },
  hash: {
    marginTop: 2,
    fontFamily: monoFamily,
    fontSize: 11,
    color: FAINT,
  },
  details: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: HAIRLINE,
    gap: 6,
  },
  detail: {
    flexDirection: 'row',
    gap: 10,
  },
  detailLabel: {
    fontFamily,
    fontSize: 12,
    color: FAINT,
    width: 72,
  },
  detailValue: {
    flex: 1,
    fontFamily,
    fontSize: 12,
    color: TEXT,
  },
  detailMono: {
    fontFamily: monoFamily,
    fontSize: 11,
  },
  center: {
    flex: 1,
    minHeight: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingBottom: 48,
  },
  emptyIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  emptyTitle: {
    fontFamily,
    fontSize: 20,
    fontWeight: '600',
    color: TEXT,
    letterSpacing: -0.3,
    marginBottom: 6,
  },
  emptyBody: {
    fontFamily,
    fontSize: 15,
    lineHeight: 21,
    color: MUTED,
    textAlign: 'center',
    maxWidth: 340,
  },
  retry: {
    marginTop: 14,
    paddingHorizontal: 14,
    height: 34,
    borderRadius: 9,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#d4d4d8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryLabel: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: TEXT,
  },
  footer: {
    paddingVertical: 20,
    alignItems: 'center',
  },
  footerText: {
    fontFamily,
    fontSize: 12,
    color: FAINT,
  },
});
