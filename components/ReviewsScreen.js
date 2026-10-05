import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useIsMobile } from '../lib/mobileUi';
import { BONUS_ACCESS_DENIED, canViewBonusReviewData } from '../lib/auth';
import { useAppAccess } from '../lib/permissions';
import {
  GOOGLE_STORE_PLACES,
  currentReviewMonth,
  fetchAllGoogleStoreReviews,
  filterReviewsByDateRange,
  getGooglePlaceForStore,
  reviewMonthRange,
  reviewPeriodLabel,
  summarizeReviews,
} from '../lib/googleReviews';
import { useAppDate } from '../lib/appDate';
import { formatDateParam, parseDateParam } from '../lib/transactions';
import HomeDatePicker from './HomeDatePicker';
import ReviewAuthorLink from './ReviewAuthorLink';

const fontFamily = Platform.select({
  ios: 'Sohne',
  android: 'Sohne',
  default: 'Sohne',
});

const ACCENT = '#A16207';
const ACCENT_SOFT = '#FEF9C3';

function starsLabel(rating) {
  const value = Math.max(0, Math.min(5, Number(rating) || 0));
  return `${'★'.repeat(value)}${'☆'.repeat(5 - value)}`;
}

function formatAverage(value) {
  const n = Number(value) || 0;
  return n.toFixed(1);
}

