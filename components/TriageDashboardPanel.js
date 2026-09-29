/**
 * Triage dashboard: Errors, Allocation, and Expected Return.
 * Mobile matches the Home tab: hero, stat row, full-bleed list.
 */
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  applyTriageReviewToPo,
  collectAccuracyTriagePos,
  collectAllTriagePos,
  RECEIVE_STATUS,
  RECEIVE_STATUS_LABELS,
  saveTriagePoReview,
  transferGoesToWorkshop,
  triageEditorFromSession,
  triagePoNeedsCorrection,
  useTransferWorkflow,
} from '../lib/transferWorkflow';
import { groupPosIntoLots, lotPeriodLabel } from '../lib/triageLots';
import { formatAmount } from '../lib/transactions';
import { formatErrorAmount } from '../lib/triageDraft';
import { CANVAS, useIsMobile } from '../lib/mobileUi';
import { EmptyState, FONT, Group, ProgressBar, SectionLabel, T, TextAction } from './TriageKit';
import {
  PoThumb,
  TableCell,
  TableEmpty,
  TableFrame,
  TableMuted,
  TablePhotoCell,
  TableRow,
  TableRowMain,
  TableStrong,
} from './TriageTable';
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

function summarizeTransfers(planned) {
  const rows = [...(planned || [])].sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0));
  let open = 0;
  let partial = 0;
  let received = 0;
  let workshop = 0;
  for (const row of rows) {
    if (row.receiveStatus === RECEIVE_STATUS.all_received) received += 1;
    else if (row.receiveStatus === RECEIVE_STATUS.partially_received) partial += 1;
    else open += 1;
    if (transferGoesToWorkshop(row)) workshop += 1;
  }
  return { rows, count: rows.length, open, partial, received, workshop };
}

function transferStatusLabel(row) {
  return RECEIVE_STATUS_LABELS[row?.receiveStatus] || 'Not Received';
}

