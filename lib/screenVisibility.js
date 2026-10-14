import { createContext, useContext } from 'react';

/**
 * Whether the screen a component sits in is the one on display.
 *
 * Screens stay mounted after the person leaves them (see
 * components/KeptScreen.js) so that coming back is instant and nothing has to
 * be re-fetched. Anything periodic (polling, animations, prefetch) should read
 * this and stand down while hidden; `useLiveRefresh` already does.
 *
 * Defaults to `true` so screens rendered outside a KeptScreen behave as before.
 */
const ScreenVisibilityContext = createContext(true);

export const ScreenVisibilityProvider = ScreenVisibilityContext.Provider;

export function useScreenVisible() {
  return useContext(ScreenVisibilityContext);
}
