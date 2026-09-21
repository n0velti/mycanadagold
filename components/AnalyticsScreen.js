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
import AsyncStorage from '@react-native-async-storage/async-storage';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import {
  DIMENSIONS,
  INSIGHT_MEASURES,
  MEASURES,
  buildEmployeeInsight,
  chartSeries,
  factsFromTransactions,
  formatMeasure,
  listTriageErrorFacts,
  measureMeta,
  pivotFacts,
} from '../lib/employeeMetrics';
import { findStaffByEmployeeName, listStaffProfiles, staffDisplayName } from '../lib/permissions';
import { storeMarkColor, storeShortCode } from '../lib/storeMarks';
import { MOBILE, useIsMobile } from '../lib/mobileUi';
import {
  defaultDateRange,
  fetchTransactionsAcrossPos,
  formatDateParam,
  formatPickerDate,
  parseDateParam,
} from '../lib/transactions';
import { EmptyState, FONT, StaffAvatar, TriageDrawer } from './TriageKit';

const ACCENT = '#4F46E5';
const TINT = '#EEF2FF';
const CHART_LIMIT = 12;

function FieldToken({ label, active, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      style={({ hovered, pressed }) => [
        styles.token,
        active && styles.tokenOn,
        (hovered || pressed) && !active && styles.tokenHover,
      ]}
    >
      <Text style={[styles.tokenText, active && styles.tokenTextOn]}>{label}</Text>
    </Pressable>
  );
}

function ChoiceRow({ label, hint, children }) {
  return (
    <View style={styles.choiceRow}>
      <View style={styles.choiceCopy}>
        <Text style={styles.choiceLabel}>{label}</Text>
        <Text style={styles.choiceHint}>{hint}</Text>
      </View>
      <View style={styles.tokenRow}>{children}</View>
    </View>
  );
}

function CompareBuilder({ groupBy, measure, onChange }) {
  const groupLabel = DIMENSIONS.find((item) => item.key === groupBy)?.label || 'Employee';
  const measureLabel = measureMeta(measure).label;

  return (
    <View style={styles.compareCard}>
      <View style={styles.compareHead}>
        <Text style={styles.sectionTitle}>Compare</Text>
        <Text style={styles.compareSentence}>
          Showing {measureLabel.toLowerCase()} for each {groupLabel.toLowerCase()}.
        </Text>
      </View>
      <ChoiceRow label="What to count" hint="The number shown in the table">
        {MEASURES.map((item) => (
          <FieldToken
            key={item.key}
            label={item.label}
            active={item.key === measure}
            onPress={() => onChange({ measure: item.key })}
          />
        ))}
      </ChoiceRow>
      <ChoiceRow label="One row for each" hint="How employees and stores are grouped">
        {DIMENSIONS.map((item) => (
          <FieldToken
            key={item.key}
            label={item.label}
            active={item.key === groupBy}
            onPress={() => onChange({ groupBy: item.key })}
          />
        ))}
      </ChoiceRow>
    </View>
  );
}

const SAVED_VIEWS_KEY = 'cgold.analytics.employeeViews';

function viewsStorageKey(userKey) {
  return `${SAVED_VIEWS_KEY}.${userKey || 'local'}`;
}

function parseSavedViews(raw) {
  try {
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return list
      .map((item) => ({
        id: String(item?.id || ''),
        name: String(item?.name || '').trim(),
        groupBy: DIMENSIONS.some((dim) => dim.key === item?.groupBy) ? item.groupBy : 'employee',
        measure: MEASURES.some((entry) => entry.key === item?.measure) ? item.measure : 'transactions',
        startDate: String(item?.startDate || ''),
        endDate: String(item?.endDate || ''),
      }))
      .filter((item) => item.id && item.name);
  } catch {
    return [];
  }
}

async function loadSavedViews(userKey) {
  try {
    return parseSavedViews(await AsyncStorage.getItem(viewsStorageKey(userKey)));
  } catch {
    return [];
  }
}

async function writeSavedViews(userKey, views) {
  await AsyncStorage.setItem(viewsStorageKey(userKey), JSON.stringify(views));
  return views;
}

function SaveViewModal({ visible, defaultName, onCancel, onSave }) {
  const [name, setName] = useState(defaultName);

  useEffect(() => {
    if (visible) setName(defaultName);
  }, [visible, defaultName]);

  const trimmed = name.trim();

  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onCancel}>
      <Pressable style={styles.pickerBackdrop} onPress={onCancel}>
        <Pressable style={styles.saveCard} onPress={(event) => event?.stopPropagation?.()}>
          <Text style={styles.sectionTitle}>Save this view</Text>
          <Text style={styles.sectionHint}>Name the current filters so you can open them again later.</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="e.g. Work days by store"
            placeholderTextColor="#8e8e93"
            autoFocus
            returnKeyType="done"
            onSubmitEditing={() => {
              if (trimmed) onSave(trimmed);
            }}
            style={styles.saveInput}
          />
          <View style={styles.saveActions}>
            <Pressable onPress={onCancel} style={styles.saveGhost}>
              <Text style={styles.saveGhostText}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                if (trimmed) onSave(trimmed);
              }}
              disabled={!trimmed}
              style={[styles.saveConfirm, !trimmed && styles.saveConfirmOff]}
            >
              <Text style={styles.saveConfirmText}>Save</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function personPhoto(staff, name) {
  const person = findStaffByEmployeeName(staff, name);
  return {
    person,
    uri: person?.avatarUrl || person?.photoUrl || '',
    label: staffDisplayName(person) || name,
  };
}

function DateChip({ label, value, onChange, minimumDate, maximumDate, compact }) {
  const [open, setOpen] = useState(false);
  const dateValue = parseDateParam(value);

  const commit = (next) => {
    if (!next) return;
    let date = parseDateParam(next);
    if (minimumDate && date < parseDateParam(minimumDate)) date = parseDateParam(minimumDate);
    if (maximumDate && date > parseDateParam(maximumDate)) date = parseDateParam(maximumDate);
    onChange(formatDateParam(date));
    setOpen(false);
  };

  if (Platform.OS === 'web') {
    return (
      <View style={[styles.dateChip, compact && styles.dateChipCompact]}>
        <Text style={styles.dateChipLabel}>{label}</Text>
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
            fontFamily: FONT,
            fontSize: 13,
            color: '#1d1d1f',
            padding: 0,
            margin: 0,
            outline: 'none',
            cursor: 'pointer',
            minWidth: 0,
            width: compact ? '100%' : 110,
            maxWidth: '100%',
          },
        })}
      </View>
    );
  }

  return (
    <>
      <Pressable style={[styles.dateChip, compact && styles.dateChipCompact]} onPress={() => setOpen(true)}>
        <Text style={styles.dateChipLabel}>{label}</Text>
        <Text style={styles.dateChipValue}>{formatPickerDate(dateValue)}</Text>
      </Pressable>
      {open ? (
        <Modal transparent animationType="fade" onRequestClose={() => setOpen(false)}>
          <Pressable style={styles.pickerBackdrop} onPress={() => setOpen(false)}>
            <View style={styles.pickerCard}>
              <DateTimePicker
                value={dateValue}
                mode="date"
                display="inline"
                minimumDate={minimumDate ? parseDateParam(minimumDate) : undefined}
                maximumDate={maximumDate ? parseDateParam(maximumDate) : undefined}
                onChange={(_, next) => {
                  if (next) commit(next);
                }}
              />
            </View>
          </Pressable>
        </Modal>
      ) : null}
    </>
  );
}

