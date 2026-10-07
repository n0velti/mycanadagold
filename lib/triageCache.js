/**
 * Local cache for the triage workflow.
 *
 * Rows are stored one record per batch / review so a save only writes the
 * rows that changed instead of re-serialising the whole data set. On web the
 * backing store is IndexedDB: localStorage is synchronous (every write blocks
 * the UI) and caps out around 5 MB, which the triage set outgrows. Native and
 * any browser without IndexedDB fall back to AsyncStorage with one key per row.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

const DB_NAME = 'cgold-triage';
const DB_VERSION = 1;
const STORES = ['triage', 'reviews', 'meta'];
const META_KEY = 'state';

const LEGACY_KEYS = ['cgold_transfer_workflow', 'cgold_triage_poso'];
const KEY_PREFIX = 'cgold_triage_cache:';

let dbPromise = null;
let idbBroken = false;

function hasIndexedDb() {
  return Platform.OS === 'web' && typeof indexedDB !== 'undefined' && !idbBroken;
}

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    let request;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (error) {
      reject(error);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const name of STORES) {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, name === 'meta' ? undefined : { keyPath: 'id' });
        }
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    request.onerror = () => reject(request.error || new Error('IndexedDB unavailable'));
    request.onblocked = () => reject(new Error('IndexedDB blocked'));
  }).catch((error) => {
    dbPromise = null;
    idbBroken = true;
    throw error;
  });
  return dbPromise;
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB request failed'));
  });
}

function transactionDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
  });
}

async function idbReadAll() {
  const db = await openDb();
  const tx = db.transaction(STORES, 'readonly');
  const [triage, reviews, meta] = await Promise.all([
    requestToPromise(tx.objectStore('triage').getAll()),
    requestToPromise(tx.objectStore('reviews').getAll()),
    requestToPromise(tx.objectStore('meta').get(META_KEY)),
  ]);
  return { triage: triage || [], reviews: reviews || [], meta: meta || null };
}

async function idbWrite({ triagePut, triageDelete, reviewPut, reviewDelete, meta }) {
  const db = await openDb();
  const tx = db.transaction(STORES, 'readwrite');
  const triageStore = tx.objectStore('triage');
  const reviewStore = tx.objectStore('reviews');
  for (const row of triagePut || []) triageStore.put(row);
  for (const id of triageDelete || []) triageStore.delete(id);
  for (const row of reviewPut || []) reviewStore.put(row);
  for (const id of reviewDelete || []) reviewStore.delete(id);
  if (meta !== undefined) tx.objectStore('meta').put(meta, META_KEY);
  await transactionDone(tx);
}

async function idbClear() {
  const db = await openDb();
  const tx = db.transaction(STORES, 'readwrite');
  for (const name of STORES) tx.objectStore(name).clear();
  await transactionDone(tx);
}

/* AsyncStorage fallback: one key per row under a shared prefix. */

function rowKey(kind, id) {
  return `${KEY_PREFIX}${kind}:${id}`;
}

async function asyncReadAll() {
  const keys = (await AsyncStorage.getAllKeys()).filter((key) => key.startsWith(KEY_PREFIX));
  if (!keys.length) return { triage: [], reviews: [], meta: null };
  const pairs = await AsyncStorage.multiGet(keys);
  const out = { triage: [], reviews: [], meta: null };
  for (const [key, raw] of pairs) {
    if (!raw) continue;
    let value;
    try {
      value = JSON.parse(raw);
    } catch {
      continue;
    }
    const rest = key.slice(KEY_PREFIX.length);
    if (rest === 'meta') out.meta = value;
    else if (rest.startsWith('triage:')) out.triage.push(value);
    else if (rest.startsWith('reviews:')) out.reviews.push(value);
  }
  return out;
}

async function asyncWrite({ triagePut, triageDelete, reviewPut, reviewDelete, meta }) {
  const sets = [];
  for (const row of triagePut || []) sets.push([rowKey('triage', row.id), JSON.stringify(row)]);
  for (const row of reviewPut || []) sets.push([rowKey('reviews', row.id), JSON.stringify(row)]);
  if (meta !== undefined) sets.push([`${KEY_PREFIX}meta`, JSON.stringify(meta)]);
  const removes = [
    ...(triageDelete || []).map((id) => rowKey('triage', id)),
    ...(reviewDelete || []).map((id) => rowKey('reviews', id)),
  ];
  if (sets.length) await AsyncStorage.multiSet(sets);
  if (removes.length) await AsyncStorage.multiRemove(removes);
}

async function asyncClear() {
  const keys = (await AsyncStorage.getAllKeys()).filter((key) => key.startsWith(KEY_PREFIX));
  if (keys.length) await AsyncStorage.multiRemove(keys);
}

/* Public API */

/**
 * Everything cached locally, or `null` when nothing has been written yet.
 * Shape: `{ triage: row[], reviews: row[], meta: object|null }`.
 */
export async function readTriageCache() {
  if (hasIndexedDb()) {
    try {
      const data = await idbReadAll();
      if (data.meta || data.triage.length || data.reviews.length) return data;
      return null;
    } catch {
      // fall through to AsyncStorage
    }
  }
  try {
    const data = await asyncReadAll();
    if (data.meta || data.triage.length || data.reviews.length) return data;
  } catch {
    // ignore
  }
  return null;
}

/**
 * The pre-IndexedDB single-blob cache. Read once on upgrade so nobody loses
 * unsynced work; `dropLegacyTriageCache` frees the localStorage quota after
 * the new store has been written.
 */
export async function readLegacyTriageCache() {
  try {
    const raw = await AsyncStorage.getItem(LEGACY_KEYS[0]);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export async function dropLegacyTriageCache() {
  try {
    await AsyncStorage.multiRemove(LEGACY_KEYS);
  } catch {
    // ignore
  }
}

/**
 * Write only what changed. Any field may be omitted. `meta` replaces the
 * whole meta record when present.
 */
export async function writeTriageCache(changes) {
  const empty =
    !(changes?.triagePut || []).length &&
    !(changes?.triageDelete || []).length &&
    !(changes?.reviewPut || []).length &&
    !(changes?.reviewDelete || []).length &&
    changes?.meta === undefined;
  if (empty) return;
  if (hasIndexedDb()) {
    try {
      await idbWrite(changes);
      return;
    } catch {
      // fall through to AsyncStorage
    }
  }
  await asyncWrite(changes);
}

export async function clearTriageCache() {
  if (hasIndexedDb()) {
    try {
      await idbClear();
    } catch {
      // ignore
    }
  }
  await asyncClear().catch(() => {});
  await dropLegacyTriageCache();
}
