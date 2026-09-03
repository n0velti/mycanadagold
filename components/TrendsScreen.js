import { createElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import {
  METALS,
  METAL_COLORS,
  fetchMetalTrends,
  formatPureGrams,
} from '../api/metalTrends';
import {
  defaultDateRange,
  formatDateParam,
  formatPickerDate,
  parseDateParam,
} from '../api/transactions';

const fontFamily = Platform.select({
  ios: 'Sohne',
  android: 'Sohne',
  default: 'Sohne',
});

const ACCENT = '#5A4FC7';
const CHART_HALF = 140;
const Y_TICKS = 4;

function DateChip({ label, value, onChange, minimumDate, maximumDate }) {
  const [open, setOpen] = useState(false);
  const dateValue = parseDateParam(value);

  const commit = (next) => {
    if (!next) return;
    let date = parseDateParam(next);
    if (minimumDate && date < parseDateParam(minimumDate)) {
      date = parseDateParam(minimumDate);
    }
    if (maximumDate && date > parseDateParam(maximumDate)) {
      date = parseDateParam(maximumDate);
    }
    onChange(date);
  };

  if (Platform.OS === 'web') {
    return (
      <View style={styles.dateChip}>
        <Text style={styles.dateChipLabel}>{label}</Text>
        <View style={styles.dateChipControl}>
          <Ionicons name="calendar-outline" size={14} color="#6b6b6b" />
          {createElement('input', {
            type: 'date',
            value: formatDateParam(dateValue),
            min: minimumDate ? formatDateParam(minimumDate) : undefined,
            max: maximumDate ? formatDateParam(maximumDate) : undefined,
            onChange: (event) => {
              if (event.target.value) commit(event.target.value);
            },
            style: {
              border: 'none',
              background: 'transparent',
              fontFamily,
              fontSize: 13,
              color: '#1a1a1a',
              padding: 0,
              margin: 0,
              outline: 'none',
              cursor: 'pointer',
              minWidth: 118,
            },
          })}
        </View>
      </View>
    );
  }

  return (
    <>
      <Pressable style={styles.dateChip} onPress={() => setOpen(true)}>
        <Text style={styles.dateChipLabel}>{label}</Text>
        <View style={styles.dateChipControl}>
          <Ionicons name="calendar-outline" size={14} color="#6b6b6b" />
          <Text style={styles.dateChipValue}>{formatPickerDate(dateValue)}</Text>
        </View>
      </Pressable>

      {Platform.OS === 'android' && open ? (
        <DateTimePicker
          value={dateValue}
          mode="date"
          display="default"
          minimumDate={minimumDate ? parseDateParam(minimumDate) : undefined}
          maximumDate={maximumDate ? parseDateParam(maximumDate) : undefined}
          onChange={(event, selected) => {
            setOpen(false);
            if (event.type !== 'dismissed' && selected) commit(selected);
          }}
        />
      ) : null}

      {Platform.OS === 'ios' ? (
        <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
          <View style={styles.dateModalBackdrop}>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setOpen(false)} />
            <View style={styles.dateModalCard}>
              <View style={styles.dateModalHeader}>
                <Text style={styles.dateModalTitle}>{label}</Text>
                <Pressable onPress={() => setOpen(false)} hitSlop={8}>
                  <Text style={styles.dateModalDone}>Done</Text>
                </Pressable>
              </View>
              <DateTimePicker
                value={dateValue}
                mode="date"
                display="spinner"
                minimumDate={minimumDate ? parseDateParam(minimumDate) : undefined}
                maximumDate={maximumDate ? parseDateParam(maximumDate) : undefined}
                onChange={(_, selected) => {
                  if (selected) commit(selected);
                }}
              />
            </View>
          </View>
        </Modal>
      ) : null}
    </>
  );
}

function shortDateLabel(dateKey) {
  const date = parseDateParam(dateKey);
  return date.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
}

