/**
 * Drop-in ScrollView that can actually scroll on web.
 *
 * RN web only scrolls a flex child when that child has a definite height.
 * `flex: 1` alone sizes to content, then the shell's overflow:hidden clips
 * it — which is why so many apps stopped scrolling down. metro.config.js
 * swaps this in for every app-source ScrollView.
 */
import { forwardRef } from 'react';
import { Platform, ScrollView, StyleSheet } from 'react-native';

const WEB_CONSTRAIN = {
  minHeight: 0,
  height: 0,
  overflowY: 'auto',
};

function needsWebHeight(style) {
  if (Platform.OS !== 'web' || !style) return false;
  const flat = StyleSheet.flatten(style);
  if (!flat) return false;
  if (flat.height != null && flat.height !== 0 && flat.height !== '0') return false;
  return flat.flex === 1 || flat.flexGrow === 1;
}

const AppScrollView = forwardRef(function AppScrollView({ horizontal, style, className, ...props }, ref) {
  const constrain = !horizontal && needsWebHeight(style);
  const webClass = [className, constrain ? 'cgold-flex-scroll' : null].filter(Boolean).join(' ');
  return (
    <ScrollView
      {...props}
      ref={ref}
      horizontal={horizontal}
      style={constrain ? [style, WEB_CONSTRAIN] : style}
      {...(Platform.OS === 'web' && webClass ? { className: webClass } : null)}
    />
  );
});

AppScrollView.displayName = 'ScrollView';

export default AppScrollView;