function StoreMark({ name, size = 28 }) {
  const [tip, setTip] = useState(false);
  const code = storeShortCode(name);
  const label = String(name || '').trim();
  if (!code) {
    return <View style={[styles.storeMark, styles.storeMarkEmpty, { width: size, height: size }]} />;
  }
  return (
    <View
      style={[styles.storeMark, { width: size, height: size, backgroundColor: storeMarkColor(name) }, tip && styles.storeMarkTipOn]}
      accessibilityLabel={label}
      accessibilityHint={label}
      {...(Platform.OS === 'web'
        ? {
            title: label,
            onMouseEnter: () => setTip(true),
            onMouseLeave: () => setTip(false),
          }
        : null)}
    >
      <Text style={[styles.storeMarkText, size < 26 && styles.storeMarkTextSm]} numberOfLines={1}>
        {code}
      </Text>
      {tip && label ? (
        <View style={styles.storeTip} pointerEvents="none">
          <Text style={styles.storeTipText}>{label}</Text>
        </View>
      ) : null}
    </View>
  );
}

function MetricChart({ series, format, onSelect }) {
  const [picked, setPicked] = useState('');
  const visible = series.slice(0, CHART_LIMIT);
  const max = Math.max(1, ...visible.map((item) => item.value));
  if (!visible.length) return null;
  const hidden = series.length - visible.length;

  return (
    <View style={styles.chartCard}>
      {visible.map((item) => {
        const pct = Math.max(item.value > 0 ? 4 : 0, (item.value / max) * 100);
        const active = picked === item.key;
        const Row = onSelect ? Pressable : View;
        return (
          <Row
            key={item.key}
            style={[styles.chartRow, active && styles.chartRowOn]}
            onPress={
              onSelect
                ? () => {
                    setPicked(item.key);
                    onSelect(item.key);
                  }
                : undefined
            }
            accessibilityRole={onSelect ? 'button' : undefined}
            accessibilityLabel={item.label}
          >
            <Text style={styles.chartLabel} numberOfLines={1}>
              {item.label}
            </Text>
            <View style={styles.chartTrack}>
              <View style={[styles.chartBar, { width: `${pct}%` }]} />
            </View>
            <Text style={[styles.chartValue, format === 'money' && styles.chartValueMoney]}>
              {formatMeasure(item.value, format)}
            </Text>
          </Row>
        );
      })}
      {hidden > 0 ? (
        <Text style={styles.chartMore}>
          Top {CHART_LIMIT} of {series.length}
        </Text>
      ) : null}
    </View>
  );
}

function valueColumnWidth(format, label, samples = []) {
  const floor = format === 'money' ? 148 : format === 'decimal' ? 88 : 72;
  const longest = Math.max(
    String(label || '').length,
    ...samples.map((sample) => String(sample || '').length),
  );
  return Math.max(floor, Math.ceil(longest * 8.2) + 20);
}

function shortTrendLabel(value) {
  const text = String(value || '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const date = parseDateParam(text);
    return date.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
  }
  return text.slice(0, 3);
}

function RankedRows({
  rows,
  measureKey,
  highlight,
  onSelect,
  showPeople = false,
  staff = [],
  compact = false,
}) {
  const format = measureMeta(measureKey).format;
  const max = Math.max(1, ...rows.map((row) => Number(row.total[measureKey]) || 0));

  return (
    <View style={styles.insightCard}>
      {rows.map((row, index) => {
        const value = Number(row.total[measureKey]) || 0;
        const pct = Math.max(value > 0 ? 6 : 0, (value / max) * 100);
        const mine = row.key === highlight;
        const clickable = Boolean(onSelect);
        const photo = showPeople ? personPhoto(staff, row.key) : null;
        const Row = clickable ? Pressable : View;
        return (
          <Row
            key={row.key}
            onPress={clickable ? () => onSelect(row.key) : undefined}
            accessibilityRole={clickable ? 'button' : undefined}
            accessibilityLabel={`${index + 1}. ${row.key}`}
            style={[styles.rankedRow, mine && styles.chartRowMine]}
          >
            <Text style={styles.rankedIndex} numberOfLines={1}>
              {index + 1}
            </Text>
            {photo ? <StaffAvatar uri={photo.uri} name={photo.label} size={28} /> : null}
            {!compact && !photo && row.store ? <StoreMark name={row.store} size={22} /> : null}
            <View style={[styles.rankedCopy, compact && styles.rankedCopyCompact]}>
              <Text style={styles.rankedName} numberOfLines={1}>
                {row.key}
              </Text>
              {row.role && showPeople ? (
                <Text style={styles.rankedMeta} numberOfLines={1}>
                  {row.role}
                </Text>
              ) : null}
              {compact && format === 'money' ? (
                <Text style={styles.personValue}>{formatMeasure(value, format)}</Text>
              ) : null}
            </View>
            {compact ? null : (
              <View style={styles.rankedTrack}>
                <View style={[styles.rankedBar, mine && styles.chartBarMine, { width: `${pct}%` }]} />
              </View>
            )}
            {compact && format === 'money' ? null : (
              <Text
                style={[
                  styles.rankedValue,
                  format === 'money' && styles.rankedValueMoney,
                  compact && styles.rankedValueCompact,
                ]}
                numberOfLines={1}
              >
                {formatMeasure(value, format)}
              </Text>
            )}
          </Row>
        );
      })}
    </View>
  );
}

