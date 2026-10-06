import { useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  Animated,
  Linking,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  buildHasPreview,
  buildIsPublishRequested,
  buildStatusDetail,
  buildStatusLabel,
  canPublishBuild,
} from '../lib/agentBuilds';

const fontFamily = Platform.select({ ios: 'Sohne', android: 'Sohne', default: 'Sohne' });

const BLUE = '#0A84FF';
const GREEN = '#34C759';
const AMBER = '#FF9F0A';
const RED = '#FF3B30';
const GREY = '#aeaeb2';

export function openPreviewUrl(url) {
  const href = String(url || '').trim();
  if (!href) return;
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    window.open(href, '_blank', 'noopener,noreferrer');
    return;
  }
  void Linking.openURL(href);
}

/**
 * What the screen says. "Baking" until a preview exists, then a green
 * "View" (even while the agent keeps working), "Done" for a run with no
 * deployment, "Error" on failure. Idle shows a plain TV outline.
 */
function screenTone(build) {
  const status = build?.status || 'idle';
  if (buildHasPreview(build)) return { color: GREEN, tint: 'rgba(52,199,89,0.12)', label: 'View' };
  if (status === 'baking') return { color: AMBER, tint: 'rgba(255,159,10,0.12)', label: 'Baking' };
  if (status === 'ready') return { color: BLUE, tint: 'rgba(10,132,255,0.10)', label: 'Done' };
  if (status === 'failed') return { color: RED, tint: 'rgba(255,59,48,0.10)', label: 'Error' };
  return { color: GREY, tint: 'transparent', label: '' };
}

/**
 * A small flat TV in the agent thread header. The stand under the screen
 * is the progress bar while the agent works. Tapping opens the preview when
 * there is one; otherwise (and on long-press) it opens the status sheet.
 */
