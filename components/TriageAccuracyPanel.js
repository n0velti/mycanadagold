import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  applyTriageReviewToPo,
  collectAccuracyTriagePos,
  saveTriagePoReview,
  triageEditorFromSession,
  triagePoNeedsCorrection,
  useTransferWorkflow,
} from '../lib/transferWorkflow';
import { groupPosIntoLots, lotMatchesQuery, lotPeriodLabel } from '../lib/triageLots';
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
  EmptyState,
  FONT,
  MobileCameraButton,
  MobileListRow,
  ProgressBar,
  SectionLabel,
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
  accuracy: { flex: 0.95, minWidth: 96 },
};

const LotTableRow = memo(function LotTableRow({ lot, last, onOpen }) {
  const total = lot.correct + lot.incorrect;
  const percent = total ? Math.round((lot.correct / total) * 100) : 0;
  return (
    <TableRow last={last}>
      <TablePhotoCell>
        <View style={styles.lotIcon}>
          <Ionicons name="folder-outline" size={22} color={T.text} />
        </View>
      </TablePhotoCell>
      <TableRowMain onPress={() => onOpen(lot)} accessibilityLabel={`Open ${lot.id}`}>
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
        <TableCell flex={LOT_COL.accuracy.flex} minWidth={LOT_COL.accuracy.minWidth} align="right" last>
          {total ? `${lot.correct}/${total} · ${percent}%` : '—'}
        </TableCell>
      </TableRowMain>
    </TableRow>
  );
});

