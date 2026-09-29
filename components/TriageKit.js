/**
 * Shared building blocks for the Triage app.
 *
 * Every triage surface (dashboard, results lots, review drawer)
 * pulls its tokens and primitives from here so the app reads as one product:
 * one type ramp, one set of status colours, one drawer, one empty state.
 */
import { Component, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Easing,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { CANVAS, mobileSafeBottom, mobileSafeTop, useIsMobile } from '../lib/mobileUi';
import { mobileTabBarReserve, useMobileTabBarScrollProps } from '../lib/mobileTabBar';
import { ClockedInMark, useIsClockedIn } from '../lib/clockedIn';

export const FONT = Platform.select({
  ios: 'Sohne',
  android: 'Sohne',
  default: 'Sohne',
});

export const T = {
  bg: CANVAS,
  card: '#FFFFFF',
  text: '#1a1a1a',
  secondary: '#8e8e93',
  tertiary: '#C7C7CC',
  fill: '#ffffff',
  fillSoft: 'rgba(0,0,0,0.04)',
  hairline: '#d0d0d0',
  blue: '#1a1a1a',
  green: '#1F8A4E',
  orange: '#C2410C',
  red: '#B91C1C',
  purple: '#6D28D9',
};

if (Platform.OS === 'web' && typeof document !== 'undefined') {
  const styleId = 'cgold-triage-kit';
  let style = document.getElementById(styleId);
  if (!style) {
    style = document.createElement('style');
    style.id = styleId;
    document.head.appendChild(style);
  }
  style.textContent = [
    '.cgold-triage-btn{cursor:pointer;}',
    '.cgold-triage-btn:hover{background-color:#f5f5f5!important;}',
    '.cgold-triage-btn.cgold-triage-btn-fill:hover{background-color:#333!important;}',
    '.cgold-triage-btn.cgold-triage-btn-green:hover{background-color:#176b3c!important;}',
  ].join('');
}

export const TONES = {
  neutral: { fg: T.secondary, bg: 'rgba(0,0,0,0.05)' },
  blue: { fg: T.text, bg: 'rgba(0,0,0,0.06)' },
  green: { fg: '#15803D', bg: 'rgba(31,138,78,0.12)' },
  orange: { fg: '#C2410C', bg: 'rgba(194,65,12,0.10)' },
  red: { fg: '#B91C1C', bg: 'rgba(185,28,28,0.10)' },
  purple: { fg: '#6D28D9', bg: 'rgba(109,40,217,0.10)' },
};

export const DRAWER_OPEN_MS = 280;
export const DRAWER_CLOSE_MS = 220;

const webCursor = Platform.select({ web: { cursor: 'pointer' }, default: {} });

/** Ask before a destructive action; uses window.confirm on web, Alert elsewhere. */
export function confirmDestructive(title, message, onConfirm, confirmLabel = 'Delete') {
  if (Platform.OS === 'web') {
    const ok =
      typeof window !== 'undefined' && window.confirm([title, message].filter(Boolean).join('\n\n'));
    if (ok) onConfirm();
    return;
  }
  Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel' },
    { text: confirmLabel, style: 'destructive', onPress: onConfirm },
  ]);
}

/** Keep the last non-null value so a closing drawer can still render its content. */
export function useHeldValue(value) {
  const held = useRef(value);
  if (value != null) held.current = value;
  return value ?? held.current;
}

export class TriageErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, resetKey: props.resetKey };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  static getDerivedStateFromProps(props, state) {
    if (props.resetKey !== state.resetKey) return { error: null, resetKey: props.resetKey };
    return null;
  }

  componentDidCatch(error, info) {
    console.warn('Triage view crashed', error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    if (this.props.fallback) return this.props.fallback;
    return (
      <EmptyState
        icon="warning-outline"
        title="Couldn’t open this"
        body={String(this.state.error?.message || this.state.error)}
        action={
          this.props.onReset ? (
            <TextAction label="Back" strong onPress={this.props.onReset} />
          ) : null
        }
      />
    );
  }
}

/** Slide-from-right drawer animation with mount/unmount handling. */
export function useRightDrawerAnimation(visible, slideDistance) {
  const [mounted, setMounted] = useState(visible);
  const slide = useRef(new Animated.Value(slideDistance)).current;
  const backdrop = useRef(new Animated.Value(0)).current;
  const slideDistanceRef = useRef(slideDistance);
  const activeAnim = useRef(null);
  slideDistanceRef.current = slideDistance;

  const stopActiveAnim = () => {
    if (activeAnim.current) {
      activeAnim.current.stop();
      activeAnim.current = null;
    }
  };

  useEffect(() => {
    if (!mounted) slide.setValue(slideDistance);
  }, [slideDistance, mounted, slide]);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      return undefined;
    }
    if (!mounted) return undefined;

    stopActiveAnim();
    const anim = Animated.parallel([
      Animated.timing(slide, {
        toValue: slideDistanceRef.current,
        duration: DRAWER_CLOSE_MS,
        easing: Easing.bezier(0.4, 0, 0.2, 1),
        useNativeDriver: true,
      }),
      Animated.timing(backdrop, {
        toValue: 0,
        duration: DRAWER_CLOSE_MS,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    ]);
    activeAnim.current = anim;
    anim.start(({ finished }) => {
      if (activeAnim.current === anim) activeAnim.current = null;
      if (finished) setMounted(false);
    });
    return () => {
      if (activeAnim.current === anim) {
        anim.stop();
        activeAnim.current = null;
      }
    };
  }, [visible, mounted, slide, backdrop]);

  useLayoutEffect(() => {
    if (!visible || !mounted) return undefined;

    stopActiveAnim();
    slide.setValue(slideDistanceRef.current);
    backdrop.setValue(0);

    let cancelled = false;
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        if (cancelled) return;
        const anim = Animated.parallel([
          Animated.timing(slide, {
            toValue: 0,
            duration: DRAWER_OPEN_MS,
            easing: Easing.bezier(0.22, 1, 0.36, 1),
            useNativeDriver: true,
          }),
          Animated.timing(backdrop, {
            toValue: 1,
            duration: DRAWER_OPEN_MS,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
        ]);
        activeAnim.current = anim;
        anim.start(({ finished }) => {
          if (finished && activeAnim.current === anim) activeAnim.current = null;
        });
      });
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [visible, mounted, slide, backdrop]);

  return { mounted, slide, backdrop };
}

/**
 * Right-hand drawer shell with an iOS-style nav bar.
 * Renders children inside the panel; callers own scrolling.
 */
const SIDEBAR_EXPANDED = 252;

