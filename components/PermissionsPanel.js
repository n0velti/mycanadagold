import { createElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { CANVAS, useIsMobile } from '../lib/mobileUi';
import {
  AI_SCOPE_CAPABILITIES,
  AI_SCOPE_LEVELS,
  aiScopesEqual,
  defaultAiScopesByRole,
  defaultAiScopesForRole,
  resolveAiScopes,
  sanitizeAiScopes,
} from '../lib/aiScopes';
import {
  USER_CATEGORIES,
  USER_CATEGORY_KEYS,
  accessListsEqual,
  applyFilterablePatch,
  TRIAGE_PAIR_ROLES,
  allowedRolesForTriageSwitch,
  canSwitchWithTriage,
  triageSwitchPartner,
  clearUserAiAccess,
  clearUserAppAccess,
  defaultAccessByRole,
  getCategory,
  hasFullAppAccess,
  listStaffProfiles,
  loadRoleAppAccess,
  loadUserAiAccessMap,
  loadUserAppAccessMap,
  resolvedAccessForProfile,
  saveRoleAppAccess,
  saveUserAiAccess,
  saveUserAppAccess,
  saveUserAppAccessBatch,
  updateStaffAccess,
  useAppAccess,
} from '../lib/permissions';
import {
  RULES_UNAVAILABLE_MESSAGE,
  deletePermissionRule,
  describeRule,
  loadPermissionRules,
  roleRulesFor,
  rulesForProfile,
  savePermissionRule,
} from '../lib/permissionRules';
import { IosGroup, IosPage, IosRow } from './IosSettings';
import PermissionsAiChat from './PermissionsAiChat';
import {
  Chip,
  EmptyState,
  FONT,
  SearchField,
  SectionLabel,
  StaffAvatar,
  StatusPill,
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

function roleTone(role) {
  switch (role) {
    case 'branch_manager':
      return 'green';
    case 'general_manager':
      return 'purple';
    case 'triage':
      return 'orange';
    case 'hr':
      return 'blue';
    case 'system_admin':
      return 'neutral';
    default:
      return 'blue';
  }
}

function rolePillLabel(role, isSystemAdmin) {
  if (role === 'general_manager' && isSystemAdmin) return 'GM · Admin';
  return getCategory(role)?.shortLabel || '—';
}

function RoleBadge({ role, isSystemAdmin }) {
  return (
    <StatusPill
      label={rolePillLabel(role, isSystemAdmin)}
      tone={roleTone(role)}
      compact
    />
  );
}

function PersonCard({
  row,
  selected,
  checked,
  bulkOpen,
  onPress,
  onToggle,
  accessText,
}) {
  const name = staffName(row);
  const title = staffTitle(row);
  const inactive = !row.isActive;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={name}
      style={({ hovered, pressed }) => [
        styles.personCard,
        inactive && styles.personCardInactive,
        selected && styles.personCardSelected,
        (hovered || pressed) && styles.personCardHover,
      ]}
    >
      {bulkOpen ? (
        <Pressable
          onPress={onToggle}
          disabled={hasFullAppAccess(row)}
          hitSlop={8}
          style={styles.personCardCheck}
          accessibilityRole="checkbox"
          accessibilityState={{ checked, disabled: hasFullAppAccess(row) }}
        >
          <Ionicons
            name={checked ? 'checkbox' : 'square-outline'}
            size={18}
            color={checked ? T.text : T.tertiary}
          />
        </Pressable>
      ) : null}
      <StaffAvatar uri={row.avatarUrl} name={name} size={80} />
      <Text style={styles.personCardName} numberOfLines={1}>
        {name}
      </Text>
      {title ? (
        <Text style={styles.personCardRole} numberOfLines={1}>
          {title}
        </Text>
      ) : null}
      {row.locationName ? (
        <Text style={styles.personCardMeta} numberOfLines={1}>
          {row.locationName}
        </Text>
      ) : null}
      <View style={styles.personCardPills}>
        {inactive ? <StatusPill label="Disabled" tone="neutral" compact /> : null}
        <RoleBadge role={row.appRole} isSystemAdmin={row.isSystemAdmin} />
      </View>
      <Text style={styles.personCardHint} numberOfLines={2}>
        {accessText}
      </Text>
    </Pressable>
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

function accessLine(row, accessByRole, userAccessMap, catalogKeys, userAiMap) {
  if (hasFullAppAccess(row)) return 'Every app · Company Analytics';
  const resolved = resolvedAccessForProfile(row, accessByRole, catalogKeys, userAccessMap[row.id]);
  const customApps = resolved.inherited ? 'Role defaults' : 'Custom apps';
  const customAi = userAiMap?.[row.id] ? 'Custom Analytics' : null;
  return `${resolved.visibleApps.length} apps · ${[customApps, customAi].filter(Boolean).join(' · ')}`;
}

function groupApps(apps) {
  const groups = [];
  const seen = new Map();
  for (const app of apps || []) {
    const category = app.category || 'App';
    if (!seen.has(category)) {
      seen.set(category, []);
      groups.push({ category, apps: seen.get(category) });
    }
    seen.get(category).push(app);
  }
  return groups;
}

function ScopeChips({ value, disabled, onChange }) {
  return (
    <View style={styles.scopeChipRow}>
      {AI_SCOPE_LEVELS.map((level) => {
        const selected = value === level;
        const label = level === 'self' ? 'Self' : level === 'store' ? 'Store' : 'Company';
        return (
          <Pressable
            key={level}
            onPress={() => onChange(level)}
            disabled={disabled}
            style={[styles.scopeChip, selected && styles.scopeChipOn, disabled && styles.toggleDisabled]}
          >
            <Text style={[styles.scopeChipText, selected && styles.scopeChipTextOn]}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function MatrixCheck({ on, locked, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={locked}
      style={[styles.matrixCell, on && styles.matrixCellOn, locked && styles.toggleDisabled]}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on, disabled: locked }}
    >
      <Ionicons name={on ? 'checkmark' : 'remove'} size={14} color={on ? '#fff' : '#C7C7CC'} />
    </Pressable>
  );
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

function ruleTargetTag(rule) {
  const where = rule.stores?.length ? ` · ${rule.stores.join(', ')}` : '';
  if (rule.target === 'user') return `This person${where}`;
  if (rule.target === 'role') return `${getCategory(rule.role)?.label || 'Role'} role${where}`;
  return `Everyone${where}`;
}

/** Granular rules (lib/permissionRules.js) for a role or a person, with remove. */
function RulesCard({ title, intro, rules, staffById, onRemove, removingId, unavailable, emptyText }) {
  return (
    <View style={styles.ticketCard}>
      <Text style={styles.cardTitle}>{title}</Text>
      <Text style={styles.cardIntro}>{intro}</Text>
      {unavailable ? (
        <Text style={styles.fieldHint}>{RULES_UNAVAILABLE_MESSAGE}</Text>
      ) : rules.length === 0 ? (
        <Text style={styles.fieldHint}>{emptyText}</Text>
      ) : (
        <View style={styles.ruleList}>
          {rules.map((rule, index) => {
            const hide = rule.effect === 'hide';
            const removing = removingId === rule.id;
            return (
              <View key={rule.id} style={[styles.ruleRow, index === rules.length - 1 && styles.ruleRowLast]}>
                <View style={[styles.ruleIcon, hide ? styles.ruleIconHide : styles.ruleIconShow]}>
                  <Ionicons
                    name={hide ? 'eye-off-outline' : 'eye-outline'}
                    size={14}
                    color={hide ? '#B42318' : '#2F8A4E'}
                  />
                </View>
                <View style={styles.flexCopy}>
                  <Text style={styles.ruleText}>{describeRule(rule, { staffById })}</Text>
                  <Text style={styles.ruleMeta} numberOfLines={2}>
                    {ruleTargetTag(rule)}
                    {rule.note ? ` · “${rule.note}”` : ''}
                  </Text>
                </View>
                {onRemove ? (
                  <Pressable
                    onPress={() => onRemove(rule)}
                    disabled={removing}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel="Remove rule"
                    style={[styles.ruleRemove, removing && styles.buttonDisabled]}
                  >
                    {removing ? (
                      <ActivityIndicator size="small" color={T.secondary} />
                    ) : (
                      <Ionicons name="close" size={16} color={T.secondary} />
                    )}
                  </Pressable>
                ) : null}
              </View>
            );
          })}
        </View>
      )}
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
                <View style={styles.deviceStatus}>
                  <StatusPill
                    label={permissionStatusLabel(status)}
                    tone={
                      status === 'granted' ? 'green' : status === 'denied' ? 'red' : 'neutral'
                    }
                    compact
                  />
                </View>
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

function RoleDefaultsPane({
  apps,
  draft,
  aiDraft,
  activeRole,
  onRoleChange,
  onToggleRoleApp,
  onChangeRoleScope,
  onSave,
  saving,
  message,
  error,
  rules,
  rulesUnavailable,
  staffById,
  onRemoveRule,
  removingRuleId,
}) {
  const isMobile = useIsMobile();
  const groups = groupApps((apps || []).filter((app) => app.key !== 'home'));
  const roles = isMobile
    ? USER_CATEGORIES.filter((category) => category.key === activeRole)
    : USER_CATEGORIES;
  const activeCategory = USER_CATEGORIES.find((category) => category.key === activeRole);
  const roleRules = roleRulesFor(rules, activeRole);

  return (
    <ScrollView style={styles.paneScroll} contentContainerStyle={styles.rolesContentWide}>
      <View style={styles.ticketCard}>
        <Text style={styles.cardTitle}>Role defaults</Text>
        <Text style={styles.cardIntro}>
          Each role starts with these apps and Analytics scopes. A person keeps them until you save
          a custom set. System Admin is always every app and Company scope. These Analytics scopes
          also apply to Messages @ai, not only the Analytics app.
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
        {activeCategory ? (
          <Text style={styles.fieldHint}>
            {activeCategory.description}
            {isMobile ? '' : ' The assistant talks about this role unless you name another.'}
          </Text>
        ) : null}
      </View>

      <View style={styles.ticketCard}>
        <Text style={styles.cardTitle}>Apps</Text>
        <View style={styles.matrixHead}>
          <Text style={[styles.matrixCorner, styles.matrixAppName]}>App</Text>
          {roles.map((category) => (
            <Pressable
              key={category.key}
              onPress={() => onRoleChange(category.key)}
              accessibilityRole="button"
              accessibilityLabel={`Focus ${category.label}`}
              style={styles.matrixColHit}
            >
              <Text
                style={[styles.matrixColLabel, category.key === activeRole && styles.matrixColLabelActive]}
                numberOfLines={1}
              >
                {category.shortLabel}
              </Text>
            </Pressable>
          ))}
        </View>
        {groups.map((group) => (
          <View key={group.category}>
            <Text style={styles.matrixGroup}>{group.category}</Text>
            {group.apps.map((app) => (
              <View key={app.key} style={styles.matrixRow}>
                <View style={styles.matrixAppName}>
                  <View style={[styles.matrixIcon, { backgroundColor: app.tint || '#F4F4F5' }]}>
                    <Ionicons name={app.icon || 'apps-outline'} size={13} color={app.accent || '#52525B'} />
                  </View>
                  <Text style={styles.matrixAppLabel} numberOfLines={1}>
                    {app.label}
                  </Text>
                </View>
                {roles.map((category) => {
                  const locked = category.key === 'system_admin';
                  const on = locked || (draft[category.key] || []).includes(app.key);
                  return (
                    <MatrixCheck
                      key={category.key}
                      on={on}
                      locked={locked}
                      onPress={() => onToggleRoleApp(category.key, app.key)}
                    />
                  );
                })}
              </View>
            ))}
          </View>
        ))}
      </View>

      <View style={styles.ticketCard}>
        <Text style={styles.cardTitle}>Analytics</Text>
        <Text style={styles.cardIntro}>
          Self is only their own figures. Store is people at their allocated store. Company is
          everyone.
        </Text>
        <View style={styles.matrixHead}>
          <Text style={[styles.matrixCorner, styles.matrixAppName]}>Capability</Text>
          {roles.map((category) => (
            <Text key={category.key} style={styles.matrixColLabel} numberOfLines={1}>
              {category.shortLabel}
            </Text>
          ))}
        </View>
        {AI_SCOPE_CAPABILITIES.map((capability) => (
          <View key={capability.key} style={styles.scopeMatrixBlock}>
            <View style={styles.scopeMatrixCopy}>
              <Text style={styles.matrixAppLabel}>{capability.label}</Text>
              <Text style={styles.fieldHint}>{capability.description}</Text>
            </View>
            <View style={styles.scopeMatrixCells}>
              {roles.map((category) => {
                const locked = category.key === 'system_admin';
                const value = locked
                  ? 'company'
                  : aiDraft[category.key]?.[capability.key] || defaultAiScopesForRole(category.key)[capability.key];
                return (
                  <View key={category.key} style={styles.scopeMatrixCell}>
                    {!isMobile ? (
                      <Text style={styles.scopeRoleHint}>{category.shortLabel}</Text>
                    ) : null}
                    <ScopeChips
                      value={value}
                      disabled={locked}
                      onChange={(level) => onChangeRoleScope(category.key, capability.key, level)}
                    />
                  </View>
                );
              })}
            </View>
          </View>
        ))}
      </View>

      <RulesCard
        title={`Rules · ${activeCategory?.label || 'Role'}`}
        intro="Parts of a screen this role cannot see, and topics the Analytics AI refuses for it, saved the moment they are made. Rules can be limited to stores. Ask the assistant, for example “Branch Managers in Quebec should not see revenue on Home” or “PMAs should not ask about phone data in Analytics”."
        rules={roleRules}
        staffById={staffById}
        onRemove={onRemoveRule}
        removingId={removingRuleId}
        unavailable={rulesUnavailable}
        emptyText={
          activeRole === 'system_admin'
            ? 'System Admin always sees everything.'
            : 'No rules for this role yet. Everything an app shows is visible.'
        }
      />

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
  personAiDraft,
  personAiInherited,
  busy,
  personSaving,
  personAiSaving,
  message,
  error,
  compact,
  onClose,
  onRoleChange,
  onToggleAdmin,
  onToggleSwitchRoles,
  onToggleActive,
  onToggleApp,
  onToggleFilter,
  onSaveApps,
  onResetApps,
  onChangePersonScope,
  onSaveAi,
  onResetAi,
  rules,
  rulesUnavailable,
  staffById,
  onRemoveRule,
  removingRuleId,
}) {
  const resolved = resolvedAccessForProfile(row, draft, catalogKeys, userAccessMap[row.id]);
  const lockedPerson = hasFullAppAccess(row);
  const personRules = lockedPerson ? [] : rulesForProfile(rules, row);
  const isSelf = row.id === actorId;
  const showAdminToggle = row.appRole === 'general_manager';
  const pairPartner = TRIAGE_PAIR_ROLES.includes(row.appRole) ? row.appRole : triageSwitchPartner(row);
  const showSwitchRoles =
    row.isActive && (TRIAGE_PAIR_ROLES.includes(row.appRole) || row.appRole === 'triage');
  const switchRolesOn = canSwitchWithTriage(row);
  const pairLabel = getCategory(pairPartner || 'precious_metal_analyst')?.shortLabel || 'PMA';
  const custom = Boolean(userAccessMap[row.id]);
  const title = staffTitle(row);

  return (
    <ScrollView
      style={styles.detailScroll}
      contentContainerStyle={styles.detailContent}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.heroCard}>
        {onClose ? (
          <View style={styles.detailBackRow}>
            <Pressable
              onPress={onClose}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Back to people"
              style={styles.detailBack}
            >
              <Ionicons name="chevron-back" size={18} color={T.text} />
              <Text style={styles.detailBackText}>People</Text>
            </Pressable>
            {compact ? (
              <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close">
                <Ionicons name="close" size={22} color={T.secondary} />
              </Pressable>
            ) : null}
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
        {showSwitchRoles && row.appRole === 'triage' ? (
          <View style={styles.actionRow}>
            {TRIAGE_PAIR_ROLES.map((role) => {
              const category = getCategory(role);
              const on = pairPartner === role && switchRolesOn;
              return (
                <Pressable
                  key={role}
                  style={[styles.flagButton, on && styles.flagButtonOn]}
                  onPress={() => onToggleSwitchRoles(role)}
                  disabled={busy}
                >
                  <Text style={[styles.flagButtonText, on && styles.flagButtonTextOn]}>
                    {on
                      ? `${category?.shortLabel || role} + Triage on`
                      : `Allow ${category?.shortLabel || role} + Triage`}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ) : showSwitchRoles ? (
          <Pressable
            style={[styles.flagButton, switchRolesOn && styles.flagButtonOn]}
            onPress={() => onToggleSwitchRoles(row.appRole)}
            disabled={busy}
          >
            <Text style={[styles.flagButtonText, switchRolesOn && styles.flagButtonTextOn]}>
              {switchRolesOn
                ? `${pairLabel} + Triage switch on`
                : `Allow ${pairLabel} + Triage Analyst`}
            </Text>
          </Pressable>
        ) : null}
        {showSwitchRoles ? (
          <Text style={styles.fieldHint}>
            When this is on, they can open their profile and work as{' '}
            {getCategory(pairPartner || row.appRole)?.label || 'their role'} or a Triage Analyst.
            Only the Triage Analyst role opens the Triage app.
          </Text>
        ) : null}
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
        <View style={styles.appTileGrid}>
          {(apps || []).map((app) => {
            const visible = lockedPerson || personDraft.visibleApps.includes(app.key);
            const filterOn = lockedPerson || personDraft.filterableApps.includes(app.key);
            const homeLocked = app.key === 'home';
            return (
              <View
                key={app.key}
                style={[styles.appTile, visible && styles.appTileOn, !row.isActive && styles.toggleDisabled]}
              >
                <View style={[styles.matrixIcon, { backgroundColor: app.tint || '#F4F4F5' }]}>
                  <Ionicons name={app.icon || 'apps-outline'} size={14} color={app.accent || '#52525B'} />
                </View>
                <Text style={styles.appTileLabel} numberOfLines={2}>
                  {app.label}
                </Text>
                <Pressable
                  onPress={() => onToggleApp(app.key)}
                  disabled={lockedPerson || homeLocked}
                  style={[styles.tileChip, visible && styles.tileChipOn]}
                >
                  <Text style={[styles.tileChipText, visible && styles.tileChipTextOn]}>Open</Text>
                </Pressable>
                <Pressable
                  onPress={() => onToggleFilter(app.key)}
                  disabled={lockedPerson || !visible}
                  style={[styles.tileChip, visible && filterOn && styles.tileChipOn]}
                >
                  <Text style={[styles.tileChipText, visible && filterOn && styles.tileChipTextOn]}>Filter</Text>
                </Pressable>
              </View>
            );
          })}
        </View>
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

      <View style={styles.ticketCard}>
        <Text style={styles.cardTitle}>Analytics</Text>
        <Text style={styles.cardIntro}>
          {lockedPerson
            ? 'System Admin always has Company scope for pay, hours, and per-person performance.'
            : personAiInherited
              ? `Using ${getCategory(row.appRole)?.label || 'role'} Analytics defaults.`
              : 'Custom Analytics scopes for this person. Does not change the apps they can open.'}
        </Text>
        {AI_SCOPE_CAPABILITIES.map((capability) => (
          <View key={capability.key} style={styles.personScopeRow}>
            <View style={styles.flexCopy}>
              <Text style={styles.personName}>{capability.label}</Text>
              <Text style={styles.personMeta}>{capability.description}</Text>
            </View>
            <ScopeChips
              value={personAiDraft[capability.key]}
              disabled={lockedPerson}
              onChange={(level) => onChangePersonScope(capability.key, level)}
            />
          </View>
        ))}
        {!lockedPerson ? (
          <View style={styles.personAppActions}>
            <Pressable
              style={[styles.saveButton, personAiSaving && styles.buttonDisabled]}
              onPress={onSaveAi}
              disabled={personAiSaving}
            >
              {personAiSaving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.saveButtonText}>Save analytics</Text>
              )}
            </Pressable>
            {!personAiInherited ? (
              <Pressable
                style={[styles.ghostButton, personAiSaving && styles.buttonDisabled]}
                onPress={onResetAi}
                disabled={personAiSaving}
              >
                <Text style={styles.ghostButtonText}>Use role defaults</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>

      <RulesCard
        title="Rules"
        intro={
          lockedPerson
            ? 'Rules never apply to a System Admin.'
            : 'Parts of a screen hidden for this person and topics the Analytics AI refuses for them, from their own rules and from rules on their role or store. Ask the assistant to add or change one.'
        }
        rules={personRules}
        staffById={staffById}
        onRemove={onRemoveRule}
        removingId={removingRuleId}
        unavailable={rulesUnavailable && !lockedPerson}
        emptyText={lockedPerson ? 'Every app and every feature is visible.' : 'No rules apply. Everything their apps show is visible.'}
      />

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

function AppAccessPanel({
  session,
  apps,
  onAccessSaved,
  onStaffAccessSaved,
  onUserAccessSaved,
  onUserAiAccessSaved,
}) {
  const isMobile = useIsMobile();
  const { reloadPermissionRules } = useAppAccess();
  const catalogKeys = useMemo(() => (apps || []).map((app) => app.key), [apps]);
  const actorId = session?.supabaseUserId || session?.profile?.id;
  const adminName = String(session?.profile?.firstName || '').trim();
  const [tab, setTab] = useState('people');
  const [activeRole, setActiveRole] = useState('precious_metal_analyst');
  const [draft, setDraft] = useState(() => defaultAccessByRole(catalogKeys));
  const [aiDraft, setAiDraft] = useState(() => defaultAiScopesByRole());
  const [staff, setStaff] = useState([]);
  const [userAccessMap, setUserAccessMap] = useState({});
  const [userAiMap, setUserAiMap] = useState({});
  const [staffQuery, setStaffQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [personDraft, setPersonDraft] = useState({ visibleApps: [], filterableApps: [] });
  const [personAiDraft, setPersonAiDraft] = useState(() => defaultAiScopesForRole('precious_metal_analyst'));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [personSaving, setPersonSaving] = useState(false);
  const [personAiSaving, setPersonAiSaving] = useState(false);
  const [updatingId, setUpdatingId] = useState('');
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkTarget, setBulkTarget] = useState('matching');
  const [bulkFilterDraft, setBulkFilterDraft] = useState({});
  const [bulkSaving, setBulkSaving] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [rules, setRules] = useState([]);
  const [rulesUnavailable, setRulesUnavailable] = useState(false);
  const [removingRuleId, setRemovingRuleId] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const selectedRow = staff.find((row) => row.id === selectedId) || null;
  const staffById = useMemo(() => new Map(staff.map((row) => [row.id, row])), [staff]);

  // The assistant runs across several awaits in one turn; it reads the latest
  // state through these refs and writes both the ref and the state.
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const aiDraftRef = useRef(aiDraft);
  aiDraftRef.current = aiDraft;
  const staffRef = useRef(staff);
  staffRef.current = staff;
  const staffByIdRef = useRef(staffById);
  staffByIdRef.current = staffById;
  const userAccessMapRef = useRef(userAccessMap);
  userAccessMapRef.current = userAccessMap;
  const userAiMapRef = useRef(userAiMap);
  userAiMapRef.current = userAiMap;
  const rulesRef = useRef(rules);
  rulesRef.current = rules;
  const rulesUnavailableRef = useRef(rulesUnavailable);
  rulesUnavailableRef.current = rulesUnavailable;
  const selectedRowRef = useRef(selectedRow);
  selectedRowRef.current = selectedRow;

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
        const [access, people, userAccess, userAi, ruleState] = await Promise.all([
          loadRoleAppAccess(catalogKeys),
          listStaffProfiles().catch(() => []),
          loadUserAppAccessMap(catalogKeys),
          loadUserAiAccessMap(),
          loadPermissionRules(),
        ]);
        if (cancelled) return;
        setDraft(access.byRole);
        setAiDraft({ ...defaultAiScopesByRole(), ...(access.aiScopesByRole || {}) });
        setStaff(people);
        setUserAccessMap(userAccess.byUser);
        setUserAiMap(userAi.byUser || {});
        setRules(ruleState.rules || []);
        setRulesUnavailable(Boolean(ruleState.unavailable));
        const ruleError = ruleState.unavailable ? '' : ruleState.error;
        if (access.error || userAccess.error || userAi.error || ruleError) {
          setError(access.error || userAccess.error || userAi.error || ruleError);
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
    setPersonAiDraft(sanitizeAiScopes(resolveAiScopes(row, aiDraft, userAiMap[row.id])));
    setSelectedId(row.id);
    setMessage('');
    setError('');
  };

  const toggleRoleApp = (role, appKey) => {
    if (role === 'system_admin' || saving) return;
    setMessage('');
    setDraft((current) => {
      const list = current[role] || [];
      const nextList = list.includes(appKey)
        ? list.filter((key) => key !== appKey)
        : [...list, appKey];
      return { ...current, [role]: nextList };
    });
  };

  const changeRoleScope = (role, capability, level) => {
    if (role === 'system_admin' || saving) return;
    setMessage('');
    setAiDraft((current) => ({
      ...current,
      [role]: sanitizeAiScopes({ ...(current[role] || defaultAiScopesForRole(role)), [capability]: level }),
    }));
  };

  // Saves every role row (the table is upserted whole) and refreshes the
  // open person's inherited drafts. Shared by the Save button and the assistant.
  const persistRoleDefaults = useCallback(
    async (nextDraft, nextAi) => {
      const sanitizedAi = {};
      for (const role of USER_CATEGORY_KEYS) {
        sanitizedAi[role] = sanitizeAiScopes(nextAi?.[role], defaultAiScopesForRole(role));
      }
      const next = await saveRoleAppAccess(nextDraft, catalogKeys, actorId, sanitizedAi);
      const byRole = next.byRole || next;
      const aiByRole = { ...defaultAiScopesByRole(), ...(next.aiScopesByRole || sanitizedAi) };
      draftRef.current = byRole;
      aiDraftRef.current = aiByRole;
      setDraft(byRole);
      setAiDraft(aiByRole);
      onAccessSaved?.(next);
      const row = selectedRowRef.current;
      if (row && !hasFullAppAccess(row)) {
        if (!userAccessMapRef.current[row.id]) {
          setPersonDraft(personDraftFromResolved(resolvedAccessForProfile(row, byRole, catalogKeys, null)));
        }
        if (!userAiMapRef.current[row.id]) {
          setPersonAiDraft(sanitizeAiScopes(resolveAiScopes(row, aiByRole, null)));
        }
      }
      return { byRole, aiScopesByRole: aiByRole };
    },
    [actorId, catalogKeys, onAccessSaved],
  );

  const handleSaveDefaults = async () => {
    if (saving) return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      await persistRoleDefaults(draft, aiDraft);
      setMessage('Role defaults saved.');
    } catch (nextError) {
      setError(nextError?.message || 'Could not save permissions.');
    } finally {
      setSaving(false);
    }
  };

  const applyRules = useCallback(
    (updater) => {
      const next = updater(rulesRef.current);
      rulesRef.current = next;
      setRules(next);
      reloadPermissionRules?.();
      return next;
    },
    [reloadPermissionRules],
  );

  const handleRemoveRule = async (rule) => {
    if (!rule?.id || removingRuleId) return;
    setRemovingRuleId(rule.id);
    setError('');
    setMessage('');
    try {
      await deletePermissionRule(rule.id);
      applyRules((current) => current.filter((item) => item.id !== rule.id));
      setMessage(`Removed: ${describeRule(rule, { staffById })}`);
    } catch (nextError) {
      setError(nextError?.message || 'Could not remove that rule.');
    } finally {
      setRemovingRuleId('');
    }
  };

  // What the permissions assistant (lib/permissionsAgent.js) reads and writes.
  // Every write is the same lib call the buttons use, then state + shell refresh.
  const agentStore = useMemo(
    () => ({
      snapshot: () => ({
        apps: apps || [],
        catalogKeys: new Set(catalogKeys),
        staff: staffRef.current,
        staffById: staffByIdRef.current,
        roleApps: draftRef.current,
        roleAi: aiDraftRef.current,
        userApps: userAccessMapRef.current,
        userAi: userAiMapRef.current,
        rules: rulesRef.current,
        rulesUnavailable: rulesUnavailableRef.current,
      }),
      setRoleApps: async (role, visibleApps) => {
        const saved = await persistRoleDefaults({ ...draftRef.current, [role]: visibleApps }, aiDraftRef.current);
        return saved.byRole[role] || visibleApps;
      },
      setRoleAiScopes: async (role, scopes) => {
        const saved = await persistRoleDefaults(draftRef.current, { ...aiDraftRef.current, [role]: scopes });
        return saved.aiScopesByRole?.[role] || scopes;
      },
      setPersonApps: async (userId, access) => {
        const saved = await saveUserAppAccess(userId, access, catalogKeys, actorId);
        userAccessMapRef.current = { ...userAccessMapRef.current, [userId]: saved };
        setUserAccessMap(userAccessMapRef.current);
        onUserAccessSaved?.(userId, saved);
        if (selectedRowRef.current?.id === userId) setPersonDraft(personDraftFromResolved(saved));
        return saved;
      },
      resetPersonApps: async (userId) => {
        await clearUserAppAccess(userId);
        const next = { ...userAccessMapRef.current };
        delete next[userId];
        userAccessMapRef.current = next;
        setUserAccessMap(next);
        onUserAccessSaved?.(userId, null);
        const row = selectedRowRef.current;
        if (row?.id === userId) {
          setPersonDraft(personDraftFromResolved(resolvedAccessForProfile(row, draftRef.current, catalogKeys, null)));
        }
      },
      setPersonAiScopes: async (userId, scopes) => {
        const saved = await saveUserAiAccess(userId, scopes, actorId);
        userAiMapRef.current = { ...userAiMapRef.current, [userId]: saved };
        setUserAiMap(userAiMapRef.current);
        onUserAiAccessSaved?.(userId, saved);
        if (selectedRowRef.current?.id === userId) setPersonAiDraft(sanitizeAiScopes(saved));
        return saved;
      },
      resetPersonAi: async (userId) => {
        await clearUserAiAccess(userId);
        const next = { ...userAiMapRef.current };
        delete next[userId];
        userAiMapRef.current = next;
        setUserAiMap(next);
        onUserAiAccessSaved?.(userId, null);
        const row = selectedRowRef.current;
        if (row?.id === userId) setPersonAiDraft(sanitizeAiScopes(resolveAiScopes(row, aiDraftRef.current, null)));
      },
      addRule: async (rule) => {
        const saved = await savePermissionRule(rule, actorId);
        applyRules((current) => [...current.filter((item) => item.id !== saved.id), saved]);
        return saved;
      },
      removeRule: async (id) => {
        await deletePermissionRule(id);
        applyRules((current) => current.filter((item) => item.id !== id));
      },
    }),
    [actorId, apps, applyRules, catalogKeys, onUserAccessSaved, onUserAiAccessSaved, persistRoleDefaults],
  );

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

  const changePersonScope = (capability, level) => {
    if (hasFullAppAccess(selectedRow) || personAiSaving) return;
    setMessage('');
    setPersonAiDraft((current) => sanitizeAiScopes({ ...current, [capability]: level }));
  };

  const handleSavePersonAi = async (row) => {
    if (personAiSaving || hasFullAppAccess(row)) return;
    setPersonAiSaving(true);
    setError('');
    setMessage('');
    try {
      const next = sanitizeAiScopes(personAiDraft, defaultAiScopesForRole(row.appRole));
      const inherited = sanitizeAiScopes(resolveAiScopes(row, aiDraft, null));
      if (aiScopesEqual(next, inherited)) {
        await clearUserAiAccess(row.id);
        setUserAiMap((current) => {
          const copy = { ...current };
          delete copy[row.id];
          return copy;
        });
        setPersonAiDraft(inherited);
        onUserAiAccessSaved?.(row.id, null);
        setMessage(`Restored Analytics for ${staffName(row)} to role defaults.`);
        return;
      }
      const saved = await saveUserAiAccess(row.id, next, actorId);
      setUserAiMap((current) => ({ ...current, [row.id]: saved }));
      setPersonAiDraft(sanitizeAiScopes(saved));
      onUserAiAccessSaved?.(row.id, saved);
      setMessage(`Saved Analytics for ${staffName(row)}.`);
    } catch (nextError) {
      setError(nextError?.message || "Could not save that person's Analytics permissions.");
    } finally {
      setPersonAiSaving(false);
    }
  };

  const handleResetPersonAi = async (row) => {
    if (personAiSaving || hasFullAppAccess(row)) return;
    setPersonAiSaving(true);
    setError('');
    setMessage('');
    try {
      await clearUserAiAccess(row.id);
      setUserAiMap((current) => {
        const copy = { ...current };
        delete copy[row.id];
        return copy;
      });
      const inherited = sanitizeAiScopes(resolveAiScopes(row, aiDraft, null));
      setPersonAiDraft(inherited);
      onUserAiAccessSaved?.(row.id, null);
      setMessage(`Restored Analytics for ${staffName(row)} to ${getCategory(row.appRole)?.label || 'role'} defaults.`);
    } catch (nextError) {
      setError(nextError?.message || 'Could not restore Analytics defaults.');
    } finally {
      setPersonAiSaving(false);
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
    const nextAllowed =
      patch.canSwitchRoles === true
        ? undefined
        : patch.canSwitchRoles === false
          ? []
          : Array.isArray(patch.allowedAppRoles)
            ? patch.allowedAppRoles
            : row.allowedAppRoles;
    const optimistic = {
      ...row,
      appRole: nextRole,
      isSystemAdmin: nextAdmin,
      isActive: nextActive,
      allowedAppRoles:
        patch.canSwitchRoles === true
          ? allowedRolesForTriageSwitch(nextRole, patch.switchPartner)
          : nextAllowed === undefined
            ? row.allowedAppRoles
            : nextAllowed,
    };

    setUpdatingId(row.id);
    setError('');
    setMessage('');
    setStaff((current) => current.map((entry) => (entry.id === row.id ? optimistic : entry)));
    if (selectedId === row.id && !hasFullAppAccess(optimistic)) {
      if (!userAccessMap[row.id]) {
        setPersonDraft(
          personDraftFromResolved(resolvedAccessForProfile(optimistic, draft, catalogKeys, null)),
        );
      }
      if (!userAiMap[row.id]) {
        setPersonAiDraft(sanitizeAiScopes(resolveAiScopes(optimistic, aiDraft, null)));
      }
    }

    try {
      const updated = await updateStaffAccess(row.id, {
        appRole: nextRole,
        isSystemAdmin: nextAdmin,
        isActive: nextActive,
        canSwitchRoles: patch.canSwitchRoles,
        allowedAppRoles: Array.isArray(patch.allowedAppRoles) ? patch.allowedAppRoles : undefined,
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

  const closePerson = () => setSelectedId('');

  const peopleGrid = (
    <View style={styles.peoplePane}>
      <View style={styles.peopleToolbar}>
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
      </View>

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

      <ScrollView style={styles.list} contentContainerStyle={styles.gridContent}>
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
              <View style={styles.cardGrid}>
                {rows.map((row) => (
                  <PersonCard
                    key={row.id}
                    row={row}
                    selected={selectedId === row.id}
                    checked={selectedIds.has(row.id)}
                    bulkOpen={bulkOpen}
                    onPress={() => openPerson(row)}
                    onToggle={() => toggleSelected(row)}
                    accessText={accessLine(row, draft, userAccessMap, catalogKeys, userAiMap)}
                  />
                ))}
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );

  const personDetail = selectedRow ? (
    <PersonDetail
      row={selectedRow}
      actorId={actorId}
      apps={apps}
      catalogKeys={catalogKeys}
      draft={draft}
      userAccessMap={userAccessMap}
      personDraft={personDraft}
      personAiDraft={personAiDraft}
      personAiInherited={!userAiMap[selectedRow.id]}
      busy={updatingId === selectedRow.id}
      personSaving={personSaving}
      personAiSaving={personAiSaving}
      message={message}
      error={error}
      compact={isMobile}
      onClose={closePerson}
      onRoleChange={(appRole) => handleStaffChange(selectedRow, { appRole })}
      onToggleAdmin={() =>
        handleStaffChange(selectedRow, {
          appRole: selectedRow.appRole,
          isSystemAdmin: !selectedRow.isSystemAdmin,
        })
      }
      onToggleSwitchRoles={(partner) => {
        const currentPartner = triageSwitchPartner(selectedRow);
        const turningOff = canSwitchWithTriage(selectedRow) && (!partner || currentPartner === partner);
        handleStaffChange(selectedRow, {
          appRole: selectedRow.appRole,
          canSwitchRoles: !turningOff,
          switchPartner: partner,
          allowedAppRoles: turningOff ? [] : allowedRolesForTriageSwitch(selectedRow.appRole, partner),
        });
      }}
      onToggleActive={() => handleStaffChange(selectedRow, { isActive: !selectedRow.isActive })}
      onToggleApp={togglePersonApp}
      onToggleFilter={togglePersonFilter}
      onSaveApps={() => handleSavePersonApps(selectedRow)}
      onResetApps={() => handleResetPersonApps(selectedRow)}
      onChangePersonScope={changePersonScope}
      onSaveAi={() => handleSavePersonAi(selectedRow)}
      onResetAi={() => handleResetPersonAi(selectedRow)}
      rules={rules}
      rulesUnavailable={rulesUnavailable}
      staffById={staffById}
      onRemoveRule={handleRemoveRule}
      removingRuleId={removingRuleId}
    />
  ) : null;

  const assistant = (
    <PermissionsAiChat
      context={
        tab === 'roles'
          ? { tab: 'roles', role: activeRole }
          : { tab: 'people', personId: selectedId }
      }
      store={agentStore}
      adminName={adminName}
      compact={isMobile}
      disabled={loading}
      variant={isMobile ? 'dock' : 'rail'}
    />
  );

  const main =
    tab === 'roles' ? (
      <RoleDefaultsPane
        apps={apps}
        draft={draft}
        aiDraft={aiDraft}
        activeRole={activeRole}
        onRoleChange={setActiveRole}
        onToggleRoleApp={toggleRoleApp}
        onChangeRoleScope={changeRoleScope}
        onSave={handleSaveDefaults}
        saving={saving}
        message={message}
        error={error}
        rules={rules}
        rulesUnavailable={rulesUnavailable}
        staffById={staffById}
        onRemoveRule={handleRemoveRule}
        removingRuleId={removingRuleId}
      />
    ) : selectedRow ? (
      personDetail
    ) : (
      peopleGrid
    );

  return (
    <View style={styles.panel}>
      <View style={styles.tabStrip}>
        <TextTabs
          options={PERMISSION_TABS}
          value={tab}
          onChange={(next) => {
            setTab(next);
            if (next === 'people') setSelectedId('');
          }}
        />
      </View>
      {tab === 'device' ? (
        isMobile ? (
          <IosPage>
            <DevicePermissionsPanel />
          </IosPage>
        ) : (
          <DevicePermissionsPanel />
        )
      ) : (
        <View style={[styles.workspace, isMobile && styles.workspaceMobile]}>
          <View style={styles.mainPane}>{main}</View>
          <View style={[styles.assistantRail, isMobile && styles.assistantDock]}>{assistant}</View>
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
  onUserAiAccessSaved,
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
        <View style={styles.tabStrip}>
          <TextTabs
            options={[
              { key: 'people', label: 'People' },
              { key: 'device', label: 'This device' },
            ]}
            value="device"
            onChange={() => {}}
          />
        </View>
        <View style={styles.deviceWrap}>
          <View style={styles.ticketCard}>
            <Text style={styles.cardTitle}>App visibility</Text>
            <Text style={styles.cardIntro}>
              A System Admin sets which apps you can open and whether you can filter inside each one.
            </Text>
          </View>
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
      onUserAiAccessSaved={onUserAiAccessSaved}
    />
  );
}

const styles = StyleSheet.create({
  panel: {
    flex: 1,
    minHeight: 0,
    backgroundColor: CANVAS,
  },
  tabStrip: {
    flexShrink: 0,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  workspace: {
    flex: 1,
    minHeight: 0,
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  workspaceMobile: {
    flexDirection: 'column',
  },
  mainPane: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
  },
  assistantRail: {
    width: 340,
    flexShrink: 0,
    minHeight: 0,
    flexDirection: 'column',
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: T.hairline,
    backgroundColor: T.card,
    ...Platform.select({
      web: { overflow: 'hidden' },
      default: {},
    }),
  },
  assistantDock: {
    width: 'auto',
    flexShrink: 0,
    borderLeftWidth: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: T.hairline,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: T.card,
  },
  peoplePane: {
    flex: 1,
    minHeight: 0,
    gap: 10,
  },
  peopleToolbar: {
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  paneScroll: {
    flex: 1,
    minHeight: 0,
  },
  rolesContent: {
    paddingBottom: 40,
    paddingTop: 12,
    paddingHorizontal: 16,
    maxWidth: 720,
    gap: 12,
  },
  rolesContentWide: {
    paddingBottom: 40,
    paddingTop: 12,
    paddingHorizontal: 16,
    maxWidth: 1080,
    gap: 12,
  },
  matrixHead: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 32,
    paddingVertical: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ececef',
    gap: 6,
  },
  matrixCorner: {
    fontFamily: FONT,
    fontSize: 11,
    fontWeight: '600',
    color: T.secondary,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  matrixColHit: {
    width: 52,
    alignItems: 'center',
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  matrixColLabel: {
    width: 52,
    textAlign: 'center',
    fontFamily: FONT,
    fontSize: 11,
    fontWeight: '700',
    color: T.secondary,
  },
  matrixColLabelActive: {
    color: T.text,
    textDecorationLine: 'underline',
    textDecorationColor: T.text,
  },
  ruleList: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: T.hairline,
    borderRadius: 10,
    overflow: 'hidden',
  },
  ruleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ececef',
  },
  ruleRowLast: {
    borderBottomWidth: 0,
  },
  ruleIcon: {
    width: 26,
    height: 26,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ruleIconHide: {
    backgroundColor: '#FFF1F0',
  },
  ruleIconShow: {
    backgroundColor: '#EAF6EE',
  },
  ruleText: {
    fontFamily: FONT,
    fontSize: 13,
    fontWeight: '600',
    color: T.text,
  },
  ruleMeta: {
    fontFamily: FONT,
    fontSize: 11,
    color: T.secondary,
    marginTop: 2,
  },
  ruleRemove: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f4f4f5',
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  matrixGroup: {
    fontFamily: FONT,
    fontSize: 11,
    fontWeight: '700',
    color: T.secondary,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    marginTop: 12,
    marginBottom: 4,
  },
  matrixRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 36,
    gap: 6,
  },
  matrixAppName: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  matrixIcon: {
    width: 24,
    height: 24,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  matrixAppLabel: {
    flex: 1,
    fontFamily: FONT,
    fontSize: 13,
    color: T.text,
  },
  matrixCell: {
    width: 52,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f4f4f5',
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  matrixCellOn: {
    backgroundColor: '#1a1a1a',
  },
  scopeChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  scopeChip: {
    borderRadius: 6,
    paddingVertical: 5,
    paddingHorizontal: 7,
    backgroundColor: '#f4f4f5',
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  scopeChipOn: {
    backgroundColor: '#1a1a1a',
  },
  scopeChipText: {
    fontFamily: FONT,
    fontSize: 11,
    fontWeight: '600',
    color: T.text,
  },
  scopeChipTextOn: {
    color: '#fff',
  },
  scopeMatrixBlock: {
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ececef',
    gap: 8,
  },
  scopeMatrixCopy: {
    gap: 2,
  },
  scopeMatrixCells: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  scopeMatrixCell: {
    gap: 4,
  },
  scopeRoleHint: {
    fontFamily: FONT,
    fontSize: 10,
    fontWeight: '700',
    color: T.secondary,
    textTransform: 'uppercase',
  },
  appTileGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  appTile: {
    width: 112,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: T.hairline,
    borderRadius: 10,
    padding: 8,
    gap: 6,
    backgroundColor: '#fff',
  },
  appTileOn: {
    backgroundColor: '#F5F5F7',
    borderColor: '#D2D2D7',
  },
  appTileLabel: {
    fontFamily: FONT,
    fontSize: 12,
    fontWeight: '600',
    color: T.text,
    minHeight: 30,
  },
  tileChip: {
    borderRadius: 6,
    paddingVertical: 4,
    paddingHorizontal: 6,
    backgroundColor: '#f4f4f5',
    alignItems: 'center',
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  tileChipOn: {
    backgroundColor: '#1a1a1a',
  },
  tileChipText: {
    fontFamily: FONT,
    fontSize: 11,
    fontWeight: '600',
    color: T.secondary,
  },
  tileChipTextOn: {
    color: '#fff',
  },
  personScopeRow: {
    gap: 8,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ececef',
  },
  deviceContent: {
    paddingBottom: 40,
    paddingTop: 12,
    paddingHorizontal: 16,
    maxWidth: 560,
    gap: 12,
  },
  deviceWrap: {
    paddingHorizontal: 16,
    paddingTop: 12,
    maxWidth: 560,
  },
  centered: {
    flex: 1,
    minHeight: 160,
    alignItems: 'center',
    justifyContent: 'center',
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
  gridContent: {
    paddingHorizontal: 16,
    paddingBottom: 40,
    paddingTop: 4,
    gap: 20,
  },
  cardGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
    ...Platform.select({
      web: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
      },
    }),
  },
  personCard: {
    alignItems: 'center',
    paddingVertical: 20,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: T.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: T.hairline,
    gap: 4,
    minWidth: 176,
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
  personCardHover: {
    backgroundColor: '#F7F7F8',
  },
  personCardSelected: {
    borderColor: T.text,
  },
  personCardInactive: {
    opacity: 0.55,
  },
  personCardName: {
    fontFamily: FONT,
    fontSize: 16,
    fontWeight: '700',
    color: T.text,
    letterSpacing: -0.3,
    textAlign: 'center',
    marginTop: 12,
    alignSelf: 'stretch',
  },
  personCardRole: {
    fontFamily: FONT,
    fontSize: 13,
    fontWeight: '500',
    color: T.secondary,
    textAlign: 'center',
    alignSelf: 'stretch',
  },
  personCardMeta: {
    fontFamily: FONT,
    fontSize: 13,
    color: T.secondary,
    textAlign: 'center',
    alignSelf: 'stretch',
  },
  personCardPills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 6,
    marginTop: 6,
  },
  personCardHint: {
    fontFamily: FONT,
    fontSize: 12,
    lineHeight: 16,
    color: T.tertiary,
    textAlign: 'center',
    marginTop: 4,
    alignSelf: 'stretch',
  },
  personCardCheck: {
    position: 'absolute',
    top: 10,
    left: 10,
    zIndex: 1,
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  listGroup: {
    marginBottom: 4,
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
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 40,
    gap: 12,
    maxWidth: 720,
  },
  detailBackRow: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  detailBack: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  detailBackText: {
    fontFamily: FONT,
    fontSize: 15,
    fontWeight: '600',
    color: T.text,
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
  deviceStatus: {
    marginTop: 6,
    alignSelf: 'flex-start',
  },
});
