import { streamChatCompletion } from './llmProviders';

export { streamChatCompletion };

/**
 * Curated vision models.
 * Claude → Anthropic direct · GPT → OpenAI direct · everything else → OpenRouter.
 * Speed & accuracy are relative indicators for product ID workloads (not formal benchmarks).
 */
export const OPENROUTER_MODELS = [
  {
    key: 'anthropic/claude-opus-5',
    label: 'Claude Opus 5',
    provider: 'Anthropic',
    supportsVision: true,
    speed: 'Medium',
    accuracy: 'Very high',
    released: '2026-07-24',
    blurb: 'Direct Anthropic API — best stamp reading',
  },
  {
    key: 'anthropic/claude-opus-5-fast',
    label: 'Claude Opus 5 Fast',
    provider: 'Anthropic',
    supportsVision: true,
    speed: 'Fast',
    accuracy: 'Very high',
    released: '2026-07-24',
    blurb: 'Direct Anthropic (maps to Opus 5)',
  },
  {
    key: 'anthropic/claude-sonnet-5',
    label: 'Claude Sonnet 5',
    provider: 'Anthropic',
    supportsVision: true,
    speed: 'Fast',
    accuracy: 'Very high',
    released: '2026-06-30',
    blurb: 'Direct Anthropic — strong speed/detail',
  },
  {
    key: 'anthropic/claude-fable-5',
    label: 'Claude Fable 5',
    provider: 'Anthropic',
    supportsVision: true,
    speed: 'Medium',
    accuracy: 'Very high',
    released: '2026-06-09',
    blurb: 'Direct Anthropic — top capability',
  },
  {
    key: 'anthropic/claude-opus-4.8',
    label: 'Claude Opus 4.8',
    provider: 'Anthropic',
    supportsVision: true,
    speed: 'Medium',
    accuracy: 'Very high',
    released: '2026-05-27',
    blurb: 'Direct Anthropic — prior Opus gen',
  },
  {
    key: 'anthropic/claude-sonnet-4.6',
    label: 'Claude Sonnet 4.6',
    provider: 'Anthropic',
    supportsVision: true,
    speed: 'Fast',
    accuracy: 'High',
    released: '2026-02-17',
    blurb: 'Direct Anthropic — reliable vision',
  },
  {
    key: 'anthropic/claude-haiku-4.5',
    label: 'Claude Haiku 4.5',
    provider: 'Anthropic',
    supportsVision: true,
    speed: 'Very fast',
    accuracy: 'Good',
    released: '2025-10-15',
    blurb: 'Direct Anthropic — fastest Claude',
  },
  {
    key: 'anthropic/claude-sonnet-4.5',
    label: 'Claude Sonnet 4.5',
    provider: 'Anthropic',
    supportsVision: true,
    speed: 'Fast',
    accuracy: 'High',
    released: '2025-09-29',
    blurb: 'Direct Anthropic — proven Sonnet',
  },
  {
    key: 'openai/gpt-4o',
    label: 'GPT-4o',
    provider: 'OpenAI',
    supportsVision: true,
    speed: 'Fast',
    accuracy: 'Very high',
    released: '2024-05-13',
    blurb: 'Direct OpenAI — strong vision OCR',
  },
  {
    key: 'openai/gpt-4o-mini',
    label: 'GPT-4o mini',
    provider: 'OpenAI',
    supportsVision: true,
    speed: 'Very fast',
    accuracy: 'Good',
    released: '2024-07-18',
    blurb: 'Direct OpenAI — cheap & quick',
  },
  {
    key: 'openai/gpt-4.1',
    label: 'GPT-4.1',
    provider: 'OpenAI',
    supportsVision: true,
    speed: 'Fast',
    accuracy: 'Very high',
    released: '2025-04-14',
    blurb: 'Direct OpenAI — latest GPT-4.1',
  },
  {
    key: 'openai/gpt-4.1-mini',
    label: 'GPT-4.1 mini',
    provider: 'OpenAI',
    supportsVision: true,
    speed: 'Very fast',
    accuracy: 'Good',
    released: '2025-04-14',
    blurb: 'Direct OpenAI — fast GPT-4.1',
  },
  {
    key: 'qwen/qwen3-vl-8b-instruct',
    label: 'Qwen3 VL 8B',
    provider: 'OpenRouter',
    supportsVision: true,
    speed: 'Fast',
    accuracy: 'Good',
    released: '2025-10-14',
    blurb: 'OpenRouter — best open speed/quality',
  },
  {
    key: 'qwen/qwen3.5-flash-02-23',
    label: 'Qwen3.5 Flash',
    provider: 'OpenRouter',
    supportsVision: true,
    speed: 'Very fast',
    accuracy: 'Good',
    released: '2026-02-25',
    blurb: 'OpenRouter — lowest latency open VL',
  },
  {
    key: 'google/gemma-3-4b-it',
    label: 'Gemma 3 4B',
    provider: 'OpenRouter',
    supportsVision: true,
    speed: 'Very fast',
    accuracy: 'Fair',
    released: '2025-03-13',
    blurb: 'OpenRouter — tiny & cheap',
  },
  {
    key: 'meta-llama/llama-4-scout',
    label: 'Llama 4 Scout',
    provider: 'OpenRouter',
    supportsVision: true,
    speed: 'Fast',
    accuracy: 'Good',
    released: '2025-04-05',
    blurb: 'OpenRouter — strong open vision',
  },
  {
    key: 'mistralai/mistral-small-3.2-24b-instruct',
    label: 'Mistral Small 3.2',
    provider: 'OpenRouter',
    supportsVision: true,
    speed: 'Fast',
    accuracy: 'Good',
    released: '2025-06-20',
    blurb: 'OpenRouter — solid instruct vision',
  },
  {
    key: 'google/gemma-3-12b-it',
    label: 'Gemma 3 12B',
    provider: 'OpenRouter',
    supportsVision: true,
    speed: 'Fast',
    accuracy: 'Good',
    released: '2025-03-13',
    blurb: 'OpenRouter — mid-size Gemma',
  },
  {
    key: 'qwen/qwen3-vl-30b-a3b-instruct',
    label: 'Qwen3 VL 30B',
    provider: 'OpenRouter',
    supportsVision: true,
    speed: 'Medium',
    accuracy: 'High',
    released: '2025-10-06',
    blurb: 'OpenRouter — better on mixed lots',
  },
  {
    key: 'qwen/qwen3-vl-32b-instruct',
    label: 'Qwen3 VL 32B',
    provider: 'OpenRouter',
    supportsVision: true,
    speed: 'Medium',
    accuracy: 'High',
    released: '2025-10-23',
    blurb: 'OpenRouter — strong detail reading',
  },
  {
    key: 'meta-llama/llama-4-maverick',
    label: 'Llama 4 Maverick',
    provider: 'OpenRouter',
    supportsVision: true,
    speed: 'Medium',
    accuracy: 'High',
    released: '2025-04-05',
    blurb: 'OpenRouter — higher quality Llama',
  },
  {
    key: 'z-ai/glm-4.6v',
    label: 'GLM 4.6V',
    provider: 'OpenRouter',
    supportsVision: true,
    speed: 'Medium',
    accuracy: 'High',
    released: '2025-12-08',
    blurb: 'OpenRouter — careful OCR',
  },
  {
    key: 'google/gemma-4-26b-a4b-it:free',
    label: 'Gemma 4 26B (free)',
    provider: 'OpenRouter',
    supportsVision: true,
    speed: 'Medium',
    accuracy: 'Good',
    released: '2026-04-03',
    blurb: 'OpenRouter free tier — may queue',
  },
  {
    key: 'nvidia/nemotron-nano-12b-v2-vl:free',
    label: 'Nemotron Nano VL (free)',
    provider: 'OpenRouter',
    supportsVision: true,
    speed: 'Slow',
    accuracy: 'Good',
    released: '2025-10-28',
    blurb: 'OpenRouter free NVIDIA VL',
  },
  {
    key: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
    label: 'Nemotron Omni (free)',
    provider: 'OpenRouter',
    supportsVision: true,
    speed: 'Slow',
    accuracy: 'High',
    released: '2026-04-28',
    blurb: 'OpenRouter — accurate but slow',
  },
];

