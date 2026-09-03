/**
 * Rippling Platform API (Tier 1–2), reached through the authenticated proxy.
 * The user's Rippling token is stored in secure storage and forwarded per
 * request; the OAuth app's client secret lives only in Edge Function secrets.
 * Spec: GET https://rest.ripplingapis.com/workers/ with Bearer token.
 */
import { Platform } from 'react-native';
import { proxyFetch, proxyJson, ProxyError } from './proxy';
import { readSecureJson, removeSecure, writeSecureJson } from './secureAuthStorage';

const SESSION_KEY = 'cgold_rippling_session';
const OAUTH_STATE_KEY = 'cgold_rippling_oauth_state';
const RIPPLING_ORIGIN = 'https://rest.ripplingapis.com';
export const RIPPLING_AUTHORIZE_URL = 'https://app.rippling.com/o/authorize';
export const RIPPLING_API_TOKENS_URL = 'https://app.rippling.com/api-tokens';
export const RIPPLING_OAUTH_SCOPES = [
  'workers.read',
  'users.read',
  'departments.read',
  'work-locations.read',
  'companies.read',
  'compensations.read',
].join(' ');
const WORKER_EXPAND = [
  'user',
  'manager',
  'manager.user',
  'legal_entity',
  'employment_type',
  'compensation',
  'department',
  'teams',
  'level',
].join(',');
const WORKER_EXPAND_SAFE = [
  'user',
  'manager',
  'manager.user',
  'legal_entity',
  'employment_type',
  'department',
  'teams',
  'level',
].join(',');
const MAX_PAGES = 50;

export const WORKER_STATUS = {
  INIT: 'INIT',
  HIRED: 'HIRED',
  ACCEPTED: 'ACCEPTED',
  ACTIVE: 'ACTIVE',
  TERMINATED: 'TERMINATED',
};

export const RIPPLING_APP_URL = 'https://app.rippling.com';

function getErrorMessage(payload, fallback) {
  const nested = payload?.error;
  const fromPayload =
    (nested && typeof nested === 'object' ? nested.message : null) ||
    payload?.message ||
    payload?.detail ||
    (typeof nested === 'string' ? nested : null);
  return fromPayload || fallback;
}

function ripplingRequestError(payload, status) {
  const raw = String(getErrorMessage(payload, '') || '');
  if (
    status === 401 ||
    /incorrect authentication|invalid api key|unauthorized|missing or invalid/i.test(raw)
  ) {
    return new Error(
      'Rippling rejected this token. Company Settings → API keys do not work here. In Rippling, open Tools → Developer → API Tokens, create a token with workers.read, users.read, departments.read, and work-locations.read, then paste only the token — not the word Bearer.',
    );
  }
  if (status === 403 || /do not have permission|insufficient oauth scopes/i.test(raw)) {
    return new Error(
      'This Rippling token authenticated but cannot read employees. Edit the token and enable workers.read, or create a new token as an admin who can view the whole company.',
    );
  }
  const error = new Error(raw || `Rippling request failed (${status}).`);
  error.status = status;
  error.payload = payload;
  return error;
}

export function cleanRipplingToken(token) {
  return String(token || '')
    .replace(/^Bearer\s+/i, '')
    .trim();
}

export async function loadRipplingSession() {
  const session = await readSecureJson(SESSION_KEY, null);
  return session?.token ? session : null;
}

export function getRipplingRedirectUri() {
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location?.origin) {
    const path = window.location.pathname || '/';
    return `${window.location.origin}${path}`;
  }
  return '';
}

/**
 * OAuth app registration lives in Edge Function secrets. Only the public
 * client ID is returned to the browser (needed to build the authorize URL).
 */
export async function loadRipplingOAuthApp() {
  const payload = await proxyJson('rippling/oauth/config');
  return {
    clientId: String(payload?.clientId || '').trim(),
    configured: Boolean(payload?.configured),
  };
}

export function buildRipplingAuthorizeUrl({ clientId, redirectUri, state }) {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: RIPPLING_OAUTH_SCOPES,
    state,
  });
  return `${RIPPLING_AUTHORIZE_URL}?${params.toString()}`;
}

export function createRipplingOAuthState() {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function persistRipplingOAuthState(state) {
  if (Platform.OS === 'web' && typeof sessionStorage !== 'undefined') {
    sessionStorage.setItem(OAUTH_STATE_KEY, state);
  }
}

export function readRipplingOAuthState() {
  if (Platform.OS === 'web' && typeof sessionStorage !== 'undefined') {
    return sessionStorage.getItem(OAUTH_STATE_KEY) || '';
  }
  return '';
}

export function clearRipplingOAuthState() {
  if (Platform.OS === 'web' && typeof sessionStorage !== 'undefined') {
    sessionStorage.removeItem(OAUTH_STATE_KEY);
  }
}

export function readRipplingOAuthCallback() {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search || '');
  const code = params.get('code');
  const state = params.get('state');
  const error = params.get('error');
  const errorDescription = params.get('error_description');
  if (!code && !error) return null;
  return { code, state, error, errorDescription };
}

