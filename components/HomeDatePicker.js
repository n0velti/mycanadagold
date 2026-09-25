import { useEffect, useMemo, useRef, useState } from 'react';
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
  const startLabel = start.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
  const endLabel = end.toLocaleDateString('en-CA', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
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
}) {
  const fieldRef = useRef(null);
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
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
  const iconSize = compact ? 13 : 16;
  const valueSize = compact ? 13 : 14;

  useEffect(() => {
    if (!open) return;
    const start = parseDateParam(startDate);
    const end = parseDateParam(endDate);
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

  const close = () => {
    setOpen(false);
    setAnchor(null);
    setHoverKey('');
  };

  const commit = (mode, start, end) => {
    const nextStart = clampDate(start, minDate, maxDate);
    const nextEnd = clampDate(end || start, minDate, maxDate);
    const ordered = isAfter(nextStart, nextEnd)
      ? { start: nextEnd, end: nextStart }
      : { start: nextStart, end: nextEnd };
    onChange?.({
      mode: mode === 'range' && dayKey(ordered.start) !== dayKey(ordered.end) ? 'range' : 'day',
      start: ordered.start,
      end: ordered.end,
    });
    close();
  };

  const openCalendar = () => {
    if (disabled) return;
    const node = fieldRef.current;
    if (node?.measureInWindow) {
      node.measureInWindow((x, y, width, height) => {
        setAnchor({ x, y, width, height });
        setOpen(true);
      });
      return;
    }
    setAnchor(null);
    setOpen(true);
  };

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

  const toggleRange = () => {
    if (rangePicking) {
      setRangePicking(false);
      setDraftStart(parseDateParam(startDate));
      setDraftEnd(parseDateParam(startDate));
      setHoverKey('');
      return;
    }
    setRangePicking(true);
    setDraftStart(null);
    setDraftEnd(null);
    setHoverKey('');
  };

  const calendarLeft = (() => {
    if (!anchor) return Math.max(16, (windowWidth - CALENDAR_WIDTH) / 2);
    const preferred = anchor.x + anchor.width - CALENDAR_WIDTH;
    return Math.min(Math.max(12, preferred), windowWidth - CALENDAR_WIDTH - 12);
  })();

  const calendarTop = (() => {
    const height = 380;
    if (!anchor) return Math.max(24, (windowHeight - height) / 2);
    const below = anchor.y + anchor.height + 8;
    if (below + height <= windowHeight - 12) return below;
    const above = anchor.y - height - 8;
    return above > 12 ? above : Math.max(12, (windowHeight - height) / 2);
  })();

  return (
    <>
      <Pressable
        ref={fieldRef}
        onPress={openCalendar}
        disabled={disabled}
        style={[
          styles.field,
          compact && styles.fieldCompact,
          fill && styles.fieldFill,
          disabled && styles.fieldDisabled,
        ]}
        accessibilityRole="button"
        accessibilityLabel={`Date ${label}`}
        accessibilityState={{ disabled, expanded: open }}
      >
        <Ionicons name="calendar-outline" size={iconSize} color="#8e8e93" />
        <Text style={[styles.fieldValue, { fontSize: valueSize }]} numberOfLines={1}>
          {label}
        </Text>
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
        <View style={styles.modalRoot} pointerEvents="box-none">
          <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel="Close calendar" />
          <View style={[styles.calCard, { top: calendarTop, left: calendarLeft }]}>
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

            <View style={styles.calFooter}>
              <Pressable
                onPress={toggleRange}
                style={[styles.rangeButton, rangePicking && styles.rangeButtonActive]}
                accessibilityRole="button"
                accessibilityState={{ selected: rangePicking }}
                accessibilityLabel="Select date range"
              >
                <Ionicons
                  name="swap-horizontal"
                  size={14}
                  color={rangePicking ? '#fff' : '#1a1a1a'}
                />
                <Text style={[styles.rangeButtonText, rangePicking && styles.rangeButtonTextActive]}>
                  Range
                </Text>
              </Pressable>
              <Text style={styles.calHint} numberOfLines={1}>
                {rangePicking
                  ? pickingEnd
                    ? 'Pick end date'
                    : draftEnd
                      ? formatHomeDateLabel(draftStart, draftEnd, 'range')
                      : 'Pick start date'
                  : 'Pick a date'}
              </Text>
              <Pressable onPress={() => commit('day', today, today)} hitSlop={8} accessibilityLabel="Today">
                <Text style={styles.calToday}>Today</Text>
              </Pressable>
            </View>
          </View>
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
    minHeight: 40,
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
  modalRoot: {
    flex: 1,
  },
  calCard: {
    position: 'absolute',
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
  calFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingTop: 8,
    paddingHorizontal: 2,
  },
  rangeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 30,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: BORDER,
    backgroundColor: '#fff',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  rangeButtonActive: {
    backgroundColor: '#1a1a1a',
    borderColor: '#1a1a1a',
  },
  rangeButtonText: {
    fontFamily: FONT,
    fontSize: 12,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  rangeButtonTextActive: {
    color: '#fff',
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
