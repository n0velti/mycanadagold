import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { FONT } from '../lib/typography';

export const NAV_CRUMB_HOVER = 'rgba(60, 60, 67, 0.08)';
export const NAV_CRUMB_RADIUS = 8;

/** Muted `/` between brand and crumbs — hidden from assistive tech. */
export function NavSlash() {
  return (
    <Text
      style={styles.slash}
      accessible={false}
      importantForAccessibility="no"
      {...(Platform.OS === 'web' ? { className: 'cgold-nav-slash', 'aria-hidden': true } : null)}
    >
      /
    </Text>
  );
}

export function NavCrumb({
  current = false,
  onPress,
  accessibilityLabel,
  accessibilityHint,
  accessibilityState,
  children,
  style,
}) {
  const webProps =
    Platform.OS === 'web'
      ? {
          className: 'cgold-nav-crumb',
          ...(current ? { 'aria-current': 'page' } : null),
        }
      : null;

  const crumbStyle = ({ hovered, pressed }) => [
    styles.crumb,
    current && styles.crumbCurrent,
    (hovered || pressed) && onPress ? styles.crumbHover : null,
    style,
  ];

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={crumbStyle}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={accessibilityHint}
        accessibilityState={{ selected: current, ...accessibilityState }}
        {...webProps}
      >
        {children}
      </Pressable>
    );
  }

  return (
    <View
      style={[styles.crumb, current && styles.crumbCurrent, style]}
      accessibilityLabel={accessibilityLabel}
      {...webProps}
    >
      {children}
    </View>
  );
}

/** Hover shell when a crumb holds more than one control (label + chevrons). */
export function NavCrumbCluster({ current = false, children, style }) {
  return (
    <View
      style={[styles.crumb, current && styles.crumbCurrent, style]}
      {...(Platform.OS === 'web' ? { className: 'cgold-nav-crumb' } : null)}
    >
      {children}
    </View>
  );
}

export function NavCrumbLabel({ children, current = false, style }) {
  return (
    <Text style={[styles.label, current && styles.labelCurrent, style]} numberOfLines={1}>
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  slash: {
    fontFamily: FONT,
    fontSize: 15,
    fontWeight: '400',
    color: '#d4d4d8',
    lineHeight: 20,
    paddingHorizontal: 2,
    ...Platform.select({
      web: { userSelect: 'none' },
      default: {},
    }),
  },
  crumb: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 32,
    paddingHorizontal: 8,
    borderRadius: NAV_CRUMB_RADIUS,
    flexShrink: 1,
    minWidth: 0,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  crumbCurrent: {},
  crumbHover: {
    backgroundColor: NAV_CRUMB_HOVER,
  },
  label: {
    flexShrink: 1,
    minWidth: 0,
    fontFamily: FONT,
    fontSize: 13,
    fontWeight: '500',
    color: '#1d1d1f',
    letterSpacing: -0.15,
  },
  labelCurrent: {
    color: '#1d1d1f',
  },
});
