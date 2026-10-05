/**
 * Dashboard Stores: Home-style store table, then store POs and insight tabs.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  fetchSearchCreatedByNames,
  fetchTransactionDetail,
  formatAmount,
  posCreatedByName,
  posDocumentId,
  resolvePosAuthForRow,
} from '../lib/transactions';
import { formatInsightPercent } from '../lib/triageInsights';
import { storeMarkColor } from '../lib/storeMarks';
import {
  errorAmountOf,
  errorEmployeeName,
  errorTypeOf,
  listStoreErrorSummaries,
  storeErrorSummary,
  summarizeStoreErrors,
} from '../lib/triageStoreErrors';
import { MOBILE, MOBILE_FILTER_INSET, MOBILE_TOP_FILTER_SIZE, NAV_TAB_ACTIVE_BG, NAV_TAB_ACTIVE_RADIUS, useIsMobile } from '../lib/mobileUi';
import {
  ChromePage,
  EmptyState,
  FONT,
  ProgressBar,
  T,
  TextTabs,
} from './TriageKit';
import { PoThumb } from './TriageTable';

const fontFamily = FONT;

export const STORE_INSIGHT_TABS = [
  { key: 'purchases', label: 'Purchases' },
  { key: 'type', label: 'Error Type' },
  { key: 'employees', label: 'Employees' },
  { key: 'value', label: 'Value' },
  { key: 'items', label: 'Items' },
];

export const STORE_INSIGHT_TABS_MOBILE = [
  { key: 'purchases', label: 'Purchases' },
  { key: 'type', label: 'Type' },
  { key: 'employees', label: 'Employees' },
  { key: 'value', label: 'Value' },
  { key: 'items', label: 'Items' },
];

function StorefrontMark({ name, faded = false }) {
  return (
    <View style={styles.homeIconWrap}>
      <View
        style={[
          styles.homeIconTile,
          { backgroundColor: storeMarkColor(name) },
          faded && styles.homeIconFaded,
        ]}
      >
        <Ionicons name="storefront" size={14} color="#fff" />
      </View>
    </View>
  );
}

function HomeLikeRule({ last, header = false }) {
  if (last && !header) return null;
  return <View pointerEvents="none" style={[styles.homeRule, header && styles.homeRuleHeader]} />;
}

function HomeLikeTableHeader({ storeLabel, countLabel, valueLabel }) {
  const isMobile = useIsMobile();
  return (
    <View style={[styles.homeRow, styles.homeHeaderRow, isMobile && styles.homeRowMobile]}>
      <View style={[styles.homeIconSpacer, isMobile && styles.homeIconSpacerMobile]} />
      <View style={[styles.homeRowBody, isMobile && styles.homeRowBodyMobile]}>
        <View style={[styles.homeColStore, isMobile && styles.homeColStoreMobile]}>
          <Text style={[styles.homeHeader, isMobile && styles.homeHeaderMobile]}>{storeLabel}</Text>
        </View>
        <View style={[styles.homeColCount, isMobile && styles.homeColCountMobile]}>
          <Text
            style={[styles.homeHeader, styles.homeHeaderEnd, isMobile && styles.homeHeaderMobile]}
            numberOfLines={1}
          >
            {countLabel}
          </Text>
        </View>
        <View style={[styles.homeColMoney, isMobile && styles.homeColMoneyMobile]}>
          <Text
            style={[styles.homeHeader, styles.homeHeaderEnd, isMobile && styles.homeHeaderMobile]}
            numberOfLines={1}
          >
            {valueLabel}
          </Text>
        </View>
        <View style={[styles.homeChevron, isMobile && styles.homeChevronMobile]} />
      </View>
    </View>
  );
}

function typeEntries(types) {
  return (types || [])
    .map((entry) =>
      typeof entry === 'string'
        ? { label: entry, count: 0 }
        : { label: String(entry?.label || '').trim(), count: Number(entry?.count) || 0 },
    )
    .filter((entry) => entry.label);
}

function TypeTipLabel({ label, types, faded, mobile, onOpenChange }) {
  const entries = typeEntries(types);
  const [open, setOpen] = useState(false);
  const show = (next) => {
    setOpen(next);
    onOpenChange?.(next);
  };
  const text = (
    <Text
      style={[styles.homeCount, mobile && styles.homeCountMobile, faded && styles.homeMoneyEmpty]}
      numberOfLines={mobile ? 2 : 1}
    >
      {label}
    </Text>
  );
  if (entries.length < 2) return text;

  return (
    <Pressable
      onHoverIn={() => show(true)}
      onHoverOut={() => show(false)}
      onPress={() => show(!open)}
      style={styles.typeTipHit}
      accessibilityRole="button"
      accessibilityLabel={entries.map((entry) => entry.label).join(', ')}
      accessibilityState={{ expanded: open }}
    >
      {text}
      {open ? (
        <View style={styles.typeTipCard} pointerEvents="none">
          {entries.map((entry) => (
            <View key={entry.label} style={styles.typeTipRow}>
              <Text style={styles.typeTipName}>{entry.label}</Text>
              {entry.count ? <Text style={styles.typeTipCount}>{entry.count}</Text> : null}
            </View>
          ))}
        </View>
      ) : null}
    </Pressable>
  );
}

function HomeLikeRow({
  title,
  meta,
  count,
  countLabel,
  countTypes,
  amount,
  storeName,
  last,
  onPress,
  leading,
}) {
  const isMobile = useIsMobile();
  const faded = !count;
  const [tipOpen, setTipOpen] = useState(false);
  const rowBody = (
    <View
      style={[styles.homeRowBody, isMobile && styles.homeRowBodyMobile]}
      pointerEvents={onPress ? 'none' : 'auto'}
    >
      <View style={[styles.homeColStore, isMobile && styles.homeColStoreMobile]}>
        <Text style={[styles.homeName, isMobile && styles.homeNameMobile]} numberOfLines={1}>
          {title}
        </Text>
        {meta ? (
          <Text style={styles.homeMeta} numberOfLines={isMobile ? 2 : 1}>
            {meta}
          </Text>
        ) : null}
      </View>
      <View style={[styles.homeColCount, isMobile && styles.homeColCountMobile]}>
        <TypeTipLabel
          label={countLabel != null ? countLabel : count || '—'}
          types={countTypes}
          faded={faded}
          mobile={isMobile}
          onOpenChange={setTipOpen}
        />
      </View>
      <View style={[styles.homeColMoney, isMobile && styles.homeColMoneyMobile]}>
        <Text
          style={[styles.homeMoney, isMobile && styles.homeMoneyMobile, !amount && styles.homeMoneyEmpty]}
          numberOfLines={1}
        >
          {amount ? formatAmount(amount) : '—'}
        </Text>
      </View>
      <View style={[styles.homeChevron, isMobile && styles.homeChevronMobile]}>
        {onPress ? <Ionicons name="chevron-forward" size={isMobile ? 12 : 14} color="#c7c7cc" /> : null}
      </View>
    </View>
  );

  const mark = leading || <StorefrontMark name={storeName || title} faded={faded} />;

  if (!onPress) {
    return (
      <View style={[styles.homeRow, isMobile && styles.homeRowMobile, tipOpen && styles.homeRowTipOpen]}>
        {mark}
        {rowBody}
        <HomeLikeRule last={last} />
      </View>
    );
  }

  if (Platform.OS === 'web') {
    return (
      <View style={[styles.homeRow, isMobile && styles.homeRowMobile]}>
        <Pressable
          onPress={onPress}
          style={({ hovered, pressed }) => [
            StyleSheet.absoluteFill,
            (hovered || pressed) && styles.homeRowHovered,
          ]}
          accessibilityRole="button"
          accessibilityLabel={title}
        />
        <View pointerEvents="none" style={styles.homeRowForeground}>
          {mark}
          {rowBody}
        </View>
        <HomeLikeRule last={last} />
      </View>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      style={({ hovered, pressed }) => [
        styles.homeRow,
        isMobile && styles.homeRowMobile,
        (hovered || pressed) && styles.homeRowHoveredNative,
      ]}
      accessibilityRole="button"
      accessibilityLabel={title}
    >
      {mark}
      {rowBody}
      <HomeLikeRule last={last} />
    </Pressable>
  );
}

function HomeLikeTotalRow({ label, count, amount }) {
  const isMobile = useIsMobile();
  return (
    <View style={[styles.homeRow, styles.homeTotalRow, isMobile && styles.homeRowMobile]}>
      <View style={[styles.homeIconSpacer, isMobile && styles.homeIconSpacerMobile]} />
      <View style={[styles.homeRowBody, isMobile && styles.homeRowBodyMobile]}>
        <View style={[styles.homeColStore, isMobile && styles.homeColStoreMobile]}>
          <Text style={[styles.homeTotalLabel, isMobile && styles.homeNameMobile]} numberOfLines={1}>
            {label}
          </Text>
        </View>
        <View style={[styles.homeColCount, isMobile && styles.homeColCountMobile]}>
          <Text style={[styles.homeCount, styles.homeTotalLabel, isMobile && styles.homeCountMobile]}>
            {count || '—'}
          </Text>
        </View>
        <View style={[styles.homeColMoney, isMobile && styles.homeColMoneyMobile]}>
          <Text style={[styles.homeMoney, styles.homeTotalLabel, isMobile && styles.homeMoneyMobile]}>
            {amount ? formatAmount(amount) : '—'}
          </Text>
        </View>
        <View style={[styles.homeChevron, isMobile && styles.homeChevronMobile]} />
      </View>
    </View>
  );
}

function usePurchaseEmployees(rows, session) {
  const [byId, setById] = useState({});
  const fetchedRef = useRef(new Set());
  const list = Array.isArray(rows) ? rows : [];
  const listKey = list.map((row) => String(row?.id || '')).join('|');
  const rowsRef = useRef(list);
  rowsRef.current = list;

  useEffect(() => {
    if (!session?.token) return undefined;
    const missing = rowsRef.current.filter((row) => {
      const id = String(row?.id || '');
      if (!id || fetchedRef.current.has(id) || !posDocumentId(row)) return false;
      return errorEmployeeName(row) === 'Unspecified';
    });
    if (!missing.length) return undefined;

    let cancelled = false;
    missing.forEach((row) => fetchedRef.current.add(String(row.id)));

    (async () => {
      const found = {};
      const groups = new Map();
      for (const row of missing) {
        const auth = resolvePosAuthForRow(session, row);
        if (!auth?.token) continue;
        const day = String(row?.date || '').slice(0, 10);
        const key = `${auth.baseUrl}|${auth.token}|${day || 'range'}`;
        const group = groups.get(key) || { auth, rows: [], days: [] };
        group.rows.push(row);
        if (/^\d{4}-\d{2}-\d{2}$/.test(day)) group.days.push(day);
        groups.set(key, group);
      }

      for (const group of groups.values()) {
        if (cancelled) return;
        const days = [...new Set(group.days)].sort();
        const startDate = days[0];
        const endDate = days[days.length - 1] || days[0];
        if (startDate) {
          try {
            const names = await fetchSearchCreatedByNames(group.auth.token, {
              startDate,
              endDate,
              baseUrl: group.auth.baseUrl,
              includePurchases: group.rows.some((row) => (row.type || 'purchase') !== 'order'),
              includeOrders: group.rows.some((row) => row.type === 'order'),
            });
            for (const row of group.rows) {
              const name = names[posDocumentId(row)];
              if (name) found[String(row.id)] = name;
            }
          } catch {
            // Fall through to the document lookup below.
          }
        }

        for (const row of group.rows) {
          if (cancelled) return;
          if (found[String(row.id)]) continue;
          try {
            const detail = await fetchTransactionDetail(group.auth.token, {
              type: row.type || 'purchase',
              sourceId: posDocumentId(row),
              baseUrl: group.auth.baseUrl,
            });
            const name = posCreatedByName(detail);
            if (name) found[String(row.id)] = name;
          } catch {
            // Leave unspecified when Aureus has no created_by.
          }
        }
      }

      if (!cancelled && Object.keys(found).length) {
        setById((prev) => ({ ...prev, ...found }));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [listKey, session?.token]);

  return byId;
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
        <Text style={[styles.rankTitle, isMobile && styles.rankTitleMobile]} numberOfLines={isMobile ? 2 : 1}>
          {title}
        </Text>
        {meta ? (
          <Text style={styles.rankMeta} numberOfLines={2}>
            {meta}
          </Text>
        ) : null}
        <ProgressBar value={count} total={total || count || 1} tone="orange" height={4} style={styles.rankBar} />
      </View>
      <Text style={[styles.rankValue, isMobile && styles.rankValueMobile]}>
        {value}
      </Text>
    </View>
  );
}

function StoreListPage({ stores, query, onOpen, month }) {
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
          return acc;
        },
        { count: 0, amount: 0 },
      ),
    [visible],
  );

  return (
    <ChromePage
      tableHeader={<HomeLikeTableHeader storeLabel="Store" countLabel="Errors" valueLabel="Value" />}
      title=""
      data={visible}
      extraData={`${month?.startDate || ''}:${month?.endDate || ''}|${visible
        .map((row) => `${row.store}:${row.count}:${row.amount}`)
        .join('|')}`}
      keyExtractor={(row) => row.store}
      renderItem={({ item: row, index }) => (
        <HomeLikeRow
          title={row.store}
          storeName={row.store}
          meta={
            row.count
              ? [row.topType?.label, `${row.count} ${row.count === 1 ? 'error' : 'errors'}`]
                  .filter(Boolean)
                  .join(' · ')
              : 'No errors'
          }
          count={row.count}
          amount={row.amount}
          last={index === visible.length - 1}
          onPress={() => onOpen(row.store)}
        />
      )}
      footer={visible.length ? <HomeLikeTotalRow label="Total" count={totals.count} amount={totals.amount} /> : null}
    >
      {visible.length ? null : (
        <Text style={styles.emptyCopy}>
          {query.trim() ? `No store matches “${query.trim()}”.` : 'No stores to show.'}
        </Text>
      )}
    </ChromePage>
  );
}

function StorePage({ store, query, month, tab, onTabChange, onOpen, session }) {
  const isMobile = useIsMobile();
  const employeesById = usePurchaseEmployees(store.rows, session);
  const resolvedStore = useMemo(() => {
    if (!Object.keys(employeesById).length) return store;
    const rows = (store.rows || []).map((row) => {
      const name = employeesById[String(row.id)];
      return name ? { ...row, created_by: name, employeeName: name } : row;
    });
    return { ...store, ...summarizeStoreErrors(rows), rows };
  }, [employeesById, store]);
  const visible = useMemo(
    () => resolvedStore.rows.filter((row) => matchesRowQuery(row, query)),
    [query, resolvedStore.rows],
  );
  const amount = useMemo(() => visible.reduce((sum, row) => sum + errorAmountOf(row), 0), [visible]);
  const valueRows = useMemo(
    () =>
      [...(resolvedStore.rows || [])].sort(
        (a, b) => errorAmountOf(b) - errorAmountOf(a) || String(a.reference || '').localeCompare(String(b.reference || '')),
      ),
    [resolvedStore.rows],
  );
  const valueTotal = useMemo(() => valueRows.reduce((sum, row) => sum + errorAmountOf(row), 0), [valueRows]);
  const total = resolvedStore.count || 0;

  useEffect(() => {
    if (!STORE_INSIGHT_TABS.some((option) => option.key === tab)) onTabChange?.('purchases');
  }, [onTabChange, tab]);

  const tabs = (
    <TextTabs
      options={isMobile ? STORE_INSIGHT_TABS_MOBILE : STORE_INSIGHT_TABS}
      value={tab}
      onChange={onTabChange}
      size={isMobile ? 'md' : 'lg'}
      layout="bar"
      style={isMobile ? styles.storeTabsMobile : styles.storeTabs}
    />
  );

  let page = null;
  if (tab === 'purchases') {
    page = (
      <ChromePage
        filterPad={false}
        tableHeader={<HomeLikeTableHeader storeLabel="Document" countLabel="Type" valueLabel="Value" />}
        title=""
        data={visible}
        extraData={`${store.store}:${month?.startDate}:${visible.length}`}
        keyExtractor={(row) => `${row.triageId}-${row.id}`}
        renderItem={({ item: row, index }) => {
          return (
            <HomeLikeRow
              title={row.reference || 'Document'}
              storeName={store.store}
              meta={[errorEmployeeName(row), row.dateLabel].filter(Boolean).join(' · ')}
              count={1}
              countLabel={errorTypeOf(row)}
              amount={errorAmountOf(row)}
              last={index === visible.length - 1}
              onPress={() => onOpen(row)}
              leading={
                <View style={styles.homeIconWrap}>
                  <PoThumb urls={row.imageUrls} label={row.reference} size={22} />
                </View>
              }
            />
          );
        }}
        footer={visible.length ? <HomeLikeTotalRow label="Total" count={visible.length} amount={amount} /> : null}
      >
        {visible.length ? null : (
          <Text style={styles.emptyCopy}>
            {resolvedStore.rows.length
              ? `No purchase matches “${query.trim()}”.`
              : `No flagged POs at ${store.store} in ${month?.label || 'this period'}.`}
          </Text>
        )}
      </ChromePage>
    );
  } else if (tab === 'value') {
    page = (
      <ChromePage
        filterPad={false}
        tableHeader={<HomeLikeTableHeader storeLabel="PO" countLabel="Error type" valueLabel="Value" />}
        title=""
        data={valueRows}
        extraData={`${store.store}:${month?.startDate}:${valueRows.length}`}
        keyExtractor={(row) => `${row.triageId}-${row.id}`}
        renderItem={({ item: row, index }) => (
          <HomeLikeRow
            title={row.reference || 'PO'}
            storeName={store.store}
            meta={[errorEmployeeName(row), row.dateLabel].filter(Boolean).join(' · ')}
            count={1}
            countLabel={errorTypeOf(row)}
            amount={errorAmountOf(row)}
            last={index === valueRows.length - 1}
            onPress={() => onOpen(row)}
            leading={
              <View style={styles.homeIconWrap}>
                <PoThumb urls={row.imageUrls} label={row.reference} size={22} />
              </View>
            }
          />
        )}
        footer={valueRows.length ? <HomeLikeTotalRow label="Total" count={valueRows.length} amount={valueTotal} /> : null}
      >
        {valueRows.length ? null : (
          <Text style={styles.emptyCopy}>
            {`No flagged POs at ${store.store} in ${month?.label || 'this period'}.`}
          </Text>
        )}
      </ChromePage>
    );
  } else if (tab === 'employees') {
    const employeeRows = resolvedStore.employees;
    const employeeTotal = employeeRows.reduce((sum, row) => sum + (row.amount || 0), 0);
    page = (
      <ChromePage
        filterPad={false}
        tableHeader={<HomeLikeTableHeader storeLabel="Employee" countLabel="Error type" valueLabel="Value" />}
        title=""
        data={employeeRows}
        extraData={`${store.store}:${month?.startDate}:${employeeRows.map((row) => `${row.name}:${row.type}:${row.amount}`).join('|')}`}
        keyExtractor={(row) => row.name}
        renderItem={({ item: row, index }) => (
          <HomeLikeRow
            title={row.name}
            storeName={row.name}
            meta={`${row.count} ${row.count === 1 ? 'purchase' : 'purchases'}`}
            count={row.count}
            countLabel={row.types?.length > 1 ? `${row.type} +${row.types.length - 1}` : row.type}
            countTypes={row.types}
            amount={row.amount}
            last={index === employeeRows.length - 1}
          />
        )}
        footer={employeeRows.length ? <HomeLikeTotalRow label="Total" count={employeeRows.length} amount={employeeTotal} /> : null}
      >
        {employeeRows.length ? null : (
          <Text style={styles.emptyCopy}>No purchase employees in this period.</Text>
        )}
      </ChromePage>
    );
  } else {
    let body = null;
    if (tab === 'type') {
      body = resolvedStore.types.length ? (
        resolvedStore.types.map((row, index) => (
          <RankRow
            key={row.label}
            title={row.label}
            meta={`${row.count} of ${total} · ${formatInsightPercent(row.percent, total)}`}
            value={formatInsightPercent(row.percent, total)}
            count={row.count}
            total={total}
            last={index === resolvedStore.types.length - 1}
          />
        ))
      ) : (
        <Text style={styles.emptyCopy}>No error types in this period.</Text>
      );
    } else {
      body = resolvedStore.items.length ? (
        resolvedStore.items.map((row, index) => (
          <RankRow
            key={row.label}
            title={row.label}
            meta={`${row.count} ${row.count === 1 ? 'error' : 'errors'} · ${formatInsightPercent(row.percent, total)}`}
            value={`${row.count} · ${formatInsightPercent(row.percent, total)}`}
            count={row.count}
            total={total}
            last={index === resolvedStore.items.length - 1}
          />
        ))
      ) : (
        <Text style={styles.emptyCopy}>No items in this period.</Text>
      );
    }

    page = (
      <ChromePage filterPad={false} title="">
        <View style={styles.tabBody}>{body}</View>
      </ChromePage>
    );
  }

  return (
    <View style={[styles.storePage, isMobile && styles.storePageMobile]}>
      {tabs}
      {page}
    </View>
  );
}

export default function TriageStoresPanel({
  rows = [],
  query = '',
  month,
  selectedStore = '',
  storeTab = 'purchases',
  onStoreTabChange,
  onOpenStore,
  onOpenPo,
  session,
}) {
  const stores = useMemo(() => listStoreErrorSummaries(rows, month), [month, rows]);
  const store = useMemo(
    () => (selectedStore ? storeErrorSummary(stores, selectedStore) : null),
    [selectedStore, stores],
  );

  if (store) {
    return (
      <StorePage
        store={store}
        query={query}
        month={month}
        tab={storeTab}
        onTabChange={onStoreTabChange}
        onOpen={onOpenPo}
        session={session}
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

  return <StoreListPage stores={stores} query={query} month={month} onOpen={onOpenStore} />;
}

const styles = StyleSheet.create({
  homeRow: {
    position: 'relative',
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 46,
    paddingVertical: 6,
    overflow: 'visible',
    ...Platform.select({
      web: {
        cursor: 'pointer',
        transitionProperty: 'background-color',
        transitionDuration: '120ms',
        transitionTimingFunction: 'ease',
      },
      default: {},
    }),
  },
  homeHeaderRow: {
    minHeight: 34,
    ...Platform.select({ web: { cursor: 'default' }, default: {} }),
  },
  homeTotalRow: {
    minHeight: 46,
    backgroundColor: '#f5f5f5',
    ...Platform.select({ web: { cursor: 'default' }, default: {} }),
  },
  homeRowTipOpen: {
    zIndex: 12,
  },
  homeRowHovered: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: -6,
    right: 8,
    borderRadius: NAV_TAB_ACTIVE_RADIUS,
    backgroundColor: NAV_TAB_ACTIVE_BG,
  },
  homeRowHoveredNative: {
    marginLeft: -6,
    marginRight: 8,
    borderRadius: NAV_TAB_ACTIVE_RADIUS,
    backgroundColor: NAV_TAB_ACTIVE_BG,
  },
  homeRowForeground: {
    flex: 1,
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    zIndex: 1,
  },
  homeRowBody: {
    flex: 1,
    minWidth: 0,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginLeft: 10,
    paddingRight: 10,
  },
  homeRowMobile: {
    minHeight: 64,
    paddingLeft: 4,
  },
  homeRowBodyMobile: {
    gap: 8,
    marginLeft: 8,
    paddingRight: 8,
  },
  homeRule: {
    position: 'absolute',
    left: 32,
    right: 10,
    bottom: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(42,38,30,0.08)',
  },
  homeRuleHeader: {
    backgroundColor: 'rgba(42,38,30,0.16)',
  },
  homeIconWrap: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    flexShrink: 0,
  },
  homeIconSpacer: {
    width: 32,
    flexShrink: 0,
  },
  homeIconSpacerMobile: {
    width: 28,
  },
  homeIconTile: {
    width: 22,
    height: 22,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  homeIconFaded: {
    opacity: 0.5,
  },
  homeHeader: {
    fontFamily,
    fontSize: 13,
    fontWeight: '500',
    color: MOBILE.secondary,
    letterSpacing: -0.15,
    textDecorationLine: 'none',
  },
  homeHeaderEnd: {
    textAlign: 'right',
  },
  homeHeaderMobile: {
    fontSize: 11,
  },
  homeColStore: {
    flex: 1,
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 140,
    flexDirection: 'column',
    alignItems: 'flex-start',
    justifyContent: 'center',
    gap: 1,
  },
  homeColStoreMobile: {
    minWidth: 0,
  },
  homeColCount: {
    minWidth: 148,
    flexShrink: 0,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  homeColCountMobile: {
    minWidth: 0,
    maxWidth: 104,
    flexShrink: 1,
    flexGrow: 0,
  },
  typeTipHit: {
    position: 'relative',
    alignItems: 'flex-end',
    minWidth: 0,
    zIndex: 8,
    ...Platform.select({ web: { cursor: 'default' }, default: {} }),
  },
  typeTipCard: {
    position: 'absolute',
    top: '100%',
    right: 0,
    marginTop: 6,
    minWidth: 168,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: '#fff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(42,38,30,0.12)',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
    gap: 6,
    zIndex: 20,
  },
  typeTipRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 16,
  },
  typeTipName: {
    fontFamily,
    fontSize: 13,
    color: T.text,
    flexShrink: 1,
  },
  typeTipCount: {
    fontFamily,
    fontSize: 13,
    color: T.secondary,
    fontVariant: ['tabular-nums'],
  },
  homeColMoney: {
    minWidth: 128,
    flexShrink: 0,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  homeColMoneyMobile: {
    minWidth: 56,
    maxWidth: 72,
    flexShrink: 0,
  },
  homeName: {
    fontFamily,
    fontSize: 14,
    fontWeight: '400',
    color: MOBILE.label,
    letterSpacing: -0.2,
    flexShrink: 1,
    minWidth: 0,
  },
  homeNameMobile: {
    fontSize: 15,
  },
  homeMeta: {
    fontFamily,
    fontSize: 12,
    color: MOBILE.secondary,
    letterSpacing: -0.1,
    fontVariant: ['tabular-nums'],
    flexShrink: 1,
    minWidth: 0,
  },
  homeCount: {
    fontFamily,
    fontSize: 13,
    fontWeight: '400',
    color: MOBILE.label,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
    flexShrink: 0,
  },
  homeCountMobile: {
    fontSize: 12,
    flexShrink: 1,
  },
  homeMoney: {
    fontFamily,
    fontSize: 14,
    fontWeight: '400',
    color: MOBILE.label,
    letterSpacing: -0.2,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
    flexShrink: 0,
  },
  homeMoneyMobile: {
    fontSize: 13,
  },
  homeMoneyEmpty: {
    color: '#c7c7cc',
  },
  homeTotalLabel: {
    fontFamily,
    fontSize: 14,
    fontWeight: '600',
    color: MOBILE.label,
    letterSpacing: -0.2,
  },
  homeChevron: {
    width: 14,
    flexShrink: 0,
    alignItems: 'flex-end',
  },
  homeChevronMobile: {
    width: 12,
  },
  storePage: {
    flex: 1,
    minHeight: 0,
    backgroundColor: '#fcfcfb',
  },
  storePageMobile: {
    paddingTop: MOBILE_TOP_FILTER_SIZE + MOBILE_FILTER_INSET,
  },
  storeTabs: {
    paddingHorizontal: 32,
    paddingTop: 4,
  },
  storeTabsMobile: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingLeft: 8,
    paddingRight: 60,
    paddingTop: 0,
    paddingBottom: 0,
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
  tabBody: {
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
    flexShrink: 0,
    textAlign: 'right',
  },
  rankValueMobile: {
    fontSize: 16,
    maxWidth: 96,
    paddingTop: 2,
  },
});
