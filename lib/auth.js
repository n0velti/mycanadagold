/**
 * Client session lifecycle.
 *
 * Credentials are sent to the `aureus-login` Edge Function only. It verifies
 * them against Aureus POS, provisions the Supabase account with the service
 * role, and returns a Supabase session plus the Aureus token the app uses for
 * POS calls. The client never creates accounts and never holds POS passwords.
 */
import { createSecureAuthStorage } from './secureAuthStorage';
import { fetchOwnProfile, mapProfileRow } from './profiles';
import { getSupabase, invokeEdgeFunction } from './supabase';

export const API_BASE_URL = 'https://canadagoldeast.aureuspos.com/api';

const SESSION_KEY = 'cgold.session.v2';
const LEGACY_SESSION_KEYS = ['aureus_session'];
const SESSION_VERSION = 2;

const jsonHeaders = {
  Accept: 'application/json, text/plain, */*',
  'Content-Type': 'application/json;charset=utf-8',
};

/**
 * Linked POS systems the app can read from. Only public metadata lives here;
 * the shared credentials are Edge Function secrets and tokens arrive at login.
 */
export const LINKED_POS_SYSTEMS = [
  { key: 'gta', label: 'Canada Gold GTA', baseUrl: 'https://gta.aureuspos.com/api' },
  { key: 'pmx', label: 'Canadian PMX', baseUrl: 'https://canadianpmx.com/api' },
];

const storage = createSecureAuthStorage();

class AuthError extends Error {
  constructor(message, status, code) {
    super(message);
    this.name = 'AuthError';
    this.status = status;
    this.code = code;
  }
}

function getErrorMessage(payload, fallback) {
  return payload?.error?.message || payload?.message || fallback;
}