/** Models that can judge/merge worker votes (vision or strong text reasoners). */
export const REASONER_MODELS = [
  ...OPENROUTER_MODELS,
  {
    key: 'nvidia/nemotron-3-ultra-550b-a55b',
    label: 'Nemotron 3 Ultra',
    supportsVision: false,
    speed: 'Medium',
    accuracy: 'High',
    released: '2026-06-04',
    blurb: 'Text-only judge over worker votes',
  },
];

/** Format OpenRouter release date (YYYY-MM-DD) for display. */
export function formatModelReleased(isoDate) {
  if (!isoDate) return '';
  const date = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return isoDate;
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function getModelMeta(modelKey, list = OPENROUTER_MODELS) {
  return list.find((entry) => entry.key === modelKey) ?? null;
}

const VITAMIN_PROMPT = `Identify the vitamin or supplement product shown in this image.
Reply in exactly 3 short lines:
Brand: <name or Unknown>
Product: <what it is>
Helps with: <main benefits>

If unreadable, say so. Do not invent ingredients.`;

const BULLION_COMPRESS_SINGLE = { maxWidth: 2048, quality: 0.92, maxFrames: 1 };
const BULLION_COMPRESS_MULTI = { maxWidth: 1600, quality: 0.88, maxFrames: 10 };

const BULLION_PROMPT = `Carefully identify every distinct metal bullion type in this image (coins, bars, rounds). Group identical pieces.

READ THE STAMPED / ENGRAVED / PRINTED TEXT on each piece as closely as possible before deciding. Do not assume 1oz by default.

Weight is critical — look for exact markings such as:
- Fractional ounces (very common under 1oz): 1/20 oz, 1/10 oz, 1/4 oz, 1/2 oz — also 1 oz, 2 oz, 10 oz, etc.
- Common Maple Leaf fractionals: 1/20oz, 1/10oz, 1/4oz, 1/2oz
- Grams: 1g, 2.5g, 5g, 10g, 20g, 50g, 100g, etc.
- Also note purity marks if visible (e.g. .999, .9999, 24K, 22K)

Also read mint/brand names, product names (Maple Leaf, Krugerrand, American Eagle, Buffalo, PAMP Fortuna, Credit Suisse, etc.), metal (Gold, Silver, Platinum, Palladium), and count how many of each type.

If a piece is clearly smaller than a typical 1oz coin or bar in the frame, do NOT output 1oz unless the stamp itself is readable as 1oz. Prefer fractional oz or grams from size + any partial stamp.

If text is partly obscured, make the best grounded guess from what is readable plus visual cues (size relative to other pieces, color, design). Prefer a specific weight guess over defaulting to 1oz. Use Unknown only when truly unreadable.

Return ONLY a JSON array (no markdown):
[{"brandMint":"Royal Canadian Mint","quantity":1,"bullion":"Gold Maple Leaf","weight":"1/4oz","metal":"Gold"}]

Rules:
- quantity must be a number
- weight must mirror the stamp when readable (keep formats like 1/4oz, 1/20oz, 5g, 10g)
- include every distinct type in the frame`;

const BULLION_WEIGHT_REREAD_PROMPT = `This is a close-up crop of metal bullion. Read ONLY the stamped / engraved weight (and purity if visible).

Do NOT invent 1oz unless you can clearly see a 1oz / 1 oz / one ounce mark.
Prefer fractional ounces (1/20oz, 1/10oz, 1/4oz, 1/2oz) and grams (1g, 2.5g, 5g, 10g, 20g, 50g, 100g) when those marks are visible or strongly implied by partial text.

Return ONLY a JSON array (no markdown), one object per distinct type visible:
[{"brandMint":"Unknown","quantity":1,"bullion":"Unknown","weight":"1/10oz","metal":"Unknown"}]

Rules:
- weight must mirror the stamp when readable
- Use Unknown for fields you cannot read — never invent 1oz to fill weight
- quantity must be a number`;

function buildBullionPrompt({ frameCount = 1 } = {}) {
  if (frameCount <= 1) return BULLION_PROMPT;

  return `You are given ${frameCount} frames from the same video of metal bullion (coins, bars, rounds).
The object(s) may move between frames — use ALL angles together for a better read of stamps, edges, and engravings.

Combine evidence across frames (different faces, lighting, and orientations). Prefer details confirmed in multiple frames. If one frame shows a clearer weight stamp, trust that reading.

READ THE STAMPED / ENGRAVED / PRINTED TEXT carefully. Do not assume 1oz by default.
Look for exact markings such as 1/20oz, 1/10oz, 1/4oz, 1/2oz, 1oz, 10oz, 5g, 10g, etc., plus purity (.999, .9999) when visible.
Common under-1oz pieces include Maple Leaf 1/20, 1/10, 1/4, 1/2 and gram bars (1g–100g).

If a piece is clearly smaller than a typical 1oz coin or bar across frames, do NOT output 1oz unless a stamp clearly reads 1oz.

Also identify mint/brand, product name, metal, and quantity of each distinct type.

Return ONLY a JSON array (no markdown):
[{"brandMint":"Royal Canadian Mint","quantity":1,"bullion":"Gold Maple Leaf","weight":"1/4oz","metal":"Gold"}]

Rules:
- quantity must be a number
- weight must mirror the stamp when readable
- include every distinct type
- Use Unknown only when truly unreadable across all frames`;
}

function buildBullionReasonPrompt(votes) {
  const payload = votes.map((vote) => ({
    model: vote.label || vote.model,
    status: vote.status,
    error: vote.error || null,
    items: vote.items || [],
    raw: vote.raw || null,
  }));

  return `You are adjudicating bullion ID votes from multiple vision models looking at the same photo.
Merge disagreements into the most likely inventory list.

Worker votes (JSON):
${JSON.stringify(payload, null, 2)}

Return ONLY a JSON array of the final bullion types (no markdown):
[{"brandMint":"...","quantity":1,"bullion":"...","weight":"...","metal":"..."}]

Rules:
- Prefer agreement across workers
- Weight is especially important: do NOT default to 1oz. Prefer stamped fractional ounces (1/20oz, 1/10oz, 1/4oz, 1/2oz) or grams (5g, 10g, etc.) when any worker read them
- When workers disagree on weight, choose the most specific reading supported by the votes (e.g. 1/4oz over vague 1oz)
- Treat unanimous 1oz as weak when any worker reported a fractional oz or gram reading — prefer that specific weight
- Prefer the most specific plausible mint/product name
- Drop clear hallucinations / empty Unknown-only noise
- quantity must be a number
- If nothing reliable is present, return []`;
}

function buildVitaminReasonPrompt(votes) {
  const payload = votes.map((vote) => ({
    model: vote.label || vote.model,
    status: vote.status,
    error: vote.error || null,
    text: vote.text || null,
  }));

  return `You are adjudicating vitamin/supplement ID votes from multiple vision models for the same photo.
Pick the most likely correct identification.

Worker votes (JSON):
${JSON.stringify(payload, null, 2)}

Reply in exactly 3 short lines:
Brand: <name or Unknown>
Product: <what it is>
Helps with: <main benefits>

Prefer agreement across workers. Do not invent ingredients.`;
}

function assertVisionModel(model) {
  const modelMeta =
    getModelMeta(model, OPENROUTER_MODELS) || getModelMeta(model, REASONER_MODELS);
  if (modelMeta && !modelMeta.supportsVision) {
    throw new Error(
      `${modelMeta.label} is text-only. Pick a vision model for image analysis.`
    );
  }
}

function normalizeBullionItem(raw, index = 0) {
  if (!raw || typeof raw !== 'object') return null;
  const quantity = Number(raw.quantity ?? raw.Quantity);
  return {
    id: `bullion-${index}`,
    brandMint:
      String(raw.brandMint ?? raw['Brand/Mint'] ?? raw.brand ?? raw.mint ?? 'Unknown').trim() ||
      'Unknown',
    quantity: Number.isFinite(quantity) && quantity > 0 ? Math.round(quantity) : 1,
    bullion: String(raw.bullion ?? raw.Bullion ?? raw.product ?? 'Unknown').trim() || 'Unknown',
    weight: String(raw.weight ?? raw.Weight ?? 'Unknown').trim() || 'Unknown',
    metal: String(raw.metal ?? raw.Metal ?? 'Unknown').trim() || 'Unknown',
  };
}

/**
 * Parse model output into bullion item cards. Tolerates markdown fences / trailing text.
 */
export function parseBullionItems(text) {
  if (!text || typeof text !== 'string') return [];

  const trimmed = text.trim();
  const candidates = [trimmed];

  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch?.[1]) candidates.unshift(fenceMatch[1].trim());

  const arrayMatch = trimmed.match(/\[[\s\S]*\]/);
  if (arrayMatch?.[0]) candidates.unshift(arrayMatch[0]);

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      const list = Array.isArray(parsed) ? parsed : parsed?.items ?? parsed?.bullion ?? [parsed];
      if (!Array.isArray(list)) continue;
      return list.map(normalizeBullionItem).filter(Boolean);
    } catch {
      // try next candidate
    }
  }

  return [];
}

