import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ensureLinkedPosSessions } from '../lib/auth';
import { rankCustomers, storeNamesFromRows } from '../lib/customerRank';
import { fetchTransferStores, uniquePreferredStores } from '../lib/locations';
import { CANVAS, useIsMobile } from '../lib/mobileUi';
import { mobileTabBarReserve, useMobileTabBarScrollProps } from '../lib/mobileTabBar';
import { useAppAccess } from '../lib/permissions';
import {
  fetchTransactionsAcrossPos,
  formatAmount,
  formatDateParam,
  formatTransactionDate,
  formatTransactionTime,
  parseDateParam,
  posSourcesFromSession,
} from '../lib/transactions';
import { customerContact, enrichClientActivity, loadCustomerProfile, searchClients } from '../lib/triageLookups';
import HomeDatePicker from './HomeDatePicker';
import { usePhoneCalls } from './PhoneCallProvider';
import {
  Chip,
  EmptyState,
  FONT,
  Group,
  GroupRow,
  MobileList,
  MobileListRow,
  SearchField,
  SectionLabel,
  StaffAvatar,
  Stat,
  StatStrip,
  StatusPill,
  T,
  TextTabs,
} from './TriageKit';

const ACCENT = '#0F766E';

const LIST_MODES = [
  { key: 'search', label: 'Search' },
  { key: 'count', label: 'By visits' },
  { key: 'volume', label: 'By volume' },
];

