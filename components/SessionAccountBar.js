import { useMemo, useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  accessiblePosSystems,
  POS_SYSTEMS,
  posSystemShortLabel,
  primaryPosSystem,
} from '../lib/auth';
import { CANVAS, useIsMobile } from '../lib/mobileUi';
import { IOS, IosActionRow, IosGroup, IosRow } from './IosSettings';

export default function SessionAccountBar({
  session,
  switchError = '',
  switching = false,
  onChangeLogin,
  onLogout,
  onUseDifferentAccount,
}) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const current = primaryPosSystem(session);
  const systems = useMemo(() => {
    const rows = accessiblePosSystems(session);
    if (rows.length) return rows;
    return POS_SYSTEMS.map((system) => ({
      ...system,
      shortLabel: posSystemShortLabel(system.key),
      current: system.key === current.key,
      available: system.key === current.key,
    }));
  }, [session, current.key]);

  const close = () => setOpen(false);

  return (
    <View style={[styles.bar, isMobile && styles.barMobile]}>
      <View style={styles.identity}>
        <Text style={[styles.dbLabel, isMobile && styles.dbLabelMobile]} numberOfLines={1}>
          {current.label}
        </Text>
      </View>
      <View style={styles.actions}>
        <Pressable
          onPress={() => setOpen(true)}
          disabled={switching}
          style={({ hovered, pressed }) => [
            styles.actionBtn,
            isMobile && styles.actionBtnMobile,
            (hovered || pressed) && styles.actionBtnPressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Change login"
        >
          <Text style={[styles.actionText, isMobile && styles.actionTextMobile]}>Change Login</Text>
        </Pressable>
        <Pressable
          onPress={onLogout}
          disabled={switching}
          style={({ hovered, pressed }) => [
            styles.actionBtn,
            isMobile && styles.actionBtnMobile,
            (hovered || pressed) && styles.actionBtnPressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Log out"
        >
          <Text style={[styles.actionText, styles.logoutText, isMobile && styles.actionTextMobile]}>
            Log Out
          </Text>
        </Pressable>
      </View>

      <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
        <View style={styles.modalRoot}>
          <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel="Close" />
          <View style={[styles.sheet, isMobile && styles.sheetMobile]}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Change login</Text>
              <Pressable onPress={close} hitSlop={8} accessibilityLabel="Close">
                <Ionicons name="close" size={22} color={IOS.secondary} />
              </Pressable>
            </View>
            {switchError ? <Text style={styles.sheetError}>{switchError}</Text> : null}
            <IosGroup
              header="Aureus database"
              footer="Only databases this Aureus login can open are available. Linked shared POS logins stay separate."
            >
              {systems.map((system) => (
                <IosRow
                  key={system.key}
                  label={system.label}
                  value={system.current ? 'Current' : system.available ? '' : 'Sign in'}
                  accessory={
                    system.current ? (
                      <Ionicons name="checkmark" size={20} color={IOS.blue} />
                    ) : null
                  }
                  onPress={() => {
                    close();
                    onChangeLogin?.(system.key);
                  }}
                />
              ))}
            </IosGroup>
            <IosGroup>
              <IosActionRow
                label="Use a different account"
                onPress={() => {
                  close();
                  onUseDifferentAccount?.();
                }}
              />
            </IosGroup>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    minHeight: 44,
    paddingHorizontal: 32,
    paddingVertical: 8,
    backgroundColor: CANVAS,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(60, 60, 67, 0.18)',
    zIndex: 20,
  },
  barMobile: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    minHeight: 40,
  },
  identity: {
    flex: 1,
    minWidth: 0,
  },
  dbLabel: {
    fontFamily: 'Sohne',
    fontSize: 13,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  dbLabelMobile: {
    fontSize: 13,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
  },
  actionBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  actionBtnMobile: {
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  actionBtnPressed: {
    backgroundColor: 'rgba(60, 60, 67, 0.08)',
  },
  actionText: {
    fontFamily: 'Sohne',
    fontSize: 13,
    fontWeight: '600',
    color: IOS.blue,
  },
  actionTextMobile: {
    fontSize: 13,
  },
  logoutText: {
    color: IOS.red,
  },
  modalRoot: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.28)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  sheet: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: IOS.bg,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 20,
    ...Platform.select({
      web: { boxShadow: '0 16px 40px rgba(0,0,0,0.18)' },
      default: {},
    }),
  },
  sheetMobile: {
    maxWidth: 400,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    marginBottom: 8,
  },
  sheetTitle: {
    fontFamily: 'Sohne',
    fontSize: 17,
    fontWeight: '600',
    color: IOS.label,
  },
  sheetError: {
    fontFamily: 'Sohne',
    fontSize: 13,
    color: '#b42318',
    paddingHorizontal: 4,
    marginBottom: 8,
  },
});
