import { createElement, useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
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
import { formatDateParam, formatPickerDate, parseDateParam } from '../lib/transactions';
import { fetchTransferStores, uniquePreferredStores } from '../lib/locations';
import { CANVAS, MOBILE, NAV_TAB_ACTIVE_RADIUS, useIsMobile } from '../lib/mobileUi';
import { canonicalStoreName, HOME_PINNED_STORES, storesMatch } from '../lib/storeCatalog';
import { FONT_LIGHT } from '../lib/typography';
import {
  createSupply,
  deleteSupply,
  formatSupplyQty,
  listSupplies,
  SUPPLY_STATUSES,
  supplyStatusMeta,
  updateSupply,
} from '../lib/supplies';

const ALL_STORES = '';

const fontFamily = Platform.select({ ios: 'Sohne', android: 'Sohne', default: 'Sohne' });
const titleFontFamily = FONT_LIGHT;
const TEXT = MOBILE.label;
const SECONDARY = MOBILE.secondary;
const BLUE = '#007AFF';
const PAGE = '#F2F2F7';
const TAB_BORDER = '#d0d0d0';
const HAIRLINE = '#e5e5ea';
const CHEVRON = '#C7C7CC';
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

const COLUMNS = [
  { key: 'name', label: 'Supply', style: 'colName' },
  { key: 'brand', label: 'Brand', style: 'colBrand' },
  { key: 'details', label: 'Other product details', style: 'colDetails' },
  { key: 'boughtFrom', label: 'Bought from', style: 'colBought' },
  { key: 'qty', label: 'Qty', style: 'colQty' },
  { key: 'date', label: 'Last bought', style: 'colDate' },
  { key: 'status', label: 'Status', style: 'colStatus' },
];

const EMPTY_FORM = {
  name: '',
  brand: '',
  details: '',
  boughtFrom: '',
  currentQuantity: '0',
  status: 'in_stock',
  lastBoughtDate: '',
  storeName: '',
};

function draftFromRow(row) {
  return {
    name: row.name,
    brand: row.brand,
    details: row.details,
    boughtFrom: row.boughtFrom || '',
    currentQuantity: String(row.currentQuantity ?? '0'),
    status: row.status || 'in_stock',
    lastBoughtDate: row.lastBoughtDate || '',
    storeName: row.storeName || '',
  };
}

function confirmDeleteSupply(name) {
  const message = `Remove ${name || 'this supply'} from the list?`;
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.confirm) {
    return Promise.resolve(window.confirm(message));
  }
  return new Promise((resolve) => {
    Alert.alert('Delete supply', message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: 'Delete', style: 'destructive', onPress: () => resolve(true) },
    ]);
  });
}

function storeOptions(names, { includeAll = true } = {}) {
  const options = includeAll ? [{ key: ALL_STORES, label: 'All stores' }] : [];
  for (const name of names) {
    options.push({ key: name, label: name });
  }
  return options;
}

