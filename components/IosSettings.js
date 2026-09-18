import { Children, cloneElement, isValidElement } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const fontFamily = 'Sohne';

export const IOS = {
  bg: '#F2F2F7',
  group: '#FFFFFF',
  label: '#000000',
  secondary: '#8E8E93',
  header: '#6D6D72',
  chevron: '#C7C7CC',
  separator: 'rgba(60, 60, 67, 0.29)',
  press: '#D1D1D6',
  blue: '#007AFF',
  green: '#34C759',
  red: '#FF3B30',
};

export function IosIcon({ name, color }) {
  return (
    <View style={[styles.icon, { backgroundColor: color }]}>
      <Ionicons name={name} size={17} color="#fff" />
    </View>
  );
}

export function IosSwitch({ on, disabled, onPress }) {
  const track = (
    <View
      style={[styles.switchTrack, on && styles.switchTrackOn, disabled && styles.switchDisabled]}
      pointerEvents={onPress ? 'auto' : 'none'}
    >
      <View style={[styles.switchThumb, on && styles.switchThumbOn]} />
    </View>
  );

  if (!onPress) return track;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={4}
      accessibilityRole="switch"
      accessibilityState={{ checked: on, disabled: Boolean(disabled) }}
    >
      {track}
    </Pressable>
  );
}

export function IosRow({
  icon,
  iconColor,
  label,
  value,
  last = false,
  onPress,
  accessory,
  destructive = false,
  children,
}) {
  const showChevron = Boolean(onPress) && !accessory && !children;
  const body = (
    <>
      {icon ? <IosIcon name={icon} color={iconColor} /> : null}
      <View style={[styles.rowBody, last && styles.rowBodyLast, !icon && styles.rowBodyFlush]}>
        <View style={styles.rowCopy}>
          <Text
            style={[styles.rowLabel, destructive && styles.rowLabelDestructive]}
            numberOfLines={1}
          >
            {label}
          </Text>
          {children}
        </View>
        {value ? (
          <Text style={styles.rowValue} numberOfLines={1}>
            {value}
          </Text>
        ) : null}
        {accessory}
        {showChevron ? <Ionicons name="chevron-forward" size={18} color={IOS.chevron} /> : null}
      </View>
    </>
  );

  const rowStyle = [styles.row, onPress && styles.rowTappable];

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [rowStyle, pressed && styles.rowPressed]}
        accessibilityRole="button"
        accessibilityLabel={value ? `${label}, ${value}` : label}
      >
        {body}
      </Pressable>
    );
  }

  return <View style={rowStyle}>{body}</View>;
}

export function IosGroup({ header, footer, children }) {
  const items = Children.toArray(children).filter(Boolean);
  return (
    <View style={styles.section}>
      {header ? <Text style={styles.sectionHeader}>{header}</Text> : null}
      <View style={styles.group}>
        {items.map((child, index) => {
          const last = isValidElement(child)
            ? child.props.last ?? index === items.length - 1
            : index === items.length - 1;
          if (!isValidElement(child) || (child.type !== IosRow && child.type !== IosActionRow)) {
            return child;
          }
          return cloneElement(child, { last });
        })}
      </View>
      {footer ? <Text style={styles.sectionFooter}>{footer}</Text> : null}
    </View>
  );
}

export function IosActionRow({ label, onPress, disabled, destructive, last = true }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.actionRow,
        last && styles.actionRowLast,
        pressed && !disabled && styles.rowPressed,
        disabled && styles.actionDisabled,
      ]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Text
        style={[
          styles.actionLabel,
          destructive && styles.rowLabelDestructive,
          disabled && styles.actionLabelDisabled,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function IosPage({ children, contentContainerStyle }) {
  return (
    <ScrollView
      style={styles.page}
      contentContainerStyle={[styles.pageContent, contentContainerStyle]}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    minHeight: 0,
    backgroundColor: IOS.bg,
    ...Platform.select({
      web: {
        overflowY: 'auto',
        overflowX: 'hidden',
        height: 0,
      },
      default: {},
    }),
  },
  pageContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 48,
  },
  section: {
    marginBottom: 8,
  },
  sectionHeader: {
    fontFamily,
    fontSize: 13,
    fontWeight: '400',
    color: IOS.header,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    paddingHorizontal: 16,
    marginBottom: 6,
    marginTop: 16,
  },
  sectionFooter: {
    fontFamily,
    fontSize: 13,
    fontWeight: '400',
    color: IOS.header,
    lineHeight: 18,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  group: {
    backgroundColor: IOS.group,
    borderRadius: 10,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    paddingLeft: 16,
    backgroundColor: IOS.group,
  },
  rowTappable: {
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  rowPressed: {
    backgroundColor: IOS.press,
  },
  icon: {
    width: 30,
    height: 30,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  rowBody: {
    flex: 1,
    minWidth: 0,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 11,
    paddingRight: 12,
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: IOS.separator,
  },
  rowBodyLast: {
    borderBottomWidth: 0,
  },
  rowBodyFlush: {
    paddingLeft: 0,
  },
  rowCopy: {
    flex: 1,
    minWidth: 0,
  },
  rowLabel: {
    fontFamily,
    fontSize: 17,
    fontWeight: '400',
    color: IOS.label,
    letterSpacing: -0.4,
  },
  rowLabelDestructive: {
    color: IOS.red,
  },
  rowValue: {
    fontFamily,
    fontSize: 17,
    fontWeight: '400',
    color: IOS.secondary,
    letterSpacing: -0.4,
    flexShrink: 1,
    maxWidth: '48%',
    textAlign: 'right',
  },
  actionRow: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    backgroundColor: IOS.group,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: IOS.separator,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  actionRowLast: {
    borderBottomWidth: 0,
  },
  actionLabel: {
    fontFamily,
    fontSize: 17,
    fontWeight: '400',
    color: IOS.blue,
    letterSpacing: -0.4,
  },
  actionLabelDisabled: {
    color: IOS.secondary,
  },
  actionDisabled: {
    ...Platform.select({
      web: { cursor: 'default' },
      default: {},
    }),
  },
  switchTrack: {
    width: 51,
    height: 31,
    borderRadius: 16,
    backgroundColor: '#E9E9EA',
    padding: 2,
    justifyContent: 'center',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  switchTrackOn: {
    backgroundColor: IOS.green,
  },
  switchThumb: {
    width: 27,
    height: 27,
    borderRadius: 14,
    backgroundColor: '#fff',
    alignSelf: 'flex-start',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOpacity: 0.15,
        shadowRadius: 2,
        shadowOffset: { width: 0, height: 3 },
      },
      android: { elevation: 2 },
      default: {
        boxShadow: '0 3px 8px rgba(0,0,0,0.15)',
      },
    }),
  },
  switchThumbOn: {
    alignSelf: 'flex-end',
  },
  switchDisabled: {
    opacity: 0.45,
    ...Platform.select({
      web: { cursor: 'default' },
      default: {},
    }),
  },
});
