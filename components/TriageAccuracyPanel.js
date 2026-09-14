import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { MOBILE, mobileSafeBottom, mobileSafeTop, useIsMobile } from '../lib/mobileUi';
import {
  collectAccuracyTriagePos,
  saveTriagePoReview,
  applyTriageReviewToPo,
  clearTriagePoReview,
  triagePoNeedsCorrection,
  useTransferWorkflow,
} from '../lib/transferWorkflow';
import {
  ColumnFilter,
  matchesSelectedLabel,
  PoThumb,
  selectedLabels,
  TableActions,
  TableActionsHead,
  TableCell,
  TableDeleteButton,
  TableEmpty,
  TableFrame,
  TableMuted,
  TablePhotoCell,
  TableRow,
  TableRowMain,
  TableRowPressable,
  TableStrong,
  uniqueLabels,
} from './TriageTable';
import TriageReviewDrawer from './TriageReviewDrawer';

const fontFamily = Platform.select({
  ios: 'Sohne',
  android: 'Sohne',
  default: 'Sohne',
});

const TEXT = '#1d1d1f';
const SECONDARY = '#8e8e93';
const GREEN = '#34C759';
const RED = '#FF3B30';
const ORANGE = '#FF9500';
const BLUE = MOBILE.blue;
const HAIRLINE = 'rgba(60, 60, 67, 0.18)';
const DRAWER_OPEN_MS = 280;
const DRAWER_CLOSE_MS = 220;

const ACCURACY_TABS = [
  { key: 'correct', label: 'Correct' },
  { key: 'incorrect', label: 'Incorrect' },
];

const EMPTY_FILTERS = {
  reference: [],
  dateLabel: [],
  person: [],
  store: [],
  received: [],
  errorType: [],
  errorAmount: [],
};

function namesMatch(a, b) {
  return (
    String(a || '')
      .trim()
      .localeCompare(String(b || '').trim(), undefined, { sensitivity: 'base' }) === 0
  );
}

function staffName(row) {
  const name = String(row?.employeeName || '').trim();
  return name && name !== '—' ? name : '';
}

function errorPlace(row) {
  const type = String(row?.review?.errorType || '').trim();
  if (type) return type;
  const corrections = Array.isArray(row?.review?.corrections) ? row.review.corrections : [];
  if (corrections.length) {
    const labels = corrections.map((item) => String(item?.label || '').toLowerCase());
    if (labels.some((label) => /\bqty\b|quantity/.test(label))) return 'Wrong quantity';
    if (labels.some((label) => /price|amount|unit/.test(label))) return 'Wrong price';
    if (labels.some((label) => /customer|client/.test(label))) return 'Wrong customer';
    if (labels.some((label) => /payment/.test(label))) return 'Wrong payment';
    if (labels.some((label) => /name|item/.test(label))) return 'Wrong item';
    return corrections[0].label || 'Unspecified';
  }
  if (String(row?.review?.note || '').trim()) return 'Note only';
  return 'Unspecified';
}

function countRanks(rows, getLabel) {
  const counts = new Map();
  for (const row of rows) {
    const label = String(getLabel(row) || '').trim();
    if (!label || label === '—') continue;
    const key = label.toLowerCase();
    const current = counts.get(key);
    if (current) current.count += 1;
    else counts.set(key, { label, count: 1 });
  }
  const total = rows.length || 1;
  return [...counts.values()]
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }))
    .map((row) => ({ ...row, pct: Math.round((row.count / total) * 100) }));
}

function formatPct(value) {
  if (!Number.isFinite(value)) return '—';
  return `${Math.round(value)}%`;
}

function accuracyTint(pct) {
  if (pct >= 90) return GREEN;
  if (pct >= 75) return ORANGE;
  return RED;
}

function rowMatchesSharedFilters(row, filters) {
  return (
    matchesSelectedLabel(row.reference, filters.reference) &&
    matchesSelectedLabel(row.dateLabel, filters.dateLabel) &&
    matchesSelectedLabel(staffName(row), filters.person) &&
    matchesSelectedLabel(row.storeName, filters.store) &&
    matchesSelectedLabel(row.triageDateLabel, filters.received)
  );
}

