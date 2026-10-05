import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { formatDateParam, formatPickerDate, parseDateParam } from './transactions';

export function currentAppDate() {
  const today = formatDateParam(new Date());
  return { mode: 'day', startDate: today, endDate: today };
}

export function normalizeAppDate({ mode, startDate, endDate, start, end } = {}) {
  const first = formatDateParam(startDate || start || new Date());
  const last = formatDateParam(endDate || end || startDate || start || new Date());
  const a = first <= last ? first : last;
  const b = first <= last ? last : first;
  return {
    mode: mode === 'range' && a !== b ? 'range' : 'day',
    startDate: a,
    endDate: b,
  };
}

export function appDatesEqual(left, right) {
  return (
    left?.mode === right?.mode &&
    left?.startDate === right?.startDate &&
    left?.endDate === right?.endDate
  );
}

export function formatAppDateLabel({ mode, startDate, endDate } = currentAppDate()) {
  const today = formatDateParam(new Date());
  if (mode !== 'range' || startDate === endDate) {
    return startDate === today ? 'Today' : formatPickerDate(parseDateParam(startDate));
  }
  const start = parseDateParam(startDate);
  const end = parseDateParam(endDate);
  const thisYear = parseDateParam(new Date()).getFullYear();
  const sameYear = start.getFullYear() === end.getFullYear();
  const startLabel = start.toLocaleDateString('en-CA', {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
  const endLabel = end.toLocaleDateString('en-CA', {
    month: 'short',
    day: 'numeric',
    ...(sameYear && end.getFullYear() === thisYear ? {} : { year: 'numeric' }),
  });
  return `${startLabel} – ${endLabel}`;
}

export const AppDateContext = createContext({
  mode: 'day',
  startDate: currentAppDate().startDate,
  endDate: currentAppDate().endDate,
  label: 'Today',
  isToday: true,
  setAppDate: () => {},
  applyPicker: () => {},
  resetToToday: () => {},
});

export function AppDateProvider({ children }) {
  const [date, setDate] = useState(currentAppDate);
  const [generation, setGeneration] = useState(0);

  const setAppDate = useCallback((next) => {
    const normalized = normalizeAppDate(next);
    setDate((prev) => {
      if (appDatesEqual(prev, normalized)) return prev;
      setGeneration((n) => n + 1);
      return normalized;
    });
  }, []);

  const applyPicker = useCallback(
    ({ mode, start, end }) => {
      const normalized = normalizeAppDate({ mode, start, end });
      setDate(normalized);
      setGeneration((n) => n + 1);
    },
    [],
  );

  const resetToToday = useCallback(() => {
    const next = currentAppDate();
    setDate((prev) => {
      if (appDatesEqual(prev, next)) return prev;
      setGeneration((n) => n + 1);
      return next;
    });
  }, []);

  const value = useMemo(() => {
    const today = formatDateParam(new Date());
    return {
      ...date,
      generation,
      label: formatAppDateLabel(date),
      isToday: date.mode === 'day' && date.startDate === today && date.endDate === today,
      setAppDate,
      applyPicker,
      resetToToday,
    };
  }, [applyPicker, date, generation, resetToToday, setAppDate]);

  return <AppDateContext.Provider value={value}>{children}</AppDateContext.Provider>;
}

export function useAppDate() {
  return useContext(AppDateContext);
}

/** Reset the shared date filter to Today when the shell page changes. */
export function AppDateRouteReset({ pageKey }) {
  const { resetToToday } = useAppDate();
  const seen = useRef(pageKey);
  useEffect(() => {
    if (seen.current === pageKey) return;
    seen.current = pageKey;
    resetToToday();
  }, [pageKey, resetToToday]);
  return null;
}
