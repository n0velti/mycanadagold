/**
 * Shared building blocks for the Triage app.
 *
 * Every triage surface (dashboard, batch detail, accuracy, review drawer)
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
import { MOBILE, mobileSafeBottom, mobileSafeTop, useIsMobile } from '../lib/mobileUi';
import { ClockedInMark, useIsClockedIn } from '../lib/clockedIn';

export const FONT = Platform.select({
  ios: 'Sohne',
  android: 'Sohne',
  default: 'Sohne',
});

export const T = {
  bg: '#FFFFFF',
  card: '#FFFFFF',
  text: '#1D1D1F',
  secondary: '#8E8E93',
  tertiary: '#C7C7CC',
  fill: '#E8E8ED',
  fillSoft: 'rgba(118,118,128,0.12)',
  hairline: 'rgba(60, 60, 67, 0.18)',
  blue: MOBILE.blue,
  green: '#34C759',
  orange: '#FF9500',
  red: '#FF3B30',
  purple: '#AF52DE',
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
    '.cgold-triage-btn:hover{background-color:#f5f5f7!important;}',
    '.cgold-triage-btn.cgold-triage-btn-green:hover{background-color:#1A7344!important;}',
  ].join('');
}

export const TONES = {
  neutral: { fg: T.secondary, bg: 'rgba(142,142,147,0.14)' },
  blue: { fg: T.blue, bg: 'rgba(0,122,255,0.12)' },
  green: { fg: '#248A3D', bg: 'rgba(52,199,89,0.16)' },
  orange: { fg: '#C93400', bg: 'rgba(255,149,0,0.18)' },
  red: { fg: '#D70015', bg: 'rgba(255,59,48,0.14)' },
  purple: { fg: '#8944AB', bg: 'rgba(175,82,222,0.14)' },
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
export function SegmentedSlider({ options, value, onChange, style, fill = false }) {
  const isMobile = useIsMobile();
  const keys = (options || []).map((option) => option.key);
  const found = keys.indexOf(value);
  const matched = found >= 0;
  const index = matched ? found : 0;
  const [trackW, setTrackW] = useState(0);
  const slide = useRef(new Animated.Value(index)).current;
  const inset = 2;
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
            style={[styles.segmentedHit, isMobile && styles.segmentedHitMobile]}
            onPress={() => onChange(option.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={option.label}
          >
            <Text style={[styles.segmentedLabel, active && styles.segmentedLabelActive]} numberOfLines={1}>
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
        ? { className: green ? 'cgold-triage-btn cgold-triage-btn-green' : 'cgold-triage-btn' }
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
      {icon ? <Ionicons name={icon} size={17} color={destructive ? T.red : T.blue} /> : null}
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
      <Ionicons name={icon} size={size} color={T.blue} />
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

export function ProgressBar({ value = 0, total = 0, tone = 'green', height = 4, style }) {
  const pct = total > 0 ? Math.max(0, Math.min(1, value / total)) : 0;
  const colors = TONES[tone] || TONES.green;
  return (
    <View style={[styles.progressTrack, { height, borderRadius: height / 2 }, style]}>
      <View
        style={[
          styles.progressFill,
          { width: `${Math.round(pct * 100)}%`, backgroundColor: colors.fg, borderRadius: height / 2 },
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
        <Text style={[styles.staffAvatarInitials, { fontSize: size > 28 ? 12 : 10 }]}>
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
      <Ionicons name={busy ? 'ellipsis-horizontal' : 'camera'} size={22} color={disabled ? T.secondary : T.blue} />
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
  leading,
  trailing,
  onPress,
  last,
  selected,
  accessibilityLabel,
}) {
  const Row = onPress ? Pressable : View;
  return (
    <Row
      style={[
        styles.mobileListRow,
        selected && styles.mobileListRowSelected,
        last && styles.mobileListRowLast,
      ]}
      onPress={onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityState={onPress ? { selected: Boolean(selected) } : undefined}
      accessibilityLabel={accessibilityLabel || title}
    >
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
      </View>
      <View style={styles.mobileListTrail}>
        {trailing}
        {onPress ? <Ionicons name="chevron-forward" size={18} color={T.tertiary} /> : null}
      </View>
    </Row>
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
    backgroundColor: T.blue,
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
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: T.fillSoft,
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
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 10,
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
    minHeight: 32,
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
    backgroundColor: T.blue,
    borderColor: T.blue,
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
    color: T.blue,
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
    backgroundColor: 'rgba(0,122,255,0.12)',
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
    backgroundColor: 'rgba(0,122,255,0.06)',
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
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: T.hairline,
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
    minHeight: 32,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: '#e8e8ed',
  },
  searchLg: {
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: 12,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    fontFamily: FONT,
    fontSize: 14,
    color: T.text,
    paddingVertical: 4,
    outlineStyle: 'none',
  },
  searchInputLg: {
    fontSize: 17,
    paddingVertical: 8,
  },
  mobileCam: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(0,122,255,0.12)',
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
    minHeight: 76,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(60,60,67,0.24)',
    ...webCursor,
  },
  mobileListRowSelected: {
    backgroundColor: '#f2f2f7',
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
    gap: 2,
  },
  mobileListTitle: {
    fontFamily: FONT,
    fontSize: 17,
    fontWeight: '600',
    color: T.text,
    letterSpacing: -0.3,
  },
  mobileListSub: {
    fontFamily: FONT,
    fontSize: 14,
    lineHeight: 18,
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
    height: 32,
    minWidth: 220,
    padding: 2,
    borderRadius: 8,
    backgroundColor: '#e8e8ed',
  },
  segmentedSliderFill: {
    alignSelf: 'stretch',
    width: '100%',
    minWidth: 0,
  },
  segmentedSliderMobile: {
    height: 36,
    borderRadius: 10,
  },
  segmentedThumb: {
    position: 'absolute',
    top: 2,
    bottom: 2,
    left: 2,
    borderRadius: 7,
    backgroundColor: '#fff',
    ...Platform.select({
      web: { boxShadow: '0 1px 3px rgba(0,0,0,0.12), 0 1px 1px rgba(0,0,0,0.04)' },
      default: {
        shadowColor: '#000',
        shadowOpacity: 0.12,
        shadowRadius: 3,
        shadowOffset: { width: 0, height: 1 },
        elevation: 2,
      },
    }),
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
    fontWeight: '500',
    color: T.text,
    letterSpacing: -0.2,
  },
  segmentedLabelActive: {
    fontWeight: '600',
  },
  segmentedCount: {
    fontFamily: FONT,
    fontSize: 12,
    fontWeight: '500',
    color: T.secondary,
    fontVariant: ['tabular-nums'],
  },
  segmentedCountActive: {
    color: T.text,
  },
});
