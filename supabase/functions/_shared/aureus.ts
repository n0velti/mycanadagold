/**
 * Aureus POS client used by the Edge Functions. Talks to the POS over HTTPS
 * with a short timeout and never logs credentials.
 */

export const AUREUS_BASE_URL = 'https://canadagoldeast.aureuspos.com/api';

export const POS_SYSTEMS = [
  { key: 'east', label: 'Canada Gold East', baseUrl: AUREUS_BASE_URL },
  { key: 'gta', label: 'Canada Gold GTA', baseUrl: 'https://gta.aureuspos.com/api' },
  { key: 'pmx', label: 'Canadian PMX', baseUrl: 'https://canadianpmx.com/api' },
] as const;

export type PosSystemKey = (typeof POS_SYSTEMS)[number]['key'];

export function posSystemFromBaseUrl(baseUrl: string): (typeof POS_SYSTEMS)[number] | null {
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    return POS_SYSTEMS.find((system) => {
      try {
        return new URL(system.baseUrl).hostname.toLowerCase() === host;
      } catch {
        return false;
      }
    }) ?? null;
  } catch {
    return null;
  }
}

const JSON_HEADERS = {
  Accept: 'application/json, text/plain, */*',
  'Content-Type': 'application/json;charset=utf-8',
};

const REQUEST_TIMEOUT_MS = 15_000;

export interface AureusSession {
  token: string;
  user: Record<string, unknown> | null;
  login: string;
  baseUrl: string;
  systemKey: PosSystemKey;
  systemLabel: string;
}

export interface LinkedPosSystem {
  key: string;
  label: string;
  baseUrl: string;
  login: string;
  password: string;
}

export interface LinkedPosResult {
  key: string;
  label: string;
  baseUrl: string;
  token?: string;
  user?: Record<string, unknown> | null;
  error?: string;
}

export class AureusError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function assertHttps(url: string): string {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') {
    throw new Error(`POS URL must use HTTPS: ${parsed.host}`);
  }
  return parsed.toString().replace(/\/$/, '');
}

function messageFrom(payload: unknown, fallback: string): string {
  const body = payload as { error?: { message?: string }; message?: string } | null;
  const message = body?.error?.message || body?.message;
  return typeof message === 'string' && message.trim() ? message.trim().slice(0, 200) : fallback;
}

async function fetchJson(url: string, init: RequestInit): Promise<{ ok: boolean; status: number; payload: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    return { ok: response.ok, status: response.status, payload };
  } finally {
    clearTimeout(timer);
  }
}

export async function loginToPos(baseUrl: string, login: string, password: string): Promise<AureusSession> {
  const root = assertHttps(baseUrl);
  const { ok, status, payload } = await fetchJson(`${root}/account/login`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ login: login.trim(), password }),
  });

  const body = payload as
    | { status?: string; token?: string; user?: Record<string, unknown>; data?: { token?: string; user?: Record<string, unknown> } }
    | null;
  const token = body?.token ?? body?.data?.token;
  const user = body?.user ?? body?.data?.user ?? null;
  const success = body?.status === 'ok' || Boolean(token);

  if (!ok || !success || !token) {
    const message = messageFrom(payload, 'Invalid login or password.');
    throw new AureusError(message, status === 0 ? 502 : status >= 500 ? 502 : 401);
  }

  const system = posSystemFromBaseUrl(root);
  return {
    token: String(token),
    user,
    login: login.trim(),
    baseUrl: root,
    systemKey: system?.key ?? 'east',
    systemLabel: system?.label ?? 'Canada Gold East',
  };
}

/**
 * Staff sign-in across East, GTA, and PMX. First host that accepts the
 * password wins so GTA / Richmond Hill logins work the same as East.
 *
 * Linked-POS auto-login (shared secrets) is a separate path — do not change
 * this "first success wins" behaviour.
 */
export async function loginToStaffPos(login: string, password: string): Promise<AureusSession> {
  const results = await Promise.allSettled(
    POS_SYSTEMS.map((system) => loginToPos(system.baseUrl, login, password)),
  );

  for (const result of results) {
    if (result.status === 'fulfilled') return result.value;
  }

  const errors = results
    .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    .map((result) => result.reason);
  const authError = errors.find((err) => err instanceof AureusError && err.status === 401);
  if (authError instanceof AureusError) throw authError;
  const aureusError = errors.find((err) => err instanceof AureusError);
  if (aureusError instanceof AureusError) throw aureusError;
  throw new AureusError('Aureus POS is unavailable. Try again shortly.', 502);
}

