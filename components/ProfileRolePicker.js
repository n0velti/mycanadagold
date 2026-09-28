import { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getCategory, switchOwnAppRole } from '../lib/permissions';

const fontFamily = Platform.select({
  ios: 'Sohne',
  android: 'Sohne',
  default: 'Sohne',
});

export default function ProfileRolePicker({
  visible,
  roles = [],
  selectedRole,
  onClose,
  onChanged,
}) {
  const [savingRole, setSavingRole] = useState('');
  const [error, setError] = useState('');

  const handleSelect = async (role) => {
    if (!role || role === selectedRole || savingRole) {
      onClose?.();
      return;
    }
    setSavingRole(role);
    setError('');
    try {
      const updated = await switchOwnAppRole(role);
      onChanged?.(updated);
      onClose?.();
    } catch (err) {
      setError(err?.message || 'Could not change that role.');
    } finally {
      setSavingRole('');
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalRoot}>
        <Pressable style={styles.modalBackdrop} onPress={onClose} accessibilityLabel="Dismiss" />
        <View style={styles.card}>
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <Text style={styles.title}>Role</Text>
              <Text style={styles.subtitle}>Choose how you work in the app today.</Text>
            </View>
            <Pressable
              onPress={onClose}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Close"
              style={({ pressed, hovered }) => [
                styles.closeButton,
                (pressed || hovered) && styles.closeButtonHover,
              ]}
            >
              <Ionicons name="close" size={15} color="#6e6e73" />
            </Pressable>
          </View>

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          <View style={styles.group}>
            {roles.map((role, index) => {
              const category = getCategory(role);
              const active = role === selectedRole;
              const saving = savingRole === role;
              const last = index === roles.length - 1;
              return (
                <Pressable
                  key={role}
                  style={({ pressed, hovered }) => [
                    styles.option,
                    (pressed || hovered) && !savingRole && styles.optionHover,
                  ]}
                  onPress={() => handleSelect(role)}
                  disabled={Boolean(savingRole)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active, busy: saving }}
                  accessibilityLabel={category?.label || role}
                >
                  <View style={[styles.optionInner, !last && styles.optionDivider]}>
                    <View
                      style={[
                        styles.swatch,
                        { backgroundColor: category?.tint || '#F4F4F5' },
                      ]}
                    >
                      <View style={[styles.swatchDot, { backgroundColor: category?.accent || '#52525B' }]} />
                    </View>
                    <View style={styles.optionCopy}>
                      <Text style={[styles.optionTitle, active && styles.optionTitleActive]} numberOfLines={1}>
                        {category?.label || role}
                      </Text>
                      {category?.description ? (
                        <Text style={styles.optionMeta} numberOfLines={2}>
                          {category.description}
                        </Text>
                      ) : null}
                    </View>
                    <View style={styles.optionTrailing}>
                      {saving ? (
                        <ActivityIndicator size="small" color="#8e8e93" />
                      ) : active ? (
                        <Ionicons name="checkmark" size={17} color="#2F6FED" />
                      ) : null}
                    </View>
                  </View>
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const HAIRLINE = StyleSheet.hairlineWidth;

const styles = StyleSheet.create({
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
  group: {
    marginHorizontal: 10,
    marginBottom: 10,
    backgroundColor: '#f7f7f9',
    borderRadius: 12,
    overflow: 'hidden',
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
    minHeight: 48,
    marginLeft: 12,
    paddingRight: 12,
    paddingVertical: 10,
    gap: 10,
  },
  optionDivider: {
    borderBottomWidth: HAIRLINE,
    borderBottomColor: 'rgba(60, 60, 67, 0.12)',
  },
  swatch: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swatchDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
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
  optionTrailing: {
    width: 20,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
});