function useSidebarInset(enabled) {
  const { width } = useWindowDimensions();
  const [inset, setInset] = useState(SIDEBAR_EXPANDED);

  useEffect(() => {
    if (!enabled) return undefined;
    if (Platform.OS !== 'web' || typeof document === 'undefined') {
      setInset(width < 768 ? 0 : SIDEBAR_EXPANDED);
      return undefined;
    }
    const el =
      document.getElementById('cgold-sidebar') ||
      document.querySelector('[data-testid="cgold-sidebar"]');
    if (!el) {
      setInset(SIDEBAR_EXPANDED);
      return undefined;
    }
    const read = () => {
      const next = Math.round(el.getBoundingClientRect().width);
      if (Number.isFinite(next) && next > 0) setInset(next);
    };
    read();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(read) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [enabled, width]);

  return enabled ? inset : 0;
}

export function TriageDrawer({
  visible,
  onClose,
  title,
  subtitle,
  leftLabel = 'Done',
  onLeft,
  rightLabel,
  onRight,
  rightDisabled = false,
  rightEmphasis = true,
  rightLeading,
  widthRatio = 0.46,
  minWidth = 400,
  coloredNav = false,
  hideNav = false,
  flushToSidebar = false,
  children,
}) {
  const { width: windowWidth } = useWindowDimensions();
  const width = Number(windowWidth) > 0 ? Number(windowWidth) : 1024;
  const isMobile = width < 768;
  const sidebarInset = useSidebarInset(flushToSidebar && !isMobile);
  const panelWidth = isMobile
    ? Math.max(width, 240)
    : flushToSidebar
      ? Math.max(240, Math.round(width - sidebarInset))
      : Math.min(Math.max(Math.round(width * widthRatio), minWidth), Math.max(240, Math.round(width - 64)));
  const { mounted, slide, backdrop } = useRightDrawerAnimation(visible, panelWidth);

  if (!mounted) return null;

  return (
    <Modal visible={mounted} transparent animationType="none" onRequestClose={onClose}>
      <View style={styles.drawerRoot} pointerEvents="box-none">
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close">
          <Animated.View style={[styles.drawerBackdrop, { opacity: backdrop }]} />
        </Pressable>
        <Animated.View
          pointerEvents="auto"
          style={[
            styles.drawerPanel,
            isMobile && styles.drawerPanelMobile,
            { width: panelWidth, transform: [{ translateX: slide }] },
          ]}
        >
          {hideNav ? null : (
            <View
              style={[
                styles.drawerNav,
                coloredNav && styles.drawerNavColored,
                isMobile && styles.drawerNavMobile,
              ]}
              {...(Platform.OS === 'web' && isMobile ? { className: 'cgold-mobile-sheet-top' } : null)}
            >
              <Pressable
                onPress={onLeft || onClose}
                hitSlop={coloredNav ? 0 : 8}
                style={[
                  styles.drawerNavSide,
                  isMobile && styles.drawerNavSideMobile,
                  coloredNav && styles.navBtn,
                  coloredNav && styles.navBtnNeutral,
                ]}
                accessibilityRole="button"
                accessibilityLabel={leftLabel}
              >
                <Text style={coloredNav ? styles.navBtnNeutralText : styles.drawerNavAction}>{leftLabel}</Text>
              </Pressable>
              <View style={styles.drawerNavTitleBlock}>
                <Text style={[styles.drawerNavTitle, coloredNav && styles.drawerNavTitleOnColor]} numberOfLines={1}>
                  {title}
                </Text>
                {subtitle ? (
                  <Text style={[styles.drawerNavSubtitle, coloredNav && styles.drawerNavSubtitleOnColor]} numberOfLines={1}>
                    {subtitle}
                  </Text>
                ) : null}
              </View>
              <View style={[styles.drawerNavSide, styles.drawerNavSideRight, isMobile && styles.drawerNavSideMobile]}>
                {isMobile ? null : rightLeading}
                <Pressable
                  onPress={onRight}
                  hitSlop={coloredNav ? 0 : 8}
                  disabled={!onRight || rightDisabled}
                  style={
                    coloredNav && rightLabel
                      ? [
                          styles.navBtn,
                          rightLabel === 'Done' ? styles.navBtnDone : styles.navBtnPrimary,
                          rightDisabled && styles.drawerNavActionDisabled,
                        ]
                      : null
                  }
                  accessibilityRole="button"
                  accessibilityLabel={rightLabel || ''}
                >
                  {rightLabel ? (
                    <Text
                      style={
                        coloredNav
                          ? styles.navBtnPrimaryText
                          : [
                              styles.drawerNavAction,
                              rightEmphasis && styles.drawerNavActionStrong,
                              rightDisabled && styles.drawerNavActionDisabled,
                            ]
                      }
                    >
                      {rightLabel}
                    </Text>
                  ) : null}
                </Pressable>
              </View>
            </View>
          )}
          {hideNav || !isMobile || !rightLeading ? null : (
            <View style={[styles.drawerSubNav, coloredNav && styles.drawerSubNavColored]}>{rightLeading}</View>
          )}
          <View style={styles.drawerBody}>{children}</View>
        </Animated.View>
      </View>
    </Modal>
  );
}

export function EmptyState({ icon, title, body, action }) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>
        <Ionicons name={icon} size={30} color={T.secondary} />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      {body ? <Text style={styles.emptyBody}>{body}</Text> : null}
      {action ? <View style={styles.emptyAction}>{action}</View> : null}
    </View>
  );
}

/** Text-only tabs with a thin underline, used at every level of the app. */
export function TextTabs({ options, value, onChange, leading, trailing, size = 'md', layout = 'bar', style }) {
  const isMobile = useIsMobile();
  const inline = layout === 'inline';
  const tabs = options.map((option) => {
    const active = option.key === value;
    return (
      <Pressable
        key={option.key}
        style={[
          styles.tab,
          size === 'lg' && styles.tabLg,
          isMobile && styles.tabMobile,
          inline && styles.tabInline,
        ]}
        onPress={() => onChange(option.key)}
        accessibilityRole="tab"
        accessibilityState={{ selected: active }}
        accessibilityLabel={option.label}
      >
        <View style={styles.tabLabelRow}>
          <Text
            style={[
              styles.tabLabel,
              size === 'lg' && styles.tabLabelLg,
              active && styles.tabLabelActive,
            ]}
            numberOfLines={1}
          >
            {option.label}
          </Text>
          {option.count != null ? (
            <Text style={[styles.tabCount, active && styles.tabCountActive]}>{option.count}</Text>
          ) : null}
        </View>
        <View style={[styles.tabLine, size === 'lg' && styles.tabLineLg, inline && styles.tabLineInline, active && styles.tabLineActive]} />
      </Pressable>
    );
  });

  const tabRow = isMobile && !inline ? (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.tabsMobile}
      style={styles.tabsMobileScroll}
    >
      {tabs}
    </ScrollView>
  ) : (
    <View style={[styles.tabs, size === 'lg' && styles.tabsLg, inline && styles.tabsInline]}>{tabs}</View>
  );

  if (inline) {
    return (
      <View
        style={[styles.tabBarInline, size === 'lg' && styles.tabBarInlineLg, style]}
        accessibilityRole="tablist"
      >
        {tabRow}
      </View>
    );
  }

  const leadingNode = leading ? (
    <View
      style={[
        styles.tabLeading,
        size === 'lg' && styles.tabLeadingLg,
        isMobile && styles.tabLeadingMobile,
      ]}
    >
      {leading}
    </View>
  ) : null;

  const stable = size === 'lg' && !isMobile;

  return (
    <View
      style={[
        styles.tabBar,
        size === 'lg' && styles.tabBarLg,
        isMobile ? styles.tabBarMobile : stable && styles.tabBarStable,
        style,
      ]}
      accessibilityRole="tablist"
    >
      {isMobile ? (
        <View style={styles.tabMainMobile}>
          {leadingNode}
          {tabRow}
        </View>
      ) : stable ? (
        <View style={[styles.tabSlot, styles.tabSlotStart, styles.tabSlotLg]}>{leading}</View>
      ) : (
        leadingNode
      )}
      {isMobile ? null : tabRow}
      {isMobile ? (
        trailing ? (
          <View
            style={[
              styles.tabTrailing,
              size === 'lg' && styles.tabTrailingLg,
              styles.tabTrailingMobile,
            ]}
          >
            {trailing}
          </View>
        ) : null
      ) : stable ? (
        <View style={[styles.tabSlot, styles.tabSlotEnd, styles.tabSlotLg]}>{trailing}</View>
      ) : trailing ? (
        <View style={[styles.tabTrailing, size === 'lg' && styles.tabTrailingLg]}>{trailing}</View>
      ) : null}
    </View>
  );
}

