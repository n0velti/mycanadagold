/**
 * Drop-in replacement for React Native's Pressable that writes every press to
 * the action ledger. metro.config.js swaps this in for every `Pressable`
 * imported from 'react-native' inside this project, so no screen has to opt in.
 */
import { forwardRef } from 'react';
import { Pressable } from 'react-native';
import { describePressable, recordAction } from './index';

const LoggedPressable = forwardRef(function LoggedPressable(props, ref) {
  const { onPress, onLongPress } = props;

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

  return <Pressable {...props} ref={ref} onPress={loggedPress} onLongPress={loggedLongPress} />;
});

export default LoggedPressable;
