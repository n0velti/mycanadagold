import {
  findStaffByEmployeeName,
  hasFullAppAccess,
  normalizeAppRole,
  staffDisplayName,
  USER_CATEGORY_KEYS,
} from './permissions';

export const AI_SCOPE_KEYS = ['compensation', 'hours', 'employeePerformance'];

export const AI_SCOPE_LEVELS = ['self', 'store', 'company'];

export const AI_SCOPE_CAPABILITIES = [
  {
    key: 'compensation',
    label: 'Compensation',
    description: 'Bonus and payout figures for named people, including Analytics and Messages @ai.',
  },
  {
    key: 'hours',
    label: 'Hours',
    description: 'Punched hours, shifts, and staff on duty for named people.',
  },
  {
    key: 'employeePerformance',
    label: 'Employee performance',
    description: 'Tickets, calls, and review counts grouped or filtered by employee (not pay).',
  },
];

const COMPANY_SCOPES = {
  compensation: 'company',
  hours: 'company',
  employeePerformance: 'company',
};

const STORE_SCOPES = {
  compensation: 'store',
  hours: 'store',
  employeePerformance: 'store',
};

const PMA_SCOPES = {
  compensation: 'self',
  hours: 'store',
  employeePerformance: 'store',
};

export const DEFAULT_AI_SCOPES_BY_ROLE = {
  precious_metal_analyst: { ...PMA_SCOPES },
  triage: { ...PMA_SCOPES },
  hr: { ...COMPANY_SCOPES },
  branch_manager: { ...STORE_SCOPES },
  general_manager: { ...COMPANY_SCOPES },
  system_admin: { ...COMPANY_SCOPES },
};

function asString(value) {
  if (value == null) return '';
  return String(value).trim();
}

export function normalizeAiScopeLevel(value) {
  const key = asString(value).toLowerCase();
  return AI_SCOPE_LEVELS.includes(key) ? key : '';
}

export function sanitizeAiScopes(value, fallback = null) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const base = fallback && typeof fallback === 'object' ? fallback : COMPANY_SCOPES;
  const next = {};
  for (const key of AI_SCOPE_KEYS) {
    next[key] = normalizeAiScopeLevel(source[key]) || normalizeAiScopeLevel(base[key]) || 'self';
  }
  return next;
}

export function defaultAiScopesForRole(role) {
  const key = normalizeAppRole(role) || 'precious_metal_analyst';
  return sanitizeAiScopes(DEFAULT_AI_SCOPES_BY_ROLE[key] || PMA_SCOPES);
}

export function defaultAiScopesByRole() {
  const result = {};
  for (const role of USER_CATEGORY_KEYS) {
    result[role] = defaultAiScopesForRole(role);
  }
  return result;
}

export function cycleAiScopeLevel(value) {
  const current = normalizeAiScopeLevel(value) || 'self';
  const index = AI_SCOPE_LEVELS.indexOf(current);
  return AI_SCOPE_LEVELS[(index + 1) % AI_SCOPE_LEVELS.length];
}

export function aiScopesEqual(a, b) {
  const left = sanitizeAiScopes(a);
  const right = sanitizeAiScopes(b);
  return AI_SCOPE_KEYS.every((key) => left[key] === right[key]);
}

export function resolveAiScopes(profile, roleScopesByRole, userOverride) {
  if (hasFullAppAccess(profile)) return { ...COMPANY_SCOPES };
  const role = normalizeAppRole(profile?.appRole) || 'precious_metal_analyst';
  const inherited = sanitizeAiScopes(
    roleScopesByRole?.[role] || profile?.roleAiScopes,
    defaultAiScopesForRole(role),
  );
  const override = userOverride || profile?.aiScopeOverride;
  if (!override || typeof override !== 'object') return inherited;
  return sanitizeAiScopes(override, inherited);
}

export function scopesFromSession(session) {
  if (session?.aiScopes && typeof session.aiScopes === 'object') {
    return sanitizeAiScopes(session.aiScopes, resolveAiScopes(session.profile));
  }
  return resolveAiScopes(session?.profile);
}

export function compensationScope(sessionOrProfile) {
  if (sessionOrProfile?.profile || sessionOrProfile?.aiScopes) {
    return scopesFromSession(sessionOrProfile).compensation;
  }
  return resolveAiScopes(sessionOrProfile).compensation;
}

export function scopeForFact(fact) {
  if (fact === 'bonuses') return 'compensation';
  if (fact === 'hours') return 'hours';
  return 'employeePerformance';
}

export function scopeRefusalReason(scope, kind) {
  const label =
    kind === 'compensation' ? 'pay, bonus, and payout figures' : kind === 'hours' ? 'hours and shifts' : 'per-person performance';
  if (scope === 'self') {
    return `This user can only see their own ${label}. Other people are omitted; do not estimate.`;
  }
  if (scope === 'store') {
    return `This user can only see ${label} for people at their own store. Do not estimate anyone else.`;
  }
  return `This user cannot see ${label} for that person.`;
}

export function locationsMatch(storeName, locationName) {
  const store = asString(storeName).toLowerCase();
  const location = asString(locationName).toLowerCase();
  if (!store || !location) return false;
  if (store === location) return true;
  return location.includes(store) || store.includes(location);
}

export function viewerMatchesEmployee(viewer, employeeName) {
  const name = asString(employeeName);
  if (!viewer || !name || name === '—' || /^unassigned$/i.test(name)) return false;
  if (findStaffByEmployeeName([viewer], name)) return true;
  const display = staffDisplayName(viewer);
  if (!display) return false;
  const left = name.toLowerCase();
  const right = display.toLowerCase();
  if (left === right) return true;
  return right.includes(left) || left.includes(right);
}

export function employeeAllowedByScope({ scope, viewer, subjectName, subjectStore }) {
  if (!viewer) return true;
  const level = normalizeAiScopeLevel(scope) || 'self';
  if (level === 'company') return true;
  const name = asString(subjectName);
  if (viewerMatchesEmployee(viewer, name)) return true;
  if (level === 'self') return false;
  const viewerStore = asString(viewer?.locationName);
  if (!viewerStore) return false;
  if (subjectStore && locationsMatch(subjectStore, viewerStore)) return true;
  const subject = findStaffByEmployeeName(viewer ? [viewer] : [], name);
  if (subject?.locationName && locationsMatch(subject.locationName, viewerStore)) return true;
  return false;
}

export function filterEmployeeRowsByScope(rows, { scope, viewer }) {
  if (!Array.isArray(rows) || !rows.length) return rows || [];
  if (!viewer) return rows;
  const level = normalizeAiScopeLevel(scope) || 'self';
  if (level === 'company') return rows;
  return rows.filter((row) =>
    employeeAllowedByScope({
      scope: level,
      viewer,
      subjectName: row?.employee || row?.name || row?.employeeName,
      subjectStore: row?.store || row?.storeName,
    }),
  );
}

export function aiPrivacyBlurb(scopes) {
  const next = sanitizeAiScopes(scopes);
  const phrase = (level, label) => {
    if (level === 'company') return `${label} for anyone in the company`;
    if (level === 'store') return `${label} only for people at this user's store`;
    return `${label} only for this user`;
  };
  return (
    `Pay and bonus figures: ${phrase(next.compensation, 'available')}. ` +
    `Hours and shifts: ${phrase(next.hours, 'available')}. ` +
    `Per-person tickets, calls, and review counts: ${phrase(next.employeePerformance, 'available')}. ` +
    'When a tool result is refused, selfOnly, or empty for a named person, say that in one kind sentence and never estimate.'
  );
}
