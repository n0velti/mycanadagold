/**
 * Client session lifecycle.
 *
 * Aureus credentials go to the `aureus-login` Edge Function. It verifies them
 * against Aureus POS, provisions the Supabase account with the service role,
 * and returns a Supabase session plus the Aureus token the app uses for POS
 * calls. The client never holds POS passwords.
 *
 * Company Workspace addresses can also Join. That emails a temporary
 * password, which signs in here directly. The app stays on the password
 * screen until aureus-login replaces it and stamps the staff claim.
 */
import { AppState, Platform } from 'react-native';
import { createSecureAuthStorage } from './secureAuthStorage';
import { fetchOwnProfile, mapProfileRow } from './profiles';
import { proxyAuthHeaders, proxyUrl } from './proxy';
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

const JOIN_EMAIL_DOMAINS = ['canadagold.ca', 'cdncoin.com'];
let joinEmailDomains = [...JOIN_EMAIL_DOMAINS];

function joinEmailHint() {
  const domains = joinEmailDomains;
  if (domains.length <= 1) return `Use your @${domains[0] || 'canadagold.ca'} email.`;
  if (domains.length === 2) return `Use your @${domains[0]} or @${domains[1]} email.`;
  const last = domains[domains.length - 1];
  return `Use your ${domains.slice(0, -1).map((domain) => `@${domain}`).join(', ')}, or @${last} email.`;
}

