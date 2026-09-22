import { createElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  RIPPLING_API_TOKENS_URL,
  WORKER_STATUS,
  canManageCompanyRippling,
  clearRipplingSession,
  disconnectCompanyRippling,
  fetchEmployees,
  fetchRipplingCompany,
  loadRipplingOAuthApp,
  loadRipplingSession,
  readRipplingOAuthCallback,
  saveCompanyRipplingSession,
  saveRipplingSession,
} from '../lib/rippling';
import { syncStaffRoles } from '../lib/auth';
import { reloadClockedIn } from '../lib/clockedIn';
import { mergeEmployeesWithProfiles } from '../lib/aureusEmployees';
import { getGmailRedirectUri } from '../lib/gmail';
import { categoryLabel, listStaffProfiles, useAppAccess } from '../lib/permissions';
import {
  buildHoursAuthorizeUrl,
  canManageHoursFeed,
  clearHoursOAuthCallbackFromUrl,
  clearHoursOAuthState,
  connectHoursMailbox,
  disconnectHoursMailbox,
  fetchHoursSummary,
  fetchRipplingCsvFiles,
  fetchRipplingReport,
  fetchTimeEntries,
  formatClock,
  formatMinutes,
  formatRelativeTime,
  formatShiftDate,
  hoursForPerson,
  loadHoursFeedStatus,
  readHoursOAuthCallback,
  summarizeTimeEntries,
  syncHoursFeed,
  uploadRipplingCsvFiles,
} from '../lib/ripplingTime';
import { useLiveRefresh } from '../lib/liveRefresh';
import { useIsMobile } from '../lib/mobileUi';
import ProfilePhotoModal from './ProfilePhotoModal';
import {
  BarButton,
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
  StatusPill,
  T,
  TextTabs,
} from './TriageKit';

const STATUS_FILTERS = [
  { key: WORKER_STATUS.ACTIVE, label: 'Active' },
  { key: 'ALL', label: 'All' },
  { key: WORKER_STATUS.TERMINATED, label: 'Terminated' },
];

const EMPLOYEE_TABS = [
  { key: 'employees', label: 'Employees' },
  { key: 'rippling', label: 'Rippling' },
];

function statusTone(status) {
  switch (status) {
    case WORKER_STATUS.ACTIVE:
      return 'green';
    case WORKER_STATUS.TERMINATED:
      return 'red';
    case WORKER_STATUS.HIRED:
    case WORKER_STATUS.ACCEPTED:
      return 'blue';
    default:
      return 'neutral';
  }
}

function FieldGroup({ title, fields }) {
  const rows = (fields || []).filter((field) => field?.value);
  if (!rows.length) return null;
  return (
    <View style={styles.cardBlock}>
      {title ? <SectionLabel>{title}</SectionLabel> : null}
      <Group>
        {rows.map((field, index) => (
          <GroupRow
            key={field.label}
            label={field.label}
            value={field.value}
            last={index === rows.length - 1}
          />
        ))}
      </Group>
    </View>
  );
}

/**
 * Hours imported from the emailed Rippling report. Asks the proxy to check the
 * inbox (it skips when it looked recently), then reads the per-person summary.
 */
