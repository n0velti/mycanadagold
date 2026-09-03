/**
 * Aureus POS client used by the Edge Functions. Talks to the POS over HTTPS
 * with a short timeout and never logs credentials.
 */

export const AUREUS_BASE_URL = 'https://canadagoldeast.aureuspos.com/api';

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

  return { token: String(token), user, login: login.trim(), baseUrl: root };
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

/**
 * Linked POS systems whose shared inventory credentials live in Edge Function
 * secrets (CGOLD_LINKED_POS_SYSTEMS as a JSON array). Never in the app bundle.
 */
export function linkedPosSystems(): LinkedPosSystem[] {
  const raw = Deno.env.get('CGOLD_LINKED_POS_SYSTEMS');
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry) => ({
        key: String(entry?.key || '').trim(),
        label: String(entry?.label || '').trim(),
        baseUrl: String(entry?.baseUrl || '').trim(),
        login: String(entry?.login || '').trim(),
        password: String(entry?.password || ''),
      }))
      .filter((entry) => entry.key && entry.label && entry.baseUrl && entry.login && entry.password)
      .map((entry) => ({ ...entry, baseUrl: assertHttps(entry.baseUrl) }));
  } catch {
    console.error('CGOLD_LINKED_POS_SYSTEMS is not valid JSON; linked POS disabled.');
    return [];
  }
}

export async function loginLinkedPosSystems(): Promise<Record<string, LinkedPosResult>> {
  const systems = linkedPosSystems();
  const linked: Record<string, LinkedPosResult> = {};

  await Promise.all(
    systems.map(async (system) => {
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
