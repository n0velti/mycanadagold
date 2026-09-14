/**
 * Shared building blocks for the Triage app.
 *
 * Every triage surface (dashboard, batch detail, accuracy, review drawer)
 * pulls its tokens and primitives from here so the app reads as one product:
 * one type ramp, one set of status colours, one drawer, one empty state.
 */
import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Easing,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { MOBILE, mobileSafeBottom, mobileSafeTop } from '../lib/mobileUi';

export const FONT = Platform.select({
  ios: 'Sohne',
  android: 'Sohne',
  default: 'Sohne',
});

export const T = {
  bg: MOBILE.bg,
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

/** Slide-from-right drawer animation with mount/unmount handling. */
export function useRightDrawerAnimation(visible, slideDistance) {
  const [mounted, setMounted] = useState(visible);
  const slide = useRef(new Animated.Value(slideDistance)).current;
  const backdrop = useRef(new Animated.Value(0)).current;
  const slideDistanceRef = useRef(slideDistance);
  const opened = useRef(visible);
  slideDistanceRef.current = slideDistance;

  useEffect(() => {
    if (visible) {
      opened.current = true;
      setMounted(true);
      slide.setValue(slideDistanceRef.current);
      backdrop.setValue(0);
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
      anim.start();
      return () => anim.stop();
    }

    if (!opened.current) return undefined;

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
    const timeout = setTimeout(() => setMounted(false), DRAWER_CLOSE_MS + 32);
    anim.start(() => setMounted(false));
    return () => {
      anim.stop();
      clearTimeout(timeout);
    };
  }, [visible, slide, backdrop]);

  return { mounted, slide, backdrop };
}

/**
 * Right-hand drawer shell with an iOS-style nav bar.
 * Renders children inside the panel; callers own scrolling.
 */
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
  widthRatio = 0.46,
  minWidth = 400,
  children,
}) {
  const { width: windowWidth } = useWindowDimensions();
  const isMobile = windowWidth < 768;
  const panelWidth = isMobile
    ? Math.max(windowWidth, 240)
    : Math.min(Math.max(Math.round(windowWidth * widthRatio), minWidth), Math.round(windowWidth - 64));
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
          <View
            style={[styles.drawerNav, isMobile && styles.drawerNavMobile]}
            {...(Platform.OS === 'web' && isMobile ? { className: 'cgold-mobile-sheet-top' } : null)}
          >
            <Pressable
              onPress={onLeft || onClose}
              hitSlop={8}
              style={styles.drawerNavSide}
              accessibilityRole="button"
              accessibilityLabel={leftLabel}
            >
              <Text style={styles.drawerNavAction}>{leftLabel}</Text>
            </Pressable>
            <View style={styles.drawerNavTitleBlock}>
              <Text style={styles.drawerNavTitle} numberOfLines={1}>
                {title}
              </Text>
              {subtitle ? (
                <Text style={styles.drawerNavSubtitle} numberOfLines={1}>
                  {subtitle}
                </Text>
              ) : null}
            </View>
            <Pressable
              onPress={onRight}
              hitSlop={8}
              disabled={!onRight || rightDisabled}
              style={[styles.drawerNavSide, styles.drawerNavSideRight]}
              accessibilityRole="button"
              accessibilityLabel={rightLabel || ''}
            >
              {rightLabel ? (
                <Text
                  style={[
                    styles.drawerNavAction,
                    rightEmphasis && styles.drawerNavActionStrong,
                    rightDisabled && styles.drawerNavActionDisabled,
                  ]}
                >
                  {rightLabel}
                </Text>
              ) : null}
            </Pressable>
          </View>
          {children}
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
export function TextTabs({ options, value, onChange, trailing, size = 'md', style }) {
  return (
    <View style={[styles.tabBar, style]} accessibilityRole="tablist">
      <View style={styles.tabs}>
        {options.map((option) => {
          const active = option.key === value;
          return (
            <Pressable
              key={option.key}
              style={styles.tab}
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
              <View style={[styles.tabLine, active && styles.tabLineActive]} />
            </Pressable>
          );
        })}
      </View>
      {trailing ? <View style={styles.tabTrailing}>{trailing}</View> : null}
    </View>
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

export function SearchField({ value, onChangeText, placeholder = 'Search', style, autoFocus }) {
  return (
    <View style={[styles.search, style]}>
      <Ionicons name="search" size={15} color={T.secondary} />
      <TextInput
        style={styles.searchInput}
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
          <Ionicons name="close-circle" size={16} color={T.tertiary} />
        </Pressable>
      ) : null}
    </View>
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
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  drawerBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.28)',
  },
  drawerPanel: {
    height: '100%',
    backgroundColor: T.bg,
    ...Platform.select({
      web: { boxShadow: '-12px 0 32px rgba(0,0,0,0.18)' },
      default: { elevation: 12 },
    }),
  },
  drawerPanelMobile: {
    paddingBottom: Platform.OS === 'ios' ? Math.max(20, mobileSafeBottom()) : 12,
  },
  drawerNav: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 48,
    paddingHorizontal: 8,
    backgroundColor: 'rgba(242,242,247,0.94)',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: T.hairline,
  },
  drawerNavMobile: {
    paddingTop: Platform.OS === 'ios' ? mobileSafeTop() - 12 : 6,
  },
  drawerNavSide: {
    width: 84,
    minHeight: 44,
    justifyContent: 'center',
    ...webCursor,
  },
  drawerNavSideRight: {
    alignItems: 'flex-end',
  },
  drawerNavAction: {
    fontFamily: FONT,
    fontSize: 16,
    fontWeight: '400',
    color: T.blue,
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
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: T.hairline,
  },
  tabs: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 16,
  },
  tab: {
    paddingTop: 6,
    alignItems: 'center',
    ...webCursor,
  },
  tabLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  tabLabel: {
    fontFamily: FONT,
    fontSize: 13,
    fontWeight: '400',
    color: T.secondary,
    letterSpacing: -0.2,
  },
  tabLabelLg: {
    fontSize: 14,
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
    paddingVertical: 1,
    borderRadius: 8,
    overflow: 'hidden',
  },
  tabCountActive: {
    color: '#fff',
    backgroundColor: T.blue,
  },
  tabLine: {
    marginTop: 6,
    height: 2,
    alignSelf: 'stretch',
    borderRadius: 1,
    backgroundColor: 'transparent',
  },
  tabLineActive: {
    backgroundColor: T.blue,
  },
  tabTrailing: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingBottom: 5,
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
    alignItems: 'stretch',
    backgroundColor: T.card,
    borderRadius: 12,
    overflow: 'hidden',
  },
  stat: {
    minWidth: 0,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 1,
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
    fontSize: 10.5,
    fontWeight: '600',
    color: T.secondary,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  statValue: {
    fontFamily: FONT,
    fontSize: 17,
    fontWeight: '600',
    color: T.text,
    letterSpacing: -0.4,
    fontVariant: ['tabular-nums'],
  },
  statSub: {
    fontFamily: FONT,
    fontSize: 11.5,
    color: T.secondary,
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
    borderRadius: 10,
    backgroundColor: T.fillSoft,
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
});