function transferPathLabel(row) {
  const from = String(row?.fromName || '').trim();
  const to = String(row?.toName || '').trim();
  if (from && to) return `${from} → ${to}`;
  return from || to || 'Transfer';
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

function errorSummaryLine(row) {
  const note = String(row?.review?.note || '').trim();
  const amount = formatErrorAmount(row?.review?.errorAmount || '');
  return [errorTypeOf(row), amount, note].filter(Boolean).join(' · ');
}

function HomeHero({ label, value, stats }) {
  return (
    <View style={styles.hero}>
      {label ? <Text style={styles.heroLabel}>{label}</Text> : null}
      <Text style={styles.heroAmount} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      {stats?.length ? (
        <View style={styles.heroStats}>
          {stats.map((stat, index) => (
            <View key={stat.label} style={styles.heroStatWrap}>
              {index ? <View style={styles.heroStatDivider} /> : null}
              <View style={styles.heroStat}>
                <Text style={styles.heroStatValue} numberOfLines={1}>
                  {stat.value}
                </Text>
                <Text style={styles.heroStatLabel} numberOfLines={1}>
                  {stat.label}
                </Text>
              </View>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function HomeSection({ title, meta, children }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {meta ? <Text style={styles.sectionMeta}>{meta}</Text> : null}
      </View>
      <View style={styles.list}>{children}</View>
    </View>
  );
}

function HomeRow({
  title,
  meta,
  value,
  icon,
  iconColor = '#1a1a1a',
  leading,
  last,
  onPress,
  chevron = true,
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [styles.row, pressed && onPress && styles.rowPressed]}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={value ? `${title}, ${value}` : title}
      {...(Platform.OS === 'web' && onPress ? { className: 'cgold-dash-row' } : null)}
    >
      {leading || (
        <View style={[styles.rowIcon, { backgroundColor: iconColor }]}>
          <Ionicons name={icon} size={22} color="#fff" />
        </View>
      )}
      <View style={[styles.rowBody, !last && styles.rowDivider]}>
        <View style={styles.rowCopy}>
          <Text style={styles.rowTitle} numberOfLines={1}>
            {title}
          </Text>
          {meta ? (
            <Text style={styles.rowMeta} numberOfLines={1}>
              {meta}
            </Text>
          ) : null}
        </View>
        {value != null && value !== '' ? (
          <Text style={styles.rowValue} numberOfLines={1}>
            {value}
          </Text>
        ) : null}
        {onPress && chevron ? (
          <Ionicons name="chevron-forward" size={18} color="#c7c7cc" style={styles.rowChevron} />
        ) : (
          <View style={styles.rowChevron} />
        )}
      </View>
    </Pressable>
  );
}

const ErrorTableRow = memo(function ErrorTableRow({ row, last, onOpen }) {
  return (
    <TableRow last={last}>
      <TablePhotoCell>
        <PoThumb urls={row.imageUrls} label={row.reference} />
      </TablePhotoCell>
      <TableRowMain onPress={() => onOpen(row)} accessibilityLabel={`Open ${row.reference || 'error'}`}>
        <TableCell flex={1.6} minWidth={160}>
          <TableStrong>{row.reference || 'Document'}</TableStrong>
          <TableMuted>{errorSummaryLine(row)}</TableMuted>
        </TableCell>
        <TableCell flex={1} minWidth={110}>
          {row.storeName || '—'}
        </TableCell>
        <TableCell flex={1} minWidth={110}>
          {staffName(row) || '—'}
        </TableCell>
        <TableCell flex={0.85} minWidth={92}>
          {row.dateLabel || '—'}
        </TableCell>
        <TableCell flex={0.8} minWidth={88} align="right" last>
          {formatErrorAmount(row?.review?.errorAmount || '') || '—'}
        </TableCell>
      </TableRowMain>
    </TableRow>
  );
});

function DashCard({ title, value, meta, tone, icon, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${value}. ${meta || ''}`}
      accessibilityHint={`Opens ${title}`}
      {...(Platform.OS === 'web' ? { className: 'cgold-dash-card' } : null)}
    >
      <View style={styles.cardTop}>
        <View style={styles.cardIcon}>
          <Ionicons name={icon} size={20} color={T.text} />
        </View>
        <Ionicons name="chevron-forward" size={18} color={T.secondary} />
      </View>
      <Text style={styles.cardKicker}>{title}</Text>
      <Text style={[styles.cardValue, tone === 'red' && styles.cardValueRed]} numberOfLines={1}>
        {value}
      </Text>
      {meta ? (
        <Text style={styles.cardMeta} numberOfLines={2}>
          {meta}
        </Text>
      ) : null}
    </Pressable>
  );
}

function ErrorsPage({ rows, query, onOpen, isMobile }) {
  const visible = useMemo(() => rows.filter((row) => matchesQuery(row, query)), [query, rows]);
  const types = useMemo(() => rankCounts(visible, errorTypeOf), [visible]);
  const amount = useMemo(() => visible.reduce((sum, row) => sum + errorAmountOf(row), 0), [visible]);

  if (!rows.length) {
    return (
      <EmptyState
        icon="alert-circle-outline"
        title="No errors"
        body="Flagged POs and SOs land here after triage reviews them."
      />
    );
  }

  const empty = query.trim() ? `No error matches “${query.trim()}”.` : 'No errors.';
  const storeCount = new Set(visible.map((row) => String(row.storeName || '').trim()).filter((name) => name && name !== '—')).size;

  if (isMobile) {
    return (
      <ScrollView
        style={styles.mobileScroll}
        contentContainerStyle={styles.mobileScrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <HomeHero
          label="Errors"
          value={amount ? formatAmount(amount) : String(visible.length)}
          stats={[
            { label: visible.length === 1 ? 'Error' : 'Errors', value: String(visible.length) },
            { label: storeCount === 1 ? 'Store' : 'Stores', value: String(storeCount) },
            { label: types[0]?.label || 'Type', value: types[0] ? String(types[0].count) : '—' },
          ]}
        />
        {types.length ? (
          <HomeSection title="By type" meta={`${types.length}`}>
            {types.map((row, index) => (
              <HomeRow
                key={row.label}
                title={row.label}
                meta={`${row.count} of ${visible.length} · ${Math.round((row.count / visible.length) * 100)}%`}
                value={String(row.count)}
                icon="alert-circle"
                iconColor="#C2410C"
                last={index === types.length - 1}
                chevron={false}
              />
            ))}
          </HomeSection>
        ) : null}
        <HomeSection title="Documents" meta={String(visible.length)}>
          {visible.length ? (
            visible.map((row, index) => (
              <HomeRow
                key={`${row.triageId}-${row.id}`}
                title={row.reference || 'Document'}
                meta={[errorTypeOf(row), row.storeName, staffName(row)].filter(Boolean).join(' · ')}
                value={formatErrorAmount(row?.review?.errorAmount || '') || ''}
                leading={<PoThumb urls={row.imageUrls} label={row.reference} size={46} />}
                last={index === visible.length - 1}
                onPress={() => onOpen(row)}
              />
            ))
          ) : (
            <Text style={styles.emptyCopy}>{empty}</Text>
          )}
        </HomeSection>
      </ScrollView>
    );
  }

  return (
    <View style={styles.page}>
      <View style={styles.pageIntro}>
        <Text style={styles.pageSub}>
          {visible.length} {visible.length === 1 ? 'error' : 'errors'}
          {amount ? ` · ${formatAmount(amount)}` : ''}
          {types[0] ? ` · ${types[0].label} most common` : ''}
        </Text>
      </View>

      {types.length ? (
        <View style={styles.breakBlock}>
          <SectionLabel>By type</SectionLabel>
          <Group>
            {types.map((row, index) => (
              <View key={row.label} style={[styles.breakRow, index === types.length - 1 && styles.breakRowLast]}>
                <View style={styles.breakCopy}>
                  <Text style={styles.breakLabel} numberOfLines={1}>
                    {row.label}
                  </Text>
                  <Text style={styles.breakCount}>
                    {row.count}
                    {visible.length ? ` · ${Math.round((row.count / visible.length) * 100)}%` : ''}
                  </Text>
                </View>
                <ProgressBar value={row.count} total={visible.length || row.count} tone="orange" height={4} />
              </View>
            ))}
          </Group>
        </View>
      ) : null}

      <TableFrame
        minWidth={860}
        data={visible}
        keyExtractor={(row) => `${row.triageId}-${row.id}`}
        renderItem={({ item, index }) => (
          <ErrorTableRow row={item} last={index === visible.length - 1} onOpen={onOpen} />
        )}
        ListEmptyComponent={<TableEmpty>{empty}</TableEmpty>}
        toolbar={
          <Text style={styles.tableMeta}>
            {visible.length} {visible.length === 1 ? 'error' : 'errors'}
            {query.trim() ? ` of ${rows.length}` : ''}
          </Text>
        }
        header={
          <>
            <TablePhotoCell />
            <TableCell flex={1.6} minWidth={160}>
              <Text style={styles.headText}>PO / SO</Text>
            </TableCell>
            <TableCell flex={1} minWidth={110}>
              <Text style={styles.headText}>Store</Text>
            </TableCell>
            <TableCell flex={1} minWidth={110}>
              <Text style={styles.headText}>Person</Text>
            </TableCell>
            <TableCell flex={0.85} minWidth={92}>
              <Text style={styles.headText}>Date</Text>
            </TableCell>
            <TableCell flex={0.8} minWidth={88} align="right" last>
              <Text style={styles.headText}>Amount</Text>
            </TableCell>
          </>
        }
      />
    </View>
  );
}

function TransfersPage({ summary, isMobile }) {
  if (isMobile) {
    return (
      <ScrollView style={styles.mobileScroll} contentContainerStyle={styles.mobileScrollContent}>
        <HomeHero
          label="Transfers"
          value={String(summary.count)}
          stats={[
            { label: 'Open', value: String(summary.open) },
            { label: 'Partial', value: String(summary.partial) },
            { label: 'Received', value: String(summary.received) },
          ]}
        />
        <HomeSection title="Transfers" meta={String(summary.count)}>
          {summary.rows.length ? (
            summary.rows.map((row, index) => (
              <HomeRow
                key={row.id}
                title={row.reference || `TR# ${row.number || ''}`}
                meta={[transferPathLabel(row), row.dateLabel].filter(Boolean).join(' · ')}
                value={transferStatusLabel(row)}
                icon="swap-horizontal"
                iconColor="#1F7A9A"
                last={index === summary.rows.length - 1}
                chevron={false}
              />
            ))
          ) : (
            <Text style={styles.emptyCopy}>Store-to-workshop transfers land here as they are created.</Text>
          )}
        </HomeSection>
      </ScrollView>
    );
  }

  return (
    <View style={styles.page}>
      <View style={styles.pageIntro}>
        <Text style={styles.pageSub}>
          {summary.count
            ? `${summary.open} open · ${summary.partial} partial · ${summary.received} received`
            : 'Store-to-workshop transfers land here as they are created.'}
        </Text>
      </View>
      {summary.rows.length ? (
        <Group>
          {summary.rows.map((row, index) => (
            <View key={row.id} style={[styles.lotRow, index === summary.rows.length - 1 && styles.lotRowLast]}>
              <View style={styles.lotCopy}>
                <Text style={styles.lotTitle}>{row.reference || `TR# ${row.number || ''}`}</Text>
                <Text style={styles.lotMeta}>{[transferPathLabel(row), row.dateLabel].filter(Boolean).join(' · ')}</Text>
              </View>
              <Text style={styles.lotCount}>{transferStatusLabel(row)}</Text>
            </View>
          ))}
        </Group>
      ) : (
        <EmptyState
          icon="swap-horizontal-outline"
          title="No transfers"
          body="Transfers to the workshop will show up here."
        />
      )}
    </View>
  );
}

function AllocationPage({ lots, isMobile }) {
  if (isMobile) {
    return (
      <ScrollView style={styles.mobileScroll} contentContainerStyle={styles.mobileScrollContent}>
        <HomeHero
          label="Allocation"
          value="0"
          stats={[
            { label: lots.length === 1 ? 'Lot' : 'Lots', value: String(lots.length) },
            { label: 'Allocated', value: '0' },
            { label: 'Ready', value: String(lots.length) },
          ]}
        />
        <HomeSection title="Lots" meta={String(lots.length)}>
          {lots.length ? (
            lots.map((lot, index) => (
              <HomeRow
                key={lot.id}
                title={lot.id}
                meta={[lot.location, lotPeriodLabel(lot)].filter(Boolean).join(' · ')}
                value="Open"
                icon="folder"
                iconColor="#3A3A3C"
                last={index === lots.length - 1}
                chevron={false}
              />
            ))
          ) : (
            <Text style={styles.emptyCopy}>Lots you finish will show up here for allocation.</Text>
          )}
        </HomeSection>
      </ScrollView>
    );
  }

  return (
    <View style={styles.page}>
      <View style={styles.pageIntro}>
        <Text style={styles.pageSub}>
          {lots.length
            ? `${lots.length} ${lots.length === 1 ? 'lot' : 'lots'} ready to allocate once melt is split.`
            : 'Lots you finish will show up here for allocation.'}
        </Text>
      </View>
      <EmptyState
        icon="git-branch-outline"
        title="Nothing allocated"
        body="When a lot is ready to split across destinations, it will be listed here."
      />
    </View>
  );
}

function ExpectedReturnPage({ lots, summary, isMobile }) {
  if (!lots.length) {
    return (
      <EmptyState
        icon="trending-up-outline"
        title="No expected return"
        body="Finish POs into lots and expected melt return will show here."
      />
    );
  }

  if (isMobile) {
    return (
      <ScrollView style={styles.mobileScroll} contentContainerStyle={styles.mobileScrollContent}>
        <HomeHero
          label="Expected Return"
          value={String(summary.expected)}
          stats={[
            { label: 'Evaluated', value: String(summary.evaluated) },
            { label: 'Percent', value: summary.expected ? `${summary.percent}%` : '—' },
            { label: summary.lots === 1 ? 'Lot' : 'Lots', value: String(summary.lots) },
          ]}
        />
        <HomeSection title="Lots" meta={String(lots.length)}>
          {lots.map((lot, index) => {
            const progress = lotProgressOf(lot);
            return (
              <HomeRow
                key={lot.id}
                title={lot.id}
                meta={[lot.location, lotPeriodLabel(lot)].filter(Boolean).join(' · ')}
                value={progress.expected ? `${progress.evaluated}/${progress.expected}` : String(lot.pos.length)}
                icon="folder"
                iconColor="#1F8A4E"
                last={index === lots.length - 1}
                chevron={false}
              />
            );
          })}
        </HomeSection>
      </ScrollView>
    );
  }

  return (
    <View style={styles.page}>
      <View style={styles.pageIntro}>
        <Text style={styles.pageSub}>
          {summary.evaluated} of {summary.expected} expected
          {summary.expected ? ` · ${summary.percent}% evaluated` : ''}
          {` · ${summary.lots} ${summary.lots === 1 ? 'lot' : 'lots'}`}
        </Text>
      </View>
      <Group>
        {lots.map((lot, index) => {
          const progress = lotProgressOf(lot);
          return (
            <View key={lot.id} style={[styles.lotRow, index === lots.length - 1 && styles.lotRowLast]}>
              <View style={styles.lotCopy}>
                <Text style={styles.lotTitle}>{lot.id}</Text>
                <Text style={styles.lotMeta}>{[lot.location, lotPeriodLabel(lot)].filter(Boolean).join(' · ')}</Text>
              </View>
              <View style={styles.lotRight}>
                <Text style={styles.lotCount}>
                  {progress.expected ? `${progress.evaluated}/${progress.expected}` : `${lot.pos.length}`}
                </Text>
                {progress.expected ? (
                  <ProgressBar
                    value={progress.evaluated}
                    total={progress.expected}
                    tone={progress.done ? 'green' : 'blue'}
                    height={4}
                    style={styles.lotBar}
                  />
                ) : null}
              </View>
            </View>
          );
        })}
      </Group>
    </View>
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
}) {
  const { triage, planned = [] } = useTransferWorkflow();
  const isMobile = useIsMobile();
  const [openRow, setOpenRow] = useState(null);

  const evaluated = useMemo(() => collectAccuracyTriagePos(triage), [triage]);
  const allRows = useMemo(() => collectAllTriagePos(triage), [triage]);
  const lots = useMemo(() => groupPosIntoLots(evaluated, allRows), [allRows, evaluated]);
  const errors = useMemo(() => summarizeErrors(evaluated), [evaluated]);
  const lotSummary = useMemo(() => summarizeLots(lots), [lots]);
  const transferSummary = useMemo(() => summarizeTransfers(planned), [planned]);

  const openPage = useCallback((key) => onPageChange?.(key || ''), [onPageChange]);
  const closePage = useCallback(() => onPageChange?.(''), [onPageChange]);

  useEffect(() => {
    if (!active) return undefined;
    if (!page) {
      onBackChange?.(null, null);
      return () => onBackChange?.(null, null);
    }
    const titles = {
      errors: 'Errors',
      shipments: 'Transfers',
      allocation: 'Allocation',
      return: 'Expected Return',
    };
    onBackChange?.(closePage, { dateLabel: titles[page] || 'Dashboard' });
    return () => onBackChange?.(null, null);
  }, [active, closePage, onBackChange, page]);

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
          body="Log in to see errors, allocation, and expected return."
          action={<TextAction label="Go to Profile" strong onPress={onRequireLogin} />}
        />
      </View>
    );
  }

  const home = isMobile ? (
    <ScrollView
      style={styles.mobileScroll}
      contentContainerStyle={styles.mobileScrollContent}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <HomeHero
        label="Triage"
        value={errors.amount ? formatAmount(errors.amount) : String(errors.count)}
        stats={[
          { label: errors.count === 1 ? 'Error' : 'Errors', value: String(errors.count) },
          { label: transferSummary.count === 1 ? 'Transfer' : 'Transfers', value: String(transferSummary.count) },
          { label: 'Expected', value: String(lotSummary.expected) },
        ]}
      />
      <HomeSection title="Overview" meta="4">
        <HomeRow
          title="Errors"
          meta={
            errors.count
              ? [errors.topType?.label, errors.stores ? `${errors.stores} stores` : null].filter(Boolean).join(' · ')
              : 'No flagged POs yet'
          }
          value={String(errors.count)}
          icon="alert-circle"
          iconColor="#C2410C"
          onPress={() => openPage('errors')}
        />
        <HomeRow
          title="Transfers"
          meta={
            transferSummary.count
              ? `${transferSummary.open} open · ${transferSummary.received} received`
              : 'No transfers yet'
          }
          value={String(transferSummary.count)}
          icon="swap-horizontal"
          iconColor="#1F7A9A"
          onPress={() => openPage('shipments')}
        />
        <HomeRow
          title="Allocation"
          meta={lots.length ? `${lots.length} ${lots.length === 1 ? 'lot' : 'lots'} · none allocated` : 'Nothing to allocate yet'}
          value={String(lots.length)}
          icon="git-branch"
          iconColor="#3A3A3C"
          onPress={() => openPage('allocation')}
        />
        <HomeRow
          title="Expected Return"
          meta={
            lotSummary.expected
              ? `${lotSummary.evaluated} evaluated · ${lotSummary.percent}%`
              : 'No expected melt yet'
          }
          value={String(lotSummary.expected)}
          icon="trending-up"
          iconColor="#1F8A4E"
          last
          onPress={() => openPage('return')}
        />
      </HomeSection>
    </ScrollView>
  ) : (
    <ScrollView
      style={styles.home}
      contentContainerStyle={styles.homeContent}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.grid}>
        <DashCard
          title="Errors"
          icon="alert-circle-outline"
          value={errors.count ? String(errors.count) : '0'}
          tone={errors.count ? 'red' : undefined}
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
          onPress={() => openPage('errors')}
        />
        <DashCard
          title="Transfers"
          icon="swap-horizontal-outline"
          value={String(transferSummary.count)}
          meta={
            transferSummary.count
              ? `${transferSummary.open} open · ${transferSummary.partial} partial · ${transferSummary.received} received`
              : 'No transfers yet'
          }
          onPress={() => openPage('shipments')}
        />
        <DashCard
          title="Allocation"
          icon="git-branch-outline"
          value={lots.length ? String(lots.length) : '0'}
          meta={
            lots.length
              ? `${lots.length} ${lots.length === 1 ? 'lot' : 'lots'} · none allocated`
              : 'Nothing to allocate yet'
          }
          onPress={() => openPage('allocation')}
        />
        <DashCard
          title="Expected Return"
          icon="trending-up-outline"
          value={lotSummary.expected ? String(lotSummary.expected) : '0'}
          meta={
            lotSummary.expected
              ? `${lotSummary.evaluated} evaluated · ${lotSummary.percent}% · ${lotSummary.lots} ${lotSummary.lots === 1 ? 'lot' : 'lots'}`
              : 'No expected melt yet'
          }
          onPress={() => openPage('return')}
        />
      </View>
    </ScrollView>
  );

  return (
    <View style={[styles.body, isMobile && styles.bodyMobile]}>
      {page === 'errors' ? (
        <ErrorsPage rows={errors.rows} query={listQuery} onOpen={setOpenRow} isMobile={isMobile} />
      ) : page === 'shipments' ? (
        <TransfersPage summary={transferSummary} isMobile={isMobile} />
      ) : page === 'allocation' ? (
        <AllocationPage lots={lots} isMobile={isMobile} />
      ) : page === 'return' ? (
        <ExpectedReturnPage lots={lots} summary={lotSummary} isMobile={isMobile} />
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
  home: {
    flex: 1,
    minHeight: 0,
  },
  homeContent: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 40,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'stretch',
    gap: 12,
  },
  card: {
    flexGrow: 1,
    flexBasis: '47%',
    minWidth: 240,
    minHeight: 168,
    padding: 16,
    borderRadius: 8,
    backgroundColor: '#fff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: T.hairline,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  cardPressed: {
    backgroundColor: '#f5f5f5',
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  cardIcon: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f5f5f5',
  },
  cardKicker: {
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
    color: T.secondary,
    textTransform: 'uppercase',
    letterSpacing: 0.2,
  },
  cardValue: {
    fontFamily,
    fontSize: 32,
    fontWeight: '600',
    color: T.text,
    letterSpacing: -0.8,
    marginTop: 4,
    fontVariant: ['tabular-nums'],
  },
  cardValueRed: {
    color: T.red,
  },
  cardMeta: {
    fontFamily,
    fontSize: 13,
    lineHeight: 18,
    color: T.secondary,
    marginTop: 6,
  },
  mobileScroll: {
    flex: 1,
    minHeight: 0,
    backgroundColor: CANVAS,
  },
  mobileScrollContent: {
    paddingBottom: 104,
    backgroundColor: CANVAS,
  },
  hero: {
    alignSelf: 'stretch',
    paddingTop: 16,
    paddingBottom: 14,
    paddingHorizontal: 16,
    marginBottom: 20,
    backgroundColor: CANVAS,
  },
  heroLabel: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: '#8e8e93',
    letterSpacing: -0.08,
  },
  heroAmount: {
    fontFamily,
    fontSize: 40,
    lineHeight: 46,
    fontWeight: '400',
    color: '#1a1a1a',
    letterSpacing: -1.2,
    marginTop: 2,
    fontVariant: ['tabular-nums'],
  },
  heroStats: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(60,60,67,0.18)',
  },
  heroStatWrap: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
  },
  heroStat: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  heroStatDivider: {
    width: StyleSheet.hairlineWidth,
    height: 28,
    marginRight: 12,
    backgroundColor: 'rgba(60,60,67,0.18)',
  },
  heroStatValue: {
    fontFamily,
    fontSize: 17,
    fontWeight: '600',
    color: '#1a1a1a',
    letterSpacing: -0.3,
    fontVariant: ['tabular-nums'],
  },
  heroStatLabel: {
    fontFamily,
    fontSize: 12,
    color: '#8e8e93',
    letterSpacing: -0.05,
  },
  section: {
    marginTop: 0,
  },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  sectionTitle: {
    fontFamily,
    fontSize: 13,
    fontWeight: '400',
    color: '#8e8e93',
    letterSpacing: -0.08,
    textTransform: 'uppercase',
  },
  sectionMeta: {
    fontFamily,
    fontSize: 13,
    color: '#8e8e93',
    letterSpacing: -0.08,
    fontVariant: ['tabular-nums'],
  },
  list: {
    backgroundColor: '#fff',
    width: '100%',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 68,
    paddingLeft: 16,
    backgroundColor: '#fff',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  rowPressed: {
    backgroundColor: '#f5f5f5',
  },
  rowIcon: {
    width: 46,
    height: 46,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  rowBody: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingRight: 16,
    alignSelf: 'stretch',
  },
  rowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(60,60,67,0.18)',
  },
  rowCopy: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  rowTitle: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  rowMeta: {
    fontFamily,
    fontSize: 13,
    color: '#8e8e93',
  },
  rowValue: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: '#1a1a1a',
    fontVariant: ['tabular-nums'],
    flexShrink: 0,
  },
  rowChevron: {
    flexShrink: 0,
    marginLeft: -2,
    width: 18,
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
  page: {
    flex: 1,
    minHeight: 0,
    paddingHorizontal: 20,
    paddingTop: 4,
  },
  pageIntro: {
    gap: 2,
    marginBottom: 16,
  },
  pageSub: {
    fontFamily,
    fontSize: 14,
    color: T.secondary,
  },
  breakBlock: {
    marginBottom: 16,
    gap: 8,
  },
  breakRow: {
    paddingHorizontal: 16,
    paddingVertical: 10,
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
    flex: 1,
    fontFamily,
    fontSize: 14,
    fontWeight: '600',
    color: T.text,
  },
  breakCount: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: T.secondary,
    fontVariant: ['tabular-nums'],
  },
  tableMeta: {
    fontFamily,
    fontSize: 13,
    color: T.secondary,
  },
  headText: {
    fontFamily,
    fontSize: 11,
    fontWeight: '600',
    color: T.secondary,
    letterSpacing: 0.2,
    textTransform: 'uppercase',
  },
  lotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: T.hairline,
  },
  lotRowLast: {
    borderBottomWidth: 0,
  },
  lotCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  lotTitle: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: T.text,
  },
  lotMeta: {
    fontFamily,
    fontSize: 13,
    color: T.secondary,
  },
  lotRight: {
    width: 88,
    alignItems: 'flex-end',
    gap: 6,
  },
  lotCount: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: T.text,
    fontVariant: ['tabular-nums'],
  },
  lotBar: {
    alignSelf: 'stretch',
  },
});
