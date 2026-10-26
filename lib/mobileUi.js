import { Platform, StatusBar, useWindowDimensions } from 'react-native';

export const MOBILE_BREAKPOINT = 768;

// Floating filter/apps control on the mobile home and store heroes.
// Trailing inset matches the 16px content padding so the control lines up
// with the amount, stats, and section headers.
export const MOBILE_FILTER_SIZE = 34;
export const MOBILE_TOP_FILTER_SIZE = 44;
export const MOBILE_FILTER_INSET = 16;
export const MOBILE_ICON_COL_WIDTH = 56;
export const MOBILE_ROW_BODY_LEADING = 12;

export const CANVAS = 'rgb(252, 252, 251)';

/** Desktop TopNavBar height — content should pad this and scroll underneath. */
export const DESKTOP_TOP_BAR_HEIGHT = 52;

/** Mobile home / app feed top bar (blur strip under the safe area). */
export const MOBILE_FEED_TOP_BAR_HEIGHT = 48;

export const MOBILE = {
  bg: '#F2F2F7',
  feed: '#FFFFFF',
  label: '#1D1D1F',
  secondary: '#8E8E93',
  separator: 'rgba(60, 60, 67, 0.18)',
  blue: '#007AFF',
  gold: '#B8860B',
};

/** Matches desktop sidebar tab chrome (active pill + icon tones). */
export const NAV_TAB_ACTIVE_BG = '#f0f0f2';
export const NAV_TAB_ACTIVE_RADIUS = 6;
export const NAV_ICON_INACTIVE = '#8e8e93';
export const NAV_ICON_ACTIVE = '#1a1a1a';

export function useIsMobile() {
  const { width } = useWindowDimensions();
  return width < MOBILE_BREAKPOINT;
}

export function mobileSafeTop() {
  if (Platform.OS === 'ios') return 54;
  if (Platform.OS === 'android') return StatusBar.currentHeight || 24;
  return 12;
}

export function mobileSafeBottom() {
  if (Platform.OS === 'ios') return 20;
  return 8;
}

/**
 * TextInput props for a multiline chat composer: Enter sends, Shift+Enter
 * starts a new line. On web the key handler sends and stops the newline. On
 * iOS and Android the return key submits through onSubmitEditing without
 * inserting a newline; handling the key event there as well would send and
 * then leave the typed text (plus a newline) sitting in the box.
 */
export function enterToSendProps(onSend) {
  if (Platform.OS === 'web') {
    return {
      blurOnSubmit: false,
      onKeyPress: (event) => {
        const native = event?.nativeEvent || {};
        const key = native.key || event?.key;
        if (key !== 'Enter' || native.shiftKey || event?.shiftKey || native.isComposing) return;
        event?.preventDefault?.();
        onSend();
      },
    };
  }
  return { submitBehavior: 'submit', onSubmitEditing: onSend };
}
