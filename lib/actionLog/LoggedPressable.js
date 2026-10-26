/**
 * Drop-in replacement for React Native's Pressable that writes every press to
 * the action ledger and applies the left-rail hover / click / select chrome.
 * metro.config.js swaps this in for every `Pressable` imported from
 * 'react-native' inside this project, so no screen has to opt in.
 */
import { forwardRef } from 'react';
import { Platform, Pressable } from 'react-native';
import { pressChromeClassName, withPressChromeStyle } from './pressChrome';
import { describePressable, recordAction } from './index';

const LoggedPressable = forwardRef(function LoggedPressable(props, ref) {
  const { onPress, onLongPress, pressChrome: _pressChrome, style, ...rest } = props;

  const loggedPress = onPress
    ? (event) => {
        try {
          recordAction({ action: 'press', ...describePressable(props) });
        } catch {
          // Logging must never break the button.
        }
        return onPress(event);
      }
    : onPress;

  const loggedLongPress = onLongPress
    ? (event) => {
        try {
          recordAction({ action: 'long_press', ...describePressable(props) });
        } catch {
          // Logging must never break the button.
        }
        return onLongPress(event);
      }
    : onLongPress;

  const webClassName = pressChromeClassName(props);

  return (
    <Pressable
      {...rest}
      ref={ref}
      style={withPressChromeStyle(style, props)}
      onPress={loggedPress}
      onLongPress={loggedLongPress}
      {...(Platform.OS === 'web' && webClassName ? { className: webClassName } : null)}
    />
  );
});

export default LoggedPressable;
