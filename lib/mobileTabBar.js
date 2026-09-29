import { useEffect, useRef } from 'react';
import { Animated, Platform } from 'react-native';
import { mobileSafeBottom } from './mobileUi';

export const TAB_BAR_SIDE_EXPANDED = 76;
export const TAB_BAR_SIDE_COLLAPSED = 100;
export const TAB_BAR_HEIGHT_EXPANDED = 54;
export const TAB_BAR_HEIGHT_COLLAPSED = 40;
export const TAB_BAR_BOTTOM_GAP = 14;

const COLLAPSE_PIXELS = 72;
const JUMP_PIXELS = 240;
const listeners = new Set();
const lastOffsets = new WeakMap();
let collapseValue = 0;

export function mobileTabBarReserve() {
  return TAB_BAR_HEIGHT_EXPANDED + TAB_BAR_BOTTOM_GAP + mobileSafeBottom();
}

export function getTabBarCollapse() {
  return collapseValue;
}

export function setTabBarCollapse(next) {
  const clamped = Math.max(0, Math.min(1, next));
  if (clamped === collapseValue) return;
  collapseValue = clamped;
  listeners.forEach((fn) => fn(clamped));
}

export function expandMobileTabBar() {
  setTabBarCollapse(0);
}

export function reportTabBarScrollDelta(dy) {
  if (!Number.isFinite(dy) || Math.abs(dy) < 0.5) return;
  setTabBarCollapse(collapseValue + dy / COLLAPSE_PIXELS);
}

export function reportTabBarScrollOffset(scroller, y) {
  if (!Number.isFinite(y)) return;
  const key = scroller || 'window';
  if (!lastOffsets.has(key)) {
    lastOffsets.set(key, y);
    if (y <= 16) expandMobileTabBar();
    return;
  }
  const last = lastOffsets.get(key);
  lastOffsets.set(key, y);
  const dy = y - last;
  if (Math.abs(dy) > JUMP_PIXELS) {
    if (y <= 24) expandMobileTabBar();
    return;
  }
  reportTabBarScrollDelta(dy);
}

export function subscribeTabBarCollapse(fn) {
  listeners.add(fn);
  fn(collapseValue);
  return () => listeners.delete(fn);
}

function scrollableElement(target) {
  if (typeof document === 'undefined') return null;
  if (!target || target === document || target === document.documentElement) {
    return document.scrollingElement || document.documentElement;
  }
  return target;
}

function isHorizontalOnly(el) {
  if (!el || typeof el.clientWidth !== 'number') return false;
  return el.scrollWidth > el.clientWidth + 8 && el.scrollHeight <= el.clientHeight + 8;
}

export function attachWebTabBarScrollListeners() {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return () => {};

  let lastTouchY = null;
  let lastGestureAt = 0;

  const fromTabBar = (event) => {
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
    return path.some((node) => node?.classList?.contains?.('cgold-mobile-tab-bar-dock'));
  };

  const onWheel = (event) => {
    if (fromTabBar(event)) return;
    if (Math.abs(event.deltaY) < Math.abs(event.deltaX)) return;
    lastGestureAt = Date.now();
    const dy = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
    reportTabBarScrollDelta(Math.max(-64, Math.min(64, dy)));
  };

  const onTouchStart = (event) => {
    lastTouchY = event.touches?.[0]?.clientY ?? null;
  };

  const onTouchMove = (event) => {
    if (fromTabBar(event)) return;
    const y = event.touches?.[0]?.clientY;
    if (!Number.isFinite(y) || !Number.isFinite(lastTouchY)) {
      lastTouchY = y;
      return;
    }
    lastGestureAt = Date.now();
    reportTabBarScrollDelta(lastTouchY - y);
    lastTouchY = y;
  };

  const onTouchEnd = () => {
    lastTouchY = null;
  };

  const onScroll = (event) => {
    if (Date.now() - lastGestureAt < 96) return;
    const el = scrollableElement(event.target);
    if (!el || isHorizontalOnly(el)) return;
    const y = typeof el.scrollTop === 'number' ? el.scrollTop : window.scrollY || 0;
    reportTabBarScrollOffset(el, y);
  };

  const opts = { capture: true, passive: true };
  document.addEventListener('wheel', onWheel, opts);
  document.addEventListener('touchstart', onTouchStart, opts);
  document.addEventListener('touchmove', onTouchMove, opts);
  document.addEventListener('touchend', onTouchEnd, opts);
  document.addEventListener('scroll', onScroll, opts);
  return () => {
    document.removeEventListener('wheel', onWheel, { capture: true });
    document.removeEventListener('touchstart', onTouchStart, { capture: true });
    document.removeEventListener('touchmove', onTouchMove, { capture: true });
    document.removeEventListener('touchend', onTouchEnd, { capture: true });
    document.removeEventListener('scroll', onScroll, { capture: true });
  };
}

export function useMobileTabBarCollapse() {
  const anim = useRef(new Animated.Value(collapseValue)).current;

  useEffect(() => subscribeTabBarCollapse((value) => anim.setValue(value)), [anim]);

  return anim;
}

export function useMobileTabBarScrollProps() {
  const lastY = useRef(0);
  const seen = useRef(false);

  if (Platform.OS === 'web') return { scrollEventThrottle: 16 };

  return {
    scrollEventThrottle: 16,
    onScroll: (event) => {
      const y = event?.nativeEvent?.contentOffset?.y;
      if (!Number.isFinite(y)) return;
      if (!seen.current) {
        seen.current = true;
        lastY.current = y;
        if (y <= 16) expandMobileTabBar();
        return;
      }
      const dy = y - lastY.current;
      lastY.current = y;
      if (Math.abs(dy) > JUMP_PIXELS) {
        if (y <= 24) expandMobileTabBar();
        return;
      }
      reportTabBarScrollDelta(dy);
    },
  };
}