function currentMonthRange() {
  const now = parseDateParam(new Date());
  return {
    startDate: formatDateParam(new Date(now.getFullYear(), now.getMonth(), 1)),
    endDate: formatDateParam(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
  };
}

async function mapLimit(items, limit, mapper) {
  const out = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      out[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return out;
}

function lastVisitLine(row) {
  const lastAt = String(row?.lastAt || '').trim();
  const date = lastAt ? formatTransactionDate(lastAt) : '';
  const time = lastAt ? formatTransactionTime(lastAt) : '';
  const when = [date !== '—' ? date : '', time !== '—' ? time : ''].filter(Boolean).join(', ');
  const verb = row?.lastKind === 'bought' ? 'Last bought' : row?.lastKind === 'sold' ? 'Last sold' : 'Last visit';
  return when ? `${verb} ${when}` : '';
}

function countLabel(value, noun) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

function ticketSubtitle(row) {
  const when = [row.dateLabel, row.timeLabel !== '—' ? row.timeLabel : ''].filter(Boolean).join(' · ');
  return [row.storeName, row.employeeName, when].filter((part) => part && part !== '—').join(' · ');
}

function FieldGroup({ title, fields }) {
  const rows = (fields || []).filter((field) => field?.value);
  if (!rows.length) return null;
  return (
    <View style={styles.block}>
      {title ? <SectionLabel>{title}</SectionLabel> : null}
      <Group>
        {rows.map((field, index) => (
          <GroupRow
            key={field.label}
            label={field.label}
            value={field.value}
            last={index === rows.length - 1}
            onPress={field.onPress}
          />
        ))}
      </Group>
    </View>
  );
}

function CustomerRow({ row, last, selected, onPress, sort }) {
  const count = Number(row.txCount);
  const volumeLabel = Number.isFinite(Number(row.volume)) ? formatAmount(row.volume) : '';
  const meta = [
    row.storeName,
    lastVisitLine(row),
    sort === 'volume' && Number.isFinite(count) ? countLabel(count, 'transaction') : '',
    sort === 'count' && volumeLabel ? volumeLabel : '',
    !sort && Number.isFinite(count)
      ? countLabel(count, 'transaction')
      : !sort && !row.activityReady
        ? 'Looking up visits…'
        : '',
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <MobileListRow
      title={row.rank ? `${row.rank}. ${row.label}` : row.label}
      subtitle={row.sub}
      meta={meta}
      last={last}
      selected={selected}
      onPress={onPress}
      leading={<StaffAvatar name={row.label} size={36} />}
      trailing={
        sort === 'volume' && volumeLabel ? (
          <Text style={styles.rankMeta}>{volumeLabel}</Text>
        ) : sort === 'count' && Number.isFinite(count) ? (
          <Text style={styles.rankMeta}>{count}</Text>
        ) : null
      }
    />
  );
}

function StoreChips({ stores, value, onChange }) {
  return (
    <ScrollView
      horizontal
      nestedScrollEnabled
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.chipScrollRow}
    >
      <Chip label="All stores" selected={!value} onPress={() => onChange('')} />
      {stores.map((name) => (
        <Chip key={name} label={name} selected={value === name} onPress={() => onChange(name === value ? '' : name)} />
      ))}
    </ScrollView>
  );
}

function CustomerProfile({
  row,
  profile,
  loading,
  error,
  compact,
  onClose,
  onOpenDocument,
  canPhone,
  calling,
  onCall,
}) {
  const contact = customerContact(profile?.client || row?.client);
  const tickets = profile?.tickets || [];
  const [kind, setKind] = useState('all');
  const soldCount = profile?.soldCount;
  const boughtCount = profile?.boughtCount;
  const totalCount = profile?.txCount;
  const visible = tickets.filter((ticket) => {
    if (kind === 'so') return ticket.type !== 'purchase';
    if (kind === 'po') return ticket.type === 'purchase';
    return true;
  });

  return (
    <ScrollView
      style={styles.detailScroll}
      contentContainerStyle={[styles.detailContent, compact && styles.detailContentMobile]}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.hero}>
        {compact ? (
          <View style={styles.detailMobileHeader}>
            <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel="Back">
              <Ionicons name="chevron-back" size={22} color={T.text} />
            </Pressable>
            <Text style={styles.detailMobileTitle} numberOfLines={1}>
              Customer
            </Text>
            <View style={styles.headerSpacer} />
          </View>
        ) : null}
        <StaffAvatar name={row.label} size={88} />
        <Text style={styles.heroName}>{row.label}</Text>
        {contact.nickname && contact.nickname !== row.label ? (
          <Text style={styles.heroSub}>{contact.nickname}</Text>
        ) : null}
        <View style={styles.heroPills}>
          {contact.status ? <StatusPill label={contact.status} tone="green" /> : null}
          {row.systemLabel ? <StatusPill label={row.systemLabel} /> : null}
          {row.storeName ? <StatusPill label={row.storeName} /> : null}
        </View>
        {lastVisitLine(profile || row) ? (
          <Text style={styles.heroVisit}>{lastVisitLine(profile || row)}</Text>
        ) : null}
        {canPhone && (contact.phone || contact.alternatePhone) ? (
          <Pressable
            onPress={onCall}
            disabled={calling}
            style={styles.callButton}
            accessibilityRole="button"
            accessibilityLabel={`Call ${row.label}`}
          >
            {calling ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <Ionicons name="call" size={16} color="#fff" />
                <Text style={styles.callButtonText}>Call</Text>
              </>
            )}
          </Pressable>
        ) : null}
      </View>

      <View style={styles.block}>
        <StatStrip>
          <Stat label="Sales" value={soldCount == null && loading ? '…' : String(soldCount ?? 0)} sub="SO" />
          <Stat label="Purchases" value={boughtCount == null && loading ? '…' : String(boughtCount ?? 0)} sub="PO" />
          <Stat
            label="Transactions"
            value={totalCount == null && loading ? '…' : String(totalCount ?? 0)}
            sub="Lifetime"
          />
        </StatStrip>
      </View>

      {loading ? (
        <View style={styles.inlineStatus}>
          <ActivityIndicator size="small" color={T.secondary} />
          <Text style={styles.inlineStatusText}>Loading profile…</Text>
        </View>
      ) : null}
      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <FieldGroup
        title="Contact"
        fields={[
          { label: 'Email', value: contact.email },
          {
            label: 'Phone',
            value: contact.phone,
            onPress: contact.phone && canPhone ? onCall : undefined,
          },
          { label: 'Alt phone', value: contact.alternatePhone },
          { label: 'Address', value: contact.address },
          { label: 'Type', value: contact.type },
        ]}
      />

      {contact.identifications.length ? (
        <FieldGroup
          title="Identification"
          fields={contact.identifications.map((value, index) => ({
            label: contact.identifications.length === 1 ? 'ID' : `ID ${index + 1}`,
            value,
          }))}
        />
      ) : null}

      {contact.notes ? (
        <FieldGroup title="Notes" fields={[{ label: 'Notes', value: contact.notes }]} />
      ) : null}

      <View style={styles.block}>
        <SectionLabel>POS / SOs</SectionLabel>
        <View style={styles.chipRow}>
          <Chip label="All" count={tickets.length || undefined} selected={kind === 'all'} onPress={() => setKind('all')} />
          <Chip
            label="SO"
            count={soldCount || undefined}
            selected={kind === 'so'}
            onPress={() => setKind('so')}
          />
          <Chip
            label="PO"
            count={boughtCount || undefined}
            selected={kind === 'po'}
            onPress={() => setKind('po')}
          />
        </View>
        {visible.length ? (
          <MobileList>
            {visible.map((ticket, index) => (
              <MobileListRow
                key={ticket.id}
                title={ticket.reference}
                subtitle={ticketSubtitle(ticket)}
                meta={ticket.itemNames?.slice(0, 2).join(' · ')}
                trailing={
                  <Text style={styles.ticketAmount} numberOfLines={1}>
                    {ticket.amountLabel}
                  </Text>
                }
                last={index === visible.length - 1}
                onPress={() => onOpenDocument?.(ticket)}
                leading={
                  <View style={[styles.ticketIcon, ticket.type === 'purchase' && styles.ticketIconBuy]}>
                    <Ionicons
                      name={ticket.type === 'purchase' ? 'arrow-down' : 'arrow-up'}
                      size={14}
                      color={ticket.type === 'purchase' ? '#C2410C' : ACCENT}
                    />
                  </View>
                }
              />
            ))}
          </MobileList>
        ) : loading ? null : (
          <EmptyState
            icon="receipt-outline"
            title={kind === 'all' ? 'No tickets yet' : `No ${kind.toUpperCase()}s`}
            body="Nothing on file for this customer in the selected POS."
          />
        )}
      </View>
    </ScrollView>
  );
}