/** Bare company address Join will accept. Empty when it is not one of those domains. */
export function companyJoinEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  if (!email || email.length > 320 || email.includes('+') || /[\s<>"]/.test(email)) return '';
  const match = /^[^\s@]+@([a-z0-9.-]+)$/.exec(email);
  if (!match || !joinEmailDomains.includes(match[1])) return '';
  return email;
}

const LOGIN_EMAIL = /^[^\s@]+@[a-z0-9.-]+\.[a-z]{2,}$/;
const loginEmailCache = new Map();
const loginEmailInflight = new Map();

/** Complete-looking address the login screen can look up. Empty until then. */
export function loginEmailReady(value) {
  const email = String(value || '').trim().toLowerCase();
  if (!email || email.length > 320 || /[\s<>"]/.test(email)) return '';
  if (!LOGIN_EMAIL.test(email)) return '';
  return email;
}

function loginLookupKey(value) {
  return companyJoinEmail(value) || loginEmailReady(value);
}

export function peekLoginEmailKnown(value) {
  const email = loginLookupKey(value);
  if (!email || !loginEmailCache.has(email)) return undefined;
  return loginEmailCache.get(email);
}

export function rememberLoginEmail(value, exists) {
  const email = loginLookupKey(value) || String(value || '').trim().toLowerCase();
  if (email) loginEmailCache.set(email, Boolean(exists));
}

/** Warm the PostgREST function so the first keystroke is not a cold hit. */
export function warmupLoginEmailLookup() {
  try {
    getSupabase().rpc('login_email_known', { p_email: '_' }).catch(() => {});
  } catch {
    // First typed address will retry.
  }
}

/** Fast yes/no: this address already has a staff account. */
export async function lookupLoginEmail(value, { signal } = {}) {
  const email = loginLookupKey(value);
  if (!email) return false;
  if (loginEmailCache.has(email)) return loginEmailCache.get(email);
  const pending = loginEmailInflight.get(email);
  if (pending) return pending;

  const request = (async () => {
    const supabase = getSupabase();
    const { data, error } = await supabase.rpc('login_email_known', { p_email: email }, { signal });
    if (error) throw new AuthError('Could not check that email.', 502, 'lookup_failed');
    const exists = data === true;
    loginEmailCache.set(email, exists);
    return exists;
  })();

  loginEmailInflight.set(email, request);
  try {
    return await request;
  } finally {
    loginEmailInflight.delete(email);
  }
}

/** Same domain list the sign-in service uses (Workspace hosted domains plus company mail). */
export async function loadJoinConfig() {
  try {
    const data = await invokeEdgeFunction('aureus-login', { action: 'join-config' });
    const incoming = (Array.isArray(data?.domains) ? data.domains : [])
      .map((value) => String(value || '').trim().toLowerCase())
      .filter((value) => /^[a-z0-9.-]+$/.test(value));
    const next = [...new Set([...JOIN_EMAIL_DOMAINS, ...incoming])];
    if (next.length) joinEmailDomains = next;
  } catch {
    // Keep the built-in company domains until the sign-in service answers.
  }
  return joinEmailDomains;
}

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
    const emailAccount = session?.authKind === 'email';
    if (session?.version !== SESSION_VERSION || !session?.supabaseUserId) return null;
    if (!emailAccount && !session?.token) return null;
    if (emailAccount && !session?.login) return null;
    return session;
  } catch {
    return null;
  }
}

async function saveSession(session) {
  const emailAccount = session.authKind === 'email';
  const persisted = {
    version: SESSION_VERSION,
    authKind: emailAccount ? 'email' : 'aureus',
    token: session.token || '',
    user: session.user ?? null,
    login: session.login,
    baseUrl: emailAccount ? '' : session.baseUrl || API_BASE_URL,
    systemKey: emailAccount ? '' : session.systemKey || primaryPosSystem(session).key,
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
  resetLinkedPosMemory();
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

// ---------------------------------------------------------------------------
// POS transport
// ---------------------------------------------------------------------------

/**
 * Aureus answers browser preflights without Access-Control-Allow-Origin, so a
 * direct fetch from the web app dies before it leaves the browser. When that
 * happens the same request is relayed through the `proxy` Edge Function
 * (`/proxy/pos/<system>/…`) with the POS token in X-Upstream-Authorization.
 * The host is remembered as blocked so later calls skip the failing attempt,
 * then probed directly again later in case Aureus restores CORS.
 */
const POS_DIRECT_RETRY_MS = 10 * 60_000;
const POS_BLOCKED_STORAGE_KEY = 'cgold.posDirectBlocked.v1';
const posDirectBlockedUntil = new Map();
let posBlockedLoaded = false;

function sessionStore() {
  try {
    return globalThis.sessionStorage || null;
  } catch {
    return null;
  }
}

function loadPosBlockedHosts() {
  if (posBlockedLoaded) return;
  posBlockedLoaded = true;
  try {
    const raw = sessionStore()?.getItem(POS_BLOCKED_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== 'object') return;
    const now = Date.now();
    for (const [host, until] of Object.entries(parsed)) {
      if (Number(until) > now) posDirectBlockedUntil.set(host, Number(until));
    }
  } catch {
    // Memo only; a cold start just costs one failed direct attempt per host.
  }
}

function savePosBlockedHosts() {
  try {
    sessionStore()?.setItem(POS_BLOCKED_STORAGE_KEY, JSON.stringify(Object.fromEntries(posDirectBlockedUntil)));
  } catch {
    // Memo only.
  }
}

function posDirectBlocked(host) {
  loadPosBlockedHosts();
  return (posDirectBlockedUntil.get(host) || 0) > Date.now();
}

function markPosDirectBlocked(host) {
  posDirectBlockedUntil.set(host, Date.now() + POS_DIRECT_RETRY_MS);
  savePosBlockedHosts();
}

/** `{ host, path }` for the proxy relay, or null when the URL is not an Aureus API call. */
function posProxyRoute(url) {
  try {
    const parsed = new URL(url, API_BASE_URL);
    const system = posSystemFromBaseUrl(parsed.origin);
    if (!system) return null;
    const apiRoot = new URL(system.baseUrl).pathname.replace(/\/+$/, '');
    if (parsed.pathname !== apiRoot && !parsed.pathname.startsWith(`${apiRoot}/`)) return null;
    const rest = parsed.pathname.slice(apiRoot.length) || '/';
    return { host: parsed.hostname, path: `pos/${system.key}${rest}${parsed.search}` };
  } catch {
    return null;
  }
}

/** fetch() rejects with a TypeError for CORS and network failures; timeouts are AbortErrors. */
function isNetworkFailure(error) {
  return error instanceof TypeError || error?.name === 'TypeError';
}

async function posFetchViaProxy(route, init) {
  const auth = await proxyAuthHeaders();
  if (!auth) throw new TypeError('Sign in again to reach the POS.');
  const headers = new Headers(init?.headers || {});
  const posAuthorization = headers.get('Authorization');
  headers.delete('Authorization');
  if (posAuthorization) headers.set('X-Upstream-Authorization', posAuthorization);
  headers.set('Authorization', auth.Authorization);
  headers.set('apikey', auth.apikey);
  return fetch(proxyUrl(route.path), { ...(init || {}), headers });
}

async function posTransportFetch(input, init) {
  const route = posProxyRoute(requestUrl(input));
  if (!route) return fetch(input, init);
  if (posDirectBlocked(route.host)) return posFetchViaProxy(route, init);
  try {
    return await fetch(input, init);
  } catch (error) {
    if (!isNetworkFailure(error) || init?.signal?.aborted) throw error;
    let relayed;
    try {
      relayed = await posFetchViaProxy(route, init);
    } catch {
      throw error;
    }
    markPosDirectBlocked(route.host);
    return relayed;
  }
}

function bearerTokenFromInit(init) {
  const headers = init?.headers;
  if (!headers) return null;
  const value =
    typeof headers.get === 'function'
      ? headers.get('Authorization')
      : headers.Authorization ?? headers.authorization;
  if (value == null) return null;
  const match = String(value).match(/^Bearer\s*(.*)$/i);
  return match ? match[1].trim() : String(value).trim();
}

/**
 * A POS call carrying an empty bearer token cannot succeed. Answering it here
 * saves a preflight plus a proxy round trip per call; Home used to spend
 * several of those a second on hosts the session had no token for.
 */
function unauthenticatedPosResponse() {
  return new Response(JSON.stringify({ message: 'Not signed in to this POS.' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * fetch() for Aureus POS. A 401 from the primary host means the staff token
 * expired and the app should return to the login screen.
 */
export async function posFetch(input, init) {
  if (bearerTokenFromInit(init) === '') return unauthenticatedPosResponse();
  const generation = aureusSessionGeneration;
  const response = await posTransportFetch(input, init);
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
  const merged = { ...(session?.linked || {}) };
  const primaryKey = session?.token ? primaryPosSystem(session).key : '';
  for (const [key, entry] of Object.entries(staffPosFromSession(session))) {
    if (!entry?.token || key === primaryKey || merged[key]?.token) continue;
    merged[key] = entry;
  }
  if (Object.keys(merged).length === 0) return [];
  const keys = new Set([...POS_SYSTEMS.map((system) => system.key), ...Object.keys(merged)]);
  return [...keys]
    .map((key) => {
      const meta = posSystemFromKey(key) || { key, label: key, baseUrl: '' };
      const linked = merged[key];
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
 * What this tab has learned about the linked hosts since sign-in (tokens and
 * "nothing configured" answers). React state can lag behind saveSession, so
 * callers holding an older session object still see it. Cleared with the
 * Aureus session.
 */
let linkedPosMemory = {};
let linkedRefreshInFlight = null;
let linkedRefreshCooldownUntil = 0;
/** After a refresh that still left a host closed, wait this long before asking again. */
const LINKED_REFRESH_COOLDOWN_MS = 2 * 60_000;

function resetLinkedPosMemory() {
  linkedPosMemory = {};
  linkedRefreshInFlight = null;
  linkedRefreshCooldownUntil = 0;
}

function sessionWithRememberedLinked(session) {
  const linked = { ...(session?.linked || {}) };
  let changed = false;
  for (const [key, entry] of Object.entries(linkedPosMemory)) {
    if (!entry) continue;
    const current = linked[key];
    if (current?.token) continue;
    if (!entry.token && current?.error) continue;
    linked[key] = entry.token ? { ...current, ...entry, error: '' } : { ...current, ...entry };
    changed = true;
  }
  return changed ? { ...session, linked } : session;
}

function rememberLinkedPos(linked) {
  const next = { ...linkedPosMemory };
  for (const [key, entry] of Object.entries(linked || {})) {
    if (entry?.token || entry?.error) next[key] = entry;
  }
  linkedPosMemory = next;
}

/**
 * A fresh answer replaces an entry when it brings a token, when the entry
 * had none, or when the entry's token is known dead (`staleKeys`). A good
 * token never gives way to an error.
 */
function mergeLinkedPos(existing, fresh, staleKeys = []) {
  const stale = new Set(staleKeys);
  const next = { ...(existing || {}) };
  for (const [key, entry] of Object.entries(fresh || {})) {
    if (!entry) continue;
    if (entry.token || !next[key]?.token || stale.has(key)) next[key] = entry;
  }
  return next;
}

function linkedHostsMissing(session, { force = false } = {}) {
  const existing = session?.linked || {};
  const primaryKey = primaryPosSystem(session).key;
  return POS_SYSTEMS.filter((system) => {
    if (system.key === primaryKey) return false;
    const entry = existing[system.key];
    if (entry?.token) return false;
    return force || !entry?.error;
  }).map((system) => system.key);
}

/** One refresh-linked call shared by every caller that asks while it runs. */
function refreshLinkedPosSessionsOnce() {
  if (!linkedRefreshInFlight) {
    linkedRefreshInFlight = refreshLinkedPosSessions().finally(() => {
      linkedRefreshInFlight = null;
    });
  }
  return linkedRefreshInFlight;
}

/**
 * Re-fetch GTA/PMX tokens when any linked system is missing one.
 * Lookups that skip those hosts never find Ontario store tickets.
 * Pass `{ force: true }` to refresh even when a prior linked error is cached
 * (Bonuses needs East + GTA + PMX employee directories).
 *
 * Home polls every few seconds and several loaders call this per pass, so
 * concurrent callers share one request and a host that stays closed is not
 * asked about again for a while.
 */
export async function ensureLinkedPosSessions(session, { force = false } = {}) {
  if (!session?.token) return session;
  const seeded = sessionWithRememberedLinked(session);
  if (!linkedHostsMissing(seeded, { force }).length) return seeded;
  if (!force && Date.now() < linkedRefreshCooldownUntil) return seeded;
  const generation = aureusSessionGeneration;
  try {
    const fresh = await refreshLinkedPosSessionsOnce();
    if (generation !== aureusSessionGeneration) return seeded;
    const linked = mergeLinkedPos(seeded.linked, fresh);
    rememberLinkedPos(linked);
    const next = { ...seeded, linked };
    if (linkedHostsMissing(next, { force: true }).length) {
      linkedRefreshCooldownUntil = Date.now() + LINKED_REFRESH_COOLDOWN_MS;
    }
    await saveSession(next);
    return next;
  } catch {
    if (generation === aureusSessionGeneration) {
      linkedRefreshCooldownUntil = Date.now() + LINKED_REFRESH_COOLDOWN_MS;
    }
    return seeded;
  }
}

/**
 * Returns linked sessions whose tokens still work, asking the server for new
 * ones when any have expired or a host has none. Never throws; a failed
 * system carries `error`. A token that only failed on the network is kept.
 */
async function restoreLinkedPosSystems(session) {
  const existing = session.linked || {};
  const primaryKey = primaryPosSystem(session).key;
  const others = POS_SYSTEMS.filter((system) => system.key !== primaryKey);
  const checks = await Promise.all(
    others.map(async (system) => {
      const previous = existing[system.key];
      if (!previous?.token) return { system, ok: false, dead: false };
      try {
        await fetchUserData(previous.token, previous.baseUrl || system.baseUrl);
        return { system, ok: true, dead: false };
      } catch (error) {
        const dead = isAuthRejection(error);
        return { system, ok: !dead, dead };
      }
    }),
  );

  if (checks.every((check) => check.ok)) {
    return existing;
  }

  const stale = checks.filter((check) => check.dead).map((check) => check.system.key);
  try {
    const fresh = await refreshLinkedPosSessionsOnce();
    const linked = mergeLinkedPos(existing, fresh, stale);
    rememberLinkedPos(linked);
    return linked;
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

function buildEmailSession({ email, supabaseUserId, profile }) {
  return {
    version: SESSION_VERSION,
    authKind: 'email',
    token: '',
    user: null,
    login: email,
    baseUrl: '',
    systemKey: '',
    linked: {},
    bonusAccess: { granted: false },
    bonusAuth: {},
    staffPos: {},
    supabaseUserId,
    profile: profile
      ? {
          ...profile,
          canViewBonusData: false,
        }
      : profile,
  };
}

function mustSetPassword(user) {
  const flag = user?.app_metadata?.must_set_password;
  return flag === true || flag === 'true';
}

async function loginWithEmailPassword(loginId, password) {
  const email = companyJoinEmail(loginId);
  if (!email || !password) {
    throw new AuthError('That email or password is not right.', 401, 'invalid_credentials');
  }
  const supabase = getSupabase();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data?.session?.user) {
    throw new AuthError('That email or password is not right.', 401, 'invalid_credentials');
  }
  const user = data.session.user;
  if (user.app_metadata?.staff_kind !== 'email') {
    await supabase.auth.signOut().catch(() => {});
    throw new AuthError('That email or password is not right.', 401, 'invalid_credentials');
  }
  if (mustSetPassword(user)) {
    return { mustSetPassword: true, email };
  }
  const profileRow = await fetchOwnProfile(supabase, user.id).catch(() => null);
  if (!profileRow || profileRow.is_active === false) {
    await supabase.auth.signOut().catch(() => {});
    throw new AuthError(
      'Your MyCanadaGold access has been disabled. Contact a system admin.',
      403,
      'deactivated',
    );
  }
  const session = buildEmailSession({
    email,
    supabaseUserId: user.id,
    profile: mapProfileRow(profileRow),
  });
  bumpAureusSession();
  await saveSession(session);
  return session;
}

/** Emails a temporary password. The account cannot open the app until it is replaced. */
export async function requestJoin(email) {
  const normalized = companyJoinEmail(email);
  if (!normalized) {
    throw new AuthError(joinEmailHint(), 400, 'bad_email');
  }
  await invokeEdgeFunction('aureus-login', { action: 'join', email: normalized });
  return normalized;
}

/** Replaces the temporary password and returns an app session. */
export async function completeEmailPassword(password) {
  const data = await invokeEdgeFunction('aureus-login', { action: 'set-password', password });
  if (!data?.supabase?.access_token || !data?.profile?.id) {
    throw new AuthError('Could not save that password.', 502, 'bad_response');
  }
  const supabase = getSupabase();
  const { data: setData, error: setError } = await supabase.auth.setSession({
    access_token: data.supabase.access_token,
    refresh_token: data.supabase.refresh_token,
  });
  if (setError || !setData?.session?.user?.id) {
    throw new AuthError(setError?.message || 'Your password was saved. Sign in with it.', 500, 'session_failed');
  }
  const session = buildEmailSession({
    email: data.profile.email || setData.session.user.email || '',
    supabaseUserId: setData.session.user.id,
    profile: data.profile,
  });
  bumpAureusSession();
  await saveSession(session);
  return session;
}

export async function login(loginId, password, { systemKey } = {}) {
  const login = String(loginId || '').trim();
  if (!login || !password) {
    throw new AuthError('Enter your Aureus login and password.', 400, 'missing_credentials');
  }
  if (companyJoinEmail(login)) {
    try {
      return await loginWithEmailPassword(login, password);
    } catch (error) {
      // A company address can still be an Aureus user id. A wrong email
      // password falls through; a disabled account does not.
      if (error?.code !== 'invalid_credentials') throw error;
    }
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

  if (stored.authKind === 'email') {
    const profileRow = await fetchOwnProfile(supabase, supabaseUser.id).catch(() => null);
    if (!profileRow || profileRow.is_active === false) {
      await logout();
      return null;
    }
    const session = buildEmailSession({
      email: stored.login || profileRow.email || '',
      supabaseUserId: supabaseUser.id,
      profile: mapProfileRow(profileRow),
    });
    await saveSession(session);
    return session;
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
