/**
 * Rippling hours without the paid API. A scheduled Rippling report is emailed
 * as CSV to a company Gmail inbox; the proxy holds that inbox's refresh token
 * and imports the newest file into `rippling_time_entries`. This module is the
 * client side: connect the inbox (HR / GM / System Admin), ask the proxy to
 * sync, and read per-employee hours for the Employees screen.
 */
import { Platform } from 'react-native';
import { buildGmailAuthorizeUrl, getGmailRedirectUri } from './gmail';
import { proxyJson } from './proxy';
import { getSupabase } from './supabase';

const OAUTH_STATE_KEY = 'cgold_rippling_time_oauth_state';
// Must start with "gmail." so the Rippling OAuth card ignores this callback.
const OAUTH_STATE_PREFIX = 'gmail.hours.';

function asString(value) {
  if (value == null) return '';
  return String(value).trim();
}

export function canManageHoursFeed(profile) {
  if (profile?.isSystemAdmin || profile?.appRole === 'system_admin') return true;
  return profile?.appRole === 'general_manager' || profile?.appRole === 'hr';
}

// ---------------------------------------------------------------------------
// Google OAuth for the hours inbox (web only, same Google app as Emails)
// ---------------------------------------------------------------------------

export function createHoursOAuthState() {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  return `${OAUTH_STATE_PREFIX}${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

export function persistHoursOAuthState(state) {
  if (Platform.OS === 'web' && typeof sessionStorage !== 'undefined') {
    sessionStorage.setItem(OAUTH_STATE_KEY, state);
  }
}

export function readHoursOAuthState() {
  if (Platform.OS === 'web' && typeof sessionStorage !== 'undefined') {
    return sessionStorage.getItem(OAUTH_STATE_KEY) || '';
  }
  return '';
}

export function clearHoursOAuthState() {
  if (Platform.OS === 'web' && typeof sessionStorage !== 'undefined') {
    sessionStorage.removeItem(OAUTH_STATE_KEY);
  }
}

/** The Google redirect that belongs to the hours inbox flow, or null. */
export function readHoursOAuthCallback() {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search || '');
  const code = params.get('code');
  const state = params.get('state') || '';
  const error = params.get('error');
  const errorDescription = params.get('error_description');
  if (!code && !error) return null;
  if (!state.startsWith(OAUTH_STATE_PREFIX)) return null;
  const expected = readHoursOAuthState();
  if (!expected || expected !== state) return null;
  return { code, state, error, errorDescription };
}

export function clearHoursOAuthCallbackFromUrl() {
  if (Platform.OS !== 'web' || typeof window === 'undefined' || !window.history?.replaceState) {
    return;
  }
  const url = new URL(window.location.href);
  for (const key of ['code', 'state', 'error', 'error_description', 'scope', 'authuser', 'hd', 'prompt']) {
    url.searchParams.delete(key);
  }
  window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
}

export function buildHoursAuthorizeUrl({ clientId, loginHint }) {
  const redirectUri = getGmailRedirectUri();
  if (!redirectUri) throw new Error('Connect the hours mailbox from the web app.');
  const state = createHoursOAuthState();
  persistHoursOAuthState(state);
  // No hosted-domain hint. The hours inbox is a specific Gmail account, not the
  // Workspace account used by the Emails screen. Skip incremental auth so a
  // previous profile-only grant cannot hide the Gmail permission.
  return buildGmailAuthorizeUrl({ clientId, redirectUri, state, loginHint, includeGrantedScopes: false });
}

// ---------------------------------------------------------------------------
// Proxy calls
// ---------------------------------------------------------------------------

function mapStatus(payload) {
  return {
    configured: Boolean(payload?.configured),
    clientId: asString(payload?.clientId),
    connected: Boolean(payload?.connected),
    email: asString(payload?.email).toLowerCase(),
    lastAttemptAt: payload?.lastAttemptAt || null,
    lastSyncedAt: payload?.lastSyncedAt || null,
    lastMessageAt: payload?.lastMessageAt || null,
    attachmentName: asString(payload?.attachmentName),
    rowCount: Number(payload?.rowCount) || 0,
    rangeStart: payload?.rangeStart || null,
    rangeEnd: payload?.rangeEnd || null,
    lastError: asString(payload?.lastError),
    clockReportedAt: payload?.clockReportedAt || null,
    clockedInCount: Number(payload?.clockedInCount) || 0,
    canManage: Boolean(payload?.canManage),
    savedMailbox: Boolean(payload?.savedMailbox),
    sync: payload?.sync || null,
    syncError: asString(payload?.syncError),
  };
}

export async function loadHoursFeedStatus() {
  return mapStatus(await proxyJson('rippling/time/status'));
}

export async function connectHoursMailbox({ code, redirectUri }) {
  const payload = await proxyJson('rippling/time/connect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, redirectUri }),
  });
  return mapStatus(payload);
}

export async function disconnectHoursMailbox() {
  return mapStatus(await proxyJson('rippling/time/disconnect', { method: 'POST' }));
}

/**
 * Ask the proxy to look for a newer report. Cheap to call on every screen
 * load: the server skips it if it checked in the last few minutes. `force`
 * bypasses the cooldown and is honoured only for HR / GM / System Admin.
 */
/** Drop one or more CSV files onto the Rippling screen. The last file is what it shows. */
export async function uploadRipplingCsvFiles(files) {
  const list = (Array.isArray(files) ? files : []).filter((file) => file?.csv);
  if (!list.length) throw new Error('Drop a CSV file.');
  return proxyJson('rippling/time/drop', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      files: list.map((file) => ({
        name: asString(file.name) || 'report.csv',
        csv: String(file.csv),
      })),
    }),
  });
}

export async function syncHoursFeed({ force = false } = {}) {
  return mapStatus(
    await proxyJson('rippling/time/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ force: Boolean(force) }),
    }),
  );
}

// ---------------------------------------------------------------------------
// Hours summary (reads Supabase directly; RLS = active staff)
// ---------------------------------------------------------------------------

export function normalizePersonName(value) {
  return asString(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function pushNameKey(keys, key) {
  if (key && !keys.includes(key)) keys.push(key);
}

/**
 * Keys that let a Rippling CSV name match a staff portrait.
 * Profiles are often "Vincent B." while the CSV says "Vincent Bruening".
 */
export function personNameKeys(value) {
  const norm = normalizePersonName(String(value || '').split('·')[0].split('|')[0]);
  if (!norm) return [];
  const keys = [norm];
  const parts = norm.split(' ').filter(Boolean);
  if (parts.length >= 2) {
    const first = parts[0];
    const last = parts[parts.length - 1];
    pushNameKey(keys, `${first} ${last}`);
    pushNameKey(keys, `${last} ${first}`);
    pushNameKey(keys, `${first} ${last.charAt(0)}`);
    pushNameKey(keys, `${parts.slice(0, -1).join(' ')} ${last.charAt(0)}`);
    if (parts.length === 2) pushNameKey(keys, `${parts[1]} ${parts[0].charAt(0)}`);
  }
  return keys;
}

function mapEntry(row) {
  const start = row?.start ? new Date(row.start) : null;
  const end = row?.end ? new Date(row.end) : null;
  return {
    key: asString(row?.key),
    date: asString(row?.date),
    start: start && !Number.isNaN(start.getTime()) ? start : null,
    end: end && !Number.isNaN(end.getTime()) ? end : null,
    minutes: row?.minutes == null ? null : Number(row.minutes) || 0,
  };
}

function emptySummaryRow(id, name) {
  return {
    id: asString(id),
    name: asString(name),
    todayMinutes: 0,
    weekMinutes: 0,
    lastWeekMinutes: 0,
    monthMinutes: 0,
    monthShifts: 0,
    openSince: null,
    lastEntryDate: '',
    entries: [],
    clockedIn: false,
    clockReportedAt: null,
  };
}

function mapSummary(row) {
  const openSince = row?.open_since ? new Date(row.open_since) : null;
  return {
    ...emptySummaryRow(row?.id, row?.name),
    todayMinutes: Number(row?.today_minutes) || 0,
    weekMinutes: Number(row?.week_minutes) || 0,
    lastWeekMinutes: Number(row?.last_week_minutes) || 0,
    monthMinutes: Number(row?.month_minutes) || 0,
    monthShifts: Number(row?.month_shifts) || 0,
    openSince: openSince && !Number.isNaN(openSince.getTime()) ? openSince : null,
    lastEntryDate: asString(row?.last_entry_date),
    entries: (Array.isArray(row?.entries) ? row.entries : []).map(mapEntry),
  };
}

/** A clock-in snapshot older than a work day is treated as unknown, not "in". */
export const CLOCK_STATUS_MAX_AGE_MS = 18 * 60 * 60_000;

async function fetchClockStatus() {
  const { data, error } = await getSupabase()
    .from('rippling_clock_status')
    .select('employee_rippling_id, employee_name, is_clocked_in, reported_at')
    .eq('is_clocked_in', true)
    .limit(1000);
  if (error) throw new Error(error.message || 'Could not load clock-in status.');
  return (Array.isArray(data) ? data : [])
    .map((row) => {
      const reportedAt = row?.reported_at ? new Date(row.reported_at) : null;
      return {
        id: asString(row?.employee_rippling_id),
        name: asString(row?.employee_name),
        reportedAt: reportedAt && !Number.isNaN(reportedAt.getTime()) ? reportedAt : null,
      };
    })
    .filter((row) => row.id);
}

/**
 * Per-employee hours (Mon–Sun weeks, Toronto time) with the last `recentDays`
 * of shifts, plus who is clocked in right now. Returns { byId, byName, list }
 * for cheap lookups from either the Rippling worker id or a display name.
 */
export async function fetchHoursSummary({ recentDays = 14 } = {}) {
  const [summaryResult, clockResult] = await Promise.all([
    getSupabase().rpc('rippling_hours_summary', { p_recent_days: recentDays }),
    fetchClockStatus().catch(() => []),
  ]);
  if (summaryResult.error) throw new Error(summaryResult.error.message || 'Could not load hours.');
  const list = (Array.isArray(summaryResult.data) ? summaryResult.data : []).map(mapSummary).filter((row) => row.id);
  const byId = new Map();
  const byName = new Map();
  const index = (row) => {
    byId.set(row.id, row);
    for (const key of personNameKeys(row.name)) {
      if (key && !byName.has(key)) byName.set(key, row);
    }
  };
  for (const row of list) index(row);

  const freshAfter = Date.now() - CLOCK_STATUS_MAX_AGE_MS;
  let clockedInCount = 0;
  for (const clock of clockResult) {
    const fresh = Boolean(clock.reportedAt) && clock.reportedAt.getTime() >= freshAfter;
    let row = byId.get(clock.id) || null;
    if (!row) {
      for (const key of personNameKeys(clock.name)) {
        row = byName.get(key);
        if (row) break;
      }
    }
    if (!row) {
      row = emptySummaryRow(clock.id, clock.name);
      list.push(row);
      index(row);
    }
    row.clockedIn = fresh;
    row.clockReportedAt = clock.reportedAt;
    if (fresh) clockedInCount += 1;
  }

  return { list, byId, byName, clockedInCount };
}

/** Recent CSV files, newest first, with whether each arrived by email or was dropped in. */
export async function fetchRipplingCsvFiles() {
  const { data, error } = await getSupabase()
    .from('rippling_csv_files')
    .select('id, attachment_name, source, received_at, row_count, kind, is_current')
    .order('received_at', { ascending: false })
    .limit(20);
  if (error) {
    if (/does not exist|schema cache|could not find/i.test(error.message || '')) return [];
    throw new Error(error.message || 'Could not load CSV files.');
  }
  return (Array.isArray(data) ? data : []).map((row) => ({
    id: asString(row?.id),
    name: asString(row?.attachment_name) || 'CSV',
    source: asString(row?.source) === 'drop' ? 'drop' : 'email',
    receivedAt: row?.received_at || null,
    rowCount: Number(row?.row_count) || 0,
    kind: asString(row?.kind),
    current: Boolean(row?.is_current),
  }));
}

/** The newest CSV the hours inbox received. One row; the Rippling screen renders it. */
export async function fetchRipplingReport() {
  const { data, error } = await getSupabase()
    .from('rippling_report_snapshot')
    .select('subject, from_address, received_at, attachment_name, headers, rows, row_count, updated_at')
    .eq('id', true)
    .maybeSingle();
  if (error) {
    if (/does not exist|schema cache|could not find/i.test(error.message || '')) return null;
    throw new Error(error.message || 'Could not load the Rippling report.');
  }
  if (!data || !Array.isArray(data.headers) || !data.headers.length) return null;
  return {
    subject: asString(data.subject),
    from: asString(data.from_address),
    receivedAt: data.received_at || null,
    attachmentName: asString(data.attachment_name),
    headers: data.headers.map((cell) => asString(cell)),
    rows: (Array.isArray(data.rows) ? data.rows : []).map((line) =>
      (Array.isArray(line) ? line : []).map((cell) => asString(cell)),
    ),
    rowCount: Number(data.row_count) || 0,
    updatedAt: data.updated_at || null,
  };
}

/** Find the hours row for a person by Rippling id first, then by name. */
export function hoursForPerson(summary, { ripplingId, names } = {}) {
  if (!summary) return null;
  const id = asString(ripplingId);
  if (id && summary.byId.has(id)) return summary.byId.get(id);
  for (const candidate of Array.isArray(names) ? names : [names]) {
    for (const key of personNameKeys(candidate)) {
      if (summary.byName.has(key)) return summary.byName.get(key);
    }
  }
  return null;
}

/** Clock in/out rows in a date window. Paged so a long report is not cut off at 1,000. */
export async function fetchTimeEntriesBetween(startDate, endDate) {
  const start = asString(startDate).slice(0, 10);
  const end = asString(endDate).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return [];
  const rows = [];
  const pageSize = 1000;
  for (let from = 0; from < 8000; from += pageSize) {
    const { data, error } = await getSupabase()
      .from('rippling_time_entries')
      .select('employee_rippling_id, employee_name, entry_date, minutes')
      .gte('entry_date', start)
      .lte('entry_date', end)
      .order('entry_date', { ascending: true })
      .order('employee_rippling_id', { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) {
      if (/does not exist|schema cache|could not find/i.test(error.message || '')) return [];
      throw new Error(error.message || 'Could not load hours for analytics.');
    }
    const batch = Array.isArray(data) ? data : [];
    rows.push(...batch);
    if (batch.length < pageSize) break;
  }
  return rows.map((row) => ({
    id: asString(row?.employee_rippling_id),
    name: asString(row?.employee_name),
    date: asString(row?.entry_date).slice(0, 10),
    minutes: row?.minutes == null ? 0 : Number(row.minutes) || 0,
  }));
}

/** Every clock in/out stored for one person, newest day first. */
export async function fetchTimeEntries(ripplingId) {
  const id = asString(ripplingId);
  if (!id) return [];
  const { data, error } = await getSupabase()
    .from('rippling_time_entries')
    .select('entry_key, entry_date, started_at, ended_at, minutes')
    .eq('employee_rippling_id', id)
    .order('entry_date', { ascending: false })
    .order('started_at', { ascending: false })
    .limit(500);
  if (error) throw new Error(error.message || 'Could not load clock history.');
  return (Array.isArray(data) ? data : []).map((row) => {
    const start = row?.started_at ? new Date(row.started_at) : null;
    const end = row?.ended_at ? new Date(row.ended_at) : null;
    return {
      key: asString(row?.entry_key),
      date: asString(row?.entry_date).slice(0, 10),
      start: start && !Number.isNaN(start.getTime()) ? start : null,
      end: end && !Number.isNaN(end.getTime()) ? end : null,
      minutes: row?.minutes == null ? 0 : Number(row.minutes) || 0,
    };
  }).filter((row) => row.date && row.start);
}

function torontoToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function shiftIsoDate(iso, days) {
  const [year, month, day] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function mondayOf(iso) {
  const [year, month, day] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const weekday = date.getUTCDay();
  return shiftIsoDate(iso, weekday === 0 ? -6 : 1 - weekday);
}

/**
 * Day groups plus Today / this week / 2 weeks / 4 weeks / everything in the
 * report. Weeks start Monday, Toronto time, same as the hours summary.
 */
export function summarizeTimeEntries(entries) {
  const today = torontoToday();
  const weekStart = mondayOf(today);
  const twoWeekStart = shiftIsoDate(weekStart, -7);
  const fourWeekStart = shiftIsoDate(weekStart, -21);
  const byDate = new Map();
  for (const entry of entries || []) {
    if (!entry?.date || !entry.start) continue;
    const day = byDate.get(entry.date) || { date: entry.date, minutes: 0, punches: [] };
    day.punches.push(entry);
    day.minutes += Number(entry.minutes) || 0;
    byDate.set(entry.date, day);
  }
  const days = [...byDate.values()]
    .map((day) => ({
      ...day,
      punches: day.punches.slice().sort((a, b) => a.start - b.start),
    }))
    .sort((a, b) => b.date.localeCompare(a.date));
  const sumFrom = (start) => days.reduce(
    (total, day) => (day.date >= start && day.date <= today ? total + day.minutes : total),
    0,
  );
  return {
    days,
    totals: {
      today: sumFrom(today),
      week: sumFrom(weekStart),
      twoWeeks: sumFrom(twoWeekStart),
      fourWeeks: sumFrom(fourWeekStart),
      all: days.reduce((total, day) => total + day.minutes, 0),
    },
  };
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export function formatMinutes(minutes) {
  const total = Math.max(0, Math.round(Number(minutes) || 0));
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  if (!hours) return `${mins}m`;
  if (!mins) return `${hours}h`;
  return `${hours}h ${mins}m`;
}

export function formatClock(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('en-CA', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/Toronto',
  });
}

export function formatShiftDate(value) {
  const text = asString(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const [year, month, day] = text.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  return date.toLocaleDateString('en-CA', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

export function formatRelativeTime(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const diff = Date.now() - date.getTime();
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? '' : 's'} ago`;
  return date.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
