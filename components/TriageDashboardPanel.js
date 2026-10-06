/**
 * Triage dashboard: region home, then Lots and Errors for that region.
 * Mobile matches the Home tab: hero, stat row, full-bleed list.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  applyTriageReviewToPo,
  collectAccuracyTriagePos,
  collectAllTriagePos,
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
import { STORE_REGIONS, storeNameInRegion } from '../lib/storeCatalog';
import { formatAmount } from '../lib/transactions';
import { formatErrorAmount } from '../lib/triageDraft';
import { currentErrorPeriod, errorStoreName, listRegionErrorSummaries } from '../lib/triageStoreErrors';
import { CANVAS, useIsMobile } from '../lib/mobileUi';
import {
  ChromeHero,
  ChromeListRow,
  ChromePage,
  EmptyState,
  FONT,
  PageWithBack,
  ProgressBar,
  T,
  TextAction,
  TriageDrawer,
} from './TriageKit';
import { PoThumb } from './TriageTable';
import TriageReviewDrawer from './TriageReviewDrawer';

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
  ].join('');
}

function staffName(row) {
  const name = String(row?.employeeName || '').trim();
  return name && name !== '—' ? name : '';
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

function emptyCopy(text) {
  return <Text style={styles.emptyCopy}>{text}</Text>;
}

const REGION_ICON_COLORS = {
  ottawa: '#B91C1C',
  quebec: '#0F766E',
  halifax: '#1D4ED8',
  gta: '#2F8A4E',
  pmx: '#6B4DE6',
  west: '#C2410C',
};

function regionTitle(key) {
  return STORE_REGIONS.find((region) => region.key === key)?.label || '';
}

function regionStoreMeta(region) {
  return region.storeCount === 1 ? '1 store' : `${region.storeCount || 0} stores`;
}

function rowInRegion(row, regionKey) {
  return storeNameInRegion(errorStoreName(row) || row?.storeName, regionKey);
}

function ErrorsPage({ rows, query, onOpen }) {
  const visible = useMemo(() => rows.filter((row) => matchesQuery(row, query)), [query, rows]);
  const types = useMemo(() => rankCounts(visible, errorTypeOf), [visible]);
  const amount = useMemo(() => visible.reduce((sum, row) => sum + errorAmountOf(row), 0), [visible]);
  const storeCount = useMemo(
    () => new Set(visible.map((row) => String(row.storeName || '').trim()).filter((name) => name && name !== '—')).size,
    [visible],
  );

  if (!rows.length) {
    return (
      <EmptyState
        icon="alert-circle-outline"
        title="No errors"
        body="Flagged POs and SOs land here after triage reviews them."
      />
    );
  }

  return (
    <ChromePage
      hero={
        <ChromeHero
          icon="alert-circle"
          iconColor="#B91C1C"
          value={amount ? formatAmount(amount) : String(visible.length)}
          stats={[
            { label: visible.length === 1 ? 'Error' : 'Errors', value: String(visible.length) },
            { label: storeCount === 1 ? 'Store' : 'Stores', value: String(storeCount) },
            { label: types.length === 1 ? 'Type' : 'Types', value: String(types.length) },
          ]}
        />
      }
      title="Errors"
      meta={`${visible.length} error${visible.length === 1 ? '' : 's'}`}
      data={visible}
      keyExtractor={(row) => `${row.triageId}-${row.id}`}
      renderItem={({ item: row, index }) => (
        <ChromeListRow
          title={row.reference || 'Document'}
          meta={[errorTypeOf(row), row.storeName, staffName(row), row.dateLabel].filter(Boolean).join(' · ')}
          value={formatErrorAmount(row?.review?.errorAmount || '') || ''}
          leading={<PoThumb urls={row.imageUrls} label={row.reference} size={46} />}
          last={index === visible.length - 1}
          onPress={() => onOpen(row)}
        />
      )}
    >
      {visible.length
        ? null
        : emptyCopy(query.trim() ? `No error matches “${query.trim()}”.` : 'No errors.')}
    </ChromePage>
  );
}

function LotsPage({ lots, allRows, errors, query, onOpen }) {
  const isMobile = useIsMobile();
  const visible = useMemo(() => lots.filter((lot) => lotMatchesQuery(lot, query)), [lots, query]);
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

  if (!lots.length) {
    return (
      <EmptyState
        icon="folder-outline"
        title="No lots"
        body="Finish a PO to create its lot. Lots group every PO / SO from the same store and month."
      />
    );
  }

  return (
    <>
    <ChromePage
      hero={
        <ChromeHero
          icon="folder"
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
      }
      title="Lots"
      meta={`${visible.length} ${visible.length === 1 ? 'lot' : 'lots'}`}
      data={visible}
      keyExtractor={(lot) => lot.id}
      renderItem={({ item: lot, index }) => {
        const progress = lotProgressOf(lot);
        return (
          <ChromeListRow
            title={lot.id}
            meta={[lot.location, lotPeriodLabel(lot), `${lot.pos.length} ${lot.pos.length === 1 ? 'PO' : 'POs'}`]
              .filter(Boolean)
              .join(' · ')}
            value={progress.expected ? `${progress.evaluated}/${progress.expected}` : String(lot.pos.length)}
            icon="folder"
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
      }}
    >
      {visible.length
        ? null
        : emptyCopy(query.trim() ? `No lot matches “${query.trim()}”.` : 'No lots.')}
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
  page = '',
  onPageChange,
  onBackChange,
  onOpenLot,
  onStoresViewChange,
  storesNavRef,
  storePeriod: storePeriodProp,
  onReviewOpenChange,
}) {
  const { triage } = useTransferWorkflow();
  const isMobile = useIsMobile();
  const [openRow, setOpenRow] = useState(null);

  useEffect(() => {
    if (!onReviewOpenChange) return undefined;
    onReviewOpenChange(Boolean(openRow));
    return () => onReviewOpenChange(false);
  }, [onReviewOpenChange, openRow]);
  const [selectedRegion, setSelectedRegion] = useState('');
  const [storePeriodLocal] = useState(() => currentErrorPeriod());
  const storePeriod = storePeriodProp || storePeriodLocal;

  const evaluated = useMemo(() => (active ? collectAccuracyTriagePos(triage) : []), [active, triage]);
  const allRows = useMemo(() => (active ? collectAllTriagePos(triage) : []), [active, triage]);
  const scopedEvaluated = useMemo(
    () => (selectedRegion ? evaluated.filter((row) => rowInRegion(row, selectedRegion)) : evaluated),
    [evaluated, selectedRegion],
  );
  const scopedAllRows = useMemo(
    () => (selectedRegion ? allRows.filter((row) => rowInRegion(row, selectedRegion)) : allRows),
    [allRows, selectedRegion],
  );
  const lots = useMemo(
    () => (active ? groupPosIntoLots(scopedEvaluated, scopedAllRows) : []),
    [active, scopedAllRows, scopedEvaluated],
  );
  const allErrors = useMemo(
    () => (active ? summarizeErrors(evaluated) : { rows: [], count: 0, amount: 0, stores: 0, topType: null, types: [] }),
    [active, evaluated],
  );
  const errors = useMemo(
    () => (selectedRegion ? summarizeErrors(scopedEvaluated) : allErrors),
    [allErrors, scopedEvaluated, selectedRegion],
  );
  const regionRollup = useMemo(
    () =>
      active
        ? listRegionErrorSummaries(allErrors.rows, storePeriod, evaluated)
        : { regions: [], totals: { count: 0, amount: 0, evaluated: 0, rate: 0, stores: 0 } },
    [active, allErrors.rows, evaluated, storePeriod],
  );
  const activeRegion = useMemo(
    () => regionRollup.regions.find((region) => region.key === selectedRegion) || null,
    [regionRollup.regions, selectedRegion],
  );
  const lotSummary = useMemo(() => summarizeLots(lots), [lots]);

  const openPage = useCallback((key) => {
    onPageChange?.(key || '');
  }, [onPageChange]);
  const openRegion = useCallback((regionKey) => {
    setSelectedRegion(regionKey);
    onPageChange?.('');
  }, [onPageChange]);
  const closePage = useCallback(() => {
    if (page) {
      onPageChange?.('');
      return;
    }
    setSelectedRegion('');
  }, [onPageChange, page]);

  useEffect(() => {
    onStoresViewChange?.({
      selectedStore: '',
      selectedRegion,
      selectedRegionLabel: regionTitle(selectedRegion),
      period: storePeriod,
    });
  }, [onStoresViewChange, selectedRegion, storePeriod]);

  useEffect(() => {
    if (!storesNavRef) return undefined;
    storesNavRef.current = {
      closeStore() {},
      closeRegion: () => setSelectedRegion(''),
    };
    return () => {
      storesNavRef.current = { closeStore() {} };
    };
  }, [storesNavRef]);

  useEffect(() => {
    if (!active) return undefined;
    if (!page && !selectedRegion) {
      onBackChange?.(null, null);
      return () => onBackChange?.(null, null);
    }
    const titles = {
      errors: 'Errors',
      lots: 'Lots',
    };
    const label = page ? titles[page] || 'Dashboard' : regionTitle(selectedRegion) || 'Dashboard';
    onBackChange?.(closePage, { dateLabel: label });
    return () => onBackChange?.(null, null);
  }, [active, closePage, onBackChange, page, selectedRegion]);

  const saveReview = useCallback(
    (poId, review) => {
      const saved = saveTriagePoReview(poId, review, triageEditorFromSession(session));
      setOpenRow((current) => (current?.id === poId ? applyTriageReviewToPo(current, saved || review) : current));
    },
    [session],
  );

  if (!session?.token) {
    return (
      <View style={[styles.body, isMobile && styles.bodyMobile]}>
        <EmptyState
          icon="lock-closed-outline"
          title="Sign in to triage"
          body="Log in to see regional errors and lots."
          action={<TextAction label="Go to Profile" strong onPress={onRequireLogin} />}
        />
      </View>
    );
  }

  const regionLabel = regionTitle(selectedRegion) || 'Triage';
  const pages = (
    <PageWithBack onPress={closePage} label="Regions">
    <ChromePage
      title={isMobile ? undefined : regionTitle(selectedRegion) || 'Triage'}
      meta={storePeriod.label}
      filterPad={false}
      hero={
        <ChromeHero
          value={activeRegion?.amount ? formatAmount(activeRegion.amount) : String(activeRegion?.count || 0)}
          stats={[
            { label: (activeRegion?.count || 0) === 1 ? 'Error' : 'Errors', value: String(activeRegion?.count || 0) },
            { label: 'Value', value: activeRegion?.amount ? formatAmount(activeRegion.amount) : '—' },
            { label: (activeRegion?.storeCount || 0) === 1 ? 'Store' : 'Stores', value: String(activeRegion?.storeCount || 0) },
          ]}
        />
      }
    >
      <ChromeListRow
        title="Lots"
        meta={
          lots.length
            ? `${lotSummary.evaluated} evaluated · ${lotSummary.percent}% · ${lotSummary.lots} ${lotSummary.lots === 1 ? 'lot' : 'lots'}`
            : 'No lots yet'
        }
        value={String(lotSummary.lots)}
        icon="folder"
        iconColor="#8A6D1F"
        onPress={() => openPage('lots')}
      />
      <ChromeListRow
        title="Errors"
        meta={
          errors.count
            ? [
                errors.topType ? `${errors.topType.label} most common` : null,
                errors.amount ? formatAmount(errors.amount) : null,
                errors.stores ? `${errors.stores} ${errors.stores === 1 ? 'store' : 'stores'}` : null,
              ]
                .filter(Boolean)
                .join(' · ')
            : 'No flagged POs yet'
        }
        value={String(errors.count)}
        icon="alert-circle"
        iconColor="#B91C1C"
        last
        onPress={() => openPage('errors')}
      />
    </ChromePage>
    </PageWithBack>
  );

  const home = (
    <ChromePage title={isMobile ? undefined : 'Regions'} meta={storePeriod.label} filterPad={false}>
      <View style={[styles.regionHeadRow, isMobile && styles.regionHeadRowMobile]}>
        <Text style={styles.regionHeadLabel}>Region</Text>
        <Text style={styles.regionHeadCount}>Errors</Text>
        <Text style={styles.regionHeadAmount}>Value</Text>
        <View style={styles.regionHeadChevron} />
      </View>
      {regionRollup.regions.map((region, index) => (
        <ChromeListRow
          key={region.key}
          title={region.label}
          meta={regionStoreMeta(region)}
          trailing={
            <View style={styles.regionMetrics}>
              <Text style={[styles.regionCount, isMobile && styles.regionCountMobile]} numberOfLines={1}>
                {region.count}
              </Text>
              <Text style={[styles.regionAmount, isMobile && styles.regionAmountMobile]} numberOfLines={1}>
                {region.amount ? formatAmount(region.amount) : '—'}
              </Text>
            </View>
          }
          icon="map"
          iconColor={REGION_ICON_COLORS[region.key] || '#3A3A3C'}
          last={index === regionRollup.regions.length - 1}
          onPress={() => openRegion(region.key)}
        />
      ))}
    </ChromePage>
  );

  return (
    <View style={[styles.body, isMobile && styles.bodyMobile]}>
      {page === 'errors' ? (
        <PageWithBack onPress={closePage} label={regionLabel}>
          <ErrorsPage rows={errors.rows} query={listQuery} onOpen={setOpenRow} />
        </PageWithBack>
      ) : page === 'lots' ? (
        <PageWithBack onPress={closePage} label={regionLabel}>
          <LotsPage
            lots={lots}
            allRows={allRows}
            errors={errors}
            query={listQuery}
            onOpen={onOpenLot ? (lot) => onOpenLot(lot.id) : undefined}
          />
        </PageWithBack>
      ) : selectedRegion ? (
        pages
      ) : (
        home
      )}

      <TriageReviewDrawer
        visible={Boolean(openRow)}
        session={session}
        row={openRow}
        review={openRow?.review || null}
        extraRows={errors.rows}
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
    backgroundColor: T.bg,
  },
  bodyMobile: {
    backgroundColor: CANVAS,
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
  regionHeadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 74,
    paddingRight: 16,
    paddingTop: 10,
    paddingBottom: 6,
    gap: 12,
  },
  regionHeadRowMobile: {
    paddingLeft: 84,
    paddingRight: 16,
  },
  regionHeadLabel: {
    fontFamily,
    flex: 1,
    minWidth: 0,
    fontSize: 12,
    fontWeight: '600',
    color: T.secondary,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  regionHeadCount: {
    fontFamily,
    width: 52,
    fontSize: 12,
    fontWeight: '600',
    color: T.secondary,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
    textAlign: 'right',
  },
  regionHeadAmount: {
    fontFamily,
    width: 88,
    fontSize: 12,
    fontWeight: '600',
    color: T.secondary,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
    textAlign: 'right',
  },
  regionHeadChevron: {
    width: 18,
  },
  regionMetrics: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  regionCount: {
    fontFamily,
    width: 52,
    fontSize: 15,
    fontWeight: '600',
    color: T.text,
    fontVariant: ['tabular-nums'],
    textAlign: 'right',
  },
  regionCountMobile: {
    fontSize: 16,
  },
  regionAmount: {
    fontFamily,
    width: 88,
    fontSize: 15,
    fontWeight: '600',
    color: T.text,
    fontVariant: ['tabular-nums'],
    textAlign: 'right',
  },
  regionAmountMobile: {
    fontSize: 16,
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