function normalizeWeightKey(weight) {
  return String(weight || '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/ounces?/g, 'oz')
    .replace(/grams?/g, 'g');
}

/** True when weight looks like a defaulted / unreadable 1oz guess. */
export function isVagueBullionWeight(weight) {
  const key = normalizeWeightKey(weight);
  if (!key || key === 'unknown' || key === '?' || key === '-') return true;
  return /^(1(\.0+)?)oz$/.test(key) || key === 'oneoz';
}

/** Prefer fractional oz / gram stamps over vague 1oz / Unknown. */
export function isMoreSpecificBullionWeight(next, prev) {
  const nextKey = normalizeWeightKey(next);
  const prevKey = normalizeWeightKey(prev);
  if (!nextKey || nextKey === 'unknown') return false;
  if (isVagueBullionWeight(prev) && !isVagueBullionWeight(next)) return true;
  if (nextKey === prevKey) return false;
  const nextFractional = /^(1\/\d+|0\.\d+)oz$/.test(nextKey) || /^\d+(\.\d+)?g$/.test(nextKey);
  const prevFractional = /^(1\/\d+|0\.\d+)oz$/.test(prevKey) || /^\d+(\.\d+)?g$/.test(prevKey);
  return nextFractional && !prevFractional;
}

function needsStampWeightReread(items) {
  if (!Array.isArray(items) || items.length === 0) return true;
  return items.some((item) => isVagueBullionWeight(item?.weight));
}

function mergeStampWeightReread(baseItems, rereadItems) {
  if (!Array.isArray(rereadItems) || rereadItems.length === 0) {
    return baseItems || [];
  }
  if (!Array.isArray(baseItems) || baseItems.length === 0) {
    return rereadItems;
  }

  return baseItems.map((item, index) => {
    const byIndex = rereadItems[index];
    const byMatch =
      rereadItems.find(
        (candidate) =>
          candidate &&
          normalizeWeightKey(candidate.bullion) === normalizeWeightKey(item.bullion) &&
          normalizeWeightKey(candidate.metal) === normalizeWeightKey(item.metal)
      ) || null;
    const source = byMatch || byIndex;
    if (!source || !isMoreSpecificBullionWeight(source.weight, item.weight)) return item;
    return {
      ...item,
      weight: String(source.weight).trim() || item.weight,
    };
  });
}

/**
 * Shrink images before upload to cut latency (smaller payload + fewer vision tokens).
 * Scales so the longer edge is at most maxWidth.
 */
export async function compressImageDataUrl(dataUrl, { maxWidth = 1024, quality = 0.72 } = {}) {
  if (!dataUrl || typeof document === 'undefined') return dataUrl;

  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      const longest = Math.max(image.width, image.height, 1);
      const scale = Math.min(1, maxWidth / longest);
      const width = Math.max(1, Math.round(image.width * scale));
      const height = Math.max(1, Math.round(image.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(dataUrl);
        return;
      }
      ctx.drawImage(image, 0, 0, width, height);
      try {
        resolve(canvas.toDataURL('image/jpeg', quality));
      } catch {
        resolve(dataUrl);
      }
    };
    image.onerror = () => resolve(dataUrl);
    image.src = dataUrl;
  });
}

