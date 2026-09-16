import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { usePhoneCalls } from './PhoneCallProvider';
import { fetchTransferStores } from '../lib/locations';
import {
  fetchVoicemailAudioUrl,
  formatCallWhen,
  formatDuration,
  inboundCallsUnique,
  inboundCallRatio,
  isAnsweredInbound,
  resultLabel,
} from '../lib/phoneCalls';
import {
  canManageRingCentral,
  connectionLabel,
  fetchRingCentralStoreDetails,
  formatCheckedAt,
  formatPhoneNumber,
  formatUsageType,
  listRingCentralAccounts,
} from '../lib/ringcentral';
import { storeKeyFromName } from '../lib/storeSettings';

const fontFamily = Platform.select({
  ios: 'Sohne',
  android: 'Sohne',
  default: 'Sohne',
});

const ACCENT = '#15803D';
const TABS = [
  { key: 'incoming', label: 'Incoming' },
  { key: 'missed', label: 'Missed' },
  { key: 'log', label: 'Call log' },
  { key: 'dial', label: 'Making calls' },
  { key: 'voicemail', label: 'Voicemail' },
  { key: 'stats', label: 'Ratio' },
];
const KEYPAD = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];
const DATE_RANGES = [
  { key: 'today', label: 'Today' },
  { key: '7d', label: '7 days' },
  { key: '14d', label: '14 days' },
];

function statusTone(row) {
  const status = row?.lastStatus || connectionLabel(row);
  if (status === 'connected' || status === 'Connected') return styles.statusConnected;
  if (status === 'error' || status === 'Error') return styles.statusError;
  return styles.statusMuted;
}

function applyAccount(current, next) {
  if (!next?.storeKey) return current;
  return [...current.filter((row) => row.storeKey !== next.storeKey), next];
}

function rangeSinceMs(key) {
  if (key === 'today') {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return start.getTime();
  }
  const days = key === '7d' ? 7 : 14;
  return Date.now() - days * 24 * 60 * 60 * 1000;
}

function rangeCopy(key) {
  if (key === 'today') return 'today';
  if (key === '7d') return 'the last 7 days';
  return 'the last 14 days';
}

function inDateRange(value, since) {
  const time = Date.parse(value);
  return Number.isFinite(time) && time >= since;
}

