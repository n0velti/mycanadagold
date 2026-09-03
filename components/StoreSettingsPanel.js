import { createElement, useEffect, useState } from 'react';
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
import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import {
  canManageStoreSettings,
  createHoliday,
  formatClock,
  listStoreChoices,
  loadStoreSettings,
  normalizeHolidays,
  saveStoreSettings,
  summarizeHours,
  WEEKDAY_LABELS,
} from '../lib/storeSettings';
import { formatDateParam, formatPickerDate, parseDateParam } from '../lib/transactions';

const fontFamily = Platform.select({
  ios: 'Sohne',
  android: 'Sohne',
  default: 'Sohne',
});

function timeToDate(value) {
  const match = String(value || '10:00').match(/^(\d{1,2}):(\d{2})/);
  const date = new Date();
  date.setHours(match ? Number(match[1]) : 10, match ? Number(match[2]) : 0, 0, 0);
  return date;
}

function dateToTime(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '10:00';
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
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

function TimeField({ value, onChange, disabled }) {
  const [open, setOpen] = useState(false);

  if (disabled) {
    return <Text style={styles.timeDisabled}>{formatClock(value)}</Text>;
  }

  if (Platform.OS === 'web') {
    return createElement('input', {
      type: 'time',
      value,
      step: 900,
      onChange: (event) => {
        if (event.target.value) onChange(event.target.value.slice(0, 5));
      },
      style: {
        fontFamily,
        fontSize: 13,
        color: '#1a1a1a',
        border: '1px solid #d0d0d0',
        borderRadius: 6,
        padding: '6px 8px',
        background: '#fff',
        minWidth: 108,
      },
    });
  }

  return (
    <>
      <Pressable style={styles.timeChip} onPress={() => setOpen(true)}>
        <Text style={styles.timeChipText}>{formatClock(value)}</Text>
      </Pressable>
      {Platform.OS === 'android' && open ? (
        <DateTimePicker
          value={timeToDate(value)}
          mode="time"
          display="default"
          onChange={(event, selected) => {
            setOpen(false);
            if (event.type !== 'dismissed' && selected) onChange(dateToTime(selected));
          }}
        />
      ) : null}
      {Platform.OS === 'ios' ? (
        <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
          <View style={styles.modalBackdrop}>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setOpen(false)} />
            <View style={styles.modalCard}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Time</Text>
                <Pressable onPress={() => setOpen(false)} hitSlop={8}>
                  <Text style={styles.modalDone}>Done</Text>
                </Pressable>
              </View>
              <DateTimePicker
                value={timeToDate(value)}
                mode="time"
                display="spinner"
                onChange={(_, selected) => {
                  if (selected) onChange(dateToTime(selected));
                }}
              />
            </View>
          </View>
        </Modal>
      ) : null}
    </>
  );
}

function DateField({ value, onChange, disabled }) {
  const [open, setOpen] = useState(false);
  const dateValue = parseDateParam(value || new Date());

  if (disabled) {
    return <Text style={styles.timeDisabled}>{value ? formatPickerDate(dateValue) : '—'}</Text>;
  }

  if (Platform.OS === 'web') {
    return createElement('input', {
      type: 'date',
      value: value || '',
      onChange: (event) => onChange(event.target.value),
      style: {
        fontFamily,
        fontSize: 13,
        color: '#1a1a1a',
        border: '1px solid #d0d0d0',
        borderRadius: 6,
        padding: '6px 8px',
        background: '#fff',
        minWidth: 140,
      },
    });
  }

  return (
    <>
      <Pressable style={styles.timeChip} onPress={() => setOpen(true)}>
        <Ionicons name="calendar-outline" size={14} color="#6b6b6b" />
        <Text style={styles.timeChipText}>{value ? formatPickerDate(dateValue) : 'Date'}</Text>
      </Pressable>
      {Platform.OS === 'android' && open ? (
        <DateTimePicker
          value={dateValue}
          mode="date"
          display="default"
          onChange={(event, selected) => {
            setOpen(false);
            if (event.type !== 'dismissed' && selected) onChange(formatDateParam(selected));
          }}
        />
      ) : null}
      {Platform.OS === 'ios' ? (
        <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
          <View style={styles.modalBackdrop}>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setOpen(false)} />
            <View style={styles.modalCard}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Date</Text>
                <Pressable onPress={() => setOpen(false)} hitSlop={8}>
                  <Text style={styles.modalDone}>Done</Text>
                </Pressable>
              </View>
              <DateTimePicker
                value={dateValue}
                mode="date"
                display="spinner"
                onChange={(_, selected) => {
                  if (selected) onChange(formatDateParam(selected));
                }}
              />
            </View>
          </View>
        </Modal>
      ) : null}
    </>
  );
}

