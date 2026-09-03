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
import { AI_MODEL_PROVIDERS, loadAiApiKeys, saveAiApiKeys } from '../lib/aiKeys';
import {
  USER_CATEGORIES,
  canManageAppAccess,
  defaultAccessByRole,
  listStaffProfiles,
  loadRoleAppAccess,
  saveRoleAppAccess,
  updateStaffAccess,
} from '../lib/permissions';
import { getSupabaseConnectionStatus } from '../lib/supabase';
import StoreSettingsPanel from './StoreSettingsPanel';

const fontFamily = Platform.select({
  ios: 'Sohne',
  android: 'Sohne',
  default: 'Sohne',
});

const emptyKeys = () =>
  Object.fromEntries(AI_MODEL_PROVIDERS.map((provider) => [provider.key, '']));

export { AI_MODEL_PROVIDERS, loadAiApiKeys };

function SettingsHome({ onOpenAiModels, onOpenPermissions, onOpenDatabase, onOpenStoreSettings }) {
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
    <View style={styles.body}>
      <View style={styles.menuList}>
        <Pressable style={styles.menuRow} onPress={onOpenDatabase}>
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

        <Pressable style={styles.menuRow} onPress={onOpenStoreSettings}>
          <View style={[styles.menuIcon, { backgroundColor: '#FFF4E5' }]}>
            <Ionicons name="storefront-outline" size={16} color="#C47A12" />
          </View>
          <View style={styles.menuTextWrap}>
            <Text style={styles.menuLabel}>Store settings</Text>
            <Text style={styles.menuHint}>Weekly hours and holidays for each branch</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color="#9a9a9a" />
        </Pressable>

        <Pressable style={styles.menuRow} onPress={onOpenAiModels}>
          <View style={[styles.menuIcon, { backgroundColor: '#F3EEFF' }]}>
            <Ionicons name="sparkles-outline" size={16} color="#6B4DE6" />
          </View>
          <View style={styles.menuTextWrap}>
            <Text style={styles.menuLabel}>AI models</Text>
            <Text style={styles.menuHint}>
              OpenRouter for open models · Anthropic/OpenAI keys for direct Claude & GPT
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color="#9a9a9a" />
        </Pressable>

        <Pressable style={styles.menuRow} onPress={onOpenPermissions}>
          <View style={[styles.menuIcon, { backgroundColor: '#EEF4FF' }]}>
            <Ionicons name="shield-checkmark-outline" size={16} color="#3B6FE0" />
          </View>
          <View style={styles.menuTextWrap}>
            <Text style={styles.menuLabel}>Permissions</Text>
            <Text style={styles.menuHint}>
              App visibility by user category, plus camera and microphone access
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
    description: 'Used by Serphint to preview and capture video',
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

function AppAccessPanel({ session, apps, onAccessSaved, onStaffAccessSaved }) {
  const catalogKeys = useMemo(() => (apps || []).map((app) => app.key), [apps]);
  const [activeRole, setActiveRole] = useState('precious_metal_analyst');
  const [draft, setDraft] = useState(() => defaultAccessByRole(catalogKeys));
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [updatingId, setUpdatingId] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const activeCategory = USER_CATEGORIES.find((category) => category.key === activeRole);
  const locked = activeRole === 'system_admin';

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError('');
      try {
        const [access, people] = await Promise.all([
          loadRoleAppAccess(catalogKeys),
          listStaffProfiles().catch(() => []),
        ]);
        if (cancelled) return;
        setDraft(access.byRole);
        setStaff(people);
        if (access.error) {
          setError(access.error);
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
      const next = await saveRoleAppAccess(draft, catalogKeys, session?.supabaseUserId || session?.profile?.id);
      setDraft(next);
      onAccessSaved?.(next);
      setMessage('App visibility saved.');
    } catch (nextError) {
      setError(nextError?.message || 'Could not save app visibility.');
    } finally {
      setSaving(false);
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
      <Text style={styles.sectionTitle}>App visibility</Text>
      <Text style={styles.aiIntro}>
        Choose which apps each category can open. System Admin always has every app. A General
        Manager can also be marked a System Admin, which grants every app.
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
        {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveButtonText}>Save visibility</Text>}
      </Pressable>

      <Text style={[styles.sectionTitle, styles.sectionTitleSpaced]}>People</Text>
      <Text style={styles.aiIntro}>
        Assign each signed-in person to a category. General Managers can also be System Admins.
        Disabling access signs the person out everywhere and blocks new sign-ins until re-enabled.
      </Text>

      {staff.length === 0 ? (
        <Text style={styles.menuHint}>No staff profiles yet. People appear here after they sign in.</Text>
      ) : (
        staff.map((row) => {
          const busy = updatingId === row.id;
          const isSelf = row.id === (session?.supabaseUserId || session?.profile?.id);
          const showAdminToggle = row.appRole === 'general_manager';
          return (
            <View key={row.id} style={[styles.staffRow, !row.isActive && styles.staffRowDisabled]}>
              <View style={styles.menuTextWrap}>
                <Text style={styles.menuLabel}>
                  {staffName(row)}
                  {!row.isActive ? '  ·  Access disabled' : ''}
                </Text>
                <Text style={styles.menuHint}>
                  {[row.locationName || 'Store not set in Aureus', row.email || row.aureusLogin]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
              </View>
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
              </View>
            </View>
          );
        })
      )}

      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      {message ? <Text style={styles.savedText}>{message}</Text> : null}
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
        Grant camera and microphone access used by Serphint, or update it later in your browser
        settings if it was blocked.
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

function PermissionsPanel({ session, apps, canManageAccess, onAccessSaved, onStaffAccessSaved }) {
  return (
    <ScrollView style={styles.body} contentContainerStyle={styles.permissionsContent}>
      {canManageAccess ? (
        <AppAccessPanel
          session={session}
          apps={apps}
          onAccessSaved={onAccessSaved}
          onStaffAccessSaved={onStaffAccessSaved}
        />
      ) : (
        <>
          <Text style={styles.sectionTitle}>App visibility</Text>
          <Text style={styles.aiIntro}>
            A System Admin sets which apps each user category can open. Ask them if you need access
            to another tool.
          </Text>
        </>
      )}
      <DevicePermissionsPanel />
    </ScrollView>
  );
}

function AiModelsPanel() {
  const [keys, setKeys] = useState(emptyKeys);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [revealed, setRevealed] = useState({});

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const stored = await loadAiApiKeys();
      if (cancelled) return;
      setKeys(stored);
      setLoading(false);
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
      setSaved(true);
    } catch {
      setError('Could not save API keys.');
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
        AI requests go through the company gateway using the company keys, so nothing is
        required here. Add a personal key below only if you want your own usage billed
        separately. Personal keys are stored encrypted on this device and sent only to the
        gateway, never to the browser bundle.
      </Text>

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
      {saved ? <Text style={styles.savedText}>API keys saved.</Text> : null}

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
}) {
  const canManageAccess = canManageAppAccess(session?.profile);

  if (panel === 'ai-models') {
    return <AiModelsPanel />;
  }

  if (panel === 'permissions') {
    return (
      <PermissionsPanel
        session={session}
        apps={apps}
        canManageAccess={canManageAccess}
        onAccessSaved={onAccessSaved}
        onStaffAccessSaved={onStaffAccessSaved}
      />
    );
  }

  if (panel === 'database') {
    return <DatabasePanel />;
  }

  if (panel === 'store-settings') {
    return <StoreSettingsPanel session={session} storeName={storeName} />;
  }

  return (
    <SettingsHome
      onOpenAiModels={() => onOpenPanel('ai-models')}
      onOpenPermissions={() => onOpenPanel('permissions')}
      onOpenDatabase={() => onOpenPanel('database')}
      onOpenStoreSettings={() => onOpenPanel('store-settings')}
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
    maxWidth: 640,
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
  staffRow: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e5e5',
    borderRadius: 8,
    padding: 12,
    backgroundColor: '#fff',
    marginBottom: 10,
    gap: 10,
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
});
