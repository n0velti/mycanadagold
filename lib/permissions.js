import { createContext, useContext } from 'react';
import { getSupabase } from './supabase';

export const USER_CATEGORIES = [
  {
    key: 'precious_metal_analyst',
    label: 'Precious Metal Analyst',
    shortLabel: 'Analyst',
    description: 'Metals, inventory, transfers, and market tools',
    tint: '#EEF4FF',
    accent: '#3B6FE0',
  },
  {
    key: 'triage',
    label: 'Triage',
    shortLabel: 'Triage',
    description: 'Workshop melt batches, planned transfers, and related inventory',
    tint: '#FFEDD5',
    accent: '#C2410C',
  },
  {
    key: 'hr',
    label: 'HR',
    shortLabel: 'HR',
    description: 'Employees, bonuses, and people operations across stores',
    tint: '#EEF2FF',
    accent: '#4338CA',
  },
  {
    key: 'branch_manager',
    label: 'Branch Manager',
    shortLabel: 'Branch',
    description: 'Store operations, staff, and compliance at a branch',
    tint: '#EAF6EE',
    accent: '#2F8A4E',
  },
  {
    key: 'general_manager',
    label: 'General Manager',
    shortLabel: 'GM',
    description: 'Company-wide operations, including company AI keys. Can also be marked a System Admin.',
    tint: '#F3EEFF',
    accent: '#6B4DE6',
  },
  {
    key: 'system_admin',
    label: 'System Admin',
    shortLabel: 'Admin',
    description: 'Every app, including Settings and permission management',
    tint: '#F4F4F5',
    accent: '#3F3F46',
  },
];

export const USER_CATEGORY_KEYS = USER_CATEGORIES.map((category) => category.key);

export const ALL_APP_KEYS = [
  'home',
  'transactions',
  'inventory',
  'preorders',
  'ai',
  'messages',
  'audit',
  'transfer',
  'fintrac',
  'financials',
  'debit',
  'accounting',
  'analytics',
  'pricing',
  'bonuses',
  'leaderboards',
  'police-report',
  'security',
  'serphint',
  'supplies',
  'employees',
  'phone',
  'teams',
  'marketing',
  'shared-services',
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
  'logs',
  'settings',
];

const PMA_APPS = [
  'home',
  'transactions',
  'inventory',
  'preorders',
  'ai',
  'messages',
  'emails',
  'transfer',
  'pricing',
  'financials',
  'debit',
  'phone',
  '100-ways',
  'cdn-coin',
  'pmx',
  'storage',
  'shipping',
  'teams',
  'marketing',
  'shared-services',
];

const TRIAGE_APPS = [
  'home',
  'triage',
  'transfer',
  'inventory',
  'transactions',
  'preorders',
  'shipping',
  'storage',
  'messages',
  'emails',
  'phone',
  'ai',
];

const HR_APPS = [
  'home',
  'employees',
  'bonuses',
  'leaderboards',
  'calendar',
  'messages',
  'emails',
  'documents',
  'contacts',
  'notifications',
  'teams',
  'reviews',
];

