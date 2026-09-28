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
import { useAppAccess } from '../lib/permissions';
import {
  GOOGLE_STORE_PLACES,
  currentReviewMonth,
  fetchAllGoogleStoreReviews,
  reviewMonthRange,
  reviewPeriodLabel,
  summarizeReviews,
} from '../lib/googleReviews';
import { formatDateParam, parseDateParam } from '../lib/transactions';
import HomeDatePicker from './HomeDatePicker';

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

function StoreCard({ store, selected, onPress }) {
  const summary = summarizeReviews(store.reviews);
  return (
    <Pressable
      onPress={onPress}
      style={[styles.storeCard, selected && styles.storeCardSelected]}
    >
      <View style={styles.storeCardTop}>
        <Text style={styles.storeCardName} numberOfLines={1}>
          {store.storeName}
        </Text>
        {store.place ? (
          <View style={styles.liveBadge}>
            <Ionicons name="logo-google" size={11} color="#1a1a1a" />
            <Text style={styles.liveBadgeText}>Google</Text>
          </View>
        ) : (
          <Text style={styles.mutedBadge}>No Google link</Text>
        )}
      </View>
      <Text style={styles.storeAverage}>
        {summary.count ? formatAverage(summary.average) : '—'}
      </Text>
      <Text style={styles.storeAverageLabel}>
        {summary.count} review{summary.count === 1 ? '' : 's'}
        {store.loading ? ' · loading…' : ''}
      </Text>
      {store.error ? <Text style={styles.storeError}>{store.error}</Text> : null}
      <RatingBreakdown breakdown={summary.breakdown} total={summary.count} />
    </Pressable>
  );
}