/**
 * Center-crop then compress — keeps stamp text larger for under-1oz OCR.
 */
export async function cropCenterImageDataUrl(
  dataUrl,
  { fraction = 0.65, maxWidth = 2048, quality = 0.92 } = {}
) {
  if (!dataUrl || typeof document === 'undefined') return dataUrl;
  const cropFraction = Math.min(1, Math.max(0.35, fraction));

  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      const cropW = Math.max(1, Math.round(image.width * cropFraction));
      const cropH = Math.max(1, Math.round(image.height * cropFraction));
      const sx = Math.max(0, Math.round((image.width - cropW) / 2));
      const sy = Math.max(0, Math.round((image.height - cropH) / 2));
      const longest = Math.max(cropW, cropH, 1);
      const scale = Math.min(1, maxWidth / longest);
      const width = Math.max(1, Math.round(cropW * scale));
      const height = Math.max(1, Math.round(cropH * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(dataUrl);
        return;
      }
      ctx.drawImage(image, sx, sy, cropW, cropH, 0, 0, width, height);
      try {
        resolve(canvas.toDataURL('image/jpeg', quality));
      } catch {
        resolve(dataUrl);
      }
    };
    image.onerror = () => resolve(dataUrl);
    image.src = dataUrl;
  });
}

/** Evenly sample frames so multi-image requests stay within practical limits. */
export function sampleImageFrames(frames, maxFrames = 10) {
  const list = (frames || []).filter(Boolean);
  if (list.length <= maxFrames) return list;
  if (maxFrames <= 1) return [list[0]];

  const sampled = [];
  for (let i = 0; i < maxFrames; i += 1) {
    const index = Math.round((i * (list.length - 1)) / (maxFrames - 1));
    sampled.push(list[index]);
  }
  return sampled;
}