function StoreSelect({ value, options, onChange, label, compact = false, fill = false }) {
  const [open, setOpen] = useState(false);
  const selected = options.find((item) => item.key === value) || options[0];
  return (
    <View
      style={[styles.storeSelect, fill && styles.storeSelectFill, open && styles.storeSelectOpen]}
      pointerEvents="box-none"
    >
      {label ? <Text style={styles.storeSelectCaption}>{label}</Text> : null}
      <Pressable
        onPress={() => setOpen((current) => !current)}
        style={({ hovered, pressed }) => [
          styles.storeSelectBtn,
          compact && styles.storeSelectBtnCompact,
          fill && styles.storeSelectBtnFill,
          (open || hovered || pressed) && styles.storeSelectBtnOpen,
        ]}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={label || 'Store'}
      >
        <Text style={styles.storeSelectValue} numberOfLines={1}>
          {selected?.label || 'Store'}
        </Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={14} color={SECONDARY} />
      </Pressable>
      {open ? (
        <>
          <Pressable style={styles.storeSelectDismiss} onPress={() => setOpen(false)} />
          <ScrollView style={styles.storeSelectMenu} keyboardShouldPersistTaps="handled">
            {options.map((item) => {
              const active = item.key === value;
              return (
                <Pressable
                  key={item.key || 'all'}
                  onPress={() => {
                    onChange(item.key);
                    setOpen(false);
                  }}
                  style={({ hovered, pressed }) => [
                    styles.storeSelectOption,
                    active && styles.storeSelectOptionActive,
                    (hovered || pressed) && styles.storeSelectOptionHover,
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                >
                  <Text
                    style={[styles.storeSelectOptionText, active && styles.storeSelectOptionTextActive]}
                    numberOfLines={1}
                  >
                    {item.label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </>
      ) : null}
    </View>
  );
}

function StatusPill({ status, onPress, compact = false }) {
  const meta = supplyStatusMeta(status);
  const body = (
    <View style={[styles.statusPill, { backgroundColor: meta.tint }, compact && styles.statusPillCompact]}>
      <View style={[styles.statusDot, { backgroundColor: meta.color }]} />
      <Text style={[styles.statusPillText, { color: meta.color }]} numberOfLines={1}>
        {meta.label}
      </Text>
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={`Status ${meta.label}. Change status.`}
    >
      {body}
    </Pressable>
  );
}

function StatusPicker({ value, onChange }) {
  return (
    <View style={styles.statusPicker}>
      {SUPPLY_STATUSES.map((item) => {
        const active = item.key === value;
        return (
          <Pressable
            key={item.key}
            onPress={() => onChange(item.key)}
            style={[
              styles.statusChoice,
              { backgroundColor: item.tint, borderColor: active ? item.color : 'transparent' },
            ]}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={item.label}
          >
            <View style={[styles.statusDot, { backgroundColor: item.color }]} />
            <Text style={[styles.statusChoiceText, { color: item.color }]}>{item.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function cycleStatus(status) {
  const index = SUPPLY_STATUSES.findIndex((item) => item.key === status);
  return SUPPLY_STATUSES[(index + 1) % SUPPLY_STATUSES.length].key;
}

function DetailField({ label, last, children }) {
  return (
    <View style={[styles.detailRow, last && styles.detailRowLast]}>
      <Text style={styles.detailLabel}>{label}</Text>
      <View style={styles.detailValueWrap}>{children}</View>
    </View>
  );
}

function SupplyModal({
  visible,
  title,
  draft,
  onChange,
  onSubmit,
  onClose,
  onDelete,
  saving,
  deleting,
  error,
  isMobile,
  storeChoices,
  allowAllStores,
}) {
  const set = (key) => (value) => onChange({ ...draft, [key]: value });
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={[styles.modalRoot, isMobile && styles.modalRootMobile]}>
        <Pressable style={styles.modalBackdrop} onPress={onClose} accessibilityLabel="Close" />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={[styles.modalSheet, isMobile && styles.modalSheetMobile]}
        >
          <View style={styles.modalNav}>
            <Pressable onPress={onClose} hitSlop={8} style={styles.modalNavSide} accessibilityLabel="Cancel">
              <Text style={styles.modalCancel}>Cancel</Text>
            </Pressable>
            <Text style={styles.modalTitle} numberOfLines={1}>
              {title}
            </Text>
            <Pressable
              onPress={onSubmit}
              disabled={saving}
              hitSlop={8}
              style={styles.modalNavSideRight}
              accessibilityLabel="Save"
            >
              {saving ? (
                <ActivityIndicator color={BLUE} size="small" />
              ) : (
                <Text style={styles.modalSave}>Save</Text>
              )}
            </Pressable>
          </View>
          <View style={styles.modalStoreBar}>
            <StoreSelect
              value={draft.storeName}
              options={storeOptions(storeChoices, { includeAll: allowAllStores })}
              onChange={set('storeName')}
              label="Store"
            />
          </View>
          <ScrollView
            style={styles.modalScroll}
            contentContainerStyle={styles.modalScrollContent}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.appleGroup}>
              <DetailField label="Supply">
                <TextInput
                  style={styles.detailInput}
                  value={draft.name}
                  onChangeText={set('name')}
                  placeholder="Name"
                  placeholderTextColor={SECONDARY}
                  autoCapitalize="words"
                  accessibilityLabel="Supply name"
                />
              </DetailField>
              <DetailField label="Brand">
                <TextInput
                  style={styles.detailInput}
                  value={draft.brand}
                  onChangeText={set('brand')}
                  placeholder="—"
                  placeholderTextColor={SECONDARY}
                  autoCapitalize="words"
                  accessibilityLabel="Brand"
                />
              </DetailField>
              <DetailField label="Details">
                <TextInput
                  style={styles.detailInput}
                  value={draft.details}
                  onChangeText={set('details')}
                  placeholder="—"
                  placeholderTextColor={SECONDARY}
                  accessibilityLabel="Other product details"
                />
              </DetailField>
              <DetailField label="Bought from" last>
                <TextInput
                  style={styles.detailInput}
                  value={draft.boughtFrom}
                  onChangeText={set('boughtFrom')}
                  placeholder="Vendor"
                  placeholderTextColor={SECONDARY}
                  autoCapitalize="words"
                  accessibilityLabel="Bought from"
                />
              </DetailField>
            </View>
            <View style={styles.appleGroup}>
              <DetailField label="Quantity">
                <TextInput
                  style={styles.detailInput}
                  value={draft.currentQuantity}
                  onChangeText={set('currentQuantity')}
                  placeholder="0"
                  placeholderTextColor={SECONDARY}
                  keyboardType="decimal-pad"
                  accessibilityLabel="Current quantity"
                />
              </DetailField>
              <DetailField label="Last bought">
                <SupplyDateField
                  value={draft.lastBoughtDate}
                  onChange={set('lastBoughtDate')}
                  variant="plain"
                  accessibilityLabel="Last bought date"
                />
              </DetailField>
              <DetailField label="Status" last>
                <StatusPicker value={draft.status || 'in_stock'} onChange={set('status')} />
              </DetailField>
            </View>
            {onDelete ? (
              <Pressable
                onPress={onDelete}
                disabled={saving || deleting}
                style={({ pressed }) => [styles.deleteButton, pressed && styles.deleteButtonPressed]}
                accessibilityRole="button"
                accessibilityLabel="Delete supply"
              >
                {deleting ? (
                  <ActivityIndicator color="#B91C1C" size="small" />
                ) : (
                  <Text style={styles.deleteButtonText}>Delete Supply</Text>
                )}
              </Pressable>
            ) : null}
            {error ? <Text style={styles.modalError}>{error}</Text> : null}
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

function CellInput({ value, onCommit, style, accessibilityLabel, keyboardType = 'decimal-pad' }) {
  const [text, setText] = useState(value);
  useEffect(() => {
    setText(value);
  }, [value]);
  return (
    <TextInput
      style={[styles.cellInput, style]}
      value={text}
      onChangeText={setText}
      onBlur={() => {
        if (text !== value) onCommit(text);
      }}
      onSubmitEditing={() => {
        if (text !== value) onCommit(text);
      }}
      placeholder="—"
      placeholderTextColor={SECONDARY}
      keyboardType={keyboardType}
      accessibilityLabel={accessibilityLabel}
    />
  );
}

function SupplyDateField({
  value,
  onChange,
  variant = 'cell',
  style,
  accessibilityLabel,
  maximumDate = new Date(),
}) {
  const [open, setOpen] = useState(false);
  const plain = variant === 'plain';
  const hasValue = Boolean(String(value || '').trim());
  const dateValue = parseDateParam(hasValue ? value : new Date());
  const displayText = hasValue ? formatPickerDate(parseDateParam(value)) : '—';

  const commit = (next) => {
    if (!next) return;
    let date = parseDateParam(next);
    if (maximumDate && date > parseDateParam(maximumDate)) {
      date = parseDateParam(maximumDate);
    }
    onChange(formatDateParam(date));
  };

  const field = (
    <>
      {!plain ? <Ionicons name="calendar-outline" size={14} color={SECONDARY} /> : null}
      {Platform.OS === 'web' ? (
        createElement('input', {
          type: 'date',
          value: hasValue ? formatDateParam(dateValue) : '',
          max: maximumDate ? formatDateParam(maximumDate) : undefined,
          'aria-label': accessibilityLabel,
          onChange: (event) => {
            if (event.target.value) commit(event.target.value);
          },
          style: {
            border: 'none',
            background: 'transparent',
            fontFamily,
            fontSize: plain ? 15 : 14,
            fontWeight: plain ? '400' : '300',
            color: hasValue ? TEXT : SECONDARY,
            padding: 0,
            margin: 0,
            outline: 'none',
            cursor: 'pointer',
            minWidth: plain ? 0 : 88,
            width: plain ? '100%' : undefined,
            textAlign: plain ? 'right' : 'left',
            letterSpacing: '-0.2px',
          },
        })
      ) : (
        <Text
          style={[
            plain ? styles.detailDateValue : styles.cellInput,
            !hasValue && styles.datePlaceholder,
            style,
          ]}
        >
          {displayText}
        </Text>
      )}
      {plain ? <Ionicons name="chevron-down" size={14} color={CHEVRON} /> : null}
    </>
  );

  if (Platform.OS === 'web') {
    return (
      <View style={[plain ? styles.dateChipPlain : styles.dateFieldCell, style]} accessibilityLabel={accessibilityLabel}>
        {field}
      </View>
    );
  }

  return (
    <>
      <Pressable
        style={[plain ? styles.dateChipPlain : styles.dateFieldCell, style]}
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
      >
        {field}
      </Pressable>
      {Platform.OS === 'android' && open ? (
        <DateTimePicker
          value={dateValue}
          mode="date"
          display="default"
          maximumDate={maximumDate ? parseDateParam(maximumDate) : undefined}
          onChange={(event, selected) => {
            setOpen(false);
            if (event.type !== 'dismissed' && selected) commit(selected);
          }}
        />
      ) : null}
      {Platform.OS === 'ios' ? (
        <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
          <View style={styles.dateModalBackdrop}>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setOpen(false)} />
            <View style={styles.dateModalCard}>
              <View style={styles.dateModalHeader}>
                <Text style={styles.dateModalTitle}>{accessibilityLabel || 'Date'}</Text>
                <Pressable onPress={() => setOpen(false)} hitSlop={8}>
                  <Text style={styles.dateModalDone}>Done</Text>
                </Pressable>
              </View>
              <DateTimePicker
                value={dateValue}
                mode="date"
                display="spinner"
                maximumDate={maximumDate ? parseDateParam(maximumDate) : undefined}
                onChange={(_, selected) => {
                  if (selected) commit(selected);
                }}
              />
            </View>
          </View>
        </Modal>
      ) : null}
    </>
  );
}

export default function SuppliesScreen({ session, storeFilter = '', embedded = false }) {
  const isMobile = useIsMobile();
  const lockedStore = canonicalStoreName(storeFilter) || String(storeFilter || '').trim();
  const homeStore = canonicalStoreName(session?.profile?.locationName) || String(session?.profile?.locationName || '').trim();
  const [storeNames, setStoreNames] = useState(() => [...HOME_PINNED_STORES]);
  const [selectedStore, setSelectedStore] = useState(lockedStore || homeStore || ALL_STORES);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modalError, setModalError] = useState('');
  const [mode, setMode] = useState(null);
  const [editingId, setEditingId] = useState('');
  const [draft, setDraft] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!session?.token) return undefined;
    let cancelled = false;
    fetchTransferStores(session)
      .then((result) => {
        if (cancelled) return;
        const names = uniquePreferredStores(result.stores || [])
          .map((store) => canonicalStoreName(store.name) || store.name)
          .filter(Boolean);
        const merged = [];
        for (const name of [...HOME_PINNED_STORES, ...names]) {
          if (!merged.some((item) => storesMatch(item, name))) merged.push(name);
        }
        merged.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
        setStoreNames(merged);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [session]);

  useEffect(() => {
    if (lockedStore) setSelectedStore(lockedStore);
  }, [lockedStore]);

  useEffect(() => {
    if (lockedStore || !selectedStore) return;
    const match = storeNames.find((name) => storesMatch(name, selectedStore));
    if (match && match !== selectedStore) setSelectedStore(match);
  }, [lockedStore, selectedStore, storeNames]);

  const load = useCallback(async () => {
    if (!session?.token) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      setRows(await listSupplies(selectedStore));
    } catch (loadError) {
      setError(loadError?.message || 'Could not load supplies.');
    } finally {
      setLoading(false);
    }
  }, [session?.token, selectedStore]);

  useEffect(() => {
    load();
  }, [load]);

  const closeModal = () => {
    setMode(null);
    setEditingId('');
    setDraft({ ...EMPTY_FORM });
    setModalError('');
  };

  const startAdd = () => {
    setEditingId('');
    setDraft({
      ...EMPTY_FORM,
      status: 'in_stock',
      currentQuantity: '0',
      storeName: selectedStore || homeStore || ALL_STORES,
    });
    setModalError('');
    setMode('add');
  };

  const startEdit = (row) => {
    setEditingId(row.id);
    setDraft(draftFromRow(row));
    setModalError('');
    setMode('edit');
  };

  const replaceRow = (row) => {
    setRows((current) => {
      const next = current.filter((item) => item.id !== row.id);
      if (selectedStore && !storesMatch(row.storeName, selectedStore)) return next;
      return [...next, row].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    });
  };

  const onCreate = async () => {
    setSaving(true);
    setModalError('');
    try {
      const targets = draft.storeName ? [draft.storeName] : storeNames;
      await createSupply({
        ...draft,
        status: draft.status || 'in_stock',
        storeNames: targets,
      });
      closeModal();
      await load();
    } catch (saveError) {
      setModalError(saveError?.message || 'Could not save that supply.');
    } finally {
      setSaving(false);
    }
  };

  const onUpdate = async () => {
    if (!editingId) return;
    if (!draft.storeName) {
      setModalError('Choose a store.');
      return;
    }
    setSaving(true);
    setModalError('');
    try {
      replaceRow(await updateSupply(editingId, draft));
      closeModal();
    } catch (saveError) {
      setModalError(saveError?.message || 'Could not update that supply.');
    } finally {
      setSaving(false);
    }
  };

  const patchRow = async (row, patch) => {
    setError('');
    try {
      replaceRow(await updateSupply(row.id, { ...draftFromRow(row), ...patch }));
    } catch (saveError) {
      setError(saveError?.message || 'Could not update that supply.');
    }
  };

  const removeRow = async (row) => {
    const ok = await confirmDeleteSupply(row.name);
    if (!ok) return;
    setError('');
    setDeleting(true);
    try {
      await deleteSupply(row.id);
      setRows((current) => current.filter((item) => item.id !== row.id));
      if (editingId === row.id) closeModal();
    } catch (deleteError) {
      setError(deleteError?.message || 'Could not delete that supply.');
    } finally {
      setDeleting(false);
    }
  };

  const onDeleteFromModal = async () => {
    if (!editingId) return;
    const row = rows.find((item) => item.id === editingId);
    if (!row) return;
    setModalError('');
    const ok = await confirmDeleteSupply(row.name);
    if (!ok) return;
    setDeleting(true);
    try {
      await deleteSupply(row.id);
      setRows((current) => current.filter((item) => item.id !== row.id));
      closeModal();
    } catch (deleteError) {
      setModalError(deleteError?.message || 'Could not delete that supply.');
    } finally {
      setDeleting(false);
    }
  };

  const empty = useMemo(() => {
    if (selectedStore) return `No supplies listed for ${selectedStore} yet.`;
    return 'No supplies yet. Add the first item to this list.';
  }, [selectedStore]);
  const showStoreColumn = !selectedStore;
  const tableColumns = showStoreColumn
    ? [{ key: 'store', label: 'Store', style: 'colStore' }, ...COLUMNS]
    : COLUMNS;

  if (!session?.token) {
    return (
      <View style={[styles.screen, embedded && styles.screenEmbedded]}>
        <Text style={styles.empty}>Sign in to keep a supplies list.</Text>
      </View>
    );
  }

  const storePicker = embedded || lockedStore ? null : (
    <StoreSelect
      value={selectedStore}
      options={storeOptions(storeNames, { includeAll: true })}
      onChange={setSelectedStore}
      label={isMobile ? undefined : 'Store'}
      compact={isMobile}
    />
  );

  const addChip = (
    <Pressable
      onPress={startAdd}
      style={({ hovered, pressed }) => [styles.addChip, (hovered || pressed) && styles.addChipHover]}
      accessibilityRole="button"
      accessibilityLabel="Add supply"
    >
      <Ionicons name="add" size={16} color={TEXT} />
      <Text style={styles.addChipText}>Add</Text>
    </Pressable>
  );

  const actionBar = (
    <View
      style={[
        styles.actionBar,
        isMobile && styles.actionBarMobile,
        embedded && !isMobile && styles.actionBarEmbedded,
      ]}
    >
      {storePicker}
      {addChip}
    </View>
  );

  const renderDesktopRow = (row, index) => (
    <View
      key={row.id}
      style={[styles.row, index === rows.length - 1 && styles.rowLast]}
    >
      <View style={styles.rowBody}>
        {showStoreColumn ? (
          <Pressable onPress={() => startEdit(row)} style={styles.colStore} accessibilityRole="button">
            <Text style={styles.cell} numberOfLines={1}>
              {row.storeName || '—'}
            </Text>
          </Pressable>
        ) : null}
        <Pressable
          onPress={() => startEdit(row)}
          style={styles.colName}
          accessibilityRole="button"
          accessibilityLabel={`Open ${row.name}`}
        >
          <Text style={styles.cellName} numberOfLines={1}>
            {row.name}
          </Text>
        </Pressable>
        <Pressable onPress={() => startEdit(row)} style={styles.colBrand} accessibilityRole="button">
          <Text style={styles.cell} numberOfLines={1}>
            {row.brand || '—'}
          </Text>
        </Pressable>
        <Pressable onPress={() => startEdit(row)} style={styles.colDetails} accessibilityRole="button">
          <Text style={styles.cell} numberOfLines={1}>
            {row.details || '—'}
          </Text>
        </Pressable>
        <CellInput
          value={row.boughtFrom || ''}
          onCommit={(value) => patchRow(row, { boughtFrom: value })}
          style={styles.colBought}
          keyboardType="default"
          accessibilityLabel={`${row.name} bought from`}
        />
        <CellInput
          value={formatSupplyQty(row.currentQuantity)}
          onCommit={(value) => patchRow(row, { currentQuantity: value })}
          style={styles.colQty}
          accessibilityLabel={`${row.name} quantity`}
        />
        <SupplyDateField
          value={row.lastBoughtDate || ''}
          onChange={(value) => patchRow(row, { lastBoughtDate: value })}
          style={styles.colDate}
          accessibilityLabel={`${row.name} last bought date`}
        />
        <View style={styles.colStatus}>
          <StatusPill status={row.status} onPress={() => patchRow(row, { status: cycleStatus(row.status) })} compact />
        </View>
        <Pressable
          onPress={() => removeRow(row)}
          style={({ hovered, pressed }) => [styles.colDelete, (hovered || pressed) && styles.colDeleteHover]}
          accessibilityRole="button"
          accessibilityLabel={`Delete ${row.name}`}
        >
          <Ionicons name="trash-outline" size={16} color={SECONDARY} />
        </Pressable>
      </View>
    </View>
  );

  return (
    <View style={[styles.screen, embedded && styles.screenEmbedded]}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, isMobile && styles.scrollContentMobile]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        horizontal={false}
      >
        {!embedded || isMobile ? (
          <View style={[styles.head, isMobile && styles.headMobile]}>
            <View style={[styles.headRow, isMobile && styles.headRowMobile]}>
              <View style={styles.titleBlock}>
                <Text style={[styles.title, isMobile && styles.titleMobile]} numberOfLines={2}>
                  Supplies
                </Text>
                {selectedStore && !storePicker ? <Text style={styles.subtitle}>{selectedStore}</Text> : null}
              </View>
            </View>
            <View
              style={styles.headRule}
              {...(Platform.OS === 'web' ? { className: 'cgold-home-row-rule' } : null)}
            />
            {actionBar}
          </View>
        ) : (
          actionBar
        )}
        {error ? <Text style={[styles.error, isMobile && styles.errorMobile]}>{error}</Text> : null}
        {loading ? (
          <ActivityIndicator color={SECONDARY} style={styles.spinner} />
        ) : !isMobile ? (
          <ScrollView
            horizontal
            style={styles.tableScroll}
            contentContainerStyle={styles.tableScrollContent}
            showsHorizontalScrollIndicator={false}
          >
            <View style={styles.listBox}>
              <View style={[styles.row, styles.headerRow]}>
                <View style={styles.rowBody}>
                  {tableColumns.map((col) => (
                    <Text key={col.key} style={[styles.headerCell, styles[col.style]]} numberOfLines={1}>
                      {col.label}
                    </Text>
                  ))}
                  <View style={styles.colDelete} />
                </View>
              </View>
              {rows.length === 0 ? (
                <View style={[styles.row, styles.rowLast]}>
                  <View style={styles.rowBody}>
                    <Text style={styles.empty}>{empty}</Text>
                  </View>
                </View>
              ) : (
                rows.map(renderDesktopRow)
              )}
            </View>
          </ScrollView>
        ) : rows.length === 0 ? (
          <Text style={styles.empty}>{empty}</Text>
        ) : (
          <View style={styles.mobileList}>
            {rows.map((row, index) => (
              <Pressable
                key={row.id}
                onPress={() => startEdit(row)}
                style={[styles.mobileRow, index === rows.length - 1 && styles.mobileRowLast]}
                accessibilityRole="button"
                accessibilityLabel={`Open ${row.name}`}
              >
                <View style={styles.mobileRowTop}>
                  <Text style={styles.mobileName} numberOfLines={1}>
                    {row.name}
                  </Text>
                  <View style={styles.mobileRowTopActions}>
                    <Pressable
                      onPress={(event) => {
                        event?.stopPropagation?.();
                        patchRow(row, { status: cycleStatus(row.status) });
                      }}
                    >
                      <StatusPill status={row.status} compact />
                    </Pressable>
                    <Pressable
                      onPress={(event) => {
                        event?.stopPropagation?.();
                        void removeRow(row);
                      }}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel={`Delete ${row.name}`}
                    >
                      <Ionicons name="trash-outline" size={18} color={SECONDARY} />
                    </Pressable>
                  </View>
                </View>
                <Text style={styles.mobileMeta} numberOfLines={2}>
                  {[
                    showStoreColumn ? row.storeName : null,
                    row.brand || 'No brand',
                    row.details,
                    row.boughtFrom && `From ${row.boughtFrom}`,
                  ]
                    .filter(Boolean)
                    .join('  ·  ')}
                </Text>
                <View style={styles.mobileMetrics}>
                  <Pressable onPress={(event) => event?.stopPropagation?.()} style={styles.mobileMetric}>
                    <Text style={styles.mobileMetricLabel}>Qty</Text>
                    <CellInput
                      value={formatSupplyQty(row.currentQuantity)}
                      onCommit={(value) => patchRow(row, { currentQuantity: value })}
                      accessibilityLabel={`${row.name} quantity`}
                    />
                  </Pressable>
                  <Pressable onPress={(event) => event?.stopPropagation?.()} style={styles.mobileMetric}>
                    <Text style={styles.mobileMetricLabel}>Last bought</Text>
                    <SupplyDateField
                      value={row.lastBoughtDate || ''}
                      onChange={(value) => patchRow(row, { lastBoughtDate: value })}
                      accessibilityLabel={`${row.name} last bought date`}
                    />
                  </Pressable>
                </View>
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>
      <SupplyModal
        visible={Boolean(mode)}
        title={mode === 'add' ? 'New Supply' : draft.name || 'Supply'}
        draft={draft}
        onChange={setDraft}
        onSubmit={mode === 'add' ? onCreate : onUpdate}
        onClose={closeModal}
        onDelete={mode === 'edit' ? onDeleteFromModal : undefined}
        saving={saving}
        deleting={deleting}
        error={modalError}
        isMobile={isMobile}
        storeChoices={storeNames}
        allowAllStores={mode === 'add' && !embedded}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: CANVAS,
  },
  screenEmbedded: {
    backgroundColor: 'transparent',
  },
  scroll: {
    flex: 1,
    minHeight: 0,
  },
  scrollContent: {
    paddingBottom: 36,
  },
  scrollContentMobile: {
    paddingHorizontal: 16,
    paddingBottom: 48,
  },
  head: {
    marginBottom: 8,
    paddingTop: 20,
    paddingHorizontal: 48,
  },
  headMobile: {
    paddingHorizontal: 0,
    paddingTop: 8,
  },
  headRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 16,
    paddingBottom: 20,
  },
  headRowMobile: {
    alignItems: 'center',
    paddingBottom: 14,
  },
  actionBar: {
    position: 'relative',
    zIndex: 50,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'flex-end',
    gap: 8,
    paddingTop: 4,
    paddingBottom: 12,
    ...Platform.select({ web: { overflow: 'visible' }, default: {} }),
  },
  actionBarMobile: {
    paddingBottom: 10,
  },
  actionBarEmbedded: {
    paddingHorizontal: 48,
    paddingTop: 12,
    paddingBottom: 8,
  },
  titleBlock: {
    flex: 1,
    minWidth: 0,
    paddingTop: 4,
    gap: 6,
  },
  title: {
    fontFamily: titleFontFamily,
    fontSize: 22,
    lineHeight: 26,
    fontWeight: '300',
    color: TEXT,
    letterSpacing: -0.3,
  },
  titleMobile: {
    fontSize: 20,
    lineHeight: 24,
  },
  subtitle: {
    fontFamily,
    fontSize: 13,
    lineHeight: 18,
    color: SECONDARY,
    letterSpacing: -0.15,
  },
  headRule: {
    alignSelf: 'stretch',
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(42,38,30,0.16)',
    marginTop: 4,
    marginBottom: 4,
  },
  addChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 32,
    paddingHorizontal: 10,
    borderRadius: NAV_TAB_ACTIVE_RADIUS,
    borderWidth: 1,
    borderColor: TAB_BORDER,
    backgroundColor: CANVAS,
    ...CHIP_SHADOW,
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  addChipHover: {
    backgroundColor: 'rgba(60, 60, 67, 0.045)',
  },
  addChipText: {
    fontFamily,
    fontSize: 14,
    color: TEXT,
    letterSpacing: -0.15,
  },
  error: {
    fontFamily,
    fontSize: 13,
    color: '#B91C1C',
    paddingHorizontal: 48,
    paddingBottom: 8,
  },
  errorMobile: {
    paddingHorizontal: 0,
  },
  spinner: {
    marginTop: 36,
  },
  empty: {
    fontFamily,
    fontSize: 14,
    color: SECONDARY,
    letterSpacing: -0.15,
  },
  tableScroll: {
    width: '100%',
    zIndex: 0,
  },
  tableScrollContent: {
    minWidth: '100%',
    paddingHorizontal: 48,
  },
  listBox: {
    minWidth: 1040,
    flex: 1,
    borderRadius: NAV_TAB_ACTIVE_RADIUS,
    borderWidth: 1,
    borderColor: TAB_BORDER,
    backgroundColor: CANVAS,
    overflow: 'hidden',
    ...CHIP_SHADOW,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 46,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(42,38,30,0.08)',
  },
  headerRow: {
    minHeight: 34,
  },
  rowLast: {
    borderBottomWidth: 0,
  },
  rowBody: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 24,
    paddingLeft: 16,
    paddingRight: 20,
  },
  headerCell: {
    fontFamily,
    fontSize: 13,
    fontWeight: '500',
    color: SECONDARY,
    letterSpacing: -0.15,
  },
  cell: {
    fontFamily: titleFontFamily,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '400',
    color: TEXT,
    letterSpacing: -0.2,
  },
  cellName: {
    fontFamily: titleFontFamily,
    fontSize: 14,
    lineHeight: 18,
    color: TEXT,
    letterSpacing: -0.2,
  },
  cellInput: {
    fontFamily: titleFontFamily,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '300',
    color: TEXT,
    letterSpacing: -0.2,
    paddingVertical: 4,
    paddingHorizontal: 0,
    minWidth: 0,
    ...Platform.select({ web: { outlineStyle: 'none' }, default: {} }),
  },
  colStore: { flex: 0.9, minWidth: 112, maxWidth: 168 },
  colName: { flex: 1.3, minWidth: 128, maxWidth: 220 },
  colBrand: { flex: 0.9, minWidth: 88, maxWidth: 160 },
  colDetails: { flex: 1.5, minWidth: 140 },
  colBought: { flex: 1.1, minWidth: 120, maxWidth: 200 },
  colQty: { width: 56, flexShrink: 0 },
  colStatus: { width: 108, flexShrink: 0 },
  colDate: { width: 112, flexShrink: 0 },
  colDelete: {
    width: 32,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  colDeleteHover: {
    opacity: 0.65,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 5,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  statusPillCompact: {
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusPillText: {
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: -0.1,
  },
  statusPicker: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: 6,
  },
  statusChoice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 5,
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  statusChoiceText: {
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
  },
  mobileList: {
    borderRadius: NAV_TAB_ACTIVE_RADIUS,
    borderWidth: 1,
    borderColor: TAB_BORDER,
    backgroundColor: CANVAS,
    overflow: 'hidden',
  },
  mobileRow: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(42,38,30,0.08)',
  },
  mobileRowLast: {
    borderBottomWidth: 0,
  },
  mobileRowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  mobileRowTopActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexShrink: 0,
  },
  mobileName: {
    fontFamily: titleFontFamily,
    fontSize: 16,
    lineHeight: 20,
    color: TEXT,
    letterSpacing: -0.2,
    flex: 1,
    minWidth: 0,
  },
  mobileMeta: {
    fontFamily,
    fontSize: 13,
    lineHeight: 16,
    color: SECONDARY,
    letterSpacing: -0.1,
  },
  mobileMetrics: {
    flexDirection: 'row',
    gap: 12,
    paddingTop: 4,
  },
  mobileMetric: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  mobileMetricLabel: {
    fontFamily,
    fontSize: 11,
    color: SECONDARY,
    letterSpacing: -0.08,
  },
  mobileMetricValue: {
    fontFamily: titleFontFamily,
    fontSize: 14,
    color: TEXT,
    letterSpacing: -0.2,
  },
  modalRoot: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalRootMobile: {
    justifyContent: 'flex-end',
    padding: 0,
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.28)',
  },
  modalSheet: {
    width: '100%',
    maxWidth: 440,
    maxHeight: '88%',
    backgroundColor: PAGE,
    borderRadius: 14,
    overflow: Platform.OS === 'web' ? 'visible' : 'hidden',
    ...Platform.select({
      web: { boxShadow: '0 16px 48px rgba(0,0,0,0.18)' },
      default: {
        shadowColor: '#000',
        shadowOpacity: 0.18,
        shadowRadius: 24,
        shadowOffset: { width: 0, height: 10 },
        elevation: 8,
      },
    }),
  },
  modalSheetMobile: {
    maxWidth: '100%',
    maxHeight: '92%',
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    paddingBottom: 12,
  },
  modalNav: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 52,
    paddingHorizontal: 8,
    backgroundColor: 'rgba(242,242,247,0.94)',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HAIRLINE,
  },
  modalNavSide: {
    minWidth: 72,
    minHeight: 44,
    justifyContent: 'center',
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  modalNavSideRight: {
    minWidth: 72,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'flex-end',
    paddingRight: 8,
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  modalCancel: {
    fontFamily,
    fontSize: 17,
    color: BLUE,
    paddingLeft: 8,
  },
  modalTitle: {
    fontFamily,
    flex: 1,
    fontSize: 17,
    fontWeight: '600',
    color: TEXT,
    textAlign: 'center',
  },
  modalSave: {
    fontFamily,
    fontSize: 17,
    fontWeight: '600',
    color: BLUE,
  },
  modalStoreBar: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
    zIndex: 60,
    ...Platform.select({ web: { overflow: 'visible' }, default: {} }),
  },
  storeSelect: {
    position: 'relative',
    zIndex: 20,
    minWidth: 168,
    maxWidth: 260,
  },
  storeSelectFill: {
    maxWidth: '100%',
    width: '100%',
  },
  storeSelectOpen: {
    zIndex: 100,
    ...Platform.select({
      web: {},
      default: { elevation: 12 },
    }),
  },
  storeSelectCaption: {
    fontFamily,
    fontSize: 11,
    color: SECONDARY,
    letterSpacing: -0.08,
    marginBottom: 4,
  },
  storeSelectBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 32,
    paddingHorizontal: 10,
    borderRadius: NAV_TAB_ACTIVE_RADIUS,
    borderWidth: 1,
    borderColor: TAB_BORDER,
    backgroundColor: CANVAS,
    ...CHIP_SHADOW,
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  storeSelectBtnCompact: {
    minWidth: 132,
  },
  storeSelectBtnFill: {
    width: '100%',
  },
  storeSelectBtnOpen: {
    backgroundColor: 'rgba(60, 60, 67, 0.045)',
  },
  storeSelectValue: {
    flex: 1,
    minWidth: 0,
    fontFamily,
    fontSize: 14,
    color: TEXT,
    letterSpacing: -0.15,
  },
  storeSelectDismiss: {
    position: 'absolute',
    top: -2400,
    left: -2400,
    right: -2400,
    bottom: -2400,
    zIndex: 1,
  },
  storeSelectMenu: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    marginTop: 4,
    maxHeight: 280,
    backgroundColor: '#fff',
    borderRadius: NAV_TAB_ACTIVE_RADIUS,
    borderWidth: 1,
    borderColor: TAB_BORDER,
    zIndex: 101,
    ...CHIP_SHADOW,
    ...Platform.select({
      web: { boxShadow: '0 8px 24px rgba(0,0,0,0.12)' },
      default: { elevation: 8 },
    }),
  },
  storeSelectOption: {
    paddingHorizontal: 10,
    paddingVertical: 9,
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  storeSelectOptionActive: {
    backgroundColor: 'rgba(60, 60, 67, 0.06)',
  },
  storeSelectOptionHover: {
    backgroundColor: 'rgba(60, 60, 67, 0.045)',
  },
  storeSelectOptionText: {
    fontFamily,
    fontSize: 14,
    color: TEXT,
    letterSpacing: -0.15,
  },
  storeSelectOptionTextActive: {
    fontWeight: '600',
  },
  modalScroll: {
    flexGrow: 0,
    zIndex: 1,
  },
  modalScrollContent: {
    padding: 16,
    gap: 16,
    paddingBottom: 28,
  },
  appleGroup: {
    backgroundColor: '#fff',
    borderRadius: 14,
    overflow: 'hidden',
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    minHeight: 44,
    paddingVertical: 11,
    paddingHorizontal: 16,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HAIRLINE,
  },
  detailRowLast: {
    borderBottomWidth: 0,
  },
  detailLabel: {
    fontFamily,
    width: 108,
    flexShrink: 0,
    fontSize: 15,
    color: SECONDARY,
    letterSpacing: -0.2,
    paddingTop: 2,
  },
  detailValueWrap: {
    flex: 1,
    minWidth: 0,
    alignItems: 'flex-end',
  },
  detailInput: {
    width: '100%',
    fontFamily,
    fontSize: 15,
    color: TEXT,
    letterSpacing: -0.2,
    textAlign: 'right',
    paddingVertical: 0,
    ...Platform.select({ web: { outlineStyle: 'none' }, default: {} }),
  },
  detailDateValue: {
    fontFamily,
    fontSize: 15,
    color: TEXT,
    letterSpacing: -0.2,
    textAlign: 'right',
  },
  datePlaceholder: {
    color: SECONDARY,
  },
  dateFieldCell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minWidth: 0,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  dateChipPlain: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 6,
    minHeight: 44,
    width: '100%',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  dateModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.28)',
    justifyContent: 'flex-end',
  },
  dateModalCard: {
    backgroundColor: CANVAS,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingBottom: 24,
  },
  dateModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 4,
  },
  dateModalTitle: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: TEXT,
  },
  dateModalDone: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: BLUE,
  },
  modalError: {
    fontFamily,
    fontSize: 13,
    color: '#B91C1C',
    textAlign: 'center',
  },
  deleteButton: {
    marginTop: 20,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: NAV_TAB_ACTIVE_RADIUS,
    backgroundColor: '#FEE2E2',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  deleteButtonPressed: {
    opacity: 0.85,
  },
  deleteButtonText: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: '#B91C1C',
    letterSpacing: -0.2,
  },
});
