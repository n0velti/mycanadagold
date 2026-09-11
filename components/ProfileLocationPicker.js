import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
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
import { persistOwnLocation } from '../lib/auth';
import {
  listAssignableEmployeeLocations,
  updateAureusEmployeeLocation,
} from '../lib/aureusEmployees';

const fontFamily = Platform.select({
  ios: 'Sohne',
  android: 'Sohne',
  default: 'Sohne',
});

function asString(value) {
  if (value == null) return '';
  return String(value).trim();
}

export default function ProfileLocationPicker({
  visible,
  session,
  selectedId,
  selectedName,
  onClose,
  onChanged,
}) {
  const [stores, setStores] = useState([]);
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState('');
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!visible) {
      setQuery('');
      setError('');
      setSavingId('');
      return undefined;
    }

    const token = session?.token;
    const baseUrl = session?.baseUrl;
    if (!token) {
      setError('Sign in to change your location.');
      setStores([]);
      return undefined;
    }

    let cancelled = false;
    setLoading(true);
    setError('');
    listAssignableEmployeeLocations(token, baseUrl)
      .then((rows) => {
        if (cancelled) return;
        const list = Array.isArray(rows) ? rows : [];
        const currentId = asString(selectedId);
        const currentName = asString(selectedName);
        if (currentId && !list.some((row) => asString(row.id) === currentId)) {
          list.unshift({ id: currentId, name: currentName || `Location ${currentId}`, tillId: '', city: '' });
        }
        setStores(list);
      })
      .catch((err) => {
        if (cancelled) return;
        setStores([]);
        setError(err?.message || 'Could not load store locations.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [visible, session?.token, session?.baseUrl, selectedId, selectedName]);

  const visibleStores = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return stores;
    return stores.filter((store) => {
      const haystack = `${store.name} ${store.city}`.toLowerCase();
      return haystack.includes(needle);
    });
  }, [stores, query]);

  const handleSelect = async (store) => {
    const employeeId = asString(session?.profile?.aureusUserId);
    if (!session?.token || !employeeId) {
      setError('Sign in to change your location.');
      return;
    }
    if (asString(store.id) === asString(selectedId) || savingId) {
      onClose?.();
      return;
    }

    setSavingId(store.id);
    setError('');
    try {
      const mapped = await updateAureusEmployeeLocation(
        session.token,
        employeeId,
        { locationId: store.id, tillId: store.tillId, locationName: store.name },
        session.baseUrl,
      );
      const locationId = asString(mapped?.locationId || store.id);
      const locationName = asString(mapped?.locationName || store.name);
      try {
        await persistOwnLocation(session, { locationId, locationName });
      } catch {
        // POS already has the new store; the next staff sync will catch up.
      }
      onChanged?.({ locationId, locationName });
      onClose?.();
    } catch (err) {
      setError(err?.message || 'Could not change that location.');
    } finally {
      setSavingId('');
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalRoot}>
        <Pressable style={styles.modalBackdrop} onPress={onClose} />
        <View style={styles.modalSheet}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Location</Text>
            <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="Close">
              <Text style={styles.doneText}>Done</Text>
            </Pressable>
          </View>
          <View style={styles.searchField}>
            <Ionicons name="search" size={16} color="#8e8e93" />
            <TextInput
              style={styles.searchInput}
              value={query}
              onChangeText={setQuery}
              placeholder="Search stores"
              placeholderTextColor="#8e8e93"
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus={Platform.OS === 'web'}
            />
          </View>
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
          {loading ? (
            <View style={styles.loading}>
              <ActivityIndicator color="#1a1a1a" />
            </View>
          ) : (
            <ScrollView keyboardShouldPersistTaps="handled" style={styles.modalList}>
              {visibleStores.map((store) => {
                const active = asString(store.id) === asString(selectedId);
                const saving = savingId === store.id;
                return (
                  <Pressable
                    key={store.id}
                    style={[styles.modalOption, active && styles.modalOptionActive]}
                    onPress={() => handleSelect(store)}
                    disabled={Boolean(savingId)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active, busy: saving }}
                    accessibilityLabel={store.name}
                  >
                    <View style={styles.modalOptionCopy}>
                      <Text style={styles.modalOptionTitle} numberOfLines={1}>
                        {store.name}
                      </Text>
                      {store.city ? (
                        <Text style={styles.modalOptionMeta} numberOfLines={1}>
                          {store.city}
                        </Text>
                      ) : null}
                    </View>
                    {saving ? (
                      <ActivityIndicator size="small" color="#1a1a1a" />
                    ) : active ? (
                      <Ionicons name="checkmark" size={18} color="#1d1d1f" />
                    ) : null}
                  </Pressable>
                );
              })}
              {!visibleStores.length ? (
                <Text style={styles.emptyText}>No stores match that search.</Text>
              ) : null}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalRoot: {
    flex: 1,
    justifyContent: 'center',
    padding: 20,
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.28)',
  },
  modalSheet: {
    backgroundColor: '#fff',
    borderRadius: 16,
    maxHeight: '80%',
    overflow: 'hidden',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 8,
  },
  modalTitle: {
    fontFamily,
    fontSize: 17,
    fontWeight: '600',
    color: '#1d1d1f',
  },
  doneText: {
    fontFamily,
    fontSize: 17,
    fontWeight: '500',
    color: '#2F6FED',
  },
  searchField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 8,
    backgroundColor: '#f2f2f7',
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 40,
  },
  searchInput: {
    flex: 1,
    fontFamily,
    fontSize: 16,
    color: '#1d1d1f',
    paddingVertical: 0,
    ...Platform.select({
      web: { outlineStyle: 'none' },
      default: {},
    }),
  },
  errorText: {
    fontFamily,
    fontSize: 13,
    color: '#c41e3a',
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  loading: {
    minHeight: 160,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalList: {
    maxHeight: 420,
  },
  modalOption: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 48,
    paddingHorizontal: 16,
    gap: 10,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  modalOptionActive: {
    backgroundColor: '#f2f2f7',
  },
  modalOptionCopy: {
    flex: 1,
    minWidth: 0,
  },
  modalOptionTitle: {
    fontFamily,
    fontSize: 16,
    color: '#1d1d1f',
    letterSpacing: -0.2,
  },
  modalOptionMeta: {
    fontFamily,
    fontSize: 13,
    color: '#8e8e93',
    marginTop: 2,
  },
  emptyText: {
    fontFamily,
    fontSize: 14,
    color: '#8e8e93',
    paddingHorizontal: 16,
    paddingVertical: 20,
  },
});
