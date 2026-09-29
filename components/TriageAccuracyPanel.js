import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Image, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  applyTriageReviewToPo,
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
  summarizeLotFineMetals,
  summarizeLotsFineMetals,
} from '../lib/triageLots';
import { MAX_REVIEW_IMAGES, normalizeReviewImages } from '../lib/triageDraft';
import { captureTriagePhoto } from './TriageCorrectionImages';
import {
  ColumnFilter,
  matchesSelectedLabel,
  PoThumb,
  selectedLabels,
  sortRows,
  TableCell,
  TableEmpty,
  TableFrame,
  TablePhotoCell,
  TableMuted,
  TableRow,
  TableRowMain,
  TableStrong,
  uniqueLabels,
} from './TriageTable';
import TriageReviewDrawer from './TriageReviewDrawer';
import {
  ChromeHero,
  ChromeSheet,
  EmptyState,
  FONT,
  MobileCameraButton,
  MobileListRow,
  ProgressBar,
  SectionLabel,
  SegmentedSlider,
  StatusPill,
  T,
  TextAction,
  TriageDrawer,
} from './TriageKit';
import { useIsMobile } from '../lib/mobileUi';

const fontFamily = FONT;

const COL = {
  reference: { flex: 1.2, minWidth: 120 },
  date: { flex: 0.85, minWidth: 92 },
  person: { flex: 1.1, minWidth: 110 },
  store: { flex: 1.1, minWidth: 110 },
  received: { flex: 0.95, minWidth: 100 },
  error: { flex: 1.15, minWidth: 120 },
  amount: { flex: 0.85, minWidth: 88 },
};

const EMPTY_FILTERS = {
  reference: [],
  dateLabel: [],
  person: [],
  store: [],
  error: [],
  received: [],
};

const SORTERS = {
  reference: (row) => row.reference,
  dateLabel: (row) => row.dateLabel,
  person: (row) => staffName(row),
  store: (row) => row.storeName,
  error: (row) => errorPlace(row),
  received: (row) => row.triageDateLabel || row.amountLabel,
  amount: (row) => Number(String(row?.review?.errorAmount || '').replace(/[^0-9.-]/g, '')) || 0,
};

function staffName(row) {
  const name = String(row?.employeeName || '').trim();
  return name && name !== '—' ? name : '';
}

function storeNameOf(row) {
  const name = String(row?.storeName || '').trim();
  return name && name !== '—' ? name : '';
}

function errorDetailParts(review) {
  const note = String(review?.note || '').trim();
  const amount = String(review?.errorAmount || '').trim();
  const edits = (Array.isArray(review?.lineEdits) ? review.lineEdits : [])
    .map((line) => {
      const name = String(line?.name || 'Line').trim();
      const was = String(line?.originalAmount || '').trim() || '—';
      const now = String(line?.amount || '').trim() || '—';
      return `${name}: ${was} → ${now}`;
    })
    .filter(Boolean);
  const photos = normalizeReviewImages(review?.images);
  return { note, amount, edits, photos };
}