function useHoursSummary(enabled) {
  const [summary, setSummary] = useState(null);
  const [status, setStatus] = useState(null);
  const [report, setReport] = useState(null);
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const requestId = useRef(0);

  const refresh = useCallback(
    async ({ force = false, sync = true } = {}) => {
      const id = ++requestId.current;
      setLoading(true);
      try {
        let nextStatus = null;
        if (sync) {
          nextStatus = await syncHoursFeed({ force }).catch(() => null);
        }
        if (!nextStatus) nextStatus = await loadHoursFeedStatus().catch(() => null);
        const [nextSummary, nextReport, nextFiles] = await Promise.all([
          fetchHoursSummary().catch(() => null),
          fetchRipplingReport().catch(() => null),
          fetchRipplingCsvFiles().catch(() => []),
        ]);
        if (id !== requestId.current) return nextStatus;
        setStatus(nextStatus);
        setSummary(nextSummary);
        setReport(nextReport);
        setFiles(nextFiles);
        await reloadClockedIn().catch(() => {});
        return nextStatus;
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (!enabled) return;
    refresh();
  }, [enabled, refresh]);

  // The report lands hourly; re-check while the screen is open so the
  // clocked-in rings follow it without a manual refresh.
  useLiveRefresh(() => refresh(), HOURS_LIVE_MS, enabled);

  return { summary, status, report, files, loading, refresh, setStatus };
}

const HISTORY_DAY_LIMIT = 14;
const HOURS_LIVE_MS = 60_000;
const REPORT_ROW_LIMIT = 80;

function HoursSection({ hours, status }) {
  const [history, setHistory] = useState(null);
  const [showAll, setShowAll] = useState(false);
  const employeeId = hours?.id || '';

  useEffect(() => {
    let cancelled = false;
    setShowAll(false);
    if (!employeeId) {
      setHistory(null);
      return undefined;
    }
    fetchTimeEntries(employeeId)
      .then((rows) => {
        if (!cancelled) setHistory(summarizeTimeEntries(rows));
      })
      .catch(() => {
        if (!cancelled) setHistory(null);
      });
    return () => {
      cancelled = true;
    };
  }, [employeeId, status?.lastSyncedAt]);

  if (!hours && !history?.days?.length) {
    if (!status?.connected && !status?.lastSyncedAt) return null;
    return (
      <View style={styles.cardBlock}>
        <SectionLabel>Hours</SectionLabel>
        <Group>
          <GroupRow label="Clock history" value="No time entries yet" last />
        </Group>
      </View>
    );
  }

  const totals = history?.totals || {
    today: hours?.todayMinutes || 0,
    week: hours?.weekMinutes || 0,
    twoWeeks: (hours?.weekMinutes || 0) + (hours?.lastWeekMinutes || 0),
    fourWeeks: hours?.monthMinutes || 0,
    all: hours?.monthMinutes || 0,
  };
  const days = history?.days || [];
  const visibleDays = showAll ? days : days.slice(0, HISTORY_DAY_LIMIT);
  const updated = status?.lastSyncedAt ? formatRelativeTime(status.lastSyncedAt) : '';

  return (
    <>
      <View style={styles.cardBlock}>
        <SectionLabel trailing={updated ? <Text style={styles.hoursUpdated}>{`Updated ${updated}`}</Text> : null}>
          Hours
        </SectionLabel>
        {hours?.clockedIn || hours?.openSince ? (
          <View style={styles.hoursNow}>
            <StatusPill
              label={hours.openSince ? `Clocked in · since ${formatClock(hours.openSince)}` : 'Clocked in'}
              tone="green"
              compact
            />
          </View>
        ) : null}
        <Group>
          <GroupRow label="Today" value={formatMinutes(totals.today)} />
          <GroupRow label="This week" value={formatMinutes(totals.week)} />
          <GroupRow label="2 weeks" value={formatMinutes(totals.twoWeeks)} />
          <GroupRow label="4 weeks" value={formatMinutes(totals.fourWeeks)} />
          <GroupRow label="All in this report" value={formatMinutes(totals.all)} last />
        </Group>
      </View>
      <View style={styles.cardBlock}>
        <SectionLabel>Clock in / out</SectionLabel>
        {visibleDays.length ? (
          visibleDays.map((day) => (
            <View key={day.date} style={styles.hoursDay}>
              <Text style={styles.hoursDayTitle}>{formatShiftDate(day.date)}</Text>
              <Group>
                {day.punches.map((punch, index) => (
                  <GroupRow
                    key={punch.key || `${day.date}-${index}`}
                    label={`${formatClock(punch.start)} – ${punch.end ? formatClock(punch.end) : 'now'}`}
                    value={punch.minutes ? formatMinutes(punch.minutes) : ''}
                  />
                ))}
                <GroupRow label="Day total" value={formatMinutes(day.minutes)} last />
              </Group>
            </View>
          ))
        ) : (
          <Group>
            <GroupRow label="History" value="No clock in or out in this report" last />
          </Group>
        )}
        {days.length > HISTORY_DAY_LIMIT ? (
          <Pressable onPress={() => setShowAll((value) => !value)} style={styles.hoursMore}>
            <Text style={styles.hoursMoreText}>
              {showAll ? 'Show recent days' : `Show earlier days (${days.length - HISTORY_DAY_LIMIT})`}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </>
  );
}

function hoursForStaff(summary, person) {
  if (!summary || !person) return null;
  return hoursForPerson(summary, {
    ripplingId: person.ripplingId,
    names: [person.fullName, [person.firstName, person.lastName].filter(Boolean).join(' ')],
  });
}

/**
 * HR / GM / System Admin card: connect the inbox that receives the scheduled
 * Rippling time report, see the last import, force a check, or disconnect.
 */
function HoursFeedCard({ status, onStatusChange, onRefresh, loading }) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    const callback = readHoursOAuthCallback();
    if (!callback) return undefined;
    let cancelled = false;
    (async () => {
      setBusy('connect');
      setError('');
      try {
        if (callback.error) {
          throw new Error(callback.errorDescription || callback.error || 'Google sign-in was cancelled.');
        }
        const next = await connectHoursMailbox({ code: callback.code, redirectUri: getGmailRedirectUri() });
        clearHoursOAuthState();
        clearHoursOAuthCallbackFromUrl();
        if (cancelled) return;
        onStatusChange?.(next);
        if (next.syncError) setError(next.syncError);
        else if (next.sync?.message) setNotice(next.sync.message);
        onRefresh?.({ sync: false });
      } catch (err) {
        clearHoursOAuthState();
        clearHoursOAuthCallbackFromUrl();
        if (!cancelled) setError(err?.message || 'Could not connect the hours mailbox.');
      } finally {
        if (!cancelled) setBusy('');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [onRefresh, onStatusChange]);

  const connect = () => {
    setError('');
    setNotice('');
    if (!status?.clientId) {
      setError('The hours mailbox Google app is not ready yet.');
      return;
    }
    try {
      const url = buildHoursAuthorizeUrl({
        clientId: status.clientId,
        loginHint: status?.email || '',
      });
      if (typeof window !== 'undefined') {
        window.location.assign(url);
        return;
      }
      Linking.openURL(url);
    } catch (err) {
      setError(err?.message || 'Could not start Google sign-in.');
    }
  };

  const checkNow = async () => {
    setBusy('sync');
    setError('');
    setNotice('');
    try {
      const next = await onRefresh?.({ force: true });
      if (next?.syncError) setError(next.syncError);
      else if (next?.sync?.message) setNotice(next.sync.message);
    } catch (err) {
      setError(err?.message || 'Could not check the mailbox.');
    } finally {
      setBusy('');
    }
  };

  const disconnect = async () => {
    setBusy('disconnect');
    setError('');
    setNotice('');
    try {
      const next = await disconnectHoursMailbox();
      onStatusChange?.(next);
    } catch (err) {
      setError(err?.message || 'Could not disconnect the hours mailbox.');
    } finally {
      setBusy('');
    }
  };

  const connected = Boolean(status?.connected);
  const lastImport = status?.lastSyncedAt
    ? [
        `${status.rowCount} entries · ${status.rangeStart || '?'} → ${status.rangeEnd || '?'} · ${formatRelativeTime(status.lastSyncedAt)}`,
        status.clockReportedAt
          ? `${status.clockedInCount} clocked in as of ${formatRelativeTime(status.clockReportedAt)}`
          : '',
      ]
        .filter(Boolean)
        .join('\n')
    : 'Nothing imported yet';

  return (
    <View style={styles.connectBar}>
      <View style={styles.connectInfo}>
        <Ionicons
          name={connected ? 'time-outline' : 'mail-unread-outline'}
          size={18}
          color={connected ? T.green : T.secondary}
        />
        <View style={styles.connectCopy}>
          <Text style={styles.connectTitle}>
            {connected ? `Hours report · ${status.email}` : 'Hours report mailbox'}
          </Text>
          <Text style={styles.connectHint}>
            {connected
              ? `${lastImport}\nReading ${status.email}. The newest CSV in that mailbox is what this screen shows.`
              : `Connect ${status?.email || 'the hours mailbox'} with Google and allow “View your email messages and settings”. Rippling reads only that mailbox.`}
          </Text>
          {error ? <Text style={styles.errorText}>{error}</Text> : status?.lastError ? <Text style={styles.errorText}>{status.lastError}</Text> : null}
          {notice ? <Text style={styles.noticeText}>{notice}</Text> : null}
        </View>
      </View>
      <View style={styles.connectActions}>
        {connected ? (
          <>
            <BarButton label={busy === 'sync' || loading ? 'Checking…' : 'Check now'} onPress={checkNow} disabled={Boolean(busy) || loading} />
            <BarButton label="Disconnect" onPress={disconnect} disabled={Boolean(busy)} />
          </>
        ) : (
          <BarButton
            label={busy === 'connect' ? 'Connecting…' : 'Connect mailbox'}
            onPress={connect}
            disabled={Boolean(busy) || !status?.clientId}
          />
        )}
      </View>
    </View>
  );
}

function PersonHero({ name, title, photoUrl, statusLabel, statusTone: tone, onOpenPhoto, compact, onClose, heading, clockedIn }) {
  return (
    <View style={styles.heroCard}>
      {compact ? (
        <View style={styles.detailMobileHeader}>
          <Text style={styles.detailMobileTitle}>{heading || 'Employee'}</Text>
          <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close">
            <Ionicons name="close" size={22} color={T.secondary} />
          </Pressable>
        </View>
      ) : null}
      <Pressable
        onPress={onOpenPhoto}
        disabled={!onOpenPhoto}
        accessibilityRole={onOpenPhoto ? 'button' : undefined}
        accessibilityLabel={onOpenPhoto ? `View ${name}'s portrait` : undefined}
      >
        <StaffAvatar uri={photoUrl} name={name} size={72} ring={clockedIn ? 'green' : undefined} />
      </Pressable>
      <Text style={styles.heroName}>{name}</Text>
      {title ? <Text style={styles.heroTitle}>{title}</Text> : null}
      <View style={styles.heroPills}>
        {statusLabel ? <StatusPill label={statusLabel} tone={tone || 'neutral'} /> : null}
        {clockedIn ? <StatusPill label="Clocked in" tone="green" /> : null}
      </View>
    </View>
  );
}

function staffDisplayName(row) {
  return (
    row.fullName ||
    [row.firstName, row.lastName].filter(Boolean).join(' ') ||
    row.email ||
    row.aureusLogin ||
    'Staff'
  );
}

function employeeTypeLabel(row) {
  return row.employeeType || row.posRole || '—';
}

function permissionLabel(person) {
  if (!person?.hasSignedIn) return '—';
  return categoryLabel(person) || '—';
}

function StaffEmployeeRow({ person, selected, onPress, last, hours }) {
  const name = staffDisplayName(person);
  const permission = permissionLabel(person);
  const location = person.locationName || '';
  const type = employeeTypeLabel(person);
  const inactive = person.isActive === false || person.profileActive === false;
  const weekHours = hours?.weekMinutes ? `${formatMinutes(hours.weekMinutes)} this wk` : '';
  const subtitle = [location, type !== '—' ? type : '', permission !== '—' ? permission : '', weekHours]
    .filter(Boolean)
    .join(' · ');

  return (
    <View style={inactive ? styles.rowInactive : null}>
      <MobileListRow
        title={inactive ? `${name} · Inactive` : name}
        subtitle={subtitle || person.email || person.aureusLogin}
        leading={
          <StaffAvatar
            uri={person.avatarUrl || person.photoUrl}
            name={name}
            size={44}
            ring={hours?.clockedIn ? 'green' : undefined}
          />
        }
        selected={selected}
        last={last}
        onPress={onPress}
      />
    </View>
  );
}

function StaffEmployeeDetail({ person, onClose, compact, onOpenPhoto, hours, hoursStatus }) {
  if (!person) {
    return (
      <EmptyState icon="people-outline" title="Employee" body="Select someone to see their profile." />
    );
  }

  const name = staffDisplayName(person);
  const photoUri = person.avatarUrl || person.photoUrl || '';
  const inactive = person.isActive === false || person.profileActive === false;

  return (
    <ScrollView
      style={styles.detailScroll}
      contentContainerStyle={styles.detailContent}
      showsVerticalScrollIndicator={false}
    >
      <PersonHero
        name={name}
        title={employeeTypeLabel(person)}
        photoUrl={photoUri}
        statusLabel={inactive ? 'Inactive' : person.hasSignedIn ? permissionLabel(person) : 'Hasn’t signed in'}
        statusTone={inactive ? 'neutral' : person.hasSignedIn ? 'blue' : 'orange'}
        onOpenPhoto={onOpenPhoto}
        compact={compact}
        onClose={onClose}
        clockedIn={Boolean(hours?.clockedIn)}
      />
      <FieldGroup
        title="Work"
        fields={[
          { label: 'Location', value: person.locationName },
          { label: 'Employee type', value: person.employeeType },
          {
            label: 'Aureus role',
            value: person.role && person.role !== person.employeeType ? person.role : '',
          },
          {
            label: 'Permission',
            value: person.hasSignedIn ? permissionLabel(person) : 'Has not signed in to myCanadaGold',
          },
        ]}
      />
      <FieldGroup
        title="Contact"
        fields={[
          { label: 'Work email', value: person.email },
          { label: 'Aureus login', value: person.aureusLogin },
          { label: 'Phone', value: person.phone },
        ]}
      />
      <HoursSection hours={hours} status={hoursStatus} />
    </ScrollView>
  );
}

function locationMatchesStore(locationName, storeName) {
  const store = String(storeName || '').trim().toLowerCase();
  const location = String(locationName || '').trim().toLowerCase();
  if (!store || !location) return false;
  if (location === store) return true;
  return location.includes(store) || store.includes(location);
}

function groupRows(rows, keyFor) {
  const map = new Map();
  for (const row of rows) {
    const key = keyFor(row) || 'Other';
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
}

function AppEmployeesPanel({ session, onProfileUpdated, storeFilter, hours }) {
  const isMobile = useIsMobile();
  const hoursSummary = hours?.summary || null;
  const hoursStatus = hours?.status || null;
  const { canFilter } = useAppAccess();
  const lockedLocation = String(storeFilter || '').trim();
  const allowFilters = canFilter('employees') && !lockedLocation;
  const [people, setPeople] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [location, setLocation] = useState(lockedLocation || null);
  const [selectedId, setSelectedId] = useState(null);
  const [photoPerson, setPhotoPerson] = useState(null);
  const onProfileUpdatedRef = useRef(onProfileUpdated);
  onProfileUpdatedRef.current = onProfileUpdated;

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      if (session?.token) {
        try {
          const synced = await syncStaffRoles(session);
          if (synced?.profile?.id) {
            onProfileUpdatedRef.current?.({
              ...synced.profile,
              appRole: undefined,
              isSystemAdmin: undefined,
            });
          }
        } catch {
          // Directory still loads if role sync is unavailable.
        }
      }
      const profiles = await listStaffProfiles();
      const rows = mergeEmployeesWithProfiles([], profiles);
      setPeople(rows);
      setSelectedId((current) => {
        if (current && rows.some((row) => row.id === current)) return current;
        return null;
      });
    } catch (err) {
      setPeople([]);
      setError(err?.message || 'Could not load employees.');
    } finally {
      setLoading(false);
    }
  }, [session?.token]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (lockedLocation) {
      setLocation(lockedLocation);
      return;
    }
    if (!allowFilters) setLocation(null);
  }, [allowFilters, lockedLocation]);

  const locations = useMemo(() => {
    const names = new Set();
    for (const row of people) {
      if (row.locationName) names.add(row.locationName);
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [people]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return people.filter((row) => {
      if (lockedLocation) {
        if (!locationMatchesStore(row.locationName, lockedLocation)) return false;
      } else if (location && row.locationName !== location) {
        return false;
      }
      if (!q) return true;
      const haystack = [
        staffDisplayName(row),
        row.email,
        row.aureusLogin,
        row.locationName,
        employeeTypeLabel(row),
        row.role,
        row.phone,
        permissionLabel(row),
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [people, query, location, lockedLocation]);

  const selected = useMemo(
    () => filtered.find((row) => row.id === selectedId) || null,
    [filtered, selectedId],
  );

  const grouped = useMemo(
    () => groupRows(filtered, (row) => row.locationName || 'No location'),
    [filtered],
  );

  return (
    <View style={styles.body}>
      <View style={styles.toolbar}>
        <SearchField
          value={query}
          onChangeText={setQuery}
          placeholder="Search name, location, type…"
          size={isMobile ? 'lg' : undefined}
          style={styles.searchField}
        />
        <BarButton
          label="Refresh"
          onPress={() => {
            load();
            hours?.refresh?.();
          }}
          disabled={loading}
        />
      </View>

      {allowFilters && locations.length > 1 ? (
        <View style={styles.filterRow}>
          <Chip label="All locations" selected={!location} onPress={() => setLocation(null)} />
          {locations.map((name) => (
            <Chip
              key={name}
              label={name}
              selected={location === name}
              onPress={() => setLocation((current) => (current === name ? null : name))}
            />
          ))}
        </View>
      ) : null}

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      {loading && people.length === 0 ? (
        <View style={styles.centered}>
          <ActivityIndicator color={T.text} />
        </View>
      ) : (
        <View style={styles.split}>
          <View style={styles.listPane}>
            <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
              {filtered.length === 0 ? (
                <EmptyState
                  icon="people-outline"
                  title="No employees"
                  body={
                    query.trim() || location || lockedLocation
                      ? 'No employees match the current filters.'
                      : 'No employees have signed in yet.'
                  }
                />
              ) : (
                grouped.map(([groupName, rows]) => (
                  <View key={groupName} style={styles.listGroup}>
                    <SectionLabel>
                      {groupName}
                      {` · ${rows.length}`}
                    </SectionLabel>
                    <MobileList>
                      {rows.map((person, index) => (
                        <StaffEmployeeRow
                          key={person.id}
                          person={person}
                          hours={hoursForStaff(hoursSummary, person)}
                          last={index === rows.length - 1}
                          selected={!isMobile && selectedId === person.id}
                          onPress={() => setSelectedId(person.id)}
                        />
                      ))}
                    </MobileList>
                  </View>
                ))
              )}
            </ScrollView>
          </View>

          {!isMobile ? (
            <View style={styles.detailPane}>
              <StaffEmployeeDetail
                person={selected}
                hours={hoursForStaff(hoursSummary, selected)}
                hoursStatus={hoursStatus}
                onOpenPhoto={() => selected && setPhotoPerson(selected)}
              />
            </View>
          ) : null}
        </View>
      )}

      {isMobile ? (
        <Modal
          visible={Boolean(selected)}
          animationType="slide"
          onRequestClose={() => setSelectedId(null)}
        >
          <View
            style={styles.mobileDetail}
            {...(Platform.OS === 'web' ? { className: 'cgold-mobile-sheet-top' } : null)}
          >
            <StaffEmployeeDetail
              person={selected}
              hours={hoursForStaff(hoursSummary, selected)}
              hoursStatus={hoursStatus}
              compact
              onClose={() => setSelectedId(null)}
              onOpenPhoto={() => selected && setPhotoPerson(selected)}
            />
          </View>
        </Modal>
      ) : null}
      <ProfilePhotoModal
        visible={Boolean(photoPerson)}
        onClose={() => setPhotoPerson(null)}
        profileId={photoPerson?.profileId || ''}
        name={photoPerson ? staffDisplayName(photoPerson) : ''}
        avatarUrl={(photoPerson?.avatarUrl || photoPerson?.photoUrl) || ''}
        locationName={photoPerson?.locationName || ''}
        myId={session?.supabaseUserId || session?.profile?.id || ''}
        myName={
          session?.profile?.fullName ||
          [session?.profile?.firstName, session?.profile?.lastName].filter(Boolean).join(' ') ||
          'You'
        }
        myAvatarUrl={session?.profile?.avatarUrl || ''}
      />
    </View>
  );
}

function ConnectModal({ visible, onClose, onSaved, canManage }) {
  const [token, setToken] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (visible) {
      setToken('');
      setError('');
      setSaving(false);
    }
  }, [visible]);

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const session = canManage
        ? await saveCompanyRipplingSession({ token })
        : await saveRipplingSession({ token });
      onSaved(session);
      onClose();
    } catch (err) {
      setError(err?.message || 'Could not save Rippling token.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.modalCard}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Connect Rippling</Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <Ionicons name="close" size={18} color="#6b6b6b" />
            </Pressable>
          </View>
          <Text style={styles.modalBody}>
            Create the token in Tools → Developer → API Tokens (not Company Settings → API).
            Paste the token only — do not type Bearer. The app sends `Authorization: Bearer …`.
            Enable workers.read, users.read, departments.read, and work-locations.read. Tokens
            are revoked if the owner is terminated, or unused for 30 days.
          </Text>
          <Pressable style={styles.linkRow} onPress={() => Linking.openURL(RIPPLING_API_TOKENS_URL)}>
            <Ionicons name="open-outline" size={14} color={T.blue} />
            <Text style={styles.linkText}>Open API Tokens</Text>
          </Pressable>
          <TextInput
            style={styles.tokenInput}
            value={token}
            onChangeText={setToken}
            placeholder="UOCgmwb…"
            placeholderTextColor="#999"
            autoCapitalize="none"
            autoCorrect={false}
            multiline
          />
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
          <Pressable
            style={[styles.primaryButton, saving && styles.primaryButtonDisabled]}
            onPress={save}
            disabled={saving}
          >
            {saving ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryButtonText}>Save token</Text>
            )}
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function EmployeeDetail({ employee, onClose, compact, hours, hoursStatus, flow }) {
  if (!employee) {
    return (
      <EmptyState
        icon="people-outline"
        title="Rippling"
        body="Select someone to see their Rippling profile."
      />
    );
  }

  const Body = flow ? View : ScrollView;
  const bodyProps = flow
    ? { style: styles.detailFlow }
    : {
        style: styles.detailScroll,
        contentContainerStyle: styles.detailContent,
        showsVerticalScrollIndicator: false,
      };

  return (
    <Body {...bodyProps}>
      <PersonHero
        name={employee.name}
        title={employee.title}
        photoUrl={employee.photoUrl}
        statusLabel={employee.statusLabel}
        statusTone={statusTone(employee.status)}
        compact={compact}
        onClose={onClose}
        heading="Profile"
        clockedIn={Boolean(hours?.clockedIn)}
      />
      <FieldGroup
        title="Contact"
        fields={[
          { label: 'Work email', value: employee.workEmail },
          { label: 'Personal email', value: employee.personalEmail },
          { label: 'Phone', value: employee.phone },
        ]}
      />
      <FieldGroup
        title="Work"
        fields={[
          { label: 'Department', value: employee.department },
          { label: 'Teams', value: employee.teams.join(', ') },
          { label: 'Manager', value: employee.managerName },
          { label: 'Location', value: employee.location },
          { label: 'Employment', value: employee.employmentType },
          { label: 'Level', value: employee.level },
          { label: 'Start date', value: employee.startDateLabel },
          {
            label: 'End date',
            value: employee.status === WORKER_STATUS.TERMINATED ? employee.endDateLabel : '',
          },
          { label: 'Legal entity', value: employee.legalEntity },
          { label: 'Employee #', value: employee.employeeNumber },
        ]}
      />
      <FieldGroup
        title="Compensation"
        fields={[
          { label: 'Annual', value: employee.annualCompensation },
          { label: 'Hourly', value: employee.hourlyWage },
        ]}
      />
      <HoursSection hours={hours} status={hoursStatus} />
    </Body>
  );
}

function EmployeeRow({ employee, selected, onPress, last, hours }) {
  const subtitle = [employee.title, employee.department, employee.location].filter(Boolean).join(' · ');
  return (
    <MobileListRow
      title={employee.name}
      subtitle={subtitle || employee.workEmail}
      leading={
        <StaffAvatar
          uri={employee.photoUrl}
          name={employee.name}
          size={44}
          ring={hours?.clockedIn ? 'green' : undefined}
        />
      }
      trailing={<StatusPill label={employee.statusLabel} tone={statusTone(employee.status)} compact />}
      selected={selected}
      last={last}
      onPress={onPress}
    />
  );
}

function isCsvFile(file) {
  const name = String(file?.name || '');
  const type = String(file?.type || '').toLowerCase();
  return /\.csv$/i.test(name) || type.includes('csv') || type.includes('comma-separated');
}

function readFileText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.readAsText(file);
  });
}

function RipplingCsvDrop({ onImported }) {
  const inputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const acceptFiles = async (fileList) => {
    const incoming = Array.from(fileList || []);
    const csvs = incoming.filter(isCsvFile);
    const skipped = incoming.length - csvs.length;
    if (!csvs.length) {
      setNotice('');
      setError('Drop a CSV file.');
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const files = [];
      for (const file of csvs) {
        files.push({ name: file.name, csv: await readFileText(file) });
      }
      const result = await uploadRipplingCsvFiles(files);
      const rows = Number(result?.rows) || 0;
      const name = result?.attachment || csvs[csvs.length - 1].name;
      const skippedNote = skipped ? ` Skipped ${skipped} file${skipped === 1 ? '' : 's'} that were not CSV.` : '';
      setNotice(`${name} · ${rows} row${rows === 1 ? '' : 's'}.${skippedNote}`);
      await onImported?.();
    } catch (err) {
      setError(err?.message || 'Could not update from that CSV.');
    } finally {
      setBusy(false);
    }
  };

  if (Platform.OS !== 'web') {
    return (
      <View style={styles.dropCard}>
        <Text style={styles.reportTitle}>Drop a CSV</Text>
        <Text style={styles.reportMeta}>Open Rippling in the web app to drop a CSV file.</Text>
      </View>
    );
  }

  return (
    <View style={styles.dropCard}>
      {createElement('input', {
        ref: inputRef,
        type: 'file',
        accept: '.csv,text/csv',
        multiple: true,
        style: { display: 'none' },
        onChange: (event) => {
          const list = event.target.files;
          event.target.value = '';
          if (list?.length) void acceptFiles(list);
        },
      })}
      {createElement(
        'div',
        {
          onDragEnter: (event) => {
            event.preventDefault();
            setDragOver(true);
          },
          onDragOver: (event) => {
            event.preventDefault();
            setDragOver(true);
          },
          onDragLeave: (event) => {
            event.preventDefault();
            setDragOver(false);
          },
          onDrop: (event) => {
            event.preventDefault();
            setDragOver(false);
            if (!busy) void acceptFiles(event.dataTransfer?.files);
          },
          onClick: () => {
            if (!busy) inputRef.current?.click();
          },
          role: 'button',
          'aria-label': 'Drop CSV files',
          style: {
            minHeight: 88,
            borderRadius: 10,
            border: `1.5px dashed ${dragOver ? T.blue : '#C7C7CC'}`,
            background: dragOver ? 'rgba(0,122,255,0.08)' : '#F7F7F8',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: busy ? 'progress' : 'pointer',
            padding: 16,
            textAlign: 'center',
          },
        },
        createElement(
          'div',
          null,
          createElement(
            'div',
            { style: { fontFamily: FONT, fontSize: 15, fontWeight: 600, color: T.text } },
            busy ? 'Updating…' : 'Drop CSV files here',
          ),
          createElement(
            'div',
            { style: { fontFamily: FONT, fontSize: 13, color: T.secondary, marginTop: 4 } },
            'or click to choose. Email attachments update this too. The newest file is what you see.',
          ),
        ),
      )}
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      {notice ? <Text style={styles.noticeText}>{notice}</Text> : null}
    </View>
  );
}

function ReportTable({ children }) {
  if (Platform.OS === 'web') {
    return createElement(
      'div',
      {
        style: {
          overflowX: 'auto',
          overflowY: 'visible',
          maxWidth: '100%',
          WebkitOverflowScrolling: 'touch',
        },
      },
      children,
    );
  }
  return (
    <ScrollView horizontal contentContainerStyle={styles.reportTable}>
      {children}
    </ScrollView>
  );
}

function CsvFileList({ files }) {
  const list = Array.isArray(files) ? files : [];
  if (!list.length) return null;
  return (
    <View style={styles.reportCard}>
      <Text style={styles.reportTitle}>Latest CSV files</Text>
      {list.map((file, index) => (
        <View key={file.id || `${file.name}-${index}`} style={index === list.length - 1 ? null : styles.fileRow}>
          <Text style={styles.fileName} numberOfLines={1}>{file.name}</Text>
          <Text style={styles.reportMeta}>
            {[
              file.source === 'drop' ? 'Dropped in the app' : 'Email',
              file.receivedAt ? formatRelativeTime(file.receivedAt) : '',
              file.rowCount ? `${file.rowCount} rows` : '',
              file.current ? 'Showing now' : '',
            ].filter(Boolean).join(' · ')}
          </Text>
        </View>
      ))}
    </View>
  );
}

function RipplingReport({ report, status }) {
  const watching = Boolean(status?.savedMailbox || status?.connected);
  const headers = Array.isArray(report?.headers) ? report.headers : [];
  const allRows = Array.isArray(report?.rows) ? report.rows : [];
  if (!watching && !headers.length) return null;

  const rows = allRows.slice(0, REPORT_ROW_LIMIT);
  const when = report?.receivedAt ? formatRelativeTime(report.receivedAt) : '';
  const title = report?.subject || 'Latest Rippling email';
  const meta = [
    report?.attachmentName,
    report?.rowCount ? `${report.rowCount} row${report.rowCount === 1 ? '' : 's'}` : '',
    when ? `received ${when}` : '',
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <View style={styles.reportCard}>
      <Text style={styles.reportTitle}>{headers.length ? title : `Watching ${status?.email || 'the hours inbox'}`}</Text>
      <Text style={styles.reportMeta}>
        {headers.length
          ? meta || 'Latest CSV attachment'
          : 'Signed in. A new email attachment or a CSV you drop here replaces what this screen shows.'}
      </Text>
      {headers.length ? (
        <ReportTable>
          <View>
            <View style={styles.reportHead}>
              {headers.map((header, index) => (
                <Text key={`h-${index}`} style={styles.reportHeadCell} numberOfLines={2}>
                  {header || ' '}
                </Text>
              ))}
            </View>
            {rows.length ? (
              rows.map((line, rowIndex) => (
                <View key={`r-${rowIndex}`} style={styles.reportRow}>
                  {headers.map((_, index) => (
                    <Text key={`c-${rowIndex}-${index}`} style={styles.reportCell} numberOfLines={2}>
                      {line[index] || ' '}
                    </Text>
                  ))}
                </View>
              ))
            ) : (
              <Text style={styles.reportMeta}>The file had headers and no data rows.</Text>
            )}
            {report?.rowCount > rows.length ? (
              <Text style={styles.reportMeta}>{`Showing ${rows.length} of ${report.rowCount} rows.`}</Text>
            ) : null}
          </View>
        </ReportTable>
      ) : null}
    </View>
  );
}

function RipplingPanel({ profile, hours }) {
  const isMobile = useIsMobile();
  const { canFilter } = useAppAccess();
  const allowFilters = canFilter('employees');
  const hoursSummary = hours?.summary || null;
  const hoursStatus = hours?.status || null;
  const reportCard = <RipplingReport report={hours?.report} status={hoursStatus} />;
  const fileList = <CsvFileList files={hours?.files} />;
  const csvDrop = canManageHoursFeed(profile) ? (
    <RipplingCsvDrop onImported={() => hours?.refresh?.({ sync: false })} />
  ) : null;
  const hoursCard = canManageHoursFeed(profile) ? (
    <HoursFeedCard
      status={hoursStatus}
      loading={Boolean(hours?.loading)}
      onStatusChange={hours?.setStatus}
      onRefresh={hours?.refresh}
    />
  ) : null;
  const hoursFor = (employee) =>
    employee ? hoursForPerson(hoursSummary, { ripplingId: employee.id, names: [employee.name] }) : null;
  const [session, setSession] = useState(null);
  const [employees, setEmployees] = useState([]);
  const [company, setCompany] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState(WORKER_STATUS.ACTIVE);
  const [department, setDepartment] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [connectOpen, setConnectOpen] = useState(false);
  const [bootstrapped, setBootstrapped] = useState(false);
  const requestId = useRef(0);
  const canManage = canManageCompanyRippling(profile);
  const usesCompany = session?.source === 'company';
  const ripplingToken = usesCompany ? undefined : session?.token;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const app = await loadRipplingOAuthApp();
        if (cancelled) return;
        if (app.connected) {
          setSession({
            token: '',
            source: 'company',
            companyName: app.companyName,
            savedAt: Date.now(),
          });
          setBootstrapped(true);
          return;
        }
      } catch {
        // Fall through to a personal session if the company status call fails.
      }
      const next = await loadRipplingSession();
      if (cancelled) return;
      setSession(next);
      setBootstrapped(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const load = useCallback(async () => {
    if (!usesCompany && !session?.token) {
      setEmployees([]);
      setCompany(null);
      setError('');
      setLoading(false);
      return;
    }

    const id = ++requestId.current;
    setLoading(true);
    setError('');

    try {
      const [result, companyInfo] = await Promise.all([
        fetchEmployees(ripplingToken, {
          status: statusFilter === 'ALL' ? undefined : statusFilter,
        }),
        fetchRipplingCompany(ripplingToken).catch(() => null),
      ]);
      if (id !== requestId.current) return;
      setEmployees(result.employees);
      setCompany(companyInfo);
      setSelectedId((current) => {
        if (current && result.employees.some((row) => row.id === current)) return current;
        return null;
      });
    } catch (err) {
      if (id !== requestId.current) return;
      setEmployees([]);
      setCompany(null);
      setError(err?.message || 'Failed to load employees from Rippling.');
      if (err?.status === 401) {
        setSession((current) => (current ? { ...current, expired: true } : current));
      }
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [ripplingToken, session?.token, statusFilter, usesCompany]);

  useEffect(() => {
    if (!bootstrapped) return;
    load();
  }, [bootstrapped, load]);

  useEffect(() => {
    if (!allowFilters) {
      setStatusFilter('ALL');
      setDepartment(null);
    }
  }, [allowFilters]);

  const departments = useMemo(() => {
    const names = new Set();
    for (const row of employees) {
      if (row.department) names.add(row.department);
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [employees]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return employees.filter((row) => {
      if (department && row.department !== department) return false;
      if (!q) return true;
      const haystack = [
        row.name,
        row.title,
        row.department,
        row.location,
        row.workEmail,
        row.managerName,
        row.teams.join(' '),
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [employees, query, department]);

  const selected = useMemo(
    () => filtered.find((row) => row.id === selectedId) || null,
    [filtered, selectedId],
  );

  const grouped = useMemo(
    () => groupRows(filtered, (row) => row.department || 'No department'),
    [filtered],
  );

  const disconnect = async () => {
    if (usesCompany) {
      await disconnectCompanyRippling();
    } else {
      await clearRipplingSession();
    }
    setSession(null);
    setEmployees([]);
    setCompany(null);
    setSelectedId(null);
    setError('');
  };

  const connected = (usesCompany || Boolean(session?.token)) && !session?.expired;

  if (!bootstrapped) {
    return (
      <View style={styles.body}>
        <View style={styles.centered}>
          <ActivityIndicator color={T.text} />
        </View>
      </View>
    );
  }

  return (
    <>
    <ScrollView
      style={styles.bodyScroll}
      contentContainerStyle={styles.pageContent}
      keyboardShouldPersistTaps="handled"
    >
      {hoursCard}
      {csvDrop}
      {fileList}
      {reportCard}
      {connected ? (
      <>
      <View style={styles.connectBar}>
        <View style={styles.connectInfo}>
          <Ionicons name="shield-checkmark-outline" size={18} color={T.green} />
          <View style={styles.connectCopy}>
            <Text style={styles.connectTitle}>
              Rippling · {company?.name || 'HR connected'}
            </Text>
            <Text style={styles.connectHint}>
              {`${employees.length} worker${employees.length === 1 ? '' : 's'} from the Rippling HR API`}
            </Text>
          </View>
        </View>
        <View style={styles.connectActions}>
          {connected && !session?.fromEnv && (!usesCompany || canManage) ? (
            <BarButton label="Disconnect" onPress={disconnect} />
          ) : null}
          <BarButton label="Refresh" onPress={load} disabled={loading} />
          {canManage ? (
            <BarButton
              label={session?.source === 'oauth' || usesCompany ? 'Reconnect' : 'Update token'}
              onPress={() => setConnectOpen(true)}
            />
          ) : null}
        </View>
      </View>

      <View style={styles.toolbar}>
        <SearchField
          value={query}
          onChangeText={setQuery}
          placeholder="Search name, title, department…"
          size={isMobile ? 'lg' : undefined}
          style={styles.searchField}
        />
      </View>

      {allowFilters ? (
        <View style={styles.filterRow}>
          {STATUS_FILTERS.map((filter) => (
            <Chip
              key={filter.key}
              label={filter.label}
              selected={statusFilter === filter.key}
              onPress={() => setStatusFilter(filter.key)}
              tone={
                filter.key === WORKER_STATUS.ACTIVE
                  ? 'green'
                  : filter.key === WORKER_STATUS.TERMINATED
                    ? 'red'
                    : undefined
              }
            />
          ))}
          {departments.length > 1 ? (
            <>
              <Chip label="All departments" selected={!department} onPress={() => setDepartment(null)} />
              {departments.map((name) => (
                <Chip
                  key={name}
                  label={name}
                  selected={department === name}
                  onPress={() => setDepartment((current) => (current === name ? null : name))}
                />
              ))}
            </>
          ) : null}
        </View>
      ) : null}

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      {loading && employees.length === 0 ? (
        <View style={styles.centered}>
          <ActivityIndicator color={T.text} />
        </View>
      ) : (
        <View style={styles.splitFlow}>
          <View style={styles.listPaneFlow}>
            <View style={styles.listContent}>
              {filtered.length === 0 ? (
                <EmptyState
                  icon="people-outline"
                  title="No workers"
                  body={
                    query.trim() || department
                      ? 'No employees match the current filters.'
                      : 'No workers returned from Rippling.'
                  }
                />
              ) : (
                grouped.map(([groupName, rows]) => (
                  <View key={groupName} style={styles.listGroup}>
                    <SectionLabel>
                      {groupName}
                      {` · ${rows.length}`}
                    </SectionLabel>
                    <MobileList>
                      {rows.map((employee, index) => (
                        <EmployeeRow
                          key={employee.id}
                          employee={employee}
                          hours={hoursFor(employee)}
                          last={index === rows.length - 1}
                          selected={!isMobile && selectedId === employee.id}
                          onPress={() => setSelectedId(employee.id)}
                        />
                      ))}
                    </MobileList>
                  </View>
                ))
              )}
            </View>
          </View>

          {!isMobile ? (
            <View style={styles.detailPaneFlow}>
              <EmployeeDetail flow employee={selected} hours={hoursFor(selected)} hoursStatus={hoursStatus} />
            </View>
          ) : null}
        </View>
      )}
      </>
      ) : null}
    </ScrollView>
    {isMobile ? (
      <Modal
        visible={Boolean(selected)}
        animationType="slide"
        onRequestClose={() => setSelectedId(null)}
      >
        <View
          style={styles.mobileDetail}
          {...(Platform.OS === 'web' ? { className: 'cgold-mobile-sheet-top' } : null)}
        >
          <EmployeeDetail
            employee={selected}
            hours={hoursFor(selected)}
            hoursStatus={hoursStatus}
            compact
            onClose={() => setSelectedId(null)}
          />
        </View>
      </Modal>
    ) : null}
    <ConnectModal
      visible={connectOpen}
      onClose={() => setConnectOpen(false)}
      canManage={canManage}
      onSaved={(next) => {
        setSession(next);
        setError('');
      }}
    />
    </>
  );
}

export default function EmployeesScreen({
  session,
  onProfileUpdated,
  storeFilter,
  embedded = false,
}) {
  const [activeTab, setActiveTab] = useState(() =>
    !embedded && (readRipplingOAuthCallback() || readHoursOAuthCallback()) ? 'rippling' : 'employees',
  );
  const hours = useHoursSummary(true);

  return (
    <View style={styles.screen}>
      {embedded ? null : (
        <TextTabs options={EMPLOYEE_TABS} value={activeTab} onChange={setActiveTab} size="lg" />
      )}
      {activeTab === 'employees' ? (
        <AppEmployeesPanel
          session={session}
          onProfileUpdated={onProfileUpdated}
          storeFilter={storeFilter}
          hours={hours}
        />
      ) : (
        <RipplingPanel profile={session?.profile} hours={hours} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    minHeight: 0,
    backgroundColor: '#F2F2F7',
  },
  body: {
    flex: 1,
    gap: 12,
    minHeight: 0,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  bodyScroll: {
    flex: 1,
    minHeight: 0,
    ...Platform.select({
      web: { overflowY: 'auto' },
    }),
  },
  pageContent: {
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 48,
  },
  rowInactive: {
    opacity: 0.55,
  },
  dropCard: {
    gap: 8,
  },
  reportCard: {
    gap: 8,
    padding: 14,
    borderRadius: 12,
    backgroundColor: T.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: T.hairline,
  },
  reportTitle: {
    fontFamily: FONT,
    fontSize: 16,
    fontWeight: '600',
    color: T.text,
    letterSpacing: -0.2,
  },
  fileRow: {
    paddingBottom: 8,
    marginBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: T.hairline,
  },
  fileName: {
    fontFamily: FONT,
    fontSize: 14,
    fontWeight: '600',
    color: T.text,
  },
  reportMeta: {
    fontFamily: FONT,
    fontSize: 13,
    lineHeight: 18,
    color: T.secondary,
  },
  reportTable: {
    paddingBottom: 4,
  },
  reportHead: {
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: T.hairline,
  },
  reportHeadCell: {
    width: 148,
    paddingVertical: 8,
    paddingRight: 12,
    fontFamily: FONT,
    fontSize: 12,
    fontWeight: '600',
    color: T.secondary,
  },
  reportRow: {
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: T.hairline,
  },
  reportCell: {
    width: 148,
    paddingVertical: 8,
    paddingRight: 12,
    fontFamily: FONT,
    fontSize: 13,
    lineHeight: 18,
    color: T.text,
  },
  connectBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    padding: 14,
    borderRadius: 12,
    backgroundColor: T.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: T.hairline,
    flexWrap: 'wrap',
  },
  connectInfo: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    flex: 1,
    minWidth: 220,
  },
  connectCopy: {
    flex: 1,
    gap: 2,
  },
  connectTitle: {
    fontFamily: FONT,
    fontSize: 15,
    fontWeight: '600',
    color: T.text,
    letterSpacing: -0.2,
  },
  connectHint: {
    fontFamily: FONT,
    fontSize: 13,
    color: T.secondary,
  },
  connectActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  toolbar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  searchField: {
    flex: 1,
    minWidth: 220,
  },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  split: {
    flex: 1,
    minHeight: 0,
    flexDirection: 'row',
    gap: 16,
  },
  splitFlow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 16,
    width: '100%',
  },
  listPane: {
    flex: 1.35,
    minWidth: 0,
    minHeight: 0,
  },
  listPaneFlow: {
    flex: 1.35,
    minWidth: 0,
  },
  list: {
    flex: 1,
    minHeight: 0,
    ...Platform.select({
      web: { overflowY: 'auto' },
    }),
  },
  listContent: {
    paddingBottom: 32,
    gap: 4,
  },
  listGroup: {
    marginBottom: 8,
  },
  detailPane: {
    flex: 1,
    minWidth: 280,
    maxWidth: 400,
    minHeight: 0,
  },
  detailPaneFlow: {
    flex: 1,
    minWidth: 280,
    maxWidth: 400,
  },
  detailScroll: {
    flex: 1,
    minHeight: 0,
    ...Platform.select({
      web: { overflowY: 'auto' },
    }),
  },
  detailFlow: {
    width: '100%',
  },
  detailContent: {
    paddingBottom: 40,
  },
  cardBlock: {
    marginTop: 8,
  },
  heroCard: {
    alignItems: 'center',
    paddingVertical: 22,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: T.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: T.hairline,
    gap: 6,
  },
  heroName: {
    fontFamily: FONT,
    fontSize: 22,
    fontWeight: '700',
    color: T.text,
    letterSpacing: -0.4,
    textAlign: 'center',
    marginTop: 8,
  },
  heroTitle: {
    fontFamily: FONT,
    fontSize: 15,
    color: T.secondary,
    textAlign: 'center',
  },
  heroPills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 6,
  },
  detailMobileHeader: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  detailMobileTitle: {
    fontFamily: FONT,
    fontSize: 17,
    fontWeight: '600',
    color: T.text,
    letterSpacing: -0.3,
  },
  mobileDetail: {
    flex: 1,
    backgroundColor: '#F2F2F7',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 56 : 20,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
  },
  errorText: {
    fontFamily: FONT,
    fontSize: 13,
    color: T.red,
  },
  noticeText: {
    fontFamily: FONT,
    fontSize: 13,
    color: T.green,
  },
  hoursUpdated: {
    fontFamily: FONT,
    fontSize: 12,
    color: T.tertiary,
  },
  hoursNow: {
    marginBottom: 8,
  },
  hoursDay: {
    marginTop: 12,
  },
  hoursDayTitle: {
    fontFamily: FONT,
    fontSize: 13,
    fontWeight: '600',
    color: T.secondary,
    marginBottom: 6,
  },
  hoursMore: {
    paddingVertical: 10,
  },
  hoursMoreText: {
    fontFamily: FONT,
    fontSize: 14,
    color: T.blue,
  },
  primaryButton: {
    backgroundColor: T.blue,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    alignItems: 'center',
    alignSelf: 'flex-start',
  },
  primaryButtonDisabled: {
    opacity: 0.6,
  },
  primaryButtonText: {
    fontFamily: FONT,
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },
  secondaryButton: {
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: T.fillSoft,
  },
  secondaryButtonText: {
    fontFamily: FONT,
    fontSize: 15,
    fontWeight: '500',
    color: T.secondary,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    width: '100%',
    maxWidth: 480,
    backgroundColor: T.card,
    borderRadius: 14,
    padding: 16,
    gap: 10,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  modalTitle: {
    fontFamily: FONT,
    fontSize: 17,
    fontWeight: '600',
    color: T.text,
    letterSpacing: -0.3,
  },
  modalBody: {
    fontFamily: FONT,
    fontSize: 15,
    lineHeight: 20,
    color: T.secondary,
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  linkText: {
    fontFamily: FONT,
    fontSize: 15,
    color: T.blue,
    fontWeight: '500',
  },
  tokenInput: {
    minHeight: 96,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: T.hairline,
    borderRadius: 10,
    padding: 10,
    fontFamily: Platform.select({
      ios: 'SohneMono',
      android: 'SohneMono',
      default: 'SohneMono',
    }),
    fontSize: 13,
    color: T.text,
    textAlignVertical: 'top',
  },
});