function DetailRow({ label, value }) {
  if (!value) return null;
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

function partyLine(entry, inbound) {
  const number = inbound ? entry.from : entry.to;
  const name = inbound ? entry.fromName : entry.toName;
  return [name, number ? formatPhoneNumber(number) : ''].filter(Boolean).join(' · ') || 'Unknown';
}

function CallHistoryRow({ row, inbound = true, showDirection = false, onCallback, callbackBusy }) {
  const missed = inbound && !isAnsweredInbound(row);
  const icon = !inbound ? 'arrow-up' : missed ? 'call-outline' : 'arrow-down';
  return (
    <View style={styles.itemRow}>
      <View style={styles.callIcon}>
        <Ionicons name={icon} size={14} color={missed ? '#B91C1C' : ACCENT} />
      </View>
      <View style={styles.itemText}>
        <Text style={styles.itemTitle}>{partyLine(row, inbound)}</Text>
        <Text style={styles.itemMeta}>
          {[
            showDirection ? (inbound ? 'Inbound' : 'Outbound') : '',
            resultLabel(row.result),
            formatCallWhen(row.startTime),
            row.duration ? formatDuration(row.duration) : '',
          ]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      </View>
      {onCallback ? (
        <Pressable
          style={[styles.callbackBtn, callbackBusy && styles.callbackBtnDisabled]}
          onPress={() => onCallback(row)}
          disabled={callbackBusy}
          accessibilityLabel="Call back"
        >
          {callbackBusy ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <>
              <Ionicons name="call" size={12} color="#fff" />
              <Text style={styles.callbackText}>Call back</Text>
            </>
          )}
        </Pressable>
      ) : null}
    </View>
  );
}

function RatioStrip({ stats, compact = false, rangeLabel = 'the last 14 days' }) {
  const empty = !stats?.total;
  return (
    <View style={[styles.ratioBlock, compact && styles.ratioBlockCompact]}>
      <View style={styles.ratioStats}>
        <View style={[styles.ratioStat, compact && styles.ratioStatCompact]}>
          <Text style={styles.summaryLabel}>Answered</Text>
          <Text style={[styles.summaryValue, compact && styles.summaryValueCompact, stats.answered ? styles.statusConnected : null]}>
            {stats.answered}
          </Text>
        </View>
        <View style={[styles.ratioStat, compact && styles.ratioStatCompact]}>
          <Text style={styles.summaryLabel}>Missed</Text>
          <Text style={[styles.summaryValue, compact && styles.summaryValueCompact, stats.missed ? styles.statusError : null]}>{stats.missed}</Text>
        </View>
        <View style={[styles.ratioStat, compact && styles.ratioStatCompact]}>
          <Text style={styles.summaryLabel}>Total</Text>
          <Text style={[styles.summaryValue, compact && styles.summaryValueCompact]}>{stats.total}</Text>
        </View>
        {compact ? null : (
          <View style={styles.ratioStat}>
            <Text style={styles.summaryLabel}>Answer rate</Text>
            <Text style={styles.summaryValue}>{stats.rate == null ? '—' : `${stats.answered}:${stats.total}`}</Text>
          </View>
        )}
      </View>
      <View style={[styles.ratioBarTrack, compact && styles.ratioBarTrackCompact]}>
        {empty ? (
          <View style={styles.ratioBarEmpty} />
        ) : (
          <>
            <View style={[styles.ratioBarFill, { flex: stats.answered || 0 }]} />
            <View style={[styles.ratioBarMissed, { flex: stats.missed || 0 }]} />
          </>
        )}
      </View>
      <Text style={styles.sectionMeta}>
        {empty
          ? `No inbound calls ${rangeLabel}.`
          : stats.rate == null
            ? `No inbound calls ${rangeLabel}.`
            : `${stats.rate}% answered · ${stats.answered} of ${stats.total} · ${rangeLabel}`}
      </Text>
    </View>
  );
}

export default function PhoneScreen({ session, onRequireLogin, storeFilter }) {
  const canManage = canManageRingCentral(session?.profile);
  const phone = usePhoneCalls();
  const [tab, setTab] = useState('incoming');
  const [dateRange, setDateRange] = useState('14d');
  const [stores, setStores] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [query, setQuery] = useState('');
  const [selectedKey, setSelectedKey] = useState('');
  const [details, setDetails] = useState(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [showStores, setShowStores] = useState(false);
  const [digits, setDigits] = useState('');
  const [playingId, setPlayingId] = useState('');
  const [playError, setPlayError] = useState('');
  const audioRef = useRef(null);
  const objectUrlRef = useRef('');
  const requestId = useRef(0);
  const detailsRequest = useRef(0);

  const storeKey = phone.selectedStoreKey;
  const refreshInbox = phone.refreshInbox;
  const calls = phone.mergedCallsByStore?.[storeKey] || [];
  const voicemails = phone.inboxByStore?.[storeKey]?.voicemails || [];
  const inboxLoading = Boolean(phone.inboxFetching?.[storeKey]);

  const load = useCallback(async () => {
    if (!session?.token) {
      setStores([]);
      setAccounts([]);
      setError('');
      setWarning('');
      return;
    }

    const id = ++requestId.current;
    setLoading(true);
    setError('');
    setWarning('');

    try {
      const [pos, ringcentral] = await Promise.all([
        fetchTransferStores(session),
        listRingCentralAccounts(),
      ]);
      if (id !== requestId.current) return;
      setStores(pos.stores || []);
      setAccounts(ringcentral.rows || []);
      const notes = [pos.warning];
      if (ringcentral.unavailable) {
        notes.push('RingCentral tables are not installed yet. Run the Phone migration in Supabase.');
      }
      setWarning(notes.filter(Boolean).join(' '));
    } catch (err) {
      if (id !== requestId.current) return;
      setStores([]);
      setAccounts([]);
      setError(err?.message || 'Failed to load stores.');
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    load();
  }, [load]);

  const loadInbox = useCallback(async () => {
    if (!storeKey) return;
    try {
      await refreshInbox(storeKey, { force: true });
      setError('');
    } catch (err) {
      setError(err?.message || 'Could not load calls.');
    }
  }, [refreshInbox, storeKey]);

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = '';
      }
    };
  }, []);

  const accountByKey = useMemo(() => {
    const next = new Map();
    for (const row of accounts) next.set(row.storeKey, row);
    return next;
  }, [accounts]);

  const rows = useMemo(() => {
    const seen = new Set();
    const next = [];
    const posStores = storeFilter
      ? stores.filter((store) => storeKeyFromName(store.name) === storeKeyFromName(storeFilter))
      : stores;

    for (const store of posStores) {
      const key = storeKeyFromName(store.name);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      next.push({
        key,
        storeName: store.name,
        address: store.address || '',
        posPhone: store.phone || '',
        account: accountByKey.get(key) || null,
      });
    }

    for (const account of accounts) {
      if (seen.has(account.storeKey)) continue;
      if (storeFilter && account.storeKey !== storeKeyFromName(storeFilter)) continue;
      seen.add(account.storeKey);
      next.push({
        key: account.storeKey,
        storeName: account.storeName,
        address: '',
        posPhone: '',
        account,
      });
    }

    const needle = query.trim().toLowerCase();
    const filtered = needle
      ? next.filter((row) =>
          [row.storeName, row.account?.mainNumber, row.account?.companyName, row.posPhone]
            .join(' ')
            .toLowerCase()
            .includes(needle),
        )
      : next;

    filtered.sort((a, b) => a.storeName.localeCompare(b.storeName, undefined, { sensitivity: 'base' }));
    return filtered;
  }, [accounts, accountByKey, query, storeFilter, stores]);

  const selected = rows.find((row) => row.key === selectedKey) || null;
  const activeAccount = phone.stores.find((row) => row.storeKey === storeKey) || accountByKey.get(storeKey) || null;
  const incomingLive = phone.incoming;
  const rangeSince = useMemo(() => rangeSinceMs(dateRange), [dateRange]);
  const rangeLabel = rangeCopy(dateRange);
  const visibleCalls = useMemo(
    () => (Array.isArray(calls) ? calls : []).filter((row) => inDateRange(row.startTime, rangeSince)),
    [calls, rangeSince],
  );
  const visibleVoicemails = useMemo(
    () => (Array.isArray(voicemails) ? voicemails : []).filter((row) => inDateRange(row.creationTime, rangeSince)),
    [voicemails, rangeSince],
  );
  const inboundCalls = useMemo(() => inboundCallsUnique(visibleCalls), [visibleCalls]);
  const outboundCalls = visibleCalls.filter((row) => row.direction === 'Outbound');
  const ratio = useMemo(() => inboundCallRatio(visibleCalls), [visibleCalls]);
  const storeRatios = useMemo(() => {
    const next = {};
    for (const row of phone.stores) {
      const storeCalls = (phone.mergedCallsByStore?.[row.storeKey] || []).filter((call) =>
        inDateRange(call.startTime, rangeSince),
      );
      next[row.storeKey] = inboundCallRatio(storeCalls);
    }
    return next;
  }, [phone.mergedCallsByStore, phone.stores, rangeSince]);
  const answeredCalls = inboundCalls.filter((row) => isAnsweredInbound(row));
  const missedCalls = inboundCalls.filter((row) => !isAnsweredInbound(row));
  const callLog = useMemo(() => {
    const rows = [...visibleCalls];
    rows.sort((a, b) => String(b.startTime || '').localeCompare(String(a.startTime || '')));
    return rows;
  }, [visibleCalls]);

  const callBack = useCallback(
    async (row) => {
      const inbound = row?.direction !== 'Outbound';
      const number = inbound ? row.from : row.to;
      if (!String(number || '').replace(/\D/g, '')) {
        setError('That call has no number to return.');
        return;
      }
      try {
        await phone.ringOut(number, activeAccount?.mainNumber);
        setError('');
      } catch (err) {
        setError(err?.message || 'Could not start the call.');
      }
    },
    [activeAccount?.mainNumber, phone],
  );

  const openStore = useCallback(async (row) => {
    if (!row?.key) return;
    const id = ++detailsRequest.current;
    setSelectedKey(row.key);
    setShowStores(true);
    setDetails(null);
    setError('');
    if (!row.account?.hasJwt) return;

    setDetailsLoading(true);
    try {
      const payload = await fetchRingCentralStoreDetails(row.key);
      if (id !== detailsRequest.current) return;
      setDetails(payload);
      setAccounts((current) => applyAccount(current, payload.store));
      if (payload.store?.lastStatus === 'error' && payload.store.lastError) {
        setError(payload.store.lastError);
      }
    } catch (err) {
      if (id !== detailsRequest.current) return;
      setError(err?.message || 'Could not load RingCentral details.');
    } finally {
      if (id === detailsRequest.current) setDetailsLoading(false);
    }
  }, []);

  const appendDigit = (value) => {
    setDigits((current) => `${current}${value}`.replace(/[^\d*#]/g, '').slice(0, 16));
  };

  const placeCall = async () => {
    const number = digits.replace(/[^\d+]/g, '');
    if (!number) {
      setError('Enter a number to call.');
      return;
    }
    try {
      await phone.ringOut(number, activeAccount?.mainNumber);
      setError('');
    } catch (err) {
      setError(err?.message || 'Could not start the call.');
    }
  };

  const playVoicemail = async (row) => {
    setPlayError('');
    if (playingId === row.id) {
      audioRef.current?.pause();
      setPlayingId('');
      return;
    }
    try {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = '';
      }
      const url = await fetchVoicemailAudioUrl(row.storeKey || storeKey, row.id, row.attachmentId);
      objectUrlRef.current = url;
      if (typeof Audio === 'undefined') {
        setPlayError('Voicemail playback is available in the browser.');
        return;
      }
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => setPlayingId('');
      await audio.play();
      setPlayingId(row.id);
    } catch (err) {
      setPlayError(err?.message || 'Could not play that voicemail.');
      setPlayingId('');
    }
  };

  if (!session?.token) {
    return (
      <View style={[styles.screen, styles.listContent]}>
        <Text style={styles.emptyText}>
          Sign in to view store phones.{' '}
          {onRequireLogin ? (
            <Text style={styles.link} onPress={onRequireLogin}>
              Go to Profile
            </Text>
          ) : null}
        </Text>
      </View>
    );
  }

  if (showStores && selected) {
    const account = details?.store || selected.account;
    const status = connectionLabel(account);
    const numbers = details?.numbers || [];
    const extensions = details?.extensions || [];
    return (
      <View style={styles.screen}>
        <ScrollView style={styles.list} contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}>
          <Pressable
            style={styles.backRow}
            onPress={() => {
              detailsRequest.current += 1;
              setSelectedKey('');
              setDetails(null);
              setDetailsLoading(false);
              setShowStores(false);
              setError('');
            }}
          >
            <Ionicons name="chevron-back" size={16} color="#1a1a1a" />
            <Text style={styles.backText}>Calls</Text>
          </Pressable>

          <Text style={styles.sectionTitle}>{selected.storeName}</Text>
          {selected.address ? <Text style={styles.sectionMeta}>{selected.address}</Text> : null}

          <View style={styles.statusCard}>
            <Text style={[styles.statusValue, statusTone(account)]}>{status}</Text>
            <DetailRow
              label="Number"
              value={
                account?.mainNumber
                  ? formatPhoneNumber(account.mainNumber)
                  : selected.posPhone
                    ? formatPhoneNumber(selected.posPhone)
                    : ''
              }
            />
            <DetailRow label="Account" value={account?.companyName} />
            <DetailRow label="Account ID" value={account?.accountId} />
            <DetailRow
              label="Extensions"
              value={account?.extensionCount ? String(account.extensionCount) : ''}
            />
            <DetailRow label="Checked" value={formatCheckedAt(account?.lastCheckedAt)} />
            {selected.key === storeKey ? (
              <>
                <Text style={styles.detailLabel}>Answered to missed</Text>
                <RatioStrip stats={ratio} compact rangeLabel={rangeLabel} />
              </>
            ) : null}
            {account?.lastError ? <Text style={styles.cellError}>{account.lastError}</Text> : null}
            {!account?.hasJwt ? (
              <Text style={styles.sectionMeta}>
                {canManage
                  ? 'Add this store’s RingCentral JWT in Settings → RingCentral, then open it again.'
                  : 'This store is not connected yet.'}
              </Text>
            ) : null}
          </View>

          {error && account?.lastStatus !== 'error' ? (
            <View style={styles.errorBanner}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          {detailsLoading ? (
            <View style={styles.centered}>
              <ActivityIndicator color={ACCENT} />
              <Text style={styles.sectionMeta}>Loading numbers and extensions…</Text>
            </View>
          ) : null}

          {numbers.length > 0 ? (
            <View style={styles.section}>
              <Text style={styles.blockTitle}>Numbers</Text>
              {numbers.map((row) => (
                <View key={`${row.phoneNumber}-${row.usageType}`} style={styles.itemRow}>
                  <View style={styles.itemText}>
                    <Text style={styles.itemTitle}>{formatPhoneNumber(row.phoneNumber)}</Text>
                    <Text style={styles.itemMeta}>
                      {[formatUsageType(row.usageType), row.extensionNumber ? `ext ${row.extensionNumber}` : '', row.extensionName]
                        .filter(Boolean)
                        .join(' · ')}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          ) : null}

          {extensions.length > 0 ? (
            <View style={styles.section}>
              <Text style={styles.blockTitle}>Extensions</Text>
              {extensions.map((row) => (
                <View key={row.id || row.extensionNumber} style={styles.itemRow}>
                  <View style={styles.extBadge}>
                    <Text style={styles.extBadgeText}>{row.extensionNumber || '—'}</Text>
                  </View>
                  <View style={styles.itemText}>
                    <Text style={styles.itemTitle}>{row.name || 'Extension'}</Text>
                    <Text style={styles.itemMeta}>
                      {[row.type, row.status, row.email].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          ) : null}

          {account?.hasJwt ? (
            <Pressable style={styles.refreshLink} onPress={() => openStore(selected)} disabled={detailsLoading}>
              <Text style={styles.link}>{detailsLoading ? 'Refreshing…' : 'Refresh'}</Text>
            </Pressable>
          ) : null}
        </ScrollView>
      </View>
    );
  }

  if (showStores) {
    return (
      <View style={styles.screen}>
        <ScrollView style={styles.list} contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}>
          <Pressable style={styles.backRow} onPress={() => setShowStores(false)}>
            <Ionicons name="chevron-back" size={16} color="#1a1a1a" />
            <Text style={styles.backText}>Calls</Text>
          </Pressable>
          <Text style={styles.sectionTitle}>Stores</Text>
          <Text style={styles.sectionMeta}>
            {canManage
              ? 'Tap a store for numbers and extensions. Add each store’s RingCentral JWT in Settings → RingCentral.'
              : 'Tap a store for numbers and extensions.'}
          </Text>
          <View style={styles.toolbar}>
            <View style={styles.search}>
              <Ionicons name="search" size={14} color="#8e8e93" />
              <TextInput
                style={styles.searchInput}
                value={query}
                onChangeText={setQuery}
                placeholder="Search stores"
                placeholderTextColor="#8e8e93"
                autoCapitalize="none"
                autoCorrect={false}
                clearButtonMode="while-editing"
              />
            </View>
            <Pressable style={styles.refresh} onPress={load} hitSlop={8} accessibilityLabel="Refresh">
              {loading ? <ActivityIndicator size="small" color={ACCENT} /> : <Ionicons name="refresh" size={16} color="#6b6b6b" />}
            </Pressable>
          </View>
          {warning ? <Text style={styles.warningText}>{warning}</Text> : null}
          {rows.map((row) => {
            const account = row.account;
            const status = connectionLabel(account);
            return (
              <Pressable
                key={row.key}
                style={styles.storeRow}
                onPress={() => openStore(row)}
                accessibilityRole="button"
                accessibilityLabel={`${row.storeName}, ${status}`}
              >
                <View style={styles.storeIcon}>
                  <Ionicons name="call-outline" size={16} color={ACCENT} />
                </View>
                <View style={styles.storeText}>
                  <Text style={styles.storeName} numberOfLines={1}>
                    {row.storeName}
                  </Text>
                  <Text style={styles.cellSub} numberOfLines={1}>
                    {[
                      status,
                      account?.mainNumber
                        ? formatPhoneNumber(account.mainNumber)
                        : row.posPhone
                          ? formatPhoneNumber(row.posPhone)
                          : '',
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                </View>
                <Text style={[styles.rowStatus, statusTone(account)]}>{status}</Text>
                <Ionicons name="chevron-forward" size={16} color="#9a9a9a" />
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <ScrollView style={styles.list} contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}>
        <View style={styles.headerRow}>
          <View style={styles.headerCopy}>
            <Text style={styles.sectionTitle}>Phone</Text>
            <Text style={styles.sectionMeta} numberOfLines={1}>
              {activeAccount?.storeName || 'Connect a store in Settings → RingCentral'}
            </Text>
          </View>
          <View style={styles.headerActions}>
            <Pressable
              style={[styles.iconBtn, phone.silent && styles.iconBtnActive]}
              onPress={() => phone.setSilent(!phone.silent)}
              accessibilityLabel={phone.silent ? 'Turn ringtone on' : 'Silence ringtone'}
            >
              <Ionicons name={phone.silent ? 'notifications-off' : 'notifications'} size={16} color={phone.silent ? '#991B1B' : '#1a1a1a'} />
            </Pressable>
            <Pressable style={styles.iconBtn} onPress={loadInbox} accessibilityLabel="Refresh calls">
              {inboxLoading ? <ActivityIndicator size="small" color={ACCENT} /> : <Ionicons name="refresh" size={16} color="#6b6b6b" />}
            </Pressable>
            <Pressable style={styles.storesLink} onPress={() => setShowStores(true)}>
              <Text style={styles.link}>Stores</Text>
            </Pressable>
          </View>
        </View>

        {phone.stores.length > 1 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.storeChips}>
            {phone.stores.map((row) => {
              const active = row.storeKey === storeKey;
              const storeRatio = storeRatios[row.storeKey];
              return (
                <Pressable
                  key={row.storeKey}
                  style={[styles.chip, active && styles.chipActive]}
                  onPress={() => phone.setSelectedStoreKey(row.storeKey)}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>{row.storeName}</Text>
                  {storeRatio?.total ? (
                    <Text style={[styles.chipRatio, active && styles.chipRatioActive]}>
                      {storeRatio.ratio}
                    </Text>
                  ) : null}
                </Pressable>
              );
            })}
          </ScrollView>
        ) : null}

        {activeAccount ? (
          <Pressable style={styles.compactStatus} onPress={() => setTab('stats')} accessibilityLabel="Open ratio">
            <Text style={[styles.compactStatusText, statusTone(activeAccount)]} numberOfLines={1}>
              {connectionLabel(activeAccount)}
            </Text>
            {activeAccount.mainNumber ? (
              <Text style={styles.compactStatusText} numberOfLines={1}>
                {formatPhoneNumber(activeAccount.mainNumber)}
              </Text>
            ) : null}
            {ratio.total ? (
              <Text style={styles.compactStatusText} numberOfLines={1}>
                {ratio.ratio}
              </Text>
            ) : null}
          </Pressable>
        ) : null}

        <View style={styles.dateRow}>
          {DATE_RANGES.map((item) => {
            const active = dateRange === item.key;
            return (
              <Pressable
                key={item.key}
                style={[styles.dateChip, active && styles.dateChipActive]}
                onPress={() => setDateRange(item.key)}
              >
                <Text style={[styles.dateChipText, active && styles.dateChipTextActive]}>{item.label}</Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.tabs}>
          {TABS.map((item) => {
            const active = tab === item.key;
            const badge =
              item.key === 'incoming'
                ? incomingLive.length
                : item.key === 'missed'
                  ? missedCalls.length
                  : item.key === 'voicemail'
                    ? visibleVoicemails.filter((row) => row.readStatus === 'Unread').length
                    : 0;
            return (
              <Pressable key={item.key} style={[styles.tab, active && styles.tabActive]} onPress={() => setTab(item.key)}>
                <Text style={[styles.tabText, active && styles.tabTextActive]}>
                  {item.key === 'stats' && ratio.total ? `${item.label} ${ratio.ratio}` : item.label}
                </Text>
                {badge > 0 ? (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{badge}</Text>
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </View>

        {error || phone.error ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{error || phone.error}</Text>
          </View>
        ) : null}
        {warning ? <Text style={styles.warningText}>{warning}</Text> : null}

        {!storeKey ? (
          <Text style={styles.emptyText}>
            {canManage
              ? 'Connect Montreal (or another store) in Settings → RingCentral to make and receive calls.'
              : 'No connected store phone yet.'}
          </Text>
        ) : null}

        {tab === 'incoming' ? (
          <View style={styles.section}>
            {incomingLive.map((call) => (
              <View key={`${call.storeKey}-${call.id}`} style={styles.liveCard}>
                <View style={styles.itemText}>
                  <Text style={styles.liveKicker}>
                    {call.storeName || 'Ringing'}
                  </Text>
                  <Text style={styles.itemTitle} numberOfLines={1}>
                    {partyLine(call, true)}
                  </Text>
                </View>
                <View style={styles.liveActions}>
                  <Pressable style={[styles.callBtn, styles.rejectBtn]} onPress={() => phone.reject(call)} disabled={phone.busy}>
                    <Text style={styles.callBtnText}>Reject</Text>
                  </Pressable>
                  <Pressable style={[styles.callBtn, styles.answerBtn]} onPress={() => phone.answer(call)} disabled={phone.busy}>
                    <Text style={styles.callBtnText}>Answer</Text>
                  </Pressable>
                </View>
              </View>
            ))}
            {inboxLoading && inboundCalls.length === 0 ? (
              <View style={styles.centered}>
                <ActivityIndicator color={ACCENT} />
              </View>
            ) : inboundCalls.length === 0 && incomingLive.length === 0 ? (
              <Text style={styles.emptyText}>No incoming calls {rangeLabel}.</Text>
            ) : (
              inboundCalls.map((row) => <CallHistoryRow key={row.id} row={row} inbound />)
            )}
          </View>
        ) : null}

        {tab === 'missed' ? (
          <View style={styles.section}>
            {inboxLoading && missedCalls.length === 0 ? (
              <View style={styles.centered}>
                <ActivityIndicator color={ACCENT} />
              </View>
            ) : missedCalls.length === 0 ? (
              <Text style={styles.emptyText}>No missed calls {rangeLabel}.</Text>
            ) : (
              missedCalls.map((row) => (
                <CallHistoryRow
                  key={row.id}
                  row={row}
                  inbound
                  onCallback={callBack}
                  callbackBusy={phone.busy}
                />
              ))
            )}
          </View>
        ) : null}

        {tab === 'log' ? (
          <View style={styles.section}>
            {inboxLoading && callLog.length === 0 ? (
              <View style={styles.centered}>
                <ActivityIndicator color={ACCENT} />
              </View>
            ) : callLog.length === 0 ? (
              <Text style={styles.emptyText}>No calls {rangeLabel}.</Text>
            ) : (
              callLog.map((row) => (
                <CallHistoryRow
                  key={row.id}
                  row={row}
                  inbound={row.direction !== 'Outbound'}
                  showDirection
                />
              ))
            )}
          </View>
        ) : null}

        {tab === 'dial' ? (
          <View style={styles.section}>
            <TextInput
              style={styles.dialInput}
              value={digits}
              onChangeText={(value) => setDigits(value.replace(/[^\d*#+]/g, '').slice(0, 16))}
              placeholder="Enter number"
              placeholderTextColor="#8e8e93"
              keyboardType="phone-pad"
              textAlign="center"
            />
            <View style={styles.keypad}>
              {KEYPAD.map((key) => (
                <Pressable key={key} style={styles.key} onPress={() => appendDigit(key)}>
                  <Text style={styles.keyText}>{key}</Text>
                </Pressable>
              ))}
            </View>
            <View style={styles.dialActions}>
              <Pressable style={styles.backspace} onPress={() => setDigits((current) => current.slice(0, -1))} disabled={!digits}>
                <Ionicons name="backspace-outline" size={20} color={digits ? '#1a1a1a' : '#c4c4c4'} />
              </Pressable>
              <Pressable
                style={[styles.placeCall, (!digits || phone.busy) && styles.placeCallDisabled]}
                onPress={placeCall}
                disabled={!digits || phone.busy}
              >
                {phone.busy ? <ActivityIndicator color="#fff" /> : <Ionicons name="call" size={22} color="#fff" />}
              </Pressable>
            </View>
            <Text style={styles.sectionMeta}>
              This rings the store phone first, then connects the number you dialed.
            </Text>
            {outboundCalls.length === 0 ? (
              <Text style={styles.emptyText}>No outbound calls {rangeLabel}.</Text>
            ) : (
              outboundCalls.map((row) => (
                <Pressable
                  key={row.id}
                  style={styles.itemRow}
                  onPress={() => setDigits((row.to || '').replace(/\D/g, '').slice(-10))}
                >
                  <View style={styles.callIcon}>
                    <Ionicons name="arrow-up" size={14} color={ACCENT} />
                  </View>
                  <View style={styles.itemText}>
                    <Text style={styles.itemTitle}>{partyLine(row, false)}</Text>
                    <Text style={styles.itemMeta}>
                      {[resultLabel(row.result), formatCallWhen(row.startTime), row.duration ? formatDuration(row.duration) : '']
                        .filter(Boolean)
                        .join(' · ')}
                    </Text>
                  </View>
                </Pressable>
              ))
            )}
          </View>
        ) : null}

        {tab === 'voicemail' ? (
          <View style={styles.section}>
            {playError ? <Text style={styles.errorText}>{playError}</Text> : null}
            {inboxLoading && visibleVoicemails.length === 0 ? (
              <View style={styles.centered}>
                <ActivityIndicator color={ACCENT} />
              </View>
            ) : visibleVoicemails.length === 0 ? (
              <Text style={styles.emptyText}>No voicemail {rangeLabel}.</Text>
            ) : (
              visibleVoicemails.map((row) => {
                const unread = row.readStatus === 'Unread';
                return (
                  <View key={row.id} style={styles.itemRow}>
                    <Pressable style={styles.playBtn} onPress={() => playVoicemail(row)} accessibilityLabel={playingId === row.id ? 'Pause voicemail' : 'Play voicemail'}>
                      <Ionicons name={playingId === row.id ? 'pause' : 'play'} size={16} color={ACCENT} />
                    </Pressable>
                    <View style={styles.itemText}>
                      <Text style={[styles.itemTitle, unread && styles.unread]}>
                        {partyLine(row, true)}
                      </Text>
                      <Text style={styles.itemMeta}>
                        {[
                          unread ? 'Unread' : 'Heard',
                          formatCallWhen(row.creationTime),
                          row.duration ? formatDuration(row.duration) : '',
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </Text>
                    </View>
                  </View>
                );
              })
            )}
          </View>
        ) : null}

        {tab === 'stats' ? (
          <View style={styles.section}>
            {phone.stores.length > 1 ? (
              <View style={styles.storeRatioList}>
                {phone.stores.map((row) => {
                  const storeRatio = storeRatios[row.storeKey] || inboundCallRatio([]);
                  const selected = row.storeKey === storeKey;
                  return (
                    <Pressable
                      key={row.storeKey}
                      style={[styles.storeRatioRow, selected && styles.storeRatioRowActive]}
                      onPress={() => phone.setSelectedStoreKey(row.storeKey)}
                    >
                      <Text style={[styles.storeRatioName, selected && styles.chipTextActive]} numberOfLines={1}>
                        {row.storeName}
                      </Text>
                      <Text style={styles.storeRatioValue}>
                        {storeRatio.total ? `${storeRatio.answered} answered · ${storeRatio.missed} missed` : 'No inbound'}
                      </Text>
                      <Text style={styles.storeRatioChip}>{storeRatio.ratio}</Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}
            <RatioStrip stats={ratio} rangeLabel={rangeLabel} />
            <View style={styles.ratioStats}>
              <View style={styles.ratioStat}>
                <Text style={styles.summaryLabel}>Voicemail</Text>
                <Text style={styles.summaryValue}>{ratio.voicemail}</Text>
              </View>
              <View style={styles.ratioStat}>
                <Text style={styles.summaryLabel}>Rejected</Text>
                <Text style={styles.summaryValue}>{ratio.rejected}</Text>
              </View>
            </View>
            <Text style={styles.blockTitle}>Answered</Text>
            {answeredCalls.length === 0 ? (
              <Text style={styles.emptyText}>No answered inbound calls {rangeLabel}.</Text>
            ) : (
              answeredCalls.map((row) => (
                <View key={row.id} style={styles.itemRow}>
                  <View style={styles.callIcon}>
                    <Ionicons name="arrow-down" size={14} color={ACCENT} />
                  </View>
                  <View style={styles.itemText}>
                    <Text style={styles.itemTitle}>{partyLine(row, true)}</Text>
                    <Text style={styles.itemMeta}>
                      {[resultLabel(row.result), formatCallWhen(row.startTime), row.duration ? formatDuration(row.duration) : '']
                        .filter(Boolean)
                        .join(' · ')}
                    </Text>
                  </View>
                </View>
              ))
            )}
            <Text style={[styles.blockTitle, styles.blockTitleSpaced]}>Missed</Text>
            {missedCalls.length === 0 ? (
              <Text style={styles.emptyText}>No missed inbound calls {rangeLabel}.</Text>
            ) : (
              missedCalls.map((row) => (
                <View key={row.id} style={styles.itemRow}>
                  <View style={styles.callIcon}>
                    <Ionicons name="call-outline" size={14} color="#B91C1C" />
                  </View>
                  <View style={styles.itemText}>
                    <Text style={styles.itemTitle}>{partyLine(row, true)}</Text>
                    <Text style={styles.itemMeta}>
                      {[resultLabel(row.result), formatCallWhen(row.startTime), row.duration ? formatDuration(row.duration) : '']
                        .filter(Boolean)
                        .join(' · ')}
                    </Text>
                  </View>
                </View>
              ))
            )}
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#fff',
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 32,
    maxWidth: 720,
    width: '100%',
    alignSelf: 'center',
    gap: 10,
  },
  section: {
    gap: 4,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  headerCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  iconBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f3f3f3',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  iconBtnActive: {
    backgroundColor: '#FEE2E2',
  },
  storesLink: {
    paddingHorizontal: 6,
    paddingVertical: 6,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  sectionTitle: {
    fontFamily,
    fontSize: 16,
    fontWeight: '700',
    color: '#1a1a1a',
  },
  sectionMeta: {
    fontFamily,
    fontSize: 12,
    color: '#8a8a8a',
    lineHeight: 17,
  },
  silentHint: {
    fontFamily,
    fontSize: 12,
    color: '#8a8a8a',
  },
  storeChips: {
    gap: 8,
    paddingBottom: 2,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: '#f3f3f3',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  chipActive: {
    backgroundColor: '#ECFDF5',
  },
  chipText: {
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
    color: '#6b6b6b',
  },
  chipTextActive: {
    color: ACCENT,
  },
  chipRatio: {
    fontFamily,
    fontSize: 11,
    fontWeight: '700',
    color: '#8a8a8a',
  },
  chipRatioActive: {
    color: ACCENT,
  },
  storeRatioList: {
    gap: 6,
    marginBottom: 8,
  },
  storeRatioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: '#f7f7f7',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  storeRatioRowActive: {
    backgroundColor: '#ECFDF5',
  },
  storeRatioName: {
    flex: 1,
    minWidth: 0,
    fontFamily,
    fontSize: 13,
    fontWeight: '700',
    color: '#1a1a1a',
  },
  storeRatioValue: {
    fontFamily,
    fontSize: 11,
    fontWeight: '600',
    color: '#6b6b6b',
  },
  storeRatioChip: {
    fontFamily,
    fontSize: 13,
    fontWeight: '700',
    color: '#1a1a1a',
  },
  compactStatus: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  compactStatusText: {
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
    color: '#6b6b6b',
  },
  dateRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  dateChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: '#f3f3f3',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  dateChipActive: {
    backgroundColor: '#ECFDF5',
  },
  dateChipText: {
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
    color: '#6b6b6b',
  },
  dateChipTextActive: {
    color: ACCENT,
  },
  callbackBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 28,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: ACCENT,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  callbackBtnDisabled: {
    opacity: 0.6,
  },
  callbackText: {
    fontFamily,
    fontSize: 12,
    fontWeight: '700',
    color: '#fff',
  },
  tabs: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e5e5',
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  tabActive: {
    borderBottomColor: ACCENT,
  },
  tabText: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: '#8a8a8a',
  },
  tabTextActive: {
    color: '#1a1a1a',
  },
  badge: {
    minWidth: 16,
    height: 16,
    paddingHorizontal: 4,
    borderRadius: 8,
    backgroundColor: ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    fontFamily,
    fontSize: 10,
    fontWeight: '700',
    color: '#fff',
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  search: {
    flex: 1,
    minWidth: 160,
    maxWidth: 320,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e0e0e0',
    paddingBottom: 6,
  },
  searchInput: {
    flex: 1,
    fontFamily,
    fontSize: 14,
    color: '#1a1a1a',
    paddingVertical: 0,
    ...Platform.select({
      web: { outlineStyle: 'none' },
      default: {},
    }),
  },
  refresh: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorBanner: {
    marginBottom: 2,
  },
  errorText: {
    fontFamily,
    fontSize: 13,
    color: '#991B1B',
  },
  warningText: {
    fontFamily,
    fontSize: 12,
    color: '#9a6b2f',
  },
  storeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    minHeight: 56,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f0f0f0',
    gap: 10,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  storeIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#ECFDF5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  storeText: {
    flex: 1,
    minWidth: 0,
  },
  storeName: {
    fontFamily,
    fontSize: 14,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  rowStatus: {
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
  },
  cellSub: {
    fontFamily,
    fontSize: 11,
    color: '#8a8a8a',
    marginTop: 2,
  },
  cellError: {
    fontFamily,
    fontSize: 12,
    color: '#991B1B',
    marginTop: 8,
    lineHeight: 17,
  },
  statusConnected: {
    color: '#15803D',
    fontWeight: '600',
  },
  statusError: {
    color: '#B91C1C',
    fontWeight: '600',
  },
  statusMuted: {
    color: '#8a8a8a',
  },
  link: {
    color: ACCENT,
    fontWeight: '600',
    fontFamily,
    fontSize: 13,
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 24,
    gap: 8,
  },
  emptyText: {
    fontFamily,
    fontSize: 13,
    color: '#8a8a8a',
    paddingTop: 16,
    paddingBottom: 8,
  },
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginBottom: 4,
    alignSelf: 'flex-start',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  backText: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  statusCard: {
    marginTop: 4,
    marginBottom: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e5e5',
    borderRadius: 8,
    padding: 10,
    backgroundColor: '#fafafa',
    gap: 6,
  },
  statusValue: {
    fontFamily,
    fontSize: 14,
    fontWeight: '700',
    color: '#1a1a1a',
  },
  detailRow: {
    gap: 2,
  },
  detailLabel: {
    fontFamily,
    fontSize: 11,
    fontWeight: '600',
    color: '#8a8a8a',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  detailValue: {
    fontFamily,
    fontSize: 14,
    color: '#1a1a1a',
  },
  blockTitle: {
    fontFamily,
    fontSize: 13,
    fontWeight: '700',
    color: '#1a1a1a',
    marginBottom: 4,
  },
  blockTitleSpaced: {
    marginTop: 16,
  },
  ratioBlock: {
    gap: 8,
  },
  ratioBlockCompact: {
    gap: 6,
  },
  ratioStats: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  ratioStat: {
    flexGrow: 1,
    flexBasis: 72,
    minWidth: 70,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: '#F3FBF6',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#D5EBD9',
  },
  ratioStatCompact: {
    paddingVertical: 6,
    paddingHorizontal: 8,
    minWidth: 64,
  },
  summaryLabel: {
    fontFamily,
    fontSize: 11,
    fontWeight: '600',
    color: '#8a8a8a',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 4,
  },
  summaryValue: {
    fontFamily,
    fontSize: 16,
    fontWeight: '700',
    color: '#1a1a1a',
    fontVariant: ['tabular-nums'],
  },
  summaryValueCompact: {
    fontSize: 14,
  },
  ratioBarTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: '#ececec',
    overflow: 'hidden',
    flexDirection: 'row',
  },
  ratioBarTrackCompact: {
    height: 4,
  },
  ratioBarFill: {
    backgroundColor: ACCENT,
    minWidth: 0,
  },
  ratioBarMissed: {
    backgroundColor: '#B91C1C',
    minWidth: 0,
  },
  ratioBarEmpty: {
    flex: 1,
    backgroundColor: '#ececec',
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f0f0f0',
  },
  itemText: {
    flex: 1,
    minWidth: 0,
  },
  itemTitle: {
    fontFamily,
    fontSize: 14,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  unread: {
    fontWeight: '700',
  },
  itemMeta: {
    fontFamily,
    fontSize: 12,
    color: '#8a8a8a',
    marginTop: 2,
  },
  extBadge: {
    minWidth: 40,
    height: 24,
    paddingHorizontal: 8,
    borderRadius: 6,
    backgroundColor: '#ECFDF5',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  extBadgeText: {
    fontFamily,
    fontSize: 12,
    fontWeight: '700',
    color: ACCENT,
    fontVariant: ['tabular-nums'],
  },
  refreshLink: {
    marginTop: 16,
    alignSelf: 'flex-start',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  liveCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 8,
    backgroundColor: '#ECFDF5',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#BBF7D0',
    marginBottom: 4,
  },
  liveKicker: {
    fontFamily,
    fontSize: 9,
    fontWeight: '700',
    color: ACCENT,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  liveActions: {
    flexDirection: 'row',
    gap: 4,
  },
  callBtn: {
    minWidth: 56,
    height: 26,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  rejectBtn: {
    backgroundColor: '#B91C1C',
  },
  answerBtn: {
    backgroundColor: ACCENT,
  },
  callBtnText: {
    fontFamily,
    fontSize: 12,
    fontWeight: '700',
    color: '#fff',
  },
  callIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#F3FBF6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dialInput: {
    fontFamily,
    fontSize: 28,
    fontWeight: '700',
    color: '#1a1a1a',
    textAlign: 'center',
    paddingVertical: 8,
    letterSpacing: 1,
    ...Platform.select({
      web: { outlineStyle: 'none' },
      default: {},
    }),
  },
  keypad: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    maxWidth: 280,
    alignSelf: 'center',
    gap: 10,
  },
  key: {
    width: 72,
    height: 56,
    borderRadius: 12,
    backgroundColor: '#f6f6f6',
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  keyText: {
    fontFamily,
    fontSize: 22,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  dialActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 24,
    marginTop: 8,
  },
  backspace: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeCall: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  placeCallDisabled: {
    opacity: 0.45,
  },
  playBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#ECFDF5',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
});
