import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppAccess } from '../lib/permissions';
import {
  buildBonusBoard,
  currentBonusMonth,
  formatMoney,
  monthRange,
  NEGATIVE_COLUMNS,
  PHOTO_BONUS,
} from '../lib/bonuses';
import { GOOGLE_STORE_PLACES } from '../lib/googleReviews';
import {
  fetchTransactionsAcrossPos,
  formatDateParam,
} from '../lib/transactions';

const fontFamily = Platform.select({
  ios: 'Sohne',
  android: 'Sohne',
  default: 'Sohne',
});

const ACCENT = '#A16207';
const ACCENT_SOFT = '#FEF9C3';

function shiftMonth(year, monthIndex, delta) {
  const date = new Date(year, monthIndex + delta, 1);
  return { year: date.getFullYear(), monthIndex: date.getMonth() };
}

function starsLabel(rating) {
  return `${'★'.repeat(rating)}${'☆'.repeat(Math.max(0, 5 - rating))}`;
}

function RatingBreakdown({ breakdown, total }) {
  const max = Math.max(1, ...[5, 4, 3, 2, 1].map((star) => breakdown?.[star] || 0));
  return (
    <View style={styles.ratingBreakdown}>
      <Text style={styles.ratingBreakdownTitle}>
        Reviews this month{total != null ? ` · ${total}` : ''}
      </Text>
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

function StoreBonusCard({ store, selected, onPress, onOpenEmails }) {
  const tier = store.payout?.tier;
  const column = store.payout?.column;
  return (
    <View
      style={[
        styles.storeCard,
        selected && styles.storeCardSelected,
      ]}
    >
      <Pressable onPress={onPress}>
        <View style={styles.storeCardTop}>
          <Text style={styles.storeCardName} numberOfLines={1}>
            {store.storeName}
          </Text>
          {store.googleConfigured ? (
            <View style={styles.liveBadge}>
              <Ionicons name="logo-google" size={11} color="#1a1a1a" />
              <Text style={styles.liveBadgeText}>Reviews</Text>
            </View>
          ) : (
            <Text style={styles.mutedBadge}>No Google link</Text>
          )}
        </View>

        <Text style={styles.perReviewAmount}>{formatMoney(store.perReviewBonus)}</Text>
        <Text style={styles.perReviewLabel}>per eligible 5★ review</Text>
      </Pressable>

      <View style={styles.metricRow}>
        <Pressable
          style={[styles.metric, styles.metricPressable]}
          onPress={() => onOpenEmails?.(store)}
        >
          <Text style={[styles.metricValue, styles.metricLink]}>{store.emailRateLabel}</Text>
          <Text style={styles.metricLabel}>Email rate</Text>
          <Text style={styles.metricHint}>
            {store.withEmail}/{store.customerCount} named
          </Text>
        </Pressable>
        <Pressable style={styles.metric} onPress={onPress}>
          <Text style={styles.metricValue}>{store.negativeCount}</Text>
          <Text style={styles.metricLabel}>Negatives</Text>
          <Text style={styles.metricHint}>1–2★ live</Text>
        </Pressable>
        <Pressable style={styles.metric} onPress={onPress}>
          <Text style={styles.metricValue}>{store.eligibleCount}</Text>
          <Text style={styles.metricLabel}>Eligible</Text>
          <Text style={styles.metricHint}>{store.fiveStarCount} five-star</Text>
        </Pressable>
      </View>

      <Pressable onPress={onPress}>
        <RatingBreakdown breakdown={store.ratingBreakdown} total={store.reviewCount} />

        <View style={styles.tierChipRow}>
          <Text style={styles.tierChip}>{tier?.label || '—'} email</Text>
          <Text style={styles.tierChip}>{column?.label || '—'}</Text>
        </View>

        <Text style={styles.storeTotal}>
          Est. {formatMoney(store.totalPayout)}
          {store.photoReviewCount > 0
            ? ` · ${store.photoReviewCount} photo × ${formatMoney(PHOTO_BONUS)}`
            : ''}
        </Text>
      </Pressable>
    </View>
  );
}

function PayoutMatrix({ matrix, activeTierId, activeColumnId }) {
  return (
    <View style={styles.matrixWrap}>
      <Text style={styles.sectionTitle}>Payout grid</Text>
      <Text style={styles.sectionHint}>
        Base bonus by email collection, adjusted by 1–2★ reviews still live this month.
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View>
          <View style={styles.matrixRow}>
            <Text style={[styles.matrixCorner, styles.matrixHead]}>Email rate</Text>
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

function EmployeeGrid({ employees }) {
  if (!employees.length) {
    return (
      <View style={styles.emptyBlock}>
        <Text style={styles.emptyText}>No eligible employee payouts for this month yet.</Text>
      </View>
    );
  }

  return (
    <View style={styles.employeeGrid}>
      {employees.map((row) => (
        <View key={row.employeeName} style={styles.employeeCard}>
          <Text style={styles.employeeName} numberOfLines={1}>
            {row.employeeName}
          </Text>
          <Text style={styles.employeeTotal}>{formatMoney(row.total)}</Text>
          <Text style={styles.employeeMeta}>
            {row.eligibleCount} review{row.eligibleCount === 1 ? '' : 's'}
            {row.photoCount > 0 ? ` · ${row.photoCount} photo` : ''}
          </Text>
          <Text style={styles.employeeBreakdown}>
            {formatMoney(row.reviewBonus)} reviews
            {row.photoBonus > 0 ? ` + ${formatMoney(row.photoBonus)} photos` : ''}
          </Text>
        </View>
      ))}
    </View>
  );
}

function ReviewList({ reviews }) {
  if (!reviews.length) {
    return (
      <View style={styles.emptyBlock}>
        <Text style={styles.emptyText}>No Google reviews in this month.</Text>
      </View>
    );
  }

  return (
    <View style={styles.reviewList}>
      {reviews.map((review) => (
        <View
          key={review.id}
          style={[
            styles.reviewRow,
            review.eligible && styles.reviewRowEligible,
            review.rating <= 2 && styles.reviewRowNegative,
          ]}
        >
          <View style={styles.reviewTop}>
            <Text style={styles.reviewStars}>{starsLabel(review.rating)}</Text>
            <Text style={styles.reviewAuthor} numberOfLines={1}>
              {review.author || 'Anonymous'}
            </Text>
            <Text style={styles.reviewWhen}>{review.relativeTime || ''}</Text>
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
            {review.hasPhotos ? <Text style={styles.flagPhoto}>+ photo bonus</Text> : null}
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
              Reviewer “{review.author}” matched customer{' '}
              {review.transactionMatch.customerName}
              {review.transactionMatch.reference
                ? ` · ${review.transactionMatch.reference}`
                : ''}
              {review.transactionMatch.dateLabel
                ? ` · ${review.transactionMatch.dateLabel}`
                : ''}
              . No employee named in review — credited from Aureus transaction.
            </Text>
          ) : null}
        </View>
      ))}
    </View>
  );
}

export default function BonusesScreen({ session, onRequireLogin, onOpenEmails }) {
  const { canFilter } = useAppAccess();
  const allowFilters = canFilter('bonuses');
  const initial = useMemo(() => currentBonusMonth(), []);
  const [year, setYear] = useState(() => parseInt(initial.startDate.slice(0, 4), 10));
  const [monthIndex, setMonthIndex] = useState(
    () => parseInt(initial.startDate.slice(5, 7), 10) - 1,
  );
  const [board, setBoard] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedStore, setSelectedStore] = useState(
    () => GOOGLE_STORE_PLACES[0]?.storeName || null,
  );
  const requestId = useRef(0);

  const range = useMemo(() => monthRange(year, monthIndex), [year, monthIndex]);
  const now = currentBonusMonth();
  const isCurrentMonth =
    range.startDate === now.startDate && range.endDate === now.endDate;

  const load = useCallback(async () => {
    if (!session?.token) {
      setBoard(null);
      setError('');
      return;
    }

    const id = ++requestId.current;
    setLoading(true);
    setError('');

    try {
      const tx = await fetchTransactionsAcrossPos(session, {
        startDate: range.startDate,
        endDate: range.endDate,
      });
      if (id !== requestId.current) return;

      const next = await buildBonusBoard({
        transactionRows: tx.rows || [],
        year,
        monthIndex,
      });
      if (id !== requestId.current) return;

      setBoard(next);
      setSelectedStore((current) => {
        if (current && next.stores.some((store) => store.storeName === current)) {
          return current;
        }
        const laval = next.stores.find((store) => store.storeName === 'Laval');
        return laval?.storeName || next.stores[0]?.storeName || null;
      });
    } catch (err) {
      if (id !== requestId.current) return;
      setBoard(null);
      setError(err?.message || 'Failed to load bonuses.');
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [session, range.startDate, range.endDate, year, monthIndex]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!allowFilters) setSelectedStore(null);
  }, [allowFilters]);

  const storeNames = useMemo(
    () => (board?.stores || []).map((store) => store.storeName),
    [board],
  );

  const activeStore = useMemo(() => {
    if (!board?.stores?.length) return null;
    return (
      board.stores.find((store) => store.storeName === selectedStore) || board.stores[0]
    );
  }, [board, selectedStore]);

  const goMonth = (delta) => {
    const next = shiftMonth(year, monthIndex, delta);
    const nextRange = monthRange(next.year, next.monthIndex);
    const todayKey = formatDateParam(new Date());
    if (nextRange.startDate > todayKey) return;
    setYear(next.year);
    setMonthIndex(next.monthIndex);
  };

  if (!session?.token) {
    return (
      <View style={styles.body}>
        <Text style={styles.hint}>
          Sign in to load email capture rates and estimate bonus payouts.{' '}
          {onRequireLogin ? (
            <Text style={styles.link} onPress={onRequireLogin}>
              Go to Profile
            </Text>
          ) : null}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.body}>
      <View style={styles.toolbar}>
        <View style={styles.monthNav}>
          <Pressable style={styles.monthBtn} onPress={() => goMonth(-1)} hitSlop={8}>
            <Ionicons name="chevron-back" size={18} color="#1a1a1a" />
          </Pressable>
          <View style={styles.monthLabelWrap}>
            <Text style={styles.monthLabel}>{range.label}</Text>
            <Text style={styles.monthSub}>
              {isCurrentMonth ? 'Current bonus month' : 'Bonus month'} · policy Aug 1, 2026
            </Text>
          </View>
          <Pressable
            style={[styles.monthBtn, isCurrentMonth && styles.monthBtnDisabled]}
            onPress={() => goMonth(1)}
            disabled={isCurrentMonth}
            hitSlop={8}
          >
            <Ionicons
              name="chevron-forward"
              size={18}
              color={isCurrentMonth ? '#c4c4c4' : '#1a1a1a'}
            />
          </Pressable>
        </View>

        <Pressable style={styles.refresh} onPress={load} hitSlop={8}>
          {loading ? (
            <ActivityIndicator size="small" color={ACCENT} />
          ) : (
            <Ionicons name="refresh" size={16} color="#8a8a8a" />
          )}
        </Pressable>
      </View>

      {error ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.pageIntro}>
          Track where each store sits on the Google review bonus grid — email collection rate
          × negative reviews — and how payouts split across employees.
        </Text>

        {allowFilters ? (
        <View style={styles.storeFilterRow}>
          <Pressable
            style={[styles.storeChip, !selectedStore && styles.storeChipActive]}
            onPress={() => setSelectedStore(null)}
          >
            <Text
              style={[styles.storeChipText, !selectedStore && styles.storeChipTextActive]}
            >
              All stores
            </Text>
          </Pressable>
          {storeNames.map((name) => (
            <Pressable
              key={name}
              style={[
                styles.storeChip,
                selectedStore === name && styles.storeChipActive,
              ]}
              onPress={() =>
                setSelectedStore((current) => (current === name ? null : name))
              }
            >
              <Text
                style={[
                  styles.storeChipText,
                  selectedStore === name && styles.storeChipTextActive,
                ]}
              >
                {name}
              </Text>
            </Pressable>
          ))}
        </View>
        ) : null}

        {loading && !board ? (
          <View style={styles.loadingBlock}>
            <ActivityIndicator color={ACCENT} />
            <Text style={styles.loadingText}>Loading email rates and Google reviews…</Text>
          </View>
        ) : null}

        <View style={styles.storeGrid}>
          {(selectedStore
            ? board?.stores.filter((store) => store.storeName === selectedStore)
            : board?.stores || []
          )?.map((store) => (
            <StoreBonusCard
              key={store.storeName}
              store={store}
              selected={activeStore?.storeName === store.storeName}
              onPress={() => setSelectedStore(store.storeName)}
              onOpenEmails={(target) =>
                onOpenEmails?.({
                  storeName: target.storeName,
                  startDate: range.startDate,
                  endDate: range.endDate,
                })
              }
            />
          ))}
        </View>

        {board && activeStore ? (
          <>
            <PayoutMatrix
              matrix={board.matrix}
              activeTierId={activeStore.payout?.tier?.id}
              activeColumnId={activeStore.payout?.column?.id}
            />

            <View style={styles.detailHeader}>
              <Text style={styles.sectionTitle}>{activeStore.storeName} email rate</Text>
              <Text style={styles.sectionHint}>
                {activeStore.withEmail} with email ÷ {activeStore.customerCount} named customers
                (walk-ins excluded) = {activeStore.emailRateLabel}. Tap the email rate on a store
                card for the full month breakdown.
              </Text>
            </View>

            <Pressable
              style={styles.emailJump}
              onPress={() =>
                onOpenEmails?.({
                  storeName: activeStore.storeName,
                  startDate: range.startDate,
                  endDate: range.endDate,
                })
              }
            >
              <Ionicons name="mail-outline" size={16} color={ACCENT} />
              <Text style={styles.emailJumpText}>
                Open Emails · {activeStore.storeName} · {range.label}
              </Text>
              <Ionicons name="chevron-forward" size={16} color={ACCENT} />
            </Pressable>

            <View style={styles.detailHeader}>
              <Text style={styles.sectionTitle}>{activeStore.storeName} employees</Text>
              <Text style={styles.sectionHint}>
                {formatMoney(activeStore.perReviewBonus)} / eligible review
                {activeStore.reviewsError ? ` · ${activeStore.reviewsError}` : ''}
              </Text>
            </View>

            <View style={styles.summaryStrip}>
              <Text style={styles.summaryStripText}>
                {activeStore.withEmail}/{activeStore.customerCount} emails ·{' '}
                {activeStore.fiveStarCount} five-star · {activeStore.eligibleCount} eligible ·{' '}
                {activeStore.transactionAttributedCount
                  ? `${activeStore.transactionAttributedCount} matched via txn · `
                  : ''}
                {activeStore.negativeCount} negative · est.{' '}
                {formatMoney(activeStore.totalPayout)}
              </Text>
            </View>

            <EmployeeGrid employees={activeStore.employees} />

            <View style={styles.detailHeader}>
              <Text style={styles.sectionTitle}>{activeStore.storeName} reviews</Text>
              <Text style={styles.sectionHint}>
                {activeStore.reviews.length} in {range.label}
                {activeStore.reviewsLoaded
                  ? ` · ${activeStore.reviewsLoaded} loaded from Google`
                  : ''}
                {activeStore.ineligibleFiveStarCount
                  ? ` · ${activeStore.ineligibleFiveStarCount} name-only 5★ excluded`
                  : ''}
              </Text>
            </View>
            <RatingBreakdown
              breakdown={activeStore.ratingBreakdown}
              total={activeStore.reviewCount}
            />
            <ReviewList reviews={activeStore.reviews} />
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    minHeight: 0,
  },
  hint: {
    fontFamily,
    fontSize: 14,
    lineHeight: 20,
    color: '#5a5a5a',
    padding: 16,
  },
  link: {
    color: ACCENT,
    fontWeight: '600',
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e8e8e8',
    gap: 12,
  },
  monthNav: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flex: 1,
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
    fontFamily,
    fontSize: 16,
    fontWeight: '700',
    color: '#1a1a1a',
  },
  monthSub: {
    fontFamily,
    fontSize: 11,
    color: '#8a8a8a',
    marginTop: 1,
  },
  refresh: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorBanner: {
    marginHorizontal: 16,
    marginTop: 10,
    padding: 10,
    borderRadius: 8,
    backgroundColor: '#FEF2F2',
  },
  errorText: {
    fontFamily,
    fontSize: 13,
    color: '#B91C1C',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
    gap: 14,
  },
  pageIntro: {
    fontFamily,
    fontSize: 13,
    lineHeight: 19,
    color: '#5a5a5a',
  },
  storeFilterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  storeChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: '#f3f3f3',
  },
  storeChipActive: {
    backgroundColor: '#1a1a1a',
  },
  storeChipText: {
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
    color: '#4a4a4a',
  },
  storeChipTextActive: {
    color: '#fff',
  },
  loadingBlock: {
    paddingVertical: 28,
    alignItems: 'center',
    gap: 10,
  },
  loadingText: {
    fontFamily,
    fontSize: 13,
    color: '#8a8a8a',
  },
  storeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  storeCard: {
    width: '100%',
    maxWidth: 320,
    flexGrow: 1,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ececec',
    borderRadius: 14,
    padding: 14,
    gap: 4,
  },
  storeCardHover: {
    borderColor: '#ddd',
    backgroundColor: '#fafafa',
  },
  storeCardSelected: {
    borderColor: ACCENT,
    backgroundColor: '#FFFEF7',
    shadowColor: ACCENT,
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 2 },
  },
  storeCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 6,
  },
  storeCardName: {
    fontFamily,
    fontSize: 16,
    fontWeight: '700',
    color: '#1a1a1a',
    flex: 1,
  },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: ACCENT_SOFT,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  liveBadgeText: {
    fontFamily,
    fontSize: 10,
    fontWeight: '700',
    color: '#1a1a1a',
  },
  mutedBadge: {
    fontFamily,
    fontSize: 10,
    color: '#9a9a9a',
  },
  perReviewAmount: {
    fontFamily,
    fontSize: 28,
    fontWeight: '800',
    color: '#1a1a1a',
    letterSpacing: -0.5,
  },
  perReviewLabel: {
    fontFamily,
    fontSize: 12,
    color: '#7a7a7a',
    marginBottom: 8,
  },
  metricRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  metric: {
    flex: 1,
    backgroundColor: '#f7f7f7',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 8,
  },
  metricValue: {
    fontFamily,
    fontSize: 15,
    fontWeight: '700',
    color: '#1a1a1a',
  },
  metricLink: {
    color: ACCENT,
    textDecorationLine: 'underline',
  },
  metricPressable: {
    borderWidth: 1,
    borderColor: '#ead9a8',
    backgroundColor: '#FFFEF7',
  },
  metricLabel: {
    fontFamily,
    fontSize: 10,
    color: '#8a8a8a',
    marginTop: 2,
  },
  metricHint: {
    fontFamily,
    fontSize: 10,
    color: '#9a9a9a',
    marginTop: 2,
  },
  ratingBreakdown: {
    marginTop: 10,
    gap: 4,
  },
  ratingBreakdownTitle: {
    fontFamily,
    fontSize: 11,
    fontWeight: '700',
    color: '#6a6a6a',
    marginBottom: 2,
  },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  ratingStarLabel: {
    fontFamily,
    fontSize: 11,
    fontWeight: '600',
    color: '#5a5a5a',
    width: 22,
  },
  ratingBarTrack: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#efefef',
    overflow: 'hidden',
  },
  ratingBarFill: {
    height: 6,
    borderRadius: 3,
    minWidth: 0,
  },
  ratingBarPos: {
    backgroundColor: '#C9A227',
  },
  ratingBarNeg: {
    backgroundColor: '#C45C5C',
  },
  ratingCount: {
    fontFamily,
    fontSize: 11,
    fontWeight: '600',
    color: '#5a5a5a',
    width: 18,
    textAlign: 'right',
  },
  emailJump: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#ead9a8',
    backgroundColor: '#FFFEF7',
  },
  emailJumpText: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: '#7A4E03',
    flex: 1,
  },
  tierChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 10,
  },
  tierChip: {
    fontFamily,
    fontSize: 11,
    fontWeight: '600',
    color: '#6b5a1e',
    backgroundColor: ACCENT_SOFT,
    overflow: 'hidden',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  storeTotal: {
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
    color: '#3a3a3a',
    marginTop: 10,
  },
  matrixWrap: {
    borderWidth: 1,
    borderColor: '#ececec',
    borderRadius: 14,
    padding: 14,
    backgroundColor: '#fff',
    gap: 8,
  },
  sectionTitle: {
    fontFamily,
    fontSize: 15,
    fontWeight: '700',
    color: '#1a1a1a',
  },
  sectionHint: {
    fontFamily,
    fontSize: 12,
    color: '#8a8a8a',
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
    fontFamily,
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
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
    color: '#3a3a3a',
    paddingVertical: 10,
    paddingHorizontal: 6,
    textAlign: 'left',
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
    fontFamily,
    fontSize: 14,
    fontWeight: '700',
    color: '#1a1a1a',
  },
  matrixValueActive: {
    color: '#7A4E03',
  },
  detailHeader: {
    gap: 2,
    marginTop: 4,
  },
  summaryStrip: {
    backgroundColor: '#f6f6f6',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  summaryStripText: {
    fontFamily,
    fontSize: 12,
    color: '#4a4a4a',
    lineHeight: 17,
  },
  employeeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  employeeCard: {
    width: '100%',
    maxWidth: 220,
    flexGrow: 1,
    borderWidth: 1,
    borderColor: '#ececec',
    borderRadius: 12,
    padding: 12,
    backgroundColor: '#fff',
    gap: 2,
  },
  employeeName: {
    fontFamily,
    fontSize: 14,
    fontWeight: '700',
    color: '#1a1a1a',
  },
  employeeTotal: {
    fontFamily,
    fontSize: 22,
    fontWeight: '800',
    color: '#1a1a1a',
    marginTop: 4,
  },
  employeeMeta: {
    fontFamily,
    fontSize: 12,
    color: '#6a6a6a',
  },
  employeeBreakdown: {
    fontFamily,
    fontSize: 11,
    color: '#9a9a9a',
    marginTop: 4,
  },
  emptyBlock: {
    paddingVertical: 18,
    paddingHorizontal: 8,
  },
  emptyText: {
    fontFamily,
    fontSize: 13,
    color: '#8a8a8a',
  },
  reviewList: {
    gap: 8,
  },
  reviewRow: {
    borderWidth: 1,
    borderColor: '#ececec',
    borderRadius: 12,
    padding: 12,
    backgroundColor: '#fff',
    gap: 6,
  },
  reviewRowEligible: {
    borderColor: '#D8E7D3',
    backgroundColor: '#F7FBF6',
  },
  reviewRowNegative: {
    borderColor: '#F0D6D6',
    backgroundColor: '#FFF8F8',
  },
  reviewTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  reviewStars: {
    fontFamily,
    fontSize: 12,
    color: ACCENT,
    fontWeight: '700',
  },
  reviewAuthor: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: '#1a1a1a',
    flex: 1,
  },
  reviewWhen: {
    fontFamily,
    fontSize: 11,
    color: '#9a9a9a',
  },
  reviewText: {
    fontFamily,
    fontSize: 13,
    lineHeight: 18,
    color: '#3a3a3a',
  },
  reviewFlags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 2,
  },
  flagGood: {
    fontFamily,
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
    fontFamily,
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
    fontFamily,
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
    fontFamily,
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
    fontFamily,
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
    fontFamily,
    fontSize: 12,
    lineHeight: 17,
    color: '#5B21B6',
    backgroundColor: '#F5F3FF',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginTop: 2,
  },
});
