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
    // Fall through to watch every connected store.
  }
  return { mode: 'all', keys: [] };
}

export function isStoreWatched(prefs, storeKey) {
  const key = String(storeKey || '').trim();
  if (!key) return false;
  if (!prefs || prefs.mode !== 'selected') return true;
  return prefs.keys.includes(key);
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