function StackedBar({ values, maxValue, direction }) {
  const segments = METALS.map((metal) => ({
    metal,
    grams: Number(values[metal]) || 0,
  })).filter((segment) => segment.grams > 0);

  const total = segments.reduce((sum, segment) => sum + segment.grams, 0);
  if (!(total > 0) || !(maxValue > 0)) {
    return <View style={[styles.barColumn, { height: 0 }]} />;
  }

  // Explicit pixel heights so each metal color always paints (flex can collapse on web).
  const rawHeights = segments.map((segment) => (segment.grams / maxValue) * CHART_HALF);
  const rawTotal = rawHeights.reduce((sum, h) => sum + h, 0);
  const minSeg = segments.length > 1 ? 4 : 3;
  let heights = rawHeights.map((h) => Math.max(h, minSeg));
  const boosted = heights.reduce((sum, h) => sum + h, 0);
  if (boosted > CHART_HALF && rawTotal > 0) {
    const scale = CHART_HALF / boosted;
    heights = heights.map((h) => Math.max(h * scale, 2));
  }

  // Sold: Gold at bottom (nearest zero). Bought: Gold at top (nearest zero).
  const ordered =
    direction === 'down'
      ? segments.map((segment, i) => ({ ...segment, height: heights[i] }))
      : segments
          .map((segment, i) => ({ ...segment, height: heights[i] }))
          .reverse();

  return (
    <View
      style={[
        styles.barColumn,
        direction === 'down' && styles.barColumnDown,
      ]}
    >
      {ordered.map((segment, index) => (
        <View
          key={segment.metal}
          style={[
            styles.barSegment,
            {
              height: segment.height,
              backgroundColor: METAL_COLORS[segment.metal],
            },
            index > 0 && styles.barSegmentGap,
          ]}
          accessibilityLabel={`${segment.metal} ${formatPureGrams(segment.grams)}`}
        />
      ))}
    </View>
  );
}

function DayMetalChips({ values }) {
  const active = METALS.filter((metal) => (Number(values[metal]) || 0) > 0);
  if (!active.length) {
    return <Text style={styles.chipEmpty}>—</Text>;
  }
  return (
    <View style={styles.chipRow}>
      {active.map((metal) => (
        <View key={metal} style={styles.chip}>
          <View style={[styles.chipSwatch, { backgroundColor: METAL_COLORS[metal] }]} />
          <Text style={[styles.chipText, { color: METAL_COLORS[metal] }]}>
            {metal === 'Gold' ? 'Au' : metal === 'Silver' ? 'Ag' : metal === 'Platinum' ? 'Pt' : 'Pd'}{' '}
            {formatPureGrams(values[metal], { digits: 1 }).replace(' g', '')}
          </Text>
        </View>
      ))}
    </View>
  );
}

