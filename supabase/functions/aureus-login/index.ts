/**
 * aureus-login — the only way into MyCanadaGold.
 *
 *   POST { action: "login", login, password, systemKey? }
 *     1. Throttles by IP + login.
 *     2. Verifies the credentials against East, GTA, and PMX
 *        (`systemKey` pins one host; otherwise first success wins).
 *     3. Finds or creates the matching Supabase Auth user (email pre-confirmed,
 *        so no confirmation mail is ever sent) and stamps app_metadata with the
 *        Aureus identity (`aureus_user_id`) that RLS and the proxy check.
 *     4. Upserts the staff profile with the service role.
 *     5. Refuses deactivated staff.
 *     6. Mints a Supabase session with a server-held password (no magic-link
 *        email, so Auth email quota cannot block sign-in).
 *     7. Signs in to the other POS systems with server-held shared credentials
 *        so every staff session can load every store.
 *
 *   POST { action: "refresh-linked" }   Authorization: Bearer <user JWT>
 *     Re-issues linked POS tokens for an already signed-in, active staff member.
 *
 *   POST { action: "set-location", aureusToken, locationId, locationName }
 *     Writes the caller's assigned store onto their profile after POS updated it.
 *
 *   POST { action: "sync-bonus-access", aureusToken, baseUrl, bonusAuth? }
 *     Re-probes GET /employees with the caller's own POS tokens (not the
 *     linked shared logins) and refreshes the bonuses-only grant.
 *
 * verify_jwt is off for this function (the caller is not signed in yet), so
 * every check happens here.
 */
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { bearerToken, clientIp, error, json, preflight, readJson, sha256Hex } from '../_shared/http.ts';
import { aureusUserIdFromAppMetadata } from '../_shared/staff.ts';
import {
  AUREUS_BASE_URL,
  AureusError,
  fetchUserData,
  loginLinkedPosSystems,
  fetchEmployeeById,
  fetchEmployeeDirectory,
  loginToAllStaffPos,
  loginToStaffPos,
  lookupLocationName,
  posSystemFromBaseUrl,
  probeEmployeeVisibility,
  POS_SYSTEMS,
  type AureusSession,
  type EmployeeVisibility,
  type LinkedPosResult,
} from '../_shared/aureus.ts';
import {
  authEmailForIdentity,
  extractAureusIdentity,
  findEmployeeRecord,
  inferAppRole,
  mergeEmployeeIntoIdentity,
  namespaceAureusUserId,
  rawAureusUserId,
  type AureusIdentity,
} from '../_shared/identity.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SECRET_KEY') ?? '';
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY') ?? '';

const MAX_LOGIN_LENGTH = 200;
const MAX_PASSWORD_LENGTH = 512;
const MAX_FAILURES_PER_LOGIN = 8;
const MAX_FAILURES_PER_IP = 40;
const THROTTLE_WINDOW = '15 minutes';

const PROFILE_COLUMNS =
  'id, aureus_user_id, aureus_login, email, first_name, last_name, full_name, role, employee_type, location_id, location_name, app_role, allowed_app_roles, is_system_admin, is_active, can_view_bonus_data, bonus_employee_visibility, pinned_tools, apps_view, avatar_url, team_id, is_team_intake, last_login_at, created_at';

const PROFILE_COLUMNS_WITHOUT_BONUS =
  'id, aureus_user_id, aureus_login, email, first_name, last_name, full_name, role, employee_type, location_id, location_name, app_role, allowed_app_roles, is_system_admin, is_active, pinned_tools, apps_view, avatar_url, team_id, is_team_intake, last_login_at, created_at';

const PROFILE_COLUMNS_LEGACY =
  'id, aureus_user_id, aureus_login, email, first_name, last_name, full_name, role, employee_type, location_id, location_name, app_role, is_system_admin, is_active, pinned_tools, apps_view, avatar_url, team_id, is_team_intake, last_login_at, created_at';

async function selectProfileById(admin: SupabaseClient, userId: string) {
  const full = await admin.from('profiles').select(PROFILE_COLUMNS).eq('id', userId).single();
  if (!full.error && full.data) return { data: full.data as ProfileRow, error: null };
  if (full.error && /can_view_bonus_data|bonus_employee_visibility/i.test(full.error.message || '')) {
    const withoutBonus = await admin.from('profiles').select(PROFILE_COLUMNS_WITHOUT_BONUS).eq('id', userId).single();
    if (!withoutBonus.error && withoutBonus.data) {
      return { data: withoutBonus.data as ProfileRow, error: null };
    }
    if (withoutBonus.error && !/allowed_app_roles/i.test(withoutBonus.error.message || '')) {
      return { data: null, error: withoutBonus.error };
    }
  } else if (full.error && !/allowed_app_roles/i.test(full.error.message || '')) {
    return { data: null, error: full.error };
  }
  const fallback = await admin.from('profiles').select(PROFILE_COLUMNS_LEGACY).eq('id', userId).single();
  return { data: (fallback.data as ProfileRow) || null, error: fallback.error };
}