export async function fetchUserData(baseUrl: string, token: string): Promise<Record<string, unknown> | null> {
  const root = assertHttps(baseUrl);
  const { ok, status, payload } = await fetchJson(`${root}/account/user_data`, {
    method: 'GET',
    headers: { ...JSON_HEADERS, Authorization: `Bearer ${token}` },
  });
  if (!ok) {
    throw new AureusError(messageFrom(payload, 'Session expired.'), status >= 500 ? 502 : 401);
  }
  const body = payload as { user?: Record<string, unknown> } | null;
  return (body?.user ?? (body as Record<string, unknown> | null)) || null;
}

function rowsFromListPayload(payload: unknown): unknown[] {
  const body = payload as { data?: unknown } | unknown[] | null;
  if (Array.isArray(body)) return body;
  if (Array.isArray((body as { data?: unknown } | null)?.data)) {
    return (body as { data: unknown[] }).data;
  }
  return [];
}

function lastPageFromPayload(payload: unknown, fallback = 1): number {
  const body = payload as { last_page?: unknown; meta?: { last_page?: unknown; lastPage?: unknown } } | null;
  const value = Number(body?.last_page ?? body?.meta?.last_page ?? body?.meta?.lastPage ?? fallback);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export async function lookupLocationName(baseUrl: string, token: string, locationId: string): Promise<string> {
  if (!locationId) return '';
  try {
    const root = assertHttps(baseUrl);
    const { ok, payload } = await fetchJson(`${root}/settings/locations`, {
      method: 'GET',
      headers: { ...JSON_HEADERS, Authorization: `Bearer ${token}` },
    });
    if (!ok) return '';
    const rows = rowsFromListPayload(payload);
    const match = rows.find((row) => String((row as { id?: unknown })?.id) === String(locationId)) as
      | { name?: unknown }
      | undefined;
    return typeof match?.name === 'string' ? match.name.trim() : '';
  } catch {
    return '';
  }
}

export async function fetchEmployeeById(
  baseUrl: string,
  token: string,
  employeeId: string,
): Promise<Record<string, unknown> | null> {
  if (!employeeId) return null;
  const root = assertHttps(baseUrl);
  const { ok, payload } = await fetchJson(`${root}/employees/${encodeURIComponent(employeeId)}`, {
    method: 'GET',
    headers: { ...JSON_HEADERS, Authorization: `Bearer ${token}` },
  });
  if (!ok) return null;
  const body = payload as { data?: unknown; employee?: unknown } | Record<string, unknown> | null;
  const row = (body as { data?: unknown })?.data ?? (body as { employee?: unknown })?.employee ?? body;
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  return row as Record<string, unknown>;
}

/**
 * Full POS employee directory from GET /employees. Role and default location
 * live on these rows. Login uses this when user_data does not have them.
 */
export async function fetchEmployeeDirectory(baseUrl: string, token: string): Promise<unknown[]> {
  const root = assertHttps(baseUrl);
  const all: unknown[] = [];
  const seen = new Set<string>();
  const pageSize = 200;
  let page = 1;
  let lastPage = 1;

  while (page <= lastPage && page <= 10) {
    const { ok, payload } = await fetchJson(
      `${root}/employees?page=${page}&items_per_page=${pageSize}`,
      { method: 'GET', headers: { ...JSON_HEADERS, Authorization: `Bearer ${token}` } },
    );
    if (!ok) {
      if (page === 1) {
        const retry = await fetchJson(`${root}/employees`, {
          method: 'GET',
          headers: { ...JSON_HEADERS, Authorization: `Bearer ${token}` },
        });
        if (!retry.ok) return [];
        return rowsFromListPayload(retry.payload);
      }
      break;
    }

    const batch = rowsFromListPayload(payload);
    lastPage = lastPageFromPayload(payload, batch.length < pageSize ? page : page + 1);
    for (const row of batch) {
      const key = String((row as { id?: unknown } | null)?.id ?? all.length);
      if (seen.has(key)) continue;
      seen.add(key);
      all.push(row);
    }
    if (batch.length === 0 || batch.length < pageSize) break;
    page += 1;
  }

  return all;
}

export interface EmployeeVisibility {
  canViewEmployees: boolean;
  namedCount: number;
  status: number;
  error?: string;
}

function rowHasEmployeeName(row: unknown): boolean {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return false;
  const source = row as Record<string, unknown>;
  const nested =
    source.user && typeof source.user === 'object' && !Array.isArray(source.user)
      ? (source.user as Record<string, unknown>)
      : source;
  const first = String(nested.first_name ?? nested.firstName ?? '').trim();
  const last = String(nested.last_name ?? nested.lastName ?? '').trim();
  const full = String(
    nested.full_name ?? nested.fullName ?? nested.name ?? nested.display_name ?? nested.displayName ?? '',
  ).trim();
  return Boolean(first || last || full);
}

/**
 * Live POS check for the bonuses-only grant: can this session read the
 * employee directory, including names? 403 / "not allowed to manage the
 * employees" is a deny. A 200 (even an empty list) means the account has
 * the Employees permission.
 */
export async function probeEmployeeVisibility(baseUrl: string, token: string): Promise<EmployeeVisibility> {
  const root = assertHttps(baseUrl);
  const headers = { ...JSON_HEADERS, Authorization: `Bearer ${token}` };
  let result = await fetchJson(`${root}/employees?page=1&items_per_page=50`, { method: 'GET', headers });
  if (!result.ok) {
    result = await fetchJson(`${root}/employees`, { method: 'GET', headers });
  }
  const message = messageFrom(result.payload, '');
  const denied =
    !result.ok ||
    result.status === 401 ||
    result.status === 403 ||
    /not allowed|forbidden|permission|unauthori[sz]ed to manage/i.test(message);
  if (denied) {
    return {
      canViewEmployees: false,
      namedCount: 0,
      status: result.status,
      error: message || 'You are not allowed to manage the employees.',
    };
  }
  const rows = rowsFromListPayload(result.payload);
  return {
    canViewEmployees: true,
    namedCount: rows.filter(rowHasEmployeeName).length,
    status: result.status,
  };
}

/**
 * Every POS host that accepts this staff password. Used only by the
 * bonuses-authorization path. Does not replace loginToStaffPos or linked
 * shared-credential login.
 */
export async function loginToAllStaffPos(
  login: string,
  password: string,
  options: { exceptKey?: string } = {},
): Promise<AureusSession[]> {
  const hosts = POS_SYSTEMS.filter((system) => system.key !== options.exceptKey);
  const results = await Promise.allSettled(
    hosts.map((system) => loginToPos(system.baseUrl, login, password)),
  );
  return results
    .filter((result): result is PromiseFulfilledResult<AureusSession> => result.status === 'fulfilled')
    .map((result) => result.value);
}

/**
 * Linked POS systems whose shared inventory credentials live in Edge Function
 * secrets (CGOLD_LINKED_POS_SYSTEMS as a JSON array). Never in the app bundle.
 * East can also be supplied via CGOLD_EAST_POS_LOGIN / CGOLD_EAST_POS_PASSWORD
 * so GTA and PMX staff still load every store.
 */
export function linkedPosSystems(): LinkedPosSystem[] {
  const byKey = new Map<string, LinkedPosSystem>();

  const raw = Deno.env.get('CGOLD_LINKED_POS_SYSTEMS');
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        for (const entry of parsed) {
          const key = String(entry?.key || '').trim();
          const label = String(entry?.label || '').trim();
          const baseUrl = String(entry?.baseUrl || '').trim();
          const login = String(entry?.login || '').trim();
          const password = String(entry?.password || '');
          if (!key || !label || !baseUrl || !login || !password) continue;
          byKey.set(key, { key, label, baseUrl: assertHttps(baseUrl), login, password });
        }
      }
    } catch {
      console.error('CGOLD_LINKED_POS_SYSTEMS is not valid JSON; linked POS disabled.');
    }
  }

  const eastLogin = (Deno.env.get('CGOLD_EAST_POS_LOGIN') || '').trim();
  const eastPassword = Deno.env.get('CGOLD_EAST_POS_PASSWORD') || '';
  if (eastLogin && eastPassword && !byKey.has('east')) {
    byKey.set('east', {
      key: 'east',
      label: 'Canada Gold East',
      baseUrl: AUREUS_BASE_URL,
      login: eastLogin,
      password: eastPassword,
    });
  }

  return [...byKey.values()];
}

export async function loginLinkedPosSystems(
  options: { exceptKey?: string; include?: AureusSession | null } = {},
): Promise<Record<string, LinkedPosResult>> {
  const systems = linkedPosSystems();
  const linked: Record<string, LinkedPosResult> = {};
  const include = options.include;
  if (include?.token && include.systemKey) {
    linked[include.systemKey] = {
      key: include.systemKey,
      label: include.systemLabel || include.systemKey,
      baseUrl: include.baseUrl,
      token: include.token,
      user: include.user,
    };
  }

  await Promise.all(
    systems.map(async (system) => {
      if (system.key === options.exceptKey) return;
      if (linked[system.key]?.token) return;
      try {
        const session = await loginToPos(system.baseUrl, system.login, system.password);
        linked[system.key] = {
          key: system.key,
          label: system.label,
          baseUrl: system.baseUrl,
          token: session.token,
          user: session.user,
        };
      } catch (err) {
        linked[system.key] = {
          key: system.key,
          label: system.label,
          baseUrl: system.baseUrl,
          error: err instanceof Error ? err.message : 'Linked POS login failed.',
        };
      }
    }),
  );

  return linked;
}
