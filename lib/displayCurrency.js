import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { formatAmount } from './transactions';
import { SPOT_METALS, useSpotPrices } from './spotPrices';

export const DISPLAY_CURRENCIES = ['CAD', 'USD'];
const STORAGE_KEY = 'cgold_display_currency';
const SPOT_STORAGE_KEY = 'cgold_spot_metal';

export function sanitizeDisplayCurrency(value) {
  return String(value || '').trim().toUpperCase() === 'USD' ? 'USD' : 'CAD';
}

export function loadDisplayCurrency() {
  try {
    if (typeof localStorage === 'undefined') return 'CAD';
    return sanitizeDisplayCurrency(localStorage.getItem(STORAGE_KEY));
  } catch {
    return 'CAD';
  }
}

export function persistDisplayCurrency(currency) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, sanitizeDisplayCurrency(currency));
  } catch {
    // Private mode / native — in-memory preference is enough for the session.
  }
}

export function sanitizeSpotSymbol(value) {
  const symbol = String(value || '').trim().toUpperCase();
  return SPOT_METALS.some((metal) => metal.symbol === symbol) ? symbol : 'XAU';
}

export function loadSpotSymbol() {
  try {
    if (typeof localStorage === 'undefined') return 'XAU';
    return sanitizeSpotSymbol(localStorage.getItem(SPOT_STORAGE_KEY));
  } catch {
    return 'XAU';
  }
}

export function persistSpotSymbol(symbol) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(SPOT_STORAGE_KEY, sanitizeSpotSymbol(symbol));
  } catch {
    // Private mode / native — in-memory preference is enough for the session.
  }
}

/** POS / gold-api CAD amounts → the selected display currency. */
export function usdCadToDisplay(amountCad, currency, usdCadRate) {
  const n = Number(amountCad);
  if (!Number.isFinite(n)) return 0;
  if (sanitizeDisplayCurrency(currency) !== 'USD') return n;
  const rate = Number(usdCadRate);
  if (!Number.isFinite(rate) || rate <= 0) return n;
  return n / rate;
}

export const DisplayCurrencyContext = createContext({
  currency: 'CAD',
  setCurrency: () => {},
  usdCadRate: null,
  quotes: [],
  spotSymbol: 'XAU',
  setSpotSymbol: () => {},
  fromCad: (amount) => Number(amount) || 0,
  money: (amount) => formatAmount(amount, 'CAD'),
});

export function DisplayCurrencyProvider({ children, enabled = true }) {
  const [currency, setCurrencyState] = useState(loadDisplayCurrency);
  const [spotSymbol, setSpotSymbolState] = useState(loadSpotSymbol);
  const spots = useSpotPrices(enabled);

  const setCurrency = useCallback((next) => {
    const value = sanitizeDisplayCurrency(next);
    setCurrencyState(value);
    persistDisplayCurrency(value);
  }, []);

  const setSpotSymbol = useCallback((next) => {
    const value = sanitizeSpotSymbol(next);
    setSpotSymbolState(value);
    persistSpotSymbol(value);
  }, []);

  const value = useMemo(() => {
    const fromCad = (amount) => usdCadToDisplay(amount, currency, spots.usdCadRate);
    return {
      currency,
      setCurrency,
      usdCadRate: spots.usdCadRate,
      quotes: spots.quotes,
      spotSymbol,
      setSpotSymbol,
      fromCad,
      money: (amount) => formatAmount(fromCad(amount), currency),
    };
  }, [currency, setCurrency, setSpotSymbol, spotSymbol, spots.quotes, spots.usdCadRate]);

  return <DisplayCurrencyContext.Provider value={value}>{children}</DisplayCurrencyContext.Provider>;
}

export function useDisplayCurrency() {
  return useContext(DisplayCurrencyContext);
}