function rowMatchesErrorFilters(row, filters) {
  return (
    matchesSelectedLabel(row.review?.errorType, filters.errorType) &&
    matchesSelectedLabel(row.review?.errorAmount, filters.errorAmount)
  );
}

function filtersAreActive(filters) {
  return Object.values(filters).some((value) => selectedLabels(value).length > 0);
}

function scopeCaption(filters, storeFilter) {
  const parts = [];
  const push = (values) => {
    for (const value of selectedLabels(values)) {
      if (!parts.some((part) => namesMatch(part, value))) parts.push(value);
    }
  };
  if (storeFilter) parts.push(storeFilter);
  push(filters.store);
  push(filters.person);
  push(filters.dateLabel);
  push(filters.received);
  push(filters.reference);
  return parts.slice(0, 3).join(' · ') || 'All purchases';
}

function useHeldValue(value) {
  const held = useRef(value);
  if (value != null) held.current = value;
  return value ?? held.current;
}

function useRightDrawerAnimation(visible, slideDistance) {
  const [mounted, setMounted] = useState(visible);
  const slide = useRef(new Animated.Value(slideDistance)).current;
  const backdrop = useRef(new Animated.Value(0)).current;
  const slideDistanceRef = useRef(slideDistance);
  const opened = useRef(visible);
  slideDistanceRef.current = slideDistance;

  useEffect(() => {
    if (visible) {
      opened.current = true;
      setMounted(true);
      slide.setValue(slideDistanceRef.current);
      backdrop.setValue(0);
      const anim = Animated.parallel([
        Animated.timing(slide, {
          toValue: 0,
          duration: DRAWER_OPEN_MS,
          easing: Easing.bezier(0.22, 1, 0.36, 1),
          useNativeDriver: true,
        }),
        Animated.timing(backdrop, {
          toValue: 1,
          duration: DRAWER_OPEN_MS,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
      ]);
      anim.start();
      return () => anim.stop();
    }

    if (!opened.current) return undefined;

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
    const timeout = setTimeout(() => setMounted(false), DRAWER_CLOSE_MS + 32);
    anim.start(() => setMounted(false));
    return () => {
      anim.stop();
      clearTimeout(timeout);
    };
  }, [visible, slide, backdrop]);

  return { mounted, slide, backdrop };
}

function EmptyState({ icon, title, body }) {
  return (
    <View style={styles.empty}>
      <Ionicons name={icon} size={40} color={SECONDARY} />
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
    </View>
  );
}

function AccuracyTabs({ value, onChange, trailing }) {
  return (
    <View style={styles.listChrome} accessibilityRole="tablist">
      <View style={styles.textTabs}>
        {ACCURACY_TABS.map((tab) => {
          const active = tab.key === value;
          return (
            <Pressable
              key={tab.key}
              style={styles.textTab}
              onPress={() => onChange(tab.key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={tab.label}
            >
              <Text style={[styles.textTabLabel, active && styles.textTabLabelActive]} numberOfLines={1}>
                {tab.label}
              </Text>
              <View style={[styles.textTabLine, active && styles.textTabLineActive]} />
            </Pressable>
          );
        })}
      </View>
      {trailing ? <View style={styles.listChromeTrailing}>{trailing}</View> : null}
    </View>
  );
}

function InsightSplit({ correctCount, incorrectCount }) {
  const total = correctCount + incorrectCount;
  return (
    <View style={styles.splitTrack} accessibilityLabel="Correct versus incorrect split">
      <View
        style={[
          styles.splitFill,
          { flex: total ? correctCount : 1, backgroundColor: GREEN },
        ]}
      />
      <View
        style={[
          styles.splitFill,
          { flex: total ? incorrectCount : 0, backgroundColor: RED },
        ]}
      />
    </View>
  );
}

function AccuracyInsights({ scoped, activeTab, caption, mobile, onPersonPress }) {
  const total = scoped.length;
  const incorrectRows = useMemo(
    () => scoped.filter((row) => triagePoNeedsCorrection(row)),
    [scoped],
  );
  const correctCount = total - incorrectRows.length;
  const incorrectCount = incorrectRows.length;
  const accuracyPct = total ? (correctCount / total) * 100 : null;
  const incorrectPct = total ? (incorrectCount / total) * 100 : null;
  const errorRanks = useMemo(() => countRanks(incorrectRows, errorPlace), [incorrectRows]);
  const peopleRanks = useMemo(
    () => countRanks(incorrectRows, (row) => staffName(row) || 'Unknown'),
    [incorrectRows],
  );
  const topError = errorRanks[0] || null;
  const nextError = errorRanks[1] || null;
  const people = peopleRanks.slice(0, 3);
  const viewingIncorrect = activeTab === 'incorrect';

  return (
    <View style={styles.insightsWrap}>
      <View style={[styles.insightsCard, mobile && styles.insightsCardMobile]}>
        <View style={styles.insightsCol}>
          <Text style={styles.insightsKicker}>Accuracy</Text>
          <Text style={[styles.insightsHero, { color: accuracyPct == null ? TEXT : accuracyTint(accuracyPct) }]}>
            {formatPct(accuracyPct)}
          </Text>
          <Text style={styles.insightsSub} numberOfLines={1}>
            {total
              ? `${correctCount} correct · ${incorrectCount} incorrect`
              : 'No matching purchases'}
          </Text>
          <InsightSplit correctCount={correctCount} incorrectCount={incorrectCount} />
          <Text style={styles.insightsCaption} numberOfLines={1}>
            {caption}
          </Text>
        </View>

        <View
          style={[
            styles.insightsCol,
            styles.insightsColSplit,
            mobile && styles.insightsColSplitMobile,
          ]}
        >
          <Text style={styles.insightsKicker}>Errors</Text>
          {topError ? (
            <>
              <Text style={styles.insightsTitle} numberOfLines={1}>
                {topError.label}
              </Text>
              <Text style={styles.insightsSub} numberOfLines={1}>
                {topError.count} of {incorrectCount} · {topError.pct}%
              </Text>
              {nextError ? (
                <Text style={styles.insightsCaption} numberOfLines={1}>
                  Then {nextError.label} · {nextError.pct}%
                </Text>
              ) : (
                <Text style={styles.insightsCaption}>Majority of errors</Text>
              )}
            </>
          ) : (
            <>
              <Text style={styles.insightsTitle}>No errors</Text>
              <Text style={styles.insightsSub}>Nothing to break down yet</Text>
            </>
          )}
        </View>

        <View
          style={[
            styles.insightsCol,
            styles.insightsColSplit,
            mobile && styles.insightsColSplitMobile,
          ]}
        >
          <Text style={styles.insightsKicker}>People</Text>
          {people.length ? (
            people.map((person, index) => (
              <Pressable
                key={person.label}
                style={styles.personRow}
                onPress={() => onPersonPress?.(person.label)}
                accessibilityRole="button"
                accessibilityLabel={`${person.label} error history`}
              >
                <Text style={styles.personRank}>{index + 1}</Text>
                <Text style={styles.personName} numberOfLines={1}>
                  {person.label}
                </Text>
                <Text style={styles.personMeta}>
                  {person.count} · {person.pct}%
                </Text>
                <Ionicons name="chevron-forward" size={14} color="#c7c7cc" />
              </Pressable>
            ))
          ) : (
            <>
              <Text style={styles.insightsTitle}>No errors</Text>
              <Text style={styles.insightsSub}>No staff ranking yet</Text>
            </>
          )}
        </View>
      </View>
      <Text style={styles.viewingLine} numberOfLines={1}>
        {viewingIncorrect
          ? `${incorrectCount} incorrect · ${formatPct(incorrectPct)} of this set`
          : `${correctCount} correct · ${formatPct(accuracyPct)} of this set`}
      </Text>
    </View>
  );
}

function EmployeeErrorDrawer({ visible, name, rows, onClose, onOpenPo }) {
  const { width: windowWidth } = useWindowDimensions();
  const isMobile = windowWidth < 768;
  const panelWidth = isMobile
    ? Math.max(windowWidth, 240)
    : Math.min(Math.max(Math.round(windowWidth * 0.42), 380), Math.round(windowWidth - 64));
  const { mounted, slide, backdrop } = useRightDrawerAnimation(visible, panelWidth);
  const heldName = useHeldValue(name);

  const docs = useMemo(() => {
    if (!heldName) return [];
    return (rows || []).filter((row) => namesMatch(staffName(row) || 'Unknown', heldName));
  }, [heldName, rows]);

  const categories = useMemo(() => countRanks(docs, errorPlace), [docs]);
  const top = categories[0] || null;

  if (!mounted || !heldName) return null;

  return (
    <Modal visible={mounted} transparent animationType="none" onRequestClose={onClose}>
      <View style={styles.drawerRoot} pointerEvents="box-none">
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose}>
          <Animated.View style={[styles.drawerBackdrop, { opacity: backdrop }]} />
        </Pressable>
        <Animated.View
          pointerEvents="auto"
          style={[
            styles.drawerPanel,
            isMobile && styles.drawerPanelMobile,
            { width: panelWidth, transform: [{ translateX: slide }] },
          ]}
        >
          <View
            style={[styles.drawerNav, isMobile && styles.drawerNavMobile]}
            {...(Platform.OS === 'web' && isMobile ? { className: 'cgold-mobile-sheet-top' } : null)}
          >
            <Pressable
              onPress={onClose}
              hitSlop={8}
              style={styles.drawerNavSide}
              accessibilityRole="button"
              accessibilityLabel="Done"
            >
              <Text style={styles.drawerNavAction}>Done</Text>
            </Pressable>
            <Text style={styles.drawerNavTitle} numberOfLines={1}>
              {heldName}
            </Text>
            <View style={styles.drawerNavSide} />
          </View>

          <ScrollView
            style={styles.drawerBody}
            contentContainerStyle={styles.drawerContent}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.historyHero}>
              <Text style={styles.historyHeroCount}>{docs.length}</Text>
              <Text style={styles.historyHeroLabel}>
                {docs.length === 1 ? 'incorrect document' : 'incorrect documents'}
              </Text>
              {top ? (
                <Text style={styles.historyHeroSub} numberOfLines={2}>
                  Mostly {top.label} · {top.pct}% of their errors
                </Text>
              ) : (
                <Text style={styles.historyHeroSub}>No errors in this set</Text>
              )}
            </View>

            <Text style={styles.groupHeader}>Categories</Text>
            <View style={styles.group}>
              {categories.length === 0 ? (
                <Text style={styles.emptyText}>No error categories</Text>
              ) : (
                categories.map((category, index) => (
                  <View
                    key={category.label}
                    style={[styles.historyRow, index === categories.length - 1 && styles.historyRowLast]}
                  >
                    <Text style={styles.personRank}>{index + 1}</Text>
                    <Text style={styles.historyTitle} numberOfLines={1}>
                      {category.label}
                    </Text>
                    <Text style={styles.personMeta}>
                      {category.count} · {category.pct}%
                    </Text>
                  </View>
                ))
              )}
            </View>

            <Text style={styles.groupHeader}>PO / SO</Text>
            <View style={styles.group}>
              {docs.length === 0 ? (
                <Text style={styles.emptyText}>No documents</Text>
              ) : (
                docs.map((row, index) => {
                  const subtitle = [
                    errorPlace(row),
                    row.storeName,
                    row.dateLabel,
                    row.received ? null : 'Not received',
                  ]
                    .filter(Boolean)
                    .join(' · ');
                  return (
                    <Pressable
                      key={`${row.triageId}-${row.id}`}
                      style={[styles.historyDoc, index === docs.length - 1 && styles.historyRowLast]}
                      onPress={() => onOpenPo?.(row)}
                      accessibilityRole="button"
                      accessibilityLabel={`Open ${row.reference}`}
                    >
                      <View style={styles.historyDocText}>
                        <Text style={styles.historyTitle} numberOfLines={1}>
                          {row.reference}
                        </Text>
                        {subtitle ? (
                          <Text style={styles.historySub} numberOfLines={2}>
                            {subtitle}
                          </Text>
                        ) : null}
                      </View>
                      <Ionicons name="chevron-forward" size={16} color="#c7c7cc" />
                    </Pressable>
                  );
                })
              )}
            </View>
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

function AccuracyTableRow({ row, last, showError, onOpen, onDelete }) {
  const review = row.review || {};
  const cells = (
    <>
      <TablePhotoCell>
        <PoThumb urls={row.imageUrls} label={row.reference} />
      </TablePhotoCell>
      <TableCell flex={1.15} minWidth={108}>
        <TableStrong>{row.reference}</TableStrong>
        {showError && !row.received ? <TableMuted>Not received</TableMuted> : null}
      </TableCell>
      <TableCell flex={0.9} minWidth={92}>
        {row.dateLabel}
      </TableCell>
      <TableCell flex={1.15} minWidth={110}>
        {staffName(row)}
      </TableCell>
      <TableCell flex={1.1} minWidth={110}>
        {row.storeName}
      </TableCell>
      {showError ? (
        <>
          <TableCell flex={1} minWidth={110}>
            {review.errorType || errorPlace(row)}
          </TableCell>
          <TableCell flex={0.85} minWidth={88} last={!onDelete}>
            {review.errorAmount}
          </TableCell>
        </>
      ) : (
        <TableCell flex={0.95} minWidth={100} last>
          {row.triageDateLabel}
        </TableCell>
      )}
    </>
  );

  if (!onDelete) {
    return (
      <TableRowPressable
        last={last}
        onPress={() => onOpen(row)}
        accessibilityLabel={`Open ${row.reference}`}
      >
        {cells}
      </TableRowPressable>
    );
  }

  return (
    <TableRow last={last}>
      <TableRowMain onPress={() => onOpen(row)} accessibilityLabel={`Open ${row.reference}`}>
        {cells}
      </TableRowMain>
      <TableActions>
        <TableDeleteButton
          onPress={() => onDelete(row)}
          label={`Delete review for ${row.reference}`}
        />
      </TableActions>
    </TableRow>
  );
}

export default function TriageAccuracyPanel({ session, storeFilter }) {
  const isMobile = useIsMobile();
  const { triage } = useTransferWorkflow();
  const [activeTab, setActiveTab] = useState('correct');
  const [openRow, setOpenRow] = useState(null);
  const [openPerson, setOpenPerson] = useState(null);
  const [openFilter, setOpenFilter] = useState(null);
  const [filters, setFilters] = useState(EMPTY_FILTERS);

  const accuracyRows = useMemo(() => {
    const rows = collectAccuracyTriagePos(triage);
    if (!storeFilter) return rows;
    return rows.filter((row) => namesMatch(row.storeName, storeFilter));
  }, [storeFilter, triage]);

  const showError = activeTab === 'incorrect';
  const filtersActive = filtersAreActive(filters);

  const setFilter = useCallback((key, value) => {
    setFilters((current) => ({ ...current, [key]: value }));
  }, []);

  const changeTab = useCallback((key) => {
    setActiveTab(key);
    setOpenFilter(null);
  }, []);

  const clearFilters = useCallback(() => {
    setFilters(EMPTY_FILTERS);
    setOpenFilter(null);
  }, []);

  const scoped = useMemo(
    () => accuracyRows.filter((row) => rowMatchesSharedFilters(row, filters)),
    [accuracyRows, filters],
  );

  const incorrectScoped = useMemo(
    () => scoped.filter((row) => triagePoNeedsCorrection(row)),
    [scoped],
  );

  const source = useMemo(
    () =>
      scoped.filter((row) =>
        showError ? triagePoNeedsCorrection(row) : Boolean(row.received) && !triagePoNeedsCorrection(row),
      ),
    [scoped, showError],
  );

  const visible = useMemo(
    () => (showError ? source.filter((row) => rowMatchesErrorFilters(row, filters)) : source),
    [filters, showError, source],
  );

  const optionsFor = useCallback(
    (key, getValue, rows = accuracyRows) => {
      const relaxed = { ...filters, [key]: [] };
      return uniqueLabels(
        rows
          .filter((row) => {
            if (!rowMatchesSharedFilters(row, relaxed)) return false;
            if (showError && (key === 'errorType' || key === 'errorAmount')) {
              return triagePoNeedsCorrection(row) && rowMatchesErrorFilters(row, relaxed);
            }
            return true;
          })
          .map(getValue),
      );
    },
    [filters, accuracyRows, showError],
  );

  const referenceOptions = useMemo(
    () => optionsFor('reference', (row) => row.reference),
    [optionsFor],
  );
  const dateOptions = useMemo(() => optionsFor('dateLabel', (row) => row.dateLabel), [optionsFor]);
  const personOptions = useMemo(() => optionsFor('person', staffName), [optionsFor]);
  const storeOptions = useMemo(() => optionsFor('store', (row) => row.storeName), [optionsFor]);
  const receivedOptions = useMemo(
    () => optionsFor('received', (row) => row.triageDateLabel),
    [optionsFor],
  );
  const errorTypeOptions = useMemo(
    () => optionsFor('errorType', (row) => row.review?.errorType || errorPlace(row), scoped),
    [optionsFor, scoped],
  );
  const errorAmountOptions = useMemo(
    () => optionsFor('errorAmount', (row) => row.review?.errorAmount, scoped),
    [optionsFor, scoped],
  );

  const saveReview = useCallback((poId, review) => {
    saveTriagePoReview(poId, review);
    setOpenRow((current) => (current?.id === poId ? applyTriageReviewToPo(current, review) : current));
  }, []);

  const deleteReview = useCallback((row) => {
    if (!row?.id) return;
    clearTriagePoReview(row.id);
    setOpenRow((current) => (current?.id === row.id ? null : current));
  }, []);

  if (accuracyRows.length === 0) {
    return (
      <View style={[styles.body, styles.bodyTinted]}>
        <EmptyState
          icon="checkmark-done-outline"
          title="Accuracy"
          body="Received POs and reviewed corrections will appear here."
        />
      </View>
    );
  }

  return (
    <View style={[styles.body, styles.bodyTinted]}>
      <AccuracyInsights
        scoped={scoped}
        activeTab={activeTab}
        caption={scopeCaption(filters, storeFilter)}
        mobile={isMobile}
        onPersonPress={setOpenPerson}
      />
      <AccuracyTabs
        value={activeTab}
        onChange={changeTab}
        trailing={
          <>
            <Text style={styles.listMeta}>
              {visible.length}
              {visible.length !== source.length ? ` of ${source.length}` : ''}
              {' '}
              {source.length === 1 ? 'document' : 'documents'}
            </Text>
            {filtersActive ? (
              <Pressable
                onPress={clearFilters}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Clear filters"
              >
                <Text style={styles.clearFilters}>Clear Filters</Text>
              </Pressable>
            ) : null}
          </>
        }
      />

          <TableFrame
            minWidth={showError ? 900 : 720}
            header={
              <>
                <TablePhotoCell />
                <ColumnFilter
                  columnKey="reference"
                  label="PO / SO"
                  value={filters.reference}
                  onChange={(value) => setFilter('reference', value)}
                  options={referenceOptions}
                  openKey={openFilter}
                  onOpenKey={setOpenFilter}
                  style={{ flex: 1.15, minWidth: 108 }}
                />
                <ColumnFilter
                  columnKey="dateLabel"
                  label="Date"
                  value={filters.dateLabel}
                  onChange={(value) => setFilter('dateLabel', value)}
                  options={dateOptions}
                  openKey={openFilter}
                  onOpenKey={setOpenFilter}
                  style={{ flex: 0.9, minWidth: 92 }}
                />
                <ColumnFilter
                  columnKey="person"
                  label="Person"
                  value={filters.person}
                  onChange={(value) => setFilter('person', value)}
                  options={personOptions}
                  openKey={openFilter}
                  onOpenKey={setOpenFilter}
                  style={{ flex: 1.15, minWidth: 110 }}
                />
                <ColumnFilter
                  columnKey="store"
                  label="Store"
                  value={filters.store}
                  onChange={(value) => setFilter('store', value)}
                  options={storeOptions}
                  openKey={openFilter}
                  onOpenKey={setOpenFilter}
                  style={{ flex: 1.1, minWidth: 110 }}
                />
                {showError ? (
                  <>
                    <ColumnFilter
                      columnKey="errorType"
                      label="Error"
                      value={filters.errorType}
                      onChange={(value) => setFilter('errorType', value)}
                      options={errorTypeOptions}
                      openKey={openFilter}
                      onOpenKey={setOpenFilter}
                      style={{ flex: 1, minWidth: 110 }}
                    />
                    <ColumnFilter
                      columnKey="errorAmount"
                      label="Amount"
                      value={filters.errorAmount}
                      onChange={(value) => setFilter('errorAmount', value)}
                      options={errorAmountOptions}
                      openKey={openFilter}
                      onOpenKey={setOpenFilter}
                      align="end"
                      style={{ flex: 0.85, minWidth: 88 }}
                    />
                    <TableActionsHead />
                  </>
                ) : (
                  <ColumnFilter
                    columnKey="received"
                    label="Received"
                    value={filters.received}
                    onChange={(value) => setFilter('received', value)}
                    options={receivedOptions}
                    openKey={openFilter}
                    onOpenKey={setOpenFilter}
                    align="end"
                    style={{ flex: 0.95, minWidth: 100 }}
                  />
                )}
              </>
            }
          >
            {visible.length === 0 ? (
              <TableEmpty>
                {source.length === 0
                  ? showError
                    ? 'No incorrect purchases in this set.'
                    : 'No correct purchases in this set.'
                  : 'No PO or SO matches that column filter.'}
              </TableEmpty>
            ) : (
              visible.map((row, index) => (
                <AccuracyTableRow
                  key={`${row.triageId}-${row.id}`}
                  row={row}
                  last={index === visible.length - 1}
                  showError={showError}
                  onDelete={showError ? deleteReview : undefined}
                  onOpen={(item) => {
                    setOpenFilter(null);
                    setOpenRow(item);
                  }}
                />
              ))
            )}
          </TableFrame>

          <EmployeeErrorDrawer
            visible={Boolean(openPerson)}
            name={openPerson}
            rows={incorrectScoped}
            onClose={() => setOpenPerson(null)}
            onOpenPo={(row) => setOpenRow(row)}
          />
          <TriageReviewDrawer
            visible={Boolean(openRow)}
            session={session}
            row={openRow}
            review={openRow?.review || null}
            extraRows={accuracyRows}
            onClose={() => setOpenRow(null)}
            onSave={saveReview}
          />
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    minHeight: 0,
  },
  bodyTinted: {
    backgroundColor: MOBILE.bg,
  },
  insightsWrap: {
    flexShrink: 0,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
    gap: 10,
  },
  insightsCard: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 12,
    overflow: 'hidden',
    ...Platform.select({
      web: { boxShadow: '0 1px 2px rgba(0,0,0,0.04)' },
      default: {},
    }),
  },
  insightsCardMobile: {
    flexDirection: 'column',
  },
  insightsCol: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 4,
  },
  insightsColSplit: {
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: HAIRLINE,
  },
  insightsColSplitMobile: {
    borderLeftWidth: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: HAIRLINE,
  },
  insightsKicker: {
    fontFamily,
    fontSize: 11,
    fontWeight: '600',
    color: SECONDARY,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  insightsHero: {
    fontFamily,
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: -0.8,
  },
  insightsTitle: {
    fontFamily,
    fontSize: 17,
    fontWeight: '600',
    color: TEXT,
    letterSpacing: -0.3,
  },
  insightsSub: {
    fontFamily,
    fontSize: 13,
    color: TEXT,
    letterSpacing: -0.08,
  },
  insightsCaption: {
    fontFamily,
    fontSize: 12,
    color: SECONDARY,
  },
  splitTrack: {
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
    flexDirection: 'row',
    backgroundColor: '#e5e5ea',
    marginTop: 4,
    marginBottom: 2,
  },
  splitFill: {
    minWidth: 0,
  },
  personRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 26,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  personRank: {
    fontFamily,
    width: 12,
    fontSize: 12,
    fontWeight: '600',
    color: SECONDARY,
  },
  personName: {
    fontFamily,
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    fontWeight: '600',
    color: TEXT,
    letterSpacing: -0.08,
  },
  personMeta: {
    fontFamily,
    fontSize: 12,
    color: SECONDARY,
    fontVariant: ['tabular-nums'],
  },
  viewingLine: {
    fontFamily,
    fontSize: 12,
    color: SECONDARY,
    paddingHorizontal: 4,
    paddingTop: 2,
  },
  listChrome: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 8,
    backgroundColor: MOBILE.bg,
  },
  listChromeTrailing: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingBottom: 8,
  },
  listMeta: {
    fontFamily,
    fontSize: 13,
    fontWeight: '400',
    color: SECONDARY,
  },
  textTabs: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 16,
  },
  textTab: {
    paddingTop: 4,
    alignItems: 'center',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  textTabLabel: {
    fontFamily,
    fontSize: 13,
    fontWeight: '400',
    color: MOBILE.secondary,
    letterSpacing: -0.2,
  },
  textTabLabelActive: {
    fontWeight: '600',
    color: MOBILE.blue,
  },
  textTabLine: {
    marginTop: 6,
    height: 2,
    alignSelf: 'stretch',
    borderRadius: 1,
    backgroundColor: 'transparent',
  },
  textTabLineActive: {
    backgroundColor: MOBILE.blue,
  },
  clearFilters: {
    fontFamily,
    fontSize: 13,
    fontWeight: '400',
    color: BLUE,
  },
  empty: {
    flex: 1,
    minHeight: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 24,
    paddingBottom: 48,
  },
  emptyTitle: {
    fontFamily,
    fontSize: 22,
    fontWeight: '600',
    color: TEXT,
    letterSpacing: -0.4,
  },
  emptyBody: {
    fontFamily,
    fontSize: 15,
    lineHeight: 21,
    color: SECONDARY,
    textAlign: 'center',
    maxWidth: 320,
  },
  drawerRoot: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  drawerBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.28)',
  },
  drawerPanel: {
    height: '100%',
    backgroundColor: MOBILE.bg,
    ...Platform.select({
      web: { boxShadow: '-12px 0 32px rgba(0,0,0,0.18)' },
      default: { elevation: 12 },
    }),
  },
  drawerPanelMobile: {
    paddingBottom: Platform.OS === 'ios' ? Math.max(20, mobileSafeBottom()) : 12,
  },
  drawerNav: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 52,
    paddingHorizontal: 8,
    backgroundColor: 'rgba(242,242,247,0.94)',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HAIRLINE,
  },
  drawerNavMobile: {
    paddingTop: Platform.OS === 'ios' ? mobileSafeTop() - 12 : 6,
  },
  drawerNavSide: {
    width: 72,
    minHeight: 44,
    justifyContent: 'center',
  },
  drawerNavAction: {
    fontFamily,
    fontSize: 17,
    fontWeight: '600',
    color: BLUE,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  drawerNavTitle: {
    fontFamily,
    flex: 1,
    fontSize: 17,
    fontWeight: '600',
    color: TEXT,
    textAlign: 'center',
    letterSpacing: -0.3,
  },
  drawerBody: {
    flex: 1,
    minHeight: 0,
  },
  drawerContent: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 32,
  },
  historyHero: {
    paddingHorizontal: 4,
    paddingTop: 12,
    paddingBottom: 8,
    gap: 4,
  },
  historyHeroCount: {
    fontFamily,
    fontSize: 34,
    fontWeight: '700',
    color: TEXT,
    letterSpacing: -1,
  },
  historyHeroLabel: {
    fontFamily,
    fontSize: 17,
    fontWeight: '600',
    color: TEXT,
  },
  historyHeroSub: {
    fontFamily,
    fontSize: 15,
    color: SECONDARY,
  },
  groupHeader: {
    fontFamily,
    fontSize: 13,
    fontWeight: '400',
    color: SECONDARY,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginTop: 18,
    marginBottom: 6,
    marginLeft: 4,
  },
  group: {
    backgroundColor: '#fff',
    borderRadius: 12,
    overflow: 'hidden',
  },
  emptyText: {
    fontFamily,
    fontSize: 16,
    color: SECONDARY,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 44,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HAIRLINE,
  },
  historyRowLast: {
    borderBottomWidth: 0,
  },
  historyDoc: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 56,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HAIRLINE,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  historyDocText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  historyTitle: {
    fontFamily,
    flex: 1,
    minWidth: 0,
    fontSize: 17,
    fontWeight: '400',
    color: TEXT,
  },
  historySub: {
    fontFamily,
    fontSize: 13,
    color: SECONDARY,
  },
});
