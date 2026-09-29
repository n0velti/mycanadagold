import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Image,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppAccess } from '../lib/permissions';
import { CANVAS, MOBILE_BREAKPOINT, mobileSafeBottom, useIsMobile } from '../lib/mobileUi';
import { useHeldValue, useRightDrawerAnimation } from './TriageKit';
import {
  buildBonusBoard,
  canViewAllBonusCounts,
  canonicalBonusStoreName,
  currentBonusMonth,
  formatMoney,
  monthRange,
  NEGATIVE_COLUMNS,
  PHOTO_BONUS,
  restrictBonusBoardToViewer,
} from '../lib/bonuses';
import { reviewMonthRange, reviewPeriodLabel } from '../lib/googleReviews';
import { formatDateParam, fetchTransactionsAcrossPos, parseDateParam } from '../lib/transactions';
import { FONT, FONT_LIGHT } from '../lib/typography';
import HomeDatePicker from './HomeDatePicker';

const ACCENT = '#A16207';
const ACCENT_SOFT = '#FEF9C3';
const TAB_BORDER = '#d0d0d0';
const RATE_EMPTY = '#c7c7cc';

const STORE_ACCENTS = {
  Laval: '#0F766E',
  Montreal: '#1D4ED8',
  Quebec: '#B45309',
  Hamilton: '#2F6FED',
  Mississauga: '#C47A12',
  Toronto: '#2F8A4E',
  'Richmond Hill': '#6B4DE6',
};

const STORE_ACCENT_FALLBACKS = [
  '#1D4ED8',
  '#0F766E',
  '#B91C1C',
  '#B45309',
  '#6D28D9',
  '#047857',
];

function storeAccent(name) {
  if (STORE_ACCENTS[name]) return STORE_ACCENTS[name];
  const value = String(name || '');
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return STORE_ACCENT_FALLBACKS[hash % STORE_ACCENT_FALLBACKS.length];
}

function storeInitials(name) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return '?';
  return parts
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('');
}

function rateColor(rate, empty = false) {
  if (empty || rate == null || !Number.isFinite(Number(rate))) return RATE_EMPTY;
  return Number(rate) < 80 ? '#B91C1C' : '#15803D';
}

function starsLabel(rating) {
  const value = Math.max(0, Math.min(5, Number(rating) || 0));
  return `${'★'.repeat(value)}${'☆'.repeat(5 - value)}`;
}

function initialsFromName(name) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return '?';
  return parts
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('');
}

function formatWhen(review) {
  if (review?.relativeTime) return review.relativeTime;
  if (review?.date instanceof Date && !Number.isNaN(review.date.getTime())) {
    return review.date.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
  }
  return '';
}

function mergeBoard(current, store, range, matrix) {
  const stores = current?.stores ? [...current.stores] : [];
  const index = stores.findIndex((row) => row.storeName === store.storeName);
  if (index >= 0) stores[index] = store;
  else stores.push(store);
  return { range: current?.range || range, matrix: current?.matrix || matrix, stores };
}

function boardTotals(stores) {
  return (stores || []).reduce(
    (acc, store) => {
      acc.totalPayout += Number(store.totalPayout) || 0;
      acc.withEmail += Number(store.withEmail) || 0;
      acc.customerCount += Number(store.customerCount) || 0;
      acc.eligibleCount += Number(store.eligibleCount) || 0;
      acc.negativeCount += Number(store.negativeCount) || 0;
      acc.reviewCount += Number(store.reviewCount) || 0;
      acc.fiveStarCount += Number(store.fiveStarCount) || 0;
      return acc;
    },
    {
      totalPayout: 0,
      withEmail: 0,
      customerCount: 0,
      eligibleCount: 0,
      negativeCount: 0,
      reviewCount: 0,
      fiveStarCount: 0,
    },
  );
}

function StoreIcon({ name, size = 46 }) {
  const accent = storeAccent(name);
  const radius = size >= 40 ? 13 : 7;
  return (
    <View
      style={[
        styles.storeIcon,
        {
          width: size,
          height: size,
          borderRadius: radius,
          backgroundColor: accent,
        },
      ]}
    >
      <Text style={[styles.storeIconText, size < 40 && styles.storeIconTextSmall]}>
        {storeInitials(name)}
      </Text>
    </View>
  );
}

function Avatar({ uri, name }) {
  const [failed, setFailed] = useState(false);
  const showImage = Boolean(uri) && !failed;

  useEffect(() => {
    setFailed(false);
  }, [uri]);

  return (
    <View style={[styles.avatar, !showImage && styles.avatarFallback]}>
      {showImage ? (
        <Image source={{ uri }} style={styles.avatarImage} onError={() => setFailed(true)} />
      ) : (
        <Text style={styles.avatarInitials}>{initialsFromName(name)}</Text>
      )}
    </View>
  );
}

function RatingBreakdown({ breakdown, total }) {
  const max = Math.max(1, ...[5, 4, 3, 2, 1].map((star) => breakdown?.[star] || 0));
  return (
    <View style={styles.ratingBreakdown}>
      {[5, 4, 3, 2, 1].map((star) => {
        const count = breakdown?.[star] || 0;
        const widthPct = total > 0 ? (count / max) * 100 : 0;
        return (
          <View key={star} style={styles.ratingRow}>
            <Text style={styles.ratingStarLabel}>{star}★</Text>
            <View style={styles.ratingBarTrack}>
              <View
                style={[
                  styles.ratingBarFill,
                  star <= 2 ? styles.ratingBarNeg : styles.ratingBarPos,
                  { width: `${widthPct}%` },
                ]}
              />
            </View>
            <Text style={styles.ratingCount}>{count}</Text>
          </View>
        );
      })}
    </View>
  );
}

