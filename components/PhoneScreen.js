import { createElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { activeCallKicker, usePhoneCalls } from './PhoneCallProvider';
import { fetchTransferStores } from '../lib/locations';
import { formatDateParam, formatPickerDate, parseDateParam } from '../lib/transactions';
import {
  callPartyLabel,
  fetchPhoneHistory,
  fetchVoicemailAudioUrl,
  formatCallWhen,
  formatDuration,
  inboundCallsUnique,
  inboundCallRatio,
  isAnsweredInbound,
  resultLabel,
  callsForStore,
} from '../lib/phoneCalls';
import { isConnectedStatus } from '../lib/callState';
import {
  canManageRingCentral,
  connectionLabel,
  formatCheckedAt,
  formatPhoneNumber,
  formatUsageType,
  listRingCentralAccounts,
} from '../lib/ringcentral';
import { storeKeyFromName } from '../lib/storeSettings';
import { useIsMobile } from '../lib/mobileUi';

const fontFamily = Platform.select({
  ios: 'Sohne',
  android: 'Sohne',
  default: 'Sohne',
});

const ACCENT = '#15803D';
const TABS = [
  { key: 'incoming', label: 'Incoming' },
  { key: 'missed', label: 'Missed' },
  { key: 'log', label: 'Call log' },
  { key: 'dial', label: 'Making calls' },
  { key: 'voicemail', label: 'Voicemail' },
  { key: 'stats', label: 'Ratio' },
];
const KEYPAD = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];
const DATE_MODES = [
  { key: 'today', label: 'Today' },
  { key: 'day', label: 'Date' },
  { key: 'range', label: 'Range' },
];
// The provider's inbox is a rolling 14-day window; anything older is fetched
// on demand for the chosen dates. 13 keeps a margin for the poll's own age.
const ROLLING_INBOX_MS = 13 * 24 * 60 * 60 * 1000;
const HISTORY_MAX_DAYS = 92;
const DAY_MS = 24 * 60 * 60 * 1000;

function statusTone(row) {
  const status = row?.lastStatus || connectionLabel(row);
  if (status === 'connected' || status === 'Connected') return styles.statusConnected;
  if (status === 'error' || status === 'Error') return styles.statusError;
  return styles.statusMuted;
}

/** [start, end) in ms for a local calendar day span. */
function dateWindow(startDate, endDate) {
  const start = parseDateParam(startDate);
  const end = parseDateParam(endDate);
  end.setDate(end.getDate() + 1);
  return { start: start.getTime(), end: end.getTime(), key: `${formatDateParam(start)}|${formatDateParam(endDate)}` };
}

function todayWindow() {
  const today = new Date();
  return dateWindow(today, today);
}

function inWindow(value, span) {
  const time = Date.parse(value);
  return Number.isFinite(time) && time >= span.start && time < span.end;
}

function windowCopy(mode, startDate, endDate, { sentence = true } = {}) {
  if (mode === 'today') return 'today';
  const startKey = formatDateParam(startDate);
  if (mode === 'day' || startKey === formatDateParam(endDate)) {
    if (startKey === formatDateParam(new Date())) return 'today';
    return `${sentence ? 'on ' : ''}${formatPickerDate(startDate)}`;
  }
  return `${formatPickerDate(startDate)} – ${formatPickerDate(endDate)}`;
}

function CallTimer({ since, style }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!since) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [since]);
  if (!since) return null;
  const total = Math.max(0, Math.floor((now - since) / 1000));
  return (
    <Text style={style}>
      {Math.floor(total / 60)}:{String(total % 60).padStart(2, '0')}
    </Text>
  );
}

