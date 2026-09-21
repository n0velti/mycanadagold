import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  Vibration,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { isConnectedStatus } from '../lib/callState';
import { callPartyLabel } from '../lib/phoneCalls';
import { formatPhoneNumber } from '../lib/ringcentral';
import { activeCallKicker, formatCallClock, liveCallKey, usePhoneCalls } from './PhoneCallProvider';

const fontFamily = 'Sohne';
const GREEN = '#34C759';
const RED = '#FF3B30';
const BAR_BG = '#0F2E1D';
const DOCK_BG = '#081C11';
const ANSWER_HINT_NATIVE = 'Answer picks up on the store’s RingCentral phone.';
/** Vibrate 0.7s, pause 0.7s, repeat while ringing (iOS ignores durations but keeps the cadence). */
const VIBRATE_PATTERN = [0, 700, 700];
/** Drag the bar down this far to swipe it away. */
const DISMISS_DISTANCE = 44;

function initialsFromName(name) {
  const parts = String(name || '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return '';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

/** Name on top, number underneath; a bare number becomes the headline. */
function callerLines(call) {
  const inbound = call?.direction !== 'Outbound';
  const name = String((inbound ? call?.fromName : call?.toName) || '').trim();
  const raw = String((inbound ? call?.from : call?.to) || '').trim();
  const number = raw ? formatPhoneNumber(raw) || raw : '';
  if (name && number) return { title: name, subtitle: number };
  if (name) return { title: name, subtitle: '' };
  if (number) return { title: number, subtitle: '' };
  return { title: 'Unknown caller', subtitle: '' };
}

function storeLine(call) {
  const store = call?.storeName || 'Store';
  return call?.queueName ? `${store} · ${call.queueName}` : store;
}

function PulseRing({ delay }) {
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(progress, {
          toValue: 1,
          duration: 1800,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(progress, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [delay, progress]);
  const scale = progress.interpolate({ inputRange: [0, 1], outputRange: [1, 1.7] });
  const opacity = progress.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 0.45, 0] });
  return <Animated.View pointerEvents="none" style={[styles.pulseRing, { opacity, transform: [{ scale }] }]} />;
}

function CallerAvatar({ name, size = 44 }) {
  const initials = initialsFromName(name);
  const radius = size / 2;
  return (
    <View style={[styles.avatarWrap, { width: size, height: size }]}>
      <PulseRing delay={0} />
      <PulseRing delay={900} />
      <View style={[styles.avatar, { width: size, height: size, borderRadius: radius }]}>
        {initials ? (
          <Text style={[styles.avatarInitials, { fontSize: Math.round(size * 0.36) }]}>{initials}</Text>
        ) : (
          <Ionicons name="person" size={Math.round(size * 0.5)} color="#DCFCE7" />
        )}
      </View>
    </View>
  );
}

function RoundButton({ icon, color, onPress, disabled, busy, rotate, accessibilityLabel, size = 48 }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [
        styles.roundBtn,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: color },
        pressed && styles.pressed,
        disabled && !busy && styles.disabled,
      ]}
    >
      {busy ? (
        <ActivityIndicator size="small" color="#fff" />
      ) : (
        <Ionicons name={icon} size={Math.round(size * 0.5)} color="#fff" style={rotate ? styles.hangupIcon : null} />
      )}
    </Pressable>
  );
}

function CallClock({ since, style }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <Text style={[styles.clock, style]} numberOfLines={1}>
      {formatCallClock(now - (since || now))}
    </Text>
  );
}

/** Keeps the phone buzzing while a call rings and nothing else is live (native only). */
function useRingVibration(on) {
  useEffect(() => {
    if (Platform.OS === 'web' || !on) return undefined;
    Vibration.vibrate(VIBRATE_PATTERN, true);
    return () => Vibration.cancel();
  }, [on]);
}

/**
 * One ringing call as a bar above the tab bar. The rest of the app stays
 * usable: Answer and Decline are right there, and dragging the bar down (or
 * tapping the chevron) swipes it away without touching the call.
 */