interface LoginBody {
  action?: string;
  login?: string;
  password?: string;
  aureusToken?: string;
  locationId?: string;
  locationName?: string;
  baseUrl?: string;
  systemKey?: string;
  bonusAuth?: Record<string, { token?: string; baseUrl?: string }>;
}

interface BonusSystemProbe {
  canViewEmployees: boolean;
  namedCount: number;
}

interface BonusAccessResult {
  granted: boolean | null;
  bySystem: Record<string, BonusSystemProbe>;
  bonusAuth: Record<string, LinkedPosResult>;
  staffPos: Record<string, LinkedPosResult>;
}

interface ProfileRow {
  id: string;
  aureus_user_id: string;
  aureus_login: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  role: string | null;
  employee_type: string | null;
  location_id: string | null;
  location_name: string | null;
  avatar_url: string | null;
  team_id: string | null;
  is_team_intake: boolean;
  app_role: string;
  allowed_app_roles?: unknown;
  is_system_admin: boolean;
  is_active: boolean;
  can_view_bonus_data?: boolean;
  bonus_employee_visibility?: unknown;
  pinned_tools: unknown;
  apps_view: string | null;
  last_login_at: string;
  created_at: string;
  team_name?: string;
}

function requireEnv(): void {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY) {
    throw new Error('Edge Function is missing SUPABASE_URL / service role / anon key.');
  }
}

function adminClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function anonClient(): SupabaseClient {
  return createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}

// Throwaway password nobody ever types; it only exists because Auth users
// need one. GoTrue rejects anything over 72 bytes (bcrypt) and can require
// specific character classes, so draw 64 chars and guarantee one of each.
const PASSWORD_CLASSES = [
  'abcdefghijklmnopqrstuvwxyz',
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  '0123456789',
  '!@#$%^&*()_+-=[]{}',
];
const PASSWORD_ALPHABET = PASSWORD_CLASSES.join('');

function randomPassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(64));
  return Array.from(bytes, (b, i) => {
    const set = i < PASSWORD_CLASSES.length ? PASSWORD_CLASSES[i] : PASSWORD_ALPHABET;
    return set[b % set.length];
  }).join('');
}

async function throttleCheck(admin: SupabaseClient, ipHash: string, loginHash: string): Promise<boolean> {
  const { data, error: rpcError } = await admin.rpc('login_attempts_recent_failures', {
    p_ip_hash: ipHash,
    p_login_hash: loginHash,
    p_window: THROTTLE_WINDOW,
  });
  if (rpcError) {
    console.error('throttle check failed', rpcError.message);
    return true;
  }
  const row = Array.isArray(data) ? data[0] : data;
  const ipFailures = Number(row?.ip_failures ?? 0);
  const loginFailures = Number(row?.login_failures ?? 0);
  return ipFailures < MAX_FAILURES_PER_IP && loginFailures < MAX_FAILURES_PER_LOGIN;
}

async function recordAttempt(admin: SupabaseClient, ipHash: string, loginHash: string, succeeded: boolean): Promise<void> {
  const { error: insertError } = await admin
    .from('login_attempts')
    .insert({ ip_hash: ipHash, login_hash: loginHash, succeeded });
  if (insertError) console.error('login attempt log failed', insertError.message);
  if (Math.random() < 0.02) {
    await admin.rpc('login_attempts_prune', { p_keep: '2 days' });
  }
}

async function findAuthUserId(admin: SupabaseClient, identity: AureusIdentity, email: string): Promise<string | null> {
  const byAureus = await admin
    .from('profiles')
    .select('id')
    .eq('aureus_user_id', identity.aureusUserId)
    .maybeSingle();
  if (byAureus.error) throw byAureus.error;
  if (byAureus.data?.id) return byAureus.data.id as string;

  const byEmail = await admin.rpc('auth_user_id_for_email', { p_email: email });
  if (byEmail.error) throw byEmail.error;
  return (byEmail.data as string | null) || null;
}

async function ensureAuthUser(admin: SupabaseClient, identity: AureusIdentity, email: string): Promise<string> {
  // `aureus_user_id` is the claim RLS and the proxy trust. `provider` /
  // `providers` are owned by GoTrue and get reset to "email" whenever the
  // magic-link OTP session is minted, so nothing may depend on them.
  const appMetadata = {
    aureus_user_id: identity.aureusUserId,
    aureus_login: identity.aureusLogin,
  };
  const userMetadata = {
    source: 'aureus_pos',
    full_name: identity.fullName || null,
  };

  const existingId = await findAuthUserId(admin, identity, email);

  if (existingId) {
    const { data: current, error: currentError } = await admin.auth.admin.getUserById(existingId);
    if (currentError) throw currentError;

    // First pass through this flow for a legacy account: rotate the password
    // to an unknown value so signInWithPassword can never work again. GoTrue
    // also revokes every existing session on an admin password change, which
    // is exactly what we want for sessions minted by the old client flow.
    const migrating = !aureusUserIdFromAppMetadata(current?.user?.app_metadata);
    const patch: Record<string, unknown> = {
      email_confirm: true,
      app_metadata: appMetadata,
      user_metadata: userMetadata,
    };
    if (migrating) patch.password = randomPassword();

    const emailChanged = (current?.user?.email || '').toLowerCase() !== email.toLowerCase();
    const attempt = await admin.auth.admin.updateUserById(existingId, emailChanged ? { ...patch, email } : patch);
    if (attempt.error && emailChanged) {
      // Another auth user already owns that address; keep the stored email.
      const retry = await admin.auth.admin.updateUserById(existingId, patch);
      if (retry.error) throw retry.error;
    } else if (attempt.error) {
      throw attempt.error;
    }
    return existingId;
  }

  const { data, error: createError } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    password: randomPassword(),
    app_metadata: appMetadata,
    user_metadata: userMetadata,
  });
  if (createError || !data?.user) {
    throw createError || new Error('Could not create the staff account.');
  }
  return data.user.id;
}