function StoreHoursEditor({ session, storeName, onBack, embedded = false }) {
  const canEdit = canManageStoreSettings(session?.profile);
  const [hours, setHours] = useState([]);
  const [holidays, setHolidays] = useState([]);
  const [draftHoliday, setDraftHoliday] = useState(() =>
    createHoliday({ date: formatDateParam(new Date()), name: '', closed: true }),
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      setMessage('');
      try {
        const next = await loadStoreSettings(storeName);
        if (cancelled) return;
        setHours(next.hours);
        setHolidays(next.holidays);
        setUnavailable(Boolean(next.unavailable));
        if (next.unavailable) {
          setError('Run the store settings SQL in Supabase, then refresh this page.');
        }
      } catch (nextError) {
        if (!cancelled) setError(nextError?.message || 'Could not load store hours.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [storeName]);

  const updateDay = (day, patch) => {
    if (!canEdit) return;
    setMessage('');
    setHours((current) => current.map((row) => (row.day === day ? { ...row, ...patch } : row)));
  };

  const addHoliday = () => {
    if (!canEdit || saving) return;
    const next = createHoliday(draftHoliday);
    if (!next.date) {
      setError('Choose a holiday date.');
      return;
    }
    if (!next.name) {
      setError('Name the holiday.');
      return;
    }
    setError('');
    setMessage('');
    setHolidays((current) =>
      normalizeHolidays(current.filter((row) => row.date !== next.date).concat(next)),
    );
    setDraftHoliday(createHoliday({ date: next.date, name: '', closed: true }));
  };

  const removeHoliday = (id) => {
    if (!canEdit) return;
    setMessage('');
    setHolidays((current) => current.filter((row) => row.id !== id));
  };

  const handleSave = async () => {
    if (!canEdit || saving) return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const saved = await saveStoreSettings(
        storeName,
        { hours, holidays },
        session?.supabaseUserId || session?.profile?.id,
      );
      setHours(saved.hours);
      setHolidays(saved.holidays);
      setMessage('Store hours saved.');
    } catch (nextError) {
      setError(nextError?.message || 'Could not save store hours.');
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
    <ScrollView
      style={[styles.body, embedded && styles.bodyEmbedded]}
      contentContainerStyle={[styles.content, embedded && styles.contentEmbedded]}
    >
      {onBack ? (
        <Pressable style={styles.backRow} onPress={onBack}>
          <Ionicons name="chevron-back" size={16} color="#1a1a1a" />
          <Text style={styles.backText}>All stores</Text>
        </Pressable>
      ) : null}

      <Text style={styles.storeTitle}>{storeName}</Text>
      <Text style={styles.intro}>
        Regular weekly hours, then dates the store is closed or on a shortened schedule.
      </Text>

      <Text style={styles.sectionTitle}>Hours</Text>
      <View style={styles.hoursCard}>
        {hours.map((row) => (
          <View key={row.day} style={styles.hourRow}>
            <Text style={styles.dayLabel}>{WEEKDAY_LABELS[row.day]}</Text>
            <View style={styles.hourControls}>
              <Text style={[styles.closedLabel, !row.closed && styles.closedLabelOn]}>Open</Text>
              <AccessToggle
                on={!row.closed}
                disabled={!canEdit}
                onPress={() => updateDay(row.day, { closed: !row.closed })}
              />
              {row.closed ? (
                <Text style={styles.closedHint}>Closed all day</Text>
              ) : (
                <View style={styles.timePair}>
                  <TimeField
                    value={row.open}
                    disabled={!canEdit}
                    onChange={(open) => updateDay(row.day, { open })}
                  />
                  <Text style={styles.timeSep}>–</Text>
                  <TimeField
                    value={row.close}
                    disabled={!canEdit}
                    onChange={(close) => updateDay(row.day, { close })}
                  />
                </View>
              )}
            </View>
          </View>
        ))}
      </View>

      <Text style={[styles.sectionTitle, styles.sectionSpaced]}>Holidays</Text>
      {holidays.length === 0 ? (
        <Text style={styles.hint}>No holidays yet. Add statutory days or company closures.</Text>
      ) : (
        holidays.map((row) => (
          <View key={row.id} style={styles.holidayRow}>
            <View style={styles.menuTextWrap}>
              <Text style={styles.menuLabel}>{row.name}</Text>
              <Text style={styles.hint}>
                {formatPickerDate(row.date)}
                {row.closed
                  ? ' · Closed'
                  : ` · ${formatClock(row.open)}–${formatClock(row.close)}`}
              </Text>
            </View>
            {canEdit ? (
              <Pressable onPress={() => removeHoliday(row.id)} hitSlop={8} accessibilityLabel="Remove holiday">
                <Ionicons name="trash-outline" size={16} color="#8a8a8a" />
              </Pressable>
            ) : null}
          </View>
        ))
      )}

      {canEdit ? (
        <View style={styles.addHoliday}>
          <Text style={styles.addHolidayLabel}>Add holiday</Text>
          <TextInput
            style={styles.nameInput}
            value={draftHoliday.name}
            onChangeText={(name) => setDraftHoliday((current) => ({ ...current, name }))}
            placeholder="Christmas Day"
            placeholderTextColor="#999"
          />
          <View style={styles.addHolidayMeta}>
            <DateField
              value={draftHoliday.date}
              onChange={(date) => setDraftHoliday((current) => ({ ...current, date }))}
            />
            <View style={styles.holidayClosed}>
              <Text style={styles.closedLabel}>Closed</Text>
              <AccessToggle
                on={draftHoliday.closed}
                onPress={() =>
                  setDraftHoliday((current) => ({ ...current, closed: !current.closed }))
                }
              />
            </View>
            {draftHoliday.closed ? null : (
              <View style={styles.timePair}>
                <TimeField
                  value={draftHoliday.open}
                  onChange={(open) => setDraftHoliday((current) => ({ ...current, open }))}
                />
                <Text style={styles.timeSep}>–</Text>
                <TimeField
                  value={draftHoliday.close}
                  onChange={(close) => setDraftHoliday((current) => ({ ...current, close }))}
                />
              </View>
            )}
          </View>
          <Pressable style={styles.secondaryButton} onPress={addHoliday}>
            <Text style={styles.secondaryButtonText}>Add to list</Text>
          </Pressable>
        </View>
      ) : (
        <Text style={styles.hint}>A branch manager or admin can change hours for this store.</Text>
      )}

      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      {message ? <Text style={styles.savedText}>{message}</Text> : null}

      {canEdit && !unavailable ? (
        <Pressable
          style={[styles.saveButton, saving && styles.saveButtonDisabled]}
          onPress={handleSave}
          disabled={saving}
        >
          {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveButtonText}>Save</Text>}
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

export default function StoreSettingsPanel({ session, storeName, embedded = false }) {
  const [stores, setStores] = useState([]);
  const [selectedName, setSelectedName] = useState(storeName || '');
  const [loading, setLoading] = useState(!storeName);
  const [error, setError] = useState('');
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    setSelectedName(storeName || '');
  }, [storeName]);

  useEffect(() => {
    if (storeName) return undefined;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const next = await listStoreChoices(session);
        if (cancelled) return;
        const homeName = session?.profile?.locationName || '';
        const sorted = [...next.stores].sort((a, b) => {
          if (homeName) {
            const aHome = a.storeName.localeCompare(homeName, undefined, { sensitivity: 'base' }) === 0;
            const bHome = b.storeName.localeCompare(homeName, undefined, { sensitivity: 'base' }) === 0;
            if (aHome !== bHome) return aHome ? -1 : 1;
          }
          return a.storeName.localeCompare(b.storeName, undefined, { sensitivity: 'base' });
        });
        setStores(sorted);
        setUnavailable(Boolean(next.unavailable));
        if (next.unavailable) {
          setError('Run the store settings SQL in Supabase, then refresh this page.');
        } else if (next.warning) {
          setError(next.warning);
        }
      } catch (nextError) {
        if (!cancelled) setError(nextError?.message || 'Could not load stores.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session, storeName]);

  if (selectedName) {
    return (
      <StoreHoursEditor
        session={session}
        storeName={selectedName}
        embedded={embedded}
        onBack={storeName ? null : () => setSelectedName('')}
      />
    );
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color="#1a1a1a" />
      </View>
    );
  }

  return (
    <ScrollView style={[styles.body, embedded && styles.bodyEmbedded]} contentContainerStyle={styles.content}>
      <Text style={styles.intro}>Choose a store to set weekly hours and holidays.</Text>
      {stores.length === 0 ? (
        <Text style={styles.hint}>No stores found. Sign in and confirm locations are loading.</Text>
      ) : (
        <View style={styles.menuList}>
          {stores.map((store) => (
            <Pressable
              key={store.storeKey}
              style={styles.menuRow}
              onPress={() => setSelectedName(store.storeName)}
            >
              <View style={[styles.menuIcon, { backgroundColor: '#FFF4E5' }]}>
                <Ionicons name="storefront-outline" size={16} color="#C47A12" />
              </View>
              <View style={styles.menuTextWrap}>
                <Text style={styles.menuLabel}>{store.storeName}</Text>
                <Text style={styles.hint}>
                  {[store.systemLabel, store.exists ? summarizeHours(store.hours) : 'Hours not set']
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color="#9a9a9a" />
            </Pressable>
          ))}
        </View>
      )}
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      {unavailable ? <Text style={styles.hint}>Hours will save after the database migration is applied.</Text> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    minHeight: 0,
    marginTop: 20,
    alignSelf: 'stretch',
  },
  bodyEmbedded: {
    marginTop: 0,
  },
  content: {
    paddingBottom: 40,
    maxWidth: 640,
  },
  contentEmbedded: {
    paddingTop: 8,
    paddingBottom: 28,
    maxWidth: '100%',
  },
  centered: {
    flex: 1,
    minHeight: 120,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 20,
  },
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginBottom: 12,
    alignSelf: 'flex-start',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  backText: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  storeTitle: {
    fontFamily,
    fontSize: 18,
    fontWeight: '600',
    color: '#1a1a1a',
    marginBottom: 6,
  },
  intro: {
    fontFamily,
    fontSize: 13,
    color: '#6b6b6b',
    marginBottom: 20,
    lineHeight: 18,
  },
  sectionTitle: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: '#1a1a1a',
    marginBottom: 8,
  },
  sectionSpaced: {
    marginTop: 28,
  },
  hint: {
    fontFamily,
    fontSize: 12,
    color: '#8a8a8a',
    marginTop: 2,
    lineHeight: 17,
  },
  hoursCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e5e5',
    borderRadius: 8,
    backgroundColor: '#fff',
    overflow: 'hidden',
  },
  hourRow: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#efefef',
    gap: 8,
  },
  dayLabel: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  hourControls: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 10,
  },
  closedLabel: {
    fontFamily,
    fontSize: 12,
    color: '#6b6b6b',
  },
  closedLabelOn: {
    color: '#1a1a1a',
    fontWeight: '600',
  },
  closedHint: {
    fontFamily,
    fontSize: 12,
    color: '#8a8a8a',
  },
  timePair: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  timeSep: {
    fontFamily,
    fontSize: 13,
    color: '#8a8a8a',
  },
  timeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#d0d0d0',
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 8,
    backgroundColor: '#fff',
  },
  timeChipText: {
    fontFamily,
    fontSize: 13,
    color: '#1a1a1a',
  },
  timeDisabled: {
    fontFamily,
    fontSize: 13,
    color: '#6b6b6b',
  },
  holidayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e5e5',
    borderRadius: 8,
    padding: 12,
    backgroundColor: '#fff',
    marginBottom: 8,
    gap: 10,
  },
  addHoliday: {
    marginTop: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e5e5',
    borderRadius: 8,
    padding: 12,
    backgroundColor: '#fafafa',
    gap: 10,
  },
  addHolidayLabel: {
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  nameInput: {
    fontFamily,
    fontSize: 13,
    color: '#1a1a1a',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#d0d0d0',
    borderRadius: 6,
    paddingVertical: 8,
    paddingHorizontal: 10,
    backgroundColor: '#fff',
    outlineStyle: 'none',
  },
  addHolidayMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 10,
  },
  holidayClosed: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  menuList: {
    gap: 10,
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
  secondaryButton: {
    alignSelf: 'flex-start',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#d0d0d0',
    borderRadius: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: '#fff',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  secondaryButtonText: {
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  errorText: {
    fontFamily,
    fontSize: 12,
    color: '#b42318',
    marginTop: 12,
  },
  savedText: {
    fontFamily,
    fontSize: 12,
    color: '#2F8A4E',
    marginTop: 12,
  },
  saveButton: {
    marginTop: 16,
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
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.28)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    width: 320,
    maxWidth: '100%',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  modalTitle: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  modalDone: {
    fontFamily,
    fontSize: 14,
    fontWeight: '600',
    color: '#2F6FED',
  },
});
