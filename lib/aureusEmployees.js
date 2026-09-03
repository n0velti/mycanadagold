/**
 * Aureus POS employee directory. GET /employees is the source for role,
 * default location, and the rest of the staff record. user_data often only
 * has the till that is currently open.
 */
import { API_BASE_URL, authHeaders } from './auth';
import { fetchPosLocations } from './locations';

function getErrorMessage(payload, fallback) {
  return payload?.error?.message || payload?.message || fallback;
}

function asString(value) {
  if (value == null) return '';
  return String(value).trim();
}

function firstObject(...candidates) {
  for (const value of candidates) {
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  }
  return {};
}

function pick(object, keys) {
  for (const key of keys) {
    const value = object?.[key];
    if (value == null || value === '') continue;
    if (typeof value === 'object') continue;
    return value;
  }
  return '';
}

function rowsFromPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.employees)) return payload.employees;
  return [];
}

function lastPageFromPayload(payload, fallback = 1) {
  const value = Number(payload?.last_page ?? payload?.meta?.last_page ?? payload?.meta?.lastPage ?? fallback);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function canonicalEmployeeType(value) {
  const lower = asString(value).toLowerCase();
  if (!lower) return '';
  if (
    /general\s*manager|\bgm\b|system\s*admin|sysadmin|super\s*admin|\badministrators?\b|\badmins?\b/.test(
      lower,
    )
  ) {
    return 'Admin';
  }
  if (/branch\s*manager|store\s*manager|\bmanagers?\b|\bmgr\b/.test(lower)) {
    return 'Manager';
  }
  if (/^employee$|\bemployees?\b|\bcashier\b|\bclerk\b|precious\s*metal|\banalyst\b|\bpma\b/.test(lower)) {
    return 'Employee';
  }
  return '';
}

function typeRank(value) {
  if (value === 'Admin') return 3;
  if (value === 'Manager') return 2;
  if (value === 'Employee') return 1;
  return 0;
}

function locationFrom(row) {
  const employee = firstObject(row.employee);
  const nested = firstObject(
    row.default_location,
    row.defaultLocation,
    row.default_loc,
    row.defaultLoc,
    employee.default_location,
    employee.default_loc,
    employee.location,
    row.location,
    row.store,
  );

  const idKeys = [
    'default_location_id',
    'defaultLocationId',
    'default_loc_id',
    'location_id',
    'locationId',
    'loc_id',
    'store_id',
    'storeId',
  ];
  const nameKeys = [
    'default_location_name',
    'defaultLocationName',
    'location_name',
    'locationName',
    'store_name',
    'storeName',
  ];

  let locationId = asString(nested.id || nested.location_id || pick(employee, idKeys) || pick(row, idKeys));
  let locationName = asString(
    nested.name || nested.location_name || nested.title || pick(employee, nameKeys) || pick(row, nameKeys),
  );

  if (!locationName) {
    for (const candidate of [row.default_location, row.default_loc, employee.default_location, row.location, row.store]) {
      if (typeof candidate === 'string' && candidate.trim()) {
        locationName = asString(candidate);
        break;
      }
    }
  }

  if (!locationId) {
    for (const candidate of [row.default_location, row.default_loc, employee.default_location, row.location]) {
      if (typeof candidate === 'number') {
        locationId = String(candidate);
        break;
      }
    }
  }

  return { locationId, locationName };
}

function roleFrom(row) {
  const nestedRole = firstObject(
    typeof row.role === 'object' ? row.role : null,
    row.user_role,
    row.userRole,
  );
  return asString(
    nestedRole.name ||
      nestedRole.title ||
      pick(row, ['role', 'job_title', 'jobTitle', 'position', 'pos_role', 'title']),
  );
}

function employeeTypeFrom(row, role) {
  const employee = firstObject(row.employee);
  const flags = [];
  if (row.is_admin === true || row.admin === true || employee.is_admin === true) flags.push('Admin');
  if (row.is_manager === true || row.manager === true || employee.is_manager === true) flags.push('Manager');
  const candidates = [
    ...flags,
    role,
    pick(employee, ['role', 'employee_type', 'employeeType']),
    pick(row, ['employee_type', 'employeeType', 'user_type', 'userType', 'pos_role', 'access_level']),
    pick(employee, ['type']),
    pick(row, ['type']),
  ];
  let best = '';
  for (const candidate of candidates) {
    const known = canonicalEmployeeType(asString(candidate));
    if (typeRank(known) > typeRank(best)) best = known;
  }
  return best;
}

function isActiveEmployee(row) {
  if (row?.active === false || row?.is_active === false || row?.enabled === false) return false;
  const status = asString(row?.status || row?.employee_status).toLowerCase();
  if (!status) return true;
  return !/inactive|disabled|terminated|deleted|archived/.test(status);
}

export function mapAureusEmployee(row) {
  if (!row || typeof row !== 'object') return null;
  const nestedUser = firstObject(row.user);
  const source = { ...row, ...nestedUser };
  const firstName = asString(pick(source, ['first_name', 'firstName', 'firstname']));
  const lastName = asString(pick(source, ['last_name', 'lastName', 'lastname']));
  const fullName =
    [firstName, lastName].filter(Boolean).join(' ') ||
    asString(pick(source, ['full_name', 'fullName', 'name', 'display_name', 'displayName']));
  const email = asString(pick(source, ['email', 'email_address'])).toLowerCase();
  const login = asString(pick(source, ['login', 'username', 'user_name'])) || email;
  const id = asString(pick(source, ['id', 'user_id', 'userId', 'employee_id', 'employeeId', 'uuid']));
  const role = roleFrom(source);
  const employeeType = employeeTypeFrom(source, role);
  const location = locationFrom(source);
  const phone = asString(pick(source, ['phone', 'phone_number', 'mobile', 'cell_phone', 'cell']));

  if (!id && !fullName && !email && !login) return null;

  return {
    id: id || login || email || fullName,
    aureusUserId: id,
    aureusLogin: login,
    firstName,
    lastName,
    fullName,
    email: email.includes('@') ? email : '',
    phone,
    role,
    employeeType,
    locationId: location.locationId,
    locationName: location.locationName,
    isActive: isActiveEmployee(source),
    photoUrl: asString(pick(source, ['photo', 'photo_url', 'avatar', 'avatar_url', 'image_url'])),
  };
}

async function fetchEmployeesPage(token, baseUrl, { page, itemsPerPage, query } = {}) {
  const params = new URLSearchParams();
  if (page) params.set('page', String(page));
  if (itemsPerPage) params.set('items_per_page', String(itemsPerPage));
  if (query) params.set('query', query);

  const suffix = params.toString() ? `?${params}` : '';
  const response = await fetch(`${baseUrl}/employees${suffix}`, {
    method: 'GET',
    headers: authHeaders(token),
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  return { ok: response.ok, status: response.status, payload };
}

/**
 * Every employee the signed-in POS session can read, with role and default store.
 */
export async function fetchAureusEmployees(token, baseUrl = API_BASE_URL) {
  const root = String(baseUrl || API_BASE_URL).replace(/\/$/, '');
  const all = [];
  const seen = new Set();
  const pageSize = 200;
  let page = 1;
  let lastPage = 1;
  let queryItemsPerPage = true;

  while (page <= lastPage && page <= 10) {
    const query = queryItemsPerPage ? { page, itemsPerPage: pageSize } : page > 1 ? { page } : {};
    let result = await fetchEmployeesPage(token, root, query);
    if (!result.ok && page === 1 && queryItemsPerPage) {
      queryItemsPerPage = false;
      result = await fetchEmployeesPage(token, root, {});
    }
    if (!result.ok) {
      throw new Error(getErrorMessage(result.payload, 'Failed to load employees from Aureus.'));
    }

    const batch = rowsFromPayload(result.payload);
    const addedBefore = all.length;
    for (const row of batch) {
      const mapped = mapAureusEmployee(row);
      if (!mapped) continue;
      if (seen.has(mapped.id)) continue;
      seen.add(mapped.id);
      all.push(mapped);
    }

    const pager = lastPageFromPayload(result.payload, 0);
    if (pager > 0) {
      lastPage = pager;
    } else if (batch.length === 0 || all.length === addedBefore || (queryItemsPerPage && batch.length < pageSize)) {
      break;
    } else {
      lastPage = page + 1;
    }

    if (batch.length === 0 || all.length === addedBefore) break;
    page += 1;
  }

  const needsName = all.some((row) => row.locationId && !row.locationName);
  if (needsName) {
    try {
      const locations = await fetchPosLocations(root, token);
      const byId = new Map(
        (locations || []).map((location) => [String(location.id), asString(location.name)]),
      );
      for (const row of all) {
        if (!row.locationName && row.locationId) {
          row.locationName = byId.get(String(row.locationId)) || '';
        }
      }
    } catch {
      // Default location names stay blank when the locations list is unavailable.
    }
  }

  all.sort((a, b) =>
    (a.fullName || a.email || a.aureusLogin).localeCompare(b.fullName || b.email || b.aureusLogin, undefined, {
      sensitivity: 'base',
    }),
  );
  return all;
}

function profileMatchKey(profile) {
  return {
    id: asString(profile?.aureusUserId),
    login: asString(profile?.aureusLogin).toLowerCase(),
    email: asString(profile?.email).toLowerCase(),
  };
}

function employeeMatchesProfile(employee, profile) {
  const keys = profileMatchKey(profile);
  if (keys.id && employee.aureusUserId && keys.id === employee.aureusUserId) return true;
  if (keys.login && employee.aureusLogin && keys.login === employee.aureusLogin.toLowerCase()) return true;
  if (keys.email && employee.email && keys.email === employee.email.toLowerCase()) return true;
  return false;
}

/**
 * POS directory plus myCanadaGold profile fields (permission, avatar, app access).
 */
export function mergeEmployeesWithProfiles(employees, profiles) {
  const remaining = [...(Array.isArray(profiles) ? profiles : [])];
  const rows = (Array.isArray(employees) ? employees : []).map((employee) => {
    const index = remaining.findIndex((profile) => employeeMatchesProfile(employee, profile));
    const profile = index >= 0 ? remaining.splice(index, 1)[0] : null;
    return {
      ...employee,
      profileId: profile?.id || '',
      avatarUrl: profile?.avatarUrl || employee.photoUrl || '',
      appRole: profile?.appRole || '',
      isSystemAdmin: Boolean(profile?.isSystemAdmin),
      hasSignedIn: Boolean(profile),
      profileActive: profile ? profile.isActive !== false : true,
      posRole: employee.role || profile?.posRole || '',
      employeeType: employee.employeeType || profile?.employeeType || profile?.posRole || '',
      locationName: employee.locationName || profile?.locationName || '',
    };
  });

  for (const profile of remaining) {
    rows.push({
      id: `profile-${profile.id}`,
      aureusUserId: profile.aureusUserId || '',
      aureusLogin: profile.aureusLogin || '',
      firstName: profile.firstName || '',
      lastName: profile.lastName || '',
      fullName: profile.fullName || '',
      email: profile.email || '',
      phone: '',
      role: profile.posRole || '',
      employeeType: profile.employeeType || profile.posRole || '',
      locationId: '',
      locationName: profile.locationName || '',
      isActive: profile.isActive !== false,
      photoUrl: profile.avatarUrl || '',
      profileId: profile.id,
      avatarUrl: profile.avatarUrl || '',
      appRole: profile.appRole || '',
      isSystemAdmin: Boolean(profile.isSystemAdmin),
      hasSignedIn: true,
      profileActive: profile.isActive !== false,
      posRole: profile.posRole || '',
    });
  }

  rows.sort((a, b) =>
    (a.fullName || a.email || a.aureusLogin).localeCompare(b.fullName || b.email || b.aureusLogin, undefined, {
      sensitivity: 'base',
    }),
  );
  return rows;
}
