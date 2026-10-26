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
import Ionicons from '@expo/vector-icons/Ionicons';
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
import { CANVAS, MOBILE, NAV_TAB_ACTIVE_RADIUS, mobileSafeBottom } from '../lib/mobileUi';
import { FONT_LIGHT } from '../lib/typography';
import { AuditTxnDrawer, useAuditTxnDrawer } from './AuditAiOutput';

const fontFamily = Platform.select({
  ios: 'Sohne',
  android: 'Sohne',
  default: 'Sohne',
});

const ACCENT = '#1F8A4E';
const TINT = '#EAF6EE';
const BLUE = MOBILE.blue;
const TEXT = '#1a1a1a';
const SECONDARY = '#8e8e93';
const TAB_BORDER = '#d0d0d0';
const PAGE = CANVAS;
const HAIRLINE = 'rgba(42,38,30,0.08)';
const CHEVRON = '#c7c7cc';
const MOBILE_BREAKPOINT = 768;
const AMBER = '#FF9500';
const RED = '#FF3B30';
const TICKET_SHADOW = Platform.select({
  web: { boxShadow: '0 1px 2px rgba(0,0,0,0.05)' },
  default: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 2,
    elevation: 1,
  },
});

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
  if (kind === 'cash_log') return BLUE;
  return SECONDARY;
}

function eventAmount(event) {
  if (event.kind === 'count') return formatQty(event.qty);
  if (event.kind === 'cash_log') return event.amountLabel || '';
  if (event.kind === 'log_edit') return '';
  return signedQty(event.qty);
}

function eventQtyColor(event) {
  if (event.kind === 'count' || event.kind === 'log_edit') return TEXT;
  if (event.kind === 'cash_log') {
    return String(event.amountLabel || '').startsWith('+') ? ACCENT : RED;
  }
  const qty = Number(event.qty) || 0;
  if (qty > 0) return ACCENT;
  if (qty < 0) return RED;
  return TEXT;
}

