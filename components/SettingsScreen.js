import { useEffect, useState } from 'react';
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
import { canManageAppAccess, useAppAccess } from '../lib/permissions';
import { getSupabaseConnectionStatus } from '../lib/supabase';
import StoreSettingsPanel from './StoreSettingsPanel';
import RingCentralSettingsPanel from './RingCentralSettingsPanel';
import PermissionsPanel from './PermissionsPanel';
import { canManageRingCentral } from '../lib/ringcentral';
import { IosActionRow, IosGroup, IosPage, IosRow } from './IosSettings';

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
  const dbValue = !dbStatus ? 'Checking…' : dbReady ? 'Connected' : 'Not Connected';
  const dbHint = !dbStatus
    ? 'Checking the HTTPS connection.'
    : dbReady
      ? 'Connected over HTTPS with a client key. Row-level security stays on.'
      : dbStatus.message || 'Not connected';

  if (isMobile) {
    return (
      <IosPage>
        <IosGroup
          header="Store"
          footer={
            showRingCentral
              ? canManagePhone
                ? 'Hours, holidays, incoming lines, and RingCentral credentials for each branch.'
                : 'Hours and holidays, plus which store lines ring on this screen.'
              : 'Weekly hours and holidays for each branch.'
          }
        >
          <IosRow
            icon="storefront"
            iconColor="#FF9500"
            label="Store Settings"
            value="Hours"
            onPress={onOpenStoreSettings}
          />
          {showRingCentral ? (
            <IosRow
              icon="call"
              iconColor="#34C759"
              label="Phone"
              value="RingCentral"
              onPress={onOpenRingCentral}
            />
          ) : null}
        </IosGroup>

        <IosGroup
          header="Company"
          footer="Who can open each app, and the shared keys used for portraits, Serphint, and chat."
        >
          {canManageAiKeys ? (
            <IosRow
              icon="sparkles"
              iconColor="#AF52DE"
              label="AI Models"
              onPress={onOpenAiModels}
            />
          ) : null}
          <IosRow
            icon="lock-closed"
            iconColor="#007AFF"
            label="Permissions"
            onPress={onOpenPermissions}
          />
        </IosGroup>

        <IosGroup header="Database" footer={dbHint}>
          <IosRow
            icon="server"
            iconColor="#8E8E93"
            label="Supabase"
            value={dbValue}
            onPress={onOpenDatabase}
          />
        </IosGroup>
      </IosPage>
    );
  }

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

        {showRingCentral ? (
          <Pressable style={styles.menuRow} onPress={onOpenRingCentral}>
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
          <Pressable style={styles.menuRow} onPress={onOpenAiModels}>
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

        <Pressable style={styles.menuRow} onPress={onOpenPermissions}>
          <View style={[styles.menuIcon, { backgroundColor: '#EEF4FF' }]}>
            <Ionicons name="shield-checkmark-outline" size={16} color="#3B6FE0" />
          </View>
          <View style={styles.menuTextWrap}>
            <Text style={styles.menuLabel}>Permissions</Text>
            <Text style={styles.menuHint}>
              Pick a person, assign their role, and choose the apps they can open
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color="#9a9a9a" />
        </Pressable>
      </View>
    </View>
  );
}


