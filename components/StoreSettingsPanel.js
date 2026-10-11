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
import { CANVAS, MOBILE, NAV_TAB_ACTIVE_RADIUS, useIsMobile } from '../lib/mobileUi';
import { FONT_LIGHT } from '../lib/typography';
import { IosActionRow, IosGroup, IosPage, IosRow, IosSwitch } from './IosSettings';
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

const LABEL = MOBILE.label;
const SECONDARY = '#8e8e93';
const TAB_BORDER = '#d0d0d0';
const ROW_RULE = 'rgba(42,38,30,0.08)';
const BLUE = '#007AFF';
const CHIP_SHADOW = Platform.select({
  web: { boxShadow: '0 1px 2px rgba(0,0,0,0.05)' },
  default: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 2,
    elevation: 1,
  },
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

function webFieldStyle(isMobile, quiet) {
  if (quiet) {
    return {
      fontFamily,
      fontSize: 14,
      color: LABEL,
      border: 'none',
      borderRadius: 0,
      padding: 0,
      background: 'transparent',
      minWidth: isMobile ? 78 : 86,
      outline: 'none',
      letterSpacing: '-0.2px',
    };
  }
  if (isMobile) {
    return {
      fontFamily,
      fontSize: 17,
      color: BLUE,
      border: 'none',
      borderRadius: 0,
      padding: 0,
      background: 'transparent',
      minWidth: 86,
      outline: 'none',
    };
  }
  return {
    fontFamily,
    fontSize: 13,
    color: '#1a1a1a',
    border: '1px solid #d0d0d0',
    borderRadius: 6,
    padding: '6px 8px',
    background: '#fff',
    minWidth: 108,
    outline: 'none',
  };
}

function AccessToggle({ on, disabled, onPress, quiet = false }) {
  const isMobile = useIsMobile();
  if (isMobile && !quiet) {
    return <IosSwitch on={on} disabled={disabled} onPress={onPress} />;
  }

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      style={[
        styles.toggleTrack,
        quiet && styles.toggleTrackQuiet,
        on && (quiet ? styles.toggleTrackQuietOn : styles.toggleTrackOn),
        disabled && styles.toggleDisabled,
      ]}
      accessibilityRole="switch"
      accessibilityState={{ checked: on, disabled }}
    >
      <View
        style={[
          styles.toggleThumb,
          quiet && styles.toggleThumbQuiet,
          on && styles.toggleThumbOn,
        ]}
      />
    </Pressable>
  );
}

