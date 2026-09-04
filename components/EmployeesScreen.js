import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Linking,
  Modal,
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
import {
  RIPPLING_API_TOKENS_URL,
  WORKER_STATUS,
  buildRipplingAuthorizeUrl,
  clearRipplingOAuthCallbackFromUrl,
  clearRipplingOAuthState,
  clearRipplingSession,
  createRipplingOAuthState,
  exchangeRipplingOAuthCode,
  fetchEmployees,
  fetchRipplingCompany,
  getRipplingRedirectUri,
  initialsFor,
  loadRipplingOAuthApp,
  loadRipplingSession,
  persistRipplingOAuthState,
  readRipplingOAuthCallback,
  readRipplingOAuthState,
  saveRipplingSession,
} from '../lib/rippling';
import { syncStaffRoles } from '../lib/auth';
import { fetchAureusEmployees, mergeEmployeesWithProfiles } from '../lib/aureusEmployees';
import { categoryLabel, listStaffProfiles, useAppAccess } from '../lib/permissions';

const fontFamily = Platform.select({
  ios: 'Sohne',
  android: 'Sohne',
  default: 'Sohne',
});

const ACCENT = '#1D4ED8';
const ACCENT_SOFT = '#EFF6FF';
const MOBILE_BREAKPOINT = 768;

const STATUS_FILTERS = [
  { key: WORKER_STATUS.ACTIVE, label: 'Active' },
  { key: 'ALL', label: 'All' },
  { key: WORKER_STATUS.TERMINATED, label: 'Terminated' },
];

const EMPLOYEE_TABS = [
  { key: 'employees', label: 'Employees' },
  { key: 'rippling', label: 'Rippling' },
];

function statusColor(status) {
  switch (status) {
    case WORKER_STATUS.ACTIVE:
      return '#2F8A4E';
    case WORKER_STATUS.TERMINATED:
      return '#B91C1C';
    case WORKER_STATUS.HIRED:
    case WORKER_STATUS.ACCEPTED:
      return ACCENT;
    default:
      return '#6b6b6b';
  }
}

function Avatar({ employee, size = 36 }) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [employee.photoUrl]);
  const showImage = Boolean(employee.photoUrl) && !failed;
  return (
    <View
      style={[
        styles.avatar,
        { width: size, height: size, borderRadius: size / 2 },
        !showImage && styles.avatarFallback,
      ]}
    >
      {showImage ? (
        <Image
          source={{ uri: employee.photoUrl }}
          style={{ width: size, height: size, borderRadius: size / 2 }}
          onError={() => setFailed(true)}
        />
      ) : (
        <Text style={[styles.avatarInitials, { fontSize: size > 40 ? 16 : 12 }]}>
          {employee.initials}
        </Text>
      )}
    </View>
  );
}

