import { useCallback, useEffect, useState } from 'react';
import { useLiveRefresh } from './liveRefresh';
import { proxyJson } from './proxy';

export const SPOT_METALS = [
  { symbol: 'XAU', name: 'Gold', accent: '#C9A227' },
  { symbol: 'XAG', name: 'Silver', accent: '#A8A8AD' },
  { symbol: 'XPT', name: 'Platinum', accent: '#7D8896' },
  { symbol: 'XPD', name: 'Palladium', accent: '#8A7355' },
];

/**
 * gold-api.com: cache the price for 30 seconds. Spamming the endpoint
 * gets the caller IP blocked. The proxy keeps the same floor so every
 * signed-in Home tab shares one upstream pull.
 */
export const SPOT_REFRESH_MS = 30_000;

function emptyQuotes() {
  return SPOT_METALS.map((metal) => ({
    ...metal,
    price: null,
    updatedAt: null,
  }));
}

function normalizeQuote(raw) {
  const symbol = String(raw?.symbol || '').toUpperCase();
  const metal = SPOT_METALS.find((item) => item.symbol === symbol);
  const price = Number(raw?.price);
  if (!metal || !Number.isFinite(price)) return null;
  return {
    symbol: metal.symbol,
    name: metal.name,
    accent: metal.accent,
    price,
    updatedAt: raw?.updatedAt || null,
  };
}

function quotesFromPayload(payload) {
  const rows = Array.isArray(payload?.metals) ? payload.metals : [];
  return SPOT_METALS.map((metal) => {
    const found = rows.find((row) => String(row?.symbol || '').toUpperCase() === metal.symbol);
    return normalizeQuote({ ...found, symbol: metal.symbol }) || {
      ...metal,
      price: null,
      updatedAt: null,
    };
  });
}

function readUsdCadRate(payload) {
  const rate = Number(payload?.usdCadRate);
  return Number.isFinite(rate) && rate > 0 ? rate : null;
}

/** @type {{ expires: number, quotes: ReturnType<typeof emptyQuotes>, usdCadRate: number | null } | null} */
let spotCache = null;
/** @type {Promise<{ quotes: ReturnType<typeof emptyQuotes>, usdCadRate: number | null }> | null} */
let spotInflight = null;

export async function fetchSpotPrices({ force = false } = {}) {
  const now = Date.now();
  if (!force && spotCache && now < spotCache.expires) {
    return { quotes: spotCache.quotes, usdCadRate: spotCache.usdCadRate };
  }
  if (spotInflight) return spotInflight;

  spotInflight = (async () => {
    try {
      const payload = await proxyJson('spot-prices');
      const quotes = quotesFromPayload(payload);
      const usdCadRate = readUsdCadRate(payload);
      spotCache = { expires: Date.now() + SPOT_REFRESH_MS, quotes, usdCadRate };
      return { quotes, usdCadRate };
    } catch (err) {
      if (spotCache) return { quotes: spotCache.quotes, usdCadRate: spotCache.usdCadRate };
      throw err;
    } finally {
      spotInflight = null;
    }
  })();

  return spotInflight;
}

export function useSpotPrices(enabled = true) {
  const [state, setState] = useState(() =>
    spotCache
      ? { quotes: spotCache.quotes, usdCadRate: spotCache.usdCadRate }
      : { quotes: emptyQuotes(), usdCadRate: null },
  );

  const load = useCallback(async () => {
    if (!enabled) return;
    const next = await fetchSpotPrices();
    setState(next);
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return undefined;
    load().catch(() => {});
    return undefined;
  }, [enabled, load]);

  useLiveRefresh(load, SPOT_REFRESH_MS, enabled);
  return state;
}
