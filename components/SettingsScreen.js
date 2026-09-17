import { createElement, useEffect, useMemo, useState } from 'react';
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
import { useIsMobile } from '../lib/mobileUi';
import { AI_MODEL_PROVIDERS, canManageCompanyAiKeys, loadCompanyAiKeyState, saveAiApiKeys } from '../lib/aiKeys';
import {
  USER_CATEGORIES,
  USER_CATEGORY_KEYS,
  canManageAppAccess,
  clearUserAppAccess,
  defaultAccessByRole,
  getCategory,
  hasFullAppAccess,
  listStaffProfiles,
  loadRoleAppAccess,
  loadUserAppAccessMap,
  resolvedAccessForProfile,
  saveRoleAppAccess,
  saveUserAppAccess,
  updateStaffAccess,
  useAppAccess,
} from '../lib/permissions';
import { getSupabaseConnectionStatus } from '../lib/supabase';
import StoreSettingsPanel from './StoreSettingsPanel';
import RingCentralSettingsPanel from './RingCentralSettingsPanel';
import { canManageRingCentral } from '../lib/ringcentral';

const fontFamily = Platform.select({
  ios: 'Sohne',
  android: 'Sohne',
  default: 'Sohne',
});

const emptyKeys = () =>
  Object.fromEntries(AI_MODEL_PROVIDERS.map((provider) => [provider.key, '']));

export { AI_MODEL_PROVIDERS };

