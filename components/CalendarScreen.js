import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { isClockedInName, reloadClockedIn, useIsClockedIn } from '../lib/clockedIn';
import { useIsMobile } from '../lib/mobileUi';
import {
  findStaffByEmployeeName,
  listStaffProfiles,
  staffDisplayName,
  useAppAccess,
} from '../lib/permissions';
import {
  fetchShiftRolesBetween,
  formatShiftDate,
  formatShiftSpan,
  RIPPLING_MAIL_CHECK_MS,
  syncHoursFeed,
  torontoToday,
} from '../lib/ripplingTime';
import { HOME_STORES } from '../lib/transactions';
import { useLiveRefresh } from '../lib/liveRefresh';
import {
  BarButton,
  Chip,
  EmptyState,
  FONT,
  StaffAvatar,
  StatusPill,
  T,
  TextTabs,
} from './TriageKit';

const VIEWS = [
  { key: 'month', label: 'Month' },
  { key: 'week', label: 'Week' },
  { key: 'day', label: 'Day' },
];

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const PERSON_COLORS = [
  { bg: 'rgba(0,122,255,0.12)', fg: '#007AFF' },
  { bg: 'rgba(36,138,61,0.14)', fg: '#248A3D' },
  { bg: 'rgba(180,83,9,0.14)', fg: '#B45309' },
  { bg: 'rgba(175,82,222,0.14)', fg: '#8944AB' },
  { bg: 'rgba(10,132,193,0.14)', fg: '#0A84C1' },
  { bg: 'rgba(215,0,21,0.10)', fg: '#D70015' },
];

