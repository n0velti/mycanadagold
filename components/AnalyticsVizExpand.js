import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import {
  CANVAS,
  NAV_TAB_ACTIVE_BG,
  NAV_TAB_ACTIVE_RADIUS,
  mobileSafeBottom,
  mobileSafeTop,
  useIsMobile,
} from '../lib/mobileUi';
import { FONT } from './TriageKit';

const INK = '#1a1a1a';
const CHIP_BORDER = '#d0d0d0';
const RULE = 'rgba(42,38,30,0.08)';
const CHIP_SHADOW = Platform.select({
  web: { boxShadow: '0 1px 2px rgba(0,0,0,0.05)' },
  default: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 2,
    elevation: 1,
  },
});

/**
 * Card chrome plus an expanded view so a chart or map can be redrawn larger.
 * Phones get a full-screen sheet with its own header and a "Back to chat"
 * footer; desktop gets a centered dialog. The plot is mounted in only one
 * place at a time so ECharts / Maps re-init on the visible node.
 *
 * `children(expanded, compact)` renders the plot.
 */
export default function AnalyticsVizExpand({ title, subtitle, extra, inlinePlotStyle, children }) {
  const [open, setOpen] = useState(false);
  const { width, height } = useWindowDimensions();
  const compact = useIsMobile();

  useEffect(() => {
    if (!open || typeof window === 'undefined') return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const close = () => setOpen(false);
  const expand = () => setOpen(true);
  const extraNode = typeof extra === 'function' ? extra() : extra;

  const inlineHead = (
    <View style={styles.head}>
      <View style={styles.headText}>
        {title ? <Text style={styles.title}>{title}</Text> : null}
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      <Pressable
        onPress={expand}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={`Expand ${title || 'chart'}`}
        style={({ hovered, pressed }) => [
          styles.expandButton,
          compact && styles.expandButtonPhone,
          (hovered || pressed) && styles.expandButtonOn,
        ]}
      >
        <Ionicons name="expand-outline" size={15} color={INK} />
        {compact ? <Text style={styles.expandLabel}>Expand</Text> : null}
      </Pressable>
    </View>
  );

  const expandedHead = (
    <View style={[styles.head, compact && styles.fullHead]}>
      <View style={styles.headText}>
        {title ? (
          <Text style={[styles.title, compact && styles.fullTitle]} numberOfLines={2}>
            {title}
          </Text>
        ) : null}
        {subtitle ? (
          <Text style={styles.subtitle} numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <Pressable
        onPress={close}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Close and return to the chat"
        style={({ hovered, pressed }) => [styles.closeCircle, (hovered || pressed) && styles.closeCircleOn]}
      >
        <Ionicons name="close" size={18} color={INK} />
      </Pressable>
    </View>
  );

  const dialogWidth = Math.min(width - 24, 1100);
  const dialogHeight = Math.min(height - 24, height * 0.92);

  const expandedBody = compact ? (
    <View style={[styles.fullRoot, { paddingTop: mobileSafeTop() }]}>
      {expandedHead}
      <View style={styles.expandedPlot}>{open ? children(true, compact) : null}</View>
      {extraNode ? <View style={styles.fullExtra}>{extraNode}</View> : null}
      <View style={[styles.fullFoot, { paddingBottom: mobileSafeBottom() + 8 }]}>
        <Pressable
          onPress={close}
          accessibilityRole="button"
          accessibilityLabel="Back to chat"
          style={({ pressed }) => [styles.fullDone, pressed && styles.fullDoneOn]}
        >
          <Ionicons name="chevron-back" size={16} color="#fff" />
          <Text style={styles.fullDoneText}>Back to chat</Text>
        </Pressable>
      </View>
    </View>
  ) : (
    <View style={styles.backdrop}>
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={close}
        accessibilityRole="button"
        accessibilityLabel="Close expanded view"
      />
      <View style={[styles.dialog, { width: dialogWidth, height: dialogHeight }]} accessibilityViewIsModal>
        {expandedHead}
        <View style={styles.expandedPlot}>{open ? children(true, compact) : null}</View>
        {extraNode}
      </View>
    </View>
  );

  return (
    <View style={[styles.card, compact && styles.cardPhone]}>
      {inlineHead}
      {open ? (
        <View pointerEvents="none" style={[styles.placeholder, inlinePlotStyle]} />
      ) : (
        children(false, compact)
      )}
      {extraNode}
      <Modal
        visible={open}
        transparent={!compact}
        animationType={compact ? 'slide' : 'fade'}
        presentationStyle={compact ? 'fullScreen' : 'overFullScreen'}
        statusBarTranslucent
        onRequestClose={close}
      >
        {expandedBody}
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    alignSelf: 'stretch',
    marginTop: 8,
    paddingTop: 12,
    paddingHorizontal: 8,
    paddingBottom: 8,
    borderRadius: NAV_TAB_ACTIVE_RADIUS,
    borderWidth: 1,
    borderColor: CHIP_BORDER,
    backgroundColor: CANVAS,
    gap: 8,
  },
  cardPhone: {
    paddingHorizontal: 6,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingHorizontal: 8,
  },
  headText: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  title: {
    fontFamily: FONT,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '500',
    color: INK,
    letterSpacing: -0.1,
  },
  subtitle: {
    fontFamily: FONT,
    fontSize: 12,
    lineHeight: 16,
    color: '#6e6e73',
  },
  expandButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: CHIP_BORDER,
    backgroundColor: CANVAS,
    flexShrink: 0,
    ...CHIP_SHADOW,
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  expandButtonPhone: {
    width: 'auto',
    paddingHorizontal: 11,
  },
  expandButtonOn: {
    backgroundColor: NAV_TAB_ACTIVE_BG,
  },
  expandLabel: {
    fontFamily: FONT,
    fontSize: 12,
    fontWeight: '500',
    color: INK,
    letterSpacing: -0.1,
  },
  placeholder: {
    width: '100%',
    backgroundColor: '#f2f2f7',
    borderRadius: 8,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
  },
  dialog: {
    zIndex: 1,
    backgroundColor: CANVAS,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: CHIP_BORDER,
    paddingTop: 14,
    paddingHorizontal: 12,
    paddingBottom: 12,
    gap: 8,
  },
  closeCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: CHIP_BORDER,
    backgroundColor: CANVAS,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    ...CHIP_SHADOW,
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  closeCircleOn: {
    backgroundColor: NAV_TAB_ACTIVE_BG,
  },
  expandedPlot: {
    flex: 1,
    minHeight: 0,
    width: '100%',
  },
  fullRoot: {
    flex: 1,
    minHeight: 0,
    backgroundColor: CANVAS,
    paddingHorizontal: 8,
    gap: 10,
  },
  fullHead: {
    alignItems: 'center',
    paddingTop: 6,
    paddingBottom: 4,
    paddingHorizontal: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: RULE,
    minHeight: 48,
  },
  fullTitle: {
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  fullExtra: {
    paddingHorizontal: 0,
  },
  fullFoot: {
    paddingTop: 2,
    paddingHorizontal: 8,
  },
  fullDone: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    minHeight: 46,
    borderRadius: 12,
    backgroundColor: INK,
    paddingHorizontal: 16,
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  fullDoneOn: {
    backgroundColor: '#3a3a3c',
  },
  fullDoneText: {
    fontFamily: FONT,
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
    letterSpacing: -0.1,
  },
});