function DateChip({ label, value, onChange, minimumDate, maximumDate }) {
  const [open, setOpen] = useState(false);
  const dateValue = parseDateParam(value);

  const commit = (next) => {
    if (!next) return;
    let date = parseDateParam(next);
    if (minimumDate && date < parseDateParam(minimumDate)) date = parseDateParam(minimumDate);
    if (maximumDate && date > parseDateParam(maximumDate)) date = parseDateParam(maximumDate);
    onChange(date);
  };

  if (Platform.OS === 'web') {
    return (
      <View style={styles.pickChip}>
        <Text style={styles.pickChipLabel}>{label}</Text>
        <View style={styles.pickChipControl}>
          <Ionicons name="calendar-outline" size={14} color="#6b6b6b" />
          {createElement('input', {
            type: 'date',
            value: formatDateParam(dateValue),
            min: minimumDate ? formatDateParam(minimumDate) : undefined,
            max: maximumDate ? formatDateParam(maximumDate) : undefined,
            'aria-label': label,
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
      <Pressable style={styles.pickChip} onPress={() => setOpen(true)} accessibilityRole="button" accessibilityLabel={label}>
        <Text style={styles.pickChipLabel}>{label}</Text>
        <View style={styles.pickChipControl}>
          <Ionicons name="calendar-outline" size={14} color="#6b6b6b" />
          <Text style={styles.pickChipValue}>{formatPickerDate(dateValue)}</Text>
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
          <View style={styles.pickModalBackdrop}>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setOpen(false)} />
            <View style={styles.pickModalCard}>
              <View style={styles.pickModalHeader}>
                <Text style={styles.pickModalTitle}>{label}</Text>
                <Pressable onPress={() => setOpen(false)} hitSlop={8}>
                  <Text style={styles.pickModalDone}>Done</Text>
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

function DateFilter({ mode, startDate, endDate, onMode, onDay, onStart, onEnd }) {
  const today = new Date();
  const earliest = new Date(today.getTime() - (HISTORY_MAX_DAYS - 1) * DAY_MS);
  return (
    <View style={styles.dateRow}>
      <View style={styles.dateModeGroup}>
        {DATE_MODES.map((item) => {
          const active = mode === item.key;
          return (
            <Pressable
              key={item.key}
              style={[styles.dateChip, active && styles.dateChipActive]}
              onPress={() => onMode(item.key)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
            >
              <Text style={[styles.dateChipText, active && styles.dateChipTextActive]}>{item.label}</Text>
            </Pressable>
          );
        })}
      </View>
      {mode === 'day' ? (
        <DateChip label="Date" value={startDate} onChange={onDay} minimumDate={earliest} maximumDate={today} />
      ) : null}
      {mode === 'range' ? (
        <>
          <DateChip label="From" value={startDate} onChange={onStart} minimumDate={earliest} maximumDate={endDate} />
          <Text style={styles.dateRangeSep}>–</Text>
          <DateChip label="To" value={endDate} onChange={onEnd} minimumDate={startDate} maximumDate={today} />
        </>
      ) : null}
    </View>
  );
}

function PhoneCrumb({ storeName, onStores }) {
  return (
    <View style={styles.crumb} accessibilityRole="header">
      <Pressable
        onPress={onStores}
        style={styles.crumbLinkHit}
        accessibilityRole="button"
        accessibilityLabel="Back to stores"
      >
        <Text style={styles.crumbLink}>Stores</Text>
      </Pressable>
      {storeName ? (
        <>
          <Text style={styles.crumbSep}>›</Text>
          <Text style={styles.crumbCurrent} numberOfLines={1}>
            {storeName}
          </Text>
        </>
      ) : null}
    </View>
  );
}

function DetailRow({ label, value }) {
  if (!value) return null;
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

function partyLine(entry, inbound) {
  const number = inbound ? entry.from : entry.to;
  const name = inbound ? entry.fromName : entry.toName;
  return [name, number ? formatPhoneNumber(number) : ''].filter(Boolean).join(' · ') || 'Unknown';
}

function historyRowKey(row) {
  return [row?.id, row?.startTime, row?.from, row?.to].filter(Boolean).join(':');
}

/** Number Call back should dial: the other party, not this store. */
function callbackNumber(row) {
  const inbound = String(row?.direction || '') !== 'Outbound';
  return String((inbound ? row?.from : row?.to) || '').trim();
}

function CallHistoryRow({ row, inbound = true, showDirection = false, onCallback, callbackBusy, callbackDisabled }) {
  const missed = inbound && !isAnsweredInbound(row);
  const icon = !inbound ? 'arrow-up' : missed ? 'call-outline' : 'arrow-down';
  const label = partyLine(row, inbound);
  return (
    <View style={styles.itemRow}>
      <View style={styles.callIcon}>
        <Ionicons name={icon} size={14} color={missed ? '#B91C1C' : ACCENT} />
      </View>
      <View style={styles.itemText}>
        <Text style={styles.itemTitle}>{label}</Text>
        <Text style={styles.itemMeta}>
          {[
            showDirection ? (inbound ? 'Inbound' : 'Outbound') : '',
            resultLabel(row.result),
            formatCallWhen(row.startTime),
            row.duration ? formatDuration(row.duration) : '',
          ]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      </View>
      {onCallback ? (
        <Pressable
          style={[styles.callbackBtn, (callbackBusy || callbackDisabled) && styles.callbackBtnDisabled]}
          onPress={(event) => {
            event?.stopPropagation?.();
            onCallback(row);
          }}
          disabled={callbackBusy || callbackDisabled}
          accessibilityLabel={`Call back ${label}`}
        >
          {callbackBusy ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <>
              <Ionicons name="call" size={12} color="#fff" />
              <Text style={styles.callbackText}>Call back</Text>
            </>
          )}
        </Pressable>
      ) : null}
    </View>
  );
}

function RatioStrip({ stats, compact = false, rangeLabel = 'today', rangeShort = rangeLabel }) {
  const empty = !stats?.total;
  return (
    <View style={[styles.ratioBlock, compact && styles.ratioBlockCompact]}>
      <View style={styles.ratioStats}>
        <View style={[styles.ratioStat, compact && styles.ratioStatCompact]}>
          <Text style={styles.summaryLabel}>Answered</Text>
          <Text style={[styles.summaryValue, compact && styles.summaryValueCompact, stats.answered ? styles.statusConnected : null]}>
            {stats.answered}
          </Text>
        </View>
        <View style={[styles.ratioStat, compact && styles.ratioStatCompact]}>
          <Text style={styles.summaryLabel}>Missed</Text>
          <Text style={[styles.summaryValue, compact && styles.summaryValueCompact, stats.missed ? styles.statusError : null]}>{stats.missed}</Text>
        </View>
        <View style={[styles.ratioStat, compact && styles.ratioStatCompact]}>
          <Text style={styles.summaryLabel}>Total</Text>
          <Text style={[styles.summaryValue, compact && styles.summaryValueCompact]}>{stats.total}</Text>
        </View>
        {compact ? null : (
          <View style={styles.ratioStat}>
            <Text style={styles.summaryLabel}>Answer rate</Text>
            <Text style={styles.summaryValue}>{stats.rate == null ? '—' : `${stats.rate}%`}</Text>
          </View>
        )}
      </View>
      <View style={[styles.ratioBarTrack, compact && styles.ratioBarTrackCompact]}>
        {empty ? (
          <View style={styles.ratioBarEmpty} />
        ) : (
          <>
            <View style={[styles.ratioBarFill, { flex: stats.answered || 0 }]} />
            <View style={[styles.ratioBarMissed, { flex: stats.missed || 0 }]} />
          </>
        )}
      </View>
      <Text style={styles.sectionMeta}>
        {empty
          ? `No inbound calls ${rangeLabel}.`
          : stats.rate == null
            ? `No inbound calls ${rangeLabel}.`
            : `${stats.rate}% answered · ${stats.answered} of ${stats.total} · ${rangeShort}`}
      </Text>
    </View>
  );
}

const DAY_OPEN_HOUR = 9;
const DAY_CLOSE_HOUR = 19;
const CHART_PAD_L = 34;
const CHART_PAD_R = 14;
const CHART_PAD_T = 14;
const CHART_LINE_H = 104; // running answer-rate lane
const CHART_GAP = 10;
const CHART_BARS_H = 36; // hourly answered / missed lane
const CHART_PAD_B = 20; // hour labels
const CHART_H = CHART_PAD_T + CHART_LINE_H + CHART_GAP + CHART_BARS_H + CHART_PAD_B;
const CHART_LINE_TOP = CHART_PAD_T;
const CHART_LINE_BOTTOM = CHART_PAD_T + CHART_LINE_H;
const CHART_BARS_TOP = CHART_LINE_BOTTOM + CHART_GAP;
const CHART_BARS_BOTTOM = CHART_BARS_TOP + CHART_BARS_H;
const MISSED = '#DC2626';

function hourMs(now, hour) {
  const date = new Date(now);
  date.setHours(hour, 0, 0, 0);
  return date.getTime();
}

function formatHourLabel(hour, { suffix = false } = {}) {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  if (!suffix) return String(h12);
  return `${h12} ${hour < 12 ? 'AM' : 'PM'}`;
}

function formatHourRange(hour) {
  return `${formatHourLabel(hour, { suffix: hour < 12 !== hour + 1 < 12 })}–${formatHourLabel(hour + 1, { suffix: true })}`;
}

/**
 * The plotted business day: 9 AM to 7 PM, stretched by whole hours when a call
 * landed outside it so nothing is hidden.
 */
function chartDay(calls, now = Date.now()) {
  let openHour = DAY_OPEN_HOUR;
  let closeHour = DAY_CLOSE_HOUR;
  const dayStart = hourMs(now, 0);
  for (const row of Array.isArray(calls) ? calls : []) {
    const time = Date.parse(row?.startTime);
    if (!Number.isFinite(time) || time < dayStart) continue;
    const hour = new Date(time).getHours();
    if (hour < openHour) openHour = hour;
    if (hour + 1 > closeHour) closeHour = Math.min(24, hour + 1);
  }
  return { openHour, closeHour, start: hourMs(now, openHour), end: hourMs(now, closeHour) };
}

function inboundToday(calls, day) {
  return inboundCallsUnique(calls)
    .map((row) => ({ row, time: Date.parse(row.startTime), answered: isAnsweredInbound(row) }))
    .filter((item) => Number.isFinite(item.time) && item.time >= day.start && item.time < day.end)
    .sort((a, b) => a.time - b.time);
}

function runningAnswerPoints(inbound) {
  const points = [];
  let answered = 0;
  inbound.forEach((item, index) => {
    if (item.answered) answered += 1;
    const total = index + 1;
    points.push({ time: item.time, rate: Math.round((answered / total) * 100), answered, total });
  });
  return points;
}

function hourlyBins(inbound, day) {
  const bins = [];
  for (let hour = day.openHour; hour < day.closeHour; hour += 1) {
    bins.push({ hour, answered: 0, missed: 0, total: 0, rate: null });
  }
  for (const item of inbound) {
    const bin = bins[new Date(item.time).getHours() - day.openHour];
    if (!bin) continue;
    bin.total += 1;
    if (item.answered) bin.answered += 1;
    else bin.missed += 1;
  }
  for (const bin of bins) {
    bin.rate = bin.total ? Math.round((bin.answered / bin.total) * 100) : null;
  }
  return bins;
}

function ChartLineSegment({ x1, y1, x2, y2, color, width = 2 }) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.sqrt(dx * dx + dy * dy);
  if (length < 0.5) return null;
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: (x1 + x2) / 2 - length / 2,
        top: (y1 + y2) / 2 - width / 2,
        width: length,
        height: width,
        borderRadius: width / 2,
        backgroundColor: color,
        transform: [{ rotate: `${angle}deg` }],
      }}
    />
  );
}

function RatioDayChart({ calls, anchor = null, label = 'today' }) {
  const [width, setWidth] = useState(0);
  const [pickedHour, setPickedHour] = useState(null);
  const now = Date.now();
  // `anchor` is any instant inside the day to draw; defaults to today.
  const at = anchor ?? now;
  const day = useMemo(() => chartDay(calls, at), [calls, at]);
  const inbound = useMemo(() => inboundToday(calls, day), [calls, day]);
  const callPoints = useMemo(() => runningAnswerPoints(inbound), [inbound]);
  const bins = useMemo(() => hourlyBins(inbound, day), [inbound, day]);
  const current = callPoints[callPoints.length - 1] || null;
  const clampedNow = Math.min(Math.max(now, day.start), day.end);
  const series = useMemo(() => {
    if (!current) return [];
    if (clampedNow - current.time < 60_000) return callPoints;
    return [...callPoints, { ...current, time: clampedNow, carried: true }];
  }, [callPoints, clampedNow, current]);

  const innerW = Math.max(1, width - CHART_PAD_L - CHART_PAD_R);
  const span = Math.max(1, day.end - day.start);
  const xOf = (time) => CHART_PAD_L + ((time - day.start) / span) * innerW;
  const yOf = (rate) => CHART_LINE_TOP + (1 - rate / 100) * CHART_LINE_H;
  const plotted = width > 0 ? series.map((point) => ({ ...point, x: xOf(point.time), y: yOf(point.rate) })) : [];
  const hourW = innerW / Math.max(1, bins.length);
  const maxHourly = Math.max(1, ...bins.map((bin) => bin.total));
  const nowX = xOf(clampedNow);
  const beforeOpen = now < day.start;
  const afterClose = now >= day.end;
  const dense = width >= 560;
  const picked = pickedHour == null ? null : bins.find((bin) => bin.hour === pickedHour) || null;

  const onLayout = (event) => {
    const next = Math.round(event?.nativeEvent?.layout?.width || 0);
    if (next > 0 && next !== width) setWidth(next);
  };

  const linePath = plotted.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x} ${point.y}`).join(' ');
  const tooltipW = 172;
  const tooltipLeft = picked
    ? Math.min(Math.max(0, xOf(hourMs(at, picked.hour)) + hourW / 2 - tooltipW / 2), Math.max(0, width - tooltipW))
    : 0;

  return (
    <View style={styles.ratioChart}>
      <View style={styles.ratioChartHead}>
        <View style={styles.ratioChartHeadText}>
          <Text style={styles.summaryLabel}>Answer rate {label}</Text>
          <Text style={styles.ratioChartSub}>
            {current
              ? `${current.answered} answered · ${current.total - current.answered} missed · ${formatHourLabel(day.openHour, { suffix: true })} to ${formatHourLabel(day.closeHour, { suffix: true })}`
              : `${formatHourLabel(DAY_OPEN_HOUR, { suffix: true })} to ${formatHourLabel(DAY_CLOSE_HOUR, { suffix: true })}`}
          </Text>
        </View>
        <Text
          style={[
            styles.ratioChartNow,
            current && current.rate < 80 && styles.statusError,
            current && current.rate >= 80 && styles.statusConnected,
          ]}
        >
          {current ? `${current.rate}%` : '—'}
        </Text>
      </View>
      <View
        style={styles.ratioChartFrame}
        onLayout={onLayout}
        accessibilityRole="image"
        accessibilityLabel={
          current
            ? `Answer rate ${label} started at ${series[0].rate}% and ${afterClose ? 'ended' : 'is'} ${current.rate}% from ${current.answered} of ${current.total} inbound calls between ${formatHourLabel(day.openHour, { suffix: true })} and ${formatHourLabel(day.closeHour, { suffix: true })}`
            : `No inbound calls ${label}`
        }
      >
        {width > 0 ? (
          <>
            {/* Rate guides: 100, 80 (target), 50, 0 */}
            {[100, 80, 50, 0].map((rate) => (
              <View
                key={`guide-${rate}`}
                pointerEvents="none"
                style={[
                  styles.ratioChartGuide,
                  rate === 80 && styles.ratioChartGuideTarget,
                  { top: yOf(rate), left: CHART_PAD_L, right: CHART_PAD_R },
                ]}
              />
            ))}
            {[100, 80, 50, 0].map((rate) => (
              <Text
                key={`y-${rate}`}
                pointerEvents="none"
                style={[styles.ratioChartY, rate === 80 && styles.ratioChartYTarget, { top: yOf(rate) - 6 }]}
              >
                {rate}
              </Text>
            ))}
            <Text pointerEvents="none" style={[styles.ratioChartLane, { top: CHART_BARS_TOP + 2 }]}>
              calls
            </Text>

            {/* Hour columns: alternating tint, hourly bars, hover / tap target */}
            {bins.map((bin, index) => {
              const left = CHART_PAD_L + index * hourW;
              const barH = bin.total ? Math.max(3, (bin.total / maxHourly) * (CHART_BARS_H - 4)) : 0;
              const barW = Math.max(3, Math.min(18, hourW * 0.42));
              const active = picked && picked.hour === bin.hour;
              return (
                <Pressable
                  key={`hour-${bin.hour}`}
                  onHoverIn={() => setPickedHour(bin.hour)}
                  onHoverOut={() => setPickedHour((value) => (value === bin.hour ? null : value))}
                  onPress={() => setPickedHour((value) => (value === bin.hour ? null : bin.hour))}
                  accessibilityLabel={
                    bin.total
                      ? `${formatHourRange(bin.hour)}: ${bin.answered} answered, ${bin.missed} missed`
                      : `${formatHourRange(bin.hour)}: no inbound calls`
                  }
                  style={[
                    styles.ratioChartHour,
                    index % 2 === 1 && styles.ratioChartHourAlt,
                    active && styles.ratioChartHourActive,
                    { left, width: hourW, top: CHART_LINE_TOP, height: CHART_BARS_BOTTOM - CHART_LINE_TOP },
                  ]}
                >
                  {bin.total ? (
                    <View
                      pointerEvents="none"
                      style={[
                        styles.ratioChartBar,
                        { left: hourW / 2 - barW / 2, width: barW, bottom: 2, height: barH },
                      ]}
                    >
                      <View style={[styles.ratioChartBarMissed, { flex: bin.missed }]} />
                      <View style={[styles.ratioChartBarAnswered, { flex: bin.answered }]} />
                    </View>
                  ) : null}
                </Pressable>
              );
            })}

            {/* Rest of the day */}
            {!afterClose ? (
              <View
                pointerEvents="none"
                style={[
                  styles.ratioChartFuture,
                  { left: nowX, width: Math.max(0, CHART_PAD_L + innerW - nowX), top: CHART_LINE_TOP, height: CHART_BARS_BOTTOM - CHART_LINE_TOP },
                ]}
              />
            ) : null}

            {/* Running answer rate */}
            {plotted.length ? (
              Platform.OS === 'web' ? (
                createElement(
                  'svg',
                  {
                    width,
                    height: CHART_H,
                    viewBox: `0 0 ${width} ${CHART_H}`,
                    style: { position: 'absolute', left: 0, top: 0, pointerEvents: 'none' },
                  },
                  [
                    createElement('path', {
                      key: 'fill',
                      d: `${linePath} L${plotted[plotted.length - 1].x} ${CHART_LINE_BOTTOM} L${plotted[0].x} ${CHART_LINE_BOTTOM} Z`,
                      fill: 'rgba(21, 128, 61, 0.12)',
                    }),
                    createElement('path', {
                      key: 'line',
                      d: linePath,
                      fill: 'none',
                      stroke: ACCENT,
                      strokeWidth: 2.5,
                      strokeLinejoin: 'round',
                      strokeLinecap: 'round',
                    }),
                  ],
                )
              ) : (
                plotted.slice(1).map((point, index) => (
                  <ChartLineSegment
                    key={`${point.time}-${index}`}
                    x1={plotted[index].x}
                    y1={plotted[index].y}
                    x2={point.x}
                    y2={point.y}
                    color={ACCENT}
                    width={2.5}
                  />
                ))
              )
            ) : null}
            {/* Each call on the line: green answered, red missed */}
            {plotted
              .filter((point) => !point.carried)
              .map((point, index) => {
                const missedCall = inbound[index] && !inbound[index].answered;
                return (
                  <View
                    key={`call-${point.time}-${index}`}
                    pointerEvents="none"
                    style={[
                      styles.ratioChartCall,
                      missedCall && styles.ratioChartCallMissed,
                      { left: point.x - 3, top: point.y - 3 },
                    ]}
                  />
                );
              })}
            {current && plotted.length ? (
              <View
                pointerEvents="none"
                style={[
                  styles.ratioChartDot,
                  current.rate < 80 && styles.ratioChartDotMissed,
                  { left: plotted[plotted.length - 1].x - 5, top: plotted[plotted.length - 1].y - 5 },
                ]}
              />
            ) : null}

            {/* Now */}
            {!beforeOpen && !afterClose ? (
              <>
                <View
                  pointerEvents="none"
                  style={[styles.ratioChartNowLine, { left: nowX, top: CHART_LINE_TOP - 4, height: CHART_BARS_BOTTOM - CHART_LINE_TOP + 4 }]}
                />
                <Text
                  pointerEvents="none"
                  style={[
                    styles.ratioChartNowTag,
                    nowX + 30 > width ? { left: nowX - 30 } : { left: nowX + 4 },
                    { top: CHART_LINE_TOP - 12 },
                  ]}
                >
                  Now
                </Text>
              </>
            ) : null}

            {/* Hour ticks */}
            {bins.map((bin, index) => {
              const isFirst = index === 0;
              const isLast = index === bins.length - 1;
              if (isLast && !dense) return null; // the closing-hour label sits right there
              const show = dense || isFirst || bin.hour % 2 === day.openHour % 2;
              if (!show) return null;
              const x = CHART_PAD_L + index * hourW;
              return (
                <Text
                  key={`x-${bin.hour}`}
                  pointerEvents="none"
                  style={[styles.ratioChartX, { left: x - 20, width: 40 }]}
                >
                  {formatHourLabel(bin.hour, { suffix: isFirst || bin.hour === 12 })}
                </Text>
              );
            })}
            <Text
              pointerEvents="none"
              style={[styles.ratioChartX, { right: 4, width: 44, textAlign: 'right' }]}
            >
              {formatHourLabel(day.closeHour, { suffix: true })}
            </Text>

            {!current ? (
              <Text pointerEvents="none" style={[styles.ratioChartEmpty, { top: CHART_LINE_TOP + CHART_LINE_H / 2 - 10 }]}>
                {beforeOpen
                  ? `The day starts at ${formatHourLabel(DAY_OPEN_HOUR, { suffix: true })}.`
                  : 'No inbound calls yet today.'}
              </Text>
            ) : null}

            {picked ? (
              <View pointerEvents="none" style={[styles.ratioChartTip, { left: tooltipLeft, width: tooltipW, top: 2 }]}>
                <Text style={styles.ratioChartTipTitle}>{formatHourRange(picked.hour)}</Text>
                <Text style={styles.ratioChartTipBody}>
                  {picked.total
                    ? `${picked.answered} answered · ${picked.missed} missed · ${picked.rate}%`
                    : 'No inbound calls'}
                </Text>
              </View>
            ) : null}
          </>
        ) : null}
      </View>
      <View style={styles.ratioChartLegend}>
        <View style={styles.ratioChartLegendItem}>
          <View style={styles.ratioChartLegendLine} />
          <Text style={styles.ratioChartLegendText}>Answer rate so far</Text>
        </View>
        <View style={styles.ratioChartLegendItem}>
          <View style={[styles.ratioChartLegendSwatch, { backgroundColor: ACCENT }]} />
          <Text style={styles.ratioChartLegendText}>Answered</Text>
        </View>
        <View style={styles.ratioChartLegendItem}>
          <View style={[styles.ratioChartLegendSwatch, { backgroundColor: MISSED }]} />
          <Text style={styles.ratioChartLegendText}>Missed</Text>
        </View>
        <View style={styles.ratioChartLegendItem}>
          <View style={styles.ratioChartLegendTarget} />
          <Text style={styles.ratioChartLegendText}>80% target</Text>
        </View>
      </View>
    </View>
  );
}

/** One-line state of this browser's softphone registration for a store. */
function browserPhoneLabel(status) {
  if (Platform.OS !== 'web') return 'Use the RingCentral app or desk phone';
  if (!status) return 'Waiting…';
  switch (status.state) {
    case 'ready':
      return status.extensionName ? `Ready in this browser · ${status.extensionName}` : 'Ready in this browser';
    case 'connecting':
      return 'Registering this browser…';
    case 'reconnecting':
      return status.message || 'Reconnecting to RingCentral…';
    case 'shared':
      return status.message || 'Rings through another store’s line';
    case 'other':
      return status.message || 'Needs this store’s own JWT';
    case 'unsupported':
      return status.message || 'Not supported in this browser';
    case 'error':
      return status.message ? `Not registered: ${status.message}` : 'Not registered';
    default:
      return '';
  }
}

export default function PhoneScreen({ session, onRequireLogin, storeFilter, onStoreBackChange, embedded = false }) {
  const canManage = canManageRingCentral(session?.profile);
  const isMobile = useIsMobile();
  const phone = usePhoneCalls();
  const [tab, setTab] = useState('incoming');
  const [dateMode, setDateMode] = useState('today');
  const [startDate, setStartDate] = useState(() => parseDateParam(new Date()));
  const [endDate, setEndDate] = useState(() => parseDateParam(new Date()));
  const [historyByStore, setHistoryByStore] = useState({});
  const [historyLoading, setHistoryLoading] = useState({});
  const [historyError, setHistoryError] = useState('');
  const [historyReload, setHistoryReload] = useState(0);
  const historyRequest = useRef(0);
  const [stores, setStores] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [query, setQuery] = useState('');
  const [selectedKey, setSelectedKey] = useState('');
  const [details, setDetails] = useState(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [showStores, setShowStores] = useState(!storeFilter);
  const [digits, setDigits] = useState('');
  const [callingId, setCallingId] = useState('');
  const [playingId, setPlayingId] = useState('');
  const [playError, setPlayError] = useState('');
  const audioRef = useRef(null);
  const objectUrlRef = useRef('');
  const requestId = useRef(0);
  const detailsRequest = useRef(0);

  const storeKey = phone.selectedStoreKey;
  const refreshInbox = phone.refreshInbox;
  const applyStoreAccount = phone.applyStoreAccount;
  const syncStoreAccounts = phone.syncStoreAccounts;
  const todayKey = formatDateParam(new Date());
  const span = useMemo(() => {
    if (dateMode === 'today') return todayWindow();
    if (dateMode === 'day') return dateWindow(startDate, startDate);
    return dateWindow(startDate, endDate);
  }, [dateMode, endDate, startDate, todayKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const needsHistory = span.start < Date.now() - ROLLING_INBOX_MS;
  const historyFor = useCallback(
    (name) => {
      const key = storeKeyFromName(name);
      const entry = historyByStore[key];
      return entry && entry.windowKey === span.key ? entry : null;
    },
    [historyByStore, span.key],
  );
  /** Calls for a store from whichever source covers the chosen dates. */
  const sourceCalls = useCallback(
    (name) => {
      if (!needsHistory) return callsForStore(phone.mergedCallsByStore, name);
      return historyFor(name)?.calls || [];
    },
    [historyFor, needsHistory, phone.mergedCallsByStore],
  );
  const calls = useMemo(() => sourceCalls(storeKey), [sourceCalls, storeKey]);
  const voicemails = useMemo(
    () => (needsHistory ? historyFor(storeKey)?.voicemails || [] : phone.inboxByStore?.[storeKey]?.voicemails || []),
    [historyFor, needsHistory, phone.inboxByStore, storeKey],
  );
  const inboxLoading = Boolean(phone.inboxFetching?.[storeKey]) || (needsHistory && Boolean(historyLoading[storeKey]));

  const load = useCallback(async () => {
    if (!session?.token) {
      setStores([]);
      setAccounts([]);
      setError('');
      setWarning('');
      return;
    }

    const id = ++requestId.current;
    setLoading(true);
    setError('');
    setWarning('');

    try {
      const [pos, ringcentral] = await Promise.all([
        fetchTransferStores(session),
        listRingCentralAccounts(),
      ]);
      if (id !== requestId.current) return;
      setStores(pos.stores || []);
      setAccounts(ringcentral.rows || []);
      syncStoreAccounts?.(ringcentral.rows || []);
      const notes = [pos.warning];
      if (ringcentral.unavailable) {
        notes.push('RingCentral tables are not installed yet. Run the Phone migration in Supabase.');
      }
      setWarning(notes.filter(Boolean).join(' '));
    } catch (err) {
      if (id !== requestId.current) return;
      setStores([]);
      setAccounts([]);
      setError(err?.message || 'Failed to load stores.');
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [session, syncStoreAccounts]);

  useEffect(() => {
    load();
  }, [load]);

  const loadInbox = useCallback(async () => {
    if (!storeKey) return;
    // Drop this store's cached history so the effect refetches the chosen dates.
    setHistoryByStore((current) => {
      if (!current[storeKey]) return current;
      const next = { ...current };
      delete next[storeKey];
      return next;
    });
    setHistoryReload((n) => n + 1);
    try {
      await refreshInbox(storeKey, { force: true });
      setError('');
    } catch (err) {
      setError(err?.message || 'Could not load calls.');
    }
  }, [refreshInbox, storeKey]);

  const selectDateMode = useCallback(
    (mode) => {
      setDateMode(mode);
      const today = parseDateParam(new Date());
      if (mode === 'today') {
        setStartDate(today);
        setEndDate(today);
      } else if (mode === 'range' && formatDateParam(startDate) === formatDateParam(endDate)) {
        // Open the range on the past week so the pickers start apart.
        const weekAgo = new Date(today.getTime() - 6 * DAY_MS);
        setStartDate(parseDateParam(weekAgo));
        setEndDate(today);
      }
    },
    [endDate, startDate],
  );
  const handleDayChange = useCallback((date) => {
    const next = parseDateParam(date);
    setStartDate(next);
    setEndDate(next);
  }, []);
  const handleStartChange = useCallback(
    (date) => {
      const next = parseDateParam(date);
      setStartDate(next);
      if (next > endDate) setEndDate(next);
    },
    [endDate],
  );
  const handleEndChange = useCallback(
    (date) => {
      const next = parseDateParam(date);
      setEndDate(next);
      if (next < startDate) setStartDate(next);
    },
    [startDate],
  );

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = '';
      }
    };
  }, []);

  const accountByKey = useMemo(() => {
    const next = new Map();
    for (const row of accounts) next.set(row.storeKey, row);
    return next;
  }, [accounts]);

  const rows = useMemo(() => {
    const seen = new Set();
    const next = [];
    const posStores = storeFilter
      ? stores.filter((store) => storeKeyFromName(store.name) === storeKeyFromName(storeFilter))
      : stores;

    for (const store of posStores) {
      const key = storeKeyFromName(store.name);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      next.push({
        key,
        storeName: store.name,
        address: store.address || '',
        posPhone: store.phone || '',
        account: accountByKey.get(key) || null,
      });
    }

    for (const account of accounts) {
      if (seen.has(account.storeKey)) continue;
      if (storeFilter && account.storeKey !== storeKeyFromName(storeFilter)) continue;
      seen.add(account.storeKey);
      next.push({
        key: account.storeKey,
        storeName: account.storeName,
        address: '',
        posPhone: '',
        account,
      });
    }

    const needle = query.trim().toLowerCase();
    const filtered = needle
      ? next.filter((row) =>
          [row.storeName, row.account?.mainNumber, row.account?.companyName, row.posPhone]
            .join(' ')
            .toLowerCase()
            .includes(needle),
        )
      : next;

    filtered.sort((a, b) => a.storeName.localeCompare(b.storeName, undefined, { sensitivity: 'base' }));
    return filtered;
  }, [accounts, accountByKey, query, storeFilter, stores]);

  const selected = rows.find((row) => row.key === selectedKey) || null;
  const connectedStores = useMemo(() => {
    const map = new Map();
    for (const row of rows) {
      if (!row.account?.hasJwt) continue;
      map.set(row.key, {
        ...row.account,
        storeKey: row.key,
        storeName: row.storeName || row.account.storeName,
      });
    }
    for (const row of phone.stores || []) {
      if (storeFilter && row.storeKey !== storeKeyFromName(storeFilter)) continue;
      map.set(row.storeKey, row);
    }
    return [...map.values()].sort((a, b) =>
      String(a.storeName || '').localeCompare(String(b.storeName || ''), undefined, { sensitivity: 'base' }),
    );
  }, [phone.stores, rows, storeFilter]);
  const activeAccount = phone.stores.find((row) => row.storeKey === storeKey) || accountByKey.get(storeKey) || null;
  const incomingLive = useMemo(() => {
    const all = phone.incoming || [];
    const activeId = phone.activeCall?.id;
    const withoutActive = activeId ? all.filter((call) => call.id !== activeId) : all;
    if (!storeFilter) return withoutActive;
    const locked = storeKeyFromName(storeFilter);
    if (!locked) return withoutActive;
    return withoutActive.filter((call) => call.storeKey === locked);
  }, [phone.activeCall?.id, phone.incoming, storeFilter]);
  const rangeLabel = windowCopy(dateMode, startDate, endDate);
  const rangeShort = windowCopy(dateMode, startDate, endDate, { sentence: false });
  const visibleCalls = useMemo(
    () => (Array.isArray(calls) ? calls : []).filter((row) => inWindow(row.startTime, span)),
    [calls, span],
  );
  const visibleVoicemails = useMemo(
    () => (Array.isArray(voicemails) ? voicemails : []).filter((row) => inWindow(row.creationTime, span)),
    [voicemails, span],
  );
  const inboundCalls = useMemo(() => inboundCallsUnique(visibleCalls), [visibleCalls]);
  const todayCalls = useMemo(() => {
    const today = todayWindow();
    return callsForStore(phone.mergedCallsByStore, storeKey).filter((row) => inWindow(row.startTime, today));
  }, [phone.mergedCallsByStore, storeKey]);

  // Stores whose history the chosen dates need: the open store first so its
  // tabs fill quickly, then the rest for the store chips and ratio list.
  const historyStoreKeys = useMemo(() => {
    if (!needsHistory) return [];
    const keys = [];
    if (storeKey && !showStores) keys.push(storeKey);
    for (const row of connectedStores) {
      if (row?.storeKey && !keys.includes(row.storeKey)) keys.push(row.storeKey);
    }
    return keys;
  }, [connectedStores, needsHistory, showStores, storeKey]);

  useEffect(() => {
    if (!historyStoreKeys.length) return undefined;
    const id = ++historyRequest.current;
    const windowKey = span.key;
    const dateFrom = new Date(span.start);
    const dateTo = new Date(span.end);
    let cancelled = false;
    (async () => {
      setHistoryError('');
      let firstError = '';
      for (const key of historyStoreKeys) {
        if (cancelled || id !== historyRequest.current) return;
        const have = historyByStore[key];
        if (have && have.windowKey === windowKey) continue;
        // Store the request id so a superseded run can't clear a newer run's spinner.
        setHistoryLoading((current) => ({ ...current, [key]: id }));
        try {
          const payload = await fetchPhoneHistory(key, { dateFrom, dateTo });
          if (cancelled || id !== historyRequest.current) return;
          setHistoryByStore((current) => ({
            ...current,
            [key]: {
              windowKey,
              calls: payload.calls || [],
              voicemails: payload.voicemails || [],
              callLogError: payload.callLogError || '',
              voicemailError: payload.voicemailError || '',
              at: Date.now(),
            },
          }));
          if (!firstError && payload.callLogError && !(payload.calls || []).length) firstError = payload.callLogError;
        } catch (err) {
          if (cancelled || id !== historyRequest.current) return;
          if (!firstError) firstError = err?.message || 'Could not load calls for those dates.';
        } finally {
          setHistoryLoading((current) => (current[key] === id ? { ...current, [key]: 0 } : current));
        }
      }
      if (!cancelled && id === historyRequest.current && firstError) setHistoryError(firstError);
    })();
    return () => {
      cancelled = true;
    };
    // historyByStore is read for cache hits only; re-running on its change would loop.
  }, [historyReload, historyStoreKeys, span.end, span.key, span.start]); // eslint-disable-line react-hooks/exhaustive-deps
  const outboundCalls = visibleCalls.filter((row) => row.direction === 'Outbound');
  const ratio = useMemo(() => inboundCallRatio(visibleCalls), [visibleCalls]);
  const storeRatios = useMemo(() => {
    const next = {};
    const names = new Set();
    for (const row of rows) {
      if (row?.key) names.add(row.key);
      if (row?.storeName) names.add(row.storeName);
    }
    for (const row of connectedStores) {
      if (row?.storeKey) names.add(row.storeKey);
      if (row?.storeName) names.add(row.storeName);
    }
    for (const name of names) {
      const storeCalls = sourceCalls(name).filter((call) => inWindow(call.startTime, span));
      next[storeKeyFromName(name)] = inboundCallRatio(storeCalls);
    }
    return next;
  }, [connectedStores, rows, sourceCalls, span]);
  const answeredCalls = inboundCalls.filter((row) => isAnsweredInbound(row));
  const missedCalls = inboundCalls.filter((row) => !isAnsweredInbound(row));
  const callLog = useMemo(() => {
    const rows = [...visibleCalls];
    rows.sort((a, b) => String(b.startTime || '').localeCompare(String(a.startTime || '')));
    return rows;
  }, [visibleCalls]);

  const callBack = useCallback(
    async (row) => {
      const number = callbackNumber(row);
      if (!String(number).replace(/\D/g, '')) {
        setError('That call has no number to return.');
        return;
      }
      const id = historyRowKey(row);
      setCallingId(id);
      setDigits(String(number).replace(/[^\d*#+]/g, '').slice(0, 16));
      setTab('dial');
      setError('');
      try {
        await phone.dial(number, { storeKey: row.storeKey || storeKey, from: activeAccount?.mainNumber });
      } catch (err) {
        setError(err?.message || 'Could not start the call.');
      } finally {
        setCallingId((current) => (current === id ? '' : current));
      }
    },
    [activeAccount?.mainNumber, phone.dial, storeKey],
  );

  const goToStoreList = useCallback(() => {
    if (storeFilter) return;
    detailsRequest.current += 1;
    setSelectedKey('');
    setDetails(null);
    setDetailsLoading(false);
    setShowStores(true);
    setError('');
  }, [storeFilter]);

  useEffect(() => {
    const lockedKey = storeFilter ? storeKeyFromName(storeFilter) : '';
    if (!lockedKey) return;
    const row = rows.find((item) => item.key === lockedKey);
    const account =
      (row?.account?.hasJwt && row.account) ||
      (phone.stores || []).find((item) => item.storeKey === lockedKey && item.hasJwt);
    if (account?.hasJwt) {
      setShowStores(false);
      if (phone.selectedStoreKey !== lockedKey) {
        applyStoreAccount?.(account, { select: true, watch: true });
      }
      return;
    }
    if (row) {
      setSelectedKey(row.key);
      setShowStores(true);
    }
  }, [applyStoreAccount, phone.selectedStoreKey, phone.stores, rows, storeFilter]);

  const storeCrumbName = showStores && selected ? selected.storeName : !showStores ? activeAccount?.storeName : '';
  const useOuterCrumb = Boolean(onStoreBackChange) && !isMobile;
  const hideStoreNav = useOuterCrumb || embedded || Boolean(storeFilter);
  const onStoreBackChangeRef = useRef(onStoreBackChange);
  onStoreBackChangeRef.current = onStoreBackChange;

  useEffect(() => {
    const report = onStoreBackChangeRef.current;
    if (!report) return undefined;
    if (storeCrumbName) {
      report(goToStoreList, { dateLabel: storeCrumbName, storeName: storeCrumbName });
      return () => report(null, null);
    }
    report(null, null);
    return undefined;
  }, [goToStoreList, storeCrumbName]);

  useEffect(() => {
    if (!showStores) return undefined;
    let cancelled = false;
    (async () => {
      for (const row of connectedStores) {
        if (cancelled) return;
        try {
          await refreshInbox(row.storeKey, { silent: true });
        } catch {
          // Keep any ratio already loaded for this store.
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [connectedStores, refreshInbox, showStores]);

  const openStore = useCallback(
    (row) => {
      if (!row?.key) return;
      if (row.account?.hasJwt) {
        applyStoreAccount?.(row.account, { select: true, watch: true });
        setShowStores(false);
        setSelectedKey('');
        setDetails(null);
        setError('');
        return;
      }

      detailsRequest.current += 1;
      setSelectedKey(row.key);
      setShowStores(true);
      setDetails(null);
      setError('');
    },
    [applyStoreAccount],
  );

  const activeCall = phone.activeCall || null;
  const inBrowserCall = Boolean(activeCall?.web);
  const browserDialing = Boolean(phone.canDialInBrowser?.(storeKey));

  const appendDigit = (value) => {
    if (inBrowserCall && isConnectedStatus(activeCall?.status)) {
      // During a call the keypad drives the far end (IVR menus, extensions).
      phone.sendDtmf?.(value);
      setDigits((current) => `${current}${value}`.slice(-16));
      return;
    }
    setDigits((current) => `${current}${value}`.replace(/[^\d*#]/g, '').slice(0, 16));
  };

  const placeCall = async () => {
    const number = digits.replace(/[^\d+*#]/g, '');
    if (!number) {
      setError('Enter a number to call.');
      return;
    }
    try {
      await phone.dial(number, { storeKey, from: activeAccount?.mainNumber });
      setError('');
      setDigits('');
    } catch (err) {
      setError(err?.message || 'Could not start the call.');
    }
  };

  const endCall = async () => {
    try {
      await phone.hangup(activeCall);
      setDigits('');
    } catch (err) {
      setError(err?.message || 'Could not hang up.');
    }
  };

  const playVoicemail = async (row) => {
    setPlayError('');
    if (playingId === row.id) {
      audioRef.current?.pause();
      setPlayingId('');
      return;
    }
    try {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = '';
      }
      const url = await fetchVoicemailAudioUrl(row.storeKey || storeKey, row.id, row.attachmentId);
      objectUrlRef.current = url;
      if (typeof Audio === 'undefined') {
        setPlayError('Voicemail playback is available in the browser.');
        return;
      }
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => setPlayingId('');
      await audio.play();
      setPlayingId(row.id);
    } catch (err) {
      setPlayError(err?.message || 'Could not play that voicemail.');
      setPlayingId('');
    }
  };

  const headerActions = (
    <View style={styles.headerActions}>
      <Pressable
        style={[styles.iconBtn, phone.silent && styles.iconBtnActive]}
        onPress={() => phone.setSilent(!phone.silent)}
        accessibilityLabel={phone.silent ? 'Turn ringtone on' : 'Silence ringtone'}
      >
        <Ionicons name={phone.silent ? 'volume-mute' : 'volume-high'} size={16} color={phone.silent ? '#991B1B' : '#1a1a1a'} />
      </Pressable>
      <Pressable
        style={styles.iconBtn}
        onPress={showStores ? load : loadInbox}
        accessibilityLabel="Refresh"
      >
        {(showStores ? loading : inboxLoading) ? (
          <ActivityIndicator size="small" color={ACCENT} />
        ) : (
          <Ionicons name="refresh" size={16} color="#6b6b6b" />
        )}
      </Pressable>
    </View>
  );

  const dateFilter = (
    <DateFilter
      mode={dateMode}
      startDate={startDate}
      endDate={endDate}
      onMode={selectDateMode}
      onDay={handleDayChange}
      onStart={handleStartChange}
      onEnd={handleEndChange}
    />
  );
  const historyBusy = needsHistory && historyStoreKeys.some((key) => historyLoading[key]);
  const historyNote = needsHistory ? (
    historyBusy ? (
      <View style={styles.historyRow}>
        <ActivityIndicator size="small" color={ACCENT} />
        <Text style={styles.sectionMeta}>Loading calls {rangeShort}…</Text>
      </View>
    ) : historyError ? (
      <Text style={styles.warningText}>{historyError}</Text>
    ) : null
  ) : null;

  if (!session?.token) {
    return (
      <View style={[styles.screen, styles.listContent, embedded && styles.screenEmbedded]}>
        <Text style={styles.emptyText}>
          Sign in to view store phones.{' '}
          {onRequireLogin ? (
            <Text style={styles.link} onPress={onRequireLogin}>
              Go to Profile
            </Text>
          ) : null}
        </Text>
      </View>
    );
  }

  if (storeFilter && loading && !storeKey && !selectedKey) {
    return (
      <View style={[styles.screen, styles.centered, embedded && styles.screenEmbedded, { flex: 1 }]}>
        <ActivityIndicator color={ACCENT} />
      </View>
    );
  }

  if (showStores && selected) {
    const account = details?.store || selected.account;
    const status = connectionLabel(account);
    const numbers = details?.numbers || [];
    const extensions = details?.extensions || [];
    return (
      <View style={[styles.screen, embedded && styles.screenEmbedded]}>
        <ScrollView style={styles.list} contentContainerStyle={[styles.listContent, embedded && styles.listContentEmbedded]} showsVerticalScrollIndicator={false}>
          <View style={styles.headerRow}>
            {hideStoreNav ? <View style={styles.headerCopy} /> : <PhoneCrumb storeName={selected.storeName} onStores={goToStoreList} />}
            {headerActions}
          </View>
          {selected.address ? <Text style={styles.sectionMeta}>{selected.address}</Text> : null}

          <View style={styles.statusCard}>
            <Text style={[styles.statusValue, statusTone(account)]}>{status}</Text>
            <DetailRow
              label="Number"
              value={
                account?.mainNumber
                  ? formatPhoneNumber(account.mainNumber)
                  : selected.posPhone
                    ? formatPhoneNumber(selected.posPhone)
                    : ''
              }
            />
            <DetailRow label="Account" value={account?.companyName} />
            <DetailRow label="Account ID" value={account?.accountId} />
            <DetailRow
              label="Extensions"
              value={account?.extensionCount ? String(account.extensionCount) : ''}
            />
            <DetailRow label="Checked" value={formatCheckedAt(account?.lastCheckedAt)} />
            {account?.hasJwt ? (
              <DetailRow label="Answer here" value={browserPhoneLabel(phone.webPhoneStatus?.[selected.key])} />
            ) : null}
            {selected.key === storeKey ? (
              <>
                <Text style={styles.detailLabel}>Answered to missed</Text>
                <RatioStrip stats={ratio} compact rangeLabel={rangeLabel} rangeShort={rangeShort} />
              </>
            ) : null}
            {account?.lastError ? <Text style={styles.cellError}>{account.lastError}</Text> : null}
            {!account?.hasJwt ? (
              <Text style={styles.sectionMeta}>
                {canManage
                  ? 'Add this store’s RingCentral JWT in Settings → RingCentral, then open it again.'
                  : 'This store is not connected yet.'}
              </Text>
            ) : null}
          </View>

          {error && account?.lastStatus !== 'error' ? (
            <View style={styles.errorBanner}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          {detailsLoading ? (
            <View style={styles.centered}>
              <ActivityIndicator color={ACCENT} />
              <Text style={styles.sectionMeta}>Loading numbers and extensions…</Text>
            </View>
          ) : null}

          {numbers.length > 0 ? (
            <View style={styles.section}>
              <Text style={styles.blockTitle}>Numbers</Text>
              {numbers.map((row) => (
                <View key={`${row.phoneNumber}-${row.usageType}`} style={styles.itemRow}>
                  <View style={styles.itemText}>
                    <Text style={styles.itemTitle}>{formatPhoneNumber(row.phoneNumber)}</Text>
                    <Text style={styles.itemMeta}>
                      {[formatUsageType(row.usageType), row.extensionNumber ? `ext ${row.extensionNumber}` : '', row.extensionName]
                        .filter(Boolean)
                        .join(' · ')}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          ) : null}

          {extensions.length > 0 ? (
            <View style={styles.section}>
              <Text style={styles.blockTitle}>Extensions</Text>
              {extensions.map((row) => (
                <View key={row.id || row.extensionNumber} style={styles.itemRow}>
                  <View style={styles.extBadge}>
                    <Text style={styles.extBadgeText}>{row.extensionNumber || '—'}</Text>
                  </View>
                  <View style={styles.itemText}>
                    <Text style={styles.itemTitle}>{row.name || 'Extension'}</Text>
                    <Text style={styles.itemMeta}>
                      {[row.type, row.status, row.email].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          ) : null}

          {account?.hasJwt ? (
            <Pressable style={styles.refreshLink} onPress={() => openStore(selected)} disabled={detailsLoading}>
              <Text style={styles.link}>{detailsLoading ? 'Refreshing…' : 'Refresh'}</Text>
            </Pressable>
          ) : null}
        </ScrollView>
      </View>
    );
  }

  if (showStores) {
    return (
      <View style={[styles.screen, embedded && styles.screenEmbedded]}>
        <ScrollView style={styles.list} contentContainerStyle={[styles.listContent, embedded && styles.listContentEmbedded]} showsVerticalScrollIndicator={false}>
          <View style={styles.headerRow}>
            {hideStoreNav ? <View style={styles.headerCopy} /> : <Text style={styles.crumbCurrent}>Stores</Text>}
            {headerActions}
          </View>
          <Text style={styles.sectionMeta}>
            {canManage
              ? 'Tap a store to open its calls, voicemail, and ratio. Add each store’s RingCentral JWT in Settings → RingCentral.'
              : 'Tap a store to open its calls, voicemail, and ratio.'}
          </Text>
          <View style={styles.toolbar}>
            <View style={styles.search}>
              <Ionicons name="search" size={14} color="#8e8e93" />
              <TextInput
                style={styles.searchInput}
                value={query}
                onChangeText={setQuery}
                placeholder="Search stores"
                placeholderTextColor="#8e8e93"
                autoCapitalize="none"
                autoCorrect={false}
                clearButtonMode="while-editing"
              />
            </View>
          </View>
          {dateFilter}
          {historyNote}
          {warning ? <Text style={styles.warningText}>{warning}</Text> : null}
          {rows.map((row) => {
            const account = row.account;
            const status = connectionLabel(account);
            const storeRatio = storeRatios[row.key] || inboundCallRatio([]);
            const rateLabel = account?.hasJwt ? storeRatio.ratio : '—';
            return (
              <Pressable
                key={row.key}
                style={styles.storeRow}
                onPress={() => openStore(row)}
                accessibilityRole="button"
                accessibilityLabel={`${row.storeName}, ${status}, ${rateLabel} answered`}
              >
                <View style={styles.storeIcon}>
                  <Ionicons name="call-outline" size={16} color={ACCENT} />
                </View>
                <View style={styles.storeText}>
                  <Text style={styles.storeName} numberOfLines={1}>
                    {row.storeName}
                  </Text>
                  <Text style={styles.cellSub} numberOfLines={1}>
                    {[
                      status,
                      account?.mainNumber
                        ? formatPhoneNumber(account.mainNumber)
                        : row.posPhone
                          ? formatPhoneNumber(row.posPhone)
                          : '',
                      storeRatio.total ? `${storeRatio.answered} of ${storeRatio.total}` : '',
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                </View>
                <Text
                  style={[
                    styles.storeRate,
                    storeRatio.rate == null && styles.storeRateMuted,
                    storeRatio.rate != null && storeRatio.rate < 80 && styles.statusError,
                    storeRatio.rate != null && storeRatio.rate >= 80 && styles.statusConnected,
                  ]}
                >
                  {rateLabel}
                </Text>
                <Ionicons name="chevron-forward" size={16} color="#9a9a9a" />
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={[styles.screen, embedded && styles.screenEmbedded]}>
      <ScrollView style={styles.list} contentContainerStyle={[styles.listContent, embedded && styles.listContentEmbedded]} showsVerticalScrollIndicator={false}>
        <View style={styles.headerRow}>
          <View style={styles.headerCopy}>
            {hideStoreNav ? null : activeAccount?.storeName || storeKey ? (
              <PhoneCrumb
                storeName={activeAccount?.storeName || 'Store'}
                onStores={goToStoreList}
              />
            ) : (
              <Text style={styles.crumbCurrent}>Phone</Text>
            )}
          </View>
          {headerActions}
        </View>

        {connectedStores.length > 1 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.storeChips}>
            {connectedStores.map((row) => {
              const active = row.storeKey === storeKey;
              const storeRatio = storeRatios[row.storeKey];
              return (
                <Pressable
                  key={row.storeKey}
                  style={[styles.chip, active && styles.chipActive]}
                  onPress={() => applyStoreAccount?.(row, { select: true, watch: true })}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>{row.storeName}</Text>
                  <Text style={[styles.chipRatio, active && styles.chipRatioActive]}>
                    {storeRatio?.ratio || '—'}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        ) : null}

        {activeAccount ? (
          <Pressable style={styles.compactStatus} onPress={() => setTab('stats')} accessibilityLabel="Open ratio">
            <Text style={[styles.compactStatusText, statusTone(activeAccount)]} numberOfLines={1}>
              {connectionLabel(activeAccount)}
            </Text>
            {activeAccount.mainNumber ? (
              <Text style={styles.compactStatusText} numberOfLines={1}>
                {formatPhoneNumber(activeAccount.mainNumber)}
              </Text>
            ) : null}
            {ratio.total ? (
              <Text style={styles.compactStatusText} numberOfLines={1}>
                {ratio.ratio}
              </Text>
            ) : null}
          </Pressable>
        ) : null}

        {dateFilter}
        {historyNote}

        {activeCall ? (
          <View style={styles.onCallBanner} accessibilityLabel={`${activeCallKicker(activeCall)} ${callPartyLabel(activeCall, { formatPhone: formatPhoneNumber })}`}>
            <View style={styles.itemText}>
              <Text style={styles.liveKicker}>
                {activeCallKicker(activeCall)} · {activeCall.storeName || 'Store'}
              </Text>
              <Text style={styles.inCallParty} numberOfLines={1}>
                {callPartyLabel(activeCall, { formatPhone: formatPhoneNumber })}
              </Text>
              {isConnectedStatus(activeCall.status) ? (
                <CallTimer since={activeCall.answeredAt || Date.parse(activeCall.startTime)} style={styles.inCallTimer} />
              ) : (
                <Text style={styles.sectionMeta}>
                  {activeCall.direction === 'Outbound' ? 'Ringing the other party…' : 'Connecting…'}
                </Text>
              )}
              {phone.audioState === 'blocked' ? (
                <Text style={styles.inCallWarning}>The browser blocked the call audio. Tap the speaker to hear the caller.</Text>
              ) : null}
            </View>
            <View style={styles.liveActions}>
              {phone.audioState === 'blocked' ? (
                <Pressable
                  style={[styles.callBtn, styles.soundBtn]}
                  onPress={() => phone.resumeAudio?.().catch?.(() => {})}
                  accessibilityLabel="Enable sound for this call"
                >
                  <Ionicons name="volume-high" size={14} color="#1a1a1a" />
                </Pressable>
              ) : null}
              {inBrowserCall ? (
                <Pressable
                  style={[styles.callBtn, styles.muteBtn, phone.muted && styles.muteBtnOn]}
                  onPress={phone.toggleMute}
                  disabled={!isConnectedStatus(activeCall.status)}
                  accessibilityLabel={phone.muted ? 'Unmute microphone' : 'Mute microphone'}
                >
                  <Ionicons name={phone.muted ? 'mic-off' : 'mic'} size={14} color={phone.muted ? '#B45309' : '#1a1a1a'} />
                </Pressable>
              ) : null}
              <Pressable
                style={[styles.callBtn, styles.rejectBtn, phone.busy && styles.placeCallDisabled]}
                onPress={endCall}
                disabled={phone.busy}
                accessibilityLabel="Hang up"
              >
                {phone.busy ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.callBtnText}>Hang up</Text>
                )}
              </Pressable>
            </View>
          </View>
        ) : null}

        <View style={styles.tabs}>
          {TABS.map((item) => {
            const active = tab === item.key;
            const badge =
              item.key === 'incoming'
                ? incomingLive.length
                : item.key === 'missed'
                  ? missedCalls.length
                  : item.key === 'voicemail'
                    ? visibleVoicemails.filter((row) => row.readStatus === 'Unread').length
                    : 0;
            return (
              <Pressable key={item.key} style={[styles.tab, active && styles.tabActive]} onPress={() => setTab(item.key)}>
                <Text style={[styles.tabText, active && styles.tabTextActive]}>
                  {item.key === 'stats' && ratio.total ? `${item.label} ${ratio.ratio}` : item.label}
                </Text>
                {badge > 0 ? (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{badge}</Text>
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </View>

        {error || phone.error ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{error || phone.error}</Text>
          </View>
        ) : null}
        {warning ? <Text style={styles.warningText}>{warning}</Text> : null}

        {!storeKey ? (
          <Text style={styles.emptyText}>
            {canManage
              ? 'Connect a store in Settings → RingCentral to make and receive calls.'
              : 'No connected store phone yet.'}
          </Text>
        ) : null}

        {tab === 'incoming' ? (
          <View style={styles.section}>
            {incomingLive.map((call) => (
              <View key={`${call.storeKey}-${call.id}`} style={styles.liveCard}>
                <View style={styles.itemText}>
                  <Text style={styles.liveKicker}>
                    {call.storeName || 'Ringing'}
                  </Text>
                  <Text style={styles.itemTitle} numberOfLines={1}>
                    {partyLine(call, true)}
                  </Text>
                </View>
                <View style={styles.liveActions}>
                  <Pressable
                    style={[styles.callBtn, styles.rejectBtn]}
                    onPress={() => phone.reject(call).catch(() => {})}
                    disabled={phone.busy}
                  >
                    <Text style={styles.callBtnText}>Reject</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.callBtn, styles.answerBtn]}
                    onPress={() => phone.answer(call).catch(() => {})}
                    disabled={phone.busy}
                  >
                    <Text style={styles.callBtnText}>Answer</Text>
                  </Pressable>
                </View>
              </View>
            ))}
            {inboxLoading && inboundCalls.length === 0 ? (
              <View style={styles.centered}>
                <ActivityIndicator color={ACCENT} />
              </View>
            ) : inboundCalls.length === 0 && incomingLive.length === 0 ? (
              <Text style={styles.emptyText}>No incoming calls {rangeLabel}.</Text>
            ) : (
              inboundCalls.map((row) => <CallHistoryRow key={row.id} row={row} inbound />)
            )}
          </View>
        ) : null}

        {tab === 'missed' ? (
          <View style={styles.section}>
            {inboxLoading && missedCalls.length === 0 ? (
              <View style={styles.centered}>
                <ActivityIndicator color={ACCENT} />
              </View>
            ) : missedCalls.length === 0 ? (
              <Text style={styles.emptyText}>No missed calls {rangeLabel}.</Text>
            ) : (
              missedCalls.map((row) => {
                const id = historyRowKey(row);
                return (
                  <CallHistoryRow
                    key={id}
                    row={row}
                    inbound
                    onCallback={callBack}
                    callbackBusy={callingId === id}
                    callbackDisabled={Boolean(callingId) && callingId !== id}
                  />
                );
              })
            )}
          </View>
        ) : null}

        {tab === 'log' ? (
          <View style={styles.section}>
            {inboxLoading && callLog.length === 0 ? (
              <View style={styles.centered}>
                <ActivityIndicator color={ACCENT} />
              </View>
            ) : callLog.length === 0 ? (
              <Text style={styles.emptyText}>No calls {rangeLabel}.</Text>
            ) : (
              callLog.map((row) => (
                <CallHistoryRow
                  key={row.id}
                  row={row}
                  inbound={row.direction !== 'Outbound'}
                  showDirection
                />
              ))
            )}
          </View>
        ) : null}

        {tab === 'dial' ? (
          <View style={styles.section}>
            {activeCall ? (
              <View style={styles.inCallCard}>
                <Text style={styles.sectionMeta}>
                  {inBrowserCall && isConnectedStatus(activeCall.status)
                    ? 'Keypad sends tones to the other side.'
                    : inBrowserCall
                      ? 'Connecting in this browser…'
                      : 'This call is on the store phone.'}
                </Text>
              </View>
            ) : null}
            <TextInput
              style={styles.dialInput}
              value={digits}
              onChangeText={(value) => setDigits(value.replace(/[^\d*#+]/g, '').slice(0, 16))}
              placeholder={activeCall ? '' : 'Enter number'}
              placeholderTextColor="#8e8e93"
              keyboardType="phone-pad"
              textAlign="center"
              editable={!inBrowserCall}
            />
            <View style={styles.keypad}>
              {KEYPAD.map((key) => (
                <Pressable key={key} style={styles.key} onPress={() => appendDigit(key)}>
                  <Text style={styles.keyText}>{key}</Text>
                </Pressable>
              ))}
            </View>
            <View style={styles.dialActions}>
              {inBrowserCall ? (
                <Pressable
                  style={[styles.backspace, phone.muted && styles.muteActive]}
                  onPress={phone.toggleMute}
                  disabled={!isConnectedStatus(activeCall?.status)}
                  accessibilityLabel={phone.muted ? 'Unmute microphone' : 'Mute microphone'}
                >
                  <Ionicons name={phone.muted ? 'mic-off' : 'mic'} size={20} color={phone.muted ? '#B45309' : '#1a1a1a'} />
                </Pressable>
              ) : (
                <Pressable
                  style={styles.backspace}
                  onPress={() => setDigits((current) => current.slice(0, -1))}
                  disabled={!digits}
                >
                  <Ionicons name="backspace-outline" size={20} color={digits ? '#1a1a1a' : '#c4c4c4'} />
                </Pressable>
              )}
              {activeCall ? (
                <Pressable
                  style={[styles.placeCall, styles.hangupCall, phone.busy && styles.placeCallDisabled]}
                  onPress={endCall}
                  disabled={phone.busy}
                  accessibilityLabel="Hang up"
                >
                  {phone.busy ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Ionicons name="call" size={22} color="#fff" style={styles.hangupIcon} />
                  )}
                </Pressable>
              ) : (
                <Pressable
                  style={[styles.placeCall, (!digits || phone.busy) && styles.placeCallDisabled]}
                  onPress={placeCall}
                  disabled={!digits || phone.busy}
                  accessibilityLabel="Call"
                >
                  {phone.busy ? <ActivityIndicator color="#fff" /> : <Ionicons name="call" size={22} color="#fff" />}
                </Pressable>
              )}
            </View>
            <Text style={styles.sectionMeta}>
              {browserDialing
                ? `Calls are placed from this browser${activeAccount?.mainNumber ? ` and show ${formatPhoneNumber(activeAccount.mainNumber)} to the person you call` : ''}.`
                : 'This rings the store phone first, then connects the number you dialed.'}
            </Text>
            {outboundCalls.length === 0 ? (
              <Text style={styles.emptyText}>No outbound calls {rangeLabel}.</Text>
            ) : (
              outboundCalls.map((row) => (
                <Pressable
                  key={row.id}
                  style={styles.itemRow}
                  onPress={() => setDigits((row.to || '').replace(/\D/g, '').slice(-10))}
                >
                  <View style={styles.callIcon}>
                    <Ionicons name="arrow-up" size={14} color={ACCENT} />
                  </View>
                  <View style={styles.itemText}>
                    <Text style={styles.itemTitle}>{partyLine(row, false)}</Text>
                    <Text style={styles.itemMeta}>
                      {[resultLabel(row.result), formatCallWhen(row.startTime), row.duration ? formatDuration(row.duration) : '']
                        .filter(Boolean)
                        .join(' · ')}
                    </Text>
                  </View>
                </Pressable>
              ))
            )}
          </View>
        ) : null}

        {tab === 'voicemail' ? (
          <View style={styles.section}>
            {playError ? <Text style={styles.errorText}>{playError}</Text> : null}
            {inboxLoading && visibleVoicemails.length === 0 ? (
              <View style={styles.centered}>
                <ActivityIndicator color={ACCENT} />
              </View>
            ) : visibleVoicemails.length === 0 ? (
              <Text style={styles.emptyText}>No voicemail {rangeLabel}.</Text>
            ) : (
              visibleVoicemails.map((row) => {
                const unread = row.readStatus === 'Unread';
                return (
                  <View key={row.id} style={styles.itemRow}>
                    <Pressable style={styles.playBtn} onPress={() => playVoicemail(row)} accessibilityLabel={playingId === row.id ? 'Pause voicemail' : 'Play voicemail'}>
                      <Ionicons name={playingId === row.id ? 'pause' : 'play'} size={16} color={ACCENT} />
                    </Pressable>
                    <View style={styles.itemText}>
                      <Text style={[styles.itemTitle, unread && styles.unread]}>
                        {partyLine(row, true)}
                      </Text>
                      <Text style={styles.itemMeta}>
                        {[
                          unread ? 'Unread' : 'Heard',
                          formatCallWhen(row.creationTime),
                          row.duration ? formatDuration(row.duration) : '',
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </Text>
                    </View>
                  </View>
                );
              })
            )}
          </View>
        ) : null}

        {tab === 'stats' ? (
          <View style={styles.section}>
            {connectedStores.length > 1 ? (
              <View style={styles.storeRatioList}>
                {connectedStores.map((row) => {
                  const storeRatio = storeRatios[row.storeKey] || inboundCallRatio([]);
                  const selected = row.storeKey === storeKey;
                  return (
                    <Pressable
                      key={row.storeKey}
                      style={[styles.storeRatioRow, selected && styles.storeRatioRowActive]}
                      onPress={() => applyStoreAccount?.(row, { select: true, watch: true })}
                    >
                      <Text style={[styles.storeRatioName, selected && styles.chipTextActive]} numberOfLines={1}>
                        {row.storeName}
                      </Text>
                      <Text style={styles.storeRatioValue}>
                        {storeRatio.total ? `${storeRatio.answered} answered · ${storeRatio.missed} missed` : 'No inbound'}
                      </Text>
                      <Text style={styles.storeRatioChip}>{storeRatio.ratio}</Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}
            <RatioStrip stats={ratio} rangeLabel={rangeLabel} rangeShort={rangeShort} />
            {dateMode === 'range' && formatDateParam(startDate) !== formatDateParam(endDate) ? null : (
              <RatioDayChart
                calls={dateMode === 'today' ? todayCalls : visibleCalls}
                anchor={span.start + 12 * 60 * 60 * 1000}
                label={rangeLabel}
              />
            )}
            <View style={styles.ratioStats}>
              <View style={styles.ratioStat}>
                <Text style={styles.summaryLabel}>Voicemail</Text>
                <Text style={styles.summaryValue}>{ratio.voicemail}</Text>
              </View>
              <View style={styles.ratioStat}>
                <Text style={styles.summaryLabel}>Rejected</Text>
                <Text style={styles.summaryValue}>{ratio.rejected}</Text>
              </View>
            </View>
            <Text style={styles.blockTitle}>Answered</Text>
            {answeredCalls.length === 0 ? (
              <Text style={styles.emptyText}>No answered inbound calls {rangeLabel}.</Text>
            ) : (
              answeredCalls.map((row) => (
                <View key={row.id} style={styles.itemRow}>
                  <View style={styles.callIcon}>
                    <Ionicons name="arrow-down" size={14} color={ACCENT} />
                  </View>
                  <View style={styles.itemText}>
                    <Text style={styles.itemTitle}>{partyLine(row, true)}</Text>
                    <Text style={styles.itemMeta}>
                      {[resultLabel(row.result), formatCallWhen(row.startTime), row.duration ? formatDuration(row.duration) : '']
                        .filter(Boolean)
                        .join(' · ')}
                    </Text>
                  </View>
                </View>
              ))
            )}
            <Text style={[styles.blockTitle, styles.blockTitleSpaced]}>Missed</Text>
            {missedCalls.length === 0 ? (
              <Text style={styles.emptyText}>No missed inbound calls {rangeLabel}.</Text>
            ) : (
              missedCalls.map((row) => (
                <View key={row.id} style={styles.itemRow}>
                  <View style={styles.callIcon}>
                    <Ionicons name="call-outline" size={14} color="#B91C1C" />
                  </View>
                  <View style={styles.itemText}>
                    <Text style={styles.itemTitle}>{partyLine(row, true)}</Text>
                    <Text style={styles.itemMeta}>
                      {[resultLabel(row.result), formatCallWhen(row.startTime), row.duration ? formatDuration(row.duration) : '']
                        .filter(Boolean)
                        .join(' · ')}
                    </Text>
                  </View>
                </View>
              ))
            )}
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#fff',
  },
  screenEmbedded: {
    backgroundColor: 'transparent',
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 32,
    maxWidth: 720,
    width: '100%',
    alignSelf: 'center',
    gap: 10,
  },
  listContentEmbedded: {
    paddingHorizontal: 16,
    maxWidth: '100%',
    paddingTop: 0,
  },
  section: {
    gap: 4,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  headerCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  crumb: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  crumbLinkHit: {
    paddingVertical: 2,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  crumbLink: {
    fontFamily,
    fontSize: 20,
    fontWeight: '600',
    color: '#6b6b6b',
  },
  crumbSep: {
    fontFamily,
    fontSize: 18,
    color: '#b0b0b0',
  },
  crumbCurrent: {
    fontFamily,
    fontSize: 20,
    fontWeight: '600',
    color: '#1a1a1a',
    flexShrink: 1,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  iconBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f3f3f3',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  iconBtnActive: {
    backgroundColor: '#FEE2E2',
  },
  storesLink: {
    paddingHorizontal: 6,
    paddingVertical: 6,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  sectionTitle: {
    fontFamily,
    fontSize: 16,
    fontWeight: '700',
    color: '#1a1a1a',
  },
  sectionMeta: {
    fontFamily,
    fontSize: 12,
    color: '#8a8a8a',
    lineHeight: 17,
  },
  silentHint: {
    fontFamily,
    fontSize: 12,
    color: '#8a8a8a',
  },
  storeChips: {
    gap: 8,
    paddingBottom: 2,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: '#f3f3f3',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  chipActive: {
    backgroundColor: '#ECFDF5',
  },
  chipText: {
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
    color: '#6b6b6b',
  },
  chipTextActive: {
    color: ACCENT,
  },
  chipRatio: {
    fontFamily,
    fontSize: 11,
    fontWeight: '700',
    color: '#8a8a8a',
  },
  chipRatioActive: {
    color: ACCENT,
  },
  storeRatioList: {
    gap: 6,
    marginBottom: 8,
  },
  storeRatioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: '#f7f7f7',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  storeRatioRowActive: {
    backgroundColor: '#ECFDF5',
  },
  storeRatioName: {
    flex: 1,
    minWidth: 0,
    fontFamily,
    fontSize: 13,
    fontWeight: '700',
    color: '#1a1a1a',
  },
  storeRatioValue: {
    fontFamily,
    fontSize: 11,
    fontWeight: '600',
    color: '#6b6b6b',
  },
  storeRatioChip: {
    fontFamily,
    fontSize: 13,
    fontWeight: '700',
    color: '#1a1a1a',
  },
  compactStatus: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  compactStatusText: {
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
    color: '#6b6b6b',
  },
  dateRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  dateModeGroup: {
    flexDirection: 'row',
    backgroundColor: '#f3f3f3',
    borderRadius: 999,
    padding: 2,
    gap: 2,
  },
  dateChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  dateChipActive: {
    backgroundColor: '#ECFDF5',
  },
  dateRangeSep: {
    fontFamily,
    fontSize: 14,
    color: '#8a8a8a',
  },
  pickChip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e0e0e0',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: '#fff',
    minHeight: 36,
    justifyContent: 'center',
    gap: 1,
  },
  pickChipLabel: {
    fontFamily,
    fontSize: 9,
    fontWeight: '600',
    color: '#8a8a8a',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  pickChipControl: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  pickChipValue: {
    fontFamily,
    fontSize: 13,
    color: '#1a1a1a',
    fontWeight: '500',
  },
  pickModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.28)',
    justifyContent: 'flex-end',
  },
  pickModalCard: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingBottom: 24,
  },
  pickModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e6e6e6',
  },
  pickModalTitle: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  pickModalDone: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: ACCENT,
  },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dateChipText: {
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
    color: '#6b6b6b',
  },
  dateChipTextActive: {
    color: ACCENT,
  },
  callbackBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 28,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: ACCENT,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  callbackBtnDisabled: {
    opacity: 0.6,
  },
  callbackText: {
    fontFamily,
    fontSize: 12,
    fontWeight: '700',
    color: '#fff',
  },
  tabs: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e5e5',
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  tabActive: {
    borderBottomColor: ACCENT,
  },
  tabText: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: '#8a8a8a',
  },
  tabTextActive: {
    color: '#1a1a1a',
  },
  badge: {
    minWidth: 16,
    height: 16,
    paddingHorizontal: 4,
    borderRadius: 8,
    backgroundColor: ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    fontFamily,
    fontSize: 10,
    fontWeight: '700',
    color: '#fff',
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  search: {
    flex: 1,
    minWidth: 160,
    maxWidth: 320,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e0e0e0',
    paddingBottom: 6,
  },
  searchInput: {
    flex: 1,
    fontFamily,
    fontSize: 14,
    color: '#1a1a1a',
    paddingVertical: 0,
    ...Platform.select({
      web: { outlineStyle: 'none' },
      default: {},
    }),
  },
  refresh: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorBanner: {
    marginBottom: 2,
  },
  errorText: {
    fontFamily,
    fontSize: 13,
    color: '#991B1B',
  },
  warningText: {
    fontFamily,
    fontSize: 12,
    color: '#9a6b2f',
  },
  storeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    minHeight: 56,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f0f0f0',
    gap: 10,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  storeIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#ECFDF5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  storeText: {
    flex: 1,
    minWidth: 0,
  },
  storeName: {
    fontFamily,
    fontSize: 14,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  rowStatus: {
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
  },
  storeRate: {
    fontFamily,
    fontSize: 16,
    fontWeight: '700',
    color: '#1a1a1a',
    minWidth: 48,
    textAlign: 'right',
  },
  storeRateMuted: {
    color: '#8a8a8a',
    fontWeight: '600',
  },
  cellSub: {
    fontFamily,
    fontSize: 11,
    color: '#8a8a8a',
    marginTop: 2,
  },
  cellError: {
    fontFamily,
    fontSize: 12,
    color: '#991B1B',
    marginTop: 8,
    lineHeight: 17,
  },
  statusConnected: {
    color: '#15803D',
    fontWeight: '600',
  },
  statusError: {
    color: '#B91C1C',
    fontWeight: '600',
  },
  statusMuted: {
    color: '#8a8a8a',
  },
  link: {
    color: ACCENT,
    fontWeight: '600',
    fontFamily,
    fontSize: 13,
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 24,
    gap: 8,
  },
  emptyText: {
    fontFamily,
    fontSize: 13,
    color: '#8a8a8a',
    paddingTop: 16,
    paddingBottom: 8,
  },
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginBottom: 4,
    alignSelf: 'flex-start',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  backText: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  statusCard: {
    marginTop: 4,
    marginBottom: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e5e5',
    borderRadius: 8,
    padding: 10,
    backgroundColor: '#fafafa',
    gap: 6,
  },
  statusValue: {
    fontFamily,
    fontSize: 14,
    fontWeight: '700',
    color: '#1a1a1a',
  },
  detailRow: {
    gap: 2,
  },
  detailLabel: {
    fontFamily,
    fontSize: 11,
    fontWeight: '600',
    color: '#8a8a8a',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  detailValue: {
    fontFamily,
    fontSize: 14,
    color: '#1a1a1a',
  },
  blockTitle: {
    fontFamily,
    fontSize: 13,
    fontWeight: '700',
    color: '#1a1a1a',
    marginBottom: 4,
  },
  blockTitleSpaced: {
    marginTop: 16,
  },
  ratioBlock: {
    gap: 8,
  },
  ratioBlockCompact: {
    gap: 6,
  },
  ratioStats: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  ratioStat: {
    flexGrow: 1,
    flexBasis: 72,
    minWidth: 70,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: '#F3FBF6',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#D5EBD9',
  },
  ratioStatCompact: {
    paddingVertical: 6,
    paddingHorizontal: 8,
    minWidth: 64,
  },
  summaryLabel: {
    fontFamily,
    fontSize: 11,
    fontWeight: '600',
    color: '#8a8a8a',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 4,
  },
  summaryValue: {
    fontFamily,
    fontSize: 16,
    fontWeight: '700',
    color: '#1a1a1a',
    fontVariant: ['tabular-nums'],
  },
  summaryValueCompact: {
    fontSize: 14,
  },
  ratioBarTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: '#ececec',
    overflow: 'hidden',
    flexDirection: 'row',
  },
  ratioBarTrackCompact: {
    height: 4,
  },
  ratioBarFill: {
    backgroundColor: ACCENT,
    minWidth: 0,
  },
  ratioBarMissed: {
    backgroundColor: '#B91C1C',
    minWidth: 0,
  },
  ratioBarEmpty: {
    flex: 1,
    backgroundColor: '#ececec',
  },
  ratioChart: {
    gap: 6,
    marginTop: 4,
  },
  ratioChartHead: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 8,
  },
  ratioChartHeadText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  ratioChartSub: {
    fontFamily,
    fontSize: 12,
    color: '#6b6b6b',
    fontVariant: ['tabular-nums'],
  },
  ratioChartNow: {
    fontFamily,
    fontSize: 22,
    fontWeight: '700',
    color: '#1a1a1a',
    fontVariant: ['tabular-nums'],
    lineHeight: 26,
  },
  ratioChartFrame: {
    height: CHART_H,
    borderRadius: 10,
    backgroundColor: '#FAFCFB',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#D9E4DC',
    overflow: 'hidden',
    position: 'relative',
  },
  ratioChartEmpty: {
    position: 'absolute',
    left: CHART_PAD_L,
    right: CHART_PAD_R,
    fontFamily,
    fontSize: 13,
    color: '#8a8a8a',
    textAlign: 'center',
  },
  ratioChartY: {
    position: 'absolute',
    left: 0,
    width: CHART_PAD_L - 6,
    textAlign: 'right',
    fontFamily,
    fontSize: 10,
    fontWeight: '600',
    color: '#9a9a9a',
    fontVariant: ['tabular-nums'],
  },
  ratioChartYTarget: {
    color: ACCENT,
  },
  ratioChartLane: {
    position: 'absolute',
    left: 4,
    fontFamily,
    fontSize: 9,
    fontWeight: '600',
    color: '#9a9a9a',
  },
  ratioChartX: {
    position: 'absolute',
    bottom: 4,
    fontFamily,
    fontSize: 10,
    fontWeight: '600',
    color: '#8a8a8a',
    textAlign: 'center',
  },
  ratioChartGuide: {
    position: 'absolute',
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(0, 0, 0, 0.09)',
  },
  ratioChartGuideTarget: {
    height: 1,
    backgroundColor: 'rgba(21, 128, 61, 0.45)',
  },
  ratioChartHour: {
    position: 'absolute',
  },
  ratioChartHourAlt: {
    backgroundColor: 'rgba(0, 0, 0, 0.018)',
  },
  ratioChartHourActive: {
    backgroundColor: 'rgba(21, 128, 61, 0.09)',
  },
  ratioChartBar: {
    position: 'absolute',
    borderRadius: 3,
    overflow: 'hidden',
    flexDirection: 'column',
  },
  ratioChartBarMissed: {
    backgroundColor: MISSED,
    minHeight: 0,
  },
  ratioChartBarAnswered: {
    backgroundColor: ACCENT,
    minHeight: 0,
  },
  ratioChartFuture: {
    position: 'absolute',
    backgroundColor: 'rgba(255, 255, 255, 0.55)',
  },
  ratioChartCall: {
    position: 'absolute',
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: ACCENT,
    borderWidth: 1,
    borderColor: '#fff',
  },
  ratioChartCallMissed: {
    backgroundColor: MISSED,
  },
  ratioChartDot: {
    position: 'absolute',
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: ACCENT,
    borderWidth: 2,
    borderColor: '#fff',
  },
  ratioChartDotMissed: {
    backgroundColor: MISSED,
  },
  ratioChartNowLine: {
    position: 'absolute',
    width: 1,
    backgroundColor: 'rgba(26, 26, 26, 0.35)',
  },
  ratioChartNowTag: {
    position: 'absolute',
    fontFamily,
    fontSize: 9,
    fontWeight: '700',
    color: '#1a1a1a',
    width: 26,
  },
  ratioChartTip: {
    position: 'absolute',
    backgroundColor: '#1a1a1a',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    gap: 1,
  },
  ratioChartTipTitle: {
    fontFamily,
    fontSize: 11,
    fontWeight: '700',
    color: '#fff',
  },
  ratioChartTipBody: {
    fontFamily,
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.85)',
    fontVariant: ['tabular-nums'],
  },
  ratioChartLegend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    paddingHorizontal: 2,
  },
  ratioChartLegendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  ratioChartLegendText: {
    fontFamily,
    fontSize: 11,
    color: '#6b6b6b',
  },
  ratioChartLegendLine: {
    width: 14,
    height: 2.5,
    borderRadius: 2,
    backgroundColor: ACCENT,
  },
  ratioChartLegendSwatch: {
    width: 9,
    height: 9,
    borderRadius: 2,
  },
  ratioChartLegendTarget: {
    width: 14,
    height: 1,
    backgroundColor: 'rgba(21, 128, 61, 0.6)',
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f0f0f0',
  },
  itemText: {
    flex: 1,
    minWidth: 0,
  },
  itemTitle: {
    fontFamily,
    fontSize: 14,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  unread: {
    fontWeight: '700',
  },
  itemMeta: {
    fontFamily,
    fontSize: 12,
    color: '#8a8a8a',
    marginTop: 2,
  },
  extBadge: {
    minWidth: 40,
    height: 24,
    paddingHorizontal: 8,
    borderRadius: 6,
    backgroundColor: '#ECFDF5',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  extBadgeText: {
    fontFamily,
    fontSize: 12,
    fontWeight: '700',
    color: ACCENT,
    fontVariant: ['tabular-nums'],
  },
  refreshLink: {
    marginTop: 16,
    alignSelf: 'flex-start',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  liveCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 8,
    backgroundColor: '#ECFDF5',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#BBF7D0',
    marginBottom: 4,
  },
  liveKicker: {
    fontFamily,
    fontSize: 9,
    fontWeight: '700',
    color: ACCENT,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  liveActions: {
    flexDirection: 'row',
    gap: 4,
  },
  callBtn: {
    minWidth: 56,
    height: 26,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  rejectBtn: {
    backgroundColor: '#B91C1C',
  },
  answerBtn: {
    backgroundColor: ACCENT,
  },
  callBtnText: {
    fontFamily,
    fontSize: 12,
    fontWeight: '700',
    color: '#fff',
  },
  callIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#F3FBF6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dialInput: {
    fontFamily,
    fontSize: 28,
    fontWeight: '700',
    color: '#1a1a1a',
    textAlign: 'center',
    paddingVertical: 8,
    letterSpacing: 1,
    ...Platform.select({
      web: { outlineStyle: 'none' },
      default: {},
    }),
  },
  keypad: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    maxWidth: 280,
    alignSelf: 'center',
    gap: 10,
  },
  key: {
    width: 72,
    height: 56,
    borderRadius: 12,
    backgroundColor: '#f6f6f6',
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  keyText: {
    fontFamily,
    fontSize: 22,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  dialActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 24,
    marginTop: 8,
  },
  backspace: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeCall: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  placeCallDisabled: {
    opacity: 0.45,
  },
  hangupCall: {
    backgroundColor: '#B91C1C',
  },
  hangupIcon: {
    transform: [{ rotate: '135deg' }],
  },
  muteActive: {
    borderRadius: 24,
    backgroundColor: '#FEF3C7',
  },
  inCallCard: {
    gap: 2,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: '#ECFDF5',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#BBF7D0',
  },
  inCallParty: {
    fontFamily,
    fontSize: 16,
    fontWeight: '700',
    color: '#1a1a1a',
  },
  onCallBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: '#ECFDF5',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#BBF7D0',
  },
  inCallTimer: {
    fontFamily,
    fontSize: 13,
    fontWeight: '700',
    color: ACCENT,
    fontVariant: ['tabular-nums'],
  },
  muteBtn: {
    backgroundColor: '#fff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#d4d4d4',
    minWidth: 36,
  },
  muteBtnOn: {
    backgroundColor: '#FEF3C7',
    borderColor: '#F59E0B',
  },
  soundBtn: {
    backgroundColor: '#FCD34D',
    borderWidth: 1,
    borderColor: '#F59E0B',
  },
  inCallWarning: {
    fontFamily,
    fontSize: 12,
    color: '#B45309',
    marginTop: 2,
  },
  playBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#ECFDF5',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
});
