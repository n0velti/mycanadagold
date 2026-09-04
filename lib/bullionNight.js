import { getSupabase } from './supabase';

function asString(value) {
  if (value == null) return '';
  return String(value).trim();
}

export function nightStoreKey(storeName) {
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
  return /schema cache/i.test(message) && /bullion_night_counts/i.test(message);
}

function isPermissionError(error) {
  const code = String(error?.code || '');
  const message = String(error?.message || '');
  return code === '42501' || code === 'PGRST301' || /permission denied|row-level security/i.test(message);
}

function describeNightError(error, action = 'load') {
  if (!error) return `Could not ${action} night counts.`;
  if (isMissingRelation(error)) {
    return 'Run the bullion night-count SQL in Supabase, including the schema reload line, then refresh.';
  }
  if (error.code === 'NO_SESSION') {
    return error.message;
  }
  if (isPermissionError(error)) {
    return action === 'save'
      ? 'No permission to save night counts. Sign out and sign in again, then retry.'
      : 'No permission to load night counts. Sign out and sign in again, then retry.';
  }
  return error.message || `Could not ${action} night counts.`;
}

async function requireNightClient() {
  const supabase = getSupabase();
  const { data } = await supabase.auth.getSession();
  if (!data?.session?.user?.id) {
    const error = new Error('Sign out and sign in again so night counts can load.');
    error.code = 'NO_SESSION';
    throw error;
  }
  return supabase;
}

function mapCounts(rows) {
  const byProduct = {};
  for (const row of rows || []) {
    const id = asString(row?.product_id);
    const count = toNumber(row?.night_count);
    if (!id || count == null) continue;
    byProduct[id] = count;
  }
  return byProduct;
}

/** Load night counts for one store. Keys are product ids. */
export async function loadNightCounts(storeName) {
  const storeKey = nightStoreKey(storeName);
  if (!storeKey) return {};

  try {
    const supabase = await requireNightClient();
    const { data, error } = await supabase
      .from('bullion_night_counts')
      .select('product_id, night_count')
      .eq('store_key', storeKey);
    if (error) throw error;
    return mapCounts(data);
  } catch (error) {
    if (isMissingRelation(error)) return {};
    throw new Error(describeNightError(error, 'load'));
  }
}

export async function saveNightCount(storeName, productId, nightCount, userId) {
  const storeKey = nightStoreKey(storeName);
  const id = asString(productId);
  if (!storeKey) throw new Error('Choose a store.');
  if (!id) throw new Error('Missing product.');

  const count = toNumber(nightCount) ?? 0;
  const supabase = await requireNightClient();
  const { data: authData } = await supabase.auth.getSession();
  const actorId = authData?.session?.user?.id || userId || null;

  const { error } = await supabase.from('bullion_night_counts').upsert(
    {
      store_key: storeKey,
      product_id: id,
      night_count: count,
      updated_at: new Date().toISOString(),
      updated_by: actorId,
    },
    { onConflict: 'store_key,product_id' },
  );
  if (error) throw new Error(describeNightError(error, 'save'));
  return count;
}