function AiModelsPanel() {
  const isMobile = useIsMobile();
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

  const keyFields = AI_MODEL_PROVIDERS.map((provider) => (
    <View key={provider.key} style={isMobile ? styles.iosKeyRow : styles.providerBlock}>
      {isMobile ? null : (
        <>
          <Text style={styles.providerLabel}>{provider.label}</Text>
          <Text style={styles.providerDescription}>{provider.description}</Text>
        </>
      )}
      <View style={isMobile ? styles.iosKeyField : styles.keyField}>
        <TextInput
          style={isMobile ? styles.iosKeyInput : styles.keyInput}
          value={keys[provider.key] || ''}
          onChangeText={(value) => updateKey(provider.key, value)}
          placeholder={isMobile ? provider.label : provider.placeholder}
          placeholderTextColor="#8E8E93"
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
            size={isMobile ? 20 : 16}
            color="#8E8E93"
          />
        </Pressable>
      </View>
    </View>
  ));

  if (isMobile) {
    return (
      <IosPage>
        {unavailable ? (
          <IosGroup footer="The company key table is not in the database yet. Run the latest Supabase migration, then save again.">
            <IosRow label="Keys" value="Unavailable" />
          </IosGroup>
        ) : null}
        {!shared && !unavailable && Object.values(keys).some(Boolean) ? (
          <IosGroup footer="These keys are only on this device until you save. Saving shares them with everyone.">
            <IosRow label="Status" value="This device" />
          </IosGroup>
        ) : null}
        {AI_MODEL_PROVIDERS.map((provider, index) => (
          <IosGroup
            key={provider.key}
            header={provider.label}
            footer={index === 0 ? provider.description : provider.description}
          >
            <View style={styles.iosKeyRow}>
              <View style={styles.iosKeyField}>
                <TextInput
                  style={styles.iosKeyInput}
                  value={keys[provider.key] || ''}
                  onChangeText={(value) => updateKey(provider.key, value)}
                  placeholder={provider.placeholder}
                  placeholderTextColor="#8E8E93"
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
                    size={20}
                    color="#8E8E93"
                  />
                </Pressable>
              </View>
            </View>
          </IosGroup>
        ))}
        {error ? (
          <IosGroup footer={error}>
            <IosRow label="Save" value="Failed" />
          </IosGroup>
        ) : null}
        {saved ? (
          <IosGroup footer="API keys saved for everyone in the app.">
            <IosRow icon="checkmark-circle" iconColor="#34C759" label="Saved" value="Everyone" />
          </IosGroup>
        ) : null}
        <IosGroup footer="These keys are shared with every signed-in employee. Only a System Admin or General Manager can open this screen.">
          <IosActionRow label={saving ? 'Saving…' : 'Save'} onPress={handleSave} disabled={saving} />
        </IosGroup>
      </IosPage>
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

      {keyFields}

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
  const isMobile = useIsMobile();
  if (isMobile) {
    return (
      <IosPage>
        <IosGroup footer="Company AI keys are managed by a System Admin or General Manager. Ask them if portraits or AI chat are not working.">
          <IosRow icon="sparkles" iconColor="#AF52DE" label="AI Models" value="Restricted" />
        </IosGroup>
      </IosPage>
    );
  }

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
  const isMobile = useIsMobile();
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
  const keyLabel =
    status.keyKind === 'publishable' || status.keyKind === 'anon'
      ? 'Publishable'
      : 'Missing';

  if (isMobile) {
    return (
      <IosPage>
        <IosGroup header="Status" footer={status.message}>
          <IosRow
            icon={ready ? 'checkmark-circle' : 'warning'}
            iconColor={ready ? '#34C759' : '#FF9500'}
            label="Connection"
            value={ready ? 'Connected' : 'Not Ready'}
          />
        </IosGroup>
        <IosGroup
          header="Client"
          footer="The app talks to Supabase over HTTPS with a publishable key only. Secret and service_role keys are rejected. Row-level security must stay enabled on every table."
        >
          <IosRow label="Project URL" value={status.url || '—'} />
          <IosRow label="Client key" value={keyLabel} />
        </IosGroup>
      </IosPage>
    );
  }

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
  menuLabelIos: {
    fontSize: 17,
    fontWeight: '400',
    letterSpacing: -0.4,
    color: '#000',
  },
  menuHintIos: {
    fontSize: 13,
    color: '#8E8E93',
    marginTop: 1,
  },
  staffSearchIos: {
    borderWidth: 0,
    borderRadius: 10,
    backgroundColor: 'rgba(118,118,128,0.12)',
    minHeight: 36,
  },
  staffTableIos: {
    borderWidth: 0,
    borderRadius: 10,
    overflow: 'hidden',
  },
  staffTableItemIos: {
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  iosKeyRow: {
    minHeight: 44,
    paddingHorizontal: 16,
    paddingVertical: 4,
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  iosKeyField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  iosKeyInput: {
    flex: 1,
    fontFamily,
    fontSize: 17,
    color: '#000',
    paddingVertical: 10,
    letterSpacing: -0.4,
    outlineStyle: 'none',
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
  staffColCheck: {
    width: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  staffCheck: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  bulkBar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  bulkToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#d0d0d0',
    borderRadius: 6,
    paddingVertical: 8,
    paddingHorizontal: 10,
    backgroundColor: '#fff',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  bulkToggleText: {
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  bulkToggleCount: {
    fontFamily,
    fontSize: 11,
    fontWeight: '600',
    color: '#6b6b6b',
  },
  bulkLink: {
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  bulkLinkDisabled: {
    color: '#b0b0b0',
  },
  bulkPanel: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e5e5',
    borderRadius: 10,
    backgroundColor: '#fff',
    padding: 12,
    marginBottom: 12,
    gap: 8,
  },
  bulkLabel: {
    fontFamily,
    fontSize: 11,
    fontWeight: '600',
    color: '#8a8a8a',
    marginTop: 4,
  },
  bulkActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  bulkActionSep: {
    fontFamily,
    fontSize: 12,
    color: '#c4c4c4',
  },
  bulkStateHeader: {
    fontFamily,
    fontSize: 11,
    fontWeight: '600',
    color: '#8a8a8a',
    width: 168,
    textAlign: 'right',
  },
  bulkStateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  bulkStateChip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#d0d0d0',
    borderRadius: 6,
    paddingVertical: 5,
    paddingHorizontal: 8,
    backgroundColor: '#fff',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  bulkStateChipSelected: {
    backgroundColor: '#1a1a1a',
    borderColor: '#1a1a1a',
  },
  bulkStateChipText: {
    fontFamily,
    fontSize: 11,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  bulkStateChipTextSelected: {
    color: '#fff',
  },
});