function errorDetailSummary(review) {
  const detail = errorDetailParts(review);
  return [detail.note, ...detail.edits].filter(Boolean).join(' · ');
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

function rowMatchesQuery(row, query) {
  const q = String(query || '')
    .trim()
    .toLowerCase();
  if (!q) return true;
  return [
    row.reference,
    staffName(row),
    row.storeName,
    row.dateLabel,
    row.triageDateLabel,
    row.customerName,
    errorPlace(row),
    row.review?.note,
    row.review?.errorAmount,
    ...(Array.isArray(row.review?.lineEdits) ? row.review.lineEdits.flatMap((line) => [line?.name, line?.originalAmount, line?.amount]) : []),
    row.amountLabel,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .includes(q);
}

function accuracyKey(row) {
  return `${row.triageId}-${row.id}`;
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

function BreakdownList({ title, rows, total, empty }) {
  return (
    <View style={styles.breakBlock}>
      <SectionLabel>{title}</SectionLabel>
      {rows.length === 0 ? (
        <Text style={styles.breakEmpty}>{empty}</Text>
      ) : (
        rows.map((row, index) => (
          <View key={row.label} style={[styles.breakRow, index === rows.length - 1 && styles.breakRowLast]}>
            <View style={styles.breakCopy}>
              <Text style={styles.breakLabel} numberOfLines={1}>
                {row.label}
              </Text>
              <Text style={styles.breakCount}>
                {row.count}
                {total ? ` · ${Math.round((row.count / total) * 100)}%` : ''}
              </Text>
            </View>
            <ProgressBar value={row.count} total={total || row.count} tone="orange" height={4} style={styles.breakBar} />
          </View>
        ))
      )}
    </View>
  );
}

function ErrorDetailBlock({ review }) {
  const detail = errorDetailParts(review);
  const lines = [
    detail.note,
    detail.amount ? `Set amount ${detail.amount}` : '',
    ...detail.edits,
  ].filter(Boolean);
  if (!lines.length && !detail.photos.length) return null;
  return (
    <View style={styles.detailBlock}>
      {lines.map((line, index) => (
        <Text key={`${index}-${line}`} style={styles.detailLine}>
          {line}
        </Text>
      ))}
      {detail.photos.length ? (
        <View style={styles.detailPhotos}>
          {detail.photos.map((photo) => (
            <Image key={photo.id} source={{ uri: photo.uri }} style={styles.detailPhoto} resizeMode="cover" />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const LOT_COL = {
  lot: { flex: 1.6, minWidth: 200 },
  location: { flex: 1.1, minWidth: 110 },
  period: { flex: 1, minWidth: 120 },
  documents: { flex: 0.7, minWidth: 72 },
  progress: { flex: 1.05, minWidth: 112 },
};

function lotProgressOf(lot) {
  const expected = Number(lot?.expected) || 0;
  const evaluated = Number(lot?.evaluated) || 0;
  const percent = expected ? Math.round((evaluated / expected) * 100) : 0;
  return { expected, evaluated, percent, done: expected > 0 && evaluated >= expected };
}

function LotProgress({ lot, compact = false }) {
  const { expected, evaluated, percent, done } = lotProgressOf(lot);
  if (!expected) return compact ? null : <TableMuted>—</TableMuted>;
  return (
    <View style={[styles.lotProgress, compact && styles.lotProgressCompact]}>
      <Text style={[styles.lotProgressText, compact && styles.lotProgressTextCompact]} numberOfLines={1}>
        {compact ? `${evaluated} of ${expected}` : `${evaluated}/${expected} · ${percent}%`}
      </Text>
      <ProgressBar
        value={evaluated}
        total={expected}
        tone={done ? 'green' : 'blue'}
        height={compact ? 6 : 8}
        style={styles.lotProgressBar}
      />
    </View>
  );
}

const LotTableRow = memo(function LotTableRow({ lot, last, onOpen }) {
  const progress = lotProgressOf(lot);
  return (
    <TableRow last={last}>
      <TablePhotoCell>
        <View style={styles.lotIcon}>
          <Ionicons name="folder-outline" size={22} color={T.text} />
        </View>
      </TablePhotoCell>
      <TableRowMain
        onPress={() => onOpen(lot)}
        accessibilityLabel={
          progress.expected
            ? `Open ${lot.id}, ${progress.evaluated} of ${progress.expected} evaluated`
            : `Open ${lot.id}`
        }
      >
        <TableCell flex={LOT_COL.lot.flex} minWidth={LOT_COL.lot.minWidth}>
          <TableStrong>{lot.id}</TableStrong>
        </TableCell>
        <TableCell flex={LOT_COL.location.flex} minWidth={LOT_COL.location.minWidth}>
          {lot.location}
        </TableCell>
        <TableCell flex={LOT_COL.period.flex} minWidth={LOT_COL.period.minWidth}>
          {lotPeriodLabel(lot)}
        </TableCell>
        <TableCell flex={LOT_COL.documents.flex} minWidth={LOT_COL.documents.minWidth}>
          {String(lot.pos.length)}
        </TableCell>
        <TableCell flex={LOT_COL.progress.flex} minWidth={LOT_COL.progress.minWidth} align="right" last>
          <LotProgress lot={lot} />
        </TableCell>
      </TableRowMain>
    </TableRow>
  );
});

const AccuracyTableRow = memo(function AccuracyTableRow({ row, last, showError, showAll, onOpen }) {
  const detail = errorDetailParts(row.review);
  const flagged = triagePoNeedsCorrection(row);
  const summary = showError || (showAll && flagged) ? errorDetailSummary(row.review) : '';
  const referenceCol = showError || showAll ? { flex: 1.8, minWidth: 220 } : COL.reference;
  return (
    <TableRow last={last}>
      <TablePhotoCell>
        <PoThumb urls={row.imageUrls} label={row.reference} />
      </TablePhotoCell>
      <TableRowMain onPress={() => onOpen(row)} accessibilityLabel={`Open ${row.reference || 'document'}`}>
        <TableCell flex={referenceCol.flex} minWidth={referenceCol.minWidth}>
          <TableStrong>{row.reference || 'Document'}</TableStrong>
          {summary ? <TableMuted>{summary}</TableMuted> : null}
        </TableCell>
        <TableCell flex={COL.date.flex} minWidth={COL.date.minWidth}>
          {row.dateLabel || '—'}
        </TableCell>
        <TableCell flex={COL.person.flex} minWidth={COL.person.minWidth}>
          {staffName(row) || '—'}
        </TableCell>
        <TableCell flex={COL.store.flex} minWidth={COL.store.minWidth}>
          {row.storeName || '—'}
        </TableCell>
        {showError || showAll ? (
          <>
            <TableCell flex={COL.error.flex} minWidth={COL.error.minWidth}>
              {flagged ? errorPlace(row) : 'Correct'}
            </TableCell>
            <TableCell flex={COL.amount.flex} minWidth={COL.amount.minWidth} align="right" last>
              {flagged ? detail.amount || '—' : row.triageDateLabel || row.amountLabel || '—'}
            </TableCell>
          </>
        ) : (
          <TableCell flex={COL.received.flex} minWidth={COL.received.minWidth} align="right" last>
            {row.triageDateLabel || row.amountLabel || '—'}
          </TableCell>
        )}
      </TableRowMain>
    </TableRow>
  );
});

export default function TriageAccuracyPanel({
  session,
  accuracyTab = 'all',
  listQuery = '',
  onStatsChange,
  breakdownOpen = false,
  onBreakdownOpenChange,
  openLotId = '',
  onOpenLotChange,
  onAccuracyTabChange,
  onBackChange,
}) {
  const { triage } = useTransferWorkflow();
  const isMobile = useIsMobile();
  const [openRow, setOpenRow] = useState(null);
  const [openFilter, setOpenFilter] = useState(null);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [sort, setSort] = useState(null);
  const [photoBusyId, setPhotoBusyId] = useState('');
  const [photoError, setPhotoError] = useState('');
  const showError = accuracyTab === 'incorrect';
  const showAll = accuracyTab === 'all' || !accuracyTab;

  const allRows = useMemo(() => collectAllTriagePos(triage), [triage]);
  const accuracyRows = useMemo(
    () => allRows.filter((row) => row.evaluated),
    [allRows],
  );
  const lots = useMemo(() => groupPosIntoLots(accuracyRows, allRows), [accuracyRows, allRows]);
  const visibleLots = useMemo(
    () => lots.filter((lot) => lotMatchesQuery(lot, listQuery)),
    [listQuery, lots],
  );
  const openLot = useMemo(
    () => lots.find((lot) => lot.id === openLotId) || null,
    [lots, openLotId],
  );
  const lotRows = useMemo(() => (openLot ? openLot.pos : accuracyRows), [accuracyRows, openLot]);
  const lotProgress = useMemo(() => {
    if (openLot) return lotProgressOf(openLot);
    let expected = 0;
    let evaluated = 0;
    for (const lot of lots) {
      expected += Number(lot.expected) || 0;
      evaluated += Number(lot.evaluated) || 0;
    }
    return {
      expected,
      evaluated,
      percent: expected ? Math.round((evaluated / expected) * 100) : 0,
      done: expected > 0 && evaluated >= expected,
    };
  }, [lots, openLot]);
  const lotMetals = useMemo(
    () => (openLot ? summarizeLotFineMetals(openLot, allRows) : summarizeLotsFineMetals(lots, allRows)),
    [allRows, lots, openLot],
  );

  const closeLot = useCallback(() => {
    onOpenLotChange?.(null);
  }, [onOpenLotChange]);

  useEffect(() => {
    if (!openLot) {
      onBackChange?.(null, null);
      return undefined;
    }
    onBackChange?.(closeLot, { dateLabel: openLot.id, storeNames: openLot.location });
    return () => onBackChange?.(null, null);
  }, [closeLot, onBackChange, openLot]);

  useEffect(() => {
    if (openLotId && !openLot) onOpenLotChange?.(null);
  }, [openLot, openLotId, onOpenLotChange]);

  const setFilter = useCallback((key, value) => {
    setFilters((current) => ({ ...current, [key]: value }));
  }, []);
  const filtersActive = Object.values(filters).some((value) => selectedLabels(value).length > 0);
  const clearFilters = useCallback(() => {
    setFilters(EMPTY_FILTERS);
    setSort(null);
    setOpenFilter(null);
  }, []);

  const rowMatchesShared = useCallback(
    (row, skip) =>
      (!openLot || rowMatchesQuery(row, listQuery)) &&
      (skip === 'reference' || matchesSelectedLabel(row.reference, filters.reference)) &&
      (skip === 'dateLabel' || matchesSelectedLabel(row.dateLabel, filters.dateLabel)) &&
      (skip === 'person' || matchesSelectedLabel(staffName(row), filters.person)) &&
      (skip === 'store' || matchesSelectedLabel(row.storeName, filters.store)),
    [filters.dateLabel, filters.person, filters.reference, filters.store, listQuery, openLot],
  );

  const scoped = useMemo(
    () => lotRows.filter((row) => rowMatchesShared(row)),
    [lotRows, rowMatchesShared],
  );

  const errorRows = useMemo(
    () =>
      scoped.filter((row) => {
        if (!triagePoNeedsCorrection(row)) return false;
        if (!matchesSelectedLabel(errorPlace(row), filters.error)) return false;
        return true;
      }),
    [filters.error, scoped],
  );

  const stats = useMemo(() => {
    let correct = 0;
    let incorrect = 0;
    for (const row of scoped) {
      if (triagePoNeedsCorrection(row)) {
        if (matchesSelectedLabel(errorPlace(row), filters.error)) incorrect += 1;
      } else if (row.received) {
        if (matchesSelectedLabel(row.triageDateLabel || row.amountLabel, filters.received)) correct += 1;
      }
    }
    const total = correct + incorrect;
    return {
      correct,
      incorrect,
      total,
      lots: lots.length,
      ratio: total ? `${correct}/${total}` : '0/0',
      percent: total ? Math.round((correct / total) * 100) : 0,
    };
  }, [filters.error, filters.received, lots.length, scoped]);

  useEffect(() => {
    onStatsChange?.(stats);
  }, [onStatsChange, stats]);

  const categories = useMemo(() => rankCounts(errorRows, errorPlace), [errorRows]);
  const employees = useMemo(() => rankCounts(errorRows, staffName), [errorRows]);
  const stores = useMemo(() => rankCounts(errorRows, storeNameOf), [errorRows]);
  const topCategory = categories[0] || null;

  const source = useMemo(
    () =>
      scoped.filter((row) => {
        if (showAll) return true;
        if (showError) {
          return triagePoNeedsCorrection(row) && matchesSelectedLabel(errorPlace(row), filters.error);
        }
        return (
          Boolean(row.received) &&
          !triagePoNeedsCorrection(row) &&
          matchesSelectedLabel(row.triageDateLabel || row.amountLabel, filters.received)
        );
      }),
    [filters.error, filters.received, scoped, showAll, showError],
  );

  const optionsPool = useMemo(
    () =>
      lotRows.filter((row) => {
        if (openLot && !rowMatchesQuery(row, listQuery)) return false;
        if (showAll) return true;
        return showError
          ? triagePoNeedsCorrection(row)
          : Boolean(row.received) && !triagePoNeedsCorrection(row);
      }),
    [listQuery, lotRows, openLot, showAll, showError],
  );

  const rowMatchesOptions = useCallback(
    (row, skip) =>
      (skip === 'reference' || matchesSelectedLabel(row.reference, filters.reference)) &&
      (skip === 'dateLabel' || matchesSelectedLabel(row.dateLabel, filters.dateLabel)) &&
      (skip === 'person' || matchesSelectedLabel(staffName(row), filters.person)) &&
      (skip === 'store' || matchesSelectedLabel(row.storeName, filters.store)) &&
      (skip === 'error' || !showError || matchesSelectedLabel(errorPlace(row), filters.error)) &&
      (skip === 'received' ||
        showError ||
        matchesSelectedLabel(row.triageDateLabel || row.amountLabel, filters.received)),
    [filters, showError],
  );

  const optionsFor = useCallback(
    (key, getValue) => uniqueLabels(optionsPool.filter((row) => rowMatchesOptions(row, key)).map(getValue)),
    [optionsPool, rowMatchesOptions],
  );

  const referenceOptions = useMemo(() => optionsFor('reference', (row) => row.reference), [optionsFor]);
  const dateOptions = useMemo(() => optionsFor('dateLabel', (row) => row.dateLabel), [optionsFor]);
  const personOptions = useMemo(() => optionsFor('person', staffName), [optionsFor]);
  const storeOptions = useMemo(() => optionsFor('store', (row) => row.storeName), [optionsFor]);
  const errorOptions = useMemo(() => optionsFor('error', errorPlace), [optionsFor]);
  const receivedOptions = useMemo(
    () => optionsFor('received', (row) => row.triageDateLabel || row.amountLabel),
    [optionsFor],
  );

  const visible = useMemo(() => {
    if (!sort) return source;
    return sortRows(source, SORTERS[sort.key], sort.dir);
  }, [sort, source]);

  const sortProps = (key) => ({
    sortDir: sort?.key === key ? sort.dir : null,
    onSort: (dir) => setSort(dir ? { key, dir } : null),
  });

  const saveReview = useCallback(
    (poId, review) => {
      const saved = saveTriagePoReview(poId, review, triageEditorFromSession(session));
      setOpenRow((current) => (current?.id === poId ? applyTriageReviewToPo(current, saved || review) : current));
    },
    [session],
  );

  const addPhotoToRow = useCallback(
    async (row) => {
      const attached = normalizeReviewImages(row?.review?.images);
      if (attached.length >= MAX_REVIEW_IMAGES) {
        setOpenFilter(null);
        setOpenRow(row);
        return;
      }
      setPhotoError('');
      setPhotoBusyId(row.id);
      const result = await captureTriagePhoto();
      setPhotoBusyId('');
      if (result.error) {
        setPhotoError(result.error);
        return;
      }
      if (result.cancelled || !result.image) return;
      saveReview(row.id, {
        ...(row.review || {}),
        images: normalizeReviewImages([...(row.review?.images || []), result.image]),
      });
    },
    [saveReview],
  );

  const openFromTable = useCallback((item) => {
    setOpenFilter(null);
    setOpenRow(item);
  }, []);

  const renderRow = useCallback(
    ({ item, index }) => (
      <AccuracyTableRow
        row={item}
        last={index === visible.length - 1}
        showError={showError}
        showAll={showAll}
        onOpen={openFromTable}
      />
    ),
    [openFromTable, showAll, showError, visible.length],
  );

  const openLotFolder = useCallback(
    (lot) => {
      setOpenFilter(null);
      setFilters(EMPTY_FILTERS);
      setSort(null);
      onOpenLotChange?.(lot.id);
    },
    [onOpenLotChange],
  );

  const renderLotRow = useCallback(
    ({ item, index }) => (
      <LotTableRow lot={item} last={index === visibleLots.length - 1} onOpen={openLotFolder} />
    ),
    [openLotFolder, visibleLots.length],
  );

  const lotFilterOptions = [
    { key: 'all', label: 'All', ...(stats.total ? { count: stats.total } : {}) },
    { key: 'correct', label: 'Correct', ...(stats.correct ? { count: stats.correct } : {}) },
    { key: 'incorrect', label: 'Incorrect', ...(stats.incorrect ? { count: stats.incorrect } : {}) },
  ];

  const resultsHero = (
    <View style={[styles.heroPad, !isMobile && styles.heroPadDesktop]}>
      {isMobile && openLot ? (
        <SegmentedSlider
          options={lotFilterOptions}
          value={accuracyTab}
          onChange={(key) => onAccuracyTabChange?.(key)}
          fill
          compact
          style={styles.lotFilterSlider}
        />
      ) : null}
      <ChromeHero
        value={lotProgress?.expected ? `${lotProgress.percent}%` : stats.total ? `${stats.percent}%` : '0%'}
        stats={[
          ...(openLot ? [] : [{ label: stats.lots === 1 ? 'Lot' : 'Lots', value: String(stats.lots) }]),
          {
            label: 'Progress',
            value: lotProgress?.expected ? `${lotProgress.evaluated}/${lotProgress.expected}` : '—',
          },
          { label: 'Incorrect', value: String(stats.incorrect) },
        ]}
        footer={
          lotProgress?.expected ? (
            <View style={styles.heroProgress}>
              <ProgressBar
                value={lotProgress.evaluated}
                total={lotProgress.expected}
                height={7}
                trackColor="rgba(255,255,255,0.14)"
                fillColor={lotProgress.done ? '#34C759' : '#E8C36A'}
              />
            </View>
          ) : null
        }
        onPress={() => onBreakdownOpenChange?.(true)}
        accessibilityLabel="Open lot progress and metal weights"
      />
    </View>
  );

  const wrapResults = (list, title, meta) => (
    <View style={[styles.body, isMobile && styles.bodyMobile]}>
      {resultsHero}
      <ChromeSheet title={title} meta={meta} fill={isMobile} style={styles.sheetFill}>
        {list}
      </ChromeSheet>
    </View>
  );

  const breakdownDrawer = (
      <TriageDrawer
        visible={breakdownOpen}
        onClose={() => onBreakdownOpenChange?.(false)}
        title={openLot ? openLot.id : 'Lots'}
        subtitle={
          lotProgress?.expected
            ? `${lotProgress.evaluated} of ${lotProgress.expected} melt POs · ${stats.incorrect} ${
                stats.incorrect === 1 ? 'error' : 'errors'
              }`
            : stats.total
              ? `${stats.ratio} correct · ${stats.incorrect} ${stats.incorrect === 1 ? 'error' : 'errors'}`
              : 'No purchases in this filter'
        }
        leftLabel="Done"
        onLeft={() => onBreakdownOpenChange?.(false)}
        widthRatio={0.38}
        minWidth={360}
      >
        <ScrollView
          style={styles.breakBody}
          contentContainerStyle={styles.breakContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.breakHero}>
            <Text style={styles.breakHeroLabel}>Progress</Text>
            <Text style={styles.breakHeroValue}>
              {lotProgress?.expected ? `${lotProgress.percent}%` : stats.total ? `${stats.percent}%` : '—'}
            </Text>
            <Text style={styles.breakHeroMeta}>
              {lotProgress?.expected
                ? `${lotProgress.evaluated} of ${lotProgress.expected} melt POs · bullion-only excluded`
                : `${stats.ratio} correct${filtersActive || listQuery.trim() ? ' in this filter' : ''}`}
            </Text>
            <ProgressBar
              value={lotProgress?.expected ? lotProgress.evaluated : stats.correct}
              total={lotProgress?.expected ? lotProgress.expected : stats.total}
              tone={lotProgress?.done ? 'green' : 'blue'}
              height={6}
              style={styles.breakHeroBar}
            />
          </View>

          {lotMetals ? (
            <View style={styles.breakBlock}>
              <SectionLabel>Fine metal</SectionLabel>
              {LOT_FINE_METALS.map((metal, index) => {
                const expected = lotMetals.expected[metal.key] || 0;
                const completed = lotMetals.completed[metal.key] || 0;
                return (
                  <View
                    key={metal.key}
                    style={[styles.breakRow, index === LOT_FINE_METALS.length - 1 && styles.breakRowLast]}
                  >
                    <View style={styles.breakCopy}>
                      <Text style={styles.breakLabel} numberOfLines={1}>
                        {metal.label}
                      </Text>
                      <Text style={styles.breakCount}>{formatFineProgress(completed, expected)}</Text>
                    </View>
                    <Text style={styles.breakMetalName}>{metal.name}</Text>
                    <ProgressBar
                      value={completed}
                      total={expected || completed || 1}
                      tone={expected > 0 && completed >= expected ? 'green' : 'blue'}
                      height={4}
                      style={styles.breakBar}
                    />
                  </View>
                );
              })}
            </View>
          ) : null}

          <Pressable
            style={styles.breakLead}
            disabled={!topCategory}
            accessibilityRole="text"
            accessibilityLabel={
              topCategory
                ? `${topCategory.label} has the most errors, ${topCategory.count}`
                : 'No errors in this filter'
            }
          >
            <Text style={styles.breakLeadKicker}>Most errors</Text>
            <Text style={styles.breakLeadTitle} numberOfLines={2}>
              {topCategory ? topCategory.label : 'No errors in this filter'}
            </Text>
            {topCategory ? (
              <Text style={styles.breakLeadMeta}>
                {topCategory.count} of {errorRows.length}{' '}
                {errorRows.length === 1 ? 'error' : 'errors'}
              </Text>
            ) : null}
          </Pressable>

          <BreakdownList
            title="Category"
            rows={categories}
            total={errorRows.length}
            empty="No error categories in this filter."
          />
          <BreakdownList
            title="Employee"
            rows={employees}
            total={errorRows.length}
            empty="No employees with errors in this filter."
          />
          <BreakdownList
            title="Store"
            rows={stores}
            total={errorRows.length}
            empty="No stores with errors in this filter."
          />
        </ScrollView>
      </TriageDrawer>
  );

  if (accuracyRows.length === 0) {
    return (
      <>
        {wrapResults(
          <EmptyState
            icon="folder-outline"
            title="Results"
            body="Finish a PO to create its lot. Lots group every PO / SO from the same store and month."
          />,
          'Results',
          '0 lots',
        )}
        {breakdownDrawer}
      </>
    );
  }

  if (!openLot) {
    const lotEmpty = (
      <EmptyState
        icon="folder-outline"
        title={listQuery.trim() ? 'No matches' : 'No lots'}
        body={
          listQuery.trim()
            ? `No lot matches “${listQuery.trim()}”.`
            : 'Finish a PO to create its lot folder.'
        }
      />
    );
    return (
      <>
        {wrapResults(
      isMobile ? (
          visibleLots.length ? (
            <ScrollView
              style={styles.mobileList}
              contentContainerStyle={styles.mobileListContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              nestedScrollEnabled
            >
              {visibleLots.map((item, index) => {
                const progress = lotProgressOf(item);
                return (
                  <View
                    key={item.id}
                    style={[index === 0 && styles.mobileGroupStart, index === visibleLots.length - 1 && styles.mobileGroupEnd]}
                  >
                    <MobileListRow
                      title={item.id}
                      subtitle={[item.location, lotPeriodLabel(item)].filter(Boolean).join(' · ')}
                      meta={`${item.pos.length} ${item.pos.length === 1 ? 'PO' : 'POs'}`}
                      last={index === visibleLots.length - 1}
                      onPress={() => openLotFolder(item)}
                      accessibilityLabel={
                        progress.expected
                          ? `Open ${item.id}, ${progress.evaluated} of ${progress.expected} evaluated`
                          : `Open ${item.id}`
                      }
                      leading={
                        <View style={styles.lotIconMobile}>
                          <Ionicons name="folder-outline" size={22} color={T.text} />
                        </View>
                      }
                      extra={progress.expected ? <LotProgress lot={item} compact /> : null}
                    />
                  </View>
                );
              })}
            </ScrollView>
          ) : (
            lotEmpty
          )
        ) : (
          <TableFrame
            minWidth={780}
            data={visibleLots}
            renderItem={renderLotRow}
            keyExtractor={(lot) => lot.id}
            extraData={visibleLots.map((lot) => `${lot.id}:${lot.evaluated}/${lot.expected}`).join('|')}
            ListEmptyComponent={
              <TableEmpty>
                {listQuery.trim() ? `No lot matches “${listQuery.trim()}”.` : 'No lots yet.'}
              </TableEmpty>
            }
            header={
              <>
                <TablePhotoCell />
                <View style={[styles.lotHead, { flex: LOT_COL.lot.flex, minWidth: LOT_COL.lot.minWidth }]}>
                  <Text style={styles.lotHeadText}>Lot</Text>
                </View>
                <View style={[styles.lotHead, { flex: LOT_COL.location.flex, minWidth: LOT_COL.location.minWidth }]}>
                  <Text style={styles.lotHeadText}>Store</Text>
                </View>
                <View style={[styles.lotHead, { flex: LOT_COL.period.flex, minWidth: LOT_COL.period.minWidth }]}>
                  <Text style={styles.lotHeadText}>Period</Text>
                </View>
                <View style={[styles.lotHead, { flex: LOT_COL.documents.flex, minWidth: LOT_COL.documents.minWidth }]}>
                  <Text style={styles.lotHeadText}>POs</Text>
                </View>
                <View style={[styles.lotHead, styles.lotHeadEnd, { flex: LOT_COL.progress.flex, minWidth: LOT_COL.progress.minWidth }]}>
                  <Text style={styles.lotHeadText}>Progress</Text>
                </View>
              </>
            }
          />
        ),
      'Lots',
      `${visibleLots.length} ${visibleLots.length === 1 ? 'lot' : 'lots'}`,
        )}
        {breakdownDrawer}
      </>
    );
  }

  const mobileEmpty = (
    <EmptyState
      icon={showError ? 'alert-circle-outline' : showAll ? 'folder-outline' : 'checkmark-done-outline'}
      title={
        listQuery.trim() || filtersActive
          ? 'No matches'
          : showError
            ? 'No incorrect purchases in this lot'
            : showAll
              ? 'No purchases in this lot'
              : 'No correct purchases in this lot'
      }
      body={
        listQuery.trim() || filtersActive
          ? `Nothing matches ${listQuery.trim() ? `“${listQuery.trim()}”` : 'those filters'}.`
          : showError
            ? 'POs with a correction, note, or error type land here.'
            : showAll
              ? 'Evaluated POs in this lot land here.'
              : 'Received POs with no corrections land here.'
      }
    />
  );

  const lotDetail = wrapResults(
    isMobile ? (
        visible.length ? (
          <ScrollView
            style={styles.mobileList}
            contentContainerStyle={styles.mobileListContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            nestedScrollEnabled
          >
            {photoError ? <Text style={styles.mobilePhotoError}>{photoError}</Text> : null}
            {showError ? <Text style={styles.mobileHint}>Tap a purchase to edit its error.</Text> : null}
            {visible.map((item, index) => {
              const photos = normalizeReviewImages(item.review?.images);
              const atMax = photos.length >= MAX_REVIEW_IMAGES;
              const flagged = triagePoNeedsCorrection(item);
              return (
                <View
                  key={accuracyKey(item)}
                  style={[index === 0 && styles.mobileGroupStart, index === visible.length - 1 && styles.mobileGroupEnd]}
                >
                  <MobileListRow
                    title={item.reference || 'Document'}
                    subtitle={[staffName(item) || null, item.storeName, item.dateLabel].filter(Boolean).join(' · ')}
                    meta={
                      showError || (showAll && flagged)
                        ? [errorPlace(item), item.review?.errorAmount].filter(Boolean).join(' · ')
                        : item.triageDateLabel || item.amountLabel || ''
                    }
                    last={index === visible.length - 1 && !showError && !(showAll && flagged)}
                    onPress={() => openFromTable(item)}
                    accessibilityLabel={`Open ${item.reference || 'document'}`}
                    leading={<PoThumb urls={item.imageUrls} label={item.reference} size={52} />}
                    trailing={
                      showError || (showAll && flagged) ? (
                        <MobileCameraButton
                          count={photos.length}
                          busy={photoBusyId === item.id}
                          disabled={atMax && photoBusyId !== item.id}
                          onPress={() => addPhotoToRow(item)}
                          accessibilityLabel={
                            atMax
                              ? `View photos for ${item.reference}`
                              : `Take a photo of ${item.reference}`
                          }
                        />
                      ) : (
                        <StatusPill label="Correct" tone="green" compact />
                      )
                    }
                  />
                  {showError || (showAll && flagged) ? (
                    <Pressable
                      onPress={() => openFromTable(item)}
                      style={[styles.mobileDetail, index === visible.length - 1 && styles.mobileDetailLast]}
                      accessibilityRole="button"
                      accessibilityLabel={`Edit error for ${item.reference || 'document'}`}
                    >
                      <ErrorDetailBlock review={item.review} />
                    </Pressable>
                  ) : null}
                </View>
              );
            })}
          </ScrollView>
        ) : (
          mobileEmpty
        )
      ) : (
      <TableFrame
        minWidth={showError || showAll ? 920 : 780}
        data={visible}
        renderItem={renderRow}
        keyExtractor={accuracyKey}
        extraData={`${showError}-${visible.length}-${sort?.key || ''}-${sort?.dir || ''}`}
        fixedRowHeight
        toolbar={
          filtersActive || sort ? (
            <View style={styles.toolbarEnd}>
              <TextAction label="Clear" onPress={clearFilters} />
            </View>
          ) : null
        }
        ListEmptyComponent={
          <TableEmpty>
            {listQuery.trim() || filtersActive
              ? `Nothing matches ${listQuery.trim() ? `“${listQuery.trim()}”` : 'those filters'}.`
              : showError
                ? 'No incorrect purchases in this set.'
                : showAll
                  ? 'No purchases in this set.'
                  : 'No correct purchases in this set.'}
          </TableEmpty>
        }
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
              style={showError || showAll ? { flex: 1.8, minWidth: 220 } : COL.reference}
              {...sortProps('reference')}
            />
            <ColumnFilter
              columnKey="dateLabel"
              label="Date"
              value={filters.dateLabel}
              onChange={(value) => setFilter('dateLabel', value)}
              options={dateOptions}
              openKey={openFilter}
              onOpenKey={setOpenFilter}
              style={COL.date}
              {...sortProps('dateLabel')}
            />
            <ColumnFilter
              columnKey="person"
              label="Person"
              value={filters.person}
              onChange={(value) => setFilter('person', value)}
              options={personOptions}
              openKey={openFilter}
              onOpenKey={setOpenFilter}
              style={COL.person}
              {...sortProps('person')}
            />
            <ColumnFilter
              columnKey="store"
              label="Store"
              value={filters.store}
              onChange={(value) => setFilter('store', value)}
              options={storeOptions}
              openKey={openFilter}
              onOpenKey={setOpenFilter}
              style={COL.store}
              {...sortProps('store')}
            />
            {showError || showAll ? (
              <>
                <ColumnFilter
                  columnKey="error"
                  label="Error"
                  value={filters.error}
                  onChange={(value) => setFilter('error', value)}
                  options={errorOptions}
                  openKey={openFilter}
                  onOpenKey={setOpenFilter}
                  style={COL.error}
                  {...sortProps('error')}
                />
                <ColumnFilter
                  columnKey="amount"
                  label="Amount"
                  value={[]}
                  sortOnly
                  openKey={openFilter}
                  onOpenKey={setOpenFilter}
                  align="end"
                  style={{ ...COL.amount, alignItems: 'flex-end' }}
                  {...sortProps('amount')}
                />
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
                style={{ ...COL.received, alignItems: 'flex-end' }}
                {...sortProps('received')}
              />
            )}
          </>
        }
      />
      ),
    openLot?.id || 'Lot',
    `${visible.length} ${visible.length === 1 ? 'PO' : 'POs'}`,
  );

  return (
    <>
      {lotDetail}
      <TriageReviewDrawer
        visible={Boolean(openRow)}
        session={session}
        row={openRow}
        review={openRow?.review || null}
        extraRows={lotRows}
        onClose={() => setOpenRow(null)}
        onSave={saveReview}
      />
      {breakdownDrawer}
    </>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    minHeight: 0,
    backgroundColor: T.bg,
  },
  bodyMobile: {
    backgroundColor: T.bg,
  },
  heroPad: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 10,
  },
  heroPadDesktop: {
    paddingHorizontal: 32,
    paddingTop: 4,
    paddingBottom: 18,
  },
  lotFilterSlider: {
    marginBottom: 10,
  },
  heroProgress: {
    paddingHorizontal: 4,
  },
  breakMetalName: {
    fontFamily,
    fontSize: 12,
    color: T.secondary,
    marginTop: -2,
  },
  sheetFill: {
    flex: 1,
    minHeight: 0,
  },
  mobileList: {
    flex: 1,
    minHeight: 0,
    ...Platform.select({
      web: { overflowY: 'auto', touchAction: 'pan-y', WebkitOverflowScrolling: 'touch' },
      default: {},
    }),
  },
  mobileListContent: {
    paddingTop: 0,
    paddingBottom: 40,
    flexGrow: 1,
    backgroundColor: '#fff',
    paddingHorizontal: 0,
  },
  mobileHint: {
    fontFamily,
    fontSize: 13,
    lineHeight: 18,
    color: T.secondary,
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  mobileDetail: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: '#fff',
  },
  mobileDetailLast: {
    borderBottomLeftRadius: 8,
    borderBottomRightRadius: 8,
  },
  detailBlock: {
    gap: 4,
    paddingTop: 2,
  },
  detailLine: {
    fontFamily,
    fontSize: 13,
    lineHeight: 18,
    color: T.text,
  },
  detailPhotos: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 4,
  },
  detailPhoto: {
    width: 64,
    height: 64,
    borderRadius: 8,
    backgroundColor: '#f5f5f5',
  },
  mobilePhotoError: {
    fontFamily,
    fontSize: 13,
    color: T.red,
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  mobileGroupStart: {
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    overflow: 'hidden',
  },
  mobileGroupEnd: {
    borderBottomLeftRadius: 8,
    borderBottomRightRadius: 8,
    overflow: 'hidden',
  },
  toolbarEnd: {
    marginLeft: 'auto',
  },
  lotIcon: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f5f5f5',
  },
  lotIconMobile: {
    width: 52,
    height: 52,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f5f5f5',
  },
  lotHead: {
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  lotHeadEnd: {
    alignItems: 'flex-end',
  },
  lotHeadText: {
    fontFamily,
    fontSize: 11,
    fontWeight: '600',
    color: T.secondary,
    letterSpacing: 0.2,
    textTransform: 'uppercase',
  },
  lotProgress: {
    alignSelf: 'stretch',
    alignItems: 'flex-end',
    gap: 6,
    minWidth: 88,
  },
  lotProgressCompact: {
    minWidth: 0,
    alignItems: 'stretch',
    gap: 5,
    marginTop: 4,
  },
  lotProgressText: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: T.text,
    fontVariant: ['tabular-nums'],
  },
  lotProgressTextCompact: {
    fontSize: 12,
    color: T.secondary,
  },
  lotProgressBar: {
    alignSelf: 'stretch',
  },
  breakBody: {
    flex: 1,
    minHeight: 0,
    backgroundColor: T.bg,
  },
  breakContent: {
    paddingHorizontal: 22,
    paddingTop: 18,
    paddingBottom: 40,
    gap: 8,
  },
  breakHero: {
    paddingBottom: 18,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: T.hairline,
    marginBottom: 8,
  },
  breakHeroLabel: {
    fontFamily,
    fontSize: 11,
    fontWeight: '600',
    color: T.secondary,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  breakHeroValue: {
    fontFamily,
    fontSize: 34,
    fontWeight: '600',
    color: T.text,
    letterSpacing: -0.8,
    marginTop: 4,
  },
  breakHeroMeta: {
    fontFamily,
    fontSize: 13,
    color: T.secondary,
    marginTop: 2,
    marginBottom: 10,
  },
  breakHeroBar: {
    marginTop: 2,
  },
  breakLead: {
    paddingVertical: 14,
    gap: 2,
  },
  breakLeadKicker: {
    fontFamily,
    fontSize: 11,
    fontWeight: '600',
    color: T.secondary,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  breakLeadTitle: {
    fontFamily,
    fontSize: 20,
    fontWeight: '600',
    color: T.text,
    letterSpacing: -0.4,
  },
  breakLeadMeta: {
    fontFamily,
    fontSize: 13,
    color: T.secondary,
    marginTop: 2,
  },
  breakBlock: {
    paddingTop: 12,
    paddingBottom: 8,
  },
  breakEmpty: {
    fontFamily,
    fontSize: 13,
    color: T.secondary,
    paddingVertical: 8,
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
  breakBar: {
    alignSelf: 'stretch',
  },
});

