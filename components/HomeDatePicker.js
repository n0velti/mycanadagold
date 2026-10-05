import { useEffect, useMemo, useRef, useState } from 'react';
import { BlurView } from 'expo-blur';
import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { MOBILE_BREAKPOINT } from '../lib/mobileUi';
import { formatDateParam, formatPickerDate, parseDateParam } from '../lib/transactions';
import { FONT } from '../lib/typography';

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const CALENDAR_WIDTH = 308;
const BORDER = '#d0d0d0';

function startOfMonth(date) {
  const value = parseDateParam(date);
  return new Date(value.getFullYear(), value.getMonth(), 1);
}

function addMonths(date, delta) {
  const value = startOfMonth(date);
  return new Date(value.getFullYear(), value.getMonth() + delta, 1);
}

function dayKey(date) {
  return formatDateParam(date);
}

function isBefore(left, right) {
  return dayKey(left) < dayKey(right);
}

function isAfter(left, right) {
  return dayKey(left) > dayKey(right);
}

function isBetween(day, start, end) {
  if (!start || !end) return false;
  const first = dayKey(start);
  const last = dayKey(end);
  const key = dayKey(day);
  return key >= (first < last ? first : last) && key <= (first > last ? first : last);
}

function clampDate(date, minimumDate, maximumDate) {
  let next = parseDateParam(date);
  if (minimumDate && isBefore(next, minimumDate)) next = parseDateParam(minimumDate);
  if (maximumDate && isAfter(next, maximumDate)) next = parseDateParam(maximumDate);
  return next;
}

