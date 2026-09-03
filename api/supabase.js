import { AppState, Platform } from 'react-native';
import { createClient } from '@supabase/supabase-js';
import { createSecureAuthStorage } from './secureAuthStorage';

export const SUPABASE_PROJECT_URL = 'https://bkvyyddtevzvuanzkobd.supabase.co';

const supabaseUrlFromEnv = process.env.EXPO_PUBLIC_SUPABASE_URL;
const publishableKeyFromEnv = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const anonKeyFromEnv = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

let client = null;
let appStateBound = false;

function decodeJwtPayload(token) {
  const part = String(token || '').split('.')[1];
  if (!part) return null;
  const padded = part.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (part.length % 4)) % 4);
  try {
    const json =
      typeof atob === 'function'
        ? atob(padded)
        : globalThis.Buffer
          ? globalThis.Buffer.from(padded, 'base64').toString('utf8')
          : null;
    return json ? JSON.parse(json) : null;
  } catch {
    return null;
  }
}

function assertHttpsUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Supabase URL is invalid.');
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('Supabase URL must use HTTPS.');
  }
  return parsed.toString().replace(/\/$/, '');
}

export function getSupabaseUrl() {
  return assertHttpsUrl(String(supabaseUrlFromEnv || SUPABASE_PROJECT_URL).trim());
}

export function describeClientKey(key) {
  const value = String(key || '').trim();
  if (!value) return { kind: 'missing', safe: false };
  if (value.startsWith('sb_secret_')) {
    return { kind: 'secret', safe: false };
  }
  if (value.startsWith('sb_publishable_')) {
    return { kind: 'publishable', safe: true };
  }
  if (value.startsWith('eyJ')) {
    const role = decodeJwtPayload(value)?.role;
    if (role === 'service_role') return { kind: 'service_role', safe: false };
    if (role === 'anon') return { kind: 'anon', safe: true };
    return { kind: 'jwt', safe: false };
  }
  return { kind: 'unknown', safe: false };
}

function getClientKey() {
  const value = String(publishableKeyFromEnv || anonKeyFromEnv || '').trim();
  const described = describeClientKey(value);
  if (described.kind === 'missing') {
    throw new Error(
      'Missing EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY. Add the publishable key from Supabase → Settings → API Keys to .env.local. Never use a secret or service_role key in the app.',
    );
  }
  if (!described.safe) {
    throw new Error(
      'Refusing to use a privileged Supabase key in the client. Use the publishable (or legacy anon) key only.',
    );
  }
  return value;
}

function bindAuthAutoRefresh(supabase) {
  if (appStateBound || Platform.OS === 'web') return;
  appStateBound = true;
  AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      supabase.auth.startAutoRefresh();
    } else {
      supabase.auth.stopAutoRefresh();
    }
  });
}

/** The client-safe key (publishable or legacy anon). Throws on privileged keys. */
export function getPublishableKey() {
  return getClientKey();
}

export function getSupabase() {
  if (client) return client;

  const url = getSupabaseUrl();
  const key = getClientKey();

  client = createClient(url, key, {
    auth: {
      storage: createSecureAuthStorage(),
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: Platform.OS === 'web',
      flowType: 'pkce',
    },
    global: {
      headers: {
        'X-Client-Info': 'mycanadagold-expo',
      },
    },
  });

  bindAuthAutoRefresh(client);
  return client;
}

/**
 * Calls an Edge Function and surfaces the server's error message and code
 * instead of the generic "non-2xx status code" text.
 */
export async function invokeEdgeFunction(name, body) {
  const supabase = getSupabase();
  let result;
  try {
    result = await supabase.functions.invoke(name, { body });
  } catch (error) {
    const wrapped = new Error(error?.message || 'Could not reach the sign-in service.');
    wrapped.code = 'network';
    throw wrapped;
  }

  if (result.error) {
    const response = result.error.context;
    let message = 'Could not reach the sign-in service.';
    let code = 'edge_error';
    let status = 0;
    if (response && typeof response.status === 'number') {
      status = response.status;
      try {
        const payload = await response.json();
        message = payload?.error?.message || payload?.message || message;
        code = payload?.error?.code || code;
      } catch {
        message = status >= 500 ? 'Sign-in service is unavailable. Try again shortly.' : message;
      }
    }
    const error = new Error(message);
    error.code = code;
    error.status = status;
    throw error;
  }

  return result.data;
}

export async function getSupabaseConnectionStatus() {
  const keyInfo = describeClientKey(publishableKeyFromEnv || anonKeyFromEnv);
  const status = {
    url: SUPABASE_PROJECT_URL,
    configured: keyInfo.safe,
    keyKind: keyInfo.kind,
    reachable: false,
    message: '',
  };

  try {
    status.url = getSupabaseUrl();
  } catch (error) {
    status.message = error?.message || 'Supabase URL must use HTTPS.';
    return status;
  }

  if (!keyInfo.safe) {
    status.message =
      keyInfo.kind === 'missing'
        ? 'Add EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY to .env.local, then restart Expo.'
        : 'A privileged key was rejected. Use the publishable key only.';
    return status;
  }

  try {
    const key = getClientKey();
    const headers = { apikey: key };
    if (key.startsWith('eyJ')) {
      headers.Authorization = `Bearer ${key}`;
    }
    const response = await fetch(`${status.url}/auth/v1/health`, {
      method: 'GET',
      headers,
    });
    status.reachable = response.ok;
    status.message = response.ok
      ? 'Connected over HTTPS with a client-safe key. Data access is enforced by RLS.'
      : `Auth endpoint returned HTTP ${response.status}.`;
  } catch (error) {
    status.message = error?.message || 'Could not reach Supabase.';
  }

  return status;
}
