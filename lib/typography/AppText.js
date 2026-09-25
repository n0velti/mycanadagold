/**
 * Drop-in Text that always renders in Söhne.
 *
 * metro.config.js swaps this in for every `Text` imported from `react-native`
 * inside app code (same pattern as LoggedPressable).
 */
import { forwardRef } from 'react';
import { Text } from 'react-native';
import { applyTypography } from './faces';

const AppText = forwardRef(function AppText({ style, ...props }, ref) {
  return <Text {...props} ref={ref} style={applyTypography(style)} />;
});

AppText.displayName = 'Text';

export default AppText;