function MetalFlowChart({ days, selectedDate, onSelectDay }) {
  const maxValue = useMemo(() => {
    let max = 0;
    for (const day of days) {
      max = Math.max(max, day.soldTotal || 0, day.boughtTotal || 0);
    }
    if (max <= 0) return 1;
    // Nice round ceiling
    const magnitude = 10 ** Math.floor(Math.log10(max));
    return Math.ceil(max / magnitude) * magnitude;
  }, [days]);

  const yLabels = useMemo(() => {
    const labels = [];
    for (let i = Y_TICKS; i >= 1; i -= 1) {
      labels.push((maxValue * i) / Y_TICKS);
    }
    labels.push(0);
    for (let i = 1; i <= Y_TICKS; i += 1) {
      labels.push((maxValue * i) / Y_TICKS);
    }
    return labels;
  }, [maxValue]);

  return (
    <View style={styles.chartRoot}>
      <View style={styles.chartYAxis}>
        <Text style={styles.chartAxisTitle}>Sold</Text>
        {yLabels.map((value, index) => {
          const isZero = value === 0 && index === Y_TICKS;
          const isBuySide = index > Y_TICKS;
          return (
            <Text
              key={`${index}-${value}`}
              style={[
                styles.yTick,
                isZero && styles.yTickZero,
                isBuySide && styles.yTickBuy,
              ]}
            >
              {isBuySide ? `−${formatPureGrams(value, { digits: 0 })}` : formatPureGrams(value, { digits: 0 })}
            </Text>
          );
        })}
        <Text style={[styles.chartAxisTitle, styles.chartAxisTitleBuy]}>Bought</Text>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.chartScroll}
        contentContainerStyle={styles.chartScrollContent}
      >
        <View style={styles.chartPlot}>
          <View style={[styles.plotHalf, { height: CHART_HALF }]}>
            <View style={styles.gridLines}>
              {Array.from({ length: Y_TICKS }, (_, i) => (
                <View key={`sg-${i}`} style={styles.gridLine} />
              ))}
            </View>
            <View style={styles.barsRow}>
              {days.map((day) => {
                const selected = selectedDate === day.date;
                return (
                  <Pressable
                    key={`sold-${day.date}`}
                    style={[styles.daySlot, selected && styles.daySlotSelected]}
                    onPress={() => onSelectDay(day.date)}
                  >
                    <View style={styles.barAnchorTop}>
                      <StackedBar values={day.sold} maxValue={maxValue} direction="up" />
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={styles.zeroLine} />

          <View style={[styles.plotHalf, { height: CHART_HALF }]}>
            <View style={styles.gridLines}>
              {Array.from({ length: Y_TICKS }, (_, i) => (
                <View key={`bg-${i}`} style={styles.gridLine} />
              ))}
            </View>
            <View style={styles.barsRow}>
              {days.map((day) => {
                const selected = selectedDate === day.date;
                return (
                  <Pressable
                    key={`bought-${day.date}`}
                    style={[styles.daySlot, selected && styles.daySlotSelected]}
                    onPress={() => onSelectDay(day.date)}
                  >
                    <View style={styles.barAnchorBottom}>
                      <StackedBar values={day.bought} maxValue={maxValue} direction="down" />
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={styles.xLabels}>
            {days.map((day) => (
              <Pressable
                key={`x-${day.date}`}
                style={[styles.xLabelSlot, selectedDate === day.date && styles.daySlotSelected]}
                onPress={() => onSelectDay(day.date)}
              >
                <Text
                  style={[
                    styles.xLabel,
                    selectedDate === day.date && styles.xLabelSelected,
                  ]}
                  numberOfLines={1}
                >
                  {shortDateLabel(day.date)}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

function SelectedDayBreakdown({ day }) {
  if (!day) return null;
  return (
    <View style={styles.breakdownCard}>
      <Text style={styles.breakdownTitle}>
        {formatPickerDate(parseDateParam(day.date))} · metal colors in each bar
      </Text>
      <View style={styles.breakdownCols}>
        <View style={styles.breakdownCol}>
          <Text style={styles.breakdownSide}>Sold (above 0)</Text>
          {METALS.map((metal) => (
            <View key={`bs-${metal}`} style={styles.breakdownRow}>
              <View style={[styles.breakdownBar, { backgroundColor: METAL_COLORS[metal] }]} />
              <Text style={styles.breakdownMetal}>{metal}</Text>
              <Text style={styles.breakdownGrams}>{formatPureGrams(day.sold[metal])}</Text>
            </View>
          ))}
        </View>
        <View style={styles.breakdownCol}>
          <Text style={styles.breakdownSide}>Bought (below 0)</Text>
          {METALS.map((metal) => (
            <View key={`bb-${metal}`} style={styles.breakdownRow}>
              <View style={[styles.breakdownBar, { backgroundColor: METAL_COLORS[metal] }]} />
              <Text style={styles.breakdownMetal}>{metal}</Text>
              <Text style={styles.breakdownGrams}>{formatPureGrams(day.bought[metal])}</Text>
            </View>
          ))}
        </View>
      </View>
      <View style={styles.breakdownChips}>
        <Text style={styles.breakdownChipLabel}>Sold</Text>
        <DayMetalChips values={day.sold} />
        <Text style={[styles.breakdownChipLabel, styles.breakdownChipLabelBuy]}>Bought</Text>
        <DayMetalChips values={day.bought} />
      </View>
    </View>
  );
}

function TotalsStrip({ totals }) {
  if (!totals) return null;
  return (
    <View style={styles.totalsRow}>
      <View style={styles.totalCard}>
        <Text style={styles.totalLabel}>Sold (pure)</Text>
        <Text style={styles.totalValue}>{formatPureGrams(totals.soldTotal)}</Text>
        <View style={styles.totalMetals}>
          {METALS.map((metal) => (
            <Text key={`s-${metal}`} style={[styles.totalMetal, { color: METAL_COLORS[metal] }]}>
              {metal.slice(0, 2)} {formatPureGrams(totals.sold[metal], { digits: 1 })}
            </Text>
          ))}
        </View>
      </View>
      <View style={styles.totalCard}>
        <Text style={styles.totalLabel}>Bought (pure)</Text>
        <Text style={styles.totalValue}>{formatPureGrams(totals.boughtTotal)}</Text>
        <View style={styles.totalMetals}>
          {METALS.map((metal) => (
            <Text key={`b-${metal}`} style={[styles.totalMetal, { color: METAL_COLORS[metal] }]}>
              {metal.slice(0, 2)} {formatPureGrams(totals.bought[metal], { digits: 1 })}
            </Text>
          ))}
        </View>
      </View>
    </View>
  );
}

export default function TrendsScreen({ session, onRequireLogin, storeFilter }) {
  const initialRange = useMemo(() => defaultDateRange(7), []);
  const lockedStore = Boolean(storeFilter);
  const [dateMode, setDateMode] = useState('day');
  const [startDate, setStartDate] = useState(() => parseDateParam(new Date()));
  const [endDate, setEndDate] = useState(() => parseDateParam(new Date()));
  const [selectedStore, setSelectedStore] = useState(storeFilter || null);
  const [storeNames, setStoreNames] = useState([]);
  const [days, setDays] = useState([]);
  const [totals, setTotals] = useState(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [selectedDate, setSelectedDate] = useState(null);
  const requestId = useRef(0);
  const rangeKeyRef = useRef('');

  const todayKey = formatDateParam(parseDateParam(new Date()));
  const startKey = formatDateParam(startDate);
  const endKey = dateMode === 'day' ? startKey : formatDateParam(endDate);
  const isToday = dateMode === 'day' && startKey === todayKey;
  const activeStore = lockedStore ? storeFilter : selectedStore;

  useEffect(() => {
    if (storeFilter) setSelectedStore(storeFilter);
  }, [storeFilter]);

  const load = useCallback(async () => {
    if (!session?.token) {
      setDays([]);
      setTotals(null);
      setStoreNames([]);
      setError('');
      setWarning('');
      setProgress(null);
      setSelectedDate(null);
      return;
    }

    const id = ++requestId.current;
    const nextRangeKey = `${startKey}|${endKey}`;
    const rangeChanged = rangeKeyRef.current !== nextRangeKey;
    rangeKeyRef.current = nextRangeKey;

    setLoading(true);
    setError('');
    setWarning('');
    setProgress({ scanned: 0, total: 0 });
    // Keep prior chart visible when only the store filter changes (cache hit is usually instant).
    if (rangeChanged) {
      setDays([]);
      setTotals(null);
    }

    try {
      const result = await fetchMetalTrends(session, {
        startDate: startKey,
        endDate: endKey,
        storeName: activeStore || undefined,
        onProgress: (next) => {
          if (id !== requestId.current) return;
          setProgress(next);
        },
        onPartial: (partial) => {
          if (id !== requestId.current) return;
          setDays(partial.days);
          setTotals(partial.totals);
          setWarning(partial.warning || '');
          if (Array.isArray(partial.storeNames) && partial.storeNames.length) {
            setStoreNames(partial.storeNames);
          }
        },
      });
      if (id !== requestId.current) return;
      setDays(result.days);
      setTotals(result.totals);
      setWarning(result.warning || '');
      if (Array.isArray(result.storeNames)) setStoreNames(result.storeNames);
      setSelectedDate((current) => {
        if (current && result.days.some((day) => day.date === current)) return current;
        return result.days.length ? result.days[result.days.length - 1].date : null;
      });
    } catch (err) {
      if (id !== requestId.current) return;
      setDays([]);
      setTotals(null);
      setError(err?.message || 'Failed to load metal trends.');
    } finally {
      if (id === requestId.current) {
        setLoading(false);
        setProgress(null);
      }
    }
  }, [session, startKey, endKey, activeStore]);

  useEffect(() => {
    load();
  }, [load]);

  const selectToday = () => {
    const day = parseDateParam(new Date());
    setDateMode('day');
    setStartDate(day);
    setEndDate(day);
  };

  const selectRange = () => {
    setDateMode('range');
    if (formatDateParam(startDate) === formatDateParam(endDate)) {
      setStartDate(initialRange.start);
      setEndDate(initialRange.end);
    }
  };

  const handleDayChange = (date) => {
    const next = parseDateParam(date);
    setStartDate(next);
    setEndDate(next);
  };

  const handleStartChange = (date) => {
    const next = parseDateParam(date);
    setStartDate(next);
    if (next > endDate) setEndDate(next);
  };

  const handleEndChange = (date) => {
    const next = parseDateParam(date);
    setEndDate(next);
    if (next < startDate) setStartDate(next);
  };

  const selectedDay = useMemo(
    () => days.find((day) => day.date === selectedDate) || null,
    [days, selectedDate],
  );

  if (!session?.token) {
    return (
      <View style={styles.body}>
        <Text style={styles.loginHint}>
          Sign in from Profile to load pure metal buy/sell trends.
        </Text>
        <Pressable style={styles.loginButton} onPress={onRequireLogin}>
          <Text style={styles.loginButtonText}>Go to Profile</Text>
        </Pressable>
      </View>
    );
  }

  const progressLabel =
    loading && progress && progress.total > 0
      ? `Scanning ${progress.scanned}/${progress.total} txs${
          progress.pending != null && progress.pending > 0 && progress.scanned < progress.total
            ? ` · ${progress.pending} left`
            : ''
        }…`
      : loading
        ? 'Loading sales & purchases…'
        : null;

  return (
    <View style={styles.body}>
      <View style={styles.toolbar}>
        <View style={styles.dateFilters}>
          <View style={styles.dateModeGroup}>
            <Pressable
              style={[styles.dateModeChip, dateMode === 'day' && isToday && styles.dateModeChipActive]}
              onPress={selectToday}
            >
              <Text
                style={[
                  styles.dateModeChipText,
                  dateMode === 'day' && isToday && styles.dateModeChipTextActive,
                ]}
              >
                Today
              </Text>
            </Pressable>
            <Pressable
              style={[styles.dateModeChip, dateMode === 'range' && styles.dateModeChipActive]}
              onPress={selectRange}
            >
              <Text
                style={[
                  styles.dateModeChipText,
                  dateMode === 'range' && styles.dateModeChipTextActive,
                ]}
              >
                Range
              </Text>
            </Pressable>
          </View>

          {dateMode === 'day' ? (
            <DateChip
              label="Date"
              value={startDate}
              onChange={handleDayChange}
              maximumDate={new Date()}
            />
          ) : (
            <>
              <DateChip
                label="From"
                value={startDate}
                onChange={handleStartChange}
                maximumDate={endDate}
              />
              <Text style={styles.dateRangeSep}>–</Text>
              <DateChip
                label="To"
                value={endDate}
                onChange={handleEndChange}
                minimumDate={startDate}
                maximumDate={new Date()}
              />
            </>
          )}
        </View>

        {!lockedStore ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.storeFilterScroll}
            contentContainerStyle={styles.storeFilterRow}
          >
            <Pressable
              style={[styles.storeChip, !activeStore && styles.storeChipActive]}
              onPress={() => setSelectedStore(null)}
            >
              <Text
                style={[styles.storeChipText, !activeStore && styles.storeChipTextActive]}
              >
                All stores
              </Text>
            </Pressable>
            {storeNames.map((name) => (
              <Pressable
                key={name}
                style={[styles.storeChip, activeStore === name && styles.storeChipActive]}
                onPress={() =>
                  setSelectedStore((current) => (current === name ? null : name))
                }
              >
                <Text
                  style={[
                    styles.storeChipText,
                    activeStore === name && styles.storeChipTextActive,
                  ]}
                >
                  {name}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}
      </View>

      <View style={styles.metaRow}>
        <Text style={styles.metaText}>
          {progressLabel ||
            (totals
              ? `Pure metal · sold ${formatPureGrams(totals.soldTotal)} · bought ${formatPureGrams(totals.boughtTotal)}`
              : '—')}
          {activeStore ? ` · ${activeStore}` : ' · all stores'}
          {dateMode === 'day'
            ? isToday
              ? ' · today'
              : ` · ${formatPickerDate(startDate)}`
            : ` · ${formatPickerDate(startDate)} – ${formatPickerDate(endDate)}`}
        </Text>
      </View>

      <View style={styles.legend}>
        {METALS.map((metal) => (
          <View key={metal} style={styles.legendItem}>
            <View style={[styles.legendSwatch, { backgroundColor: METAL_COLORS[metal] }]} />
            <Text style={[styles.legendText, { color: METAL_COLORS[metal] }]}>{metal}</Text>
          </View>
        ))}
        <Text style={styles.legendHint}>
          Each bar stacks Au · Ag · Pt · Pd by color · above = sold · below = bought
        </Text>
      </View>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      {warning && !error ? <Text style={styles.warningText}>{warning}</Text> : null}

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {loading && days.length === 0 ? (
          <View style={styles.emptyBlock}>
            <ActivityIndicator color={ACCENT} />
            {progressLabel ? <Text style={styles.progressHint}>{progressLabel}</Text> : null}
          </View>
        ) : days.length === 0 ? (
          <View style={styles.emptyBlock}>
            <Text style={styles.emptyText}>No metal volume in this period.</Text>
          </View>
        ) : (
          <>
            <MetalFlowChart
              days={days}
              selectedDate={selectedDate}
              onSelectDay={setSelectedDate}
            />
            <SelectedDayBreakdown day={selectedDay} />
            <TotalsStrip totals={totals} />
          </>
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
  loginHint: {
    fontFamily,
    fontSize: 14,
    color: '#6b6b6b',
    marginBottom: 12,
  },
  loginButton: {
    alignSelf: 'flex-start',
    backgroundColor: '#1a1a1a',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
  },
  loginButtonText: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: '#fff',
  },
  toolbar: {
    marginBottom: 10,
    gap: 8,
  },
  dateFilters: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  storeFilterScroll: {
    flexGrow: 0,
  },
  storeFilterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingRight: 8,
  },
  storeChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: '#f3f3f3',
    minHeight: 32,
    justifyContent: 'center',
  },
  storeChipActive: {
    backgroundColor: '#F4F0FF',
  },
  storeChipText: {
    fontFamily,
    fontSize: 12,
    fontWeight: '500',
    color: '#6b6b6b',
  },
  storeChipTextActive: {
    color: ACCENT,
    fontWeight: '700',
  },
  dateModeGroup: {
    flexDirection: 'row',
    backgroundColor: '#f3f3f3',
    borderRadius: 8,
    padding: 2,
  },
  dateModeChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 6,
    minHeight: 30,
    justifyContent: 'center',
  },
  dateModeChipActive: {
    backgroundColor: '#F4F0FF',
  },
  dateModeChipText: {
    fontFamily,
    fontSize: 13,
    fontWeight: '500',
    color: '#6b6b6b',
  },
  dateModeChipTextActive: {
    color: ACCENT,
    fontWeight: '600',
  },
  dateRangeSep: {
    fontFamily,
    fontSize: 14,
    color: '#8a8a8a',
  },
  dateChip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e0e0e0',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: '#fff',
    minHeight: 40,
    justifyContent: 'center',
    gap: 2,
  },
  dateChipLabel: {
    fontFamily,
    fontSize: 10,
    fontWeight: '600',
    color: '#8a8a8a',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  dateChipControl: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dateChipValue: {
    fontFamily,
    fontSize: 13,
    color: '#1a1a1a',
    fontWeight: '500',
  },
  dateModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.28)',
    justifyContent: 'flex-end',
  },
  dateModalCard: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingBottom: 24,
  },
  dateModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 4,
  },
  dateModalTitle: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  dateModalDone: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: ACCENT,
  },
  metaRow: {
    marginBottom: 8,
  },
  metaText: {
    fontFamily,
    fontSize: 12,
    color: '#8a8a8a',
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 12,
    marginBottom: 10,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  legendText: {
    fontFamily,
    fontSize: 12,
    color: '#4a4a4a',
    fontWeight: '500',
  },
  legendHint: {
    fontFamily,
    fontSize: 11,
    color: '#8a8a8a',
  },
  swatch: {
    width: 10,
    height: 10,
    borderRadius: 2,
  },
  errorText: {
    fontFamily,
    fontSize: 13,
    color: '#b91c1c',
    marginBottom: 8,
  },
  warningText: {
    fontFamily,
    fontSize: 12,
    color: '#a16207',
    marginBottom: 8,
  },
  scroll: {
    flex: 1,
    minHeight: 0,
  },
  scrollContent: {
    paddingBottom: 28,
    gap: 16,
  },
  emptyBlock: {
    paddingVertical: 48,
    alignItems: 'center',
    gap: 10,
  },
  progressHint: {
    fontFamily,
    fontSize: 12,
    color: '#8a8a8a',
  },
  emptyText: {
    fontFamily,
    fontSize: 13,
    color: '#8a8a8a',
  },
  chartRoot: {
    flexDirection: 'row',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e8e8e8',
    borderRadius: 12,
    backgroundColor: '#fafafa',
    overflow: 'hidden',
    minHeight: CHART_HALF * 2 + 52,
  },
  chartYAxis: {
    width: 72,
    paddingVertical: 8,
    paddingHorizontal: 6,
    justifyContent: 'space-between',
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: '#e8e8e8',
    backgroundColor: '#fff',
  },
  chartAxisTitle: {
    fontFamily,
    fontSize: 10,
    fontWeight: '700',
    color: '#2F8A4E',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  chartAxisTitleBuy: {
    color: '#B45309',
  },
  yTick: {
    fontFamily,
    fontSize: 9,
    color: '#8a8a8a',
    textAlign: 'right',
  },
  yTickZero: {
    color: '#1a1a1a',
    fontWeight: '600',
  },
  yTickBuy: {
    color: '#a16207',
  },
  chartScroll: {
    flex: 1,
  },
  chartScrollContent: {
    paddingHorizontal: 8,
    paddingTop: 8,
    paddingBottom: 4,
    minWidth: '100%',
  },
  chartPlot: {
    minWidth: '100%',
  },
  plotHalf: {
    position: 'relative',
    justifyContent: 'flex-end',
  },
  gridLines: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'space-between',
    paddingVertical: 0,
  },
  gridLine: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#ececec',
  },
  barsRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    height: '100%',
    zIndex: 1,
  },
  daySlot: {
    width: 52,
    paddingHorizontal: 8,
    height: '100%',
  },
  daySlotSelected: {
    backgroundColor: 'rgba(90, 79, 199, 0.08)',
  },
  barAnchorTop: {
    flex: 1,
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  barAnchorBottom: {
    flex: 1,
    justifyContent: 'flex-start',
    alignItems: 'center',
  },
  barColumn: {
    width: 28,
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
    overflow: 'hidden',
  },
  barColumnDown: {
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
    borderBottomLeftRadius: 4,
    borderBottomRightRadius: 4,
  },
  barSegment: {
    width: '100%',
  },
  barSegmentGap: {
    borderTopWidth: 1,
    borderTopColor: '#fff',
  },
  zeroLine: {
    height: 2,
    backgroundColor: '#1a1a1a',
    opacity: 0.55,
  },
  xLabels: {
    flexDirection: 'row',
    marginTop: 6,
  },
  xLabelSlot: {
    width: 52,
    alignItems: 'center',
    paddingVertical: 4,
  },
  legendSwatch: {
    width: 12,
    height: 12,
    borderRadius: 3,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#f4f4f5',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 6,
  },
  chipSwatch: {
    width: 8,
    height: 8,
    borderRadius: 2,
  },
  chipText: {
    fontFamily,
    fontSize: 11,
    fontWeight: '700',
  },
  chipEmpty: {
    fontFamily,
    fontSize: 12,
    color: '#8a8a8a',
  },
  breakdownCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e8e8e8',
    borderRadius: 10,
    padding: 14,
    backgroundColor: '#fff',
    gap: 12,
  },
  breakdownTitle: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  breakdownCols: {
    flexDirection: 'row',
    gap: 16,
    flexWrap: 'wrap',
  },
  breakdownCol: {
    flex: 1,
    minWidth: 150,
    gap: 6,
  },
  breakdownSide: {
    fontFamily,
    fontSize: 11,
    fontWeight: '700',
    color: '#8a8a8a',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    marginBottom: 2,
  },
  breakdownRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  breakdownBar: {
    width: 16,
    height: 10,
    borderRadius: 2,
  },
  breakdownMetal: {
    flex: 1,
    fontFamily,
    fontSize: 13,
    color: '#1a1a1a',
  },
  breakdownGrams: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  breakdownChips: {
    gap: 6,
    paddingTop: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#f0f0f0',
  },
  breakdownChipLabel: {
    fontFamily,
    fontSize: 11,
    fontWeight: '700',
    color: '#2F8A4E',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  breakdownChipLabelBuy: {
    color: '#B45309',
    marginTop: 4,
  },
  xLabel: {
    fontFamily,
    fontSize: 10,
    color: '#8a8a8a',
  },
  xLabelSelected: {
    color: ACCENT,
    fontWeight: '700',
  },
  totalsRow: {
    flexDirection: 'row',
    gap: 10,
    flexWrap: 'wrap',
  },
  totalCard: {
    flex: 1,
    minWidth: 160,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e8e8e8',
    borderRadius: 10,
    padding: 12,
    backgroundColor: '#fff',
    gap: 4,
  },
  totalLabel: {
    fontFamily,
    fontSize: 11,
    fontWeight: '600',
    color: '#8a8a8a',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  totalValue: {
    fontFamily,
    fontSize: 20,
    fontWeight: '700',
    color: '#1a1a1a',
  },
  totalMetals: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  totalMetal: {
    fontFamily,
    fontSize: 11,
    fontWeight: '600',
  },
});
