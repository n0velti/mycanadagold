/**
 * Resolves the calling staff member from a Supabase JWT and confirms they are
 * an active, Aureus-verified profile. Used by every authenticated function.
 */
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SECRET_KEY') ?? '';
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY') ?? '';

const PROFILE_CACHE_TTL_MS = 60_000;

export interface StaffContext {
  userId: string;
  aureusUserId: string;
  isSystemAdmin: boolean;
  appRole: string;
}

export class StaffAuthError extends Error {
  status: number;
  code: string;
  constructor(message: string, status: number, code: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

let admin: SupabaseClient | null = null;

export function adminClient(): SupabaseClient {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    throw new Error('Edge Function is missing SUPABASE_URL or the service role key.');
  }
  if (!admin) {
    admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return admin;
}

interface CachedProfile {
  expiresAt: number;
  context: StaffContext | null;
}

const profileCache = new Map<string, CachedProfile>();

async function loadProfile(userId: string, aureusUserId: string): Promise<StaffContext | null> {
  const cached = profileCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.context;

  const { data, error } = await adminClient()
    .from('profiles')
    .select('id, aureus_user_id, is_active, aureus_verified_at, app_role, is_system_admin')
    .eq('id', userId)
    .maybeSingle();

  let context: StaffContext | null = null;
  if (!error && data && data.is_active && data.aureus_verified_at && data.aureus_user_id === aureusUserId) {
    context = {
      userId,
      aureusUserId: data.aureus_user_id,
      isSystemAdmin: Boolean(data.is_system_admin) || data.app_role === 'system_admin',
      appRole: String(data.app_role || ''),
    };
  }

  profileCache.set(userId, { expiresAt: Date.now() + PROFILE_CACHE_TTL_MS, context });
  if (profileCache.size > 5000) {
    const now = Date.now();
    for (const [key, entry] of profileCache) {
      if (entry.expiresAt <= now) profileCache.delete(key);
    }
  }
  return context;
}

/**
 * Verifies the bearer JWT and returns the active staff context, or throws a
 * StaffAuthError with the HTTP status to send back.
 */
export async function requireActiveStaff(req: Request): Promise<StaffContext> {
  const header = req.headers.get('authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  const jwt = match ? match[1].trim() : '';
  if (!jwt || jwt === ANON_KEY) {
    throw new StaffAuthError('Sign in first.', 401, 'unauthenticated');
  }

  const { data, error } = await adminClient().auth.getClaims(jwt);
  if (error || !data?.claims?.sub) {
    throw new StaffAuthError('Session expired. Sign in again.', 401, 'unauthenticated');
  }

  const claims = data.claims as Record<string, unknown>;
  const appMetadata = (claims.app_metadata || {}) as Record<string, unknown>;
  if (appMetadata.provider !== 'aureus' || typeof appMetadata.aureus_user_id !== 'string') {
    throw new StaffAuthError('This account was not verified with Aureus.', 403, 'forbidden');
  }

  const context = await loadProfile(String(claims.sub), appMetadata.aureus_user_id);
  if (!context) {
    throw new StaffAuthError('Your MyCanadaGold access has been disabled.', 403, 'deactivated');
  }
  return context;
}