function StoreSelectCard({ store, selected, onPress, compact }) {
  const emailEmpty = !store.customerCount;
  const reviewsLoading = Boolean(store.reviewsLoading);
  return (
    <Pressable
      onPress={onPress}
      style={({ hovered, pressed }) => [
        styles.storeSelectCard,
        compact && styles.storeSelectCardMobile,
        selected && styles.storeSelectCardSelected,
        (hovered || pressed) && styles.storeSelectCardPressed,
      ]}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${store.storeName}, ${formatMoney(store.totalPayout)}`}
    >
      <View style={styles.storeSelectTop}>
        <StoreIcon name={store.storeName} size={44} />
        <View style={styles.storeSelectIdentity}>
          <Text style={styles.storeSelectName} numberOfLines={1}>
            {store.storeName}
          </Text>
          <Text style={styles.storeSelectMeta} numberOfLines={1}>
            {reviewsLoading
              ? 'Loading reviews…'
              : store.googleConfigured
                ? `${store.reviewCount} review${store.reviewCount === 1 ? '' : 's'}`
                : 'No Google link'}
          </Text>
        </View>
        {selected ? (
          <View style={styles.storeSelectCheck}>
            <Ionicons name="checkmark" size={14} color="#fff" />
          </View>
        ) : null}
      </View>

      <Text style={styles.storeSelectAmount}>{formatMoney(store.totalPayout)}</Text>
      <Text style={styles.storeSelectPerReview}>
        {formatMoney(store.perReviewBonus)} per eligible 5★
      </Text>

      <View style={styles.storeSelectMetrics}>
        <View style={styles.storeSelectMetric}>
          <Text
            style={[
              styles.storeSelectMetricValue,
              { color: rateColor(store.emailRate, emailEmpty) },
            ]}
          >
            {emailEmpty ? '—' : store.emailRateLabel}
          </Text>
          <Text style={styles.storeSelectMetricLabel}>Email</Text>
        </View>
        <View style={styles.storeSelectMetric}>
          <Text style={styles.storeSelectMetricValue}>
            {reviewsLoading && !store.reviewCount ? '…' : store.eligibleCount}
          </Text>
          <Text style={styles.storeSelectMetricLabel}>Eligible</Text>
        </View>
        <View style={styles.storeSelectMetric}>
          <Text
            style={[
              styles.storeSelectMetricValue,
              store.negativeCount > 1 && styles.rateLow,
            ]}
          >
            {reviewsLoading && !store.reviewCount ? '…' : store.negativeCount}
          </Text>
          <Text style={styles.storeSelectMetricLabel}>Negatives</Text>
        </View>
      </View>
    </Pressable>
  );
}

function StoreCardGrid({ stores, selectedStore, onOpenStore, totals, compact }) {
  const emailEmpty = !totals?.customerCount;
  const emailRate = totals?.customerCount > 0 ? (totals.withEmail / totals.customerCount) * 100 : 0;
  return (
    <View style={[styles.storeCardGrid, compact && styles.storeCardGridMobile]}>
      {stores.map((store) => (
        <StoreSelectCard
          key={store.storeName}
          store={store}
          selected={selectedStore === store.storeName}
          onPress={() => onOpenStore(store)}
          compact={compact}
        />
      ))}
      {totals ? (
        <View
          style={[
            styles.storeSelectCard,
            compact && styles.storeSelectCardMobile,
            styles.storeSelectTotalCard,
          ]}
        >
          <Text style={styles.storeSelectMeta}>All stores</Text>
          <Text style={styles.storeSelectAmount}>{formatMoney(totals.totalPayout)}</Text>
          <Text style={styles.storeSelectPerReview}>
            {totals.reviewCount} review{totals.reviewCount === 1 ? '' : 's'}
          </Text>
          <View style={styles.storeSelectMetrics}>
            <View style={styles.storeSelectMetric}>
              <Text
                style={[
                  styles.storeSelectMetricValue,
                  { color: rateColor(emailRate, emailEmpty) },
                ]}
              >
                {emailEmpty ? '—' : `${emailRate.toFixed(1)}%`}
              </Text>
              <Text style={styles.storeSelectMetricLabel}>Email</Text>
            </View>
            <View style={styles.storeSelectMetric}>
              <Text style={styles.storeSelectMetricValue}>{totals.eligibleCount}</Text>
              <Text style={styles.storeSelectMetricLabel}>Eligible</Text>
            </View>
            <View style={styles.storeSelectMetric}>
              <Text
                style={[
                  styles.storeSelectMetricValue,
                  totals.negativeCount > 1 && styles.rateLow,
                ]}
              >
                {totals.negativeCount}
              </Text>
              <Text style={styles.storeSelectMetricLabel}>Negatives</Text>
            </View>
          </View>
        </View>
      ) : null}
    </View>
  );
}

function PayoutMatrix({ matrix, activeTierId, activeColumnId }) {
  return (
    <View style={styles.matrixWrap}>
      <Text style={styles.sectionTitle}>Payout grid</Text>
      <Text style={styles.sectionHint}>
        Email collection sets the base. Live 1–2★ reviews adjust it for the period.
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View>
          <View style={styles.matrixRow}>
            <Text style={[styles.matrixCorner, styles.matrixHead]}>Email</Text>
            {NEGATIVE_COLUMNS.map((column) => (
              <Text
                key={column.id}
                style={[
                  styles.matrixHead,
                  styles.matrixCell,
                  activeColumnId === column.id && styles.matrixHeadActive,
                ]}
              >
                {column.label}
              </Text>
            ))}
          </View>
          {matrix.map((row) => (
            <View key={row.tier.id} style={styles.matrixRow}>
              <Text
                style={[
                  styles.matrixCorner,
                  styles.matrixLabel,
                  activeTierId === row.tier.id && styles.matrixLabelActive,
                ]}
              >
                {row.tier.label}
              </Text>
              {row.cells.map((cell) => {
                const active =
                  activeTierId === row.tier.id && activeColumnId === cell.column.id;
                return (
                  <View
                    key={cell.column.id}
                    style={[styles.matrixCell, active && styles.matrixCellActive]}
                  >
                    <Text style={[styles.matrixValue, active && styles.matrixValueActive]}>
                      {formatMoney(cell.amount)}
                    </Text>
                  </View>
                );
              })}
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

function EmployeeList({ employees, selfOnly, onOpenEmployee }) {
  if (!employees.length) {
    return (
      <View style={styles.emptyBlock}>
        <Text style={styles.emptyText}>
          {selfOnly
            ? 'No eligible reviews for you in this period yet.'
            : 'No eligible employee payouts for this period yet.'}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.employeeList}>
      {employees.map((row, index) => (
        <Pressable
          key={row.employeeName}
          onPress={() => onOpenEmployee?.(row)}
          style={({ hovered, pressed }) => [
            styles.employeeRow,
            index === employees.length - 1 && styles.employeeRowLast,
            (hovered || pressed) && styles.employeeRowPressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel={`${row.employeeName}, ${formatMoney(row.total)}`}
        >
          <View style={[styles.employeeAvatar, { backgroundColor: storeAccent(row.employeeName) }]}>
            <Text style={styles.employeeAvatarText}>{initialsFromName(row.employeeName)}</Text>
          </View>
          <View style={styles.employeeCopy}>
            <Text style={styles.employeeName} numberOfLines={1}>
              {row.employeeName}
            </Text>
            <Text style={styles.employeeMeta} numberOfLines={1}>
              {row.eligibleCount} review{row.eligibleCount === 1 ? '' : 's'}
              {row.photoCount > 0 ? ` · ${row.photoCount} photo` : ''}
            </Text>
          </View>
          <View style={styles.employeeTrailing}>
            <Text style={styles.employeeTotal}>{formatMoney(row.total)}</Text>
            <Text style={styles.employeeBreakdown}>
              {formatMoney(row.reviewBonus)}
              {row.photoBonus > 0 ? ` + ${formatMoney(row.photoBonus)}` : ''}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color="#c7c7cc" />
        </Pressable>
      ))}
    </View>
  );
}

function shareLabel(share) {
  const value = Number(share);
  if (!Number.isFinite(value) || value >= 0.999) return '';
  if (Math.abs(value - 0.5) < 0.01) return 'Split 50%';
  return `Split ${Math.round(value * 100)}%`;
}

function ReviewCard({ review, showCount = false }) {
  const counted = showCount && review.eligible;
  const split = shareLabel(review.share);
  return (
    <View
      style={[
        styles.reviewRow,
        review.eligible && styles.reviewRowEligible,
        review.rating <= 2 && styles.reviewRowNegative,
        showCount && !review.eligible && styles.reviewRowSkipped,
      ]}
    >
      <View style={styles.reviewTop}>
        <Avatar uri={review.avatarUrl} name={review.author} />
        <View style={styles.reviewIdentity}>
          <Text style={styles.reviewAuthor} numberOfLines={1}>
            {review.author || 'Anonymous'}
          </Text>
          <Text style={styles.reviewStars}>{starsLabel(review.rating)}</Text>
        </View>
        <Text style={styles.reviewWhen}>{formatWhen(review)}</Text>
      </View>
      <Text style={styles.reviewText}>
        {review.text || '(No comment — 5★ still eligible)'}
      </Text>
      <View style={styles.reviewFlags}>
        {review.eligible ? (
          <Text style={styles.flagGood}>Eligible</Text>
        ) : (
          <Text style={styles.flagBad}>{review.ineligibleReason || 'Ineligible'}</Text>
        )}
        {review.hasPhotos ? (
          <Text style={styles.flagPhoto}>
            +{formatMoney(PHOTO_BONUS)} photo
            {review.photoCount > 1 ? ` · ${review.photoCount}` : ''}
          </Text>
        ) : null}
        {review.attributionSource === 'named' && review.namedEmployees?.length ? (
          <Text style={styles.flagNames}>Named: {review.namedEmployees.join(', ')}</Text>
        ) : null}
        {review.attributionSource === 'transaction' && review.transactionMatch ? (
          <Text style={styles.flagMatched}>
            Matched via txn → {review.attributedEmployees.join(', ')}
          </Text>
        ) : null}
        {review.attributionSource === 'unassigned' ? (
          <Text style={styles.flagNames}>Unassigned</Text>
        ) : null}
      </View>
      {review.attributionSource === 'transaction' && review.transactionMatch ? (
        <Text style={styles.matchDetail}>
          Reviewer “{review.author}” matched customer {review.transactionMatch.customerName}
          {review.transactionMatch.reference ? ` · ${review.transactionMatch.reference}` : ''}
          {review.transactionMatch.dateLabel ? ` · ${review.transactionMatch.dateLabel}` : ''}.
        </Text>
      ) : null}
      {review.ownerReply ? (
        <View style={styles.ownerReply}>
          <Text style={styles.ownerReplyLabel}>Owner reply</Text>
          <Text style={styles.ownerReplyText}>{review.ownerReply}</Text>
        </View>
      ) : null}
      {counted ? (
        <View style={styles.countBox}>
          <Text style={styles.countBoxTotal}>Counted {formatMoney(review.payout)}</Text>
          <Text style={styles.countBoxMeta}>
            {formatMoney(review.reviewShare)} review
            {review.photoShare > 0 ? ` + ${formatMoney(review.photoShare)} photo` : ''}
            {split ? ` · ${split}` : ''}
          </Text>
        </View>
      ) : null}
      {showCount && !review.eligible ? (
        <View style={styles.skipBox}>
          <Text style={styles.skipBoxText}>
            Not counted · {review.ineligibleReason || 'Ineligible'}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function reviewsNamedForEmployee(reviews, employeeName) {
  const key = String(employeeName || '').trim();
  if (!key) return [];
  return (reviews || []).filter((review) => {
    const names = [
      ...(review.attributedEmployees || []),
      ...(review.namedEmployees || []),
    ];
    return names.some(
      (name) => name.localeCompare(key, undefined, { sensitivity: 'base' }) === 0,
    );
  });
}

function EmployeeBonusDrawer({ visible, employee, store, onClose }) {
  const { width: windowWidth } = useWindowDimensions();
  const isMobile = windowWidth < MOBILE_BREAKPOINT;
  const panelWidth = isMobile
    ? Math.max(windowWidth, 240)
    : Math.min(Math.max(Math.round(windowWidth * 0.46), 400), 560);
  const { mounted, slide, backdrop } = useRightDrawerAnimation(visible, panelWidth);
  const heldEmployee = useHeldValue(employee);
  const heldStore = useHeldValue(store);

  if (!mounted || !heldEmployee) return null;

  const counted = heldEmployee.reviews || [];
  const countedIds = new Set(counted.map((review) => review.id));
  const named = reviewsNamedForEmployee(heldStore?.reviews, heldEmployee.employeeName);
  const notCounted = named.filter((review) => !countedIds.has(review.id));
  const splitCount = counted.filter((review) => Number(review.share) < 0.999).length;

  return (
    <Modal visible={mounted} transparent animationType="none" onRequestClose={onClose}>
      <View style={styles.drawerRoot}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close">
          <Animated.View style={[styles.drawerBackdrop, { opacity: backdrop }]} />
        </Pressable>
        <Animated.View
          style={[
            styles.drawerPanel,
            isMobile && styles.drawerPanelMobile,
            { width: panelWidth, transform: [{ translateX: slide }] },
          ]}
        >
          <View
            style={[styles.drawerTopBar, isMobile && styles.drawerTopBarMobile]}
            {...(Platform.OS === 'web' && isMobile ? { className: 'cgold-mobile-sheet-top' } : null)}
          >
            <Text style={styles.drawerTitle} numberOfLines={1}>
              {heldEmployee.employeeName}
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
              <Text style={styles.drawerHeroLabel}>
                {heldStore?.storeName || 'Bonus'}
              </Text>
              <Text style={styles.drawerHeroAmount}>{formatMoney(heldEmployee.total)}</Text>
              <View style={styles.drawerHeroStats}>
                <View style={styles.drawerHeroStat}>
                  <Text style={styles.drawerHeroStatValue}>{heldEmployee.eligibleCount}</Text>
                  <Text style={styles.drawerHeroStatLabel}>Counted</Text>
                </View>
                <View style={styles.drawerHeroStatDivider} />
                <View style={styles.drawerHeroStat}>
                  <Text style={styles.drawerHeroStatValue}>
                    {formatMoney(heldStore?.perReviewBonus || 0)}
                  </Text>
                  <Text style={styles.drawerHeroStatLabel}>Per review</Text>
                </View>
                <View style={styles.drawerHeroStatDivider} />
                <View style={styles.drawerHeroStat}>
                  <Text style={styles.drawerHeroStatValue}>
                    {heldEmployee.photoCount > 0 ? heldEmployee.photoCount : '—'}
                  </Text>
                  <Text style={styles.drawerHeroStatLabel}>Photos</Text>
                </View>
              </View>
              <Text style={styles.drawerHeroMeta}>
                {formatMoney(heldEmployee.reviewBonus)} reviews
                {heldEmployee.photoBonus > 0
                  ? ` + ${formatMoney(heldEmployee.photoBonus)} photos`
                  : ''}
                {splitCount
                  ? ` · ${splitCount} shared with another teammate`
                  : ''}
              </Text>
            </View>

            <Text style={styles.drawerSectionTitle}>Counted toward bonus</Text>
            <Text style={styles.drawerSectionHint}>
              Eligible 5★ reviews attributed to {heldEmployee.employeeName}
              {heldStore?.storeName ? ` at ${heldStore.storeName}` : ''}.
            </Text>
            {counted.length ? (
              <View style={styles.reviewList}>
                {counted.map((review) => (
                  <ReviewCard key={review.id} review={review} showCount />
                ))}
              </View>
            ) : (
              <View style={styles.emptyBlock}>
                <Text style={styles.emptyText}>No reviews were counted for this person.</Text>
              </View>
            )}

            {notCounted.length ? (
              <>
                <Text style={[styles.drawerSectionTitle, styles.drawerSectionSpaced]}>
                  Mentioned, not counted
                </Text>
                <Text style={styles.drawerSectionHint}>
                  These reviews name them but did not add to the payout.
                </Text>
                <View style={styles.reviewList}>
                  {notCounted.map((review) => (
                    <ReviewCard key={review.id} review={review} showCount />
                  ))}
                </View>
              </>
            ) : null}
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

export default function BonusesScreen({
  session,
  onRequireLogin,
  onOpenEmails,
  storeFilter,
  embedded = false,
  title = 'Bonuses',
}) {
  const isMobile = useIsMobile();
  const { canFilter } = useAppAccess();
  const allowFilters = canFilter('bonuses');
  const viewAllCounts = canViewAllBonusCounts(session?.profile);
  const initial = useMemo(() => currentBonusMonth(), []);
  const [startDate, setStartDate] = useState(initial.startDate);
  const [endDate, setEndDate] = useState(initial.endDate);
  const [dateMode, setDateMode] = useState('range');
  const [board, setBoard] = useState(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [selectedStore, setSelectedStore] = useState(() =>
    storeFilter ? canonicalBonusStoreName(storeFilter) : null,
  );
  const [selectedEmployeeName, setSelectedEmployeeName] = useState(null);
  const requestId = useRef(0);
  const displayBoard = useMemo(
    () => (viewAllCounts ? board : restrictBonusBoardToViewer(board, session?.profile)),
    [board, session?.profile, viewAllCounts],
  );

  const periodLabel = reviewPeriodLabel(startDate, endDate, dateMode);
  const currentMonth = currentBonusMonth();
  const start = parseDateParam(startDate);
  const selectedMonth = reviewMonthRange(start.getFullYear(), start.getMonth());
  const nextMonthStart = formatDateParam(new Date(start.getFullYear(), start.getMonth() + 1, 1));
  const canGoForward = nextMonthStart <= currentMonth.startDate;
  const isCurrentMonth =
    startDate === currentMonth.startDate && endDate === currentMonth.endDate;
  const isFullMonth =
    startDate === selectedMonth.startDate && endDate === selectedMonth.endDate;

  const applyPeriod = (nextStart, nextEnd, mode) => {
    const startKey = formatDateParam(nextStart);
    const endKey = formatDateParam(nextEnd || nextStart);
    setStartDate(startKey);
    setEndDate(endKey);
    setDateMode(mode === 'day' || startKey === endKey ? 'day' : 'range');
  };

  const load = useCallback(
    async ({ silent = false } = {}) => {
      if (!session?.token) {
        setBoard(null);
        setError('');
        return;
      }

      const id = ++requestId.current;
      if (!silent) {
        setLoading(true);
        setError('');
      }

      try {
        const tx = await fetchTransactionsAcrossPos(session, {
          startDate,
          endDate,
        });
        if (id !== requestId.current) return;

        const cursor = parseDateParam(startDate);
        const next = await buildBonusBoard({
          transactionRows: tx.rows || [],
          year: cursor.getFullYear(),
          monthIndex: cursor.getMonth(),
          startDate,
          endDate,
          storeFilter: storeFilter || null,
          onStore: (store) => {
            if (id !== requestId.current) return;
            setBoard((current) =>
              mergeBoard(current, store, monthRange(cursor.getFullYear(), cursor.getMonth()), null),
            );
          },
        });
        if (id !== requestId.current) return;

        setBoard(next);
        setSelectedStore((current) => {
          if (storeFilter) return canonicalBonusStoreName(storeFilter);
          if (current && next.stores.some((store) => store.storeName === current)) {
            return current;
          }
          if (isMobile && !storeFilter) return current;
          const laval = next.stores.find((store) => store.storeName === 'Laval');
          return laval?.storeName || next.stores[0]?.storeName || null;
        });
      } catch (err) {
        if (id !== requestId.current) return;
        setBoard(null);
        setError(err?.message || 'Failed to load bonuses.');
      } finally {
        if (id === requestId.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [session, startDate, endDate, storeFilter, isMobile],
  );

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (storeFilter) {
      setSelectedStore(canonicalBonusStoreName(storeFilter));
      return;
    }
    if (!allowFilters && !isMobile) setSelectedStore(null);
  }, [allowFilters, storeFilter, isMobile]);

  const visibleStores = useMemo(() => {
    const stores = displayBoard?.stores || [];
    if (storeFilter) {
      const wanted = canonicalBonusStoreName(storeFilter);
      return stores.filter((store) => store.storeName === wanted);
    }
    return stores;
  }, [displayBoard, storeFilter]);

  const activeStore = useMemo(() => {
    if (!visibleStores.length) return null;
    if (isMobile && !selectedStore && !storeFilter) return null;
    return visibleStores.find((store) => store.storeName === selectedStore) || visibleStores[0];
  }, [visibleStores, selectedStore, isMobile, storeFilter]);

  const selectedPerson = useMemo(() => {
    if (!selectedEmployeeName) return null;
    for (const store of visibleStores) {
      const employee = (store.employees || []).find(
        (row) => row.employeeName === selectedEmployeeName,
      );
      if (employee) return { employee, store };
    }
    return { employee: { employeeName: selectedEmployeeName, reviews: [], total: 0, eligibleCount: 0, photoCount: 0, reviewBonus: 0, photoBonus: 0 }, store: activeStore };
  }, [selectedEmployeeName, visibleStores, activeStore]);

  const totals = useMemo(() => boardTotals(visibleStores), [visibleStores]);
  const emailRate = totals.customerCount > 0 ? (totals.withEmail / totals.customerCount) * 100 : 0;
  const emailRateLabel = totals.customerCount ? `${emailRate.toFixed(1)}%` : '—';
  const stillLoading = loading || visibleStores.some((store) => store.reviewsLoading);
  const showMobileDetail = Boolean(isMobile && activeStore && (selectedStore || storeFilter));

  const goMonth = (delta) => {
    const next = new Date(start.getFullYear(), start.getMonth() + delta, 1);
    if (formatDateParam(next) > currentMonth.startDate) return;
    const period = reviewMonthRange(next.getFullYear(), next.getMonth());
    applyPeriod(period.start, period.end, 'range');
  };

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load({ silent: true });
  }, [load]);

  const openStore = (store) => {
    setSelectedStore(store.storeName);
  };

  const closeStore = () => {
    if (storeFilter) return;
    setSelectedStore(null);
  };

  if (!session?.token) {
    return (
      <View style={styles.screen}>
        <View style={styles.loginWrap}>
          <Text style={styles.pageTitle}>{title}</Text>
          <Text style={styles.loginHint}>
            Sign in to load email capture and Google reviews for each store.
          </Text>
          {onRequireLogin ? (
            <Pressable style={styles.loginButton} onPress={onRequireLogin}>
              <Text style={styles.loginButtonText}>Log in</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    );
  }

  const datePicker = (
    <HomeDatePicker
      startDate={startDate}
      endDate={endDate}
      dateMode={dateMode}
      onChange={({ mode, start: nextStart, end: nextEnd }) =>
        applyPeriod(nextStart, nextEnd, mode)
      }
      maximumDate={new Date()}
      compact={!isMobile}
      fill={isMobile}
    />
  );

  const periodBar = (
    <View style={[styles.periodBar, isMobile && styles.periodBarMobile]}>
      <View style={styles.monthNav}>
        <Pressable
          style={styles.monthBtn}
          onPress={() => goMonth(-1)}
          hitSlop={8}
          accessibilityLabel="Previous month"
        >
          <Ionicons name="chevron-back" size={18} color="#1a1a1a" />
        </Pressable>
        <Pressable
          style={styles.monthLabelWrap}
          onPress={() => applyPeriod(selectedMonth.start, selectedMonth.end, 'range')}
          accessibilityLabel={selectedMonth.label}
        >
          <Text style={styles.monthLabel}>{selectedMonth.label}</Text>
          <Text style={styles.monthSub}>
            {isFullMonth ? (isCurrentMonth ? 'Current month' : 'Selected month') : periodLabel}
          </Text>
        </Pressable>
        <Pressable
          style={[styles.monthBtn, !canGoForward && styles.monthBtnDisabled]}
          onPress={() => goMonth(1)}
          disabled={!canGoForward}
          hitSlop={8}
          accessibilityLabel="Next month"
        >
          <Ionicons
            name="chevron-forward"
            size={18}
            color={canGoForward ? '#1a1a1a' : '#c4c4c4'}
          />
        </Pressable>
      </View>
      <View style={styles.periodPicker}>{datePicker}</View>
      {!isCurrentMonth ? (
        <Pressable
          style={styles.chip}
          onPress={() => applyPeriod(currentMonth.start, currentMonth.end, 'range')}
        >
          <Text style={styles.chipText}>This month</Text>
        </Pressable>
      ) : null}
    </View>
  );

  const hero = (
    <View style={styles.hero}>
      <Text style={styles.heroLabel}>
        {viewAllCounts ? periodLabel : `Your bonus · ${periodLabel}`}
      </Text>
      <Text style={styles.heroAmount} numberOfLines={1} adjustsFontSizeToFit>
        {formatMoney(totals.totalPayout)}
      </Text>
      <View style={styles.heroStats}>
        <View style={styles.heroStat}>
          <Text style={[styles.heroStatValue, { color: rateColor(emailRate, !totals.customerCount) }]}>
            {emailRateLabel}
          </Text>
          <Text style={styles.heroStatLabel}>Email</Text>
        </View>
        <View style={styles.heroStatDivider} />
        <View style={styles.heroStat}>
          <Text style={styles.heroStatValue}>{totals.eligibleCount}</Text>
          <Text style={styles.heroStatLabel}>Eligible</Text>
        </View>
        <View style={styles.heroStatDivider} />
        <View style={styles.heroStat}>
          <Text style={[styles.heroStatValue, totals.negativeCount > 1 && styles.rateLow]}>
            {totals.negativeCount}
          </Text>
          <Text style={styles.heroStatLabel}>Negatives</Text>
        </View>
      </View>
      {stillLoading ? <Text style={styles.heroMeta}>Updating reviews…</Text> : null}
    </View>
  );

  const storeHero = activeStore ? (
    <View style={[styles.hero, embedded && styles.heroEmbedded]}>
      {isMobile && !storeFilter ? (
        <Pressable onPress={closeStore} style={styles.backRow} hitSlop={8}>
          <Ionicons name="chevron-back" size={18} color="#1a1a1a" />
          <Text style={styles.backText}>Stores</Text>
        </Pressable>
      ) : null}
      <Text style={styles.heroLabel}>{activeStore.storeName}</Text>
      <Text style={styles.heroAmount} numberOfLines={1} adjustsFontSizeToFit>
        {formatMoney(activeStore.totalPayout)}
      </Text>
      <View style={styles.heroStats}>
        <View style={styles.heroStat}>
          <Text
            style={[
              styles.heroStatValue,
              { color: rateColor(activeStore.emailRate, !activeStore.customerCount) },
            ]}
          >
            {activeStore.emailRateLabel}
          </Text>
          <Text style={styles.heroStatLabel}>Email</Text>
        </View>
        <View style={styles.heroStatDivider} />
        <View style={styles.heroStat}>
          <Text style={styles.heroStatValue}>{activeStore.eligibleCount}</Text>
          <Text style={styles.heroStatLabel}>Eligible</Text>
        </View>
        <View style={styles.heroStatDivider} />
        <View style={styles.heroStat}>
          <Text style={styles.heroStatValue}>{formatMoney(activeStore.perReviewBonus)}</Text>
          <Text style={styles.heroStatLabel}>Per review</Text>
        </View>
      </View>
    </View>
  ) : null;

  const detail = activeStore ? (
    <View style={styles.detail}>
      {displayBoard?.matrix ? (
        <PayoutMatrix
          matrix={displayBoard.matrix}
          activeTierId={activeStore.payout?.tier?.id}
          activeColumnId={activeStore.payout?.column?.id}
        />
      ) : null}

      <Pressable
        style={styles.emailJump}
        onPress={() =>
          onOpenEmails?.({
            storeName: activeStore.storeName,
            startDate,
            endDate,
          })
        }
      >
        <Ionicons name="mail-outline" size={16} color={ACCENT} />
        <Text style={styles.emailJumpText}>
          {activeStore.withEmail}/{activeStore.customerCount} named emails · {activeStore.emailRateLabel}
        </Text>
        <Ionicons name="chevron-forward" size={16} color={ACCENT} />
      </Pressable>

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{viewAllCounts ? 'Employees' : 'Your payout'}</Text>
        <Text style={styles.sectionHint}>
          {formatMoney(activeStore.perReviewBonus)} / eligible 5★
          {activeStore.photoReviewCount
            ? ` · ${activeStore.photoReviewCount} photo × ${formatMoney(PHOTO_BONUS)}`
            : ''}
        </Text>
      </View>
      <EmployeeList
        employees={activeStore.employees}
        selfOnly={!viewAllCounts}
        onOpenEmployee={(row) => setSelectedEmployeeName(row.employeeName)}
      />

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{viewAllCounts ? 'Reviews' : 'Your reviews'}</Text>
        <Text style={styles.sectionHint}>
          {activeStore.reviews.length} in {periodLabel}
          {activeStore.reviewsLoading ? ' · loading…' : ''}
          {activeStore.ineligibleFiveStarCount
            ? ` · ${activeStore.ineligibleFiveStarCount} name-only 5★ excluded`
            : ''}
          {activeStore.transactionAttributedCount
            ? ` · ${activeStore.transactionAttributedCount} matched via txn`
            : ''}
        </Text>
      </View>
      <RatingBreakdown breakdown={activeStore.ratingBreakdown} total={activeStore.reviewCount} />
      {activeStore.reviewsError && !activeStore.reviews.length ? (
        <Text style={styles.storeError}>{activeStore.reviewsError}</Text>
      ) : null}
      <View style={styles.reviewList}>
        {activeStore.reviews.map((review) => (
          <ReviewCard key={review.id} review={review} />
        ))}
      </View>
      {!activeStore.reviews.length && !activeStore.reviewsLoading ? (
        <View style={styles.emptyBlock}>
          <Text style={styles.emptyText}>
            {viewAllCounts
              ? `No Google reviews in ${periodLabel}.`
              : `No reviews attributed to you in ${periodLabel}.`}
          </Text>
        </View>
      ) : null}
    </View>
  ) : null;

  const showStoreGrid = visibleStores.length && !embedded && (!isMobile || !showMobileDetail);
  const showDetail = embedded || !isMobile || showMobileDetail;

  return (
    <View style={[styles.screen, embedded && styles.screenEmbedded]}>
      {!isMobile && !embedded ? (
        <View style={styles.pageHeader}>
          <View style={styles.pageTitleWrap}>
            <View style={styles.pageTitleSpacer} />
            <Text style={styles.pageTitle}>{title}</Text>
          </View>
          <View style={styles.pageControls}>
            {stillLoading ? <ActivityIndicator size="small" color="#8e8e93" /> : null}
            <Pressable style={styles.refresh} onPress={() => load()} hitSlop={8} accessibilityLabel={`Refresh ${title.toLowerCase()}`}>
              <Ionicons name="refresh" size={16} color="#8e8e93" />
            </Pressable>
          </View>
        </View>
      ) : null}

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          isMobile && !embedded && styles.scrollContentMobile,
          embedded && styles.scrollContentEmbedded,
        ]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          isMobile ? (
            <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor="#8e8e93" />
          ) : undefined
        }
      >
        {embedded ? (
          <>
            {periodBar}
            {storeHero}
          </>
        ) : isMobile ? (
          showMobileDetail ? storeHero : hero
        ) : (
          periodBar
        )}

        {!embedded && isMobile && !showMobileDetail ? periodBar : null}

        {loading && !visibleStores.length ? (
          <View style={styles.loadingBlock}>
            <ActivityIndicator color="#1d1d1f" />
            <Text style={styles.loadingText}>Loading email rates and Google reviews…</Text>
          </View>
        ) : null}

        {showStoreGrid ? (
          <StoreCardGrid
            stores={visibleStores}
            selectedStore={activeStore?.storeName}
            onOpenStore={openStore}
            totals={totals}
            compact={isMobile}
          />
        ) : null}

        {showDetail ? detail : null}
      </ScrollView>
      <EmployeeBonusDrawer
        visible={Boolean(selectedEmployeeName)}
        employee={selectedPerson?.employee}
        store={selectedPerson?.store}
        onClose={() => setSelectedEmployeeName(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    minHeight: 0,
    backgroundColor: CANVAS,
  },
  screenEmbedded: {
    backgroundColor: 'transparent',
  },
  scrollContentEmbedded: {
    paddingBottom: 24,
  },
  heroEmbedded: {
    paddingTop: 8,
  },
  loginWrap: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
    gap: 12,
  },
  loginHint: {
    fontFamily: FONT,
    fontSize: 14,
    lineHeight: 20,
    color: '#5a5a5a',
  },
  loginButton: {
    alignSelf: 'flex-start',
    backgroundColor: '#1a1a1a',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  loginButtonText: {
    fontFamily: FONT,
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  pageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 12,
    paddingLeft: 8,
    paddingRight: 32,
    paddingTop: 24,
    paddingBottom: 16,
    flexShrink: 0,
  },
  pageTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
  },
  pageTitleSpacer: {
    width: 56,
    flexShrink: 0,
  },
  pageTitle: {
    fontFamily: FONT_LIGHT,
    fontSize: 28,
    fontWeight: '400',
    color: '#1a1a1a',
    letterSpacing: -0.5,
    marginLeft: 12,
  },
  pageControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginLeft: 'auto',
  },
  refresh: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorText: {
    fontFamily: FONT,
    fontSize: 13,
    color: '#B91C1C',
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 40,
  },
  scrollContentMobile: {
    paddingBottom: 104,
  },
  hero: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 14,
  },
  heroLabel: {
    fontFamily: FONT,
    fontSize: 13,
    fontWeight: '600',
    color: '#8e8e93',
    letterSpacing: -0.08,
  },
  heroAmount: {
    fontFamily: FONT_LIGHT,
    fontSize: 40,
    lineHeight: 46,
    fontWeight: '400',
    color: '#1a1a1a',
    letterSpacing: -1.2,
    fontVariant: ['tabular-nums'],
    marginTop: 2,
  },
  heroStats: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: TAB_BORDER,
  },
  heroStat: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  heroStatDivider: {
    width: StyleSheet.hairlineWidth,
    height: 28,
    marginHorizontal: 12,
    backgroundColor: TAB_BORDER,
  },
  heroStatValue: {
    fontFamily: FONT,
    fontSize: 17,
    fontWeight: '600',
    color: '#1a1a1a',
    letterSpacing: -0.3,
    fontVariant: ['tabular-nums'],
  },
  heroStatLabel: {
    fontFamily: FONT,
    fontSize: 12,
    color: '#8e8e93',
  },
  heroMeta: {
    fontFamily: FONT,
    fontSize: 13,
    color: '#8e8e93',
    marginTop: 10,
  },
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginBottom: 8,
    alignSelf: 'flex-start',
  },
  backText: {
    fontFamily: FONT,
    fontSize: 15,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  periodBar: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  periodBarMobile: {
    paddingTop: 4,
  },
  monthNav: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexGrow: 1,
    minWidth: 200,
  },
  monthBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f4f4f4',
  },
  monthBtnDisabled: {
    opacity: 0.5,
  },
  monthLabelWrap: {
    flex: 1,
    paddingHorizontal: 8,
  },
  monthLabel: {
    fontFamily: FONT,
    fontSize: 15,
    fontWeight: '700',
    color: '#1a1a1a',
  },
  monthSub: {
    fontFamily: FONT,
    fontSize: 11,
    color: '#8e8e93',
    marginTop: 1,
  },
  periodPicker: {
    minWidth: 168,
    maxWidth: 240,
    flexGrow: 1,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: '#f3f3f3',
  },
  chipText: {
    fontFamily: FONT,
    fontSize: 12,
    fontWeight: '600',
    color: '#4a4a4a',
  },
  loadingBlock: {
    paddingVertical: 36,
    alignItems: 'center',
    gap: 10,
  },
  loadingText: {
    fontFamily: FONT,
    fontSize: 13,
    color: '#8e8e93',
  },
  storeCardGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    paddingHorizontal: 16,
    width: '100%',
  },
  storeCardGridMobile: {
    gap: 10,
  },
  storeSelectCardMobile: {
    flexBasis: '100%',
    minWidth: '100%',
  },
  storeSelectCard: {
    flexGrow: 1,
    flexBasis: 260,
    minWidth: 240,
    maxWidth: '100%',
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#ececec',
    gap: 2,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  storeSelectCardSelected: {
    borderColor: ACCENT,
    backgroundColor: '#FFFEF7',
  },
  storeSelectCardPressed: {
    backgroundColor: '#f7f7f7',
  },
  storeSelectTotalCard: {
    backgroundColor: '#f5f5f5',
    borderColor: 'transparent',
    ...Platform.select({
      web: { cursor: 'default' },
      default: {},
    }),
  },
  storeSelectTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 10,
  },
  storeSelectIdentity: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  storeSelectName: {
    fontFamily: FONT,
    fontSize: 16,
    fontWeight: '700',
    color: '#1a1a1a',
  },
  storeSelectMeta: {
    fontFamily: FONT,
    fontSize: 13,
    color: '#8e8e93',
  },
  storeSelectCheck: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  storeSelectAmount: {
    fontFamily: FONT_LIGHT,
    fontSize: 32,
    lineHeight: 38,
    fontWeight: '400',
    color: '#1a1a1a',
    letterSpacing: -0.8,
    fontVariant: ['tabular-nums'],
  },
  storeSelectPerReview: {
    fontFamily: FONT,
    fontSize: 13,
    color: '#8e8e93',
    marginBottom: 12,
  },
  storeSelectMetrics: {
    flexDirection: 'row',
    gap: 8,
  },
  storeSelectMetric: {
    flex: 1,
    backgroundColor: '#f7f7f7',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 8,
    gap: 1,
  },
  storeSelectMetricValue: {
    fontFamily: FONT,
    fontSize: 15,
    fontWeight: '700',
    color: '#1a1a1a',
    fontVariant: ['tabular-nums'],
  },
  storeSelectMetricLabel: {
    fontFamily: FONT,
    fontSize: 11,
    color: '#8e8e93',
  },
  igStoreList: {
    backgroundColor: '#fff',
    width: '100%',
  },
  igStoreCard: {
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
  desktopTableScroll: {
    width: '100%',
  },
  desktopTableScrollContent: {
    flexGrow: 1,
  },
  desktopTable: {
    flexGrow: 1,
    minWidth: 760,
    width: '100%',
  },
  desktopTotalRow: {
    minHeight: 64,
    backgroundColor: '#f5f5f5',
    ...Platform.select({
      web: { cursor: 'default' },
      default: {},
    }),
  },
  desktopTotalRule: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: TAB_BORDER,
  },
  desktopStoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 64,
    paddingLeft: 8,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  desktopHeaderRow: {
    minHeight: 36,
    ...Platform.select({
      web: { cursor: 'default' },
      default: {},
    }),
  },
  desktopHeaderRule: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: TAB_BORDER,
  },
  desktopHeader: {
    fontFamily: FONT,
    fontSize: 13,
    fontWeight: '400',
    color: '#8e8e93',
    letterSpacing: -0.08,
    textTransform: 'uppercase',
  },
  desktopIconWrap: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  desktopIconSpacer: {
    width: 56,
    flexShrink: 0,
  },
  desktopStoreBody: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginLeft: 12,
    paddingRight: 16,
    alignSelf: 'stretch',
  },
  igStoreBody: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 14,
    paddingRight: 16,
    gap: 6,
  },
  igStoreBodyLast: {
    borderBottomWidth: 0,
  },
  igStoreTotalCard: {
    backgroundColor: '#f5f5f5',
    ...Platform.select({
      web: { cursor: 'default' },
      default: {},
    }),
  },
  rowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: TAB_BORDER,
  },
  storeRowSelected: {
    backgroundColor: '#f5f5f5',
  },
  storeRowPressed: {
    backgroundColor: '#f5f5f5',
  },
  storeBodyMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minWidth: 0,
  },
  storeCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  igStoreName: {
    fontFamily: FONT,
    fontSize: 15,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  desktopStoreName: {
    fontFamily: FONT,
    fontSize: 13,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  storeMeta: {
    fontFamily: FONT,
    fontSize: 13,
    color: '#8e8e93',
  },
  storeTrailing: {
    alignItems: 'flex-end',
    gap: 1,
    flexShrink: 0,
  },
  igStoreAmount: {
    fontFamily: FONT,
    fontSize: 15,
    fontWeight: '600',
    color: '#1a1a1a',
    fontVariant: ['tabular-nums'],
  },
  desktopAmount: {
    fontFamily: FONT,
    fontSize: 13,
    fontWeight: '600',
    color: '#1a1a1a',
    fontVariant: ['tabular-nums'],
    textAlign: 'right',
  },
  storePerReview: {
    fontFamily: FONT,
    fontSize: 11,
    color: '#8e8e93',
  },
  storeMetrics: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  storeMetric: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  storeMetricText: {
    fontFamily: FONT,
    fontSize: 14,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  storeIcon: {
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  storeIconText: {
    fontFamily: FONT,
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },
  storeIconTextSmall: {
    fontSize: 11,
  },
  colStore: {
    flex: 1,
    minWidth: 180,
  },
  colRate: {
    width: 88,
    textAlign: 'right',
  },
  colMoney: {
    width: 88,
    textAlign: 'right',
  },
  desktopRate: {
    fontFamily: FONT,
    fontSize: 13,
    fontWeight: '600',
    color: '#1a1a1a',
    fontVariant: ['tabular-nums'],
    textAlign: 'right',
  },
  desktopChevron: {
    width: 18,
    alignItems: 'flex-end',
  },
  rateLow: {
    color: '#B91C1C',
  },
  detail: {
    paddingHorizontal: 16,
    paddingTop: 20,
    gap: 14,
  },
  matrixWrap: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    gap: 8,
  },
  sectionHeader: {
    gap: 2,
    marginTop: 4,
  },
  sectionTitle: {
    fontFamily: FONT,
    fontSize: 15,
    fontWeight: '700',
    color: '#1a1a1a',
  },
  sectionHint: {
    fontFamily: FONT,
    fontSize: 12,
    color: '#8e8e93',
    lineHeight: 17,
  },
  matrixRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  matrixCorner: {
    width: 88,
  },
  matrixHead: {
    fontFamily: FONT,
    fontSize: 11,
    fontWeight: '700',
    color: '#6a6a6a',
    paddingVertical: 8,
    paddingHorizontal: 6,
    textAlign: 'center',
  },
  matrixHeadActive: {
    color: ACCENT,
  },
  matrixLabel: {
    fontFamily: FONT,
    fontSize: 12,
    fontWeight: '600',
    color: '#3a3a3a',
    paddingVertical: 10,
    paddingHorizontal: 6,
  },
  matrixLabelActive: {
    color: ACCENT,
  },
  matrixCell: {
    width: 96,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
  matrixCellActive: {
    backgroundColor: ACCENT_SOFT,
  },
  matrixValue: {
    fontFamily: FONT,
    fontSize: 14,
    fontWeight: '700',
    color: '#1a1a1a',
  },
  matrixValueActive: {
    color: '#7A4E03',
  },
  emailJump: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#fff',
  },
  emailJumpText: {
    fontFamily: FONT,
    fontSize: 13,
    fontWeight: '600',
    color: '#7A4E03',
    flex: 1,
  },
  employeeList: {
    backgroundColor: '#fff',
    borderRadius: 14,
    overflow: 'hidden',
  },
  employeeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: TAB_BORDER,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  employeeRowLast: {
    borderBottomWidth: 0,
  },
  employeeRowPressed: {
    backgroundColor: '#f5f5f5',
  },
  employeeAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  employeeAvatarText: {
    fontFamily: FONT,
    fontSize: 12,
    fontWeight: '700',
    color: '#fff',
  },
  employeeCopy: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  employeeName: {
    fontFamily: FONT,
    fontSize: 15,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  employeeMeta: {
    fontFamily: FONT,
    fontSize: 12,
    color: '#8e8e93',
  },
  employeeTrailing: {
    alignItems: 'flex-end',
  },
  employeeTotal: {
    fontFamily: FONT,
    fontSize: 16,
    fontWeight: '700',
    color: '#1a1a1a',
    fontVariant: ['tabular-nums'],
  },
  employeeBreakdown: {
    fontFamily: FONT,
    fontSize: 11,
    color: '#8e8e93',
  },
  ratingBreakdown: {
    gap: 5,
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
  },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  ratingStarLabel: {
    fontFamily: FONT,
    fontSize: 11,
    fontWeight: '700',
    color: '#6a6a6a',
    width: 22,
  },
  ratingBarTrack: {
    flex: 1,
    height: 6,
    borderRadius: 999,
    backgroundColor: '#f0f0f0',
    overflow: 'hidden',
  },
  ratingBarFill: {
    height: '100%',
    borderRadius: 999,
  },
  ratingBarPos: {
    backgroundColor: ACCENT,
  },
  ratingBarNeg: {
    backgroundColor: '#DC2626',
  },
  ratingCount: {
    fontFamily: FONT,
    fontSize: 11,
    color: '#6a6a6a',
    width: 24,
    textAlign: 'right',
  },
  reviewList: {
    gap: 8,
  },
  reviewRow: {
    borderRadius: 14,
    padding: 12,
    backgroundColor: '#fff',
    gap: 6,
  },
  reviewRowEligible: {
    backgroundColor: '#F7FBF6',
  },
  reviewRowNegative: {
    backgroundColor: '#FFF8F8',
  },
  reviewRowSkipped: {
    backgroundColor: '#FAFAFA',
    opacity: 0.96,
  },
  countBox: {
    backgroundColor: '#F7FBF6',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 2,
  },
  countBoxTotal: {
    fontFamily: FONT,
    fontSize: 13,
    fontWeight: '700',
    color: '#2F8A4E',
  },
  countBoxMeta: {
    fontFamily: FONT,
    fontSize: 12,
    color: '#3a3a3a',
  },
  skipBox: {
    backgroundColor: '#FFF1E7',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  skipBoxText: {
    fontFamily: FONT,
    fontSize: 12,
    fontWeight: '600',
    color: '#9A3412',
  },
  drawerRoot: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  drawerBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.28)',
  },
  drawerPanel: {
    height: '100%',
    maxHeight: '100%',
    flexDirection: 'column',
    overflow: 'hidden',
    backgroundColor: CANVAS,
    ...Platform.select({
      web: { boxShadow: '-12px 0 32px rgba(0,0,0,0.18)' },
      default: { elevation: 12 },
    }),
  },
  drawerPanelMobile: {
    paddingBottom: Platform.OS === 'ios' ? Math.max(20, mobileSafeBottom()) : 12,
  },
  drawerTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
    gap: 12,
  },
  drawerTopBarMobile: {
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 54 : 18,
    paddingBottom: 10,
  },
  drawerTitle: {
    fontFamily: FONT,
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
    gap: 8,
  },
  drawerBodyContentMobile: {
    paddingHorizontal: 16,
    paddingBottom: 32,
  },
  drawerHero: {
    marginBottom: 12,
    gap: 6,
  },
  drawerHeroLabel: {
    fontFamily: FONT,
    fontSize: 13,
    fontWeight: '600',
    color: '#8e8e93',
  },
  drawerHeroAmount: {
    fontFamily: FONT_LIGHT,
    fontSize: 40,
    lineHeight: 46,
    fontWeight: '400',
    color: '#1a1a1a',
    letterSpacing: -1.2,
    fontVariant: ['tabular-nums'],
  },
  drawerHeroStats: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: TAB_BORDER,
  },
  drawerHeroStat: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  drawerHeroStatDivider: {
    width: StyleSheet.hairlineWidth,
    height: 28,
    marginHorizontal: 12,
    backgroundColor: TAB_BORDER,
  },
  drawerHeroStatValue: {
    fontFamily: FONT,
    fontSize: 17,
    fontWeight: '600',
    color: '#1a1a1a',
    fontVariant: ['tabular-nums'],
  },
  drawerHeroStatLabel: {
    fontFamily: FONT,
    fontSize: 12,
    color: '#8e8e93',
  },
  drawerHeroMeta: {
    fontFamily: FONT,
    fontSize: 13,
    color: '#8e8e93',
    marginTop: 4,
  },
  drawerSectionTitle: {
    fontFamily: FONT,
    fontSize: 15,
    fontWeight: '700',
    color: '#1a1a1a',
    marginTop: 8,
  },
  drawerSectionSpaced: {
    marginTop: 18,
  },
  drawerSectionHint: {
    fontFamily: FONT,
    fontSize: 12,
    color: '#8e8e93',
    lineHeight: 17,
    marginBottom: 4,
  },
  reviewTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: '#e8e8ed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarFallback: {
    backgroundColor: ACCENT_SOFT,
  },
  avatarImage: {
    width: 36,
    height: 36,
  },
  avatarInitials: {
    fontFamily: FONT,
    fontSize: 12,
    fontWeight: '700',
    color: ACCENT,
  },
  reviewIdentity: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  reviewAuthor: {
    fontFamily: FONT,
    fontSize: 13,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  reviewStars: {
    fontFamily: FONT,
    fontSize: 12,
    color: ACCENT,
    fontWeight: '700',
  },
  reviewWhen: {
    fontFamily: FONT,
    fontSize: 11,
    color: '#8e8e93',
  },
  reviewText: {
    fontFamily: FONT,
    fontSize: 13,
    lineHeight: 18,
    color: '#3a3a3a',
  },
  reviewFlags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  flagGood: {
    fontFamily: FONT,
    fontSize: 11,
    fontWeight: '700',
    color: '#2F8A4E',
    backgroundColor: '#EAF6EE',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    overflow: 'hidden',
  },
  flagBad: {
    fontFamily: FONT,
    fontSize: 11,
    fontWeight: '600',
    color: '#9A3412',
    backgroundColor: '#FFF1E7',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    overflow: 'hidden',
  },
  flagPhoto: {
    fontFamily: FONT,
    fontSize: 11,
    fontWeight: '600',
    color: '#1D4ED8',
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    overflow: 'hidden',
  },
  flagNames: {
    fontFamily: FONT,
    fontSize: 11,
    fontWeight: '600',
    color: '#5a5a5a',
    backgroundColor: '#f2f2f2',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    overflow: 'hidden',
  },
  flagMatched: {
    fontFamily: FONT,
    fontSize: 11,
    fontWeight: '700',
    color: '#6D28D9',
    backgroundColor: '#F5F3FF',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    overflow: 'hidden',
  },
  matchDetail: {
    fontFamily: FONT,
    fontSize: 12,
    lineHeight: 17,
    color: '#5B21B6',
    backgroundColor: '#F5F3FF',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  ownerReply: {
    backgroundColor: '#f6f6f6',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 2,
  },
  ownerReplyLabel: {
    fontFamily: FONT,
    fontSize: 11,
    fontWeight: '700',
    color: '#6a6a6a',
  },
  ownerReplyText: {
    fontFamily: FONT,
    fontSize: 12,
    lineHeight: 17,
    color: '#3a3a3a',
  },
  emptyBlock: {
    paddingVertical: 18,
    paddingHorizontal: 8,
  },
  emptyText: {
    fontFamily: FONT,
    fontSize: 13,
    color: '#8e8e93',
  },
  storeError: {
    fontFamily: FONT,
    fontSize: 13,
    color: '#B91C1C',
  },
});