function IncomingCallBar({ call, busy, error, showHint, onAnswer, onReject, onIgnore }) {
  const { title, subtitle } = callerLines(call);
  const name = call.direction !== 'Outbound' ? call.fromName : call.toName;
  const slide = useRef(new Animated.Value(80)).current;
  const drag = useRef(new Animated.Value(0)).current;
  const dismissed = useRef(false);

  useEffect(() => {
    Animated.spring(slide, { toValue: 0, damping: 18, stiffness: 180, mass: 0.8, useNativeDriver: true }).start();
  }, [slide]);

  const dismiss = () => {
    if (dismissed.current) return;
    dismissed.current = true;
    Animated.timing(drag, { toValue: 160, duration: 180, easing: Easing.in(Easing.quad), useNativeDriver: true }).start(
      () => onIgnore(call),
    );
  };

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gesture) =>
        Math.abs(gesture.dy) > 6 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
      onPanResponderMove: (_, gesture) => {
        drag.setValue(Math.max(0, gesture.dy));
      },
      onPanResponderRelease: (_, gesture) => {
        if (gesture.dy > DISMISS_DISTANCE || gesture.vy > 0.8) {
          dismiss();
          return;
        }
        Animated.spring(drag, { toValue: 0, damping: 20, stiffness: 220, useNativeDriver: true }).start();
      },
      onPanResponderTerminate: () => {
        Animated.spring(drag, { toValue: 0, damping: 20, stiffness: 220, useNativeDriver: true }).start();
      },
    }),
  ).current;

  const opacity = drag.interpolate({ inputRange: [0, 120], outputRange: [1, 0.2], extrapolate: 'clamp' });

  return (
    <Animated.View
      {...pan.panHandlers}
      style={[styles.incomingBar, { opacity, transform: [{ translateY: Animated.add(slide, drag) }] }]}
      accessibilityLabel={`Incoming call from ${title} at ${call.storeName || 'store'}`}
    >
      <View style={styles.grabberRow}>
        <View style={styles.grabber} />
      </View>
      <View style={styles.incomingRow}>
        <CallerAvatar name={name} />
        <View style={styles.incomingCopy}>
          <View style={styles.kickerRow}>
            <View style={styles.liveDot} />
            <Text style={styles.kicker} numberOfLines={1}>
              {storeLine(call)}
            </Text>
          </View>
          <Text style={styles.incomingTitle} numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? (
            <Text style={styles.incomingSubtitle} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        <View style={styles.incomingActions}>
          <RoundButton
            icon="close"
            color={RED}
            disabled={busy}
            onPress={() => onReject(call)}
            accessibilityLabel={`Decline call from ${title}`}
          />
          <RoundButton
            icon="call"
            color={GREEN}
            disabled={busy}
            busy={busy}
            onPress={() => onAnswer(call)}
            accessibilityLabel={`Answer call from ${title}`}
          />
        </View>
        <Pressable
          onPress={dismiss}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Hide this call"
          style={({ pressed }) => [styles.hideBtn, pressed && styles.pressed]}
        >
          <Ionicons name="chevron-down" size={18} color="rgba(255,255,255,0.7)" />
        </Pressable>
      </View>
      {error ? (
        <Text style={styles.barError} numberOfLines={3}>
          {error}
        </Text>
      ) : showHint ? (
        <Text style={styles.barHint} numberOfLines={1}>
          {ANSWER_HINT_NATIVE}
        </Text>
      ) : null}
    </Animated.View>
  );
}

