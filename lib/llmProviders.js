/**
 * Chat-completion transport. All providers are reached through the
 * authenticated `proxy` Edge Function; vendor keys never live in the app.
 */
import { getProviderApiKey } from './aiKeys';
import { ProxyError, proxyFetch } from './proxy';

/** Map picker keys → native Anthropic Messages API model IDs. */
const ANTHROPIC_NATIVE_IDS = {
  'anthropic/claude-opus-5': 'claude-opus-5',
  'anthropic/claude-opus-5-fast': 'claude-opus-5',
  'anthropic/claude-sonnet-5': 'claude-sonnet-5',
  'anthropic/claude-fable-5': 'claude-fable-5',
  'anthropic/claude-opus-4.8': 'claude-opus-4-8',
  'anthropic/claude-opus-4.8-fast': 'claude-opus-4-8',
  'anthropic/claude-opus-4.7': 'claude-opus-4-7',
  'anthropic/claude-opus-4.6': 'claude-opus-4-6',
  'anthropic/claude-sonnet-4.6': 'claude-sonnet-4-6',
  'anthropic/claude-haiku-4.5': 'claude-haiku-4-5',
  'anthropic/claude-sonnet-4.5': 'claude-sonnet-4-5',
  'anthropic/claude-opus-4.5': 'claude-opus-4-5',
};

/** Map picker keys → native OpenAI Chat Completions model IDs. */
const OPENAI_NATIVE_IDS = {
  'openai/gpt-4o': 'gpt-4o',
  'openai/gpt-4o-mini': 'gpt-4o-mini',
  'openai/gpt-4.1': 'gpt-4.1',
  'openai/gpt-4.1-mini': 'gpt-4.1-mini',
  'openai/gpt-4.1-nano': 'gpt-4.1-nano',
};

export function getDirectProvider(modelKey) {
  const key = String(modelKey || '');
  if (key.startsWith('anthropic/') || key.startsWith('claude-')) return 'anthropic';
  if (key.startsWith('openai/') || key.startsWith('gpt-')) return 'openai';
  return 'openrouter';
}

export function toNativeModelId(modelKey) {
  const key = String(modelKey || '');
  const provider = getDirectProvider(key);

  if (provider === 'anthropic') {
    if (ANTHROPIC_NATIVE_IDS[key]) return ANTHROPIC_NATIVE_IDS[key];
    return key
      .replace(/^anthropic\//, '')
      .replace(/-fast$/i, '')
      .replace(/(\d)\.(\d)/g, '$1-$2');
  }

  if (provider === 'openai') {
    if (OPENAI_NATIVE_IDS[key]) return OPENAI_NATIVE_IDS[key];
    return key.replace(/^openai\//, '');
  }

  return key;
}

const PROVIDER_PATHS = {
  anthropic: 'anthropic/v1/messages',
  openai: 'openai/v1/chat/completions',
  openrouter: 'openrouter/v1/chat/completions',
};

const PROVIDER_LABELS = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  openrouter: 'OpenRouter',
};

/**
 * POSTs a provider request through the proxy. A personal key from Settings is
 * forwarded when present; otherwise the proxy uses the company key.
 */
async function providerRequest(provider, { headers, body, signal }) {
  const label = PROVIDER_LABELS[provider];
  try {
    return await proxyFetch(PROVIDER_PATHS[provider], {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', ...headers },
      body: JSON.stringify(body),
      signal,
      upstreamApiKey: await getProviderApiKey(provider),
    });
  } catch (error) {
    if (error?.name === 'AbortError' || error instanceof ProxyError) throw error;
    throw new Error(`Could not reach ${label}. Check your connection and try again.`);
  }
}

async function readErrorMessage(response, fallbackLabel) {
  try {
    const payload = await response.json();
    return (
      payload?.error?.message ||
      payload?.message ||
      payload?.error?.type ||
      `${fallbackLabel} error ${response.status}`
    );
  } catch {
    return `${fallbackLabel} error ${response.status}`;
  }
}

function parseDataUrl(dataUrl) {
  const match = String(dataUrl || '').match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) return null;
  return { mediaType: match[1], data: match[2] };
}

function openAIContentToAnthropic(content) {
  if (typeof content === 'string') {
    return [{ type: 'text', text: content }];
  }
  if (!Array.isArray(content)) return [{ type: 'text', text: String(content || '') }];

  return content
    .map((part) => {
      if (part?.type === 'text') {
        return { type: 'text', text: part.text || '' };
      }
      if (part?.type === 'image_url') {
        const url = part.image_url?.url || part.imageUrl?.url;
        const parsed = parseDataUrl(url);
        if (parsed) {
          return {
            type: 'image',
            source: {
              type: 'base64',
              media_type: parsed.mediaType,
              data: parsed.data,
            },
          };
        }
        if (/^https:\/\//i.test(String(url || ''))) {
          return { type: 'image', source: { type: 'url', url } };
        }
        return null;
      }
      return null;
    })
    .filter(Boolean);
}

