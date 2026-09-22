import { useEffect, useState } from 'react';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { Image, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { MOBILE, mobileSafeBottom, mobileSafeTop } from '../lib/mobileUi';

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

export function MobileNavHeader({ title, subtitle, onBack, trailing, grouped = false }) {
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
      <View style={styles.navTitleBlock}>
        <Text style={styles.navTitle} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.navSubtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <View style={[styles.navSide, trailing && styles.navTrailing]}>{trailing}</View>
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
  navTitle: {
    fontFamily,
    fontSize: 17,
    fontWeight: '600',
    color: MOBILE.label,
    textAlign: 'center',
    letterSpacing: -0.3,
  },
  navSubtitle: {
    fontFamily,
    fontSize: 12,
    fontWeight: '400',
    color: MOBILE.secondary,
    textAlign: 'center',
    marginTop: -1,
  },
  tabBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 20,
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 8,
    paddingBottom: mobileSafeBottom(),
    backgroundColor: Platform.OS === 'web' ? 'transparent' : 'rgba(255,255,255,0.55)',
    overflow: 'visible',
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