function TrendGraph({ rows, measureKey, compact }) {
  const format = measureMeta(measureKey).format;
  if (!rows?.length) {
    return <Text style={styles.drawerHint}>No daily points in this range.</Text>;
  }
  if (compact) {
    return <RankedRows rows={rows} measureKey={measureKey} compact />;
  }
  const max = Math.max(1, ...rows.map((row) => Number(row.total[measureKey]) || 0));

  return (
    <View style={styles.trendCard}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.trendPlot}>
        {rows.map((row) => {
          const value = Number(row.total[measureKey]) || 0;
          const pct = Math.max(value > 0 ? 8 : 0, (value / max) * 100);
          return (
            <View key={row.key} style={[styles.trendCol, format === 'money' && styles.trendColMoney]}>
              <Text style={styles.trendValue}>
                {formatMeasure(value, format)}
              </Text>
              <View style={styles.trendTrack}>
                <View style={[styles.trendBar, { height: `${pct}%` }]} />
              </View>
              <Text style={styles.trendLabel} numberOfLines={1}>
                {shortTrendLabel(row.key)}
              </Text>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

function EmployeeDrawer({ visible, name, facts, staff, onClose, onOpenEmployee }) {
  const compact = useIsMobile();
  const [measureKey, setMeasureKey] = useState('volume');
  const insight = useMemo(() => buildEmployeeInsight(facts, name), [facts, name]);
  const person = useMemo(() => findStaffByEmployeeName(staff, name), [staff, name]);
  const measureInfo = measureMeta(measureKey);

  const peerRows = useMemo(() => {
    if (!insight) return [];
    const sorted = insight.peers
      .slice()
      .sort((a, b) => (b.total[measureKey] || 0) - (a.total[measureKey] || 0));
    const top = sorted.slice(0, 12);
    if (name && !top.some((row) => row.key === name)) {
      const mine = sorted.find((row) => row.key === name);
      if (mine) top.push(mine);
    }
    return top;
  }, [insight, measureKey, name]);

  if (!insight) {
    return (
      <TriageDrawer
        visible={visible}
        onClose={onClose}
        title={name || 'Employee'}
        subtitle="No activity"
        leftLabel="Close"
        widthRatio={0.88}
        minWidth={880}
      >
        <EmptyState
          icon="people-outline"
          title="No activity"
          body="This person has no retail transactions or triage errors in the selected range."
        />
      </TriageDrawer>
    );
  }

  const rank = insight.ranks[measureKey] || {};
  const highlightStats = INSIGHT_MEASURES.filter((item) =>
    ['volume', 'transactions', 'errors', 'staffDays'].includes(item.key),
  );

  return (
    <TriageDrawer
      visible={visible}
      onClose={onClose}
      title={insight.name}
      subtitle={[insight.role, insight.store].filter(Boolean).join(' · ')}
      leftLabel="Close"
      widthRatio={0.88}
      minWidth={880}
    >
      <ScrollView
        style={styles.drawerScroll}
        contentContainerStyle={[styles.drawerBody, compact && styles.drawerBodyCompact]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.hero}>
          <StaffAvatar
            uri={person?.avatarUrl || person?.photoUrl || ''}
            name={staffDisplayName(person) || insight.name}
            size={compact ? 48 : 56}
          />
          <View style={styles.heroCopy}>
            <Text style={styles.heroName} numberOfLines={1}>{insight.name}</Text>
            <Text style={styles.heroMeta} numberOfLines={2}>
              {insight.role}
              {insight.store ? ` · ${insight.store}` : ''}
            </Text>
          </View>
          {compact ? null : <StoreMark name={insight.store} size={36} />}
        </View>

        <View style={styles.statGrid}>
          {highlightStats.map((item) => {
            const entry = insight.ranks[item.key] || {};
            const on = measureKey === item.key;
            return (
              <Pressable
                key={item.key}
                onPress={() => setMeasureKey(item.key)}
                style={[
                  styles.statCard,
                  compact && styles.statCardCompact,
                  on && styles.statCardOn,
                  item.key === 'errors' && entry.value > 0 && styles.statCardWarn,
                ]}
              >
                <Text style={[styles.statLabel, on && styles.statLabelOn]}>{item.label}</Text>
                <Text
                  style={[
                    styles.statValue,
                    compact && styles.statValueCompact,
                    item.key === 'errors' && entry.value > 0 && styles.statValueWarn,
                  ]}
                  numberOfLines={1}
                >
                  {formatMeasure(entry.value, measureMeta(item.key).format)}
                </Text>
                <Text style={styles.statRank}>{entry.rank ? `#${entry.rank} of ${entry.of}` : 'No rank'}</Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.drawerSection}>
          <Text style={styles.drawerTitle}>Compare by</Text>
          <Text style={styles.drawerHint}>Tap a number to change the ranking and graphs below.</Text>
          <View style={styles.rankRow}>
            {INSIGHT_MEASURES.map((item) => {
              const entry = insight.ranks[item.key] || {};
              const on = measureKey === item.key;
              return (
                <Pressable
                  key={item.key}
                  onPress={() => setMeasureKey(item.key)}
                  style={[styles.rankChip, on && styles.rankChipOn]}
                >
                  <Text style={[styles.rankChipKicker, on && styles.rankChipKickerOn]}>{item.label}</Text>
                  <Text style={[styles.rankChipValue, on && styles.rankChipValueOn]} numberOfLines={1}>
                    {formatMeasure(entry.value, measureMeta(item.key).format)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.drawerSection}>
          <Text style={styles.drawerTitle}>
            Standing · {measureInfo.label}
            {rank.rank ? ` · #${rank.rank} of ${rank.of}` : ''}
          </Text>
          <Text style={styles.drawerHint}>Position among other employees in this date range.</Text>
          <RankedRows
            rows={peerRows}
            measureKey={measureKey}
            highlight={insight.name}
            onSelect={onOpenEmployee}
            showPeople
            staff={staff}
            compact={compact}
          />
        </View>

        <View style={styles.drawerSection}>
          <Text style={styles.drawerTitle}>Trend · {measureInfo.label}</Text>
          <Text style={styles.drawerHint}>Day by day for this employee.</Text>
          <TrendGraph rows={insight.byDate.rows} measureKey={measureKey} compact={compact} />
        </View>

        {insight.errors ? (
          <View style={styles.drawerSection}>
            <Text style={styles.drawerTitle}>Triage errors · {insight.errors}</Text>
            <Text style={styles.drawerHint}>Purchases triage marked incorrect for this person.</Text>
            <RankedRows
              rows={insight.errorTypes.map((item) => ({
                key: item.key,
                total: { errors: item.value },
              }))}
              measureKey="errors"
              compact={compact}
            />
          </View>
        ) : null}

        <View style={[styles.drawerSplit, compact && styles.drawerSplitStack]}>
          {insight.byWeekday.rows.length ? (
            <View style={styles.drawerHalf}>
              <Text style={styles.drawerTitle}>By weekday</Text>
              <RankedRows rows={insight.byWeekday.rows} measureKey={measureKey} compact={compact} />
            </View>
          ) : null}
          {insight.byType.rows.length ? (
            <View style={styles.drawerHalf}>
              <Text style={styles.drawerTitle}>Buy / sell</Text>
              <RankedRows rows={insight.byType.rows} measureKey={measureKey} compact={compact} />
            </View>
          ) : null}
        </View>

        {insight.byStore.rows.length > 1 ? (
          <View style={styles.drawerSection}>
            <Text style={styles.drawerTitle}>By store</Text>
            <RankedRows rows={insight.byStore.rows} measureKey={measureKey} compact={compact} />
          </View>
        ) : null}
      </ScrollView>
    </TriageDrawer>
  );
}

function EmployeesAnalytics({ session, storeFilter }) {
  const compact = useIsMobile();
  const range = defaultDateRange(7);
  const [startDate, setStartDate] = useState(range.startDate);
  const [endDate, setEndDate] = useState(range.endDate);
  const [groupBy, setGroupBy] = useState('employee');
  const [measure, setMeasure] = useState('transactions');
  const [selectedEmployee, setSelectedEmployee] = useState('');
  const [staff, setStaff] = useState([]);
  const [rows, setRows] = useState([]);
  const [errorFacts, setErrorFacts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [savedViews, setSavedViews] = useState([]);
  const [savingView, setSavingView] = useState(false);
  const requestId = useRef(0);
  const userKey = session?.supabaseUserId || session?.profile?.id || '';

  const today = formatDateParam(new Date());
  const week = defaultDateRange(7);
  const month = defaultDateRange(30);
  const rangeKey =
    startDate === today && endDate === today
      ? 'today'
      : startDate === week.startDate && endDate === week.endDate
        ? '7'
        : startDate === month.startDate && endDate === month.endDate
          ? '30'
          : 'custom';

  const applyRange = (next) => {
    setStartDate(next.startDate);
    setEndDate(next.endDate);
  };

  const load = useCallback(async () => {
    if (!session?.token) {
      setRows([]);
      setErrorFacts([]);
      setError('');
      setWarning('');
      return;
    }
    const id = ++requestId.current;
    setLoading(true);
    setError('');
    try {
      const [tx, people] = await Promise.all([
        fetchTransactionsAcrossPos(session, { startDate, endDate, includePurchases: true }),
        listStaffProfiles().catch(() => []),
      ]);
      if (id !== requestId.current) return;
      const staffRows = Array.isArray(people) ? people : [];
      const mistakes = await listTriageErrorFacts(staffRows, { startDate, endDate }).catch(() => []);
      if (id !== requestId.current) return;
      setRows(tx.rows || []);
      setStaff(staffRows);
      setErrorFacts(Array.isArray(mistakes) ? mistakes : []);
      setWarning(tx.warning || '');
    } catch (err) {
      if (id !== requestId.current) return;
      setRows([]);
      setErrorFacts([]);
      setError(err?.message || 'Could not load employee activity.');
      setWarning('');
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [session, startDate, endDate]);

  useEffect(() => {
    load();
  }, [load]);

  const facts = useMemo(() => {
    const sales = factsFromTransactions(rows, staff, { storeFilter });
    const lock = String(storeFilter || '').trim();
    const mistakes = lock
      ? errorFacts.filter(
          (fact) =>
            !fact.store ||
            fact.store === '—' ||
            fact.store.localeCompare(lock, undefined, { sensitivity: 'base' }) === 0,
        )
      : errorFacts;
    return [...sales, ...mistakes];
  }, [rows, staff, storeFilter, errorFacts]);
  const pivot = useMemo(
    () => pivotFacts(facts, { groupBy, measure }),
    [facts, groupBy, measure],
  );
  const series = useMemo(() => chartSeries(pivot), [pivot]);
  const measureInfo = measureMeta(measure);
  const showRoleCol = pivot.rowDim === 'employee';
  const employeeRows = pivot.rowDim === 'employee';
  const measureColStyle = {
    minWidth: valueColumnWidth(measureInfo.format, measureInfo.label, [
      formatMeasure(pivot.grand[measure], measureInfo.format),
      ...pivot.rows.slice(0, 24).map((row) => formatMeasure(row.total[measure], measureInfo.format)),
    ]),
  };
  const openEmployee = (name) => {
    if (!name || name === '—' || name === 'Total') return;
    setSelectedEmployee(name);
  };
  const activeView = savedViews.find(
    (view) =>
      view.groupBy === groupBy &&
      view.measure === measure &&
      view.startDate === startDate &&
      view.endDate === endDate,
  );
  const defaultSaveName = `${measureInfo.label} by ${
    DIMENSIONS.find((item) => item.key === groupBy)?.label || 'employee'
  }`;

  useEffect(() => {
    let alive = true;
    loadSavedViews(userKey).then((views) => {
      if (alive) setSavedViews(views);
    });
    return () => {
      alive = false;
    };
  }, [userKey]);

  const rangeOptions = [
    { key: 'today', label: 'Today' },
    { key: '7', label: '7 days' },
    { key: '30', label: '30 days' },
  ];

  const applyCompare = (next) => {
    if (next.groupBy != null) setGroupBy(next.groupBy);
    if (next.measure != null) setMeasure(next.measure);
    if (next.startDate && next.endDate) applyRange({ startDate: next.startDate, endDate: next.endDate });
  };

  const saveCurrentView = async (name) => {
    const next = [
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name,
        groupBy,
        measure,
        startDate,
        endDate,
      },
      ...savedViews,
    ];
    setSavedViews(next);
    setSavingView(false);
    try {
      await writeSavedViews(userKey, next);
    } catch {
      setWarning('Could not save this view.');
    }
  };

  const removeSavedView = async (id) => {
    const next = savedViews.filter((view) => view.id !== id);
    setSavedViews(next);
    try {
      await writeSavedViews(userKey, next);
    } catch {
      setWarning('Could not remove this view.');
    }
  };

  const setStart = (next) => {
    const start = formatDateParam(next);
    setStartDate(start);
    if (start > endDate) setEndDate(start);
  };
  const setEnd = (next) => {
    const end = formatDateParam(next);
    setEndDate(end);
    if (end < startDate) setStartDate(end);
  };

  if (!session?.token) {
    return (
      <View style={[styles.screen, compact && styles.screenCompact]}>
        <EmptyState icon="people-outline" title="Analytics" body="Sign in to compare employee activity." />
      </View>
    );
  }

  return (
    <View style={[styles.screen, compact && styles.screenCompact]}>
      {compact ? null : (
        <View style={styles.header}>
          <View style={styles.headerTitle}>
            <View style={styles.mark}>
              <Ionicons name="people" size={18} color={ACCENT} />
            </View>
            <Text style={styles.title}>Analytics</Text>
          </View>
        </View>
      )}

      <ScrollView
        style={[styles.bodyScroll, compact && styles.bodyScrollCompact]}
        contentContainerStyle={[styles.bodyContent, compact && styles.bodyContentCompact]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.builderPane, compact && styles.builderPaneCompact]}>
          <View style={[styles.rangeStrip, compact && styles.rangeStripStack]}>
            <View style={[styles.rangeMain, compact && styles.rangeMainCompact]}>
              <Text style={styles.sectionTitle}>When</Text>
              <View style={styles.rangeChips}>
                {rangeOptions.map((option) => (
                  <Pressable
                    key={option.key}
                    onPress={() => {
                      if (option.key === '7') applyRange(week);
                      else if (option.key === '30') applyRange(month);
                      else applyRange({ startDate: today, endDate: today });
                    }}
                    style={[styles.rangeChip, rangeKey === option.key && styles.rangeChipOn]}
                  >
                    <Text style={[styles.rangeChipText, rangeKey === option.key && styles.rangeChipTextOn]}>
                      {option.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <View style={[styles.dateRow, compact && styles.dateRowFill]}>
                <DateChip
                  compact={compact}
                  label="From"
                  value={startDate}
                  onChange={setStart}
                  maximumDate={endDate}
                />
                <DateChip
                  compact={compact}
                  label="To"
                  value={endDate}
                  onChange={setEnd}
                  minimumDate={startDate}
                  maximumDate={today}
                />
              </View>
            </View>
            <View style={[styles.rangeSummary, compact && styles.rangeSummaryCompact]}>
              <Text style={styles.rangeSummaryLabel}>{measureInfo.label}</Text>
              <Text style={[styles.rangeSummaryValue, compact && styles.rangeSummaryValueCompact]} numberOfLines={1}>
                {loading ? '—' : formatMeasure(pivot.grand[measure], measureInfo.format)}
              </Text>
              <Text style={styles.rangeSummaryMeta} numberOfLines={2}>
                {storeFilter ? `${storeFilter} · ` : ''}
                {facts.length} events · {pivot.rows.length} {pivot.rowDim}
              </Text>
            </View>
          </View>

          <CompareBuilder
            groupBy={groupBy}
            measure={measure}
            onChange={applyCompare}
          />

          <View style={styles.savedCard}>
            <View style={styles.savedHead}>
              <View style={styles.compareHead}>
                <Text style={styles.sectionTitle}>Saved views</Text>
                <Text style={styles.sectionHint}>Save the current filters and reopen them later.</Text>
              </View>
              <Pressable onPress={() => setSavingView(true)} style={styles.saveButton}>
                <Ionicons name="bookmark-outline" size={14} color={ACCENT} />
                <Text style={styles.saveButtonText}>Save</Text>
              </Pressable>
            </View>
            {savedViews.length ? (
              <View style={styles.savedChips}>
                {savedViews.map((view) => (
                  <View
                    key={view.id}
                    style={[styles.savedChip, activeView?.id === view.id && styles.savedChipOn]}
                  >
                    <Pressable onPress={() => applyCompare(view)} style={styles.savedChipHit}>
                      <Text
                        style={[styles.savedChipText, activeView?.id === view.id && styles.savedChipTextOn]}
                        numberOfLines={1}
                      >
                        {view.name}
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => removeSavedView(view.id)}
                      hitSlop={8}
                      accessibilityLabel={`Remove ${view.name}`}
                      style={styles.savedChipClose}
                    >
                      <Ionicons name="close" size={12} color="#8e8e93" />
                    </Pressable>
                  </View>
                ))}
              </View>
            ) : (
              <Text style={styles.sectionHint}>Nothing saved yet.</Text>
            )}
          </View>
        </View>

        <View style={[styles.itemsPane, compact && styles.itemsPaneCompact]}>
          <View style={[styles.itemsToolbar, compact && styles.itemsToolbarCompact]}>
            <Text style={styles.itemsTitle}>Breakdown</Text>
            {compact ? null : <View style={styles.itemsToolbarSpacer} />}
            <Text style={[styles.itemsMeta, compact && styles.itemsMetaCompact]} numberOfLines={compact ? 2 : 1}>
              {DIMENSIONS.find((item) => item.key === groupBy)?.label}
              {` · ${measureInfo.label}`}
            </Text>
          </View>
          {measureInfo.hint ? <Text style={styles.itemsWarning}>{measureInfo.hint}.</Text> : null}
          {warning ? <Text style={styles.itemsWarning}>{warning}</Text> : null}

          {loading ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator color="#1a1a1a" />
            </View>
          ) : error ? (
            <EmptyState icon="alert-circle-outline" title="Could not load" body={error} />
          ) : !facts.length ? (
            <EmptyState
              icon="bar-chart-outline"
              title="No activity"
              body="No retail transactions in this range, so there is nothing to mix yet."
            />
          ) : (
            <>
              {compact ? null : (
                <MetricChart
                  series={series}
                  format={measureInfo.format}
                  onSelect={employeeRows ? openEmployee : undefined}
                />
              )}
              <View style={[styles.itemsCard, compact && styles.itemsCardCompact]}>
                {compact ? null : (
                  <View style={styles.itemsHead}>
                    <Text style={[styles.itemsHeadLabel, styles.colRank]}>#</Text>
                    <Text style={[styles.itemsHeadLabel, styles.colPerson]}>
                      {DIMENSIONS.find((item) => item.key === pivot.rowDim)?.label}
                    </Text>
                    <Text style={[styles.itemsHeadLabel, styles.colTotal, styles.colHi, measureColStyle]}>
                      {measureInfo.label}
                    </Text>
                    {employeeRows ? <View style={styles.rowChevron} /> : null}
                  </View>
                )}
                {pivot.rows.map((row, index) => {
                  const clickable = employeeRows;
                  const photo = clickable ? personPhoto(staff, row.key) : null;
                  const Row = clickable ? Pressable : View;
                  const rowStyle = [
                    styles.itemsRow,
                    compact && styles.itemsRowCompact,
                    clickable && styles.itemsRowHit,
                  ];
                  const value = formatMeasure(row.total[measure], measureInfo.format);
                  return (
                    <Row
                      key={row.key}
                      style={
                        clickable
                          ? ({ hovered, pressed }) => [
                              ...rowStyle,
                              (hovered || pressed) && styles.itemsRowHover,
                            ]
                          : rowStyle
                      }
                      onPress={clickable ? () => openEmployee(row.key) : undefined}
                      accessibilityRole={clickable ? 'button' : undefined}
                      accessibilityLabel={clickable ? `Open ${row.key}` : undefined}
                    >
                      <Text
                        style={[
                          styles.itemsCell,
                          styles.colRank,
                          compact && styles.colRankCompact,
                          styles.rankText,
                        ]}
                        numberOfLines={1}
                      >
                        {index + 1}
                      </Text>
                      <View style={[styles.itemsCell, styles.colPerson, styles.personCell]}>
                        {photo ? (
                          <StaffAvatar uri={photo.uri} name={photo.label} size={compact ? 32 : 36} />
                        ) : (
                          <StoreMark name={row.store || (pivot.rowDim === 'store' ? row.key : '')} />
                        )}
                        <View style={styles.personCopy}>
                          <Text style={styles.personName} numberOfLines={1}>
                            {row.key}
                          </Text>
                          {showRoleCol ? (
                            <Text style={styles.personRole} numberOfLines={1}>
                              {row.role || ''}
                            </Text>
                          ) : null}
                          {compact && employeeRows && row.store ? (
                            <Text style={styles.personRole} numberOfLines={1}>
                              {row.store}
                            </Text>
                          ) : null}
                          {compact ? (
                            <Text style={styles.personValue}>{value}</Text>
                          ) : null}
                        </View>
                        {!compact && employeeRows ? <StoreMark name={row.store || ''} size={22} /> : null}
                      </View>
                      {compact ? null : (
                        <Text style={[styles.itemsCell, styles.colTotal, styles.cellHi, measureColStyle]}>
                          {value}
                        </Text>
                      )}
                      {clickable ? (
                        <View style={styles.rowChevron}>
                          <Ionicons name="chevron-forward" size={16} color="#c7c7cc" />
                        </View>
                      ) : null}
                    </Row>
                  );
                })}
                <View style={[styles.itemsRow, compact && styles.itemsRowCompact, styles.itemsFoot]}>
                  <Text style={[styles.itemsCell, styles.colRank, compact && styles.colRankCompact]} />
                  <View style={[styles.itemsCell, styles.colPerson, compact && styles.personCopy]}>
                    <Text style={[styles.personName, styles.footText]}>Total</Text>
                    {compact ? (
                      <Text style={[styles.personValue, styles.footText]}>
                        {formatMeasure(pivot.grand[measure], measureInfo.format)}
                      </Text>
                    ) : null}
                  </View>
                  {compact ? null : (
                    <Text style={[styles.itemsCell, styles.colTotal, styles.cellHi, styles.footText, measureColStyle]}>
                      {formatMeasure(pivot.grand[measure], measureInfo.format)}
                    </Text>
                  )}
                  {employeeRows ? <View style={styles.rowChevron} /> : null}
                </View>
              </View>
            </>
          )}
        </View>
      </ScrollView>
      <EmployeeDrawer
        visible={Boolean(selectedEmployee)}
        name={selectedEmployee}
        facts={facts}
        staff={staff}
        onClose={() => setSelectedEmployee('')}
        onOpenEmployee={openEmployee}
      />
      <SaveViewModal
        visible={savingView}
        defaultName={defaultSaveName}
        onCancel={() => setSavingView(false)}
        onSave={saveCurrentView}
      />
    </View>
  );
}

export default function AnalyticsScreen({ session, storeFilter }) {
  return <EmployeesAnalytics session={session} storeFilter={storeFilter} />;
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    minHeight: 0,
    backgroundColor: '#fff',
  },
  screen: {
    flex: 1,
    minHeight: 0,
    backgroundColor: '#fff',
  },
  screenCompact: {
    backgroundColor: MOBILE.bg,
    ...Platform.select({
      web: { overflowX: 'hidden' },
      default: {},
    }),
  },
  header: {
    width: '88%',
    maxWidth: 980,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
    marginTop: 8,
  },
  headerTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  mark: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: TINT,
  },
  title: {
    fontFamily: FONT,
    fontSize: 22,
    fontWeight: '600',
    color: '#1d1d1f',
    letterSpacing: -0.4,
  },
  bodyScroll: {
    flex: 1,
    minHeight: 0,
  },
  bodyScrollCompact: {
    ...Platform.select({
      web: { overflowX: 'hidden' },
      default: {},
    }),
  },
  bodyContent: {
    paddingBottom: 48,
  },
  bodyContentCompact: {
    paddingTop: 12,
    paddingBottom: 40,
  },
  builderPane: {
    width: '88%',
    maxWidth: 980,
    alignSelf: 'center',
    gap: 14,
    marginBottom: 22,
  },
  builderPaneCompact: {
    width: '100%',
    maxWidth: '100%',
    paddingHorizontal: 16,
    marginBottom: 16,
    gap: 12,
  },
  rangeStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e5ea',
    borderRadius: 12,
    backgroundColor: '#fff',
  },
  rangeStripStack: {
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 12,
  },
  rangeMain: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    flex: 1,
    minWidth: 0,
  },
  rangeMainCompact: {
    width: '100%',
    flexDirection: 'column',
    alignItems: 'stretch',
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  dateRowFill: {
    width: '100%',
  },
  rangeChips: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  rangeChip: {
    minHeight: 28,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: '#f2f2f7',
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  rangeChipOn: {
    backgroundColor: TINT,
  },
  rangeChipText: {
    fontFamily: FONT,
    fontSize: 12,
    fontWeight: '500',
    color: '#6e6e73',
  },
  rangeChipTextOn: {
    color: ACCENT,
    fontWeight: '600',
  },
  dateChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 28,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e5ea',
    backgroundColor: '#fafafa',
  },
  dateChipCompact: {
    flex: 1,
    minWidth: 0,
    minHeight: 36,
    overflow: 'hidden',
  },
  dateChipLabel: {
    fontFamily: FONT,
    fontSize: 12,
    fontWeight: '500',
    color: '#8e8e93',
  },
  dateChipValue: {
    fontFamily: FONT,
    fontSize: 13,
    fontWeight: '500',
    color: '#1d1d1f',
  },
  rangeSummary: {
    alignItems: 'flex-end',
    minWidth: 140,
  },
  rangeSummaryCompact: {
    alignItems: 'flex-start',
    minWidth: 0,
    width: '100%',
    paddingTop: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#ececef',
  },
  rangeSummaryValueCompact: {
    fontSize: 28,
    flexShrink: 1,
  },
  rangeSummaryLabel: {
    fontFamily: FONT,
    fontSize: 11,
    fontWeight: '600',
    color: '#8e8e93',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  rangeSummaryValue: {
    fontFamily: FONT,
    fontSize: 22,
    fontWeight: '600',
    color: '#1d1d1f',
    letterSpacing: -0.4,
    fontVariant: ['tabular-nums'],
  },
  rangeSummaryMeta: {
    fontFamily: FONT,
    fontSize: 11,
    color: '#8e8e93',
    marginTop: 2,
  },
  compareCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e5ea',
    borderRadius: 12,
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 12,
  },
  compareHead: {
    gap: 4,
  },
  compareSentence: {
    fontFamily: FONT,
    fontSize: 14,
    color: '#6e6e73',
  },
  sectionTitle: {
    fontFamily: FONT,
    fontSize: 16,
    fontWeight: '600',
    color: '#1d1d1f',
    letterSpacing: -0.2,
  },
  sectionHint: {
    fontFamily: FONT,
    fontSize: 12,
    color: '#8e8e93',
  },
  choiceRow: {
    gap: 8,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#ececef',
  },
  choiceCopy: {
    gap: 2,
  },
  choiceLabel: {
    fontFamily: FONT,
    fontSize: 13,
    fontWeight: '600',
    color: '#1d1d1f',
  },
  choiceHint: {
    fontFamily: FONT,
    fontSize: 12,
    color: '#8e8e93',
  },
  tokenRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  token: {
    minHeight: 32,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#d2d2d7',
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      web: { cursor: 'pointer', userSelect: 'none' },
      default: {},
    }),
  },
  tokenOn: {
    backgroundColor: TINT,
    borderColor: '#c7cbe8',
  },
  tokenHover: {
    backgroundColor: '#f2f2f7',
  },
  tokenText: {
    fontFamily: FONT,
    fontSize: 13,
    fontWeight: '500',
    color: '#3a3a3c',
  },
  tokenTextOn: {
    color: ACCENT,
    fontWeight: '600',
  },
  savedCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e5ea',
    borderRadius: 12,
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  savedHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  saveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 32,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: TINT,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  saveButtonText: {
    fontFamily: FONT,
    fontSize: 13,
    fontWeight: '600',
    color: ACCENT,
  },
  savedChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  savedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 32,
    paddingLeft: 12,
    paddingRight: 6,
    borderRadius: 999,
    backgroundColor: '#f2f2f7',
  },
  savedChipOn: {
    backgroundColor: TINT,
  },
  savedChipHit: {
    maxWidth: 220,
    paddingVertical: 6,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  savedChipClose: {
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  savedChipText: {
    fontFamily: FONT,
    fontSize: 13,
    fontWeight: '500',
    color: '#3a3a3c',
  },
  savedChipTextOn: {
    color: ACCENT,
    fontWeight: '600',
  },
  saveCard: {
    width: 360,
    maxWidth: '100%',
    borderRadius: 16,
    backgroundColor: '#fff',
    padding: 20,
    gap: 12,
  },
  saveInput: {
    fontFamily: FONT,
    fontSize: 15,
    color: '#1d1d1f',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#d2d2d7',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    ...Platform.select({
      web: { outlineStyle: 'none' },
      default: {},
    }),
  },
  saveActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
  saveGhost: {
    minHeight: 36,
    paddingHorizontal: 12,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  saveGhostText: {
    fontFamily: FONT,
    fontSize: 14,
    fontWeight: '500',
    color: '#6e6e73',
  },
  saveConfirm: {
    minHeight: 36,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  saveConfirmOff: {
    opacity: 0.4,
  },
  saveConfirmText: {
    fontFamily: FONT,
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  pickerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.28)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  pickerCard: {
    width: 320,
    maxWidth: '100%',
    borderRadius: 16,
    backgroundColor: '#fff',
    overflow: 'hidden',
  },
  itemsPane: {
    width: '88%',
    maxWidth: 980,
    alignSelf: 'center',
    gap: 10,
  },
  itemsPaneCompact: {
    width: '100%',
    maxWidth: '100%',
    paddingHorizontal: 16,
  },
  itemsToolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  itemsToolbarCompact: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 2,
  },
  itemsMetaCompact: {
    textAlign: 'left',
    flexShrink: 1,
  },
  itemsToolbarSpacer: {
    flex: 1,
    minWidth: 8,
  },
  itemsTitle: {
    fontFamily: FONT,
    fontSize: 13,
    fontWeight: '600',
    color: '#1d1d1f',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  itemsMeta: {
    fontFamily: FONT,
    fontSize: 12,
    color: '#8e8e93',
    flexShrink: 1,
    textAlign: 'right',
  },
  itemsWarning: {
    fontFamily: FONT,
    fontSize: 12,
    color: '#8e8e93',
  },
  loadingBox: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
  },
  chartCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e5ea',
    borderRadius: 12,
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 8,
    ...Platform.select({
      web: { boxShadow: '0 8px 24px rgba(0,0,0,0.04)' },
      default: {},
    }),
  },
  chartRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  chartLabel: {
    flex: 1.1,
    minWidth: 140,
    fontFamily: FONT,
    fontSize: 13,
    color: '#1d1d1f',
  },
  chartTrack: {
    flex: 1,
    height: 10,
    borderRadius: 5,
    backgroundColor: TINT,
    overflow: 'hidden',
  },
  chartBar: {
    height: 10,
    borderRadius: 5,
    backgroundColor: ACCENT,
  },
  chartValue: {
    minWidth: 88,
    flexShrink: 0,
    textAlign: 'right',
    fontFamily: FONT,
    fontSize: 13,
    fontWeight: '600',
    color: '#1d1d1f',
    fontVariant: ['tabular-nums'],
  },
  chartValueMoney: {
    minWidth: 148,
  },
  chartMore: {
    fontFamily: FONT,
    fontSize: 12,
    color: '#8e8e93',
    marginTop: 2,
  },
  itemsCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e5ea',
    borderRadius: 12,
    backgroundColor: '#fff',
    overflow: 'visible',
  },
  itemsCardCompact: {
    overflow: 'hidden',
    borderRadius: 12,
  },
  itemsHead: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 34,
    paddingHorizontal: 8,
    backgroundColor: '#f6f6f9',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ececef',
  },
  itemsHeadLabel: {
    fontFamily: FONT,
    fontSize: 12,
    fontWeight: '600',
    color: '#8e8e93',
    paddingHorizontal: 6,
  },
  itemsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 52,
    paddingHorizontal: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ececef',
    overflow: 'visible',
    zIndex: 1,
  },
  itemsRowCompact: {
    minHeight: 56,
    paddingHorizontal: 12,
    overflow: 'hidden',
  },
  itemsRowHit: {
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  itemsRowHover: {
    backgroundColor: '#f5f5f7',
    zIndex: 8,
  },
  itemsFoot: {
    borderBottomWidth: 0,
    backgroundColor: TINT,
  },
  itemsFootPlain: {
    borderBottomWidth: 0,
  },
  colStore: {
    width: 44,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  storeMark: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible',
    zIndex: 1,
  },
  storeMarkTipOn: {
    zIndex: 20,
  },
  storeTip: {
    position: 'absolute',
    bottom: '110%',
    left: '50%',
    transform: [{ translateX: -70 }],
    width: 140,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#1d1d1f',
    alignItems: 'center',
    ...Platform.select({
      web: { boxShadow: '0 8px 18px rgba(0,0,0,0.18)' },
      default: {},
    }),
  },
  storeTipText: {
    fontFamily: FONT,
    fontSize: 12,
    fontWeight: '600',
    color: '#fff',
    textAlign: 'center',
  },
  storeMarkEmpty: {
    backgroundColor: '#e8e8ed',
  },
  storeMarkText: {
    fontFamily: FONT,
    fontSize: 9,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: 0.3,
  },
  storeMarkTextSm: {
    fontSize: 8,
  },
  rowChevron: {
    width: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chartRowOn: {
    backgroundColor: '#f5f5f7',
    borderRadius: 8,
    marginHorizontal: -6,
    paddingHorizontal: 6,
  },
  chartRowMine: {
    backgroundColor: TINT,
    borderRadius: 8,
    marginHorizontal: -6,
    paddingHorizontal: 6,
  },
  chartBarMine: {
    backgroundColor: ACCENT,
  },
  chartLabelFlex: {
    width: 'auto',
    flex: 0.9,
    minWidth: 90,
  },
  drawerScroll: {
    flex: 1,
    minHeight: 0,
  },
  drawerBody: {
    paddingHorizontal: 24,
    paddingTop: 18,
    paddingBottom: 48,
    gap: 18,
  },
  drawerBodyCompact: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 40,
    gap: 16,
  },
  drawerSection: {
    gap: 8,
  },
  drawerTitle: {
    fontFamily: FONT,
    fontSize: 16,
    fontWeight: '600',
    color: '#1d1d1f',
    letterSpacing: -0.2,
  },
  drawerHint: {
    fontFamily: FONT,
    fontSize: 12,
    color: '#8e8e93',
  },
  drawerSplit: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
  },
  drawerSplitStack: {
    flexDirection: 'column',
  },
  drawerHalf: {
    flexGrow: 1,
    flexBasis: 280,
    minWidth: 0,
    gap: 8,
  },
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  statCard: {
    flexGrow: 1,
    flexBasis: 160,
    minWidth: 156,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e5ea',
    backgroundColor: '#fff',
    gap: 4,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  statCardCompact: {
    flexBasis: '47%',
    minWidth: 0,
  },
  statCardOn: {
    backgroundColor: TINT,
    borderColor: '#c7cbe8',
  },
  statCardWarn: {
    borderColor: '#f4c7c7',
  },
  statLabel: {
    fontFamily: FONT,
    fontSize: 12,
    fontWeight: '600',
    color: '#8e8e93',
  },
  statLabelOn: {
    color: ACCENT,
  },
  statValue: {
    fontFamily: FONT,
    fontSize: 24,
    fontWeight: '600',
    color: '#1d1d1f',
    letterSpacing: -0.4,
    fontVariant: ['tabular-nums'],
  },
  statValueCompact: {
    fontSize: 18,
  },
  statValueWarn: {
    color: '#B42318',
  },
  statRank: {
    fontFamily: FONT,
    fontSize: 12,
    fontWeight: '600',
    color: '#6e6e73',
  },
  rankedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 40,
    paddingVertical: 4,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  rankedIndex: {
    minWidth: 28,
    flexShrink: 0,
    fontFamily: FONT,
    fontSize: 13,
    fontWeight: '600',
    color: '#8e8e93',
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
    ...Platform.select({
      web: { whiteSpace: 'nowrap' },
      default: {},
    }),
  },
  rankedCopy: {
    flex: 0.9,
    minWidth: 90,
    gap: 1,
  },
  rankedCopyCompact: {
    flex: 1,
    minWidth: 0,
  },
  rankedName: {
    fontFamily: FONT,
    fontSize: 14,
    fontWeight: '600',
    color: '#1d1d1f',
  },
  rankedMeta: {
    fontFamily: FONT,
    fontSize: 11,
    color: '#8e8e93',
  },
  rankedTrack: {
    flex: 1,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#f2f2f7',
    overflow: 'hidden',
  },
  rankedBar: {
    height: 10,
    borderRadius: 5,
    backgroundColor: ACCENT,
  },
  rankedValue: {
    minWidth: 88,
    flexShrink: 0,
    textAlign: 'right',
    fontFamily: FONT,
    fontSize: 14,
    fontWeight: '600',
    color: '#1d1d1f',
    fontVariant: ['tabular-nums'],
  },
  rankedValueMoney: {
    minWidth: 148,
  },
  rankedValueCompact: {
    minWidth: 0,
    fontSize: 13,
    ...Platform.select({
      web: { whiteSpace: 'nowrap' },
      default: {},
    }),
  },
  trendCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e5ea',
    borderRadius: 12,
    backgroundColor: '#fff',
    paddingHorizontal: 12,
    paddingVertical: 14,
  },
  trendPlot: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    minHeight: 160,
    paddingHorizontal: 4,
  },
  trendCol: {
    width: 52,
    alignItems: 'center',
    gap: 6,
  },
  trendColMoney: {
    width: 84,
  },
  trendValue: {
    fontFamily: FONT,
    fontSize: 11,
    fontWeight: '600',
    color: '#1d1d1f',
    fontVariant: ['tabular-nums'],
  },
  trendTrack: {
    width: 18,
    height: 110,
    borderRadius: 9,
    backgroundColor: '#f2f2f7',
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  trendBar: {
    width: 18,
    borderRadius: 9,
    backgroundColor: ACCENT,
  },
  trendLabel: {
    fontFamily: FONT,
    fontSize: 11,
    color: '#8e8e93',
  },
  heroCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  heroName: {
    fontFamily: FONT,
    fontSize: 20,
    fontWeight: '600',
    color: '#1d1d1f',
    letterSpacing: -0.3,
  },
  heroMeta: {
    fontFamily: FONT,
    fontSize: 13,
    color: '#6e6e73',
  },
  rankRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  rankChip: {
    minWidth: 96,
    flexGrow: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e5ea',
    backgroundColor: '#fff',
    gap: 2,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  rankChipOn: {
    backgroundColor: TINT,
    borderColor: '#c7cbe8',
  },
  rankChipKicker: {
    fontFamily: FONT,
    fontSize: 11,
    fontWeight: '600',
    color: '#8e8e93',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  rankChipKickerOn: {
    color: ACCENT,
  },
  rankChipValue: {
    fontFamily: FONT,
    fontSize: 18,
    fontWeight: '600',
    color: '#1d1d1f',
  },
  rankChipValueOn: {
    color: '#1d1d1f',
  },
  rankChipOf: {
    fontSize: 12,
    fontWeight: '500',
    color: '#8e8e93',
  },
  rankChipSub: {
    fontFamily: FONT,
    fontSize: 12,
    color: '#6e6e73',
  },
  insightCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e5ea',
    borderRadius: 12,
    backgroundColor: '#fff',
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 8,
  },
  insightCallout: {
    fontFamily: FONT,
    fontSize: 13,
    fontWeight: '600',
    color: ACCENT,
  },
  insightBlock: {
    gap: 8,
  },
  itemsCell: {
    fontFamily: FONT,
    fontSize: 14,
    color: '#1d1d1f',
    paddingHorizontal: 6,
    paddingVertical: 10,
  },
  colPerson: {
    flex: 1.6,
    minWidth: 0,
  },
  personCell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  personCopy: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  personName: {
    fontFamily: FONT,
    fontSize: 14,
    fontWeight: '600',
    color: '#1d1d1f',
  },
  personRole: {
    fontFamily: FONT,
    fontSize: 12,
    color: '#6e6e73',
  },
  personValue: {
    fontFamily: FONT,
    fontSize: 13,
    fontWeight: '600',
    color: ACCENT,
    marginTop: 2,
    fontVariant: ['tabular-nums'],
  },
  colLabel: {
    flex: 1,
    minWidth: 0,
  },
  colRole: {
    width: 140,
  },
  roleCell: {
    color: '#6e6e73',
  },
  colRank: {
    width: 44,
    minWidth: 44,
    flexShrink: 0,
    textAlign: 'right',
    paddingHorizontal: 4,
    ...Platform.select({
      web: { whiteSpace: 'nowrap' },
      default: {},
    }),
  },
  colRankCompact: {
    width: 28,
    minWidth: 28,
    paddingHorizontal: 2,
  },
  rankText: {
    fontFamily: FONT,
    fontSize: 13,
    fontWeight: '600',
    color: '#8e8e93',
    fontVariant: ['tabular-nums'],
    ...Platform.select({
      web: { whiteSpace: 'nowrap' },
      default: {},
    }),
  },
  colNum: {
    minWidth: 72,
    flexShrink: 0,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  colTotal: {
    minWidth: 148,
    flexGrow: 0,
    flexShrink: 0,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  colTotalCompact: {
    minWidth: 0,
    paddingHorizontal: 4,
    fontSize: 13,
    ...Platform.select({
      web: { whiteSpace: 'nowrap' },
      default: {},
    }),
  },
  colHi: {
    color: ACCENT,
  },
  cellHi: {
    fontWeight: '600',
    color: ACCENT,
  },
  footText: {
    fontWeight: '600',
  },
});
