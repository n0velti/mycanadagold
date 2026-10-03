import { fetchTransferStores } from './locations';
import { hasFullAppAccess, normalizeAppRole } from './permissions';
import { getSupabase } from './supabase';

export const WEEKDAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function asString(value) {
  if (value == null) return '';
  return String(value).trim();
}

export function storeKeyFromName(name) {
  return asString(name).toLowerCase();
}

function foldStoreKey(name) {
  return storeKeyFromName(name)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/** POS / staff names that all mean the Quebec City branch (`store_key` quebec). */
const QUEBEC_CITY_HOURS_KEYS = new Set([
  'quebec',
  'quebec city',
  'ville de quebec',
  'canada or',
  'canada gold quebec',
  'retail - quebec city',
]);

export function hoursStoreKey(name) {
  const key = foldStoreKey(name);
  if (!key) return '';
  if (QUEBEC_CITY_HOURS_KEYS.has(key) || /\bquebec city\b/.test(key)) return 'quebec';
  return key;
}

export function hoursStoreKeys(name) {
  const raw = foldStoreKey(name);
  const canonical = hoursStoreKey(name);
  if (!canonical) return [];
  if (!raw || raw === canonical) return [canonical];
  return [canonical, raw];
}

function isQuebecCityStore(storeName) {
  return hoursStoreKey(storeName) === 'quebec';
}

function quebecCityDisplayName(storeName) {
  return isQuebecCityStore(storeName) ? 'Quebec' : asString(storeName);
}

const WEEKDAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Wall-clock zone for a branch. Ontario/Quebec are Eastern; Halifax is Atlantic. */
export function storeTimeZone(storeName) {
  const key = storeKeyFromName(storeName);
  if (/\bhalifax\b|dartmouth|atlantic/.test(key)) return 'America/Halifax';
  if (/\bst\.?\s*john'?s\b|newfoundland|\bnl\b/.test(key)) return 'America/St_Johns';
  return 'America/Toronto';
}

function isRichmondHill(storeName) {
  return /richmond/.test(storeKeyFromName(storeName));
}

function isMissingRelation(error) {
  const code = String(error?.code || '');
  const message = String(error?.message || '');
  if (code === '42P01' || code === 'PGRST205') return true;
  return /schema cache/i.test(message) && /store_settings/i.test(message);
}

function isPermissionError(error) {
  const code = String(error?.code || '');
  const message = String(error?.message || '');
  return code === '42501' || code === 'PGRST301' || /permission denied|row-level security/i.test(message);
}

function describeStoreSettingsError(error, action = 'load') {
  if (!error) return `Could not ${action} store hours.`;
  if (isMissingRelation(error)) {
    return 'Run the store settings SQL in Supabase, including the schema reload line, then refresh.';
  }
  if (error.code === 'NO_SESSION') {
    return error.message;
  }
  if (isPermissionError(error)) {
    return action === 'save'
      ? 'No permission to save store hours. Sign out and sign in again, then retry.'
      : 'No permission to load store hours. Sign out and sign in again, then retry.';
  }
  return error.message || `Could not ${action} store hours.`;
}

async function requireStoreSettingsClient() {
  const supabase = getSupabase();
  const { data } = await supabase.auth.getSession();
  if (!data?.session?.user?.id) {
    const error = new Error('Sign out and sign in again so store hours can load.');
    error.code = 'NO_SESSION';
    throw error;
  }
  return supabase;
}

export function canManageStoreSettings(profile) {
  if (hasFullAppAccess(profile)) return true;
  const role = normalizeAppRole(profile?.appRole);
  if (role === 'general_manager' || role === 'branch_manager' || role === 'system_admin') return true;
  const pos = `${profile?.role || ''} ${profile?.employeeType || ''} ${profile?.posRole || ''}`.toLowerCase();
  return /general\s*manager|\bgm\b|system\s*admin|\badmins?\b|owner|president|director|vice\s*president|\bvp\b/.test(
    pos,
  );
}

function normalizeTime(value, fallback) {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})/);
  if (!match) return fallback;
  const hour = Math.min(23, Math.max(0, Number(match[1])));
  const minute = Math.min(59, Math.max(0, Number(match[2])));
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return fallback;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function defaultWeeklyHours(storeName = '') {
  const weekdayOpen = isRichmondHill(storeName) ? '09:30' : '10:00';
  // Quebec City (canadagold.ca / quebecgold.ca): Sun 11–5, Mon–Fri 10–6, Sat 10–5.
  const quebecCity = isQuebecCityStore(storeName);
  return WEEKDAY_LABELS.map((_, day) => {
    if (day === 0) {
      if (quebecCity) return { day, closed: false, open: '11:00', close: '17:00' };
      return { day, closed: true, open: weekdayOpen, close: '17:00' };
    }
    if (day === 6) return { day, closed: false, open: weekdayOpen, close: '17:00' };
    return { day, closed: false, open: weekdayOpen, close: '18:00' };
  });
}

