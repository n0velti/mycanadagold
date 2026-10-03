/**
 * Client session lifecycle.
 *
 * Credentials are sent to the `aureus-login` Edge Function only. It verifies
 * them against Aureus POS, provisions the Supabase account with the service
 * role, and returns a Supabase session plus the Aureus token the app uses for
 * POS calls. The client never creates accounts and never holds POS passwords.
 */
import { AppState, Platform } from 'react-native';
import { createSecureAuthStorage } from './secureAuthStorage';
import { fetchOwnProfile, mapProfileRow } from './profiles';
import { getSupabase, invokeEdgeFunction } from './supabase';

export const API_BASE_URL = 'https://canadagoldeast.aureuspos.com/api';

export const POS_SYSTEMS = [
  { key: 'east', label: 'Canada Gold East', baseUrl: API_BASE_URL },
  { key: 'gta', label: 'Canada Gold GTA', baseUrl: 'https://gta.aureuspos.com/api' },
  { key: 'pmx', label: 'Canadian PMX', baseUrl: 'https://canadianpmx.com/api' },
];

const SESSION_KEY = 'cgold.session.v2';
const LAST_SYSTEM_KEY = 'cgold.lastPosSystem';
const LEGACY_SESSION_KEYS = ['aureus_session'];
const SESSION_VERSION = 2;

const SHORT_POS_LABELS = {
  east: 'East',
  gta: 'GTA',
  pmx: 'PMX',
};

const jsonHeaders = {
  Accept: 'application/json, text/plain, */*',
  'Content-Type': 'application/json;charset=utf-8',
};

/**
 * Linked POS systems the app can read from. Only public metadata lives here;
 * the shared credentials are Edge Function secrets and tokens arrive at login.
 */
export const LINKED_POS_SYSTEMS = POS_SYSTEMS.filter((system) => system.key !== 'east');

export function posSystemFromKey(key) {
  return POS_SYSTEMS.find((system) => system.key === key) || null;
}

export function posSystemFromBaseUrl(baseUrl) {
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    return (
      POS_SYSTEMS.find((system) => {
        try {
          return new URL(system.baseUrl).hostname.toLowerCase() === host;
        } catch {
          return false;
        }
      }) || null
    );
  } catch {
    return null;
  }
}

export function primaryPosSystem(session) {
  if (session?.systemKey) {
    const match = posSystemFromKey(session.systemKey);
    if (match) return match;
  }
  return posSystemFromBaseUrl(session?.baseUrl) || POS_SYSTEMS[0];
}

/** POS employee id for API calls. Strips a gta:/pmx:/east: prefix when present. */
export function posEmployeeId(storedId) {
  const id = String(storedId || '').trim();
  const match = /^(east|gta|pmx):(.+)$/i.exec(id);
  return match ? match[2] : id;
}

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
    systemKey: session.systemKey || primaryPosSystem(session).key,
    linked: session.linked || {},
    bonusAccess: session.bonusAccess || null,
    bonusAuth: session.bonusAuth || {},
    staffPos: session.staffPos || {},
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

let primaryAureusHostname = 'canadagoldeast.aureuspos.com';

function setPrimaryAureusHost(baseUrl) {
  try {
    primaryAureusHostname = new URL(baseUrl || API_BASE_URL).hostname;
  } catch {
    primaryAureusHostname = 'canadagoldeast.aureuspos.com';
  }
}

function primaryAureusHost() {
  return primaryAureusHostname;
}

function requestUrl(input) {
  if (typeof input === 'string') return input;
  if (input && typeof input.url === 'string') return input.url;
  return '';
}

function isPrimaryAureusRequest(input) {
  try {
    return new URL(requestUrl(input), API_BASE_URL).hostname === primaryAureusHost();
  } catch {
    return false;
  }
}

const aureusExpiredListeners = new Set();
let aureusExpiredNotified = false;
let aureusSessionGeneration = 0;

function bumpAureusSession() {
  aureusSessionGeneration += 1;
  aureusExpiredNotified = false;
}

