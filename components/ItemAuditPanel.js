import { createElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { useAppAccess } from '../lib/permissions';
import {
  filterItemCatalog,
  formatItemAuditRangeLabel,
  formatQty,
  gatherItemAudit,
  loadItemAuditStores,
  loadItemCatalog,
} from '../lib/itemAudit';
import {
  defaultDateRange,
  formatDateParam,
  formatPickerDate,
  parseDateParam,
} from '../lib/transactions';
import { AuditTxnDrawer, useAuditTxnDrawer } from './AuditAiOutput';

const fontFamily = Platform.select({
  ios: 'Sohne',
  android: 'Sohne',
  default: 'Sohne',
});

const ACCENT = '#2F8A4E';
const TEXT = '#1d1d1f';
const SECONDARY = '#8e8e93';
const FILL = '#e8e8ed';
const GROUP_BG = '#f2f2f7';
const HAIRLINE = '#e5e5ea';
const MOBILE_BREAKPOINT = 768;
const AMBER = '#B45309';
const BLUE = '#1D4ED8';
const RED = '#B91C1C';

function useIsMobile() {
  const { width } = useWindowDimensions();
  return width < MOBILE_BREAKPOINT;
}

function namesMatch(a, b) {
  return (
    String(a || '')
      .trim()
      .localeCompare(String(b || '').trim(), undefined, { sensitivity: 'base' }) === 0
  );
}

function findStore(stores, name) {
  if (!name || !stores?.length) return null;
  return stores.find((store) => namesMatch(store.name, name)) || null;
}

function signedQty(value) {
  const n = Number(value) || 0;
  if (Math.abs(n) < 0.0005) return formatQty(0);
  return `${n > 0 ? '+' : ''}${formatQty(n)}`;
}

function eventTint(kind) {
  if (kind === 'sale' || kind === 'transfer_out' || kind === 'pending_out') return RED;
  if (kind === 'purchase' || kind === 'transfer_in') return ACCENT;
  if (kind === 'pending_in') return AMBER;
  return SECONDARY;
}

function eventQtyColor(event) {
  if (event.kind === 'count') return TEXT;
  const qty = Number(event.qty) || 0;
  if (qty > 0) return ACCENT;
  if (qty < 0) return RED;
  return TEXT;
}

function DateChip({ label, value, onChange, maximumDate, minimumDate }) {
  const [open, setOpen] = useState(false);
  const dateValue = parseDateParam(value);

  const commit = (next) => {
    if (!next) return;
    let date = parseDateParam(next);
    if (maximumDate && date > parseDateParam(maximumDate)) date = parseDateParam(maximumDate);
    if (minimumDate && date < parseDateParam(minimumDate)) date = parseDateParam(minimumDate);
    onChange(date);
  };

  const field = (
    <>
      <Ionicons name="calendar-outline" size={16} color={SECONDARY} />
      {Platform.OS === 'web'
        ? createElement('input', {
            type: 'date',
            value: formatDateParam(dateValue),
            max: maximumDate ? formatDateParam(maximumDate) : undefined,
            min: minimumDate ? formatDateParam(minimumDate) : undefined,
            onChange: (event) => {
              if (event.target.value) commit(event.target.value);
            },
            style: {
              border: 'none',
              background: 'transparent',
              fontFamily,
              fontSize: 16,
              color: TEXT,
              padding: 0,
              margin: 0,
              outline: 'none',
              cursor: 'pointer',
              minWidth: 118,
              letterSpacing: -0.2,
            },
          })
        : <Text style={styles.dateValue}>{formatPickerDate(dateValue)}</Text>}
    </>
  );

  if (Platform.OS === 'web') {
    return <View style={styles.dateField}>{field}</View>;
  }

  return (
    <>
      <Pressable style={styles.dateField} onPress={() => setOpen(true)}>
        {field}
      </Pressable>
      {Platform.OS === 'android' && open ? (
        <DateTimePicker
          value={dateValue}
          mode="date"
          display="default"
          maximumDate={maximumDate ? parseDateParam(maximumDate) : undefined}
          minimumDate={minimumDate ? parseDateParam(minimumDate) : undefined}
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
                <Text style={styles.dateModalTitle}>{label || 'Date'}</Text>
                <Pressable onPress={() => setOpen(false)} hitSlop={8}>
                  <Text style={styles.doneText}>Done</Text>
                </Pressable>
              </View>
              <DateTimePicker
                value={dateValue}
                mode="date"
                display="spinner"
                maximumDate={maximumDate ? parseDateParam(maximumDate) : undefined}
                minimumDate={minimumDate ? parseDateParam(minimumDate) : undefined}
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

function PickerChip({ label, value, onPress, disabled = false, style }) {
  return (
    <Pressable
      style={[styles.chip, disabled && styles.chipDisabled, style]}
      onPress={onPress}
      disabled={disabled}
    >
      <View style={styles.chipCopy}>
        {label ? <Text style={styles.chipLabel}>{label}</Text> : null}
        <Text style={styles.chipValue} numberOfLines={1}>
          {value}
        </Text>
      </View>
      <Ionicons name="chevron-down" size={14} color={SECONDARY} />
    </Pressable>
  );
}

function StoreLocationCard({ location, expanded, onToggle, onOpenRef }) {
  const off = Math.abs(location.countDiff) >= 0.0005;
  return (
    <View style={styles.group}>
      <Pressable style={styles.storeHeader} onPress={onToggle}>
        <View style={styles.storeHeaderCopy}>
          <Text style={styles.storeTitle}>{location.name}</Text>
          <Text style={styles.storeSubtitle} numberOfLines={1}>
            {location.events.length
              ? `${location.events.length} movement${location.events.length === 1 ? '' : 's'}`
              : 'No tickets in range'}
            {location.lastCount ? ` · counted ${formatPickerDate(location.lastCount.date)}` : ''}
          </Text>
        </View>
        <Text
          style={[
            styles.storeOff,
            off ? (location.countDiff < 0 ? styles.short : styles.over) : styles.balanced,
          ]}
        >
          {off ? signedQty(location.countDiff) : 'OK'}
        </Text>
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color={SECONDARY} />
      </Pressable>

      <View style={styles.statGrid}>
        <View style={styles.statCell}>
          <Text style={styles.statCaption}>System now</Text>
          <Text style={styles.statFigure}>{formatQty(location.systemNow)}</Text>
        </View>
        <View style={styles.statCell}>
          <Text style={styles.statCaption}>Last count</Text>
          <Text style={styles.statFigure}>
            {location.physicalNow != null
              ? formatQty(location.physicalNow)
              : location.countedNow != null
                ? formatQty(location.countedNow)
                : '—'}
          </Text>
        </View>
        <View style={styles.statCell}>
          <Text style={styles.statCaption}>Expected</Text>
          <Text style={styles.statFigure}>{formatQty(location.expectedNow)}</Text>
        </View>
        <View style={styles.statCell}>
          <Text style={styles.statCaption}>Opening</Text>
          <Text style={styles.statFigure}>{formatQty(location.openingSystem)}</Text>
        </View>
      </View>

      <View style={styles.moveRow}>
        <Text style={styles.moveChip}>Sold {formatQty(location.soldQty)}</Text>
        <Text style={styles.moveChip}>Bought {formatQty(location.boughtQty)}</Text>
        <Text style={styles.moveChip}>In {formatQty(location.receivedIn)}</Text>
        <Text style={styles.moveChip}>Out {formatQty(location.sentOut)}</Text>
        {location.pendingIn > 0 ? (
          <Text style={[styles.moveChip, styles.moveWarn]}>Transit in {formatQty(location.pendingIn)}</Text>
        ) : null}
        {location.pendingOut > 0 ? (
          <Text style={[styles.moveChip, styles.moveWarn]}>Transit out {formatQty(location.pendingOut)}</Text>
        ) : null}
      </View>

      {location.reasons.map((reason, index) => (
        <View key={`${location.id}-reason-${index}`} style={styles.reasonRow}>
          <Ionicons
            name={location.off ? 'alert-circle-outline' : 'checkmark-circle-outline'}
            size={16}
            color={location.off ? AMBER : ACCENT}
            style={styles.reasonIcon}
          />
          <Text style={styles.reasonText}>{reason}</Text>
        </View>
      ))}

      {expanded
        ? location.events.map((event, index) => (
            <Pressable
              key={event.id}
              style={[styles.eventRow, index === location.events.length - 1 && styles.eventRowLast]}
              onPress={() => {
                if (event.reference && /^(SO|PO|TR)#/i.test(event.reference)) onOpenRef?.(event.reference);
              }}
              disabled={!event.reference}
            >
              <View style={styles.eventCopy}>
                <Text style={styles.eventTitle} numberOfLines={1}>
                  {event.title}
                  {event.reference ? ` · ${event.reference}` : ''}
                </Text>
                <Text style={styles.eventMeta} numberOfLines={2}>
                  {[
                    formatPickerDate(event.date),
                    event.timeLabel,
                    event.from && event.to ? `${event.from} → ${event.to}` : '',
                    event.customerName,
                    event.undeliveredQty > 0 ? `${formatQty(event.undeliveredQty)} undelivered` : '',
                    event.shortfall > 0 ? `short ${formatQty(event.shortfall)}` : '',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
              </View>
              <Text style={[styles.eventQty, { color: eventQtyColor(event) }]}>
                {event.kind === 'count' ? formatQty(event.qty) : signedQty(event.qty)}
              </Text>
            </Pressable>
          ))
        : null}
    </View>
  );
}

export default function ItemAuditPanel({
  session,
  onRequireLogin,
  storeFilter,
  initialDate,
  embedded = false,
}) {
  const { canFilter } = useAppAccess();
  const allowFilters = canFilter('audit');
  const isMobile = useIsMobile();
  const lockedStore = Boolean(storeFilter) || !allowFilters;
  const today = formatDateParam(new Date());
  const initialRange = defaultDateRange(7);
  const seedEnd = formatDateParam(initialDate || initialRange.endDate);

  const [catalog, setCatalog] = useState([]);
  const [catalogWarning, setCatalogWarning] = useState('');
  const [stores, setStores] = useState([]);
  const [itemQuery, setItemQuery] = useState('');
  const [itemPickerOpen, setItemPickerOpen] = useState(false);
  const [storePickerOpen, setStorePickerOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);
  const [selectedStoreNames, setSelectedStoreNames] = useState(() =>
    storeFilter ? [storeFilter] : [],
  );
  const [startDate, setStartDate] = useState(() => parseDateParam(initialRange.startDate));
  const [endDate, setEndDate] = useState(() => parseDateParam(seedEnd));
  const [result, setResult] = useState(null);
  const [expanded, setExpanded] = useState({});
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const requestId = useRef(0);
  const storesRequestId = useRef(0);

  const startKey = formatDateParam(startDate);
  const endKey = formatDateParam(endDate);
  const selectedStores = useMemo(
    () =>
      selectedStoreNames
        .map((name) => findStore(stores, name))
        .filter(Boolean),
    [selectedStoreNames, stores],
  );

  const txnDrawer = useAuditTxnDrawer(session, {
    token: selectedStores[0]?.token || session?.token,
    baseUrl: selectedStores[0]?.baseUrl || session?.baseUrl,
  });
  const setTxnLookup = txnDrawer.setLookup;

  const filteredCatalog = useMemo(
    () => filterItemCatalog(catalog, itemQuery),
    [catalog, itemQuery],
  );

  useEffect(() => {
    if (storeFilter) setSelectedStoreNames([storeFilter]);
  }, [storeFilter]);

  useEffect(() => {
    if (initialDate) {
      const end = parseDateParam(initialDate);
      const start = parseDateParam(initialDate);
      start.setDate(end.getDate() - 6);
      setEndDate(end);
      setStartDate(start);
    }
  }, [initialDate]);

  useEffect(() => {
    if (!session?.token) {
      setStores([]);
      setCatalog([]);
      return;
    }
    const id = ++storesRequestId.current;
    Promise.all([loadItemAuditStores(session), loadItemCatalog(session)])
      .then(([nextStores, nextCatalog]) => {
        if (id !== storesRequestId.current) return;
        setStores(nextStores);
        setCatalog(nextCatalog.items);
        setCatalogWarning(nextCatalog.warning || '');
        setSelectedStoreNames((prev) => {
          if (storeFilter) {
            return findStore(nextStores, storeFilter) ? [storeFilter] : prev;
          }
          if (prev.length) {
            const kept = prev.filter((name) => findStore(nextStores, name));
            if (kept.length) return kept;
          }
          return nextStores[0]?.name ? [nextStores[0].name] : [];
        });
      })
      .catch((err) => {
        if (id !== storesRequestId.current) return;
        setError(err?.message || 'Failed to load items and stores.');
      });
  }, [session, storeFilter]);

  const load = useCallback(async () => {
    if (!session?.token || !selectedItem || !selectedStores.length) {
      setResult(null);
      return;
    }
    const id = ++requestId.current;
    setLoading(true);
    setError('');
    setProgress('Starting…');
    try {
      const next = await gatherItemAudit(session, {
        item: selectedItem,
        stores: selectedStores,
        startDate: startKey,
        endDate: endKey,
        onProgress: setProgress,
      });
      if (id !== requestId.current) return;
      setResult(next);
      setExpanded(
        Object.fromEntries(next.locations.map((location) => [location.id, next.locations.length === 1 || location.off])),
      );
      setTxnLookup(
        next.timeline
          .filter((event) => event.sourceId && (event.type === 'order' || event.type === 'purchase'))
          .map((event) => ({
            type: event.type,
            sourceId: event.sourceId,
            reference: event.reference,
            storeName: event.storeName,
            customerName: event.customerName,
            employeeName: event.employeeName,
            amountLabel: event.amountLabel,
            systemKey: event.systemKey,
          })),
      );
    } catch (err) {
      if (id !== requestId.current) return;
      setResult(null);
      setError(err?.message || 'Failed to audit this item.');
    } finally {
      if (id === requestId.current) {
        setLoading(false);
        setProgress('');
      }
    }
  }, [session, selectedItem, selectedStores, startKey, endKey, setTxnLookup]);

  useEffect(() => {
    load();
  }, [load]);

  const toggleStore = (name) => {
    if (lockedStore) return;
    setSelectedStoreNames((prev) => {
      if (prev.includes(name)) {
        if (prev.length === 1) return prev;
        return prev.filter((entry) => entry !== name);
      }
      return [...prev, name];
    });
  };

  const storeChipLabel = lockedStore
    ? storeFilter || selectedStoreNames[0] || 'Store'
    : selectedStoreNames.length === stores.length && stores.length
      ? 'All stores'
      : selectedStoreNames.length === 1
        ? selectedStoreNames[0]
        : `${selectedStoreNames.length} stores`;

  if (!session?.token) {
    return (
      <View style={styles.body}>
        <Text style={styles.hint}>
          Sign in to audit by item.{' '}
          {onRequireLogin ? (
            <Text style={styles.link} onPress={onRequireLogin}>
              Go to Profile
            </Text>
          ) : null}
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.body, embedded && styles.bodyEmbedded, isMobile && styles.bodyMobile]}>
      <View style={[styles.toolbar, isMobile && styles.toolbarMobile]}>
        <PickerChip
          label="Item"
          value={selectedItem?.name || 'Select item'}
          onPress={() => setItemPickerOpen(true)}
          style={isMobile ? styles.chipGrow : styles.itemChip}
        />
        <PickerChip
          label="Stores"
          value={storeChipLabel}
          onPress={() => setStorePickerOpen(true)}
          disabled={lockedStore}
        />
        <DateChip
          label="From"
          value={startDate}
          onChange={setStartDate}
          maximumDate={endKey}
        />
        <DateChip
          label="To"
          value={endDate}
          onChange={setEndDate}
          maximumDate={today}
          minimumDate={startKey}
        />
      </View>

      <View style={styles.metaRow}>
        <Text style={styles.metaText} numberOfLines={2}>
          {loading
            ? progress || 'Loading…'
            : selectedItem
              ? `${selectedItem.name} · ${formatItemAuditRangeLabel(startKey, endKey)}`
              : 'Pick an item to trace counts, transfers, and tickets.'}
        </Text>
        {loading ? <ActivityIndicator size="small" color={SECONDARY} /> : null}
      </View>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      {result?.warning || catalogWarning ? (
        <Text style={styles.warningText}>{[result?.warning, catalogWarning].filter(Boolean).join(' ')}</Text>
      ) : null}

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {!selectedItem ? (
          <Text style={styles.emptyText}>Select a bullion item to see why a store is off.</Text>
        ) : loading && !result ? (
          <View style={styles.centered}>
            <ActivityIndicator color={TEXT} />
          </View>
        ) : result ? (
          <View style={styles.sections}>
            {result.locations.map((location) => (
              <StoreLocationCard
                key={location.id}
                location={location}
                expanded={Boolean(expanded[location.id])}
                onToggle={() =>
                  setExpanded((prev) => ({ ...prev, [location.id]: !prev[location.id] }))
                }
                onOpenRef={txnDrawer.openReference}
              />
            ))}

            {result.timeline.length ? (
              <View style={styles.groupSection}>
                <Text style={styles.groupSectionTitle}>All movement</Text>
                <View style={styles.group}>
                  {result.timeline.map((event, index) => (
                    <Pressable
                      key={event.id}
                      style={[
                        styles.eventRow,
                        index === result.timeline.length - 1 && styles.eventRowLast,
                      ]}
                      onPress={() => {
                        if (event.reference && /^(SO|PO)#/i.test(event.reference)) {
                          txnDrawer.openReference(event.reference);
                        }
                      }}
                      disabled={!event.reference || !/^(SO|PO)#/i.test(event.reference)}
                    >
                      <View style={[styles.kindDot, { backgroundColor: eventTint(event.kind) }]} />
                      <View style={styles.eventCopy}>
                        <Text style={styles.eventTitle} numberOfLines={1}>
                          {event.storeName} · {event.title}
                          {event.reference ? ` · ${event.reference}` : ''}
                        </Text>
                        <Text style={styles.eventMeta} numberOfLines={1}>
                          {[formatPickerDate(event.date), event.from && event.to ? `${event.from} → ${event.to}` : '', event.customerName]
                            .filter(Boolean)
                            .join(' · ')}
                        </Text>
                      </View>
                      <Text style={[styles.eventQty, { color: eventQtyColor(event) }]}>
                        {event.kind === 'count' ? formatQty(event.qty) : signedQty(event.qty)}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : (
              <Text style={styles.emptyText}>No counts, transfers, or tickets for this item in the range.</Text>
            )}
          </View>
        ) : null}
      </ScrollView>

      <Modal
        visible={itemPickerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setItemPickerOpen(false)}
      >
        <View style={styles.modalRoot}>
          <Pressable style={styles.modalBackdrop} onPress={() => setItemPickerOpen(false)} />
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select item</Text>
              <Pressable onPress={() => setItemPickerOpen(false)} hitSlop={8}>
                <Text style={styles.doneText}>Done</Text>
              </Pressable>
            </View>
            <View style={styles.searchField}>
              <Ionicons name="search" size={16} color={SECONDARY} />
              <TextInput
                style={styles.searchInput}
                value={itemQuery}
                onChangeText={setItemQuery}
                placeholder="GML 1oz DNA, SBAR 100oz…"
                placeholderTextColor={SECONDARY}
                autoFocus
              />
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" style={styles.modalList}>
              {filteredCatalog.slice(0, 80).map((item) => {
                const active = selectedItem?.key === item.key;
                return (
                  <Pressable
                    key={item.key}
                    style={[styles.modalOption, active && styles.modalOptionActive]}
                    onPress={() => {
                      setSelectedItem(item);
                      setItemPickerOpen(false);
                    }}
                  >
                    <View style={styles.modalOptionCopy}>
                      <Text style={styles.modalOptionTitle} numberOfLines={1}>
                        {item.name}
                      </Text>
                      <Text style={styles.modalOptionMeta} numberOfLines={1}>
                        {[item.metal, item.sku].filter(Boolean).join(' · ')}
                      </Text>
                    </View>
                    {active ? <Ionicons name="checkmark" size={16} color={ACCENT} /> : null}
                  </Pressable>
                );
              })}
              {!filteredCatalog.length ? (
                <Text style={styles.emptyText}>No items match that search.</Text>
              ) : null}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal
        visible={storePickerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setStorePickerOpen(false)}
      >
        <View style={styles.modalRoot}>
          <Pressable style={styles.modalBackdrop} onPress={() => setStorePickerOpen(false)} />
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Stores</Text>
              <Pressable onPress={() => setStorePickerOpen(false)} hitSlop={8}>
                <Text style={styles.doneText}>Done</Text>
              </Pressable>
            </View>
            {!lockedStore ? (
              <View style={styles.modalActions}>
                <Pressable
                  onPress={() => setSelectedStoreNames(stores.map((store) => store.name))}
                  hitSlop={8}
                >
                  <Text style={styles.doneText}>All</Text>
                </Pressable>
              </View>
            ) : null}
            <ScrollView keyboardShouldPersistTaps="handled" style={styles.modalList}>
              {stores.map((store) => {
                const active = selectedStoreNames.some((name) => namesMatch(name, store.name));
                return (
                  <Pressable
                    key={store.id}
                    style={[styles.modalOption, active && styles.modalOptionActive]}
                    onPress={() => toggleStore(store.name)}
                    disabled={lockedStore}
                  >
                    <Text style={styles.modalOptionTitle}>{store.name}</Text>
                    {active ? <Ionicons name="checkmark" size={16} color={ACCENT} /> : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <AuditTxnDrawer
        visible={txnDrawer.visible}
        summary={txnDrawer.summary}
        detail={txnDrawer.detail}
        loading={txnDrawer.loading}
        error={txnDrawer.error}
        onClose={txnDrawer.close}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    minHeight: 0,
  },
  bodyEmbedded: {
    width: '100%',
    maxWidth: '100%',
  },
  bodyMobile: {
    width: '100%',
    maxWidth: '100%',
    overflow: 'hidden',
  },
  toolbar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    marginTop: 2,
    marginBottom: 8,
    width: '100%',
  },
  toolbarMobile: {
    marginTop: 0,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: FILL,
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 42,
    minWidth: 120,
    maxWidth: 220,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  itemChip: {
    minWidth: 180,
    maxWidth: 280,
  },
  chipGrow: {
    flexGrow: 1,
    maxWidth: '100%',
    minWidth: 0,
  },
  chipDisabled: {
    opacity: 0.7,
  },
  chipCopy: {
    flex: 1,
    minWidth: 0,
  },
  chipLabel: {
    fontFamily,
    fontSize: 11,
    color: SECONDARY,
    letterSpacing: -0.08,
  },
  chipValue: {
    fontFamily,
    fontSize: 15,
    fontWeight: '500',
    color: TEXT,
    letterSpacing: -0.2,
  },
  dateField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: FILL,
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 42,
    justifyContent: 'center',
    flexShrink: 0,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  dateValue: {
    fontFamily,
    fontSize: 16,
    color: TEXT,
    letterSpacing: -0.2,
  },
  dateModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.28)',
    justifyContent: 'flex-end',
  },
  dateModalCard: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingBottom: 16,
  },
  dateModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 8,
  },
  dateModalTitle: {
    fontFamily,
    fontSize: 17,
    fontWeight: '600',
    color: TEXT,
  },
  doneText: {
    fontFamily,
    fontSize: 16,
    fontWeight: '600',
    color: ACCENT,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
    minHeight: 20,
  },
  metaText: {
    fontFamily,
    flex: 1,
    fontSize: 13,
    color: SECONDARY,
    letterSpacing: -0.08,
  },
  errorText: {
    fontFamily,
    fontSize: 13,
    color: RED,
    marginBottom: 8,
    letterSpacing: -0.08,
  },
  warningText: {
    fontFamily,
    fontSize: 12,
    color: AMBER,
    marginBottom: 8,
  },
  hint: {
    fontFamily,
    fontSize: 14,
    color: '#6b6b6b',
  },
  link: {
    color: ACCENT,
    fontWeight: '600',
  },
  scroll: {
    flex: 1,
    minHeight: 0,
  },
  scrollContent: {
    paddingBottom: 28,
    gap: 14,
  },
  sections: {
    gap: 14,
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 32,
  },
  emptyText: {
    fontFamily,
    fontSize: 15,
    color: SECONDARY,
    paddingTop: 36,
    textAlign: 'center',
    letterSpacing: -0.08,
  },
  groupSection: {
    width: '100%',
    gap: 8,
  },
  groupSectionTitle: {
    fontFamily,
    fontSize: 13,
    color: SECONDARY,
    letterSpacing: -0.08,
    paddingHorizontal: 16,
  },
  group: {
    backgroundColor: GROUP_BG,
    borderRadius: 14,
    overflow: 'hidden',
  },
  storeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
    paddingLeft: 16,
    paddingRight: 14,
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HAIRLINE,
  },
  storeHeaderCopy: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  storeTitle: {
    fontFamily,
    fontSize: 17,
    color: TEXT,
    letterSpacing: -0.2,
  },
  storeSubtitle: {
    fontFamily,
    fontSize: 13,
    color: SECONDARY,
    letterSpacing: -0.08,
  },
  storeOff: {
    fontFamily,
    fontSize: 17,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.2,
  },
  short: { color: RED },
  over: { color: BLUE },
  balanced: { color: ACCENT, fontWeight: '500' },
  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 8,
    paddingTop: 8,
  },
  statCell: {
    width: '25%',
    minWidth: 72,
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  statCaption: {
    fontFamily,
    fontSize: 11,
    color: SECONDARY,
    letterSpacing: 0.2,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  statFigure: {
    fontFamily,
    fontSize: 18,
    fontWeight: '600',
    color: TEXT,
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.2,
  },
  moveRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  moveChip: {
    fontFamily,
    fontSize: 12,
    color: SECONDARY,
    backgroundColor: '#fff',
    overflow: 'hidden',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  moveWarn: {
    color: AMBER,
  },
  reasonRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  reasonIcon: {
    marginTop: 1,
  },
  reasonText: {
    fontFamily,
    flex: 1,
    fontSize: 14,
    color: TEXT,
    letterSpacing: -0.08,
    lineHeight: 20,
  },
  eventRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 48,
    paddingLeft: 16,
    paddingRight: 14,
    gap: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: HAIRLINE,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  eventRowLast: {},
  kindDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    flexShrink: 0,
  },
  eventCopy: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  eventTitle: {
    fontFamily,
    fontSize: 15,
    color: TEXT,
    letterSpacing: -0.2,
  },
  eventMeta: {
    fontFamily,
    fontSize: 12,
    color: SECONDARY,
    letterSpacing: -0.08,
  },
  eventQty: {
    fontFamily,
    fontSize: 16,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.2,
    flexShrink: 0,
  },
  modalRoot: {
    flex: 1,
    justifyContent: 'center',
    padding: 20,
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.28)',
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
    color: TEXT,
  },
  modalActions: {
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  searchField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 8,
    backgroundColor: FILL,
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 40,
  },
  searchInput: {
    flex: 1,
    fontFamily,
    fontSize: 16,
    color: TEXT,
    paddingVertical: 0,
    ...Platform.select({
      web: { outlineStyle: 'none' },
      default: {},
    }),
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
  },
  modalOptionActive: {
    backgroundColor: '#F3F8F4',
  },
  modalOptionCopy: {
    flex: 1,
    minWidth: 0,
  },
  modalOptionTitle: {
    fontFamily,
    fontSize: 16,
    color: TEXT,
    letterSpacing: -0.2,
  },
  modalOptionMeta: {
    fontFamily,
    fontSize: 12,
    color: SECONDARY,
  },
});
