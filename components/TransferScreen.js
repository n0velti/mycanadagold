import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
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
import { Ionicons } from '@expo/vector-icons';
import { rowMatchesQuery } from '../lib/itemSearch';
import { fetchTransferStores } from '../lib/locations';
import { fetchTransferDetail, fetchDashboardTransfers, mergeTransferDetail } from '../lib/transfers';
import {
  TERRITORY_KEYS,
  TERRITORY_LABELS,
  applyMoveQtyOverrides,
  buildTransferPlanHtml,
  cloneSplits,
  computeTransferPlan,
  defaultForwardStop,
  defaultSplitsForMode,
  detectTransferMode,
  fetchTransferInventory,
  formatQty,
  isWorkshopStore,
  moveQtyKey,
} from '../lib/transferPlan';

const fontFamily = Platform.select({
  ios: 'Sohne',
  android: 'Sohne',
  default: 'Sohne',
});

const ACCENT = '#1F7A9A';
const MIN_STOPS = 2;
const HAIRLINE = '#e6e6e6';
const MOBILE_BREAKPOINT = 768;
const DRAWER_OPEN_MS = 280;
const DRAWER_CLOSE_MS = 220;
const ITEM_LOOKUP_CONCURRENCY = 6;

const FILTER_COLUMNS = [
  { key: 'dateLabel', label: 'Date', colStyle: 'colDate' },
  { key: 'reference', label: 'Transfer', colStyle: 'colId' },
  { key: 'fromName', label: 'From', colStyle: 'colFrom' },
  { key: 'toName', label: 'To', colStyle: 'colTo' },
  { key: 'statusDisplay', label: 'Status', colStyle: 'colStatus' },
];

const TRANSFER_TABS = [
  {
    key: 'dashboard',
    label: 'Dashboard',
    icon: 'grid-outline',
    empty: 'Overview of routes and recent transfers will appear here.',
  },
  { key: 'create', label: 'Create', icon: 'add-circle-outline' },
  {
    key: 'active',
    label: 'Active',
    icon: 'time-outline',
    empty: 'Transfers in progress will appear here.',
  },
];

const PRIORITY_COLORS = {
  green: '#2F8A4E',
  yellow: '#C9A227',
  red: '#C43C3C',
};

function StoreName({ name, isWorkshop, style, activeStyle, active }) {
  return (
    <View style={styles.nameWithStar}>
      {isWorkshop ? (
        <Ionicons name="star" size={13} color="#C9A227" style={styles.starIcon} />
      ) : null}
      <Text
        style={[style, active && activeStyle, isWorkshop && styles.workshopName]}
        numberOfLines={1}
      >
        {name}
      </Text>
    </View>
  );
}