async function compressImageList(imageDataUrls, compressOptions) {
  const urls = sampleImageFrames(imageDataUrls, compressOptions?.maxFrames ?? 10);
  const compressed = [];
  for (const url of urls) {
    compressed.push(await compressImageDataUrl(url, compressOptions));
  }
  return compressed.filter(Boolean);
}

async function analyzeImageWithPrompt({
  imageDataUrl,
  imageDataUrls,
  compressedDataUrl,
  compressedDataUrls,
  model,
  prompt,
  onDelta,
  signal,
  maxTokens,
  requireVision = true,
  compressOptions,
}) {
  const sourceUrls = [
    ...(Array.isArray(imageDataUrls) ? imageDataUrls : []),
    ...(imageDataUrl ? [imageDataUrl] : []),
  ].filter(Boolean);

  let images = Array.isArray(compressedDataUrls)
    ? compressedDataUrls.filter(Boolean)
    : compressedDataUrl
      ? [compressedDataUrl]
      : [];

  if (images.length === 0 && sourceUrls.length > 0) {
    images = await compressImageList(sourceUrls, compressOptions);
  }

  if (images.length === 0 && requireVision) {
    throw new Error('No image to analyze');
  }
  if (requireVision) {
    assertVisionModel(model);
  }

  const modelMeta =
    getModelMeta(model, REASONER_MODELS) || getModelMeta(model, OPENROUTER_MODELS);
  const canUseImage = !modelMeta || modelMeta.supportsVision;

  const content =
    canUseImage && images.length > 0
      ? [
          { type: 'text', text: prompt },
          ...images.map((url) => ({ type: 'image_url', image_url: { url } })),
        ]
      : [{ type: 'text', text: prompt }];

  return streamChatCompletion({
    model,
    messages: [{ role: 'user', content }],
    onDelta,
    signal,
    maxTokens,
  });
}

