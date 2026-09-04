import { Platform, StatusBar, useWindowDimensions } from 'react-native';

export const MOBILE_BREAKPOINT = 768;

export const MOBILE = {
  bg: '#F2F2F7',
  feed: '#FFFFFF',
  label: '#1D1D1F',
  secondary: '#8E8E93',
  separator: 'rgba(60, 60, 67, 0.18)',
  blue: '#007AFF',
  gold: '#B8860B',
};

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