function eventMeta(event) {
  return [
    formatPickerDate(event.date),
    event.timeLabel,
    event.from && event.to ? `${event.from} → ${event.to}` : '',
    event.customerName,
    event.detail,
    event.undeliveredQty > 0 ? `${formatQty(event.undeliveredQty)} undelivered` : '',
    event.shortfall > 0 ? `short ${formatQty(event.shortfall)}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

function TicketFieldRow({ label, last, children }) {
  return (
    <View style={[styles.ticketFieldRow, last && styles.ticketFieldRowLast]}>
      <Text style={styles.ticketFieldLabel}>{label}</Text>
      <View style={styles.ticketFieldControl}>{children}</View>
    </View>
  );
}

function DateChip({ label, value, onChange, maximumDate, minimumDate, variant = 'chip' }) {
  const [open, setOpen] = useState(false);
  const dateValue = parseDateParam(value);
  const plain = variant === 'plain';

  const commit = (next) => {
    if (!next) return;
    let date = parseDateParam(next);
    if (maximumDate && date > parseDateParam(maximumDate)) date = parseDateParam(maximumDate);
    if (minimumDate && date < parseDateParam(minimumDate)) date = parseDateParam(minimumDate);
    onChange(date);
  };

  const field = (
    <>
      {plain ? null : <Ionicons name="calendar-outline" size={16} color={SECONDARY} />}
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
              fontSize: plain ? 15 : 16,
              color: TEXT,
              padding: 0,
              margin: 0,
              outline: 'none',
              cursor: 'pointer',
              minWidth: plain ? 0 : 118,
              width: plain ? '100%' : undefined,
              textAlign: plain ? 'right' : 'left',
              letterSpacing: -0.2,
            },
          })
        : <Text style={[styles.dateValue, plain && styles.ticketFieldValue]}>{formatPickerDate(dateValue)}</Text>}
      {plain ? <Ionicons name="chevron-down" size={14} color={CHEVRON} /> : null}
    </>
  );

  if (Platform.OS === 'web') {
    return <View style={plain ? styles.dateChipPlain : styles.dateField}>{field}</View>;
  }

  return (
    <>
      <Pressable style={plain ? styles.dateChipPlain : styles.dateField} onPress={() => setOpen(true)}>
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

function PickerChip({ label, value, onPress, disabled = false, style, variant = 'chip' }) {
  const plain = variant === 'plain';
  return (
    <Pressable
      style={[plain ? styles.pickerPlain : styles.chip, disabled && styles.chipDisabled, style]}
      onPress={onPress}
      disabled={disabled}
    >
      {plain ? (
        <>
          <Text style={styles.ticketFieldValue} numberOfLines={1}>
            {value}
          </Text>
          <Ionicons name="chevron-down" size={14} color={CHEVRON} />
        </>
      ) : (
        <>
          <View style={styles.chipCopy}>
            {label ? <Text style={styles.chipLabel}>{label}</Text> : null}
            <Text style={styles.chipValue} numberOfLines={1}>
              {value}
            </Text>
          </View>
          <Ionicons name="chevron-down" size={14} color={SECONDARY} />
        </>
      )}
    </Pressable>
  );
}

function StoreLocationCard({ location, expanded, onToggle, onOpenRef, compact }) {
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

      <View style={[styles.statGrid, compact && styles.statGridCompact]}>
        <View style={[styles.statCell, compact && styles.statCellCompact]}>
          <Text style={styles.statCaption}>System now</Text>
          <Text style={styles.statFigure}>{formatQty(location.systemNow)}</Text>
        </View>
        <View style={[styles.statCell, compact && styles.statCellCompact]}>
          <Text style={styles.statCaption}>Last count</Text>
          <Text style={styles.statFigure}>
            {location.physicalNow != null
              ? formatQty(location.physicalNow)
              : location.countedNow != null
                ? formatQty(location.countedNow)
                : '—'}
          </Text>
        </View>
        <View style={[styles.statCell, compact && styles.statCellCompact]}>
          <Text style={styles.statCaption}>Expected</Text>
          <Text style={styles.statFigure}>{formatQty(location.expectedNow)}</Text>
        </View>
        <View style={[styles.statCell, compact && styles.statCellCompact]}>
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
                  {eventMeta(event)}
                </Text>
              </View>
              <Text style={[styles.eventQty, { color: eventQtyColor(event) }]}>
                {eventAmount(event)}
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
  const initialRange = defaultDateRange(3);
  const seedEnd = formatDateParam(initialDate || initialRange.endDate);

  const [catalog, setCatalog] = useState([]);
  const [catalogWarning, setCatalogWarning] = useState('');
  const [stores, setStores] = useState([]);
  const [itemQuery, setItemQuery] = useState('');
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [searchNote, setSearchNote] = useState('');
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
  const showItemMatches =
    itemQuery.trim().length > 0 && itemQuery.trim() !== (selectedItem?.name || '').trim();

  const chooseItem = useCallback((item) => {
    if (!item) return;
    setSearchNote('');
    setSelectedItem(item);
    setItemQuery(item.name);
  }, []);

  const submitItemSearch = useCallback(() => {
    const q = itemQuery.trim();
    if (!q) {
      setSearchNote('Type an item name or SKU, then Submit.');
      return;
    }
    if (catalogLoading && !catalog.length) {
      setSearchNote('Items are still loading.');
      return;
    }
    const exact = filteredCatalog.find(
      (item) => item.name.trim().toLowerCase() === q.toLowerCase() || item.sku.trim().toLowerCase() === q.toLowerCase(),
    );
    const chosen = exact || filteredCatalog[0];
    if (!chosen) {
      setSearchNote('No item matches that search.');
      return;
    }
    chooseItem(chosen);
  }, [itemQuery, catalogLoading, catalog.length, filteredCatalog, chooseItem]);

  useEffect(() => {
    if (storeFilter) setSelectedStoreNames([storeFilter]);
  }, [storeFilter]);

  useEffect(() => {
    if (initialDate) {
      const end = parseDateParam(initialDate);
      const start = parseDateParam(initialDate);
      start.setDate(end.getDate() - 2);
      setEndDate(end);
      setStartDate(start);
    }
  }, [initialDate]);

  useEffect(() => {
    if (!session?.token) {
      setStores([]);
      setCatalog([]);
      setCatalogLoading(false);
      return;
    }
    const id = ++storesRequestId.current;
    setCatalogLoading(true);
    Promise.all([loadItemAuditStores(session), loadItemCatalog(session)])
      .then(([nextStores, nextCatalog]) => {
        if (id !== storesRequestId.current) return;
        setStores(nextStores);
        setCatalog(nextCatalog.items);
        setCatalogWarning(nextCatalog.warning || '');
        setCatalogLoading(false);
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
        setCatalogLoading(false);
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

  const itemSearchField = (
    <View style={[styles.itemSearchRow, isMobile && styles.itemSearchRowMobile]}>
      <View style={[styles.itemSearchField, isMobile && styles.itemSearchFieldMobile]}>
        <Ionicons name="search" size={14} color={SECONDARY} />
        <TextInput
          style={styles.itemSearchInput}
          value={itemQuery}
          onChangeText={(value) => {
            setItemQuery(value);
            setSearchNote('');
          }}
          placeholder={catalogLoading ? 'Loading items…' : 'Search item name or SKU'}
          placeholderTextColor={SECONDARY}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          onSubmitEditing={submitItemSearch}
          accessibilityLabel="Search for an item"
        />
      </View>
      <Pressable
        style={[styles.submitButton, isMobile && styles.submitButtonMobile]}
        onPress={submitItemSearch}
        accessibilityRole="button"
        accessibilityLabel="Submit item search"
      >
        <Text style={styles.submitButtonText}>Submit</Text>
      </Pressable>
    </View>
  );

  const renderItemToolbar = () =>
    isMobile ? (
      <View style={styles.ticketCard}>
        <View style={styles.mobileSearchPad}>{itemSearchField}</View>
        <TicketFieldRow label="Stores">
          <PickerChip
            label="Stores"
            value={storeChipLabel}
            onPress={() => setStorePickerOpen(true)}
            disabled={lockedStore}
            variant="plain"
          />
        </TicketFieldRow>
        <TicketFieldRow label="From">
          <DateChip
            label="From"
            value={startDate}
            onChange={setStartDate}
            maximumDate={endKey}
            variant="plain"
          />
        </TicketFieldRow>
        <TicketFieldRow label="To" last>
          <DateChip
            label="To"
            value={endDate}
            onChange={setEndDate}
            maximumDate={today}
            minimumDate={startKey}
            variant="plain"
          />
        </TicketFieldRow>
      </View>
    ) : (
      <View style={styles.toolbar}>
        {itemSearchField}
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
    );

  const renderItemMeta = () => (
    <>
      <View style={[styles.metaRow, isMobile && styles.metaRowMobile]}>
        <Text style={styles.metaText} numberOfLines={2}>
          {loading
            ? progress || 'Loading…'
            : selectedItem
              ? `${selectedItem.name} · ${formatItemAuditRangeLabel(startKey, endKey)}`
              : 'Search an item name or SKU, then Submit.'}
        </Text>
        {loading ? <ActivityIndicator size="small" color={SECONDARY} /> : null}
      </View>
      {searchNote ? <Text style={styles.errorText}>{searchNote}</Text> : null}
      {showItemMatches ? (
        <View style={styles.matchList}>
          {filteredCatalog.length ? (
            filteredCatalog.slice(0, 12).map((item) => (
              <Pressable
                key={item.key}
                style={styles.matchRow}
                onPress={() => chooseItem(item)}
                accessibilityRole="button"
                accessibilityLabel={`Audit ${item.name}`}
              >
                <Text style={styles.matchTitle} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={styles.matchMeta} numberOfLines={1}>
                  {[item.metal, item.sku].filter(Boolean).join(' · ')}
                </Text>
              </Pressable>
            ))
          ) : (
            <Text style={styles.matchEmpty}>
              {catalogLoading ? 'Loading items…' : 'No items match that search.'}
            </Text>
          )}
          {filteredCatalog.length > 12 ? (
            <Text style={styles.matchEmpty}>{filteredCatalog.length - 12} more. Refine the search or Submit the best match.</Text>
          ) : null}
        </View>
      ) : null}
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      {result?.warning || catalogWarning ? (
        <Text style={styles.warningText}>{[result?.warning, catalogWarning].filter(Boolean).join(' ')}</Text>
      ) : null}
    </>
  );

  return (
    <View style={[styles.body, embedded && styles.bodyEmbedded, isMobile && styles.bodyMobile]}>
      {isMobile ? null : (
        <>
          {renderItemToolbar()}
          {renderItemMeta()}
        </>
      )}

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {isMobile ? (
          <>
            {renderItemToolbar()}
            {renderItemMeta()}
          </>
        ) : null}
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
                compact={isMobile}
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
                        <Text style={styles.eventMeta} numberOfLines={2}>
                          {eventMeta(event)}
                        </Text>
                      </View>
                      <Text style={[styles.eventQty, { color: eventQtyColor(event) }]}>
                        {eventAmount(event)}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : (
              <Text style={styles.emptyText}>
                No counts, transfers, tickets, or Aureus log lines for this item in the range.
              </Text>
            )}
          </View>
        ) : null}
      </ScrollView>

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
                    {active ? <Ionicons name="checkmark" size={20} color={ACCENT} /> : null}
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
    backgroundColor: PAGE,
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
    paddingTop: 4,
    paddingBottom: 12,
    marginBottom: 4,
    width: '100%',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(42,38,30,0.16)',
  },
  toolbarMobile: {
    marginTop: 0,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: PAGE,
    borderRadius: NAV_TAB_ACTIVE_RADIUS,
    borderWidth: 1,
    borderColor: TAB_BORDER,
    paddingHorizontal: 10,
    height: 32,
    ...TICKET_SHADOW,
    minWidth: 120,
    maxWidth: 220,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  itemSearchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 240,
  },
  itemSearchRowMobile: {
    minWidth: 0,
    width: '100%',
  },
  itemSearchField: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 32,
    minWidth: 0,
    paddingHorizontal: 10,
    borderRadius: NAV_TAB_ACTIVE_RADIUS,
    borderWidth: 1,
    borderColor: TAB_BORDER,
    backgroundColor: PAGE,
    ...TICKET_SHADOW,
  },
  itemSearchFieldMobile: {
    height: 36,
  },
  itemSearchInput: {
    flex: 1,
    minWidth: 0,
    fontFamily,
    fontSize: 14,
    color: TEXT,
    paddingVertical: 0,
    ...Platform.select({
      web: { outlineStyle: 'none' },
      default: {},
    }),
  },
  submitButton: {
    height: 32,
    paddingHorizontal: 14,
    borderRadius: NAV_TAB_ACTIVE_RADIUS,
    backgroundColor: ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  submitButtonMobile: {
    height: 36,
  },
  submitButtonText: {
    fontFamily,
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  matchList: {
    borderWidth: 1,
    borderColor: TAB_BORDER,
    borderRadius: NAV_TAB_ACTIVE_RADIUS,
    backgroundColor: PAGE,
    marginBottom: 8,
    overflow: 'hidden',
  },
  matchRow: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HAIRLINE,
  },
  matchTitle: {
    fontFamily,
    fontSize: 15,
    color: TEXT,
  },
  matchMeta: {
    fontFamily,
    fontSize: 12,
    color: SECONDARY,
    marginTop: 1,
  },
  matchEmpty: {
    fontFamily,
    fontSize: 13,
    color: SECONDARY,
    paddingHorizontal: 12,
    paddingVertical: 10,
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
    fontSize: 14,
    fontWeight: '400',
    color: TEXT,
    letterSpacing: -0.2,
  },
  dateField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: PAGE,
    borderRadius: NAV_TAB_ACTIVE_RADIUS,
    borderWidth: 1,
    borderColor: TAB_BORDER,
    paddingHorizontal: 10,
    height: 32,
    justifyContent: 'center',
    flexShrink: 0,
    ...TICKET_SHADOW,
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
    backgroundColor: PAGE,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    paddingBottom: Platform.OS === 'ios' ? Math.max(20, mobileSafeBottom()) : 16,
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
    fontSize: 17,
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
  metaRowMobile: {
    marginBottom: 0,
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
    fontSize: 17,
    color: SECONDARY,
  },
  link: {
    color: ACCENT,
    fontWeight: '400',
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
    fontFamily: FONT_LIGHT,
    fontSize: 16,
    fontWeight: '300',
    color: TEXT,
    letterSpacing: -0.2,
    paddingHorizontal: 0,
  },
  group: {
    backgroundColor: PAGE,
    borderRadius: NAV_TAB_ACTIVE_RADIUS,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: TAB_BORDER,
    ...TICKET_SHADOW,
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
    fontFamily: FONT_LIGHT,
    fontSize: 16,
    fontWeight: '300',
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
  statGridCompact: {
    paddingHorizontal: 4,
  },
  statCellCompact: {
    width: '50%',
    minWidth: 0,
  },
  statCaption: {
    fontFamily,
    fontSize: 10,
    fontWeight: '500',
    color: '#aeaeb2',
    letterSpacing: 0.02,
    marginBottom: 2,
  },
  statFigure: {
    fontFamily: FONT_LIGHT,
    fontSize: 16,
    fontWeight: '300',
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
    justifyContent: 'flex-end',
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.28)',
  },
  modalSheet: {
    backgroundColor: PAGE,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    maxHeight: '80%',
    overflow: 'hidden',
    paddingBottom: Platform.OS === 'ios' ? Math.max(20, mobileSafeBottom()) : 12,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 10,
    backgroundColor: PAGE,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HAIRLINE,
  },
  modalTitle: {
    fontFamily,
    fontSize: 17,
    fontWeight: '600',
    color: TEXT,
    letterSpacing: -0.3,
  },
  modalActions: {
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  modalList: {
    maxHeight: 420,
    backgroundColor: PAGE,
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: NAV_TAB_ACTIVE_RADIUS,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: TAB_BORDER,
  },
  modalOption: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    paddingHorizontal: 16,
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HAIRLINE,
  },
  modalOptionActive: {
    backgroundColor: TINT,
  },
  modalOptionCopy: {
    flex: 1,
    minWidth: 0,
  },
  modalOptionTitle: {
    fontFamily,
    fontSize: 17,
    color: TEXT,
    letterSpacing: -0.3,
  },
  modalOptionMeta: {
    fontFamily,
    fontSize: 12,
    color: SECONDARY,
  },
  mobileSearchPad: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ececef',
  },
  ticketCard: {
    borderWidth: 1,
    borderColor: TAB_BORDER,
    borderRadius: NAV_TAB_ACTIVE_RADIUS,
    backgroundColor: PAGE,
    overflow: 'hidden',
    width: '100%',
    marginBottom: 8,
    ...TICKET_SHADOW,
  },
  ticketFieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    paddingHorizontal: 14,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ececef',
  },
  ticketFieldRowLast: {
    borderBottomWidth: 0,
  },
  ticketFieldLabel: {
    fontFamily,
    width: 82,
    flexShrink: 0,
    fontSize: 13,
    fontWeight: '500',
    color: SECONDARY,
  },
  ticketFieldControl: {
    flex: 1,
    minWidth: 0,
    alignItems: 'stretch',
  },
  ticketFieldValue: {
    fontFamily,
    flex: 1,
    fontSize: 15,
    color: TEXT,
    textAlign: 'right',
    paddingVertical: 8,
  },
  pickerPlain: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 6,
    minHeight: 44,
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
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
});
