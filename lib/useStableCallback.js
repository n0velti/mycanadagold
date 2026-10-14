import { useCallback, useInsertionEffect, useRef } from 'react';

/**
 * Returns a function whose identity never changes but which always calls the
 * latest `fn`. Use it for handlers the shell hands to screens so a state
 * change in App does not hand every mounted screen a fresh prop and make it
 * re-render. Not for use during render: the latest `fn` is only guaranteed
 * once the commit has happened.
 */
export function useStableCallback(fn) {
  const ref = useRef(fn);
  useInsertionEffect(() => {
    ref.current = fn;
  });
  return useCallback((...args) => ref.current?.(...args), []);
}
