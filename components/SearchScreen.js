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
  useWindowDimensions,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ensureLinkedPosSessions, posEmployeeId } from '../lib/auth';
import { fetchAureusEmployee } from '../lib/aureusEmployees';
import { documentQueryCandidates, lookupDocuments } from '../lib/docSearch';
import { mobileTabBarReserve, useMobileTabBarScrollProps } from '../lib/mobileTabBar';
import { CANVAS, DESKTOP_TOP_BAR_HEIGHT, MOBILE_BREAKPOINT, useIsMobile } from '../lib/mobileUi';
import { listStaffProfiles, staffDisplayName, useAppAccess } from '../lib/permissions';
import {
  formatTransactionDate,
  formatTransactionTime,
  posSourcesFromSession,
} from '../lib/transactions';
import { prepareAiChatSession, sendAiChatMessage } from '../lib/aiChat';
import { enrichClientActivity, searchClients } from '../lib/triageLookups';
import { OPENROUTER_MODELS } from '../lib/openrouter';
import { FONT } from '../lib/typography';
import { usePhoneCalls } from './PhoneCallProvider';

const AI_PURPLE = '#6B4DE6';
const AI_BLUE = '#0A84FF';
const AI_MODEL =
  OPENROUTER_MODELS.find((model) => model.key === 'anthropic/claude-sonnet-5')?.key ||
  OPENROUTER_MODELS[0]?.key ||
  '';

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

function useSearchPageLayout() {
  const { width } = useWindowDimensions();
  const isMobile = width < MOBILE_BREAKPOINT;
  if (isMobile) {
    return { contentMaxWidth: undefined, searchMaxWidth: undefined };
  }
  const contentMaxWidth = width < 1240 ? 740 : 880;
  const searchMaxWidth = Math.min(540, Math.max(340, Math.round(contentMaxWidth * 0.62)));
  return { contentMaxWidth, searchMaxWidth };
}

function ResultGridCard({ icon, title, subtitle, lines, meta, onPress }) {
  const extras = (lines || []).filter(Boolean);
  if (!extras.length && subtitle) extras.push(subtitle);
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed, hovered }) => [
        styles.gridCard,
        (pressed || hovered) && styles.gridCardHover,
        !onPress && styles.rowStatic,
      ]}
      accessibilityRole={onPress ? 'button' : 'text'}
    >
      <View style={styles.gridCardIcon}>
        <Ionicons name={icon} size={22} color="#1d1d1f" />
      </View>
      <Text style={styles.gridCardTitle} numberOfLines={2}>
        {title}
      </Text>
      {extras.map((line) => (
        <Text key={line} style={styles.gridCardSub} numberOfLines={2}>
          {line}
        </Text>
      ))}
      {meta ? (
        <Text style={styles.gridCardMeta} numberOfLines={1}>
          {meta}
        </Text>
      ) : null}
    </Pressable>
  );
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

