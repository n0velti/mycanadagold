/**
 * Normalises the Aureus POS user payload into the profile shape we store.
 * Mirrors the previous client-side extractor so existing profiles keep the
 * same aureus_user_id.
 */

export interface AureusIdentity {
  aureusUserId: string;
  aureusLogin: string;
  email: string;
  firstName: string;
  lastName: string;
  fullName: string;
  role: string;
  employeeType: string;
  locationId: string;
  locationName: string;
  payload: Record<string, unknown>;
}

type AnyRecord = Record<string, unknown>;

function asString(value: unknown): string {
  if (value == null) return '';
  return String(value).trim();
}

function pick(object: AnyRecord | null | undefined, keys: string[]): unknown {
  for (const key of keys) {
    const value = object?.[key];
    if (value == null || value === '') continue;
    if (typeof value === 'object') continue;
    return value;
  }
  return '';
}

function firstObject(...candidates: unknown[]): AnyRecord {
  for (const value of candidates) {
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as AnyRecord;
  }
  return {};
}

const SENSITIVE_KEY = /password|token|secret|authorization|api[_-]?key|pin|salt|hash/i;

export function sanitizePayload(user: unknown): AnyRecord {
  if (!user || typeof user !== 'object') return {};
  try {
    return JSON.parse(
      JSON.stringify(user, (key, value) => (SENSITIVE_KEY.test(String(key)) ? undefined : value)),
    );
  } catch {
    return {};
  }
}

function canonicalEmployeeType(value: string): string {
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
  if (
    /^employee$|\bemployees?\b|\bcashier\b|\bclerk\b|precious\s*metal|\banalyst\b|\bpma\b/.test(lower)
  ) {
    return 'Employee';
  }
  return '';
}

function typeRank(value: string): number {
  if (value === 'Admin') return 3;
  if (value === 'Manager') return 2;
  if (value === 'Employee') return 1;
  return 0;
}

function flagType(raw: AnyRecord): string {
  if (raw.is_admin === true || raw.admin === true || raw.is_administrator === true) return 'Admin';
  if (raw.is_manager === true || raw.manager === true) return 'Manager';
  return '';
}

function collectEmployeeType(raw: AnyRecord, nestedRole: AnyRecord): string {
  const employee = firstObject(raw.employee);
  const roleNames: unknown[] = [];
  for (const source of [raw.roles, employee.roles]) {
    if (!Array.isArray(source)) continue;
    for (const entry of source) {
      if (typeof entry === 'string') roleNames.push(entry);
      else if (entry && typeof entry === 'object') {
        roleNames.push((entry as AnyRecord).name, (entry as AnyRecord).title);
      }
    }
  }
  const candidates = [
    flagType(raw),
    flagType(employee),
    nestedRole.name,
    nestedRole.title,
    ...roleNames,
    pick(raw, ['role', 'job_title', 'jobTitle', 'position', 'pos_role', 'access_level']),
    pick(employee, ['role', 'employee_type', 'employeeType']),
    pick(raw, ['employee_type', 'employeeType', 'user_type', 'userType']),
    pick(employee, ['type']),
    pick(raw, ['type']),
  ];
  let best = '';
  for (const candidate of candidates) {
    const known = canonicalEmployeeType(asString(candidate));
    if (typeRank(known) > typeRank(best)) best = known;
  }
  return best;
}

/**
 * Map an Aureus POS role / employee type onto myCanadaGold app access.
 * Manager → Branch Manager apps. Admin / GM → General Manager apps.
 * System Admin is never inferred here; it is assigned in-app.
 */
export function inferAppRole(role: string, employeeType = ''): string {
  const value = `${asString(role)} ${asString(employeeType)}`.toLowerCase();
  if (!value.trim()) return 'precious_metal_analyst';
  if (/general\s*manager|\bgm\b/.test(value)) return 'general_manager';
  if (/system\s*admin|sysadmin|super\s*admin|\badministrators?\b|\badmins?\b/.test(value)) {
    return 'general_manager';
  }
  if (/branch\s*manager|store\s*manager|\bmanagers?\b|\bmgr\b/.test(value)) {
    return 'branch_manager';
  }
  return 'precious_metal_analyst';
}