const AccuracyTableRow = memo(function AccuracyTableRow({ row, last, showError, onOpen }) {
  const detail = errorDetailParts(row.review);
  const summary = showError ? errorDetailSummary(row.review) : '';
  const referenceCol = showError ? { flex: 1.8, minWidth: 220 } : COL.reference;
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
        {showError ? (
          <>
            <TableCell flex={COL.error.flex} minWidth={COL.error.minWidth}>
              {errorPlace(row)}
            </TableCell>
            <TableCell flex={COL.amount.flex} minWidth={COL.amount.minWidth} align="right" last>
              {detail.amount || '—'}
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
  accuracyTab = 'correct',
  listQuery = '',
  onStatsChange,
  breakdownOpen = false,
  onBreakdownOpenChange,
  openLotId = '',
  onOpenLotChange,
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

  const accuracyRows = useMemo(() => collectAccuracyTriagePos(triage), [triage]);
  const lots = useMemo(() => groupPosIntoLots(accuracyRows), [accuracyRows]);
  const visibleLots = useMemo(
    () => lots.filter((lot) => lotMatchesQuery(lot, listQuery)),
    [listQuery, lots],
  );
  const openLot = useMemo(
    () => lots.find((lot) => lot.id === openLotId) || null,
    [lots, openLotId],
  );
  const lotRows = useMemo(() => (openLot ? openLot.pos : accuracyRows), [accuracyRows, openLot]);

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
      scoped.filter((row) =>
        showError
          ? triagePoNeedsCorrection(row) && matchesSelectedLabel(errorPlace(row), filters.error)
          : Boolean(row.received) &&
            !triagePoNeedsCorrection(row) &&
            matchesSelectedLabel(row.triageDateLabel || row.amountLabel, filters.received),
      ),
    [filters.error, filters.received, scoped, showError],
  );

  const optionsPool = useMemo(
    () =>
      lotRows.filter(
        (row) =>
          (!openLot || rowMatchesQuery(row, listQuery)) &&
          (showError ? triagePoNeedsCorrection(row) : Boolean(row.received) && !triagePoNeedsCorrection(row)),
      ),
    [listQuery, lotRows, openLot, showError],
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
        onOpen={openFromTable}
      />
    ),
    [openFromTable, showError, visible.length],
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

  if (accuracyRows.length === 0) {
    return (
      <View style={[styles.body, isMobile && styles.bodyMobile]}>
        <EmptyState
          icon="folder-outline"
          title="Results"
          body="Finish a PO to create its lot. Lots group every PO / SO from the same store and month."
        />
      </View>
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
      <View style={[styles.body, isMobile && styles.bodyMobile]}>
        {isMobile ? (
          <FlatList
            style={styles.mobileList}
            contentContainerStyle={styles.mobileListContent}
            data={visibleLots}
            keyExtractor={(lot) => lot.id}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={lotEmpty}
            renderItem={({ item, index }) => {
              const total = item.correct + item.incorrect;
              const percent = total ? Math.round((item.correct / total) * 100) : 0;
              return (
                <View style={[index === 0 && styles.mobileGroupStart, index === visibleLots.length - 1 && styles.mobileGroupEnd]}>
                  <MobileListRow
                    title={item.id}
                    subtitle={[item.location, lotPeriodLabel(item)].filter(Boolean).join(' · ')}
                    meta={`${item.pos.length} ${item.pos.length === 1 ? 'PO' : 'POs'}${total ? ` · ${percent}% correct` : ''}`}
                    last={index === visibleLots.length - 1}
                    onPress={() => openLotFolder(item)}
                    accessibilityLabel={`Open ${item.id}`}
                    leading={
                      <View style={styles.lotIconMobile}>
                        <Ionicons name="folder-outline" size={22} color={T.text} />
                      </View>
                    }
                  />
                </View>
              );
            }}
          />
        ) : (
          <TableFrame
            minWidth={780}
            data={visibleLots}
            renderItem={renderLotRow}
            keyExtractor={(lot) => lot.id}
            extraData={`${visibleLots.length}`}
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
                <View style={[styles.lotHead, styles.lotHeadEnd, { flex: LOT_COL.accuracy.flex, minWidth: LOT_COL.accuracy.minWidth }]}>
                  <Text style={styles.lotHeadText}>Results</Text>
                </View>
              </>
            }
          />
        )}
      </View>
    );
  }

  const mobileEmpty = (
    <EmptyState
      icon={showError ? 'alert-circle-outline' : 'checkmark-done-outline'}
      title={
        listQuery.trim() || filtersActive
          ? 'No matches'
            : showError
            ? 'No incorrect purchases in this lot'
            : 'No correct purchases in this lot'
      }
      body={
        listQuery.trim() || filtersActive
          ? `Nothing matches ${listQuery.trim() ? `“${listQuery.trim()}”` : 'those filters'}.`
          : showError
            ? 'POs with a correction, note, or error type land here.'
            : 'Received POs with no corrections land here.'
      }
    />
  );

  return (
    <View style={[styles.body, isMobile && styles.bodyMobile]}>
      {isMobile ? (
        <FlatList
          style={styles.mobileList}
          contentContainerStyle={styles.mobileListContent}
          data={visible}
          keyExtractor={accuracyKey}
          extraData={`${showError}-${photoBusyId}-${visible.length}`}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            photoError ? (
              <Text style={styles.mobilePhotoError}>{photoError}</Text>
            ) : showError && visible.length ? (
              <Text style={styles.mobileHint}>Tap a purchase to edit its error.</Text>
            ) : null
          }
          ListEmptyComponent={mobileEmpty}
          renderItem={({ item, index }) => {
            const photos = normalizeReviewImages(item.review?.images);
            const atMax = photos.length >= MAX_REVIEW_IMAGES;
            return (
              <View style={[index === 0 && styles.mobileGroupStart, index === visible.length - 1 && styles.mobileGroupEnd]}>
                <MobileListRow
                  title={item.reference || 'Document'}
                  subtitle={[staffName(item) || null, item.storeName, item.dateLabel].filter(Boolean).join(' · ')}
                  meta={
                    showError
                      ? [errorPlace(item), item.review?.errorAmount].filter(Boolean).join(' · ')
                      : item.triageDateLabel || item.amountLabel || ''
                  }
                  last={index === visible.length - 1 && !showError}
                  onPress={() => openFromTable(item)}
                  accessibilityLabel={`Open ${item.reference || 'document'}`}
                  leading={<PoThumb urls={item.imageUrls} label={item.reference} size={52} />}
                  trailing={
                    showError ? (
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
                {showError ? (
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
          }}
        />
      ) : (
      <TableFrame
        minWidth={showError ? 920 : 780}
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
              style={showError ? { flex: 1.8, minWidth: 220 } : COL.reference}
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
            {showError ? (
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
      )}

      <TriageReviewDrawer
        visible={Boolean(openRow)}
        session={session}
        row={openRow}
        review={openRow?.review || null}
        extraRows={lotRows}
        onClose={() => setOpenRow(null)}
        onSave={saveReview}
      />

      <TriageDrawer
        visible={breakdownOpen}
        onClose={() => onBreakdownOpenChange?.(false)}
        title="Errors"
        subtitle={
          stats.total
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
            <Text style={styles.breakHeroLabel}>Results</Text>
            <Text style={styles.breakHeroValue}>{stats.total ? `${stats.percent}%` : '—'}</Text>
            <Text style={styles.breakHeroMeta}>
              {stats.ratio} correct
              {filtersActive || listQuery.trim() ? ' in this filter' : ''}
            </Text>
            <ProgressBar value={stats.correct} total={stats.total} tone="green" height={6} style={styles.breakHeroBar} />
          </View>

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
    backgroundColor: T.bg,
  },
  mobileList: {
    flex: 1,
    minHeight: 0,
  },
  mobileListContent: {
    paddingTop: 0,
    paddingBottom: 40,
    flexGrow: 1,
    backgroundColor: T.bg,
    paddingHorizontal: 16,
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

