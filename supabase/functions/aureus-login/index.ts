/**
 * aureus-login — the only way into MyCanadaGold.
 *
 *   POST { action: "login", login, password }
 *     1. Throttles by IP + login.
 *     2. Verifies the credentials against Aureus POS.
 *     3. Finds or creates the matching Supabase Auth user (email pre-confirmed,
 *        so no confirmation mail is ever sent) and stamps app_metadata with the
 *        Aureus identity (`aureus_user_id`) that RLS and the proxy check.
 *     4. Upserts the staff profile with the service role.
 *     5. Refuses deactivated staff.
 *     6. Mints a Supabase session via a one-time token hash (never emailed).
 *     7. Signs in to linked POS systems with server-held shared credentials.
 *
 *   POST { action: "refresh-linked" }   Authorization: Bearer <user JWT>
 *     Re-issues linked POS tokens for an already signed-in, active staff member.
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
  loginToPos,
  lookupLocationName,
} from '../_shared/aureus.ts';
import {
  authEmailForIdentity,
  extractAureusIdentity,
  findEmployeeRecord,
  inferAppRole,
  mergeEmployeeIntoIdentity,
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
  'id, aureus_user_id, aureus_login, email, first_name, last_name, full_name, role, employee_type, location_id, location_name, app_role, is_system_admin, is_active, pinned_tools, apps_view, avatar_url, last_login_at, created_at';

interface LoginBody {
  action?: string;
  login?: string;
  password?: string;
  aureusToken?: string;
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
  app_role: string;
  is_system_admin: boolean;
  is_active: boolean;
  pinned_tools: unknown;
  apps_view: string | null;
  last_login_at: string;
  created_at: string;
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

function isEmailLogin(login: string): boolean {
  return login.includes('@');
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
  const lockedAdmin = Boolean(existing?.is_system_admin) || existing?.app_role === 'system_admin';
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
  if (!lockedAdmin) {
    row.app_role = inferAppRole(identity.role, identity.employeeType);
  }

  if (existing) {
    const { data, error: updateError } = await admin
      .from('profiles')
      .update(row)
      .eq('id', userId)
      .select(PROFILE_COLUMNS)
      .single();
    if (updateError) throw updateError;
    return { profile: data as ProfileRow, firstLogin };
  }

  const { data, error: insertError } = await admin
    .from('profiles')
    .insert({ id: userId, created_at: now, ...row })
    .select(PROFILE_COLUMNS)
    .single();
  if (insertError) throw insertError;
  return { profile: data as ProfileRow, firstLogin };
}

async function mintSession(admin: SupabaseClient, email: string) {
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email,
  });
  if (linkError || !link?.properties?.hashed_token) {
    throw linkError || new Error('Could not start a session.');
  }

  const { data, error: verifyError } = await anonClient().auth.verifyOtp({
    token_hash: link.properties.hashed_token,
    type: 'magiclink',
  });
  if (verifyError || !data?.session) {
    throw verifyError || new Error('Could not start a session.');
  }

  const session = data.session;
  return {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_in: session.expires_in,
    expires_at: session.expires_at,
    token_type: session.token_type,
  };
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
    appRole: row.app_role || '',
    isSystemAdmin: Boolean(row.is_system_admin),
    isActive: Boolean(row.is_active),
    pinnedTools: Array.isArray(row.pinned_tools) ? row.pinned_tools : null,
    appsView: row.apps_view || null,
    lastLoginAt: row.last_login_at || null,
    createdAt: row.created_at || null,
  };
}

async function applyDirectoryToProfiles(admin: SupabaseClient, directory: unknown[]): Promise<number> {
  if (!directory.length) return 0;
  const { data: profiles, error: listError } = await admin
    .from('profiles')
    .select('id, aureus_user_id, aureus_login, email, app_role, is_system_admin');
  if (listError) throw listError;

  const now = new Date().toISOString();
  let updated = 0;
  await Promise.all(
    (profiles || []).map(async (profile) => {
      const match = findEmployeeRecord(directory, {
        aureusUserId: String(profile.aureus_user_id || ''),
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
      const locked = Boolean(profile.is_system_admin) || profile.app_role === 'system_admin';
      if (!locked) patch.app_role = inferAppRole(identity.role, identity.employeeType);
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

  let aureus;
  try {
    aureus = await loginToPos(AUREUS_BASE_URL, login, password);
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

  let directory: unknown[] = [];
  try {
    const [byId, rows] = await Promise.all([
      fetchEmployeeById(aureus.baseUrl, aureus.token, identity.aureusUserId),
      fetchEmployeeDirectory(aureus.baseUrl, aureus.token),
    ]);
    directory = rows;
    const employee = byId || findEmployeeRecord(directory, identity);
    if (employee) identity = mergeEmployeeIntoIdentity(identity, employee);
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
      await applyDirectoryToProfiles(admin, directory).catch((err) => {
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
    supabaseSession = await mintSession(admin, email);
  } catch (err) {
    console.error('session mint failed', err instanceof Error ? err.message : err);
    return error(req, 500, 'Could not start your session. Try again.', 'session_failed');
  }

  const linked = isEmailLogin(aureus.login) ? await loginLinkedPosSystems() : {};

  await recordAttempt(admin, ipHash, loginHash, true);

  return json(req, 200, {
    supabase: supabaseSession,
    aureus: {
      token: aureus.token,
      user: identity.payload,
      login: aureus.login,
      baseUrl: aureus.baseUrl,
    },
    linked,
    profile: publicProfile(profile),
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

  const linked = isEmailLogin(String(profile.aureus_login || '')) ? await loginLinkedPosSystems() : {};
  return json(req, 200, { linked });
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

  let directory: unknown[] = [];
  try {
    directory = await fetchEmployeeDirectory(AUREUS_BASE_URL, aureusToken);
  } catch (err) {
    console.error('sync-staff directory failed', err instanceof Error ? err.message : err);
    return error(req, 502, 'Could not load employees from Aureus.', 'pos_unavailable');
  }

  try {
    const updated = await applyDirectoryToProfiles(staff.admin, directory);
    const { data: profile, error: profileError } = await staff.admin
      .from('profiles')
      .select(PROFILE_COLUMNS)
      .eq('id', staff.userId)
      .single();
    if (profileError || !profile) {
      return json(req, 200, { updated, profile: null });
    }
    return json(req, 200, { updated, profile: publicProfile(profile as ProfileRow) });
  } catch (err) {
    console.error('sync-staff update failed', err instanceof Error ? err.message : err);
    return error(req, 500, 'Could not update staff roles.', 'sync_failed');
  }
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
      default:
        return error(req, 400, 'Unknown action.', 'bad_request');
    }
  } catch (err) {
    console.error('aureus-login unhandled', err instanceof Error ? err.message : err);
    return error(req, 500, 'Sign-in failed. Try again.', 'internal');
  }
});