function StoreDropdown({
  label,
  stores,
  value,
  open,
  onToggle,
  onSelect,
  zIndex,
}) {
  const selected = stores.find((store) => store.id === value) || null;
  const groups = useMemo(() => {
    const bySystem = new Map();
    for (const store of stores) {
      const key = store.systemLabel || store.systemKey || 'Stores';
      if (!bySystem.has(key)) bySystem.set(key, []);
      bySystem.get(key).push(store);
    }
    return Array.from(bySystem.entries());
  }, [stores]);

  return (
    <View style={[styles.dropdownWrap, { zIndex }]}>
      <Text style={styles.hopLabel}>{label}</Text>
      <Pressable
        style={[styles.dropdown, open && styles.dropdownOpen]}
        onPress={onToggle}
      >
        <View style={styles.dropdownMain}>
          {selected ? (
            <StoreName
              name={selected.name}
              isWorkshop={isWorkshopStore(selected)}
              style={styles.dropdownValue}
            />
          ) : (
            <Text style={[styles.dropdownValue, styles.dropdownPlaceholder]}>
              Select store
            </Text>
          )}
          {selected ? (
            <Text style={styles.dropdownMeta} numberOfLines={1}>
              {selected.systemLabel}
              {selected.city ? ` · ${selected.city}` : ''}
            </Text>
          ) : null}
        </View>
        <Ionicons
          name={open ? 'chevron-up' : 'chevron-down'}
          size={16}
          color="#8a8a8a"
        />
      </Pressable>

      {open ? (
        <ScrollView style={styles.menu} nestedScrollEnabled>
          {stores.length === 0 ? (
            <Text style={styles.menuEmpty}>No stores available</Text>
          ) : (
            groups.map(([groupLabel, groupStores]) => (
              <View key={groupLabel}>
                <Text style={styles.groupHeader}>{groupLabel}</Text>
                {groupStores.map((store) => {
                  const active = store.id === value;
                  const workshop = isWorkshopStore(store);
                  return (
                    <Pressable
                      key={store.id}
                      style={[styles.option, active && styles.optionActive]}
                      onPress={() => onSelect(store.id)}
                    >
                      <View style={styles.optionCopy}>
                        <StoreName
                          name={store.name}
                          isWorkshop={workshop}
                          style={styles.optionText}
                          activeStyle={styles.optionTextActive}
                          active={active}
                        />
                        {store.city ? (
                          <Text style={styles.optionMeta} numberOfLines={1}>
                            {store.city}
                            {store.state ? `, ${store.state}` : ''}
                          </Text>
                        ) : null}
                      </View>
                      {active ? (
                        <Ionicons name="checkmark" size={16} color={ACCENT} />
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>
            ))
          )}
        </ScrollView>
      ) : null}
    </View>
  );
}

function PercentField({ value, onChange, disabled }) {
  return (
    <TextInput
      style={[styles.percentInput, disabled && styles.percentInputDisabled]}
      value={value == null ? '' : String(value)}
      onChangeText={(text) => {
        const cleaned = text.replace(/[^0-9.]/g, '');
        if (cleaned === '' || cleaned === '.') {
          onChange(cleaned === '' ? '' : cleaned);
          return;
        }
        const n = Number(cleaned);
        if (Number.isFinite(n)) onChange(cleaned);
      }}
      onBlur={() => {
        if (value === '' || value === '.') onChange(0);
        else onChange(Number(value));
      }}
      keyboardType="decimal-pad"
      editable={!disabled}
      selectTextOnFocus
    />
  );
}

function QtyEditField({ value, onChange, max, compact }) {
  return (
    <TextInput
      style={[styles.qtyInput, compact && styles.qtyInputCompact]}
      value={value == null ? '' : String(value)}
      onChangeText={(text) => {
        const cleaned = text.replace(/[^0-9]/g, '');
        if (cleaned === '') {
          onChange('');
          return;
        }
        let n = Number(cleaned);
        if (!Number.isFinite(n)) return;
        if (max != null && n > max) n = max;
        onChange(n);
      }}
      onBlur={() => {
        if (value === '' || value == null) onChange(0);
        else {
          let n = Math.round(Number(value));
          if (!Number.isFinite(n) || n < 0) n = 0;
          if (max != null && n > max) n = max;
          onChange(n);
        }
      }}
      keyboardType="number-pad"
      selectTextOnFocus
    />
  );
}

function SplitsEditor({
  title,
  splits,
  territories,
  onChangeTier,
  disabledTiers = {},
}) {
  return (
    <View style={styles.splitsCard}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.splitsHeader}>
        <Text style={[styles.splitsCorner, styles.splitsHeaderText]}>Tier</Text>
        {territories.map((key) => (
          <Text key={key} style={[styles.splitsCell, styles.splitsHeaderText]} numberOfLines={1}>
            {TERRITORY_LABELS[key] || key}
          </Text>
        ))}
      </View>
      {['green', 'yellow', 'red'].map((tier) => {
        const disabled = Boolean(disabledTiers[tier]) || splits?.[tier] == null;
        const row = splits?.[tier];
        return (
          <View key={tier} style={styles.splitsRow}>
            <View style={styles.splitsCorner}>
              <View style={[styles.priorityDot, { backgroundColor: PRIORITY_COLORS[tier] }]} />
              <Text style={[styles.tierLabel, { color: PRIORITY_COLORS[tier] }]}>{tier}</Text>
            </View>
            {territories.map((key) => (
              <View key={`${tier}-${key}`} style={styles.splitsCell}>
                {disabled || !row ? (
                  <Text style={styles.skippedText}>{tier === 'red' && !row ? 'n/a' : '—'}</Text>
                ) : (
                  <View style={styles.percentFieldWrap}>
                    <PercentField
                      value={row[key] ?? 0}
                      onChange={(next) => onChangeTier(tier, key, next)}
                    />
                    <Text style={styles.percentSuffix}>%</Text>
                  </View>
                )}
              </View>
            ))}
          </View>
        );
      })}
    </View>
  );
}

function TabBar({ options, value, onChange }) {
  return (
    <View style={styles.tabBar} accessibilityRole="tablist">
      {options.map((option) => {
        const active = option.key === value;
        return (
          <Pressable
            key={option.key}
            style={[styles.tab, active && styles.tabActive]}
            onPress={() => onChange(option.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={option.label}
          >
            <Text style={[styles.tabLabel, active && styles.tabLabelActive]} numberOfLines={1}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function EmptyTab({ tab }) {
  return (
    <View style={styles.emptyPanel}>
      <View style={styles.emptyIcon}>
        <Ionicons name={tab.icon} size={22} color={ACCENT} />
      </View>
      <Text style={styles.emptyTitle}>{tab.label}</Text>
      <Text style={styles.emptyBody}>{tab.empty}</Text>
    </View>
  );
}

function formatListDate(value) {
  if (!value) return '—';
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return String(value);
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return date.toLocaleDateString('en-CA', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function locationLabel(side, stores) {
  if (side?.name) return side.name;
  if (!side?.id) return '—';
  const match = stores.find((store) => String(store.sourceId) === String(side.id));
  return match?.name || `#${side.id}`;
}

function statusLabel(status) {
  const value = String(status || '').trim();
  if (!value) return '—';
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function SignInPrompt({ onRequireLogin, title, body }) {
  return (
    <View style={styles.signInWrap}>
      <Text style={styles.signInTitle}>{title}</Text>
      <Text style={styles.signInBody}>{body}</Text>
      {onRequireLogin ? (
        <Pressable style={styles.signInButton} onPress={onRequireLogin}>
          <Text style={styles.signInButtonText}>Go to Profile</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function buildColumnOptions(rows) {
  const options = {};
  for (const col of FILTER_COLUMNS) {
    const seen = new Set();
    for (let i = 0; i < rows.length; i += 1) {
      seen.add(rows[i][col.key] || '—');
    }
    options[col.key] = Array.from(seen).sort((a, b) =>
      String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' }),
    );
  }
  return options;
}

function FilterableHeaderCell({ label, colStyle, active, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ hovered, pressed }) => [
        styles.listThCell,
        colStyle,
        (hovered || pressed) && styles.listThCellHover,
      ]}
    >
      <Text style={[styles.listTh, active && styles.listThActive]} numberOfLines={1}>
        {label}
      </Text>
      <Ionicons
        name={active ? 'funnel' : 'chevron-down'}
        size={11}
        color={active ? '#1a1a1a' : '#c7c7cc'}
      />
    </Pressable>
  );
}

function ColumnFilterMenu({ label, options, filter, onChange, onClose }) {
  const [search, setSearch] = useState('');
  const allValues = options;
  const selectedCount = filter == null ? allValues.length : Object.keys(filter).length;
  const allSelected = filter == null;
  const noneSelected = filter != null && selectedCount === 0;

  const visibleOptions = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allValues;
    return allValues.filter((value) => String(value).toLowerCase().includes(q));
  }, [allValues, search]);

  const isChecked = (value) => (filter == null ? true : Boolean(filter[value]));

  const selectAll = () => onChange(null);

  const clearAll = () => onChange({});

  const toggleValue = (value) => {
    const nextSelected = new Set(filter == null ? allValues : Object.keys(filter));
    if (nextSelected.has(value)) nextSelected.delete(value);
    else nextSelected.add(value);

    if (nextSelected.size === allValues.length) {
      onChange(null);
      return;
    }

    const next = {};
    nextSelected.forEach((item) => {
      next[item] = true;
    });
    onChange(next);
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.filterModalRoot}>
        <Pressable style={styles.filterModalBackdrop} onPress={onClose} />
        <View style={styles.filterMenu}>
          <View style={styles.filterMenuHeader}>
            <Text style={styles.filterMenuTitle}>{label}</Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <Ionicons name="close" size={20} color="#8e8e93" />
            </Pressable>
          </View>

          <View style={styles.filterField}>
            <Text style={styles.filterFieldLabel}>Search</Text>
            <TextInput
              style={styles.filterFieldInput}
              value={search}
              onChangeText={setSearch}
              placeholder="Filter values"
              placeholderTextColor="#999"
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus={Platform.OS === 'web'}
            />
            {search ? (
              <Pressable onPress={() => setSearch('')} hitSlop={8}>
                <Ionicons name="close-circle" size={13} color="#b0b0b0" />
              </Pressable>
            ) : null}
          </View>

          <View style={styles.filterActions}>
            <Pressable onPress={selectAll} disabled={allSelected}>
              <Text style={[styles.filterActionText, allSelected && styles.filterActionDisabled]}>
                Select all
              </Text>
            </Pressable>
            <Text style={styles.filterActionSep}>·</Text>
            <Pressable onPress={clearAll} disabled={noneSelected}>
              <Text style={[styles.filterActionText, noneSelected && styles.filterActionDisabled]}>
                Clear
              </Text>
            </Pressable>
            <Text style={styles.filterCount}>
              {selectedCount}/{allValues.length}
            </Text>
          </View>

          <ScrollView style={styles.filterList} nestedScrollEnabled>
            {visibleOptions.length === 0 ? (
              <Text style={styles.filterEmpty}>No matching values</Text>
            ) : (
              visibleOptions.map((item) => {
                const checked = isChecked(item);
                return (
                  <Pressable
                    key={String(item)}
                    style={styles.filterOption}
                    onPress={() => toggleValue(item)}
                    {...(Platform.OS === 'web' ? { className: 'cgold-filter-option' } : null)}
                  >
                    <Ionicons
                      name={checked ? 'checkbox' : 'square-outline'}
                      size={20}
                      color={checked ? '#1d1d1f' : '#c7c7cc'}
                    />
                    <Text style={styles.filterOptionText} numberOfLines={1}>
                      {item}
                    </Text>
                  </Pressable>
                );
              })
            )}
          </ScrollView>

          <Pressable style={styles.filterDoneButton} onPress={onClose}>
            <Text style={styles.filterDoneButtonText}>Done</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function useRightDrawerAnimation(visible, slideDistance) {
  const [mounted, setMounted] = useState(visible);
  const slide = useRef(new Animated.Value(slideDistance)).current;
  const backdrop = useRef(new Animated.Value(0)).current;
  const slideDistanceRef = useRef(slideDistance);
  const activeAnim = useRef(null);
  slideDistanceRef.current = slideDistance;

  const stopActiveAnim = () => {
    if (activeAnim.current) {
      activeAnim.current.stop();
      activeAnim.current = null;
    }
  };

  useEffect(() => {
    if (!mounted) {
      slide.setValue(slideDistance);
    }
  }, [slideDistance, mounted, slide]);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      return undefined;
    }

    if (!mounted) return undefined;

    stopActiveAnim();
    const anim = Animated.parallel([
      Animated.timing(slide, {
        toValue: slideDistanceRef.current,
        duration: DRAWER_CLOSE_MS,
        easing: Easing.bezier(0.4, 0, 0.2, 1),
        useNativeDriver: true,
      }),
      Animated.timing(backdrop, {
        toValue: 0,
        duration: DRAWER_CLOSE_MS,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    ]);
    activeAnim.current = anim;

    anim.start(({ finished }) => {
      if (activeAnim.current === anim) activeAnim.current = null;
      if (finished) setMounted(false);
    });

    return () => {
      if (activeAnim.current === anim) {
        anim.stop();
        activeAnim.current = null;
      }
    };
  }, [visible, mounted, slide, backdrop]);

  useLayoutEffect(() => {
    if (!visible || !mounted) return undefined;

    stopActiveAnim();
    slide.setValue(slideDistanceRef.current);
    backdrop.setValue(0);

    let cancelled = false;
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        if (cancelled) return;
        const anim = Animated.parallel([
          Animated.timing(slide, {
            toValue: 0,
            duration: DRAWER_OPEN_MS,
            easing: Easing.bezier(0.2, 0.8, 0.2, 1),
            useNativeDriver: true,
          }),
          Animated.timing(backdrop, {
            toValue: 1,
            duration: DRAWER_OPEN_MS,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
        ]);
        activeAnim.current = anim;
        anim.start(({ finished }) => {
          if (finished && activeAnim.current === anim) activeAnim.current = null;
        });
      });
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [visible, mounted, slide, backdrop]);

  return { mounted, slide, backdrop };
}

function useHeldValue(value) {
  const held = useRef(value);
  if (value != null) held.current = value;
  return value ?? held.current;
}

function DetailRow({ label, value, last }) {
  return (
    <View style={[styles.detailRow, last && styles.detailRowLast]}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value || '—'}</Text>
    </View>
  );
}

function TransferDetailDrawer({ visible, transfer, stores, loading, error, onClose }) {
  const { width: windowWidth } = useWindowDimensions();
  const isMobile = windowWidth < MOBILE_BREAKPOINT;
  const panelWidth = isMobile
    ? Math.max(windowWidth, 240)
    : Math.min(Math.max(Math.round(windowWidth * 0.46), 420), 560);
  const { mounted, slide, backdrop } = useRightDrawerAnimation(visible, panelWidth);
  const held = useHeldValue(transfer);

  if (!mounted || !held) return null;

  const from = locationLabel(held.from, stores);
  const to = locationLabel(held.to, stores);
  const items = Array.isArray(held.items) ? held.items : [];
  const received = held.status === 'received';

  return (
    <Modal visible={mounted} transparent animationType="none" onRequestClose={onClose}>
      <View style={styles.drawerRoot}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose}>
          <Animated.View style={[styles.drawerBackdrop, { opacity: backdrop }]} />
        </Pressable>
        <Animated.View
          style={[
            styles.drawerPanel,
            { width: panelWidth, transform: [{ translateX: slide }] },
          ]}
        >
          <View style={[styles.drawerTopBar, isMobile && styles.drawerTopBarMobile]}>
            <Text style={styles.drawerTitle} numberOfLines={1}>
              Transfer
            </Text>
            <Pressable
              onPress={onClose}
              hitSlop={8}
              style={styles.drawerClose}
              accessibilityLabel="Close"
            >
              <Ionicons name="close" size={18} color="#1a1a1a" />
            </Pressable>
          </View>

          <ScrollView
            style={styles.drawerBody}
            contentContainerStyle={[
              styles.drawerBodyContent,
              isMobile && styles.drawerBodyContentMobile,
            ]}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.drawerHero}>
              <Text style={styles.drawerHeroRoute}>
                {from} → {to}
              </Text>
              <Text style={styles.drawerHeroMeta}>
                {held.reference}
                {held.date ? ` · ${formatListDate(held.date)}` : ''}
              </Text>
              <View
                style={[
                  styles.statusPill,
                  styles.drawerStatus,
                  received ? styles.statusReceived : styles.statusOther,
                ]}
              >
                <Text
                  style={[
                    styles.statusPillText,
                    received ? styles.statusReceivedText : styles.statusOtherText,
                  ]}
                >
                  {statusLabel(held.status)}
                </Text>
              </View>
            </View>

            <Text style={styles.drawerSectionLabel}>Details</Text>
            <View style={styles.drawerGroup}>
              <DetailRow label="Transfer" value={held.reference} />
              <DetailRow label="Date" value={formatListDate(held.date)} />
              <DetailRow
                label="Received"
                value={
                  held.status === 'pending'
                    ? 'Not received yet'
                    : formatListDate(held.receivedDate)
                }
              />
              <DetailRow label="From" value={from} />
              <DetailRow label="To" value={to} />
              {held.createdBy ? <DetailRow label="Created by" value={held.createdBy} /> : null}
              {held.receivedBy ? <DetailRow label="Received by" value={held.receivedBy} /> : null}
              {held.tracking ? <DetailRow label="Tracking" value={held.tracking} /> : null}
              <DetailRow label="Comments" value={held.comments || '—'} last />
            </View>

            <Text style={styles.drawerSectionLabel}>
              Items{items.length ? ` · ${items.length}` : ''}
              {held.totalQty ? ` · ${formatQty(held.totalQty)} sent` : ''}
            </Text>

            {loading ? (
              <View style={styles.drawerLoading}>
                <ActivityIndicator color={ACCENT} />
              </View>
            ) : null}
            {error ? <Text style={styles.errorText}>{error}</Text> : null}

            <View style={styles.drawerGroup}>
              <View style={styles.itemHead}>
                <Text style={[styles.itemTh, styles.itemColName]}>Item</Text>
                <Text style={[styles.itemTh, styles.itemColQty]}>Sent</Text>
                <Text style={[styles.itemTh, styles.itemColQty]}>Recv</Text>
              </View>
              {items.length === 0 && !loading ? (
                <Text style={styles.itemEmpty}>No line items on this transfer.</Text>
              ) : (
                items.map((item, index) => {
                  const name = item.name || item.sku || item.productId || 'Untitled item';
                  const short = item.shortfall != null && item.shortfall > 0;
                  return (
                    <View
                      key={item.productId || `${name}-${index}`}
                      style={[
                        styles.itemRow,
                        index === items.length - 1 && !held.totalQty && styles.itemRowLast,
                      ]}
                    >
                      <View style={styles.itemColName}>
                        <Text style={styles.itemName} numberOfLines={2}>
                          {name}
                        </Text>
                        {item.sku && item.sku !== name ? (
                          <Text style={styles.itemSku} numberOfLines={1}>
                            {item.sku}
                          </Text>
                        ) : null}
                      </View>
                      <Text style={[styles.itemQty, styles.itemColQty]}>
                        {item.quantity == null ? '—' : formatQty(item.quantity)}
                      </Text>
                      <Text
                        style={[
                          styles.itemQty,
                          styles.itemColQty,
                          short && styles.itemQtyShort,
                        ]}
                      >
                        {item.receivedQuantity == null
                          ? '—'
                          : formatQty(item.receivedQuantity)}
                      </Text>
                    </View>
                  );
                })
              )}
              {items.length > 0 ? (
                <View style={[styles.itemRow, styles.itemRowLast, styles.itemTotalRow]}>
                  <Text style={[styles.itemTotalLabel, styles.itemColName]}>Total</Text>
                  <Text style={[styles.itemQty, styles.itemColQty, styles.itemTotalQty]}>
                    {formatQty(held.totalQty)}
                  </Text>
                  <Text style={[styles.itemQty, styles.itemColQty, styles.itemTotalQty]}>
                    {held.receivedQty ? formatQty(held.receivedQty) : '—'}
                  </Text>
                </View>
              ) : null}
            </View>
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

function DashboardPanel({ session, stores, onRequireLogin }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [total, setTotal] = useState(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [receivedCount, setReceivedCount] = useState(0);
  const [warning, setWarning] = useState('');
  const [query, setQuery] = useState('');
  const [lookupQuery, setLookupQuery] = useState('');
  const [itemLookup, setItemLookup] = useState(false);
  const [listEpoch, setListEpoch] = useState(0);
  const [columnFilters, setColumnFilters] = useState({});
  const [openFilter, setOpenFilter] = useState(null);
  const [selectedRow, setSelectedRow] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const requestId = useRef(0);
  const detailRequestId = useRef(0);
  const enrichRequestId = useRef(0);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  const load = useCallback(async () => {
    if (!session?.token) {
      setRows([]);
      setError('');
      setTotal(null);
      setPendingCount(0);
      setReceivedCount(0);
      setWarning('');
      return;
    }

    const id = ++requestId.current;
    setLoading(true);
    setError('');
    setWarning('');
    setColumnFilters({});
    setOpenFilter(null);
    setSelectedRow(null);
    setDetailError('');

    try {
      const result = await fetchDashboardTransfers(session.token, {
        page: 1,
        baseUrl: session.baseUrl,
      });
      if (id !== requestId.current) return;
      setRows(result.transfers);
      setTotal(result.total);
      setPendingCount(result.pendingCount);
      setReceivedCount(result.receivedCount);
      setWarning(result.warning || '');
      setListEpoch((value) => value + 1);
    } catch (err) {
      if (id !== requestId.current) return;
      setRows([]);
      setTotal(null);
      setPendingCount(0);
      setReceivedCount(0);
      setWarning('');
      setError(err?.message || 'Failed to load transfers.');
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const timer = setTimeout(() => setLookupQuery(query.trim()), 220);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const currentRows = rowsRef.current;
    if (!session?.token || currentRows.length === 0) return undefined;

    const wantItems = lookupQuery.length >= 2;
    const candidates = currentRows.filter((row) => wantItems && row.id && !row.itemsLoaded);
    if (candidates.length === 0) {
      setItemLookup(false);
      return undefined;
    }

    const enrichId = ++enrichRequestId.current;
    let cancelled = false;
    setItemLookup(true);

    (async () => {
      const queue = [...candidates];
      const workers = Array.from(
        { length: Math.min(ITEM_LOOKUP_CONCURRENCY, queue.length) },
        async () => {
          while (queue.length && !cancelled && enrichId === enrichRequestId.current) {
            const row = queue.shift();
            if (!row?.id) continue;
            try {
              const detail = await fetchTransferDetail(session.token, row.id, session.baseUrl);
              if (cancelled || enrichId !== enrichRequestId.current) return;
              const enriched = mergeTransferDetail(row, detail);
              setRows((current) =>
                current.map((entry) => (entry.id === row.id ? enriched : entry)),
              );
            } catch {
              if (cancelled || enrichId !== enrichRequestId.current) return;
              setRows((current) =>
                current.map((entry) =>
                  entry.id === row.id ? { ...entry, itemsLoaded: true } : entry,
                ),
              );
            }
          }
        },
      );
      await Promise.all(workers);
      if (!cancelled && enrichId === enrichRequestId.current) setItemLookup(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [session?.token, session?.baseUrl, listEpoch, lookupQuery]);

  const displayRows = useMemo(
    () =>
      rows.map((row) => {
        const fromName = locationLabel(row.from, stores);
        const toName = locationLabel(row.to, stores);
        const dateLabel = formatListDate(row.date);
        const statusDisplay = statusLabel(row.status);
        return {
          ...row,
          fromName,
          toName,
          dateLabel,
          statusDisplay,
          searchText: [
            row.searchText,
            fromName,
            toName,
            dateLabel,
            statusDisplay,
          ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase(),
        };
      }),
    [rows, stores],
  );

  const columnOptions = useMemo(() => buildColumnOptions(displayRows), [displayRows]);

  const activeFilterCount = useMemo(
    () => FILTER_COLUMNS.reduce((count, col) => count + (columnFilters[col.key] != null ? 1 : 0), 0),
    [columnFilters],
  );

  const filteredRows = useMemo(() => {
    let result = displayRows;
    for (const col of FILTER_COLUMNS) {
      const filter = columnFilters[col.key];
      if (filter) {
        result = result.filter((row) => filter[row[col.key] || '—']);
      }
    }
    if (query.trim()) {
      result = result.filter((row) => rowMatchesQuery(row, query));
    }
    return result;
  }, [displayRows, columnFilters, query]);

  const openFilterColumn = openFilter
    ? FILTER_COLUMNS.find((col) => col.key === openFilter)
    : null;

  const clearColumnFilters = () => {
    setColumnFilters({});
    setOpenFilter(null);
  };

  const closeDetail = useCallback(() => {
    setSelectedRow(null);
    setDetailError('');
    setDetailLoading(false);
  }, []);

  const openDetail = useCallback(
    async (row) => {
      setSelectedRow(row);
      setDetailError('');
      setDetailLoading(true);
      const id = ++detailRequestId.current;
      if (!session?.token || !row?.id) {
        setDetailLoading(false);
        return;
      }

      try {
        const detail = await fetchTransferDetail(session.token, row.id, session.baseUrl);
        if (id !== detailRequestId.current) return;
        const enriched = mergeTransferDetail(row, detail);
        setRows((current) =>
          current.map((entry) => (entry.id === row.id ? enriched : entry)),
        );
        setSelectedRow(enriched);
      } catch (err) {
        if (id !== detailRequestId.current) return;
        setDetailError(err?.message || 'Failed to load transfer details.');
      } finally {
        if (id === detailRequestId.current) setDetailLoading(false);
      }
    },
    [session?.token, session?.baseUrl],
  );

  const selectedDisplay =
    selectedRow &&
    (displayRows.find((row) => row.id === selectedRow.id) || selectedRow);

  const metaLabel = useMemo(() => {
    if (loading && rows.length === 0) return 'Loading transfers…';
    if (error && rows.length === 0) return '';
    const shown = filteredRows.length;
    const suffix = query.trim() || activeFilterCount > 0 ? '' : ' · pending first';
    if (shown !== rows.length || query.trim() || activeFilterCount > 0) {
      return `${shown} of ${rows.length} transfers`;
    }
    if (shown === 0) return 'No transfers.';
    const parts = [`${shown} transfer${shown === 1 ? '' : 's'}`];
    if (pendingCount) parts.push(`${pendingCount} pending`);
    if (receivedCount) parts.push(`${receivedCount} received`);
    return `${parts.join(' · ')}${suffix}`;
  }, [
    activeFilterCount,
    error,
    filteredRows.length,
    loading,
    pendingCount,
    query,
    receivedCount,
    rows.length,
  ]);

  if (!session?.token) {
    return (
      <SignInPrompt
        onRequireLogin={onRequireLogin}
        title="Sign in required"
        body="Log in from Profile to see pending and received transfers."
      />
    );
  }

  return (
    <View style={styles.dashboard}>
      <View style={styles.searchBar}>
        <Ionicons name="search" size={16} color="#8e8e93" style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder="Search items, stores, TR#"
          placeholderTextColor="#8e8e93"
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
        />
        {query ? (
          <Pressable onPress={() => setQuery('')} hitSlop={8}>
            <Ionicons name="close-circle" size={18} color="#c7c7cc" />
          </Pressable>
        ) : null}
      </View>

      <View style={styles.dashboardToolbar}>
        <Text style={styles.dashboardMeta} numberOfLines={1}>
          {metaLabel}
          {activeFilterCount > 0
            ? ` · ${activeFilterCount} filter${activeFilterCount > 1 ? 's' : ''}`
            : ''}
        </Text>
        <View style={styles.dashboardToolbarRight}>
          {activeFilterCount > 0 ? (
            <Pressable onPress={clearColumnFilters} hitSlop={6}>
              <Text style={styles.clearFiltersText}>Clear</Text>
            </Pressable>
          ) : null}
          {(loading && rows.length > 0) || itemLookup ? (
            <ActivityIndicator size="small" color="#8a8a8a" />
          ) : null}
          <Pressable
            onPress={load}
            disabled={loading}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Refresh transfers"
            style={({ hovered, pressed }) => [
              styles.refreshButton,
              (hovered || pressed) && styles.refreshButtonHover,
            ]}
          >
            <Ionicons name="refresh-outline" size={18} color={loading ? '#c0c0c0' : ACCENT} />
          </Pressable>
        </View>
      </View>

      {error ? <Text style={[styles.errorText, styles.dashboardError]}>{error}</Text> : null}
      {warning && !error ? (
        <Text style={[styles.warningText, styles.dashboardError]}>{warning}</Text>
      ) : null}

      <View style={styles.listTable}>
        <View style={styles.listHead}>
          {FILTER_COLUMNS.slice(0, 4).map((col) => (
            <FilterableHeaderCell
              key={col.key}
              label={col.label}
              colStyle={styles[col.colStyle]}
              active={columnFilters[col.key] != null}
              onPress={() => setOpenFilter(col.key)}
            />
          ))}
          <Text style={[styles.listTh, styles.colItems]}>Items</Text>
          {FILTER_COLUMNS.slice(4).map((col) => (
            <FilterableHeaderCell
              key={col.key}
              label={col.label}
              colStyle={styles[col.colStyle]}
              active={columnFilters[col.key] != null}
              onPress={() => setOpenFilter(col.key)}
            />
          ))}
        </View>

        {loading && rows.length === 0 ? (
          <View style={styles.listEmpty}>
            <ActivityIndicator color={ACCENT} />
          </View>
        ) : filteredRows.length === 0 ? (
          <View style={styles.listEmpty}>
            <Text style={styles.listEmptyText}>
              {itemLookup
                ? 'Looking up items…'
                : error
                  ? 'Could not load transfers.'
                  : query.trim() || activeFilterCount > 0
                    ? 'No transfers match the current filters.'
                    : 'No transfers yet.'}
            </Text>
          </View>
        ) : (
          <ScrollView
            style={styles.listScroll}
            contentContainerStyle={styles.listScrollContent}
            showsVerticalScrollIndicator={false}
          >
            {filteredRows.map((row) => {
              const received = row.status === 'received';
              const selected = selectedRow?.id === row.id;
              return (
                <Pressable
                  key={row.id || `${row.date}-${row.reference}`}
                  onPress={() => openDetail(row)}
                  style={({ hovered, pressed }) => [
                    styles.listRow,
                    !selected && (hovered || pressed) && styles.listRowHover,
                    selected && styles.listRowSelected,
                  ]}
                  {...(Platform.OS === 'web'
                    ? {
                        className: selected
                          ? 'cgold-tx-row cgold-tx-row-selected'
                          : 'cgold-tx-row',
                      }
                    : null)}
                >
                  <Text style={[styles.listTd, styles.colDate]} numberOfLines={1}>
                    {row.dateLabel}
                  </Text>
                  <Text style={[styles.listTd, styles.colId, styles.listRef]} numberOfLines={1}>
                    {row.reference}
                  </Text>
                  <View style={styles.colFrom}>
                    <Text style={styles.listTd} numberOfLines={1}>
                      {row.fromName}
                    </Text>
                    {row.comments ? (
                      <Text style={styles.listComment} numberOfLines={1}>
                        {row.comments}
                      </Text>
                    ) : null}
                  </View>
                  <Text style={[styles.listTd, styles.colTo]} numberOfLines={1}>
                    {row.toName}
                  </Text>
                  <Text style={[styles.listTd, styles.colItems, styles.listItems]} numberOfLines={1}>
                    {row.itemCount || '—'}
                  </Text>
                  <View style={styles.colStatus}>
                    <View
                      style={[
                        styles.statusPill,
                        received ? styles.statusReceived : styles.statusOther,
                      ]}
                    >
                      <Text
                        style={[
                          styles.statusPillText,
                          received ? styles.statusReceivedText : styles.statusOtherText,
                        ]}
                        numberOfLines={1}
                      >
                        {row.statusDisplay}
                      </Text>
                    </View>
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
        )}

        {openFilterColumn ? (
          <ColumnFilterMenu
            label={openFilterColumn.label}
            options={columnOptions[openFilterColumn.key] || []}
            filter={columnFilters[openFilterColumn.key] ?? null}
            onChange={(next) => {
              setColumnFilters((current) => ({
                ...current,
                [openFilterColumn.key]: next,
              }));
            }}
            onClose={() => setOpenFilter(null)}
          />
        ) : null}

        <TransferDetailDrawer
          visible={Boolean(selectedRow)}
          transfer={selectedDisplay}
          stores={stores}
          loading={detailLoading}
          error={detailError}
          onClose={closeDetail}
        />
      </View>
    </View>
  );
}

async function downloadTransferPdf(html, filename) {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      throw new Error('Pop-up blocked. Allow pop-ups to download the PDF.');
    }
    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.document.title = filename.replace(/\.pdf$/i, '');
    // Let layout settle, then open the print dialog (Save as PDF).
    setTimeout(() => {
      printWindow.focus();
      printWindow.print();
    }, 250);
    return;
  }

  try {
    const Print = await import('expo-print');
    await Print.printAsync({ html });
  } catch {
    throw new Error('PDF download requires the web app, or expo-print on device.');
  }
}

export default function TransferScreen({ session, onRequireLogin }) {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [stores, setStores] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [coverage, setCoverage] = useState('');
  const [stops, setStops] = useState(['', '']);
  const [openIndex, setOpenIndex] = useState(null);
  const [status, setStatus] = useState('');

  const [planning, setPlanning] = useState(false);
  const [planError, setPlanError] = useState('');
  const [inventoryRows, setInventoryRows] = useState([]);
  const [inventoryWarning, setInventoryWarning] = useState('');
  const [splits, setSplits] = useState(() => defaultSplitsForMode('quebec'));
  const [itemOverrides, setItemOverrides] = useState({});
  const [moveQtyOverrides, setMoveQtyOverrides] = useState({});
  const [expandedProductId, setExpandedProductId] = useState(null);
  const [expandedStops, setExpandedStops] = useState(() => new Set());
  const [pdfBusy, setPdfBusy] = useState(false);
  const [showPlan, setShowPlan] = useState(false);

  const requestId = useRef(0);
  const planRequestId = useRef(0);

  const load = useCallback(async () => {
    if (!session?.token) {
      setStores([]);
      setError('');
      setWarning('');
      setCoverage('');
      return;
    }

    const id = ++requestId.current;
    setLoading(true);
    setError('');
    setWarning('');
    setCoverage('');

    try {
      const result = await fetchTransferStores(session);
      if (id !== requestId.current) return;
      setStores(result.stores);
      setWarning(result.warning || '');
      const loaded = (result.groups || [])
        .filter((group) => group.stores.length > 0)
        .map((group) => `${group.label} (${group.stores.length})`);
      setCoverage(loaded.length ? loaded.join(' · ') : '');
    } catch (err) {
      if (id !== requestId.current) return;
      setStores([]);
      setError(err?.message || 'Failed to load stores.');
      setWarning('');
      setCoverage('');
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    load();
  }, [load]);

  const storeById = useMemo(() => {
    const map = new Map();
    for (const store of stores) map.set(store.id, store);
    return map;
  }, [stores]);

  const selectedStores = useMemo(
    () => stops.map((id) => storeById.get(id)).filter(Boolean),
    [stops, storeById],
  );

  const pathLabels = useMemo(
    () => selectedStores.map((store) => store.name),
    [selectedStores],
  );

  const mode = useMemo(() => detectTransferMode(selectedStores), [selectedStores]);

  const activeTerritories = useMemo(() => {
    const keys = mode === 'workshop' ? TERRITORY_KEYS : TERRITORY_KEYS.filter((k) => k !== 'workshop');
    return keys;
  }, [mode]);

  const basePlan = useMemo(() => {
    if (!showPlan || selectedStores.length < MIN_STOPS) return null;
    return computeTransferPlan({
      stores: selectedStores,
      rows: inventoryRows,
      splits,
      itemOverrides,
    });
  }, [showPlan, selectedStores, inventoryRows, splits, itemOverrides]);

  const plan = useMemo(
    () => applyMoveQtyOverrides(basePlan, moveQtyOverrides),
    [basePlan, moveQtyOverrides],
  );

  const canTransfer =
    stops.length >= MIN_STOPS &&
    stops.every((id) => Boolean(id)) &&
    new Set(stops).size === stops.length;

  const setStop = (index, storeId) => {
    setStops((current) => {
      const next = current.slice();
      next[index] = storeId;
      return next;
    });
    setOpenIndex(null);
    setStatus('');
    setShowPlan(false);
  };

  const addStop = () => {
    setStops((current) => [...current, '']);
    setOpenIndex(null);
    setStatus('');
    setShowPlan(false);
  };

  const removeStop = (index) => {
    if (stops.length <= MIN_STOPS) return;
    setStops((current) => current.filter((_, i) => i !== index));
    setOpenIndex(null);
    setStatus('');
    setShowPlan(false);
  };

  const handleTransfer = async () => {
    if (!canTransfer) {
      if (stops.some((id) => !id)) {
        setStatus('Pick a store for every stop.');
        return;
      }
      if (new Set(stops).size !== stops.length) {
        setStatus('Each stop must be a different store.');
        return;
      }
      return;
    }

    const id = ++planRequestId.current;
    setPlanning(true);
    setPlanError('');
    setStatus('');
    setItemOverrides({});
    setMoveQtyOverrides({});
    setExpandedProductId(null);
    setExpandedStops(new Set());

    const nextMode = detectTransferMode(selectedStores);
    setSplits(defaultSplitsForMode(nextMode));

    try {
      const result = await fetchTransferInventory(session, selectedStores);
      if (id !== planRequestId.current) return;
      setInventoryRows(result.rows);
      setInventoryWarning(result.warning || '');
      setShowPlan(true);
      if (!result.rows.length) {
        setStatus('No prioritized bullion stock found across these stores.');
      }
    } catch (err) {
      if (id !== planRequestId.current) return;
      setInventoryRows([]);
      setShowPlan(false);
      setPlanError(err?.message || 'Failed to build transfer plan.');
    } finally {
      if (id === planRequestId.current) setPlanning(false);
    }
  };

  const updateSplit = (tier, territory, value) => {
    setSplits((current) => {
      const next = cloneSplits(current);
      if (!next[tier]) next[tier] = {};
      next[tier] = { ...next[tier], [territory]: value };
      return next;
    });
  };

  const resetSplits = () => {
    setSplits(defaultSplitsForMode(mode));
    setItemOverrides({});
    setMoveQtyOverrides({});
  };

  const setMoveQty = (productId, fromId, toId, qty) => {
    const key = moveQtyKey(productId, fromId, toId);
    setMoveQtyOverrides((current) => ({
      ...current,
      [key]: qty,
    }));
  };

  const sendQtyForStayRow = (sheet, row) => {
    const destination = defaultForwardStop(plan?.stores || [], sheet.storeId);
    if (!destination) return 0;
    const key = moveQtyKey(row.productId, sheet.storeId, destination.id);
    if (Object.prototype.hasOwnProperty.call(moveQtyOverrides, key)) {
      return moveQtyOverrides[key];
    }
    const outRow = sheet.outs.find(
      (entry) => entry.productId === row.productId && entry.partnerId === destination.id,
    );
    return outRow?.qty || 0;
  };

  const ensureItemOverride = (product) => {
    setItemOverrides((current) => {
      if (current[product.id]) return current;
      const base = cloneSplits(splits)[product.priority];
      if (!base) return current;
      return { ...current, [product.id]: { ...base } };
    });
  };

  const updateItemPercent = (productId, territory, value) => {
    setItemOverrides((current) => {
      const row = current[productId];
      if (!row) return current;
      return {
        ...current,
        [productId]: { ...row, [territory]: value },
      };
    });
  };

  const clearItemOverride = (productId) => {
    setItemOverrides((current) => {
      const next = { ...current };
      delete next[productId];
      return next;
    });
  };

  const toggleStopExpanded = (storeId) => {
    setExpandedStops((current) => {
      const next = new Set(current);
      if (next.has(storeId)) next.delete(storeId);
      else next.add(storeId);
      return next;
    });
  };

  const handleDownloadPdf = async () => {
    if (!plan) return;
    setPdfBusy(true);
    setStatus('');
    try {
      const stamp = new Date().toISOString().slice(0, 10);
      const html = buildTransferPlanHtml(plan, {
        pathLabels,
        splits,
        generatedAt: new Date(),
      });
      await downloadTransferPdf(html, `transfer-plan-${stamp}.pdf`);
      setStatus('Print dialog opened — choose Save as PDF to share with the team.');
    } catch (err) {
      setStatus(err?.message || 'Could not create PDF.');
    } finally {
      setPdfBusy(false);
    }
  };

  const currentTab = TRANSFER_TABS.find((tab) => tab.key === activeTab) || TRANSFER_TABS[1];

  let createBody;
  if (!session?.token) {
    createBody = (
      <SignInPrompt
        onRequireLogin={onRequireLogin}
        title="Sign in required"
        body="Log in from Profile to choose stores and create a transfer route."
      />
    );
  } else {
    createBody = (
    <ScrollView
      style={styles.createScroll}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <Text style={styles.title}>Transfer route</Text>
      <Text style={styles.subtitle}>
        Route is one-way only — the car leaves the first stop, then each next stop
        in order (no going back). Example: Montreal → Laval → Workshop. Tap
        Transfer to see OUT/IN for each stop so the % targets are met along that
        path.
      </Text>

      {loading && stores.length === 0 ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" color={ACCENT} />
          <Text style={styles.loadingText}>Loading stores…</Text>
        </View>
      ) : null}

      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      {warning ? <Text style={styles.warningText}>{warning}</Text> : null}
      {coverage ? <Text style={styles.coverageText}>{coverage}</Text> : null}

      <View style={styles.chain}>
        {stops.map((stopId, index) => {
          const isLast = index === stops.length - 1;
          const hopLabel =
            index === 0
              ? 'From'
              : isLast
                ? 'To'
                : `Via ${index}`;

          return (
            <View key={`hop-${index}`} style={styles.hopBlock}>
              <View style={styles.hopRow}>
                <StoreDropdown
                  label={hopLabel}
                  stores={stores}
                  value={stopId}
                  open={openIndex === index}
                  onToggle={() =>
                    setOpenIndex((current) => (current === index ? null : index))
                  }
                  onSelect={(id) => setStop(index, id)}
                  zIndex={stops.length - index + 10}
                />
                {stops.length > MIN_STOPS ? (
                  <Pressable
                    style={styles.removeHop}
                    onPress={() => removeStop(index)}
                    accessibilityLabel={`Remove stop ${index + 1}`}
                  >
                    <Ionicons name="close-circle" size={20} color="#9a9a9a" />
                  </Pressable>
                ) : null}
              </View>

              {!isLast ? (
                <View style={styles.arrowBetween}>
                  <Ionicons name="arrow-forward" size={20} color={ACCENT} />
                </View>
              ) : null}
            </View>
          );
        })}
      </View>

      <Pressable style={styles.addHopButton} onPress={addStop}>
        <Ionicons name="add-circle-outline" size={18} color={ACCENT} />
        <Text style={styles.addHopText}>Add stop</Text>
        <Ionicons name="arrow-forward" size={14} color="#8a8a8a" />
      </Pressable>

      {pathLabels.length >= 2 ? (
        <Text style={styles.pathPreview}>{pathLabels.join(' → ')}</Text>
      ) : null}

      <View style={styles.actionsRow}>
        <Pressable
          style={[styles.transferButton, (!canTransfer || planning) && styles.transferButtonDisabled]}
          onPress={handleTransfer}
          disabled={planning}
        >
          {planning ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Ionicons name="arrow-forward-outline" size={18} color="#fff" />
          )}
          <Text style={styles.transferButtonText}>
            {planning ? 'Planning…' : 'Transfer'}
          </Text>
        </Pressable>

        {showPlan && plan ? (
          <Pressable
            style={[styles.pdfButton, pdfBusy && styles.transferButtonDisabled]}
            onPress={handleDownloadPdf}
            disabled={pdfBusy}
          >
            {pdfBusy ? (
              <ActivityIndicator size="small" color={ACCENT} />
            ) : (
              <Ionicons name="download-outline" size={18} color={ACCENT} />
            )}
            <Text style={styles.pdfButtonText}>Download PDF</Text>
          </Pressable>
        ) : null}
      </View>

      {status ? <Text style={styles.statusText}>{status}</Text> : null}
      {planError ? <Text style={styles.errorText}>{planError}</Text> : null}
      {inventoryWarning ? <Text style={styles.warningText}>{inventoryWarning}</Text> : null}

      {showPlan && plan ? (
        <View style={styles.planSection}>
          <View style={styles.modeBanner}>
            <Ionicons name="arrow-forward" size={16} color={ACCENT} />
            <Text style={styles.modeBannerText}>
              One-way route: {pathLabels.join(' → ')}. Inventory only moves
              forward along these arrows.
            </Text>
          </View>

          {plan.unknownStores?.length ? (
            <Text style={styles.warningText}>
              Ignored (not Quebec/Workshop): {plan.unknownStores.join(', ')}
            </Text>
          ) : null}

          {plan.routeBlocked ? (
            <Text style={styles.warningText}>
              Some target % could not be fully met without sending stock backward
              on this route. Reorder stops if you need those moves.
            </Text>
          ) : null}

          <SplitsEditor
            title="Target split %"
            splits={splits}
            territories={activeTerritories}
            onChangeTier={updateSplit}
            disabledTiers={{
              red: mode === 'quebec',
            }}
          />

          <Pressable style={styles.resetLink} onPress={resetSplits}>
            <Text style={styles.resetLinkText}>
              Reset percentages & quantities to defaults
            </Text>
          </Pressable>

          {plan?.hasManualEdits ? (
            <Text style={styles.itemOverrideHint}>
              Manual send qty edits are included in the lists and PDF.
            </Text>
          ) : null}

          {(plan.stopSheets || []).length > 0 ? (
            <>
              {plan.stopSheets.map((sheet) => {
                const stayingOpen = expandedStops.has(sheet.storeId);
                const hasTransfers = sheet.outs.length > 0 || sheet.ins.length > 0;
                return (
                  <View key={sheet.storeId} style={styles.stopCard}>
                    <View style={styles.stopHeader}>
                      {sheet.isWorkshop ? (
                        <Ionicons name="star" size={14} color="#C9A227" />
                      ) : null}
                      <Text style={styles.stopTitle}>{sheet.storeName}</Text>
                    </View>

                    {sheet.outs.length > 0 ? (
                      <View style={styles.tableBlock}>
                        <Text style={styles.tableCaption}>
                          Transfer OUT · {formatQty(sheet.outUnits)}
                        </Text>
                        <View style={styles.tableHead}>
                          <Text style={[styles.th, styles.thProduct]}>Product</Text>
                          <Text style={[styles.th, styles.thQty]}>Have</Text>
                          <Text style={[styles.th, styles.thQty]}>Send</Text>
                          <Text style={[styles.th, styles.thPartner]}>To</Text>
                        </View>
                        {sheet.outs.map((row, index) => (
                          <View
                            key={`out-${sheet.storeId}-${row.productId}-${row.partnerId}-${index}`}
                            style={[
                              styles.tableRow,
                              expandedProductId === row.productId && styles.tableRowActive,
                            ]}
                          >
                            <Pressable
                              style={[styles.td, styles.thProduct, styles.productCell]}
                              onPress={() => {
                                const product = plan.products.find((p) => p.id === row.productId)
                                  || plan.catalog?.find((p) => p.id === row.productId);
                                if (!product) return;
                                const next =
                                  expandedProductId === row.productId ? null : row.productId;
                                setExpandedProductId(next);
                                if (next) ensureItemOverride(product);
                              }}
                            >
                              <View
                                style={[
                                  styles.priorityDot,
                                  { backgroundColor: PRIORITY_COLORS[row.priority] },
                                ]}
                              />
                              <Text style={styles.tdText} numberOfLines={2}>
                                {row.productName}
                              </Text>
                            </Pressable>
                            <Text style={[styles.td, styles.thQty, styles.haveText]}>
                              {formatQty(row.currentQty ?? 0)}
                            </Text>
                            <View style={[styles.td, styles.thQty]}>
                              <QtyEditField
                                value={
                                  Object.prototype.hasOwnProperty.call(
                                    moveQtyOverrides,
                                    moveQtyKey(row.productId, sheet.storeId, row.partnerId),
                                  )
                                    ? moveQtyOverrides[
                                        moveQtyKey(row.productId, sheet.storeId, row.partnerId)
                                      ]
                                    : row.qty
                                }
                                max={row.currentQty ?? 0}
                                onChange={(next) =>
                                  setMoveQty(row.productId, sheet.storeId, row.partnerId, next)
                                }
                              />
                            </View>
                            <Text
                              style={[styles.td, styles.thPartner, styles.tdText]}
                              numberOfLines={1}
                            >
                              → {row.partnerName}
                            </Text>
                          </View>
                        ))}
                      </View>
                    ) : (
                      <Text style={styles.noneLine}>No outbound</Text>
                    )}

                    {sheet.ins.length > 0 ? (
                      <View style={styles.tableBlock}>
                        <Text style={styles.tableCaption}>
                          Transfer IN · {formatQty(sheet.inUnits)}
                        </Text>
                        <View style={styles.tableHead}>
                          <Text style={[styles.th, styles.thProduct]}>Product</Text>
                          <Text style={[styles.th, styles.thQty]}>Qty</Text>
                          <Text style={[styles.th, styles.thPartner]}>From</Text>
                        </View>
                        {sheet.ins.map((row, index) => (
                          <View
                            key={`in-${sheet.storeId}-${row.productId}-${row.partnerId}-${index}`}
                            style={styles.tableRow}
                          >
                            <View style={[styles.td, styles.thProduct, styles.productCell]}>
                              <View
                                style={[
                                  styles.priorityDot,
                                  { backgroundColor: PRIORITY_COLORS[row.priority] },
                                ]}
                              />
                              <Text style={styles.tdText} numberOfLines={2}>
                                {row.productName}
                              </Text>
                            </View>
                            <Text style={[styles.td, styles.thQty, styles.qtyText]}>
                              {formatQty(row.qty)}
                            </Text>
                            <Text
                              style={[styles.td, styles.thPartner, styles.tdText]}
                              numberOfLines={1}
                            >
                              ← {row.partnerName}
                            </Text>
                          </View>
                        ))}
                      </View>
                    ) : (
                      <Text style={styles.noneLine}>No inbound</Text>
                    )}

                    {!hasTransfers ? (
                      <Text style={styles.noneLine}>
                        No transfers at this stop — stock stays put.
                      </Text>
                    ) : null}

                    <Pressable
                      style={styles.stayToggle}
                      onPress={() => toggleStopExpanded(sheet.storeId)}
                    >
                      <Ionicons
                        name={stayingOpen ? 'chevron-up' : 'chevron-down'}
                        size={16}
                        color={ACCENT}
                      />
                      <Text style={styles.stayToggleText}>
                        {stayingOpen ? 'Hide' : 'Show'} not transferring
                        {sheet.stayingCount
                          ? ` · ${sheet.stayingCount} items · ${formatQty(sheet.stayingUnits)} qty`
                          : ''}
                      </Text>
                    </Pressable>

                    {stayingOpen ? (
                      sheet.staying.length > 0 ? (
                        <View style={styles.tableBlock}>
                          <Text style={styles.tableCaption}>
                            Staying at {sheet.storeName} — edit Send to move onto the route
                          </Text>
                          <View style={styles.tableHead}>
                            <Text style={[styles.th, styles.thProduct]}>Product</Text>
                            <Text style={[styles.th, styles.thQty]}>Have</Text>
                            <Text style={[styles.th, styles.thQty]}>Send</Text>
                            <Text style={[styles.th, styles.thPartner]}>To</Text>
                          </View>
                          {sheet.staying.map((row) => {
                            const destination = defaultForwardStop(
                              plan.stores || [],
                              sheet.storeId,
                            );
                            const canStartTransfer =
                              Boolean(destination) && row.shippedQty <= 0;
                            const sendValue = canStartTransfer
                              ? sendQtyForStayRow(sheet, row)
                              : 0;
                            return (
                              <View
                                key={`stay-${sheet.storeId}-${row.productId}`}
                                style={styles.tableRow}
                              >
                                <View style={[styles.td, styles.thProduct, styles.productCell]}>
                                  <View
                                    style={[
                                      styles.priorityDot,
                                      { backgroundColor: PRIORITY_COLORS[row.priority] },
                                    ]}
                                  />
                                  <Text style={styles.tdText} numberOfLines={2}>
                                    {row.productName}
                                  </Text>
                                </View>
                                <Text style={[styles.td, styles.thQty, styles.haveText]}>
                                  {formatQty(row.currentQty)}
                                </Text>
                                <View style={[styles.td, styles.thQty]}>
                                  {canStartTransfer ? (
                                    <QtyEditField
                                      value={sendValue}
                                      max={row.currentQty}
                                      onChange={(next) =>
                                        setMoveQty(
                                          row.productId,
                                          sheet.storeId,
                                          destination.id,
                                          next,
                                        )
                                      }
                                    />
                                  ) : (
                                    <Text style={[styles.haveText]}>
                                      {row.shippedQty > 0
                                        ? formatQty(row.stayQty)
                                        : '—'}
                                    </Text>
                                  )}
                                </View>
                                <Text
                                  style={[styles.td, styles.thPartner, styles.stayStatus]}
                                  numberOfLines={1}
                                >
                                  {canStartTransfer
                                    ? `→ ${destination.name}`
                                    : row.shippedQty > 0
                                      ? 'partial stay'
                                      : 'End of route'}
                                </Text>
                              </View>
                            );
                          })}
                        </View>
                      ) : (
                        <Text style={styles.noneLine}>
                          No other stock at this stop for this plan.
                        </Text>
                      )
                    ) : null}
                  </View>
                );
              })}

              {expandedProductId ? (
                <View style={styles.itemOverrideCard}>
                  <Text style={styles.itemOverrideTitle}>
                    Custom % ·{' '}
                    {plan.products.find((p) => p.id === expandedProductId)?.name || 'item'}
                  </Text>
                  <Text style={styles.itemOverrideHint}>
                    Tap a product row above to edit its split for this route.
                  </Text>
                  <View style={styles.itemOverrideGrid}>
                    {activeTerritories.map((key) => (
                      <View key={key} style={styles.itemOverrideCell}>
                        <Text style={styles.itemOverrideLabel}>{TERRITORY_LABELS[key]}</Text>
                        <View style={styles.percentFieldWrap}>
                          <PercentField
                            value={itemOverrides[expandedProductId]?.[key] ?? 0}
                            onChange={(next) =>
                              updateItemPercent(expandedProductId, key, next)
                            }
                          />
                          <Text style={styles.percentSuffix}>%</Text>
                        </View>
                      </View>
                    ))}
                  </View>
                  <Pressable onPress={() => clearItemOverride(expandedProductId)}>
                    <Text style={styles.resetLinkText}>Use category default</Text>
                  </Pressable>
                </View>
              ) : (
                <Text style={styles.itemOverrideHint}>
                  Tip: tap any transfer product row to set a custom % for that item.
                </Text>
              )}
            </>
          ) : (
            <Text style={styles.emptyPlan}>
              Nothing to transfer — stock already matches the targets for this
              one-way route.
            </Text>
          )}
        </View>
      ) : null}
    </ScrollView>
    );
  }

  return (
    <View style={styles.screen}>
      <TabBar options={TRANSFER_TABS} value={activeTab} onChange={setActiveTab} />
      {activeTab === 'create' ? (
        createBody
      ) : activeTab === 'dashboard' ? (
        <DashboardPanel
          session={session}
          stores={stores}
          onRequireLogin={onRequireLogin}
        />
      ) : (
        <EmptyTab tab={currentTab} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#fff',
  },
  createScroll: {
    flex: 1,
    minHeight: 0,
  },
  tabBar: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'stretch',
    paddingHorizontal: 20,
    marginTop: 8,
    marginBottom: 8,
    maxWidth: 860,
    width: '100%',
    alignSelf: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HAIRLINE,
  },
  tab: {
    paddingHorizontal: 14,
    paddingTop: 6,
    paddingBottom: 11,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
    marginBottom: -StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  tabActive: {
    borderBottomColor: ACCENT,
  },
  tabLabel: {
    fontFamily,
    fontSize: 15,
    fontWeight: '500',
    color: '#6b6b6b',
    letterSpacing: -0.2,
  },
  tabLabelActive: {
    color: '#1a1a1a',
    fontWeight: '600',
  },
  emptyPanel: {
    flex: 1,
    minHeight: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingBottom: 48,
  },
  emptyIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: '#EEF7FB',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  emptyTitle: {
    fontFamily,
    fontSize: 20,
    fontWeight: '600',
    color: '#1a1a1a',
    letterSpacing: -0.3,
    marginBottom: 6,
  },
  emptyBody: {
    fontFamily,
    fontSize: 15,
    lineHeight: 21,
    color: '#6b6b6b',
    textAlign: 'center',
    maxWidth: 320,
  },
  dashboard: {
    flex: 1,
    minHeight: 0,
    maxWidth: 960,
    width: '100%',
    alignSelf: 'center',
    paddingHorizontal: 20,
  },
  dashboardToolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    minHeight: 28,
    marginBottom: 8,
  },
  dashboardMeta: {
    fontFamily,
    fontSize: 12,
    color: '#8a8a8a',
    flex: 1,
    minWidth: 0,
  },
  dashboardToolbarRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  refreshButton: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  refreshButtonHover: {
    backgroundColor: '#EEF7FB',
  },
  dashboardError: {
    marginBottom: 8,
  },
  listTable: {
    flex: 1,
    minHeight: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: HAIRLINE,
  },
  listHead: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HAIRLINE,
  },
  listTh: {
    fontFamily,
    fontSize: 11,
    fontWeight: '600',
    color: '#8a8a8a',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  listScroll: {
    flex: 1,
  },
  listScrollContent: {
    paddingBottom: 24,
  },
  listEmpty: {
    paddingVertical: 48,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  listEmptyText: {
    fontFamily,
    fontSize: 13,
    color: '#8a8a8a',
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 9,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f0f0f0',
    minHeight: 42,
    backgroundColor: '#fff',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  listRowHover: {
    backgroundColor: '#f5f5f7',
  },
  listRowSelected: {
    backgroundColor: '#e8e8ed',
  },
  listThCell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  listThCellHover: {
    opacity: 0.72,
  },
  listThActive: {
    color: '#1a1a1a',
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 0,
    borderRadius: 12,
    paddingHorizontal: 12,
    backgroundColor: '#e8e8ed',
    minHeight: 42,
    marginBottom: 8,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontFamily,
    fontSize: 16,
    color: '#1d1d1f',
    paddingVertical: 10,
    ...Platform.select({
      web: { outlineStyle: 'none' },
      default: {},
    }),
  },
  clearFiltersText: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: ACCENT,
  },
  filterModalRoot: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  filterModalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.28)',
  },
  filterMenu: {
    width: '100%',
    maxWidth: 340,
    maxHeight: '80%',
    backgroundColor: '#fff',
    borderRadius: 14,
    overflow: 'hidden',
    ...Platform.select({
      web: { boxShadow: '0 12px 40px rgba(0,0,0,0.18)' },
      default: { elevation: 10 },
    }),
  },
  filterMenuHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  filterMenuTitle: {
    fontFamily,
    fontSize: 17,
    fontWeight: '600',
    color: '#1d1d1f',
    letterSpacing: -0.4,
  },
  filterField: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginBottom: 10,
    borderRadius: 10,
    paddingHorizontal: 12,
    backgroundColor: '#e8e8ed',
    minHeight: 36,
  },
  filterFieldLabel: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: '#8e8e93',
    width: 56,
  },
  filterFieldInput: {
    flex: 1,
    fontFamily,
    fontSize: 15,
    color: '#1d1d1f',
    paddingVertical: 8,
    paddingHorizontal: 0,
    ...Platform.select({
      web: { outlineStyle: 'none' },
      default: {},
    }),
  },
  filterActions: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 8,
    gap: 6,
  },
  filterActionText: {
    fontFamily,
    fontSize: 15,
    fontWeight: '500',
    color: '#1d1d1f',
  },
  filterActionDisabled: {
    color: '#c0c0c0',
  },
  filterActionSep: {
    fontFamily,
    fontSize: 12,
    color: '#d0d0d0',
  },
  filterCount: {
    fontFamily,
    fontSize: 11,
    color: '#8a8a8a',
    marginLeft: 'auto',
  },
  filterList: {
    maxHeight: 240,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e5e5e5',
  },
  filterOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    minHeight: 44,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  filterOptionText: {
    fontFamily,
    fontSize: 15,
    color: '#1d1d1f',
    letterSpacing: -0.2,
    flex: 1,
  },
  filterEmpty: {
    fontFamily,
    fontSize: 13,
    color: '#8a8a8a',
    textAlign: 'center',
    paddingVertical: 20,
  },
  filterDoneButton: {
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 16,
    backgroundColor: '#1d1d1f',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignItems: 'center',
    minHeight: 40,
    justifyContent: 'center',
  },
  filterDoneButtonText: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
    letterSpacing: -0.2,
  },
  drawerRoot: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    overflow: 'visible',
  },
  drawerBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.28)',
  },
  drawerPanel: {
    height: '100%',
    backgroundColor: '#f5f5f7',
    ...Platform.select({
      web: { boxShadow: '-12px 0 32px rgba(0,0,0,0.18)' },
      default: { elevation: 12 },
    }),
  },
  drawerTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
    gap: 12,
    backgroundColor: '#f5f5f7',
  },
  drawerTopBarMobile: {
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 54 : 18,
    paddingBottom: 10,
  },
  drawerTitle: {
    fontFamily,
    flex: 1,
    fontSize: 17,
    fontWeight: '600',
    color: '#1a1a1a',
    letterSpacing: -0.4,
  },
  drawerClose: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#e8e8ed',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  drawerBody: {
    flex: 1,
    minHeight: 0,
  },
  drawerBodyContent: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 48,
  },
  drawerBodyContentMobile: {
    paddingHorizontal: 16,
    paddingBottom: 32,
  },
  drawerHero: {
    marginBottom: 20,
    gap: 6,
  },
  drawerHeroRoute: {
    fontFamily,
    fontSize: 22,
    fontWeight: '700',
    color: '#1a1a1a',
    letterSpacing: -0.4,
  },
  drawerHeroMeta: {
    fontFamily,
    fontSize: 14,
    color: '#6b6b6b',
  },
  drawerStatus: {
    alignSelf: 'flex-start',
    marginTop: 4,
  },
  drawerSectionLabel: {
    fontFamily,
    fontSize: 12,
    fontWeight: '700',
    color: '#8a8a8a',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 8,
    marginTop: 4,
  },
  drawerGroup: {
    backgroundColor: '#fff',
    borderRadius: 14,
    overflow: 'hidden',
    marginBottom: 20,
  },
  drawerLoading: {
    paddingVertical: 16,
    alignItems: 'center',
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    minHeight: 44,
    paddingVertical: 11,
    paddingHorizontal: 16,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e5ea',
  },
  detailRowLast: {
    borderBottomWidth: 0,
  },
  detailLabel: {
    fontFamily,
    width: 96,
    flexShrink: 0,
    fontSize: 14,
    color: '#8a8a8a',
    paddingTop: 1,
  },
  detailValue: {
    fontFamily,
    flex: 1,
    fontSize: 14,
    color: '#1a1a1a',
  },
  itemHead: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e5ea',
    backgroundColor: '#fafafa',
  },
  itemTh: {
    fontFamily,
    fontSize: 11,
    fontWeight: '700',
    color: '#8a8a8a',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f0f0f0',
    gap: 8,
  },
  itemRowLast: {
    borderBottomWidth: 0,
  },
  itemColName: {
    flex: 1,
    minWidth: 0,
    paddingRight: 8,
  },
  itemColQty: {
    width: 52,
    textAlign: 'right',
  },
  itemName: {
    fontFamily,
    fontSize: 14,
    color: '#1a1a1a',
  },
  itemSku: {
    fontFamily,
    fontSize: 11,
    color: '#8a8a8a',
    marginTop: 2,
  },
  itemQty: {
    fontFamily,
    fontSize: 14,
    fontWeight: '600',
    color: '#1a1a1a',
    fontVariant: ['tabular-nums'],
    textAlign: 'right',
  },
  itemQtyShort: {
    color: '#C43C3C',
  },
  itemEmpty: {
    fontFamily,
    fontSize: 13,
    color: '#8a8a8a',
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  itemTotalRow: {
    backgroundColor: '#fafafa',
  },
  itemTotalLabel: {
    fontFamily,
    fontSize: 13,
    fontWeight: '700',
    color: '#1a1a1a',
  },
  itemTotalQty: {
    fontWeight: '700',
  },
  listTd: {
    fontFamily,
    fontSize: 13,
    color: '#1a1a1a',
  },
  listRef: {
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  listItems: {
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  listComment: {
    fontFamily,
    fontSize: 11,
    color: '#8a8a8a',
    marginTop: 2,
  },
  colDate: {
    width: 104,
    paddingRight: 8,
  },
  colId: {
    width: 78,
    paddingRight: 8,
  },
  colFrom: {
    flex: 1.15,
    minWidth: 0,
    paddingRight: 8,
  },
  colTo: {
    flex: 1.05,
    minWidth: 0,
    paddingRight: 8,
  },
  colItems: {
    width: 52,
    paddingRight: 10,
    textAlign: 'right',
  },
  colStatus: {
    width: 88,
    alignItems: 'flex-start',
  },
  statusPill: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  statusReceived: {
    backgroundColor: '#E8F5EE',
  },
  statusOther: {
    backgroundColor: '#F4F0E0',
  },
  statusPillText: {
    fontFamily,
    fontSize: 11,
    fontWeight: '600',
  },
  statusReceivedText: {
    color: '#2F8A4E',
  },
  statusOtherText: {
    color: '#9A6B00',
  },
  signInWrap: {
    flex: 1,
    minHeight: 0,
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 40,
    maxWidth: 860,
    width: '100%',
    alignSelf: 'center',
  },
  title: {
    fontFamily,
    fontSize: 20,
    fontWeight: '700',
    color: '#1a1a1a',
    marginBottom: 6,
  },
  subtitle: {
    fontFamily,
    fontSize: 14,
    lineHeight: 20,
    color: '#6b6b6b',
    marginBottom: 20,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 16,
  },
  loadingText: {
    fontFamily,
    fontSize: 13,
    color: '#8a8a8a',
  },
  errorText: {
    fontFamily,
    fontSize: 13,
    color: '#C0392B',
    marginBottom: 12,
  },
  warningText: {
    fontFamily,
    fontSize: 12,
    color: '#9A6B00',
    marginBottom: 12,
  },
  coverageText: {
    fontFamily,
    fontSize: 12,
    color: '#8a8a8a',
    marginBottom: 14,
  },
  groupHeader: {
    fontFamily,
    fontSize: 11,
    fontWeight: '700',
    color: '#8a8a8a',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 4,
    backgroundColor: '#fafafa',
  },
  chain: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    gap: 0,
    marginBottom: 8,
  },
  hopBlock: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  hopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    width: 220,
  },
  hopLabel: {
    fontFamily,
    fontSize: 11,
    fontWeight: '600',
    color: '#8a8a8a',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 6,
  },
  dropdownWrap: {
    flex: 1,
    minWidth: 0,
    position: 'relative',
  },
  dropdown: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e0e0e0',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#fff',
    minHeight: 52,
  },
  dropdownOpen: {
    borderColor: ACCENT,
  },
  dropdownMain: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  dropdownValue: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  dropdownPlaceholder: {
    color: '#9a9a9a',
    fontWeight: '500',
  },
  dropdownMeta: {
    fontFamily,
    fontSize: 11,
    color: '#8a8a8a',
  },
  nameWithStar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minWidth: 0,
  },
  starIcon: {
    marginTop: 1,
  },
  workshopName: {
    color: '#1a1a1a',
  },
  menu: {
    marginTop: 6,
    maxHeight: 240,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e0e0e0',
    borderRadius: 10,
    backgroundColor: '#fff',
    ...Platform.select({
      web: { boxShadow: '0 8px 24px rgba(0,0,0,0.08)' },
      default: {
        shadowColor: '#000',
        shadowOpacity: 0.08,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 4 },
        elevation: 4,
      },
    }),
  },
  menuEmpty: {
    fontFamily,
    fontSize: 13,
    color: '#8a8a8a',
    padding: 14,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f0f0f0',
  },
  optionActive: {
    backgroundColor: '#EEF7FB',
  },
  optionCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  optionText: {
    fontFamily,
    fontSize: 14,
    fontWeight: '500',
    color: '#1a1a1a',
  },
  optionTextActive: {
    color: ACCENT,
    fontWeight: '700',
  },
  optionMeta: {
    fontFamily,
    fontSize: 11,
    color: '#8a8a8a',
  },
  removeHop: {
    marginTop: 28,
    padding: 4,
  },
  arrowBetween: {
    width: 36,
    height: 52,
    marginTop: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addHopButton: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 4,
    marginBottom: 16,
  },
  addHopText: {
    fontFamily,
    fontSize: 14,
    fontWeight: '600',
    color: ACCENT,
  },
  pathPreview: {
    fontFamily,
    fontSize: 13,
    color: '#6b6b6b',
    marginBottom: 14,
  },
  actionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  transferButton: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: ACCENT,
    borderRadius: 10,
    paddingHorizontal: 18,
    paddingVertical: 12,
    minHeight: 44,
  },
  transferButtonDisabled: {
    opacity: 0.45,
  },
  transferButtonText: {
    fontFamily,
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
  },
  pdfButton: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    minHeight: 44,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: ACCENT,
    backgroundColor: '#EEF7FB',
  },
  pdfButtonText: {
    fontFamily,
    fontSize: 15,
    fontWeight: '700',
    color: ACCENT,
  },
  statusText: {
    fontFamily,
    fontSize: 13,
    color: '#1F7A9A',
    marginTop: 8,
    marginBottom: 8,
  },
  planSection: {
    marginTop: 16,
    gap: 12,
  },
  modeBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: '#F7FBFC',
    borderRadius: 10,
    padding: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#D7E8EF',
  },
  modeBannerText: {
    flex: 1,
    fontFamily,
    fontSize: 13,
    lineHeight: 18,
    color: '#355A68',
  },
  sectionTitle: {
    fontFamily,
    fontSize: 14,
    fontWeight: '700',
    color: '#1a1a1a',
    marginBottom: 8,
  },
  splitsCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e6e6e6',
    borderRadius: 12,
    padding: 12,
    backgroundColor: '#fff',
  },
  splitsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  splitsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  splitsCorner: {
    width: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  splitsHeaderText: {
    fontFamily,
    fontSize: 10,
    fontWeight: '700',
    color: '#8a8a8a',
    textTransform: 'uppercase',
  },
  splitsCell: {
    flex: 1,
    minWidth: 56,
    paddingHorizontal: 2,
  },
  tierLabel: {
    fontFamily,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'capitalize',
  },
  priorityDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  percentFieldWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  percentInput: {
    fontFamily,
    flex: 1,
    minWidth: 0,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#dcdcdc',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
    fontSize: 13,
    color: '#1a1a1a',
    backgroundColor: '#fff',
  },
  percentInputDisabled: {
    backgroundColor: '#f5f5f5',
    color: '#9a9a9a',
  },
  percentSuffix: {
    fontFamily,
    fontSize: 11,
    color: '#8a8a8a',
  },
  skippedText: {
    fontFamily,
    fontSize: 12,
    color: '#9a9a9a',
    paddingVertical: 6,
  },
  resetLink: {
    alignSelf: 'flex-start',
    marginTop: -4,
  },
  resetLinkText: {
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
    color: ACCENT,
  },
  stopCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e0e0e0',
    borderRadius: 12,
    padding: 12,
    backgroundColor: '#fff',
    gap: 8,
  },
  stopHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 2,
    paddingBottom: 8,
    borderBottomWidth: 2,
    borderBottomColor: '#1a1a1a',
  },
  stopTitle: {
    fontFamily,
    fontSize: 16,
    fontWeight: '700',
    color: '#1a1a1a',
  },
  tableBlock: {
    marginTop: 4,
  },
  tableCaption: {
    fontFamily,
    fontSize: 11,
    fontWeight: '700',
    color: '#6b6b6b',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 6,
  },
  tableHead: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    paddingVertical: 7,
    paddingHorizontal: 8,
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ececec',
  },
  th: {
    fontFamily,
    fontSize: 10,
    fontWeight: '700',
    color: '#8a8a8a',
    textTransform: 'uppercase',
  },
  thProduct: {
    flex: 1.4,
    minWidth: 0,
  },
  thQty: {
    width: 52,
    textAlign: 'right',
  },
  thPartner: {
    flex: 1,
    minWidth: 0,
    paddingLeft: 8,
  },
  td: {
    fontFamily,
    fontSize: 13,
    color: '#1a1a1a',
  },
  tdText: {
    fontFamily,
    fontSize: 13,
    color: '#1a1a1a',
  },
  qtyText: {
    fontFamily,
    fontSize: 13,
    fontWeight: '700',
    color: '#1a1a1a',
    textAlign: 'right',
  },
  haveText: {
    fontFamily,
    fontSize: 13,
    fontWeight: '500',
    color: '#6b6b6b',
    textAlign: 'right',
  },
  qtyInput: {
    fontFamily,
    width: '100%',
    minWidth: 44,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#d0d0d0',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 5,
    fontSize: 13,
    fontWeight: '700',
    color: '#1a1a1a',
    textAlign: 'right',
    backgroundColor: '#fff',
  },
  qtyInputCompact: {
    paddingVertical: 4,
  },
  productCell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  noneLine: {
    fontFamily,
    fontSize: 12,
    color: '#9a9a9a',
  },
  stayToggle: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
    paddingVertical: 6,
    paddingHorizontal: 2,
  },
  stayToggleText: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: ACCENT,
  },
  stayStatus: {
    fontFamily,
    fontSize: 12,
    color: '#6b6b6b',
  },
  emptyPlan: {
    fontFamily,
    fontSize: 13,
    color: '#6b6b6b',
    paddingVertical: 8,
  },
  tableRowActive: {
    backgroundColor: '#EEF7FB',
  },
  itemOverrideCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#D7E8EF',
    borderRadius: 12,
    padding: 12,
    backgroundColor: '#F7FBFC',
    gap: 8,
  },
  itemOverrideHint: {
    fontFamily,
    fontSize: 12,
    color: '#8a8a8a',
  },
  itemOverrideTitle: {
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
    color: '#6b6b6b',
  },
  itemOverrideGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  itemOverrideCell: {
    width: '47%',
    minWidth: 120,
    gap: 4,
  },
  itemOverrideLabel: {
    fontFamily,
    fontSize: 11,
    color: '#8a8a8a',
  },
  signInTitle: {
    fontFamily,
    fontSize: 18,
    fontWeight: '700',
    color: '#1a1a1a',
    marginTop: 16,
    marginHorizontal: 20,
  },
  signInBody: {
    fontFamily,
    fontSize: 14,
    color: '#6b6b6b',
    marginTop: 8,
    marginHorizontal: 20,
    lineHeight: 20,
  },
  signInButton: {
    alignSelf: 'flex-start',
    marginTop: 16,
    marginHorizontal: 20,
    backgroundColor: ACCENT,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  signInButtonText: {
    fontFamily,
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
});