async function parseJsonResponse(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function isEmailLogin(loginId) {
  return String(loginId || '').includes('@');
}

// ---------------------------------------------------------------------------
// Local session persistence
// ---------------------------------------------------------------------------

async function loadStoredSession() {
  try {
    const raw = await storage.getItem(SESSION_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw);
    if (session?.version !== SESSION_VERSION || !session?.token || !session?.supabaseUserId) {
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

async function saveSession(session) {
  const persisted = {
    version: SESSION_VERSION,
    token: session.token,
    user: session.user ?? null,
    login: session.login,
    baseUrl: session.baseUrl || API_BASE_URL,
    linked: session.linked || {},
    supabaseUserId: session.supabaseUserId,
  };
  await storage.setItem(SESSION_KEY, JSON.stringify(persisted));
}

async function clearStoredSession() {
  await Promise.all(
    [SESSION_KEY, ...LEGACY_SESSION_KEYS].map((key) => storage.removeItem(key).catch(() => {})),
  );
}

// ---------------------------------------------------------------------------
// Aureus POS
// ---------------------------------------------------------------------------

export function authHeaders(token) {
  return {
    ...jsonHeaders,
    Authorization: `Bearer ${token}`,
  };
}

async function fetchUserData(token, baseUrl = API_BASE_URL) {
  const response = await fetch(`${baseUrl}/account/user_data`, {
    method: 'GET',
    headers: authHeaders(token),
  });
  const payload = await parseJsonResponse(response);
  if (!response.ok) {
    throw new AuthError(
      getErrorMessage(payload, 'Session expired. Please log in again.'),
      response.status,
      response.status === 401 || response.status === 403 ? 'unauthenticated' : 'pos_error',
    );
  }
  return payload?.user ?? payload;
}

function isAuthRejection(error) {
  return error?.status === 401 || error?.status === 403;
}

// ---------------------------------------------------------------------------
// Linked POS systems
// ---------------------------------------------------------------------------

export function getLinkedPosSessions(session) {
  if (!session?.linked) return [];
  return LINKED_POS_SYSTEMS.map((system) => {
    const linked = session.linked[system.key];
    if (!linked) return null;
    return {
      ...system,
      ...linked,
      label: linked.label || system.label,
      baseUrl: linked.baseUrl || system.baseUrl,
    };
  }).filter(Boolean);
}

async function refreshLinkedPosSessions() {
  const data = await invokeEdgeFunction('aureus-login', { action: 'refresh-linked' });
  return data?.linked || {};
}

/**
 * Returns linked sessions whose tokens still work, asking the server for new
 * ones when any have expired. Never throws; a failed system carries `error`.
 */
async function restoreLinkedPosSystems(session) {
  const existing = session.linked || {};
  const checks = await Promise.all(
    LINKED_POS_SYSTEMS.map(async (system) => {
      const previous = existing[system.key];
      if (!previous?.token) return { system, ok: false };
      try {
        await fetchUserData(previous.token, previous.baseUrl || system.baseUrl);
        return { system, ok: true };
      } catch {
        return { system, ok: false };
      }
    }),
  );

  if (checks.every((check) => check.ok) && LINKED_POS_SYSTEMS.length > 0) {
    return existing;
  }

  try {
    const fresh = await refreshLinkedPosSessions();
    return { ...existing, ...fresh };
  } catch (error) {
    const next = { ...existing };
    for (const { system, ok } of checks) {
      if (ok) continue;
      next[system.key] = {
        key: system.key,
        label: system.label,
        baseUrl: system.baseUrl,
        error: error?.message || 'Linked POS login failed.',
      };
    }
    return next;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function buildSession({ aureus, linked, supabaseUserId, profile }) {
  return {
    version: SESSION_VERSION,
    token: aureus.token,
    user: aureus.user ?? null,
    login: aureus.login,
    baseUrl: aureus.baseUrl || API_BASE_URL,
    linked: linked || {},
    supabaseUserId,
    profile,
  };
}

export async function login(loginId, password) {
  const login = String(loginId || '').trim();
  if (!login || !password) {
    throw new AuthError('Enter your Aureus login and password.', 400, 'missing_credentials');
  }

  const data = await invokeEdgeFunction('aureus-login', { action: 'login', login, password });
  if (!data?.supabase?.access_token || !data?.aureus?.token || !data?.profile?.id) {
    throw new AuthError('Sign-in service returned an incomplete response.', 502, 'bad_response');
  }

  const supabase = getSupabase();
  const { data: setData, error: setError } = await supabase.auth.setSession({
    access_token: data.supabase.access_token,
    refresh_token: data.supabase.refresh_token,
  });
  if (setError || !setData?.session?.user?.id) {
    throw new AuthError(setError?.message || 'Could not start your session.', 500, 'session_failed');
  }

  const session = buildSession({
    aureus: data.aureus,
    linked: data.linked,
    supabaseUserId: setData.session.user.id,
    profile: { ...data.profile, firstLogin: Boolean(data.firstLogin) },
  });
  await saveSession(session);
  return session;
}

export async function syncStaffRoles(session) {
  const token = session?.token;
  if (!token) return null;
  return invokeEdgeFunction('aureus-login', { action: 'sync-staff', aureusToken: token });
}

/**
 * Rebuilds the signed-in state on launch. Returns null (and wipes local
 * state) when either the Supabase session or the Aureus token is no longer
 * valid, or when the staff profile has been deactivated.
 */
export async function restoreSession() {
  const stored = await loadStoredSession();
  if (!stored) {
    await clearStoredSession();
    return null;
  }

  const supabase = getSupabase();
  const { data: sessionData } = await supabase.auth.getSession();
  const supabaseUser = sessionData?.session?.user;
  if (!supabaseUser?.id || supabaseUser.id !== stored.supabaseUserId) {
    await logout();
    return null;
  }

  const [aureusCheck, profileRow, linked] = await Promise.all([
    fetchUserData(stored.token, stored.baseUrl || API_BASE_URL)
      .then((user) => ({ ok: true, user }))
      .catch((error) => ({ ok: false, error })),
    fetchOwnProfile(supabase, supabaseUser.id).catch(() => null),
    isEmailLogin(stored.login) ? restoreLinkedPosSystems(stored) : Promise.resolve({}),
  ]);

  if (!aureusCheck.ok && isAuthRejection(aureusCheck.error)) {
    await logout();
    return null;
  }

  // RLS hides the row entirely for deactivated or unverified accounts.
  if (!profileRow || profileRow.is_active === false) {
    await logout();
    return null;
  }

  let nextProfile = profileRow;
  if (aureusCheck.ok) {
    try {
      const synced = await invokeEdgeFunction('aureus-login', {
        action: 'sync-staff',
        aureusToken: stored.token,
      });
      if (synced?.profile?.id) {
        nextProfile = {
          ...profileRow,
          role: synced.profile.role ?? profileRow.role,
          employee_type: synced.profile.employeeType ?? profileRow.employee_type,
          location_id: synced.profile.locationId ?? profileRow.location_id,
          location_name: synced.profile.locationName ?? profileRow.location_name,
          app_role: synced.profile.appRole ?? profileRow.app_role,
          is_system_admin: synced.profile.isSystemAdmin ?? profileRow.is_system_admin,
        };
      } else {
        nextProfile = (await fetchOwnProfile(supabase, supabaseUser.id).catch(() => null)) || profileRow;
      }
    } catch {
      // Sign-in still works if the staff sync function is unavailable.
    }
  }

  const session = buildSession({
    aureus: {
      token: stored.token,
      user: aureusCheck.ok ? aureusCheck.user ?? stored.user : stored.user,
      login: stored.login,
      baseUrl: stored.baseUrl || API_BASE_URL,
    },
    linked,
    supabaseUserId: supabaseUser.id,
    profile: mapProfileRow(nextProfile),
  });
  await saveSession(session);
  return session;
}

export async function logout() {
  try {
    await getSupabase().auth.signOut();
  } catch {
    // Local state is cleared regardless.
  }
  await clearStoredSession();
}

/**
 * Notifies when the Supabase session disappears out from under the app
 * (revoked refresh token, sign-out from another tab). The local Aureus
 * session is wiped before the callback runs. Returns an unsubscribe.
 * Does not call signOut itself, which would re-emit SIGNED_OUT.
 */
export function onSessionRevoked(callback) {
  const { data } = getSupabase().auth.onAuthStateChange((event) => {
    if (event !== 'SIGNED_OUT') return;
    clearStoredSession()
      .catch(() => {})
      .finally(() => callback());
  });
  return () => data?.subscription?.unsubscribe();
}