/**
 * Ask a vision model to identify a vitamin/supplement held up to the camera.
 */
export async function analyzeVitaminInImage(options = {}) {
  return analyzeImageWithPrompt({ ...options, prompt: VITAMIN_PROMPT, maxTokens: 220 });
}

async function refineBullionStampWeights({
  items,
  raw,
  imageDataUrl,
  imageDataUrls,
  compressedDataUrl,
  compressedDataUrls,
  model,
  signal,
}) {
  if (!needsStampWeightReread(items)) {
    return { items, raw, refined: false };
  }

  const sourceUrls = [
    ...(Array.isArray(imageDataUrls) ? imageDataUrls : []),
    ...(imageDataUrl ? [imageDataUrl] : []),
    ...(Array.isArray(compressedDataUrls) ? compressedDataUrls : []),
    ...(compressedDataUrl ? [compressedDataUrl] : []),
  ].filter(Boolean);

  const bestSource = sourceUrls[0];
  if (!bestSource || !model) {
    return { items, raw, refined: false };
  }

  try {
    const cropped = await cropCenterImageDataUrl(bestSource, {
      fraction: 0.65,
      maxWidth: BULLION_COMPRESS_SINGLE.maxWidth,
      quality: BULLION_COMPRESS_SINGLE.quality,
    });
    const rereadRaw = await analyzeImageWithPrompt({
      compressedDataUrl: cropped,
      model,
      prompt: BULLION_WEIGHT_REREAD_PROMPT,
      signal,
      maxTokens: 1024,
      requireVision: true,
    });
    const rereadItems = parseBullionItems(rereadRaw);
    const merged = mergeStampWeightReread(items, rereadItems);
    return { items: merged, raw, refined: true };
  } catch (error) {
    if (signal?.aborted || error?.name === 'AbortError') throw error;
    return { items, raw, refined: false };
  }
}