async function upsertProfile(
  admin: SupabaseClient,
  userId: string,
  identity: AureusIdentity,
): Promise<{ profile: ProfileRow; firstLogin: boolean }> {
  const now = new Date().toISOString();
  const { data: existing, error: existingError } = await admin
    .from('profiles')
    .select('id, is_active, role, employee_type, location_id, location_name, app_role, is_system_admin')
    .eq('id', userId)
    .maybeSingle();
  if (existingError) throw existingError;

  const firstLogin = !existing;
  const row: Record<string, unknown> = {
    aureus_user_id: identity.aureusUserId,
    aureus_login: identity.aureusLogin,
    email: identity.email || null,
    first_name: identity.firstName || null,
    last_name: identity.lastName || null,
    full_name: identity.fullName || null,
    role: identity.role || existing?.role || null,
    employee_type: identity.employeeType || existing?.employee_type || null,
    location_id: identity.locationId || existing?.location_id || null,
    location_name: identity.locationName || existing?.location_name || null,
    aureus_payload: identity.payload,
    aureus_verified_at: now,
    last_login_at: now,
    updated_at: now,
  };
  // Infer a starting role only on first sign-in. After that, Settings →
  // Permissions is the source of truth — login/sync must not overwrite it.
  if (!existing) {
    row.app_role = inferAppRole(identity.role, identity.employeeType);
  }

  const optionalColumnError = /allowed_app_roles|can_view_bonus_data|bonus_employee_visibility/i;

  if (existing) {
    const updated = await admin.from('profiles').update(row).eq('id', userId).select(PROFILE_COLUMNS).single();
    if (!updated.error && updated.data) return { profile: updated.data as ProfileRow, firstLogin };
    if (updated.error && !optionalColumnError.test(updated.error.message || '')) throw updated.error;
    const withoutBonus = await admin
      .from('profiles')
      .update(row)
      .eq('id', userId)
      .select(PROFILE_COLUMNS_WITHOUT_BONUS)
      .single();
    if (!withoutBonus.error && withoutBonus.data) return { profile: withoutBonus.data as ProfileRow, firstLogin };
    if (withoutBonus.error && !/allowed_app_roles/i.test(withoutBonus.error.message || '')) throw withoutBonus.error;
    const fallback = await admin.from('profiles').update(row).eq('id', userId).select(PROFILE_COLUMNS_LEGACY).single();
    if (fallback.error) throw fallback.error;
    return { profile: fallback.data as ProfileRow, firstLogin };
  }

  const inserted = await admin
    .from('profiles')
    .insert({ id: userId, created_at: now, ...row })
    .select(PROFILE_COLUMNS)
    .single();
  if (!inserted.error && inserted.data) return { profile: inserted.data as ProfileRow, firstLogin };
  if (inserted.error && !optionalColumnError.test(inserted.error.message || '')) throw inserted.error;
  const withoutBonus = await admin
    .from('profiles')
    .insert({ id: userId, created_at: now, ...row })
    .select(PROFILE_COLUMNS_WITHOUT_BONUS)
    .single();
  if (!withoutBonus.error && withoutBonus.data) return { profile: withoutBonus.data as ProfileRow, firstLogin };
  if (withoutBonus.error && !/allowed_app_roles/i.test(withoutBonus.error.message || '')) throw withoutBonus.error;
  const fallback = await admin
    .from('profiles')
    .insert({ id: userId, created_at: now, ...row })
    .select(PROFILE_COLUMNS_LEGACY)
    .single();
  if (fallback.error) throw fallback.error;
  return { profile: fallback.data as ProfileRow, firstLogin };
}

/** Stable per-user password so sign-in never calls generateLink (email quota). */
async function staffAuthPassword(userId: string): Promise<string> {
  const digest = await sha256Hex(`staff-pass:${SERVICE_ROLE_KEY}:${userId}`);
  return `Cg1!${digest}`;
}

function sessionPayload(session: {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
  expires_at?: number;
  token_type?: string;
}) {
  return {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_in: session.expires_in,
    expires_at: session.expires_at,
    token_type: session.token_type,
  };
}

