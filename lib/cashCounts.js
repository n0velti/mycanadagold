import { getSupabase } from './supabase';
import { CASH_DENOMS, USD_DENOMS, emptyDenomCounts } from './cashDenoms';
import { formatDateParam, parseDateParam } from './transactions';

function asString(value) {
  if (value == null) return '';
  return String(value).trim();
}

function storeKey(storeName) {
  return asString(storeName).toLowerCase();
}

function toNumber(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function isMissingRelation(error) {
  const code = String(error?.code || '');
  const message = String(error?.message || '');
  if (code === '42P01' || code === 'PGRST205') return true;
  return /schema cache/i.test(message) && /store_cash_counts/i.test(message);
}

function isPermissionError(error) {
  const code = String(error?.code || '');
  const message = String(error?.message || '');
  return code === '42501' || code === 'PGRST301' || /permission denied|row-level security/i.test(message);
}

function describeError(error, action = 'load') {
  if (!error) return `Could not ${action} cash counts.`;
  if (isMissingRelation(error)) {
    return 'Run the store cash-count SQL in Supabase, including the schema reload line, then refresh.';
  }
  if (error.code === 'NO_SESSION') return error.message;
  if (isPermissionError(error)) {
    return action === 'save'
      ? 'No permission to save cash counts. Sign out and sign in again, then retry.'
      : 'No permission to load cash counts. Sign out and sign in again, then retry.';
  }
  return error.message || `Could not ${action} cash counts.`;
}

async function requireClient() {
  const supabase = getSupabase();
  const { data } = await supabase.auth.getSession();
  if (!data?.session?.user?.id) {
    const error = new Error('Sign out and sign in again so cash counts can load.');
    error.code = 'NO_SESSION';
    throw error;
  }
  return supabase;
}

function normalizeCounts(source, denoms) {
  const next = emptyDenomCounts(denoms);
  const raw = source && typeof source === 'object' ? source : {};
  for (const denom of denoms) {
    const value = raw[denom.key];
    next[denom.key] = value == null || value === '' ? '' : String(value);
  }
  return next;
}

function compactCounts(counts, denoms) {
  const next = {};
  for (const denom of denoms) {
    const value = String(counts?.[denom.key] || '').trim();
    if (value) next[denom.key] = value;
  }
  return next;
}

function mapRow(row) {
  const currency = String(row?.currency || 'CAD').toUpperCase() === 'USD' ? 'USD' : 'CAD';
  const denoms = currency === 'USD' ? USD_DENOMS : CASH_DENOMS;
  return {
    currency,
    loose: normalizeCounts(row?.loose, denoms),
    stacks: normalizeCounts(row?.stacks, denoms),
    otherCash: row?.other_cash == null ? '' : String(row.other_cash),
    countedTotal: row?.counted_total == null ? '' : String(row.counted_total),
    countedManual: Boolean(row?.counted_manual),
    date: row?.count_date || null,
    updatedAt: row?.updated_at || null,
  };
}

function hasSheetValues(sheet) {
  if (!sheet) return false;
  if (String(sheet.otherCash || '').trim() || String(sheet.countedTotal || '').trim()) return true;
  return Object.values(sheet.loose || {}).some(Boolean) || Object.values(sheet.stacks || {}).some(Boolean);
}

export function emptyCashCounts() {
  return { cad: null, usd: null };
}

export async function loadStoreCashCounts(storeName, date) {
  const key = storeKey(storeName);
  const day = formatDateParam(parseDateParam(date || new Date()));
  if (!key) return emptyCashCounts();

  try {
    const supabase = await requireClient();
    const { data, error } = await supabase
      .from('store_cash_counts')
      .select('currency, loose, stacks, other_cash, counted_total, counted_manual, count_date, updated_at')
      .eq('store_key', key)
      .eq('count_date', day);
    if (error) throw error;
    const result = emptyCashCounts();
    for (const row of data || []) {
      const sheet = mapRow(row);
      if (sheet.currency === 'USD') result.usd = sheet;
      else result.cad = sheet;
    }
    return result;
  } catch (error) {
    if (isMissingRelation(error)) return emptyCashCounts();
    throw new Error(describeError(error, 'load'));
  }
}

export async function loadLatestStoreCashCounts(storeName, date) {
  const today = await loadStoreCashCounts(storeName, date);
  if (hasSheetValues(today.cad) || hasSheetValues(today.usd)) {
    return { ...today, source: 'today' };
  }

  const previous = formatDateParam(
    (() => {
      const day = parseDateParam(date || new Date());
      day.setDate(day.getDate() - 1);
      return day;
    })(),
  );
  const yesterday = await loadStoreCashCounts(storeName, previous);
  if (hasSheetValues(yesterday.cad) || hasSheetValues(yesterday.usd)) {
    return { ...yesterday, source: 'yesterday' };
  }
  return { ...emptyCashCounts(), source: null };
}

export async function saveStoreCashCount(storeName, date, currency, sheet, userId) {
  const name = asString(storeName);
  const key = storeKey(name);
  const day = formatDateParam(parseDateParam(date || new Date()));
  const code = String(currency || 'CAD').toUpperCase() === 'USD' ? 'USD' : 'CAD';
  const denoms = code === 'USD' ? USD_DENOMS : CASH_DENOMS;
  if (!key) throw new Error('Choose a store.');

  const supabase = await requireClient();
  const { data: authData } = await supabase.auth.getSession();
  const actorId = authData?.session?.user?.id || userId || null;

  const { error } = await supabase.from('store_cash_counts').upsert(
    {
      store_key: key,
      store_name: name,
      count_date: day,
      currency: code,
      loose: compactCounts(sheet?.loose, denoms),
      stacks: compactCounts(sheet?.stacks, denoms),
      other_cash: toNumber(sheet?.otherCash),
      counted_total: toNumber(sheet?.countedTotal),
      counted_manual: Boolean(sheet?.countedManual),
      updated_at: new Date().toISOString(),
      updated_by: actorId,
    },
    { onConflict: 'store_key,count_date,currency' },
  );
  if (error) throw new Error(describeError(error, 'save'));
}

export function subscribeStoreCashCounts(storeName, onChange) {
  const key = storeKey(storeName);
  if (!key || typeof onChange !== 'function') return () => {};

  const supabase = getSupabase();
  const channel = supabase
    .channel(`store-cash-counts-${key}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'store_cash_counts',
        filter: `store_key=eq.${key}`,
      },
      () => {
        onChange();
      },
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

export { hasSheetValues };
