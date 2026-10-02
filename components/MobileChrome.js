import { useEffect, useRef, useState } from 'react';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { Animated, Image, PanResponder, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  attachWebTabBarScrollListeners,
  expandMobileTabBar,
  TAB_BAR_ACTIVE_RADIUS,
  TAB_BAR_BOTTOM_GAP,
  TAB_BAR_HEIGHT_EXPANDED,
  TAB_BAR_SIDE_EXPANDED,
} from '../lib/mobileTabBar';
import {
  CANVAS,
  MOBILE,
  MOBILE_FILTER_INSET,
  MOBILE_FILTER_SIZE,
  MOBILE_TOP_FILTER_SIZE,
  NAV_ICON_ACTIVE,
  NAV_ICON_INACTIVE,
  NAV_TAB_ACTIVE_BG,
  mobileSafeBottom,
  mobileSafeTop,
} from '../lib/mobileUi';

const fontFamily = 'Sohne';

function initialsFromName(name) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return '';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function TabProfileAvatar({ uri, name, active }) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [uri]);

  const showImage = Boolean(uri) && !failed;
  const initials = initialsFromName(name);

  return (
    <View style={[styles.tabAvatarRing, active && styles.tabAvatarRingActive]}>
      <View style={styles.tabAvatar}>
        {showImage ? (
          <Image
            source={{ uri }}
            style={styles.tabAvatarImage}
            onError={() => setFailed(true)}
            accessibilityIgnoresInvertColors
          />
        ) : initials ? (
          <Text style={styles.tabAvatarInitials}>{initials}</Text>
        ) : (
          <Ionicons
            name={active ? 'person' : 'person-outline'}
            size={20}
            color={active ? NAV_ICON_ACTIVE : NAV_ICON_INACTIVE}
          />
        )}
      </View>
    </View>
  );
}

export function MobileSafeTop() {
  return (
    <View
      style={[styles.safeTop, { height: mobileSafeTop() }]}
      {...(Platform.OS === 'web' ? { className: 'cgold-mobile-inset-top' } : null)}
    />
  );
}

export function MobileFilterLines({ color, large = false }) {
  return (
    <View style={[styles.filterLines, large && styles.filterLinesLarge]}>
      <View style={[styles.filterLine, large && styles.filterLineLarge, { width: large ? 20 : 15, backgroundColor: color }]} />
      <View style={[styles.filterLine, large && styles.filterLineLarge, { width: large ? 14 : 11, backgroundColor: color }]} />
      <View style={[styles.filterLine, large && styles.filterLineLarge, { width: large ? 9 : 7, backgroundColor: color }]} />
    </View>
  );
}

