import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { fetchTransferStores } from '../api/locations';
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
} from '../api/transferPlan';

const fontFamily = Platform.select({
  ios: 'Sohne',
  android: 'Sohne',
  default: 'Sohne',
});

const ACCENT = '#1F7A9A';
const MIN_STOPS = 2;
const HAIRLINE = '#e6e6e6';

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
  const [activeTab, setActiveTab] = useState('create');
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
      <View style={styles.signInWrap}>
        <Text style={styles.signInTitle}>Sign in required</Text>
        <Text style={styles.signInBody}>
          Log in from Profile to choose stores and create a transfer route.
        </Text>
        {onRequireLogin ? (
          <Pressable style={styles.signInButton} onPress={onRequireLogin}>
            <Text style={styles.signInButtonText}>Go to Profile</Text>
          </Pressable>
        ) : null}
      </View>
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
      {activeTab === 'create' ? createBody : <EmptyTab tab={currentTab} />}
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
