/**
 * Dashboard Stores: every store, month-filtered error POs, then store details tabs.
 */
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { formatAmount } from '../lib/transactions';
import { formatErrorAmount } from '../lib/triageDraft';
import { formatInsightPercent } from '../lib/triageInsights';
import { storeMarkColor, storeShortCode } from '../lib/storeMarks';
import {
  canAdvanceErrorMonth,
  currentReviewMonth,
  errorEmployeeName,
  errorTypeOf,
  listStoreErrorSummaries,
  shiftErrorMonth,
  storeErrorSummary,
} from '../lib/triageStoreErrors';
import { MOBILE, MOBILE_FILTER_INSET, useIsMobile } from '../lib/mobileUi';
import {
  ChromeHero,
  ChromeListRow,
  ChromePage,
  EmptyState,
  FONT,
  ProgressBar,
  T,
  TextTabs,
} from './TriageKit';
import { PoThumb } from './TriageTable';

const fontFamily = FONT;

const DETAIL_TABS = [
  { key: 'type', label: 'Error Type' },
  { key: 'employees', label: 'Employees' },
  { key: 'value', label: 'Value' },
  { key: 'items', label: 'Items' },
];

const DETAIL_TABS_MOBILE = [
  { key: 'type', label: 'Type' },
  { key: 'employees', label: 'Employees' },
  { key: 'value', label: 'Value' },
  { key: 'items', label: 'Items' },
];

function StoreMark({ name, size = 46 }) {
  const code = storeShortCode(name);
  return (
    <View
      style={[
        styles.storeMark,
        { width: size, height: size, backgroundColor: storeMarkColor(name) },
      ]}
    >
      <Text style={[styles.storeMarkText, size < 32 && styles.storeMarkTextSm]} numberOfLines={1}>
        {code || '—'}
      </Text>
    </View>
  );
}

function MonthNav({ month, onChange, action = null }) {
  const isMobile = useIsMobile();
  const current = currentReviewMonth();
  const canForward = canAdvanceErrorMonth(month);
  const isCurrent = month?.startDate === current.startDate && month?.endDate === current.endDate;

  return (
    <View style={[styles.monthBar, isMobile && styles.monthBarMobile]}>
      <View style={styles.monthNav}>
        <Pressable
          style={[styles.monthBtn, isMobile && styles.monthBtnMobile]}
          onPress={() => onChange(shiftErrorMonth(month, -1))}
          hitSlop={10}
          accessibilityLabel="Previous month"
        >
          <Ionicons name="chevron-back" size={isMobile ? 22 : 18} color={isMobile ? MOBILE.blue : T.text} />
        </Pressable>
        <Pressable
          style={styles.monthCopy}
          onPress={() => onChange(current)}
          accessibilityRole="button"
          accessibilityLabel={month?.label || current.label}
        >
          <Text style={[styles.monthLabel, isMobile && styles.monthLabelMobile]} numberOfLines={1}>
            {month?.label || current.label}
          </Text>
          <Text style={styles.monthSub} numberOfLines={1}>
            {isCurrent ? 'Current month' : 'Tap for this month'}
          </Text>
        </Pressable>
        <Pressable
          style={[styles.monthBtn, isMobile && styles.monthBtnMobile, !canForward && styles.monthBtnDisabled]}
          onPress={() => onChange(shiftErrorMonth(month, 1))}
          disabled={!canForward}
          hitSlop={10}
          accessibilityLabel="Next month"
        >
          <Ionicons
            name="chevron-forward"
            size={isMobile ? 22 : 18}
            color={canForward ? (isMobile ? MOBILE.blue : T.text) : '#c4c4c4'}
          />
        </Pressable>
      </View>
      {action}
    </View>
  );
}