function TabBar({ options, value, onChange }) {
  return (
    <View style={styles.tabBar} accessibilityRole="tablist">
      {options.map((option) => {
        const active = option.key === value;
        return (
          <Pressable
            key={option.key}
            style={[styles.tab, active && styles.tabActive]}
            onPress={() => onChange(option.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={option.label}
          >
            <Text style={[styles.tabLabel, active && styles.tabLabelActive]} numberOfLines={1}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
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

function StaffEmployeeRow({ person, compact, selected, onPress }) {
  const name = staffDisplayName(person);
  const permission = permissionLabel(person);
  const location = person.locationName || '—';
  const type = employeeTypeLabel(person);
  const inactive = person.isActive === false || person.profileActive === false;

  return (
    <Pressable
      onPress={onPress}
      style={[styles.row, selected && styles.rowSelected, inactive && styles.rowInactive]}
      {...(Platform.OS === 'web' ? { className: 'cgold-filter-option' } : null)}
    >
      <View style={styles.colName}>
        <Avatar employee={{ photoUrl: person.avatarUrl || person.photoUrl, initials: initialsFor(name) }} size={32} />
        <View style={styles.nameWrap}>
          <Text style={styles.nameText} numberOfLines={1}>
            {name}
            {inactive ? ' · Inactive' : ''}
          </Text>
          <Text style={styles.emailText} numberOfLines={1}>
            {compact
              ? [location, type, permission].filter((value) => value && value !== '—').join(' · ')
              : person.email || person.aureusLogin}
          </Text>
        </View>
      </View>
      {compact ? (
        <Ionicons name="chevron-forward" size={16} color="#c4c4c4" />
      ) : (
        <>
          <Text style={[styles.cell, styles.colAppLocation]} numberOfLines={1}>
            {location}
          </Text>
          <Text style={[styles.cell, styles.colAppType]} numberOfLines={1}>
            {type}
          </Text>
          <Text style={[styles.cell, styles.colAppPermission]} numberOfLines={1}>
            {permission}
          </Text>
        </>
      )}
    </Pressable>
  );
}

function StaffEmployeeDetail({ person, onClose, compact }) {
  if (!person) {
    return (
      <View style={styles.detailEmpty}>
        <Ionicons name="people-outline" size={28} color="#c4c4c4" />
        <Text style={styles.detailEmptyText}>Select an employee to see their Aureus profile.</Text>
      </View>
    );
  }

  const name = staffDisplayName(person);
  return (
    <ScrollView
      style={styles.detailScroll}
      contentContainerStyle={styles.detailContent}
      showsVerticalScrollIndicator={false}
    >
      {compact ? (
        <View style={styles.detailMobileHeader}>
          <Text style={styles.detailMobileTitle}>Employee</Text>
          <Pressable onPress={onClose} hitSlop={8}>
            <Ionicons name="close" size={18} color="#6b6b6b" />
          </Pressable>
        </View>
      ) : null}

      <View style={styles.detailHero}>
        <Avatar employee={{ photoUrl: person.avatarUrl || person.photoUrl, initials: initialsFor(name) }} size={64} />
        <View style={styles.detailHeroText}>
          <Text style={styles.detailName}>{name}</Text>
          <Text style={styles.detailTitle}>{employeeTypeLabel(person)}</Text>
          {person.role && person.role !== person.employeeType ? (
            <Text style={styles.statusText}>{person.role}</Text>
          ) : null}
        </View>
      </View>

      <DetailField label="Default location" value={person.locationName} />
      <DetailField label="Employee type" value={person.employeeType} />
      <DetailField label="Aureus role" value={person.role && person.role !== person.employeeType ? person.role : ''} />
      <DetailField label="Permission" value={person.hasSignedIn ? permissionLabel(person) : 'Has not signed in to myCanadaGold'} />
      <DetailField label="Work email" value={person.email} />
      <DetailField label="Aureus login" value={person.aureusLogin} />
      <DetailField label="Phone" value={person.phone} />
    </ScrollView>
  );
}

function AppEmployeesPanel({ session, onProfileUpdated }) {
  const { width } = useWindowDimensions();
  const isMobile = width < MOBILE_BREAKPOINT;
  const { canFilter } = useAppAccess();
  const allowFilters = canFilter('employees');
  const [people, setPeople] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [location, setLocation] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const onProfileUpdatedRef = useRef(onProfileUpdated);
  onProfileUpdatedRef.current = onProfileUpdated;

  const load = useCallback(async () => {
    if (!session?.token) {
      setPeople([]);
      setError('Sign in to load employees from Aureus.');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');
    try {
      const employees = await fetchAureusEmployees(session.token, session.baseUrl);
      try {
        const synced = await syncStaffRoles(session);
        if (synced?.profile?.id) onProfileUpdatedRef.current?.(synced.profile);
      } catch {
        // Directory still loads if role sync is unavailable.
      }
      const profiles = await listStaffProfiles().catch(() => []);
      const rows = mergeEmployeesWithProfiles(employees, profiles);
      setPeople(rows);
      setSelectedId((current) => {
        if (current && rows.some((row) => row.id === current)) return current;
        return null;
      });
    } catch (err) {
      try {
        const profiles = await listStaffProfiles();
        setPeople(mergeEmployeesWithProfiles([], profiles));
        setError(err?.message || 'Could not load employees from Aureus.');
      } catch {
        setPeople([]);
        setError(err?.message || 'Could not load employees from Aureus.');
      }
    } finally {
      setLoading(false);
    }
  }, [session?.token, session?.baseUrl]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!allowFilters) setLocation(null);
  }, [allowFilters]);

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
      if (location && row.locationName !== location) return false;
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
  }, [people, query, location]);

  const selected = useMemo(
    () => filtered.find((row) => row.id === selectedId) || null,
    [filtered, selectedId],
  );

  return (
    <View style={styles.body}>
      <View style={styles.toolbar}>
        <View style={styles.search}>
          <Ionicons name="search-outline" size={15} color="#8a8a8a" style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="Search name, location, type…"
            placeholderTextColor="#999"
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="while-editing"
          />
          {query ? (
            <Pressable onPress={() => setQuery('')} hitSlop={8}>
              <Ionicons name="close-circle" size={15} color="#b0b0b0" />
            </Pressable>
          ) : null}
        </View>
        <Pressable style={styles.secondaryButton} onPress={load} disabled={loading}>
          <Text style={styles.secondaryButtonText}>Refresh</Text>
        </Pressable>
      </View>

      {allowFilters && locations.length > 1 ? (
        <View style={styles.filterRow}>
          <Pressable
            style={[styles.filterChip, !location && styles.filterChipActive]}
            onPress={() => setLocation(null)}
          >
            <Text style={[styles.filterChipText, !location && styles.filterChipTextActive]}>All locations</Text>
          </Pressable>
          {locations.map((name) => (
            <Pressable
              key={name}
              style={[styles.filterChip, location === name && styles.filterChipActive]}
              onPress={() => setLocation((current) => (current === name ? null : name))}
            >
              <Text style={[styles.filterChipText, location === name && styles.filterChipTextActive]}>
                {name}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <Text style={styles.directoryHint}>
        Aureus POS employees
        {people.length ? ` · ${people.length}` : ''}
      </Text>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      {loading && people.length === 0 ? (
        <View style={styles.centered}>
          <ActivityIndicator color="#1a1a1a" />
        </View>
      ) : (
        <View style={styles.split}>
          <View style={styles.tableWrap}>
            {!isMobile ? (
              <View style={[styles.row, styles.headerRow]}>
                <Text style={[styles.headerText, styles.colName]}>Name</Text>
                <Text style={[styles.headerText, styles.colAppLocation]}>Default location</Text>
                <Text style={[styles.headerText, styles.colAppType]}>Employee type</Text>
                <Text style={[styles.headerText, styles.colAppPermission]}>Permission</Text>
              </View>
            ) : null}
            <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
              {filtered.length === 0 ? (
                <View style={styles.empty}>
                  <Text style={styles.emptyText}>
                    {query.trim() || location
                      ? 'No employees match the current filters.'
                      : 'No employees returned from Aureus.'}
                  </Text>
                </View>
              ) : (
                filtered.map((person) => (
                  <StaffEmployeeRow
                    key={person.id}
                    person={person}
                    compact={isMobile}
                    selected={!isMobile && selectedId === person.id}
                    onPress={() => setSelectedId(person.id)}
                  />
                ))
              )}
            </ScrollView>
          </View>

          {!isMobile ? (
            <View style={styles.detailPane}>
              <StaffEmployeeDetail person={selected} />
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
            <StaffEmployeeDetail person={selected} compact onClose={() => setSelectedId(null)} />
          </View>
        </Modal>
      ) : null}
    </View>
  );
}

function SignInCard({ onConnected }) {
  // null = still loading; { clientId, configured } once the proxy answers.
  const [oauthApp, setOauthApp] = useState(null);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [showToken, setShowToken] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const app = await loadRipplingOAuthApp();
        if (!cancelled) setOauthApp(app);
      } catch {
        if (!cancelled) setOauthApp({ clientId: '', configured: false });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const callback = readRipplingOAuthCallback();
    if (!callback) return;

    let cancelled = false;
    (async () => {
      setBusy('oauth');
      setError('');
      try {
        if (callback.error) {
          throw new Error(callback.errorDescription || callback.error || 'Rippling sign-in was cancelled.');
        }
        const expected = readRipplingOAuthState();
        if (!expected || !callback.state || expected !== callback.state) {
          throw new Error('Rippling sign-in state did not match. Try again.');
        }
        const session = await exchangeRipplingOAuthCode({
          code: callback.code,
          redirectUri: getRipplingRedirectUri(),
        });
        clearRipplingOAuthState();
        clearRipplingOAuthCallbackFromUrl();
        if (!cancelled) onConnected(session);
      } catch (err) {
        clearRipplingOAuthCallbackFromUrl();
        if (!cancelled) setError(err?.message || 'Rippling sign-in failed.');
      } finally {
        if (!cancelled) setBusy('');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [onConnected]);

  const signInWithRippling = async () => {
    const redirectUri = getRipplingRedirectUri();
    if (!redirectUri) {
      setError('Sign in with Rippling is available in the web app.');
      return;
    }
    if (!oauthApp?.configured || !oauthApp.clientId) {
      setError(
        'Rippling sign-in is not set up yet. A system admin needs to add the Rippling OAuth app to the server. You can still connect with an API token below.',
      );
      return;
    }

    setBusy('oauth');
    setError('');
    try {
      const state = createRipplingOAuthState();
      persistRipplingOAuthState(state);
      const url = buildRipplingAuthorizeUrl({
        clientId: oauthApp.clientId,
        redirectUri,
        state,
      });
      if (typeof window !== 'undefined') {
        window.location.assign(url);
        return;
      }
      await Linking.openURL(url);
    } catch (err) {
      setError(err?.message || 'Could not start Rippling sign-in.');
      setBusy('');
    }
  };

  const saveToken = async () => {
    setBusy('token');
    setError('');
    try {
      const session = await saveRipplingSession({ token });
      onConnected(session);
    } catch (err) {
      setError(err?.message || 'Could not save Rippling token.');
    } finally {
      setBusy('');
    }
  };

  return (
    <View style={styles.signInCard}>
      <View style={styles.signInIcon}>
        <Ionicons name="people-outline" size={22} color={ACCENT} />
      </View>
      <Text style={styles.signInTitle}>Sign in to Rippling</Text>
      <Text style={styles.signInBody}>
        Rippling does not let this app host their email and password form. Sign in opens
        Rippling’s own login page — type your Rippling email and password there, then you’ll
        come back connected.
      </Text>

      {oauthApp && !oauthApp.configured ? (
        <Text style={styles.fieldHint}>
          Rippling sign-in is not set up on the server yet. Connect with an API token below, or
          ask a system admin to add the Rippling OAuth app.
        </Text>
      ) : null}

      <Pressable
        style={[
          styles.primaryButton,
          (Boolean(busy) || !oauthApp?.configured) && styles.primaryButtonDisabled,
        ]}
        onPress={signInWithRippling}
        disabled={Boolean(busy) || !oauthApp?.configured}
      >
        {busy === 'oauth' ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.primaryButtonText}>Sign in with Rippling</Text>
        )}
      </Pressable>

      <Pressable onPress={() => setShowToken((current) => !current)} style={styles.orRow}>
        <Text style={styles.orText}>
          {showToken ? 'Hide API token' : 'Or connect with an API token'}
        </Text>
      </Pressable>

      {showToken ? (
        <>
          <Text style={styles.signInBody}>
            Tools → Developer → API Tokens. Paste the token only — the app sends Authorization:
            Bearer for you. Include workers.read. Unused tokens expire after 30 days.
          </Text>
          <Pressable style={styles.linkRow} onPress={() => Linking.openURL(RIPPLING_API_TOKENS_URL)}>
            <Ionicons name="open-outline" size={14} color={ACCENT} />
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
            editable={!busy}
          />
          <Pressable
            style={[styles.secondaryButton, Boolean(busy) && styles.primaryButtonDisabled]}
            onPress={saveToken}
            disabled={Boolean(busy)}
          >
            {busy === 'token' ? (
              <ActivityIndicator color={ACCENT} />
            ) : (
              <Text style={[styles.secondaryButtonText, { color: ACCENT }]}>Connect with token</Text>
            )}
          </Pressable>
        </>
      ) : null}

      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  );
}

function ConnectModal({ visible, onClose, onSaved }) {
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
      const session = await saveRipplingSession({ token });
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
            <Ionicons name="open-outline" size={14} color={ACCENT} />
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

function DetailField({ label, value }) {
  if (!value) return null;
  return (
    <View style={styles.detailField}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

function EmployeeDetail({ employee, onClose, compact }) {
  if (!employee) {
    return (
      <View style={styles.detailEmpty}>
        <Ionicons name="people-outline" size={28} color="#c4c4c4" />
        <Text style={styles.detailEmptyText}>Select an employee to see their Rippling profile.</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.detailScroll}
      contentContainerStyle={styles.detailContent}
      showsVerticalScrollIndicator={false}
    >
      {compact ? (
        <View style={styles.detailMobileHeader}>
          <Text style={styles.detailMobileTitle}>Profile</Text>
          <Pressable onPress={onClose} hitSlop={8}>
            <Ionicons name="close" size={18} color="#6b6b6b" />
          </Pressable>
        </View>
      ) : null}

      <View style={styles.detailHero}>
        <Avatar employee={employee} size={64} />
        <View style={styles.detailHeroText}>
          <Text style={styles.detailName}>{employee.name}</Text>
          <Text style={styles.detailTitle}>{employee.title || '—'}</Text>
          <Text style={[styles.statusText, { color: statusColor(employee.status) }]}>
            {employee.statusLabel}
          </Text>
        </View>
      </View>

      <DetailField label="Work email" value={employee.workEmail} />
      <DetailField label="Personal email" value={employee.personalEmail} />
      <DetailField label="Phone" value={employee.phone} />
      <DetailField label="Department" value={employee.department} />
      <DetailField label="Teams" value={employee.teams.join(', ')} />
      <DetailField label="Manager" value={employee.managerName} />
      <DetailField label="Location" value={employee.location} />
      <DetailField label="Employment" value={employee.employmentType} />
      <DetailField label="Level" value={employee.level} />
      <DetailField label="Start date" value={employee.startDateLabel} />
      <DetailField
        label="End date"
        value={employee.status === WORKER_STATUS.TERMINATED ? employee.endDateLabel : ''}
      />
      <DetailField label="Legal entity" value={employee.legalEntity} />
      <DetailField label="Employee #" value={employee.employeeNumber} />
      <DetailField label="Annual compensation" value={employee.annualCompensation} />
      <DetailField label="Hourly wage" value={employee.hourlyWage} />
    </ScrollView>
  );
}

function EmployeeRow({ employee, selected, onPress, compact }) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.row, selected && styles.rowSelected]}
      {...(Platform.OS === 'web' ? { className: 'cgold-filter-option' } : null)}
    >
      <View style={styles.colName}>
        <Avatar employee={employee} size={32} />
        <View style={styles.nameWrap}>
          <Text style={styles.nameText} numberOfLines={1}>
            {employee.name}
          </Text>
          <Text style={styles.emailText} numberOfLines={1}>
            {compact
              ? [employee.title, employee.department].filter(Boolean).join(' · ') || employee.workEmail
              : employee.workEmail}
          </Text>
        </View>
      </View>
      {compact ? (
        <Ionicons name="chevron-forward" size={16} color="#c4c4c4" />
      ) : (
        <>
          <Text style={[styles.cell, styles.colTitle]} numberOfLines={1}>
            {employee.title || '—'}
          </Text>
          <Text style={[styles.cell, styles.colDept]} numberOfLines={1}>
            {employee.department || '—'}
          </Text>
          <Text style={[styles.cell, styles.colLocation]} numberOfLines={1}>
            {employee.location || '—'}
          </Text>
          <Text
            style={[styles.cell, styles.colStatus, { color: statusColor(employee.status) }]}
            numberOfLines={1}
          >
            {employee.statusLabel}
          </Text>
        </>
      )}
    </Pressable>
  );
}

function RipplingPanel() {
  const { width } = useWindowDimensions();
  const isMobile = width < MOBILE_BREAKPOINT;
  const { canFilter } = useAppAccess();
  const allowFilters = canFilter('employees');
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

  useEffect(() => {
    let cancelled = false;
    (async () => {
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
    if (!session?.token) {
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
        fetchEmployees(session.token, {
          status: statusFilter === 'ALL' ? undefined : statusFilter,
        }),
        fetchRipplingCompany(session.token).catch(() => null),
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
  }, [session?.token, statusFilter]);

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

  const disconnect = async () => {
    await clearRipplingSession();
    setSession(null);
    setEmployees([]);
    setCompany(null);
    setSelectedId(null);
    setError('');
  };

  const handleConnected = useCallback((next) => {
    setSession(next);
    setError('');
  }, []);

  const connected = Boolean(session?.token) && !session?.expired;

  if (!bootstrapped) {
    return (
      <View style={styles.body}>
        <View style={styles.centered}>
          <ActivityIndicator color="#1a1a1a" />
        </View>
      </View>
    );
  }

  if (!connected) {
    return (
      <View style={styles.body}>
        <SignInCard onConnected={handleConnected} />
      </View>
    );
  }

  return (
    <View style={styles.body}>
      <View style={styles.connectBar}>
        <View style={styles.connectInfo}>
          <Ionicons
            name={connected ? 'shield-checkmark-outline' : 'people-outline'}
            size={16}
            color={connected ? '#2F8A4E' : ACCENT}
          />
          <View style={styles.connectCopy}>
            <Text style={styles.connectTitle}>
              {connected
                ? `Rippling · ${company?.name || 'HR connected'}`
                : session?.expired
                  ? 'Rippling token rejected'
                  : 'Rippling not connected'}
            </Text>
            <Text style={styles.connectHint}>
              {connected
                ? `${employees.length} worker${employees.length === 1 ? '' : 's'} from the Rippling HR API`
                : 'Connect with a Rippling API token from Tools → Developer → API Tokens.'}
            </Text>
          </View>
        </View>
        <View style={styles.connectActions}>
          {connected && !session?.fromEnv ? (
            <Pressable style={styles.secondaryButton} onPress={disconnect}>
              <Text style={styles.secondaryButtonText}>Disconnect</Text>
            </Pressable>
          ) : null}
          {connected ? (
            <Pressable style={styles.secondaryButton} onPress={load} disabled={loading}>
              <Text style={styles.secondaryButtonText}>Refresh</Text>
            </Pressable>
          ) : null}
          <Pressable style={styles.primaryButtonCompact} onPress={() => setConnectOpen(true)}>
            <Text style={styles.primaryButtonText}>
              {session?.source === 'oauth' ? 'Reconnect' : 'Update token'}
            </Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.toolbar}>
        <View style={styles.search}>
          <Ionicons name="search-outline" size={15} color="#8a8a8a" style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="Search name, title, department…"
            placeholderTextColor="#999"
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="while-editing"
          />
          {query ? (
            <Pressable onPress={() => setQuery('')} hitSlop={8}>
              <Ionicons name="close-circle" size={15} color="#b0b0b0" />
            </Pressable>
          ) : null}
        </View>
      </View>

      {allowFilters ? (
      <View style={styles.filterRow}>
        {STATUS_FILTERS.map((filter) => (
          <Pressable
            key={filter.key}
            style={[styles.filterChip, statusFilter === filter.key && styles.filterChipActive]}
            onPress={() => setStatusFilter(filter.key)}
          >
            <Text
              style={[
                styles.filterChipText,
                statusFilter === filter.key && styles.filterChipTextActive,
              ]}
            >
              {filter.label}
            </Text>
          </Pressable>
        ))}
        {departments.length > 1 ? (
          <>
            <Pressable
              style={[styles.filterChip, !department && styles.filterChipActive]}
              onPress={() => setDepartment(null)}
            >
              <Text style={[styles.filterChipText, !department && styles.filterChipTextActive]}>
                All departments
              </Text>
            </Pressable>
            {departments.map((name) => (
              <Pressable
                key={name}
                style={[styles.filterChip, department === name && styles.filterChipActive]}
                onPress={() => setDepartment((current) => (current === name ? null : name))}
              >
                <Text
                  style={[styles.filterChipText, department === name && styles.filterChipTextActive]}
                >
                  {name}
                </Text>
              </Pressable>
            ))}
          </>
        ) : null}
      </View>
      ) : null}

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      {loading && employees.length === 0 ? (
        <View style={styles.centered}>
          <ActivityIndicator color="#1a1a1a" />
        </View>
      ) : (
        <View style={styles.split}>
          <View style={styles.tableWrap}>
            {!isMobile ? (
              <View style={[styles.row, styles.headerRow]}>
                <Text style={[styles.headerText, styles.colName]}>Name</Text>
                <Text style={[styles.headerText, styles.colTitle]}>Title</Text>
                <Text style={[styles.headerText, styles.colDept]}>Department</Text>
                <Text style={[styles.headerText, styles.colLocation]}>Location</Text>
                <Text style={[styles.headerText, styles.colStatus]}>Status</Text>
              </View>
            ) : null}
            <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
              {filtered.length === 0 ? (
                <View style={styles.empty}>
                  <Text style={styles.emptyText}>
                    {query.trim() || department
                      ? 'No employees match the current filters.'
                      : 'No workers returned from Rippling.'}
                  </Text>
                </View>
              ) : (
                filtered.map((employee) => (
                  <EmployeeRow
                    key={employee.id}
                    employee={employee}
                    compact={isMobile}
                    selected={!isMobile && selectedId === employee.id}
                    onPress={() => setSelectedId(employee.id)}
                  />
                ))
              )}
            </ScrollView>
          </View>

          {!isMobile ? (
            <View style={styles.detailPane}>
              <EmployeeDetail employee={selected} />
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
            <EmployeeDetail
              employee={selected}
              compact
              onClose={() => setSelectedId(null)}
            />
          </View>
        </Modal>
      ) : null}

      <ConnectModal
        visible={connectOpen}
        onClose={() => setConnectOpen(false)}
        onSaved={(next) => {
          setSession(next);
          setError('');
        }}
      />
    </View>
  );
}

export default function EmployeesScreen({ session, onProfileUpdated }) {
  const [activeTab, setActiveTab] = useState(() =>
    readRipplingOAuthCallback() ? 'rippling' : 'employees',
  );

  return (
    <View style={styles.screen}>
      <TabBar options={EMPLOYEE_TABS} value={activeTab} onChange={setActiveTab} />
      {activeTab === 'employees' ? (
        <AppEmployeesPanel session={session} onProfileUpdated={onProfileUpdated} />
      ) : (
        <RipplingPanel />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    minHeight: 0,
  },
  tabBar: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'stretch',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e8e8e8',
    marginTop: 4,
  },
  tab: {
    paddingHorizontal: 14,
    paddingTop: 6,
    paddingBottom: 11,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
    marginBottom: -StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  tabActive: {
    borderBottomColor: ACCENT,
  },
  tabLabel: {
    fontFamily,
    fontSize: 15,
    fontWeight: '500',
    color: '#6b6b6b',
    letterSpacing: -0.2,
  },
  tabLabelActive: {
    color: '#1a1a1a',
    fontWeight: '600',
  },
  body: {
    flex: 1,
    gap: 10,
    minHeight: 0,
    marginTop: 12,
  },
  directoryHint: {
    fontFamily,
    fontSize: 12,
    color: '#8a8a8a',
  },
  rowInactive: {
    opacity: 0.55,
  },
  colAppLocation: { flex: 1, minWidth: 110 },
  colAppType: { width: '16%', minWidth: 90 },
  colAppPermission: { width: '22%', minWidth: 120 },
  signInCard: {
    alignSelf: 'center',
    width: '100%',
    maxWidth: 460,
    marginTop: 24,
    padding: 20,
    borderRadius: 12,
    backgroundColor: '#fff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e5e5',
    gap: 10,
  },
  signInIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: ACCENT_SOFT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  signInTitle: {
    fontFamily,
    fontSize: 18,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  signInBody: {
    fontFamily,
    fontSize: 13,
    lineHeight: 18,
    color: '#4a4a4a',
  },
  fieldLabel: {
    fontFamily,
    fontSize: 11,
    fontWeight: '600',
    color: '#6b6b6b',
    marginTop: 4,
  },
  fieldInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontFamily,
    fontSize: 13,
    color: '#1a1a1a',
    ...Platform.select({ web: { outlineStyle: 'none' }, default: {} }),
  },
  fieldHint: {
    fontFamily,
    fontSize: 12,
    lineHeight: 16,
    color: '#8a8a8a',
  },
  orRow: {
    alignSelf: 'flex-start',
    paddingVertical: 4,
  },
  orText: {
    fontFamily,
    fontSize: 12,
    fontWeight: '500',
    color: ACCENT,
  },
  connectBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    padding: 12,
    borderRadius: 10,
    backgroundColor: ACCENT_SOFT,
    flexWrap: 'wrap',
  },
  connectInfo: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    flex: 1,
    minWidth: 220,
  },
  connectCopy: {
    flex: 1,
    gap: 2,
  },
  connectTitle: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  connectHint: {
    fontFamily,
    fontSize: 12,
    color: '#6b6b6b',
  },
  connectActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  toolbar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  search: {
    flex: 1,
    minWidth: 220,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#d0d0d0',
    borderRadius: 8,
    paddingHorizontal: 8,
    backgroundColor: '#fff',
  },
  searchIcon: {
    marginRight: 4,
  },
  searchInput: {
    flex: 1,
    fontFamily,
    fontSize: 13,
    color: '#1a1a1a',
    paddingVertical: 8,
    ...Platform.select({ web: { outlineStyle: 'none' }, default: {} }),
  },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  filterChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#f3f3f3',
  },
  filterChipActive: {
    backgroundColor: ACCENT_SOFT,
  },
  filterChipText: {
    fontFamily,
    fontSize: 12,
    fontWeight: '500',
    color: '#6b6b6b',
  },
  filterChipTextActive: {
    color: ACCENT,
    fontWeight: '600',
  },
  split: {
    flex: 1,
    minHeight: 0,
    flexDirection: 'row',
    gap: 12,
  },
  tableWrap: {
    flex: 1.6,
    minWidth: 0,
    minHeight: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e8e8e8',
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingBottom: 24,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    minHeight: 48,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f0f0f0',
    gap: 8,
    paddingVertical: 8,
    paddingRight: 4,
  },
  rowSelected: {
    backgroundColor: ACCENT_SOFT,
  },
  headerRow: {
    borderBottomColor: '#e5e5e5',
    minHeight: 30,
    paddingVertical: 0,
  },
  headerText: {
    fontFamily,
    fontSize: 11,
    fontWeight: '600',
    color: '#9a9a9a',
    letterSpacing: 0.2,
  },
  cell: {
    fontFamily,
    fontSize: 12,
    color: '#1a1a1a',
  },
  colName: {
    flex: 1.4,
    minWidth: 160,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  nameWrap: {
    flex: 1,
    minWidth: 0,
  },
  nameText: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  emailText: {
    fontFamily,
    fontSize: 11,
    color: '#8a8a8a',
    marginTop: 1,
  },
  colTitle: { flex: 1, minWidth: 100 },
  colDept: { width: '16%', minWidth: 90 },
  colLocation: { width: '14%', minWidth: 80 },
  colStatus: { width: 88, minWidth: 72 },
  avatar: {
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#E5E7EB',
  },
  avatarFallback: {
    backgroundColor: '#DBEAFE',
  },
  avatarInitials: {
    fontFamily,
    fontWeight: '700',
    color: ACCENT,
  },
  detailPane: {
    flex: 1,
    minWidth: 260,
    maxWidth: 360,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: '#e8e8e8',
    paddingLeft: 14,
  },
  detailScroll: {
    flex: 1,
  },
  detailContent: {
    gap: 12,
    paddingBottom: 32,
    paddingTop: 8,
  },
  detailEmpty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 16,
  },
  detailEmptyText: {
    fontFamily,
    fontSize: 13,
    color: '#8a8a8a',
    textAlign: 'center',
  },
  detailHero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  detailHeroText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  detailName: {
    fontFamily,
    fontSize: 18,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  detailTitle: {
    fontFamily,
    fontSize: 13,
    color: '#6b6b6b',
  },
  statusText: {
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
  detailField: {
    gap: 2,
  },
  detailLabel: {
    fontFamily,
    fontSize: 11,
    fontWeight: '600',
    color: '#9a9a9a',
    letterSpacing: 0.2,
    textTransform: 'uppercase',
  },
  detailValue: {
    fontFamily,
    fontSize: 13,
    color: '#1a1a1a',
    lineHeight: 18,
  },
  detailMobileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  detailMobileTitle: {
    fontFamily,
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  mobileDetail: {
    flex: 1,
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 56 : 20,
  },
  empty: {
    paddingVertical: 28,
    alignItems: 'center',
  },
  emptyText: {
    fontFamily,
    fontSize: 13,
    color: '#8a8a8a',
    textAlign: 'center',
    maxWidth: 420,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
  },
  errorText: {
    fontFamily,
    fontSize: 12,
    color: '#B91C1C',
  },
  primaryButton: {
    backgroundColor: ACCENT,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    alignItems: 'center',
    alignSelf: 'flex-start',
  },
  primaryButtonCompact: {
    backgroundColor: ACCENT,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: 'center',
  },
  primaryButtonDisabled: {
    opacity: 0.6,
  },
  primaryButtonText: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: '#fff',
  },
  secondaryButton: {
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#fff',
  },
  secondaryButtonText: {
    fontFamily,
    fontSize: 13,
    fontWeight: '500',
    color: '#6b6b6b',
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
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    gap: 10,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  modalTitle: {
    fontFamily,
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  modalBody: {
    fontFamily,
    fontSize: 13,
    lineHeight: 18,
    color: '#4a4a4a',
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  linkText: {
    fontFamily,
    fontSize: 13,
    color: ACCENT,
    fontWeight: '500',
  },
  tokenInput: {
    minHeight: 96,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 10,
    fontFamily: Platform.select({
      ios: 'SohneMono',
      android: 'SohneMono',
      default: 'SohneMono',
    }),
    fontSize: 11,
    color: '#1a1a1a',
    textAlignVertical: 'top',
  },
});
