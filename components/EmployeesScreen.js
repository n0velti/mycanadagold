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
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  RIPPLING_API_TOKENS_URL,
  RIPPLING_DEVELOPER_URL,
  WORKER_STATUS,
  buildRipplingAuthorizeUrl,
  canManageCompanyRippling,
  clearRipplingOAuthCallbackFromUrl,
  clearRipplingOAuthState,
  clearRipplingSession,
  createRipplingOAuthState,
  disconnectCompanyRippling,
  exchangeRipplingOAuthCode,
  fetchEmployees,
  fetchRipplingCompany,
  getRipplingRedirectUri,
  loadRipplingOAuthApp,
  loadRipplingSession,
  persistRipplingOAuthState,
  readRipplingOAuthCallback,
  readRipplingOAuthState,
  saveCompanyRipplingSession,
  saveRipplingOAuthApp,
  saveRipplingSession,
} from '../lib/rippling';
import { syncStaffRoles } from '../lib/auth';
import { mergeEmployeesWithProfiles } from '../lib/aureusEmployees';
import { categoryLabel, listStaffProfiles, useAppAccess } from '../lib/permissions';
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

function PersonHero({ name, title, photoUrl, statusLabel, statusTone: tone, onOpenPhoto, compact, onClose, heading }) {
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
        <StaffAvatar uri={photoUrl} name={name} size={72} />
      </Pressable>
      <Text style={styles.heroName}>{name}</Text>
      {title ? <Text style={styles.heroTitle}>{title}</Text> : null}
      {statusLabel ? <StatusPill label={statusLabel} tone={tone || 'neutral'} /> : null}
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

function StaffEmployeeRow({ person, selected, onPress, last }) {
  const name = staffDisplayName(person);
  const permission = permissionLabel(person);
  const location = person.locationName || '';
  const type = employeeTypeLabel(person);
  const inactive = person.isActive === false || person.profileActive === false;
  const subtitle = [location, type !== '—' ? type : '', permission !== '—' ? permission : '']
    .filter(Boolean)
    .join(' · ');

  return (
    <View style={inactive ? styles.rowInactive : null}>
      <MobileListRow
        title={inactive ? `${name} · Inactive` : name}
        subtitle={subtitle || person.email || person.aureusLogin}
        leading={<StaffAvatar uri={person.avatarUrl || person.photoUrl} name={name} size={44} />}
        selected={selected}
        last={last}
        onPress={onPress}
      />
    </View>
  );
}

function StaffEmployeeDetail({ person, onClose, compact, onOpenPhoto }) {
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

function AppEmployeesPanel({ session, onProfileUpdated, storeFilter }) {
  const isMobile = useIsMobile();
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
        <BarButton label="Refresh" onPress={load} disabled={loading} />
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

function SignInCard({ onConnected, profile }) {
  // null = still loading; { clientId, configured, canManage } once the proxy answers.
  const [oauthApp, setOauthApp] = useState(null);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
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
        if (!cancelled) {
          setOauthApp({
            clientId: '',
            configured: false,
            connected: false,
            canManage: canManageCompanyRippling(profile),
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [profile]);

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
          if (String(callback.state || '').startsWith('gmail.')) return;
          throw new Error('Rippling sign-in state did not match. Try again.');
        }
        const session = await exchangeRipplingOAuthCode({
          code: callback.code,
          redirectUri: getRipplingRedirectUri(),
        });
        clearRipplingOAuthState();
        clearRipplingOAuthCallbackFromUrl();
        const app = await loadRipplingOAuthApp().catch(() => null);
        if (!cancelled) {
          onConnected(
            app?.connected
              ? {
                  token: '',
                  source: 'company',
                  companyName: app.companyName,
                  savedAt: Date.now(),
                }
              : session,
          );
        }
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

  const canManage = Boolean(oauthApp?.canManage) || canManageCompanyRippling(profile);

  const saveOauthApp = async () => {
    setBusy('app');
    setError('');
    try {
      const app = await saveRipplingOAuthApp({ clientId, clientSecret });
      setOauthApp(app);
      setClientSecret('');
    } catch (err) {
      setError(err?.message || 'Could not save the Rippling sign-in app.');
    } finally {
      setBusy('');
    }
  };

  const signInWithRippling = async () => {
    const redirectUri = getRipplingRedirectUri();
    if (!redirectUri) {
      setError('Sign in with Rippling is available in the web app.');
      return;
    }
    if (!oauthApp?.configured || !oauthApp.clientId) {
      setError(
        canManage
          ? 'Add the Rippling sign-in app above, then try again.'
          : 'Rippling sign-in is not set up yet. Ask a System Admin, GM, or HR to add the Rippling app on this screen.',
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
      const session = canManage
        ? await saveCompanyRipplingSession({ token })
        : await saveRipplingSession({ token });
      onConnected(session);
    } catch (err) {
      setError(err?.message || 'Could not save Rippling token.');
    } finally {
      setBusy('');
    }
  };

  const redirectHint = getRipplingRedirectUri() || 'https://www.mycanadagold.ca/';

  return (
    <View style={styles.signInCard}>
      <View style={styles.signInIcon}>
        <Ionicons name="people-outline" size={22} color={T.blue} />
      </View>
      <Text style={styles.signInTitle}>Sign in to Rippling</Text>
      <Text style={styles.signInBody}>
        Rippling does not let this app host their email and password form. Sign in opens
        Rippling’s own login page — type your Rippling email and password there, then you’ll
        come back connected.
      </Text>

      {canManage && oauthApp && !oauthApp.configured ? (
        <>
          <Text style={styles.fieldHint}>
            Add the Rippling OAuth app so everyone can sign in with Rippling instead of an API
            token. In the Rippling Developer Portal, create an app, enable workers.read,
            users.read, departments.read, work-locations.read, and companies.read, and register
            this redirect URI:
          </Text>
          <Text style={styles.redirectUri} selectable>
            {redirectHint}
          </Text>
          <Pressable style={styles.linkRow} onPress={() => Linking.openURL(RIPPLING_DEVELOPER_URL)}>
            <Ionicons name="open-outline" size={14} color={T.blue} />
            <Text style={styles.linkText}>Open Rippling Developer Portal</Text>
          </Pressable>
          <TextInput
            style={styles.secretInput}
            value={clientId}
            onChangeText={setClientId}
            placeholder="Client ID"
            placeholderTextColor="#999"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!busy}
          />
          <TextInput
            style={styles.secretInput}
            value={clientSecret}
            onChangeText={setClientSecret}
            placeholder="Client secret"
            placeholderTextColor="#999"
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            editable={!busy}
          />
          <Pressable
            style={[styles.secondaryButton, Boolean(busy) && styles.primaryButtonDisabled]}
            onPress={saveOauthApp}
            disabled={Boolean(busy) || !clientId.trim() || !clientSecret.trim()}
          >
            {busy === 'app' ? (
              <ActivityIndicator color={T.blue} />
            ) : (
              <Text style={[styles.secondaryButtonText, { color: T.blue }]}>Save Rippling app</Text>
            )}
          </Pressable>
        </>
      ) : null}

      {oauthApp && !oauthApp.configured && !canManage ? (
        <Text style={styles.fieldHint}>
          Rippling sign-in is not set up yet. Ask a System Admin, GM, or HR to add the Rippling
          app on this screen, or connect with an API token below.
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
            {canManage
              ? 'Connect once for everyone. Tools → Developer → API Tokens. Paste the token only — the app sends Authorization: Bearer for you. Include workers.read.'
              : 'Tools → Developer → API Tokens. Paste the token only — the app sends Authorization: Bearer for you. Include workers.read. Unused tokens expire after 30 days.'}
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
            editable={!busy}
          />
          <Pressable
            style={[styles.secondaryButton, Boolean(busy) && styles.primaryButtonDisabled]}
            onPress={saveToken}
            disabled={Boolean(busy)}
          >
            {busy === 'token' ? (
              <ActivityIndicator color={T.blue} />
            ) : (
              <Text style={[styles.secondaryButtonText, { color: T.blue }]}>
                {canManage ? 'Connect for everyone' : 'Connect with token'}
              </Text>
            )}
          </Pressable>
        </>
      ) : null}

      {error ? <Text style={styles.errorText}>{error}</Text> : null}
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

function EmployeeDetail({ employee, onClose, compact }) {
  if (!employee) {
    return (
      <EmptyState
        icon="people-outline"
        title="Rippling"
        body="Select someone to see their Rippling profile."
      />
    );
  }

  return (
    <ScrollView
      style={styles.detailScroll}
      contentContainerStyle={styles.detailContent}
      showsVerticalScrollIndicator={false}
    >
      <PersonHero
        name={employee.name}
        title={employee.title}
        photoUrl={employee.photoUrl}
        statusLabel={employee.statusLabel}
        statusTone={statusTone(employee.status)}
        compact={compact}
        onClose={onClose}
        heading="Profile"
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
    </ScrollView>
  );
}

function EmployeeRow({ employee, selected, onPress, last }) {
  const subtitle = [employee.title, employee.department, employee.location].filter(Boolean).join(' · ');
  return (
    <MobileListRow
      title={employee.name}
      subtitle={subtitle || employee.workEmail}
      leading={<StaffAvatar uri={employee.photoUrl} name={employee.name} size={44} />}
      trailing={<StatusPill label={employee.statusLabel} tone={statusTone(employee.status)} compact />}
      selected={selected}
      last={last}
      onPress={onPress}
    />
  );
}

function RipplingPanel({ profile }) {
  const isMobile = useIsMobile();
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

  const handleConnected = useCallback((next) => {
    setSession(next);
    setError('');
  }, []);

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

  if (!connected) {
    return (
      <View style={styles.body}>
        <SignInCard onConnected={handleConnected} profile={profile} />
      </View>
    );
  }

  return (
    <View style={styles.body}>
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
        <View style={styles.split}>
          <View style={styles.listPane}>
            <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
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
                          last={index === rows.length - 1}
                          selected={!isMobile && selectedId === employee.id}
                          onPress={() => setSelectedId(employee.id)}
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
        canManage={canManage}
        onSaved={(next) => {
          setSession(next);
          setError('');
        }}
      />
    </View>
  );
}

export default function EmployeesScreen({
  session,
  onProfileUpdated,
  storeFilter,
  embedded = false,
}) {
  const [activeTab, setActiveTab] = useState(() =>
    !embedded && readRipplingOAuthCallback() ? 'rippling' : 'employees',
  );

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
        />
      ) : (
        <RipplingPanel profile={session?.profile} />
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
  rowInactive: {
    opacity: 0.55,
  },
  signInCard: {
    alignSelf: 'center',
    width: '100%',
    maxWidth: 460,
    marginTop: 24,
    padding: 20,
    borderRadius: 12,
    backgroundColor: T.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: T.hairline,
    gap: 10,
  },
  signInIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,122,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  signInTitle: {
    fontFamily: FONT,
    fontSize: 22,
    fontWeight: '700',
    color: T.text,
    letterSpacing: -0.4,
  },
  signInBody: {
    fontFamily: FONT,
    fontSize: 15,
    lineHeight: 20,
    color: T.secondary,
  },
  fieldHint: {
    fontFamily: FONT,
    fontSize: 13,
    lineHeight: 18,
    color: T.secondary,
  },
  redirectUri: {
    fontFamily: Platform.select({
      ios: 'SohneMono',
      android: 'SohneMono',
      default: 'SohneMono',
    }),
    fontSize: 12,
    color: T.text,
    backgroundColor: T.fillSoft,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  secretInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: T.hairline,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: FONT,
    fontSize: 15,
    color: T.text,
    backgroundColor: T.fillSoft,
    ...Platform.select({ web: { outlineStyle: 'none' }, default: {} }),
  },
  orRow: {
    alignSelf: 'flex-start',
    paddingVertical: 4,
  },
  orText: {
    fontFamily: FONT,
    fontSize: 15,
    fontWeight: '500',
    color: T.blue,
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
  listPane: {
    flex: 1.35,
    minWidth: 0,
    minHeight: 0,
  },
  list: {
    flex: 1,
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
  detailScroll: {
    flex: 1,
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