async function mintSession(admin: SupabaseClient, userId: string, email: string) {
  const password = await staffAuthPassword(userId);
  const anon = anonClient();

  let signed = await anon.auth.signInWithPassword({ email, password });
  if (signed.error || !signed.data?.session) {
    const update = await admin.auth.admin.updateUserById(userId, {
      password,
      email_confirm: true,
    });
    if (update.error) throw update.error;
    signed = await anon.auth.signInWithPassword({ email, password });
  }

  if (signed.error || !signed.data?.session) {
    throw signed.error || new Error('Could not start a session.');
  }

  return sessionPayload(signed.data.session);
}

async function withTeamName(admin: SupabaseClient, row: ProfileRow): Promise<ProfileRow> {
  if (!row?.team_id) return { ...row, team_name: '' };
  const { data, error } = await admin.from('teams').select('name').eq('id', row.team_id).maybeSingle();
  if (error) return { ...row, team_name: '' };
  return { ...row, team_name: String(data?.name || '') };
}

function publicProfile(row: ProfileRow) {
  return {
    id: row.id,
    aureusUserId: row.aureus_user_id,
    aureusLogin: row.aureus_login,
    email: row.email || '',
    firstName: row.first_name || '',
    lastName: row.last_name || '',
    fullName: row.full_name || '',
    role: row.role || '',
    employeeType: row.employee_type || '',
    locationId: row.location_id || '',
    locationName: row.location_name || '',
    avatarUrl: row.avatar_url || '',
    teamId: row.team_id || '',
    teamName: row.team_name || '',
    isTeamIntake: Boolean(row.is_team_intake),
    appRole: row.app_role || '',
    allowedAppRoles: Array.isArray(row.allowed_app_roles)
      ? row.allowed_app_roles.filter((role): role is string => typeof role === 'string')
      : [],
    isSystemAdmin: Boolean(row.is_system_admin),
    isActive: Boolean(row.is_active),
    canViewBonusData: Boolean((row as ProfileRow & { can_view_bonus_data?: boolean }).can_view_bonus_data),
    bonusEmployeeVisibility:
      (row as ProfileRow & { bonus_employee_visibility?: unknown }).bonus_employee_visibility &&
      typeof (row as ProfileRow & { bonus_employee_visibility?: unknown }).bonus_employee_visibility === 'object'
        ? (row as ProfileRow & { bonus_employee_visibility: Record<string, unknown> }).bonus_employee_visibility
        : {},
    pinnedTools: Array.isArray(row.pinned_tools) ? row.pinned_tools : null,
    appsView: row.apps_view || null,
    lastLoginAt: row.last_login_at || null,
    createdAt: row.created_at || null,
  };
}

function emptyBonusBySystem(): Record<string, BonusSystemProbe> {
  return {
    east: { canViewEmployees: false, namedCount: 0 },
    gta: { canViewEmployees: false, namedCount: 0 },
    pmx: { canViewEmployees: false, namedCount: 0 },
  };
}

function visibilityFromProbe(probe: EmployeeVisibility): BonusSystemProbe {
  return { canViewEmployees: probe.canViewEmployees, namedCount: probe.namedCount };
}

function staffPosFromSessions(sessions: Iterable<AureusSession>): Record<string, LinkedPosResult> {
  const out: Record<string, LinkedPosResult> = {};
  for (const session of sessions) {
    if (!session?.token || !session.systemKey) continue;
    out[session.systemKey] = {
      key: session.systemKey,
      label: session.systemLabel || session.systemKey,
      baseUrl: session.baseUrl,
      token: session.token,
    };
  }
  return out;
}

async function probeSessionVisibility(session: AureusSession): Promise<{
  probe: EmployeeVisibility;
  auth: LinkedPosResult | null;
}> {
  const probe = await probeEmployeeVisibility(session.baseUrl, session.token);
  if (!probe.canViewEmployees) {
    return { probe, auth: null };
  }
  return {
    probe,
    auth: {
      key: session.systemKey,
      label: session.systemLabel || session.systemKey,
      baseUrl: session.baseUrl,
      token: session.token,
    },
  };
}

/**
 * Bonuses-only path. Tries the staff password on every POS host (the same
 * credentials they just typed) and checks GET /employees + names. Does not
 * write into `linked` — that stays the shared-credential auto-login.
 */