/** iOS segmented slider: gray track with a sliding white thumb. */
export function SegmentedSlider({ options, value, onChange, style, fill = false, compact = false }) {
  const isMobile = useIsMobile();
  const keys = (options || []).map((option) => option.key);
  const found = keys.indexOf(value);
  const matched = found >= 0;
  const index = matched ? found : 0;
  const [trackW, setTrackW] = useState(0);
  const slide = useRef(new Animated.Value(index)).current;
  const inset = 0;
  const count = Math.max(keys.length, 1);
  const segW = Math.max(0, (trackW - inset * 2) / count);

  useEffect(() => {
    Animated.spring(slide, {
      toValue: index,
      useNativeDriver: true,
      damping: 26,
      stiffness: 420,
      mass: 0.72,
    }).start();
  }, [index, slide]);

  return (
    <View
      style={[
        styles.segmentedSlider,
        fill && styles.segmentedSliderFill,
        isMobile && styles.segmentedSliderMobile,
        compact && styles.segmentedSliderCompact,
        style,
      ]}
      onLayout={(event) => setTrackW(event.nativeEvent.layout.width)}
      accessibilityRole="tablist"
    >
      {matched && segW > 0 && keys.length > 1 ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.segmentedThumb,
            {
              width: segW,
              transform: [
                {
                  translateX: slide.interpolate({
                    inputRange: keys.map((_, i) => i),
                    outputRange: keys.map((_, i) => i * segW),
                  }),
                },
              ],
            },
          ]}
        />
      ) : matched && segW > 0 ? (
        <View pointerEvents="none" style={[styles.segmentedThumb, { width: segW }]} />
      ) : null}
      {(options || []).map((option) => {
        const active = option.key === value;
        return (
          <Pressable
            key={option.key}
            style={[styles.segmentedHit, isMobile && styles.segmentedHitMobile, compact && styles.segmentedHitCompact]}
            onPress={() => onChange(option.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={option.label}
          >
            <Text
              style={[
                styles.segmentedLabel,
                compact && styles.segmentedLabelCompact,
                active && styles.segmentedLabelActive,
              ]}
              numberOfLines={1}
            >
              {option.label}
            </Text>
            {option.count != null ? (
              <Text style={[styles.segmentedCount, active && styles.segmentedCountActive]}>{option.count}</Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

/** Toolbar button. `fill` is the blue primary. `tone="green"` is the same shape in green. */
export function BarButton({ label, icon, onPress, disabled, accessibilityLabel, size, fill, tone }) {
  const large = size === 'lg';
  const green = tone === 'green';
  const iconColor = fill || green ? '#fff' : T.text;
  return (
    <Pressable
      style={[
        styles.barButton,
        large && styles.barButtonLg,
        fill && !green && styles.barButtonFill,
        green && styles.barButtonGreen,
        disabled && styles.textActionDisabled,
      ]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || label}
      {...(Platform.OS === 'web'
        ? {
            className: green
              ? 'cgold-triage-btn cgold-triage-btn-green'
              : fill
                ? 'cgold-triage-btn cgold-triage-btn-fill'
                : 'cgold-triage-btn',
          }
        : null)}
    >
      {icon ? <Ionicons name={icon} size={large ? 18 : 15} color={iconColor} /> : null}
      <Text style={[styles.barButtonLabel, large && styles.barButtonLabelLg, (fill || green) && styles.barButtonLabelFill]}>
        {label}
      </Text>
    </Pressable>
  );
}

/** Blue iOS text button, optional leading icon. */
export function TextAction({ label, icon, onPress, disabled, destructive, strong, accessibilityLabel }) {
  return (
    <Pressable
      style={[styles.textAction, disabled && styles.textActionDisabled]}
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || label}
    >
      {icon ? <Ionicons name={icon} size={17} color={destructive ? T.red : T.text} /> : null}
      <Text
        style={[
          styles.textActionLabel,
          strong && styles.textActionStrong,
          destructive && styles.textActionDestructive,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** Small round icon button for toolbars. */
export function IconAction({ icon, onPress, accessibilityLabel, active, size = 18 }) {
  return (
    <Pressable
      style={[styles.iconAction, active && styles.iconActionActive]}
      onPress={onPress}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={active != null ? { selected: Boolean(active) } : undefined}
    >
      <Ionicons name={icon} size={size} color={T.text} />
    </Pressable>
  );
}

export function StatusPill({ label, tone = 'neutral', compact }) {
  const colors = TONES[tone] || TONES.neutral;
  return (
    <View style={[styles.pill, compact && styles.pillCompact, { backgroundColor: colors.bg }]}>
      <Text style={[styles.pillText, compact && styles.pillTextCompact, { color: colors.fg }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

export function ProgressBar({
  value = 0,
  total = 0,
  tone = 'green',
  height = 4,
  style,
  trackColor,
  fillColor,
}) {
  const pct = total > 0 ? Math.max(0, Math.min(1, value / total)) : 0;
  const colors = TONES[tone] || TONES.green;
  return (
    <View
      style={[
        styles.progressTrack,
        { height, borderRadius: height / 2 },
        trackColor ? { backgroundColor: trackColor } : null,
        style,
      ]}
    >
      <View
        style={[
          styles.progressFill,
          {
            width: `${Math.round(pct * 100)}%`,
            backgroundColor: fillColor || colors.fg,
            borderRadius: height / 2,
          },
        ]}
      />
    </View>
  );
}

/** Row of compact statistics (label over value) inside a white card. */
export function StatStrip({ children, style }) {
  return <View style={[styles.statStrip, style]}>{children}</View>;
}

export function Stat({ label, value, sub, tone, onPress, active, flex = 1 }) {
  const colors = tone ? TONES[tone] : null;
  const Wrapper = onPress ? Pressable : View;
  return (
    <Wrapper
      style={[styles.stat, { flex }, onPress && styles.statPress, active && styles.statActive]}
      onPress={onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityState={onPress ? { selected: Boolean(active) } : undefined}
    >
      <Text style={styles.statLabel} numberOfLines={1}>
        {label}
      </Text>
      <Text style={[styles.statValue, colors && { color: colors.fg }]} numberOfLines={1}>
        {value}
      </Text>
      {sub ? (
        <Text style={styles.statSub} numberOfLines={1}>
          {sub}
        </Text>
      ) : null}
    </Wrapper>
  );
}

/** Selectable chip with an optional count badge. */
export function Chip({ label, count, selected, onPress, tone }) {
  const colors = tone ? TONES[tone] : null;
  return (
    <Pressable
      style={[
        styles.chip,
        selected && styles.chipOn,
        selected && colors && { backgroundColor: colors.fg },
      ]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: Boolean(selected) }}
      accessibilityLabel={count != null ? `${label}, ${count}` : label}
    >
      <Text style={[styles.chipText, selected && styles.chipTextOn]} numberOfLines={1}>
        {label}
      </Text>
      {count != null ? (
        <Text style={[styles.chipCount, selected && styles.chipCountOn]}>{count}</Text>
      ) : null}
    </Pressable>
  );
}

export function SectionLabel({ children, trailing, style }) {
  return (
    <View style={[styles.sectionLabelRow, style]}>
      <Text style={styles.sectionLabel}>{children}</Text>
      {trailing}
    </View>
  );
}

export function Group({ children, style }) {
  return <View style={[styles.group, style]}>{children}</View>;
}

function initialsFromName(name) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

/**
 * `ring` draws the clocked-in gradient around the portrait even when the
 * live name match has not caught up yet.
 */
export function StaffAvatar({ uri, name, size = 24, ring }) {
  const [failed, setFailed] = useState(false);
  const clockedIn = useIsClockedIn(name) || Boolean(ring);
  useEffect(() => {
    setFailed(false);
  }, [uri]);
  const showImage = Boolean(uri) && !failed;
  const label = String(name || '').trim();
  const avatar = (
    <View
      accessibilityLabel={clockedIn ? undefined : label || 'Employee'}
      style={[
        styles.staffAvatar,
        { width: size, height: size, borderRadius: size / 2 },
        !showImage && styles.staffAvatarFallback,
        Platform.OS === 'web' ? { cursor: 'default' } : null,
      ]}
      {...(Platform.OS === 'web' && label && !clockedIn ? { title: label } : null)}
    >
      {showImage ? (
        <Image
          source={{ uri }}
          style={{ width: size, height: size, borderRadius: size / 2 }}
          onError={() => setFailed(true)}
        />
      ) : (
        <Text style={[styles.staffAvatarInitials, { fontSize: Math.max(10, Math.round(size * 0.32)) }]}>
          {initialsFromName(name)}
        </Text>
      )}
    </View>
  );
  return (
    <ClockedInMark name={label} size={size} force={Boolean(ring)}>
      {avatar}
    </ClockedInMark>
  );
}

export function StaffPerson({ name, avatarUrl, extra, size = 24 }) {
  const label = String(name || '').trim() || '—';
  return (
    <View style={styles.staffPerson}>
      <StaffAvatar uri={avatarUrl} name={label} size={size} />
      <Text style={styles.staffPersonName} numberOfLines={1}>
        {extra ? `${label}${extra}` : label}
      </Text>
    </View>
  );
}

export function GroupRow({ label, value, valueTone, last, onPress, children }) {
  const colors = valueTone ? TONES[valueTone] : null;
  const Row = onPress ? Pressable : View;
  return (
    <Row
      style={[styles.groupRow, last && styles.groupRowLast]}
      onPress={onPress}
      accessibilityRole={onPress ? 'button' : undefined}
    >
      <Text style={styles.groupRowLabel}>{label}</Text>
      {children ? (
        children
      ) : (
        <Text style={[styles.groupRowValue, colors && { color: colors.fg }]} numberOfLines={2}>
          {value == null || value === '' ? '—' : value}
        </Text>
      )}
      {onPress ? <Ionicons name="chevron-forward" size={16} color={T.tertiary} /> : null}
    </Row>
  );
}

/** Dark gold hero used on Home and store details. */
export function ChromeHero({ value, stats, wide = false, onPress, accessibilityLabel, footer }) {
  const isMobile = useIsMobile();
  const body = (
    <>
      <Text
        style={[styles.chromeHeroAmount, (wide || !isMobile) && styles.chromeHeroAmountWide]}
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        {value}
      </Text>
      {stats?.length || footer ? (
        <View style={[(wide || !isMobile) && styles.chromeHeroSide, footer && styles.chromeHeroSideStack]}>
          {stats?.length ? (
            <View style={[styles.chromeHeroStats, (wide || !isMobile) && styles.chromeHeroStatsWide]}>
              {stats.map((stat, index) => (
                <View key={stat.label} style={styles.chromeHeroStatWrap}>
                  {index ? <View style={styles.chromeHeroStatDivider} /> : null}
                  <View style={styles.chromeHeroStat}>
                    <Text style={styles.chromeHeroStatValue} numberOfLines={1}>
                      {stat.value}
                    </Text>
                    <Text style={styles.chromeHeroStatLabel} numberOfLines={1}>
                      {stat.label}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          ) : null}
          {footer}
        </View>
      ) : null}
    </>
  );
  const cardStyle = [styles.chromeHeroCard, (wide || !isMobile) && styles.chromeHeroCardWide];
  return (
    <View style={styles.chromeHeroShell}>
      <View pointerEvents="none" style={styles.chromeHeroLift} />
      {onPress ? (
        <Pressable
          style={cardStyle}
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
        >
          {body}
        </Pressable>
      ) : (
        <View style={cardStyle} accessibilityLabel={accessibilityLabel}>
          {body}
        </View>
      )}
    </View>
  );
}

/** White lifted sheet that sits under the hero, matching Home / store details. */
export function ChromeSheet({ title, meta, children, style }) {
  const isMobile = useIsMobile();
  return (
    <View style={[styles.chromeSheet, style]}>
      {title ? (
        <View style={styles.chromeSheetHead}>
          <Text style={styles.chromeSheetTitle}>{title}</Text>
          {meta ? <Text style={styles.chromeSheetMeta}>{meta}</Text> : null}
        </View>
      ) : null}
      <View style={[styles.chromeSheetBody, isMobile && styles.chromeSheetBodyMobile]}>{children}</View>
    </View>
  );
}

/** Store-row used on Home: icon tile, title, meta, value, chevron. */
export function ChromeListRow({
  title,
  meta,
  value,
  icon,
  iconColor = '#1a1a1a',
  leading,
  last,
  onPress,
  chevron = true,
  trailing,
  extra,
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ hovered, pressed }) => [
        styles.chromeRow,
        (hovered || pressed) && onPress && styles.chromeRowHover,
      ]}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={value ? `${title}, ${value}` : title}
      {...(Platform.OS === 'web' && onPress ? { className: 'cgold-triage-btn' } : null)}
    >
      {leading || (
        <View style={[styles.chromeRowIcon, { backgroundColor: iconColor }]}>
          <Ionicons name={icon} size={22} color="#fff" />
        </View>
      )}
      <View style={[styles.chromeRowBody, !last && styles.chromeRowDivider]}>
        <View style={styles.chromeRowCopy}>
          <Text style={styles.chromeRowTitle} numberOfLines={1}>
            {title}
          </Text>
          {meta ? (
            <Text style={styles.chromeRowMeta} numberOfLines={1}>
              {meta}
            </Text>
          ) : null}
          {extra}
        </View>
        {value != null && value !== '' ? (
          <Text style={styles.chromeRowValue} numberOfLines={1}>
            {value}
          </Text>
        ) : null}
        {trailing}
        {onPress && chevron ? (
          <Ionicons name="chevron-forward" size={18} color="#c7c7cc" />
        ) : (
          <View style={styles.chromeRowChevron} />
        )}
      </View>
    </Pressable>
  );
}

/** Hero + sheet page used by every triage surface. */
export function ChromePage({ hero, title, meta, children, empty, footer }) {
  const isMobile = useIsMobile();
  const tabBarScroll = useMobileTabBarScrollProps();
  const heroLift = useRef(new Animated.Value(1)).current;
  const [heroHeight, setHeroHeight] = useState(isMobile ? 220 : 200);
  const restGap = isMobile ? 10 : 18;
  const raisedOffset = hero ? Math.max(0, heroHeight + restGap) : 0;

  return (
    <View style={[styles.chromePage, isMobile && styles.chromePageMobile]}>
      {hero ? (
        <View
          pointerEvents="box-none"
          style={styles.chromePinnedHero}
          onLayout={(event) => {
            const height = event.nativeEvent.layout.height;
            setHeroHeight((current) => (Math.abs(current - height) < 0.5 ? current : height));
          }}
        >
          <Animated.View pointerEvents="none" style={[styles.chromePinnedLift, { opacity: heroLift }]} />
          <View style={[styles.chromeHeroPad, !isMobile && styles.chromeHeroPadDesktop]}>{hero}</View>
        </View>
      ) : null}
      <ScrollView
        pointerEvents="box-none"
        style={styles.chromeOverlayScroll}
        contentContainerStyle={[
          styles.chromePageContent,
          isMobile && styles.chromePageContentMobile,
          { flexGrow: 1 },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        {...tabBarScroll}
        onScroll={(event) => {
          tabBarScroll.onScroll?.(event);
          const y = event?.nativeEvent?.contentOffset?.y;
          if (!Number.isFinite(y) || !hero) return;
          const reach = Math.max(1, heroHeight - 12);
          heroLift.setValue(1 - Math.max(0, Math.min(1, y / reach)));
        }}
        {...(Platform.OS === 'web' ? { className: 'cgold-home-overlay-scroll cgold-store-overlay-scroll' } : null)}
      >
        {hero ? <View pointerEvents="none" style={{ height: raisedOffset }} /> : null}
        {empty || (
          <View
            pointerEvents="auto"
            style={styles.chromeOverlaySheet}
            {...(Platform.OS === 'web' ? { className: 'cgold-store-sheet' } : null)}
          >
            <ChromeSheet title={title} meta={meta} style={styles.chromeSheetGrow}>
              {children}
            </ChromeSheet>
          </View>
        )}
        {footer}
      </ScrollView>
    </View>
  );
}

export function SearchField({ value, onChangeText, placeholder = 'Search', style, autoFocus, size }) {
  const large = size === 'lg';
  return (
    <View style={[styles.search, large && styles.searchLg, style]}>
      <Ionicons name="search" size={large ? 18 : 15} color={T.secondary} />
      <TextInput
        style={[styles.searchInput, large && styles.searchInputLg]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={T.secondary}
        autoCapitalize="none"
        autoCorrect={false}
        autoFocus={autoFocus}
        accessibilityLabel={placeholder}
      />
      {value ? (
        <Pressable onPress={() => onChangeText('')} hitSlop={8} accessibilityLabel="Clear search">
          <Ionicons name="close-circle" size={large ? 18 : 16} color={T.tertiary} />
        </Pressable>
      ) : null}
    </View>
  );
}

/** Full-width camera control — primary way to attach a photo on a phone. */
export function MobileCameraButton({ count = 0, busy = false, disabled = false, onPress, accessibilityLabel }) {
  return (
    <Pressable
      onPress={(event) => {
        event?.stopPropagation?.();
        onPress?.();
      }}
      disabled={disabled || busy}
      hitSlop={4}
      style={[styles.mobileCam, (disabled || busy) && styles.mobileCamOff]}
      accessibilityRole="button"
      accessibilityLabel={
        accessibilityLabel || (count ? `Take a photo, ${count} attached` : 'Take a photo')
      }
    >
      <Ionicons name={busy ? 'ellipsis-horizontal' : 'camera'} size={22} color={disabled ? T.secondary : T.text} />
      {count > 0 ? (
        <View style={styles.mobileCamBadge} pointerEvents="none">
          <Text style={styles.mobileCamBadgeText}>{count > 9 ? '9+' : count}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

/** Inset grouped list used on every triage phone screen. */
export function MobileList({ children, style }) {
  return <View style={[styles.mobileList, style]}>{children}</View>;
}

export function MobileListRow({
  title,
  subtitle,
  meta,
  extra,
  leading,
  trailing,
  onPress,
  onLongPress,
  last,
  selected,
  chevron = true,
  accessibilityLabel,
  accessibilityHint,
}) {
  const highlight = useRef(new Animated.Value(0)).current;
  const interactive = Boolean(onPress || onLongPress);
  const restColor = selected ? '#f5f5f5' : '#ffffff';
  const backgroundColor = highlight.interpolate({
    inputRange: [0, 1],
    outputRange: [restColor, '#dcdce2'],
  });

  const tint = (toValue, duration = 140) => {
    Animated.timing(highlight, {
      toValue,
      duration,
      easing: Easing.out(Easing.quad),
      useNativeDriver: false,
    }).start();
  };

  const body = (
    <>
      {leading ? <View style={styles.mobileListLead}>{leading}</View> : null}
      <View style={styles.mobileListCopy}>
        <Text style={styles.mobileListTitle} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.mobileListSub} numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
        {meta ? (
          <Text style={styles.mobileListMeta} numberOfLines={1}>
            {meta}
          </Text>
        ) : null}
        {extra}
      </View>
      <View style={styles.mobileListTrail}>
        {trailing}
        {onPress && chevron ? <Ionicons name="chevron-forward" size={18} color={T.tertiary} /> : null}
      </View>
    </>
  );

  if (!interactive) {
    return (
      <View
        style={[
          styles.mobileListRow,
          selected && styles.mobileListRowSelected,
          last && styles.mobileListRowLast,
        ]}
      >
        {body}
      </View>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => tint(1, 80)}
      onPressOut={() => tint(0, 200)}
      onLongPress={
        onLongPress
          ? () => {
              tint(1, 60);
              onLongPress();
            }
          : undefined
      }
      delayLongPress={380}
      accessibilityRole="button"
      accessibilityState={onPress ? { selected: Boolean(selected) } : undefined}
      accessibilityLabel={accessibilityLabel || title}
      accessibilityHint={accessibilityHint}
    >
      <Animated.View
        style={[
          styles.mobileListRow,
          selected && styles.mobileListRowSelected,
          last && styles.mobileListRowLast,
          { backgroundColor },
        ]}
      >
        {body}
      </Animated.View>
    </Pressable>
  );
}

export function InlineNotice({ tone = 'neutral', icon, children, style }) {
  const colors = TONES[tone] || TONES.neutral;
  return (
    <View style={[styles.notice, { backgroundColor: colors.bg }, style]}>
      {icon ? <Ionicons name={icon} size={15} color={colors.fg} /> : null}
      <Text style={[styles.noticeText, { color: colors.fg }]}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  drawerRoot: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  drawerBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.28)',
  },
  drawerPanel: {
    height: '100%',
    maxHeight: '100%',
    flexDirection: 'column',
    overflow: 'hidden',
    backgroundColor: T.bg,
    ...Platform.select({
      web: { boxShadow: '-12px 0 32px rgba(0,0,0,0.18)' },
      default: { elevation: 12 },
    }),
  },
  drawerPanelMobile: {
    paddingBottom: Platform.OS === 'ios' ? Math.max(20, mobileSafeBottom()) : 12,
  },
  drawerBody: {
    flex: 1,
    minHeight: 0,
  },
  drawerNav: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
    paddingHorizontal: 12,
    backgroundColor: T.bg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: T.hairline,
  },
  drawerNavColored: {
    minHeight: 60,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: '#FFF1E4',
    borderBottomColor: 'rgba(194,65,12,0.18)',
    gap: 8,
  },
  navBtn: {
    width: 'auto',
    minWidth: 72,
    minHeight: 34,
    paddingHorizontal: 12,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navBtnNeutral: {
    backgroundColor: '#fff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(194,65,12,0.22)',
  },
  navBtnNeutralText: {
    fontFamily: FONT,
    fontSize: 15,
    fontWeight: '600',
    color: '#C2410C',
  },
  navBtnPrimary: {
    backgroundColor: T.text,
  },
  navBtnDone: {
    backgroundColor: T.green,
  },
  navBtnPrimaryText: {
    fontFamily: FONT,
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },
  drawerNavTitleOnColor: {
    color: '#9A3412',
  },
  drawerNavSubtitleOnColor: {
    color: '#C2410C',
  },
  drawerNavMobile: {
    paddingTop: Platform.OS === 'ios' ? mobileSafeTop() - 12 : 6,
    paddingHorizontal: 10,
  },
  drawerNavSide: {
    width: 84,
    minHeight: 44,
    justifyContent: 'center',
    ...webCursor,
  },
  drawerNavSideMobile: {
    width: 'auto',
    minWidth: 56,
    flexShrink: 0,
  },
  drawerNavSideRight: {
    width: 'auto',
    minWidth: 84,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 14,
  },
  drawerSubNav: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: T.hairline,
    backgroundColor: T.bg,
  },
  drawerSubNavColored: {
    backgroundColor: '#FFF1E4',
    borderBottomColor: 'rgba(194,65,12,0.18)',
  },
  drawerNavAction: {
    fontFamily: FONT,
    fontSize: 16,
    fontWeight: '400',
    color: T.text,
  },
  drawerNavActionStrong: {
    fontWeight: '600',
  },
  drawerNavActionDisabled: {
    opacity: 0.35,
  },
  drawerNavTitleBlock: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
  },
  drawerNavTitle: {
    fontFamily: FONT,
    fontSize: 16,
    fontWeight: '600',
    color: T.text,
    letterSpacing: -0.3,
    textAlign: 'center',
  },
  drawerNavSubtitle: {
    fontFamily: FONT,
    fontSize: 12,
    color: T.secondary,
    textAlign: 'center',
  },
  empty: {
    flex: 1,
    minHeight: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 24,
    paddingBottom: 40,
  },
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: T.hairline,
    marginBottom: 6,
  },
  emptyTitle: {
    fontFamily: FONT,
    fontSize: 17,
    fontWeight: '600',
    color: T.text,
    letterSpacing: -0.4,
  },
  emptyBody: {
    fontFamily: FONT,
    fontSize: 13,
    lineHeight: 18,
    color: T.secondary,
    textAlign: 'center',
    maxWidth: 320,
  },
  emptyAction: {
    marginTop: 10,
  },
  tabBar: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 16,
    paddingHorizontal: 20,
    paddingTop: 8,
    backgroundColor: T.bg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: T.hairline,
  },
  tabBarLg: {
    paddingHorizontal: 24,
    paddingTop: 12,
  },
  tabBarStable: {
    alignItems: 'stretch',
    gap: 16,
  },
  tabBarInline: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 0,
    paddingTop: 0,
    backgroundColor: 'transparent',
    borderBottomWidth: 0,
    gap: 0,
  },
  tabBarInlineLg: {
    paddingHorizontal: 0,
    paddingTop: 0,
  },
  tabBarMobile: {
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 10,
    backgroundColor: T.bg,
  },
  tabs: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 20,
  },
  tabSlot: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: 8,
  },
  tabSlotLg: {
    paddingBottom: 10,
  },
  tabSlotStart: {
    width: 268,
    flexGrow: 0,
    flexShrink: 0,
    justifyContent: 'flex-start',
  },
  tabSlotEnd: {
    flexGrow: 0,
    flexShrink: 0,
    justifyContent: 'flex-end',
    gap: 8,
  },
  tabLeading: {
    flexShrink: 0,
    alignSelf: 'center',
    marginRight: 20,
  },
  tabLeadingLg: {
    marginRight: 24,
  },
  tabLeadingMobile: {
    marginRight: 12,
    alignSelf: 'center',
  },
  tabMainMobile: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 0,
    width: '100%',
  },
  tabsMobileScroll: {
    flex: 1,
    minWidth: 0,
  },
  tabsLg: {
    gap: 28,
  },
  tabsInline: {
    flexGrow: 0,
    flexShrink: 0,
    flex: 0,
    alignSelf: 'flex-end',
  },
  tabsMobile: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 16,
    paddingRight: 8,
  },
  tab: {
    paddingTop: 10,
    paddingHorizontal: 2,
    alignItems: 'center',
    ...webCursor,
  },
  tabLg: {
    paddingTop: 12,
    paddingHorizontal: 4,
  },
  tabMobile: {
    paddingTop: 8,
  },
  tabInline: {
    paddingTop: 2,
    paddingHorizontal: 2,
  },
  tabLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  tabLabel: {
    fontFamily: FONT,
    fontSize: 14,
    fontWeight: '500',
    color: T.secondary,
    letterSpacing: -0.2,
  },
  tabLabelLg: {
    fontSize: 15,
  },
  tabLabelActive: {
    fontWeight: '600',
    color: T.text,
  },
  tabCount: {
    fontFamily: FONT,
    fontSize: 11,
    fontWeight: '600',
    color: T.secondary,
    backgroundColor: T.fillSoft,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    overflow: 'hidden',
  },
  tabCountActive: {
    color: T.text,
    backgroundColor: T.fill,
  },
  tabLine: {
    marginTop: 10,
    height: 2,
    alignSelf: 'stretch',
    borderRadius: 1,
    backgroundColor: 'transparent',
  },
  tabLineLg: {
    marginTop: 12,
  },
  tabLineInline: {
    marginTop: 6,
  },
  tabLineActive: {
    backgroundColor: T.text,
  },
  tabTrailing: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingBottom: 8,
  },
  tabTrailingLg: {
    paddingBottom: 10,
  },
  tabTrailingMobile: {
    flexWrap: 'wrap',
    justifyContent: 'flex-start',
    paddingBottom: 0,
    width: '100%',
  },
  barButton: {
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: T.hairline,
    backgroundColor: T.card,
    ...webCursor,
  },
  barButtonLg: {
    minHeight: 44,
    flex: 1,
    justifyContent: 'center',
    borderRadius: 12,
    paddingVertical: 10,
  },
  barButtonFill: {
    backgroundColor: T.text,
    borderColor: T.text,
  },
  barButtonGreen: {
    backgroundColor: '#1F8A4E',
    borderColor: '#1F8A4E',
  },
  barButtonLabel: {
    fontFamily: FONT,
    fontSize: 13,
    fontWeight: '500',
    color: T.text,
    letterSpacing: -0.15,
  },
  barButtonLabelLg: {
    fontSize: 16,
    fontWeight: '600',
  },
  barButtonLabelFill: {
    color: '#fff',
  },
  textAction: {
    minHeight: 26,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 2,
    ...webCursor,
  },
  textActionDisabled: {
    opacity: 0.35,
  },
  textActionLabel: {
    fontFamily: FONT,
    fontSize: 14,
    fontWeight: '400',
    color: T.text,
  },
  textActionStrong: {
    fontWeight: '600',
  },
  textActionDestructive: {
    color: T.red,
  },
  iconAction: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    ...webCursor,
  },
  iconActionActive: {
    backgroundColor: 'rgba(0,0,0,0.06)',
  },
  pill: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  pillCompact: {
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  pillText: {
    fontFamily: FONT,
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: -0.1,
  },
  pillTextCompact: {
    fontSize: 11,
  },
  progressTrack: {
    alignSelf: 'stretch',
    backgroundColor: 'rgba(120,120,128,0.16)',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
  },
  statStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: T.card,
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: T.hairline,
  },
  stat: {
    flexDirection: 'row',
    alignItems: 'baseline',
    minWidth: 0,
    paddingHorizontal: 10,
    paddingVertical: 5,
    gap: 6,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: T.hairline,
  },
  statPress: {
    ...webCursor,
  },
  statActive: {
    backgroundColor: '#f5f5f5',
  },
  statLabel: {
    fontFamily: FONT,
    fontSize: 10,
    fontWeight: '600',
    color: T.secondary,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    flexShrink: 0,
  },
  statValue: {
    fontFamily: FONT,
    fontSize: 13,
    fontWeight: '600',
    color: T.text,
    letterSpacing: -0.2,
    fontVariant: ['tabular-nums'],
    flexShrink: 0,
  },
  statSub: {
    fontFamily: FONT,
    fontSize: 11,
    color: T.secondary,
    flexShrink: 1,
    minWidth: 0,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 26,
    paddingHorizontal: 10,
    borderRadius: 13,
    backgroundColor: T.fillSoft,
    ...webCursor,
  },
  chipOn: {
    backgroundColor: T.text,
  },
  chipText: {
    fontFamily: FONT,
    fontSize: 12.5,
    fontWeight: '500',
    color: T.text,
    letterSpacing: -0.1,
  },
  chipTextOn: {
    color: '#fff',
    fontWeight: '600',
  },
  chipCount: {
    fontFamily: FONT,
    fontSize: 11.5,
    fontWeight: '600',
    color: T.secondary,
    fontVariant: ['tabular-nums'],
  },
  chipCountOn: {
    color: 'rgba(255,255,255,0.75)',
  },
  sectionLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    marginTop: 14,
    marginBottom: 5,
  },
  sectionLabel: {
    fontFamily: FONT,
    fontSize: 12,
    fontWeight: '400',
    color: T.secondary,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  group: {
    backgroundColor: T.card,
    overflow: 'hidden',
  },
  groupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    minHeight: 40,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: T.hairline,
  },
  groupRowLast: {
    borderBottomWidth: 0,
  },
  groupRowLabel: {
    fontFamily: FONT,
    fontSize: 14,
    color: T.secondary,
  },
  groupRowValue: {
    fontFamily: FONT,
    flex: 1,
    fontSize: 14,
    color: T.text,
    textAlign: 'right',
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 40,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: '#fff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: T.hairline,
  },
  searchLg: {
    minHeight: 40,
    paddingHorizontal: 12,
    borderRadius: 8,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    fontFamily: FONT,
    fontSize: 13,
    color: T.text,
    paddingVertical: 10,
    outlineStyle: 'none',
  },
  searchInputLg: {
    fontSize: 16,
    paddingVertical: 10,
  },
  mobileCam: {
    width: 48,
    height: 48,
    borderRadius: 8,
    backgroundColor: '#fff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: T.hairline,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    ...webCursor,
  },
  mobileCamOff: {
    opacity: 0.35,
  },
  mobileCamBadge: {
    position: 'absolute',
    top: -3,
    right: -3,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: T.blue,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: T.card,
  },
  mobileCamBadgeText: {
    fontFamily: FONT,
    fontSize: 10,
    fontWeight: '700',
    color: '#fff',
  },
  mobileList: {
    backgroundColor: '#fff',
    overflow: 'hidden',
  },
  mobileListRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 68,
    paddingLeft: 16,
    paddingRight: 16,
    paddingVertical: 14,
    backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(60,60,67,0.18)',
    ...webCursor,
  },
  mobileListRowSelected: {
    backgroundColor: '#f5f5f5',
  },
  mobileListRowLast: {
    borderBottomWidth: 0,
  },
  mobileListLead: {
    flexShrink: 0,
  },
  mobileListCopy: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  mobileListTitle: {
    fontFamily: FONT,
    fontSize: 15,
    fontWeight: '600',
    color: T.text,
    letterSpacing: 0,
  },
  mobileListSub: {
    fontFamily: FONT,
    fontSize: 13,
    lineHeight: 17,
    color: T.secondary,
  },
  mobileListMeta: {
    fontFamily: FONT,
    fontSize: 13,
    color: T.secondary,
    fontVariant: ['tabular-nums'],
  },
  mobileListTrail: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
  },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  noticeText: {
    flex: 1,
    fontFamily: FONT,
    fontSize: 13,
    lineHeight: 18,
  },
  staffAvatar: {
    overflow: 'hidden',
    backgroundColor: T.fill,
    flexShrink: 0,
  },
  staffAvatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  staffAvatarInitials: {
    fontFamily: FONT,
    fontWeight: '600',
    color: T.secondary,
  },
  staffPerson: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  staffPersonName: {
    flex: 1,
    minWidth: 0,
    fontFamily: FONT,
    fontSize: 14,
    color: T.text,
  },
  segmentedSlider: {
    flexDirection: 'row',
    alignItems: 'stretch',
    alignSelf: 'center',
    height: 38,
    minWidth: 220,
    padding: 0,
    borderRadius: 8,
    backgroundColor: '#fff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: T.hairline,
    overflow: 'hidden',
  },
  segmentedSliderFill: {
    alignSelf: 'stretch',
    width: '100%',
    minWidth: 0,
  },
  segmentedSliderMobile: {
    height: 38,
    borderRadius: 8,
  },
  segmentedSliderCompact: {
    height: 34,
    minWidth: 0,
    alignSelf: 'auto',
  },
  segmentedHitCompact: {
    paddingHorizontal: 8,
  },
  segmentedLabelCompact: {
    fontSize: 12,
    fontWeight: '600',
  },
  segmentedThumb: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    borderRadius: 0,
    backgroundColor: T.text,
  },
  segmentedHit: {
    flex: 1,
    zIndex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingHorizontal: 14,
    ...webCursor,
  },
  segmentedHitMobile: {
    paddingHorizontal: 10,
  },
  segmentedLabel: {
    fontFamily: FONT,
    fontSize: 13,
    fontWeight: '400',
    color: T.secondary,
    letterSpacing: 0,
  },
  segmentedLabelActive: {
    fontWeight: '600',
    color: '#fff',
  },
  segmentedCount: {
    fontFamily: FONT,
    fontSize: 12,
    fontWeight: '500',
    color: T.secondary,
    fontVariant: ['tabular-nums'],
  },
  segmentedCountActive: {
    color: 'rgba(255,255,255,0.78)',
  },
  chromePage: {
    flex: 1,
    minHeight: 0,
    backgroundColor: CANVAS,
  },
  chromePageMobile: {
    backgroundColor: CANVAS,
  },
  chromePageScroll: {
    flex: 1,
    minHeight: 0,
    backgroundColor: 'transparent',
  },
  chromePinnedHero: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 8,
    elevation: 8,
  },
  chromePinnedLift: {
    ...StyleSheet.absoluteFillObject,
    pointerEvents: 'none',
  },
  chromeOverlayScroll: {
    flex: 1,
    minHeight: 0,
    zIndex: 4,
    backgroundColor: 'transparent',
  },
  chromeOverlaySheet: {
    flexGrow: 1,
  },
  chromePageContent: {
    flexGrow: 1,
    paddingBottom: 24,
  },
  chromePageContentMobile: {
    flexGrow: 1,
    paddingBottom: 0,
  },
  chromeHeroPad: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 10,
  },
  chromeHeroPadDesktop: {
    paddingHorizontal: 32,
    paddingTop: 4,
    paddingBottom: 18,
  },
  chromeHeroShell: {
    alignSelf: 'stretch',
    position: 'relative',
  },
  chromeHeroLift: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 20,
    ...Platform.select({
      web: {
        boxShadow: '0 1px 2px rgba(18,16,12,0.06), 0 10px 28px rgba(18,16,12,0.14)',
      },
      default: {
        shadowColor: '#12100C',
        shadowOpacity: 0.16,
        shadowRadius: 18,
        shadowOffset: { width: 0, height: 8 },
        elevation: 5,
      },
    }),
  },
  chromeHeroCard: {
    alignSelf: 'stretch',
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 14,
    borderRadius: 20,
    backgroundColor: '#1F1E1B',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(212,175,55,0.32)',
    ...Platform.select({
      web: {
        boxShadow:
          'inset 0 1px 0 rgba(255,236,180,0.16), inset 0 -1px 0 rgba(0,0,0,0.38), 0 0 0 0.5px rgba(18,16,12,0.12)',
        cursor: 'default',
      },
      default: {},
    }),
  },
  chromeHeroCardWide: {
    paddingHorizontal: 28,
    paddingVertical: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 36,
  },
  chromeHeroAmount: {
    fontFamily: 'SohneLeicht',
    fontSize: 38,
    lineHeight: 44,
    fontWeight: '400',
    color: '#F6F1E6',
    letterSpacing: -1.1,
    fontVariant: ['tabular-nums'],
  },
  chromeHeroAmountWide: {
    flex: 1.1,
    fontSize: 52,
    lineHeight: 56,
  },
  chromeHeroStats: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 16,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.28)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(212,175,55,0.14)',
  },
  chromeHeroStatsWide: {
    flex: 1,
    marginTop: 0,
    paddingVertical: 14,
    paddingHorizontal: 12,
  },
  chromeHeroSide: {
    flex: 1,
    minWidth: 0,
  },
  chromeHeroSideStack: {
    gap: 12,
  },
  chromeHeroStatWrap: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
  },
  chromeHeroStat: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  chromeHeroStatDivider: {
    width: StyleSheet.hairlineWidth,
    height: 26,
    marginHorizontal: 10,
    backgroundColor: 'rgba(244,228,180,0.16)',
  },
  chromeHeroStatValue: {
    fontFamily: FONT,
    fontSize: 16,
    fontWeight: '600',
    color: '#F6F1E6',
    letterSpacing: -0.28,
    fontVariant: ['tabular-nums'],
  },
  chromeHeroStatLabel: {
    fontFamily: FONT,
    fontSize: 11,
    fontWeight: '500',
    color: '#C4A35A',
    letterSpacing: 0.2,
  },
  chromeSheet: {
    flexGrow: 1,
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: 'hidden',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,0,0,0.08)',
    ...Platform.select({
      web: {
        boxShadow: '0 -8px 24px rgba(0,0,0,0.12), 0 -1px 0 rgba(255,255,255,0.9)',
      },
      default: {
        shadowColor: '#000',
        shadowOpacity: 0.14,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: -6 },
        elevation: 8,
      },
    }),
  },
  chromeSheetGrow: {
    flexGrow: 1,
    minHeight: 320,
  },
  chromeSheetHead: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  chromeSheetTitle: {
    fontFamily: FONT,
    fontSize: 13,
    fontWeight: '400',
    color: '#8e8e93',
    letterSpacing: -0.08,
    textTransform: 'uppercase',
  },
  chromeSheetMeta: {
    fontFamily: FONT,
    fontSize: 13,
    color: '#8e8e93',
    letterSpacing: -0.08,
    fontVariant: ['tabular-nums'],
  },
  chromeSheetBody: {
    backgroundColor: '#fff',
  },
  chromeSheetBodyMobile: {
    paddingBottom: mobileTabBarReserve() + 24,
  },
  chromeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 68,
    paddingLeft: 16,
    backgroundColor: '#fff',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  chromeRowHover: {
    backgroundColor: '#f5f5f5',
  },
  chromeRowIcon: {
    width: 46,
    height: 46,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  chromeRowBody: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingRight: 16,
    alignSelf: 'stretch',
  },
  chromeRowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(60,60,67,0.18)',
  },
  chromeRowCopy: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  chromeRowTitle: {
    fontFamily: FONT,
    fontSize: 15,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  chromeRowMeta: {
    fontFamily: FONT,
    fontSize: 13,
    color: '#8e8e93',
  },
  chromeRowValue: {
    fontFamily: FONT,
    fontSize: 15,
    fontWeight: '600',
    color: '#1a1a1a',
    fontVariant: ['tabular-nums'],
    flexShrink: 0,
  },
  chromeRowChevron: {
    width: 18,
    flexShrink: 0,
  },
});