function formatWhen(review) {
  if (review?.relativeTime) return review.relativeTime;
  if (review?.date instanceof Date && !Number.isNaN(review.date.getTime())) {
    return review.date.toLocaleDateString();
  }
  return '';
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

function Avatar({ uri, name }) {
  const [failed, setFailed] = useState(false);
  const showImage = Boolean(uri) && !failed;

  useEffect(() => {
    setFailed(false);
  }, [uri]);

  return (
    <View style={[styles.avatar, !showImage && styles.avatarFallback]}>
      {showImage ? (
        <Image
          source={{ uri }}
          style={styles.avatarImage}
          onError={() => setFailed(true)}
        />
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

function StoreCard({ store, selected, onPress, compact, fill }) {
  const summary = summarizeReviews(store.reviews);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={[
        styles.storeCard,
        compact && styles.storeCardCompact,
        fill && styles.storeCardFill,
        selected && styles.storeCardSelected,
      ]}
    >
      <View style={styles.storeCardTop}>
        <Text
          style={[styles.storeCardName, compact && styles.storeCardNameCompact]}
          numberOfLines={1}
        >
          {store.storeName}
        </Text>
        {store.place ? (
          <View style={styles.liveBadge}>
            <Ionicons name="logo-google" size={11} color="#1a1a1a" />
            {!compact ? <Text style={styles.liveBadgeText}>Google</Text> : null}
          </View>
        ) : (
          <Text style={styles.mutedBadge}>No Google link</Text>
        )}
      </View>
      <Text style={[styles.storeAverage, compact && styles.storeAverageCompact]}>
        {summary.count ? formatAverage(summary.average) : '—'}
      </Text>
      <Text style={styles.storeAverageLabel} numberOfLines={1}>
        {summary.count} review{summary.count === 1 ? '' : 's'}
        {store.loading ? ' · loading…' : ''}
      </Text>
      {store.error ? <Text style={styles.storeError}>{store.error}</Text> : null}
      {compact ? null : <RatingBreakdown breakdown={summary.breakdown} total={summary.count} />}
    </Pressable>
  );
}

function ChipRow({ mobile, children }) {
  if (!mobile) return <View style={styles.filterRow}>{children}</View>;
  return (
    <ScrollView
      horizontal
      nestedScrollEnabled
      showsHorizontalScrollIndicator={false}
      style={styles.hScroll}
      contentContainerStyle={styles.chipRowMobile}
    >
      {children}
    </ScrollView>
  );
}

function ReviewCard({ review, storeName, showStore, compact, session, onOpenCustomer }) {
  return (
    <View
      style={[
        styles.reviewRow,
        compact && styles.reviewRowCompact,
        review.rating <= 2 && styles.reviewRowNegative,
      ]}
    >
      <View style={[styles.reviewTop, compact && styles.reviewTopCompact]}>
        <Avatar uri={review.avatarUrl} name={review.author} />
        <View style={styles.reviewIdentity}>
          <ReviewAuthorLink
            session={session}
            review={review}
            onOpenCustomer={onOpenCustomer}
            style={styles.reviewAuthor}
          />
          <Text style={styles.reviewStars}>{starsLabel(review.rating)}</Text>
        </View>
        <Text style={[styles.reviewWhen, compact && styles.reviewWhenCompact]} numberOfLines={2}>
          {formatWhen(review)}
        </Text>
      </View>
      {showStore && storeName ? (
        <Text style={styles.reviewStore}>{storeName}</Text>
      ) : null}
      <Text style={styles.reviewText}>
        {review.text || '(No written comment)'}
      </Text>
      <View style={styles.reviewFlags}>
        {review.hasPhotos ? (
          <Text style={styles.flagPhoto}>
            {review.photoCount} photo{review.photoCount === 1 ? '' : 's'}
          </Text>
        ) : null}
        {review.ownerReply ? (
          <Text style={styles.flagReplied}>Replied</Text>
        ) : (
          <Text style={styles.flagUnreplied}>Needs reply</Text>
        )}
      </View>
      {review.ownerReply ? (
        <View style={styles.ownerReply}>
          <Text style={styles.ownerReplyLabel}>Owner reply</Text>
          <Text style={styles.ownerReplyText}>{review.ownerReply}</Text>
        </View>
      ) : null}
    </View>
  );
}

export default function ReviewsScreen({ session, onRequireLogin, storeFilter, onOpenCustomer }) {
  const isMobile = useIsMobile();
  const { canFilter } = useAppAccess();
  const allowFilters = canFilter('reviews');
  const appDate = useAppDate();
  const startDate = appDate.startDate;
  const endDate = appDate.endDate;
  const [allTimeOverride, setAllTimeOverride] = useState(false);
  const dateMode = allTimeOverride ? 'all' : appDate.mode;
  const [results, setResults] = useState([]);
  const [selectedStore, setSelectedStore] = useState(
    () => getGooglePlaceForStore(storeFilter)?.storeName || storeFilter || null,
  );
  const [ratingFilter, setRatingFilter] = useState(0);
  const [needsReplyOnly, setNeedsReplyOnly] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const requestId = useRef(0);
  useEffect(() => {
    setAllTimeOverride(false);
  }, [appDate.endDate, appDate.generation, appDate.mode, appDate.startDate]);

  const allTime = dateMode === 'all';
  const periodLabel = reviewPeriodLabel(startDate, endDate, dateMode);
  const currentMonth = currentReviewMonth();
  const start = parseDateParam(startDate);
  const selectedMonth = reviewMonthRange(start.getFullYear(), start.getMonth());
  const nextMonthStart = formatDateParam(new Date(start.getFullYear(), start.getMonth() + 1, 1));
  const canGoForward = nextMonthStart <= currentMonth.startDate;
  const isCurrentMonth =
    startDate === currentMonth.startDate && endDate === currentMonth.endDate;
  const isFullMonth =
    startDate === selectedMonth.startDate && endDate === selectedMonth.endDate;

  useEffect(() => {
    if (storeFilter) {
      setSelectedStore(getGooglePlaceForStore(storeFilter)?.storeName || storeFilter);
      return;
    }
    if (!allowFilters) setSelectedStore(null);
  }, [allowFilters, storeFilter]);

  const load = useCallback(
    async ({ refresh = false } = {}) => {
      if (!session?.token) {
        setResults([]);
        setError('');
        return;
      }
      if (canViewBonusReviewData(session) === false) {
        setResults([]);
        setError(BONUS_ACCESS_DENIED);
        setLoading(false);
        return;
      }

      const id = ++requestId.current;
      const places = storeFilter
        ? GOOGLE_STORE_PLACES.filter(
            (place) =>
              place.storeName === (getGooglePlaceForStore(storeFilter)?.storeName || storeFilter),
          )
        : GOOGLE_STORE_PLACES;

      setLoading(true);
      setError('');
      setResults((current) =>
        places.map((place) => {
          const existing = current.find((row) => row.storeName === place.storeName);
          return {
            storeName: place.storeName,
            place,
            reviews: existing
              ? allTime
                ? existing.reviews
                : filterReviewsByDateRange(existing.reviews || [], startDate, endDate)
              : [],
            error: '',
            loading: true,
          };
        }),
      );

      try {
        const next = await fetchAllGoogleStoreReviews({
          storeName: storeFilter || undefined,
          startDate: allTime ? undefined : startDate,
          endDate: allTime ? undefined : endDate,
          allTime,
          refresh: refresh === true,
          purpose: canViewBonusReviewData(session) === true ? 'bonus' : 'home',
          onPage: ({ storeName, reviews, done }) => {
            if (id !== requestId.current) return;
            setResults((current) =>
              current.map((row) =>
                row.storeName === storeName ? { ...row, reviews, loading: !done } : row,
              ),
            );
          },
        });
        if (id !== requestId.current) return;
        setResults(next.map((row) => ({ ...row, loading: false })));
      } catch (err) {
        if (id !== requestId.current) return;
        setResults([]);
        setError(err?.message || 'Failed to load Google reviews.');
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    },
    [session, storeFilter, startDate, endDate, allTime],
  );

  useEffect(() => {
    load();
  }, [load]);

  const visibleStores = useMemo(() => {
    if (!selectedStore) return results;
    return results.filter((row) => row.storeName === selectedStore);
  }, [results, selectedStore]);

  const feed = useMemo(() => {
    const rows = [];
    for (const store of visibleStores) {
      for (const review of store.reviews || []) {
        if (ratingFilter && Number(review.rating) !== ratingFilter) continue;
        if (needsReplyOnly && review.ownerReply) continue;
        rows.push({ review, storeName: store.storeName });
      }
    }
    rows.sort((a, b) => (b.review.timestampMs || 0) - (a.review.timestampMs || 0));
    return rows;
  }, [visibleStores, ratingFilter, needsReplyOnly]);

  const combined = useMemo(
    () => summarizeReviews(visibleStores.flatMap((store) => store.reviews || [])),
    [visibleStores],
  );

  const stillLoading = loading || results.some((row) => row.loading);

  const applyPeriod = (nextStart, nextEnd, mode) => {
    if (mode === 'all') {
      setAllTimeOverride(true);
      return;
    }
    setAllTimeOverride(false);
    appDate.applyPicker({ mode, start: nextStart, end: nextEnd || nextStart });
  };

  const goMonth = (delta) => {
    const cursor = parseDateParam(startDate);
    const next = new Date(cursor.getFullYear(), cursor.getMonth() + delta, 1);
    if (formatDateParam(next) > currentMonth.startDate) return;
    const period = reviewMonthRange(next.getFullYear(), next.getMonth());
    applyPeriod(period.start, period.end, 'range');
  };

  const goToCurrentMonth = () => {
    applyPeriod(currentMonth.start, currentMonth.end, 'range');
  };

  const summaryLine = combined.count
    ? `${formatAverage(combined.average)} average · ${combined.count} in ${periodLabel}`
    : stillLoading
      ? `Loading ${periodLabel} from Google…`
      : `No reviews in ${periodLabel}`;

  const storeChips =
    allowFilters && !storeFilter ? (
      <ChipRow mobile={isMobile}>
        <Pressable
          style={[styles.chip, isMobile && styles.chipMobile, !selectedStore && styles.chipActive]}
          onPress={() => setSelectedStore(null)}
          accessibilityRole="button"
          accessibilityState={{ selected: !selectedStore }}
        >
          <Text style={[styles.chipText, !selectedStore && styles.chipTextActive]}>
            All stores
          </Text>
        </Pressable>
        {GOOGLE_STORE_PLACES.map((place) => (
          <Pressable
            key={place.storeName}
            style={[
              styles.chip,
              isMobile && styles.chipMobile,
              selectedStore === place.storeName && styles.chipActive,
            ]}
            onPress={() =>
              setSelectedStore((current) =>
                current === place.storeName ? null : place.storeName,
              )
            }
            accessibilityRole="button"
            accessibilityState={{ selected: selectedStore === place.storeName }}
          >
            <Text
              style={[
                styles.chipText,
                selectedStore === place.storeName && styles.chipTextActive,
              ]}
            >
              {place.storeName}
            </Text>
          </Pressable>
        ))}
      </ChipRow>
    ) : null;

  const ratingChips = (
    <ChipRow mobile={isMobile}>
      <Pressable
        style={[styles.chip, isMobile && styles.chipMobile, ratingFilter === 0 && styles.chipActive]}
        onPress={() => setRatingFilter(0)}
        accessibilityRole="button"
        accessibilityState={{ selected: ratingFilter === 0 }}
      >
        <Text style={[styles.chipText, ratingFilter === 0 && styles.chipTextActive]}>
          All ratings
        </Text>
      </Pressable>
      {[5, 4, 3, 2, 1].map((star) => (
        <Pressable
          key={star}
          style={[
            styles.chip,
            isMobile && styles.chipMobile,
            ratingFilter === star && styles.chipActive,
          ]}
          onPress={() => setRatingFilter((current) => (current === star ? 0 : star))}
          accessibilityRole="button"
          accessibilityState={{ selected: ratingFilter === star }}
        >
          <Text style={[styles.chipText, ratingFilter === star && styles.chipTextActive]}>
            {star}★
          </Text>
        </Pressable>
      ))}
      <Pressable
        style={[styles.chip, isMobile && styles.chipMobile, needsReplyOnly && styles.chipActive]}
        onPress={() => setNeedsReplyOnly((current) => !current)}
        accessibilityRole="button"
        accessibilityState={{ selected: needsReplyOnly }}
      >
        <Text style={[styles.chipText, needsReplyOnly && styles.chipTextActive]}>
          Needs reply
        </Text>
      </Pressable>
    </ChipRow>
  );

  const refreshButton = (
    <Pressable
      style={[styles.refresh, isMobile && styles.refreshMobile]}
      onPress={() => load({ refresh: true })}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel="Refresh reviews"
    >
      {stillLoading ? (
        <ActivityIndicator size="small" color={ACCENT} />
      ) : (
        <Ionicons name="refresh" size={isMobile ? 18 : 16} color="#8a8a8a" />
      )}
    </Pressable>
  );

  if (!session?.token) {
    return (
      <View style={[styles.body, isMobile && styles.bodyMobile]}>
        <Text style={styles.hint}>
          Sign in to load Google reviews for each store.{' '}
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
    <View style={[styles.body, isMobile && styles.bodyMobile]}>
      {isMobile ? (
        <View style={styles.mobileSummary}>
          <Text style={styles.mobileSummaryText} numberOfLines={2}>
            {summaryLine}
          </Text>
          {refreshButton}
        </View>
      ) : (
        <View style={styles.toolbar}>
          <View style={styles.toolbarCopy}>
            <Text style={styles.toolbarTitle}>Google reviews</Text>
            <Text style={styles.toolbarSub}>{summaryLine}</Text>
          </View>
          {refreshButton}
        </View>
      )}

      {error ? (
        <View style={[styles.errorBanner, isMobile && styles.errorBannerMobile]}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      <View style={[styles.periodBar, isMobile && styles.periodBarMobile]}>
        <View style={[styles.monthNav, isMobile && styles.monthNavMobile]}>
          <Pressable
            style={[styles.monthBtn, isMobile && styles.monthBtnMobile]}
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
            <Text style={[styles.monthLabel, isMobile && styles.monthLabelMobile]} numberOfLines={1}>
              {allTime ? 'All time' : selectedMonth.label}
            </Text>
            <Text style={styles.monthSub} numberOfLines={1}>
              {allTime
                ? 'Every Google review'
                : isFullMonth
                  ? isCurrentMonth
                    ? 'Current month'
                    : 'Selected month'
                  : periodLabel}
            </Text>
          </Pressable>
          <Pressable
            style={[
              styles.monthBtn,
              isMobile && styles.monthBtnMobile,
              !canGoForward && styles.monthBtnDisabled,
            ]}
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
        <View style={[styles.periodTools, isMobile && styles.periodToolsMobile]}>
          <View style={[styles.periodPicker, isMobile && styles.periodPickerMobile]}>
            <HomeDatePicker
              startDate={startDate}
              endDate={endDate}
              dateMode={allTime ? 'range' : dateMode}
              onChange={({ mode, start: nextStart, end: nextEnd }) =>
                applyPeriod(nextStart, nextEnd, mode)
              }
              maximumDate={new Date()}
              compact
              fill
            />
          </View>
          {!allTime ? (
            <Pressable
              style={[styles.chip, isMobile && styles.chipMobile]}
              onPress={() => applyPeriod(null, null, 'all')}
              accessibilityRole="button"
              accessibilityLabel="Show all reviews"
            >
              <Text style={styles.chipText}>All time</Text>
            </Pressable>
          ) : null}
          {!isCurrentMonth || allTime ? (
            <Pressable
              style={[styles.chip, isMobile && styles.chipMobile]}
              onPress={goToCurrentMonth}
              accessibilityRole="button"
              accessibilityLabel="Jump to this month"
            >
              <Text style={styles.chipText}>This month</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, isMobile && styles.scrollContentMobile]}
        showsVerticalScrollIndicator={false}
      >
        {isMobile && results.length > 1 ? null : storeChips}
        {ratingChips}

        {isMobile && results.length > 1 ? (
          <ScrollView
            horizontal
            nestedScrollEnabled
            showsHorizontalScrollIndicator={false}
            style={styles.hScroll}
            contentContainerStyle={styles.storeStrip}
          >
            {results.map((store) => (
              <StoreCard
                key={store.storeName}
                store={store}
                compact
                selected={selectedStore === store.storeName}
                onPress={() =>
                  setSelectedStore((current) =>
                    current === store.storeName && !storeFilter ? null : store.storeName,
                  )
                }
              />
            ))}
          </ScrollView>
        ) : (
          <View style={[styles.storeGrid, isMobile && styles.paddedBlock]}>
            {visibleStores.map((store) => (
              <StoreCard
                key={store.storeName}
                store={store}
                fill={isMobile}
                selected={selectedStore === store.storeName}
                onPress={() =>
                  setSelectedStore((current) =>
                    current === store.storeName && !storeFilter ? null : store.storeName,
                  )
                }
              />
            ))}
          </View>
        )}

        {stillLoading && !combined.count ? (
          <View style={[styles.loadingBlock, isMobile && styles.paddedBlock]}>
            <ActivityIndicator color={ACCENT} />
            <Text style={styles.loadingText}>Loading {periodLabel}…</Text>
          </View>
        ) : null}

        <View style={[styles.detailHeader, isMobile && styles.paddedBlock]}>
          <Text style={styles.sectionTitle}>
            {selectedStore || 'All stores'}
          </Text>
          <Text style={styles.sectionHint}>
            {feed.length} shown · {periodLabel}
            {ratingFilter ? ` · ${ratingFilter}★` : ''}
            {needsReplyOnly ? ' · unreplied' : ''}
          </Text>
        </View>

        {feed.length ? (
          <View style={[styles.reviewList, isMobile && styles.paddedBlock]}>
            {feed.map(({ review, storeName }) => (
              <ReviewCard
                key={`${storeName}-${review.id}`}
                review={review}
                storeName={storeName}
                compact={isMobile}
                showStore={!selectedStore && results.length > 1}
                session={session}
                onOpenCustomer={onOpenCustomer}
              />
            ))}
          </View>
        ) : stillLoading ? null : (
          <View style={[styles.emptyBlock, isMobile && styles.paddedBlock]}>
            <Text style={styles.emptyText}>
              No reviews in {periodLabel}
              {ratingFilter || needsReplyOnly ? ' match these filters' : ''}.
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    minHeight: 0,
  },
  bodyMobile: {
    backgroundColor: '#fff',
    ...Platform.select({
      web: { overflowX: 'hidden' },
      default: {},
    }),
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
  toolbarCopy: {
    flex: 1,
  },
  toolbarTitle: {
    fontFamily,
    fontSize: 16,
    fontWeight: '700',
    color: '#1a1a1a',
  },
  toolbarSub: {
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
  refreshMobile: {
    width: 44,
    height: 44,
  },
  mobileSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 8,
  },
  mobileSummaryText: {
    flex: 1,
    minWidth: 0,
    fontFamily,
    fontSize: 13,
    lineHeight: 18,
    color: '#8a8a8a',
  },
  errorBanner: {
    marginHorizontal: 16,
    marginTop: 10,
    padding: 10,
    borderRadius: 8,
    backgroundColor: '#FEF2F2',
  },
  errorBannerMobile: {
    marginTop: 0,
    marginBottom: 4,
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
  scrollContentMobile: {
    paddingHorizontal: 0,
    paddingTop: 12,
    paddingBottom: 28,
    gap: 12,
  },
  periodBar: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e8e8e8',
  },
  periodBarMobile: {
    flexDirection: 'column',
    alignItems: 'stretch',
    flexWrap: 'nowrap',
    gap: 10,
    paddingTop: 4,
    paddingBottom: 12,
  },
  monthNav: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexGrow: 1,
    minWidth: 220,
  },
  monthNavMobile: {
    minWidth: 0,
    width: '100%',
    flexGrow: 0,
  },
  monthLabelWrap: {
    flex: 1,
    paddingHorizontal: 8,
  },
  monthLabel: {
    fontFamily,
    fontSize: 15,
    fontWeight: '700',
    color: '#1a1a1a',
  },
  monthLabelMobile: {
    fontSize: 17,
  },
  monthSub: {
    fontFamily,
    fontSize: 11,
    color: '#8a8a8a',
    marginTop: 1,
  },
  periodTools: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    flexGrow: 1,
  },
  periodToolsMobile: {
    flexWrap: 'nowrap',
    width: '100%',
  },
  periodPicker: {
    minWidth: 168,
    maxWidth: 240,
    flexGrow: 1,
  },
  periodPickerMobile: {
    minWidth: 0,
    maxWidth: '100%',
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
  monthBtnMobile: {
    width: 44,
    height: 44,
  },
  monthBtnDisabled: {
    opacity: 0.5,
  },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  hScroll: {
    flexGrow: 0,
  },
  chipRowMobile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: '#f3f3f3',
  },
  chipMobile: {
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  chipActive: {
    backgroundColor: '#1a1a1a',
  },
  chipText: {
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
    color: '#4a4a4a',
  },
  chipTextActive: {
    color: '#fff',
  },
  storeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  storeStrip: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 10,
    paddingHorizontal: 16,
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
  storeCardCompact: {
    width: 156,
    maxWidth: 156,
    flexGrow: 0,
    flexShrink: 0,
    padding: 12,
  },
  storeCardFill: {
    maxWidth: '100%',
  },
  storeCardSelected: {
    borderColor: ACCENT,
    backgroundColor: '#FFFEF7',
  },
  storeCardNameCompact: {
    fontSize: 14,
  },
  storeAverageCompact: {
    fontSize: 24,
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
  storeAverage: {
    fontFamily,
    fontSize: 28,
    fontWeight: '800',
    color: '#1a1a1a',
    letterSpacing: -0.5,
  },
  storeAverageLabel: {
    fontFamily,
    fontSize: 12,
    color: '#7a7a7a',
    marginBottom: 8,
  },
  storeError: {
    fontFamily,
    fontSize: 12,
    color: '#B91C1C',
    marginBottom: 6,
  },
  ratingBreakdown: {
    gap: 5,
    marginTop: 4,
  },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  ratingStarLabel: {
    fontFamily,
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
    fontFamily,
    fontSize: 11,
    color: '#6a6a6a',
    width: 24,
    textAlign: 'right',
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
  detailHeader: {
    gap: 2,
    marginTop: 4,
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
  reviewRowCompact: {
    padding: 14,
    gap: 8,
  },
  reviewRowNegative: {
    borderColor: '#F0D6D6',
    backgroundColor: '#FFF8F8',
  },
  reviewTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  reviewTopCompact: {
    alignItems: 'flex-start',
  },
  paddedBlock: {
    paddingHorizontal: 16,
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
    fontFamily,
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
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  reviewStars: {
    fontFamily,
    fontSize: 12,
    color: ACCENT,
    fontWeight: '700',
  },
  reviewWhen: {
    fontFamily,
    fontSize: 11,
    color: '#9a9a9a',
  },
  reviewWhenCompact: {
    maxWidth: 92,
    textAlign: 'right',
    lineHeight: 14,
    flexShrink: 0,
  },
  reviewStore: {
    fontFamily,
    fontSize: 11,
    fontWeight: '600',
    color: '#7A4E03',
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
  flagReplied: {
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
  flagUnreplied: {
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
  ownerReply: {
    backgroundColor: '#f6f6f6',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 2,
  },
  ownerReplyLabel: {
    fontFamily,
    fontSize: 11,
    fontWeight: '700',
    color: '#6a6a6a',
  },
  ownerReplyText: {
    fontFamily,
    fontSize: 12,
    lineHeight: 17,
    color: '#3a3a3a',
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
});
