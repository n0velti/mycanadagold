/**
 * Join for company Workspace domains (GOOGLE_MAIL_HOSTED_DOMAIN plus
 * @canadagold.ca and @cdncoin.com).
 *
 * The temporary password signs the person in, but aureus_verified_at stays
 * null and the JWT has no aureus_user_id until they replace it. That is the
 * same pair is_active_staff() already requires, so the temporary password
 * cannot read staff data. An address that already belongs to an Aureus login
 * is refused — join must not rotate that account's server-held password.
 */
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { bearerToken, clientIp, error, json, sha256Hex } from './http.ts';
import { allowedJoinDomains, companyJoinEmail, joinEmailHint, sendTemporaryPassword } from './joinMail.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SECRET_KEY') ?? '';
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY') ?? '';

const THROTTLE_WINDOW = '15 minutes';
const MAX_JOIN_PER_EMAIL = 5;
const MAX_JOIN_PER_IP = 20;

interface JoinBody {
  email?: string;
  password?: string;
}

interface JoinProfile {
  id: string;
  aureus_user_id: string;
  is_active: boolean;
  must_set_password?: boolean;
  aureus_verified_at?: string | null;
  email?: string | null;
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

function fail(err: unknown, fallback: string): { status: number; message: string; code: string } {
  const detail = err as { status?: number; message?: string; code?: string; smtp?: number } | null;
  if (detail?.smtp) console.error('join mail smtp', detail.smtp);
  else if (detail?.message) console.error('email join', detail.message);
  return {
    status: detail?.status && detail.status >= 400 && detail.status < 600 ? detail.status : 500,
    message: detail?.status ? detail.message || fallback : fallback,
    code: detail?.code || 'join_failed',
  };
}

function emailStaffId(userId: string): string {
  return `email:${userId}`;
}

function temporaryPassword(): string {
  const lower = 'abcdefghijkmnpqrstuvwxyz';
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const digits = '23456789';
  const all = lower + upper + digits;
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const chars = Array.from(bytes, (byte, index) => {
    if (index === 0) return upper[byte % upper.length];
    if (index === 1) return lower[byte % lower.length];
    if (index === 2) return digits[byte % digits.length];
    return all[byte % all.length];
  });
  return `${chars.slice(0, 4).join('')}-${chars.slice(4, 8).join('')}-${chars.slice(8).join('')}`;
}

function passwordProblem(password: string): string | null {
  if (!password || !password.trim()) return 'Choose a password.';
  if (new TextEncoder().encode(password).length > 72) return 'That password is too long.';
  if (password.length < 12 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) {
    return 'Use at least 12 characters, with an uppercase letter, a lowercase letter, and a number.';
  }
  return null;
}

function joinMetadata(userId: string, email: string, ready: boolean): Record<string, unknown> {
  if (!ready) {
    return {
      staff_kind: 'email',
      must_set_password: true,
      aureus_user_id: '',
      aureus_login: email,
    };
  }
  return {
    staff_kind: 'email',
    must_set_password: false,
    aureus_user_id: emailStaffId(userId),
    aureus_login: email,
  };
}

async function throttleJoin(admin: SupabaseClient, ipHash: string, emailHash: string): Promise<boolean> {
  const { data, error: rpcError } = await admin.rpc('login_attempts_recent_failures', {
    p_ip_hash: ipHash,
    p_login_hash: emailHash,
    p_window: THROTTLE_WINDOW,
  });
  if (rpcError) {
    console.error('join throttle failed', rpcError.message);
    return true;
  }
  const row = Array.isArray(data) ? data[0] : data;
  return Number(row?.ip_failures ?? 0) < MAX_JOIN_PER_IP && Number(row?.login_failures ?? 0) < MAX_JOIN_PER_EMAIL;
}

async function recordJoin(admin: SupabaseClient, ipHash: string, emailHash: string, succeeded: boolean): Promise<void> {
  const { error: insertError } = await admin
    .from('login_attempts')
    .insert({ ip_hash: ipHash, login_hash: emailHash, succeeded });
  if (insertError) console.error('join attempt log failed', insertError.message);
}

async function loadJoinAccount(admin: SupabaseClient, email: string) {
  const found = await admin.rpc('auth_user_id_for_email', { p_email: email });
  if (found.error) throw found.error;
  const userId = (found.data as string | null) || '';
  if (!userId) return null;
  const userResult = await admin.auth.admin.getUserById(userId);
  if (userResult.error || !userResult.data?.user) {
    throw userResult.error || new Error('Could not load that account.');
  }
  const profileResult = await admin
    .from('profiles')
    .select('id, aureus_user_id, is_active, must_set_password, aureus_verified_at, email')
    .eq('id', userId)
    .maybeSingle();
  if (profileResult.error && /must_set_password/i.test(profileResult.error.message || '')) {
    throw Object.assign(new Error('Join is not available yet.'), { status: 503, code: 'join_unconfigured' });
  }
  if (profileResult.error) throw profileResult.error;
  return {
    user: userResult.data.user,
    profile: (profileResult.data as JoinProfile | null) || null,
  };
}

function isEmailJoin(user: { app_metadata?: Record<string, unknown> }, profile: JoinProfile | null): boolean {
  const meta = user.app_metadata || {};
  if (meta.staff_kind === 'email') return true;
  if (String(profile?.aureus_user_id || '').startsWith('email:')) return true;
  // A half-finished create has neither a profile nor an Aureus claim.
  return !profile && !String(meta.aureus_user_id || '').trim();
}

async function provisionEmailProfile(admin: SupabaseClient, userId: string, email: string): Promise<void> {
  const now = new Date().toISOString();
  const local = email.split('@')[0] || email;
  const row = {
    id: userId,
    aureus_user_id: emailStaffId(userId),
    aureus_login: email,
    email,
    first_name: local,
    full_name: local,
    app_role: 'precious_metal_analyst',
    is_active: true,
    is_system_admin: false,
    must_set_password: true,
    aureus_verified_at: null,
    can_view_bonus_data: false,
    created_at: now,
    updated_at: now,
    last_login_at: now,
  };
  const inserted = await admin.from('profiles').insert(row);
  if (!inserted.error) return;
  if (/must_set_password/i.test(inserted.error.message || '')) {
    throw Object.assign(new Error('Join is not available yet.'), { status: 503, code: 'join_unconfigured' });
  }
  throw inserted.error;
}

async function markPasswordPending(admin: SupabaseClient, userId: string): Promise<void> {
  const updated = await admin
    .from('profiles')
    .update({
      must_set_password: true,
      aureus_verified_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', userId);
  if (updated.error) throw updated.error;
}

export async function handleEmailJoin(req: Request, body: JoinBody): Promise<Response> {
  const email = companyJoinEmail(body.email);
  if (!email) {
    return error(req, 400, joinEmailHint(), 'bad_email');
  }

  const admin = adminClient();
  const ipHash = await sha256Hex(`ip:${clientIp(req)}`);
  const emailHash = await sha256Hex(`join:${email}`);
  if (!(await throttleJoin(admin, ipHash, emailHash))) {
    return error(req, 429, 'Too many attempts. Try again in 15 minutes.', 'throttled');
  }

  try {
    const existing = await loadJoinAccount(admin, email);
    const password = temporaryPassword();

    if (existing) {
      if (!existing.profile?.is_active && existing.profile) {
        await recordJoin(admin, ipHash, emailHash, false);
        return error(req, 403, 'Your MyCanadaGold access has been disabled. Contact a system admin.', 'deactivated');
      }
      if (!isEmailJoin(existing.user, existing.profile)) {
        await recordJoin(admin, ipHash, emailHash, false);
        return error(
          req,
          409,
          'This email already has a MyCanadaGold account. Log in with your user id and password.',
          'account_exists',
        );
      }
      if (existing.profile?.aureus_verified_at && existing.profile.must_set_password === false) {
        await recordJoin(admin, ipHash, emailHash, false);
        return error(req, 409, 'This email already has an account. Log in with your email and password.', 'account_exists');
      }
      const userId = existing.user.id;
      const updated = await admin.auth.admin.updateUserById(userId, {
        password,
        email_confirm: true,
        app_metadata: joinMetadata(userId, email, false),
      });
      if (updated.error) throw updated.error;
      if (!existing.profile) await provisionEmailProfile(admin, userId, email);
      else await markPasswordPending(admin, userId);
      await sendTemporaryPassword(admin, email, password);
      await recordJoin(admin, ipHash, emailHash, true);
      return json(req, 200, { ok: true });
    }

    const created = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      password,
      app_metadata: {
        staff_kind: 'email',
        must_set_password: true,
      },
      user_metadata: { source: 'email_join' },
    });
    if (created.error || !created.data?.user) {
      throw created.error || new Error('Could not create that account.');
    }
    const userId = created.data.user.id;
    try {
      await provisionEmailProfile(admin, userId, email);
      await sendTemporaryPassword(admin, email, password);
    } catch (err) {
      if (!existing) {
        // A profile-less auth user would block the next attempt.
        const profile = await admin.from('profiles').select('id').eq('id', userId).maybeSingle();
        if (!profile.data) await admin.auth.admin.deleteUser(userId);
      }
      throw err;
    }
    await recordJoin(admin, ipHash, emailHash, true);
    return json(req, 200, { ok: true });
  } catch (err) {
    await recordJoin(admin, ipHash, emailHash, false);
    const wrapped = fail(err, 'Could not email that temporary password. Try again.');
    return error(req, wrapped.status, wrapped.message, wrapped.code);
  }
}

function publicJoinProfile(row: Record<string, unknown>) {
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
    teamName: '',
    isTeamIntake: Boolean(row.is_team_intake),
    appRole: row.app_role || '',
    allowedAppRoles: Array.isArray(row.allowed_app_roles) ? row.allowed_app_roles : [],
    isSystemAdmin: Boolean(row.is_system_admin),
    isActive: row.is_active !== false,
    canViewBonusData: false,
    bonusEmployeeVisibility: {},
    pinnedTools: Array.isArray(row.pinned_tools) ? row.pinned_tools : null,
    appsView: row.apps_view || null,
    lastLoginAt: row.last_login_at || null,
    createdAt: row.created_at || null,
  };
}

