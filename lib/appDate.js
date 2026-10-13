import { createContext, useCallback, useContext, useMemo, useState } from 'react';
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

const NOOP = () => {};

const AppDateActionsContext = createContext({
  setAppDate: NOOP,
  applyPicker: NOOP,
  resetToToday: NOOP,
});

const AppDateStateContext = createContext({
  dates: {},
  generations: {},
});

const AppDateScopeContext = createContext('app');

export function AppDateProvider({ children }) {
  const [dates, setDates] = useState({});
  const [generations, setGenerations] = useState({});

  const setAppDate = useCallback((scope, next) => {
    const normalized = normalizeAppDate(next);
    setDates((prev) => {
      const current = prev[scope] || currentAppDate();
      if (appDatesEqual(current, normalized)) return prev;
      setGenerations((g) => ({ ...g, [scope]: (g[scope] || 0) + 1 }));
      return { ...prev, [scope]: normalized };
    });
  }, []);

  const applyPicker = useCallback((scope, { mode, start, end }) => {
    const normalized = normalizeAppDate({ mode, start, end });
    setDates((prev) => ({ ...prev, [scope]: normalized }));
    setGenerations((g) => ({ ...g, [scope]: (g[scope] || 0) + 1 }));
  }, []);

  const resetToToday = useCallback((scope) => {
    const next = currentAppDate();
    setDates((prev) => {
      const current = prev[scope] || currentAppDate();
      if (appDatesEqual(current, next)) return prev;
      setGenerations((g) => ({ ...g, [scope]: (g[scope] || 0) + 1 }));
      return { ...prev, [scope]: next };
    });
  }, []);

  const actions = useMemo(
    () => ({ setAppDate, applyPicker, resetToToday }),
    [applyPicker, resetToToday, setAppDate],
  );
  const state = useMemo(() => ({ dates, generations }), [dates, generations]);

  return (
    <AppDateActionsContext.Provider value={actions}>
      <AppDateStateContext.Provider value={state}>{children}</AppDateStateContext.Provider>
    </AppDateActionsContext.Provider>
  );
}

/** Dates saved under `id` stay on that page. Nested scopes override the parent. */
export function AppDateScope({ id, children }) {
  return <AppDateScopeContext.Provider value={id || 'app'}>{children}</AppDateScopeContext.Provider>;
}

export function useAppDate() {
  const scope = useContext(AppDateScopeContext);
  const { setAppDate: setScopedDate, applyPicker: applyScopedPicker, resetToToday: resetScoped } =
    useContext(AppDateActionsContext);
  const { dates, generations } = useContext(AppDateStateContext);
  const stored = dates[scope];
  const generation = generations[scope] || 0;

  const setAppDate = useCallback((next) => setScopedDate(scope, next), [scope, setScopedDate]);
  const applyPicker = useCallback(
    (payload) => applyScopedPicker(scope, payload),
    [applyScopedPicker, scope],
  );
  const resetToToday = useCallback(() => resetScoped(scope), [resetScoped, scope]);

  return useMemo(() => {
    const today = formatDateParam(new Date());
    const date = stored || { mode: 'day', startDate: today, endDate: today };
    return {
      ...date,
      generation,
      label: formatAppDateLabel(date),
      isToday: date.mode === 'day' && date.startDate === today && date.endDate === today,
      setAppDate,
      applyPicker,
      resetToToday,
    };
  }, [applyPicker, generation, resetToToday, setAppDate, stored]);
}
