import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ensureLinkedPosSessions, posEmployeeId } from '../lib/auth';
import { fetchAureusEmployee } from '../lib/aureusEmployees';
import { documentQueryCandidates, lookupDocuments } from '../lib/docSearch';
import { mobileTabBarReserve, useMobileTabBarScrollProps } from '../lib/mobileTabBar';
import { CANVAS, useIsMobile } from '../lib/mobileUi';
import { listStaffProfiles, staffDisplayName, useAppAccess } from '../lib/permissions';
import {
  formatTransactionDate,
  formatTransactionTime,
  posSourcesFromSession,
} from '../lib/transactions';
import { enrichClientActivity, searchClients } from '../lib/triageLookups';
import { FONT } from '../lib/typography';
import { usePhoneCalls } from './PhoneCallProvider';

function initialsFromName(name) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return '';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] || ''}${parts[parts.length - 1][0] || ''}`.toUpperCase();
}

function Face({ uri, name, size = 40 }) {
  const [failed, setFailed] = useState(false);
  const initials = initialsFromName(name);
  useEffect(() => {
    setFailed(false);
  }, [uri]);

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#e8e8ed',
        overflow: 'hidden',
      }}
    >
      {uri && !failed ? (
        <Image
          source={{ uri }}
          style={{ width: size, height: size, borderRadius: size / 2 }}
          onError={() => setFailed(true)}
        />
      ) : initials ? (
        <Text
          style={{
            fontFamily: FONT,
            fontSize: Math.max(11, Math.round(size * 0.36)),
            fontWeight: '600',
            color: '#1d1d1f',
          }}
        >
          {initials}
        </Text>
      ) : (
        <Ionicons name="person" size={Math.round(size * 0.48)} color="#8e8e93" />
      )}
    </View>
  );
}

function personHaystack(person) {
  return [
    staffDisplayName(person),
    person?.email,
    person?.aureusLogin,
    person?.locationName,
    person?.employeeType,
    person?.posRole,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function filterStaff(staff, query) {
  const q = String(query || '')
    .trim()
    .toLowerCase();
  if (!q) return [];
  const tokens = q.split(/\s+/).filter(Boolean);
  return (staff || []).filter((person) => {
    const hay = personHaystack(person);
    return tokens.every((token) => hay.includes(token));
  });
}

function ticketKind(row) {
  return row?.type === 'purchase' ? 'PO' : 'SO';
}

function customerLines(row) {
  const store = String(row?.storeName || '').trim();
  const lastAt = String(row?.lastAt || '').trim();
  const date = lastAt ? formatTransactionDate(lastAt) : '';
  const time = lastAt ? formatTransactionTime(lastAt) : '';
  const when = [date !== '—' ? date : '', time !== '—' ? time : ''].filter(Boolean).join(', ');
  const verb = row?.lastKind === 'bought' ? 'Last bought' : row?.lastKind === 'sold' ? 'Last sold' : 'Last transaction';
  const lastLine = when ? `${verb} ${when}` : '';
  const count = Number(row?.txCount);
  const txLine = Number.isFinite(count)
    ? `${count} transaction${count === 1 ? '' : 's'}`
    : row?.activityReady
      ? ''
      : 'Looking up visits…';
  return [store, lastLine, txLine].filter(Boolean);
}

function ResultRow({ icon, leading, title, subtitle, lines, meta, onPress }) {
  const extras = (lines || []).filter(Boolean);
  if (!extras.length && subtitle) extras.push(subtitle);
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed, hovered }) => [
        styles.row,
        extras.length > 1 && styles.rowTall,
        (pressed || hovered) && styles.rowHover,
        !onPress && styles.rowStatic,
      ]}
      accessibilityRole={onPress ? 'button' : 'text'}
    >
      {leading || (
        <View style={styles.rowIcon}>
          <Ionicons name={icon} size={18} color="#1d1d1f" />
        </View>
      )}
      <View style={styles.rowCopy}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {title}
        </Text>
        {extras.map((line) => (
          <Text key={line} style={styles.rowSub} numberOfLines={1}>
            {line}
          </Text>
        ))}
      </View>
      {meta ? (
        <Text style={styles.rowMeta} numberOfLines={1}>
          {meta}
        </Text>
      ) : null}
    </Pressable>
  );
}

function ActionBubble({ icon, label, onPress, disabled, busy }) {
  return (
    <Pressable
      onPress={(event) => {
        event?.stopPropagation?.();
        onPress?.();
      }}
      disabled={disabled || busy}
      hitSlop={6}
      style={({ pressed, hovered }) => [
        styles.actionBubble,
        (pressed || hovered) && !disabled && styles.actionBubbleHover,
        (disabled || busy) && styles.actionBubbleDisabled,
      ]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {busy ? (
        <ActivityIndicator size="small" color="#1d1d1f" />
      ) : (
        <Ionicons name={icon} size={16} color={disabled ? '#c7c7cc' : '#1d1d1f'} />
      )}
    </Pressable>
  );
}

function EmployeeCard({ person, isSelf, canPhone, canMessage, calling, onOpen, onCall, onVideo, onMessage }) {
  const name = staffDisplayName(person) || person.email || 'Staff';
  return (
    <Pressable
      onPress={onOpen}
      style={({ pressed, hovered }) => [styles.employeeCard, (pressed || hovered) && styles.employeeCardHover]}
      accessibilityRole="button"
      accessibilityLabel={name}
    >
      <Face uri={person.avatarUrl} name={name} size={88} />
      <Text style={styles.employeeName} numberOfLines={2}>
        {name}
      </Text>
      {person.locationName ? (
        <Text style={styles.employeeMeta} numberOfLines={1}>
          {person.locationName}
        </Text>
      ) : null}
      <View style={styles.cardActions}>
        <ActionBubble
          icon="call"
          label={`Call ${name}`}
          onPress={onCall}
          disabled={!canPhone}
          busy={calling === 'call'}
        />
        <ActionBubble
          icon="videocam"
          label={`Video call ${name}`}
          onPress={onVideo}
          disabled={!canPhone}
          busy={calling === 'video'}
        />
        <ActionBubble
          icon="chatbubble"
          label={`Message ${name}`}
          onPress={onMessage}
          disabled={!canMessage || isSelf}
        />
      </View>
    </Pressable>
  );
}

function Section({ title, children, plain }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>{title}</Text>
      {plain ? children : <View style={styles.sectionCard}>{children}</View>}
    </View>
  );
}

async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Math.min(Math.max(1, limit), Math.max(items.length, 1));
  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results;
}

const staffPhoneCache = new Map();

async function staffPhoneNumber(session, person) {
  const cacheKey = String(person?.id || person?.aureusUserId || '');
  if (cacheKey && staffPhoneCache.has(cacheKey)) return staffPhoneCache.get(cacheKey);
  const employeeId = posEmployeeId(person?.aureusUserId);
  if (!session?.token || !employeeId) return '';
  const { mapped } = await fetchAureusEmployee(session.token, employeeId, session.baseUrl);
  const number = mapped?.phone || '';
  if (cacheKey) staffPhoneCache.set(cacheKey, number);
  return number;
}

export default function SearchScreen({ session, onOpenPerson, onOpenDocument, onOpenCustomer, onMessage }) {
  const isMobile = useIsMobile();
  const tabBarScroll = useMobileTabBarScrollProps();
  const { hasApp } = useAppAccess();
  const phone = usePhoneCalls();
  const inputRef = useRef(null);
  const searchGen = useRef(0);
  const myId = session?.supabaseUserId || session?.profile?.id || '';
  const canPhone = hasApp('phone');
  const canMessage = hasApp('messages');
  const [query, setQuery] = useState('');
  const [staff, setStaff] = useState([]);
  const [staffError, setStaffError] = useState('');
  const [tickets, setTickets] = useState([]);
  const [ticketError, setTicketError] = useState('');
  const [ticketBusy, setTicketBusy] = useState(false);
  const [customers, setCustomers] = useState([]);
  const [customerError, setCustomerError] = useState('');
  const [customerBusy, setCustomerBusy] = useState(false);
  const [callingId, setCallingId] = useState('');
  const [callingKind, setCallingKind] = useState('');
  const [actionError, setActionError] = useState('');

  useEffect(() => {
    if (Platform.OS === 'web') {
      const timer = setTimeout(() => inputRef.current?.focus?.(), 80);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, []);

  useEffect(() => {
    let cancelled = false;
    listStaffProfiles()
      .then((rows) => {
        if (!cancelled) setStaff(rows || []);
      })
      .catch((err) => {
        if (!cancelled) setStaffError(err?.message || 'Could not load people.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const people = useMemo(() => filterStaff(staff, query).slice(0, 25), [staff, query]);
  const trimmed = query.trim();
  const canLookupTickets = documentQueryCandidates(trimmed).length > 0;
  const canLookupCustomers = trimmed.length >= 2 && !documentQueryCandidates(trimmed).length;

  useEffect(() => {
    if (!canLookupTickets) {
      setTickets([]);
      setTicketError('');
      setTicketBusy(false);
      return undefined;
    }

    const gen = (searchGen.current += 1);
    const timer = setTimeout(() => {
      setTicketBusy(true);
      setTicketError('');
      lookupDocuments(session, trimmed, {
        onHit: (_row, next) => {
          if (gen === searchGen.current) setTickets(next);
        },
      })
        .then((rows) => {
          if (gen !== searchGen.current) return;
          setTickets(rows);
          if (!rows.length) setTicketError('No matching PO or SO.');
        })
        .catch((err) => {
          if (gen !== searchGen.current) return;
          setTickets([]);
          setTicketError(err?.message || 'Could not search tickets.');
        })
        .finally(() => {
          if (gen === searchGen.current) setTicketBusy(false);
        });
    }, 280);

    return () => {
      clearTimeout(timer);
      searchGen.current += 1;
    };
  }, [canLookupTickets, session, trimmed]);

  useEffect(() => {
    if (!canLookupCustomers) {
      setCustomers([]);
      setCustomerError('');
      setCustomerBusy(false);
      return undefined;
    }

    let cancelled = false;
    const timer = setTimeout(() => {
      setCustomerBusy(true);
      setCustomerError('');
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
        const next = rows.slice(0, 20);
        setCustomers(next);
        setCustomerBusy(false);
        const enriched = await mapLimit(next, 4, (row) =>
          enrichClientActivity(row, row.token || session?.token, row.baseUrl || session?.baseUrl).catch(() => ({
            ...row,
            activityReady: true,
          })),
        );
        if (!cancelled) setCustomers(enriched);
      })()
        .catch((err) => {
          if (!cancelled) setCustomerError(err?.message || 'Could not search customers.');
        })
        .finally(() => {
          if (!cancelled) setCustomerBusy(false);
        });
    }, 280);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [canLookupCustomers, session, trimmed]);

  const showEmptyHint = !trimmed;
  const showNoMatches =
    trimmed &&
    !ticketBusy &&
    !customerBusy &&
    !tickets.length &&
    !people.length &&
    !customers.length &&
    !ticketError &&
    !staffError &&
    !customerError;

  const onChangeQuery = useCallback((next) => {
    setQuery(next);
    setActionError('');
  }, []);

  const callStaff = useCallback(
    async (person, kind) => {
      if (!canPhone) {
        setActionError('You don’t have access to Phone.');
        return;
      }
      setActionError('');
      setCallingId(person.id);
      setCallingKind(kind);
      try {
        const number = await staffPhoneNumber(session, person);
        if (!number) {
          setActionError('No phone number on file.');
          return;
        }
        if (kind === 'video') {
          const digits = String(number).replace(/[^\d+]/g, '');
          const facetime = digits ? `facetime:${digits}` : '';
          if (facetime && (await Linking.canOpenURL(facetime))) {
            await Linking.openURL(facetime);
            return;
          }
        }
        await phone.ringOut(number);
      } catch (err) {
        setActionError(err?.message || 'Could not start the call.');
      } finally {
        setCallingId('');
        setCallingKind('');
      }
    },
    [canPhone, phone, session],
  );

  return (
    <View style={styles.root}>
      <View style={[styles.chrome, isMobile && styles.chromeMobile]}>
        <View style={[styles.searchField, isMobile && styles.searchFieldMobile]}>
          <Ionicons name="search" size={16} color="#8e8e93" />
          <TextInput
            ref={inputRef}
            style={styles.searchInput}
            value={query}
            onChangeText={onChangeQuery}
            placeholder="Search PO, SO, or people"
            placeholderTextColor="#8e8e93"
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus={!isMobile}
            clearButtonMode="while-editing"
            returnKeyType="search"
          />
          {query ? (
            <Pressable onPress={() => setQuery('')} hitSlop={8} accessibilityLabel="Clear search">
              <Ionicons name="close-circle" size={18} color="#c7c7cc" />
            </Pressable>
          ) : null}
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          isMobile && styles.scrollContentMobile,
          isMobile && { paddingBottom: mobileTabBarReserve() + 24 },
        ]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        {...(isMobile ? tabBarScroll : null)}
      >
        {showEmptyHint ? (
          <View style={styles.empty}>
            <Ionicons name="search-outline" size={36} color="#c7c7cc" />
            <Text style={styles.emptyTitle}>Search tickets and people</Text>
            <Text style={styles.emptyHint}>
              Type a PO or SO number, or a name, email, or store.
            </Text>
          </View>
        ) : null}

        {ticketBusy || tickets.length || ticketError ? (
          <Section title="PO / SO">
            {tickets.map((row) => (
              <ResultRow
                key={row.id}
                icon={row.type === 'purchase' ? 'arrow-down-circle-outline' : 'arrow-up-circle-outline'}
                title={row.reference || `${ticketKind(row)}# ${row.sourceId}`}
                subtitle={[row.customerName, row.storeName, row.employeeName].filter(Boolean).join(' · ')}
                meta={row.amountLabel || ''}
                onPress={() => onOpenDocument?.(row)}
              />
            ))}
            {ticketBusy ? (
              <View style={styles.inlineStatus}>
                <ActivityIndicator size="small" color="#8e8e93" />
                <Text style={styles.inlineStatusText}>Looking up tickets…</Text>
              </View>
            ) : null}
            {ticketError && !tickets.length ? <Text style={styles.errorText}>{ticketError}</Text> : null}
          </Section>
        ) : null}

        {people.length || staffError ? (
          <Section title="Employees" plain>
            <View style={styles.employeeGrid}>
              {people.map((person) => (
                <EmployeeCard
                  key={person.id}
                  person={person}
                  isSelf={Boolean(myId && person.id === myId)}
                  canPhone={canPhone}
                  canMessage={canMessage}
                  calling={callingId === person.id ? callingKind : ''}
                  onOpen={() => onOpenPerson?.(person)}
                  onCall={() => void callStaff(person, 'call')}
                  onVideo={() => void callStaff(person, 'video')}
                  onMessage={() => onMessage?.(person.id)}
                />
              ))}
            </View>
            {staffError ? <Text style={styles.errorText}>{staffError}</Text> : null}
            {actionError && people.length ? <Text style={styles.errorText}>{actionError}</Text> : null}
          </Section>
        ) : null}

        {customerBusy || customers.length || customerError ? (
          <Section title="Customers">
            {customers.map((row) => (
              <ResultRow
                key={`${row.systemKey || ''}:${row.id}`}
                icon="person-circle-outline"
                title={row.label}
                lines={customerLines(row)}
                onPress={() => onOpenCustomer?.(row)}
              />
            ))}
            {customerBusy ? (
              <View style={styles.inlineStatus}>
                <ActivityIndicator size="small" color="#8e8e93" />
                <Text style={styles.inlineStatusText}>Searching customers…</Text>
              </View>
            ) : null}
            {customerError && !customers.length ? <Text style={styles.errorText}>{customerError}</Text> : null}
          </Section>
        ) : null}

        {showNoMatches ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No matches</Text>
            <Text style={styles.emptyHint}>{`Nothing found for “${trimmed}”.`}</Text>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    minHeight: 0,
    backgroundColor: CANVAS,
  },
  chrome: {
    paddingHorizontal: 32,
    paddingTop: 20,
    paddingBottom: 12,
  },
  chromeMobile: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  searchField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: '#fff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(60, 60, 67, 0.18)',
  },
  searchFieldMobile: {
    minHeight: 40,
    borderRadius: 10,
  },
  searchInput: {
    flex: 1,
    fontFamily: FONT,
    fontSize: 16,
    color: '#1d1d1f',
    paddingVertical: 8,
    outlineStyle: 'none',
  },
  scroll: {
    flex: 1,
    minHeight: 0,
  },
  scrollContent: {
    paddingHorizontal: 32,
    paddingBottom: 32,
    maxWidth: 980,
  },
  scrollContentMobile: {
    paddingHorizontal: 16,
    maxWidth: '100%',
  },
  empty: {
    alignItems: 'center',
    paddingTop: 48,
    paddingHorizontal: 24,
    gap: 8,
  },
  emptyTitle: {
    fontFamily: FONT,
    fontSize: 17,
    fontWeight: '600',
    color: '#1d1d1f',
    textAlign: 'center',
  },
  emptyHint: {
    fontFamily: FONT,
    fontSize: 14,
    color: '#8e8e93',
    textAlign: 'center',
    lineHeight: 20,
  },
  section: {
    marginBottom: 20,
  },
  sectionLabel: {
    fontFamily: FONT,
    fontSize: 12,
    fontWeight: '700',
    color: '#8e8e93',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  sectionCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(60, 60, 67, 0.12)',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 56,
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  rowTall: {
    alignItems: 'flex-start',
    paddingVertical: 14,
  },
  rowHover: {
    backgroundColor: 'rgba(0,0,0,0.04)',
  },
  rowStatic: {
    ...Platform.select({ web: { cursor: 'default' }, default: {} }),
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#f2f2f7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  rowTitle: {
    fontFamily: FONT,
    fontSize: 16,
    fontWeight: '600',
    color: '#1d1d1f',
  },
  rowSub: {
    fontFamily: FONT,
    fontSize: 13,
    color: '#8e8e93',
  },
  rowMeta: {
    fontFamily: FONT,
    fontSize: 13,
    fontWeight: '600',
    color: '#1d1d1f',
    marginLeft: 8,
  },
  inlineStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  inlineStatusText: {
    fontFamily: FONT,
    fontSize: 13,
    color: '#8e8e93',
  },
  errorText: {
    fontFamily: FONT,
    fontSize: 13,
    color: '#b91c1c',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  employeeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    ...Platform.select({
      web: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(176px, 1fr))',
      },
    }),
  },
  employeeCard: {
    alignItems: 'center',
    paddingVertical: 18,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: '#fff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(60, 60, 67, 0.12)',
    gap: 6,
    minWidth: 160,
    flexGrow: 1,
    flexBasis: 168,
    ...Platform.select({
      web: {
        minWidth: 0,
        flexGrow: 0,
        flexBasis: 'auto',
        cursor: 'pointer',
      },
    }),
  },
  employeeCardHover: {
    backgroundColor: '#f7f7f8',
  },
  employeeName: {
    fontFamily: FONT,
    fontSize: 15,
    fontWeight: '700',
    color: '#1d1d1f',
    textAlign: 'center',
    marginTop: 6,
  },
  employeeMeta: {
    fontFamily: FONT,
    fontSize: 12,
    color: '#8e8e93',
    textAlign: 'center',
  },
  cardActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 8,
  },
  actionBubble: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#f2f2f7',
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  actionBubbleHover: {
    backgroundColor: '#e5e5ea',
  },
  actionBubbleDisabled: {
    opacity: 0.45,
  },
});
