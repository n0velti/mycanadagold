import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { Ionicons } from '@expo/vector-icons';
import { fetchTransferStores, uniquePreferredStores } from '../lib/locations';
import { CANVAS, MOBILE, NAV_TAB_ACTIVE_RADIUS, useIsMobile } from '../lib/mobileUi';
import { canonicalStoreName, HOME_PINNED_STORES, storesMatch } from '../lib/storeCatalog';
import { FONT_LIGHT } from '../lib/typography';
import { formatDateParam, formatPickerDate } from '../lib/transactions';
import {
  createSupply,
  createSupplySection,
  cycleOrderMore,
  deleteSupply,
  ensureStoreSupplies,
  groupSupplies,
  listSupplyAudits,
  listSupplySections,
  saveSupplyAudit,
  SUPPLY_CATEGORIES,
  SUPPLY_ORDER_MORE,
  supplyOrderMeta,
  updateSupply,
} from '../lib/supplies';

const PAGE = CANVAS;
const GROUP = '#FFFFFF';
const LABEL = MOBILE.label;
const SECONDARY = MOBILE.secondary;
const TAB_BORDER = '#d0d0d0';
const HAIRLINE = 'rgba(42,38,30,0.10)';
const FILL = 'rgba(118, 118, 128, 0.12)';
const PRESS = 'rgba(60, 60, 67, 0.045)';
const BLUE = '#007AFF';
const RED = '#FF3B30';
const fontFamily = 'Sohne';
const titleFontFamily = FONT_LIGHT;
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

const EMPTY_FORM = {
  name: '',
  category: 'office',
  inUse: '',
  unopened: '',
  orderMore: 'no',
  notes: '',
};

function confirmAction(title, message) {
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.confirm) {
    return Promise.resolve(window.confirm(message));
  }
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: 'Save', onPress: () => resolve(true) },
    ]);
  });
}

function confirmDeleteSupply(name) {
  const message = `Remove ${name || 'this supply'} from this store?`;
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

function StoreSelect({ value, options, onChange, fill = false, icon = 'storefront-outline', accessibilityLabel = 'Store' }) {
  const [open, setOpen] = useState(false);
  const selected = options.find((item) => item.key === value) || options[0];
  return (
    <View style={[styles.storeSelect, fill && styles.storeSelectFill, open && styles.storeSelectOpen]}>
      <Pressable
        onPress={() => setOpen((current) => !current)}
        style={({ hovered, pressed }) => [
          styles.storeSelectBtn,
          fill && styles.storeSelectBtnFill,
          (open || hovered || pressed) && styles.storeSelectBtnOpen,
        ]}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={accessibilityLabel}
      >
        <Ionicons name={icon} size={15} color={SECONDARY} />
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
                  key={item.key}
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
                  {active ? <Ionicons name="checkmark" size={18} color={BLUE} /> : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </>
      ) : null}
    </View>
  );
}

function CellField({ value, onCommit, style, placeholder = '—', accessibilityLabel, compact, readOnly }) {
  const [text, setText] = useState(value);
  useEffect(() => {
    setText(value);
  }, [value]);
  if (readOnly) {
    return (
      <Text
        style={[styles.cellField, compact && styles.cellFieldCompact, style, !value && styles.cellPlaceholder]}
        numberOfLines={2}
      >
        {value || placeholder}
      </Text>
    );
  }
  return (
    <TextInput
      style={[styles.cellField, compact && styles.cellFieldCompact, style]}
      value={text}
      onChangeText={setText}
      onBlur={() => {
        if (text !== value) onCommit(text);
      }}
      onSubmitEditing={() => {
        if (text !== value) onCommit(text);
      }}
      placeholder={placeholder}
      placeholderTextColor={SECONDARY}
      accessibilityLabel={accessibilityLabel}
    />
  );
}