function collectLocation(raw: AnyRecord): { locationId: string; locationName: string } {
  const employee = firstObject(raw.employee);
  const nested = firstObject(
    raw.default_location,
    raw.defaultLocation,
    raw.default_loc,
    raw.defaultLoc,
    employee.default_location,
    employee.defaultLocation,
    employee.default_loc,
    employee.defaultLoc,
    employee.location,
    employee.store,
    raw.location,
    raw.store,
    raw.assigned_location,
    raw.user_location,
    raw.selling_location,
    raw.current_location,
    raw.currentLocation,
  );

  const locationIdKeys = [
    'default_location_id',
    'defaultLocationId',
    'default_loc_id',
    'defaultLocId',
    'location_id',
    'locationId',
    'loc_id',
    'current_location_id',
    'currentLocationId',
    'store_id',
    'storeId',
    'selling_location_id',
  ];

  let locationId = asString(
    nested.id || nested.location_id || pick(employee, locationIdKeys) || pick(raw, locationIdKeys),
  );

  const locationNameKeys = [
    'default_location_name',
    'defaultLocationName',
    'default_loc_name',
    'location_name',
    'locationName',
    'current_location_name',
    'store_name',
    'storeName',
    'selling_location_name',
  ];

  let locationName = asString(
    nested.name ||
      nested.location_name ||
      nested.title ||
      pick(employee, locationNameKeys) ||
      pick(raw, locationNameKeys),
  );

  if (!locationName) {
    for (const candidate of [
      raw.default_location,
      raw.default_loc,
      employee.default_location,
      employee.default_loc,
      raw.location,
      raw.store,
      raw.current_location,
    ]) {
      if (typeof candidate === 'string' && candidate.trim()) {
        locationName = asString(candidate);
        break;
      }
    }
  }

  if (
    !locationId &&
    (typeof raw.default_location === 'number' ||
      typeof raw.default_loc === 'number' ||
      typeof employee.default_location === 'number' ||
      typeof employee.default_loc === 'number' ||
      typeof raw.location === 'number' ||
      typeof raw.store_id === 'number')
  ) {
    locationId = asString(
      raw.default_location_id ||
        employee.default_location_id ||
        raw.location_id ||
        raw.store_id ||
        raw.default_location ||
        raw.default_loc ||
        employee.default_location ||
        employee.default_loc ||
        raw.location,
    );
  }

  return { locationId, locationName };
}

export function extractAureusIdentity(user: unknown, loginId: string): AureusIdentity {
  const raw = (user && typeof user === 'object' ? user : {}) as AnyRecord;
  const nestedUser = (raw.user && typeof raw.user === 'object' ? raw.user : raw) as AnyRecord;
  const nestedRole = firstObject(
    nestedUser.role && typeof nestedUser.role === 'object' ? nestedUser.role : null,
    raw.role && typeof raw.role === 'object' ? raw.role : null,
    nestedUser.user_role,
    nestedUser.userRole,
    raw.user_role,
  );
  const nestedLocation = collectLocation(nestedUser);
  const rawLocation = collectLocation(raw);
  const location = {
    locationId: nestedLocation.locationId || rawLocation.locationId,
    locationName: nestedLocation.locationName || rawLocation.locationName,
  };

  const firstName = asString(
    pick(nestedUser, ['first_name', 'firstName', 'firstname']) || pick(raw, ['first_name', 'firstName', 'firstname']),
  );
  const lastName = asString(
    pick(nestedUser, ['last_name', 'lastName', 'lastname']) || pick(raw, ['last_name', 'lastName', 'lastname']),
  );
  const fullName =
    [firstName, lastName].filter(Boolean).join(' ') ||
    asString(
      pick(nestedUser, ['full_name', 'fullName', 'name', 'display_name', 'displayName']) ||
        pick(raw, ['full_name', 'fullName', 'name', 'display_name', 'displayName']),
    );

  const email = asString(
    pick(nestedUser, ['email', 'email_address', 'login']) || pick(raw, ['email', 'email_address', 'login']),
  ).toLowerCase();
  const aureusUserId = asString(
    pick(nestedUser, ['id', 'user_id', 'userId', 'employee_id', 'employeeId', 'uuid']) ||
      pick(raw, ['id', 'user_id', 'userId', 'employee_id', 'employeeId', 'uuid']) ||
      loginId,
  );

  return {
    aureusUserId,
    aureusLogin: asString(loginId),
    email: email.includes('@') ? email : '',
    firstName,
    lastName,
    fullName,
    role: asString(
      nestedRole.name ||
        nestedRole.title ||
        pick(nestedUser, ['role', 'job_title', 'jobTitle', 'position', 'pos_role']) ||
        pick(raw, ['role', 'job_title', 'jobTitle', 'position', 'pos_role']),
    ),
    employeeType: collectEmployeeType(nestedUser, nestedRole) || collectEmployeeType(raw, nestedRole),
    locationId: location.locationId,
    locationName: location.locationName,
    payload: sanitizePayload(raw),
  };
}

