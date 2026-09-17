import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { Image, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { MOBILE, mobileSafeBottom, mobileSafeTop } from '../lib/mobileUi';

const fontFamily = 'Sohne';
const titleFontFamily = 'SohneLeicht';

export function MobileSafeTop() {
  return (
    <View
      style={[styles.safeTop, { height: mobileSafeTop() }]}
      {...(Platform.OS === 'web' ? { className: 'cgold-mobile-inset-top' } : null)}
    />
  );
}

export function MobileHomeHeader({ onBuy, onSell }) {
  return (
    <View style={styles.homeHeader}>
      <View style={styles.brandMark}>
        <Image
          source={require('../assets/small_logo.png')}
          style={styles.brandLogo}
          resizeMode="cover"
          accessibilityLabel="Canada Gold"
        />
      </View>
      <Text style={styles.wordmark}>MyCanadaGold</Text>
      {onBuy || onSell ? (
        <View style={styles.tradePair}>
          {onBuy ? (
            <Pressable
              onPress={onBuy}
              style={[styles.tradeChip, styles.tradeChipBuy]}
              accessibilityRole="button"
              accessibilityLabel="Buy"
              accessibilityHint="Buy metal from a customer"
            >
              <Text style={styles.tradeChipLabel}>Buy</Text>
            </Pressable>
          ) : null}
          {onSell ? (
            <Pressable
              onPress={onSell}
              style={[styles.tradeChip, styles.tradeChipSell]}
              accessibilityRole="button"
              accessibilityLabel="Sell"
              accessibilityHint="Sell metal to a customer"
            >
              <Text style={styles.tradeChipLabel}>Sell</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

export function MobileNavHeader({ title, subtitle, onBack, trailing }) {
  return (
    <View style={styles.navHeader}>
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

export function MobileTabBar({ tabs, activeKey, onSelect, messagesUnread = 0 }) {
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
              <Ionicons
                name={isActive ? tab.iconActive : tab.icon}
                size={26}
                color={isActive ? MOBILE.label : MOBILE.secondary}
              />
              {badge ? (
                <View style={styles.badge} pointerEvents="none">
                  <Text style={styles.badgeText}>{badge}</Text>
                </View>
              ) : null}
            </View>
            <Text style={[styles.tabLabel, isActive && styles.tabLabelActive]}>
              {tab.label}
            </Text>
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
  homeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 10,
    gap: 8,
    backgroundColor: MOBILE.feed,
  },
  brandMark: {
    width: 28,
    height: 28,
    borderRadius: 14,
    overflow: 'hidden',
  },
  brandLogo: {
    width: 28,
    height: 28,
  },
  wordmark: {
    fontFamily: titleFontFamily,
    flex: 1,
    minWidth: 0,
    fontSize: 22,
    fontWeight: '400',
    color: MOBILE.label,
    letterSpacing: -0.7,
  },
  tradePair: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginLeft: 'auto',
  },
  tradeChip: {
    minWidth: 52,
    height: 30,
    paddingHorizontal: 12,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  tradeChipBuy: {
    backgroundColor: '#1F8A4E',
  },
  tradeChipSell: {
    backgroundColor: '#C0392B',
  },
  tradeChipLabel: {
    fontFamily,
    fontSize: 13,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: 0.2,
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
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingTop: 6,
    paddingBottom: mobileSafeBottom(),
    backgroundColor: 'rgba(255,255,255,0.72)',
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
    gap: 2,
    minHeight: 44,
    paddingTop: 2,
    overflow: 'visible',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  tabIconWrap: {
    position: 'relative',
    overflow: 'visible',
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabLabel: {
    fontFamily,
    fontSize: 10,
    fontWeight: '500',
    color: MOBILE.secondary,
    letterSpacing: -0.08,
  },
  tabLabelActive: {
    color: MOBILE.label,
    fontWeight: '600',
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
