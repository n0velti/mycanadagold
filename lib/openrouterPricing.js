import { proxyJson } from './proxy';

const CACHE_MS = 6 * 60 * 60 * 1000;

const FALLBACK_PRICES = new Map([
  ['anthropic/claude-sonnet-5', { prompt: '0.000002', completion: '0.00001' }],
  ['anthropic/claude-sonnet-4.6', { prompt: '0.000003', completion: '0.000015' }],
  ['anthropic/claude-haiku-4.5', { prompt: '0.000001', completion: '0.000005' }],
  ['x-ai/grok-4.7', { prompt: '0.000002', completion: '0.000006' }],
  ['x-ai/grok-4.6', { prompt: '0.000002', completion: '0.000006' }],
  ['x-ai/grok-4.20', { prompt: '0.00000125', completion: '0.0000025' }],
  ['x-ai/grok-4.3', { prompt: '0.00000125', completion: '0.0000025' }],
  ['openai/gpt-4.1', { prompt: '0.000002', completion: '0.000008' }],
  ['openai/gpt-4.1-mini', { prompt: '0.0000004', completion: '0.0000016' }],
  ['openai/gpt-4o-mini', { prompt: '0.00000015', completion: '0.0000006' }],
]);

let cache = {
  at: 0,
  byId: new Map(FALLBACK_PRICES),
  pending: null,
};

export function readOpenRouterUsage(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const promptTokens = Math.max(0, Number(raw.prompt_tokens) || 0);
  const completionTokens = Math.max(0, Number(raw.completion_tokens) || 0);
  const cost = Number(raw.cost);
  if (!promptTokens && !completionTokens && !Number.isFinite(cost)) return null;
  return {
    promptTokens,
    completionTokens,
    cost: Number.isFinite(cost) && cost >= 0 ? cost : undefined,
  };
}

export function addUsage(left, right) {
  if (!left) return right || null;
  if (!right) return left;
  const cost =
    left.cost == null && right.cost == null
      ? undefined
      : (Number(left.cost) || 0) + (Number(right.cost) || 0);
  return {
    promptTokens: (left.promptTokens || 0) + (right.promptTokens || 0),
    completionTokens: (left.completionTokens || 0) + (right.completionTokens || 0),
    cost,
  };
}

export function modelRates(byId, modelKey) {
  const row = byId?.get(modelKey);
  if (!row) return null;
  const prompt = Number(row.prompt);
  const completion = Number(row.completion);
  if (!Number.isFinite(prompt) || !Number.isFinite(completion)) return null;
  return { prompt, completion };
}

export function priceUsage(usage, modelKey, byId) {
  if (!usage) return null;
  const rates = modelRates(byId, modelKey);
  const promptTokens = usage.promptTokens || 0;
  const completionTokens = usage.completionTokens || 0;
  const promptEst = rates ? promptTokens * rates.prompt : 0;
  const completionEst = rates ? completionTokens * rates.completion : 0;
  const estimated = promptEst + completionEst;
  const billed = Number(usage.cost);
  const hasBill = Number.isFinite(billed) && billed >= 0;
  let promptCost = promptEst;
  let completionCost = completionEst;
  let cost = hasBill ? billed : estimated;
  if (hasBill && estimated > 0) {
    const scale = billed / estimated;
    promptCost = promptEst * scale;
    completionCost = completionEst * scale;
  } else if (hasBill && !estimated) {
    promptCost = 0;
    completionCost = billed;
  }
  return {
    model: modelKey,
    promptTokens,
    completionTokens,
    promptCost,
    completionCost,
    cost,
  };
}

export function storedUsage(usage) {
  if (!usage || typeof usage !== 'object') return null;
  const promptTokens = Math.max(0, Math.round(Number(usage.promptTokens) || 0));
  const completionTokens = Math.max(0, Math.round(Number(usage.completionTokens) || 0));
  const promptCost = Number(usage.promptCost);
  const completionCost = Number(usage.completionCost);
  const cost = Number(usage.cost);
  if (!promptTokens && !completionTokens && !Number.isFinite(cost)) return null;
  const next = {
    model: String(usage.model || '').slice(0, 80),
    promptTokens,
    completionTokens,
  };
  if (Number.isFinite(promptCost) && promptCost >= 0) next.promptCost = promptCost;
  if (Number.isFinite(completionCost) && completionCost >= 0) next.completionCost = completionCost;
  if (Number.isFinite(cost) && cost >= 0) next.cost = cost;
  return next;
}

function formatMoney(value, digits) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return `$${n.toFixed(digits)}`;
}

export function formatUsd(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n < 0.0001) return formatMoney(n, 6);
  if (n < 0.01) return formatMoney(n, 4);
  if (n < 1) return formatMoney(n, 3);
  return formatMoney(n, 2);
}

export function formatPerMillion(perToken) {
  const perM = Number(perToken) * 1e6;
  if (!Number.isFinite(perM)) return '—';
  if (perM === 0) return 'free';
  if (perM < 0.01) return formatMoney(perM, 4);
  if (perM < 1) return formatMoney(perM, 3);
  if (Math.abs(perM - Math.round(perM)) < 0.005) return `$${Math.round(perM)}`;
  return formatMoney(perM, 2);
}

export function formatModelRates(rates) {
  if (!rates) return '';
  return `${formatPerMillion(rates.prompt)} in · ${formatPerMillion(rates.completion)} out / 1M`;
}

export function formatModelRatesShort(rates) {
  if (!rates) return '';
  return `${formatPerMillion(rates.prompt)} / ${formatPerMillion(rates.completion)}`;
}

export function formatTokenCount(count) {
  const n = Math.max(0, Math.round(Number(count) || 0));
  if (!n) return '';
  return n.toLocaleString('en-US');
}

function parseCatalog(payload) {
  const byId = new Map();
  for (const item of payload?.data || []) {
    const id = String(item?.id || '').trim();
    if (!id) continue;
    byId.set(id, {
      prompt: item?.pricing?.prompt,
      completion: item?.pricing?.completion,
    });
  }
  return byId;
}

export function cachedOpenRouterPrices() {
  return cache.byId;
}

export async function loadOpenRouterPrices(modelKeys = []) {
  const now = Date.now();
  const needed = (modelKeys || []).filter(Boolean);
  const haveAll = needed.every((key) => cache.byId.has(key));
  if (haveAll && now - cache.at < CACHE_MS) return cache.byId;
  if (cache.pending) return cache.pending;

  const query = needed.length ? `?ids=${encodeURIComponent(needed.join(','))}` : '';
  cache.pending = proxyJson(`openrouter/v1/models${query}`)
    .then((payload) => {
      cache = { at: Date.now(), byId: parseCatalog(payload), pending: null };
      return cache.byId;
    })
    .catch((error) => {
      cache.pending = null;
      if (cache.byId.size) return cache.byId;
      throw error;
    });
  return cache.pending;
}