function ReviewCard({ review, storeName, showStore }) {
  return (
    <View
      style={[
        styles.reviewRow,
        review.rating <= 2 && styles.reviewRowNegative,
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

export default function ReviewsScreen({ session, onRequireLogin, storeFilter }) {
  const { canFilter } = useAppAccess();
  const allowFilters = canFilter('reviews');
  const initialPeriod = useMemo(() => currentReviewMonth(), []);
  const [startDate, setStartDate] = useState(initialPeriod.startDate);
  const [endDate, setEndDate] = useState(initialPeriod.endDate);
  const [dateMode, setDateMode] = useState('range');
  const [selectedStore, setSelectedStore] = useState(storeFilter || null);
  const [ratingFilter, setRatingFilter] = useState(0);
  const [needsReplyOnly, setNeedsReplyOnly] = useState(false);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const requestId = useRef(0);
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
      setSelectedStore(storeFilter);
      return;
    }
    if (!allowFilters) setSelectedStore(null);
  }, [allowFilters, storeFilter]);

  const load = useCallback(async () => {
    if (!session?.token) {
      setResults([]);
      setError('');
      return;
    }

    const id = ++requestId.current;
    const places = storeFilter
      ? GOOGLE_STORE_PLACES.filter(
          (place) => place.storeName.toLowerCase() === String(storeFilter).trim().toLowerCase(),
        )
      : GOOGLE_STORE_PLACES;

    setLoading(true);
    setError('');
    setResults(
      places.map((place) => ({
        storeName: place.storeName,
        place,
        reviews: [],
        error: '',
        loading: true,
      })),
    );

    try {
      const next = await fetchAllGoogleStoreReviews({
        storeName: storeFilter || undefined,
        startDate,
        endDate,
        onPage: ({ storeName, reviews, done }) => {
          if (id !== requestId.current) return;
          setResults((current) =>
            current.map((row) =>
              row.storeName === storeName
                ? { ...row, reviews, loading: !done }
                : row,
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
  }, [session?.token, storeFilter, startDate, endDate]);

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
    const startKey = formatDateParam(nextStart);
    const endKey = formatDateParam(nextEnd || nextStart);
    setStartDate(startKey);
    setEndDate(endKey);
    setDateMode(mode === 'day' || startKey === endKey ? 'day' : 'range');
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

  if (!session?.token) {
    return (
      <View style={styles.body}>
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
    <View style={styles.body}>
      <View style={styles.toolbar}>
        <View style={styles.toolbarCopy}>
          <Text style={styles.toolbarTitle}>Google reviews</Text>
          <Text style={styles.toolbarSub}>
            {combined.count
              ? `${formatAverage(combined.average)} average · ${combined.count} in ${periodLabel}`
              : stillLoading
                ? `Loading ${periodLabel} from Google…`
                : `No reviews in ${periodLabel}`}
          </Text>
        </View>
        <Pressable style={styles.refresh} onPress={load} hitSlop={8}>
          {stillLoading ? (
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

      <View style={styles.periodBar}>
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
              {isFullMonth
                ? isCurrentMonth
                  ? 'Current month'
                  : 'Selected month'
                : periodLabel}
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
        <View style={styles.periodPicker}>
          <HomeDatePicker
            startDate={startDate}
            endDate={endDate}
            dateMode={dateMode}
            onChange={({ mode, start: nextStart, end: nextEnd }) =>
              applyPeriod(nextStart, nextEnd, mode)
            }
            maximumDate={new Date()}
            compact
            fill
          />
        </View>
        {!isCurrentMonth ? (
          <Pressable style={styles.chip} onPress={goToCurrentMonth}>
            <Text style={styles.chipText}>This month</Text>
          </Pressable>
        ) : null}
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {allowFilters && !storeFilter ? (
          <View style={styles.filterRow}>
            <Pressable
              style={[styles.chip, !selectedStore && styles.chipActive]}
              onPress={() => setSelectedStore(null)}
            >
              <Text style={[styles.chipText, !selectedStore && styles.chipTextActive]}>
                All stores
              </Text>
            </Pressable>
            {GOOGLE_STORE_PLACES.map((place) => (
              <Pressable
                key={place.storeName}
                style={[styles.chip, selectedStore === place.storeName && styles.chipActive]}
                onPress={() =>
                  setSelectedStore((current) =>
                    current === place.storeName ? null : place.storeName,
                  )
                }
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
          </View>
        ) : null}

        <View style={styles.filterRow}>
          <Pressable
            style={[styles.chip, ratingFilter === 0 && styles.chipActive]}
            onPress={() => setRatingFilter(0)}
          >
            <Text style={[styles.chipText, ratingFilter === 0 && styles.chipTextActive]}>
              All ratings
            </Text>
          </Pressable>
          {[5, 4, 3, 2, 1].map((star) => (
            <Pressable
              key={star}
              style={[styles.chip, ratingFilter === star && styles.chipActive]}
              onPress={() => setRatingFilter((current) => (current === star ? 0 : star))}
            >
              <Text style={[styles.chipText, ratingFilter === star && styles.chipTextActive]}>
                {star}★
              </Text>
            </Pressable>
          ))}
          <Pressable
            style={[styles.chip, needsReplyOnly && styles.chipActive]}
            onPress={() => setNeedsReplyOnly((current) => !current)}
          >
            <Text style={[styles.chipText, needsReplyOnly && styles.chipTextActive]}>
              Needs reply
            </Text>
          </Pressable>
        </View>

        <View style={styles.storeGrid}>
          {visibleStores.map((store) => (
            <StoreCard
              key={store.storeName}
              store={store}
              selected={selectedStore === store.storeName}
              onPress={() =>
                setSelectedStore((current) =>
                  current === store.storeName && !storeFilter ? null : store.storeName,
                )
              }
            />
          ))}
        </View>

        {stillLoading && !combined.count ? (
          <View style={styles.loadingBlock}>
            <ActivityIndicator color={ACCENT} />
            <Text style={styles.loadingText}>Loading {periodLabel}…</Text>
          </View>
        ) : null}

        <View style={styles.detailHeader}>
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
          <View style={styles.reviewList}>
            {feed.map(({ review, storeName }) => (
              <ReviewCard
                key={`${storeName}-${review.id}`}
                review={review}
                storeName={storeName}
                showStore={!selectedStore && results.length > 1}
              />
            ))}
          </View>
        ) : stillLoading ? null : (
          <View style={styles.emptyBlock}>
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
  monthNav: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexGrow: 1,
    minWidth: 220,
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
  monthSub: {
    fontFamily,
    fontSize: 11,
    color: '#8a8a8a',
    marginTop: 1,
  },
  periodPicker: {
    minWidth: 168,
    maxWidth: 240,
    flexGrow: 1,
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
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: '#f3f3f3',
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
  storeCardSelected: {
    borderColor: ACCENT,
    backgroundColor: '#FFFEF7',
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
  reviewRowNegative: {
    borderColor: '#F0D6D6',
    backgroundColor: '#FFF8F8',
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
