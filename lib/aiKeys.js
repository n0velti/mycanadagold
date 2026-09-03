/**
 * Optional personal AI provider keys. When a key is set here it is forwarded to
 * the proxy for that provider; otherwise the proxy uses the company key held
 * in Edge Function secrets. Keys are stored encrypted on native devices and
 * never bundled into the app.
 */
import { readSecureJson, removeSecure, writeSecureJson } from './secureAuthStorage';

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
    description: 'GPT models',
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

export async function loadAiApiKeys() {
  return sanitizeKeys(await readSecureJson(AI_API_KEYS_STORAGE_KEY, {}));
}

export async function saveAiApiKeys(keys) {
  const sanitized = sanitizeKeys(keys);
  if (Object.values(sanitized).every((value) => !value)) {
    await removeSecure(AI_API_KEYS_STORAGE_KEY);
    return sanitized;
  }
  await writeSecureJson(AI_API_KEYS_STORAGE_KEY, sanitized);
  return sanitized;
}

export async function clearAiApiKeys() {
  await removeSecure(AI_API_KEYS_STORAGE_KEY);
}

/** Personal key for a provider, or '' to let the proxy use the company key. */
export async function getProviderApiKey(provider) {
  const keys = await loadAiApiKeys();
  return keys[provider] || '';
}