export default function CustomersScreen({ session, focusCustomer, onFocusConsumed, onOpenDocument }) {
  const isMobile = useIsMobile();
  const tabBarScroll = useMobileTabBarScrollProps();
  const { hasApp, canFilter } = useAppAccess();
  const phone = usePhoneCalls();
  const canPhone = hasApp('phone');
  const allowFilters = canFilter('customers');
  const assignedStore = String(session?.profile?.locationName || '').trim();
  const initialMonth = useMemo(() => currentMonthRange(), []);
  const [mode, setMode] = useState('search');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const [profile, setProfile] = useState(null);
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [calling, setCalling] = useState(false);
  const [storeName, setStoreName] = useState(() =>
    allowFilters ? '' : assignedStore,
  );
  const [startDate, setStartDate] = useState(initialMonth.startDate);
  const [endDate, setEndDate] = useState(initialMonth.endDate);
  const [dateMode, setDateMode] = useState('range');
  const [txRows, setTxRows] = useState([]);
  const [txBusy, setTxBusy] = useState(false);
  const [txError, setTxError] = useState('');
  const [storeOptions, setStoreOptions] = useState([]);
  const rankedCache = useRef(new Map());
  const trimmed = query.trim();
  const ranking = mode === 'count' || mode === 'volume';
  const activeStore = allowFilters ? storeName : assignedStore;

  useEffect(() => {
    if (!focusCustomer) return;
    setSelected(focusCustomer);
    if (focusCustomer.label) {
      setMode('search');
      setQuery(focusCustomer.label);
    }
    onFocusConsumed?.();
  }, [focusCustomer, onFocusConsumed]);

  useEffect(() => {
    if (!allowFilters && assignedStore) setStoreName(assignedStore);
  }, [allowFilters, assignedStore]);

  useEffect(() => {
    let cancelled = false;
    fetchTransferStores(session)
      .then((result) => {
        if (cancelled) return;
        const names = uniquePreferredStores(result.stores || [])
          .map((store) => store.name)
          .filter(Boolean);
        setStoreOptions(names);
      })
      .catch(() => {
        if (!cancelled) setStoreOptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [session]);

  useEffect(() => {
    if (!ranking) return undefined;
    const key = `${startDate}|${endDate}`;
    const cached = rankedCache.current.get(key);
    if (cached) {
      setTxRows(cached);
      setTxError('');
      setTxBusy(false);
      return undefined;
    }

    let cancelled = false;
    setTxBusy(true);
    setTxError('');
    (async () => {
      const authed = await ensureLinkedPosSessions(session);
      const sources = posSourcesFromSession(authed);
      const result = await fetchTransactionsAcrossPos(authed, { startDate, endDate });
      const sourceByKey = new Map(sources.map((source) => [source.key, source]));
      const rows = (result.rows || []).map((row) => {
        const source = sourceByKey.get(row.systemKey);
        return {
          ...row,
          token: source?.token || row.token || '',
          baseUrl: row.baseUrl || source?.baseUrl || '',
        };
      });
      if (cancelled) return;
      rankedCache.current.set(key, rows);
      setTxRows(rows);
    })()
      .catch((err) => {
        if (!cancelled) {
          setTxRows([]);
          setTxError(err?.message || 'Could not load top customers.');
        }
      })
      .finally(() => {
        if (!cancelled) setTxBusy(false);
      });

    return () => {
      cancelled = true;
    };
  }, [ranking, session, startDate, endDate]);

  useEffect(() => {
    if (trimmed.length < 2) {
      setResults([]);
      setError('');
      setBusy(false);
      return undefined;
    }

    let cancelled = false;
    const timer = setTimeout(() => {
      setBusy(true);
      setError('');
      (async () => {
        const authed = await ensureLinkedPosSessions(session);
        const sources = posSourcesFromSession(authed);
        const batches = await Promise.all(
          sources.map(async (source) => {
            try {
              return await searchClients(source.token, trimmed, source.baseUrl, source);
            } catch {
              return [];
            }
          }),
        );
        const seen = new Set();
        const rows = [];
        for (const batch of batches) {
          for (const row of batch) {
            const key = `${row.systemKey || ''}:${row.id}`;
            if (seen.has(key)) continue;
            seen.add(key);
            rows.push(row);
          }
        }
        if (cancelled) return;
        const next = rows.slice(0, 40);
        setResults(next);
        const enriched = await mapLimit(next, 4, (row) =>
          enrichClientActivity(row, row.token, row.baseUrl).catch(() => ({
            ...row,
            activityReady: true,
          })),
        );
        if (!cancelled) setResults(enriched);
      })()
        .catch((err) => {
          if (!cancelled) setError(err?.message || 'Could not search customers.');
        })
        .finally(() => {
          if (!cancelled) setBusy(false);
        });
    }, 280);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [session, trimmed]);

  useEffect(() => {
    if (!selected) {
      setProfile(null);
      setProfileError('');
      setProfileBusy(false);
      return undefined;
    }

    let cancelled = false;
    setProfileBusy(true);
    setProfileError('');
    setProfile(null);
    loadCustomerProfile(selected, selected.token, selected.baseUrl)
      .then((next) => {
        if (!cancelled) setProfile(next);
      })
      .catch((err) => {
        if (!cancelled) setProfileError(err?.message || 'Could not load this customer.');
      })
      .finally(() => {
        if (!cancelled) setProfileBusy(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selected]);

  const openCustomer = useCallback(
    async (row) => {
      if (row?.id) {
        setSelected(row);
        return;
      }
      const name = String(row?.label || '').trim();
      if (!name) return;
      setSelected(row);
      try {
        const authed = await ensureLinkedPosSessions(session);
        const sources = posSourcesFromSession(authed).filter(
          (source) => !row.systemKey || source.key === row.systemKey,
        );
        const batches = await Promise.all(
          sources.map(async (source) => {
            try {
              return await searchClients(source.token, name, source.baseUrl, source);
            } catch {
              return [];
            }
          }),
        );
        const hit = batches.flat().find((item) => {
          const label = String(item.label || '').trim();
          return label.localeCompare(name, undefined, { sensitivity: 'base' }) === 0;
        });
        if (hit) setSelected({ ...row, ...hit, txCount: row.txCount, volume: row.volume });
      } catch {
        // Keep the ranked row even if POS search fails.
      }
    },
    [session],
  );

  const callCustomer = useCallback(async () => {
    const contact = customerContact(profile?.client || selected?.client);
    const number = contact.phone || contact.alternatePhone;
    if (!number || !canPhone) return;
    setCalling(true);
    try {
      const digits = String(number).replace(/[^\d+]/g, '');
      if (digits && (await Linking.canOpenURL(`tel:${digits}`)) && Platform.OS !== 'web') {
        await Linking.openURL(`tel:${digits}`);
        return;
      }
      await phone.ringOut(number);
    } catch {
      // Phone app surfaces its own error.
    } finally {
      setCalling(false);
    }
  }, [canPhone, phone, profile, selected]);

  const ranked = useMemo(() => {
    if (!ranking) return [];
    return rankCustomers(txRows, {
      storeName: activeStore,
      sort: mode === 'volume' ? 'volume' : 'count',
      limit: 50,
    });
  }, [ranking, txRows, activeStore, mode]);

  const visibleStores = useMemo(() => {
    const fromTx = storeNamesFromRows(txRows);
    const seen = new Set(storeOptions.map((name) => name.toLowerCase()));
    const extra = fromTx.filter((name) => !seen.has(name.toLowerCase()));
    return [...storeOptions, ...extra];
  }, [storeOptions, txRows]);

  const list = ranking ? ranked : results;
  const listBusy = ranking ? txBusy : busy;
  const listError = ranking ? txError : error;
  const showHint = !ranking && !trimmed;
  const showEmpty = ranking
    ? !txBusy && !ranked.length && !txError
    : trimmed.length >= 2 && !busy && !list.length && !error;

  const profileView = selected ? (
    <CustomerProfile
      key={`${selected.systemKey || ''}:${selected.id}`}
      row={profile || selected}
      profile={profile}
      loading={profileBusy}
      error={profileError}
      compact={isMobile}
      onClose={() => setSelected(null)}
      onOpenDocument={onOpenDocument}
      canPhone={canPhone}
      calling={calling}
      onCall={() => void callCustomer()}
    />
  ) : (
    <View style={styles.detailEmpty}>
      <EmptyState
        icon="person-circle-outline"
        title="Select a customer"
        body="Search by name or open a top customer by visits or volume."
      />
    </View>
  );

  return (
    <View style={styles.screen}>
      <View style={[styles.pane, isMobile && styles.paneMobile, isMobile && selected && styles.paneHidden]}>
        <View style={[styles.searchWrap, isMobile && styles.searchWrapMobile]}>
          <TextTabs
            options={LIST_MODES}
            value={mode}
            onChange={setMode}
            size="lg"
            layout={isMobile ? 'bar' : 'inline'}
          />
          {ranking ? (
            <HomeDatePicker
              startDate={startDate}
              endDate={endDate}
              dateMode={dateMode}
              onChange={({ mode: nextMode, start, end }) => {
                setDateMode(nextMode === 'day' ? 'day' : 'range');
                setStartDate(formatDateParam(start));
                setEndDate(formatDateParam(end || start));
              }}
              maximumDate={new Date()}
              compact={!isMobile}
              fill={isMobile}
            />
          ) : (
            <SearchField
              value={query}
              onChangeText={setQuery}
              placeholder="Search customers"
              autoFocus={!isMobile}
              size="lg"
            />
          )}
          {ranking && allowFilters ? (
            <StoreChips stores={visibleStores} value={activeStore} onChange={setStoreName} />
          ) : ranking && activeStore ? (
            <Text style={styles.filterHint}>{activeStore}</Text>
          ) : null}
        </View>
        <ScrollView
          style={styles.listScroll}
          contentContainerStyle={[
            styles.listContent,
            isMobile && { paddingBottom: mobileTabBarReserve() + 24 },
          ]}
          keyboardShouldPersistTaps="handled"
          {...(isMobile ? tabBarScroll : null)}
        >
          {showHint ? (
            <EmptyState
              icon="search-outline"
              title="Find a customer"
              body="Type a name, email, or phone, or switch to visits or volume to see the top customers."
            />
          ) : null}
          {listBusy ? (
            <View style={styles.inlineStatus}>
              <ActivityIndicator size="small" color={T.secondary} />
              <Text style={styles.inlineStatusText}>
                {ranking ? 'Loading top customers…' : 'Searching customers…'}
              </Text>
            </View>
          ) : null}
          {listError ? <Text style={styles.errorText}>{listError}</Text> : null}
          {showEmpty ? (
            <EmptyState
              icon="person-outline"
              title={ranking ? 'No customers in this period' : 'No matches'}
              body={
                ranking
                  ? `No named customers ${activeStore ? `at ${activeStore} ` : ''}in the selected dates.`
                  : `Nothing found for “${trimmed}”.`
              }
            />
          ) : null}
          {list.length ? (
            <MobileList>
              {list.map((row, index) => (
                <CustomerRow
                  key={`${row.systemKey || ''}:${row.id || row.label}:${row.rank || index}`}
                  row={row}
                  last={index === list.length - 1}
                  selected={
                    !isMobile &&
                    selected &&
                    String(selected.id || selected.label) === String(row.id || row.label) &&
                    selected.systemKey === row.systemKey
                  }
                  sort={ranking ? mode : ''}
                  onPress={() => void openCustomer(row)}
                />
              ))}
            </MobileList>
          ) : null}
        </ScrollView>
      </View>

      {!isMobile ? <View style={styles.detailPane}>{profileView}</View> : null}

      {isMobile ? (
        <Modal visible={Boolean(selected)} animationType="slide" onRequestClose={() => setSelected(null)}>
          <View
            style={styles.mobileDetail}
            {...(Platform.OS === 'web' ? { className: 'cgold-mobile-sheet-top' } : null)}
          >
            {profileView}
          </View>
        </Modal>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    minHeight: 0,
    flexDirection: 'row',
    backgroundColor: CANVAS,
  },
  pane: {
    flex: 1,
    minWidth: 280,
    maxWidth: 480,
    minHeight: 0,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: T.hairline,
  },
  paneMobile: {
    maxWidth: '100%',
    borderRightWidth: 0,
  },
  paneHidden: {
    display: 'none',
  },
  searchWrap: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 12,
    gap: 12,
  },
  searchWrapMobile: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  chipScrollRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingRight: 16,
  },
  filterHint: {
    fontFamily: FONT,
    fontSize: 13,
    color: T.secondary,
  },
  rankMeta: {
    fontFamily: FONT,
    fontSize: 14,
    fontWeight: '600',
    color: T.text,
  },
  listScroll: {
    flex: 1,
    minHeight: 0,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 32,
    gap: 12,
  },
  detailPane: {
    flex: 1.2,
    minWidth: 320,
    minHeight: 0,
  },
  detailScroll: {
    flex: 1,
    minHeight: 0,
    ...Platform.select({
      web: { overflowY: 'auto' },
    }),
  },
  detailContent: {
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 40,
  },
  detailContentMobile: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: mobileTabBarReserve() + 24,
  },
  mobileDetail: {
    flex: 1,
    backgroundColor: CANVAS,
  },
  detailEmpty: {
    flex: 1,
    justifyContent: 'center',
  },
  detailMobileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
    marginBottom: 8,
  },
  detailMobileTitle: {
    flex: 1,
    fontFamily: FONT,
    fontSize: 17,
    fontWeight: '600',
    color: T.text,
    textAlign: 'center',
  },
  headerSpacer: {
    width: 22,
  },
  hero: {
    alignItems: 'center',
    paddingVertical: 12,
    gap: 8,
  },
  heroName: {
    fontFamily: FONT,
    fontSize: 26,
    fontWeight: '600',
    color: T.text,
    textAlign: 'center',
  },
  heroSub: {
    fontFamily: FONT,
    fontSize: 15,
    color: T.secondary,
  },
  heroPills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 6,
  },
  heroVisit: {
    fontFamily: FONT,
    fontSize: 13,
    color: T.secondary,
    textAlign: 'center',
  },
  callButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: ACCENT,
  },
  callButtonText: {
    fontFamily: FONT,
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },
  block: {
    marginTop: 16,
    gap: 8,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  ticketIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(15,118,110,0.12)',
  },
  ticketIconBuy: {
    backgroundColor: 'rgba(194,65,12,0.10)',
  },
  ticketAmount: {
    fontFamily: FONT,
    fontSize: 14,
    fontWeight: '600',
    color: T.text,
  },
  inlineStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
  },
  inlineStatusText: {
    fontFamily: FONT,
    fontSize: 14,
    color: T.secondary,
  },
  errorText: {
    fontFamily: FONT,
    fontSize: 14,
    color: T.red,
  },
});