/** 44pt chrome circle used on Home and Triage — filter / back / apps. */
export function MobileChromeCircle({
  buttonRef,
  active = false,
  onPress,
  onLayout,
  accessibilityLabel,
  accessibilityState,
  style,
  children,
}) {
  return (
    <Pressable
      ref={buttonRef}
      hitSlop={10}
      onLayout={onLayout}
      onPress={onPress}
      style={[styles.chromeCircle, style]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={accessibilityState}
    >
      <BlurView
        intensity={32}
        tint="light"
        style={styles.chromeCircleBlur}
        {...(Platform.OS === 'web' ? { className: 'cgold-mobile-tab-bar' } : null)}
      >
        {children || <MobileFilterLines color={active ? NAV_ICON_ACTIVE : '#3A3A3C'} large />}
      </BlurView>
    </Pressable>
  );
}

export function MobileFilterDock({ children, side = 'right', style }) {
  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.filterDock,
        side === 'left' ? styles.filterDockLeft : styles.filterDockRight,
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function MobileFilterSheet({ visible, top, right, onClose, children }) {
  if (!visible) return null;
  return (
    <View style={styles.filterLayer}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close filters" />
      <View style={[styles.filterCard, { top, right }]}>{children}</View>
    </View>
  );
}

export function MobileFilterSheetLabel({ children }) {
  return <Text style={styles.filterSheetLabel}>{children}</Text>;
}

export function MobileFilterSheetDivider() {
  return <View style={styles.filterSheetDivider} />;
}

export function MobileFilterSheetAction({ icon, iconColor = '#fff', iconBg, label, onPress, accessibilityLabel }) {
  return (
    <Pressable
      onPress={onPress}
      style={styles.filterSheetAction}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || label}
    >
      <View style={[styles.filterSheetActionIcon, iconBg ? { backgroundColor: iconBg } : null]}>
        <Ionicons name={icon} size={16} color={iconColor} />
      </View>
      <Text style={styles.filterSheetActionLabel}>{label}</Text>
    </Pressable>
  );
}

export function MobileFilterChip({ label, active = false, onPress, accessibilityLabel, accessibilityState, style }) {
  const color = active ? NAV_ICON_ACTIVE : NAV_ICON_INACTIVE;
  return (
    <Pressable
      hitSlop={6}
      onPress={onPress}
      style={[styles.filterChip, style]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || `${label} filters`}
      accessibilityState={accessibilityState}
    >
      <BlurView
        intensity={72}
        tint="light"
        style={styles.filterChipInner}
        {...(Platform.OS === 'web' ? { className: 'cgold-mobile-filter-blur' } : null)}
      >
        <MobileFilterLines color={color} />
        {label ? (
          <Text style={styles.filterChipLabel} numberOfLines={1}>
            {label}
          </Text>
        ) : null}
      </BlurView>
    </Pressable>
  );
}

export function MobileNavTextAction({ label, onPress, accessibilityLabel }) {
  return (
    <MobileNavButton label={label} onPress={onPress} accessibilityLabel={accessibilityLabel} />
  );
}

export function MobileNavButton({ label, children, active = false, tone, onPress, accessibilityLabel, accessibilityState }) {
  const green = tone === 'green';
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      style={[styles.navButton, active && styles.navButtonOn, green && styles.navButtonGreen]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || label}
      accessibilityState={accessibilityState}
    >
      {children}
      {label ? <Text style={[styles.navButtonLabel, green && styles.navButtonLabelGreen]}>{label}</Text> : null}
    </Pressable>
  );
}

export function MobileCircleButton({ children, active = false, tone, onPress, accessibilityLabel, accessibilityState, style }) {
  const green = tone === 'green';
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      style={[styles.circleButton, green && styles.circleButtonGreen, style]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={accessibilityState}
    >
      {green ? (
        children
      ) : (
        <BlurView
          intensity={72}
          tint="light"
          style={[styles.circleButtonBlur, active && styles.circleButtonBlurOn]}
          {...(Platform.OS === 'web' ? { className: 'cgold-mobile-filter-blur' } : null)}
        >
          {children}
        </BlurView>
      )}
    </Pressable>
  );
}

