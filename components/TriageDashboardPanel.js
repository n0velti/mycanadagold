/**
 * Triage dashboard: store tiles on home, then Overview / Lots / Errors / Analytics in a store.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import {
  applyTriageReviewToPo,
  collectAccuracyTriagePos,
  collectAllTriagePos,
  deleteTriageDocument,
  persistTransferWorkflowNow,
  saveTriagePoReview,
  triageEditorFromSession,
  triagePoNeedsCorrection,
  useTransferWorkflow,
} from '../lib/transferWorkflow';
import {
  formatFineProgress,
  groupPosIntoLots,
  LOT_FINE_METALS,
  lotMatchesQuery,
  lotPeriodLabel,
  summarizeLotsFineMetals,
} from '../lib/triageLots';
import { formatAmount } from '../lib/transactions';
import { formatErrorAmount } from '../lib/triageDraft';
import { formatInsightPercent } from '../lib/triageInsights';
import { storesMatch } from '../lib/storeCatalog';
import { storeMarkColor } from '../lib/storeMarks';
import {
  backfillTriageErrorBuyers,
  errorEmployeeName,
  listStoreErrorCounts,
  poInStore,
  summarizeStoreErrors,
} from '../lib/triageStoreErrors';
import { CANVAS, MOBILE, MOBILE_FILTER_INSET, NAV_TAB_ACTIVE_RADIUS, useIsMobile } from '../lib/mobileUi';
import { mobileTabBarReserve, useMobileTabBarScrollProps } from '../lib/mobileTabBar';
import {
  ChromeHero,
  ChromeListRow,
  ChromePage,
  EmptyState,
  FONT,
  FONT_LIGHT,
  ProgressBar,
  T,
  TextAction,
  TextTabs,
  TriageDrawer,
  confirmDestructive,
} from './TriageKit';
import { PoThumb } from './TriageTable';
import TriageReviewDrawer from './TriageReviewDrawer';
import { PoErrorSummaryPage } from './TriagePoCapture';

const fontFamily = FONT;

if (Platform.OS === 'web' && typeof document !== 'undefined') {
  const styleId = 'cgold-triage-dash-cards';
  let style = document.getElementById(styleId);
  if (!style) {
    style = document.createElement('style');
    style.id = styleId;
    document.head.appendChild(style);
  }
  style.textContent = [
    '.cgold-dash-card{cursor:pointer;}',
    '.cgold-dash-card:hover{background-color:#f5f5f5!important;}',
    '.cgold-dash-row{cursor:pointer;}',
    '.cgold-dash-row:hover{background-color:#f5f5f5!important;}',
    '.cgold-triage-store-tile{cursor:pointer;}',
    '.cgold-triage-store-tile:hover{background-color:#F2F2F7!important;}',
  ].join('');
}

function staffName(row) {
  const name = errorEmployeeName(row);
  return name && name !== 'Unspecified' && name !== '—' ? name : '';
}

function errorTypeOf(row) {
  const type = String(row?.review?.errorType || '').trim();
  if (type && !/^notes?\s+only$/i.test(type)) return type;
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
  return 'Unspecified';
}

function errorAmountOf(row) {
  return Number(String(row?.review?.errorAmount || '').replace(/[^0-9.-]/g, '')) || 0;
}

function rankCounts(rows, getLabel) {
  const counts = new Map();
  for (const row of rows || []) {
    const label = String(getLabel(row) || '').trim() || 'Unspecified';
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], undefined, { sensitivity: 'base' }))
    .map(([label, count]) => ({ label, count }));
}

function summarizeErrors(rows) {
  const errors = (rows || []).filter(triagePoNeedsCorrection);
  const types = rankCounts(errors, errorTypeOf);
  const amount = errors.reduce((sum, row) => sum + errorAmountOf(row), 0);
  const stores = new Set(errors.map((row) => String(row.storeName || '').trim()).filter((name) => name && name !== '—'));
  return {
    rows: errors,
    count: errors.length,
    amount,
    stores: stores.size,
    topType: types[0] || null,
    types,
  };
}

function lotProgressOf(lot) {
  const expected = Number(lot?.expected) || 0;
  const evaluated = Number(lot?.evaluated) || 0;
  const percent = expected ? Math.round((evaluated / expected) * 100) : 0;
  return { expected, evaluated, percent, done: expected > 0 && evaluated >= expected };
}

function summarizeLots(lots) {
  let expected = 0;
  let evaluated = 0;
  for (const lot of lots || []) {
    expected += Number(lot.expected) || 0;
    evaluated += Number(lot.evaluated) || 0;
  }
  return {
    lots: (lots || []).length,
    expected,
    evaluated,
    percent: expected ? Math.round((evaluated / expected) * 100) : 0,
  };
}

function matchesQuery(row, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  return [
    row.reference,
    staffName(row),
    row.storeName,
    row.dateLabel,
    row.customerName,
    errorTypeOf(row),
    row.review?.note,
    row.review?.errorAmount,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .includes(q);
}

export const ERROR_LIST_SORTS = [
  { key: 'recent', label: 'Most recent added' },
  { key: 'oldest', label: 'Oldest added' },
  { key: 'date-new', label: 'By date, newest' },
  { key: 'date-old', label: 'By date, oldest' },
];

function timeOf(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function errorAddedTime(row) {
  return (
    timeOf(row?.review?.editedAt) ||
    timeOf(row?.review?.editedBy?.at) ||
    timeOf(row?.updatedAt) ||
    timeOf(row?.addedAt) ||
    timeOf(row?.createdAt) ||
    timeOf(row?.receivedAt) ||
    0
  );
}

function errorDocumentTime(row) {
  return timeOf(row?.date) || timeOf(row?.dateLabel) || 0;
}

function sortErrorRows(rows, sort) {
  const list = [...(rows || [])];
  const ref = (row) => String(row?.reference || '');
  list.sort((a, b) => {
    let delta = 0;
    if (sort === 'oldest') delta = errorAddedTime(a) - errorAddedTime(b);
    else if (sort === 'date-new') delta = errorDocumentTime(b) - errorDocumentTime(a);
    else if (sort === 'date-old') delta = errorDocumentTime(a) - errorDocumentTime(b);
    else delta = errorAddedTime(b) - errorAddedTime(a);
    if (delta) return delta;
    return ref(a).localeCompare(ref(b));
  });
  return list;
}

function emptyCopy(text) {
  return <Text style={styles.emptyCopy}>{text}</Text>;
}

function nextStoreSort(current, column) {
  const text = column === 'store' || column === 'type';
  if (current.key !== column) {
    return { key: column, dir: text ? 'asc' : 'desc' };
  }
  if (text) {
    if (current.dir === 'asc') return { key: column, dir: 'desc' };
    return { key: null, dir: 'default' };
  }
  if (current.dir === 'desc') return { key: column, dir: 'asc' };
  return { key: null, dir: 'default' };
}

function StoreTableHeaderCell({ label, column, sortKey, sortDir, onSort, align = 'start', style }) {
  const active = sortKey === column;
  return (
    <Pressable
      onPress={() => onSort(column)}
      style={[styles.storeHeadBtn, align === 'end' && styles.storeHeadBtnEnd, style]}
      accessibilityRole="button"
      accessibilityLabel={`${label}, sort`}
    >
      <Text style={[styles.storeHeadText, active && styles.storeHeadTextOn]}>{label}</Text>
      {active ? (
        <Ionicons name={sortDir === 'asc' ? 'chevron-up' : 'chevron-down'} size={12} color={MOBILE.label} />
      ) : null}
    </Pressable>
  );
}

const HOME_GRID_MAX_WIDTH = 1480;
const HOME_SORT_CHIPS = [
  { key: 'store', label: 'Store' },
  { key: 'errors', label: 'Errors' },
  { key: 'amount', label: 'Amount' },
  { key: 'accuracy', label: 'Accuracy' },
  { key: 'type', label: 'Top type' },
];

function storeAccuracy(row) {
  const evaluated = Number(row?.evaluated) || 0;
  if (!evaluated) return null;
  return Math.max(0, (evaluated - (Number(row?.count) || 0)) / evaluated);
}

function tileSortIcon(column, sortKey, sortDir) {
  if (sortKey !== column || sortDir === 'default') return 'swap-vertical';
  return sortDir === 'asc' ? 'chevron-up' : 'chevron-down';
}

function tileSortLabel(dir, active) {
  if (!active || dir === 'default') return 'default';
  return dir === 'asc' ? 'ascending' : 'descending';
}

function useTriageHomeLayout() {
  const { width } = useWindowDimensions();
  const isMobile = width < 768;
  const pagePad = isMobile ? MOBILE_FILTER_INSET : width >= 1600 ? 24 : width >= 1200 ? 20 : 16;
  const tableMaxWidth = isMobile
    ? undefined
    : Math.min(HOME_GRID_MAX_WIDTH, Math.max(720, width - pagePad * 2));
  return { isMobile, pagePad, tableMaxWidth };
}

function TriageHomeSort({ sortKey, sortDir, onSort, compact = false }) {
  const items = HOME_SORT_CHIPS.map((chip) => {
    const active = sortKey === chip.key && sortDir !== 'default';
    return (
      <Pressable
        key={chip.key}
        onPress={() => onSort(chip.key)}
        style={styles.homeSortItem}
        accessibilityRole="button"
        accessibilityLabel={`Sort by ${chip.label}, ${tileSortLabel(sortDir, active)}`}
      >
        <Text style={[styles.homeSortText, active && styles.homeSortTextActive]}>{chip.label}</Text>
        <Ionicons name={tileSortIcon(chip.key, sortKey, sortDir)} size={13} color={active ? '#1d1d1f' : '#c7c7cc'} />
      </Pressable>
    );
  });
  if (compact) {
    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[styles.homeSortRow, styles.homeSortRowCompact]}
        style={styles.homeSortScroll}
      >
        {items}
      </ScrollView>
    );
  }
  return <View style={styles.homeSortRow}>{items}</View>;
}

function TriageHomeTileStat({ label, value, empty = false, tone = 'neutral' }) {
  return (
    <View style={styles.homeTileStat} accessibilityLabel={empty ? `${label}, none` : `${label} ${value}`}>
      <Text style={styles.homeTileStatLabel}>{label}</Text>
      <Text
        style={[
          styles.homeTileStatValue,
          empty && styles.homeTileStatEmpty,
          tone === 'low' && styles.homeTileStatLow,
          tone === 'high' && styles.homeTileStatHigh,
        ]}
        numberOfLines={1}
      >
        {empty ? '—' : value}
      </Text>
    </View>
  );
}

function TriageHomeStoreTile({ row, selected, loading, onPress }) {
  const errors = Number(row.count) || 0;
  const amount = Number(row.amount) || 0;
  const evaluated = Number(row.evaluated) || 0;
  const accuracy = storeAccuracy(row);
  const flagged = evaluated ? `${errors} of ${evaluated} flagged` : errors ? `${errors} ${errors === 1 ? 'error' : 'errors'}` : 'No errors';
  const split = errors
    ? `${errors === 1 ? '1 error' : `${errors} errors`}${amount ? ` · ${formatAmount(amount)}` : ''}`
    : evaluated
      ? `${evaluated === 1 ? '1 PO evaluated' : `${evaluated} POs evaluated`}`
      : 'No evaluated purchases';
  const accuracyTone = accuracy == null ? 'neutral' : accuracy < 0.8 ? 'low' : 'high';
  return (
    <Pressable
      onPress={onPress}
      style={({ hovered, pressed }) => [
        styles.homeTile,
        (hovered || pressed || selected) && styles.homeTilePressed,
      ]}
      accessibilityRole="button"
      accessibilityLabel={
        loading
          ? `${row.store}, loading`
          : `${row.store}, ${flagged}${accuracy == null ? '' : `, ${formatInsightPercent(accuracy)} accuracy`}`
      }
      {...(Platform.OS === 'web' ? { className: 'cgold-triage-store-tile' } : null)}
    >
      <View style={styles.homeTileTop}>
        <View style={[styles.homeTileIcon, { backgroundColor: storeMarkColor(row.store) }]}>
          <Ionicons name="storefront" size={16} color="#fff" />
        </View>
        <View style={styles.homeTileTitleCol}>
          <Text style={styles.homeTileName} numberOfLines={1}>
            {row.store}
          </Text>
          <Text style={styles.homeTileMeta} numberOfLines={1}>
            {loading ? 'Loading…' : flagged}
          </Text>
        </View>
      </View>
      <View style={styles.homeTileFigures}>
        <Text style={styles.homeTileAmount} numberOfLines={1}>
          {loading || !amount ? '—' : formatAmount(amount)}
        </Text>
        <Text style={styles.homeTileSplit} numberOfLines={1}>
          {loading ? ' ' : split}
        </Text>
      </View>
      <View style={styles.homeTileMetrics}>
        <TriageHomeTileStat label="Errors" value={String(errors)} empty={loading} />
        <TriageHomeTileStat
          label="Accuracy"
          value={accuracy == null ? '—' : formatInsightPercent(accuracy)}
          empty={loading || accuracy == null}
          tone={loading ? 'neutral' : accuracyTone}
        />
        <TriageHomeTileStat
          label="Top type"
          value={row.topType?.label || '—'}
          empty={loading || !row.topType}
        />
      </View>
    </Pressable>
  );
}

function TriageHomeStores({
  rows,
  selectedStore,
  loading,
  query,
  onQueryChange,
  onOpenStore,
  onAdd,
  insetTop = 0,
}) {
  const { isMobile, pagePad, tableMaxWidth } = useTriageHomeLayout();
  const tabBarScroll = useMobileTabBarScrollProps();
  const [sort, setSort] = useState({ key: null, dir: 'default' });
  const sorted = useMemo(() => {
    if (!sort.key || sort.dir === 'default') return rows || [];
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...(rows || [])].sort((a, b) => {
      let delta = 0;
      if (sort.key === 'store') {
        delta = String(a.store || '').localeCompare(String(b.store || ''), undefined, { sensitivity: 'base' });
      } else if (sort.key === 'errors') {
        delta = (Number(a.count) || 0) - (Number(b.count) || 0);
      } else if (sort.key === 'amount') {
        delta = (Number(a.amount) || 0) - (Number(b.amount) || 0);
      } else if (sort.key === 'accuracy') {
        delta = (storeAccuracy(a) ?? -1) - (storeAccuracy(b) ?? -1);
      } else {
        delta = String(a.topType?.label || '').localeCompare(String(b.topType?.label || ''), undefined, {
          sensitivity: 'base',
        });
      }
      return delta
        ? dir * delta
        : String(a.store || '').localeCompare(String(b.store || ''), undefined, { sensitivity: 'base' });
    });
  }, [rows, sort.dir, sort.key]);

  const search = typeof onQueryChange === 'function' ? (
    <View style={[styles.homeSearch, isMobile && styles.homeSearchWide]}>
      <Ionicons name="search-outline" size={16} color={MOBILE.secondary} />
      <TextInput
        style={styles.homeSearchInput}
        value={query}
        onChangeText={onQueryChange}
        placeholder="Search stores"
        placeholderTextColor={MOBILE.secondary}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        clearButtonMode="while-editing"
        accessibilityLabel="Search stores"
      />
      {query ? (
        <Pressable onPress={() => onQueryChange('')} hitSlop={8} accessibilityLabel="Clear store search">
          <Ionicons name="close-circle" size={16} color="#c7c7cc" />
        </Pressable>
      ) : null}
    </View>
  ) : null;

  return (
    <View style={[styles.homeScreen, isMobile && styles.homeScreenMobile]}>
      <ScrollView
        style={styles.homeScroll}
        contentContainerStyle={[
          styles.homeScrollContent,
          {
            flexGrow: 1,
            paddingTop: insetTop,
            paddingBottom: isMobile ? mobileTabBarReserve() + 8 : 24,
          },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        bounces={false}
        overScrollMode="never"
        {...tabBarScroll}
        {...(Platform.OS === 'web' ? { className: 'cgold-home-overlay-scroll' } : null)}
      >
        <View
          style={[
            styles.homeInset,
            isMobile
              ? { paddingHorizontal: pagePad }
              : {
                  paddingHorizontal: pagePad,
                  width: '100%',
                  ...(tableMaxWidth ? { maxWidth: tableMaxWidth } : null),
                },
          ]}
        >
          {search ? (
            <View style={styles.homeToolbar}>
              {isMobile ? <View style={styles.homeSearchMobileWrap}>{search}</View> : search}
            </View>
          ) : null}
          <View style={styles.homeSortBar}>
            <View style={styles.homeSortLead}>
              <TriageHomeSort
                sortKey={sort.key}
                sortDir={sort.dir}
                onSort={(column) => setSort((current) => nextStoreSort(current, column))}
                compact={isMobile}
              />
            </View>
            {onAdd ? (
              <Pressable
                onPress={onAdd}
                style={({ hovered, pressed }) => [
                  styles.homeAdd,
                  (hovered || pressed) && styles.homeAddHover,
                ]}
                accessibilityRole="button"
                accessibilityLabel="Add a PO"
              >
                <Ionicons name="add-circle-outline" size={17} color="#1F8A4E" />
                <Text style={styles.homeAddLabel}>Add</Text>
              </Pressable>
            ) : null}
          </View>
          {loading && !rows.length ? (
            <View style={styles.homeEmpty}>
              <ActivityIndicator color="#1d1d1f" />
            </View>
          ) : !rows.length ? (
            <Text style={styles.homeEmptyText}>
              {String(query || '').trim() ? 'No stores match that search.' : 'No stores.'}
            </Text>
          ) : (
            <View style={[styles.homeGrid, isMobile && styles.homeGridCompact]}>
              {sorted.map((row) => (
                <View key={row.store} style={styles.homeGridItem}>
                  <TriageHomeStoreTile
                    row={row}
                    selected={storesMatch(row.store, selectedStore)}
                    loading={loading}
                    onPress={() => onOpenStore(row.store)}
                  />
                </View>
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

function StoreOverviewHead({ storeName, subtitle, stats = [], toolbar }) {
  return (
    <View style={styles.overviewHead}>
      <View style={styles.overviewHeadRow}>
        <View style={styles.overviewTitleBlock}>
          <Text style={styles.overviewStoreName} numberOfLines={2}>
            {storeName}
          </Text>
          {subtitle ? (
            <Text style={styles.overviewStoreMeta} numberOfLines={2}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {stats.length ? (
          <View style={styles.overviewStatsBox}>
            {stats.map((row, index) => {
              const last = index === stats.length - 1;
              const body = (
                <>
                  <View style={styles.overviewStatsLead}>
                    <Ionicons name={row.icon} size={15} color={MOBILE.secondary} />
                    <Text style={styles.overviewStatsLabel} numberOfLines={1}>
                      {row.label}
                    </Text>
                  </View>
                  <Text style={styles.overviewStatsValue} numberOfLines={1}>
                    {row.value}
                  </Text>
                </>
              );
              if (row.onPress) {
                return (
                  <Pressable
                    key={row.key}
                    onPress={row.onPress}
                    style={({ hovered, pressed }) => [
                      styles.overviewStatsRow,
                      last && styles.overviewStatsRowLast,
                      (hovered || pressed) && styles.overviewStatsRowHover,
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={`${row.label} ${row.value}`}
                  >
                    {body}
                  </Pressable>
                );
              }
              return (
                <View
                  key={row.key}
                  style={[styles.overviewStatsRow, last && styles.overviewStatsRowLast]}
                  accessibilityLabel={`${row.label} ${row.value}`}
                >
                  {body}
                </View>
              );
            })}
          </View>
        ) : null}
      </View>
      <View
        style={styles.overviewHeadRule}
        {...(Platform.OS === 'web' ? { className: 'cgold-home-row-rule' } : null)}
      />
      {toolbar ? <View style={styles.overviewToolbarWrap}>{toolbar}</View> : null}
    </View>
  );
}

function compareText(a, b) {
  return String(a || '').localeCompare(String(b || ''), undefined, { numeric: true, sensitivity: 'base' });
}

function nextContextSort(current, column, text = false) {
  if (current.key !== column) return { key: column, dir: text ? 'asc' : 'desc' };
  if (current.dir === (text ? 'asc' : 'desc')) return { key: column, dir: text ? 'desc' : 'asc' };
  return { key: null, dir: 'default' };
}

function ContextTable({
  columns,
  rows,
  rowKey,
  sort,
  onSort,
  onRowPress,
  renderLead,
  renderTrail,
  chevron = true,
  footer,
  gridStyle,
  empty,
}) {
  const showChevron = Boolean(chevron && onRowPress);
  return (
    <View style={styles.contextTableWrap}>
      <View style={styles.contextTableShadow}>
        <View style={styles.storeTableCard}>
          <View style={[styles.storeRow, styles.storeHead]}>
            <View style={styles.storeIconWrap} />
            <View style={[styles.contextRowBody, renderTrail && styles.contextRowBodyTrail, gridStyle]}>
              {columns.map((col) => (
                <View key={col.key} style={styles.contextCol}>
                  {col.sortable ? (
                    <StoreTableHeaderCell
                      label={col.label}
                      column={col.key}
                      sortKey={sort?.key}
                      sortDir={sort?.dir}
                      onSort={onSort}
                    />
                  ) : (
                    <Text style={styles.storeHeadText}>{col.label}</Text>
                  )}
                </View>
              ))}
            </View>
          </View>
          {rows.length ? (
            rows.map((row, index) => {
              const last = index === rows.length - 1 && !footer;
              return (
                <Pressable
                  key={rowKey(row, index)}
                  onPress={onRowPress ? () => onRowPress(row) : undefined}
                  disabled={!onRowPress}
                  style={({ hovered, pressed }) => [
                    styles.storeRow,
                    last && styles.storeRowLast,
                    onRowPress && (hovered || pressed) && styles.storeRowHover,
                    !onRowPress && styles.contextRowStatic,
                  ]}
                >
                  <View style={styles.storeIconWrap}>{renderLead?.(row)}</View>
                  <View style={[styles.contextRowBody, renderTrail && styles.contextRowBodyTrail, gridStyle]}>
                    {columns.map((col) => (
                      <View key={col.key} style={styles.contextCol}>
                        {col.render(row)}
                      </View>
                    ))}
                  </View>
                  {renderTrail ? <View style={styles.contextTrail}>{renderTrail(row)}</View> : null}
                  {showChevron ? (
                    <View style={styles.storeChevron} pointerEvents="none">
                      <Ionicons name="chevron-forward" size={18} color="#8e8e93" />
                    </View>
                  ) : null}
                </Pressable>
              );
            })
          ) : (
            <View style={[styles.storeRow, styles.storeRowLast, styles.contextRowStatic]}>
              {empty || emptyCopy('Nothing to show.')}
            </View>
          )}
          {footer}
        </View>
      </View>
    </View>
  );
}

function ProgressCell({ value, total, tone = 'orange' }) {
  if (!total) return <Text style={styles.storeShareEmpty}>—</Text>;
  return (
    <View style={styles.contextProgress}>
      <ProgressBar value={value} total={total} tone={tone} height={4} style={styles.storeShareBar} />
      <Text style={styles.storeSharePct}>{formatInsightPercent(total ? value / total : 0, 1)}</Text>
    </View>
  );
}

function LotsTable({ rows, onOpen }) {
  const [sort, setSort] = useState({ key: null, dir: 'default' });
  const footerTotals = useMemo(() => {
    let pos = 0;
    let expected = 0;
    let evaluated = 0;
    let errors = 0;
    for (const lot of rows || []) {
      pos += (lot.pos || []).length;
      expected += Number(lot.expected) || 0;
      evaluated += Number(lot.evaluated) || 0;
      errors += Number(lot.incorrect) || 0;
    }
    return { pos, expected, evaluated, errors };
  }, [rows]);
  const sorted = useMemo(() => {
    if (!sort.key || sort.dir === 'default') return rows || [];
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...(rows || [])].sort((a, b) => {
      let delta = 0;
      if (sort.key === 'lot') delta = compareText(a.id, b.id);
      else if (sort.key === 'period') delta = compareText(lotPeriodLabel(a), lotPeriodLabel(b));
      else if (sort.key === 'pos') delta = (a.pos || []).length - (b.pos || []).length;
      else if (sort.key === 'progress') delta = lotProgressOf(a).percent - lotProgressOf(b).percent;
      else delta = (Number(a.incorrect) || 0) - (Number(b.incorrect) || 0);
      return delta ? dir * delta : compareText(a.id, b.id);
    });
  }, [rows, sort.dir, sort.key]);
  const columns = [
    {
      key: 'lot',
      label: 'Lot',
      sortable: true,
      render: (lot) => (
        <Text style={styles.storeName} numberOfLines={1}>
          {lot.id}
        </Text>
      ),
    },
    {
      key: 'period',
      label: 'Period',
      sortable: true,
      render: (lot) => (
        <Text style={styles.storeCell} numberOfLines={1}>
          {lotPeriodLabel(lot) || '—'}
        </Text>
      ),
    },
    {
      key: 'pos',
      label: 'POs',
      sortable: true,
      render: (lot) => (
        <Text style={styles.storeCell} numberOfLines={1}>
          {String((lot.pos || []).length)}
        </Text>
      ),
    },
    {
      key: 'progress',
      label: 'Progress',
      sortable: true,
      render: (lot) => {
        const progress = lotProgressOf(lot);
        return (
          <ProgressCell
            value={progress.evaluated}
            total={progress.expected}
            tone={progress.done ? 'green' : 'blue'}
          />
        );
      },
    },
    {
      key: 'errors',
      label: 'Errors',
      sortable: true,
      render: (lot) => (
        <Text style={styles.storeCell} numberOfLines={1}>
          {String(lot.incorrect || 0)}
        </Text>
      ),
    },
  ];
  return (
    <ContextTable
      columns={columns}
      rows={sorted}
      rowKey={(lot) => lot.id}
      sort={sort}
      onSort={(column) =>
        setSort((current) => nextContextSort(current, column, column === 'lot' || column === 'period'))
      }
      onRowPress={onOpen}
      renderLead={() => (
        <View style={[styles.storeIconTile, { backgroundColor: '#8A6D1F' }]}>
          <Ionicons name="layers" size={14} color="#fff" />
        </View>
      )}
      gridStyle={styles.contextGridLots}
      footer={
        sorted.length ? (
          <View style={[styles.storeRow, styles.storeTotal, styles.storeRowLast]}>
            <View style={styles.storeIconWrap} />
            <View style={[styles.contextRowBody, styles.contextGridLots]}>
              <View style={styles.contextCol}>
                <Text style={styles.storeTotalLabel}>Total</Text>
              </View>
              <View style={styles.contextCol} />
              <View style={styles.contextCol}>
                <Text style={styles.storeTotalCell}>{String(footerTotals.pos)}</Text>
              </View>
              <View style={styles.contextCol}>
                <Text style={styles.storeTotalCell}>
                  {footerTotals.expected ? `${footerTotals.evaluated}/${footerTotals.expected}` : '—'}
                </Text>
              </View>
              <View style={styles.contextCol}>
                <Text style={styles.storeTotalCell}>{String(footerTotals.errors)}</Text>
              </View>
            </View>
          </View>
        ) : null
      }
    />
  );
}

function ErrorsTable({ rows, onOpen, onDelete, inStore }) {
  const [sort, setSort] = useState({ key: null, dir: 'default' });
  const totalAmount = useMemo(() => rows.reduce((sum, row) => sum + errorAmountOf(row), 0), [rows]);
  const sorted = useMemo(() => {
    if (!sort.key || sort.dir === 'default') return rows || [];
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...(rows || [])].sort((a, b) => {
      let delta = 0;
      if (sort.key === 'document') delta = compareText(a.reference, b.reference);
      else if (sort.key === 'type') delta = compareText(errorTypeOf(a), errorTypeOf(b));
      else if (sort.key === 'person') delta = compareText(staffName(a), staffName(b));
      else if (sort.key === 'date') delta = errorDocumentTime(a) - errorDocumentTime(b);
      else delta = errorAmountOf(a) - errorAmountOf(b);
      return delta ? dir * delta : compareText(a.reference, b.reference);
    });
  }, [rows, sort.dir, sort.key]);
  const columns = [
    {
      key: 'document',
      label: 'Document',
      sortable: true,
      render: (row) => (
        <Text style={styles.storeName} numberOfLines={1}>
          {row.reference || 'Document'}
        </Text>
      ),
    },
    {
      key: 'type',
      label: 'Type',
      sortable: true,
      render: (row) => (
        <Text style={styles.storeCell} numberOfLines={1}>
          {errorTypeOf(row)}
        </Text>
      ),
    },
    ...(!inStore
      ? [
          {
            key: 'store',
            label: 'Store',
            sortable: true,
            render: (row) => (
              <Text style={styles.storeCell} numberOfLines={1}>
                {row.storeName || '—'}
              </Text>
            ),
          },
        ]
      : []),
    {
      key: 'person',
      label: 'Person',
      sortable: true,
      render: (row) => (
        <Text style={styles.storeCell} numberOfLines={1}>
          {staffName(row) || '—'}
        </Text>
      ),
    },
    {
      key: 'date',
      label: 'Date',
      sortable: true,
      render: (row) => (
        <Text style={styles.storeCell} numberOfLines={1}>
          {row.dateLabel || '—'}
        </Text>
      ),
    },
    {
      key: 'amount',
      label: 'Amount',
      sortable: true,
      render: (row) => (
        <Text style={[styles.storeCell, styles.storeAmount]} numberOfLines={1}>
          {formatErrorAmount(row?.review?.errorAmount || '') || '—'}
        </Text>
      ),
    },
  ];
  return (
    <ContextTable
      columns={columns}
      rows={sorted}
      rowKey={(row) => `${row.triageId}-${row.id}`}
      sort={sort}
      onSort={(column) =>
        setSort((current) => nextContextSort(current, column, column !== 'amount' && column !== 'date'))
      }
      onRowPress={onOpen}
      renderLead={(row) => <PoThumb urls={row.imageUrls} label={row.reference} size={28} />}
      renderTrail={(row) => (
        <View style={styles.errorRowActions}>
          <ErrorRowIcon
            label={`Edit error for ${row.reference || 'document'}`}
            icon="create-outline"
            color="#007AFF"
            onPress={() => onOpen(row)}
          />
          {onDelete ? (
            <ErrorRowIcon
              label={`Delete ${row.reference || 'document'}`}
              icon="trash-outline"
              color="#B91C1C"
              onPress={() =>
                confirmDestructive(
                  'Delete PO',
                  `Remove ${row.reference || 'this document'} from this store?`,
                  () => onDelete(row),
                )
              }
            />
          ) : null}
        </View>
      )}
      gridStyle={inStore ? styles.contextGridErrors : styles.contextGridErrorsWide}
      footer={
        sorted.length ? (
          <View style={[styles.storeRow, styles.storeTotal, styles.storeRowLast]}>
            <View style={styles.storeIconWrap} />
            <View style={[styles.contextRowBody, styles.contextRowBodyTrail, inStore ? styles.contextGridErrors : styles.contextGridErrorsWide]}>
              <View style={styles.contextCol}>
                <Text style={styles.storeTotalLabel}>Total</Text>
              </View>
              <View style={styles.contextCol}>
                <Text style={styles.storeTotalCell}>{String(sorted.length)}</Text>
              </View>
              {inStore ? null : <View style={styles.contextCol} />}
              <View style={styles.contextCol} />
              <View style={styles.contextCol} />
              <View style={styles.contextCol}>
                <Text style={[styles.storeTotalCell, styles.storeAmount]}>
                  {totalAmount ? formatAmount(totalAmount) : '—'}
                </Text>
              </View>
            </View>
          </View>
        ) : null
      }
    />
  );
}

function LotPosTable({ rows, onOpen, onDelete }) {
  const [sort, setSort] = useState({ key: null, dir: 'default' });
  const totals = useMemo(
    () =>
      (rows || []).reduce(
        (sum, row) => ({
          count: sum.count + 1,
          errors: sum.errors + (triagePoNeedsCorrection(row) ? 1 : 0),
          amount: sum.amount + errorAmountOf(row),
        }),
        { count: 0, errors: 0, amount: 0 },
      ),
    [rows],
  );
  const sorted = useMemo(() => {
    if (!sort.key || sort.dir === 'default') return rows || [];
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...(rows || [])].sort((a, b) => {
      let delta = 0;
      if (sort.key === 'document') delta = compareText(a.reference, b.reference);
      else if (sort.key === 'date') delta = errorDocumentTime(a) - errorDocumentTime(b);
      else if (sort.key === 'person') delta = compareText(staffName(a), staffName(b));
      else if (sort.key === 'status') {
        delta = Number(triagePoNeedsCorrection(a)) - Number(triagePoNeedsCorrection(b));
      } else delta = errorAmountOf(a) - errorAmountOf(b);
      return delta ? dir * delta : compareText(a.reference, b.reference);
    });
  }, [rows, sort.dir, sort.key]);
  const columns = [
    {
      key: 'document',
      label: 'Document',
      sortable: true,
      render: (row) => (
        <Text style={styles.storeName} numberOfLines={1}>
          {row.reference || 'Document'}
        </Text>
      ),
    },
    {
      key: 'date',
      label: 'Date',
      sortable: true,
      render: (row) => (
        <Text style={styles.storeCell} numberOfLines={1}>
          {row.dateLabel || '—'}
        </Text>
      ),
    },
    {
      key: 'person',
      label: 'Person',
      sortable: true,
      render: (row) => (
        <Text style={styles.storeCell} numberOfLines={1}>
          {staffName(row) || '—'}
        </Text>
      ),
    },
    {
      key: 'status',
      label: 'Status',
      sortable: true,
      render: (row) => {
        const flagged = triagePoNeedsCorrection(row);
        return (
          <Text style={[styles.storeCell, flagged ? styles.lotStatusError : styles.lotStatusOk]} numberOfLines={1}>
            {flagged ? 'Error' : 'Correct'}
          </Text>
        );
      },
    },
    {
      key: 'amount',
      label: 'Amount',
      sortable: true,
      render: (row) => (
        <Text style={[styles.storeCell, styles.storeAmount]} numberOfLines={1}>
          {formatErrorAmount(row?.review?.errorAmount || '') || row.amountLabel || '—'}
        </Text>
      ),
    },
  ];
  return (
    <ContextTable
      columns={columns}
      rows={sorted}
      rowKey={(row) => `${row.triageId || ''}-${row.id}`}
      sort={sort}
      onSort={(column) =>
        setSort((current) => nextContextSort(current, column, column === 'document' || column === 'person'))
      }
      onRowPress={onOpen}
      renderLead={(row) => <PoThumb urls={row.imageUrls} label={row.reference} size={28} />}
      renderTrail={(row) => (
        <View style={styles.errorRowActions}>
          <ErrorRowIcon
            label={`Review ${row.reference || 'document'}`}
            icon="create-outline"
            color="#007AFF"
            onPress={() => onOpen(row)}
          />
          {onDelete ? (
            <ErrorRowIcon
              label={`Delete ${row.reference || 'document'}`}
              icon="trash-outline"
              color="#B91C1C"
              onPress={() =>
                confirmDestructive(
                  'Delete PO',
                  `Remove ${row.reference || 'this document'} from this lot?`,
                  () => onDelete(row),
                )
              }
            />
          ) : null}
        </View>
      )}
      gridStyle={styles.contextGridLotPos}
      footer={
        sorted.length ? (
          <View style={[styles.storeRow, styles.storeTotal, styles.storeRowLast]}>
            <View style={styles.storeIconWrap} />
            <View style={[styles.contextRowBody, styles.contextRowBodyTrail, styles.contextGridLotPos]}>
              <View style={styles.contextCol}>
                <Text style={styles.storeTotalLabel}>Total</Text>
              </View>
              <View style={styles.contextCol}>
                <Text style={styles.storeTotalCell}>{String(totals.count)}</Text>
              </View>
              <View style={styles.contextCol} />
              <View style={styles.contextCol}>
                <Text style={styles.storeTotalCell}>{String(totals.errors)}</Text>
              </View>
              <View style={styles.contextCol}>
                <Text style={[styles.storeTotalCell, styles.storeAmount]}>
                  {totals.amount ? formatAmount(totals.amount) : '—'}
                </Text>
              </View>
            </View>
          </View>
        ) : null
      }
    />
  );
}

function AnalyticsTable({ rows, tab, total, icon, iconColor }) {
  const [sort, setSort] = useState({ key: null, dir: 'default' });
  const withType = tab === 'employees';
  const nameLabel = tab === 'items' ? 'Item' : tab === 'value' ? 'Range' : tab === 'employees' ? 'Employee' : 'Type';
  const sorted = useMemo(() => {
    if (!sort.key || sort.dir === 'default') return rows || [];
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...(rows || [])].sort((a, b) => {
      let delta = 0;
      if (sort.key === 'name') delta = compareText(a.label, b.label);
      else if (sort.key === 'kind') delta = compareText(a.type, b.type);
      else if (sort.key === 'count') delta = (Number(a.count) || 0) - (Number(b.count) || 0);
      else if (sort.key === 'amount') delta = (Number(a.amount) || 0) - (Number(b.amount) || 0);
      else delta = (Number(a.percent) || 0) - (Number(b.percent) || 0);
      return delta ? dir * delta : compareText(a.label, b.label);
    });
  }, [rows, sort.dir, sort.key]);
  const totals = useMemo(
    () =>
      (rows || []).reduce(
        (sum, row) => ({
          count: sum.count + (Number(row.count) || 0),
          amount: sum.amount + (Number(row.amount) || 0),
        }),
        { count: 0, amount: 0 },
      ),
    [rows],
  );
  const columns = [
    {
      key: 'name',
      label: nameLabel,
      sortable: true,
      render: (row) => (
        <Text style={styles.storeName} numberOfLines={1}>
          {row.label}
        </Text>
      ),
    },
    ...(withType
      ? [
          {
            key: 'kind',
            label: 'Top type',
            sortable: true,
            render: (row) => (
              <Text style={styles.storeCell} numberOfLines={1}>
                {row.type || '—'}
              </Text>
            ),
          },
        ]
      : []),
    {
      key: 'count',
      label: 'Errors',
      sortable: true,
      render: (row) => (
        <Text style={styles.storeCell} numberOfLines={1}>
          {String(row.count || 0)}
        </Text>
      ),
    },
    {
      key: 'amount',
      label: 'Amount',
      sortable: true,
      render: (row) => (
        <Text style={[styles.storeCell, styles.storeAmount]} numberOfLines={1}>
          {row.amount ? formatAmount(row.amount) : '—'}
        </Text>
      ),
    },
    {
      key: 'share',
      label: 'Progress',
      sortable: true,
      render: (row) => <ProgressCell value={row.count} total={total || row.count} />,
    },
  ];
  return (
    <ContextTable
      columns={columns}
      rows={sorted}
      rowKey={(row) => `${tab}-${row.label}`}
      sort={sort}
      onSort={(column) => setSort((current) => nextContextSort(current, column, column === 'name' || column === 'kind'))}
      renderLead={() => (
        <View style={[styles.storeIconTile, { backgroundColor: iconColor }]}>
          <Ionicons name={icon} size={14} color="#fff" />
        </View>
      )}
      chevron={false}
      gridStyle={withType ? styles.contextGridAnalyticsWide : styles.contextGridAnalytics}
      footer={
        sorted.length ? (
          <View style={[styles.storeRow, styles.storeTotal, styles.storeRowLast]}>
            <View style={styles.storeIconWrap} />
            <View style={[styles.contextRowBody, withType ? styles.contextGridAnalyticsWide : styles.contextGridAnalytics]}>
              <View style={styles.contextCol}>
                <Text style={styles.storeTotalLabel}>Total</Text>
              </View>
              {withType ? <View style={styles.contextCol} /> : null}
              <View style={styles.contextCol}>
                <Text style={styles.storeTotalCell}>{String(totals.count)}</Text>
              </View>
              <View style={styles.contextCol}>
                <Text style={[styles.storeTotalCell, styles.storeAmount]}>
                  {totals.amount ? formatAmount(totals.amount) : '—'}
                </Text>
              </View>
              <View style={styles.contextCol} />
            </View>
          </View>
        ) : null
      }
    />
  );
}

const ANALYTICS_TABS = [
  { key: 'type', label: 'Error type', short: 'Type', icon: 'pricetag', iconColor: '#C2410C' },
  { key: 'items', label: 'Item', short: 'Item', icon: 'cube', iconColor: '#1D4ED8' },
  { key: 'employees', label: 'Employee', short: 'Staff', icon: 'person', iconColor: '#0F766E' },
  { key: 'value', label: 'Value', short: 'Value', icon: 'cash', iconColor: '#B45309' },
];

function AnalyticsPage({ rows = [], insetTop = 0, toolbar = null, storeName = '', desktopHead = false }) {
  const isMobile = useIsMobile();
  const [tab, setTab] = useState('type');
  const summary = useMemo(() => summarizeStoreErrors(rows), [rows]);
  const total = summary.count || 0;
  const tabMeta = ANALYTICS_TABS.find((option) => option.key === tab) || ANALYTICS_TABS[0];
  const tabOptions = useMemo(
    () =>
      ANALYTICS_TABS.map((option) => ({
        key: option.key,
        label: isMobile ? option.short : option.label,
      })),
    [isMobile],
  );

  let list = [];
  let empty = 'No errors recorded.';
  if (tab === 'type') {
    list = summary.types;
    empty = 'No error types recorded.';
  } else if (tab === 'items') {
    list = summary.items;
    empty = 'No items on recorded errors.';
  } else if (tab === 'employees') {
    list = (summary.employees || []).map((row) => ({
      label: row.name,
      count: row.count,
      amount: row.amount,
      percent: row.percent,
      type: row.type,
    }));
    empty = 'No employees on recorded errors.';
  } else {
    list = summary.values || [];
    empty = 'No error amounts recorded.';
  }

  const analyticsStats = [
    { key: 'errors', icon: 'alert-circle-outline', label: 'Errors', value: String(total) },
    { key: 'types', icon: 'pricetag-outline', label: 'Types', value: String(summary.types.length) },
    { key: 'items', icon: 'cube-outline', label: 'Items', value: String((summary.items || []).length) },
  ];
  const analyticsTabs = (
    <View style={isMobile ? styles.analyticsTabsMobile : styles.analyticsTabs}>
      <TextTabs
        options={tabOptions}
        value={tab}
        onChange={setTab}
        size={isMobile ? 'md' : 'lg'}
        layout={isMobile ? 'segment' : 'bar'}
      />
    </View>
  );
  const desktopHeader = desktopHead ? (
    <StoreOverviewHead
      storeName={storeName}
      subtitle="Analytics"
      stats={analyticsStats}
      toolbar={
        <>
          {toolbar}
          {rows.length ? analyticsTabs : null}
        </>
      }
    />
  ) : null;

  if (!rows.length) {
    return desktopHead ? (
      <ChromePage insetTop={insetTop} tableHeader={desktopHeader}>
        <EmptyState
          icon="stats-chart-outline"
          title="No analytics"
          body="Flagged POs and SOs land here after triage reviews them."
        />
      </ChromePage>
    ) : (
      <View style={insetTop ? { flex: 1, paddingTop: insetTop } : null}>
        <EmptyState
          icon="stats-chart-outline"
          title="No analytics"
          body="Flagged POs and SOs land here after triage reviews them."
        />
      </View>
    );
  }

  return (
    <ChromePage
      title={isMobile && !desktopHead ? 'Analytics' : undefined}
      insetTop={insetTop}
      meta={`${total} ${total === 1 ? 'error' : 'errors'}`}
      tableHeader={
        desktopHeader || (
          <>
            {toolbar}
            {analyticsTabs}
          </>
        )
      }
      data={desktopHead ? undefined : list}
      extraData={tab}
      keyExtractor={(row) => `${tab}-${row.label}`}
      renderItem={
        desktopHead
          ? undefined
          : ({ item: row, index }) => {
              const countLabel = `${row.count} ${row.count === 1 ? 'error' : 'errors'}`;
              const meta =
                tab === 'value' && row.amount ? `${countLabel} · ${formatAmount(row.amount)}` : countLabel;
              return (
                <ChromeListRow
                  title={row.label}
                  meta={meta}
                  value={formatInsightPercent(row.percent, total)}
                  icon={tabMeta.icon}
                  iconColor={tabMeta.iconColor}
                  last={index === list.length - 1}
                  chevron={false}
                  extra={
                    <ProgressBar
                      value={row.count}
                      total={total || row.count || 1}
                      tone="orange"
                      height={isMobile ? 6 : 4}
                      style={styles.analyticsRowBar}
                    />
                  }
                />
              );
            }
      }
    >
      {desktopHead ? (
        list.length ? (
          <AnalyticsTable
            rows={list}
            tab={tab}
            total={total}
            icon={tabMeta.icon}
            iconColor={tabMeta.iconColor}
          />
        ) : (
          emptyCopy(empty)
        )
      ) : list.length ? null : (
        emptyCopy(empty)
      )}
    </ChromePage>
  );
}

function ErrorRowIcon({ label, icon, color, onPress }) {
  return (
    <Pressable
      onPress={(event) => {
        event?.stopPropagation?.();
        onPress?.();
      }}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Ionicons name={icon} size={18} color={color} />
    </Pressable>
  );
}

function ErrorsPage({
  rows,
  query,
  onOpen,
  onDelete,
  inStore = false,
  sort = 'recent',
  hideTitle = false,
  insetTop = 0,
  toolbar = null,
  storeName = '',
  desktopHead = false,
}) {
  const visible = useMemo(
    () => sortErrorRows(rows.filter((row) => matchesQuery(row, query)), sort),
    [query, rows, sort],
  );
  const types = useMemo(() => rankCounts(visible, errorTypeOf), [visible]);
  const amount = useMemo(() => visible.reduce((sum, row) => sum + errorAmountOf(row), 0), [visible]);
  const storeCount = useMemo(
    () => new Set(visible.map((row) => String(row.storeName || '').trim()).filter((name) => name && name !== '—')).size,
    [visible],
  );

  const errorStats = [
    {
      key: 'errors',
      icon: 'alert-circle-outline',
      label: visible.length === 1 ? 'Error' : 'Errors',
      value: String(visible.length),
    },
    ...(inStore
      ? []
      : [
          {
            key: 'stores',
            icon: 'storefront-outline',
            label: storeCount === 1 ? 'Store' : 'Stores',
            value: String(storeCount),
          },
        ]),
    {
      key: 'types',
      icon: 'pricetag-outline',
      label: types.length === 1 ? 'Type' : 'Types',
      value: String(types.length),
    },
    {
      key: 'amount',
      icon: 'cash-outline',
      label: 'Amount',
      value: amount ? formatAmount(amount) : '—',
    },
  ];
  const desktopHeader = desktopHead ? (
    <StoreOverviewHead storeName={storeName} subtitle="Errors" stats={errorStats} toolbar={toolbar} />
  ) : null;

  if (!rows.length) {
    return desktopHead ? (
      <ChromePage insetTop={insetTop} tableHeader={desktopHeader}>
        <EmptyState
          icon="alert-circle-outline"
          title="No errors"
          body="Flagged POs and SOs land here after triage reviews them."
        />
      </ChromePage>
    ) : (
      <View style={insetTop ? { flex: 1, paddingTop: insetTop } : null}>
        <EmptyState
          icon="alert-circle-outline"
          title="No errors"
          body="Flagged POs and SOs land here after triage reviews them."
        />
      </View>
    );
  }

  return (
    <ChromePage
      hero={
        desktopHead ? undefined : (
          <ChromeHero
            icon="alert-circle"
            iconColor="#B91C1C"
            value={amount ? formatAmount(amount) : String(visible.length)}
            stats={[
              { label: visible.length === 1 ? 'Error' : 'Errors', value: String(visible.length) },
              ...(inStore
                ? []
                : [{ label: storeCount === 1 ? 'Store' : 'Stores', value: String(storeCount) }]),
              { label: types.length === 1 ? 'Type' : 'Types', value: String(types.length) },
            ]}
          />
        )
      }
      title={hideTitle ? undefined : 'Errors'}
      insetTop={insetTop}
      tableHeader={desktopHeader || toolbar}
      meta={`${visible.length} error${visible.length === 1 ? '' : 's'}`}
      data={desktopHead ? undefined : visible}
      extraData={sort}
      keyExtractor={(row) => `${row.triageId}-${row.id}`}
      renderItem={
        desktopHead
          ? undefined
          : ({ item: row, index }) => (
              <ChromeListRow
                title={row.reference || 'Document'}
                meta={[errorTypeOf(row), inStore ? null : row.storeName, staffName(row), row.dateLabel].filter(Boolean).join(' · ')}
                value={formatErrorAmount(row?.review?.errorAmount || '') || ''}
                leading={<PoThumb urls={row.imageUrls} label={row.reference} size={46} />}
                last={index === visible.length - 1}
                onPress={() => onOpen(row)}
                chevron={false}
                trailing={
                  <View style={styles.errorRowActions}>
                    <ErrorRowIcon
                      label={`Edit error for ${row.reference || 'document'}`}
                      icon="create-outline"
                      color="#007AFF"
                      onPress={() => onOpen(row)}
                    />
                    {onDelete ? (
                      <ErrorRowIcon
                        label={`Delete ${row.reference || 'document'}`}
                        icon="trash-outline"
                        color="#B91C1C"
                        onPress={() =>
                          confirmDestructive(
                            'Delete PO',
                            `Remove ${row.reference || 'this document'} from this store?`,
                            () => onDelete(row),
                          )
                        }
                      />
                    ) : null}
                  </View>
                }
              />
            )
      }
    >
      {desktopHead ? (
        visible.length ? (
          <ErrorsTable rows={visible} onOpen={onOpen} onDelete={onDelete} inStore={inStore} />
        ) : (
          emptyCopy(query.trim() ? `No error matches “${query.trim()}”.` : 'No errors.')
        )
      ) : visible.length ? null : (
        emptyCopy(query.trim() ? `No error matches “${query.trim()}”.` : 'No errors.')
      )}
    </ChromePage>
  );
}

function LotsPage({
  lots,
  allRows,
  errors,
  query,
  onOpen,
  hideTitle = false,
  insetTop = 0,
  toolbar = null,
  storeName = '',
  desktopHead = false,
  openLotId = '',
  onOpenPo,
  onDeletePo,
}) {
  const isMobile = useIsMobile();
  const visible = useMemo(() => lots.filter((lot) => lotMatchesQuery(lot, query)), [lots, query]);
  const openLot = useMemo(
    () => (openLotId ? lots.find((lot) => lot.id === openLotId) || null : null),
    [lots, openLotId],
  );
  const lotPos = useMemo(() => {
    if (!openLot) return [];
    return (openLot.pos || []).filter((row) => matchesQuery(row, query));
  }, [openLot, query]);
  const lotProgress = useMemo(() => (openLot ? lotProgressOf(openLot) : null), [openLot]);
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const totals = useMemo(() => {
    let expected = 0;
    let evaluated = 0;
    for (const lot of visible) {
      expected += Number(lot.expected) || 0;
      evaluated += Number(lot.evaluated) || 0;
    }
    return {
      expected,
      evaluated,
      percent: expected ? Math.round((evaluated / expected) * 100) : 0,
      done: expected > 0 && evaluated >= expected,
    };
  }, [visible]);
  const metals = useMemo(() => summarizeLotsFineMetals(visible, allRows), [allRows, visible]);
  const errorTypes = useMemo(() => rankCounts(errors?.rows, errorTypeOf), [errors]);

  const lotStats = openLot
    ? [
        {
          key: 'pos',
          icon: 'document-text-outline',
          label: lotPos.length === 1 ? 'PO' : 'POs',
          value: String((openLot.pos || []).length),
        },
        {
          key: 'progress',
          icon: 'speedometer-outline',
          label: 'Progress',
          value: lotProgress?.expected ? `${lotProgress.evaluated}/${lotProgress.expected}` : '—',
          onPress: () => setBreakdownOpen(true),
        },
        {
          key: 'errors',
          icon: 'alert-circle-outline',
          label: 'Errors',
          value: String(openLot.incorrect || 0),
        },
      ]
    : [
        {
          key: 'lots',
          icon: 'layers-outline',
          label: visible.length === 1 ? 'Lot' : 'Lots',
          value: String(visible.length),
        },
        {
          key: 'progress',
          icon: 'speedometer-outline',
          label: 'Progress',
          value: totals.expected ? `${totals.evaluated}/${totals.expected}` : '—',
          onPress: lots.length ? () => setBreakdownOpen(true) : undefined,
        },
        {
          key: 'errors',
          icon: 'alert-circle-outline',
          label: 'Errors',
          value: String(errors?.count || 0),
        },
      ];
  const desktopHeader = desktopHead ? (
    <StoreOverviewHead
      storeName={storeName}
      subtitle={openLot ? lotPeriodLabel(openLot) || openLot.id : 'Lots'}
      stats={lotStats}
      toolbar={toolbar}
    />
  ) : null;

  if (!lots.length) {
    if (desktopHead) {
      return (
        <ChromePage insetTop={insetTop} tableHeader={desktopHeader}>
          <EmptyState
            icon="layers-outline"
            title="No lots"
            body="Finish a PO to create its lot. Lots group every PO / SO from the same store and month."
          />
        </ChromePage>
      );
    }
    return (
      <View style={insetTop ? { flex: 1, paddingTop: insetTop } : null}>
        <EmptyState
          icon="layers-outline"
          title="No lots"
          body="Finish a PO to create its lot. Lots group every PO / SO from the same store and month."
        />
      </View>
    );
  }

  return (
    <>
    <ChromePage
      hero={
        desktopHead ? undefined : (
          <ChromeHero
            icon="layers"
            iconColor="#8A6D1F"
            value={totals.expected ? `${totals.percent}%` : String(visible.length)}
            stats={[
              { label: visible.length === 1 ? 'Lot' : 'Lots', value: String(visible.length) },
              {
                label: 'Progress',
                value: totals.expected ? `${totals.evaluated}/${totals.expected}` : '—',
              },
              { label: 'Errors', value: String(errors?.count || 0) },
            ]}
            footer={
              totals.expected ? (
                <ProgressBar
                  value={totals.evaluated}
                  total={totals.expected}
                  height={7}
                  tone={totals.done ? 'green' : 'blue'}
                />
              ) : null
            }
            onPress={() => setBreakdownOpen(true)}
            accessibilityLabel="Open lot progress and metal weights"
          />
        )
      }
      title={hideTitle ? undefined : 'Lots'}
      insetTop={insetTop}
      tableHeader={desktopHeader || toolbar}
      meta={`${visible.length} ${visible.length === 1 ? 'lot' : 'lots'}`}
      data={desktopHead ? undefined : visible}
      keyExtractor={(lot) => lot.id}
      renderItem={
        desktopHead
          ? undefined
          : ({ item: lot, index }) => {
              const progress = lotProgressOf(lot);
              return (
                <ChromeListRow
                  title={lot.id}
                  meta={[
                    lot.location,
                    lotPeriodLabel(lot),
                    `${lot.pos.length} ${lot.pos.length === 1 ? 'PO' : 'POs'}`,
                    lot.incorrect ? `${lot.incorrect} ${lot.incorrect === 1 ? 'error' : 'errors'}` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                  value={progress.expected ? `${progress.evaluated}/${progress.expected}` : String(lot.pos.length)}
                  icon="layers"
                  iconColor="#8A6D1F"
                  last={index === visible.length - 1}
                  onPress={onOpen ? () => onOpen(lot) : undefined}
                  chevron={Boolean(onOpen)}
                  extra={
                    progress.expected ? (
                      <ProgressBar
                        value={progress.evaluated}
                        total={progress.expected}
                        tone={progress.done ? 'green' : 'blue'}
                        height={6}
                        style={styles.lotRowBar}
                      />
                    ) : null
                  }
                />
              );
            }
      }
    >
      {desktopHead ? (
        openLot ? (
          lotPos.length ? (
            <LotPosTable rows={lotPos} onOpen={onOpenPo} onDelete={onDeletePo} />
          ) : (
            emptyCopy(query.trim() ? `No PO matches “${query.trim()}”.` : 'No purchases in this lot.')
          )
        ) : visible.length ? (
          <LotsTable rows={visible} onOpen={onOpen} />
        ) : (
          emptyCopy(query.trim() ? `No lot matches “${query.trim()}”.` : 'No lots.')
        )
      ) : visible.length ? null : (
        emptyCopy(query.trim() ? `No lot matches “${query.trim()}”.` : 'No lots.')
      )}
    </ChromePage>
    <TriageDrawer
      visible={breakdownOpen}
      onClose={() => setBreakdownOpen(false)}
      title="Lots"
      subtitle={
        totals.expected
          ? `${totals.evaluated} of ${totals.expected} melt POs · bullion-only excluded`
          : `${visible.length} ${visible.length === 1 ? 'lot' : 'lots'}`
      }
      leftLabel="Done"
      onLeft={() => setBreakdownOpen(false)}
      widthRatio={0.38}
      minWidth={360}
    >
      <ScrollView style={styles.breakScroll} contentContainerStyle={[styles.breakPad, isMobile && styles.breakPadMobile]} showsVerticalScrollIndicator={false}>
        <Text style={styles.breakKicker}>Progress</Text>
        <Text style={styles.breakValue}>{totals.expected ? `${totals.percent}%` : '—'}</Text>
        <Text style={styles.breakMeta}>
          {totals.expected ? `${totals.evaluated} / ${totals.expected} evaluated` : 'No melt POs yet'}
        </Text>
        {totals.expected ? (
          <ProgressBar
            value={totals.evaluated}
            total={totals.expected}
            tone={totals.done ? 'green' : 'blue'}
            height={6}
            style={styles.breakBar}
          />
        ) : null}

        <Text style={[styles.breakKicker, styles.breakSection]}>Fine metal</Text>
        {LOT_FINE_METALS.map((metal, index) => {
          const expected = metals.expected[metal.key] || 0;
          const completed = metals.completed[metal.key] || 0;
          return (
            <View key={metal.key} style={[styles.breakRow, index === LOT_FINE_METALS.length - 1 && styles.breakRowLast]}>
              <View style={styles.breakCopy}>
                <Text style={styles.breakLabel}>{metal.label}</Text>
                <Text style={styles.breakCount}>{formatFineProgress(completed, expected)}</Text>
              </View>
              <Text style={styles.breakHint}>{metal.name}</Text>
              <ProgressBar
                value={completed}
                total={expected || completed || 1}
                tone={expected > 0 && completed >= expected ? 'green' : 'blue'}
                height={4}
              />
            </View>
          );
        })}

        <Text style={[styles.breakKicker, styles.breakSection]}>Errors</Text>
        {errorTypes.length ? (
          errorTypes.map((row, index) => (
            <View key={row.label} style={[styles.breakRow, index === errorTypes.length - 1 && styles.breakRowLast]}>
              <View style={styles.breakCopy}>
                <Text style={styles.breakLabel}>{row.label}</Text>
                <Text style={styles.breakCount}>{row.count}</Text>
              </View>
              <ProgressBar value={row.count} total={errors?.count || row.count} tone="orange" height={4} />
            </View>
          ))
        ) : (
          <Text style={styles.breakHint}>No errors in these lots.</Text>
        )}
      </ScrollView>
    </TriageDrawer>
    </>
  );
}

export default function TriageDashboardPanel({
  session,
  onRequireLogin,
  active = true,
  listQuery = '',
  onQueryChange,
  onAdd,
  page = '',
  onPageChange,
  onBackChange,
  onOpenLot,
  onStoresViewChange,
  storesNavRef,
  onReviewOpenChange,
  errorSort = 'recent',
  desktopRail = false,
  insetTop = 0,
  toolbar = null,
}) {
  const { triage, remoteLoaded = false, localReady = false } = useTransferWorkflow();
  useEffect(() => {
    if (!active || !session?.token) return undefined;
    let cancelled = false;
    backfillTriageErrorBuyers(session, triage).catch(() => {
      if (cancelled) return;
    });
    return () => {
      cancelled = true;
    };
  }, [active, session, triage]);
  // Cached rows paint straight away; the delta pull refreshes them in place.
  const countsLoading = !remoteLoaded && !(localReady && triage.length > 0);
  const isMobile = useIsMobile();
  const [openRow, setOpenRow] = useState(null);
  const [editingError, setEditingError] = useState(false);

  useEffect(() => {
    if (!onReviewOpenChange) return undefined;
    onReviewOpenChange(Boolean(openRow));
    return () => onReviewOpenChange(false);
  }, [onReviewOpenChange, openRow]);
  const [selectedStore, setSelectedStore] = useState('');
  const [openLotId, setOpenLotId] = useState('');

  const needPos = active && Boolean(selectedStore || page);
  const evaluated = useMemo(() => (needPos ? collectAccuracyTriagePos(triage) : []), [needPos, triage]);
  const allRows = useMemo(() => (needPos ? collectAllTriagePos(triage) : []), [needPos, triage]);
  const lots = useMemo(() => (needPos ? groupPosIntoLots(evaluated, allRows) : []), [allRows, evaluated, needPos]);
  const errors = useMemo(() => (needPos ? summarizeErrors(evaluated) : { rows: [], count: 0, amount: 0, stores: 0, topType: null, types: [] }), [evaluated, needPos]);
  const storeRows = useMemo(() => (active ? listStoreErrorCounts(triage) : []), [active, triage]);
  const visibleStoreRows = useMemo(() => {
    const q = String(listQuery || '').trim().toLowerCase();
    if (!q) return storeRows;
    return storeRows.filter((row) => String(row.store || '').toLowerCase().includes(q));
  }, [listQuery, storeRows]);
  const scopedEvaluated = useMemo(
    () => (selectedStore ? evaluated.filter((row) => poInStore(row, selectedStore)) : evaluated),
    [evaluated, selectedStore],
  );
  const scopedAllRows = useMemo(
    () => (selectedStore ? allRows.filter((row) => poInStore(row, selectedStore)) : allRows),
    [allRows, selectedStore],
  );
  const scopedLots = useMemo(
    () =>
      selectedStore
        ? groupPosIntoLots(scopedEvaluated, scopedAllRows).filter((lot) => storesMatch(lot.location, selectedStore))
        : lots,
    [lots, scopedAllRows, scopedEvaluated, selectedStore],
  );
  const scopedErrors = useMemo(
    () => (selectedStore ? summarizeErrors(scopedEvaluated) : errors),
    [errors, scopedEvaluated, selectedStore],
  );
  const lotSummary = useMemo(() => summarizeLots(scopedLots), [scopedLots]);

  const openPage = useCallback((key) => onPageChange?.(key || ''), [onPageChange]);
  const openStore = useCallback((storeName = '') => {
    setSelectedStore(String(storeName || '').trim());
    onPageChange?.('');
  }, [onPageChange]);
  const closeStore = useCallback(() => {
    setOpenLotId('');
    setSelectedStore('');
    onPageChange?.('');
  }, [onPageChange]);
  const closeLot = useCallback(() => setOpenLotId(''), []);
  const closePage = useCallback(() => {
    if (openLotId) {
      setOpenLotId('');
      return;
    }
    if (page) {
      onPageChange?.('');
      return;
    }
    closeStore();
  }, [closeStore, onPageChange, openLotId, page]);

  useEffect(() => {
    if (page && page !== 'lots' && page !== 'errors' && page !== 'analytics') {
      onPageChange?.('');
    }
  }, [onPageChange, page]);

  useEffect(() => {
    if (page !== 'lots') setOpenLotId('');
  }, [page]);

  const openLotRecord = useMemo(
    () => (openLotId ? scopedLots.find((lot) => lot.id === openLotId) || null : null),
    [openLotId, scopedLots],
  );

  useEffect(() => {
    onStoresViewChange?.({
      selectedStore,
      selectedRegion: '',
      selectedRegionLabel: selectedStore,
      selectedLot: openLotRecord?.id || '',
      selectedLotLabel: openLotRecord ? lotPeriodLabel(openLotRecord) || openLotRecord.id : '',
    });
  }, [onStoresViewChange, openLotRecord, selectedStore]);

  useEffect(() => {
    if (!storesNavRef) return undefined;
    storesNavRef.current = {
      closeStore,
      closeRegion: closeStore,
      closeLot,
    };
    return () => {
      storesNavRef.current = { closeStore() {}, closeRegion() {}, closeLot() {} };
    };
  }, [closeLot, closeStore, storesNavRef]);

  const closeOpenError = useCallback(() => {
    setEditingError(false);
    setOpenRow(null);
  }, []);

  useEffect(() => {
    if (page === 'errors' || page === 'lots') return undefined;
    setEditingError(false);
    setOpenRow(null);
    return undefined;
  }, [page]);

  useEffect(() => {
    if (!active) return undefined;
    if ((page === 'errors' || page === 'lots') && openRow) {
      onBackChange?.(closeOpenError, { dateLabel: openRow.reference || 'Error' });
      return () => onBackChange?.(null, null);
    }
    if (openLotId) {
      onBackChange?.(closeLot, { dateLabel: openLotRecord ? lotPeriodLabel(openLotRecord) || openLotRecord.id : 'Lot' });
      return () => onBackChange?.(null, null);
    }
    if (!page && !selectedStore) {
      onBackChange?.(null, null);
      return () => onBackChange?.(null, null);
    }
    const titles = {
      errors: 'Errors',
      lots: 'Lots',
      analytics: 'Analytics',
    };
    const label = page ? titles[page] || 'Dashboard' : selectedStore || 'Store';
    onBackChange?.(closePage, { dateLabel: label });
    return () => onBackChange?.(null, null);
  }, [active, closeLot, closeOpenError, closePage, onBackChange, openLotId, openLotRecord, openRow, page, selectedStore]);

  const saveReview = useCallback(
    (poId, review) => {
      const saved = saveTriagePoReview(poId, review, triageEditorFromSession(session));
      setOpenRow((current) => (current?.id === poId ? applyTriageReviewToPo(current, saved || review) : current));
    },
    [session],
  );

  const deletePo = useCallback(
    (row) => {
      if (!row?.id) return;
      deleteTriageDocument(row.id, triageEditorFromSession(session)?.name || '');
      persistTransferWorkflowNow();
      setOpenRow((current) => (current?.id === row.id ? null : current));
    },
    [session],
  );

  if (!session?.token) {
    return (
      <View style={[styles.body, isMobile && styles.bodyMobile]}>
        <EmptyState
          icon="lock-closed-outline"
          title="Sign in to triage"
          body="Log in to see store errors and lots."
          action={<TextAction label="Go to Profile" strong onPress={onRequireLogin} />}
        />
      </View>
    );
  }

  const home = (
    <TriageHomeStores
      rows={visibleStoreRows}
      selectedStore={selectedStore}
      loading={countsLoading}
      query={listQuery}
      onQueryChange={onQueryChange}
      onOpenStore={openStore}
      onAdd={isMobile ? undefined : onAdd}
      insetTop={insetTop}
    />
  );

  const overviewStats = [
    {
      key: 'lots',
      icon: 'layers-outline',
      label: 'Lots',
      value: countsLoading ? '—' : String(lotSummary.lots),
      onPress: () => openPage('lots'),
    },
    {
      key: 'errors',
      icon: 'alert-circle-outline',
      label: 'Errors',
      value: countsLoading ? '—' : String(scopedErrors.count),
      onPress: () => openPage('errors'),
    },
    {
      key: 'analytics',
      icon: 'analytics-outline',
      label: 'Analytics',
      value: countsLoading ? '—' : String(scopedErrors.types.length),
      onPress: () => openPage('analytics'),
    },
  ];
  const overviewMeta = countsLoading
    ? 'Loading store…'
    : [
        scopedLots.length
          ? `${lotSummary.evaluated} evaluated · ${lotSummary.percent}%`
          : 'No lots yet',
        scopedErrors.count
          ? `${scopedErrors.count} ${scopedErrors.count === 1 ? 'error' : 'errors'}`
          : 'No flagged POs',
      ].join(' · ');

  const storeTools = desktopRail ? (
    <ChromePage filterPad={false} insetTop={insetTop}>
      <StoreOverviewHead storeName={selectedStore} subtitle={overviewMeta} stats={overviewStats} />
    </ChromePage>
  ) : (
    <ChromePage title={isMobile ? undefined : selectedStore} filterPad={false} insetTop={insetTop}>
      <ChromeListRow
        title="Lots"
        meta={
          scopedLots.length
            ? `${lotSummary.evaluated} evaluated · ${lotSummary.percent}% · ${lotSummary.lots} ${lotSummary.lots === 1 ? 'lot' : 'lots'}`
            : 'No lots yet'
        }
        value={String(lotSummary.lots)}
        icon="layers"
        iconColor="#8A6D1F"
        onPress={() => openPage('lots')}
      />
      <ChromeListRow
        title="Errors"
        meta={
          countsLoading
            ? 'Loading errors…'
            : scopedErrors.count
              ? [
                  scopedErrors.topType ? `${scopedErrors.topType.label} most common` : null,
                  scopedErrors.amount ? formatAmount(scopedErrors.amount) : null,
                  scopedErrors.stores ? `${scopedErrors.stores} ${scopedErrors.stores === 1 ? 'store' : 'stores'}` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')
              : 'No flagged POs yet'
        }
        value={String(scopedErrors.count)}
        loading={countsLoading}
        icon="alert-circle"
        iconColor="#B91C1C"
        onPress={() => openPage('errors')}
      />
      <ChromeListRow
        title="Analytics"
        meta={
          countsLoading
            ? 'Loading errors…'
            : scopedErrors.count
              ? `${scopedErrors.types.length} ${scopedErrors.types.length === 1 ? 'type' : 'types'} · ${scopedErrors.stores} ${scopedErrors.stores === 1 ? 'store' : 'stores'}`
              : 'Error type, item, employee, value'
        }
        value={scopedErrors.count ? `${scopedErrors.types.length}` : '0'}
        loading={countsLoading}
        icon="analytics"
        iconColor="#4F46E5"
        last
        onPress={() => openPage('analytics')}
      />
    </ChromePage>
  );

  return (
    <View style={[styles.body, isMobile && styles.bodyMobile]}>
      {page === 'errors' ? (
        openRow ? (
          <PoErrorSummaryPage
            po={openRow}
            onClose={closeOpenError}
            onEdit={() => setEditingError(true)}
          />
        ) : (
          <ErrorsPage
            rows={scopedErrors.rows}
            query={listQuery}
            onOpen={setOpenRow}
            onDelete={deletePo}
            inStore={Boolean(selectedStore)}
            sort={errorSort}
            hideTitle={desktopRail}
            insetTop={insetTop}
            toolbar={toolbar}
            storeName={selectedStore}
            desktopHead={desktopRail}
          />
        )
      ) : page === 'analytics' ? (
        <AnalyticsPage
          rows={scopedErrors.rows}
          insetTop={insetTop}
          toolbar={toolbar}
          storeName={selectedStore}
          desktopHead={desktopRail}
        />
      ) : page === 'lots' ? (
        <LotsPage
          lots={scopedLots}
          allRows={scopedAllRows}
          errors={scopedErrors}
          query={listQuery}
          onOpen={
            desktopRail
              ? (lot) => setOpenLotId(lot.id)
              : onOpenLot
                ? (lot) => onOpenLot(lot.id)
                : undefined
          }
          hideTitle={desktopRail}
          insetTop={insetTop}
          toolbar={toolbar}
          storeName={selectedStore}
          desktopHead={desktopRail}
          openLotId={desktopRail ? openLotId : ''}
          onOpenPo={(row) => {
            setOpenRow(row);
            setEditingError(true);
          }}
          onDeletePo={deletePo}
        />
      ) : selectedStore ? (
        storeTools
      ) : (
        home
      )}

      <TriageReviewDrawer
        visible={Boolean(openRow) && editingError}
        session={session}
        row={openRow}
        review={openRow?.review || null}
        extraRows={scopedErrors.rows}
        startAt="reporting"
        onClose={() => setEditingError(false)}
        onSave={saveReview}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    minHeight: 0,
    backgroundColor: T.bg,
  },
  bodyMobile: {
    backgroundColor: CANVAS,
  },
  homeScreen: {
    flex: 1,
    minHeight: 0,
    backgroundColor: CANVAS,
  },
  homeScreenMobile: {
    backgroundColor: CANVAS,
  },
  homeScroll: {
    flex: 1,
  },
  homeScrollContent: {
    alignItems: 'stretch',
    width: '100%',
  },
  homeInset: {
    alignSelf: 'center',
    width: '100%',
  },
  homeToolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingBottom: 12,
  },
  homeSearchMobileWrap: {
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0,
  },
  homeSearchWide: {
    maxWidth: '100%',
  },
  homeSearch: {
    flexGrow: 1,
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 32,
    minWidth: 0,
    maxWidth: 300,
    paddingHorizontal: 10,
    borderRadius: NAV_TAB_ACTIVE_RADIUS,
    borderWidth: 1,
    borderColor: '#d0d0d0',
    backgroundColor: CANVAS,
    ...Platform.select({
      web: { boxShadow: '0 1px 2px rgba(0,0,0,0.05)' },
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.06,
        shadowRadius: 2,
        elevation: 1,
      },
    }),
  },
  homeSearchInput: {
    flex: 1,
    minWidth: 0,
    height: 30,
    fontFamily,
    fontSize: 14,
    fontWeight: '400',
    color: MOBILE.label,
    paddingVertical: 0,
    letterSpacing: -0.2,
    ...Platform.select({
      web: { outlineStyle: 'none' },
      default: {},
    }),
  },
  homeAdd: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
    gap: 6,
    height: 32,
    paddingHorizontal: 10,
    borderRadius: NAV_TAB_ACTIVE_RADIUS,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  homeAddHover: {
    backgroundColor: '#f5f5f5',
  },
  homeAddLabel: {
    fontFamily,
    fontSize: 14,
    fontWeight: '500',
    color: '#1F8A4E',
    letterSpacing: -0.2,
  },
  homeSortBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingTop: 2,
    paddingBottom: 14,
  },
  homeSortLead: {
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0,
  },
  homeSortScroll: {
    flexGrow: 0,
    marginHorizontal: -8,
  },
  homeSortRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 4,
  },
  homeSortRowCompact: {
    flexWrap: 'nowrap',
    paddingHorizontal: 8,
  },
  homeSortItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingVertical: 6,
    paddingHorizontal: 8,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  homeSortText: {
    fontFamily,
    fontSize: 13,
    fontWeight: '400',
    color: '#8e8e93',
    letterSpacing: -0.08,
  },
  homeSortTextActive: {
    color: '#1d1d1f',
    fontWeight: '500',
  },
  homeGrid: {
    width: '100%',
    alignSelf: 'stretch',
    overflow: 'visible',
    ...Platform.select({
      web: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 320px), 1fr))',
        gap: 12,
      },
      default: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 12,
      },
    }),
  },
  homeGridCompact: {
    ...Platform.select({
      web: { gridTemplateColumns: '1fr' },
      default: {
        flexDirection: 'column',
        flexWrap: 'nowrap',
      },
    }),
  },
  homeGridItem: {
    minWidth: 0,
    ...Platform.select({
      web: { width: 'auto', maxWidth: '100%' },
      default: { flexGrow: 1 },
    }),
  },
  homeTile: {
    width: '100%',
    maxWidth: '100%',
    minHeight: 196,
    paddingLeft: 20,
    paddingRight: 20,
    paddingTop: 18,
    paddingBottom: 16,
    borderRadius: NAV_TAB_ACTIVE_RADIUS,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(60,60,67,0.22)',
    backgroundColor: '#fff',
    alignItems: 'stretch',
    gap: 16,
    ...Platform.select({
      web: { boxShadow: '0 1px 2px rgba(0,0,0,0.05)' },
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.06,
        shadowRadius: 2,
        elevation: 1,
      },
    }),
  },
  homeTilePressed: {
    backgroundColor: '#F2F2F7',
  },
  homeTileTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    width: '100%',
  },
  homeTileIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  homeTileTitleCol: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  homeTileName: {
    fontFamily,
    fontSize: 17,
    fontWeight: '600',
    color: '#1d1d1f',
    letterSpacing: -0.43,
  },
  homeTileMeta: {
    fontFamily,
    fontSize: 13,
    fontWeight: '400',
    color: '#8e8e93',
    letterSpacing: -0.08,
  },
  homeTileFigures: {
    gap: 2,
  },
  homeTileAmount: {
    fontFamily: FONT_LIGHT,
    fontSize: 34,
    lineHeight: 38,
    fontWeight: '400',
    color: '#1d1d1f',
    letterSpacing: -1.1,
    fontVariant: ['tabular-nums'],
  },
  homeTileSplit: {
    fontFamily,
    fontSize: 13,
    fontWeight: '400',
    color: '#8e8e93',
    letterSpacing: -0.08,
  },
  homeTileMetrics: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    width: '100%',
    gap: 16,
    paddingTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(60,60,67,0.12)',
  },
  homeTileStat: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  homeTileStatLabel: {
    fontFamily,
    fontSize: 12,
    fontWeight: '400',
    color: '#8e8e93',
    letterSpacing: -0.08,
  },
  homeTileStatValue: {
    fontFamily,
    fontSize: 17,
    fontWeight: '400',
    color: '#1d1d1f',
    letterSpacing: -0.43,
    fontVariant: ['tabular-nums'],
  },
  homeTileStatEmpty: {
    color: '#c7c7cc',
  },
  homeTileStatLow: {
    color: '#FF3B30',
  },
  homeTileStatHigh: {
    color: '#34C759',
  },
  homeEmpty: {
    paddingTop: 48,
    alignItems: 'center',
  },
  homeEmptyText: {
    fontFamily,
    fontSize: 15,
    lineHeight: 20,
    color: '#8e8e93',
    paddingTop: 20,
  },
  emptyCopy: {
    fontFamily,
    fontSize: 15,
    lineHeight: 20,
    color: '#8e8e93',
    paddingHorizontal: 16,
    paddingVertical: 18,
    backgroundColor: 'transparent',
  },
  regionBar: {
    marginTop: 6,
    alignSelf: 'stretch',
    maxWidth: 220,
  },
  storeTableShadow: {
    alignSelf: 'center',
    width: '100%',
    maxWidth: 960,
    marginHorizontal: 16,
    marginBottom: 16,
    borderRadius: 6,
    ...Platform.select({
      web: { boxShadow: '0 1px 2px rgba(0,0,0,0.05)' },
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.06,
        shadowRadius: 2,
        elevation: 1,
      },
    }),
  },
  storeTableCard: {
    width: '100%',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#d0d0d0',
    backgroundColor: CANVAS,
    overflow: 'hidden',
  },
  storeRow: {
    position: 'relative',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 46,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(42,38,30,0.08)',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  storeRowLast: {
    borderBottomWidth: 0,
  },
  storeRowHover: {
    backgroundColor: '#f5f5f5',
  },
  storeHead: {
    minHeight: 34,
    backgroundColor: CANVAS,
    ...Platform.select({
      web: { cursor: 'default' },
      default: {},
    }),
  },
  storeTotal: {
    minHeight: 46,
    backgroundColor: '#f5f5f5',
    ...Platform.select({
      web: { cursor: 'default' },
      default: {},
    }),
  },
  storeHeadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 3,
    minWidth: 0,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  storeHeadBtnEnd: {
    justifyContent: 'flex-start',
  },
  storeHeadText: {
    fontFamily,
    fontSize: 13,
    fontWeight: '500',
    color: MOBILE.secondary,
    letterSpacing: -0.15,
    textAlign: 'left',
  },
  storeHeadTextOn: {
    color: MOBILE.label,
    fontWeight: '600',
  },
  storeIconWrap: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    flexShrink: 0,
  },
  storeIconTile: {
    width: 22,
    height: 22,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  storeRowBody: {
    flex: 1,
    minWidth: 0,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 10,
    paddingRight: 8,
    ...Platform.select({
      web: {
        display: 'grid',
        gridTemplateColumns: 'minmax(160px, 1fr) 88px 120px minmax(260px, 320px)',
        columnGap: 28,
        justifyContent: 'stretch',
        alignItems: 'center',
      },
      default: { gap: 24 },
    }),
  },
  storeColStore: {
    minWidth: 0,
    alignItems: 'flex-start',
    justifyContent: 'center',
    ...Platform.select({
      default: {
        flexGrow: 1,
        flexShrink: 1,
        flexBasis: 200,
      },
    }),
  },
  storeColErrors: {
    minWidth: 0,
    alignItems: 'flex-start',
    justifyContent: 'center',
    ...Platform.select({
      default: { width: 88, flexShrink: 0 },
    }),
  },
  storeColAmount: {
    minWidth: 0,
    alignItems: 'flex-start',
    justifyContent: 'center',
    ...Platform.select({
      default: { width: 120, flexShrink: 0 },
    }),
  },
  storeColShare: {
    minWidth: 0,
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 10,
    ...Platform.select({
      default: {
        flexGrow: 1,
        flexShrink: 1,
        flexBasis: 260,
        maxWidth: 320,
        marginLeft: 'auto',
      },
    }),
  },
  storeName: {
    fontFamily,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '400',
    color: MOBILE.label,
    letterSpacing: -0.2,
    flexShrink: 1,
    minWidth: 0,
  },
  storeCell: {
    fontFamily,
    fontSize: 14,
    fontWeight: '400',
    color: MOBILE.label,
    letterSpacing: -0.2,
    fontVariant: ['tabular-nums'],
    textAlign: 'left',
    width: '100%',
  },
  storeAmount: {
    fontWeight: '300',
  },
  storeShareBar: {
    flex: 1,
    minWidth: 0,
    alignSelf: 'center',
  },
  storeSharePct: {
    fontFamily,
    width: 40,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '400',
    color: MOBILE.secondary,
    letterSpacing: -0.1,
    fontVariant: ['tabular-nums'],
    alignSelf: 'center',
    textAlign: 'left',
    includeFontPadding: false,
  },
  storeShareEmpty: {
    fontFamily,
    fontSize: 14,
    color: '#c7c7cc',
  },
  storeChevron: {
    position: 'absolute',
    right: 2,
    top: 0,
    bottom: 0,
    width: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  storeTotalLabel: {
    fontFamily,
    fontSize: 14,
    fontWeight: '600',
    color: MOBILE.label,
    letterSpacing: -0.2,
  },
  storeTotalCell: {
    fontFamily,
    fontSize: 14,
    fontWeight: '600',
    color: MOBILE.label,
    letterSpacing: -0.2,
    fontVariant: ['tabular-nums'],
    textAlign: 'left',
    width: '100%',
  },
  overviewHead: {
    marginBottom: 8,
    paddingTop: 20,
    paddingHorizontal: 48,
  },
  overviewHeadRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 24,
    paddingBottom: 32,
  },
  overviewTitleBlock: {
    flex: 1,
    minWidth: 0,
    paddingTop: 4,
    gap: 10,
  },
  overviewStoreName: {
    fontFamily,
    fontSize: 22,
    lineHeight: 26,
    fontWeight: '300',
    color: MOBILE.label,
    letterSpacing: -0.3,
    textAlign: 'left',
  },
  overviewStoreMeta: {
    fontFamily,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '400',
    color: MOBILE.secondary,
    letterSpacing: -0.15,
    maxWidth: 420,
  },
  overviewHeadRule: {
    alignSelf: 'stretch',
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(42,38,30,0.16)',
    marginTop: 4,
    marginBottom: 4,
  },
  overviewToolbarWrap: {
    paddingTop: 24,
    paddingBottom: 4,
  },
  overviewStatsBox: {
    width: 248,
    flexShrink: 0,
    borderRadius: NAV_TAB_ACTIVE_RADIUS,
    borderWidth: 1,
    borderColor: '#d0d0d0',
    backgroundColor: CANVAS,
    overflow: 'hidden',
    ...Platform.select({
      web: { boxShadow: '0 1px 2px rgba(0,0,0,0.05)' },
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.06,
        shadowRadius: 2,
        elevation: 1,
      },
    }),
  },
  overviewStatsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    minHeight: 32,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(42,38,30,0.08)',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  overviewStatsRowLast: {
    borderBottomWidth: 0,
  },
  overviewStatsRowHover: {
    backgroundColor: '#f5f5f5',
  },
  overviewStatsLead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minWidth: 0,
    flexShrink: 1,
  },
  overviewStatsLabel: {
    fontFamily,
    fontSize: 14,
    fontWeight: '400',
    color: MOBILE.secondary,
    letterSpacing: -0.2,
  },
  overviewStatsValue: {
    fontFamily,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '400',
    color: MOBILE.label,
    letterSpacing: -0.2,
    fontVariant: ['tabular-nums'],
    textAlign: 'right',
  },
  contextTableWrap: {
    paddingHorizontal: 48,
    paddingBottom: 32,
  },
  contextTableShadow: {
    alignSelf: 'stretch',
    width: '100%',
    borderRadius: 6,
    ...Platform.select({
      web: { boxShadow: '0 1px 2px rgba(0,0,0,0.05)' },
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.06,
        shadowRadius: 2,
        elevation: 1,
      },
    }),
  },
  contextRowBody: {
    flex: 1,
    minWidth: 0,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 10,
    paddingRight: 28,
    ...Platform.select({
      default: { gap: 20 },
    }),
  },
  contextRowBodyTrail: {
    paddingRight: 72,
  },
  contextRowStatic: {
    ...Platform.select({
      web: { cursor: 'default' },
      default: {},
    }),
  },
  contextCol: {
    minWidth: 0,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  contextProgress: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 10,
  },
  contextTrail: {
    position: 'absolute',
    right: 26,
    top: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    zIndex: 2,
  },
  contextGridLots: Platform.select({
    web: {
      display: 'grid',
      gridTemplateColumns: 'minmax(180px, 1.4fr) 140px 72px minmax(200px, 1fr) 72px',
      columnGap: 24,
      alignItems: 'center',
    },
    default: {},
  }),
  contextGridErrors: Platform.select({
    web: {
      display: 'grid',
      gridTemplateColumns: 'minmax(140px, 1.2fr) minmax(120px, 1fr) 120px 110px 100px',
      columnGap: 24,
      alignItems: 'center',
    },
    default: {},
  }),
  contextGridErrorsWide: Platform.select({
    web: {
      display: 'grid',
      gridTemplateColumns: 'minmax(140px, 1.1fr) minmax(110px, 1fr) minmax(110px, 1fr) 110px 100px 100px',
      columnGap: 20,
      alignItems: 'center',
    },
    default: {},
  }),
  contextGridAnalytics: Platform.select({
    web: {
      display: 'grid',
      gridTemplateColumns: 'minmax(160px, 1.3fr) 80px 110px minmax(200px, 1fr)',
      columnGap: 24,
      alignItems: 'center',
    },
    default: {},
  }),
  contextGridAnalyticsWide: Platform.select({
    web: {
      display: 'grid',
      gridTemplateColumns: 'minmax(140px, 1.1fr) minmax(120px, 1fr) 80px 110px minmax(180px, 1fr)',
      columnGap: 20,
      alignItems: 'center',
    },
    default: {},
  }),
  contextGridLotPos: Platform.select({
    web: {
      display: 'grid',
      gridTemplateColumns: 'minmax(140px, 1.2fr) 110px 120px 88px 100px',
      columnGap: 24,
      alignItems: 'center',
    },
    default: {},
  }),
  lotStatusError: {
    color: '#B91C1C',
  },
  lotStatusOk: {
    color: '#15803D',
  },
  analyticsTabs: {
    paddingHorizontal: 4,
    paddingBottom: 8,
  },
  analyticsTabsMobile: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 10,
  },
  analyticsRowBar: {
    marginTop: 6,
    alignSelf: 'stretch',
    maxWidth: 220,
  },
  errorRowActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingRight: 2,
  },
  lotRowBar: {
    marginTop: 6,
    alignSelf: 'stretch',
    maxWidth: 220,
  },
  breakScroll: {
    flex: 1,
    minHeight: 0,
  },
  breakPad: {
    paddingHorizontal: 22,
    paddingTop: 18,
    paddingBottom: 40,
  },
  breakPadMobile: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 28,
  },
  breakKicker: {
    fontFamily,
    fontSize: 11,
    fontWeight: '600',
    color: T.secondary,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  breakValue: {
    fontFamily,
    fontSize: 34,
    fontWeight: '600',
    color: T.text,
    letterSpacing: -0.8,
    marginTop: 4,
  },
  breakMeta: {
    fontFamily,
    fontSize: 13,
    color: T.secondary,
    marginTop: 2,
    marginBottom: 10,
  },
  breakSection: {
    marginTop: 22,
    marginBottom: 8,
  },
  breakRow: {
    paddingVertical: 8,
    gap: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: T.hairline,
  },
  breakRowLast: {
    borderBottomWidth: 0,
  },
  breakCopy: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 12,
  },
  breakLabel: {
    fontFamily,
    flex: 1,
    minWidth: 0,
    fontSize: 15,
    color: T.text,
  },
  breakCount: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: T.secondary,
    fontVariant: ['tabular-nums'],
  },
  breakHint: {
    fontFamily,
    fontSize: 12,
    color: T.secondary,
  },
  breakBar: {
    marginTop: 2,
  },
});
