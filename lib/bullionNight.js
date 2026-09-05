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

function isMissingShiftColumn(error) {
  const message = String(error?.message || '');
  return (
    /afternoon_count|vault_entered|store_entered|other_entered/i.test(message) &&
    /column|schema cache|does not exist/i.test(message)
  );
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
  if (isMissingShiftColumn(error)) {
    return 'Run the latest bullion count SQL in Supabase, including the schema reload line, then refresh.';
  }
  if (error.code === 'NO_SESSION') {
    return error.message;
  }
  if (isPermissionError(error)) {
    return action === 'save'
      ? 'No permission to save shift counts. Sign out and sign in again, then retry.'
      : 'No permission to load shift counts. Sign out and sign in again, then retry.';
  }
  return error.message || `Could not ${action} shift counts.`;
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

function emptyShiftMaps() {
  return { night: {}, afternoon: {}, vaultEntered: {}, storeEntered: {}, otherEntered: {} };
}

function mapShiftCounts(rows) {
  const maps = emptyShiftMaps();
  for (const row of rows || []) {
    const id = asString(row?.product_id);
    if (!id) continue;
    const night = toNumber(row?.night_count);
    const afternoon = toNumber(row?.afternoon_count);
    const vaultEntered = toNumber(row?.vault_entered);
    const storeEntered = toNumber(row?.store_entered);
    const otherEntered = toNumber(row?.other_entered);
    if (night != null) maps.night[id] = night;
    if (afternoon != null) maps.afternoon[id] = afternoon;
    if (vaultEntered != null) maps.vaultEntered[id] = vaultEntered;
    if (storeEntered != null) maps.storeEntered[id] = storeEntered;
    if (otherEntered != null) maps.otherEntered[id] = otherEntered;
  }
  return maps;
}

/** Load night / afternoon / typed-vault maps for one store. Keys are product ids. */
export async function loadShiftCounts(storeName) {
  const storeKey = nightStoreKey(storeName);
  if (!storeKey) return emptyShiftMaps();

  try {
    const supabase = await requireNightClient();
    const { data, error } = await supabase
      .from('bullion_night_counts')
      .select('product_id, night_count, afternoon_count, vault_entered, store_entered, other_entered')
      .eq('store_key', storeKey);
    if (error) throw error;
    return mapShiftCounts(data);
  } catch (error) {
    if (isMissingRelation(error)) return emptyShiftMaps();
    if (isMissingShiftColumn(error)) {
      try {
        const supabase = await requireNightClient();
        const { data, error: fallbackError } = await supabase
          .from('bullion_night_counts')
          .select('product_id, night_count, afternoon_count, vault_entered')
          .eq('store_key', storeKey);
        if (fallbackError) {
          if (isMissingShiftColumn(fallbackError)) {
            const { data: nightOnly, error: nightError } = await supabase
              .from('bullion_night_counts')
              .select('product_id, night_count')
              .eq('store_key', storeKey);
            if (nightError) throw nightError;
            return mapShiftCounts(nightOnly);
          }
          throw fallbackError;
        }
        return mapShiftCounts(data);
      } catch (fallback) {
        if (isMissingRelation(fallback)) return emptyShiftMaps();
        throw new Error(describeNightError(fallback, 'load'));
      }
    }
    throw new Error(describeNightError(error, 'load'));
  }
}

/** Load night counts for one store. Keys are product ids. */
export async function loadNightCounts(storeName) {
  const { night } = await loadShiftCounts(storeName);
  return night;
}

async function saveShiftPatch(storeName, productId, patch, userId) {
  const storeKey = nightStoreKey(storeName);
  const id = asString(productId);
  if (!storeKey) throw new Error('Choose a store.');
  if (!id) throw new Error('Missing product.');

  const supabase = await requireNightClient();
  const { data: authData } = await supabase.auth.getSession();
  const actorId = authData?.session?.user?.id || userId || null;

  const row = {
    store_key: storeKey,
    product_id: id,
    updated_at: new Date().toISOString(),
    updated_by: actorId,
    ...patch,
  };

  const { error } = await supabase.from('bullion_night_counts').upsert(row, {
    onConflict: 'store_key,product_id',
  });
  if (error) throw error;
}

function wrapSave(action) {
  return action.catch((error) => {
    throw new Error(describeNightError(error, 'save'));
  });
}

export async function saveNightCount(storeName, productId, nightCount, userId) {
  const count = toNumber(nightCount) ?? 0;
  await wrapSave(saveShiftPatch(storeName, productId, { night_count: count }, userId));
  return count;
}

export async function saveAfternoonCount(storeName, productId, afternoonCount, userId) {
  const count = toNumber(afternoonCount) ?? 0;
  await wrapSave(saveShiftPatch(storeName, productId, { afternoon_count: count }, userId));
  return count;
}

export async function saveVaultEntered(storeName, productId, vaultEntered, userId) {
  const count = toNumber(vaultEntered);
  await wrapSave(
    saveShiftPatch(
      storeName,
      productId,
      { vault_entered: count },
      userId,
    ),
  );
  return count;
}

/** Persist typed audit counts to Supabase only (does not write Aureus). */
export async function saveLocalBullionCounts(storeName, productId, counts, userId) {
  const vault = toNumber(counts?.vault);
  const night = toNumber(counts?.night) ?? 0;
  const afternoon = toNumber(counts?.afternoon) ?? 0;
  const store = toNumber(counts?.store);
  const other = toNumber(counts?.other);
  const saved = { vault, night, afternoon, store, other };

  try {
    await saveShiftPatch(
      storeName,
      productId,
      {
        night_count: night,
        afternoon_count: afternoon,
        vault_entered: vault,
        store_entered: store,
        other_entered: other,
      },
      userId,
    );
    return saved;
  } catch (error) {
    if (!isMissingShiftColumn(error)) {
      throw new Error(describeNightError(error, 'save'));
    }
    try {
      await saveShiftPatch(
        storeName,
        productId,
        {
          night_count: night,
          afternoon_count: afternoon,
          vault_entered: vault,
        },
        userId,
      );
      return saved;
    } catch (fallback) {
      throw new Error(describeNightError(fallback, 'save'));
    }
  }
}