function addDaysKey(iso, days) {
  const [year, month, day] = String(iso || '').split('-').map(Number);
  const date = new Date(Date.UTC(year, (month || 1) - 1, day || 1));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function monthStartKey(iso) {
  return `${String(iso || '').slice(0, 7)}-01`;
}

function addMonthsKey(iso, delta) {
  const [year, month] = String(iso || '').split('-').map(Number);
  const date = new Date(Date.UTC(year, (month || 1) - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

function mondayKey(iso) {
  const [year, month, day] = String(iso || '').split('-').map(Number);
  const date = new Date(Date.UTC(year, (month || 1) - 1, day || 1));
  const weekday = date.getUTCDay();
  return addDaysKey(iso, weekday === 0 ? -6 : 1 - weekday);
}

function monthTitle(iso) {
  const [year, month] = String(iso || '').split('-').map(Number);
  const date = new Date(Date.UTC(year, (month || 1) - 1, 1, 12));
  return date.toLocaleDateString('en-CA', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function weekTitle(iso) {
  const start = mondayKey(iso);
  const end = addDaysKey(start, 6);
  const startDate = new Date(`${start}T12:00:00Z`);
  const endDate = new Date(`${end}T12:00:00Z`);
  const sameMonth = start.slice(0, 7) === end.slice(0, 7);
  const startLabel = startDate.toLocaleDateString('en-CA', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
  const endLabel = endDate.toLocaleDateString('en-CA', {
    month: sameMonth ? undefined : 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
  return `${startLabel} – ${endLabel}`;
}

function dayTitle(iso) {
  const date = new Date(`${iso}T12:00:00Z`);
  return date.toLocaleDateString('en-CA', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function monthCells(iso) {
  const start = monthStartKey(iso);
  const [year, month] = start.split('-').map(Number);
  const first = new Date(Date.UTC(year, (month || 1) - 1, 1));
  const weekday = first.getUTCDay();
  const offset = weekday === 0 ? 6 : weekday - 1;
  const days = new Date(Date.UTC(year, month || 1, 0)).getUTCDate();
  const cells = [];
  for (let i = offset; i > 0; i -= 1) cells.push(addDaysKey(start, -i));
  for (let day = 1; day <= days; day += 1) {
    cells.push(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
  }
  while (cells.length % 7 !== 0) cells.push(addDaysKey(cells[cells.length - 1], 1));
  return cells;
}

function locationMatchesStore(locationName, storeName) {
  const store = String(storeName || '').trim().toLowerCase();
  const location = String(locationName || '').trim().toLowerCase();
  if (!store || !location) return false;
  if (location === store) return true;
  return location.includes(store) || store.includes(location);
}

function personColor(name) {
  const text = String(name || 'Staff');
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) hash = (hash * 33 + text.charCodeAt(i)) >>> 0;
  return PERSON_COLORS[hash % PERSON_COLORS.length];
}

function firstName(name) {
  return String(name || '').trim().split(/\s+/)[0] || name || 'Staff';
}

function shiftSort(a, b) {
  const aStart = a.start?.getTime() || 0;
  const bStart = b.start?.getTime() || 0;
  if (aStart !== bStart) return aStart - bStart;
  return String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' });
}

function uniqueLocations(shifts) {
  const names = new Set();
  for (const shift of shifts || []) {
    if (shift.location) names.add(shift.location);
  }
  const list = Array.from(names);
  return list.sort((a, b) => {
    const ai = HOME_STORES.findIndex((store) => locationMatchesStore(a, store));
    const bi = HOME_STORES.findIndex((store) => locationMatchesStore(b, store));
    if (ai >= 0 && bi >= 0) return ai - bi;
    if (ai >= 0) return -1;
    if (bi >= 0) return 1;
    return a.localeCompare(b, undefined, { sensitivity: 'base' });
  });
}

function enrichShift(shift, staff) {
  const person = findStaffByEmployeeName(staff, shift.name);
  return {
    ...shift,
    displayName: person ? staffDisplayName(person) : shift.name,
    avatarUrl: person?.avatarUrl || person?.photoUrl || '',
    staffLocation: person?.locationName || '',
  };
}

function PersonChip({ name, avatarUrl, span, location, compact, showLocation }) {
  const inNow = useIsClockedIn(name);
  const color = personColor(name);
  return (
    <View
      style={[
        styles.personChip,
        compact && styles.personChipCompact,
        { backgroundColor: inNow ? 'rgba(31,138,78,0.14)' : color.bg },
      ]}
    >
      <StaffAvatar uri={avatarUrl} name={name} size={compact ? 16 : 20} />
      <Text
        style={[styles.personChipName, inNow && styles.personChipNameIn]}
        numberOfLines={1}
      >
        {compact ? firstName(name) : name}
      </Text>
      {span ? (
        <Text style={[styles.personChipMeta, inNow && styles.personChipNameIn]} numberOfLines={1}>
          {span}
        </Text>
      ) : null}
      {showLocation && location ? (
        <Text style={styles.personChipMeta} numberOfLines={1}>
          {location}
        </Text>
      ) : null}
      {inNow ? <Text style={styles.inTag}>IN</Text> : null}
    </View>
  );
}

function PersonRow({ person, showLocation }) {
  const inNow = useIsClockedIn(person.displayName);
  return (
    <View style={[styles.personRow, inNow && styles.personRowIn]}>
      <StaffAvatar uri={person.avatarUrl} name={person.displayName} size={40} />
      <View style={styles.personRowCopy}>
        <Text style={styles.personRowName} numberOfLines={1}>
          {person.displayName}
        </Text>
        <Text style={styles.personRowMeta} numberOfLines={1}>
          {[formatShiftSpan(person) || 'Scheduled', person.role, showLocation ? person.location : '']
            .filter(Boolean)
            .join(' · ')}
        </Text>
      </View>
      <StatusPill label={inNow ? 'In' : 'Out'} tone={inNow ? 'green' : 'neutral'} compact />
    </View>
  );
}

function rangeForView(view, cursor) {
  if (view === 'day') return { start: cursor, end: cursor };
  if (view === 'week') {
    const start = mondayKey(cursor);
    return { start, end: addDaysKey(start, 6) };
  }
  const month = monthStartKey(cursor);
  const cells = monthCells(month);
  return { start: cells[0], end: cells[cells.length - 1] };
}

function titleForView(view, cursor) {
  if (view === 'day') return dayTitle(cursor);
  if (view === 'week') return weekTitle(cursor);
  return monthTitle(cursor);
}

export default function CalendarScreen({ session, storeFilter }) {
  const isMobile = useIsMobile();
  const { canFilter } = useAppAccess();
  const lockedLocation = String(storeFilter || '').trim();
  const allowFilters = canFilter('calendar') && !lockedLocation;
  const today = torontoToday();
  useIsClockedIn('__calendar__');
  const [view, setView] = useState('month');
  const [cursor, setCursor] = useState(today);
  const [location, setLocation] = useState(lockedLocation || null);
  const [shifts, setShifts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const requestId = useRef(0);
  const monthKey = monthStartKey(cursor);

  useEffect(() => {
    if (lockedLocation) {
      setLocation(lockedLocation);
      return;
    }
    if (!allowFilters) setLocation(null);
  }, [allowFilters, lockedLocation]);

  const load = useCallback(async ({ silent = false } = {}) => {
    const id = ++requestId.current;
    if (!silent) setLoading(true);
    setError('');
    try {
      await syncHoursFeed().catch(() => {});
      const windowStart = addDaysKey(monthKey, -14);
      const windowEnd = addDaysKey(addMonthsKey(monthKey, 1), 20);
      const [nextShifts, profiles] = await Promise.all([
        fetchShiftRolesBetween(windowStart, windowEnd),
        listStaffProfiles().catch(() => []),
        reloadClockedIn().catch(() => {}),
      ]);
      if (id !== requestId.current) return;
      setShifts((nextShifts || []).map((shift) => enrichShift(shift, profiles || [])));
    } catch (err) {
      if (id !== requestId.current) return;
      setShifts([]);
      setError(err?.message || 'Could not load the schedule.');
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [monthKey]);

  useEffect(() => {
    load();
  }, [load]);

  useLiveRefresh(() => load({ silent: true }), RIPPLING_MAIL_CHECK_MS, true);

  const locations = useMemo(() => uniqueLocations(shifts), [shifts]);

  const locatedShifts = useMemo(() => {
    if (!location) return shifts;
    return shifts.filter(
      (shift) =>
        locationMatchesStore(shift.location, location) ||
        locationMatchesStore(shift.staffLocation, location),
    );
  }, [shifts, location]);

  const visibleShifts = useMemo(() => {
    const { start, end } = rangeForView(view, cursor);
    return locatedShifts
      .filter((shift) => shift.date >= start && shift.date <= end)
      .slice()
      .sort(shiftSort);
  }, [locatedShifts, view, cursor]);

  const byDate = useMemo(() => {
    const map = new Map();
    for (const shift of visibleShifts) {
      const bucket = map.get(shift.date) || [];
      bucket.push(shift);
      map.set(shift.date, bucket);
    }
    return map;
  }, [visibleShifts]);

  const uniqueToday = useMemo(() => {
    const seen = new Set();
    const people = [];
    for (const shift of locatedShifts) {
      if (shift.date !== today) continue;
      const key = shift.id || shift.displayName;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      people.push(shift);
    }
    return people;
  }, [locatedShifts, today]);
  const inToday = uniqueToday.filter((person) => isClockedInName(person.displayName)).length;

  const step = (delta) => {
    if (view === 'day') setCursor((current) => addDaysKey(current, delta));
    else if (view === 'week') setCursor((current) => addDaysKey(current, delta * 7));
    else setCursor((current) => addMonthsKey(monthStartKey(current), delta));
  };

  const goToday = () => setCursor(today);

  const openDay = (date) => {
    setCursor(date);
    setView('day');
  };

  const showLocation = !location;

  return (
    <View style={styles.screen}>
      <View style={styles.body}>
        <View style={styles.toolbar}>
          <TextTabs
            options={VIEWS}
            value={view}
            onChange={setView}
            size="lg"
            layout="inline"
            style={styles.viewTabs}
          />
          <View style={styles.navRow}>
            <Pressable onPress={() => step(-1)} hitSlop={8} accessibilityLabel="Previous" style={styles.navBtn}>
              <Ionicons name="chevron-back" size={18} color={T.text} />
            </Pressable>
            <Text style={styles.title} numberOfLines={1}>
              {titleForView(view, cursor)}
            </Text>
            <Pressable onPress={() => step(1)} hitSlop={8} accessibilityLabel="Next" style={styles.navBtn}>
              <Ionicons name="chevron-forward" size={18} color={T.text} />
            </Pressable>
            {cursor !== today ? (
              <BarButton label="Today" onPress={goToday} />
            ) : null}
            <Pressable
              onPress={() => load()}
              hitSlop={8}
              accessibilityLabel="Refresh schedule"
              style={styles.navBtn}
            >
              {loading ? (
                <ActivityIndicator size="small" color={T.text} />
              ) : (
                <Ionicons name="refresh" size={16} color={T.secondary} />
              )}
            </Pressable>
          </View>
        </View>

        <Text style={styles.summary}>
          {uniqueToday.length
            ? `${uniqueToday.length} scheduled today${inToday ? ` · ${inToday} in` : ''}`
            : 'No one scheduled today'}
          {session?.profile?.locationName && !location
            ? ` · your store ${session.profile.locationName}`
            : ''}
        </Text>

        {allowFilters && locations.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filterRow}
          >
            <Chip label="All locations" selected={!location} onPress={() => setLocation(null)} />
            {locations.map((name) => (
              <Chip
                key={name}
                label={name}
                selected={location === name}
                onPress={() => setLocation((current) => (current === name ? null : name))}
              />
            ))}
          </ScrollView>
        ) : lockedLocation ? (
          <View style={styles.filterRow}>
            <Chip label={lockedLocation} selected />
          </View>
        ) : null}

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        {loading && shifts.length === 0 ? (
          <View style={styles.centered}>
            <ActivityIndicator color={T.text} />
          </View>
        ) : view === 'month' ? (
          <MonthGrid
            cursor={cursor}
            today={today}
            byDate={byDate}
            compact={isMobile}
            showLocation={showLocation}
            onOpenDay={openDay}
          />
        ) : view === 'week' ? (
          <WeekBoard
            cursor={cursor}
            today={today}
            byDate={byDate}
            compact={isMobile}
            showLocation={showLocation}
            onOpenDay={openDay}
          />
        ) : (
          <DayBoard
            cursor={cursor}
            today={today}
            people={byDate.get(cursor) || []}
            showLocation={showLocation}
          />
        )}
      </View>
    </View>
  );
}

function MonthGrid({ cursor, today, byDate, compact, showLocation, onOpenDay }) {
  const month = monthStartKey(cursor);
  const cells = monthCells(month);
  const rows = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
  const preview = compact ? 3 : 4;

  return (
    <View style={styles.board}>
      <View style={styles.weekdays}>
        {WEEKDAYS.map((day) => (
          <Text key={day} style={styles.weekday}>
            {day}
          </Text>
        ))}
      </View>
      <View style={styles.monthGrid}>
        {rows.map((row) => (
          <View key={row[0]} style={styles.monthRow}>
            {row.map((date) => {
              const people = byDate.get(date) || [];
              const inMonth = date.slice(0, 7) === month.slice(0, 7);
              const isToday = date === today;
              return (
                <Pressable
                  key={date}
                  onPress={() => onOpenDay(date)}
                  style={[
                    styles.monthCell,
                    isToday && styles.monthCellToday,
                    !inMonth && styles.monthCellMuted,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={`${formatShiftDate(date)}${
                    people.length
                      ? `, ${people.length} ${people.length === 1 ? 'person' : 'people'} scheduled`
                      : ', no one scheduled'
                  }`}
                >
                  <Text style={[styles.monthDayNum, isToday && styles.monthDayNumToday]}>
                    {Number(date.slice(8))}
                  </Text>
                  <View style={styles.monthPeople}>
                    {people.slice(0, preview).map((person) => (
                      <PersonChip
                        key={person.key || `${date}-${person.id}-${person.displayName}`}
                        name={person.displayName}
                        avatarUrl={person.avatarUrl}
                        span={formatShiftSpan(person)}
                        location={person.location}
                        compact
                        showLocation={showLocation && !compact}
                      />
                    ))}
                    {people.length > preview ? (
                      <Text style={styles.more}>{`+${people.length - preview}`}</Text>
                    ) : null}
                  </View>
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>
    </View>
  );
}

function WeekBoard({ cursor, today, byDate, compact, showLocation, onOpenDay }) {
  const start = mondayKey(cursor);
  const days = Array.from({ length: 7 }, (_, index) => addDaysKey(start, index));

  if (compact) {
    return (
      <ScrollView style={styles.flex} contentContainerStyle={styles.weekMobile} showsVerticalScrollIndicator={false}>
        {days.map((date) => {
          const people = byDate.get(date) || [];
          return (
            <Pressable key={date} onPress={() => onOpenDay(date)} style={styles.weekMobileDay}>
              <View style={styles.weekMobileHead}>
                <Text style={[styles.weekMobileTitle, date === today && styles.monthDayNumToday]}>
                  {formatShiftDate(date)}
                </Text>
                <Text style={styles.weekCount}>
                  {people.length ? `${people.length} scheduled` : 'Off'}
                </Text>
              </View>
              {people.length ? (
                people.map((person) => (
                  <PersonChip
                    key={person.key || `${date}-${person.id}-${person.displayName}`}
                    name={person.displayName}
                    avatarUrl={person.avatarUrl}
                    span={formatShiftSpan(person)}
                    location={person.location}
                    showLocation={showLocation}
                  />
                ))
              ) : (
                <Text style={styles.emptyDay}>No one scheduled</Text>
              )}
            </Pressable>
          );
        })}
      </ScrollView>
    );
  }

  return (
    <View style={styles.board}>
      <View style={styles.weekGrid}>
        {days.map((date) => {
          const people = byDate.get(date) || [];
          const isToday = date === today;
          return (
            <View key={date} style={[styles.weekCol, isToday && styles.monthCellToday]}>
              <Pressable onPress={() => onOpenDay(date)} style={styles.weekColHead}>
                <Text style={[styles.weekday, isToday && styles.monthDayNumToday]}>
                  {WEEKDAYS[days.indexOf(date)]}
                </Text>
                <Text style={[styles.weekColNum, isToday && styles.monthDayNumToday]}>
                  {Number(date.slice(8))}
                </Text>
              </Pressable>
              <ScrollView style={styles.flex} contentContainerStyle={styles.weekColPeople} showsVerticalScrollIndicator={false}>
                {people.length ? (
                  people.map((person) => (
                    <PersonChip
                      key={person.key || `${date}-${person.id}-${person.displayName}`}
                      name={person.displayName}
                      avatarUrl={person.avatarUrl}
                      span={formatShiftSpan(person)}
                      location={person.location}
                      showLocation={showLocation}
                    />
                  ))
                ) : (
                  <Text style={styles.emptyDay}>—</Text>
                )}
              </ScrollView>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function DayBoard({ cursor, today, people, showLocation }) {
  const groups = useMemo(() => {
    if (!showLocation) return [['', people]];
    const map = new Map();
    for (const person of people) {
      const key = person.location || person.staffLocation || 'No location';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(person);
    }
    return Array.from(map.entries());
  }, [people, showLocation]);

  if (!people.length) {
    return (
      <View style={styles.board}>
        <EmptyState
          icon="calendar-outline"
          title={cursor === today ? 'No one scheduled today' : 'No one scheduled'}
          body="Shifts come from the Rippling roster. People who are clocked in show an IN badge."
        />
      </View>
    );
  }

  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.dayList} showsVerticalScrollIndicator={false}>
      {groups.map(([group, rows]) => (
        <View key={group || 'all'} style={styles.dayGroup}>
          {group ? <Text style={styles.dayGroupTitle}>{group}</Text> : null}
          {rows.map((person) => (
            <PersonRow
              key={person.key || `${cursor}-${person.id}-${person.displayName}-${person.startLabel}`}
              person={person}
              showLocation={showLocation && !group}
            />
          ))}
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    minHeight: 0,
    backgroundColor: '#F2F2F7',
  },
  body: {
    flex: 1,
    gap: 10,
    minHeight: 0,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
  },
  toolbar: {
    gap: 8,
  },
  viewTabs: {
    alignSelf: 'flex-start',
  },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  navBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    backgroundColor: T.fillSoft,
  },
  title: {
    flex: 1,
    fontFamily: FONT,
    fontSize: 20,
    fontWeight: '600',
    color: T.text,
    letterSpacing: -0.4,
  },
  summary: {
    fontFamily: FONT,
    fontSize: 13,
    color: T.secondary,
  },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingRight: 8,
  },
  errorText: {
    fontFamily: FONT,
    fontSize: 13,
    color: T.red,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flex: {
    flex: 1,
    minHeight: 0,
  },
  board: {
    flex: 1,
    minHeight: 0,
    backgroundColor: T.card,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: T.hairline,
    overflow: 'hidden',
  },
  weekdays: {
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: T.hairline,
  },
  weekday: {
    flex: 1,
    textAlign: 'center',
    fontFamily: FONT,
    fontSize: 11,
    fontWeight: '600',
    color: T.secondary,
    paddingVertical: 8,
  },
  monthGrid: {
    flex: 1,
    minHeight: 0,
  },
  monthRow: {
    flex: 1,
    flexDirection: 'row',
    minHeight: 0,
  },
  monthCell: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    paddingHorizontal: 4,
    paddingTop: 6,
    paddingBottom: 4,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: T.hairline,
    gap: 4,
  },
  monthCellToday: {
    backgroundColor: 'rgba(180,83,9,0.06)',
  },
  monthCellMuted: {
    opacity: 0.42,
  },
  monthDayNum: {
    fontFamily: FONT,
    fontSize: 12,
    fontWeight: '600',
    color: T.text,
  },
  monthDayNumToday: {
    color: '#B45309',
  },
  monthPeople: {
    flex: 1,
    minHeight: 0,
    gap: 3,
  },
  more: {
    fontFamily: FONT,
    fontSize: 10,
    fontWeight: '600',
    color: T.secondary,
    paddingLeft: 2,
  },
  personChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 7,
    paddingHorizontal: 5,
    paddingVertical: 3,
    minHeight: 22,
  },
  personChipCompact: {
    paddingVertical: 2,
    minHeight: 20,
  },
  personChipName: {
    flexShrink: 1,
    fontFamily: FONT,
    fontSize: 11,
    fontWeight: '600',
    color: T.text,
    letterSpacing: -0.2,
  },
  personChipNameIn: {
    color: '#15803D',
  },
  personChipMeta: {
    marginLeft: 'auto',
    fontFamily: FONT,
    fontSize: 10,
    color: T.secondary,
  },
  inTag: {
    fontFamily: FONT,
    fontSize: 8,
    fontWeight: '700',
    letterSpacing: 0.4,
    color: '#15803D',
  },
  weekGrid: {
    flex: 1,
    flexDirection: 'row',
    minHeight: 0,
  },
  weekCol: {
    flex: 1,
    minWidth: 0,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: T.hairline,
  },
  weekColHead: {
    alignItems: 'center',
    paddingTop: 4,
    paddingBottom: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: T.hairline,
    gap: 0,
  },
  weekColNum: {
    fontFamily: FONT,
    fontSize: 18,
    fontWeight: '600',
    color: T.text,
    letterSpacing: -0.4,
  },
  weekColPeople: {
    padding: 6,
    gap: 6,
  },
  weekMobile: {
    gap: 10,
    paddingBottom: 24,
  },
  weekMobileDay: {
    backgroundColor: T.card,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: T.hairline,
    padding: 12,
    gap: 8,
  },
  weekMobileHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 8,
  },
  weekMobileTitle: {
    fontFamily: FONT,
    fontSize: 16,
    fontWeight: '600',
    color: T.text,
  },
  weekCount: {
    fontFamily: FONT,
    fontSize: 12,
    color: T.secondary,
  },
  emptyDay: {
    fontFamily: FONT,
    fontSize: 12,
    color: T.tertiary,
    paddingVertical: 6,
  },
  dayList: {
    gap: 16,
    paddingBottom: 24,
  },
  dayGroup: {
    backgroundColor: T.card,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: T.hairline,
    overflow: 'hidden',
  },
  dayGroupTitle: {
    fontFamily: FONT,
    fontSize: 13,
    fontWeight: '600',
    color: T.secondary,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 4,
  },
  personRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: T.hairline,
  },
  personRowIn: {
    backgroundColor: 'rgba(31,138,78,0.05)',
  },
  personRowCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  personRowName: {
    fontFamily: FONT,
    fontSize: 16,
    fontWeight: '600',
    color: T.text,
    letterSpacing: -0.2,
  },
  personRowMeta: {
    fontFamily: FONT,
    fontSize: 13,
    color: T.secondary,
  },
});
