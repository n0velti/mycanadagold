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

  const showSearch = stores.length > 6;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalRoot}>
        <Pressable style={styles.modalBackdrop} onPress={onClose} accessibilityLabel="Dismiss" />
        <View style={styles.card}>
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <Text style={styles.title}>Location</Text>
              {selectedName ? (
                <Text style={styles.subtitle} numberOfLines={1}>
                  Currently at {selectedName}
                </Text>
              ) : null}
            </View>
            <Pressable
              onPress={onClose}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Close"
              style={({ pressed, hovered }) => [
                styles.closeButton,
                (pressed || hovered) && styles.closeButtonHover,
              ]}
            >
              <Ionicons name="close" size={15} color="#6e6e73" />
            </Pressable>
          </View>

          {showSearch ? (
            <View style={styles.searchField}>
              <Ionicons name="search" size={14} color="#8e8e93" />
              <TextInput
                style={styles.searchInput}
                value={query}
                onChangeText={setQuery}
                placeholder="Search"
                placeholderTextColor="#8e8e93"
                autoCapitalize="none"
                autoCorrect={false}
                autoFocus={Platform.OS === 'web'}
                returnKeyType="search"
              />
              {query ? (
                <Pressable onPress={() => setQuery('')} hitSlop={6} accessibilityLabel="Clear search">
                  <Ionicons name="close-circle" size={15} color="#aeaeb2" />
                </Pressable>
              ) : null}
            </View>
          ) : null}

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          {loading ? (
            <View style={styles.loading}>
              <ActivityIndicator color="#8e8e93" />
            </View>
          ) : (
            <ScrollView
              keyboardShouldPersistTaps="handled"
              style={styles.list}
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.group}>
                {visibleStores.map((store, index) => {
                  const active = asString(store.id) === asString(selectedId);
                  const saving = savingId === store.id;
                  const last = index === visibleStores.length - 1;
                  return (
                    <Pressable
                      key={store.id}
                      style={({ pressed, hovered }) => [
                        styles.option,
                        (pressed || hovered) && !savingId && styles.optionHover,
                      ]}
                      onPress={() => handleSelect(store)}
                      disabled={Boolean(savingId)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active, busy: saving }}
                      accessibilityLabel={store.name}
                    >
                      <View style={[styles.optionInner, !last && styles.optionDivider]}>
                        <View style={styles.optionCopy}>
                          <Text
                            style={[styles.optionTitle, active && styles.optionTitleActive]}
                            numberOfLines={1}
                          >
                            {store.name}
                          </Text>
                          {store.city ? (
                            <Text style={styles.optionMeta} numberOfLines={1}>
                              {store.city}
                            </Text>
                          ) : null}
                        </View>
                        <View style={styles.optionTrailing}>
                          {saving ? (
                            <ActivityIndicator size="small" color="#8e8e93" />
                          ) : active ? (
                            <Ionicons name="checkmark" size={17} color="#2F6FED" />
                          ) : null}
                        </View>
                      </View>
                    </Pressable>
                  );
                })}
                {!visibleStores.length ? (
                  <Text style={styles.emptyText}>No stores match that search.</Text>
                ) : null}
              </View>
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

const HAIRLINE = StyleSheet.hairlineWidth;

const styles = StyleSheet.create({
  modalRoot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.18)',
  },
  card: {
    width: '100%',
    maxWidth: 320,
    maxHeight: '70%',
    backgroundColor: '#fff',
    borderRadius: 18,
    overflow: 'hidden',
    borderWidth: HAIRLINE,
    borderColor: 'rgba(0, 0, 0, 0.08)',
    ...Platform.select({
      web: {
        boxShadow: '0 18px 48px rgba(0, 0, 0, 0.18), 0 2px 8px rgba(0, 0, 0, 0.06)',
      },
      ios: {
        shadowColor: '#000',
        shadowOpacity: 0.18,
        shadowRadius: 28,
        shadowOffset: { width: 0, height: 14 },
      },
      android: { elevation: 12 },
      default: {},
    }),
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingLeft: 18,
    paddingRight: 14,
    paddingTop: 16,
    paddingBottom: 10,
    gap: 12,
  },
  headerCopy: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: '#1d1d1f',
    letterSpacing: -0.2,
  },
  subtitle: {
    fontFamily,
    fontSize: 12,
    color: '#8e8e93',
    marginTop: 2,
  },
  closeButton: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f2f2f7',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  closeButtonHover: {
    backgroundColor: '#e5e5ea',
  },
  searchField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginHorizontal: 14,
    marginBottom: 10,
    backgroundColor: '#f2f2f7',
    borderRadius: 9,
    paddingHorizontal: 9,
    height: 30,
  },
  searchInput: {
    flex: 1,
    fontFamily,
    fontSize: 13,
    color: '#1d1d1f',
    paddingVertical: 0,
    ...Platform.select({
      web: { outlineStyle: 'none' },
      default: {},
    }),
  },
  errorText: {
    fontFamily,
    fontSize: 12,
    color: '#c41e3a',
    paddingHorizontal: 18,
    paddingBottom: 8,
  },
  loading: {
    minHeight: 120,
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: {
    maxHeight: 340,
  },
  listContent: {
    paddingHorizontal: 10,
    paddingBottom: 10,
  },
  group: {
    backgroundColor: '#f7f7f9',
    borderRadius: 12,
    overflow: 'hidden',
  },
  option: {
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  optionHover: {
    backgroundColor: '#ececf0',
  },
  optionInner: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 40,
    marginLeft: 12,
    paddingRight: 12,
    paddingVertical: 8,
    gap: 10,
  },
  optionDivider: {
    borderBottomWidth: HAIRLINE,
    borderBottomColor: 'rgba(60, 60, 67, 0.12)',
  },
  optionCopy: {
    flex: 1,
    minWidth: 0,
  },
  optionTitle: {
    fontFamily,
    fontSize: 13.5,
    color: '#1d1d1f',
    letterSpacing: -0.15,
  },
  optionTitleActive: {
    fontWeight: '600',
  },
  optionMeta: {
    fontFamily,
    fontSize: 11.5,
    color: '#8e8e93',
    marginTop: 1,
  },
  optionTrailing: {
    width: 20,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  emptyText: {
    fontFamily,
    fontSize: 13,
    color: '#8e8e93',
    paddingHorizontal: 12,
    paddingVertical: 16,
    textAlign: 'center',
  },
});