async function evaluateBonusAccess(
  login: string,
  password: string,
  primary: AureusSession,
): Promise<BonusAccessResult> {
  const bySystem = emptyBonusBySystem();
  const bonusAuth: Record<string, LinkedPosResult> = {};
  const sessions = new Map<string, AureusSession>();
  sessions.set(primary.systemKey, primary);

  try {
    const others = await loginToAllStaffPos(login, password, { exceptKey: primary.systemKey });
    for (const session of others) {
      // Keep the primary session as-is so linked auto-login is untouched.
      if (!sessions.has(session.systemKey)) sessions.set(session.systemKey, session);
    }
  } catch (err) {
    console.error('bonus pos login failed', err instanceof Error ? err.message : err);
  }

  const probes = await Promise.all(
    [...sessions.values()].map(async (session) => {
      try {
        return { key: session.systemKey, ...(await probeSessionVisibility(session)) };
      } catch (err) {
        return {
          key: session.systemKey,
          probe: {
            canViewEmployees: false,
            namedCount: 0,
            status: 0,
            error: err instanceof Error ? err.message : 'Employee visibility check failed.',
          } satisfies EmployeeVisibility,
          auth: null,
        };
      }
    }),
  );

  let probed = 0;
  for (const row of probes) {
    probed += 1;
    bySystem[row.key] = visibilityFromProbe(row.probe);
    if (row.auth?.token) bonusAuth[row.key] = row.auth;
  }

  const staffPos = staffPosFromSessions(sessions.values());

  if (!probed) {
    return { granted: null, bySystem, bonusAuth, staffPos };
  }
  return {
    granted: Object.values(bySystem).some((row) => row.canViewEmployees),
    bySystem,
    bonusAuth,
    staffPos,
  };
}

async function persistBonusAccess(
  admin: SupabaseClient,
  userId: string,
  access: BonusAccessResult,
): Promise<void> {
  if (access.granted == null) return;
  const patch = {
    can_view_bonus_data: access.granted,
    bonus_employee_visibility: access.bySystem,
    updated_at: new Date().toISOString(),
  };
  const updated = await admin.from('profiles').update(patch).eq('id', userId);
  if (updated.error && /can_view_bonus_data|bonus_employee_visibility/i.test(updated.error.message || '')) {
    return;
  }
  if (updated.error) {
    console.error('bonus access persist failed', updated.error.message);
  }
}

function publicBonusAccess(access: BonusAccessResult) {
  return {
    granted: access.granted === true,
    bySystem: access.bySystem,
  };
}

function allowedBonusBaseUrl(baseUrl: string): string {
  const system = posSystemFromBaseUrl(baseUrl);
  if (!system) return '';
  return system.baseUrl;
}

async function evaluateBonusAccessFromTokens(
  primary: AureusSession,
  extras: Record<string, { token?: string; baseUrl?: string }> = {},
): Promise<BonusAccessResult> {
  const bySystem = emptyBonusBySystem();
  const bonusAuth: Record<string, LinkedPosResult> = {};
  const sessions: AureusSession[] = [primary];

  for (const system of POS_SYSTEMS) {
    if (system.key === primary.systemKey) continue;
    const extra = extras[system.key];
    const token = String(extra?.token || '').trim();
    const baseUrl = allowedBonusBaseUrl(String(extra?.baseUrl || system.baseUrl));
    if (!token || !baseUrl) continue;
    sessions.push({
      token,
      user: null,
      login: '',
      baseUrl,
      systemKey: system.key,
      systemLabel: system.label,
    });
  }

  const probes = await Promise.all(
    sessions.map(async (session) => {
      try {
        return { key: session.systemKey, ...(await probeSessionVisibility(session)) };
      } catch (err) {
        return {
          key: session.systemKey,
          probe: {
            canViewEmployees: false,
            namedCount: 0,
            status: 0,
            error: err instanceof Error ? err.message : 'Employee visibility check failed.',
          } satisfies EmployeeVisibility,
          auth: null,
        };
      }
    }),
  );

  for (const row of probes) {
    bySystem[row.key] = visibilityFromProbe(row.probe);
    if (row.auth?.token) bonusAuth[row.key] = row.auth;
  }

  return {
    granted: Object.values(bySystem).some((row) => row.canViewEmployees),
    bySystem,
    bonusAuth,
    staffPos: staffPosFromSessions(sessions),
  };
}

async function applyDirectoryToProfiles(
  admin: SupabaseClient,
  directory: unknown[],
  systemKey = 'east',
): Promise<number> {
  if (!directory.length) return 0;
  const { data: profiles, error: listError } = await admin
    .from('profiles')
    .select('id, aureus_user_id, aureus_login, email, app_role, is_system_admin');
  if (listError) throw listError;

  const now = new Date().toISOString();
  let updated = 0;
  await Promise.all(
    (profiles || []).map(async (profile) => {
      const storedId = String(profile.aureus_user_id || '');
      const namespaced = /^(east|gta|pmx):/i.test(storedId);
      const rawId = namespaced
        ? rawAureusUserId(storedId, systemKey)
        : systemKey === 'east'
          ? storedId
          : '';
      const match = findEmployeeRecord(directory, {
        aureusUserId: rawId,
        aureusLogin: String(profile.aureus_login || ''),
        email: String(profile.email || ''),
      });
      if (!match) return;
      const identity = extractAureusIdentity(match, String(profile.aureus_login || ''));
      const patch: Record<string, unknown> = { updated_at: now };
      if (identity.role) patch.role = identity.role;
      if (identity.employeeType) patch.employee_type = identity.employeeType;
      if (identity.locationId) patch.location_id = identity.locationId;
      if (identity.locationName) patch.location_name = identity.locationName;
      if (Object.keys(patch).length <= 1) return;
      const { error: updateError } = await admin.from('profiles').update(patch).eq('id', profile.id);
      if (!updateError) updated += 1;
    }),
  );
  return updated;
}

