import { useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';

/** Aureus POS is REST-only; this is the tightest safe live poll. */
export const AUREUS_TX_LIVE_MS = 2000;
export const AUREUS_CASH_LIVE_MS = 3000;

function isForeground() {
  if (AppState.currentState && AppState.currentState !== 'active') return false;
  if (
    Platform.OS === 'web' &&
    typeof document !== 'undefined' &&
    document.visibilityState === 'hidden'
  ) {
    return false;
  }
  return true;
}

/**
 * Re-runs `refresh({ silent: true })` while the screen is visible and the app
 * is in the foreground. Each pass starts `intervalMs` after the previous one
 * finishes so Aureus data stays as live as REST allows. Also refreshes when
 * returning from background. Overlapping calls are skipped.
 */
export function useLiveRefresh(refresh, intervalMs, enabled = true) {
  const refreshRef = useRef(refresh);
  const inFlight = useRef(false);
  refreshRef.current = refresh;

  useEffect(() => {
    if (!enabled || !intervalMs || intervalMs < 1000) return undefined;

    let timeoutId = null;
    let stopped = false;

    const clearTimer = () => {
      if (timeoutId == null) return;
      clearTimeout(timeoutId);
      timeoutId = null;
    };

    const schedule = (delay) => {
      clearTimer();
      if (stopped || !isForeground()) return;
      timeoutId = setTimeout(() => {
        timeoutId = null;
        run();
      }, delay);
    };

    const run = async () => {
      if (stopped || inFlight.current || !isForeground()) return;
      inFlight.current = true;
      try {
        await refreshRef.current?.({ silent: true });
      } catch {
        // Callers handle their own errors.
      } finally {
        inFlight.current = false;
        if (!stopped && isForeground()) schedule(intervalMs);
      }
    };

    const sync = (refreshNow) => {
      if (!isForeground()) {
        clearTimer();
        return;
      }
      if (refreshNow) run();
      else if (timeoutId == null && !inFlight.current) schedule(intervalMs);
    };

    schedule(intervalMs);

    const onAppState = (state) => {
      sync(state === 'active');
    };
    const appSub = AppState.addEventListener('change', onAppState);

    let onVisibility;
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      onVisibility = () => sync(document.visibilityState === 'visible');
      document.addEventListener('visibilitychange', onVisibility);
    }

    return () => {
      stopped = true;
      clearTimer();
      appSub.remove();
      if (onVisibility) document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [enabled, intervalMs]);
}