function matchesRowQuery(row, query) {
  const q = String(query || '')
    .trim()
    .toLowerCase();
  if (!q) return true;
  return [
    row.reference,
    errorEmployeeName(row),
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

function RankRow({ title, meta, value, count, total, last }) {
  const isMobile = useIsMobile();
  return (
    <View style={[styles.rankRow, isMobile && styles.rankRowMobile, last && styles.rankRowLast]}>
      <View style={styles.rankCopy}>
        <Text style={[styles.rankTitle, isMobile && styles.rankTitleMobile]} numberOfLines={1}>
          {title}
        </Text>
        {meta ? (
          <Text style={styles.rankMeta} numberOfLines={2}>
            {meta}
          </Text>
        ) : null}
        <ProgressBar value={count} total={total || count || 1} tone="orange" height={4} style={styles.rankBar} />
      </View>
      <Text style={[styles.rankValue, isMobile && styles.rankValueMobile]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function StoreListPage({ stores, query, month, onMonthChange, onOpen }) {
  const isMobile = useIsMobile();
  const visible = useMemo(() => {
    const q = String(query || '')
      .trim()
      .toLowerCase();
    if (!q) return stores;
    return stores.filter((row) => row.store.toLowerCase().includes(q));
  }, [query, stores]);
  const totals = useMemo(
    () =>
      visible.reduce(
        (acc, row) => {
          acc.count += row.count;
          acc.amount += row.amount;
          if (row.count) acc.withErrors += 1;
          return acc;
        },
        { count: 0, amount: 0, withErrors: 0 },
      ),
    [visible],
  );

  return (
    <ChromePage
      hero={
        <View>
          <MonthNav month={month} onChange={onMonthChange} />
          <ChromeHero
            icon="storefront"
            iconColor="#1F7A9A"
            value={totals.amount ? formatAmount(totals.amount) : String(totals.count)}
            stats={[
              { label: totals.count === 1 ? 'Error' : 'Errors', value: String(totals.count) },
              { label: totals.withErrors === 1 ? 'Store' : 'Stores', value: String(totals.withErrors) },
              { label: month?.label || 'Month', value: String(visible.length) },
            ]}
          />
        </View>
      }
      title="Stores"
      meta={`${month?.label || ''} · ${visible.length} ${visible.length === 1 ? 'store' : 'stores'}`}
      data={visible}
      extraData={`${month?.startDate}:${visible.map((row) => `${row.store}:${row.count}`).join('|')}`}
      keyExtractor={(row) => row.store}
      renderItem={({ item: row, index }) => (
        <ChromeListRow
          title={row.store}
          meta={
            row.count
              ? [
                  row.topType ? `${row.topType.label} most common` : null,
                  `${row.count} ${row.count === 1 ? 'error' : 'errors'}`,
                ]
                  .filter(Boolean)
                  .join(' · ')
              : 'No errors this month'
          }
          value={row.amount ? formatAmount(row.amount) : String(row.count)}
          leading={<StoreMark name={row.store} size={isMobile ? 40 : 46} />}
          last={index === visible.length - 1}
          onPress={() => onOpen(row.store)}
        />
      )}
    >
      {visible.length ? null : (
        <Text style={styles.emptyCopy}>
          {query.trim() ? `No store matches “${query.trim()}”.` : 'No stores to show.'}
        </Text>
      )}
    </ChromePage>
  );
}

function StoreErrorsPage({ store, query, month, onMonthChange, onOpen, onOpenDetails }) {
  const isMobile = useIsMobile();
  const visible = useMemo(() => store.rows.filter((row) => matchesRowQuery(row, query)), [query, store.rows]);
  const amount = useMemo(
    () => visible.reduce((sum, row) => sum + (Number(String(row?.review?.errorAmount || '').replace(/[^0-9.-]/g, '')) || 0), 0),
    [visible],
  );

  return (
    <ChromePage
      hero={
        <View>
          <MonthNav
            month={month}
            onChange={onMonthChange}
            action={
              isMobile ? (
                <Pressable
                  onPress={onOpenDetails}
                  style={styles.detailsChip}
                  accessibilityRole="button"
                  accessibilityLabel="Open store error details"
                >
                  <Text style={styles.detailsChipText}>Details</Text>
                  <Ionicons name="chevron-forward" size={16} color={MOBILE.blue} />
                </Pressable>
              ) : null
            }
          />
          <ChromeHero
            icon="alert-circle"
            iconColor="#B91C1C"
            value={amount ? formatAmount(amount) : String(visible.length)}
            stats={[
              { label: visible.length === 1 ? 'Error' : 'Errors', value: String(visible.length) },
              { label: store.types.length === 1 ? 'Type' : 'Types', value: String(store.types.length) },
              { label: store.employees.length === 1 ? 'Employee' : 'Employees', value: String(store.employees.length) },
            ]}
            onPress={onOpenDetails}
            accessibilityLabel="Open store error details"
          />
        </View>
      }
      title={store.store}
      meta={`${month?.label || ''} · ${visible.length} ${visible.length === 1 ? 'error' : 'errors'}`}
      data={visible}
      extraData={`${store.store}:${month?.startDate}:${visible.length}`}
      keyExtractor={(row) => `${row.triageId}-${row.id}`}
      renderItem={({ item: row, index }) => (
        <ChromeListRow
          title={row.reference || 'Document'}
          meta={[errorTypeOf(row), errorEmployeeName(row), row.dateLabel].filter(Boolean).join(' · ')}
          value={formatErrorAmount(row?.review?.errorAmount || '') || ''}
          leading={<PoThumb urls={row.imageUrls} label={row.reference} size={isMobile ? 40 : 46} />}
          last={index === visible.length - 1}
          onPress={() => onOpen(row)}
        />
      )}
    >
      {visible.length ? null : (
        <Text style={styles.emptyCopy}>
          {store.rows.length
            ? `No error matches “${query.trim()}”.`
            : `No flagged POs at ${store.store} in ${month?.label || 'this month'}.`}
        </Text>
      )}
    </ChromePage>
  );
}

function StoreDetailsPage({ store, month, onMonthChange }) {
  const isMobile = useIsMobile();
  const [tab, setTab] = useState('type');
  const total = store.count || 0;
  const tabs = (
    <View style={[styles.tabsWrap, isMobile && styles.tabsWrapMobile]}>
      <TextTabs
        options={isMobile ? DETAIL_TABS_MOBILE : DETAIL_TABS}
        value={tab}
        onChange={setTab}
        size={isMobile ? 'md' : 'lg'}
        layout={isMobile ? 'bar' : 'inline'}
      />
    </View>
  );

  let body = null;
  if (tab === 'type') {
    body = store.types.length ? (
      store.types.map((row, index) => (
        <RankRow
          key={row.label}
          title={row.label}
          meta={`${row.count} of ${total} · ${formatInsightPercent(row.percent, total)}`}
          value={formatInsightPercent(row.percent, total)}
          count={row.count}
          total={total}
          last={index === store.types.length - 1}
        />
      ))
    ) : (
      <Text style={styles.emptyCopy}>No error types this month.</Text>
    );
  } else if (tab === 'employees') {
    body = store.employees.length ? (
      store.employees.map((row, index) => (
        <RankRow
          key={row.name}
          title={row.name}
          meta={`${row.count} ${row.count === 1 ? 'error' : 'errors'}`}
          value={row.amount ? formatAmount(row.amount) : String(row.count)}
          count={row.count}
          total={total}
          last={index === store.employees.length - 1}
        />
      ))
    ) : (
      <Text style={styles.emptyCopy}>No employees with errors this month.</Text>
    );
  } else if (tab === 'value') {
    body = (
      <View style={styles.valueBlock}>
        <Text style={styles.valueHero}>{store.amount ? formatAmount(store.amount) : '$0.00'}</Text>
        <Text style={styles.valueMeta}>
          {total
            ? `${total} ${total === 1 ? 'error' : 'errors'} · avg ${formatAmount(store.average)}`
            : `No error value at ${store.store} in ${month?.label || 'this month'}`}
        </Text>
      </View>
    );
  } else {
    body = store.items.length ? (
      store.items.map((row, index) => (
        <RankRow
          key={row.label}
          title={row.label}
          meta={`${row.count} ${row.count === 1 ? 'error' : 'errors'} · ${formatInsightPercent(row.percent, total)}`}
          value={`${row.count} · ${formatInsightPercent(row.percent, total)}`}
          count={row.count}
          total={total}
          last={index === store.items.length - 1}
        />
      ))
    ) : (
      <Text style={styles.emptyCopy}>No item categories this month.</Text>
    );
  }

  const heroValue =
    tab === 'value'
      ? store.amount
        ? formatAmount(store.amount)
        : '$0.00'
      : tab === 'type'
        ? store.topType
          ? formatInsightPercent(store.topType.percent, total)
          : '—'
        : String(total);

  const heroStats =
    tab === 'type'
      ? [
          { label: isMobile ? 'Common' : 'Most common', value: store.topType?.label || '—' },
          { label: 'Share', value: store.topType ? formatInsightPercent(store.topType.percent, total) : '—' },
          { label: store.types.length === 1 ? 'Type' : 'Types', value: String(store.types.length) },
        ]
      : tab === 'employees'
        ? [
            { label: store.employees.length === 1 ? 'Employee' : 'Employees', value: String(store.employees.length) },
            { label: total === 1 ? 'Error' : 'Errors', value: String(total) },
            { label: 'Value', value: store.amount ? formatAmount(store.amount) : '$0.00' },
          ]
        : tab === 'value'
          ? [
              { label: total === 1 ? 'Error' : 'Errors', value: String(total) },
              { label: 'Average', value: total ? formatAmount(store.average) : '—' },
              { label: 'Month', value: month?.label?.split(' ')[0] || '—' },
            ]
          : [
              { label: store.items.length === 1 ? 'Category' : 'Categories', value: String(store.items.length) },
              { label: total === 1 ? 'Error' : 'Errors', value: String(total) },
              { label: 'Top', value: store.items[0]?.label || '—' },
            ];

  return (
    <ChromePage
      hero={
        <View>
          <MonthNav month={month} onChange={onMonthChange} />
          <ChromeHero icon="analytics" iconColor="#6D28D9" value={heroValue} stats={heroStats} />
          {isMobile ? tabs : null}
        </View>
      }
      title={store.store}
      meta={month?.label || ''}
    >
      {isMobile ? null : tabs}
      <View style={[styles.tabBody, isMobile && styles.tabBodyMobile]}>{body}</View>
    </ChromePage>
  );
}

export default function TriageStoresPanel({
  rows = [],
  query = '',
  month,
  onMonthChange,
  selectedStore = '',
  detailsOpen = false,
  onOpenStore,
  onOpenDetails,
  onOpenPo,
}) {
  const stores = useMemo(() => listStoreErrorSummaries(rows, month), [month, rows]);
  const store = useMemo(
    () => (selectedStore ? storeErrorSummary(stores, selectedStore) : null),
    [selectedStore, stores],
  );

  if (store && detailsOpen) {
    return <StoreDetailsPage store={store} month={month} onMonthChange={onMonthChange} />;
  }

  if (store) {
    return (
      <StoreErrorsPage
        store={store}
        query={query}
        month={month}
        onMonthChange={onMonthChange}
        onOpen={onOpenPo}
        onOpenDetails={onOpenDetails}
      />
    );
  }

  if (selectedStore) {
    return (
      <EmptyState
        icon="storefront-outline"
        title={selectedStore}
        body={`No store data for ${selectedStore}.`}
      />
    );
  }

  return (
    <StoreListPage
      stores={stores}
      query={query}
      month={month}
      onMonthChange={onMonthChange}
      onOpen={onOpenStore}
    />
  );
}

const styles = StyleSheet.create({
  monthBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
    paddingHorizontal: 2,
  },
  monthBarMobile: {
    marginBottom: 8,
    paddingRight: 4,
  },
  monthNav: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  monthBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  monthBtnMobile: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'transparent',
  },
  monthBtnDisabled: {
    opacity: 0.5,
  },
  monthCopy: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
  },
  monthLabel: {
    fontFamily,
    fontSize: 17,
    fontWeight: '600',
    color: T.text,
    letterSpacing: -0.3,
  },
  monthLabelMobile: {
    fontSize: 16,
    textAlign: 'center',
  },
  monthSub: {
    fontFamily,
    fontSize: 12,
    color: T.secondary,
    marginTop: 1,
  },
  detailsChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexShrink: 0,
  },
  detailsChipText: {
    fontFamily,
    fontSize: 16,
    fontWeight: '600',
    color: MOBILE.blue,
  },
  storeMark: {
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  storeMarkText: {
    fontFamily,
    fontSize: 13,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: 0.3,
  },
  storeMarkTextSm: {
    fontSize: 11,
  },
  emptyCopy: {
    fontFamily,
    fontSize: 15,
    lineHeight: 20,
    color: '#8e8e93',
    paddingHorizontal: 16,
    paddingVertical: 18,
    backgroundColor: '#fff',
  },
  tabsWrap: {
    backgroundColor: '#fff',
    paddingTop: 4,
  },
  tabsWrapMobile: {
    marginTop: 10,
    marginHorizontal: -MOBILE_FILTER_INSET,
    backgroundColor: 'transparent',
  },
  tabBody: {
    backgroundColor: '#fff',
  },
  tabBodyMobile: {
    backgroundColor: '#fff',
  },
  rankRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: T.hairline,
    backgroundColor: '#fff',
  },
  rankRowMobile: {
    minHeight: 64,
    paddingVertical: 14,
    alignItems: 'flex-start',
  },
  rankRowLast: {
    borderBottomWidth: 0,
  },
  rankCopy: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  rankTitle: {
    fontFamily,
    fontSize: 16,
    color: T.text,
  },
  rankTitleMobile: {
    fontSize: 17,
  },
  rankMeta: {
    fontFamily,
    fontSize: 13,
    color: T.secondary,
  },
  rankBar: {
    marginTop: 2,
    maxWidth: 220,
    alignSelf: 'stretch',
  },
  rankValue: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: T.text,
    fontVariant: ['tabular-nums'],
  },
  rankValueMobile: {
    fontSize: 16,
    paddingTop: 2,
  },
  valueBlock: {
    paddingHorizontal: 16,
    paddingVertical: 22,
    backgroundColor: '#fff',
  },
  valueHero: {
    fontFamily,
    fontSize: 34,
    fontWeight: '600',
    color: T.text,
    letterSpacing: -0.8,
  },
  valueMeta: {
    fontFamily,
    fontSize: 14,
    color: T.secondary,
    marginTop: 4,
  },
});