function toAnthropicMessages(messages) {
  return (messages || []).map((message) => ({
    role: message.role === 'assistant' ? 'assistant' : 'user',
    content: openAIContentToAnthropic(message.content),
  }));
}

async function readOpenAICompatibleStream(response, onDelta) {
  if (!response.body?.getReader) {
    throw new Error('Streaming is not supported in this environment');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data:')) continue;
      const data = trimmed.slice(5).trim();
      if (!data || data === '[DONE]') continue;

      try {
        const chunk = JSON.parse(data);
        const content = chunk.choices?.[0]?.delta?.content;
        if (content) {
          full += content;
          onDelta?.(full, content);
        }
      } catch {
        // ignore malformed chunks
      }
    }
  }

  return full.trim();
}

async function readAnthropicStream(response, onDelta) {
  if (!response.body?.getReader) {
    throw new Error('Streaming is not supported in this environment');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';
  let stopReason = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data:')) continue;
      const data = trimmed.slice(5).trim();
      if (!data || data === '[DONE]') continue;

      let event;
      try {
        event = JSON.parse(data);
      } catch {
        continue;
      }

      if (event?.type === 'error') {
        throw new Error(event.error?.message || 'Anthropic stream error');
      }

      if (event?.type === 'message_delta' && event?.delta?.stop_reason) {
        stopReason = event.delta.stop_reason;
      }

      if (event?.type === 'content_block_delta' && event?.delta?.type === 'text_delta') {
        const content = event.delta.text || '';
        if (content) {
          full += content;
          onDelta?.(full, content);
        }
      }
    }
  }

  const text = full.trim();
  if (!text) {
    throw new Error(
      stopReason === 'max_tokens'
        ? 'Anthropic ran out of tokens before returning text (often used by thinking). Try a higher max token budget or a shorter prompt.'
        : 'Anthropic returned no text. Check the API key and model, then retry.'
    );
  }
  return text;
}

function anthropicOutputBudget(model, maxTokens) {
  const nativeModel = toNativeModelId(model);
  const requested = Number(maxTokens) || 0;
  // Thinking tokens count against max_tokens. Adaptive thinking on Claude 5
  // (and extended thinking on 4.x) can spend 4k–8k+ before any visible text.
  if (/claude-(?:opus|sonnet|fable|mythos)-5/i.test(nativeModel)) {
    return Math.max(requested, 16384);
  }
  if (/claude-(?:opus|sonnet|haiku)-4/i.test(nativeModel)) {
    return Math.max(requested, 8192);
  }
  return requested;
}

function anthropicRequestBody({ model, messages, maxTokens }) {
  const nativeModel = toNativeModelId(model);
  // Claude 5+ uses adaptive thinking by default (omit `thinking`; `type: "disabled"`
  // is rejected on adaptive-only models).
  return {
    model: nativeModel,
    max_tokens: anthropicOutputBudget(model, maxTokens),
    stream: true,
    messages: toAnthropicMessages(messages),
  };
}

async function streamAnthropic({ model, messages, onDelta, signal, maxTokens }) {
  const response = await providerRequest('anthropic', {
    headers: { 'anthropic-version': '2023-06-01' },
    body: anthropicRequestBody({ model, messages, maxTokens }),
    signal,
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Anthropic'));
  }

  return readAnthropicStream(response, onDelta);
}

async function streamOpenAI({ model, messages, onDelta, signal, maxTokens }) {
  const response = await providerRequest('openai', {
    body: {
      model: toNativeModelId(model),
      messages,
      stream: true,
      max_tokens: maxTokens,
    },
    signal,
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'OpenAI'));
  }

  return readOpenAICompatibleStream(response, onDelta);
}

async function streamOpenRouter({ model, messages, onDelta, signal, maxTokens }) {
  const response = await providerRequest('openrouter', {
    body: {
      model,
      messages,
      stream: true,
      max_tokens: maxTokens,
      provider: { sort: 'latency' },
    },
    signal,
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'OpenRouter'));
  }

  return readOpenAICompatibleStream(response, onDelta);
}

/**
 * Route chat completions:
 * - anthropic/* → Anthropic Messages API
 * - openai/* → OpenAI Chat Completions
 * - everything else → OpenRouter
 * All via the authenticated proxy.
 */
export async function streamChatCompletion({
  model,
  messages,
  onDelta,
  signal,
  maxTokens = 700,
} = {}) {
  const provider = getDirectProvider(model);

  if (provider === 'anthropic') {
    return streamAnthropic({ model, messages, onDelta, signal, maxTokens });
  }
  if (provider === 'openai') {
    return streamOpenAI({ model, messages, onDelta, signal, maxTokens });
  }
  return streamOpenRouter({ model, messages, onDelta, signal, maxTokens });
}
