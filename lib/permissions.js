import { createContext, useContext } from 'react';
import { getSupabase } from './supabase';

export const USER_CATEGORIES = [
  {
    key: 'precious_metal_analyst',
    label: 'Precious Metal Analyst',
    shortLabel: 'Analyst',
    description: 'Metals, inventory, transfers, and market tools',
  },
  {
    key: 'branch_manager',
    label: 'Branch Manager',
    shortLabel: 'Branch',
    description: 'Store operations, staff, and compliance at a branch',
  },
  {
    key: 'general_manager',
    label: 'General Manager',
    shortLabel: 'GM',
    description: 'Company-wide operations. Can also be marked a System Admin.',
  },
  {
    key: 'system_admin',
    label: 'System Admin',
    shortLabel: 'Admin',
    description: 'Every app, including Settings and permission management',
  },
];

export const USER_CATEGORY_KEYS = USER_CATEGORIES.map((category) => category.key);

export const ALL_APP_KEYS = [
  'transactions',
  'inventory',
  'preorders',
  'ai',
  'messages',
  'audit',
  'transfer',
  'fintrac',
  'financials',
  'accounting',
  'trends',
  'bonuses',
  'leaderboards',
  'tasks',
  'police-report',
  'security',
  'serphint',
  'supplies',
  'employees',
  'customers',
  'calendar',
  'notifications',
  'reviews',
  'emails',
  'documents',
  'contacts',
  'triage',
  '100-ways',
  'cdn-coin',
  'pmx',
  'shipping',
  'storage',
  'settings',
];

const PMA_APPS = [
  'transactions',
  'inventory',
  'preorders',
  'ai',
  'messages',
  'transfer',
  'trends',
  'financials',
  '100-ways',
  'cdn-coin',
  'pmx',
  'storage',
  'shipping',
];

export const DEFAULT_VISIBLE_APPS = {
  precious_metal_analyst: PMA_APPS,
  branch_manager: ALL_APP_KEYS.filter((key) => key !== 'settings' && key !== 'security'),
  general_manager: ALL_APP_KEYS.filter((key) => key !== 'settings'),
  system_admin: [...ALL_APP_KEYS],
};

export const AppAccessContext = createContext({
  allowedKeys: null,
  canManageAccess: false,
  hasApp: () => true,
  canFilter: () => true,
});

export function useAppAccess() {
  return useContext(AppAccessContext);
}

function asString(value) {
  if (value == null) return '';
  return String(value).trim();
}

export function getCategory(key) {
  return USER_CATEGORIES.find((category) => category.key === key) || null;
}

export function normalizeAppRole(value) {
  const key = asString(value);
  return USER_CATEGORY_KEYS.includes(key) ? key : '';
}

export function inferAppRole(aureusRole, employeeType) {
  const value = `${asString(aureusRole)} ${asString(employeeType)}`.toLowerCase();
  if (!value.trim()) return 'precious_metal_analyst';
  if (/general\s*manager|\bgm\b/.test(value)) return 'general_manager';
  if (/system\s*admin|sysadmin|super\s*admin|\badministrators?\b|\badmins?\b/.test(value)) {
    return 'general_manager';
  }
  if (/branch\s*manager|store\s*manager|\bmanagers?\b|\bmgr\b/.test(value)) {
    return 'branch_manager';
  }
  if (/precious\s*metal|metal\s*analyst|\bpma\b|\banalyst\b/.test(value)) {
    return 'precious_metal_analyst';
  }
  return 'precious_metal_analyst';
}

export function hasFullAppAccess(profile) {
  return profile?.appRole === 'system_admin' || profile?.isSystemAdmin === true;
}

export function canManageAppAccess(profile) {
  return hasFullAppAccess(profile);
}

export function categoryLabel(profile) {
  const category = getCategory(profile?.appRole);
  if (!category) return '';
  if (profile?.appRole === 'general_manager' && profile?.isSystemAdmin) {
    return `${category.label} · System Admin`;
  }
  return category.label;
}

function allowedSet(keys) {
  if (keys instanceof Set) return keys;
  return new Set(Array.isArray(keys) ? keys : []);
}

export function sanitizeAppKeys(keys, catalogKeys) {
  const allowed = allowedSet(catalogKeys);
  if (allowed.size === 0) {
    ALL_APP_KEYS.forEach((key) => allowed.add(key));
  }
  if (!Array.isArray(keys)) return [];
  const seen = new Set();
  const next = [];
  for (const key of keys) {
    const value = asString(key);
    if (!value || seen.has(value) || !allowed.has(value)) continue;
    seen.add(value);
    next.push(value);
  }
  return next;
}

