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

export function buildHoursAuthorizeUrl({ clientId, hostedDomain, loginHint }) {
  const redirectUri = getGmailRedirectUri();
  if (!redirectUri) throw new Error('Connect the hours mailbox from the web app.');
  const state = createHoursOAuthState();
  persistHoursOAuthState(state);
  return buildGmailAuthorizeUrl({ clientId, redirectUri, state, hostedDomain, loginHint });
}

// ---------------------------------------------------------------------------
// Proxy calls
// ---------------------------------------------------------------------------

function mapStatus(payload) {
  return {
    configured: Boolean(payload?.configured),
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

/** A clock-in snapshot older than this is treated as unknown, not "in". */
const CLOCK_STATUS_MAX_AGE_MS = 3 * 60 * 60_000;

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
    const key = normalizePersonName(row.name);
    if (key && !byName.has(key)) byName.set(key, row);
  };
  for (const row of list) index(row);

  const freshAfter = Date.now() - CLOCK_STATUS_MAX_AGE_MS;
  let clockedInCount = 0;
  for (const clock of clockResult) {
    const fresh = Boolean(clock.reportedAt) && clock.reportedAt.getTime() >= freshAfter;
    let row = byId.get(clock.id) || byName.get(normalizePersonName(clock.name));
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

/** Find the hours row for a person by Rippling id first, then by name. */
export function hoursForPerson(summary, { ripplingId, names } = {}) {
  if (!summary) return null;
  const id = asString(ripplingId);
  if (id && summary.byId.has(id)) return summary.byId.get(id);
  for (const candidate of Array.isArray(names) ? names : [names]) {
    const key = normalizePersonName(candidate);
    if (key && summary.byName.has(key)) return summary.byName.get(key);
  }
  return null;
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
