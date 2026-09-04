/**
 * Company AI provider keys. A System Admin or General Manager saves them once
 * in Settings; the proxy then uses them for every signed-in staff member.
 * Regular users never receive the values. Device storage is only a fallback so
 * an admin can republish keys that were previously saved on this phone.
 */
import { hasFullAppAccess, normalizeAppRole } from './permissions';
import { readSecureJson, removeSecure } from './secureAuthStorage';
import { getSupabase } from './supabase';

const AI_API_KEYS_STORAGE_KEY = 'cgold_ai_api_keys';

export const AI_MODEL_PROVIDERS = [
  {
    key: 'openrouter',
    label: 'OpenRouter',
    description: 'Open / NVIDIA / Qwen / Llama / Gemma models in Serphint and AI chat',
    placeholder: 'sk-or-v1-…',
  },
  {
    key: 'anthropic',
    label: 'Anthropic',
    description: 'Claude models',
    placeholder: 'sk-ant-…',
  },
  {
    key: 'openai',
    label: 'OpenAI',
    description: 'GPT models and Canada Gold portraits',
    placeholder: 'sk-…',
  },
];

const PROVIDER_KEYS = new Set(AI_MODEL_PROVIDERS.map((provider) => provider.key));

const emptyKeys = () =>
  Object.fromEntries(AI_MODEL_PROVIDERS.map((provider) => [provider.key, '']));

function sanitizeKeys(keys) {
  const next = emptyKeys();
  if (!keys || typeof keys !== 'object') return next;
  for (const [provider, value] of Object.entries(keys)) {
    if (!PROVIDER_KEYS.has(provider)) continue;
    next[provider] = String(value || '').trim().slice(0, 512);
  }
  return next;
}

function keysFromRows(rows) {
  const next = emptyKeys();
  for (const row of rows || []) {
    const provider = String(row?.provider || '').trim();
    if (!PROVIDER_KEYS.has(provider)) continue;
    next[provider] = String(row?.api_key || '').trim().slice(0, 512);
  }
  return next;
}

function hasAnyKey(keys) {
  return Object.values(keys || {}).some((value) => Boolean(value));
}

function isMissingRelation(error) {
  const code = String(error?.code || '');
  const message = String(error?.message || '');
  if (code === '42P01' || code === 'PGRST205') return true;
  return /schema cache/i.test(message) && /company_ai_keys/i.test(message);
}

function isPermissionError(error) {
  const code = String(error?.code || '');
  const message = String(error?.message || '');
  return code === '42501' || code === 'PGRST301' || /permission denied|row-level security/i.test(message);
}

function describeAiKeysError(error, action = 'load') {
  if (!error) return `Could not ${action} API keys.`;
  if (isMissingRelation(error)) {
    return 'Run the company AI keys SQL in Supabase, including the schema reload line, then refresh.';
  }
  if (error.code === 'NO_SESSION') {
    return error.message;
  }
  if (isPermissionError(error)) {
    return 'Only a System Admin or General Manager can view or change company AI keys.';
  }
  return error.message || `Could not ${action} API keys.`;
}

export function canManageCompanyAiKeys(profile) {
  if (hasFullAppAccess(profile)) return true;
  return normalizeAppRole(profile?.appRole) === 'general_manager';
}

async function requireAiKeysClient() {
  const supabase = getSupabase();
  const { data } = await supabase.auth.getSession();
  if (!data?.session?.user?.id) {
    const error = new Error('Sign out and sign in again so company AI keys can load.');
    error.code = 'NO_SESSION';
    throw error;
  }
  return supabase;
}

async function loadLocalAiApiKeys() {
  return sanitizeKeys(await readSecureJson(AI_API_KEYS_STORAGE_KEY, {}));
}

/**
 * Loads keys for the Settings editor. Prefer the company table; if it is empty,
 * show this device's old personal keys so an admin can save them for everyone.
 */
export async function loadCompanyAiKeyState() {
  const local = await loadLocalAiApiKeys();
  try {
    const supabase = await requireAiKeysClient();
    const { data, error } = await supabase.from('company_ai_keys').select('provider, api_key');
    if (error) throw error;
    const company = keysFromRows(data);
    if (hasAnyKey(company)) {
      return { keys: company, shared: true, unavailable: false };
    }
    return { keys: local, shared: false, unavailable: false };
  } catch (error) {
    if (isMissingRelation(error)) {
      return { keys: local, shared: false, unavailable: true };
    }
    throw new Error(describeAiKeysError(error, 'load'));
  }
}

export async function loadAiApiKeys() {
  return (await loadCompanyAiKeyState()).keys;
}

export async function saveAiApiKeys(keys) {
  const sanitized = sanitizeKeys(keys);
  const supabase = await requireAiKeysClient();
  const { data: authData } = await supabase.auth.getSession();
  const actorId = authData?.session?.user?.id || null;
  const now = new Date().toISOString();

  const rows = AI_MODEL_PROVIDERS.map((provider) => provider.key)
    .filter((provider) => sanitized[provider])
    .map((provider) => ({
      provider,
      api_key: sanitized[provider],
      updated_at: now,
      updated_by: actorId,
    }));
  const toDelete = AI_MODEL_PROVIDERS.map((provider) => provider.key).filter(
    (provider) => !sanitized[provider],
  );

  if (rows.length) {
    const { error } = await supabase.from('company_ai_keys').upsert(rows, { onConflict: 'provider' });
    if (error) throw new Error(describeAiKeysError(error, 'save'));
  }
  if (toDelete.length) {
    const { error } = await supabase.from('company_ai_keys').delete().in('provider', toDelete);
    if (error) throw new Error(describeAiKeysError(error, 'save'));
  }

  await removeSecure(AI_API_KEYS_STORAGE_KEY);
  return sanitized;
}

export async function clearAiApiKeys() {
  await saveAiApiKeys(emptyKeys());
}