export function defaultAccessByRole(catalogKeys) {
  const allowed = allowedSet(catalogKeys);
  const result = {};
  for (const role of USER_CATEGORY_KEYS) {
    const source =
      role === 'system_admin'
        ? [...allowed]
        : DEFAULT_VISIBLE_APPS[role] || [];
    result[role] = sanitizeAppKeys(
      role === 'system_admin' ? Array.from(allowed) : source,
      allowed,
    );
  }
  if (result.system_admin.length === 0) {
    result.system_admin = Array.from(allowed);
  }
  return result;
}

function normalizeUserOverride(userOverride, catalogKeys) {
  if (!userOverride || !Array.isArray(userOverride.visibleApps)) return null;
  const visibleApps = sanitizeAppKeys(userOverride.visibleApps, catalogKeys);
  const visibleSet = new Set(visibleApps);
  const filterableApps = sanitizeAppKeys(userOverride.filterableApps, catalogKeys).filter((key) =>
    visibleSet.has(key),
  );
  return { visibleApps, filterableApps };
}

export function visibleAppKeysForProfile(profile, accessByRole, catalogKeys, userOverride) {
  const allowed = allowedSet(catalogKeys);
  const all = Array.from(allowed);
  if (hasFullAppAccess(profile)) return all;

  const override = normalizeUserOverride(userOverride, allowed);
  if (override) return override.visibleApps;

  const role = normalizeAppRole(profile?.appRole) || 'precious_metal_analyst';
  const listed = accessByRole?.[role];
  const source = Array.isArray(listed) ? listed : DEFAULT_VISIBLE_APPS[role] || [];
  return sanitizeAppKeys(source, allowed);
}

export function canFilterApp(profile, appKey, userOverride, visibleKeys) {
  if (hasFullAppAccess(profile)) return true;
  const key = asString(appKey);
  if (!key) return false;
  const visible =
    visibleKeys instanceof Set ? visibleKeys : new Set(Array.isArray(visibleKeys) ? visibleKeys : []);
  if (!visible.has(key)) return false;
  if (!userOverride || !Array.isArray(userOverride.filterableApps)) return true;
  return userOverride.filterableApps.includes(key);
}

/** Effective show/filter lists for the permissions editor. */
export function resolvedAccessForProfile(profile, accessByRole, catalogKeys, userOverride) {
  const allowed = allowedSet(catalogKeys);
  const all = Array.from(allowed);
  if (hasFullAppAccess(profile)) {
    return { visibleApps: all, filterableApps: all, inherited: false, locked: true };
  }
  const inheritedVisible = visibleAppKeysForProfile(profile, accessByRole, catalogKeys, null);
  const override = normalizeUserOverride(userOverride, allowed);
  if (override) {
    return { ...override, inherited: false, locked: false };
  }
  return {
    visibleApps: inheritedVisible,
    filterableApps: [...inheritedVisible],
    inherited: true,
    locked: false,
  };
}

function mapUserAccessRow(row, catalogKeys) {
  if (!row?.user_id) return null;
  const override = normalizeUserOverride(
    { visibleApps: row.visible_apps, filterableApps: row.filterable_apps },
    catalogKeys,
  );
  if (!override) return null;
  return { userId: row.user_id, ...override };
}

/**
 * Loads per-person overrides. RLS returns every row for a System Admin and
 * only the caller's row otherwise. Missing table → empty map (inherit roles).
 */
export async function loadUserAppAccessMap(catalogKeys) {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('user_app_access')
      .select('user_id, visible_apps, filterable_apps');
    if (error) throw error;

    const byUser = {};
    for (const row of data || []) {
      const mapped = mapUserAccessRow(row, catalogKeys);
      if (mapped) byUser[mapped.userId] = mapped;
    }
    return { byUser, error: null };
  } catch (error) {
    return { byUser: {}, error: error?.message || 'Could not load employee app access.' };
  }
}

export async function loadOwnUserAppAccess(userId, catalogKeys) {
  const id = asString(userId);
  if (!id) return null;
  const { byUser } = await loadUserAppAccessMap(catalogKeys);
  return byUser[id] || null;
}

export async function saveUserAppAccess(userId, access, catalogKeys, actorId) {
  const id = asString(userId);
  if (!id) throw new Error('Missing staff member.');
  const next = normalizeUserOverride(
    { visibleApps: access?.visibleApps, filterableApps: access?.filterableApps },
    catalogKeys,
  ) || { visibleApps: [], filterableApps: [] };

  const supabase = getSupabase();
  const { error } = await supabase.from('user_app_access').upsert(
    {
      user_id: id,
      visible_apps: next.visibleApps,
      filterable_apps: next.filterableApps,
      updated_at: new Date().toISOString(),
      updated_by: actorId || null,
    },
    { onConflict: 'user_id' },
  );
  if (error) throw error;
  return { userId: id, ...next };
}