/** Live conversation, docked above the tab bar so the rest of the app stays usable. */
function ActiveCallBar({ call, busy, muted, audioState, onMute, onHangup, onEnableSound }) {
  const { title, subtitle } = callerLines(call);
  const kicker = activeCallKicker(call);
  const connected = isConnectedStatus(call.status);
  const soundBlocked = audioState === 'blocked';
  const canMute = Platform.OS === 'web' && call.web;
  return (
    <View style={styles.activeBar} accessibilityLabel={`${kicker} ${callPartyLabel(call, { formatPhone: formatPhoneNumber })} at ${call.storeName || 'store'}`}>
      <View style={styles.activeCopy}>
        <View style={styles.kickerRow}>
          <View style={[styles.liveDot, connected && styles.liveDotConnected]} />
          <Text style={styles.kicker} numberOfLines={1}>
            {kicker} · {call.storeName || 'Store'}
          </Text>
          {connected && call.answeredAt ? <CallClock since={call.answeredAt} style={styles.barClock} /> : null}
        </View>
        <Text style={styles.barTitle} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.barSubtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <View style={styles.barActions}>
        {soundBlocked ? (
          <RoundButton
            icon="volume-high"
            color="#FCD34D"
            size={44}
            onPress={onEnableSound}
            accessibilityLabel="Enable sound for this call"
          />
        ) : null}
        {canMute ? (
          <RoundButton
            icon={muted ? 'mic-off' : 'mic'}
            color={muted ? '#B45309' : 'rgba(255,255,255,0.2)'}
            size={44}
            disabled={busy || !connected}
            onPress={onMute}
            accessibilityLabel={muted ? 'Unmute microphone' : 'Mute microphone'}
          />
        ) : null}
        <RoundButton
          icon="call"
          color={RED}
          size={44}
          rotate
          disabled={busy}
          busy={busy}
          onPress={onHangup}
          accessibilityLabel="Hang up"
        />
      </View>
    </View>
  );
}

/**
 * Phone UI for the mobile shell: everything sits in a dock above the tab bar,
 * so a ringing call never takes over the screen. Ringing calls are bars with
 * Answer / Decline that can be swiped away; a live call is a bar with mute and
 * hang up.
 */
