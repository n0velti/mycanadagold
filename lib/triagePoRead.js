/**
 * Read a PO number off a photo of the physical ticket, then load that
 * purchase (total and line weights) from every signed-in POS.
 */
import { ProxyError, proxyFetch, proxyJson } from './proxy';
import {
  fetchTransactionDetail,
  posSourcesFromSession,
  rowFromDocument,
  withLineItems,
} from './transactions';

/** Digits of a PO id. Accepts "PO# 184920", "184920", or a bare number. */
export function normalizePoNumber(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  const labeled = text.match(/(?:p\.?\s*o\.?|purchase)\s*#?\s*(\d{1,12})/i);
  const digits = (labeled ? labeled[1] : text).replace(/\D/g, '').replace(/^0+/, '');
  if (!digits || digits.length > 12) return '';
  return digits;
}

const PO_PROMPT = [
  'This is a photo of a printed Canada Gold purchase order, also called a buy ticket or PO paper.',
  'Read the purchase order number. It is usually labeled PO, PO#, P.O., or Purchase, and it is a short numeric id.',
  'Ignore prices, weights, phone numbers, dates, SKUs, store names, and customer names.',
  'Return JSON only: {"poNumber":"123456"} with digits only.',
  'If you cannot read a purchase order number, return {"poNumber":""}. Do not guess.',
].join(' ');

function poNumberFromModelText(text) {
  const raw = String(text || '').trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  const slice = start >= 0 && end > start ? raw.slice(start, end + 1) : raw;
  try {
    return normalizePoNumber(JSON.parse(slice)?.poNumber);
  } catch {
    return normalizePoNumber(raw);
  }
}

/** Used when the dedicated route is not deployed yet. The key still stays on the proxy. */
async function readPoNumberViaChat(dataUrl) {
  const models = ['gpt-4.1-mini', 'gpt-4o-mini'];
  let lastError = null;
  for (const model of models) {
    const response = await proxyFetch('openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 80,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: PO_PROMPT },
              { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } },
            ],
          },
        ],
      }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      lastError = new Error(payload?.error?.message || 'Could not read that photo.');
      continue;
    }
    const poNumber = poNumberFromModelText(payload?.choices?.[0]?.message?.content);
    if (poNumber) return poNumber;
  }
  if (lastError) throw lastError;
  return '';
}

function routeMissing(err) {
  return err instanceof ProxyError && (err.status === 404 || err.code === 'not_found');
}

export async function readPoNumberFromPhoto(dataUrl) {
  try {
    const payload = await proxyJson('triage/read-po', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ image: dataUrl }),
    });
    return normalizePoNumber(payload?.poNumber);
  } catch (err) {
    if (!routeMissing(err)) throw err;
    return readPoNumberViaChat(dataUrl);
  }
}

/** Purchases whose id matches, one per POS system that has it. */
export async function lookupPurchasesByPoNumber(session, poNumber) {
  const id = normalizePoNumber(poNumber);
  if (!id) throw new Error('Enter a PO number.');

  const sources = posSourcesFromSession(session);
  if (!sources.length) throw new Error('Sign in again to look up a PO.');

  const found = await Promise.all(
    sources.map(async (source) => {
      try {
        const detail = await fetchTransactionDetail(source.token, {
          type: 'purchase',
          sourceId: id,
          baseUrl: source.baseUrl,
        });
        if (!detail || detail.id == null) return null;
        return withLineItems(rowFromDocument(detail, 'purchase', source), detail);
      } catch {
        return null;
      }
    }),
  );

  return found.filter(Boolean);
}