function OrderControl({ value, onChange, compact = false, readOnly = false }) {
  return (
    <View style={[styles.orderControl, compact && styles.orderControlCompact]} pointerEvents={readOnly ? 'none' : 'auto'}>
      {SUPPLY_ORDER_MORE.map((item) => {
        const active = item.key === value;
        return (
          <Pressable
            key={item.key}
            onPress={() => onChange(item.key)}
            style={[
              styles.orderSeg,
              compact && styles.orderSegCompact,
              active && { backgroundColor: item.color },
            ]}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={item.title}
          >
            <Text style={[styles.orderSegText, compact && styles.orderSegTextCompact, active && styles.orderSegTextOn]}>
              {item.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function OrderPill({ value, onPress }) {
  const meta = supplyOrderMeta(value);
  const body = (
    <View style={[styles.orderPill, { backgroundColor: meta.tint }]}>
      <Text style={[styles.orderPillText, { color: meta.color }]}>{meta.label}</Text>
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable
      onPress={onPress}
      style={[styles.orderPill, { backgroundColor: meta.tint }]}
      accessibilityRole="button"
      accessibilityLabel={`Order more: ${meta.title}. Change.`}
    >
      <Text style={[styles.orderPillText, { color: meta.color }]}>{meta.label}</Text>
    </Pressable>
  );
}

function AddModal({
  visible,
  title = 'New Supply',
  draft,
  onChange,
  onSubmit,
  onClose,
  saving,
  error,
  isMobile,
  sections,
  lockCategory = false,
}) {
  const set = (key) => (value) => onChange({ ...draft, [key]: value });
  const choices = (sections || []).filter((item) => item.key !== 'other');
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
            <Text style={styles.modalTitle}>{title}</Text>
            <Pressable
              onPress={onSubmit}
              disabled={saving}
              hitSlop={8}
              style={styles.modalNavSideRight}
              accessibilityLabel="Add"
            >
              {saving ? <ActivityIndicator color={BLUE} size="small" /> : <Text style={styles.modalSave}>Add</Text>}
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.modalScroll} keyboardShouldPersistTaps="handled">
            <View style={styles.appleGroup}>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Item</Text>
                <TextInput
                  style={styles.detailInput}
                  value={draft.name}
                  onChangeText={set('name')}
                  placeholder="Name"
                  placeholderTextColor={SECONDARY}
                  autoCapitalize="sentences"
                  accessibilityLabel="Supply name"
                />
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>In use</Text>
                <TextInput
                  style={styles.detailInput}
                  value={draft.inUse}
                  onChangeText={set('inUse')}
                  placeholder="—"
                  placeholderTextColor={SECONDARY}
                  accessibilityLabel="In use"
                />
              </View>
              <View style={[styles.detailRow, lockCategory && styles.detailRowLast]}>
                <Text style={styles.detailLabel}>Unopened</Text>
                <TextInput
                  style={styles.detailInput}
                  value={draft.unopened}
                  onChangeText={set('unopened')}
                  placeholder="—"
                  placeholderTextColor={SECONDARY}
                  accessibilityLabel="Unopened"
                />
              </View>
              {lockCategory ? null : (
                <View style={[styles.detailRow, styles.detailRowLast]}>
                  <Text style={styles.detailLabel}>Section</Text>
                  <View style={styles.categoryPicker}>
                    {choices.map((item) => {
                      const active = draft.category === item.key;
                      return (
                        <Pressable
                          key={item.key}
                          onPress={() => set('category')(item.key)}
                          style={[styles.categoryChip, active && styles.categoryChipOn]}
                        >
                          <Text style={[styles.categoryChipText, active && styles.categoryChipTextOn]}>
                            {item.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              )}
            </View>
            {error ? <Text style={styles.modalError}>{error}</Text> : null}
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

function AddSectionModal({ visible, value, onChange, onSubmit, onClose, saving, error, isMobile }) {
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
            <Text style={styles.modalTitle}>New Section</Text>
            <Pressable
              onPress={onSubmit}
              disabled={saving}
              hitSlop={8}
              style={styles.modalNavSideRight}
              accessibilityLabel="Add section"
            >
              {saving ? <ActivityIndicator color={BLUE} size="small" /> : <Text style={styles.modalSave}>Add</Text>}
            </Pressable>
          </View>
          <View style={styles.modalScroll}>
            <View style={styles.appleGroup}>
              <View style={[styles.detailRow, styles.detailRowLast]}>
                <Text style={styles.detailLabel}>Name</Text>
                <TextInput
                  style={styles.detailInput}
                  value={value}
                  onChangeText={onChange}
                  placeholder="Shipping extras"
                  placeholderTextColor={SECONDARY}
                  autoCapitalize="words"
                  accessibilityLabel="Section name"
                />
              </View>
            </View>
            {error ? <Text style={styles.modalError}>{error}</Text> : null}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

function Legend() {
  return (
    <View style={styles.legend}>
      <Text style={styles.legendTitle}>Order more</Text>
      {SUPPLY_ORDER_MORE.map((item) => (
        <View key={item.key} style={[styles.legendChip, { backgroundColor: item.tint }]}>
          <View style={[styles.legendDot, { backgroundColor: item.color }]} />
          <Text style={[styles.legendText, { color: item.color }]}>{item.title}</Text>
        </View>
      ))}
    </View>
  );
}

export default function SuppliesScreen({ session, storeFilter = '', embedded = false }) {
  const isMobile = useIsMobile();
  const lockedStore = canonicalStoreName(storeFilter) || String(storeFilter || '').trim();
  const homeStore =
    canonicalStoreName(session?.profile?.locationName) || String(session?.profile?.locationName || '').trim();
  const [storeNames, setStoreNames] = useState(() => [...HOME_PINNED_STORES]);
  const [selectedStore, setSelectedStore] = useState(lockedStore || homeStore || HOME_PINNED_STORES[0]);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modalError, setModalError] = useState('');
  const [adding, setAdding] = useState(false);
  const [addingSection, setAddingSection] = useState(false);
  const [sectionName, setSectionName] = useState('');
  const [lockCategory, setLockCategory] = useState(false);
  const [customSections, setCustomSections] = useState([]);
  const [draft, setDraft] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [audits, setAudits] = useState([]);
  const [viewingAuditId, setViewingAuditId] = useState('');
  const [savingAudit, setSavingAudit] = useState(false);

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

  useEffect(() => {
    if (lockedStore || selectedStore) return;
    setSelectedStore(homeStore || storeNames[0] || HOME_PINNED_STORES[0]);
  }, [homeStore, lockedStore, selectedStore, storeNames]);

  const load = useCallback(async () => {
    if (!session?.token || !selectedStore) {
      setRows([]);
      setAudits([]);
      setCustomSections([]);
      setViewingAuditId('');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    setViewingAuditId('');
    try {
      const [nextRows, nextAudits, nextSections] = await Promise.all([
        ensureStoreSupplies(selectedStore),
        listSupplyAudits(selectedStore),
        listSupplySections(selectedStore),
      ]);
      setRows(nextRows);
      setAudits(nextAudits);
      setCustomSections(nextSections);
    } catch (loadError) {
      setError(loadError?.message || 'Could not load supplies.');
    } finally {
      setLoading(false);
    }
  }, [session?.token, selectedStore]);

  useEffect(() => {
    load();
  }, [load]);

  const viewingAudit = useMemo(
    () => audits.find((item) => item.id === viewingAuditId) || null,
    [audits, viewingAuditId],
  );
  const readOnly = Boolean(viewingAudit);
  const displayRows = viewingAudit ? viewingAudit.items : rows;
  const extraSections = viewingAudit ? [] : customSections;
  const sections = useMemo(
    () => groupSupplies(displayRows, extraSections),
    [displayRows, extraSections],
  );
  const sectionChoices = useMemo(() => {
    const seen = new Set();
    const next = [];
    for (const item of [...SUPPLY_CATEGORIES.filter((s) => s.key !== 'other'), ...customSections, ...sections]) {
      if (!item?.key || seen.has(item.key)) continue;
      seen.add(item.key);
      next.push({ key: item.key, label: item.label || item.key });
    }
    return next;
  }, [customSections, sections]);
  const storeOptions = useMemo(
    () => storeNames.map((name) => ({ key: name, label: name })),
    [storeNames],
  );
  const todayKey = formatDateParam(new Date());
  const todayAudit = audits.find((item) => item.auditDate === todayKey);
  const auditOptions = useMemo(
    () => [
      { key: '', label: 'Current list' },
      ...audits.map((item) => ({
        key: item.id,
        label: item.auditDate === todayKey ? `${item.label} · saved today` : item.label,
      })),
    ],
    [audits, todayKey],
  );

  const replaceRow = (row) => {
    setRows((current) => current.map((item) => (item.id === row.id ? row : item)));
  };

  const patchRow = async (row, patch) => {
    if (readOnly) return;
    setError('');
    try {
      replaceRow(await updateSupply(row.id, patch));
    } catch (saveError) {
      setError(saveError?.message || 'Could not update that supply.');
    }
  };

  const removeRow = async (row) => {
    if (readOnly) return;
    const ok = await confirmDeleteSupply(row.name);
    if (!ok) return;
    setError('');
    try {
      await deleteSupply(row.id);
      setRows((current) => current.filter((item) => item.id !== row.id));
    } catch (deleteError) {
      setError(deleteError?.message || 'Could not delete that supply.');
    }
  };

  const startAdd = (category) => {
    if (readOnly) return;
    const nextCategory = category || 'office';
    setDraft({ ...EMPTY_FORM, category: nextCategory });
    setLockCategory(Boolean(category));
    setModalError('');
    setAdding(true);
  };

  const startAddSection = () => {
    if (readOnly) return;
    setSectionName('');
    setModalError('');
    setAddingSection(true);
  };

  const onCreate = async () => {
    if (!selectedStore) {
      setModalError('Choose a store.');
      return;
    }
    setSaving(true);
    setModalError('');
    try {
      const inSection = rows.filter((item) => item.category === draft.category);
      const sortOrder = inSection.reduce((max, item) => Math.max(max, Number(item.sortOrder) || 0), 0) + 10;
      const row = await createSupply({ ...draft, storeName: selectedStore, sortOrder });
      setRows((current) => [...current, row]);
      setAdding(false);
      setLockCategory(false);
      setDraft({ ...EMPTY_FORM });
    } catch (saveError) {
      setModalError(saveError?.message || 'Could not add that supply.');
    } finally {
      setSaving(false);
    }
  };

  const onCreateSection = async () => {
    if (!selectedStore) {
      setModalError('Choose a store.');
      return;
    }
    setSaving(true);
    setModalError('');
    try {
      const section = await createSupplySection(
        selectedStore,
        sectionName,
        customSections.map((item) => item.key),
      );
      setCustomSections((current) => [...current, section]);
      setAddingSection(false);
      setSectionName('');
      setSaving(false);
      startAdd(section.key);
    } catch (saveError) {
      setModalError(saveError?.message || 'Could not add that section.');
      setSaving(false);
    }
  };

  const onSaveAudit = async () => {
    if (!selectedStore || readOnly) return;
    if (todayAudit) {
      const ok = await confirmAction(
        'Replace today’s audit',
        `Replace the saved ${selectedStore} audit for ${formatPickerDate(new Date())}?`,
      );
      if (!ok) return;
    }
    setSavingAudit(true);
    setError('');
    try {
      const saved = await saveSupplyAudit(selectedStore, rows, todayKey);
      setAudits((current) => {
        const next = current.filter((item) => item.id !== saved.id && item.auditDate !== saved.auditDate);
        return [saved, ...next].sort((a, b) => String(b.auditDate).localeCompare(String(a.auditDate)));
      });
    } catch (saveError) {
      setError(saveError?.message || 'Could not save that audit.');
    } finally {
      setSavingAudit(false);
    }
  };

  if (!session?.token) {
    return (
      <View style={[styles.screen, embedded && styles.screenEmbedded]}>
        <Text style={styles.empty}>Sign in to keep a supplies list.</Text>
      </View>
    );
  }

  const storePicker = embedded || lockedStore ? null : (
    <StoreSelect value={selectedStore} options={storeOptions} onChange={setSelectedStore} fill={isMobile} />
  );

  const historyPicker = (
    <StoreSelect
      value={viewingAuditId}
      options={auditOptions}
      onChange={setViewingAuditId}
      fill={isMobile}
      icon="calendar-outline"
      accessibilityLabel="Saved audits"
    />
  );

  const saveChip = readOnly ? (
    <Pressable
      onPress={() => setViewingAuditId('')}
      style={({ hovered, pressed }) => [styles.chip, (hovered || pressed) && styles.chipHover]}
      accessibilityRole="button"
      accessibilityLabel="Back to current list"
    >
      <Text style={styles.chipText}>Current</Text>
    </Pressable>
  ) : (
    <Pressable
      onPress={onSaveAudit}
      disabled={savingAudit || loading}
      style={({ hovered, pressed }) => [styles.chip, (hovered || pressed) && styles.chipHover]}
      accessibilityRole="button"
      accessibilityLabel={todayAudit ? 'Update today’s audit' : 'Save today’s audit'}
    >
      {savingAudit ? (
        <ActivityIndicator color={SECONDARY} size="small" />
      ) : (
        <>
          <Ionicons name="download-outline" size={15} color={SECONDARY} />
          <Text style={styles.chipText}>{todayAudit ? 'Update' : 'Save'} audit</Text>
        </>
      )}
    </Pressable>
  );

  const addChip = readOnly ? null : (
    <View style={styles.headActions}>
      <Pressable
        onPress={startAddSection}
        style={({ hovered, pressed }) => [styles.chip, (hovered || pressed) && styles.chipHover]}
        accessibilityRole="button"
        accessibilityLabel="Add section"
      >
        <Ionicons name="folder-open-outline" size={15} color={SECONDARY} />
        <Text style={styles.chipText}>Add section</Text>
      </Pressable>
      <Pressable
        onPress={() => startAdd()}
        style={({ hovered, pressed }) => [styles.chip, (hovered || pressed) && styles.chipHover]}
        accessibilityRole="button"
        accessibilityLabel="Add supply"
      >
        <Ionicons name="add" size={16} color={LABEL} />
        <Text style={styles.chipText}>Add item</Text>
      </Pressable>
    </View>
  );

  const renderDesktopRow = (row, last, hideUnopened) => (
    <View key={row.id} style={[styles.tableRow, last && styles.tableRowLast]}>
      <Text style={[styles.itemName, styles.colItem]} numberOfLines={2}>
        {row.name}
      </Text>
      <CellField
        value={row.inUse}
        onCommit={(value) => patchRow(row, { inUse: value })}
        style={styles.colQty}
        accessibilityLabel={`${row.name} in use`}
        readOnly={readOnly}
      />
      {hideUnopened ? (
        <View style={styles.colQty} />
      ) : (
        <CellField
          value={row.unopened}
          onCommit={(value) => patchRow(row, { unopened: value })}
          style={styles.colQty}
          accessibilityLabel={`${row.name} unopened`}
          readOnly={readOnly}
        />
      )}
      <View style={styles.colOrder}>
        <OrderControl
          value={row.orderMore}
          onChange={(value) => patchRow(row, { orderMore: value })}
          readOnly={readOnly}
        />
      </View>
      <CellField
        value={row.notes}
        onCommit={(value) => patchRow(row, { notes: value })}
        style={styles.colNotes}
        placeholder="Notes"
        accessibilityLabel={`${row.name} notes`}
        readOnly={readOnly}
      />
      {row.isTemplate || readOnly ? (
        <View style={styles.colDelete} />
      ) : (
        <Pressable
          onPress={() => removeRow(row)}
          style={({ hovered, pressed }) => [styles.colDelete, (hovered || pressed) && styles.colDeleteHover]}
          accessibilityRole="button"
          accessibilityLabel={`Delete ${row.name}`}
        >
          <Ionicons name="trash-outline" size={16} color={SECONDARY} />
        </Pressable>
      )}
    </View>
  );

  const renderMobileRow = (row, last, hideUnopened) => (
    <View key={row.id} style={[styles.mobileRow, last && styles.mobileRowLast]}>
      <View style={styles.mobileTop}>
        <Text style={styles.mobileName}>{row.name}</Text>
        <View style={styles.mobileTopActions}>
          <OrderPill
            value={row.orderMore}
            onPress={readOnly ? undefined : () => patchRow(row, { orderMore: cycleOrderMore(row.orderMore) })}
          />
          {row.isTemplate || readOnly ? null : (
            <Pressable onPress={() => removeRow(row)} hitSlop={8} accessibilityLabel={`Delete ${row.name}`}>
              <Ionicons name="trash-outline" size={18} color={SECONDARY} />
            </Pressable>
          )}
        </View>
      </View>
      <View style={styles.mobileMetrics}>
        <View style={styles.mobileMetric}>
          <Text style={styles.mobileMetricLabel}>{hideUnopened ? 'Count' : 'In use'}</Text>
          <CellField
            value={row.inUse}
            onCommit={(value) => patchRow(row, { inUse: value })}
            compact
            accessibilityLabel={`${row.name} in use`}
            readOnly={readOnly}
          />
        </View>
        {hideUnopened ? null : (
          <View style={styles.mobileMetric}>
            <Text style={styles.mobileMetricLabel}>Unopened</Text>
            <CellField
              value={row.unopened}
              onCommit={(value) => patchRow(row, { unopened: value })}
              compact
              accessibilityLabel={`${row.name} unopened`}
              readOnly={readOnly}
            />
          </View>
        )}
      </View>
      <CellField
        value={row.notes}
        onCommit={(value) => patchRow(row, { notes: value })}
        compact
        placeholder="Status / notes"
        accessibilityLabel={`${row.name} notes`}
        readOnly={readOnly}
      />
    </View>
  );

  return (
    <View style={[styles.screen, embedded && styles.screenEmbedded]}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          isMobile && styles.scrollContentMobile,
          embedded && styles.scrollContentEmbedded,
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {!embedded || isMobile ? (
          <View style={[styles.head, isMobile && styles.headMobile]}>
            <View style={[styles.headRow, isMobile && styles.headRowMobile]}>
              <View style={styles.titleBlock}>
                <Text style={[styles.title, isMobile && styles.titleMobile]}>Supplies</Text>
                <Text style={styles.subtitle}>
                  {[selectedStore, viewingAudit ? viewingAudit.label : 'Current list'].filter(Boolean).join(' · ')}
                </Text>
              </View>
              {addChip}
            </View>
            <View
              style={styles.headRule}
              {...(Platform.OS === 'web' ? { className: 'cgold-home-row-rule' } : null)}
            />
            <View style={[styles.toolbar, isMobile && styles.toolbarMobile]}>
              {storePicker}
              {historyPicker}
              {saveChip}
            </View>
          </View>
        ) : (
          <View style={styles.embeddedBar}>
            {storePicker}
            {historyPicker}
            {saveChip}
            {addChip}
          </View>
        )}

        <View style={[styles.content, isMobile && styles.contentMobile, embedded && !isMobile && styles.contentEmbedded]}>
        {readOnly ? (
          <Text style={styles.auditBanner}>
            Saved audit for {viewingAudit.label}. This copy is read-only.
          </Text>
        ) : todayAudit ? (
          <Text style={styles.auditHint}>Last saved today. Update after you finish the count.</Text>
        ) : null}

        <Legend />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {loading ? (
          <ActivityIndicator color={SECONDARY} style={styles.spinner} />
        ) : (
          sections.map((section) => {
            const hideUnopened = section.key === 'cheques';
            return (
              <View key={section.key} style={styles.section}>
                <View style={styles.sectionHead}>
                  <Text style={styles.sectionHeader}>{section.label}</Text>
                  {readOnly ? null : (
                    <Pressable
                      onPress={() => startAdd(section.key)}
                      style={({ hovered, pressed }) => [styles.sectionAdd, (hovered || pressed) && styles.chipHover]}
                      accessibilityRole="button"
                      accessibilityLabel={`Add item to ${section.label}`}
                    >
                      <Ionicons name="add" size={16} color={LABEL} />
                      <Text style={styles.sectionAddText}>Add item</Text>
                    </Pressable>
                  )}
                </View>
                <View style={styles.group}>
                  {isMobile ? null : (
                    <View style={[styles.tableRow, styles.headerRow]}>
                      <Text style={[styles.headerCell, styles.colItem]}>Item</Text>
                      <Text style={[styles.headerCell, styles.colQty]}>
                        {hideUnopened ? 'Count' : 'In use'}
                      </Text>
                      {hideUnopened ? (
                        <View style={styles.colQty} />
                      ) : (
                        <Text style={[styles.headerCell, styles.colQty]}>Unopened</Text>
                      )}
                      <Text style={[styles.headerCell, styles.colOrder]}>Order more</Text>
                      <Text style={[styles.headerCell, styles.colNotes]}>Status / notes</Text>
                      <View style={styles.colDelete} />
                    </View>
                  )}
                  {section.rows.length === 0 ? (
                    <View style={[styles.tableRow, styles.tableRowLast, isMobile && styles.mobileRow]}>
                      <Text style={styles.empty}>No items in this section yet.</Text>
                    </View>
                  ) : (
                    section.rows.map((row, index) =>
                      isMobile
                        ? renderMobileRow(row, index === section.rows.length - 1, hideUnopened)
                        : renderDesktopRow(row, index === section.rows.length - 1, hideUnopened),
                    )
                  )}
                </View>
                {section.hint ? <Text style={styles.sectionFooter}>{section.hint}</Text> : null}
              </View>
            );
          })
        )}
        </View>
      </ScrollView>
      <AddModal
        visible={adding}
        title={lockCategory ? `New item · ${sectionChoices.find((item) => item.key === draft.category)?.label || 'Section'}` : 'New item'}
        draft={draft}
        onChange={setDraft}
        onSubmit={onCreate}
        onClose={() => {
          setAdding(false);
          setLockCategory(false);
        }}
        saving={saving}
        error={modalError}
        isMobile={isMobile}
        sections={sectionChoices}
        lockCategory={lockCategory}
      />
      <AddSectionModal
        visible={addingSection}
        value={sectionName}
        onChange={setSectionName}
        onSubmit={onCreateSection}
        onClose={() => setAddingSection(false)}
        saving={saving}
        error={modalError}
        isMobile={isMobile}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: PAGE,
  },
  screenEmbedded: {
    backgroundColor: 'transparent',
  },
  scroll: {
    flex: 1,
    minHeight: 0,
  },
  scrollContent: {
    paddingBottom: 48,
  },
  scrollContentMobile: {
    paddingHorizontal: 16,
    paddingBottom: 48,
  },
  scrollContentEmbedded: {
    paddingTop: 4,
  },
  head: {
    marginBottom: 8,
    paddingTop: 20,
    paddingHorizontal: 48,
    zIndex: 40,
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
  headActions: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: 8,
    flexShrink: 0,
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
    color: LABEL,
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
    marginBottom: 12,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 32,
    paddingHorizontal: 10,
    borderRadius: NAV_TAB_ACTIVE_RADIUS,
    borderWidth: 1,
    borderColor: TAB_BORDER,
    backgroundColor: PAGE,
    ...CHIP_SHADOW,
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  chipHover: {
    backgroundColor: '#f0f0f2',
  },
  chipText: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: LABEL,
    letterSpacing: -0.1,
  },
  embeddedBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
    paddingHorizontal: 0,
    zIndex: 40,
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    zIndex: 30,
    paddingBottom: 8,
  },
  toolbarMobile: {
    flexDirection: 'column',
    alignItems: 'stretch',
  },
  content: {
    paddingHorizontal: 48,
    gap: 4,
  },
  contentMobile: {
    paddingHorizontal: 0,
  },
  contentEmbedded: {
    paddingHorizontal: 0,
  },
  auditBanner: {
    fontFamily,
    fontSize: 13,
    color: LABEL,
    marginBottom: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: NAV_TAB_ACTIVE_RADIUS,
    borderWidth: 1,
    borderColor: TAB_BORDER,
    backgroundColor: PAGE,
  },
  auditHint: {
    fontFamily,
    fontSize: 13,
    color: SECONDARY,
    paddingBottom: 8,
  },
  cellPlaceholder: {
    color: SECONDARY,
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    paddingBottom: 8,
  },
  legendTitle: {
    fontFamily,
    fontSize: 11,
    fontWeight: '600',
    color: SECONDARY,
    letterSpacing: 0.2,
    textTransform: 'uppercase',
    marginRight: 4,
  },
  legendChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 28,
    paddingHorizontal: 10,
    borderRadius: 999,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendText: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: -0.1,
  },
  error: {
    fontFamily,
    fontSize: 13,
    color: RED,
    paddingVertical: 4,
    paddingBottom: 8,
  },
  spinner: {
    marginTop: 36,
  },
  empty: {
    fontFamily,
    fontSize: 15,
    color: SECONDARY,
    padding: 16,
  },
  section: {
    marginBottom: 18,
  },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 8,
    marginBottom: 8,
    marginTop: 8,
  },
  sectionHeader: {
    fontFamily,
    flex: 1,
    fontSize: 13,
    fontWeight: '400',
    color: SECONDARY,
    textTransform: 'uppercase',
    letterSpacing: -0.08,
  },
  sectionAdd: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 28,
    paddingHorizontal: 8,
    borderRadius: NAV_TAB_ACTIVE_RADIUS,
    borderWidth: 1,
    borderColor: TAB_BORDER,
    backgroundColor: PAGE,
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  sectionAddText: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: LABEL,
    letterSpacing: -0.1,
  },
  sectionFooter: {
    fontFamily,
    fontSize: 13,
    color: SECONDARY,
    lineHeight: 18,
    paddingHorizontal: 8,
    paddingTop: 8,
  },
  group: {
    backgroundColor: PAGE,
    borderRadius: NAV_TAB_ACTIVE_RADIUS,
    borderWidth: 1,
    borderColor: TAB_BORDER,
    overflow: 'hidden',
    ...CHIP_SHADOW,
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 64,
    paddingLeft: 14,
    paddingRight: 10,
    paddingVertical: 8,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e8e8e8',
  },
  headerRow: {
    minHeight: 36,
    paddingVertical: 6,
    backgroundColor: 'transparent',
  },
  tableRowLast: {
    borderBottomWidth: 0,
  },
  headerCell: {
    fontFamily,
    fontSize: 11,
    fontWeight: '600',
    color: '#9a9a9a',
    letterSpacing: 0.2,
  },
  itemName: {
    fontFamily: titleFontFamily,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '400',
    color: LABEL,
    letterSpacing: -0.2,
  },
  cellField: {
    fontFamily,
    fontSize: 17,
    lineHeight: 22,
    color: LABEL,
    letterSpacing: -0.4,
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: FILL,
    minWidth: 0,
    ...Platform.select({ web: { outlineStyle: 'none' }, default: {} }),
  },
  cellFieldCompact: {
    minHeight: 48,
    paddingVertical: 12,
  },
  colItem: { flex: 1.35, minWidth: 128 },
  colQty: { width: 108, flexShrink: 0 },
  colOrder: { width: 176, flexShrink: 0 },
  colNotes: { flex: 1.7, minWidth: 140 },
  colDelete: {
    width: 32,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  colDeleteHover: {
    opacity: 0.6,
  },
  orderControl: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: FILL,
    borderRadius: 10,
    padding: 3,
    gap: 3,
    minHeight: 44,
  },
  orderControlCompact: {
    alignSelf: 'flex-start',
    minHeight: 40,
  },
  orderSeg: {
    flex: 1,
    minHeight: 38,
    paddingHorizontal: 8,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  orderSegCompact: {
    flex: 0,
    paddingHorizontal: 10,
  },
  orderSegText: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: SECONDARY,
  },
  orderSegTextCompact: {
    fontSize: 13,
  },
  orderSegTextOn: {
    color: '#fff',
  },
  orderPill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 7,
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  orderPillText: {
    fontFamily,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: -0.1,
  },
  mobileRow: {
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e8e8e8',
  },
  mobileRowLast: {
    borderBottomWidth: 0,
  },
  mobileTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  mobileTopActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  mobileName: {
    fontFamily: titleFontFamily,
    flex: 1,
    fontSize: 16,
    lineHeight: 20,
    color: LABEL,
    letterSpacing: -0.2,
  },
  mobileMetrics: {
    flexDirection: 'row',
    gap: 10,
  },
  mobileMetric: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  mobileMetricLabel: {
    fontFamily,
    fontSize: 12,
    color: SECONDARY,
    letterSpacing: -0.08,
  },
  storeSelect: {
    position: 'relative',
    zIndex: 20,
    alignSelf: 'flex-start',
    minWidth: 168,
    maxWidth: 280,
  },
  storeSelectFill: {
    alignSelf: 'stretch',
    maxWidth: '100%',
    width: '100%',
  },
  storeSelectOpen: {
    zIndex: 80,
  },
  storeSelectBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 32,
    paddingHorizontal: 10,
    borderRadius: NAV_TAB_ACTIVE_RADIUS,
    borderWidth: 1,
    borderColor: TAB_BORDER,
    backgroundColor: PAGE,
    ...CHIP_SHADOW,
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  storeSelectBtnFill: {
    width: '100%',
    height: 44,
  },
  storeSelectBtnOpen: {
    backgroundColor: '#f0f0f2',
  },
  storeSelectValue: {
    flex: 1,
    minWidth: 0,
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: LABEL,
    letterSpacing: -0.1,
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
    marginTop: 6,
    maxHeight: 320,
    backgroundColor: GROUP,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: TAB_BORDER,
    zIndex: 90,
    ...Platform.select({
      web: { boxShadow: '0 12px 40px rgba(0,0,0,0.18)' },
      default: { elevation: 8 },
    }),
  },
  storeSelectOption: {
    minHeight: 44,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  storeSelectOptionActive: {
    backgroundColor: 'rgba(0,122,255,0.08)',
  },
  storeSelectOptionHover: {
    backgroundColor: PAGE,
  },
  storeSelectOptionText: {
    fontFamily,
    flex: 1,
    fontSize: 15,
    color: LABEL,
    letterSpacing: -0.2,
  },
  storeSelectOptionTextActive: {
    color: BLUE,
    fontWeight: '600',
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
    overflow: 'hidden',
  },
  modalSheetMobile: {
    maxWidth: '100%',
    maxHeight: '92%',
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  },
  modalNav: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 52,
    paddingHorizontal: 8,
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
    color: LABEL,
    textAlign: 'center',
  },
  modalSave: {
    fontFamily,
    fontSize: 17,
    fontWeight: '600',
    color: BLUE,
  },
  modalScroll: {
    padding: 16,
    gap: 16,
    paddingBottom: 28,
  },
  appleGroup: {
    backgroundColor: GROUP,
    borderRadius: 10,
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
    width: 72,
    flexShrink: 0,
    fontSize: 17,
    color: LABEL,
    letterSpacing: -0.4,
    paddingTop: 2,
  },
  detailInput: {
    flex: 1,
    fontFamily,
    fontSize: 17,
    color: LABEL,
    letterSpacing: -0.4,
    textAlign: 'right',
    paddingVertical: 0,
    ...Platform.select({ web: { outlineStyle: 'none' }, default: {} }),
  },
  categoryPicker: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: 6,
  },
  categoryChip: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: PAGE,
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  categoryChipOn: {
    backgroundColor: BLUE,
  },
  categoryChipText: {
    fontFamily,
    fontSize: 13,
    color: LABEL,
  },
  categoryChipTextOn: {
    color: '#fff',
    fontWeight: '600',
  },
  modalError: {
    fontFamily,
    fontSize: 13,
    color: RED,
    textAlign: 'center',
  },
});