export function formatHomeDateLabel(startDate, endDate, dateMode) {
  const start = parseDateParam(startDate);
  const end = parseDateParam(endDate);
  const today = parseDateParam(new Date());
  const isRange = dateMode === 'range' && dayKey(start) !== dayKey(end);
  if (!isRange) {
    return dayKey(start) === dayKey(today) ? 'Today' : formatPickerDate(start);
  }
  const thisYear = today.getFullYear();
  const sameYear = start.getFullYear() === end.getFullYear();
  const startLabel = start.toLocaleDateString('en-CA', {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
  const endLabel = end.toLocaleDateString('en-CA', {
    month: 'short',
    day: 'numeric',
    ...(sameYear && end.getFullYear() === thisYear ? {} : { year: 'numeric' }),
  });
  return `${startLabel} – ${endLabel}`;
}

export default function HomeDatePicker({
  startDate,
  endDate,
  dateMode = 'day',
  onChange,
  minimumDate,
  maximumDate,
  compact = false,
  fill = false,
  disabled = false,
  blur = false,
  dark = false,
  searchChrome = false,
  hideField = false,
  openRef,
  anchorRef,
  onOpenChange,
}) {
  const fieldRef = useRef(null);
  const openIntent = useRef(null);
  const blockOpenUntil = useRef(0);
  const skipDismissApply = useRef(false);
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const isMobileLayout = windowWidth < MOBILE_BREAKPOINT;
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState(null);
  const [rangePicking, setRangePicking] = useState(dateMode === 'range');
  const [draftStart, setDraftStart] = useState(() => parseDateParam(startDate));
  const [draftEnd, setDraftEnd] = useState(() => parseDateParam(endDate));
  const [hoverKey, setHoverKey] = useState('');
  const [cursor, setCursor] = useState(() => startOfMonth(startDate || new Date()));

  const today = useMemo(() => parseDateParam(new Date()), []);
  const minDate = minimumDate ? parseDateParam(minimumDate) : null;
  const maxDate = maximumDate ? parseDateParam(maximumDate) : today;
  const label = formatHomeDateLabel(startDate, endDate, dateMode);
  const iconSize = compact && !searchChrome ? 13 : 16;
  const valueSize = searchChrome ? 16 : compact ? 13 : 14;
  const useBlurChrome = blur && !searchChrome;

  useEffect(() => {
    if (!open) return;
    const start = parseDateParam(startDate);
    const end = parseDateParam(endDate);
    const intent = openIntent.current;
    openIntent.current = null;
    if (intent === 'range') {
      setRangePicking(true);
      setDraftStart(start);
      setDraftEnd(dayKey(start) === dayKey(end) ? null : end);
      setHoverKey('');
      setCursor(startOfMonth(start));
      return;
    }
    if (intent === 'day') {
      setRangePicking(false);
      setDraftStart(start);
      setDraftEnd(start);
      setHoverKey('');
      setCursor(startOfMonth(start));
      return;
    }
    const ranged = dateMode === 'range' && dayKey(start) !== dayKey(end);
    setRangePicking(ranged);
    setDraftStart(start);
    setDraftEnd(end);
    setHoverKey('');
    setCursor(startOfMonth(start));
  }, [open, startDate, endDate, dateMode]);

  const cells = useMemo(() => {
    const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
    const offset = cursor.getDay();
    const next = [];
    for (let i = 0; i < offset; i += 1) next.push(null);
    for (let day = 1; day <= daysInMonth; day += 1) {
      next.push(new Date(cursor.getFullYear(), cursor.getMonth(), day));
    }
    while (next.length % 7 !== 0) next.push(null);
    return next;
  }, [cursor]);

  const title = cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const pickingEnd = rangePicking && draftStart && !draftEnd;
  const previewEnd = pickingEnd && hoverKey ? parseDateParam(hoverKey) : draftEnd;

  const dismiss = () => {
    skipDismissApply.current = true;
    blockOpenUntil.current = Date.now() + 400;
    setOpen(false);
    setAnchor(null);
    setHoverKey('');
    onOpenChange?.(false);
  };

  const commit = (mode, start, end) => {
    const nextStart = clampDate(start, minDate, maxDate);
    const nextEnd = clampDate(end || start, minDate, maxDate);
    const ordered = isAfter(nextStart, nextEnd)
      ? { start: nextEnd, end: nextStart }
      : { start: nextStart, end: nextEnd };
    skipDismissApply.current = true;
    onChange?.({
      mode: mode === 'range' && dayKey(ordered.start) !== dayKey(ordered.end) ? 'range' : 'day',
      start: ordered.start,
      end: ordered.end,
    });
    dismiss();
  };

  const close = () => {
    if (skipDismissApply.current) {
      dismiss();
      return;
    }
    if (rangePicking && draftStart && draftEnd) {
      commit('range', draftStart, draftEnd);
      return;
    }
    dismiss();
  };

  const openCalendar = () => {
    if (disabled) return;
    if (open) return;
    if (Date.now() < blockOpenUntil.current) return;
    skipDismissApply.current = false;
    const reveal = (nextAnchor) => {
      setAnchor(nextAnchor);
      setOpen(true);
      onOpenChange?.(true);
    };
    const node = anchorRef?.current || fieldRef.current;
    if (node?.measureInWindow) {
      node.measureInWindow((x, y, width, height) => {
        if (Date.now() < blockOpenUntil.current) return;
        reveal({ x, y, width, height });
      });
      return;
    }
    reveal(null);
  };

  useEffect(() => {
    if (!openRef) return undefined;
    openRef.current = (opts = {}) => {
      if (opts.close) {
        dismiss();
        return;
      }
      if (opts.range) openIntent.current = 'range';
      else if (opts.day) openIntent.current = 'day';
      else openIntent.current = null;
      openCalendar();
    };
    return () => {
      openRef.current = null;
    };
  });

  const handleDayPress = (day) => {
    if ((minDate && isBefore(day, minDate)) || (maxDate && isAfter(day, maxDate))) return;
    if (!rangePicking) {
      commit('day', day, day);
      return;
    }
    if (!draftStart || draftEnd) {
      setDraftStart(day);
      setDraftEnd(null);
      return;
    }
    commit('range', draftStart, day);
  };

  const toggleRange = (nextRange) => {
    const enable = nextRange == null ? !rangePicking : Boolean(nextRange);
    if (enable === rangePicking) return;
    if (!enable) {
      setRangePicking(false);
      setDraftStart(parseDateParam(startDate));
      setDraftEnd(parseDateParam(startDate));
      setHoverKey('');
      return;
    }
    setRangePicking(true);
    setDraftStart(parseDateParam(startDate));
    setDraftEnd(dateMode === 'range' && dayKey(startDate) !== dayKey(endDate) ? parseDateParam(endDate) : null);
    setHoverKey('');
  };

  const applyPreset = (kind) => {
    if (kind === 'today') {
      commit('day', today, today);
      return;
    }
    if (kind === 'week') {
      const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6);
      commit('range', start, today);
      return;
    }
    const monthStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    commit('range', monthStart, monthEnd);
  };

  const calendarLeft = (() => {
    if (!anchor) return Math.max(16, (windowWidth - CALENDAR_WIDTH) / 2);
    const preferred = anchor.x + anchor.width - CALENDAR_WIDTH;
    return Math.min(Math.max(12, preferred), windowWidth - CALENDAR_WIDTH - 12);
  })();

  const calendarTop = (() => {
    const height = 456;
    if (!anchor) return Math.max(24, (windowHeight - height) / 2);
    const below = anchor.y + anchor.height + 8;
    if (below + height <= windowHeight - 12) return below;
    const above = anchor.y - height - 8;
    return above > 12 ? above : Math.max(12, (windowHeight - height) / 2);
  })();

  const field = (
    <Pressable
      ref={fieldRef}
      onPress={openCalendar}
      disabled={disabled}
      style={[
        styles.field,
        compact && styles.fieldCompact,
        fill && styles.fieldFill,
        useBlurChrome && styles.fieldBlur,
        searchChrome && styles.fieldSearchChrome,
        searchChrome &&
          (isMobileLayout ? styles.fieldSearchChromeMobile : styles.fieldSearchChromeDesktop),
        disabled && styles.fieldDisabled,
      ]}
      accessibilityRole="button"
      accessibilityLabel={`Date ${label}`}
      accessibilityState={{ disabled, expanded: open }}
    >
      <Ionicons name="calendar-outline" size={iconSize} color={dark ? '#E8D5A3' : '#8e8e93'} />
      <Text
        style={[
          styles.fieldValue,
          { fontSize: valueSize },
          searchChrome && styles.fieldValueSearchChrome,
          dark && styles.fieldValueDark,
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );

  return (
    <>
      {hideField ? null : useBlurChrome ? (
        <View style={styles.blurLift}>
          <BlurView
            intensity={32}
            tint="light"
            style={styles.blurWrap}
            {...(Platform.OS === 'web' ? { className: 'cgold-home-chip-blur' } : null)}
          >
            {field}
          </BlurView>
        </View>
      ) : (
        field
      )}

      <Modal visible={open} transparent animationType="none" onRequestClose={close}>
        <View style={styles.modalRoot} pointerEvents="box-none">
          <Pressable style={styles.calBackdrop} onPress={close} accessibilityLabel="Close calendar" />
          <Pressable
            style={[styles.calCard, { top: calendarTop, left: calendarLeft }]}
            onPress={(event) => event?.stopPropagation?.()}
          >
            <View style={styles.calHeader}>
              <Pressable
                onPress={() => setCursor((current) => addMonths(current, -1))}
                hitSlop={8}
                accessibilityLabel="Previous month"
                style={styles.calNav}
              >
                <Ionicons name="chevron-back" size={20} color="#1d1d1f" />
              </Pressable>
              <Text style={styles.calTitle}>{title}</Text>
              <Pressable
                onPress={() => setCursor((current) => addMonths(current, 1))}
                hitSlop={8}
                accessibilityLabel="Next month"
                style={styles.calNav}
              >
                <Ionicons name="chevron-forward" size={20} color="#1d1d1f" />
              </Pressable>
            </View>

            <View style={styles.calWeekRow}>
              {WEEKDAYS.map((day) => (
                <Text key={day} style={styles.calWeekday}>
                  {day}
                </Text>
              ))}
            </View>

            <View style={styles.calGrid}>
              {cells.map((day, index) => {
                if (!day) {
                  return <View key={`empty-${index}`} style={styles.calDay} />;
                }
                const key = dayKey(day);
                const disabledDay =
                  Boolean(minDate && isBefore(day, minDate)) ||
                  Boolean(maxDate && isAfter(day, maxDate));
                const rangeStart = draftStart;
                const rangeEnd = previewEnd;
                const orderedStart =
                  rangeStart && rangeEnd && isAfter(rangeStart, rangeEnd) ? rangeEnd : rangeStart;
                const orderedEnd =
                  rangeStart && rangeEnd && isAfter(rangeStart, rangeEnd) ? rangeStart : rangeEnd;
                const isStart = orderedStart && key === dayKey(orderedStart);
                const isEnd = Boolean(orderedEnd) && key === dayKey(orderedEnd);
                const isSelected =
                  isStart || isEnd || (!rangePicking && rangeStart && key === dayKey(rangeStart));
                const isToday = key === dayKey(today);
                const between = rangePicking && isBetween(day, rangeStart, rangeEnd) && !isStart && !isEnd;

                return (
                  <Pressable
                    key={key}
                    onPress={() => handleDayPress(day)}
                    disabled={disabledDay}
                    style={styles.calDay}
                    accessibilityRole="button"
                    accessibilityLabel={day.toLocaleDateString()}
                    accessibilityState={{ selected: isSelected, disabled: disabledDay }}
                    {...(Platform.OS === 'web' && pickingEnd
                      ? {
                          onMouseEnter: () => setHoverKey(key),
                          onMouseLeave: () => setHoverKey(''),
                        }
                      : null)}
                  >
                    <View
                      style={[
                        styles.calDayWash,
                        between && styles.calDayWashBetween,
                        isStart && rangePicking && orderedEnd && styles.calDayWashStart,
                        isEnd && rangePicking && orderedStart && styles.calDayWashEnd,
                      ]}
                    />
                    <View
                      style={[
                        styles.calDayInner,
                        isToday && !isSelected && styles.calDayToday,
                        isSelected && styles.calDaySelected,
                        disabledDay && styles.calDayDisabled,
                      ]}
                    >
                      <Text
                        style={[
                          styles.calDayText,
                          isToday && styles.calDayTextToday,
                          isSelected && styles.calDayTextSelected,
                          disabledDay && styles.calDayTextDisabled,
                        ]}
                      >
                        {day.getDate()}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>

            <View style={styles.calTools}>
              <View style={styles.modeRow}>
                <Pressable
                  onPress={() => toggleRange(false)}
                  style={[styles.modeChip, !rangePicking && styles.modeChipActive]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: !rangePicking }}
                  accessibilityLabel="Single day"
                >
                  <Text style={[styles.modeChipText, !rangePicking && styles.modeChipTextActive]}>Day</Text>
                </Pressable>
                <Pressable
                  onPress={() => toggleRange(true)}
                  style={[styles.modeChip, rangePicking && styles.modeChipActive]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: rangePicking }}
                  accessibilityLabel="Date range"
                >
                  <Text style={[styles.modeChipText, rangePicking && styles.modeChipTextActive]}>Range</Text>
                </Pressable>
              </View>
              <View style={styles.presetRow}>
                <Pressable onPress={() => applyPreset('today')} style={styles.presetChip} accessibilityLabel="Today">
                  <Text style={styles.presetText}>Today</Text>
                </Pressable>
                <Pressable onPress={() => applyPreset('week')} style={styles.presetChip} accessibilityLabel="Last 7 days">
                  <Text style={styles.presetText}>7 days</Text>
                </Pressable>
                <Pressable onPress={() => applyPreset('month')} style={styles.presetChip} accessibilityLabel="Calendar month">
                  <Text style={styles.presetText}>Month</Text>
                </Pressable>
              </View>
            </View>

            <View style={styles.calFooter}>
              <Text style={styles.calHint} numberOfLines={1}>
                {rangePicking
                  ? pickingEnd
                    ? 'Pick end date'
                    : 'Pick start date'
                  : 'Pick a date'}
              </Text>
              <Pressable onPress={() => applyPreset('today')} hitSlop={8} accessibilityLabel="Today">
                <Text style={styles.calToday}>Today</Text>
              </Pressable>
            </View>
          </Pressable>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
    gap: 8,
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: BORDER,
    paddingHorizontal: 12,
    minHeight: 40,
    justifyContent: 'center',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  fieldCompact: {
    height: 40,
    minHeight: 40,
  },
  fieldSearchChrome: {
    borderColor: 'rgba(60, 60, 67, 0.18)',
  },
  fieldSearchChromeDesktop: {
    borderRadius: 6,
    minHeight: 40,
  },
  fieldSearchChromeMobile: {
    borderRadius: 10,
    minHeight: 40,
  },
  fieldBlur: {
    backgroundColor: 'transparent',
    borderWidth: 0,
    borderRadius: 20,
  },
  blurLift: {
    height: 40,
    borderRadius: 20,
    flexShrink: 0,
    backgroundColor: 'transparent',
    ...Platform.select({
      web: {
        boxShadow: '0 10px 28px rgba(0,0,0,0.14), 0 1px 3px rgba(0,0,0,0.08)',
      },
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.16,
        shadowRadius: 18,
        elevation: 12,
      },
    }),
  },
  blurWrap: {
    height: 40,
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,0,0,0.08)',
    backgroundColor: 'rgba(255,255,255,0.56)',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  fieldFill: {
    flex: 1,
    minWidth: 0,
    alignSelf: 'stretch',
  },
  fieldDisabled: {
    opacity: 0.7,
  },
  fieldValue: {
    fontFamily: FONT,
    color: '#1a1a1a',
    letterSpacing: 0,
  },
  fieldValueSearchChrome: {
    color: '#1d1d1f',
  },
  fieldValueDark: {
    color: '#F6F1E6',
  },
  modalRoot: {
    flex: 1,
  },
  calBackdrop: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1,
  },
  calCard: {
    position: 'absolute',
    zIndex: 2,
    width: CALENDAR_WIDTH,
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: BORDER,
    ...Platform.select({
      web: { boxShadow: '0 12px 36px rgba(0,0,0,0.16)' },
      default: {
        shadowColor: '#000',
        shadowOpacity: 0.16,
        shadowRadius: 18,
        shadowOffset: { width: 0, height: 8 },
        elevation: 8,
      },
    }),
  },
  calHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  calNav: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  calTitle: {
    fontFamily: FONT,
    fontSize: 15,
    fontWeight: '600',
    color: '#1d1d1f',
    letterSpacing: -0.2,
  },
  calWeekRow: {
    flexDirection: 'row',
  },
  calWeekday: {
    flex: 1,
    fontFamily: FONT,
    fontSize: 11,
    fontWeight: '600',
    color: '#8e8e93',
    textAlign: 'center',
    paddingVertical: 4,
  },
  calGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  calDay: {
    width: '14.2857%',
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  calDayWash: {
    ...StyleSheet.absoluteFillObject,
  },
  calDayWashBetween: {
    backgroundColor: '#f0f0f2',
  },
  calDayWashStart: {
    backgroundColor: '#f0f0f2',
    left: '50%',
  },
  calDayWashEnd: {
    backgroundColor: '#f0f0f2',
    right: '50%',
  },
  calDayInner: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  calDayToday: {
    borderWidth: 1,
    borderColor: '#1a1a1a',
  },
  calDaySelected: {
    backgroundColor: '#1a1a1a',
  },
  calDayDisabled: {
    opacity: 0.35,
  },
  calDayText: {
    fontFamily: FONT,
    fontSize: 13,
    color: '#1d1d1f',
  },
  calDayTextToday: {
    fontWeight: '600',
  },
  calDayTextSelected: {
    fontWeight: '600',
    color: '#fff',
  },
  calDayTextDisabled: {
    color: '#8e8e93',
  },
  calTools: {
    gap: 8,
    paddingTop: 8,
    paddingHorizontal: 2,
  },
  modeRow: {
    flexDirection: 'row',
    backgroundColor: '#f2f2f4',
    borderRadius: 8,
    padding: 2,
  },
  modeChip: {
    flex: 1,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  modeChipActive: {
    backgroundColor: '#fff',
  },
  modeChipText: {
    fontFamily: FONT,
    fontSize: 12,
    fontWeight: '600',
    color: '#8e8e93',
  },
  modeChipTextActive: {
    color: '#1a1a1a',
  },
  presetRow: {
    flexDirection: 'row',
    gap: 6,
  },
  presetChip: {
    flex: 1,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: BORDER,
    backgroundColor: '#fff',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  presetText: {
    fontFamily: FONT,
    fontSize: 12,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  calFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingTop: 8,
    paddingHorizontal: 2,
  },
  calHint: {
    flex: 1,
    fontFamily: FONT,
    fontSize: 12,
    color: '#8e8e93',
  },
  calToday: {
    fontFamily: FONT,
    fontSize: 13,
    fontWeight: '600',
    color: '#007AFF',
  },
});