/**
 * Ask a vision model to identify metal bullion from one or more frames.
 * Returns { raw, items } where items are card-ready entries.
 */
export async function analyzeBullionInImage(options = {}) {
  const {
    refineStampWeights = true,
    imageDataUrl,
    imageDataUrls,
    compressedDataUrl,
    compressedDataUrls,
    model,
    onDelta,
    signal,
  } = options;

  const frameCount = Array.isArray(imageDataUrls)
    ? imageDataUrls.filter(Boolean).length
    : imageDataUrl || compressedDataUrl
      ? 1
      : Array.isArray(compressedDataUrls)
        ? compressedDataUrls.filter(Boolean).length
        : 1;

  const multiFrame = frameCount > 1;
  const compressOptions = multiFrame ? BULLION_COMPRESS_MULTI : BULLION_COMPRESS_SINGLE;
  const raw = await analyzeImageWithPrompt({
    imageDataUrl,
    imageDataUrls,
    compressedDataUrl,
    compressedDataUrls,
    model,
    onDelta,
    signal,
    prompt: buildBullionPrompt({ frameCount }),
    maxTokens: 4096,
    compressOptions,
  });
  let items = parseBullionItems(raw);

  if (refineStampWeights) {
    const refined = await refineBullionStampWeights({
      items,
      raw,
      imageDataUrl,
      imageDataUrls,
      compressedDataUrl,
      compressedDataUrls,
      model,
      signal,
    });
    items = refined.items;
  }

  return { raw, items };
}

/**
 * Run several vision models on the same bullion image(s) in parallel.
 * onWorkerUpdate(vote) fires as each model finishes.
 */
export async function analyzeBullionEnsemble({
  imageDataUrl,
  imageDataUrls,
  models,
  signal,
  onWorkerUpdate,
} = {}) {
  const workerKeys = [...new Set((models || []).filter(Boolean))];
  if (workerKeys.length === 0) {
    throw new Error('Select at least one worker model');
  }

  const sourceUrls = [
    ...(Array.isArray(imageDataUrls) ? imageDataUrls : []),
    ...(imageDataUrl ? [imageDataUrl] : []),
  ].filter(Boolean);

  const multiFrame = sourceUrls.length > 1;
  const compressedDataUrls = await compressImageList(
    sourceUrls,
    multiFrame ? BULLION_COMPRESS_MULTI : BULLION_COMPRESS_SINGLE
  );

  const votes = await Promise.all(
    workerKeys.map(async (model) => {
      const meta = getModelMeta(model, OPENROUTER_MODELS);
      const label = meta?.label || model;
      const startedAt = Date.now();
      try {
        const { raw, items } = await analyzeBullionInImage({
          compressedDataUrls,
          model,
          signal,
          // Stamp re-read runs once on the final consensus, not per worker.
          refineStampWeights: false,
        });
        const vote = {
          model,
          label,
          status: 'ready',
          items,
          raw,
          error: null,
          elapsedMs: Date.now() - startedAt,
        };
        onWorkerUpdate?.(vote);
        return vote;
      } catch (error) {
        if (signal?.aborted || error?.name === 'AbortError') {
          const vote = {
            model,
            label,
            status: 'aborted',
            items: [],
            raw: '',
            error: 'Aborted',
            elapsedMs: Date.now() - startedAt,
          };
          onWorkerUpdate?.(vote);
          return vote;
        }
        const vote = {
          model,
          label,
          status: 'error',
          items: [],
          raw: '',
          error: error?.message || 'Worker failed',
          elapsedMs: Date.now() - startedAt,
        };
        onWorkerUpdate?.(vote);
        return vote;
      }
    })
  );

  return { votes, compressedDataUrls, compressedDataUrl: compressedDataUrls[0] || null };
}

