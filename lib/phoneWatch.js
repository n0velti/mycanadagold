import AsyncStorage from '@react-native-async-storage/async-storage';

export const PHONE_WATCH_KEY = 'cgold.phone.watchStores';

export function parseWatchStores(raw) {
  if (!raw) return { mode: 'all', keys: [] };
  try {
    const parsed = JSON.parse(raw);
    if (parsed && parsed.mode === 'selected' && Array.isArray(parsed.keys)) {
      return {
        mode: 'selected',
        keys: parsed.keys.map((key) => String(key || '').trim()).filter(Boolean),
      };
    }
  } catch {
    // Fall through to the default: the store the user is set in.
  }
  return { mode: 'all', keys: [] };
}

/**
 * A saved "selected" list is an explicit choice.
 * Otherwise only `currentStoreKey` (the store the user is set in) rings.
 */
export function isStoreWatched(prefs, storeKey, currentStoreKey = '') {
  const key = String(storeKey || '').trim();
  if (!key) return false;
  if (prefs?.mode === 'selected') return (prefs.keys || []).includes(key);
  const current = String(currentStoreKey || '').trim();
  return Boolean(current) && key === current;
}

export function defaultWatchKeys(currentStoreKey) {
  const key = String(currentStoreKey || '').trim();
  return key ? [key] : [];
}

export async function loadWatchStores() {
  try {
    return parseWatchStores(await AsyncStorage.getItem(PHONE_WATCH_KEY));
  } catch {
    return { mode: 'all', keys: [] };
  }
}

export async function saveWatchStores(prefs) {
  const payload =
    prefs?.mode === 'selected'
      ? {
          mode: 'selected',
          keys: [...new Set((prefs.keys || []).map((key) => String(key || '').trim()).filter(Boolean))],
        }
      : { mode: 'all', keys: [] };
  await AsyncStorage.setItem(PHONE_WATCH_KEY, JSON.stringify(payload));
  return payload;
}