async function requireAureusStaff(req: Request): Promise<{ admin: SupabaseClient; userId: string }> {
  const jwt = bearerToken(req);
  if (!jwt || jwt === ANON_KEY) {
    throw Object.assign(new Error('Sign in first.'), { status: 401, code: 'unauthenticated' });
  }
  const admin = adminClient();
  const { data: userData, error: userError } = await admin.auth.getUser(jwt);
  if (userError || !userData?.user) {
    throw Object.assign(new Error('Session expired. Sign in again.'), { status: 401, code: 'unauthenticated' });
  }
  const user = userData.user;
  const aureusUserId = aureusUserIdFromAppMetadata(user.app_metadata);
  if (!aureusUserId) {
    throw Object.assign(new Error('This account was not verified with Aureus.'), { status: 403, code: 'forbidden' });
  }
  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('id, aureus_user_id, is_active')
    .eq('id', user.id)
    .maybeSingle();
  if (profileError || !profile) {
    throw Object.assign(new Error('No staff profile for this account.'), { status: 403, code: 'forbidden' });
  }
  if (!profile.is_active || profile.aureus_user_id !== aureusUserId) {
    throw Object.assign(new Error('Your MyCanadaGold access has been disabled.'), { status: 403, code: 'deactivated' });
  }
  return { admin, userId: user.id };
}

async function handleLogin(req: Request, body: LoginBody): Promise<Response> {
  const login = String(body.login ?? '').trim();
  const password = String(body.password ?? '');

  if (!login || !password) {
    return error(req, 400, 'Enter your Aureus login and password.', 'missing_credentials');
  }
  if (login.length > MAX_LOGIN_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
    return error(req, 400, 'Login or password is too long.', 'invalid_credentials');
  }

  const admin = adminClient();
  const ipHash = await sha256Hex(`ip:${clientIp(req)}`);
  const loginHash = await sha256Hex(`login:${login.toLowerCase()}`);

  if (!(await throttleCheck(admin, ipHash, loginHash))) {
    return error(req, 429, 'Too many sign-in attempts. Try again in 15 minutes.', 'throttled');
  }

  const preferKey = POS_SYSTEMS.some((system) => system.key === String(body.systemKey || '').trim())
    ? String(body.systemKey).trim()
    : '';

  let aureus;
  try {
    aureus = await loginToStaffPos(login, password, preferKey ? { preferKey } : {});
  } catch (err) {
    await recordAttempt(admin, ipHash, loginHash, false);
    if (err instanceof AureusError && err.status === 401) {
      return error(req, 401, err.message, 'invalid_credentials');
    }
    console.error('aureus login error', err instanceof Error ? err.message : err);
    return error(req, 502, 'Aureus POS is unavailable. Try again shortly.', 'pos_unavailable');
  }

  let user = aureus.user;
  if (!user || typeof user !== 'object' || Object.keys(user).length === 0) {
    try {
      user = await fetchUserData(aureus.baseUrl, aureus.token);
    } catch {
      user = null;
    }
  }

  let identity = extractAureusIdentity(user, aureus.login);
  if (!identity.aureusUserId) {
    await recordAttempt(admin, ipHash, loginHash, false);
    return error(req, 502, 'Aureus did not return a user identity.', 'pos_identity');
  }
  const rawUserId = identity.aureusUserId;
  identity = {
    ...identity,
    aureusUserId: namespaceAureusUserId(aureus.systemKey, rawUserId),
  };

  let directory: unknown[] = [];
  try {
    const [byId, rows] = await Promise.all([
      fetchEmployeeById(aureus.baseUrl, aureus.token, rawUserId),
      fetchEmployeeDirectory(aureus.baseUrl, aureus.token),
    ]);
    directory = rows;
    const employee = byId || findEmployeeRecord(directory, { ...identity, aureusUserId: rawUserId });
    if (employee) identity = mergeEmployeeIntoIdentity(identity, employee);
    identity = {
      ...identity,
      aureusUserId: namespaceAureusUserId(aureus.systemKey, identity.aureusUserId || rawUserId),
    };
  } catch (err) {
    console.error('aureus employees lookup failed', err instanceof Error ? err.message : err);
  }

  if (!identity.locationName && identity.locationId) {
    identity.locationName = await lookupLocationName(aureus.baseUrl, aureus.token, identity.locationId);
  }

  const email = authEmailForIdentity(identity, aureus.login);

  let userId: string;
  let profile: ProfileRow;
  let firstLogin = false;
  try {
    userId = await ensureAuthUser(admin, identity, email);
    if (directory.length) {
      await applyDirectoryToProfiles(admin, directory, aureus.systemKey).catch((err) => {
        console.error('staff role sync failed', err instanceof Error ? err.message : err);
      });
    }
    const upserted = await upsertProfile(admin, userId, identity);
    profile = upserted.profile;
    firstLogin = upserted.firstLogin;
  } catch (err) {
    const detail = err as { message?: string; code?: string; status?: number } | null;
    console.error('account provisioning failed', {
      aureusUserId: identity.aureusUserId,
      message: detail?.message ?? String(err),
      code: detail?.code,
      status: detail?.status,
    });
    return error(req, 500, 'Could not prepare your staff account. Contact a system admin.', 'provisioning_failed');
  }

  if (!profile.is_active) {
    await recordAttempt(admin, ipHash, loginHash, false);
    return error(req, 403, 'Your MyCanadaGold access has been disabled. Contact a system admin.', 'deactivated');
  }

  let supabaseSession;
  try {
    supabaseSession = await mintSession(admin, userId, email);
  } catch (err) {
    console.error('session mint failed', err instanceof Error ? err.message : err);
    return error(req, 500, 'Could not start your session. Try again.', 'session_failed');
  }

  const linked = await loginLinkedPosSystems({
    exceptKey: aureus.systemKey,
    include: aureus,
  });

  let bonusAccess: BonusAccessResult = {
    granted: null,
    bySystem: emptyBonusBySystem(),
    bonusAuth: {},
    staffPos: {},
  };
  try {
    bonusAccess = await evaluateBonusAccess(login, password, aureus);
    await persistBonusAccess(admin, userId, bonusAccess);
    const refreshed = await selectProfileById(admin, userId);
    if (refreshed.data) profile = refreshed.data;
  } catch (err) {
    console.error('bonus access probe failed', err instanceof Error ? err.message : err);
  }

  await recordAttempt(admin, ipHash, loginHash, true);

  const published = publicProfile(await withTeamName(admin, profile));
  if (bonusAccess.granted != null) {
    published.canViewBonusData = bonusAccess.granted;
    published.bonusEmployeeVisibility = bonusAccess.bySystem;
  }

  return json(req, 200, {
    supabase: supabaseSession,
    aureus: {
      token: aureus.token,
      user: identity.payload,
      login: aureus.login,
      baseUrl: aureus.baseUrl,
      systemKey: aureus.systemKey,
      systemLabel: aureus.systemLabel,
    },
    linked,
    bonusAccess: publicBonusAccess(bonusAccess),
    bonusAuth: bonusAccess.bonusAuth,
    staffPos:
      Object.keys(bonusAccess.staffPos || {}).length > 0
        ? bonusAccess.staffPos
        : {
            [aureus.systemKey]: {
              key: aureus.systemKey,
              label: aureus.systemLabel || aureus.systemKey,
              baseUrl: aureus.baseUrl,
              token: aureus.token,
            },
          },
    profile: published,
    firstLogin,
  });
}

