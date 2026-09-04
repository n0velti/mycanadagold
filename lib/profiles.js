/**
 * Staff profile reads and per-user preferences.
 *
 * Profiles are created and their identity columns maintained only by the
 * `aureus-login` Edge Function. The client reads its own row (RLS) and may
 * update its preference columns (pinned_tools, apps_view, avatar_url).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getSupabase } from './supabase';

const PINNED_TOOLS_KEY = 'cgold_pinned_tools';
const APPS_VIEW_KEY = 'cgold_apps_view';
export const DEFAULT_APPS_VIEW = 'grid';
const APPS_VIEW_VALUES = new Set(['grid', 'list']);

export const PROFILE_COLUMNS =
  'id, aureus_user_id, aureus_login, email, first_name, last_name, full_name, role, employee_type, location_id, location_name, app_role, is_system_admin, is_active, pinned_tools, apps_view, avatar_url, last_login_at, created_at';

const AVATAR_BUCKET = 'avatars';
const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

function asString(value) {
  if (value == null) return '';
  return String(value).trim();
}

function dataUrlToBlob(dataUrl) {
  const match = asString(dataUrl).match(/^data:([^;]+);base64,([A-Za-z0-9+/=\s]+)$/);
  if (!match) return null;
  try {
    const binary = atob(match[2].replace(/\s/g, ''));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: match[1] || 'image/jpeg' });
  } catch {
    return null;
  }
}

function saveErrorMessage(error) {
  const message = asString(error?.message || error?.error_description);
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(message)) {
    return 'Could not save that portrait. Check your connection and try again.';
  }
  return message || 'Could not save that portrait.';
}

async function blobFromAsset(asset) {
  const uri = asString(asset?.uri);
  const fromData = dataUrlToBlob(uri);
  if (fromData) return fromData;

  if (asset instanceof Blob) return asset;
  if (typeof Blob !== 'undefined' && asset?.uri instanceof Blob) return asset.uri;
  if (!uri) throw new Error('Choose a photo first.');

  const response = await fetch(uri);
  if (!response.ok) throw new Error('Could not read that photo.');
  return response.blob();
}

export async function uploadOwnAvatar(asset) {
  const supabase = getSupabase();
  const userId = await currentUserId();
  if (!userId) throw new Error('Sign in to add a photo.');

  let blob;
  try {
    blob = await blobFromAsset(asset);
  } catch (error) {
    throw new Error(saveErrorMessage(error));
  }
  if (!blob || blob.size < 32) throw new Error('Choose a photo first.');
  if (blob.size > AVATAR_MAX_BYTES) {
    throw new Error('Choose a photo under 2 MB.');
  }

  const mime = asString(asset?.mimeType || asset?.type || blob.type || 'image/jpeg').toLowerCase() || 'image/jpeg';
  const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : mime.includes('gif') ? 'gif' : 'jpg';
  const path = `${userId}/avatar.${ext}`;
  const contentType = mime.startsWith('image/') ? mime : `image/${ext === 'jpg' ? 'jpeg' : ext}`;

  const { error: uploadError } = await supabase.storage.from(AVATAR_BUCKET).upload(path, blob, {
    upsert: true,
    contentType,
    cacheControl: '3600',
  });
  if (uploadError) throw new Error(saveErrorMessage(uploadError));

  const { data } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path);
  const avatarUrl = `${data.publicUrl}?v=${Date.now()}`;
  try {
    await updateOwnPreferences({ avatar_url: avatarUrl });
  } catch (error) {
    throw new Error(saveErrorMessage(error));
  }
  return avatarUrl;
}

export function sanitizeAppsView(value) {
  const next = asString(value).toLowerCase();
  return APPS_VIEW_VALUES.has(next) ? next : DEFAULT_APPS_VIEW;
}

export function mapProfileRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    aureusUserId: row.aureus_user_id,
    aureusLogin: row.aureus_login,
    email: row.email || '',
    firstName: row.first_name || '',
    lastName: row.last_name || '',
    fullName: row.full_name || '',
    role: row.role || '',
    employeeType: row.employee_type || '',
    locationId: row.location_id || '',
    locationName: row.location_name || '',
    avatarUrl: row.avatar_url || '',
    appRole: row.app_role || '',
    isSystemAdmin: Boolean(row.is_system_admin),
    isActive: row.is_active !== false,
    pinnedTools: Array.isArray(row.pinned_tools) ? row.pinned_tools : null,
    appsView: row.apps_view ? sanitizeAppsView(row.apps_view) : null,
    lastLoginAt: row.last_login_at || null,
    createdAt: row.created_at || null,
    firstLogin: false,
  };
}

const LEGACY_PROFILE_COLUMNS =
  'id, aureus_user_id, aureus_login, email, first_name, last_name, full_name, role, location_id, location_name, app_role, is_system_admin, is_active, pinned_tools, apps_view, last_login_at, created_at';

/** Raw profile row for the signed-in user, or null when RLS hides it. */
export async function fetchOwnProfile(supabase, userId) {
  const query = (columns) =>
    supabase.from('profiles').select(columns).eq('id', userId).maybeSingle();

  const { data, error } = await query(PROFILE_COLUMNS);
  if (!error) return data;
  if (!/employee_type|avatar_url/i.test(error.message || '')) throw error;

  const fallback = await query(LEGACY_PROFILE_COLUMNS);
  if (fallback.error) throw fallback.error;
  return fallback.data;
}