export function MobileNavHeader({
  title,
  subtitle,
  onBack,
  trailing,
  titleAction,
  grouped = false,
  backSide = 'left',
}) {
  const start = Boolean(titleAction);
  const backRight = backSide === 'right';
  const back = (
    <Pressable
      onPress={onBack}
      style={styles.navSide}
      hitSlop={8}
      accessibilityLabel="Back"
    >
      <Ionicons name="chevron-back" size={28} color={MOBILE.blue} />
    </Pressable>
  );
  return (
    <View style={[styles.navHeader, grouped && styles.navHeaderGrouped]}>
      {backRight ? <View style={styles.navSide} /> : back}
      <View style={[styles.navTitleBlock, start && styles.navTitleBlockStart]}>
        <View style={styles.navTitleRow}>
          <Text style={[styles.navTitle, start && styles.navTitleStart]} numberOfLines={1}>
            {title}
          </Text>
          {titleAction}
        </View>
        {subtitle ? (
          <Text style={[styles.navSubtitle, start && styles.navTitleStart]} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <View
        style={[
          styles.navSide,
          (trailing || titleAction || backRight) && styles.navTrailing,
          backRight && styles.navTrailingCluster,
        ]}
      >
        {trailing}
        {backRight ? back : null}
      </View>
    </View>
  );
}

const TAB_ACTIVE_INSET = 4;

export function MobileTabBar({
  tabs,
  activeKey,
  onSelect,
  messagesUnread = 0,
  profileAvatarUrl = '',
  profileName = '',
}) {
  const tabLayouts = useRef({});
  const indicatorX = useRef(new Animated.Value(0)).current;
  const indicatorW = useRef(new Animated.Value(0)).current;
  const indicatorXValue = useRef(0);
  const indicatorWValue = useRef(0);
  const indicatorPlaced = useRef(false);
  const draggingRef = useRef(false);
  const dragOriginCenter = useRef(0);
  const tabsRef = useRef(tabs);
  const onSelectRef = useRef(onSelect);
  const [previewKey, setPreviewKey] = useState(activeKey);
  tabsRef.current = tabs;
  onSelectRef.current = onSelect;

  useEffect(() => attachWebTabBarScrollListeners(), []);

  useEffect(() => {
    const xSub = indicatorX.addListener(({ value }) => {
      indicatorXValue.current = value;
    });
    const wSub = indicatorW.addListener(({ value }) => {
      indicatorWValue.current = value;
    });
    return () => {
      indicatorX.removeListener(xSub);
      indicatorW.removeListener(wSub);
    };
  }, [indicatorX, indicatorW]);

  const tabFrames = () =>
    tabsRef.current
      .map((tab) => {
        const layout = tabLayouts.current[tab.key];
        if (!layout) return null;
        return {
          key: tab.key,
          x: layout.x + TAB_ACTIVE_INSET,
          w: Math.max(32, layout.width - TAB_ACTIVE_INSET * 2),
          center: layout.x + layout.width / 2,
        };
      })
      .filter(Boolean);

  const frameAtCenter = (centerX) => {
    const frames = tabFrames();
    if (!frames.length) return null;
    if (centerX <= frames[0].center) return { x: frames[0].x, w: frames[0].w, nearest: frames[0].key };
    const last = frames[frames.length - 1];
    if (centerX >= last.center) return { x: last.x, w: last.w, nearest: last.key };
    for (let i = 0; i < frames.length - 1; i += 1) {
      const a = frames[i];
      const b = frames[i + 1];
      if (centerX >= a.center && centerX <= b.center) {
        const t = (centerX - a.center) / (b.center - a.center || 1);
        return {
          x: a.x + (b.x - a.x) * t,
          w: a.w + (b.w - a.w) * t,
          nearest: t < 0.5 ? a.key : b.key,
        };
      }
    }
    return { x: frames[0].x, w: frames[0].w, nearest: frames[0].key };
  };

  const placeActiveIndicator = (key, animated) => {
    const layout = tabLayouts.current[key];
    if (!layout) return;
    const nextX = layout.x + TAB_ACTIVE_INSET;
    const nextW = Math.max(32, layout.width - TAB_ACTIVE_INSET * 2);
    const shouldAnimate = animated && indicatorPlaced.current;
    indicatorPlaced.current = true;
    if (!shouldAnimate) {
      indicatorX.setValue(nextX);
      indicatorW.setValue(nextW);
      return;
    }
    Animated.parallel([
      Animated.spring(indicatorX, {
        toValue: nextX,
        friction: 7,
        tension: 92,
        useNativeDriver: false,
      }),
      Animated.spring(indicatorW, {
        toValue: nextW,
        friction: 7,
        tension: 92,
        useNativeDriver: false,
      }),
    ]).start();
  };

  const finishDrag = (dx) => {
    const frame = frameAtCenter(dragOriginCenter.current + dx);
    const key = frame?.nearest;
    draggingRef.current = false;
    if (!key) return;
    setPreviewKey(key);
    expandMobileTabBar();
    onSelectRef.current(key);
    placeActiveIndicator(key, true);
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, gesture) =>
        Math.abs(gesture.dx) > 6 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
      onMoveShouldSetPanResponderCapture: (_, gesture) =>
        Math.abs(gesture.dx) > 6 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
      onPanResponderGrant: () => {
        indicatorX.stopAnimation();
        indicatorW.stopAnimation();
        draggingRef.current = true;
        dragOriginCenter.current = indicatorXValue.current + indicatorWValue.current / 2;
      },
      onPanResponderMove: (_, gesture) => {
        const frame = frameAtCenter(dragOriginCenter.current + gesture.dx);
        if (!frame) return;
        indicatorX.setValue(frame.x);
        indicatorW.setValue(frame.w);
        setPreviewKey((current) => (current === frame.nearest ? current : frame.nearest));
      },
      onPanResponderRelease: (_, gesture) => finishDrag(gesture.dx),
      onPanResponderTerminate: (_, gesture) => finishDrag(gesture.dx),
      onPanResponderTerminationRequest: () => false,
    })
  ).current;

  useEffect(() => {
    if (draggingRef.current) return;
    setPreviewKey(activeKey);
    placeActiveIndicator(activeKey, true);
  }, [activeKey]);

  return (
    <View
      pointerEvents="box-none"
      style={[styles.tabBarDock, styles.tabBarDockFixed]}
      {...(Platform.OS === 'web' ? { className: 'cgold-mobile-tab-bar-dock' } : null)}
    >
      <View style={[styles.tabBarLift, styles.tabBarShellFixed]}>
        <View style={styles.tabBarClip}>
          <BlurView
            intensity={32}
            tint="light"
            pointerEvents="none"
            style={styles.tabBarBlur}
            {...(Platform.OS === 'web' ? { className: 'cgold-mobile-tab-bar' } : null)}
          />
          <View style={styles.tabBar} {...panResponder.panHandlers}>
            <Animated.View
              pointerEvents="none"
              style={[
                styles.tabActive,
                {
                  left: indicatorX,
                  width: indicatorW,
                },
              ]}
              {...(Platform.OS === 'web' ? { className: 'cgold-mobile-tab-active' } : null)}
            />
            {tabs.map((tab) => {
              const isActive = previewKey === tab.key;
              const unread = tab.key === 'messages' ? messagesUnread : 0;
              const badge = unread > 99 ? '99+' : unread > 0 ? String(unread) : '';
              const isProfile = tab.key === 'profile';
              const isHome = tab.key === 'home';
              return (
                <Pressable
                  key={tab.key}
                  onPress={() => {
                    expandMobileTabBar();
                    onSelect(tab.key);
                  }}
                  onLayout={(event) => {
                    const { x, width } = event.nativeEvent.layout;
                    const prev = tabLayouts.current[tab.key];
                    tabLayouts.current[tab.key] = { x, width };
                    if (draggingRef.current || tab.key !== activeKey) return;
                    if (!prev || prev.x !== x || prev.width !== width) {
                      placeActiveIndicator(tab.key, indicatorPlaced.current);
                    }
                  }}
                  style={styles.tab}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isActive }}
                  accessibilityLabel={badge ? `${tab.label}, ${badge} unread` : tab.label}
                >
                  <View style={styles.tabIconWrap}>
                    {isHome ? (
                      <Image
                        source={require('../assets/small_logo.png')}
                        style={[styles.tabLogo, !isActive && styles.tabLogoDim]}
                        resizeMode="cover"
                        accessibilityIgnoresInvertColors
                      />
                    ) : isProfile ? (
                      <TabProfileAvatar uri={profileAvatarUrl} name={profileName} active={isActive} />
                    ) : (
                      <Ionicons
                        name={isActive ? tab.iconActive : tab.icon}
                        size={28}
                        color={isActive ? NAV_ICON_ACTIVE : NAV_ICON_INACTIVE}
                      />
                    )}
                    {badge ? (
                      <View style={styles.badge} pointerEvents="none">
                        <Text style={styles.badgeText}>{badge}</Text>
                      </View>
                    ) : null}
                  </View>
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safeTop: {
    flexShrink: 0,
    backgroundColor: 'transparent',
  },
  navHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    paddingHorizontal: 4,
    paddingBottom: 6,
    backgroundColor: CANVAS,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(42,38,30,0.08)',
  },
  navHeaderGrouped: {
    backgroundColor: MOBILE.bg,
    borderBottomColor: 'rgba(60, 60, 67, 0.12)',
  },
  navTrailing: {
    width: 'auto',
    minWidth: 44,
    paddingRight: 8,
  },
  navTrailingCluster: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 4,
    minWidth: 44,
  },
  navSide: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  navTitleBlock: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navTitleBlockStart: {
    alignItems: 'flex-start',
  },
  navTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    maxWidth: '100%',
  },
  navTitle: {
    fontFamily,
    fontSize: 17,
    fontWeight: '600',
    color: MOBILE.label,
    textAlign: 'center',
    letterSpacing: -0.3,
  },
  navTitleStart: {
    flexShrink: 1,
    textAlign: 'left',
  },
  navSubtitle: {
    fontFamily,
    fontSize: 12,
    fontWeight: '400',
    color: MOBILE.secondary,
    textAlign: 'center',
    marginTop: -1,
  },
  circleButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    overflow: 'hidden',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  circleButtonBlurOn: {
    borderColor: MOBILE.label,
  },
  circleButtonGreen: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1F8A4E',
  },
  circleButtonBlur: {
    width: 40,
    height: 40,
    borderRadius: 20,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(60, 60, 67, 0.18)',
  },
  navButton: {
    minWidth: MOBILE_FILTER_SIZE,
    height: MOBILE_FILTER_SIZE,
    paddingHorizontal: 10,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#fff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(60, 60, 67, 0.18)',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  navButtonOn: {
    borderColor: MOBILE.label,
  },
  navButtonGreen: {
    minWidth: 80,
    paddingHorizontal: 18,
    backgroundColor: '#1F8A4E',
    borderColor: '#1F8A4E',
  },
  navButtonLabel: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: MOBILE.label,
    letterSpacing: -0.2,
  },
  navButtonLabelGreen: {
    color: '#fff',
  },
  filterChip: {
    maxWidth: 168,
    height: MOBILE_FILTER_SIZE,
    borderRadius: 8,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  filterChipInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    height: MOBILE_FILTER_SIZE,
    maxWidth: '100%',
    paddingLeft: 11,
    paddingRight: 12,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#fff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(60, 60, 67, 0.18)',
  },
  filterChipLabel: {
    flexShrink: 1,
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: MOBILE.label,
    letterSpacing: 0,
  },
  filterLines: {
    width: 15,
    height: 11,
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  filterLinesLarge: {
    width: 20,
    height: 15,
  },
  filterLine: {
    height: 1.5,
    borderRadius: 1,
  },
  filterLineLarge: {
    height: 2,
  },
  chromeCircle: {
    width: MOBILE_TOP_FILTER_SIZE,
    height: MOBILE_TOP_FILTER_SIZE,
    borderRadius: MOBILE_TOP_FILTER_SIZE / 2,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,0,0,0.08)',
    ...Platform.select({
      web: {
        cursor: 'pointer',
        boxShadow: '0 1px 6px rgba(0,0,0,0.1)',
      },
      default: {
        shadowColor: '#000',
        shadowOpacity: 0.1,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: 1 },
        elevation: 3,
      },
    }),
  },
  chromeCircleBlur: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: MOBILE_TOP_FILTER_SIZE / 2,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(252,252,251,0.92)',
    ...Platform.select({
      web: {
        backdropFilter: 'saturate(120%) blur(12px)',
        WebkitBackdropFilter: 'saturate(120%) blur(12px)',
      },
      default: {},
    }),
  },
  filterDock: {
    position: 'absolute',
    top: 8,
    zIndex: 24,
  },
  filterDockRight: {
    right: MOBILE_FILTER_INSET,
  },
  filterDockLeft: {
    left: MOBILE_FILTER_INSET,
  },
  filterLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 20,
  },
  filterCard: {
    position: 'absolute',
    width: 308,
    maxWidth: '92%',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    gap: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(60, 60, 67, 0.18)',
  },
  filterSheetLabel: {
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
    color: '#8e8e93',
    letterSpacing: -0.08,
    textTransform: 'uppercase',
    paddingHorizontal: 4,
  },
  filterSheetDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(60, 60, 67, 0.18)',
    marginHorizontal: 4,
  },
  filterSheetAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 40,
    paddingHorizontal: 4,
    borderRadius: 10,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  filterSheetActionIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1F8A4E',
  },
  filterSheetActionLabel: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: '#1a1a1a',
    letterSpacing: 0,
  },
  tabBarDock: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 40,
    paddingBottom: Platform.OS === 'web' ? TAB_BAR_BOTTOM_GAP : TAB_BAR_BOTTOM_GAP + mobileSafeBottom(),
  },
  tabBarDockFixed: {
    paddingLeft: TAB_BAR_SIDE_EXPANDED,
    paddingRight: TAB_BAR_SIDE_EXPANDED,
  },
  tabBarShellFixed: {
    height: TAB_BAR_HEIGHT_EXPANDED,
  },
  tabBarLift: {
    position: 'relative',
    borderRadius: 999,
    ...Platform.select({
      web: {
        boxShadow: '0 10px 28px rgba(0,0,0,0.14), 0 1px 3px rgba(0,0,0,0.08)',
      },
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.16,
        shadowRadius: 18,
        elevation: 12,
      },
    }),
  },
  tabBarClip: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 999,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,0,0,0.08)',
  },
  tabBarBlur: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
    backgroundColor: 'rgba(252,252,251,0.92)',
    ...Platform.select({
      web: {
        backdropFilter: 'saturate(120%) blur(12px)',
        WebkitBackdropFilter: 'saturate(120%) blur(12px)',
      },
      default: {},
    }),
  },
  tabBar: {
    position: 'relative',
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: TAB_BAR_HEIGHT_EXPANDED,
    paddingHorizontal: 2,
    overflow: 'visible',
  },
  tabActive: {
    position: 'absolute',
    top: 5,
    bottom: 5,
    zIndex: 0,
    borderRadius: TAB_BAR_ACTIVE_RADIUS,
    backgroundColor: NAV_TAB_ACTIVE_BG,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    overflow: 'visible',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  tabLogo: {
    width: 30,
    height: 30,
    borderRadius: 15,
  },
  tabLogoDim: {
    opacity: 0.82,
  },
  tabIconWrap: {
    position: 'relative',
    overflow: 'visible',
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabAvatarRing: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabAvatarRingActive: {
    borderColor: '#fff',
  },
  tabAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#E5E5EA',
  },
  tabAvatarImage: {
    width: 28,
    height: 28,
  },
  tabAvatarInitials: {
    fontFamily,
    fontSize: 11,
    fontWeight: '700',
    color: MOBILE.label,
    letterSpacing: -0.2,
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: -10,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 4,
    borderRadius: 8,
    backgroundColor: '#FF3B30',
    borderWidth: 1.5,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    fontFamily,
    fontSize: 9,
    fontWeight: '700',
    color: '#fff',
    lineHeight: 11,
  },
});
