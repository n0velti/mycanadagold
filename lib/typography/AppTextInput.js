/**
 * Drop-in TextInput that always renders in Söhne.
 *
 * metro.config.js swaps this in for every `TextInput` imported from
 * `react-native` inside app code (same pattern as LoggedPressable).
 */
import { forwardRef } from 'react';
import { TextInput } from 'react-native';
import { applyTypography } from './faces';

const AppTextInput = forwardRef(function AppTextInput({ style, ...props }, ref) {
  return <TextInput {...props} ref={ref} style={applyTypography(style)} />;
});

AppTextInput.displayName = 'TextInput';

export default AppTextInput;