function recordId(row: AnyRecord): string {
  return asString(pick(row, ['id', 'user_id', 'userId', 'employee_id', 'employeeId', 'uuid']));
}

function recordLogin(row: AnyRecord): string {
  return asString(pick(row, ['login', 'username', 'user_name', 'email', 'email_address'])).toLowerCase();
}

/** Match a signed-in POS user to a row from GET /employees. */
export function findEmployeeRecord(
  employees: unknown[],
  identity: Pick<AureusIdentity, 'aureusUserId' | 'aureusLogin' | 'email'>,
): AnyRecord | null {
  const rows = (Array.isArray(employees) ? employees : [])
    .filter((row) => row && typeof row === 'object' && !Array.isArray(row))
    .map((row) => row as AnyRecord);
  if (rows.length === 0) return null;

  const id = asString(identity.aureusUserId);
  const login = asString(identity.aureusLogin).toLowerCase();
  const email = asString(identity.email).toLowerCase();

  const byId = id
    ? rows.find((row) => {
        const nested = firstObject(row.user, row.employee);
        return recordId(row) === id || recordId(nested) === id;
      })
    : undefined;
  if (byId) return byId;

  const byLogin = login
    ? rows.find((row) => {
        const nested = firstObject(row.user, row.employee);
        return recordLogin(row) === login || recordLogin(nested) === login;
      })
    : undefined;
  if (byLogin) return byLogin;

  if (!email) return null;
  return (
    rows.find((row) => {
      const nested = firstObject(row.user, row.employee);
      return recordLogin(row) === email || recordLogin(nested) === email;
    }) || null
  );
}

/**
 * Prefer GET /employees for role, employee type, and default location. user_data
 * often has the till that is currently open rather than the assigned store.
 */
export function mergeEmployeeIntoIdentity(identity: AureusIdentity, employee: unknown): AureusIdentity {
  if (!employee || typeof employee !== 'object') return identity;
  const fromEmployee = extractAureusIdentity(employee, identity.aureusLogin);
  return {
    ...identity,
    firstName: fromEmployee.firstName || identity.firstName,
    lastName: fromEmployee.lastName || identity.lastName,
    fullName: fromEmployee.fullName || identity.fullName,
    email: fromEmployee.email || identity.email,
    role: fromEmployee.role || identity.role,
    employeeType: fromEmployee.employeeType || identity.employeeType,
    locationId: fromEmployee.locationId || identity.locationId,
    locationName: fromEmployee.locationName || identity.locationName,
    payload: {
      ...identity.payload,
      employee: fromEmployee.payload,
    },
  };
}

/**
 * Supabase Auth needs an email per user. Aureus logins are usually emails; for
 * numeric/user-id logins we derive a stable placeholder on a non-routable
 * domain. No mail is ever sent to it and it is never shown to staff.
 */
export function authEmailForIdentity(identity: AureusIdentity, loginId: string): string {
  if (identity.email) return identity.email;
  const login = asString(loginId).toLowerCase();
  if (login.includes('@')) return login;
  const local = login.replace(/[^a-z0-9._-]/g, '') || 'user';
  return `${local}@pos.mycanadagold.local`;
}