export async function clearUserAppAccess(userId) {
  const id = asString(userId);
  if (!id) throw new Error('Missing staff member.');
  const supabase = getSupabase();
  const { error } = await supabase.from('user_app_access').delete().eq('user_id', id);
  if (error) throw error;
}

/**
 * Loads app visibility per category. Fails closed: when the table cannot be
 * read, each category falls back to its built-in default list rather than to
 * "everything".
 */
export async function loadRoleAppAccess(catalogKeys) {
  const defaults = defaultAccessByRole(catalogKeys);

  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('role_app_access')
      .select('role, visible_apps');
    if (error) throw error;

    const byRole = { ...defaults };
    for (const row of data || []) {
      const role = normalizeAppRole(row.role);
      if (!role) continue;
      if (role === 'system_admin') {
        byRole[role] = defaults.system_admin;
        continue;
      }
      byRole[role] = sanitizeAppKeys(row.visible_apps, catalogKeys);
    }
    return { byRole, error: null };
  } catch (error) {
    return { byRole: defaults, error: error?.message || 'Could not load app permissions.' };
  }
}

export async function saveRoleAppAccess(accessByRole, catalogKeys, userId) {
  const defaults = defaultAccessByRole(catalogKeys);
  const supabase = getSupabase();
  const now = new Date().toISOString();
  const rows = USER_CATEGORY_KEYS.map((role) => ({
    role,
    visible_apps: role === 'system_admin' ? defaults.system_admin : sanitizeAppKeys(accessByRole?.[role], catalogKeys),
    updated_at: now,
    updated_by: userId || null,
  }));

  const { error } = await supabase.from('role_app_access').upsert(rows, { onConflict: 'role' });
  if (error) throw error;

  const next = { ...defaults };
  for (const row of rows) {
    next[row.role] = row.visible_apps;
  }
  return next;
}

const STAFF_COLUMNS =
  'id, aureus_user_id, aureus_login, email, first_name, last_name, full_name, role, employee_type, location_name, app_role, is_system_admin, is_active, deactivated_at, last_login_at, avatar_url';

const LEGACY_STAFF_COLUMNS =
  'id, aureus_user_id, aureus_login, email, first_name, last_name, full_name, role, location_name, app_role, is_system_admin, is_active, deactivated_at, last_login_at';

function mapStaffRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    aureusUserId: row.aureus_user_id || '',
    aureusLogin: row.aureus_login || '',
    email: row.email || '',
    firstName: row.first_name || '',
    lastName: row.last_name || '',
    fullName: row.full_name || '',
    posRole: row.role || '',
    employeeType: row.employee_type || row.role || '',
    locationName: row.location_name || '',
    avatarUrl: row.avatar_url || '',
    appRole: normalizeAppRole(row.app_role) || 'precious_metal_analyst',
    isSystemAdmin: Boolean(row.is_system_admin),
    isActive: row.is_active !== false,
    deactivatedAt: row.deactivated_at || null,
    lastLoginAt: row.last_login_at || null,
  };
}

export async function listStaffProfiles() {
  const supabase = getSupabase();
  const query = (columns) =>
    supabase.from('profiles').select(columns).order('full_name', { ascending: true, nullsFirst: false });

  const { data, error } = await query(STAFF_COLUMNS);
  if (!error) return (data || []).map(mapStaffRow).filter(Boolean);
  if (!/employee_type|avatar_url/i.test(error.message || '')) throw error;

  const fallback = await query(LEGACY_STAFF_COLUMNS);
  if (fallback.error) throw fallback.error;
  return (fallback.data || []).map(mapStaffRow).filter(Boolean);
}

/**
 * System-admin only (enforced by RLS + triggers). Updates a person's category,
 * their GM-as-admin flag, and whether they may sign in at all.
 */
export async function updateStaffAccess(userId, { appRole, isSystemAdmin, isActive }) {
  const role = normalizeAppRole(appRole);
  if (!role) throw new Error('Choose a user category.');

  const patch = {
    app_role: role,
    is_system_admin: role === 'system_admin' ? true : role === 'general_manager' ? Boolean(isSystemAdmin) : false,
    updated_at: new Date().toISOString(),
  };
  if (typeof isActive === 'boolean') {
    patch.is_active = isActive;
  }

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('profiles')
    .update(patch)
    .eq('id', userId)
    .select(STAFF_COLUMNS)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('That person could not be updated.');
  return mapStaffRow(data);
}