export default function SearchScreen({
  session,
  onOpenPerson,
  onOpenDocument,
  onOpenCustomer,
  onMessage,
  query: queryProp,
  onQueryChange,
  hideSearchField = false,
  enterRef,
}) {
  const isMobile = useIsMobile();
  const { contentMaxWidth, searchMaxWidth } = useSearchPageLayout();
  const tabBarScroll = useMobileTabBarScrollProps();
  const { hasApp } = useAppAccess();
  const phone = usePhoneCalls();
  const inputRef = useRef(null);
  const aiScrollRef = useRef(null);
  const searchGen = useRef(0);
  const myId = session?.supabaseUserId || session?.profile?.id || '';
  const canPhone = hasApp('phone');
  const canMessage = hasApp('messages');
  const [localQuery, setLocalQuery] = useState('');
  const controlled = typeof onQueryChange === 'function';
  const query = controlled ? String(queryProp ?? '') : localQuery;
  const setQuery = useCallback(
    (next) => {
      const value = typeof next === 'function' ? next(query) : next;
      if (controlled) onQueryChange(value);
      else setLocalQuery(value);
    },
    [controlled, onQueryChange, query],
  );
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
  const [aiMode, setAiMode] = useState(false);
  const [aiTurns, setAiTurns] = useState([]);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState('');
  const [aiProgress, setAiProgress] = useState('');
  const [seedMessages, setSeedMessages] = useState([]);
  const [chatContext, setChatContext] = useState(null);

  useEffect(() => {
    if (!session?.token) {
      setSeedMessages([]);
      setChatContext(null);
      return undefined;
    }
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - 6);
    const prepared = prepareAiChatSession({ startDate: start, endDate: end });
    setSeedMessages(prepared.seedMessages);
    setChatContext(prepared.context);
    return undefined;
  }, [session]);

  useEffect(() => {
    if (hideSearchField) return undefined;
    if (Platform.OS === 'web') {
      const timer = setTimeout(() => inputRef.current?.focus?.(), 80);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [hideSearchField]);

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

  const people = useMemo(
    () => (aiMode ? [] : filterStaff(staff, query).slice(0, 25)),
    [aiMode, staff, query],
  );
  const trimmed = query.trim();
  const canLookupTickets = documentQueryCandidates(trimmed).length > 0;
  const canLookupCustomers = trimmed.length >= 2 && !documentQueryCandidates(trimmed).length;

  useEffect(() => {
    if (aiMode) {
      setTickets([]);
      setTicketError('');
      setTicketBusy(false);
      return undefined;
    }
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
  }, [aiMode, canLookupTickets, session, trimmed]);

  useEffect(() => {
    if (aiMode) {
      setCustomers([]);
      setCustomerError('');
      setCustomerBusy(false);
      return undefined;
    }
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
  }, [aiMode, canLookupCustomers, session, trimmed]);

  const showNoMatches =
    !aiMode &&
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
    setAiError('');
  }, []);

  const scrollAiToEnd = useCallback(() => {
    requestAnimationFrame(() => aiScrollRef.current?.scrollToEnd?.({ animated: true }));
  }, []);

  const sendAiQuestion = useCallback(async () => {
    const text = query.trim();
    if (!text || aiBusy || !aiMode) return;
    if (!session?.token) {
      setAiError('Sign in again to use AI search.');
      return;
    }
    if (!seedMessages.length) {
      setAiError('AI is still loading. Try again in a moment.');
      return;
    }
    setQuery('');
    setAiError('');
    setAiBusy(true);
    setAiProgress('Choosing data…');
    const history = aiTurns.filter(
      (turn) => (turn.role === 'user' || turn.role === 'assistant') && String(turn.content || '').trim(),
    );
    const nextTurns = [...history, { role: 'user', content: text }];
    setAiTurns(nextTurns);
    scrollAiToEnd();
    try {
      const result = await sendAiChatMessage({
        seedMessages,
        turns: history,
        userMessage: text,
        model: AI_MODEL,
        session,
        context: chatContext,
        startDate: chatContext?.selection?.startDate,
        endDate: chatContext?.selection?.endDate,
        onLookup: (label) => setAiProgress(label || ''),
        extraContext:
          'The staff member is using global Search with AI enabled. Answer using company-wide data and relationships when relevant.',
      });
      if (result.sources?.length || result.scope) {
        setChatContext((current) =>
          current
            ? {
                ...current,
                lastSources: result.sources?.length ? result.sources : current.lastSources,
                lastScope: result.scope || current.lastScope,
              }
            : current,
        );
      }
      setAiTurns(
        result.turns || [...nextTurns, { role: 'assistant', content: result.text || '' }],
      );
    } catch (err) {
      setAiTurns(history);
      setQuery(text);
      setAiError(err?.message || 'Could not get an AI answer.');
    } finally {
      setAiBusy(false);
      setAiProgress('');
      scrollAiToEnd();
    }
  }, [aiBusy, aiMode, aiTurns, chatContext, query, scrollAiToEnd, seedMessages, session]);

  const toggleAiMode = useCallback(() => {
    setAiMode((on) => !on);
    setAiError('');
  }, []);

  useEffect(() => {
    if (!enterRef) return undefined;
    enterRef.current = () => {
      if (aiMode) void sendAiQuestion();
    };
    return () => {
      enterRef.current = null;
    };
  }, [aiMode, enterRef, sendAiQuestion]);

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

  const columnStyle = !isMobile && contentMaxWidth ? { maxWidth: contentMaxWidth, width: '100%' } : null;
  const searchStyle =
    !isMobile && searchMaxWidth ? { maxWidth: searchMaxWidth, width: '100%' } : null;

  return (
    <View style={styles.root}>
      <View style={[styles.chrome, isMobile && styles.chromeMobile, !isMobile && styles.chromeDesktop]} pointerEvents="box-none">
        <View style={[styles.searchChromeRow, searchStyle]}>
          {hideSearchField ? null : (
          <View
            style={[
              styles.searchField,
              isMobile && styles.searchFieldMobile,
              !isMobile && styles.searchFieldDesktop,
            ]}
          >
            <Ionicons name="search" size={16} color="#8e8e93" />
            <TextInput
              ref={inputRef}
              style={styles.searchInput}
              value={query}
              onChangeText={onChangeQuery}
              placeholder="Search"
              placeholderTextColor="#8e8e93"
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus={!isMobile}
              clearButtonMode="while-editing"
              returnKeyType={aiMode ? 'send' : 'search'}
              editable={!aiBusy}
              onSubmitEditing={() => {
                if (aiMode) void sendAiQuestion();
              }}
              onKeyPress={(event) => {
                if (!aiMode) return;
                const key = event?.nativeEvent?.key || event?.key;
                if (key !== 'Enter') return;
                event.preventDefault?.();
                if (query.trim() && !aiBusy) void sendAiQuestion();
              }}
            />
            {query ? (
              <Pressable onPress={() => setQuery('')} hitSlop={8} accessibilityLabel="Clear search">
                <Ionicons name="close-circle" size={18} color="#c7c7cc" />
              </Pressable>
            ) : null}
          </View>
          )}
          <Pressable
            onPress={toggleAiMode}
            disabled={aiBusy}
            style={({ pressed, hovered }) => [
              styles.aiToggle,
              aiMode && styles.aiToggleOn,
              (pressed || hovered) && !aiBusy && styles.aiToggleHover,
              aiBusy && styles.aiToggleDisabled,
            ]}
            accessibilityRole="switch"
            accessibilityState={{ checked: aiMode, disabled: aiBusy }}
            accessibilityLabel="AI search"
          >
            <Ionicons name="sparkles" size={14} color={aiMode ? '#fff' : AI_PURPLE} />
            <Text style={[styles.aiToggleLabel, aiMode && styles.aiToggleLabelOn]}>AI</Text>
          </Pressable>
        </View>
      </View>

      <ScrollView
        ref={aiScrollRef}
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          isMobile && styles.scrollContentMobile,
          !isMobile && styles.scrollContentDesktop,
          isMobile && { paddingBottom: mobileTabBarReserve() + 24 },
        ]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        onContentSizeChange={() => {
          if (aiMode && aiTurns.length) scrollAiToEnd();
        }}
        {...(isMobile ? tabBarScroll : null)}
      >
        <View style={[styles.scrollColumn, columnStyle]}>
        {aiMode && aiTurns.length ? (
          <View style={styles.aiThread}>
            {aiTurns.map((turn, index) => (
              <View
                key={`${turn.role}-${index}`}
                style={[styles.aiBubble, turn.role === 'user' ? styles.aiBubbleMine : styles.aiBubbleThem]}
              >
                <Text style={[styles.aiBubbleText, turn.role === 'user' && styles.aiBubbleTextMine]}>
                  {turn.content}
                </Text>
              </View>
            ))}
            {aiBusy ? (
              <View style={styles.aiBusyRow}>
                <ActivityIndicator size="small" color="#8e8e93" />
                {aiProgress ? <Text style={styles.inlineStatusText}>{aiProgress}</Text> : null}
              </View>
            ) : null}
          </View>
        ) : null}

        {aiError ? <Text style={styles.aiErrorText}>{aiError}</Text> : null}

        {!aiMode && (ticketBusy || tickets.length || ticketError) ? (
          <Section title="PO / SO" plain={!isMobile}>
            {isMobile ? (
              tickets.map((row) => (
                <ResultRow
                  key={row.id}
                  icon={row.type === 'purchase' ? 'arrow-down-circle-outline' : 'arrow-up-circle-outline'}
                  title={row.reference || `${ticketKind(row)}# ${row.sourceId}`}
                  subtitle={[row.customerName, row.storeName, row.employeeName].filter(Boolean).join(' · ')}
                  meta={row.amountLabel || ''}
                  onPress={() => onOpenDocument?.(row)}
                />
              ))
            ) : (
              <View style={styles.resultsGrid}>
                {tickets.map((row) => (
                  <ResultGridCard
                    key={row.id}
                    icon={row.type === 'purchase' ? 'arrow-down-circle-outline' : 'arrow-up-circle-outline'}
                    title={row.reference || `${ticketKind(row)}# ${row.sourceId}`}
                    subtitle={[row.customerName, row.storeName, row.employeeName].filter(Boolean).join(' · ')}
                    meta={row.amountLabel || ''}
                    onPress={() => onOpenDocument?.(row)}
                  />
                ))}
              </View>
            )}
            {ticketBusy ? (
              <View style={[styles.inlineStatus, !isMobile && styles.inlineStatusGrid]}>
                <ActivityIndicator size="small" color="#8e8e93" />
                <Text style={styles.inlineStatusText}>Looking up tickets…</Text>
              </View>
            ) : null}
            {ticketError && !tickets.length ? (
              <Text style={[styles.errorText, !isMobile && styles.errorTextGrid]}>{ticketError}</Text>
            ) : null}
          </Section>
        ) : null}

        {!aiMode && (people.length || staffError) ? (
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

        {!aiMode && (customerBusy || customers.length || customerError) ? (
          <Section title="Customers" plain={!isMobile}>
            {isMobile ? (
              customers.map((row) => (
                <ResultRow
                  key={`${row.systemKey || ''}:${row.id}`}
                  icon="person-circle-outline"
                  title={row.label}
                  lines={customerLines(row)}
                  onPress={() => onOpenCustomer?.(row)}
                />
              ))
            ) : (
              <View style={styles.resultsGrid}>
                {customers.map((row) => (
                  <ResultGridCard
                    key={`${row.systemKey || ''}:${row.id}`}
                    icon="person-circle-outline"
                    title={row.label}
                    lines={customerLines(row)}
                    onPress={() => onOpenCustomer?.(row)}
                  />
                ))}
              </View>
            )}
            {customerBusy ? (
              <View style={[styles.inlineStatus, !isMobile && styles.inlineStatusGrid]}>
                <ActivityIndicator size="small" color="#8e8e93" />
                <Text style={styles.inlineStatusText}>Searching customers…</Text>
              </View>
            ) : null}
            {customerError && !customers.length ? (
              <Text style={[styles.errorText, !isMobile && styles.errorTextGrid]}>{customerError}</Text>
            ) : null}
          </Section>
        ) : null}

        {showNoMatches ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No matches</Text>
            <Text style={styles.emptyHint}>{`Nothing found for “${trimmed}”.`}</Text>
          </View>
        ) : null}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    minHeight: 0,
    backgroundColor: CANVAS,
    position: 'relative',
  },
  chrome: {
    paddingHorizontal: 32,
    paddingTop: 20,
    paddingBottom: 12,
  },
  chromeDesktop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 24,
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: DESKTOP_TOP_BAR_HEIGHT + 16,
  },
  chromeMobile: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  searchField: {
    flex: 1,
    minWidth: 0,
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
  searchFieldDesktop: {
    borderRadius: 6,
    minHeight: 40,
  },
  searchChromeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    width: '100%',
    alignSelf: 'center',
  },
  aiToggle: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: '#fff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(60, 60, 67, 0.18)',
    minHeight: 40,
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  aiToggleOn: {
    backgroundColor: AI_PURPLE,
    borderColor: AI_PURPLE,
  },
  aiToggleHover: {
    opacity: 0.92,
  },
  aiToggleDisabled: {
    opacity: 0.45,
  },
  aiToggleLabel: {
    fontFamily: FONT,
    fontSize: 13,
    fontWeight: '700',
    color: '#1d1d1f',
    letterSpacing: 0.2,
  },
  aiToggleLabelOn: {
    color: '#fff',
  },
  aiThread: {
    gap: 10,
    paddingTop: 8,
    paddingBottom: 8,
  },
  aiBubble: {
    maxWidth: '92%',
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  aiBubbleMine: {
    alignSelf: 'flex-end',
    backgroundColor: AI_BLUE,
  },
  aiBubbleThem: {
    alignSelf: 'flex-start',
    backgroundColor: '#fff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(60, 60, 67, 0.12)',
  },
  aiBubbleText: {
    fontFamily: FONT,
    fontSize: 16,
    lineHeight: 21,
    color: '#1d1d1f',
  },
  aiBubbleTextMine: {
    color: '#fff',
  },
  aiBusyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
    paddingVertical: 4,
  },
  aiErrorText: {
    fontFamily: FONT,
    fontSize: 13,
    color: '#b91c1c',
    marginTop: 8,
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
    flexGrow: 1,
  },
  scrollContentDesktop: {
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: DESKTOP_TOP_BAR_HEIGHT + 72,
  },
  scrollContentMobile: {
    paddingHorizontal: 16,
  },
  scrollColumn: {
    width: '100%',
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
    backgroundColor: '#f5f5f5',
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
  resultsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    ...Platform.select({
      web: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
      },
    }),
  },
  gridCard: {
    alignItems: 'flex-start',
    paddingVertical: 16,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: '#fff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(60, 60, 67, 0.12)',
    gap: 4,
    minWidth: 180,
    flexGrow: 1,
    flexBasis: 200,
    ...Platform.select({
      web: {
        minWidth: 0,
        flexGrow: 0,
        flexBasis: 'auto',
        cursor: 'pointer',
      },
    }),
  },
  gridCardHover: {
    backgroundColor: '#f5f5f5',
  },
  gridCardIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#f2f2f7',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  gridCardTitle: {
    fontFamily: FONT,
    fontSize: 15,
    fontWeight: '600',
    color: '#1d1d1f',
  },
  gridCardSub: {
    fontFamily: FONT,
    fontSize: 12,
    color: '#8e8e93',
    lineHeight: 16,
  },
  gridCardMeta: {
    fontFamily: FONT,
    fontSize: 13,
    fontWeight: '600',
    color: '#1d1d1f',
    marginTop: 4,
  },
  inlineStatusGrid: {
    paddingHorizontal: 0,
  },
  errorTextGrid: {
    paddingHorizontal: 0,
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
    backgroundColor: '#f5f5f5',
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