export default function MobilePhoneDock() {
  const {
    incoming,
    ignoredCallKeys,
    ignoreCall,
    recentAnswered,
    activeCall,
    muted,
    toggleMute,
    audioState,
    resumeAudio,
    busy,
    error,
    silent,
    answer,
    reject,
    hangup,
  } = usePhoneCalls();

  const ringing = (incoming || []).filter(
    (call) => call.id !== activeCall?.id && !ignoredCallKeys?.[liveCallKey(call)],
  );
  useRingVibration(ringing.length > 0 && !activeCall && !silent);

  if (!ringing.length && !recentAnswered.length && !activeCall) return null;

  const swallow = (promise) => promise.catch(() => {});
  const onAnswer = (call) => swallow(answer(call));
  const onReject = (call) => swallow(reject(call));
  const onHangup = () => swallow(hangup(activeCall));
  const onEnableSound = () => swallow(resumeAudio());

  const answered = recentAnswered.filter((row) => row.callId !== activeCall?.id);
  return (
    <View style={styles.dock}>
      {activeCall ? (
        <View style={styles.dockCard}>
          <ActiveCallBar
            call={activeCall}
            busy={busy}
            muted={muted}
            audioState={audioState}
            onMute={toggleMute}
            onHangup={onHangup}
            onEnableSound={onEnableSound}
          />
          {audioState === 'blocked' ? (
            <Text style={styles.dockNote} numberOfLines={2}>
              The browser blocked the call audio. Tap the speaker button to hear the caller.
            </Text>
          ) : null}
          {error ? (
            <Text style={styles.dockError} numberOfLines={3}>
              {error}
            </Text>
          ) : null}
        </View>
      ) : null}
      {ringing.map((call, index) => (
        <IncomingCallBar
          key={liveCallKey(call)}
          call={call}
          busy={busy}
          error={index === 0 && !activeCall ? error : ''}
          showHint={Platform.OS !== 'web' && index === 0}
          onAnswer={onAnswer}
          onReject={onReject}
          onIgnore={ignoreCall}
        />
      ))}
      {answered.map((row) => (
        <View key={row.id} style={styles.answeredRow}>
          <Ionicons name="checkmark-circle" size={18} color="#86EFAC" />
          <Text style={styles.answeredText} numberOfLines={1}>
            Answered · {row.storeName}
            {row.label ? ` · ${row.label}` : ''}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  dock: {
    marginHorizontal: 10,
    marginBottom: 8,
    gap: 6,
  },
  dockCard: {
    padding: 8,
    borderRadius: 18,
    backgroundColor: DOCK_BG,
    gap: 6,
    ...Platform.select({
      web: {},
      default: {
        shadowColor: '#000',
        shadowOpacity: 0.22,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 4 },
        elevation: 6,
      },
    }),
  },

  // --- Incoming call bar -----------------------------------------------------
  incomingBar: {
    borderRadius: 20,
    backgroundColor: BAR_BG,
    paddingHorizontal: 12,
    paddingBottom: 10,
    borderWidth: 1,
    borderColor: 'rgba(134, 239, 172, 0.25)',
    ...Platform.select({
      web: { boxShadow: '0 8px 24px rgba(0,0,0,0.28)', touchAction: 'none', userSelect: 'none' },
      default: {
        shadowColor: '#000',
        shadowOpacity: 0.28,
        shadowRadius: 14,
        shadowOffset: { width: 0, height: 6 },
        elevation: 8,
      },
    }),
  },
  grabberRow: {
    alignItems: 'center',
    paddingTop: 6,
    paddingBottom: 4,
  },
  grabber: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.28)',
  },
  incomingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  incomingCopy: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  incomingTitle: {
    fontFamily,
    fontSize: 17,
    fontWeight: '600',
    color: '#fff',
    letterSpacing: -0.3,
  },
  incomingSubtitle: {
    fontFamily,
    fontSize: 13,
    color: '#BBF7D0',
    fontVariant: ['tabular-nums'],
  },
  incomingActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  hideBtn: {
    width: 28,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -4,
    marginRight: -6,
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  barHint: {
    fontFamily,
    fontSize: 11,
    color: 'rgba(187, 247, 208, 0.75)',
    marginTop: 6,
  },
  barError: {
    fontFamily,
    fontSize: 12,
    lineHeight: 16,
    color: '#FECACA',
    marginTop: 6,
  },

  // --- Shared bits -----------------------------------------------------------
  kickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minWidth: 0,
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: GREEN,
  },
  liveDotConnected: {
    backgroundColor: '#86EFAC',
  },
  kicker: {
    fontFamily,
    fontSize: 11,
    fontWeight: '700',
    color: '#BBF7D0',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    flexShrink: 1,
  },
  avatarWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulseRing: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 999,
    backgroundColor: GREEN,
  },
  avatar: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1F7A44',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.22)',
  },
  avatarInitials: {
    fontFamily,
    fontWeight: '600',
    color: '#fff',
    letterSpacing: 0.5,
  },
  roundBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {
        shadowColor: '#000',
        shadowOpacity: 0.25,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: 3 },
        elevation: 4,
      },
    }),
  },
  pressed: {
    opacity: 0.78,
    transform: [{ scale: 0.96 }],
  },
  disabled: {
    opacity: 0.5,
  },
  hangupIcon: {
    transform: [{ rotate: '135deg' }],
  },

  // --- Active call bar -------------------------------------------------------
  activeBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.07)',
  },
  activeCopy: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  barClock: {
    marginLeft: 2,
  },
  clock: {
    fontFamily,
    fontSize: 11,
    fontWeight: '700',
    color: '#86EFAC',
    fontVariant: ['tabular-nums'],
  },
  barTitle: {
    fontFamily,
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
    letterSpacing: -0.2,
  },
  barSubtitle: {
    fontFamily,
    fontSize: 13,
    color: '#BBF7D0',
    fontVariant: ['tabular-nums'],
  },
  barActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  answeredRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 36,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: DOCK_BG,
  },
  answeredText: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: '#D1FAE5',
    flex: 1,
    minWidth: 0,
  },
  dockNote: {
    fontFamily,
    fontSize: 12,
    lineHeight: 16,
    color: '#FDE68A',
    paddingHorizontal: 8,
  },
  dockError: {
    fontFamily,
    fontSize: 12,
    lineHeight: 16,
    color: '#FECACA',
    paddingHorizontal: 8,
  },
});