export function normalizeWeeklyHours(hours, storeName = '') {
  const source = Array.isArray(hours) ? hours : [];
  const defaults = defaultWeeklyHours(storeName);
  const fallbackOpen = defaults[1]?.open || '10:00';
  const fallbackClose = defaults[1]?.close || '18:00';
  const byDay = new Map();
  for (const row of source) {
    const day = Number(row?.day);
    if (!Number.isInteger(day) || day < 0 || day > 6) continue;
    byDay.set(day, {
      day,
      closed: Boolean(row.closed),
      open: normalizeTime(row.open, fallbackOpen),
      close: normalizeTime(row.close, fallbackClose),
    });
  }
  return defaults.map((fallback) => byDay.get(fallback.day) || fallback);
}

function holidayId() {
  return `h_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function normalizeHolidays(holidays) {
  if (!Array.isArray(holidays)) return [];
  const seen = new Set();
  const next = [];
  for (const row of holidays) {
    const date = asString(row?.date).match(/^\d{4}-\d{2}-\d{2}$/) ? asString(row.date) : '';
    if (!date || seen.has(date)) continue;
    seen.add(date);
    next.push({
      id: asString(row?.id) || holidayId(),
      date,
      name: asString(row?.name) || 'Holiday',
      closed: row?.closed !== false,
      open: normalizeTime(row?.open, '10:00'),
      close: normalizeTime(row?.close, '16:00'),
    });
  }
  next.sort((a, b) => a.date.localeCompare(b.date));
  return next;
}

export function createHoliday(partial = {}) {
  return {
    id: holidayId(),
    date: asString(partial.date),
    name: asString(partial.name),
    closed: partial.closed !== false,
    open: normalizeTime(partial.open, '10:00'),
    close: normalizeTime(partial.close, '16:00'),
  };
}

export function formatClock(value) {
  const time = normalizeTime(value, '');
  if (!time) return '—';
  const [hour, minute] = time.split(':').map(Number);
  const date = new Date();
  date.setHours(hour, minute, 0, 0);
  return date.toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' });
}

function hoursSignature(row) {
  if (row.closed) return 'closed';
  return `${row.open}-${row.close}`;
}

export function summarizeHours(hours, storeName = '') {
  const days = normalizeWeeklyHours(hours, storeName);
  const groups = [];
  for (const row of days) {
    const signature = hoursSignature(row);
    const last = groups[groups.length - 1];
    if (last && last.signature === signature) {
      last.end = row.day;
      continue;
    }
    groups.push({ start: row.day, end: row.day, signature, row });
  }

  return groups
    .map((group) => {
      const label =
        group.start === group.end
          ? WEEKDAY_SHORT[group.start]
          : `${WEEKDAY_SHORT[group.start]}–${WEEKDAY_SHORT[group.end]}`;
      if (group.row.closed) return `${label} closed`;
      return `${label} ${formatClock(group.row.open)}–${formatClock(group.row.close)}`;
    })
    .join(' · ');
}

function zonedWallClock(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const value = (type) => parts.find((part) => part.type === type)?.value || '';
  return {
    dateKey: `${value('year')}-${value('month')}-${value('day')}`,
    weekday: WEEKDAY_INDEX[value('weekday')] ?? 0,
    minutes: Number(value('hour')) * 60 + Number(value('minute')),
  };
}

function previousWallClock(dateKey, weekday) {
  const [year, month, day] = dateKey.split('-').map(Number);
  const prior = new Date(Date.UTC(year, month - 1, day));
  prior.setUTCDate(prior.getUTCDate() - 1);
  return {
    dateKey: prior.toISOString().slice(0, 10),
    weekday: (weekday + 6) % 7,
  };
}

function clockToMinutes(value) {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return hour * 60 + minute;
}

function hoursForWallClock(settings, wall) {
  const holiday = normalizeHolidays(settings?.holidays).find((row) => row.date === wall.dateKey);
  if (holiday) {
    return {
      closed: Boolean(holiday.closed),
      open: holiday.open,
      close: holiday.close,
    };
  }
  const storeName = settings?.storeName || settings?.storeKey || '';
  const weekly = normalizeWeeklyHours(settings?.hours, storeName);
  return weekly[wall.weekday] || { closed: true, open: '10:00', close: '18:00' };
}

function isWithinHours(hours, nowMin, { overnightOnly = false } = {}) {
  if (!hours || hours.closed) return false;
  const openMin = clockToMinutes(hours.open);
  const closeMin = clockToMinutes(hours.close);
  if (openMin == null || closeMin == null || openMin === closeMin) return false;
  if (closeMin > openMin) {
    if (overnightOnly) return false;
    return nowMin >= openMin && nowMin < closeMin;
  }
  if (overnightOnly) return nowMin < closeMin;
  return nowMin >= openMin;
}

export function isStoreOpenNow(settings, at = new Date()) {
  const now = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(now.getTime())) return false;
  const storeName = settings?.storeName || settings?.storeKey || '';
  const wall = zonedWallClock(now, storeTimeZone(storeName));
  if (isWithinHours(hoursForWallClock(settings, wall), wall.minutes)) return true;
  const yesterday = previousWallClock(wall.dateKey, wall.weekday);
  return isWithinHours(hoursForWallClock(settings, yesterday), wall.minutes, { overnightOnly: true });
}

function mapRow(row, fallbackName = '') {
  const storeName = asString(row?.store_name) || asString(fallbackName);
  return {
    storeKey: asString(row?.store_key) || storeKeyFromName(storeName),
    storeName,
    hours: normalizeWeeklyHours(row?.hours, storeName),
    holidays: normalizeHolidays(row?.holidays),
    timeZone: storeTimeZone(storeName),
    updatedAt: row?.updated_at || null,
    exists: Boolean(row?.store_key),
  };
}

export function emptyStoreSettings(storeName) {
  const name = quebecCityDisplayName(storeName);
  return {
    storeKey: hoursStoreKey(storeName) || storeKeyFromName(storeName),
    storeName: name,
    hours: defaultWeeklyHours(storeName),
    holidays: [],
    timeZone: storeTimeZone(storeName),
    updatedAt: null,
    exists: false,
  };
}

export function settingsForStoreName(byKey, storeName) {
  const map = byKey instanceof Map ? byKey : new Map();
  for (const key of hoursStoreKeys(storeName)) {
    if (map.has(key)) return map.get(key);
  }
  return emptyStoreSettings(storeName);
}

export async function loadStoreSettings(storeName) {
  const name = asString(storeName);
  if (!name) return emptyStoreSettings('');

  try {
    const supabase = await requireStoreSettingsClient();
    const keys = hoursStoreKeys(name);
    const { data, error } = await supabase
      .from('store_settings')
      .select('store_key, store_name, hours, holidays, updated_at')
      .in('store_key', keys);
    if (error) throw error;
    const rows = Array.isArray(data) ? data : [];
    const preferred = keys.map((key) => rows.find((row) => row?.store_key === key)).find(Boolean);
    if (!preferred) return { ...emptyStoreSettings(name), configured: true };
    return { ...mapRow(preferred, name), configured: true };
  } catch (error) {
    if (isMissingRelation(error)) {
      return { ...emptyStoreSettings(name), configured: true, unavailable: true };
    }
    throw new Error(describeStoreSettingsError(error, 'load'));
  }
}

export async function listSavedStoreSettings() {
  try {
    const supabase = await requireStoreSettingsClient();
    const { data, error } = await supabase
      .from('store_settings')
      .select('store_key, store_name, hours, holidays, updated_at')
      .order('store_name', { ascending: true });
    if (error) throw error;
    return {
      rows: (data || []).map((row) => mapRow(row)),
      configured: true,
      unavailable: false,
    };
  } catch (error) {
    if (isMissingRelation(error)) {
      return { rows: [], configured: true, unavailable: true };
    }
    throw new Error(describeStoreSettingsError(error, 'load'));
  }
}

export async function saveStoreSettings(storeName, { hours, holidays }, userId) {
  const name = asString(storeName);
  if (!name) throw new Error('Choose a store.');

  const supabase = await requireStoreSettingsClient();
  const { data: authData } = await supabase.auth.getSession();
  const actorId = authData?.session?.user?.id || userId || null;
  const storeKey = hoursStoreKey(name) || storeKeyFromName(name);
  const displayName = quebecCityDisplayName(name) || name;
  const row = {
    store_key: storeKey,
    store_name: displayName,
    hours: normalizeWeeklyHours(hours, displayName),
    holidays: normalizeHolidays(holidays),
    updated_at: new Date().toISOString(),
    updated_by: actorId,
  };

  const { data, error } = await supabase
    .from('store_settings')
    .upsert(row, { onConflict: 'store_key' })
    .select('store_key, store_name, hours, holidays, updated_at')
    .maybeSingle();
  if (error) {
    throw new Error(describeStoreSettingsError(error, 'save'));
  }
  return mapRow(data, name);
}

export async function listStoreChoices(session) {
  const savedPromise = listSavedStoreSettings().catch((error) => ({
    rows: [],
    configured: true,
    unavailable: false,
    error: error?.message || 'Could not load saved store hours.',
  }));
  const [saved, transfer] = await Promise.all([
    savedPromise,
    session?.token
      ? fetchTransferStores(session).catch(() => ({ stores: [], warning: '' }))
      : Promise.resolve({ stores: [], warning: '' }),
  ]);

  const byKey = new Map();
  for (const store of transfer.stores || []) {
    const key = hoursStoreKey(store.name) || storeKeyFromName(store.name);
    if (!key) continue;
    const current = byKey.get(key);
    byKey.set(key, {
      storeKey: key,
      storeName: current?.storeName || store.name,
      systemLabel: store.systemLabel || current?.systemLabel || '',
      address: store.address || current?.address || '',
      hours: defaultWeeklyHours(store.name),
      holidays: [],
      exists: false,
    });
  }

  for (const row of saved.rows || []) {
    const key = hoursStoreKey(row.storeName) || row.storeKey;
    const current = byKey.get(key) || byKey.get(row.storeKey);
    byKey.set(key, {
      storeKey: key,
      storeName: current?.storeName || row.storeName || row.storeKey,
      systemLabel: current?.systemLabel || '',
      address: current?.address || '',
      hours: row.hours,
      holidays: row.holidays,
      exists: true,
      updatedAt: row.updatedAt,
    });
    if (row.storeKey && row.storeKey !== key) byKey.delete(row.storeKey);
  }

  const stores = Array.from(byKey.values()).sort((a, b) =>
    a.storeName.localeCompare(b.storeName, undefined, { sensitivity: 'base' }),
  );

  return {
    stores,
    warning: [saved.error, transfer.warning].filter(Boolean).join(' '),
    unavailable: Boolean(saved.unavailable),
    configured: saved.configured !== false,
  };
}
