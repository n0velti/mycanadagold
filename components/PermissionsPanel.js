import { createElement, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useIsMobile } from '../lib/mobileUi';
import {
  USER_CATEGORIES,
  USER_CATEGORY_KEYS,
  accessListsEqual,
  applyFilterablePatch,
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
  saveUserAppAccessBatch,
  updateStaffAccess,
} from '../lib/permissions';
import { IosGroup, IosPage, IosRow, IosSwitch } from './IosSettings';
import {
  Chip,
  EmptyState,
  FONT,
  SearchField,
  SectionLabel,
  StaffAvatar,
  T,
  TextTabs,
} from './TriageKit';

const PERMISSION_TABS = [
  { key: 'people', label: 'People' },
  { key: 'roles', label: 'Role defaults' },
  { key: 'device', label: 'This device' },
];

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
  const isMobile = useIsMobile();
  if (isMobile) {
    return <IosSwitch on={on} disabled={disabled} onPress={onPress} />;
  }

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
    role === 'general_manager' && isSystemAdmin ? 'GM · Admin' : category?.shortLabel || '—';
  return (
    <View style={[styles.roleBadge, { backgroundColor: tint }]}>
      <Text style={[styles.roleBadgeText, { color: accent }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function RoleField({ value, onChange, disabled }) {
  const category = getCategory(value);
  if (Platform.OS === 'web') {
    return (
      <View style={styles.ticketField}>
        <Text style={styles.fieldLabel}>Role</Text>
        <View style={styles.roleSelectRow}>
          {createElement(
            'select',
            {
              value,
              disabled,
              onChange: (event) => onChange(event.target.value),
              style: {
                fontFamily: FONT,
                fontSize: 16,
                fontWeight: '600',
                color: disabled ? '#8E8E93' : '#1D1D1F',
                border: 'none',
                outline: 'none',
                background: 'transparent',
                flex: 1,
                minWidth: 0,
                padding: 0,
                margin: 0,
                appearance: 'none',
                WebkitAppearance: 'none',
                cursor: disabled ? 'default' : 'pointer',
              },
            },
            USER_CATEGORIES.map((item) =>
              createElement('option', { key: item.key, value: item.key }, item.label),
            ),
          )}
          <Ionicons name="chevron-down" size={16} color="#8E8E93" />
        </View>
        <Text style={styles.fieldHint}>{category?.description || ''}</Text>
      </View>
    );
  }

  return (
    <View style={styles.ticketField}>
      <Text style={styles.fieldLabel}>Role</Text>
      <View style={styles.roleChipWrap}>
        {USER_CATEGORIES.map((item) => {
          const selected = item.key === value;
          return (
            <Pressable
              key={item.key}
              onPress={() => onChange(item.key)}
              disabled={disabled}
              style={[styles.roleChip, selected && { backgroundColor: item.accent }]}
            >
              <Text style={[styles.roleChipText, selected && styles.roleChipTextOn]}>
                {item.shortLabel}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {category ? <Text style={styles.fieldHint}>{category.description}</Text> : null}
    </View>
  );
}

function staffName(row) {
  return (
    row.fullName ||
    [row.firstName, row.lastName].filter(Boolean).join(' ') ||
    row.email ||
    row.aureusLogin ||
    'Staff'
  );
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

function accessLine(row, accessByRole, userAccessMap, catalogKeys) {
  if (hasFullAppAccess(row)) return 'Every app';
  const resolved = resolvedAccessForProfile(row, accessByRole, catalogKeys, userAccessMap[row.id]);
  const custom = resolved.inherited ? 'Role defaults' : 'Custom apps';
  return `${resolved.visibleApps.length} apps · ${custom}`;
}

function FilterBulkState({ value, onChange, disabled }) {
  const options = [
    { key: '', label: 'Leave' },
    { key: 'on', label: 'On' },
    { key: 'off', label: 'Off' },
  ];
  return (
    <View style={styles.bulkStateRow}>
      {options.map((option) => {
        const selected = (value || '') === option.key;
        return (
          <Pressable
            key={option.key || 'leave'}
            onPress={() => onChange(option.key)}
            disabled={disabled}
            style={[
              styles.bulkStateChip,
              selected && styles.bulkStateChipSelected,
              disabled && styles.toggleDisabled,
            ]}
          >
            <Text style={[styles.bulkStateChipText, selected && styles.bulkStateChipTextSelected]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function DevicePermissionsPanel() {
  const isMobile = useIsMobile();
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
      setMessage(`${item.label} access was blocked. You can enable it in your browser site settings.`);
    } finally {
      setRequesting(null);
    }
  };

  if (isMobile) {
    return (
      <IosGroup
        header="Privacy"
        footer={
          message ||
          'Camera and microphone are used for portraits and Serphint. If a row says Blocked, allow access in this browser’s site settings.'
        }
      >
        {PERMISSION_ITEMS.map((item) => {
          const status = statuses[item.key];
          const busy = requesting === item.key;
          const canRequest = status !== 'unsupported' && status !== 'loading';
          return (
            <IosRow
              key={item.key}
              icon={item.key === 'camera' ? 'camera' : 'mic'}
              iconColor={item.key === 'camera' ? '#007AFF' : '#AF52DE'}
              label={item.label}
              value={busy ? 'Checking…' : permissionStatusLabel(status)}
              onPress={canRequest ? () => void requestPermission(item) : undefined}
            />
          );
        })}
      </IosGroup>
    );
  }

  return (
    <ScrollView style={styles.paneScroll} contentContainerStyle={styles.deviceContent}>
      <View style={styles.ticketCard}>
        <Text style={styles.cardTitle}>This browser</Text>
        <Text style={styles.cardIntro}>
          Camera and microphone are used for portraits and Serphint. If access was blocked, allow it
          in this browser’s site settings.
        </Text>
        {PERMISSION_ITEMS.map((item, index) => {
          const status = statuses[item.key];
          const busy = requesting === item.key;
          const canRequest = status !== 'unsupported' && status !== 'loading';
          return (
            <View
              key={item.key}
              style={[styles.deviceRow, index === PERMISSION_ITEMS.length - 1 && styles.deviceRowLast]}
            >
              <View style={[styles.appIcon, { backgroundColor: item.tint }]}>
                <Ionicons name={item.icon} size={16} color={item.accent} />
              </View>
              <View style={styles.flexCopy}>
                <Text style={styles.personName}>{item.label}</Text>
                <Text style={styles.personMeta}>{item.description}</Text>
                <Text style={[styles.statusText, { color: permissionStatusColor(status) }]}>
                  {permissionStatusLabel(status)}
                </Text>
              </View>
              {canRequest ? (
                <Pressable
                  style={[styles.ghostButton, busy && styles.buttonDisabled]}
                  onPress={() => void requestPermission(item)}
                  disabled={busy}
                >
                  {busy ? (
                    <ActivityIndicator color="#1a1a1a" />
                  ) : (
                    <Text style={styles.ghostButtonText}>
                      {status === 'granted' ? 'Recheck' : 'Allow'}
                    </Text>
                  )}
                </Pressable>
              ) : null}
            </View>
          );
        })}
      </View>
      {message ? <Text style={styles.savedText}>{message}</Text> : null}
    </ScrollView>
  );
}

function RoleDefaultsPane({ apps, catalogKeys, draft, locked, activeRole, onRoleChange, onToggleApp, onSave, saving, message, error }) {
  const activeCategory = USER_CATEGORIES.find((category) => category.key === activeRole);

  return (
    <ScrollView style={styles.paneScroll} contentContainerStyle={styles.rolesContent}>
      <View style={styles.ticketCard}>
        <Text style={styles.cardTitle}>Starting apps for each role</Text>
        <Text style={styles.cardIntro}>
          A person gets these apps until you save a custom set for them. System Admin always has
          every app. Home is always visible.
        </Text>
        <View style={styles.chipRow}>
          {USER_CATEGORIES.map((category) => (
            <Chip
              key={category.key}
              label={category.shortLabel}
              selected={category.key === activeRole}
              onPress={() => onRoleChange(category.key)}
            />
          ))}
        </View>
        {activeCategory ? <Text style={styles.fieldHint}>{activeCategory.description}</Text> : null}
      </View>

      <View style={styles.ticketCard}>
        <View style={styles.itemsHead}>
          <Text style={[styles.itemsHeadLabel, styles.colApp]}>App</Text>
          <Text style={styles.itemsHeadLabel}>Open</Text>
        </View>
        {(apps || [])
          .filter((app) => app.key !== 'home')
          .map((app, index, list) => {
            const on = locked || (draft[activeRole] || []).includes(app.key);
            return (
              <View key={app.key} style={[styles.appRow, index === list.length - 1 && styles.appRowLast]}>
                <View style={[styles.appIcon, { backgroundColor: app.tint || '#F4F4F5' }]}>
                  <Ionicons name={app.icon || 'apps-outline'} size={16} color={app.accent || '#52525B'} />
                </View>
                <Text style={styles.appRowLabel}>{app.label}</Text>
                <AccessToggle on={on} disabled={locked} onPress={() => onToggleApp(app.key)} />
              </View>
            );
          })}
      </View>

      <Pressable
        style={[styles.saveButton, saving && styles.buttonDisabled]}
        onPress={onSave}
        disabled={saving}
      >
        {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveButtonText}>Save defaults</Text>}
      </Pressable>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      {message ? <Text style={styles.savedText}>{message}</Text> : null}
    </ScrollView>
  );
}

function PersonDetail({
  row,
  actorId,
  apps,
  catalogKeys,
  draft,
  userAccessMap,
  personDraft,
  busy,
  personSaving,
  message,
  error,
  compact,
  onClose,
  onRoleChange,
  onToggleAdmin,
  onToggleActive,
  onToggleApp,
  onToggleFilter,
  onSaveApps,
  onResetApps,
}) {
  const resolved = resolvedAccessForProfile(row, draft, catalogKeys, userAccessMap[row.id]);
  const lockedPerson = hasFullAppAccess(row);
  const isSelf = row.id === actorId;
  const showAdminToggle = row.appRole === 'general_manager';
  const custom = Boolean(userAccessMap[row.id]);
  const title = staffTitle(row);

  return (
    <ScrollView
      style={styles.detailScroll}
      contentContainerStyle={styles.detailContent}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.heroCard}>
        {compact ? (
          <View style={styles.detailMobileHeader}>
            <Text style={styles.detailMobileTitle}>Access</Text>
            <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close">
              <Ionicons name="close" size={22} color={T.secondary} />
            </Pressable>
          </View>
        ) : null}
        <StaffAvatar uri={row.avatarUrl} name={staffName(row)} size={64} />
        <Text style={styles.heroName}>{staffName(row)}</Text>
        {title ? <Text style={styles.heroTitle}>{title}</Text> : null}
        <Text style={styles.heroMeta}>
          {[row.locationName || 'Store not set', row.isActive ? null : 'Access disabled']
            .filter(Boolean)
            .join(' · ')}
        </Text>
        <RoleBadge role={row.appRole} isSystemAdmin={row.isSystemAdmin} />
      </View>

      <View style={styles.ticketCard}>
        <Text style={styles.cardTitle}>Who they are in the app</Text>
        <RoleField
          value={row.appRole}
          disabled={busy || !row.isActive}
          onChange={onRoleChange}
        />
        <View style={styles.actionRow}>
          {showAdminToggle && row.isActive ? (
            <Pressable
              style={[styles.flagButton, row.isSystemAdmin && styles.flagButtonOn]}
              onPress={onToggleAdmin}
              disabled={busy}
            >
              <Text style={[styles.flagButtonText, row.isSystemAdmin && styles.flagButtonTextOn]}>
                {row.isSystemAdmin ? 'System Admin on' : 'Also System Admin'}
              </Text>
            </Pressable>
          ) : null}
          {!isSelf ? (
            <Pressable
              style={[styles.flagButton, !row.isActive && styles.flagButtonOff]}
              onPress={onToggleActive}
              disabled={busy}
            >
              <Text style={[styles.flagButtonText, !row.isActive && styles.flagButtonTextOff]}>
                {row.isActive ? 'Disable access' : 'Enable access'}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      <View style={styles.ticketCard}>
        <Text style={styles.cardTitle}>Apps they can open</Text>
        <Text style={styles.cardIntro}>
          {lockedPerson
            ? 'System Admin always sees every app and can filter in each one.'
            : custom
              ? 'Custom set for this person. Filter lets them change the store inside an app they can open.'
              : `Using ${getCategory(row.appRole)?.label || 'role'} defaults until you save a custom set.`}
        </Text>
        <View style={styles.itemsHead}>
          <Text style={[styles.itemsHeadLabel, styles.colApp]}>App</Text>
          <Text style={styles.itemsHeadLabel}>Open</Text>
          <Text style={[styles.itemsHeadLabel, styles.filterHead]}>Filter</Text>
        </View>
        {(apps || []).map((app, index, list) => {
          const visible = lockedPerson || personDraft.visibleApps.includes(app.key);
          const filterOn = lockedPerson || personDraft.filterableApps.includes(app.key);
          return (
            <View key={app.key} style={[styles.appRow, index === list.length - 1 && styles.appRowLast]}>
              <View style={[styles.appIcon, { backgroundColor: app.tint || '#F4F4F5' }]}>
                <Ionicons name={app.icon || 'apps-outline'} size={16} color={app.accent || '#52525B'} />
              </View>
              <Text style={styles.appRowLabel}>{app.label}</Text>
              <AccessToggle
                on={visible}
                disabled={lockedPerson || app.key === 'home'}
                onPress={() => onToggleApp(app.key)}
              />
              <View style={styles.filterToggleWrap}>
                <AccessToggle
                  on={visible && filterOn}
                  disabled={lockedPerson || !visible}
                  onPress={() => onToggleFilter(app.key)}
                />
              </View>
            </View>
          );
        })}
        {!lockedPerson ? (
          <View style={styles.personAppActions}>
            <Pressable
              style={[styles.saveButton, personSaving && styles.buttonDisabled]}
              onPress={onSaveApps}
              disabled={personSaving}
            >
              {personSaving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.saveButtonText}>Save apps</Text>
              )}
            </Pressable>
            {custom ? (
              <Pressable
                style={[styles.ghostButton, personSaving && styles.buttonDisabled]}
                onPress={onResetApps}
                disabled={personSaving}
              >
                <Text style={styles.ghostButtonText}>Use role defaults</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      {message ? <Text style={styles.savedText}>{message}</Text> : null}
      {resolved.inherited && !lockedPerson ? (
        <Text style={styles.footerHint}>
          Changing their role updates these apps to that role’s defaults, then saves.
        </Text>
      ) : null}
    </ScrollView>
  );
}

function AppAccessPanel({ session, apps, onAccessSaved, onStaffAccessSaved, onUserAccessSaved }) {
  const isMobile = useIsMobile();
  const catalogKeys = useMemo(() => (apps || []).map((app) => app.key), [apps]);
  const actorId = session?.supabaseUserId || session?.profile?.id;
  const [tab, setTab] = useState('people');
  const [activeRole, setActiveRole] = useState('precious_metal_analyst');
  const [draft, setDraft] = useState(() => defaultAccessByRole(catalogKeys));
  const [staff, setStaff] = useState([]);
  const [userAccessMap, setUserAccessMap] = useState({});
  const [staffQuery, setStaffQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [personDraft, setPersonDraft] = useState({ visibleApps: [], filterableApps: [] });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [personSaving, setPersonSaving] = useState(false);
  const [updatingId, setUpdatingId] = useState('');
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkTarget, setBulkTarget] = useState('matching');
  const [bulkFilterDraft, setBulkFilterDraft] = useState({});
  const [bulkSaving, setBulkSaving] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const locked = activeRole === 'system_admin';
  const selectedRow = staff.find((row) => row.id === selectedId) || null;

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

  const groupedStaff = useMemo(() => {
    const map = new Map();
    for (const row of visibleStaff) {
      const key = row.locationName || 'No location';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(row);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [visibleStaff]);

  const selectableStaff = useMemo(() => staff.filter((row) => !hasFullAppAccess(row)), [staff]);
  const selectableVisible = useMemo(
    () => visibleStaff.filter((row) => !hasFullAppAccess(row)),
    [visibleStaff],
  );
  const selectedCount = selectedIds.size;
  const bulkPatchCount = Object.values(bulkFilterDraft).filter(
    (value) => value === 'on' || value === 'off',
  ).length;
  const bulkTargetPeople = useMemo(() => {
    if (bulkTarget === 'selected') {
      return staff.filter((row) => selectedIds.has(row.id) && !hasFullAppAccess(row));
    }
    if (bulkTarget === 'all') return selectableStaff;
    return selectableVisible;
  }, [bulkTarget, staff, selectedIds, selectableStaff, selectableVisible]);
  const bulkTargetCount = bulkTargetPeople.length;

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

  useEffect(() => {
    const valid = new Set(staff.map((row) => row.id));
    setSelectedIds((current) => {
      let changed = false;
      const next = new Set();
      current.forEach((id) => {
        if (valid.has(id)) next.add(id);
        else changed = true;
      });
      return changed ? next : current;
    });
    if (selectedId && !valid.has(selectedId)) setSelectedId('');
  }, [staff, selectedId]);

  const openPerson = (row) => {
    const resolved = resolvedAccessForProfile(row, draft, catalogKeys, userAccessMap[row.id]);
    setPersonDraft(personDraftFromResolved(resolved));
    setSelectedId(row.id);
    setMessage('');
    setError('');
  };

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

  const handleSaveDefaults = async () => {
    if (saving) return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const next = await saveRoleAppAccess(draft, catalogKeys, actorId);
      setDraft(next);
      onAccessSaved?.(next);
      if (selectedRow && !userAccessMap[selectedRow.id] && !hasFullAppAccess(selectedRow)) {
        setPersonDraft(
          personDraftFromResolved(resolvedAccessForProfile(selectedRow, next, catalogKeys, null)),
        );
      }
      setMessage('Role defaults saved.');
    } catch (nextError) {
      setError(nextError?.message || 'Could not save app visibility.');
    } finally {
      setSaving(false);
    }
  };

  const togglePersonApp = (appKey) => {
    if (hasFullAppAccess(selectedRow) || personSaving) return;
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
    if (hasFullAppAccess(selectedRow) || personSaving) return;
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
    if (personSaving || hasFullAppAccess(row)) return;
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
    if (personSaving || hasFullAppAccess(row)) return;
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
      setMessage(`Restored ${staffName(row)} to ${getCategory(row.appRole)?.label || 'role'} defaults.`);
    } catch (nextError) {
      setError(nextError?.message || 'Could not restore role defaults.');
    } finally {
      setPersonSaving(false);
    }
  };

  const handleStaffChange = async (row, patch) => {
    if (updatingId) return;
    const nextRole = normalizeRole(patch.appRole ?? row.appRole);
    const nextAdmin =
      nextRole === 'system_admin'
        ? true
        : nextRole === 'general_manager'
          ? Boolean(patch.isSystemAdmin ?? row.isSystemAdmin)
          : false;
    const nextActive = patch.isActive ?? row.isActive;
    const optimistic = { ...row, appRole: nextRole, isSystemAdmin: nextAdmin, isActive: nextActive };

    setUpdatingId(row.id);
    setError('');
    setMessage('');
    setStaff((current) => current.map((entry) => (entry.id === row.id ? optimistic : entry)));
    if (selectedId === row.id && !userAccessMap[row.id] && !hasFullAppAccess(optimistic)) {
      setPersonDraft(
        personDraftFromResolved(resolvedAccessForProfile(optimistic, draft, catalogKeys, null)),
      );
    }

    try {
      const updated = await updateStaffAccess(row.id, {
        appRole: nextRole,
        isSystemAdmin: nextAdmin,
        isActive: nextActive,
      });
      setStaff((current) => current.map((entry) => (entry.id === updated.id ? { ...entry, ...updated } : entry)));
      onStaffAccessSaved?.(updated);
      if (selectedId === updated.id && !userAccessMap[updated.id] && !hasFullAppAccess(updated)) {
        setPersonDraft(
          personDraftFromResolved(resolvedAccessForProfile(updated, draft, catalogKeys, null)),
        );
      }
      setMessage(`Saved ${staffName(updated)} as ${getCategory(updated.appRole)?.label || 'their role'}.`);
    } catch (nextError) {
      setStaff((current) => current.map((entry) => (entry.id === row.id ? row : entry)));
      if (selectedId === row.id && !userAccessMap[row.id]) {
        setPersonDraft(
          personDraftFromResolved(resolvedAccessForProfile(row, draft, catalogKeys, userAccessMap[row.id])),
        );
      }
      setError(nextError?.message || 'Could not update that person.');
    } finally {
      setUpdatingId('');
    }
  };

  const toggleSelected = (row) => {
    if (hasFullAppAccess(row) || bulkSaving) return;
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(row.id)) next.delete(row.id);
      else next.add(row.id);
      return next;
    });
    setBulkOpen(true);
    setBulkTarget('selected');
    setMessage('');
  };

  const handleBulkApplyFilters = async () => {
    if (bulkSaving) return;
    const patch = {};
    Object.entries(bulkFilterDraft).forEach(([key, value]) => {
      if (value === 'on') patch[key] = true;
      else if (value === 'off') patch[key] = false;
    });
    setError('');
    setMessage('');
    if (Object.keys(patch).length === 0) {
      setError('Choose On or Off for at least one app filter.');
      return;
    }
    if (bulkTargetCount === 0) {
      setError(
        bulkTarget === 'selected'
          ? 'Select at least one employee, or apply to this list / everyone.'
          : 'No employees match that target.',
      );
      return;
    }

    setBulkSaving(true);
    try {
      const entries = [];
      for (const row of bulkTargetPeople) {
        const current = resolvedAccessForProfile(row, draft, catalogKeys, userAccessMap[row.id]);
        if (current.locked) continue;
        const next = applyFilterablePatch(current, patch, catalogKeys);
        if (accessListsEqual(current, next)) continue;
        entries.push({ userId: row.id, ...next });
      }
      if (entries.length === 0) {
        setMessage('Those people already have that filter setting.');
        return;
      }
      const saved = await saveUserAppAccessBatch(entries, catalogKeys, actorId);
      const savedById = Object.fromEntries(saved.map((entry) => [entry.userId, entry]));
      setUserAccessMap((current) => ({ ...current, ...savedById }));
      saved.forEach((entry) => onUserAccessSaved?.(entry.userId, entry));
      if (selectedRow && savedById[selectedRow.id] && !hasFullAppAccess(selectedRow)) {
        setPersonDraft(personDraftFromResolved(savedById[selectedRow.id]));
      }
      setMessage(
        `Updated filters for ${saved.length} ${saved.length === 1 ? 'person' : 'people'}.`,
      );
    } catch (nextError) {
      setError(nextError?.message || 'Could not update those filters.');
    } finally {
      setBulkSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={T.text} />
      </View>
    );
  }

  const peopleList = (
    <View style={styles.listPane}>
      <SearchField
        value={staffQuery}
        onChangeText={setStaffQuery}
        placeholder="Search name, role, store…"
        style={styles.searchField}
      />
      <View style={styles.chipRow}>
        <Chip
          label="All"
          count={staff.length}
          selected={!roleFilter}
          onPress={() => setRoleFilter('')}
        />
        {USER_CATEGORIES.map((category) => (
          <Chip
            key={category.key}
            label={category.shortLabel}
            count={roleCounts[category.key] || 0}
            selected={roleFilter === category.key}
            onPress={() => setRoleFilter((current) => (current === category.key ? '' : category.key))}
          />
        ))}
      </View>

      <Pressable
        onPress={() => setBulkOpen((open) => !open)}
        style={styles.bulkToggle}
        accessibilityRole="button"
      >
        <Ionicons name="options-outline" size={15} color={T.text} />
        <Text style={styles.bulkToggleText}>Change filters for many people</Text>
        {selectedCount > 0 ? <Text style={styles.bulkCount}>{selectedCount}</Text> : null}
        <Ionicons name={bulkOpen ? 'chevron-up' : 'chevron-down'} size={15} color={T.secondary} />
      </Pressable>

      {bulkOpen ? (
        <View style={styles.ticketCard}>
          <Text style={styles.cardIntro}>
            Turn Filter on or off for the same apps across many people. Apps they can open stay the
            same.
          </Text>
          <View style={styles.chipRow}>
            {[
              { key: 'selected', label: `Selected ${selectedCount}` },
              { key: 'matching', label: `This list ${selectableVisible.length}` },
              { key: 'all', label: `Everyone ${selectableStaff.length}` },
            ].map((option) => (
              <Chip
                key={option.key}
                label={option.label}
                selected={bulkTarget === option.key}
                onPress={() => setBulkTarget(option.key)}
              />
            ))}
          </View>
          {(apps || []).map((app) => (
            <View key={app.key} style={styles.appRow}>
              <View style={[styles.appIcon, { backgroundColor: app.tint || '#F4F4F5' }]}>
                <Ionicons name={app.icon || 'apps-outline'} size={16} color={app.accent || '#52525B'} />
              </View>
              <Text style={styles.appRowLabel}>{app.label}</Text>
              <FilterBulkState
                value={bulkFilterDraft[app.key] || ''}
                disabled={bulkSaving}
                onChange={(value) => setBulkFilterDraft((current) => ({ ...current, [app.key]: value }))}
              />
            </View>
          ))}
          <Pressable
            style={[styles.saveButton, bulkSaving && styles.buttonDisabled]}
            onPress={() => void handleBulkApplyFilters()}
            disabled={bulkSaving}
          >
            {bulkSaving ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.saveButtonText}>
                {bulkPatchCount === 0
                  ? 'Apply filters'
                  : `Apply ${bulkPatchCount} to ${bulkTargetCount}`}
              </Text>
            )}
          </Pressable>
        </View>
      ) : null}

      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        {staff.length === 0 ? (
          <EmptyState icon="people-outline" title="No staff yet" body="People appear here after they sign in." />
        ) : visibleStaff.length === 0 ? (
          <EmptyState icon="search-outline" title="No match" body="No employees match that search." />
        ) : (
          groupedStaff.map(([groupName, rows]) => (
            <View key={groupName} style={styles.listGroup}>
              <SectionLabel>
                {groupName}
                {` · ${rows.length}`}
              </SectionLabel>
              <View style={styles.peopleList}>
                {rows.map((row, index) => {
                  const selected = selectedId === row.id;
                  const checked = selectedIds.has(row.id);
                  return (
                    <Pressable
                      key={row.id}
                      onPress={() => openPerson(row)}
                      style={[
                        styles.personRow,
                        selected && styles.personRowSelected,
                        !row.isActive && styles.personRowDisabled,
                        index === rows.length - 1 && styles.personRowLast,
                      ]}
                    >
                      {bulkOpen ? (
                        <Pressable
                          onPress={() => toggleSelected(row)}
                          disabled={hasFullAppAccess(row) || bulkSaving}
                          hitSlop={8}
                          style={styles.checkHit}
                        >
                          <Ionicons
                            name={checked ? 'checkbox' : 'square-outline'}
                            size={18}
                            color={checked ? T.text : T.tertiary}
                          />
                        </Pressable>
                      ) : null}
                      <StaffAvatar uri={row.avatarUrl} name={staffName(row)} size={40} />
                      <View style={styles.flexCopy}>
                        <Text style={styles.personName} numberOfLines={1}>
                          {staffName(row)}
                          {!row.isActive ? ' · Disabled' : ''}
                        </Text>
                        <Text style={styles.personMeta} numberOfLines={1}>
                          {accessLine(row, draft, userAccessMap, catalogKeys)}
                        </Text>
                      </View>
                      <RoleBadge role={row.appRole} isSystemAdmin={row.isSystemAdmin} />
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );

  const detail = selectedRow ? (
    <PersonDetail
      row={selectedRow}
      actorId={actorId}
      apps={apps}
      catalogKeys={catalogKeys}
      draft={draft}
      userAccessMap={userAccessMap}
      personDraft={personDraft}
      busy={updatingId === selectedRow.id}
      personSaving={personSaving}
      message={message}
      error={error}
      compact={isMobile}
      onClose={() => setSelectedId('')}
      onRoleChange={(appRole) => handleStaffChange(selectedRow, { appRole })}
      onToggleAdmin={() =>
        handleStaffChange(selectedRow, {
          appRole: selectedRow.appRole,
          isSystemAdmin: !selectedRow.isSystemAdmin,
        })
      }
      onToggleActive={() => handleStaffChange(selectedRow, { isActive: !selectedRow.isActive })}
      onToggleApp={togglePersonApp}
      onToggleFilter={togglePersonFilter}
      onSaveApps={() => handleSavePersonApps(selectedRow)}
      onResetApps={() => handleResetPersonApps(selectedRow)}
    />
  ) : (
    <EmptyState
      icon="person-circle-outline"
      title="Choose someone"
      body="Pick a person to change their role and the apps they can open."
    />
  );

  return (
    <View style={styles.panel}>
      <TextTabs options={PERMISSION_TABS} value={tab} onChange={setTab} />
      {tab === 'device' ? (
        isMobile ? (
          <IosPage>
            <DevicePermissionsPanel />
          </IosPage>
        ) : (
          <DevicePermissionsPanel />
        )
      ) : tab === 'roles' ? (
        <RoleDefaultsPane
          apps={apps}
          catalogKeys={catalogKeys}
          draft={draft}
          locked={locked}
          activeRole={activeRole}
          onRoleChange={setActiveRole}
          onToggleApp={toggleApp}
          onSave={handleSaveDefaults}
          saving={saving}
          message={message}
          error={error}
        />
      ) : isMobile && selectedRow ? (
        detail
      ) : (
        <View style={[styles.split, isMobile && styles.splitMobile]}>
          {peopleList}
          {isMobile ? null : <View style={styles.detailPane}>{detail}</View>}
        </View>
      )}
    </View>
  );
}

function normalizeRole(value) {
  return USER_CATEGORY_KEYS.includes(value) ? value : 'precious_metal_analyst';
}

export default function PermissionsPanel({
  session,
  apps,
  canManageAccess,
  onAccessSaved,
  onStaffAccessSaved,
  onUserAccessSaved,
}) {
  const isMobile = useIsMobile();

  if (!canManageAccess) {
    if (isMobile) {
      return (
        <IosPage>
          <IosGroup footer="A System Admin sets which apps you can open and whether you can filter inside each one.">
            <IosRow icon="lock-closed" iconColor="#007AFF" label="App visibility" value="Managed" />
          </IosGroup>
          <DevicePermissionsPanel />
        </IosPage>
      );
    }
    return (
      <View style={styles.panel}>
        <TextTabs
          options={[
            { key: 'people', label: 'People' },
            { key: 'device', label: 'This device' },
          ]}
          value="device"
          onChange={() => {}}
        />
        <View style={styles.ticketCard}>
          <Text style={styles.cardTitle}>App visibility</Text>
          <Text style={styles.cardIntro}>
            A System Admin sets which apps you can open and whether you can filter inside each one.
          </Text>
        </View>
        <DevicePermissionsPanel />
      </View>
    );
  }

  return (
    <AppAccessPanel
      session={session}
      apps={apps}
      onAccessSaved={onAccessSaved}
      onStaffAccessSaved={onStaffAccessSaved}
      onUserAccessSaved={onUserAccessSaved}
    />
  );
}

const styles = StyleSheet.create({
  panel: {
    flex: 1,
    minHeight: 0,
    marginTop: 8,
  },
  paneScroll: {
    flex: 1,
    minHeight: 0,
  },
  rolesContent: {
    paddingBottom: 40,
    paddingTop: 12,
    maxWidth: 720,
    gap: 12,
  },
  deviceContent: {
    paddingBottom: 40,
    paddingTop: 12,
    maxWidth: 560,
    gap: 12,
  },
  centered: {
    flex: 1,
    minHeight: 160,
    alignItems: 'center',
    justifyContent: 'center',
  },
  split: {
    flex: 1,
    minHeight: 0,
    flexDirection: 'row',
    gap: 16,
    paddingTop: 12,
  },
  splitMobile: {
    flexDirection: 'column',
  },
  listPane: {
    flex: 1.15,
    minWidth: 0,
    minHeight: 0,
    gap: 10,
  },
  detailPane: {
    flex: 1.2,
    minWidth: 320,
    maxWidth: 560,
    minHeight: 0,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: T.hairline,
    paddingLeft: 16,
  },
  searchField: {
    alignSelf: 'stretch',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  list: {
    flex: 1,
    minHeight: 0,
  },
  listContent: {
    paddingBottom: 32,
    gap: 4,
  },
  listGroup: {
    marginBottom: 8,
  },
  peopleList: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: T.hairline,
    borderRadius: 12,
    backgroundColor: T.card,
    overflow: 'hidden',
  },
  personRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ececef',
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  personRowSelected: {
    backgroundColor: '#F5F5F7',
  },
  personRowDisabled: {
    opacity: 0.62,
  },
  personRowLast: {
    borderBottomWidth: 0,
  },
  personName: {
    fontFamily: FONT,
    fontSize: 15,
    fontWeight: '600',
    color: T.text,
  },
  personMeta: {
    fontFamily: FONT,
    fontSize: 12,
    color: T.secondary,
    marginTop: 1,
  },
  flexCopy: {
    flex: 1,
    minWidth: 0,
  },
  checkHit: {
    width: 24,
    alignItems: 'center',
  },
  detailScroll: {
    flex: 1,
  },
  detailContent: {
    paddingBottom: 40,
    gap: 12,
  },
  heroCard: {
    alignItems: 'center',
    paddingVertical: 20,
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
    marginTop: 6,
  },
  heroTitle: {
    fontFamily: FONT,
    fontSize: 15,
    color: T.secondary,
    textAlign: 'center',
  },
  heroMeta: {
    fontFamily: FONT,
    fontSize: 13,
    color: T.secondary,
    textAlign: 'center',
  },
  detailMobileHeader: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  detailMobileTitle: {
    fontFamily: FONT,
    fontSize: 17,
    fontWeight: '600',
    color: T.text,
  },
  ticketCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: T.hairline,
    borderRadius: 12,
    backgroundColor: T.card,
    padding: 14,
    gap: 10,
  },
  cardTitle: {
    fontFamily: FONT,
    fontSize: 16,
    fontWeight: '700',
    color: T.text,
    letterSpacing: -0.3,
  },
  cardIntro: {
    fontFamily: FONT,
    fontSize: 13,
    lineHeight: 18,
    color: T.secondary,
  },
  ticketField: {
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: '#f6f6f9',
  },
  roleSelectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  fieldLabel: {
    fontFamily: FONT,
    fontSize: 11,
    fontWeight: '600',
    color: T.secondary,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  fieldHint: {
    fontFamily: FONT,
    fontSize: 12,
    lineHeight: 16,
    color: T.secondary,
  },
  roleChipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  roleChip: {
    borderRadius: 8,
    paddingVertical: 7,
    paddingHorizontal: 10,
    backgroundColor: T.fillSoft,
  },
  roleChipText: {
    fontFamily: FONT,
    fontSize: 13,
    fontWeight: '600',
    color: T.text,
  },
  roleChipTextOn: {
    color: '#fff',
  },
  roleBadge: {
    borderRadius: 999,
    paddingVertical: 3,
    paddingHorizontal: 8,
    alignSelf: 'flex-start',
  },
  roleBadgeText: {
    fontFamily: FONT,
    fontSize: 11,
    fontWeight: '700',
  },
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  flagButton: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: T.hairline,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: '#fff',
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  flagButtonOn: {
    backgroundColor: '#EEF4FF',
    borderColor: '#3B6FE0',
  },
  flagButtonOff: {
    backgroundColor: '#FFF1F0',
    borderColor: '#D92D20',
  },
  flagButtonText: {
    fontFamily: FONT,
    fontSize: 13,
    fontWeight: '600',
    color: T.secondary,
  },
  flagButtonTextOn: {
    color: '#3B6FE0',
  },
  flagButtonTextOff: {
    color: '#B42318',
  },
  itemsHead: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 32,
    paddingHorizontal: 4,
    backgroundColor: '#f6f6f9',
    borderRadius: 8,
  },
  itemsHeadLabel: {
    fontFamily: FONT,
    fontSize: 11,
    fontWeight: '600',
    color: T.secondary,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
    width: 44,
    textAlign: 'center',
  },
  colApp: {
    flex: 1,
    textAlign: 'left',
    paddingLeft: 44,
    width: undefined,
  },
  filterHead: {
    marginLeft: 8,
  },
  appRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ececef',
  },
  appRowLast: {
    borderBottomWidth: 0,
  },
  appIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  appRowLabel: {
    flex: 1,
    fontFamily: FONT,
    fontSize: 14,
    color: T.text,
  },
  filterToggleWrap: {
    width: 44,
    alignItems: 'center',
    marginLeft: 8,
  },
  toggleTrack: {
    width: 40,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#e5e5e5',
    padding: 2,
    justifyContent: 'center',
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
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
    ...Platform.select({ web: { cursor: 'default' }, default: {} }),
  },
  personAppActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
  saveButton: {
    backgroundColor: '#1a1a1a',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 40,
    alignSelf: 'flex-start',
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  saveButtonText: {
    fontFamily: FONT,
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  ghostButton: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: T.hairline,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  ghostButtonText: {
    fontFamily: FONT,
    fontSize: 14,
    fontWeight: '600',
    color: T.text,
  },
  buttonDisabled: {
    opacity: 0.65,
  },
  errorText: {
    fontFamily: FONT,
    fontSize: 13,
    color: '#b42318',
  },
  savedText: {
    fontFamily: FONT,
    fontSize: 13,
    color: '#2F8A4E',
  },
  footerHint: {
    fontFamily: FONT,
    fontSize: 12,
    color: T.secondary,
  },
  bulkToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
    paddingVertical: 4,
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  bulkToggleText: {
    fontFamily: FONT,
    fontSize: 13,
    fontWeight: '600',
    color: T.text,
  },
  bulkCount: {
    fontFamily: FONT,
    fontSize: 12,
    fontWeight: '600',
    color: T.secondary,
  },
  bulkStateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  bulkStateChip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: T.hairline,
    borderRadius: 6,
    paddingVertical: 5,
    paddingHorizontal: 8,
    backgroundColor: '#fff',
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  bulkStateChipSelected: {
    backgroundColor: '#1a1a1a',
    borderColor: '#1a1a1a',
  },
  bulkStateChipText: {
    fontFamily: FONT,
    fontSize: 11,
    fontWeight: '600',
    color: T.text,
  },
  bulkStateChipTextSelected: {
    color: '#fff',
  },
  deviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ececef',
  },
  deviceRowLast: {
    borderBottomWidth: 0,
  },
  statusText: {
    fontFamily: FONT,
    fontSize: 12,
    fontWeight: '600',
    marginTop: 4,
  },
});