export function AgentPreviewTv({ build, onPress, onOpenPreview }) {
  const status = build?.status || 'idle';
  const tone = screenTone(build);
  const hasPreview = buildHasPreview(build);
  const pulse = useRef(new Animated.Value(1)).current;
  const fill = useRef(new Animated.Value(0)).current;
  const pct = status === 'baking' ? Math.max(0, Math.min(100, Number(build?.progressPct) || 0)) : 0;

  useEffect(() => {
    if (status !== 'baking' || hasPreview) {
      pulse.stopAnimation();
      pulse.setValue(1);
      return undefined;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.35, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [hasPreview, pulse, status]);

  useEffect(() => {
    Animated.timing(fill, {
      toValue: pct,
      duration: 500,
      useNativeDriver: false,
    }).start();
  }, [fill, pct]);

  const label = buildStatusLabel(build);
  const barWidth = fill.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'] });
  return (
    <Pressable
      onPress={() => {
        if (hasPreview && onOpenPreview) onOpenPreview(build.previewUrl);
        else onPress?.();
      }}
      onLongPress={onPress}
      style={({ hovered, pressed }) => [styles.tvButton, (hovered || pressed) && styles.tvButtonActive]}
      accessibilityRole="button"
      accessibilityLabel={hasPreview ? 'Open preview' : `Preview: ${label}`}
      accessibilityHint={hasPreview ? 'Long press for details' : undefined}
      hitSlop={6}
    >
      <View style={[styles.tvScreen, { borderColor: tone.color, backgroundColor: tone.tint }]}>
        {tone.label ? (
          <Animated.Text style={[styles.tvText, { color: tone.color, opacity: pulse }]} numberOfLines={1}>
            {tone.label}
          </Animated.Text>
        ) : (
          <Ionicons name="tv-outline" size={16} color={GREY} />
        )}
      </View>
      <View style={[styles.tvStand, status === 'baking' && styles.tvStandTrack]}>
        {status === 'baking' ? (
          <Animated.View style={[styles.tvStandFill, { width: barWidth, backgroundColor: tone.color }]} />
        ) : (
          <View style={[styles.tvStandFill, { width: '35%', alignSelf: 'center', backgroundColor: tone.color }]} />
        )}
      </View>
    </Pressable>
  );
}

/**
 * Header pill. Dimmed until the agent has finished and pushed something,
 * "Sent" once the requester has asked for it to go live. A later edit
 * re-arms it (the proxy clears publish_state when a new run starts).
 */
export function AgentPublishButton({ build, onPress, busy }) {
  const sent = buildIsPublishRequested(build);
  const enabled = !sent && !busy && canPublishBuild(build);
  const label = sent ? 'Sent' : busy ? 'Sending…' : 'Publish';
  return (
    <Pressable
      onPress={enabled ? onPress : undefined}
      disabled={!enabled}
      style={({ hovered, pressed }) => [
        styles.publishButton,
        sent && styles.publishButtonSent,
        !enabled && !sent && styles.publishButtonOff,
        enabled && (hovered || pressed) && styles.publishButtonActive,
      ]}
      accessibilityRole="button"
      accessibilityState={{ disabled: !enabled }}
      accessibilityLabel={sent ? 'Sent for publishing' : 'Publish this change'}
      accessibilityHint={
        enabled
          ? 'Tells a System Admin you are happy with the preview'
          : sent
            ? undefined
            : 'Available once the agent has finished'
      }
      hitSlop={4}
    >
      {sent ? <Ionicons name="checkmark" size={14} color={GREEN} /> : null}
      <Text style={[styles.publishText, sent && styles.publishTextSent, !enabled && !sent && styles.publishTextOff]}>
        {label}
      </Text>
    </Pressable>
  );
}

export function AgentPublishSheet({ visible, build, isMobile, adminNames, onClose, onConfirm, busy }) {
  const who =
    Array.isArray(adminNames) && adminNames.length
      ? adminNames.length <= 2
        ? adminNames.join(' and ')
        : `${adminNames.slice(0, 2).join(', ')} and ${adminNames.length - 2} more`
      : 'a System Admin';
  return (
    <Modal visible={visible} transparent animationType={isMobile ? 'slide' : 'fade'} onRequestClose={onClose}>
      <View style={[styles.sheetRoot, !isMobile && styles.sheetRootDesktop]}>
        <Pressable style={styles.sheetBackdrop} onPress={busy ? undefined : onClose} accessibilityLabel="Close" />
        <View style={[styles.sheetCard, isMobile && styles.sheetCardMobile]}>
          <View style={styles.sheetHeader}>
            <Ionicons name="rocket-outline" size={18} color={BLUE} />
            <Text style={styles.sheetTitle}>Publish this change?</Text>
          </View>
          <Text style={styles.sheetBody}>
            Only do this once you are happy with the preview. It sends {who} a message with your request, the
            preview, and the pull request so it can be pushed live. You can keep editing afterwards; a new edit
            will need another Publish.
          </Text>
          {build?.summary ? (
            <View style={styles.summaryBox}>
              <Text style={styles.summaryLabel}>What the agent did</Text>
              <Text style={styles.summaryText} numberOfLines={4}>
                {build.summary}
              </Text>
            </View>
          ) : null}
          <Pressable
            onPress={onConfirm}
            disabled={busy}
            style={({ pressed }) => [styles.primaryButton, (pressed || busy) && styles.primaryButtonPressed]}
            accessibilityLabel="Publish"
          >
            {busy ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Ionicons name="paper-plane-outline" size={18} color="#fff" />
            )}
            <Text style={styles.primaryButtonText}>{busy ? 'Sending…' : 'Publish'}</Text>
          </Pressable>
          <Pressable
            onPress={onClose}
            disabled={busy}
            style={({ pressed }) => [styles.closeButton, pressed && styles.closeButtonPressed]}
            accessibilityLabel="Not yet"
          >
            <Text style={styles.closeButtonText}>Not yet</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

export function AgentPreviewSheet({ visible, build, isMobile, onClose, onRefresh, refreshing }) {
  const status = build?.status || 'idle';
  const tone = screenTone(build);
  const canOpen = (status === 'ready' || status === 'baking') && Boolean(build?.previewUrl);
  return (
    <Modal visible={visible} transparent animationType={isMobile ? 'slide' : 'fade'} onRequestClose={onClose}>
      <View style={[styles.sheetRoot, !isMobile && styles.sheetRootDesktop]}>
        <Pressable style={styles.sheetBackdrop} onPress={onClose} accessibilityLabel="Close" />
        <View style={[styles.sheetCard, isMobile && styles.sheetCardMobile]}>
          <View style={styles.sheetHeader}>
            <View style={[styles.statusDot, { backgroundColor: tone.color }]} />
            <Text style={styles.sheetTitle}>{buildStatusLabel(build)}</Text>
            {status === 'baking' ? <ActivityIndicator size="small" color={AMBER} /> : null}
          </View>
          <Text style={styles.sheetBody}>{buildStatusDetail(build)}</Text>
          {status === 'baking' ? (
            <View style={styles.progressBox}>
              <View style={styles.progressTrack}>
                <View
                  style={[
                    styles.progressFill,
                    { width: `${Math.max(2, Number(build?.progressPct) || 0)}%`, backgroundColor: tone.color },
                  ]}
                />
              </View>
              <Text style={styles.progressNote} numberOfLines={2}>
                {build?.progressNote || 'Working'} · {Number(build?.progressPct) || 0}%
              </Text>
            </View>
          ) : null}
          {status === 'ready' && build?.summary ? (
            <View style={styles.summaryBox}>
              <Text style={styles.summaryLabel}>From the agent</Text>
              <Text style={styles.summaryText}>{build.summary}</Text>
            </View>
          ) : null}
          {canOpen ? (
            <Pressable
              onPress={() => openPreviewUrl(build.previewUrl)}
              style={({ pressed }) => [styles.primaryButton, pressed && styles.primaryButtonPressed]}
              accessibilityLabel="Open preview"
            >
              <Ionicons name="open-outline" size={18} color="#fff" />
              <Text style={styles.primaryButtonText}>
                {status === 'baking' ? 'Open preview so far' : 'Open preview'}
              </Text>
            </Pressable>
          ) : null}
          {status === 'baking' && build?.syncWarning ? (
            <Text style={styles.warningText}>Last check failed: {build.syncWarning}</Text>
          ) : null}
          {build?.prUrl ? (
            <Pressable
              onPress={() => openPreviewUrl(build.prUrl)}
              style={({ pressed }) => [styles.secondaryButton, pressed && styles.secondaryButtonPressed]}
              accessibilityLabel="View pull request"
            >
              <Ionicons name="git-pull-request-outline" size={16} color={BLUE} />
              <Text style={styles.secondaryButtonText}>View pull request</Text>
            </Pressable>
          ) : null}
          {status === 'baking' && onRefresh ? (
            <Pressable
              onPress={onRefresh}
              disabled={refreshing}
              style={({ pressed }) => [styles.secondaryButton, (pressed || refreshing) && styles.secondaryButtonPressed]}
              accessibilityLabel="Check again"
            >
              <Ionicons name="refresh-outline" size={16} color={BLUE} />
              <Text style={styles.secondaryButtonText}>{refreshing ? 'Checking…' : 'Check again'}</Text>
            </Pressable>
          ) : null}
          <Pressable
            onPress={onClose}
            style={({ pressed }) => [styles.closeButton, pressed && styles.closeButtonPressed]}
            accessibilityLabel="Close"
          >
            <Text style={styles.closeButtonText}>Close</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  tvButton: {
    width: 48,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
  tvButtonActive: {
    backgroundColor: 'rgba(10,132,255,0.08)',
  },
  tvScreen: {
    width: 44,
    height: 22,
    borderRadius: 5,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  tvText: {
    fontFamily,
    fontSize: 9,
    lineHeight: 11,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  tvStand: {
    width: 44,
    height: 3,
    marginTop: 2,
    borderRadius: 1.5,
    overflow: 'hidden',
  },
  tvStandTrack: {
    backgroundColor: 'rgba(60,60,67,0.12)',
  },
  tvStandFill: {
    height: '100%',
    borderRadius: 1.5,
  },
  publishButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 28,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: BLUE,
  },
  publishButtonActive: {
    opacity: 0.85,
  },
  publishButtonOff: {
    backgroundColor: 'rgba(60,60,67,0.08)',
  },
  publishButtonSent: {
    backgroundColor: 'rgba(52,199,89,0.12)',
    paddingHorizontal: 10,
  },
  publishText: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: '#fff',
  },
  publishTextOff: {
    color: '#aeaeb2',
  },
  publishTextSent: {
    color: GREEN,
  },
  sheetRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheetRootDesktop: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  sheetBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.36)',
  },
  sheetCard: {
    marginHorizontal: 12,
    marginBottom: 28,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 14,
    borderRadius: 16,
    backgroundColor: '#fff',
    gap: 10,
    width: 380,
    maxWidth: '92%',
    alignSelf: 'center',
  },
  sheetCardMobile: {
    marginBottom: 18,
    maxWidth: '100%',
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  statusDot: {
    width: 9,
    height: 9,
    borderRadius: 4.5,
  },
  sheetTitle: {
    fontFamily,
    fontSize: 17,
    fontWeight: '600',
    color: '#1d1d1f',
    textAlign: 'center',
  },
  sheetBody: {
    fontFamily,
    fontSize: 14,
    lineHeight: 19,
    color: '#8e8e93',
    textAlign: 'center',
  },
  progressBox: {
    gap: 6,
  },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(60,60,67,0.12)',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
  },
  progressNote: {
    fontFamily,
    fontSize: 12,
    lineHeight: 16,
    color: '#8e8e93',
    textAlign: 'center',
  },
  warningText: {
    fontFamily,
    fontSize: 12,
    lineHeight: 16,
    color: '#b25000',
    textAlign: 'center',
  },
  summaryBox: {
    backgroundColor: '#f2f2f7',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 4,
  },
  summaryLabel: {
    fontFamily,
    fontSize: 11,
    fontWeight: '600',
    color: '#8e8e93',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  summaryText: {
    fontFamily,
    fontSize: 14,
    lineHeight: 19,
    color: '#1d1d1f',
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 48,
    borderRadius: 12,
    backgroundColor: BLUE,
  },
  primaryButtonPressed: {
    opacity: 0.85,
  },
  primaryButtonText: {
    fontFamily,
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  secondaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 44,
    borderRadius: 12,
    backgroundColor: 'rgba(10,132,255,0.08)',
  },
  secondaryButtonPressed: {
    opacity: 0.7,
  },
  secondaryButtonText: {
    fontFamily,
    fontSize: 15,
    fontWeight: '500',
    color: BLUE,
  },
  closeButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  closeButtonPressed: {
    opacity: 0.6,
  },
  closeButtonText: {
    fontFamily,
    fontSize: 17,
    fontWeight: '500',
    color: BLUE,
  },
});