export async function handleSetEmailPassword(req: Request, body: JoinBody): Promise<Response> {
  const problem = passwordProblem(String(body.password || ''));
  if (problem) return error(req, 400, problem, 'weak_password');

  const jwt = bearerToken(req);
  if (!jwt || jwt === ANON_KEY) return error(req, 401, 'Sign in with the temporary password first.', 'unauthenticated');

  const admin = adminClient();
  const userResult = await admin.auth.getUser(jwt);
  if (userResult.error || !userResult.data?.user) {
    return error(req, 401, 'That temporary sign-in expired. Log in again.', 'unauthenticated');
  }
  const user = userResult.data.user;
  const meta = (user.app_metadata || {}) as Record<string, unknown>;
  if (meta.staff_kind !== 'email' || meta.must_set_password !== true) {
    return error(req, 403, 'This account does not need a new password.', 'forbidden');
  }
  const email = companyJoinEmail(user.email);
  if (!email) return error(req, 403, 'This account cannot set a password here.', 'forbidden');

  const profileResult = await admin
    .from('profiles')
    .select('id, aureus_user_id, is_active, must_set_password')
    .eq('id', user.id)
    .maybeSingle();
  if (profileResult.error || !profileResult.data) {
    return error(req, 403, 'No staff profile for this account.', 'forbidden');
  }
  const profile = profileResult.data as JoinProfile;
  if (!profile.is_active) {
    return error(req, 403, 'Your MyCanadaGold access has been disabled. Contact a system admin.', 'deactivated');
  }
  if (!isEmailJoin(user, profile)) {
    return error(req, 403, 'This account cannot set a password here.', 'forbidden');
  }

  const password = String(body.password);
  const updated = await admin.auth.admin.updateUserById(user.id, {
    password,
    email_confirm: true,
    app_metadata: joinMetadata(user.id, email, true),
  });
  if (updated.error) {
    console.error('set-password failed', updated.error.message);
    return error(req, 400, 'Could not save that password. Try a different one.', 'weak_password');
  }

  const now = new Date().toISOString();
  const saved = await admin
    .from('profiles')
    .update({
      must_set_password: false,
      aureus_verified_at: now,
      aureus_user_id: emailStaffId(user.id),
      aureus_login: email,
      email,
      last_login_at: now,
      updated_at: now,
    })
    .eq('id', user.id);
  if (saved.error) {
    console.error('set-password profile', saved.error.message);
    return error(req, 500, 'Your password was saved. Sign in with it.', 'session_failed');
  }

  const signed = await anonClient().auth.signInWithPassword({ email, password });
  if (signed.error || !signed.data?.session) {
    return error(req, 500, 'Your password was saved. Sign in with it.', 'session_failed');
  }

  const fresh = await admin
    .from('profiles')
    .select('id, aureus_user_id, aureus_login, email, first_name, last_name, full_name, role, employee_type, location_id, location_name, app_role, allowed_app_roles, is_system_admin, is_active, pinned_tools, apps_view, avatar_url, team_id, is_team_intake, last_login_at, created_at')
    .eq('id', user.id)
    .single();
  if (fresh.error || !fresh.data) {
    return error(req, 500, 'Your password was saved. Sign in with it.', 'session_failed');
  }

  const session = signed.data.session;
  return json(req, 200, {
    supabase: {
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_in: session.expires_in,
      expires_at: session.expires_at,
      token_type: session.token_type,
    },
    profile: publicJoinProfile(fresh.data as Record<string, unknown>),
  });
}