function notifyAureusSessionExpired() {
  if (aureusExpiredNotified) return;
  aureusExpiredNotified = true;
  for (const listener of aureusExpiredListeners) {
    try {
      listener();
    } catch {
      // Listener failures must not block sign-out.
    }
  }
}

/**
 * Fires once when the primary Aureus POS token is rejected (401).
 * Returns an unsubscribe. Successful login clears the latch.
 */
export function onAureusSessionExpired(callback) {
  aureusExpiredListeners.add(callback);
  return () => aureusExpiredListeners.delete(callback);
}

/**
 * fetch() for Aureus POS. A 401 from the primary host means the staff token
 * expired and the app should return to the login screen.
 */
export async function posFetch(input, init) {
  const generation = aureusSessionGeneration;
  const response = await fetch(input, init);
  if (
    response.status === 401 &&
    isPrimaryAureusRequest(input) &&
    generation === aureusSessionGeneration
  ) {
    notifyAureusSessionExpired();
  }
  return response;
}

async function fetchUserData(token, baseUrl = API_BASE_URL) {
  const response = await posFetch(`${baseUrl}/account/user_data`, {
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

/** Confirms the stored POS token still works. 401s notify session-expired listeners. */
export async function verifyAureusToken(token, baseUrl = API_BASE_URL) {
  if (!token) {
    notifyAureusSessionExpired();
    return false;
  }
  try {
    await fetchUserData(token, baseUrl);
    return true;
  } catch (error) {
    if (isAuthRejection(error)) {
      notifyAureusSessionExpired();
      return false;
    }
    return true;
  }
}

/**
 * Re-checks the Aureus token when the site/app comes back to the foreground
 * so an idle tab still lands on the login screen after expiry.
 */
export function watchAureusToken(session) {
  const token = session?.token;
  const baseUrl = session?.baseUrl || API_BASE_URL;
  if (!token) return () => {};

  const check = () => {
    if (
      Platform.OS === 'web' &&
      typeof document !== 'undefined' &&
      document.visibilityState === 'hidden'
    ) {
      return;
    }
    verifyAureusToken(token, baseUrl).catch(() => {});
  };

  const onAppState = (state) => {
    if (state === 'active') check();
  };
  const appSub = AppState.addEventListener('change', onAppState);

  let onVisibility;
  if (Platform.OS === 'web' && typeof document !== 'undefined') {
    onVisibility = () => {
      if (document.visibilityState === 'visible') check();
    };
    document.addEventListener('visibilitychange', onVisibility);
  }

  const intervalId = setInterval(check, 60_000);

  return () => {
    clearInterval(intervalId);
    appSub.remove();
    if (onVisibility) document.removeEventListener('visibilitychange', onVisibility);
  };
}

// ---------------------------------------------------------------------------
// Linked POS systems
// ---------------------------------------------------------------------------

export function getLinkedPosSessions(session) {
  if (!session?.linked) return [];
  const keys = new Set([...POS_SYSTEMS.map((system) => system.key), ...Object.keys(session.linked)]);
  return [...keys]
    .map((key) => {
      const meta = posSystemFromKey(key) || { key, label: key, baseUrl: '' };
      const linked = session.linked[key];
      if (!linked) return null;
      return {
        ...meta,
        ...linked,
        label: linked.label || meta.label,
        baseUrl: linked.baseUrl || meta.baseUrl,
      };
    })
    .filter(Boolean);
}

/**
 * Every POS host this session can read: the instance the staff signed into,
 * plus linked East / GTA / PMX tokens so all stores stay visible.
 */
export function posSystemsFromSession(session) {
  const primary = primaryPosSystem(session);
  const linkedByKey = new Map(getLinkedPosSessions(session).map((item) => [item.key, item]));

  return POS_SYSTEMS.map((system) => {
    if (session?.token && system.key === primary.key) {
      const linked = linkedByKey.get(system.key);
      return {
        key: system.key,
        label: linked?.label || system.label,
        baseUrl: session.baseUrl || linked?.baseUrl || system.baseUrl,
        token: session.token,
        error: '',
      };
    }
    const linked = linkedByKey.get(system.key);
    return {
      key: system.key,
      label: linked?.label || system.label,
      baseUrl: linked?.baseUrl || system.baseUrl,
      token: linked?.token || '',
      error: linked?.error || '',
    };
  });
}

function staffPosEntry(system, extra = {}) {
  if (!system) return null;
  const token = String(extra.token || '').trim();
  if (!token) return null;
  return {
    key: system.key,
    label: extra.label || system.label,
    baseUrl: extra.baseUrl || system.baseUrl,
    token,
  };
}

/** Tokens this person unlocked with their own password — not linked shared logins. */
export function staffPosFromSession(session, extras = {}) {
  const next = {};
  const add = (key, extra) => {
    const entry = staffPosEntry(posSystemFromKey(key), extra);
    if (entry) next[entry.key] = entry;
  };
  for (const [key, entry] of Object.entries(session?.staffPos || {})) add(key, entry);
  for (const [key, entry] of Object.entries(session?.bonusAuth || {})) add(key, entry);
  for (const [key, entry] of Object.entries(extras || {})) add(key, entry);
  if (session?.token) {
    const primary = primaryPosSystem(session);
    add(primary.key, {
      token: session.token,
      baseUrl: session.baseUrl || primary.baseUrl,
      label: primary.label,
    });
  }
  return next;
}

export function posSystemShortLabel(key) {
  return SHORT_POS_LABELS[key] || posSystemFromKey(key)?.label || key;
}

/**
 * Aureus databases this staff login can open. Primary plus any other host
 * their password already unlocked. Linked shared credentials stay out.
 */
export function accessiblePosSystems(session) {
  const primary = primaryPosSystem(session);
  const known = staffPosFromSession(session);
  const list = POS_SYSTEMS.filter((system) => known[system.key] || system.key === primary.key);
  return list.map((system) => {
    const entry = known[system.key];
    const current = system.key === primary.key;
    return {
      key: system.key,
      label: entry?.label || system.label,
      shortLabel: posSystemShortLabel(system.key),
      baseUrl: entry?.baseUrl || system.baseUrl,
      token: entry?.token || (current ? session?.token || '' : ''),
      current,
      available: Boolean(entry?.token) || current,
    };
  });
}

function withSwitchedPrimary(session, systemKey) {
  const system = posSystemFromKey(systemKey);
  if (!system || !session) return null;
  const staffPos = staffPosFromSession(session);
  const current = primaryPosSystem(session);
  if (current.key === system.key && session.token) {
    return { ...session, staffPos, systemKey: system.key };
  }
  const entry = staffPos[system.key];
  if (!entry?.token) return null;
  if (session.token && current.key) {
    const keep = staffPosEntry(current, {
      token: session.token,
      baseUrl: session.baseUrl,
      label: current.label,
    });
    if (keep) staffPos[current.key] = keep;
  }
  return {
    ...session,
    token: entry.token,
    baseUrl: entry.baseUrl || system.baseUrl,
    systemKey: system.key,
    staffPos,
  };
}

/** Prefer a host after login when the live function still ignores systemKey. */
export function applyPreferredPosSystem(session, systemKey) {
  const preferred = posSystemFromKey(systemKey);
  if (!preferred || !session) return { session, error: '' };
  if (primaryPosSystem(session).key === preferred.key) {
    return { session: { ...session, staffPos: staffPosFromSession(session) }, error: '' };
  }
  const next = withSwitchedPrimary(session, preferred.key);
  if (next) return { session: next, error: '' };
  return {
    session: { ...session, staffPos: staffPosFromSession(session) },
    error: `Signed in to ${primaryPosSystem(session).label}. This login does not have access to ${preferred.label}.`,
  };
}

export async function switchPrimaryPosSystem(session, systemKey) {
  const next = withSwitchedPrimary(session, systemKey);
  if (!next) {
    const system = posSystemFromKey(systemKey);
    throw new AuthError(
      system
        ? `This login does not have access to ${system.label}.`
        : 'Unknown Aureus database.',
      403,
      'pos_unavailable',
    );
  }
  bumpAureusSession();
  setPrimaryAureusHost(next.baseUrl);
  await saveSession(next);
  await rememberLastPosSystemKey(next.systemKey);
  return next;
}

export async function loadLastPosSystemKey() {
  try {
    const raw = await storage.getItem(LAST_SYSTEM_KEY);
    return posSystemFromKey(raw)?.key || '';
  } catch {
    return '';
  }
}

export async function rememberLastPosSystemKey(key) {
  const system = posSystemFromKey(key);
  if (!system) return;
  try {
    await storage.setItem(LAST_SYSTEM_KEY, system.key);
  } catch {
    // Preference only.
  }
}

export function resolvePosAuth(session, systemKey) {
  const key = systemKey || primaryPosSystem(session).key;
  const match = posSystemsFromSession(session).find((system) => system.key === key);
  if (match?.token) {
    return {
      token: match.token,
      baseUrl: match.baseUrl,
      systemKey: match.key,
      systemLabel: match.label,
      locationId: null,
    };
  }
  return {
    token: session?.token || '',
    baseUrl: session?.baseUrl || API_BASE_URL,
    systemKey: key,
    systemLabel: '',
    locationId: null,
  };
}

async function refreshLinkedPosSessions() {
  const data = await invokeEdgeFunction('aureus-login', { action: 'refresh-linked' });
  return data?.linked || {};
}

/**
 * Re-fetch GTA/PMX tokens when any linked system is missing one.
 * Lookups that skip those hosts never find Ontario store tickets.
 * Pass `{ force: true }` to refresh even when a prior linked error is cached
 * (Bonuses needs East + GTA + PMX employee directories).
 */
export async function ensureLinkedPosSessions(session, { force = false } = {}) {
  if (!session) return session;
  const existing = session.linked || {};
  const primaryKey = primaryPosSystem(session).key;
  const missing = POS_SYSTEMS.some((system) => {
    if (system.key === primaryKey) return false;
    const entry = existing[system.key];
    if (force) return !entry?.token;
    return !entry?.token && !entry?.error;
  });
  if (!missing) return session;
  try {
    const fresh = await refreshLinkedPosSessions();
    const next = { ...session, linked: { ...existing, ...fresh } };
    await saveSession(next);
    return next;
  } catch {
    return session;
  }
}

/**
 * Returns linked sessions whose tokens still work, asking the server for new
 * ones when any have expired. Never throws; a failed system carries `error`.
 */
async function restoreLinkedPosSystems(session) {
  const existing = session.linked || {};
  const primaryKey = primaryPosSystem(session).key;
  const others = POS_SYSTEMS.filter((system) => system.key !== primaryKey);
  const checks = await Promise.all(
    others.map(async (system) => {
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

  if (checks.length > 0 && checks.every((check) => check.ok)) {
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

function buildSession({ aureus, linked, bonusAccess, bonusAuth, staffPos, supabaseUserId, profile }) {
  const baseUrl = aureus.baseUrl || API_BASE_URL;
  const system = posSystemFromKey(aureus.systemKey) || posSystemFromBaseUrl(baseUrl) || POS_SYSTEMS[0];
  const nextProfile = profile
    ? {
        ...profile,
        canViewBonusData:
          profile.canViewBonusData === true || bonusAccess?.granted === true
            ? true
            : profile.canViewBonusData === false || bonusAccess?.granted === false
              ? false
              : profile.canViewBonusData ?? null,
        bonusEmployeeVisibility: profile.bonusEmployeeVisibility || bonusAccess?.bySystem || {},
      }
    : profile;
  const session = {
    version: SESSION_VERSION,
    token: aureus.token,
    user: aureus.user ?? null,
    login: aureus.login,
    baseUrl,
    systemKey: system.key,
    linked: linked || {},
    bonusAccess: bonusAccess || null,
    bonusAuth: bonusAuth || {},
    staffPos: staffPos || {},
    supabaseUserId,
    profile: nextProfile,
  };
  session.staffPos = staffPosFromSession(session, staffPos);
  return session;
}

export const BONUS_ACCESS_DENIED =
  'This Aureus account cannot see employees and their names, so bonus and review data stay hidden.';

/**
 * Bonuses/reviews grant from the server probe. `true` / `false` once
 * aureus-login has evaluated it; `null` means the live function has not
 * spoken yet (legacy session) so existing behaviour stays.
 */
export function canViewBonusReviewData(session) {
  const granted = session?.bonusAccess?.granted;
  const fromProfile = session?.profile?.canViewBonusData;
  if (granted === false || fromProfile === false) return false;
  if (granted === true || fromProfile === true) return true;
  return null;
}

/** POS hosts the signed-in person can read employees on, separate from linked. */
export function bonusPosSystemsFromSession(session) {
  const auth = session?.bonusAuth || {};
  return POS_SYSTEMS.map((system) => {
    const entry = auth[system.key];
    if (!entry?.token) {
      return {
        key: system.key,
        label: system.label,
        baseUrl: system.baseUrl,
        token: '',
        error: entry?.error || '',
      };
    }
    return {
      key: system.key,
      label: entry.label || system.label,
      baseUrl: entry.baseUrl || system.baseUrl,
      token: entry.token,
      error: '',
    };
  });
}

export async function login(loginId, password, { systemKey } = {}) {
  const login = String(loginId || '').trim();
  if (!login || !password) {
    throw new AuthError('Enter your Aureus login and password.', 400, 'missing_credentials');
  }
  const preferKey = posSystemFromKey(systemKey)?.key || '';

  const data = await invokeEdgeFunction('aureus-login', {
    action: 'login',
    login,
    password,
    ...(preferKey ? { systemKey: preferKey } : {}),
  });
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

  let session = buildSession({
    aureus: data.aureus,
    linked: data.linked,
    bonusAccess: data.bonusAccess || null,
    bonusAuth: data.bonusAuth || {},
    staffPos: data.staffPos || {},
    supabaseUserId: setData.session.user.id,
    profile: {
      ...data.profile,
      firstLogin: Boolean(data.firstLogin),
      allowedAppRoles: Array.isArray(data.profile.allowedAppRoles) ? data.profile.allowedAppRoles : [],
      canViewBonusData:
        data.profile.canViewBonusData === true || data.bonusAccess?.granted === true
          ? true
          : data.profile.canViewBonusData === false || data.bonusAccess?.granted === false
            ? false
            : null,
      bonusEmployeeVisibility: data.profile.bonusEmployeeVisibility || data.bonusAccess?.bySystem || {},
    },
  });
  const applied = applyPreferredPosSystem(session, preferKey);
  session = applied.session;
  if (applied.error) session.preferredSystemError = applied.error;
  bumpAureusSession();
  setPrimaryAureusHost(session.baseUrl);
  await saveSession(session);
  await rememberLastPosSystemKey(session.systemKey);
  return session;
}

export async function syncStaffRoles(session) {
  const token = session?.token;
  if (!token) return null;
  return invokeEdgeFunction('aureus-login', {
    action: 'sync-staff',
    aureusToken: token,
    baseUrl: session.baseUrl || API_BASE_URL,
  });
}

/** Persist the signed-in staff member's Aureus store onto the myCanadaGold profile. */
export async function persistOwnLocation(session, { locationId, locationName } = {}) {
  const token = session?.token;
  if (!token) throw new AuthError('Sign in first.', 401, 'unauthenticated');
  const id = String(locationId || '').trim();
  if (!id) throw new AuthError('Choose a location.', 400, 'bad_request');
  return invokeEdgeFunction('aureus-login', {
    action: 'set-location',
    aureusToken: token,
    locationId: id,
    locationName: String(locationName || '').trim(),
    baseUrl: session.baseUrl || API_BASE_URL,
  });
}

/**
 * Rebuilds the signed-in state on launch. Returns null (and wipes local
 * state) when either the Supabase session or the Aureus token is no longer
 * valid, or when the staff profile has been deactivated.
 *
 * `onProfileSynced(profile)` fires later, if the background sync with Aureus
 * changed the profile (role, employee type, store).
 */
export async function restoreSession({ onProfileSynced } = {}) {
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
    restoreLinkedPosSystems(stored),
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

  const session = buildSession({
    aureus: {
      token: stored.token,
      user: aureusCheck.ok ? aureusCheck.user ?? stored.user : stored.user,
      login: stored.login,
      baseUrl: stored.baseUrl || API_BASE_URL,
      systemKey: stored.systemKey,
    },
    linked,
    bonusAccess: stored.bonusAccess || null,
    bonusAuth: stored.bonusAuth || {},
    staffPos: stored.staffPos || {},
    supabaseUserId: supabaseUser.id,
    profile: mapProfileRow(profileRow),
  });
  setPrimaryAureusHost(session.baseUrl);
  await saveSession(session);

  if (aureusCheck.ok) {
    // Role, employee type and store come from Aureus through the sync-staff
    // function. The profile row already holds the values from the previous
    // sync, so the app renders from those immediately and the (often slow)
    // edge function runs in the background; any change is applied when it
    // lands. Skipped if the person signs out before it finishes.
    const generation = aureusSessionGeneration;
    syncProfileFromAureus(supabase, stored.token, supabaseUser.id, profileRow, stored.baseUrl)
      .then((nextRow) => {
        if (!nextRow || nextRow === profileRow) return;
        if (generation !== aureusSessionGeneration) return;
        onProfileSynced?.(mapProfileRow(nextRow));
      })
      .catch(() => {
        // Sign-in still works if the staff sync function is unavailable.
      });
    const bonusGeneration = aureusSessionGeneration;
    syncBonusAccessFromAureus(stored, session)
      .then((next) => {
        if (!next || bonusGeneration !== aureusSessionGeneration) return;
        onProfileSynced?.({
          ...next.profile,
          bonusAccess: next.bonusAccess,
          bonusAuth: next.bonusAuth,
        });
      })
      .catch(() => {
        // Bonuses stay on the last grant if the probe is unavailable.
      });
  }

  return session;
}

async function syncBonusAccessFromAureus(stored, session) {
  const bonusAuth = {};
  for (const [key, entry] of Object.entries(stored.bonusAuth || {})) {
    if (entry?.token) {
      bonusAuth[key] = { token: entry.token, baseUrl: entry.baseUrl };
    }
  }
  const synced = await invokeEdgeFunction('aureus-login', {
    action: 'sync-bonus-access',
    aureusToken: stored.token,
    baseUrl: stored.baseUrl || API_BASE_URL,
    bonusAuth,
  });
  if (!synced || synced.bonusAccess == null) return null;
  const next = {
    ...session,
    bonusAccess: synced.bonusAccess,
    bonusAuth: synced.bonusAuth || session.bonusAuth || {},
    staffPos: staffPosFromSession(session, synced.staffPos || synced.bonusAuth || {}),
    profile: {
      ...session.profile,
      ...(synced.profile || {}),
      canViewBonusData: synced.bonusAccess.granted,
      bonusEmployeeVisibility: synced.bonusAccess.bySystem || {},
    },
  };
  await saveSession(next);
  return next;
}

/** Cheap check for a session worth restoring, without validating it. */
export async function hasStoredSession() {
  return Boolean(await loadStoredSession());
}

async function syncProfileFromAureus(supabase, aureusToken, supabaseUserId, profileRow, baseUrl) {
  const synced = await invokeEdgeFunction('aureus-login', {
    action: 'sync-staff',
    aureusToken,
    baseUrl: baseUrl || API_BASE_URL,
  });
  if (synced?.profile?.id) {
    return {
      ...profileRow,
      role: synced.profile.role ?? profileRow.role,
      employee_type: synced.profile.employeeType ?? profileRow.employee_type,
      location_id: synced.profile.locationId ?? profileRow.location_id,
      location_name: synced.profile.locationName ?? profileRow.location_name,
      app_role: profileRow.app_role,
      is_system_admin: profileRow.is_system_admin,
    };
  }
  return (await fetchOwnProfile(supabase, supabaseUserId).catch(() => null)) || profileRow;
}

export async function logout() {
  bumpAureusSession();
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