export function clearRipplingOAuthCallbackFromUrl() {
  if (Platform.OS !== 'web' || typeof window === 'undefined' || !window.history?.replaceState) {
    return;
  }
  const url = new URL(window.location.href);
  url.searchParams.delete('code');
  url.searchParams.delete('state');
  url.searchParams.delete('error');
  url.searchParams.delete('error_description');
  window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
}

async function oauthTokenRequest(body) {
  let payload;
  try {
    payload = await proxyJson('rippling/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (error) {
    if (error instanceof ProxyError) throw error;
    throw new Error(error?.message || 'Rippling sign-in failed.');
  }
  const token = String(payload?.access_token || '').trim();
  if (!token) {
    throw new Error(getErrorMessage(payload, 'Rippling did not return an access token.'));
  }
  return {
    token,
    savedAt: Date.now(),
    source: 'oauth',
    refreshToken: String(payload?.refresh_token || '').trim() || undefined,
    expiresIn: Number(payload?.expires_in) || undefined,
  };
}

export async function exchangeRipplingOAuthCode({ code, redirectUri }) {
  const session = await oauthTokenRequest({ grant_type: 'authorization_code', code, redirectUri });
  await probeRipplingToken(session.token);
  await writeSecureJson(SESSION_KEY, session);
  return session;
}

export async function refreshRipplingOAuthSession(session) {
  if (!session?.refreshToken) throw new Error('Rippling session expired. Sign in again.');
  const next = await oauthTokenRequest({
    grant_type: 'refresh_token',
    refresh_token: session.refreshToken,
  });
  await writeSecureJson(SESSION_KEY, next);
  return next;
}

export async function saveRipplingSession({ token }) {
  const cleaned = cleanRipplingToken(token);
  if (!cleaned) throw new Error('Paste a Rippling API token to connect.');
  await probeRipplingToken(cleaned);
  const session = {
    token: cleaned,
    savedAt: Date.now(),
    source: 'api-token',
  };
  await writeSecureJson(SESSION_KEY, session);
  return session;
}

export async function clearRipplingSession() {
  await removeSecure(SESSION_KEY);
}

function pathFromNextLink(nextLink) {
  const value = String(nextLink || '').trim();
  if (!value) return null;
  try {
    const url = new URL(value, RIPPLING_ORIGIN);
    return `${url.pathname}${url.search}`;
  } catch {
    return value.startsWith('/') ? value : null;
  }
}

async function ripplingFetch(pathWithQuery, { token } = {}) {
  if (!token) throw new Error('Connect Rippling first.');
  const clean = pathWithQuery.startsWith('/') ? pathWithQuery : `/${pathWithQuery}`;

  let response;
  try {
    response = await proxyFetch(`rippling${clean}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      upstreamAuthorization: `Bearer ${token}`,
    });
  } catch (error) {
    if (error instanceof ProxyError) throw error;
    throw new Error('Could not reach Rippling. Check your connection and try again.');
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error = ripplingRequestError(payload, response.status);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

async function listAll(path, { token, query } = {}) {
  const results = [];
  let nextPath = withQuery(path, query);
  let pages = 0;

  while (nextPath && pages < MAX_PAGES) {
    pages += 1;
    const payload = await ripplingFetch(nextPath, { token });
    const batch = Array.isArray(payload?.results) ? payload.results : [];
    results.push(...batch);
    nextPath = pathFromNextLink(payload?.next_link);
  }

  return results;
}

function withQuery(path, query = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value == null || value === '') continue;
    params.set(key, String(value));
  }
  const search = params.toString();
  return search ? `${path}?${search}` : path;
}

async function probeRipplingToken(token) {
  await ripplingFetch('/workers/', { token });
}

function firstString(...values) {
  for (const value of values) {
    const text = String(value || '').trim();
    if (text) return text;
  }
  return '';
}

function userNameParts(user) {
  const name = user?.name || {};
  const given = firstString(name.preferred_given_name, name.given_name);
  const family = firstString(name.preferred_family_name, name.family_name);
  return { given, family };
}

export function workerDisplayName(worker) {
  const user = worker?.user || {};
  const { given, family } = userNameParts(user);
  return firstString(
    user.display_name,
    [given, family].filter(Boolean).join(' '),
    user.name?.formatted,
    worker?.work_email,
    worker?.id,
  );
}

function workerPhotoUrl(worker) {
  const photos = Array.isArray(worker?.user?.photos) ? worker.user.photos : [];
  const photo =
    photos.find((item) => item?.type === 'PHOTO' && item?.value) ||
    photos.find((item) => item?.type === 'THUMBNAIL' && item?.value) ||
    photos.find((item) => item?.value);
  return String(photo?.value || '').trim();
}

function workerPhone(worker) {
  const numbers = Array.isArray(worker?.user?.phone_numbers) ? worker.user.phone_numbers : [];
  const preferred =
    numbers.find((item) => item?.type === 'WORK' && (item.display || item.value)) ||
    numbers.find((item) => item?.type === 'MOBILE' && (item.display || item.value)) ||
    numbers.find((item) => item?.display || item?.value);
  return firstString(preferred?.display, preferred?.value);
}

export function statusLabel(status) {
  switch (String(status || '').toUpperCase()) {
    case WORKER_STATUS.ACTIVE:
      return 'Active';
    case WORKER_STATUS.TERMINATED:
      return 'Terminated';
    case WORKER_STATUS.HIRED:
      return 'Hired';
    case WORKER_STATUS.ACCEPTED:
      return 'Accepted';
    case WORKER_STATUS.INIT:
      return 'Onboarding';
    default:
      return status ? String(status) : 'Unknown';
  }
}

export function formatCurrency(amount) {
  if (!amount || amount.value == null || Number.isNaN(Number(amount.value))) return '';
  const value = Number(amount.value);
  const currency = String(amount.currency_type || 'CAD').toUpperCase();
  try {
    return new Intl.NumberFormat('en-CA', {
      style: 'currency',
      currency,
      maximumFractionDigits: value % 1 === 0 ? 0 : 2,
    }).format(value);
  } catch {
    return `${value.toLocaleString('en-CA')} ${currency}`;
  }
}

export function formatDate(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text.slice(0, 10);
  return date.toLocaleDateString('en-CA', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function employmentLabel(employmentType) {
  if (!employmentType) return '';
  const parts = [
    employmentType.label || employmentType.name,
    employmentType.amount_worked ? String(employmentType.amount_worked).replace('-', ' ') : '',
    employmentType.type === 'CONTRACTOR' ? 'Contractor' : '',
  ].filter(Boolean);
  return [...new Set(parts)].join(' · ');
}

function locationName(worker, locationsById) {
  const location = worker?.location;
  if (!location) return '';
  if (String(location.type || '').toUpperCase() === 'REMOTE') return 'Remote';
  const id = location.work_location_id;
  if (id && locationsById[id]?.name) return locationsById[id].name;
  return id ? 'Work location' : '';
}

export function initialsFor(name) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export function normalizeWorker(worker, { locationsById = {} } = {}) {
  const name = workerDisplayName(worker);
  const manager = worker?.manager;
  const compensation = worker?.compensation;
  return {
    id: worker?.id,
    name,
    initials: initialsFor(name),
    photoUrl: workerPhotoUrl(worker),
    title: firstString(worker?.title),
    status: String(worker?.status || '').toUpperCase(),
    statusLabel: statusLabel(worker?.status),
    workEmail: firstString(worker?.work_email),
    personalEmail: firstString(worker?.personal_email),
    phone: workerPhone(worker),
    department: firstString(worker?.department?.name),
    departmentId: worker?.department_id || worker?.department?.id || '',
    teams: Array.isArray(worker?.teams)
      ? worker.teams.map((team) => team?.name).filter(Boolean)
      : [],
    managerName: manager ? workerDisplayName(manager) : '',
    managerId: worker?.manager_id || manager?.id || '',
    isManager: Boolean(worker?.is_manager),
    employmentType: employmentLabel(worker?.employment_type),
    startDate: worker?.start_date || '',
    startDateLabel: formatDate(worker?.start_date),
    endDate: worker?.end_date || '',
    endDateLabel: formatDate(worker?.end_date),
    location: locationName(worker, locationsById),
    country: firstString(worker?.country),
    legalEntity: firstString(worker?.legal_entity?.legal_name),
    employeeNumber: worker?.number != null ? String(worker.number) : '',
    level: firstString(worker?.level?.name, worker?.level?.label),
    annualCompensation: formatCurrency(compensation?.annual_compensation),
    hourlyWage: formatCurrency(compensation?.hourly_wage),
    raw: worker,
  };
}

export async function fetchEmployees(token, { status } = {}) {
  const baseQuery = {};
  if (status) {
    baseQuery.filter = `status eq '${status}'`;
  }

  const locationsPromise = listAll('/work-locations/', { token }).catch(() => []);

  const listWorkers = async (expand) =>
    listAll('/workers/', { token, query: { ...baseQuery, expand } });

  let workers;
  try {
    workers = await listWorkers(WORKER_EXPAND);
  } catch (error) {
    if (error?.status === 401) throw error;
    workers = await listWorkers(WORKER_EXPAND_SAFE);
  }

  const locations = await locationsPromise;

  const locationsById = Object.fromEntries(
    (locations || []).filter((row) => row?.id).map((row) => [row.id, row]),
  );

  const employees = workers
    .map((worker) => normalizeWorker(worker, { locationsById }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

  return {
    employees,
    locationCount: locations.length,
  };
}

export async function fetchRipplingCompany(token) {
  const companies = await listAll('/companies/', {
    token,
    query: { expand: 'parent_legal_entity' },
  }).catch(() => []);
  const company = companies[0];
  return {
    name: firstString(company?.parent_legal_entity?.legal_name),
    id: company?.id || '',
  };
}
