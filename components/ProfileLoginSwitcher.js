import { useMemo } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { accessiblePosSystems, primaryPosSystem } from '../lib/auth';

const fontFamily = 'Sohne';
const HAIRLINE = StyleSheet.hairlineWidth;
const ICON = '#8e8e93';
const INK = '#1a1a1a';

export function ProfileLoginIcon({
  onPress,
  disabled = false,
  active = false,
  size = 'sidebar',
  accessibilityLabel = 'Change login',
}) {
  const compact = size === 'tab';
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      {...(Platform.OS === 'web' ? { title: accessibilityLabel } : null)}
      style={({ pressed }) => [
        styles.iconBtn,
        compact && styles.iconBtnTab,
        pressed && !disabled && styles.iconBtnPressed,
        disabled && styles.iconBtnDisabled,
      ]}
    >
      <Ionicons
        name={active ? 'swap-horizontal' : 'swap-horizontal-outline'}
        size={compact ? 18 : 16}
        color={active ? INK : ICON}
      />
    </Pressable>
  );
}

export default function ProfileLoginSwitcher({
  visible,
  session,
  switchError = '',
  switching = false,
  onClose,
  onChangeLogin,
  onLogout,
}) {
  const current = primaryPosSystem(session);
  const systems = useMemo(() => accessiblePosSystems(session), [session]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalRoot}>
        <Pressable style={styles.modalBackdrop} onPress={onClose} accessibilityLabel="Close" />
        <View style={styles.card}>
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <Text style={styles.title}>Change login</Text>
              <Text style={styles.subtitle}>
                {current.label}
                {session?.login ? ` · ${session.login}` : ''}
              </Text>
            </View>
            <Pressable
              onPress={onClose}
              style={({ hovered, pressed }) => [
                styles.closeButton,
                (hovered || pressed) && styles.closeButtonHover,
              ]}
              accessibilityLabel="Close"
            >
              <Ionicons name="close" size={15} color={ICON} />
            </Pressable>
          </View>

          {switchError ? <Text style={styles.errorText}>{switchError}</Text> : null}

          <View style={styles.list}>
            <View style={styles.group}>
              {systems.map((system, index) => {
                const last = index === systems.length - 1;
                return (
                  <Pressable
                    key={system.key}
                    disabled={switching || system.current}
                    onPress={() => {
                      onClose?.();
                      onChangeLogin?.(system.key);
                    }}
                    style={({ hovered, pressed }) => [
                      styles.option,
                      (hovered || pressed) && !system.current && !switching && styles.optionHover,
                    ]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: system.current, disabled: switching }}
                    accessibilityLabel={system.label}
                  >
                    <View style={[styles.optionInner, !last && styles.optionDivider]}>
                      <View style={styles.optionCopy}>
                        <Text
                          style={[styles.optionTitle, system.current && styles.optionTitleActive]}
                          numberOfLines={1}
                        >
                          {system.label}
                        </Text>
                        <Text style={styles.optionMeta} numberOfLines={1}>
                          {system.current ? 'Current' : system.shortLabel}
                        </Text>
                      </View>
                      {system.current ? (
                        <Ionicons name="checkmark" size={17} color="#2F6FED" />
                      ) : null}
                    </View>
                  </Pressable>
                );
              })}
            </View>

            <View style={[styles.group, styles.logoutGroup]}>
              <Pressable
                onPress={() => {
                  onClose?.();
                  onLogout?.();
                }}
                disabled={switching}
                style={({ hovered, pressed }) => [
                  styles.option,
                  (hovered || pressed) && !switching && styles.optionHover,
                ]}
                accessibilityRole="button"
                accessibilityLabel="Log out"
              >
                <View style={styles.optionInner}>
                  <Text style={styles.logoutText}>Log Out</Text>
                </View>
              </Pressable>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  iconBtnTab: {
    width: 28,
    height: 28,
    borderRadius: 14,
  },
  iconBtnPressed: {
    opacity: 0.55,
  },
  iconBtnDisabled: {
    opacity: 0.4,
  },
  modalRoot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.18)',
  },
  card: {
    width: '100%',
    maxWidth: 320,
    backgroundColor: '#fff',
    borderRadius: 18,
    overflow: 'hidden',
    borderWidth: HAIRLINE,
    borderColor: 'rgba(0, 0, 0, 0.08)',
    ...Platform.select({
      web: {
        boxShadow: '0 18px 48px rgba(0, 0, 0, 0.18), 0 2px 8px rgba(0, 0, 0, 0.06)',
      },
      ios: {
        shadowColor: '#000',
        shadowOpacity: 0.18,
        shadowRadius: 28,
        shadowOffset: { width: 0, height: 14 },
      },
      android: { elevation: 12 },
      default: {},
    }),
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingLeft: 18,
    paddingRight: 14,
    paddingTop: 16,
    paddingBottom: 10,
    gap: 12,
  },
  headerCopy: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: '#1d1d1f',
    letterSpacing: -0.2,
  },
  subtitle: {
    fontFamily,
    fontSize: 12,
    color: '#8e8e93',
    marginTop: 2,
  },
  closeButton: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f2f2f7',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  closeButtonHover: {
    backgroundColor: '#e5e5ea',
  },
  errorText: {
    fontFamily,
    fontSize: 12,
    color: '#c41e3a',
    paddingHorizontal: 18,
    paddingBottom: 8,
  },
  list: {
    paddingHorizontal: 10,
    paddingBottom: 12,
  },
  group: {
    backgroundColor: '#f7f7f9',
    borderRadius: 12,
    overflow: 'hidden',
  },
  logoutGroup: {
    marginTop: 8,
  },
  option: {
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  optionHover: {
    backgroundColor: '#ececf0',
  },
  optionInner: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 40,
    marginLeft: 12,
    paddingRight: 12,
    paddingVertical: 8,
    gap: 10,
  },
  optionDivider: {
    borderBottomWidth: HAIRLINE,
    borderBottomColor: 'rgba(60, 60, 67, 0.12)',
  },
  optionCopy: {
    flex: 1,
    minWidth: 0,
  },
  optionTitle: {
    fontFamily,
    fontSize: 13.5,
    color: '#1d1d1f',
    letterSpacing: -0.15,
  },
  optionTitleActive: {
    fontWeight: '600',
  },
  optionMeta: {
    fontFamily,
    fontSize: 11.5,
    color: '#8e8e93',
    marginTop: 1,
  },
  logoutText: {
    fontFamily,
    fontSize: 13.5,
    fontWeight: '600',
    color: '#FF3B30',
    letterSpacing: -0.15,
  },
});