export function getProfile(session) {
  return session?.profile || null;
}

export function storeLocationFromSession(session) {
  return session?.profile?.locationName || '';
}

function posEmployeeType(profile) {
  const raw = asString(profile?.employeeType || profile?.role).toLowerCase();
  if (raw === 'administrator') return 'admin';
  return raw;
}

/** Aureus "Employee" (not Manager / Admin) is locked to one store and today. */
export function isRestrictedHomeEmployee(profile) {
  return posEmployeeType(profile) === 'employee';
}

export function allocatedStoreName(profile) {
  return asString(profile?.locationName);
}

function namesMatchStore(storeName, locationName) {
  const store = asString(storeName).toLowerCase();
  const location = asString(locationName).toLowerCase();
  if (!store || !location) return false;
  if (store === location) return true;
  return location.includes(store) || store.includes(location);
}

export function filterRowsToAllocatedStore(rows, profile) {
  const locationName = allocatedStoreName(profile);
  const list = Array.isArray(rows) ? rows : [];
  if (!locationName) return [];
  return list.filter((row) => namesMatchStore(row?.store, locationName));
}

async function currentUserId() {
  const { data } = await getSupabase().auth.getSession();
  return data?.session?.user?.id || null;
}

async function updateOwnPreferences(patch) {
  const supabase = getSupabase();
  const userId = await currentUserId();
  if (!userId) return;
  const { error } = await supabase
    .from('profiles')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', userId);
  if (error) throw error;
}

function preferenceStorageKey(prefix, session) {
  const id = session?.supabaseUserId || session?.profile?.id;
  const value = asString(id).toLowerCase();
  return value ? `${prefix}:${value}` : null;
}

// ---------------------------------------------------------------------------
// Pinned tools
// ---------------------------------------------------------------------------

function parsePinnedList(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function allowedSet(allowedKeys) {
  if (allowedKeys instanceof Set) return allowedKeys;
  return new Set(allowedKeys || []);
}

export function sanitizePinnedTools(keys, allowedKeys) {
  const allowed = allowedSet(allowedKeys);
  if (!Array.isArray(keys)) return [];
  const seen = new Set();
  const next = [];
  for (const key of keys) {
    const value = asString(key);
    if (!value || seen.has(value)) continue;
    if (allowed.size > 0 && !allowed.has(value)) continue;
    seen.add(value);
    next.push(value);
  }
  return next;
}

export async function persistPinnedTools(session, keys, allowedKeys) {
  const sanitized = sanitizePinnedTools(keys, allowedKeys);
  const storageKey = preferenceStorageKey(PINNED_TOOLS_KEY, session);
  if (storageKey) {
    await AsyncStorage.setItem(storageKey, JSON.stringify(sanitized));
  }
  updateOwnPreferences({ pinned_tools: sanitized }).catch(() => {
    // The device cache still holds this user's pins.
  });
  return sanitized;
}

export async function loadPinnedTools(session, allowedKeys) {
  if (!session?.token) return [];

  const allowed = allowedSet(allowedKeys);
  const storageKey = preferenceStorageKey(PINNED_TOOLS_KEY, session);
  const profilePins = session?.profile?.pinnedTools;

  if (Array.isArray(profilePins)) {
    const sanitized = sanitizePinnedTools(profilePins, allowed);
    if (storageKey) {
      await AsyncStorage.setItem(storageKey, JSON.stringify(sanitized));
    }
    return sanitized;
  }

  const local = parsePinnedList(storageKey ? await AsyncStorage.getItem(storageKey) : null);
  if (local) {
    const sanitized = sanitizePinnedTools(local, allowed);
    void persistPinnedTools(session, sanitized, allowed);
    return sanitized;
  }

  return [];
}

// ---------------------------------------------------------------------------
// Apps view (grid / list)
// ---------------------------------------------------------------------------

export async function persistAppsView(session, view) {
  const sanitized = sanitizeAppsView(view);
  const storageKey = preferenceStorageKey(APPS_VIEW_KEY, session);
  if (storageKey) {
    await AsyncStorage.setItem(storageKey, sanitized);
  }
  updateOwnPreferences({ apps_view: sanitized }).catch(() => {
    // The device cache still holds this user's layout.
  });
  return sanitized;
}

export async function loadAppsView(session) {
  if (!session?.token) return DEFAULT_APPS_VIEW;

  const storageKey = preferenceStorageKey(APPS_VIEW_KEY, session);
  const profileView = session?.profile?.appsView;
  if (profileView) {
    const sanitized = sanitizeAppsView(profileView);
    if (storageKey) {
      await AsyncStorage.setItem(storageKey, sanitized);
    }
    return sanitized;
  }

  const local = storageKey ? await AsyncStorage.getItem(storageKey) : null;
  if (local) {
    const sanitized = sanitizeAppsView(local);
    void persistAppsView(session, sanitized);
    return sanitized;
  }

  return DEFAULT_APPS_VIEW;
}
