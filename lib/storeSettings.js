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
  return role === 'general_manager' || role === 'branch_manager';
}

function normalizeTime(value, fallback) {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})/);
  if (!match) return fallback;
  const hour = Math.min(23, Math.max(0, Number(match[1])));
  const minute = Math.min(59, Math.max(0, Number(match[2])));
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return fallback;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function defaultWeeklyHours() {
  return WEEKDAY_LABELS.map((_, day) => {
    if (day === 0) return { day, closed: true, open: '10:00', close: '17:00' };
    if (day === 6) return { day, closed: false, open: '10:00', close: '17:00' };
    return { day, closed: false, open: '10:00', close: '18:00' };
  });
}

export function normalizeWeeklyHours(hours) {
  const source = Array.isArray(hours) ? hours : [];
  const byDay = new Map();
  for (const row of source) {
    const day = Number(row?.day);
    if (!Number.isInteger(day) || day < 0 || day > 6) continue;
    byDay.set(day, {
      day,
      closed: Boolean(row.closed),
      open: normalizeTime(row.open, '10:00'),
      close: normalizeTime(row.close, '18:00'),
    });
  }
  return defaultWeeklyHours().map((fallback) => byDay.get(fallback.day) || fallback);
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

export function summarizeHours(hours) {
  const days = normalizeWeeklyHours(hours);
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

function mapRow(row, fallbackName = '') {
  const storeName = asString(row?.store_name) || asString(fallbackName);
  return {
    storeKey: asString(row?.store_key) || storeKeyFromName(storeName),
    storeName,
    hours: normalizeWeeklyHours(row?.hours),
    holidays: normalizeHolidays(row?.holidays),
    updatedAt: row?.updated_at || null,
    exists: Boolean(row?.store_key),
  };
}

export function emptyStoreSettings(storeName) {
  return {
    storeKey: storeKeyFromName(storeName),
    storeName: asString(storeName),
    hours: defaultWeeklyHours(),
    holidays: [],
    updatedAt: null,
    exists: false,
  };
}

export async function loadStoreSettings(storeName) {
  const name = asString(storeName);
  if (!name) return emptyStoreSettings('');

  try {
    const supabase = await requireStoreSettingsClient();
    const { data, error } = await supabase
      .from('store_settings')
      .select('store_key, store_name, hours, holidays, updated_at')
      .eq('store_key', storeKeyFromName(name))
      .maybeSingle();
    if (error) throw error;
    if (!data) return { ...emptyStoreSettings(name), configured: true };
    return { ...mapRow(data, name), configured: true };
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
  const row = {
    store_key: storeKeyFromName(name),
    store_name: name,
    hours: normalizeWeeklyHours(hours),
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
    const key = storeKeyFromName(store.name);
    if (!key) continue;
    byKey.set(key, {
      storeKey: key,
      storeName: store.name,
      systemLabel: store.systemLabel || '',
      address: store.address || '',
      hours: defaultWeeklyHours(),
      holidays: [],
      exists: false,
    });
  }

  for (const row of saved.rows || []) {
    const current = byKey.get(row.storeKey);
    byKey.set(row.storeKey, {
      storeKey: row.storeKey,
      storeName: row.storeName || current?.storeName || row.storeKey,
      systemLabel: current?.systemLabel || '',
      address: current?.address || '',
      hours: row.hours,
      holidays: row.holidays,
      exists: true,
      updatedAt: row.updatedAt,
    });
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