export const DEFAULT_VISIBLE_APPS = {
  precious_metal_analyst: PMA_APPS,
  triage: TRIAGE_APPS,
  hr: HR_APPS,
  branch_manager: ALL_APP_KEYS.filter(
    (key) => key !== 'settings' && key !== 'security' && key !== 'logs' && key !== 'analytics',
  ),
  general_manager: [...ALL_APP_KEYS],
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
  if (/general\s*manager|\bgm\b|owner|president|director|vice\s*president|\bvp\b/.test(value)) {
    return 'general_manager';
  }
  if (/system\s*admin|sysadmin|super\s*admin|\badministrators?\b|\badmins?\b/.test(value)) {
    return 'general_manager';
  }
  if (/human\s*resources|\bhr\b|people\s*ops|people\s*operations/.test(value)) {
    return 'hr';
  }
  if (/\btriage\b|workshop|melt/.test(value)) {
    return 'triage';
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

export function canAccessAnalytics(profile) {
  if (hasFullAppAccess(profile)) return true;
  return normalizeAppRole(profile?.appRole) === 'general_manager';
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

const HOME_FILTER_OFF_ROLES = new Set(['precious_metal_analyst', 'branch_manager']);

function defaultHomeFilterable(profile) {
  if (hasFullAppAccess(profile)) return true;
  const role = normalizeAppRole(profile?.appRole);
  return !HOME_FILTER_OFF_ROLES.has(role);
}

function overrideConfiguresHome(userOverride) {
  if (!userOverride) return false;
  const visible = Array.isArray(userOverride.visibleApps) ? userOverride.visibleApps : [];
  const filterable = Array.isArray(userOverride.filterableApps) ? userOverride.filterableApps : [];
  return visible.includes('home') || filterable.includes('home');
}

export function canFilterHome(profile, userOverride) {
  if (hasFullAppAccess(profile)) return true;
  if (!overrideConfiguresHome(userOverride)) return defaultHomeFilterable(profile);
  return Array.isArray(userOverride.filterableApps) && userOverride.filterableApps.includes('home');
}

function ensureHomeVisible(keys, catalogKeys) {
  const next = sanitizeAppKeys(keys, catalogKeys);
  if (!allowedSet(catalogKeys).has('home') || next.includes('home')) return next;
  return ['home', ...next];
}

function withHomeFilterable(profile, visibleApps, filterableApps, userOverride) {
  const next = (filterableApps || []).filter((key) => key !== 'home');
  if (visibleApps.includes('home') && canFilterHome(profile, userOverride)) {
    return [...next, 'home'];
  }
  return next;
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
    result[role] = ensureHomeVisible(
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
  const role = normalizeAppRole(profile?.appRole) || 'precious_metal_analyst';
  const listed = accessByRole?.[role];
  const source = override
    ? override.visibleApps
    : Array.isArray(listed)
      ? listed
      : DEFAULT_VISIBLE_APPS[role] || [];
  const keys = ensureHomeVisible(source, allowed);
  const next =
    role === 'general_manager' && allowed.has('settings') && !keys.includes('settings')
      ? [...keys, 'settings']
      : keys;
  if (allowed.has('analytics') && !canAccessAnalytics(profile)) {
    return next.filter((key) => key !== 'analytics');
  }
  return next;
}

export function canFilterApp(profile, appKey, userOverride, visibleKeys) {
  const key = asString(appKey);
  if (key === 'home') return canFilterHome(profile, userOverride);
  if (hasFullAppAccess(profile)) return true;
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
    const visibleApps = ensureHomeVisible(override.visibleApps, allowed);
    return {
      visibleApps,
      filterableApps: withHomeFilterable(profile, visibleApps, override.filterableApps, override),
      inherited: false,
      locked: false,
    };
  }
  return {
    visibleApps: inheritedVisible,
    filterableApps: withHomeFilterable(profile, inheritedVisible, inheritedVisible, null),
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

/** Enable or disable filter rights on specific apps. Visible apps stay the same. */
export function applyFilterablePatch(access, patch, catalogKeys) {
  const current = normalizeUserOverride(
    { visibleApps: access?.visibleApps, filterableApps: access?.filterableApps },
    catalogKeys,
  ) || { visibleApps: [], filterableApps: [] };
  const visibleSet = new Set(current.visibleApps);
  const filterable = new Set(current.filterableApps.filter((key) => visibleSet.has(key)));
  for (const [appKey, enabled] of Object.entries(patch || {})) {
    const key = asString(appKey);
    if (!key || !visibleSet.has(key)) continue;
    if (enabled) filterable.add(key);
    else filterable.delete(key);
  }
  return {
    visibleApps: current.visibleApps,
    filterableApps: current.visibleApps.filter((key) => filterable.has(key)),
  };
}

export function accessListsEqual(a, b) {
  const visA = Array.isArray(a?.visibleApps) ? a.visibleApps : [];
  const visB = Array.isArray(b?.visibleApps) ? b.visibleApps : [];
  const filA = Array.isArray(a?.filterableApps) ? a.filterableApps : [];
  const filB = Array.isArray(b?.filterableApps) ? b.filterableApps : [];
  if (visA.length !== visB.length || filA.length !== filB.length) return false;
  return visA.every((key, index) => key === visB[index]) && filA.every((key, index) => key === filB[index]);
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

const USER_ACCESS_UPSERT_CHUNK = 80;

export async function saveUserAppAccessBatch(entries, catalogKeys, actorId) {
  const now = new Date().toISOString();
  const rows = [];
  const saved = [];
  for (const entry of entries || []) {
    const id = asString(entry?.userId);
    if (!id) continue;
    const next = normalizeUserOverride(
      { visibleApps: entry?.visibleApps, filterableApps: entry?.filterableApps },
      catalogKeys,
    ) || { visibleApps: [], filterableApps: [] };
    rows.push({
      user_id: id,
      visible_apps: next.visibleApps,
      filterable_apps: next.filterableApps,
      updated_at: now,
      updated_by: actorId || null,
    });
    saved.push({ userId: id, ...next });
  }
  if (rows.length === 0) return [];

  const supabase = getSupabase();
  for (let index = 0; index < rows.length; index += USER_ACCESS_UPSERT_CHUNK) {
    const chunk = rows.slice(index, index + USER_ACCESS_UPSERT_CHUNK);
    const { error } = await supabase.from('user_app_access').upsert(chunk, { onConflict: 'user_id' });
    if (error) throw error;
  }
  return saved;
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
      byRole[role] = ensureHomeVisible(row.visible_apps, catalogKeys);
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
    visible_apps: role === 'system_admin' ? defaults.system_admin : ensureHomeVisible(accessByRole?.[role], catalogKeys),
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
  'id, aureus_user_id, aureus_login, email, first_name, last_name, full_name, role, employee_type, location_name, app_role, is_system_admin, is_active, deactivated_at, last_login_at, avatar_url, team_id, is_team_intake';

const STAFF_COLUMNS_WITHOUT_TEAM =
  'id, aureus_user_id, aureus_login, email, first_name, last_name, full_name, role, employee_type, location_name, app_role, is_system_admin, is_active, deactivated_at, last_login_at, avatar_url';

const LEGACY_STAFF_COLUMNS =
  'id, aureus_user_id, aureus_login, email, first_name, last_name, full_name, role, location_name, app_role, is_system_admin, is_active, deactivated_at, last_login_at';

export function staffDisplayName(row) {
  return String(
    row?.fullName || [row?.firstName, row?.lastName].filter(Boolean).join(' ') || row?.email || '',
  ).trim();
}

function namesMatch(a, b) {
  return (
    String(a || '')
      .trim()
      .localeCompare(String(b || '').trim(), undefined, { sensitivity: 'base' }) === 0
  );
}

function normalizePersonName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[.]/g, ' ')
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function nameTokens(value) {
  return normalizePersonName(value).split(' ').filter(Boolean);
}

function staffNameMatches(person, employeeName) {
  if (
    namesMatch(staffDisplayName(person), employeeName) ||
    namesMatch(person?.fullName, employeeName) ||
    namesMatch([person?.firstName, person?.lastName].filter(Boolean).join(' '), employeeName) ||
    namesMatch(person?.aureusLogin, employeeName) ||
    namesMatch(person?.email, employeeName)
  ) {
    return true;
  }

  const query = nameTokens(employeeName);
  if (!query.length) return false;
  const first = normalizePersonName(person?.firstName);
  const last = normalizePersonName(person?.lastName);
  const full = nameTokens(staffDisplayName(person) || person?.fullName);
  const joined = query.join(' ');
  if (full.length && full.join(' ') === joined) return true;
  if (first && last && `${first} ${last}` === joined) return true;

  if (query.length >= 2 && first && last) {
    const qFirst = query[0];
    const qLast = query[query.length - 1];
    if (qFirst === first && (qLast === last || last.startsWith(qLast) || qLast === last.charAt(0))) return true;
    if (qLast === last && (qFirst === first || first.startsWith(qFirst) || qFirst === first.charAt(0))) return true;
  }
  return false;
}

export function findStaffById(staff, id) {
  const key = String(id || '').trim();
  if (!key) return null;
  return (
    (staff || []).find(
      (person) => String(person?.id || '') === key || String(person?.aureusUserId || '') === key,
    ) || null
  );
}

export function findStaffByEmployeeName(staff, employeeName) {
  const name = String(employeeName || '').trim();
  if (!name || name === '—') return null;
  const list = staff || [];
  const exact = list.find(
    (person) =>
      namesMatch(staffDisplayName(person), name) ||
      namesMatch(person?.fullName, name) ||
      namesMatch([person?.firstName, person?.lastName].filter(Boolean).join(' '), name) ||
      namesMatch(person?.aureusLogin, name) ||
      namesMatch(person?.email, name),
  );
  if (exact) return exact;
  const loose = list.filter((person) => staffNameMatches(person, name));
  if (loose.length === 1) return loose[0];
  const active = loose.filter((person) => person?.isActive !== false);
  return active.length === 1 ? active[0] : loose[0] || null;
}

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
    teamId: row.team_id || '',
    isTeamIntake: Boolean(row.is_team_intake),
    appRole: normalizeAppRole(row.app_role) || 'precious_metal_analyst',
    isSystemAdmin: Boolean(row.is_system_admin),
    isActive: row.is_active !== false,
    deactivatedAt: row.deactivated_at || null,
    lastLoginAt: row.last_login_at || null,
  };
}

async function supplementStaffFromDirectory(rows) {
  const existing = Array.isArray(rows) ? rows.filter(Boolean) : [];
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase.rpc('list_dm_contacts');
    if (error || !Array.isArray(data) || data.length === 0) return existing;
    const byId = new Map(existing.map((row) => [row.id, row]));
    for (const row of data) {
      if (!row?.id || byId.has(row.id)) continue;
      const mapped = mapStaffRow({
        id: row.id,
        first_name: row.first_name,
        last_name: row.last_name,
        full_name: row.full_name,
        avatar_url: row.avatar_url,
        location_name: row.location_name,
        is_active: true,
      });
      if (mapped) byId.set(mapped.id, mapped);
    }
    return Array.from(byId.values()).sort((a, b) =>
      staffDisplayName(a).localeCompare(staffDisplayName(b), undefined, { sensitivity: 'base' }),
    );
  } catch {
    return existing;
  }
}

export async function listStaffProfiles() {
  const supabase = getSupabase();
  const query = (columns) =>
    supabase.from('profiles').select(columns).order('full_name', { ascending: true, nullsFirst: false });

  const { data, error } = await query(STAFF_COLUMNS);
  if (!error) {
    const mapped = (data || []).map(mapStaffRow).filter(Boolean);
    return mapped.length > 1 ? mapped : supplementStaffFromDirectory(mapped);
  }
  if (/team_id|is_team_intake/i.test(error.message || '')) {
    const withoutTeam = await query(STAFF_COLUMNS_WITHOUT_TEAM);
    if (!withoutTeam.error) {
      const mapped = (withoutTeam.data || []).map(mapStaffRow).filter(Boolean);
      return mapped.length > 1 ? mapped : supplementStaffFromDirectory(mapped);
    }
    if (!/employee_type|avatar_url/i.test(withoutTeam.error.message || '')) throw withoutTeam.error;
  } else if (!/employee_type|avatar_url/i.test(error.message || '')) {
    throw error;
  }

  const fallback = await query(LEGACY_STAFF_COLUMNS);
  if (fallback.error) throw fallback.error;
  const mapped = (fallback.data || []).map(mapStaffRow).filter(Boolean);
  return mapped.length > 1 ? mapped : supplementStaffFromDirectory(mapped);
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
