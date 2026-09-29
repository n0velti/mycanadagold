import { useEffect, useRef } from 'react';
import { Animated, Platform } from 'react-native';
import { mobileSafeBottom } from './mobileUi';

export const TAB_BAR_SIDE_EXPANDED = 56;
export const TAB_BAR_SIDE_COLLAPSED = 80;
export const TAB_BAR_HEIGHT_EXPANDED = 54;
export const TAB_BAR_HEIGHT_COLLAPSED = 40;
export const TAB_BAR_BOTTOM_GAP = 14;

const COLLAPSE_PIXELS = 72;
const JUMP_PIXELS = 240;
const TOP_PIXELS = 16;
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

function rememberOffset(scroller, y) {
  lastOffsets.set(scroller || 'window', y);
}

export function reportTabBarScrollOffset(scroller, y) {
  if (!Number.isFinite(y)) return;
  if (y <= TOP_PIXELS) {
    rememberOffset(scroller, y);
    expandMobileTabBar();
    return;
  }
  const key = scroller || 'window';
  if (!lastOffsets.has(key)) {
    rememberOffset(scroller, y);
    return;
  }
  const last = lastOffsets.get(key);
  rememberOffset(scroller, y);
  const dy = y - last;
  if (Math.abs(dy) > JUMP_PIXELS) return;
  reportTabBarScrollDelta(dy);
}

export function subscribeTabBarCollapse(fn) {
  listeners.add(fn);
  fn(collapseValue);
  return () => listeners.delete(fn);
}

const SCROLL_SLOP = 8;

function scrollableElement(target) {
  if (typeof document === 'undefined') return null;
  if (!target || target === document || target === document.documentElement) {
    return document.scrollingElement || document.documentElement;
  }
  return target;
}

function overflowYAllowsScroll(el) {
  if (typeof document === 'undefined') return false;
  if (el === document.scrollingElement || el === document.documentElement || el === document.body) {
    return true;
  }
  if (typeof getComputedStyle !== 'function') return true;
  const overflowY = getComputedStyle(el).overflowY;
  return overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay';
}

function canScrollVertically(el) {
  if (!el || typeof el.clientHeight !== 'number') return false;
  if (el.scrollHeight <= el.clientHeight + SCROLL_SLOP) return false;
  return overflowYAllowsScroll(el);
}

function canScrollNativeEvent(event) {
  const contentH = event?.nativeEvent?.contentSize?.height;
  const viewH = event?.nativeEvent?.layoutMeasurement?.height;
  if (!Number.isFinite(contentH) || !Number.isFinite(viewH)) return true;
  return contentH > viewH + SCROLL_SLOP;
}

function scrollerOffsetY(el) {
  if (!el) return 0;
  if (typeof el.scrollTop === 'number') return el.scrollTop;
  return typeof window !== 'undefined' ? window.scrollY || 0 : 0;
}

function expandIfAtTop(el) {
  if (!el) return false;
  const y = scrollerOffsetY(el);
  if (y > TOP_PIXELS) return false;
  rememberOffset(el, y);
  expandMobileTabBar();
  return true;
}

function verticalScrollerFromEvent(event) {
  const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
  for (const node of path) {
    if (node && canScrollVertically(node)) return node;
  }
  const el = scrollableElement(event.target);
  return el && canScrollVertically(el) ? el : null;
}

function isHorizontalOnly(el) {
  if (!el || typeof el.clientWidth !== 'number') return false;
  return el.scrollWidth > el.clientWidth + SCROLL_SLOP && el.scrollHeight <= el.clientHeight + SCROLL_SLOP;
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
    const scroller = verticalScrollerFromEvent(event);
    if (!scroller) {
      expandMobileTabBar();
      return;
    }
    if (expandIfAtTop(scroller)) return;
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
    const scroller = verticalScrollerFromEvent(event);
    if (!scroller) {
      lastTouchY = y;
      expandMobileTabBar();
      return;
    }
    if (expandIfAtTop(scroller)) {
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
    const el = scrollableElement(event.target);
    if (!el || isHorizontalOnly(el)) return;
    if (!canScrollVertically(el)) {
      expandMobileTabBar();
      return;
    }
    if (expandIfAtTop(el)) return;
    if (Date.now() - lastGestureAt < 96) return;
    reportTabBarScrollOffset(el, scrollerOffsetY(el));
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
      if (!canScrollNativeEvent(event)) {
        expandMobileTabBar();
        return;
      }
      const y = event?.nativeEvent?.contentOffset?.y;
      if (!Number.isFinite(y)) return;
      if (y <= TOP_PIXELS) {
        seen.current = true;
        lastY.current = y;
        expandMobileTabBar();
        return;
      }
      if (!seen.current) {
        seen.current = true;
        lastY.current = y;
        return;
      }
      const dy = y - lastY.current;
      lastY.current = y;
      if (Math.abs(dy) > JUMP_PIXELS) return;
      reportTabBarScrollDelta(dy);
    },
  };
}