function SettingsHome({
  onOpenAiModels,
  onOpenPermissions,
  onOpenDatabase,
  onOpenStoreSettings,
  onOpenRingCentral,
  canManageAiKeys,
  canManagePhone,
  showRingCentral,
}) {
  const isMobile = useIsMobile();
  const [dbStatus, setDbStatus] = useState(null);

  useEffect(() => {
    let cancelled = false;
    getSupabaseConnectionStatus()
      .then((status) => {
        if (!cancelled) setDbStatus(status);
      })
      .catch(() => {
        if (!cancelled) {
          setDbStatus({ configured: false, reachable: false, keyKind: 'missing' });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const dbReady = Boolean(dbStatus?.configured && dbStatus?.reachable);
  const dbHint = !dbStatus
    ? 'Checking HTTPS connection…'
    : dbReady
      ? 'HTTPS · client key · row-level security'
      : dbStatus.message || 'Not connected';

  return (
    <View style={[styles.body, isMobile && styles.bodyMobile]}>
      <View style={styles.menuList}>
        <Pressable style={[styles.menuRow, isMobile && styles.menuRowMobile]} onPress={onOpenDatabase}>
          <View style={[styles.menuIcon, { backgroundColor: dbReady ? '#EAF6EE' : '#FFF6E8' }]}>
            <Ionicons
              name={dbReady ? 'server-outline' : 'cloud-offline-outline'}
              size={16}
              color={dbReady ? '#2F8A4E' : '#B54708'}
            />
          </View>
          <View style={styles.menuTextWrap}>
            <Text style={styles.menuLabel}>Database</Text>
            <Text style={styles.menuHint}>{dbHint}</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color="#9a9a9a" />
        </Pressable>

        <Pressable style={[styles.menuRow, isMobile && styles.menuRowMobile]} onPress={onOpenStoreSettings}>
          <View style={[styles.menuIcon, { backgroundColor: '#FFF4E5' }]}>
            <Ionicons name="storefront-outline" size={16} color="#C47A12" />
          </View>
          <View style={styles.menuTextWrap}>
            <Text style={styles.menuLabel}>Store settings</Text>
            <Text style={styles.menuHint}>Weekly hours and holidays for each branch</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color="#9a9a9a" />
        </Pressable>

        {showRingCentral ? (
          <Pressable style={[styles.menuRow, isMobile && styles.menuRowMobile]} onPress={onOpenRingCentral}>
            <View style={[styles.menuIcon, { backgroundColor: '#ECFDF5' }]}>
              <Ionicons name="call-outline" size={16} color="#15803D" />
            </View>
            <View style={styles.menuTextWrap}>
              <Text style={styles.menuLabel}>RingCentral</Text>
              <Text style={styles.menuHint}>
                {canManagePhone
                  ? 'Incoming calls per store, plus JWT credentials'
                  : 'Choose which store incoming calls appear on this screen'}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color="#9a9a9a" />
          </Pressable>
        ) : null}

        {canManageAiKeys ? (
          <Pressable style={[styles.menuRow, isMobile && styles.menuRowMobile]} onPress={onOpenAiModels}>
            <View style={[styles.menuIcon, { backgroundColor: '#F3EEFF' }]}>
              <Ionicons name="sparkles-outline" size={16} color="#6B4DE6" />
            </View>
            <View style={styles.menuTextWrap}>
              <Text style={styles.menuLabel}>AI models</Text>
              <Text style={styles.menuHint}>
                Company keys for portraits, Serphint, and AI chat — used by everyone
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color="#9a9a9a" />
          </Pressable>
        ) : null}

        <Pressable style={[styles.menuRow, isMobile && styles.menuRowMobile]} onPress={onOpenPermissions}>
          <View style={[styles.menuIcon, { backgroundColor: '#EEF4FF' }]}>
            <Ionicons name="shield-checkmark-outline" size={16} color="#3B6FE0" />
          </View>
          <View style={styles.menuTextWrap}>
            <Text style={styles.menuLabel}>Permissions</Text>
            <Text style={styles.menuHint}>
              Each employee and their role, plus apps, filters, camera, and microphone
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color="#9a9a9a" />
        </Pressable>
      </View>
    </View>
  );
}

const PERMISSION_ITEMS = [
  {
    key: 'camera',
    label: 'Camera',
    description: 'Used for Canada Gold portraits and by Serphint to capture video',
    icon: 'camera-outline',
    tint: '#EEF4FF',
    accent: '#3B6FE0',
    media: { video: true },
  },
  {
    key: 'microphone',
    label: 'Microphone',
    description: 'Used by Serphint when recording with audio',
    icon: 'mic-outline',
    tint: '#F3EEFF',
    accent: '#6B4DE6',
    media: { audio: true },
  },
];

function permissionStatusLabel(status) {
  switch (status) {
    case 'granted':
      return 'Allowed';
    case 'denied':
      return 'Blocked';
    case 'prompt':
      return 'Not decided';
    case 'unsupported':
      return 'Unavailable';
    default:
      return 'Checking…';
  }
}

function permissionStatusColor(status) {
  switch (status) {
    case 'granted':
      return '#2F8A4E';
    case 'denied':
      return '#b42318';
    case 'unsupported':
      return '#8a8a8a';
    default:
      return '#6b6b6b';
  }
}

async function queryMediaPermission(name) {
  if (Platform.OS !== 'web' || !navigator?.permissions?.query) {
    return 'unsupported';
  }

  try {
    const result = await navigator.permissions.query({ name });
    return result.state;
  } catch {
    return 'prompt';
  }
}

function AccessToggle({ on, disabled, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      style={[styles.toggleTrack, on && styles.toggleTrackOn, disabled && styles.toggleDisabled]}
      accessibilityRole="switch"
      accessibilityState={{ checked: on, disabled }}
    >
      <View style={[styles.toggleThumb, on && styles.toggleThumbOn]} />
    </Pressable>
  );
}

function RoleBadge({ role, isSystemAdmin }) {
  const category = getCategory(role);
  const tint = category?.tint || '#F4F4F5';
  const accent = category?.accent || '#52525B';
  const label =
    role === 'general_manager' && isSystemAdmin
      ? 'GM · Admin'
      : category?.shortLabel || '—';
  return (
    <View style={[styles.roleBadge, { backgroundColor: tint }]}>
      <Text style={[styles.roleBadgeText, { color: accent }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function CategorySelect({ value, onChange, disabled }) {
  if (Platform.OS === 'web') {
    return createElement(
      'select',
      {
        value,
        disabled,
        onChange: (event) => onChange(event.target.value),
        style: {
          fontFamily,
          fontSize: 12,
          color: '#1a1a1a',
          border: '1px solid #d0d0d0',
          borderRadius: 6,
          padding: '6px 8px',
          background: '#fff',
          minWidth: 168,
          maxWidth: 220,
        },
      },
      USER_CATEGORIES.map((category) =>
        createElement('option', { key: category.key, value: category.key }, category.label),
      ),
    );
  }

  return (
    <View style={styles.categoryChipWrap}>
      {USER_CATEGORIES.map((category) => {
        const selected = category.key === value;
        return (
          <Pressable
            key={category.key}
            onPress={() => onChange(category.key)}
            disabled={disabled}
            style={[styles.categoryChip, selected && styles.categoryChipSelected]}
          >
            <Text style={[styles.categoryChipText, selected && styles.categoryChipTextSelected]}>
              {category.shortLabel}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function staffName(row) {
  return row.fullName || [row.firstName, row.lastName].filter(Boolean).join(' ') || row.email || row.aureusLogin || 'Staff';
}

function staffTitle(row) {
  return row.employeeType || row.posRole || '';
}

function personDraftFromResolved(resolved) {
  return {
    visibleApps: [...(resolved.visibleApps || [])],
    filterableApps: [...(resolved.filterableApps || [])],
  };
}

function accessSummary(row, accessByRole, userAccessMap, catalogKeys) {
  if (hasFullAppAccess(row)) return 'All apps · can filter';
  const resolved = resolvedAccessForProfile(row, accessByRole, catalogKeys, userAccessMap[row.id]);
  const filterCount = resolved.filterableApps.length;
  const custom = resolved.inherited ? '' : ' · custom';
  return `${resolved.visibleApps.length} app${resolved.visibleApps.length === 1 ? '' : 's'} · filter ${filterCount}${custom}`;
}

function AppAccessPanel({ session, apps, onAccessSaved, onStaffAccessSaved, onUserAccessSaved }) {
  const isMobile = useIsMobile();
  const catalogKeys = useMemo(() => (apps || []).map((app) => app.key), [apps]);
  const actorId = session?.supabaseUserId || session?.profile?.id;
  const [activeRole, setActiveRole] = useState('precious_metal_analyst');
  const [draft, setDraft] = useState(() => defaultAccessByRole(catalogKeys));
  const [staff, setStaff] = useState([]);
  const [userAccessMap, setUserAccessMap] = useState({});
  const [staffQuery, setStaffQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [expandedId, setExpandedId] = useState('');
  const [personDraft, setPersonDraft] = useState({ visibleApps: [], filterableApps: [] });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [personSaving, setPersonSaving] = useState(false);
  const [updatingId, setUpdatingId] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const activeCategory = USER_CATEGORIES.find((category) => category.key === activeRole);
  const locked = activeRole === 'system_admin';
  const expandedRow = staff.find((row) => row.id === expandedId) || null;
  const expandedResolved = expandedRow
    ? resolvedAccessForProfile(expandedRow, draft, catalogKeys, userAccessMap[expandedRow.id])
    : null;
  const expandedLocked = Boolean(expandedResolved?.locked);

  const roleCounts = useMemo(() => {
    const counts = Object.fromEntries(USER_CATEGORY_KEYS.map((key) => [key, 0]));
    for (const row of staff) {
      const role = row.appRole || 'precious_metal_analyst';
      counts[role] = (counts[role] || 0) + 1;
    }
    return counts;
  }, [staff]);

  const visibleStaff = useMemo(() => {
    const q = staffQuery.trim().toLowerCase();
    return staff.filter((row) => {
      if (roleFilter && row.appRole !== roleFilter) return false;
      if (!q) return true;
      const category = getCategory(row.appRole);
      const haystack = [
        staffName(row),
        row.email,
        row.aureusLogin,
        row.locationName,
        staffTitle(row),
        category?.label,
        category?.shortLabel,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [staff, staffQuery, roleFilter]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError('');
      try {
        const [access, people, userAccess] = await Promise.all([
          loadRoleAppAccess(catalogKeys),
          listStaffProfiles().catch(() => []),
          loadUserAppAccessMap(catalogKeys),
        ]);
        if (cancelled) return;
        setDraft(access.byRole);
        setStaff(people);
        setUserAccessMap(userAccess.byUser);
        if (access.error || userAccess.error) {
          setError(access.error || userAccess.error);
        }
      } catch (nextError) {
        if (!cancelled) {
          setDraft(defaultAccessByRole(catalogKeys));
          setError(nextError?.message || 'Could not load app permissions.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [catalogKeys]);

  const toggleApp = (appKey) => {
    if (locked || saving) return;
    setMessage('');
    setDraft((current) => {
      const list = current[activeRole] || [];
      const nextList = list.includes(appKey)
        ? list.filter((key) => key !== appKey)
        : [...list, appKey];
      return { ...current, [activeRole]: nextList };
    });
  };

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const next = await saveRoleAppAccess(draft, catalogKeys, actorId);
      setDraft(next);
      onAccessSaved?.(next);
      if (expandedRow && !userAccessMap[expandedRow.id] && !hasFullAppAccess(expandedRow)) {
        setPersonDraft(
          personDraftFromResolved(resolvedAccessForProfile(expandedRow, next, catalogKeys, null)),
        );
      }
      setMessage('Role defaults saved.');
    } catch (nextError) {
      setError(nextError?.message || 'Could not save app visibility.');
    } finally {
      setSaving(false);
    }
  };

  const openPersonApps = (row) => {
    if (expandedId === row.id) {
      setExpandedId('');
      return;
    }
    const resolved = resolvedAccessForProfile(row, draft, catalogKeys, userAccessMap[row.id]);
    setPersonDraft(personDraftFromResolved(resolved));
    setExpandedId(row.id);
    setMessage('');
  };

  const togglePersonApp = (appKey) => {
    if (expandedLocked || personSaving) return;
    setMessage('');
    setPersonDraft((current) => {
      const visible = current.visibleApps.includes(appKey);
      const visibleApps = visible
        ? current.visibleApps.filter((key) => key !== appKey)
        : [...current.visibleApps, appKey];
      const filterableApps = visible
        ? current.filterableApps.filter((key) => key !== appKey)
        : current.filterableApps.includes(appKey)
          ? current.filterableApps
          : [...current.filterableApps, appKey];
      return { visibleApps, filterableApps };
    });
  };

  const togglePersonFilter = (appKey) => {
    if (expandedLocked || personSaving) return;
    if (!personDraft.visibleApps.includes(appKey)) return;
    setMessage('');
    setPersonDraft((current) => {
      const on = current.filterableApps.includes(appKey);
      const filterableApps = on
        ? current.filterableApps.filter((key) => key !== appKey)
        : [...current.filterableApps, appKey];
      return { ...current, filterableApps };
    });
  };

  const handleSavePersonApps = async (row) => {
    if (personSaving || expandedLocked) return;
    setPersonSaving(true);
    setError('');
    setMessage('');
    try {
      const saved = await saveUserAppAccess(row.id, personDraft, catalogKeys, actorId);
      setUserAccessMap((current) => ({ ...current, [row.id]: saved }));
      onUserAccessSaved?.(row.id, saved);
      setMessage(`Saved apps for ${staffName(row)}.`);
    } catch (nextError) {
      setError(nextError?.message || "Could not save that person's apps.");
    } finally {
      setPersonSaving(false);
    }
  };

  const handleResetPersonApps = async (row) => {
    if (personSaving || expandedLocked) return;
    setPersonSaving(true);
    setError('');
    setMessage('');
    try {
      await clearUserAppAccess(row.id);
      setUserAccessMap((current) => {
        const next = { ...current };
        delete next[row.id];
        return next;
      });
      const resolved = resolvedAccessForProfile(row, draft, catalogKeys, null);
      setPersonDraft(personDraftFromResolved(resolved));
      onUserAccessSaved?.(row.id, null);
      const category = getCategory(row.appRole);
      setMessage(
        `Restored ${staffName(row)} to ${category?.label || 'role'} defaults.`,
      );
    } catch (nextError) {
      setError(nextError?.message || 'Could not restore role defaults.');
    } finally {
      setPersonSaving(false);
    }
  };

  const handleStaffChange = async (row, patch) => {
    if (updatingId) return;
    setUpdatingId(row.id);
    setError('');
    setMessage('');
    try {
      const updated = await updateStaffAccess(row.id, {
        appRole: patch.appRole ?? row.appRole,
        isSystemAdmin: patch.isSystemAdmin ?? row.isSystemAdmin,
        isActive: patch.isActive ?? row.isActive,
      });
      setStaff((current) => current.map((entry) => (entry.id === updated.id ? updated : entry)));
      onStaffAccessSaved?.(updated);
      if (expandedId === updated.id) {
        const resolved = resolvedAccessForProfile(
          updated,
          draft,
          catalogKeys,
          userAccessMap[updated.id],
        );
        setPersonDraft(personDraftFromResolved(resolved));
      }
      setMessage(`Updated ${staffName(updated)}.`);
    } catch (nextError) {
      setError(nextError?.message || 'Could not update that person.');
    } finally {
      setUpdatingId('');
    }
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color="#1a1a1a" />
      </View>
    );
  }

  return (
    <>
      <Text style={styles.sectionTitle}>People and roles</Text>
      <Text style={styles.aiIntro}>
        Every signed-in employee and the role that controls their apps. Filter by role, then open
        a row to customize apps. Role defaults apply until you save a custom set. System Admin
        always has every app and can filter.
      </Text>

      {staff.length > 0 ? (
        <>
          <View style={styles.staffToolbar}>
            <View style={[styles.staffSearch, styles.staffSearchInToolbar]}>
              <Ionicons name="search-outline" size={15} color="#8a8a8a" />
              <TextInput
                style={styles.staffSearchInput}
                value={staffQuery}
                onChangeText={setStaffQuery}
                placeholder="Search name, role, email, store…"
                placeholderTextColor="#999"
                autoCapitalize="none"
                autoCorrect={false}
                clearButtonMode="while-editing"
              />
              {staffQuery ? (
                <Pressable onPress={() => setStaffQuery('')} hitSlop={8}>
                  <Ionicons name="close-circle" size={15} color="#b0b0b0" />
                </Pressable>
              ) : null}
            </View>
            <Text style={styles.staffCount}>
              {visibleStaff.length}
              {visibleStaff.length === staff.length ? '' : ` of ${staff.length}`}
            </Text>
          </View>

          <View style={styles.roleFilters}>
            <Pressable
              onPress={() => setRoleFilter('')}
              style={[styles.roleFilterChip, !roleFilter && styles.roleFilterChipSelected]}
            >
              <Text style={[styles.roleFilterText, !roleFilter && styles.roleFilterTextSelected]}>
                All {staff.length}
              </Text>
            </Pressable>
            {USER_CATEGORIES.map((category) => {
              const count = roleCounts[category.key] || 0;
              const selected = roleFilter === category.key;
              return (
                <Pressable
                  key={category.key}
                  onPress={() => setRoleFilter(selected ? '' : category.key)}
                  style={[
                    styles.roleFilterChip,
                    selected && styles.roleFilterChipSelected,
                    { borderColor: selected ? category.accent : category.tint },
                    selected ? { backgroundColor: category.accent } : { backgroundColor: category.tint },
                  ]}
                >
                  <Text
                    style={[
                      styles.roleFilterText,
                      { color: selected ? '#fff' : category.accent },
                    ]}
                  >
                    {category.shortLabel} {count}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </>
      ) : null}

      {staff.length === 0 ? (
        <Text style={styles.menuHint}>No staff profiles yet. People appear here after they sign in.</Text>
      ) : visibleStaff.length === 0 ? (
        <Text style={styles.menuHint}>No employees match that search.</Text>
      ) : (
        <View style={styles.staffTable}>
          {isMobile ? null : (
            <View style={styles.staffTableHeader}>
              <Text style={[styles.staffHeaderText, styles.staffColName]}>Employee</Text>
              <Text style={[styles.staffHeaderText, styles.staffColStore]}>Store</Text>
              <Text style={[styles.staffHeaderText, styles.staffColRole]}>Assigned role</Text>
              <Text style={[styles.staffHeaderText, styles.staffColApps]}>Apps</Text>
              <View style={styles.staffColActions} />
              <View style={styles.staffColChevron} />
            </View>
          )}
          {visibleStaff.map((row) => {
            const busy = updatingId === row.id;
            const isSelf = row.id === actorId;
            const showAdminToggle = row.appRole === 'general_manager';
            const expanded = expandedId === row.id;
            const summary = accessSummary(row, draft, userAccessMap, catalogKeys);
            const title = staffTitle(row);
            return (
              <View key={row.id} style={[styles.staffTableItem, !row.isActive && styles.staffRowDisabled]}>
                <Pressable
                  onPress={() => openPersonApps(row)}
                  style={[styles.staffHeader, !isMobile && styles.staffTableRow]}
                  accessibilityRole="button"
                  accessibilityState={{ expanded }}
                >
                  <View style={[styles.menuTextWrap, !isMobile && styles.staffColName]}>
                    <View style={styles.staffNameLine}>
                      <Text style={styles.menuLabel} numberOfLines={1}>
                        {staffName(row)}
                        {!row.isActive ? '  ·  Access disabled' : ''}
                      </Text>
                      <RoleBadge role={row.appRole} isSystemAdmin={row.isSystemAdmin} />
                    </View>
                    <Text style={styles.menuHint} numberOfLines={1}>
                      {[title, row.email || row.aureusLogin].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                  {isMobile ? null : (
                    <>
                      <Text style={[styles.staffCell, styles.staffColStore]} numberOfLines={1}>
                        {row.locationName || '—'}
                      </Text>
                      <View
                        style={[styles.staffColRole, styles.staffRoleCell]}
                        {...(Platform.OS === 'web'
                          ? { onClick: (event) => event.stopPropagation() }
                          : { onStartShouldSetResponder: () => true })}
                      >
                        <CategorySelect
                          value={row.appRole}
                          disabled={busy || !row.isActive}
                          onChange={(appRole) => handleStaffChange(row, { appRole })}
                        />
                      </View>
                      <Text style={[styles.staffCell, styles.staffColApps]} numberOfLines={1}>
                        {summary}
                      </Text>
                      <View
                        style={styles.staffColActions}
                        {...(Platform.OS === 'web'
                          ? { onClick: (event) => event.stopPropagation() }
                          : { onStartShouldSetResponder: () => true })}
                      >
                        {showAdminToggle && row.isActive ? (
                          <Pressable
                            style={[styles.adminFlag, row.isSystemAdmin && styles.adminFlagOn]}
                            onPress={() =>
                              handleStaffChange(row, {
                                appRole: row.appRole,
                                isSystemAdmin: !row.isSystemAdmin,
                              })
                            }
                            disabled={busy}
                          >
                            <Text style={[styles.adminFlagText, row.isSystemAdmin && styles.adminFlagTextOn]}>
                              Admin
                            </Text>
                          </Pressable>
                        ) : null}
                        {!isSelf ? (
                          <Pressable
                            style={[styles.adminFlag, !row.isActive && styles.accessFlagOff]}
                            onPress={() => handleStaffChange(row, { isActive: !row.isActive })}
                            disabled={busy}
                            accessibilityRole="button"
                            accessibilityLabel={row.isActive ? 'Disable access' : 'Enable access'}
                          >
                            <Text style={[styles.adminFlagText, !row.isActive && styles.accessFlagOffText]}>
                              {row.isActive ? 'Disable' : 'Enable'}
                            </Text>
                          </Pressable>
                        ) : null}
                      </View>
                    </>
                  )}
                  <View style={styles.staffColChevron}>
                    <Ionicons
                      name={expanded ? 'chevron-up' : 'chevron-down'}
                      size={16}
                      color="#9a9a9a"
                    />
                  </View>
                </Pressable>
                {isMobile ? (
                  <View style={styles.staffControls}>
                    <CategorySelect
                      value={row.appRole}
                      disabled={busy || !row.isActive}
                      onChange={(appRole) => handleStaffChange(row, { appRole })}
                    />
                    {showAdminToggle && row.isActive ? (
                      <Pressable
                        style={[styles.adminFlag, row.isSystemAdmin && styles.adminFlagOn]}
                        onPress={() =>
                          handleStaffChange(row, { appRole: row.appRole, isSystemAdmin: !row.isSystemAdmin })
                        }
                        disabled={busy}
                      >
                        <Text style={[styles.adminFlagText, row.isSystemAdmin && styles.adminFlagTextOn]}>
                          Also System Admin
                        </Text>
                      </Pressable>
                    ) : null}
                    {!isSelf ? (
                      <Pressable
                        style={[styles.adminFlag, !row.isActive && styles.accessFlagOff]}
                        onPress={() => handleStaffChange(row, { isActive: !row.isActive })}
                        disabled={busy}
                        accessibilityRole="button"
                        accessibilityLabel={row.isActive ? 'Disable access' : 'Enable access'}
                      >
                        <Text style={[styles.adminFlagText, !row.isActive && styles.accessFlagOffText]}>
                          {row.isActive ? 'Disable access' : 'Enable access'}
                        </Text>
                      </Pressable>
                    ) : null}
                    <Text style={styles.staffMobileMeta} numberOfLines={1}>
                      {[row.locationName || 'Store not set', summary].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                ) : null}

                {expanded ? (
                  <View style={styles.personApps}>
                    {expandedLocked ? (
                      <Text style={styles.menuHint}>
                        System Admin always sees every app and can filter in each one.
                      </Text>
                    ) : (
                      <Text style={styles.menuHint}>
                        {userAccessMap[row.id]
                          ? 'Custom apps for this person. Filter is only available on apps they can open.'
                          : `Using ${getCategory(row.appRole)?.label || 'role'} defaults until you save.`}
                      </Text>
                    )}
                    <View style={styles.appAccessHeader}>
                      <Text style={styles.appAccessHeaderLabel}>App</Text>
                      <Text style={styles.appAccessColLabel}>Show</Text>
                      <Text style={[styles.appAccessColLabel, styles.appAccessColLabelFilter]}>
                        Filter
                      </Text>
                    </View>
                    {(apps || []).map((app) => {
                      const visible = expandedLocked || personDraft.visibleApps.includes(app.key);
                      const filterOn = expandedLocked || personDraft.filterableApps.includes(app.key);
                      return (
                        <View key={app.key} style={styles.appRow}>
                          <View style={[styles.menuIcon, { backgroundColor: app.tint || '#F4F4F5' }]}>
                            <Ionicons
                              name={app.icon || 'apps-outline'}
                              size={16}
                              color={app.accent || '#52525B'}
                            />
                          </View>
                          <Text style={styles.appRowLabel}>{app.label}</Text>
                          <AccessToggle
                            on={visible}
                            disabled={expandedLocked}
                            onPress={() => togglePersonApp(app.key)}
                          />
                          <View style={styles.filterToggleWrap}>
                            <AccessToggle
                              on={visible && filterOn}
                              disabled={expandedLocked || !visible}
                              onPress={() => togglePersonFilter(app.key)}
                            />
                          </View>
                        </View>
                      );
                    })}
                    {!expandedLocked ? (
                      <View style={styles.personAppActions}>
                        <Pressable
                          style={[styles.saveButton, personSaving && styles.saveButtonDisabled]}
                          onPress={() => handleSavePersonApps(row)}
                          disabled={personSaving}
                        >
                          {personSaving ? (
                            <ActivityIndicator color="#fff" />
                          ) : (
                            <Text style={styles.saveButtonText}>Save apps</Text>
                          )}
                        </Pressable>
                        {userAccessMap[row.id] ? (
                          <Pressable
                            style={[styles.resetButton, personSaving && styles.saveButtonDisabled]}
                            onPress={() => handleResetPersonApps(row)}
                            disabled={personSaving}
                          >
                            <Text style={styles.resetButtonText}>Use role defaults</Text>
                          </Pressable>
                        ) : null}
                      </View>
                    ) : null}
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
      )}

      <Text style={[styles.sectionTitle, styles.sectionTitleSpaced]}>Role defaults</Text>
      <Text style={styles.aiIntro}>
        Starting apps for each role when a person has no custom set. System Admin always has
        every app. A General Manager can also be marked a System Admin.
      </Text>

      <View style={styles.categoryTabs}>
        {USER_CATEGORIES.map((category) => {
          const selected = category.key === activeRole;
          return (
            <Pressable
              key={category.key}
              onPress={() => setActiveRole(category.key)}
              style={[styles.categoryTab, selected && styles.categoryTabSelected]}
            >
              <Text style={[styles.categoryTabText, selected && styles.categoryTabTextSelected]}>
                {category.shortLabel}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {activeCategory ? <Text style={styles.menuHint}>{activeCategory.description}</Text> : null}

      <View style={styles.appList}>
        {(apps || []).map((app) => {
          const on = locked || (draft[activeRole] || []).includes(app.key);
          return (
            <View key={app.key} style={styles.appRow}>
              <View style={[styles.menuIcon, { backgroundColor: app.tint || '#F4F4F5' }]}>
                <Ionicons name={app.icon || 'apps-outline'} size={16} color={app.accent || '#52525B'} />
              </View>
              <Text style={styles.appRowLabel}>{app.label}</Text>
              <AccessToggle on={on} disabled={locked} onPress={() => toggleApp(app.key)} />
            </View>
          );
        })}
      </View>

      <Pressable
        style={[styles.saveButton, saving && styles.saveButtonDisabled]}
        onPress={handleSave}
        disabled={saving}
      >
        {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveButtonText}>Save defaults</Text>}
      </Pressable>

      {error ? <Text style={[styles.errorText, styles.feedbackSpaced]}>{error}</Text> : null}
      {message ? <Text style={[styles.savedText, styles.feedbackSpaced]}>{message}</Text> : null}
    </>
  );
}

function DevicePermissionsPanel() {
  const [statuses, setStatuses] = useState({
    camera: 'loading',
    microphone: 'loading',
  });
  const [requesting, setRequesting] = useState(null);
  const [message, setMessage] = useState('');

  const refreshStatuses = async () => {
    const [camera, microphone] = await Promise.all([
      queryMediaPermission('camera'),
      queryMediaPermission('microphone'),
    ]);
    setStatuses({ camera, microphone });
  };

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const [camera, microphone] = await Promise.all([
        queryMediaPermission('camera'),
        queryMediaPermission('microphone'),
      ]);
      if (cancelled) return;
      setStatuses({ camera, microphone });
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const requestPermission = async (item) => {
    if (requesting) return;
    setMessage('');
    setRequesting(item.key);

    if (Platform.OS !== 'web' || !navigator?.mediaDevices?.getUserMedia) {
      setStatuses((current) => ({ ...current, [item.key]: 'unsupported' }));
      setMessage('This permission can only be managed in a browser session.');
      setRequesting(null);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia(item.media);
      stream.getTracks().forEach((track) => track.stop());
      await refreshStatuses();
      setMessage(`${item.label} access allowed.`);
    } catch {
      await refreshStatuses();
      setMessage(
        `${item.label} access was blocked. You can enable it in your browser site settings.`,
      );
    } finally {
      setRequesting(null);
    }
  };

  return (
    <View>
      <Text style={[styles.sectionTitle, styles.sectionTitleSpaced]}>Device access</Text>
      <Text style={styles.aiIntro}>
        Grant camera and microphone access used for profile portraits and Serphint, or update it
        later in your browser settings if it was blocked.
      </Text>

      {PERMISSION_ITEMS.map((item) => {
        const status = statuses[item.key];
        const busy = requesting === item.key;
        const canRequest = status !== 'unsupported' && status !== 'loading';

        return (
          <View key={item.key} style={styles.permissionRow}>
            <View style={[styles.menuIcon, { backgroundColor: item.tint }]}>
              <Ionicons name={item.icon} size={16} color={item.accent} />
            </View>
            <View style={styles.menuTextWrap}>
              <Text style={styles.menuLabel}>{item.label}</Text>
              <Text style={styles.menuHint}>{item.description}</Text>
              <Text style={[styles.permissionStatus, { color: permissionStatusColor(status) }]}>
                {permissionStatusLabel(status)}
              </Text>
            </View>
            {canRequest ? (
              <Pressable
                style={[styles.permissionButton, busy && styles.saveButtonDisabled]}
                onPress={() => void requestPermission(item)}
                disabled={busy}
              >
                {busy ? (
                  <ActivityIndicator color="#1a1a1a" />
                ) : (
                  <Text style={styles.permissionButtonText}>
                    {status === 'granted' ? 'Recheck' : 'Allow'}
                  </Text>
                )}
              </Pressable>
            ) : null}
          </View>
        );
      })}

      {message ? <Text style={styles.permissionMessage}>{message}</Text> : null}
    </View>
  );
}

function PermissionsPanel({ session, apps, canManageAccess, onAccessSaved, onStaffAccessSaved, onUserAccessSaved }) {
  return (
    <ScrollView style={styles.body} contentContainerStyle={styles.permissionsContent}>
      {canManageAccess ? (
        <AppAccessPanel
          session={session}
          apps={apps}
          onAccessSaved={onAccessSaved}
          onStaffAccessSaved={onStaffAccessSaved}
          onUserAccessSaved={onUserAccessSaved}
        />
      ) : (
        <>
          <Text style={styles.sectionTitle}>App visibility</Text>
          <Text style={styles.aiIntro}>
            A System Admin sets which apps you can open and whether you can filter inside each
            one. Ask them if you need access to another tool.
          </Text>
        </>
      )}
      <DevicePermissionsPanel />
    </ScrollView>
  );
}

function AiModelsPanel() {
  const [keys, setKeys] = useState(emptyKeys);
  const [shared, setShared] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [revealed, setRevealed] = useState({});

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const state = await loadCompanyAiKeyState();
        if (cancelled) return;
        setKeys(state.keys);
        setShared(Boolean(state.shared));
        setUnavailable(Boolean(state.unavailable));
      } catch (nextError) {
        if (cancelled) return;
        setError(nextError?.message || 'Could not load API keys.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const updateKey = (providerKey, value) => {
    setSaved(false);
    setError('');
    setKeys((current) => ({ ...current, [providerKey]: value }));
  };

  const toggleReveal = (providerKey) => {
    setRevealed((current) => ({ ...current, [providerKey]: !current[providerKey] }));
  };

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      const trimmed = Object.fromEntries(
        Object.entries(keys).map(([key, value]) => [key, String(value || '').trim()]),
      );
      await saveAiApiKeys(trimmed);
      setKeys(trimmed);
      setShared(true);
      setUnavailable(false);
      setSaved(true);
    } catch (nextError) {
      setError(nextError?.message || 'Could not save API keys.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color="#1a1a1a" />
      </View>
    );
  }

  return (
    <ScrollView style={styles.body} contentContainerStyle={styles.aiContent}>
      <Text style={styles.aiIntro}>
        These keys are shared with every signed-in employee. Analysts can run AI chat and
        generate portraits without pasting a key. Only a System Admin or General Manager can
        open this screen or see the values.
      </Text>
      {unavailable ? (
        <Text style={styles.errorText}>
          The company key table is not in the database yet. Run the latest Supabase migration,
          then save again.
        </Text>
      ) : null}
      {!shared && !unavailable && Object.values(keys).some(Boolean) ? (
        <Text style={styles.savedText}>
          These keys are only on this device until you save. Saving shares them with everyone.
        </Text>
      ) : null}

      {AI_MODEL_PROVIDERS.map((provider) => (
        <View key={provider.key} style={styles.providerBlock}>
          <Text style={styles.providerLabel}>{provider.label}</Text>
          <Text style={styles.providerDescription}>{provider.description}</Text>
          <View style={styles.keyField}>
            <TextInput
              style={styles.keyInput}
              value={keys[provider.key] || ''}
              onChangeText={(value) => updateKey(provider.key, value)}
              placeholder={provider.placeholder}
              placeholderTextColor="#999"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="off"
              spellCheck={false}
              secureTextEntry={!revealed[provider.key]}
            />
            <Pressable
              onPress={() => toggleReveal(provider.key)}
              hitSlop={8}
              accessibilityLabel={revealed[provider.key] ? 'Hide API key' : 'Show API key'}
            >
              <Ionicons
                name={revealed[provider.key] ? 'eye-off-outline' : 'eye-outline'}
                size={16}
                color="#8a8a8a"
              />
            </Pressable>
          </View>
        </View>
      ))}

      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      {saved ? <Text style={styles.savedText}>API keys saved for everyone in the app.</Text> : null}

      <Pressable
        style={[styles.saveButton, saving && styles.saveButtonDisabled]}
        onPress={handleSave}
        disabled={saving}
      >
        {saving ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.saveButtonText}>Save</Text>
        )}
      </Pressable>
    </ScrollView>
  );
}

function AiModelsDenied() {
  return (
    <ScrollView style={styles.body} contentContainerStyle={styles.aiContent}>
      <Text style={styles.sectionTitle}>AI models</Text>
      <Text style={styles.aiIntro}>
        Company AI keys are managed by a System Admin or General Manager. Ask them if portraits
        or AI chat are not working.
      </Text>
    </ScrollView>
  );
}

function DatabasePanel() {
  const [status, setStatus] = useState(null);

  useEffect(() => {
    let cancelled = false;
    getSupabaseConnectionStatus()
      .then((next) => {
        if (!cancelled) setStatus(next);
      })
      .catch((error) => {
        if (!cancelled) {
          setStatus({
            configured: false,
            reachable: false,
            keyKind: 'missing',
            message: error?.message || 'Could not check the database connection.',
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!status) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color="#1a1a1a" />
      </View>
    );
  }

  const ready = Boolean(status.configured && status.reachable);

  return (
    <ScrollView style={styles.body} contentContainerStyle={styles.aiContent}>
      <Text style={styles.aiIntro}>
        The app talks to Supabase over HTTPS with a publishable key only. Secret and service_role
        keys are rejected in the client. Row Level Security must stay enabled on every table so a
        public build cannot read sensitive rows.
      </Text>

      <View style={styles.permissionRow}>
        <View style={[styles.menuIcon, { backgroundColor: ready ? '#EAF6EE' : '#FFF6E8' }]}>
          <Ionicons
            name={ready ? 'shield-checkmark-outline' : 'warning-outline'}
            size={16}
            color={ready ? '#2F8A4E' : '#B54708'}
          />
        </View>
        <View style={styles.menuTextWrap}>
          <Text style={styles.menuLabel}>{ready ? 'Connected' : 'Not ready'}</Text>
          <Text style={styles.menuHint}>{status.message}</Text>
        </View>
      </View>

      <View style={styles.providerBlock}>
        <Text style={styles.providerLabel}>Project URL</Text>
        <Text style={styles.providerDescription}>{status.url || '—'}</Text>
      </View>

      <View style={styles.providerBlock}>
        <Text style={styles.providerLabel}>Client key</Text>
        <Text style={styles.providerDescription}>
          {status.keyKind === 'publishable' || status.keyKind === 'anon'
            ? 'Publishable / anon key loaded from environment'
            : 'Set EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY in .env.local, then restart Expo'}
        </Text>
      </View>
    </ScrollView>
  );
}

export default function SettingsScreen({
  panel,
  onOpenPanel,
  session,
  apps,
  storeName,
  onAccessSaved,
  onStaffAccessSaved,
  onUserAccessSaved,
}) {
  const canManageAccess = canManageAppAccess(session?.profile);
  const canManageAiKeys = canManageCompanyAiKeys(session?.profile);
  const canManagePhone = canManageRingCentral(session?.profile);
  const { hasApp } = useAppAccess();
  const showRingCentral = canManagePhone || hasApp('phone');

  if (panel === 'ai-models') {
    return canManageAiKeys ? <AiModelsPanel /> : <AiModelsDenied />;
  }

  if (panel === 'permissions') {
    return (
      <PermissionsPanel
        session={session}
        apps={apps}
        canManageAccess={canManageAccess}
        onAccessSaved={onAccessSaved}
        onStaffAccessSaved={onStaffAccessSaved}
        onUserAccessSaved={onUserAccessSaved}
      />
    );
  }

  if (panel === 'database') {
    return <DatabasePanel />;
  }

  if (panel === 'store-settings') {
    return <StoreSettingsPanel session={session} storeName={storeName} />;
  }

  if (panel === 'ringcentral') {
    return <RingCentralSettingsPanel session={session} storeName={storeName} />;
  }

  return (
    <SettingsHome
      onOpenAiModels={() => onOpenPanel('ai-models')}
      onOpenPermissions={() => onOpenPanel('permissions')}
      onOpenDatabase={() => onOpenPanel('database')}
      onOpenStoreSettings={() => onOpenPanel('store-settings')}
      onOpenRingCentral={() => onOpenPanel('ringcentral')}
      canManageAiKeys={canManageAiKeys}
      canManagePhone={canManagePhone}
      showRingCentral={showRingCentral}
    />
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    minHeight: 0,
    marginTop: 20,
    alignSelf: 'stretch',
  },
  bodyMobile: {
    marginTop: 8,
    backgroundColor: '#f2f2f7',
  },
  menuRowMobile: {
    borderRadius: 14,
    borderColor: 'rgba(60,60,67,0.12)',
    paddingVertical: 14,
  },
  centered: {
    flex: 1,
    minHeight: 120,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 20,
  },
  menuList: {
    gap: 10,
    maxWidth: 480,
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e5e5',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 12,
    backgroundColor: '#fff',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  permissionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e5e5',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 12,
    backgroundColor: '#fff',
    marginBottom: 10,
  },
  permissionStatus: {
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
    marginTop: 4,
  },
  permissionButton: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#d0d0d0',
    borderRadius: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    minWidth: 72,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  permissionButtonText: {
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  permissionMessage: {
    fontFamily,
    fontSize: 12,
    color: '#6b6b6b',
    marginTop: 8,
    lineHeight: 17,
  },
  menuIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  menuTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  menuLabel: {
    fontFamily,
    fontSize: 14,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  menuHint: {
    fontFamily,
    fontSize: 12,
    color: '#8a8a8a',
    marginTop: 2,
  },
  aiContent: {
    paddingBottom: 32,
    maxWidth: 480,
  },
  aiIntro: {
    fontFamily,
    fontSize: 13,
    color: '#6b6b6b',
    marginBottom: 20,
    lineHeight: 18,
  },
  providerBlock: {
    marginBottom: 18,
  },
  providerLabel: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  providerDescription: {
    fontFamily,
    fontSize: 12,
    color: '#8a8a8a',
    marginTop: 2,
    marginBottom: 8,
  },
  keyField: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#d0d0d0',
    borderRadius: 6,
    paddingHorizontal: 12,
    backgroundColor: '#fff',
    gap: 8,
  },
  keyInput: {
    flex: 1,
    fontFamily,
    fontSize: 13,
    color: '#1a1a1a',
    paddingVertical: 10,
    outlineStyle: 'none',
  },
  errorText: {
    fontFamily,
    fontSize: 12,
    color: '#b42318',
    marginBottom: 12,
  },
  savedText: {
    fontFamily,
    fontSize: 12,
    color: '#2F8A4E',
    marginBottom: 12,
  },
  saveButton: {
    marginTop: 4,
    backgroundColor: '#1a1a1a',
    borderRadius: 6,
    paddingVertical: 10,
    alignItems: 'center',
    minHeight: 40,
    justifyContent: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: 24,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  saveButtonDisabled: {
    opacity: 0.7,
  },
  saveButtonText: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: '#fff',
  },
  permissionsContent: {
    paddingBottom: 40,
    maxWidth: 1080,
  },
  sectionTitle: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: '#1a1a1a',
    marginBottom: 8,
  },
  sectionTitleSpaced: {
    marginTop: 28,
  },
  categoryTabs: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 8,
  },
  categoryTab: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#d0d0d0',
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: '#fff',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  categoryTabSelected: {
    backgroundColor: '#1a1a1a',
    borderColor: '#1a1a1a',
  },
  categoryTabText: {
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  categoryTabTextSelected: {
    color: '#fff',
  },
  appList: {
    marginTop: 12,
    marginBottom: 12,
  },
  appRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#efefef',
  },
  appRowLabel: {
    flex: 1,
    fontFamily,
    fontSize: 13,
    color: '#1a1a1a',
  },
  toggleTrack: {
    width: 40,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#e5e5e5',
    padding: 2,
    justifyContent: 'center',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  toggleTrackOn: {
    backgroundColor: '#1a1a1a',
  },
  toggleThumb: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#fff',
    alignSelf: 'flex-start',
  },
  toggleThumbOn: {
    alignSelf: 'flex-end',
  },
  toggleDisabled: {
    opacity: 0.55,
    ...Platform.select({
      web: { cursor: 'default' },
      default: {},
    }),
  },
  staffTableItem: {
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#efefef',
    backgroundColor: '#fff',
    gap: 10,
  },
  staffTable: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e5e5',
    borderRadius: 10,
    backgroundColor: '#fff',
    overflow: 'hidden',
    marginBottom: 4,
  },
  staffTableHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#fafafa',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ececec',
    gap: 8,
  },
  staffTableRow: {
    alignItems: 'center',
    gap: 8,
  },
  staffHeaderText: {
    fontFamily,
    fontSize: 11,
    fontWeight: '600',
    color: '#9a9a9a',
    letterSpacing: 0.2,
  },
  staffCell: {
    fontFamily,
    fontSize: 12,
    color: '#1a1a1a',
  },
  staffColName: {
    flex: 1.5,
    minWidth: 160,
  },
  staffColStore: {
    width: '16%',
    minWidth: 90,
  },
  staffColRole: {
    width: 188,
    minWidth: 168,
  },
  staffColApps: {
    flex: 1,
    minWidth: 110,
  },
  staffColActions: {
    width: 132,
    minWidth: 120,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 6,
  },
  staffColChevron: {
    width: 18,
    alignItems: 'flex-end',
  },
  staffRoleCell: {
    justifyContent: 'center',
  },
  staffNameLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  staffToolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
  },
  staffSearchInToolbar: {
    flex: 1,
    marginBottom: 0,
  },
  staffCount: {
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
    color: '#8a8a8a',
  },
  roleFilters: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 12,
  },
  roleFilterChip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#d0d0d0',
    borderRadius: 999,
    paddingVertical: 5,
    paddingHorizontal: 10,
    backgroundColor: '#fff',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  roleFilterChipSelected: {
    borderColor: '#1a1a1a',
    backgroundColor: '#1a1a1a',
  },
  roleFilterText: {
    fontFamily,
    fontSize: 11,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  roleFilterTextSelected: {
    color: '#fff',
  },
  roleBadge: {
    borderRadius: 999,
    paddingVertical: 3,
    paddingHorizontal: 8,
    alignSelf: 'flex-start',
  },
  roleBadgeText: {
    fontFamily,
    fontSize: 11,
    fontWeight: '700',
  },
  staffMobileMeta: {
    fontFamily,
    fontSize: 12,
    color: '#8a8a8a',
    flexBasis: '100%',
    marginTop: 2,
  },
  staffControls: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  categoryChipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  categoryChip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#d0d0d0',
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 8,
    backgroundColor: '#fff',
  },
  categoryChipSelected: {
    backgroundColor: '#1a1a1a',
    borderColor: '#1a1a1a',
  },
  categoryChipText: {
    fontFamily,
    fontSize: 11,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  categoryChipTextSelected: {
    color: '#fff',
  },
  adminFlag: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#d0d0d0',
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: '#fff',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  adminFlagOn: {
    backgroundColor: '#EEF4FF',
    borderColor: '#3B6FE0',
  },
  adminFlagText: {
    fontFamily,
    fontSize: 11,
    fontWeight: '600',
    color: '#6b6b6b',
  },
  adminFlagTextOn: {
    color: '#3B6FE0',
  },
  staffRowDisabled: {
    backgroundColor: '#fafafa',
    borderColor: '#ececec',
  },
  accessFlagOff: {
    backgroundColor: '#FFF1F0',
    borderColor: '#D92D20',
  },
  accessFlagOffText: {
    color: '#B42318',
  },
  staffSearch: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#d0d0d0',
    borderRadius: 6,
    paddingHorizontal: 10,
    backgroundColor: '#fff',
    marginBottom: 12,
    gap: 8,
  },
  staffSearchInput: {
    flex: 1,
    fontFamily,
    fontSize: 13,
    color: '#1a1a1a',
    paddingVertical: 10,
    outlineStyle: 'none',
  },
  staffHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  personApps: {
    marginTop: 4,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#efefef',
    gap: 4,
  },
  appAccessHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 8,
    paddingBottom: 4,
  },
  appAccessHeaderLabel: {
    flex: 1,
    fontFamily,
    fontSize: 11,
    fontWeight: '600',
    color: '#8a8a8a',
    marginLeft: 44,
  },
  appAccessColLabel: {
    width: 40,
    fontFamily,
    fontSize: 11,
    fontWeight: '600',
    color: '#8a8a8a',
    textAlign: 'center',
  },
  appAccessColLabelFilter: {
    marginLeft: 8,
  },
  filterToggleWrap: {
    width: 40,
    alignItems: 'center',
    marginLeft: 8,
  },
  personAppActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
  },
  resetButton: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#d0d0d0',
    borderRadius: 6,
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: '#fff',
    minHeight: 40,
    justifyContent: 'center',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  resetButtonText: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  feedbackSpaced: {
    marginTop: 16,
  },
});