/**
 * Judge model merges worker bullion votes into a final answer.
 */
export async function reasonBullionConsensus({
  imageDataUrl,
  imageDataUrls,
  compressedDataUrl,
  compressedDataUrls,
  votes,
  model,
  onDelta,
  signal,
} = {}) {
  if (!model) throw new Error('Pick a reasoner model');
  const readyVotes = (votes || []).filter((vote) => vote.status === 'ready');
  if (readyVotes.length === 0) {
    throw new Error('No successful worker results to reason over');
  }

  const raw = await analyzeImageWithPrompt({
    imageDataUrl,
    imageDataUrls,
    compressedDataUrl,
    compressedDataUrls,
    model,
    prompt: buildBullionReasonPrompt(votes),
    onDelta,
    signal,
    maxTokens: 4096,
    requireVision: false,
  });
  let items = parseBullionItems(raw);

  const reasonerMeta =
    getModelMeta(model, REASONER_MODELS) || getModelMeta(model, OPENROUTER_MODELS);
  const visionModel = reasonerMeta?.supportsVision ? model : readyVotes[0]?.model;

  if (visionModel) {
    const refined = await refineBullionStampWeights({
      items,
      raw,
      imageDataUrl,
      imageDataUrls,
      compressedDataUrl,
      compressedDataUrls,
      model: visionModel,
      signal,
    });
    items = refined.items;
  }

  return { raw, items };
}

/**
 * Run several vision models on a vitamin frame in parallel.
 */
export async function analyzeVitaminEnsemble({
  imageDataUrl,
  models,
  signal,
  onWorkerUpdate,
} = {}) {
  const workerKeys = [...new Set((models || []).filter(Boolean))];
  if (workerKeys.length === 0) {
    throw new Error('Select at least one worker model');
  }

  const compressedDataUrl = await compressImageDataUrl(imageDataUrl);

  const votes = await Promise.all(
    workerKeys.map(async (model) => {
      const meta = getModelMeta(model, OPENROUTER_MODELS);
      const label = meta?.label || model;
      const startedAt = Date.now();
      try {
        const text = await analyzeVitaminInImage({
          imageDataUrl,
          compressedDataUrl,
          model,
          signal,
        });
        const vote = {
          model,
          label,
          status: 'ready',
          text,
          error: null,
          elapsedMs: Date.now() - startedAt,
        };
        onWorkerUpdate?.(vote);
        return vote;
      } catch (error) {
        if (signal?.aborted || error?.name === 'AbortError') {
          const vote = {
            model,
            label,
            status: 'aborted',
            text: '',
            error: 'Aborted',
            elapsedMs: Date.now() - startedAt,
          };
          onWorkerUpdate?.(vote);
          return vote;
        }
        const vote = {
          model,
          label,
          status: 'error',
          text: '',
          error: error?.message || 'Worker failed',
          elapsedMs: Date.now() - startedAt,
        };
        onWorkerUpdate?.(vote);
        return vote;
      }
    })
  );

  return { votes, compressedDataUrl };
}

/**
 * Judge model merges vitamin worker votes into a final answer.
 */
export async function reasonVitaminConsensus({
  imageDataUrl,
  compressedDataUrl,
  votes,
  model,
  onDelta,
  signal,
} = {}) {
  if (!model) throw new Error('Pick a reasoner model');
  const readyVotes = (votes || []).filter((vote) => vote.status === 'ready');
  if (readyVotes.length === 0) {
    throw new Error('No successful worker results to reason over');
  }

  return analyzeImageWithPrompt({
    imageDataUrl,
    compressedDataUrl,
    model,
    prompt: buildVitaminReasonPrompt(votes),
    onDelta,
    signal,
    maxTokens: 220,
    requireVision: false,
  });
}