async function handleRefreshLinked(req: Request): Promise<Response> {
  const jwt = bearerToken(req);
  if (!jwt || jwt === ANON_KEY) {
    return error(req, 401, 'Sign in first.', 'unauthenticated');
  }

  const admin = adminClient();
  const { data: userData, error: userError } = await admin.auth.getUser(jwt);
  if (userError || !userData?.user) {
    return error(req, 401, 'Session expired. Sign in again.', 'unauthenticated');
  }

  const user = userData.user;
  const aureusUserId = aureusUserIdFromAppMetadata(user.app_metadata);
  if (!aureusUserId) {
    return error(req, 403, 'This account was not verified with Aureus.', 'forbidden');
  }

  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('id, aureus_user_id, aureus_login, is_active')
    .eq('id', user.id)
    .maybeSingle();
  if (profileError || !profile) {
    return error(req, 403, 'No staff profile for this account.', 'forbidden');
  }
  if (!profile.is_active || profile.aureus_user_id !== aureusUserId) {
    return error(req, 403, 'Your MyCanadaGold access has been disabled.', 'deactivated');
  }

  const linked = await loginLinkedPosSystems();
  return json(req, 200, { linked });
}

function posBaseUrlFromBody(body: LoginBody): string {
  const requested = String(body.baseUrl || '').trim();
  if (requested) {
    try {
      const parsed = new URL(requested);
      if (parsed.protocol === 'https:' && posSystemFromBaseUrl(parsed.toString())) {
        return parsed.toString().replace(/\/$/, '');
      }
    } catch {
      // Fall through to East.
    }
  }
  return AUREUS_BASE_URL;
}

async function handleSyncStaff(req: Request, body: LoginBody): Promise<Response> {
  let staff;
  try {
    staff = await requireAureusStaff(req);
  } catch (err) {
    const detail = err as { status?: number; code?: string; message?: string };
    return error(req, detail.status || 401, detail.message || 'Sign in first.', detail.code || 'unauthenticated');
  }

  const aureusToken = String(body.aureusToken || '').trim();
  if (!aureusToken) {
    return error(req, 400, 'Aureus session missing.', 'missing_token');
  }

  const baseUrl = posBaseUrlFromBody(body);
  const systemKey = posSystemFromBaseUrl(baseUrl)?.key || 'east';

  let directory: unknown[] = [];
  try {
    directory = await fetchEmployeeDirectory(baseUrl, aureusToken);
  } catch (err) {
    console.error('sync-staff directory failed', err instanceof Error ? err.message : err);
    return error(req, 502, 'Could not load employees from Aureus.', 'pos_unavailable');
  }

  try {
    const updated = await applyDirectoryToProfiles(staff.admin, directory, systemKey);
    const { data: profile, error: profileError } = await selectProfileById(staff.admin, staff.userId);
    if (profileError || !profile) {
      return json(req, 200, { updated, profile: null });
    }
    return json(req, 200, {
      updated,
      profile: publicProfile(await withTeamName(staff.admin, profile as ProfileRow)),
    });
  } catch (err) {
    console.error('sync-staff update failed', err instanceof Error ? err.message : err);
    return error(req, 500, 'Could not update staff roles.', 'sync_failed');
  }
}

