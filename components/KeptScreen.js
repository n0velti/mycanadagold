import { memo } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { AppDateScope } from '../lib/appDate';
import { ScreenVisibilityProvider } from '../lib/screenVisibility';
import ScreenGate from './ScreenGate';

/**
 * One screen the shell keeps mounted.
 *
 * Switching apps used to unmount the screen being left and mount the next one
 * from scratch, so every hop re-ran that screen's first-load fetches. Now the
 * shell renders a KeptScreen per screen it is holding on to and flips
 * `visible`; the hidden ones are `display: none` (no layout, no paint, no hit
 * testing) and announce themselves hidden through ScreenVisibilityProvider so
 * `useLiveRefresh` and friends stop polling until they are shown again.
 *
 * The component is memoised on a shallow comparison of `screenProps`, which
 * is what stops an unrelated state change in App from re-rendering every
 * mounted screen. Callers must therefore pass stable handlers (useCallback /
 * useStableCallback) and build `screenProps` fresh each render with only
 * what that screen needs.
 */
function KeptScreen({ visible, Component, screenProps, gateKey, dateScope, style }) {
  return (
    <ScreenVisibilityProvider value={visible}>
      <View
        style={visible ? [styles.live, style] : styles.hidden}
        pointerEvents={visible ? 'auto' : 'none'}
        accessibilityElementsHidden={!visible}
        importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'}
        {...(Platform.OS === 'web' && visible ? { className: 'cgold-flex-scroll' } : null)}
      >
        <AppDateScope id={dateScope}>
          <ScreenGate resetKey={gateKey}>
            <Component {...screenProps} />
          </ScreenGate>
        </AppDateScope>
      </View>
    </ScreenVisibilityProvider>
  );
}

function shallowEqual(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (let i = 0; i < keysA.length; i += 1) {
    const key = keysA[i];
    if (!Object.prototype.hasOwnProperty.call(b, key) || !Object.is(a[key], b[key])) return false;
  }
  return true;
}

function areEqual(prev, next) {
  return (
    prev.visible === next.visible &&
    prev.Component === next.Component &&
    prev.gateKey === next.gateKey &&
    prev.dateScope === next.dateScope &&
    prev.style === next.style &&
    shallowEqual(prev.screenProps, next.screenProps)
  );
}

export default memo(KeptScreen, areEqual);

/**
 * Most-recently-used list of screen keys, newest last. `limit` is how many
 * screens the shell is willing to hold at once; the oldest fall off and will
 * mount fresh next time they are opened.
 */
export function touchKeptKey(keys, key, limit) {
  if (!key) return keys;
  if (keys[keys.length - 1] === key && (!limit || keys.length <= limit)) return keys;
  const next = [...keys.filter((item) => item !== key), key];
  if (limit > 0 && next.length > limit) return next.slice(next.length - limit);
  return next;
}

const styles = StyleSheet.create({
  live: {
    flex: 1,
    minHeight: 0,
    alignSelf: 'stretch',
    width: '100%',
    ...Platform.select({
      web: {
        display: 'flex',
        flexDirection: 'column',
        height: 0,
        overflowY: 'auto',
        overflowX: 'hidden',
      },
      default: {},
    }),
  },
  hidden: {
    display: 'none',
  },
});