function TimeField({ value, onChange, disabled, quiet = false }) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);

  if (disabled) {
    return (
      <Text style={[quiet ? styles.quietValue : styles.timeDisabled, isMobile && !quiet && styles.iosTimeSep]}>
        {formatClock(value)}
      </Text>
    );
  }

  if (Platform.OS === 'web') {
    return createElement('input', {
      type: 'time',
      value,
      step: 900,
      onChange: (event) => {
        if (event.target.value) onChange(event.target.value.slice(0, 5));
      },
      style: webFieldStyle(isMobile, quiet),
    });
  }

  return (
    <>
      <Pressable style={quiet ? styles.quietChip : styles.timeChip} onPress={() => setOpen(true)}>
        <Text style={quiet ? styles.quietValue : styles.timeChipText}>{formatClock(value)}</Text>
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

function DateField({ value, onChange, disabled, quiet = false }) {
  const [open, setOpen] = useState(false);
  const dateValue = parseDateParam(value || new Date());

  if (disabled) {
    return <Text style={quiet ? styles.quietValue : styles.timeDisabled}>{value ? formatPickerDate(dateValue) : '—'}</Text>;
  }

  if (Platform.OS === 'web') {
    return createElement('input', {
      type: 'date',
      value: value || '',
      onChange: (event) => onChange(event.target.value),
      style: quiet
        ? { ...webFieldStyle(false, true), minWidth: 128, textAlign: 'right' }
        : {
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
      <Pressable style={quiet ? styles.quietChip : styles.timeChip} onPress={() => setOpen(true)}>
        {quiet ? null : <Ionicons name="calendar-outline" size={14} color="#6b6b6b" />}
        <Text style={quiet ? styles.quietValue : styles.timeChipText}>
          {value ? formatPickerDate(dateValue) : 'Date'}
        </Text>
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

function SectionHead({ title, meta, action, actionDisabled, onAction, first = false }) {
  return (
    <View style={[styles.sectionHead, first && styles.sectionHeadFirst]}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionTrail}>
        {meta ? (
          <Text style={styles.sectionMeta} numberOfLines={1}>
            {meta}
          </Text>
        ) : null}
        {onAction ? (
          <Pressable
            onPress={onAction}
            disabled={actionDisabled}
            hitSlop={8}
            style={({ hovered, pressed }) => [
              styles.sectionAction,
              (hovered || pressed) && styles.sectionActionHover,
              actionDisabled && styles.sectionActionDisabled,
            ]}
            accessibilityRole="button"
            accessibilityLabel={action}
          >
            <Text style={styles.sectionActionText}>{action}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function SettingsBox({ children }) {
  return <View style={styles.listBox}>{children}</View>;
}

function SettingsRow({ last, children, onPress }) {
  const inner = (
    <View style={[styles.listRow, last && styles.listRowLast]}>
      {children}
    </View>
  );
  if (!onPress) return inner;
  return (
    <Pressable
      onPress={onPress}
      style={({ hovered, pressed }) => [
        styles.listRow,
        last && styles.listRowLast,
        (hovered || pressed) && styles.listRowHover,
      ]}
      accessibilityRole="button"
    >
      {children}
    </Pressable>
  );
}

function StoreHoursOverview({
  storeName,
  hours,
  holidays,
  draftHoliday,
  setDraftHoliday,
  canEdit,
  saving,
  unavailable,
  error,
  message,
  onBack,
  onUpdateDay,
  onAddHoliday,
  onRemoveHoliday,
  onSave,
}) {
  const isMobile = useIsMobile();
  const hoursSummary = summarizeHours(hours, storeName);

  return (
    <ScrollView
      style={styles.overviewBody}
      contentContainerStyle={[styles.overviewContent, isMobile && styles.overviewContentMobile]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {onBack ? (
        <Pressable style={styles.backRow} onPress={onBack} accessibilityRole="button" accessibilityLabel="All stores">
          <Ionicons name="chevron-back" size={16} color={LABEL} />
          <Text style={styles.backText}>All stores</Text>
        </Pressable>
      ) : null}

      <SectionHead
        first
        title="Hours"
        meta={!canEdit ? hoursSummary : undefined}
        action={canEdit && !unavailable ? (saving ? 'Saving…' : 'Save') : undefined}
        actionDisabled={saving}
        onAction={canEdit && !unavailable ? onSave : undefined}
      />
      {canEdit && hoursSummary ? <Text style={styles.sectionHint}>{hoursSummary}</Text> : null}
      <SettingsBox>
        {hours.map((row, index) => (
          <SettingsRow key={row.day} last={index === hours.length - 1}>
            <Text style={styles.rowLabel}>{WEEKDAY_LABELS[row.day]}</Text>
            <View style={styles.rowTrail}>
              {row.closed ? (
                <Text style={styles.rowMuted}>Closed</Text>
              ) : (
                <View style={styles.timePair}>
                  <TimeField
                    value={row.open}
                    disabled={!canEdit}
                    quiet
                    onChange={(open) => onUpdateDay(row.day, { open })}
                  />
                  <Text style={styles.timeSep}>–</Text>
                  <TimeField
                    value={row.close}
                    disabled={!canEdit}
                    quiet
                    onChange={(close) => onUpdateDay(row.day, { close })}
                  />
                </View>
              )}
              {canEdit ? (
                <AccessToggle
                  quiet
                  on={!row.closed}
                  onPress={() => onUpdateDay(row.day, { closed: !row.closed })}
                />
              ) : null}
            </View>
          </SettingsRow>
        ))}
      </SettingsBox>

      <SectionHead title="Holidays" />
      <SettingsBox>
        {holidays.length === 0 && !canEdit ? (
          <SettingsRow last>
            <Text style={styles.rowMuted}>No holidays</Text>
          </SettingsRow>
        ) : null}
        {holidays.map((row, index) => (
          <SettingsRow key={row.id} last={!canEdit && index === holidays.length - 1}>
            <View style={styles.rowTextWrap}>
              <Text style={styles.rowLabel}>{row.name}</Text>
              <Text style={styles.rowSub}>
                {formatPickerDate(row.date)}
                {row.closed ? ' · Closed' : ` · ${formatClock(row.open)}–${formatClock(row.close)}`}
              </Text>
            </View>
            {canEdit ? (
              <Pressable onPress={() => onRemoveHoliday(row.id)} hitSlop={8} accessibilityLabel="Remove holiday">
                <Ionicons name="trash-outline" size={16} color={SECONDARY} />
              </Pressable>
            ) : null}
          </SettingsRow>
        ))}
        {canEdit ? (
          <>
            <View style={[styles.listRow, styles.addNameRow]}>
              <TextInput
                style={styles.addNameInput}
                value={draftHoliday.name}
                onChangeText={(name) => setDraftHoliday((current) => ({ ...current, name }))}
                placeholder="Holiday name"
                placeholderTextColor={SECONDARY}
              />
            </View>
            <SettingsRow>
              <Text style={styles.rowMuted}>Date</Text>
              <DateField
                value={draftHoliday.date}
                quiet
                onChange={(date) => setDraftHoliday((current) => ({ ...current, date }))}
              />
            </SettingsRow>
            <SettingsRow
              onPress={() => setDraftHoliday((current) => ({ ...current, closed: !current.closed }))}
            >
              <Text style={styles.rowMuted}>Closed</Text>
              <AccessToggle
                quiet
                on={draftHoliday.closed}
                onPress={() => setDraftHoliday((current) => ({ ...current, closed: !current.closed }))}
              />
            </SettingsRow>
            {draftHoliday.closed ? null : (
              <SettingsRow>
                <Text style={styles.rowMuted}>Hours</Text>
                <View style={styles.timePair}>
                  <TimeField
                    value={draftHoliday.open}
                    quiet
                    onChange={(open) => setDraftHoliday((current) => ({ ...current, open }))}
                  />
                  <Text style={styles.timeSep}>–</Text>
                  <TimeField
                    value={draftHoliday.close}
                    quiet
                    onChange={(close) => setDraftHoliday((current) => ({ ...current, close }))}
                  />
                </View>
              </SettingsRow>
            )}
            <SettingsRow last onPress={onAddHoliday}>
              <Text style={styles.addAction}>Add to list</Text>
            </SettingsRow>
          </>
        ) : null}
      </SettingsBox>

      {!canEdit ? <Text style={styles.sectionHint}>A branch manager or admin can change hours for this store.</Text> : null}
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      {message ? <Text style={styles.savedText}>{message}</Text> : null}
    </ScrollView>
  );
}

function StoreHoursEditor({ session, storeName, onBack, embedded = false }) {
  const isMobile = useIsMobile();
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
        <ActivityIndicator color={LABEL} />
      </View>
    );
  }

  if (isMobile && !embedded) {
    return (
      <IosPage>
        {onBack ? (
          <IosGroup>
            <IosRow label="All Stores" onPress={onBack} />
          </IosGroup>
        ) : null}
        <IosGroup header="Hours" footer={summarizeHours(hours, storeName) || `Regular weekly hours for ${storeName}.`}>
          {hours.map((row) => (
            <IosRow
              key={row.day}
              label={WEEKDAY_LABELS[row.day]}
              value={row.closed ? 'Closed' : undefined}
              accessory={
                <IosSwitch
                  on={!row.closed}
                  disabled={!canEdit}
                  onPress={canEdit ? () => updateDay(row.day, { closed: !row.closed }) : undefined}
                />
              }
            >
              {row.closed ? null : (
                <View style={styles.iosTimePair}>
                  <TimeField
                    value={row.open}
                    disabled={!canEdit}
                    onChange={(open) => updateDay(row.day, { open })}
                  />
                  <Text style={styles.iosTimeSep}>–</Text>
                  <TimeField
                    value={row.close}
                    disabled={!canEdit}
                    onChange={(close) => updateDay(row.day, { close })}
                  />
                </View>
              )}
            </IosRow>
          ))}
        </IosGroup>

        <IosGroup
          header="Holidays"
          footer={
            holidays.length === 0
              ? 'No holidays yet. Add statutory days or company closures.'
              : 'Dates this store is closed or on a shortened schedule.'
          }
        >
          {holidays.length === 0 ? (
            <IosRow label="Holidays" value="None" />
          ) : (
            holidays.map((row) => (
              <IosRow
                key={row.id}
                label={row.name}
                value={
                  row.closed
                    ? formatPickerDate(row.date)
                    : `${formatPickerDate(row.date)} · ${formatClock(row.open)}–${formatClock(row.close)}`
                }
                accessory={
                  canEdit ? (
                    <Pressable onPress={() => removeHoliday(row.id)} hitSlop={8} accessibilityLabel="Remove holiday">
                      <Ionicons name="trash-outline" size={18} color="#FF3B30" />
                    </Pressable>
                  ) : null
                }
              />
            ))
          )}
        </IosGroup>

        {canEdit ? (
          <IosGroup header="Add Holiday">
            <View style={styles.iosFieldRow}>
              <TextInput
                style={styles.iosFieldInput}
                value={draftHoliday.name}
                onChangeText={(name) => setDraftHoliday((current) => ({ ...current, name }))}
                placeholder="Christmas Day"
                placeholderTextColor="#8E8E93"
              />
            </View>
            <IosRow
              label="Date"
              accessory={
                <DateField
                  value={draftHoliday.date}
                  onChange={(date) => setDraftHoliday((current) => ({ ...current, date }))}
                />
              }
            />
            <IosRow
              label="Closed"
              onPress={() => setDraftHoliday((current) => ({ ...current, closed: !current.closed }))}
              accessory={<IosSwitch on={draftHoliday.closed} />}
            />
            {draftHoliday.closed ? null : (
              <IosRow label="Hours">
                <View style={styles.iosTimePair}>
                  <TimeField
                    value={draftHoliday.open}
                    onChange={(open) => setDraftHoliday((current) => ({ ...current, open }))}
                  />
                  <Text style={styles.iosTimeSep}>–</Text>
                  <TimeField
                    value={draftHoliday.close}
                    onChange={(close) => setDraftHoliday((current) => ({ ...current, close }))}
                  />
                </View>
              </IosRow>
            )}
            <IosActionRow label="Add to List" onPress={addHoliday} />
          </IosGroup>
        ) : (
          <IosGroup footer="A branch manager or admin can change hours for this store.">
            <IosRow label="Editing" value="Restricted" />
          </IosGroup>
        )}

        {error ? (
          <IosGroup footer={error}>
            <IosRow label="Status" value="Error" />
          </IosGroup>
        ) : null}
        {message ? (
          <IosGroup footer={message}>
            <IosRow icon="checkmark-circle" iconColor="#34C759" label="Saved" />
          </IosGroup>
        ) : null}

        {canEdit && !unavailable ? (
          <IosGroup>
            <IosActionRow
              label={saving ? 'Saving…' : 'Save'}
              onPress={handleSave}
              disabled={saving}
            />
          </IosGroup>
        ) : null}
      </IosPage>
    );
  }

  return (
    <StoreHoursOverview
      storeName={storeName}
      hours={hours}
      holidays={holidays}
      draftHoliday={draftHoliday}
      setDraftHoliday={setDraftHoliday}
      canEdit={canEdit}
      saving={saving}
      unavailable={unavailable}
      error={error}
      message={message}
      onBack={onBack}
      onUpdateDay={updateDay}
      onAddHoliday={addHoliday}
      onRemoveHoliday={removeHoliday}
      onSave={handleSave}
    />
  );
}

export default function StoreSettingsPanel({ session, storeName, embedded = false }) {
  const isMobile = useIsMobile();
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
        <ActivityIndicator color={LABEL} />
      </View>
    );
  }

  if (isMobile && !embedded) {
    return (
      <IosPage>
        <IosGroup
          header="Stores"
          footer={
            error ||
            (unavailable
              ? 'Hours will save after the database migration is applied.'
              : 'Choose a branch to set weekly hours and holidays.')
          }
        >
          {stores.length === 0 ? (
            <IosRow label="Stores" value="None" />
          ) : (
            stores.map((store) => (
              <IosRow
                key={store.storeKey}
                icon="storefront"
                iconColor="#FF9500"
                label={store.storeName}
                value={summarizeHours(store.hours, store.storeName) || (store.exists ? '—' : 'Not Set')}
                onPress={() => setSelectedName(store.storeName)}
              />
            ))
          )}
        </IosGroup>
      </IosPage>
    );
  }

  return (
    <ScrollView
      style={styles.overviewBody}
      contentContainerStyle={[styles.overviewContent, isMobile && styles.overviewContentMobile]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <SectionHead first title="Stores" />
      <Text style={styles.sectionHint}>Choose a store to set weekly hours and holidays.</Text>
      <SettingsBox>
        {stores.length === 0 ? (
          <SettingsRow last>
            <Text style={styles.rowMuted}>No stores found. Sign in and confirm locations are loading.</Text>
          </SettingsRow>
        ) : (
          stores.map((store, index) => (
            <SettingsRow
              key={store.storeKey}
              last={index === stores.length - 1}
              onPress={() => setSelectedName(store.storeName)}
            >
              <View style={styles.rowTextWrap}>
                <Text style={styles.rowLabel}>{store.storeName}</Text>
                <Text style={styles.rowSub}>
                  {[store.systemLabel, summarizeHours(store.hours, store.storeName) || (store.exists ? '' : 'Hours not set')]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={SECONDARY} />
            </SettingsRow>
          ))
        )}
      </SettingsBox>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      {unavailable ? <Text style={styles.sectionHint}>Hours will save after the database migration is applied.</Text> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  overviewBody: {
    flex: 1,
    minHeight: 0,
    alignSelf: 'stretch',
  },
  overviewContent: {
    paddingTop: 20,
    paddingHorizontal: 48,
    paddingBottom: 40,
  },
  overviewContentMobile: {
    paddingTop: 8,
    paddingHorizontal: 16,
    paddingBottom: 28,
  },
  centered: {
    flex: 1,
    minHeight: 120,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginBottom: 8,
    alignSelf: 'flex-start',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  backText: {
    fontFamily,
    fontSize: 14,
    fontWeight: '400',
    color: LABEL,
    letterSpacing: -0.2,
  },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    paddingTop: 32,
    paddingBottom: 8,
  },
  sectionHeadFirst: {
    paddingTop: 12,
  },
  sectionTitle: {
    flexShrink: 0,
    fontFamily: FONT_LIGHT,
    fontSize: 16,
    fontWeight: '300',
    color: LABEL,
    letterSpacing: -0.2,
  },
  sectionTrail: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minWidth: 0,
    flexShrink: 1,
  },
  sectionMeta: {
    flexShrink: 1,
    minWidth: 0,
    fontFamily,
    fontSize: 13,
    fontWeight: '400',
    color: SECONDARY,
    letterSpacing: -0.15,
  },
  sectionAction: {
    paddingVertical: 4,
    paddingHorizontal: 2,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  sectionActionHover: {
    opacity: 0.7,
  },
  sectionActionDisabled: {
    opacity: 0.45,
  },
  sectionActionText: {
    fontFamily,
    fontSize: 14,
    fontWeight: '400',
    color: BLUE,
    letterSpacing: -0.2,
  },
  sectionHint: {
    fontFamily,
    fontSize: 13,
    lineHeight: 18,
    color: SECONDARY,
    letterSpacing: -0.15,
    marginBottom: 10,
  },
  listBox: {
    borderRadius: NAV_TAB_ACTIVE_RADIUS,
    borderWidth: 1,
    borderColor: TAB_BORDER,
    backgroundColor: CANVAS,
    overflow: 'hidden',
    ...CHIP_SHADOW,
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    minHeight: 46,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: ROW_RULE,
    ...Platform.select({
      web: { cursor: 'default' },
      default: {},
    }),
  },
  listRowLast: {
    borderBottomWidth: 0,
  },
  listRowHover: {
    backgroundColor: '#f5f5f5',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  rowLabel: {
    fontFamily,
    fontSize: 14,
    fontWeight: '400',
    color: LABEL,
    letterSpacing: -0.2,
  },
  rowMuted: {
    fontFamily,
    fontSize: 14,
    fontWeight: '400',
    color: SECONDARY,
    letterSpacing: -0.2,
  },
  rowSub: {
    fontFamily,
    fontSize: 12,
    lineHeight: 16,
    color: SECONDARY,
    letterSpacing: -0.1,
    marginTop: 2,
  },
  rowTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  rowTrail: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flexShrink: 0,
  },
  timePair: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  timeSep: {
    fontFamily,
    fontSize: 14,
    color: SECONDARY,
  },
  quietValue: {
    fontFamily,
    fontSize: 14,
    fontWeight: '400',
    color: LABEL,
    letterSpacing: -0.2,
    fontVariant: ['tabular-nums'],
  },
  quietChip: {
    paddingVertical: 2,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  addNameRow: {
    ...Platform.select({
      web: { cursor: 'text' },
      default: {},
    }),
  },
  addNameInput: {
    flex: 1,
    minWidth: 0,
    fontFamily,
    fontSize: 14,
    fontWeight: '400',
    color: LABEL,
    paddingVertical: 0,
    letterSpacing: -0.2,
    outlineStyle: 'none',
  },
  addAction: {
    fontFamily,
    fontSize: 14,
    fontWeight: '400',
    color: BLUE,
    letterSpacing: -0.2,
  },
  errorText: {
    fontFamily,
    fontSize: 13,
    color: '#B91C1C',
    marginTop: 12,
    letterSpacing: -0.15,
  },
  savedText: {
    fontFamily,
    fontSize: 13,
    color: '#15803D',
    marginTop: 12,
    letterSpacing: -0.15,
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
  iosTimePair: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  iosTimeSep: {
    fontFamily,
    fontSize: 17,
    color: '#8E8E93',
  },
  iosFieldRow: {
    minHeight: 44,
    paddingHorizontal: 16,
    justifyContent: 'center',
    backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(60, 60, 67, 0.29)',
  },
  iosFieldInput: {
    fontFamily,
    fontSize: 17,
    color: '#000',
    paddingVertical: 10,
    letterSpacing: -0.4,
    outlineStyle: 'none',
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
  toggleTrackQuiet: {
    width: 36,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(118, 118, 128, 0.24)',
  },
  toggleTrackOn: {
    backgroundColor: '#1a1a1a',
  },
  toggleTrackQuietOn: {
    backgroundColor: LABEL,
  },
  toggleThumb: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#fff',
    alignSelf: 'flex-start',
  },
  toggleThumbQuiet: {
    width: 18,
    height: 18,
    borderRadius: 9,
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