async function handleSetLocation(req: Request, body: LoginBody): Promise<Response> {
  let staff;
  try {
    staff = await requireAureusStaff(req);
  } catch (err) {
    const detail = err as { status?: number; code?: string; message?: string };
    return error(req, detail.status || 401, detail.message || 'Sign in first.', detail.code || 'unauthenticated');
  }

  const locationId = String(body.locationId || '').trim();
  if (!locationId || locationId.length > 32) {
    return error(req, 400, 'Choose a location.', 'bad_request');
  }

  let locationName = String(body.locationName || '').trim().slice(0, 200);
  const aureusToken = String(body.aureusToken || '').trim();
  if (!locationName && aureusToken) {
    locationName = await lookupLocationName(posBaseUrlFromBody(body), aureusToken, locationId);
  }

  const update = await staff.admin
    .from('profiles')
    .update({
      location_id: locationId,
      location_name: locationName || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', staff.userId);
  if (update.error) {
    console.error('set-location update failed', update.error.message || update.error);
    return error(req, 500, 'Could not save that location.', 'sync_failed');
  }
  const { data: profile, error: updateError } = await selectProfileById(staff.admin, staff.userId);
  if (updateError || !profile) {
    console.error('set-location update failed', updateError?.message || updateError);
    return error(req, 500, 'Could not save that location.', 'sync_failed');
  }

  return json(req, 200, {
    profile: publicProfile(await withTeamName(staff.admin, profile as ProfileRow)),
  });
}

async function handleSyncBonusAccess(req: Request, body: LoginBody): Promise<Response> {
  let staff;
  try {
    staff = await requireAureusStaff(req);
  } catch (err) {
    const detail = err as { status?: number; code?: string; message?: string };
    return error(req, detail.status || 401, detail.message || 'Sign in first.', detail.code || 'unauthenticated');
  }

  const aureusToken = String(body.aureusToken || '').trim();
  if (!aureusToken) {
    return error(req, 400, 'Aureus session missing.', 'missing_token');
  }

  const baseUrl = posBaseUrlFromBody(body);
  const system = posSystemFromBaseUrl(baseUrl) || POS_SYSTEMS[0];
  const primary: AureusSession = {
    token: aureusToken,
    user: null,
    login: '',
    baseUrl,
    systemKey: system.key,
    systemLabel: system.label,
  };

  let bonusAccess: BonusAccessResult;
  try {
    bonusAccess = await evaluateBonusAccessFromTokens(primary, body.bonusAuth || {});
    await persistBonusAccess(staff.admin, staff.userId, bonusAccess);
  } catch (err) {
    console.error('sync-bonus-access failed', err instanceof Error ? err.message : err);
    return error(req, 502, 'Could not check employee visibility on Aureus.', 'pos_unavailable');
  }

  const { data: profile } = await selectProfileById(staff.admin, staff.userId);
  const published = profile ? publicProfile(await withTeamName(staff.admin, profile as ProfileRow)) : null;
  if (published && bonusAccess.granted != null) {
    published.canViewBonusData = bonusAccess.granted;
    published.bonusEmployeeVisibility = bonusAccess.bySystem;
  }

  return json(req, 200, {
    bonusAccess: publicBonusAccess(bonusAccess),
    bonusAuth: bonusAccess.bonusAuth,
    staffPos: bonusAccess.staffPos || {},
    profile: published,
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight(req);
  if (req.method !== 'POST') return error(req, 405, 'Use POST.', 'method_not_allowed');

  try {
    requireEnv();
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    return error(req, 500, 'Sign-in service is not configured.', 'misconfigured');
  }

  let body: LoginBody;
  try {
    body = await readJson<LoginBody>(req);
  } catch (err) {
    return error(req, 400, err instanceof Error ? err.message : 'Invalid request.', 'bad_request');
  }

  try {
    switch (body.action || 'login') {
      case 'login':
        return await handleLogin(req, body);
      case 'refresh-linked':
        return await handleRefreshLinked(req);
      case 'sync-staff':
        return await handleSyncStaff(req, body);
      case 'set-location':
        return await handleSetLocation(req, body);
      case 'sync-bonus-access':
        return await handleSyncBonusAccess(req, body);
      default:
        return error(req, 400, 'Unknown action.', 'bad_request');
    }
  } catch (err) {
    console.error('aureus-login unhandled', err instanceof Error ? err.message : err);
    return error(req, 500, 'Sign-in failed. Try again.', 'internal');
  }
});
