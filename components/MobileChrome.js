import { useEffect, useState } from 'react';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { Image, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { MOBILE, MOBILE_FILTER_SIZE, mobileSafeBottom, mobileSafeTop } from '../lib/mobileUi';

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
            size={17}
            color={active ? MOBILE.label : MOBILE.secondary}
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

export function MobileFilterLines({ color }) {
  return (
    <View style={styles.filterLines}>
      <View style={[styles.filterLine, { width: 15, backgroundColor: color }]} />
      <View style={[styles.filterLine, { width: 11, backgroundColor: color }]} />
      <View style={[styles.filterLine, { width: 7, backgroundColor: color }]} />
    </View>
  );
}

export function MobileFilterChip({ label, active = false, onPress, accessibilityLabel, accessibilityState, style }) {
  const color = active ? MOBILE.label : MOBILE.secondary;
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

export function MobileNavHeader({ title, subtitle, onBack, trailing, titleAction, grouped = false }) {
  const start = Boolean(titleAction);
  return (
    <View style={[styles.navHeader, grouped && styles.navHeaderGrouped]}>
      <Pressable
        onPress={onBack}
        style={styles.navSide}
        hitSlop={8}
        accessibilityLabel="Back"
      >
        <Ionicons name="chevron-back" size={28} color={MOBILE.blue} />
      </Pressable>
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
      <View style={[styles.navSide, (trailing || titleAction) && styles.navTrailing]}>{trailing}</View>
    </View>
  );
}

export function MobileTabBar({
  tabs,
  activeKey,
  onSelect,
  messagesUnread = 0,
  profileAvatarUrl = '',
  profileName = '',
}) {
  return (
    <BlurView
      intensity={72}
      tint="light"
      style={styles.tabBar}
      {...(Platform.OS === 'web' ? { className: 'cgold-mobile-tab-bar' } : null)}
    >
      <View style={styles.tabHairline} />
      {tabs.map((tab) => {
        const isActive = activeKey === tab.key;
        const unread = tab.key === 'messages' ? messagesUnread : 0;
        const badge = unread > 99 ? '99+' : unread > 0 ? String(unread) : '';
        const isProfile = tab.key === 'profile';
        const isHome = tab.key === 'home';
        return (
          <Pressable
            key={tab.key}
            onPress={() => onSelect(tab.key)}
            style={styles.tab}
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
                  size={26}
                  color={isActive ? MOBILE.label : MOBILE.secondary}
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
    </BlurView>
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
    backgroundColor: MOBILE.feed,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: MOBILE.separator,
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
  navTrailingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
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
  navTitleAction: {
    flexShrink: 0,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  navTitleActionText: {
    fontFamily,
    fontSize: 17,
    fontWeight: '600',
    color: MOBILE.blue,
    letterSpacing: -0.3,
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
  filterLine: {
    height: 1.5,
    borderRadius: 1,
  },
  tabBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 40,
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 8,
    paddingBottom: mobileSafeBottom(),
    backgroundColor: 'rgba(255,255,255,0.62)',
    overflow: 'visible',
    ...Platform.select({
      web: {
        backdropFilter: 'saturate(180%) blur(22px)',
        WebkitBackdropFilter: 'saturate(180%) blur(22px)',
      },
      default: {},
    }),
  },
  tabHairline: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(0,0,0,0.16)',
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
    opacity: 0.55,
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
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1.5,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabAvatarRingActive: {
    borderColor: MOBILE.label,
  },
  tabAvatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#E5E5EA',
  },
  tabAvatarImage: {
    width: 30,
    height: 30,
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
