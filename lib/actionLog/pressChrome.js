/**
 * Shared hover / press / select chrome that matches the left-rail tabs:
 *   hover  — rgba(60,60,67,0.06) wash
 *   click  — slightly stronger wash
 *   select — no extra wash (the control keeps its selected chip)
 *
 * Lives next to LoggedPressable so it imports the real `react-native`
 * (metro does not remap this folder).
 */
import { Platform, StyleSheet } from 'react-native';

export const PRESS_HOVER_WASH = 'rgba(60,60,67,0.06)';
export const PRESS_ACTIVE_WASH = 'rgba(60,60,67,0.10)';

const SKIP_CLASSES = new Set([
  'cgold-sidebar-item',
  'cgold-apps-rail-item',
  'cgold-tx-row',
  'cgold-home-row',
  'cgold-store-tx-row',
  'cgold-dm-row',
  'cgold-app-card',
  'cgold-app-pin',
  'cgold-filter-option',
  'cgold-nav-crumb',
  'cgold-app-switch-option',
  'cgold-store-tile',
  'cgold-store-tile-static',
  'cgold-hit-off',
]);

function classTokens(className) {
  return String(className || '')
    .split(/\s+/)
    .filter(Boolean);
}

function styleLooksLikeFill(style) {
  if (!style || typeof style === 'function') return false;
  const items = Array.isArray(style) ? style.flat(8) : [style];
  return items.some((item) => {
    if (!item || typeof item !== 'object') return false;
    if (item === StyleSheet.absoluteFill || item === StyleSheet.absoluteFillObject) return true;
    return (
      item.position === 'absolute' &&
      item.top === 0 &&
      item.right === 0 &&
      item.bottom === 0 &&
      item.left === 0
    );
  });
}

export function shouldApplyPressChrome(props) {
  if (!props || props.pressChrome === false) return false;
  if (props.disabled) return false;
  if (!props.onPress && !props.onLongPress) return false;
  if (styleLooksLikeFill(props.style)) return false;
  return !classTokens(props.className).some((token) => SKIP_CLASSES.has(token));
}

export function pressChromeClassName(props) {
  const current = props?.className;
  if (Platform.OS !== 'web' || !shouldApplyPressChrome(props)) return current;
  const selected = Boolean(props.accessibilityState?.selected);
  return [current, 'cgold-hit', selected && 'cgold-hit-selected'].filter(Boolean).join(' ');
}

/** RN-web only puts custom classes on the DOM when they arrive as `$$css` styles. */
export function classNameToCssStyle(className) {
  const tokens = classTokens(className);
  if (!tokens.length) return null;
  const out = { $$css: true };
  for (const token of tokens) out[token] = token;
  return out;
}

export function withPressChromeStyle(style, props) {
  const className = pressChromeClassName(props) || props?.className;
  const cssStyle = Platform.OS === 'web' ? classNameToCssStyle(className) : null;
  const applyNativePress = Platform.OS !== 'web' && shouldApplyPressChrome(props);
  if (!cssStyle && !applyNativePress) return style;
  return (state) => {
    const resolved = typeof style === 'function' ? style(state) : style;
    return [resolved, cssStyle, applyNativePress && state.pressed ? { opacity: 0.82 } : null];
  };
}
